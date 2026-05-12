/**
 * GET /api/comparativa/[supplyId]/pdf?meses=2026-0,2026-1,...
 *
 * Genera el PDF de la comparativa con Puppeteer headless. El HTML se construye
 * server-side via buildComparativaHtml() y se pasa a Chromium con setContent(),
 * evitando dependencias de auth en una página interna pública.
 *
 * En Vercel: usa puppeteer-core + @sparticuz/chromium para tirar de un Chromium
 * comprimido empaquetado.
 * En local (NODE_ENV=development): cae a puppeteer regular si está disponible.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { computarComparativa } from '@/lib/comparativa-energetica'
import { buildComparativaHtml } from '@/lib/comparativa-pdf-html'

export const runtime = 'nodejs'
export const maxDuration = 60

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

async function launchBrowser() {
  const chromium = (await import('@sparticuz/chromium-min')).default
  const puppeteer = (await import('puppeteer-core')).default
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
    defaultViewport: { width: 794, height: 1123 }, // A4 a 96dpi
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: { supplyId: string } },
) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supplyId = params.supplyId

    // 1. Carga supply + invoices
    const { data: supply, error: supErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, client_id, name,
        client:clients(id, name),
        comercializadora:comercializadoras(id, name),
        invoices:invoices(*)
      `)
      .eq('id', supplyId)
      .single()
    if (supErr || !supply) {
      return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
    }

    // 2. Calcula comparativa
    const comparativa = computarComparativa((supply.invoices as any[]) || [], supply.type as any)

    // 3. Parsea filtro de meses si lo hay
    const mesesParam = req.nextUrl.searchParams.get('meses')
    const mesesSeleccionados = mesesParam
      ? new Set(mesesParam.split(',').filter(Boolean))
      : undefined

    // 4. Genera HTML
    const clientRel = Array.isArray(supply.client) ? supply.client[0] : supply.client
    const comercializadoraRel = Array.isArray(supply.comercializadora) ? supply.comercializadora[0] : supply.comercializadora
    const html = buildComparativaHtml({
      supply: {
        cups: supply.cups,
        tariff: supply.tariff,
        type: supply.type,
        client_name: clientRel?.name ?? null,
        comercializadora: comercializadoraRel?.name ?? null,
      },
      comparativa,
      mesesSeleccionados,
    })

    // 5. Render con Chromium
    const browser = await launchBrowser()
    let pdfBuffer: Buffer
    try {
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0' })
      // Espera a que las web fonts carguen (Instrument Serif, Geist…)
      await page.evaluate(() => (document as any).fonts && (document as any).fonts.ready)
      const result = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        preferCSSPageSize: true,
      })
      pdfBuffer = Buffer.isBuffer(result) ? result : Buffer.from(result)
    } finally {
      await browser.close().catch(() => {})
    }

    const cli = (clientRel?.name || 'cliente').replace(/[^\w]+/g, '_')
    const cups = (supply.cups || '').slice(-8)
    const filename = `Comparativa_Voltis_${cli}_${cups}.pdf`

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    console.error('[GET /api/comparativa/[supplyId]/pdf]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
