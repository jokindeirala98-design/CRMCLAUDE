import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { calcularComparativa } from '@/lib/comparativas/calcular'
import { TARIFAS_GANA_2_0TD, BONO_SOCIAL_MES, IMPUESTO_ELECTRICO_PCT } from '@/lib/comparativas/tarifas-gana'

// ── Helpers de estilo ─────────────────────────────────────────────────────────

type CellRef = ExcelJS.Cell

function bg(cell: CellRef, hex: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } }
}
function bold(cell: CellRef, size = 11) {
  cell.font = { bold: true, size, color: { argb: 'FF000000' } }
}
function colFont(cell: CellRef, argb: string, sz = 11, isBold = false) {
  cell.font = { bold: isBold, size: sz, color: { argb } }
}
function center(cell: CellRef) {
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
}
function right(cell: CellRef) {
  cell.alignment = { horizontal: 'right', vertical: 'middle' }
}
function numFmt(cell: CellRef, fmt: string) {
  cell.numFmt = fmt
}
function border(ws: ExcelJS.Worksheet, row: number, c1: number, c2: number) {
  for (let c = c1; c <= c2; c++) {
    const cell = ws.getCell(row, c)
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    }
  }
}

// ── Columnas ──────────────────────────────────────────────────────────────────
// Col 1 = etiqueta, 2 = actual, 3 = 24H, 4 = tramos, 5 = mercado

const COL = { label: 1, actual: 2, h24: 3, tramos: 4, mercado: 5 }
const HEADER_ARGB = ['FF1B5E35', 'FF37474F', 'FF1B5E35', 'FF1565C0', 'FF6A1B9A']

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    input,
    cliente = {},
    preciosActuales = null,
    extras = [] as Array<{ concepto: string; importeAnual: number }>,
  } = body

  // ── Cálculo ────────────────────────────────────────────────────────────────
  const resultado = calcularComparativa(input)
  const [mercado, h24, tramos] = [
    resultado.resultados.find((r) => r.tarifa.slug === '2.0TD_Sin_mas')!,
    resultado.resultados.find((r) => r.tarifa.slug === '2.0TD_Online')!,
    resultado.resultados.find((r) => r.tarifa.slug === '2.0TD_Precio_estable')!,
  ]

  const totalActual: number = input.totalFacturaActual ?? 0
  const dias: number = input.dias ?? 365
  const meses = dias / 30

  const totalExtrasActual = (extras as Array<{ importeAnual: number }>)
    .reduce((s, e) => s + (e.importeAnual ?? 0), 0)

  // ── Workbook ───────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Voltis Energía'
  wb.created = new Date()

  const ws = wb.addWorksheet('Comparativa 2.0TD', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 18 },
  })

  // Anchos de columna
  ws.getColumn(COL.label).width = 36
  ws.getColumn(COL.actual).width = 20
  ws.getColumn(COL.h24).width = 20
  ws.getColumn(COL.tramos).width = 20
  ws.getColumn(COL.mercado).width = 20

  let r = 1

  // ── Fila 1: título ─────────────────────────────────────────────────────────
  ws.mergeCells(r, 1, r, 5)
  const titleCell = ws.getCell(r, 1)
  titleCell.value = 'COMPARATIVA DE TARIFAS ELÉCTRICAS 2.0TD — VOLTIS ENERGÍA'
  titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E35' } }
  ws.getRow(r).height = 30
  r++

  // ── Fila 2: info cliente ───────────────────────────────────────────────────
  ws.getCell(r, 1).value = cliente.clientName
    ? `Cliente: ${cliente.clientName}`
    : 'Cliente: —'
  ws.getCell(r, 1).font = { size: 10, color: { argb: 'FF455A64' } }
  ws.getCell(r, 2).value = cliente.cups ? `CUPS: ${cliente.cups}` : ''
  ws.getCell(r, 2).font = { size: 10, italic: true, color: { argb: 'FF455A64' } }
  ws.mergeCells(r, 2, r, 3)
  ws.getCell(r, 4).value = `Fecha: ${new Date().toLocaleDateString('es-ES')}`
  ws.getCell(r, 4).font = { size: 10, color: { argb: 'FF455A64' } }
  ws.getCell(r, 4).alignment = { horizontal: 'right' }
  ws.mergeCells(r, 4, r, 5)
  ws.getRow(r).height = 20
  r++

  // ── Fila 3: espacio ────────────────────────────────────────────────────────
  r++

  // ── Fila 4: cabecera de columnas ───────────────────────────────────────────
  const colHeaders = ['Concepto', 'Tarifa Actual', 'Gana 24H', 'Gana Tramos Horarios', 'Gana Precio Mercado']
  const tarNames = ['', h24.tarifa.nombre, h24.tarifa.nombre, tramos.tarifa.nombre, mercado.tarifa.nombre]
  for (let c = 1; c <= 5; c++) {
    const cell = ws.getCell(r, c)
    cell.value = colHeaders[c - 1]
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB[c - 1] } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
    }
  }
  ws.getRow(r).height = 28
  r++

  // ─── helper: addSection ───────────────────────────────────────────────────
  const addSection = (title: string) => {
    ws.mergeCells(r, 1, r, 5)
    const c = ws.getCell(r, 1)
    c.value = title
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF455A64' } }
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    ws.getRow(r).height = 20
    r++
  }

  // helper: addRow — añade una fila de datos
  const addRow = (
    label: string,
    vals: [unknown, unknown, unknown, unknown],
    fmt = '€#,##0.00',
    isLabel = false,
    isTotalRow = false,
  ) => {
    const cell0 = ws.getCell(r, 1)
    cell0.value = label
    cell0.font = { size: 10, bold: isTotalRow, color: { argb: isTotalRow ? 'FF1565C0' : 'FF212121' } }
    cell0.alignment = { horizontal: 'left', vertical: 'middle', indent: isLabel ? 0 : 1 }
    if (isTotalRow) {
      cell0.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE8F4' } }
    }

    const colNums = [COL.actual, COL.h24, COL.tramos, COL.mercado]
    const bgArgbs = ['FFFAFAFA', 'FFE8F5E9', 'FFE3F2FD', 'FFFFF8E1']
    for (let i = 0; i < 4; i++) {
      const cell = ws.getCell(r, colNums[i])
      const val = vals[i]
      if (val === null || val === undefined || val === '—') {
        cell.value = val === '—' ? '—' : null
      } else {
        cell.value = val as ExcelJS.CellValue
        if (!isLabel && typeof val === 'number') {
          cell.numFmt = fmt
        }
      }
      cell.font = { size: 10, bold: isTotalRow, color: { argb: isTotalRow ? 'FF1565C0' : 'FF000000' } }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isTotalRow ? 'FFDDE8F4' : bgArgbs[i] } }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } }
    }
    ws.getRow(r).height = 18
    r++
  }

  // ─── SECCIÓN 1: POTENCIA ──────────────────────────────────────────────────
  addSection('▸ POTENCIA (€/kW·día × kW × días)')

  const p1 = input.potencias.p1 as number
  const p2 = input.potencias.p2 as number

  addRow('P1 Punta (kW)', [p1, p1, p1, p1], '0.000')
  addRow('P2 Valle (kW)', [p2, p2, p2, p2], '0.000')
  addRow('Días facturación', [dias, dias, dias, dias], '0')

  // Precios de potencia — actual si disponible, sino "—"
  const ap1 = preciosActuales?.kwDia?.p1 ?? null
  const ap2 = preciosActuales?.kwDia?.p2 ?? null
  addRow('Precio P1 (€/kW·día)', [
    ap1 ?? '—',
    h24.tarifa.kwDia.p1,
    tramos.tarifa.kwDia.p1,
    mercado.tarifa.kwDia.p1,
  ], '0.000000')
  addRow('Precio P2 (€/kW·día)', [
    ap2 ?? '—',
    h24.tarifa.kwDia.p2,
    tramos.tarifa.kwDia.p2,
    mercado.tarifa.kwDia.p2,
  ], '0.000000')

  // Costes de potencia
  const apCosteP1 = ap1 ? p1 * dias * ap1 : null
  const apCosteP2 = ap2 ? p2 * dias * ap2 : null
  addRow('Coste P1 (€)', [
    apCosteP1 ?? '—',
    h24.costePotencia.p1,
    tramos.costePotencia.p1,
    mercado.costePotencia.p1,
  ])
  addRow('Coste P2 (€)', [
    apCosteP2 ?? '—',
    h24.costePotencia.p2,
    tramos.costePotencia.p2,
    mercado.costePotencia.p2,
  ])
  const totalPoAct = (apCosteP1 ?? 0) + (apCosteP2 ?? 0)
  addRow('TOTAL POTENCIA (€)', [
    ap1 && ap2 ? totalPoAct : '—',
    h24.costePotencia.total,
    tramos.costePotencia.total,
    mercado.costePotencia.total,
  ], '€#,##0.00', false, true)

  // ─── SECCIÓN 2: ENERGÍA ───────────────────────────────────────────────────
  addSection('▸ ENERGÍA (€/kWh × kWh)')

  const ep = input.energias.punta as number
  const el = input.energias.llano as number
  const ev = input.energias.valle as number

  addRow('Consumo Punta / P1 (kWh)', [ep, ep, ep, ep], '#,##0')
  addRow('Consumo Llano / P2 (kWh)', [el, el, el, el], '#,##0')
  addRow('Consumo Valle / P3 (kWh)', [ev, ev, ev, ev], '#,##0')
  addRow('Total consumo (kWh)', [ep + el + ev, ep + el + ev, ep + el + ev, ep + el + ev], '#,##0')

  const aep = preciosActuales?.kwh?.punta ?? null
  const ael = preciosActuales?.kwh?.llano ?? null
  const aev = preciosActuales?.kwh?.valle ?? null
  addRow('Precio Punta (€/kWh)', [
    aep ?? '—',
    h24.tarifa.kwh.punta,
    tramos.tarifa.kwh.punta,
    mercado.tarifa.kwh.punta,
  ], '0.0000')
  addRow('Precio Llano (€/kWh)', [
    ael ?? '—',
    h24.tarifa.kwh.llano,
    tramos.tarifa.kwh.llano,
    mercado.tarifa.kwh.llano,
  ], '0.0000')
  addRow('Precio Valle (€/kWh)', [
    aev ?? '—',
    h24.tarifa.kwh.valle,
    tramos.tarifa.kwh.valle,
    mercado.tarifa.kwh.valle,
  ], '0.0000')

  const acostePunta = aep ? ep * aep : null
  const acosteLlano = ael ? el * ael : null
  const acosteValle = aev ? ev * aev : null
  addRow('Coste Punta (€)', [acostePunta ?? '—', h24.costeEnergia.punta, tramos.costeEnergia.punta, mercado.costeEnergia.punta])
  addRow('Coste Llano (€)', [acosteLlano ?? '—', h24.costeEnergia.llano, tramos.costeEnergia.llano, mercado.costeEnergia.llano])
  addRow('Coste Valle (€)', [acosteValle ?? '—', h24.costeEnergia.valle, tramos.costeEnergia.valle, mercado.costeEnergia.valle])

  const totalEnAct = acostePunta && acosteLlano && acosteValle
    ? acostePunta + acosteLlano + acosteValle : null
  addRow('TOTAL ENERGÍA (€)', [
    totalEnAct ?? '—',
    h24.costeEnergia.total,
    tramos.costeEnergia.total,
    mercado.costeEnergia.total,
  ], '€#,##0.00', false, true)

  // ─── SECCIÓN 3: OTROS COSTES REGULADOS ────────────────────────────────────
  addSection('▸ OTROS COSTES REGULADOS')

  const bonoLabel = `Bono Social (${(BONO_SOCIAL_MES * meses).toFixed(2)} €)`
  const impLabel = `Impuesto Eléctrico (${(IMPUESTO_ELECTRICO_PCT * 100).toFixed(2)} %)`

  addRow(bonoLabel, ['—', h24.bonoSocial, tramos.bonoSocial, mercado.bonoSocial])
  addRow(impLabel, ['—', h24.impuestoElectrico, tramos.impuestoElectrico, mercado.impuestoElectrico])
  addRow('Servicio Gana Energía (€)', ['—', '—', '—', mercado.servicioGanaEnergia])
  addRow(`IVA (${input.ivaPct} %)`, ['—', h24.iva, tramos.iva, mercado.iva])

  // ─── SECCIÓN 4: EXTRAS / SERVICIOS ACTUALES ───────────────────────────────
  if ((extras as Array<unknown>).length > 0) {
    addSection('▸ EXTRAS Y SERVICIOS OPCIONALES (actuales)')
    for (const ex of extras as Array<{ concepto: string; importeAnual: number }>) {
      addRow(ex.concepto, [ex.importeAnual, 0, 0, 0])
    }
    addRow('TOTAL EXTRAS (€)', [totalExtrasActual, 0, 0, 0], '€#,##0.00', false, true)
  }

  // ─── SECCIÓN 5: ALQUILER ─────────────────────────────────────────────────
  if ((input.alquiler ?? 0) > 0) {
    addSection('▸ ALQUILER DE EQUIPO')
    addRow('Alquiler de contador/equipo (€)', [
      input.alquiler,
      h24.alquiler,
      tramos.alquiler,
      mercado.alquiler,
    ])
  }

  // ─── SECCIÓN 6: TOTALES ───────────────────────────────────────────────────
  addSection('▸ RESUMEN TOTAL')

  addRow('Total sin IVA (€)', ['—', h24.totalSinIva, tramos.totalSinIva, mercado.totalSinIva])
  addRow('TOTAL ANUAL CON IVA (€)', [totalActual, h24.total, tramos.total, mercado.total], '€#,##0.00', false, true)
  addRow('+ Extras actuales (€)', [totalExtrasActual, 0, 0, 0])

  const totalActualConExtras = totalActual + totalExtrasActual
  const ahorroH24 = totalActualConExtras - h24.total
  const ahorroTramos = totalActualConExtras - tramos.total
  const ahorroMercado = totalActualConExtras - mercado.total

  // Fila de ahorro con color condicional (manual ya que ExcelJS no soporta CF fácil)
  const addAhorroRow = (label: string, vals: [number | null, number, number, number]) => {
    const cell0 = ws.getCell(r, 1)
    cell0.value = label
    cell0.font = { size: 10, bold: true }
    cell0.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    cell0.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }

    const arrVals = [vals[0], vals[1], vals[2], vals[3]]
    const cols = [COL.actual, COL.h24, COL.tramos, COL.mercado]
    for (let i = 0; i < 4; i++) {
      const cell = ws.getCell(r, cols[i])
      const v = arrVals[i]
      cell.value = v
      if (typeof v === 'number') {
        cell.numFmt = '€#,##0.00'
        const isPositive = v > 0
        const argbBg = i === 0 ? 'FFFAFAFA' : isPositive ? 'FFC8E6C9' : 'FFFFCDD2'
        const argbFg = i === 0 ? 'FF000000' : isPositive ? 'FF1B5E20' : 'FFB71C1C'
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbBg } }
        cell.font = { size: 10, bold: true, color: { argb: argbFg } }
      }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } } }
    }
    ws.getRow(r).height = 22
    r++
  }

  addAhorroRow('AHORRO ANUAL vs. ACTUAL + EXTRAS (€)', [null, ahorroH24, ahorroTramos, ahorroMercado])

  // Ahorro en porcentaje
  if (totalActualConExtras > 0) {
    const cell0 = ws.getCell(r, 1)
    cell0.value = 'Ahorro (%)'
    cell0.font = { size: 10, color: { argb: 'FF757575' } }
    cell0.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }

    const pcts = [
      null,
      ahorroH24 / totalActualConExtras,
      ahorroTramos / totalActualConExtras,
      ahorroMercado / totalActualConExtras,
    ]
    const cols = [COL.actual, COL.h24, COL.tramos, COL.mercado]
    for (let i = 0; i < 4; i++) {
      const cell = ws.getCell(r, cols[i])
      const v = pcts[i]
      if (typeof v === 'number') {
        cell.value = v
        cell.numFmt = '0.0%'
        cell.font = { size: 10, color: { argb: v >= 0 ? 'FF1B5E20' : 'FFB71C1C' } }
      }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }
    ws.getRow(r).height = 16
    r++
  }

  // ─── HOJA 2: Precios unitarios de referencia ───────────────────────────────
  const ws2 = wb.addWorksheet('Precios Gana Energía', {
    properties: { defaultRowHeight: 18 },
  })
  ws2.getColumn(1).width = 28
  ws2.getColumn(2).width = 14
  ws2.getColumn(3).width = 14
  ws2.getColumn(4).width = 14

  const addP2 = (label: string, vals: (number | string)[]) => {
    ws2.addRow([label, ...vals])
    const rr = ws2.lastRow!
    rr.getCell(1).font = { size: 10 }
    for (let c = 2; c <= vals.length + 1; c++) {
      rr.getCell(c).alignment = { horizontal: 'right' }
      rr.getCell(c).font = { size: 10, color: { argb: 'FF1565C0' } }
      if (typeof vals[c - 2] === 'number') rr.getCell(c).numFmt = '0.000000'
    }
  }
  ws2.addRow(['PRECIOS GANA ENERGÍA (referencia)', '24H FIJO', 'Tramos FIJO', 'Mercado INDEX'])
  ws2.lastRow!.font = { bold: true, size: 11 }
  ws2.lastRow!.height = 22
  ws2.addRow([])
  ws2.addRow(['— POTENCIA (€/kW·día) —', '', '', ''])
  ws2.lastRow!.font = { bold: true, size: 10, color: { argb: 'FF455A64' } }

  for (const t of [h24, tramos, mercado]) {
    // just use the tarifa objects
  }
  addP2('P1 Punta', [h24.tarifa.kwDia.p1, tramos.tarifa.kwDia.p1, mercado.tarifa.kwDia.p1])
  addP2('P2 Valle', [h24.tarifa.kwDia.p2, tramos.tarifa.kwDia.p2, mercado.tarifa.kwDia.p2])
  ws2.addRow([])
  ws2.addRow(['— ENERGÍA (€/kWh) —', '', '', ''])
  ws2.lastRow!.font = { bold: true, size: 10, color: { argb: 'FF455A64' } }
  addP2('Punta / P1', [h24.tarifa.kwh.punta, tramos.tarifa.kwh.punta, mercado.tarifa.kwh.punta])
  addP2('Llano / P2', [h24.tarifa.kwh.llano, tramos.tarifa.kwh.llano, mercado.tarifa.kwh.llano])
  addP2('Valle / P3', [h24.tarifa.kwh.valle, tramos.tarifa.kwh.valle, mercado.tarifa.kwh.valle])
  ws2.addRow([])
  addP2('Servicio Gana Energía (€/mes)', [0, 0, TARIFAS_GANA_2_0TD[0].servicioGanaEnergia])
  addP2('Bono Social (€/mes)', [BONO_SOCIAL_MES, BONO_SOCIAL_MES, BONO_SOCIAL_MES])
  addP2('Impuesto Eléctrico (%)', [IMPUESTO_ELECTRICO_PCT * 100, IMPUESTO_ELECTRICO_PCT * 100, IMPUESTO_ELECTRICO_PCT * 100])

  // ─── Serializar ────────────────────────────────────────────────────────────
  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  const cups = (cliente.cups ?? '').replace(/\s/g, '')
  const today = new Date().toISOString().slice(0, 10)
  const fname = cups
    ? `Comparativa_${cups}_${today}.xlsx`
    : `Comparativa_Voltis_${today}.xlsx`

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
