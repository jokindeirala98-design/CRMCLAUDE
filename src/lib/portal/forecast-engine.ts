/**
 * Portal v2 — Motor de previsión anual.
 *
 * Para cada mes del año objetivo:
 *  - Si ya hay factura Voltis emitida → usamos el importe REAL.
 *  - Si NO hay factura aún → simulamos:
 *      consumo = consumo SIPS del mismo mes del año anterior
 *      coste   = aplicamos precios Voltis y fiscalidad vigente
 *
 * El modelo NO ajusta por grados-día ni clima. Es una proyección directa:
 * "si consumieras lo mismo que el año pasado, esto pagarías".
 *
 * La precisión del modelo se valida contra las facturas reales conforme
 * van llegando, y mostramos en el portal una métrica de calibración
 * (porcentaje medio de desviación entre previsión y realidad).
 */
import { calcularFacturaLuz, calcularFacturaGas, type LuzContract, type GasContract, type LuzInputs, type GasInputs } from './billing-engine'
import { fiscalAt } from './fiscal'

// ── Tipos ────────────────────────────────────────────────────────────────

export interface HistoricalMonth {
  month: string                          // YYYY-MM-01
  consumoLuz?: Partial<Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', number>>
  potenciaLuz?: Partial<Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', number>>
  consumoGas?: number
  dias: number
}

export interface RealVoltisMonth {
  month: string                          // YYYY-MM-01
  importeLuz?: number
  consumoLuzKwh?: number
  importeGas?: number
  consumoGasKwh?: number
}

export interface ForecastMonth {
  month: string
  monthIdx: number                       // 0..11
  monthLabel: string                     // 'Ene', 'Feb'...
  isReal: boolean
  consumoLuzKwh: number
  costeLuz: number
  consumoGasKwh: number
  costeGas: number
  totalMes: number
}

export interface ForecastQuarter {
  q: 1 | 2 | 3 | 4
  label: string                          // 'Ene - Mar 2026'
  isReal: boolean                        // todos los meses son reales
  months: ForecastMonth[]
  totalLuz: number
  totalGas: number
  totalTrimestre: number
  consumoLuzKwh: number
  consumoGasKwh: number
  mediaMensual: number
}

export interface ForecastReport {
  year: number
  clientName: string
  totalAnoPrevisto: number
  totalRealQ1: number                   // suma de meses isReal
  totalEstimadoResto: number            // suma de meses !isReal
  totalLuzAno: number
  totalGasAno: number
  mediaMensual: number
  pctReal: number                        // % del año ya facturado
  months: ForecastMonth[]
  quarters: ForecastQuarter[]
  /** Métrica de calibración basada en meses ya facturados. */
  calibration?: { mape: number; samples: number }
}

// ── Cálculo ──────────────────────────────────────────────────────────────

/**
 * Genera la previsión anual completa para un suministro.
 *
 * @param year             Año objetivo (ej. 2026).
 * @param clientName       Nombre del cliente para el reporte.
 * @param historicalYear   Consumos del año anterior por mes (SIPS).
 * @param realCurrent      Importes y consumos reales facturados del año actual (mes a mes).
 * @param contractoLuz     Precios Voltis luz (puede ser null si no aplica).
 * @param contractoGas     Precios Voltis gas (puede ser null).
 * @param potenciaMaxKw    Mayor potencia contratada (define IVA).
 */
export function buildForecast(
  year: number,
  clientName: string,
  historicalYear: HistoricalMonth[],
  realCurrent: RealVoltisMonth[],
  contractoLuz: LuzContract | null,
  contractoGas: GasContract | null,
  potenciaMaxKw: number,
): ForecastReport {
  // Indexamos historic por mes (1..12)
  const histByMonth = new Map<number, HistoricalMonth>()
  for (const h of historicalYear) {
    const m = new Date(h.month + 'T00:00:00Z').getUTCMonth() + 1
    histByMonth.set(m, h)
  }
  const realByMonth = new Map<number, RealVoltisMonth>()
  for (const r of realCurrent) {
    const m = new Date(r.month + 'T00:00:00Z').getUTCMonth() + 1
    realByMonth.set(m, r)
  }

  const MONTHS_LABEL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const months: ForecastMonth[] = []
  let totalLuzAno = 0
  let totalGasAno = 0
  let totalRealQ1 = 0
  let totalEstimadoResto = 0
  // Para MAPE (calibración): comparamos previsión con real en meses ya facturados
  const mapeRows: Array<{ predicted: number; real: number }> = []

  for (let m = 1; m <= 12; m++) {
    const monthIso = `${year}-${String(m).padStart(2, '0')}-01`
    const monthDate = new Date(monthIso + 'T00:00:00Z')
    const fiscal = fiscalAt(monthDate)
    const real = realByMonth.get(m)
    const hist = histByMonth.get(m)

    let costeLuz = 0
    let costeGas = 0
    let consumoLuzKwh = 0
    let consumoGasKwh = 0
    let isReal = false

    if (real && real.importeLuz != null) {
      costeLuz = real.importeLuz
      consumoLuzKwh = real.consumoLuzKwh || 0
      isReal = true
    } else if (contractoLuz && hist?.consumoLuz) {
      const inputs: LuzInputs = {
        consumoPorPeriodo: hist.consumoLuz,
        potenciaPorPeriodo: hist.potenciaLuz || {},
        dias: hist.dias,
      }
      const result = calcularFacturaLuz(inputs, contractoLuz, fiscal, potenciaMaxKw)
      costeLuz = result.total
      consumoLuzKwh = sumPeriodos(hist.consumoLuz)
    }

    if (real && real.importeGas != null) {
      costeGas = (costeGas || 0) + real.importeGas
      consumoGasKwh = real.consumoGasKwh || 0
      isReal = true
    } else if (contractoGas && hist?.consumoGas != null) {
      const inputs: GasInputs = { consumoKwh: hist.consumoGas, dias: hist.dias }
      const result = calcularFacturaGas(inputs, contractoGas, fiscal)
      costeGas = result.total
      consumoGasKwh = hist.consumoGas
    }

    // Si para un mes solo hay datos reales de uno (luz pero no gas), todavía es "real parcial".
    // Para el flag isReal exigimos que el componente principal esté facturado.
    const totalMes = costeLuz + costeGas
    months.push({
      month: monthIso,
      monthIdx: m - 1,
      monthLabel: MONTHS_LABEL[m - 1],
      isReal,
      consumoLuzKwh: round0(consumoLuzKwh),
      costeLuz: round2(costeLuz),
      consumoGasKwh: round0(consumoGasKwh),
      costeGas: round2(costeGas),
      totalMes: round2(totalMes),
    })

    totalLuzAno += costeLuz
    totalGasAno += costeGas
    if (isReal) {
      totalRealQ1 += totalMes
      // Para MAPE: comparamos la previsión hipotética (si hubiéramos usado hist)
      // contra el real. Permite estimar precisión del modelo.
      if (contractoLuz && hist?.consumoLuz) {
        const pred = calcularFacturaLuz({
          consumoPorPeriodo: hist.consumoLuz,
          potenciaPorPeriodo: hist.potenciaLuz || {},
          dias: hist.dias,
        }, contractoLuz, fiscal, potenciaMaxKw)
        if (real?.importeLuz != null && pred.total > 0) {
          mapeRows.push({ predicted: pred.total, real: real.importeLuz })
        }
      }
    } else {
      totalEstimadoResto += totalMes
    }
  }

  const totalAno = totalLuzAno + totalGasAno
  const pctReal = totalAno > 0 ? (totalRealQ1 / totalAno) * 100 : 0

  // Construcción por trimestres
  const quarters: ForecastQuarter[] = []
  for (let q = 1; q <= 4; q++) {
    const start = (q - 1) * 3
    const ms = months.slice(start, start + 3)
    const qLabel = `${ms[0].monthLabel} - ${ms[2].monthLabel} ${year}`
    const totalLuz = ms.reduce((a, b) => a + b.costeLuz, 0)
    const totalGas = ms.reduce((a, b) => a + b.costeGas, 0)
    const totalTrim = totalLuz + totalGas
    quarters.push({
      q: q as 1 | 2 | 3 | 4,
      label: qLabel,
      isReal: ms.every(m => m.isReal),
      months: ms,
      totalLuz: round2(totalLuz),
      totalGas: round2(totalGas),
      totalTrimestre: round2(totalTrim),
      consumoLuzKwh: round0(ms.reduce((a, b) => a + b.consumoLuzKwh, 0)),
      consumoGasKwh: round0(ms.reduce((a, b) => a + b.consumoGasKwh, 0)),
      mediaMensual: round2(totalTrim / 3),
    })
  }

  // Calibración: MAPE (Mean Absolute Percentage Error)
  let calibration: { mape: number; samples: number } | undefined
  if (mapeRows.length > 0) {
    const errors = mapeRows.map(r => Math.abs(r.predicted - r.real) / r.real)
    const mape = (errors.reduce((a, b) => a + b, 0) / errors.length) * 100
    calibration = { mape: round2(mape), samples: mapeRows.length }
  }

  return {
    year,
    clientName,
    totalAnoPrevisto: round2(totalAno),
    totalRealQ1: round2(totalRealQ1),
    totalEstimadoResto: round2(totalEstimadoResto),
    totalLuzAno: round2(totalLuzAno),
    totalGasAno: round2(totalGasAno),
    mediaMensual: round2(totalAno / 12),
    pctReal: round2(pctReal),
    months,
    quarters,
    calibration,
  }
}

// ── Utils ────────────────────────────────────────────────────────────────

function sumPeriodos(p?: Partial<Record<string, number>>): number {
  if (!p) return 0
  return Object.values(p).reduce((a, b) => (a || 0) + (b || 0), 0) || 0
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
function round0(n: number): number { return Math.round(n) }
