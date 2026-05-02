'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { createClient } from '@/lib/supabase/client'
import type { ClientType, ClientOrigin } from '@/types/database'

type ExtractingField = 'nif' | 'cif' | 'iban' | null

export default function EditClientPage() {
  const { id } = useParams()
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    alias: '',
    type: 'empresa' as ClientType,
    cif: '',
    cif_file_url: '',
    nif: '',
    nif_file_url: '',
    iban: '',
    iban_file_url: '',
    email: '',
    phone: '',
    fiscal_address: '',
    origin: 'auditoria' as ClientOrigin,
    commercial_id: '',
    marketing_consent: false,
    notes: '',
  })
  const [commercials, setCommercials] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [extracting, setExtracting] = useState<ExtractingField>(null)
  const [extractMsg, setExtractMsg] = useState<string>('')

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const [clientRes, comRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', id).single(),
        supabase.from('users_profile').select('id, full_name').eq('active', true).order('full_name'),
      ])

      if (clientRes.data) {
        const c = clientRes.data
        setForm({
          name: c.name || '',
          alias: c.alias || '',
          type: c.type,
          cif: c.cif || '',
          cif_file_url: c.cif_file_url || '',
          nif: c.nif || '',
          nif_file_url: c.nif_file_url || '',
          iban: c.iban || '',
          iban_file_url: c.iban_file_url || '',
          email: c.email || '',
          phone: c.phone || '',
          fiscal_address: c.fiscal_address || '',
          origin: c.origin,
          commercial_id: c.commercial_id,
          marketing_consent: c.marketing_consent,
          notes: c.notes || '',
        })
      }

      if (comRes.data) {
        setCommercials(comRes.data.map((u) => ({ value: u.id, label: u.full_name })))
      }

      setLoading(false)
    }
    fetchData()
  }, [id])

  // ── Auto-extracción de datos de documentos ─────────────────────────────────
  const extractFromFile = async (file: File, docType: ExtractingField) => {
    if (!docType) return
    setExtracting(docType)
    setExtractMsg('Analizando documento...')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1]) // strip data:...;base64, prefix
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await fetch('/api/analyze-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_base64: base64, file_type: file.type, file_name: file.name }),
      })
      const data = await res.json()

      if (data.error) throw new Error(data.error)

      setForm(prev => {
        const updated = { ...prev }
        if (docType === 'nif' && data.dni && !prev.nif) {
          updated.nif = data.dni
          setExtractMsg(`NIF extraído: ${data.dni}`)
        } else if (docType === 'cif' && data.cif && !prev.cif) {
          updated.cif = data.cif
          setExtractMsg(`CIF extraído: ${data.cif}`)
        } else if (docType === 'iban' && data.iban && !prev.iban) {
          updated.iban = data.iban
          setExtractMsg(`IBAN extraído: ${data.iban}`)
        } else {
          setExtractMsg('No se encontró dato reconocible')
        }
        // Also fill address if empty
        if (data.fiscal_address && !prev.fiscal_address) {
          updated.fiscal_address = data.fiscal_address
        }
        return updated
      })
    } catch (err: any) {
      console.error('Extraction error:', err)
      setExtractMsg('No se pudo extraer automáticamente')
    } finally {
      setExtracting(null)
      setTimeout(() => setExtractMsg(''), 4000)
    }
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setErrors({ name: 'El nombre es obligatorio' })
      return
    }

    setSaving(true)
    setErrors({})
    try {
      const supabase = createClient()
      const cifNif = form.cif.trim() || form.nif.trim() || null

      const basePayload = {
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
      }

      // Try with alias first; if column doesn't exist yet, retry without it
      let { error } = await supabase
        .from('clients')
        .update({ ...basePayload, alias: form.alias.trim() || null })
        .eq('id', id)

      if (error && (error.message?.includes('alias') || error.code === '42703')) {
        const retry = await supabase.from('clients').update(basePayload).eq('id', id)
        error = retry.error
      }

      if (error) throw error
      router.push(`/clients/${id}`)
    } catch (err: any) {
      console.error('Error updating client:', err)
      setErrors({ name: err.message || 'Error al actualizar. Intentalo de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-2 border-brand border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Editar Cliente"
        subtitle={form.name}
        actions={
          <Button variant="ghost" onClick={() => router.push(`/clients/${id}`)}>
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="px-6 lg:px-8 pb-8 space-y-6 max-w-4xl">
        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Informacion basica
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="name"
              label="Nombre / Razon social *"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              error={errors.name}
            />
            <div>
              <Input
                id="alias"
                label="Alias / Nombre comercial"
                placeholder="Ej: Maderas Orkoyen"
                value={form.alias}
                onChange={(e) => setForm((p) => ({ ...p, alias: e.target.value }))}
              />
              <p className="mt-1 text-[11px] text-ink-3/60">
                Nombre alternativo para buscar y mostrar en el CRM. El nombre oficial sigue siendo el de arriba.
              </p>
            </div>
            <Select
              id="type"
              label="Tipo de cliente"
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as ClientType }))}
              options={[
                { value: 'empresa', label: 'Empresa' },
                { value: 'particular', label: 'Particular' },
                { value: 'ayuntamiento', label: 'Ayuntamiento' },
              ]}
            />
            <Select
              id="origin"
              label="Origen"
              value={form.origin}
              onChange={(e) => setForm((p) => ({ ...p, origin: e.target.value as ClientOrigin }))}
              options={[
                { value: 'auditoria', label: 'Auditoria gratuita' },
                { value: 'referido', label: 'Referido' },
                { value: 'captacion', label: 'Captacion' },
                { value: 'otro', label: 'Otro' },
              ]}
            />
          </div>
        </Card>

        {/* Documents: CIF, NIF, IBAN */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">
              Documentacion
            </h3>
            {extracting && (
              <span className="flex items-center gap-1.5 text-xs text-brand font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {extractMsg}
              </span>
            )}
            {!extracting && extractMsg && (
              <span className="flex items-center gap-1.5 text-xs text-ok font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                {extractMsg}
              </span>
            )}
          </div>

          <div className="space-y-6">
            {/* CIF */}
            <div>
              <p className="text-sm font-semibold text-ink mb-3">CIF</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <Input
                    id="cif"
                    label="Número CIF"
                    placeholder="Ej: B12345678"
                    value={form.cif}
                    onChange={(e) => setForm((p) => ({ ...p, cif: e.target.value.toUpperCase() }))}
                  />
                  {extracting === 'cif' && (
                    <Loader2 className="absolute right-3 top-9 w-4 h-4 animate-spin text-brand" />
                  )}
                </div>
                <FileUpload
                  label="Adjuntar CIF"
                  bucket="documents"
                  folder="cif"
                  currentUrl={form.cif_file_url || null}
                  onUploaded={(url) => setForm((p) => ({ ...p, cif_file_url: url }))}
                  onRemoved={() => setForm((p) => ({ ...p, cif_file_url: '' }))}
                  onFileReady={(file) => extractFromFile(file, 'cif')}
                  hint="PDF, JPG o PNG · se extrae el CIF automáticamente"
                />
              </div>
            </div>

            <div className="border-t border-line-2-variant/20" />

            {/* NIF */}
            <div>
              <p className="text-sm font-semibold text-ink mb-3">NIF</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <Input
                    id="nif"
                    label="Número NIF"
                    placeholder="Ej: 12345678A"
                    value={form.nif}
                    onChange={(e) => setForm((p) => ({ ...p, nif: e.target.value.toUpperCase() }))}
                  />
                  {extracting === 'nif' && (
                    <Loader2 className="absolute right-3 top-9 w-4 h-4 animate-spin text-brand" />
                  )}
                </div>
                <FileUpload
                  label="Adjuntar NIF"
                  bucket="documents"
                  folder="nif"
                  currentUrl={form.nif_file_url || null}
                  onUploaded={(url) => setForm((p) => ({ ...p, nif_file_url: url }))}
                  onRemoved={() => setForm((p) => ({ ...p, nif_file_url: '' }))}
                  onFileReady={(file) => extractFromFile(file, 'nif')}
                  hint="PDF, JPG o PNG · se extrae el NIF automáticamente"
                />
              </div>
            </div>

            <div className="border-t border-line-2-variant/20" />

            {/* IBAN */}
            <div>
              <p className="text-sm font-semibold text-ink mb-3">Certificado de titularidad bancaria (IBAN)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <Input
                    id="iban"
                    label="Número IBAN"
                    placeholder="Ej: ES91 2100 0418 4502 0005 1332"
                    value={form.iban}
                    onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value.toUpperCase() }))}
                  />
                  {extracting === 'iban' && (
                    <Loader2 className="absolute right-3 top-9 w-4 h-4 animate-spin text-brand" />
                  )}
                </div>
                <FileUpload
                  label="Adjuntar certificado"
                  bucket="documents"
                  folder="bank-certificates"
                  currentUrl={form.iban_file_url || null}
                  onUploaded={(url) => setForm((p) => ({ ...p, iban_file_url: url }))}
                  onRemoved={() => setForm((p) => ({ ...p, iban_file_url: '' }))}
                  onFileReady={(file) => extractFromFile(file, 'iban')}
                  hint="PDF, JPG o PNG · se extrae el IBAN automáticamente"
                />
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Datos de contacto
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input id="email" label="Email" type="email" value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
            <Input id="phone" label="Teléfono" type="tel" value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            <div className="md:col-span-2">
              <Input id="fiscal_address" label="Direccion fiscal" value={form.fiscal_address}
                onChange={(e) => setForm((p) => ({ ...p, fiscal_address: e.target.value }))} />
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Asignacion
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select id="commercial_id" label="Comercial asignado *" value={form.commercial_id}
              onChange={(e) => setForm((p) => ({ ...p, commercial_id: e.target.value }))}
              options={commercials} />
            <div className="flex items-end">
              <label className="flex items-center gap-3 cursor-pointer py-2.5">
                <input type="checkbox" checked={form.marketing_consent}
                  onChange={(e) => setForm((p) => ({ ...p, marketing_consent: e.target.checked }))}
                  className="w-5 h-5 rounded border-line accent-secondary" />
                <span className="text-sm text-ink">Consentimiento marketing</span>
              </label>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4">
            Notas
          </h3>
          <textarea value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Notas adicionales..." rows={3}
            className="w-full px-4 py-2.5 bg-bg-2 rounded-xl text-sm text-ink placeholder:text-ink-3/50 outline-none transition-all duration-200 focus:focus-glow focus:bg-card resize-none" />
        </Card>

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="secondary" type="button" onClick={() => router.push(`/clients/${id}`)}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            <Save className="w-4 h-4" />
            Guardar cambios
          </Button>
        </div>
      </form>
    </div>
  )
}
