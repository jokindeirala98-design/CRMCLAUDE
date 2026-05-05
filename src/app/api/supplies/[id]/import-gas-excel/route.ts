/**
 * POST /api/supplies/[id]/import-gas-excel
 *
 * Importa datos de consumo de gas desde archivos de distribuidora/comercializadora.
 * Soporta:
 *   - ZIP con XLS/HTML dentro (formato comercializadora — múltiples CUPS)
 *   - XLSX reales
 *   - XLS HTML disfrazados (Naturgy _39, _40, Endesa Gas, etc.)
 *
 * Dos tipos de datos que detecta automáticamente:
 *   A) Maestro de suministros (_39): una fila por CUPS con datos estáticos + ConsumoAnual
 *   B) Histórico de consumo (_40 / ZIP): CodigoCUPS agrupado + filas de períodos con ConsumoEnWh
 *
 * Multipart form-data:
 *   file[]     — uno o más archivos .xlsx / .xls / .zip
 *   targetCups — (opcional) CUPS del suministro
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import * as htmlparser2 from 'htmlparser2'
import { DomHandler } from 'domhandler'
import { findAll, textContent } from 'domutils'
import { unzipSync } from 'fflate'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeKey(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-\s]+/g, '')
    .trim()
}

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function toStr(v: any): string {
  return v == null ? '' : String(v).trim()
}

function wh2kwh(wh: number): number {
  // If value looks like Wh (very large), convert; otherwise treat as kWh already
  return wh > 500_000 ? Math.round(wh / 1000) : wh
}

// ── HTML table parser ─────────────────────────────────────────────────────────

function isHtmlBuffer(buf: Buffer | Uint8Array): boolean {
  const nodeBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const head = nodeBuf.slice(0, 512).toString('utf-8').trimStart().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') ||
         head.startsWith('<table') || head.includes('<html')
}

function parseHtmlToGrid(html: string): string[][] {
  let rows: string[][] = []
  const handler = new DomHandler((err, dom) => {
    if (err) return
    const trs = findAll(el => el.type === 'tag' && el.name === 'tr', dom)
    for (const tr of trs) {
      const cells = findAll(
        el => el.type === 'tag' && (el.name === 'td' || el.name === 'th'),
        [tr]
      )
      rows.push(cells.map(c => textContent(c).trim()))
    }
  })
  const parser = new htmlparser2.Parser(handler, { decodeEntities: true })
  parser.write(html)
  parser.end()
  return rows
}

// ── Result types ──────────────────────────────────────────────────────────────

interface PeriodEntry {
  fechaInicio: string
  fechaFin: string
  kwh: number
}

interface GasParsedResult {
  cups: string
  nombre: string
  address: string
  tariff: string
  distribuidora: string
  totalKwh: number          // annual kWh (last 12 months or ConsumoAnual field)
  provincia: string
  municipio: string
  codigo_postal: string
  caudal: number
  presion: string
  cnae: string
  fecha_lectura: string
  gasHistory: PeriodEntry[] // chronological periods
  sourceFormat: 'maestro' | 'historial'  // which parser produced this result
}

// ── Format A: Maestro de suministros (_39 style) ──────────────────────────────
// One row per CUPS with static fields + ConsumoAnual

const MAESTRO_ALIASES: Record<string, string[]> = {
  cups:          ['cups', 'codigocups', 'idsuministro', 'cup', 'cupscau', 'codigodecups', 'codcups'],
  address:       ['direccion', 'direcciondelsuministro', 'viasuministro', 'emplazamiento',
                  'domicilio', 'calle', 'tipoviasuministro'],
  tariff:        ['tarifa', 'peaje', 'tarifadeacceso', 'nivelderesion', 'nivelpresion',
                  'tarifaacceso', 'tarifapeaje', 'codpeaje'],
  distribuidora: ['distribuidora', 'empresadistribuidora', 'compania', 'distribuidor'],
  consumo_total: ['consumo', 'consumoanual', 'consumototal', 'kwhanual', 'kwhano', 'totalenergia',
                  'energiaanual', 'consumokwh', 'kwh', 'consum'],
  consumo_wh:    ['consumoenwh', 'consumowh', 'kwhen wh'],
  consumo_p1:    ['consumop1', 'p1kwh', 'punta', 'periodo1'],
  consumo_p2:    ['consumop2', 'p2kwh', 'llano', 'periodo2'],
  consumo_p3:    ['consumop3', 'p3kwh', 'valle', 'periodo3'],
  consumo_p4:    ['consumop4', 'p4kwh', 'periodo4'],
  consumo_p5:    ['consumop5', 'p5kwh', 'periodo5'],
  consumo_p6:    ['consumop6', 'p6kwh', 'periodo6'],
  provincia:     ['provincia', 'provinciasuministro'],
  municipio:     ['municipio', 'poblacion', 'localidad', 'ciudad', 'localidadsuministro'],
  codigo_postal: ['cp', 'codigopostal', 'cpostal', 'codpostalsuministro', 'codpostal'],
  fecha_lectura: ['fechalectura', 'ultimalectura', 'fechaultimalectura', 'fechafinconsumo'],
  caudal:        ['caudal', 'caudalm3h', 'caudalmaximo', 'caudalmax'],
  presion:       ['presion', 'nivelpresion'],
  cnae:          ['cnae', 'codigocnae'],
  nombre:        ['nombre', 'nombresuministro', 'razonsocial', 'titular', 'nombretitular',
                  'nombrecompleto', 'nombrecompleto titular'],
}

function buildColMap(headers: string[], aliases: Record<string, string[]>): Record<string, number> {
  const map: Record<string, number> = {}
  const usedCols = new Set<number>()
  headers.forEach((h, idx) => {
    const norm = normalizeKey(h)
    if (!norm) return
    for (const [field, keys] of Object.entries(aliases)) {
      if (map[field] !== undefined) continue      // field already claimed
      if (usedCols.has(idx)) continue             // column already claimed by another field
      if (keys.some(k => norm === k || norm.includes(k) || k.includes(norm))) {
        map[field] = idx
        usedCols.add(idx)
        break  // one column → one field only
      }
    }
  })
  return map
}

function parseMaestroGrid(grid: string[][], headerIdx: number): GasParsedResult[] {
  const headers = grid[headerIdx]
  const colMap = buildColMap(headers, MAESTRO_ALIASES)
  const results: GasParsedResult[] = []

  for (let ri = headerIdx + 1; ri < grid.length; ri++) {
    const row = grid[ri]
    if (!row || row.every(c => !c)) continue

    const get = (f: string): string => colMap[f] !== undefined ? toStr(row[colMap[f]]) : ''
    const getN = (f: string): number => toNum(get(f))

    const cups_raw = get('cups')
    if (!cups_raw) continue

    const p1 = getN('consumo_p1'); const p2 = getN('consumo_p2'); const p3 = getN('consumo_p3')
    const p4 = getN('consumo_p4'); const p5 = getN('consumo_p5'); const p6 = getN('consumo_p6')
    const periodSum = p1 + p2 + p3 + p4 + p5 + p6

    let totalKwh = getN('consumo_total')
    if (totalKwh === 0) {
      const wh = getN('consumo_wh')
      if (wh > 0) totalKwh = wh2kwh(wh)
    }
    if (totalKwh > 500_000) totalKwh = Math.round(totalKwh / 1000)
    if (totalKwh === 0 && periodSum > 0) totalKwh = periodSum

    results.push({
      cups: cups_raw,
      nombre: get('nombre'),
      address: get('address'),
      tariff: get('tariff'),
      distribuidora: get('distribuidora'),
      totalKwh,
      provincia: get('provincia'),
      municipio: get('municipio'),
      codigo_postal: get('codigo_postal'),
      caudal: getN('caudal'),
      presion: get('presion'),
      cnae: get('cnae'),
      fecha_lectura: get('fecha_lectura'),
      gasHistory: [],
      sourceFormat: 'maestro' as const,
    })
  }
  return results
}

// ── Format B: Historial de consumo (_40 / ZIP comercializadora style) ─────────
// CodigoCUPS on its own row, then blank-cups rows with period consumption

const HIST_ALIASES: Record<string, string[]> = {
  cups:         ['codigocups', 'cups', 'codcups', 'cupsgas'],
  fecha_inicio: ['fechainiociomesconsumo', 'fechainico', 'fechainiciomesconsumo', 'fecinicioconsumo',
                 'fechaini', 'fecini', 'inicio'],
  fecha_fin:    ['fechafinmesconsumo', 'fechafin', 'fechafinconsumo', 'fecfinconsumo',
                 'fin', 'fechafin'],
  consumo_wh:   ['consumoenwh', 'consumowh', 'consumoenkwh', 'kwh'],
  caudal_max:   ['caudalmaximodiario', 'caudalmax', 'caudalmaximo'],
  caudal_med:   ['caudalmedioenwhdia', 'caudalmedio'],
}

interface HistRow {
  cups: string
  fechaInicio: string
  fechaFin: string
  kwh: number
}

function isHistFormat(headers: string[]): boolean {
  const norm = headers.map(normalizeKey)
  // Detect if it has date columns + consumoenwh (no address/tariff)
  const hasConsumoWh = norm.some(h => h.includes('consumoenwh') || (h.includes('consumo') && h.includes('wh')))
  const hasDates = norm.some(h => h.includes('fechaini') || h.includes('inicio'))
  return hasConsumoWh || hasDates
}

function parseHistGrid(grid: string[][], headerIdx: number): GasParsedResult[] {
  const headers = grid[headerIdx]
  const colMap = buildColMap(headers, HIST_ALIASES)

  // Collect raw history rows, propagating CUPS down
  const rawRows: HistRow[] = []
  let currentCups = ''

  for (let ri = headerIdx + 1; ri < grid.length; ri++) {
    const row = grid[ri]
    if (!row || row.every(c => !c)) continue

    const cupsCell = colMap['cups'] !== undefined ? toStr(row[colMap['cups']]) : ''
    if (cupsCell) currentCups = cupsCell.toUpperCase()

    const fechaInicio = colMap['fecha_inicio'] !== undefined ? toStr(row[colMap['fecha_inicio']]) : ''
    const fechaFin    = colMap['fecha_fin']    !== undefined ? toStr(row[colMap['fecha_fin']])    : ''
    const consumoWh   = colMap['consumo_wh']   !== undefined ? toNum(row[colMap['consumo_wh']])   : 0

    if (!fechaInicio && !fechaFin) continue
    if (!currentCups) continue

    rawRows.push({
      cups: currentCups,
      fechaInicio: fechaInicio.replace('T00:00:00', '').replace('T00:00', ''),
      fechaFin:    fechaFin.replace('T00:00:00', '').replace('T00:00', ''),
      // wh2kwh: divides by 1000 only if value > 500.000 (clearly Wh).
      // If ≤ 500.000 assumes already in kWh (Naturgy _40 stores kWh, not Wh).
      kwh: Math.round(wh2kwh(consumoWh)),
    })
  }

  // Group by CUPS
  const byCups: Record<string, HistRow[]> = {}
  for (const r of rawRows) {
    if (!byCups[r.cups]) byCups[r.cups] = []
    byCups[r.cups].push(r)
  }

  // For each CUPS: calculate annual kWh from last 12 months
  const results: GasParsedResult[] = []
  for (const [cups, periods] of Object.entries(byCups)) {
    const sorted = [...periods].sort((a, b) =>
      new Date(a.fechaInicio).getTime() - new Date(b.fechaInicio).getTime()
    )

    // Last date in file
    const lastDate = new Date(sorted[sorted.length - 1].fechaFin || sorted[sorted.length - 1].fechaInicio)
    const cutoff = new Date(lastDate)
    cutoff.setFullYear(cutoff.getFullYear() - 1)

    // Sum periods that overlap with the last 12 months
    let annualKwh = 0
    for (const p of sorted) {
      const pEnd = new Date(p.fechaFin || p.fechaInicio)
      const pStart = new Date(p.fechaInicio)
      if (pEnd >= cutoff) {
        // Partial overlap: prorate if period starts before cutoff
        if (pStart < cutoff && p.kwh > 0) {
          const totalDays = (pEnd.getTime() - pStart.getTime()) / 86400000 + 1
          const overlapDays = (pEnd.getTime() - cutoff.getTime()) / 86400000 + 1
          annualKwh += Math.round(p.kwh * (overlapDays / totalDays))
        } else {
          annualKwh += p.kwh
        }
      }
    }

    const lastPeriod = sorted[sorted.length - 1]
    results.push({
      cups,
      nombre: '',
      address: '',
      tariff: '',
      distribuidora: '',
      totalKwh: annualKwh,
      provincia: '',
      municipio: '',
      codigo_postal: '',
      caudal: 0,
      presion: '',
      cnae: '',
      fecha_lectura: lastPeriod?.fechaFin || '',
      gasHistory: sorted.map(p => ({
        fechaInicio: p.fechaInicio,
        fechaFin: p.fechaFin,
        kwh: p.kwh,
      })),
      sourceFormat: 'historial' as const,
    })
  }
  return results
}

// ── Auto-detect format and parse grid ────────────────────────────────────────

function findHeaderRow(grid: string[][]): { idx: number; headers: string[] } | null {
  // Look for a row with ≥2 recognizable column names
  const allKeys = [
    ...Object.values(MAESTRO_ALIASES).flat(),
    ...Object.values(HIST_ALIASES).flat(),
  ]
  for (let ri = 0; ri < Math.min(25, grid.length); ri++) {
    const row = grid[ri]
    if (!row) continue
    const matches = row.filter(cell => {
      const norm = normalizeKey(cell)
      return norm && allKeys.some(k => norm === k || norm.includes(k) || k.includes(norm))
    })
    if (matches.length >= 2) return { idx: ri, headers: row }
  }
  return null
}

function parseGrid(grid: string[][]): GasParsedResult[] {
  const found = findHeaderRow(grid)
  if (!found) return []

  const { idx, headers } = found

  if (isHistFormat(headers)) {
    return parseHistGrid(grid, idx)
  } else {
    return parseMaestroGrid(grid, idx)
  }
}

// ── Buffer → grid ─────────────────────────────────────────────────────────────

async function bufferToGrid(buf: Uint8Array): Promise<string[][]> {
  const nodeBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (isHtmlBuffer(nodeBuf)) {
    return parseHtmlToGrid(nodeBuf.toString('utf-8'))
  }

  // Try ExcelJS (real XLSX)
  const wb = new ExcelJS.Workbook()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(nodeBuf as any)
  } catch {
    throw new Error(
      'Formato no soportado. Si es un .xls antiguo, ábrelo en Excel y guárdalo como .xlsx'
    )
  }

  const grid: string[][] = []
  const ws = wb.worksheets[0]
  if (!ws) return grid

  for (let ri = 1; ri <= ws.rowCount; ri++) {
    const row = ws.getRow(ri)
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      let v = ''
      const cv = cell.value
      if (cv !== null && cv !== undefined) {
        if (typeof cv === 'object' && 'result' in (cv as any)) v = toStr((cv as any).result)
        else if (typeof cv === 'object' && 'text' in (cv as any)) v = toStr((cv as any).text)
        else v = toStr(cv)
      }
      cells[colNumber - 1] = v
    })
    grid.push(cells)
  }
  return grid
}

// ── Extract files from upload (handles .zip) ──────────────────────────────────

async function extractBuffers(file: File): Promise<Array<{ name: string; buf: Uint8Array }>> {
  const arrayBuf = await file.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuf)
  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'zip') {
    try {
      const unzipped = unzipSync(uint8)
      return Object.entries(unzipped)
        .filter(([name]) => /\.(xlsx|xls)$/i.test(name) && !name.startsWith('__MACOSX'))
        .map(([name, data]) => ({ name, buf: data }))
    } catch (e: any) {
      throw new Error(`No se pudo abrir el ZIP: ${e.message}`)
    }
  }

  return [{ name: file.name, buf: uint8 }]
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // ── Auth: cookie-based session (supports email + Google OAuth) ────────────
    const authClient = createServerSupabaseClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ── Parse multipart form ──────────────────────────────────────────────────
    const formData = await req.formData()
    const targetCups = (formData.get('targetCups') as string | null)?.trim().toUpperCase()

    const fileEntries = formData.getAll('file') as File[]
    const extraFiles  = formData.getAll('files[]') as File[]
    const allFiles    = [...fileEntries, ...extraFiles].filter((f): f is File => f instanceof File)

    if (allFiles.length === 0) {
      return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 })
    }

    // ── Fetch supply ──────────────────────────────────────────────────────────
    const { data: supply, error: supplyErr } = await supabase
      .from('supplies')
      .select('id, cups, tariff, type, client_id, consumption_data')
      .eq('id', params.id)
      .single()

    if (supplyErr || !supply) {
      return NextResponse.json({ error: 'Suministro no encontrado' }, { status: 404 })
    }

    const supplyCupsNorm = (targetCups || supply.cups || '').toUpperCase().replace(/\s/g, '')

    // ── Parse all files ───────────────────────────────────────────────────────
    const allResults: GasParsedResult[] = []
    const fileNames: string[] = []
    const errors: string[] = []

    for (const file of allFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!ext || !['xlsx', 'xls', 'zip'].includes(ext)) continue

      try {
        const buffers = await extractBuffers(file)
        for (const { name, buf } of buffers) {
          const grid = await bufferToGrid(buf)
          const parsed = parseGrid(grid)
          if (parsed.length > 0) {
            allResults.push(...parsed)
            fileNames.push(file.name === name ? name : `${file.name} → ${name}`)
          }
        }
      } catch (e: any) {
        errors.push(`${file.name}: ${e.message}`)
      }
    }

    if (allResults.length === 0) {
      const errDetail = errors.length > 0 ? ` (${errors.join('; ')})` : ''
      return NextResponse.json({
        error: `No se encontraron datos reconocibles en los archivos${errDetail}. ` +
          'Asegúrate de que el archivo tiene columnas CUPS y consumo.'
      }, { status: 422 })
    }

    // ── Merge results for the same CUPS from different files ──────────────────
    // e.g. _39 (Maestro) gives annual totalKwh, _40 (Historial) gives gasHistory
    // → merge: prefer highest totalKwh, union gasHistory, prefer non-empty fields
    const mergedMap = new Map<string, GasParsedResult>()
    for (const r of allResults) {
      const key = r.cups.toUpperCase().replace(/\s/g, '')
      const ex = mergedMap.get(key)
      if (!ex) {
        mergedMap.set(key, { ...r })
      } else {
        const combinedHistory = [...ex.gasHistory, ...r.gasHistory]
          .sort((a, b) => new Date(a.fechaInicio).getTime() - new Date(b.fechaInicio).getTime())
          .filter((p, i, arr) =>
            arr.findIndex(x => x.fechaInicio === p.fechaInicio && x.fechaFin === p.fechaFin) === i
          )
        // Prefer Maestro's ConsumoAnual (explicit, authoritative) over Historial's
        // calculated annual (which can be wrong if dates/units are off).
        // If one is Maestro and the other Historial, use Maestro's totalKwh.
        // If both are the same format, fall back to the higher value.
        const maestro = ex.sourceFormat === 'maestro' ? ex : r.sourceFormat === 'maestro' ? r : null
        const historial = ex.sourceFormat === 'historial' ? ex : r.sourceFormat === 'historial' ? r : null
        const bestTotalKwh = maestro && maestro.totalKwh > 0
          ? maestro.totalKwh
          : Math.max(ex.totalKwh, r.totalKwh)

        mergedMap.set(key, {
          cups:          ex.cups,
          nombre:        ex.nombre        || r.nombre,
          address:       ex.address       || r.address,
          tariff:        ex.tariff        || r.tariff,
          distribuidora: ex.distribuidora || r.distribuidora,
          totalKwh:      bestTotalKwh,
          provincia:     ex.provincia     || r.provincia,
          municipio:     ex.municipio     || r.municipio,
          codigo_postal: ex.codigo_postal || r.codigo_postal,
          caudal:        ex.caudal        || r.caudal,
          presion:       ex.presion       || r.presion,
          cnae:          ex.cnae          || r.cnae,
          fecha_lectura: ex.fecha_lectura || r.fecha_lectura,
          gasHistory:    combinedHistory,
          sourceFormat:  maestro ? 'maestro' : historial ? 'historial' : ex.sourceFormat,
        })
      }
    }
    const mergedResults = Array.from(mergedMap.values())

    // ── Match best result for this supply ─────────────────────────────────────
    const matchedResult = mergedResults.find(
      r => r.cups.toUpperCase().replace(/\s/g, '') === supplyCupsNorm
    )
    const best = matchedResult ?? mergedResults[0]
    const matchedByCups = !!matchedResult

    // ── Build consumption_data ────────────────────────────────────────────────
    const prev = (supply.consumption_data as any) ?? {}

    const newConsumptionData = {
      ...prev,
      source: 'excel_import' as const,
      fetched_at: new Date().toISOString(),
      import_filename: fileNames.join(', '),
      import_rows_total: allResults.length,
      // SIPS-compatible
      sips_tariff:          best.tariff        || prev.sips_tariff,
      distribuidora:        best.distribuidora  || prev.distribuidora,
      municipio:            best.municipio      || prev.municipio,
      provincia:            best.provincia      || prev.provincia,
      codigoPostal:         best.codigo_postal  || prev.codigoPostal,
      cnae:                 best.cnae           || prev.cnae,
      fechaUltimaLectura:   best.fecha_lectura  || prev.fechaUltimaLectura,
      caudal:               best.caudal         || prev.caudal,
      presion:              best.presion        || prev.presion,
      // Gas consumption — no P1 labeling
      consumoPeriodos:      undefined,
      totalKwh:             best.totalKwh,
      total:                best.totalKwh,
      // Period history for charts
      gasHistory:           best.gasHistory.length > 0 ? best.gasHistory : prev.gasHistory,
    }

    // ── Save to supply ────────────────────────────────────────────────────────
    await supabase
      .from('supplies')
      .update({
        consumption_data: newConsumptionData,
        ...(best.address ? { address: best.address } : {}),
        ...(best.tariff  ? { tariff: best.tariff }   : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)

    // ── Upsert consumption_snapshot ───────────────────────────────────────────
    const { data: existingSnap } = await supabase
      .from('consumption_snapshots')
      .select('id')
      .eq('supply_id', params.id)
      .maybeSingle()

    const snapshotData = {
      client_id:          supply.client_id,
      supply_id:          params.id,
      name:               best.nombre || null,
      cups:               best.cups   || supply.cups || '',
      tariff:             best.tariff || supply.tariff || '',
      supply_type:        'gas' as const,
      comercializadora:   null,
      address:            best.address || null,
      potencia_p1: null, potencia_p2: null, potencia_p3: null,
      potencia_p4: null, potencia_p5: null, potencia_p6: null,
      consumo_p1: null, consumo_p2: null, consumo_p3: null,
      consumo_p4: null, consumo_p5: null, consumo_p6: null,
      consumo_total:      best.totalKwh,
      source:             'excel_import' as const,
      validation_status:  'validated' as const,
      observations:       `Importado desde: ${fileNames.join(', ')}`,
      updated_at:         new Date().toISOString(),
      created_by:         user.id,
    }

    if (existingSnap) {
      await supabase.from('consumption_snapshots').update(snapshotData).eq('id', existingSnap.id)
    } else {
      await supabase.from('consumption_snapshots').insert({ ...snapshotData, created_at: new Date().toISOString() })
    }

    // ── Bulk update other gas supplies of the same client ─────────────────────
    // If the file has data for more CUPS than just this supply, update them all
    const otherResults = mergedResults.filter(r => {
      const norm = r.cups.toUpperCase().replace(/\s/g, '')
      return norm !== supplyCupsNorm && norm.length > 10
    })

    if (otherResults.length > 0 && supply.client_id) {
      // Fetch all gas supplies for this client
      const { data: clientSupplies } = await supabase
        .from('supplies')
        .select('id, cups, tariff, consumption_data')
        .eq('client_id', supply.client_id)
        .eq('type', 'gas')
        .neq('id', params.id)

      if (clientSupplies && clientSupplies.length > 0) {
        for (const clientSupply of clientSupplies) {
          const cupsNorm = (clientSupply.cups || '').toUpperCase().replace(/\s/g, '')
          const match = otherResults.find(r => r.cups.toUpperCase().replace(/\s/g, '') === cupsNorm)
          if (!match) continue

          const prevData = (clientSupply.consumption_data as any) ?? {}
          const bulkData = {
            ...prevData,
            source: 'excel_import' as const,
            fetched_at: new Date().toISOString(),
            import_filename: fileNames.join(', '),
            import_rows_total: allResults.length,
            sips_tariff:        match.tariff       || prevData.sips_tariff,
            distribuidora:      match.distribuidora || prevData.distribuidora,
            municipio:          match.municipio     || prevData.municipio,
            provincia:          match.provincia     || prevData.provincia,
            codigoPostal:       match.codigo_postal || prevData.codigoPostal,
            cnae:               match.cnae          || prevData.cnae,
            fechaUltimaLectura: match.fecha_lectura || prevData.fechaUltimaLectura,
            caudal:             match.caudal        || prevData.caudal,
            consumoPeriodos:    undefined,
            totalKwh:           match.totalKwh,
            total:              match.totalKwh,
            gasHistory:         match.gasHistory.length > 0 ? match.gasHistory : prevData.gasHistory,
          }

          await supabase
            .from('supplies')
            .update({ consumption_data: bulkData, updated_at: new Date().toISOString() })
            .eq('id', clientSupply.id)

          // Upsert snapshot for this supply too
          const { data: snap } = await supabase
            .from('consumption_snapshots')
            .select('id')
            .eq('supply_id', clientSupply.id)
            .maybeSingle()

          const bulkSnapshot = {
            client_id: supply.client_id,
            supply_id: clientSupply.id,
            cups: match.cups || clientSupply.cups || '',
            tariff: match.tariff || clientSupply.tariff || '',
            supply_type: 'gas' as const,
            comercializadora: null,
            address: match.address || null,
            potencia_p1: null, potencia_p2: null, potencia_p3: null,
            potencia_p4: null, potencia_p5: null, potencia_p6: null,
            consumo_p1: null, consumo_p2: null, consumo_p3: null,
            consumo_p4: null, consumo_p5: null, consumo_p6: null,
            consumo_total: match.totalKwh,
            source: 'excel_import' as const,
            validation_status: 'validated' as const,
            observations: `Importado en bloque desde: ${fileNames.join(', ')}`,
            updated_at: new Date().toISOString(),
            created_by: user.id,
          }
          if (snap) {
            await supabase.from('consumption_snapshots').update(bulkSnapshot).eq('id', snap.id)
          } else {
            await supabase.from('consumption_snapshots').insert({ ...bulkSnapshot, created_at: new Date().toISOString() })
          }
        }
      }
    }

    // ── Create/update prescoring now that we have real gas consumption data ──────
    try {
      const { ensurePendingPrescoring } = await import('@/lib/ensurePrescoring')
      await ensurePendingPrescoring(supabase, params.id, {
        userId: user.id,
        updateNulls: true,  // patch existing row if present; create if not
      })
    } catch (prescoringErr) {
      console.warn('[import-gas-excel] prescoring update failed (non-fatal)', prescoringErr)
    }

    return NextResponse.json({
      success: true,
      parsed: {
        cups:           best.cups,
        nombre:         best.nombre,
        address:        best.address,
        tariff:         best.tariff,
        distribuidora:  best.distribuidora,
        consumo_total:  best.totalKwh,
        consumo_p1: 0, consumo_p2: 0, consumo_p3: 0,
        consumo_p4: 0, consumo_p5: 0, consumo_p6: 0,
        provincia:      best.provincia,
        municipio:      best.municipio,
        codigo_postal:  best.codigo_postal,
        caudal:         best.caudal,
        presion:        best.presion,
        cnae:           best.cnae,
        fecha_lectura:  best.fecha_lectura,
      },
      rows_in_file:     mergedResults.length,
      files_processed:  fileNames.length,
      matched_by_cups:  matchedByCups,
      consumption_data: newConsumptionData,
    })

  } catch (err: any) {
    console.error('[import-gas-excel]', err)
    return NextResponse.json({ error: err.message || 'Error procesando el archivo' }, { status: 500 })
  }
}
