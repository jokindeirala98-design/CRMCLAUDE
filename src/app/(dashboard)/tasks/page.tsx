'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ClipboardList,
  Plus,
  GripVertical,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Trash2,
  ChevronDown,
  ChevronRight,
  User as UserIcon,
  Building2,
  ArrowRightLeft,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { NewTaskModal } from '@/components/modals/NewTaskModal'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { getUserInitials } from '@/lib/utils/format'

const PRIORITY_CONFIG = {
  high: { label: 'Alta', color: 'bg-error/10 text-error', dot: 'bg-error', border: 'border-l-error' },
  medium: { label: 'Media', color: 'bg-warning/10 text-warning', dot: 'bg-warning', border: 'border-l-warning' },
  low: { label: 'Baja', color: 'bg-success/10 text-success', dot: 'bg-success', border: 'border-l-success' },
}

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', icon: Circle, color: 'text-on-surface-variant' },
  in_progress: { label: 'En progreso', icon: Clock, color: 'text-primary' },
  completed: { label: 'Completada', icon: CheckCircle2, color: 'text-success' },
}

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
  related_entity_type: string | null
  related_entity_id: string | null
  due_date: string | null
  completed_at: string | null
  created_at: string
  assigned_user?: { full_name: string } | null
  creator_user?: { full_name: string } | null
  client?: { name: string } | null
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

  const isAdmin = user?.role === 'admin'

  const fetchTasks = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('tasks')
      .select('*, assigned_user:users_profile!assigned_to(full_name), creator_user:users_profile!created_by(full_name), client:clients!client_id(name)')
      .order('sort_order', { ascending: true })

    setTasks((data as TaskType[]) || [])
    setLoading(false)
  }, [])

  const fetchUsers = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('users_profile')
      .select('id, full_name, role')
      .eq('active', true)
      .order('full_name')
    setUsers(data || [])
  }, [])

  useEffect(() => {
    fetchTasks()
    fetchUsers()
  }, [fetchTasks, fetchUsers])

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filter === 'mine') return t.assigned_to === user?.id
    if (filter !== 'all') return t.assigned_to === filter
    return true
  })

  const pendingTasks = filteredTasks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => a.sort_order - b.sort_order)
  const inProgressTasks = filteredTasks
    .filter((t) => t.status === 'in_progress')
    .sort((a, b) => a.sort_order - b.sort_order)
  const completedTasks = filteredTasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime())

  const activeTasks = [...pendingTasks, ...inProgressTasks]

  // Stats
  const totalActive = pendingTasks.length + inProgressTasks.length
  const totalHigh = activeTasks.filter((t) => t.priority === 'high').length
  const totalCompleted = completedTasks.length

  // Task actions
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
    setReassigningId(null)
    fetchTasks()
  }

  const deleteTask = async (taskId: string) => {
    if (!confirm('¿Eliminar esta tarea?')) return
    const supabase = createClient()
    await supabase.from('tasks').delete().eq('id', taskId)
    fetchTasks()
  }

  // Drag and drop reorder
  const handleDragStart = (taskId: string) => {
    setDraggedId(taskId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (targetId: string, targetStatus: string) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null)
      return
    }

    const sameBucket = tasks.filter((t) => t.status === targetStatus)
    const targetIndex = sameBucket.findIndex((t) => t.id === targetId)
    const draggedTask = tasks.find((t) => t.id === draggedId)

    if (!draggedTask) {
      setDraggedId(null)
      return
    }

    // Reorder
    const reordered = sameBucket.filter((t) => t.id !== draggedId)
    reordered.splice(targetIndex, 0, { ...draggedTask, status: targetStatus as any })

    const supabase = createClient()
    // Update sort_order and status for all tasks in this bucket
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from('tasks')
        .update({ sort_order: i, status: targetStatus })
        .eq('id', reordered[i].id)
    }

    setDraggedId(null)
    fetchTasks()
  }

  const getDaysUntilDue = (dueDate: string | null) => {
    if (!dueDate) return null
    const days = Math.ceil(
      (new Date(dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    )
    return days
  }

  const renderTask = (task: TaskType) => {
    const prio = PRIORITY_CONFIG[task.priority]
    const statusConf = STATUS_CONFIG[task.status]
    const StatusIcon = statusConf.icon
    const daysLeft = getDaysUntilDue(task.due_date)
    const isOverdue = daysLeft !== null && daysLeft < 0 && task.status !== 'completed'
    const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && task.status !== 'completed'

    return (
      <div
        key={task.id}
        draggable={task.status !== 'completed'}
        onDragStart={() => handleDragStart(task.id)}
        onDragOver={handleDragOver}
        onDrop={() => handleDrop(task.id, task.status)}
        className={`group p-4 bg-surface rounded-2xl border-l-4 ${prio.border} shadow-ambient-xs hover:shadow-ambient-sm transition-all ${
          draggedId === task.id ? 'opacity-50' : ''
        } ${task.status === 'completed' ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start gap-3">
          {/* Drag handle + status toggle */}
          <div className="flex flex-col items-center gap-1 pt-0.5">
            {task.status !== 'completed' && (
              <GripVertical className="w-4 h-4 text-on-surface-variant/30 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
            <button
              onClick={() => {
                if (task.status === 'pending') updateTaskStatus(task.id, 'in_progress')
                else if (task.status === 'in_progress') updateTaskStatus(task.id, 'completed')
                else updateTaskStatus(task.id, 'pending')
              }}
              className="transition-all hover:scale-110"
              title={task.status === 'completed' ? 'Reabrir' : 'Avanzar estado'}
            >
              <StatusIcon
                className={`w-5 h-5 ${statusConf.color} ${
                  task.status === 'completed' ? '' : 'hover:text-success'
                }`}
              />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm font-semibold text-on-surface ${
                task.status === 'completed' ? 'line-through text-on-surface-variant' : ''
              }`}
            >
              {task.title}
            </p>
            {task.description && (
              <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">
                {task.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant={task.priority === 'high' ? 'error' : task.priority === 'medium' ? 'warning' : 'success'}>
                {prio.label}
              </Badge>

              {task.client && (
                <span className="flex items-center gap-1 text-[10px] text-secondary font-medium">
                  <Building2 className="w-3 h-3" />
                  {task.client.name}
                </span>
              )}

              {task.assigned_user && (
                <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                  <UserIcon className="w-3 h-3" />
                  {getUserInitials(task.assigned_user.full_name)}
                </span>
              )}

              {isOverdue && (
                <span className="flex items-center gap-1 text-[10px] text-error font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  Vencida ({Math.abs(daysLeft!)}d)
                </span>
              )}

              {isDueSoon && (
                <span className="flex items-center gap-1 text-[10px] text-warning font-semibold">
                  <Clock className="w-3 h-3" />
                  {daysLeft === 0 ? 'Hoy' : `${daysLeft}d`}
                </span>
              )}

              {task.due_date && !isOverdue && !isDueSoon && task.status !== 'completed' && (
                <span className="text-[10px] text-on-surface-variant">
                  {new Date(task.due_date).toLocaleDateString('es-ES', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {task.status !== 'completed' && (
              <button
                onClick={() => setReassigningId(reassigningId === task.id ? null : task.id)}
                className="p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary transition-all"
                title="Reasignar"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>
            )}
            {task.status !== 'completed' && (
              <button
                onClick={() => updateTaskStatus(task.id, 'completed')}
                className="p-1.5 rounded-lg hover:bg-success/10 text-on-surface-variant hover:text-success transition-all"
                title="Completar"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => deleteTask(task.id)}
                className="p-1.5 rounded-lg hover:bg-error/10 text-on-surface-variant hover:text-error transition-all"
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Reassign dropdown */}
        {reassigningId === task.id && (
          <div className="mt-3 pt-3 border-t border-surface-container-low">
            <p className="text-[10px] text-on-surface-variant mb-2 font-semibold uppercase tracking-wider">Reasignar a:</p>
            <div className="flex flex-wrap gap-1.5">
              {users.filter(u => u.id !== task.assigned_to).map((u) => (
                <button
                  key={u.id}
                  onClick={() => reassignTask(task.id, u.id)}
                  className="px-2.5 py-1 rounded-lg text-xs bg-surface-container-high text-on-surface-variant hover:bg-primary hover:text-white transition-all"
                >
                  {getUserInitials(u.full_name)}
                </button>
              ))}
            </div>
          </div>
        )}
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

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="text-center">
            <p className="text-xs text-on-surface-variant font-medium">Activas</p>
            <p className="font-display font-bold text-2xl text-on-surface">{totalActive}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-error font-medium">Urgentes</p>
            <p className="font-display font-bold text-2xl text-error">{totalHigh}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-success font-medium">Completadas</p>
            <p className="font-display font-bold text-2xl text-success">{totalCompleted}</p>
          </Card>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              filter === 'all'
                ? 'bg-primary text-white'
                : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            Todas
          </button>
          <button
            onClick={() => setFilter('mine')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              filter === 'mine'
                ? 'bg-primary text-white'
                : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            Mis tareas
          </button>
          {isAdmin &&
            users.map((u) => (
              <button
                key={u.id}
                onClick={() => setFilter(u.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  filter === u.id
                    ? 'bg-secondary text-white'
                    : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {getUserInitials(u.full_name)}
              </button>
            ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-6 h-6 border-2 border-secondary border-t-transparent rounded-full" />
          </div>
        ) : activeTasks.length === 0 && completedTasks.length === 0 ? (
          <Card className="text-center py-12">
            <ClipboardList className="w-12 h-12 text-on-surface-variant/30 mx-auto mb-3" />
            <p className="text-on-surface-variant">No hay tareas en el corcho</p>
            <p className="text-sm text-on-surface-variant/60 mt-1">
              Crea tareas para organizar el trabajo del equipo.
            </p>
            <Button className="mt-4" onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4" />
              Crear primera tarea
            </Button>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* In progress section */}
            {inProgressTasks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  En progreso ({inProgressTasks.length})
                </h3>
                <div className="space-y-2">{inProgressTasks.map(renderTask)}</div>
              </div>
            )}

            {/* Pending section */}
            {pendingTasks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-on-surface-variant mb-3 flex items-center gap-2">
                  <Circle className="w-4 h-4" />
                  Pendientes ({pendingTasks.length})
                </h3>
                <div className="space-y-2">{pendingTasks.map(renderTask)}</div>
              </div>
            )}

            {/* Completed section (collapsible) */}
            {completedTasks.length > 0 && (
              <div>
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="flex items-center gap-2 text-sm font-semibold text-success mb-3 hover:underline"
                >
                  {showCompleted ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <CheckCircle2 className="w-4 h-4" />
                  Completadas ({completedTasks.length})
                </button>
                {showCompleted && (
                  <div className="space-y-2">
                    {completedTasks.slice(0, 20).map(renderTask)}
                  </div>
                )}
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
