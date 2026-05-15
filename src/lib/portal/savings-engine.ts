/**
 * Portal v2 — Motor de comparativa de ahorro.
 *
 * Responde: "¿Cuánto habría pagado el cliente con Voltis si hubiera
 * consumido lo mismo que el año pasado?". Descompone el ahorro total
 * en tres contribuciones para no atribuirse cosas que no son mérito
 * de Voltis:
 *
 *  • Ahorro por cambio de tarifa     (mérito Voltis)
 *  • Ahorro por cambio normativo     (mérito regulador)
 *  • Ahorro por menor consumo        (mérito cliente)
 *
 * El cálculo se hace sobre 4 escenarios (idéntico al doc Unice Toys):
 *
 *   S0  Pagó real ANTES (Ekyner/Galp/etc.)
 *   S1  Mismo consumo (S0), precios VOLTIS, fiscalidad año ANTERIOR
 *   S2  Mismo consumo (S0), precios VOLTIS, fiscalidad año ACTUAL
 *   S3  Pagó real con VOLTIS
 *
 *   Ahorro cambio tarifa  = S0 − S1
 *   Ahorro cambio normat. = S1 − S2
 *   Ahorro menor consumo  = S2 − S3
 *   Ahorro total          = S0 − S3   (suma de los tres)
 *
 * Esto es lo que diferencia un informe Voltis honesto de uno de comercial:
 * si la rebaja del IVA hizo bajar la factura, NO te la cuentas tú.
 */
import type { InvoiceBreakdown } from './billing-engine'
import { calcularFacturaLuz, calcularFacturaGas, type LuzContract, type GasContract, type LuzInputs, type GasInputs } from './billing-engine'
import { fiscalAt } from './fiscal'

// ── Tipos ────────────────────────────────────────────────────────────────

export interface MonthlyConsumption {
  /** ISO yyyy-mm-dd del primer día del mes. */
  month: string
  /** Para luz: consumo por periodo. */
  consumoLuz?: Partial<Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', number>>
  potenciaLuz?: Partial<Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', number>>
  excesosPotencia?: number
  reactiva?: number
  /** Para gas: consumo total kWh. */
  consumoGas?: number
  /** Días de facturación de ese mes. */
  dias: number
  /** Coste real pagado a comercializadora anterior (luz). */
  realPagadoAntesLuz?: number
  /** Coste real pagado a comercializadora anterior (gas). */
  realPagadoAntesGas?: number
  /** Coste real pagado con Voltis (cuando ya existe esa factura). */
  realPagadoVoltisLuz?: number
  realPagadoVoltisGas?: number
}

export interface SavingsScenarios {
  s0_pagoAnteriorReal: number
  s1_mismoConsumoVoltisFiscalAnterior: number
  s2_mismoConsumoVoltisFiscalActual: number
  s3_pagoVoltisReal: number
  ahorroCambioTarifa: number     // S0 - S1
  ahorroCambioNormativo: number  // S1 - S2  (puede ser negativo)
  ahorroMenorConsumo: number     // S2 - S3
  ahorroTotal: number             // S0 - S3
  ahorroTotalPct: number          // % sobre S0
}

export interface MonthlySaving {
  month: string
  kwh: number
  costeEstimadoVoltis: number
  totalFacturaEstimada: number
  pagoRealAntes: number
  ahorro: number
}

export interface SavingsReport {
  luz?: {
    scenarios: SavingsScenarios
    monthly: MonthlySaving[]
  }
  gas?: {
    scenarios: SavingsScenarios
    monthly: MonthlySaving[]
  }
  /** Suma luz + gas para mostrar como "ahorro total". */
  total: {
    s0: number
    s3: number
    ahorroTotal: number
    ahorroTotalPct: number
  }
}

// ── Cálculo ──────────────────────────────────────────────────────────────

/**
 * Genera el reporte de ahorro para un cliente sobre un rango de meses.
 *
 * @param months    Consumos mes a mes (típicamente Q1, Q2, semestre, año).
 * @param contractoLuz  Precios Voltis luz contratados (null si no aplica).
 * @param contractoGas  Precios Voltis gas contratados (null si no aplica).
 * @param potenciaMaxKw Mayor potencia contratada del cliente (para IVA).
 * @param fiscalShift   "anterior" → usa fiscalidad año anterior para S1.
 */
export function buildSavingsReport(
  months: MonthlyConsumption[],
  contractoLuz: LuzContract | null,
  contractoGas: GasContract | null,
  potenciaMaxKw: number,
): SavingsReport {
  const out: SavingsReport = {
    total: { s0: 0, s3: 0, ahorroTotal: 0, ahorroTotalPct: 0 },
  }

  // ── LUZ ─────────────────────────────────────────────────────────
  if (contractoLuz && months.some(m => m.consumoLuz)) {
    const luzMonthly: MonthlySaving[] = []
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0

    for (const m of months) {
      if (!m.consumoLuz) continue
      const monthDate = new Date(m.month + 'T00:00:00Z')
      const fiscalActual = fiscalAt(monthDate)
      // Fiscalidad año anterior: misma fecha −1 año
      const dPrevYear = new Date(monthDate); dPrevYear.setUTCFullYear(monthDate.getUTCFullYear() - 1)
      const fiscalAnterior = fiscalAt(dPrevYear)

      const inputs: LuzInputs = {
        consumoPorPeriodo: m.consumoLuz,
        potenciaPorPeriodo: m.potenciaLuz || {},
        dias: m.dias,
        excesosPotencia: m.excesosPotencia,
        reactiva: m.reactiva,
      }

      // S0 — pagó real antes
      const s0Mes = m.realPagadoAntesLuz || 0
      // S1 — mismo consumo, precios Voltis, fiscalidad ANTERIOR
      const s1Calc = calcularFacturaLuz(inputs, contractoLuz, fiscalAnterior, potenciaMaxKw)
      // S2 — mismo consumo, precios Voltis, fiscalidad ACTUAL
      const s2Calc = calcularFacturaLuz(inputs, contractoLuz, fiscalActual, potenciaMaxKw)
      // S3 — pagó real con Voltis
      const s3Mes = m.realPagadoVoltisLuz || s2Calc.total  // si aún no hay factura real, usamos S2

      s0 += s0Mes; s1 += s1Calc.total; s2 += s2Calc.total; s3 += s3Mes

      luzMonthly.push({
        month: m.month,
        kwh: sumPeriodos(m.consumoLuz),
        costeEstimadoVoltis: s2Calc.costeEnergia + s2Calc.costePotencia,
        totalFacturaEstimada: s2Calc.total,
        pagoRealAntes: s0Mes,
        ahorro: s0Mes - s2Calc.total,
      })
    }

    out.luz = {
      monthly: luzMonthly,
      scenarios: buildScenarios(s0, s1, s2, s3),
    }
    out.total.s0 += s0; out.total.s3 += s3
  }

  // ── GAS ─────────────────────────────────────────────────────────
  if (contractoGas && months.some(m => m.consumoGas != null)) {
    const gasMonthly: MonthlySaving[] = []
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0

    for (const m of months) {
      if (m.consumoGas == null) continue
      const monthDate = new Date(m.month + 'T00:00:00Z')
      const fiscalActual = fiscalAt(monthDate)
      const dPrevYear = new Date(monthDate); dPrevYear.setUTCFullYear(monthDate.getUTCFullYear() - 1)
      const fiscalAnterior = fiscalAt(dPrevYear)

      const inputs: GasInputs = { consumoKwh: m.consumoGas, dias: m.dias }

      const s0Mes = m.realPagadoAntesGas || 0
      const s1Calc = calcularFacturaGas(inputs, contractoGas, fiscalAnterior)
      const s2Calc = calcularFacturaGas(inputs, contractoGas, fiscalActual)
      const s3Mes = m.realPagadoVoltisGas || s2Calc.total

      s0 += s0Mes; s1 += s1Calc.total; s2 += s2Calc.total; s3 += s3Mes

      gasMonthly.push({
        month: m.month,
        kwh: m.consumoGas,
        costeEstimadoVoltis: s2Calc.costeEnergia,
        totalFacturaEstimada: s2Calc.total,
        pagoRealAntes: s0Mes,
        ahorro: s0Mes - s2Calc.total,
      })
    }

    out.gas = {
      monthly: gasMonthly,
      scenarios: buildScenarios(s0, s1, s2, s3),
    }
    out.total.s0 += s0; out.total.s3 += s3
  }

  out.total.ahorroTotal = out.total.s0 - out.total.s3
  out.total.ahorroTotalPct = out.total.s0 > 0 ? (out.total.ahorroTotal / out.total.s0) * 100 : 0
  return out
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildScenarios(s0: number, s1: number, s2: number, s3: number): SavingsScenarios {
  return {
    s0_pagoAnteriorReal: round2(s0),
    s1_mismoConsumoVoltisFiscalAnterior: round2(s1),
    s2_mismoConsumoVoltisFiscalActual: round2(s2),
    s3_pagoVoltisReal: round2(s3),
    ahorroCambioTarifa: round2(s0 - s1),
    ahorroCambioNormativo: round2(s1 - s2),
    ahorroMenorConsumo: round2(s2 - s3),
    ahorroTotal: round2(s0 - s3),
    ahorroTotalPct: s0 > 0 ? round2(((s0 - s3) / s0) * 100) : 0,
  }
}

function sumPeriodos(p: Partial<Record<string, number>>): number {
  return Object.values(p).reduce((a, b) => (a || 0) + (b || 0), 0) || 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
