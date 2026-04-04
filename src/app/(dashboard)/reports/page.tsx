'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Download, TrendingUp, Users, Zap, CreditCard, FileText, PieChart } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card, StatCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format'

interface ReportData {
  // Pipeline
  pipelineCounts: Record<string, number>
  // Revenue
  totalBilled: number
  totalPaid: number
  totalPending: number
  totalOverdue: number
  // Subscriptions
  activeSubscriptions: number
  mrrEstimated: number
  subscriptionsByModel: { fixed: number; percentage: number }
  // Supplies
  totalSupplies: number
  suppliesByType: { luz: number; gas: number; telefonia: number }
  conversionRate: number
  // Clients
  totalClients: number
  clientsByType: { empresa: number; particular: number; ayuntamiento: number }
  clientsByOrigin: Record<string, number>
  // Commercials
  commercialStats: { name: string; clients: number; supplies: number; signed: number }[]
}

const PIPELINE_LABELS: Record<string, string> = {
  primer_contacto: 'Contacto',
  facturas_recibidas: 'Facturas',
  prescoring_pendiente: 'Prescoring',
  prescoring_completado: 'Prescoring OK',
  estudio_en_curso: 'Estudio',
  estudio_completado: 'Estudio OK',
  presentacion_pendiente: 'Presentacion',
  presentacion_realizada: 'Presentacion OK',
  pendiente_firma: 'Pte. firma',
  firmado: 'Firmado',
  suscrito: 'Suscrito',
  seguimiento_activo: 'Seguimiento',
  rechazado: 'Rechazado',
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('all')

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true)
      const supabase = createClient()

      const [clientsRes, suppliesRes, billingRes, subsRes, usersRes] = await Promise.all([
        supabase.from('clients').select('id, type, origin, commercial_id'),
        supabase.from('supplies').select('id, type, status, client_id'),
        supabase.from('billing').select('id, status, total_amount, base_amount, paid_at'),
        supabase.from('subscriptions').select('id, model, plan_tier, percentage_value, payment_mode, status'),
        supabase.from('users_profile').select('id, full_name, role'),
      ])

      const clients = clientsRes.data || []
      const supplies = suppliesRes.data || []
      const billing = billingRes.data || []
      const subs = subsRes.data || []
      const users = usersRes.data || []

      // Pipeline counts
      const pipelineCounts: Record<string, number> = {}
      supplies.forEach((s: any) => {
        pipelineCounts[s.status] = (pipelineCounts[s.status] || 0) + 1
      })

      // Revenue
      const totalBilled = billing.reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0)
      const totalPaid = billing.filter((b: any) => b.status === 'paid').reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0)
      const totalPending = billing.filter((b: any) => b.status === 'sent').reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0)
      const totalOverdue = billing.filter((b: any) => b.status === 'overdue').reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0)

      // Subscriptions
      const activeSubs = subs.filter((s: any) => s.status === 'active')
      const mrrEstimated = activeSubs.reduce((sum: number, s: any) => {
        if (s.model === 'fixed' && s.plan_tier) {
          return sum + s.plan_tier / 3
        }
        return sum
      }, 0)

      // Supplies by type
      const suppliesByType = { luz: 0, gas: 0, telefonia: 0 }
      supplies.forEach((s: any) => {
        if (s.type in suppliesByType) (suppliesByType as any)[s.type]++
      })

      // Conversion rate
      const signedOrBeyond = supplies.filter((s: any) =>
        ['firmado', 'suscrito', 'seguimiento_activo'].includes(s.status)
      ).length
      const conversionRate = supplies.length > 0 ? (signedOrBeyond / supplies.length) * 100 : 0

      // Clients by type
      const clientsByType = { empresa: 0, particular: 0, ayuntamiento: 0 }
      clients.forEach((c: any) => {
        if (c.type in clientsByType) (clientsByType as any)[c.type]++
      })

      // Clients by origin
      const clientsByOrigin: Record<string, number> = {}
      clients.forEach((c: any) => {
        const o = c.origin || 'sin_definir'
        clientsByOrigin[o] = (clientsByOrigin[o] || 0) + 1
      })

      // Commercial stats
      const commercials = users.filter((u: any) => u.role === 'commercial' || u.role === 'admin')
      const commercialStats = commercials.map((u: any) => {
        const myClients = clients.filter((c: any) => c.commercial_id === u.id)
        const clientIds = myClients.map((c: any) => c.id)
        const mySupplies = supplies.filter((s: any) => clientIds.includes(s.client_id))
        const mySigned = mySupplies.filter((s: any) =>
          ['firmado', 'suscrito', 'seguimiento_activo'].includes(s.status)
        )
        return {
          name: u.full_name || u.id,
          clients: myClients.length,
          supplies: mySupplies.length,
          signed: mySigned.length,
        }
      })

      setData({
        pipelineCounts,
        totalBilled,
        totalPaid,
        totalPending,
        totalOverdue,
        activeSubscriptions: activeSubs.length,
        mrrEstimated: Math.round(mrrEstimated * 100) / 100,
        subscriptionsByModel: {
          fixed: subs.filter((s: any) => s.model === 'fixed').length,
          percentage: subs.filter((s: any) => s.model === 'percentage').length,
        },
        totalSupplies: supplies.length,
        suppliesByType,
        conversionRate: Math.round(conversionRate * 10) / 10,
        totalClients: clients.length,
        clientsByType,
        clientsByOrigin,
        commercialStats,
      })
      setLoading(false)
    }

    fetchReport()
  }, [period])

  const handleExportCSV = () => {
    if (!data) return
    const rows = [
      ['Metrica', 'Valor'],
      ['Clientes totales', data.totalClients],
      ['Suministros totales', data.totalSupplies],
      ['Tasa de conversion', `${data.conversionRate}%`],
      ['Suscripciones activas', data.activeSubscriptions],
      ['MRR estimado', data.mrrEstimated],
      ['Total facturado', data.totalBilled],
      ['Total cobrado', data.totalPaid],
      ['Pendiente de cobro', data.totalPending],
      ['Vencido', data.totalOverdue],
      [''],
      ['Pipeline', 'Cantidad'],
      ...Object.entries(data.pipelineCounts).map(([k, v]) => [PIPELINE_LABELS[k] || k, v]),
      [''],
      ['Comercial', 'Clientes', 'Suministros', 'Firmados'],
      ...data.commercialStats.map((c) => [c.name, c.clients, c.supplies, c.signed]),
    ]

    const csv = rows.map((r) => (r as any[]).join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_voltis_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div>
        <Header title="Informes" subtitle="Cargando datos..." />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div>
      <Header
        title="Informes"
        subtitle="Analisis completo de la actividad de Voltis Energia"
        actions={
          <Button variant="secondary" onClick={handleExportCSV}>
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* ═══ KPIs PRINCIPALES ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Clientes" value={data.totalClients} icon={Users} color="default" />
          <StatCard label="Suministros" value={data.totalSupplies} icon={Zap} color="default" />
          <StatCard label="Tasa de Conversion" value={`${data.conversionRate}%`} icon={TrendingUp} color="success" />
          <StatCard label="MRR Estimado" value={formatCurrency(data.mrrEstimated)} icon={CreditCard} color="success" />
        </div>

        {/* ═══ FACTURACION ═══ */}
        <Card>
          <h3 className="font-display font-semibold text-base text-on-surface mb-4">Facturacion</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-surface-container-low rounded-xl">
              <p className="text-xs text-on-surface-variant font-medium">Total Facturado</p>
              <p className="font-display font-bold text-xl text-on-surface mt-1">{formatCurrency(data.totalBilled)}</p>
            </div>
            <div className="text-center p-4 bg-success-container/30 rounded-xl">
              <p className="text-xs text-success font-medium">Cobrado</p>
              <p className="font-display font-bold text-xl text-success mt-1">{formatCurrency(data.totalPaid)}</p>
            </div>
            <div className="text-center p-4 bg-warning-container/30 rounded-xl">
              <p className="text-xs text-warning font-medium">Pendiente</p>
              <p className="font-display font-bold text-xl text-warning mt-1">{formatCurrency(data.totalPending)}</p>
            </div>
            <div className="text-center p-4 bg-error-container/30 rounded-xl">
              <p className="text-xs text-error font-medium">Vencido</p>
              <p className="font-display font-bold text-xl text-error mt-1">{formatCurrency(data.totalOverdue)}</p>
            </div>
          </div>
        </Card>

        {/* ═══ PIPELINE DETALLADO ═══ */}
        <Card>
          <h3 className="font-display font-semibold text-base text-on-surface mb-4">Pipeline Detallado</h3>
          <div className="space-y-2">
            {Object.entries(PIPELINE_LABELS).map(([key, label]) => {
              const count = data.pipelineCounts[key] || 0
              const pct = data.totalSupplies > 0 ? (count / data.totalSupplies) * 100 : 0
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-on-surface-variant w-28 text-right flex-shrink-0">{label}</span>
                  <div className="flex-1 bg-surface-container-high rounded-full h-6 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all flex items-center px-2 ${
                        key === 'rechazado' ? 'bg-error/70' :
                        ['firmado', 'suscrito', 'seguimiento_activo'].includes(key) ? 'bg-success' :
                        'bg-primary/70'
                      }`}
                      style={{ width: `${Math.max(pct, count > 0 ? 5 : 0)}%` }}
                    >
                      {pct > 8 && <span className="text-white text-[10px] font-bold">{count}</span>}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-on-surface w-8 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </Card>

        {/* ═══ DOS COLUMNAS: CLIENTES + SUSCRIPCIONES ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Clientes */}
          <Card>
            <h3 className="font-display font-semibold text-base text-on-surface mb-4">Clientes por tipo</h3>
            <div className="space-y-3">
              {Object.entries(data.clientsByType).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      type === 'empresa' ? 'bg-primary' : type === 'ayuntamiento' ? 'bg-secondary' : 'bg-on-surface-variant'
                    }`} />
                    <span className="text-sm capitalize text-on-surface">{type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold text-on-surface">{count}</span>
                    <span className="text-xs text-on-surface-variant">
                      ({data.totalClients > 0 ? Math.round((count / data.totalClients) * 100) : 0}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-surface-container-low">
              <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3">Por origen</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.clientsByOrigin).map(([origin, count]) => (
                  <Badge key={origin} variant="default">
                    <span className="capitalize">{origin.replace('_', ' ')}</span>: {count}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>

          {/* Suscripciones */}
          <Card>
            <h3 className="font-display font-semibold text-base text-on-surface mb-4">Suscripciones</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-3 bg-surface-container-low rounded-xl">
                <p className="text-xs text-on-surface-variant">Activas</p>
                <p className="font-display font-bold text-2xl text-success">{data.activeSubscriptions}</p>
              </div>
              <div className="text-center p-3 bg-surface-container-low rounded-xl">
                <p className="text-xs text-on-surface-variant">MRR</p>
                <p className="font-display font-bold text-2xl text-primary">{formatCurrency(data.mrrEstimated)}</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">Modelo fijo</span>
                <span className="font-semibold text-on-surface">{data.subscriptionsByModel.fixed}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">Modelo % ahorro</span>
                <span className="font-semibold text-on-surface">{data.subscriptionsByModel.percentage}</span>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-surface-container-low">
              <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3">Suministros por tipo</h4>
              <div className="flex gap-4">
                {Object.entries(data.suppliesByType).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    <span className="text-sm text-on-surface uppercase">{type}</span>
                    <span className="font-bold text-on-surface">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* ═══ RENDIMIENTO COMERCIALES ═══ */}
        {data.commercialStats.length > 0 && (
          <Card>
            <h3 className="font-display font-semibold text-base text-on-surface mb-4">Rendimiento por Comercial</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-container-low">
                    <th className="text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider px-4 py-2.5 rounded-l-xl">Comercial</th>
                    <th className="text-center text-xs font-semibold text-on-surface-variant uppercase tracking-wider px-4 py-2.5">Clientes</th>
                    <th className="text-center text-xs font-semibold text-on-surface-variant uppercase tracking-wider px-4 py-2.5">Suministros</th>
                    <th className="text-center text-xs font-semibold text-on-surface-variant uppercase tracking-wider px-4 py-2.5">Firmados</th>
                    <th className="text-center text-xs font-semibold text-on-surface-variant uppercase tracking-wider px-4 py-2.5 rounded-r-xl">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.commercialStats.map((c, i) => (
                    <tr key={i} className="border-b border-surface-container-low last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full gradient-primary flex items-center justify-center">
                            <span className="text-white text-xs font-bold">{c.name.charAt(0)}</span>
                          </div>
                          <span className="text-sm font-medium text-on-surface">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-display font-semibold text-on-surface">{c.clients}</td>
                      <td className="px-4 py-3 text-center font-display font-semibold text-on-surface">{c.supplies}</td>
                      <td className="px-4 py-3 text-center font-display font-semibold text-success">{c.signed}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={c.supplies > 0 && (c.signed / c.supplies) >= 0.3 ? 'success' : 'default'}>
                          {c.supplies > 0 ? Math.round((c.signed / c.supplies) * 100) : 0}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
