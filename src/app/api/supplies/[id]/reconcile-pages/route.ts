/**
 * POST /api/supplies/[id]/reconcile-pages
 *
 * Reconcilia invoices "huérfanas" del mismo supply que en realidad son
 * páginas distintas de la misma factura física. Caso típico: el comercial
 * mandó fotos sueltas por Telegram. Una foto tiene holder+CIF+periodo+total,
 * otra tiene CUPS+consumos+precios+importes. Al ser fotos separadas, se
 * crean 2 invoices con datos parciales.
 *
 * Algoritmo:
 *   1. Carga todas las invoices del supply.
 *   2. Las clasifica en:
 *        A) "completas": holder + CIF + economics.consumo + totalFactura
 *        B) "huérfanas-titular": holder + CIF + total declarado pero SIN desglose
 *        C) "huérfanas-desglose": SIN holder/CIF pero CON economics extraídos
 *   3. Para cada huérfana-titular, busca la huérfana-desglose cuyo total
 *      reconstruido coincida (±2 €) o cuyos días facturados coincidan.
 *   4. Si encuentra par → fusiona: mueve los datos económicos a la
 *      huérfana-titular y borra la huérfana-desglose.
 *
 * Solo admins.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

interface InvoiceRow {
  id: string
  file_url: string | null
  extracted_data: any
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  extraction_status: string | null
  created_at: string
}

/** Reconstrucción mínima del total a partir de economics (gas o luz). */
function reconstruirTotal(eco: any): number {
  if (!eco) return 0
  // Si Gemini lo trae directamente, usamos su valor declarado
  const decl = Number(eco.totalFactura) || 0
  if (decl > 0) return decl

  // Suma directa de conceptos
  const energia = Array.isArray(eco.consumo)
    ? eco.consumo.reduce((s: number, c: any) => s + (Number(c.total) || 0), 0)
    : 0
  const potencia = Array.isArray(eco.potencia)
    ? eco.potencia.reduce((s: number, p: any) => s + (Number(p.total) || 0), 0)
    : 0
  const otros = Array.isArray(eco.otrosConceptos)
    ? eco.otrosConceptos.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0)
    : 0
  return energia + potencia + otros
}

/** Días facturados extraídos de economics (suma de potencia[].dias) o derivado de periodo. */
function diasDe(eco: any): number {
  if (!eco) return 0
  const fromPotencia = Array.isArray(eco.potencia) && eco.potencia.length > 0
    ? Math.max(...eco.potencia.map((p: any) => Number(p.dias) || 0))
    : 0
  if (fromPotencia > 0) return fromPotencia
  // Derivar de periodo si hay fechas
  if (eco.fechaInicio && eco.fechaFin) {
    const a = new Date(eco.fechaInicio).getTime()
    const b = new Date(eco.fechaFin).getTime()
    if (!isNaN(a) && !isNaN(b) && b > a) return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1
  }
  return 0
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users_profile').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
    }

    const supplyId = params.id
    if (!supplyId) return NextResponse.json({ error: 'supplyId required' }, { status: 400 })

    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('id, file_url, extracted_data, period_start, period_end, total_amount, extraction_status, created_at')
      .eq('supply_id', supplyId)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!invoices || invoices.length < 2) {
      return NextResponse.json({ ok: true, message: 'No hay invoices suficientes para reconciliar', merges: 0 })
    }

    // Clasificar
    const titularesHuerfanos: InvoiceRow[] = []   // tienen holder+CIF+total, sin desglose
    const desglosesHuerfanos: InvoiceRow[] = []   // tienen desglose, sin holder/CIF
    for (const inv of invoices as InvoiceRow[]) {
      const ed = inv.extracted_data || {}
      const eco = ed.economics || {}
      const tieneHolder = !!(ed.holder_name && (ed.holder_cif_nif || ed.cif || ed.nif))
      const consumos = Array.isArray(eco.consumo) ? eco.consumo : []
      const tieneDesglose = consumos.some((c: any) => (Number(c.kwh) || 0) > 0 && (Number(c.precioKwh) || 0) > 0)
      const total = reconstruirTotal(eco) || Number(inv.total_amount) || 0

      if (tieneHolder && !tieneDesglose && total > 0) {
        titularesHuerfanos.push(inv)
      } else if (!tieneHolder && tieneDesglose && total > 0) {
        desglosesHuerfanos.push(inv)
      }
    }

    if (titularesHuerfanos.length === 0 || desglosesHuerfanos.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No hay páginas complementarias que fusionar',
        merges: 0,
        debug: {
          titulares: titularesHuerfanos.length,
          desgloses: desglosesHuerfanos.length,
        },
      })
    }

    // Emparejar por coincidencia de total (±2 €) o por días facturados (±1)
    const usados = new Set<string>()
    const merges: Array<{ titular: string; desglose: string; total: number; method: string }> = []

    for (const titular of titularesHuerfanos) {
      const ecoT = titular.extracted_data?.economics || {}
      const totalT = reconstruirTotal(ecoT) || Number(titular.total_amount) || 0
      const diasT = diasDe(ecoT)

      let mejorMatch: { row: InvoiceRow; diff: number; method: string } | null = null
      for (const desglose of desglosesHuerfanos) {
        if (usados.has(desglose.id)) continue
        const ecoD = desglose.extracted_data?.economics || {}
        const totalD = reconstruirTotal(ecoD)
        const diasD = diasDe(ecoD)

        const diffTotal = Math.abs(totalT - totalD)
        if (totalT > 0 && totalD > 0 && diffTotal <= 2) {
          if (!mejorMatch || diffTotal < mejorMatch.diff) {
            mejorMatch = { row: desglose, diff: diffTotal, method: `total ±${diffTotal.toFixed(2)}€` }
          }
        } else if (diasT > 0 && diasD > 0 && Math.abs(diasT - diasD) <= 1) {
          const diffDias = Math.abs(diasT - diasD)
          if (!mejorMatch || diffDias < mejorMatch.diff) {
            mejorMatch = { row: desglose, diff: diffDias, method: `días ±${diffDias}` }
          }
        }
      }

      if (mejorMatch) {
        // Fusionar: mover datos económicos del desglose a la invoice titular
        const merged = {
          ...titular.extracted_data,
          ...mejorMatch.row.extracted_data,
          // El holder/CIF/periodo del titular siempre prevalece
          holder_name: titular.extracted_data.holder_name,
          holder_cif_nif: titular.extracted_data.holder_cif_nif || titular.extracted_data.cif || titular.extracted_data.nif,
          // Los economics del desglose siempre prevalecen
          economics: {
            ...(titular.extracted_data?.economics || {}),
            ...(mejorMatch.row.extracted_data?.economics || {}),
            // Pero el titular conserva fechas declaradas y total
            fechaInicio: titular.extracted_data?.economics?.fechaInicio
              || mejorMatch.row.extracted_data?.economics?.fechaInicio,
            fechaFin: titular.extracted_data?.economics?.fechaFin
              || mejorMatch.row.extracted_data?.economics?.fechaFin,
            titular: titular.extracted_data?.economics?.titular
              || titular.extracted_data?.holder_name,
            totalFactura: Number(titular.extracted_data?.economics?.totalFactura) > 0
              ? titular.extracted_data?.economics?.totalFactura
              : reconstruirTotal(mejorMatch.row.extracted_data?.economics),
          },
        }

        await supabase
          .from('invoices')
          .update({ extracted_data: merged, extraction_status: 'completed' })
          .eq('id', titular.id)
        await supabase.from('invoices').delete().eq('id', mejorMatch.row.id)

        usados.add(mejorMatch.row.id)
        merges.push({ titular: titular.id, desglose: mejorMatch.row.id, total: totalT, method: mejorMatch.method })
      }
    }

    return NextResponse.json({
      ok: true,
      message: merges.length > 0 ? `${merges.length} factura(s) reconciliadas` : 'Ninguna pareja con match suficiente',
      merges,
    })
  } catch (e: any) {
    console.error('[POST /api/supplies/[id]/reconcile-pages]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
