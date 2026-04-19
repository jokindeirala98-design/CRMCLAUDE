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
  preselectedDate?: string
}

export function NewAppointmentModal({ open, onClose, onCreated, preselectedDate }: Props) {
  const { user } = useAuthStore()
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    client_id: '',
    type: 'presentation' as string,
    scheduled_at: preselectedDate || '',
    scheduled_time: '10:00',
    location: '',
    notes: '',
  })

  useEffect(() => {
    if (!open) return
    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('clients').select('id, name').order('name')
      setClients(data || [])
    }
    fetchClients()

    if (preselectedDate) {
      setForm((f) => ({ ...f, scheduled_at: preselectedDate }))
    } else if (!form.scheduled_at) {
      setForm((f) => ({ ...f, scheduled_at: new Date().toISOString().split('T')[0] }))
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_id || !form.scheduled_at) return
    setLoading(true)

    const scheduledAt = new Date(`${form.scheduled_at}T${form.scheduled_time}:00`).toISOString()
    const supabase = createClient()
    const { error } = await supabase.from('appointments').insert({
      client_id: form.client_id,
      type: form.type,
      scheduled_at: scheduledAt,
      location: form.location || null,
      commercial_id: user?.id,
      status: 'scheduled',
      notes: form.notes || null,
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
        className="relative bg-bg rounded-3xl shadow-ambient-lg w-full max-w-lg mx-4 overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-surface-container-low">
          <h2 className="font-sans font-bold text-lg text-ink">Nueva Cita</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
            <X className="w-5 h-5 text-ink-3" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <SearchableClientSelector
            label="Cliente"
            required
            value={form.client_id}
            onChange={(clientId) => setForm({ ...form, client_id: clientId })}
            clients={clients}
            placeholder="Buscar cliente..."
          />

          <Select
            label="Tipo de cita"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={[
              { value: 'presentation', label: 'Presentación' },
              { value: 'followup', label: 'Seguimiento' },
              { value: 'signing', label: 'Firma' },
              { value: 'other', label: 'Otro' },
            ]}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Fecha"
              type="date"
              required
              value={form.scheduled_at}
              onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
            />
            <Input
              label="Hora"
              type="time"
              value={form.scheduled_time}
              onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })}
            />
          </div>

          <Input
            label="Ubicacion"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Direccion o enlace videoconferencia"
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full px-4 py-2.5 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 outline-none transition-all focus:bg-card"
              placeholder="Notas adicionales..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading || !form.client_id}>
              {loading ? 'Creando...' : 'Crear Cita'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
