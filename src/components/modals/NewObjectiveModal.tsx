'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { getUserInitials } from '@/lib/utils/format'
import { useAuthStore } from '@/stores/auth'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export function NewObjectiveModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuthStore()
  const [commercials, setCommercials] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '',
    target_type: 'contracts' as string,
    tariff_filter: '',
    target_count: '',
    scope: 'team' as string,
    assigned_to: '',
    period_start: '',
    period_end: '',
  })

  useEffect(() => {
    if (!open) return
    const fetchCommercials = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('users_profile').select('id, full_name, role').order('full_name')
      setCommercials(data || [])
    }
    fetchCommercials()

    // Default: current quarter
    const now = new Date()
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
    const qEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0)
    setForm((f) => ({
      ...f,
      period_start: qStart.toISOString().split('T')[0],
      period_end: qEnd.toISOString().split('T')[0],
    }))
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.target_count) return
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.from('objectives').insert({
      title: form.title,
      target_type: form.target_type,
      tariff_filter: form.tariff_filter || null,
      target_count: parseInt(form.target_count),
      current_count: 0,
      scope: form.scope,
      assigned_to: form.scope === 'individual' ? form.assigned_to || null : null,
      period_start: form.period_start,
      period_end: form.period_end,
      created_by: user?.id,
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
          <h2 className="font-sans font-bold text-lg text-ink">Nuevo Objetivo</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
            <X className="w-5 h-5 text-ink-3" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <Input
            label="Titulo del objetivo"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ej: 20 contratos luz en Q2"
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Tipo de meta"
              value={form.target_type}
              onChange={(e) => setForm({ ...form, target_type: e.target.value })}
              options={[
                { value: 'contracts', label: 'Contratos' },
                { value: 'supplies', label: 'Suministros' },
                { value: 'revenue', label: 'Facturacion (€)' },
              ]}
            />
            <Input
              label="Cantidad objetivo"
              type="number"
              required
              value={form.target_count}
              onChange={(e) => setForm({ ...form, target_count: e.target.value })}
              placeholder="20"
              min="1"
            />
          </div>

          <Input
            label="Filtrar por tarifa (opcional)"
            value={form.tariff_filter}
            onChange={(e) => setForm({ ...form, tariff_filter: e.target.value })}
            placeholder="Ej: 2.0TD, 3.0TD..."
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Alcance"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
              options={[
                { value: 'team', label: 'Equipo' },
                { value: 'individual', label: 'Individual' },
              ]}
            />
            {form.scope === 'individual' && (
              <Select
                label="Asignado a"
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              >
                <option value="">Seleccionar</option>
                {commercials.map((c) => (
                  <option key={c.id} value={c.id}>{getUserInitials(c.full_name)}</option>
                ))}
              </Select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Fecha inicio"
              type="date"
              value={form.period_start}
              onChange={(e) => setForm({ ...form, period_start: e.target.value })}
            />
            <Input
              label="Fecha fin"
              type="date"
              value={form.period_end}
              onChange={(e) => setForm({ ...form, period_end: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading || !form.title || !form.target_count}>
              {loading ? 'Creando...' : 'Crear Objetivo'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
