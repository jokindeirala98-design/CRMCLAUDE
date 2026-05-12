'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Lock, Pencil, Inbox, Sun, CheckCircle2, Circle, Plus,
  Target, Pin, PinOff, ChevronDown, Flame, RotateCcw,
  Sparkles, ArrowRight, Loader2
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils/cn'
import { getUserInitials } from '@/lib/utils/format'

// ── Types ─────────────────────────────────────────────────────────
type Week = {
  id: string
  starts_at: string
  ends_at: string
  status: 'active' | 'closed' | 'archived'
  created_by: string
  created_at: string
}

type Objective = {
  id: string
  week_id: string
  title: string
  sort_order: number
  status: 'open' | 'advancing' | 'done'
  tag: string
}

type WeekTask = {
  id: string
  title: string
  description: string | null
  status: 'pending' | 'in_progress' | 'completed'
  zone: 'director' | 'mine' | 'inbox'
  is_pinned: boolean
  is_focus_today: boolean
  origin: string
  priority: 'high' | 'medium' | 'low'
  assigned_to: string | null
  created_by: string
  created_at: string
  sort_order: number
  client?: { name: string } | null
  objective?: { title: string } | null
}

// ── Config ─────────────────────────────────────────────────────────
const TAG_COLORS: Record<string, string> = {
  estudios:  'bg-blue-100 text-blue-700',
  captacion: 'bg-green-100 text-green-700',
  interno:   'bg-purple-100 text-purple-700',
  marketing: 'bg-orange-100 text-orange-700',
  admin:     'bg-gray-100 text-gray-600',
}
const TAG_LABELS: Record<string, string> = {
  estudios: 'Estudios', captacion: 'Captación', interno: 'Interno',
  marketing: 'Marketing', admin: 'Admin',
}

const OBJ_STATUS_NEXT: Record<string, string> = { open: 'advancing', advancing: 'done', done: 'open' }
const OBJ_STATUS_ICON: Record<string, React.ReactNode> = {
  open:      <Circle className="w-3.5 h-3.5 text-ink-3" />,
  advancing: <Flame className="w-3.5 h-3.5 text-warn" />,
  done:      <CheckCircle2 className="w-3.5 h-3.5 text-ok" />,
}

const ORIGIN_BADGE: Record<string, string> = {
  bot:      'Bot',
  crm:      'CRM',
  director: 'Dir.',
  derived:  'Bloq.',
}

// ── Helper: get Monday of current week ─────────────────────────────
function getCurrentWeekBounds(): { monday: string; friday: string } {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  return {
    monday: monday.toISOString().split('T')[0],
    friday: friday.toISOString().split('T')[0],
  }
}

function formatWeekRange(starts: string, ends: string): string {
  const s = new Date(starts + 'T12:00:00')
  const e = new Date(ends + 'T12:00:00')
  return `${s.getDate()} – ${e.getDate()} ${e.toLocaleDateString('es-ES', { month: 'long' })}`
}

// ════════════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════════════
export function WeeklyPlan({ users }: { users: any[] }) {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [week, setWeek]             = useState<Week | null>(null)
  const [objectives, setObjectives]  = useState<Objective[]>([])
  const [tasks, setTasks]           = useState<WeekTask[]>([])
  const [viewUserId, setViewUserId]  = useState<string>(user?.id || '')
  const [loading, setLoading]       = useState(true)
  const [creating, setCreating]     = useState(false)

  // Quick-add inputs per zone
  const [newText, setNewText] = useState<Record<string, string>>({ director: '', mine: '', inbox: '' })
  const [addingZone, setAddingZone] = useState<string | null>(null)

  // Objectives
  const [newObjTitle, setNewObjTitle]   = useState('')
  const [addingObj, setAddingObj]       = useState(false)
  const [objsOpen, setObjsOpen]        = useState(true)

  // Completed tasks collapsed
  const [completedOpen, setCompletedOpen] = useState(false)

  // ── Set default view user ───────────────────────────────────────
  useEffect(() => {
    if (user?.id && !viewUserId) setViewUserId(user.id)
  }, [user])

  // ── Fetch current week ──────────────────────────────────────────
  const fetchWeek = useCallback(async () => {
    const supabase = createClient()
    const { monday } = getCurrentWeekBounds()

    const { data } = await supabase
      .from('weeks')
      .select('*')
      .eq('status', 'active')
      .gte('starts_at', monday)
      .limit(1)
      .maybeSingle()

    setWeek(data)
    setLoading(false)
  }, [])

  // ── Fetch objectives ────────────────────────────────────────────
  const fetchObjectives = useCallback(async () => {
    if (!week) return
    const supabase = createClient()
    const { data } = await supabase
      .from('objectives')
      .select('*')
      .eq('week_id', week.id)
      .order('sort_order')
    setObjectives(data || [])
  }, [week])

  // ── Fetch tasks ─────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    if (!week || !viewUserId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('tasks')
      .select('*, client:clients!client_id(name)')
      .eq('week_id', week.id)
      .eq('assigned_to', viewUserId)
      .order('sort_order')
    setTasks((data as WeekTask[]) || [])
  }, [week, viewUserId])

  useEffect(() => { fetchWeek() }, [fetchWeek])
  useEffect(() => { if (week) { fetchObjectives(); fetchTasks() } }, [week, fetchObjectives, fetchTasks])
  useEffect(() => { fetchTasks() }, [viewUserId, fetchTasks])

  // ── Create week ─────────────────────────────────────────────────
  const createWeek = async () => {
    if (!user) return
    setCreating(true)
    const supabase = createClient()
    const { monday, friday } = getCurrentWeekBounds()
    const { data } = await supabase
      .from('weeks')
      .insert({ starts_at: monday, ends_at: friday, status: 'active', created_by: user.id })
      .select()
      .single()
    if (data) setWeek(data)
    setCreating(false)
  }

  // ── Mutations ───────────────────────────────────────────────────
  const addTask = async (zone: 'director' | 'mine' | 'inbox') => {
    const title = newText[zone]?.trim()
    if (!title || !week) return
    const supabase = createClient()
    const targetUser = zone === 'director' ? viewUserId : (viewUserId || user?.id)

    await supabase.from('tasks').insert({
      title,
      week_id: week.id,
      assigned_to: targetUser,
      created_by: user?.id,
      zone,
      is_pinned: zone === 'director',
      pinned_by: zone === 'director' ? user?.id : null,
      origin: zone === 'director' ? 'director' : 'manual',
      status: 'pending',
      priority: 'medium',
      sort_order: tasks.filter(t => t.zone === zone).length,
    })

    setNewText(p => ({ ...p, [zone]: '' }))
    setAddingZone(null)
    fetchTasks()
  }

  const moveZone = async (taskId: string, newZone: 'director' | 'mine' | 'inbox') => {
    const supabase = createClient()
    await supabase.from('tasks').update({
      zone: newZone,
      is_pinned: newZone === 'director',
      pinned_by: newZone === 'director' ? user?.id : null,
      pinned_at: newZone === 'director' ? new Date().toISOString() : null,
    }).eq('id', taskId)

    // Log change
    await supabase.from('task_log').insert({
      task_id: taskId, changed_by: user?.id,
      change_type: 'zone_change',
      new_value: { zone: newZone },
    })

    fetchTasks()
  }

  const toggleFocus = async (taskId: string, current: boolean) => {
    const supabase = createClient()
    await supabase.from('tasks').update({ is_focus_today: !current }).eq('id', taskId)
    setTasks(p => p.map(t => t.id === taskId ? { ...t, is_focus_today: !current } : t))
  }

  const completeTask = async (taskId: string) => {
    const supabase = createClient()
    await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', taskId)
    fetchTasks()
  }

  const addObjective = async () => {
    const title = newObjTitle.trim()
    if (!title || !week) return
    const supabase = createClient()
    await supabase.from('objectives').insert({
      week_id: week.id, title,
      sort_order: objectives.length + 1,
      status: 'open', tag: 'interno',
    })
    setNewObjTitle('')
    setAddingObj(false)
    fetchObjectives()
  }

  const cycleObjStatus = async (obj: Objective) => {
    const supabase = createClient()
    const next = OBJ_STATUS_NEXT[obj.status]
    await supabase.from('objectives').update({ status: next }).eq('id', obj.id)
    setObjectives(p => p.map(o => o.id === obj.id ? { ...o, status: next as any } : o))
  }

  // ── Derived task groups ─────────────────────────────────────────
  const activeTasks  = tasks.filter(t => t.status !== 'completed')
  const doneTasks    = tasks.filter(t => t.status === 'completed')
  const directorTasks = activeTasks.filter(t => t.zone === 'director')
  const mineTasks     = activeTasks.filter(t => t.zone === 'mine')
  const inboxTasks    = activeTasks.filter(t => t.zone === 'inbox')

  const viewedUser = users.find(u => u.id === viewUserId)

  // ═══════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════

  // ── No active week ──────────────────────────────────────────────
  if (!loading && !week) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Target className="w-12 h-12 text-ink-3/30" />
        <p className="text-ink-3 text-sm">No hay semana activa esta semana.</p>
        {isAdmin && (
          <button
            onClick={createWeek}
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-2xl font-semibold text-sm hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Iniciar semana
          </button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Week header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-0.5">Semana activa</p>
          <h2 className="text-lg font-bold text-ink">
            {week ? formatWeekRange(week.starts_at, week.ends_at) : '—'}
          </h2>
        </div>
        {isAdmin && (
          <button
            onClick={createWeek}
            disabled={creating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ink-3 hover:text-brand bg-bg-2 hover:bg-primary/5 rounded-xl transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Nueva semana
          </button>
        )}
      </div>

      {/* ── Objectives bar ── */}
      <div className="bg-bg rounded-2xl border border-surface-container-low shadow-ambient-xs">
        <button
          onClick={() => setObjsOpen(!objsOpen)}
          className="w-full flex items-center gap-3 px-4 py-3"
        >
          <Sparkles className="w-4 h-4 text-brand" />
          <span className="text-sm font-bold text-ink">Objetivos de la semana</span>
          <span className="text-xs text-ink-3 ml-1">({objectives.length}/5)</span>
          <ChevronDown className={cn('w-4 h-4 text-ink-3 ml-auto transition-transform', objsOpen ? 'rotate-0' : '-rotate-90')} />
        </button>

        <AnimatePresence>
          {objsOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="px-4 pb-4 space-y-2">
                {objectives.length === 0 && (
                  <p className="text-xs text-ink-3/60 italic">Sin objetivos esta semana.</p>
                )}
                {objectives.map((obj, i) => (
                  <div key={obj.id} className="flex items-start gap-2.5 group">
                    <button
                      onClick={() => cycleObjStatus(obj)}
                      className="mt-0.5 shrink-0 transition-all hover:scale-110"
                      title="Cambiar estado"
                    >
                      {OBJ_STATUS_ICON[obj.status]}
                    </button>
                    <div className="flex-1">
                      <p className={cn('text-sm text-ink', obj.status === 'done' && 'line-through text-ink-3')}>
                        <span className="text-ink-3 text-xs mr-1.5">{i + 1}.</span>
                        {obj.title}
                      </p>
                    </div>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', TAG_COLORS[obj.tag] || TAG_COLORS.interno)}>
                      {TAG_LABELS[obj.tag] || obj.tag}
                    </span>
                  </div>
                ))}

                {/* Add objective */}
                {isAdmin && objectives.length < 5 && (
                  addingObj ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        autoFocus
                        value={newObjTitle}
                        onChange={e => setNewObjTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addObjective(); if (e.key === 'Escape') { setAddingObj(false); setNewObjTitle('') } }}
                        placeholder="Objetivo de esta semana..."
                        className="flex-1 px-3 py-2 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 outline-none"
                      />
                      <button onClick={addObjective} className="p-2 bg-brand text-white rounded-xl hover:bg-primary/90 transition-all">
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingObj(true)}
                      className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-brand transition-colors mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Añadir objetivo
                    </button>
                  )
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── User selector (admin only) ── */}
      {isAdmin && (
        <div className="flex flex-wrap gap-1.5">
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => setViewUserId(u.id)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                viewUserId === u.id ? 'bg-brand text-white' : 'bg-bg-2 text-ink-3 hover:bg-bg-2'
              )}
            >
              {getUserInitials(u.full_name)}
            </button>
          ))}
        </div>
      )}

      {/* ── Plan zones ── */}
      <div className="space-y-3">

        {/* ── ZONA: Fijado por dirección ── */}
        <TaskZone
          label="Fijado por dirección"
          icon={<Lock className="w-3.5 h-3.5" />}
          color="text-brand"
          bgColor="bg-primary/5 border-primary/10"
          tasks={directorTasks}
          zone="director"
          isAdmin={isAdmin}
          viewingOther={viewUserId !== user?.id}
          newText={newText.director}
          onNewText={v => setNewText(p => ({ ...p, director: v }))}
          addingHere={addingZone === 'director'}
          onStartAdd={() => setAddingZone('director')}
          onAdd={() => addTask('director')}
          onCancelAdd={() => { setAddingZone(null); setNewText(p => ({ ...p, director: '' })) }}
          onComplete={completeTask}
          onFocus={toggleFocus}
          onMoveZone={isAdmin ? moveZone : undefined}
        />

        {/* ── ZONA: Mis tareas ── */}
        <TaskZone
          label="Mis tareas"
          icon={<Pencil className="w-3.5 h-3.5" />}
          color="text-ink"
          bgColor="bg-bg border-surface-container-low"
          tasks={mineTasks}
          zone="mine"
          isAdmin={isAdmin}
          viewingOther={viewUserId !== user?.id}
          newText={newText.mine}
          onNewText={v => setNewText(p => ({ ...p, mine: v }))}
          addingHere={addingZone === 'mine'}
          onStartAdd={() => setAddingZone('mine')}
          onAdd={() => addTask('mine')}
          onCancelAdd={() => { setAddingZone(null); setNewText(p => ({ ...p, mine: '' })) }}
          onComplete={completeTask}
          onFocus={toggleFocus}
          onMoveZone={isAdmin ? moveZone : undefined}
        />

        {/* ── ZONA: Sin revisar ── */}
        <TaskZone
          label="Sin revisar"
          icon={<Inbox className="w-3.5 h-3.5" />}
          color="text-ink-3"
          bgColor="bg-bg-2 border-line-2-variant/30"
          tasks={inboxTasks}
          zone="inbox"
          isAdmin={isAdmin}
          viewingOther={viewUserId !== user?.id}
          newText={newText.inbox}
          onNewText={v => setNewText(p => ({ ...p, inbox: v }))}
          addingHere={addingZone === 'inbox'}
          onStartAdd={() => setAddingZone('inbox')}
          onAdd={() => addTask('inbox')}
          onCancelAdd={() => { setAddingZone(null); setNewText(p => ({ ...p, inbox: '' })) }}
          onComplete={completeTask}
          onFocus={toggleFocus}
          onMoveZone={isAdmin ? moveZone : undefined}
        />

        {/* ── Realizadas (collapsible) ── */}
        {doneTasks.length > 0 && (
          <div>
            <button
              onClick={() => setCompletedOpen(!completedOpen)}
              className="w-full flex items-center gap-3 px-4 py-2.5 bg-ok-container/20 hover:bg-ok-container/40 rounded-2xl transition-all"
            >
              <div className="w-2 h-2 rounded-full bg-ok" />
              <span className="text-xs font-bold text-ok uppercase tracking-wider">Realizadas esta semana</span>
              <span className="text-xs text-ok/60 ml-1">({doneTasks.length})</span>
              <ChevronDown className={cn('w-4 h-4 text-ok ml-auto transition-transform', completedOpen ? '' : '-rotate-90')} />
            </button>
            <AnimatePresence>
              {completedOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="space-y-1 mt-2">
                    {doneTasks.map(t => (
                      <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 bg-bg rounded-xl">
                        <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
                        <p className="text-sm text-ink-3 line-through flex-1 truncate">{t.title}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// TaskZone sub-component
// ════════════════════════════════════════════════════════════════════
function TaskZone({
  label, icon, color, bgColor, tasks, zone,
  isAdmin, viewingOther,
  newText, onNewText, addingHere, onStartAdd, onAdd, onCancelAdd,
  onComplete, onFocus, onMoveZone,
}: {
  label: string
  icon: React.ReactNode
  color: string
  bgColor: string
  tasks: WeekTask[]
  zone: string
  isAdmin: boolean
  viewingOther: boolean
  newText: string
  onNewText: (v: string) => void
  addingHere: boolean
  onStartAdd: () => void
  onAdd: () => void
  onCancelAdd: () => void
  onComplete: (id: string) => void
  onFocus: (id: string, current: boolean) => void
  onMoveZone?: (id: string, z: 'director' | 'mine' | 'inbox') => void
}) {
  const canAdd = isAdmin || !viewingOther || zone !== 'director'

  return (
    <div className={cn('rounded-2xl border shadow-ambient-xs', bgColor)}>
      {/* Zone header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className={cn('flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider', color)}>
          {icon}{label}
        </span>
        <span className="text-xs text-ink-3/60 ml-1">({tasks.length})</span>
        {canAdd && (
          <button
            onClick={onStartAdd}
            className="ml-auto p-1 rounded-lg hover:bg-primary/10 text-ink-3 hover:text-brand transition-all"
            title="Añadir tarea"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Task list */}
      {(tasks.length > 0 || addingHere) && (
        <div className="px-3 pb-3 space-y-1.5">
          {tasks.map(task => (
            <WeekTaskRow
              key={task.id}
              task={task}
              zone={zone}
              isAdmin={isAdmin}
              onComplete={() => onComplete(task.id)}
              onFocus={() => onFocus(task.id, task.is_focus_today)}
              onMoveZone={onMoveZone}
            />
          ))}

          {/* Quick-add input */}
          {addingHere && (
            <div className="flex items-center gap-2 pt-1">
              <input
                autoFocus
                value={newText}
                onChange={e => onNewText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onAdd()
                  if (e.key === 'Escape') onCancelAdd()
                }}
                placeholder="Título de la tarea..."
                className="flex-1 px-3 py-2 bg-bg rounded-xl text-sm text-ink placeholder:text-ink-3/50 outline-none border border-surface-container-low focus:border-brand/40 transition-all"
              />
              <button onClick={onAdd} className="p-2 bg-brand text-white rounded-xl hover:bg-primary/90 transition-all">
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {tasks.length === 0 && !addingHere && (
        <div className="px-4 pb-3">
          <p className="text-xs text-ink-3/40 italic">Vacío</p>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// WeekTaskRow sub-component
// ════════════════════════════════════════════════════════════════════
function WeekTaskRow({
  task, zone, isAdmin, onComplete, onFocus, onMoveZone
}: {
  task: WeekTask
  zone: string
  isAdmin: boolean
  onComplete: () => void
  onFocus: () => void
  onMoveZone?: (id: string, z: 'director' | 'mine' | 'inbox') => void
}) {
  const [showMove, setShowMove] = useState(false)

  const MOVE_OPTIONS = ([
    { z: 'director' as const, label: '📌 Dirección' },
    { z: 'mine' as const, label: '✏️ Mis tareas' },
    { z: 'inbox' as const, label: '📥 Sin revisar' },
  ] as const).filter(o => o.z !== zone)

  return (
    <div className={cn(
      'group flex items-center gap-2.5 px-3 py-2.5 bg-bg rounded-xl hover:bg-bg-2/60 transition-all relative',
      task.is_focus_today && 'ring-1 ring-amber-300/60 bg-amber-50/40'
    )}>
      {/* Complete button */}
      <button
        onClick={onComplete}
        className="shrink-0 w-5 h-5 rounded-full border-2 border-ink-3/30 hover:border-ok hover:bg-ok/10 flex items-center justify-center transition-all group/c"
      >
        <CheckCircle2 className="w-3 h-3 text-ink-3/20 group-hover/c:text-ok transition-colors" />
      </button>

      {/* Pin indicator */}
      {task.is_pinned && (
        <Lock className="w-3 h-3 text-brand/50 shrink-0" />
      )}

      {/* Title */}
      <p className="flex-1 text-sm text-ink truncate">{task.title}</p>

      {/* Origin badge */}
      {task.origin && ORIGIN_BADGE[task.origin] && (
        <span className="text-[9px] px-1 py-0.5 bg-bg-2 text-ink-3 rounded font-medium shrink-0">
          {ORIGIN_BADGE[task.origin]}
        </span>
      )}

      {/* Focus toggle */}
      <button
        onClick={onFocus}
        title={task.is_focus_today ? 'Quitar foco' : 'Foco de hoy'}
        className={cn(
          'shrink-0 p-1 rounded-lg transition-all',
          task.is_focus_today
            ? 'text-amber-500 bg-amber-100/60'
            : 'text-ink-3/30 hover:text-amber-400 opacity-0 group-hover:opacity-100'
        )}
      >
        <Sun className="w-3.5 h-3.5" />
      </button>

      {/* Admin: move zone */}
      {isAdmin && onMoveZone && (
        <div className="relative shrink-0">
          <button
            onClick={() => setShowMove(!showMove)}
            className="p-1 rounded-lg text-ink-3/30 hover:text-brand opacity-0 group-hover:opacity-100 transition-all"
            title="Mover zona"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          {showMove && (
            <div className="absolute right-0 top-7 z-10 bg-bg border border-surface-container-low rounded-xl shadow-ambient-sm overflow-hidden min-w-[130px]">
              {MOVE_OPTIONS.map(opt => (
                <button
                  key={opt.z}
                  onClick={() => { onMoveZone(task.id, opt.z); setShowMove(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-bg-2 transition-all"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
