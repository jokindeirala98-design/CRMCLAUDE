import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

// ── Label normaliser ──────────────────────────────────────────────────────────
// Strips accents, normalises punctuation, handles currency symbols and units.
// e.g.  "Potencia P1 (kW)"        → "potencia p1 kw"
//       "Potencia P1 (€/kW·día)"  → "potencia p1 eur kw dia"
//       "Potencia P1 (€)"         → "potencia p1 eur"
//       "Consumo P1 (Punta)"      → "consumo p1 punta"
//       "€/kW·año"                → "eur kw ano"
function normLabel(s: string): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (á→a, ó→o …)
    .replace(/[€]/g, 'eur')                            // € → eur
    .replace(/[()]/g, ' ')                              // parentheses → space (keeps content)
    .replace(/[/\-*·•]/g, ' ')                          // / - * · • → space
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Row lookup by label (col A) ───────────────────────────────────────────────
// Build a cache { normLabel(colA) → row }.  First match wins (handles most sheets).
function buildRowMap(ws: ExcelJS.Worksheet): Map<string, ExcelJS.Row> {
  const map = new Map<string, ExcelJS.Row>()
  ws.eachRow((row, _n) => {
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

// ── Unit-qualified row lookup (col A + col B) ─────────────────────────────────
// Handles formats where the same col-A label repeats with different units in col B.
// Example (Ayuntamiento-style Excel):
//   row N:    colA="Potencia P1 (Punta)"  colB="kW"       → contracted power
//   row N+1:  colA="Potencia P1 (Punta)"  colB="€"        → total cost
//   row N+2:  colA="Potencia P1 (Punta)"  colB="€/kW·día" → price/kW·day
// Key: normLabel(colA) + '§' + normLabel(colB)
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

// Get a row by its (label, unit) pair from the unit-qualified map.
function getRowU(
  umap: Map<string, ExcelJS.Row>,
  label: string,
  unit: string,
): ExcelJS.Row | undefined {
  return umap.get(`${normLabel(label)}§${normLabel(unit)}`)
}

// ── Spanish period name aliases ───────────────────────────────────────────────
// Some Excel templates embed Spanish period names in row labels instead of P1/P2 codes.
const PNAME_ES: Record<string, string[]> = {
  P1: ['Punta'],
  P2: ['Llano', 'Valle'],  // Algunas plantillas (Estella 2.0TD) etiquetan potencia P2 como "Valle"
  P3: ['Valle'],
  P4: ['Valle', 'Supervalle'],
  P5: ['Supervalle', 'Super Valle'],
  P6: ['Supervalle', 'Super Valle', 'Nocturno'],
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
  const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m1) {
    const [, d, mo, y] = m1
    return `${y.length === 2 ? '20' + y : y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  // "Enero 2025" / "enero 2025"
  const m2 = s.match(/^([a-záéíóúüñ]+)\s+(\d{4})$/i)
  if (m2) {
    const mon = MONTHS[m2[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')]
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
  // Strategy 1: look for a "Fecha Inicio" row, use all non-empty columns after col 1
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

// ── Electricity: extract potencia for one period ──────────────────────────────
// Tries many label variants and normalises prices to €/kW·día regardless of
// whether the source invoice stores them per day, per month or per year.
function extractPotenciaPeriod(
  pid: string,
  col: number,
  dias: number,
  rowMap: Map<string, ExcelJS.Row>,
  umap: Map<string, ExcelJS.Row>,
): { periodo: string; kw: number; precioKwDia: number; dias: number; total: number } | null {
  const pnames = PNAME_ES[pid] ?? []

  // ── kW contracted ──────────────────────────────────────────────────────────
  let kw = cellNum(getRow(rowMap, `Potencia ${pid} kw`), col)
         || cellNum(getRow(rowMap, `Potencia ${pid} (kW)`), col)
  if (!kw) {
    for (const pn of pnames) {
      kw = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, 'kW'), col)
         || cellNum(getRowU(umap, `Potencia ${pid} ${pn}`, 'kW'), col)
         || cellNum(getRowU(umap, `Termino potencia ${pid} (${pn})`, 'kW'), col)
      if (kw) break
    }
  }

  // ── Total € ────────────────────────────────────────────────────────────────
  // First try explicit total labels, then unit-qualified with Spanish names,
  // then sum of peajes + cargos totals.
  let total = cellNum(getRow(rowMap, `Potencia ${pid} eur`), col)
            || cellNum(getRow(rowMap, `Potencia ${pid} (€)`), col)
  if (!total) {
    for (const pn of pnames) {
      total = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€'), col)
            || cellNum(getRowU(umap, `Potencia ${pid} ${pn}`, '€'), col)
            || cellNum(getRowU(umap, `Termino potencia ${pid} (${pn})`, '€'), col)
      if (total) break
    }
  }
  if (!total) {
    // Try sum of peaje + cargo totals
    let tPeaje = cellNum(getRow(rowMap, `Potencia ${pid} peajes eur`), col)
               || cellNum(getRow(rowMap, `Potencia ${pid} peajes (€)`), col)
    let tCargo  = cellNum(getRow(rowMap, `Potencia ${pid} cargos eur`), col)
               || cellNum(getRow(rowMap, `Potencia ${pid} cargos (€)`), col)
    if (!tPeaje || !tCargo) {
      for (const pn of pnames) {
        tPeaje = tPeaje
               || cellNum(getRowU(umap, `Potencia ${pid} (${pn}) Peajes`, '€'), col)
               || cellNum(getRowU(umap, `Peajes Potencia ${pid} (${pn})`, '€'), col)
               || cellNum(getRowU(umap, `Termino potencia peajes ${pid} (${pn})`, '€'), col)
        tCargo  = tCargo
               || cellNum(getRowU(umap, `Potencia ${pid} (${pn}) Cargos`, '€'), col)
               || cellNum(getRowU(umap, `Cargos Potencia ${pid} (${pn})`, '€'), col)
               || cellNum(getRowU(umap, `Termino potencia cargos ${pid} (${pn})`, '€'), col)
        if (tPeaje || tCargo) break
      }
    }
    if (tPeaje > 0 || tCargo > 0) total = tPeaje + tCargo
  }

  // ── Price €/kW·día ─────────────────────────────────────────────────────────
  // Priority: direct per-day → per-day via unit-qualified → peaje+cargo per-day
  //           → annual (÷365) → monthly (÷dias) → back-calc from total
  let precioKwDia = cellNum(getRow(rowMap, `Potencia ${pid} eur kw dia`), col)
                  || cellNum(getRow(rowMap, `Potencia ${pid} (€/kW día)`), col)
                  || cellNum(getRow(rowMap, `Precio potencia ${pid} eur kw dia`), col)
                  || cellNum(getRow(rowMap, `Precio ${pid} eur kw dia`), col)

  // Unit-qualified per-day with Spanish period names
  if (!precioKwDia) {
    for (const pn of pnames) {
      precioKwDia = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW día'), col)
                  || cellNum(getRowU(umap, `Potencia ${pid} ${pn}`, '€/kW día'), col)
                  || cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW·día'), col)
                  || cellNum(getRowU(umap, `Termino potencia ${pid} (${pn})`, '€/kW día'), col)
      if (precioKwDia) break
    }
  }

  // Split peajes + cargos per-day
  if (!precioKwDia) {
    let peaje = cellNum(getRow(rowMap, `Potencia ${pid} peajes eur kw dia`), col)
              || cellNum(getRow(rowMap, `Potencia ${pid} peajes (€/kW día)`), col)
              || cellNum(getRow(rowMap, `Peaje potencia ${pid} eur kw dia`), col)
              || cellNum(getRow(rowMap, `Potencia peajes ${pid} eur kw dia`), col)
              || cellNum(getRow(rowMap, `Termino potencia peajes ${pid} eur kw dia`), col)
    let cargo  = cellNum(getRow(rowMap, `Potencia ${pid} cargos eur kw dia`), col)
              || cellNum(getRow(rowMap, `Potencia ${pid} cargos (€/kW día)`), col)
              || cellNum(getRow(rowMap, `Cargo potencia ${pid} eur kw dia`), col)
              || cellNum(getRow(rowMap, `Potencia cargos ${pid} eur kw dia`), col)
              || cellNum(getRow(rowMap, `Termino potencia cargos ${pid} eur kw dia`), col)
    if (!peaje || !cargo) {
      for (const pn of pnames) {
        peaje = peaje
              || cellNum(getRowU(umap, `Potencia ${pid} (${pn}) Peajes`, '€/kW día'), col)
              || cellNum(getRowU(umap, `Peajes Potencia ${pid} (${pn})`, '€/kW día'), col)
              || cellNum(getRowU(umap, `Termino potencia peajes ${pid} (${pn})`, '€/kW día'), col)
              || cellNum(getRowU(umap, `Potencia ${pid} (${pn}) Peajes`, '€/kW·día'), col)
              || cellNum(getRowU(umap, `Peajes Potencia ${pid} (${pn})`, '€/kW·día'), col)
        cargo  = cargo
              || cellNum(getRowU(umap, `Potencia ${pid} (${pn}) Cargos`, '€/kW día'), col)
              || cellNum(getRowU(umap, `Cargos Potencia ${pid} (${pn})`, '€/kW día'), col)
              || cellNum(getRowU(umap, `Termino potencia cargos ${pid} (${pn})`, '€/kW día'), col)
              || cellNum(getRowU(umap, `Potencia ${pid} (${pn}) Cargos`, '€/kW·día'), col)
              || cellNum(getRowU(umap, `Cargos Potencia ${pid} (${pn})`, '€/kW·día'), col)
        if (peaje || cargo) break
      }
    }
    if (peaje > 0 || cargo > 0) precioKwDia = peaje + cargo
  }

  // Annual price (€/kW·año) → divide by 365
  if (!precioKwDia) {
    let precioAnual = cellNum(getRow(rowMap, `Potencia ${pid} eur kw ano`), col)
                    || cellNum(getRow(rowMap, `Precio potencia ${pid} eur kw ano`), col)
                    || cellNum(getRow(rowMap, `Potencia ${pid} (€/kW año)`), col)
    if (!precioAnual) {
      for (const pn of pnames) {
        precioAnual = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW año'), col)
                    || cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW·año'), col)
                    || cellNum(getRowU(umap, `Potencia ${pid} ${pn}`, '€/kW año'), col)
        if (precioAnual) break
      }
    }
    if (precioAnual > 0) precioKwDia = Math.round((precioAnual / 365) * 1000000) / 1000000
  }

  // Monthly price (€/kW·mes) → divide by number of days in period
  if (!precioKwDia && dias > 0) {
    let precioMes = cellNum(getRow(rowMap, `Potencia ${pid} eur kw mes`), col)
                  || cellNum(getRow(rowMap, `Precio potencia ${pid} eur kw mes`), col)
                  || cellNum(getRow(rowMap, `Potencia ${pid} (€/kW mes)`), col)
    if (!precioMes) {
      for (const pn of pnames) {
        precioMes = cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW mes'), col)
                  || cellNum(getRowU(umap, `Potencia ${pid} (${pn})`, '€/kW·mes'), col)
                  || cellNum(getRowU(umap, `Potencia ${pid} ${pn}`, '€/kW mes'), col)
        if (precioMes) break
      }
    }
    if (precioMes > 0) precioKwDia = Math.round((precioMes / dias) * 1000000) / 1000000
  }

  // Back-calculate from total when all price lookups failed
  if (!precioKwDia && kw > 0 && total > 0 && dias > 0) {
    precioKwDia = Math.round((total / (kw * dias)) * 100000) / 100000
  }

  if (kw === 0 && total === 0) return null
  return { periodo: pid, kw, precioKwDia, dias, total }
}

// ── Electricity: extract consumo for one period ───────────────────────────────
// precioHorario: the uniform commercial/market price (€/kWh) that applies equally
// to all kWh regardless of period.  In some invoices (e.g. Endesa, Naturgy) this
// appears as "Energía Precio horario" and is ADDED to the per-period peaje + cargo
// to produce the full price.  When the price is extracted from a single direct
// label it is already complete; precioHorario is only added to split prices.
function extractConsumoPeriod(
  pid: string,
  col: number,
  rowMap: Map<string, ExcelJS.Row>,
  umap: Map<string, ExcelJS.Row>,
  precioHorario: number,   // 0 when not present in this sheet
): { periodo: string; kwh: number; precioKwh: number; total: number } | null {
  const pnames = PNAME_ES[pid] ?? []

  // ── kWh consumed ───────────────────────────────────────────────────────────
  // Try dedicated Consumo rows first, then fall back to kWh from peaje rows
  // (some invoice-derived Excels store consumption only alongside access tariffs)
  let kwh = cellNum(getRow(rowMap, `Consumo ${pid} kwh`), col)
           || cellNum(getRow(rowMap, `Consumo ${pid} (kWh)`), col)
  if (!kwh) {
    for (const pn of pnames) {
      kwh = cellNum(getRowU(umap, `Consumo ${pid} (${pn})`, 'kWh'), col)
           || cellNum(getRowU(umap, `Consumo ${pid} ${pn}`, 'kWh'), col)
           || cellNum(getRowU(umap, `Energia ${pid} (${pn})`, 'kWh'), col)
           // From peaje rows (invoice format: "Energía facturada peajes P1 (Punta)")
           || cellNum(getRowU(umap, `Energia facturada peajes ${pid} (${pn})`, 'kWh'), col)
           || cellNum(getRowU(umap, `Energia facturada peajes ${pid} ${pn}`, 'kWh'), col)
      if (kwh) break
    }
  }
  // Last resort: kWh from peaje rows without Spanish names
  if (!kwh) {
    kwh = cellNum(getRow(rowMap, `Energia facturada peajes ${pid} kwh`), col)
         || cellNum(getRowU(umap, `Energia facturada peajes ${pid}`, 'kWh'), col)
  }

  // ── Price €/kWh ────────────────────────────────────────────────────────────
  // Strategy A: direct complete price (already includes all components).
  //             → Do NOT add precioHorario on top.
  let precioDirecto = cellNum(getRow(rowMap, `Precio ${pid} eur kwh`), col)
                    || cellNum(getRow(rowMap, `Precio ${pid} (€/kWh)`), col)
                    || cellNum(getRow(rowMap, `Precio energia ${pid} eur kwh`), col)
                    || cellNum(getRow(rowMap, `Energia ${pid} eur kwh`), col)
  if (!precioDirecto) {
    for (const pn of pnames) {
      precioDirecto = cellNum(getRowU(umap, `Precio ${pid} (${pn})`, '€/kWh'), col)
                    || cellNum(getRowU(umap, `Precio ${pid} ${pn}`, '€/kWh'), col)
                    || cellNum(getRowU(umap, `Precio energia ${pid} (${pn})`, '€/kWh'), col)
                    || cellNum(getRowU(umap, `Energia ${pid} (${pn})`, '€/kWh'), col)
      if (precioDirecto) break
    }
  }

  // Strategy B: split peaje + cargo price.
  //             → ADD precioHorario when present (horario + peaje + cargo = full price).
  let peaje = 0, cargo = 0
  if (!precioDirecto) {
    peaje = cellNum(getRow(rowMap, `Precio ${pid} peajes eur kwh`), col)
           || cellNum(getRow(rowMap, `Energia peajes ${pid} eur kwh`), col)
           || cellNum(getRow(rowMap, `Energia facturada peajes ${pid} eur kwh`), col)
           || cellNum(getRow(rowMap, `Energia facturada peajes ${pid}`), col)
           || cellNum(getRow(rowMap, `Termino energia peajes ${pid} eur kwh`), col)
    cargo  = cellNum(getRow(rowMap, `Precio ${pid} cargos eur kwh`), col)
           || cellNum(getRow(rowMap, `Energia cargos ${pid} eur kwh`), col)
           || cellNum(getRow(rowMap, `Energia facturada cargos ${pid} eur kwh`), col)
           || cellNum(getRow(rowMap, `Energia facturada cargos ${pid}`), col)
           || cellNum(getRow(rowMap, `Termino energia cargos ${pid} eur kwh`), col)
    for (const pn of pnames) {
      peaje = peaje
             || cellNum(getRowU(umap, `Energia facturada peajes ${pid} (${pn})`, '€/kWh'), col)
             || cellNum(getRowU(umap, `Energia peajes ${pid} (${pn})`, '€/kWh'), col)
             || cellNum(getRowU(umap, `Precio ${pid} (${pn}) Peajes`, '€/kWh'), col)
      cargo  = cargo
             || cellNum(getRowU(umap, `Energia facturada cargos ${pid} (${pn})`, '€/kWh'), col)
             || cellNum(getRowU(umap, `Energia facturada (cargos) ${pid} (${pn})`, '€/kWh'), col)
             || cellNum(getRowU(umap, `Energia cargos ${pid} (${pn})`, '€/kWh'), col)
             || cellNum(getRowU(umap, `Precio ${pid} (${pn}) Cargos`, '€/kWh'), col)
      if (peaje || cargo) break
    }
  }

  // Compute final price
  let precio: number
  if (precioDirecto > 0) {
    // Complete price — horario already included (or not applicable)
    precio = precioDirecto
  } else if (peaje > 0 || cargo > 0) {
    // Partial price — add the uniform horario component
    precio = (precioHorario || 0) + peaje + cargo
  } else {
    precio = 0
  }

  // ── Total € for this period ────────────────────────────────────────────────
  let totalExplicit = cellNum(getRow(rowMap, `Consumo ${pid} eur`), col)
                    || cellNum(getRow(rowMap, `Consumo ${pid} (€)`), col)
                    || cellNum(getRow(rowMap, `Coste consumo ${pid} eur`), col)
  if (!totalExplicit) {
    for (const pn of pnames) {
      totalExplicit = cellNum(getRowU(umap, `Consumo ${pid} (${pn})`, '€'), col)
                    || cellNum(getRowU(umap, `Energia ${pid} (${pn})`, '€'), col)
                    || cellNum(getRowU(umap, `Coste consumo ${pid} (${pn})`, '€'), col)
      if (totalExplicit) break
    }
  }

  // Back-calculate price from total when all price lookups failed
  if (!precio && kwh > 0 && totalExplicit > 0) {
    precio = Math.round((totalExplicit / kwh) * 100000) / 100000
  }

  const total = totalExplicit || (kwh > 0 && precio > 0 ? Math.round(kwh * precio * 100) / 100 : 0)
  if (kwh === 0) return null
  return { periodo: pid, kwh, precioKwh: precio, total }
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

          // Build unit-qualified map once (handles duplicate row labels with different units)
          const umap = buildRowMapByUnit(ws)

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

            // ── Precio horario (uniform commercial price, same for all kWh) ────────
            // Some invoices (Endesa "Precio horario", Naturgy, etc.) show a single
            // energy price that applies to all periods, then add per-period access
            // tariff (peaje ATR) and regulatory charges (cargos) on top.
            // Full price per period = horario + peaje_P + cargo_P.
            const precioHorario = cellNum(getRow(rowMap, 'Precio Horario'), col)
                                || cellNum(getRow(rowMap, 'Energia Precio Horario'), col)
                                || cellNum(getRow(rowMap, 'Precio Energia Horario'), col)
                                || cellNum(getRow(rowMap, 'Precio horario energia'), col)
                                || cellNum(getRowU(umap, 'Energia Precio horario', '€/kWh'), col)
                                || cellNum(getRowU(umap, 'Precio horario', '€/kWh'), col)
                                || cellNum(getRow(rowMap, 'Precio energia mercado'), col)
                                || cellNum(getRow(rowMap, 'Precio mercado'), col)

            // ── Potencias P1–P6 ───────────────────────────────────────────────────
            const potencia: any[] = []
            for (let p = 1; p <= 6; p++) {
              const entry = extractPotenciaPeriod(`P${p}`, col, dias, rowMap, umap)
              if (entry) potencia.push(entry)
            }

            // ── Consumos P1–P6 ────────────────────────────────────────────────────
            const consumo: any[] = []
            for (let p = 1; p <= 6; p++) {
              const entry = extractConsumoPeriod(`P${p}`, col, rowMap, umap, precioHorario)
              if (entry) consumo.push(entry)
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
