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
  /** Factura real de la antigua, año anterior (lo que pagó el cliente entonces) */
  realAntigua: ResumenFactura
  /** Factura real Voltis (lo que paga ahora) */
  realVoltis: ResumenFactura
  /**
   * Estimado contrafactual: lo que el cliente habría pagado con la tarifa
   * Voltis si hubiera tenido el consumo histórico del año pasado.
   * = energía_estimada (kWh_antigua_Pi × precio_voltis_Pi) + regulados Voltis + IEE + IVA
   *
   * Mantengo `simuladoAntigua` como alias para retro-compatibilidad con la UI.
   */
  estimadoVoltisConConsumoAntiguo: ResumenFactura
  /** @deprecated alias de `estimadoVoltisConConsumoAntiguo` (gas) o nuevo nombre conceptual (luz) */
  simuladoAntigua: ResumenFactura
  /** Solo luz: desglose por periodo P1-P6 del cálculo estimado */
  detallePeriodos?: DetallePeriodoSim[]
  /** Ahorro por cambio de tarifa = real_antigua.total − estimado.total */
  ahorroTarifa: number
  /** Ahorro por menor consumo = estimado.total − real_voltis.total */
  ahorroConsumo: number
  /** Ahorro total del mes = real_antigua.total − real_voltis.total */
  ahorroMes: number
  ahorroPorcentaje: number
  /** Validación: ε = |Σ(kWh_voltis × precio_voltis) − total_energia_voltis_real|.
   *  Si supera tolerancia (5 € o 1 % del total energía), hay error de extracción. */
  validacionEnergiaVoltis?: { delta: number; tolerancia: number; ok: boolean }
}

export interface ResultadoComparativa {
  supplyType: 'luz' | 'gas'
  cups: string | null
  tarifa: string | null
  pares: ComparativaMes[]
  comercializadoraVoltis: string | null
  comercializadoraAntigua: string | null
  totales: {
    /** kWh consumidos por Voltis (los reales del año actual) */
    consumoTotalKwh: number
    /** kWh consumidos por la antigua en el año anterior (consumo histórico) */
    consumoTotalKwhAntigua: number
    /** Σ totales reales Voltis */
    voltisTotal: number
    /** Σ totales reales antigua */
    realAntiguaTotal: number
    /** Σ estimados Voltis con consumo histórico */
    estimadoConsumoAntiguoTotal: number
    /** @deprecated alias de estimadoConsumoAntiguoTotal */
    simuladoAntiguaTotal: number
    /** Ahorro por cambio de tarifa */
    ahorroTarifa: number
    /** Ahorro por menor consumo */
    ahorroConsumo: number
    /** Ahorro total = real_antigua − real_voltis */
    ahorroTotal: number
    ahorroPorcentaje: number
    eurosPorKwhVoltis: number
    eurosPorKwhAntigua: number
    /** @deprecated alias de eurosPorKwhAntigua */
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
  // ── Gas: estructura distinta ─ las facturas de gas llevan los conceptos
  //    en gasPricing (terminoFijoTotal, impuestoHidrocarbTotal, alquilerTotal,
  //    ivaTotal…) en lugar de en otrosConceptos. Las tratamos aparte.
  if (eco.gasPricing) {
    return resumirFacturaGas(eco)
  }

  const totalEnergia = (eco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
  const totalPotencia = (eco.potencia || []).reduce((s, p) => s + (Number(p.total) || 0), 0)

  const excesos = sumaConceptos(eco.otrosConceptos, esExcesoPotencia)
  const bonoSocial = sumaConceptos(eco.otrosConceptos, esBonoSocial)
  const alquiler = sumaConceptos(eco.otrosConceptos, esAlquilerEquipos)
  const ieeImporte = sumaConceptos(eco.otrosConceptos, esImpuestoElectrico)
  const ivaImporte = sumaConceptos(eco.otrosConceptos, esIva)

  // Otros conceptos regulados que no caen en categorías conocidas.
  // IMPORTANTE: el extractor (Gemini) a veces mete la BASE IMPONIBLE como
  // concepto "OTROS" o "TOTAL BASE" duplicando la suma. Para evitarlo,
  // ignoramos conceptos genéricos cuyo importe sea anormalmente alto
  // (≥80% de la suma energía+potencia, indicador de duplicación).
  const sumaBase = totalEnergia + totalPotencia
  const otrosRegulados = (eco.otrosConceptos || [])
    .filter(o => {
      const c = (o.concepto || '').toLowerCase().trim()
      // Excluye los conceptos conocidos
      if (esExcesoPotencia(c) || esBonoSocial(c) || esAlquilerEquipos(c)
        || esImpuestoElectrico(c) || esIva(c) || esImpuestoHidrocarburos(c)) return false
      // Excluye genéricos "OTROS" / "TOTAL" / "BASE" — son ruido del extractor
      if (c === 'otros' || c === 'otro' || c.startsWith('total ') || c.includes('base imponible')
        || c === '' || c === 'concepto') return false
      // Heurística anti-duplicación: si el importe es ≥80% de la suma energía+potencia,
      // probablemente sea la base imponible repetida → ignorar.
      const total = Number(o.total) || 0
      if (sumaBase > 0 && total >= sumaBase * 0.8) return false
      return true
    })
    .reduce((s, o) => s + (Number(o.total) || 0), 0)

  // El Impuesto Eléctrico (Ley 38/1992) grava energía + potencia + excesos + bono social,
  // NO alquiler. Calculamos el tipo efectivo aplicado en esta factura.
  const baseIee = totalEnergia + totalPotencia + excesos + bonoSocial
  let ieePorcentaje = baseIee > 0 ? ieeImporte / baseIee : 0

  let baseImponible = totalEnergia + totalPotencia + excesos + bonoSocial + alquiler + ieeImporte + otrosRegulados
  let ivaPorcentaje = baseImponible > 0 ? ivaImporte / baseImponible : 0
  let totalFactura = baseImponible + ivaImporte

  // ── Ajuste por extracción incompleta ───────────────────────────────────
  // Si el PDF original declara un totalFactura significativamente mayor que
  // la suma de componentes extraídos, es porque el extractor no capturó
  // todos los conceptos (típico en facturas antiguas: faltan IEE/IVA/excesos).
  // Confiamos en eco.totalFactura (Gemini lo lee directamente del PDF) y
  // reconstruimos coherentemente:
  //   - Si tenemos energía + potencia + algo, deducimos el resto como
  //     "ajuste regulado/impuestos" y derivamos IEE/IVA estándar (5,11% y 21%).
  const totalDeclarado = Number(eco.totalFactura) || 0
  if (totalDeclarado > 0 && totalDeclarado > totalFactura * 1.05) {
    // Total real conocido. Reconstruimos asumiendo:
    //   IEE = 5,1127% (o 0,5% si el calculado parece serlo)
    //   IVA = 21% (o el calculado si parece otro tipo oficial)
    const tipoIeeAsumido = ieePorcentaje > 0.01 ? ieePorcentaje : 0.0511269632
    const tipoIvaAsumido = ivaPorcentaje > 0 ? ivaPorcentaje : 0.21
    // Si no se extrajeron IEE, IVA, etc., despejamos:
    //   total = (energía + potencia + extras + bono + alquiler) × (1 + IEE) × (1 + IVA)
    //   pero IEE solo aplica a (energía + potencia + excesos + bono), no a alquiler:
    //   total = ((energía + potencia + excesos + bono)(1+IEE) + alquiler + otros) × (1+IVA)
    // → base_no_iva = total / (1 + IVA)
    const baseNoIva = totalDeclarado / (1 + tipoIvaAsumido)
    const ivaImputado = totalDeclarado - baseNoIva
    // base_imponible = base_no_iva, repartimos: IEE = pct × (energía + potencia + excesos + bono)
    // alquiler queda fijo, excesos/bono/otros fijos. El resto que falte se imputa a "otrosRegulados ajuste"
    const ieeImputado = (totalEnergia + totalPotencia + excesos + bonoSocial) * tipoIeeAsumido
    const ajusteRegulado = baseNoIva - (totalEnergia + totalPotencia + excesos + bonoSocial + alquiler + ieeImputado + otrosRegulados)
    // Aplicamos el ajuste a otrosRegulados (cubre extracciones incompletas
    // de potencias P4-P6 perdidas, peajes, financiación CNMC…)
    return {
      totalEnergia,
      totalPotencia,
      excesos,
      bonoSocial,
      alquiler,
      otrosRegulados: otrosRegulados + Math.max(0, ajusteRegulado),
      ieePorcentaje: tipoIeeAsumido,
      ieeImporte: ieeImputado,
      baseImponible: baseNoIva,
      ivaPorcentaje: tipoIvaAsumido,
      ivaImporte: ivaImputado,
      totalFactura: totalDeclarado,
    }
  }

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

/**
 * Reduce una factura de GAS a su resumen numérico.
 *
 * Estructura de una factura de gas natural:
 *   energía  = consumoTotalKwh × precio_kWh
 *   término fijo (TF + cargos ATR) → regulado
 *   peaje TV Red Local → regulado
 *   IEH (impuesto hidrocarburos) → regulado
 *   alquiler equipos → regulado
 *   IVA → recalculado sobre la base
 *
 * Mapeo a ResumenFactura (estructura común):
 *   totalEnergia    → energía (consumo × precio)
 *   totalPotencia   → 0 (gas no tiene potencia)
 *   excesos         → 0
 *   bonoSocial      → 0
 *   alquiler        → gasPricing.alquilerTotal
 *   otrosRegulados  → terminoFijo + IEH + (peaje TV Red Local si extraído) − descuentos
 *   ieePorcentaje   → 0 (no aplica)
 *   ieeImporte      → 0
 *   ivaPorcentaje   → derivado de ivaTotal/base, o ivaPorcentaje declarado
 *   ivaImporte      → gasPricing.ivaTotal o calculado
 */
/** Normaliza un IVA al tipo oficial más cercano (0%, 4%, 5%, 10%, 21%).
 *  El extractor a veces declara 21% cuando la factura tenía la reducción al 10%.
 *  El ivaTotal real es fiable; el porcentaje derivado señala el tipo correcto. */
function normalizarIvaPorcentaje(declarado: number | null, calculado: number): number {
  const TIPOS_OFICIALES = [0, 0.04, 0.05, 0.10, 0.21]
  const dec = declarado !== null ? (declarado >= 1 ? declarado / 100 : declarado) : null
  // Si lo declarado coincide con el calculado (±1,5%), confiamos en lo declarado.
  if (dec !== null && Math.abs(dec - calculado) < 0.015 && TIPOS_OFICIALES.includes(dec)) return dec
  // Si no, devolvemos el tipo oficial más cercano al calculado.
  let best = TIPOS_OFICIALES[0]
  let bestDiff = Math.abs(calculado - best)
  for (const t of TIPOS_OFICIALES) {
    const d = Math.abs(calculado - t)
    if (d < bestDiff) { bestDiff = d; best = t }
  }
  return best
}

function resumirFacturaGas(eco: BillEconomics): ResumenFactura {
  const gp = eco.gasPricing || {}
  // Energía: preferimos sumar consumo[].total; si está vacío, consumo × precio
  let totalEnergia = (eco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
  if (totalEnergia === 0) {
    const consumo = Number(eco.consumoTotalKwh) || (eco.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
    totalEnergia = consumo * (Number(gp.precioKwh) || 0)
  }

  const terminoFijo = Number(gp.terminoFijoTotal) || 0
  const ieh = Number(gp.impuestoHidrocarbTotal) || 0
  const alquiler = Number(gp.alquilerTotal) || 0
  const descuentoTF = Number(gp.descuentoTerminoFijo) || 0
  const descuentoOtros = Number(gp.descuentoOtros) || 0

  const otrosRegulados = terminoFijo + ieh - descuentoTF - descuentoOtros

  const ivaTotalDeclarado = gp.ivaTotal !== undefined && gp.ivaTotal !== null ? Number(gp.ivaTotal) : null
  const ivaPctDeclarado = gp.ivaPorcentaje !== undefined && gp.ivaPorcentaje !== null ? Number(gp.ivaPorcentaje) : null
  const baseImponible = totalEnergia + alquiler + otrosRegulados

  let ivaImporte: number
  let ivaPorcentaje: number
  if (ivaTotalDeclarado !== null && baseImponible > 0) {
    // El ivaTotal real es fiable. Normalizamos el tipo al oficial más cercano
    // para que el cálculo simulado use el tipo correcto (21%, 10%, etc.).
    const ivaCalculado = ivaTotalDeclarado / baseImponible
    ivaImporte = ivaTotalDeclarado
    ivaPorcentaje = normalizarIvaPorcentaje(ivaPctDeclarado, ivaCalculado)
  } else if (ivaPctDeclarado !== null) {
    ivaPorcentaje = ivaPctDeclarado >= 1 ? ivaPctDeclarado / 100 : ivaPctDeclarado
    ivaImporte = baseImponible * ivaPorcentaje
  } else {
    ivaPorcentaje = 0
    ivaImporte = 0
  }
  const totalFactura = baseImponible + ivaImporte

  return {
    totalEnergia,
    totalPotencia: 0,
    excesos: 0,
    bonoSocial: 0,
    alquiler,
    otrosRegulados,
    ieePorcentaje: 0,
    ieeImporte: 0,
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

function indexarPotenciaPorPeriodo(items?: PotenciaItem[]): Record<string, { kw: number; precio: number; dias: number; total: number }> {
  const out: Record<string, { kw: number; precio: number; dias: number; total: number }> = {}
  for (const it of items || []) {
    const p = (it.periodo || '').toUpperCase().trim()
    if (!p) continue
    if (!out[p]) out[p] = { kw: 0, precio: 0, dias: 0, total: 0 }
    out[p].kw = Number(it.kw) || out[p].kw
    out[p].precio = Number(it.precioKwDia) || out[p].precio
    out[p].dias = Number(it.dias) || out[p].dias
    out[p].total = Number(it.total) || out[p].total
  }
  return out
}

/**
 * Estimación contrafactual LUZ:
 *   "¿Cuánto habría pagado el cliente CON LA TARIFA VOLTIS si hubiera
 *    tenido el CONSUMO HISTÓRICO del año pasado?"
 *
 * Es la comparación más justa para aislar el efecto del cambio de
 * comercializadora del efecto de variación de consumo. Permite descomponer
 * el ahorro total en:
 *   - Ahorro por cambio de tarifa  = real_antigua − estimado_contrafactual
 *   - Ahorro por menor consumo     = estimado_contrafactual − real_voltis
 *
 * Metodología paso a paso:
 *  a) Energía: Σ_p (kWh_p_antigua × precio_voltis_p)
 *     Aplicamos los precios actuales de Voltis (peaje TE + energía P.Fijo)
 *     al consumo HISTÓRICO por periodo P1–P6 de la factura antigua.
 *  b) Conceptos no dependientes del consumo (potencia contratada, peajes
 *     de potencia, excesos, bono social, alquiler equipos): se toman
 *     DIRECTAMENTE de la factura Voltis real. Conservador para excesos.
 *  c) IEE: tipo vigente del periodo Voltis aplicado sobre base
 *     (energía_estimada + potencia + excesos + bono social).
 *  d) Base imponible = anterior + alquiler + IEE.
 *  e) IVA = tipo Voltis × base imponible.
 *
 * Validación: aplicar la fórmula (a) con kWh_voltis × precio_voltis debe
 * reproducir el coste de energía real Voltis con error <5€ o <1%. Si no,
 * los precios extraídos son incorrectos y la estimación es poco fiable.
 */
export function estimarLuzVoltisConConsumoAntiguo(
  voltisEco: BillEconomics,
  antiguaEco: BillEconomics,
): { resumen: ResumenFactura; detalle: DetallePeriodoSim[]; validacion: { delta: number; tolerancia: number; ok: boolean } } {
  const voltisCons = indexarConsumoPorPeriodo(voltisEco.consumo)
  const antiguaCons = indexarConsumoPorPeriodo(antiguaEco.consumo)
  const voltisPot = indexarPotenciaPorPeriodo(voltisEco.potencia)

  // Resumen factura Voltis real (de ahí saldrán los regulados, IEE, IVA)
  const real = resumirFactura(voltisEco)

  // Precio medio actual de Voltis (fallback para periodos sin precio extraído)
  const totalEnergiaVoltis = (voltisEco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
  const totalKwhVoltis = (voltisEco.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
  const precioMedioVoltis = totalKwhVoltis > 0 ? totalEnergiaVoltis / totalKwhVoltis : 0

  // ── Estimación contrafactual por periodo P1–P6 ──────────────────────────
  //    kWh_antigua_Pi × precio_voltis_Pi
  const detalle: DetallePeriodoSim[] = []
  let totalEnergiaEstimada = 0

  for (const periodo of PERIODOS_LUZ) {
    const vc = voltisCons[periodo] || { kwh: 0, precio: 0 }
    const ac = antiguaCons[periodo] || { kwh: 0, precio: 0 }
    const vp = voltisPot[periodo] || { kw: 0, precio: 0, dias: 0 }
    if (ac.kwh === 0 && vc.kwh === 0 && vp.kw === 0) continue

    // Usamos el consumo histórico de la antigua y aplicamos el precio Voltis
    // del mismo periodo. Si Voltis no facturó ese periodo, fallback al medio.
    const precioPeriodoVoltis = vc.precio > 0 ? vc.precio : precioMedioVoltis
    const costeEnergiaEstimada = ac.kwh * precioPeriodoVoltis
    totalEnergiaEstimada += costeEnergiaEstimada

    detalle.push({
      periodo,
      // El campo "kwh" del detalle representa los kWh aplicados a la estimación
      // (los HISTÓRICOS, que son los que se contrafactualizan).
      kwh: ac.kwh,
      precioKwhAntigua: ac.precio,
      precioKwhVoltis: precioPeriodoVoltis,
      costeEnergiaSimulada: costeEnergiaEstimada,
      costeEnergiaVoltis: vc.kwh * vc.precio,
      kw: vp.kw,
      dias: vp.dias,
      precioKwDiaAntigua: vp.precio,
      precioKwDiaVoltis: vp.precio,
      costePotenciaSimulada: vp.total || (vp.kw * vp.dias * vp.precio),
      costePotenciaVoltis: vp.total || (vp.kw * vp.dias * vp.precio),
    })
  }

  // ── Conceptos NO dependientes del consumo → de Voltis tal cual ──────────
  //    Cargo potencia + peajes de potencia, excesos, bono social, alquiler.
  //    Conservador: aunque al consumo histórico habría más excesos, mantenemos
  //    los Voltis reales (subestimamos el contrafactual).
  const totalPotencia = real.totalPotencia
  const excesos = real.excesos
  const bonoSocial = real.bonoSocial
  const alquiler = real.alquiler
  const otrosRegulados = real.otrosRegulados

  // ── IEE → tipo vigente del periodo Voltis sobre (energía + pot + exc + bono)
  const ieePorcentaje = real.ieePorcentaje
  const baseIeeEstimada = totalEnergiaEstimada + totalPotencia + excesos + bonoSocial
  const ieeImporteEstimado = baseIeeEstimada * ieePorcentaje

  // ── Base imponible y IVA ────────────────────────────────────────────────
  const ivaPorcentaje = real.ivaPorcentaje
  const baseImponibleEstimada = totalEnergiaEstimada + totalPotencia + excesos + bonoSocial + alquiler + otrosRegulados + ieeImporteEstimado
  const ivaImporteEstimado = baseImponibleEstimada * ivaPorcentaje
  const totalFacturaEstimada = baseImponibleEstimada + ivaImporteEstimado

  // ── Validación: precios Voltis × kWh Voltis ≈ energía Voltis real ───────
  //    Si no cuadra, alguno de los precios extraídos por periodo es incorrecto.
  let energiaRecalculadaVoltis = 0
  for (const periodo of PERIODOS_LUZ) {
    const vc = voltisCons[periodo] || { kwh: 0, precio: 0 }
    energiaRecalculadaVoltis += vc.kwh * vc.precio
  }
  const deltaValidacion = Math.abs(energiaRecalculadaVoltis - totalEnergiaVoltis)
  const toleranciaValidacion = Math.max(5, totalEnergiaVoltis * 0.01)
  const validacion = {
    delta: deltaValidacion,
    tolerancia: toleranciaValidacion,
    ok: deltaValidacion <= toleranciaValidacion,
  }

  const resumen: ResumenFactura = {
    totalEnergia: totalEnergiaEstimada,
    totalPotencia,
    excesos,
    bonoSocial,
    alquiler,
    otrosRegulados,
    ieePorcentaje,
    ieeImporte: ieeImporteEstimado,
    baseImponible: baseImponibleEstimada,
    ivaPorcentaje,
    ivaImporte: ivaImporteEstimado,
    totalFactura: totalFacturaEstimada,
  }
  return { resumen, detalle, validacion }
}

/** @deprecated Alias retro-compatible. Usar estimarLuzVoltisConConsumoAntiguo. */
export const simularLuzAntiguaConConsumoVoltis = (voltis: BillEconomics, antigua: BillEconomics) => {
  const r = estimarLuzVoltisConConsumoAntiguo(voltis, antigua)
  return { resumen: r.resumen, detalle: r.detalle }
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

  // Precios de energía: el TV Precio Fijo (€/kWh) es el único concepto que
  // depende del comercializador. Todo lo demás (TF, peaje, IEH, alquiler) es
  // regulado y se pasa idéntico desde la factura Voltis.
  const precioVoltis = Number(voltisGas.precioKwh) || 0
  let precioAntigua = Number(antiguaGas.precioKwh) || 0
  if (precioAntigua === 0 && antiguaEco.consumo && antiguaEco.consumo.length > 0) {
    const totalAntigua = antiguaEco.consumo.reduce((s, c) => s + (Number(c.total) || 0), 0)
    const kwhAntigua = antiguaEco.consumo.reduce((s, c) => s + (Number(c.kwh) || 0), 0)
    if (kwhAntigua > 0) precioAntigua = totalAntigua / kwhAntigua
  }

  // Real Voltis (con todos los conceptos regulados):
  const real = resumirFactura(voltisEco)

  // Energía simulada: cambia el precio, no el consumo
  const totalEnergiaSim = consumo * precioAntigua

  // Costes regulados pasan IDÉNTICOS desde Voltis (alquiler, TF+IEH+peaje
  // empaquetados en otrosRegulados por resumirFacturaGas).
  const alquiler = real.alquiler
  const otrosRegulados = real.otrosRegulados
  const ivaPorcentaje = real.ivaPorcentaje  // tipo oficial normalizado

  const baseImponibleSim = totalEnergiaSim + alquiler + otrosRegulados

  // IVA simulado: partimos del IVA REAL (que ya está en la factura, lo dejamos
  // como referencia exacta) y le sumamos solo el incremento sobre la energía
  // adicional, con el tipo oficial. Esto reproduce la fórmula del PDF:
  //   Ahorro = (precio_antigua − precio_voltis) × consumo × (1 + IVA)
  const deltaEnergia = totalEnergiaSim - real.totalEnergia
  const ivaImporteSim = real.ivaImporte + deltaEnergia * ivaPorcentaje
  const totalFacturaSim = baseImponibleSim + ivaImporteSim

  const resumen: ResumenFactura = {
    totalEnergia: totalEnergiaSim,
    totalPotencia: 0,
    excesos: 0,
    bonoSocial: 0,
    alquiler,
    otrosRegulados,
    ieePorcentaje: 0,
    ieeImporte: 0,
    baseImponible: baseImponibleSim,
    ivaPorcentaje,
    ivaImporte: ivaImporteSim,
    totalFactura: totalFacturaSim,
  }

  // Detalle "pseudo-periodo" para gas: una sola fila informativa
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

    let estimadoResumen: ResumenFactura
    let detalle: DetallePeriodoSim[]
    let validacionEnergiaVoltis: { delta: number; tolerancia: number; ok: boolean } | undefined

    if (supplyType === 'gas') {
      // Gas: simulación clásica (precio Voltis × consumo Voltis vs precio antigua × consumo Voltis)
      const sim = simularGasAntiguaConConsumoVoltis(voltisEco, antiguaEco)
      estimadoResumen = sim.resumen
      detalle = sim.detalle
    } else {
      // Luz: estimación CONTRAFACTUAL — precios Voltis aplicados al consumo histórico.
      const est = estimarLuzVoltisConConsumoAntiguo(voltisEco, antiguaEco)
      estimadoResumen = est.resumen
      detalle = est.detalle
      validacionEnergiaVoltis = est.validacion
    }

    // ── Descomposición del ahorro ──────────────────────────────────────────
    // LUZ:
    //   ahorroTarifa  = real_antigua − estimado_voltis_con_consumo_antiguo
    //                   (precio antiguo aplicado al consumo del año pasado
    //                    vs. precio Voltis aplicado al mismo consumo)
    //   ahorroConsumo = estimado_voltis_con_consumo_antiguo − real_voltis
    //                   (consumo año pasado vs. consumo año actual con misma tarifa)
    //   ahorroTotal   = real_antigua − real_voltis = tarifa + consumo
    //
    // GAS: la "simulación" del módulo de gas es ya "lo que la antigua habría
    //   cobrado al consumo Voltis", así que la descomposición no aplica del
    //   mismo modo. Para gas, el ahorroTotal es entre la factura simulada
    //   antigua (mismo consumo Voltis) y la real Voltis; el ahorroConsumo
    //   queda en 0 y todo se atribuye a tarifa.
    const ahorroTotalMes = realAntigua.totalFactura - realVoltis.totalFactura
    let ahorroTarifa: number
    let ahorroConsumo: number
    if (supplyType === 'gas') {
      ahorroTarifa = estimadoResumen.totalFactura - realVoltis.totalFactura
      ahorroConsumo = 0
    } else {
      ahorroTarifa = realAntigua.totalFactura - estimadoResumen.totalFactura
      ahorroConsumo = estimadoResumen.totalFactura - realVoltis.totalFactura
    }
    const ahorroPorcentaje = realAntigua.totalFactura > 0
      ? (ahorroTotalMes / realAntigua.totalFactura) * 100
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
      estimadoVoltisConConsumoAntiguo: estimadoResumen,
      simuladoAntigua: estimadoResumen,  // alias retro-compat
      detallePeriodos: detalle,
      ahorroTarifa,
      ahorroConsumo,
      ahorroMes: ahorroTotalMes,
      ahorroPorcentaje,
      validacionEnergiaVoltis,
    })
  }

  // ── Totales agregados ──────────────────────────────────────────────────
  let consumoTotalKwh = 0          // consumo real Voltis (año actual)
  let consumoTotalKwhAntigua = 0   // consumo histórico antigua (año anterior)
  let voltisTotal = 0
  let realAntiguaTotal = 0
  let estimadoTotal = 0
  for (const m of comparativaMeses) {
    consumoTotalKwh += (m.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(m.voltisFactura.consumoTotalKwh) || 0
    consumoTotalKwhAntigua += (m.antiguaFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(m.antiguaFactura.consumoTotalKwh) || 0
    voltisTotal += m.realVoltis.totalFactura
    realAntiguaTotal += m.realAntigua.totalFactura
    estimadoTotal += m.estimadoVoltisConConsumoAntiguo.totalFactura
  }
  // En LUZ: ahorroTotal = real_antigua − real_voltis
  // En GAS: ahorroTotal = estimado (= antigua simulada) − real_voltis (consumo mismo)
  const ahorroTarifaTotal = supplyType === 'gas'
    ? (estimadoTotal - voltisTotal)
    : (realAntiguaTotal - estimadoTotal)
  const ahorroConsumoTotal = supplyType === 'gas' ? 0 : (estimadoTotal - voltisTotal)
  const ahorroTotal = supplyType === 'gas'
    ? (estimadoTotal - voltisTotal)
    : (realAntiguaTotal - voltisTotal)
  const ahorroPorcentaje = supplyType === 'gas'
    ? (estimadoTotal > 0 ? (ahorroTotal / estimadoTotal) * 100 : 0)
    : (realAntiguaTotal > 0 ? (ahorroTotal / realAntiguaTotal) * 100 : 0)

  const eurosPorKwhVoltis = consumoTotalKwh > 0 ? voltisTotal / consumoTotalKwh : 0
  const eurosPorKwhAntigua = consumoTotalKwhAntigua > 0 ? realAntiguaTotal / consumoTotalKwhAntigua : 0

  return {
    supplyType,
    cups,
    tarifa,
    pares: comparativaMeses,
    comercializadoraVoltis,
    comercializadoraAntigua,
    totales: {
      consumoTotalKwh,
      consumoTotalKwhAntigua,
      voltisTotal,
      realAntiguaTotal,
      estimadoConsumoAntiguoTotal: estimadoTotal,
      simuladoAntiguaTotal: estimadoTotal,  // alias retro-compat
      ahorroTarifa: ahorroTarifaTotal,
      ahorroConsumo: ahorroConsumoTotal,
      ahorroTotal,
      ahorroPorcentaje,
      eurosPorKwhVoltis,
      eurosPorKwhAntigua,
      eurosPorKwhSimuladoAntigua: eurosPorKwhAntigua,  // alias retro-compat
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
  let consumoTotalKwhAntigua = 0
  let voltisTotal = 0
  let realAntiguaTotal = 0
  let estimadoTotal = 0
  for (const m of pares) {
    consumoTotalKwh += (m.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(m.voltisFactura.consumoTotalKwh) || 0
    consumoTotalKwhAntigua += (m.antiguaFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(m.antiguaFactura.consumoTotalKwh) || 0
    voltisTotal += m.realVoltis.totalFactura
    realAntiguaTotal += m.realAntigua.totalFactura
    estimadoTotal += m.estimadoVoltisConConsumoAntiguo.totalFactura
  }

  const supplyType = res.supplyType
  const ahorroTarifa = supplyType === 'gas'
    ? (estimadoTotal - voltisTotal)
    : (realAntiguaTotal - estimadoTotal)
  const ahorroConsumo = supplyType === 'gas' ? 0 : (estimadoTotal - voltisTotal)
  const ahorroTotal = supplyType === 'gas'
    ? (estimadoTotal - voltisTotal)
    : (realAntiguaTotal - voltisTotal)
  const ahorroPorcentaje = supplyType === 'gas'
    ? (estimadoTotal > 0 ? (ahorroTotal / estimadoTotal) * 100 : 0)
    : (realAntiguaTotal > 0 ? (ahorroTotal / realAntiguaTotal) * 100 : 0)
  const eurosPorKwhVoltis = consumoTotalKwh > 0 ? voltisTotal / consumoTotalKwh : 0
  const eurosPorKwhAntigua = consumoTotalKwhAntigua > 0 ? realAntiguaTotal / consumoTotalKwhAntigua : 0

  return {
    ...res,
    pares,
    totales: {
      consumoTotalKwh,
      consumoTotalKwhAntigua,
      voltisTotal,
      realAntiguaTotal,
      estimadoConsumoAntiguoTotal: estimadoTotal,
      simuladoAntiguaTotal: estimadoTotal,
      ahorroTarifa,
      ahorroConsumo,
      ahorroTotal,
      ahorroPorcentaje,
      eurosPorKwhVoltis,
      eurosPorKwhAntigua,
      eurosPorKwhSimuladoAntigua: eurosPorKwhAntigua,
    },
  }
}
