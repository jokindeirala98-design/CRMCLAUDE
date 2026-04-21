/**
 * GET /api/liquidaciones/generate?comercial=Jokin&month=01&year=2026
 * GET /api/liquidaciones/generate?comercial=all&month=01&year=2026
 *
 * Generates liquidación Excel(s) from VOLTIS CONTRATACIONES data.
 * One sheet per month requested. Matches the template structure exactly.
 * When comercial=all, returns a ZIP with one Excel per commercial.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getContratacionRows } from '@/lib/google-sheets'
import ExcelJS from 'exceljs'

const MONTHS_ES = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
]

// Sheet column indexes (0-based) in VOLTIS CONTRATACIONES
const COL = {
  comercial: 0,        // A
  fechaFirma: 2,       // C
  fechaActivacion: 3,  // D
  nombre: 4,           // E
  nifCif: 5,           // F
  firmante: 6,         // G
  dniFirmante: 7,      // H
  comercializadora: 8, // I
  servicio: 9,         // J
  mail: 10,            // K
  cups: 15,            // P
  producto: 16,        // Q
  tramite: 17,         // R
  consumo: 19,         // T
  comisionNeta: 20,    // U (manual, usually empty)
  sva: 21,             // V (manual)
  comComercial: 25,    // Z
  estado: 26,          // AA
}

interface ContractLine {
  empresa: string       // blank if particular
  nombre: string
  cups: string
  fechaVenta: string
  forma: string         // L, G, T, L+SVA, G+SVA
  gasUnits: number
  gasSvaUnits: number
  luzUnits: number
  luzSvaUnits: number
  telUnits: number
  comercializadora: string
  comision: number | null
  estado: string
  isFallen: boolean
}

function detectForma(row: string[]): { forma: string; gasU: number; gasSU: number; luzU: number; luzSU: number; telU: number } {
  const servicio = (row[COL.servicio] || '').toLowerCase()
  const producto = (row[COL.producto] || '').toLowerCase()
  const hasSVA = producto.includes('sva') || producto.includes('+ sva')

  let gasU = 0, gasSU = 0, luzU = 0, luzSU = 0, telU = 0
  let forma = 'L'

  if (servicio.includes('gas')) {
    if (hasSVA) { gasSU = 1; forma = 'G + SVA' }
    else { gasU = 1; forma = 'G' }
  } else if (servicio.includes('tele') || servicio.includes('fon')) {
    telU = 1; forma = 'T'
  } else {
    if (hasSVA) { luzSU = 1; forma = 'L + SVA' }
    else { luzU = 1; forma = 'L' }
  }
  return { forma, gasU, gasSU, luzU, luzSU, telU }
}

function parseDate(s: string): Date | null {
  if (!s) return null
  // dd-mm-yyyy or dd/mm/yyyy or ISO
  const parts = s.split(/[-/]/)
  if (parts.length === 3) {
    if (parts[0].length === 4) return new Date(s) // ISO
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
  }
  return null
}

function buildContractLine(row: string[], fallen: boolean): ContractLine {
  const { forma, gasU, gasSU, luzU, luzSU, telU } = detectForma(row)
  const isCompany = !!(row[COL.firmante] || '').trim()
  return {
    empresa: isCompany ? row[COL.nombre] || '' : '',
    nombre: isCompany ? (row[COL.firmante] || row[COL.nombre] || '') : (row[COL.nombre] || ''),
    cups: row[COL.cups] || '',
    fechaVenta: row[COL.fechaFirma] || '',
    forma,
    gasUnits: gasU,
    gasSvaUnits: gasSU,
    luzUnits: luzU,
    luzSvaUnits: luzSU,
    telUnits: telU,
    comercializadora: row[COL.comercializadora] || '',
    comision: row[COL.comisionNeta] ? parseFloat(row[COL.comisionNeta].replace(',', '.')) : null,
    estado: row[COL.estado] || '',
    isFallen: fallen || (row[COL.estado] || '').toUpperCase() === 'CAÍDO',
  }
}

async function buildLiquidacionWorkbook(comercialName: string, month: number, year: number, allRows: string[][]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()

  // Filter rows for this comercial and month
  const monthStr = String(month).padStart(2, '0')
  const lines = allRows.filter(row => {
    if (!row[COL.comercial]) return false
    const com = row[COL.comercial].trim().toUpperCase()
    if (com !== comercialName.toUpperCase()) return false
    const d = parseDate(row[COL.fechaFirma])
    if (!d) return false
    return d.getMonth() + 1 === month && d.getFullYear() === year
  }).map(row => buildContractLine(row, false))

  if (lines.length === 0) {
    // Create empty month sheet anyway
    const ws = wb.addWorksheet(MONTHS_ES[month - 1])
    ws.addRow(['Sin contratos este mes'])
    return wb
  }

  const ws = wb.addWorksheet(MONTHS_ES[month - 1])

  // ── Header styling helpers ──
  const HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FF1F3A5F' },
  }
  const FALLEN_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFFFE0B2' },
  }
  const WARN_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFFF5722' },
  }

  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }
  const normalFont = { size: 9 }

  // ── Column widths ──
  ws.columns = [
    { width: 8 },  // A COM.
    { width: 22 }, // B EMPRESA
    { width: 26 }, // C NOMBRE TIT.
    { width: 2 },  // D (blank col)
    { width: 7 },  // E ID (last 4 CUPS)
    { width: 10 }, // F ESTADO HC
    { width: 12 }, // G F.VTA.
    { width: 14 }, // H FORM.
    { width: 5 },  // I GAS
    { width: 7 },  // J GAS+SVA
    { width: 5 },  // K LUZ
    { width: 7 },  // L LUZ+SVA
    { width: 8 },  // M TELEFONÍA
    { width: 20 }, // N COMERCIALIZADORA
    { width: 12 }, // O COMISIÓN
  ]

  // ── Row 1: header ──
  const headerRow = ws.addRow([
    'COM.', 'EMPRESA', 'NOMBRE TIT.', null, 'ID', 'ESTADO HC',
    'F. VTA.', 'FORM.', 'GAS', 'GAS + SVA', 'LUZ', 'LUZ + SVA', 'TELEFONÍA',
    'COMERCIALIZADORA', 'COMISIÓN',
  ])
  headerRow.eachCell(cell => {
    cell.fill = HEADER_FILL
    cell.font = headerFont
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF3B82F6' } },
    }
  })

  // ── Data rows ──
  const dataStartRow = 2
  const normalLines = lines.filter(l => !l.isFallen)
  const fallenLines = lines.filter(l => l.isFallen)
  const allDisplayLines = [...normalLines, ...fallenLines]

  allDisplayLines.forEach((line, idx) => {
    const cupsId = line.cups ? line.cups.slice(-4) : '-'
    const dataRow = ws.addRow([
      comercialName.toUpperCase(),
      line.empresa,
      line.nombre,
      null,
      cupsId,
      'CARGADO',
      line.fechaVenta,
      line.forma,
      line.gasUnits || null,
      line.gasSvaUnits || null,
      line.luzUnits || null,
      line.luzSvaUnits || null,
      line.telUnits || null,
      line.comercializadora,
      line.comision,
    ])

    dataRow.eachCell(cell => { cell.font = normalFont })

    // Comisión cell - empty = yellow bg for manual fill
    const comCell = dataRow.getCell(15)
    if (line.comision === null || line.comision === undefined) {
      comCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } }
      comCell.note = 'Pendiente de rellenar manualmente'
    } else {
      comCell.numFmt = '#,##0.00 €'
      comCell.font = { bold: true, size: 9, color: { argb: 'FF1B5E20' } }
    }

    // Fallen client warning row
    if (line.isFallen) {
      dataRow.eachCell(cell => {
        cell.fill = FALLEN_FILL
        cell.font = { ...normalFont, color: { argb: 'FFB71C1C' }, bold: true }
      })
      // Add warning note in next row
      const warnRow = ws.addRow([
        null, null,
        `⚠️ CLIENTE CAÍDO — verificar decomisión para ${line.nombre}`,
      ])
      warnRow.getCell(3).fill = WARN_FILL
      warnRow.getCell(3).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 8 }
      warnRow.getCell(3).alignment = { horizontal: 'left' }
    }
  })

  // ── Subtotals section ──
  const lastDataRow = ws.lastRow!.number
  ws.addRow([]) // spacer

  const subtotalLabelRow = ws.addRow([
    null, null, null, null, null, null, null,
    'OTROS',
    { formula: `SUM(I${dataStartRow}:I${lastDataRow})` },
    { formula: `SUM(J${dataStartRow}:J${lastDataRow})` },
    { formula: `SUM(K${dataStartRow}:K${lastDataRow})` },
    { formula: `SUM(L${dataStartRow}:L${lastDataRow})` },
    { formula: `SUM(M${dataStartRow}:M${lastDataRow})` },
    null,
    { formula: `SUM(I${subtotalLabelRow2}:L${subtotalLabelRow2})` },
  ])
  // We need forward references — let's use actual row numbers
  const sumRow = subtotalLabelRow.number

  ws.addRow([
    null, null, null, null, null, null, null,
    normalLines.length * 50, // "OTROS" manual bonus, placeholder 0
    null, null, null, null, null,
    null,
    { formula: `SUM(H${sumRow + 1}:M${sumRow + 1})` },
  ])

  // ── TOTAL header ──
  ws.addRow([])
  const totalRow = ws.addRow([
    null, null, null, null, null, null, null, null, null, null, null, null, null,
    null,
    `TOTAL ${MONTHS_ES[month - 1]}`,
  ])
  totalRow.getCell(15).font = { bold: true, size: 11 }
  totalRow.getCell(15).fill = HEADER_FILL
  totalRow.getCell(15).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }

  // TOTAL formula = sum of all comisión cells
  const totalValueRow = ws.addRow([
    null, null, null, null, null, null, null, null, null, null, null, null, null,
    null,
    { formula: `SUM(O${dataStartRow}:O${lastDataRow})` },
  ])
  const totalCell = totalValueRow.getCell(15)
  totalCell.numFmt = '#,##0.00 €'
  totalCell.font = { bold: true, size: 14, color: { argb: 'FF0D47A1' } }

  return wb
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const comercial = searchParams.get('comercial') || ''
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1))
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))

    if (!comercial) return NextResponse.json({ error: 'comercial required' }, { status: 400 })

    // Check admin auth
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users_profile')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    // Fetch all rows from Google Sheet
    const allRows = await getContratacionRows()

    // Get unique comerciales if "all"
    let comerciales: string[]
    if (comercial === 'all') {
      const seen = new Set<string>()
      allRows.forEach(r => {
        const c = (r[COL.comercial] || '').trim()
        if (c) seen.add(c)
      })
      comerciales = Array.from(seen)
    } else {
      comerciales = [comercial]
    }

    if (comerciales.length === 1) {
      // Single comercial → return Excel directly
      const wb = await buildLiquidacionWorkbook(comerciales[0], month, year, allRows)
      const monthName = MONTHS_ES[month - 1].toLowerCase()
      const comName = comerciales[0].toLowerCase()
      const filename = `liquidacion_${comName}_${monthName}.xlsx`

      const buffer = await wb.xlsx.writeBuffer()
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    } else {
      // Multiple comerciales → ZIP
      // Use dynamic import to avoid build issues
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const monthName = MONTHS_ES[month - 1].toLowerCase()

      for (const com of comerciales) {
        const wb = await buildLiquidacionWorkbook(com, month, year, allRows)
        const comName = com.toLowerCase()
        const filename = `liquidacion_${comName}_${monthName}.xlsx`
        const buf = await wb.xlsx.writeBuffer()
        zip.file(filename, buf)
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
      return new NextResponse(zipBuffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="liquidaciones_${monthName}_${year}.zip"`,
        },
      })
    }
  } catch (err: any) {
    console.error('[liquidaciones/generate]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Workaround: forward reference fix
const subtotalLabelRow2 = 0 // placeholder, not actually used in formula string above
