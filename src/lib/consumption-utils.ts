// ============================================
// Consumption utilities for Ayuntamiento module
// Ported & improved from voltis-ayuntamientos
// ============================================

import type { ConsumptionSnapshot } from '@/types/database'

// ─── CUPS normalization ───────────────────────────────────────────────────────

export function normalizeCUPS(raw: string | null | undefined): string | null {
  if (!raw) return null
  let clean = raw.replace(/[\s\-_\n\r]/g, '').toUpperCase()
  // Fix common OCR substitutions
  if (clean.startsWith('E5') || clean.startsWith('E$')) clean = 'ES' + clean.slice(2)
  if (!/^ES/.test(clean)) return null
  if (clean.length < 18 || clean.length > 24) return null
  if (!/^[A-Z0-9]+$/.test(clean)) return null
  return clean
}

// ─── Tariff normalization ─────────────────────────────────────────────────────

export function normalizeTariff(tarifa: string | null | undefined): string | null {
  if (!tarifa) return null
  const t = String(tarifa).toUpperCase().replace(/\s/g, '')
  if (/2\.0/.test(t)) return '2.0TD'
  if (/3\.0/.test(t)) return '3.0TD'
  if (/6\.1/.test(t)) return '6.1TD'
  const rl = t.match(/RL([1-4])/)
  if (rl) return `RL${rl[1]}`
  return tarifa
}

// ─── Tariff inference from powers ─────────────────────────────────────────────

export function inferTariffFromPowers(row: Partial<ConsumptionSnapshot>): string | null {
  const keys = ['potencia_p1', 'potencia_p2', 'potencia_p3', 'potencia_p4', 'potencia_p5', 'potencia_p6'] as const
  const count = keys.filter(k => row[k] != null && Number(row[k]) > 0).length
  if (count === 0) return null
  if (count <= 2) return '2.0TD'
  return '3.0TD'
}

// ─── Tariff period rules ──────────────────────────────────────────────────────

export function getPeriodsForTariff(tariff: string | null): number {
  if (!tariff) return 6
  const t = tariff.toUpperCase()
  if (t.includes('2.0')) return 3 // P1, P2, P3 for consumption in 2.0TD
  if (t.startsWith('RL')) return 1 // Gas has single consumption
  return 6 // 3.0TD and 6.1TD have P1-P6
}

export function getPowerPeriodsForTariff(tariff: string | null): number {
  if (!tariff) return 6
  const t = tariff.toUpperCase()
  if (t.includes('2.0')) return 2 // P1, P2 for power in 2.0TD
  if (t.startsWith('RL')) return 0 // Gas has no power
  return 6
}

// ─── Row classification ──────────────────────────────────────────────────────

export interface ClassifiedRows {
  td20: ConsumptionSnapshot[]
  td30: ConsumptionSnapshot[]
  td61: ConsumptionSnapshot[]
  gas: ConsumptionSnapshot[]
  electricity: ConsumptionSnapshot[]
  all: ConsumptionSnapshot[]
}

export function classifyRows(rows: ConsumptionSnapshot[]): ClassifiedRows {
  const td20: ConsumptionSnapshot[] = []
  const td30: ConsumptionSnapshot[] = []
  const td61: ConsumptionSnapshot[] = []
  const gas: ConsumptionSnapshot[] = []
  const electricity: ConsumptionSnapshot[] = []

  for (const row of rows) {
    const tariff = (row.tariff || '').toUpperCase()
    const isGas = row.supply_type === 'gas' || tariff.startsWith('RL')

    if (isGas) {
      gas.push(row)
    } else {
      electricity.push(row)
      if (tariff.includes('2.0')) td20.push(row)
      else if (tariff.includes('6.1')) td61.push(row)
      else td30.push(row) // Default electricity to 3.0TD
    }
  }

  return { td20, td30, td61, gas, electricity, all: rows }
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

export function sumField(rows: ConsumptionSnapshot[], field: keyof ConsumptionSnapshot): number {
  return rows.reduce((sum, r) => sum + (Number(r[field]) || 0), 0)
}

export function totalConsumption(rows: ConsumptionSnapshot[]): number {
  return rows.reduce((sum, r) => {
    if (r.consumo_total != null && r.consumo_total > 0) return sum + r.consumo_total
    const p = (Number(r.consumo_p1) || 0) + (Number(r.consumo_p2) || 0) + (Number(r.consumo_p3) || 0)
      + (Number(r.consumo_p4) || 0) + (Number(r.consumo_p5) || 0) + (Number(r.consumo_p6) || 0)
    return sum + p
  }, 0)
}

export function rowTotal(row: ConsumptionSnapshot): number {
  if (row.consumo_total != null && row.consumo_total > 0) return row.consumo_total
  return (Number(row.consumo_p1) || 0) + (Number(row.consumo_p2) || 0) + (Number(row.consumo_p3) || 0)
    + (Number(row.consumo_p4) || 0) + (Number(row.consumo_p5) || 0) + (Number(row.consumo_p6) || 0)
}

export function periodTotals(rows: ConsumptionSnapshot[]): { p1: number; p2: number; p3: number; p4: number; p5: number; p6: number; total: number } {
  const p1 = sumField(rows, 'consumo_p1')
  const p2 = sumField(rows, 'consumo_p2')
  const p3 = sumField(rows, 'consumo_p3')
  const p4 = sumField(rows, 'consumo_p4')
  const p5 = sumField(rows, 'consumo_p5')
  const p6 = sumField(rows, 'consumo_p6')
  return { p1, p2, p3, p4, p5, p6, total: p1 + p2 + p3 + p4 + p5 + p6 }
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatKWh(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '-'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} GWh`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} MWh`
  return `${Math.round(value)} kWh`
}

export function formatKW(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '-'
  return `${Number(value).toFixed(2)} kW`
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '-'
  return new Intl.NumberFormat('es-ES').format(Math.round(value))
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateRowsForReport(rows: ConsumptionSnapshot[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (rows.length === 0) {
    errors.push('No hay suministros para generar el informe')
    return { valid: false, errors, warnings }
  }

  const missingCups = rows.filter(r => !r.cups)
  if (missingCups.length > 0) {
    errors.push(`${missingCups.length} suministro(s) sin CUPS`)
  }

  const missingTariff = rows.filter(r => !r.tariff)
  if (missingTariff.length > 0) {
    warnings.push(`${missingTariff.length} suministro(s) sin tarifa definida`)
  }

  const missingConsumption = rows.filter(r => rowTotal(r) === 0)
  if (missingConsumption.length > 0) {
    warnings.push(`${missingConsumption.length} suministro(s) sin datos de consumo`)
  }

  const reviewRows = rows.filter(r => r.validation_status === 'Revisar')
  if (reviewRows.length > 0) {
    warnings.push(`${reviewRows.length} suministro(s) pendientes de revision`)
  }

  const incompleteRows = rows.filter(r => r.validation_status === 'Incompleto')
  if (incompleteRows.length > 0) {
    warnings.push(`${incompleteRows.length} suministro(s) con datos incompletos`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ─── Colors ──────────────────────────────────────────────────────────────────

export const TARIFF_COLORS: Record<string, string> = {
  '2.0TD': '#3b82f6',
  '3.0TD': '#f59e0b',
  '6.1TD': '#ef4444',
  'RL1': '#8b5cf6',
  'RL2': '#06b6d4',
  'RL3': '#10b981',
  'RL4': '#f97316',
}

export const PERIOD_COLORS = ['#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#10b981']
