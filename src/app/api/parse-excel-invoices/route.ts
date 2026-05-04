import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

// ── Label normaliser ──────────────────────────────────────────────────────────
// Keeps parentheses content (normalised) so rows with the same prefix but
// different units are still distinguishable.
// e.g.  "Potencia P1 (kW)"       → "potencia p1 kw"
//       "Potencia P1 (€/kW día)" → "potencia p1 eur kw dia"
//       "Potencia P1 (€)"        → "potencia p1 eur"
function normLabel(s: string): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[€]/g, 'eur')                           // € → eur
    .replace(/[()]/g, ' ')                             // open parens without removing content
    .replace(/[\/\-\*]/g, ' ')                         // separators → space
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Row lookup ────────────────────────────────────────────────────────────────
// Build a cache of { normalisedLabel → row } for the whole sheet once.
function buildRowMap(ws: ExcelJS.Worksheet): Map<string, ExcelJS.Row> {
  const map = new Map<string, ExcelJS.Row>()
  ws.eachRow((row, _n) => {
    const raw = row.getCell(1).value
    if (raw && typeof raw === 'string') {
      const key = normLabel(raw)
      if (!map.has(key)) map.set(key, row)   // first match wins
    }
  })
  return map
}

function getRow(map: Map<string, ExcelJS.Row>, label: string): ExcelJS.Row | undefined {
  return map.get(normLabel(label))
}

// ── Cell value helpers ────────────────────────────────────────────────────────
// ExcelJS may return numbers, strings, Date objects, or formula objects.
function cellNum(row: ExcelJS.Row | undefined, col: number): number {
  if (!row) return 0
  const cell = row.getCell(col)
  const v = cell?.value
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && 'result' in v) return Number((v as any).result) || 0
  if (typeof v === 'string') return parseFloat(v.replace(',', '.')) || 0
  return 0
}

function cellStr(row: ExcelJS.Row | undefined, col: number): string {
  if (!row) return ''
  const cell = row.getCell(col)
  const v = cell?.value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return isoDate(v)
  if (typeof v === 'object' && 'result' in v) return String((v as any).result ?? '')
  return String(v).trim()
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const MONTHS: Record<string, string> = {
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

function parseDate(raw: any): string | null {
  if (!raw) return null
  // ExcelJS Date object
  if (raw instanceof Date) return isoDate(raw)
  const s = String(raw).trim()
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m1) {
    const [, d, mo, y] = m1
    return `${y.length === 2 ? '20' + y : y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  // "Enero 2025" / "enero 2025"
  const m2 = s.match(/^([a-záéíóúüñ]+)\s+(\d{4})$/i)
  if (m2) {
    const mon = MONTHS[m2[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')]
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

// ── Tariff normaliser ─────────────────────────────────────────────────────────
function normTariff(t: string): string {
  if (!t) return ''
  const s = t.trim().replace(/\s/g,'')
  if (/6\.[234]/.test(s)) return '6.1'
  if (s.includes('6.1')) return '6.1'
  if (s.includes('3.0')) return '3.0'
  if (s.includes('2.0')) return '2.0'
  return t.trim()
}

// ── Month column detection ────────────────────────────────────────────────────
// Find the column index for each month based on the header row.
// Returns [colIndex, ...] for columns that have date headers.
function detectMonthCols(ws: ExcelJS.Worksheet, rowMap: Map<string, ExcelJS.Row>): number[] {
  // Strategy 1: look for a "Concepto / Periodo" or similar header row, use month-named columns
  // Strategy 2: look at "Fecha Inicio" row and grab all non-empty columns after col 1
  const fechaRow = getRow(rowMap, 'Fecha Inicio')
  if (fechaRow) {
    const cols: number[] = []
    fechaRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      if (colNum <= 1) return
      const v = cell.value
      if (v !== null && v !== undefined && v !== '') cols.push(colNum)
    })
    if (cols.length > 0) return cols
  }
  // Fallback: scan first row for month headers
  const firstRow = ws.getRow(1)
  const cols: number[] = []
  firstRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    if (colNum <= 1) return
    const s = String(cell.value ?? '').trim().toLowerCase()
    if (Object.keys(MONTHS).some(m => s.startsWith(m)) || /\d{4}/.test(s)) {
      cols.push(colNum)
    }
  })
  return cols
}

// ── Gas sheet detection ───────────────────────────────────────────────────────
// If ANY of these labels appears in column A, the sheet contains gas invoices.
const GAS_LABEL_SET = new Set([
  'impuesto sobre hidrocarburos',
  'termino fijo total',
  'termino fijo diario',
  'consumo m3',
  'tarifa rl',
  'factor conversion',
  'alquiler de contador',
])

function isGasSheet(rowMap: Map<string, ExcelJS.Row>): boolean {
  return Array.from(rowMap.keys()).some(key => GAS_LABEL_SET.has(key))
}

// ── Gas invoice builder ───────────────────────────────────────────────────────
function buildGasInvoices(
  ws: ExcelJS.Worksheet,
  rowMap: Map<string, ExcelJS.Row>,
  monthCols: number[],
  cups: string,
  comercializadora: string,
): any[] {
  const invoices: any[] = []

  for (const col of monthCols) {
    // Dates
    const rawStart = getRow(rowMap, 'Fecha Inicio')?.getCell(col).value
    const rawEnd   = getRow(rowMap, 'Fecha Fin')?.getCell(col).value
    let periodStart = parseDate(rawStart)
    let periodEnd   = parseDate(rawEnd)
    if (periodStart && !periodEnd) periodEnd = lastDayOfMonth(periodStart)
    if (!periodStart) continue

    // GasConsumption
    const consumoKwh = cellNum(getRow(rowMap, 'TOTAL CONSUMO (kWh)'), col)
    const consumoM3  = cellNum(getRow(rowMap, 'Consumo M3'), col)
    const factorConversion = cellNum(getRow(rowMap, 'Factor Conversión'), col)
                          || cellNum(getRow(rowMap, 'Factor Conversion'), col)
    const lecturaAnterior  = cellNum(getRow(rowMap, 'Lectura Anterior'), col)
    const lecturaActual    = cellNum(getRow(rowMap, 'Lectura Actual'), col)
    const tipoLectura      = cellStr(getRow(rowMap, 'Tipo Lectura'), col) || undefined

    // GasPricing
    const precioKwh         = cellNum(getRow(rowMap, 'Precio kWh'), col)
    const terminoFijoDiario = cellNum(getRow(rowMap, 'Término Fijo Diario'), col)
                           || cellNum(getRow(rowMap, 'Termino Fijo Diario'), col)
    const diasFacturados    = cellNum(getRow(rowMap, 'Días Facturados'), col)
                           || cellNum(getRow(rowMap, 'Dias Facturados'), col)
    const terminoFijoTotal  = cellNum(getRow(rowMap, 'Término Fijo Total'), col)
                           || cellNum(getRow(rowMap, 'Termino Fijo Total'), col)
    const impuestoHidrocarbTotal = cellNum(getRow(rowMap, 'Impuesto sobre Hidrocarburos'), col)
    const alquilerTotal     = cellNum(getRow(rowMap, 'Alquiler de Contador'), col)
    const ivaPct            = cellNum(getRow(rowMap, 'IVA %'), col) || 21
    const ivaTotal          = cellNum(getRow(rowMap, 'IVA Total / IVA / IGIC (€)'), col)
                           || cellNum(getRow(rowMap, 'IVA Total'), col)
                           || cellNum(getRow(rowMap, 'IVA (€)'), col)
    const descuentoTerminoFijo = cellNum(getRow(rowMap, 'Descuento Término Fijo'), col)
                              || cellNum(getRow(rowMap, 'Descuento Termino Fijo'), col)
    const descuentoOtros    = cellNum(getRow(rowMap, 'Descuento Otros'), col)

    // Energy cost fields
    const tarifaRL          = cellStr(getRow(rowMap, 'Tarifa RL'), col)
    const costeBrutoConsumo = cellNum(getRow(rowMap, 'Coste Bruto Consumo'), col)
    const descuentoEnergia  = cellNum(getRow(rowMap, 'Descuento Energía'), col)
                           || cellNum(getRow(rowMap, 'Descuento Energia'), col)
    const costeNetoConsumo  = cellNum(getRow(rowMap, 'Coste Neto Consumo'), col)
    const costeTotalConsumo = cellNum(getRow(rowMap, 'TOTAL COSTE CONSUMO (€)'), col) || costeNetoConsumo
    const totalFactura      = cellNum(getRow(rowMap, 'TOTAL FACTURA (€)'), col)

    // Skip empty columns
    if (consumoKwh === 0 && totalFactura === 0) continue

    // Estimated price if not explicit
    const precioKwhFinal = precioKwh || (consumoKwh > 0 && costeNetoConsumo > 0 ? costeNetoConsumo / consumoKwh : 0)
    const precioKwhEstimated = precioKwh === 0 && precioKwhFinal > 0

    const billingPeriod = (() => {
      try { return new Date(periodStart!).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toLowerCase() }
      catch { return periodStart! }
    })()

    invoices.push({
      period_start: periodStart,
      period_end:   periodEnd,
      total_amount: totalFactura || null,
      extracted_data: {
        mode: 'excel_gas',
        energyType: 'gas',
        cups,
        comercializadora,
        tarifaRL: tarifaRL || undefined,
        billing_period: billingPeriod,
        total_amount: totalFactura ? String(totalFactura) : '',
        economics: {
          fechaInicio:  periodStart,
          fechaFin:     periodEnd,
          cups,
          comercializadora,
          tarifa:       tarifaRL || undefined,
          supply_type:  'gas',
          totalFactura,
          consumoTotalKwh:    consumoKwh,
          costeTotalConsumo,
          costeBrutoConsumo:  costeBrutoConsumo || undefined,
          descuentoEnergia:   descuentoEnergia || undefined,
          costeNetoConsumo:   costeNetoConsumo || undefined,
          costeMedioKwhNeto:  consumoKwh > 0 && costeNetoConsumo > 0 ? costeNetoConsumo / consumoKwh : undefined,
          tarifaRL:           tarifaRL || undefined,
          gasConsumption: {
            kwh: consumoKwh,
            m3:  consumoM3 || undefined,
            factorConversion: factorConversion || undefined,
            lecturaAnterior:  lecturaAnterior  || undefined,
            lecturaActual:    lecturaActual    || undefined,
            tipoLectura:      tipoLectura,
          },
          gasPricing: {
            precioKwh:              precioKwhFinal,
            precioKwhEstimated:     precioKwhEstimated,
            terminoFijoDiario:      terminoFijoDiario || 0,
            diasFacturados:         diasFacturados    || 0,
            terminoFijoTotal:       terminoFijoTotal  || 0,
            impuestoHidrocarbTotal: impuestoHidrocarbTotal || 0,
            alquilerTotal:          alquilerTotal     || 0,
            ivaPorcentaje:          ivaPct,
            ivaTotal:               ivaTotal          || 0,
            descuentoTerminoFijo:   descuentoTerminoFijo  || undefined,
            descuentoOtros:         descuentoOtros        || undefined,
          },
        },
      },
    })
  }

  return invoices
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { file_base64 } = await req.json()
    if (!file_base64) return NextResponse.json({ error: 'Missing file_base64' }, { status: 400 })

    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(file_base64, 'base64') as any)

    const worksheets = wb.worksheets.filter(ws => ws.rowCount > 0)
    if (worksheets.length === 0) return NextResponse.json({ error: 'No worksheet found' }, { status: 400 })

    const allResults: any[] = []

    for (const ws of worksheets) {
      try {
        const rowMap = buildRowMap(ws)

        // ── Gas detection: route to gas builder if this is a gas invoice sheet ────
        if (isGasSheet(rowMap)) {
          const gasCups = cellStr(getRow(rowMap, 'CUPS'), 2)
          const gasComRow = getRow(rowMap, 'Compañia')
                         ?? getRow(rowMap, 'Compania')
                         ?? getRow(rowMap, 'Empresa')
                         ?? getRow(rowMap, 'Comercializadora')
                         ?? getRow(rowMap, 'Suministrador')
          const gasComercializadora = cellStr(gasComRow, 2)
          const gasTarifa = cellStr(getRow(rowMap, 'Tarifa RL'), 2)
                         || cellStr(getRow(rowMap, 'Tarifa'), 2)
          const gasMonthCols = detectMonthCols(ws, rowMap)
          if (gasMonthCols.length > 0) {
            const gasInvoices = buildGasInvoices(ws, rowMap, gasMonthCols, gasCups, gasComercializadora)
            allResults.push({ cups: gasCups, tariff: gasTarifa, comercializadora: gasComercializadora, energyType: 'gas', invoices: gasInvoices })
          }
        } else {
          // Electricity sheet
          const cups         = cellStr(getRow(rowMap, 'CUPS'), 2)
          const rawTariff    = cellStr(getRow(rowMap, 'Tarifa'), 2)
          // Comercializadora: try multiple label variants
          const comRow       = getRow(rowMap, 'Compañia')
                            ?? getRow(rowMap, 'Compania')
                            ?? getRow(rowMap, 'Empresa')
                            ?? getRow(rowMap, 'Comercializadora')
                            ?? getRow(rowMap, 'Suministrador')
          const comercializadora = cellStr(comRow, 2)
          const tariff       = normTariff(rawTariff)

          // ── Month columns ─────────────────────────────────────────────────────────
          const monthCols = detectMonthCols(ws, rowMap)
          if (monthCols.length === 0) continue

          // ── Per-month invoices ────────────────────────────────────────────────────
          const invoices: any[] = []

          for (const col of monthCols) {
            const rawStart = getRow(rowMap, 'Fecha Inicio')?.getCell(col).value
            const rawEnd   = getRow(rowMap, 'Fecha Fin')?.getCell(col).value
            let periodStart = parseDate(rawStart)
            let periodEnd   = parseDate(rawEnd)
            if (periodStart && !periodEnd) periodEnd = lastDayOfMonth(periodStart)
            if (!periodStart) continue   // skip columns with no date

            const dias = daysBetween(periodStart, periodEnd!)

            // Potencias P1-P6
            const potencia = []
            for (let p = 1; p <= 6; p++) {
              const pid  = `P${p}`
              const kw         = cellNum(getRow(rowMap, `Potencia ${pid} kw`), col)
                              || cellNum(getRow(rowMap, `Potencia ${pid} (kW)`), col)
              let precioKwDia  = cellNum(getRow(rowMap, `Potencia ${pid} eur kw dia`), col)
                              || cellNum(getRow(rowMap, `Potencia ${pid} (€/kW día)`), col)
                              || cellNum(getRow(rowMap, `Precio potencia ${pid} eur kw dia`), col)
                              || cellNum(getRow(rowMap, `Precio ${pid} eur kw dia`), col)
              const total      = cellNum(getRow(rowMap, `Potencia ${pid} eur`), col)
                              || cellNum(getRow(rowMap, `Potencia ${pid} (€)`), col)
              // Back-calculate price from total when label not matched
              if (precioKwDia === 0 && kw > 0 && total > 0 && dias > 0) {
                precioKwDia = Math.round((total / (kw * dias)) * 100000) / 100000
              }
              if (kw > 0 || total > 0) potencia.push({ periodo: pid, kw, precioKwDia, dias, total })
            }

            // Consumos P1-P6
            const consumo = []
            for (let p = 1; p <= 6; p++) {
              const pid    = `P${p}`
              const kwh    = cellNum(getRow(rowMap, `Consumo ${pid} kwh`), col)
                          || cellNum(getRow(rowMap, `Consumo ${pid} (kWh)`), col)
              let precio   = cellNum(getRow(rowMap, `Precio ${pid} eur kwh`), col)
                          || cellNum(getRow(rowMap, `Precio ${pid} (€/kWh)`), col)
                          || cellNum(getRow(rowMap, `Precio energia ${pid} eur kwh`), col)
                          || cellNum(getRow(rowMap, `Energia ${pid} eur kwh`), col)
              // Try explicit consumo total row for this period
              const totalExplicit = cellNum(getRow(rowMap, `Consumo ${pid} eur`), col)
                                 || cellNum(getRow(rowMap, `Consumo ${pid} (€)`), col)
                                 || cellNum(getRow(rowMap, `Coste consumo ${pid} eur`), col)
              // Back-calculate price from total when label not matched
              if (precio === 0 && kwh > 0 && totalExplicit > 0) {
                precio = Math.round((totalExplicit / kwh) * 100000) / 100000
              }
              const total  = totalExplicit || (kwh > 0 && precio > 0 ? Math.round(kwh * precio * 100) / 100 : 0)
              if (kwh > 0) consumo.push({ periodo: pid, kwh, precioKwh: precio, total })
            }

            // Totals
            const consumoTotalKwh    = cellNum(getRow(rowMap, 'TOTAL CONSUMO (kWh)'), col)
                                    || cellNum(getRow(rowMap, 'total consumo kwh'), col)
                                    || consumo.reduce((s, c) => s + c.kwh, 0)
            const costeTotalConsumo  = cellNum(getRow(rowMap, 'TOTAL COSTE CONSUMO (€)'), col)
                                    || cellNum(getRow(rowMap, 'total coste consumo eur'), col)
                                    || consumo.reduce((s, c) => s + c.total, 0)
            const costeTotalPotencia = cellNum(getRow(rowMap, 'TOTAL COSTE POTENCIA (€)'), col)
                                    || cellNum(getRow(rowMap, 'total coste potencia eur'), col)
                                    || potencia.reduce((s, p) => s + p.total, 0)
            const totalFactura       = cellNum(getRow(rowMap, 'TOTAL FACTURA (€)'), col)
                                    || cellNum(getRow(rowMap, 'total factura eur'), col)

            // Skip month if all zeros
            if (consumoTotalKwh === 0 && costeTotalConsumo === 0 && costeTotalPotencia === 0 && totalFactura === 0) continue

            // Human-readable billing period label
            const billingPeriod = (() => {
              try { return new Date(periodStart!).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toLowerCase() }
              catch { return periodStart! }
            })()

            invoices.push({
              period_start: periodStart,
              period_end:   periodEnd,
              total_amount: totalFactura || null,
              extracted_data: {
                mode: 'gemini',
                cups,
                comercializadora,
                tariff,
                billing_period: billingPeriod,
                total_amount: totalFactura ? String(totalFactura) : '',
                economics: {
                  fechaInicio: periodStart,
                  fechaFin:    periodEnd,
                  comercializadora,
                  cups,
                  tarifa: tariff,
                  potencia,
                  consumo,
                  consumoTotalKwh,
                  costeTotalConsumo,
                  costeTotalPotencia,
                  totalFactura,
                },
              },
            })
          }
          if (invoices.length > 0) {
            allResults.push({ cups, tariff, comercializadora, energyType: 'electricity', invoices })
          }
        }
      } catch (e) {
        console.error('[parse-excel-invoices] sheet error:', e)
        continue
      }
    }

    if (allResults.length === 0) return NextResponse.json({ error: 'No valid data found in any sheet' }, { status: 400 })

    // Backward compatible: single sheet returns flat structure
    if (allResults.length === 1) {
      return NextResponse.json({ ...allResults[0] })
    }

    // Multi-sheet: return results array
    return NextResponse.json({ multiSupply: true, results: allResults, count: allResults.length })

  } catch (err: any) {
    console.error('[parse-excel-invoices]', err)
    return NextResponse.json({ error: err.message || 'Error parsing Excel' }, { status: 500 })
  }
}
