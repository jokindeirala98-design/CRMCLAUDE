'use client'

import React, { useState, useMemo, useEffect, useRef, startTransition } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, FileText, Zap, TrendingUp, CheckCircle2,
  RefreshCw, Loader2, AlertCircle, Download, Euro,
  DollarSign, Activity, X, Trash2, Flame, Sparkles, ChevronDown,
} from 'lucide-react'
import { VOLTIS_TARIFFS_2TD, compute2TDSavings, type VoltisKey2TD } from '@/lib/voltis-tariffs-2td'

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
  file_type?: string
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
    import_filename?: string
    [key: string]: unknown
  } | null
}

interface GasHistoryPeriod {
  fechaInicio: string
  fechaFin: string
  kwh: number
}

interface Props {
  invoices: InvoiceRow[]
  supplyId: string
  onInvoicesUpdated: () => void
  /** Authoritative supply type from the supply record (overrides invoice extracted_data) */
  supplyType?: 'luz' | 'gas' | 'telefonia' | string
  /** From SIPS: contracted power per period (kW) */
  potenciaContratada?: Record<string, number>
  /** From SIPS: annual consumption per period (kWh) */
  consumoPeriodos?: Record<string, number>
  /** Client/supply name for display */
  clientName?: string
  /** Supply name (e.g. "MENDIKUR Ayuntamiento") — takes priority over titular */
  supplyName?: string
  /** Gas historical consumption from Excel import (gasHistory in consumption_data) */
  gasHistory?: GasHistoryPeriod[]
  /** Auto-open the report/informe view on mount (e.g. from Telegram deep link) */
  initialView?: 'tabla' | 'informe'
  /** Maxímetro history for power adjustment detection */
  maximetroHistory?: any[]
  /** SIPS monthly consumption history — used to fill kWh matrix for months without invoices */
  sipsHistory?: any[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
const PERIOD_COLORS: Record<string, string> = {
  P1: '#A8B5C9', P2: '#E8B89A', P3: '#A8C0A0',
  P4: '#E8D1A0', P5: '#B8A8C5', P6: '#6B8068',
}

/** Returns true for 2.0TD tariffs (doméstico, ≤15 kW) */
function is2TDTariff(tarifa?: string | null): boolean {
  if (!tarifa) return false
  const t = tarifa.trim().toUpperCase().replace(/\s+/g, '')
  return t.startsWith('2.0') || t === '2.0TD' || t === '20TD'
}

/** Returns true for 3.0TD tariffs (industrial, 15–450 kW, 3 períodos) */
function is3TDTariff(tarifa?: string | null): boolean {
  if (!tarifa) return false
  const t = tarifa.trim().toUpperCase().replace(/\s+/g, '')
  return t.startsWith('3.0') || t === '3.0TD' || t === '30TD'
}

/**
 * Returns active POWER (potencia contratada) periods based on tariff.
 * - 2.0TD: P1 (Punta) + P2 (Valle) → 2 períodos
 * - 3.0TD, 6.xTD: P1–P6 → 6 períodos
 */
function getActivePowerPeriods(tarifa?: string | null): string[] {
  if (is2TDTariff(tarifa)) return ['P1', 'P2']
  return PERIODS
}

/**
 * Returns active ENERGY CONSUMPTION periods based on tariff.
 * - 2.0TD: P1 (Punta) + P2 (Llano) + P3 (Valle) → 3 períodos  ⚠️ ≠ power periods
 * - 3.0TD, 6.xTD: P1–P6 → 6 períodos
 */
function getActiveConsumoPeriods(tarifa?: string | null): string[] {
  if (is2TDTariff(tarifa)) return ['P1', 'P2', 'P3']
  return PERIODS
}

/** Returns active periods for consumption (canonical alias). */
function getActivePeriods(tarifa?: string | null): string[] {
  return getActiveConsumoPeriods(tarifa)
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
  // ISO / dash format: 2025-04-30 or 2025-04-30T00:00:00
  if (d.includes('-') && !d.startsWith('0')) {
    const ds = new Date(d)
    return isNaN(ds.getTime()) ? null : ds
  }
  // Slash format: 30/04/2025
  if (d.includes('/')) {
    const parts = d.split('/')
    if (parts.length < 3) return null
    const [day, month, year] = parts.map(Number)
    const ds = new Date(year, month - 1, day)
    return isNaN(ds.getTime()) ? null : ds
  }
  // Dot format: 30.04.2025 (gas invoices)
  if (d.includes('.')) {
    const parts = d.split('.')
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

/** Returns which periods have maxímetro deviations > threshold from contracted power */
function getMaximetroDeviations(
  maximetroHistory: any[] | undefined,
  potenciaContratada: Record<string, number> | undefined,
  threshold = 0.15
): Array<{ period: string; contracted: number; avgMaxi: number; deviation: number }> {
  if (!maximetroHistory?.length || !potenciaContratada) return []
  const periods = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
  const result: Array<{ period: string; contracted: number; avgMaxi: number; deviation: number }> = []
  for (const p of periods) {
    const contracted = Number(potenciaContratada[p]) || 0
    if (contracted <= 0) continue
    const values = maximetroHistory.map((h: any) => Number(h[p]) || 0).filter(v => v > 0)
    if (!values.length) continue
    const avgMaxi = values.reduce((s, v) => s + v, 0) / values.length
    const deviation = Math.abs(avgMaxi - contracted) / contracted
    if (deviation > threshold) result.push({ period: p, contracted, avgMaxi, deviation })
  }
  return result
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
  // Only show bars for months that have actual invoice data
  const filtered = data.filter(d => d.billsCount > 0)
  const chartItems = filtered.length > 0 ? filtered : data
  const max = Math.max(...chartItems.map(d => d.totalFactura), 1)
  const W = 760, H = 220, PAD = 40
  const barCount = chartItems.length
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
      {chartItems.map((d, i) => {
        const x = PAD + i * ((W - PAD * 2) / barCount) + ((W - PAD * 2) / barCount - BAR_W) / 2
        const barH = d.totalFactura > 0 ? Math.max(2, (d.totalFactura / max) * (H - PAD)) : 0
        const y = H - barH
        return (
          <g key={i}>
            <rect x={x} y={y} width={BAR_W} height={barH || 2}
              fill="url(#barGrad)" rx="3" />
            <text x={x + BAR_W / 2} y={H + 16}
              fill="#5A6B5F"
              fontSize="9" textAnchor="middle" fontWeight="600">
              {d.label}
            </text>
            {d.totalFactura > 0 && (
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

// ─── SVG Bar Chart for kWh (electricity) ───────────────────────────────────

function SVGBarChartKwh({ data, color = '#6B8068' }: { data: { totalKwh: number; label: string; billsCount?: number }[]; color?: string }) {
  const max = Math.max(...data.map(d => d.totalKwh), 1)
  const W = 760, H = 220, PAD = 40
  const barCount = data.length
  const BAR_W = Math.min(40, (W - PAD * 2) / barCount - 6)
  const gradId = `barGradKwh_${color.replace('#','')}`
  const lightColor = color + '99'
  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={lightColor} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
        <g key={i}>
          <line x1={PAD} x2={W - PAD} y1={H - t * (H - PAD)} y2={H - t * (H - PAD)} stroke="rgba(45,58,51,0.08)" strokeWidth="1" />
          <text x={PAD - 6} y={H - t * (H - PAD) + 4} fill="#8A9A8E" fontSize="9" textAnchor="end">
            {t === 0 ? '0' : `${Math.round(max * t).toLocaleString('es-ES')} kWh`}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = PAD + i * ((W - PAD * 2) / barCount) + ((W - PAD * 2) / barCount - BAR_W) / 2
        const barH = d.totalKwh > 0 ? Math.max(2, (d.totalKwh / max) * (H - PAD)) : 0
        const y = H - barH
        const hasData = (d.billsCount ?? (d.totalKwh > 0 ? 1 : 0)) > 0
        return (
          <g key={i}>
            <rect x={x} y={y} width={BAR_W} height={barH || 2} fill={`url(#${gradId})`} rx="3" opacity={hasData ? 1 : 0.15} />
            <text x={x + BAR_W / 2} y={H + 16} fill={hasData ? '#5A6B5F' : '#8A9A8E'} fontSize="9" textAnchor="middle" fontWeight={hasData ? '600' : '400'}>
              {d.label}
            </text>
            {hasData && d.totalKwh > 0 && (
              <text x={x + BAR_W / 2} y={y - 6} fill="#5A6B5F" fontSize="8" textAnchor="middle">
                {Math.round(d.totalKwh).toLocaleString('es-ES')}
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

function FileTable({ invoices, onRescan, onDelete, busyRescan, busyDelete, authoritativeType, potenciaContratada }: {
  invoices: InvoiceRow[]
  onRescan?: (inv: InvoiceRow) => void
  onDelete?: (inv: InvoiceRow) => void
  busyRescan?: string | null
  busyDelete?: string | null
  authoritativeType?: string
  potenciaContratada?: Record<string, number>
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

  // Detect active periods — differentiate power (potencia) vs energy (consumo) periods.
  // 2.0TD: power=P1+P2, consumo=P1+P2+P3 | 3.0TD: both=P1-P3 | 6.xTD: both=P1-P6
  const tarifa = invoices.find(inv => getEco(inv)?.tarifa || inv.extracted_data?.tariff)
    ?.extracted_data?.tariff as string | undefined
    || invoices.find(inv => getEco(inv)?.tarifa)
    ? getEco(invoices.find(inv => getEco(inv)?.tarifa)!)?.tarifa
    : undefined
  const activePeriods = getActiveConsumoPeriods(tarifa)
  const activePowerPeriods = getActivePowerPeriods(tarifa)

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
            <span className={`text-sm ${estimated ? 'text-yellow-600' : 'text-[#4A5E47]'}`}>{precio ? fmt(precio, 4) : '—'}</span>
            {estimated && <span className="block text-[9px] text-yellow-600/70">estimado</span>}
          </div>
        )
      },
    },
    { key: 'sep_gas1', label: '', isSeparator: true, render: () => null },
    {
      key: 'terminoFijo', label: 'TÉRMINO FIJO (€)',
      isSectionHeader: true,
      render: (eco) => <span className="text-[#2D3A33] font-bold text-sm">{fmt(eco?.gasPricing?.terminoFijoTotal)}</span>,
    },
    {
      key: 'terminoFijoDiario', label: 'CUOTA DIARIA (€/DÍA)',
      indent: true,
      render: (eco) => {
        const gp = eco?.gasPricing
        if (!gp?.terminoFijoDiario) return <span className="text-[#8A9A8E] text-sm">—</span>
        return <span className="text-[#4F5C53] text-sm">{fmt(gp.terminoFijoDiario, 4)} €/día × {gp.diasFacturados || '?'} días</span>
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
      key: 'impuestoHidrocarb', label: 'IMPUESTO S/ GAS NATURAL (€)',
      render: (eco) => <span className="text-[#4F5C53] text-sm">{fmt(eco?.gasPricing?.impuestoHidrocarbTotal)}</span>,
    },
    {
      key: 'alquilerGas', label: 'ALQUILER CONTADOR (€)',
      render: (eco) => <span className="text-[#4F5C53] text-sm">{fmt(eco?.gasPricing?.alquilerTotal)}</span>,
    },
    {
      key: 'ivaGas', label: 'IVA (€)',
      render: (eco) => <span className="text-[#4F5C53] text-sm">{fmt(eco?.gasPricing?.ivaTotal)}</span>,
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
    ...activePowerPeriods.map(p => ({
      key: `potencia_${p}`,
      label: `POTENCIA ${p}`,
      indent: true,
      render: (eco: BillEconomics | null, inv: InvoiceRow) => {
        const item = eco?.potencia?.find(c => c.periodo === p)
        if (!item || !item.total) return <span className="text-[#8A9A8E] text-sm">—</span>
        // kW: prefer stored value, then SIPS contracted power, then P1's kW (P1 and P2 always same kW in 2.0TD)
        const p1Kw = Number(eco?.potencia?.find(c => c.periodo === 'P1')?.kw) || 0
        const kw = Number(item.kw) > 0
          ? Number(item.kw)
          : (Number(potenciaContratada?.[p]) || p1Kw || 0)
        // días: prefer stored value, fall back to invoice billing period length
        const rawDias = Number(item.dias) || 0
        const billingDays = (() => {
          const start = inv.period_start ? new Date(inv.period_start) : null
          const end   = inv.period_end   ? new Date(inv.period_end)   : null
          if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return 0
          const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000)
          return diff > 0 && diff <= 366 ? diff + 1 : 0
        })()
        const dias = rawDias > 0 ? rawDias : billingDays
        const precioKwDia = Number(item.precioKwDia) > 0
          ? Number(item.precioKwDia)
          : (kw > 0 && dias > 0 ? item.total / (kw * dias) : 0)
        return (
          <div>
            <div className="text-[#5A6B5F] text-sm">{fmt(item.total)} €</div>
            {kw > 0 && precioKwDia > 0 && (
              <div className="text-[#8A9A8E] text-xs">{fmt(kw, 1)} kW · {fmt(precioKwDia, 4)} €/kW·día</div>
            )}
          </div>
        )
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
      key: 'autoconsumo', label: 'AHORRO AUTOCONSUMO SOLAR',
      render: (eco) => { const m = normalizeOtros(eco?.otrosConceptos); const v = getOtro(m, 'autoconsumo'); return v !== null ? <span className="text-amber-600 font-semibold text-sm bg-amber-50 px-1 rounded">{fmt(v)} €</span> : <span className="text-[#5A6B5F] text-sm">—</span> },
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
              const eco = getEco(inv)
              const rawData = inv.extracted_data
              const isExcelImport = rawData?.source === 'excel_import'
              // file_type from DB ('pdf' | 'excel') or infer from URL
              const fileType = inv.file_type
                || (inv.file_url?.match(/\.(xlsx?|ods)(\?|$)/i) ? 'excel' : 'pdf')
              const isExcelFile = fileType === 'excel'
              const hasFile = !!inv.file_url
              // Display name: prefer import_filename stored in extracted_data for Excel
              const importFilename = rawData?.import_filename as string | undefined
              const storedFileName = inv.file_url?.split('/').pop()?.replace(/\?.*$/, '') || ''
              const displayName = isExcelFile
                ? (importFilename || storedFileName || `FACT ${i + 1}`)
                : (storedFileName || `FACT ${i + 1}`)

              return (
                <th key={inv.id} className="py-3 px-4 min-w-[260px]" style={{ minWidth: 260 }}>
                  <div className="text-xs text-[#5A6B5F] font-normal mb-1">FACT {i + 1}</div>
                  {/* Filename — clickable to open/download the source file */}
                  {hasFile ? (
                    <a
                      href={inv.file_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={isExcelFile ? displayName : undefined}
                      onClick={e => e.stopPropagation()}
                      title={isExcelFile ? `Descargar Excel: ${displayName}` : `Abrir factura PDF`}
                      className="flex items-center gap-1 text-[#2D3A33] text-xs font-medium truncate max-w-[230px] hover:text-[#6B8068] hover:underline transition-colors cursor-pointer"
                    >
                      {isExcelFile && <span className="flex-shrink-0 text-[10px]">📊</span>}
                      <span className="truncate">{displayName}</span>
                    </a>
                  ) : (
                    <div className="text-[#2D3A33] text-xs font-medium truncate max-w-[230px] text-ink-3">
                      {displayName}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {eco ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ok-container/400/20 text-ok text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-ok inline-block" /> {isExcelImport ? 'Excel ✓' : 'Extraído ✓'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warn-container/400/20 text-warn text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-warn inline-block" /> Sin datos
                      </span>
                    )}
                    {/* Re-escanear: solo para PDFs con IA (no para Excel) */}
                    {onRescan && hasFile && !isExcelFile && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRescan(inv) }}
                        disabled={busyRescan === inv.id}
                        title="Volver a analizar el PDF con IA y actualizar los datos"
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

// ─── PDF Generators (themeSalvia — cream/paper, salvia green, no dark mode) ──

const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function _pdfFmt(v: number, dec = 2): string {
  return v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function _buildLineSVG(points: { x: number; y: number }[], accent: string, accentDark: string, monthLabels: string[]): string {
  const W = 750, H = 280
  const pad = { top: 20, right: 20, left: 60, bottom: 40 }
  const plotH = H - pad.top - pad.bottom

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const last = points[points.length - 1], first = points[0]
  const fillD = `${pathD} L${last.x.toFixed(1)},${(pad.top + plotH).toFixed(1)} L${first.x.toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const y = pad.top + (1 - t) * plotH
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="rgba(45,58,51,0.07)" stroke-width="1"/>`
  }).join('')

  const labelIdxs = [0, Math.floor((points.length - 1) / 2), points.length - 1]
  const xLabels = labelIdxs.map(i => {
    if (!points[i] || !monthLabels[i]) return ''
    return `<text x="${points[i].x.toFixed(1)}" y="${(H - 6).toFixed(0)}" fill="#8A9A8E" font-size="9" text-anchor="middle">${monthLabels[i]}</text>`
  }).join('')

  const circles = points.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${accent}" stroke="${accentDark}" stroke-width="2"/>`
  ).join('')

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;display:block">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${gridLines}
  <path d="${fillD}" fill="url(#lg)"/>
  <path d="${pathD}" stroke="${accent}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ${circles}
  ${xLabels}
</svg>`
}

function _buildDonutSVG(segments: { label: string; value: number; color: string }[]): string {
  const total = segments.reduce((s, p) => s + p.value, 0)
  if (total <= 0) return '<svg width="200" height="200"><text x="100" y="105" text-anchor="middle" fill="#8A9A8E" font-size="11">Sin datos</text></svg>'
  const cx = 100, cy = 100, ri = 50, ro = 90
  let angle = -Math.PI / 2
  const slices: { path: string; color: string; label: string; pct: string }[] = []

  for (const seg of segments) {
    if (seg.value <= 0) continue
    const sweep = (seg.value / total) * 2 * Math.PI
    if (sweep < 0.017) { angle += sweep; continue }
    const x1 = cx + ro * Math.cos(angle), y1 = cy + ro * Math.sin(angle)
    const x2 = cx + ro * Math.cos(angle + sweep), y2 = cy + ro * Math.sin(angle + sweep)
    const ix1 = cx + ri * Math.cos(angle), iy1 = cy + ri * Math.sin(angle)
    const ix2 = cx + ri * Math.cos(angle + sweep), iy2 = cy + ri * Math.sin(angle + sweep)
    const lg = sweep > Math.PI ? 1 : 0
    const path = `M${x1.toFixed(1)},${y1.toFixed(1)} A${ro},${ro} 0 ${lg},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${ri},${ri} 0 ${lg},0 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`
    slices.push({ path, color: seg.color, label: seg.label, pct: (seg.value / total * 100).toFixed(1) })
    angle += sweep
  }

  const paths = slices.map(s => `<path d="${s.path}" fill="${s.color}"/>`).join('')
  const legend = slices.map((s, i) =>
    `<g transform="translate(0,${i * 22})">
      <rect width="10" height="10" fill="${s.color}" rx="2"/>
      <text x="15" y="9" font-size="10" fill="#5A6B5F">${s.label}: ${s.pct}%</text>
    </g>`
  ).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200" style="max-width:100%;height:auto;display:block">
  ${paths}
  <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="9" fill="#8A9A8E">TOTAL</text>
  <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="13" fill="#2D3A33" font-weight="900">${_pdfFmt(total)}</text>
  <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="9" fill="#8A9A8E">EUR</text>
  <g transform="translate(215, ${Math.max(4, (200 - slices.length * 22) / 2)})">${legend}</g>
</svg>`
}

function _pdfCss(accent: string): string {
  return `
@page { size: A4; margin: 0; }
@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #F4EEE2; color: #2D3A33; }
.page { width: 210mm; min-height: 297mm; padding: 14mm 15mm; page-break-after: always; background: #F4EEE2; display: flex; flex-direction: column; }
.page:last-child { page-break-after: auto; }
.cover { justify-content: center; align-items: center; text-align: center; gap: 12px; }
.logo { font-size: 64px; font-weight: 900; color: ${accent}; letter-spacing: -2px; }
.logo-sub { font-size: 12px; letter-spacing: 0.4em; color: #8A9A8E; text-transform: uppercase; margin-top: 4px; }
.divider { width: 80px; height: 4px; background: ${accent}; border-radius: 9999px; margin: 20px auto; }
.cover-name { font-size: 32px; font-weight: 900; color: #2D3A33; margin-bottom: 20px; }
.cups-badge { display: inline-flex; align-items: center; gap: 10px; padding: 9px 22px; border-radius: 9999px; border: 1px solid #E5DCC9; background: #FBF7EE; margin-bottom: 10px; font-size: 11px; }
.cups-label { color: #8A9A8E; letter-spacing: 0.2em; font-weight: 700; }
.cups-value { color: #2D3A33; font-weight: 700; font-family: monospace; }
.tarifa-tag { font-size: 11px; color: ${accent}; letter-spacing: 0.3em; font-weight: 700; text-transform: uppercase; }
.audit-tag { font-size: 10px; color: #8A9A8E; letter-spacing: 0.3em; margin-top: 28px; text-transform: uppercase; }
.eye { font-size: 11px; font-weight: 700; color: ${accent}; letter-spacing: 0.4em; text-transform: uppercase; margin-bottom: 5px; }
.hdg { font-size: 26px; font-weight: 900; color: #2D3A33; letter-spacing: -0.02em; margin-bottom: 20px; }
.kpi { background: #FBF7EE; border: 1px solid rgba(107,128,104,0.18); border-radius: 20px; padding: 26px 32px; text-align: center; }
.kpi-lbl { font-size: 10px; font-weight: 700; color: #8A9A8E; letter-spacing: 0.3em; text-transform: uppercase; margin-bottom: 8px; }
.kpi-val { font-size: 44px; font-weight: 900; color: #2D3A33; line-height: 1; }
.kpi-val-sm { font-size: 30px; }
.kpi-unit { font-size: 12px; color: ${accent}; font-weight: 700; letter-spacing: 0.1em; margin-top: 5px; }
.kpi-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
.period-block { background: #E0E8DC; border-radius: 14px; padding: 16px 20px; margin-top: 16px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: center; }
.period-item { text-align: center; }
.period-lbl { font-size: 9px; font-weight: 700; color: #5A6B5F; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 3px; }
.period-val { font-size: 13px; font-weight: 900; color: #2D3A33; }
.card { background: #FBF7EE; border: 1px solid #E5DCC9; border-radius: 14px; overflow: hidden; margin-top: 16px; }
.card-hd { font-size: 10px; font-weight: 700; color: ${accent}; letter-spacing: 0.3em; text-transform: uppercase; padding: 13px 18px 10px; border-bottom: 1px solid #E5DCC9; }
table { width: 100%; border-collapse: collapse; font-size: 10px; }
th { font-size: 8.5px; font-weight: 700; color: #8A9A8E; text-transform: uppercase; letter-spacing: 0.07em; padding: 7px 9px; border-bottom: 2px solid #E5DCC9; text-align: right; white-space: nowrap; }
th:first-child { text-align: left; }
td { font-size: 10px; color: #2D3A33; padding: 7px 9px; border-bottom: 1px solid rgba(229,220,201,0.35); text-align: right; }
td:first-child { font-weight: 600; text-align: left; color: #3D4E44; }
.t3 { color: #ef4444 !important; font-weight: 800 !important; background: rgba(239,68,68,0.05) !important; }
.est { color: #ca8a04 !important; }
.tot td { background: rgba(107,128,104,0.09); border-top: 2px solid #E5DCC9; font-weight: 900; color: ${accent}; font-size: 10.5px; }
.gas-tot td { background: rgba(249,115,22,0.07); border-top: 2px solid rgba(249,115,22,0.25); font-weight: 900; color: #f97316; }
.excess-box { background: #FFF9ED; border: 1px solid rgba(245,158,11,0.28); border-radius: 14px; padding: 16px 18px; margin-top: 16px; }
.excess-hd { font-size: 10px; font-weight: 700; color: #d97706; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 10px; }
.closing { justify-content: center; align-items: center; text-align: center; background: #FBF7EE; position: relative; }
.closing-box { background: #F4EEE2; border: 1px solid #E5DCC9; border-radius: 24px; padding: 44px 60px; }
.closing-logo { font-size: 52px; font-weight: 900; color: ${accent}; letter-spacing: -2px; }
.closing-contact { font-size: 13px; color: #5A6B5F; margin-top: 22px; line-height: 2.1; }
.closing-footer { font-size: 9px; color: #8A9A8E; letter-spacing: 0.2em; text-transform: uppercase; position: absolute; bottom: 14mm; left: 0; right: 0; text-align: center; }
`
}

function openElectricityPDF(params: {
  cups: string; tarifa: string; titular: string
  activePeriods: string[]
  chartData: { monthIndex: number; totalFactura: number }[]
  tableData: { mes: string; kwhByPeriod: Record<string, number>; pricesByPeriod: Record<string, number>; periodSpend: Record<string, { eur: number; isEstimated: boolean }>; totalKwh: number; avgPrice: number; totalFactura: number }[]
  summaryStats: { global: number; kwh: number; precioPromedio: number; docsCount: number }
  pieData: { label: string; value: number; color: string }[]
  averagePriceStats: { period: string; avgPrice: number }[]
  hasExcesses: boolean
  excessData: { name: string; excessAmount: number }[]
  totalExcessAmount: number
}) {
  const { cups, tarifa, titular, activePeriods, chartData, tableData, summaryStats, pieData, averagePriceStats, hasExcesses, excessData, totalExcessAmount } = params
  const ACCENT = '#6B8068', ACCENT_D = '#5A6E58'

  // Line chart coords
  const W = 750, H = 280, pad = { top: 20, right: 20, left: 60, bottom: 40 }
  const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom
  const vals = chartData.map(d => d.totalFactura)
  const maxVal = Math.max(...vals.filter(v => v > 0), 1) * 1.15
  const pts = chartData.map((d, i) => ({
    x: pad.left + (i / Math.max(chartData.length - 1, 1)) * plotW,
    y: pad.top + plotH - (d.totalFactura / maxVal) * plotH,
  }))
  const monthLabels = chartData.map(d => MONTHS_SHORT[d.monthIndex] || '')
  const lineSVG = _buildLineSVG(pts, ACCENT, ACCENT_D, monthLabels)

  // Donut with salvia palette overrides
  const pieSalvia = [
    { ...pieData[0], color: '#6B8068' },
    { ...pieData[1], color: '#A8B5C9' },
    { ...pieData[2], color: '#10b981' },
    { ...pieData[3], color: '#E8B89A' },
  ].filter(Boolean).filter(p => p?.value > 0)
  const donutSVG = _buildDonutSVG(pieSalvia)

  // Top-3 highlights
  const top3Kwh = new Set([...tableData].sort((a, b) => b.totalKwh - a.totalKwh).slice(0, 3).map(r => r.mes))
  const top3Price = new Set([...tableData].sort((a, b) => b.avgPrice - a.avgPrice).slice(0, 3).map(r => r.mes))
  const top3Eur = new Set([...tableData].sort((a, b) => b.totalFactura - a.totalFactura).slice(0, 3).map(r => r.mes))

  // Period totals
  const kwhTot: Record<string, number> = {}, eurTot: Record<string, number> = {}
  activePeriods.forEach(p => {
    kwhTot[p] = tableData.reduce((s, r) => s + (r.kwhByPeriod[p] || 0), 0)
    eurTot[p] = tableData.reduce((s, r) => s + (r.periodSpend[p]?.eur || 0), 0)
  })
  const grandKwh = tableData.reduce((s, r) => s + r.totalKwh, 0)
  const grandEur = tableData.reduce((s, r) => s + r.totalFactura, 0)

  // ── Pages ─────────────────────────────────────────────────────────────────

  const page1 = `<div class="page cover">
  <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
    <div class="logo">VOLTIS</div>
    <div class="logo-sub">Anual Economics</div>
    <div class="divider"></div>
    <div class="cover-name">${titular}</div>
    <div class="cups-badge"><span class="cups-label">CUPS</span><span style="color:#E5DCC9">·</span><span class="cups-value">${cups}</span></div>
    <div class="tarifa-tag">TARIFA ${tarifa}</div>
    <div class="audit-tag">INFORME DE AUDITORÍA ENERGÉTICA</div>
  </div>
</div>`

  const periodBlock = averagePriceStats.filter(s => s.avgPrice > 0).map(s =>
    `<div class="period-item"><div class="period-lbl">${s.period}</div><div class="period-val">${_pdfFmt(s.avgPrice, 4)} €/kWh</div></div>`
  ).join('')

  const page2 = `<div class="page">
  <div class="eye">MÉTRICAS AUDITADAS</div>
  <div class="hdg">RESULTADOS ANUALES</div>
  <div class="kpi"><div class="kpi-lbl">Facturación Global</div><div class="kpi-val">${_pdfFmt(summaryStats.global)}</div><div class="kpi-unit">EUR</div></div>
  <div class="kpi" style="margin-top:12px"><div class="kpi-lbl">Energía Total Consumida</div><div class="kpi-val">${Math.round(summaryStats.kwh).toLocaleString('es-ES')}</div><div class="kpi-unit">kWh</div></div>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-lbl">Precio Promedio</div><div class="kpi-val kpi-val-sm">${_pdfFmt(summaryStats.precioPromedio, 4)}</div><div class="kpi-unit">EUR/kWh</div></div>
    <div class="kpi"><div class="kpi-lbl">Documentos Procesados</div><div class="kpi-val kpi-val-sm">${summaryStats.docsCount}</div><div class="kpi-unit">FACTURAS</div></div>
  </div>
  ${periodBlock ? `<div class="period-block"><div class="period-item" style="margin-right:16px"><div class="period-lbl" style="font-size:9px">PRECIO MEDIO POR PERIODO</div></div>${periodBlock}</div>` : ''}
</div>`

  const desgloseLegend = pieSalvia.map(p => {
    const tot = pieSalvia.reduce((s, x) => s + (x?.value || 0), 0)
    const pct = tot > 0 ? (((p?.value || 0) / tot) * 100).toFixed(1) : '0.0'
    return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
      <div style="width:11px;height:11px;border-radius:3px;background:${p?.color};flex-shrink:0"></div>
      <div><div style="font-size:10px;font-weight:700;color:#2D3A33">${p?.label}</div>
      <div style="font-size:9px;color:#8A9A8E">${_pdfFmt(p?.value || 0)} € · ${pct}%</div></div>
    </div>`
  }).join('')

  const page3 = `<div class="page">
  <div class="eye">ANÁLISIS TEMPORAL + BIO-ESTRUCTURA</div>
  <div class="hdg">EVOLUCIÓN DEL GASTO</div>
  <div class="card"><div class="card-hd">EVOLUCIÓN GASTO MENSUAL (€)</div><div style="padding:16px">${lineSVG}</div></div>
  <div style="margin-top:14px;display:grid;grid-template-columns:280px 1fr;gap:14px;align-items:start">
    <div class="card"><div class="card-hd">DISTRIBUCIÓN</div><div style="padding:14px">${donutSVG}</div></div>
    <div class="card" style="align-self:stretch;padding:16px"><div style="font-size:10px;font-weight:700;color:#8A9A8E;letter-spacing:0.2em;margin-bottom:14px">DESGLOSE POR CATEGORÍA</div>${desgloseLegend}</div>
  </div>
</div>`

  const kwhRows = tableData.map(r => {
    const c = top3Kwh.has(r.mes) ? ' class="t3"' : ''
    const cells = activePeriods.map(p => {
      const v = r.kwhByPeriod[p] || 0
      return `<td${c}>${v > 0 ? Math.round(v).toLocaleString('es-ES') : '—'}</td>`
    }).join('')
    return `<tr><td${c}>${r.mes}</td>${cells}<td${c} style="font-weight:800">${Math.round(r.totalKwh).toLocaleString('es-ES')}</td></tr>`
  }).join('')

  const page4 = `<div class="page">
  <div class="eye">MATRIZ ENERGÉTICA</div>
  <div class="hdg">CONSUMO POR PERIODO (kWh)</div>
  <div class="card"><table>
    <thead><tr><th style="text-align:left">MES</th>${activePeriods.map(p => `<th>${p}</th>`).join('')}<th>TOTAL kWh</th></tr></thead>
    <tbody>${kwhRows}</tbody>
    <tfoot><tr class="tot"><td>TOTAL</td>${activePeriods.map(p => `<td>${Math.round(kwhTot[p] || 0).toLocaleString('es-ES')}</td>`).join('')}<td>${Math.round(grandKwh).toLocaleString('es-ES')}</td></tr></tfoot>
  </table></div>
  <p style="font-size:9px;color:#8A9A8E;margin-top:8px">★ Top 3 meses con mayor consumo total destacados en rojo</p>
</div>`

  const priceRows = tableData.map(r => {
    const c = top3Price.has(r.mes) ? ' class="t3"' : ''
    const cells = activePeriods.map(p => {
      const v = r.pricesByPeriod[p] || 0
      const hasK = (r.kwhByPeriod[p] || 0) > 0
      return `<td${c}>${hasK && v > 0 ? _pdfFmt(v, 4) : '—'}</td>`
    }).join('')
    return `<tr><td${c}>${r.mes}</td>${cells}<td${c} style="font-weight:800">${r.avgPrice > 0 ? _pdfFmt(r.avgPrice, 4) : '—'}</td></tr>`
  }).join('')

  const page5 = `<div class="page">
  <div class="eye">MATRIZ DE COSTE</div>
  <div class="hdg">PRECIO UNITARIO POR PERIODO (€/kWh)</div>
  <div class="card"><table>
    <thead><tr><th style="text-align:left">MES</th>${activePeriods.map(p => `<th>${p}</th>`).join('')}<th>PRECIO MEDIO</th></tr></thead>
    <tbody>${priceRows}</tbody>
  </table></div>
  <p style="font-size:9px;color:#8A9A8E;margin-top:8px">Precios netos (con descuento aplicado) · 4 decimales · — = sin consumo en ese periodo</p>
</div>`

  const eurRows = tableData.map(r => {
    const c = top3Eur.has(r.mes) ? ' class="t3"' : ''
    const cells = activePeriods.map(p => {
      const ps = r.periodSpend[p]
      if (!ps || ps.eur <= 0) return '<td>—</td>'
      return `<td class="${top3Eur.has(r.mes) ? 't3' : ''} ${ps.isEstimated ? 'est' : ''}">${_pdfFmt(ps.eur)}</td>`
    }).join('')
    return `<tr><td${c}>${r.mes}</td>${cells}<td${c} style="font-weight:800">${_pdfFmt(r.totalFactura)}</td></tr>`
  }).join('')

  const excessHTML = hasExcesses ? `
  <div class="excess-box">
    <div class="excess-hd">⚡ SEGUIMIENTO DE EXCESOS DE POTENCIA</div>
    <table>
      <thead><tr><th style="text-align:left">MES</th><th>IMPORTE EXCESO</th></tr></thead>
      <tbody>${excessData.map(r => `<tr><td>${r.name}</td><td style="color:#d97706;font-weight:700">${_pdfFmt(r.excessAmount)} €</td></tr>`).join('')}</tbody>
      <tfoot><tr><td style="font-weight:900;color:#d97706">TOTAL EXCESOS</td><td style="font-weight:900;color:#d97706;text-align:right">${_pdfFmt(totalExcessAmount)} €</td></tr></tfoot>
    </table>
    <p style="font-size:9px;color:#8A9A8E;margin-top:8px">⚠ Se recomienda revisar la potencia contratada — los excesos generan penalizaciones en factura</p>
  </div>` : ''

  const page6 = `<div class="page">
  <div class="eye">MATRIZ ECONÓMICA INTEGRAL</div>
  <div class="hdg">COSTE POR PERIODO (€)</div>
  <div class="card"><table>
    <thead><tr><th style="text-align:left">MES</th>${activePeriods.map(p => `<th>${p}</th>`).join('')}<th>TOTAL €</th></tr></thead>
    <tbody>${eurRows}</tbody>
    <tfoot><tr class="tot"><td>TOTAL</td>${activePeriods.map(p => `<td>${_pdfFmt(eurTot[p] || 0)}</td>`).join('')}<td>${_pdfFmt(grandEur)}</td></tr></tfoot>
  </table></div>
  <p style="font-size:9px;color:#ca8a04;margin-top:8px">Valores en amarillo = estimados (kWh × precio medio, sin precio unitario disponible)</p>
  ${excessHTML}
</div>`

  const page7 = `<div class="page closing">
  <div class="closing-box">
    <div class="closing-logo">VOLTIS</div>
    <div class="closing-contact">
      <div>admin@voltisenergia.com</div>
      <div>747 47 43 60</div>
      <div>www.voltisenergia.com</div>
    </div>
  </div>
  <div class="closing-footer">VOLTIS · INFORME ECONÓMICO ANUAL</div>
</div>`

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Anual Economics — ${titular}</title>
<style>${_pdfCss(ACCENT)}</style></head><body>
${page1}${page2}${page3}${page4}${page5}${page6}${page7}
</body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Activa las ventanas emergentes para generar el PDF'); return }
  w.document.open(); w.document.write(html); w.document.close()
  setTimeout(() => w.print(), 800)
}

function openGasPDF(params: {
  supplyName: string; tariff: string
  tableData: { mes: string; tarifa: string; kwh: number; m3: number; factor: number; precioKwh: number; precioEstimated: boolean; terminoFijo: number; impuesto: number; alquiler: number; iva: number; total: number; monthIndex: number }[]
  summaryStats: { totalKwh: number; totalEur: number; avgPrice: number; adjustedCount: number }
  pieData: { label: string; value: number; color: string }[]
}) {
  const { supplyName, tariff, tableData, summaryStats, pieData } = params
  const ACCENT = '#f97316', ACCENT_D = '#ea580c'

  // Line chart from monthly totals
  const W = 750, H = 280, pad = { top: 20, right: 20, left: 60, bottom: 40 }
  const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom
  const byMonth: Record<number, number> = {}
  tableData.forEach(r => { byMonth[r.monthIndex] = (byMonth[r.monthIndex] || 0) + r.total })
  const allPts = Array.from({ length: 12 }, (_, i) => ({ monthIndex: i, val: byMonth[i] || 0 }))
  const maxVal = Math.max(...allPts.map(p => p.val), 1) * 1.15
  const pts = allPts.map((d, i) => ({
    x: pad.left + (i / 11) * plotW,
    y: pad.top + plotH - (d.val / maxVal) * plotH,
  }))
  const monthLabels = allPts.map(d => MONTHS_SHORT[d.monthIndex] || '')
  const lineSVG = _buildLineSVG(pts, ACCENT, ACCENT_D, monthLabels)
  const donutSVG = _buildDonutSVG(pieData.filter(p => p.value > 0))

  const page1 = `<div class="page cover">
  <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
    <div class="logo" style="color:#f97316">VOLTIS</div>
    <div class="logo-sub">INFORME DE GAS</div>
    <div class="divider" style="background:#f97316"></div>
    <div class="cover-name">${supplyName}</div>
    <div class="tarifa-tag" style="color:#f97316">TARIFA ${tariff}</div>
    <div class="audit-tag">INFORME DE AUDITORÍA ENERGÉTICA — GAS NATURAL</div>
  </div>
</div>`

  const page2 = `<div class="page">
  <div class="eye" style="color:#f97316">MÉTRICAS AUDITADAS — GAS</div>
  <div class="hdg">RESULTADOS ANUALES</div>
  <div class="kpi"><div class="kpi-lbl">Consumo Total Gas</div><div class="kpi-val">${Math.round(summaryStats.totalKwh).toLocaleString('es-ES')}</div><div class="kpi-unit" style="color:#f97316">kWh</div></div>
  <div class="kpi" style="margin-top:12px"><div class="kpi-lbl">Facturación Global</div><div class="kpi-val">${_pdfFmt(summaryStats.totalEur)}</div><div class="kpi-unit" style="color:#f97316">EUR</div></div>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-lbl">Precio Medio</div><div class="kpi-val kpi-val-sm">${_pdfFmt(summaryStats.avgPrice, 4)}</div><div class="kpi-unit" style="color:#f97316">EUR/kWh</div></div>
    <div class="kpi"><div class="kpi-lbl">Facturas con Ajuste</div><div class="kpi-val kpi-val-sm">${summaryStats.adjustedCount}</div><div class="kpi-unit" style="color:#f97316">DOCS</div></div>
  </div>
</div>`

  const desgloseLegend = pieData.filter(p => p.value > 0).map(p => {
    const tot = pieData.reduce((s, x) => s + x.value, 0)
    const pct = tot > 0 ? ((p.value / tot) * 100).toFixed(1) : '0.0'
    return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
      <div style="width:11px;height:11px;border-radius:3px;background:${p.color};flex-shrink:0"></div>
      <div><div style="font-size:10px;font-weight:700;color:#2D3A33">${p.label}</div>
      <div style="font-size:9px;color:#8A9A8E">${_pdfFmt(p.value)} € · ${pct}%</div></div>
    </div>`
  }).join('')

  const page3 = `<div class="page">
  <div class="eye" style="color:#f97316">ANÁLISIS TEMPORAL</div>
  <div class="hdg">EVOLUCIÓN DEL CONSUMO</div>
  <div class="card"><div class="card-hd" style="color:#f97316">EVOLUCIÓN GASTO MENSUAL (€)</div><div style="padding:16px">${lineSVG}</div></div>
  <div style="margin-top:14px;display:grid;grid-template-columns:280px 1fr;gap:14px;align-items:start">
    <div class="card"><div class="card-hd" style="color:#f97316">DISTRIBUCIÓN</div><div style="padding:14px">${donutSVG}</div></div>
    <div class="card" style="align-self:stretch;padding:16px"><div style="font-size:10px;font-weight:700;color:#8A9A8E;letter-spacing:0.2em;margin-bottom:14px">DESGLOSE POR CATEGORÍA</div>${desgloseLegend}</div>
  </div>
</div>`

  const gasRows = tableData.map(r =>
    `<tr>
      <td style="text-align:left">${r.mes}${r.kwh === 0 ? '' : (r.precioEstimated ? ' <span style="color:#facc15;font-size:7px">●</span>' : '')}</td>
      <td style="text-align:center;color:#f97316">${r.tarifa || '—'}</td>
      <td>${r.kwh > 0 ? Math.round(r.kwh).toLocaleString('es-ES') : '—'}</td>
      <td>${r.m3 > 0 ? r.m3.toLocaleString('es-ES') : '—'}</td>
      <td>${r.factor > 0 ? r.factor.toFixed(4) : '—'}</td>
      <td class="${r.precioEstimated ? 'est' : ''}">${r.precioKwh > 0 ? _pdfFmt(r.precioKwh, 4) : '—'}</td>
      <td>${r.terminoFijo > 0 ? _pdfFmt(r.terminoFijo) : '—'}</td>
      <td>${r.impuesto > 0 ? _pdfFmt(r.impuesto) : '—'}</td>
      <td>${r.alquiler > 0 ? _pdfFmt(r.alquiler) : '—'}</td>
      <td>${r.iva > 0 ? _pdfFmt(r.iva) : '—'}</td>
      <td style="font-weight:800">${_pdfFmt(r.total)}</td>
    </tr>`
  ).join('')

  const totalIva = tableData.reduce((s, r) => s + r.iva, 0)

  const page4 = `<div class="page">
  <div class="eye" style="color:#f97316">DETALLE FACTURAS GAS</div>
  <div class="hdg">TABLA DETALLADA</div>
  <div class="card"><table>
    <thead><tr>
      <th style="text-align:left">MES</th>
      <th style="text-align:center">TARIFA</th>
      <th>kWh</th><th>m3</th><th>Factor</th><th>€/kWh</th>
      <th>T.Fijo</th><th>Imp.Hidroc.</th><th>Alquiler</th><th>IVA</th><th>TOTAL €</th>
    </tr></thead>
    <tbody>${gasRows}</tbody>
    <tfoot><tr class="gas-tot">
      <td style="text-align:left">TOTAL</td>
      <td>—</td>
      <td>${Math.round(summaryStats.totalKwh).toLocaleString('es-ES')}</td>
      <td>—</td><td>—</td>
      <td>${_pdfFmt(summaryStats.avgPrice, 4)}</td>
      <td>—</td><td>—</td><td>—</td>
      <td>${totalIva > 0 ? _pdfFmt(totalIva) : '—'}</td>
      <td>${_pdfFmt(summaryStats.totalEur)}</td>
    </tr></tfoot>
  </table></div>
  <p style="font-size:9px;color:rgba(255,255,255,0.4);margin-top:8px">● Precios en amarillo son estimados · m3 es informativo · ● Puntos amarillos indican facturas con ajustes/regularizaciones</p>
</div>`

  const page5 = `<div class="page closing" style="background:#FBF7EE">
  <div class="closing-box">
    <div class="closing-logo" style="color:#f97316">VOLTIS</div>
    <div class="closing-contact">
      <div>admin@voltisenergia.com</div>
      <div>747 47 43 60</div>
      <div>www.voltisenergia.com</div>
    </div>
  </div>
  <div class="closing-footer">VOLTIS · INFORME GAS NATURAL</div>
</div>`

  const css = _pdfCss(ACCENT)
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Informe Gas — ${supplyName}</title>
<style>${css}</style></head><body>
${page1}${page2}${page3}${page4}${page5}
</body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Activa las ventanas emergentes para generar el PDF'); return }
  w.document.open(); w.document.write(html); w.document.close()
  setTimeout(() => w.print(), 800)
}

// ─── Helpers: 2.0TD Comparison ───────────────────────────────────────────────

/** Extract current power €/kW·día prices from the most recent invoice with potencia data */
function extractCurrentPowerPrices(invoices: InvoiceRow[]): { P1: number; P2: number } {
  const sorted = [...invoices].sort((a, b) => {
    const d = (inv: InvoiceRow) => (inv.extracted_data as any)?.billing_period_end
      || (inv.extracted_data as any)?.fecha_fin || (inv.extracted_data as any)?.invoice_date || ''
    return d(b).localeCompare(d(a))
  })

  const normPeriod = (raw: any): string | null => {
    const s = String(raw || '').trim()
    const m = s.match(/(?:P|[Pp]er[íi]odo\s*)?([1-6])$/i)
    return m ? `P${m[1]}` : null
  }

  // Returns all economics sub-objects from ALL known storage paths for an invoice.
  // Checked in order: extracted_data.economics, economics_data, invoice_json.economics,
  // extracted_data (top-level fallback for older records).
  const getEcoSources = (inv: InvoiceRow): any[] => {
    const ed  = inv.extracted_data as any
    const emd = inv.economics_data  as any
    const ij  = (inv as any).invoice_json
    return [
      ed?.economics,
      emd?.economics ?? (Array.isArray(emd?.potencia) ? emd : null),
      ij?.economics,
      ed,   // top-level extracted_data (older records store potencia[] here directly)
    ].filter(Boolean)
  }

  for (const inv of sorted) {
    const prices: Record<string, number> = {}

    for (const eco of getEcoSources(inv)) {
      // ── Path A: potencia[] array ─────────────────────────────────────────────
      const potArr: any[] = Array.isArray(eco?.potencia) ? eco.potencia : []
      for (const item of potArr) {
        const p = normPeriod(item.periodo)
        if (!p || !['P1', 'P2', 'P3'].includes(p)) continue
        let price = Number(item.precioKwDia) || Number(item.precioKw) || Number(item.precioUnitario) || 0
        if (!price) {
          const kw   = Number(item.kw)   || 0
          const dias = Number(item.dias) || 0
          const tot  = Number(item.total) || 0
          if (kw > 0 && dias > 0 && tot > 0) price = tot / (kw * dias)
        }
        if (price > 0 && price < 5) prices[p] = price
      }

      // ── Path B: rawLineItems fallback ────────────────────────────────────────
      if (!prices.P1 && !prices.P2 && !prices.P3) {
        const rawItems: any[] = Array.isArray(eco?.rawLineItems) ? eco.rawLineItems : []
        const potCats = ['potencia_peaje', 'potencia_cargo', 'potencia_comercializacion']
        for (const item of rawItems) {
          const cat = String(item.category || '').toLowerCase()
          if (!potCats.includes(cat)) continue
          const p = normPeriod(item.periodo)
          if (!p || !['P1', 'P2', 'P3'].includes(p)) continue
          let price = Number(item.precioUnitario) || 0
          if (!price) {
            const kw   = Number(item.kw)   || 0
            const dias = Number(item.dias) || 0
            const tot  = Number(item.total) || 0
            if (kw > 0 && dias > 0 && tot > 0) price = tot / (kw * dias)
          }
          if (price > 0 && price < 5) prices[p] = (prices[p] || 0) + price
        }
      }

      // Found data in this source — no need to try further sources
      if (prices.P1 || prices.P2 || prices.P3) break
    }

    if (prices.P1 || prices.P2 || prices.P3) {
      const p1 = prices.P1 || 0
      // 2.0TD: off-peak is P3 in SIPS but P2 in Voltis model. Fall back: P3 → P2 → P1.
      const p2 = prices.P2 > 0 ? prices.P2 : (prices.P3 > 0 ? prices.P3 : p1)
      return { P1: p1, P2: p2 }
    }
  }

  // No fallback: prices must come from actual invoice/Excel data.
  return { P1: 0, P2: 0 }
}

/**
 * Build the 2.0TD comparison PDF — replicates the Excel template layout exactly.
 * Same 18-column × 33-row grid, merged cells (colspan), colors and structure as
 * the Excel generated by /api/comparativa-2td.  Calls window.print() to save as PDF.
 */
function open2TDComparisonPDF(params: {
  titular: string; cups: string; tariffKey: VoltisKey2TD
  consumo: { P1: number; P2: number; P3: number }
  potencia: { P1: number; P2: number; P3?: number }
  /** Per-period energy prices weighted-averaged per invoice */
  currentEnergyPrices: { P1: number; P2: number; P3: number }
  currentPowerP1: number; currentPowerP2: number
  energyPricingFormat?: string
  isIndexed?: boolean
}) {
  const { titular, cups, tariffKey, consumo, potencia, currentEnergyPrices, currentPowerP1, currentPowerP2, energyPricingFormat, isIndexed } = params
  const tariff = VOLTIS_TARIFFS_2TD[tariffKey]
  const f = (v: number, d = 2) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })

  // ── Valley power: prefer SIPS P3 (same logic as comparativa-2td API) ──────
  const valleKw = (potencia.P3 ?? 0) > 0.1 ? potencia.P3!
    : potencia.P2 > 0.1                     ? potencia.P2
    : potencia.P1

  // ── Energy prices: same 3-case logic as comparativa-2td API ───────────────
  const flatPrice = (() => {
    const totalKwhAll = consumo.P1 + consumo.P2 + consumo.P3
    if (totalKwhAll > 0) {
      return (consumo.P1 * currentEnergyPrices.P1 +
              consumo.P2 * currentEnergyPrices.P2 +
              consumo.P3 * currentEnergyPrices.P3) / totalKwhAll
    }
    return (currentEnergyPrices.P1 + currentEnergyPrices.P2 + currentEnergyPrices.P3) / 3
  })()

  let ep: { P1: number; P2: number; P3: number }
  if (isIndexed || energyPricingFormat === 'indexado') {
    ep = { P1: flatPrice, P2: flatPrice, P3: flatPrice }
  } else if (energyPricingFormat === 'por_periodo') {
    ep = { P1: currentEnergyPrices.P1, P2: currentEnergyPrices.P2, P3: currentEnergyPrices.P3 }
  } else {
    ep = { P1: flatPrice, P2: flatPrice, P3: flatPrice }
  }

  // ── Pre-compute same values as the Excel ──────────────────────────────────
  const H7  = potencia.P1 * currentPowerP1 * 365
  const I7  = valleKw * currentPowerP2 * 365
  const K7  = (H7 + I7) * 1.21
  const H14 = potencia.P1 * tariff.power.P1 * 365
  const I14 = valleKw * tariff.power.P2 * 365
  const K14 = (H14 + I14) * 1.21
  const N10 = K7 - K14
  const M10 = N10 / 12

  const totalKwh = consumo.P1 + consumo.P2 + consumo.P3
  const J27 = consumo.P1 * ep.P1
  const K27 = consumo.P2 * ep.P2
  const L27 = consumo.P3 * ep.P3
  const N26 = (J27 + K27 + L27) * 1.21
  const J33 = consumo.P1 * tariff.energy.P1
  const K33 = consumo.P2 * tariff.energy.P2
  const L33 = consumo.P3 * tariff.energy.P3
  const N33 = (J33 + K33 + L33) * 1.21
  const Q30 = N26 - N33
  const P30 = Q30 / 12
  const Q16 = M10 + P30
  const R16 = N10 + Q30

  // Colors matching the Excel template
  const SD = '#17375E'  // salviaDark
  const SV = '#31849B'  // salvia
  const SS = '#B7DEE8'  // salviaSoft
  const powCol  = N10 >= 0 ? '#375623' : '#9C0006'
  const powBg   = N10 >= 0 ? '#C6EFCE' : '#FFC7CE'
  const eneCol  = Q30 >= 0 ? '#375623' : '#9C0006'
  const eneBg   = Q30 >= 0 ? '#C6EFCE' : '#FFC7CE'
  const totCol  = R16 >= 0 ? '#375623' : '#9C0006'

  // ── Cell builders ──────────────────────────────────────────────────────────
  // Build a <td> with optional colspan and inline styles
  const cell = (
    content: string,
    cs: number,
    styles: string,
  ) => `<td colspan="${cs}" style="${styles}">${content}</td>`

  // Empty cell(s) — transparent, just spacing
  const em = (cs = 1) => `<td colspan="${cs}"></td>`

  // Shared base style for all cells
  const base = 'font-family:Arial,sans-serif;border:1px solid #000;vertical-align:middle;overflow:hidden;padding:1px 3px;'

  // Typed cell shortcut
  const C = (content: string, cs: number, extra = '') =>
    cell(content, cs, base + extra)

  // ── Column widths (proportional to Excel widths A–R) ─────────────────────
  // Excel widths: A=10 B=12 C=15 D=13 E=12 F=13.16 G=12 H=12 I=12.5 J=12 K=12 L=12 M=14.5 N=13 O=13 P=13 Q=20 R=18
  const colW = [10,12,15,13,12,13.16,12,12,12.5,12,12,12,14.5,13,13,13,20,18]
  const tot  = colW.reduce((s,c) => s+c, 0)
  const cg   = `<colgroup>${colW.map(w=>`<col style="width:${(w/tot*100).toFixed(2)}%">`).join('')}</colgroup>`

  // ── Row heights (Excel pts → CSS pt) ─────────────────────────────────────
  const rh = [22,14,20,18,22,24,22,18,24,24,18,22,24,22,18,30,12,22,10,10,12,22,22,26,26,24,24,22,24,28,12,24,22]
  const H  = (i: number) => `height:${rh[i]}pt;`

  // ── Build each of the 33 rows ─────────────────────────────────────────────

  // Row 1: section title A-D | empty E-M | VOLTIS N-P | titular Q-R
  const r1 = `<tr style="${H(0)}">
    ${C('CALCULADORA DIFERENCIA POTENCIAS 2.0TD',4,`background:${SD};color:#fff;font-weight:bold;font-size:9pt;text-align:center;white-space:normal;`)}
    ${em(9)}
    ${C('VOLTIS',3,`background:${SD};color:#fff;font-weight:bold;font-size:17pt;text-align:center;`)}
    ${C(titular.toUpperCase(),2,`background:${SD};color:#fff;font-weight:bold;font-size:9pt;text-align:center;white-space:normal;`)}
  </tr>`

  // Row 2: empty A-M | energía N-P | cups Q-R
  const r2 = `<tr style="${H(1)}">
    ${em(13)}
    ${C('energía',3,`background:${SS};color:${SV};font-style:italic;font-size:13pt;text-align:center;`)}
    ${C(cups,2,`background:#fff;color:#808080;font-style:italic;font-size:7pt;text-align:center;`)}
  </tr>`

  // Row 3: empty A-P | otros cargos Q | alquiler R
  const r3 = `<tr style="${H(2)}">
    ${em(13)}
    ${C(tariff.name.toUpperCase(),3,`background:${SS};color:#404040;font-weight:bold;font-size:7pt;text-align:center;`)}
    ${C('OTROS CARGOS:',1,`color:#404040;font-weight:bold;font-size:7pt;text-align:right;`)}
    ${C('ALQUILER DE EQUIPOS',1,`background:#fff;font-weight:bold;font-size:7pt;text-align:center;white-space:normal;`)}
  </tr>`

  // Row 4: empty A-G | ANUALMENTE H | empty I-J | IVA INCL. K | empty L-Q | IMP. ELÉCTRICO R
  const r4 = `<tr style="${H(3)}">
    ${em(7)}
    ${C('ANUALMENTE',1,`color:#404040;font-weight:bold;font-size:8pt;text-align:center;`)}
    ${em(2)}
    ${C('IVA INCL.',1,`color:#404040;font-weight:bold;font-size:8pt;text-align:center;`)}
    ${em(6)}
    ${C('IMP. ELÉCTRICO',1,`color:#404040;font-weight:bold;font-size:8pt;text-align:center;`)}
  </tr>`

  // Row 5: ACTUAL A | empty B-R
  const r5 = `<tr style="${H(4)}">
    ${C('ACTUAL',1,`background:#404040;color:#fff;font-weight:bold;font-size:11pt;text-align:center;`)}
    ${em(17)}
  </tr>`

  // Row 6: empty A | p1/p3 B-C | empty D | p1/p3 E-F | empty G | p1/p3 H-I | empty J | TOTAL: K | empty L-R
  const r6 = `<tr style="${H(5)}">
    ${em(1)}
    ${C('p1',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('p3',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('p1',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('p3',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('p1',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('p3',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('TOTAL:',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(7)}
  </tr>`

  // Row 7: empty A | potP1/P2 B-C | empty D | prices E-F | empty G | annual H-I | empty J | total K | empty L | POR POTENCIA: M-N | empty O-R
  const r7 = `<tr style="${H(6)}">
    ${em(1)}
    ${C(f(potencia.P1,3),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(valleKw,3),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(currentPowerP1,6),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(currentPowerP2,6),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(H7,2),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(I7,2),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(K7,2),1,`font-weight:bold;font-size:10pt;text-align:center;background:#fff;`)}
    ${em(1)}
    ${C('POR POTENCIA:',2,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 8: empty A-L | MENSUAL M | ANUAL N | empty O-R
  const r8 = `<tr style="${H(7)}">
    ${em(12)}
    ${C('MENSUAL',1,`color:#404040;font-weight:bold;font-size:9pt;text-align:center;`)}
    ${C('ANUAL',1,`color:#404040;font-weight:bold;font-size:9pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 9: empty A-L | DIFERENCIA M-N | empty O-R
  const r9 = `<tr style="${H(8)}">
    ${em(12)}
    ${C('DIFERENCIA',1,`color:${SD};font-weight:bold;font-size:9pt;text-align:center;`)}
    ${C('DIFERENCIA',1,`color:${SD};font-weight:bold;font-size:9pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 10: empty A-L | M10 M | N10 N (colored) | empty O-R
  const r10 = `<tr style="${H(9)}">
    ${em(12)}
    ${C(f(M10,2)+' €',1,`background:${powBg};color:${powCol};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(N10,2)+' €',1,`background:${powBg};color:${powCol};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 11: empty A-G | ANUALMENTE H | empty I-J | IVA INCL. K | empty L-R
  const r11 = `<tr style="${H(10)}">
    ${em(7)}
    ${C('ANUALMENTE',1,`color:#404040;font-weight:bold;font-size:8pt;text-align:center;`)}
    ${em(2)}
    ${C('IVA INCL.',1,`color:#404040;font-weight:bold;font-size:8pt;text-align:center;`)}
    ${em(7)}
  </tr>`

  // Row 12: NUEVO A | empty B-R
  const r12 = `<tr style="${H(11)}">
    ${C('NUEVO',1,`background:${SV};color:#fff;font-weight:bold;font-size:11pt;text-align:center;`)}
    ${em(17)}
  </tr>`

  // Row 13: same layout as row 6 but teal colors
  const r13 = `<tr style="${H(12)}">
    ${em(1)}
    ${C('p1',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('p3',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('p1',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('p3',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('p1',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('p3',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('TOTAL:',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(7)}
  </tr>`

  // Row 14: same as row 7 but NUEVO prices + TOTAL AHORRO ESTIMADO Q-R
  const r14 = `<tr style="${H(13)}">
    ${em(1)}
    ${C(f(potencia.P1,3),1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(valleKw,3),1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(tariff.power.P1,6),1,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(tariff.power.P2,6),1,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(H14,2),1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(I14,2),1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(K14,2),1,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(5)}
    ${C('TOTAL AHORRO ESTIMADO:',2,`background:${SD};color:#fff;font-weight:bold;font-size:11pt;text-align:center;`)}
  </tr>`

  // Row 15: empty A-I | 365 J | empty K-P | MENSUAL Q | ANUAL R
  const r15 = `<tr style="${H(14)}">
    ${em(9)}
    ${C('365',1,`color:#808080;font-size:9pt;text-align:center;`)}
    ${em(6)}
    ${C('MENSUAL',1,`background:#fff;font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C('ANUAL',1,`background:#fff;font-weight:bold;font-size:10pt;text-align:center;`)}
  </tr>`

  // Row 16: empty A-P | Q16 Q | R16 R (volt green)
  const r16 = `<tr style="${H(15)}">
    ${em(16)}
    ${C(f(Q16,2)+' €',1,`background:#C6EFCE;color:${totCol};font-weight:bold;font-size:14pt;text-align:center;`)}
    ${C(f(R16,2)+' €',1,`background:#C6EFCE;color:${totCol};font-weight:bold;font-size:14pt;text-align:center;`)}
  </tr>`

  // Row 17: spacer
  const r17 = `<tr style="${H(16)}">${em(18)}</tr>`

  // Row 18: section title A-D | empty E-R
  const r18 = `<tr style="${H(17)}">
    ${C('CALCULADORA DIFERENCIA ENERGIA 2.0TD',4,`background:${SD};color:#fff;font-weight:bold;font-size:9pt;text-align:center;white-space:normal;`)}
    ${em(14)}
  </tr>`

  // Rows 19–21: spacers
  const r19 = `<tr style="${H(18)}">${em(18)}</tr>`
  const r20 = `<tr style="${H(19)}">${em(18)}</tr>`
  const r21 = `<tr style="${H(20)}">${em(18)}</tr>`

  // Row 22: empty A | CONSUMO ANUAL KWH B-C | empty D-R
  const r22 = `<tr style="${H(21)}">
    ${em(1)}
    ${C('CONSUMO ANUAL KWH',2,`background:${SV};color:#fff;font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(15)}
  </tr>`

  // Row 23: empty A | totalKwh B-C | empty D-M | IVA INCL. N | empty O-R
  const r23 = `<tr style="${H(22)}">
    ${em(1)}
    ${C(Math.round(totalKwh).toLocaleString('es-ES'),2,`background:#fff;font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(10)}
    ${C('IVA INCL.',1,`color:#808080;font-size:8pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 24: empty A-I | ESTA FACTURA: J | empty K-R
  const r24 = `<tr style="${H(23)}">
    ${em(9)}
    ${C('ESTA FACTURA:',1,`color:#404040;font-weight:bold;font-size:7pt;text-align:center;white-space:normal;`)}
    ${em(8)}
  </tr>`

  // Row 25: CONSUMO A | empty B-E | Precio actual: F | empty G-M | TOTAL: N | empty O-R
  const r25 = `<tr style="${H(24)}">
    ${C('CONSUMO',1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(4)}
    ${C('Precio actual:',1,`color:#404040;font-size:8pt;text-align:center;white-space:normal;`)}
    ${em(7)}
    ${C('TOTAL:',1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 26: empty A-I | P1/P2/P3 J-L | empty M | N26 N | empty O-R
  const r26 = `<tr style="${H(25)}">
    ${em(9)}
    ${C('P1',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P2',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P3',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C(f(N26,2)+' €',1,`background:#fff;font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 27: empty A | P1/P2/P3 B-D | empty E | P1/P2/P3 F-H | empty I | J27/K27/L27 J-L | empty M-O | POR ENERGIA: P-Q | empty R
  const r27 = `<tr style="${H(26)}">
    ${em(1)}
    ${C('P1',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P2',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P3',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('P1',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P2',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P3',1,`font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C(f(J27,2),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(K27,2),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(L27,2),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(3)}
    ${C('POR ENERGIA:',2,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
  </tr>`

  // Row 28: empty A | consumos B-D | empty E | prices F-H | empty I-O | MENSUAL P | ANUAL Q | empty R
  const r28 = `<tr style="${H(27)}">
    ${em(1)}
    ${C(Math.round(consumo.P1).toLocaleString('es-ES'),1,`font-weight:bold;font-size:9pt;text-align:center;`)}
    ${C(Math.round(consumo.P2).toLocaleString('es-ES'),1,`font-weight:bold;font-size:9pt;text-align:center;`)}
    ${C(Math.round(consumo.P3).toLocaleString('es-ES'),1,`font-weight:bold;font-size:9pt;text-align:center;`)}
    ${em(1)}
    ${C(f(ep.P1,4),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(ep.P2,4),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(ep.P3,4),1,`font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(7)}
    ${C('MENSUAL',1,`color:#404040;font-weight:bold;font-size:9pt;text-align:center;`)}
    ${C('ANUAL',1,`color:#404040;font-weight:bold;font-size:9pt;text-align:center;`)}
    ${em(1)}
  </tr>`

  // Row 29: empty A-O | DIFERENCIA P-Q | empty R
  const r29 = `<tr style="${H(28)}">
    ${em(15)}
    ${C('DIFERENCIA',1,`color:${SD};font-weight:bold;font-size:9pt;text-align:center;`)}
    ${C('DIFERENCIA',1,`color:${SD};font-weight:bold;font-size:9pt;text-align:center;`)}
    ${em(1)}
  </tr>`

  // Row 30: empty A-E | Precio Nuevo: F | empty G-I | NUEVA FACTURA: J | empty K-M | IVA INCL. N | empty O | P30 P | Q30 Q | empty R
  const r30 = `<tr style="${H(29)}">
    ${em(5)}
    ${C('Precio Nuevo:',1,`color:${SD};font-weight:bold;font-size:8pt;text-align:center;white-space:normal;`)}
    ${em(3)}
    ${C('NUEVA FACTURA:',1,`color:${SD};font-weight:bold;font-size:7pt;text-align:center;white-space:normal;`)}
    ${em(3)}
    ${C('IVA INCL.',1,`color:#808080;font-size:8pt;text-align:center;`)}
    ${em(1)}
    ${C(f(P30,2)+' €',1,`background:${eneBg};color:${eneCol};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(Q30,2)+' €',1,`background:${eneBg};color:${eneCol};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
  </tr>`

  // Row 31: spacer
  const r31 = `<tr style="${H(30)}">${em(18)}</tr>`

  // Row 32: empty A-E | P1/P2/P3 F-H | empty I | P1/P2/P3 J-L | empty M | TOTAL: N | empty O-R
  const r32 = `<tr style="${H(31)}">
    ${em(5)}
    ${C('P1',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P2',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P3',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('P1',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P2',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${C('P3',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(1)}
    ${C('TOTAL:',1,`color:${SD};font-weight:bold;font-size:12pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  // Row 33: empty A-E | Voltis prices F-H | empty I | per-period costs J-L | empty M | total N | empty O-R
  const r33 = `<tr style="${H(32)}">
    ${em(5)}
    ${C(f(tariff.energy.P1,4),1,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(tariff.energy.P2,4),1,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(tariff.energy.P3,4),1,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(J33,2),1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(K33,2),1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${C(f(L33,2),1,`color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(1)}
    ${C(f(N33,2)+' €',1,`background:${SS};color:${SD};font-weight:bold;font-size:10pt;text-align:center;`)}
    ${em(4)}
  </tr>`

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Comparativa 2.0TD — ${titular}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page { size:A4 landscape; margin:8mm; }
  body { font-family:Arial,sans-serif; font-size:9pt; background:#fff; }
  table { border-collapse:collapse; width:100%; table-layout:fixed; }
  td { border:1px solid #000; vertical-align:middle; padding:1px 3px; overflow:hidden; font-size:9pt; }
</style>
</head><body>
<table>${cg}<tbody>
${r1}${r2}${r3}${r4}${r5}${r6}${r7}${r8}${r9}${r10}
${r11}${r12}${r13}${r14}${r15}${r16}${r17}${r18}${r19}${r20}
${r21}${r22}${r23}${r24}${r25}${r26}${r27}${r28}${r29}${r30}
${r31}${r32}${r33}
</tbody></table>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Activa las ventanas emergentes para generar el PDF'); return }
  w.document.open(); w.document.write(html); w.document.close()
  setTimeout(() => w.print(), 800)
}

// ─── Gas Report View ────────────────────────────────────────────────────────

function GasReportView({ invoices, supplyName, onBack, gasHistory }: {
  invoices: InvoiceRow[]
  supplyName?: string
  onBack: () => void
  gasHistory?: GasHistoryPeriod[]
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

      const gc = (eco as any).gasConsumption as any
      return {
        id: inv.id, monthIndex: month, yearIndex: year,
        mes: year > 0 ? `${CANONICAL_MONTHS_FULL[month]?.toUpperCase() || '—'} ${year}` : '—',
        tarifa: (eco as any).tarifaRL || eco.tarifa || inv.extracted_data?.tariff || '—',
        kwh, costeBruto: eco.costeBrutoConsumo || 0,
        descuentoEnergia: eco.descuentoEnergia || 0,
        costeNeto: energyNet,
        precioKwh: eco.costeMedioKwhNeto || eco.costeMedioKwh || (gp.precioKwh) || (kwh > 0 ? energyNet / kwh : 0),
        precioEstimated: gp.precioKwhEstimated || false,
        m3: gc?.m3 || 0,
        factor: gc?.factorConversion || 0,
        iva,
        terminoFijo, impuesto, alquiler, total: eur,
      }
    }).sort((a, b) => ((a.yearIndex ?? 0) * 12 + a.monthIndex) - ((b.yearIndex ?? 0) * 12 + b.monthIndex))

    // avgPrice always from last 12 invoices (most recent), not the full history
    const last12Gas = tData.slice(-12)
    const last12GasKwh = last12Gas.reduce((s, r) => s + r.kwh, 0)
    const last12GasNet = last12Gas.reduce((s, r) => s + r.costeNeto, 0)
    const avgPrice = last12GasKwh > 0 ? last12GasNet / last12GasKwh : (totalKwh > 0 ? totalEnergyNet / totalKwh : 0)

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

  // Build chart arrays from gasHistory (if available & richer) or tableData
  // Uses sequential bars (one per period) to avoid cross-year calendar-month collisions
  const gasChartKwh = useMemo(() => {
    const history = gasHistory && gasHistory.length > 0 ? gasHistory : null
    const invoiceMonthCount = new Set(tableData.map(r => r.monthIndex)).size

    if (history && history.length > invoiceMonthCount) {
      // Take last 12 periods sorted chronologically — one bar per period
      const last12 = [...history]
        .sort((a, b) => new Date(a.fechaInicio).getTime() - new Date(b.fechaInicio).getTime())
        .slice(-12)
      return last12.map((p, i) => {
        const d = new Date(p.fechaFin || p.fechaInicio)
        let label: string
        if (isNaN(d.getTime())) {
          label = `P${i + 1}`
        } else {
          const mes = d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')
          const mesCapital = mes.charAt(0).toUpperCase() + mes.slice(1)
          const anyo = String(d.getFullYear()).slice(2)
          label = `${mesCapital} ${anyo}`
        }
        return { label, totalKwh: p.kwh, billsCount: 1, monthIndex: i }
      })
    }

    // Fallback: use invoice tableData grouped by calendar month
    const months = CANONICAL_MONTHS.map((label, i) => ({ label, totalKwh: 0, billsCount: 0, monthIndex: i }))
    tableData.forEach(row => {
      if (row.monthIndex >= 0 && row.monthIndex < 12) {
        months[row.monthIndex].totalKwh += row.kwh
        months[row.monthIndex].billsCount++
      }
    })
    return months
  }, [tableData, gasHistory])

  const gasChartEur = useMemo(() => {
    const months = CANONICAL_MONTHS.map((label, i) => ({ label, totalKwh: 0, billsCount: 0, monthIndex: i }))
    tableData.forEach(row => {
      if (row.monthIndex >= 0 && row.monthIndex < 12) {
        months[row.monthIndex].totalKwh += row.total
        months[row.monthIndex].billsCount++
      }
    })
    return months
  }, [tableData])

  const [gasChartMode, setGasChartMode] = useState<'kwh' | 'eur'>('kwh')

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
              <p className="text-[10px] font-bold tracking-[0.2em] mb-1" style={{ color: '#8A9A8E' }}>{kpi.label}</p>
              <p className="text-2xl font-black tabular-nums text-[#2D3A33]">{kpi.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Cost distribution pie */}
        {pieData.length > 0 && (
          <div className="rounded-2xl p-6" style={glassStyle}>
            <h3 className="text-xs font-bold tracking-[0.2em] mb-6" style={{ color: '#8A9A8E' }}>DISTRIBUCIÓN DE COSTES</h3>
            <div className="flex flex-wrap items-center justify-center gap-8">
              {pieData.map((item, i) => {
                const pct = summaryStats.totalEur > 0 ? (item.value / summaryStats.totalEur * 100) : 0
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ background: item.color }} />
                    <div>
                      <p className="text-sm font-bold text-[#2D3A33]">{item.label}</p>
                      <p className="text-xs" style={{ color: '#8A9A8E' }}>{item.value.toFixed(2)} € ({pct.toFixed(1)}%)</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Toggle chart: kWh / € */}
        {(gasChartKwh.some(m => m.totalKwh > 0) || gasChartEur.some(m => m.totalKwh > 0)) && (
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="rounded-2xl p-6" style={glassStyle}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xs font-bold tracking-[0.2em]" style={{ color: '#8A9A8E' }}>
                {gasChartMode === 'kwh' ? 'CONSUMO MENSUAL (kWh)' : 'GASTO MENSUAL (€)'}
              </h3>
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: '#E5DCC9' }}>
                <button
                  onClick={() => setGasChartMode('kwh')}
                  className="px-3 py-1.5 text-[11px] font-bold tracking-wider transition"
                  style={{
                    background: gasChartMode === 'kwh' ? '#f97316' : 'transparent',
                    color: gasChartMode === 'kwh' ? '#fff' : '#8A9A8E',
                  }}
                >kWh</button>
                <button
                  onClick={() => setGasChartMode('eur')}
                  className="px-3 py-1.5 text-[11px] font-bold tracking-wider transition"
                  style={{
                    background: gasChartMode === 'eur' ? '#fbbf24' : 'transparent',
                    color: gasChartMode === 'eur' ? '#fff' : '#8A9A8E',
                  }}
                >€</button>
              </div>
            </div>
            <SVGBarChartKwh
              data={gasChartMode === 'kwh' ? gasChartKwh : gasChartEur}
              color={gasChartMode === 'kwh' ? '#f97316' : '#fbbf24'}
            />
          </motion.div>
        )}

        {/* Gas invoices table */}
        <div className="rounded-2xl overflow-hidden" style={glassStyle}>
          <h3 className="text-xs font-bold tracking-[0.2em] px-6 pt-5 pb-3" style={{ color: '#8A9A8E' }}>FACTURAS DE GAS</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="font-bold tracking-wider" style={{ borderBottom: '1px solid #E5DCC9', color: '#8A9A8E' }}>
                  <th className="px-4 py-3 text-left">MES</th>
                  <th className="px-3 py-3 text-center">TARIFA</th>
                  <th className="px-3 py-3 text-right">KWH</th>
                  <th className="px-3 py-3 text-right">BRUTO EN.</th>
                  <th className="px-3 py-3 text-right">DESC. EN.</th>
                  <th className="px-3 py-3 text-right text-warn">NETO EN.</th>
                  <th className="px-3 py-3 text-right">€/KWH</th>
                  <th className="px-3 py-3 text-right">T. FIJO</th>
                  <th className="px-3 py-3 text-right">IMP.</th>
                  <th className="px-3 py-3 text-right">ALQUILER</th>
                  <th className="px-4 py-3 text-right">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, idx) => (
                  <tr key={idx} className="transition-colors hover:bg-[#F0EAD8]" style={{ borderBottom: '1px solid #F0EAD8' }}>
                    <td className="px-4 py-3 font-bold text-[#2D3A33]">{row.mes}</td>
                    <td className="px-3 py-3 text-center text-warn font-bold">{row.tarifa}</td>
                    <td className="px-3 py-3 text-right font-mono text-[#2D3A33]">{row.kwh.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-3 text-right font-mono" style={{ color: '#6B7F6A' }}>{row.costeBruto.toFixed(2)}€</td>
                    <td className="px-3 py-3 text-right font-mono text-ok">{row.descuentoEnergia > 0 ? `-${row.descuentoEnergia.toFixed(2)}€` : '—'}</td>
                    <td className="px-3 py-3 text-right font-mono text-warn font-bold">{row.costeNeto.toFixed(2)}€</td>
                    <td className={`px-3 py-3 text-right font-mono ${row.precioEstimated ? 'text-yellow-600' : 'text-[#4A5E47]'}`}>
                      {row.precioKwh > 0 ? row.precioKwh.toFixed(4) : '—'}
                      {row.precioEstimated && <span className="block text-[8px] leading-none" style={{ color: '#8A9A8E' }}>est.</span>}
                    </td>
                    <td className="px-3 py-3 text-right" style={{ color: '#8A9A8E' }}>{row.terminoFijo > 0 ? `${row.terminoFijo.toFixed(2)}€` : '—'}</td>
                    <td className="px-3 py-3 text-right" style={{ color: '#8A9A8E' }}>{row.impuesto > 0 ? `${row.impuesto.toFixed(2)}€` : '—'}</td>
                    <td className="px-3 py-3 text-right" style={{ color: '#8A9A8E' }}>{row.alquiler > 0 ? `${row.alquiler.toFixed(2)}€` : '—'}</td>
                    <td className="px-4 py-3 text-right font-black text-[#2D3A33] bg-[#E0E8DC]">{row.total.toFixed(2)}€</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-bold text-[11px]" style={{ borderTop: '2px solid #D9D0BA', background: '#F4EEE2' }}>
                <tr>
                  <td className="px-4 py-4 uppercase font-black italic text-[#2D3A33]">TOTAL</td>
                  <td className="px-3 py-4 text-center" style={{ color: '#8A9A8E' }}>{summaryStats.tariff}</td>
                  <td className="px-3 py-4 text-right tabular-nums font-black text-[#2D3A33]">{summaryStats.totalKwh.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td>
                  <td className="px-3 py-4 text-right tabular-nums" style={{ color: '#6B7F6A' }}>
                    {tableData.reduce((s, r) => s + r.costeBruto, 0).toFixed(2)}€
                  </td>
                  <td className="px-3 py-4 text-right tabular-nums text-ok">
                    {tableData.reduce((s, r) => s + r.descuentoEnergia, 0) > 0
                      ? `-${tableData.reduce((s, r) => s + r.descuentoEnergia, 0).toFixed(2)}€` : '—'}
                  </td>
                  <td className="px-3 py-4 text-right tabular-nums text-warn font-black">{summaryStats.totalEnergyNet.toFixed(2)}€</td>
                  <td className="px-3 py-4 text-right tabular-nums text-[#2D3A33]">{summaryStats.avgPrice.toFixed(4)}</td>
                  <td className="px-3 py-4 text-right tabular-nums" style={{ color: '#8A9A8E' }}>{summaryStats.totalTerminoFijo.toFixed(2)}€</td>
                  <td className="px-3 py-4 text-right tabular-nums" style={{ color: '#8A9A8E' }}>{summaryStats.totalImpuesto.toFixed(2)}€</td>
                  <td className="px-3 py-4 text-right tabular-nums" style={{ color: '#8A9A8E' }}>{summaryStats.totalAlquiler.toFixed(2)}€</td>
                  <td className="px-4 py-4 text-right tabular-nums font-black text-[#2D3A33] bg-[#D4E0CF]">{summaryStats.totalEur.toFixed(2)}€</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* PDF Button — Gas */}
        <div className="flex flex-col items-center gap-3 py-12">
          <button
            onClick={() => openGasPDF({ supplyName: supplyName || 'SUMINISTRO', tariff: summaryStats.tariff, tableData, summaryStats, pieData })}
            className="flex items-center gap-2 px-10 py-4 rounded-full text-sm font-black tracking-widest uppercase transition hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #ea580c, #f97316)', boxShadow: '0 20px 40px -10px rgba(249,115,22,0.3)', color: '#FBF7EE' }}>
            <Download className="w-4 h-4" /> GENERAR PDF
          </button>
          <p className="text-[#8A9A8E] text-xs text-center max-w-xs">Se abrirá en nueva pestaña — selecciona «Guardar como PDF» en el diálogo de impresión</p>
        </div>
      </div>
    </div>
  )
}

// ─── Report View ─────────────────────────────────────────────────────────────

function ReportView({ invoices, supplyName, onBack, onInvoicesUpdated, potenciaContratada, consumoPeriodos, initialYear, maximetroHistory, sipsHistory }: {
  invoices: InvoiceRow[]
  supplyName?: string
  onBack: () => void
  onInvoicesUpdated: () => void
  potenciaContratada?: Record<string, number>
  consumoPeriodos?: Record<string, number>
  initialYear?: number | 'all'
  maximetroHistory?: any[]
  sipsHistory?: any[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(initialYear ?? 'all')
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
  const [dragAnchor, setDragAnchor] = useState<number | null>(null)
  // Keyboard state lives in a ref to avoid stale closures in the keydown listener
  const kbRef = useRef<{
    phase: 'anchor' | 'swipe'
    anchor: number        // 0-indexed month, -1 = none
    buf: string           // digit buffer for multi-digit months (10/11/12)
    lastKey: number       // last digit pressed in swipe phase, -1 = first
    timer: ReturnType<typeof setTimeout> | null
  }>({ phase: 'anchor', anchor: -1, buf: '', lastKey: -1, timer: null })
  const [showAvgPriceModal, setShowAvgPriceModal] = useState(false)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)         // Modal 1: Bill breakdown (Matrix 3)
  const [selectedPriceBillId, setSelectedPriceBillId] = useState<string | null>(null) // Modal 2: Price calc (Matrix 2)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [show2TDModal, setShow2TDModal] = useState(false)
  const [downloading2TD, setDownloading2TD] = useState<VoltisKey2TD | null>(null)
  const [elecChartMode, setElecChartMode] = useState<'eur' | 'kwh'>('eur')
  const [showPowerAdjust, setShowPowerAdjust] = useState(false)
  const [adjustedPotencia, setAdjustedPotencia] = useState<Record<string, number> | null>(null)
  const [powerAdjustInputs, setPowerAdjustInputs] = useState<Record<string, string>>({})
  const toggleReveal = (id: string) => setRevealedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const openComparativa2TD = () => {
    const deviations = getMaximetroDeviations(maximetroHistory, potenciaContratada)
    if (deviations.length > 0 && !adjustedPotencia) {
      // Pre-fill inputs with contracted values
      const inputs: Record<string, string> = {}
      const periods = ['P1','P2','P3','P4','P5','P6']
      periods.forEach(p => {
        const v = potenciaContratada?.[p]
        if (v && v > 0) inputs[p] = String(v)
      })
      setPowerAdjustInputs(inputs)
      setShowPowerAdjust(true)
    } else {
      setShow2TDModal(true)
    }
  }

  const isAnnual = selectedMonths.size === 12

  // Change year: reset months to all when year changes
  const selectYearInReport = (yr: number | 'all') => {
    setSelectedYear(yr)
    setSelectedMonths(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
  }

  const toggleMonth = (monthIdx: number) => {
    setSelectedMonths(prev => {
      const next = new Set(prev)
      if (next.has(monthIdx)) { if (next.size > 1) next.delete(monthIdx) }
      else { next.add(monthIdx) }
      return next
    })
  }

  const selectAllMonths = () => setSelectedMonths(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))

  // ── Drag-to-select range on month buttons ─────────────────────────────────
  const applyRange = (a: number, b: number) => {
    const lo = Math.min(a, b); const hi = Math.max(a, b)
    startTransition(() => setSelectedMonths(new Set(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k))))
  }

  const handleMonthMouseDown = (i: number, e: React.MouseEvent) => {
    e.preventDefault()           // prevent text selection during drag
    setDragAnchor(i)
    startTransition(() => setSelectedMonths(new Set([i])))
  }

  const handleMonthMouseEnter = (i: number) => {
    if (dragAnchor === null) return
    applyRange(dragAnchor, i)
  }

  // End drag on mouseup anywhere (including outside buttons)
  useEffect(() => {
    const onUp = () => setDragAnchor(null)
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // ── Keyboard range selection ──────────────────────────────────────────────
  // Phase 1 – ANCHOR: first key(s) set the boundary month.
  //   Digits 2–9 → single-digit month; digit 1 waits for a 2nd digit (10/11/12) or swipe.
  // Phase 2 – SWIPE: subsequent keys indicate direction only:
  //   ascending  (each key > previous) → select anchor … December (anchor is range START)
  //   descending (each key < previous) → select January … anchor  (anchor is range END)
  // Resets after 1.5 s of inactivity or on any non-digit key.
  //
  // Examples:
  //   "5" "8" "7" "6" "5" → anchor=5(May), descending → Jan–May
  //   "6" "7" "8" "9"     → anchor=6(Jun), ascending  → Jun–Dec
  //   "1" "0" "4" "5" "6" → anchor=10(Oct), ascending → Oct–Dec
  useEffect(() => {
    const kb = kbRef.current

    const resetKb = () => {
      if (kb.timer) clearTimeout(kb.timer)
      kb.phase = 'anchor'; kb.anchor = -1; kb.buf = ''; kb.lastKey = -1; kb.timer = null
    }
    const bump = () => {
      if (kb.timer) clearTimeout(kb.timer)
      kb.timer = setTimeout(resetKb, 1500)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') { resetKb(); return }

      const d = parseInt(e.key, 10)
      if (isNaN(d)) { resetKb(); return }

      if (kb.phase === 'anchor') {
        const newBuf = kb.buf + e.key
        const month = parseInt(newBuf, 10)

        if (month < 1 || month > 12) {
          // e.g., buf="1" and now "3" → "13" invalid.
          // Treat current digit as first swipe key with anchor already set from buf.
          if (kb.anchor >= 0) {
            kb.phase = 'swipe'; kb.lastKey = d; bump()
          } else { resetKb() }
          return
        }

        kb.buf = newBuf
        kb.anchor = month - 1          // 0-indexed
        startTransition(() => setSelectedMonths(new Set([month - 1])))

        // Confirm anchor immediately for digits 2-9 (single-digit months).
        // For digit 1: stay in anchor phase one more keypress (to catch 10/11/12).
        if (d >= 2 || newBuf.length >= 2) {
          kb.phase = 'swipe'
          // Seed lastKey with the anchor's month number (1-indexed) so the very
          // first swipe key can determine direction without needing a second one.
          // e.g. anchor=Sep(9) → lastKey=9; press "8" → 8<9 → descending → Jan–Sep ✓
          kb.lastKey = kb.anchor + 1
        }

      } else {
        // SWIPE phase: only direction matters
        // "0" is treated as 10 (October) — pressing 0 after e.g. "9" means ascending toward Oct
        const swipeVal = (d === 0) ? 10 : d
        if (kb.lastKey >= 0 && kb.anchor >= 0) {
          if (swipeVal > kb.lastKey) {
            // Ascending → anchor is the START, extend to December
            startTransition(() => setSelectedMonths(new Set(Array.from({ length: 12 - kb.anchor }, (_, k) => kb.anchor + k))))
          } else if (swipeVal < kb.lastKey) {
            // Descending → anchor is the END, extend back to January
            startTransition(() => setSelectedMonths(new Set(Array.from({ length: kb.anchor + 1 }, (_, k) => k))))
          }
        }
        kb.lastKey = swipeVal
      }

      bump()
    }

    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (kb.timer) clearTimeout(kb.timer) }
  }, []) // stable: kbRef is a ref, setSelectedMonths is stable

  // Touch support: find which button is under the finger and extend the range
  const handleMonthTouchStart = (i: number, e: React.TouchEvent) => {
    e.preventDefault()
    setDragAnchor(i)
    startTransition(() => setSelectedMonths(new Set([i])))
  }

  const handleMonthTouchMove = (e: React.TouchEvent) => {
    if (dragAnchor === null) return
    const touch = e.touches[0]
    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    const btn = el?.closest('[data-month-idx]') as HTMLElement | null
    if (!btn) return
    const idx = parseInt(btn.dataset.monthIdx ?? '', 10)
    if (!isNaN(idx)) applyRange(dragAnchor, idx)
  }

  // Invoices with usable data vs without
  const validInvoices = useMemo(() => invoices.filter(hasUsableData), [invoices])
  const invalidInvoices = useMemo(() => invoices.filter(inv => !hasUsableData(inv)), [invoices])

  // Available years across all valid invoices (for year pills inside the report)
  const availableYears = useMemo(() => {
    const yrs = new Set<number>()
    validInvoices.forEach(inv => {
      const { start, end } = getInvoiceDates(inv)
      const { year } = getAssignedMonth(start, end)
      if (year > 0) yrs.add(year)
    })
    return Array.from(yrs).sort()
  }, [validInvoices])

  // Which months actually have data for the selected year (for highlighting month selector)
  const monthsWithData = useMemo(() => {
    const months = new Set<number>()
    const yearBase = selectedYear === 'all'
      ? validInvoices
      : validInvoices.filter(inv => {
          const { start, end } = getInvoiceDates(inv)
          return getAssignedMonth(start, end).year === selectedYear
        })
    yearBase.forEach(inv => {
      const { start, end } = getInvoiceDates(inv)
      const { month } = getAssignedMonth(start, end)
      if (month >= 0 && month <= 11) months.add(month)
    })
    return months
  }, [validInvoices, selectedYear])

  // Filtered invoices by selected year AND selected months
  const filteredInvoices = useMemo(() => {
    let base = validInvoices
    if (selectedYear !== 'all') {
      base = base.filter(inv => {
        const { start, end } = getInvoiceDates(inv)
        return getAssignedMonth(start, end).year === selectedYear
      })
    }
    return base.filter(inv => {
      const { start, end } = getInvoiceDates(inv)
      const { month } = getAssignedMonth(start, end)
      return selectedMonths.has(month)
    })
  }, [validInvoices, selectedYear, selectedMonths])

  // Supply info — computed early so useMemo below can use activePeriods
  const firstEco = validInvoices.length > 0 ? getEco(validInvoices[0]) : null
  const firstEd = validInvoices[0]?.extracted_data
  const cups = firstEco?.cups || firstEd?.cups || '—'
  const tarifa = firstEco?.tarifa || firstEd?.tariff || '—'
  const titular = firstEco?.titular || (firstEd?.holder_name as string) || supplyName || 'PROYECTO'

  // Energy consumption periods (used for kWh/€ matrices and price stats).
  // 2.0TD: P1+P2+P3 | 3.0TD: P1-P3 | 6.xTD: P1-P6
  const activePeriods = getActiveConsumoPeriods(tarifa !== '—' ? tarifa : null)

  // All computed data
  const { chartData, pieData, summaryStats, tableData, excessData, totalExcessAmount, hasExcesses, averagePriceStats } = useMemo(() => {
    // ── Year-only filter for the bar chart (shows all 12 month buckets of the selected year) ──
    const yearFilteredInvoices = selectedYear === 'all'
      ? validInvoices
      : validInvoices.filter(inv => {
          const { start, end } = getInvoiceDates(inv)
          return getAssignedMonth(start, end).year === selectedYear
        })

    const allMonthly = getMonthlyAggregatedData(yearFilteredInvoices)
    const cData = allMonthly.map(m => ({
      ...m,
      totalFactura: selectedMonths.has(m.monthIndex) ? m.totalFactura : 0,
      energia: selectedMonths.has(m.monthIndex) ? m.energia : 0,
      potencia: selectedMonths.has(m.monthIndex) ? m.potencia : 0,
      otros: selectedMonths.has(m.monthIndex) ? m.otros : 0,
      totalKwh: selectedMonths.has(m.monthIndex) ? m.totalKwh : 0,
      billsCount: selectedMonths.has(m.monthIndex) ? m.billsCount : 0,
    }))

    // Preliminary avg price from cData for estimated period prices inside tData
    const prelimKwh = cData.reduce((s, m) => s + m.totalKwh, 0)
    const prelimEnergy = cData.reduce((s, m) => s + m.energia, 0)
    const avgEnergyPrice = prelimKwh > 0 ? prelimEnergy / prelimKwh : 0

    const tData = filteredInvoices.map(inv => {
      const eco = getEco(inv)!
      const { start, end } = getInvoiceDates(inv)
      const { month, year } = getAssignedMonth(start, end)
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
        id: inv.id, mes: mesLabel, monthIndex: month, yearIndex: year, totalKwh, avgPrice, totalFactura,
        kwhByPeriod, pricesByPeriod, periodSpend,
        eco, inv, // keep refs for modals
        energia, potencia, impuestos, otrosTotal,
        fileName: inv.file_url?.split('/').pop() || inv.id.slice(0, 8),
      }
    }).sort((a, b) => ((a.yearIndex ?? 0) * 12 + a.monthIndex) - ((b.yearIndex ?? 0) * 12 + b.monthIndex))

    // ── Totals from tData (year+month filtered) so KPIs match the selection ──
    const totals = {
      energetic: tData.reduce((s, r) => s + r.energia, 0),
      power: tData.reduce((s, r) => s + r.potencia, 0),
      global: tData.reduce((s, r) => s + r.totalFactura, 0),
      kwh: tData.reduce((s, r) => s + r.totalKwh, 0),
      others: tData.reduce((s, r) => s + r.otrosTotal, 0),
    }

    // Pie chart from filtered totals
    const pData = [
      { label: 'CONSUMO ENERGÍA', value: totals.energetic, color: '#3b82f6' },
      { label: 'POTENCIA', value: totals.power, color: '#8b5cf6' },
      { label: 'IMPUESTOS Y OTROS', value: totals.others, color: '#10b981' },
      { label: 'OTROS', value: Math.max(0, totals.global - totals.energetic - totals.power - totals.others), color: '#f59e0b' },
    ]

    // PRECIO PROMEDIO from the filtered range
    const filteredKwh = totals.kwh
    const filteredEnergy = totals.energetic
    const precioPromedioGlobal = filteredKwh > 0 ? filteredEnergy / filteredKwh : 0
    const precioPromedio = precioPromedioGlobal

    // Per-period average price stats (for Modal 3) — from the filtered range
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
  }, [validInvoices, filteredInvoices, selectedYear, selectedMonths, activePeriods])

  const avgPriceAll = tableData.length > 0 ? tableData.reduce((s, r) => s + r.avgPrice, 0) / tableData.length : 0

  // SIPS official annual kWh (sum of consumoPeriodos from the grid operator).
  // Only shown as reference — all calculations (price averages, monthly means, etc.)
  // continue to use the actual invoice data.
  const sipsTotalKwh = useMemo(() => {
    if (!consumoPeriodos) return null
    const total = Object.values(consumoPeriodos as Record<string, number>)
      .reduce((a, b) => a + (Number(b) || 0), 0)
    return total > 0 ? Math.round(total) : null
  }, [consumoPeriodos])

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

  // ── Canonical 12-month grid for matrices ─────────────────────────────────────
  // Both the kWh matrix and € matrix always show the same months (the full range
  // covered by the invoices + any missing months as empty rows). This ensures
  // the two tables are always perfectly aligned.
  // For the kWh matrix: months without invoices are filled from SIPS history.
  const canonicalMatrixRows = useMemo(() => {
    if (tableData.length === 0) return []

    // Find min/max year-month index from invoice data
    const ymValues = tableData.map(r => (r.yearIndex ?? 0) * 12 + r.monthIndex)
    const minYM = Math.min(...ymValues)
    const maxYM = Math.max(...ymValues)

    // Map invoice rows by year-month key
    const rowMap = new Map(tableData.map(r => [`${r.yearIndex ?? 0}-${r.monthIndex}`, r]))

    // Build SIPS monthly history map (year-month → kWh total)
    const sipsHistMap = new Map<string, number>()
    if (sipsHistory?.length) {
      for (const entry of sipsHistory) {
        const raw = entry.fechaInicio || entry.date || entry.periodo || entry.start
        if (!raw) continue
        const d = new Date(raw)
        if (isNaN(d.getTime())) continue
        const key = `${d.getFullYear()}-${d.getMonth()}`
        sipsHistMap.set(key, (sipsHistMap.get(key) || 0) + (Number(entry.kwh) || 0))
      }
    }

    const emptyPeriods = Object.fromEntries(activePeriods.map(p => [p, 0]))
    const emptySpend = Object.fromEntries(activePeriods.map(p => [p, { eur: 0, isEstimated: false }]))

    const rows: (typeof tableData[0] & { isSipsOnly: boolean; sipsKwh: number })[] = []

    for (let ym = minYM; ym <= maxYM; ym++) {
      const year = Math.floor(ym / 12)
      const month = ym % 12
      const key = `${year}-${month}`
      const existing = rowMap.get(key)

      if (existing) {
        rows.push({ ...existing, isSipsOnly: false, sipsKwh: 0 })
      } else {
        // Month in range but no invoice — fill kWh from SIPS history if available
        const sipsKwh = sipsHistMap.get(key) || 0
        const mesLabel = `${CANONICAL_MONTHS_FULL[month]?.toUpperCase() ?? '—'} ${year}`
        rows.push({
          id: `empty-${key}`,
          mes: mesLabel,
          monthIndex: month,
          yearIndex: year,
          totalKwh: sipsKwh,
          kwhByPeriod: { ...emptyPeriods },
          pricesByPeriod: { ...emptyPeriods },
          periodSpend: { ...emptySpend } as any,
          totalFactura: 0,
          avgPrice: 0,
          energia: 0,
          potencia: 0,
          impuestos: 0,
          otrosTotal: 0,
          fileName: '',
          eco: null,
          inv: null,
          isSipsOnly: true,
          sipsKwh,
        } as any)
      }
    }
    return rows
  }, [tableData, sipsHistory, activePeriods])

  // ── 2.0TD Comparison data ───────────────────────────────────────────────────
  const is2TD = is2TDTariff(tarifa !== '—' ? tarifa : null)

  const effectivePotencia = adjustedPotencia ?? potenciaContratada
  const comp2TDData = useMemo(() => {
    if (!is2TD || !consumoPeriodos || !effectivePotencia) return null
    const consumoP1 = Number(consumoPeriodos.P1) || 0
    const consumoP2 = Number(consumoPeriodos.P2) || 0
    const consumoP3 = Number(consumoPeriodos.P3) || 0
    // SIPS para 2.0TD puede devolver la potencia valle en P2, P3 o incluso P4-P6.
    // Algunos distribuidores solo populan P1 en el endpoint /info — usamos el primer
    // valor no-cero de P2..P6, y si todos son 0 usamos P1 como fallback (contrato
    // con la misma potencia en todos los periodos, habitual en 2.0TD residencial).
    const pc = effectivePotencia as any
    const potP1 = Number(pc.P1) || 0
    // For 2.0TD: SIPS always stores punta in P1 and valle in P3.
    // Use P3 directly; only fall back to scanning P2/P4-P6 (≥0.1 kW) if P3 is missing,
    // and use P1 as last resort. This matches the comparativa-2td API's valleKw logic.
    const potP3sips = Number(pc.P3) || 0
    const potP2 = potP3sips > 0.1 ? potP3sips
      : (['P2', 'P4', 'P5', 'P6'] as const).map(k => Number(pc[k]) || 0).find(v => v >= 0.1)
      ?? potP1
    if (!consumoP1 && !consumoP2 && !consumoP3) return null

    // ── Compute per-period weighted average energy prices ──────────────────
    // Aggregate kWh × price per period across all invoices to get accurate
    // per-period prices (handles Caso 2 = por_periodo, Caso 3 = promocionadas,
    // and Caso 4 = indexed tariff detection).
    const periodWsum: Record<string, number> = { P1: 0, P2: 0, P3: 0 }
    const periodKwh:  Record<string, number> = { P1: 0, P2: 0, P3: 0 }
    const periodPrices: number[][] = { P1: [], P2: [], P3: [] } as any

    // Always use last 12 invoices (most recent) for comparativa price calculation
    const last12ForStudy = [...validInvoices].sort((a, b) => {
      const { start: sa, end: ea } = getInvoiceDates(a)
      const { start: sb, end: eb } = getInvoiceDates(b)
      const { month: ma, year: ya } = getAssignedMonth(sa, ea)
      const { month: mb, year: yb } = getAssignedMonth(sb, eb)
      return (ya * 12 + ma) - (yb * 12 + mb)
    }).slice(-12)

    for (const inv of last12ForStudy) {
      // Check all known data paths — use the first one that has consumo[] with data.
      // Order: extracted_data.economics → economics_data → invoice_json.economics → extracted_data (top-level)
      const ed  = inv.extracted_data as any
      const emd = inv.economics_data  as any
      const ij  = (inv as any).invoice_json
      const ecoSources: any[] = [
        ed?.economics,
        Array.isArray(emd?.consumo) ? emd : emd?.economics,
        ij?.economics,
        ed,
      ].filter(v => v && Array.isArray(v?.consumo) && v.consumo.length > 0)
      const eco = ecoSources[0]
      if (!eco?.consumo?.length) continue

      for (const c of eco.consumo) {
        const p = c.periodo as 'P1' | 'P2' | 'P3'
        if (!['P1', 'P2', 'P3'].includes(p)) continue
        const kwh = Number(c.kwh) || 0
        if (kwh <= 0) continue
        const precio = Number(c.precioKwh) || 0
        const total  = Number(c.total) || 0
        if (precio > 0) {
          // PDF/OCR invoices: explicit unit price
          periodWsum[p] += kwh * precio
          periodKwh[p]  += kwh
          ;(periodPrices as any)[p].push(precio)
        } else if (total > 0) {
          // Excel imports: precioKwh=0 but total (€) per period is stored
          periodWsum[p] += total
          periodKwh[p]  += kwh
          ;(periodPrices as any)[p].push(total / kwh)
        }
      }
    }

    // Weighted average per period.
    // Primary: c.precioKwh (PDF invoices) or c.total/c.kwh (Excel imports).
    // Fallback A: averagePriceStats per period.
    // Fallback B: global average precio promedio.
    const fallbackPrice = summaryStats.precioPromedio
    const avgStatP1 = averagePriceStats.find(s => s.period === 'P1')?.avgPrice || 0
    const avgStatP2 = averagePriceStats.find(s => s.period === 'P2')?.avgPrice || 0
    const avgStatP3 = averagePriceStats.find(s => s.period === 'P3')?.avgPrice || 0
    const priceP1 = periodKwh.P1 > 0 ? periodWsum.P1 / periodKwh.P1 : (avgStatP1 || fallbackPrice)
    const priceP2 = periodKwh.P2 > 0 ? periodWsum.P2 / periodKwh.P2 : (avgStatP2 || fallbackPrice)
    const priceP3 = periodKwh.P3 > 0 ? periodWsum.P3 / periodKwh.P3 : (avgStatP3 || fallbackPrice)

    // ── Caso 4 detection: indexed tariff ──────────────────────────────────
    // If prices for the SAME period vary significantly across invoices (>10% spread),
    // the client is on an indexed (PVPC-like) tariff.
    const isIndexed = (['P1', 'P2', 'P3'] as const).some(p => {
      const prices = (periodPrices as any)[p] as number[]
      if (prices.length < 2) return false
      const avg = prices.reduce((s, v) => s + v, 0) / prices.length
      const spread = (Math.max(...prices) - Math.min(...prices)) / avg
      return spread > 0.10  // >10% variation = indexed
    })

    // Detect energyPricingFormat from the majority of invoices
    const formats = validInvoices.map(inv => {
      const ed  = inv.extracted_data as any
      const emd = inv.economics_data  as any
      const ij  = (inv as any).invoice_json
      const eco = [ed?.economics, emd?.economics, ij?.economics, emd, ed]
        .find(v => v?.energyPricingFormat) as any
      return eco?.energyPricingFormat as string | undefined
    }).filter(Boolean)
    const majorityFormat = formats.length > 0
      ? formats.sort((a, b) => formats.filter(v => v === b).length - formats.filter(v => v === a).length)[0]
      : undefined

    const currentEnergyPrices = { P1: priceP1, P2: priceP2, P3: priceP3 }
    // For backward compat: single average used in the overview KPI
    const currentEnergyPrice = periodKwh.P1 + periodKwh.P2 + periodKwh.P3 > 0
      ? (periodWsum.P1 + periodWsum.P2 + periodWsum.P3) / (periodKwh.P1 + periodKwh.P2 + periodKwh.P3)
      : fallbackPrice

    const { P1: currentPowerP1, P2: currentPowerP2 } = extractCurrentPowerPrices(validInvoices)

    const consumo  = { P1: consumoP1, P2: consumoP2, P3: consumoP3 }
    // P3 is always the valle period in SIPS for 2.0TD — pass it explicitly to
    // the comparativa API so it can use it directly (P2 may be a SIPS artifact).
    const potencia = { P1: potP1, P2: potP2, P3: Number(pc.P3) || 0 }

    // For savings computation: indexed tariffs use flat weighted average (same as
    // comparativa-2td API rule for caso 3). Per-period tariffs use their actual prices.
    const ep4Savings = isIndexed
      ? { P1: currentEnergyPrice, P2: currentEnergyPrice, P3: currentEnergyPrice }
      : currentEnergyPrices

    const results = (Object.keys(VOLTIS_TARIFFS_2TD) as VoltisKey2TD[]).map(key => ({
      key,
      tariff: VOLTIS_TARIFFS_2TD[key],
      result: compute2TDSavings(consumo, potencia, ep4Savings, currentPowerP1, currentPowerP2, key),
    }))

    // Sort by best saving (highest first)
    results.sort((a, b) => b.result.savings.totalAnnual - a.result.savings.totalAnnual)

    return {
      results, consumo, potencia,
      currentEnergyPrice, currentEnergyPrices,
      currentPowerP1, currentPowerP2,
      isIndexed, energyPricingFormat: isIndexed ? 'indexado' : (majorityFormat || 'precio_unico'),
    }
  }, [is2TD, consumoPeriodos, effectivePotencia, summaryStats.precioPromedio, validInvoices, averagePriceStats])

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

        {/* Month selector (screen only) - Fixed at viewport top (portal context, no page header above) */}
        <div className="fixed top-0 inset-x-0 z-[205] flex flex-col gap-1.5 py-3 px-8 no-print"
          style={{ background: 'rgba(244,238,226,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid #E5DCC9' }}>

          {/* Year pills — only shown when there are multiple years */}
          {availableYears.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold tracking-widest text-[#8A9A8E] mr-1">AÑO</span>
              {(['all', ...availableYears] as const).map(yr => (
                <button
                  key={yr}
                  onClick={() => selectYearInReport(yr as number | 'all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    selectedYear === yr
                      ? 'bg-[#2D3A33] text-[#FBF7EE]'
                      : 'bg-[#EDE8DC] text-[#5A6B5F] hover:bg-[#E5DCC9]'
                  }`}>
                  {yr === 'all' ? 'GLOBAL' : yr}
                </button>
              ))}
              <div className="w-px h-4 bg-[#E5DCC9] mx-1" />
            </div>
          )}

          {/* Month buttons row */}
          <div className="flex items-center gap-2 flex-wrap justify-center">
          <button onClick={selectAllMonths}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${isAnnual ? 'bg-[#2D3A33] text-[#FBF7EE]' : 'bg-[#EDE8DC] text-[#5A6B5F] hover:bg-[#E5DCC9]'}`}>
            ANUAL
          </button>
          {CANONICAL_MONTHS.map((label, i) => {
            const isSelected = selectedMonths.has(i)
            const hasData = monthsWithData.has(i)
            return (
              <button
                key={i}
                data-month-idx={i}
                onMouseDown={(e) => handleMonthMouseDown(i, e)}
                onMouseEnter={() => handleMonthMouseEnter(i)}
                onTouchStart={(e) => handleMonthTouchStart(i, e)}
                onTouchMove={handleMonthTouchMove}
                onTouchEnd={() => setDragAnchor(null)}
                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                className={`w-9 h-9 rounded-xl text-xs font-medium transition select-none ${
                  dragAnchor !== null && isSelected
                    ? 'scale-110 ring-2 ring-[#6B8068]/60' : ''
                } ${
                  isSelected && hasData ? 'bg-[#6B8068] text-[#FBF7EE] shadow-lg shadow-salvia/20' :
                  isSelected && !hasData ? 'bg-[#EDE8DC] text-[#8A9A8E]' :
                  hasData ? 'bg-[#E0E8DC] text-[#6B8068] hover:bg-[#D0DCC8] border border-[#6B8068]/30' :
                  'bg-[#F4EEE2] text-[#8A9A8E] border border-[#E5DCC9]'
                }`}>
                {i + 1}
              </button>
            )
          })}
          </div>{/* end month buttons row */}
        </div>{/* end fixed top bar */}

        {/* Spacer so content isn't hidden behind the fixed header (taller when year pills show) */}
        <div className={availableYears.length > 1 ? 'h-[100px] no-print' : 'h-[68px] no-print'} />

        {/* ════════════════════════════════════════════════════════════════
            SCENE 1 — PORTADA (matches standalone exactly)
            ════════════════════════════════════════════════════════════════ */}
        <motion.div id="scene-1" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="report-page flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-8">

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
              <p className="text-[#8A9A8E] text-xs tracking-[0.3em] mb-3">
                ENERGÍA CONSUMIDA EN FACTURAS
                {summaryStats.docsCount < 12 && (
                  <span className="ml-2 text-[10px] text-warn/80">({summaryStats.docsCount} fact.)</span>
                )}
              </p>
              <p className="text-[#2D3A33] text-5xl md:text-6xl font-black">
                <CountUp value={summaryStats.kwh} decimals={0} duration={1.2} />
              </p>
              <p className="text-[#6B8068] text-sm mt-2 tracking-wider">kWh</p>
              {sipsTotalKwh && sipsTotalKwh !== Math.round(summaryStats.kwh) && (
                <div className="mt-3 pt-3 border-t border-[#6B8068]/20">
                  <p className="text-[#8A9A8E] text-[10px] tracking-widest mb-0.5">CONSUMO REAL ANUAL (SIPS)</p>
                  <p className="text-[#6B8068] text-lg font-bold">
                    {sipsTotalKwh.toLocaleString('es-ES')} kWh
                  </p>
                  <p className="text-[#8A9A8E] text-[10px] mt-0.5">12 meses completos · dato oficial</p>
                </div>
              )}
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

          {/* Bar chart — Evolución (€ / kWh toggle) */}
          <div className="mb-12">
            <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
              <div>
                <p className="text-[#6B8068] text-xs tracking-[0.4em] mb-1">ANÁLISIS TEMPORAL</p>
                <h3 className="text-3xl md:text-4xl font-black text-[#2D3A33]">
                  {elecChartMode === 'eur' ? 'EVOLUCIÓN DEL GASTO MENSUAL' : 'EVOLUCIÓN DEL CONSUMO (kWh)'}
                </h3>
              </div>
              {/* Toggle */}
              <div className="flex rounded-xl overflow-hidden border no-print" style={{ borderColor: '#E5DCC9' }}>
                <button
                  onClick={() => setElecChartMode('eur')}
                  className="px-4 py-2 text-xs font-bold transition-all"
                  style={{
                    background: elecChartMode === 'eur' ? '#6B8068' : 'transparent',
                    color: elecChartMode === 'eur' ? '#FBF7EE' : '#8A9A8E',
                  }}
                >€ Gasto</button>
                <button
                  onClick={() => setElecChartMode('kwh')}
                  className="px-4 py-2 text-xs font-bold transition-all"
                  style={{
                    background: elecChartMode === 'kwh' ? '#6B8068' : 'transparent',
                    color: elecChartMode === 'kwh' ? '#FBF7EE' : '#8A9A8E',
                  }}
                >kWh</button>
              </div>
            </div>
            <div className="rounded-2xl p-6" style={glassStyle}>
              {elecChartMode === 'eur'
                ? <SVGBarChart data={chartData} />
                : <SVGBarChartKwh data={chartData} />
              }
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
              rows={canonicalMatrixRows.map(r => ({
                mes: r.mes, periods: (r as any).kwhByPeriod as Record<string, unknown>,
                total: (r as any).totalKwh, isSipsOnly: (r as any).isSipsOnly, sipsKwh: (r as any).sipsKwh,
              }))}
              renderCell={(row, p) => {
                if ((row as any).isSipsOnly) return <span className="text-[#8A9A8E] text-sm">—</span>
                const v = row.periods[p] as number
                return v ? <span className="text-[#5A6B5F] text-sm">{fmt(v, 0)}</span> : <span className="text-[#8A9A8E] text-sm">—</span>
              }}
              renderTotal={(row) => {
                if ((row as any).isSipsOnly) {
                  const sk = (row as any).sipsKwh as number
                  return sk > 0
                    ? <span className="text-[#8A9A8E] text-xs italic">{fmt(sk, 0)} <span className="text-[10px]">SIPS</span></span>
                    : <span className="text-[#8A9A8E] text-sm">—</span>
                }
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
                  <span className="text-[#6B8068] font-black text-sm tracking-wider">TOTAL FACTURAS</span>
                  {activePeriods.map(p => {
                    const total = tableData.reduce((s, r) => s + (r.kwhByPeriod[p] || 0), 0)
                    return <span key={p} className="text-info font-bold text-sm">{total > 0 ? fmt(total, 0) : '—'}</span>
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
              rows={canonicalMatrixRows.map(r => ({
                id: (r as any).id, mes: r.mes,
                periods: (r as any).pricesByPeriod as Record<string, unknown>,
                total: (r as any).avgPrice, isSipsOnly: (r as any).isSipsOnly,
              }))}
              renderCell={(row, p) => {
                if ((row as any).isSipsOnly) return <span className="text-[#8A9A8E] text-sm">—</span>
                const v = row.periods[p] as number
                if (!v) return <span className="text-[#8A9A8E] text-sm">—</span>
                return <span className="text-[#5A6B5F] text-sm">{fmt(v, 4)}</span>
              }}
              renderTotal={(row) => {
                if ((row as any).isSipsOnly) return <span className="text-[#8A9A8E] text-sm">—</span>
                const v = row.total as number
                if (!v) return <span className="text-[#8A9A8E] text-sm">—</span>
                return <span className={`font-bold text-sm ${v > avgPriceAll ? 'text-err' : 'text-info'}`}>{fmt(v, 4)}</span>
              }}
              onRowClick={(row) => !(row as any).isSipsOnly && setSelectedPriceBillId((row as any).id)}
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
              rows={canonicalMatrixRows.map(r => ({
                id: (r as any).id, mes: r.mes,
                periods: Object.fromEntries(activePeriods.map(p => [p, (r as any).periodSpend[p]])) as Record<string, unknown>,
                total: (r as any).totalFactura, isSipsOnly: (r as any).isSipsOnly,
              }))}
              renderCell={(row, p) => {
                if ((row as any).isSipsOnly) return <span className="text-[#8A9A8E] text-sm">—</span>
                const cell = row.periods[p] as { eur: number; isEstimated: boolean } | undefined
                if (!cell || cell.eur === 0) return <span className="text-[#8A9A8E] text-sm">—</span>
                return <span className={`text-sm ${cell.isEstimated ? 'text-yellow-400' : 'text-[#5A6B5F]'}`}>{fmt(cell.eur)}</span>
              }}
              renderTotal={(row) => {
                if ((row as any).isSipsOnly) return <span className="text-[#8A9A8E] text-sm">—</span>
                return <span className="text-info font-bold text-sm">{fmt(row.total as number)} €</span>
              }}
              onRowClick={(row) => !(row as any).isSipsOnly && setSelectedBillId((row as any).id)}
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
                      <td className="py-3 px-3 text-ink-2">{row.name}</td>
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
          <div className="relative z-10 flex flex-col items-center gap-4">
            <button
              onClick={() => openElectricityPDF({ cups, tarifa, titular, activePeriods, chartData, tableData, summaryStats, pieData, averagePriceStats, hasExcesses, excessData, totalExcessAmount })}
              className="flex items-center gap-2 px-10 py-4 rounded-full text-sm font-black tracking-widest uppercase transition hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #6B8068, #5A6E58)', boxShadow: '0 20px 40px -10px rgba(107,128,104,0.3)', color: '#FBF7EE' }}>
              <Download className="w-4 h-4" /> GENERAR PDF
            </button>
            {is2TD && comp2TDData && (
              <button
                onClick={() => openComparativa2TD()}
                className="flex items-center gap-2 px-8 py-3 rounded-full text-sm font-black tracking-widest uppercase transition hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #C7F24A, #a8d940)', boxShadow: '0 12px 30px -8px rgba(199,242,74,0.4)', color: '#2D3A33' }}>
                <Sparkles className="w-4 h-4" /> COMPARATIVA VOLTIS 2.0TD
              </button>
            )}
            <p className="text-[#8A9A8E] text-xs text-center max-w-xs">
              Se abrirá en nueva pestaña — selecciona «Guardar como PDF» en el diálogo de impresión
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
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-bold text-[#2D3A33]">Precio Promedio</h3>
                  <p className="text-[#8A9A8E] text-xs mt-0.5">
                    Coste medio por periodo · {selectedMonths.size} {selectedMonths.size === 1 ? 'mes' : 'meses'}
                  </p>
                </div>
                <button
                  onClick={() => setShowAvgPriceModal(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#E5DCC9]/60 transition-colors"
                >
                  <X className="w-4 h-4 text-[#5A6B5F]" />
                </button>
              </div>

              {/* Period rows */}
              <div className="space-y-1.5 mb-5">
                {(averagePriceStats as any[]).map((ps: any) => (
                  <div key={ps.period}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border transition-colors"
                    style={{ background: '#FDFAF4', borderColor: '#E5DCC9' }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: (PERIOD_COLORS[ps.period] || '#6B8068') + '22', color: PERIOD_COLORS[ps.period] || '#6B8068' }}>
                        {ps.period}
                      </span>
                      <span className="text-[#5A6B5F] text-sm">
                        {ps.totalKwh > 0
                          ? <>{fmt(ps.totalKwh, 0)} <span className="text-[#8A9A8E] text-xs">kWh</span></>
                          : <span className="text-[#B0BDB5] italic text-xs">Sin consumo</span>
                        }
                      </span>
                    </div>
                    <span className="text-[#2D3A33] font-bold text-sm tabular-nums">
                      {ps.totalKwh > 0 ? `${fmt(ps.avgPrice, 4)} €/kWh` : '—'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Footer: precio promedio total */}
              <div className="rounded-xl p-4 border" style={{ background: '#EDF4F0', borderColor: '#B2D4C4' }}>
                <p className="text-[#3A7A5E] text-[10px] font-bold tracking-[0.2em] uppercase mb-3">Precio Promedio Total</p>
                <div className="flex items-end justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-[#5A6B5F] text-xs">
                      <span className="font-medium text-[#2D3A33]">{fmt(summaryStats.energetic)} €</span>
                      <span className="text-[#8A9A8E] mx-1.5">÷</span>
                      <span className="font-medium text-[#2D3A33]">{fmt(summaryStats.kwh, 0)} kWh</span>
                    </p>
                    <p className="text-[#8A9A8E] text-[11px]">
                      Coste energético ÷ consumo total
                    </p>
                  </div>
                  <p className="text-[#3A7A5E] text-2xl font-black tabular-nums flex-shrink-0">
                    {fmt(summaryStats.precioPromedio, 4)} <span className="text-sm font-normal text-[#5A8A72]">€/kWh</span>
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Power Adjustment Modal ─────────────────────────────────────────── */}
      {showPowerAdjust && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl p-6 max-w-md w-full shadow-2xl" style={{ background: '#FBF7EE', border: '1px solid #E5DCC9' }}>
            <h3 className="text-lg font-black text-[#2D3A33] mb-1">Ajuste de potencias</h3>
            <p className="text-sm text-[#5A6B5F] mb-4">
              Los maxímetros registran desviaciones {'>'} 15% en los siguientes periodos. ¿Quieres ajustar las potencias para la comercializadora propuesta?
            </p>
            {/* Deviation summary */}
            <div className="rounded-xl p-3 mb-4 space-y-1" style={{ background: '#F0EBE1' }}>
              {getMaximetroDeviations(maximetroHistory, potenciaContratada).map(d => (
                <div key={d.period} className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#2D3A33]">{d.period}</span>
                  <span className="text-[#8A9A8E]">Contratado: <strong>{d.contracted.toFixed(1)} kW</strong></span>
                  <span className="text-[#8A9A8E]">Maxímetro: <strong>{d.avgMaxi.toFixed(1)} kW</strong></span>
                  <span className={Math.abs(d.deviation) > 0.15 ? 'text-orange-600 font-bold' : 'text-[#6B8068]'}>
                    {d.deviation > 0 ? '+' : ''}{(d.deviation * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
            {/* Power inputs */}
            <div className="space-y-2 mb-5">
              <p className="text-[10px] font-bold tracking-widest text-[#8A9A8E]">POTENCIAS PARA NUEVA COMERCIALIZADORA (kW)</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(powerAdjustInputs).map(([p, val]) => (
                  <div key={p} className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-[#5A6B5F]">{p}</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={val}
                      onChange={e => setPowerAdjustInputs(prev => ({ ...prev, [p]: e.target.value }))}
                      className="w-full px-2 py-1.5 rounded-lg text-sm border text-[#2D3A33] outline-none focus:border-[#6B8068]"
                      style={{ background: '#fff', border: '1px solid #D9D0BC' }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowPowerAdjust(false)
                  setShow2TDModal(true)
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition hover:opacity-80"
                style={{ background: '#E5DCC9', color: '#5A6B5F' }}
              >
                No, usar actuales
              </button>
              <button
                onClick={() => {
                  const adjusted: Record<string, number> = {}
                  Object.entries(powerAdjustInputs).forEach(([p, v]) => {
                    const n = parseFloat(v)
                    if (!isNaN(n) && n > 0) adjusted[p] = n
                  })
                  setAdjustedPotencia(adjusted)
                  setShowPowerAdjust(false)
                  setShow2TDModal(true)
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #6B8068, #5A6E58)', color: '#FBF7EE' }}
              >
                Sí, ajustar potencias
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ MODAL 4: Comparativa Voltis 2.0TD ═══════════ */}
      <AnimatePresence>
        {show2TDModal && comp2TDData && (
          <motion.div key="m4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print"
            onClick={() => setShow2TDModal(false)}>
            <motion.div initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              className="relative w-full max-w-2xl mx-4 rounded-2xl overflow-hidden shadow-2xl"
              style={{ background: '#FBF7EE', border: '1px solid #D9D0BA', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="px-7 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #5A6E58, #6B8068)', borderBottom: '1px solid #4A5E47' }}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4" style={{ color: '#C7F24A' }} />
                    <span className="text-xs font-black tracking-[0.3em] uppercase" style={{ color: '#C7F24A' }}>Comparativa Voltis 2.0TD</span>
                  </div>
                  <p className="text-sm font-bold" style={{ color: '#FBF7EE' }}>{titular}</p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: 'rgba(251,247,238,0.6)' }}>{cups}</p>
                </div>
                <button onClick={() => setShow2TDModal(false)} className="p-2 rounded-full transition hover:opacity-70" style={{ color: '#FBF7EE' }}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Intro */}
              <div className="px-7 py-4" style={{ borderBottom: '1px solid #E5DCC9', background: '#F4EEE2' }}>
                <p className="text-xs" style={{ color: '#5A6B5F' }}>
                  Comparativa basada en consumo SIPS ({Math.round(comp2TDData.consumo.P1 + comp2TDData.consumo.P2 + comp2TDData.consumo.P3).toLocaleString('es-ES')} kWh/año)
                  y precios medios facturados ({comp2TDData.currentEnergyPrice.toLocaleString('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €/kWh). IVA 21% incluido.
                </p>
              </div>

              {/* Tariff Cards */}
              <div className="px-7 py-5 flex flex-col gap-3">
                {comp2TDData.results.map((item, idx) => {
                  const isBest = idx === 0
                  const saving = item.result.savings.totalAnnual
                  const savColor = saving >= 0 ? '#3D7A4B' : '#C0392B'
                  const savBg    = saving >= 0 ? '#E8F5E9' : '#FDECEA'

                  return (
                    <div key={item.key} className="rounded-xl p-4"
                      style={{ background: isBest ? '#E0E8DC' : '#F4EEE2', border: isBest ? '2px solid #6B8068' : '1px solid #E5DCC9' }}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {isBest && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: '#C7F24A', color: '#2D3A33' }}>
                                MEJOR OPCIÓN
                              </span>
                            )}
                            <span className="text-xs font-black tracking-[0.15em]" style={{ color: '#5A6E58' }}>{item.tariff.name.toUpperCase()}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <p className="text-[10px]" style={{ color: '#8A9A8E' }}>Energía P1/P2/P3</p>
                              <p className="text-xs font-mono font-bold" style={{ color: '#2D3A33' }}>
                                {item.tariff.energy.P1.toFixed(3)} / {item.tariff.energy.P2.toFixed(3)} / {item.tariff.energy.P3.toFixed(3)} €/kWh
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px]" style={{ color: '#8A9A8E' }}>Potencia P1/P2</p>
                              <p className="text-xs font-mono font-bold" style={{ color: '#2D3A33' }}>
                                {item.tariff.power.P1.toFixed(4)} / {item.tariff.power.P2.toFixed(4)} €/kW·día
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Saving pill */}
                        <div className="text-right flex-shrink-0">
                          <div className="rounded-lg px-3 py-2" style={{ background: savBg }}>
                            <p className="text-[10px] font-bold" style={{ color: savColor }}>AHORRO ANUAL</p>
                            <p className="text-xl font-black" style={{ color: savColor }}>
                              {saving >= 0 ? '+' : ''}{saving.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                            </p>
                            <p className="text-[10px]" style={{ color: savColor }}>
                              {(saving / 12 >= 0 ? '+' : '')}{(saving / 12).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €/mes
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Download buttons */}
                      <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #D9D0BA' }}>
                        <button
                          onClick={() => open2TDComparisonPDF({ titular, cups, tariffKey: item.key, consumo: comp2TDData.consumo, potencia: comp2TDData.potencia, currentEnergyPrices: comp2TDData.currentEnergyPrices, currentPowerP1: comp2TDData.currentPowerP1, currentPowerP2: comp2TDData.currentPowerP2, energyPricingFormat: comp2TDData.energyPricingFormat, isIndexed: comp2TDData.isIndexed })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition hover:opacity-80"
                          style={{ background: '#6B8068', color: '#FBF7EE' }}>
                          <FileText className="w-3.5 h-3.5" /> PDF
                        </button>
                        <button
                          onClick={async () => {
                            setDownloading2TD(item.key)
                            try {
                              const res = await fetch('/api/comparativa-2td', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  titular, cups, tariffKey: item.key,
                                  consumoP1: comp2TDData.consumo.P1,
                                  consumoP2: comp2TDData.consumo.P2,
                                  consumoP3: comp2TDData.consumo.P3,
                                  potenciaP1: comp2TDData.potencia.P1,
                                  potenciaP2: comp2TDData.potencia.P2,
                                  potenciaP3: comp2TDData.potencia.P3,
                                  currentEnergyPrice: comp2TDData.currentEnergyPrice,
                                  currentEnergyPriceP1: comp2TDData.currentEnergyPrices.P1,
                                  currentEnergyPriceP2: comp2TDData.currentEnergyPrices.P2,
                                  currentEnergyPriceP3: comp2TDData.currentEnergyPrices.P3,
                                  energyPricingFormat: comp2TDData.energyPricingFormat,
                                  isIndexed: comp2TDData.isIndexed,
                                  currentPowerP1: comp2TDData.currentPowerP1,
                                  currentPowerP2: comp2TDData.currentPowerP2,
                                }),
                              })
                              if (!res.ok) throw new Error('Error generando Excel')
                              const blob = await res.blob()
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `Comparativa_2TD_${item.tariff.shortName}_${titular.replace(/\s+/g, '_')}.xlsx`
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch (err) {
                              alert('Error al generar Excel. Inténtalo de nuevo.')
                            } finally {
                              setDownloading2TD(null)
                            }
                          }}
                          disabled={downloading2TD === item.key}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition hover:opacity-80 disabled:opacity-50"
                          style={{ background: '#E0E8DC', color: '#5A6E58', border: '1px solid #C8D8C4' }}>
                          {downloading2TD === item.key
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando...</>
                            : <><Download className="w-3.5 h-3.5" /> Excel</>}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Footer note */}
              <div className="px-7 py-4" style={{ borderTop: '1px solid #E5DCC9', background: '#F4EEE2' }}>
                <p className="text-[10px] text-center" style={{ color: '#8A9A8E' }}>
                  Ahorro estimado. No incluye alquiler de equipos ni otros cargos fijos. Potencia contratada de SIPS.
                </p>
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

export default function AnnualEconomics({ invoices, supplyId, onInvoicesUpdated, supplyType: propSupplyType, potenciaContratada, consumoPeriodos, clientName, supplyName: supplyNameProp, gasHistory, initialView, maximetroHistory, sipsHistory }: Props) {
  const [view, setView] = useState<'tabla' | 'informe'>(initialView ?? 'tabla')
  const [busyRescan, setBusyRescan] = useState<string | null>(null)
  const [busyDelete, setBusyDelete] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // ── Filtro año × mes (2 dimensiones) ────────────────────────────────────
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all')
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set()) // 0-indexed (Jan=0)

  // Sort all invoices with extracted data by billing period ascending
  const withEco = invoices
    .filter(hasUsableData)
    .sort((a, b) => {
      const da = a.period_start || a.period_end || a.created_at || ''
      const db = b.period_start || b.period_end || b.created_at || ''
      return da.localeCompare(db)
    })
  const withoutEco = invoices.filter(inv => !hasUsableData(inv))

  // Helper: get year from an invoice
  const invYear = (inv: InvoiceRow) => {
    const { start, end } = getInvoiceDates(inv)
    return getAssignedMonth(start, end).year
  }
  // Helper: get month (0-indexed) from an invoice
  const invMonth = (inv: InvoiceRow) => {
    const { start, end } = getInvoiceDates(inv)
    return getAssignedMonth(start, end).month
  }

  // Years available across all invoices
  const availableYears: number[] = (() => {
    const yrs = new Set<number>()
    for (const inv of withEco) { const y = invYear(inv); if (y > 0) yrs.add(y) }
    return [...yrs].sort()
  })()

  // Invoices passing the YEAR filter (base for the month filter)
  const yearBaseEco = selectedYear === 'all'
    ? withEco
    : withEco.filter(inv => invYear(inv) === selectedYear)

  // Months with data in the current year context
  const availableMonths: number[] = (() => {
    const mths = new Set<number>()
    for (const inv of yearBaseEco) { const m = invMonth(inv); if (m >= 0 && m <= 11) mths.add(m) }
    return [...mths].sort((a, b) => a - b)
  })()

  // Final invoices after both filters
  const filteredEco = selectedMonths.size === 0
    ? yearBaseEco
    : yearBaseEco.filter(inv => selectedMonths.has(invMonth(inv)))

  const selectYear = (yr: number | 'all') => {
    setSelectedYear(yr)
    setSelectedMonths(new Set()) // reset months when year changes
  }
  const toggleMonth = (m: number) => {
    setSelectedMonths(prev => {
      const next = new Set(prev)
      next.has(m) ? next.delete(m) : next.add(m)
      return next
    })
  }
  const supplyName = supplyNameProp || (withEco.length > 0 ? getEco(withEco[0])?.titular : undefined) || undefined
  const isGas = isGasSupply(invoices, propSupplyType)

  // Aggregate validation status across all invoices
  const validationSummary = (() => {
    let anyFail = false
    let anyWarn = false
    let totalWarnings = 0
    const failDetails: string[] = []
    const warnDetails: string[] = []
    for (const inv of withEco) {
      const eco = getEco(inv) as any
      const v = eco?.validation
      const label = inv.period_start ? inv.period_start.slice(0, 7) : inv.id.slice(0, 8)
      if (v) {
        if (v.mathOk === false) {
          anyFail = true
          const diff = v.diff != null ? ` (diff: ${v.diff > 0 ? '+' : ''}${Number(v.diff).toFixed(2)} €)` : ''
          failDetails.push(`${label}${diff}`)
        }
        if (Array.isArray(v.warnings) && v.warnings.length > 0) {
          anyWarn = true
          totalWarnings += v.warnings.length
          warnDetails.push(`${label}: ${v.warnings.join(', ')}`)
        }
      }
    }
    return { anyFail, anyWarn, totalWarnings, failDetails, warnDetails }
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
    const reportNode = isGas
      ? <GasReportView invoices={invoices} supplyName={supplyName} onBack={() => setView('tabla')} gasHistory={gasHistory} />
      : <ReportView invoices={invoices} supplyName={supplyName || clientName} onBack={() => setView('tabla')} onInvoicesUpdated={onInvoicesUpdated} potenciaContratada={potenciaContratada} consumoPeriodos={consumoPeriodos} initialYear={selectedYear} maximetroHistory={maximetroHistory} sipsHistory={sipsHistory} />
    // Portal to document.body so fixed positioning escapes framer-motion's transform context
    if (typeof document !== 'undefined') return createPortal(reportNode, document.body)
    return reportNode
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#FBF7EE', border: '1px solid #E5DCC9' }}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5DCC9]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-[0.3em] text-[#5A6B5F]">DATOS EXTRAÍDOS {withEco.length}/{invoices.length}</span>
          {withEco.length > 0 && (
            validationSummary.anyFail ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-err text-[10px] tracking-wide border border-err/40 cursor-help"
                style={{ background: 'rgba(220,38,38,0.08)' }}
                title={`La suma de conceptos no cuadra con el total en ${validationSummary.failDetails.length} factura(s):\n${validationSummary.failDetails.join('\n')}`}
              >
                ⚠ {validationSummary.failDetails.length} factura{validationSummary.failDetails.length > 1 ? 's' : ''} con diff
              </span>
            ) : validationSummary.anyWarn ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-warn text-[10px] tracking-wide border border-warn/40 cursor-help"
                style={{ background: 'rgba(202,138,4,0.08)' }}
                title={`${validationSummary.totalWarnings} aviso(s):\n${validationSummary.warnDetails.join('\n')}`}
              >
                ⚠ {validationSummary.totalWarnings} aviso{validationSummary.totalWarnings > 1 ? 's' : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] tracking-wide border border-ok/40" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
                ✓ validado
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

      {/* ── Filtro año ──────────────────────────────────────────────────────── */}
      {withEco.length > 0 && availableYears.length > 1 && (
        <div className="flex items-center justify-center gap-x-3 gap-y-2 px-6 py-3 border-b border-[#E5DCC9] flex-wrap" style={{ background: '#F9F5EC' }}>
          <span className="text-[10px] font-bold tracking-widest text-[#8A9A8E]">AÑO</span>
          {(['all', ...availableYears] as const).map(yr => (
            <button
              key={yr}
              onClick={() => selectYear(yr as number | 'all')}
              className="px-3 py-1 rounded-full text-xs font-bold transition-all"
              style={{
                background: selectedYear === yr ? '#6B8068' : '#E5DCC9',
                color: selectedYear === yr ? '#FBF7EE' : '#5A6B5F',
              }}
            >
              {yr === 'all' ? 'Global' : yr}
            </button>
          ))}
          <span className="text-[10px] text-[#8A9A8E] whitespace-nowrap ml-3">
            {filteredEco.length} de {withEco.length} factura{withEco.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {withEco.length > 0 ? (
        <FileTable
          invoices={filteredEco}
          onRescan={handleRescan}
          onDelete={handleDelete}
          busyRescan={busyRescan}
          busyDelete={busyDelete}
          authoritativeType={propSupplyType}
          potenciaContratada={potenciaContratada}
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
