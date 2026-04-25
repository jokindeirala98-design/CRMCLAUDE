'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, FileText, Zap, TrendingUp, CheckCircle2,
  RefreshCw, Loader2, AlertCircle, Download, Euro,
  DollarSign, Activity, X, Trash2, Flame,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConsumoItem {
  periodo: string
  kwh: number
  precioKwh: number
  total: number
}
export interface PotenciaItem {
  periodo: string
  kw: number
  precioKwDia: number
  dias: number
  total: number
}
export interface OtroConcepto {
  concepto: string
  total: number
}
export interface GasPricing {
  precioKwh?: number
  precioKwhEstimated?: boolean
  terminoFijoDiario?: number
  diasFacturados?: number
  terminoFijoTotal?: number
  impuestoHidrocarbTotal?: number
  alquilerTotal?: number
  ivaPorcentaje?: number
  ivaTotal?: number
  descuentoTerminoFijo?: number
  descuentoOtros?: number
}
export interface BillEconomics {
  fechaInicio?: string
  fechaFin?: string
  titular?: string
  holder_cif_nif?: string
  supply_address?: string
  comercializadora?: string
  cups?: string
  tarifa?: string
  supply_type?: 'luz' | 'gas'
  consumo?: ConsumoItem[]
  potencia?: PotenciaItem[]
  otrosConceptos?: OtroConcepto[]
  consumoTotalKwh?: number
  costeBrutoConsumo?: number
  descuentoEnergia?: number
  costeNetoConsumo?: number
  costeTotalConsumo?: number
  costeMedioKwh?: number
  costeMedioKwhNeto?: number
  costeTotalPotencia?: number
  totalFactura?: number
  // Gas-specific
  gasPricing?: GasPricing
}
export interface InvoiceRow {
  id: string
  file_url?: string
  period_start?: string
  period_end?: string
  total_amount?: number
  extraction_status?: string
  extracted_data?: {
    economics?: BillEconomics
    billing_period?: string
    comercializadora?: string
    cups?: string
    tariff?: string
    total_amount?: string
    mode?: string
    holder_name?: string
    holder_cif_nif?: string
    supply_address?: string
    [key: string]: unknown
  } | null
}

interface Props {
  invoices: InvoiceRow[]
  supplyId: string
  onInvoicesUpdated: () => void
  /** Authoritative supply type from the supply record (overrides invoice extracted_data) */
  supplyType?: 'luz' | 'gas' | 'telefonia' | string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
const PERIOD_COLORS: Record<string, string> = {
  P1: '#A8B5C9', P2: '#E8B89A', P3: '#A8C0A0',
  P4: '#E8D1A0', P5: '#B8A8C5', P6: '#6B8068',
}

/** Returns true for 2.0TD tariffs (doméstico, only P1+P2) */
function is2TDTariff(tarifa?: string | null): boolean {
  if (!tarifa) return false
  const t = tarifa.trim().toUpperCase().replace(/\s+/g, '')
  return t.startsWith('2.0') || t === '2.0TD' || t === '20TD'
}

/** Returns active periods based on tariff — P1+P2 only for 2.0TD, P1–P6 otherwise */
function getActivePeriods(tarifa?: string | null): string[] {
  return is2TDTariff(tarifa) ? ['P1', 'P2'] : PERIODS
}
const CANONICAL_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const CANONICAL_MONTHS_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// ─── Format Helpers ──────────────────────────────────────────────────────────

const fmt = (n?: number | null, d = 2) =>
  n !== undefined && n !== null
    ? n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '—'

const fmtDate = (d?: string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toISOString().slice(0, 10)
}

// ─── Date Helpers (from standalone) ──────────────────────────────────────────

function parseSpanishDate(d?: string): Date | null {
  if (!d) return null
  if (d.includes('-')) {
    const ds = new Date(d)
    return isNaN(ds.getTime()) ? null : ds
  }
  if (d.includes('/')) {
    const parts = d.split('/')
    if (parts.length < 3) return null
    const [day, month, year] = parts.map(Number)
    const ds = new Date(year, month - 1, day)
    return isNaN(ds.getTime()) ? null : ds
  }
  const ds = new Date(d)
  return isNaN(ds.getTime()) ? null : ds
}

function getAssignedMonth(startStr?: string, endStr?: string): { month: number; year: number } {
  const start = parseSpanishDate(startStr)
  const end = parseSpanishDate(endStr)
  if (!start || !end) return { month: 0, year: 0 }

  const counts: Record<string, number> = {}
  const current = new Date(start)
  while (current <= end) {
    const key = `${current.getFullYear()}-${current.getMonth()}`
    counts[key] = (counts[key] || 0) + 1
    current.setDate(current.getDate() + 1)
  }

  let maxDays = 0
  let winner = { month: start.getMonth(), year: start.getFullYear() }
  Object.keys(counts).sort().forEach(key => {
    if (counts[key] > maxDays) {
      maxDays = counts[key]
      const [y, m] = key.split('-').map(Number)
      winner = { month: m, year: y }
    }
  })
  return winner
}

function getMonthYear(dateStr?: string): string {
  if (!dateStr) return 'S/D'
  const date = parseSpanishDate(dateStr)
  if (!date) return 'S/D'
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase()
}

// ─── ROBUST data extractor: gets economics from an invoice regardless of structure ──

function getEco(inv: InvoiceRow): BillEconomics | null {
  const ed = inv.extracted_data
  if (!ed) return null

  // Primary path: economics nested object — enrich with top-level fields if missing
  if (ed.economics && typeof ed.economics === 'object') {
    const eco: BillEconomics = { ...ed.economics }
    if (!eco.cups && ed.cups) eco.cups = ed.cups as string
    if (!eco.tarifa && ed.tariff) eco.tarifa = ed.tariff as string
    if (!eco.titular && ed.holder_name) eco.titular = ed.holder_name as string
    if (!eco.comercializadora && ed.comercializadora) eco.comercializadora = ed.comercializadora as string
    if (!eco.holder_cif_nif && ed.holder_cif_nif) eco.holder_cif_nif = ed.holder_cif_nif as string
    if (!eco.supply_address && ed.supply_address) eco.supply_address = ed.supply_address as string
    if (!eco.supply_type && ed.supply_type) eco.supply_type = ed.supply_type as 'luz' | 'gas'
    return eco
  }

  // Fallback: try to build economics from top-level extracted_data fields
  // This handles cases where Gemini returned flat data or economics wasn't nested
  const fallback: BillEconomics = {}
  let hasAnyData = false

  if (ed.billing_period && typeof ed.billing_period === 'string') {
    const parts = (ed.billing_period as string).split('-')
    if (parts.length === 2) {
      fallback.fechaInicio = parts[0].trim()
      fallback.fechaFin = parts[1].trim()
    }
  }
  if (!fallback.fechaInicio && inv.period_start) fallback.fechaInicio = inv.period_start
  if (!fallback.fechaFin && inv.period_end) fallback.fechaFin = inv.period_end

  if (ed.comercializadora) { fallback.comercializadora = ed.comercializadora as string; hasAnyData = true }
  if (ed.cups) { fallback.cups = ed.cups as string; hasAnyData = true }
  if (ed.tariff) { fallback.tarifa = ed.tariff as string; hasAnyData = true }
  if (ed.holder_name) { fallback.titular = ed.holder_name as string; hasAnyData = true }
  if (ed.holder_cif_nif) { fallback.holder_cif_nif = ed.holder_cif_nif as string; hasAnyData = true }
  if (ed.supply_address) { fallback.supply_address = ed.supply_address as string; hasAnyData = true }
  if (ed.total_amount) {
    const parsed = typeof ed.total_amount === 'string' ? parseFloat(ed.total_amount.replace(',', '.')) : Number(ed.total_amount)
    if (!isNaN(parsed)) { fallback.totalFactura = parsed; hasAnyData = true }
  }
  if (inv.total_amount && !fallback.totalFactura) { fallback.totalFactura = inv.total_amount; hasAnyData = true }

  // Check for any economics-like fields at the top level of extracted_data
  const edAny = ed as Record<string, unknown>
  if (typeof edAny.consumoTotalKwh === 'number') { fallback.consumoTotalKwh = edAny.consumoTotalKwh as number; hasAnyData = true }
  if (typeof edAny.costeTotalConsumo === 'number') { fallback.costeTotalConsumo = edAny.costeTotalConsumo as number; hasAnyData = true }
  if (typeof edAny.costeTotalPotencia === 'number') { fallback.costeTotalPotencia = edAny.costeTotalPotencia as number; hasAnyData = true }
  if (typeof edAny.costeMedioKwh === 'number') { fallback.costeMedioKwh = edAny.costeMedioKwh as number; hasAnyData = true }
  if (Array.isArray(edAny.consumo)) { fallback.consumo = edAny.consumo as ConsumoItem[]; hasAnyData = true }
  if (Array.isArray(edAny.potencia)) { fallback.potencia = edAny.potencia as PotenciaItem[]; hasAnyData = true }
  if (Array.isArray(edAny.otrosConceptos)) { fallback.otrosConceptos = edAny.otrosConceptos as OtroConcepto[]; hasAnyData = true }

  return hasAnyData ? fallback : null
}

/** Does this invoice have usable data (economics or at least total_amount)? */
function hasUsableData(inv: InvoiceRow): boolean {
  return getEco(inv) !== null
}

/**
 * Detect if this is a gas supply.
 * Uses the authoritative supply-level type when available (avoids false positives
 * from mis-classified invoice pages).  Falls back to invoice-based heuristics.
 */
function isGasSupply(invoices: InvoiceRow[], authoritativeType?: string): boolean {
  // Supply-record type is the ground truth — trust it above everything else
  if (authoritativeType === 'luz' || authoritativeType === 'telefonia') return false
  if (authoritativeType === 'gas') return true

  // Fall back to invoice-level indicators only when no supply type available
  for (const inv of invoices) {
    const eco = getEco(inv)
    const tariff = eco?.tarifa || inv.extracted_data?.tariff || ''
    // RL tariff = definitively gas access tariff
    if (/^RL/i.test(String(tariff).replace(/\s+/g, ''))) return true
    // gasPricing structure present in economics = gas
    if (eco?.gasPricing) return true
    // supply_type=gas in extracted_data — only trust when no electricity tariff present
    const invoiceType = eco?.supply_type || inv.extracted_data?.supply_type
    if (invoiceType === 'gas' && !/^[236]\./i.test(String(tariff))) return true
  }
  return false
}

/** Get start/end dates for an invoice, checking all possible sources */
function getInvoiceDates(inv: InvoiceRow): { start?: string; end?: string } {
  const eco = getEco(inv)
  return {
    start: eco?.fechaInicio || inv.period_start || undefined,
    end: eco?.fechaFin || inv.period_end || undefined,
  }
}

// ─── Excess Detection ────────────────────────────────────────────────────────

function isPowerExcessConcept(concepto: string): boolean {
  const lower = concepto.toLowerCase()
  const excessIndicators = ['exceso', 'penalizacion', 'penalización', 'recargo']
  const powerIndicators = ['potencia', 'kw', 'pot']
  const combinedPatterns = [
    { excess: 'demanda', power: 'potencia' },
    { excess: 'maximetro', power: 'kw' },
  ]
  const hasExcess = excessIndicators.some(ind => lower.includes(ind))
  const hasPower = powerIndicators.some(ind => lower.includes(ind))
  if (hasExcess && hasPower) return true
  for (const pattern of combinedPatterns) {
    if (lower.includes(pattern.excess) && lower.includes(pattern.power)) return true
  }
  return false
}

function getExcessAmountFromEco(eco: BillEconomics): { totalExcess: number; concepts: OtroConcepto[] } {
  if (!eco.otrosConceptos || eco.otrosConceptos.length === 0) {
    return { totalExcess: 0, concepts: [] }
  }
  const excessConcepts = eco.otrosConceptos.filter(oc => isPowerExcessConcept(oc.concepto))
  const totalExcess = excessConcepts.reduce((sum, oc) => sum + (oc.total || 0), 0)
  return { totalExcess, concepts: excessConcepts }
}

// ─── Monthly Aggregation ─────────────────────────────────────────────────────

interface MonthlyAggregatedData {
  monthIndex: number
  label: string
  labelFull: string
  totalFactura: number
  energia: number
  potencia: number
  otros: number
  totalKwh: number
  billsCount: number
}

function getMonthlyAggregatedData(invoices: InvoiceRow[]): MonthlyAggregatedData[] {
  const monthlyTotals: MonthlyAggregatedData[] = CANONICAL_MONTHS.map((label, i) => ({
    monthIndex: i,
    label,
    labelFull: CANONICAL_MONTHS_FULL[i],
    totalFactura: 0,
    energia: 0,
    potencia: 0,
    otros: 0,
    totalKwh: 0,
    billsCount: 0,
  }))

  invoices.forEach(inv => {
    const eco = getEco(inv)
    if (!eco) return
    const { start, end } = getInvoiceDates(inv)
    const { month } = getAssignedMonth(start, end)
    if (month < 0 || month > 11) return

    const energia = eco.costeTotalConsumo || 0
    const potencia = eco.costeTotalPotencia || 0
    const totalKwh = eco.consumoTotalKwh || 0

    let imp = 0, others = 0
    ;(eco.otrosConceptos || []).forEach(oc => {
      if (oc.concepto?.toLowerCase().includes('impuesto') || oc.concepto?.toLowerCase().includes('iva')) {
        imp += oc.total
      } else {
        others += oc.total
      }
    })

    const totalF = eco.totalFactura || (energia + potencia + imp + others) || inv.total_amount || 0

    monthlyTotals[month].totalFactura += totalF
    monthlyTotals[month].energia += energia
    monthlyTotals[month].potencia += potencia
    monthlyTotals[month].otros += (imp + others)
    monthlyTotals[month].totalKwh += totalKwh
    monthlyTotals[month].billsCount += 1
  })

  return monthlyTotals
}

// ─── Otros conceptos helpers ─────────────────────────────────────────────────

function normalizeOtros(otrosConceptos?: OtroConcepto[]) {
  if (!otrosConceptos?.length) return {}
  const map: Record<string, number> = {}
  for (const o of otrosConceptos) {
    const k = o.concepto.toLowerCase()
    map[k] = (map[k] || 0) + (o.total || 0)
  }
  return map
}

function getOtro(map: Record<string, number>, key: string): number | null {
  for (const k of Object.keys(map)) {
    if (k.includes(key.toLowerCase())) return map[k]
  }
  return null
}

// ─── Mascot Component with PNG fallback ──────────────────────────────────────

function Mascot({ className }: { className?: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  if (!imgFailed) {
    return (
      <img
        src="/mascota-transparente.png"
        alt="Voltis Mascot"
        className={className}
        onError={() => setImgFailed(true)}
      />
    )
  }
  return (
    <svg viewBox="0 0 120 140" className={className}>
      <circle cx="60" cy="42" r="30" fill="#93c5fd" opacity="0.7" />
      <ellipse cx="60" cy="42" rx="22" ry="26" fill="#bfdbfe" />
      <rect x="44" y="68" width="32" height="30" rx="8" fill="#3b82f6" />
      <rect x="36" y="88" width="14" height="20" rx="4" fill="#3b82f6" />
      <rect x="70" y="88" width="14" height="20" rx="4" fill="#3b82f6" />
      <ellipse cx="60" cy="100" rx="16" ry="8" fill="#2563eb" />
      <circle cx="52" cy="40" r="5" fill="#1e3a8a" />
      <circle cx="68" cy="40" r="5" fill="#1e3a8a" />
      <path d="M 52 52 Q 60 58 68 52" stroke="#1e3a8a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <line x1="46" y1="18" x2="42" y2="8" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="12" x2="60" y2="2" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
      <line x1="74" y1="18" x2="78" y2="8" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ─── GlowOrb ─────────────────────────────────────────────────────────────────

function GlowOrb({ className = '', size = 'lg' }: { className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return null
}

// ─── CountUp Animation ───────────────────────────────────────────────────────

function CountUp({ value, duration = 1.2, decimals = 0 }: { value: number; duration?: number; decimals?: number }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(0)
    const end = value
    if (!end) return
    let startTime: number | null = null
    let frameId: number
    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime
      const progress = Math.min((currentTime - startTime) / (duration * 1000), 1)
      const easeProgress = 1 - Math.pow(1 - progress, 3)
      setCount(easeProgress * end)
      if (progress < 1) frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [value, duration])
  return (
    <span>
      {count.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  )
}

// ─── SVG Line Chart (12 canonical months, totalFactura €) — matches standalone ──

function SVGLineChart({ data }: { data: MonthlyAggregatedData[] }) {
  const monthsWithData = data.filter(d => d.billsCount > 0)
  const max = Math.max(...data.map(d => d.totalFactura), 1)
  const W = 760, H = 250, PAD_L = 55, PAD_R = 20, PAD_T = 20, PAD_B = 30
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B

  // Y-axis nice ticks
  const tickCount = 4
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round(max * i / tickCount))

  const points = data.map((d, i) => {
    const x = PAD_L + (i / 11) * plotW
    const y = PAD_T + plotH - (d.totalFactura / max) * plotH
    return { x, y, ...d }
  })

  const linePath = points
    .filter(p => p.billsCount > 0)
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {ticks.map((tick, i) => {
        const y = PAD_T + plotH - (tick / max) * plotH
        return (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="rgba(45,58,51,0.08)" strokeWidth="1" />
            <text x={PAD_L - 8} y={y + 4} fill="#8A9A8E" fontSize="10" textAnchor="end">
              {tick > 0 ? tick.toLocaleString('es-ES') : '0'}
            </text>
          </g>
        )
      })}

      {/* X-axis labels */}
      {data.map((d, i) => {
        const x = PAD_L + (i / 11) * plotW
        return (
          <text key={i} x={x} y={H - 4} fill={d.billsCount > 0 ? '#5A6B5F' : '#8A9A8E'}
            fontSize="10" textAnchor="middle">{d.label}</text>
        )
      })}

      {/* Line */}
      {linePath && <path d={linePath} fill="none" stroke="#6B8068" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}

      {/* Dots */}
      {points.filter(p => p.billsCount > 0).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="#6B8068" stroke="#FBF7EE" strokeWidth="2" />
      ))}
    </svg>
  )
}

// ─── SVG Bar Chart (kept for backwards compat) ─────────────────────────────

function SVGBarChart({ data }: { data: MonthlyAggregatedData[] }) {
  const max = Math.max(...data.map(d => d.totalFactura), 1)
  const W = 760, H = 220, PAD = 40
  const barCount = 12
  const BAR_W = Math.min(40, (W - PAD * 2) / barCount - 6)
  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6B8068" />
          <stop offset="100%" stopColor="#A8C0A0" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
        <g key={i}>
          <line x1={PAD} x2={W - PAD} y1={H - t * (H - PAD)} y2={H - t * (H - PAD)}
            stroke="rgba(45,58,51,0.08)" strokeWidth="1" />
          <text x={PAD - 6} y={H - t * (H - PAD) + 4}
            fill="#8A9A8E" fontSize="9" textAnchor="end">
            {t === 0 ? '0' : `${(max * t).toLocaleString('es-ES', { maximumFractionDigits: 0 })}€`}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = PAD + i * ((W - PAD * 2) / barCount) + ((W - PAD * 2) / barCount - BAR_W) / 2
        const barH = d.totalFactura > 0 ? Math.max(2, (d.totalFactura / max) * (H - PAD)) : 0
        const y = H - barH
        const hasData = d.billsCount > 0
        return (
          <g key={i}>
            <rect x={x} y={y} width={BAR_W} height={barH || 2}
              fill="url(#barGrad)" rx="3"
              opacity={hasData ? 1 : 0.15} />
            <text x={x + BAR_W / 2} y={H + 16}
              fill={hasData ? '#5A6B5F' : '#8A9A8E'}
              fontSize="9" textAnchor="middle" fontWeight={hasData ? '600' : '400'}>
              {d.label}
            </text>
            {hasData && d.totalFactura > 0 && (
              <text x={x + BAR_W / 2} y={y - 6}
                fill="#5A6B5F" fontSize="8" textAnchor="middle">
                {d.totalFactura.toLocaleString('es-ES', { maximumFractionDigits: 0 })}€
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── SVG Donut Chart ─────────────────────────────────────────────────────────

function DonutChart({ segments, total }: {
  segments: { label: string; value: number; color: string }[]
  total: number
}) {
  const r = 80, cx = 110, cy = 110, strokeW = 22
  const circumference = 2 * Math.PI * r
  let offset = 0
  const totalVal = segments.reduce((s, seg) => s + seg.value, 0) || 1
  return (
    <svg viewBox="0 0 220 220" className="w-48 h-48">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(45,58,51,0.06)" strokeWidth={strokeW} />
      {segments.map((seg, i) => {
        const pct = seg.value / totalVal
        const dash = pct * circumference
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={seg.color} strokeWidth={strokeW}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset * circumference}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`} />
        )
        offset += pct
        return el
      })}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#2D3A33" fontSize="18" fontWeight="bold">
        {total >= 1000 ? `${(total / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}k€` : `${Math.round(total)}€`}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#8A9A8E" fontSize="9">
        TOTAL FACTURADO
      </text>
    </svg>
  )
}

// ─── Re-extract banner (FIXED: correct API params + Supabase update) ─────────

function ReExtractBanner({ invoices, onDone }: { invoices: InvoiceRow[]; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reExtract = async (inv: InvoiceRow) => {
    if (!inv.file_url) return
    setBusy(inv.id)
    setError(null)
    try {
      // 1. Download file from Supabase Storage
      const fileRes = await fetch(inv.file_url)
      if (!fileRes.ok) throw new Error(`Error descargando archivo: ${fileRes.status}`)
      const blob = await fileRes.blob()

      // 2. Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1])
        }
        reader.onerror = () => reject(new Error('Error leyendo archivo'))
        reader.readAsDataURL(blob)
      })

      // 3. Determine file type
      const fileName = inv.file_url.split('/').pop() || 'invoice'
      const fileType = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'

      // 4. Send to API with correct parameters
      const analyzeRes = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_base64: base64, file_type: fileType, file_name: fileName }),
      })
      if (!analyzeRes.ok) throw new Error(`Error analizando: ${analyzeRes.status}`)
      const extractedData = await analyzeRes.json()

      // 5. Update invoice in Supabase
      const supabase = createClient()
      const economics = extractedData.economics
      const updateData: Record<string, unknown> = {
        extracted_data: extractedData,
        extraction_status: 'completed',
      }
      if (economics?.fechaInicio) updateData.period_start = economics.fechaInicio
      if (economics?.fechaFin) updateData.period_end = economics.fechaFin
      if (economics?.totalFactura) updateData.total_amount = economics.totalFactura
      else if (extractedData.total_amount) {
        const parsed = parseFloat(String(extractedData.total_amount).replace(',', '.'))
        if (!isNaN(parsed)) updateData.total_amount = parsed
      }

      const { error: dbError } = await supabase.from('invoices').update(updateData).eq('id', inv.id)
      if (dbError) throw new Error(`Error guardando: ${dbError.message}`)

      onDone()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      console.error('Re-extraction error:', msg)
      setError(msg)
    } finally {
      setBusy(null)
    }
  }

  const reExtractAll = async () => {
    for (const inv of invoices) {
      await reExtract(inv)
    }
  }

  return (
    <div className="mx-4 mb-4 rounded-xl border border-warn/30/30 bg-warn-container/400/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-warn" />
          <span className="text-warn text-sm font-medium">
            {invoices.length} factura{invoices.length !== 1 ? 's' : ''} sin datos económicos
          </span>
        </div>
        {invoices.length > 1 && (
          <button
            onClick={reExtractAll}
            disabled={busy !== null}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-warn-container/400/20 hover:bg-warn-container/400/30 text-warn text-xs font-bold transition disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" />
            Re-extraer todas
          </button>
        )}
      </div>
      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-err-container/400/10 border border-err/30/20 text-err text-xs">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {invoices.map(inv => (
          <div key={inv.id} className="flex items-center justify-between text-xs text-[#5A6B5F]">
            <span className="truncate max-w-[200px]">
              {inv.file_url?.split('/').pop() || inv.id.slice(0, 8)}
            </span>
            <button
              onClick={() => reExtract(inv)}
              disabled={busy === inv.id}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-warn-container/400/20 hover:bg-warn-container/400/30 text-warn transition disabled:opacity-50"
            >
              {busy === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Re-extraer
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── FileTable View ──────────────────────────────────────────────────────────

function FileTable({ invoices, onRescan, onDelete, busyRescan, busyDelete, authoritativeType }: {
  invoices: InvoiceRow[]
  onRescan?: (inv: InvoiceRow) => void
  onDelete?: (inv: InvoiceRow) => void
  busyRescan?: string | null
  busyDelete?: string | null
  authoritativeType?: string
}) {
  type RowDef = {
    key: string
    label: string
    render: (eco: BillEconomics | null, inv: InvoiceRow) => React.ReactNode
    isSectionHeader?: boolean
    isSeparator?: boolean
    isHighlight?: boolean
    isTotal?: boolean
    indent?: boolean
  }

  const isGas = isGasSupply(invoices, authoritativeType)

  // Detect active periods — 2.0TD only uses P1+P2
  const tarifa = invoices.find(inv => getEco(inv)?.tarifa || inv.extracted_data?.tariff)
    ?.extracted_data?.tariff as string | undefined
    || invoices.find(inv => getEco(inv)?.tarifa)
    ? getEco(invoices.find(inv => getEco(inv)?.tarifa)!)?.tarifa
    : undefined
  const activePeriods = getActivePeriods(tarifa)

  // ── Common header rows (both luz & gas) ──
  const headerRows: RowDef[] = [
    {
      key: 'compania', label: 'COMPAÑÍA',
      render: (eco, inv) => <span className="text-[#4F5C53] text-sm">{eco?.comercializadora || inv.extracted_data?.comercializadora || '—'}</span>,
    },
    {
      key: 'titular', label: 'TITULAR',
      render: (eco) => <span className="text-[#4F5C53] text-sm">{eco?.titular || '—'}</span>,
    },
    {
      key: 'nifCif', label: 'NIF / CIF',
      render: (eco, inv) => <span className="text-[#4F5C53] text-sm font-mono">{eco?.holder_cif_nif || (inv.extracted_data?.holder_cif_nif as string) || '—'}</span>,
    },
    {
      key: 'cups', label: 'CUPS',
      render: (eco, inv) => <span className="text-[#4F5C53] text-xs font-mono">{eco?.cups || inv.extracted_data?.cups || '—'}</span>,
    },
    {
      key: 'supplyAddress', label: 'DIRECCIÓN SUMINISTRO',
      render: (eco, inv) => <span className="text-[#4F5C53] text-xs">{eco?.supply_address || (inv.extracted_data?.supply_address as string) || '—'}</span>,
    },
    {
      key: 'tarifa', label: 'TARIFA',
      render: (eco, inv) => <span className="text-[#4F5C53] text-sm">{eco?.tarifa || inv.extracted_data?.tariff || '—'}</span>,
    },
    {
      key: 'fechaInicio', label: 'FECHA INICIO',
      render: (eco, inv) => <span className="text-[#4F5C53] text-sm">{fmtDate(eco?.fechaInicio || inv.period_start)}</span>,
    },
    {
      key: 'fechaFin', label: 'FECHA FIN',
      render: (eco, inv) => <span className="text-[#4F5C53] text-sm">{fmtDate(eco?.fechaFin || inv.period_end)}</span>,
    },
    {
      key: 'mes', label: 'MES LIQUIDACIÓN',
      isHighlight: true,
      render: (eco, inv) => {
        const { start, end } = getInvoiceDates(inv)
        const { month, year } = getAssignedMonth(start, end)
        const label = year > 0 ? `${CANONICAL_MONTHS_FULL[month]?.toUpperCase() || '—'} ${year}` : '—'
        return <span className={`${isGas ? 'text-warn' : 'text-[#6B8068]'} font-bold text-sm tracking-wide`}>{label}</span>
      },
    },
    { key: 'sep1', label: '', isSeparator: true, render: () => null },
  ]

  // ── GAS-specific rows ──
  const gasRows: RowDef[] = [
    {
      key: 'consumoKwh', label: 'CONSUMO (KWH)',
      isSectionHeader: true,
      render: (eco) => <span className="text-[#2D3A33] font-bold text-sm">{fmt(eco?.consumoTotalKwh, 0)}</span>,
    },
    {
      key: 'costeBrutoConsumo', label: 'COSTE BRUTO ENERGÍA (€)',
      render: (eco) => <span className="text-[#4F5C53] text-sm">{fmt(eco?.costeBrutoConsumo)}</span>,
    },
    {
      key: 'descuentoEnergia', label: 'DESCUENTO ENERGÍA (€)',
      render: (eco) => {
        const v = eco?.descuentoEnergia
        return <span className="text-ok/80 text-sm">{v && v > 0 ? `-${fmt(v)}` : '—'}</span>
      },
    },
    {
      key: 'costeNetoConsumo', label: 'COSTE NETO ENERGÍA (€)',
      isHighlight: true,
      render: (eco) => <span className="text-warn font-bold text-sm">{fmt(eco?.costeNetoConsumo)}</span>,
    },
    {
      key: 'precioKwh', label: '€/KWH',
      render: (eco) => {
        const gp = eco?.gasPricing
        const precio = eco?.costeMedioKwhNeto || eco?.costeMedioKwh || (gp?.precioKwh)
        const estimated = gp?.precioKwhEstimated
        return (
          <div>
            <span className={`text-sm ${estimated ? 'text-yellow-400' : 'text-white/70'}`}>{precio ? fmt(precio, 4) : '—'}</span>
            {estimated && <span className="block text-[9px] text-yellow-500/60">estimado</span>}
          </div>
        )
      },
    },
    { key: 'sep_gas1', label: '', isSeparator: true, render: () => null },
    {
      key: 'terminoFijo', label: 'TÉRMINO FIJO (€)',
      isSectionHeader: true,
      render: (eco) => <span className="text-white font-bold text-sm">{fmt(eco?.gasPricing?.terminoFijoTotal)}</span>,
    },
    {
      key: 'terminoFijoDiario', label: 'CUOTA DIARIA (€/DÍA)',
      indent: true,
      render: (eco) => {
        const gp = eco?.gasPricing
        if (!gp?.terminoFijoDiario) return <span className="text-white/30 text-sm">—</span>
        return <span className="text-white/60 text-sm">{fmt(gp.terminoFijoDiario, 4)} €/día × {gp.diasFacturados || '?'} días</span>
      },
    },
    {
      key: 'descuentoTerminoFijo', label: 'DESCUENTO T. FIJO (€)',
      indent: true,
      render: (eco) => {
        const v = eco?.gasPricing?.descuentoTerminoFijo
        return <span className="text-ok/80 text-sm">{v && v > 0 ? `-${fmt(v)}` : '—'}</span>
      },
    },
    { key: 'sep_gas2', label: '', isSeparator: true, render: () => null },
    {
      key: 'impuestoHidrocarb', label: 'IMPUESTO HIDROCARBUROS (€)',
      render: (eco) => <span className="text-white/70 text-sm">{fmt(eco?.gasPricing?.impuestoHidrocarbTotal)}</span>,
    },
    {
      key: 'alquilerGas', label: 'ALQUILER CONTADOR (€)',
      render: (eco) => <span className="text-white/70 text-sm">{fmt(eco?.gasPricing?.alquilerTotal)}</span>,
    },
    {
      key: 'ivaGas', label: 'IVA (€)',
      render: (eco) => <span className="text-white/70 text-sm">{fmt(eco?.gasPricing?.ivaTotal)}</span>,
    },
    {
      key: 'totalFacturaGas', label: 'TOTAL FACTURA (€)',
      isHighlight: true, isTotal: true,
      render: (eco, inv) => {
        const v = eco?.totalFactura ?? inv.total_amount
        return <span className="text-warn font-bold text-sm">{v ? `${fmt(v)} €` : '—'}</span>
      },
    },
  ]

  // ── Electricity-specific rows ──
  const electricityRows: RowDef[] = [
    {
      key: 'totalConsumoKwh', label: 'TOTAL CONSUMO (KWH)',
      isSectionHeader: true,
      render: (eco) => <span className="text-[#2D3A33] font-bold text-sm">{fmt(eco?.consumoTotalKwh, 0)}</span>,
    },
    ...activePeriods.map(p => ({
      key: `consumo_${p}`,
      label: `CONSUMO ${p}`,
      indent: true,
      render: (eco: BillEconomics | null) => {
        const item = eco?.consumo?.find(c => c.periodo === p)
        if (!item || !item.kwh) return <span className="text-[#8A9A8E] text-sm">—</span>
        return (
          <div>
            <div className="text-[#4F5C53] text-sm">{fmt(item.kwh, 0)} kWh</div>
            <div className="text-[#8A9A8E] text-xs">{fmt(item.precioKwh, 4)} €/KWH</div>
          </div>
        )
      },
    })),
    {
      key: 'totalCosteConsumo', label: 'TOTAL COSTE CONSUMO (€)',
      isTotal: true,
      render: (eco) => <span className="text-[#2D3A33] font-semibold text-sm">{fmt(eco?.costeTotalConsumo)}</span>,
    },
    {
      key: 'costeMedio', label: 'COSTE MEDIO (€/KWH)',
      render: (eco) => {
        const precio = eco?.costeMedioKwh || (eco?.costeTotalConsumo && eco?.consumoTotalKwh ? eco.costeTotalConsumo / eco.consumoTotalKwh : null)
        return <span className="text-[#5A6B5F] text-sm">{precio ? fmt(precio, 4) : '—'}</span>
      },
    },
    { key: 'sep2', label: '', isSeparator: true, render: () => null },
    {
      key: 'totalCostePotencia', label: 'TOTAL COSTE POTENCIA (€)',
      isSectionHeader: true,
      render: (eco) => <span className="text-[#2D3A33] font-bold text-sm">{fmt(eco?.costeTotalPotencia)}</span>,
    },
    ...activePeriods.map(p => ({
      key: `potencia_${p}`,
      label: `POTENCIA ${p}`,
      indent: true,
      render: (eco: BillEconomics | null) => {
        const item = eco?.potencia?.find(c => c.periodo === p)
        if (!item || !item.total) return <span className="text-[#8A9A8E] text-sm">—</span>
        return <span className="text-[#5A6B5F] text-sm">{fmt(item.total)} €</span>
      },
    })),
    { key: 'sep3', label: '', isSeparator: true, render: () => null },
    {
      key: 'alquiler', label: 'ALQUILER DE EQUIPOS',
      render: (eco) => { const m = normalizeOtros(eco?.otrosConceptos); const v = getOtro(m, 'alquiler'); return <span className="text-[#5A6B5F] text-sm">{v !== null ? `${fmt(v)} €` : '—'}</span> },
    },
    {
      key: 'bonoSocial', label: 'BONO SOCIAL',
      render: (eco) => { const m = normalizeOtros(eco?.otrosConceptos); const v = getOtro(m, 'bono social'); return <span className="text-[#5A6B5F] text-sm">{v !== null ? `${fmt(v)} €` : '—'}</span> },
    },
    {
      key: 'compensacion', label: 'COMPENSACIÓN EXCEDENTES',
      render: (eco) => { const m = normalizeOtros(eco?.otrosConceptos); const v = getOtro(m, 'compensac'); return <span className="text-[#5A6B5F] text-sm">{v !== null ? `${fmt(v)} €` : '—'}</span> },
    },
    {
      key: 'exceso', label: 'EXCESO DE POTENCIA',
      render: (eco) => { const m = normalizeOtros(eco?.otrosConceptos); const v = getOtro(m, 'exceso'); return <span className="text-[#5A6B5F] text-sm">{v !== null ? `${fmt(v)} €` : '—'}</span> },
    },
    {
      key: 'impuesto', label: 'IMPUESTO ELÉCTRICO',
      render: (eco) => { const m = normalizeOtros(eco?.otrosConceptos); const v = getOtro(m, 'impuesto'); return <span className="text-[#5A6B5F] text-sm">{v !== null ? `${fmt(v)} €` : '—'}</span> },
    },
    {
      key: 'iva', label: 'IVA / IGIC',
      render: (eco) => { const m = normalizeOtros(eco?.otrosConceptos); const v = getOtro(m, 'iva') ?? getOtro(m, 'igic'); return <span className="text-[#5A6B5F] text-sm">{v !== null ? `${fmt(v)} €` : '—'}</span> },
    },
    {
      key: 'totalFactura', label: 'TOTAL FACTURA (€)',
      isHighlight: true, isTotal: true,
      render: (eco, inv) => {
        const v = eco?.totalFactura ?? inv.total_amount
        return <span className="text-[#6B8068] font-bold text-sm">{v ? `${fmt(v)} €` : '—'}</span>
      },
    },
  ]

  const rows: RowDef[] = [...headerRows, ...(isGas ? gasRows : electricityRows)]

  const CONCEPT_COL_W = 240
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left" style={{ minWidth: `${CONCEPT_COL_W + invoices.length * 280}px` }}>
        <thead>
          <tr className="border-b border-[#E5DCC9]">
            <th className={`sticky left-0 z-10 bg-[#F4EEE2] py-3 px-4 text-xs font-bold tracking-widest ${isGas ? 'text-warn' : 'text-[#6B8068]'}`}
              style={{ width: CONCEPT_COL_W, minWidth: CONCEPT_COL_W }}>
              {isGas ? '🔥 GAS NATURAL' : 'CONCEPTO / PERIODO'}
            </th>
            {invoices.map((inv, i) => {
              const fileName = inv.file_url?.split('/').pop() || `FACT ${i + 1}`
              const eco = getEco(inv)
              return (
                <th key={inv.id} className="py-3 px-4 min-w-[260px]" style={{ minWidth: 260 }}>
                  <div className="text-xs text-[#5A6B5F] font-normal mb-1">FACT {i + 1}</div>
                  <div className="text-[#2D3A33] text-xs font-medium truncate max-w-[230px]">{fileName}</div>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {eco ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ok-container/400/20 text-ok text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-ok inline-block" /> Extraído ✓
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warn-container/400/20 text-warn text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-warn inline-block" /> Sin datos
                      </span>
                    )}
                    {onRescan && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRescan(inv) }}
                        disabled={busyRescan === inv.id}
                        title="Re-escanear factura"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-info-container/400/20 hover:bg-info-container/400/30 text-info text-[10px] transition disabled:opacity-50"
                      >
                        {busyRescan === inv.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                        Re-escanear
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(inv) }}
                        disabled={busyDelete === inv.id}
                        title="Eliminar factura"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-err-container/400/20 hover:bg-err-container/400/30 text-err text-[10px] transition disabled:opacity-50"
                      >
                        {busyDelete === inv.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <X className="w-2.5 h-2.5" />}
                        Eliminar
                      </button>
                    )}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.isSeparator) return (
              <tr key={row.key}><td colSpan={invoices.length + 1} className="py-1"><div className="h-px bg-[#E5DCC9] mx-4" /></td></tr>
            )
            return (
              <tr key={row.key} className={['border-b border-[#E5DCC9] transition-colors', row.isHighlight ? (isGas ? 'bg-warn-container/400/5' : 'bg-[#E0E8DC]') : 'hover:bg-[#F4EEE2]'].join(' ')}>
                <td className="sticky left-0 z-10 py-3 px-4"
                  style={{ backgroundColor: row.isHighlight ? (isGas ? 'rgba(232,184,154,0.15)' : 'rgba(107,128,104,0.10)') : '#F4EEE2', width: CONCEPT_COL_W, minWidth: CONCEPT_COL_W }}>
                  {row.isSectionHeader ? (
                    <span className="text-[#2D3A33] text-xs font-bold tracking-wider">{row.label}</span>
                  ) : row.isHighlight ? (
                    <span className={`flex items-center gap-2 ${isGas ? 'text-warn' : 'text-[#6B8068]'} text-xs font-bold tracking-wider`}>{row.label}</span>
                  ) : row.indent ? (
                    <span className="flex items-center gap-2 text-[#8A9A8E] text-xs tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#E5DCC9] flex-shrink-0" />{row.label}
                    </span>
                  ) : (
                    <span className="text-[#8A9A8E] text-xs tracking-wider">{row.label}</span>
                  )}
                </td>
                {invoices.map((inv) => (
                  <td key={inv.id} className="py-3 px-4">{row.render(getEco(inv), inv)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Glassmorphism styles ────────────────────────────────────────────────────

const glassStyle: React.CSSProperties = {
  background: 'rgba(251,247,238,0.95)',
  border: '1px solid #E5DCC9',
  boxShadow: '0 18px 48px -16px rgba(45,58,51,0.12)',
}
const kpiGlassStyle: React.CSSProperties = {
  background: '#FBF7EE',
  border: '1px solid #E5DCC9',
  boxShadow: '0 8px 24px -8px rgba(45,58,51,0.10)',
}

// ─── Generic Audit Matrix Table ──────────────────────────────────────────────

function AuditMatrixTable<T extends { mes: string; periods: Record<string, unknown>; total: unknown }>({
  rows, renderCell, renderTotal, footerRow, onRowClick, activePeriods: periods = PERIODS,
}: {
  rows: T[]
  renderCell: (row: T, period: string) => React.ReactNode
  renderTotal: (row: T) => React.ReactNode
  footerRow?: React.ReactNode
  onRowClick?: (row: T) => void
  activePeriods?: string[]
}) {
  const colCount = periods.length
  return (
    <div className="rounded-2xl overflow-hidden" style={glassStyle}>
      <div className="grid text-xs text-[#8A9A8E] tracking-widest py-3 px-4 border-b border-[#E5DCC9]"
        style={{ gridTemplateColumns: `220px repeat(${colCount}, 1fr) 180px` }}>
        <span>MES</span>
        {periods.map(p => <span key={p}>{p}</span>)}
        <span>TOTAL</span>
      </div>
      {rows.map((row, i) => (
        <div key={i}
          className={`grid items-center py-4 px-4 border-b border-[#E5DCC9]/50 transition ${onRowClick ? 'cursor-pointer hover:bg-[#EDE8DC]' : 'hover:bg-[#F4EEE2]'}`}
          style={{ gridTemplateColumns: `220px repeat(${colCount}, 1fr) 180px` }}
          onClick={onRowClick ? () => onRowClick(row) : undefined}>
          <span className="text-[#2D3A33] font-bold text-sm italic">{row.mes}</span>
          {periods.map(p => <div key={p}>{renderCell(row, p)}</div>)}
          <div>{renderTotal(row)}</div>
        </div>
      ))}
      {footerRow}
    </div>
  )
}

// ─── Gas Report View ────────────────────────────────────────────────────────

function GasReportView({ invoices, supplyName, onBack }: {
  invoices: InvoiceRow[]
  supplyName?: string
  onBack: () => void
}) {
  const validInvoices = useMemo(() => invoices.filter(hasUsableData), [invoices])

  const { tableData, summaryStats, pieData } = useMemo(() => {
    let totalKwh = 0, totalEur = 0, totalEnergyNet = 0
    let totalTerminoFijo = 0, totalImpuesto = 0, totalAlquiler = 0, totalIva = 0
    let adjustedCount = 0

    const tData = validInvoices.map(inv => {
      const eco = getEco(inv)!
      const gp = eco.gasPricing || {} as GasPricing
      const { start, end } = getInvoiceDates(inv)
      const { month, year } = getAssignedMonth(start, end)

      const kwh = eco.consumoTotalKwh || 0
      const eur = eco.totalFactura || inv.total_amount || 0
      const energyNet = eco.costeNetoConsumo || eco.costeTotalConsumo || 0
      const terminoFijo = gp.terminoFijoTotal || 0
      const impuesto = gp.impuestoHidrocarbTotal || 0
      const alquiler = gp.alquilerTotal || 0
      const iva = gp.ivaTotal || 0

      totalKwh += kwh; totalEur += eur; totalEnergyNet += energyNet
      totalTerminoFijo += terminoFijo; totalImpuesto += impuesto
      totalAlquiler += alquiler; totalIva += iva
      if ((eco.descuentoEnergia || 0) > 0) adjustedCount++

      return {
        id: inv.id, monthIndex: month,
        mes: year > 0 ? `${CANONICAL_MONTHS_FULL[month]?.toUpperCase() || '—'} ${year}` : '—',
        tarifa: eco.tarifa || inv.extracted_data?.tariff || '—',
        kwh, costeBruto: eco.costeBrutoConsumo || 0,
        descuentoEnergia: eco.descuentoEnergia || 0,
        costeNeto: energyNet,
        precioKwh: eco.costeMedioKwhNeto || eco.costeMedioKwh || (gp.precioKwh) || (kwh > 0 ? energyNet / kwh : 0),
        precioEstimated: gp.precioKwhEstimated || false,
        terminoFijo, impuesto, alquiler, total: eur,
      }
    }).sort((a, b) => a.monthIndex - b.monthIndex)

    const avgPrice = totalKwh > 0 ? totalEnergyNet / totalKwh : 0
    const tariff = tData[0]?.tarifa || '—'

    const pData = [
      { label: 'Energía Neta', value: totalEnergyNet, color: '#f97316' },
      { label: 'Término Fijo', value: totalTerminoFijo, color: '#fb923c' },
      { label: 'Imp. Hidrocarburo', value: totalImpuesto, color: '#fbbf24' },
      { label: 'Alquiler', value: totalAlquiler, color: '#facc15' },
      { label: 'IVA', value: totalIva, color: '#eab308' },
    ].filter(i => i.value > 0)

    return {
      tableData: tData,
      summaryStats: { totalKwh, totalEur, totalEnergyNet, avgPrice, totalTerminoFijo, totalImpuesto, totalAlquiler, totalIva, adjustedCount, tariff },
      pieData: pData,
    }
  }, [validInvoices])

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto text-[#2D3A33]" style={{ fontFamily: 'Inter, sans-serif', background: '#F4EEE2' }}>
      <button onClick={onBack} title="Volver (ESC)"
        className="fixed top-4 left-4 z-[210] w-11 h-11 rounded-full flex items-center justify-center transition hover:scale-110 hover:bg-white/20"
        style={{ background: 'rgba(251,247,238,0.80)', backdropFilter: 'blur(16px)', border: '1px solid #E5DCC9' }}>
        <ArrowLeft className="w-5 h-5 text-[#2D3A33]" />
      </button>

      <div className="relative z-10 max-w-7xl mx-auto px-8 py-20 space-y-12">
        {/* Title */}
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-warn-container/400/20 text-warn text-xs font-bold tracking-widest mb-4">
            <Flame className="w-4 h-4" /> INFORME DE GAS NATURAL
          </div>
          <h1 className="text-4xl font-black tracking-tight">{supplyName || 'SUMINISTRO'}</h1>
          <p className="text-[#8A9A8E] mt-2 text-sm">{summaryStats.tariff} · {validInvoices.length} facturas analizadas</p>
        </motion.div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: <Flame className="w-7 h-7 text-warn" />, label: 'CONSUMO TOTAL', value: `${summaryStats.totalKwh.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kWh` },
            { icon: <DollarSign className="w-7 h-7 text-warn" />, label: 'COSTE TOTAL', value: `${summaryStats.totalEur.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` },
            { icon: <Activity className="w-7 h-7 text-yellow-500" />, label: 'PRECIO MEDIO', value: `${summaryStats.avgPrice.toLocaleString('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €/kWh` },
            { icon: <TrendingUp className="w-7 h-7 text-warn" />, label: 'FACTURAS CON AJUSTE', value: `${summaryStats.adjustedCount}` },
          ].map((kpi, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
              className="rounded-2xl p-6" style={kpiGlassStyle}>
              <div className="mb-3">{kpi.icon}</div>
              <p className="text-[10px] font-bold tracking-[0.2em] text-white/40 mb-1">{kpi.label}</p>
              <p className="text-2xl font-black tabular-nums">{kpi.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Cost distribution pie */}
        {pieData.length > 0 && (
          <div className="rounded-2xl p-6" style={glassStyle}>
            <h3 className="text-xs font-bold tracking-[0.2em] text-white/40 mb-6">DISTRIBUCIÓN DE COSTES</h3>
            <div className="flex flex-wrap items-center justify-center gap-8">
              {pieData.map((item, i) => {
                const pct = summaryStats.totalEur > 0 ? (item.value / summaryStats.totalEur * 100) : 0
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ background: item.color }} />
                    <div>
                      <p className="text-sm font-bold text-white">{item.label}</p>
                      <p className="text-xs text-white/50">{item.value.toFixed(2)} € ({pct.toFixed(1)}%)</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Gas invoices table */}
        <div className="rounded-2xl overflow-hidden" style={glassStyle}>
          <h3 className="text-xs font-bold tracking-[0.2em] text-white/40 px-6 pt-5 pb-3">FACTURAS DE GAS</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/40 font-bold tracking-wider">
                  <th className="px-4 py-3 text-left">MES</th>
                  <th className="px-3 py-3 text-center">TARIFA</th>
                  <th className="px-3 py-3 text-right">KWH</th>
                  <th className="px-3 py-3 text-right">BRUTO EN.</th>
                  <th className="px-3 py-3 text-right text-ok/70">DESC. EN.</th>
                  <th className="px-3 py-3 text-right text-warn">NETO EN.</th>
                  <th className="px-3 py-3 text-right">€/KWH</th>
                  <th className="px-3 py-3 text-right">T. FIJO</th>
                  <th className="px-3 py-3 text-right">IMP.</th>
                  <th className="px-3 py-3 text-right">ALQUILER</th>
                  <th className="px-4 py-3 text-right">TOTAL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tableData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.04] transition-colors">
                    <td className="px-4 py-3 font-bold text-white">{row.mes}</td>
                    <td className="px-3 py-3 text-center text-warn font-bold">{row.tarifa}</td>
                    <td className="px-3 py-3 text-right font-mono text-white/80">{row.kwh.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-3 text-right font-mono text-white/60">{row.costeBruto.toFixed(2)}€</td>
                    <td className="px-3 py-3 text-right font-mono text-ok/60">{row.descuentoEnergia > 0 ? `-${row.descuentoEnergia.toFixed(2)}€` : '—'}</td>
                    <td className="px-3 py-3 text-right font-mono text-warn font-bold">{row.costeNeto.toFixed(2)}€</td>
                    <td className={`px-3 py-3 text-right font-mono ${row.precioEstimated ? 'text-yellow-400' : 'text-white/70'}`}>
                      {row.precioKwh > 0 ? row.precioKwh.toFixed(4) : '—'}
                      {row.precioEstimated && <span className="block text-[8px] text-yellow-500/50 leading-none">est.</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-white/50">{row.terminoFijo > 0 ? `${row.terminoFijo.toFixed(2)}€` : '—'}</td>
                    <td className="px-3 py-3 text-right text-white/50">{row.impuesto > 0 ? `${row.impuesto.toFixed(2)}€` : '—'}</td>
                    <td className="px-3 py-3 text-right text-white/50">{row.alquiler > 0 ? `${row.alquiler.toFixed(2)}€` : '—'}</td>
                    <td className="px-4 py-3 text-right font-black text-white bg-[#E0E8DC]">{row.total.toFixed(2)}€</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-white/5 border-t border-white/10 font-bold text-[11px]">
                <tr>
                  <td className="px-4 py-4 text-white uppercase font-black italic">TOTAL</td>
                  <td className="px-3 py-4 text-center text-white/50">{summaryStats.tariff}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-white">{summaryStats.totalKwh.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-white/60">
                    {tableData.reduce((s, r) => s + r.costeBruto, 0).toFixed(2)}€
                  </td>
                  <td className="px-3 py-4 text-right tabular-nums text-ok/60">
                    {tableData.reduce((s, r) => s + r.descuentoEnergia, 0) > 0
                      ? `-${tableData.reduce((s, r) => s + r.descuentoEnergia, 0).toFixed(2)}€` : '—'}
                  </td>
                  <td className="px-3 py-4 text-right tabular-nums text-warn">{summaryStats.totalEnergyNet.toFixed(2)}€</td>
                  <td className="px-3 py-4 text-right tabular-nums text-white">{summaryStats.avgPrice.toFixed(4)}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-white/50">{summaryStats.totalTerminoFijo.toFixed(2)}€</td>
                  <td className="px-3 py-4 text-right tabular-nums text-white/50">{summaryStats.totalImpuesto.toFixed(2)}€</td>
                  <td className="px-3 py-4 text-right tabular-nums text-white/50">{summaryStats.totalAlquiler.toFixed(2)}€</td>
                  <td className="px-4 py-4 text-right tabular-nums text-white font-black bg-white/[0.06]">{summaryStats.totalEur.toFixed(2)}€</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Report View ─────────────────────────────────────────────────────────────

function ReportView({ invoices, supplyName, onBack, onInvoicesUpdated }: {
  invoices: InvoiceRow[]
  supplyName?: string
  onBack: () => void
  onInvoicesUpdated: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
  const [showAvgPriceModal, setShowAvgPriceModal] = useState(false)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)         // Modal 1: Bill breakdown (Matrix 3)
  const [selectedPriceBillId, setSelectedPriceBillId] = useState<string | null>(null) // Modal 2: Price calc (Matrix 2)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const toggleReveal = (id: string) => setRevealedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const isAnnual = selectedMonths.size === 12

  const toggleMonth = (monthIdx: number) => {
    setSelectedMonths(prev => {
      const next = new Set(prev)
      if (next.has(monthIdx)) { if (next.size > 1) next.delete(monthIdx) }
      else { next.add(monthIdx) }
      return next
    })
  }

  const selectAllMonths = () => setSelectedMonths(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))

  // Invoices with usable data vs without
  const validInvoices = useMemo(() => invoices.filter(hasUsableData), [invoices])
  const invalidInvoices = useMemo(() => invoices.filter(inv => !hasUsableData(inv)), [invoices])

  // Which months actually have data (for highlighting month selector)
  const monthsWithData = useMemo(() => {
    const months = new Set<number>()
    validInvoices.forEach(inv => {
      const { start, end } = getInvoiceDates(inv)
      const { month } = getAssignedMonth(start, end)
      if (month >= 0 && month <= 11) months.add(month)
    })
    return months
  }, [validInvoices])

  // Filtered invoices by selected months
  const filteredInvoices = useMemo(() =>
    validInvoices.filter(inv => {
      const { start, end } = getInvoiceDates(inv)
      const { month } = getAssignedMonth(start, end)
      return selectedMonths.has(month)
    }),
    [validInvoices, selectedMonths]
  )

  // Supply info — computed early so useMemo below can use activePeriods
  const firstEco = validInvoices.length > 0 ? getEco(validInvoices[0]) : null
  const firstEd = validInvoices[0]?.extracted_data
  const cups = firstEco?.cups || firstEd?.cups || '—'
  const tarifa = firstEco?.tarifa || firstEd?.tariff || '—'
  const titular = firstEco?.titular || (firstEd?.holder_name as string) || supplyName || 'PROYECTO'

  // Active periods: P1+P2 only for 2.0TD, P1–P6 for everything else
  const activePeriods = getActivePeriods(tarifa !== '—' ? tarifa : null)

  // All computed data
  const { chartData, pieData, summaryStats, tableData, excessData, totalExcessAmount, hasExcesses, averagePriceStats } = useMemo(() => {
    const allMonthly = getMonthlyAggregatedData(validInvoices)
    const cData = allMonthly.map(m => ({
      ...m,
      totalFactura: selectedMonths.has(m.monthIndex) ? m.totalFactura : 0,
      energia: selectedMonths.has(m.monthIndex) ? m.energia : 0,
      potencia: selectedMonths.has(m.monthIndex) ? m.potencia : 0,
      otros: selectedMonths.has(m.monthIndex) ? m.otros : 0,
      totalKwh: selectedMonths.has(m.monthIndex) ? m.totalKwh : 0,
      billsCount: selectedMonths.has(m.monthIndex) ? m.billsCount : 0,
    }))

    const totals = {
      energetic: cData.reduce((s, m) => s + m.energia, 0),
      power: cData.reduce((s, m) => s + m.potencia, 0),
      global: cData.reduce((s, m) => s + m.totalFactura, 0),
      kwh: cData.reduce((s, m) => s + m.totalKwh, 0),
      others: cData.reduce((s, m) => s + m.otros, 0),
    }

    // PRECIO PROMEDIO = coste total energía / consumo total kWh
    const precioPromedio = totals.kwh > 0 ? totals.energetic / totals.kwh : 0

    const pData = [
      { label: 'CONSUMO ENERGÍA', value: totals.energetic, color: '#3b82f6' },
      { label: 'POTENCIA', value: totals.power, color: '#8b5cf6' },
      { label: 'IMPUESTOS Y OTROS', value: totals.others, color: '#10b981' },
      { label: 'OTROS', value: Math.max(0, totals.global - totals.energetic - totals.power - totals.others), color: '#f59e0b' },
    ]

    const avgEnergyPrice = totals.kwh > 0 ? totals.energetic / totals.kwh : 0

    const tData = filteredInvoices.map(inv => {
      const eco = getEco(inv)!
      const { start, end } = getInvoiceDates(inv)
      const { month } = getAssignedMonth(start, end)
      const mesLabel = getMonthYear(end || start)
      const totalKwh = eco.consumoTotalKwh || 0
      const energia = eco.costeTotalConsumo || eco.costeNetoConsumo || 0  // net
      // Precio medio = costeMedioKwh directo, o costeTotalConsumo/consumoTotalKwh
      const avgPrice = eco.costeMedioKwhNeto || eco.costeMedioKwh || (totalKwh > 0 ? energia / totalKwh : 0)
      const totalFactura = eco.totalFactura || inv.total_amount || 0

      // Discount factor: consumo[].total is GROSS (before discount).
      // Scale period amounts proportionally to get net values.
      const energiaBruta = eco.costeBrutoConsumo || energia
      const discountFactor = (energiaBruta > 0 && (eco.descuentoEnergia || 0) > 0)
        ? energia / energiaBruta
        : 1

      const kwhByPeriod: Record<string, number> = {}
      const pricesByPeriod: Record<string, number> = {}
      const periodSpend: Record<string, { eur: number; isEstimated: boolean }> = {}

      activePeriods.forEach(p => {
        const item = eco.consumo?.find(c => c.periodo === p)
        kwhByPeriod[p] = item?.kwh || 0
        // Apply discount factor to price
        pricesByPeriod[p] = (item?.precioKwh || 0) * discountFactor

        let eur = 0, isEstimated = false
        if (item) {
          if (item.total > 0) {
            // item.total is gross — scale to net
            eur = item.total * discountFactor
          } else if (item.precioKwh > 0 && item.kwh > 0) {
            eur = item.kwh * item.precioKwh * discountFactor
          } else if (item.kwh > 0 && avgEnergyPrice > 0) {
            eur = item.kwh * avgEnergyPrice; isEstimated = true
          }
        }
        periodSpend[p] = { eur, isEstimated }
      })

      // Keep full eco ref for modals
      const potencia = eco.costeTotalPotencia || 0
      let impuestos = 0, otrosTotal = 0
      ;(eco.otrosConceptos || []).forEach(oc => {
        if (oc.concepto?.toLowerCase().includes('impuesto') || oc.concepto?.toLowerCase().includes('iva') || oc.concepto?.toLowerCase().includes('igic')) {
          impuestos += oc.total
        } else {
          otrosTotal += oc.total
        }
      })

      return {
        id: inv.id, mes: mesLabel, monthIndex: month, totalKwh, avgPrice, totalFactura,
        kwhByPeriod, pricesByPeriod, periodSpend,
        eco, inv, // keep refs for modals
        energia, potencia, impuestos, otrosTotal,
        fileName: inv.file_url?.split('/').pop() || inv.id.slice(0, 8),
      }
    }).sort((a, b) => a.monthIndex - b.monthIndex)

    // Per-period average price stats (for Modal 3)
    const avgPriceStats = activePeriods.map(p => {
      let totalKwhP = 0, totalEurP = 0
      tData.forEach(r => {
        totalKwhP += r.kwhByPeriod[p] || 0
        totalEurP += r.periodSpend[p]?.eur || 0
      })
      return { period: p, totalKwh: totalKwhP, totalEur: totalEurP, avgPrice: totalKwhP > 0 ? totalEurP / totalKwhP : 0 }
    })

    const eData = filteredInvoices.map(inv => {
      const eco = getEco(inv)!
      const { totalExcess } = getExcessAmountFromEco(eco)
      const { end } = getInvoiceDates(inv)
      return { id: inv.id, name: getMonthYear(end), excessAmount: totalExcess, hasExcess: totalExcess > 0 }
    }).filter(b => b.hasExcess)

    const totalExcess = eData.reduce((s, b) => s + b.excessAmount, 0)

    return {
      chartData: cData,
      pieData: pData,
      summaryStats: { ...totals, precioPromedio, docsCount: filteredInvoices.length },
      tableData: tData,
      excessData: eData,
      totalExcessAmount: totalExcess,
      hasExcesses: totalExcess > 0,
      averagePriceStats: avgPriceStats,
    }
  }, [validInvoices, filteredInvoices, selectedMonths, activePeriods])

  const avgPriceAll = tableData.length > 0 ? tableData.reduce((s, r) => s + r.avgPrice, 0) / tableData.length : 0

  const spendTotals = useMemo((): Record<string, number> => {
    const totals: Record<string, number> = {}
    activePeriods.forEach(p => { totals[p] = 0 })
    totals.grandTotal = 0
    tableData.forEach(row => {
      activePeriods.forEach(p => { totals[p] += row.periodSpend[p]?.eur || 0 })
      totals.grandTotal += row.totalFactura
    })
    return totals
  }, [tableData, activePeriods])

  // ESC key to exit fullscreen report
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close modals first, then exit report
        if (selectedBillId) { setSelectedBillId(null); return }
        if (selectedPriceBillId) { setSelectedPriceBillId(null); return }
        if (showAvgPriceModal) { setShowAvgPriceModal(false); return }
        onBack()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [selectedBillId, selectedPriceBillId, showAvgPriceModal, onBack])

  // Lock body scroll when fullscreen
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const sectionVariants = {
    hidden: { opacity: 0, y: 50 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' as const } },
  }
  const kpiVariants = {
    hidden: { opacity: 0, rotateY: 25, scale: 0.88 },
    visible: (i: number) => ({ opacity: 1, rotateY: 0, scale: 1, transition: { delay: i * 0.1, duration: 0.7, ease: 'easeOut' as const } }),
  }

  return (
    <div ref={containerRef} id="voltis-report" className="fixed inset-0 z-[200] overflow-y-auto text-[#2D3A33]"
      style={{ fontFamily: 'Inter, sans-serif', background: '#F4EEE2' }}>

      {/* Back button (also ESC key) - Fixed sticky positioning */}
      <button onClick={onBack} title="Volver (ESC)"
        className="fixed top-4 left-4 z-[210] w-11 h-11 rounded-full flex items-center justify-center transition hover:scale-110 hover:bg-white/20 no-print"
        style={{ background: 'rgba(251,247,238,0.80)', backdropFilter: 'blur(16px)', border: '1px solid #E5DCC9', WebkitBackdropFilter: 'blur(16px)' }}>
        <ArrowLeft className="w-5 h-5 text-[#2D3A33]" />
      </button>

      {/* GlowOrbs (screen only) */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0 no-print">
        <GlowOrb className="top-[-10%] left-[20%]" size="lg" />
        <GlowOrb className="top-[30%] right-[10%]" size="md" />
        <GlowOrb className="bottom-[10%] left-[40%]" size="lg" />
      </div>

      <div className="relative z-10">

        {/* Re-extract banner (screen only) */}
        {invalidInvoices.length > 0 && (
          <div className="pt-16 px-8 no-print">
            <ReExtractBanner invoices={invalidInvoices} onDone={onInvoicesUpdated} />
          </div>
        )}

        {/* Month selector (screen only) - Sticky positioned with glassmorphism */}
        <div className="sticky top-0 z-[205] flex items-center gap-2 py-4 px-8 flex-wrap justify-center no-print"
          style={{ background: 'rgba(244,238,226,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid #E5DCC9' }}>
          <button onClick={selectAllMonths}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${isAnnual ? 'bg-[#2D3A33] text-[#FBF7EE]' : 'bg-[#EDE8DC] text-[#5A6B5F] hover:bg-[#E5DCC9]'}`}>
            ANUAL
          </button>
          {CANONICAL_MONTHS.map((label, i) => {
            const isSelected = selectedMonths.has(i)
            const hasData = monthsWithData.has(i)
            return (
              <button key={i} onClick={() => toggleMonth(i)}
                className={`w-9 h-9 rounded-xl text-xs font-medium transition ${
                  isSelected && hasData ? 'bg-[#6B8068] text-[#FBF7EE] shadow-lg shadow-salvia/20' :
                  isSelected && !hasData ? 'bg-[#EDE8DC] text-[#8A9A8E]' :
                  hasData ? 'bg-[#E0E8DC] text-[#6B8068] hover:bg-[#D0DCC8] border border-[#6B8068]/30' :
                  'bg-[#F4EEE2] text-[#8A9A8E] border border-[#E5DCC9]'
                }`}>
                {i + 1}
              </button>
            )
          })}
        </div>

        {/* ════════════════════════════════════════════════════════════════
            SCENE 1 — PORTADA (matches standalone exactly)
            ════════════════════════════════════════════════════════════════ */}
        <motion.div id="scene-1" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="report-page flex flex-col items-center justify-center min-h-screen px-8">

          <div className="text-center">
            <h1 className="text-7xl md:text-8xl font-black tracking-tight text-[#6B8068] mb-2"
              style={{ fontFamily: 'Inter, sans-serif' }}>VOLTIS</h1>
            <p className="text-sm md:text-base tracking-[0.4em] text-[#8A9A8E] mb-12">ANUAL ECONOMICS</p>

            <div className="w-20 h-1 bg-[#E8B89A] mx-auto mb-12 rounded-full" />

            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-[#2D3A33] mb-10">{titular}</h2>

            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full border border-[#E5DCC9] bg-[#FBF7EE] mb-4">
              <span className="text-[#8A9A8E] text-sm tracking-widest">CUPS</span>
              <span className="text-[#E5DCC9]">·</span>
              <span className="text-[#2D3A33] font-bold text-sm tracking-wider">{cups}</span>
            </div>

            <div className="block">
              <span className="text-[#6B8068] text-xs tracking-[0.3em]">TARIFA {tarifa}</span>
            </div>

            <p className="text-[#8A9A8E] text-xs tracking-[0.3em] mt-16">INFORME DE AUDITORÍA ENERGÉTICA</p>
          </div>
        </motion.div>

        {/* ════════════════════════════════════════════════════════════════
            SCENE 2 — KPIs (centered vertical cards like standalone)
            ════════════════════════════════════════════════════════════════ */}
        <motion.div id="scene-2" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} variants={sectionVariants}
          className="report-page px-8 py-12">
          <div className="mb-10">
            <p className="text-[#6B8068] text-xs tracking-[0.4em] mb-2">MÉTRICAS AUDITADAS</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-[#2D3A33]">RESULTADOS {isAnnual ? 'ANUALES' : 'FILTRADOS'}</h2>
          </div>

          {/* Large centered KPI cards */}
          <div className="max-w-lg mx-auto space-y-6 mb-10">
            {/* Facturación Global */}
            <motion.div custom={0} variants={kpiVariants} className="rounded-2xl p-8 text-center" style={kpiGlassStyle}>
              <p className="text-[#8A9A8E] text-xs tracking-[0.3em] mb-3">FACTURACIÓN GLOBAL</p>
              <p className="text-[#2D3A33] text-5xl md:text-6xl font-black">
                <CountUp value={summaryStats.global} decimals={2} duration={1.2} />
              </p>
              <p className="text-[#6B8068] text-sm mt-2 tracking-wider">EUR</p>
            </motion.div>

            {/* Energía Total */}
            <motion.div custom={1} variants={kpiVariants} className="rounded-2xl p-8 text-center" style={kpiGlassStyle}>
              <p className="text-[#8A9A8E] text-xs tracking-[0.3em] mb-3">ENERGÍA TOTAL CONSUMIDA</p>
              <p className="text-[#2D3A33] text-5xl md:text-6xl font-black">
                <CountUp value={summaryStats.kwh} decimals={0} duration={1.2} />
              </p>
              <p className="text-[#6B8068] text-sm mt-2 tracking-wider">kWh</p>
            </motion.div>

            {/* Precio Promedio + Docs side by side */}
            <div className="grid grid-cols-2 gap-4">
              <motion.div custom={2} variants={kpiVariants}
                className="rounded-2xl p-6 text-center cursor-pointer hover:ring-1 hover:ring-[#6B8068]/30"
                style={kpiGlassStyle} onClick={() => setShowAvgPriceModal(true)}>
                <p className="text-[#8A9A8E] text-xs tracking-[0.2em] mb-3">PRECIO PROMEDIO</p>
                <p className="text-[#2D3A33] text-3xl md:text-4xl font-black">
                  <CountUp value={summaryStats.precioPromedio} decimals={4} duration={1.5} />
                </p>
                <p className="text-[#6B8068] text-sm mt-2 tracking-wider">EUR/kWh</p>
              </motion.div>
              <motion.div custom={3} variants={kpiVariants} className="rounded-2xl p-6 text-center" style={kpiGlassStyle}>
                <p className="text-[#8A9A8E] text-xs tracking-[0.2em] mb-3">DOCUMENTOS PROCESADOS</p>
                <p className="text-[#2D3A33] text-3xl md:text-4xl font-black">
                  <CountUp value={summaryStats.docsCount} decimals={0} duration={1} />
                </p>
                <p className="text-[#6B8068] text-sm mt-2 tracking-wider">FACTURAS</p>
              </motion.div>
            </div>
          </div>

          {/* Precio Medio por Periodo bar — hidden in print, visible in modal */}
          {averagePriceStats.some(p => p.totalKwh > 0) && (
            <div className="rounded-2xl p-5 mt-6 no-print" style={glassStyle}>
              <p className="text-[#6B8068] text-xs font-bold tracking-[0.3em] mb-4">PRECIO MEDIO POR PERIODO</p>
              <div className="grid grid-cols-6 gap-4 text-center">
                {averagePriceStats.map(ps => (
                  <div key={ps.period}>
                    <p className="text-xs font-bold" style={{ color: PERIOD_COLORS[ps.period] }}>{ps.period}</p>
                    <p className="text-[#5A6B5F] text-xs mt-0.5">{ps.totalKwh > 0 ? `${fmt(ps.avgPrice, 4)} €/kWh` : '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {/* ════════════════════════════════════════════════════════════════
            SCENE 3 — CHARTS (stacked, matching standalone)
            ════════════════════════════════════════════════════════════════ */}
        <motion.div id="scene-3" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}
          className="report-page px-8 py-12">

          {/* Bar chart — Evolución */}
          <div className="mb-12">
            <p className="text-[#6B8068] text-xs tracking-[0.4em] mb-1">ANÁLISIS TEMPORAL</p>
            <h3 className="text-3xl md:text-4xl font-black mb-4 text-[#2D3A33]">EVOLUCIÓN DEL GASTO MENSUAL</h3>
            <div className="rounded-2xl p-6" style={glassStyle}>
              <SVGBarChart data={chartData} />
            </div>
          </div>

          {/* Donut chart — Bio-estructura */}
          <div>
            <p className="text-[#6B8068] text-xs tracking-[0.4em] mb-1">ANÁLISIS ESTRUCTURAL</p>
            <h3 className="text-3xl md:text-4xl font-black mb-4 text-[#2D3A33]">BIO-ESTRUCTURA ECONÓMICA</h3>
            <div className="rounded-2xl p-8" style={glassStyle}>
              <div className="flex items-center gap-12 flex-wrap justify-center">
                <DonutChart segments={pieData} total={summaryStats.global} />
                <div className="space-y-3 flex-1 min-w-[200px]">
                  {pieData.filter(seg => seg.value > 0).map(seg => {
                    const pct = summaryStats.global > 0 ? (seg.value / summaryStats.global * 100).toFixed(1) : '0'
                    return (
                      <div key={seg.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                          <span className="text-[#5A6B5F] text-sm">{seg.label === 'CONSUMO ENERGÍA' ? 'Consumo' : seg.label === 'POTENCIA' ? 'Potencia' : seg.label === 'IMPUESTOS Y OTROS' ? 'Impuestos' : 'Otros'}</span>
                        </div>
                        <span className="font-bold text-sm" style={{ color: seg.color }}>{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ════════════════════════════════════════════════════════════════
            SCENE 4-6 — MATRICES (same as before but with better labels)
            ════════════════════════════════════════════════════════════════ */}
        {tableData.length > 0 && (<>
          <motion.div id="scene-4" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}
            className="report-page px-8 py-12">
            <div className="mb-3">
              <p className="text-[#6B8068] text-xs tracking-[0.4em] mb-2">ENGINEERING MATRIX</p>
              <h3 className="text-3xl md:text-4xl font-black tracking-tight mb-6 text-[#2D3A33]">MATRIZ ENERGÉTICA MENSUAL (KWH)</h3>
            </div>
            <AuditMatrixTable
              rows={tableData.map(r => ({ mes: r.mes, periods: r.kwhByPeriod as Record<string, unknown>, total: r.totalKwh }))}
              renderCell={(row, p) => { const v = row.periods[p] as number; return v ? <span className="text-[#5A6B5F] text-sm">{fmt(v, 0)}</span> : <span className="text-[#8A9A8E] text-sm">-</span> }}
              renderTotal={(row) => {
                const v = row.total as number
                const allTotals = tableData.map(r => r.totalKwh)
                const maxV = Math.max(...allTotals)
                const isMax = v === maxV && v > 0
                return <span className={`font-bold text-sm ${isMax ? 'text-err bg-err-container/400/10 px-2 py-0.5 rounded' : 'text-info'}`}>{fmt(v, 0)}</span>
              }}
              activePeriods={activePeriods}
              footerRow={
                <div className="grid items-center py-4 px-4 border-t border-[#E5DCC9] bg-[#EDE8DC]"
                  style={{ gridTemplateColumns: `220px repeat(${activePeriods.length}, 1fr) 180px` }}>
                  <span className="text-[#6B8068] font-black text-sm tracking-wider">TOTAL</span>
                  {activePeriods.map(p => {
                    const total = tableData.reduce((s, r) => s + (r.kwhByPeriod[p] || 0), 0)
                    return <span key={p} className="text-info font-bold text-sm">{total > 0 ? fmt(total, 0) : '-'}</span>
                  })}
                  <span className="text-info font-black text-sm">{fmt(summaryStats.kwh, 0)}</span>
                </div>
              }
            />
          </motion.div>

          {/* SCENE 5 — MATRIX 2: €/kWh */}
          <motion.div id="scene-5" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={sectionVariants}
            className="report-page px-8 py-12">
            <div className="mb-3">
              <p className="text-info text-xs tracking-[0.4em] mb-2">PRICING MATRIX</p>
              <h3 className="text-3xl md:text-4xl font-black tracking-tight mb-6 text-[#2D3A33]">MATRIZ DE COSTE POR PERIODO (€/KWH)</h3>
            </div>
            <AuditMatrixTable
              activePeriods={activePeriods}
              rows={tableData.map(r => ({ id: r.id, mes: r.mes, periods: r.pricesByPeriod as Record<string, unknown>, total: r.avgPrice }))}
              renderCell={(row, p) => {
                const v = row.periods[p] as number
                if (!v) return <span className="text-[#8A9A8E] text-sm">-</span>
                return <span className="text-[#5A6B5F] text-sm">{fmt(v, 4)}</span>
              }}
              renderTotal={(row) => {
                const v = row.total as number
                if (!v) return <span className="text-[#8A9A8E] text-sm">—</span>
                return <span className={`font-bold text-sm ${v > avgPriceAll ? 'text-err' : 'text-info'}`}>{fmt(v, 4)}</span>
              }}
              onRowClick={(row) => setSelectedPriceBillId((row as any).id)}
            />
            <p className="text-[#8A9A8E] text-xs mt-3 text-center italic no-print">Haz click en una fila para ver el cálculo del precio medio</p>
          </motion.div>

          {/* SCENE 6 — MATRIX 3: € spend + EXCESOS */}
          <motion.div id="scene-6" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={sectionVariants}
            className="report-page px-8 py-12">
            <div className="mb-3">
              <p className="text-info text-xs tracking-[0.4em] mb-2">SPENDING MATRIX</p>
              <h3 className="text-3xl md:text-4xl font-black tracking-tight mb-6 text-[#2D3A33]">MATRIZ DE GASTO POR PERIODO (€)</h3>
            </div>
            <AuditMatrixTable
              activePeriods={activePeriods}
              rows={tableData.map(r => ({ id: r.id, mes: r.mes, periods: Object.fromEntries(activePeriods.map(p => [p, r.periodSpend[p]])) as Record<string, unknown>, total: r.totalFactura }))}
              renderCell={(row, p) => {
                const cell = row.periods[p] as { eur: number; isEstimated: boolean } | undefined
                if (!cell || cell.eur === 0) return <span className="text-[#8A9A8E] text-sm">—</span>
                return <span className={`text-sm ${cell.isEstimated ? 'text-yellow-400' : 'text-[#5A6B5F]'}`}>{fmt(cell.eur)}</span>
              }}
              renderTotal={(row) => <span className="text-info font-bold text-sm">{fmt(row.total as number)} €</span>}
              onRowClick={(row) => setSelectedBillId((row as any).id)}
              footerRow={
                <div className="grid items-center py-4 px-4 border-t border-[#E5DCC9] bg-[#EDE8DC]"
                  style={{ gridTemplateColumns: `220px repeat(${activePeriods.length}, 1fr) 180px` }}>
                  <span className="text-[#2D3A33] font-black text-sm tracking-wider">TOTAL</span>
                  {activePeriods.map(p => <span key={p} className="text-info font-bold text-sm">{spendTotals[p] > 0 ? fmt(spendTotals[p]) : '—'}</span>)}
                  <span className="text-info font-black text-sm">{fmt(spendTotals.grandTotal)} €</span>
                </div>
              }
            />

            {hasExcesses && (
              <div className="mt-8 rounded-2xl p-4 md:p-6 border border-warn/30/20"
                style={{ ...glassStyle, borderColor: 'rgba(245,158,11,0.2)' }}>
                <h4 className="flex items-center gap-2 text-xs font-bold tracking-[0.3em] text-warn/80 mb-4">
                  <Activity className="w-3.5 h-3.5" /> SEGUIMIENTO DE EXCESOS DE POTENCIA
                </h4>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-warn/30/20">
                    <th className="text-left py-2 px-3 text-warn/60 text-xs tracking-widest">PERIODO</th>
                    <th className="text-right py-2 px-3 text-warn/60 text-xs tracking-widest">IMPORTE EXCESO</th>
                  </tr></thead>
                  <tbody>{excessData.map(row => (
                    <tr key={row.id} className="border-b border-warn/30/10">
                      <td className="py-3 px-3 text-white/70">{row.name}</td>
                      <td className="py-3 px-3 text-right text-warn font-bold">{row.excessAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr className="border-t border-warn/30/30">
                    <td className="py-3 px-3 text-[#2D3A33] font-black text-sm">TOTAL EXCESOS</td>
                    <td className="py-3 px-3 text-right text-warn font-black text-sm">{totalExcessAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </motion.div>
        </>)}

        {/* SCENE 7 — FOOTER */}
        <motion.div id="scene-7" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} variants={sectionVariants}
          className="flex flex-col items-center justify-center py-20 gap-8 relative no-print">
          <GlowOrb className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" size="lg" />
          <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
            <Mascot className="w-48 md:w-64 drop-shadow-2xl relative z-10" />
          </motion.div>
          <div className="relative z-10 flex flex-col items-center gap-3">
            <button onClick={() => window.print()}
              className="flex items-center gap-2 px-10 py-4 rounded-full text-sm font-black tracking-widest uppercase transition hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #6B8068, #5A6E58)', boxShadow: '0 20px 40px -10px rgba(107,128,104,0.3)', color: '#FBF7EE' }}>
              <Download className="w-4 h-4" /> GENERAR PDF
            </button>
            <p className="text-[#8A9A8E] text-xs text-center max-w-xs">
              Activa «Background graphics» en el diálogo de impresión
            </p>
          </div>
        </motion.div>
      </div>

      {/* ═══════════ MODAL 1: Bill Breakdown (Matrix 3 click) ═══════════ */}
      <AnimatePresence>
        {selectedBillId && (() => {
          const bill = tableData.find(r => r.id === selectedBillId)
          if (!bill) return null
          return (
            <motion.div key="m1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print"
              onClick={() => setSelectedBillId(null)}>
              <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="rounded-2xl p-6 max-w-lg w-full mx-4 max-h-[70vh] overflow-y-auto" style={glassStyle} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-[#2D3A33]">{bill.mes}</h3>
                    <button onClick={() => toggleReveal(bill.id)} className="text-[#8A9A8E] text-xs hover:text-[#5A6B5F] transition">
                      {revealedIds.has(bill.id) ? bill.fileName : 'Ver nombre de archivo →'}
                    </button>
                  </div>
                  <button onClick={() => setSelectedBillId(null)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20">
                    <X className="w-4 h-4 text-[#8A9A8E]" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Total Factura */}
                  <div className="col-span-2 rounded-xl p-4 bg-info-container border border-info/30">
                    <p className="text-info text-xs font-semibold tracking-wider mb-1">TOTAL FACTURA</p>
                    <p className="text-ink text-2xl font-black">{fmt(bill.totalFactura)} €</p>
                  </div>

                  {/* Energy by Period */}
                  <div className="col-span-2 rounded-xl p-4 bg-[#EDE8DC] border border-[#E5DCC9]">
                    <p className="text-[#5A6B5F] text-xs tracking-wider mb-3">ENERGÍA POR PERIODO</p>
                    <div className="grid grid-cols-3 gap-2">
                      {activePeriods.map(p => {
                        const spend = bill.periodSpend[p]
                        if (!spend || spend.eur === 0) return null
                        return (
                          <div key={p} className="text-center">
                            <p className="text-[#8A9A8E] text-[10px] font-medium">{p}</p>
                            <p className={`text-sm font-bold ${spend.isEstimated ? 'text-yellow-400' : 'text-[#2D3A33]'}`}>{fmt(spend.eur)} €</p>
                            <p className="text-[#8A9A8E] text-[10px]">{fmt(bill.kwhByPeriod[p], 0)} kWh</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Power */}
                  <div className="rounded-xl p-4 bg-neutral-container border border-neutral/20">
                    <p className="text-ink-3 text-xs font-semibold tracking-wider mb-1">POTENCIA</p>
                    <p className="text-ink text-lg font-bold">{fmt(bill.potencia)} €</p>
                  </div>

                  {/* Taxes */}
                  <div className="rounded-xl p-4 bg-ok-container border border-ok/30">
                    <p className="text-ok text-xs font-semibold tracking-wider mb-1">IMPUESTOS</p>
                    <p className="text-ink text-lg font-bold">{fmt(bill.impuestos)} €</p>
                  </div>

                  {/* Others */}
                  {bill.otrosTotal > 0 && (
                    <div className="col-span-2 rounded-xl p-4 bg-warn-container border border-warn/30">
                      <p className="text-warn text-xs font-semibold tracking-wider mb-1">OTROS CONCEPTOS</p>
                      <p className="text-ink text-lg font-bold">{fmt(bill.otrosTotal)} €</p>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* ═══════════ MODAL 2: Price Calculation (Matrix 2 click) ═══════════ */}
      <AnimatePresence>
        {selectedPriceBillId && (() => {
          const bill = tableData.find(r => r.id === selectedPriceBillId)
          if (!bill) return null
          const consumoItems = bill.eco?.consumo || []
          return (
            <motion.div key="m2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print"
              onClick={() => setSelectedPriceBillId(null)}>
              <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="rounded-2xl p-6 max-w-md w-full mx-4 max-h-[70vh] overflow-y-auto" style={glassStyle} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-[#2D3A33]">{bill.mes}</h3>
                    <button onClick={() => toggleReveal(bill.id + '_price')} className="text-[#8A9A8E] text-xs hover:text-[#5A6B5F] transition">
                      {revealedIds.has(bill.id + '_price') ? bill.fileName : 'Ver nombre de archivo →'}
                    </button>
                  </div>
                  <button onClick={() => setSelectedPriceBillId(null)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20">
                    <X className="w-4 h-4 text-[#8A9A8E]" />
                  </button>
                </div>

                <p className="text-[#8A9A8E] text-xs tracking-wider mb-3">PRECIO x kWh CONSUMIDO</p>
                <div className="space-y-2 mb-4">
                  {consumoItems.filter(c => c.kwh > 0).map(c => (
                    <div key={c.periodo} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#EDE8DC] border border-[#E5DCC9] hover:bg-[#E0E8DC] transition">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: PERIOD_COLORS[c.periodo] + '30', color: PERIOD_COLORS[c.periodo] }}>{c.periodo}</span>
                        <span className="text-[#5A6B5F] text-sm">{fmt(c.kwh, 0)} kWh</span>
                      </div>
                      <span className="text-[#2D3A33] font-bold text-sm">{fmt(c.precioKwh, 4)} €/kWh</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl p-4 bg-[#E0E8DC] border border-[#6B8068]/30">
                  <p className="text-[#6B8068] text-xs tracking-wider mb-2">PRECIO MEDIO PONDERADO</p>
                  <p className="text-[#5A6B5F] text-xs mb-1">Σ(kWh × Precio) / ΣkWh</p>
                  <p className="text-[#6B8068] text-2xl font-black">{fmt(bill.avgPrice, 4)} €/kWh</p>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* ═══════════ MODAL 3: Average Price Breakdown (KPI click) ═══════════ */}
      <AnimatePresence>
        {showAvgPriceModal && (
          <motion.div key="m3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print"
            onClick={() => setShowAvgPriceModal(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="rounded-2xl p-6 max-w-md w-full mx-4 max-h-[70vh] overflow-y-auto" style={glassStyle} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Precio Promedio</h3>
                  <p className="text-white/40 text-xs">Media por periodo · {selectedMonths.size} meses seleccionados</p>
                </div>
                <button onClick={() => setShowAvgPriceModal(false)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>

              <div className="space-y-2 mb-4">
                {averagePriceStats.map(ps => (
                  <div key={ps.period} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: PERIOD_COLORS[ps.period] + '30', color: PERIOD_COLORS[ps.period] }}>{ps.period}</span>
                      <span className="text-white/50 text-sm">{ps.totalKwh > 0 ? `${fmt(ps.totalKwh, 0)} kWh` : 'Sin consumo'}</span>
                    </div>
                    <span className="text-white font-bold text-sm">{ps.totalKwh > 0 ? `${fmt(ps.avgPrice, 4)} €/kWh` : '—'}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl p-4 bg-teal-600/10 border border-teal-500/30">
                <p className="text-teal-300 text-xs tracking-wider mb-1">PRECIO PROMEDIO TOTAL</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/50 text-xs">costeTotalConsumo ÷ consumoTotalKwh</p>
                    <p className="text-white/30 text-xs mt-1">{fmt(summaryStats.energetic)} € ÷ {fmt(summaryStats.kwh, 0)} kWh</p>
                  </div>
                  <p className="text-teal-400 text-2xl font-black">{fmt(summaryStats.precioPromedio, 4)}</p>
                </div>
                <p className="text-white/30 text-xs mt-2">{averagePriceStats.filter(p => p.totalKwh > 0).length} periodos con consumo</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════ PRINT STYLES ═══════════ */}
      <style>{`
        @media print {
          /* ── STEP 1: Hide ALL elements via visibility ── */
          body * {
            visibility: hidden !important;
          }

          /* ── STEP 2: Show ONLY the report and its children ── */
          #voltis-report,
          #voltis-report * {
            visibility: visible !important;
          }

          /* ── STEP 3: Position report at top-left of page ── */
          #voltis-report {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            overflow: visible !important;
            height: auto !important;
            z-index: 999999 !important;
            background: #F4EEE2 !important;
          }

          /* Force colors on everything */
          html, body {
            background: #F4EEE2 !important;
            color: #2D3A33 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          /* Hide interactive/screen-only elements completely */
          .no-print,
          .no-print * {
            display: none !important;
            visibility: hidden !important;
          }
          #voltis-report button {
            display: none !important;
            visibility: hidden !important;
          }

          /* Remove backdrop filters & animations */
          * {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            animation: none !important;
          }

          /* ── Page breaks for clean A4 output ── */
          .report-page {
            page-break-after: always;
          }
          #scene-1 {
            min-height: 100vh;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          #scene-7 {
            display: none !important;
            visibility: hidden !important;
          }

          /* Glass panels don't break across pages */
          .rounded-2xl {
            page-break-inside: avoid;
          }

          /* SVGs print correctly */
          svg {
            overflow: visible !important;
          }

          /* Glow orbs hidden */
          .pointer-events-none {
            display: none !important;
            visibility: hidden !important;
          }

          /* Fixed elements inside report become static */
          #voltis-report .fixed {
            position: static !important;
          }

          /* ── Matrix tables: shrink to fit A4 ── */
          #voltis-report [style*="gridTemplateColumns"] {
            grid-template-columns: 130px repeat(6, 1fr) 100px !important;
            font-size: 8px !important;
            gap: 0 !important;
          }
          #voltis-report [style*="gridTemplateColumns"] span {
            font-size: 8px !important;
          }

          /* Report text sizes for print */
          #voltis-report h3 {
            font-size: 18px !important;
          }
          #voltis-report p {
            font-size: 9px !important;
          }

          /* Reduce padding in grid cells for print */
          #voltis-report .report-page {
            padding-left: 16px !important;
            padding-right: 16px !important;
          }
        }

        @page {
          size: A4 portrait;
          margin: 8mm;
        }
      `}</style>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AnnualEconomics({ invoices, supplyId, onInvoicesUpdated, supplyType: propSupplyType }: Props) {
  const [view, setView] = useState<'tabla' | 'informe'>('tabla')
  const [busyRescan, setBusyRescan] = useState<string | null>(null)
  const [busyDelete, setBusyDelete] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const withEco = invoices.filter(hasUsableData)
  const withoutEco = invoices.filter(inv => !hasUsableData(inv))
  const supplyName = withEco.length > 0 ? getEco(withEco[0])?.titular : undefined
  const isGas = isGasSupply(invoices, propSupplyType)

  // Aggregate validation status across all invoices
  const validationSummary = (() => {
    let anyFail = false
    let anyWarn = false
    let totalWarnings = 0
    for (const inv of withEco) {
      const v = (getEco(inv) as any)?.validation
      if (v) {
        if (v.mathOk === false) anyFail = true
        if (Array.isArray(v.warnings) && v.warnings.length > 0) {
          anyWarn = true
          totalWarnings += v.warnings.length
        }
      }
    }
    return { anyFail, anyWarn, totalWarnings }
  })()

  // Re-scan a single invoice
  const handleRescan = async (inv: InvoiceRow) => {
    if (!inv.file_url) return
    setBusyRescan(inv.id)
    try {
      const fileRes = await fetch(inv.file_url)
      if (!fileRes.ok) throw new Error(`Error descargando: ${fileRes.status}`)
      const blob = await fileRes.blob()
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = () => reject(new Error('Error leyendo archivo'))
        reader.readAsDataURL(blob)
      })
      const fileName = inv.file_url.split('/').pop() || 'invoice'
      const fileType = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'
      const analyzeRes = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_base64: base64, file_type: fileType, file_name: fileName }),
      })
      if (!analyzeRes.ok) throw new Error(`Error analizando: ${analyzeRes.status}`)
      const extractedData = await analyzeRes.json()
      const supabase = createClient()
      const economics = extractedData.economics
      const updateData: Record<string, unknown> = {
        extracted_data: extractedData,
        extraction_status: 'completed',
      }
      if (economics?.fechaInicio) updateData.period_start = economics.fechaInicio
      if (economics?.fechaFin) updateData.period_end = economics.fechaFin
      if (economics?.totalFactura) updateData.total_amount = economics.totalFactura
      else if (extractedData.total_amount) {
        const parsed = parseFloat(String(extractedData.total_amount).replace(',', '.'))
        if (!isNaN(parsed)) updateData.total_amount = parsed
      }
      await supabase.from('invoices').update(updateData).eq('id', inv.id)
      onInvoicesUpdated()
    } catch (err) {
      console.error('Re-scan error:', err)
    } finally {
      setBusyRescan(null)
    }
  }

  // Delete a single invoice + its storage file
  const handleDelete = async (inv: InvoiceRow) => {
    setConfirmDeleteId(inv.id)
  }

  const confirmDelete = async () => {
    if (!confirmDeleteId) return
    const inv = invoices.find(i => i.id === confirmDeleteId)
    if (!inv) return
    setBusyDelete(inv.id)
    setConfirmDeleteId(null)
    try {
      const supabase = createClient()
      // Delete storage file if exists
      if (inv.file_url) {
        const path = inv.file_url.split('/storage/v1/object/public/')[1]
        if (path) {
          const bucket = path.split('/')[0]
          const filePath = path.split('/').slice(1).join('/')
          await supabase.storage.from(bucket).remove([filePath])
        }
      }
      // Delete invoice record
      await supabase.from('invoices').delete().eq('id', inv.id)
      onInvoicesUpdated()
    } catch (err) {
      console.error('Delete error:', err)
    } finally {
      setBusyDelete(null)
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/40 gap-3">
        <Zap className="w-10 h-10 opacity-30" />
        <p className="text-sm">No hay facturas. Añade facturas para ver el análisis económico.</p>
      </div>
    )
  }

  if (view === 'informe') {
    if (isGas) {
      return <GasReportView invoices={invoices} supplyName={supplyName} onBack={() => setView('tabla')} />
    }
    return <ReportView invoices={invoices} supplyName={supplyName} onBack={() => setView('tabla')} onInvoicesUpdated={onInvoicesUpdated} />
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#FBF7EE', border: '1px solid #E5DCC9' }}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5DCC9]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-[0.3em] text-[#5A6B5F]">DATOS EXTRAÍDOS {withEco.length}/{invoices.length}</span>
          {withEco.length > 0 && (
            validationSummary.anyFail ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-err-container/400/20 text-err text-[10px] tracking-wide border border-err/30/30"
                title="La suma de conceptos no cuadra con el total de la factura"
              >
                ⚠ REVISAR EXTRACCIÓN
              </span>
            ) : validationSummary.anyWarn ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warn-container/400/20 text-warn text-[10px] tracking-wide border border-warn/30/30"
                title={`${validationSummary.totalWarnings} aviso(s) en la extracción`}
              >
                ⚠ REVISAR AVISOS
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ok-container/400/20 text-ok text-[10px] tracking-wide border border-ok/30/30">
                AI VERIFIED ✓
              </span>
            )
          )}
        </div>
        <button onClick={() => setView('informe')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition hover:scale-105"
          style={{ background: isGas ? 'linear-gradient(135deg, #ea580c, #f97316)' : 'linear-gradient(135deg, #6B8068, #5A6E58)', color: '#FBF7EE' }}>
          {isGas ? <Flame className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />} Generar informe
        </button>
      </div>
      {withoutEco.length > 0 && <ReExtractBanner invoices={withoutEco} onDone={onInvoicesUpdated} />}
      {withEco.length > 0 ? (
        <FileTable
          invoices={withEco}
          onRescan={handleRescan}
          onDelete={handleDelete}
          busyRescan={busyRescan}
          busyDelete={busyDelete}
          authoritativeType={propSupplyType}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-[#8A9A8E] gap-3">
          <AlertCircle className="w-8 h-8" />
          <p className="text-sm">Ninguna factura tiene datos económicos. Re-extrae las facturas.</p>
        </div>
      )}

      {/* Confirm delete modal */}
      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 max-w-sm w-full mx-4"
              style={{ background: '#FBF7EE', border: '1px solid #E5DCC9', boxShadow: '0 20px 50px -15px rgba(45,58,51,0.18)' }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-err-container flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-err" />
                </div>
                <div>
                  <h3 className="text-[#2D3A33] font-bold text-sm">Eliminar factura</h3>
                  <p className="text-[#5A6B5F] text-xs">Se eliminará la factura y sus datos asociados</p>
                </div>
              </div>
              <div className="flex items-center gap-3 justify-end">
                <button onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 rounded-xl text-sm text-white/60 hover:text-white hover:bg-white/10 transition">
                  Cancelar
                </button>
                <button onClick={confirmDelete}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-err-container/400/80 hover:bg-err-container/400 transition">
                  Eliminar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
