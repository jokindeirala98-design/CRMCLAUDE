'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  ClipboardList, Plus, GripVertical, CheckCircle2, Circle, Clock,
  AlertTriangle, Trash2, ChevronDown, User as UserIcon, Building2,
  ArrowRightLeft, Send, ArrowRight, Play, Zap, TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { NewTaskModal } from '@/components/modals/NewTaskModal'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { getUserInitials } from '@/lib/utils/format'

const PRIORITY_CONFIG = {
  high:   { label: 'Alta',  dot: 'bg-err',  bar: 'bg-err',  text: 'text-err',  badge: 'error'   as const, ring: 'ring-err/20'  },
  medium: { label: 'Media', dot: 'bg-warn', bar: 'bg-warn', text: 'text-warn', badge: 'warning' as const, ring: 'ring-warn/20' },
  low:    { label: 'Baja',  dot: 'bg-ok',   bar: 'bg-ok',   text: 'text-ok',   badge: 'success' as const, ring: 'ring-ok/20'   },
}

const STATUS_CONFIG = {
  pending:     { label: 'Pendiente',   icon: Circle,       color: 'text-ink-3' },
  in_progress: { label: 'En progreso', icon: Clock,        color: 'text-brand' },
  completed:   { label: 'Completada',  icon: CheckCircle2, color: 'text-ok'    },
}

type TaskType = {
  id: string; title: string; description: string | null
  priority: 'high' | 'medium' | 'low'; status: 'pending' | 'in_progress' | 'completed'
  sort_order: number; assigned_to: string | null; created_by: string
  client_id: string | null; due_date: string | null; completed_at: string | null; created_at: string
  assigned_user?: { full_name: string } | null
  client?: { name: string } | null
}

function AnimatedCollapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0)

  useEffect(() => {
    if (!ref.current) return
    if (open) {
      const h = ref.current.scrollHeight
      setHeight(h)
      const timer = setTimeout(() => setHeight(undefined), 300)
      return () => clearTimeout(timer)
    } else {
      setHeight(ref.current.scrollHeight)
      requestAnimationFrame(() => requestAnimationFrame(() => setHeight(0)))
    }
  }, [open])

  return (
    <div
      ref={ref}
      style={{ height, overflow: 'hidden', transition: 'height 0.28s cubic-bezier(0.4,0,0.2,1)' }}
    >
      {children}
    </div>
  )
}

export default function TasksPage() {
  const { user } = useAuthStore()
  const [tasks, setTasks] = useState<TaskType[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filter, setFilter] = useState<'all' | 'mine' | string>('all')
  const [showCompleted, setShowCompleted] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [reassigningId, setReassigningId] = useState<string | null>(null)
  const [telegramPending, setTelegramPending] = useState(0)

  const isAdmin = user?.role === 'admin'

  const fetchTasks = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('tasks')
      .select('*, assigned_user:users_profile!assigned_to(full_name), client:clients!client_id(name)')
      .order('sort_order', { ascending: true })
    setTasks((data as TaskType[]) || [])
    setLoading(false)
  }, [])

  const fetchUsers = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase.from('users_profile').select('id, full_name, role').eq('active', true).order('full_name')
    setUsers(data || [])
  }, [])

  const fetchTelegramPending = useCallback(async () => {
    const supabase = createClient()
    const { count } = await supabase.from('telegram_inbox').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    setTelegramPending(count || 0)
  }, [])

  useEffect(() => {
    fetchTasks(); fetchUsers(); fetchTelegramPending()
  }, [fetchTasks, fetchUsers, fetchTelegramPending])

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'mine') return t.assigned_to === user?.id
    if (filter !== 'all') return t.assigned_to === filter
    return true
  })

  const pendingTasks    = filteredTasks.filter(t => t.status === 'pending').sort((a, b) => a.sort_order - b.sort_order)
  const inProgressTasks = filteredTasks.filter(t => t.status === 'in_progress').sort((a, b) => a.sort_order - b.sort_order)
  const completedTasks  = filteredTasks.filter(t => t.status === 'completed').sort((a, b) =>
    new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
  )
  const activeTasks = [...pendingTasks, ...inProgressTasks]
  const totalAll = activeTasks.length + completedTasks.length
  const completionPct = totalAll > 0 ? Math.round((completedTasks.length / totalAll) * 100) : 0

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    const supabase = createClient()
    const updates: any = { status: newStatus }
    if (newStatus === 'completed') updates.completed_at = new Date().toISOString()
    if (newStatus !== 'completed') updates.completed_at = null
    await supabase.from('tasks').update(updates).eq('id', taskId)
    fetchTasks()
  }

  const reassignTask = async (taskId: string, newUserId: string) => {
    const supabase = createClient()
    await supabase.from('tasks').update({ assigned_to: newUserId || null }).eq('id', taskId)
    setReassigningId(null); fetchTasks()
  }

  const deleteTask = async (taskId: string) => {
    if (!confirm('¿Eliminar esta tarea?')) return
    const supabase = createClient()
    await supabase.from('tasks').delete().eq('id', taskId)
    fetchTasks()
  }

  const handleDragStart = (taskId: string) => setDraggedId(taskId)
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()
  const handleDrop = async (targetId: string, targetStatus: string) => {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return }
    const sameBucket = tasks.filter(t => t.status === targetStatus)
    const targetIndex = sameBucket.findIndex(t => t.id === targetId)
    const draggedTask = tasks.find(t => t.id === draggedId)
    if (!draggedTask) { setDraggedId(null); return }
    const reordered = sameBucket.filter(t => t.id !== draggedId)
    reordered.splice(targetIndex, 0, { ...draggedTask, status: targetStatus as any })
    const supabase = createClient()
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('tasks').update({ sort_order: i, status: targetStatus }).eq('id', reordered[i].id)
    }
    setDraggedId(null); fetchTasks()
  }

  const getDaysUntilDue = (dueDate: string | null) => {
    if (!dueDate) return null
    return Math.ceil((new Date(dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
  }

  const renderTask = (task: TaskType) => {
    const prio = PRIORITY_CONFIG[task.priority]
    const daysLeft = getDaysUntilDue(task.due_date)
    const isOverdue = daysLeft !== null && daysLeft < 0 && task.status !== 'completed'
    const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && task.status !== 'completed'
    const isCompleted = task.status === 'completed'
    const isInProgress = task.status === 'in_progress'

    return (
      <div
        key={task.id}
        draggable={!isCompleted}
        onDragStart={() => handleDragStart(task.id)}
        onDragOver={handleDragOver}
        onDrop={() => handleDrop(task.id, task.status)}
        className={`group relative bg-bg rounded-2xl shadow-ambient-xs transition-all ${
          draggedId === task.id ? 'opacity-40 scale-95' : 'hover:shadow-ambient-sm'
        } ${isCompleted ? 'opacity-55' : ''} overflow-hidden`}
      >
        {/* Priority left bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${prio.bar} rounded-l-2xl`} />

        <div className="pl-4 pr-3 pt-3 pb-3">
          {/* Top row: drag + title + actions */}
          <div className="flex items-start gap-2">
            {!isCompleted && (
              <GripVertical className="w-4 h-4 mt-0.5 text-ink-3/30 cursor-grab opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" />
            )}

            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold leading-snug ${isCompleted ? 'line-through text-ink-3' : 'text-ink'}`}>
                {task.title}
              </p>
              {task.description && !isCompleted && (
                <p className="text-xs text-ink-3 mt-0.5 line-clamp-1">{task.description}</p>
              )}
            </div>

            {/* Admin delete */}
            {isAdmin && (
              <button
                onClick={() => deleteTask(task.id)}
                className="p-1 rounded-lg hover:bg-err-container/40 text-ink-3/30 hover:text-err opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 mt-2 ml-6">
            <Badge variant={prio.badge} className="text-[10px] py-0">{prio.label}</Badge>

            {task.client && (
              <span className="flex items-center gap-1 text-[10px] text-brand font-medium">
                <Building2 className="w-3 h-3" />
                {task.client.name}
              </span>
            )}

            {task.assigned_user && (
              <span className="flex items-center gap-1 text-[10px] text-ink-3">
                <UserIcon className="w-3 h-3" />
                {getUserInitials(task.assigned_user.full_name)}
              </span>
            )}

            {isOverdue && (
              <span className="flex items-center gap-1 text-[10px] text-err font-bold">
                <AlertTriangle className="w-3 h-3" />
                Vencida ({Math.abs(daysLeft!)}d)
              </span>
            )}
            {isDueSoon && (
              <span className="flex items-center gap-1 text-[10px] text-warn font-semibold">
                <Clock className="w-3 h-3" />
                {daysLeft === 0 ? 'Hoy' : `${daysLeft}d`}
              </span>
            )}
            {task.due_date && !isOverdue && !isDueSoon && !isCompleted && (
              <span className="text-[10px] text-ink-3">
                {new Date(task.due_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
              </span>
            )}
            {isCompleted && task.completed_at && (
              <span className="text-[10px] text-ok">
                ✓ {new Date(task.completed_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>

          {/* Action bar — always visible for non-completed */}
          {!isCompleted && (
            <div className="flex items-center gap-2 mt-3 ml-6">
              {/* Main CTA */}
              {task.status === 'pending' ? (
                <button
                  onClick={() => updateTaskStatus(task.id, 'in_progress')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/8 hover:bg-brand hover:text-white text-brand text-xs font-semibold transition-all group/btn"
                >
                  <Play className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
                  Iniciar
                </button>
              ) : (
                <button
                  onClick={() => updateTaskStatus(task.id, 'completed')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ok-container/60 hover:bg-ok hover:text-white text-ok text-xs font-bold transition-all group/btn"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
                  Completar
                </button>
              )}

              {/* In-progress badge */}
              {isInProgress && (
                <span className="flex items-center gap-1 text-[10px] text-brand font-semibold bg-primary/8 px-2 py-1 rounded-lg">
                  <Clock className="w-3 h-3 animate-pulse" />
                  En curso
                </span>
              )}

              {/* Reassign */}
              <button
                onClick={() => setReassigningId(reassigningId === task.id ? null : task.id)}
                className="ml-auto p-1.5 rounded-lg hover:bg-bg-2 text-ink-3/40 hover:text-ink-3 transition-all"
                title="Reasignar"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Completed: reopen button */}
          {isCompleted && (
            <div className="flex mt-2 ml-6">
              <button
                onClick={() => updateTaskStatus(task.id, 'pending')}
                className="text-[10px] text-ink-3/50 hover:text-ink-3 transition-colors"
              >
                Reabrir
              </button>
            </div>
          )}

          {/* Reassign dropdown */}
          {reassigningId === task.id && (
            <div className="mt-3 pt-3 border-t border-surface-container-low ml-6">
              <p className="text-[10px] text-ink-3 mb-2 font-semibold uppercase tracking-wider">Reasignar a:</p>
              <div className="flex flex-wrap gap-1.5">
                {users.filter(u => u.id !== task.assigned_to).map((u) => (
                  <button
                    key={u.id}
                    onClick={() => reassignTask(task.id, u.id)}
                    className="px-2.5 py-1 rounded-lg text-xs bg-bg-2 text-ink-3 hover:bg-brand hover:text-white transition-all"
                  >
                    {getUserInitials(u.full_name)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Corcho de Tareas"
        subtitle="Gestiona y asigna tareas al equipo"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nueva Tarea
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-5">
        {/* Stats + progress */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="text-center py-3">
            <div className="flex items-center justify-center gap-1.5 mb-0.5">
              <Zap className="w-3.5 h-3.5 text-brand" />
              <p className="text-xs text-ink-3 font-medium">Activas</p>
            </div>
            <p className="font-sans font-bold text-2xl text-ink">{activeTasks.length}</p>
          </Card>
          <Card className="text-center py-3">
            <div className="flex items-center justify-center gap-1.5 mb-0.5">
              <Clock className="w-3.5 h-3.5 text-brand" />
              <p className="text-xs text-brand font-medium">En curso</p>
            </div>
            <p className="font-sans font-bold text-2xl text-brand">{inProgressTasks.length}</p>
          </Card>
          <Card className="text-center py-3">
            <div className="flex items-center justify-center gap-1.5 mb-0.5">
              <AlertTriangle className="w-3.5 h-3.5 text-err" />
              <p className="text-xs text-err font-medium">Urgentes</p>
            </div>
            <p className="font-sans font-bold text-2xl text-err">
              {activeTasks.filter(t => t.priority === 'high').length}
            </p>
          </Card>
          {/* Progress */}
          <Card className="py-3 px-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-ok" />
                <p className="text-xs text-ok font-medium">Progreso</p>
              </div>
              <p className="text-xs font-bold text-ok">{completionPct}%</p>
            </div>
            <div className="h-2 bg-bg-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-ok rounded-full transition-all duration-700"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <p className="text-[10px] text-ink-3 mt-1">{completedTasks.length} de {totalAll} completadas</p>
          </Card>
        </div>

        {/* Telegram alert */}
        {telegramPending > 0 && (
          <Link href="/inbox" className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#2AABEE]/5 border border-[#2AABEE]/20 hover:bg-[#2AABEE]/10 transition-colors group cursor-pointer">
            <div className="w-10 h-10 rounded-xl bg-[#2AABEE]/10 flex items-center justify-center flex-shrink-0">
              <Send className="w-5 h-5 text-[#2AABEE]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">{telegramPending} documento{telegramPending !== 1 ? 's' : ''} de Telegram</p>
              <p className="text-xs text-ink-3">Pendiente{telegramPending !== 1 ? 's' : ''} de procesar</p>
            </div>
            <ArrowRight className="w-4 h-4 text-[#2AABEE] group-hover:translate-x-0.5 transition-transform" />
          </Link>
        )}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'all', label: 'Todas' },
            { key: 'mine', label: 'Mis tareas' },
            ...(isAdmin ? users.map(u => ({ key: u.id, label: getUserInitials(u.full_name) })) : [])
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filter === key ? 'bg-brand text-white' : 'bg-bg-2 text-ink-3 hover:bg-bg-2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full" />
          </div>
        ) : activeTasks.length === 0 && completedTasks.length === 0 ? (
          <Card className="text-center py-12">
            <ClipboardList className="w-12 h-12 text-ink-3/30 mx-auto mb-3" />
            <p className="text-ink-3">No hay tareas en el corcho</p>
            <Button className="mt-4" onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4" /> Crear primera tarea
            </Button>
          </Card>
        ) : (
          <div className="space-y-5">

            {/* ── EN PROGRESO ── */}
            {inProgressTasks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/8 rounded-xl">
                    <Clock className="w-3.5 h-3.5 text-brand animate-pulse" />
                    <span className="text-xs font-bold text-brand">En progreso</span>
                    <span className="text-xs font-bold text-brand bg-brand/15 px-1.5 rounded-full">{inProgressTasks.length}</span>
                  </div>
                </div>
                <div className="space-y-2">{inProgressTasks.map(renderTask)}</div>
              </div>
            )}

            {/* ── PENDIENTES ── */}
            {pendingTasks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-2 rounded-xl">
                    <Circle className="w-3.5 h-3.5 text-ink-3" />
                    <span className="text-xs font-bold text-ink-3">Pendientes</span>
                    <span className="text-xs font-bold text-ink-3 bg-surface-container-low px-1.5 rounded-full">{pendingTasks.length}</span>
                  </div>
                </div>
                <div className="space-y-2">{pendingTasks.map(renderTask)}</div>
              </div>
            )}

            {/* ── COMPLETADAS (plegable) ── */}
            {completedTasks.length > 0 && (
              <div>
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-ok-container/30 hover:bg-ok-container/50 border border-ok/10 transition-all group"
                >
                  <div className="flex items-center gap-2 flex-1">
                    <CheckCircle2 className="w-4 h-4 text-ok" />
                    <span className="text-sm font-bold text-ok">Completadas</span>
                    <span className="text-xs font-bold text-ok bg-ok/15 px-2 py-0.5 rounded-full">{completedTasks.length}</span>
                  </div>
                  <div className={`transition-transform duration-200 ${showCompleted ? 'rotate-0' : '-rotate-90'}`}>
                    <ChevronDown className="w-4 h-4 text-ok/60" />
                  </div>
                </button>

                <AnimatedCollapse open={showCompleted}>
                  <div className="space-y-2 mt-2 pb-1">
                    {completedTasks.slice(0, 30).map(renderTask)}
                  </div>
                </AnimatedCollapse>
              </div>
            )}
          </div>
        )}
      </div>

      <NewTaskModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={fetchTasks}
      />
    </div>
  )
}
