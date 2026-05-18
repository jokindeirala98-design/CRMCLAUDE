/**
 * Motor de comparativa 2.0TD para Gana Energía — multi-factura.
 *
 * Mejora sobre Commer: si el cliente tiene varias facturas en el CRM, las
 * usamos TODAS para calcular precios actuales:
 *
 *   - Tarifa FIJA  (variabilidad <3% entre facturas)     → mediana
 *   - Tarifa VARIABLE / INDEXADA (≥3%)                    → media ponderada por kWh
 *
 * Detección "indexada":
 *   - Por keywords en nombre tarifa / comercializadora
 *     (indexada, smart, mercado, spot, vanguardia, tempo, pool, …)
 *   - Por volatilidad: variabilidad >15% en cualquier periodo
 *
 * Si solo hay 1 factura Y se detecta texto indexado → bloquear cálculo
 * con aviso ("Sube más facturas, indexada con 1 factura no es fiable").
 *
 * Fórmula commer-style (IE×IVA, alquiler contador, bono social, fee gestión)
 * se mantiene intacta — solo cambia cómo derivamos `currentEnergyP*` y
 * `currentPowerP*` de las facturas disponibles.
 */

// ─── Constantes ─────────────────────────────────────────────────────────────
export const COMMER_CONSTANTS = {
  ELECTRICITY_IE:                 1.005,
  ELECTRICITY_IVA:                1.1,
  ELECTRICITY_METER_RENTAL_DAY:   0.02663,
  ELECTRICITY_SOCIAL_BONUS_DAY:   0.019122,
  DEFAULT_POWER_PRICE_KW_DAY:     0.115,
  POWER_OPT_MARGIN:               1.1,
  POWER_OPT_MIN_REDUCTION:        0.3,
  DAYS_PER_YEAR:                  365,
  // Variabilidad por encima de la cual consideramos la tarifa no-fija
  VARIABILITY_THRESHOLD_FIXED:    0.03,   // 3%
  VARIABILITY_THRESHOLD_INDEXED:  0.15,   // 15% → claramente indexada
}

const INDEXED_KEYWORDS = [
  'indexad', 'mercado', 'spot', 'pool', 'horario', 'horaria',
  'vanguardia', 'tempo', 'okindex', 'okpool', 'libre', 'plenitud',
  'next', 'smart solar', 'flexilight', 'flexible', 'wonder',
  'naturhouse', 'pvpc',
]

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type GanaTarifaTipo = 'fija_24h' | 'tramos' | 'mercado'
export type TariffNature = 'fija' | 'variable' | 'indexada_detectada' | 'desconocida'

/**
 * Muestra de una factura individual del CRM.
 * Si el periodo no aparece en la factura, dejar undefined (no 0).
 */
export interface BillSample {
  invoiceId?: string
  fechaInicio?: string
  fechaFin?: string
  diasFacturados?: number
  totalFactura?: number              // importe IVA incl.
  comercializadora?: string
  tarifa?: string                    // nombre tarifa (no ATR — el comercial)
  // kWh y precios por periodo (lo que aparezca en esa factura)
  kwhP1?: number; kwhP2?: number; kwhP3?: number
  energyP1?: number; energyP2?: number; energyP3?: number   // €/kWh
  powerP1?: number; powerP2?: number                          // €/kW·día
  // Flags detectados
  hasBonoSocial?: boolean
  bonoSocialDiscount?: number
  fixedFeesMonthly?: number          // Smart Iberdrola etc.
}

export interface InputComparativa2td {
  // Anuales SIPS o reparto fallback
  consumoP1: number
  consumoP2: number
  consumoP3: number
  /** Potencia ACTUALMENTE contratada (la que viene en la factura). */
  potenciaP1: number
  potenciaP2: number
  /**
   * Potencia NUEVA que se contrataría con Gana. Si no viene, se asume
   * igual a la actual. Permite al comercial proponer una optimización
   * (bajar de 10 kW a 8 kW p. ej.) y ver el ahorro real con Gana.
   */
  potenciaNuevaP1?: number
  potenciaNuevaP2?: number
  // Precios actuales (resultado de analizar todas las facturas)
  currentEnergyP1: number
  currentEnergyP2: number
  currentEnergyP3: number
  currentPowerP1: number
  currentPowerP2: number
  // Importe agregado factura (suma de todas)
  totalBillAmount?: number
  diasFacturados?: number
  hasBonoSocial?: boolean
  bonoSocialDiscount?: number
  potenciaMaxDemandadaKw?: number
  fixedFeesMonthly?: number
}

export interface PriceRange {
  min: number
  max: number
  mean: number
  weightedMean: number   // ponderado por kWh
  median: number
  variability: number    // (max - min) / mean
  samples: number
}

export interface PriceAnalysis {
  numBills: number
  tariffNature: TariffNature
  indexedDetectedKeywords: string[]
  energyP1: PriceRange | null
  energyP2: PriceRange | null
  energyP3: PriceRange | null
  powerP1:  PriceRange | null
  powerP2:  PriceRange | null
  // Suma kWh / días total de las facturas (para extrapolar)
  totalKwh: { p1: number; p2: number; p3: number; total: number }
  totalDays: number
  totalAmount: number
}

export interface ScenarioGanaInput {
  tipo: GanaTarifaTipo
  nombre: string
  comercializadora: string         // 'gana' | 'nordy' | ...
  tarifaId?: string                 // uuid en gana_tarifas (para identificar exacta)
  precioP1: number
  precioP2: number
  precioP3: number
  potenciaP1: number
  potenciaP2: number
  managementFeeDay?: number
}

export interface ScenarioResult {
  tipo: GanaTarifaTipo
  nombre: string
  comercializadora: string
  tarifaId?: string
  preciosNuevos: {
    energiaP1: number; energiaP2: number; energiaP3: number
    potenciaP1: number; potenciaP2: number
    managementFeeDay: number
  }
  costeActualAnual: number
  desglose: {
    potenciaAnualNeta: number
    energiaAnualNeta: number
    feeGestionAnual: number
    bonoSocialAnual: number
    baseNetaAnual: number
    impuestosBaseSinAlq: number
    alquilerContadorAnual: number
    descuentoBonoSocial: number
    costeAnualConIva: number
  }
  costeMensualGana: number
  ahorroMensual: number
  ahorroAnual: number
  ahorroPorcentaje: number
}

export interface PowerOptimization {
  contratadoKw: number
  maxDemandadoKw: number
  recomendadoKw: number
  ahorroAnualEur: number
  precioKwDiaUsado: number
}

export interface ComparativaGanaResult {
  scenarioGroup: 'full_2tdcalc' | 'bono_social' | 'tarifa_3_0_personalizada'
                 | 'no_data' | 'indexada_insuficiente'
  scenarios: ScenarioResult[]
  bestScenario: ScenarioResult | null
  warnings: string[]
  notice?: string
  consumoAnualKwh: number
  costeActualAnual: number
  powerOptimization: PowerOptimization | null
  consumoMix: {
    p1: number; p2: number; p3: number
    perfil: 'valle' | 'punta' | 'equilibrado'
    recomendacionTextual: string
  }
  priceAnalysis: PriceAnalysis | null
}

// ─── Helpers numéricos ──────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function rangeOf(values: number[], weights: number[]): PriceRange | null {
  const pairs = values
    .map((v, i) => [v, weights[i] ?? 1] as [number, number])
    .filter(([v, w]) => isFinite(v) && v > 0 && isFinite(w) && w > 0)
  if (pairs.length === 0) return null
  const vals = pairs.map(p => p[0])
  const ws = pairs.map(p => p[1])
  const sumWeights = ws.reduce((a, b) => a + b, 0)
  const weightedMean = pairs.reduce((acc, [v, w]) => acc + v * w, 0) / sumWeights
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const variability = mean > 0 ? (max - min) / mean : 0
  return {
    min, max, mean, weightedMean, median: median(vals),
    variability, samples: vals.length,
  }
}

// ─── Detector indexada por keywords ─────────────────────────────────────────

export function detectIndexedByKeywords(bills: BillSample[]): string[] {
  const found = new Set<string>()
  for (const b of bills) {
    const haystack = [b.tarifa, b.comercializadora].filter(Boolean).join(' ').toLowerCase()
    for (const kw of INDEXED_KEYWORDS) {
      if (haystack.includes(kw)) found.add(kw)
    }
  }
  return Array.from(found)
}

// ─── Análisis de facturas ───────────────────────────────────────────────────

/**
 * Analiza un conjunto de facturas y devuelve precios actuales ponderados +
 * naturaleza de la tarifa (fija / variable / indexada).
 *
 * Usa la regla:
 *   - precio_periodo = media ponderada por kWh consumidos en ese periodo
 *   - Si N=1 factura, mean = median = único valor
 *   - tariff_nature:
 *     · indexed keyword match    → 'indexada_detectada'
 *     · variabilidad >= 15%      → 'variable'  (probablemente indexada)
 *     · 3% ≤ variabilidad < 15%  → 'variable'
 *     · variabilidad < 3%        → 'fija'
 */
export function analyzeBills(bills: BillSample[]): PriceAnalysis {
  const C = COMMER_CONSTANTS

  // Acumuladores para cada periodo
  const collectPrice = (key: 'energyP1'|'energyP2'|'energyP3'|'powerP1'|'powerP2') => {
    const vals: number[] = []
    const weights: number[] = []
    for (const b of bills) {
      const v = (b as any)[key] as number | undefined
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) continue
      // peso = kWh del periodo (para energía) o días facturados (para potencia)
      let w = 1
      if (key === 'energyP1') w = b.kwhP1 ?? 1
      else if (key === 'energyP2') w = b.kwhP2 ?? 1
      else if (key === 'energyP3') w = b.kwhP3 ?? 1
      else if (key.startsWith('power')) w = b.diasFacturados ?? 30
      vals.push(v); weights.push(w)
    }
    return rangeOf(vals, weights)
  }

  const energyP1 = collectPrice('energyP1')
  const energyP2 = collectPrice('energyP2')
  const energyP3 = collectPrice('energyP3')
  const powerP1  = collectPrice('powerP1')
  const powerP2  = collectPrice('powerP2')

  // Totales
  const totalP1 = bills.reduce((a, b) => a + (b.kwhP1 ?? 0), 0)
  const totalP2 = bills.reduce((a, b) => a + (b.kwhP2 ?? 0), 0)
  const totalP3 = bills.reduce((a, b) => a + (b.kwhP3 ?? 0), 0)
  const totalDays = bills.reduce((a, b) => a + (b.diasFacturados ?? 0), 0)
  const totalAmount = bills.reduce((a, b) => a + (b.totalFactura ?? 0), 0)

  // Naturaleza
  const keywords = detectIndexedByKeywords(bills)
  const variabilities = [energyP1, energyP2, energyP3]
    .filter((r): r is PriceRange => !!r)
    .map(r => r.variability)
  const maxVariability = variabilities.length > 0 ? Math.max(...variabilities) : 0

  let tariffNature: TariffNature
  if (keywords.length > 0) tariffNature = 'indexada_detectada'
  else if (bills.length <= 1) tariffNature = 'desconocida'    // solo 1 muestra, no podemos juzgar
  else if (maxVariability >= C.VARIABILITY_THRESHOLD_INDEXED) tariffNature = 'variable'
  else if (maxVariability >= C.VARIABILITY_THRESHOLD_FIXED) tariffNature = 'variable'
  else tariffNature = 'fija'

  return {
    numBills: bills.length,
    tariffNature,
    indexedDetectedKeywords: keywords,
    energyP1, energyP2, energyP3,
    powerP1, powerP2,
    totalKwh: { p1: totalP1, p2: totalP2, p3: totalP3, total: totalP1 + totalP2 + totalP3 },
    totalDays,
    totalAmount,
  }
}

// ─── Cálculo por escenario ─────────────────────────────────────────────────

function tarifaType(tipo: GanaTarifaTipo): 'flat_24h' | 'time_of_use' | 'indexed' {
  if (tipo === 'fija_24h') return 'flat_24h'
  if (tipo === 'mercado') return 'indexed'
  return 'time_of_use'
}

function calcularEscenarioCommer(
  input: InputComparativa2td,
  scenario: ScenarioGanaInput,
  costeActualAnual: number,
): ScenarioResult {
  const C = COMMER_CONSTANTS
  const P = C.ELECTRICITY_IE * C.ELECTRICITY_IVA

  // Potencia a facturar: en el escenario "actual" usamos la potencia
  // realmente contratada hoy; en escenarios Gana usamos la "potencia
  // nueva" propuesta (defaultea a la actual si no se ha indicado).
  const isActualScenario = scenario.comercializadora === 'actual'
  const potP1Aplicada = isActualScenario
    ? input.potenciaP1
    : (input.potenciaNuevaP1 ?? input.potenciaP1)
  const potP2Aplicada = isActualScenario
    ? input.potenciaP2
    : (input.potenciaNuevaP2 ?? input.potenciaP2)
  const ye =
    C.DAYS_PER_YEAR * potP1Aplicada * scenario.potenciaP1
    + C.DAYS_PER_YEAR * potP2Aplicada * scenario.potenciaP2

  const tipoCalculado = tarifaType(scenario.tipo)
  const consumoTotal = input.consumoP1 + input.consumoP2 + input.consumoP3
  const ve = tipoCalculado === 'flat_24h'
    ? scenario.precioP1 * consumoTotal
    : scenario.precioP1 * input.consumoP1
      + scenario.precioP2 * input.consumoP2
      + scenario.precioP3 * input.consumoP3

  const feeDay = scenario.managementFeeDay ?? 0
  const feeAnual = feeDay * C.DAYS_PER_YEAR

  const tieneBonoEfectivo = !!input.hasBonoSocial && (input.bonoSocialDiscount ?? 0) > 2
  const bonoSocialAnual = tieneBonoEfectivo ? 0 : C.ELECTRICITY_SOCIAL_BONUS_DAY * C.DAYS_PER_YEAR
  const descuentoBono = input.bonoSocialDiscount ?? 0

  const baseNeta = ye + ve + feeAnual + bonoSocialAnual
  const impuestosBase = baseNeta * P
  const alquilerAnual = C.ELECTRICITY_METER_RENTAL_DAY * C.DAYS_PER_YEAR * C.ELECTRICITY_IVA
  const costeAnualConIva = impuestosBase + alquilerAnual - descuentoBono

  const ahorroAnual = costeActualAnual - costeAnualConIva
  return {
    tipo: scenario.tipo,
    nombre: scenario.nombre,
    comercializadora: scenario.comercializadora,
    tarifaId: scenario.tarifaId,
    preciosNuevos: {
      energiaP1: scenario.precioP1, energiaP2: scenario.precioP2, energiaP3: scenario.precioP3,
      potenciaP1: scenario.potenciaP1, potenciaP2: scenario.potenciaP2,
      managementFeeDay: feeDay,
    },
    costeActualAnual,
    desglose: {
      potenciaAnualNeta: ye, energiaAnualNeta: ve, feeGestionAnual: feeAnual,
      bonoSocialAnual, baseNetaAnual: baseNeta,
      impuestosBaseSinAlq: impuestosBase, alquilerContadorAnual: alquilerAnual,
      descuentoBonoSocial: descuentoBono, costeAnualConIva,
    },
    costeMensualGana: costeAnualConIva / 12,
    ahorroMensual: ahorroAnual / 12,
    ahorroAnual,
    ahorroPorcentaje: costeActualAnual > 0 ? (ahorroAnual / costeActualAnual) * 100 : 0,
  }
}

function calcularCosteActual(input: InputComparativa2td): number {
  // Vía 1: factura extrapolada
  if (input.totalBillAmount && input.diasFacturados && input.diasFacturados > 0) {
    return input.totalBillAmount * (COMMER_CONSTANTS.DAYS_PER_YEAR / input.diasFacturados)
  }
  // Vía 2: fórmula con precios actuales
  const scenario: ScenarioGanaInput = {
    tipo: 'tramos', nombre: 'Actual',
    comercializadora: 'actual',
    precioP1: input.currentEnergyP1, precioP2: input.currentEnergyP2, precioP3: input.currentEnergyP3,
    potenciaP1: input.currentPowerP1, potenciaP2: input.currentPowerP2,
    managementFeeDay: 0,
  }
  const dummy = calcularEscenarioCommer(input, scenario, 0)
  return dummy.desglose.costeAnualConIva
}

function analizarPotencia(input: InputComparativa2td): PowerOptimization | null {
  const C = COMMER_CONSTANTS
  const ue = input.potenciaMaxDemandadaKw ?? 0
  const ye = input.potenciaP1
  if (ue <= 0 || ye <= 0) return null
  const ve = Math.ceil(ue * C.POWER_OPT_MARGIN * 10) / 10
  if (ve > ye - C.POWER_OPT_MIN_REDUCTION) return null
  const precioSuma = input.currentPowerP1 + input.currentPowerP2
  const precioUsado = precioSuma > 0 ? precioSuma : C.DEFAULT_POWER_PRICE_KW_DAY
  const P = C.ELECTRICITY_IE * C.ELECTRICITY_IVA
  const ahorroAnualEur = Math.round((ye - ve) * precioUsado * C.DAYS_PER_YEAR * P)
  return {
    contratadoKw: Math.round(ye * 10) / 10,
    maxDemandadoKw: Math.round(ue * 100) / 100,
    recomendadoKw: ve, ahorroAnualEur, precioKwDiaUsado: precioUsado,
  }
}

function analizarMix(input: InputComparativa2td): ComparativaGanaResult['consumoMix'] {
  const total = input.consumoP1 + input.consumoP2 + input.consumoP3
  if (total <= 0) {
    return { p1: 0, p2: 0, p3: 0, perfil: 'equilibrado',
      recomendacionTextual: 'Sin datos de consumo, sugerimos la opción que maximice ahorro.' }
  }
  const p1 = input.consumoP1 / total
  const p2 = input.consumoP2 / total
  const p3 = input.consumoP3 / total
  if (p3 > 0.4) return { p1, p2, p3, perfil: 'valle',
    recomendacionTextual: 'Como concentras consumo en horas valle, la tarifa por tramos es la más eficiente.' }
  if (p1 > 0.4) return { p1, p2, p3, perfil: 'punta',
    recomendacionTextual: 'Tu consumo medio/diurno es alto. Una tarifa 24h a precio estable te protegerá de sobresaltos.' }
  return { p1, p2, p3, perfil: 'equilibrado',
    recomendacionTextual: 'Perfil equilibrado. Sugerimos la opción que maximice el ahorro a largo plazo.' }
}

// ─── API pública: multi-factura ─────────────────────────────────────────────

export interface ComputarComparativaMultiArgs {
  /** Anuales SIPS (potencias y consumos por periodo) */
  potenciaP1: number
  potenciaP2: number
  consumoP1: number
  consumoP2: number
  consumoP3: number
  /** Facturas extraídas */
  bills: BillSample[]
  /** Tarifas Gana a comparar */
  scenarios: ScenarioGanaInput[]
  /** Optimización potencia opcional */
  potenciaMaxDemandadaKw?: number
  /** Potencia propuesta para Gana — defaultea a actual. */
  potenciaNuevaP1?: number
  potenciaNuevaP2?: number
}

export function computarComparativaGanaMulti(args: ComputarComparativaMultiArgs): ComparativaGanaResult {
  const { bills, scenarios, potenciaP1, potenciaP2, consumoP1, consumoP2, consumoP3 } = args

  const consumoAnualKwh = consumoP1 + consumoP2 + consumoP3
  const warnings: string[] = []

  // ── Bono social → mantener ───────────────────────────────────────────────
  const bonoBill = bills.find(b => b.hasBonoSocial)
  if (bonoBill) {
    return {
      scenarioGroup: 'bono_social',
      scenarios: [], bestScenario: null, warnings: [],
      notice: 'Bono Social detectado: el mercado libre no compite con esta ayuda estatal. Mantener la tarifa actual.',
      consumoAnualKwh,
      costeActualAnual: bills.reduce((a, b) => a + (b.totalFactura ?? 0), 0)
                       * (365 / Math.max(1, bills.reduce((a, b) => a + (b.diasFacturados ?? 0), 0))),
      powerOptimization: null,
      consumoMix: analizarMix({ consumoP1, consumoP2, consumoP3 } as InputComparativa2td),
      priceAnalysis: analyzeBills(bills),
    }
  }

  // ── 3.0TD (potencia > 15 kW) ─────────────────────────────────────────────
  const maxPot = Math.max(potenciaP1, potenciaP2)
  if (maxPot > 15) {
    return {
      scenarioGroup: 'tarifa_3_0_personalizada',
      scenarios: [], bestScenario: null, warnings: [],
      notice: `Tarifa 3.0TD detectada (${maxPot} kW). Requiere estudio personalizado.`,
      consumoAnualKwh, costeActualAnual: 0,
      powerOptimization: null,
      consumoMix: analizarMix({ consumoP1, consumoP2, consumoP3 } as InputComparativa2td),
      priceAnalysis: analyzeBills(bills),
    }
  }

  // ── Análisis de facturas ─────────────────────────────────────────────────
  const priceAnalysis = analyzeBills(bills)

  // ── Indexada detectada + solo 1 factura → bloquear ───────────────────────
  if (priceAnalysis.numBills === 1 && priceAnalysis.tariffNature === 'indexada_detectada') {
    return {
      scenarioGroup: 'indexada_insuficiente',
      scenarios: [], bestScenario: null, warnings: [],
      notice: `Tarifa indexada detectada en factura (${priceAnalysis.indexedDetectedKeywords.join(', ')}). Una sola factura no es representativa: los precios varían mes a mes. Sube al menos 3 facturas (idealmente 6-12) para una comparativa fiable.`,
      consumoAnualKwh, costeActualAnual: 0,
      powerOptimization: null,
      consumoMix: analizarMix({ consumoP1, consumoP2, consumoP3 } as InputComparativa2td),
      priceAnalysis,
    }
  }

  // ── Precios actuales: si fija → mediana, si variable → media ponderada ──
  function priceFromRange(r: PriceRange | null): number {
    if (!r) return 0
    if (priceAnalysis.tariffNature === 'fija') return r.median
    return r.weightedMean
  }

  const currentEnergyP1 = priceFromRange(priceAnalysis.energyP1)
  const currentEnergyP2 = priceFromRange(priceAnalysis.energyP2)
  const currentEnergyP3 = priceFromRange(priceAnalysis.energyP3)
  const currentPowerP1  = priceFromRange(priceAnalysis.powerP1)
  const currentPowerP2  = priceFromRange(priceAnalysis.powerP2)

  // Smart Iberdrola etc — coger el promedio mensual de fees fijos
  const fixedFeesMonthly = bills.length > 0
    ? bills.reduce((a, b) => a + (b.fixedFeesMonthly ?? 0), 0) / bills.length
    : 0

  // Avisos
  if (priceAnalysis.tariffNature === 'variable' && priceAnalysis.numBills < 3) {
    warnings.push(
      `Detectada variabilidad en precios entre facturas (${priceAnalysis.numBills} muestras). ` +
      `Para mayor precisión, sube al menos 3 facturas.`,
    )
  }
  if (priceAnalysis.tariffNature === 'indexada_detectada' && priceAnalysis.numBills < 6) {
    warnings.push(
      `Tarifa indexada detectada por keywords (${priceAnalysis.indexedDetectedKeywords.join(', ')}). ` +
      `Con solo ${priceAnalysis.numBills} factura(s) la media puede no ser representativa.`,
    )
  }
  if (fixedFeesMonthly > 0) {
    warnings.push(
      `Detectados cargos fijos en facturas (~${fixedFeesMonthly.toFixed(2)} €/mes). ` +
      `No se incluyen en el cálculo — tenlo en cuenta al presentar el total.`,
    )
  }
  if (consumoAnualKwh <= 0) warnings.push('Consumo anual = 0. Sincroniza SIPS.')
  if (currentEnergyP1 <= 0 && currentEnergyP2 <= 0 && currentEnergyP3 <= 0) {
    warnings.push('Precios energía actuales no extraídos. Revisa las facturas.')
  }

  if (consumoAnualKwh <= 0 || (currentEnergyP1 <= 0 && currentEnergyP2 <= 0)) {
    return {
      scenarioGroup: 'no_data',
      scenarios: [], bestScenario: null, warnings,
      notice: 'Faltan datos clave (consumo o precios). Sincroniza SIPS y/o sube facturas legibles.',
      consumoAnualKwh, costeActualAnual: 0,
      powerOptimization: null,
      consumoMix: analizarMix({ consumoP1, consumoP2, consumoP3 } as InputComparativa2td),
      priceAnalysis,
    }
  }

  // ── Construir input final ────────────────────────────────────────────────
  const input: InputComparativa2td = {
    consumoP1, consumoP2, consumoP3,
    potenciaP1, potenciaP2,
    potenciaNuevaP1: args.potenciaNuevaP1,
    potenciaNuevaP2: args.potenciaNuevaP2,
    currentEnergyP1, currentEnergyP2, currentEnergyP3,
    currentPowerP1, currentPowerP2,
    totalBillAmount: priceAnalysis.totalAmount || undefined,
    diasFacturados: priceAnalysis.totalDays || undefined,
    hasBonoSocial: false,
    potenciaMaxDemandadaKw: args.potenciaMaxDemandadaKw,
    fixedFeesMonthly,
  }

  const costeActualAnual = calcularCosteActual(input)
  const results = scenarios.map(s => calcularEscenarioCommer(input, s, costeActualAnual))
  const sorted = [...results].sort((a, b) => b.ahorroAnual - a.ahorroAnual)

  return {
    scenarioGroup: 'full_2tdcalc',
    scenarios: results,
    bestScenario: sorted[0] ?? null,
    warnings,
    consumoAnualKwh,
    costeActualAnual,
    powerOptimization: analizarPotencia(input),
    consumoMix: analizarMix(input),
    priceAnalysis,
  }
}

// ─── Legacy: single-bill API (mantener compatibilidad) ──────────────────────

export interface ComputarComparativaArgs {
  input: InputComparativa2td
  scenarios: ScenarioGanaInput[]
}

export function computarComparativaGana(args: ComputarComparativaArgs): ComparativaGanaResult {
  // Convertir input legacy a una sola "factura" sintética
  const synthetic: BillSample = {
    diasFacturados: args.input.diasFacturados,
    totalFactura: args.input.totalBillAmount,
    kwhP1: args.input.consumoP1 / 12,
    kwhP2: args.input.consumoP2 / 12,
    kwhP3: args.input.consumoP3 / 12,
    energyP1: args.input.currentEnergyP1,
    energyP2: args.input.currentEnergyP2,
    energyP3: args.input.currentEnergyP3,
    powerP1: args.input.currentPowerP1,
    powerP2: args.input.currentPowerP2,
    hasBonoSocial: args.input.hasBonoSocial,
    bonoSocialDiscount: args.input.bonoSocialDiscount,
    fixedFeesMonthly: args.input.fixedFeesMonthly,
  }
  return computarComparativaGanaMulti({
    potenciaP1: args.input.potenciaP1,
    potenciaP2: args.input.potenciaP2,
    potenciaNuevaP1: args.input.potenciaNuevaP1,
    potenciaNuevaP2: args.input.potenciaNuevaP2,
    consumoP1: args.input.consumoP1,
    consumoP2: args.input.consumoP2,
    consumoP3: args.input.consumoP3,
    bills: [synthetic],
    scenarios: args.scenarios,
    potenciaMaxDemandadaKw: args.input.potenciaMaxDemandadaKw,
  })
}

// ─── Builder de escenarios desde gana_tarifas ──────────────────────────────

export interface GanaTarifaRow {
  id: string
  comercializadora?: string         // 'gana' | 'nordy' | …
  nombre: string
  tipo: GanaTarifaTipo
  precio_p1: number | null
  precio_p2: number | null
  precio_p3: number | null
  potencia_p1: number | null
  potencia_p2: number | null
  extras_anuales: number | null
  management_fee_day?: number | null
}

/**
 * Construye los ScenarioGanaInput agrupando por comercializadora.
 * Acepta tarifas de múltiples comercializadoras (Gana, Nordy, …).
 * Para cada comercializadora, 24H y Tramos comparten potencias.
 * Devuelve todos los escenarios disponibles (5 = 3 Gana + 2 Nordy actualmente).
 */
export function buildScenariosFromTarifas(rows: GanaTarifaRow[]): ScenarioGanaInput[] {
  // Agrupar por comercializadora
  const groups = new Map<string, GanaTarifaRow[]>()
  for (const r of rows) {
    const comerc = (r.comercializadora || 'gana').toLowerCase()
    const arr = groups.get(comerc) || []
    arr.push(r)
    groups.set(comerc, arr)
  }

  const scenarios: ScenarioGanaInput[] = []

  for (const [comerc, list] of groups.entries()) {
    const f24 = list.find(r => r.tipo === 'fija_24h')
    const tra = list.find(r => r.tipo === 'tramos')
    const mer = list.find(r => r.tipo === 'mercado')

    // Dentro de cada comercializadora, 24H y Tramos comparten potencias
    const sharedPotP1 = f24?.potencia_p1 ?? tra?.potencia_p1 ?? 0
    const sharedPotP2 = f24?.potencia_p2 ?? tra?.potencia_p2 ?? 0

    const mercadoFeeDay = mer?.extras_anuales
      ? (mer.extras_anuales / 365)
      : (mer?.management_fee_day ?? 0)

    if (f24) scenarios.push({
      tipo: 'fija_24h',
      nombre: f24.nombre,
      comercializadora: comerc,
      tarifaId: f24.id,
      precioP1: f24.precio_p1 ?? 0,
      precioP2: f24.precio_p2 ?? f24.precio_p1 ?? 0,
      precioP3: f24.precio_p3 ?? f24.precio_p1 ?? 0,
      potenciaP1: sharedPotP1, potenciaP2: sharedPotP2,
      managementFeeDay: f24.management_fee_day ?? 0,
    })
    if (tra) scenarios.push({
      tipo: 'tramos',
      nombre: tra.nombre,
      comercializadora: comerc,
      tarifaId: tra.id,
      precioP1: tra.precio_p1 ?? 0, precioP2: tra.precio_p2 ?? 0, precioP3: tra.precio_p3 ?? 0,
      potenciaP1: sharedPotP1, potenciaP2: sharedPotP2,
      managementFeeDay: tra.management_fee_day ?? 0,
    })
    if (mer) scenarios.push({
      tipo: 'mercado',
      nombre: mer.nombre,
      comercializadora: comerc,
      tarifaId: mer.id,
      precioP1: mer.precio_p1 ?? 0, precioP2: mer.precio_p2 ?? 0, precioP3: mer.precio_p3 ?? 0,
      potenciaP1: mer.potencia_p1 ?? 0, potenciaP2: mer.potencia_p2 ?? 0,
      managementFeeDay: mercadoFeeDay,
    })
  }

  return scenarios
}
