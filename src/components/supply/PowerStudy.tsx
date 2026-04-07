'use client'

import React, { useState, useRef } from 'react'
import {
  AlertTriangle, CheckCircle2, Download, Loader2,
  BarChart3, FileSpreadsheet, TrendingDown, TrendingUp, Zap,
} from 'lucide-react'
import type { PowerStudyResult } from '@/app/api/power-study/route'

interface PowerStudyProps {
  supplyId: string
  cups: string | null
  clientName?: string
  potenciaContratada?: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  existingStudy?: PowerStudyResult | null
  onStudyGenerated?: (study: PowerStudyResult) => void
}

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = typeof PERIODS[number]

/* ══════════════════════════════════════════════════════════════
   COLOR SCALE — per-column heatmap (replicates Excel colorScale CF)
   Verde (#63BE7B) → Amarillo (#FFEB84) → Rojo (#F8696B)
   Scale is RELATIVE within each column, not global
══════════════════════════════════════════════════════════════ */
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

function makeColumnScale(vals: number[]): (v: number) => string {
  const C0 = '#63BE7B', C1 = '#FFEB84', C2 = '#F8696B'
  const pos = vals.filter(v => v > 0)
  if (!pos.length) return () => C0
  const lo = Math.min(...pos)
  const hi = Math.max(...pos)
  if (lo === hi) return () => C1
  const sorted = [...pos].sort((a, b) => a - b)
  const mid = sorted[Math.floor((sorted.length - 1) / 2)]
  return (v: number): string => {
    if (v <= 0) return C0
    if (v <= lo) return C0
    if (v >= hi) return C2
    if (v <= mid) {
      const t = mid > lo ? (v - lo) / (mid - lo) : 0
      return lerpHex(C0, C1, t)
    }
    const t = hi > mid ? (v - mid) / (hi - mid) : 1
    return lerpHex(C1, C2, t)
  }
}

/* ══════════════════════════════════════════════════════════════
   MAXÍMETRO CELL COLORING
   > contracted * 1.00 → ROJO OSCURO (exceso — facturación penalizada)
   > contracted * 0.85 → ROSA (dentro de rango superior, ok)
   > contracted * 0.50 → AZUL CLARO (infrautilización — oportunidad de reducir)
   ≤ contracted * 0.50 → AZUL OSCURO (muy infrautilizado)
   val = 0             → GRIS (sin dato)
══════════════════════════════════════════════════════════════ */
interface MaxCellResult {
  bg: string
  color: string
  fontWeight: number
  flag: 'excess' | 'ok' | 'low' | 'very-low' | 'no-data'
}

function classifyMaximetro(val: number, contracted: number): MaxCellResult {
  if (val <= 0) {
    return { bg: '#DDEEFF', color: '#4A6FA5', fontWeight: 400, flag: 'no-data' }
  }
  if (contracted <= 0) {
    return { bg: '#F8C4C4', color: '#333', fontWeight: 400, flag: 'ok' }
  }
  const ratio = val / contracted
  if (ratio > 1.0) {
    return { bg: '#F8696B', color: '#7B0000', fontWeight: 700, flag: 'excess' }
  }
  if (ratio >= 0.85) {
    return { bg: '#FFC7CE', color: '#9C0006', fontWeight: 400, flag: 'ok' }
  }
  if (ratio >= 0.50) {
    return { bg: '#BDD7EE', color: '#1F4E79', fontWeight: 400, flag: 'low' }
  }
  return { bg: '#2E75B6', color: '#fff', fontWeight: 700, flag: 'very-low' }
}

/* ══════════════════════════════════════════════════════════════
   FORMATTERS
══════════════════════════════════════════════════════════════ */
function fmtKwh(v: number): string {
  if (v === 0) return '0'
  return v.toLocaleString('es-ES', { maximumFractionDigits: 0 })
}
function fmtKw(v: number): string {
  if (v <= 0) return '-'
  return v.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
function fmtPct(v: number): string {
  return (v * 100).toFixed(2) + '%'
}
function fmtDate(s: string): string {
  try {
    const d = new Date(s)
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return s?.slice(0, 10) || '' }
}

/* ══════════════════════════════════════════════════════════════
   SHARED TABLE STYLES  (Excel-faithful)
══════════════════════════════════════════════════════════════ */
const CELL: React.CSSProperties = {
  padding: '2px 5px',
  border: '1px solid #BFBFBF',
  fontSize: 10,
  fontFamily: 'Calibri, Arial, sans-serif',
  whiteSpace: 'nowrap',
}
const HDR_DARK: React.CSSProperties = {
  ...CELL,
  background: '#404040',
  color: '#fff',
  fontWeight: 700,
  textAlign: 'center',
}
const HDR_COL: React.CSSProperties = {
  ...CELL, background: '#595959', color: '#fff', fontWeight: 700, textAlign: 'center', minWidth: 54,
}
const SEP_CELL: React.CSSProperties = {
  padding: 0, width: 6, minWidth: 6, background: '#e0e0e0', border: 'none',
}
const TOTAL_ROW: React.CSSProperties = {
  ...CELL,
  background: '#D9D9D9',
  fontWeight: 700,
  textAlign: 'right',
}

/* ══════════════════════════════════════════════════════════════
   CHART SVG GENERATORS — string pura, usable en browser y en route
   Datos: 100 % de PowerStudyResult (origen SIPS)
══════════════════════════════════════════════════════════════ */

function escXml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function niceScale(maxVal: number, ticks = 5) {
  const raw = (maxVal * 1.15) / ticks
  if (raw <= 0) return { step: 1, effMax: ticks }
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = Math.ceil(raw / mag) * mag
  return { step, effMax: step * ticks }
}
function fmtK(v: number) {
  if (v >= 1_000_000) return `${(v/1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${(v/1_000).toFixed(0)}k`
  return String(Math.round(v))
}

export function buildConsumptionSVG(meses: PowerStudyResult['meses']): string {
  const W = 900, H = 320, mL = 62, mR = 14, mT = 36, mB = 52
  const cW = W-mL-mR, cH = H-mT-mB
  const vals = meses.map(m => m.consumoTotal ?? 0)
  const maxV = Math.max(...vals.filter(v=>v>0), 1)
  const { step, effMax } = niceScale(maxV)
  const n = meses.length
  const slotW = cW / Math.max(n,1)
  const barW = Math.max(slotW-4, 2)
  const el: string[] = []
  el.push(`<rect width="${W}" height="${H}" fill="#F8FAFC" rx="6"/>`)
  el.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" font-weight="bold" fill="#1A3A8C" font-family="Calibri,Arial,sans-serif">Consumo mensual normalizado (kWh)</text>`)
  for (let i=0;i<=5;i++) {
    const v=i*step, y=mT+cH-(v/effMax)*cH
    el.push(`<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W-mR}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-width="${i===0?1:0.7}"/>`)
    el.push(`<text x="${mL-5}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#64748B" font-family="Calibri,Arial,sans-serif">${fmtK(v)}</text>`)
  }
  el.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)
  el.push(`<line x1="${mL}" y1="${mT+cH}" x2="${W-mR}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)
  meses.forEach((m,i) => {
    const v = m.consumoTotal ?? 0
    const bH = Math.max(v>0?(v/effMax)*cH:0,0)
    const bx = mL+i*slotW+(slotW-barW)/2, by=mT+cH-bH, cx=bx+barW/2
    el.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bH,0).toFixed(1)}" fill="#2E75B6" rx="1.5" opacity="0.9"/>`)
    if (bH>20) el.push(`<text x="${cx.toFixed(1)}" y="${(by-3).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#1E3A5F" font-family="Calibri,Arial,sans-serif">${v.toLocaleString('es-ES')}</text>`)
    let lbl=''
    try { const d=new Date(m.fechaFin||m.fechaInicio||''); if(!isNaN(d.getTime())) { const mn=d.toLocaleDateString('es-ES',{month:'short'}); lbl=`${mn[0].toUpperCase()}${mn.slice(1,3)}'${d.getFullYear().toString().slice(2)}` } } catch {}
    const ly=mT+cH+12
    if(n>24) el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="end" font-size="6.5" fill="#475569" transform="rotate(-45 ${cx.toFixed(1)} ${ly})" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
    else     el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="middle" font-size="7" fill="#475569" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
  })
  el.push(`<text x="${W-mR}" y="${H-2}" text-anchor="end" font-size="7" fill="#94A3B8" font-family="Calibri,Arial,sans-serif">Fuente: SIPS · VOLTIS</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${el.join('')}</svg>`
}

export function buildMaximetrosSVG(
  meses: PowerStudyResult['meses'],
  potenciaContratada?: Record<string, number>
): string {
  const W = 480, H = 320, mL = 52, mR = 14, mT = 36, mB = 52
  const cW = W-mL-mR, cH = H-mT-mB
  const pc = potenciaContratada ?? {}
  const AP = PERIODS.filter(p => meses.some(m => (m.maximetro?.[p]??0) > 0))
  const pC: Record<Period, string> = { P1:'#C00000',P2:'#FF6600',P3:'#FFC000',P4:'#70AD47',P5:'#00B0F0',P6:'#7030A0' }
  const allV = meses.flatMap(m => AP.map(p => m.maximetro?.[p]??0))
  const contV = AP.map(p => pc[p]??0).filter(v=>v>0)
  const maxV = Math.max(...allV,...contV,1)
  const { step, effMax } = niceScale(maxV)
  const n = meses.length, nP = Math.max(AP.length,1)
  const slotW = cW/Math.max(n,1), barW = Math.max((slotW-4)/nP,1.5)
  const el: string[] = []
  el.push(`<rect width="${W}" height="${H}" fill="#F8FAFC" rx="6"/>`)
  el.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" font-weight="bold" fill="#1A3A8C" font-family="Calibri,Arial,sans-serif">Maxímetros registrados (kW)</text>`)
  for (let i=0;i<=5;i++) {
    const v=i*step, y=mT+cH-(v/effMax)*cH
    el.push(`<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W-mR}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-width="${i===0?1:0.7}"/>`)
    el.push(`<text x="${mL-5}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#64748B" font-family="Calibri,Arial,sans-serif">${v.toFixed(0)}</text>`)
  }
  el.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)
  el.push(`<line x1="${mL}" y1="${mT+cH}" x2="${W-mR}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)
  AP.forEach(p => { const c=pc[p]??0; if(c>0) { const y=mT+cH-(c/effMax)*cH; el.push(`<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W-mR}" y2="${y.toFixed(1)}" stroke="${pC[p]}" stroke-width="1" stroke-dasharray="4,3" opacity="0.65"/>`) } })
  meses.forEach((m,i) => {
    const sx=mL+i*slotW
    AP.forEach((p,pi) => {
      const v=m.maximetro?.[p]??0; if(v<=0) return
      const bH=(v/effMax)*cH, bx=sx+pi*barW+(slotW-nP*barW)/2, by=mT+cH-bH
      el.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="${pC[p]}" rx="1" opacity="0.85"/>`)
    })
    let lbl=''
    try { const d=new Date(m.fechaFin||m.fechaInicio||''); if(!isNaN(d.getTime())) { const mn=d.toLocaleDateString('es-ES',{month:'short'}); lbl=`${mn[0].toUpperCase()}${mn.slice(1,3)}'${d.getFullYear().toString().slice(2)}` } } catch {}
    const cx=sx+slotW/2, ly=mT+cH+12
    if(n>16) el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="end" font-size="6.5" fill="#475569" transform="rotate(-45 ${cx.toFixed(1)} ${ly})" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
    else     el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="middle" font-size="7" fill="#475569" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
  })
  let lx=mL; AP.forEach(p => { el.push(`<rect x="${lx}" y="${H-21}" width="9" height="9" fill="${pC[p]}" rx="1"/>`); el.push(`<text x="${lx+11}" y="${H-13}" font-size="7.5" fill="#333" font-family="Calibri,Arial,sans-serif">${p}</text>`); lx+=32 })
  if(contV.length>0) { el.push(`<line x1="${lx}" y1="${H-17}" x2="${lx+14}" y2="${H-17}" stroke="#555" stroke-width="1.2" stroke-dasharray="4,3"/>`); el.push(`<text x="${lx+16}" y="${H-13}" font-size="7.5" fill="#333" font-family="Calibri,Arial,sans-serif">Contratada</text>`) }
  el.push(`<text x="${W-mR}" y="${H-2}" text-anchor="end" font-size="7" fill="#94A3B8" font-family="Calibri,Arial,sans-serif">Fuente: SIPS · VOLTIS</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${el.join('')}</svg>`
}

/** Voltis logo SVG — usada en Excel y PDF */
export function buildVoltisLogoSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
    <rect width="480" height="320" fill="#FFFFFF"/>
    <text x="240" y="145" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="96" fill="#1A3A8C">Voltis</text>
    <polygon points="305,170 332,170 350,60 323,60" fill="#2E75B6" opacity="0.85"/>
    <text x="240" y="210" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" fill="#2E75B6" font-weight="400">energía</text>
    <polygon points="390,240 465,198 465,218 410,260 390,260" fill="#2E75B6" opacity="0.45"/>
  </svg>`
}

/** Convierte un SVG string a PNG base64 usando el Canvas API del navegador */
function svgToPngDataUrl(svgStr: string, w: number, h: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const img  = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w * 2; canvas.height = h * 2   // 2× para resolución HiDPI
      const ctx = canvas.getContext('2d')!
      ctx.scale(2, 2)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

/* ══════════════════════════════════════════════════════════════
   INLINE BAR CHART (SVG)
══════════════════════════════════════════════════════════════ */
function ConsumoBars({ meses }: { meses: PowerStudyResult['meses'] }) {
  const W = 800, H = 200
  const mL = 60, mR = 12, mT = 26, mB = 46
  const cW = W - mL - mR, cH = H - mT - mB
  const vals = meses.map(m => m.consumoTotal || 0)
  const maxV = Math.max(...vals, 1)
  const n = meses.length
  const slotW = cW / Math.max(n, 1)
  const barW = Math.max(slotW - 6, 4)
  const steps = 5
  const step = Math.ceil((maxV * 1.1) / steps / 500) * 500 || 100
  const effMax = step * steps

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', width: '100%', height: 'auto', marginTop: 8 }}>
      <text x={W / 2} y={16} textAnchor="middle" fontSize={11} fontWeight="bold"
        fill="#1A3A8C" fontFamily="Calibri,Arial,sans-serif">
        Consumo mensual normalizado (kWh)
      </text>
      {Array.from({ length: steps + 1 }, (_, i) => {
        const v = i * step
        const y = mT + cH - (v / effMax) * cH
        return (
          <g key={i}>
            <line x1={mL} y1={y} x2={W - mR} y2={y} stroke="#E5E5E5" strokeWidth={0.7} />
            <text x={mL - 4} y={y + 3.5} textAnchor="end" fontSize={7.5} fill="#666">
              {v.toLocaleString('es-ES')}
            </text>
          </g>
        )
      })}
      <line x1={mL} y1={mT} x2={mL} y2={mT + cH} stroke="#AAA" strokeWidth={1} />
      <line x1={mL} y1={mT + cH} x2={W - mR} y2={mT + cH} stroke="#AAA" strokeWidth={1} />
      {meses.map((m, i) => {
        const v = m.consumoTotal || 0
        const bH = Math.max(v > 0 ? (v / effMax) * cH : 0, 0)
        const bx = mL + i * slotW + (slotW - barW) / 2
        const by = mT + cH - bH
        let lbl = ''
        try {
          const d = new Date(m.fechaFin || m.fechaInicio || '')
          const mn = d.toLocaleDateString('es-ES', { month: 'short' })
          lbl = `${mn[0].toUpperCase()}${mn.slice(1, 3)}'${d.getFullYear().toString().slice(2)}`
        } catch { lbl = '' }
        const cx = bx + barW / 2
        const ly = mT + cH + 11
        const rot = n > 20 ? `rotate(-40 ${cx} ${ly})` : undefined
        return (
          <g key={i}>
            <rect x={bx} y={by} width={barW} height={bH} fill="#2E75B6" rx={1} />
            {bH > 18 && (
              <text x={cx} y={by - 2} textAnchor="middle" fontSize={6} fill="#222">
                {v.toLocaleString('es-ES')}
              </text>
            )}
            <text x={cx} y={ly} textAnchor={rot ? 'end' : 'middle'} fontSize={7} fill="#555"
              transform={rot}>
              {lbl}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export function PowerStudy({
  supplyId, cups, clientName, potenciaContratada, existingStudy, onStudyGenerated,
}: PowerStudyProps) {
  const [study, setStudy] = useState<PowerStudyResult | null>(existingStudy || null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('clientName', clientName || '')
      if (potenciaContratada) fd.append('potenciaContratada', JSON.stringify(potenciaContratada))
      const res = await fetch('/api/power-study', { method: 'POST', body: fd })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error procesando archivo')
      if (cups) result.cups = cups
      if (potenciaContratada) result.potenciaContratada = potenciaContratada
      setStudy(result)
      onStudyGenerated?.(result)
    } catch (err: any) {
      setError(err.message || 'Error al procesar')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleExportExcel = async () => {
    if (!study) return
    try {
      // Generar gráficas en el navegador como PNG antes de enviar al servidor
      const [consumptionPng, logoPng] = await Promise.all([
        svgToPngDataUrl(buildConsumptionSVG(study.meses ?? []), 900, 320).catch(() => undefined),
        svgToPngDataUrl(buildVoltisLogoSVG(), 480, 320).catch(() => undefined),
      ])

      const res = await fetch('/api/power-study-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          study,
          charts: { consumption: consumptionPng, logo: logoPng },
        }),
      })
      if (!res.ok) throw new Error('Error Excel')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const slug = (study.clientName || study.cups || 'estudio').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)
      a.href = url; a.download = `Estudio_Potencias_${slug}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) { setError(err.message) }
  }

  const handleExportPDF = async () => {
    if (!study) return
    try {
      const res = await fetch('/api/power-study-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(study),
      })
      if (!res.ok) throw new Error('Error PDF')
      const html = await res.text()
      const w = window.open('', '_blank')
      if (w) { w.document.write(html); w.document.close() }
    } catch {
      if (printRef.current) {
        const w = window.open('', '_blank')
        if (w) {
          w.document.write(`<!DOCTYPE html><html><body>${printRef.current.innerHTML}</body></html>`)
          w.document.close(); setTimeout(() => w.print(), 300)
        }
      }
    }
  }

  /* ── No study ── */
  if (!study) {
    return (
      <div className="border border-outline-variant/30 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-low border-b border-outline-variant/20">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Estudio de Potencias y Consumos</h3>
            <p className="text-xs text-on-surface-variant">Se genera automáticamente al consultar SIPS</p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {!potenciaContratada && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              Consulta datos SIPS primero para generar el estudio automáticamente.
            </p>
          )}
          {potenciaContratada && (
            <div className="flex items-center gap-2 text-xs text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              El estudio se generará automáticamente con los datos de SIPS...
            </div>
          )}
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.tsv" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-outline-variant/30 rounded-xl hover:border-secondary/40 hover:bg-secondary/5 transition-all text-xs text-on-surface-variant">
            {uploading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Procesando...</>
              : <><FileSpreadsheet className="w-3.5 h-3.5" />Subir Excel de comercializadora manualmente (opcional)</>}
          </button>
          {error && (
            <div className="flex items-center gap-2 text-xs text-error bg-error-container/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ══════════════════════════════════════════════════════════════
     CALCULATIONS — deterministic, Excel-faithful
  ══════════════════════════════════════════════════════════════ */
  const meses = study.meses ?? []
  const pc = study.potenciaContratada ?? { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  const hasPotencia = PERIODS.some(p => (pc[p] || 0) > 0)

  // ── CONSUMO: totals ──
  // consumoTotal = SUM of all meses.consumoTotal
  const consumoTotal = meses.reduce((s, m) => s + (m.consumoTotal || 0), 0)

  // Per-period totals = SUM of each period across all months
  const periodoTotal: Record<Period, number> = {} as any
  PERIODS.forEach(p => {
    periodoTotal[p] = meses.reduce((s, m) => s + (m.consumo?.[p] || 0), 0)
  })

  // Per-period % = periodoTotal[p] / consumoTotal
  const periodoPct: Record<Period, number> = {} as any
  PERIODS.forEach(p => {
    periodoPct[p] = consumoTotal > 0 ? periodoTotal[p] / consumoTotal : 0
  })

  // ── PER-COLUMN HEATMAP SCALES (relative within each column) ──
  const totalScale = makeColumnScale(meses.map(m => m.consumoTotal || 0))
  const periodoScales: Record<Period, (v: number) => string> = {} as any
  PERIODS.forEach(p => {
    periodoScales[p] = makeColumnScale(meses.map(m => m.consumo?.[p] || 0))
  })

  // ── NEW: Scales for percentage and annual totals ──
  const pctScale = makeColumnScale(PERIODS.map(p => periodoPct[p]))
  const annualScale = makeColumnScale(PERIODS.map(p => periodoTotal[p]))
  const hasMaximetros = meses.some(m => PERIODS.some(p => (m.maximetro?.[p] || 0) > 0))

  // ── PRIORITY MESSAGE ──
  // Sort active periods by total descending → "PRIORIZAR CONSUMO P6 - P4 - P2"
  const activePeriods = PERIODS
    .filter(p => periodoTotal[p] > 0)
    .sort((a, b) => periodoTotal[b] - periodoTotal[a])
  const prioMsg = activePeriods.length > 0
    ? 'PRIORIZAR CONSUMO ' + activePeriods.slice(0, 3).join(' - ')
    : ''

  // ── MAXÍMETROS ──
  // maxPotencia[p] = MAX of all meses.maximetro[p]
  const maxPotencia: Record<Period, number> = {} as any
  PERIODS.forEach(p => {
    maxPotencia[p] = Math.max(...meses.map(m => m.maximetro?.[p] || 0), 0)
  })

  // Periods needing adjustment = where ANY month maximetro > contracted
  const periodsToAdjust = PERIODS.filter(p => {
    const cont = pc[p] || 0
    if (cont <= 0) return false
    return meses.some(m => (m.maximetro?.[p] || 0) > cont)
  })
  const hasExcess = periodsToAdjust.length > 0

  // Periods with opportunity to reduce
  const periodsToReduce = PERIODS.filter(p => {
    const cont = pc[p] || 0
    const max = maxPotencia[p]
    if (cont <= 0 || max <= 0) return false
    return max < cont * 0.85 && !periodsToAdjust.includes(p)
  })

  // Adjustment message
  let adjText: string
  let adjBg: string
  let adjColor: string
  if (hasExcess) {
    adjText = `⚠ OBLIGATORIO AJUSTAR ${periodsToAdjust.join(' · ')}`
    adjBg = '#FFFF00'; adjColor = '#C00000'
  } else if (periodsToReduce.length > 0) {
    adjText = `💡 POSIBLE REDUCCIÓN EN ${periodsToReduce.join(' · ')}`
    adjBg = '#BDD7EE'; adjColor = '#1F4E79'
  } else if (hasPotencia) {
    adjText = '✓ Potencias dentro de rango'
    adjBg = '#E2F0D9'; adjColor = '#375623'
  } else {
    adjText = 'Sin potencia contratada de referencia'
    adjBg = '#F5F5F5'; adjColor = '#666'
  }

  // ── REACTIVA: solo alerta, sin tabla ──
  const hasReactiva = study.hasRelevantReactiva

  return (
    <div className="border border-outline-variant/30 rounded-2xl overflow-hidden">

      {/* ── Header ── */}
      <div className={`flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 ${hasExcess ? 'bg-red-50' : 'bg-green-50'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${hasExcess ? 'bg-red-100' : 'bg-green-100'}`}>
            {hasExcess
              ? <AlertTriangle className="w-5 h-5 text-red-600" />
              : <CheckCircle2 className="w-5 h-5 text-green-600" />}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Estudio de Potencias y Consumos</h3>
            <p className={`text-xs font-semibold ${hasExcess ? 'text-red-700' : 'text-green-700'}`}>
              {hasExcess
                ? `OBLIGATORIO AJUSTAR ${periodsToAdjust.join(' · ')}`
                : periodsToReduce.length > 0
                  ? `Posible reducción en ${periodsToReduce.join(' · ')}`
                  : 'Potencias dentro de rango'}
            </p>
            {prioMsg && (
              <p className="text-[10px] text-amber-700 font-medium">{prioMsg}</p>
            )}
            {study.autoGenerated && (
              <p className="text-[10px] text-on-surface-variant mt-0.5">
                Generado automáticamente desde SIPS{study.hasRealMaximetros ? '' : ' · Sin maxímetros reales'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg hover:shadow-md transition-all active:scale-[0.97]">
            <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">Excel</span>
          </button>
          <button onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-on-surface bg-white border border-outline-variant/20 rounded-lg hover:shadow-md transition-all active:scale-[0.97]">
            <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">PDF</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.tsv" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-white/50 transition-all" title="Subir Excel manualmente">
            <FileSpreadsheet className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Tables ── */}
      <div ref={printRef} className="overflow-x-auto p-3 bg-white">
        <table style={{ borderCollapse: 'collapse', fontSize: 10, fontFamily: 'Calibri,Arial,sans-serif' }}>
          <colgroup>
            <col style={{ minWidth: 72 }} />
            <col style={{ minWidth: 66 }} />
            <col style={{ minWidth: 66 }} />
            {PERIODS.map(p => <col key={p} style={{ minWidth: 56 }} />)}
            <col style={{ width: 6 }} />
            {hasMaximetros && PERIODS.map(p => <col key={`m${p}`} style={{ minWidth: 62 }} />)}
          </colgroup>
          <thead>
            {/* ── Fila 0: spans de sección ── */}
            <tr>
              <th colSpan={3} style={{ ...HDR_COL, textAlign: 'left', paddingLeft: 8, background: '#404040' }}>
                {study.clientName || study.cups || 'PUNTO DE SUMINISTRO'}
              </th>
              <th colSpan={6} style={{ ...HDR_COL, background: '#404040', letterSpacing: '0.06em', fontSize: 9 }}>
                ⚡ CONSUMOS ACTIVA (kWh)
              </th>
              <td style={SEP_CELL} />
              {hasMaximetros && (
                <th colSpan={6} style={{ ...HDR_COL, background: '#404040', letterSpacing: '0.06em', fontSize: 9 }}>
                  📊 MAXÍMETROS (kW)
                </th>
              )}
            </tr>
            {/* ── Fila 1: etiquetas columnas (gris uniforme) ── */}
            <tr>
              <th style={{ ...HDR_COL, textAlign: 'right' }}>kWh Total</th>
              <th style={HDR_COL}>F. Inicio</th>
              <th style={HDR_COL}>F. Fin</th>
              {PERIODS.map(p => <th key={p} style={HDR_COL}>{p}</th>)}
              <td style={SEP_CELL} />
              {hasMaximetros && PERIODS.map(p => <th key={`m${p}`} style={HDR_COL}>{p}</th>)}
            </tr>
            {/* ── Fila 2: totales anuales (verde) + max global ── */}
            <tr>
              <td style={{ ...CELL, background: '#C6EFCE', color: '#1F5C2E', fontWeight: 700, textAlign: 'right', fontSize: 11 }}>
                {fmtKwh(consumoTotal)}
              </td>
              <td style={{ ...CELL, background: '#E2F0D9', fontStyle: 'italic', fontSize: 9, color: '#555', textAlign: 'center' }}>
                {(study.cups || '').slice(0, 22)}
              </td>
              <td style={{ ...CELL, background: '#E2F0D9', fontWeight: 700, textAlign: 'center', fontSize: 9, color: '#375623' }}>
                ANUAL
              </td>
              {PERIODS.map(p => (
                <td key={p} style={{ ...CELL, background: annualScale(periodoTotal[p]), fontWeight: 700, textAlign: 'right', color: '#1F3864' }}>
                  {fmtKwh(periodoTotal[p])}
                </td>
              ))}
              <td style={SEP_CELL} />
              {hasMaximetros && PERIODS.map(p => {
                const mx = maxPotencia[p]
                const cls = classifyMaximetro(mx, pc[p])
                return (
                  <td key={`m${p}`} style={{ ...CELL, background: cls.bg, color: cls.color, fontWeight: 700, textAlign: 'center' }}>
                    {mx > 0 ? fmtKw(mx) : '-'}
                  </td>
                )
              })}
            </tr>
            {/* ── Fila 3: % por periodo + potencia contratada ── */}
            <tr>
              <td style={{ ...CELL, background: '#F2F2F2', fontWeight: 700, textAlign: 'right', color: '#555' }}>100.00%</td>
              <td colSpan={2} style={{ ...CELL, background: '#F2F2F2', textAlign: 'center', fontWeight: 700, fontSize: 9, color: '#555' }}>% POR PERIODO</td>
              {PERIODS.map(p => {
                const pct = periodoPct[p]
                return (
                  <td key={p} style={{ ...CELL, background: pct > 0 ? pctScale(pct) : '#F2F2F2', fontWeight: 700, textAlign: 'right', color: '#1F3864' }}>
                    {pct > 0 ? fmtPct(pct) : '-'}
                  </td>
                )
              })}
              <td style={SEP_CELL} />
              {hasMaximetros && PERIODS.map(p => (
                <td key={`c${p}`} style={{ ...CELL, background: '#D9E1F2', fontWeight: 700, color: '#1F3864', textAlign: 'center' }}>
                  {(pc as any)[p] > 0 ? fmtKw((pc as any)[p]) : '-'}
                </td>
              ))}
            </tr>
            {/* ── Fila 4: mensajes priorizar + ajustar ── */}
            <tr>
              <td colSpan={9} style={{
                ...CELL,
                background: prioMsg ? '#FAD7A0' : '#F5F5F5',
                color: '#7B3F00',
                fontWeight: 700,
                textAlign: 'center',
                padding: '3px 8px',
                fontSize: 10,
                letterSpacing: '0.04em',
              }}>
                {prioMsg || ''}
              </td>
              <td style={SEP_CELL} />
              {hasMaximetros && (
                <td colSpan={6} style={{
                  ...CELL,
                  background: adjBg,
                  color: adjColor,
                  fontWeight: 700,
                  textAlign: 'center',
                  fontSize: 9,
                  padding: '3px 8px',
                }}>
                  {adjText}
                </td>
              )}
            </tr>
          </thead>
          <tbody>
            {meses.map((m, i) => {
              const tot = m.consumoTotal || 0
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F9F9F9' }}>
                  <td style={{ ...CELL, background: totalScale(tot), fontWeight: 700, textAlign: 'right' }}>
                    {fmtKwh(tot)}
                  </td>
                  <td style={{ ...CELL, textAlign: 'center', color: '#444' }}>
                    {m.fechaInicio ? fmtDate(m.fechaInicio) : '-'}
                  </td>
                  <td style={{ ...CELL, textAlign: 'center', color: '#444' }}>
                    {m.fechaFin ? fmtDate(m.fechaFin) : '-'}
                  </td>
                  {PERIODS.map(p => {
                    const v = m.consumo?.[p] || 0
                    return (
                      <td key={p} style={{ ...CELL, background: periodoScales[p](v), textAlign: 'right' }}>
                        {v > 0 ? fmtKwh(v) : '0'}
                      </td>
                    )
                  })}
                  <td style={SEP_CELL} />
                  {hasMaximetros && PERIODS.map(p => {
                    const val = m.maximetro?.[p] || 0
                    const cls = classifyMaximetro(val, (pc as any)[p] || 0)
                    return (
                      <td key={`m${p}`} style={{
                        ...CELL,
                        background: val > 0 ? cls.bg : '#DDEEFF',
                        color: val > 0 ? cls.color : '#4A6FA5',
                        fontWeight: cls.fontWeight,
                        textAlign: 'center',
                      }}>
                        {val > 0 ? fmtKw(val) : '-'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #595959' }}>
              <td style={TOTAL_ROW}>{fmtKwh(consumoTotal)}</td>
              <td colSpan={2} style={{ ...TOTAL_ROW, textAlign: 'center' }}>TOTAL</td>
              {PERIODS.map(p => (
                <td key={p} style={TOTAL_ROW}>{fmtKwh(periodoTotal[p])}</td>
              ))}
              <td style={SEP_CELL} />
              {hasMaximetros && PERIODS.map(p => {
                const mx = maxPotencia[p]
                const cls = classifyMaximetro(mx, (pc as any)[p] || 0)
                return (
                  <td key={`m${p}`} style={{ ...CELL, background: mx > 0 ? cls.bg : '#DDEEFF', color: mx > 0 ? cls.color : '#4A6FA5', fontWeight: 700, textAlign: 'center', borderTop: '2px solid #595959' }}>
                    {mx > 0 ? fmtKw(mx) : '-'}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>

        {/* ── Legend (below table) ── */}
        {hasMaximetros && (
          <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 8.5, color: '#555', fontFamily: 'Calibri,Arial,sans-serif', flexWrap: 'wrap' }}>
            <LegendDot color="#F8696B" label="Exceso (>contratada)" />
            <LegendDot color="#FFC7CE" label="Dentro de rango (±15%)" />
            <LegendDot color="#BDD7EE" label="Infrautilizado (<85%)" />
            <LegendDot color="#2E75B6" textColor="#fff" label="Muy bajo (<50%)" />
            <LegendDot color="#DDEEFF" label="Sin dato" />
          </div>
        )}

        {/* ── Alerta reactivas ── */}
        {hasReactiva && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
            background: '#FEF3E2', border: '1.5px solid #FAD7A0', borderRadius: 6,
            padding: '6px 12px',
          }}>
            <AlertTriangle style={{ width: 14, height: 14, color: '#C55A11', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#7B3F00', fontFamily: 'Calibri,Arial,sans-serif' }}>
              ⚠ CHECKEAR REACTIVAS — se detectan valores superiores a 1.000 kvarh
            </span>
          </div>
        )}

        {/* ── Bar Chart ── */}
        {meses.length > 0 && <ConsumoBars meses={meses} />}

        {error && (
          <p style={{ marginTop: 8, fontSize: 11, color: '#C00000', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle style={{ width: 12, height: 12 }} />{error}
          </p>
        )}
      </div>
    </div>
  )
}

/* ── Leyenda dot helper ── */
function LegendDot({ color, textColor = '#333', label }: { color: string; textColor?: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ display: 'inline-block', width: 11, height: 11, background: color, borderRadius: 2, border: '1px solid rgba(0,0,0,0.15)', flexShrink: 0 }} />
      <span style={{ color: textColor === '#333' ? '#555' : textColor }}>{label}</span>
    </div>
  )
}
