/**
 * Server-side SVG chart builders for Power Study exports (PDF + Excel).
 * These generate pure SVG strings — no browser APIs needed.
 * Data is always sorted chronologically (oldest → newest) for consistency.
 */

import type { PowerStudyResult } from '@/app/api/power-study/route'

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = typeof PERIODS[number]

const PERIOD_COLORS: Record<Period, string> = {
  P1: '#4472C4', P2: '#ED7D31', P3: '#A9D18E',
  P4: '#FFC000', P5: '#5B9BD5', P6: '#70AD47',
}

/** Font family guaranteed to exist on Vercel/Amazon Linux (librsvg needs real fonts) */
const SVG_FONT = 'DejaVu Sans, Liberation Sans, sans-serif'

/** Manual Spanish month names — avoids toLocaleDateString locale issues on server */
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function monthLabel(fechaFin: string): string {
  try {
    const d = new Date(fechaFin)
    if (isNaN(d.getTime())) return fechaFin?.slice(0, 7) || ''
    const m = d.getMonth()       // 0-11
    const y = String(d.getFullYear()).slice(-2) // "23", "24", "25"
    return `${MES_CORTO[m]} ${y}`
  } catch { return fechaFin?.slice(0, 7) || '' }
}

/** Sort meses chronologically by fechaFin (oldest first) */
function sortChrono(meses: PowerStudyResult['meses']): NonNullable<PowerStudyResult['meses']> {
  return [...(meses ?? [])].sort((a, b) => new Date(a.fechaFin).getTime() - new Date(b.fechaFin).getTime())
}

// ─── Consumption chart (stacked bars, chronological order) ───────────────────
export function buildConsumptionSVG(rawMeses: PowerStudyResult['meses'], width = 1000, height = 340): string {
  const W = width, H = height
  const m = { top: 30, right: 20, bottom: 80, left: 64 }
  const cW = W - m.left - m.right, cH = H - m.top - m.bottom

  if (!rawMeses?.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="13" fill="#9CA3AF">Sin datos de consumo</text></svg>`

  const meses = sortChrono(rawMeses)
  const activePeriods = PERIODS.filter(p => meses.some(mes => (mes.consumo?.[p] ?? 0) > 0))
  const maxMonthly = Math.max(...meses.map(mes => mes.consumoTotal ?? 0), 1)
  const yMax = Math.ceil(maxMonthly / 1000) * 1000 + 500
  const yScale = (v: number) => cH - (v / yMax) * cH
  const barW = Math.max(8, Math.min(36, cW / meses.length * 0.65))
  const slotW = cW / meses.length
  const xOf = (i: number) => m.left + slotW * i + slotW / 2

  let paths = ''
  let dataLabels = ''
  for (let i = 0; i < meses.length; i++) {
    let stackY = cH
    const total = meses[i].consumoTotal ?? 0
    for (const p of activePeriods) {
      const v = meses[i].consumo?.[p] ?? 0
      if (v <= 0) continue
      const barH = (v / yMax) * cH
      stackY -= barH
      paths += `<rect x="${(xOf(i) - barW/2).toFixed(1)}" y="${(m.top + stackY).toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${PERIOD_COLORS[p]}" />`
    }
    if (total > 0) {
      const labelY = m.top + stackY - 4
      const fmtVal = total >= 1000 ? (total / 1000).toFixed(1) + 'k' : Math.round(total).toString()
      dataLabels += `<text x="${xOf(i).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="${meses.length > 18 ? 7 : 9}" fill="#374151" font-weight="bold" font-family="${SVG_FONT}">${fmtVal}</text>`
    }
  }

  const yTicks = 5
  let grid = ''
  for (let t = 0; t <= yTicks; t++) {
    const v = Math.round((yMax * t) / yTicks)
    const y = m.top + yScale(v)
    grid += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left+cW}" y2="${y.toFixed(1)}" stroke="#E5E7EB" />`
    grid += `<text x="${m.left-6}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6B7280" font-family="${SVG_FONT}">${v>=1000?(v/1000).toFixed(0)+'k':v}</text>`
  }

  let xLabels = ''
  for (let i = 0; i < meses.length; i++) {
    const x = xOf(i)
    const skip = meses.length > 24 ? i % 2 !== 0 : false
    if (!skip) {
      xLabels += `<text x="${x.toFixed(1)}" y="${(m.top+cH+18).toFixed(1)}" text-anchor="middle" font-size="9" fill="#374151" font-family="${SVG_FONT}" transform="rotate(-45,${x.toFixed(1)},${(m.top+cH+18).toFixed(1)})">${monthLabel(meses[i].fechaFin)}</text>`
    }
  }

  let legend = '', lx = m.left
  for (const p of activePeriods) {
    legend += `<rect x="${lx}" y="${H-22}" width="10" height="10" fill="${PERIOD_COLORS[p]}" /><text x="${lx+13}" y="${H-13}" font-size="10" fill="#374151" font-family="${SVG_FONT}">${p}</text>`
    lx += 42
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#fff">
    <text x="${W/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="#111827" font-family="${SVG_FONT}">CONSUMO MENSUAL (kWh)</text>
    ${grid}${paths}${dataLabels}
    <line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top+cH}" stroke="#9CA3AF"/>
    <line x1="${m.left}" y1="${m.top+cH}" x2="${m.left+cW}" y2="${m.top+cH}" stroke="#9CA3AF"/>
    ${xLabels}
    <text x="${m.left-44}" y="${m.top+cH/2}" text-anchor="middle" font-size="10" fill="#6B7280" font-family="${SVG_FONT}" transform="rotate(-90,${m.left-44},${m.top+cH/2})">kWh</text>
    ${legend}
  </svg>`
}

// ─── Maxímetro chart (grouped bars, chronological order) ─────────────────────
export function buildMaximetroSVG(rawMeses: PowerStudyResult['meses'], potenciaContratada?: Record<string, number>, width = 1000, height = 340): string {
  const W = width, H = height
  const m = { top: 30, right: 60, bottom: 80, left: 64 }
  const cW = W - m.left - m.right, cH = H - m.top - m.bottom

  if (!rawMeses?.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="13" fill="#9CA3AF">Sin datos de maxímetro</text></svg>`

  const meses = sortChrono(rawMeses)
  const activePeriods = PERIODS.filter(p => meses.some(mes => (mes.maximetro?.[p] ?? 0) > 0))
  if (!activePeriods.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="13" fill="#9CA3AF">Sin datos de maxímetro</text></svg>`

  const allMax = meses.flatMap(mes => activePeriods.map(p => mes.maximetro?.[p] ?? 0))
  const contrMax = activePeriods.map(p => potenciaContratada?.[p] ?? 0)
  const allVals = [...allMax, ...contrMax].filter(v => v > 0)
  const yMax = Math.ceil(Math.max(...allVals, 1) * 1.15 / 10) * 10
  const yScale = (v: number) => cH - (v / yMax) * cH

  const groupW = cW / meses.length
  const barsPerGroup = activePeriods.length
  const barW = Math.max(4, Math.min(18, groupW / barsPerGroup * 0.75))
  const groupPad = (groupW - barW * barsPerGroup) / 2

  let bars = ''
  let maxLabels = ''
  for (let i = 0; i < meses.length; i++) {
    for (let pi = 0; pi < activePeriods.length; pi++) {
      const p = activePeriods[pi]
      const v = meses[i].maximetro?.[p] ?? 0
      if (v <= 0) continue
      const x = m.left + i * groupW + groupPad + pi * barW
      const barH = (v / yMax) * cH
      const y = m.top + yScale(v)
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${PERIOD_COLORS[p]}" opacity="0.85" />`
      if (meses.length <= 18 || pi === 0) {
        maxLabels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="${meses.length > 14 ? 6 : 8}" fill="#374151" font-family="${SVG_FONT}">${Math.round(v)}</text>`
      }
    }
  }

  let grid = ''
  for (let t = 0; t <= 5; t++) {
    const v = (yMax * t) / 5
    const y = m.top + yScale(v)
    grid += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left+cW}" y2="${y.toFixed(1)}" stroke="#E5E7EB"/>`
    grid += `<text x="${m.left-6}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6B7280" font-family="${SVG_FONT}">${v.toFixed(0)}</text>`
  }

  let refLines = ''
  if (potenciaContratada) {
    for (const p of activePeriods) {
      const cont = potenciaContratada[p] ?? 0
      if (cont <= 0) continue
      const y = m.top + yScale(cont)
      refLines += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left+cW}" y2="${y.toFixed(1)}" stroke="${PERIOD_COLORS[p]}" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.7"/>`
      refLines += `<text x="${m.left+cW+3}" y="${(y+4).toFixed(1)}" font-size="9" fill="${PERIOD_COLORS[p]}" font-family="${SVG_FONT}">${p}: ${cont}kW</text>`
    }
  }

  let xLabels = ''
  for (let i = 0; i < meses.length; i++) {
    const x = m.left + i * groupW + groupW / 2
    const skip = meses.length > 24 ? i % 2 !== 0 : false
    if (!skip) {
      xLabels += `<text x="${x.toFixed(1)}" y="${(m.top+cH+18).toFixed(1)}" text-anchor="middle" font-size="9" fill="#374151" font-family="${SVG_FONT}" transform="rotate(-45,${x.toFixed(1)},${(m.top+cH+18).toFixed(1)})">${monthLabel(meses[i].fechaFin)}</text>`
    }
  }

  let legend = '', lx = m.left
  for (const p of activePeriods) {
    legend += `<rect x="${lx}" y="${H-22}" width="10" height="10" fill="${PERIOD_COLORS[p]}"/><text x="${lx+13}" y="${H-13}" font-size="10" fill="#374151" font-family="${SVG_FONT}">${p}</text>`
    lx += 42
  }
  if (potenciaContratada) {
    legend += `<line x1="${lx}" y1="${H-17}" x2="${lx+16}" y2="${H-17}" stroke="#6B7280" stroke-width="1.5" stroke-dasharray="5,3"/>`
    legend += `<text x="${lx+20}" y="${H-13}" font-size="10" fill="#374151" font-family="${SVG_FONT}">Contratada</text>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#fff">
    <text x="${W/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="#111827" font-family="${SVG_FONT}">MAXÍMETROS MENSUALES (kW)</text>
    ${grid}${refLines}${bars}${maxLabels}
    <line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top+cH}" stroke="#9CA3AF"/>
    <line x1="${m.left}" y1="${m.top+cH}" x2="${m.left+cW}" y2="${m.top+cH}" stroke="#9CA3AF"/>
    ${xLabels}
    <text x="${m.left-44}" y="${m.top+cH/2}" text-anchor="middle" font-size="10" fill="#6B7280" font-family="${SVG_FONT}" transform="rotate(-90,${m.left-44},${m.top+cH/2})">kW</text>
    ${legend}
  </svg>`
}
