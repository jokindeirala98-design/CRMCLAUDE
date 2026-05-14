/**
 * Motor de comparativa 2.0TD para Gana Energía.
 *
 * Implementación basada en la lógica desensamblada de commer.es. Reemplaza
 * la fórmula simplificada anterior. La fórmula real considera:
 *
 *   - Impuesto Eléctrico (IE = 1.005)
 *   - IVA (1.1 = 10%, tipo aplicable en España actualmente)
 *   - Alquiler de contador (€/día) que SOLO lleva IVA, no IE
 *   - Financiación del bono social (€/día) que se cobra si NO tiene bono
 *   - Descuento bono social (se resta al final)
 *   - Fee de gestión diario del comercializador (parte de la base imponible)
 *
 * Casos especiales (heredados de commer):
 *   - has_bono_social=true → no se recomienda cambiar (el Estado da mejor descuento)
 *   - potencia_contratada > 15 kW → 3.0TD: tarifa personalizada empresa
 *   - solo se calculan tarifas con supply_type='electricity' y access_tariff='2.0TD'
 *
 * Optimización de potencia (commer):
 *   - Si potenciaMaxDemandada está disponible
 *   - Recomendar = ceil(maxDemandada × 1.1 × 10) / 10  (10% margen, redondeo 0.1)
 *   - Solo aplicar si recomendada ≤ contratada - 0.3 (al menos 0.3 kW reducible)
 *   - Ahorro = (contratada - recomendada) × (precio_kw_dia_P1 + precio_kw_dia_P2 || 0.115) × 365 × IE × IVA
 *
 * Mix de consumo (recomendación textual):
 *   - P3/total > 40%  → tramos horarios
 *   - P1/total > 40%  → fija 24h
 *   - equilibrado     → la que maximice ahorro
 */

// ─── Constantes (extraídas de commer.js, válidas a mayo 2026) ────────────────
export const COMMER_CONSTANTS = {
  ELECTRICITY_IE:                 1.005,       // factor impuesto eléctrico
  ELECTRICITY_IVA:                1.1,         // 10% IVA reducido electricidad
  ELECTRICITY_METER_RENTAL_DAY:   0.02663,     // €/día alquiler contador
  ELECTRICITY_SOCIAL_BONUS_DAY:   0.019122,    // €/día financiación bono social
  DEFAULT_POWER_PRICE_KW_DAY:     0.115,       // fallback precio potencia €/kW·día
  POWER_OPT_MARGIN:               1.1,         // recomendar 110% del máximo
  POWER_OPT_MIN_REDUCTION:        0.3,         // mínimo 0.3 kW para sugerir baja
  DAYS_PER_YEAR:                  365,
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface InputComparativa2td {
  /** Consumos anuales kWh por periodo (preferred: SIPS) */
  consumoP1: number
  consumoP2: number
  consumoP3: number
  /** Potencias contratadas (kW). Para 2.0TD solo P1 y P2 */
  potenciaP1: number
  potenciaP2: number
  /** Precios actuales (€/kWh) extraídos de la factura más reciente */
  currentEnergyP1: number
  currentEnergyP2: number
  currentEnergyP3: number
  /** Precios actuales potencia €/kW·día */
  currentPowerP1: number
  currentPowerP2: number
  /** Importe total factura analizada (€) extrapolable a 365 días */
  totalBillAmount?: number
  /** Días facturados en la factura analizada */
  diasFacturados?: number
  /** Bono Social: true si activo, descuento monetario si conocido */
  hasBonoSocial?: boolean
  bonoSocialDiscount?: number
  /** Potencia máxima demandada (kW) — de SIPS / maxímetro, para optimización */
  potenciaMaxDemandadaKw?: number
  /** Cargos fijos opcionales detectados en factura (Smart Iberdrola, etc) */
  fixedFeesMonthly?: number
}

export type GanaTarifaTipo = 'fija_24h' | 'tramos' | 'mercado'

export interface ScenarioGanaInput {
  tipo: GanaTarifaTipo
  nombre: string
  /** Precios energía Gana */
  precioP1: number
  precioP2: number
  precioP3: number
  /** Precios potencia Gana */
  potenciaP1: number          // €/kW·día
  potenciaP2: number
  /** Fee de gestión diario del comercializador (€/día) */
  managementFeeDay?: number
}

export interface ScenarioResult {
  tipo: GanaTarifaTipo
  nombre: string
  preciosNuevos: {
    energiaP1: number; energiaP2: number; energiaP3: number
    potenciaP1: number; potenciaP2: number
    managementFeeDay: number
  }
  /** Coste actual anual con IVA (extrapolado a 365 días) */
  costeActualAnual: number
  /** Desglose del cálculo Gana (commer style) */
  desglose: {
    potenciaAnualNeta:   number   // base imponible potencia
    energiaAnualNeta:    number   // base imponible energía
    feeGestionAnual:     number   // fee gestión × 365
    bonoSocialAnual:     number   // financiación bono (0 si tiene bono)
    baseNetaAnual:       number   // suma de los anteriores
    impuestosBaseSinAlq: number   // base × IE × IVA
    alquilerContadorAnual: number // 0.02663 × 365 × IVA (solo IVA, no IE)
    descuentoBonoSocial: number   // se resta al final si tiene bono
    costeAnualConIva:    number   // total con todo
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
  /** Categoría: full2tdcalc | bono_social | tarifa_3_0_personalizada */
  scenarioGroup: 'full_2tdcalc' | 'bono_social' | 'tarifa_3_0_personalizada' | 'no_data'
  scenarios: ScenarioResult[]
  bestScenario: ScenarioResult | null
  warnings: string[]
  notice?: string                       // mensaje destacado (bono / 3.0TD / etc.)
  consumoAnualKwh: number
  costeActualAnual: number              // referencia para %s
  powerOptimization: PowerOptimization | null
  consumoMix: {                         // % por periodo
    p1: number; p2: number; p3: number
    perfil: 'valle' | 'punta' | 'equilibrado'
    recomendacionTextual: string
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determina si una tarifa es flat 24h, tramos o indexada — afecta cómo se
 * suman los kWh × precios.
 */
function tarifaType(tipo: GanaTarifaTipo): 'flat_24h' | 'time_of_use' | 'indexed' {
  if (tipo === 'fija_24h') return 'flat_24h'
  if (tipo === 'mercado') return 'indexed'
  return 'time_of_use'
}

/**
 * Cálculo de coste anual para una tarifa Gana con la fórmula Commer.
 */
function calcularEscenarioCommer(
  input: InputComparativa2td,
  scenario: ScenarioGanaInput,
  costeActualAnual: number,
): ScenarioResult {
  const C = COMMER_CONSTANTS
  const P = C.ELECTRICITY_IE * C.ELECTRICITY_IVA      // 1.005 × 1.1 = 1.1055

  // El método Commer usa una sola potencia "w" multiplicada por la SUMA de
  // precios P1+P2 — asumiendo potP1 == potP2 contratadas. Para 2.0TD con
  // distintos kW por periodo, lo desglosamos por periodo y sumamos:
  const ye =
    C.DAYS_PER_YEAR * input.potenciaP1 * scenario.potenciaP1
    + C.DAYS_PER_YEAR * input.potenciaP2 * scenario.potenciaP2

  // Energía: si tarifa flat_24h, usar precio P1 para todo el consumo; en
  // tramos / indexada, multiplicar por periodo.
  const tipoCalculado = tarifaType(scenario.tipo)
  const consumoTotal = input.consumoP1 + input.consumoP2 + input.consumoP3
  let ve: number
  if (tipoCalculado === 'flat_24h') {
    ve = scenario.precioP1 * consumoTotal
  } else {
    ve = scenario.precioP1 * input.consumoP1
      + scenario.precioP2 * input.consumoP2
      + scenario.precioP3 * input.consumoP3
  }

  // Fee de gestión anual
  const feeDay = scenario.managementFeeDay ?? 0
  const feeAnual = feeDay * C.DAYS_PER_YEAR

  // Bono social financing (€/día) — si el cliente NO tiene bono social
  const tieneBonoEfectivo = !!input.hasBonoSocial && (input.bonoSocialDiscount ?? 0) > 2
  const bonoSocialAnual = tieneBonoEfectivo ? 0 : C.ELECTRICITY_SOCIAL_BONUS_DAY * C.DAYS_PER_YEAR
  const descuentoBono = input.bonoSocialDiscount ?? 0

  // Base neta anual = potencia + energía + fee + bono social
  const baseNeta = ye + ve + feeAnual + bonoSocialAnual

  // Aplicar IE × IVA a la base
  const impuestosBase = baseNeta * P

  // Alquiler contador: solo IVA (no IE)
  const alquilerAnual = C.ELECTRICITY_METER_RENTAL_DAY * C.DAYS_PER_YEAR * C.ELECTRICITY_IVA

  // Total final
  const costeAnualConIva = impuestosBase + alquilerAnual - descuentoBono

  const ahorroAnual = costeActualAnual - costeAnualConIva
  const costeMensualGana = costeAnualConIva / 12
  const ahorroMensual = ahorroAnual / 12
  const ahorroPorcentaje = costeActualAnual > 0 ? (ahorroAnual / costeActualAnual) * 100 : 0

  return {
    tipo: scenario.tipo,
    nombre: scenario.nombre,
    preciosNuevos: {
      energiaP1: scenario.precioP1,
      energiaP2: scenario.precioP2,
      energiaP3: scenario.precioP3,
      potenciaP1: scenario.potenciaP1,
      potenciaP2: scenario.potenciaP2,
      managementFeeDay: feeDay,
    },
    costeActualAnual,
    desglose: {
      potenciaAnualNeta: ye,
      energiaAnualNeta: ve,
      feeGestionAnual: feeAnual,
      bonoSocialAnual,
      baseNetaAnual: baseNeta,
      impuestosBaseSinAlq: impuestosBase,
      alquilerContadorAnual: alquilerAnual,
      descuentoBonoSocial: descuentoBono,
      costeAnualConIva,
    },
    costeMensualGana,
    ahorroMensual,
    ahorroAnual,
    ahorroPorcentaje,
  }
}

/**
 * Calcula el coste actual anual con la fórmula Commer (no la factura
 * extrapolada). Esto permite comparar manzanas con manzanas: el "actual" y
 * el "nuevo" están calculados con la misma estructura impositiva.
 *
 * Si totalBillAmount + diasFacturados están disponibles, también devuelve
 * la factura extrapolada como referencia secundaria.
 */
function calcularCosteActual(input: InputComparativa2td): {
  costeActualAnual: number
  costeViaFormulaActual: number
  costeViaFacturaExtrapolada: number | null
} {
  // Vía factura: extrapolar a 365 días si tenemos importe y días
  let costeViaFactura: number | null = null
  if (input.totalBillAmount && input.diasFacturados && input.diasFacturados > 0) {
    costeViaFactura = input.totalBillAmount * (COMMER_CONSTANTS.DAYS_PER_YEAR / input.diasFacturados)
  }

  // Vía fórmula con precios actuales (commer-style)
  const actualScenario: ScenarioGanaInput = {
    tipo: 'tramos',                 // los precios actuales son por periodo
    nombre: 'Actual',
    precioP1: input.currentEnergyP1,
    precioP2: input.currentEnergyP2,
    precioP3: input.currentEnergyP3,
    potenciaP1: input.currentPowerP1,
    potenciaP2: input.currentPowerP2,
    managementFeeDay: 0,            // no conocido para tarifa actual
  }
  // Reutilizamos calcularEscenarioCommer pero pasando coste actual=0 para
  // evitar recursión. Solo nos interesa costeAnualConIva.
  const dummy = calcularEscenarioCommer(input, actualScenario, 0)
  const costeViaFormula = dummy.desglose.costeAnualConIva

  // Preferimos la factura real si está; si no, fórmula
  const finalAnual = costeViaFactura ?? costeViaFormula

  return {
    costeActualAnual: finalAnual,
    costeViaFormulaActual: costeViaFormula,
    costeViaFacturaExtrapolada: costeViaFactura,
  }
}

/**
 * Análisis de optimización de potencia (Commer).
 */
function analizarPotencia(input: InputComparativa2td): PowerOptimization | null {
  const C = COMMER_CONSTANTS
  const ue = input.potenciaMaxDemandadaKw ?? 0
  const ye = input.potenciaP1
  if (ue <= 0 || ye <= 0) return null

  const ve = Math.ceil(ue * C.POWER_OPT_MARGIN * 10) / 10
  if (ve > ye - C.POWER_OPT_MIN_REDUCTION) return null

  // Precio €/kW·día efectivo (suma P1+P2 actuales, o fallback 0.115)
  const precioSuma = input.currentPowerP1 + input.currentPowerP2
  const precioUsado = precioSuma > 0 ? precioSuma : C.DEFAULT_POWER_PRICE_KW_DAY
  const P = C.ELECTRICITY_IE * C.ELECTRICITY_IVA
  const ahorroAnualEur = Math.round((ye - ve) * precioUsado * C.DAYS_PER_YEAR * P)

  return {
    contratadoKw: Math.round(ye * 10) / 10,
    maxDemandadoKw: Math.round(ue * 100) / 100,
    recomendadoKw: ve,
    ahorroAnualEur,
    precioKwDiaUsado: precioUsado,
  }
}

/**
 * Análisis del mix de consumo (Commer).
 */
function analizarMix(input: InputComparativa2td): ComparativaGanaResult['consumoMix'] {
  const total = input.consumoP1 + input.consumoP2 + input.consumoP3
  if (total <= 0) {
    return { p1: 0, p2: 0, p3: 0, perfil: 'equilibrado',
      recomendacionTextual: 'Sin datos de consumo, sugerimos la opción que maximice ahorro.' }
  }
  const p1 = input.consumoP1 / total
  const p2 = input.consumoP2 / total
  const p3 = input.consumoP3 / total

  if (p3 > 0.4) {
    return { p1, p2, p3, perfil: 'valle',
      recomendacionTextual: 'Como concentras buena parte del consumo en horas valle, la tarifa por tramos es la más eficiente.' }
  }
  if (p1 > 0.4) {
    return { p1, p2, p3, perfil: 'punta',
      recomendacionTextual: 'Tu consumo medio/diurno es alto. Una tarifa 24h a precio estable te protegerá de sobresaltos.' }
  }
  return { p1, p2, p3, perfil: 'equilibrado',
    recomendacionTextual: 'Tienes un perfil equilibrado. Sugerimos la opción que maximice el ahorro a largo plazo.' }
}

// ─── API pública ────────────────────────────────────────────────────────────

export interface ComputarComparativaArgs {
  input: InputComparativa2td
  scenarios: ScenarioGanaInput[]
}

export function computarComparativaGana(args: ComputarComparativaArgs): ComparativaGanaResult {
  const { input, scenarios } = args

  const warnings: string[] = []
  const consumoAnualKwh = input.consumoP1 + input.consumoP2 + input.consumoP3

  // ── Caso especial 1: Bono Social activo ──────────────────────────────────
  if (input.hasBonoSocial) {
    return {
      scenarioGroup: 'bono_social',
      scenarios: [],
      bestScenario: null,
      warnings: [],
      notice: 'Hemos detectado que te beneficias del Bono Social eléctrico. El mercado libre no cuenta con este tipo de ayudas, por lo que cambiar saldría más caro. Recomendamos mantener tu contrato actual.',
      consumoAnualKwh,
      costeActualAnual: input.totalBillAmount && input.diasFacturados
        ? input.totalBillAmount * (365 / input.diasFacturados)
        : 0,
      powerOptimization: null,
      consumoMix: analizarMix(input),
    }
  }

  // ── Caso especial 2: 3.0TD (potencia > 15 kW) ────────────────────────────
  const maxPot = Math.max(input.potenciaP1, input.potenciaP2)
  if (maxPot > 15) {
    return {
      scenarioGroup: 'tarifa_3_0_personalizada',
      scenarios: [],
      bestScenario: null,
      warnings: [],
      notice: `Hemos detectado un suministro con tarifa 3.0TD (potencia contratada: ${maxPot} kW). Al tratarse de un contrato con potencia elevada (empresa, PYME, oficina, etc.), un asesor energético se pondrá en contacto contigo para ofrecerte la mejor tarifa personalizada.`,
      consumoAnualKwh,
      costeActualAnual: input.totalBillAmount && input.diasFacturados
        ? input.totalBillAmount * (365 / input.diasFacturados)
        : 0,
      powerOptimization: null,
      consumoMix: analizarMix(input),
    }
  }

  // ── Validaciones suaves ──────────────────────────────────────────────────
  if (consumoAnualKwh <= 0) {
    warnings.push('Consumo anual = 0. Comprueba SIPS / facturas del último año.')
  }
  if (input.potenciaP1 <= 0 && input.potenciaP2 <= 0) {
    warnings.push('Potencias contratadas = 0. Revisa los datos SIPS.')
  }
  if (input.currentEnergyP1 <= 0 && input.currentEnergyP2 <= 0 && input.currentEnergyP3 <= 0) {
    warnings.push('Precio de energía actual = 0. Importa una factura reciente.')
  }
  if (input.currentPowerP1 <= 0 && input.currentPowerP2 <= 0) {
    warnings.push('Precio de potencia actual = 0. Importa una factura reciente.')
  }
  if (input.fixedFeesMonthly && input.fixedFeesMonthly > 0) {
    const anual = (input.fixedFeesMonthly * 12).toFixed(2)
    warnings.push(
      `Detectados cargos fijos en la factura (~${input.fixedFeesMonthly.toFixed(2)} €/mes ≈ ${anual} €/año). ` +
      `Tenlo en cuenta — la comparativa NO los incluye en el cálculo.`,
    )
  }

  if (consumoAnualKwh <= 0 || (input.currentEnergyP1 <= 0 && input.currentEnergyP2 <= 0)) {
    return {
      scenarioGroup: 'no_data',
      scenarios: [],
      bestScenario: null,
      warnings,
      notice: 'Faltan datos clave (consumo o precios actuales). Sincroniza SIPS y/o sube una factura reciente.',
      consumoAnualKwh,
      costeActualAnual: 0,
      powerOptimization: null,
      consumoMix: analizarMix(input),
    }
  }

  // ── Cálculo principal ────────────────────────────────────────────────────
  const { costeActualAnual } = calcularCosteActual(input)
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
  }
}

// ─── Builder desde gana_tarifas ─────────────────────────────────────────────

export interface GanaTarifaRow {
  id: string
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

export function buildScenariosFromTarifas(rows: GanaTarifaRow[]): ScenarioGanaInput[] {
  const f24 = rows.find(r => r.tipo === 'fija_24h')
  const tra = rows.find(r => r.tipo === 'tramos')
  const mer = rows.find(r => r.tipo === 'mercado')

  // 24H y tramos comparten potencias
  const sharedPotP1 = f24?.potencia_p1 ?? tra?.potencia_p1 ?? 0
  const sharedPotP2 = f24?.potencia_p2 ?? tra?.potencia_p2 ?? 0

  // Mercado: convertir extras anuales → fee diario (extras/365)
  const mercadoFeeDay = mer?.extras_anuales
    ? (mer.extras_anuales / 365)
    : (mer?.management_fee_day ?? 0)

  const scenarios: ScenarioGanaInput[] = []
  if (f24) {
    scenarios.push({
      tipo: 'fija_24h',
      nombre: f24.nombre,
      precioP1: f24.precio_p1 ?? 0,
      precioP2: f24.precio_p2 ?? f24.precio_p1 ?? 0,
      precioP3: f24.precio_p3 ?? f24.precio_p1 ?? 0,
      potenciaP1: sharedPotP1,
      potenciaP2: sharedPotP2,
      managementFeeDay: f24.management_fee_day ?? 0,
    })
  }
  if (tra) {
    scenarios.push({
      tipo: 'tramos',
      nombre: tra.nombre,
      precioP1: tra.precio_p1 ?? 0,
      precioP2: tra.precio_p2 ?? 0,
      precioP3: tra.precio_p3 ?? 0,
      potenciaP1: sharedPotP1,
      potenciaP2: sharedPotP2,
      managementFeeDay: tra.management_fee_day ?? 0,
    })
  }
  if (mer) {
    scenarios.push({
      tipo: 'mercado',
      nombre: mer.nombre,
      precioP1: mer.precio_p1 ?? 0,
      precioP2: mer.precio_p2 ?? 0,
      precioP3: mer.precio_p3 ?? 0,
      potenciaP1: mer.potencia_p1 ?? 0,
      potenciaP2: mer.potencia_p2 ?? 0,
      managementFeeDay: mercadoFeeDay,
    })
  }
  return scenarios
}
