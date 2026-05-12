import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const MARGEN_CANAL_ENERGIA = 25   // €/MWh — hardcoded per template
const MARGEN_CANAL_POT     = 0    // €/kW año — hardcoded per template
const MAX_DATA_ROWS        = 32   // rows 4-35 (template has space for 32 supplies)

/**
 * POST /api/prescorings/export-fee
 * Body: { rows: PrescoringRow[] }
 * Each row must include supply_id (to fetch potencias from DB).
 * Returns: .xlsx file matching the "autorización fee" template.
 */
export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    }

    // ── Fetch supply consumption_data for potencias + totalKwh ──────────────
    const supabase = createClient(supabaseUrl, supabaseKey)
    const supplyIds = rows.map((r: any) => r.supply_id).filter(Boolean)
    const supplyMap = new Map<string, any>()

    if (supplyIds.length > 0) {
      const { data: supplies } = await supabase
        .from('supplies')
        .select('id, consumption_data')
        .in('id', supplyIds)

      for (const s of supplies || []) {
        supplyMap.set(s.id, s.consumption_data || {})
      }
    }

    // ── Build workbook ──────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Voltis CRM'
    wb.created = new Date()

    const ws = wb.addWorksheet('Autorización Fee')

    // ── Column widths (matching template) ───────────────────────────────────
    ws.getColumn('A').width = 33
    ws.getColumn('B').width = 26.6
    ws.getColumn('C').width = 8.9
    ws.getColumn('D').width = 11.4
    ws.getColumn('E').width = 5.6
    ws.getColumn('F').width = 5.6
    ws.getColumn('G').width = 5.6
    ws.getColumn('H').width = 5.6
    ws.getColumn('I').width = 5.6
    ws.getColumn('J').width = 5.6
    ws.getColumn('K').width = 14.9
    ws.getColumn('L').width = 13.1
    ws.getColumn('M').width = 10
    ws.getColumn('N').width = 9
    ws.getColumn('O').width = 14.9
    ws.getColumn('P').width = 13.1
    ws.getColumn('Q').width = 10
    ws.getColumn('R').width = 9

    // ── Header styling helpers ───────────────────────────────────────────────
    const hdrFont: Partial<ExcelJS.Font> = { size: 10, name: 'Calibri' }
    const hdrAlign: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true }
    const hdrBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    }

    function styleHeader(cell: ExcelJS.Cell, bgArgb?: string) {
      cell.font = hdrFont
      cell.alignment = hdrAlign
      cell.border = hdrBorder
      if (bgArgb) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } }
      }
    }

    // ── Row 1: top-level group headers ──────────────────────────────────────
    ws.getRow(1).height = 30
    ws.getRow(2).height = 30

    // Merged headers rows 1-2 (A, B, C, D)
    ws.mergeCells('A1:A2'); ws.getCell('A1').value = 'Razón social'; styleHeader(ws.getCell('A1'))
    ws.mergeCells('B1:B2'); ws.getCell('B1').value = 'CUPS';          styleHeader(ws.getCell('B1'))
    ws.mergeCells('C1:C2'); ws.getCell('C1').value = 'Tarifa';        styleHeader(ws.getCell('C1'))
    ws.mergeCells('D1:D2'); ws.getCell('D1').value = 'Qa (kWh/año)'; styleHeader(ws.getCell('D1'))

    // E1:J1 → "Pot. Contratada (kW)"
    ws.mergeCells('E1:J1'); ws.getCell('E1').value = 'Pot. Contratada (kW)'; styleHeader(ws.getCell('E1'))
    ;['E2','F2','G2','H2','I2','J2'].forEach((ref, i) => {
      ws.getCell(ref).value = `P${i+1}`; styleHeader(ws.getCell(ref))
    })

    // K1:L1 → "Margen Canal"
    ws.mergeCells('K1:L1'); ws.getCell('K1').value = 'Margen Canal'; styleHeader(ws.getCell('K1'), 'FFBDD7EE')
    ws.getCell('K2').value = 'Energía (€/MWh)'; styleHeader(ws.getCell('K2'), 'FFBDD7EE')
    ws.getCell('L2').value = 'Pot (€/kW año)';  styleHeader(ws.getCell('L2'), 'FFBDD7EE')

    // M1:N1 → "Comisión canal"
    ws.mergeCells('M1:N1'); ws.getCell('M1').value = 'Comisión canal'; styleHeader(ws.getCell('M1'), 'FFBDD7EE')
    ws.getCell('M2').value = '€';      styleHeader(ws.getCell('M2'), 'FFBDD7EE')
    ws.getCell('N2').value = '€/MWh';  styleHeader(ws.getCell('N2'), 'FFBDD7EE')

    // O1:P1 → "Margen Galp"
    ws.mergeCells('O1:P1'); ws.getCell('O1').value = 'Margen Galp'; styleHeader(ws.getCell('O1'), 'FFFFE699')
    ws.getCell('O2').value = 'Energía (€/MWh)'; styleHeader(ws.getCell('O2'), 'FFFFE699')
    ws.getCell('P2').value = 'Pot (€/kW año)';  styleHeader(ws.getCell('P2'), 'FFFFE699')

    // Q1:R1 → "Comisión GALP"
    ws.mergeCells('Q1:R1'); ws.getCell('Q1').value = 'Comisión GALP'; styleHeader(ws.getCell('Q1'), 'FFFFE699')
    ws.getCell('Q2').value = '€';      styleHeader(ws.getCell('Q2'), 'FFFFE699')
    ws.getCell('R2').value = '€/MWh';  styleHeader(ws.getCell('R2'), 'FFFFE699')

    // Row 3: empty spacer
    ws.getRow(3).height = 5

    // ── Data rows (4 to 35) ─────────────────────────────────────────────────
    const dataFont: Partial<ExcelJS.Font> = { size: 10, name: 'Calibri' }
    const dataBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'hair' }, left: { style: 'hair' },
      bottom: { style: 'hair' }, right: { style: 'hair' },
    }
    const numFmt2 = '#,##0.00'
    const numFmt0 = '#,##0'

    function parseConsumo(s: string | null | undefined): number {
      if (!s) return 0
      // "12.558 kWh" → 12558 (Spanish locale: period = thousands separator)
      const cleaned = String(s).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')
      return parseFloat(cleaned) || 0
    }

    function getPotencias(cd: any, tariff: string): (number | string)[] {
      const t = (tariff || '').replace(/\s+/g, '').toUpperCase()
      // Tariffs with P1-P6 structured powers
      const hasPeriods = t.startsWith('3.0') || t === '30TD' || t.startsWith('6.1') || t === '61TD'
      if (!hasPeriods) return ['-', '-', '-', '-', '-', '-']
      const pp = cd?.potenciaContratada || {}
      return [
        Number(pp.P1) || '-',
        Number(pp.P2) || '-',
        Number(pp.P3) || '-',
        Number(pp.P4) || '-',
        Number(pp.P5) || '-',
        Number(pp.P6) || '-',
      ]
    }

    const limitedRows = rows.slice(0, MAX_DATA_ROWS)

    for (let i = 0; i < limitedRows.length; i++) {
      const p   = limitedRows[i] as any
      const r   = i + 4  // Excel row number (data starts at row 4)
      const cd  = supplyMap.get(p.supply_id) || {}

      // Consumo: prefer DB totalKwh, fallback to parsed consumo_anual string
      const consumoKwh = Number(cd?.totalKwh) > 0
        ? Math.round(Number(cd.totalKwh))
        : parseConsumo(p.consumo_anual)

      const potencias = getPotencias(cd, p.tariff || '')

      // A: Razón social
      const cellA = ws.getCell(`A${r}`)
      cellA.value = p.client_name || ''
      cellA.font = dataFont; cellA.border = dataBorder

      // B: CUPS
      const cellB = ws.getCell(`B${r}`)
      cellB.value = p.cups || ''
      cellB.font = { ...dataFont, name: 'Courier New' }; cellB.border = dataBorder

      // C: Tarifa
      const cellC = ws.getCell(`C${r}`)
      cellC.value = p.tariff || ''
      cellC.font = dataFont; cellC.alignment = { horizontal: 'center' }; cellC.border = dataBorder

      // D: Consumo anual (kWh)
      const cellD = ws.getCell(`D${r}`)
      cellD.value = consumoKwh || 0
      cellD.font = dataFont; cellD.numFmt = numFmt0
      cellD.alignment = { horizontal: 'right' }; cellD.border = dataBorder

      // E-J: Potencias P1-P6
      const potCols = ['E','F','G','H','I','J']
      potencias.forEach((pot, j) => {
        const cell = ws.getCell(`${potCols[j]}${r}`)
        cell.value = pot === '-' ? '-' : (pot as number)
        cell.font = dataFont
        cell.numFmt = typeof pot === 'number' ? numFmt2 : '@'
        cell.alignment = { horizontal: 'center' }
        cell.border = dataBorder
      })

      // K: Margen Canal Energía (hardcoded)
      const cellK = ws.getCell(`K${r}`)
      cellK.value = MARGEN_CANAL_ENERGIA
      cellK.font = dataFont; cellK.numFmt = numFmt2
      cellK.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E8F7' } }
      cellK.alignment = { horizontal: 'center' }; cellK.border = dataBorder

      // L: Margen Canal Pot (hardcoded)
      const cellL = ws.getCell(`L${r}`)
      cellL.value = MARGEN_CANAL_POT
      cellL.font = dataFont; cellL.numFmt = numFmt2
      cellL.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E8F7' } }
      cellL.alignment = { horizontal: 'center' }; cellL.border = dataBorder

      // M: =K*D/1000 + L*SUM(E:J)
      const cellM = ws.getCell(`M${r}`)
      cellM.value = { formula: `=K${r}*D${r}/1000+L${r}*SUM(E${r}:J${r})` }
      cellM.font = dataFont; cellM.numFmt = numFmt2
      cellM.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E8F7' } }
      cellM.border = dataBorder

      // N: =M/D*1000
      const cellN = ws.getCell(`N${r}`)
      cellN.value = { formula: `=M${r}/D${r}*1000` }
      cellN.font = dataFont; cellN.numFmt = numFmt2
      cellN.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E8F7' } }
      cellN.border = dataBorder

      // O: =1+(K*0.2)
      const cellO = ws.getCell(`O${r}`)
      cellO.value = { formula: `=1+(K${r}*0.2)` }
      cellO.font = dataFont; cellO.numFmt = numFmt2
      cellO.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
      cellO.alignment = { horizontal: 'center' }; cellO.border = dataBorder

      // P: =L*0.2
      const cellP = ws.getCell(`P${r}`)
      cellP.value = { formula: `=L${r}*0.2` }
      cellP.font = dataFont; cellP.numFmt = numFmt2
      cellP.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
      cellP.alignment = { horizontal: 'center' }; cellP.border = dataBorder

      // Q: =O*D/1000 + P*SUM(E:J)
      const cellQ = ws.getCell(`Q${r}`)
      cellQ.value = { formula: `=O${r}*D${r}/1000+P${r}*SUM(E${r}:J${r})` }
      cellQ.font = dataFont; cellQ.numFmt = numFmt2
      cellQ.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
      cellQ.border = dataBorder

      // R: =Q/D*1000
      const cellR = ws.getCell(`R${r}`)
      cellR.value = { formula: `=Q${r}/D${r}*1000` }
      cellR.font = dataFont; cellR.numFmt = numFmt2
      cellR.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
      cellR.border = dataBorder
    }

    // ── Totals row (row 36) ─────────────────────────────────────────────────
    const TOTAL_ROW = 36
    const totalFont: Partial<ExcelJS.Font> = { size: 10, name: 'Calibri', bold: true }
    const totalBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'medium' }, left: { style: 'thin' },
      bottom: { style: 'medium' }, right: { style: 'thin' },
    }

    ws.getCell(`D${TOTAL_ROW}`).value = { formula: `=SUM(D4:D35)` }
    ws.getCell(`D${TOTAL_ROW}`).font = totalFont
    ws.getCell(`D${TOTAL_ROW}`).numFmt = numFmt0
    ws.getCell(`D${TOTAL_ROW}`).border = totalBorder

    ws.getCell(`M${TOTAL_ROW}`).value = { formula: `=SUM(M4:M35)` }
    ws.getCell(`M${TOTAL_ROW}`).font = totalFont
    ws.getCell(`M${TOTAL_ROW}`).numFmt = numFmt2
    ws.getCell(`M${TOTAL_ROW}`).border = totalBorder

    ws.getCell(`N${TOTAL_ROW}`).value = { formula: `=M${TOTAL_ROW}/D${TOTAL_ROW}*1000` }
    ws.getCell(`N${TOTAL_ROW}`).font = totalFont
    ws.getCell(`N${TOTAL_ROW}`).numFmt = numFmt2
    ws.getCell(`N${TOTAL_ROW}`).border = totalBorder

    ws.getCell(`Q${TOTAL_ROW}`).value = { formula: `=SUM(Q4:Q35)` }
    ws.getCell(`Q${TOTAL_ROW}`).font = totalFont
    ws.getCell(`Q${TOTAL_ROW}`).numFmt = numFmt2
    ws.getCell(`Q${TOTAL_ROW}`).border = totalBorder

    ws.getCell(`R${TOTAL_ROW}`).value = { formula: `=Q${TOTAL_ROW}/D${TOTAL_ROW}*1000` }
    ws.getCell(`R${TOTAL_ROW}`).font = totalFont
    ws.getCell(`R${TOTAL_ROW}`).numFmt = numFmt2
    ws.getCell(`R${TOTAL_ROW}`).border = totalBorder

    // Freeze header rows
    ws.views = [{ state: 'frozen', ySplit: 2, activeCell: 'A4' }]

    const buffer = Buffer.from(await wb.xlsx.writeBuffer())
    const today  = new Date().toISOString().split('T')[0]

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="autorizacion_fee_${today}.xlsx"`,
      },
    })
  } catch (err: any) {
    console.error('[prescorings/export-fee]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
