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
  preselectedSupplyId?: string
}

export function NewContractModal({ open, onClose, onCreated, preselectedClientId, preselectedSupplyId }: Props) {
  const { user } = useAuthStore()
  const [clients, setClients] = useState<any[]>([])
  const [supplies, setSupplies] = useState<any[]>([])
  const [comercializadoras, setComercializadoras] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    client_id: preselectedClientId || '',
    supply_id: preselectedSupplyId || '',
    type: 'voltis' as 'voltis' | 'comercializadora',
    comercializadora_id: '',
  })

  useEffect(() => {
    if (!open) return
    const fetchData = async () => {
      const supabase = createClient()
      const [clientsRes, comercRes] = await Promise.all([
        supabase.from('clients').select('id, name, cif, nif, cif_nif').order('name'),
        supabase.from('comercializadoras').select('id, name').eq('active', true).order('name'),
      ])
      setClients(clientsRes.data || [])
      setComercializadoras(comercRes.data || [])

      // If preselected client, load their supplies
      if (preselectedClientId) {
        const { data } = await supabase
          .from('supplies')
          .select('id, cups, tariff, type')
          .eq('client_id', preselectedClientId)
          .order('created_at', { ascending: false })
        setSupplies(data || [])
      }
    }
    fetchData()
  }, [open, preselectedClientId])

  // Load supplies when client changes
  useEffect(() => {
    if (!form.client_id) { setSupplies([]); return }
    const fetchSupplies = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('supplies')
        .select('id, cups, tariff, type')
        .eq('client_id', form.client_id)
        .order('created_at', { ascending: false })
      setSupplies(data || [])
    }
    fetchSupplies()
  }, [form.client_id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_id || !form.supply_id) return
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.from('contracts').insert({
      client_id: form.client_id,
      supply_id: form.supply_id,
      type: form.type,
      comercializadora_id: form.type === 'comercializadora' ? form.comercializadora_id || null : null,
      status: 'draft',
      created_by: user?.id,
      generated_at: new Date().toISOString(),
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
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-surface rounded-3xl shadow-ambient-lg w-full max-w-lg mx-4 overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-surface-container-low">
          <h2 className="font-display font-bold text-lg text-on-surface">Nuevo Contrato</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
            <X className="w-5 h-5 text-on-surface-variant" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Client */}
          <SearchableClientSelector
            label="Cliente"
            required
            value={form.client_id}
            onChange={(clientId) => setForm({ ...form, client_id: clientId, supply_id: '' })}
            clients={clients}
            placeholder="Buscar cliente..."
          />

          {/* Supply */}
          <Select
            label="Suministro (CUPS)"
            required
            value={form.supply_id}
            onChange={(e) => setForm({ ...form, supply_id: e.target.value })}
            disabled={!form.client_id}
          >
            <option value="">Seleccionar suministro</option>
            {supplies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.cups || 'Sin CUPS'} — {s.type?.toUpperCase()} {s.tariff}
              </option>
            ))}
          </Select>

          {/* Contract type */}
          <Select
            label="Tipo de contrato"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as 'voltis' | 'comercializadora' })}
          >
            <option value="voltis">Contrato Voltis</option>
            <option value="comercializadora">Contrato Comercializadora</option>
          </Select>

          {/* Comercializadora (only if type is comercializadora) */}
          {form.type === 'comercializadora' && (
            <Select
              label="Comercializadora"
              required
              value={form.comercializadora_id}
              onChange={(e) => setForm({ ...form, comercializadora_id: e.target.value })}
            >
              <option value="">Seleccionar comercializadora</option>
              {comercializadoras.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !form.client_id || !form.supply_id}>
              {loading ? 'Creando...' : 'Crear Contrato'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
