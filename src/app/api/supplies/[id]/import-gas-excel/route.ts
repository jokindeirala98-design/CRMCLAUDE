/**
 * POST /api/supplies/[id]/import-gas-excel
 *
 * Importa datos de consumo de gas desde un Excel de distribuidora.
 * Soporta:
 *   - XLSX reales
 *   - XLS reales (BIFF)
 *   - HTML disfrazados de .xls (Naturgy _39, Endesa Gas, etc.)
 *
 * Multipart form-data:
 *   file[]     — uno o más archivos .xlsx / .xls
 *   targetCups — (opcional) CUPS del suministro, para filtrar si el Excel
 *                tiene múltiples filas
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import * as htmlparser2 from 'htmlparser2'
import { DomHandler } from 'domhandler'
import { findAll, textContent } from 'domutils'

// ── Column aliases ────────────────────────────────────────────────────────────
// Matches columns by normalized lowercase name (no accents, trimmed)
const COL_ALIASES: Record<string, string[]> = {
  cups:          ['cups', 'codigo cups', 'id suministro', 'cup', 'cups/cau', 'codigo de cups',
                  'codi cups', 'cod cups'],
  address:       ['direccion', 'direccion del suministro', 'via suministro',
                  'emplazamiento', 'domicilio', 'direccion suministro',
                  'tipo via suministro', 'calle'],
  tariff:        ['tarifa', 'peaje', 'tarifa de acceso', 'nivel de presion', 'nivel presion',
                  'tarifa acceso', 'tarifa peaje', 'cod peaje', 'nivel presion tarifa'],
  distribuidora: ['distribuidora', 'empresa distribuidora', 'companyia', 'compania',
                  'distribuidor', 'gas distribuidora'],
  consumo_total: ['consumo', 'consumo anual', 'consumoanual', 'consumo total', 'kwh ano', 'kwh/ano',
                  'kwh anual', 'total kwh', 'energia anual', 'consumo kwh', 'kwh',
                  'consumo_anual', 'consumoanual', 'consum anual'],
  consumo_wh:    ['consumo en wh', 'consumoenwh', 'kwh en wh', 'energia wh', 'consumo wh'],
  consumo_p1:    ['consumo p1', 'p1 kwh', 'punta', 'periodo 1', 'p1'],
  consumo_p2:    ['consumo p2', 'p2 kwh', 'llano', 'periodo 2', 'p2'],
  consumo_p3:    ['consumo p3', 'p3 kwh', 'valle', 'periodo 3', 'p3'],
  consumo_p4:    ['consumo p4', 'p4 kwh', 'periodo 4', 'p4'],
  consumo_p5:    ['consumo p5', 'p5 kwh', 'periodo 5', 'p5'],
  consumo_p6:    ['consumo p6', 'p6 kwh', 'periodo 6', 'p6'],
  provincia:     ['provincia', 'provincia suministro'],
  municipio:     ['municipio', 'poblacion', 'localidad', 'ciudad', 'localidad suministro',
                  'municipio suministro'],
  codigo_postal: ['cp', 'codigo postal', 'c.p.', 'cp.', 'c.postal',
                  'cod postal suministro', 'cod postal'],
  fecha_lectura: ['fecha lectura', 'ultima lectura', 'fecha ultima lectura',
                  'fecha ult. lectura', 'fecha fin consumo', 'fec fin consumo'],
  fecha_inicio:  ['fecha inicio', 'fec ini consumo', 'fecha inicio consumo'],
  caudal:        ['caudal', 'caudal m3/h', 'caudal maximo'],
  presion:       ['presion', 'nivel presion', 'nivel de presion'],
  cnae:          ['cnae', 'codigo cnae'],
  nombre:        ['nombre', 'nombre suministro', 'razon social', 'titular', 'nombre titular',
                  'nombre completo titular', 'apellido titular', 'nombre_completo_titular'],
}

function normalizeHeader(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]/g, ' ')
    .trim()
}

function buildColumnMap(headers: (string | null)[]): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, colIdx) => {
    if (!h) return
    const norm = normalizeHeader(h)
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (map[field] !== undefined) continue
      if (aliases.some(a => {
        const na = normalizeHeader(a)
        return norm === na || norm.includes(na) || na.includes(norm)
      })) {
        map[field] = colIdx
      }
    }
  })
  return map
}

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function toStr(v: any): string {
  return v == null ? '' : String(v).trim()
}

// ── HTML XLS parser ───────────────────────────────────────────────────────────

function isHtmlBuffer(buf: Buffer): boolean {
  const head = buf.slice(0, 512).toString('utf-8').trimStart().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<table') || head.includes('<html')
}

function parseHtmlTable(html: string): string[][] {
  const tables: string[][][] = []

  const handler = new DomHandler((err, dom) => {
    if (err) return
    const trs = findAll(el => el.type === 'tag' && el.name === 'tr', dom)
    const rows: string[][] = []
    for (const tr of trs) {
      const cells = findAll(el => el.type === 'tag' && (el.name === 'td' || el.name === 'th'), [tr])
      rows.push(cells.map(c => textContent(c).trim()))
    }
    if (rows.length > 0) tables.push(rows)
  })

  const parser = new htmlparser2.Parser(handler, { decodeEntities: true })
  parser.write(html)
  parser.end()

  // Return the largest table found
  if (tables.length === 0) return []
  return tables.sort((a, b) => b.length - a.length)[0]
}

interface GasParsedRow {
  cups: string
  nombre: string
  address: string
  tariff: string
  distribuidora: string
  consumo_total: number
  consumo_p1: number
  consumo_p2: number
  consumo_p3: number
  consumo_p4: number
  consumo_p5: number
  consumo_p6: number
  provincia: string
  municipio: string
  codigo_postal: string
  caudal: number
  presion: string
  cnae: string
  fecha_lectura: string
}

function rowsToGasData(
  rows: string[][],
  headerRowIdx: number,
  headers: string[],
): GasParsedRow[] {
  const colMap = buildColumnMap(headers)
  const results: GasParsedRow[] = []

  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const row = rows[ri]
    if (!row || row.every(c => !c)) continue

    const get = (field: string): string => {
      const idx = colMap[field]
      return idx !== undefined ? toStr(row[idx]) : ''
    }
    const getNum = (field: string): number => toNum(get(field))

    const cups_raw = get('cups')
    if (!cups_raw && !get('address') && !get('nombre')) continue

    const p1 = getNum('consumo_p1')
    const p2 = getNum('consumo_p2')
    const p3 = getNum('consumo_p3')
    const p4 = getNum('consumo_p4')
    const p5 = getNum('consumo_p5')
    const p6 = getNum('consumo_p6')
    const periodSum = p1 + p2 + p3 + p4 + p5 + p6

    // Handle Wh values (divide by 1000 if stored as Wh)
    let consumoTotal = getNum('consumo_total')
    if (consumoTotal === 0) {
      // Try Wh column
      const wh = getNum('consumo_wh')
      if (wh > 0) consumoTotal = wh > 500_000 ? Math.round(wh / 1000) : wh
    }
    if (consumoTotal > 500_000) consumoTotal = Math.round(consumoTotal / 1000)
    if (consumoTotal === 0 && periodSum > 0) consumoTotal = periodSum

    results.push({
      cups: cups_raw,
      nombre: get('nombre'),
      address: [get('address'), get('municipio')].filter(Boolean).join(', '),
      tariff: get('tariff'),
      distribuidora: get('distribuidora'),
      consumo_total: consumoTotal,
      consumo_p1: p1,
      consumo_p2: p2,
      consumo_p3: p3,
      consumo_p4: p4,
      consumo_p5: p5,
      consumo_p6: p6,
      provincia: get('provincia'),
      municipio: get('municipio'),
      codigo_postal: get('codigo_postal'),
      caudal: getNum('caudal'),
      presion: get('presion'),
      cnae: get('cnae'),
      fecha_lectura: get('fecha_lectura'),
    })
  }
  return results
}

function findHeaderRowInGrid(rows: string[][]): { headerIdx: number; headers: string[] } | null {
  const allAliases = Object.values(COL_ALIASES).flat().map(normalizeHeader)
  for (let ri = 0; ri < Math.min(25, rows.length); ri++) {
    const row = rows[ri]
    if (!row) continue
    const matches = row.filter(cell => {
      const norm = normalizeHeader(cell)
      return norm && allAliases.some(a => norm.includes(a) || a.includes(norm))
    })
    if (matches.length >= 2) return { headerIdx: ri, headers: row }
  }
  return null
}

async function parseGasExcelBuffer(buffer: Buffer, filename: string): Promise<GasParsedRow[]> {
  // ── Detect HTML-disguised XLS ─────────────────────────────────────────────
  if (isHtmlBuffer(buffer)) {
    const html = buffer.toString('utf-8')
    const rows = parseHtmlTable(html)
    if (rows.length === 0) throw new Error('No se encontraron tablas en el archivo HTML')

    const found = findHeaderRowInGrid(rows)
    if (!found) {
      // fallback: first row is header
      const headers = rows[0] || []
      return rowsToGasData(rows, 0, headers)
    }
    return rowsToGasData(rows, found.headerIdx, found.headers)
  }

  // ── Real XLSX / XLS via ExcelJS ───────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch {
    // Try as CSV fallback
    throw new Error(
      'Formato de archivo no soportado. El archivo no es un Excel válido (.xlsx). ' +
      'Si es un archivo .xls antiguo de distribuidora, intenta abrirlo con Excel y guardarlo como .xlsx'
    )
  }

  const allRows: GasParsedRow[] = []
  for (const ws of wb.worksheets) {
    if (!ws || ws.rowCount === 0) continue

    // Build grid from worksheet
    const grid: string[][] = []
    for (let ri = 1; ri <= ws.rowCount; ri++) {
      const row = ws.getRow(ri)
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let v = ''
        if (cell.value !== null && cell.value !== undefined) {
          if (typeof cell.value === 'object' && 'result' in (cell.value as any)) {
            v = toStr((cell.value as any).result)
          } else if (typeof cell.value === 'object' && 'text' in (cell.value as any)) {
            v = toStr((cell.value as any).text)
          } else {
            v = toStr(cell.value)
          }
        }
        cells[colNumber - 1] = v
      })
      grid.push(cells)
    }

    const found = findHeaderRowInGrid(grid)
    if (!found) continue
    const wsRows = rowsToGasData(grid, found.headerIdx, found.headers)
    allRows.push(...wsRows)
  }

  if (allRows.length === 0) throw new Error('No se encontraron datos en el Excel')
  return allRows
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
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

    // ── Parse multipart form ──────────────────────────────────────────────────
    const formData = await req.formData()
    const targetCups = (formData.get('targetCups') as string | null)?.trim().toUpperCase()

    // Accept multiple files: 'file' (single) or 'files[]' (multiple)
    const fileEntries = formData.getAll('file') as File[]
    const extraFiles = formData.getAll('files[]') as File[]
    const allFiles = [...fileEntries, ...extraFiles].filter((f): f is File => f instanceof File)

    if (allFiles.length === 0) return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 })

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

    // ── Parse all files and collect rows ─────────────────────────────────────
    const allRows: GasParsedRow[] = []
    const fileNames: string[] = []

    for (const file of allFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!ext || !['xlsx', 'xls'].includes(ext)) continue

      const buffer = Buffer.from(await file.arrayBuffer())
      try {
        const rows = await parseGasExcelBuffer(buffer, file.name)
        allRows.push(...rows)
        fileNames.push(file.name)
      } catch (err: any) {
        console.error(`[import-gas-excel] Error parsing ${file.name}:`, err.message)
        // Continue with other files if one fails
      }
    }

    if (allRows.length === 0) {
      return NextResponse.json({
        error: 'No se encontraron datos en los archivos. ' +
          'Asegúrate de que el archivo tiene columnas reconocibles (CUPS, Consumo, Distribuidora, etc.)'
      }, { status: 422 })
    }

    // ── Select best matching row ──────────────────────────────────────────────
    // Priority: (1) exact CUPS match, (2) first row with any data
    const matchedRow = allRows.find(r => r.cups.toUpperCase().replace(/\s/g, '') === supplyCupsNorm)
    const parsed = matchedRow ?? allRows[0]
    const matchedByCups = !!matchedRow

    // ── Build consumption_data ────────────────────────────────────────────────
    const periodSum = parsed.consumo_p1 + parsed.consumo_p2 + parsed.consumo_p3
                    + parsed.consumo_p4 + parsed.consumo_p5 + parsed.consumo_p6

    // Gas: don't create P1–P6 breakdown unless explicitly present
    const consumoPeriodos: Record<string, number> = {}
    if (parsed.consumo_p1 > 0) consumoPeriodos.P1 = parsed.consumo_p1
    if (parsed.consumo_p2 > 0) consumoPeriodos.P2 = parsed.consumo_p2
    if (parsed.consumo_p3 > 0) consumoPeriodos.P3 = parsed.consumo_p3
    if (parsed.consumo_p4 > 0) consumoPeriodos.P4 = parsed.consumo_p4
    if (parsed.consumo_p5 > 0) consumoPeriodos.P5 = parsed.consumo_p5
    if (parsed.consumo_p6 > 0) consumoPeriodos.P6 = parsed.consumo_p6

    const totalKwh = parsed.consumo_total > 0 ? parsed.consumo_total : periodSum

    const newConsumptionData = {
      ...(supply.consumption_data as any ?? {}),
      source: 'excel_import' as const,
      fetched_at: new Date().toISOString(),
      import_filename: fileNames.join(', '),
      import_rows_total: allRows.length,
      // SIPS-compatible fields
      sips_tariff: parsed.tariff || supply.tariff,
      distribuidora: parsed.distribuidora || (supply.consumption_data as any)?.distribuidora,
      municipio: parsed.municipio || (supply.consumption_data as any)?.municipio,
      provincia: parsed.provincia || (supply.consumption_data as any)?.provincia,
      codigoPostal: parsed.codigo_postal || (supply.consumption_data as any)?.codigoPostal,
      cnae: parsed.cnae || (supply.consumption_data as any)?.cnae,
      fechaUltimaLectura: parsed.fecha_lectura || (supply.consumption_data as any)?.fechaUltimaLectura,
      caudal: parsed.caudal || (supply.consumption_data as any)?.caudal,
      presion: parsed.presion || (supply.consumption_data as any)?.presion,
      // Gas: only set consumoPeriodos if we have period data; otherwise leave undefined (no P1 label)
      consumoPeriodos: Object.keys(consumoPeriodos).length > 0 ? consumoPeriodos : undefined,
      totalKwh,
      total: totalKwh,
    }

    // ── Save to supply ────────────────────────────────────────────────────────
    await supabase
      .from('supplies')
      .update({
        consumption_data: newConsumptionData,
        ...(parsed.address ? { address: parsed.address } : {}),
        ...(parsed.tariff ? { tariff: parsed.tariff } : {}),
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
      client_id: supply.client_id,
      supply_id: params.id,
      name: parsed.nombre || null,
      cups: parsed.cups || supply.cups || '',
      tariff: parsed.tariff || supply.tariff || '',
      supply_type: 'gas' as const,
      comercializadora: null,
      address: parsed.address || null,
      potencia_p1: null, potencia_p2: null, potencia_p3: null,
      potencia_p4: null, potencia_p5: null, potencia_p6: null,
      consumo_p1: consumoPeriodos.P1 ?? null,
      consumo_p2: consumoPeriodos.P2 ?? null,
      consumo_p3: consumoPeriodos.P3 ?? null,
      consumo_p4: consumoPeriodos.P4 ?? null,
      consumo_p5: consumoPeriodos.P5 ?? null,
      consumo_p6: consumoPeriodos.P6 ?? null,
      consumo_total: totalKwh,
      source: 'excel_import' as const,
      validation_status: 'validated' as const,
      observations: `Importado desde: ${fileNames.join(', ')}`,
      updated_at: new Date().toISOString(),
      created_by: user.id,
    }

    if (existingSnap) {
      await supabase.from('consumption_snapshots').update(snapshotData).eq('id', existingSnap.id)
    } else {
      await supabase.from('consumption_snapshots').insert({ ...snapshotData, created_at: new Date().toISOString() })
    }

    return NextResponse.json({
      success: true,
      parsed,
      rows_in_file: allRows.length,
      files_processed: fileNames.length,
      matched_by_cups: matchedByCups,
      consumption_data: newConsumptionData,
    })

  } catch (err: any) {
    console.error('[import-gas-excel]', err)
    return NextResponse.json({ error: err.message || 'Error procesando el archivo' }, { status: 500 })
  }
}
