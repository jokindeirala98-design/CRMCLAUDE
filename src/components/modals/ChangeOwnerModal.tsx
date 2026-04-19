'use client'

import { useState, useEffect } from 'react'
import { X, Save, User, Building2, Mail, Phone, CreditCard, MapPin, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import type { ClientType, ClientOrigin } from '@/types/database'

interface ChangeOwnerModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (newClientId: string) => void
  supplyId: string
  currentClient: any
  commercials: { value: string; label: string }[]
}

export function ChangeOwnerModal({
  isOpen,
  onClose,
  onSuccess,
  supplyId,
  currentClient,
  commercials
}: ChangeOwnerModalProps) {
  const [form, setForm] = useState({
    name: '',
    type: 'empresa' as ClientType,
    cif: '',
    nif: '',
    email: '',
    phone: '',
    fiscal_address: '',
    iban: '',
    origin: 'captacion' as ClientOrigin,
    commercial_id: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && currentClient) {
      setForm({
        name: `${currentClient.name || ''} (Copia)`,
        type: currentClient.type || 'empresa',
        cif: currentClient.cif || '',
        nif: currentClient.nif || '',
        email: currentClient.email || '',
        phone: currentClient.phone || '',
        fiscal_address: currentClient.fiscal_address || '',
        iban: currentClient.iban || '',
        origin: currentClient.origin || 'captacion',
        commercial_id: currentClient.commercial_id || '',
      })
    }
  }, [isOpen, currentClient])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('El nombre es obligatorio')
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()

    try {
      // 1. Create new client
      const { data: newClient, error: clientErr } = await supabase
        .from('clients')
        .insert({
          name: form.name.trim(),
          type: form.type,
          cif: form.cif.trim() || null,
          nif: form.nif.trim() || null,
          cif_nif: (form.cif.trim() || form.nif.trim() || null),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          fiscal_address: form.fiscal_address.trim() || null,
          iban: form.iban.trim() || null,
          origin: form.origin,
          commercial_id: form.commercial_id,
        })
        .select()
        .single()

      if (clientErr) throw clientErr

      // 2. Update supply to point to new client
      const { error: supplyErr } = await supabase
        .from('supplies')
        .update({ client_id: newClient.id })
        .eq('id', supplyId)

      if (supplyErr) throw supplyErr

      onSuccess(newClient.id)
      onClose()
    } catch (err: any) {
      console.error('Error changing owner:', err)
      setError(err.message || 'Error al guardar el nuevo titular')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-2xl bg-bg rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-line-2-variant/10">
          <div>
            <h2 className="text-xl font-sans font-bold text-ink">Nuevo Titular / Ficha específica</h2>
            <p className="text-sm text-ink-3">Configura los datos propios para este suministro</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-bg-2 transition">
            <X className="w-6 h-6 text-ink-3" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Input
                label="Nombre / Razón Social *"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Servicios Integrales SL"
              />
            </div>

            <Select
              label="Tipo de cliente"
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as ClientType }))}
              options={[
                { value: 'empresa', label: 'Empresa' },
                { value: 'particular', label: 'Particular' },
                { value: 'ayuntamiento', label: 'Ayuntamiento' }
              ]}
            />

            <Select
              label="Origen"
              value={form.origin}
              onChange={e => setForm(f => ({ ...f, origin: e.target.value as ClientOrigin }))}
              options={[
                { value: 'auditoria', label: 'Auditoria' },
                { value: 'captacion', label: 'Captación' },
                { value: 'referido', label: 'Referido' },
                { value: 'otro', label: 'Otro' }
              ]}
            />

            <Input
              label="CIF"
              value={form.cif}
              onChange={e => setForm(f => ({ ...f, cif: e.target.value.toUpperCase() }))}
              placeholder="B12345678"
            />

            <Input
              label="NIF / DNI"
              value={form.nif}
              onChange={e => setForm(f => ({ ...f, nif: e.target.value.toUpperCase() }))}
              placeholder="12345678A"
            />

            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="contacto@ejemplo.com"
            />

            <Input
              label="Teléfono"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="600 000 000"
            />

            <div className="md:col-span-2">
              <Input
                label="Dirección Fiscal"
                value={form.fiscal_address}
                onChange={e => setForm(f => ({ ...f, fiscal_address: e.target.value }))}
                placeholder="Calle, número, CP, Ciudad"
              />
            </div>

            <Input
              label="IBAN"
              value={form.iban}
              onChange={e => setForm(f => ({ ...f, iban: e.target.value.toUpperCase() }))}
              placeholder="ES91..."
            />

            <Select
              label="Comercial Asignado"
              value={form.commercial_id}
              onChange={e => setForm(f => ({ ...f, commercial_id: e.target.value }))}
              options={commercials}
            />
          </div>

          {error && (
            <div className="p-3 bg-error/10 border border-error/20 rounded-xl text-err text-sm">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="p-6 border-t border-line-2-variant/10 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} className="bg-brand text-white">
            <Save className="w-4 h-4 mr-2" />
            Crear y vincular suministro
          </Button>
        </div>
      </div>
    </div>
  )
}
