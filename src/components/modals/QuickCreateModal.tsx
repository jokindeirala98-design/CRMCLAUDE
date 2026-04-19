'use client'

import { useState, useEffect } from 'react'
import { X, Calendar, CheckSquare, Clock, MapPin, User } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /** ISO date string yyyy-MM-dd pre-filled from the clicked day */
  date: string
}

const APPOINTMENT_TYPES = [
  { value: 'presentation', label: 'Presentación', color: 'bg-primary/10 text-brand border-primary/20' },
  { value: 'followup',     label: 'Seguimiento',  color: 'bg-ok-container text-ok border-ok/20' },
  { value: 'signing',      label: 'Firma',         color: 'bg-warn-container text-warn border-warn/20' },
  { value: 'other',        label: 'Otro',          color: 'bg-bg-2 text-ink-3 border-surface-container-low' },
]

const PRIORITIES = [
  { value: 'high',   label: 'Alta',   color: 'bg-err-container text-err border-err/20' },
  { value: 'medium', label: 'Media',  color: 'bg-warn-container text-warn border-warn/20' },
  { value: 'low',    label: 'Baja',   color: 'bg-ok-container text-ok border-ok/20' },
]

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

function formatDisplayDate(isoDate: string) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${d} de ${MONTHS_ES[m - 1]} de ${y}`
}

export function QuickCreateModal({ open, onClose, onCreated, date }: Props) {
  const { user } = useAuthStore()
  const [tab, setTab] = useState<'cita' | 'tarea'>('cita')
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Cita form
  const [citaForm, setCitaForm] = useState({
    client_id: '',
    type: 'presentation',
    time: '10:00',
    location: '',
  })

  // Tarea form
  const [tareaForm, setTareaForm] = useState({
    title: '',
    client_id: '',
    priority: 'medium',
    due_date: date,
  })

  useEffect(() => {
    if (!open) return
    // Reset forms with the clicked date
    setCitaForm({ client_id: '', type: 'presentation', time: '10:00', location: '' })
    setTareaForm({ title: '', client_id: '', priority: 'medium', due_date: date })
    setTab('cita')

    const supabase = createClient()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => {
      setClients(data || [])
    })
  }, [open, date])

  const handleCreateCita = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!citaForm.client_id) return
    setLoading(true)
    const supabase = createClient()
    const scheduledAt = new Date(`${date}T${citaForm.time}:00`).toISOString()
    const { data: apt, error } = await supabase.from('appointments').insert({
      client_id: citaForm.client_id,
      type: citaForm.type,
      scheduled_at: scheduledAt,
      location: citaForm.location || null,
      commercial_id: user?.id,
      status: 'scheduled',
    }).select('id').single()
    setLoading(false)
    if (!error) {
      // Sync to Google Calendar (fire-and-forget)
      if (apt?.id) {
        fetch('/api/google/sync-appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointmentId: apt.id }),
        }).catch(() => {})
      }
      onCreated(); onClose()
    }
  }

  const handleCreateTarea = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tareaForm.title.trim()) return
    setLoading(true)
    const supabase = createClient()

    const { data: existing } = await supabase
      .from('tasks')
      .select('sort_order')
      .eq('assigned_to', user?.id)
      .eq('status', 'pending')
      .order('sort_order', { ascending: false })
      .limit(1)
    const nextOrder = existing?.length ? (existing[0].sort_order || 0) + 1 : 0

    const { error } = await supabase.from('tasks').insert({
      title: tareaForm.title.trim(),
      priority: tareaForm.priority,
      status: 'pending',
      assigned_to: user?.id,
      created_by: user?.id,
      client_id: tareaForm.client_id || null,
      due_date: tareaForm.due_date || null,
      sort_order: nextOrder,
    })
    setLoading(false)
    if (!error) {
      // Sync tasks briefing to Google Calendar (fire-and-forget)
      fetch('/api/google/sync-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id }),
      }).catch(() => {})
      onCreated(); onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.15 }}
        className="relative bg-bg rounded-3xl shadow-ambient-lg w-full max-w-sm mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <p className="text-xs text-ink-3 font-medium uppercase tracking-wide">Crear rápido</p>
            <p className="text-sm font-semibold text-ink mt-0.5">{formatDisplayDate(date)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-bg-2 transition-all">
            <X className="w-4 h-4 text-ink-3" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mx-5 mb-4 p-1 bg-bg-2 rounded-2xl">
          <button
            onClick={() => setTab('cita')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === 'cita'
                ? 'bg-bg text-ink shadow-sm'
                : 'text-ink-3 hover:text-ink'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Cita
          </button>
          <button
            onClick={() => setTab('tarea')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === 'tarea'
                ? 'bg-bg text-ink shadow-sm'
                : 'text-ink-3 hover:text-ink'
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            Tarea
          </button>
        </div>

        {/* Cita form */}
        <AnimatePresence mode="wait">
          {tab === 'cita' && (
            <motion.form
              key="cita"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.12 }}
              onSubmit={handleCreateCita}
              className="px-5 pb-5 space-y-3"
            >
              {/* Client */}
              <SearchableClientSelector
                label="Cliente"
                required
                value={citaForm.client_id}
                onChange={(id) => setCitaForm({ ...citaForm, client_id: id })}
                clients={clients}
                placeholder="Buscar cliente..."
              />

              {/* Type pills */}
              <div>
                <p className="text-xs font-medium text-ink-3 mb-1.5">Tipo</p>
                <div className="flex flex-wrap gap-1.5">
                  {APPOINTMENT_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setCitaForm({ ...citaForm, type: t.value })}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                        citaForm.type === t.value
                          ? t.color + ' ring-1 ring-current ring-offset-1 ring-offset-bg'
                          : 'bg-bg-2 text-ink-3 border-transparent hover:border-surface-container-low'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time + location */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <Input
                    label="Hora"
                    type="time"
                    value={citaForm.time}
                    onChange={(e) => setCitaForm({ ...citaForm, time: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <Input
                    label="Lugar (opcional)"
                    value={citaForm.location}
                    onChange={(e) => setCitaForm({ ...citaForm, location: e.target.value })}
                    placeholder="Dirección o enlace"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !citaForm.client_id}
              >
                {loading ? 'Creando...' : 'Crear cita'}
              </Button>
            </motion.form>
          )}

          {/* Tarea form */}
          {tab === 'tarea' && (
            <motion.form
              key="tarea"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.12 }}
              onSubmit={handleCreateTarea}
              className="px-5 pb-5 space-y-3"
            >
              {/* Title */}
              <Input
                label="Título de la tarea"
                required
                autoFocus
                value={tareaForm.title}
                onChange={(e) => setTareaForm({ ...tareaForm, title: e.target.value })}
                placeholder="¿Qué hay que hacer?"
              />

              {/* Priority pills */}
              <div>
                <p className="text-xs font-medium text-ink-3 mb-1.5">Prioridad</p>
                <div className="flex gap-1.5">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setTareaForm({ ...tareaForm, priority: p.value })}
                      className={`flex-1 py-1 rounded-full text-xs font-semibold border transition-all ${
                        tareaForm.priority === p.value
                          ? p.color + ' ring-1 ring-current ring-offset-1 ring-offset-bg'
                          : 'bg-bg-2 text-ink-3 border-transparent hover:border-surface-container-low'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Client (optional) */}
              <SearchableClientSelector
                label="Cliente (opcional)"
                value={tareaForm.client_id}
                onChange={(id) => setTareaForm({ ...tareaForm, client_id: id })}
                clients={clients}
                placeholder="Vincular a un cliente..."
              />

              {/* Due date */}
              <Input
                label="Fecha límite"
                type="date"
                value={tareaForm.due_date}
                onChange={(e) => setTareaForm({ ...tareaForm, due_date: e.target.value })}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !tareaForm.title.trim()}
              >
                {loading ? 'Creando...' : 'Crear tarea'}
              </Button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
