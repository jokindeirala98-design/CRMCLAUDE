'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import type { ClientType, ClientOrigin } from '@/types/database'

interface ClientForm {
  name: string
  type: ClientType
  cif: string
  cif_file_url: string
  nif: string
  nif_file_url: string
  iban: string
  iban_file_url: string
  email: string
  phone: string
  fiscal_address: string
  origin: ClientOrigin
  commercial_id: string
  marketing_consent: boolean
  notes: string
}

const initialForm: ClientForm = {
  name: '',
  type: 'empresa',
  cif: '',
  cif_file_url: '',
  nif: '',
  nif_file_url: '',
  iban: '',
  iban_file_url: '',
  email: '',
  phone: '',
  fiscal_address: '',
  origin: 'auditoria',
  commercial_id: '',
  marketing_consent: false,
  notes: '',
}

export default function NewClientPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [form, setForm] = useState<ClientForm>(initialForm)
  const [commercials, setCommercials] = useState<{ value: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof ClientForm, string>>>({})

  useEffect(() => {
    if (user) {
      setForm((prev) => ({ ...prev, commercial_id: user.id }))
    }

    const fetchCommercials = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('users_profile')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name')

      if (data) {
        setCommercials(data.map((u) => ({ value: u.id, label: u.full_name })))
      }
    }
    fetchCommercials()
  }, [user])

  const updateField = <K extends keyof ClientForm>(key: K, value: ClientForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof ClientForm, string>> = {}
    if (!form.name.trim()) newErrors.name = 'El nombre es obligatorio'
    if (!form.commercial_id) newErrors.commercial_id = 'Selecciona un comercial'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Email no valido'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setSaving(true)
    try {
      const supabase = createClient()
      // Build cif_nif for backwards compatibility
      const cifNif = form.cif.trim() || form.nif.trim() || null

      const { data, error } = await supabase
        .from('clients')
        .insert({
          name: form.name.trim(),
          type: form.type,
          cif_nif: cifNif,
          cif: form.cif.trim() || null,
          cif_file_url: form.cif_file_url || null,
          nif: form.nif.trim() || null,
          nif_file_url: form.nif_file_url || null,
          iban: form.iban.trim() || null,
          iban_file_url: form.iban_file_url || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          fiscal_address: form.fiscal_address.trim() || null,
          origin: form.origin,
          commercial_id: form.commercial_id,
          marketing_consent: form.marketing_consent,
          notes: form.notes.trim() || null,
        })
        .select('id')
        .single()

      if (error) throw error
      router.push(`/clients/${data.id}`)
    } catch (err) {
      console.error('Error creating client:', err)
      setErrors({ name: 'Error al crear el cliente. Intentalo de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="Nuevo Cliente"
        subtitle="Registro de nuevo cliente en el sistema"
        actions={
          <Button variant="ghost" onClick={() => router.push('/clients')}>
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="px-6 lg:px-8 pb-8 space-y-6 max-w-4xl">
        {/* Basic info */}
        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Informacion basica
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="name"
              label="Nombre / Razon social *"
              placeholder="Ej: Restaurante La Plaza S.L."
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              error={errors.name}
            />
            <Select
              id="type"
              label="Tipo de cliente"
              value={form.type}
              onChange={(e) => updateField('type', e.target.value as ClientType)}
              options={[
                { value: 'empresa', label: 'Empresa' },
                { value: 'particular', label: 'Particular' },
                { value: 'ayuntamiento', label: 'Ayuntamiento' },
              ]}
            />
            <Select
              id="origin"
              label="Origen del cliente"
              value={form.origin}
              onChange={(e) => updateField('origin', e.target.value as ClientOrigin)}
              options={[
                { value: 'auditoria', label: 'Auditoria gratuita' },
                { value: 'referido', label: 'Referido' },
                { value: 'captacion', label: 'Captacion' },
                { value: 'otro', label: 'Otro' },
              ]}
            />
          </div>
        </Card>

        {/* Documents: CIF, NIF, IBAN - each with text + file */}
        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Documentacion
          </h3>
          <div className="space-y-6">
            {/* CIF */}
            <div>
              <p className="text-sm font-semibold text-ink mb-3">CIF</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="cif"
                  label="Número CIF"
                  placeholder="Ej: B12345678"
                  value={form.cif}
                  onChange={(e) => updateField('cif', e.target.value.toUpperCase())}
                />
                <FileUpload
                  label="Adjuntar CIF"
                  bucket="documents"
                  folder="cif"
                  currentUrl={form.cif_file_url || null}
                  onUploaded={(url) => updateField('cif_file_url', url)}
                  onRemoved={() => updateField('cif_file_url', '')}
                  hint="PDF, JPG o PNG (max 10MB)"
                />
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-line-2-variant/20" />

            {/* NIF */}
            <div>
              <p className="text-sm font-semibold text-ink mb-3">NIF</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="nif"
                  label="Número NIF"
                  placeholder="Ej: 12345678A"
                  value={form.nif}
                  onChange={(e) => updateField('nif', e.target.value.toUpperCase())}
                />
                <FileUpload
                  label="Adjuntar NIF"
                  bucket="documents"
                  folder="nif"
                  currentUrl={form.nif_file_url || null}
                  onUploaded={(url) => updateField('nif_file_url', url)}
                  onRemoved={() => updateField('nif_file_url', '')}
                  hint="PDF, JPG o PNG (max 10MB)"
                />
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-line-2-variant/20" />

            {/* IBAN / Bank Certificate */}
            <div>
              <p className="text-sm font-semibold text-ink mb-3">Certificado de titularidad bancaria (IBAN)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="iban"
                  label="Número IBAN"
                  placeholder="Ej: ES91 2100 0418 4502 0005 1332"
                  value={form.iban}
                  onChange={(e) => updateField('iban', e.target.value.toUpperCase())}
                />
                <FileUpload
                  label="Adjuntar certificado"
                  bucket="documents"
                  folder="bank-certificates"
                  currentUrl={form.iban_file_url || null}
                  onUploaded={(url) => updateField('iban_file_url', url)}
                  onRemoved={() => updateField('iban_file_url', '')}
                  hint="PDF, JPG o PNG (max 10MB)"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Contact info */}
        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Datos de contacto
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="email"
              label="Email"
              type="email"
              placeholder="cliente@empresa.com"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              error={errors.email}
            />
            <Input
              id="phone"
              label="Teléfono"
              type="tel"
              placeholder="+34 600 000 000"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
            />
            <div className="md:col-span-2">
              <Input
                id="fiscal_address"
                label="Direccion fiscal"
                placeholder="Calle, numero, CP, ciudad"
                value={form.fiscal_address}
                onChange={(e) => updateField('fiscal_address', e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Assignment */}
        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Asignacion
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              id="commercial_id"
              label="Comercial asignado *"
              value={form.commercial_id}
              onChange={(e) => updateField('commercial_id', e.target.value)}
              options={commercials}
              error={errors.commercial_id}
            />
            <div className="flex items-end">
              <label className="flex items-center gap-3 cursor-pointer py-2.5">
                <input
                  type="checkbox"
                  checked={form.marketing_consent}
                  onChange={(e) => updateField('marketing_consent', e.target.checked)}
                  className="w-5 h-5 rounded border-line accent-secondary"
                />
                <span className="text-sm text-ink">Consentimiento marketing</span>
              </label>
            </div>
          </div>
        </Card>

        {/* Notes */}
        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Notas
          </h3>
          <textarea
            value={form.notes}
            onChange={(e) => updateField('notes', e.target.value)}
            placeholder="Notas adicionales sobre el cliente..."
            rows={3}
            className="w-full px-4 py-2.5 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 outline-none transition-all duration-200 focus:focus-glow focus:bg-card resize-none"
          />
        </Card>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="secondary" type="button" onClick={() => router.push('/clients')}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            <Save className="w-4 h-4" />
            Crear Cliente
          </Button>
        </div>
      </form>
    </div>
  )
}
