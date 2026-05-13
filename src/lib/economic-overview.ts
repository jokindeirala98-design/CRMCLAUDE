/**
 * src/lib/economic-overview.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Motor del Estudio Económico Global a nivel CLIENTE.
 *
 * Filosofía:
 *   - CONSUMO ANUAL viene SIEMPRE del distribuidor (fuente autoritativa):
 *     SIPS Greening para luz, Excel ConsumoAnual para gas.
 *   - GASTO viene SIEMPRE de la suma directa de total_amount de las facturas
 *     históricas seleccionadas según modo. Verificable a mano.
 *   - €/kWh se calcula SEPARADO por tipo (luz vs gas) — mezclarlos es
 *     engañoso porque luz comercial está en 0,15 y gas en 0,07.
 *   - Se incluyen TODOS los suministros del cliente, incluso los sin
 *     facturas (marcados explícitamente).
 *   - Filtros defensivos por FACTURA (no por supply): una factura mal
 *     extraída se descarta, pero el supply sigue participando.
 *
 * Modos de periodo:
 *   - 'last12':       12 facturas más recientes de cada suministro (rolling)
 *   - 'previous_year': year_anterior natural
 *   - 'custom':       rango from..to
 *
 * Solo se usan facturas source='historica' (no Voltis).
 */

import type { BillEconomics, InvoiceRow } from '@/components/supply/AnnualEconomics'
import { parseDate, getAssignedMonth } from '@/lib/comparativa-energetica'

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
  distribuidora: string | null
  consumoAnualKwh: number       // SIPS luz / Excel gas
  fechaSipsActualizado: string | null
  /** Potencia contratada (P1..P6) — para detectar oportunidad excesos */
  potenciaContratada: Record<string, number> | null
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
  from?: string
  to?: string
  typeFilter?: 'luz' | 'gas' | 'all'
}

// ── Estructuras de salida ──────────────────────────────────────────────────

export interface SupplyAggregate {
  supply: OverviewSupply
  invoicesCount: number
  mesesCubiertos: number      // facturas válidas / 12 normalizado
  windowFrom: string | null
  windowTo: string | null
  consumoAnualKwh: number
  consumoFacturadoKwh: number  // suma kWh de facturas extraídas
  totalGasto: number           // Σ total_amount
  totalEnergia: number         // Σ consumo[].total
  totalPotencia: number        // Σ potencia[].total (luz)
  totalExcesos: number         // Σ otrosConceptos[excesos]
  totalReactiva: number        // Σ otrosConceptos[reactiva] (luz)
  totalIee: number
  totalIva: number
  eurPorKwh: number            // gasto anualizado / consumo
  /** kWh por periodo P1..P6 (solo luz, agregado de facturas) */
  consumoPorPeriodo: Record<string, number>
  /** Coste medio por periodo €/kWh (solo luz, agregado de facturas) */
  precioMedioPorPeriodo: Record<string, number>
  /** True si €/kWh está fuera de la banda normal (anomalía) */
  esAnomalo: boolean
  sinFacturas: boolean
}

export interface MonthlyAggregate {
  year: number
  month: number
  totalLuz: number
  totalGas: number
  total: number
  kwhLuz: number
  kwhGas: number
  invoicesCount: number
}

export interface OverviewResult {
  mode: OverviewMode
  windowDescription: string
  typeFilter: 'luz' | 'gas' | 'all'
  fechaSipsMasReciente: string | null  // dato más actual del cliente
  totals: {
    gastoTotal: number
    /** Gasto extrapolado a 12 meses si las facturas no cubren año completo */
    gastoAnualizado: number
    consumoTotalKwh: number          // SIPS luz + Excel gas (anual)
    consumoFacturadoTotalKwh: number // suma de facturas (puede ser < anual)
    coberturaFacturasPct: number     // facturado / anual × 100
    eurPorKwhMedio: number           // ⚠ mezclado: solo informativo
    suministrosCount: number          // TOTAL del cliente
    suministrosConFacturas: number
    suministrosSinConsumo: number    // SIPS = 0
    invoicesCount: number
    porTipo: {
      luz: {
        gasto: number
        gastoAnualizado: number
        consumoAnualKwh: number
        consumoFacturadoKwh: number
        suministros: number
        eurPorKwhMedio: number
        coberturaPct: number
        excesos: number
        reactiva: number
        consumoPorPeriodo: Record<string, number>  // P1..P6 agregado
        precioMedioPorPeriodo: Record<string, number>
      }
      gas: {
        gasto: number
        gastoAnualizado: number
        consumoAnualKwh: number
        consumoFacturadoKwh: number
        suministros: number
        eurPorKwhMedio: number
        coberturaPct: number
      }
    }
  }
  /** Top 5 mayores consumidores (por kWh anual) */
  topConsumidores: SupplyAggregate[]
  /** Top 5 mayores gastadores (por € en el periodo) */
  topGastadores: SupplyAggregate[]
  /** Suministros con €/kWh anómalo (>= 1 deviation estándar fuera de la media del tipo) */
  anomalias: SupplyAggregate[]
  ranking: SupplyAggregate[]
  monthly: MonthlyAggregate[]
  porTarifa: Array<{
    tarifa: string
    suministros: number
    gasto: number
    consumoAnualKwh: number
    eurPorKwh: number
  }>
  porDistribuidora: Array<{
    distribuidora: string
    suministros: number
    consumoAnualKwh: number
    gasto: number
  }>
  /** Concentración del consumo eléctrico por periodo (porcentajes) */
  concentracionPeriodos: {
    p1: number; p2: number; p3: number; p4: number; p5: number; p6: number
    dominante: string         // 'P6' por ejemplo
    dominantePct: number
  }
}

// ── Helpers de extracción de facturas ──────────────────────────────────────

function getInvoiceTotal(inv: OverviewInvoiceLite): number {
  const eco = inv.extracted_data?.economics
  if (eco?.totalFactura && Number(eco.totalFactura) > 0) return Number(eco.totalFactura)
  if (inv.total_amount && Number(inv.total_amount) > 0) return Number(inv.total_amount)
  return 0
}

function getInvoiceKwh(inv: OverviewInvoiceLite): number {
  const eco = inv.extracted_data?.economics as BillEconomics | undefined
  if (!eco) return 0
  const sumaArr = (eco.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
  if (sumaArr > 0) return sumaArr
  return Number(eco.consumoTotalKwh) || 0
}

function getInvoiceDays(inv: OverviewInvoiceLite): number {
  const s = parseDate(inv.period_start)
  const e = parseDate(inv.period_end)
  if (!s || !e) return 30
  const d = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
  return d > 0 ? d : 30
}

/**
 * ¿La factura es razonable o tiene un consumo claramente mal extraído?
 *   - Sin total facturado: no podemos atribuir gasto, descartar
 *   - Sin periodo: no se puede ubicar temporalmente
 *   - €/kWh < 0,015 €: imposible incluso para tarifa más barata regulada
 *
 * Filtro aplica POR FACTURA. Si un supply tiene 12 facturas y 2 son malas,
 * se quedan las 10 buenas. El supply sigue participando.
 */
function esFacturaFiable(inv: OverviewInvoiceLite): boolean {
  const total = getInvoiceTotal(inv)
  if (total <= 0) return false
  if (!inv.period_end && !inv.period_start) return false
  const kwh = getInvoiceKwh(inv)
  if (kwh > 0 && total / kwh < 0.015) return false
  return true
}

function fmtIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

// ── Conceptos económicos por categoría ─────────────────────────────────────

function esExcesoPot(c: string): boolean { return /exceso.*potencia/i.test(c) }
function esBono(c: string): boolean { return /bono.*social/i.test(c) }
function esAlquiler(c: string): boolean { return /alquiler/i.test(c) }
function esIee(c: string): boolean { return /(impuesto.*el[eé]ct|iee)/i.test(c) }
function esIva(c: string): boolean { return /iva|igic/i.test(c) }
function esReactiva(c: string): boolean { return /reactiva/i.test(c) }

function sumOtros(eco: BillEconomics | undefined, pred: (c: string) => boolean): number {
  if (!eco?.otrosConceptos) return 0
  return eco.otrosConceptos.filter(o => pred(o.concepto || '')).reduce((s, o) => s + (Number(o.total) || 0), 0)
}

// ── Selección de facturas por modo ─────────────────────────────────────────

function take12Recientes(invs: OverviewInvoiceLite[]): OverviewInvoiceLite[] {
  return [...invs]
    .filter(i => i.period_end || i.period_start)
    .sort((a, b) => {
      const da = parseDate(a.period_end || a.period_start)?.getTime() || 0
      const db = parseDate(b.period_end || b.period_start)?.getTime() || 0
      return db - da
    })
    .slice(0, 12)
}

function filtrarPorAnio(invs: OverviewInvoiceLite[], year: number): OverviewInvoiceLite[] {
  return invs.filter(i => {
    const d = parseDate(i.period_end || i.period_start)
    return d ? d.getFullYear() === year : false
  })
}

function filtrarPorRango(invs: OverviewInvoiceLite[], from: string, to: string): OverviewInvoiceLite[] {
  const f = parseDate(from)?.getTime() || 0
  const t = parseDate(to)?.getTime() || Number.MAX_SAFE_INTEGER
  return invs.filter(i => {
    const d = parseDate(i.period_end || i.period_start)?.getTime() || 0
    return d >= f && d <= t
  })
}

function dedupPorMes(invs: OverviewInvoiceLite[]): OverviewInvoiceLite[] {
  const porMes = new Map<string, OverviewInvoiceLite>()
  for (const inv of invs) {
    const am = getAssignedMonth(inv.period_start, inv.period_end)
    if (!am) continue
    const key = `${am.year}-${am.month}`
    const e = porMes.get(key)
    if (!e || getInvoiceTotal(inv) > getInvoiceTotal(e)) porMes.set(key, inv)
  }
  return Array.from(porMes.values())
}

function selectInvoicesByMode(
  invoices: OverviewInvoiceLite[],
  mode: OverviewMode,
  opts: { from?: string; to?: string },
): Map<string, OverviewInvoiceLite[]> {
  const hist = invoices.filter(i => (i.source || 'historica') === 'historica')

  const bySupply = new Map<string, OverviewInvoiceLite[]>()
  for (const inv of hist) {
    if (!esFacturaFiable(inv)) continue  // filtro POR FACTURA
    if (!bySupply.has(inv.supply_id)) bySupply.set(inv.supply_id, [])
    bySupply.get(inv.supply_id)!.push(inv)
  }

  const limpiado = new Map<string, OverviewInvoiceLite[]>()
  for (const [supId, invs] of bySupply.entries()) {
    limpiado.set(supId, dedupPorMes(invs))
  }

  if (mode === 'last12') {
    const out = new Map<string, OverviewInvoiceLite[]>()
    for (const [supId, invs] of limpiado.entries()) {
      out.set(supId, take12Recientes(invs))
    }
    return out
  }

  if (mode === 'previous_year') {
    const lastYear = new Date().getFullYear() - 1
    const out = new Map<string, OverviewInvoiceLite[]>()
    for (const [supId, invs] of limpiado.entries()) {
      out.set(supId, filtrarPorAnio(invs, lastYear))
    }
    return out
  }

  if (!opts.from || !opts.to) throw new Error('custom mode requires from/to dates')
  const out = new Map<string, OverviewInvoiceLite[]>()
  for (const [supId, invs] of limpiado.entries()) {
    out.set(supId, filtrarPorRango(invs, opts.from, opts.to))
  }
  return out
}

// ── Agregador por suministro ───────────────────────────────────────────────

function aggregateSupply(sup: OverviewSupply, invs: OverviewInvoiceLite[]): SupplyAggregate {
  let totalGasto = 0
  let consumoFacturado = 0
  let totalEnergia = 0
  let totalPotencia = 0
  let totalExcesos = 0
  let totalReactiva = 0
  let totalIee = 0
  let totalIva = 0
  let diasCubiertos = 0
  let windowFrom: Date | null = null, windowTo: Date | null = null
  const consumoPorPeriodo: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  const costePorPeriodo: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }

  for (const inv of invs) {
    totalGasto += getInvoiceTotal(inv)
    consumoFacturado += getInvoiceKwh(inv)
    diasCubiertos += getInvoiceDays(inv)
    const dStart = parseDate(inv.period_start)
    const dEnd = parseDate(inv.period_end)
    if (dStart && (!windowFrom || dStart < windowFrom)) windowFrom = dStart
    if (dEnd && (!windowTo || dEnd > windowTo)) windowTo = dEnd

    const eco = inv.extracted_data?.economics as BillEconomics | undefined
    if (!eco) continue

    totalEnergia += (eco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
    totalPotencia += (eco.potencia || []).reduce((s, p) => s + (Number(p.total) || 0), 0)
    totalExcesos += sumOtros(eco, esExcesoPot)
    totalReactiva += sumOtros(eco, esReactiva)
    totalIee += sumOtros(eco, esIee)
    totalIva += sumOtros(eco, esIva)

    for (const c of eco.consumo || []) {
      const p = (c.periodo || '').toUpperCase().trim()
      if (consumoPorPeriodo[p] !== undefined) {
        consumoPorPeriodo[p] += Number(c.kwh) || 0
        costePorPeriodo[p] += Number(c.total) || 0
      }
    }
  }

  const mesesCubiertos = Math.min(12, diasCubiertos / 30.4)
  // €/kWh: usamos consumo facturado (lo que realmente se consumió en el periodo
  // facturado) — no el anual SIPS. Si el supply cubre 8 meses, gasto y consumo
  // son ambos de 8 meses → ratio correcto.
  const eurPorKwh = consumoFacturado > 0 ? totalGasto / consumoFacturado : 0

  const precioMedioPorPeriodo: Record<string, number> = {}
  for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
    precioMedioPorPeriodo[p] = consumoPorPeriodo[p] > 0
      ? costePorPeriodo[p] / consumoPorPeriodo[p]
      : 0
  }

  return {
    supply: sup,
    invoicesCount: invs.length,
    mesesCubiertos,
    windowFrom: fmtIso(windowFrom),
    windowTo: fmtIso(windowTo),
    consumoAnualKwh: sup.consumoAnualKwh,
    consumoFacturadoKwh: consumoFacturado,
    totalGasto,
    totalEnergia,
    totalPotencia,
    totalExcesos,
    totalReactiva,
    totalIee,
    totalIva,
    eurPorKwh,
    consumoPorPeriodo,
    precioMedioPorPeriodo,
    esAnomalo: false,  // se marca después comparando con la media del tipo
    sinFacturas: invs.length === 0,
  }
}

// ── Detección de anomalías ─────────────────────────────────────────────────

function marcarAnomalias(supplies: SupplyAggregate[]): void {
  // Por tipo: calcular media y desviación estándar de €/kWh, marcar las
  // que estén a más de 1.5 desviaciones (cualquier dirección).
  for (const tipo of ['luz', 'gas'] as const) {
    const conPrecio = supplies.filter(s => s.supply.type === tipo && s.eurPorKwh > 0)
    if (conPrecio.length < 3) continue  // muy pocos para hacer estadística
    const precios = conPrecio.map(s => s.eurPorKwh)
    const media = precios.reduce((a, b) => a + b, 0) / precios.length
    const variancia = precios.reduce((s, p) => s + Math.pow(p - media, 2), 0) / precios.length
    const std = Math.sqrt(variancia)
    if (std === 0) continue
    for (const s of conPrecio) {
      if (Math.abs(s.eurPorKwh - media) > 1.5 * std) s.esAnomalo = true
    }
  }
}

// ── Función principal ──────────────────────────────────────────────────────

export function computarOverview(inputs: OverviewInputs): OverviewResult {
  const { supplies, invoices, mode } = inputs
  const typeFilter = inputs.typeFilter || 'all'

  const suppliesFiltrados = typeFilter === 'all'
    ? supplies
    : supplies.filter(s => s.type === typeFilter)

  const invsBySupply = selectInvoicesByMode(invoices, mode, { from: inputs.from, to: inputs.to })

  // Agregar cada supply (incluso si no tiene facturas)
  const ranking: SupplyAggregate[] = []
  for (const sup of suppliesFiltrados) {
    const invs = invsBySupply.get(sup.id) || []
    ranking.push(aggregateSupply(sup, invs))
  }
  marcarAnomalias(ranking)

  // Totales globales
  let gastoTotal = 0, gastoAnualizado = 0
  let consumoTotalKwh = 0
  let consumoFacturadoTotal = 0
  let suministrosConFacturas = 0, suministrosSinConsumo = 0
  let invoicesCount = 0
  // Por tipo
  const tipoLuz = { gasto: 0, gastoAnualizado: 0, consumoAnualKwh: 0, consumoFacturadoKwh: 0,
    excesos: 0, reactiva: 0, mesesAcum: 0, supsConFact: 0 }
  const tipoGas = { gasto: 0, gastoAnualizado: 0, consumoAnualKwh: 0, consumoFacturadoKwh: 0,
    mesesAcum: 0, supsConFact: 0 }
  const consumoPorPeriodoLuz: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  const costePorPeriodoLuz: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }

  const tarifaCounters = new Map<string, { suministros: Set<string>; gasto: number; consumoAnualKwh: number }>()
  const distribCounters = new Map<string, { suministros: Set<string>; gasto: number; consumoAnualKwh: number }>()
  const monthlyMap = new Map<string, { year: number; month: number; totalLuz: number; totalGas: number; kwhLuz: number; kwhGas: number; invoicesCount: number }>()

  for (const r of ranking) {
    consumoTotalKwh += r.consumoAnualKwh
    consumoFacturadoTotal += r.consumoFacturadoKwh
    if (r.consumoAnualKwh === 0) suministrosSinConsumo++

    const factorAnual = r.mesesCubiertos > 0 ? 12 / r.mesesCubiertos : 1
    const gastoSupAnualizado = r.totalGasto * factorAnual
    gastoTotal += r.totalGasto
    gastoAnualizado += gastoSupAnualizado

    if (r.invoicesCount > 0) {
      suministrosConFacturas++
      invoicesCount += r.invoicesCount
    }

    if (r.supply.type === 'gas') {
      tipoGas.gasto += r.totalGasto
      tipoGas.gastoAnualizado += gastoSupAnualizado
      tipoGas.consumoAnualKwh += r.consumoAnualKwh
      tipoGas.consumoFacturadoKwh += r.consumoFacturadoKwh
      tipoGas.mesesAcum += r.mesesCubiertos
      if (r.invoicesCount > 0) tipoGas.supsConFact++
    } else {
      tipoLuz.gasto += r.totalGasto
      tipoLuz.gastoAnualizado += gastoSupAnualizado
      tipoLuz.consumoAnualKwh += r.consumoAnualKwh
      tipoLuz.consumoFacturadoKwh += r.consumoFacturadoKwh
      tipoLuz.excesos += r.totalExcesos * factorAnual
      tipoLuz.reactiva += r.totalReactiva * factorAnual
      tipoLuz.mesesAcum += r.mesesCubiertos
      if (r.invoicesCount > 0) tipoLuz.supsConFact++
      for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
        consumoPorPeriodoLuz[p] += r.consumoPorPeriodo[p] || 0
        costePorPeriodoLuz[p] += (r.precioMedioPorPeriodo[p] || 0) * (r.consumoPorPeriodo[p] || 0)
      }
    }

    // Tarifa
    const tk = r.supply.tariff || 'Sin tarifa'
    if (!tarifaCounters.has(tk)) tarifaCounters.set(tk, { suministros: new Set(), gasto: 0, consumoAnualKwh: 0 })
    const tc = tarifaCounters.get(tk)!
    tc.suministros.add(r.supply.id); tc.gasto += r.totalGasto; tc.consumoAnualKwh += r.consumoAnualKwh

    // Distribuidora
    const dk = r.supply.distribuidora || r.supply.comercializadora || 'Sin distribuidora'
    if (!distribCounters.has(dk)) distribCounters.set(dk, { suministros: new Set(), gasto: 0, consumoAnualKwh: 0 })
    const dc = distribCounters.get(dk)!
    dc.suministros.add(r.supply.id); dc.gasto += r.totalGasto; dc.consumoAnualKwh += r.consumoAnualKwh
  }

  // Mensual
  for (const r of ranking) {
    if (r.sinFacturas) continue
    const supId = r.supply.id
    for (const inv of (invsBySupply.get(supId) || [])) {
      const am = getAssignedMonth(inv.period_start, inv.period_end)
      if (!am) continue
      const key = `${am.year}-${am.month}`
      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, { year: am.year, month: am.month, totalLuz: 0, totalGas: 0, kwhLuz: 0, kwhGas: 0, invoicesCount: 0 })
      }
      const m = monthlyMap.get(key)!
      const total = getInvoiceTotal(inv)
      const kwh = getInvoiceKwh(inv)
      if (r.supply.type === 'gas') { m.totalGas += total; m.kwhGas += kwh }
      else { m.totalLuz += total; m.kwhLuz += kwh }
      m.invoicesCount += 1
    }
  }

  // Concentración periodos eléctricos
  const totalPeriodos = Object.values(consumoPorPeriodoLuz).reduce((s, v) => s + v, 0) || 1
  const pcts: Record<string, number> = {}
  let dominante = 'P6'
  let dominantePct = 0
  for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
    pcts[p] = (consumoPorPeriodoLuz[p] / totalPeriodos) * 100
    if (pcts[p] > dominantePct) { dominantePct = pcts[p]; dominante = p }
  }
  const concentracionPeriodos = {
    p1: pcts.P1, p2: pcts.P2, p3: pcts.P3, p4: pcts.P4, p5: pcts.P5, p6: pcts.P6,
    dominante, dominantePct,
  }

  // Precio medio por periodo (luz, ponderado)
  const precioMedioPorPeriodoLuz: Record<string, number> = {}
  for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
    precioMedioPorPeriodoLuz[p] = consumoPorPeriodoLuz[p] > 0
      ? costePorPeriodoLuz[p] / consumoPorPeriodoLuz[p]
      : 0
  }

  // Orden y selecciones
  ranking.sort((a, b) => {
    if (b.totalGasto !== a.totalGasto) return b.totalGasto - a.totalGasto
    return b.consumoAnualKwh - a.consumoAnualKwh
  })
  const topConsumidores = [...ranking].sort((a, b) => b.consumoAnualKwh - a.consumoAnualKwh).slice(0, 5)
  const topGastadores = [...ranking].filter(r => r.totalGasto > 0).slice(0, 5)
  const anomalias = ranking.filter(r => r.esAnomalo)

  // Fecha SIPS más reciente
  const fechasSips = supplies
    .map(s => s.fechaSipsActualizado)
    .filter((d): d is string => !!d)
    .sort()
    .reverse()
  const fechaSipsMasReciente = fechasSips[0] || null

  // Monthly
  const monthly = Array.from(monthlyMap.values())
    .map(m => ({ ...m, total: m.totalLuz + m.totalGas }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))

  // PorTarifa con €/kWh
  const porTarifa = Array.from(tarifaCounters.entries()).map(([tarifa, info]) => ({
    tarifa,
    suministros: info.suministros.size,
    gasto: info.gasto,
    consumoAnualKwh: info.consumoAnualKwh,
    eurPorKwh: info.consumoAnualKwh > 0 ? info.gasto / info.consumoAnualKwh : 0,
  })).sort((a, b) => b.gasto - a.gasto)

  // PorDistribuidora
  const porDistribuidora = Array.from(distribCounters.entries()).map(([d, info]) => ({
    distribuidora: d,
    suministros: info.suministros.size,
    consumoAnualKwh: info.consumoAnualKwh,
    gasto: info.gasto,
  })).sort((a, b) => b.suministros - a.suministros)

  // Descripción
  let windowDescription = ''
  if (mode === 'last12') windowDescription = 'Últimas 12 facturas de cada suministro'
  else if (mode === 'previous_year') windowDescription = `Año natural ${new Date().getFullYear() - 1}`
  else if (mode === 'custom' && inputs.from && inputs.to) windowDescription = `${inputs.from} → ${inputs.to}`

  const cobertura = consumoTotalKwh > 0 ? (consumoFacturadoTotal / consumoTotalKwh) * 100 : 0
  const coberturaLuz = tipoLuz.consumoAnualKwh > 0 ? (tipoLuz.consumoFacturadoKwh / tipoLuz.consumoAnualKwh) * 100 : 0
  const coberturaGas = tipoGas.consumoAnualKwh > 0 ? (tipoGas.consumoFacturadoKwh / tipoGas.consumoAnualKwh) * 100 : 0

  return {
    mode,
    windowDescription,
    typeFilter,
    fechaSipsMasReciente,
    totals: {
      gastoTotal,
      gastoAnualizado,
      consumoTotalKwh,
      consumoFacturadoTotalKwh: consumoFacturadoTotal,
      coberturaFacturasPct: cobertura,
      eurPorKwhMedio: consumoFacturadoTotal > 0 ? gastoTotal / consumoFacturadoTotal : 0,
      suministrosCount: suppliesFiltrados.length,
      suministrosConFacturas,
      suministrosSinConsumo,
      invoicesCount,
      porTipo: {
        luz: {
          gasto: tipoLuz.gasto,
          gastoAnualizado: tipoLuz.gastoAnualizado,
          consumoAnualKwh: tipoLuz.consumoAnualKwh,
          consumoFacturadoKwh: tipoLuz.consumoFacturadoKwh,
          suministros: suppliesFiltrados.filter(s => s.type !== 'gas').length,
          eurPorKwhMedio: tipoLuz.consumoFacturadoKwh > 0 ? tipoLuz.gasto / tipoLuz.consumoFacturadoKwh : 0,
          coberturaPct: coberturaLuz,
          excesos: tipoLuz.excesos,
          reactiva: tipoLuz.reactiva,
          consumoPorPeriodo: consumoPorPeriodoLuz,
          precioMedioPorPeriodo: precioMedioPorPeriodoLuz,
        },
        gas: {
          gasto: tipoGas.gasto,
          gastoAnualizado: tipoGas.gastoAnualizado,
          consumoAnualKwh: tipoGas.consumoAnualKwh,
          consumoFacturadoKwh: tipoGas.consumoFacturadoKwh,
          suministros: suppliesFiltrados.filter(s => s.type === 'gas').length,
          eurPorKwhMedio: tipoGas.consumoFacturadoKwh > 0 ? tipoGas.gasto / tipoGas.consumoFacturadoKwh : 0,
          coberturaPct: coberturaGas,
        },
      },
    },
    topConsumidores,
    topGastadores,
    anomalias,
    ranking,
    monthly,
    porTarifa,
    porDistribuidora,
    concentracionPeriodos,
  }
}

// ── aplicarFiltroMeses — compat ────────────────────────────────────────────

export function aplicarFiltroMeses(res: OverviewResult, _meses: Array<{ mes: number; year: number }>): OverviewResult {
  // El filtro de meses se hace ahora en la propia selección; esta función queda
  // como no-op para mantener compatibilidad con código existente.
  return res
}
