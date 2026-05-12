/**
 * src/lib/comparativa-energetica.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Motor puro de simulación de coste real para la "Comparativa Voltis".
 *
 * Compara una factura nueva (source='voltis', comercializadora actual contratada
 * vía Voltis: Galp, Axpo, Gana, etc.) con la factura del MISMO MES NATURAL del
 * año anterior (source='historica', comercializadora antigua del cliente).
 *
 * Método: SIMULACIÓN INVERSA
 *   Aplicamos los precios de la comercializadora antigua al consumo real
 *   facturado por Voltis. El resto de costes (regulados por BOE/CNMC) se pasan
 *   idénticos. IEE e IVA se recalculan con el tipo vigente del periodo Voltis.
 *
 * Reglas duras:
 *   - SOLO meses con pareja completa (Voltis + histórica). Si falta alguno, fuera.
 *   - LUZ: simulación por periodo P1-P6. Aplica precio_Pi_antigua a kWh_Pi_voltis.
 *   - GAS: solo término variable de energía (único concepto competitivo).
 *
 * El módulo NO accede a BD, NO depende de React. Es 100% puro y testeable.
 */

import type { BillEconomics, ConsumoItem, PotenciaItem, OtroConcepto, InvoiceRow } from '@/components/supply/AnnualEconomics'

// ── Constantes ──────────────────────────────────────────────────────────────

export const PERIODOS_LUZ = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
export type PeriodoLuz = typeof PERIODOS_LUZ[number]

// ── Tipos públicos ──────────────────────────────────────────────────────────

export interface DetallePeriodoSim {
  periodo: PeriodoLuz
  /** kWh del periodo en la factura Voltis (consumo real actual) */
  kwh: number
  /** Precio €/kWh aplicado en la simulación (de la antigua, mismo mes año anterior) */
  precioKwhAntigua: number
  /** Precio €/kWh real cobrado por Voltis (referencia) */
  precioKwhVoltis: number
  costeEnergiaSimulada: number
  costeEnergiaVoltis: number
  /** kW contratados en el periodo Voltis */
  kw: number
  dias: number
  precioKwDiaAntigua: number
  precioKwDiaVoltis: number
  costePotenciaSimulada: number
  costePotenciaVoltis: number
}

export interface ResumenFactura {
  totalEnergia: number
  totalPotencia: number
  excesos: number
  bonoSocial: number
  alquiler: number
  otrosRegulados: number
  ieePorcentaje: number
  ieeImporte: number
  baseImponible: number
  ivaPorcentaje: number
  ivaImporte: number
  totalFactura: number
}

export interface ComparativaMes {
  /** 0–11 */
  mes: number
  /** Año Voltis (ej. 2026) */
  year: number
  /** Año comercializadora antigua (= year - 1) */
  yearAntigua: number
  voltisInvoiceId: string
  antiguaInvoiceId: string
  voltisFactura: BillEconomics
  antiguaFactura: BillEconomics
  diasVoltis: number
  diasAntigua: number
  /** Factura real de la antigua, los días que cobró (referencia documental) */
  realAntigua: ResumenFactura
  /** Factura real Voltis */
  realVoltis: ResumenFactura
  /** Simulación: lo que la antigua habría cobrado al consumo Voltis */
  simuladoAntigua: ResumenFactura
  /** Solo luz: desglose por periodo P1-P6 del cálculo simulado */
  detallePeriodos?: DetallePeriodoSim[]
  /** Ahorro = simulado_antigua - real_voltis */
  ahorroMes: number
  ahorroPorcentaje: number
}

export interface ResultadoComparativa {
  supplyType: 'luz' | 'gas'
  cups: string | null
  tarifa: string | null
  pares: ComparativaMes[]
  comercializadoraVoltis: string | null
  comercializadoraAntigua: string | null
  totales: {
    consumoTotalKwh: number
    voltisTotal: number
    simuladoAntiguaTotal: number
    ahorroTotal: number
    ahorroPorcentaje: number
    eurosPorKwhVoltis: number
    eurosPorKwhSimuladoAntigua: number
  }
}

// ── Helpers de parsing y normalización ──────────────────────────────────────

/** Extrae BillEconomics desde una InvoiceRow, soportando ambas estructuras. */
export function getEco(inv: InvoiceRow): BillEconomics | null {
  const ed = inv.extracted_data
  if (ed?.economics && typeof ed.economics === 'object') {
    return ed.economics
  }
  if (inv.economics_data) return inv.economics_data
  return null
}

/** Convierte string de fecha (ISO, YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY) a Date. */
export function parseDate(d?: string | null): Date | null {
  if (!d) return null
  if (d.includes('-')) {
    const ds = new Date(d)
    return isNaN(ds.getTime()) ? null : ds
  }
  if (d.includes('/')) {
    const [day, month, year] = d.split('/').map(Number)
    if (!day || !month || !year) return null
    const ds = new Date(year, month - 1, day)
    return isNaN(ds.getTime()) ? null : ds
  }
  if (d.includes('.')) {
    const [day, month, year] = d.split('.').map(Number)
    if (!day || !month || !year) return null
    const ds = new Date(year, month - 1, day)
    return isNaN(ds.getTime()) ? null : ds
  }
  const ds = new Date(d)
  return isNaN(ds.getTime()) ? null : ds
}

/**
 * Mes natural dominante de un periodo de facturación.
 * Una factura del 09/01-31/01 tiene 23 días, todos en enero → mes 0, year 2026.
 * Una factura del 28/01-26/02 reparte 4 días en enero y 26 en febrero → mes 1.
 */
export function getAssignedMonth(start?: string | null, end?: string | null): { month: number; year: number } | null {
  const s = parseDate(start)
  const e = parseDate(end)
  if (!s || !e) return null
  const counts: Record<string, number> = {}
  const cur = new Date(s)
  while (cur <= e) {
    const key = `${cur.getFullYear()}-${cur.getMonth()}`
    counts[key] = (counts[key] || 0) + 1
    cur.setDate(cur.getDate() + 1)
  }
  let max = 0
  let winner: { month: number; year: number } | null = null
  Object.entries(counts).forEach(([k, v]) => {
    if (v > max) {
      max = v
      const [y, m] = k.split('-').map(Number)
      winner = { month: m, year: y }
    }
  })
  return winner
}

/** Días naturales facturados (inclusivos). */
export function diasFacturados(start?: string | null, end?: string | null): number {
  const s = parseDate(start)
  const e = parseDate(end)
  if (!s || !e) return 0
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
}

/** Detecta "Excesos de potencia" en otrosConceptos. */
export function esExcesoPotencia(concepto: string): boolean {
  const c = (concepto || '').toLowerCase()
  return c.includes('exceso') && c.includes('potencia')
}

/** Detecta "Bono social". */
export function esBonoSocial(concepto: string): boolean {
  const c = (concepto || '').toLowerCase()
  return c.includes('bono') && c.includes('social')
}

/** Detecta "Alquiler equipos de medida". */
export function esAlquilerEquipos(concepto: string): boolean {
  const c = (concepto || '').toLowerCase()
  return c.includes('alquiler')
}

/** Detecta "Impuesto eléctrico" (IEE). */
export function esImpuestoElectrico(concepto: string): boolean {
  const c = (concepto || '').toLowerCase().replace(/\./g, '')
  return (c.includes('impuesto') && (c.includes('elect') || c.includes('eléct'))) || c.includes('iee')
}

/** Detecta "IVA / IGIC". */
export function esIva(concepto: string): boolean {
  const c = (concepto || '').toLowerCase()
  return c.includes('iva') || c.includes('igic')
}

/** Detecta "Impuesto hidrocarburos" (IEH) en gas. */
export function esImpuestoHidrocarburos(concepto: string): boolean {
  const c = (concepto || '').toLowerCase()
  return c.includes('hidrocarbur') || c.includes('ieh')
}

/** Suma de otros conceptos que cumplan el predicado. */
function sumaConceptos(otros: OtroConcepto[] | undefined, pred: (c: string) => boolean): number {
  if (!otros) return 0
  return otros.filter(o => pred(o.concepto || '')).reduce((sum, o) => sum + (Number(o.total) || 0), 0)
}

// ── Construcción del resumen de una factura ─────────────────────────────────

/**
 * Reduce una BillEconomics a su esqueleto numérico:
 * energía / potencia / excesos / bono social / alquiler / IEE / base / IVA / total.
 *
 * Funciona tanto para luz como para gas (en gas, potencia y excesos serán 0 y la
 * función gasPricing ya está en el bloque correspondiente).
 */
export function resumirFactura(eco: BillEconomics): ResumenFactura {
  const totalEnergia = (eco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
  const totalPotencia = (eco.potencia || []).reduce((s, p) => s + (Number(p.total) || 0), 0)

  const excesos = sumaConceptos(eco.otrosConceptos, esExcesoPotencia)
  const bonoSocial = sumaConceptos(eco.otrosConceptos, esBonoSocial)
  const alquiler = sumaConceptos(eco.otrosConceptos, esAlquilerEquipos)
  const ieeImporte = sumaConceptos(eco.otrosConceptos, esImpuestoElectrico)
  const ivaImporte = sumaConceptos(eco.otrosConceptos, esIva)

  // Otros conceptos regulados que no caen en categorías conocidas
  const otrosRegulados = (eco.otrosConceptos || [])
    .filter(o => {
      const c = o.concepto || ''
      return !esExcesoPotencia(c) && !esBonoSocial(c) && !esAlquilerEquipos(c)
        && !esImpuestoElectrico(c) && !esIva(c) && !esImpuestoHidrocarburos(c)
    })
    .reduce((s, o) => s + (Number(o.total) || 0), 0)

  // El Impuesto Eléctrico (Ley 38/1992) grava energía + potencia + excesos,
  // NO bono social ni alquiler. Calculamos el tipo efectivo aplicado en esta factura.
  const baseIee = totalEnergia + totalPotencia + excesos
  const ieePorcentaje = baseIee > 0 ? ieeImporte / baseIee : 0

  const baseImponible = totalEnergia + totalPotencia + excesos + bonoSocial + alquiler + ieeImporte + otrosRegulados
  const ivaPorcentaje = baseImponible > 0 ? ivaImporte / baseImponible : 0
  const totalFactura = baseImponible + ivaImporte

  return {
    totalEnergia,
    totalPotencia,
    excesos,
    bonoSocial,
    alquiler,
    otrosRegulados,
    ieePorcentaje,
    ieeImporte,
    baseImponible,
    ivaPorcentaje,
    ivaImporte,
    totalFactura,
  }
}

// ── Simulación LUZ por periodo P1-P6 ────────────────────────────────────────

/**
 * Indexa kWh por periodo de un array de ConsumoItem.
 * Si un periodo aparece varias veces (poco común), se suma.
 */
function indexarConsumoPorPeriodo(items?: ConsumoItem[]): Record<string, { kwh: number; precio: number }> {
  const out: Record<string, { kwh: number; precio: number }> = {}
  for (const it of items || []) {
    const p = (it.periodo || '').toUpperCase().trim()
    if (!p) continue
    if (!out[p]) out[p] = { kwh: 0, precio: 0 }
    out[p].kwh += Number(it.kwh) || 0
    // Precio: nos quedamos con el primer no-cero
    if (!out[p].precio && it.precioKwh) out[p].precio = Number(it.precioKwh) || 0
  }
  return out
}

function indexarPotenciaPorPeriodo(items?: PotenciaItem[]): Record<string, { kw: number; precio: number; dias: number }> {
  const out: Record<string, { kw: number; precio: number; dias: number }> = {}
  for (const it of items || []) {
    const p = (it.periodo || '').toUpperCase().trim()
    if (!p) continue
    if (!out[p]) out[p] = { kw: 0, precio: 0, dias: 0 }
    out[p].kw = Number(it.kw) || out[p].kw
    out[p].precio = Number(it.precioKwDia) || out[p].precio
    out[p].dias = Number(it.dias) || out[p].dias
  }
  return out
}

/**
 * Simula la factura LUZ que habría cobrado la comercializadora antigua
 * si el cliente hubiera consumido lo de Voltis.
 *
 * - Energía:  Σ_p (kWh_p_voltis × €/kWh_p_antigua)
 * - Potencia: Σ_p (kW_p_voltis × días_voltis × €/kW·día_p_antigua)
 * - Excesos, bono social, alquiler = de la factura Voltis (regulados)
 * - IEE: tipo_voltis × (energía_sim + potencia_sim)
 * - IVA: tipo_voltis × base_imponible_sim
 */
export function simularLuzAntiguaConConsumoVoltis(
  voltisEco: BillEconomics,
  antiguaEco: BillEconomics,
): { resumen: ResumenFactura; detalle: DetallePeriodoSim[] } {
  const voltisCons = indexarConsumoPorPeriodo(voltisEco.consumo)
  const antiguaCons = indexarConsumoPorPeriodo(antiguaEco.consumo)
  const voltisPot = indexarPotenciaPorPeriodo(voltisEco.potencia)
  const antiguaPot = indexarPotenciaPorPeriodo(antiguaEco.potencia)

  const detalle: DetallePeriodoSim[] = []

  let totalEnergiaSim = 0
  let totalPotenciaSim = 0

  for (const periodo of PERIODOS_LUZ) {
    const vc = voltisCons[periodo] || { kwh: 0, precio: 0 }
    const ac = antiguaCons[periodo] || { kwh: 0, precio: 0 }
    const vp = voltisPot[periodo] || { kw: 0, precio: 0, dias: 0 }
    const ap = antiguaPot[periodo] || { kw: 0, precio: 0, dias: 0 }

    // Si el cliente no consumió en este periodo en Voltis, la simulación es 0 — saltar.
    const tieneConsumo = vc.kwh > 0
    const tienePotencia = vp.kw > 0 || vp.precio > 0

    if (!tieneConsumo && !tienePotencia) continue

    // Si la antigua no tiene precio en este periodo (porque tampoco consumió), heurística:
    // usar el precio medio entre los periodos con dato del mismo mes.
    let precioKwhAntigua = ac.precio
    if (tieneConsumo && precioKwhAntigua === 0) {
      const precios = Object.values(antiguaCons).map(c => c.precio).filter(p => p > 0)
      precioKwhAntigua = precios.length > 0 ? precios.reduce((a, b) => a + b, 0) / precios.length : 0
    }
    let precioKwDiaAntigua = ap.precio
    if (tienePotencia && precioKwDiaAntigua === 0) {
      const precios = Object.values(antiguaPot).map(p => p.precio).filter(p => p > 0)
      precioKwDiaAntigua = precios.length > 0 ? precios.reduce((a, b) => a + b, 0) / precios.length : 0
    }

    const costeEnergiaSim = vc.kwh * precioKwhAntigua
    const costePotenciaSim = vp.kw * vp.dias * precioKwDiaAntigua

    totalEnergiaSim += costeEnergiaSim
    totalPotenciaSim += costePotenciaSim

    detalle.push({
      periodo,
      kwh: vc.kwh,
      precioKwhAntigua,
      precioKwhVoltis: vc.precio,
      costeEnergiaSimulada: costeEnergiaSim,
      costeEnergiaVoltis: vc.kwh * vc.precio,
      kw: vp.kw,
      dias: vp.dias,
      precioKwDiaAntigua,
      precioKwDiaVoltis: vp.precio,
      costePotenciaSimulada: costePotenciaSim,
      costePotenciaVoltis: vp.kw * vp.dias * vp.precio,
    })
  }

  const real = resumirFactura(voltisEco)
  // Regulados idénticos a Voltis
  const excesos = real.excesos
  const bonoSocial = real.bonoSocial
  const alquiler = real.alquiler
  const otrosRegulados = real.otrosRegulados

  const ieePorcentaje = real.ieePorcentaje
  const ivaPorcentaje = real.ivaPorcentaje

  // Mismo % de IEE aplicado a la base eléctrica simulada (energía + potencia + excesos)
  const baseIeeSim = totalEnergiaSim + totalPotenciaSim + excesos
  const ieeImporteSim = baseIeeSim * ieePorcentaje
  const baseImponibleSim = totalEnergiaSim + totalPotenciaSim + excesos + bonoSocial + alquiler + otrosRegulados + ieeImporteSim
  const ivaImporteSim = baseImponibleSim * ivaPorcentaje
  const totalFacturaSim = baseImponibleSim + ivaImporteSim

  const resumen: ResumenFactura = {
    totalEnergia: totalEnergiaSim,
    totalPotencia: totalPotenciaSim,
    excesos,
    bonoSocial,
    alquiler,
    otrosRegulados,
    ieePorcentaje,
    ieeImporte: ieeImporteSim,
    baseImponible: baseImponibleSim,
    ivaPorcentaje,
    ivaImporte: ivaImporteSim,
    totalFactura: totalFacturaSim,
  }
  return { resumen, detalle }
}

// ── Simulación GAS — solo término variable energía ──────────────────────────

/**
 * En gas, el único concepto competitivo es el TV Precio Fijo (€/kWh de energía).
 * Término fijo, peaje TV Red Local, IEH, GTS, CNMC, alquileres son regulados.
 *
 * Simulación: consumo_voltis × precio_TV_antigua × (1 + IVA_voltis).
 *
 * El "ahorro" calculado SOLO incluye el delta de término variable + IVA. El resto
 * de la factura (regulado) se considera idéntico y NO se computa en el ahorro.
 *
 * El "resumen simulado" devuelto refleja la factura como si solo cambiase el TV:
 *   energía = consumo × precio_antigua, IVA = % vigente, resto = lo mismo que Voltis.
 */
export function simularGasAntiguaConConsumoVoltis(
  voltisEco: BillEconomics,
  antiguaEco: BillEconomics,
): { resumen: ResumenFactura; detalle: DetallePeriodoSim[] } {
  const voltisGas = voltisEco.gasPricing || {}
  const antiguaGas = antiguaEco.gasPricing || {}
  const consumo = Number(voltisEco.consumoTotalKwh) || (voltisEco.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)

  const precioVoltis = Number(voltisGas.precioKwh) || 0
  let precioAntigua = Number(antiguaGas.precioKwh) || 0
  // Fallback: si gasPricing no tiene precio, intentar derivarlo del consumo array
  if (precioAntigua === 0 && antiguaEco.consumo && antiguaEco.consumo.length > 0) {
    const totalAntigua = antiguaEco.consumo.reduce((s, c) => s + (Number(c.total) || 0), 0)
    const kwhAntigua = antiguaEco.consumo.reduce((s, c) => s + (Number(c.kwh) || 0), 0)
    if (kwhAntigua > 0) precioAntigua = totalAntigua / kwhAntigua
  }

  const real = resumirFactura(voltisEco)
  const ivaPorcentaje = real.ivaPorcentaje > 0 ? real.ivaPorcentaje : (Number(voltisGas.ivaPorcentaje) || 0) / 100

  const totalEnergiaSim = consumo * precioAntigua
  // En gas no hay potencia
  const totalPotenciaSim = 0
  // Términos regulados: tomamos los de Voltis tal cual
  const excesos = real.excesos
  const bonoSocial = real.bonoSocial
  const alquiler = real.alquiler
  const otrosRegulados = real.otrosRegulados
  const ieeImporteSim = 0
  const baseImponibleSim = totalEnergiaSim + totalPotenciaSim + excesos + bonoSocial + alquiler + otrosRegulados
  const ivaImporteSim = baseImponibleSim * ivaPorcentaje
  const totalFacturaSim = baseImponibleSim + ivaImporteSim

  const resumen: ResumenFactura = {
    totalEnergia: totalEnergiaSim,
    totalPotencia: 0,
    excesos,
    bonoSocial,
    alquiler,
    otrosRegulados,
    ieePorcentaje: 0,
    ieeImporte: 0,
    baseImponible: baseImponibleSim,
    ivaPorcentaje,
    ivaImporte: ivaImporteSim,
    totalFactura: totalFacturaSim,
  }

  // Detalle "pseudo-periodo" para gas: una sola fila
  const detalle: DetallePeriodoSim[] = [{
    periodo: 'P1',
    kwh: consumo,
    precioKwhAntigua: precioAntigua,
    precioKwhVoltis: precioVoltis,
    costeEnergiaSimulada: totalEnergiaSim,
    costeEnergiaVoltis: consumo * precioVoltis,
    kw: 0,
    dias: 0,
    precioKwDiaAntigua: 0,
    precioKwDiaVoltis: 0,
    costePotenciaSimulada: 0,
    costePotenciaVoltis: 0,
  }]

  return { resumen, detalle }
}

// ── Emparejamiento Voltis ↔ Histórica ───────────────────────────────────────

interface InvoiceWithSource extends InvoiceRow {
  source?: 'historica' | 'voltis'
}

/**
 * Empareja cada factura source='voltis' con la factura source='historica' del
 * mismo mes natural del año anterior. Solo devuelve parejas completas.
 *
 * Si hay varias facturas Voltis en el mismo mes (raro), se queda con la de mayor
 * total_amount como representante (asume la otra es duplicado o nota de abono).
 */
export function pairVoltisWithHistorica(
  invoices: InvoiceWithSource[],
): { voltis: InvoiceWithSource; antigua: InvoiceWithSource; mes: number; year: number }[] {
  // Indexa históricas por (year, month) y voltis por (year, month).
  const histPorMes = new Map<string, InvoiceWithSource>()
  const voltisPorMes = new Map<string, InvoiceWithSource>()

  for (const inv of invoices) {
    const eco = getEco(inv)
    const start = inv.period_start || eco?.fechaInicio
    const end = inv.period_end || eco?.fechaFin
    const am = getAssignedMonth(start, end)
    if (!am) continue
    const key = `${am.year}-${am.month}`
    if (inv.source === 'voltis') {
      const cur = voltisPorMes.get(key)
      if (!cur || (inv.total_amount || 0) > (cur.total_amount || 0)) voltisPorMes.set(key, inv)
    } else {
      const cur = histPorMes.get(key)
      if (!cur || (inv.total_amount || 0) > (cur.total_amount || 0)) histPorMes.set(key, inv)
    }
  }

  const out: { voltis: InvoiceWithSource; antigua: InvoiceWithSource; mes: number; year: number }[] = []
  for (const [key, voltisInv] of voltisPorMes.entries()) {
    const [year, month] = key.split('-').map(Number)
    const antiguaKey = `${year - 1}-${month}`
    const antiguaInv = histPorMes.get(antiguaKey)
    if (!antiguaInv) continue
    out.push({ voltis: voltisInv, antigua: antiguaInv, mes: month, year })
  }
  // Orden cronológico
  out.sort((a, b) => (a.year - b.year) || (a.mes - b.mes))
  return out
}

// ── API pública: cómputo completo de la comparativa ─────────────────────────

/**
 * Determina si el supply es de gas mirando la BillEconomics de las facturas
 * (existencia de gasPricing) o un override autoritativo.
 */
function inferirSupplyType(invoices: InvoiceRow[], override?: string | null): 'luz' | 'gas' {
  if (override === 'gas') return 'gas'
  if (override === 'luz') return 'luz'
  for (const inv of invoices) {
    const eco = getEco(inv)
    if (eco?.supply_type === 'gas') return 'gas'
    if (eco?.gasPricing) return 'gas'
  }
  return 'luz'
}

/**
 * Calcula la comparativa completa: empareja facturas, simula cada par y agrega.
 *
 * Devuelve solo los meses con pareja completa.
 */
export function computarComparativa(
  invoices: InvoiceWithSource[],
  supplyTypeHint?: string | null,
): ResultadoComparativa {
  const supplyType = inferirSupplyType(invoices, supplyTypeHint)
  const pares = pairVoltisWithHistorica(invoices)

  const comparativaMeses: ComparativaMes[] = []
  let cups: string | null = null
  let tarifa: string | null = null
  let comercializadoraVoltis: string | null = null
  let comercializadoraAntigua: string | null = null

  for (const par of pares) {
    const voltisEco = getEco(par.voltis)
    const antiguaEco = getEco(par.antigua)
    if (!voltisEco || !antiguaEco) continue

    cups = cups || voltisEco.cups || null
    tarifa = tarifa || voltisEco.tarifa || null
    comercializadoraVoltis = comercializadoraVoltis || voltisEco.comercializadora || null
    comercializadoraAntigua = comercializadoraAntigua || antiguaEco.comercializadora || null

    const realVoltis = resumirFactura(voltisEco)
    const realAntigua = resumirFactura(antiguaEco)
    const sim = supplyType === 'gas'
      ? simularGasAntiguaConConsumoVoltis(voltisEco, antiguaEco)
      : simularLuzAntiguaConConsumoVoltis(voltisEco, antiguaEco)

    const ahorroMes = sim.resumen.totalFactura - realVoltis.totalFactura
    const ahorroPorcentaje = sim.resumen.totalFactura > 0
      ? (ahorroMes / sim.resumen.totalFactura) * 100
      : 0

    comparativaMeses.push({
      mes: par.mes,
      year: par.year,
      yearAntigua: par.year - 1,
      voltisInvoiceId: par.voltis.id,
      antiguaInvoiceId: par.antigua.id,
      voltisFactura: voltisEco,
      antiguaFactura: antiguaEco,
      diasVoltis: diasFacturados(par.voltis.period_start, par.voltis.period_end),
      diasAntigua: diasFacturados(par.antigua.period_start, par.antigua.period_end),
      realAntigua,
      realVoltis,
      simuladoAntigua: sim.resumen,
      detallePeriodos: sim.detalle,
      ahorroMes,
      ahorroPorcentaje,
    })
  }

  // Totales agregados
  let consumoTotalKwh = 0
  let voltisTotal = 0
  let simuladoTotal = 0
  for (const m of comparativaMeses) {
    consumoTotalKwh += (m.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(m.voltisFactura.consumoTotalKwh) || 0
    voltisTotal += m.realVoltis.totalFactura
    simuladoTotal += m.simuladoAntigua.totalFactura
  }
  const ahorroTotal = simuladoTotal - voltisTotal
  const ahorroPorcentaje = simuladoTotal > 0 ? (ahorroTotal / simuladoTotal) * 100 : 0
  const eurosPorKwhVoltis = consumoTotalKwh > 0 ? voltisTotal / consumoTotalKwh : 0
  const eurosPorKwhSimuladoAntigua = consumoTotalKwh > 0 ? simuladoTotal / consumoTotalKwh : 0

  return {
    supplyType,
    cups,
    tarifa,
    pares: comparativaMeses,
    comercializadoraVoltis,
    comercializadoraAntigua,
    totales: {
      consumoTotalKwh,
      voltisTotal,
      simuladoAntiguaTotal: simuladoTotal,
      ahorroTotal,
      ahorroPorcentaje,
      eurosPorKwhVoltis,
      eurosPorKwhSimuladoAntigua,
    },
  }
}

// ── Filtrado por selección de meses ─────────────────────────────────────────

/**
 * Recalcula los totales sobre un subconjunto de meses (para el selector de UI).
 * No reemplaza pares ni recalcula simulaciones (que son por par).
 */
export function aplicarFiltroMeses(
  res: ResultadoComparativa,
  mesesSeleccionados: Array<{ mes: number; year: number }>,
): ResultadoComparativa {
  if (mesesSeleccionados.length === 0) return res
  const setKeys = new Set(mesesSeleccionados.map(m => `${m.year}-${m.mes}`))
  const pares = res.pares.filter(p => setKeys.has(`${p.year}-${p.mes}`))

  let consumoTotalKwh = 0
  let voltisTotal = 0
  let simuladoTotal = 0
  for (const m of pares) {
    consumoTotalKwh += (m.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(m.voltisFactura.consumoTotalKwh) || 0
    voltisTotal += m.realVoltis.totalFactura
    simuladoTotal += m.simuladoAntigua.totalFactura
  }
  const ahorroTotal = simuladoTotal - voltisTotal
  const ahorroPorcentaje = simuladoTotal > 0 ? (ahorroTotal / simuladoTotal) * 100 : 0
  const eurosPorKwhVoltis = consumoTotalKwh > 0 ? voltisTotal / consumoTotalKwh : 0
  const eurosPorKwhSimuladoAntigua = consumoTotalKwh > 0 ? simuladoTotal / consumoTotalKwh : 0

  return {
    ...res,
    pares,
    totales: {
      consumoTotalKwh,
      voltisTotal,
      simuladoAntiguaTotal: simuladoTotal,
      ahorroTotal,
      ahorroPorcentaje,
      eurosPorKwhVoltis,
      eurosPorKwhSimuladoAntigua,
    },
  }
}
