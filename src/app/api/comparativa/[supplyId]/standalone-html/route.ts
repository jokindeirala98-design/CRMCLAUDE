/**
 * GET /api/comparativa/[supplyId]/standalone-html
 *
 * Devuelve un HTML autocontenido con la comparativa tripartita del suministro:
 *   - CSS, JS y SVGs inline.
 *   - PDFs de las facturas del periodo comparado embebidos en base64 (típica-
 *     mente 3 antiguas + 3 Voltis = 6 archivos). El usuario abre el archivo
 *     con doble clic, ve la comparativa, y puede descargar cada factura.
 *
 * Tamaño esperado: 1-2 MB con PDFs embebidos.
 *
 * Endpoint independiente del V1 y V2 — solo se llama cuando el comercial
 * pulsa "Descargar HTML para cliente" desde ComparativaVoltisV2.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { computarTripartita } from '@/lib/comparativa-tripartita'
import { generarHtmlStandalone, type PdfEmbed, type SupplyInfo } from '@/lib/comparativa-html-generator'

export const runtime = 'nodejs'
export const maxDuration = 60   // descargar 6 PDFs + base64 puede tardar 10-30s

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase()
}

/** Descarga un fichero a buffer. Acepta URLs públicas o firmadas de Supabase Storage. */
async function downloadToBase64(url: string): Promise<{ base64: string; mime: string; sizeKb: number } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      base64: buf.toString('base64'),
      mime: res.headers.get('content-type') || 'application/pdf',
      sizeKb: Math.round(buf.byteLength / 1024),
    }
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, { params }: { params: { supplyId: string } }) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supplyId = params.supplyId
    if (!supplyId) return NextResponse.json({ error: 'supplyId required' }, { status: 400 })

    const { data: supply, error: supErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, name,
        client:clients(id, name, cif, nif, cif_nif),
        invoices:invoices(*)
      `)
      .eq('id', supplyId)
      .single()

    if (supErr || !supply) return NextResponse.json({ error: 'Supply not found' }, { status: 404 })

    const invoices = (supply.invoices as any[]) || []
    const resultado = computarTripartita({
      invoices,
      supplyTypeHint: supply.type === 'gas' ? 'gas' : 'luz',
    })

    if (resultado.pares.length === 0) {
      return NextResponse.json({
        error: 'No hay parejas factura antigua ↔ Voltis para generar la comparativa',
      }, { status: 422 })
    }

    // Descargar los PDFs SOLO del periodo comparado (3 antigua + 3 Voltis típico).
    // Esto cumple la regla del prompt: 6 archivos máx ≈ 1-2 MB final.
    const pdfTasks: Array<Promise<PdfEmbed | null>> = []
    for (const par of resultado.pares) {
      const lado = (side: 'antigua' | 'voltis', invoice: any) => async (): Promise<PdfEmbed | null> => {
        if (!invoice.file_url) return null
        const dl = await downloadToBase64(invoice.file_url)
        if (!dl) return null
        const eco = invoice.extracted_data?.economics
        const mesLabel = `${MESES[par.mes]} ${side === 'antigua' ? par.year - 1 : par.year}`
        return {
          invoiceId: invoice.id,
          side,
          base64: dl.base64,
          mime: dl.mime,
          filename: `${slug(supply.client?.[0]?.name || supply.name || 'cliente')}_${slug(mesLabel)}_${side}.pdf`,
          sizeKb: dl.sizeKb,
          mesLabel,
          comercializadora: eco?.comercializadora || (side === 'voltis' ? resultado.comercializadoraVoltis : resultado.comercializadoraAntigua),
        }
      }
      pdfTasks.push(lado('antigua', par.antigua)())
      pdfTasks.push(lado('voltis', par.voltis)())
    }
    const pdfs = (await Promise.all(pdfTasks)).filter((p): p is PdfEmbed => p !== null)

    const clientRel = Array.isArray(supply.client) ? supply.client[0] : supply.client
    const supplyInfo: SupplyInfo = {
      id: supply.id,
      cups: supply.cups,
      tariff: supply.tariff,
      type: supply.type,
      name: supply.name,
      client_name: clientRel?.name ?? null,
      client_cif: clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null,
    }

    const html = generarHtmlStandalone({ supply: supplyInfo, resultado, pdfs })

    const yearIni = resultado.cobertura.desde?.year ?? new Date().getFullYear() - 1
    const yearFin = resultado.cobertura.hasta?.year ?? new Date().getFullYear()
    const filename = `voltis_comparativa_${slug(clientRel?.name || 'cliente')}_${yearIni}_${yearFin}.html`

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    console.error('[GET /api/comparativa/[supplyId]/standalone-html]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
