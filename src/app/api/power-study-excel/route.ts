/**
 * Excel export — pure TypeScript/Node.js, no Python, no external packages.
 * Generates a valid .xlsx (OOXML) file using built-in zlib for ZIP compression.
 *
 * Format matches the reference Excel exactly:
 *   • No coloured header backgrounds — plain bold text on white
 *   • ColorScale conditional formatting for all data cells
 *   • Pure red fill (FF0000) on summary max cells that exceed contracted power
 *   • Merges: A3:C3 (company), D4:I4 (PRIORIZAR), K3:P4 (OBLIGATORIO)
 *   • Font sizes: header=10, totals=12, company=16, %=12, OBLIGATORIO=14, PRIORIZAR=11
 *   • ONE addition vs reference: contracted power row (R5)
 */
import { NextRequest, NextResponse } from 'next/server'
import { deflateRawSync } from 'zlib'
import type { PowerStudyResult } from '@/app/api/power-study/route'

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = (typeof PERIODS)[number]

// ── XML escape ─────────────────────────────────────────────────────────────
function x(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Column letter (1-based) ────────────────────────────────────────────────
function col(n: number): string {
  let r = ''
  while (n > 0) { r = String.fromCharCode(65 + ((n - 1) % 26)) + r; n = Math.floor((n - 1) / 26) }
  return r
}
function ref(row: number, c: number) { return `${col(c)}${row}` }

// ═══════════════════════════════════════════════════════════════════════════
// STYLE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
class StyleRegistry {
  private fonts:   string[] = []
  private fills:   string[] = []
  private borders: string[] = []
  private xfs:     string[] = []
  private numFmts: Array<{ id: number; code: string }> = []

  private fontIdx = new Map<string, number>()
  private fillIdx = new Map<string, number>()
  private xfIdx   = new Map<string, number>()
  private nfIdx   = new Map<string, number>()

  constructor() {
    // XLSX mandates fills[0]=none, fills[1]=gray125
    this.fills.push('<fill><patternFill patternType="none"/></fill>')
    this.fills.push('<fill><patternFill patternType="gray125"/></fill>')
    // Default font (Arial 9)
    this.fonts.push('<font><sz val="9"/><name val="Arial"/><color rgb="FF000000"/></font>')
    // No-border style
    this.borders.push('<border><left/><right/><top/><bottom/><diagonal/></border>')
    // Thin-border style for header row
    this.borders.push(
      '<border>' +
      '<left style="medium"><color rgb="FF000000"/></left>' +
      '<right style="medium"><color rgb="FF000000"/></right>' +
      '<top style="medium"><color rgb="FF000000"/></top>' +
      '<bottom style="medium"><color rgb="FF000000"/></bottom>' +
      '<diagonal/></border>',
    )
    // xfs[0] = default (must exist)
    this.xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyBorder="1"/>')
  }

  private font(bold: boolean, size: number, color: string): number {
    const k = `${bold}|${size}|${color}`
    if (!this.fontIdx.has(k)) {
      const i = this.fonts.length
      this.fonts.push(`<font>${bold ? '<b/>' : ''}<sz val="${size}"/><name val="Arial"/><color rgb="FF${color}"/></font>`)
      this.fontIdx.set(k, i)
    }
    return this.fontIdx.get(k)!
  }

  private fill(color: string): number {
    if (!color || color === 'FFFFFF' || color === '') return 0
    if (!this.fillIdx.has(color)) {
      const i = this.fills.length
      this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`)
      this.fillIdx.set(color, i)
    }
    return this.fillIdx.get(color)!
  }

  private numFmt(code: string): number {
    if (!code) return 0
    if (!this.nfIdx.has(code)) {
      const id = 164 + this.numFmts.length
      this.numFmts.push({ id, code })
      this.nfIdx.set(code, id)
    }
    return this.nfIdx.get(code)!
  }

  s(opts: {
    bold?: boolean; size?: number; fc?: string; bg?: string
    center?: boolean; numFmt?: string; border?: boolean
  }): number {
    const bold    = opts.bold    ?? false
    const size    = opts.size    ?? 9
    const fc      = opts.fc      ?? '000000'
    const bg      = opts.bg      ?? ''
    const center  = opts.center  ?? true
    const numFmtC = opts.numFmt  ?? ''
    const border  = opts.border  ?? false
    const k = `${bold}|${size}|${fc}|${bg}|${center}|${numFmtC}|${border}`
    if (!this.xfIdx.has(k)) {
      const fid  = this.font(bold, size, fc)
      const bid  = this.fill(bg)
      const nfid = this.numFmt(numFmtC)
      const bord = border ? 1 : 0
      const align = center
        ? '<alignment horizontal="center" vertical="center" wrapText="1"/>'
        : '<alignment horizontal="left"   vertical="center" wrapText="1"/>'
      const attrs = [
        `numFmtId="${nfid}"`, `fontId="${fid}"`, `fillId="${bid}"`,
        `borderId="${bord}"`, 'applyFont="1"',
        bid ? 'applyFill="1"' : '',
        'applyBorder="1"', 'applyAlignment="1"',
        nfid ? 'applyNumberFormat="1"' : '',
      ].filter(Boolean).join(' ')
      const i = this.xfs.length
      this.xfs.push(`<xf ${attrs}>${align}</xf>`)
      this.xfIdx.set(k, i)
    }
    return this.xfIdx.get(k)!
  }

  toXml(): string {
    const nf = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map(n => `<numFmt numFmtId="${n.id}" formatCode="${x(n.code)}"/>`).join('')}</numFmts>`
      : ''
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      nf +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHEET BUILDER
// ═══════════════════════════════════════════════════════════════════════════
interface CellData { r: number; c: number; v: string | number | null; s: number }

// ColorScale entry: 3-point green→yellow→red or blue→white→red
type CSColors = [string, string, string]
interface CSConfig { sqref: string; colors: CSColors; priority: number }

const GYR: CSColors = ['FF63BE7B', 'FFFFEB84', 'FFF8696B']   // green→yellow→red
const BWR: CSColors = ['FF5A8AC6', 'FFFCFCFF', 'FFF8696B']   // blue→white→red

class SheetBuilder {
  private cells:  CellData[] = []
  private merges: string[]   = []
  private colW:   Array<{ col: number; w: number }> = []
  private rowH    = new Map<number, number>()
  private cfRules: CSConfig[] = []

  cell(r: number, c: number, v: string | number | null, s: number) {
    this.cells.push({ r, c, v, s })
  }
  merge(r1: number, c1: number, r2: number, c2: number) {
    this.merges.push(`${ref(r1, c1)}:${ref(r2, c2)}`)
  }
  cw(c: number, w: number) { this.colW.push({ col: c, w }) }
  rh(r: number, h: number) { this.rowH.set(r, h) }
  colorScale(sqref: string, colors: CSColors, priority: number) {
    this.cfRules.push({ sqref, colors, priority })
  }

  toXml(): string {
    const byRow = new Map<number, CellData[]>()
    for (const c of this.cells) {
      if (!byRow.has(c.r)) byRow.set(c.r, [])
      byRow.get(c.r)!.push(c)
    }
    const rows = Array.from(byRow.keys()).sort((a, b) => a - b)

    const colsXml = this.colW.length
      ? `<cols>${this.colW.map(cw => `<col min="${cw.col}" max="${cw.col}" width="${cw.w}" customWidth="1"/>`).join('')}</cols>`
      : ''

    const sheetDataXml = '<sheetData>' + rows.map(r => {
      const ht = this.rowH.get(r)
      const ra = ht ? ` ht="${ht}" customHeight="1"` : ''
      const cs = byRow.get(r)!.sort((a, b) => a.c - b.c).map(cell => {
        const cr = ref(cell.r, cell.c)
        if (cell.v === null || cell.v === '') return `<c r="${cr}" s="${cell.s}"/>`
        if (typeof cell.v === 'string') {
          return `<c r="${cr}" s="${cell.s}" t="inlineStr"><is><t>${x(cell.v)}</t></is></c>`
        }
        return `<c r="${cr}" s="${cell.s}"><v>${cell.v}</v></c>`
      }).join('')
      return `<row r="${r}"${ra}>${cs}</row>`
    }).join('') + '</sheetData>'

    const mergeXml = this.merges.length
      ? `<mergeCells count="${this.merges.length}">${this.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : ''

    // Conditional formatting (colorScale, 3-point)
    const cfXml = this.cfRules.map(({ sqref, colors, priority }) => `
<conditionalFormatting sqref="${sqref}">
  <cfRule type="colorScale" priority="${priority}">
    <colorScale>
      <cfvo type="min"/>
      <cfvo type="percentile" val="50"/>
      <cfvo type="max"/>
      <color rgb="${colors[0]}"/>
      <color rgb="${colors[1]}"/>
      <color rgb="${colors[2]}"/>
    </colorScale>
  </cfRule>
</conditionalFormatting>`).join('')

    const viewXml = `<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>`

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      viewXml + colsXml + sheetDataXml + mergeXml + cfXml +
      '</worksheet>'
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD STUDY SHEET
// ═══════════════════════════════════════════════════════════════════════════
function buildSheet(study: PowerStudyResult): { sheetXml: string; stylesXml: string } {
  const sr = new StyleRegistry()
  const sh = new SheetBuilder()
  const s  = (opts: Parameters<StyleRegistry['s']>[0]) => sr.s(opts)

  const pc    = study.potenciaContratada ?? {}
  const meses = study.meses ?? []
  const n     = meses.length
  const hasMax = study.hasRealMaximetros !== false && Object.values(study.maxPotencia || {}).some(v => v > 0)

  // ── Adjustment warning (live recompute ±15%) ─────────────────────────────
  const periodsOutOfRange = PERIODS.filter(p => {
    const max = study.maxPotencia?.[p] || 0
    const contracted = (pc as Record<string, number>)[p] || 0
    if (!contracted || !max) return false
    const r = max / contracted
    return r > 1.15 || r < 0.85
  })
  const needsAdj = periodsOutOfRange.length > 0
  const adjText  = needsAdj ? `OBLIGATORIO AJUSTAR ${periodsOutOfRange.join(' · ')}` : 'Potencias dentro de rango'

  // ── Column widths (A-P) ──────────────────────────────────────────────────
  // A=20, B=16, C=12, D-I=9, J=2 (sep), K-P=11
  ;[20,16,12,9,9,9,9,9,9,2,11,11,11,11,11,11].forEach((w, i) => sh.cw(i + 1, w))

  // ── Row heights ──────────────────────────────────────────────────────────
  sh.rh(1, 17)   // header
  sh.rh(2, 17)   // totals
  sh.rh(3, 25)   // company name (taller, size 16)
  sh.rh(4, 19)   // PRIORIZAR
  sh.rh(5, 17)   // contracted power

  // ──────────────────────────────────────────────────────────────────────────
  // ROW 1 — column headers (no fill, bold, size 10, centred)
  // ──────────────────────────────────────────────────────────────────────────
  const hS  = s({ bold: true, size: 10 })          // header: no fill
  const hSL = s({ bold: true, size: 10, center: false }) // left-aligned header

  sh.cell(1, 1,  'CUPS',         hSL)
  sh.cell(1, 2,  '',             hS)
  sh.cell(1, 3,  'CONSUMO ANUAL', hS)
  PERIODS.forEach((p, i) => sh.cell(1, 4 + i, `${p} Activa`,    hS))
  sh.cell(1, 10, '',             hS)                // separator
  if (hasMax) PERIODS.forEach((p, i) => sh.cell(1, 11 + i, `${p} Maximetro`, hS))

  // ──────────────────────────────────────────────────────────────────────────
  // ROW 2 — CUPS code + annual totals + MAX values per period
  // ──────────────────────────────────────────────────────────────────────────
  const tot12 = s({ size: 12 })
  const tot12L = s({ size: 12, center: false })

  sh.cell(2, 1, study.cups || '', tot12L)
  sh.cell(2, 2, '', tot12)
  sh.cell(2, 3, Math.round(study.consumoTotal || 0), tot12)
  PERIODS.forEach((p, i) => {
    sh.cell(2, 4 + i, Math.round(study.consumoPorPeriodo?.[p] || 0), tot12)
  })
  sh.cell(2, 10, '', tot12)

  if (hasMax) {
    PERIODS.forEach((p, i) => {
      const val = study.maxPotencia?.[p] || 0
      const contracted = (pc as Record<string, number>)[p] || 0
      // Red fill if >±10% of contracted; otherwise no fill
      const outOfRange = contracted > 0 && val > 0 && (val / contracted > 1.10 || val / contracted < 0.90)
      const bg = outOfRange ? 'FF0000' : ''
      const fc = outOfRange ? 'FFFFFF' : '000000'
      sh.cell(2, 11 + i, val ? Math.round(val * 1000) / 1000 : 0,
        s({ bold: true, size: 12, bg, fc }))
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ROW 3 — Company name (merged A3:C3) + % per period + OBLIGATORIO (merged K3:P4)
  // ──────────────────────────────────────────────────────────────────────────
  sh.cell(3, 1, study.clientName || '', s({ bold: true, size: 16 }))
  sh.merge(3, 1, 3, 3)
  sh.cell(3, 2, '', s({ size: 16 }))
  sh.cell(3, 3, '', s({ size: 16 }))

  PERIODS.forEach((p, i) => {
    const pctVal = study.consumoPorcentaje?.[p] || 0
    sh.cell(3, 4 + i, Math.round(pctVal * 10000) / 100,
      s({ bold: true, size: 12, numFmt: '0.00"%"' }))
  })
  sh.cell(3, 10, '', s({}))

  if (hasMax) {
    const adjBg = needsAdj ? 'FFFF00' : 'E2F0D9'
    const adjFc = needsAdj ? 'C00000' : '375623'
    sh.cell(3, 11, adjText, s({ bold: true, size: 14, bg: adjBg, fc: adjFc }))
    sh.merge(3, 11, 4, 16)   // K3:P4 — OBLIGATORIO spans rows 3 & 4
    for (let c = 12; c <= 16; c++) sh.cell(3, c, '', s({ bg: adjBg }))
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ROW 4 — PRIORIZAR recommendation (merged D4:I4)
  // ──────────────────────────────────────────────────────────────────────────
  const top  = study.topConsumoPeriods || []
  const reco = top.length ? `PRIORIZAR CONSUMO ${top.join(' - ')}` : ''
  sh.cell(4, 1, '', s({}))
  sh.cell(4, 2, '', s({}))
  sh.cell(4, 3, '', s({}))
  sh.cell(4, 4, reco, s({ bold: true, size: 11, bg: 'FAD7A0', fc: '1F3864' }))
  if (reco) sh.merge(4, 4, 4, 9)
  for (let c = 5; c <= 9; c++) sh.cell(4, c, '', s({ bg: reco ? 'FAD7A0' : '' }))
  sh.cell(4, 10, '', s({}))
  // K4-P4 are part of the OBLIGATORIO merge (K3:P4) — no extra cells needed

  // ──────────────────────────────────────────────────────────────────────────
  // ROW 5 — Potencia Contratada (ONLY ADDITION vs reference)
  // ──────────────────────────────────────────────────────────────────────────
  const pcBg  = 'EBF5FB'
  const pcS   = s({ bg: pcBg })
  sh.cell(5, 1, 'Pot. Contratada (kW)', s({ bold: true, size: 9, bg: pcBg, center: false }))
  sh.cell(5, 2, '', pcS); sh.cell(5, 3, '', pcS)
  PERIODS.forEach((_, i) => sh.cell(5, 4 + i, '', pcS))
  sh.cell(5, 10, '', s({}))
  if (hasMax) {
    PERIODS.forEach((p, i) => {
      const val = (pc as Record<string, number>)[p] || 0
      sh.cell(5, 11 + i, val ? Math.round(val * 1000) / 1000 : '',
        s({ bold: true, bg: pcBg, fc: '1565C0' }))
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ROWS 6 to 5+n — Monthly data (raw values, no manual colours — CF handles it)
  // ──────────────────────────────────────────────────────────────────────────
  const plainS = s({ size: 9 })
  const dateS  = s({ size: 9, center: false })

  for (let mi = 0; mi < n; mi++) {
    const mes = meses[mi]
    const r   = 6 + mi
    sh.rh(r, 17)

    sh.cell(r, 1, Math.round(mes.consumoTotal || 0), plainS)
    sh.cell(r, 2, mes.fechaInicio || '', dateS)
    sh.cell(r, 3, mes.fechaFin   || '', dateS)
    PERIODS.forEach((p, i) => {
      sh.cell(r, 4 + i, Math.round(mes.consumo?.[p] || 0), plainS)
    })
    sh.cell(r, 10, '', s({}))
    if (hasMax) {
      PERIODS.forEach((p, i) => {
        const val = mes.maximetro?.[p] || 0
        sh.cell(r, 11 + i, val ? Math.round(val * 1000) / 1000 : 0, plainS)
      })
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REACTIVA section (if applicable) — kept, placed after data
  // ──────────────────────────────────────────────────────────────────────────
  if (study.hasRelevantReactiva && study.reactivaPorPeriodo) {
    const rt = 6 + n + 1
    sh.rh(rt, 20)
    sh.cell(rt, 1, 'ENERGÍA REACTIVA (kvarh)  —  SE DETECTA PENALIZACIÓN',
      s({ bold: true, size: 10, fc: 'FFFFFF', bg: 'C00000' }))
    sh.merge(rt, 1, rt, 8)
    for (let c = 2; c <= 8; c++) sh.cell(rt, c, '', s({ bg: 'C00000' }))

    const rh = rt + 1
    sh.rh(rh, 18)
    ;['Fecha Inicio', 'Fecha Fin', ...PERIODS.map(p => `Reactiva ${p} (kvarh)`)].forEach((v, i) => {
      sh.cell(rh, i + 1, v, s({ bold: true, fc: 'FFFFFF', bg: 'C55A11' }))
    })

    for (let mi = 0; mi < n; mi++) {
      const mes     = meses[mi]
      const r       = rh + 1 + mi
      const reactiva = mes.reactiva ?? {}
      const rv = reactiva as Record<string, number>
      const maxV = Math.max(...PERIODS.map(p => rv[p] || 0))
      const rowBg = maxV > 1000 ? 'FCE4D6' : 'F2F2F2'
      sh.cell(r, 1, mes.fechaInicio || '', s({ bg: rowBg, center: false }))
      sh.cell(r, 2, mes.fechaFin   || '', s({ bg: rowBg, center: false }))
      PERIODS.forEach((p, i) => {
        const v  = rv[p] || 0
        const bg = v > 1000 ? 'FCE4D6' : v > 0 ? 'E2F0D9' : 'FFFFFF'
        const fc = v > 1000 ? 'C00000' : '000000'
        sh.cell(r, 3 + i, v ? Math.round(v) : 0, s({ fc, bg }))
      })
    }

    const tr = rh + 1 + n
    sh.rh(tr, 16)
    sh.cell(tr, 1, 'TOTAL', s({ bold: true, bg: 'F2F2F2', center: false }))
    sh.cell(tr, 2, '', s({ bg: 'F2F2F2' }))
    PERIODS.forEach((p, i) => {
      sh.cell(tr, 3 + i, Math.round(study.reactivaPorPeriodo?.[p] || 0), s({ bold: true, bg: 'F2F2F2' }))
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONDITIONAL FORMATTING — colorScale (matches reference exactly)
  // Data rows are R6 to R{5+n}
  // ──────────────────────────────────────────────────────────────────────────
  if (n > 0) {
    const lastDataRow = 5 + n
    // Monthly totals (col A): green→yellow→red
    sh.colorScale(`A6:A${lastDataRow}`,           GYR, 5)
    // % row (D3:I3): green→yellow→red
    sh.colorScale('D3:I3',                        GYR, 3)
    // Period consumption data: green→yellow→red
    sh.colorScale(`D6:I${lastDataRow}`,           GYR, 6)
    // Maximetro data: blue→white→red
    if (hasMax) sh.colorScale(`K6:P${lastDataRow}`, BWR, 7)
  }

  return { sheetXml: sh.toXml(), stylesXml: sr.toXml() }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRC32
// ═══════════════════════════════════════════════════════════════════════════
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIP BUILDER  (PKZIP 2.0 — deflate, no ZIP64)
// ═══════════════════════════════════════════════════════════════════════════
function buildZip(files: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = []
  const cdParts:    Buffer[] = []
  const offsets:    number[] = []
  let offset = 0

  for (const file of files) {
    const nameBuf    = Buffer.from(file.name, 'utf8')
    const dataBuf    = Buffer.from(file.content, 'utf8')
    const compressed = deflateRawSync(dataBuf, { level: 6 })
    const crc        = crc32(dataBuf)
    offsets.push(offset)

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0, 6)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt16LE(0, 10)
    lh.writeUInt16LE(0, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(compressed.length, 18)
    lh.writeUInt32LE(dataBuf.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    localParts.push(lh, nameBuf, compressed)
    offset += 30 + nameBuf.length + compressed.length
  }

  for (let fi = 0; fi < files.length; fi++) {
    const file       = files[fi]
    const nameBuf    = Buffer.from(file.name, 'utf8')
    const dataBuf    = Buffer.from(file.content, 'utf8')
    const compressed = deflateRawSync(dataBuf, { level: 6 })
    const crc        = crc32(dataBuf)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(dataBuf.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offsets[fi], 42)
    cdParts.push(cd, nameBuf)
  }

  const cdBuf = Buffer.concat(cdParts)
  const eocd  = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, cdBuf, eocd])
}

// ═══════════════════════════════════════════════════════════════════════════
// STATIC XLSX MANIFEST FILES
// ═══════════════════════════════════════════════════════════════════════════
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Estudio Potencias" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`

const SHARED_STRINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>`

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const study: PowerStudyResult = await request.json()
    const { sheetXml, stylesXml } = buildSheet(study)

    const xlsxBuf = buildZip([
      { name: '[Content_Types].xml',          content: CONTENT_TYPES  },
      { name: '_rels/.rels',                  content: RELS           },
      { name: 'xl/workbook.xml',              content: WORKBOOK       },
      { name: 'xl/_rels/workbook.xml.rels',   content: WORKBOOK_RELS  },
      { name: 'xl/styles.xml',               content: stylesXml      },
      { name: 'xl/sharedStrings.xml',        content: SHARED_STRINGS },
      { name: 'xl/worksheets/sheet1.xml',    content: sheetXml       },
    ])

    const slug = (study.clientName || study.cups || 'estudio')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '').trim()
      .replace(/\s+/g, '_').slice(0, 40)

    return new NextResponse(new Uint8Array(xlsxBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Estudio_Potencias_${slug}.xlsx"`,
        'Content-Length': String(xlsxBuf.length),
      },
    })
  } catch (err: any) {
    const msg = err?.message || 'Error generando Excel'
    console.error('[power-study-excel] Error:', msg, err?.stack)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
