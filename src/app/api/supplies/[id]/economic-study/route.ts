/**
 * POST /api/supplies/[id]/economic-study
 *
 * Genera el Excel "PRE ESTUDIO ECONÓMICO COMPARATIVA" usando la plantilla base.
 * Rellena todos los datos automáticos del suministro y del cliente.
 *
 * Body JSON:
 * {
 *   nueva_comercializadora: string
 *   precios_nuevos: number[]     // €/kWh por período [p1..p6]
 *   ssaa?: number
 *   excesos?: number
 *   notes?: string               // notas internas admin
 *   save?: boolean               // si true: sube a storage + crea study record + guarda notas
 * }
 *
 * Respuesta: siempre devuelve el Excel como descarga.
 * Si save=true, además persiste en Supabase antes de responder.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getBOEPrices, normalizeTariff } from '@/lib/boe-prices'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'

// ── Helpers ───────────────────────────────────────────────────────────────────

function set(ws: ExcelJS.Worksheet, cell: string, value: any) {
  ws.getCell(cell).value = value
}

/** Set an Excel formula in a cell */
function setF(ws: ExcelJS.Worksheet, cell: string, formula: string, numFmt?: string) {
  const c = ws.getCell(cell)
  c.value = { formula } as any
  if (numFmt) c.numFmt = numFmt
}

/** Monetary totals: round to 2 decimal places (cents) */
function fmt2(n: number) { return Math.round(n * 100) / 100 }

/**
 * Write a price (€/kWh or €/kW·día) to a cell with full 6-decimal precision.
 */
function setPrice(ws: ExcelJS.Worksheet, cell: string, value: number) {
  const c = ws.getCell(cell)
  c.value = value
  c.numFmt = '0.000000'
}

// ── Border styles ─────────────────────────────────────────────────────────────
const BORDER_OUTER: ExcelJS.Border = { style: 'medium', color: { argb: 'FF1E293B' } }
const BORDER_INNER: ExcelJS.Border = { style: 'thin',   color: { argb: 'FFCBD5E1' } }
const BORDER_NONE:  ExcelJS.Border = { style: 'thin',   color: { argb: 'FFFFFFFF' } }

/**
 * Apply thick outer + thin inner borders to a rectangular range.
 * Also applies a subtle alternating row fill for readability.
 */
function styleTable(
  ws: ExcelJS.Worksheet,
  fromRow: number, toRow: number,
  fromCol: number, toCol: number,
  opts: { headerRow?: number; totalRow?: number; altFill?: boolean } = {},
) {
  const FILL_ALT: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
  const FILL_HDR: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
  const FILL_TOT: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }

  for (let r = fromRow; r <= toRow; r++) {
    for (let c = fromCol; c <= toCol; c++) {
      const cell = ws.getCell(r, c)
      const top    = r === fromRow ? BORDER_OUTER : BORDER_INNER
      const bottom = r === toRow   ? BORDER_OUTER : BORDER_INNER
      const left   = c === fromCol ? BORDER_OUTER : BORDER_INNER
      const right  = c === toCol   ? BORDER_OUTER : BORDER_INNER
      cell.border = { top, bottom, left, right }

      if (r === opts.headerRow) {
        cell.fill = FILL_HDR
        cell.font = { bold: true, size: 9 }
      } else if (r === opts.totalRow) {
        cell.fill = FILL_TOT
        cell.font = { bold: true }
      } else if (opts.altFill && (r - fromRow) % 2 === 1) {
        cell.fill = FILL_ALT
      }
    }
  }
}

/** Style a standalone summary/highlight box */
function styleBox(ws: ExcelJS.Worksheet, fromRow: number, toRow: number, fromCol: number, toCol: number, fillArgb = 'FFDBEAFE') {
  const fill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = fromCol; c <= toCol; c++) {
      const cell = ws.getCell(r, c)
      cell.border = {
        top:    r === fromRow ? BORDER_OUTER : BORDER_INNER,
        bottom: r === toRow   ? BORDER_OUTER : BORDER_INNER,
        left:   c === fromCol ? BORDER_OUTER : BORDER_INNER,
        right:  c === toCol   ? BORDER_OUTER : BORDER_INNER,
      }
      cell.fill = fill
      cell.font = { bold: true }
    }
  }
}

const PERIOD_KEYS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

// ── Logo helpers (module-level) ────────────────────────────────────────────────
const _cwd = process.cwd()

/** Normalise a comercializadora name to a filesystem-safe slug */
function slugLogo(name: string) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Aliases: maps alternate spellings / CRM names → the canonical slug used as filename.
 * Add more rows here whenever a new comercializadora is set up.
 */
const LOGO_ALIASES: Record<string, string> = {
  // TotalEnergies variants
  'totalenergies': 'totalenergies',
  'total_energies': 'totalenergies',
  'total': 'totalenergies',
  // Naturgy variants (including "Naturgy Iberia, S.A." → naturgy_iberia_s_a)
  'naturgy': 'naturgy',
  'naturgy_iberia': 'naturgy',
  'naturgy_iberia_s_a': 'naturgy',
  'naturgy_iberia_sa': 'naturgy',
  'naturgy_s_a': 'naturgy',
  'naturgy_sa': 'naturgy',
  // Galp
  'galp': 'galp',
  'galp_energia': 'galp',
  'galp_energia_espana': 'galp',
  'galp_energia_espana_s_a': 'galp',
  // Axpo
  'axpo': 'axpo',
  'axpo_iberia': 'axpo',
  'axpo_iberia_s_l': 'axpo',
  // Swap Energía
  'swap_energia': 'swap_energia',
  'swap': 'swap_energia',
  // Tu Eléctrica
  'tu_electrica': 'tu_electrica',
  'tu_electrica_sl': 'tu_electrica',
  'tu_electrica_s_l': 'tu_electrica',
  // Ekyner
  'ekyner': 'ekyner',
  // Visalia
  'visalia': 'visalia',
  // Voltis (propio)
  'voltis_energia': 'voltis_energia',
  'voltis': 'voltis_energia',
}

/** Returns { buffer, ext } so insertLogo can declare the correct image type to ExcelJS */
async function tryLoadLogo(name: string): Promise<{ buffer: Buffer; ext: 'png' | 'jpeg' } | null> {
  if (!name || name === 'Comercializadora actual') return null
  const raw = slugLogo(name)
  const slug = LOGO_ALIASES[raw] ?? raw
  const logoDir = path.join(_cwd, 'public', 'logos')
  const candidates: Array<{ p: string; ext: 'png' | 'jpeg' }> = [
    { p: path.join(logoDir, `${slug}.png`),  ext: 'png' },
    { p: path.join(logoDir, `${slug}.jpg`),  ext: 'jpeg' },
    { p: path.join(logoDir, `${slug}.jpeg`), ext: 'jpeg' },
    { p: path.join(_cwd, 'logos', `${slug}.png`), ext: 'png' },
  ]
  for (const { p, ext } of candidates) {
    if (fs.existsSync(p)) {
      try { return { buffer: fs.readFileSync(p), ext } } catch { continue }
    }
  }
  return null
}

/**
 * Detect the actual comercializadora name from invoice extracted data.
 * Returns the name from the MOST RECENT invoice (by billing date).
 */
function detectComercializadoraFromInvoices(invoices: any[]): string | null {
  if (!invoices?.length) return null
  const sorted = [...invoices].sort((a, b) =>
    invoiceSortKey(b).localeCompare(invoiceSortKey(a))
  )
  for (const inv of sorted) {
    const ed = inv.extracted_data as any
    const name = ed?.economics?.comercializadora || ed?.comercializadora
    if (name && typeof name === 'string' && name.trim().length > 1) {
      return name.trim()
    }
  }
  return null
}



function extractPowers(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)

  // Format 1: potenciaContratada as object { P1: 120, P2: 130, ... }
  const pc = sipsData.potenciaContratada
  if (pc && typeof pc === 'object' && !Array.isArray(pc)) {
    const vals = PERIOD_KEYS.slice(0, periodCount).map(k => Number(pc[k] ?? pc[k.toLowerCase()] ?? 0))
    if (vals.some(v => v > 0)) return vals
  }

  // Format 2: potenciasContratadas as array
  if (Array.isArray(sipsData.potenciasContratadas))
    return sipsData.potenciasContratadas.slice(0, periodCount).map(Number)

  // Format 3: flat keys potenciaP1, potenciaP2...
  const byKey: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    byKey.push(Number(sipsData[`potenciaP${i}`] ?? sipsData[`p${i}`] ?? sipsData[`P${i}`] ?? 0))
  }
  if (byKey.some(v => v > 0)) return byKey

  // Format 4: single number — distribute equally
  if (typeof pc === 'number' && pc > 0) return Array(periodCount).fill(pc)

  return Array(periodCount).fill(0)
}

function extractConsumption(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)

  // Format 1: consumoPeriodos as object { P1: 56208, P2: 70237, ... }
  const cp = sipsData.consumoPeriodos
  if (cp && typeof cp === 'object' && !Array.isArray(cp)) {
    const vals = PERIOD_KEYS.slice(0, periodCount).map(k => Number(cp[k] ?? cp[k.toLowerCase()] ?? 0))
    if (vals.some(v => v > 0)) return vals
  }

  // Format 2: consumoPorPeriodo as array
  if (Array.isArray(sipsData.consumoPorPeriodo))
    return sipsData.consumoPorPeriodo.slice(0, periodCount).map(Number)

  // Format 3: flat keys
  const byKey: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    byKey.push(Number(sipsData[`consumoP${i}`] ?? sipsData[`energiaP${i}`] ?? 0))
  }
  if (byKey.some(v => v > 0)) return byKey

  // Format 4: totalKwh — distribute equally
  const total = Number(sipsData.totalKwh ?? sipsData.total ?? 0)
  if (total > 0) return Array(periodCount).fill(Math.round(total / periodCount))

  return Array(periodCount).fill(0)
}

const POTENCIA_CATS = new Set([
  'potencia_peaje', 'potencia_cargo', 'potencia_comercializacion', 'potencia',
])

/**
 * Returns the billing year of an invoice.
 * Priority:
 *   1. Gemini-extracted end/start date from economics (DD/MM/YYYY or YYYY-MM-DD)
 *   2. DB period_end / period_start fields (ISO or YYYY-MM-DD)
 *   3. created_at (upload date — least reliable)
 */
function invoiceYear(inv: any): number | null {
  const ed = inv.extracted_data as any
  const eco = ed?.economics

  // 1. Gemini fechaFin / fechaInicio  (format: "DD/MM/YYYY" or "YYYY-MM-DD")
  for (const key of ['fechaFin', 'fechaInicio']) {
    const raw = eco?.[key]
    if (!raw) continue
    let y: number
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      y = parseInt(raw.substring(6, 10)) // DD/MM/YYYY → last 4 chars
    } else {
      y = parseInt(String(raw).substring(0, 4)) // YYYY-...
    }
    if (!isNaN(y) && y >= 2020 && y <= 2030) return y
  }

  // 2. DB date fields
  for (const key of ['period_end', 'period_start']) {
    const raw = (inv as any)[key]
    if (!raw) continue
    const y = parseInt(String(raw).substring(0, 4))
    if (!isNaN(y) && y >= 2020 && y <= 2030) return y
  }

  // 3. created_at (last resort)
  const raw = (inv as any).created_at
  if (raw) {
    const y = parseInt(String(raw).substring(0, 4))
    if (!isNaN(y) && y >= 2020 && y <= 2030) return y
  }
  return null
}

/**
 * Returns the best sortable date string for an invoice (for ordering most-recent-first).
 * Uses Gemini fechaFin > DB period_end > DB period_start > created_at.
 */
function invoiceSortKey(inv: any): string {
  const ed = inv.extracted_data as any
  const eco = ed?.economics

  // Gemini fechaFin: convert DD/MM/YYYY → YYYY-MM-DD for lexicographic sort
  const geminiEnd = eco?.fechaFin
  if (geminiEnd) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(geminiEnd)) {
      const [d, m, y] = geminiEnd.split('/')
      return `${y}-${m}-${d}`
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(geminiEnd)) return geminiEnd
  }

  // DB fields are already YYYY-MM-DD
  return (inv as any).period_end || (inv as any).period_start || (inv as any).created_at || ''
}

/**
 * Normalize a raw power price that could be stored as:
 *   - €/kW·día  (value < 2, e.g. 0.078882) → use as-is
 *   - €/kW·año  (value > 5, e.g. 28.79)    → divide by 365
 *   - values 2..5 are ambiguous; treat as annual (err on safe side)
 */
function normPowerPrice(raw: number): number {
  if (raw <= 0) return 0
  return raw > 2 ? raw / 365 : raw
}

/**
 * Normalize dias that Gemini may have extracted as:
 *   - Actual integer days   (>= 1, e.g. 31)   → use as-is
 *   - Fraction of year      (0 < d < 1, e.g. 31/365 = 0.0849) → multiply by 365
 *   - Zero / null           → return 0
 */
function normDias(raw: number): number {
  if (raw >= 1) return Math.round(raw)
  if (raw > 0)  return Math.round(raw * 365)
  return 0
}

/**
 * Compute the number of days in an invoice's billing period from its dates.
 * Used as fallback when dias = 0 in extracted potencia items.
 */
function getBillingDays(inv: any): number {
  const eco = inv.extracted_data?.economics
  const parseDate = (s: string): Date | null => {
    if (!s) return null
    // DD/MM/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split('/')
      return new Date(+y, +m - 1, +d)
    }
    // YYYY-MM-DD or ISO
    const dt = new Date(s)
    return isNaN(dt.getTime()) ? null : dt
  }

  const startStr = eco?.fechaInicio || inv.period_start
  const endStr   = eco?.fechaFin    || inv.period_end
  const start = parseDate(String(startStr || ''))
  const end   = parseDate(String(endStr   || ''))
  if (!start || !end) return 0
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return diff > 0 && diff <= 366 ? diff + 1 : 0  // inclusive, sanity-checked
}

/**
 * Extract power prices (€/kW·día) DIRECTLY from the most recent invoice
 * of the preferred year. Returns literal prices from the invoice — no averaging.
 *
 * Three extraction sources tried in order per invoice:
 *   1. economics.potencia[]     → precioKwDia/precioKw, or total/(kw×dias)
 *   2. economics.rawLineItems   → precioUnitario (most reliable for COX/consolidated)
 *                                 or total/(kw×dias) with fractional-dias handling
 *
 * COX Energy format: "260 kW × 0,078882 €/kW × (31/365) días"
 *   → Gemini may store dias=31 OR dias=0.0849 OR precioUnitario=0.078882
 *   → All cases handled below.
 */
function extractPowerPricesFromMostRecentInvoice(
  invoices: any[],
  periodCount: number,
  preferYear?: number,
): { prices: number[]; sourceYear: number | null; sourceDate: string } {
  const empty = { prices: Array(periodCount).fill(0), sourceYear: null, sourceDate: '' }
  if (!invoices?.length) return empty

  // 1. Filter to preferred year; fall back to all invoices if none match
  let subset = invoices
  if (preferYear) {
    const filtered = invoices.filter(inv => invoiceYear(inv) === preferYear)
    console.log(`[economic-study] preferYear=${preferYear} → ${filtered.length}/${invoices.length} invoices match`)
    if (filtered.length > 0) subset = filtered
  }

  // 2. Sort ALL invoices by invoice date descending (most recent billing period first)
  const sortedAll = [...invoices].sort((a, b) =>
    invoiceSortKey(b).localeCompare(invoiceSortKey(a))
  )

  // Build ordered list: preferred-year invoices first, then remaining (older years)
  // This way if 2026 invoices have no data we automatically fall through to 2025
  const preferredFirst = preferYear
    ? [
        ...sortedAll.filter(inv => invoiceYear(inv) === preferYear),
        ...sortedAll.filter(inv => invoiceYear(inv) !== preferYear),
      ]
    : sortedAll

  console.log(`[economic-study] preferYear=${preferYear} — trying ${preferredFirst.length} invoices:`,
    preferredFirst.map(i => `${i.id}@${invoiceSortKey(i)}(y=${invoiceYear(i)})`))

  // Helper: try to extract potencia prices from a single invoice
  const tryInvoice = (inv: any): number[] | null => {
    const ed = inv.extracted_data as any
    if (!ed) return null
    const eco = ed.economics || {}
    const prices = Array(periodCount).fill(0)
    let found = 0

    // Billing days fallback (when dias=0 but we have total+kw)
    const billingDays = getBillingDays(inv)

    // ── Source 1: potencia[] aggregated by Gemini ─────────────────────────
    const potenciaArr: any[] | undefined = eco.potencia ?? ed.potencia
    if (Array.isArray(potenciaArr) && potenciaArr.length > 0) {
      for (let i = 0; i < periodCount; i++) {
        const p = PERIOD_KEYS[i]
        const item = potenciaArr.find(
          (x: any) => x.periodo === p || x.periodo === `Periodo ${i + 1}`
        )
        if (!item) continue
        const kw      = Number(item.kw) || 0
        const rawDias = Number(item.dias) || 0
        const total   = Number(item.total) || Number(item.importe) || 0
        // All possible field names Gemini may use for the unit price
        const rawPrecio = Number(item.precioKwDia) || Number(item.precioKw)
                        || Number(item.precio)      || Number(item.precioUnitario) || 0

        let precio = 0
        if (rawPrecio > 0) {
          // Direct price available — normalize annual→daily
          precio = normPowerPrice(rawPrecio)
        } else if (kw > 0 && total > 0) {
          // Derive from total / (kw × dias)
          // Use normDias first; fall back to computed billing days
          const actualDias = normDias(rawDias) || billingDays
          if (actualDias > 0) precio = normPowerPrice(total / (kw * actualDias))
        }
        if (precio > 0) { prices[i] = precio; found++ }
      }
      if (found > 0) {
        console.log(`[economic-study] ✓ potencia[] y=${invoiceYear(inv)} ${invoiceSortKey(inv)}`, prices)
        return prices
      }
    }

    // ── Source 2: rawLineItems ─────────────────────────────────────────────
    //
    // IMPORTANT: some invoices (e.g. Nieves Electricidad) repeat the power
    // charge twice: once as "Facturación potencia contratada" (category='potencia')
    // and again as "Coste peajes de transporte" (category='potencia_peaje') with
    // the same amounts.  Naively summing both totals doubles the price.
    //
    // Two-tier strategy:
    //   MAIN tier  (category='potencia')                → the full power charge
    //   SUB  tier  (potencia_peaje/cargo/comercializacion) → sub-breakdown only
    // If main items exist for a period → use ONLY main (ignores sub to avoid doubling).
    // If no main items → sum sub-categories (for formats like COX where only
    // sub-categories are present and must be added together).
    const rawItems: any[] | undefined = eco.rawLineItems ?? ed.rawLineItems
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      type PRow = { kw: number; dias: number; total: number; precioUnitario: number }
      const mainByPeriod: Record<string, PRow> = {}   // category === 'potencia'
      const subByPeriod:  Record<string, PRow> = {}   // peaje / cargo / comercializacion

      for (const item of rawItems) {
        if (!POTENCIA_CATS.has(item.category)) continue
        const p = item.periodo as string
        if (!p || !PERIOD_KEYS.includes(p)) continue

        const isMain = item.category === 'potencia'
        const target = isMain ? mainByPeriod : subByPeriod
        if (!target[p]) target[p] = { kw: 0, dias: 0, total: 0, precioUnitario: 0 }

        const itemKw   = Number(item.kw)            || 0
        const itemDias = normDias(Number(item.dias) || 0) || billingDays
        const itemTot  = Number(item.total)          || 0
        const itemUnit = Number(item.precioUnitario) || 0

        if (itemKw   > 0) target[p].kw   = itemKw
        if (itemDias > 0) target[p].dias  = itemDias
        target[p].total += itemTot   // sum within the same tier only
        if (itemUnit > 0 && target[p].precioUnitario === 0) target[p].precioUnitario = itemUnit
      }

      // Merge: prefer main category; fall back to sub-categories per period
      const byPeriod: Record<string, PRow> = {}
      for (const p of PERIOD_KEYS) {
        if (mainByPeriod[p]) byPeriod[p] = mainByPeriod[p]
        else if (subByPeriod[p]) byPeriod[p] = subByPeriod[p]
      }

      for (let i = 0; i < periodCount; i++) {
        const row = byPeriod[PERIOD_KEYS[i]]
        if (!row) continue
        let precio = 0
        // Priority A: direct unit price (COX and other consolidated formats)
        if (row.precioUnitario > 0) {
          precio = normPowerPrice(row.precioUnitario)
        }
        // Priority B: total / (kw × dias)
        else if (row.kw > 0 && row.dias > 0 && row.total > 0) {
          precio = normPowerPrice(row.total / (row.kw * row.dias))
        }
        if (precio > 0) { prices[i] = precio; found++ }
      }

      if (found > 0) {
        console.log(`[economic-study] ✓ rawLineItems y=${invoiceYear(inv)} ${invoiceSortKey(inv)}`, prices)
        return prices
      }
    }

    console.log(`[economic-study] ✗ inv ${inv.id} y=${invoiceYear(inv)} — potencia[]:${potenciaArr?.length ?? 'null'} rawItems potencia:${(eco.rawLineItems ?? []).filter((x: any) => POTENCIA_CATS.has(x.category)).length} billingDays:${billingDays}`)
    return null
  }

  // 3. Collect prices from ALL matching invoices, then return the MODE per period.
  // (most prevalent price wins; ties broken by recency via preferredFirst order)
  // This is more robust than using any single invoice — a mis-extracted invoice
  // won't skew the result if the correct price appears in most others.
  const allPricesByPeriod: number[][] = Array.from({ length: periodCount }, () => [])
  let firstSourceYear: number | null = null
  let firstSourceDate = ''

  for (const inv of preferredFirst) {
    const result = tryInvoice(inv)
    if (!result) continue
    if (!firstSourceYear) {
      firstSourceYear = invoiceYear(inv)
      firstSourceDate = invoiceSortKey(inv)
    }
    for (let i = 0; i < periodCount; i++) {
      if (result[i] > 0) allPricesByPeriod[i].push(result[i])
    }
  }

  const hasAny = allPricesByPeriod.some(arr => arr.length > 0)
  if (!hasAny) {
    console.warn('[economic-study] ⚠ no power price data in any invoice — BOE fallback')
    return empty
  }

  // Mode per period: round to 6 decimals for grouping, pick most frequent
  const modalPrices = allPricesByPeriod.map(arr => {
    if (!arr.length) return 0
    const counts: Record<string, number> = {}
    for (const p of arr) {
      const key = p.toFixed(6)
      counts[key] = (counts[key] || 0) + 1
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    return parseFloat(best)
  })

  console.log(`[economic-study] ✓ modal prices from ${allPricesByPeriod.map(a => a.length)} invoices per period`, modalPrices)
  return { prices: modalPrices, sourceYear: firstSourceYear, sourceDate: firstSourceDate }
}

/**
 * Extract kW powers from invoices (for fallback when SIPS not available).
 * Returns the most recently billed kW per period.
 */
function extractInvoicePowerKw(invoices: any[], periodCount: number): number[] {
  const powers = Array(periodCount).fill(0)
  if (!invoices?.length) return powers

  const sorted = [...invoices].sort((a, b) => {
    const da = a.period_end || a.period_start || ''
    const db = b.period_end || b.period_start || ''
    return db.localeCompare(da)
  })

  for (const inv of sorted) {
    const ed = inv.extracted_data as any
    if (!ed) continue
    const eco = ed.economics || {}

    const potenciaArr: any[] | undefined = eco.potencia ?? ed.potencia
    if (Array.isArray(potenciaArr) && potenciaArr.length > 0) {
      let filled = 0
      for (let i = 0; i < periodCount; i++) {
        const p = PERIOD_KEYS[i]
        const item = potenciaArr.find(
          (x: any) => x.periodo === p || x.periodo === `Periodo ${i + 1}`
        )
        const kw = Number(item?.kw) || 0
        if (kw > 0 && powers[i] === 0) { powers[i] = kw; filled++ }
      }
      if (filled > 0) break
    }
  }
  return powers
}

/**
 * Weighted-average energy price per period across ALL invoices.
 * Mirrors AnnualEconomics: avgPrice[P] = Σ(total_P) / Σ(kwh_P)
 *
 * Priority per invoice per period:
 *   1. item.total  (gross monetary amount — most reliable)
 *   2. item.kwh × item.precioKwh  (Gemini-extracted, may be partial)
 * Returns 0 for periods with no data.
 */
function extractInvoiceEnergyPrices(invoices: any[], periodCount: number): number[] {
  const totalEur = Array(periodCount).fill(0)
  const totalKwh = Array(periodCount).fill(0)

  for (const inv of invoices) {
    const eco = inv.extracted_data?.economics
    if (!eco?.consumo?.length) continue

    // Discount factor (same as AnnualEconomics)
    const descuentoEnergia = Number(eco.descuentoEnergia) || 0
    const costeBruto = Number(eco.costeBrutoConsumo) || 0
    const discountFactor = costeBruto > 0 && descuentoEnergia > 0
      ? 1 - descuentoEnergia / costeBruto : 1

    for (let i = 0; i < periodCount; i++) {
      const p = PERIOD_KEYS[i]
      const item = eco.consumo.find((x: any) => x.periodo === p || x.periodo === `Periodo ${i + 1}`)
      if (!item) continue
      const kwh = Number(item.kwh) || 0
      if (kwh <= 0) continue

      let eur = 0
      if (Number(item.total) > 0) {
        eur = Number(item.total) * discountFactor
      } else if (Number(item.precioKwh) > 0) {
        eur = kwh * Number(item.precioKwh) * discountFactor
      }
      if (eur > 0) {
        totalEur[i] += eur
        totalKwh[i] += kwh
      }
    }
  }

  // Fallback: if no per-period data, try single-period flat price from most recent invoice
  const hasAny = totalKwh.some(v => v > 0)
  if (!hasAny) {
    const sorted = [...invoices].sort((a, b) =>
      (b.period_end || b.period_start || '').localeCompare(a.period_end || a.period_start || ''))
    for (const inv of sorted) {
      const eco = inv.extracted_data?.economics
      if (!eco?.consumo?.length) continue
      let filled = 0
      for (let i = 0; i < periodCount; i++) {
        const p = PERIOD_KEYS[i]
        const item = eco.consumo.find((x: any) => x.periodo === p || x.periodo === `Periodo ${i + 1}`)
        if (item && Number(item.precioKwh) > 0) {
          totalEur[i] = Number(item.precioKwh)  // store price directly
          totalKwh[i] = 1                         // sentinel so map below returns price as-is
          filled++
        }
      }
      if (filled > 0) break
    }
    return totalEur  // already the per-period price when sentinel=1
  }

  return totalEur.map((eur, i) => totalKwh[i] > 0 ? eur / totalKwh[i] : 0)
}

function avgPriceFromInvoices(invoices: any[]): number {
  if (!invoices?.length) return 0
  let totalCost = 0, totalKwh = 0
  for (const inv of invoices) {
    const ed = inv.extracted_data as any
    const kwh = Number(
      inv.consumption_kwh ?? inv.kwh ??
      ed?.economics?.consumoTotalKwh ?? ed?.consumoKwh ?? 0
    )
    const cost = Number(
      inv.energy_cost ?? inv.importe_energia ??
      ed?.economics?.importeEnergia ?? ed?.importeEnergia ?? 0
    )
    if (kwh > 0 && cost > 0) { totalKwh += kwh; totalCost += cost }
  }
  return totalKwh > 0 ? totalCost / totalKwh : 0
}

// ── Helpers de persistencia ───────────────────────────────────────────────────

/**
 * Borra todos los estudios económicos previos del suministro
 * (registros DB + archivos de storage) para que solo quede el último.
 */
async function purgeOldStudies(supabase: any, supplyId: string) {
  const { data: old } = await supabase
    .from('studies')
    .select('id, report_url')
    .eq('supply_id', supplyId)
    .eq('type', 'economico')

  if (!old?.length) return

  // Extraer rutas de storage de las URLs públicas
  const storagePaths = (old as any[])
    .map((s: any) => {
      const url = s.report_url as string | null
      if (!url) return null
      const marker = '/documents/'
      const idx = url.indexOf(marker)
      return idx !== -1 ? url.slice(idx + marker.length) : null
    })
    .filter(Boolean) as string[]

  if (storagePaths.length) {
    await supabase.storage.from('documents').remove(storagePaths).catch(() => {})
  }

  await supabase.from('studies')
    .delete()
    .in('id', (old as any[]).map((s: any) => s.id))
}

/**
 * Limpia estudios previos e inserta uno nuevo sin report_url
 * (solo config del admin, sin Excel adjunto). Usado por el modo 2TD.
 */
async function saveStudyConfig({
  supabase, supplyId, userId, tariff, inputData, notes,
}: {
  supabase: any
  supplyId: string
  userId: string
  tariff: string
  inputData: Record<string, unknown>
  notes?: string
}) {
  const now = new Date().toISOString()
  await purgeOldStudies(supabase, supplyId)
  await supabase.from('studies').insert({
    supply_id: supplyId,
    type: 'economico',
    report_url: null,
    status: 'completed',
    created_by: userId,
    created_at: now,
    completed_at: now,
    input_data: inputData,
  })
  await supabase.from('supplies').update({
    ...(notes ? { study_notes: notes } : {}),
    status: 'estudio_completado',
    updated_at: now,
  }).eq('id', supplyId)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const {
      nueva_comercializadora,
      precios_nuevos,
      ssaa = 0,
      excesos = 0,
      notes = '',
      save = false,
      // Modo save-only: no genera Excel, solo persiste la config (usado para 2TD)
      save_only = false,
      tariff_key,           // clave de tarifa Voltis 2TD (p.ej. 'tramos', '24h', 'mercado')
      // Datos extra para config 2TD
      consumo_2td,          // { P1, P2, P3 }
      potencia_2td,         // { P1, P2 }
      precio_energia_actual = 0,
      precio_potencia_p1 = 0,
      precio_potencia_p2 = 0,
      ahorro_anual = 0,
    } = body

    if (!save_only && (!nueva_comercializadora || !Array.isArray(precios_nuevos))) {
      return NextResponse.json({ error: 'nueva_comercializadora y precios_nuevos son obligatorios' }, { status: 400 })
    }

    // ── Auth: cookie-based session (same as import-from-excel) ──────────────
    const authClient = createServerSupabaseClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Use service-role client for data ops (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ── Fetch supply + client + invoices ──────────────────────────────────────
    const { data: supply, error } = await supabase
      .from('supplies')
      .select(`
        *,
        client:clients(id, name, cif_nif),
        comercializadora:comercializadoras(name),
        invoices(*)
      `)
      .eq('id', params.id)
      .single()

    if (error || !supply) {
      return NextResponse.json({ error: 'Suministro no encontrado' }, { status: 404 })
    }

    const tariff = supply.tariff || '3.0TD'
    const boe2025 = getBOEPrices(tariff, 2025)
    const boe2026 = getBOEPrices(tariff, 2026)
    const periodCount = boe2026.length

    const sipsData = supply.consumption_data as any
    const powerStudyResult = (supply as any).power_study_result as any
    const invoices = supply.invoices || []

    // ── BOE year for "nuevo" column: if ANY invoice is from 2026, use BOE 2026.
    // This ensures clients with even one 2026 invoice get the current year's BOE rates.
    const has2026Invoice = invoices.some((inv: any) => invoiceYear(inv) === 2026)
    const boeNewYear: 2025 | 2026 = has2026Invoice ? 2026 : 2025
    const boeNuevo = getBOEPrices(tariff, boeNewYear)

    // Consumption always from SIPS (official distributor data)
    const consumption = extractConsumption(sipsData, periodCount)
    const totalKwh = consumption.reduce((a: number, b: number) => a + b, 0)

    // Powers: ALWAYS from SIPS — never from invoices or Excel data.
    // Priority:
    //   1. power_study_result.potenciaContratada — set by power-study-auto after SIPS fetch
    //   2. consumption_data.potenciaContratada   — set by sync-supply-sips or post-import SIPS merge
    const sipsPowers = extractPowers(sipsData, periodCount)

    let powers: number[]
    if (powerStudyResult?.potenciaContratada) {
      const pc = powerStudyResult.potenciaContratada
      const studyPowers = PERIOD_KEYS.slice(0, periodCount).map(k => Number(pc[k] ?? 0))
      powers = studyPowers.some(v => v > 0) ? studyPowers : sipsPowers
    } else {
      powers = sipsPowers
    }

    // Power prices ACTUAL: extract DIRECTLY from the most recent invoice.
    // If client has 2025 + 2026 invoices → uses only the most-recent 2026 invoice.
    // If only 2025 → uses the most-recent 2025 invoice.
    // No weighted averaging — literal prices from that one invoice.
    const invoiceYears = invoices.map((inv: any) => invoiceYear(inv)).filter(Boolean) as number[]
    const preferYear = invoiceYears.length > 0 ? Math.max(...invoiceYears) : undefined
    const { prices: avgPowerPricesActual, sourceYear: powerSourceYear } =
      extractPowerPricesFromMostRecentInvoice(invoices, periodCount, preferYear)
    const boeActualFallback = (powerSourceYear ?? preferYear ?? boeNewYear) === 2026 ? boe2026 : boe2025

    // Energy prices ACTUAL per period: from invoice
    const energyPricesActual = extractInvoiceEnergyPrices(invoices, periodCount)

    // Fallback: overall average price if per-period not available
    const actualAvgPrice = avgPriceFromInvoices(invoices)

    // Actual comercializadora: prefer CRM linked record, fallback to invoice extraction
    const comercializadoraActual =
      supply.comercializadora?.name ||
      detectComercializadoraFromInvoices(invoices) ||
      'Comercializadora actual'

    const clientName = supply.client?.name || supply.cups || 'Sin cliente'
    const cups = supply.cups || ''
    const tariffLabel = `TARIFA ${normalizeTariff(tariff)}`

    // ── save_only: guardar config y salir (no genera Excel) ───────────────────
    if (save_only && save) {
      await saveStudyConfig({
        supabase,
        supplyId: params.id,
        userId: user.id,
        tariff,
        inputData: tariff_key
          ? {
              // Modo 2TD: guardar tarifa Voltis seleccionada
              tariff_key,
              tariff,
              comercializadora_voltis: 'Voltis Energía',
              consumo_2td,
              potencia_2td,
              precio_energia_actual,
              precio_potencia_p1,
              precio_potencia_p2,
              ahorro_anual,
            }
          : {
              // Modo estudio completo
              nueva_comercializadora,
              precios_nuevos,
              ssaa,
              excesos,
              tariff,
              notes,
            },
        notes,
      })
      return NextResponse.json({ success: true })
    }

    // ── Logos de comercializadoras ────────────────────────────────────────────
    const [logoActualResult, logoNuevaResult] = await Promise.all([
      tryLoadLogo(comercializadoraActual),
      tryLoadLogo(nueva_comercializadora),
    ])

    // ── Abrir plantilla ───────────────────────────────────────────────────────
    // Vercel serverless: only files declared in outputFileTracingIncludes are bundled.
    // We check both root/templates/ (dev) and public/templates/ (Vercel fallback).
    const cwd = _cwd
    const candidates = [
      path.join(cwd, 'templates', 'estudio-economico.xlsx'),
      path.join(cwd, 'public', 'templates', 'estudio-economico.xlsx'),
      path.join(cwd, 'templates', 'estudio-economico-clean.xlsx'),
      path.join(cwd, 'public', 'templates', 'estudio-economico-clean.xlsx'),
    ]

    const loadTemplate = async (): Promise<ExcelJS.Workbook> => {
      for (const templatePath of candidates) {
        if (!fs.existsSync(templatePath)) continue
        try {
          const w = new ExcelJS.Workbook()
          await w.xlsx.readFile(templatePath)
          return w
        } catch {
          // File exists but ExcelJS can't parse it (e.g. has drawings) — try next
          continue
        }
      }
      throw new Error('Plantilla no encontrada. Asegúrate de que estudio-economico.xlsx está en templates/ o public/templates/')
    }

    const wb = await loadTemplate()
    const ws = wb.worksheets[0]

    // ── Cabecera ──────────────────────────────────────────────────────────────
    set(ws, 'A2', clientName)
    set(ws, 'B3', cups)
    set(ws, 'Q3', tariffLabel)
    set(ws, 'A10', comercializadoraActual)
    set(ws, 'I10', nueva_comercializadora)

    // ── Logos (insert after worksheet is loaded) ──────────────────────────────
    // If a logo image exists → insert it. Otherwise → write company name in large bold text
    // so that BOTH sides always show something visual (never blank).
    const insertLogoOrText = (
      result: { buffer: Buffer; ext: 'png' | 'jpeg' } | null,
      name: string,
      colStart: number,
      rowStart: number,
    ) => {
      if (result) {
        try {
          const imgId = wb.addImage({ buffer: result.buffer as any, extension: result.ext })
          ws.addImage(imgId, {
            tl: { col: colStart - 1, row: rowStart - 1 } as any,
            ext: { width: 140, height: 45 },
            editAs: 'oneCell',
          } as any)
          return
        } catch { /* fall through to text fallback */ }
      }
      // Text fallback: write company name prominently in the logo area cell
      if (!name || name === 'Comercializadora actual') return
      const cell = ws.getCell(rowStart - 1, colStart)  // row above the name row
      cell.value = name
      cell.font  = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false }
    }
    insertLogoOrText(logoActualResult, comercializadoraActual, 1, 8)   // actual: col A, row 8
    insertLogoOrText(logoNuevaResult,  nueva_comercializadora, 9, 8)   // nueva:  col I, row 8

    // Force recalculation when the file is opened in Excel/Numbers
    wb.calcProperties = { fullCalcOnLoad: true } as any

    // ── POTENCIA ──────────────────────────────────────────────────────────────
    const DIAS = 365
    const POT_ROWS = [12, 13, 14, 15, 16, 17]
    const lastPotRow = POT_ROWS[periodCount - 1]

    for (let i = 0; i < periodCount; i++) {
      const row = POT_ROWS[i]
      const kw = powers[i] || 0

      const boeA = avgPowerPricesActual[i] > 0
        ? avgPowerPricesActual[i]
        : (boeActualFallback[i]?.pricePerKwDay ?? 0)
      const boeN = boeNuevo[i]?.pricePerKwDay ?? 0

      // ACTUAL: B=kW, C=días, D=€/kW·día, E=coste/mes (fórmula), F=coste/año (fórmula)
      set(ws, `B${row}`, kw)
      set(ws, `C${row}`, DIAS)
      setPrice(ws, `D${row}`, boeA)
      setF(ws, `E${row}`, `=B${row}*C${row}*D${row}/12`, '#,##0.00')
      setF(ws, `F${row}`, `=B${row}*C${row}*D${row}`,    '#,##0.00')

      // NUEVO: J=kW, K=días, L=€/kW·día, M=coste/mes (fórmula), N=coste/año (fórmula)
      set(ws, `J${row}`, kw)
      set(ws, `K${row}`, DIAS)
      setPrice(ws, `L${row}`, boeN)
      setF(ws, `M${row}`, `=J${row}*K${row}*L${row}/12`, '#,##0.00')
      setF(ws, `N${row}`, `=J${row}*K${row}*L${row}`,    '#,##0.00')
    }

    // Totales potencia — fórmulas SUM
    setF(ws, 'B19', `=SUM(B12:B${lastPotRow})`, '#,##0.00')
    setF(ws, 'F19', `=SUM(F12:F${lastPotRow})`, '#,##0.00')
    setF(ws, 'J19', `=SUM(J12:J${lastPotRow})`, '#,##0.00')
    setF(ws, 'N19', `=SUM(N12:N${lastPotRow})`, '#,##0.00')

    // ── ENERGÍA ───────────────────────────────────────────────────────────────
    const ENE_ROWS = [30, 31, 32, 33, 34, 35]
    const lastEneRow = ENE_ROWS[periodCount - 1]

    // Cabecera totales kWh (hardcoded desde SIPS)
    set(ws, 'D29', totalKwh)
    set(ws, 'J29', totalKwh)

    for (let i = 0; i < periodCount; i++) {
      const row = ENE_ROWS[i]
      const kwh = consumption[i] || 0
      const precioA = energyPricesActual[i] > 0 ? energyPricesActual[i] : (kwh > 0 ? actualAvgPrice : 0)
      const precioN = precios_nuevos[i] || 0

      // ACTUAL: C=periodo, D=kWh, E=€/kWh, F=coste (fórmula), G=% (fórmula)
      set(ws, `C${row}`, PERIOD_KEYS[i])
      set(ws, `D${row}`, kwh)
      setPrice(ws, `E${row}`, precioA)
      setF(ws, `F${row}`, `=D${row}*E${row}`,                    '#,##0.00')
      setF(ws, `G${row}`, `=IF($D$37>0,D${row}/$D$37,0)`,        '0.0%')

      // NUEVO: I=periodo, J=kWh, K=€/kWh (admin), L=coste (fórmula), M=% (fórmula)
      set(ws, `I${row}`, PERIOD_KEYS[i])
      set(ws, `J${row}`, kwh)
      setPrice(ws, `K${row}`, precioN)
      // Precio nuevo introducido por el admin → destacar en verde
      ws.getCell(`K${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
      ws.getCell(`K${row}`).font = { bold: true, color: { argb: 'FF065F46' } }
      setF(ws, `L${row}`, `=J${row}*K${row}`,                    '#,##0.00')
      setF(ws, `M${row}`, `=IF($J$37>0,J${row}/$J$37,0)`,        '0.0%')
    }

    // Totales energía — fórmulas SUM + precio medio derivado
    setF(ws, 'D37', `=SUM(D30:D${lastEneRow})`, '#,##0')
    setF(ws, 'E37', `=IF(D37>0,F37/D37,0)`,     '0.000000')
    setF(ws, 'F37', `=SUM(F30:F${lastEneRow})`, '#,##0.00')
    setF(ws, 'J37', `=SUM(J30:J${lastEneRow})`, '#,##0')
    setF(ws, 'K37', `=IF(J37>0,L37/J37,0)`,     '0.000000')
    setF(ws, 'L37', `=SUM(L30:L${lastEneRow})`, '#,##0.00')

    // ── Resumen ───────────────────────────────────────────────────────────────
    // Celdas I23-I26: fórmulas que apuntan a los totales calculados
    setF(ws, 'I23', '=F19-N19',  '#,##0.00')   // Ahorro potencia
    setF(ws, 'I24', '=F37-L37',  '#,##0.00')   // Ahorro energía
    set(ws,  'I25', fmt2(ssaa || 0))             // SSAA (introducido por admin)
    ws.getCell('I25').numFmt = '#,##0.00'
    set(ws,  'I26', fmt2(excesos || 0))          // Excesos (introducido por admin)
    ws.getCell('I26').numFmt = '#,##0.00'

    // Diferencia total → L25 (fórmula); la etiqueta "DIFERENCIA TOTAL:" ya existe en la plantilla
    setF(ws, 'L25', '=I23+I24+I25+I26', '#,##0.00')
    ws.getCell('L25').font      = { bold: true, size: 18, color: { argb: 'FF1D4ED8' } }
    ws.getCell('L25').fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
    ws.getCell('L25').alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(25).height = 30   // extra height so the big number fits

    // Diferencia energía → G40 (la plantilla tiene la etiqueta "diferencia energía:" aquí)
    setF(ws, 'G40', '=F37-L37', '#,##0.00')
    ws.getCell('G40').font = { bold: true, color: { argb: 'FF000000' } }

    // ── Estética y bordes ────────────────────────────────────────────────────
    // POTENCIA ACTUAL (A11:F19) — incluye fila cabecera + columna etiquetas
    styleTable(ws, 11, 19, 1, 6,  { totalRow: 19, altFill: true })
    // POTENCIA NUEVA (I11:N19)
    styleTable(ws, 11, 19, 9, 14, { totalRow: 19, altFill: true })
    // ENERGÍA ACTUAL (B28:G37) — incluye fila cabecera + columna etiquetas
    styleTable(ws, 28, 37, 2, 7,  { totalRow: 37, altFill: true })
    // ENERGÍA NUEVA (H28:M37)
    styleTable(ws, 28, 37, 8, 13, { totalRow: 37, altFill: true })
    // Resumen ahorro (I23:I26)
    styleBox(ws, 23, 26, 9, 9, 'FFF0FDF4')
    // Diferencia total (K25:L25)
    styleBox(ws, 25, 25, 11, 12, 'FFDBEAFE')

    // ── Generar buffer ────────────────────────────────────────────────────────
    const tariffSlug = normalizeTariff(tariff).replace('.', '')
    const clientSlug = clientName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20)
    const filename = `estudio_${clientSlug}_${tariffSlug}.xlsx`
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    // ── Guardar en Supabase si save=true ──────────────────────────────────────
    if (save) {
      try {
        const now = new Date().toISOString()
        const storagePath = `studies/${params.id}/${Date.now()}_${filename}`

        // 1. Borrar estudios económicos previos del mismo suministro (y sus archivos)
        await purgeOldStudies(supabase, params.id)

        // 2. Subir nuevo Excel a storage
        await supabase.storage
          .from('documents')
          .upload(storagePath, buffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: false,
          })

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
        const reportUrl = urlData.publicUrl

        // 3. Insertar nuevo registro con input_data completo
        await supabase.from('studies').insert({
          supply_id: params.id,
          type: 'economico',
          report_url: reportUrl,
          status: 'completed',
          created_by: user.id,
          created_at: now,
          completed_at: now,
          input_data: {
            nueva_comercializadora,
            precios_nuevos,
            ssaa,
            excesos,
            tariff,
            notes,
          },
        })

        // 4. Guardar notas + avanzar pipeline
        await supabase.from('supplies').update({
          ...(notes ? { study_notes: notes } : {}),
          status: 'estudio_completado',
          updated_at: now,
        }).eq('id', params.id)

        // 5. Notificar al comercial
        if (supply.client?.id) {
          const { data: clientData } = await supabase
            .from('clients')
            .select('commercial_id, name')
            .eq('id', supply.client_id)
            .single()

          if (clientData?.commercial_id) {
            await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/notify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: clientData.commercial_id,
                type: 'estudio_completado',
                title: 'Informe listo',
                message: `El informe económico de ${clientData.name} (${cups}) ya está disponible.`,
                link: `/supplies/${params.id}`,
                metadata: { report_url: reportUrl, supply_id: params.id },
              }),
            }).catch(() => {}) // fire & forget
          }
        }
      } catch (saveErr: any) {
        console.error('[economic-study] save error (non-fatal):', saveErr.message)
        // No bloqueamos la descarga si falla el guardado
      }
    }

    // ── Devolver el Excel ─────────────────────────────────────────────────────
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: any) {
    console.error('[economic-study]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
