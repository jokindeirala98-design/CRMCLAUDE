'use client'

/**
 * ClientDetailModal
 * ─────────────────
 * Centered overlay modal that opens when the user clicks the CLIENTE card on
 * a supply detail page. Shows ALL the client's data ready to copy, lets the
 * user edit it, and accepts identity documents (DNI / CIF / certificado de
 * titularidad bancaria) that get auto-extracted via /api/analyze-identity.
 *
 * Missing required fields are rendered in red so the user can see at a glance
 * what is incomplete.
 *
 * Click outside (overlay) closes the modal.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  X, Copy, Pencil, Save, Loader2, Upload, FileText, Check, ExternalLink,
  Building2, User as UserIcon, Mail, Phone, CreditCard, MapPin, Zap, AlertCircle, Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { ExtractedIdentityData } from '@/lib/identityExtractor'
import { ChangeOwnerModal } from '@/components/modals/ChangeOwnerModal'

type SupplyRow = {
  id: string
  cups: string | null
  name: string | null
  type: string | null
  tariff: string | null
  address: string | null
  consumption_data: any
}

type ClientRow = {
  id: string
  name: string | null
  type: string | null
  cif: string | null
  nif: string | null
  cif_nif: string | null
  email: string | null
  phone: string | null
  iban: string | null
  fiscal_address: string | null
  cif_file_url: string | null
  nif_file_url: string | null
  iban_file_url: string | null
}

interface Props {
  clientId: string | null
  isOpen: boolean
  onClose: () => void
  /** Optional initial supply context (the supply page that opened this modal). */
  contextSupplyId?: string | null
  /** Callback triggered when client data is updated. */
  onUpdate?: () => void
}

const CLIENT_TYPE_OPTIONS = [
  { value: 'particular', label: 'Particular' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'ayuntamiento', label: 'Ayuntamiento' },
]

const FIELD_DEFS: { key: keyof ClientRow; label: string; icon: any; required?: boolean }[] = [
  { key: 'name', label: 'Nombre', icon: UserIcon, required: true },
  { key: 'type', label: 'Tipo de cliente', icon: UserIcon, required: true },
  { key: 'cif', label: 'CIF (empresa)', icon: Building2 },
  { key: 'nif', label: 'NIF / DNI', icon: UserIcon },
  { key: 'phone', label: 'Teléfono', icon: Phone, required: true },
  { key: 'email', label: 'Email', icon: Mail, required: true },
  { key: 'iban', label: 'IBAN', icon: CreditCard, required: true },
  { key: 'fiscal_address', label: 'Dirección fiscal', icon: MapPin, required: true },
]

export function ClientDetailModal({ clientId, isOpen, onClose, contextSupplyId, onUpdate }: Props) {
  const [client, setClient] = useState<ClientRow | null>(null)
  const [supplies, setSupplies] = useState<SupplyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<ClientRow>>({})
  const [saving, setSaving] = useState(false)
  const [copyToast, setCopyToast] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [changingOwnerSupplyId, setChangingOwnerSupplyId] = useState<string | null>(null)
  const [commercials, setCommercials] = useState<{ value: string; label: string }[]>([])
  const [cupsSearch, setCupsSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load client + supplies ────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    const supabase = createClient()
    const [{ data: c }, { data: s }, { data: u }] = await Promise.all([
      supabase
        .from('clients')
        .select('id, name, type, cif, nif, cif_nif, email, phone, iban, fiscal_address, cif_file_url, nif_file_url, iban_file_url, commercial_id, origin')
        .eq('id', clientId)
        .single(),
      supabase
        .from('supplies')
        .select('id, cups, name, type, tariff, address, consumption_data')
        .eq('client_id', clientId),
      supabase
        .from('users_profile')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name')
    ])
    setClient(c as any)
    setSupplies((s as any[]) || [])
    setDraft((c as any) || {})
    if (u) setCommercials(u.map((com: any) => ({ value: com.id, label: com.full_name })))
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    if (isOpen && clientId) {
      load()
      setEditing(false)
      setUploadMsg(null)
    }
  }, [isOpen, clientId, load])

  // ── Close on Escape ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // ── Save edited fields ────────────────────────────────────────────────
  const handleSave = async () => {
    if (!clientId) return
    setSaving(true)
    const payload: any = {}
    for (const f of FIELD_DEFS) {
      const v = draft[f.key]
      payload[f.key] = typeof v === 'string' ? v.trim() || null : v ?? null
    }
    // Keep legacy cif_nif synced
    payload.cif_nif = (payload.cif || payload.nif || null)?.toString().trim() || null

    const supabase = createClient()
    const { error } = await supabase.from('clients').update(payload).eq('id', clientId)
    setSaving(false)
    if (error) {
      setUploadMsg(`Error guardando: ${error.message}`)
      return
    }
    setClient(prev => (prev ? { ...prev, ...payload } : prev))
    setEditing(false)
    if (onUpdate) onUpdate()
  }

  // ── Copy field to clipboard ───────────────────────────────────────────
  const handleCopy = async (label: string, value: string | null | undefined) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopyToast(`${label} copiado`)
      setTimeout(() => setCopyToast(null), 1400)
    } catch {
      // ignore
    }
  }

  // ── Upload identity document ──────────────────────────────────────────
  const handleUploadIdentity = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length || !clientId) return
    setAnalyzing(true)
    setUploadMsg(null)

    const supabase = createClient()
    let merged: Partial<ClientRow> = {}

    for (const file of files) {
      try {
        // 1. upload to Supabase storage
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
        const filePath = `identity/${clientId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await supabase.storage.from('documents').upload(filePath, file)
        if (upErr) throw upErr
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath)
        const fileUrl = urlData.publicUrl

        // 2. base64 encode for the API
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            resolve(result.split(',')[1] || '')
          }
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        // 3. call extractor
        const res = await fetch('/api/analyze-identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_base64: base64, file_type: file.type, file_name: file.name }),
        })
        const data = (await res.json()) as ExtractedIdentityData
        if (data.error) throw new Error(data.error)

        // 4. map extracted fields to client columns. Only fill EMPTY fields.
        const fillIfEmpty = (key: keyof ClientRow, value: string | undefined) => {
          if (!value) return
          if (merged[key]) return
          if ((client as any)?.[key]) return
          ;(merged as any)[key] = value
        }

        if (data.documentType === 'dni') {
          fillIfEmpty('nif', data.dni)
          fillIfEmpty('name', data.full_name)
          fillIfEmpty('fiscal_address', data.fiscal_address)
          merged.nif_file_url = fileUrl
        } else if (data.documentType === 'cif') {
          fillIfEmpty('cif', data.cif)
          fillIfEmpty('name', data.company_name)
          fillIfEmpty('fiscal_address', data.fiscal_address)
          merged.cif_file_url = fileUrl
        } else if (data.documentType === 'cert_bancario') {
          fillIfEmpty('iban', data.iban)
          fillIfEmpty('name', data.account_holder)
          // Try to figure out if account_holder_id is a CIF or NIF (CIF starts with letter)
          if (data.account_holder_id) {
            const id = data.account_holder_id.toUpperCase()
            if (/^[A-HJNP-SUVW]/.test(id)) fillIfEmpty('cif', id)
            else fillIfEmpty('nif', id)
          }
          fillIfEmpty('fiscal_address', data.fiscal_address)
          merged.iban_file_url = fileUrl
        } else {
          setUploadMsg(`No se reconoció ${file.name} como DNI, CIF o certificado bancario.`)
          continue
        }
      } catch (err: any) {
        setUploadMsg(`Error con ${file.name}: ${err?.message || 'desconocido'}`)
      }
    }

    setAnalyzing(false)
    if (e.target) e.target.value = ''

    if (Object.keys(merged).length > 0) {
      // persist immediately
      const updatePayload: any = { ...merged }
      if (merged.cif || merged.nif) {
        updatePayload.cif_nif = ((merged.cif || merged.nif) as string).trim()
      }
      const { error } = await supabase.from('clients').update(updatePayload).eq('id', clientId)
      if (error) {
        setUploadMsg(`Error guardando datos extraídos: ${error.message}`)
      } else {
        setClient(prev => (prev ? { ...prev, ...updatePayload } : prev))
        setDraft(prev => ({ ...prev, ...updatePayload }))
        setUploadMsg(`Datos extraídos y guardados correctamente (${Object.keys(merged).length} campos).`)
        if (onUpdate) onUpdate()
      }
    }
  }

  // ── Aggregate consumption across all supplies ─────────────────────────
  const totalKwhYear = supplies.reduce((sum, s) => {
    const t = (s.consumption_data as any)?.totalKwh
    return sum + (typeof t === 'number' ? t : 0)
  }, 0)

  // ── Render ────────────────────────────────────────────────────────────
  if (!isOpen) return null

  const isEmpresa = !!(client?.cif || client?.type === 'empresa' || client?.type === 'ayuntamiento')
  const ctxSupply = supplies.find(s => s.id === contextSupplyId) || supplies[0]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl bg-bg shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4 bg-surface/95 backdrop-blur-lg border-b border-line-2-variant/20">
          <div className="min-w-0 flex-1">
            <h2 className="font-sans font-bold text-xl text-ink truncate">
              {client?.name || (loading ? 'Cargando…' : 'Cliente')}
            </h2>
            <p className="text-xs text-ink-3 capitalize truncate">
              {isEmpresa ? 'Empresa' : 'Particular'}
              {supplies.length > 0 && ` · ${supplies.length} suministro${supplies.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <button
                onClick={() => { setDraft(client || {}); setEditing(true) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-brand hover:bg-primary/20 text-xs font-medium transition"
              >
                <Pencil className="w-3.5 h-3.5" /> Editar
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setEditing(false); setDraft(client || {}) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-ink-3 hover:bg-bg-2 text-xs font-medium transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ok text-white hover:bg-success/90 text-xs font-medium transition disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Guardar
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-bg-2 text-ink-3 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-brand" />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Field grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FIELD_DEFS.map(({ key, label, icon: Icon, required }) => {
                const value = (editing ? draft[key] : client?.[key]) as string | null | undefined
                const missing = !value && required
                return (
                  <div
                    key={key}
                    className={`rounded-2xl border p-3 transition ${
                      missing
                        ? 'border-error/40 bg-error/5'
                        : 'border-line-2-variant/20 bg-bg-2'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon className={`w-3.5 h-3.5 ${missing ? 'text-err' : 'text-ink-3'}`} />
                      <p className={`text-[10px] uppercase tracking-wider font-semibold ${
                        missing ? 'text-err' : 'text-ink-3'
                      }`}>
                        {label}{required && ' *'}
                      </p>
                      {!editing && value && (
                        <button
                          onClick={() => handleCopy(label, value)}
                          className="ml-auto p-1 rounded hover:bg-bg-2 text-ink-3 hover:text-brand transition"
                          title="Copiar"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editing ? (
                      key === 'type' ? (
                        <select
                          value={(draft[key] as string) || 'empresa'}
                          onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm bg-bg rounded-lg outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          {CLIENT_TYPE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={(draft[key] as string) || ''}
                          onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm bg-bg rounded-lg outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      )
                    ) : (
                      <p className={`text-sm font-medium break-all ${
                        missing ? 'text-err font-semibold' : 'text-ink'
                      }`}>
                        {key === 'type'
                          ? (CLIENT_TYPE_OPTIONS.find(o => o.value === value)?.label || value || (required ? 'Falta' : '—'))
                          : (value || (required ? 'Falta' : '—'))
                        }
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Supply context fields (read-only, contextual) */}
            {ctxSupply && (
              <div className="rounded-2xl border border-line-2-variant/20 bg-bg-2 p-4">
                <h3 className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-3">
                  Datos del suministro {supplies.length > 1 ? 'actual' : ''}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <FieldStatic label="Tarifa" value={ctxSupply.tariff} onCopy={handleCopy} />
                  <FieldStatic label="Producto" value={ctxSupply.type ? ctxSupply.type.toUpperCase() : null} onCopy={handleCopy} />
                  <FieldStatic label="Dirección suministro" value={ctxSupply.address} onCopy={handleCopy} className="sm:col-span-2" />
                  <FieldStatic
                    label="Consumo anual"
                    value={totalKwhYear > 0 ? `${totalKwhYear.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kWh` : null}
                    onCopy={handleCopy}
                  />
                </div>
              </div>
            )}

            {/* All CUPS under client */}
            <div className="rounded-2xl border border-line-2-variant/20 bg-bg-2 p-4">
              <h3 className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" />
                CUPS del cliente ({supplies.length})
              </h3>
              {supplies.length === 0 ? (
                <p className="text-xs text-ink-3">Sin CUPS registrados.</p>
              ) : (
                <>
                  {/* Search bar — only shown when there are enough supplies to warrant it */}
                  {supplies.length >= 5 && (
                    <div className="relative mb-3">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3 pointer-events-none" />
                      <input
                        type="text"
                        value={cupsSearch}
                        onChange={e => setCupsSearch(e.target.value)}
                        placeholder="Buscar por nombre, CUPS o tarifa…"
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-bg border border-line-2-variant/20 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-brand/40"
                      />
                      {cupsSearch && (
                        <button
                          onClick={() => setCupsSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {(() => {
                    const q = cupsSearch.toLowerCase().trim()
                    const filtered = q
                      ? supplies.filter(s =>
                          (s.name || '').toLowerCase().includes(q) ||
                          (s.cups || '').toLowerCase().includes(q) ||
                          (s.tariff || '').toLowerCase().includes(q) ||
                          (s.type || '').toLowerCase().includes(q)
                        )
                      : supplies
                    return (
                      <>
                        {q && (
                          <p className="text-[10px] text-ink-3 mb-2">
                            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''} de {supplies.length}
                          </p>
                        )}
                        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                          {filtered.length === 0 ? (
                            <p className="text-xs text-ink-3 py-2 text-center">Sin resultados para «{cupsSearch}»</p>
                          ) : filtered.map(s => (
                            <div
                              key={s.id}
                              className="flex items-center gap-2 px-3 py-2 bg-bg rounded-xl text-xs"
                            >
                              <span className="font-medium text-ink flex-shrink-0 max-w-[120px] truncate" title={s.name || ''}>
                                {s.name || ''}
                              </span>
                              <span className="font-mono text-ink-3 truncate flex-1">
                                {s.cups || '—'}
                              </span>
                              {s.tariff && (
                                <span className="px-1.5 py-0.5 rounded-full bg-bg-2 text-ink-3 text-[10px] font-mono flex-shrink-0">
                                  {s.tariff}
                                </span>
                              )}
                              {s.type && (
                                <span className="px-2 py-0.5 rounded-full bg-primary/10 text-brand text-[10px] uppercase flex-shrink-0">
                                  {s.type}
                                </span>
                              )}
                              <button
                                onClick={() => handleCopy('CUPS', s.cups)}
                                disabled={!s.cups}
                                className="p-1 rounded hover:bg-bg-2 text-ink-3 hover:text-brand transition disabled:opacity-30 flex-shrink-0"
                                title="Copiar CUPS"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setChangingOwnerSupplyId(s.id)}
                                className="p-1 rounded hover:bg-primary/10 text-ink-3 hover:text-brand transition flex-shrink-0"
                                title="Cambiar titular / ficha"
                              >
                                <UserIcon className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )
                  })()}
                </>
              )}
            </div>

            {/* Document upload box */}
            <div className="rounded-2xl border-2 border-dashed border-line-2-variant/40 p-5">
              <h3 className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                Documentos identidad (auto-extracción)
              </h3>
              <p className="text-xs text-ink-3 mb-3">
                Adjunta DNI (frente y dorso), tarjeta de CIF o certificado de titularidad bancaria.
                Los datos se extraen y rellenan automáticamente.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleUploadIdentity}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={analyzing}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-brand hover:bg-primary/20 text-xs font-medium transition disabled:opacity-50"
              >
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {analyzing ? 'Analizando…' : 'Adjuntar documento'}
              </button>

              {/* Uploaded docs status */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                <DocStatus label="DNI" url={client?.nif_file_url} />
                <DocStatus label="CIF" url={client?.cif_file_url} />
                <DocStatus label="Cert. bancario" url={client?.iban_file_url} />
              </div>

              {uploadMsg && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-bg-2 text-xs text-ink">
                  <AlertCircle className="w-3.5 h-3.5 text-brand flex-shrink-0 mt-0.5" />
                  <span>{uploadMsg}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Copy toast */}
        {copyToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-4 py-2 rounded-xl bg-ink text-surface text-xs font-medium shadow-lg">
            <Check className="w-3.5 h-3.5 inline mr-1.5" />
            {copyToast}
          </div>
        )}

        <ChangeOwnerModal
          isOpen={!!changingOwnerSupplyId}
          onClose={() => setChangingOwnerSupplyId(null)}
          onSuccess={() => {
            load()
            if (onUpdate) onUpdate()
          }}
          supplyId={changingOwnerSupplyId as string}
          currentClient={client}
          commercials={commercials}
        />
      </div>
    </div>
  )
}

function FieldStatic({
  label, value, onCopy, className = '',
}: {
  label: string
  value: string | null | undefined
  onCopy: (l: string, v: string | null | undefined) => void
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-0.5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-3">
          {label}
        </p>
        {value && (
          <button
            onClick={() => onCopy(label, value)}
            className="p-0.5 rounded hover:bg-bg-2 text-ink-3 hover:text-brand transition"
          >
            <Copy className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
      <p className={`text-sm font-medium ${value ? 'text-ink' : 'text-ink-3/60'}`}>
        {value || '—'}
      </p>
    </div>
  )
}

function DocStatus({ label, url }: { label: string; url: string | null | undefined }) {
  const inner = (
    <div
      className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg transition ${
        url
          ? 'bg-success/10 text-ok hover:bg-success/20 cursor-pointer'
          : 'bg-bg-2 text-ink-3'
      }`}
    >
      {url ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-50" />}
      <span className="font-medium">{label}</span>
      {url && <ExternalLink className="w-2.5 h-2.5 opacity-60" />}
    </div>
  )

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={`Ver ${label}`}>
        {inner}
      </a>
    )
  }
  return inner
}
