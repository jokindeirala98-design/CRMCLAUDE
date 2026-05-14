/**
 * GET /api/gana/comparativa/[supplyId]
 *
 * Carga todos los datos de un supply para calcular la comparativa Gana con la
 * fórmula commer-style: SIPS, factura más reciente, maxímetro (pot. máx
 * demandada), detección bono social, fees fijos (Smart Iberdrola etc) y
 * tarifas Gana vigentes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  computarComparativaGana,
  buildScenariosFromTarifas,
  type GanaTarifaRow,
  type InputComparativa2td,
} from '@/lib/comparativa-2td-gana'

export const runtime = 'nodejs'

// ─── Helpers extracción factura ─────────────────────────────────────────────

function extractPriceByPeriod(items: any[] | undefined, key: 'precioKwh' | 'precioKwDia'): {
  P1: number; P2: number; P3: number
} {
  const result = { P1: 0, P2: 0, P3: 0 }
  if (!Array.isArray(items)) return result
  for (const it of items) {
    const per = String(it.periodo || '').toUpperCase().replace(/[^P1-9]/g, '')
    const val = Number(it[key] ?? 0)
    if (!isFinite(val) || val <= 0) continue
    if (per === 'P1') result.P1 = val
    else if (per === 'P2') result.P2 = val
    else if (per === 'P3') result.P3 = val
  }
  if (result.P2 === 0 && result.P3 > 0) result.P2 = result.P3
  if (result.P3 === 0 && result.P2 > 0) result.P3 = result.P2
  return result
}

function extractConsumoFromInvoice(items: any[] | undefined): {
  P1: number; P2: number; P3: number
} {
  const r = { P1: 0, P2: 0, P3: 0 }
  if (!Array.isArray(items)) return r
  for (const it of items) {
    const per = String(it.periodo || '').toUpperCase().replace(/[^P1-9]/g, '')
    const val = Number(it.kwh ?? 0)
    if (!isFinite(val) || val < 0) continue
    if (per === 'P1') r.P1 = val
    else if (per === 'P2') r.P2 = val
    else if (per === 'P3') r.P3 = val
  }
  return r
}

/**
 * Detecta cargos fijos no incluidos en la fórmula básica
 * (Smart Iberdrola, mantenimiento, seguros…).
 */
function detectFixedFees(eco: any): { monthly: number; concepts: string[] } {
  if (!eco?.otrosConceptos || !Array.isArray(eco.otrosConceptos)) {
    return { monthly: 0, concepts: [] }
  }
  const KEYWORDS = [
    'smart', 'mantenimiento', 'seguro', 'protec', 'cobertura', 'asistencia',
    'plus', 'club', 'tranquilidad', 'happy', 'plan ', 'servicio',
  ]
  const concepts: string[] = []
  let total = 0
  for (const c of eco.otrosConceptos) {
    const txt = String(c.concepto ?? '').toLowerCase()
    const monto = Number(c.total ?? 0)
    if (!isFinite(monto) || monto <= 0) continue
    if (KEYWORDS.some(kw => txt.includes(kw))) {
      total += monto
      concepts.push(`${c.concepto} (${monto.toFixed(2)} €)`)
    }
  }
  const dias = Number(eco.diasFacturados ?? 30)
  const monthly = dias > 0 ? (total / dias) * 30 : total
  return { monthly, concepts }
}

/**
 * Detecta indicios de bono social en la factura o el cliente.
 * Sin acceso al sistema de CNMC, usamos heurísticas:
 *  - precio energía bruto < 0.10 €/kWh sin descuentos por separado
 *  - concepto "Bono Social" / "Descuento bono" en otrosConceptos
 */
function detectBonoSocial(eco: any): { has: boolean; discount: number } {
  let discount = 0
  let detected = false
  if (eco?.otrosConceptos && Array.isArray(eco.otrosConceptos)) {
    for (const c of eco.otrosConceptos) {
      const txt = String(c.concepto ?? '').toLowerCase()
      if (txt.includes('bono social')) {
        detected = true
        const monto = Math.abs(Number(c.total ?? 0))
        if (monto > 0) discount += monto
      }
    }
  }
  return { has: detected, discount }
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { supplyId: string } },
) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supplyId = params.supplyId
    if (!supplyId) return NextResponse.json({ error: 'supplyId required' }, { status: 400 })

    // 1) Supply + cliente + consumption_data (potencias, consumos, maxímetros)
    const { data: supply, error: supErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, name, consumption_data, client_id,
        client:clients(id, name, alias, cif, nif, cif_nif)
      `)
      .eq('id', supplyId)
      .single()

    if (supErr || !supply) {
      return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
    }
    if (supply.type === 'gas') {
      return NextResponse.json({ error: 'Comparativa Gana 2.0TD aplica solo a luz' }, { status: 400 })
    }

    // 2) Última factura con economics
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, period_start, period_end, extracted_data, total_amount, created_at')
      .eq('supply_id', supplyId)
      .order('period_end', { ascending: false, nullsFirst: false })
      .limit(10)

    const recentInvoice = (invoices ?? []).find(inv => {
      const eco = (inv.extracted_data as any)?.economics
      return eco && (Array.isArray(eco.consumo) || Array.isArray(eco.potencia))
    })
    const eco = (recentInvoice?.extracted_data as any)?.economics ?? null

    // 3) SIPS / consumption_data
    const consData = (supply.consumption_data as any) ?? {}
    const potSrc = consData.potenciaContratada ?? {}
    const consSrc = consData.consumoPeriodos ?? {}
    const maxSrc = consData.potenciaMaxDemandada ?? consData.maximetros ?? {}

    const potenciaP1 = Number(potSrc.P1 ?? potSrc.p1 ?? 0)
    const potenciaP2Raw = Number(potSrc.P2 ?? potSrc.p2 ?? 0)
    const potenciaP3 = Number(potSrc.P3 ?? potSrc.p3 ?? 0)
    const potenciaP2 = potenciaP3 > 0.1 && potenciaP2Raw < 0.5 ? potenciaP3 : potenciaP2Raw

    let consumoP1 = Number(consSrc.P1 ?? consSrc.p1 ?? 0)
    let consumoP2 = Number(consSrc.P2 ?? consSrc.p2 ?? 0)
    let consumoP3 = Number(consSrc.P3 ?? consSrc.p3 ?? 0)

    // Fallback al desglose factura si SIPS está vacío
    if (consumoP1 === 0 && consumoP2 === 0 && consumoP3 === 0 && eco) {
      const fromInvoice = extractConsumoFromInvoice(eco.consumo)
      const dias = Number(eco.diasFacturados ?? 30)
      // Extrapolar a 365 días
      const factor = dias > 0 ? 365 / dias : 12
      consumoP1 = fromInvoice.P1 * factor
      consumoP2 = fromInvoice.P2 * factor
      consumoP3 = fromInvoice.P3 * factor
    }

    // Si todo sigue vacío y tenemos consumo total, reparto Commer 25/25/50
    if (consumoP1 === 0 && consumoP2 === 0 && consumoP3 === 0) {
      const totalAnual = Number(consData.consumoAnualKwh ?? eco?.consumoTotalKwh ?? 0)
      if (totalAnual > 0) {
        consumoP1 = totalAnual * 0.25
        consumoP2 = totalAnual * 0.25
        consumoP3 = totalAnual * 0.50
      }
    }

    // Potencia máx demandada — para optimización
    const potenciaMaxDemandadaKw = Math.max(
      Number(maxSrc.P1 ?? maxSrc.p1 ?? maxSrc.max ?? 0),
      Number(maxSrc.P2 ?? maxSrc.p2 ?? 0),
      Number(consData.maxDemandedKw ?? 0),
    )

    // 4) Precios actuales factura
    const energiaActual = extractPriceByPeriod(eco?.consumo, 'precioKwh')
    const potenciaActual = extractPriceByPeriod(eco?.potencia, 'precioKwDia')

    // Importe factura + días para extrapolación
    const totalBillAmount = Number(recentInvoice?.total_amount ?? eco?.totalFactura ?? 0)
    const diasFacturados = Number(eco?.diasFacturados ?? 0) || (() => {
      if (recentInvoice?.period_start && recentInvoice?.period_end) {
        const ms = new Date(recentInvoice.period_end).getTime() - new Date(recentInvoice.period_start).getTime()
        return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)))
      }
      return 30
    })()

    // 5) Bono social + cargos fijos
    const fees = eco ? detectFixedFees(eco) : { monthly: 0, concepts: [] }
    const bono = eco ? detectBonoSocial(eco) : { has: false, discount: 0 }

    // 6) Tarifas Gana vigentes
    const { data: tarifas } = await supabase
      .from('gana_tarifas')
      .select('id, nombre, tipo, precio_p1, precio_p2, precio_p3, potencia_p1, potencia_p2, extras_anuales')
      .eq('vigente', true)
      .eq('tarifa_atr', '2.0TD')

    const scenarios = buildScenariosFromTarifas((tarifas ?? []) as GanaTarifaRow[])

    if (scenarios.length === 0) {
      return NextResponse.json({
        error: 'No hay tarifas Gana vigentes. Un admin debe ejecutar POST /api/gana/refresh-tarifas.',
      }, { status: 412 })
    }

    // 7) Calcular
    const input: InputComparativa2td = {
      consumoP1,
      consumoP2,
      consumoP3,
      potenciaP1,
      potenciaP2,
      currentEnergyP1: energiaActual.P1,
      currentEnergyP2: energiaActual.P2,
      currentEnergyP3: energiaActual.P3,
      currentPowerP1: potenciaActual.P1,
      currentPowerP2: potenciaActual.P2 || potenciaActual.P3,
      totalBillAmount: totalBillAmount || undefined,
      diasFacturados: diasFacturados || undefined,
      hasBonoSocial: bono.has,
      bonoSocialDiscount: bono.discount,
      potenciaMaxDemandadaKw: potenciaMaxDemandadaKw || undefined,
      fixedFeesMonthly: fees.monthly || undefined,
    }

    const result = computarComparativaGana({ input, scenarios })

    const clientRel = Array.isArray(supply.client) ? supply.client[0] : supply.client

    return NextResponse.json({
      supply: {
        id: supply.id,
        cups: supply.cups,
        tariff: supply.tariff,
        name: supply.name,
        client_id: supply.client_id,
        client_name: clientRel?.alias || clientRel?.name || null,
        client_cif: clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null,
      },
      input,
      feesInfo: fees,
      bonoInfo: bono,
      lastInvoiceId: recentInvoice?.id ?? null,
      lastInvoicePeriod: recentInvoice
        ? { start: recentInvoice.period_start, end: recentInvoice.period_end }
        : null,
      result,
      tarifas,
    })
  } catch (e: any) {
    console.error('[GET /api/gana/comparativa/[supplyId]]', e)
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 })
  }
}
