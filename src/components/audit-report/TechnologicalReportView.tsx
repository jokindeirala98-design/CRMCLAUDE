'use client'

import {
  Flame, Printer, Edit3, Save,
  CheckCircle2, ArrowLeft, Activity, LayoutGrid, Zap
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ConsumptionSnapshot, AuditReport } from '@/types/database'
import {
  formatKWh, formatNumber, rowTotal, classifyRows, totalConsumption, periodTotals,
} from '@/lib/consumption-utils'

// ─── Voltis Design Tokens (themeSalvia) ───────────────────────────────────────
const ACCENT       = '#6B8068'   // verde salvia — reemplaza el indigo genérico
const ACCENT_SOFT  = '#E0E8DC'   // fondo acento suave
const RULE_COLOR   = '#E8B89A'   // durazno — divisor portada
const DARK         = '#2D3A33'   // texto principal
const TEXT_SOFT    = '#4F5C53'   // texto secundario
const SURFACE      = '#F4EEE2'   // canvas / fondo exterior
const PAPER        = '#FBF7EE'   // fondo de páginas
const MUTED        = '#8A8170'   // labels y fechas
const BORDER       = '#E5DCC9'   // bordes y separadores

const KPI_HI_BG    = 'linear-gradient(135deg, #6B8068 0%, #5A6E58 100%)'
const KPI_HI_FG    = '#FBF9F2'
const KPI_HI_MUTED = '#C5D2C1'
const KPI_HI_ACCENT = '#E8B89A'  // unidad en KPI destacado

const TABLE_HEAD_BG  = '#ECEEDF'
const TABLE_FOOT_BG  = '#E4EBDC'
const ROW_ALT        = '#F4EEE2'

const INSIGHT_BG  = '#F8E9D5'
const INSIGHT_BD  = '#F0D4B5'
const INSIGHT_FG  = '#7A5230'

// Colores pastel para períodos (themeSalvia)
const RPT_PERIOD_COLORS = [
  '#A8B5C9',  // P1 — azul polvo
  '#E8B89A',  // P2 — durazno
  '#A8C0A0',  // P3 — verde menta
  '#E8D1A0',  // P4 — mantequilla
  '#B8A8C5',  // P5 — lavanda
  '#6B8068',  // P6 — salvia (dominante alumbrado)
]

const GAS_COLORS = ['#A8C0A0', '#6B8068', '#C8D8C0', '#4F7A5A']

const PERIOD_NAMES: Record<string, string> = {
  P1: 'Punta', P2: 'Llano', P3: 'Valle', P4: 'P4', P5: 'P5', P6: 'Supervalle'
}

// ─── Tag de tarifa por color ──────────────────────────────────────────────────
function tariffTagStyle(tariff: string) {
  const t = (tariff || '').toUpperCase()
  if (t.startsWith('2.'))  return { bg: '#E0E8DC', fg: '#4A5E47' }
  if (t.startsWith('3.'))  return { bg: '#F5DCC9', fg: '#9C5B36' }
  if (t.startsWith('6.'))  return { bg: '#E8E0F0', fg: '#6B5A82' }
  if (t.startsWith('RL'))  return { bg: '#E6F4E8', fg: '#2E6B42' }
  return { bg: ACCENT_SOFT, fg: ACCENT }
}

// ─── Voltis Wordmark (SVG inline) ─────────────────────────────────────────────
function VoltisLogo({ color = ACCENT, height = 22 }: { color?: string; height?: number }) {
  const w = height * 3.6
  return (
    <svg viewBox="0 0 360 100" width={w} height={height} style={{ display: 'block' }} aria-label="Voltis energía">
      <text x="0" y="68" fill={color}
        fontFamily='"Inter Tight","Inter",-apple-system,sans-serif'
        fontSize="78" fontWeight="600" letterSpacing="-3">Voltis</text>
      <text x="232" y="92" fill={color}
        fontFamily='"Inter Tight","Inter",-apple-system,sans-serif'
        fontSize="22" fontWeight="400" letterSpacing="0.5">energía</text>
    </svg>
  )
}

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────
function DonutChart({ data, colors, size = 220, strokeWidth = 34, centerLabel, centerSub }: {
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
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke={BORDER} strokeWidth={strokeWidth} />
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
            style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as any}
          />
        )
      })}
      {centerLabel && (
        <>
          <text x={cx} y={cy - 6} textAnchor="middle" style={{ fill: DARK, fontSize: 16, fontWeight: 700 }}>{centerLabel}</text>
          {centerSub && <text x={cx} y={cy + 13} textAnchor="middle" style={{ fill: MUTED, fontSize: 10 }}>{centerSub}</text>}
        </>
      )}
    </svg>
  )
}

// ─── Section Title ────────────────────────────────────────────────────────────
function SectionTitle({ num, title, subtitle, color = ACCENT }: { num: string; title: string; subtitle?: string; color?: string }) {
  return (
    <div className="flex items-start gap-5 mb-10" style={{ breakInside: 'avoid', breakAfter: 'avoid' }}>
      <div style={{
        width: 3, backgroundColor: color, borderRadius: 2,
        alignSelf: 'stretch', minHeight: 48, flexShrink: 0,
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      }} />
      <div className="flex-1 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, letterSpacing: '0.22em', color, textTransform: 'uppercase', marginBottom: 4 }}>
          {num}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: DARK, lineHeight: 1.2, letterSpacing: '-0.01em' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 12, color: MUTED, marginTop: 5 }}>{subtitle}</p>}
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ label, value, unit, icon: Icon, highlight }: {
  label: string; value: string | number; unit?: string; icon?: any; highlight?: boolean
}) {
  if (highlight) {
    return (
      <div className="rounded-[20px] p-7 text-center flex flex-col items-center gap-2"
        style={{ background: KPI_HI_BG, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
        {Icon && <Icon style={{ width: 22, height: 22, color: KPI_HI_ACCENT, marginBottom: 4 }} />}
        <div style={{ fontSize: 34, fontWeight: 600, color: KPI_HI_FG, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{value}</div>
        {unit && <div style={{ fontFamily: 'monospace', fontSize: 10, color: KPI_HI_ACCENT, letterSpacing: '0.05em' }}>{unit}</div>}
        <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: KPI_HI_MUTED, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 4 }}>{label}</div>
      </div>
    )
  }
  return (
    <div className="rounded-[20px] p-7 text-center flex flex-col items-center gap-2"
      style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      {Icon && <Icon style={{ width: 22, height: 22, color: ACCENT, marginBottom: 4 }} />}
      <div style={{ fontSize: 32, fontWeight: 600, color: DARK, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{value}</div>
      {unit && <div style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED, marginTop: 2 }}>{unit}</div>}
      <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 4 }}>{label}</div>
    </div>
  )
}

// ─── Data Table ───────────────────────────────────────────────────────────────
function DataTable({ headers, rows: tableRows, footer }: {
  headers: { label: string; align?: 'left' | 'right' | 'center'; width?: number }[]
  rows: (string | number | React.ReactNode)[][]
  footer?: (string | number | React.ReactNode)[]
}) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', breakInside: 'avoid', background: PAPER }}>
      <table className="w-full" style={{ fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: TABLE_HEAD_BG, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
            {headers.map((h, i) => (
              <th key={i}
                className={h.align === 'right' ? 'text-right' : h.align === 'center' ? 'text-center' : 'text-left'}
                style={{ padding: '11px 16px', fontFamily: 'monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT_SOFT, minWidth: h.width }}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? PAPER : ROW_ALT, borderTop: `1px solid ${BORDER}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              {row.map((cell, j) => (
                <td key={j}
                  className={headers[j]?.align === 'right' ? 'text-right' : headers[j]?.align === 'center' ? 'text-center' : 'text-left'}
                  style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr style={{ background: TABLE_FOOT_BG, borderTop: `2px solid ${ACCENT}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              {footer.map((cell, j) => (
                <td key={j}
                  className={headers[j]?.align === 'right' ? 'text-right' : headers[j]?.align === 'center' ? 'text-center' : 'text-left'}
                  style={{ padding: '11px 16px', fontWeight: 800, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>
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
  const total = rowTotal(row)
  const { bg, fg } = tariffTagStyle(row.tariff || '')
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px', background: PAPER, breakInside: 'avoid', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: bg, color: fg, letterSpacing: '0.05em', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
          {row.tariff || '—'}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED, fontWeight: 600 }}>
          #{String(index + 1).padStart(2, '0')}
        </span>
      </div>
      {row.name && <p style={{ fontSize: 12, fontWeight: 600, color: DARK, marginBottom: 2, lineHeight: 1.3 }}>{row.name}</p>}
      <p style={{ fontSize: 11, color: TEXT_SOFT, marginBottom: 2, lineHeight: 1.4 }}>{row.address || '—'}</p>
      <p style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED, letterSpacing: '0.02em', marginBottom: 10 }}>{row.cups || '—'}</p>
      <div className="flex items-baseline gap-1.5" style={{ paddingTop: 10, borderTop: `1px dashed ${BORDER}` }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: DARK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{formatNumber(total)}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: MUTED, fontWeight: 600 }}>kWh/año</span>
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
      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
        const y = 10 + chartH * (1 - pct)
        return (
          <g key={pct}>
            <line x1={startX} y1={y} x2={width - 10} y2={y} stroke={BORDER} strokeDasharray="4 4" />
            <text x={startX - 8} y={y + 4} textAnchor="end" style={{ fontFamily: 'monospace', fontSize: 9, fill: MUTED }}>
              {max >= 1000 ? `${Math.round(max * pct / 1000)}k` : Math.round(max * pct)}
            </text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const barH = d.value > 0 ? Math.max(4, (d.value / max) * chartH) : 0
        const x = startX + 10 + i * ((width - startX - 20) / data.length) + ((width - startX - 20) / data.length - barWidth) / 2
        const y = 10 + chartH - barH
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={barH} rx={5} fill={colors[i % colors.length]}
              style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as any} />
            {d.value > 0 && (
              <text x={x + barWidth / 2} y={y - 5} textAnchor="middle" style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, fill: TEXT_SOFT }}>
                {d.value >= 1000 ? `${(d.value / 1000).toFixed(0)}k` : formatNumber(d.value)}
              </text>
            )}
            <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, fill: TEXT_SOFT }}>
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtPct(n: number, total: number): string {
  if (!total || !n) return '0,0 %'
  return ((n / total) * 100).toFixed(1).replace('.', ',') + ' %'
}

function pctColor(n: number, total: number): string {
  if (!total || !n) return MUTED
  const pct = (n / total) * 100
  if (pct >= 40) return '#C46850'  // pctHi  salvia-warm
  if (pct >= 20) return '#C99450'  // pctMid
  return '#6B8068'                  // pctLo = accent
}

function PeriodDot({ color }: { color: string }) {
  return (
    <span className="inline-block rounded-full shrink-0"
      style={{ width: 9, height: 9, backgroundColor: color, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
  )
}

// ─── Generador automático de Informe Breve ────────────────────────────────────
function buildInformeBreve({
  clientName,
  clientType,
  reportRows,
  classified,
  grandTotal,
  elecTotal,
  gasTotal,
  tariffGroups,
  sortedTariffs,
  elecSums,
  elecTotalPeriods,
}: {
  clientName: string
  clientType?: string
  reportRows: ConsumptionSnapshot[]
  classified: ReturnType<typeof classifyRows>
  grandTotal: number
  elecTotal: number
  gasTotal: number
  tariffGroups: Record<string, ConsumptionSnapshot[]>
  sortedTariffs: string[]
  elecSums: { p1: number; p2: number; p3: number; p4: number; p5: number; p6: number }
  elecTotalPeriods: number
}): string {
  const isAyto = (clientType || '').toLowerCase() === 'ayuntamiento'
  const entidad = isAyto ? 'municipio' : 'empresa'
  const suministros = isAyto ? 'suministros municipales' : 'suministros corporativos'

  const fmt = (n: number) => formatNumber(Math.round(n))
  const pct = (n: number, t: number) => t > 0 ? ((n / t) * 100).toFixed(1).replace('.', ',') + ' %' : '—'

  const lines: string[] = []

  // ── Párrafo 1: Introducción ──
  const hasGas = classified.gas.length > 0
  const gasStr = hasGas
    ? ` y ${classified.gas.length} suministro${classified.gas.length > 1 ? 's' : ''} de gas natural (${fmt(gasTotal)} kWh/año)`
    : ''
  lines.push(
    `Tras el análisis de la red de ${suministros} de ${clientName}, se han estudiado ${reportRows.length} puntos de suministro con un consumo total de ${fmt(grandTotal)} kWh/año. El ${entidad} dispone de ${classified.electricity.length} suministro${classified.electricity.length > 1 ? 's' : ''} eléctrico${classified.electricity.length > 1 ? 's' : ''} (${fmt(elecTotal)} kWh/año)${gasStr}.`
  )

  // ── Párrafo 2: Distribución por tarifa ──
  if (sortedTariffs.length > 0) {
    const tarifasSummary = sortedTariffs.map(t => {
      const total = tariffGroups[t].reduce((s, r) => s + rowTotal(r), 0)
      return `${t} con ${tariffGroups[t].length} suministro${tariffGroups[t].length > 1 ? 's' : ''} (${pct(total, grandTotal)} del consumo total)`
    }).join(', ')
    lines.push(`En cuanto a la estructura tarifaria, el ${entidad} opera con las siguientes modalidades: ${tarifasSummary}.`)
  }

  // ── Párrafo 3: Análisis de períodos ──
  if (elecTotalPeriods > 0) {
    const p6Pct = (elecSums.p6 / elecTotalPeriods) * 100
    const p1Pct = (elecSums.p1 / elecTotalPeriods) * 100
    const dominantKey = (['p6','p3','p2','p1','p4','p5'] as const).reduce((a, b) =>
      (elecSums as any)[a] > (elecSums as any)[b] ? a : b
    )
    const dominantPct = ((elecSums as any)[dominantKey] / elecTotalPeriods * 100).toFixed(1).replace('.', ',')
    const periodLabel = dominantKey.toUpperCase()
    const periodName: Record<string, string> = { P1: 'Punta', P2: 'Llano', P3: 'Valle', P4: 'P4', P5: 'P5', P6: 'Supervalle nocturno' }

    if (p6Pct >= 30) {
      lines.push(
        `El dato más destacado del análisis es la concentración del ${pct(elecSums.p6, elecTotalPeriods)} del consumo eléctrico en el período P6 (Supervalle, horario nocturno). Este patrón es característico del alumbrado público y apunta a una oportunidad de optimización tarifaria significativa: negociar condiciones específicas para el consumo nocturno puede generar ahorros relevantes en la factura energética anual.`
      )
    } else {
      lines.push(
        `El período de mayor consumo es ${periodLabel} (${periodName[periodLabel] || periodLabel}), que acumula el ${dominantPct} % del total eléctrico (${fmt((elecSums as any)[dominantKey])} kWh/año). ${p1Pct >= 25 ? 'La concentración en punta horaria (P1) sugiere revisar si las potencias contratadas están bien dimensionadas para evitar excesos de maxímetro.' : 'La distribución entre períodos muestra un perfil equilibrado que conviene contrastar con las potencias contratadas en cada tarifa.'}`
      )
    }
  }

  // ── Párrafo 4: Suministro principal ──
  const mainSupply = [...reportRows].sort((a, b) => rowTotal(b) - rowTotal(a))[0]
  if (mainSupply) {
    const mTotal = rowTotal(mainSupply)
    const mPct = pct(mTotal, grandTotal)
    const mId = mainSupply.name || mainSupply.cups || '—'
    const mTariff = mainSupply.tariff ? ` (${mainSupply.tariff})` : ''
    lines.push(
      `El suministro de mayor consumo individual es ${mId}${mTariff}, con ${fmt(mTotal)} kWh/año, lo que representa el ${mPct} del gasto energético total del ${entidad}. Este punto es el candidato prioritario para una auditoría específica de potencias y un análisis de optimización de contrato.`
    )
  }

  // ── Párrafo 5: Conclusión ──
  lines.push(
    `Voltis Energía pone a disposición de ${clientName} su equipo de consultoría para implementar las medidas de optimización identificadas. Las acciones propuestas pueden generar un ahorro estimado de entre el 8 % y el 15 % en la factura energética anual, sin necesidad de modificar las instalaciones existentes.`
  )

  return lines.join('\n\n')
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
  const grandTotal = totalConsumption(reportRows)
  const elecTotal  = totalConsumption(classified.electricity)
  const gasTotal   = totalConsumption(classified.gas)
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

  // ─── Resumen ejecutivo — cálculos dinámicos ───────────────────────────────
  const elecSumsGlobal = sumPeriods(classified.electricity)
  const elecTotalPeriods = ['p1','p2','p3','p4','p5','p6'].reduce((s, p) => s + (elecSumsGlobal as any)[p], 0)

  // ─── Generador de informe breve ──────────────────────────────────────────
  function handleGenerateInforme() {
    const generated = buildInformeBreve({
      clientName: client?.name || 'el cliente',
      clientType: client?.type,
      reportRows,
      classified,
      grandTotal,
      elecTotal,
      gasTotal,
      tariffGroups,
      sortedTariffs,
      elecSums: elecSumsGlobal,
      elecTotalPeriods,
    })
    setInformeBreve(generated)
    setIsEditing(true)
  }

  // Período dominante (el que más % tiene)
  const periodKeys = ['p1','p2','p3','p4','p5','p6'] as const
  const dominantPeriodKey = periodKeys.reduce((a, b) => (elecSumsGlobal as any)[a] > (elecSumsGlobal as any)[b] ? a : b)
  const dominantPeriodPct = elecTotalPeriods > 0
    ? (((elecSumsGlobal as any)[dominantPeriodKey] / elecTotalPeriods) * 100).toFixed(1).replace('.', ',')
    : '—'
  const dominantPeriodLabel = dominantPeriodKey.toUpperCase()

  // Tarifa dominante (mayor kWh)
  const dominantTariff = sortedTariffs.length > 0
    ? sortedTariffs.reduce((a, b) => {
        const getT = (t: string) => tariffGroups[t].reduce((s, r) => s + rowTotal(r), 0)
        return getT(a) > getT(b) ? a : b
      })
    : null
  const dominantTariffPct = dominantTariff && grandTotal > 0
    ? fmtPct(tariffGroups[dominantTariff].reduce((s, r) => s + rowTotal(r), 0), grandTotal)
    : '—'
  const dominantTariffCount = dominantTariff ? tariffGroups[dominantTariff].length : 0

  // Suministro principal
  const mainSupply = reportRows.length > 0
    ? [...reportRows].sort((a, b) => rowTotal(b) - rowTotal(a))[0]
    : null
  const mainSupplyKwh = mainSupply ? formatNumber(rowTotal(mainSupply)) : '—'
  const mainSupplyPct = mainSupply && grandTotal > 0 ? fmtPct(rowTotal(mainSupply), grandTotal) : '—'

  return (
    <div className="min-h-screen" style={{ background: SURFACE }}>

      {/* ═══ Toolbar (no-print) ═══ */}
      <div className="no-print sticky top-0 z-50 backdrop-blur-xl border-b"
        style={{ background: `rgba(251,247,238,0.92)`, borderColor: BORDER, boxShadow: '0 1px 8px rgba(60,70,60,0.08)' }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {onBackToTable && (
              <Button variant="ghost" size="sm" onClick={onBackToTable}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Tabla
              </Button>
            )}
            <div className="h-4 w-[1px]" style={{ background: BORDER }} />
            <span className="text-sm font-semibold tracking-tight truncate max-w-[240px] sm:max-w-none" style={{ color: DARK }}>
              {report?.title || 'Informe de Auditoría Energética'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                style={{ background: ACCENT_SOFT, color: ACCENT }}>
                <CheckCircle2 className="w-3 h-3" /> Guardado
              </span>
            )}
            <div className="flex rounded-xl p-1" style={{ background: SURFACE }}>
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
        <div id="audit-report" style={{
          background: PAPER,
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 18px 48px -16px rgba(60,70,60,0.18)',
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
        }}>

          {/* ════ COVER PAGE ════ */}
          <div style={{ minHeight: '70vh', pageBreakAfter: 'always', breakAfter: 'page', background: PAPER }}>

            {/* Top bar */}
            <div className="flex items-center justify-between px-12 pt-10 pb-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <VoltisLogo color={ACCENT} height={20} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: MUTED }}>{dateStr}</span>
            </div>

            {/* Cover content */}
            <div className="flex flex-col items-center text-center px-12 pt-16 pb-16">
              {/* Mark */}
              <div className="flex items-center justify-center mb-10"
                style={{ width: 88, height: 88, borderRadius: 24, background: ACCENT_SOFT, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                <VoltisLogo color={ACCENT} height={18} />
              </div>

              <p style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, letterSpacing: '0.32em', textTransform: 'uppercase', color: ACCENT, marginBottom: 18 }}>
                Auditoría Energética {client?.type === 'ayuntamiento' ? 'Municipal' : 'Corporativa'}
              </p>
              <h1 style={{ fontSize: 46, fontWeight: 600, color: DARK, lineHeight: 1.05, letterSpacing: '-0.025em' }}>
                {client?.name}
              </h1>
              {/* Divider durazno */}
              <div style={{ width: 64, height: 3, borderRadius: 2, background: RULE_COLOR, margin: '24px auto', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
              <p style={{ fontSize: 13, color: TEXT_SOFT, maxWidth: 480, lineHeight: 1.7 }}>
                Análisis exhaustivo de la red de suministros {client?.type === 'ayuntamiento' ? 'municipales' : 'corporativos'} para la optimización de potencias y consumos energéticos.
              </p>

              {/* Stats grid */}
              <div className="grid grid-cols-4 w-full max-w-3xl mt-14"
                style={{ background: SURFACE, borderRadius: 20, padding: '22px 8px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                {[
                  { value: reportRows.length, label: 'Suministros' },
                  { value: formatKWh(grandTotal).split(' ')[0], label: formatKWh(grandTotal).split(' ')[1] + '/Año' },
                  { value: classified.electricity.length, label: 'Eléctricos' },
                  { value: classified.gas.length, label: 'Gas' },
                ].map((stat, i) => (
                  <div key={i} className="text-center" style={{ borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none', padding: '0 14px' }}>
                    <p style={{ fontSize: 30, fontWeight: 600, color: ACCENT, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{stat.value}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.18em', marginTop: 8 }}>{stat.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-center gap-6 mt-10" style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                <span>Red de Suministros</span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: MUTED, display: 'inline-block' }} />
                <span>Voltis · Soluciones Energéticas</span>
              </div>
            </div>
          </div>

          {/* ═══ Cuerpo del informe ═══ */}
          <div className="px-12 py-16 space-y-0" style={{ background: PAPER }}>

            {/* ════ SECTION 00: Resumen ejecutivo (dinámico) ════ */}
            <div style={{ paddingTop: '14mm', breakInside: 'avoid', breakAfter: 'avoid' }}>
              <SectionTitle num="00" title="Resumen ejecutivo" subtitle="Cuatro datos clave para una lectura rápida" />
              <div className="grid grid-cols-2 gap-3 mb-10">
                {[
                  {
                    eyebrow: 'Período dominante',
                    value: `${dominantPeriodLabel} · ${dominantPeriodPct}%`,
                    caption: `El período con mayor consumo es ${dominantPeriodLabel} (${PERIOD_NAMES[dominantPeriodLabel] || ''}). Revisar si la tarificación en este tramo es la óptima.`,
                  },
                  {
                    eyebrow: 'Tarifa dominante',
                    value: dominantTariff ? `${dominantTariff} · ${dominantTariffPct}` : '—',
                    caption: dominantTariff
                      ? `${dominantTariffCount} de los ${reportRows.length} suministros son ${dominantTariff} y representan el bloque de mayor consumo.`
                      : 'Sin datos suficientes.',
                  },
                  {
                    eyebrow: 'Suministro principal',
                    value: `${mainSupplyKwh} kWh`,
                    caption: mainSupply
                      ? `Un único punto (${mainSupply.cups || mainSupply.name || '—'}) acumula el ${mainSupplyPct} del consumo total — candidato prioritario para revisión.`
                      : 'Sin datos.',
                  },
                  {
                    eyebrow: 'Total suministros',
                    value: `${reportRows.length}`,
                    caption: `${classified.electricity.length} eléctrico${classified.electricity.length !== 1 ? 's' : ''}${classified.gas.length > 0 ? ` · ${classified.gas.length} gas` : ''} · ${formatNumber(grandTotal)} kWh/año totales.`,
                  },
                ].map((card, i) => (
                  <div key={i} style={{ background: PAPER, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: ACCENT, marginBottom: 6 }}>{card.eyebrow}</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: DARK, letterSpacing: '-0.01em', marginBottom: 6 }}>{card.value}</div>
                    <div style={{ fontSize: 12, color: TEXT_SOFT, lineHeight: 1.55 }}>{card.caption}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ════ SECTION: Relación de Suministros ════ */}
            <div style={{ paddingTop: '10mm' }}>
              <SectionTitle num={nextNum()} title="Relación de Suministros" subtitle={`${reportRows.length} suministros en total`} />

              {classified.electricity.length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap style={{ width: 13, height: 13, color: ACCENT }} />
                    <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: TEXT_SOFT, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Electricidad</span>
                    <span style={{ background: ACCENT_SOFT, color: ACCENT, padding: '2px 9px', borderRadius: 9999, fontSize: 9, fontFamily: 'monospace', fontWeight: 700 }}>{classified.electricity.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {classified.electricity.map((row, i) => <SupplyCard key={row.id} row={row} index={i} />)}
                  </div>
                </div>
              )}

              {classified.gas.length > 0 && (
                <div style={{ breakInside: 'avoid' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Flame style={{ width: 13, height: 13, color: GAS_COLORS[0] }} />
                    <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: TEXT_SOFT, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Gas</span>
                    <span style={{ background: '#E6F4E8', color: GAS_COLORS[1], padding: '2px 9px', borderRadius: 9999, fontSize: 9, fontFamily: 'monospace', fontWeight: 700 }}>{classified.gas.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {classified.gas.map((row, i) => <SupplyCard key={row.id} row={row} index={i} />)}
                  </div>
                </div>
              )}
            </div>

            {/* ════ SECTION: Consumo Acumulado Total ════ */}
            <div style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
              <SectionTitle num={nextNum()} title="Consumo Acumulado Total" subtitle="Resumen global de todos los suministros del proyecto" />

              <div className="grid grid-cols-2 gap-5 mb-6" style={{ breakInside: 'avoid' }}>
                <KPICard label="Total suministros" value={reportRows.length} unit="puntos de suministro" icon={LayoutGrid} />
                <KPICard label="Consumo anual total" value={formatNumber(grandTotal)} unit="kWh/año" icon={Activity} highlight />
              </div>

              <div className="space-y-3" style={{ breakInside: 'avoid' }}>
                {classified.electricity.length > 0 && (
                  <div className="flex items-center justify-between px-6 py-5"
                    style={{ background: 'linear-gradient(135deg, #ECEEDF 0%, #FBF7EE 100%)', border: `1px solid ${BORDER}`, borderRadius: 14, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <div className="flex items-center gap-3">
                      <Zap style={{ width: 18, height: 18, color: ACCENT }} />
                      <div>
                        <p style={{ fontSize: 11, color: TEXT_SOFT, fontWeight: 600 }}>Suministros eléctricos</p>
                        <p style={{ fontSize: 14, fontWeight: 600, color: DARK, marginTop: 2 }}>{classified.electricity.length} suministros</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p style={{ fontSize: 20, fontWeight: 600, color: ACCENT, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{formatNumber(elecTotal)}</p>
                      <p style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED }}>kWh/año</p>
                    </div>
                  </div>
                )}
                {classified.gas.length > 0 && (
                  <div className="flex items-center justify-between px-6 py-5"
                    style={{ background: 'linear-gradient(135deg, #E6F4E8 0%, #FBF7EE 100%)', border: `1px solid #A8C0A0`, borderRadius: 14, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <div className="flex items-center gap-3">
                      <Flame style={{ width: 18, height: 18, color: GAS_COLORS[1] }} />
                      <div>
                        <p style={{ fontSize: 11, color: TEXT_SOFT, fontWeight: 600 }}>Suministros de gas</p>
                        <p style={{ fontSize: 14, fontWeight: 600, color: DARK, marginTop: 2 }}>{classified.gas.length} suministros</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p style={{ fontSize: 20, fontWeight: 600, color: GAS_COLORS[1], fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{formatNumber(gasTotal)}</p>
                      <p style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED }}>kWh/año</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ════ SECTION: Resumen por Tarifa ════ */}
            <div style={{ breakInside: 'avoid', paddingTop: '18mm' }}>
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
                  const { bg, fg } = tariffTagStyle(tarifa)
                  return [
                    <span key="t" style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: bg, color: fg, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>{tarifa}</span>,
                    <span key="c" style={{ color: TEXT_SOFT }}>{grpRows.length}</span>,
                    <span key="v" style={{ fontWeight: 600, color: DARK }}>{formatNumber(grpTotal)}</span>,
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
                <div style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
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
                        <PeriodDot color={RPT_PERIOD_COLORS[i]} />
                        <span style={{ fontWeight: 600, color: DARK }}>{row.p}</span>
                        <span style={{ fontSize: 11, color: MUTED }}>{PERIOD_NAMES[row.p]}</span>
                      </span>,
                      <span key="v" style={{ fontWeight: 600, color: DARK }}>{row.val > 0 ? formatNumber(row.val) : '—'}</span>,
                      <span key="pct" style={{ fontWeight: 700, color: row.val > 0 ? pctColor(row.val, periodTotal) : MUTED }}>{row.val > 0 ? fmtPct(row.val, periodTotal) : '—'}</span>,
                    ])}
                    footer={['TOTAL', formatNumber(periodTotal), '100,0 %']}
                  />

                  <div className="grid grid-cols-2 gap-8 mt-10" style={{ breakInside: 'avoid' }}>
                    <div className="flex flex-col items-center">
                      <p style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, color: TEXT_SOFT, marginBottom: 16, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Distribución porcentual</p>
                      <DonutChart data={chartData} colors={RPT_PERIOD_COLORS} centerLabel={formatNumber(periodTotal)} centerSub="kWh total" />
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {allPeriods.map((p, i) => (
                          <div key={p} className="inline-flex items-center gap-1.5"
                            style={{ background: PAPER, border: `1px solid ${BORDER}`, borderRadius: 9999, padding: '4px 9px', fontFamily: 'monospace', fontSize: 9, fontWeight: 600, color: TEXT_SOFT }}>
                            <PeriodDot color={RPT_PERIOD_COLORS[i]} /> {p}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col items-center">
                      <p style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, color: TEXT_SOFT, marginBottom: 16, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Consumo por periodo (kWh)</p>
                      <BarChartSVG data={chartData} colors={RPT_PERIOD_COLORS} width={340} height={240} />
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* ════ SECTION: Detalle por tarifa (2.0TD, 3.0TD, 6.1TD) ════ */}
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
              const { fg: tagFg } = tariffTagStyle(tarifaLabel)

              return (
                <div key={tarifaLabel} style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
                  <SectionTitle num={nextNum()} title={`Consumos ${tarifaLabel}`}
                    subtitle={`${tarifaRows.length} suministros · ${formatNumber(totalCon)} kWh totales`}
                    color={tagFg} />

                  <DataTable
                    headers={[
                      { label: 'Periodo' },
                      { label: 'Consumo (kWh)', align: 'right' },
                      { label: `% sobre Total ${tarifaLabel}`, align: 'right', width: 130 },
                    ]}
                    rows={tableData.map((row, i) => [
                      <span key="p" className="inline-flex items-center gap-2.5">
                        <PeriodDot color={RPT_PERIOD_COLORS[i]} />
                        <span style={{ fontWeight: 600, color: DARK }}>{row.p}</span>
                        <span style={{ fontSize: 11, color: MUTED }}>{PERIOD_NAMES[row.p]}</span>
                      </span>,
                      <span key="v" style={{ fontWeight: 600, color: DARK }}>{row.val > 0 ? formatNumber(row.val) : '—'}</span>,
                      <span key="pct" style={{ fontWeight: 700, color: row.val > 0 ? pctColor(row.val, periodTotal) : MUTED }}>{row.val > 0 ? fmtPct(row.val, periodTotal) : '—'}</span>,
                    ])}
                    footer={['TOTAL', formatNumber(periodTotal), '100,0 %']}
                  />

                  <div className="flex justify-center mt-10" style={{ breakInside: 'avoid' }}>
                    <div className="flex flex-col items-center">
                      <p style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, color: TEXT_SOFT, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Distribución porcentual</p>
                      <DonutChart data={chartData} colors={RPT_PERIOD_COLORS} centerLabel={formatNumber(periodTotal)} centerSub="kWh" />
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {periods.map((p, i) => (
                          <div key={p} className="inline-flex items-center gap-1.5"
                            style={{ background: PAPER, border: `1px solid ${BORDER}`, borderRadius: 9999, padding: '4px 9px', fontFamily: 'monospace', fontSize: 9, fontWeight: 600, color: TEXT_SOFT }}>
                            <PeriodDot color={RPT_PERIOD_COLORS[i]} /> {p}
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
              <div style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
                <SectionTitle num={nextNum()} title="Suministros de Gas"
                  subtitle={`${classified.gas.length} suministros · ${formatNumber(gasTotal)} kWh totales`}
                  color={GAS_COLORS[1]} />

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
                        <span style={{ fontWeight: 600, color: DARK }}>{rl}</span>
                      </span>,
                      <span key="c" style={{ color: DARK }}>{grp.length}</span>,
                      <span key="v" style={{ fontWeight: 600, color: DARK }}>{formatNumber(grpTotal)}</span>,
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
            <div style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '18mm' }}>
              <div className="flex items-end justify-between mb-10" style={{ breakInside: 'avoid', breakAfter: 'avoid' }}>
                {/* Reutilizamos el layout del SectionTitle pero con botón a la derecha */}
                <div className="flex items-start gap-5 flex-1">
                  <div style={{ width: 3, backgroundColor: ACCENT, borderRadius: 2, alignSelf: 'stretch', minHeight: 48, flexShrink: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                  <div className="flex-1 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, letterSpacing: '0.22em', color: ACCENT, textTransform: 'uppercase', marginBottom: 4 }}>
                      {nextNum()}
                    </div>
                    <h2 style={{ fontSize: 22, fontWeight: 600, color: DARK, lineHeight: 1.2, letterSpacing: '-0.01em' }}>Informe Breve</h2>
                    <p style={{ fontSize: 12, color: MUTED, marginTop: 5 }}>Resumen ejecutivo y conclusiones del estudio energético</p>
                  </div>
                </div>
                {/* Botón Generar — solo visible en pantalla */}
                <button
                  className="no-print"
                  onClick={handleGenerateInforme}
                  style={{
                    marginLeft: 16,
                    marginBottom: 14,
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: `1px solid ${ACCENT}`,
                    background: ACCENT_SOFT,
                    color: ACCENT,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                  Generar automáticamente
                </button>
              </div>

              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: '32px 36px', minHeight: 200, background: PAPER }}>
                {!informeBreve && !isEditing && (
                  /* Estado vacío — invitación a generar */
                  <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 180, gap: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: ACCENT_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                      </svg>
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: DARK, marginBottom: 6 }}>Sin texto todavía</p>
                      <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.6, maxWidth: 400 }}>
                        Pulsa <strong style={{ color: ACCENT }}>"Generar automáticamente"</strong> para crear un resumen ejecutivo basado en los datos del informe, o usa <strong style={{ color: TEXT_SOFT }}>"Editar"</strong> en la barra superior para redactarlo manualmente.
                      </p>
                    </div>
                  </div>
                )}

                {(informeBreve || isEditing) && (
                  <>
                    {isEditing ? (
                      <textarea
                        value={informeBreve}
                        onChange={(e) => setInformeBreve(e.target.value)}
                        className="w-full border rounded-[12px] p-5 text-sm outline-none resize-y leading-relaxed"
                        style={{ minHeight: 280, borderColor: BORDER, color: TEXT_SOFT, background: SURFACE, fontFamily: 'inherit', fontSize: 13.5 }}
                        placeholder="Redacta aquí el informe breve o pega el texto desde otro documento..."
                      />
                    ) : (
                      <div style={{ fontSize: 13.5, color: TEXT_SOFT, lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
                        {informeBreve}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ════ FOOTER ════ */}
            <div style={{ pageBreakBefore: 'always', breakBefore: 'page', minHeight: '40vh' }}
              className="flex flex-col items-center justify-center text-center py-24 px-12">
              <div className="flex items-center justify-center mb-6"
                style={{ width: 56, height: 56, borderRadius: 16, background: ACCENT_SOFT, border: `1px solid ${BORDER}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                <VoltisLogo color={ACCENT} height={16} />
              </div>
              <p style={{ fontSize: 18, fontWeight: 600, color: DARK, letterSpacing: '0.02em' }}>VOLTIS SOLUCIONES SL</p>
              <p style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Auditoría y optimización energética</p>
              <div style={{ width: 40, height: 2, borderRadius: 2, background: ACCENT, opacity: 0.4, margin: '22px auto', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED }}>
                Documento generado automáticamente por Voltis CRM · {dateStr}
              </p>
            </div>

          </div>{/* end body */}
        </div>{/* end audit-report */}
      </div>
    </div>
  )
}
