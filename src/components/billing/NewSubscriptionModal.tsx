/**
 * @deprecated — This file is UNUSED and superseded by the NewSubscriptionWizard
 * component inside /app/(dashboard)/subscriptions/page.tsx.
 * Safe to delete this file.
 */
'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, calculateVAT } from '@/lib/utils/format'
import type { Client } from '@/types/database'

interface Props {
  onClose: () => void
  onCreated: () => void
}

const PLAN_TIERS = [
  { value: '19.99', label: 'Basico - 19,99 EUR/trim' },
  { value: '45', label: 'Profesional - 45,00 EUR/trim' },
  { value: '90', label: 'Empresarial - 90,00 EUR/trim' },
  { value: '180', label: 'Premium - 180,00 EUR/trim' },
]

export function NewSubscriptionModal({ onClose, onCreated }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    client_id: '',
    model: 'fixed' as 'fixed' | 'percentage',
    plan_tier: '19.99',
    percentage_value: '25',
    payment_mode: 'quarterly' as 'quarterly' | 'immediate',
  })

  useEffect(() => {
    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, name, cif_nif')
        .order('name')
      setClients((data as Client[]) || [])
    }
    fetchClients()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_id) return

    setLoading(true)
    const supabase = createClient()

    const planTier = form.model === 'fixed' ? parseFloat(form.plan_tier) : null
    const percentageValue = form.model === 'percentage' ? parseFloat(form.percentage_value) : null

    // Calculate next billing date (3 months from now)
    const nextBilling = new Date()
    nextBilling.setMonth(nextBilling.getMonth() + 3)

    const { error } = await supabase.from('subscriptions').insert({
      client_id: form.client_id,
      model: form.model,
      plan_tier: planTier,
      percentage_value: percentageValue,
      payment_mode: form.payment_mode,
      status: 'pending_activation',
      start_date: new Date().toISOString().split('T')[0],
      next_billing_date: nextBilling.toISOString().split('T')[0],
    })

    setLoading(false)
    if (!error) {
      onCreated()
      onClose()
    }
  }

  // Preview calculation
  const previewAmount = form.model === 'fixed'
    ? form.payment_mode === 'quarterly'
      ? calculateVAT(parseFloat(form.plan_tier))
      : calculateVAT(parseFloat(form.plan_tier) * 4)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative bg-card rounded-2xl shadow-ambient-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-low">
          <h2 className="font-sans font-semibold text-lg text-ink">
            Nueva Suscripcion
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-2 transition-all">
            <X className="w-5 h-5 text-ink-3" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <SearchableClientSelector
            label="Cliente"
            required
            value={form.client_id}
            onChange={(clientId) => setForm({ ...form, client_id: clientId })}
            clients={clients}
            placeholder="Buscar cliente..."
          />

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Modelo de suscripcion
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, model: 'fixed' })}
                className={`p-4 rounded-xl text-left transition-all ${
                  form.model === 'fixed'
                    ? 'bg-primary/5 ring-2 ring-secondary/40'
                    : 'bg-bg-2 hover:bg-bg-2'
                }`}
              >
                <p className="text-sm font-semibold text-ink">Suscripcion fija</p>
                <p className="text-xs text-ink-3 mt-0.5">Cuota trimestral fija</p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, model: 'percentage' })}
                className={`p-4 rounded-xl text-left transition-all ${
                  form.model === 'percentage'
                    ? 'bg-primary/5 ring-2 ring-secondary/40'
                    : 'bg-bg-2 hover:bg-bg-2'
                }`}
              >
                <p className="text-sm font-semibold text-ink">% del ahorro</p>
                <p className="text-xs text-ink-3 mt-0.5">Porcentaje sobre ahorro generado</p>
              </button>
            </div>
          </div>

          {form.model === 'fixed' ? (
            <Select
              id="tier"
              label="Plan"
              value={form.plan_tier}
              onChange={(e) => setForm({ ...form, plan_tier: e.target.value })}
              options={PLAN_TIERS}
            />
          ) : (
            <Input
              id="percentage"
              label="Porcentaje del ahorro (%)"
              type="number"
              min="1"
              max="100"
              value={form.percentage_value}
              onChange={(e) => setForm({ ...form, percentage_value: e.target.value })}
            />
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Modo de pago
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_mode: 'quarterly' })}
                className={`p-4 rounded-xl text-left transition-all ${
                  form.payment_mode === 'quarterly'
                    ? 'bg-primary/5 ring-2 ring-secondary/40'
                    : 'bg-bg-2 hover:bg-bg-2'
                }`}
              >
                <p className="text-sm font-semibold text-ink">Trimestral</p>
                <p className="text-xs text-ink-3 mt-0.5">Pago cada 3 meses</p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_mode: 'immediate' })}
                className={`p-4 rounded-xl text-left transition-all ${
                  form.payment_mode === 'immediate'
                    ? 'bg-primary/5 ring-2 ring-secondary/40'
                    : 'bg-bg-2 hover:bg-bg-2'
                }`}
              >
                <p className="text-sm font-semibold text-ink">Pago unico anual</p>
                <p className="text-xs text-ink-3 mt-0.5">Trimestral x4 + IVA</p>
              </button>
            </div>
          </div>

          {/* Preview */}
          {previewAmount && (
            <div className="bg-bg-2 rounded-xl p-4">
              <p className="text-xs text-ink-3 font-medium mb-2">
                {form.payment_mode === 'quarterly' ? 'Cobro trimestral' : 'Cobro anual unico'}
              </p>
              <div className="flex items-baseline gap-2">
                <span className="font-sans font-bold text-2xl text-brand">
                  {formatCurrency(previewAmount.total)}
                </span>
                <span className="text-xs text-ink-3">
                  (base {formatCurrency(previewAmount.base)} + IVA {formatCurrency(previewAmount.vat)})
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" loading={loading} disabled={!form.client_id} className="flex-1">
              Crear Suscripcion
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
