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

// ── Maximetro cell colour (matches PowerStudy.tsx classifyMaximetro) ──────
function maxCellStyle(val: number, contracted: number): string {
  if (val <= 0) return `background-color:#DDEEFF;color:#4A6FA5;${PCA}`
  if (contracted <= 0) return `background-color:#F8C4C4;${PCA}`
  const ratio = val / contracted
  if (ratio > 1.0) return `background-color:#F8696B;color:#7B0000;font-weight:700;${PCA}`
  if (ratio >= 0.85) return `background-color:#FFC7CE;color:#9C0006;${PCA}`
  if (ratio >= 0.50) return `background-color:#BDD7EE;color:#1F4E79;${PCA}`
  return `background-color:#2E75B6;color:#fff;font-weight:700;${PCA}`
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
  const hasMax = meses_hasMax(study)
  const pc     = study.potenciaContratada ?? {}
  const meses  = study.meses ?? []

  // ── ColorScale per-column (matches app: relative within each column) ─────
  function makeColScale(vals: number[]) { return makeScale(vals, GYR) }

  const totalCs = makeColScale(meses.map(m => m.consumoTotal || 0))
  const periodoScales: Record<string, (v:number)=>string> = {}
  PERIODS.forEach(p => {
    periodoScales[p] = makeColScale(meses.map(m => m.consumo?.[p] || 0))
  })
  const periodoTotal: Record<string, number> = {}
  PERIODS.forEach(p => {
    periodoTotal[p] = meses.reduce((s, m) => s + (m.consumo?.[p] || 0), 0)
  })
  const consumoTotal = meses.reduce((s, m) => s + (m.consumoTotal || 0), 0)
  const pctScale = makeColScale(PERIODS.map(p => consumoTotal > 0 ? periodoTotal[p] / consumoTotal : 0))
  const annualScale = makeColScale(PERIODS.map(p => periodoTotal[p]))

  const maxPotencia: Record<string, number> = {}
  PERIODS.forEach(p => { maxPotencia[p] = Math.max(...meses.map(m => m.maximetro?.[p] || 0), 0) })

  const cs = (color: string) => color !== 'transparent' ? `background-color:${color};${PCA}` : ''
  const bgC = (v: number, scale: (n:number)=>string) => v > 0 ? cs(scale(v)) : `background-color:#63BE7B;${PCA}`

  // ── Adjustment / priority messages ──────────────────────────────────────
  const periodsExcess = PERIODS.filter(p => {
    const cont = (pc as any)[p] || 0
    return cont > 0 && (maxPotencia[p] || 0) > cont
  })
  const periodsLow = PERIODS.filter(p => {
    const cont = (pc as any)[p] || 0
    const mx = maxPotencia[p] || 0
    return cont > 0 && mx > 0 && mx < cont * 0.85 && !periodsExcess.includes(p)
  })
  let adjText: string, adjBg: string, adjColor: string
  if (periodsExcess.length > 0) {
    adjText = `AJUSTAR POTENCIAS ${periodsExcess.join(' · ')}`
    adjBg = '#FFFF00'; adjColor = '#C00000'
  } else if (periodsLow.length > 0) {
    adjText = `POSIBLE REDUCCION EN ${periodsLow.join(' · ')}`
    adjBg = '#BDD7EE'; adjColor = '#1F4E79'
  } else {
    adjText = 'POTENCIAS DENTRO DE RANGO'
    adjBg = '#E2F0D9'; adjColor = '#375623'
  }

  const activePeriods = PERIODS.filter(p => periodoTotal[p] > 0)
    .sort((a, b) => periodoTotal[b] - periodoTotal[a])
  const prioMsg = activePeriods.length > 0 ? 'PRIORIZAR CONSUMO ' + activePeriods.slice(0,3).join(' - ') : ''

  // ── Separator column ─────────────────────────────────────────────────────
  const SEP = `<td style="width:4px;min-width:4px;padding:0;background:#E0E0E0;border:none" rowspan="1"></td>`
  const SEP_TH = `<th style="width:4px;min-width:4px;padding:0;background:#E0E0E0;border:none"></th>`

  // ── Data rows ─────────────────────────────────────────────────────────────
  const dataRows = meses.map(m => {
    const tot = m.consumoTotal || 0
    const consumoCells = PERIODS.map(p => {
      const v = m.consumo?.[p] || 0
      return `<td style="${bgC(v, periodoScales[p])}">${fmtKwh(v)}</td>`
    }).join('')
    const maxCells = hasMax ? PERIODS.map(p => {
      const val = m.maximetro?.[p] || 0
      const con = (pc as any)[p] || 0
      return `<td style="${maxCellStyle(val, con)};text-align:center">${val > 0 ? fmtKw(val) : '-'}</td>`
    }).join('') : ''
    return `<tr>
      <td style="${bgC(tot, totalCs)};font-weight:700">${fmtKwh(tot)}</td>
      <td style="text-align:center;color:#444">${fmtDate(m.fechaInicio)}</td>
      <td style="text-align:center;color:#444">${fmtDate(m.fechaFin)}</td>
      ${consumoCells}${SEP}${maxCells}
    </tr>`
  }).join('')

  // ── Reactiva alert ────────────────────────────────────────────────────────
  const reactivaAlert = study.hasRelevantReactiva
    ? `<div style="display:flex;align-items:center;gap:6px;margin-top:8px;padding:6px 10px;background:#FEF3E2;border:1.5px solid #FAD7A0;border-radius:4px;${PCA}">
        <span style="font-size:8pt;font-weight:700;color:#7B3F00;">&#9888; CHECKEAR REACTIVAS — se detectan valores superiores a 1.000 kvarh</span>
       </div>`
    : ''

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

  table { border-collapse:collapse; font-size:7pt; }
  th, td { border:1px solid #C8C8C8; padding:2px 4px; text-align:right; white-space:nowrap; }
  th { text-align:center; }

  .hdr-dark { background-color:#404040;${PCA}; color:#fff; font-weight:700; text-align:center; font-size:7.5pt; letter-spacing:0.04em; }
  .hdr-col  { background-color:#595959;${PCA}; color:#fff; font-weight:700; text-align:center; }
  .total-row{ background-color:#D9D9D9;${PCA}; font-weight:700; border-top:2px solid #595959; }
  .chart-wrap { page-break-inside:avoid; margin-top:10px; }

  @media print {
    * { print-color-adjust:exact !important; -webkit-print-color-adjust:exact !important; }
  }
</style>
</head>
<body>

  <div class="header-bar">
    ${voltisLogoSVG()}
    <div class="title-info">
      <div class="study-title">ESTUDIO DE POTENCIAS Y CONSUMOS${study.clientName ? ' · ' + study.clientName : ''}</div>
      <div class="study-sub">${study.cups || ''}</div>
    </div>
    <div class="header-date">${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' })}</div>
  </div>

  <table>
    <colgroup>
      <col style="min-width:76px"/>
      <col style="min-width:60px"/>
      <col style="min-width:60px"/>
      ${PERIODS.map(() => `<col style="min-width:52px"/>`).join('')}
      <col style="width:4px"/>
      ${hasMax ? PERIODS.map(() => `<col style="min-width:58px"/>`).join('') : ''}
    </colgroup>
    <thead>
      <!-- Row 0: section labels -->
      <tr>
        <th class="hdr-dark" colspan="3" style="text-align:left;padding-left:8px">${study.clientName || study.cups || 'PUNTO DE SUMINISTRO'}</th>
        <th class="hdr-dark" colspan="6" style="font-size:7pt;letter-spacing:0.06em">&#9889; CONSUMOS ACTIVA (kWh)</th>
        ${SEP_TH}
        ${hasMax ? `<th class="hdr-dark" colspan="6" style="font-size:7pt;letter-spacing:0.06em">MAXÍMETROS (kW)</th>` : ''}
      </tr>
      <!-- Row 1: column labels -->
      <tr>
        <th class="hdr-col" style="text-align:right">kWh Total</th>
        <th class="hdr-col">F. Inicio</th>
        <th class="hdr-col">F. Fin</th>
        ${PERIODS.map(p => `<th class="hdr-col">${p}</th>`).join('')}
        ${SEP_TH}
        ${hasMax ? PERIODS.map(p => `<th class="hdr-col">${p}</th>`).join('') : ''}
      </tr>
      <!-- Row 2: annual totals -->
      <tr>
        <td style="background-color:#C6EFCE;${PCA};color:#1F5C2E;font-weight:700;text-align:right;font-size:9pt">${fmtKwh(consumoTotal)}</td>
        <td style="background-color:#E2F0D9;${PCA};font-style:italic;font-size:6.5pt;color:#555;text-align:center">${(study.cups||'').slice(0,22)}</td>
        <td style="background-color:#E2F0D9;${PCA};font-weight:700;text-align:center;font-size:7pt;color:#375623">ANUAL</td>
        ${PERIODS.map(p => `<td style="${cs(annualScale(periodoTotal[p]))};font-weight:700;color:#1F3864">${fmtKwh(periodoTotal[p])}</td>`).join('')}
        ${SEP}
        ${hasMax ? PERIODS.map(p => {
          const mx = maxPotencia[p]; const con = (pc as any)[p] || 0
          return `<td style="${maxCellStyle(mx,con)};font-weight:700;text-align:center">${mx>0?fmtKw(mx):'-'}</td>`
        }).join('') : ''}
      </tr>
      <!-- Row 3: % per period + contracted power -->
      <tr>
        <td style="background-color:#F2F2F2;${PCA};font-weight:700;text-align:right;color:#555">100.00%</td>
        <td colspan="2" style="background-color:#F2F2F2;${PCA};text-align:center;font-weight:700;color:#555">% POR PERIODO</td>
        ${PERIODS.map(p => {
          const pct = consumoTotal > 0 ? periodoTotal[p]/consumoTotal : 0
          const bg = pct > 0 ? cs(pctScale(pct)) : `background-color:#F2F2F2;${PCA}`
          return `<td style="${bg};font-weight:700;color:#1F3864">${pct>0?(pct*100).toFixed(2)+'%':'-'}</td>`
        }).join('')}
        ${SEP}
        ${hasMax ? PERIODS.map(p => {
          const con = (pc as any)[p] || 0
          return `<td style="background-color:#D9E1F2;${PCA};font-weight:700;color:#1F3864;text-align:center">${con>0?fmtKw(con):'-'}</td>`
        }).join('') : ''}
      </tr>
      <!-- Row 4: priority + adjustment messages -->
      <tr>
        <td colspan="9" style="background-color:${prioMsg?'#FAD7A0':'#F5F5F5'};${PCA};color:#7B3F00;font-weight:700;text-align:center;font-size:7.5pt;padding:3px 8px">${prioMsg||''}</td>
        ${SEP}
        ${hasMax ? `<td colspan="6" style="background-color:${adjBg};${PCA};color:${adjColor};font-weight:700;text-align:center;font-size:7pt;padding:3px 8px">${adjText}</td>` : ''}
      </tr>
    </thead>
    <tbody>
      ${dataRows}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td>${fmtKwh(consumoTotal)}</td>
        <td colspan="2" style="text-align:center">TOTAL</td>
        ${PERIODS.map(p => `<td>${fmtKwh(periodoTotal[p])}</td>`).join('')}
        ${SEP}
        ${hasMax ? PERIODS.map(p => {
          const mx = maxPotencia[p]; const con = (pc as any)[p] || 0
          return `<td style="${maxCellStyle(mx,con)};font-weight:700;text-align:center;border-top:2px solid #595959">${mx>0?fmtKw(mx):'-'}</td>`
        }).join('') : ''}
      </tr>
    </tfoot>
  </table>

  ${hasMax ? `<div style="display:flex;gap:8px;margin-top:5px;font-size:6.5pt;color:#555;flex-wrap:wrap">
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;background:#F8696B;${PCA};display:inline-block;border-radius:2px"></span>Exceso (&gt;contratada)</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;background:#FFC7CE;${PCA};display:inline-block;border-radius:2px"></span>Dentro de rango (±15%)</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;background:#BDD7EE;${PCA};display:inline-block;border-radius:2px"></span>Infrautilizado (&lt;85%)</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;background:#2E75B6;${PCA};display:inline-block;border-radius:2px"></span>Muy bajo (&lt;50%)</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;background:#DDEEFF;${PCA};display:inline-block;border-radius:2px"></span>Sin dato</span>
  </div>` : ''}

  ${reactivaAlert}
  ${barChart ? `<div class="chart-wrap">${barChart}</div>` : ''}

  <div style="margin-top:5px;font-size:6pt;color:#AAA;text-align:right">
    Voltis Energía · ${study.cups}${study.autoGenerated ? ' · Generado automáticamente desde SIPS' : ''}${!study.hasRealMaximetros ? ' · Sin maxímetros SIPS' : ''}
  </div>

<script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body>
</html>`
}

function meses_hasMax(study: PowerStudyResult): boolean {
  return study.hasRealMaximetros !== false && Object.values(study.maxPotencia ?? {}).some(v => (v as number) > 0)
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
