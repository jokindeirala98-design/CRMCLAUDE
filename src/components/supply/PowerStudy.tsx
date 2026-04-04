'use client'

import React, { useState, useRef, useMemo } from 'react'
import {
  AlertTriangle, CheckCircle2, Download, Loader2,
  BarChart3, FileSpreadsheet
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
type CS3 = [string, string, string]

// ── ColorScale helpers (identical algorithm to Excel colorScale CF) ────────
const GYR: CS3 = ['#63BE7B', '#FFEB84', '#F8696B']  // green → yellow → red

function lerpHex(c1: string, c2: string, t: number): string {
  const h = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]
  const [r1, g1, b1] = h(c1), [r2, g2, b2] = h(c2)
  const p = (a: number, b: number) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0')
  return `#${p(r1, r2)}${p(g1, g2)}${p(b1, b2)}`
}

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
// Dark red ONLY when the column's max value is outside ±15% of contracted power.
// Otherwise light pink. Blue for 0/empty.
function maxCellStyle(val: number, contracted: number, columnOutOfRange: boolean): React.CSSProperties {
  if (val <= 0) return { background: '#6BA3D6', color: '#fff' }   // Blue for empty/zero
  if (contracted <= 0) return { background: '#F8C4C4' }           // Light pink (no reference)
  if (columnOutOfRange) return { background: '#F8696B', color: '#7B1A1A', fontWeight: 700 } // Dark red
  return { background: '#F8C4C4' } // Light pink
}

function formatKw(val: number): string {
  if (val === 0) return '-'
  return val.toFixed(3).replace(/\.?0+$/, '') || '0'
}
function formatKwh(val: number): string {
  if (val === 0) return '0'
  return val.toLocaleString('es-ES')
}
function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return dateStr?.slice(0, 10) || ''
  }
}

// ── Shared cell styles ────────────────────────────────────────────────────
const HDR: React.CSSProperties = {
  padding: '4px 6px', border: '1px solid #B0B0B0',
  background: '#595959', color: '#fff',
  fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap',
}
// Section super-header (group label row)
const SHDR: React.CSSProperties = {
  padding: '3px 6px', border: '1px solid #B0B0B0',
  background: '#3F3F3F', color: '#fff',
  fontWeight: 700, textAlign: 'center', fontSize: '9px',
  letterSpacing: '0.06em', textTransform: 'uppercase' as const,
  whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '3px 6px', border: '1px solid #D0D0D0', textAlign: 'right',
}
// Strong left border for first maximetro column (section separator)
const SEP_BORDER = '3px solid #595959'

// ── Bar chart (inline SVG, React) ─────────────────────────────────────────
function BarChart({ meses }: { meses: PowerStudyResult['meses'] }) {
  const W = 820, H = 220
  const mL = 70, mR = 16, mT = 30, mB = 52
  const cW = W - mL - mR, cH = H - mT - mB

  const vals = meses.map(m => m.consumoTotal || 0)
  const maxVal = Math.max(...vals)
  if (maxVal === 0) return null

  const n = meses.length
  const slotW = cW / n
  const barW = Math.max(slotW - 4, 3)
  const steps = 5
  const stepVal = Math.ceil(maxVal / steps / 1000) * 1000 || Math.ceil(maxVal / steps)
  const effectiveMax = maxVal * 1.05

  const gridLines = Array.from({ length: steps + 1 }, (_, i) => {
    const v = i * stepVal
    if (v > effectiveMax) return null
    const y = mT + cH - (v / effectiveMax) * cH
    return (
      <g key={i}>
        <line x1={mL} y1={y} x2={W - mR} y2={y} stroke="#E0E0E0" strokeWidth={0.8} />
        <text x={mL - 6} y={y + 3.5} textAnchor="end" fontSize={8} fill="#666">
          {v.toLocaleString('es-ES')}
        </text>
      </g>
    )
  })

  const bars = meses.map((m, i) => {
    const v = m.consumoTotal || 0
    const bH = v > 0 ? Math.max(2, (v / effectiveMax) * cH) : 0
    const bx = mL + i * slotW + (slotW - barW) / 2
    const by = mT + cH - bH

    let label = ''
    try {
      const d = new Date(m.fechaFin || m.fechaInicio || '')
      const mn = d.toLocaleDateString('es-ES', { month: 'short' })
      label = `${mn.charAt(0).toUpperCase()}${mn.slice(1, 3)} ${d.getFullYear().toString().slice(2)}`
    } catch { label = '' }

    const lx = bx + barW / 2
    const ly = mT + cH + 13
    const rotate = n > 18 ? `rotate(-40 ${lx} ${ly})` : undefined
    const anchor = n > 18 ? 'end' : 'middle'

    return (
      <g key={i}>
        <rect x={bx} y={by} width={barW} height={bH} fill="#2E75B6" rx={1} />
        {bH > 16 && (
          <text x={lx} y={by - 3} textAnchor="middle" fontSize={6.5} fill="#333">
            {v.toLocaleString('es-ES')}
          </text>
        )}
        <text x={lx} y={ly} textAnchor={anchor} fontSize={7.5} fill="#444"
          transform={rotate ? `rotate(-40 ${lx} ${ly})` : undefined}>
          {label}
        </text>
      </g>
    )
  })

  return (
    <div className="mt-4">
      <svg
        width={W} height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      >
        <text x={W / 2} y={18} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#1A3A8C" fontFamily="Arial,Helvetica,sans-serif">
          Consumo mensual normalizado (kWh)
        </text>
        {gridLines}
        <line x1={mL} y1={mT} x2={mL} y2={mT + cH} stroke="#999" strokeWidth={1} />
        <line x1={mL} y1={mT + cH} x2={W - mR} y2={mT + cH} stroke="#999" strokeWidth={1} />
        {bars}
      </svg>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
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
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('clientName', clientName || '')
      if (potenciaContratada) formData.append('potenciaContratada', JSON.stringify(potenciaContratada))
      const res = await fetch('/api/power-study', { method: 'POST', body: formData })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error procesando archivo')
      if (cups) result.cups = cups
      if (potenciaContratada) result.potenciaContratada = potenciaContratada
      setStudy(result)
      onStudyGenerated?.(result)
    } catch (err: any) {
      setError(err.message || 'Error al procesar el archivo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleExportExcel = async () => {
    if (!study) return
    setError('')
    try {
      const res = await fetch('/api/power-study-excel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(study),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Error generando Excel') }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const slug = (study.clientName || study.cups || 'estudio').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 40)
      a.href = url; a.download = `Estudio_Potencias_${slug}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) { setError(err?.message || 'Error generando Excel') }
  }

  const handleExportPDF = async () => {
    if (!study) return
    try {
      const res = await fetch('/api/power-study-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(study),
      })
      if (!res.ok) throw new Error('Error generando PDF')
      const html = await res.text()
      const w = window.open('', '_blank')
      if (!w) return
      w.document.write(html); w.document.close()
    } catch (err) {
      if (printRef.current) {
        const w = window.open('', '_blank')
        if (!w) return
        w.document.write(`<!DOCTYPE html><html><body>${printRef.current.innerHTML}</body></html>`)
        w.document.close(); setTimeout(() => w.print(), 300)
      }
    }
  }

  // ── No study yet ────────────────────────────────────────────────────────
  if (!study) {
    return (
      <div className="border border-outline-variant/30 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-low border-b border-outline-variant/20">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Estudio de Potencias</h3>
            <p className="text-xs text-on-surface-variant">Se genera automaticamente al consultar SIPS</p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {!potenciaContratada && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              Consulta datos SIPS primero para generar el estudio automaticamente.
            </p>
          )}
          {potenciaContratada && (
            <div className="flex items-center gap-2 text-xs text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              El estudio se generara automaticamente con los datos de SIPS...
            </div>
          )}
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.tsv" onChange={handleFileUpload} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-outline-variant/30 rounded-xl hover:border-secondary/40 hover:bg-secondary/5 transition-all text-xs text-on-surface-variant"
          >
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

  // ── Build ColorScale functions ────────────────────────────────────────────
  const meses = study.meses ?? []
  const pc = study.potenciaContratada
  const hasPotencia = Object.values(pc).some(v => v > 0)
  const top = study.topConsumoPeriods || []
  const reco = top.length ? 'PRIORIZAR CONSUMO ' + top.join(' - ') : ''

  const allTotals = meses.map(m => m.consumoTotal || 0)
  const allPeriod = meses.flatMap(m => PERIODS.map(p => m.consumo?.[p] || 0))
  const allPct = PERIODS.map(p => (study.consumoPorcentaje?.[p] || 0) * 100)

  const totalCs = makeScale(allTotals, GYR)
  const periodCs = makeScale(allPeriod, GYR)
  const pctCs = makeScale(allPct, GYR)

  const csStyle = (color: string): React.CSSProperties =>
    color !== 'transparent' ? { background: color } : {}

  // Consumption cells: v=0 → green, v>0 → colorScale
  const consumoStyle = (v: number, scale: (n: number) => string): React.CSSProperties =>
    v > 0 ? csStyle(scale(v)) : { background: '#63BE7B' }

  // Adjustment warning
  const periodsOutOfRange = PERIODS.filter(p => {
    const max = study.maxPotencia[p]
    const contracted = pc[p]
    if (!contracted || !max) return false
    const r = max / contracted
    return r > 1.15 || r < 0.85
  })
  const outOfRangeSet = new Set(periodsOutOfRange)
  const hasExcess = periodsOutOfRange.length > 0
  const adjBg = hasExcess ? '#FFFF00' : '#E2F0D9'
  const adjColor = hasExcess ? '#C00000' : '#375623'
  const adjText = hasExcess
    ? `OBLIGATORIO AJUSTAR ${periodsOutOfRange.join(' · ')}`
    : 'Potencias dentro de rango'

  return (
    <div className="border border-outline-variant/30 rounded-2xl overflow-hidden">
      {/* Header card */}
      <div className={`flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 ${hasExcess ? 'bg-red-50' : 'bg-green-50'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${hasExcess ? 'bg-red-100' : 'bg-green-100'}`}>
            {hasExcess
              ? <AlertTriangle className="w-5 h-5 text-red-600" />
              : <CheckCircle2 className="w-5 h-5 text-green-600" />}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Estudio de Potencias</h3>
            <p className={`text-xs font-medium ${hasExcess ? 'text-red-600' : 'text-green-600'}`}>
              {hasExcess ? 'OBLIGATORIO AJUSTAR POTENCIAS' : 'Potencias dentro de rango'}
            </p>
            {study.autoGenerated && (
              <p className="text-[10px] text-on-surface-variant mt-0.5">
                Generado automáticamente desde SIPS{study.hasRealMaximetros ? '' : ' · Sin maxímetros'}
              </p>
            )}
            {top.length > 0 && (
              <p className="text-[10px] text-on-surface-variant">Priorizar: {top.join(' - ')}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg shadow-sm hover:shadow-md transition-all active:scale-[0.97]"
            title="Exportar Excel">
            <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">Excel</span>
          </button>
          <button onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-on-surface bg-white rounded-lg shadow-sm hover:shadow-md transition-all active:scale-[0.97]">
            <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">PDF</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.tsv" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-white/50 transition-all"
            title="Recalcular con Excel de comercializadora">
            <FileSpreadsheet className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Study tables side by side + chart ── */}
      <div ref={printRef} className="overflow-x-auto p-3">
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>

          {/* ═══ TABLE 1: CONSUMOS ACTIVA (left) ═══ */}
          <table className="text-[10px] border-collapse" style={{ flexShrink: 0 }}>
            <thead>
              <tr>
                <th colSpan={3} style={{ ...SHDR, background: '#404040', textAlign: 'left' }}>PERÍODO</th>
                <th colSpan={6} style={{ ...SHDR, background: '#3D6B3D' }}>⚡ CONSUMOS ACTIVA (kWh)</th>
              </tr>
              <tr>
                <th style={{ ...HDR, textAlign: 'left', minWidth: 52 }}>kWh</th>
                <th style={{ ...HDR, minWidth: 68 }}>Fecha Inicio</th>
                <th style={{ ...HDR, minWidth: 68 }}>Fecha Fin</th>
                {PERIODS.map(p => <th key={p} style={{ ...HDR, minWidth: 50 }}>{p}</th>)}
              </tr>

              {/* CUPS + annual totals */}
              <tr>
                <td style={{ ...TD, background: '#F0F0F0', fontWeight: 700, textAlign: 'left', fontFamily: 'monospace', fontSize: '8px', whiteSpace: 'nowrap' }}>
                  {study.cups}
                </td>
                <td style={{ ...TD, background: '#F0F0F0' }}></td>
                <td style={{ ...TD, background: '#F0F0F0', fontWeight: 700, textAlign: 'center' }}>{formatKwh(study.consumoTotal)}</td>
                {PERIODS.map(p => {
                  const v = study.consumoPorPeriodo?.[p] || 0
                  return (
                    <td key={p} style={{ ...TD, ...consumoStyle(v, periodCs), fontWeight: 700 }}>
                      {formatKwh(v)}
                    </td>
                  )
                })}
              </tr>

              {/* Client name + % per period */}
              <tr>
                <td style={{ ...TD, background: '#F0F0F0', fontWeight: 700, textAlign: 'left', fontSize: '9px', whiteSpace: 'nowrap' }}>
                  {study.clientName || ''}
                </td>
                <td style={{ ...TD, background: '#F0F0F0' }}></td>
                <td style={{ ...TD, background: '#F0F0F0' }}></td>
                {PERIODS.map(p => {
                  const pv = (study.consumoPorcentaje?.[p] || 0) * 100
                  return (
                    <td key={p} style={{ ...TD, ...csStyle(pctCs(pv)), fontWeight: 700 }}>
                      {pv.toFixed(2)}%
                    </td>
                  )
                })}
              </tr>

              {/* Priority recommendation */}
              {reco && (
                <tr>
                  <td colSpan={3} style={TD}></td>
                  <td colSpan={6} style={{ ...TD, background: '#FAD7A0', color: '#1F3864', fontWeight: 700, textAlign: 'center' }}>
                    {reco}
                  </td>
                </tr>
              )}
            </thead>

            <tbody>
              {meses.map((m, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ ...TD, ...consumoStyle(m.consumoTotal || 0, totalCs), fontWeight: 700 }}>
                    {formatKwh(m.consumoTotal)}
                  </td>
                  <td style={{ ...TD, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {m.fechaInicio ? formatDate(m.fechaInicio) : '-'}
                  </td>
                  <td style={{ ...TD, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {m.fechaFin ? formatDate(m.fechaFin) : '-'}
                  </td>
                  {PERIODS.map(p => {
                    const v = m.consumo?.[p] || 0
                    return (
                      <td key={p} style={{ ...TD, ...consumoStyle(v, periodCs) }}>
                        {formatKwh(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr style={{ borderTop: '2px solid #888', background: '#F2F2F2' }}>
                <td style={{ ...TD, fontWeight: 700 }}>{formatKwh(study.consumoTotal)}</td>
                <td colSpan={2} style={{ ...TD, textAlign: 'center', fontWeight: 700, letterSpacing: '0.05em' }}>TOTAL</td>
                {PERIODS.map(p => {
                  const v = study.consumoPorPeriodo?.[p] || 0
                  return (
                    <td key={p} style={{ ...TD, ...consumoStyle(v, periodCs), fontWeight: 700 }}>
                      {formatKwh(v)}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          </table>

          {/* ═══ TABLE 2: MAXÍMETROS (right, side by side) ═══ */}
          {hasPotencia && (
            <div style={{ flexShrink: 0 }}>
              <table className="text-[10px] border-collapse">
                <thead>
                  <tr>
                    <th colSpan={6} style={{ ...SHDR, background: '#1A4A7A' }}>📊 MAXÍMETROS (kW)</th>
                  </tr>
                  <tr>
                    {PERIODS.map(p => <th key={p} style={{ ...HDR, minWidth: 56 }}>{p}</th>)}
                  </tr>

                  {/* Potencia Contratada row */}
                  <tr>
                    {PERIODS.map(p => (
                      <td key={p} style={{ ...TD, background: '#EBF5FB', fontWeight: 700, color: '#1565C0', textAlign: 'center' }}>
                        {pc[p] ? formatKw(pc[p]) : '-'}
                      </td>
                    ))}
                  </tr>

                  {/* Max summary row */}
                  <tr>
                    {PERIODS.map(p => (
                      <td key={p} style={{ ...TD, ...maxCellStyle(study.maxPotencia[p], pc[p], outOfRangeSet.has(p)), fontWeight: 700 }}>
                        {study.maxPotencia[p] > 0 ? formatKw(study.maxPotencia[p]) : '-'}
                      </td>
                    ))}
                  </tr>

                  {/* Adjustment warning */}
                  <tr>
                    <td colSpan={6} style={{ ...TD, background: adjBg, color: adjColor, fontWeight: 700, textAlign: 'center', fontSize: '8px' }}>
                      {adjText}
                    </td>
                  </tr>
                </thead>

                <tbody>
                  {meses.map((m, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                      {PERIODS.map(p => {
                        const val = m.maximetro?.[p] || 0
                        return (
                          <td key={p} style={{ ...TD, ...maxCellStyle(val, pc[p], outOfRangeSet.has(p)) }}>
                            {val > 0 ? formatKw(val) : '-'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr style={{ borderTop: '2px solid #888', background: '#F2F2F2' }}>
                    {PERIODS.map(p => (
                      <td key={p} style={{ ...TD, ...maxCellStyle(study.maxPotencia[p], pc[p], outOfRangeSet.has(p)), fontWeight: 700 }}>
                        {study.maxPotencia[p] > 0 ? formatKw(study.maxPotencia[p]) : '-'}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>

              {/* Leyenda */}
              <div className="flex items-center gap-3 text-[8px] text-gray-600 mt-1.5 px-0.5">
                <div className="flex items-center gap-1">
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#6BA3D6', borderRadius: 2 }}></span>
                  Sin dato
                </div>
                <div className="flex items-center gap-1">
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#F8C4C4', borderRadius: 2 }}></span>
                  Dentro de rango (±15%)
                </div>
                <div className="flex items-center gap-1">
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#F8696B', borderRadius: 2 }}></span>
                  Fuera de rango (±15% pot. contratada)
                </div>
              </div>
            </div>
          )}

        </div>{/* end flex */}

        {/* ── Reactiva section ── */}
        {study.hasRelevantReactiva && study.reactivaPorPeriodo && (
          <div className="mt-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />
              <p className="text-[10px] font-bold text-orange-700">
                Energía Reactiva — Penalización detectada. Algún periodo supera 1.000 kvarh.
              </p>
            </div>
            <table className="text-[10px] border-collapse w-full">
              <thead>
                <tr>
                  <th style={{ ...HDR, background: '#C55A11' }}>Fecha Inicio</th>
                  <th style={{ ...HDR, background: '#C55A11' }}>Fecha Fin</th>
                  {PERIODS.map(p => (
                    <th key={p} style={{ ...HDR, background: '#C55A11' }}>Reactiva {p}</th>
                  ))}
                  <th style={{ ...HDR, background: '#C55A11' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {meses.map((m, i) => {
                  const rv = (m.reactiva || {}) as Record<string, number>
                  const rowTotal = PERIODS.reduce((s, p) => s + (rv[p] || 0), 0)
                  const hasPen = PERIODS.some(p => (rv[p] || 0) > 1000)
                  return (
                    <tr key={i} style={{ background: hasPen ? '#FEF3E2' : i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ ...TD, textAlign: 'center' }}>{m.fechaInicio ? formatDate(m.fechaInicio) : '-'}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>{m.fechaFin ? formatDate(m.fechaFin) : '-'}</td>
                      {PERIODS.map(p => {
                        const v = rv[p] || 0
                        return (
                          <td key={p} style={{ ...TD, color: v > 1000 ? '#C00000' : 'inherit', fontWeight: v > 1000 ? 700 : 400 }}>
                            {v > 0 ? v.toLocaleString('es-ES') : '-'}
                          </td>
                        )
                      })}
                      <td style={{ ...TD, fontWeight: hasPen ? 700 : 400, color: hasPen ? '#C00000' : 'inherit' }}>
                        {rowTotal > 0 ? rowTotal.toLocaleString('es-ES') : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#FEF3E2', fontWeight: 700 }}>
                  <td colSpan={2} style={{ ...TD, textAlign: 'center' }}>TOTAL</td>
                  {PERIODS.map(p => (
                    <td key={p} style={TD}>
                      {((study.reactivaPorPeriodo![p as keyof typeof study.reactivaPorPeriodo] as number) || 0).toLocaleString('es-ES')}
                    </td>
                  ))}
                  <td style={TD}>
                    {PERIODS.reduce((s, p) => s + ((study.reactivaPorPeriodo![p as keyof typeof study.reactivaPorPeriodo] as number) || 0), 0).toLocaleString('es-ES')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ── Bar chart ── */}
        {meses.length > 0 && <BarChart meses={meses} />}

        {error && (
          <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />{error}
          </p>
        )}
      </div>
    </div>
  )
}
