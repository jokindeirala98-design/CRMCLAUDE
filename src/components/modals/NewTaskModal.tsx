'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { getUserInitials } from '@/lib/utils/format'
import { useAuthStore } from '@/stores/auth'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'Alta (Rojo)' },
  { value: 'medium', label: 'Media (Amarillo)' },
  { value: 'low', label: 'Baja (Verde)' },
]

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'completed', label: 'Completada' },
]

export function NewTaskModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuthStore()
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [clients, setClients] = useState<any[]>([])
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'pending',
    assigned_to: '',
    client_id: '',
    due_date: '',
  })

  useEffect(() => {
    if (!open) return
    const fetchData = async () => {
      const supabase = createClient()
      const [usersRes, clientsRes] = await Promise.all([
        supabase.from('users_profile').select('id, full_name, role').eq('active', true).order('full_name'),
        supabase.from('clients').select('id, name').order('name'),
      ])
      setUsers(usersRes.data || [])
      setClients(clientsRes.data || [])
    }
    fetchData()
    // Reset form
    setForm({
      title: '',
      description: '',
      priority: 'medium',
      status: 'pending',
      assigned_to: '',
      client_id: '',
      due_date: '',
    })
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setLoading(true)

    const supabase = createClient()

    // Get max sort_order for the assignee
    const assignee = form.assigned_to || user?.id
    const { data: existing } = await supabase
      .from('tasks')
      .select('sort_order')
      .eq('assigned_to', assignee)
      .eq('status', 'pending')
      .order('sort_order', { ascending: false })
      .limit(1)

    const nextOrder = existing && existing.length > 0 ? (existing[0].sort_order || 0) + 1 : 0

    const { error } = await supabase.from('tasks').insert({
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      status: form.status,
      assigned_to: form.assigned_to || null,
      created_by: user?.id,
      client_id: form.client_id || null,
      due_date: form.due_date || null,
      sort_order: nextOrder,
    })

    if (!error) {
      onCreated()
      onClose()
    }
    setLoading(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative bg-surface rounded-3xl shadow-ambient-lg w-full max-w-lg mx-4 overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-surface-container-low">
          <h2 className="font-display font-bold text-lg text-on-surface">Nueva Tarea</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
            <X className="w-5 h-5 text-on-surface-variant" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <Input
            label="Titulo de la tarea"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ej: Solicitar prescoring CUPS ES0021..."
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-on-surface">Descripcion</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 bg-surface-container-high rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none transition-all focus:bg-surface-container-lowest"
              placeholder="Detalles adicionales..."
            />
          </div>

          <SearchableClientSelector
            label="Cliente relacionado"
            value={form.client_id}
            onChange={(clientId) => setForm({ ...form, client_id: clientId })}
            clients={clients}
            placeholder="Buscar cliente..."
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Prioridad"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              options={PRIORITY_OPTIONS}
            />
            <Select
              label="Asignar a"
              value={form.assigned_to}
              onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
            >
              <option value="">Sin asignar</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {getUserInitials(u.full_name)} {u.role === 'admin' ? '(Admin)' : ''}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Fecha limite"
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !form.title.trim()}>
              {loading ? 'Creando...' : 'Crear Tarea'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
