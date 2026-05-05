/**
 * POST /api/supplies/import-from-excel
 *
 * Importa suministros e invoices desde Excel de facturas.
 * Soporta tres formatos automáticamente:
 *
 * FORMATO A — Label-based (Excel real de facturas, ej. Iberdrola, un suministro / una hoja):
 *   Col A: etiqueta ("CUPS", "Tarifa", "Potencia P1 (kW)", ...)
 *   Col B+: datos (una columna por mes)
 *
 * FORMATO B — Multi-suministro (un suministro por hoja, ej. Excel Ayuntamiento Estella):
 *   Cada hoja = un suministro diferente (CUPS distinto en B1).
 *   Hoja: A1=CUPS / B1=cups_value / D1=nombre_ubicación
 *         A2=Concepto / B2=Periodo / C2+=mes1, mes2, ...
 *         A3=Compañía / C3+=iberdrola, ...
 *         A4=Tarifa / C4+=2.0TD, ...
 *         A5=Fecha Inicio / C5+=fechas
 *         A6=Fecha Fin / C6+=fechas
 *         (filas de consumo, potencia, totales con unidad en col B)
 *   → Crea un supply independiente por cada hoja.
 *
 * FORMATO C — Fixed-position (plantilla VOLTIS interna):
 *   Fila 3:  CUPS
 *   Fila 4:  Titular
 *   Fila 5:  Compañía
 *   Fila 6:  Tarifa
 *   Fila 7:  Nº Factura (por columna)
 *   Fila 8:  Fecha Inicio / Fila 9: Fecha Fin / Fila 11: Días
 *   Filas 13-30: Potencia P1-P6 · Filas 32-49: Consumo P1-P6
 *   Fila 51: Total consumo kWh · Fila 65: Total factura
 *
 * Body: multipart/form-data
 *   files: File[]           (uno o varios .xlsx)
 *   clientId: string        (UUID del cliente preseleccionado, opcional)
 *   newClientName: string   (nombre para crear/buscar cliente, opcional)
 *   multiSupply: "true"     (forzar modo multi-suministro — auto-detectado si se omite)
 *
 * Response: { results: ImportResult[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { fetchSipsForCups } from '@/lib/sips'
import { normalizeTariff as normalizeTariffLib } from '@/lib/consumption-utils'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { cupsBase20 } from '@/lib/utils/cups'

export const maxDuration = 300

// ── Shared helpers ─────────────────────────────────────────────────────────────

function n(v: any): number { return Number(v ?? 0) || 0 }
function s(v: any): string { return String(v ?? '').trim() }

function normalizeTariff(raw: string): string {
  const t = raw.replace(/\s+/g, '').toUpperCase()
  const map: Record<string, string> = {
    '3.0TD': '3.0TD', '3.0': '3.0TD', '30TD': '3.0TD', '30': '3.0TD',
    '6.1TD': '6.1TD', '6.1': '6.1TD', '61TD': '6.1TD', '61': '6.1TD',
    '6.2TD': '6.2TD', '6.2': '6.2TD',
    '6.3TD': '6.3TD', '6.3': '6.3TD',
    '6.4TD': '6.4TD', '6.4': '6.4TD',
    '2.0TD': '2.0TD', '2.0': '2.0TD', '20TD': '2.0TD', '20': '2.0TD',
    '2.0DHA': '2.0DHA', '2.0A': '2.0TD',
  }
  return map[t] || raw
}

// ── Label-based parser (Formato A / B) ───────────────────────────────────────

function normLabel(str: string): string {
  if (!str) return ''
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[€]/g, 'eur')
    .replace(/[()]/g, ' ')
    .replace(/[/\-*·•]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// Unit-qualified map: clave = normLabel(colA) + '§' + normLabel(colB)
function buildRowMapByUnit(ws: ExcelJS.Worksheet): Map<string, ExcelJS.Row> {
  const map = new Map<string, ExcelJS.Row>()
  ws.eachRow((row) => {
    const a = row.getCell(1).value
    const b = row.getCell(2).value
    if (!a || typeof a !== 'string') return
    const unitRaw = b !== null && b !== undefined ? String(b).trim() : ''
    if (!unitRaw) return
    const key = `${normLabel(a)}§${normLabel(unitRaw)}`
    if (!map.has(key)) map.set(key, row)
  })
  return map
}
function getRowU(umap: Map<string, ExcelJS.Row>, label: string, unit: string): ExcelJS.Row | undefined {
  return umap.get(`${normLabel(label)}§${normLabel(unit)}`)
}
const PNAME_ES_IMPORT: Record<string, string[]> = {
  P1: ['Punta'],
  P2: ['Llano', 'Valle'],  // Algunas plantillas (Estella 2.0TD) etiquetan potencia P2 como "Valle"
  P3: ['Valle'],
  P4: ['Valle', 'Supervalle'], P5: ['Supervalle'], P6: ['Supervalle'],
}

function buildRowMap(ws: ExcelJS.Worksheet): Map<string, ExcelJS.Row> {
  const map = new Map<string, ExcelJS.Row>()
  ws.eachRow((row) => {
    const raw = row.getCell(1).value
    if (raw && typeof raw === 'string') {
      const key = normLabel(raw)
      if (!map.has(key)) map.set(key, row)
    }
  })
  return map
}

function getRow(map: Map<string, ExcelJS.Row>, label: string): ExcelJS.Row | undefined {
  return map.get(normLabel(label))
}

function cellNum(row: ExcelJS.Row | undefined, col: number): number {
  if (!row) return 0
  const v = row.getCell(col)?.value
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && 'result' in v) return Number((v as any).result) || 0
  if (typeof v === 'string') return parseFloat(v.replace(',', '.')) || 0
  return 0
}

function cellStr(row: ExcelJS.Row | undefined, col: number): string {
  if (!row) return ''
  const v = row.getCell(col)?.value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return isoDate(v)
  if (typeof v === 'object' && 'result' in v) return String((v as any).result ?? '')
  return String(v).trim()
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const MONTHS_MAP: Record<string, string> = {
  enero:'01', january:'01', jan:'01', ene:'01',
  febrero:'02', february:'02', feb:'02',
  marzo:'03', march:'03', mar:'03',
  abril:'04', april:'04', apr:'04',
  mayo:'05', may:'05',
  junio:'06', june:'06', jun:'06',
  julio:'07', july:'07', jul:'07',
  agosto:'08', august:'08', aug:'08',
  septiembre:'09', september:'09', sep:'09', sept:'09',
  octubre:'10', october:'10', oct:'10',
  noviembre:'11', november:'11', nov:'11',
  diciembre:'12', december:'12', dec:'12',
}

function parseIsoDate(raw: any): string | null {
  if (!raw) return null
  if (raw instanceof Date) return isoDate(raw)
  const str = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
  const m1 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m1) {
    const [, d, mo, y] = m1
    return `${y.length === 2 ? '20'+y : y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  const m2 = str.match(/^([a-záéíóúüñ]+)\s+(\d{4})$/i)
  if (m2) {
    const mon = MONTHS_MAP[m2[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')]
    if (mon) return `${m2[2]}-${mon}-01`
  }
  return null
}

function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const last = new Date(y, m, 0)
  return `${y}-${String(m).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1
}

function billingDays(start: string, end: string): number {
  // Iberdrola meter-reading format: Fecha Inicio is the PREVIOUS reading date (exclusive).
  // Billing days = end − start (no +1).
  //   Example full month:  31/08 → 30/09 = 30 days (Sept) ✓
  //   Example partial:     17/08 → 09/09 = 23 days        ✓
  // Standard format (Fecha Inicio = 1st of month, inclusive):
  //   01/09 → 30/09 = 29 raw + 1 = 30 days ✓
  // Heuristic: only add +1 when start day = 1 (first-of-month inclusive format).
  // Any other start day → meter-reading format → no +1.
  const raw = Math.round((new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000)
  const startDay = new Date(start + 'T00:00:00').getDate()
  return startDay === 1 ? raw + 1 : raw
}

function detectMonthCols(ws: ExcelJS.Worksheet, rowMap: Map<string, ExcelJS.Row>): number[] {
  const fechaRow = getRow(rowMap, 'Fecha Inicio')
    || getRow(rowMap, 'Periodo desde')
    || getRow(rowMap, 'Nº Factura')
  if (fechaRow) {
    const cols: number[] = []
    fechaRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      if (colNum <= 1) return
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') cols.push(colNum)
    })
    if (cols.length > 0) return cols
  }
  // Try rows 1 and 2 — row 2 is the header row in the CUPS-variant transposed format
  // (A1="CUPS", A2="Concepto/Periodo", months in row 2 cols 2+)
  for (const rowNum of [1, 2]) {
    const row = ws.getRow(rowNum)
    const cols: number[] = []
    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      if (colNum <= 1) return
      const str = String(cell.value ?? '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      // Only match actual month names — avoid false positives from CUPS strings
      if (Object.keys(MONTHS_MAP).some(m => str.startsWith(m))) cols.push(colNum)
    })
    if (cols.length > 0) return cols
  }
  return []
}

/**
 * Resolve a period label row, supporting both standard unit-in-label format
 * and the Iberdrola multi-supply format with period names in parentheses.
 *
 * Standard:  "Consumo P1 (kWh)"   "Potencia P1 (kW)"   "Potencia P1 (€)"
 * Iberdrola: "Consumo P1 (Punta)" "Potencia P1 (Punta)" [kW/€ differ only by col B unit]
 * Shorthand: "Consumo P1"         "Potencia P1"
 */
function getPeriodRow(
  rowMap: Map<string, ExcelJS.Row>,
  type: 'consumo' | 'potencia_kw' | 'potencia_eur',
  pid: string,
): ExcelJS.Row | undefined {
  const p = pid // 'P1', 'P2', etc.
  if (type === 'consumo') {
    return (
      getRow(rowMap, `Consumo ${p} kwh`)       ||   // "Consumo P1 kwh" (already norm)
      getRow(rowMap, `Consumo ${p} (kWh)`)     ||   // explicit unit
      getRow(rowMap, `Consumo ${p} (Punta)`)   ||   // 2.0TD period names
      getRow(rowMap, `Consumo ${p} (Llano)`)   ||
      getRow(rowMap, `Consumo ${p} (Valle)`)   ||
      getRow(rowMap, `Consumo ${p}`)                // bare label (unit in col B)
    )
  }
  if (type === 'potencia_kw') {
    return (
      getRow(rowMap, `Potencia ${p} kw`)       ||
      getRow(rowMap, `Potencia ${p} (kW)`)     ||
      getRow(rowMap, `Potencia ${p} (Punta)`)  ||
      getRow(rowMap, `Potencia ${p} (Llano)`)  ||
      getRow(rowMap, `Potencia ${p} (Valle)`)  ||
      getRow(rowMap, `Potencia ${p}`)
    )
  }
  // potencia_eur — same label as kW row in Iberdrola format; distinguishable only by col B
  // The kW row is keyed first in buildRowMap (if !map.has(key)), so the € row is invisible.
  // For totals we rely on TOTAL COSTE POTENCIA row instead, so return undefined here.
  return undefined
}

function getPriceRow(rowMap: Map<string, ExcelJS.Row>, pid: string): ExcelJS.Row | undefined {
  const p = pid
  return (
    getRow(rowMap, `Precio ${p} eur kwh`)       ||
    getRow(rowMap, `Precio ${p} (€/kWh)`)       ||
    getRow(rowMap, `Precio ${p} (Punta)`)        ||
    getRow(rowMap, `Precio ${p} (Llano)`)        ||
    getRow(rowMap, `Precio ${p} (Valle)`)        ||
    getRow(rowMap, `Precio ${p}`)
  )
}

/** Parse Excel in label-based format (real electricity invoice Excel) */
function parseLabelBased(ws: ExcelJS.Worksheet, fileName: string): ParsedSupplyFile {
  const rowMap = buildRowMap(ws)
  const monthCols = detectMonthCols(ws, rowMap)

  // ── Static fields ──────────────────────────────────────────────────────────
  // In some formats (Iberdrola multi-supply), static fields like tariff/company
  // are in col B=unit, data from col C onwards. Use the first month col as fallback.
  const staticCol = monthCols.length > 0 ? monthCols[0] : 2

  // ── Secondary map for "Potencia Px €" rows (Estella/Iberdrola format) ─────
  // buildRowMap only keeps the FIRST row per label. When "Potencia P1" appears
  // twice (once kW, once €), the € row is lost. We recover it here by scanning
  // for rows whose col A = "Potencia Px" AND col B normalises to "eur" (= €).
  const potenciaEurMap = new Map<string, ExcelJS.Row>()
  ws.eachRow((row) => {
    const colA = normLabel(s(row.getCell(1).value))
    const colB = normLabel(s(row.getCell(2).value))
    // colB "€" normalises to "eur" via normLabel's € → eur replacement
    if (/^potencia p\d/.test(colA) && colB === 'eur') {  // regex ampliado para capturar "potencia p1 punta", etc.
      potenciaEurMap.set(colA, row) // e.g. "potencia p1" → € row
    }
  })

  const cupsRow = getRow(rowMap, 'CUPS')
  const cups = cellStr(cupsRow, 2)
  // Location name: stored in col D (4) of the CUPS row in Iberdrola multi-supply format
  const locationName = cellStr(cupsRow, 4) || cellStr(cupsRow, 3) || ''

  // Try col 2 first (standard format), then fall back to first data col
  const rawTariff = cellStr(getRow(rowMap, 'Tarifa'), 2) || cellStr(getRow(rowMap, 'Tarifa'), staticCol)
    || cellStr(getRow(rowMap, 'Tariff'), 2) || cellStr(getRow(rowMap, 'Tariff'), staticCol)
  const tarifa = normalizeTariff(rawTariff)

  // Detect supply type: explicit "Tipo" row (gas/luz) or gas tariff prefix (RL.x)
  const tipoRow = getRow(rowMap, 'Tipo')
  const tipoVal = tipoRow ? cellStr(tipoRow, staticCol).toLowerCase().trim() : ''
  const supplyType: 'gas' | 'luz' =
    (tipoVal === 'gas' || rawTariff.trim().toUpperCase().replace(/\s+/g, '').startsWith('RL'))
      ? 'gas' : 'luz'

  const comRow = getRow(rowMap, 'Compañia') ?? getRow(rowMap, 'Compania') ?? getRow(rowMap, 'Empresa')
    ?? getRow(rowMap, 'Comercializadora') ?? getRow(rowMap, 'Suministrador')
  const compania = cellStr(comRow, 2) || cellStr(comRow, staticCol)

  const titRow = getRow(rowMap, 'Titular') ?? getRow(rowMap, 'Nombre')
  const titular = cellStr(titRow, 2) || cellStr(titRow, staticCol) || ''

  // ── Per-month data ─────────────────────────────────────────────────────────
  const invoices: ParsedInvoice[] = []
  const umap = buildRowMapByUnit(ws)  // unit-qualified map for duplicate-label resolution

  for (const col of monthCols) {
    let rawStart: any = getRow(rowMap, 'Fecha Inicio')?.getCell(col).value
      ?? getRow(rowMap, 'Periodo desde')?.getCell(col).value
    const rawEnd: any = getRow(rowMap, 'Fecha Fin')?.getCell(col).value
      ?? getRow(rowMap, 'Periodo hasta')?.getCell(col).value
    // Fallback: when no explicit "Fecha Inicio" row, derive the date from the
    // column header (month name in row 1 or row 2 — covers both transposed variants)
    if (!rawStart) {
      rawStart = ws.getRow(1).getCell(col).value || ws.getRow(2).getCell(col).value
    }
    let periodStart = parseIsoDate(rawStart)
    let periodEnd   = parseIsoDate(rawEnd)
    if (periodStart && !periodEnd) periodEnd = lastDayOfMonth(periodStart)
    if (!periodStart) continue

    const dias = billingDays(periodStart, periodEnd!)

    // Precio horario uniforme (algunas facturas: Endesa "Energía Precio horario")
    const precioHorario = cellNum(getRow(rowMap, 'Precio Horario'), col)
      || cellNum(getRow(rowMap, 'Energia Precio Horario'), col)
      || cellNum(getRowU(umap, 'Energia Precio horario', '€/kWh'), col)

    const potencia = []
    for (let p = 1; p <= 6; p++) {
      const pid    = `P${p}`
      const pnames = PNAME_ES_IMPORT[pid] ?? []
      const kwRow  = getPeriodRow(rowMap, 'potencia_kw', pid)
      let kw = cellNum(kwRow, col)
      // Unit-qualified lookup for Spanish period names (Ayuntamiento format)
      if (!kw) {
        for (const pn of pnames) {
          kw = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, 'kW'), col)
            || cellNum(getRowU(umap, `Potencia ${pid} ${pn}`, 'kW'), col)
          if (kw) break
        }
      }

      // Total €: try potenciaEurMap (normalized full key), standard labels, unit-qualified
      let totalPot = 0
      // potenciaEurMap now uses full norm key including Spanish names
      for (const pn of ['', ...pnames]) {
        const key = pn ? normLabel(`Potencia ${pid} (${pn})`) : normLabel(`Potencia ${pid}`)
        const row = potenciaEurMap.get(key)
        if (row) { totalPot = cellNum(row, col); break }
      }
      totalPot = totalPot
        || cellNum(getRow(rowMap, `Potencia ${pid} eur`), col)
        || cellNum(getRow(rowMap, `Potencia ${pid} (€)`), col)
      if (!totalPot) {
        for (const pn of pnames) {
          totalPot = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€'), col)
            || cellNum(getRowU(umap, `Potencia ${pid} ${pn}`, '€'), col)
          if (totalPot) break
        }
      }
      // Peaje + cargo totals fallback
      if (!totalPot) {
        const tPeaje = cellNum(getRow(rowMap, `Potencia ${pid} peajes eur`), col)
        const tCargo = cellNum(getRow(rowMap, `Potencia ${pid} cargos eur`), col)
        if (tPeaje > 0 || tCargo > 0) totalPot = tPeaje + tCargo
      }

      // Price €/kW·día: try direct labels, then peaje+cargo, then back-calculate
      let precioKwDia = cellNum(getRow(rowMap, `Potencia ${pid} eur kw dia`), col)
        || cellNum(getRow(rowMap, `Potencia ${pid} (€/kW día)`), col)
      if (!precioKwDia) {
        for (const pn of pnames) {
          precioKwDia = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW día'), col)
            || cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW·día'), col)
          if (precioKwDia) break
        }
      }
      if (!precioKwDia) {
        const peaje = cellNum(getRow(rowMap, `Potencia ${pid} peajes eur kw dia`), col)
        const cargo  = cellNum(getRow(rowMap, `Potencia ${pid} cargos eur kw dia`), col)
        if (peaje > 0 || cargo > 0) precioKwDia = peaje + cargo
      }
      // Annual (€/kW·año) → ÷365
      if (!precioKwDia) {
        const anual = cellNum(getRow(rowMap, `Potencia ${pid} eur kw ano`), col)
          || cellNum(getRow(rowMap, `Potencia ${pid} (€/kW año)`), col)
        if (anual > 0) precioKwDia = Math.round((anual / 365) * 1000000) / 1000000
      }
      // Back-calculate from total / (kW × días)
      if (!precioKwDia && kw > 0 && totalPot > 0 && dias > 0) {
        precioKwDia = Math.round((totalPot / (kw * dias)) * 100000) / 100000
      }

      if (kw > 0 || totalPot > 0) potencia.push({ periodo: pid, kw, precioKwDia, dias, total: totalPot })
    }

    const consumo = []
    for (let p = 1; p <= 6; p++) {
      const pid    = `P${p}`
      const pnames = PNAME_ES_IMPORT[pid] ?? []
      const kwh    = cellNum(getPeriodRow(rowMap, 'consumo', pid), col)
      // Energy price: direct, then unit-qualified, then peaje+cargo
      let precio = cellNum(getPriceRow(rowMap, pid), col)
      if (!precio) {
        for (const pn of pnames) {
          precio = cellNum(getRowU(umap, `Precio ${pid} (${pn})`, '€/kWh'), col)
            || cellNum(getRowU(umap, `Precio ${pid} ${pn}`, '€/kWh'), col)
          if (precio) break
        }
      }
      if (!precio) {
        let peaje = cellNum(getRow(rowMap, `Energia facturada peajes ${pid} eur kwh`), col)
        let cargo  = cellNum(getRow(rowMap, `Energia facturada cargos ${pid} eur kwh`), col)
        for (const pn of pnames) {
          peaje = peaje || cellNum(getRowU(umap, `Energia facturada peajes ${pid} (${pn})`, '€/kWh'), col)
          cargo  = cargo  || cellNum(getRowU(umap, `Energia facturada cargos ${pid} (${pn})`, '€/kWh'), col)
          if (peaje || cargo) break
        }
        if (peaje > 0 || cargo > 0) precio = (precioHorario || 0) + peaje + cargo
      }
      const total  = kwh > 0 && precio > 0 ? Math.round(kwh * precio * 100) / 100 : 0
      if (kwh > 0) consumo.push({ periodo: pid, kwh, precioKwh: precio, total })
    }

    // Gas: single-period energy (no P1-P6 breakdown) — Naturgy format
    if (consumo.length === 0) {
      const gasKwh = cellNum(getRow(rowMap, 'Consumo total (kWh)'), col)
      const gasPrecio = cellNum(getRow(rowMap, 'Precio medio energía (€/kWh)'), col)
        || cellNum(getRow(rowMap, 'Precio medio energia (€/kWh)'), col)
      const gasConsumoEur = cellNum(getRow(rowMap, 'Consumo energía (€)'), col)
        || cellNum(getRow(rowMap, 'Consumo energia (€)'), col)
      if (gasKwh > 0) {
        const price = gasPrecio || (gasConsumoEur > 0 ? gasConsumoEur / gasKwh : 0)
        consumo.push({ periodo: 'P1', kwh: gasKwh, precioKwh: price,
          total: gasConsumoEur || Math.round(gasKwh * price * 100) / 100 })
      }
    }

    const consumoTotalKwh    = cellNum(getRow(rowMap, 'TOTAL CONSUMO (kWh)'), col)
      || cellNum(getRow(rowMap, 'total consumo kwh'), col)
      || cellNum(getRow(rowMap, 'TOTAL CONSUMO'), col)
      || cellNum(getRow(rowMap, 'Consumo total (kWh)'), col)
      || consumo.reduce((a, c) => a + c.kwh, 0)

    const costeTotalConsumo  = cellNum(getRow(rowMap, 'TOTAL COSTE CONSUMO (€)'), col)
      || cellNum(getRow(rowMap, 'total coste consumo eur'), col)
      || cellNum(getRow(rowMap, 'TOTAL COSTE CONSUMO'), col)
      || cellNum(getRow(rowMap, 'Consumo energía (€)'), col)
      || cellNum(getRow(rowMap, 'Consumo energia (€)'), col)
      || consumo.reduce((a, c) => a + c.total, 0)

    const costeTotalPotencia = cellNum(getRow(rowMap, 'TOTAL COSTE POTENCIA (€)'), col)
      || cellNum(getRow(rowMap, 'total coste potencia eur'), col)
      || cellNum(getRow(rowMap, 'TOTAL COSTE POTENCIA'), col)
      || potencia.reduce((a, p) => a + p.total, 0)

    // Gas-specific fields (read before totalFactura so IVA is available)
    const terminoFijoDiario = cellNum(getRow(rowMap, 'Término Fijo'), col)
      || cellNum(getRow(rowMap, 'Termino Fijo'), col)
      || cellNum(getRow(rowMap, 'Término Fijo (€/día)'), col)
      || cellNum(getRow(rowMap, 'Termino Fijo (€/dia)'), col)
    const terminoFijoTotal  = cellNum(getRow(rowMap, 'Término Fijo Total'), col)
      || cellNum(getRow(rowMap, 'Termino Fijo Total'), col)
      || cellNum(getRow(rowMap, 'Término fijo (€)'), col)
      || cellNum(getRow(rowMap, 'Termino fijo (€)'), col)
    const impuestoHidrocarb = cellNum(getRow(rowMap, 'Impuesto Hidrocarburos'), col)
      || cellNum(getRow(rowMap, 'Imp Hidrocarburos'), col)
      || cellNum(getRow(rowMap, 'IE Hidrocarburos (€)'), col)

    // IVA — Naturgy gas stores as decimal (0.21); convert to percentage
    const rawIvaPct = cellNum(getRow(rowMap, 'IVA %'), col)
      || cellNum(getRow(rowMap, 'IVA (%)'), col)
      || cellNum(getRow(rowMap, 'IVA'), col)
    const ivaPct = rawIvaPct > 0 && rawIvaPct < 1 ? Math.round(rawIvaPct * 100) : rawIvaPct

    // Total gas base (Naturgy: "Total gas (€)" = base imponible pre-IVA)
    const totalGasBase = cellNum(getRow(rowMap, 'Total gas (€)'), col)
    const totalFactura = cellNum(getRow(rowMap, 'TOTAL FACTURA (€)'), col)
      || cellNum(getRow(rowMap, 'total factura eur'), col)
      || cellNum(getRow(rowMap, 'TOTAL FACTURA'), col)
      || (totalGasBase > 0 && ivaPct > 0
          ? Math.round(totalGasBase * (1 + ivaPct / 100) * 100) / 100
          : totalGasBase)

    if (consumoTotalKwh === 0 && totalFactura === 0 && costeTotalConsumo === 0) continue

    // Factura number: explicit row or fallback to period
    const numFactura = cellStr(getRow(rowMap, 'Nº Factura'), col)
      || cellStr(getRow(rowMap, 'Num Factura'), col)
      || `${periodStart.slice(0,7)}`

    // IVA total: explicit row or compute from base × fraction
    const rawIvaTotal = cellNum(getRow(rowMap, 'IVA / IGIC (€)'), col)
      || cellNum(getRow(rowMap, 'IVA/IGIC (€)'), col)
      || cellNum(getRow(rowMap, 'IVA (€)'), col)
      || cellNum(getRow(rowMap, 'IVA / IGIC'), col)
    const ivaTotal = rawIvaTotal
      || (totalGasBase > 0 && ivaPct > 0
          ? Math.round(totalGasBase * (ivaPct / 100) * 100) / 100 : 0)

    invoices.push({
      numFactura,
      fechaInicio:  periodStart,
      fechaFin:     periodEnd!,
      fechaEmision: '',
      dias,
      potencia,
      consumo,
      consumoTotalKwh,
      costeBrutoConsumo:  costeTotalConsumo,
      descuentoEnergia:   0,
      costeNetoConsumo:   costeTotalConsumo,
      costeTotalConsumo,
      costeTotalPotencia,
      iva:              ivaPct,
      peajes:           cellNum(getRow(rowMap, 'Financiacion Bono Social (€)'), col)
                      + cellNum(getRow(rowMap, 'Bono Social (€)'), col)
                      + cellNum(getRow(rowMap, 'Bono Social'), col)
                      + cellNum(getRow(rowMap, 'Aportacion FNEE (€)'), col)
                      + cellNum(getRow(rowMap, 'FNEE (€)'), col)
                      + cellNum(getRow(rowMap, 'FNEE'), col),
      impuestoElectrico: cellNum(getRow(rowMap, 'Impuesto Electrico (€)'), col)
                       || cellNum(getRow(rowMap, 'Impuesto Electrico'), col)
                       || cellNum(getRow(rowMap, 'Impuesto Eléctrico (€)'), col)
                       || cellNum(getRow(rowMap, 'Impuesto Electrico'), col),
      alquiler:         cellNum(getRow(rowMap, 'Alquiler Equipos de Medida (€)'), col)
                      || cellNum(getRow(rowMap, 'Alquiler (€)'), col)
                      || cellNum(getRow(rowMap, 'Alquiler Contadores (€)'), col)
                      || cellNum(getRow(rowMap, 'Alquiler contador (€)'), col)
                      || cellNum(getRow(rowMap, 'Alquiler'), col),
      otros:            cellNum(getRow(rowMap, 'Exceso de Potencia (€)'), col)
                      + cellNum(getRow(rowMap, 'Exceso Potencia (€)'), col)
                      + cellNum(getRow(rowMap, 'Exceso Potencia'), col)
                      + cellNum(getRow(rowMap, 'Energia Reactiva (€)'), col)
                      + cellNum(getRow(rowMap, 'Reactiva (€)'), col)
                      + cellNum(getRow(rowMap, 'Reactiva'), col)
                      + cellNum(getRow(rowMap, 'Compensacion Excedentes (€)'), col)
                      + cellNum(getRow(rowMap, 'Compensacion Excedentes'), col),
      ivaTotal,
      totalFactura,
      terminoFijoDiario: terminoFijoDiario || undefined,
      terminoFijoTotal:  terminoFijoTotal  || undefined,
      impuestoHidrocarb: impuestoHidrocarb || undefined,
    })
  }

  return { fileName, cups, titular, compania, tarifa, locationName: locationName || undefined, invoices, supplyType }
}

const CUPS_RE = /^ES[A-Z0-9]{18,20}$/i

interface ParsedInvoice {
  numFactura: string
  fechaInicio: string
  fechaFin: string
  fechaEmision: string
  dias: number
  potencia: { periodo: string; kw: number; precioKwDia: number; dias: number; total: number }[]
  consumo: { periodo: string; kwh: number; precioKwh: number; total: number }[]
  consumoTotalKwh: number
  costeBrutoConsumo: number
  descuentoEnergia: number
  costeNetoConsumo: number
  costeTotalConsumo: number
  costeTotalPotencia: number
  iva: number
  peajes: number
  impuestoElectrico: number
  alquiler: number
  otros: number
  ivaTotal: number
  totalFactura: number
  // Gas-specific
  terminoFijoDiario?: number
  terminoFijoTotal?: number
  impuestoHidrocarb?: number
}

interface ParsedSupplyFile {
  fileName: string
  cups: string
  titular: string
  compania: string
  tarifa: string
  locationName?: string
  invoices: ParsedInvoice[]
  supplyType?: 'gas' | 'luz'
}

// ── Transposed-sheet detection (module-level so it can be reused) ─────────────

function isTransposedSheet(ws: ExcelJS.Worksheet): boolean {
  const a1 = normLabel(s(ws.getCell(1, 1).value))

  // Signature A: standard transposed (A1 = "Concepto / Periodo", months in row 1 cols 2+)
  if (a1.includes('concepto') || a1.includes('periodo')) {
    for (let c = 2; c <= Math.min(ws.columnCount || 14, 14); c++) {
      const h = s(ws.getCell(1, c).value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      if (Object.keys(MONTHS_MAP).some(m => h.startsWith(m))) return true
    }
  }

  // Signature B: CUPS-header variant (A1="CUPS", A2="Concepto / Periodo", months in row 2 cols 3+)
  if (a1 === 'cups') {
    const a2 = normLabel(s(ws.getCell(2, 1).value))
    if (a2.includes('concepto') || a2.includes('periodo')) {
      for (let c = 3; c <= Math.min(ws.columnCount || 16, 16); c++) {
        const h = s(ws.getCell(2, c).value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        if (Object.keys(MONTHS_MAP).some(m => h.startsWith(m))) return true
      }
    }
  }

  // Signature C: label-based with CUPS value in B1 (Naturgy gas per-sheet format)
  // A1="CUPS", B1=actual CUPS string → each row is label/data (no month names needed)
  if (a1 === 'cups') {
    const b1 = s(ws.getCell(1, 2).value).toUpperCase().replace(/\s/g, '')
    if (CUPS_RE.test(b1)) return true
  }

  return false
}

/**
 * Detect if a multi-sheet workbook is in "multi-supply" mode:
 * each sheet represents a DIFFERENT supply (different CUPS in B1).
 */
function isMultiSupplyWorkbook(wb: ExcelJS.Workbook): boolean {
  const cupsSet = new Set<string>()
  let transposedCount = 0
  for (const ws of wb.worksheets) {
    if (ws.rowCount < 5) continue
    if (!isTransposedSheet(ws)) continue
    transposedCount++
    const a1 = normLabel(s(ws.getCell(1, 1).value))
    if (a1 === 'cups') {
      const b1 = s(ws.getCell(1, 2).value).toUpperCase()
      if (CUPS_RE.test(b1)) cupsSet.add(b1)
    }
  }
  // Multi-supply if there are ≥2 populated sheets and each has a distinct CUPS
  return transposedCount >= 2 && cupsSet.size === transposedCount
}

/** Parsea un Excel de facturas — detecta automáticamente el formato (label-based o fixed-position)
 *  @param targetCups  CUPS de respaldo si el Excel no lo contiene (ej. Iberdrola transposed)
 */
async function parseExcelFile(buffer: Buffer, fileName: string, targetCups?: string): Promise<ParsedSupplyFile> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  // Check if ALL populated sheets look like the transposed format
  const allTransposed = wb.worksheets.length > 0 && wb.worksheets.every(ws => {
    if (ws.rowCount < 5) return true
    return isTransposedSheet(ws)
  }) && wb.worksheets.some(ws => ws.rowCount >= 5 && isTransposedSheet(ws))

  if (allTransposed) {
    // Multi-sheet label-based: merge invoices from all sheets into ONE supply
    // (used when the file represents multiple billing periods for the same supply)
    const allInvoices: ParsedInvoice[] = []
    let cups = '', titular = '', compania = '', tarifa = '', locationName = ''
    for (const ws of wb.worksheets) {
      if (ws.rowCount < 5) continue
      const parsed = parseLabelBased(ws, fileName)
      if (!cups && parsed.cups) cups = parsed.cups
      if (!titular && parsed.titular) titular = parsed.titular
      if (!compania && parsed.compania) compania = parsed.compania
      if (!tarifa && parsed.tarifa) tarifa = parsed.tarifa
      if (!locationName && parsed.locationName) locationName = parsed.locationName
      allInvoices.push(...parsed.invoices)
    }
    // Sort chronologically
    allInvoices.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
    const fallbackCups = targetCups?.trim().toUpperCase() || ''
    return { fileName, cups: cups || fallbackCups, titular, compania, tarifa,
      locationName: locationName || undefined, invoices: allInvoices }
  }

  // ── Standard single-sheet format ──────────────────────────────────────────
  const ws = wb.getWorksheet('Facturas') || wb.worksheets[0]
  if (!ws) throw new Error(`${fileName}: no se encontró ninguna hoja de cálculo`)

  // ── Auto-detect format ─────────────────────────────────────────────────────
  let hasLabelCUPS = false
  for (let row = 1; row <= 20; row++) {
    const cellVal = s(ws.getCell(row, 1).value)
    if (normLabel(cellVal) === 'cups') { hasLabelCUPS = true; break }
  }

  // Also check: if B3 is a valid CUPS → fixed-position format
  const b3 = s(ws.getCell(3, 2).value)
  const b3IsCups = CUPS_RE.test(b3.replace(/\s+/g,''))

  if (hasLabelCUPS && !b3IsCups) {
    // Label-based format (real electricity invoice Excel)
    const parsed = parseLabelBased(ws, fileName)
    if (!parsed.cups && targetCups) parsed.cups = targetCups.trim().toUpperCase()
    return parsed
  }

  // ── Fixed-position parser (VOLTIS template) ───────────────────────────────
  const gc = (row: number, col: number): any => ws.getCell(row, col).value

  const cups    = s(gc(3, 2)) || (targetCups?.trim().toUpperCase() || '')
  const titular = s(gc(4, 2))
  const compania = s(gc(5, 2))
  const tarifa  = normalizeTariff(s(gc(6, 2)))

  if (!cups) throw new Error(`${fileName}: no se encontró CUPS en la celda B3`)

  let maxCol = 2
  while (ws.getCell(1, maxCol + 1).value !== null && ws.getCell(1, maxCol + 1).value !== undefined) {
    maxCol++
    if (maxCol > 50) break
  }

  const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
  const invoices: ParsedInvoice[] = []

  for (let col = 2; col <= maxCol; col++) {
    const g = (row: number) => gc(row, col)
    const numFact = s(g(7))
    if (!numFact) continue

    const dias = n(g(11))
    const potencia = []
    for (let i = 0; i < 6; i++) {
      const baseRow = 13 + i * 3
      potencia.push({
        periodo: PERIODS[i],
        kw:          n(g(baseRow)),
        precioKwDia: n(g(baseRow + 1)),
        dias,
        total:       n(g(baseRow + 2)),
      })
    }

    const consumo = []
    for (let i = 0; i < 6; i++) {
      const baseRow = 32 + i * 3
      consumo.push({
        periodo:   PERIODS[i],
        kwh:       n(g(baseRow)),
        precioKwh: n(g(baseRow + 1)),
        total:     n(g(baseRow + 2)),
      })
    }

    invoices.push({
      numFactura:    numFact,
      fechaInicio:   s(g(8)),
      fechaFin:      s(g(9)),
      fechaEmision:  s(g(10)),
      dias,
      potencia,
      consumo,
      consumoTotalKwh:    n(g(51)),
      costeBrutoConsumo:  n(g(52)),
      descuentoEnergia:   n(g(53)),
      costeNetoConsumo:   n(g(54)),
      costeTotalConsumo:  n(g(55)),
      costeTotalPotencia: n(g(56)),
      iva:                n(g(57)),
      peajes:             n(g(59)),
      impuestoElectrico:  n(g(60)),
      alquiler:           n(g(61)),
      otros:              n(g(62)),
      ivaTotal:           n(g(63)),
      totalFactura:       n(g(65)),
    })
  }

  return { fileName, cups, titular, compania, tarifa, invoices }
}

/**
 * Parse a multi-supply workbook: each sheet = one independent supply.
 * Returns one ParsedSupplyFile per sheet.
 */
async function parseMultiSheetAsSupplies(buffer: Buffer): Promise<ParsedSupplyFile[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  const results: ParsedSupplyFile[] = []
  for (const ws of wb.worksheets) {
    if (ws.rowCount < 5) continue
    if (!isTransposedSheet(ws)) continue
    const parsed = parseLabelBased(ws, ws.name)
    if (!parsed.cups) {
      console.warn(`[import-from-excel] Sheet "${ws.name}" has no CUPS — skipped`)
      continue
    }
    results.push(parsed)
  }
  return results
}

/** Agrega consumo anual por periodo sumando todos los datos del Excel. */
function buildAnnualConsumptionData(parsed: ParsedSupplyFile) {
  const consumoPeriodos: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  for (const inv of parsed.invoices) {
    for (const c of inv.consumo) {
      consumoPeriodos[c.periodo] = (consumoPeriodos[c.periodo] || 0) + c.kwh
    }
  }
  const totalKwh = Object.values(consumoPeriodos).reduce((a, b) => a + b, 0)
  return { consumoPeriodos, totalKwh }
}

type SupplyImportResult = {
  fileName: string
  cups?: string
  ok: boolean
  invoicesCreated?: number
  invoicesSkipped?: number
  isNew?: boolean
  tarifa?: string
  supplyId?: string
  locationName?: string
  error?: string
}

/** Core logic: upsert supply + invoices for one ParsedSupplyFile */
async function processSupply(
  parsed: ParsedSupplyFile,
  resolvedClientId: string,
  newClientName: string,
  supabase: any,
  userId?: string,
  forceUpdate = false,  // si true, actualiza facturas existentes en vez de saltarlas
  excelFileUrl?: string,  // URL del Excel en Storage (para mostrarlo en documentos)
): Promise<SupplyImportResult> {
  const fileName = parsed.fileName
  const isGas = parsed.supplyType === 'gas'
    || (parsed.tarifa || '').trim().toUpperCase().replace(/\s+/g, '').startsWith('RL')
  try {
    const annualData = buildAnnualConsumptionData(parsed)

    // ── Find or create supply (always use base-20 prefix for CUPS lookup) ────
    const base20 = parsed.cups ? cupsBase20(parsed.cups) : null

    let { data: existingSupply } = base20
      ? await supabase.from('supplies').select('id, cups, consumption_data')
          .ilike('cups', `${base20}%`).limit(1).maybeSingle()
      : { data: null }

    // If no CUPS match, find this client's luz supply with no CUPS yet
    let isNoCupsUpgrade = false
    if (!existingSupply && parsed.cups && resolvedClientId) {
      const { data: noCupsSupply } = await supabase
        .from('supplies')
        .select('id, consumption_data')
        .eq('client_id', resolvedClientId)
        .eq('type', isGas ? 'gas' : 'luz')
        .or('cups.is.null,cups.eq.')
        .limit(1)
        .maybeSingle()

      if (noCupsSupply) {
        existingSupply = noCupsSupply
        isNoCupsUpgrade = true
      }
    }

    let supplyId: string

    if (existingSupply) {
      supplyId = existingSupply.id
      const patch: Record<string, any> = {
        consumption_data: annualData,
        tariff: parsed.tarifa,
        updated_at: new Date().toISOString(),
      }
      if (isNoCupsUpgrade) patch.cups = parsed.cups
      if (parsed.locationName && !existingSupply.name) patch.name = parsed.locationName
      // Upgrade stored CUPS from 20→22 chars if we now have the longer form
      if (parsed.cups && parsed.cups.length === 22 && existingSupply.cups?.length === 20) {
        patch.cups = parsed.cups
      }
      await supabase.from('supplies').update(patch).eq('id', supplyId)
    } else if (resolvedClientId === '__cups_only__') {
      // cupsOnly mode: don't create new supplies — skip sheets with no existing CUPS match
      return { fileName, cups: parsed.cups, ok: false, error: 'CUPS not found in DB (cupsOnly mode — skipped)' }
    } else {
      const insertData: Record<string, any> = {
        cups: parsed.cups,
        client_id: resolvedClientId,
        tariff: parsed.tarifa,
        type: isGas ? 'gas' : 'luz',
        status: 'estudio_en_curso',
        consumption_data: annualData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      if (parsed.locationName) insertData.name = parsed.locationName

      const { data: newSupply, error: supplyErr } = await supabase
        .from('supplies')
        .insert(insertData)
        .select('id')
        .single()

      if (supplyErr || !newSupply) {
        const isUniqueConflict = supplyErr?.code === '23505'
          || supplyErr?.message?.includes('unique')
          || supplyErr?.message?.includes('duplicate')
        if (isUniqueConflict && base20) {
          const { data: raced } = await supabase.from('supplies').select('id, consumption_data')
            .ilike('cups', `${base20}%`).limit(1).maybeSingle()
          if (raced) {
            await supabase.from('supplies').update({ consumption_data: annualData, tariff: parsed.tarifa,
              updated_at: new Date().toISOString() }).eq('id', raced.id)
            supplyId = raced.id
            ;(existingSupply as any) = raced
          } else {
            return { fileName, cups: parsed.cups, ok: false, error: 'Error de conflicto al crear suministro' }
          }
        } else {
          return { fileName, cups: parsed.cups, ok: false, error: supplyErr?.message || 'Error creando suministro' }
        }
      } else {
        supplyId = newSupply.id
      }
    }

    // ── SIPS fetch + power study (fire and forget) ────────────────────────────
    if ((!existingSupply || isNoCupsUpgrade) && !isGas) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
      void fetchSipsForCups(parsed.cups, 'luz').then(async (sipsData) => {
        if (!sipsData) return
        const sipsNormalizedTariff = sipsData.tariff ? (normalizeTariffLib(sipsData.tariff) || sipsData.tariff) : null
        // When SIPS returns consumoPeriodos (annual breakdown by period), recalculate
        // totalKwh from those values so it reflects the official SIPS annual figure,
        // NOT the invoice-derived sum (which may cover fewer than 12 months).
        const sipsConsumoPeriodos = sipsData.consumoPeriodos
        const sipsTotalKwh = sipsConsumoPeriodos
          ? Object.values(sipsConsumoPeriodos as Record<string, number>).reduce((a, b) => a + b, 0)
          : null

        const merged = {
          ...annualData,
          ...(sipsData.potenciaContratada ? { potenciaContratada: sipsData.potenciaContratada } : {}),
          ...(sipsConsumoPeriodos ? { consumoPeriodos: sipsConsumoPeriodos } : {}),
          // Override totalKwh with the authoritative SIPS annual sum
          ...(sipsTotalKwh && sipsTotalKwh > 0 ? { totalKwh: sipsTotalKwh } : {}),
          source: 'excel_import_with_sips',
          fetched_at: new Date().toISOString(),
          sips_tariff: sipsData.tariff,
          distribuidora: sipsData.distribuidora,
          codigoPostal: sipsData.codigoPostal,
          provincia: sipsData.provincia,
          municipio: sipsData.municipio,
          cnae: sipsData.cnae,
          tension: sipsData.tension,
          history: sipsData.consumptionHistory || [],
          maximetroHistory: sipsData.maximetroHistory || [],
        }
        await supabase.from('supplies').update({
          consumption_data: merged,
          ...(sipsNormalizedTariff ? { tariff: sipsNormalizedTariff } : {}),
          address: sipsData.municipio ? [sipsData.municipio, sipsData.provincia].filter(Boolean).join(', ') : undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', supplyId)

        if (sipsData.consumptionHistory?.length && sipsData.potenciaContratada) {
          const r = await fetch(`${baseUrl}/api/power-study-auto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cups: parsed.cups,
              clientName: newClientName || parsed.locationName || 'Excel Import',
              potenciaContratada: sipsData.potenciaContratada,
              consumptionHistory: sipsData.consumptionHistory,
              maximetroHistory: sipsData.maximetroHistory || [],
            }),
          })
          if (r.ok) {
            const studyResult = await r.json()
            await supabase.from('supplies').update({ power_study_result: studyResult,
              updated_at: new Date().toISOString() }).eq('id', supplyId)
          }
        }
      }).catch((err: any) => console.warn('[import-from-excel] SIPS error (non-fatal):', err?.message))
    }

    // ── Find comercializadora (best-effort) ──────────────────────────────────
    if (parsed.compania) {
      supabase.from('comercializadoras').select('id').ilike('name', `%${parsed.compania}%`).limit(1).single()
        .then(({ data: comerc }: { data: any }) => {
          if (comerc) supabase.from('supplies').update({ comercializadora_id: comerc.id }).eq('id', supplyId)
        }).catch(() => {})
    }

    // ── Batch insert invoices ────────────────────────────────────────────────
    const { data: existingInvoices } = await supabase
      .from('invoices').select('period_start, period_end').eq('supply_id', supplyId)

    const existingPairs = new Set(
      (existingInvoices || []).map((i: any) => `${i.period_start}|${i.period_end}`)
    )

    const toInsert = []
    const toUpdate = []
    for (const inv of parsed.invoices) {
      const pairKey = `${inv.fechaInicio}|${inv.fechaFin}`
      if (existingPairs.has(pairKey)) {
        if (!forceUpdate) continue  // saltar si no es re-importación forzada
        toUpdate.push(inv)          // re-importación: actualizar datos existentes
        continue
      }

      const consumoFiltered = inv.consumo.filter(c => c.kwh > 0 || c.total > 0).map(c => ({
        ...c,
        total: c.total || c.kwh * c.precioKwh,
      }))
      const gasPrecioKwh = consumoFiltered[0]?.precioKwh
        || (inv.consumoTotalKwh > 0 && inv.costeTotalConsumo > 0
          ? Math.round((inv.costeTotalConsumo / inv.consumoTotalKwh) * 1e6) / 1e6 : 0)
      const economics = {
        fechaInicio:   inv.fechaInicio,
        fechaFin:      inv.fechaFin,
        cups:          parsed.cups,
        tarifa:        parsed.tarifa,
        supply_type:   (isGas ? 'gas' : 'luz') as 'gas' | 'luz',
        comercializadora: parsed.compania || undefined,
        potencia:      inv.potencia.filter(p => p.kw > 0 || p.total > 0),
        consumo:       consumoFiltered,
        consumoTotalKwh:    inv.consumoTotalKwh,
        costeBrutoConsumo:  inv.costeBrutoConsumo,
        descuentoEnergia:   inv.descuentoEnergia,
        costeNetoConsumo:   inv.costeNetoConsumo,
        costeTotalConsumo:  inv.costeTotalConsumo,
        costeTotalPotencia: inv.costeTotalPotencia,
        costeMedioKwh: inv.consumoTotalKwh > 0 ? inv.costeTotalConsumo / inv.consumoTotalKwh : 0,
        costeMedioKwhNeto: inv.consumoTotalKwh > 0 ? inv.costeNetoConsumo / inv.consumoTotalKwh : 0,
        otrosConceptos: [
          inv.peajes > 0            && { concepto: 'Peajes y Transportes',  total: inv.peajes },
          inv.impuestoElectrico > 0 && { concepto: 'Impuesto Eléctrico',    total: inv.impuestoElectrico },
          inv.alquiler > 0          && { concepto: 'Alquiler de Equipos',   total: inv.alquiler },
          inv.otros > 0             && { concepto: 'Otros',                 total: inv.otros },
          inv.ivaTotal > 0          && { concepto: `IVA ${inv.iva}%`,       total: inv.ivaTotal },
        ].filter(Boolean),
        totalFactura: inv.totalFactura,
        ...(isGas && {
          gasPricing: {
            precioKwh:              gasPrecioKwh,
            terminoFijoDiario:      inv.terminoFijoDiario || 0,
            diasFacturados:         inv.dias || 0,
            terminoFijoTotal:       inv.terminoFijoTotal  || inv.costeTotalPotencia || 0,
            impuestoHidrocarbTotal: inv.impuestoHidrocarb || inv.impuestoElectrico  || 0,
            alquilerTotal:          inv.alquiler || 0,
            ivaPorcentaje:          inv.iva || 0,
            ivaTotal:               inv.ivaTotal || 0,
          }
        }),
      }

      toInsert.push({
        supply_id:         supplyId,
        file_url:          '',
        file_type:         'pdf',
        period_start:      inv.fechaInicio || null,
        period_end:        inv.fechaFin    || null,
        total_amount:      inv.totalFactura || null,
        extraction_status: 'completed',
        extracted_data:    { economics, source: 'excel_import', numFactura: inv.numFactura },
        created_at:        new Date().toISOString(),
      })
    }

    let invoicesCreated = 0
    const invoicesSkipped = existingPairs.size - toUpdate.length

    if (toInsert.length > 0) {
      const { error: invErr } = await supabase.from('invoices').insert(toInsert)
      if (!invErr) {
        invoicesCreated = toInsert.length
        await supabase.from('supplies')
          .update({ status: 'estudio_en_curso', updated_at: new Date().toISOString() })
          .eq('id', supplyId)
          .in('status', ['estudio_en_curso', 'facturas_recibidas', 'primer_contacto'])
      } else {
        console.warn(`[import-from-excel] Invoice insert error for ${parsed.cups}:`, invErr.message)
      }
    }

    // ── forceUpdate: actualizar facturas existentes con datos re-parseados ────
    if (forceUpdate && toUpdate.length > 0) {
      for (const inv of toUpdate) {
        const consumoFiltered2 = inv.consumo.filter(c => c.kwh > 0 || c.total > 0).map(c => ({
          ...c, total: c.total || c.kwh * c.precioKwh,
        }))
        const gasPrecioKwh2 = consumoFiltered2[0]?.precioKwh
          || (inv.consumoTotalKwh > 0 && inv.costeTotalConsumo > 0
            ? Math.round((inv.costeTotalConsumo / inv.consumoTotalKwh) * 1e6) / 1e6 : 0)
        const economics = {
          fechaInicio:   inv.fechaInicio,
          fechaFin:      inv.fechaFin,
          cups:          parsed.cups,
          tarifa:        parsed.tarifa,
          supply_type:   (isGas ? 'gas' : 'luz') as 'gas' | 'luz',
          comercializadora: parsed.compania || undefined,
          potencia:      inv.potencia.filter(p => p.kw > 0 || p.total > 0),
          consumo:       consumoFiltered2,
          consumoTotalKwh:    inv.consumoTotalKwh,
          costeBrutoConsumo:  inv.costeBrutoConsumo,
          descuentoEnergia:   inv.descuentoEnergia,
          costeNetoConsumo:   inv.costeNetoConsumo,
          costeTotalConsumo:  inv.costeTotalConsumo,
          costeTotalPotencia: inv.costeTotalPotencia,
          costeMedioKwh: inv.consumoTotalKwh > 0 ? inv.costeTotalConsumo / inv.consumoTotalKwh : 0,
          costeMedioKwhNeto: inv.consumoTotalKwh > 0 ? inv.costeNetoConsumo / inv.consumoTotalKwh : 0,
          totalFactura: inv.totalFactura,
          ...(isGas && {
            gasPricing: {
              precioKwh:              gasPrecioKwh2,
              terminoFijoDiario:      inv.terminoFijoDiario || 0,
              diasFacturados:         inv.dias || 0,
              terminoFijoTotal:       inv.terminoFijoTotal  || inv.costeTotalPotencia || 0,
              impuestoHidrocarbTotal: inv.impuestoHidrocarb || inv.impuestoElectrico  || 0,
              alquilerTotal:          inv.alquiler || 0,
              ivaPorcentaje:          inv.iva || 0,
              ivaTotal:               inv.ivaTotal || 0,
            }
          }),
        }
        await supabase.from('invoices')
          .update({ extracted_data: { economics, source: 'excel_import_updated', numFactura: inv.numFactura } })
          .eq('supply_id', supplyId)
          .eq('period_start', inv.fechaInicio)
          .eq('period_end', inv.fechaFin)
      }
      invoicesCreated += toUpdate.length
    }

    // ── Excel document record (visible en pestaña Documentos del suministro) ─
    if (excelFileUrl) {
      const { data: existingExcelDoc } = await supabase
        .from('invoices')
        .select('id')
        .eq('supply_id', supplyId)
        .eq('file_type', 'excel')
        .maybeSingle()
      if (!existingExcelDoc) {
        await supabase.from('invoices').insert({
          supply_id:         supplyId,
          file_url:          excelFileUrl,
          file_type:         'excel',
          period_start:      null,
          period_end:        null,
          total_amount:      null,
          extraction_status: 'completed',
          extracted_data:    { source: 'excel_upload', fileName: parsed.fileName, mode: 'excel_document' },
          created_at:        new Date().toISOString(),
        })
      }
    }

    // ── Prescoring ───────────────────────────────────────────────────────────
    await ensurePendingPrescoring(supabase, supplyId, { userId: userId || 'system', updateNulls: true })

    return {
      fileName,
      cups: parsed.cups,
      tarifa: parsed.tarifa,
      supplyId,
      locationName: parsed.locationName,
      ok: true,
      invoicesCreated,
      invoicesSkipped,
      isNew: !existingSupply,
    }
  } catch (err: any) {
    return { fileName, ok: false, error: err.message }
  }
}

/** Procesa un fichero Excel de suministro único */
async function processFile(
  file: File,
  resolvedClientId: string,
  newClientName: string,
  supabase: any,
  userId?: string,
  targetCups?: string,
  forceUpdate = false,
): Promise<SupplyImportResult> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const parsed = await parseExcelFile(buffer, file.name, targetCups)
    // Upload Excel to storage so it appears in the supply's documents tab
    let excelFileUrl: string | undefined
    try {
      const ts = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `excels/${parsed.cups || 'unknown'}/${ts}_${safeName}`
      const { error: upErr } = await supabase.storage.from('documents').upload(storagePath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      })
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
        excelFileUrl = urlData?.publicUrl
      }
    } catch { /* non-fatal */ }
    return processSupply(parsed, resolvedClientId, newClientName, supabase, userId, forceUpdate, excelFileUrl)
  } catch (err: any) {
    return { fileName: file.name, ok: false, error: err.message }
  }
}

/** Procesa un fichero Excel multi-suministro (una hoja = un supply) */
async function processMultiSheetFile(
  file: File,
  resolvedClientId: string,
  newClientName: string,
  supabase: any,
  userId?: string,
  forceUpdate = false,
): Promise<SupplyImportResult[]> {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const allParsed = await parseMultiSheetAsSupplies(buffer)

  // Upload the Excel ONCE — all supplies in this file share the same document URL
  let excelFileUrl: string | undefined
  try {
    const ts = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `excels/multi/${ts}_${safeName}`
    const { error: upErr } = await supabase.storage.from('documents').upload(storagePath, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    })
    if (!upErr) {
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
      excelFileUrl = urlData?.publicUrl
    }
  } catch { /* non-fatal */ }

  const results: SupplyImportResult[] = []
  // Process in batches of 5 to avoid overwhelming Supabase
  const BATCH = 5
  for (let i = 0; i < allParsed.length; i += BATCH) {
    const batch = allParsed.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map(p => processSupply(p, resolvedClientId, newClientName, supabase, userId, forceUpdate, excelFileUrl))
    )
    for (const r of settled) {
      results.push(
        r.status === 'fulfilled'
          ? r.value
          : { fileName: 'unknown', ok: false, error: (r.reason as any)?.message || 'Error desconocido' }
      )
    }
  }
  return results
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Auth check — browser session OR service-role key for admin/CLI imports
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    const xServiceKey = req.headers.get('x-service-key') || ''
    const isServiceKeyAuth = serviceKey && xServiceKey && xServiceKey === serviceKey

    let user: { id: string } | null = null
    if (!isServiceKeyAuth) {
      const authClient = createServerSupabaseClient()
      const { data: { user: authUser } } = await authClient.auth.getUser()
      if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      user = authUser
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const formData = await req.formData()
    const clientId      = formData.get('clientId')      as string | null
    const newClientName = (formData.get('newClientName') as string | null)?.trim() || ''
    const targetCups    = (formData.get('targetCups')   as string | null)?.trim().toUpperCase() || ''
    const forceMulti    = formData.get('multiSupply') === 'true'
    const forceUpdate   = formData.get('forceUpdate')  === 'true'
    const files = formData.getAll('files') as File[]

    if (!files.length) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 })
    }

    // ── Resolve client ONCE for all files ───────────────────────────────────
    let resolvedClientId: string | null = clientId || null

    if (!resolvedClientId && newClientName) {
      const { data: existing } = await supabase
        .from('clients').select('id').ilike('name', newClientName).limit(1).single()

      if (existing) {
        resolvedClientId = existing.id
      } else {
        const autoType = /ayuntamiento/i.test(newClientName) ? 'ayuntamiento'
          : /comunidad\s+de\s+vecinos|copropiedad|junta\s+de\s+propietarios/i.test(newClientName) ? 'comunidad'
          : 'empresa'

        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert({
            name: newClientName,
            type: autoType,
            commercial_id: user?.id || null,
            origin: 'auditoria',
            marketing_consent: false,
          })
          .select('id')
          .single()

        if (clientErr) {
          return NextResponse.json({ error: `Error creando cliente: ${clientErr.message}` }, { status: 500 })
        }
        if (newClient) resolvedClientId = newClient.id
      }
    }

    // cupsOnly=true: skip client requirement — only update supplies that already
    // exist in the DB by CUPS. Useful for bulk re-imports of existing data.
    const cupsOnly = formData.get('cupsOnly') === 'true'

    if (!resolvedClientId && !cupsOnly) {
      return NextResponse.json({ error: 'No se pudo determinar el cliente. Especifica un nombre.' }, { status: 400 })
    }

    const finalClientId = resolvedClientId || '__cups_only__'
    const results: any[] = []

    for (const file of files) {
      // Auto-detect multi-supply mode: peek at the workbook
      let isMulti = forceMulti
      if (!isMulti) {
        try {
          const ab = await file.arrayBuffer()
          const wb = new ExcelJS.Workbook()
          await wb.xlsx.load(Buffer.from(ab) as any)
          isMulti = isMultiSupplyWorkbook(wb)
        } catch {
          isMulti = false
        }
      }

      if (isMulti) {
        const multiResults = await processMultiSheetFile(file, finalClientId, newClientName, supabase, user?.id, forceUpdate)
        results.push(...multiResults)
      } else {
        // Standard single-supply per file, in batches of 5
        const BATCH_SIZE = 5
        const singleFiles = [file]
        for (let i = 0; i < singleFiles.length; i += BATCH_SIZE) {
          const batch = singleFiles.slice(i, i + BATCH_SIZE)
          const settled = await Promise.allSettled(
            batch.map(f => processFile(f, finalClientId, newClientName, supabase, user?.id, targetCups, forceUpdate))
          )
          for (const r of settled) {
            results.push(
              r.status === 'fulfilled'
                ? r.value
                : { fileName: 'unknown', ok: false, error: (r.reason as any)?.message || 'Error desconocido' }
            )
          }
        }
      }
    }

    return NextResponse.json({ results })

  } catch (err: any) {
    console.error('[import-from-excel]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
