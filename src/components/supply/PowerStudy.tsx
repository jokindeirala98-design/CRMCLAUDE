'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Upload, Download, FileText, AlertTriangle, CheckCircle2,
  Zap, TrendingUp, BarChart3, Loader2, RefreshCw,
} from 'lucide-react'
import type { PowerStudyResult } from '@/app/api/power-study/route'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

interface PowerStudyProps {
  supplyId: string
  cups: string | null
  clientName?: string
  potenciaContratada?: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  existingStudy?: PowerStudyResult | null
  onStudyGenerated?: (study: PowerStudyResult) => void
  /** Consumo anual oficial SIPS (kWh). Se muestra en la tarjeta "Consumo Total". */
  sipsAnnualKwh?: number | null
}

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = typeof PERIODS[number]

/** Excel-default chart palette for P1–P6 */
const PERIOD_COLORS: Record<Period, string> = {
  P1: '#4472C4',
  P2: '#ED7D31',
  P3: '#A9D18E',
  P4: '#FFC000',
  P5: '#5B9BD5',
  P6: '#70AD47',
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtKwh(v: number): string {
  if (v === 0) return '0'
  return v.toLocaleString('es-ES')
}
function fmtKw(v: number): string {
  if (v === 0) return '-'
  return v.toFixed(3).replace(/\.?0+$/, '') || '0'
}
function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}
function fmtDate(s: string): string {
  try {
    const d = new Date(s)
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return s?.slice(0, 10) || '' }
}
function monthLabel(fechaFin: string): string {
  try {
    const d = new Date(fechaFin)
    return d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
  } catch { return fechaFin?.slice(0, 7) || '' }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR SCALES (replicates Excel colorScale conditional formatting)
// ─────────────────────────────────────────────────────────────────────────────

function lerpHex(c1: string, c2: string, t: number): string {
  const h = (s: string) => [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ]
  const [r1, g1, b1] = h(c1)
  const [r2, g2, b2] = h(c2)
  const ch = (a: number, b: number) =>
    Math.round(a + (b - a) * t).toString(16).padStart(2, '0')
  return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`
}

function make3PointScale(colors: [string, string, string], vals: number[]): (v: number) => string {
  const pos = vals.filter(v => v > 0)
  if (!pos.length) return () => 'transparent'
  const lo = Math.min(...pos)
  const hi = Math.max(...pos)
  if (lo === hi) return () => colors[1]
  const sorted = [...pos].sort((a, b) => a - b)
  const mid = sorted[Math.floor((sorted.length - 1) / 2)]
  return (v: number): string => {
    if (v <= 0) return 'transparent'
    if (v <= lo) return colors[0]
    if (v >= hi) return colors[2]
    if (v <= mid) return lerpHex(colors[0], colors[1], mid > lo ? (v - lo) / (mid - lo) : 0)
    return lerpHex(colors[1], colors[2], hi > mid ? (v - mid) / (hi - mid) : 1)
  }
}

// GYR: green→yellow→red (consumo — low is better)
const GYR: [string, string, string] = ['#63BE7B', '#FFEB84', '#F8696B']
// BWR: blue→white→red (maxímetros — high values = red to flag >15% excess)
const BWR: [string, string, string] = ['#5A8AC6', '#FCFCFF', '#E32727']

// ─────────────────────────────────────────────────────────────────────────────
// OPTIMIZATION LOGIC
// Rule: max(maxímetro[P]) must be >15% above OR <15% below contracted power[P]
// ─────────────────────────────────────────────────────────────────────────────

interface PeriodAdjustment {
  period: Period
  maxRegistrado: number
  contracted: number
  desvPct: number        // positive = excess, negative = under
  needsAdjust: boolean
  direction: 'excess' | 'under' | 'ok'
}

function calcAdjustments(
  maxPotencia: Record<string, number>,
  potenciaContratada: Record<string, number> | undefined
): PeriodAdjustment[] {
  return PERIODS.map(p => {
    const max = maxPotencia?.[p] ?? 0
    const cont = potenciaContratada?.[p] ?? 0
    const desvPct = cont > 0 ? ((max - cont) / cont) * 100 : 0
    const needsAdjust = cont > 0 && max > 0 && Math.abs(desvPct) > 15
    return {
      period: p,
      maxRegistrado: max,
      contracted: cont,
      desvPct,
      needsAdjust,
      direction: needsAdjust ? (desvPct > 0 ? 'excess' : 'under') : 'ok',
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG CHART BUILDERS (pure functions → reusable in PDF/Excel export)
// ─────────────────────────────────────────────────────────────────────────────

export function buildConsumptionSVG(rawMeses: PowerStudyResult['meses']): string {
  const W = 820, H = 300
  const m = { top: 24, right: 20, bottom: 80, left: 64 }
  const cW = W - m.left - m.right
  const cH = H - m.top - m.bottom

  if (!rawMeses?.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"></svg>`

  // Sort chronologically: oldest first (left) → newest last (right)
  const meses = [...rawMeses].sort((a, b) => new Date(a.fechaFin).getTime() - new Date(b.fechaFin).getTime())

  // Active periods (have any data)
  const activePeriods = PERIODS.filter(p => meses.some(mes => (mes.consumo?.[p] ?? 0) > 0))

  // Y-axis scale
  const maxMonthly = Math.max(...meses.map(m => m.consumoTotal ?? 0), 1)
  const yMax = Math.ceil(maxMonthly / 1000) * 1000 + 500
  const yScale = (v: number) => cH - (v / yMax) * cH

  // X positioning
  const barW = Math.max(8, Math.min(40, cW / meses.length * 0.65))
  const slotW = cW / meses.length
  const xOf = (i: number) => m.left + slotW * i + slotW / 2

  let paths = ''
  let dataLabels = ''
  // Stacked bars
  for (let i = 0; i < meses.length; i++) {
    let stackY = cH
    const total = meses[i].consumoTotal ?? 0
    for (const p of activePeriods) {
      const v = meses[i].consumo?.[p] ?? 0
      if (v <= 0) continue
      const barH = (v / yMax) * cH
      stackY -= barH
      const x = xOf(i) - barW / 2
      paths += `<rect x="${x.toFixed(1)}" y="${(m.top + stackY).toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${PERIOD_COLORS[p]}" />`
    }
    // Data label on top of each bar (total)
    if (total > 0) {
      const labelY = m.top + stackY - 4
      const fmtVal = total >= 1000 ? (total / 1000).toFixed(1) + 'k' : Math.round(total).toString()
      dataLabels += `<text x="${xOf(i).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="${meses.length > 18 ? 6 : 8}" fill="#374151" font-family="Arial, sans-serif" font-weight="bold">${fmtVal}</text>`
    }
  }

  // Y grid lines & labels
  const yTicks = 5
  let gridLines = ''
  for (let t = 0; t <= yTicks; t++) {
    const v = Math.round((yMax * t) / yTicks)
    const y = m.top + yScale(v)
    gridLines += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left + cW}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="1" />`
    gridLines += `<text x="${(m.left - 6).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6B7280" font-family="Arial, sans-serif">${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}</text>`
  }

  // X labels (month)
  let xLabels = ''
  for (let i = 0; i < meses.length; i++) {
    const x = xOf(i)
    const label = monthLabel(meses[i].fechaFin)
    const skip = meses.length > 20 ? i % 2 !== 0 : false
    if (!skip) {
      xLabels += `<text x="${x.toFixed(1)}" y="${(m.top + cH + 18).toFixed(1)}" text-anchor="middle" font-size="9" fill="#374151" font-family="Arial, sans-serif" transform="rotate(-45,${x.toFixed(1)},${(m.top + cH + 18).toFixed(1)})">${label}</text>`
    }
  }

  // Y axis label
  const yAxisLabel = `<text x="${(m.left - 44).toFixed(1)}" y="${(m.top + cH / 2).toFixed(1)}" text-anchor="middle" font-size="10" fill="#6B7280" font-family="Arial, sans-serif" transform="rotate(-90,${(m.left - 44).toFixed(1)},${(m.top + cH / 2).toFixed(1)})">kWh</text>`

  // Legend
  let legend = ''
  const legendX = m.left
  const legendY = H - 22
  let lx = legendX
  for (const p of activePeriods) {
    legend += `<rect x="${lx}" y="${legendY - 7}" width="10" height="10" fill="${PERIOD_COLORS[p]}" />`
    legend += `<text x="${lx + 13}" y="${legendY + 2}" font-size="10" fill="#374151" font-family="Arial, sans-serif">${p}</text>`
    lx += 42
  }

  // Title
  const title = `<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="#111827" font-family="Arial, sans-serif">CONSUMO MENSUAL (kWh)</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff">
  ${title}
  ${gridLines}
  ${paths}
  ${dataLabels}
  <line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + cH}" stroke="#9CA3AF" stroke-width="1"/>
  <line x1="${m.left}" y1="${m.top + cH}" x2="${m.left + cW}" y2="${m.top + cH}" stroke="#9CA3AF" stroke-width="1"/>
  ${xLabels}
  ${yAxisLabel}
  ${legend}
</svg>`
}

export function buildMaximetroSVG(
  rawMeses: PowerStudyResult['meses'],
  potenciaContratada?: Record<string, number>
): string {
  const W = 820, H = 300
  const m = { top: 24, right: 20, bottom: 80, left: 64 }
  const cW = W - m.left - m.right
  const cH = H - m.top - m.bottom

  if (!rawMeses?.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"></svg>`

  // Sort chronologically: oldest first (left) → newest last (right)
  const meses = [...rawMeses].sort((a, b) => new Date(a.fechaFin).getTime() - new Date(b.fechaFin).getTime())

  const activePeriods = PERIODS.filter(p =>
    meses.some(mes => (mes.maximetro?.[p] ?? 0) > 0)
  )
  if (!activePeriods.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff">
      <text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="13" fill="#9CA3AF" font-family="Arial, sans-serif">Sin datos de maxímetro</text>
    </svg>`
  }

  // Y scale
  const allMax = meses.flatMap(mes => activePeriods.map(p => mes.maximetro?.[p] ?? 0))
  const contrMax = activePeriods.map(p => potenciaContratada?.[p] ?? 0)
  const allVals = [...allMax, ...contrMax].filter(v => v > 0)
  const yMax = Math.ceil(Math.max(...allVals, 1) * 1.15 / 10) * 10
  const yScale = (v: number) => cH - (v / yMax) * cH

  // X positioning — group by month, then by active period
  const groupW = cW / meses.length
  const barsPerGroup = activePeriods.length
  const barW = Math.max(4, Math.min(20, groupW / barsPerGroup * 0.75))
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
      // Data label on top of each bar (only if enough space)
      if (meses.length <= 18 || pi === 0) {
        maxLabels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="${meses.length > 14 ? 5 : 7}" fill="#374151" font-family="Arial, sans-serif">${Math.round(v)}</text>`
      }
    }
  }

  // Y grid lines & labels
  const yTicks = 5
  let gridLines = ''
  for (let t = 0; t <= yTicks; t++) {
    const v = (yMax * t) / yTicks
    const y = m.top + yScale(v)
    gridLines += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left + cW}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="1" />`
    gridLines += `<text x="${(m.left - 6).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6B7280" font-family="Arial, sans-serif">${v.toFixed(0)}</text>`
  }

  // Contracted power reference lines per period
  let refLines = ''
  if (potenciaContratada) {
    for (const p of activePeriods) {
      const cont = potenciaContratada[p] ?? 0
      if (cont <= 0) continue
      const y = m.top + yScale(cont)
      refLines += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left + cW}" y2="${y.toFixed(1)}" stroke="${PERIOD_COLORS[p]}" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.7" />`
      refLines += `<text x="${m.left + cW + 3}" y="${(y + 4).toFixed(1)}" font-size="9" fill="${PERIOD_COLORS[p]}" font-family="Arial, sans-serif">${p}: ${cont}kW</text>`
    }
  }

  // X labels
  let xLabels = ''
  for (let i = 0; i < meses.length; i++) {
    const x = m.left + i * groupW + groupW / 2
    const label = monthLabel(meses[i].fechaFin)
    const skip = meses.length > 20 ? i % 2 !== 0 : false
    if (!skip) {
      xLabels += `<text x="${x.toFixed(1)}" y="${(m.top + cH + 18).toFixed(1)}" text-anchor="middle" font-size="9" fill="#374151" font-family="Arial, sans-serif" transform="rotate(-45,${x.toFixed(1)},${(m.top + cH + 18).toFixed(1)})">${label}</text>`
    }
  }

  // Y axis label
  const yAxisLabel = `<text x="${(m.left - 44).toFixed(1)}" y="${(m.top + cH / 2).toFixed(1)}" text-anchor="middle" font-size="10" fill="#6B7280" font-family="Arial, sans-serif" transform="rotate(-90,${(m.left - 44).toFixed(1)},${(m.top + cH / 2).toFixed(1)})">kW</text>`

  // Legend
  let legend = ''
  let lx = m.left
  const legendY = H - 22
  for (const p of activePeriods) {
    legend += `<rect x="${lx}" y="${legendY - 7}" width="10" height="10" fill="${PERIOD_COLORS[p]}" />`
    legend += `<text x="${lx + 13}" y="${legendY + 2}" font-size="10" fill="#374151" font-family="Arial, sans-serif">${p}</text>`
    lx += 42
  }
  if (potenciaContratada) {
    legend += `<line x1="${lx}" y1="${legendY - 2}" x2="${lx + 16}" y2="${legendY - 2}" stroke="#6B7280" stroke-width="1.5" stroke-dasharray="5,3"/>`
    legend += `<text x="${lx + 20}" y="${legendY + 2}" font-size="10" fill="#374151" font-family="Arial, sans-serif">Contratada</text>`
  }

  const title = `<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="#111827" font-family="Arial, sans-serif">MAXÍMETROS MENSUALES (kW)</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff">
  ${title}
  ${gridLines}
  ${refLines}
  ${bars}
  ${maxLabels}
  <line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + cH}" stroke="#9CA3AF" stroke-width="1"/>
  <line x1="${m.left}" y1="${m.top + cH}" x2="${m.left + cW}" y2="${m.top + cH}" stroke="#9CA3AF" stroke-width="1"/>
  ${xLabels}
  ${yAxisLabel}
  ${legend}
</svg>`
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function PowerStudy({
  supplyId, cups, clientName, potenciaContratada, existingStudy, onStudyGenerated, sipsAnnualKwh,
}: PowerStudyProps) {
  const [study, setStudy] = useState<PowerStudyResult | null>(existingStudy ?? null)
  const [loading, setLoading] = useState(false)
  const [loadSource, setLoadSource] = useState<string>('') // what's loading
  type ErrorSource = 'lidera' | 'sips_file' | 'pdf' | 'excel'
  const [error, setError] = useState<{ source: ErrorSource; message: string } | null>(null)
  const ERROR_TITLES: Record<ErrorSource, string> = {
    lidera: 'Error cargando datos de Lidera',
    sips_file: 'Error al procesar el archivo SIPS',
    pdf: 'Error generando PDF',
    excel: 'Error generando Excel',
  }
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const chartConsumoRef = useRef<HTMLDivElement>(null)
  const chartMaxRef = useRef<HTMLDivElement>(null)

  const pc = study?.potenciaContratada ?? potenciaContratada

  // ── Auto-load from Greening/Lidera API on mount ──────────────────────────
  const loadFromAPI = useCallback(async () => {
    if (!cups) return
    setLoading(true)
    setLoadSource('Cargando datos de Lidera…')
    setError(null)
    try {
      // 1. Fetch SIPS from Greening API
      const sipsRes = await fetch('/api/sips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups }),
      })
      const sipsJson = await sipsRes.json()
      if (!sipsRes.ok || !sipsJson.success) {
        throw new Error(sipsJson.error || 'No se pudo obtener datos de Lidera')
      }
      const sipsData = sipsJson.data

      if (!sipsData.consumptionHistory?.length) {
        throw new Error('Lidera no devolvió historial de consumo para este CUPS')
      }

      // 2. Build study from SIPS data
      setLoadSource('Generando estudio…')
      const studyRes = await fetch('/api/power-study-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cups,
          clientName: clientName || undefined,
          potenciaContratada: sipsData.potenciaContratada ?? potenciaContratada ?? {},
          consumptionHistory: sipsData.consumptionHistory,
          maximetroHistory: sipsData.maximetroHistory ?? [],
          reactivaHistory: sipsData.reactivaHistory ?? [],
        }),
      })
      const studyData = await studyRes.json()
      if (!studyRes.ok) throw new Error(studyData.error || 'Error generando estudio')

      setStudy(studyData)
      onStudyGenerated?.(studyData)
    } catch (e: any) {
      setError({ source: 'lidera', message: e.message || 'Error cargando datos de Lidera' })
    } finally {
      setLoading(false)
      setLoadSource('')
    }
  }, [cups, clientName, potenciaContratada, onStudyGenerated])

  // Auto-load on mount if no existing study
  useEffect(() => {
    if (!existingStudy && cups) {
      loadFromAPI()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Process SIPS file (fallback manual upload) ───────────────────────────
  const processFile = useCallback(async (file: File) => {
    setLoading(true)
    setLoadSource('Procesando archivo…')
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (clientName) fd.append('clientName', clientName)
      if (pc) fd.append('potenciaContratada', JSON.stringify(pc))
      const res = await fetch('/api/power-study', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error procesando archivo')
      setStudy(data)
      onStudyGenerated?.(data)
    } catch (e: any) {
      setError({ source: 'sips_file', message: e.message || 'Error al procesar el archivo SIPS' })
    } finally {
      setLoading(false)
      setLoadSource('')
    }
  }, [clientName, pc, onStudyGenerated])

  // ── Convert SVG div to PNG base64 ───────────────────────────────────────
  async function svgDivToPng(divRef: React.RefObject<HTMLDivElement | null>, scale = 2): Promise<string | undefined> {
    const svg = divRef.current?.querySelector('svg')
    if (!svg) return undefined
    const w = parseInt(svg.getAttribute('width') || '820')
    const h = parseInt(svg.getAttribute('height') || '300')
    const svgStr = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgStr], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = w * scale; canvas.height = h * scale
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.scale(scale, scale)
        ctx.drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = url
    })
  }

  // ── Export PDF ───────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    if (!study) return
    setExporting('pdf')
    try {
      const [consumptionPng, maximetroPng] = await Promise.all([
        svgDivToPng(chartConsumoRef),
        svgDivToPng(chartMaxRef),
      ])
      const res = await fetch('/api/power-study-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...study, charts: { consumption: consumptionPng, maximetro: maximetroPng } }),
      })
      if (!res.ok) throw new Error('Error generando PDF')
      // El endpoint devuelve HTML print-ready con @page A4 landscape y
      // un window.onload → window.print() embebido. Lo escribimos en una
      // pestaña nueva para que el diálogo de impresión respete la
      // orientación horizontal.
      const html = await res.text()
      const win = window.open('', '_blank')
      if (win) {
        win.document.open()
        win.document.write(html)
        win.document.close()
        win.focus()
      }
    } catch (e: any) {
      setError({ source: 'pdf', message: e.message })
    } finally {
      setExporting(null)
    }
  }

  // ── Export Excel ─────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    if (!study) return
    setExporting('excel')
    try {
      const [consumptionPng, maximetroPng] = await Promise.all([
        svgDivToPng(chartConsumoRef),
        svgDivToPng(chartMaxRef),
      ])
      const res = await fetch('/api/power-study-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ study, charts: { consumption: consumptionPng, maximetro: maximetroPng } }),
      })
      if (!res.ok) throw new Error('Error generando Excel')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Estudio_Potencias_${study.cups || 'CUPS'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError({ source: 'excel', message: e.message })
    } finally {
      setExporting(null)
    }
  }

  // ── Drag & drop handlers ─────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  // ── Adjustment analysis ──────────────────────────────────────────────────
  const adjustments = study ? calcAdjustments(study.maxPotencia ?? {}, pc) : []
  const periodsToAdjust = adjustments.filter(a => a.needsAdjust)
  const hasMaxData = study?.meses?.some(m => PERIODS.some(p => (m.maximetro?.[p] ?? 0) > 0))

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Loading state ────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Loader2 size={20} color="#3B82F6" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#1D4ED8' }}>{loadSource || 'Cargando…'}</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#3B82F6' }}>Obteniendo datos directamente de Lidera</p>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={14} color="#DC2626" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#991B1B', fontWeight: 600 }}>{ERROR_TITLES[error.source]}</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#B91C1C' }}>{error.message}</p>
            {(error.source === 'lidera' || error.source === 'sips_file') && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={loadFromAPI}
                  style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #FCA5A5', borderRadius: 5, background: '#fff', color: '#DC2626', cursor: 'pointer', fontWeight: 600 }}
                >
                  <RefreshCw size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Reintentar Lidera
                </button>
                <span
                  onClick={() => fileRef.current?.click()}
                  style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', color: '#6B7280', cursor: 'pointer' }}
                >
                  <Upload size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Subir archivo SIPS manual
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.html,.htm"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Study content ─────────────────────────────────────────────────── */}
      {study && (
        <>
          {/* ── KPI Cards ──────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
            {/* Card 1: Total consumo */}
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ background: '#EFF6FF', borderRadius: 6, padding: 6, display: 'flex' }}>
                  <Zap size={16} color="#3B82F6" />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Consumo Total
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>
                {fmtKwh(Math.round(sipsAnnualKwh && sipsAnnualKwh > 0 ? sipsAnnualKwh : study.consumoTotal))} <span style={{ fontSize: 13, fontWeight: 400, color: '#6B7280' }}>kWh</span>
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9CA3AF' }}>
                {sipsAnnualKwh && sipsAnnualKwh > 0
                  ? 'Último año · fuente SIPS'
                  : `${study.meses?.length ?? 0} meses · ${PERIODS.filter(p => (study.consumoPorPeriodo?.[p] ?? 0) > 0).join(', ')}`}
              </p>
            </div>

            {/* Card 2: Max maxímetro */}
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ background: '#F0FDF4', borderRadius: 6, padding: 6, display: 'flex' }}>
                  <TrendingUp size={16} color="#22C55E" />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Maxímetro Máx.
                </span>
              </div>
              {hasMaxData ? (
                <>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>
                    {fmtKw(Math.max(...PERIODS.map(p => study.maxPotencia?.[p] ?? 0)))}{' '}
                    <span style={{ fontSize: 13, fontWeight: 400, color: '#6B7280' }}>kW</span>
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9CA3AF' }}>
                    Período {PERIODS.find(p => study.maxPotencia?.[p] === Math.max(...PERIODS.map(pp => study.maxPotencia?.[pp] ?? 0)))}
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: '#9CA3AF' }}>Sin datos de maxímetro</p>
              )}
            </div>

            {/* Card 3: Optimization recommendation */}
            <div style={{
              background: periodsToAdjust.length > 0 ? '#FFFBEB' : '#F0FDF4',
              border: `1px solid ${periodsToAdjust.length > 0 ? '#FCD34D' : '#86EFAC'}`,
              borderRadius: 10,
              padding: '14px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{
                  background: periodsToAdjust.length > 0 ? '#FEF3C7' : '#DCFCE7',
                  borderRadius: 6, padding: 6, display: 'flex',
                }}>
                  {periodsToAdjust.length > 0
                    ? <AlertTriangle size={16} color="#D97706" />
                    : <CheckCircle2 size={16} color="#16A34A" />}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Optimización
                </span>
              </div>
              {periodsToAdjust.length > 0 ? (
                <>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#92400E' }}>
                    Ajustar {periodsToAdjust.map(a => a.period).join(', ')}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#B45309' }}>
                    {periodsToAdjust.filter(a => a.direction === 'excess').map(a => `${a.period}: +${a.desvPct.toFixed(0)}%`).join(' · ')}
                    {periodsToAdjust.filter(a => a.direction === 'under').map(a => ` ${a.period}: ${a.desvPct.toFixed(0)}%`).join(' · ')}
                  </p>
                </>
              ) : (
                <>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#15803D' }}>Potencias OK</p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#16A34A' }}>Desviación &lt;15% en todos los períodos</p>
                </>
              )}
            </div>
          </div>

          {/* ── CUPS header ─────────────────────────────────────────────── */}
          <div style={{ background: '#1E3A5F', borderRadius: '10px 10px 0 0', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
                {study.cups || cups || '—'}
              </span>
              {(study.clientName || clientName) && (
                <span style={{ color: '#93C5FD', fontSize: 12, marginLeft: 14 }}>
                  {study.clientName || clientName}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Reload from Lidera */}
              <button
                onClick={loadFromAPI}
                disabled={loading || !!exporting}
                title="Recargar datos directamente de Lidera"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.12)', color: '#CBD5E1', border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
                }}
              >
                {loading
                  ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                  : <RefreshCw size={11} />}
                Recargar Lidera
              </button>
              {/* Manual upload fallback */}
              <label title="Subir archivo .xlsx de Lidera manualmente" style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'rgba(255,255,255,0.08)', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6, padding: '4px 10px', fontSize: 11,
                cursor: 'pointer',
              }}>
                <Upload size={11} />
                Subir .xlsx
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.html,.htm"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
                />
              </label>
              <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.2)' }} />
              <button
                onClick={handleExportExcel}
                disabled={!!exporting}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#166534', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600,
                  cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.6 : 1,
                }}
              >
                {exporting === 'excel' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={13} />}
                Excel
              </button>
              <button
                onClick={handleExportPDF}
                disabled={!!exporting}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#7F1D1D', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600,
                  cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.6 : 1,
                }}
              >
                {exporting === 'pdf' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
                PDF
              </button>
            </div>
          </div>

          {/* ── Data table (replicates Excel template) ──────────────────── */}
          <DataTable study={study} pc={pc} adjustments={adjustments} />

          {/* ── Charts ──────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 12, overflow: 'hidden' }}>
              <div
                ref={chartConsumoRef}
                dangerouslySetInnerHTML={{ __html: buildConsumptionSVG(study.meses) }}
                style={{ width: '100%', overflowX: 'auto' }}
              />
            </div>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 12, overflow: 'hidden' }}>
              <div
                ref={chartMaxRef}
                dangerouslySetInnerHTML={{ __html: buildMaximetroSVG(study.meses, pc) }}
                style={{ width: '100%', overflowX: 'auto' }}
              />
            </div>
          </div>

          {/* ── Period breakdown ────────────────────────────────────────── */}
          {hasMaxData && adjustments.some(a => a.contracted > 0) && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px', marginTop: 16 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                <BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Análisis de maxímetros por período
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                {adjustments.map(a => {
                  if (a.contracted <= 0 && a.maxRegistrado <= 0) return null
                  const color = a.needsAdjust
                    ? (a.direction === 'excess' ? '#DC2626' : '#2563EB')
                    : '#16A34A'
                  const bg = a.needsAdjust
                    ? (a.direction === 'excess' ? '#FEF2F2' : '#EFF6FF')
                    : '#F0FDF4'
                  return (
                    <div key={a.period} style={{ background: bg, borderRadius: 8, padding: '10px 8px', textAlign: 'center', border: `1px solid ${color}22` }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: PERIOD_COLORS[a.period], margin: '0 auto 4px' }} />
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#111827' }}>{a.period}</p>
                      <p style={{ margin: '2px 0', fontSize: 11, color: '#6B7280' }}>
                        Máx: <strong style={{ color: '#111827' }}>{fmtKw(a.maxRegistrado)} kW</strong>
                      </p>
                      {a.contracted > 0 && (
                        <p style={{ margin: '2px 0', fontSize: 11, color: '#6B7280' }}>
                          Cont: {fmtKw(a.contracted)} kW
                        </p>
                      )}
                      {a.contracted > 0 && a.maxRegistrado > 0 && (
                        <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700, color }}>
                          {a.desvPct > 0 ? '+' : ''}{a.desvPct.toFixed(1)}%
                          {a.needsAdjust && <span style={{ display: 'block', fontSize: 10 }}>{a.direction === 'excess' ? '▲ EXCESO' : '▼ REDUCIBLE'}</span>}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA TABLE — replicates Excel template structure exactly
// ─────────────────────────────────────────────────────────────────────────────

function DataTable({
  study, pc, adjustments,
}: {
  study: PowerStudyResult
  pc: Record<string, number> | undefined
  adjustments: PeriodAdjustment[]
}) {
  // Table: most recent first (descending by fechaFin)
  const meses = [...(study.meses ?? [])].sort((a, b) => new Date(b.fechaFin).getTime() - new Date(a.fechaFin).getTime())
  const hasMax = meses.some(m => PERIODS.some(p => (m.maximetro?.[p] ?? 0) > 0))

  // Color scales — computed from all data
  const allConsumoVals = meses.flatMap(m => PERIODS.map(p => m.consumo?.[p] ?? 0))
  const consumoCs = make3PointScale(GYR, allConsumoVals)

  const allMaxVals = meses.flatMap(m => PERIODS.map(p => m.maximetro?.[p] ?? 0))
  const maxCs = make3PointScale(BWR, allMaxVals)

  const FONT = '"Arial Narrow", "Calibri", Arial, sans-serif'
  const BASE: React.CSSProperties = {
    padding: '2px 5px', border: '1px solid #000', fontSize: 10,
    fontFamily: FONT, whiteSpace: 'nowrap', background: '#fff',
  }
  const HDR: React.CSSProperties = {
    ...BASE, fontWeight: 700, textAlign: 'center', background: '#fff',
    borderBottom: '2px solid #000',
  }
  const SEP: React.CSSProperties = {
    padding: 0, width: 6, minWidth: 6, background: '#F0F0F0', border: 'none',
  }

  // Summary row values
  const consumoTotalPeriod: Record<string, number> = {}
  for (const p of PERIODS) {
    consumoTotalPeriod[p] = meses.reduce((s, m) => s + (m.consumo?.[p] ?? 0), 0)
  }
  const grandTotal = PERIODS.reduce((s, p) => s + consumoTotalPeriod[p], 0)

  // Period consumption percentage
  const pctOf = (p: Period) => grandTotal > 0 ? consumoTotalPeriod[p] / grandTotal : 0

  // Max maxímetro per period
  const maxPerPeriod: Record<string, number> = {}
  for (const p of PERIODS) {
    maxPerPeriod[p] = Math.max(...meses.map(m => m.maximetro?.[p] ?? 0), 0)
  }

  // Adjustment message for K3
  const periodsExcess = adjustments.filter(a => a.direction === 'excess')
  const periodsUnder = adjustments.filter(a => a.direction === 'under')
  let adjMsg = 'POTENCIAS DENTRO DE RANGO'
  let adjBg = '#E2F0D9'; let adjColor = '#375623'
  if (periodsExcess.length > 0) {
    adjMsg = `AJUSTAR POTENCIAS ${periodsExcess.map(a => a.period).join(' · ')}`
    adjBg = '#FFFF00'; adjColor = '#C00000'
  } else if (periodsUnder.length > 0) {
    adjMsg = `POSIBLE REDUCCIÓN EN ${periodsUnder.map(a => a.period).join(' · ')}`
    adjBg = '#BDD7EE'; adjColor = '#1F4E79'
  }

  // PRIORIZAR message for D4
  const activePeriodsSorted = PERIODS
    .filter(p => consumoTotalPeriod[p] > 0)
    .sort((a, b) => consumoTotalPeriod[b] - consumoTotalPeriod[a])
  const priorizarMsg = activePeriodsSorted.length > 0
    ? 'PRIORIZAR CONSUMO ' + activePeriodsSorted.slice(0, 3).join(' - ')
    : ''

  return (
    <div style={{ overflowX: 'auto', borderLeft: '1px solid #D0D0D0', borderRight: '1px solid #D0D0D0', borderBottom: '1px solid #D0D0D0', marginBottom: 4 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 10, fontFamily: FONT, minWidth: 900 }}>
        <thead>
          {/* Row 1: Column headers */}
          <tr>
            <th colSpan={2} style={{ ...HDR, textAlign: 'left', minWidth: 120 }}>CUPS</th>
            <th style={{ ...HDR, minWidth: 80 }}>CONSUMO TOTAL</th>
            {PERIODS.map(p => <th key={p} style={{ ...HDR, minWidth: 54 }}>{p} Activa</th>)}
            {hasMax && <td style={SEP} />}
            {hasMax && PERIODS.map(p => <th key={`m${p}`} style={{ ...HDR, minWidth: 54 }}>{p} Maxímetro</th>)}
          </tr>
          {/* Row 2: Summary values (totals + max maxímetro) */}
          <tr>
            <td colSpan={2} style={{ ...BASE, fontFamily: 'monospace', fontSize: 9 }}>{study.cups || ''}</td>
            <td style={{ ...BASE, textAlign: 'right', fontWeight: 700 }}>{fmtKwh(grandTotal)}</td>
            {PERIODS.map(p => (
              <td key={p} style={{ ...BASE, textAlign: 'right', background: consumoCs(consumoTotalPeriod[p]) }}>
                {consumoTotalPeriod[p] > 0 ? fmtKwh(consumoTotalPeriod[p]) : ''}
              </td>
            ))}
            {hasMax && <td style={SEP} />}
            {hasMax && PERIODS.map(p => (
              <td key={`m${p}`} style={{ ...BASE, textAlign: 'right', background: maxCs(maxPerPeriod[p]) }}>
                {maxPerPeriod[p] > 0 ? fmtKw(maxPerPeriod[p]) : ''}
              </td>
            ))}
          </tr>
          {/* Row 2b: Contracted power per period (new prominent row) */}
          {pc && PERIODS.some(p => (pc[p] ?? 0) > 0) && (
            <tr>
              <td colSpan={2} style={{ ...BASE, fontWeight: 700, color: '#1F4E79', background: '#DEEAF1', fontSize: 9 }}>
                Potencia Contratada (kW)
              </td>
              <td style={{ ...BASE, background: '#DEEAF1' }} />
              {PERIODS.map(p => (
                <td key={p} style={{ ...BASE, background: '#DEEAF1' }} />
              ))}
              {hasMax && <td style={{ ...SEP, background: '#C9D9E8' }} />}
              {hasMax && PERIODS.map(p => (
                <td key={`c${p}`} style={{
                  ...BASE, textAlign: 'right', fontWeight: 700,
                  background: '#DEEAF1', color: '#1F4E79',
                  borderBottom: '2px solid #1F4E79',
                }}>
                  {(pc[p] ?? 0) > 0 ? fmtKw(pc[p]) : ''}
                </td>
              ))}
            </tr>
          )}
          {/* Row 3: Client name + percentages + adjustment message */}
          <tr>
            <td colSpan={2} style={{ ...BASE, fontSize: 11, fontWeight: 700 }}>
              {study.clientName || ''}
            </td>
            <td style={BASE} />
            {PERIODS.map(p => (
              <td key={p} style={{ ...BASE, textAlign: 'center', color: '#555' }}>
                {consumoTotalPeriod[p] > 0 ? fmtPct(pctOf(p)) : ''}
              </td>
            ))}
            {hasMax && <td style={SEP} />}
            {hasMax && (
              <td
                colSpan={6}
                rowSpan={2}
                style={{
                  ...BASE, fontWeight: 700, textAlign: 'center', fontSize: 11,
                  background: adjBg, color: adjColor, verticalAlign: 'middle',
                }}
              >
                {adjMsg}
              </td>
            )}
          </tr>
          {/* Row 4: PRIORIZAR */}
          <tr>
            <td colSpan={3} style={BASE} />
            <td
              colSpan={6}
              style={{ ...BASE, fontWeight: 700, textAlign: 'center', background: '#FCE4D6', color: '#843C0C', fontSize: 10 }}
            >
              {priorizarMsg}
            </td>
            {!hasMax && null}
          </tr>
        </thead>
        <tbody>
          {meses.map((mes, i) => (
            <tr key={i}>
              <td style={{ ...BASE, textAlign: 'right', minWidth: 44, fontWeight: 700 }}>
                {fmtKwh(mes.consumoTotal ?? 0)}
              </td>
              <td style={{ ...BASE, textAlign: 'center', fontSize: 9, color: '#333' }}>
                {fmtDate(mes.fechaInicio)} – {fmtDate(mes.fechaFin)}
              </td>
              <td style={BASE} />
              {PERIODS.map(p => {
                const v = mes.consumo?.[p] ?? 0
                return (
                  <td key={p} style={{ ...BASE, textAlign: 'right', background: v > 0 ? consumoCs(v) : '#fff' }}>
                    {v > 0 ? fmtKwh(v) : ''}
                  </td>
                )
              })}
              {hasMax && <td style={SEP} />}
              {hasMax && PERIODS.map(p => {
                const v = mes.maximetro?.[p] ?? 0
                return (
                  <td key={`m${p}`} style={{ ...BASE, textAlign: 'right', background: v > 0 ? maxCs(v) : '#fff' }}>
                    {v > 0 ? fmtKw(v) : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
