'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Zap, CreditCard, Euro, TrendingUp, AlertCircle,
  CheckCircle2, Clock, Activity, ChevronRight, FileBarChart2,
  Circle, Check, Loader2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils/format'
import type { Client, Supply, Subscription, Billing, Task, Notification } from '@/types/database'

// ---- Types ----
interface MetricCard {
  label: string
  value: string
  subStat: string
  icon: React.ComponentType<any>
  color: 'blue' | 'violet' | 'green' | 'amber'
  href: string
}

interface PipelineBlock {
  status: string
  label: string
  count: number
  color: string
  textColor: string
}

interface TaskWithUser extends Omit<Task, 'assigned_user'> {
  assigned_user?: { full_name: string } | null
}

interface NotificationWithMetadata extends Notification {
  icon?: React.ComponentType<any>
}

interface SupplyWithClient extends Supply {
  client?: Client
}

interface SubscriptionWithPlan extends Omit<Subscription, 'plan_tier'> {
  plan_tier?: number | null
}

// ---- Supply Status Config ----
const SUPPLY_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  primer_contacto:      { label: 'Primer contacto',     bg: 'bg-info-container',    text: 'text-info' },
  facturas_recibidas:   { label: 'Esperando informes',   bg: 'bg-warn-container',    text: 'text-warn' }, // legacy
  prescoring_pendiente: { label: 'Prescoring pendiente', bg: 'bg-warn-container',    text: 'text-warn' },
  estudio_en_curso:     { label: 'Estudio en curso',     bg: 'bg-warn-container',    text: 'text-warn' },
  presentacion:         { label: 'Presentación',         bg: 'bg-neutral-container', text: 'text-neutral' },
  pte_firma:            { label: 'Pte. firma',           bg: 'bg-warn-container',    text: 'text-warn' },
  firmado:              { label: 'Firmado',              bg: 'bg-ok-container',      text: 'text-ok' },
  suscrito:             { label: 'Suscrito',             bg: 'bg-ok-container',      text: 'text-ok' },
}

const PIPELINE_STATUSES = [
  'primer_contacto',
  'estudio_en_curso',
  'prescoring_pendiente',
  'presentacion',
  'pte_firma',
  'firmado',
  'suscrito',
]

// ---- Helper Functions ----
function calculateMRR(subscriptions: SubscriptionWithPlan[]): number {
  return subscriptions.reduce((sum, sub) => {
    if (sub.status !== 'active' || !sub.plan_tier || !sub.annual_amount) return sum
    return sum + sub.annual_amount / 12
  }, 0)
}

function getRelativeTime(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (seconds < 60) return 'Justo ahora'
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `Hace ${Math.floor(seconds / 86400)}d`
  return formatDate(d)
}

// ---- Main Component ----
export default function PanelPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [loadingTasks, setLoadingTasks] = useState(true)

  // Metrics state
  const [clientsCount, setClientsCount] = useState(0)
  const [clientTypes, setClientTypes] = useState({ empresa: 0, particular: 0 })
  const [suppliesCount, setSuppliesCount] = useState(0)
  const [suppliesByStatus, setSuppliesByStatus] = useState<Record<string, number>>({})
  const [supplySigned, setSupplySigned] = useState(0)
  const [supplyPending, setSupplyPending] = useState(0)
  const [activeSubscriptions, setActiveSubscriptions] = useState(0)
  const [mrr, setMRR] = useState(0)
  const [totalBilling, setTotalBilling] = useState(0)
  const [pendingBilling, setPendingBilling] = useState(0)

  // Tasks and notifications
  const [tasks, setTasks] = useState<TaskWithUser[]>([])
  const [notifications, setNotifications] = useState<NotificationWithMetadata[]>([])
  const [completedStudies, setCompletedStudies] = useState<any[]>([])

  // Fetch all metrics in parallel
  const fetchMetrics = useCallback(async () => {
    const supabase = createClient()
    setLoading(true)

    try {
      const [
        { count: clientCount, data: clientsData },
        { count: suppliesTotal, data: suppliesData },
        { data: subscriptionsData },
        { data: billingData },
      ] = await Promise.all([
        supabase
          .from('clients')
          .select('id, type', { count: 'exact', head: true })
          .then((res) => ({ count: res.count || 0, data: res.data })),
        supabase
          .from('supplies')
          .select('id, status', { count: 'exact' })
          .then((res) => ({ count: res.count || 0, data: res.data })),
        supabase.from('subscriptions').select('*').eq('status', 'active'),
        supabase
          .from('billing')
          .select('*')
          .in('status', ['paid', 'overdue', 'sent']),
      ])

      // Count clients by type
      const clients = await supabase
        .from('clients')
        .select('id, type', { count: 'exact' })

      if (clients.data) {
        const typeCounts = clients.data.reduce(
          (acc: any, client: any) => {
            acc[client.type] = (acc[client.type] || 0) + 1
            return acc
          },
          {}
        )
        setClientTypes({
          empresa: typeCounts['empresa'] || 0,
          particular: typeCounts['particular'] || 0,
        })
        setClientsCount(clients.count || 0)
      }

      // Process supplies
      if (suppliesData) {
        setSuppliesCount(suppliesTotal)
        const statusCounts: Record<string, number> = {}
        suppliesData.forEach((supply: any) => {
          statusCounts[supply.status] = (statusCounts[supply.status] || 0) + 1
        })
        setSuppliesByStatus(statusCounts)
        setSupplySigned(statusCounts['firmado'] || 0)
        setSupplyPending(
          (statusCounts['primer_contacto'] || 0) +
            (statusCounts['prescoring_pendiente'] || 0) +
            (statusCounts['estudio_en_curso'] || 0)
        )
      }

      // Process subscriptions
      if (subscriptionsData) {
        setActiveSubscriptions(subscriptionsData.length)
        const mrrValue = calculateMRR(subscriptionsData)
        setMRR(mrrValue)
      }

      // Process billing
      if (billingData) {
        const paid = billingData
          .filter((b: any) => b.status === 'paid')
          .reduce((sum: number, b: any) => sum + b.total_amount, 0)
        setTotalBilling(paid)

        const pending = billingData
          .filter((b: any) => b.status !== 'paid')
          .reduce((sum: number, b: any) => sum + b.total_amount, 0)
        setPendingBilling(pending)
      }
    } catch (error) {
      console.error('Error fetching metrics:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    const supabase = createClient()
    setLoadingTasks(true)

    try {
      const { data } = await supabase
        .from('tasks')
        .select(
          `
          *,
          assigned_user:assigned_to(full_name)
        `
        )
        .in('status', ['pending', 'in_progress'])
        .order('priority', { ascending: false })
        .order('due_date', { ascending: true })
        .limit(8)

      setTasks((data as TaskWithUser[]) || [])
    } catch (error) {
      console.error('Error fetching tasks:', error)
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  // Mark task as completed — optimistic: remove from UI instantly, DB in background
  const completeTask = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTasks(prev => prev.filter(t => t.id !== taskId))
    const supabase = createClient()
    supabase
      .from('tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', taskId)
      .then(() => fetchTasks())
  }

  const handleTaskClick = (task: TaskWithUser) => {
    if (task.related_entity_type === 'client' && task.related_entity_id) {
      router.push(`/clients/${task.related_entity_id}`)
    } else {
      router.push(`/agenda`)
    }
  }

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    const supabase = createClient()

    try {
      const { data: notifsData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user?.id)
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(5)

      const { data: studiesData } = await supabase
        .from('studies')
        .select(
          `
          id,
          status,
          supply_id,
          created_at,
          supply:supplies(
            id,
            cups,
            client_id,
            client:clients(name)
          )
        `
        )
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(3)

      setNotifications((notifsData || []) as NotificationWithMetadata[])
      setCompletedStudies((studiesData || []) as any[])
    } catch (error) {
      console.error('Error fetching notifications:', error)
    }
  }, [user?.id])

  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set())

  const dismissNotification = (notifId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const notif = notifications.find(n => n.id === notifId)
    setNotifications(prev => prev.filter(n => n.id !== notifId))
    const supabase = createClient()
    supabase.from('notifications').update({ read: true }).eq('id', notifId)
    if (notif?.type === 'estudio_completado' && (notif as any).metadata?.supply_id) {
      const supplyId = (notif as any).metadata.supply_id
      supabase
        .from('supplies')
        .update({ status: 'presentado', updated_at: new Date().toISOString() })
        .eq('id', supplyId)
    }
  }

  const dismissStudy = (study: any, e: React.MouseEvent) => {
    e.stopPropagation()
    setCompletedStudies(prev => prev.filter(s => s.id !== study.id))
    setNotifications(prev => prev.filter(n =>
      !(n.type === 'estudio_completado' && (n as any).metadata?.supply_id === study.supply_id)
    ))
    const supabase = createClient()
    if (study.supply_id) {
      supabase
        .from('supplies')
        .update({ status: 'presentado', updated_at: new Date().toISOString() })
        .eq('id', study.supply_id)
      supabase
        .from('notifications')
        .update({ read: true })
        .eq('type', 'estudio_completado')
        .contains('metadata', { supply_id: study.supply_id })
    }
  }

  useEffect(() => {
    fetchMetrics()
    fetchTasks()
    fetchNotifications()
  }, [fetchMetrics, fetchTasks, fetchNotifications])

  // Metric cards config — colors map to semantic tokens
  const metricCards: MetricCard[] = [
    {
      label: 'Clientes',
      value: String(clientsCount),
      subStat: `${clientTypes.empresa} empresas · ${clientTypes.particular} particulares`,
      icon: Users,
      color: 'blue',
      href: '/clients',
    },
    {
      label: 'Suministros',
      value: String(suppliesCount),
      subStat: `${supplySigned} firmados · ${supplyPending} pendientes`,
      icon: Zap,
      color: 'violet',
      href: '/supplies',
    },
    {
      label: 'Suscripciones activas',
      value: String(activeSubscriptions),
      subStat: `MRR: ${formatCurrency(mrr)}`,
      icon: CreditCard,
      color: 'green',
      href: '/subscriptions',
    },
    {
      label: 'Facturación',
      value: formatCurrency(totalBilling),
      subStat: `${pendingBilling > 0 ? formatCurrency(pendingBilling) : '0 €'} pendientes`,
      icon: Euro,
      color: 'amber',
      href: '/billing',
    },
  ]

  // Pipeline blocks — use semantic bg/text
  const pipelineBlocks: PipelineBlock[] = PIPELINE_STATUSES.map((status) => ({
    status,
    label: SUPPLY_STATUS_CONFIG[status]?.label || status,
    count: suppliesByStatus[status] || 0,
    color: SUPPLY_STATUS_CONFIG[status]?.bg || 'bg-bg-2',
    textColor: SUPPLY_STATUS_CONFIG[status]?.text || 'text-ink-3',
  })).filter((block) => block.count > 0)

  const totalInPipeline = pipelineBlocks.reduce((sum, block) => sum + block.count, 0)

  // Metric card accent — semantic
  const metricColorMap: Record<string, string> = {
    blue:   'border-info/20   hover:border-info/40   bg-info-container/40   text-info',
    violet: 'border-line-2    hover:border-ink-4/40  bg-bg-2                text-ink-2',
    green:  'border-ok/20     hover:border-ok/40     bg-ok-container/40     text-ok',
    amber:  'border-warn/20   hover:border-warn/40   bg-warn-container/40   text-warn',
  }

  // Task priority styles — semantic
  const priorityStyles = (priority: string) => {
    if (priority === 'high')   return { card: 'bg-err-container/50  border-err/30  hover:bg-err-container',  text: 'text-err',  check: 'border-err  hover:bg-err' }
    if (priority === 'medium') return { card: 'bg-warn-container/50 border-warn/30 hover:bg-warn-container', text: 'text-warn', check: 'border-warn hover:bg-warn' }
    return                            { card: 'bg-ok-container/50   border-ok/30   hover:bg-ok-container',   text: 'text-ok',   check: 'border-ok   hover:bg-ok' }
  }

  return (
    <div className="min-h-screen bg-bg">
      <Header title="Panel" subtitle="Vista general" />

      <main className="px-4 lg:px-6 py-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">

          {/* SECTION 1: Metric Cards */}
          <motion.div
            key="metrics"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6"
          >
            {metricCards.map((card, idx) => {
              const Icon = card.icon
              return (
                <motion.button
                  key={card.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.06 }}
                  onClick={() => router.push(card.href)}
                  className={`text-left p-5 rounded-xl border transition-all duration-200 hover:scale-[1.01] active:scale-95 group cursor-pointer ${metricColorMap[card.color]}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-ink-3 mb-2 group-hover:text-ink transition-colors">
                        {card.label}
                      </p>
                      <h3 className="text-3xl font-bold text-ink mb-1 tabular-nums">
                        {loading ? '—' : card.value}
                      </h3>
                      <p className="text-xs text-ink-3 line-clamp-1">
                        {card.subStat}
                      </p>
                    </div>
                    <Icon className="w-7 h-7 opacity-50 group-hover:opacity-80 transition-opacity flex-shrink-0 mt-0.5" />
                  </div>
                </motion.button>
              )
            })}
          </motion.div>

          {/* SECTION 2: Pipeline Overview */}
          {pipelineBlocks.length > 0 && (
            <motion.div
              key="pipeline"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.15 }}
              className="bg-card border border-line rounded-xl p-5 mb-6"
            >
              <h2 className="text-sm font-semibold text-ink mb-3">Pipeline de suministros</h2>
              <div className="flex gap-0.5 h-9 rounded-lg overflow-hidden bg-bg-2">
                {pipelineBlocks.map((block) => {
                  const percentage = (block.count / totalInPipeline) * 100
                  return (
                    <motion.button
                      key={block.status}
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.4, delay: 0.05 }}
                      onClick={() => router.push(`/supplies?status=${block.status}`)}
                      className={`${block.color} relative group flex items-center justify-center text-xs font-bold transition-all hover:brightness-95 cursor-pointer`}
                      title={`${block.label}: ${block.count}`}
                    >
                      <span className={`${block.textColor} font-mono text-[10px] font-semibold opacity-80 group-hover:opacity-100`}>
                        {block.count}
                      </span>
                    </motion.button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                {pipelineBlocks.map((block) => (
                  <div key={block.status} className="text-xs">
                    <p className="font-medium text-ink truncate">{block.label}</p>
                    <p className="text-ink-3">{block.count} suministros</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* SECTION 3: Tasks & Activity */}
          <motion.div
            key="tasks-notifs"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6"
          >
            {/* Tareas prioritarias */}
            <div className="bg-card border border-line rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink">Tareas prioritarias</h2>
                <button
                  onClick={() => router.push('/agenda')}
                  className="text-xs text-brand hover:text-brand-2 font-medium flex items-center gap-1 transition-colors"
                >
                  Ver todas
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {loadingTasks ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-11 bg-bg-2 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="w-7 h-7 mx-auto mb-2 text-ink-4" />
                  <p className="text-sm font-medium text-ink-3">Aún no hay tareas pendientes</p>
                  <p className="text-xs text-ink-4 mt-0.5">Estás al día.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {tasks.map((task) => {
                    const ps = priorityStyles(task.priority)
                    return (
                      <motion.div
                        key={task.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16, height: 0 }}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${ps.card}`}
                        onClick={() => handleTaskClick(task)}
                      >
                        <div className="flex items-start gap-2.5">
                          <button
                            onClick={(e) => completeTask(task.id, e)}
                            className={`mt-0.5 flex-shrink-0 w-4.5 h-4.5 rounded-full border-2 ${ps.check} flex items-center justify-center transition-all group/check`}
                            title="Marcar como hecha"
                          >
                            <Check className="w-2.5 h-2.5 text-transparent group-hover/check:text-white transition-colors" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${ps.text} line-clamp-1`}>
                              {task.title}
                            </p>
                            <div className={`flex items-center gap-2 text-xs ${ps.text} opacity-70 mt-0.5`}>
                              {task.due_date && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {formatDate(task.due_date)}
                                </span>
                              )}
                              {task.assigned_user && (
                                <span>{task.assigned_user.full_name}</span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className={`w-3.5 h-3.5 ${ps.text} opacity-50 flex-shrink-0 mt-0.5`} />
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Actividad reciente */}
            <div className="bg-card border border-line rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink">Actividad reciente</h2>
                <button
                  onClick={() => router.push('/notifications')}
                  className="text-xs text-brand hover:text-brand-2 font-medium flex items-center gap-1 transition-colors"
                >
                  Ver todas
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {notifications.length === 0 && completedStudies.length === 0 ? (
                <div className="py-8 text-center">
                  <Activity className="w-7 h-7 mx-auto mb-2 text-ink-4" />
                  <p className="text-sm font-medium text-ink-3">Sin actividad reciente</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {notifications.map((notif) => (
                    <motion.div
                      key={notif.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16, height: 0 }}
                      className="p-3 bg-bg-2 rounded-lg hover:bg-line/60 transition-colors cursor-pointer border border-transparent hover:border-line-2"
                      onClick={() => { if (notif.link) router.push(notif.link) }}
                    >
                      <div className="flex items-start gap-2.5">
                        <button
                          onClick={(e) => dismissNotification(notif.id, e)}
                          className="mt-0.5 flex-shrink-0 w-4.5 h-4.5 rounded-full border-2 border-warn hover:bg-warn flex items-center justify-center transition-all group/check"
                          title="Marcar como hecho"
                        >
                          <Check className="w-2.5 h-2.5 text-transparent group-hover/check:text-white transition-colors" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink line-clamp-1">{notif.title}</p>
                          <p className="text-xs text-ink-3 line-clamp-1">{notif.message}</p>
                          <p className="text-[10px] text-ink-4 mt-0.5">{getRelativeTime(notif.created_at)}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {completedStudies.map((study: any) => (
                    <motion.div
                      key={study.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16, height: 0 }}
                      className="p-3 bg-ok-container/50 rounded-lg hover:bg-ok-container transition-colors cursor-pointer border border-ok/20 hover:border-ok/40"
                      onClick={() => { if (study.supply_id) router.push(`/supplies/${study.supply_id}`) }}
                    >
                      <div className="flex items-start gap-2.5">
                        <button
                          onClick={(e) => dismissStudy(study, e)}
                          className="mt-0.5 flex-shrink-0 w-4.5 h-4.5 rounded-full border-2 border-ok hover:bg-ok flex items-center justify-center transition-all group/check"
                          title="Marcar como presentado"
                        >
                          <Check className="w-2.5 h-2.5 text-transparent group-hover/check:text-white transition-colors" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink">
                            Informes listos — {study.supply?.client?.name || 'cliente'}
                          </p>
                          <p className="text-xs font-mono text-ink-3 line-clamp-1">{study.supply?.cups || 'N/A'}</p>
                          <p className="text-[10px] text-ink-4 mt-0.5">{getRelativeTime(study.created_at)}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* SECTION 4: Report Notifications */}
          {completedStudies.length > 0 && (
            <motion.div
              key="reports"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.25 }}
              className="space-y-2"
            >
              <h2 className="text-sm font-semibold text-ink mb-3">Informes disponibles</h2>
              {completedStudies.map((study: any) => (
                <motion.div
                  key={study.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-ok-container border border-ok/20 rounded-xl p-5 hover:border-ok/40 transition-all cursor-pointer group"
                  onClick={() => { if (study.supply_id) router.push(`/supplies/${study.supply_id}`) }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <button
                        onClick={(e) => dismissStudy(study, e)}
                        className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 border-ok hover:bg-ok flex items-center justify-center transition-all group/check"
                        title="Marcar como presentado"
                      >
                        <Check className="w-3 h-3 text-transparent group-hover/check:text-white transition-colors" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileBarChart2 className="w-4 h-4 text-ok flex-shrink-0" />
                          <h3 className="text-sm font-semibold text-ink">
                            Informes listos — {study.supply?.client?.name || 'cliente'}
                          </h3>
                        </div>
                        <p className="text-xs font-mono text-ink-3">
                          {study.supply?.cups || 'CUPS desconocido'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-3 group-hover:text-ink group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-0.5" />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  )
}
