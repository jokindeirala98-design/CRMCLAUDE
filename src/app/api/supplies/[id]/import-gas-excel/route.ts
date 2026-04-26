/**
 * POST /api/supplies/[id]/import-gas-excel
 *
 * Importa datos de consumo de gas desde un Excel de distribuidora.
 * Soporta múltiples formatos (Naturgy, Endesa Gas, etc.) mediante
 * detección flexible de columnas por alias.
 *
 * Multipart form-data:
 *   file      — .xlsx / .xls
 *   targetCups — (opcional) CUPS del suministro, para filtrar si el Excel
 *                tiene múltiples filas
 *
 * Respuesta JSON:
 *   { success, parsed, saved }
 *   parsed: datos extraídos del Excel
 *   saved:  true si se guardaron en DB
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'

// ── Aliases de columnas para detectar encabezados ─────────────────────────────
const COL_ALIASES: Record<string, string[]> = {
  cups:          ['cups', 'código cups', 'codigo cups', 'id suministro', 'cup', 'cups/cau', 'código de cups'],
  address:       ['dirección', 'direccion', 'dirección del suministro', 'direccion suministro',
                  'emplazamiento', 'domicilio', 'dirección suministro', 'domicilio suministro'],
  tariff:        ['tarifa', 'peaje', 'tarifa de acceso', 'nivel de presión', 'nivel presion',
                  'tarifa acceso', 'tarifa peaje'],
  distribuidora: ['distribuidora', 'empresa distribuidora', 'companyia', 'compañia', 'compañía',
                  'distribuidor', 'gas distribuidora'],
  consumo_total: ['consumo', 'consumo anual', 'consumo total', 'kwh año', 'kwh/año', 'kwh anual',
                  'total kwh', 'energía anual', 'energia anual', 'consumo kwh', 'kwh'],
  consumo_p1:    ['consumo p1', 'p1 kwh', 'p1', 'punta', 'período 1', 'periodo 1', 'p1 (kwh)'],
  consumo_p2:    ['consumo p2', 'p2 kwh', 'p2', 'llano', 'período 2', 'periodo 2', 'p2 (kwh)'],
  consumo_p3:    ['consumo p3', 'p3 kwh', 'p3', 'valle', 'período 3', 'periodo 3', 'p3 (kwh)'],
  consumo_p4:    ['consumo p4', 'p4 kwh', 'p4', 'período 4', 'periodo 4', 'p4 (kwh)'],
  consumo_p5:    ['consumo p5', 'p5 kwh', 'p5', 'período 5', 'periodo 5', 'p5 (kwh)'],
  consumo_p6:    ['consumo p6', 'p6 kwh', 'p6', 'período 6', 'periodo 6', 'p6 (kwh)'],
  provincia:     ['provincia'],
  municipio:     ['municipio', 'población', 'poblacion', 'localidad', 'ciudad'],
  codigo_postal: ['cp', 'código postal', 'codigo postal', 'c.p.', 'cp.', 'c.postal'],
  fecha_lectura: ['fecha lectura', 'última lectura', 'ultima lectura', 'fecha ultima lectura',
                  'fecha ult. lectura', 'fecha última lectura'],
  caudal:        ['caudal', 'caudal m3/h', 'caudal máximo', 'caudal maximo'],
  presion:       ['presión', 'presion', 'nivel presión', 'nivel presion'],
  cnae:          ['cnae', 'código cnae', 'codigo cnae'],
  nombre:        ['nombre', 'nombre suministro', 'razón social', 'razon social', 'titular', 'nombre titular'],
}

/** Normalize a header cell to lowercase + no accents for matching */
function normalizeHeader(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Build a column → field map from the header row */
function buildColumnMap(headers: (string | null)[]): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, colIdx) => {
    if (!h) return
    const norm = normalizeHeader(h)
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (map[field] !== undefined) continue // already found
      if (aliases.some(a => norm === normalizeHeader(a) || norm.includes(normalizeHeader(a)))) {
        map[field] = colIdx
      }
    }
  })
  return map
}

/** Extract a cell value as string or number */
function cellVal(row: ExcelJS.Row, colIdx: number): string | number | null {
  const cell = row.getCell(colIdx + 1)
  if (cell.value === null || cell.value === undefined) return null
  if (typeof cell.value === 'object' && 'result' in (cell.value as any)) {
    return (cell.value as any).result ?? null
  }
  if (typeof cell.value === 'object' && 'text' in (cell.value as any)) {
    return (cell.value as any).text ?? null
  }
  return cell.value as string | number
}

function toNum(v: string | number | null): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function toStr(v: string | number | null): string {
  return v == null ? '' : String(v).trim()
}

/** Find the header row: first row with 3+ matching aliases */
function findHeaderRow(ws: ExcelJS.Worksheet): { rowIdx: number; headers: (string | null)[] } | null {
  const allAliases = Object.values(COL_ALIASES).flat().map(normalizeHeader)
  for (let ri = 1; ri <= Math.min(20, ws.rowCount); ri++) {
    const row = ws.getRow(ri)
    const cells: (string | null)[] = []
    let matches = 0
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const v = toStr(cellVal(row, colNumber - 1))
      cells[colNumber - 1] = v || null
      if (v && allAliases.some(a => normalizeHeader(v).includes(a) || a.includes(normalizeHeader(v)))) {
        matches++
      }
    })
    if (matches >= 2) return { rowIdx: ri, headers: cells }
  }
  return null
}

/** Parse the Excel file and return an array of supply data objects */
async function parseGasExcel(buffer: Buffer): Promise<GasParsedRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('El Excel no tiene hojas')

  const found = findHeaderRow(ws)
  if (!found) {
    // Fallback: assume row 1 is header
    const row1 = ws.getRow(1)
    const headers: (string | null)[] = []
    row1.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = toStr(cell.value as any) || null
    })
    found === null // silence ts
    return parseSingleRow(ws, { rowIdx: 1, headers }, 2)
  }

  return parseSingleRow(ws, found, found.rowIdx + 1)
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

function parseSingleRow(
  ws: ExcelJS.Worksheet,
  header: { rowIdx: number; headers: (string | null)[] },
  firstDataRow: number,
): GasParsedRow[] {
  const colMap = buildColumnMap(header.headers)
  const results: GasParsedRow[] = []

  for (let ri = firstDataRow; ri <= ws.rowCount; ri++) {
    const row = ws.getRow(ri)

    // Skip empty rows
    let hasData = false
    row.eachCell({ includeEmpty: false }, () => { hasData = true })
    if (!hasData) continue

    const get = (field: string): string | number | null =>
      colMap[field] !== undefined ? cellVal(row, colMap[field]) : null

    const cups_raw = toStr(get('cups'))
    // Skip rows without any content
    if (!cups_raw && !toStr(get('address')) && toNum(get('consumo_total')) === 0) continue

    // Compute total consumption: prefer explicit total, else sum periods
    const p1 = toNum(get('consumo_p1'))
    const p2 = toNum(get('consumo_p2'))
    const p3 = toNum(get('consumo_p3'))
    const p4 = toNum(get('consumo_p4'))
    const p5 = toNum(get('consumo_p5'))
    const p6 = toNum(get('consumo_p6'))
    const periodSum = p1 + p2 + p3 + p4 + p5 + p6
    const totalExplicit = toNum(get('consumo_total'))
    const consumo_total = totalExplicit > 0 ? totalExplicit : periodSum

    results.push({
      cups: cups_raw,
      nombre: toStr(get('nombre')),
      address: toStr(get('address')),
      tariff: toStr(get('tariff')),
      distribuidora: toStr(get('distribuidora')),
      consumo_total,
      consumo_p1: p1,
      consumo_p2: p2,
      consumo_p3: p3,
      consumo_p4: p4,
      consumo_p5: p5,
      consumo_p6: p6,
      provincia: toStr(get('provincia')),
      municipio: toStr(get('municipio')),
      codigo_postal: toStr(get('codigo_postal')),
      caudal: toNum(get('caudal')),
      presion: toStr(get('presion')),
      cnae: toStr(get('cnae')),
      fecha_lectura: toStr(get('fecha_lectura')),
    })
  }
  return results
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
    const file = formData.get('file') as File | null
    const targetCups = (formData.get('targetCups') as string | null)?.trim().toUpperCase()

    if (!file) return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !['xlsx', 'xls'].includes(ext)) {
      return NextResponse.json({ error: 'Solo se aceptan archivos .xlsx o .xls' }, { status: 400 })
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

    // ── Parse Excel ───────────────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer())
    const rows = await parseGasExcel(buffer)

    if (!rows.length) {
      return NextResponse.json({ error: 'No se encontraron datos en el Excel' }, { status: 422 })
    }

    // ── Select best matching row ──────────────────────────────────────────────
    // Priority: (1) match by targetCups, (2) match by supply.cups, (3) first row
    const supplyCupsNorm = (targetCups || supply.cups || '').toUpperCase().replace(/\s/g, '')
    let parsed = rows.find(r => r.cups.toUpperCase().replace(/\s/g, '') === supplyCupsNorm)
                 ?? rows[0]

    // ── Build consumption_data ────────────────────────────────────────────────
    const periodSum = parsed.consumo_p1 + parsed.consumo_p2 + parsed.consumo_p3
                    + parsed.consumo_p4 + parsed.consumo_p5 + parsed.consumo_p6

    const consumoPeriodos: Record<string, number> = {}
    if (parsed.consumo_p1 > 0) consumoPeriodos.P1 = parsed.consumo_p1
    if (parsed.consumo_p2 > 0) consumoPeriodos.P2 = parsed.consumo_p2
    if (parsed.consumo_p3 > 0) consumoPeriodos.P3 = parsed.consumo_p3
    if (parsed.consumo_p4 > 0) consumoPeriodos.P4 = parsed.consumo_p4
    if (parsed.consumo_p5 > 0) consumoPeriodos.P5 = parsed.consumo_p5
    if (parsed.consumo_p6 > 0) consumoPeriodos.P6 = parsed.consumo_p6

    // If no period breakdown but has total, put it all in P1
    if (Object.keys(consumoPeriodos).length === 0 && parsed.consumo_total > 0) {
      consumoPeriodos.P1 = parsed.consumo_total
    }

    const totalKwh = parsed.consumo_total > 0 ? parsed.consumo_total : periodSum

    const newConsumptionData = {
      // Preserve existing data and override with new
      ...(supply.consumption_data as any ?? {}),
      source: 'excel_import' as const,
      fetched_at: new Date().toISOString(),
      import_filename: file.name,
      import_rows_total: rows.length,
      // SIPS-compatible fields
      sips_tariff: parsed.tariff || supply.tariff,
      distribuidora: parsed.distribuidora || (supply.consumption_data as any)?.distribuidora,
      municipio: parsed.municipio || (supply.consumption_data as any)?.municipio,
      provincia: parsed.provincia || (supply.consumption_data as any)?.provincia,
      codigoPostal: parsed.codigo_postal || (supply.consumption_data as any)?.codigoPostal,
      cnae: parsed.cnae || (supply.consumption_data as any)?.cnae,
      fechaUltimaLectura: parsed.fecha_lectura || (supply.consumption_data as any)?.fechaUltimaLectura,
      // Gas-specific
      caudal: parsed.caudal || (supply.consumption_data as any)?.caudal,
      presion: parsed.presion || (supply.consumption_data as any)?.presion,
      // Consumption
      consumoPeriodos,
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
    // Check if a snapshot already exists for this supply
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
      // Gas: no power periods
      potencia_p1: null, potencia_p2: null, potencia_p3: null,
      potencia_p4: null, potencia_p5: null, potencia_p6: null,
      // Consumption
      consumo_p1: consumoPeriodos.P1 ?? null,
      consumo_p2: consumoPeriodos.P2 ?? null,
      consumo_p3: consumoPeriodos.P3 ?? null,
      consumo_p4: consumoPeriodos.P4 ?? null,
      consumo_p5: consumoPeriodos.P5 ?? null,
      consumo_p6: consumoPeriodos.P6 ?? null,
      consumo_total: totalKwh,
      source: 'excel_import' as const,
      validation_status: 'validated' as const,
      observations: `Importado desde Excel: ${file.name}`,
      updated_at: new Date().toISOString(),
      created_by: user.id,
    }

    if (existingSnap) {
      await supabase
        .from('consumption_snapshots')
        .update(snapshotData)
        .eq('id', existingSnap.id)
    } else {
      await supabase
        .from('consumption_snapshots')
        .insert({ ...snapshotData, created_at: new Date().toISOString() })
    }

    return NextResponse.json({
      success: true,
      parsed,
      rows_in_file: rows.length,
      matched_by_cups: !!rows.find(r => r.cups.toUpperCase().replace(/\s/g, '') === supplyCupsNorm),
      consumption_data: newConsumptionData,
    })

  } catch (err: any) {
    console.error('[import-gas-excel]', err)
    return NextResponse.json({ error: err.message || 'Error procesando el archivo' }, { status: 500 })
  }
}
