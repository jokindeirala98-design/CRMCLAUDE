/**
 * POST /api/comparativa-2td
 *
 * Generates an .xlsx comparison file for a 2.0TD supply vs. a Voltis tariff.
 * Returns the file as an attachment for browser download.
 *
 * Body (JSON):
 * {
 *   titular:            string
 *   cups:               string
 *   tariffKey:          'tramos' | '24h' | 'mercado'
 *   consumoP1:          number   // kWh punta
 *   consumoP2:          number   // kWh llano
 *   consumoP3:          number   // kWh valle
 *   potenciaP1:         number   // kW contracted punta
 *   potenciaP2:         number   // kW contracted valle
 *   currentEnergyPrice: number   // current avg €/kWh
 *   currentPowerP1:     number   // current €/kW·día period 1
 *   currentPowerP2:     number   // current €/kW·día period 2
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { VOLTIS_TARIFFS_2TD, compute2TDSavings, IVA, type VoltisKey2TD } from '@/lib/voltis-tariffs-2td'

// ─── Brand colors (ARGB, no #) ───────────────────────────────────────────────
const C = {
  ink:        'FF2D3A33',
  ink3:       'FF5A6B5F',
  ink4:       'FF8A9A8E',
  crema:      'FFF4EEE2',
  paper:      'FFFBF7EE',
  line:       'FFE5DCC9',
  line2:      'FFD9D0BA',
  salvia:     'FF6B8068',
  salviaDark: 'FF5A6E58',
  salviaSoft: 'FFE0E8DC',
  durazno:    'FFE8B89A',
  duraznoSoft:'FFF5DCC9',
  volt:       'FFC7F24A',
  white:      'FFFFFFFF',
  green:      'FF4A7C59',
  red:        'FFC0392B',
  redSoft:    'FFFCE8E6',
  greenSoft:  'FFE8F5E9',
}

function cell(ws: ExcelJS.Worksheet, row: number, col: number): ExcelJS.Cell {
  return ws.getCell(row, col)
}

function setCell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  opts: {
    bold?: boolean; italic?: boolean; size?: number; color?: string
    bg?: string; align?: ExcelJS.Alignment['horizontal']
    border?: boolean; borderColor?: string; wrap?: boolean; numFmt?: string
  } = {},
) {
  const c = cell(ws, row, col)
  c.value = value
  c.font = {
    name: 'Arial', size: opts.size || 11, bold: opts.bold,
    italic: opts.italic, color: opts.color ? { argb: opts.color } : { argb: C.ink },
  }
  if (opts.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } }
  if (opts.align) c.alignment = { horizontal: opts.align, vertical: 'middle', wrapText: opts.wrap }
  else c.alignment = { vertical: 'middle', wrapText: opts.wrap }
  if (opts.border) {
    const bc = { style: 'thin' as ExcelJS.BorderStyle, color: { argb: opts.borderColor || C.line2 } }
    c.border = { top: bc, bottom: bc, left: bc, right: bc }
  }
  if (opts.numFmt) c.numFmt = opts.numFmt
  return c
}

function mergeSet(
  ws: ExcelJS.Worksheet,
  r1: number, c1: number, r2: number, c2: number,
  value: ExcelJS.CellValue,
  opts: Parameters<typeof setCell>[4] = {},
) {
  ws.mergeCells(r1, c1, r2, c2)
  setCell(ws, r1, c1, value, opts)
}

function euro(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function pct(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      titular,
      cups,
      tariffKey,
      consumoP1,
      consumoP2,
      consumoP3,
      potenciaP1,
      potenciaP2,
      currentEnergyPrice,
      currentPowerP1,
      currentPowerP2,
    } = body as {
      titular: string; cups: string; tariffKey: VoltisKey2TD
      consumoP1: number; consumoP2: number; consumoP3: number
      potenciaP1: number; potenciaP2: number
      currentEnergyPrice: number; currentPowerP1: number; currentPowerP2: number
    }

    if (!VOLTIS_TARIFFS_2TD[tariffKey]) {
      return NextResponse.json({ error: 'Invalid tariffKey' }, { status: 400 })
    }

    const tariff = VOLTIS_TARIFFS_2TD[tariffKey]
    const consumo  = { P1: consumoP1, P2: consumoP2, P3: consumoP3 }
    const potencia = { P1: potenciaP1, P2: potenciaP2 }

    const result = compute2TDSavings(
      consumo, potencia,
      currentEnergyPrice, currentPowerP1, currentPowerP2,
      tariffKey,
    )

    // ── Build workbook ────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Voltis CRM'
    wb.created = new Date()

    const ws = wb.addWorksheet('Comparativa 2.0TD', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      properties: { tabColor: { argb: C.salvia } },
    })

    // Column widths
    ws.getColumn(1).width = 3    // gutter
    ws.getColumn(2).width = 22   // label
    ws.getColumn(3).width = 14   // P1 / actual
    ws.getColumn(4).width = 14   // P2 / nuevo
    ws.getColumn(5).width = 14   // P3 / diff
    ws.getColumn(6).width = 16   // total / summary
    ws.getColumn(7).width = 3    // right gutter

    // ── Header ────────────────────────────────────────────────────────────────
    ws.getRow(1).height = 8
    ws.mergeCells('B2:F2')
    setCell(ws, 2, 2, 'COMPARATIVA TARIFAS 2.0TD — VOLTIS', {
      bold: true, size: 14, color: C.white, bg: C.salviaDark,
      align: 'center', border: false,
    })
    ws.getRow(2).height = 32

    ws.mergeCells('B3:F3')
    setCell(ws, 3, 2, titular.toUpperCase(), {
      bold: true, size: 11, color: C.white, bg: C.salvia,
      align: 'center',
    })
    ws.getRow(3).height = 22

    ws.mergeCells('B4:F4')
    setCell(ws, 4, 2, cups, {
      size: 9, color: C.ink3, bg: C.crema, align: 'center', italic: true,
    })
    ws.getRow(4).height = 18

    ws.getRow(5).height = 6

    // Tariff badge
    ws.mergeCells('B6:F6')
    setCell(ws, 6, 2, `NUEVA TARIFA: ${tariff.name.toUpperCase()}`, {
      bold: true, size: 12, color: C.salviaDark, bg: C.salviaSoft, align: 'center',
    })
    ws.getRow(6).height = 26

    ws.getRow(7).height = 10

    // ── Section: Potencia ─────────────────────────────────────────────────────
    ws.mergeCells('B8:F8')
    setCell(ws, 8, 2, 'TÉRMINO DE POTENCIA', {
      bold: true, size: 11, color: C.white, bg: C.ink3, align: 'center',
    })
    ws.getRow(8).height = 20

    // Sub-header
    const potHdr = ['', 'CONCEPTO', 'PUNTA (P1)', 'VALLE (P2)', 'ANUAL IVA INCL.']
    potHdr.forEach((v, i) => {
      if (i === 0) return
      setCell(ws, 9, i + 1, v, {
        bold: true, size: 9, color: C.ink3, bg: C.line, align: 'center', border: true,
      })
    })
    ws.getRow(9).height = 16

    // Potencia contratada
    setCell(ws, 10, 2, 'Potencia contratada (kW)', { size: 10, color: C.ink })
    setCell(ws, 10, 3, potencia.P1, { size: 10, color: C.ink, align: 'center', numFmt: '#,##0.00' })
    setCell(ws, 10, 4, potencia.P2, { size: 10, color: C.ink, align: 'center', numFmt: '#,##0.00' })
    ws.getRow(10).height = 16

    // Tarifa actual — potencia
    setCell(ws, 11, 2, 'Precio actual (€/kW·día)', { size: 10, color: C.ink3, italic: true })
    setCell(ws, 11, 3, currentPowerP1, { size: 10, color: C.ink3, italic: true, align: 'center', numFmt: '#,##0.000000' })
    setCell(ws, 11, 4, currentPowerP2, { size: 10, color: C.ink3, italic: true, align: 'center', numFmt: '#,##0.000000' })
    const curPowTotal = result.current.power
    setCell(ws, 11, 6, curPowTotal, {
      size: 10, color: C.ink, bg: C.paper, align: 'center', numFmt: '#,##0.00', border: true,
    })
    ws.getRow(11).height = 16

    // Tarifa Voltis — potencia
    setCell(ws, 12, 2, `Precio Voltis ${tariff.name} (€/kW·día)`, { size: 10, color: C.salviaDark, bold: true })
    setCell(ws, 12, 3, tariff.power.P1, { size: 10, color: C.salviaDark, bold: true, align: 'center', numFmt: '#,##0.000000' })
    setCell(ws, 12, 4, tariff.power.P2, { size: 10, color: C.salviaDark, bold: true, align: 'center', numFmt: '#,##0.000000' })
    const newPowTotal = result.nuevo.power
    setCell(ws, 12, 6, newPowTotal, {
      size: 10, color: C.salviaDark, bg: C.salviaSoft, align: 'center', numFmt: '#,##0.00', border: true, bold: true,
    })
    ws.getRow(12).height = 16

    // Diferencia potencia
    const powDiffAnnual  = result.savings.power
    const powDiffColor   = powDiffAnnual >= 0 ? C.green : C.red
    const powDiffBg      = powDiffAnnual >= 0 ? C.greenSoft : C.redSoft
    setCell(ws, 13, 2, 'Diferencia potencia (anual)', { size: 10, bold: true, color: powDiffColor })
    setCell(ws, 13, 6, powDiffAnnual, {
      size: 11, bold: true, color: powDiffColor, bg: powDiffBg,
      align: 'center', numFmt: '#,##0.00', border: true,
    })
    ws.getRow(13).height = 18

    ws.getRow(14).height = 8

    // ── Section: Energía ──────────────────────────────────────────────────────
    ws.mergeCells('B15:F15')
    setCell(ws, 15, 2, 'TÉRMINO DE ENERGÍA', {
      bold: true, size: 11, color: C.white, bg: C.ink3, align: 'center',
    })
    ws.getRow(15).height = 20

    // Sub-header
    const eneHdr = ['', 'CONCEPTO', 'PUNTA (P1)', 'LLANO (P2)', 'VALLE (P3)', 'ANUAL IVA INCL.']
    eneHdr.forEach((v, i) => {
      if (i === 0) return
      setCell(ws, 16, i + 1, v, {
        bold: true, size: 9, color: C.ink3, bg: C.line, align: 'center', border: true,
      })
    })
    ws.getRow(16).height = 16

    // Consumo SIPS
    setCell(ws, 17, 2, 'Consumo anual SIPS (kWh)', { size: 10, color: C.ink })
    setCell(ws, 17, 3, consumo.P1, { size: 10, color: C.ink, align: 'center', numFmt: '#,##0' })
    setCell(ws, 17, 4, consumo.P2, { size: 10, color: C.ink, align: 'center', numFmt: '#,##0' })
    setCell(ws, 17, 5, consumo.P3, { size: 10, color: C.ink, align: 'center', numFmt: '#,##0' })
    setCell(ws, 17, 6, consumo.P1 + consumo.P2 + consumo.P3, {
      size: 10, color: C.ink, bg: C.paper, align: 'center', numFmt: '#,##0', border: true,
    })
    ws.getRow(17).height = 16

    // Precio actual energía
    setCell(ws, 18, 2, 'Precio actual (€/kWh) — media facturada', { size: 10, color: C.ink3, italic: true })
    setCell(ws, 18, 3, currentEnergyPrice, { size: 10, color: C.ink3, italic: true, align: 'center', numFmt: '#,##0.0000' })
    setCell(ws, 18, 4, currentEnergyPrice, { size: 10, color: C.ink3, italic: true, align: 'center', numFmt: '#,##0.0000' })
    setCell(ws, 18, 5, currentEnergyPrice, { size: 10, color: C.ink3, italic: true, align: 'center', numFmt: '#,##0.0000' })
    setCell(ws, 18, 6, result.current.energy, {
      size: 10, color: C.ink, bg: C.paper, align: 'center', numFmt: '#,##0.00', border: true,
    })
    ws.getRow(18).height = 16

    // Precio Voltis energía
    setCell(ws, 19, 2, `Precio Voltis ${tariff.name} (€/kWh)`, { size: 10, color: C.salviaDark, bold: true })
    setCell(ws, 19, 3, tariff.energy.P1, { size: 10, color: C.salviaDark, bold: true, align: 'center', numFmt: '#,##0.0000' })
    setCell(ws, 19, 4, tariff.energy.P2, { size: 10, color: C.salviaDark, bold: true, align: 'center', numFmt: '#,##0.0000' })
    setCell(ws, 19, 5, tariff.energy.P3, { size: 10, color: C.salviaDark, bold: true, align: 'center', numFmt: '#,##0.0000' })
    setCell(ws, 19, 6, result.nuevo.energy, {
      size: 10, color: C.salviaDark, bg: C.salviaSoft, align: 'center', numFmt: '#,##0.00', border: true, bold: true,
    })
    ws.getRow(19).height = 16

    // Diferencia energía
    const eneDiffAnnual = result.savings.energy
    const eneDiffColor  = eneDiffAnnual >= 0 ? C.green : C.red
    const eneDiffBg     = eneDiffAnnual >= 0 ? C.greenSoft : C.redSoft
    setCell(ws, 20, 2, 'Diferencia energía (anual)', { size: 10, bold: true, color: eneDiffColor })
    setCell(ws, 20, 6, eneDiffAnnual, {
      size: 11, bold: true, color: eneDiffColor, bg: eneDiffBg,
      align: 'center', numFmt: '#,##0.00', border: true,
    })
    ws.getRow(20).height = 18

    ws.getRow(21).height = 10

    // ── Summary: Total Saving ─────────────────────────────────────────────────
    ws.mergeCells('B22:E22')
    setCell(ws, 22, 2, 'AHORRO TOTAL ESTIMADO ANUAL (IVA INCL.)', {
      bold: true, size: 12, color: C.white, bg: C.salviaDark, align: 'center',
    })
    const totalColor  = result.savings.totalAnnual >= 0 ? C.green : C.red
    const totalBg     = result.savings.totalAnnual >= 0 ? C.greenSoft : C.redSoft
    setCell(ws, 22, 6, result.savings.totalAnnual, {
      bold: true, size: 13, color: totalColor, bg: totalBg,
      align: 'center', numFmt: '#,##0.00', border: true,
    })
    ws.getRow(22).height = 26

    ws.mergeCells('B23:E23')
    setCell(ws, 23, 2, 'AHORRO MENSUAL ESTIMADO (IVA INCL.)', {
      bold: true, size: 10, color: C.ink3, bg: C.salviaSoft, align: 'center',
    })
    setCell(ws, 23, 6, result.savings.totalMonthly, {
      bold: true, size: 11, color: totalColor, bg: totalBg,
      align: 'center', numFmt: '#,##0.00', border: true,
    })
    ws.getRow(23).height = 22

    ws.getRow(24).height = 10

    // ── Detailed cost breakdown ───────────────────────────────────────────────
    ws.mergeCells('B25:F25')
    setCell(ws, 25, 2, 'DESGLOSE DE COSTES ANUALES (IVA INCL.)', {
      bold: true, size: 10, color: C.ink, bg: C.line, align: 'center',
    })
    ws.getRow(25).height = 18

    const detailRows: [string, number, number, number][] = [
      ['Potencia P1 (punta)', result.current.powerP1, result.nuevo.powerP1, result.current.powerP1 - result.nuevo.powerP1],
      ['Potencia P2 (valle)', result.current.powerP2, result.nuevo.powerP2, result.current.powerP2 - result.nuevo.powerP2],
      ['Energía P1 (punta)',  result.current.energyP1, result.nuevo.energyP1, result.current.energyP1 - result.nuevo.energyP1],
      ['Energía P2 (llano)',  result.current.energyP2, result.nuevo.energyP2, result.current.energyP2 - result.nuevo.energyP2],
      ['Energía P3 (valle)',  result.current.energyP3, result.nuevo.energyP3, result.current.energyP3 - result.nuevo.energyP3],
    ]

    // Detail header
    setCell(ws, 26, 2, 'Concepto',       { bold: true, size: 9, color: C.ink3, align: 'center', bg: C.crema, border: true })
    setCell(ws, 26, 3, 'Factura actual', { bold: true, size: 9, color: C.ink3, align: 'center', bg: C.crema, border: true })
    setCell(ws, 26, 4, 'Tarifa Voltis',  { bold: true, size: 9, color: C.salviaDark, align: 'center', bg: C.crema, border: true })
    setCell(ws, 26, 5, 'Diferencia',     { bold: true, size: 9, color: C.ink3, align: 'center', bg: C.crema, border: true })
    ws.getRow(26).height = 16

    detailRows.forEach(([label, cur, nw, diff], idx) => {
      const r = 27 + idx
      const dColor = diff >= 0 ? C.green : C.red
      setCell(ws, r, 2, label, { size: 9, color: C.ink })
      setCell(ws, r, 3, cur,   { size: 9, color: C.ink3,     align: 'center', numFmt: '#,##0.00', border: true })
      setCell(ws, r, 4, nw,    { size: 9, color: C.salviaDark, align: 'center', numFmt: '#,##0.00', border: true })
      setCell(ws, r, 5, diff,  { size: 9, color: dColor,     align: 'center', numFmt: '#,##0.00', border: true })
      ws.getRow(r).height = 14
    })

    // Total row
    const totR = 32
    setCell(ws, totR, 2, 'TOTAL', { bold: true, size: 10, color: C.ink })
    setCell(ws, totR, 3, result.current.total, { bold: true, size: 10, color: C.ink,       bg: C.crema, align: 'center', numFmt: '#,##0.00', border: true })
    setCell(ws, totR, 4, result.nuevo.total,   { bold: true, size: 10, color: C.salviaDark, bg: C.salviaSoft, align: 'center', numFmt: '#,##0.00', border: true })
    setCell(ws, totR, 5, result.savings.totalAnnual, {
      bold: true, size: 10, color: totalColor, bg: totalBg, align: 'center', numFmt: '#,##0.00', border: true,
    })
    ws.getRow(totR).height = 18

    ws.getRow(33).height = 10

    // ── Footer ────────────────────────────────────────────────────────────────
    ws.mergeCells('B34:F34')
    setCell(ws, 34, 2, 'Generado por Voltis CRM · Comparativa indicativa basada en consumo SIPS y precios medios facturados · IVA 21% incluido', {
      size: 8, color: C.ink4, italic: true, align: 'center', bg: C.paper,
    })
    ws.getRow(34).height = 14

    // ── Serialize and return ──────────────────────────────────────────────────
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    const filename = `Comparativa_2TD_${tariff.shortName}_${(titular || 'cliente').replace(/\s+/g, '_')}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err) {
    console.error('[comparativa-2td] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
