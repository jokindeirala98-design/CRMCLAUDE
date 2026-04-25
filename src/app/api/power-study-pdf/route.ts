import { NextRequest, NextResponse } from 'next/server'
import type { PowerStudyResult } from '@/app/api/power-study/route'
import { buildConsumptionSVG, buildMaximetroSVG } from '@/lib/power-study-charts'

/**
 * POST /api/power-study-pdf
 *
 * Returns a print-ready HTML document (A4 landscape).
 * Page 1: Header + KPI cards + data table (compact, sorted chronologically)
 * Page 2: Two SVG charts generated SERVER-SIDE (chronological) + period analysis
 *
 * SVG charts come from @/lib/power-study-charts (shared with Excel export).
 */

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = typeof PERIODS[number]

const PERIOD_COLORS: Record<Period, string> = {
  P1: '#4472C4', P2: '#ED7D31', P3: '#A9D18E',
  P4: '#FFC000', P5: '#5B9BD5', P6: '#70AD47',
}

function fmtKw(v: number): string { return v === 0 ? '-' : (v.toFixed(3).replace(/\.?0+$/, '') || '0') }
function fmtKwh(v: number): string { return v === 0 ? '0' : v.toLocaleString('es-ES') }
function fmtDate(s: string): string { try { return new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) } catch { return s?.slice(0, 10) || '' } }
function fmtPct(v: number): string { return (v * 100).toFixed(1) + '%' }

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
    if (v <= lo) return cs[0]; if (v >= hi) return cs[2]
    if (v <= mid) return lerpHex(cs[0], cs[1], mid > lo ? (v - lo) / (mid - lo) : 0)
    return lerpHex(cs[1], cs[2], hi > mid ? (v - mid) / (hi - mid) : 1)
  }
}
const GYR: [string,string,string] = ['#63BE7B', '#FFEB84', '#F8696B']
const BWR: [string,string,string] = ['#5A8AC6', '#FCFCFF', '#F8696B']

interface PeriodAdj { period: Period; max: number; cont: number; desvPct: number; needs: boolean; dir: 'excess'|'under'|'ok' }
function calcAdj(study: PowerStudyResult): PeriodAdj[] {
  return PERIODS.map(p => {
    const max = study.maxPotencia?.[p] ?? 0, cont = study.potenciaContratada?.[p] ?? 0
    const desvPct = cont > 0 ? ((max - cont) / cont) * 100 : 0
    const needs = cont > 0 && max > 0 && Math.abs(desvPct) > 15
    return { period: p, max, cont, desvPct, needs, dir: needs ? (desvPct > 0 ? 'excess' : 'under') : 'ok' }
  })
}

// ─── Main HTML generator ─────────────────────────────────────────────────────
function generateHTML(study: PowerStudyResult): string {
  const meses = study.meses ?? []
  const sortedMeses = [...meses].sort((a, b) => new Date(a.fechaFin).getTime() - new Date(b.fechaFin).getTime())
  const hasMax = meses.some(m => PERIODS.some(p => (m.maximetro?.[p] ?? 0) > 0))
  const pc = study.potenciaContratada

  const totalByPeriod: Record<string, number> = {}
  for (const p of PERIODS) totalByPeriod[p] = meses.reduce((s, m) => s + (m.consumo?.[p] ?? 0), 0)
  const grandTotal = PERIODS.reduce((s, p) => s + totalByPeriod[p], 0)
  const maxByPeriod: Record<string, number> = {}
  for (const p of PERIODS) maxByPeriod[p] = Math.max(...meses.map(m => m.maximetro?.[p] ?? 0), 0)

  const cs = makeScale(meses.flatMap(m => PERIODS.map(p => m.consumo?.[p] ?? 0)), GYR)
  const maxCs = makeScale(meses.flatMap(m => PERIODS.map(p => m.maximetro?.[p] ?? 0)), BWR)

  const adj = calcAdj(study)
  const excess = adj.filter(a => a.dir === 'excess')
  const under = adj.filter(a => a.dir === 'under')
  let adjMsg = 'POTENCIAS DENTRO DE RANGO', adjBg = '#E2F0D9', adjColor = '#375623'
  if (excess.length > 0) { adjMsg = `AJUSTAR POTENCIAS ${excess.map(a => a.period).join(' · ')}`; adjBg = '#FFFF00'; adjColor = '#C00000' }
  else if (under.length > 0) { adjMsg = `POSIBLE REDUCCIÓN EN ${under.map(a => a.period).join(' · ')}`; adjBg = '#BDD7EE'; adjColor = '#1F4E79' }

  const needsAdj = adj.some(a => a.needs)
  const activeSorted = PERIODS.filter(p => totalByPeriod[p] > 0).sort((a, b) => totalByPeriod[b] - totalByPeriod[a])
  const priorizarMsg = activeSorted.length > 0 ? 'PRIORIZAR CONSUMO ' + activeSorted.slice(0, 3).join(' - ') : ''

  const C = 'color-adjust:exact;-webkit-print-color-adjust:exact;print-color-adjust:exact'
  const maxOverall = Math.max(...PERIODS.map(p => maxByPeriod[p] ?? 0), 0)
  const maxPeriod = PERIODS.find(p => maxByPeriod[p] === maxOverall) ?? ''

  // Data rows — sorted chronologically
  const rows = sortedMeses.map((mes, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#F5F5F5'
    return `<tr style="background:${bg};${C}">
      <td style="text-align:right;font-weight:600">${fmtKwh(mes.consumoTotal ?? 0)}</td>
      <td style="text-align:center;color:#555">${fmtDate(mes.fechaInicio)} – ${fmtDate(mes.fechaFin)}</td>
      <td></td>
      ${PERIODS.map(p => `<td style="text-align:right;background:${cs(mes.consumo?.[p] ?? 0)} !important;${C}">${(mes.consumo?.[p] ?? 0) > 0 ? fmtKwh(mes.consumo![p]) : ''}</td>`).join('')}
      ${hasMax ? '<td class="sep"></td>' : ''}
      ${hasMax ? PERIODS.map(p => `<td style="text-align:right;background:${maxCs(mes.maximetro?.[p] ?? 0)} !important;${C}">${(mes.maximetro?.[p] ?? 0) > 0 ? fmtKw(mes.maximetro![p]) : ''}</td>`).join('') : ''}
    </tr>`
  }).join('')

  // SVG charts — generated server-side, always chronological
  // Use reduced height so two charts + header + period analysis fit inside A4 landscape (733px content height)
  const chartH = hasMax ? 230 : 320
  const consumoSVG = buildConsumptionSVG(study.meses, 1000, chartH)
  const maximetroSVG = hasMax ? buildMaximetroSVG(study.meses, pc as Record<string, number> | undefined, 1000, chartH) : ''

  // Period analysis cards
  const periodCards = hasMax && adj.some(a => a.cont > 0) ? adj.map(a => {
    if (a.cont <= 0 && a.max <= 0) return ''
    const color = a.needs ? (a.dir === 'excess' ? '#DC2626' : '#2563EB') : '#16A34A'
    const bg = a.needs ? (a.dir === 'excess' ? '#FEF2F2' : '#EFF6FF') : '#F0FDF4'
    return `<div style="flex:1;background:${bg} !important;border:1px solid ${color}22;border-radius:8px;padding:8px 6px;text-align:center;${C}">
      <div style="width:10px;height:10px;border-radius:2px;background:${PERIOD_COLORS[a.period]} !important;margin:0 auto 3px;${C}"></div>
      <div style="font-size:11px;font-weight:700">${a.period}</div>
      <div style="font-size:9px;color:#6B7280;margin:2px 0">Máx: <b style="color:#111827">${fmtKw(a.max)} kW</b></div>
      ${a.cont > 0 ? `<div style="font-size:9px;color:#6B7280">Cont: ${fmtKw(a.cont)} kW</div>` : ''}
      ${a.cont > 0 && a.max > 0 ? `<div style="font-size:10px;font-weight:700;color:${color} !important;margin-top:2px;${C}">${a.desvPct > 0 ? '+' : ''}${a.desvPct.toFixed(1)}%${a.needs ? (a.dir === 'excess' ? ' EXCESO' : ' REDUCIBLE') : ''}</div>` : ''}
    </div>`
  }).join('') : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Estudio Potencias – ${study.cups || ''}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  @page { size: A4 landscape; margin: 8mm 10mm; }
  body { font-family: "Arial Narrow", Calibri, Arial, sans-serif; font-size: 8px; color: #111827; background: #fff; }
  .header { background: #1E3A5F !important; color: #fff !important; border-radius: 6px 6px 0 0; padding: 6px 12px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 12px; font-weight: 700; font-family: monospace; color: #fff !important; }
  .header .client { font-size: 10px; color: #93C5FD !important; margin-top: 1px; }
  .header .meta { font-size: 9px; color: #93C5FD !important; text-align: right; }
  .kpi-grid { display: flex; gap: 8px; margin: 8px 0; }
  .kpi-card { flex: 1; border: 1px solid #E5E7EB; border-radius: 6px; padding: 6px 10px; background: #fff !important; }
  .kpi-card.warn { background: #FFFBEB !important; border-color: #FCD34D !important; }
  .kpi-card.ok { background: #F0FDF4 !important; border-color: #86EFAC !important; }
  .kpi-label { font-size: 7px; font-weight: 700; color: #6B7280 !important; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
  .kpi-value { font-size: 14px; font-weight: 700; color: #111827 !important; }
  .kpi-sub { font-size: 7px; color: #9CA3AF !important; margin-top: 1px; }
  table { border-collapse: collapse; width: 100%; font-size: 7.5px; }
  th, td { border: 1px solid #D0D0D0; padding: 1px 3px; white-space: nowrap; }
  th { font-weight: 700; text-align: center; background: #fff !important; border-bottom: 2px solid #000; font-size: 7px; }
  thead { display: table-header-group; }
  .sep { width: 4px; min-width: 4px; background: #F0F0F0 !important; border: none !important; padding: 0; }
  .page-break { page-break-before: always; break-before: page; }
  .chart-box { border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; background: #fff !important; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .chart-box svg { width: 100%; height: auto; display: block; }
  .period-analysis { border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px 12px; margin-top: 8px; background: #fff !important; break-inside: avoid; page-break-inside: avoid; }
  @media print { .header, .kpi-grid, .chart-box, .period-analysis { break-inside: avoid !important; page-break-inside: avoid !important; } }
</style>
</head>
<body>

<!-- PAGE 1 -->
<div class="header">
  <div><h1>${study.cups || '—'}</h1>${study.clientName ? `<div class="client">${study.clientName}</div>` : ''}</div>
  <div class="meta">Estudio de Potencias y Consumos<br/>${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
</div>
<div class="kpi-grid">
  <div class="kpi-card"><div class="kpi-label">Consumo Total</div><div class="kpi-value">${fmtKwh(grandTotal)} <span style="font-size:10px;font-weight:400;color:#6B7280">kWh</span></div><div class="kpi-sub">${meses.length} meses</div></div>
  <div class="kpi-card"><div class="kpi-label">Maxímetro Máx.</div><div class="kpi-value">${maxOverall > 0 ? fmtKw(maxOverall)+' <span style="font-size:10px;font-weight:400;color:#6B7280">kW</span>' : 'N/D'}</div><div class="kpi-sub">${maxOverall > 0 ? 'Período '+maxPeriod : 'Sin datos'}</div></div>
  <div class="kpi-card ${needsAdj ? 'warn' : 'ok'}"><div class="kpi-label">Optimización</div><div class="kpi-value" style="font-size:11px">${needsAdj ? 'Ajustar '+adj.filter(a=>a.needs).map(a=>a.period).join(', ') : 'Potencias OK'}</div><div class="kpi-sub">${adj.filter(a=>a.dir==='excess').map(a=>a.period+': +'+a.desvPct.toFixed(0)+'%').join(' · ')} ${adj.filter(a=>a.dir==='under').map(a=>a.period+': '+a.desvPct.toFixed(0)+'%').join(' · ')} ${!needsAdj ? 'Desviación &lt;15%' : ''}</div></div>
</div>
<table>
  <thead>
    <tr><th colspan="2" style="text-align:left">CUPS</th><th>TOTAL</th>${PERIODS.map(p=>`<th>${p} Activa</th>`).join('')}${hasMax?'<td class="sep"></td>':''}${hasMax?PERIODS.map(p=>`<th>${p} Maxím.</th>`).join(''):''}</tr>
    <tr><td colspan="2" style="font-family:monospace;font-size:7px">${study.cups||''}</td><td style="text-align:right;font-weight:700">${fmtKwh(grandTotal)}</td>${PERIODS.map(p=>`<td style="text-align:right;background:${cs(totalByPeriod[p])} !important;${C}">${totalByPeriod[p]>0?fmtKwh(totalByPeriod[p]):''}</td>`).join('')}${hasMax?'<td class="sep"></td>':''}${hasMax?PERIODS.map(p=>`<td style="text-align:right;background:${maxCs(maxByPeriod[p])} !important;${C}">${maxByPeriod[p]>0?fmtKw(maxByPeriod[p]):''}</td>`).join(''):''}</tr>
    ${pc&&PERIODS.some(p=>((pc as any)[p]??0)>0)?`<tr><td colspan="2" style="font-weight:700;color:#1F4E79 !important;background:#DEEAF1 !important;${C}">Pot. Contratada (kW)</td><td style="background:#DEEAF1 !important;${C}"></td>${PERIODS.map(p=>`<td style="text-align:right;font-weight:700;background:#DEEAF1 !important;color:#1F4E79 !important;${C}">${((pc as any)[p]??0)>0?fmtKw((pc as any)[p]):''}</td>`).join('')}${hasMax?'<td class="sep"></td>':''}${hasMax?PERIODS.map(p=>`<td style="text-align:right;font-weight:700;background:#DEEAF1 !important;color:#1F4E79 !important;border-bottom:2px solid #1F4E79;${C}">${((pc as any)[p]??0)>0?fmtKw((pc as any)[p]):''}</td>`).join(''):''}</tr>`:''}
    <tr><td colspan="2" style="font-size:8px;font-weight:700">${study.clientName||''}</td><td></td>${PERIODS.map(p=>`<td style="text-align:center;color:#555">${totalByPeriod[p]>0?fmtPct(grandTotal>0?totalByPeriod[p]/grandTotal:0):''}</td>`).join('')}${hasMax?'<td class="sep"></td>':''}${hasMax?`<td colspan="6" rowspan="2" style="font-weight:700;text-align:center;font-size:8px;background:${adjBg} !important;color:${adjColor} !important;${C};vertical-align:middle">${adjMsg}</td>`:''}</tr>
    <tr><td colspan="3"></td><td colspan="6" style="font-weight:700;text-align:center;background:#FCE4D6 !important;color:#843C0C !important;${C}">${priorizarMsg}</td></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<!-- PAGE 2 -->
<div class="page-break">
  <div class="header" style="margin-bottom:12px"><div><h1>${study.cups||'—'}</h1>${study.clientName?`<div class="client">${study.clientName}</div>`:''}</div><div class="meta">Gráficas de Consumo y Maxímetros</div></div>
  <div class="chart-box">${consumoSVG}</div>
  ${maximetroSVG?`<div class="chart-box">${maximetroSVG}</div>`:''}
  ${periodCards?`<div class="period-analysis"><div style="font-size:10px;font-weight:700;color:#374151;margin-bottom:8px">Análisis de maxímetros por período</div><div style="display:flex;gap:8px">${periodCards}</div></div>`:''}
</div>

<script>window.onload=()=>{window.print()}</script>
</body>
</html>`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const study: PowerStudyResult = body
    const html = generateHTML(study)
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch (err: any) {
    console.error('[power-study-pdf] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
