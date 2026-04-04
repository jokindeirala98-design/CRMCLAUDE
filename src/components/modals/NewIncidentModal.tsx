'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  preselectedClientId?: string
}

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'Alta (Rojo)' },
  { value: 'medium', label: 'Media (Amarillo)' },
  { value: 'low', label: 'Baja (Verde)' },
]

export function NewIncidentModal({ open, onClose, onCreated, preselectedClientId }: Props) {
  const { user } = useAuthStore()
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    client_id: preselectedClientId || '',
  })

  useEffect(() => {
    if (!open) return
    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, name')
        .order('name')
      setClients(data || [])
    }
    fetchClients()
    // Reset form but keep preselected client
    setForm({
      title: '',
      description: '',
      priority: 'medium',
      client_id: preselectedClientId || '',
    })
  }, [open, preselectedClientId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.client_id) return
    setLoading(true)

    const supabase = createClient()

    const { error } = await supabase.from('incidents').insert({
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      status: 'open',
      client_id: form.client_id,
      created_by: user?.id,
      assigned_to: null,
      resolved_at: null,
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
          <h2 className="font-display font-bold text-lg text-on-surface">Nuevo Incidente</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
            <X className="w-5 h-5 text-on-surface-variant" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <Input
            label="Titulo del incidente"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ej: Error en facturación de CUPS..."
          />

          <SearchableClientSelector
            label="Cliente"
            required
            value={form.client_id}
            onChange={(clientId) => setForm({ ...form, client_id: clientId })}
            clients={clients}
            placeholder="Buscar cliente..."
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-on-surface">Descripcion</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 bg-surface-container-high rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none transition-all focus:bg-surface-container-lowest"
              placeholder="Detalles del incidente..."
            />
          </div>

          <Select
            label="Prioridad"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={PRIORITY_OPTIONS}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !form.title.trim() || !form.client_id}>
              {loading ? 'Creando...' : 'Crear Incidente'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
