/**
 * Portal v2 — Motor de simulación de factura Voltis.
 * ──────────────────────────────────────────────────────────────────────
 * Dado:
 *   - un consumo mensual desglosado por periodos (P1..P6 luz, único gas),
 *   - una potencia contratada por periodo,
 *   - un contrato Voltis con precios por periodo,
 *   - los días de facturación,
 *   - la fiscalidad aplicable al periodo,
 *
 * Devuelve el coste total reproduciendo exactamente la fórmula que usa
 * Voltis en sus facturas. El test de validación es: aplicar la fórmula
 * al consumo REAL de una factura emitida y comparar con el importe real
 * → debe coincidir con ±0,02 € (las redondeos esperables).
 *
 * Esto es el ladrillo común para:
 *   - Ahorro: "qué hubieras pagado con Voltis si consumieras lo mismo"
 *   - Previsión: "qué pagarás cada mes si consumes igual que el año pasado"
 */
import type { FiscalPeriod } from './fiscal'

// ── Tipos ────────────────────────────────────────────────────────────────

/** Consumo eléctrico por periodo y potencia contratada por periodo. */
export interface LuzInputs {
  /** Consumo kWh por periodo (P1..P6). Periodos vacíos = 0. */
  consumoPorPeriodo: Partial<Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', number>>
  /** Potencia kW contratada por periodo. */
  potenciaPorPeriodo: Partial<Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', number>>
  /** Días del periodo de facturación. */
  dias: number
  /** Excesos de potencia €. Si se conocen (factura real Voltis); en simulación, 0. */
  excesosPotencia?: number
  /** Reactiva €. Solo si se quiere replicar factura real. */
  reactiva?: number
  /** Bono social mensual € (si está activo). */
  bonoSocialMes?: number
  /** Alquiler equipos mensual € (si aplica). */
  alquilerMes?: number
}

/** Precios Voltis por periodo (peaje + p.fijo combinados). */
export interface LuzContract {
  precioKwhP1: number; precioKwhP2: number; precioKwhP3: number
  precioKwhP4: number; precioKwhP5: number; precioKwhP6: number
  precioKwDiaP1: number; precioKwDiaP2: number; precioKwDiaP3: number
  precioKwDiaP4: number; precioKwDiaP5: number; precioKwDiaP6: number
}

/** Inputs para gas. */
export interface GasInputs {
  /** Consumo en kWh (gas no tiene periodos). */
  consumoKwh: number
  /** Días del periodo de facturación. */
  dias: number
  /** Alquiler equipos mensual €. */
  alquilerMes?: number
}

/** Contrato Voltis gas. */
export interface GasContract {
  /** Término variable energía €/kWh. */
  precioKwhGas: number
  /** Peaje de acceso €/kWh. */
  peajeKwhGas: number
  /** Término fijo diario €/día (suma de los cargos fijos: peaje, GTS, CNMC, etc.). */
  terminoFijoDiarioGas: number
}

/** Resultado del cálculo desglosado. */
export interface InvoiceBreakdown {
  costePotencia: number
  costeEnergia: number
  costeExcesos: number
  costeReactiva: number
  costeBonoSocial: number
  costeAlquiler: number
  costeImpuestoEspecial: number    // IE luz / IEH gas
  baseImponible: number             // suma antes de IVA
  iva: number
  total: number
}

// ── Cálculo factura LUZ ─────────────────────────────────────────────────

/**
 * Simula una factura Voltis de luz. Devuelve el desglose económico.
 *
 * Fórmula:
 *   potencia  = Σ (kW_periodo × precio_kw_dia_periodo × días)
 *   energía   = Σ (kWh_periodo × precio_kwh_periodo)
 *   subtotal_consumo = potencia + energía + excesos + reactiva
 *   IE_luz    = subtotal_consumo × ie_pct/100   (impuesto especial eléctrico)
 *   base      = subtotal_consumo + IE + bono_social + alquiler
 *   IVA       = base × iva_pct/100
 *   TOTAL     = base + IVA
 */
export function calcularFacturaLuz(
  inputs: LuzInputs,
  contract: LuzContract,
  fiscal: FiscalPeriod,
  potenciaMaxKw: number,
): InvoiceBreakdown {
  // Potencia
  let costePotencia = 0
  for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const) {
    const kw = inputs.potenciaPorPeriodo[p] || 0
    const precio = contract[`precioKwDia${p}` as 'precioKwDiaP1']
    if (kw > 0 && precio > 0) costePotencia += kw * precio * inputs.dias
  }

  // Energía
  let costeEnergia = 0
  for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const) {
    const kwh = inputs.consumoPorPeriodo[p] || 0
    const precio = contract[`precioKwh${p}` as 'precioKwhP1']
    if (kwh > 0 && precio > 0) costeEnergia += kwh * precio
  }

  const costeExcesos = inputs.excesosPotencia || 0
  const costeReactiva = inputs.reactiva || 0
  const subtotalConsumo = costePotencia + costeEnergia + costeExcesos + costeReactiva

  // Impuesto eléctrico: aplica % a base de potencia+energía+excesos+reactiva
  const iePct = potenciaMaxKw >= 10 ? fiscal.ieLuzPct : fiscal.ieLuzPct
  const costeImpuestoEspecial = subtotalConsumo * (iePct / 100)

  const costeBonoSocial = inputs.bonoSocialMes || 0
  const costeAlquiler = inputs.alquilerMes || 0

  const baseImponible = subtotalConsumo + costeImpuestoEspecial + costeBonoSocial + costeAlquiler

  const ivaPct = potenciaMaxKw < 10 ? fiscal.ivaLuzReducidaPct : fiscal.ivaLuzPct
  const iva = baseImponible * (ivaPct / 100)
  const total = baseImponible + iva

  return {
    costePotencia: round2(costePotencia),
    costeEnergia: round2(costeEnergia),
    costeExcesos: round2(costeExcesos),
    costeReactiva: round2(costeReactiva),
    costeBonoSocial: round2(costeBonoSocial),
    costeAlquiler: round2(costeAlquiler),
    costeImpuestoEspecial: round2(costeImpuestoEspecial),
    baseImponible: round2(baseImponible),
    iva: round2(iva),
    total: round2(total),
  }
}

// ── Cálculo factura GAS ─────────────────────────────────────────────────

/**
 * Simula una factura Voltis de gas. La estructura del gas es:
 *   energía = kWh × (precio_kwh_voltis + peaje_kwh_voltis)
 *   fijo    = días × término_fijo_diario  (incluye peaje, GTS, CNMC...)
 *   IEH     = kWh × 0,003600 €/kWh    (0,65 €/GJ → 0,0023 €/kWh aprox)
 *             [el factor exacto se calcula a partir de fiscal.iehGasEurGj]
 *   base    = energía + fijo + IEH + alquiler
 *   IVA     = base × iva_pct/100
 *   TOTAL   = base + IVA
 */
export function calcularFacturaGas(
  inputs: GasInputs,
  contract: GasContract,
  fiscal: FiscalPeriod,
): InvoiceBreakdown {
  const costeEnergia = inputs.consumoKwh * (contract.precioKwhGas + contract.peajeKwhGas)
  const costePotencia = contract.terminoFijoDiarioGas * inputs.dias
  const costeAlquiler = inputs.alquilerMes || 0

  // IEH (Impuesto Especial Hidrocarburos): conversión €/GJ → €/kWh
  // 1 GJ = 277,778 kWh → factor = €_GJ / 277,778
  const iehEurKwh = fiscal.iehGasEurGj / 277.778
  const costeImpuestoEspecial = inputs.consumoKwh * iehEurKwh

  const baseImponible = costeEnergia + costePotencia + costeImpuestoEspecial + costeAlquiler
  const iva = baseImponible * (fiscal.ivaGasPct / 100)
  const total = baseImponible + iva

  return {
    costePotencia: round2(costePotencia),
    costeEnergia: round2(costeEnergia),
    costeExcesos: 0,
    costeReactiva: 0,
    costeBonoSocial: 0,
    costeAlquiler: round2(costeAlquiler),
    costeImpuestoEspecial: round2(costeImpuestoEspecial),
    baseImponible: round2(baseImponible),
    iva: round2(iva),
    total: round2(total),
  }
}

// ── Utils ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
