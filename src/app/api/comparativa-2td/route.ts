/**
 * POST /api/comparativa-2td
 *
 * Generates .xlsx in the EXACT template format (A1:R33 layout, merged cells,
 * Excel formulas in specific cells) matching the TIENDA client template.
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
 *   currentEnergyPrice: number   // current avg €/kWh (flat, all periods)
 *   currentPowerP1:     number   // current €/kW·día period 1
 *   currentPowerP2:     number   // current €/kW·día period 2
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { VOLTIS_TARIFFS_2TD, compute2TDSavings, type VoltisKey2TD } from '@/lib/voltis-tariffs-2td'

// ─── Column index constants (1-based) ────────────────────────────────────────
const A = 1, B = 2, C = 3, D = 4, E = 5, F = 6, G = 7, H = 8, I = 9,
      J = 10, K = 11, L = 12, M = 13, N = 14, O = 15, P = 16, Q = 17, R = 18

// ─── Template colors (ARGB, no #) — matches original TIENDA template ─────────
const CLR = {
  ink:        'FF000000',   // black text
  ink3:       'FF404040',   // dark gray secondary text
  ink4:       'FF808080',   // medium gray tertiary text
  crema:      'FFFFFFFF',   // white for data cells
  paper:      'FFFFFFFF',   // white
  line:       'FFD1D5DB',   // light border
  line2:      'FF000000',   // BLACK borders (as in original template)
  salvia:     'FF31849B',   // medium teal (NUEVO label)
  salviaDark: 'FF17375E',   // dark navy (main section headers)
  salviaSoft: 'FFB7DEE8',   // light cyan (POR POTENCIA, DIFERENCIA bg)
  volt:       'FFC6EFCE',   // light green (total savings highlight)
  voltDark:   'FF375623',   // dark green (text on savings cells)
  white:      'FFFFFFFF',
  green:      'FF375623',   // positive savings text
  greenSoft:  'FFC6EFCE',   // positive savings bg
  red:        'FF9C0006',   // negative savings text
  redSoft:    'FFFFC7CE',   // negative savings bg
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Opts = {
  bold?: boolean; italic?: boolean; size?: number; color?: string
  bg?: string; align?: ExcelJS.Alignment['horizontal']
  border?: boolean; wrap?: boolean; numFmt?: string
}

function sc(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue, opts: Opts = {}) {
  const c = ws.getCell(row, col)
  c.value = value
  c.font = {
    name: 'Arial', bold: !!opts.bold, italic: !!opts.italic,
    size: opts.size ?? 11,
    color: { argb: opts.color ?? CLR.ink },
  }
  if (opts.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } }
  c.alignment = { horizontal: opts.align ?? 'left', vertical: 'middle', wrapText: !!opts.wrap }
  if (opts.border !== false) {
    const b = { style: 'thin' as ExcelJS.BorderStyle, color: { argb: CLR.line2 } }
    c.border = { top: b, bottom: b, left: b, right: b }
  }
  if (opts.numFmt) c.numFmt = opts.numFmt
  return c
}

function mc(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number,
            value: ExcelJS.CellValue, opts: Opts = {}) {
  ws.mergeCells(r1, c1, r2, c2)
  sc(ws, r1, c1, value, opts)
}

/** Formula cell — formula string WITHOUT leading '=' */
function fc(ws: ExcelJS.Worksheet, row: number, col: number,
            formula: string, result: number, opts: Opts = {}) {
  const c = ws.getCell(row, col)
  c.value = { formula, result } as ExcelJS.CellFormulaValue
  c.font = {
    name: 'Arial', bold: !!opts.bold, italic: !!opts.italic,
    size: opts.size ?? 11,
    color: { argb: opts.color ?? CLR.ink },
  }
  if (opts.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } }
  c.alignment = { horizontal: opts.align ?? 'center', vertical: 'middle' }
  if (opts.border !== false) {
    const b = { style: 'thin' as ExcelJS.BorderStyle, color: { argb: CLR.line2 } }
    c.border = { top: b, bottom: b, left: b, right: b }
  }
  if (opts.numFmt) c.numFmt = opts.numFmt
  return c
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      titular = 'Cliente',
      cups = '',
      tariffKey,
      consumoP1 = 0, consumoP2 = 0, consumoP3 = 0,
      potenciaP1 = 0, potenciaP2 = 0,
      currentEnergyPrice = 0,
      currentPowerP1 = 0, currentPowerP2 = 0,
    } = body as {
      titular: string; cups: string; tariffKey: VoltisKey2TD
      consumoP1: number; consumoP2: number; consumoP3: number
      potenciaP1: number; potenciaP2: number
      currentEnergyPrice: number; currentPowerP1: number; currentPowerP2: number
    }

    if (!VOLTIS_TARIFFS_2TD[tariffKey]) {
      return NextResponse.json({ error: 'Invalid tariffKey' }, { status: 400 })
    }

    const tariff  = VOLTIS_TARIFFS_2TD[tariffKey]
    const consumo = { P1: consumoP1, P2: consumoP2, P3: consumoP3 }
    const potencia = { P1: potenciaP1, P2: potenciaP2 }
    const totalKwh = consumoP1 + consumoP2 + consumoP3

    compute2TDSavings(consumo, potencia, currentEnergyPrice, currentPowerP1, currentPowerP2, tariffKey)

    // ── Pre-compute formula result values ──────────────────────────────────────
    // POTENCIA section
    const H7  = potenciaP1 * currentPowerP1 * 365
    const I7  = potenciaP2 * currentPowerP2 * 365
    const K7  = (H7 + I7) * 1.21
    const H14 = potenciaP1 * tariff.power.P1 * 365
    const I14 = potenciaP2 * tariff.power.P2 * 365
    const K14 = (H14 + I14) * 1.21
    const N10 = K7 - K14
    const M10 = N10 / 12

    // ENERGIA section
    const J27 = consumoP1 * currentEnergyPrice
    const K27 = consumoP2 * currentEnergyPrice
    const L27 = consumoP3 * currentEnergyPrice
    const N26 = (J27 + K27 + L27) * 1.21
    const J33 = consumoP1 * tariff.energy.P1
    const K33 = consumoP2 * tariff.energy.P2
    const L33 = consumoP3 * tariff.energy.P3
    const N33 = (J33 + K33 + L33) * 1.21
    const Q30 = N26 - N33
    const P30 = Q30 / 12

    // TOTAL AHORRO
    const Q16 = M10 + P30
    const R16 = N10 + Q30

    const powColor  = N10 >= 0 ? CLR.green    : CLR.red
    const powBg     = N10 >= 0 ? CLR.greenSoft : CLR.redSoft
    const eneColor  = Q30 >= 0 ? CLR.green    : CLR.red
    const eneBg     = Q30 >= 0 ? CLR.greenSoft : CLR.redSoft
    const totColor  = R16 >= 0 ? CLR.voltDark  : CLR.red   // dark green on light green bg

    // ── Workbook ───────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Voltis CRM'
    wb.created = new Date()

    const ws = wb.addWorksheet('Comparativa 2.0TD', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      properties: { tabColor: { argb: CLR.salvia } },
    })

    // ── Column widths (from template) ─────────────────────────────────────────
    ws.getColumn(A).width = 10
    ws.getColumn(B).width = 12
    ws.getColumn(C).width = 15      // template: 15
    ws.getColumn(D).width = 13      // template: 13
    ws.getColumn(E).width = 12
    ws.getColumn(F).width = 13.16   // template: 13.16
    ws.getColumn(G).width = 12
    ws.getColumn(H).width = 12
    ws.getColumn(I).width = 12.5    // template: 12.5
    ws.getColumn(J).width = 12
    ws.getColumn(K).width = 12
    ws.getColumn(L).width = 12
    ws.getColumn(M).width = 14.5    // template: 14.5
    ws.getColumn(N).width = 13      // logo block col 1
    ws.getColumn(O).width = 13      // logo block col 2
    ws.getColumn(P).width = 13      // logo block col 3
    ws.getColumn(Q).width = 20      // client name (wider for long names)
    ws.getColumn(R).width = 18      // client name col 2

    // ══════════════════════════════════════════════════════════════════════════
    // VOLTIS LOGO + DATOS CLIENTE — columnas N-R, filas 1-3
    // ══════════════════════════════════════════════════════════════════════════

    // Bloque logo izquierdo: N1:P3
    mc(ws, 1, N, 1, P, 'VOLTIS', {
      bold: true, size: 20, color: CLR.white, bg: CLR.salviaDark, align: 'center',
    })
    mc(ws, 2, N, 2, P, 'energía', {
      italic: true, size: 14, color: CLR.salvia, bg: CLR.salviaSoft, align: 'center',
    })
    mc(ws, 3, N, 3, P, tariff.name.toUpperCase(), {
      bold: true, size: 9, color: CLR.ink3, bg: CLR.salviaSoft, align: 'center',
    })

    // Nombre del cliente — Q1:R1 fusionado, siempre arriba
    mc(ws, 1, Q, 1, R, titular.toUpperCase(), {
      bold: true, size: 12, color: CLR.white, bg: CLR.salviaDark, align: 'center', wrap: true,
    })

    // CUPS — Q2:R2 fusionado, debajo del nombre
    mc(ws, 2, Q, 2, R, cups, {
      italic: true, size: 9, color: CLR.ink4, bg: CLR.crema, align: 'center',
    })

    // ══════════════════════════════════════════════════════════════════════════
    // POTENCIAS SECTION (rows 1–16)
    // ══════════════════════════════════════════════════════════════════════════

    // A1:D1 — Section title (1 fila, antes eran 3)
    mc(ws, 1, A, 1, D, 'CALCULADORA DIFERENCIA POTENCIAS 2.0TD', {
      bold: true, size: 10, color: CLR.white, bg: CLR.salviaDark, align: 'center', wrap: true,
    })

    // Row 3: other charges labels
    sc(ws, 3, Q, 'OTROS CARGOS:', { bold: true, size: 9, color: CLR.ink3, align: 'right' })
    sc(ws, 3, R, 'ALQUILER DE EQUIPOS', { bold: true, size: 9, color: CLR.ink, align: 'center', bg: CLR.crema, wrap: true })

    // Row 4: column section headers
    sc(ws, 4, H, 'ANUALMENTE',    { bold: true, size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 4, K, 'IVA INCL.',     { bold: true, size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 4, R, 'IMP. ELÉCTRICO',{ bold: true, size: 10, color: CLR.ink3, align: 'center' })

    // Row 5: ACTUAL label
    sc(ws, 5, A, 'ACTUAL', { bold: true, size: 12, color: CLR.white, bg: CLR.ink3, align: 'center' })

    // Row 6: period column headers
    ;[B, C, E, F, H, I].forEach(col => {
      const label = [B, E, H].includes(col) ? 'p1' : 'p3'
      sc(ws, 6, col, label, { bold: true, size: 14, color: CLR.ink, align: 'center' })
    })
    sc(ws, 6, K, 'TOTAL:', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })

    // Row 7: ACTUAL — kW | current price | annual (formula) | total IVA (formula)
    sc(ws, 7, B, potenciaP1,    { bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 7, C, potenciaP2,    { bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 7, E, currentPowerP1,{ bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0.000000' })
    sc(ws, 7, F, currentPowerP2,{ bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0.000000' })
    fc(ws, 7, H, 'B7*E7*J15',     H7,  { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00' })
    fc(ws, 7, I, 'C7*F7*J15',     I7,  { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00' })
    fc(ws, 7, K, '(H7+I7)*1.21',  K7,  { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00', bg: CLR.crema })

    // M7:N7 — "POR POTENCIA:" header (merged)
    mc(ws, 7, M, 7, N, 'POR POTENCIA:', { bold: true, size: 12, color: CLR.salviaDark, align: 'center', bg: CLR.salviaSoft })

    // Row 8: MENSUAL / ANUAL sub-headers
    sc(ws, 8, M, 'MENSUAL', { bold: true, size: 11, color: CLR.ink3, align: 'center' })
    sc(ws, 8, N, 'ANUAL',   { bold: true, size: 11, color: CLR.ink3, align: 'center' })

    // Row 9: DIFERENCIA labels
    sc(ws, 9, M, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })
    sc(ws, 9, N, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })

    // Row 10: Power savings (formulas)
    fc(ws, 10, M, 'N10/12',   M10, { bold: true, size: 12, color: powColor, numFmt: '#,##0.00 €', bg: powBg })
    fc(ws, 10, N, 'K7-K14',   N10, { bold: true, size: 12, color: powColor, numFmt: '#,##0.00 €', bg: powBg })

    // Row 11: NUEVO section headers
    sc(ws, 11, H, 'ANUALMENTE', { bold: true, size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 11, K, 'IVA INCL.',  { bold: true, size: 10, color: CLR.ink3, align: 'center' })

    // Row 12: NUEVO label
    sc(ws, 12, A, 'NUEVO', { bold: true, size: 12, color: CLR.white, bg: CLR.salvia, align: 'center' })

    // Row 13: period column headers (same as row 6)
    ;[B, C, E, F, H, I].forEach(col => {
      const label = [B, E, H].includes(col) ? 'p1' : 'p3'
      sc(ws, 13, col, label, { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    })
    sc(ws, 13, K, 'TOTAL:', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })

    // Row 14: NUEVO — kW | Voltis price | annual (formula) | total IVA (formula)
    sc(ws, 14, B, potenciaP1,        { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 14, C, potenciaP2,        { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 14, E, tariff.power.P1,   { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000000', bg: CLR.salviaSoft })
    sc(ws, 14, F, tariff.power.P2,   { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000000', bg: CLR.salviaSoft })
    fc(ws, 14, H, 'B14*E14*J15',    H14, { bold: true, size: 12, color: CLR.salviaDark, numFmt: '#,##0.00' })
    fc(ws, 14, I, 'C14*F14*J15',    I14, { bold: true, size: 12, color: CLR.salviaDark, numFmt: '#,##0.00' })
    fc(ws, 14, K, '(H14+I14)*1.21', K14, { bold: true, size: 12, color: CLR.salviaDark, numFmt: '#,##0.00', bg: CLR.salviaSoft })

    // Q14:R14 — "TOTAL AHORRO ESTIMADO:" (merged)
    mc(ws, 14, Q, 14, R, 'TOTAL AHORRO ESTIMADO:', { bold: true, size: 14, color: CLR.white, bg: CLR.salviaDark, align: 'center' })

    // Row 15: J15 = 365 days (used in power formulas) + MENSUAL/ANUAL labels
    sc(ws, 15, J, 365, { size: 11, color: CLR.ink4, align: 'center', numFmt: '#,##0' })
    sc(ws, 15, Q, 'MENSUAL', { bold: true, size: 12, color: CLR.ink, align: 'center', bg: CLR.crema })
    sc(ws, 15, R, 'ANUAL',   { bold: true, size: 12, color: CLR.ink, align: 'center', bg: CLR.crema })

    // Row 16: Total savings (formulas referencing both sections)
    fc(ws, 16, Q, 'M10+P30', Q16, { bold: true, size: 16, color: totColor, numFmt: '#,##0.00 €', bg: CLR.volt })
    fc(ws, 16, R, 'N10+Q30', R16, { bold: true, size: 16, color: totColor, numFmt: '#,##0.00 €', bg: CLR.volt })

    // ══════════════════════════════════════════════════════════════════════════
    // ENERGIA SECTION (rows 18–33)
    // ══════════════════════════════════════════════════════════════════════════

    // A18:D18 — Section title (1 fila, antes eran 3)
    mc(ws, 18, A, 18, D, 'CALCULADORA DIFERENCIA ENERGIA 2.0TD', {
      bold: true, size: 10, color: CLR.white, bg: CLR.salviaDark, align: 'center', wrap: true,
    })

    // Row 22: B22:C22 — "CONSUMO ANUAL KWH" header
    mc(ws, 22, B, 22, C, 'CONSUMO ANUAL KWH', { bold: true, size: 12, color: CLR.white, bg: CLR.salvia, align: 'center' })

    // Row 23: B23:C23 — total kWh value
    mc(ws, 23, B, 23, C, totalKwh, { bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0', bg: CLR.crema })
    sc(ws, 23, N, 'IVA INCL.', { size: 10, color: CLR.ink3, align: 'center' })

    // Row 24: section header labels
    sc(ws, 24, J, 'ESTA FACTURA:', { bold: true, size: 9, color: CLR.ink3, align: 'center', wrap: true })

    // Row 25: sub-labels
    sc(ws, 25, A, 'CONSUMO',       { bold: true, size: 12, color: CLR.ink,  align: 'center' })
    sc(ws, 25, F, 'Precio actual:', { size: 10,   color: CLR.ink3, align: 'center', wrap: true })
    sc(ws, 25, N, 'TOTAL:',        { bold: true, size: 12, color: CLR.salviaDark, align: 'center' })

    // Row 26: period headers for "current" costs + N26 total formula
    sc(ws, 26, J, 'P1', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 26, K, 'P2', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 26, L, 'P3', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    fc(ws, 26, N, '(J27+K27+L27)*1.21', N26, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00 €', bg: CLR.crema })

    // Row 27: consumption & price period headers + formula costs + P27:Q27 merged header
    sc(ws, 27, B, 'P1', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, C, 'P2', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, D, 'P3', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, F, 'P1', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, G, 'P2', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, H, 'P3', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    fc(ws, 27, J, 'B28*F28', J27, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00' })
    fc(ws, 27, K, 'C28*G28', K27, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00' })
    fc(ws, 27, L, 'D28*H28', L27, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00' })
    mc(ws, 27, P, 27, Q, 'POR ENERGIA:', { bold: true, size: 12, color: CLR.salviaDark, align: 'center', bg: CLR.salviaSoft })

    // Row 28: kWh values + current energy prices (same flat rate for all 3)
    sc(ws, 28, B, consumoP1,         { bold: true, size: 11, color: CLR.ink, align: 'center', numFmt: '#,##0' })
    sc(ws, 28, C, consumoP2,         { bold: true, size: 11, color: CLR.ink, align: 'center', numFmt: '#,##0' })
    sc(ws, 28, D, consumoP3,         { bold: true, size: 11, color: CLR.ink, align: 'center', numFmt: '#,##0' })
    sc(ws, 28, F, currentEnergyPrice,{ bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0.0000' })
    sc(ws, 28, G, currentEnergyPrice,{ bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0.0000' })
    sc(ws, 28, H, currentEnergyPrice,{ bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0.0000' })
    sc(ws, 28, P, 'MENSUAL', { bold: true, size: 11, color: CLR.ink3, align: 'center' })
    sc(ws, 28, Q, 'ANUAL',   { bold: true, size: 11, color: CLR.ink3, align: 'center' })

    // Row 29: DIFERENCIA labels
    sc(ws, 29, P, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })
    sc(ws, 29, Q, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })

    // Row 30: "Precio Nuevo:" + NUEVA FACTURA header + energy savings (formulas)
    sc(ws, 30, F, 'Precio Nuevo:', { bold: true, size: 10, color: CLR.salviaDark, align: 'center', wrap: true })
    sc(ws, 30, J, 'NUEVA FACTURA:', { bold: true, size: 9, color: CLR.salviaDark, align: 'center', wrap: true })
    sc(ws, 30, N, 'IVA INCL.', { size: 10, color: CLR.ink3, align: 'center' })
    fc(ws, 30, P, 'Q30/12',   P30, { bold: true, size: 12, color: eneColor, numFmt: '#,##0.00 €', bg: eneBg })
    fc(ws, 30, Q, 'N26-N33',  Q30, { bold: true, size: 12, color: eneColor, numFmt: '#,##0.00 €', bg: eneBg })

    // Row 32: Voltis period price headers
    sc(ws, 32, F, 'P1', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, G, 'P2', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, H, 'P3', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, J, 'P1', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, K, 'P2', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, L, 'P3', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, N, 'TOTAL:', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })

    // Row 33: Voltis energy prices + formula costs per period + total IVA
    sc(ws, 33, F, tariff.energy.P1, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.0000', bg: CLR.salviaSoft })
    sc(ws, 33, G, tariff.energy.P2, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.0000', bg: CLR.salviaSoft })
    sc(ws, 33, H, tariff.energy.P3, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.0000', bg: CLR.salviaSoft })
    fc(ws, 33, J, '$B$28*F33',       J33, { bold: true, size: 12, color: CLR.salviaDark, numFmt: '#,##0.00' })
    fc(ws, 33, K, '$C$28*G33',       K33, { bold: true, size: 12, color: CLR.salviaDark, numFmt: '#,##0.00' })
    fc(ws, 33, L, '$D$28*H33',       L33, { bold: true, size: 12, color: CLR.salviaDark, numFmt: '#,##0.00' })
    fc(ws, 33, N, 'SUM(J33:L33)*1.21', N33, { bold: true, size: 12, color: CLR.salviaDark, numFmt: '#,##0.00 €', bg: CLR.salviaSoft })

    // ── Row heights (from template) ───────────────────────────────────────────
    ws.getRow(1).height  = 22   // título sección potencias (1 fila)
    ws.getRow(2).height  = 14   // espacio libre
    ws.getRow(3).height  = 20
    ws.getRow(4).height  = 18
    ws.getRow(5).height  = 22
    ws.getRow(6).height  = 24
    ws.getRow(7).height  = 22
    ws.getRow(8).height  = 18
    ws.getRow(9).height  = 24
    ws.getRow(10).height = 24
    ws.getRow(11).height = 18
    ws.getRow(12).height = 22
    ws.getRow(13).height = 24
    ws.getRow(14).height = 22
    ws.getRow(15).height = 18
    ws.getRow(16).height = 30
    ws.getRow(17).height = 12   // spacer
    ws.getRow(18).height = 22   // título sección energía (1 fila)
    ws.getRow(19).height = 10   // espacio libre
    ws.getRow(20).height = 10   // espacio libre
    ws.getRow(21).height = 12   // spacer
    ws.getRow(22).height = 22
    ws.getRow(23).height = 22
    ws.getRow(24).height = 26   // wrap "ESTA FACTURA:"
    ws.getRow(25).height = 26   // wrap "Precio actual:"
    ws.getRow(26).height = 24
    ws.getRow(27).height = 24
    ws.getRow(28).height = 22
    ws.getRow(29).height = 24
    ws.getRow(30).height = 28   // wrap "Precio Nuevo:" y "NUEVA FACTURA:"
    ws.getRow(31).height = 12   // spacer
    ws.getRow(32).height = 24
    ws.getRow(33).height = 22

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
