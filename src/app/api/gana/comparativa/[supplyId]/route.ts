/**
 * GET /api/gana/comparativa/[supplyId]
 *
 * Carga TODAS las facturas del supply (no solo la última) y las pasa al motor
 * multi-factura. Permite detectar tarifa indexada por keywords + variabilidad
 * y promediar precios por kWh entre facturas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  computarComparativaGanaMulti,
  buildScenariosFromTarifas,
  type GanaTarifaRow,
  type BillSample,
} from '@/lib/comparativa-2td-gana'

export const runtime = 'nodejs'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getByPeriod(items: any[] | undefined, period: 'P1' | 'P2' | 'P3', key: string): number | undefined {
  if (!Array.isArray(items)) return undefined
  for (const it of items) {
    const per = String(it.periodo || '').toUpperCase().replace(/[^P1-9]/g, '')
    if (per !== period) continue
    const v = Number(it[key] ?? 0)
    if (isFinite(v) && v > 0) return v
  }
  return undefined
}

function detectFixedFees(eco: any): number {
  if (!eco?.otrosConceptos || !Array.isArray(eco.otrosConceptos)) return 0
  const KEYWORDS = [
    'smart', 'mantenimiento', 'seguro', 'protec', 'cobertura', 'asistencia',
    'plus', 'club', 'tranquilidad', 'happy', 'plan ', 'servicio',
  ]
  let total = 0
  for (const c of eco.otrosConceptos) {
    const txt = String(c.concepto ?? '').toLowerCase()
    const monto = Number(c.total ?? 0)
    if (!isFinite(monto) || monto <= 0) continue
    if (KEYWORDS.some(kw => txt.includes(kw))) total += monto
  }
  const dias = Number(eco.diasFacturados ?? 30)
  return dias > 0 ? (total / dias) * 30 : total
}

function detectBonoSocial(eco: any): { has: boolean; discount: number } {
  let discount = 0, detected = false
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

/**
 * Construye un BillSample a partir de una invoice con extracted_data.economics.
 */
function buildBillFromInvoice(inv: any): BillSample | null {
  const eco = (inv?.extracted_data as any)?.economics
  if (!eco) return null

  const dias = Number(eco.diasFacturados ?? 0) || (() => {
    if (inv.period_start && inv.period_end) {
      const ms = new Date(inv.period_end).getTime() - new Date(inv.period_start).getTime()
      return Math.max(1, Math.round(ms / 86400000))
    }
    return 30
  })()

  const bono = detectBonoSocial(eco)

  return {
    invoiceId: inv.id,
    fechaInicio: eco.fechaInicio ?? inv.period_start,
    fechaFin: eco.fechaFin ?? inv.period_end,
    diasFacturados: dias,
    totalFactura: Number(eco.totalFactura ?? inv.total_amount ?? 0) || undefined,
    comercializadora: String(eco.comercializadora || inv.extracted_data?.comercializadora || ''),
    tarifa: String(eco.tarifa || inv.extracted_data?.tariff || ''),
    kwhP1: getByPeriod(eco.consumo, 'P1', 'kwh'),
    kwhP2: getByPeriod(eco.consumo, 'P2', 'kwh'),
    kwhP3: getByPeriod(eco.consumo, 'P3', 'kwh'),
    energyP1: getByPeriod(eco.consumo, 'P1', 'precioKwh'),
    energyP2: getByPeriod(eco.consumo, 'P2', 'precioKwh'),
    energyP3: getByPeriod(eco.consumo, 'P3', 'precioKwh'),
    powerP1: getByPeriod(eco.potencia, 'P1', 'precioKwDia'),
    powerP2: getByPeriod(eco.potencia, 'P2', 'precioKwDia'),
    hasBonoSocial: bono.has,
    bonoSocialDiscount: bono.discount,
    fixedFeesMonthly: detectFixedFees(eco),
  }
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

    // 1) Supply
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

    // 2) TODAS las facturas con economics
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, period_start, period_end, extracted_data, total_amount, created_at')
      .eq('supply_id', supplyId)
      .order('period_end', { ascending: false, nullsFirst: false })
      .limit(24)   // máximo 2 años por si acaso

    const bills: BillSample[] = []
    for (const inv of invoices ?? []) {
      const b = buildBillFromInvoice(inv)
      if (b) bills.push(b)
    }

    // 3) SIPS para potencia y consumo anual
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

    // Fallback: sumar todas las facturas y extrapolar a 365
    if (consumoP1 === 0 && consumoP2 === 0 && consumoP3 === 0 && bills.length > 0) {
      const totalDays = bills.reduce((a, b) => a + (b.diasFacturados ?? 0), 0)
      const sumP1 = bills.reduce((a, b) => a + (b.kwhP1 ?? 0), 0)
      const sumP2 = bills.reduce((a, b) => a + (b.kwhP2 ?? 0), 0)
      const sumP3 = bills.reduce((a, b) => a + (b.kwhP3 ?? 0), 0)
      if (totalDays > 0) {
        const factor = 365 / totalDays
        consumoP1 = sumP1 * factor
        consumoP2 = sumP2 * factor
        consumoP3 = sumP3 * factor
      }
    }

    // Si aún 0 → reparto Commer 25/25/50 desde consumoAnualKwh
    if (consumoP1 === 0 && consumoP2 === 0 && consumoP3 === 0) {
      const totalAnual = Number(consData.consumoAnualKwh ?? 0)
      if (totalAnual > 0) {
        consumoP1 = totalAnual * 0.25
        consumoP2 = totalAnual * 0.25
        consumoP3 = totalAnual * 0.50
      }
    }

    const potenciaMaxDemandadaKw = Math.max(
      Number(maxSrc.P1 ?? maxSrc.p1 ?? maxSrc.max ?? 0),
      Number(maxSrc.P2 ?? maxSrc.p2 ?? 0),
      Number(consData.maxDemandedKw ?? 0),
    )

    // 4) Tarifas Gana
    const { data: tarifas } = await supabase
      .from('gana_tarifas')
      .select('id, nombre, tipo, precio_p1, precio_p2, precio_p3, potencia_p1, potencia_p2, extras_anuales')
      .eq('vigente', true)
      .eq('tarifa_atr', '2.0TD')

    const scenarios = buildScenariosFromTarifas((tarifas ?? []) as GanaTarifaRow[])
    if (scenarios.length === 0) {
      return NextResponse.json({
        error: 'No hay tarifas Gana vigentes. Ejecuta POST /api/gana/refresh-tarifas o carga las tarifas manualmente.',
      }, { status: 412 })
    }

    // 5) Calcular multi-factura
    const result = computarComparativaGanaMulti({
      potenciaP1, potenciaP2,
      consumoP1, consumoP2, consumoP3,
      bills,
      scenarios,
      potenciaMaxDemandadaKw: potenciaMaxDemandadaKw || undefined,
    })

    const clientRel = Array.isArray(supply.client) ? supply.client[0] : supply.client

    return NextResponse.json({
      supply: {
        id: supply.id, cups: supply.cups, tariff: supply.tariff, name: supply.name,
        client_id: supply.client_id,
        client_name: clientRel?.alias || clientRel?.name || null,
        client_cif: clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null,
      },
      // Datos editables que la UI usa para "recalcular"
      input: {
        potenciaP1, potenciaP2,
        consumoP1, consumoP2, consumoP3,
        currentEnergyP1: result.priceAnalysis?.tariffNature === 'fija'
          ? (result.priceAnalysis.energyP1?.median ?? 0)
          : (result.priceAnalysis?.energyP1?.weightedMean ?? 0),
        currentEnergyP2: result.priceAnalysis?.tariffNature === 'fija'
          ? (result.priceAnalysis.energyP2?.median ?? 0)
          : (result.priceAnalysis?.energyP2?.weightedMean ?? 0),
        currentEnergyP3: result.priceAnalysis?.tariffNature === 'fija'
          ? (result.priceAnalysis.energyP3?.median ?? 0)
          : (result.priceAnalysis?.energyP3?.weightedMean ?? 0),
        currentPowerP1: result.priceAnalysis?.powerP1?.weightedMean ?? 0,
        currentPowerP2: result.priceAnalysis?.powerP2?.weightedMean ?? 0,
        totalBillAmount: result.priceAnalysis?.totalAmount,
        diasFacturados: result.priceAnalysis?.totalDays,
        potenciaMaxDemandadaKw: potenciaMaxDemandadaKw || undefined,
      },
      result,
      bills,
      tarifas,
    })
  } catch (e: any) {
    console.error('[GET /api/gana/comparativa/[supplyId]]', e)
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 })
  }
}
