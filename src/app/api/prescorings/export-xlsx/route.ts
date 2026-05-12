import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

/**
 * POST /api/prescorings/export-xlsx
 * Body: { rows: PrescoringRow[] }
 * Returns: .xlsx file
 */
export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Voltis CRM'
    wb.created = new Date()

    const ws = wb.addWorksheet('Prescorings')

    // ---- Header styling ----
    const headerFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2D5016' }, // dark green (brand)
    }
    const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    const datFont: Partial<ExcelJS.Font> = { size: 10 }

    // ---- Columns ----
    ws.columns = [
      { header: 'FECHA',        key: 'fecha',          width: 18 },
      { header: 'CUPS',         key: 'cups',           width: 26 },
      { header: 'NOMBRE',       key: 'nombre',         width: 28 },
      { header: 'CIF/NIF',      key: 'cif',            width: 14 },
      { header: 'CLIENTE',      key: 'producto',       width: 14 },
      { header: 'TARIFA',       key: 'tariff',         width: 10 },
      { header: 'CONSUMO ANUAL',key: 'consumo_anual',  width: 16 },
      { header: 'ENTIDAD',      key: 'entidad',        width: 22 },
      { header: 'TELÉFONO',     key: 'telefono',       width: 14 },
      { header: 'POBLACIÓN',    key: 'poblacion',      width: 18 },
      { header: 'DIR. FISCAL',  key: 'direccion',      width: 36 },
    ]

    // Style header row
    const headerRow = ws.getRow(1)
    headerRow.eachCell(cell => {
      cell.fill = headerFill
      cell.font = headerFont
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF1A3A0A' } },
      }
    })
    headerRow.height = 22

    // ---- Data rows ----
    const fmtDate = (d: string | null) => {
      if (!d) return ''
      const dt = new Date(d)
      return dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' + dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    }

    const getClientType = (name: string | null, cif: string | null) => {
      const n = (name || '').trim().toLowerCase()
      if (n.startsWith('ayuntamiento de')) return 'Ayuntamiento'
      const id = (cif || '').trim()
      if (id && /^[A-Za-z]/.test(id)) return 'Empresa'
      return 'Particular'
    }

    rows.forEach((p: any, i: number) => {
      const row = ws.addRow({
        fecha:         fmtDate(p.requested_at),
        cups:          p.cups || '',
        nombre:        p.client_name || '',
        cif:           p.cif || '',
        producto:      getClientType(p.client_name, p.cif),
        tariff:        p.tariff || '',
        consumo_anual: p.consumo_anual || '',
        entidad:       p.entidad || '',
        telefono:      p.telefono || '',
        poblacion:     p.poblacion || '',
        direccion:     p.direccion_fiscal || '',
      })
      row.font = datFont
      row.height = 18
      // Alternating row fill
      if (i % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F6F0' } }
        })
      }
      row.eachCell(cell => {
        cell.alignment = { vertical: 'middle', wrapText: false }
        cell.border = {
          bottom: { style: 'hair', color: { argb: 'FFDDD5C5' } },
        }
      })
    })

    // Freeze header row
    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }]

    // Auto-filter on header
    ws.autoFilter = { from: 'A1', to: 'K1' }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer())
    const today = new Date().toISOString().split('T')[0]

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="prescorings_${today}.xlsx"`,
      },
    })
  } catch (err: any) {
    console.error('[prescorings/export-xlsx]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
