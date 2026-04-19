'use client'

import {
  Zap, Flame, BarChart3, Printer, Edit3, Save, Globe, ShieldCheck, Cpu,
  CheckCircle2, ArrowLeft, Activity, LayoutGrid
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ConsumptionSnapshot, AuditReport } from '@/types/database'
import {
  formatKWh, formatNumber, rowTotal, classifyRows, totalConsumption, periodTotals,
  PERIOD_COLORS
} from '@/lib/consumption-utils'

// ─── Futuristic Color Palette ─────────────────────────────────────────────────
const ACCENT = '#6366F1'   // indigo-500
const ACCENT_LIGHT = '#818CF8'
const DARK = '#0F172A'
const SURFACE = '#F8FAFC'
const MUTED = '#94A3B8'
const BORDER = 'rgba(148,163,184,0.12)'

const GAS_COLORS = ['#10B981', '#059669', '#34D399', '#6EE7B7']
const PERIOD_NAMES: Record<string, string> = {
  P1: 'Punta', P2: 'Llano', P3: 'Valle', P4: 'P4', P5: 'P5', P6: 'Supervalle'
}

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────
function DonutChart({ data, colors, size = 220, strokeWidth = 36, centerLabel, centerSub }: {
  data: { label: string; value: number }[]
  colors: string[]
  size?: number
  strokeWidth?: number
  centerLabel?: string
  centerSub?: string
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null
  const radius = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  let cumulative = 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background ring */}
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#E2E8F0" strokeWidth={strokeWidth} opacity={0.3} />
      {data.filter(d => d.value > 0).map((d, i) => {
        const pct = d.value / total
        const dash = circumference * pct
        const gap = circumference - dash
        const offset = circumference * cumulative
        cumulative += pct
        return (
          <circle
            key={d.label}
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray 0.5s ease-out' }}
          />
        )
      })}
      {centerLabel && (
        <>
          <text x={cx} y={cy - 6} textAnchor="middle" style={{ fill: DARK, fontSize: 18, fontWeight: 800 }}>{centerLabel}</text>
          {centerSub && <text x={cx} y={cy + 14} textAnchor="middle" style={{ fill: MUTED, fontSize: 10, fontWeight: 600 }}>{centerSub}</text>}
        </>
      )}
    </svg>
  )
}

// ─── Futuristic Section Title ─────────────────────────────────────────────────
function SectionTitle({ num, title, subtitle, color = ACCENT }: { num: string; title: string; subtitle?: string; color?: string }) {
  return (
    <div className="flex items-start gap-5 mb-10" style={{ breakInside: 'avoid', breakAfter: 'avoid' }}>
      <div style={{
        width: 4, backgroundColor: color, borderRadius: 4,
        alignSelf: 'stretch', minHeight: 44, flexShrink: 0,
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
        boxShadow: `0 0 12px ${color}40`
      }} />
      <div className="flex-1 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-baseline gap-3">
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color, fontFamily: 'monospace' }}>
            {num}
          </span>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: DARK, lineHeight: 1.3 }}>{title}</h2>
        </div>
        {subtitle && <p style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{subtitle}</p>}
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ label, value, unit, icon: Icon, highlight, color }: {
  label: string; value: string | number; unit?: string; icon?: any; highlight?: boolean; color?: string
}) {
  if (highlight) {
    return (
      <div className="rounded-3xl p-7 text-center flex flex-col items-center gap-2 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${DARK} 0%, #1E293B 100%)`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10" style={{ background: ACCENT, filter: 'blur(40px)' }} />
        {Icon && <Icon style={{ width: 24, height: 24, color: ACCENT_LIGHT, marginBottom: 4 }} />}
        <div style={{ fontSize: 36, fontWeight: 800, color: 'white', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {unit && <div style={{ fontSize: 11, color: ACCENT_LIGHT, fontWeight: 600, letterSpacing: '0.05em' }}>{unit}</div>}
        <div style={{ fontSize: 11, color: '#CBD5E1', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      </div>
    )
  }
  return (
    <div className="rounded-3xl border p-7 text-center flex flex-col items-center gap-2 bg-white" style={{ borderColor: BORDER }}>
      {Icon && <Icon style={{ width: 22, height: 22, color: color || ACCENT, marginBottom: 4 }} />}
      <div style={{ fontSize: 32, fontWeight: 800, color: DARK, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {unit && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{unit}</div>}
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
    </div>
  )
}

// ─── Data Table (reusable) ────────────────────────────────────────────────────
function DataTable({ headers, rows: tableRows, footer }: {
  headers: { label: string; align?: 'left' | 'right' | 'center'; width?: number }[]
  rows: (string | number | React.ReactNode)[][]
  footer?: (string | number | React.ReactNode)[]
}) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${BORDER}`, breakInside: 'avoid' }}>
      <table className="w-full" style={{ fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
            {headers.map((h, i) => (
              <th key={i} className={`px-5 py-3.5 ${h.align === 'right' ? 'text-right' : h.align === 'center' ? 'text-center' : 'text-left'}`}
                style={{ color: '#475569', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', minWidth: h.width }}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'white' : '#FAFBFC', borderTop: `1px solid ${BORDER}` }}>
              {row.map((cell, j) => (
                <td key={j} className={`px-5 py-3 ${headers[j]?.align === 'right' ? 'text-right' : headers[j]?.align === 'center' ? 'text-center' : 'text-left'}`}
                  style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr style={{ background: `linear-gradient(135deg, ${ACCENT}08 0%, ${ACCENT}12 100%)`, borderTop: `2px solid ${ACCENT}30`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              {footer.map((cell, j) => (
                <td key={j} className={`px-5 py-3.5 ${headers[j]?.align === 'right' ? 'text-right' : headers[j]?.align === 'center' ? 'text-center' : 'text-left'}`}
                  style={{ fontWeight: 800, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ─── Supply Card ──────────────────────────────────────────────────────────────
function SupplyCard({ row, index }: { row: ConsumptionSnapshot; index: number }) {
  const isGas = row.supply_type === 'gas' || (row.tariff || '').toUpperCase().startsWith('RL')
  const total = rowTotal(row)
  return (
    <div className="border rounded-2xl p-4 bg-white relative overflow-hidden" style={{ borderColor: BORDER, breakInside: 'avoid' }}>
      <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-5"
        style={{ background: isGas ? '#F97316' : ACCENT, transform: 'translate(30%,-30%)' }} />
      <div className="flex items-start justify-between mb-2">
        <span className={`inline-flex items-center text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
          isGas
            ? 'bg-warn-container/40 text-warn border-warn/30'
            : 'bg-info-container/40 text-info border-info/30'
        }`} style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
          {row.tariff || '—'}
        </span>
        <span style={{ fontSize: 10, color: MUTED, fontFamily: 'monospace', fontWeight: 700 }}>#{String(index + 1).padStart(2, '0')}</span>
      </div>
      {row.name && <p style={{ fontSize: 12, fontWeight: 700, color: DARK, marginBottom: 2, lineHeight: 1.3 }}>{row.name}</p>}
      <p style={{ fontSize: 11, color: '#64748B', marginBottom: 2, lineHeight: 1.4 }}>{row.address || '—'}</p>
      <p style={{ fontSize: 10, color: MUTED, fontFamily: 'monospace', letterSpacing: '0.02em', marginBottom: 8 }}>{row.cups || '—'}</p>
      <div className="flex items-baseline gap-1.5 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: DARK, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(total)}</span>
        <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>kWh/año</span>
      </div>
    </div>
  )
}

// ─── Bar Chart (SVG) ──────────────────────────────────────────────────────────
function BarChartSVG({ data, colors, width = 600, height = 220 }: {
  data: { label: string; value: number }[]
  colors: string[]
  width?: number
  height?: number
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  const barWidth = Math.min(60, (width - 80) / data.length - 8)
  const chartH = height - 50
  const startX = 60

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', margin: '0 auto' }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
        const y = 10 + chartH * (1 - pct)
        return (
          <g key={pct}>
            <line x1={startX} y1={y} x2={width - 10} y2={y} stroke="#E2E8F0" strokeDasharray="4 4" />
            <text x={startX - 8} y={y + 4} textAnchor="end" style={{ fontSize: 10, fill: MUTED }}>
              {max >= 1000 ? `${Math.round(max * pct / 1000)}k` : Math.round(max * pct)}
            </text>
          </g>
        )
      })}
      {/* Bars */}
      {data.map((d, i) => {
        const barH = d.value > 0 ? Math.max(4, (d.value / max) * chartH) : 0
        const x = startX + 10 + i * ((width - startX - 20) / data.length) + ((width - startX - 20) / data.length - barWidth) / 2
        const y = 10 + chartH - barH
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={barH} rx={6} fill={colors[i % colors.length]}
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.08))' }} />
            {d.value > 0 && (
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, fill: '#475569' }}>
                {d.value >= 1000 ? `${(d.value / 1000).toFixed(0)}k` : formatNumber(d.value)}
              </text>
            )}
            <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: '#475569' }}>
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Percentage helpers ───────────────────────────────────────────────────────
function fmtPct(n: number, total: number): string {
  if (!total || !n) return '0,0 %'
  return ((n / total) * 100).toFixed(1).replace('.', ',') + ' %'
}

function pctColor(n: number, total: number): string {
  if (!total || !n) return MUTED
  const pct = (n / total) * 100
  if (pct >= 40) return '#DC2626'
  if (pct >= 20) return '#D97706'
  return '#059669'
}

// ─── Period dot ───────────────────────────────────────────────────────────────
function PeriodDot({ color }: { color: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface TechnologicalReportViewProps {
  rows: ConsumptionSnapshot[]
  client: any
  report: AuditReport | null
  informeBreve: string
  setInformeBreve: (s: string) => void
  isEditing: boolean
  setIsEditing: (b: boolean) => void
  onSave: () => Promise<void>
  saving: boolean
  saved: boolean
  onPrint: () => void
  onBackToTable?: () => void
}

export function TechnologicalReportView({
  rows,
  client,
  report,
  informeBreve,
  setInformeBreve,
  isEditing,
  setIsEditing,
  onSave,
  saving,
  saved,
  onPrint,
  onBackToTable
}: TechnologicalReportViewProps) {

  const reportRows = report?.rows_snapshot ? (report.rows_snapshot as ConsumptionSnapshot[]) : rows
  const classified = classifyRows(reportRows)
  const totals = periodTotals(classified.electricity)
  const grandTotal = totalConsumption(reportRows)
  const elecTotal = totalConsumption(classified.electricity)
  const gasTotal = totalConsumption(classified.gas)
  const generatedAt = report?.created_at ? new Date(report.created_at) : new Date()
  const dateStr = generatedAt.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })

  let sectionNum = 0
  const nextNum = () => { sectionNum++; return String(sectionNum).padStart(2, '0') }

  // ─── Tariff grouping ──────────────────────────────────────────────────────
  const tariffGroups: Record<string, ConsumptionSnapshot[]> = {}
  reportRows.forEach(r => {
    const t = (r.tariff || 'Sin tarifa').trim()
    if (!tariffGroups[t]) tariffGroups[t] = []
    tariffGroups[t].push(r)
  })
  const sortedTariffs = Object.keys(tariffGroups).sort()

  // ─── Gas RL grouping ──────────────────────────────────────────────────────
  const gasRLGroups: Record<string, ConsumptionSnapshot[]> = {}
  classified.gas.forEach(r => {
    const match = (r.tariff || '').match(/RL[\s.]*([1-4])/i)
    const rl = match ? `RL${match[1]}` : 'Sin RL'
    if (!gasRLGroups[rl]) gasRLGroups[rl] = []
    gasRLGroups[rl].push(r)
  })
  const sortedRL = Object.keys(gasRLGroups).sort()

  // ─── Period sums helper ───────────────────────────────────────────────────
  function sumPeriods(rws: ConsumptionSnapshot[]) {
    const s = { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0 }
    rws.forEach(r => {
      s.p1 += Number(r.consumo_p1) || 0; s.p2 += Number(r.consumo_p2) || 0
      s.p3 += Number(r.consumo_p3) || 0; s.p4 += Number(r.consumo_p4) || 0
      s.p5 += Number(r.consumo_p5) || 0; s.p6 += Number(r.consumo_p6) || 0
    })
    return s
  }

  function getPeriodsForLabel(label: string): string[] {
    const upper = (label || '').toUpperCase()
    if (upper.includes('3.0') || upper.includes('6.1')) return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
    return ['P1', 'P2', 'P3']
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E2E8F0 100%)' }}>
      {/* ═══ Toolbar ═══ */}
      <div className="no-print sticky top-0 z-50 backdrop-blur-xl border-b shadow-sm"
        style={{ background: 'rgba(255,255,255,0.85)', borderColor: BORDER }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {onBackToTable && (
              <Button variant="ghost" size="sm" onClick={onBackToTable}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Tabla
              </Button>
            )}
            <div className="h-4 w-[1px] bg-slate-200 hidden sm:block" />
            <span className="text-sm font-bold tracking-tight truncate max-w-[240px] sm:max-w-none" style={{ color: DARK }}>
              {report?.title || 'Informe de Auditoría Energética'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                style={{ background: '#ECFDF5', color: '#059669' }}>
                <CheckCircle2 className="w-3 h-3" /> Guardado
              </span>
            )}
            <div className="flex rounded-xl p-1 shadow-inner" style={{ background: '#F1F5F9' }}>
              <Button size="sm" variant={isEditing ? 'primary' : 'ghost'}
                onClick={() => isEditing ? onSave() : setIsEditing(true)} loading={saving}
                className="rounded-lg h-8 px-3">
                {isEditing ? <><Save className="w-3.5 h-3.5 mr-1" /> Guardar</> : <><Edit3 className="w-3.5 h-3.5 mr-1" /> Editar</>}
              </Button>
              <Button size="sm" variant="ghost" onClick={onPrint} className="rounded-lg h-8 px-3">
                <Printer className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">PDF</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Report Document ═══ */}
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div id="audit-report" className="bg-white overflow-hidden relative"
          style={{ borderRadius: 32, boxShadow: '0 25px 100px -12px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.03)' }}>

          {/* ════ COVER PAGE ════ */}
          <div className="relative overflow-hidden" style={{ minHeight: '70vh', pageBreakAfter: 'always', breakAfter: 'page' }}>
            {/* Background decoration */}
            <div className="absolute inset-0 pointer-events-none" style={{
              background: `radial-gradient(ellipse at 70% 20%, ${ACCENT}08 0%, transparent 50%), radial-gradient(ellipse at 30% 80%, ${ACCENT}05 0%, transparent 50%)`
            }} />
            <div className="absolute top-8 right-8 opacity-[0.03]">
              <Cpu style={{ width: 320, height: 320 }} strokeWidth={0.3} />
            </div>

            {/* Top bar */}
            <div className="flex items-center justify-between px-12 pt-10 pb-4 relative z-10" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2">
                <Zap style={{ width: 14, height: 14, color: ACCENT }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: ACCENT }}>
                  Auditoría Energética {client?.type === 'ayuntamiento' ? 'Municipal' : 'Corporativa'}
                </span>
              </div>
              <span style={{ fontSize: 11, color: MUTED }}>{dateStr}</span>
            </div>

            {/* Cover content */}
            <div className="flex flex-col items-center justify-center text-center px-12 pt-20 pb-16 relative z-10">
              <div className="w-24 h-24 rounded-[28px] flex items-center justify-center mb-10 shadow-lg"
                style={{ background: `linear-gradient(135deg, ${ACCENT} 0%, #4F46E5 100%)`, boxShadow: `0 20px 60px ${ACCENT}30`, transform: 'rotate(3deg)', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                <Zap style={{ width: 44, height: 44, color: 'white' }} />
              </div>

              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.3em', textTransform: 'uppercase', color: ACCENT, marginBottom: 20 }}>
                ESTUDIO TÉCNICO ENERGÉTICO
              </p>
              <h1 style={{ fontSize: 46, fontWeight: 800, color: DARK, lineHeight: 1.1, marginBottom: 8, letterSpacing: '-0.02em' }}>
                {client?.name}
              </h1>
              <div className="w-16 h-1 rounded-full mx-auto my-8" style={{ backgroundColor: `${ACCENT}30` }} />
              <p style={{ fontSize: 14, color: '#64748B', maxWidth: 480, lineHeight: 1.7 }}>
                Análisis exhaustivo de la red de suministros {client?.type === 'ayuntamiento' ? 'municipales' : 'corporativos'} para la optimización de potencias y consumos energéticos.
              </p>

              {/* Stats grid */}
              <div className="grid grid-cols-4 gap-5 w-full max-w-3xl mt-16 p-8 rounded-3xl relative"
                style={{ background: `linear-gradient(135deg, ${SURFACE} 0%, white 100%)`, border: `1px solid ${BORDER}` }}>
                {[
                  { value: reportRows.length, label: 'Suministros' },
                  { value: formatKWh(grandTotal).split(' ')[0], label: formatKWh(grandTotal).split(' ')[1] + '/Año' },
                  { value: classified.electricity.length, label: 'Eléctricos' },
                  { value: classified.gas.length, label: 'Gas' },
                ].map((stat, i) => (
                  <div key={i} className="text-center space-y-1.5" style={{ borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                    <p style={{ fontSize: 32, fontWeight: 800, color: ACCENT, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</p>
                    <p style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{stat.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-center gap-6 mt-12" style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Red de Suministros</span>
                <div className="w-1 h-1 rounded-full" style={{ background: MUTED }} />
                <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Voltis CRM</span>
              </div>
            </div>
          </div>

          <div className="px-12 py-16 space-y-0">

            {/* ════ SECTION: Relación de Suministros ════ */}
            <div style={{ paddingTop: '18mm' }}>
              <SectionTitle num={nextNum()} title="Relación de Suministros" subtitle={`${reportRows.length} suministros en total`} />

              {classified.electricity.length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap style={{ width: 14, height: 14, color: ACCENT }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Electricidad</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${ACCENT}15`, color: ACCENT }}>{classified.electricity.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {classified.electricity.map((row, i) => <SupplyCard key={row.id} row={row} index={i} />)}
                  </div>
                </div>
              )}

              {classified.gas.length > 0 && (
                <div style={{ breakInside: 'avoid' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Flame style={{ width: 14, height: 14, color: '#F97316' }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Gas</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: '#FFF7ED', color: '#EA580C' }}>{classified.gas.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {classified.gas.map((row, i) => <SupplyCard key={row.id} row={row} index={i} />)}
                  </div>
                </div>
              )}
            </div>

            {/* ════ SECTION: Consumo Acumulado Total (KPI) ════ */}
            <div className="page-break" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
              <SectionTitle num={nextNum()} title="Consumo Acumulado Total" subtitle="Resumen global de todos los suministros del proyecto" />

              <div className="grid grid-cols-2 gap-5 mb-8" style={{ breakInside: 'avoid' }}>
                <KPICard label="Total suministros" value={reportRows.length} unit="puntos de suministro" icon={LayoutGrid} />
                <KPICard label="Consumo anual total" value={formatNumber(grandTotal)} unit="kWh/año" icon={Activity} highlight />
              </div>

              {(classified.electricity.length > 0 || classified.gas.length > 0) && (
                <div className="space-y-3" style={{ breakInside: 'avoid' }}>
                  {classified.electricity.length > 0 && (
                    <div className="rounded-2xl border px-6 py-5 flex items-center justify-between"
                      style={{ background: `linear-gradient(135deg, ${ACCENT}06 0%, white 100%)`, borderColor: `${ACCENT}15`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <div className="flex items-center gap-3">
                        <Zap style={{ width: 20, height: 20, color: ACCENT }} />
                        <div>
                          <p style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>Suministros eléctricos</p>
                          <p style={{ fontSize: 15, fontWeight: 800, color: DARK, marginTop: 2 }}>{classified.electricity.length} suministros</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p style={{ fontSize: 22, fontWeight: 800, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(elecTotal)}</p>
                        <p style={{ fontSize: 11, color: MUTED }}>kWh/año</p>
                      </div>
                    </div>
                  )}
                  {classified.gas.length > 0 && (
                    <div className="rounded-2xl border px-6 py-5 flex items-center justify-between"
                      style={{ background: 'linear-gradient(135deg, #F0FDF4 0%, white 100%)', borderColor: '#BBF7D0', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <div className="flex items-center gap-3">
                        <Flame style={{ width: 20, height: 20, color: '#10B981' }} />
                        <div>
                          <p style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>Suministros de gas</p>
                          <p style={{ fontSize: 15, fontWeight: 800, color: DARK, marginTop: 2 }}>{classified.gas.length} suministros</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p style={{ fontSize: 22, fontWeight: 800, color: '#10B981', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(gasTotal)}</p>
                        <p style={{ fontSize: 11, color: MUTED }}>kWh/año</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ════ SECTION: Resumen por Tarifa ════ */}
            <div className="page-break" style={{ breakInside: 'avoid', paddingTop: '18mm' }}>
              <SectionTitle num={nextNum()} title="Resumen por Tarifa" subtitle="Distribución de suministros y consumos agrupados por tipo tarifario" />
              <DataTable
                headers={[
                  { label: 'Tarifa' },
                  { label: 'Nº Suministros', align: 'right' },
                  { label: 'Consumo Total (kWh)', align: 'right' },
                  { label: '% del Total', align: 'right', width: 120 },
                ]}
                rows={sortedTariffs.map(tarifa => {
                  const grpRows = tariffGroups[tarifa]
                  const grpTotal = grpRows.reduce((s, r) => s + rowTotal(r), 0)
                  return [
                    <span key="t" style={{ fontWeight: 700, color: ACCENT }}>{tarifa}</span>,
                    <span key="c" style={{ color: '#475569' }}>{grpRows.length}</span>,
                    <span key="v" style={{ fontWeight: 700, color: DARK }}>{formatNumber(grpTotal)}</span>,
                    <span key="p" style={{ fontWeight: 700, color: pctColor(grpTotal, grandTotal) }}>{fmtPct(grpTotal, grandTotal)}</span>,
                  ]
                })}
                footer={['TOTAL', String(reportRows.length), formatNumber(grandTotal), '100,0 %']}
              />
            </div>

            {/* ════ SECTION: Consumo Total por Periodos — Electricidad ════ */}
            {classified.electricity.length > 0 && (() => {
              const allPeriods = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
              const elecSums = sumPeriods(classified.electricity)
              const periodTotal = allPeriods.reduce((s, p) => s + ((elecSums as any)[p.toLowerCase()] || 0), 0)
              if (periodTotal === 0) return null

              const tableData = allPeriods.map(p => ({ p, val: (elecSums as any)[p.toLowerCase()] || 0 }))
              const chartData = tableData.filter(d => d.val > 0).map(d => ({ label: d.p, value: d.val }))

              return (
                <div className="page-break" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
                  <SectionTitle num={nextNum()} title="Consumo Total por Periodos — Electricidad"
                    subtitle={`Agregado de ${classified.electricity.length} suministros eléctricos`} />

                  <DataTable
                    headers={[
                      { label: 'Periodo' },
                      { label: 'Consumo (kWh)', align: 'right' },
                      { label: '% sobre Total', align: 'right', width: 130 },
                    ]}
                    rows={tableData.map((row, i) => [
                      <span key="p" className="inline-flex items-center gap-2.5">
                        <PeriodDot color={PERIOD_COLORS[i]} />
                        <span style={{ fontWeight: 700, color: DARK }}>{row.p}</span>
                        <span style={{ fontSize: 12, color: MUTED }}>{PERIOD_NAMES[row.p]}</span>
                      </span>,
                      <span key="v" style={{ fontWeight: 700, color: DARK }}>{row.val > 0 ? formatNumber(row.val) : '—'}</span>,
                      <span key="pct" style={{ fontWeight: 700, color: row.val > 0 ? pctColor(row.val, periodTotal) : MUTED }}>{row.val > 0 ? fmtPct(row.val, periodTotal) : '—'}</span>,
                    ])}
                    footer={['TOTAL', formatNumber(periodTotal), '100,0 %']}
                  />

                  <div className="grid grid-cols-2 gap-8 mt-10" style={{ breakInside: 'avoid' }}>
                    <div className="flex flex-col items-center">
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 16, textAlign: 'center' }}>Distribución porcentual</p>
                      <DonutChart data={chartData} colors={PERIOD_COLORS} centerLabel={formatNumber(periodTotal)} centerSub="kWh total" />
                      <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {allPeriods.map((p, i) => (
                          <div key={p} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold"
                            style={{ background: `${PERIOD_COLORS[i]}10`, color: PERIOD_COLORS[i], border: `1px solid ${PERIOD_COLORS[i]}20` }}>
                            <PeriodDot color={PERIOD_COLORS[i]} /> {p} — {PERIOD_NAMES[p]}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col items-center">
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 16, textAlign: 'center' }}>Consumo por periodo (kWh)</p>
                      <BarChartSVG data={chartData} colors={PERIOD_COLORS} width={340} height={240} />
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* ════ SECTION: Detail per tariff (2.0TD, 3.0TD, 6.1TD) ════ */}
            {(['2.0TD', '3.0TD', '6.1TD'] as const).map(tarifaLabel => {
              const tarifaRows = tarifaLabel === '2.0TD' ? classified.td20
                : tarifaLabel === '3.0TD' ? classified.td30
                : classified.td61
              if (tarifaRows.length === 0) return null

              const sums = sumPeriods(tarifaRows)
              const periods = getPeriodsForLabel(tarifaLabel)
              const periodTotal = periods.reduce((s, p) => s + ((sums as any)[p.toLowerCase()] || 0), 0)
              const totalCon = tarifaRows.reduce((s, r) => s + rowTotal(r), 0)
              if (periodTotal === 0) return null

              const tableData = periods.map(p => ({ p, val: (sums as any)[p.toLowerCase()] || 0 }))
              const chartData = tableData.filter(d => d.val > 0).map(d => ({ label: d.p, value: d.val }))

              return (
                <div key={tarifaLabel} className="page-break" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
                  <SectionTitle num={nextNum()} title={`Consumos ${tarifaLabel}`}
                    subtitle={`${tarifaRows.length} suministros · ${formatNumber(totalCon)} kWh totales`} />

                  <DataTable
                    headers={[
                      { label: 'Periodo' },
                      { label: 'Consumo (kWh)', align: 'right' },
                      { label: `% sobre Total ${tarifaLabel}`, align: 'right', width: 130 },
                    ]}
                    rows={tableData.map((row, i) => [
                      <span key="p" className="inline-flex items-center gap-2.5">
                        <PeriodDot color={PERIOD_COLORS[i]} />
                        <span style={{ fontWeight: 700, color: DARK }}>{row.p}</span>
                        <span style={{ fontSize: 12, color: MUTED }}>{PERIOD_NAMES[row.p]}</span>
                      </span>,
                      <span key="v" style={{ fontWeight: 700, color: DARK }}>{row.val > 0 ? formatNumber(row.val) : '—'}</span>,
                      <span key="pct" style={{ fontWeight: 700, color: row.val > 0 ? pctColor(row.val, periodTotal) : MUTED }}>{row.val > 0 ? fmtPct(row.val, periodTotal) : '—'}</span>,
                    ])}
                    footer={['TOTAL', formatNumber(periodTotal), '100,0 %']}
                  />

                  <div className="flex justify-center mt-10" style={{ breakInside: 'avoid' }}>
                    <div className="flex flex-col items-center">
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 16 }}>Distribución porcentual</p>
                      <DonutChart data={chartData} colors={PERIOD_COLORS} centerLabel={formatNumber(periodTotal)} centerSub="kWh" />
                      <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {periods.map((p, i) => (
                          <div key={p} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold"
                            style={{ background: `${PERIOD_COLORS[i]}10`, color: PERIOD_COLORS[i], border: `1px solid ${PERIOD_COLORS[i]}20` }}>
                            <PeriodDot color={PERIOD_COLORS[i]} /> {p} — {PERIOD_NAMES[p]}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* ════ SECTION: Gas ════ */}
            {classified.gas.length > 0 && (
              <div className="page-break" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
                <SectionTitle num={nextNum()} title="Suministros de Gas"
                  subtitle={`${classified.gas.length} suministros · ${formatNumber(gasTotal)} kWh totales`}
                  color="#10B981" />

                <DataTable
                  headers={[
                    { label: 'Tarifa RL' },
                    { label: 'Nº Suministros', align: 'right' },
                    { label: 'Consumo (kWh)', align: 'right' },
                    { label: '% Total Gas', align: 'right', width: 120 },
                  ]}
                  rows={sortedRL.map((rl, i) => {
                    const grp = gasRLGroups[rl]
                    const grpTotal = grp.reduce((s, r) => s + rowTotal(r), 0)
                    return [
                      <span key="rl" className="inline-flex items-center gap-2.5">
                        <PeriodDot color={GAS_COLORS[i % GAS_COLORS.length]} />
                        <span style={{ fontWeight: 700, color: GAS_COLORS[i % GAS_COLORS.length] }}>{rl}</span>
                      </span>,
                      <span key="c" style={{ color: DARK }}>{grp.length}</span>,
                      <span key="v" style={{ fontWeight: 700, color: DARK }}>{formatNumber(grpTotal)}</span>,
                      <span key="pct" style={{ fontWeight: 700, color: pctColor(grpTotal, gasTotal) }}>{fmtPct(grpTotal, gasTotal)}</span>,
                    ]
                  })}
                  footer={['TOTAL GAS', String(classified.gas.length), formatNumber(gasTotal), '100,0 %']}
                />

                {sortedRL.length > 1 && (
                  <div className="flex justify-center mt-10" style={{ breakInside: 'avoid' }}>
                    <DonutChart
                      data={sortedRL.map(rl => ({
                        label: rl,
                        value: gasRLGroups[rl].reduce((s, r) => s + rowTotal(r), 0)
                      }))}
                      colors={GAS_COLORS}
                      centerLabel={formatNumber(gasTotal)}
                      centerSub="kWh gas"
                    />
                  </div>
                )}
              </div>
            )}

            {/* ════ SECTION: Informe Breve ════ */}
            <div className="page-break" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
              <SectionTitle num={nextNum()} title="Informe Breve"
                subtitle="Resumen ejecutivo y conclusiones del estudio energético" color="#7C3AED" />

              <div className="rounded-3xl border p-8 min-h-[200px]" style={{ borderColor: BORDER, background: `linear-gradient(135deg, #FAF5FF05 0%, white 100%)` }}>
                {isEditing ? (
                  <textarea
                    value={informeBreve}
                    onChange={(e) => setInformeBreve(e.target.value)}
                    className="w-full h-64 bg-white border rounded-2xl p-5 text-sm outline-none resize-y leading-relaxed"
                    style={{ borderColor: `${ACCENT}30`, color: '#334155' }}
                    placeholder="Redacta aquí el informe breve o pega el texto desde otro documento..."
                  />
                ) : (
                  <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                    {informeBreve || (
                      <p style={{ color: MUTED, fontStyle: 'italic' }}>
                        Pulsa &ldquo;Editar&rdquo; para redactar o pegar el informe breve aquí.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ════ FOOTER ════ */}
            <div style={{ pageBreakBefore: 'always', breakBefore: 'page', minHeight: '40vh' }}
              className="flex flex-col items-center justify-center text-center py-24 px-12">
              <div className="w-20 h-20 rounded-[24px] flex items-center justify-center mb-8"
                style={{ background: `linear-gradient(135deg, ${DARK} 0%, #1E293B 100%)`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                <Zap style={{ width: 36, height: 36, color: ACCENT_LIGHT }} />
              </div>
              <p style={{ fontSize: 20, fontWeight: 800, color: DARK, letterSpacing: '-0.01em' }}>VOLTIS SOLUCIONES SL</p>
              <p style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>Auditoría y Optimización Energética</p>
              <div className="w-12 h-[2px] rounded-full mx-auto my-8" style={{ backgroundColor: `${ACCENT}30` }} />
              <p style={{ fontSize: 11, color: MUTED }}>
                Documento generado automáticamente por Voltis CRM · {dateStr}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
