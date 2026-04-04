'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, calculateVAT, generateInvoiceNumber } from '@/lib/utils/format'
import type { Client } from '@/types/database'

interface Props {
  onClose: () => void
  onCreated: () => void
}

export function NewInvoiceModal({ onClose, onCreated }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    client_id: '',
    concept: '',
    base_amount: '',
    vat_rate: '21',
    period_start: '',
    period_end: '',
    due_date: '',
  })

  useEffect(() => {
    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('clients').select('id, name, cif_nif').order('name')
      setClients((data as Client[]) || [])
    }
    fetchClients()

    // Default due date: 30 days from now
    const due = new Date()
    due.setDate(due.getDate() + 30)
    setForm((f) => ({ ...f, due_date: due.toISOString().split('T')[0] }))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_id || !form.base_amount) return

    setLoading(true)
    const supabase = createClient()
    const baseAmount = parseFloat(form.base_amount)
    const vatRate = parseFloat(form.vat_rate)
    const { vat, total } = calculateVAT(baseAmount, vatRate)

    // Generate sequential invoice number: VOLT-YYYY-NNNNN
    const year = new Date().getFullYear()
    const prefix = `VOLT-${year}-`
    const { data: lastInvoice } = await supabase
      .from('billing')
      .select('invoice_number')
      .like('invoice_number', `${prefix}%`)
      .order('invoice_number', { ascending: false })
      .limit(1)

    let nextSeq = 1
    if (lastInvoice && lastInvoice.length > 0) {
      const lastSeq = parseInt((lastInvoice[0].invoice_number as string).replace(prefix, ''), 10)
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1
    }
    const invoiceNumber = `${prefix}${String(nextSeq).padStart(5, '0')}`

    const { error } = await supabase.from('billing').insert({
      client_id: form.client_id,
      invoice_number: invoiceNumber,
      concept: form.concept || 'Servicios de consultoria energetica',
      base_amount: baseAmount,
      vat_rate: vatRate,
      vat_amount: vat,
      total_amount: total,
      status: 'draft',
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      due_date: form.due_date,
    })

    setLoading(false)
    if (!error) {
      onCreated()
      onClose()
    }
  }

  const preview = form.base_amount
    ? calculateVAT(parseFloat(form.base_amount), parseFloat(form.vat_rate))
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
        className="relative bg-surface-container-lowest rounded-2xl shadow-ambient-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-low">
          <h2 className="font-display font-semibold text-lg text-on-surface">
            Nueva Factura
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high transition-all">
            <X className="w-5 h-5 text-on-surface-variant" />
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

          <Input
            id="concept"
            label="Concepto"
            placeholder="Servicios de consultoria energetica"
            value={form.concept}
            onChange={(e) => setForm({ ...form, concept: e.target.value })}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="base_amount"
              label="Importe base (sin IVA)"
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={form.base_amount}
              onChange={(e) => setForm({ ...form, base_amount: e.target.value })}
              required
            />
            <Select
              id="vat_rate"
              label="IVA %"
              value={form.vat_rate}
              onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}
              options={[
                { value: '21', label: '21%' },
                { value: '10', label: '10%' },
                { value: '4', label: '4%' },
                { value: '0', label: '0% (Exento)' },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="period_start"
              label="Periodo desde"
              type="date"
              value={form.period_start}
              onChange={(e) => setForm({ ...form, period_start: e.target.value })}
            />
            <Input
              id="period_end"
              label="Periodo hasta"
              type="date"
              value={form.period_end}
              onChange={(e) => setForm({ ...form, period_end: e.target.value })}
            />
          </div>

          <Input
            id="due_date"
            label="Fecha de vencimiento"
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            required
          />

          {/* Preview */}
          {preview && (
            <div className="bg-surface-container-low rounded-xl p-4 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">Base imponible</span>
                <span className="text-on-surface">{formatCurrency(preview.base)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">IVA ({form.vat_rate}%)</span>
                <span className="text-on-surface">{formatCurrency(preview.vat)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold pt-2 border-t border-surface-container-high">
                <span className="text-on-surface">Total</span>
                <span className="font-display text-lg text-secondary">{formatCurrency(preview.total)}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" loading={loading} disabled={!form.client_id || !form.base_amount} className="flex-1">
              Crear Factura
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
