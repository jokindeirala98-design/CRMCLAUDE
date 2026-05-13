/**
 * GET /api/comparativa/[supplyId]/standalone-html
 *
 * Devuelve un HTML autocontenido con la comparativa tripartita del CLIENTE
 * (no solo del supply): agrega TODOS los supplies del cliente con facturas
 * Voltis. Si el cliente tiene luz + gas, el HTML muestra las 7 pestañas
 * (3 luz + 2 gas + Documentos). Si solo tiene uno, omite las pestañas del
 * otro.
 *
 * PDFs embebidos en base64 (solo los del periodo comparado).
 *
 * Endpoint independiente del V1 y V2 — solo se llama cuando el comercial
 * pulsa "Descargar HTML para cliente" desde ComparativaVoltisV2.
 */
import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { computarTripartita, type ResultadoTripartito } from '@/lib/comparativa-tripartita'
import { generarHtmlStandalone, type PdfEmbed, type SupplyInfo } from '@/lib/comparativa-html-generator'

export const runtime = 'nodejs'
export const maxDuration = 60   // descargar PDFs + base64 puede tardar 10-30s

/** Lee la mascota Buddy del filesystem (public/) y la devuelve en base64.
 *  Si el archivo no existe, devuelve null y el generador caerá al SVG. */
async function loadMascotBase64(): Promise<{ base64: string; mime: string } | null> {
  try {
    const filePath = path.join(process.cwd(), 'public', 'mascota-transparente.png')
    const buf = await readFile(filePath)
    return { base64: buf.toString('base64'), mime: 'image/png' }
  } catch {
    return null
  }
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase()
}

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

/** Construye los PDFs base64 de los pares de un resultado tripartito. */
async function pdfsDelResultado(
  resultado: ResultadoTripartito,
  supplyType: 'luz' | 'gas',
  clientSlug: string,
): Promise<PdfEmbed[]> {
  const tasks: Array<Promise<PdfEmbed | null>> = []
  for (const par of resultado.pares) {
    const buildLado = (side: 'antigua' | 'voltis', invoice: any) => async (): Promise<PdfEmbed | null> => {
      if (!invoice.file_url) return null
      const dl = await downloadToBase64(invoice.file_url)
      if (!dl) return null
      const eco = invoice.extracted_data?.economics
      const mesLabel = `${MESES[par.mes]} ${side === 'antigua' ? par.year - 1 : par.year}`
      return {
        invoiceId: invoice.id,
        side,
        supplyType,
        base64: dl.base64,
        mime: dl.mime,
        filename: `${clientSlug}_${supplyType}_${slug(mesLabel)}_${side}.pdf`,
        sizeKb: dl.sizeKb,
        mesLabel,
        comercializadora: eco?.comercializadora || (side === 'voltis' ? resultado.comercializadoraVoltis : resultado.comercializadoraAntigua),
      }
    }
    tasks.push(buildLado('antigua', par.antigua)())
    tasks.push(buildLado('voltis', par.voltis)())
  }
  return (await Promise.all(tasks)).filter((p): p is PdfEmbed => p !== null)
}

export async function GET(_req: NextRequest, { params }: { params: { supplyId: string } }) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supplyId = params.supplyId
    if (!supplyId) return NextResponse.json({ error: 'supplyId required' }, { status: 400 })

    // 1. Cargar el supply principal para obtener client_id, datos básicos y CUPS visible.
    const { data: principal, error: supErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, client_id, name,
        client:clients(id, name, cif, nif, cif_nif)
      `)
      .eq('id', supplyId)
      .single()

    if (supErr || !principal) {
      return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
    }

    // 2. Cargar TODOS los supplies del cliente CON sus facturas — para
    //    poder agregar luz + gas en el mismo HTML.
    const { data: clientSupplies } = await supabase
      .from('supplies')
      .select(`id, cups, tariff, type, invoices:invoices(*)`)
      .eq('client_id', principal.client_id)

    if (!clientSupplies || clientSupplies.length === 0) {
      return NextResponse.json({ error: 'Sin supplies en el cliente' }, { status: 404 })
    }

    // 3. Calcular tripartita por separado para luz y para gas.
    //    Concatena las facturas de todos los supplies del mismo tipo (cliente
    //    multi-CUPS). La función emparejará antiguas↔Voltis por mes natural.
    const invoicesLuz: any[] = []
    const invoicesGas: any[] = []
    for (const s of clientSupplies as any[]) {
      const invs = Array.isArray(s.invoices) ? s.invoices : []
      const tipo = (s.type === 'gas' || /^RL/i.test(s.tariff || '')) ? 'gas' : 'luz'
      for (const inv of invs) {
        if (tipo === 'gas') invoicesGas.push(inv)
        else invoicesLuz.push(inv)
      }
    }

    const resultadoLuz = invoicesLuz.length > 0
      ? computarTripartita({ invoices: invoicesLuz, supplyTypeHint: 'luz' })
      : null
    const resultadoGas = invoicesGas.length > 0
      ? computarTripartita({ invoices: invoicesGas, supplyTypeHint: 'gas' })
      : null

    const hasLuz = !!resultadoLuz && resultadoLuz.pares.length > 0
    const hasGas = !!resultadoGas && resultadoGas.pares.length > 0

    if (!hasLuz && !hasGas) {
      return NextResponse.json({
        error: 'No hay parejas factura antigua ↔ Voltis para generar la comparativa',
      }, { status: 422 })
    }

    // 4. Descargar PDFs del periodo comparado (luz + gas)
    const clientRel = Array.isArray(principal.client) ? principal.client[0] : principal.client
    const clientName = clientRel?.name || 'cliente'
    const clientSlug = slug(clientName)

    const [pdfsLuz, pdfsGas] = await Promise.all([
      hasLuz ? pdfsDelResultado(resultadoLuz!, 'luz', clientSlug) : Promise.resolve([] as PdfEmbed[]),
      hasGas ? pdfsDelResultado(resultadoGas!, 'gas', clientSlug) : Promise.resolve([] as PdfEmbed[]),
    ])
    const pdfs = [...pdfsLuz, ...pdfsGas]

    const supplyInfo: SupplyInfo = {
      id: principal.id,
      cups: principal.cups,
      tariff: principal.tariff,
      type: principal.type,
      name: principal.name,
      client_name: clientName,
      client_cif: clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null,
    }

    // Mascota Buddy embebida (si existe en public/) — en paralelo a los PDFs
    const mascot = await loadMascotBase64()

    const html = generarHtmlStandalone({
      supply: supplyInfo,
      resultadoLuz: hasLuz ? resultadoLuz : null,
      resultadoGas: hasGas ? resultadoGas : null,
      pdfs,
      cupsPrincipal: principal.cups,
      mascotBase64: mascot?.base64 ?? null,
      mascotMime: mascot?.mime,
    })

    // Nombre del archivo: usa el rango de meses cubierto por luz si existe, si no gas
    const cov = (hasLuz ? resultadoLuz! : resultadoGas!).cobertura
    const yearIni = cov.desde?.year ?? new Date().getFullYear() - 1
    const yearFin = cov.hasta?.year ?? new Date().getFullYear()
    const filename = `voltis_comparativa_${clientSlug}_${yearIni}_${yearFin}.html`

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
