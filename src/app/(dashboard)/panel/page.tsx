'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Zap, CreditCard, Euro, TrendingUp, AlertCircle,
  CheckCircle2, Clock, Activity, ChevronRight, FileBarChart2,
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
const SUPPLY_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  primer_contacto: { label: 'Primer Contacto', color: 'bg-blue-100 text-blue-700' },
  facturas_recibidas: { label: 'Facturas Recibidas', color: 'bg-cyan-100 text-cyan-700' },
  prescoring_pendiente: { label: 'Prescoring Pendiente', color: 'bg-orange-100 text-orange-700' },
  estudio_en_curso: { label: 'Estudio en Curso', color: 'bg-purple-100 text-purple-700' },
  presentacion: { label: 'Presentación', color: 'bg-indigo-100 text-indigo-700' },
  pte_firma: { label: 'Pte. Firma', color: 'bg-amber-100 text-amber-700' },
  firmado: { label: 'Firmado', color: 'bg-emerald-100 text-emerald-700' },
  suscrito: { label: 'Suscrito', color: 'bg-green-100 text-green-700' },
}

const PIPELINE_STATUSES = [
  'primer_contacto',
  'facturas_recibidas',
  'prescoring_pendiente',
  'estudio_en_curso',
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

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'high':
      return 'bg-red-100 text-red-700'
    case 'medium':
      return 'bg-amber-100 text-amber-700'
    case 'low':
      return 'bg-green-100 text-green-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function getPriorityLabel(priority: string): string {
  switch (priority) {
    case 'high':
      return 'Alta'
    case 'medium':
      return 'Media'
    case 'low':
      return 'Baja'
    default:
      return priority
  }
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
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('due_date', { ascending: true })
        .limit(5)

      setTasks((data as TaskWithUser[]) || [])
    } catch (error) {
      console.error('Error fetching tasks:', error)
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    const supabase = createClient()

    try {
      // Fetch notifications
      const { data: notifsData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user?.id)
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(5)

      // Fetch completed studies for the report cards
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

  useEffect(() => {
    fetchMetrics()
    fetchTasks()
    fetchNotifications()
  }, [fetchMetrics, fetchTasks, fetchNotifications])

  // Metric cards configuration
  const metricCards: MetricCard[] = [
    {
      label: 'Clientes',
      value: String(clientsCount),
      subStat: `${clientTypes.empresa} empresas, ${clientTypes.particular} particulares`,
      icon: Users,
      color: 'blue',
      href: '/clients',
    },
    {
      label: 'Suministros',
      value: String(suppliesCount),
      subStat: `${supplySigned} firmados, ${supplyPending} pendientes`,
      icon: Zap,
      color: 'violet',
      href: '/supplies',
    },
    {
      label: 'Suscripciones Activas',
      value: String(activeSubscriptions),
      subStat: `MRR: ${formatCurrency(mrr)}`,
      icon: CreditCard,
      color: 'green',
      href: '/subscriptions',
    },
    {
      label: 'Facturación',
      value: formatCurrency(totalBilling),
      subStat: `${pendingBilling > 0 ? formatCurrency(pendingBilling) : '0€'} pendientes`,
      icon: Euro,
      color: 'amber',
      href: '/billing',
    },
  ]

  // Pipeline blocks
  const pipelineBlocks: PipelineBlock[] = PIPELINE_STATUSES.map((status) => ({
    status,
    label: SUPPLY_STATUS_CONFIG[status]?.label || status,
    count: suppliesByStatus[status] || 0,
    color: SUPPLY_STATUS_CONFIG[status]?.color || 'bg-gray-100 text-gray-700',
  })).filter((block) => block.count > 0)

  const totalInPipeline = pipelineBlocks.reduce((sum, block) => sum + block.count, 0)

  // Color mapping for metric cards
  const colorMap: Record<string, string> = {
    blue: 'border-blue-200/30 hover:border-blue-300/50 bg-blue-50/40 hover:bg-blue-50/60 text-blue-600',
    violet: 'border-violet-200/30 hover:border-violet-300/50 bg-violet-50/40 hover:bg-violet-50/60 text-violet-600',
    green: 'border-green-200/30 hover:border-green-300/50 bg-green-50/40 hover:bg-green-50/60 text-green-600',
    amber: 'border-amber-200/30 hover:border-amber-300/50 bg-amber-50/40 hover:bg-amber-50/60 text-amber-600',
  }

  return (
    <div className="min-h-screen bg-surface">
      <Header title="Panel" subtitle="Vista general" />

      <main className="px-4 lg:px-8 py-6 lg:py-8 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {/* SECTION 1: Main Metric Cards */}
          <motion.div
            key="metrics"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8"
          >
            {metricCards.map((card, idx) => {
              const Icon = card.icon
              const colorClass = colorMap[card.color]
              return (
                <motion.button
                  key={card.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.1 }}
                  onClick={() => router.push(card.href)}
                  className={`text-left p-6 rounded-2xl border transition-all duration-300 hover:scale-[1.02] active:scale-95 group cursor-pointer ${colorClass}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface-variant mb-2 group-hover:text-on-surface transition-colors">
                        {card.label}
                      </p>
                      <h3 className="text-3xl font-bold text-on-surface mb-1 break-words">
                        {loading ? '...' : card.value}
                      </h3>
                      <p className="text-xs text-on-surface-variant line-clamp-2">
                        {card.subStat}
                      </p>
                    </div>
                    <Icon className="w-8 h-8 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </div>
                </motion.button>
              )
            })}
          </motion.div>

          {/* SECTION 2: Pipeline Overview */}
          {pipelineBlocks.length > 0 && (
            <motion.div
              key="pipeline"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, delay: 0.4 }}
              className="bg-white border border-outline-variant/20 rounded-2xl p-6 mb-8 shadow-ambient-sm"
            >
              <h2 className="text-lg font-semibold text-on-surface mb-4">Pipeline de Suministros</h2>
              <div className="flex gap-1 h-12 rounded-lg overflow-hidden bg-surface-container-low">
                {pipelineBlocks.map((block) => {
                  const percentage = (block.count / totalInPipeline) * 100
                  return (
                    <motion.button
                      key={block.status}
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      onClick={() => {
                        router.push(`/supplies?status=${block.status}`)
                      }}
                      className={`${block.color} relative group flex items-center justify-center text-xs font-bold transition-all hover:opacity-90 cursor-pointer`}
                      title={`${block.label}: ${block.count}`}
                    >
                      <span className="text-white drop-shadow-md opacity-90 group-hover:opacity-100">
                        {block.count}
                      </span>
                    </motion.button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                {pipelineBlocks.map((block) => (
                  <div key={block.status} className="text-xs">
                    <p className="font-medium text-on-surface truncate">{block.label}</p>
                    <p className="text-on-surface-variant">{block.count} suministros</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* SECTION 3: Two Columns - Tasks & Notifications */}
          <motion.div
            key="tasks-notifs"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"
          >
            {/* Left Column: Tareas Prioritarias */}
            <div className="bg-white border border-outline-variant/20 rounded-2xl p-6 shadow-ambient-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-on-surface">Tareas Prioritarias</h2>
                <button
                  onClick={() => router.push('/agenda')}
                  className="text-xs text-primary hover:text-primary/80 font-semibold flex items-center gap-1 transition-colors"
                >
                  Ver todas
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {loadingTasks ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-12 bg-surface-container-low rounded-lg animate-pulse"
                    />
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-on-surface-variant/40" />
                  <p className="text-sm text-on-surface-variant">No hay tareas pendientes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 bg-surface-container-low rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer border border-transparent hover:border-outline-variant/20"
                      onClick={() =>
                        router.push(`/agenda/${task.id}`)
                      }
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-on-surface flex-1 line-clamp-1">
                          {task.title}
                        </p>
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold flex-shrink-0 ${getPriorityColor(
                            task.priority
                          )}`}
                        >
                          {getPriorityLabel(task.priority)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-on-surface-variant">
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
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Actividad Reciente */}
            <div className="bg-white border border-outline-variant/20 rounded-2xl p-6 shadow-ambient-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-on-surface">Actividad Reciente</h2>
                <button
                  onClick={() => router.push('/notifications')}
                  className="text-xs text-primary hover:text-primary/80 font-semibold flex items-center gap-1 transition-colors"
                >
                  Ver todas
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {notifications.length === 0 && completedStudies.length === 0 ? (
                <div className="py-8 text-center">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-on-surface-variant/40" />
                  <p className="text-sm text-on-surface-variant">Sin actividad reciente</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {notifications.map((notif) => (
                    <motion.div
                      key={notif.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 bg-surface-container-low rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer border border-transparent hover:border-outline-variant/20"
                      onClick={() => {
                        if (notif.link) {
                          router.push(notif.link)
                        }
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-on-surface line-clamp-1">
                            {notif.title}
                          </p>
                          <p className="text-xs text-on-surface-variant line-clamp-1">
                            {notif.message}
                          </p>
                          <p className="text-xs text-on-surface-variant/60 mt-1">
                            {getRelativeTime(notif.created_at)}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {completedStudies.map((study: any) => (
                    <motion.div
                      key={study.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 bg-green-50 rounded-lg hover:bg-green-100 transition-colors cursor-pointer border border-green-200/50 hover:border-green-300/50"
                      onClick={() => {
                        if (study.supply_id) {
                          router.push(`/supplies/${study.supply_id}`)
                        }
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-green-900">
                            Estudio completado
                          </p>
                          <p className="text-xs text-green-700 line-clamp-1">
                            {study.supply?.client?.name || ''} (
                            {study.supply?.cups || 'N/A'})
                          </p>
                          <p className="text-xs text-green-600/60 mt-1">
                            {getRelativeTime(study.created_at)}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* SECTION 4: Report Notifications - Completed Studies */}
          {completedStudies.length > 0 && (
            <motion.div
              key="reports"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, delay: 0.6 }}
              className="space-y-3"
            >
              <h2 className="text-lg font-semibold text-on-surface mb-4">Reportes Disponibles</h2>
              {completedStudies.map((study: any) => (
                <motion.div
                  key={study.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/50 rounded-2xl p-6 shadow-ambient-sm hover:shadow-md transition-all cursor-pointer group"
                  onClick={() => {
                    if (study.supply_id) {
                      router.push(`/supplies/${study.supply_id}`)
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <FileBarChart2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <h3 className="font-semibold text-on-surface group-hover:text-primary transition-colors">
                          Estudio Completado
                        </h3>
                      </div>
                      <p className="text-sm text-on-surface-variant mb-1">
                        {study.supply?.client?.name || 'Cliente'}
                      </p>
                      <p className="text-xs font-mono text-on-surface-variant">
                        {study.supply?.cups || 'CUPS desconocido'}
                      </p>
                    </div>
                    <ChevronRight className="w-6 h-6 text-on-surface-variant group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0" />
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
