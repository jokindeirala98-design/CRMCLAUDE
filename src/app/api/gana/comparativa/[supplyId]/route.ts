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

/**
 * Lee precios de POTENCIA normalizando P1+P3 → P1+P2 (lo que aparece en
 * facturas 2.0TD que numeran la potencia valle como P3 en lugar de P2).
 *
 * Reglas:
 *  - Si la factura tiene P1 y P2 → devolver tal cual
 *  - Si la factura tiene P1 y P3 (sin P2) → tratar P3 como P2 (valle)
 *  - Si solo tiene P1 → devolver P1 también como P2
 */
function getPowerNormalized(items: any[] | undefined, period: 'P1' | 'P2', key: string): number | undefined {
  if (!Array.isArray(items)) return undefined
  const p1 = getByPeriod(items, 'P1', key)
  if (period === 'P1') return p1
  // period === 'P2': busca P2, si no encuentra busca P3, si tampoco usa P1
  const p2 = getByPeriod(items, 'P2', key)
  if (p2 !== undefined) return p2
  const p3 = getByPeriod(items, 'P3', key)
  if (p3 !== undefined) return p3
  return p1
}

/**
 * Igual que getPowerNormalized pero para kW contratados (no precios).
 */
function getPowerKwNormalized(items: any[] | undefined, period: 'P1' | 'P2'): number | undefined {
  return getPowerNormalized(items, period, 'kw')
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

/**
 * Detecta Bono Social REAL del titular (no la financiación que pagan todos).
 *
 * Reglas:
 *  - El cargo "Financiación bono social" / "Cofinanciación bono social" SIEMPRE
 *    aparece en TODAS las facturas eléctricas españolas (lo pagan todos
 *    los consumidores). Debe IGNORARSE.
 *  - Solo se marca bono social al titular cuando el concepto indica
 *    descuento aplicado o tarifa social/TUR:
 *      "Descuento bono social", "Bono social aplicado", "TUR", "Tarifa social",
 *      "Tarifa de último recurso", o cualquier "bono social" con importe
 *      NEGATIVO (descuento).
 *  - Empresas (CIF que empieza por A, B, C, D, E, F, G, J, P, Q, R, S, U, V, N)
 *    NO pueden tener bono social: descartar siempre.
 */
function detectBonoSocial(eco: any, clientCif?: string | null): { has: boolean; discount: number } {
  // Guard 1: empresas no tienen bono social
  if (clientCif) {
    const firstLetter = clientCif.trim().charAt(0).toUpperCase()
    if ('ABCDEFGHJPQRSUVN'.includes(firstLetter)) {
      return { has: false, discount: 0 }
    }
  }

  if (!eco?.otrosConceptos || !Array.isArray(eco.otrosConceptos)) {
    return { has: false, discount: 0 }
  }

  // Palabras que descartan: estos conceptos son cargos comunes (todos pagan)
  const FALSE_POSITIVE = ['financiación bono', 'financiacion bono', 'cofinanc', 'aportación bono']
  // Palabras que confirman: descuento real al titular
  const TRUE_POSITIVE = [
    'descuento bono', 'bono social aplicado', 'tarifa social',
    'tarifa de último recurso', 'tarifa ultimo recurso', 'tur ',
    'bono social tur',
  ]

  let discount = 0
  let detected = false
  for (const c of eco.otrosConceptos) {
    const txt = String(c.concepto ?? '').toLowerCase()
    const monto = Number(c.total ?? 0)
    if (!isFinite(monto)) continue
    // Es bono social aplicado al titular si:
    //   a) coincide con alguno de los términos TRUE_POSITIVE
    //   b) o contiene "bono social" Y el monto es NEGATIVO (descuento)
    const isFalsePositive = FALSE_POSITIVE.some(kw => txt.includes(kw))
    const isTruePositive = TRUE_POSITIVE.some(kw => txt.includes(kw))
    const isNegativeBonoLine = txt.includes('bono social') && monto < -0.01

    if (isFalsePositive && !isTruePositive && !isNegativeBonoLine) continue
    if (isTruePositive || isNegativeBonoLine) {
      detected = true
      discount += Math.abs(monto)
    }
  }
  return { has: detected, discount }
}

/**
 * Construye un BillSample a partir de una invoice con extracted_data.economics.
 */
function buildBillFromInvoice(inv: any, clientCif?: string | null): BillSample | null {
  const eco = (inv?.extracted_data as any)?.economics
  if (!eco) return null

  const dias = Number(eco.diasFacturados ?? 0) || (() => {
    if (inv.period_start && inv.period_end) {
      const ms = new Date(inv.period_end).getTime() - new Date(inv.period_start).getTime()
      return Math.max(1, Math.round(ms / 86400000))
    }
    return 30
  })()

  const bono = detectBonoSocial(eco, clientCif)

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
    powerP1: getPowerNormalized(eco.potencia, 'P1', 'precioKwDia'),
    powerP2: getPowerNormalized(eco.potencia, 'P2', 'precioKwDia'),
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

    // CIF del cliente para evitar falsos positivos de bono social en empresas
    const clientRel = Array.isArray(supply.client) ? supply.client[0] : supply.client
    const clientCif = clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null

    // 2) TODAS las facturas con economics
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, period_start, period_end, extracted_data, total_amount, created_at')
      .eq('supply_id', supplyId)
      .order('period_end', { ascending: false, nullsFirst: false })
      .limit(24)

    const bills: BillSample[] = []
    for (const inv of invoices ?? []) {
      const b = buildBillFromInvoice(inv, clientCif)
      if (b) bills.push(b)
    }

    // 3) SIPS para potencia y consumo anual
    const consData = (supply.consumption_data as any) ?? {}
    const potSrc = consData.potenciaContratada ?? {}
    const consSrc = consData.consumoPeriodos ?? {}
    const maxSrc = consData.potenciaMaxDemandada ?? consData.maximetros ?? {}

    // Potencia contratada SIPS — normalizar P1/P2/P3 a P1+P2 para 2.0TD
    // (en 2.0 solo hay 2 periodos de potencia; SIPS a veces los etiqueta P1+P3)
    const potenciaP1 = Number(potSrc.P1 ?? potSrc.p1 ?? 0)
    const potenciaP2Raw = Number(potSrc.P2 ?? potSrc.p2 ?? 0)
    const potenciaP3 = Number(potSrc.P3 ?? potSrc.p3 ?? 0)
    // Si P2 está vacío o es artefacto (<0.5 kW) y P3 tiene un valor real
    // (>0.1 kW), usar P3 como P2 (valle).
    const potenciaP2 = (potenciaP2Raw < 0.5 && potenciaP3 > 0.1) ? potenciaP3 : (potenciaP2Raw || potenciaP3 || potenciaP1)

    // Fallback adicional: si SIPS está vacío pero las facturas traen kW,
    // tomarlo del array de potencia de la última factura.
    let finalPotenciaP1 = potenciaP1
    let finalPotenciaP2 = potenciaP2
    if (finalPotenciaP1 === 0 && finalPotenciaP2 === 0) {
      const lastEco = (invoices?.[0]?.extracted_data as any)?.economics
      if (lastEco?.potencia) {
        finalPotenciaP1 = getPowerKwNormalized(lastEco.potencia, 'P1') ?? 0
        finalPotenciaP2 = getPowerKwNormalized(lastEco.potencia, 'P2') ?? 0
      }
    }

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
      potenciaP1: finalPotenciaP1,
      potenciaP2: finalPotenciaP2,
      consumoP1, consumoP2, consumoP3,
      bills,
      scenarios,
      potenciaMaxDemandadaKw: potenciaMaxDemandadaKw || undefined,
    })

    return NextResponse.json({
      supply: {
        id: supply.id, cups: supply.cups, tariff: supply.tariff, name: supply.name,
        client_id: supply.client_id,
        client_name: clientRel?.alias || clientRel?.name || null,
        client_cif: clientCif,
      },
      // Datos editables que la UI usa para "recalcular"
      input: {
        potenciaP1: finalPotenciaP1,
        potenciaP2: finalPotenciaP2,
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
