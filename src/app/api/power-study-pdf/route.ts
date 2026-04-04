import { NextRequest, NextResponse } from 'next/server'
import type { PowerStudyResult } from '@/app/api/power-study/route'

/**
 * POST /api/power-study-pdf
 *
 * Generates a compact spreadsheet-style HTML table for PDF export (print to PDF).
 * Visual format mirrors the reference Excel exactly:
 *   • Uniform medium-gray column headers (no per-section colour coding)
 *   • ColorScale gradient for all data cells (green→yellow→red for consumption,
 *     blue→white→red for maximetros) — same algorithm as Excel colorScale CF
 *   • Fixed fills only for OBLIGATORIO (yellow), PRIORIZAR (orange),
 *     contracted-power row (light blue) and max-summary cells (red/green)
 * Includes Voltis Energía logo and monthly consumption bar chart.
 */

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = typeof PERIODS[number]

const PCA = 'print-color-adjust:exact;-webkit-print-color-adjust:exact'

// ── Formatters ─────────────────────────────────────────────────────────────
function fmtKw(v: number): string {
  if (v === 0) return '-'
  return v.toFixed(3).replace(/\.?0+$/, '') || '0'
}
function fmtKwh(v: number): string {
  if (v === 0) return '0'
  return v.toLocaleString('es-ES')
}
function fmtDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return dateStr?.slice(0, 10) || '' }
}

// ── ColorScale helpers (identical algorithm to Excel colorScale CF) ────────
// 3-point: min → percentile-50 → max
type CS3 = [string, string, string]
const GYR: CS3 = ['#63BE7B', '#FFEB84', '#F8696B']  // green → yellow → red
const BWR: CS3 = ['#5A8AC6', '#FCFCFF', '#F8696B']  // blue  → white  → red

function lerpHex(c1: string, c2: string, t: number): string {
  const h = (s: string) => [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)]
  const [r1,g1,b1] = h(c1), [r2,g2,b2] = h(c2)
  const p = (a: number, b: number) => Math.round(a+(b-a)*t).toString(16).padStart(2,'0')
  return `#${p(r1,r2)}${p(g1,g2)}${p(b1,b2)}`
}

/** Build a colorScale function from a flat array of all relevant values */
function makeScale(allVals: number[], cs: CS3): (v: number) => string {
  const pos = allVals.filter(v => v > 0)
  if (!pos.length) return () => 'transparent'
  const lo = Math.min(...pos), hi = Math.max(...pos)
  if (lo === hi) return () => cs[1]
  const sorted = [...pos].sort((a, b) => a - b)
  const mid = sorted[Math.floor((sorted.length - 1) / 2)]
  return (v: number): string => {
    if (v <= 0) return 'transparent'
    if (v <= lo) return cs[0]
    if (v >= hi) return cs[2]
    if (v <= mid) {
      const t = mid > lo ? (v - lo) / (mid - lo) : 0
      return lerpHex(cs[0], cs[1], t)
    }
    const t = hi > mid ? (v - mid) / (hi - mid) : 1
    return lerpHex(cs[1], cs[2], t)
  }
}

// ── Maximetro cell colour ─────────────────────────────────────────────────
// Dark red ONLY when that column's max exceeds ±15% of contracted power.
function maxCellStr(val: number, contracted: number, columnOutOfRange: boolean): string {
  if (val <= 0) return `background-color:#6BA3D6;color:#fff;${PCA}`
  if (contracted <= 0) return `background-color:#F8C4C4;${PCA}`
  if (columnOutOfRange) return `background-color:#F8696B;color:#7B1A1A;font-weight:700;${PCA}`
  return `background-color:#F8C4C4;${PCA}`
}

// ── Voltis Energía logo ───────────────────────────────────────────────────
function voltisLogoSVG(): string {
  return `<svg width="178" height="54" viewBox="0 0 178 54" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <text x="4" y="40" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="36" fill="#1A3A8C">Voltis</text>
    <polygon points="45,52 55,52 61,2 51,2" fill="#2E75B6" opacity="0.85"/>
    <text x="73" y="52" font-family="Arial,sans-serif" font-size="13" fill="#2E75B6" font-weight="400">energía</text>
    <polygon points="150,44 178,27 178,36 157,53 150,53" fill="#2E75B6" opacity="0.45"/>
  </svg>`
}

// ── Bar chart SVG ─────────────────────────────────────────────────────────
function generateBarChartSVG(meses: any[]): string {
  if (!meses?.length) return ''
  const W = 820, H = 220
  const mL = 70, mR = 16, mT = 26, mB = 52
  const cW = W - mL - mR, cH = H - mT - mB
  const vals = meses.map(m => m.consumoTotal || 0)
  const maxVal = Math.max(...vals)
  if (maxVal === 0) return ''
  const n = meses.length
  const slotW = cW / n
  const barW = Math.max(slotW - 4, 3)
  const steps = 5
  const stepVal = Math.ceil(maxVal / steps / 1000) * 1000 || Math.ceil(maxVal / steps)
  const gridLines = Array.from({ length: steps + 1 }, (_, i) => {
    const v = i * stepVal
    if (v > maxVal * 1.08) return ''
    const y = mT + cH - (v / (maxVal * 1.05)) * cH
    return `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W-mR}" y2="${y.toFixed(1)}" stroke="#E0E0E0" stroke-width="0.8"/>
            <text x="${(mL-6).toFixed(1)}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#666">${v.toLocaleString('es-ES')}</text>`
  }).join('')
  const bars = meses.map((m, i) => {
    const v = m.consumoTotal || 0
    const bH = v > 0 ? Math.max(2, (v / (maxVal * 1.05)) * cH) : 0
    const bx = mL + i * slotW + (slotW - barW) / 2
    const by = mT + cH - bH
    let label = ''
    try {
      const d = new Date(m.fechaFin || m.fechaInicio || '')
      const mn = d.toLocaleDateString('es-ES', { month: 'short' })
      label = `${mn.charAt(0).toUpperCase()}${mn.slice(1,3)} ${d.getFullYear().toString().slice(2)}`
    } catch { label = '' }
    const lx = (bx + barW / 2).toFixed(1)
    const ly = (mT + cH + 12).toFixed(1)
    const rotate = n > 18 ? `rotate(-40 ${lx} ${ly})` : ''
    const anchor = n > 18 ? 'end' : 'middle'
    // value label above bar (only if bar is tall enough)
    const valLabel = bH > 14
      ? `<text x="${lx}" y="${(by - 3).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#333">${v.toLocaleString('es-ES')}</text>`
      : ''
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="#2E75B6" rx="1" style="${PCA}"/>
            ${valLabel}
            <text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="7.5" fill="#444" transform="${rotate}">${label}</text>`
  }).join('')
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">
    <text x="${W/2}" y="16" text-anchor="middle" font-size="10" font-weight="bold" fill="#1A3A8C" font-family="Arial,Helvetica,sans-serif">Consumo mensual normalizado (kWh)</text>
    ${gridLines}
    <line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT+cH}" stroke="#999" stroke-width="1"/>
    <line x1="${mL}" y1="${mT+cH}" x2="${W-mR}" y2="${mT+cH}" stroke="#999" stroke-width="1"/>
    ${bars}
  </svg>`
}

// ═══════════════════════════════════════════════════════════════════════════
function generateHTML(study: PowerStudyResult): string {
  const hasMax = study.hasRealMaximetros !== false && Object.values(study.maxPotencia).some(v => v > 0)
  const top    = study.topConsumoPeriods || []
  const pc     = study.potenciaContratada ?? {}
  const meses  = study.meses ?? []

  // ── Adjustment warning (±15% live recompute) ─────────────────────────────
  const periodsOutOfRange = PERIODS.filter(p => {
    const max = study.maxPotencia?.[p] || 0
    const con = (pc as Record<string,number>)[p] || 0
    if (!con || !max) return false
    const r = max / con; return r > 1.15 || r < 0.85
  })
  const outOfRangeSet = new Set(periodsOutOfRange)
  const needsAdj  = periodsOutOfRange.length > 0
  const adjText   = needsAdj ? `OBLIGATORIO AJUSTAR ${periodsOutOfRange.join(' · ')}` : 'Potencias dentro de rango'
  const adjBg     = needsAdj ? '#FFFF00' : '#E2F0D9'
  const adjColor  = needsAdj ? '#C00000' : '#375623'
  const recoBanner = top.length ? 'PRIORIZAR CONSUMO ' + top.join(' - ') : ''

  // ── Build colorScale functions from ALL data in each range ────────────────
  // Matches Excel colorScale CF ranges exactly:
  //   A-col (monthly totals), D-I (period consumption), K-P (maximetros), D3:I3 (%)
  const allTotals   = meses.map(m => m.consumoTotal || 0)
  const allPeriod   = meses.flatMap(m => PERIODS.map(p => m.consumo?.[p] || 0))
  const allPct      = PERIODS.map(p => (study.consumoPorcentaje?.[p] || 0) * 100)

  const totalCs  = makeScale(allTotals,  GYR)
  const periodCs = makeScale(allPeriod,  GYR)
  const pctCs    = makeScale(allPct,     GYR)

  // Consumption cells: v=0 → green (#63BE7B), v>0 → colorScale
  const consumoBg = (v: number, scale: (n: number) => string): string =>
    v > 0 ? cs(scale(v)) : `background-color:#63BE7B;${PCA}`

  const cs = (color: string) =>
    color !== 'transparent'
      ? `background-color:${color};${PCA}`
      : ''

  // ── Consumption data rows ───────────────────────────────────────────────
  const consumoDataRows = meses.map(m => {
    const totVal = m.consumoTotal || 0
    const totColor = consumoBg(totVal, totalCs)
    const activaCells = PERIODS.map(p => {
      const v = m.consumo?.[p] || 0
      return `<td style="${consumoBg(v, periodCs)}">${fmtKwh(v)}</td>`
    }).join('')
    return `<tr>
        <td style="${totColor};font-weight:700">${fmtKwh(totVal)}</td>
        <td style="text-align:center">${fmtDate(m.fechaInicio)}</td>
        <td style="text-align:center">${fmtDate(m.fechaFin)}</td>
        ${activaCells}
      </tr>`
  }).join('')

  // ── Maximeter data rows ───────────────────────────────────────────────────
  const maxDataRows = hasMax ? meses.map(m => {
    const maxCells = PERIODS.map(p => {
      const val = m.maximetro?.[p] || 0
      const con = (pc as Record<string,number>)[p] || 0
      return `<td style="${maxCellStr(val, con, outOfRangeSet.has(p))}">${val > 0 ? fmtKw(val) : '-'}</td>`
    }).join('')
    return `<tr>${maxCells}</tr>`
  }).join('') : ''

  // ── Total rows ────────────────────────────────────────────────────────────
  const totalActivaCells = PERIODS.map(p => {
    const v = study.consumoPorPeriodo?.[p] || 0
    return `<td style="${consumoBg(v, periodCs)};font-weight:700">${fmtKwh(v)}</td>`
  }).join('')
  const totalMaxCells = hasMax ? PERIODS.map(p => {
    const val = study.maxPotencia?.[p] || 0
    const con = (pc as Record<string,number>)[p] || 0
    return `<td style="${maxCellStr(val, con, outOfRangeSet.has(p))}">${val > 0 ? fmtKw(val) : '-'}</td>`
  }).join('') : ''

  // ── Reactiva section ──────────────────────────────────────────────────────
  const hasReactiva = study.hasRelevantReactiva && study.reactivaPorPeriodo
  const reactivaSection = hasReactiva ? `
    <table class="reactiva-tbl">
    <tr class="rva-hdr"><td colspan="9">⚡ ENERGÍA REACTIVA (kvarh) — SE DETECTA PENALIZACIÓN</td></tr>
    <tr class="rva-sub">
      <th>Fecha Inicio</th><th>Fecha Fin</th><th></th>
      ${PERIODS.map(p => `<th>Reactiva ${p}</th>`).join('')}
    </tr>
    ${meses.map(m => {
      const rv = (m.reactiva || {}) as Record<string,number>
      return `<tr>${['','',...PERIODS].map((p,i) => {
        if (i === 0) return `<td>${fmtDate(m.fechaInicio)}</td>`
        if (i === 1) return `<td>${fmtDate(m.fechaFin)}</td>`
        if (i === 2) return `<td></td>`
        const v = rv[p] || 0
        const s = v > 1000 ? `background-color:#FCE4D6;color:#C00000;font-weight:700;${PCA}` : ''
        return `<td style="${s}">${v > 0 ? fmtKwh(v) : '-'}</td>`
      }).join('')}</tr>`
    }).join('')}
    <tr style="font-weight:700;background-color:#FEF3E2;${PCA}">
      <td colspan="3">TOTAL</td>
      ${PERIODS.map(p => `<td>${fmtKwh((study.reactivaPorPeriodo![p as keyof typeof study.reactivaPorPeriodo] as number) || 0)}</td>`).join('')}
    </tr>
    </table>` : ''

  const barChart = generateBarChartSVG(meses)

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Estudio Potencias - ${study.cups}</title>
<style>
  @page { size: A4 landscape; margin: 8mm 7mm; }
  * { margin:0; padding:0; box-sizing:border-box; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #111; background:#fff; }

  .header-bar {
    display:flex; justify-content:space-between; align-items:flex-end;
    border-bottom:3px solid #1A3A8C; padding-bottom:5px; margin-bottom:5px;
  }
  .title-info .study-title { font-size:10pt; color:#1A3A8C; font-weight:800; }
  .title-info .study-sub   { font-size:8pt; color:#444; }
  .header-date { font-size:8pt; color:#666; text-align:right; white-space:nowrap; }

  table { border-collapse:collapse; font-size:7.5pt; width:100%; }
  th, td { border:1px solid #C8C8C8; padding:2px 4px; text-align:right; white-space:nowrap; }
  th { text-align:center; }

  .hdr-col  { background-color:#595959;${PCA}; color:#fff; font-weight:700; text-align:center; }
  .hdr-max  { background-color:#1A4A7A;${PCA}; color:#fff; font-weight:700; text-align:center; font-size:7pt; text-transform:uppercase; letter-spacing:0.05em; }
  .hdr-pc   { background-color:#EBF5FB;${PCA}; font-weight:700; }

  .hdr-reco { background-color:#FAD7A0;${PCA}; color:#1F3864; font-weight:700; text-align:center; }
  .hdr-adj  { background-color:${adjBg};${PCA}; color:${adjColor}; font-weight:700; text-align:center; }

  .total-row{ background-color:#F2F2F2;${PCA}; font-weight:700; border-top:2px solid #888; }

  .rva-hdr td { background-color:#C00000;${PCA}; color:#fff; font-weight:700; text-align:left; font-size:8pt; }
  .rva-sub th  { background-color:#C55A11;${PCA}; color:#fff; }
  .reactiva-tbl { width:100%; margin-top:8px; }

  .legend { display:flex; gap:10px; margin-top:4px; font-size:6.5pt; color:#555; }
  .legend-item { display:flex; align-items:center; gap:3px; }
  .legend-swatch { width:10px; height:10px; border-radius:2px; display:inline-block; }

  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .chart-wrap { page-break-inside:avoid; }

  @media print {
    body { padding:0; }
    * { print-color-adjust:exact !important; -webkit-print-color-adjust:exact !important; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
  }
</style>
</head>
<body>

<!-- PAGE 1: CONSUMOS ACTIVA -->
<div class="page">
  <div class="header-bar">
    ${voltisLogoSVG()}
    <div class="title-info">
      <div class="study-title">ESTUDIO DE POTENCIAS Y CONSUMOS${study.clientName ? ' · ' + study.clientName : ''}</div>
      <div class="study-sub">${study.cups || ''}</div>
    </div>
    <div class="header-date">${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' })}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="hdr-col" style="text-align:left;min-width:95px">kWh</th>
        <th class="hdr-col" style="min-width:58px">F. Inicio</th>
        <th class="hdr-col" style="min-width:58px">F. Fin</th>
        ${PERIODS.map(p => `<th class="hdr-col">${p}</th>`).join('')}
      </tr>
      <tr>
        <td style="font-weight:700;text-align:left;font-size:6.5pt;font-family:monospace">${study.cups || ''}</td>
        <td></td>
        <td style="text-align:center;font-weight:700">${fmtKwh(study.consumoTotal)}</td>
        ${PERIODS.map(p => {
          const v = study.consumoPorPeriodo?.[p] || 0
          return `<td style="${consumoBg(v, periodCs)};font-weight:700">${fmtKwh(v)}</td>`
        }).join('')}
      </tr>
      <tr>
        <td style="font-weight:700;text-align:left">${study.clientName || ''}</td>
        <td></td><td></td>
        ${PERIODS.map(p => {
          const pv = (study.consumoPorcentaje?.[p] || 0) * 100
          return `<td style="${cs(pctCs(pv))};font-weight:700">${pv.toFixed(2)}%</td>`
        }).join('')}
      </tr>
      ${recoBanner ? `<tr>
        <td colspan="3"></td>
        <td class="hdr-reco" colspan="6">${recoBanner}</td>
      </tr>` : ''}
    </thead>
    <tbody>
      ${consumoDataRows}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td style="font-weight:700">${fmtKwh(study.consumoTotal)}</td>
        <td colspan="2" style="text-align:center;font-weight:700">TOTAL</td>
        ${totalActivaCells}
      </tr>
    </tfoot>
  </table>
</div>

${hasMax ? `
<!-- PAGE 2: MAXÍMETROS -->
<div class="page">
  <div class="header-bar">
    ${voltisLogoSVG()}
    <div class="title-info">
      <div class="study-title">MAXÍMETROS${study.clientName ? ' · ' + study.clientName : ''}</div>
      <div class="study-sub">${study.cups || ''}</div>
    </div>
    <div class="header-date">${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' })}</div>
  </div>

  <table>
    <thead>
      <tr>
        ${PERIODS.map(p => `<th class="hdr-max">${p}</th>`).join('')}
      </tr>
      <tr>
        ${PERIODS.map(p => {
          const v = (pc as Record<string,number>)[p]
          return `<td class="hdr-pc" style="color:#1565C0;font-weight:700;text-align:center">${v ? fmtKw(v) : '-'}</td>`
        }).join('')}
      </tr>
      <tr>
        ${PERIODS.map(p => {
          const val = study.maxPotencia?.[p] || 0
          const con = (pc as Record<string,number>)[p] || 0
          return `<td style="${maxCellStr(val, con, outOfRangeSet.has(p))}">${val > 0 ? fmtKw(val) : '-'}</td>`
        }).join('')}
      </tr>
      <tr>
        <td class="hdr-adj" colspan="6">${adjText}</td>
      </tr>
    </thead>
    <tbody>
      ${maxDataRows}
    </tbody>
    <tfoot>
      <tr class="total-row">
        ${totalMaxCells}
      </tr>
    </tfoot>
  </table>

  <div class="legend" style="margin-top:6px">
    <div class="legend-item"><span class="legend-swatch" style="background:#6BA3D6;${PCA}"></span> Sin dato</div>
    <div class="legend-item"><span class="legend-swatch" style="background:#F8C4C4;${PCA}"></span> &lt; 85% pot.</div>
    <div class="legend-item"><span class="legend-swatch" style="background:#F8696B;${PCA}"></span> &ge; 85% pot.</div>
  </div>

  ${reactivaSection}
</div>
` : reactivaSection ? `<div class="page">${reactivaSection}</div>` : ''}

<!-- PAGE 3 (or 2 if no maximeters): BAR CHART -->
${barChart ? `
<div class="page">
  <div class="header-bar">
    ${voltisLogoSVG()}
    <div class="title-info">
      <div class="study-title">CONSUMO MENSUAL${study.clientName ? ' · ' + study.clientName : ''}</div>
      <div class="study-sub">${study.cups || ''}</div>
    </div>
    <div class="header-date">${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' })}</div>
  </div>
  <div class="chart-wrap" style="margin-top:20px">${barChart}</div>
</div>
` : ''}

<div style="margin-top:5px;font-size:6pt;color:#AAA;text-align:right">
  Voltis Energía · ${study.cups}${study.autoGenerated ? ' · Generado automáticamente desde SIPS' : ''}${!study.hasRealMaximetros ? ' · Sin maxímetros SIPS' : ''}
</div>

<script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body>
</html>`
}

export async function POST(request: NextRequest) {
  try {
    const study: PowerStudyResult = await request.json()
    if (!study.cups || !study.consumoPorPeriodo) {
      return NextResponse.json({ error: 'Datos del estudio incompletos' }, { status: 400 })
    }
    return new NextResponse(generateHTML(study), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err: any) {
    console.error('[power-study-pdf] Error:', err)
    return NextResponse.json({ error: err.message || 'Error generando PDF' }, { status: 500 })
  }
}
