'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  CalendarDays,
  ClipboardList,
  Target,
  Plus,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  User as UserIcon,
  Building2,
  ArrowRightLeft,
  MapPin,
  Mic,
  MicOff,
  Send,
  Play,
  Pause,
  X,
  StickyNote,
  GripVertical,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { NewTaskModal } from '@/components/modals/NewTaskModal'
import { NewAppointmentModal } from '@/components/modals/NewAppointmentModal'
import { QuickCreateModal } from '@/components/modals/QuickCreateModal'
import { WeeklyPlan } from '@/components/agenda/WeeklyPlan'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils/cn'
import { getUserInitials } from '@/lib/utils/format'

// ── Types ──────────────────────────────────────────────────────
type TaskType = {
  id: string
  title: string
  description: string | null
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
  sort_order: number
  assigned_to: string | null
  created_by: string
  client_id: string | null
  due_date: string | null
  completed_at: string | null
  created_at: string
  assigned_user?: { full_name: string } | null
  creator_user?: { full_name: string } | null
  client?: { name: string } | null
}

type TaskNote = {
  id: string
  task_id: string
  author_id: string | null
  content: string | null
  audio_url: string | null
  audio_duration_seconds: number | null
  created_at: string
  author?: { full_name: string } | null
}

// ── Config ─────────────────────────────────────────────────────
const PRIORITY_CONFIG = {
  high: { label: 'Alta', border: 'border-l-error' },
  medium: { label: 'Media', border: 'border-l-warning' },
  low: { label: 'Baja', border: 'border-l-success' },
}

const DAYS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const TYPE_COLORS: Record<string, string> = {
  presentation: 'bg-primary/10 text-brand',
  followup: 'bg-ok-container text-ok',
  signing: 'bg-warn-container text-warn',
  other: 'bg-bg-2 text-ink-3',
}
const TYPE_LABELS: Record<string, string> = {
  presentation: 'Presentación',
  followup: 'Seguimiento',
  signing: 'Firma',
  other: 'Otro',
}

// ── Tab type ───────────────────────────────────────────────────
type ViewTab = 'corcho' | 'calendario' | 'semana'

// ── Main Component ─────────────────────────────────────────────
export default function AgendaPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<ViewTab>('corcho')
  const [users, setUsers] = useState<any[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  // Task state
  const [tasks, setTasks] = useState<TaskType[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [reassigningId, setReassigningId] = useState<string | null>(null)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

  // Calendar state
  const [currentDate, setCurrentDate] = useState(new Date())
  const [appointments, setAppointments] = useState<any[]>([])
  const [showAppointmentModal, setShowAppointmentModal] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [showQuickModal, setShowQuickModal] = useState(false)
  const [modalDate, setModalDate] = useState('')
  const [realizadasOpen, setRealizadasOpen] = useState(false)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // ── Fetch users ──────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('users_profile')
      .select('id, full_name, role')
      .eq('active', true)
      .order('full_name')
    setUsers(data || [])
  }, [])

  // ── Fetch tasks ──────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('tasks')
      .select('*, assigned_user:users_profile!assigned_to(full_name), creator_user:users_profile!created_by(full_name), client:clients!client_id(name)')
      .order('sort_order', { ascending: true })

    setTasks((data as TaskType[]) || [])
    setLoadingTasks(false)
  }, [])

  // ── Fetch appointments ───────────────────────────────────────
  const fetchAppointments = useCallback(async () => {
    const supabase = createClient()
    const start = new Date(year, month, 1).toISOString()
    const end = new Date(year, month + 1, 0).toISOString()

    const { data } = await supabase
      .from('appointments')
      .select('*, client:clients(name)')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at')

    setAppointments(data || [])
  }, [year, month])

  useEffect(() => {
    fetchUsers()
    fetchTasks()
    fetchAppointments()
  }, [fetchUsers, fetchTasks, fetchAppointments])

  // Set default selected user to current user
  useEffect(() => {
    if (user?.id && !selectedUserId) {
      setSelectedUserId(user.id)
    }
  }, [user, selectedUserId])

  // ── Filtered tasks for selected user ─────────────────────────
  const userTasks = tasks.filter((t) => {
    if (!selectedUserId) return true
    return t.assigned_to === selectedUserId
  })

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const pendingTasks = userTasks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.sort_order - b.sort_order)
  const inProgressTasks = userTasks
    .filter((t) => t.status === 'in_progress')
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.sort_order - b.sort_order)
  const completedTasks = userTasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime())

  const activeTasks = [...inProgressTasks, ...pendingTasks]
  const totalActive = activeTasks.length
  const totalHigh = activeTasks.filter((t) => t.priority === 'high').length

  // ── Task actions ─────────────────────────────────────────────
  const updateTaskStatus = (taskId: string, newStatus: string) => {
    // Optimistic UI — update local state instantly
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, status: newStatus as any, completed_at: newStatus === 'completed' ? new Date().toISOString() : null }
        : t
    ))
    // Fire-and-forget DB update
    const supabase = createClient()
    const updates: any = { status: newStatus }
    if (newStatus === 'completed') updates.completed_at = new Date().toISOString()
    if (newStatus !== 'completed') updates.completed_at = null
    supabase.from('tasks').update(updates).eq('id', taskId).then(() => {
      fetchTasks()
      // Sync tasks briefing to Google Calendar
      fetch('/api/google/sync-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId || user?.id }),
      }).catch(() => {})
    })
  }

  const reassignTask = async (taskId: string, newUserId: string) => {
    const supabase = createClient()
    await supabase.from('tasks').update({ assigned_to: newUserId || null }).eq('id', taskId)
    setReassigningId(null)
    fetchTasks()
  }

  const deleteTask = async (taskId: string) => {
    if (!confirm('¿Eliminar esta tarea?')) return
    const supabase = createClient()
    await supabase.from('tasks').delete().eq('id', taskId)
    fetchTasks()
  }

  // ── Appointment actions ──────────────────────────────────────
  const markAppointmentDone = async (apptId: string) => {
    const supabase = createClient()
    setAppointments(prev =>
      prev.map(a => a.id === apptId ? { ...a, status: 'completed' } : a)
    )
    await supabase.from('appointments').update({ status: 'completed' }).eq('id', apptId)
    fetchAppointments()
  }

  const deleteAppointment = async (apptId: string) => {
    if (!confirm('¿Eliminar esta cita?')) return
    const supabase = createClient()
    setAppointments(prev => prev.filter(a => a.id !== apptId))
    await supabase.from('appointments').delete().eq('id', apptId)
    fetchAppointments()
  }

  // Drag-and-drop
  const handleDragStart = (taskId: string) => setDraggedId(taskId)
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()
  const handleDrop = async (targetId: string, targetStatus: string) => {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return }
    const sameBucket = tasks.filter((t) => t.status === targetStatus)
    const targetIndex = sameBucket.findIndex((t) => t.id === targetId)
    const draggedTask = tasks.find((t) => t.id === draggedId)
    if (!draggedTask) { setDraggedId(null); return }
    const reordered = sameBucket.filter((t) => t.id !== draggedId)
    reordered.splice(targetIndex, 0, { ...draggedTask, status: targetStatus as any })
    const supabase = createClient()
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('tasks').update({ sort_order: i, status: targetStatus }).eq('id', reordered[i].id)
    }
    setDraggedId(null)
    fetchTasks()
  }

  const getDaysUntilDue = (dueDate: string | null) => {
    if (!dueDate) return null
    return Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  }

  // ── Calendar helpers ─────────────────────────────────────────
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  const today = new Date()
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day

  const getAppointmentsForDay = (day: number) =>
    appointments.filter((a) => new Date(a.scheduled_at).getDate() === day)

  const upcoming = appointments
    .filter((a) => {
      const d = new Date(a.scheduled_at)
      const weekLater = new Date()
      weekLater.setDate(weekLater.getDate() + 7)
      return d >= new Date() && d <= weekLater && a.status === 'scheduled'
    })
    .slice(0, 5)

  // ── Selected user info ───────────────────────────────────────
  const selectedUser = users.find((u) => u.id === selectedUserId)
  const selectedUserName = selectedUser ? getUserInitials(selectedUser.full_name) : 'Todos'

  // ── Render task card ─────────────────────────────────────────
  const PRIORITY_BG: Record<string, string> = {
    high: 'bg-err-container/40 border-err/30',
    medium: 'bg-warn-container/40 border-warn/30',
    low: 'bg-ok-container/40 border-ok/30',
  }

  const renderTask = (task: TaskType) => {
    const prio = PRIORITY_CONFIG[task.priority]
    const daysLeft = getDaysUntilDue(task.due_date)
    const isOverdue = daysLeft !== null && daysLeft < 0 && task.status !== 'completed'
    const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && task.status !== 'completed'
    const isExpanded = expandedTaskId === task.id
    const prioBg = task.status === 'completed' ? 'bg-bg border-line-2-variant/30' : PRIORITY_BG[task.priority]

    return (
      <div key={task.id}>
        <div
          draggable={task.status !== 'completed'}
          onDragStart={() => handleDragStart(task.id)}
          onDragOver={handleDragOver}
          onDrop={() => handleDrop(task.id, task.status)}
          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
          className={cn(
            'group p-4 rounded-2xl border shadow-ambient-xs hover:shadow-ambient-sm transition-all cursor-pointer',
            prioBg,
            draggedId === task.id && 'opacity-50',
            task.status === 'completed' && 'opacity-60',
            isExpanded && 'ring-1 ring-secondary/30'
          )}
        >
          <div className="flex items-start gap-3">
            {/* Status toggle */}
            <div className="flex flex-col items-center gap-1 pt-0.5">
              {task.status !== 'completed' && (
                <GripVertical className="w-4 h-4 text-ink-3/30 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (task.status === 'pending') updateTaskStatus(task.id, 'in_progress')
                  else if (task.status === 'in_progress') updateTaskStatus(task.id, 'completed')
                  else updateTaskStatus(task.id, 'pending')
                }}
                className="transition-all hover:scale-110"
              >
                {task.status === 'completed' ? (
                  <CheckCircle2 className="w-5 h-5 text-ok" />
                ) : task.status === 'in_progress' ? (
                  <Clock className="w-5 h-5 text-brand hover:text-ok" />
                ) : (
                  <Circle className="w-5 h-5 text-ink-3 hover:text-ok" />
                )}
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className={cn(
                'text-sm font-semibold text-ink',
                task.status === 'completed' && 'line-through text-ink-3'
              )}>
                {task.title}
              </p>
              {task.description && (
                <p className="text-xs text-ink-3 mt-1 line-clamp-2">{task.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant={task.priority === 'high' ? 'error' : task.priority === 'medium' ? 'warning' : 'success'}>
                  {prio.label}
                </Badge>
                {task.client && (
                  <span className="flex items-center gap-1 text-[10px] text-brand font-medium">
                    <Building2 className="w-3 h-3" />{task.client.name}
                  </span>
                )}
                {isOverdue && (
                  <span className="flex items-center gap-1 text-[10px] text-err font-semibold">
                    <AlertTriangle className="w-3 h-3" />Vencida ({Math.abs(daysLeft!)}d)
                  </span>
                )}
                {isDueSoon && (
                  <span className="flex items-center gap-1 text-[10px] text-warn font-semibold">
                    <Clock className="w-3 h-3" />{daysLeft === 0 ? 'Hoy' : `${daysLeft}d`}
                  </span>
                )}
                {task.due_date && !isOverdue && !isDueSoon && task.status !== 'completed' && (
                  <span className="text-[10px] text-ink-3">
                    {new Date(task.due_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
              {task.status !== 'completed' && (
                <button
                  onClick={() => setReassigningId(reassigningId === task.id ? null : task.id)}
                  className="p-1.5 rounded-lg hover:bg-primary/10 text-ink-3 hover:text-brand transition-all"
                  title="Reasignar"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
              )}
              {task.status !== 'completed' && (
                <button
                  onClick={() => updateTaskStatus(task.id, 'completed')}
                  className="p-1.5 rounded-lg hover:bg-success/10 text-ink-3 hover:text-ok transition-all"
                  title="Completar"
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => deleteTask(task.id)}
                  className="p-1.5 rounded-lg hover:bg-error/10 text-ink-3 hover:text-err transition-all"
                  title="Eliminar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Reassign dropdown */}
          {reassigningId === task.id && (
            <div className="mt-3 pt-3 border-t border-surface-container-low" onClick={(e) => e.stopPropagation()}>
              <p className="text-[10px] text-ink-3 mb-2 font-semibold uppercase tracking-wider">Reasignar a:</p>
              <div className="flex flex-wrap gap-1.5">
                {users.filter((u) => u.id !== task.assigned_to).map((u) => (
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

        {/* Expanded: Notes & Audio panel */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <TaskNotesPanel taskId={task.id} userId={user?.id || ''} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Agenda"
        subtitle={`Corcho y calendario${selectedUser ? ` — ${getUserInitials(selectedUser.full_name)}` : ''}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowAppointmentModal(true)}>
              <Plus className="w-4 h-4" />
              Cita
            </Button>
            <Button onClick={() => setShowTaskModal(true)}>
              <Plus className="w-4 h-4" />
              Tarea
            </Button>
          </div>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-5">
        {/* User selector (admin only) + View tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-bg-2 rounded-2xl p-1">
            <button
              onClick={() => setActiveTab('corcho')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                activeTab === 'corcho' ? 'bg-bg shadow-ambient-xs text-brand' : 'text-ink-3 hover:text-ink'
              )}
            >
              <ClipboardList className="w-4 h-4" />
              Corcho
            </button>
            <button
              onClick={() => setActiveTab('calendario')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                activeTab === 'calendario' ? 'bg-bg shadow-ambient-xs text-brand' : 'text-ink-3 hover:text-ink'
              )}
            >
              <CalendarDays className="w-4 h-4" />
              Calendario
            </button>
            <button
              onClick={() => setActiveTab('semana')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                activeTab === 'semana' ? 'bg-bg shadow-ambient-xs text-brand' : 'text-ink-3 hover:text-ink'
              )}
            >
              <Target className="w-4 h-4" />
              Semana
            </button>
          </div>

          {/* User selector */}
          {isAdmin && (
            <div className="flex flex-wrap gap-1.5 ml-auto">
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                    selectedUserId === u.id
                      ? 'bg-brand text-white'
                      : 'bg-bg-2 text-ink-3 hover:bg-bg-2'
                  )}
                >
                  {getUserInitials(u.full_name)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── CORCHO VIEW — Two columns: Pendientes + Realizadas ── */}
        {activeTab === 'corcho' && (
          <div>
            {/* Stats bar */}
            <div className="flex gap-4 mb-5">
              <div className="flex items-center gap-2 px-4 py-2 bg-bg rounded-2xl shadow-ambient-xs">
                <Circle className="w-4 h-4 text-ink-3" />
                <span className="text-sm font-bold text-ink">{totalActive}</span>
                <span className="text-xs text-ink-3">pendientes</span>
              </div>
              {totalHigh > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 bg-error/5 rounded-2xl">
                  <AlertTriangle className="w-4 h-4 text-err" />
                  <span className="text-sm font-bold text-err">{totalHigh}</span>
                  <span className="text-xs text-error/70">urgentes</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2 bg-success/5 rounded-2xl">
                <CheckCircle2 className="w-4 h-4 text-ok" />
                <span className="text-sm font-bold text-ok">{completedTasks.length}</span>
                <span className="text-xs text-success/70">realizadas</span>
              </div>
            </div>

            {loadingTasks ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full" />
              </div>
            ) : activeTasks.length === 0 && completedTasks.length === 0 ? (
              <Card className="text-center py-12">
                <ClipboardList className="w-12 h-12 text-ink-3/30 mx-auto mb-3" />
                <p className="text-ink-3">Corcho vacio para {selectedUserName}</p>
                <Button className="mt-4" onClick={() => setShowTaskModal(true)}>
                  <Plus className="w-4 h-4" />Nueva Tarea
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* PENDIENTES — full width */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-brand" />
                    <h3 className="text-sm font-bold text-ink uppercase tracking-wider">Tareas pendientes</h3>
                    <span className="text-xs text-ink-3 ml-auto">{activeTasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {activeTasks.length === 0 ? (
                      <div className="text-center py-10 bg-bg rounded-2xl">
                        <CheckCircle2 className="w-8 h-8 text-success/30 mx-auto mb-2" />
                        <p className="text-xs text-ink-3">Todo al dia</p>
                      </div>
                    ) : (
                      activeTasks.map((task) => {
                        const prio = PRIORITY_CONFIG[task.priority]
                        const daysLeft = getDaysUntilDue(task.due_date)
                        const isOverdue = daysLeft !== null && daysLeft < 0
                        const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3
                        const isExpanded = expandedTaskId === task.id

                        return (
                          <div key={task.id}>
                            <div
                              draggable
                              onDragStart={() => handleDragStart(task.id)}
                              onDragOver={handleDragOver}
                              onDrop={() => handleDrop(task.id, task.status)}
                              onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                              className={cn(
                                'group p-3.5 bg-bg rounded-2xl border-l-4 shadow-ambient-xs hover:shadow-ambient-sm transition-all cursor-pointer',
                                prio.border,
                                draggedId === task.id && 'opacity-50',
                                isExpanded && 'ring-1 ring-secondary/30'
                              )}
                            >
                              <div className="flex items-center gap-3">
                                {/* Complete button — big green circle */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    updateTaskStatus(task.id, 'completed')
                                  }}
                                  className="shrink-0 w-8 h-8 rounded-full border-2 border-success/40 hover:border-ok hover:bg-success/10 flex items-center justify-center transition-all group/check"
                                  title="Marcar como realizada"
                                >
                                  <CheckCircle2 className="w-4.5 h-4.5 text-success/40 group-hover/check:text-ok transition-colors" />
                                </button>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-ink truncate">{task.title}</p>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    <Badge variant={task.priority === 'high' ? 'error' : task.priority === 'medium' ? 'warning' : 'success'}>
                                      {prio.label}
                                    </Badge>
                                    {task.status === 'in_progress' && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-brand rounded-full font-medium">En curso</span>
                                    )}
                                    {task.client && (
                                      <span className="text-[10px] text-brand font-medium truncate max-w-[100px]">{task.client.name}</span>
                                    )}
                                    {isOverdue && (
                                      <span className="text-[10px] text-err font-semibold">Vencida ({Math.abs(daysLeft!)}d)</span>
                                    )}
                                    {isDueSoon && (
                                      <span className="text-[10px] text-warn font-semibold">{daysLeft === 0 ? 'Hoy' : `${daysLeft}d`}</span>
                                    )}
                                  </div>
                                </div>

                                {/* Hover actions */}
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => setReassigningId(reassigningId === task.id ? null : task.id)} className="p-1.5 rounded-lg hover:bg-primary/10 text-ink-3 hover:text-brand transition-all" title="Reasignar">
                                    <ArrowRightLeft className="w-3.5 h-3.5" />
                                  </button>
                                  {isAdmin && (
                                    <button onClick={() => deleteTask(task.id)} className="p-1.5 rounded-lg hover:bg-error/10 text-ink-3 hover:text-err transition-all" title="Eliminar">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Reassign dropdown */}
                              {reassigningId === task.id && (
                                <div className="mt-3 pt-3 border-t border-surface-container-low" onClick={(e) => e.stopPropagation()}>
                                  <p className="text-[10px] text-ink-3 mb-2 font-semibold uppercase tracking-wider">Reasignar a:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {users.filter((u) => u.id !== task.assigned_to).map((u) => (
                                      <button key={u.id} onClick={() => reassignTask(task.id, u.id)} className="px-2.5 py-1 rounded-lg text-xs bg-bg-2 text-ink-3 hover:bg-brand hover:text-white transition-all">{getUserInitials(u.full_name)}</button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Expanded notes */}
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                  <TaskNotesPanel taskId={task.id} userId={user?.id || ''} />
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* REALIZADAS — plegable */}
                <div>
                  <button
                    onClick={() => setRealizadasOpen(!realizadasOpen)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-ok-container/30 hover:bg-ok-container/50 rounded-2xl transition-all"
                  >
                    <div className="w-2 h-2 rounded-full bg-ok flex-shrink-0" />
                    <span className="text-sm font-bold text-ok uppercase tracking-wider">Realizadas</span>
                    <span className="text-xs font-semibold text-ok/70 ml-1">({completedTasks.length})</span>
                    <ChevronDown className={cn(
                      'w-4 h-4 text-ok ml-auto transition-transform duration-200',
                      realizadasOpen ? 'rotate-0' : '-rotate-90'
                    )} />
                  </button>

                  <AnimatePresence>
                    {realizadasOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-1.5 mt-2">
                          {completedTasks.length === 0 ? (
                            <div className="text-center py-8 bg-bg rounded-2xl">
                              <Circle className="w-8 h-8 text-ink-3/20 mx-auto mb-2" />
                              <p className="text-xs text-ink-3">Aun no hay tareas realizadas</p>
                            </div>
                          ) : (
                            <>
                              {(showCompleted ? completedTasks : completedTasks.slice(0, 10)).map((task) => (
                                <div key={task.id} className="group flex items-center gap-3 p-3 bg-bg rounded-xl hover:bg-bg-2 transition-all">
                                  <button onClick={() => updateTaskStatus(task.id, 'pending')} className="shrink-0 transition-all" title="Deshacer">
                                    <CheckCircle2 className="w-5 h-5 text-ok group-hover:text-success/50" />
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-ink-3 line-through truncate">{task.title}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      {task.completed_at && (
                                        <span className="text-[10px] text-ink-3/60">
                                          {new Date(task.completed_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                                          {' '}{new Date(task.completed_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      )}
                                      {task.client && <span className="text-[10px] text-secondary/60">{task.client.name}</span>}
                                    </div>
                                  </div>
                                  {isAdmin && (
                                    <button onClick={() => deleteTask(task.id)} className="p-1 rounded-lg hover:bg-error/10 text-ink-3/30 hover:text-err transition-all opacity-0 group-hover:opacity-100">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              ))}
                              {completedTasks.length > 10 && (
                                <button
                                  onClick={() => setShowCompleted(!showCompleted)}
                                  className="w-full text-center py-2.5 text-xs font-semibold text-brand hover:text-primary/80 transition-colors rounded-xl hover:bg-primary/5"
                                >
                                  {showCompleted ? 'Mostrar menos' : `Ver todas (${completedTasks.length} tareas)`}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CALENDAR VIEW ───────────────────────────────────── */}
        {activeTab === 'calendario' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3">
              <Card>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-sans font-bold text-xl text-ink">
                    {MONTHS[month]} {year}
                  </h2>
                  <div className="flex gap-2">
                    <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
                      <ChevronLeft className="w-5 h-5 text-ink-3" />
                    </button>
                    <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 text-xs font-semibold text-brand hover:bg-primary/5 rounded-xl transition-all">
                      Hoy
                    </button>
                    <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
                      <ChevronRight className="w-5 h-5 text-ink-3" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-2">
                  {DAYS.map((d) => (
                    <div key={d} className="text-center text-xs font-semibold text-ink-3 py-2">{d}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: offset }).map((_, i) => <div key={`e-${i}`} className="min-h-[80px]" />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1
                    const dayAppts = getAppointmentsForDay(day)
                    const isSelected = selectedDay === day
                    return (
                      <div
                        key={day}
                        onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                        onDoubleClick={() => {
                          // Build date string directly to avoid UTC timezone shift
                          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                          setModalDate(dateStr)
                          setShowQuickModal(true)
                        }}
                        className={cn(
                          'min-h-[80px] rounded-xl p-2 transition-all cursor-pointer',
                          isToday(day) ? 'bg-primary/5 ring-1 ring-primary/30'
                          : isSelected ? 'bg-secondary/5 ring-1 ring-secondary/30'
                          : 'hover:bg-bg-2'
                        )}
                      >
                        <span className={cn('text-sm font-medium', isToday(day) ? 'text-brand font-bold' : 'text-ink')}>{day}</span>
                        <div className="mt-1 space-y-0.5">
                          {dayAppts.slice(0, 2).map((a: any) => (
                            <div key={a.id} className={`text-[10px] px-1.5 py-0.5 rounded font-medium truncate ${TYPE_COLORS[a.type] || TYPE_COLORS.other}`}>
                              {a.client?.name || TYPE_LABELS[a.type] || 'Cita'}
                            </div>
                          ))}
                          {dayAppts.length > 2 && <span className="text-[10px] text-ink-3">+{dayAppts.length - 2} mas</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>

            {/* Right sidebar */}
            <div className="space-y-4">
              {selectedDay && (
                <Card>
                  <h3 className="text-sm font-semibold text-ink mb-3">{selectedDay} {MONTHS[month]}</h3>
                  {getAppointmentsForDay(selectedDay).length === 0 ? (
                    <p className="text-xs text-ink-3">Sin citas este dia</p>
                  ) : (
                    <div className="space-y-2">
                      {getAppointmentsForDay(selectedDay).map((a: any) => (
                        <div key={a.id} className={cn(
                          'group p-2.5 rounded-xl transition-all',
                          a.status === 'completed' ? 'bg-ok-container/30 opacity-70' : 'bg-bg-2'
                        )}>
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant={a.type === 'signing' ? 'warning' : 'info'}>{TYPE_LABELS[a.type] || a.type}</Badge>
                                {a.status === 'completed' && (
                                  <Badge variant="success">Realizada</Badge>
                                )}
                              </div>
                              <p className={cn(
                                'text-sm font-medium',
                                a.status === 'completed' ? 'text-ink-3 line-through' : 'text-ink'
                              )}>
                                {a.client?.name || '—'}
                              </p>
                              <div className="flex items-center gap-1 mt-1 text-xs text-ink-3">
                                <Clock className="w-3 h-3" />
                                {new Date(a.scheduled_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                {a.location && (
                                  <>
                                    <span className="mx-1">·</span>
                                    <MapPin className="w-3 h-3" />{a.location}
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              {a.status !== 'completed' && (
                                <button
                                  onClick={() => markAppointmentDone(a.id)}
                                  className="p-1.5 rounded-lg hover:bg-ok-container text-ink-3 hover:text-ok transition-all"
                                  title="Marcar como realizada"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => deleteAppointment(a.id)}
                                className="p-1.5 rounded-lg hover:bg-err-container text-ink-3 hover:text-err transition-all opacity-0 group-hover:opacity-100"
                                title="Eliminar cita"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              <Card>
                <h3 className="text-sm font-semibold text-ink mb-3">Proximas citas</h3>
                {upcoming.length === 0 ? (
                  <p className="text-xs text-ink-3">Sin citas proximas</p>
                ) : (
                  <div className="space-y-2">
                    {upcoming.map((a: any) => (
                      <div key={a.id} className="group flex items-center gap-2 p-2 rounded-lg hover:bg-bg-2 transition-all">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          a.type === 'signing' ? 'bg-warn' : a.type === 'presentation' ? 'bg-brand' : 'bg-ok'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-ink truncate">{a.client?.name}</p>
                          <p className="text-[10px] text-ink-3">
                            {new Date(a.scheduled_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                            {' '}{new Date(a.scheduled_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => markAppointmentDone(a.id)}
                            className="p-1 rounded-md hover:bg-ok-container text-ink-4 hover:text-ok transition-all"
                            title="Marcar como realizada"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteAppointment(a.id)}
                            className="p-1 rounded-md hover:bg-err-container text-ink-4 hover:text-err transition-all"
                            title="Eliminar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ── SEMANA VIEW ─────────────────────────────────────── */}
        {activeTab === 'semana' && (
          <WeeklyPlan users={users} />
        )}
      </div>

      <NewTaskModal open={showTaskModal} onClose={() => setShowTaskModal(false)} onCreated={fetchTasks} />
      <NewAppointmentModal open={showAppointmentModal} onClose={() => setShowAppointmentModal(false)} onCreated={fetchAppointments} />
      <QuickCreateModal
        open={showQuickModal}
        onClose={() => { setShowQuickModal(false); setModalDate('') }}
        onCreated={() => { fetchTasks(); fetchAppointments() }}
        date={modalDate}
      />
    </div>
  )
}

// ── Task Notes Panel ───────────────────────────────────────────
function TaskNotesPanel({ taskId, userId }: { taskId: string; userId: string }) {
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [recording, setRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recordStartRef = useRef<number>(0)

  const fetchNotes = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('task_notes')
      .select('*, author:users_profile!author_id(full_name)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    setNotes((data as TaskNote[]) || [])
    setLoading(false)
  }, [taskId])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  // ── Submit text note ─────────────────────────────────────────
  const submitNote = async () => {
    if (!newNote.trim() && !audioBlob) return
    const supabase = createClient()

    let audioUrl: string | null = null
    let audioDuration: number | null = null

    // Upload audio if exists
    if (audioBlob) {
      const filename = `${taskId}/${Date.now()}.webm`
      const { data: uploadData } = await supabase.storage
        .from('task-audio')
        .upload(filename, audioBlob, { contentType: 'audio/webm' })

      if (uploadData) {
        const { data: urlData } = supabase.storage.from('task-audio').getPublicUrl(filename)
        audioUrl = urlData.publicUrl
        audioDuration = Math.round((Date.now() - recordStartRef.current) / 1000)
      }
    }

    await supabase.from('task_notes').insert({
      task_id: taskId,
      author_id: userId,
      content: newNote.trim() || null,
      audio_url: audioUrl,
      audio_duration_seconds: audioDuration,
    })

    setNewNote('')
    setAudioBlob(null)
    fetchNotes()
  }

  // ── Audio recording ──────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recordStartRef.current = Date.now()

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        stream.getTracks().forEach((t) => t.stop())
      }

      recorder.start()
      setRecording(true)
    } catch {
      alert('No se pudo acceder al microfono')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const playAudio = (url: string, noteId: string) => {
    if (audioRef.current) { audioRef.current.pause() }
    if (playingId === noteId) { setPlayingId(null); return }
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => setPlayingId(null)
    audio.play()
    setPlayingId(noteId)
  }

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="ml-4 mt-1 p-4 bg-bg-2 rounded-2xl border border-surface-container-high space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-3 uppercase tracking-wider">
        <StickyNote className="w-3.5 h-3.5" />
        Notas y audio
      </div>

      {loading ? (
        <div className="animate-pulse h-8 bg-bg-2 rounded-xl" />
      ) : notes.length === 0 ? (
        <p className="text-xs text-ink-3/60 italic">Sin notas aun</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {notes.map((note) => (
            <div key={note.id} className="p-2.5 bg-bg rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold text-brand">
                  {getUserInitials(note.author?.full_name) || 'USU'}
                </span>
                <span className="text-[10px] text-ink-3">
                  {new Date(note.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {note.content && <p className="text-xs text-ink">{note.content}</p>}
              {note.audio_url && (
                <button
                  onClick={() => playAudio(note.audio_url!, note.id)}
                  className="flex items-center gap-2 mt-1 px-3 py-1.5 bg-primary/10 rounded-lg hover:bg-primary/20 transition-all"
                >
                  {playingId === note.id ? <Pause className="w-3.5 h-3.5 text-brand" /> : <Play className="w-3.5 h-3.5 text-brand" />}
                  <span className="text-xs font-medium text-brand">
                    {note.audio_duration_seconds ? formatDuration(note.audio_duration_seconds) : 'Audio'}
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Escribe una nota..."
            rows={1}
            className="w-full px-3 py-2 bg-bg-2 rounded-xl text-xs text-ink placeholder:text-ink-3/50 outline-none resize-none focus:bg-card transition-all"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNote() } }}
          />
          {audioBlob && (
            <div className="flex items-center gap-2 mt-1 px-2 py-1 bg-primary/10 rounded-lg">
              <Mic className="w-3 h-3 text-brand" />
              <span className="text-[10px] text-brand font-medium">Audio grabado</span>
              <button onClick={() => setAudioBlob(null)} className="ml-auto">
                <X className="w-3 h-3 text-ink-3" />
              </button>
            </div>
          )}
        </div>
        <button
          onClick={recording ? stopRecording : startRecording}
          className={cn(
            'p-2 rounded-xl transition-all',
            recording ? 'bg-err text-white animate-pulse' : 'bg-bg-2 text-ink-3 hover:text-brand hover:bg-primary/10'
          )}
          title={recording ? 'Parar grabacion' : 'Grabar audio'}
        >
          {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          onClick={submitNote}
          disabled={!newNote.trim() && !audioBlob}
          className="p-2 rounded-xl bg-brand text-white disabled:opacity-30 hover:bg-primary/90 transition-all"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
