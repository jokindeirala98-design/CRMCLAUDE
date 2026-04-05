'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  ArrowLeft, FileText, Edit3, Save, Loader2, CheckCircle2, Printer,
  Zap, Flame, BarChart3, PieChart
} from 'lucide-react'
import type { ConsumptionSnapshot, AuditReport } from '@/types/database'
import {
  classifyRows, totalConsumption, periodTotals, sumField,
  formatKWh, formatNumber, formatKW, rowTotal,
  TARIFF_COLORS, PERIOD_COLORS, validateRowsForReport
} from '@/lib/consumption-utils'

export default function AuditReportPage() {
  const { id } = useParams()
  const router = useRouter()
  const [client, setClient] = useState<any>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [rows, setRows] = useState<ConsumptionSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [informeBreve, setInformeBreve] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const fetchData = useCallback(async () => {
    const supabase = createClient()

    // Fetch client
    const { data: clientData } = await supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()
    setClient(clientData)

    // Check for existing report
    const { data: reports } = await supabase
      .from('audit_reports')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (reports && reports.length > 0) {
      const r = reports[0] as AuditReport
      setReport(r)
      setInformeBreve(r.informe_breve || '')
      setRows((r.rows_snapshot || []) as ConsumptionSnapshot[])
      setLoading(false)
    } else {
      // No report yet — fetch live data and generate
      const { data: snapshots } = await supabase
        .from('consumption_snapshots')
        .select('*')
        .eq('client_id', id)
        .order('cups', { ascending: true })

      setRows(snapshots || [])
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

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
      }
    } catch (err) {
      console.error('Error generating report:', err)
    }
    setGenerating(false)
  }

  const saveReport = async () => {
    if (!report) return
    setSaving(true)
    try {
      await fetch('/api/audit-report', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: report.id, informe_breve: informeBreve, status: 'published' }),
      })
      setSaved(true)
      setIsEditing(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error saving:', err)
    }
    setSaving(false)
  }

  const handlePrint = () => {
    const style = document.createElement('style')
    style.id = '__print_report'
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #audit-report, #audit-report * { visibility: visible !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        #audit-report { position: absolute; left: 0; top: 0; width: 100% !important; }
        .no-print { display: none !important; }
        @page { margin: 15mm 20mm; size: A4 portrait; }
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
  const totals = periodTotals(classified.electricity)
  const generatedAt = report?.created_at ? new Date(report.created_at) : new Date()

  // If no report exists and no rows, show empty state
  if (!report && rows.length === 0) {
    return (
      <div>
        <Header
          title="Informe de auditoria"
          subtitle={client?.name}
          actions={
            <Button variant="ghost" onClick={() => router.push(`/clients/${id}`)}>
              <ArrowLeft className="w-4 h-4" /> Volver
            </Button>
          }
        />
        <div className="px-6 lg:px-8 pb-8">
          <Card>
            <div className="text-center py-12">
              <FileText className="w-10 h-10 text-on-surface-variant/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-on-surface">No hay datos de consumo</p>
              <p className="text-xs text-on-surface-variant mt-1">
                Primero importa datos en la seccion "Distribucion de consumo" de la ficha del cliente
              </p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => router.push(`/clients/${id}`)}>
                Volver a la ficha
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  // If data exists but no report, offer to generate
  if (!report && rows.length > 0) {
    return (
      <div>
        <Header
          title="Generar informe de auditoria"
          subtitle={client?.name}
          actions={
            <Button variant="ghost" onClick={() => router.push(`/clients/${id}`)}>
              <ArrowLeft className="w-4 h-4" /> Volver
            </Button>
          }
        />
        <div className="px-6 lg:px-8 pb-8">
          <Card>
            <div className="text-center py-8">
              <BarChart3 className="w-10 h-10 text-primary/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-on-surface">
                {rows.length} suministros listos para el informe
              </p>
              {!validation.valid && (
                <div className="mt-3 text-xs text-error">
                  {validation.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
              {validation.warnings.length > 0 && (
                <div className="mt-2 text-xs text-warning">
                  {validation.warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              )}
              <Button className="mt-4" onClick={generateReport} loading={generating}>
                <FileText className="w-4 h-4" />
                Generar informe
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  // ─── RENDER FULL REPORT ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-container-lowest">
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-30 bg-white border-b border-outline-variant/15 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/clients/${id}`)}>
            <ArrowLeft className="w-3.5 h-3.5" /> Volver
          </Button>
          <span className="text-sm font-semibold text-on-surface flex-1 truncate">
            {report?.title || 'Informe energetico'}
          </span>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-success font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Guardado
            </span>
          )}
          {isEditing ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setIsEditing(false)}>Cancelar</Button>
              <Button size="sm" onClick={saveReport} loading={saving}>
                <Save className="w-3.5 h-3.5" /> Guardar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setIsEditing(true)}>
              <Edit3 className="w-3.5 h-3.5" /> Editar
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={handlePrint}>
            <Printer className="w-3.5 h-3.5" /> Imprimir PDF
          </Button>
        </div>
      </div>

      {/* Report document */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div id="audit-report" className="bg-white rounded-2xl shadow-md p-8 md:p-12 space-y-10">

          {/* ─── SECTION: Cover / Header ─── */}
          <div className="text-center pb-8 border-b-2 border-primary/20">
            <div className="w-12 h-12 mx-auto mb-4 bg-primary/10 rounded-2xl flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <h1 className="font-display text-2xl font-bold text-on-surface">
              Informe de Auditoria Energetica
            </h1>
            <p className="text-lg text-on-surface-variant mt-2">{client?.name}</p>
            <p className="text-sm text-on-surface-variant mt-1">
              Generado el {generatedAt.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <div className="flex justify-center gap-6 mt-6 text-sm">
              <div>
                <p className="font-display font-bold text-2xl text-primary">{rows.length}</p>
                <p className="text-xs text-on-surface-variant">Suministros</p>
              </div>
              <div>
                <p className="font-display font-bold text-2xl text-primary">{formatKWh(totalConsumption(rows))}</p>
                <p className="text-xs text-on-surface-variant">Consumo total</p>
              </div>
              <div>
                <p className="font-display font-bold text-2xl text-primary">{classified.electricity.length}</p>
                <p className="text-xs text-on-surface-variant">Electricos</p>
              </div>
              <div>
                <p className="font-display font-bold text-2xl text-primary">{classified.gas.length}</p>
                <p className="text-xs text-on-surface-variant">Gas</p>
              </div>
            </div>
          </div>

          {/* ─── SECTION: Supply listing ─── */}
          <div>
            <h2 className="font-display font-semibold text-lg text-on-surface mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">1</span>
              Listado de suministros
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {rows.map(row => (
                <div key={row.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low/50 border border-outline-variant/10">
                  {row.supply_type === 'gas'
                    ? <Flame className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                    : <Zap className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-on-surface truncate">{row.cups}</p>
                    <p className="text-[10px] text-on-surface-variant">{row.tariff} · {formatKWh(rowTotal(row))}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ─── SECTION: KPI Summary ─── */}
          <div>
            <h2 className="font-display font-semibold text-lg text-on-surface mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">2</span>
              Resumen general
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {classified.td20.length > 0 && (
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                  <p className="text-xs font-semibold text-blue-700">Tarifa 2.0TD</p>
                  <p className="font-display font-bold text-xl text-blue-900 mt-1">{classified.td20.length}</p>
                  <p className="text-xs text-blue-600">{formatKWh(totalConsumption(classified.td20))}</p>
                </div>
              )}
              {classified.td30.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
                  <p className="text-xs font-semibold text-amber-700">Tarifa 3.0TD</p>
                  <p className="font-display font-bold text-xl text-amber-900 mt-1">{classified.td30.length}</p>
                  <p className="text-xs text-amber-600">{formatKWh(totalConsumption(classified.td30))}</p>
                </div>
              )}
              {classified.td61.length > 0 && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-100">
                  <p className="text-xs font-semibold text-red-700">Tarifa 6.1TD</p>
                  <p className="font-display font-bold text-xl text-red-900 mt-1">{classified.td61.length}</p>
                  <p className="text-xs text-red-600">{formatKWh(totalConsumption(classified.td61))}</p>
                </div>
              )}
              {classified.gas.length > 0 && (
                <div className="p-4 rounded-xl bg-purple-50 border border-purple-100">
                  <p className="text-xs font-semibold text-purple-700">Gas</p>
                  <p className="font-display font-bold text-xl text-purple-900 mt-1">{classified.gas.length}</p>
                  <p className="text-xs text-purple-600">{formatKWh(totalConsumption(classified.gas))}</p>
                </div>
              )}
            </div>
          </div>

          {/* ─── SECTION: Distribution by tariff ─── */}
          <div>
            <h2 className="font-display font-semibold text-lg text-on-surface mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">3</span>
              Distribucion de consumo por tarifa
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-outline-variant/20">
                    <th className="text-left py-2 font-semibold text-on-surface-variant">Tarifa</th>
                    <th className="text-center py-2 font-semibold text-on-surface-variant">Suministros</th>
                    <th className="text-right py-2 font-semibold text-on-surface-variant">Consumo total</th>
                    <th className="text-right py-2 font-semibold text-on-surface-variant">% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: '2.0TD', rows: classified.td20, color: 'blue' },
                    { label: '3.0TD', rows: classified.td30, color: 'amber' },
                    { label: '6.1TD', rows: classified.td61, color: 'red' },
                    { label: 'Gas', rows: classified.gas, color: 'purple' },
                  ].filter(g => g.rows.length > 0).map(group => {
                    const groupTotal = totalConsumption(group.rows)
                    const grandTotal = totalConsumption(rows)
                    const pct = grandTotal > 0 ? (groupTotal / grandTotal * 100) : 0
                    return (
                      <tr key={group.label} className="border-b border-outline-variant/10">
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold bg-${group.color}-50 text-${group.color}-700`}>
                            {group.label}
                          </span>
                        </td>
                        <td className="py-2.5 text-center font-medium">{group.rows.length}</td>
                        <td className="py-2.5 text-right font-medium tabular-nums">{formatKWh(groupTotal)}</td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-surface-container-low rounded-full overflow-hidden">
                              <div className={`h-full bg-${group.color}-400 rounded-full`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs tabular-nums font-medium">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-outline-variant/20 font-semibold">
                    <td className="py-2.5">Total</td>
                    <td className="py-2.5 text-center">{rows.length}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatKWh(totalConsumption(rows))}</td>
                    <td className="py-2.5 text-right">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ─── SECTION: Period breakdown (electricity) ─── */}
          {classified.electricity.length > 0 && (
            <div>
              <h2 className="font-display font-semibold text-lg text-on-surface mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">4</span>
                Consumo electrico por periodo
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-outline-variant/20">
                      <th className="text-left py-2 font-semibold text-on-surface-variant">Periodo</th>
                      <th className="text-right py-2 font-semibold text-on-surface-variant">Consumo (kWh)</th>
                      <th className="text-right py-2 font-semibold text-on-surface-variant">% del total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const).map((label, i) => {
                      const val = [totals.p1, totals.p2, totals.p3, totals.p4, totals.p5, totals.p6][i]
                      if (val === 0) return null
                      const pct = totals.total > 0 ? (val / totals.total * 100) : 0
                      return (
                        <tr key={label} className="border-b border-outline-variant/10">
                          <td className="py-2">
                            <span className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded" style={{ backgroundColor: PERIOD_COLORS[i] }} />
                              {label}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium">{formatNumber(val)}</td>
                          <td className="py-2 text-right text-xs tabular-nums">{pct.toFixed(1)}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-outline-variant/20 font-semibold">
                      <td className="py-2">Total</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(totals.total)}</td>
                      <td className="py-2 text-right">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ─── SECTION: Detail per tariff ─── */}
          {[
            { label: '2.0TD', rows: classified.td20, color: 'blue' },
            { label: '3.0TD', rows: classified.td30, color: 'amber' },
            { label: '6.1TD', rows: classified.td61, color: 'red' },
          ].filter(g => g.rows.length > 0).map((group, gi) => (
            <div key={group.label}>
              <h2 className="font-display font-semibold text-lg text-on-surface mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {5 + gi}
                </span>
                Detalle tarifa {group.label}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-outline-variant/20 text-on-surface-variant">
                      <th className="text-left py-2 font-semibold">CUPS</th>
                      <th className="text-left py-2 font-semibold">Comercializadora</th>
                      {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']).map(p => (
                        <th key={p} className="text-right py-2 font-semibold px-1">{p}</th>
                      ))}
                      <th className="text-right py-2 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(row => (
                      <tr key={row.id} className="border-b border-outline-variant/10">
                        <td className="py-1.5 font-mono">{row.cups?.slice(0, 20)}</td>
                        <td className="py-1.5 max-w-[120px] truncate">{row.comercializadora || '-'}</td>
                        <td className="py-1.5 text-right tabular-nums px-1">{row.consumo_p1 ? formatNumber(row.consumo_p1) : '-'}</td>
                        <td className="py-1.5 text-right tabular-nums px-1">{row.consumo_p2 ? formatNumber(row.consumo_p2) : '-'}</td>
                        <td className="py-1.5 text-right tabular-nums px-1">{row.consumo_p3 ? formatNumber(row.consumo_p3) : '-'}</td>
                        <td className="py-1.5 text-right tabular-nums px-1">{row.consumo_p4 ? formatNumber(row.consumo_p4) : '-'}</td>
                        <td className="py-1.5 text-right tabular-nums px-1">{row.consumo_p5 ? formatNumber(row.consumo_p5) : '-'}</td>
                        <td className="py-1.5 text-right tabular-nums px-1">{row.consumo_p6 ? formatNumber(row.consumo_p6) : '-'}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{formatNumber(rowTotal(row))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-outline-variant/20 font-semibold text-xs">
                      <td className="py-2" colSpan={2}>Total {group.label}</td>
                      {(['consumo_p1', 'consumo_p2', 'consumo_p3', 'consumo_p4', 'consumo_p5', 'consumo_p6'] as const).map(f => (
                        <td key={f} className="py-2 text-right tabular-nums px-1">{formatNumber(sumField(group.rows, f))}</td>
                      ))}
                      <td className="py-2 text-right tabular-nums">{formatNumber(totalConsumption(group.rows))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          {/* ─── SECTION: Gas ─── */}
          {classified.gas.length > 0 && (
            <div>
              <h2 className="font-display font-semibold text-lg text-on-surface mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  <Flame className="w-3 h-3" />
                </span>
                Suministros de gas
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-outline-variant/20 text-on-surface-variant">
                      <th className="text-left py-2 font-semibold">CUPS</th>
                      <th className="text-left py-2 font-semibold">Tarifa</th>
                      <th className="text-left py-2 font-semibold">Comercializadora</th>
                      <th className="text-left py-2 font-semibold">Direccion</th>
                      <th className="text-right py-2 font-semibold">Consumo total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classified.gas.map(row => (
                      <tr key={row.id} className="border-b border-outline-variant/10">
                        <td className="py-1.5 font-mono">{row.cups?.slice(0, 20)}</td>
                        <td className="py-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700">
                            {row.tariff || '-'}
                          </span>
                        </td>
                        <td className="py-1.5 max-w-[120px] truncate">{row.comercializadora || '-'}</td>
                        <td className="py-1.5 max-w-[150px] truncate">{row.address || '-'}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{formatNumber(rowTotal(row))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-outline-variant/20 font-semibold text-xs">
                      <td className="py-2" colSpan={4}>Total gas</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(totalConsumption(classified.gas))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ─── SECTION: Informe breve ─── */}
          <div>
            <h2 className="font-display font-semibold text-lg text-on-surface mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                <Edit3 className="w-3 h-3" />
              </span>
              Informe del asesor
            </h2>
            {isEditing ? (
              <textarea
                value={informeBreve}
                onChange={e => setInformeBreve(e.target.value)}
                placeholder="Escribe aqui tu analisis, conclusiones y recomendaciones para el cliente..."
                className="w-full min-h-[200px] p-4 text-sm text-on-surface bg-surface-container-low rounded-xl border border-outline-variant/20 outline-none focus:border-primary resize-y"
              />
            ) : (
              <div className="p-4 bg-surface-container-low/50 rounded-xl min-h-[100px]">
                {informeBreve ? (
                  <p className="text-sm text-on-surface whitespace-pre-wrap leading-relaxed">{informeBreve}</p>
                ) : (
                  <p className="text-sm text-on-surface-variant italic">
                    Sin informe del asesor. Pulsa "Editar" para anadir tus conclusiones y recomendaciones.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ─── SECTION: Footer ─── */}
          <div className="pt-8 border-t-2 border-outline-variant/10 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-primary" />
              <span className="font-display font-bold text-sm text-on-surface">Voltis</span>
            </div>
            <p className="text-xs text-on-surface-variant">
              Informe generado automaticamente por Voltis CRM
            </p>
            <p className="text-[10px] text-on-surface-variant mt-1">
              Los datos presentados son orientativos y estan basados en la informacion disponible a fecha del informe.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
