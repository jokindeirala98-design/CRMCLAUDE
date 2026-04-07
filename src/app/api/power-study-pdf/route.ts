import { NextRequest, NextResponse } from 'next/server'
import type { PowerStudyResult } from '@/app/api/power-study/route'

/**
 * POST /api/power-study-pdf
 *
 * Returns an HTML document (print-ready) that the browser opens and the user
 * prints to PDF.  Includes:
 *  - KPI summary cards
 *  - Excel-style data table (matching the official Voltis template)
 *  - Two SVG bar charts: consumo mensual + maxímetros
 *  - Chart images come from the browser (base64 PNG sent in body.charts)
 */

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = typeof PERIODS[number]

const PERIOD_COLORS: Record<Period, string> = {
  P1: '#4472C4', P2: '#ED7D31', P3: '#A9D18E',
  P4: '#FFC000', P5: '#5B9BD5', P6: '#70AD47',
}

// ─── Formatters ─────────────────────────────────────────────────────────────
function fmtKw(v: number): string {
  if (v === 0) return '-'
  return v.toFixed(3).replace(/\.?0+$/, '') || '0'
}
function fmtKwh(v: number): string {
  if (v === 0) return '0'
  return v.toLocaleString('es-ES')
}
function fmtDate(s: string): string {
  try {
    const d = new Date(s)
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return s?.slice(0, 10) || '' }
}
function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}

// ─── Color scale ─────────────────────────────────────────────────────────────
function lerpHex(c1: string, c2: string, t: number): string {
  const h = (s: string) => [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)]
  const [r1,g1,b1] = h(c1), [r2,g2,b2] = h(c2)
  const p = (a: number, b: number) => Math.round(a+(b-a)*t).toString(16).padStart(2,'0')
  return `#${p(r1,r2)}${p(g1,g2)}${p(b1,b2)}`
}
function makeScale(allVals: number[], cs: [string,string,string]): (v: number) => string {
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
    if (v <= mid) return lerpHex(cs[0], cs[1], mid > lo ? (v - lo) / (mid - lo) : 0)
    return lerpHex(cs[1], cs[2], hi > mid ? (v - mid) / (hi - mid) : 1)
  }
}
const GYR: [string,string,string] = ['#63BE7B', '#FFEB84', '#F8696B']
const BWR: [string,string,string] = ['#5A8AC6', '#FCFCFF', '#F8696B']

// ─── Adjustment logic (>15% above OR below contracted) ───────────────────────
interface PeriodAdj {
  period: Period
  max: number
  cont: number
  desvPct: number
  needs: boolean
  dir: 'excess' | 'under' | 'ok'
}

function calcAdj(study: PowerStudyResult): PeriodAdj[] {
  return PERIODS.map(p => {
    const max = study.maxPotencia?.[p] ?? 0
    const cont = study.potenciaContratada?.[p] ?? 0
    const desvPct = cont > 0 ? ((max - cont) / cont) * 100 : 0
    const needs = cont > 0 && max > 0 && Math.abs(desvPct) > 15
    return { period: p, max, cont, desvPct, needs, dir: needs ? (desvPct > 0 ? 'excess' : 'under') : 'ok' }
  })
}

// ─── Main HTML generator ─────────────────────────────────────────────────────
function generateHTML(study: PowerStudyResult, charts?: { consumption?: string; maximetro?: string }): string {
  const meses = study.meses ?? []
  const hasMax = meses.some(m => PERIODS.some(p => (m.maximetro?.[p] ?? 0) > 0))
  const pc = study.potenciaContratada

  // Totals
  const totalByPeriod: Record<string, number> = {}
  for (const p of PERIODS) totalByPeriod[p] = meses.reduce((s, m) => s + (m.consumo?.[p] ?? 0), 0)
  const grandTotal = PERIODS.reduce((s, p) => s + totalByPeriod[p], 0)
  const maxByPeriod: Record<string, number> = {}
  for (const p of PERIODS) maxByPeriod[p] = Math.max(...meses.map(m => m.maximetro?.[p] ?? 0), 0)

  // Color scales
  const allConsumoVals = meses.flatMap(m => PERIODS.map(p => m.consumo?.[p] ?? 0))
  const cs = makeScale(allConsumoVals, GYR)
  const allMaxVals = meses.flatMap(m => PERIODS.map(p => m.maximetro?.[p] ?? 0))
  const maxCs = makeScale(allMaxVals, BWR)

  // Adjustments
  const adj = calcAdj(study)
  const excess = adj.filter(a => a.dir === 'excess')
  const under = adj.filter(a => a.dir === 'under')
  let adjMsg = 'POTENCIAS DENTRO DE RANGO'
  let adjBg = '#E2F0D9'; let adjColor = '#375623'
  if (excess.length > 0) {
    adjMsg = `AJUSTAR POTENCIAS ${excess.map(a => a.period).join(' · ')}`
    adjBg = '#FFFF00'; adjColor = '#C00000'
  } else if (under.length > 0) {
    adjMsg = `POSIBLE REDUCCIÓN EN ${under.map(a => a.period).join(' · ')}`
    adjBg = '#BDD7EE'; adjColor = '#1F4E79'
  }

  // PRIORIZAR
  const activeSorted = PERIODS
    .filter(p => totalByPeriod[p] > 0)
    .sort((a, b) => totalByPeriod[b] - totalByPeriod[a])
  const priorizarMsg = activeSorted.length > 0
    ? 'PRIORIZAR CONSUMO ' + activeSorted.slice(0, 3).join(' - ')
    : ''

  // Overall recommendation text
  const needsAdj = adj.some(a => a.needs)
  const allExcess = adj.filter(a => a.dir === 'excess')
  const allUnder = adj.filter(a => a.dir === 'under')

  const C = 'color-adjust:exact;-webkit-print-color-adjust:exact;print-color-adjust:exact'

  // Table rows HTML
  const rows = meses.map((mes, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#F9FAFB'
    return `<tr style="background:${bg};${C}">
      <td style="text-align:right;font-weight:600">${fmtKwh(mes.consumoTotal ?? 0)}</td>
      <td style="text-align:center;font-size:8px;color:#555">${fmtDate(mes.fechaInicio)} – ${fmtDate(mes.fechaFin)}</td>
      <td></td>
      ${PERIODS.map(p => { const bg2 = cs(mes.consumo?.[p] ?? 0); return `<td style="text-align:right;background:${bg2} !important;${C}">${(mes.consumo?.[p] ?? 0) > 0 ? fmtKwh(mes.consumo![p]) : ''}</td>` }).join('')}
      ${hasMax ? '<td class="sep"></td>' : ''}
      ${hasMax ? PERIODS.map(p => { const bg2 = maxCs(mes.maximetro?.[p] ?? 0); return `<td style="text-align:right;background:${bg2} !important;${C}">${(mes.maximetro?.[p] ?? 0) > 0 ? fmtKw(mes.maximetro![p]) : ''}</td>` }).join('') : ''}
    </tr>`
  }).join('')

  // Contracted power row
  const contrRow = pc && PERIODS.some(p => (pc[p] ?? 0) > 0)
    ? `<tr style="background:#DEEAF1 !important;${C}">
        <td colspan="3" style="font-weight:700;color:#1F4E79 !important;background:#DEEAF1 !important;${C}">Potencia Contratada (kW)</td>
        ${PERIODS.map(p => `<td style="text-align:right;background:#DEEAF1 !important;font-weight:600;color:#1F4E79 !important;${C}">${(pc[p] ?? 0) > 0 ? fmtKw(pc[p]) : ''}</td>`).join('')}
        ${hasMax ? '<td class="sep"></td>' : ''}
        ${hasMax ? PERIODS.map(() => `<td style="background:#DEEAF1 !important;${C}"></td>`).join('') : ''}
      </tr>`
    : ''

  // KPI summary
  const maxOverall = Math.max(...PERIODS.map(p => maxByPeriod[p] ?? 0), 0)
  const maxPeriod = PERIODS.find(p => maxByPeriod[p] === maxOverall) ?? ''

  const kpiCards = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">⚡ Consumo Total</div>
        <div class="kpi-value">${fmtKwh(grandTotal)} kWh</div>
        <div class="kpi-sub">${meses.length} meses</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">📈 Maxímetro Máximo</div>
        <div class="kpi-value">${maxOverall > 0 ? fmtKw(maxOverall) + ' kW' : 'N/D'}</div>
        <div class="kpi-sub">${maxOverall > 0 ? 'Período ' + maxPeriod : 'Sin datos de maxímetro'}</div>
      </div>
      <div class="kpi-card ${needsAdj ? 'kpi-warn' : 'kpi-ok'}">
        <div class="kpi-label">${needsAdj ? '⚠️' : '✅'} Optimización Potencias</div>
        <div class="kpi-value" style="font-size:14px">${needsAdj ? 'Ajustar ' + adj.filter(a => a.needs).map(a => a.period).join(', ') : 'Potencias OK'}</div>
        <div class="kpi-sub">
          ${allExcess.map(a => `${a.period}: +${a.desvPct.toFixed(0)}%`).join(' · ')}
          ${allUnder.map(a => `${a.period}: ${a.desvPct.toFixed(0)}%`).join(' · ')}
          ${!needsAdj ? 'Desviación <15% en todos los períodos' : ''}
        </div>
      </div>
    </div>`

  // Chart section
  const chartSection = (charts?.consumption || charts?.maximetro) ? `
    <div class="charts-grid">
      ${charts.consumption ? `<div class="chart-box"><img src="${charts.consumption}" style="width:100%;max-height:260px;object-fit:contain" /></div>` : ''}
      ${charts.maximetro ? `<div class="chart-box"><img src="${charts.maximetro}" style="width:100%;max-height:260px;object-fit:contain" /></div>` : ''}
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Estudio de Potencias y Consumos – ${study.cups || ''}</title>
  <style>
    /* ── Force full color printing ── */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    body {
      font-family: "Arial Narrow", "Calibri", Arial, sans-serif;
      font-size: 10px;
      color: #111827;
      background: #fff;
      padding: 16px 20px;
    }
    .header {
      background: #1E3A5F !important;
      color: #fff !important;
      border-radius: 8px 8px 0 0;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0;
    }
    .header h1 { font-size: 14px; font-weight: 700; font-family: monospace; }
    .header .client { font-size: 11px; color: #93C5FD !important; margin-top: 2px; }
    .header .meta { font-size: 10px; color: #93C5FD !important; text-align: right; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin: 14px 0;
    }
    .kpi-card {
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 10px 12px;
      background: #fff !important;
    }
    .kpi-card.kpi-warn { background: #FFFBEB !important; border-color: #FCD34D !important; }
    .kpi-card.kpi-ok   { background: #F0FDF4 !important; border-color: #86EFAC !important; }
    .kpi-label { font-size: 9px; font-weight: 700; color: #6B7280 !important; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .kpi-value { font-size: 18px; font-weight: 700; color: #111827 !important; }
    .kpi-sub   { font-size: 9px; color: #9CA3AF !important; margin-top: 2px; }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 9px;
      font-family: "Arial Narrow", Calibri, Arial, sans-serif;
    }
    th, td {
      border: 1px solid #D0D0D0;
      padding: 2px 4px;
      white-space: nowrap;
      /* NO default background here — let inline styles win */
    }
    th {
      font-weight: 700;
      text-align: center;
      background: #fff !important;
      border-bottom: 2px solid #000;
    }
    .sep { width: 5px; min-width: 5px; background: #F0F0F0 !important; border: none !important; padding: 0; }
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 14px;
    }
    .chart-box {
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 8px;
      background: #fff !important;
    }
    @media print {
      body { padding: 8px 10px; }
      .kpi-grid { gap: 6px; }
      .charts-grid { margin-top: 8px; gap: 8px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${study.cups || '—'}</h1>
      ${(study.clientName || '') ? `<div class="client">${study.clientName}</div>` : ''}
    </div>
    <div class="meta">
      Estudio de Potencias y Consumos<br/>
      ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
    </div>
  </div>

  ${kpiCards}

  <table>
    <thead>
      <tr>
        <th colspan="2" style="text-align:left">CUPS</th>
        <th>CONSUMO TOTAL</th>
        ${PERIODS.map(p => `<th>${p} Activa</th>`).join('')}
        ${hasMax ? '<td class="sep"></td>' : ''}
        ${hasMax ? PERIODS.map(p => `<th>${p} Maxímetro</th>`).join('') : ''}
      </tr>
      <tr>
        <td colspan="2" style="font-family:monospace;font-size:8px">${study.cups || ''}</td>
        <td style="text-align:right;font-weight:700">${fmtKwh(grandTotal)}</td>
        ${PERIODS.map(p => `<td style="text-align:right;background:${cs(totalByPeriod[p])} !important;${C}">${totalByPeriod[p] > 0 ? fmtKwh(totalByPeriod[p]) : ''}</td>`).join('')}
        ${hasMax ? '<td class="sep"></td>' : ''}
        ${hasMax ? PERIODS.map(p => `<td style="text-align:right;background:${maxCs(maxByPeriod[p])} !important;${C}">${maxByPeriod[p] > 0 ? fmtKw(maxByPeriod[p]) : ''}</td>`).join('') : ''}
      </tr>
      ${pc && PERIODS.some(p => (pc[p] ?? 0) > 0) ? `
      <tr>
        <td colspan="2" style="font-weight:700;color:#1F4E79 !important;background:#DEEAF1 !important;font-size:9px;${C}">Potencia Contratada (kW)</td>
        <td style="background:#DEEAF1 !important;${C}"></td>
        ${PERIODS.map(() => `<td style="background:#DEEAF1 !important;${C}"></td>`).join('')}
        ${hasMax ? '<td class="sep"></td>' : ''}
        ${hasMax ? PERIODS.map(p => `<td style="text-align:right;font-weight:700;background:#DEEAF1 !important;color:#1F4E79 !important;border-bottom:2px solid #1F4E79;${C}">${(pc[p] ?? 0) > 0 ? fmtKw(pc[p]) : ''}</td>`).join('') : ''}
      </tr>` : ''}
      <tr>
        <td colspan="2" style="font-size:10px;font-weight:700">${study.clientName || ''}</td>
        <td></td>
        ${PERIODS.map(p => `<td style="text-align:center;color:#555">${totalByPeriod[p] > 0 ? fmtPct(grandTotal > 0 ? totalByPeriod[p] / grandTotal : 0) : ''}</td>`).join('')}
        ${hasMax ? '<td class="sep"></td>' : ''}
        ${hasMax ? `<td colspan="6" rowspan="2" style="font-weight:700;text-align:center;font-size:10px;background:${adjBg} !important;color:${adjColor} !important;${C};vertical-align:middle">${adjMsg}</td>` : ''}
      </tr>
      <tr>
        <td colspan="3"></td>
        <td colspan="6" style="font-weight:700;text-align:center;background:#FCE4D6 !important;color:#843C0C !important;${C}">${priorizarMsg}</td>
        ${!hasMax ? '' : ''}
      </tr>
    </thead>
    <tbody>
      ${rows}
      ${contrRow}
    </tbody>
  </table>

  ${chartSection}

  <script>window.onload = () => { window.print() }</script>
</body>
</html>`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const study: PowerStudyResult = body
    const charts = body.charts as { consumption?: string; maximetro?: string } | undefined
    const html = generateHTML(study, charts)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[power-study-pdf] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
