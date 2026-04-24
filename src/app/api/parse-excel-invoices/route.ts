import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

/**
 * Normalize a label for fuzzy matching:
 * - lowercase
 * - remove accents
 * - remove parentheses and content inside
 * - trim whitespace
 */
function normLabel(s: string): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\([^)]*\)/g, '') // Remove (content)
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Find a row by fuzzy matching on the label
 */
function findRowByLabel(worksheet: ExcelJS.Worksheet, targetLabel: string): ExcelJS.Row | null {
  const normalized = normLabel(targetLabel)
  for (let rowNum = 1; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum)
    const cellValue = row.getCell(1)?.value
    if (cellValue && typeof cellValue === 'string') {
      if (normLabel(cellValue) === normalized) {
        return row
      }
    }
  }
  return null
}

/**
 * Parse a date string in various formats
 * Returns YYYY-MM-DD or null if unparseable
 */
function parseDate(input: string | null | undefined): string | null {
  if (!input) return null
  const s = String(input).trim()

  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m1) {
    const day = m1[1].padStart(2, '0')
    const month = m1[2].padStart(2, '0')
    const year = m1[3].length === 2 ? `20${m1[3]}` : m1[3]
    return `${year}-${month}-${day}`
  }

  // Try to parse as month name (enero 2025, etc.)
  const monthMatch = s.match(/^(\w+)\s+(\d{4})$/i)
  if (monthMatch) {
    const monthName = monthMatch[1].toLowerCase()
    const year = monthMatch[2]
    const months: Record<string, string> = {
      enero: '01', january: '01', jan: '01',
      febrero: '02', february: '02', feb: '02',
      marzo: '03', march: '03', mar: '03',
      abril: '04', april: '04', apr: '04',
      mayo: '05', may: '05',
      junio: '06', june: '06', jun: '06',
      julio: '07', july: '07', jul: '07',
      agosto: '08', august: '08', aug: '08',
      septiembre: '09', september: '09', sep: '09', sept: '09',
      octubre: '10', october: '10', oct: '10',
      noviembre: '11', november: '11', nov: '11',
      diciembre: '12', december: '12', dec: '12'
    }
    const monthNum = months[monthName]
    if (monthNum) {
      // First day of month
      return `${year}-${monthNum}-01`
    }
  }

  return null
}

/**
 * Get the last day of a given YYYY-MM-DD month
 */
function getLastDayOfMonth(dateStr: string): string {
  const d = new Date(dateStr)
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const day = String(nextMonth.getDate()).padStart(2, '0')
  const month = String(nextMonth.getMonth() + 1).padStart(2, '0')
  const year = nextMonth.getFullYear()
  return `${year}-${month}-${day}`
}

/**
 * Calculate days between two YYYY-MM-DD dates
 */
function daysBetween(start: string, end: string): number {
  const d1 = new Date(start)
  const d2 = new Date(end)
  const ms = d2.getTime() - d1.getTime()
  return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1 // inclusive
}

/**
 * Normalize tariff: 6.2/6.3/6.4 → 6.1; 3.0 → 3.0; 2.0 → 2.0; else as-is
 */
function normalizeTariff(t: string): string {
  if (!t) return ''
  const normalized = t.trim().replace(/\s+/g, '')
  if (['6.2', '6.3', '6.4'].some(v => normalized.includes(v))) return '6.1'
  if (normalized.includes('3.0')) return '3.0'
  if (normalized.includes('2.0')) return '2.0'
  return t.trim()
}

/**
 * Get numeric value from cell, handling formulas and null
 */
function getCellValue(cell: ExcelJS.Cell | null | undefined): number | null {
  if (!cell) return null
  const val = cell.value
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const parsed = parseFloat(val)
    return isNaN(parsed) ? null : parsed
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { file_base64 } = body

    if (!file_base64) {
      return NextResponse.json(
        { error: 'Missing file_base64' },
        { status: 400 }
      )
    }

    // Decode base64 to buffer
    const rawBuf = Buffer.from(file_base64, 'base64')

    // Parse Excel — ExcelJS accepts ArrayBuffer | Buffer; cast via any to sidestep TS version mismatch
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(rawBuf as any)

    const ws = wb.worksheets[0]
    if (!ws) {
      return NextResponse.json(
        { error: 'No worksheet found in Excel' },
        { status: 400 }
      )
    }

    // Extract CUPS, Tariff, Comercializadora (expected to be same in all months)
    const cupsRow = findRowByLabel(ws, 'CUPS')
    const tarifaRow = findRowByLabel(ws, 'Tarifa')
    const comercializadoraRow = findRowByLabel(ws, 'Compañia')

    const cups = cupsRow ? (cupsRow.getCell(2)?.value as string | null) : ''
    const rawTariff = tarifaRow ? (tarifaRow.getCell(2)?.value as string | null) : ''
    const comercializadora = comercializadoraRow ? (comercializadoraRow.getCell(2)?.value as string | null) : ''

    const tariff = normalizeTariff(rawTariff || '')

    if (!cups) {
      return NextResponse.json(
        { error: 'CUPS not found in Excel' },
        { status: 400 }
      )
    }

    // Detect month columns: look for row with "Fecha Inicio" to find month headers
    // Month headers usually are in the same row as the first data, or we scan headers
    // For now, we detect by checking which columns have non-null values in key rows
    const monthColumns: number[] = []

    // Scan from column B onwards
    for (let col = 2; col <= ws.columnCount; col++) {
      // Check if this column has data in any of our key rows
      const hasData = [
        findRowByLabel(ws, 'Fecha Inicio'),
        findRowByLabel(ws, 'TOTAL CONSUMO (kWh)'),
        findRowByLabel(ws, 'TOTAL FACTURA (€)'),
      ].some(row => {
        if (!row) return false
        const cell = row.getCell(col)
        return cell && cell.value !== null && cell.value !== ''
      })

      if (hasData) {
        monthColumns.push(col)
      }
    }

    if (monthColumns.length === 0) {
      return NextResponse.json(
        { error: 'No month columns detected in Excel' },
        { status: 400 }
      )
    }

    // For each month column, build an invoice object
    const invoices: Array<{
      period_start: string
      period_end: string
      total_amount: number | null
      extracted_data: any
    }> = []

    for (const monthCol of monthColumns) {
      // Get period dates
      const fechaInicioRow = findRowByLabel(ws, 'Fecha Inicio')
      const fechaFinRow = findRowByLabel(ws, 'Fecha Fin')

      const fechaInicio = fechaInicioRow ? (fechaInicioRow.getCell(monthCol)?.value as string | null) : null
      const fechaFin = fechaFinRow ? (fechaFinRow.getCell(monthCol)?.value as string | null) : null

      const periodStart = parseDate(fechaInicio)
      let periodEnd = parseDate(fechaFin)

      // If we have start but no end, use end of that month
      if (periodStart && !periodEnd) {
        periodEnd = getLastDayOfMonth(periodStart)
      }

      // Skip if no dates
      if (!periodStart || !periodEnd) continue

      // Extract economics data
      const potencias: Array<{ periodo: string; kw: number; precioKwDia: number; dias: number; total: number }> = []
      const consumos: Array<{ periodo: string; kwh: number; precioKwh: number; total: number }> = []

      // Potencia P1..P6
      for (let p = 1; p <= 6; p++) {
        const periodo = `P${p}`
        const kwRow = findRowByLabel(ws, `Potencia ${periodo} (kW)`)
        const precioRow = findRowByLabel(ws, `Potencia ${periodo} (€/kW día)`)
        const totalRow = findRowByLabel(ws, `Potencia ${periodo} (€)`)

        const kw = getCellValue(kwRow?.getCell(monthCol)) || 0
        const precioKwDia = getCellValue(precioRow?.getCell(monthCol)) || 0
        const dias = daysBetween(periodStart, periodEnd)
        const total = getCellValue(totalRow?.getCell(monthCol)) || 0

        if (kw > 0 || total > 0) {
          potencias.push({ periodo, kw, precioKwDia, dias, total })
        }
      }

      // Consumo P1..P6
      for (let p = 1; p <= 6; p++) {
        const periodo = `P${p}`
        const kwhRow = findRowByLabel(ws, `Consumo ${periodo} (kWh)`)
        const precioRow = findRowByLabel(ws, `Precio ${periodo} (€/kWh)`)
        const totalRow = findRowByLabel(ws, `Consumo ${periodo} (€)`)

        const kwh = getCellValue(kwhRow?.getCell(monthCol)) || 0
        const precioKwh = getCellValue(precioRow?.getCell(monthCol)) || 0
        const total = getCellValue(totalRow?.getCell(monthCol)) || 0

        if (kwh > 0 || total > 0) {
          consumos.push({ periodo, kwh, precioKwh, total })
        }
      }

      // Get totals
      const consumoTotalRow = findRowByLabel(ws, 'TOTAL CONSUMO (kWh)')
      const costeTotalConsumoRow = findRowByLabel(ws, 'TOTAL COSTE CONSUMO (€)')
      const costeTotalPotenciaRow = findRowByLabel(ws, 'TOTAL COSTE POTENCIA (€)')
      const totalFacturaRow = findRowByLabel(ws, 'TOTAL FACTURA (€)')

      const consumoTotalKwh = getCellValue(consumoTotalRow?.getCell(monthCol)) || 0
      const costeTotalConsumo = getCellValue(costeTotalConsumoRow?.getCell(monthCol)) || 0
      const costeTotalPotencia = getCellValue(costeTotalPotenciaRow?.getCell(monthCol)) || 0
      const totalFactura = getCellValue(totalFacturaRow?.getCell(monthCol)) || 0

      // Build billing period string
      const billingPeriod = fechaInicio && typeof fechaInicio === 'string' && fechaInicio.match(/^[a-zA-Z]+\s+\d{4}$/i)
        ? fechaInicio.toLowerCase()
        : (() => {
            try {
              const d = new Date(periodStart)
              return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toLowerCase()
            } catch {
              return periodStart
            }
          })()

      // Skip if all zeros
      if (consumoTotalKwh === 0 && costeTotalConsumo === 0 && costeTotalPotencia === 0 && totalFactura === 0) {
        continue
      }

      const economics = {
        fechaInicio: periodStart,
        fechaFin: periodEnd,
        comercializadora: comercializadora || '',
        cups: cups || '',
        tarifa: tariff,
        potencia: potencias,
        consumo: consumos,
        consumoTotalKwh,
        costeTotalConsumo,
        costeTotalPotencia,
        totalFactura,
      }

      invoices.push({
        period_start: periodStart,
        period_end: periodEnd,
        total_amount: totalFactura || null,
        extracted_data: {
          mode: 'gemini',
          cups,
          comercializadora: comercializadora || '',
          tariff: tariff,
          billing_period: billingPeriod,
          total_amount: totalFactura ? totalFactura.toString() : '',
          economics,
        },
      })
    }

    return NextResponse.json({
      cups,
      tariff,
      comercializadora: comercializadora || '',
      invoices,
    })
  } catch (error: any) {
    console.error('[parse-excel-invoices] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Error parsing Excel' },
      { status: 500 }
    )
  }
}
