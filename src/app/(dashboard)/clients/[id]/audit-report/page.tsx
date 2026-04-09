'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  ArrowLeft, FileText, Edit3, Save, Loader2, CheckCircle2, Printer,
  Zap, Flame, BarChart3, RefreshCw, ExternalLink, AlertTriangle, Search,
  Menu, Download, Globe, ShieldCheck, Cpu, Layout, Layers
} from 'lucide-react'
import type { ConsumptionSnapshot, AuditReport } from '@/types/database'
import {
  classifyRows, totalConsumption, periodTotals, sumField,
  formatKWh, formatNumber, rowTotal,
  TARIFF_COLORS, PERIOD_COLORS, validateRowsForReport
} from '@/lib/consumption-utils'

// ─── SVG Donut Chart ────────────────────────────────────────────────────────
function DonutChart({ data, colors, size = 200, strokeWidth = 40 }: {
  data: { label: string; value: number }[]
  colors: string[]
  size?: number
  strokeWidth?: number
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
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray 0.3s' }}
          />
        )
      })}
      <text x={cx} y={cy - 8} textAnchor="middle" className="fill-slate-900 text-lg font-bold">{formatNumber(total)}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="fill-slate-400 text-[10px]">kWh/año</text>
    </svg>
  )
}

// ─── SVG Bar Chart ──────────────────────────────────────────────────────────
function BarChart({ data, colors, height = 200, barWidth = 48 }: {
  data: { label: string; value: number }[]
  colors: string[]
  height?: number
  barWidth?: number
}) {
  const maxVal = Math.max(...data.map(d => d.value), 1)
  const chartH = height - 30
  const w = data.length * (barWidth + 12) + 20

  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="mx-auto">
      {data.map((d, i) => {
        const barH = (d.value / maxVal) * chartH
        const x = 10 + i * (barWidth + 12)
        const y = chartH - barH
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={barH} rx={4} fill={colors[i % colors.length]} />
            <text x={x + barWidth / 2} y={chartH + 14} textAnchor="middle" className="fill-slate-500 text-[10px]">{d.label}</text>
            {d.value > 0 && (
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="fill-slate-600 text-[9px] font-medium">
                {formatNumber(d.value)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Legend ──────────────────────────────────────────────────────────────────
function ChartLegend({ items }: { items: { label: string; color: string; value: number; pct: number }[] }) {
  return (
    <div className="flex flex-wrap gap-3 justify-center">
      {items.filter(i => i.value > 0).map(i => (
        <div key={i.label} className="flex items-center gap-1.5 text-xs">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: i.color }} />
          <span className="text-slate-600 font-medium">{i.label}</span>
          <span className="text-slate-400">{i.pct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

// ─── Percent color logic ────────────────────────────────────────────────────
function pctColor(pct: number): string {
  if (pct >= 40) return '#DC2626'
  if (pct >= 20) return '#D97706'
  return '#059669'
}

function pctBg(pct: number): string {
  if (pct >= 40) return 'bg-red-50 text-red-700'
  if (pct >= 20) return 'bg-amber-50 text-amber-700'
  return 'bg-green-50 text-green-700'
}

// ─── Section Title ──────────────────────────────────────────────────────────
function SectionTitle({ num, title, subtitle }: { num: number | string; title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-lg bg-blue-900 text-white flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>{num}</span>
        <h2 className="font-display font-bold text-lg text-slate-900">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-slate-400 mt-1 ml-10">{subtitle}</p>}
    </div>
  )
}

// ─── Period matrix data (3.0TD / 6.1TD) ─────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => `${i}-${i + 1}`)
const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
// Period assignment: hour x month → P1..P6 for 3.0TD/6.1TD
const PERIOD_MATRIX: number[][] = [
  // ENE  FEB  MAR  ABR  MAY  JUN  JUL  AGO  SEP  OCT  NOV  DIC  S-D-F
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 0-1
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 1-2
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 2-3
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 3-4
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 4-5
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 5-6
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 6-7
  [6,6,6,6,6,6,6,6,6,6,6,6,6], // 7-8
  [2,2,3,5,5,4,2,4,4,5,3,2,6], // 8-9
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 9-10
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 10-11
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 11-12
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 12-13
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 13-14
  [2,2,3,5,5,4,2,4,4,5,3,2,6], // 14-15
  [2,2,3,5,5,4,2,4,4,5,3,2,6], // 15-16
  [2,2,3,5,5,4,2,4,4,5,3,2,6], // 16-17
  [2,2,3,5,5,4,2,4,4,5,3,2,6], // 17-18
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 18-19
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 19-20
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 20-21
  [1,1,2,4,4,3,1,3,3,4,2,1,6], // 21-22
  [2,2,3,5,5,4,2,4,4,5,3,2,6], // 22-23
  [2,2,3,5,5,4,2,4,4,5,3,2,6], // 23-24
]

const PERIOD_BG: Record<number, string> = {
  1: '#EF4444', 2: '#F59E0B', 3: '#22C55E', 4: '#06B6D4', 5: '#8B5CF6', 6: '#10B981'
}

const PERIOD_NAMES: Record<string, string> = {
  P1: 'Punta', P2: 'Llano', P3: 'Valle', P4: 'P4', P5: 'P5', P6: 'Supervalle'
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function AuditReportPage() {
  const { id } = useParams()
  const router = useRouter()
  const [client, setClient] = useState<any>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [rows, setRows] = useState<ConsumptionSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [informeBreve, setInformeBreve] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [view, setView] = useState<'table' | 'report'>('table')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isSyncingSupply, setIsSyncingSupply] = useState(false)

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const { data: clientData } = await supabase.from('clients').select('*').eq('id', id).single()
    setClient(clientData)

    // Check for existing report
    const { data: reports } = await supabase
      .from('audit_reports').select('*').eq('client_id', id)
      .order('created_at', { ascending: false }).limit(1)

    if (reports && reports.length > 0) {
      const r = reports[0] as AuditReport
      setReport(r)
      setInformeBreve(r.informe_breve || '')
    }

    // Fetch live snapshots
    const { data: snapshots } = await supabase
      .from('consumption_snapshots').select('*').eq('client_id', id)
      .order('cups', { ascending: true })
    setRows(snapshots || [])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  // Sync consumption data from SIPS + invoices
  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync-consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id }),
      })
      const data = await res.json()
      if (data.success) await fetchData()
    } catch (err) { console.error('Sync error:', err) }
    setSyncing(false)
  }

  // Generate report
  const generateReport = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id, title: `Informe energetico — ${client?.name}` }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
        setView('report')
      }
    } catch (err) { console.error('Error generating report:', err) }
    setGenerating(false)
  }

  // Save editable fields
  const saveReport = async () => {
    if (!report) return
    setSaving(true)
    try {
      await fetch('/api/audit-report', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: report.id, informe_breve: informeBreve, status: 'published' }),
      })
      setSaved(true); setIsEditing(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) { console.error('Error saving:', err) }
    setSaving(false)
  }

  // Print
  const handleUpdateName = async (rowId: string, supplyId: string, newName: string) => {
    setEditingId(null)
    if (!newName.trim()) return

    const supabase = createClient()
    
    // Update snapshot
    const { error: snapError } = await supabase
      .from('consumption_snapshots')
      .update({ name: newName.trim() })
      .eq('id', rowId)

    if (snapError) {
      console.error('Error updating snapshot name:', snapError)
      return
    }

    // Update supply globally
    setIsSyncingSupply(true)
    const { error: supplyError } = await supabase
      .from('supplies')
      .update({ name: newName.trim() })
      .eq('id', supplyId)
    
    if (supplyError) {
      console.error('Error updating supply name:', supplyError)
    }

    setRows(prev => prev.map(r => r.id === rowId ? { ...r, name: newName.trim() } : r))
    setIsSyncingSupply(false)
  }

  const handlePrint = () => {
    const style = document.createElement('style')
    style.id = '__print_report'
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #audit-report, #audit-report * { visibility: visible !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        #audit-report { position: absolute; left: 0; top: 0; width: 100% !important; background: white !important; }
        .no-print { display: none !important; }
        .page-break { page-break-before: always; break-before: page; padding-top: 15mm; }
        @page { margin: 15mm 15mm; size: A4 portrait; }
        .tech-gradient { background: none !important; border: 1px solid #e2e8f0 !important; }
        .tech-card { border: 1px solid #e2e8f0 !important; box-shadow: none !important; }
      }
    `
    document.head.appendChild(style)
    window.print()
    document.head.removeChild(style)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  const validation = validateRowsForReport(rows)
  const classified = classifyRows(rows)
  const reportRows = (view === 'report' && report?.rows_snapshot) ? report.rows_snapshot as ConsumptionSnapshot[] : rows
  const reportClassified = classifyRows(reportRows)
  const totals = periodTotals(reportClassified.electricity)
  const grandTotal = totalConsumption(reportRows)
  const generatedAt = report?.created_at ? new Date(report.created_at) : new Date()

  // ─── TABLE VIEW ───────────────────────────────────────────────────────────
  if (view === 'table') {
    return (
      <div>
        <Header
          title="Informe de suministros"
          subtitle={client?.name}
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => router.push(`/clients/${id}`)}>
                <ArrowLeft className="w-4 h-4" /> Volver
              </Button>
              <Button variant="secondary" onClick={handleSync} loading={syncing}>
                <RefreshCw className="w-4 h-4" />
                {rows.length === 0 ? 'Cargar datos' : 'Sincronizar'}
              </Button>
              {report && (
                <Button variant="secondary" onClick={() => setView('report')}>
                  <FileText className="w-4 h-4" /> Ver informe
                </Button>
              )}
              <Button
                onClick={generateReport}
                loading={generating}
                disabled={rows.length === 0 || !validation.valid}
              >
                <BarChart3 className="w-4 h-4" />
                {report ? 'Regenerar informe' : 'Generar informe'}
              </Button>
            </div>
          }
        />

        <div className="px-6 lg:px-8 pb-8 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="!py-3">
              <p className="text-xs text-on-surface-variant flex items-center gap-1"><Zap className="w-3 h-3" /> Suministros</p>
              <p className="font-display font-bold text-xl text-on-surface mt-1">{rows.length}</p>
            </Card>
            <Card className="!py-3">
              <p className="text-xs text-on-surface-variant flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> OK</p>
              <p className="font-display font-bold text-xl text-green-600 mt-1">{rows.filter(r => r.validation_status === 'OK').length}</p>
            </Card>
            <Card className="!py-3">
              <p className="text-xs text-on-surface-variant flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-500" /> Revisar</p>
              <p className="font-display font-bold text-xl text-amber-600 mt-1">{rows.filter(r => r.validation_status === 'Revisar').length}</p>
            </Card>
            <Card className="!py-3">
              <p className="text-xs text-on-surface-variant flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-500" /> Incompleto</p>
              <p className="font-display font-bold text-xl text-red-600 mt-1">{rows.filter(r => r.validation_status === 'Incompleto').length}</p>
            </Card>
          </div>

          {/* Validation messages */}
          {(!validation.valid || validation.warnings.length > 0) && (
            <div className="space-y-1">
              {validation.errors.map((e, i) => (
                <p key={i} className="text-xs text-error bg-error/5 rounded-lg px-3 py-1.5">{e}</p>
              ))}
              {validation.warnings.map((w, i) => (
                <p key={i} className="text-xs text-warning bg-warning/5 rounded-lg px-3 py-1.5">{w}</p>
              ))}
            </div>
          )}

          {/* Empty state */}
          {rows.length === 0 && (
            <Card>
              <div className="text-center py-12">
                <BarChart3 className="w-10 h-10 text-on-surface-variant/30 mx-auto mb-3" />
                <p className="text-sm font-medium text-on-surface">No hay datos de consumo</p>
                <p className="text-xs text-on-surface-variant mt-1">
                  Pulsa &quot;Cargar datos&quot; para importar automaticamente desde SIPS y facturas
                </p>
              </div>
            </Card>
          )}

          {/* Table */}
          {rows.length > 0 && (
            <Card className="!p-0 overflow-hidden border-none shadow-ambient-lg bg-surface-container-lowest">
              <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Layout className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-on-surface block">Base de Datos de Suministros</span>
                    <span className="text-[10px] text-on-surface-variant">19 columnas tecnicas · Edicion de alias sincronizada</span>
                  </div>
                </div>
                {isSyncingSupply && (
                  <div className="flex items-center gap-2 text-[10px] text-primary animate-pulse">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Sincronizando suministro...
                  </div>
                )}
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="text-[11px] border-collapse w-full tabular-nums" style={{ minWidth: 1500 }}>
                  <thead>
                    <tr className="bg-surface-container-low border-b border-outline-variant/10">
                      <th className="text-left px-4 py-3 font-bold text-on-surface-variant sticky left-0 bg-surface-container-low z-20 min-w-[150px]">Nombre (Alias)</th>
                      <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[140px]">Comercializadora</th>
                      <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[180px]">CUPS</th>
                      <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[70px]">Tarifa</th>
                      <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[200px]">Direccion</th>
                      {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(p => (
                        <th key={`pot_${p}`} className="text-right px-2 py-3 font-bold text-on-surface-variant min-w-[65px]">Pot.{p} (kW)</th>
                      ))}
                      {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(p => (
                        <th key={`con_${p}`} className="text-right px-2 py-3 font-bold text-primary min-w-[75px]">Con.{p} (kWh)</th>
                      ))}
                      <th className="text-right px-4 py-3 font-bold text-on-surface min-w-[90px]">Total Anual</th>
                      <th className="text-center px-4 py-3 font-bold text-on-surface-variant min-w-[80px]">Factura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const tariffUpper = (row.tariff || '').toUpperCase()
                      const is20 = tariffUpper.includes('2.0')
                      const isGas = row.supply_type === 'gas' || tariffUpper.startsWith('RL')
                      const potPeriods = is20 ? 2 : isGas ? 0 : 6
                      const conPeriods = is20 ? 3 : isGas ? 0 : 6
                      const isEditing = editingId === row.id

                      return (
                        <tr key={row.id} className={`border-b border-outline-variant/5 transition-colors hover:bg-primary/5 ${idx % 2 === 1 ? 'bg-surface-container-lowest' : 'bg-surface-container-lowest/50'}`}>
                          <td className="px-4 py-2.5 sticky left-0 bg-surface-container-lowest z-10 border-r border-outline-variant/10">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={editingName}
                                  onChange={e => setEditingName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleUpdateName(row.id, row.supply_id, editingName)
                                    if (e.key === 'Escape') setEditingId(null)
                                  }}
                                  className="w-full px-2 py-1 bg-surface-container-high rounded border border-primary outline-none text-[11px]"
                                  autoFocus
                                />
                                <button onClick={() => handleUpdateName(row.id, row.supply_id, editingName)} className="p-1 text-success hover:bg-success/10 rounded">
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div 
                                className="flex items-center justify-between group cursor-pointer"
                                onClick={() => { setEditingId(row.id); setEditingName(row.name || '') }}
                              >
                                <span className="font-semibold text-on-surface truncate">{row.name || '-'}</span>
                                <Edit3 className="w-3 h-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-on-surface-variant truncate">{row.comercializadora || '-'}</td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-on-surface-variant truncate tracking-tight">{row.cups || '-'}</td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                              isGas ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                            }`}>{row.tariff || '-'}</span>
                          </td>
                          <td className="px-3 py-2.5 truncate text-on-surface-variant/70">{row.address || '-'}</td>
                          {[row.potencia_p1, row.potencia_p2, row.potencia_p3, row.potencia_p4, row.potencia_p5, row.potencia_p6].map((v, i) => (
                            <td key={`pot_${i}`} className={`text-right px-2 py-2.5 ${i >= potPeriods ? 'text-outline-variant/30' : 'text-on-surface/80'}`}>
                              {i >= potPeriods ? '—' : (v != null ? Number(v).toFixed(2) : '-')}
                            </td>
                          ))}
                          {[row.consumo_p1, row.consumo_p2, row.consumo_p3, row.consumo_p4, row.consumo_p5, row.consumo_p6].map((v, i) => (
                            <td key={`con_${i}`} className={`text-right px-2 py-2.5 font-medium ${i >= conPeriods ? 'text-outline-variant/30' : 'text-primary'}`}>
                              {i >= conPeriods ? '—' : (v != null ? formatNumber(v) : '-')}
                            </td>
                          ))}
                          <td className="text-right px-4 py-2.5 font-bold text-on-surface bg-surface-container-low/30">{formatNumber(rowTotal(row))}</td>
                          <td className="text-center px-4 py-2.5">
                            {row.invoice_file_url ? (
                              <a 
                                href={row.invoice_file_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center mx-auto text-secondary hover:bg-secondary hover:text-white transition-all shadow-sm"
                                title="Ver factura original"
                                onClick={e => e.stopPropagation()}
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            ) : (
                              <span className="text-outline-variant/30 italic text-[9px]">{row.source === 'sips' ? 'SIPS' : 'Sin archivo'}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="min-h-screen bg-surface-container-low text-on-surface">
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md border-b border-outline-variant/10 shadow-ambient-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setView('table')} className="hover:bg-primary/10">
              <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Volver a la tabla</span>
            </Button>
            <div className="h-4 w-[1px] bg-outline-variant/30 hidden sm:block" />
            <span className="text-sm font-bold tracking-tight truncate max-w-[200px] sm:max-w-none">
              {report?.title || 'Informe Auditoria Energetica'}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1.5 text-[10px] text-success font-bold uppercase tracking-wider bg-success/10 px-2 py-1 rounded-full animate-in fade-in slide-in-from-right-2">
                <CheckCircle2 className="w-3 h-3" /> Guardado satisfactorio
              </span>
            )}
            <div className="flex bg-surface-container-high rounded-xl p-1 shadow-inner">
              <Button 
                size="sm" 
                variant={isEditing ? 'primary' : 'ghost'} 
                onClick={() => isEditing ? saveReport() : setIsEditing(true)}
                loading={saving}
                className="rounded-lg h-8 px-3"
              >
                {isEditing ? <><Save className="w-3.5 h-3.5 mr-1" /> Guardar</> : <><Edit3 className="w-3.5 h-3.5 mr-1" /> Editar</>}
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={handlePrint}
                className="rounded-lg h-8 px-3 hover:bg-primary/10"
              >
                <Printer className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Imprimir PDF</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Report document */}
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div id="audit-report" className="tech-card bg-surface-container-lowest overflow-hidden shadow-ambient-2xl border border-outline-variant/10 rounded-[2.5rem] relative">
          
          {/* Professional Background Elements (SVGs) */}
          <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-gradient-to-bl from-primary/5 to-transparent pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-secondary/5 rounded-full blur-3xl pointer-events-none" />

          {/* ════ PORTADA (COVER) ════ */}
          <div className="relative pt-24 pb-16 px-12 text-center border-b border-outline-variant/10 overflow-hidden">
            <div className="absolute top-12 left-1/2 -translate-x-1/2 opacity-10">
               <Cpu className="w-64 h-64 text-primary" strokeWidth={0.5} />
            </div>
            
            <div className="relative z-10 space-y-8">
              <div className="flex justify-center">
                <div className="tech-gradient w-20 h-20 bg-gradient-to-tr from-primary to-primary-container rounded-3xl flex items-center justify-center shadow-lg shadow-primary/20 rotate-3 hover:rotate-0 transition-transform duration-500">
                  <Zap className="w-10 h-10 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black tracking-[0.3em] uppercase text-primary/70">ESTUDIO TÉCNICO ENERGÉTICO</p>
                <h1 className="font-display text-5xl font-black text-on-surface tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-on-surface to-on-surface-variant/70">
                  {client?.name}
                </h1>
              </div>

              <div className="w-16 h-1 bg-primary/20 mx-auto rounded-full" />

              <p className="text-sm font-medium text-on-surface-variant max-w-md mx-auto leading-relaxed">
                Análisis exhaustivo de la red de suministros {client?.type === 'ayuntamiento' ? 'municipales' : 'corporativos'} para la optimización de potencias y consumos.
              </p>

              <div className="grid grid-cols-4 gap-4 max-w-3xl mx-auto mt-12 bg-surface-container-low/50 backdrop-blur-sm p-8 rounded-3xl border border-outline-variant/10">
                <div className="text-center space-y-1">
                  <p className="text-3xl font-black text-primary">{reportRows.length}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Suministros</p>
                </div>
                <div className="text-center space-y-1 border-x border-outline-variant/10">
                  <p className="text-3xl font-black text-primary">{formatKWh(grandTotal).split(' ')[0]}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{formatKWh(grandTotal).split(' ')[1] || 'kWh'}/Año</p>
                </div>
                <div className="text-center space-y-1">
                  <p className="text-3xl font-black text-primary group-hover:scale-110 transition">{reportClassified.electricity.length}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Eléctricos</p>
                </div>
                <div className="text-center space-y-1 border-l border-outline-variant/10">
                  <p className="text-3xl font-black text-primary">{reportClassified.gas.length}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Gas</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-6 pt-8 text-[10px] font-bold text-placeholder uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Red de Suministros</span>
                <div className="w-1 h-1 rounded-full bg-outline-variant" />
                <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Voltis Intelligent CRM</span>
                <div className="w-1 h-1 rounded-full bg-outline-variant" />
                <span>Emitido: {generatedAt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
              </div>
            </div>
          </div>

          <div className="px-12 py-16 space-y-24">
            
            {/* ════ SECTION 1: Resumen Global y KPIs ════ */}
            <div className="page-break">
              <SectionTitle num="01" title="Análisis de Consumo Acumulado" subtitle="Distribución globalizada de la demanda energética municipal" />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center pt-8">
                <div className="space-y-8">
                  <div className="p-8 rounded-[2rem] bg-gradient-to-br from-primary/10 to-transparent border border-primary/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                        <BarChart3 className="w-6 h-6 text-primary" />
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Consumo Total</p>
                        <p className="text-3xl font-black text-on-surface tabular-nums">{formatNumber(grandTotal)} <span className="text-sm font-medium">kWh</span></p>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-primary/10 rounded-full overflow-hidden">
                       <div className="h-full bg-primary rounded-full transition-all" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/5">
                      <div className="flex items-center gap-3 mb-3">
                        <Zap className="w-4 h-4 text-blue-500" />
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase">Electricidad</span>
                      </div>
                      <p className="text-xl font-bold text-on-surface tabular-nums">{formatNumber(totalConsumption(reportClassified.electricity))}</p>
                      <p className="text-[9px] text-on-surface-variant font-medium mt-1">kWh / acumulado anual</p>
                    </div>
                    <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/5">
                      <div className="flex items-center gap-3 mb-3">
                        <Flame className="w-4 h-4 text-orange-500" />
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase">Gas Natural</span>
                      </div>
                      <p className="text-xl font-bold text-on-surface tabular-nums">{formatNumber(totalConsumption(reportClassified.gas))}</p>
                      <p className="text-[9px] text-on-surface-variant font-medium mt-1">kWh / acumulado anual</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center p-8 rounded-[2.5rem] bg-surface-container-low/30 border border-outline-variant/10 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/5 to-transparent pointer-events-none" />
                   <div className="relative z-10 scale-110">
                     <DonutChart 
                      data={['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((l, i) => ({ label: l, value: [totals.p1, totals.p2, totals.p3, totals.p4, totals.p5, totals.p6][i] }))}
                      colors={PERIOD_COLORS}
                      size={240}
                      strokeWidth={35}
                    />
                   </div>
                   <div className="mt-8 flex flex-wrap justify-center gap-3">
                     {PERIOD_COLORS.map((color, i) => (
                       <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/50 border border-outline-variant/10 text-[9px] font-bold text-on-surface-variant uppercase tracking-tighter">
                         <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                         P{i+1}
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            </div>

            {/* ════ SECTION 2: Distribución por Tarifas ════ */}
            <div className="page-break space-y-10">
              <SectionTitle num="02" title="Relación de Segmentos Tarifarios" subtitle="Clasificación de suministros por tipología y grupo de consumo" />
              
              <div className="overflow-hidden rounded-[2rem] border border-outline-variant/10 shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-container-high/50 text-on-surface-variant border-b border-outline-variant/10">
                      <th className="text-left px-8 py-5 text-[10px] font-black uppercase tracking-[0.15em]">Segmento Tarifario</th>
                      <th className="text-center px-6 py-5 text-[10px] font-black uppercase tracking-[0.15em]">Unidades</th>
                      <th className="text-right px-6 py-5 text-[10px] font-black uppercase tracking-[0.15em]">Consumo Agregado (kWh)</th>
                      <th className="text-right px-8 py-5 text-[10px] font-black uppercase tracking-[0.15em]">Peso Relativo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/5">
                    {(() => {
                      const groups: Record<string, ConsumptionSnapshot[]> = {}
                      reportRows.forEach(r => {
                        const t = r.tariff?.trim() || 'S/D'
                        if (!groups[t]) groups[t] = []
                        groups[t].push(r)
                      })
                      return Object.keys(groups).sort().map((tarifa, i) => {
                        const grpRows = groups[tarifa]
                        const grpTotal = totalConsumption(grpRows)
                        const pct = grandTotal > 0 ? (grpTotal / grandTotal * 100) : 0
                        return (
                          <tr key={tarifa} className="group hover:bg-surface-container-low transition-colors tabular-nums">
                            <td className="px-8 py-4">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center font-black text-primary text-xs">
                                  {tarifa}
                                </div>
                                <span className="font-bold text-on-surface text-base">{tarifa}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center font-bold text-on-surface-variant">{grpRows.length}</td>
                            <td className="px-6 py-4 text-right font-black text-on-surface">{formatNumber(grpTotal)}</td>
                            <td className="px-8 py-4 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <div className="w-24 h-2 bg-outline-variant/10 rounded-full overflow-hidden">
                                  <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="font-bold text-xs text-primary min-w-[3rem]">{pct.toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="bg-primary/5 border-t-2 border-primary/10">
                      <td className="px-8 py-6 font-black text-primary text-base uppercase">Totales Generales</td>
                      <td className="px-6 py-6 text-center font-black text-primary text-base">{reportRows.length}</td>
                      <td className="px-6 py-6 text-right font-black text-primary text-lg tabular-nums">{formatNumber(grandTotal)}</td>
                      <td className="px-8 py-6 text-right font-black text-primary text-base">100,0%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ════ SECTION 3: Detalle por Suministro ════ */}
            <div className="page-break space-y-12">
               <SectionTitle num="03" title="Catálogo de Instalaciones" subtitle="Desglose técnico pormenorizado de cada punto de suministro" />
               
               <div className="grid grid-cols-1 gap-12 pt-4">
                 {reportRows.map((row, i) => {
                   const t = (row.tariff || '').toUpperCase()
                   const is20 = t.includes('2.0')
                   const isGas = row.supply_type === 'gas' || t.startsWith('RL')
                   const periods = isGas ? [] : is20 ? ['P1', 'P2', 'P3'] : ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
                   const rt = rowTotal(row)
                   const pct = grandTotal > 0 ? (rt / grandTotal * 100) : 0
                   
                   return (
                     <div key={row.id} className="relative overflow-hidden group pb-12 border-b border-outline-variant/10" style={{ breakInside: 'avoid' }}>
                        <div className="flex items-start justify-between mb-8">
                          <div className="flex items-center gap-6">
                            <div className="w-16 h-16 rounded-[1.5rem] bg-surface-container-high flex items-center justify-center text-3xl shadow-ambient-sm group-hover:scale-110 transition group-hover:bg-primary/10 transition-colors">
                              {isGas ? '🔥' : '⚡'}
                            </div>
                            <div>
                              <div className="flex items-center gap-3">
                                <h3 className="text-xl font-black text-on-surface">{row.name || 'Sin nombre'}</h3>
                                <div className="px-3 py-0.5 rounded-full bg-primary/10 text-[9px] font-black text-primary uppercase tracking-widest">{t}</div>
                              </div>
                              <p className="text-sm font-medium text-on-surface-variant mt-1">{row.address || 'Ubicación no especificada'}</p>
                              <p className="text-[10px] font-mono font-bold text-placeholder mt-0.5 tracking-tighter uppercase">{row.cups || 'CUPS NO DISPONIBLE'}</p>
                            </div>
                          </div>
                          <div className="text-right">
                             <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-1">Carga Anual</p>
                             <p className="text-3xl font-black text-on-surface tabular-nums">{formatNumber(rt)} <span className="text-xs font-bold text-placeholder mt-[-4px]">kWh</span></p>
                             <div className="flex items-center justify-end gap-2 mt-1">
                                <div className="w-20 h-1 bg-outline-variant/10 rounded-full overflow-hidden">
                                   <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[10px] font-black text-primary">{pct.toFixed(2)}% del total</span>
                             </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                           <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/5">
                             <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-4">Potencias Contratadas (kW)</p>
                             <div className="grid grid-cols-3 gap-y-4 gap-x-2">
                               {[1, 2, 3, 4, 5, 6].map(p => {
                                 const val = (row as any)[`potencia_p${p}`]
                                 const isActive = !isGas && (!is20 || p <= 2)
                                 return (
                                   <div key={p} className={isActive ? 'opacity-100' : 'opacity-20'}>
                                      <p className="text-[8px] font-black text-placeholder uppercase">P{p}</p>
                                      <p className="text-xs font-bold text-on-surface">{isActive && val ? Number(val).toFixed(2) : '—'}</p>
                                   </div>
                                 )
                               })}
                             </div>
                           </div>

                           <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/5 lg:col-span-2">
                             <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-4">Consumo por Periodo (kWh)</p>
                             <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                               {[1, 2, 3, 4, 5, 6].map((p, pi) => {
                                 const val = (row as any)[`consumo_p${p}`]
                                 const isActive = periods.includes(`P${p}`)
                                 return (
                                   <div key={p} className={`flex flex-col gap-1 ${isActive ? 'opacity-100' : 'opacity-20'}`}>
                                      <div className="w-full h-8 bg-surface-container-high rounded-lg relative overflow-hidden flex items-end">
                                        {isActive && val && (
                                          <div 
                                            className="w-full transition-all duration-1000" 
                                            style={{ 
                                              height: `${Math.min(100, (val / (rt || 1)) * 100 * 2.5)}%`,
                                              backgroundColor: PERIOD_COLORS[pi]
                                            }} 
                                          />
                                        )}
                                      </div>
                                      <p className="text-[8px] font-black text-placeholder uppercase text-center mt-1">P{p}</p>
                                      <p className="text-[10px] font-bold text-on-surface text-center tabular-nums">{isActive && val ? formatNumber(val) : '—'}</p>
                                   </div>
                                 )
                               })}
                             </div>
                           </div>
                        </div>
                     </div>
                   )
                 })}
               </div>
            </div>

            {/* ════ SECTION 4 (NEW): Informe de Optimización ════ */}
            <div className="page-break">
               <SectionTitle num="04" title="Conclusiones Técnicas" subtitle="Análisis cualitativo y hoja de ruta para la optimización energética" />
               <div className="mt-8 space-y-6">
                 {isEditing ? (
                   <div className="space-y-4">
                     <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest ml-4">Informe breve del analista</label>
                     <textarea
                       value={informeBreve}
                       onChange={(e) => setInformeBreve(e.target.value)}
                       placeholder="Escribe aqui el resumen ejecutivo o las recomendaciones tecnicas para el ayuntamiento..."
                       className="w-full h-64 p-8 rounded-[2rem] border-2 border-primary/20 bg-surface-container-low text-on-surface text-sm focus:border-primary outline-none transition-all shadow-inner leading-relaxed"
                     />
                   </div>
                 ) : (
                   <div className="p-10 rounded-[2.5rem] bg-gradient-to-br from-primary/5 to-transparent border border-primary/10 relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-8 opacity-5">
                       <FileText className="w-48 h-48" />
                     </div>
                     <div className="relative z-10">
                       <h4 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-6">Resumen Ejecutivo</h4>
                       <div className="text-on-surface-variant text-sm leading-relaxed whitespace-pre-wrap font-medium">
                         {informeBreve || 'No se han incluido conclusiones técnicas específicas para este informe. Edita este campo para añadir recomendaciones de ahorro, análisis de picos de potencia o comentarios sobre la red de suministros.'}
                       </div>
                     </div>
                   </div>
                 )}
               </div>
            </div>
            
            {/* ════ FOOTER (END) ════ */}
            <div className="pt-12 text-center space-y-4 border-t border-outline-variant/10">
               <div className="flex items-center justify-center gap-2">
                 <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white">
                   <Zap className="w-4 h-4" />
                 </div>
                 <span className="font-display font-black text-lg tracking-tight">VOLTIS</span>
               </div>
               <p className="text-[9px] font-bold text-placeholder uppercase tracking-[0.4em]">Inteligencia Operativa para la Gestión Energética</p>
               <div className="text-[8px] text-placeholder/50 flex justify-center gap-4">
                 <span>ID DOCUMENTO: {id?.toString().toUpperCase()}</span>
                 <span>PAGINA 1 DE 1 (FORMATO DIN-A4)</span>
                 <span>PROPIEDAD DE VOLTIS® - {new Date().getFullYear()}</span>
               </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
