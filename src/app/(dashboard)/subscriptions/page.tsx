'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Plus, CreditCard, Send, X, Check, AlertCircle, Loader2, Search, Zap, Calendar,
  Euro, Ban, TrendingUp, ChevronDown, ChevronUp, XCircle, BarChart3, DollarSign,
  Clock, Users, AlertTriangle, ExternalLink, RefreshCw, Copy, Trash2, FileText
} from 'lucide-react'
import { GenerateInvoiceModal } from '@/components/billing/GenerateInvoiceModal'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card, StatCard } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate, calculateVAT, validateIBAN } from '@/lib/utils/format'
import { useAuthStore } from '@/stores/auth'
import type { Client, Subscription } from '@/types/database'

const VAT_RATE = 21
const PLAN_TIERS = [
  { value: 19.99, label: 'Basico', color: 'bg-info-container/40 text-info' },
  { value: 45, label: 'Profesional', color: 'bg-info-container/40 text-info' },
  { value: 90, label: 'Empresarial', color: 'bg-warn-container/40 text-warn' },
  { value: 180, label: 'Premium', color: 'bg-ok-container/40 text-ok' },
  { value: 260, label: 'Enterprise', color: 'bg-rose-50 text-rose-700' },
]

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

type Step = 'form' | 'preview' | 'processing' | 'awaiting_auth' | 'done' | 'error'

// Helper: get quarterly amount (with VAT) per subscription
function getQuarterlyAmount(sub: any): number {
  if (sub.model === 'percentage') {
    if (sub.total_savings && sub.percentage_value) {
      const pctAmount = sub.total_savings * (sub.percentage_value / 100)
      return calculateVAT(pctAmount).total
    }
    return 0
  }
  const tier = sub.plan_tier || 0
  return calculateVAT(tier).total
}

// Helper: get total annual income from a subscription
function getAnnualAmount(sub: any): number {
  if (sub.payment_mode === 'immediate') {
    if (sub.model === 'percentage') {
      if (!sub.total_savings || !sub.percentage_value) return 0
      return calculateVAT(sub.total_savings * (sub.percentage_value / 100)).total
    }
    return calculateVAT((sub.plan_tier || 0) * 4).total
  }
  // quarterly x4
  return getQuarterlyAmount(sub) * 4
}

export default function SubscriptionsPage() {
  const { user } = useAuthStore()
  const [subscriptions, setSubscriptions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [invoiceModal, setInvoiceModal] = useState<{ clientId: string; subscriptionId: string } | null>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [billings, setBillings] = useState<Record<string, any[]>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [renewingId, setRenewingId] = useState<string | null>(null)

  const fetchSubscriptions = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('subscriptions')
      .select('*, client:clients(name, cif_nif, email, phone, iban)')
      .order('created_at', { ascending: false })
    setSubscriptions(data || [])
    setLoading(false)

    // Fetch all billing records grouped by subscription
    const { data: billData } = await supabase
      .from('billing')
      .select('*')
      .not('subscription_id', 'is', null)
      .order('created_at', { ascending: false })
    if (billData) {
      const grouped: Record<string, any[]> = {}
      billData.forEach((b: any) => {
        if (!grouped[b.subscription_id]) grouped[b.subscription_id] = []
        grouped[b.subscription_id].push(b)
      })
      setBillings(grouped)
    }
  }

  useEffect(() => { fetchSubscriptions() }, [])

  // ─── Stats ───
  const stats = useMemo(() => {
    const active = subscriptions.filter((s) => s.status === 'active')
    const pending = subscriptions.filter((s) => s.status === 'pending_activation')
    const cancelled = subscriptions.filter((s) => s.status === 'cancelled')
    const expired = subscriptions.filter((s) => s.status === 'expired')

    const annualRevenue = active.reduce((sum, s) => sum + getAnnualAmount(s), 0)
    const monthlyRevenue = annualRevenue / 12

    return {
      active: active.length,
      pending: pending.length,
      cancelled: cancelled.length,
      expired: expired.length,
      total: subscriptions.length,
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
      annualRevenue: Math.round(annualRevenue * 100) / 100,
    }
  }, [subscriptions])

  // ─── Monthly Revenue Chart Data (next 12 months) ───
  const monthlyChart = useMemo(() => {
    const activeSubs = subscriptions.filter((s) => s.status === 'active' || s.status === 'pending_activation')
    const now = new Date()
    const months: { label: string; revenue: number; count: number }[] = []

    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const monthIdx = d.getMonth()
      const qMonth = monthIdx % 3 // 0,1,2 within quarter

      let revenue = 0
      let count = 0

      activeSubs.forEach((sub) => {
        if (sub.payment_mode === 'immediate') {
          // Single payments — only count in the month they were created
          const created = new Date(sub.created_at)
          if (created.getMonth() === monthIdx && created.getFullYear() === d.getFullYear()) {
            revenue += getAnnualAmount(sub)
            count++
          }
        } else {
          // Quarterly — revenue hits every 3 months (quarter start months: 0,3,6,9 relative to start)
          const start = new Date(sub.start_date || sub.created_at)
          const startQ = start.getMonth() % 3
          if (qMonth === startQ) {
            revenue += getQuarterlyAmount(sub)
            count++
          }
        }
      })

      months.push({
        label: `${MONTHS_ES[monthIdx]} ${String(d.getFullYear()).slice(2)}`,
        revenue: Math.round(revenue * 100) / 100,
        count,
      })
    }
    return months
  }, [subscriptions])

  const maxRevenue = Math.max(...monthlyChart.map((m) => m.revenue), 1)

  // ─── Filtered list ───
  const filtered = useMemo(() => {
    return subscriptions.filter((s) => {
      const matchSearch = !search ||
        s.client?.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.client?.cif_nif?.toLowerCase().includes(search.toLowerCase()) ||
        s.external_client_name?.toLowerCase().includes(search.toLowerCase())
      // Default view shows only active; cancelled/pending visible via explicit filter
      const matchStatus = filterStatus === 'all'
        ? s.status === 'active'
        : filterStatus === 'everything'
          ? true
          : s.status === filterStatus
      return matchSearch && matchStatus
    })
  }, [subscriptions, search, filterStatus])

  const statusConfig: Record<string, { label: string; bg: string; text: string; icon: any }> = {
    active: { label: 'Activa', bg: 'bg-ok-container/40', text: 'text-ok', icon: Check },
    pending_activation: { label: 'Pendiente', bg: 'bg-warn-container/40', text: 'text-warn', icon: Clock },
    paused: { label: 'Pausada', bg: 'bg-slate-100', text: 'text-slate-600', icon: AlertTriangle },
    cancelled: { label: 'Cancelada', bg: 'bg-err-container/40', text: 'text-err', icon: XCircle },
  }

  // ─── Cancel handler ───
  const handleCancel = async (sub: any) => {
    setCancellingId(sub.id)
    try {
      const res = await fetch('/api/gocardless/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: sub.id,
          gocardlessMandateId: sub.gocardless_mandate_id,
          gocardlessSubscriptionId: sub.gocardless_subscription_id,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      await fetchSubscriptions()
      setConfirmCancelId(null)
    } catch (err: any) {
      alert(`Error cancelando: ${err.message}`)
    } finally {
      setCancellingId(null)
    }
  }

  // ─── Delete handler ───
  const handleDelete = async (sub: any) => {
    setDeletingId(sub.id)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('subscriptions')
        .delete()
        .eq('id', sub.id)

      if (error) throw new Error(error.message)
      await fetchSubscriptions()
      setConfirmDeleteId(null)
    } catch (err: any) {
      alert(`Error eliminando suscripcion: ${err.message}`)
    } finally {
      setDeletingId(null)
    }
  }

  // ─── Renew handler ───
  const handleRenew = async (sub: any) => {
    setRenewingId(sub.id)
    try {
      const supabase = createClient()
      const today = new Date().toISOString().split('T')[0]
      const { error } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          start_date: today,
        })
        .eq('id', sub.id)

      if (error) throw new Error(error.message)
      await fetchSubscriptions()
    } catch (err: any) {
      alert(`Error renovando suscripcion: ${err.message}`)
    } finally {
      setRenewingId(null)
    }
  }

  // ─── Display amount helper ───
  const getDisplayAmount = (sub: any) => {
    const isPercentage = sub.model === 'percentage'
    if (isPercentage) {
      if (sub.total_savings) {
        const pctAmount = sub.total_savings * (sub.percentage_value / 100)
        const withVat = calculateVAT(pctAmount)
        return sub.payment_mode === 'immediate'
          ? formatCurrency(withVat.total)
          : `${formatCurrency(withVat.total / 4)}/trim`
      }
      return `${sub.percentage_value}% ahorro`
    }
    const tierVat = calculateVAT(sub.plan_tier || 0)
    return sub.payment_mode === 'immediate'
      ? formatCurrency(tierVat.total * 4)
      : `${formatCurrency(tierVat.total)}/trim`
  }

  return (
    <div>
      <Header
        title="Suscripciones"
        subtitle="Gestiona planes de pago y cobros GoCardless"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Añadir suscripcion
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* ─── Revenue Stats ─── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="!p-4 text-center">
            <Users className="w-5 h-5 text-ink-3 mx-auto mb-1" />
            <p className="font-sans font-bold text-2xl text-ink">{stats.total}</p>
            <p className="text-[11px] text-ink-3">Total</p>
          </Card>
          <Card className="!p-4 text-center">
            <Check className="w-5 h-5 text-ok mx-auto mb-1" />
            <p className="font-sans font-bold text-2xl text-ok">{stats.active}</p>
            <p className="text-[11px] text-ink-3">Activas</p>
          </Card>
          <Card className="!p-4 text-center">
            <Clock className="w-5 h-5 text-warn mx-auto mb-1" />
            <p className="font-sans font-bold text-2xl text-warn">{stats.pending}</p>
            <p className="text-[11px] text-ink-3">Pendientes</p>
          </Card>
          <Card className="!p-4 text-center">
            <XCircle className="w-5 h-5 text-err mx-auto mb-1" />
            <p className="font-sans font-bold text-2xl text-err">{stats.cancelled}</p>
            <p className="text-[11px] text-ink-3">Canceladas</p>
          </Card>
          <Card className="!p-4 text-center bg-gradient-to-br from-secondary/5 to-secondary/10">
            <DollarSign className="w-5 h-5 text-brand mx-auto mb-1" />
            <p className="font-sans font-bold text-2xl text-brand">{formatCurrency(stats.monthlyRevenue)}</p>
            <p className="text-[11px] text-ink-3">Ingreso mensual</p>
          </Card>
          <Card className="!p-4 text-center bg-gradient-to-br from-secondary/5 to-secondary/10">
            <TrendingUp className="w-5 h-5 text-brand mx-auto mb-1" />
            <p className="font-sans font-bold text-2xl text-brand">{formatCurrency(stats.annualRevenue)}</p>
            <p className="text-[11px] text-ink-3">Ingreso anual</p>
          </Card>
        </div>

        {/* ─── Monthly Revenue Chart ─── */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-brand" />
              <h3 className="font-sans font-semibold text-base text-ink">Ingresos previstos por mes</h3>
            </div>
            <p className="text-xs text-ink-3">Proximos 12 meses</p>
          </div>
          <div className="flex items-end gap-1.5 h-40">
            {monthlyChart.map((m, i) => {
              const pct = maxRevenue > 0 ? (m.revenue / maxRevenue) * 100 : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                  {/* Tooltip */}
                  <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-ink text-surface-container-lowest text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    <p className="font-semibold">{formatCurrency(m.revenue)}</p>
                    <p>{m.count} cobro{m.count !== 1 ? 's' : ''}</p>
                  </div>
                  {/* Bar */}
                  <div className="w-full flex flex-col items-center justify-end h-28">
                    <div
                      className={`w-full rounded-t-md transition-all ${m.revenue > 0 ? 'bg-secondary/70 group-hover:bg-brand' : 'bg-bg-2'}`}
                      style={{ height: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  {/* Label */}
                  <p className="text-[9px] text-ink-3 leading-tight">{m.label}</p>
                </div>
              )
            })}
          </div>
        </Card>

        {/* ─── Tier Summary ─── */}
        <Card>
          <h3 className="font-sans font-semibold text-sm text-ink mb-3">Tarifas de suscripcion</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {PLAN_TIERS.map((plan) => {
              const count = subscriptions.filter(
                (s) => s.model === 'fixed' && s.plan_tier === plan.value && s.status === 'active'
              ).length
              return (
                <div key={plan.value} className="bg-bg-2 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-ink-3 font-medium">{plan.label}</p>
                  <p className="font-sans font-bold text-lg text-ink">{formatCurrency(plan.value)}</p>
                  <p className="text-[10px] text-ink-3">
                    +IVA = {formatCurrency(calculateVAT(plan.value).total)} · {count} activa{count !== 1 ? 's' : ''}
                  </p>
                </div>
              )
            })}
          </div>
        </Card>

        {/* ─── Filters ─── */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
            <input
              type="text"
              placeholder="Buscar por cliente o CIF..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 border border-transparent focus:border-brand/30 focus:outline-none transition-all"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-bg-2 rounded-xl text-sm text-ink border border-transparent focus:border-brand/30 focus:outline-none"
          >
            <option value="all">Activas</option>
            <option value="pending_activation">Pendientes</option>
            <option value="paused">Pausadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="everything">Todas</option>
          </select>
        </div>

        {/* ─── Subscription List ─── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-brand" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <div className="text-center py-12">
              <CreditCard className="w-12 h-12 text-ink-3/30 mx-auto mb-3" />
              <p className="text-ink-3">No hay suscripciones</p>
              <Button onClick={() => setShowModal(true)} className="mt-4">
                <Plus className="w-4 h-4" /> Añadir primera suscripcion
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((sub) => {
              const sc = statusConfig[sub.status] || statusConfig.pending_activation
              const StatusIcon = sc.icon
              const isExpanded = expandedId === sub.id
              const isPercentage = sub.model === 'percentage'
              const annualAmt = getAnnualAmount(sub)
              const quarterlyAmt = getQuarterlyAmount(sub)

              return (
                <div key={sub.id} className="bg-card rounded-2xl shadow-ambient overflow-hidden">
                  {/* Main row */}
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-bg-2/30 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                  >
                    {/* Status dot */}
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sub.status === 'active' ? 'bg-ok' : sub.status === 'pending_activation' ? 'bg-warn' : sub.status === 'cancelled' ? 'bg-err' : 'bg-ink-4'}`} />

                    {/* Client */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{sub.client?.name || sub.external_client_name || '-'}</p>
                      <p className="text-xs text-ink-3">{sub.client?.cif_nif || (sub.external_client_name && !sub.client ? 'Cliente externo' : '')}</p>
                    </div>

                    {/* Model badge */}
                    <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isPercentage ? 'bg-info-container/40 text-info' : 'bg-info-container/40 text-info'}`}>
                      {isPercentage ? `${sub.percentage_value}%` : PLAN_TIERS.find(p => p.value === sub.plan_tier)?.label || 'Fija'}
                    </span>

                    {/* Amount */}
                    <div className="text-right min-w-[100px]">
                      <p className="font-sans font-semibold text-sm text-ink">{getDisplayAmount(sub)}</p>
                      <p className="text-[10px] text-ink-3">
                        {sub.payment_mode === 'immediate' ? 'Pago unico' : 'Trimestral'}
                      </p>
                    </div>

                    {/* Status badge */}
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                      <StatusIcon className="w-3 h-3" />
                      {sc.label}
                    </span>

                    {/* SEPA indicator */}
                    <div className="hidden md:flex items-center gap-1 min-w-[80px]">
                      {sub.gocardless_mandate_id ? (
                        <span className="text-xs text-ok flex items-center gap-1"><Check className="w-3 h-3" /> SEPA</span>
                      ) : (
                        <span className="text-xs text-ink-3/40">Sin SEPA</span>
                      )}
                    </div>

                    {/* Expand arrow */}
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-ink-3" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-ink-3" />
                    )}
                  </div>

                  {/* Expanded Detail */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 pt-1 border-t border-surface-container-low">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                            {/* Detail cards */}
                            <div className="bg-bg-2 rounded-xl p-3">
                              <p className="text-[10px] text-ink-3 font-medium uppercase tracking-wider mb-1">Modelo</p>
                              <p className="text-sm font-medium text-ink">
                                {isPercentage ? `${sub.percentage_value}% del ahorro` : `Plan ${PLAN_TIERS.find(p => p.value === sub.plan_tier)?.label || ''}`}
                              </p>
                              {isPercentage && sub.total_savings && (
                                <p className="text-xs text-ink-3 mt-0.5">Ahorro: {formatCurrency(sub.total_savings)}</p>
                              )}
                              {!isPercentage && (
                                <p className="text-xs text-ink-3 mt-0.5">{formatCurrency(sub.plan_tier || 0)} + IVA/trim</p>
                              )}
                            </div>

                            <div className="bg-bg-2 rounded-xl p-3">
                              <p className="text-[10px] text-ink-3 font-medium uppercase tracking-wider mb-1">Cobro</p>
                              {sub.payment_mode === 'immediate' ? (
                                <>
                                  <p className="text-sm font-medium text-ink">Pago unico</p>
                                  <p className="text-xs text-ink-3 mt-0.5">Total: {formatCurrency(annualAmt)}</p>
                                </>
                              ) : (
                                <>
                                  <p className="text-sm font-medium text-ink">{formatCurrency(quarterlyAmt)} x 4</p>
                                  <p className="text-xs text-ink-3 mt-0.5">Total anual: {formatCurrency(annualAmt)}</p>
                                </>
                              )}
                            </div>

                            <div className="bg-bg-2 rounded-xl p-3">
                              <p className="text-[10px] text-ink-3 font-medium uppercase tracking-wider mb-1">GoCardless</p>
                              {sub.gocardless_mandate_id ? (
                                <>
                                  <p className="text-xs text-ok font-medium flex items-center gap-1"><Check className="w-3 h-3" /> Mandato activo</p>
                                  <p className="text-[10px] text-ink-3 mt-0.5 font-mono truncate">{sub.gocardless_mandate_id}</p>
                                  {sub.gocardless_subscription_id && (
                                    <p className="text-[10px] text-ink-3 font-mono truncate">Sub: {sub.gocardless_subscription_id}</p>
                                  )}
                                </>
                              ) : (
                                <p className="text-xs text-ink-3">Sin mandato SEPA</p>
                              )}
                            </div>

                            <div className="bg-bg-2 rounded-xl p-3">
                              <p className="text-[10px] text-ink-3 font-medium uppercase tracking-wider mb-1">Fechas</p>
                              <p className="text-xs text-ink">Inicio: {formatDate(sub.start_date || sub.created_at)}</p>
                              {sub.next_billing_date && (
                                <p className="text-xs text-ink mt-0.5">Prox. cobro: {formatDate(sub.next_billing_date)}</p>
                              )}
                              {sub.cancelled_at && (
                                <p className="text-xs text-err mt-0.5">Cancelada: {formatDate(sub.cancelled_at)}</p>
                              )}
                            </div>
                          </div>

                          {/* IBAN */}
                          {sub.client_iban && (
                            <div className="mt-3 bg-bg-2 rounded-xl p-3 flex items-center justify-between">
                              <div>
                                <p className="text-[10px] text-ink-3 font-medium uppercase tracking-wider">IBAN</p>
                                <p className="text-sm font-mono text-ink mt-0.5">{sub.client_iban.replace(/(.{4})/g, '$1 ').trim()}</p>
                              </div>
                              {sub.client?.email && (
                                <div className="text-right">
                                  <p className="text-[10px] text-ink-3">Email</p>
                                  <p className="text-xs text-ink">{sub.client.email}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Payment History */}
                          {billings[sub.id] && billings[sub.id].length > 0 && (
                            <div className="mt-3">
                              <p className="text-[10px] text-ink-3 font-medium uppercase tracking-wider mb-2">Historial de pagos</p>
                              <div className="bg-bg-2 rounded-xl overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-surface-container-high">
                                      <th className="text-left px-3 py-2 text-ink-3 font-medium">Fecha</th>
                                      <th className="text-left px-3 py-2 text-ink-3 font-medium">Concepto</th>
                                      <th className="text-right px-3 py-2 text-ink-3 font-medium">Base</th>
                                      <th className="text-right px-3 py-2 text-ink-3 font-medium">IVA</th>
                                      <th className="text-right px-3 py-2 text-ink-3 font-medium">Total</th>
                                      <th className="text-center px-3 py-2 text-ink-3 font-medium">Estado</th>
                                      <th className="text-left px-3 py-2 text-ink-3 font-medium">GC ID</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {billings[sub.id].map((bill: any) => (
                                      <tr key={bill.id} className="border-b border-surface-container-high/50 last:border-0">
                                        <td className="px-3 py-2 text-ink">{formatDate(bill.created_at)}</td>
                                        <td className="px-3 py-2 text-ink truncate max-w-[160px]">{bill.concept}</td>
                                        <td className="px-3 py-2 text-ink text-right">{formatCurrency(bill.base_amount)}</td>
                                        <td className="px-3 py-2 text-ink text-right">{formatCurrency(bill.vat_amount)}</td>
                                        <td className="px-3 py-2 text-ink text-right font-medium">{formatCurrency(bill.total_amount)}</td>
                                        <td className="px-3 py-2 text-center">
                                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                            bill.status === 'paid' ? 'bg-ok-container/40 text-ok' :
                                            bill.status === 'sent' ? 'bg-info-container/40 text-info' :
                                            bill.status === 'overdue' ? 'bg-err-container/40 text-err' :
                                            'bg-slate-50 text-slate-600'
                                          }`}>
                                            {bill.status === 'paid' ? 'Cobrado' : bill.status === 'sent' ? 'Pendiente' : bill.status === 'overdue' ? 'Impagado' : bill.status === 'draft' ? 'Borrador' : bill.status}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2 text-ink-3 font-mono text-[10px] truncate max-w-[100px]">{bill.gocardless_payment_id || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="flex items-center justify-between mt-2 px-1">
                                <p className="text-[10px] text-ink-3">
                                  {billings[sub.id].length} pago{billings[sub.id].length !== 1 ? 's' : ''} ·
                                  Total cobrado: {formatCurrency(billings[sub.id].filter((b: any) => b.status === 'paid').reduce((s: number, b: any) => s + b.total_amount, 0))}
                                </p>
                                <p className="text-[10px] text-ink-3">
                                  Pendiente: {formatCurrency(billings[sub.id].filter((b: any) => b.status === 'sent').reduce((s: number, b: any) => s + b.total_amount, 0))}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* No payments yet */}
                          {(!billings[sub.id] || billings[sub.id].length === 0) && sub.status === 'active' && (
                            <div className="mt-3 bg-bg-2 rounded-xl p-3 text-center">
                              <p className="text-xs text-ink-3">Aun no hay pagos registrados. El primer cobro SEPA tarda 3-5 dias laborables.</p>
                            </div>
                          )}

                          {/* Generate Invoice button */}
                          {sub.client_id && (
                            <div className="mt-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setInvoiceModal({ clientId: sub.client_id, subscriptionId: sub.id })
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand border border-brand/30 bg-brand/5 rounded-lg hover:bg-brand/10 transition-colors"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                Generar factura
                              </button>
                            </div>
                          )}

                          {/* Renew button (for cancelled/expired) */}
                          {(sub.status === 'cancelled' || sub.status === 'expired') && (
                            <div className="mt-4 flex justify-end">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRenew(sub) }}
                                disabled={renewingId === sub.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ok border border-ok/30 bg-ok-container/40 rounded-lg hover:bg-ok-container transition-colors"
                              >
                                {renewingId === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                Renovar
                              </button>
                            </div>
                          )}

                          {/* Cancel button */}
                          {sub.status !== 'cancelled' && (
                            <div className="mt-4 flex justify-between">
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(sub.id) }}
                                disabled={deletingId === sub.id}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ink-3/50 hover:text-err transition-colors"
                              >
                                {deletingId === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                              {confirmCancelId === sub.id ? (
                                <div className="flex items-center gap-3 bg-err-container/40 rounded-xl px-4 py-2.5 border border-err/30">
                                  <AlertTriangle className="w-4 h-4 text-err" />
                                  <span className="text-sm text-err">Cancelar esta suscripcion y el cobro en GoCardless?</span>
                                  <button
                                    onClick={() => setConfirmCancelId(null)}
                                    className="px-3 py-1 text-xs font-medium text-ink-3 bg-white rounded-lg hover:bg-bg-2 transition-colors"
                                  >
                                    No
                                  </button>
                                  <button
                                    onClick={() => handleCancel(sub)}
                                    disabled={cancellingId === sub.id}
                                    className="px-3 py-1 text-xs font-medium text-white bg-err-container/400 rounded-lg hover:bg-err transition-colors flex items-center gap-1"
                                  >
                                    {cancellingId === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                    Si, cancelar
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setConfirmCancelId(sub.id) }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-err bg-err-container/40 rounded-lg hover:bg-err-container transition-colors"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  Cancelar suscripcion
                                </button>
                              )}
                            </div>
                          )}

                          {/* Delete confirmation (inline) */}
                          {confirmDeleteId === sub.id && (
                            <div className="mt-4 flex items-center gap-3 bg-err-container/40 rounded-xl px-4 py-2.5 border border-err/30">
                              <AlertTriangle className="w-4 h-4 text-err flex-shrink-0" />
                              <span className="text-sm text-err flex-1">¿Eliminar suscripción de <span className="font-semibold">{sub.client?.name || sub.external_client_name}</span>? Esta acción no se puede deshacer.</span>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-3 py-1 text-xs font-medium text-ink-3 bg-white rounded-lg hover:bg-bg-2 transition-colors flex-shrink-0"
                              >
                                No
                              </button>
                              <button
                                onClick={() => handleDelete(sub)}
                                disabled={deletingId === sub.id}
                                className="px-3 py-1 text-xs font-medium text-white bg-err-container/400 rounded-lg hover:bg-err transition-colors flex items-center gap-1 flex-shrink-0"
                              >
                                {deletingId === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                Si, eliminar
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
            <p className="text-xs text-ink-3 px-2 pt-1">
              {filtered.length} suscripcion{filtered.length !== 1 ? 'es' : ''}
            </p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showModal && (
          <NewSubscriptionWizard
            onClose={() => setShowModal(false)}
            onCreated={() => { fetchSubscriptions(); setShowModal(false) }}
          />
        )}
      </AnimatePresence>

      {invoiceModal && (
        <GenerateInvoiceModal
          preselectedClientId={invoiceModal.clientId}
          preselectedSubscriptionId={invoiceModal.subscriptionId}
          onClose={() => setInvoiceModal(null)}
          onCreated={() => { fetchSubscriptions(); setInvoiceModal(null) }}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
   New Subscription Wizard (modal)
   ═══════════════════════════════════════════════════════ */

function NewSubscriptionWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user } = useAuthStore()
  const [step, setStep] = useState<Step>('form')
  const [clients, setClients] = useState<Client[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [error, setError] = useState('')
  const [processingStep, setProcessingStep] = useState('')

  const [form, setForm] = useState({
    client_id: '',
    client_name: '',
    client_email: '',
    client_iban: '',
    model: '' as '' | 'percentage' | 'fixed',
    plan_tier: 0,
    percentage_value: 25,
    total_savings: '',
    payment_mode: '' as '' | 'immediate' | 'quarterly',
  })

  useEffect(() => {
    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, name, cif_nif, email, phone, iban')
        .order('name')
      setClients((data as Client[]) || [])
    }
    fetchClients()
  }, [])

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.cif_nif && c.cif_nif.toLowerCase().includes(clientSearch.toLowerCase()))
  )

  const selectClient = (c: Client) => {
    setForm({
      ...form,
      client_id: c.id,
      client_name: c.name,
      client_email: c.email || '',
      client_iban: (c as any).iban || '',
    })
    setClientSearch(c.name)
    setShowClientDropdown(false)
  }

  const calculation = useMemo(() => {
    if (form.model === 'percentage' && form.total_savings) {
      const savings = parseFloat(form.total_savings)
      if (isNaN(savings) || savings <= 0) return null
      const pctAmount = savings * (form.percentage_value / 100)
      const vat = calculateVAT(pctAmount)
      if (form.payment_mode === 'immediate') {
        return { base: vat.base, vat: vat.vat, total: vat.total, perPayment: vat.total, payments: 1, label: 'Pago unico' }
      } else if (form.payment_mode === 'quarterly') {
        const perQ = Math.round((vat.total / 4) * 100) / 100
        return { base: vat.base, vat: vat.vat, total: vat.total, perPayment: perQ, payments: 4, label: '4 pagos trimestrales' }
      }
    }
    if (form.model === 'fixed' && form.plan_tier > 0) {
      const tierVat = calculateVAT(form.plan_tier)
      if (form.payment_mode === 'immediate') {
        const annualBase = form.plan_tier * 4
        const annualVat = calculateVAT(annualBase)
        return { base: annualVat.base, vat: annualVat.vat, total: annualVat.total, perPayment: annualVat.total, payments: 1, label: 'Pago unico anual' }
      } else if (form.payment_mode === 'quarterly') {
        return { base: tierVat.base, vat: tierVat.vat, total: tierVat.total * 4, perPayment: tierVat.total, payments: 4, label: '4 pagos trimestrales' }
      }
    }
    return null
  }, [form])

  const ibanValidation = useMemo(() => {
    if (!form.client_iban || form.client_iban.length < 4) return null
    return validateIBAN(form.client_iban)
  }, [form.client_iban])

  const hasClient = form.client_id || form.client_name.trim()
  const isIbanValid = ibanValidation?.valid === true
  const canProceed = hasClient && form.model && form.payment_mode && isIbanValid && calculation

  const [authorisationUrl, setAuthorisationUrl] = useState('')
  const [createdSubscriptionId, setCreatedSubscriptionId] = useState('')
  const [billingRequestId, setBillingRequestId] = useState('')
  const [copied, setCopied] = useState(false)

  const handleActivate = async () => {
    if (!calculation) return
    setStep('processing')
    setError('')

    try {
      const supabase = createClient()

      setProcessingStep('Creando suscripcion...')
      const nextBilling = new Date()
      nextBilling.setMonth(nextBilling.getMonth() + 3)

      const { data: subData, error: subError } = await supabase.from('subscriptions').insert({
        client_id: form.client_id || null,
        external_client_name: !form.client_id ? form.client_name.trim() : null,
        external_client_email: !form.client_id ? (form.client_email || null) : null,
        model: form.model,
        plan_tier: form.model === 'fixed' ? form.plan_tier : null,
        percentage_value: form.model === 'percentage' ? form.percentage_value : null,
        payment_mode: form.payment_mode,
        annual_amount: calculation.total,
        total_savings: form.model === 'percentage' ? parseFloat(form.total_savings) : null,
        client_iban: form.client_iban,
        status: 'pending_activation',
        start_date: new Date().toISOString().split('T')[0],
        next_billing_date: form.payment_mode === 'quarterly' ? nextBilling.toISOString().split('T')[0] : null,
      }).select('id').single()

      if (subError) throw new Error(`Error creando suscripcion: ${subError.message}`)
      const subscriptionId = subData.id
      setCreatedSubscriptionId(subscriptionId)

      setProcessingStep('Creando mandato SEPA en GoCardless...')
      const mandateRes = await fetch('/api/gocardless/create-mandate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId,
          clientId: form.client_id || `ext-${Date.now()}`,
          clientName: form.client_name,
          clientEmail: form.client_email || 'noemail@voltisenergia.com',
          clientIban: form.client_iban,
        }),
      })

      const mandateData = await mandateRes.json()
      if (mandateData.error) throw new Error(`Error GoCardless mandato: ${mandateData.error}`)

      if (mandateData.mode === 'manual') {
        setStep('done')
        return
      }

      // GoCardless requires hosted flow — show authorisation link
      if (mandateData.mode === 'gocardless_flow' && mandateData.authorisationUrl) {
        setAuthorisationUrl(mandateData.authorisationUrl)
        setBillingRequestId(mandateData.billingRequestId)
        setStep('awaiting_auth')
        return
      }

      // Direct mandate (if ever supported) — create payment immediately
      setProcessingStep('Activando cobro...')
      const amountCents = Math.round(calculation.perPayment * 100)

      const paymentRes = await fetch('/api/gocardless/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mandateId: mandateData.mandateId,
          subscriptionId,
          clientId: form.client_id || null,
          amountCents,
          description: form.model === 'percentage'
            ? `Voltis Energia - ${form.percentage_value}% ahorro`
            : `Voltis Energia - Plan ${PLAN_TIERS.find(p => p.value === form.plan_tier)?.label || form.plan_tier}`,
          mode: form.payment_mode === 'immediate' ? 'single' : 'quarterly',
          installments: form.payment_mode === 'quarterly' ? 4 : undefined,
        }),
      })

      const paymentData = await paymentRes.json()
      if (paymentData.error) throw new Error(`Error GoCardless pago: ${paymentData.error}`)

      setProcessingStep('Finalizando...')
      await supabase.from('subscriptions').update({
        status: 'active',
        gocardless_customer_id: mandateData.customerId || null,
      }).eq('id', subscriptionId)

      setStep('done')
    } catch (err: any) {
      console.error('Subscription activation error:', err)
      setError(err.message || 'Error activando suscripcion')
      setStep('error')
    }
  }

  // Check if client has authorised the mandate, then create payment
  const [checkingMandate, setCheckingMandate] = useState(false)
  const handleCheckMandate = async () => {
    if (!billingRequestId || !createdSubscriptionId || checkingMandate) return
    setCheckingMandate(true)
    setStep('processing')
    setProcessingStep('Verificando autorizacion del mandato...')
    setError('')

    try {
      const checkRes = await fetch('/api/gocardless/check-mandate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: createdSubscriptionId,
          billingRequestId,
        }),
      })

      const checkData = await checkRes.json()

      if (checkData.status === 'fulfilled' && checkData.mandateId) {
        setProcessingStep('Mandato autorizado. Activando cobro...')
        const amountCents = Math.round((calculation?.perPayment || 0) * 100)

        const paymentRes = await fetch('/api/gocardless/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mandateId: checkData.mandateId,
            subscriptionId: createdSubscriptionId,
            clientId: form.client_id || null,
            amountCents,
            description: form.model === 'percentage'
              ? `Voltis Energia - ${form.percentage_value}% ahorro`
              : `Voltis Energia - Plan ${PLAN_TIERS.find(p => p.value === form.plan_tier)?.label || form.plan_tier}`,
            mode: form.payment_mode === 'immediate' ? 'single' : 'quarterly',
            installments: form.payment_mode === 'quarterly' ? 4 : undefined,
          }),
        })

        const paymentData = await paymentRes.json()
        if (paymentData.error) throw new Error(`Error GoCardless pago: ${paymentData.error}`)

        const supabase = createClient()
        await supabase.from('subscriptions').update({
          status: 'active',
        }).eq('id', createdSubscriptionId)

        setStep('done')
      } else if (checkData.status === 'cancelled') {
        setError('La solicitud fue cancelada.')
        setStep('error')
      } else {
        // Still pending
        setStep('awaiting_auth')
        setError('El cliente aun no ha completado la autorizacion. Envia el enlace y vuelve a verificar despues.')
      }
    } catch (err: any) {
      console.error('Check mandate error:', err)
      setError(err.message || 'Error verificando mandato')
      setStep('error')
    } finally {
      setCheckingMandate(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={step === 'processing' ? undefined : onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-card rounded-2xl shadow-ambient-lg w-full max-w-xl max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-low sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-secondary/10 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h2 className="font-sans font-semibold text-lg text-ink">
                {step === 'form' ? 'Nueva suscripcion' : step === 'preview' ? 'Confirmar' : step === 'processing' ? 'Activando...' : step === 'awaiting_auth' ? 'Pendiente de autorizacion' : step === 'done' ? 'Completado' : 'Error'}
              </h2>
              {step === 'form' && <p className="text-xs text-ink-3">GoCardless SEPA Direct Debit</p>}
            </div>
          </div>
          {step !== 'processing' && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-2 transition-all">
              <X className="w-5 h-5 text-ink-3" />
            </button>
          )}
        </div>

        {/* Form */}
        {step === 'form' && (
          <div className="p-6 space-y-5">
            {/* Client Search / Manual Entry */}
            <div className="relative">
              <label className="block text-sm font-medium text-ink mb-1.5">Cliente</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
                <input
                  type="text"
                  placeholder="Buscar cliente existente o escribir nombre..."
                  value={clientSearch}
                  onChange={(e) => {
                    setClientSearch(e.target.value)
                    setShowClientDropdown(true)
                    // If user is typing freely, set as external name (clear linked client)
                    if (form.client_id) {
                      setForm({ ...form, client_id: '', client_name: e.target.value, client_email: '' })
                    } else {
                      setForm({ ...form, client_name: e.target.value })
                    }
                  }}
                  onFocus={() => setShowClientDropdown(true)}
                  className="w-full pl-9 pr-3 py-2.5 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 border border-transparent focus:border-brand/30 focus:outline-none"
                />
              </div>
              {showClientDropdown && clientSearch && filteredClients.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-card rounded-xl shadow-ambient-lg border border-surface-container-low max-h-48 overflow-y-auto">
                  {filteredClients.slice(0, 8).map((c) => (
                    <button key={c.id} onClick={() => selectClient(c)} className="w-full text-left px-3 py-2 hover:bg-bg-2 transition-colors">
                      <p className="text-sm text-ink font-medium">{c.name}</p>
                      <p className="text-xs text-ink-3">{c.cif_nif || 'Sin CIF'}</p>
                    </button>
                  ))}
                </div>
              )}
              {form.client_id ? (
                <p className="mt-1 text-xs text-brand">Cliente del CRM: {form.client_name}</p>
              ) : form.client_name ? (
                <p className="mt-1 text-xs text-warn">Cliente externo (no esta en el CRM)</p>
              ) : null}
            </div>

            {/* Email (for external clients) */}
            {!form.client_id && form.client_name && (
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Email del cliente</label>
                <input
                  type="email"
                  placeholder="email@ejemplo.com"
                  value={form.client_email}
                  onChange={(e) => setForm({ ...form, client_email: e.target.value })}
                  className="w-full px-3 py-2.5 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 border border-transparent focus:border-brand/30 focus:outline-none"
                />
              </div>
            )}

            {/* IBAN */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">IBAN</label>
              <input
                type="text"
                placeholder="ES00 0000 0000 0000 0000 0000"
                value={form.client_iban}
                onChange={(e) => setForm({ ...form, client_iban: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                className="w-full px-3 py-2.5 bg-bg-2 rounded-xl text-sm text-ink font-mono placeholder:text-ink-3/50 border border-transparent focus:border-brand/30 focus:outline-none"
                maxLength={34}
              />
              {form.client_iban.length >= 4 && (
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-xs text-ink-3 font-mono">{form.client_iban.replace(/(.{4})/g, '$1 ').trim()}</p>
                  {ibanValidation && (
                    ibanValidation.valid
                      ? <span className="text-xs text-ok flex items-center gap-0.5"><Check className="w-3 h-3" /> Valido</span>
                      : <span className="text-xs text-err">{ibanValidation.error}</span>
                  )}
                </div>
              )}
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Tipo de plan</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setForm({ ...form, model: 'percentage', plan_tier: 0 })}
                  className={`p-4 rounded-xl text-left transition-all border-2 ${form.model === 'percentage' ? 'border-brand bg-secondary/5' : 'border-transparent bg-bg-2 hover:bg-bg-2'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Euro className="w-4 h-4 text-brand" />
                    <p className="text-sm font-semibold text-ink">25% del ahorro</p>
                  </div>
                  <p className="text-xs text-ink-3">Porcentaje sobre ahorro</p>
                </button>
                <button type="button" onClick={() => setForm({ ...form, model: 'fixed', total_savings: '' })}
                  className={`p-4 rounded-xl text-left transition-all border-2 ${form.model === 'fixed' ? 'border-brand bg-secondary/5' : 'border-transparent bg-bg-2 hover:bg-bg-2'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-brand" />
                    <p className="text-sm font-semibold text-ink">Suscripcion fija</p>
                  </div>
                  <p className="text-xs text-ink-3">Cuota fija segun tarifa</p>
                </button>
              </div>
            </div>

            {/* Percentage input */}
            {form.model === 'percentage' && (
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Ahorro total anual</label>
                <div className="relative">
                  <input type="number" placeholder="Ej: 2000" value={form.total_savings}
                    onChange={(e) => setForm({ ...form, total_savings: e.target.value })}
                    className="w-full px-3 py-2.5 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 border border-transparent focus:border-brand/30 focus:outline-none pr-10"
                    min="0" step="0.01" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">EUR</span>
                </div>
                {form.total_savings && parseFloat(form.total_savings) > 0 && (
                  <div className="mt-2 p-3 bg-secondary/5 rounded-lg text-xs text-ink-3">
                    25% de {formatCurrency(parseFloat(form.total_savings))} = <span className="font-semibold text-brand">{formatCurrency(parseFloat(form.total_savings) * 0.25)}</span> + IVA = <span className="font-semibold text-ink">{formatCurrency(calculateVAT(parseFloat(form.total_savings) * 0.25).total)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Fixed tier */}
            {form.model === 'fixed' && (
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Tarifa (sin IVA)</label>
                <div className="grid grid-cols-5 gap-2">
                  {PLAN_TIERS.map((tier) => (
                    <button key={tier.value} type="button" onClick={() => setForm({ ...form, plan_tier: tier.value })}
                      className={`p-3 rounded-xl text-center transition-all border-2 ${form.plan_tier === tier.value ? 'border-brand bg-secondary/5' : 'border-transparent bg-bg-2 hover:bg-bg-2'}`}>
                      <p className="font-sans font-bold text-sm text-ink">{tier.value}€</p>
                      <p className="text-[10px] text-ink-3 mt-0.5">{tier.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payment mode */}
            {form.model && (
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Modalidad de pago</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setForm({ ...form, payment_mode: 'immediate' })}
                    className={`p-4 rounded-xl text-left transition-all border-2 ${form.payment_mode === 'immediate' ? 'border-brand bg-secondary/5' : 'border-transparent bg-bg-2 hover:bg-bg-2'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-warn" />
                      <p className="text-sm font-semibold text-ink">Pago unico</p>
                    </div>
                    <p className="text-xs text-ink-3">{form.model === 'fixed' ? 'Trimestral x4 + IVA' : 'Total + IVA de una vez'}</p>
                  </button>
                  <button type="button" onClick={() => setForm({ ...form, payment_mode: 'quarterly' })}
                    className={`p-4 rounded-xl text-left transition-all border-2 ${form.payment_mode === 'quarterly' ? 'border-brand bg-secondary/5' : 'border-transparent bg-bg-2 hover:bg-bg-2'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Calendar className="w-4 h-4 text-info" />
                      <p className="text-sm font-semibold text-ink">Fraccionado</p>
                    </div>
                    <p className="text-xs text-ink-3">4 pagos trimestrales</p>
                  </button>
                </div>
              </div>
            )}

            {/* Preview */}
            {calculation && (
              <div className="bg-gradient-to-br from-secondary/5 to-secondary/10 rounded-xl p-5 border border-brand/20">
                <p className="text-xs font-semibold text-brand uppercase tracking-wider mb-3">Resumen del cobro</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-3">Base imponible</span>
                    <span className="text-ink font-medium">{formatCurrency(calculation.base)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-3">IVA (21%)</span>
                    <span className="text-ink font-medium">{formatCurrency(calculation.vat)}</span>
                  </div>
                  <div className="border-t border-brand/20 pt-2 flex justify-between">
                    <span className="text-sm font-semibold text-ink">Total</span>
                    <span className="font-sans font-bold text-lg text-brand">{formatCurrency(calculation.total)}</span>
                  </div>
                  {calculation.payments > 1 && (
                    <div className="pt-1 flex justify-between text-sm">
                      <span className="text-ink-3">{calculation.label}</span>
                      <span className="font-semibold text-ink">{formatCurrency(calculation.perPayment)} x {calculation.payments}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={() => setStep('preview')} disabled={!canProceed} className="flex-1">Revisar y activar</Button>
            </div>
          </div>
        )}

        {/* Preview confirm */}
        {step === 'preview' && calculation && (
          <div className="p-6 space-y-5">
            <div className="bg-bg-2 rounded-xl p-4 space-y-3">
              <div className="flex justify-between"><span className="text-xs text-ink-3">Cliente</span><span className="text-sm font-medium text-ink">{form.client_name}</span></div>
              <div className="flex justify-between"><span className="text-xs text-ink-3">IBAN</span><span className="text-sm font-mono text-ink">{form.client_iban.replace(/(.{4})/g, '$1 ').trim()}</span></div>
              <div className="flex justify-between"><span className="text-xs text-ink-3">Modelo</span><span className="text-sm text-ink">{form.model === 'percentage' ? `25% ahorro (${formatCurrency(parseFloat(form.total_savings))})` : `Plan ${PLAN_TIERS.find(p => p.value === form.plan_tier)?.label}`}</span></div>
              <div className="flex justify-between"><span className="text-xs text-ink-3">Pago</span><span className="text-sm text-ink">{calculation.label}</span></div>
              <div className="border-t border-surface-container-high pt-3 flex justify-between items-center">
                <span className="text-sm font-semibold text-ink">Cobro GoCardless</span>
                <div className="text-right">
                  <p className="font-sans font-bold text-xl text-brand">{formatCurrency(calculation.perPayment)}</p>
                  {calculation.payments > 1 && <p className="text-xs text-ink-3">x {calculation.payments} pagos</p>}
                </div>
              </div>
            </div>
            <div className="bg-warn-container/40 border border-warn/30 rounded-xl p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-warn flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warn">Cobro real en GoCardless</p>
                <p className="text-xs text-warn mt-0.5">Se creara mandato SEPA y se activara el cobro. Verifica los datos.</p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep('form')} className="flex-1">Volver</Button>
              <Button onClick={handleActivate} className="flex-1 bg-brand hover:bg-secondary/90"><Send className="w-4 h-4" /> Activar cobro</Button>
            </div>
          </div>
        )}

        {/* Processing */}
        {step === 'processing' && (
          <div className="p-6 flex flex-col items-center py-16">
            <Loader2 className="w-10 h-10 animate-spin text-brand mb-4" />
            <p className="text-sm font-medium text-ink">{processingStep}</p>
            <p className="text-xs text-ink-3 mt-1">No cierres esta ventana</p>
          </div>
        )}

        {/* Awaiting client authorisation */}
        {step === 'awaiting_auth' && (
          <div className="p-6 flex flex-col items-center py-8">
            <div className="w-14 h-14 rounded-full bg-warn-container flex items-center justify-center mb-4">
              <ExternalLink className="w-7 h-7 text-warn" />
            </div>
            <p className="text-lg font-sans font-semibold text-ink">Enlace de autorizacion listo</p>
            <p className="text-sm text-ink-3 mt-2 text-center max-w-sm">
              Envia este enlace al cliente por <strong>SMS, email o WhatsApp</strong>. Su nombre y email ya estan pre-rellenados — solo tiene que <strong>introducir su IBAN y confirmar</strong>.
            </p>

            <div className="mt-4 w-full max-w-sm space-y-3">
              {/* Link display + copy */}
              <div className="bg-bg-2 rounded-xl p-3 flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={authorisationUrl}
                  className="flex-1 text-xs text-ink bg-transparent border-none outline-none truncate font-mono"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(authorisationUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="p-1.5 rounded-lg bg-bg-2 hover:bg-line transition-colors flex-shrink-0"
                  title="Copiar enlace"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5 text-ink-3" />}
                </button>
              </div>

              {/* Open link */}
              <a
                href={authorisationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-brand text-white rounded-xl font-medium text-sm hover:bg-secondary/90 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Abrir enlace de autorizacion
              </a>
            </div>

            {error && (
              <p className="text-xs text-warn mt-3 text-center max-w-sm">{error}</p>
            )}

            <div className="flex gap-3 mt-5">
              <Button variant="secondary" onClick={() => onCreated()}>
                Cerrar (queda pendiente)
              </Button>
              <button
                onClick={handleCheckMandate}
                className="flex items-center gap-2 px-4 py-2 bg-ok text-white rounded-xl font-medium text-sm hover:opacity-90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Verificar y activar cobro
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="p-6 flex flex-col items-center py-16">
            <div className="w-16 h-16 rounded-full bg-ok-container flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-ok" />
            </div>
            <p className="text-lg font-sans font-semibold text-ink">Suscripcion activada</p>
            <p className="text-sm text-ink-3 mt-1 text-center">Mandato SEPA autorizado y cobro activado en GoCardless.</p>
            <Button onClick={onCreated} className="mt-6">Cerrar</Button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="p-6 flex flex-col items-center py-12">
            <div className="w-16 h-16 rounded-full bg-err-container flex items-center justify-center mb-4">
              <Ban className="w-8 h-8 text-err" />
            </div>
            <p className="text-lg font-sans font-semibold text-ink">Error al activar</p>
            <p className="text-sm text-err mt-2 text-center max-w-sm">{error}</p>
            <div className="flex gap-3 mt-6">
              <Button variant="secondary" onClick={() => setStep('form')}>Volver</Button>
              <Button onClick={onClose}>Cerrar</Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
