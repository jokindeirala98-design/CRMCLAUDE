/**
 * POST /api/supplies/import-from-excel
 *
 * Importa suministros e invoices desde Excel de facturas.
 * Soporta dos formatos automáticamente:
 *
 * FORMATO A — Label-based (Excel real de facturas, ej. Iberdrola):
 *   Col A: etiqueta ("CUPS", "Tarifa", "Potencia P1 (kW)", ...)
 *   Col B+: datos (una columna por mes)
 *
 * FORMATO B — Fixed-position (plantilla VOLTIS interna):
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
 *
 * Response: { results: ImportResult[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { fetchSipsForCups } from '@/lib/sips'
import { normalizeTariff as normalizeTariffLib } from '@/lib/consumption-utils'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'

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

// ── Label-based parser (Formato A) ────────────────────────────────────────────

function normLabel(str: string): string {
  if (!str) return ''
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[€]/g, 'eur')
    .replace(/[()]/g, ' ')
    .replace(/[\/\-\*]/g, ' ')
    .replace(/\s+/g, ' ').trim()
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

function detectMonthCols(ws: ExcelJS.Worksheet, rowMap: Map<string, ExcelJS.Row>): number[] {
  const fechaRow = getRow(rowMap, 'Fecha Inicio')
  if (fechaRow) {
    const cols: number[] = []
    fechaRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      if (colNum <= 1) return
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') cols.push(colNum)
    })
    if (cols.length > 0) return cols
  }
  const firstRow = ws.getRow(1)
  const cols: number[] = []
  firstRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    if (colNum <= 1) return
    const str = String(cell.value ?? '').trim().toLowerCase()
    if (Object.keys(MONTHS_MAP).some(m => str.startsWith(m)) || /\d{4}/.test(str)) cols.push(colNum)
  })
  return cols
}

/** Parse Excel in label-based format (real electricity invoices) */
function parseLabelBased(ws: ExcelJS.Worksheet, fileName: string): ParsedSupplyFile {
  const rowMap = buildRowMap(ws)

  const cups = cellStr(getRow(rowMap, 'CUPS'), 2)
  const rawTariff = cellStr(getRow(rowMap, 'Tarifa'), 2)
  const tarifa = normalizeTariff(rawTariff || cellStr(getRow(rowMap, 'Tariff'), 2))
  const comRow = getRow(rowMap, 'Compañia') ?? getRow(rowMap, 'Compania') ?? getRow(rowMap, 'Empresa') ?? getRow(rowMap, 'Comercializadora') ?? getRow(rowMap, 'Suministrador')
  const compania = cellStr(comRow, 2)
  const titular = cellStr(getRow(rowMap, 'Titular'), 2) || cellStr(getRow(rowMap, 'Nombre'), 2) || ''

  const monthCols = detectMonthCols(ws, rowMap)
  const invoices: ParsedInvoice[] = []

  for (const col of monthCols) {
    const rawStart = getRow(rowMap, 'Fecha Inicio')?.getCell(col).value
    const rawEnd   = getRow(rowMap, 'Fecha Fin')?.getCell(col).value
    let periodStart = parseIsoDate(rawStart)
    let periodEnd   = parseIsoDate(rawEnd)
    if (periodStart && !periodEnd) periodEnd = lastDayOfMonth(periodStart)
    if (!periodStart) continue

    const dias = daysBetween(periodStart, periodEnd!)

    const potencia = []
    for (let p = 1; p <= 6; p++) {
      const pid = `P${p}`
      const kw         = cellNum(getRow(rowMap, `Potencia ${pid} kw`), col) || cellNum(getRow(rowMap, `Potencia ${pid} (kW)`), col)
      const precioKwDia= cellNum(getRow(rowMap, `Potencia ${pid} eur kw dia`), col) || cellNum(getRow(rowMap, `Potencia ${pid} (€/kW día)`), col)
      const total      = cellNum(getRow(rowMap, `Potencia ${pid} eur`), col) || cellNum(getRow(rowMap, `Potencia ${pid} (€)`), col)
      if (kw > 0 || total > 0) potencia.push({ periodo: pid, kw, precioKwDia, dias, total })
    }

    const consumo = []
    for (let p = 1; p <= 6; p++) {
      const pid   = `P${p}`
      const kwh   = cellNum(getRow(rowMap, `Consumo ${pid} kwh`), col) || cellNum(getRow(rowMap, `Consumo ${pid} (kWh)`), col)
      const precio= cellNum(getRow(rowMap, `Precio ${pid} eur kwh`), col) || cellNum(getRow(rowMap, `Precio ${pid} (€/kWh)`), col)
      const total = kwh > 0 && precio > 0 ? Math.round(kwh * precio * 100) / 100 : 0
      if (kwh > 0) consumo.push({ periodo: pid, kwh, precioKwh: precio, total })
    }

    const consumoTotalKwh    = cellNum(getRow(rowMap, 'TOTAL CONSUMO (kWh)'), col) || cellNum(getRow(rowMap, 'total consumo kwh'), col) || consumo.reduce((a, c) => a + c.kwh, 0)
    const costeTotalConsumo  = cellNum(getRow(rowMap, 'TOTAL COSTE CONSUMO (€)'), col) || cellNum(getRow(rowMap, 'total coste consumo eur'), col) || consumo.reduce((a, c) => a + c.total, 0)
    const costeTotalPotencia = cellNum(getRow(rowMap, 'TOTAL COSTE POTENCIA (€)'), col) || cellNum(getRow(rowMap, 'total coste potencia eur'), col) || potencia.reduce((a, p) => a + p.total, 0)
    const totalFactura       = cellNum(getRow(rowMap, 'TOTAL FACTURA (€)'), col) || cellNum(getRow(rowMap, 'total factura eur'), col)

    if (consumoTotalKwh === 0 && totalFactura === 0 && costeTotalConsumo === 0) continue

    // Generate a pseudo-numFactura from the period
    const numFactura = `${periodStart.slice(0,7)}`

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
      iva: 0, peajes: 0, impuestoElectrico: 0, alquiler: 0, otros: 0, ivaTotal: 0,
      totalFactura,
    })
  }

  return { fileName, cups, titular, compania, tarifa, invoices }
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
}

interface ParsedSupplyFile {
  fileName: string
  cups: string
  titular: string
  compania: string
  tarifa: string
  invoices: ParsedInvoice[]
}

/** Parsea un Excel de facturas — detecta automáticamente el formato (label-based o fixed-position) */
async function parseExcelFile(buffer: Buffer, fileName: string): Promise<ParsedSupplyFile> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  const ws = wb.getWorksheet('Facturas') || wb.worksheets[0]
  if (!ws) throw new Error(`${fileName}: no se encontró ninguna hoja de cálculo`)

  // ── Auto-detect format ─────────────────────────────────────────────────────
  // If cell A1 or any of rows 1-10 col A has the label "CUPS", use label-based parser.
  // Otherwise fall back to fixed-position (VOLTIS internal template).
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
    return parseLabelBased(ws, fileName)
  }

  // ── Fixed-position parser (VOLTIS template) ───────────────────────────────
  const gc = (row: number, col: number): any => ws.getCell(row, col).value

  const cups    = s(gc(3, 2))
  const titular = s(gc(4, 2))
  const compania = s(gc(5, 2))
  const tarifa  = normalizeTariff(s(gc(6, 2)))

  if (!cups) throw new Error(`${fileName}: no se encontró CUPS en la celda B3`)

  // Find number of data columns
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

/** Agrega consumo anual por periodo sumando todos los datos del Excel.
 *  NOTA: potenciaContratada NO se extrae del Excel — siempre se obtiene de SIPS.
 *  Los datos de consumo de las hojas Excel pueden no coincidir con los valores oficiales del distribuidor.
 */
function buildAnnualConsumptionData(parsed: ParsedSupplyFile) {
  const consumoPeriodos: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  // potenciaContratada is intentionally omitted here — it will be set from SIPS only

  for (const inv of parsed.invoices) {
    for (const c of inv.consumo) {
      consumoPeriodos[c.periodo] = (consumoPeriodos[c.periodo] || 0) + c.kwh
    }
    // inv.potencia is stored in invoice extracted_data for billing reference,
    // but is NOT aggregated into consumption_data.potenciaContratada
  }

  const totalKwh = Object.values(consumoPeriodos).reduce((a, b) => a + b, 0)
  return { consumoPeriodos, totalKwh }
}

/** Procesa un fichero Excel: crea/actualiza suministro, inserta facturas y garantiza fila de prescoring */
async function processFile(
  file: File,
  resolvedClientId: string,
  newClientName: string,
  supabase: any,
  userId?: string
): Promise<{ fileName: string; cups?: string; ok: boolean; invoicesCreated?: number; invoicesSkipped?: number; isNew?: boolean; tarifa?: string; supplyId?: string; error?: string }> {
  const fileName = file.name
  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const parsed = await parseExcelFile(buffer, fileName)
    const annualData = buildAnnualConsumptionData(parsed)

    // ── Find or create supply ────────────────────────────────────────────────
    const { data: existingSupply } = await supabase
      .from('supplies')
      .select('id, consumption_data')
      .eq('cups', parsed.cups)
      .limit(1)
      .single()

    let supplyId: string

    if (existingSupply) {
      supplyId = existingSupply.id
      await supabase
        .from('supplies')
        .update({
          consumption_data: annualData,
          tariff: parsed.tarifa,
          updated_at: new Date().toISOString(),
        })
        .eq('id', supplyId)
    } else {
      const { data: newSupply, error: supplyErr } = await supabase
        .from('supplies')
        .insert({
          cups: parsed.cups,
          client_id: resolvedClientId,
          tariff: parsed.tarifa,
          type: 'luz',
          status: 'estudio_en_curso',
          consumption_data: annualData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (supplyErr || !newSupply) {
        // Race condition: another parallel file already inserted this CUPS
        const isUniqueConflict = supplyErr?.code === '23505'
          || supplyErr?.message?.includes('unique')
          || supplyErr?.message?.includes('duplicate')
        if (isUniqueConflict) {
          const { data: raced } = await supabase
            .from('supplies')
            .select('id, consumption_data')
            .eq('cups', parsed.cups)
            .limit(1)
            .single()
          if (raced) {
            // Merge our consumption data into the winner supply and continue
            await supabase.from('supplies').update({
              consumption_data: annualData,
              tariff: parsed.tarifa,
              updated_at: new Date().toISOString(),
            }).eq('id', raced.id)
            supplyId = raced.id
            // Mark as "existing" so SIPS isn't re-triggered
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

    // ── SIPS fetch + power study (fire and forget, only for new supplies) ────
    if (!existingSupply) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
      void fetchSipsForCups(parsed.cups, 'luz').then(async (sipsData) => {
        if (!sipsData) return
        const sipsNormalizedTariff = sipsData.tariff ? (normalizeTariffLib(sipsData.tariff) || sipsData.tariff) : null
        const merged = {
          ...annualData,
          // ⚠️ Override potenciaContratada with official SIPS value (takes priority over Excel)
          // Excel values can be wrong (e.g. 1.3 kW when real contracted power is 13 kW)
          ...(sipsData.potenciaContratada ? { potenciaContratada: sipsData.potenciaContratada } : {}),
          // Also override consumoPeriodos if SIPS has them (more accurate than Excel aggregation)
          ...(sipsData.consumoPeriodos ? { consumoPeriodos: sipsData.consumoPeriodos } : {}),
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
              clientName: newClientName || 'Excel Import',
              potenciaContratada: sipsData.potenciaContratada,
              consumptionHistory: sipsData.consumptionHistory,
              maximetroHistory: sipsData.maximetroHistory || [],
            }),
          })
          if (r.ok) {
            const studyResult = await r.json()
            await supabase.from('supplies')
              .update({ power_study_result: studyResult, updated_at: new Date().toISOString() })
              .eq('id', supplyId)
          }
        }
      }).catch((err: any) => console.warn('[import-from-excel] SIPS error (non-fatal):', err?.message))
    }

    // ── Find comercializadora (best-effort) ──────────────────────────────────
    if (parsed.compania) {
      supabase
        .from('comercializadoras')
        .select('id')
        .ilike('name', `%${parsed.compania}%`)
        .limit(1)
        .single()
        .then(({ data: comerc }: { data: any }) => {
          if (comerc) {
            supabase.from('supplies').update({ comercializadora_id: comerc.id }).eq('id', supplyId)
          }
        })
        .catch(() => {})
    }

    // ── Batch insert invoices ────────────────────────────────────────────────
    // Fetch existing period pairs to deduplicate
    const { data: existingInvoices } = await supabase
      .from('invoices')
      .select('period_start, period_end')
      .eq('supply_id', supplyId)

    const existingPairs = new Set(
      (existingInvoices || []).map((i: any) => `${i.period_start}|${i.period_end}`)
    )

    const toInsert = []
    for (const inv of parsed.invoices) {
      const pairKey = `${inv.fechaInicio}|${inv.fechaFin}`
      if (existingPairs.has(pairKey)) continue

      const economics = {
        fechaInicio:   inv.fechaInicio,
        fechaFin:      inv.fechaFin,
        cups:          parsed.cups,
        tarifa:        parsed.tarifa,
        supply_type:   'luz' as const,
        comercializadora: parsed.compania || undefined,
        potencia:      inv.potencia.filter(p => p.kw > 0 || p.total > 0),
        consumo:       inv.consumo.filter(c => c.kwh > 0 || c.total > 0).map(c => ({
          ...c,
          total: c.total || c.kwh * c.precioKwh,
        })),
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
    const invoicesSkipped = existingPairs.size

    if (toInsert.length > 0) {
      const { error: invErr } = await supabase.from('invoices').insert(toInsert)
      if (!invErr) {
        invoicesCreated = toInsert.length
        // Advance status: supplies with invoices → "Esperando informes"
        await supabase
          .from('supplies')
          .update({ status: 'estudio_en_curso', updated_at: new Date().toISOString() })
          .eq('id', supplyId)
          .in('status', ['estudio_en_curso', 'facturas_recibidas', 'primer_contacto'])
      } else {
        console.warn(`[import-from-excel] Invoice insert error for ${parsed.cups}:`, invErr.message)
      }
    }

    // ── Prescoring ───────────────────────────────────────────────────────────
    // Guarantee a prescoring row exists (idempotent — skips if already present,
    // patches null fields if updateNulls=true). Always runs, even if 0 invoices.
    await ensurePendingPrescoring(supabase, supplyId, {
      userId: userId || 'system',
      updateNulls: true,   // enrich existing row with invoice / SIPS data
    })

    return {
      fileName,
      cups: parsed.cups,
      tarifa: parsed.tarifa,
      supplyId,
      ok: true,
      invoicesCreated,
      invoicesSkipped,
      isNew: !existingSupply,
    }
  } catch (fileErr: any) {
    return { fileName, ok: false, error: fileErr.message }
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '').trim()
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Parse multipart form
    const formData = await req.formData()
    const clientId      = formData.get('clientId')      as string | null
    const newClientName = (formData.get('newClientName') as string | null)?.trim() || ''
    const files = formData.getAll('files') as File[]

    if (!files.length) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 })
    }

    // ── Resolve client ONCE for all files ───────────────────────────────────
    let resolvedClientId: string | null = clientId || null

    if (!resolvedClientId && newClientName) {
      // Try to find existing client by name
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .ilike('name', newClientName)
        .limit(1)
        .single()

      if (existing) {
        resolvedClientId = existing.id
      } else {
        // Auto-detect client type from name
        const autoType = /ayuntamiento/i.test(newClientName) ? 'ayuntamiento'
          : /comunidad\s+de\s+vecinos|copropiedad|junta\s+de\s+propietarios/i.test(newClientName) ? 'comunidad'
          : 'empresa'

        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert({
            name: newClientName,
            type: autoType,
            commercial_id: user.id,
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

    if (!resolvedClientId) {
      return NextResponse.json({ error: 'No se pudo determinar el cliente. Especifica un nombre.' }, { status: 400 })
    }

    const finalClientId = resolvedClientId

    // ── Process files in batches of 5 to avoid saturating Supabase connections
    const BATCH_SIZE = 5
    const results: any[] = []

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)
      const settled = await Promise.allSettled(
        batch.map(file => processFile(file, finalClientId, newClientName, supabase, user.id))
      )
      for (const r of settled) {
        results.push(
          r.status === 'fulfilled'
            ? r.value
            : { fileName: 'unknown', ok: false, error: (r.reason as any)?.message || 'Error desconocido' }
        )
      }
    }

    return NextResponse.json({ results })

  } catch (err: any) {
    console.error('[import-from-excel]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
