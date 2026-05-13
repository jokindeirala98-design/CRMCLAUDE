/**
 * src/lib/economic-overview.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Agregador económico global a nivel CLIENTE. Suma facturas históricas
 * (source = 'historica') de TODOS los suministros del cliente y produce:
 *
 *   - KPIs principales (gasto total, kWh totales, €/kWh medio, nº suministros)
 *   - Ranking por suministro con su gasto/consumo en la ventana
 *   - Serie mensual (gasto por mes, separando luz vs gas)
 *   - Distribución por tipo (luz/gas) y por tarifa
 *
 * Modos de periodo:
 *   - 'last12': las 12 facturas más recientes de cada suministro (rolling).
 *     Cada suministro puede tener una ventana temporal distinta.
 *   - 'previous_year': solo facturas cuyo period_end cae en el año natural
 *     anterior (si estamos en 2026 → todas las del 2025).
 *   - 'custom': rango from..to en formato YYYY-MM-DD.
 *
 * Solo facturas con `source = 'historica'`. Las Voltis no se incluyen.
 */

import type { BillEconomics, InvoiceRow } from '@/components/supply/AnnualEconomics'
import { getEco, parseDate, getAssignedMonth } from '@/lib/comparativa-energetica'

// ── Tipos ──────────────────────────────────────────────────────────────────

export type OverviewMode = 'last12' | 'previous_year' | 'custom'

export interface OverviewSupply {
  id: string
  cups: string | null
  type: 'luz' | 'gas' | null
  tariff: string | null
  name: string | null
  address: string | null
  comercializadora: string | null
  /** Consumo anual autoritativo (SIPS para luz, Excel ConsumoAnual para gas).
   *  Es independiente de las facturas: cuando se carga el supply, este campo
   *  refleja el dato del distribuidor. Sumas globales y €/kWh se calculan
   *  contra este valor, no contra el consumo extraído de facturas. */
  consumoAnualKwh: number
}

export interface OverviewInvoiceLite {
  id: string
  supply_id: string
  source: 'historica' | 'voltis'
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  extracted_data: any
}

export interface OverviewInputs {
  supplies: OverviewSupply[]
  invoices: OverviewInvoiceLite[]
  mode: OverviewMode
  from?: string  // YYYY-MM-DD (custom)
  to?: string    // YYYY-MM-DD (custom)
  typeFilter?: 'luz' | 'gas' | 'all'
}

export interface SupplyAggregate {
  supply: OverviewSupply
  invoicesCount: number
  windowFrom: string | null  // primera fecha facturada incluida (YYYY-MM-DD)
  windowTo: string | null    // última fecha facturada incluida
  consumoAnualKwh: number    // ← SIPS/Excel (fuente autoritativa)
  totalGasto: number         // ← Σ total_amount de las facturas del periodo
  eurPorKwh: number          // gasto / consumoAnualKwh
  /** True si el supply no tiene facturas en el periodo seleccionado */
  sinFacturas: boolean
}

export interface MonthlyAggregate {
  year: number
  month: number  // 0–11
  totalLuz: number
  totalGas: number
  total: number
  kwhLuz: number
  kwhGas: number
  invoicesCount: number
}

export interface OverviewResult {
  mode: OverviewMode
  windowDescription: string  // texto humano del rango cubierto
  typeFilter: 'luz' | 'gas' | 'all'
  totals: {
    /** Σ total_amount de las facturas del periodo (gasto realmente pagado). */
    gastoTotal: number
    /** Σ supply.consumoAnualKwh (SIPS luz + Excel gas). Independiente del modo. */
    consumoTotalKwh: number
    /** gastoTotal / consumoTotalKwh. */
    eurPorKwhMedio: number
    /** Nº TOTAL de suministros del cliente (filtrados por tipo si aplica). */
    suministrosCount: number
    /** Nº de suministros con al menos 1 factura en el periodo (subconjunto). */
    suministrosConFacturas: number
    /** Nº total de facturas incluidas. */
    invoicesCount: number
    porTipo: {
      luz: { gasto: number; consumoAnualKwh: number; suministros: number }
      gas: { gasto: number; consumoAnualKwh: number; suministros: number }
    }
  }
  ranking: SupplyAggregate[]  // ordenado por gasto descendente (luego por consumo)
  monthly: MonthlyAggregate[] // ordenado cronológicamente
  porTarifa: Array<{ tarifa: string; suministros: number; gasto: number; consumoAnualKwh: number }>
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Total de la factura: preferir extracted_data.economics.totalFactura,
 *  fallback a invoices.total_amount. */
function getInvoiceTotal(inv: OverviewInvoiceLite): number {
  const eco = inv.extracted_data?.economics
  if (eco?.totalFactura && Number(eco.totalFactura) > 0) return Number(eco.totalFactura)
  if (inv.total_amount && Number(inv.total_amount) > 0) return Number(inv.total_amount)
  return 0
}

function getInvoiceKwh(inv: OverviewInvoiceLite): number {
  const eco = inv.extracted_data?.economics as BillEconomics | undefined
  if (!eco) return 0
  // Preferimos sumar el array consumo[] cuando tenga datos: es el desglose
  // por periodos extraído del cuerpo de la factura y es la fuente más fiable.
  // El campo consumoTotalKwh a veces el extractor lo confunde con un
  // "consumo acumulado anual" mostrado al final de la factura, lo cual
  // sobrestima brutalmente cuando se suma a lo largo del año.
  const sumaArr = (eco.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
  if (sumaArr > 0) return sumaArr
  if (Number(eco.consumoTotalKwh) > 0) return Number(eco.consumoTotalKwh)
  return 0
}

/** Filtra una lista de facturas a las 12 más recientes por period_end. */
function take12MostRecent(invs: OverviewInvoiceLite[]): OverviewInvoiceLite[] {
  return [...invs]
    .filter(i => i.period_end || i.period_start)
    .sort((a, b) => {
      const da = parseDate(a.period_end || a.period_start)?.getTime() || 0
      const db = parseDate(b.period_end || b.period_start)?.getTime() || 0
      return db - da
    })
    .slice(0, 12)
}

/** Filtra facturas cuyo period_end cae en el año `year`. */
function filterByYear(invs: OverviewInvoiceLite[], year: number): OverviewInvoiceLite[] {
  return invs.filter(i => {
    const d = parseDate(i.period_end || i.period_start)
    return d ? d.getFullYear() === year : false
  })
}

/** Filtra facturas cuyo period_end cae en [from, to]. */
function filterByRange(invs: OverviewInvoiceLite[], from: string, to: string): OverviewInvoiceLite[] {
  const f = parseDate(from)?.getTime() || 0
  const t = parseDate(to)?.getTime() || Number.MAX_SAFE_INTEGER
  return invs.filter(i => {
    const d = parseDate(i.period_end || i.period_start)?.getTime() || 0
    return d >= f && d <= t
  })
}

/**
 * Filtra facturas inservibles para una agregación económica:
 *
 *   1. Sin total facturado: el total_amount y el economics.totalFactura son
 *      nulos o 0. Estas facturas inflan el consumo pero no aportan al gasto,
 *      distorsionando el €/kWh medio.
 *
 *   2. Sin fechas de periodo: no se pueden ubicar temporalmente.
 *
 *   3. Con €/kWh < 0,015 (anómalo): es habitual que el extractor confunda
 *      el "consumo acumulado anual" mostrado al final de un PDF con el
 *      consumo del periodo facturado. Una factura mensual de gas que
 *      muestre 358.690 kWh con un total de 700 € da €/kWh = 0,002, que es
 *      imposible (el precio mínimo de gas regulado es ~0,03 €/kWh). Estas
 *      facturas se descartan: su kWh está claramente contaminado.
 *
 * Umbral 0,015 €/kWh: por debajo es físicamente imposible incluso para
 * tarifas reguladas más baratas. Por encima entran consumos correctos
 * incluso con tarifas excepcionales.
 */
function filtrarFacturasFiables(invs: OverviewInvoiceLite[]): OverviewInvoiceLite[] {
  return invs.filter(inv => {
    const total = getInvoiceTotal(inv)
    const hasPeriod = !!(inv.period_end || inv.period_start)
    if (total <= 0 || !hasPeriod) return false
    const kwh = getInvoiceKwh(inv)
    if (kwh > 0) {
      const eurPorKwh = total / kwh
      // < 0,015 €/kWh es imposible — kWh contaminado por consumo acumulado
      if (eurPorKwh < 0.015) return false
    }
    return true
  })
}

/**
 * Deduplica facturas del mismo suministro que cubren el MISMO MES NATURAL
 * (dominante). Si hay varias, se conserva la de mayor total_amount, asumiendo
 * que las otras son duplicados, rectificaciones o lecturas parciales que ya
 * están contenidas en la principal.
 *
 * Esto evita contar el mismo mes varias veces cuando el cliente sube la misma
 * factura repetida, hay facturas de ajuste o periodos solapados.
 */
function deduplicarPorMesNatural(invs: OverviewInvoiceLite[]): OverviewInvoiceLite[] {
  const porMes = new Map<string, OverviewInvoiceLite>()
  for (const inv of invs) {
    const am = getAssignedMonth(inv.period_start, inv.period_end)
    if (!am) continue
    const key = `${am.year}-${am.month}`
    const existing = porMes.get(key)
    if (!existing) {
      porMes.set(key, inv)
    } else {
      // Conservar la de mayor total
      if (getInvoiceTotal(inv) > getInvoiceTotal(existing)) {
        porMes.set(key, inv)
      }
    }
  }
  return Array.from(porMes.values())
}

/** Estructura de la factura que el motor consume (subset de InvoiceRow). */

/** Selecciona las facturas relevantes según modo, agrupando por supply_id. */
function selectInvoicesByMode(
  invoices: OverviewInvoiceLite[],
  mode: OverviewMode,
  opts: { from?: string; to?: string },
): Map<string, OverviewInvoiceLite[]> {
  // Solo historicas
  const hist = invoices.filter(i => (i.source || 'historica') === 'historica')

  // Agrupar por supply
  const bySupply = new Map<string, OverviewInvoiceLite[]>()
  for (const inv of hist) {
    if (!bySupply.has(inv.supply_id)) bySupply.set(inv.supply_id, [])
    bySupply.get(inv.supply_id)!.push(inv)
  }

  // Limpieza por suministro: facturas fiables (con total y periodo) y deduplicadas por mes natural
  const limpiado = new Map<string, OverviewInvoiceLite[]>()
  for (const [supId, invs] of bySupply.entries()) {
    const fiables = filtrarFacturasFiables(invs)
    limpiado.set(supId, deduplicarPorMesNatural(fiables))
  }

  // Aplicar criterio
  if (mode === 'last12') {
    const out = new Map<string, OverviewInvoiceLite[]>()
    for (const [supId, invs] of limpiado.entries()) {
      out.set(supId, take12MostRecent(invs))
    }
    return out
  }

  if (mode === 'previous_year') {
    const lastYear = new Date().getFullYear() - 1
    const out = new Map<string, OverviewInvoiceLite[]>()
    for (const [supId, invs] of limpiado.entries()) {
      out.set(supId, filterByYear(invs, lastYear))
    }
    return out
  }

  // custom
  if (!opts.from || !opts.to) {
    throw new Error('custom mode requires from/to dates')
  }
  const out = new Map<string, OverviewInvoiceLite[]>()
  for (const [supId, invs] of limpiado.entries()) {
    out.set(supId, filterByRange(invs, opts.from, opts.to))
  }
  return out
}

/** Suma los conceptos de una factura. */
function sumConceptos(invs: OverviewInvoiceLite[]) {
  let energia = 0, potencia = 0, excesos = 0, bono = 0, alquiler = 0, iee = 0, iva = 0
  let consumoKwh = 0, gasto = 0
  let windowFrom: Date | null = null, windowTo: Date | null = null

  for (const inv of invs) {
    const eco = inv.extracted_data?.economics as BillEconomics | undefined
    gasto += getInvoiceTotal(inv)
    consumoKwh += getInvoiceKwh(inv)

    if (eco) {
      energia += (eco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
      potencia += (eco.potencia || []).reduce((s, p) => s + (Number(p.total) || 0), 0)
      for (const o of eco.otrosConceptos || []) {
        const c = (o.concepto || '').toLowerCase()
        const t = Number(o.total) || 0
        if (c.includes('exceso') && c.includes('potencia')) excesos += t
        else if (c.includes('bono') && c.includes('social')) bono += t
        else if (c.includes('alquiler')) alquiler += t
        else if (c.includes('iee') || (c.includes('impuesto') && c.includes('elect'))) iee += t
        else if (c.includes('iva') || c.includes('igic')) iva += t
      }
      // Gas: IVA y conceptos vienen en gasPricing
      if (eco.gasPricing) {
        iva += Number(eco.gasPricing.ivaTotal) || 0
        alquiler += Number(eco.gasPricing.alquilerTotal) || 0
      }
    }

    const dStart = parseDate(inv.period_start)
    const dEnd = parseDate(inv.period_end)
    if (dStart && (!windowFrom || dStart < windowFrom)) windowFrom = dStart
    if (dEnd && (!windowTo || dEnd > windowTo)) windowTo = dEnd
  }

  return {
    energia, potencia, excesos, bono, alquiler, iee, iva,
    consumoKwh, gasto, windowFrom, windowTo,
  }
}

/** Formatea fecha a YYYY-MM-DD. */
function fmtIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

// ── Función principal ──────────────────────────────────────────────────────

export function computarOverview(inputs: OverviewInputs): OverviewResult {
  const { supplies, invoices, mode } = inputs
  const typeFilter = inputs.typeFilter || 'all'

  // 1. Aplicar filtro de tipo a la lista de supplies (INCLUYE TODOS)
  const suppliesFiltrados = typeFilter === 'all'
    ? supplies
    : supplies.filter(s => s.type === typeFilter)

  // 2. Seleccionar facturas por modo (deduplicadas y filtradas por fiabilidad)
  const invsBySupply = selectInvoicesByMode(invoices, mode, { from: inputs.from, to: inputs.to })

  // 3. Construir ranking — INCLUYE TODOS los supplies (también los sin facturas)
  const ranking: SupplyAggregate[] = []
  let suministrosConFacturas = 0
  let invoicesCount = 0
  let gastoTotal = 0
  // Consumo total: viene SIEMPRE de supply.consumoAnualKwh (SIPS luz, Excel gas).
  // Es independiente del modo elegido — es el consumo anual autoritativo.
  let consumoTotalKwh = 0
  let gastoLuz = 0, gastoGas = 0, kwhLuz = 0, kwhGas = 0
  const tarifaCounters = new Map<string, { suministros: Set<string>; gasto: number; consumoAnualKwh: number }>()
  const monthlyMap = new Map<string, { year: number; month: number; totalLuz: number; totalGas: number; kwhLuz: number; kwhGas: number; invoicesCount: number }>()

  for (const sup of suppliesFiltrados) {
    const consumoAnual = Number(sup.consumoAnualKwh) || 0
    consumoTotalKwh += consumoAnual
    if (sup.type === 'gas') kwhGas += consumoAnual
    else kwhLuz += consumoAnual

    const invs = invsBySupply.get(sup.id) || []
    let gastoSup = 0
    let windowFrom: Date | null = null, windowTo: Date | null = null

    if (invs.length > 0) {
      suministrosConFacturas++
      invoicesCount += invs.length
      for (const inv of invs) {
        gastoSup += getInvoiceTotal(inv)
        const dStart = parseDate(inv.period_start)
        const dEnd = parseDate(inv.period_end)
        if (dStart && (!windowFrom || dStart < windowFrom)) windowFrom = dStart
        if (dEnd && (!windowTo || dEnd > windowTo)) windowTo = dEnd

        // Serie mensual
        const am = getAssignedMonth(inv.period_start, inv.period_end)
        if (am) {
          const key = `${am.year}-${am.month}`
          if (!monthlyMap.has(key)) {
            monthlyMap.set(key, { year: am.year, month: am.month, totalLuz: 0, totalGas: 0, kwhLuz: 0, kwhGas: 0, invoicesCount: 0 })
          }
          const m = monthlyMap.get(key)!
          const total = getInvoiceTotal(inv)
          const kwh = getInvoiceKwh(inv)
          if (sup.type === 'gas') { m.totalGas += total; m.kwhGas += kwh }
          else { m.totalLuz += total; m.kwhLuz += kwh }
          m.invoicesCount += 1
        }
      }
      gastoTotal += gastoSup
      if (sup.type === 'gas') gastoGas += gastoSup
      else gastoLuz += gastoSup
    }

    // Tarifa
    const tarifaKey = sup.tariff || 'Sin tarifa'
    if (!tarifaCounters.has(tarifaKey)) tarifaCounters.set(tarifaKey, { suministros: new Set(), gasto: 0, consumoAnualKwh: 0 })
    const tc = tarifaCounters.get(tarifaKey)!
    tc.suministros.add(sup.id)
    tc.gasto += gastoSup
    tc.consumoAnualKwh += consumoAnual

    ranking.push({
      supply: sup,
      invoicesCount: invs.length,
      windowFrom: fmtIso(windowFrom),
      windowTo: fmtIso(windowTo),
      consumoAnualKwh: consumoAnual,
      totalGasto: gastoSup,
      eurPorKwh: consumoAnual > 0 ? gastoSup / consumoAnual : 0,
      sinFacturas: invs.length === 0,
    })
  }

  // Orden: ranking por gasto descendente, luego por consumo
  ranking.sort((a, b) => {
    if (b.totalGasto !== a.totalGasto) return b.totalGasto - a.totalGasto
    return b.consumoAnualKwh - a.consumoAnualKwh
  })
  const monthly = Array.from(monthlyMap.values())
    .map(m => ({ ...m, total: m.totalLuz + m.totalGas }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))

  const porTarifa = Array.from(tarifaCounters.entries()).map(([tarifa, info]) => ({
    tarifa,
    suministros: info.suministros.size,
    gasto: info.gasto,
    consumoAnualKwh: info.consumoAnualKwh,
  })).sort((a, b) => b.gasto - a.gasto)

  // Descripción humana del rango
  let windowDescription = ''
  if (mode === 'last12') windowDescription = 'Últimas 12 facturas de cada suministro'
  else if (mode === 'previous_year') windowDescription = `Año natural ${new Date().getFullYear() - 1}`
  else if (mode === 'custom' && inputs.from && inputs.to) windowDescription = `${inputs.from} → ${inputs.to}`

  return {
    mode,
    windowDescription,
    typeFilter,
    totals: {
      gastoTotal,
      consumoTotalKwh,
      eurPorKwhMedio: consumoTotalKwh > 0 ? gastoTotal / consumoTotalKwh : 0,
      suministrosCount: suppliesFiltrados.length,
      suministrosConFacturas,
      invoicesCount,
      porTipo: {
        luz: { gasto: gastoLuz, consumoAnualKwh: kwhLuz, suministros: suppliesFiltrados.filter(s => s.type !== 'gas').length },
        gas: { gasto: gastoGas, consumoAnualKwh: kwhGas, suministros: suppliesFiltrados.filter(s => s.type === 'gas').length },
      },
    },
    ranking,
    monthly,
    porTarifa,
  }
}
