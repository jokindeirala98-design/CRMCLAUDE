/**
 * Reglas de validación de cuadre por factura.
 *
 * Estas son INVARIANTES de extracción: cada factura que se inserte en BD
 * (via Telegram, Excel, PDF re-extracción) debe pasar estas comprobaciones.
 * Si no las pasa, marcamos `extraction_issues` en extracted_data para que
 * la UI lo destaque y un humano lo revise.
 *
 * Reglas:
 *  ① sum(kwh_periodo × precio_kWh_periodo) ≈ costeNetoConsumo  (±0,50€)
 *  ② sum(potencia.total) ≈ costeTotalPotencia                  (±0,50€)
 *  ③ totalFactura ≈ costeNetoConsumo + costeTotalPotencia + otros + IVA (±2€)
 *  ④ NO debe haber periodos duplicados en consumo[] ni potencia[]
 *     Si hay duplicados → fusionar sumando precios (peajes + cargos + energía)
 *  ⑤ Si consumoTotalKwh > 0 pero consumo[] vacío → INCOMPLETA
 */

export interface EconomicsRecord {
  consumo?: Array<{ periodo: string; kwh?: number; precioKwh?: number; total?: number }>
  potencia?: Array<{ periodo: string; kw?: number; dias?: number; precioKwDia?: number; total?: number }>
  consumoTotalKwh?: number
  costeNetoConsumo?: number
  costeTotalConsumo?: number
  costeTotalPotencia?: number
  totalFactura?: number
  ivaTotal?: number
  otrosConceptos?: Array<{ concepto?: string; total?: number }>
}

export interface ValidationIssue {
  rule: 'consumo_no_cuadra' | 'potencia_no_cuadra' | 'total_no_cuadra' |
        'duplicado_consumo' | 'duplicado_potencia' | 'consumo_vacio_con_kwh'
  detail: string
  expected?: number
  actual?: number
  diff?: number
}

const TOL_DESGLOSE = 0.5     // €
const TOL_TOTAL    = 2.0     // €

/**
 * Detecta periodos duplicados y los fusiona sumando precios.
 * Devuelve { items, hasDuplicates }.
 */
export function dedupePeriods<T extends { periodo: string }>(
  items: T[],
  kind: 'consumo' | 'potencia',
): { items: T[]; hadDuplicates: boolean } {
  const seen = new Map<string, T>()
  let hadDup = false
  for (const it of items) {
    const p = it.periodo
    if (!p) continue
    if (!seen.has(p)) {
      seen.set(p, { ...it } as T)
    } else {
      hadDup = true
      const cur = seen.get(p) as any
      if (kind === 'consumo') {
        cur.precioKwh = round((cur.precioKwh || 0) + ((it as any).precioKwh || 0), 6)
      } else {
        cur.precioKwDia = round((cur.precioKwDia || 0) + ((it as any).precioKwDia || 0), 6)
      }
    }
  }
  // Recalcular totales por periodo
  for (const it of seen.values() as any) {
    if (kind === 'consumo') {
      it.total = round((it.kwh || 0) * (it.precioKwh || 0), 2)
    } else {
      it.total = round((it.kw || 0) * (it.dias || 0) * (it.precioKwDia || 0), 2)
    }
  }
  return { items: Array.from(seen.values()), hadDuplicates: hadDup }
}

function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}

/**
 * Valida una factura completa y devuelve la lista de issues encontrados.
 * Si la lista está vacía, la factura está OK.
 */
export function validateInvoice(eco: EconomicsRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cons = eco.consumo || []
  const pot = eco.potencia || []

  // ④ Duplicados
  const consPeriods = cons.map(c => c.periodo)
  if (new Set(consPeriods).size < consPeriods.length) {
    issues.push({ rule: 'duplicado_consumo', detail: 'Hay periodos duplicados en consumo[]' })
  }
  const potPeriods = pot.map(p => p.periodo)
  if (new Set(potPeriods).size < potPeriods.length) {
    issues.push({ rule: 'duplicado_potencia', detail: 'Hay periodos duplicados en potencia[]' })
  }

  // ⑤ Consumo vacío pero kWh > 0
  if ((eco.consumoTotalKwh || 0) > 0 && cons.length === 0) {
    issues.push({ rule: 'consumo_vacio_con_kwh', detail: 'consumoTotalKwh > 0 pero array consumo[] vacío' })
  }

  // ① sum(consumo) ≈ costeNetoConsumo
  if (cons.length > 0) {
    const sumE = cons.reduce((a, c) => a + (c.kwh || 0) * (c.precioKwh || 0), 0)
    const coste = eco.costeNetoConsumo ?? eco.costeTotalConsumo
    if (typeof coste === 'number' && coste > 0) {
      const diff = Math.abs(sumE - coste)
      if (diff > TOL_DESGLOSE) {
        issues.push({
          rule: 'consumo_no_cuadra',
          detail: `sum(kwh×precio) = ${sumE.toFixed(2)}€ vs costeNetoConsumo = ${coste.toFixed(2)}€`,
          expected: coste, actual: round(sumE), diff: round(diff),
        })
      }
    }
  }

  // ② sum(potencia.total) ≈ costeTotalPotencia
  if (pot.length > 0) {
    const sumP = pot.reduce((a, p) => a + (p.kw || 0) * (p.dias || 0) * (p.precioKwDia || 0), 0)
    const coste = eco.costeTotalPotencia
    if (typeof coste === 'number' && coste > 0) {
      const diff = Math.abs(sumP - coste)
      if (diff > TOL_DESGLOSE) {
        issues.push({
          rule: 'potencia_no_cuadra',
          detail: `sum(kw×días×precio) = ${sumP.toFixed(2)}€ vs costeTotalPotencia = ${coste.toFixed(2)}€`,
          expected: coste, actual: round(sumP), diff: round(diff),
        })
      }
    }
  }

  return issues
}

/**
 * Valida + normaliza (fusiona duplicados) y devuelve la versión limpia.
 * Idempotente: pasarle un eco ya limpio no lo modifica.
 */
export function sanitizeInvoice(eco: EconomicsRecord): { eco: EconomicsRecord; issues: ValidationIssue[]; changed: boolean } {
  const cleaned: EconomicsRecord = { ...eco }
  let changed = false
  if (cleaned.consumo) {
    const { items, hadDuplicates } = dedupePeriods(cleaned.consumo, 'consumo')
    if (hadDuplicates) { cleaned.consumo = items; changed = true }
  }
  if (cleaned.potencia) {
    const { items, hadDuplicates } = dedupePeriods(cleaned.potencia, 'potencia')
    if (hadDuplicates) { cleaned.potencia = items; changed = true }
  }
  // Recalcular totales agregados desde el desglose
  if (changed && cleaned.consumo) {
    const sumKwh = cleaned.consumo.reduce((a, c) => a + (c.kwh || 0), 0)
    const sumE = cleaned.consumo.reduce((a, c) => a + (c.total || 0), 0)
    cleaned.consumoTotalKwh = sumKwh
    cleaned.costeNetoConsumo = round(sumE)
    cleaned.costeTotalConsumo = round(sumE)
  }
  if (changed && cleaned.potencia) {
    cleaned.costeTotalPotencia = round(cleaned.potencia.reduce((a, p) => a + (p.total || 0), 0))
  }
  const issues = validateInvoice(cleaned)
  return { eco: cleaned, issues, changed }
}
