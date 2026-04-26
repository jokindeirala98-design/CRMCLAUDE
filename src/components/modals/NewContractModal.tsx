'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Upload, FileText, AlertTriangle, ExternalLink } from 'lucide-react'
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

const TRAMITES = [
  { value: 'new', label: 'Nueva contratación' },
  { value: 'change', label: 'Cambio de comercializadora' },
  { value: 'renewal', label: 'Renovación' },
  { value: 'name_change', label: 'Cambio de nombre' },
]

export function NewContractModal({ open, onClose, onCreated, preselectedClientId, preselectedSupplyId }: Props) {
  const { user } = useAuthStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [clients, setClients] = useState<any[]>([])
  const [supplies, setSupplies] = useState<any[]>([])
  const [comercializadoras, setComercializadoras] = useState<any[]>([])
  const [selectedClient, setSelectedClient] = useState<any>(null)
  const [selectedSupply, setSelectedSupply] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle')
  const [attachedFile, setAttachedFile] = useState<File | null>(null)

  const [form, setForm] = useState({
    client_id: preselectedClientId || '',
    supply_id: preselectedSupplyId || '',
    comercializadora_id: '',
    tramite: 'new',
    servicio: 'electricity',
    producto: '',
    firmante: '',
    dni_firmante: '',
    consumo_anual: '',
    observaciones: '',
    fecha_activacion: '',
    voltis_contract_type: '' as '' | 'colaboracion' | 'propuesta',
  })

  const isCompanyOrAyto = selectedClient?.type === 'empresa' || selectedClient?.type === 'ayuntamiento'

  useEffect(() => {
    if (!open) return
    const fetchData = async () => {
      const supabase = createClient()
      const [clientsRes, comercRes] = await Promise.all([
        supabase.from('clients').select('id, name, type, cif_nif, email, phone, iban, fiscal_address, nif_file_url, cif_file_url, iban_file_url').order('name'),
        supabase.from('comercializadoras').select('id, name').eq('active', true).order('name'),
      ])
      setClients(clientsRes.data || [])
      setComercializadoras(comercRes.data || [])

      if (preselectedClientId) {
        const client = clientsRes.data?.find((c: any) => c.id === preselectedClientId)
        setSelectedClient(client || null)
        const { data } = await supabase
          .from('supplies')
          .select('id, cups, tariff, type, address, consumption_data')
          .eq('client_id', preselectedClientId)
          .order('created_at', { ascending: false })
        setSupplies(data || [])
      }
    }
    fetchData()
  }, [open, preselectedClientId])

  // Load supplies when client changes
  useEffect(() => {
    if (!form.client_id) { setSupplies([]); setSelectedClient(null); return }
    const fetchSupplies = async () => {
      const supabase = createClient()
      const [suppliesRes] = await Promise.all([
        supabase.from('supplies').select('id, cups, tariff, type, address, consumption_data').eq('client_id', form.client_id).order('created_at', { ascending: false }),
      ])
      setSupplies(suppliesRes.data || [])
      // Update selectedClient
      const client = clients.find(c => c.id === form.client_id)
      setSelectedClient(client || null)
    }
    fetchSupplies()
  }, [form.client_id, clients])

  // Auto-fill supply data
  useEffect(() => {
    if (!form.supply_id) { setSelectedSupply(null); return }
    const supply = supplies.find(s => s.id === form.supply_id)
    setSelectedSupply(supply || null)
    if (supply) {
      setForm(f => ({
        ...f,
        servicio: supply.type || 'electricity',
        producto: f.producto || supply.tariff || '',
        consumo_anual: f.consumo_anual || (() => {
          const cd = supply.consumption_data as any
          const cp = cd?.consumoPeriodos || {}
          const pSum = (Number(cp.P1)||0)+(Number(cp.P2)||0)+(Number(cp.P3)||0)+(Number(cp.P4)||0)+(Number(cp.P5)||0)+(Number(cp.P6)||0)
          const kwh = pSum > 0 ? pSum : (Number(cd?.totalKwh) || 0)
          return kwh > 0 ? String(Math.round(kwh)) : ''
        })(),
      }))
    }
  }, [form.supply_id, supplies])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setAttachedFile(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_id || !form.supply_id || !form.comercializadora_id) return
    setLoading(true)

    const supabase = createClient()

    // Upload attached comercializadora contract if present
    let signedFileUrl: string | null = null
    if (attachedFile) {
      setUploading(true)
      const ext = attachedFile.name.split('.').pop()
      const path = `contracts/${form.client_id}/${Date.now()}.${ext}`
      const { data: uploadData } = await supabase.storage.from('documents').upload(path, attachedFile)
      if (uploadData) {
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
        signedFileUrl = urlData.publicUrl
      }
      setUploading(false)
    }

    const comercializadora = comercializadoras.find(c => c.id === form.comercializadora_id)

    const { data: newContract, error } = await supabase.from('contracts').insert({
      client_id: form.client_id,
      supply_id: form.supply_id,
      type: 'comercializadora',
      comercializadora_id: form.comercializadora_id,
      comercializadora_name: comercializadora?.name || '',
      tramite: form.tramite,
      servicio: form.servicio,
      producto: form.producto,
      firmante: isCompanyOrAyto ? form.firmante : null,
      dni_firmante: isCompanyOrAyto ? form.dni_firmante : null,
      consumo_anual: form.consumo_anual ? parseFloat(form.consumo_anual) : null,
      observaciones: form.observaciones || null,
      fecha_activacion: form.fecha_activacion || null,
      voltis_contract_type: form.voltis_contract_type || null,
      signed_file_url: signedFileUrl,
      status: signedFileUrl ? 'signed' : 'draft',
      signed_at: signedFileUrl ? new Date().toISOString() : null,
      generated_at: new Date().toISOString(),
      created_by: user?.id,
    }).select('id').single()

    if (error) {
      console.error(error)
      setLoading(false)
      return
    }

    // Sync to Google Sheets
    if (newContract?.id) {
      setSyncStatus('syncing')
      try {
        const res = await fetch('/api/contracts/sheets-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contract_id: newContract.id }),
        })
        setSyncStatus(res.ok ? 'ok' : 'error')
      } catch {
        setSyncStatus('error')
      }
    }

    setLoading(false)
    onCreated()
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-bg rounded-3xl shadow-ambient-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-bg z-10 flex items-center justify-between p-6 border-b border-surface-container-low">
          <div>
            <h2 className="font-sans font-bold text-lg text-ink">Nuevo Contrato</h2>
            <p className="text-xs text-ink-3 mt-0.5">Los datos se sincronizarán automáticamente con VOLTIS CONTRATACIONES</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
            <X className="w-5 h-5 text-ink-3" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* ── Sección 1: Cliente y suministro ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-ink-3 tracking-widest uppercase">Cliente y suministro</p>

            <SearchableClientSelector
              label="Cliente"
              required
              value={form.client_id}
              onChange={(clientId) => setForm({ ...form, client_id: clientId, supply_id: '' })}
              clients={clients}
              placeholder="Buscar cliente..."
            />

            {/* Document links — shown when client has stored files */}
            {selectedClient && (selectedClient.nif_file_url || selectedClient.cif_file_url || selectedClient.iban_file_url) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-ink-4">Documentos:</span>
                {selectedClient.nif_file_url && (
                  <a
                    href={selectedClient.nif_file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-info-container text-info text-xs font-medium hover:opacity-80 transition"
                  >
                    <FileText className="w-3 h-3" />
                    DNI
                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                  </a>
                )}
                {selectedClient.cif_file_url && (
                  <a
                    href={selectedClient.cif_file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-info-container text-info text-xs font-medium hover:opacity-80 transition"
                  >
                    <FileText className="w-3 h-3" />
                    CIF
                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                  </a>
                )}
                {selectedClient.iban_file_url && (
                  <a
                    href={selectedClient.iban_file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-info-container text-info text-xs font-medium hover:opacity-80 transition"
                  >
                    <FileText className="w-3 h-3" />
                    Cert. bancario
                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                  </a>
                )}
              </div>
            )}

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

            {/* Firmante — only for empresa/ayuntamiento */}
            {isCompanyOrAyto && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-info-container/50 rounded-xl border border-info/20">
                <p className="col-span-2 text-xs font-medium text-info">
                  Empresa / Ayuntamiento — indica el representante firmante
                </p>
                <Input
                  label="Nombre del firmante"
                  value={form.firmante}
                  onChange={e => setForm({ ...form, firmante: e.target.value })}
                  placeholder="Nombre y apellidos"
                />
                <Input
                  label="DNI del firmante"
                  value={form.dni_firmante}
                  onChange={e => setForm({ ...form, dni_firmante: e.target.value })}
                  placeholder="12345678A"
                />
              </div>
            )}
          </div>

          {/* ── Sección 2: Contrato comercializadora ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-ink-3 tracking-widest uppercase">Contrato comercializadora</p>

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Comercializadora"
                required
                value={form.comercializadora_id}
                onChange={(e) => setForm({ ...form, comercializadora_id: e.target.value })}
              >
                <option value="">Seleccionar</option>
                {comercializadoras.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>

              <Select
                label="Servicio"
                value={form.servicio}
                onChange={(e) => setForm({ ...form, servicio: e.target.value })}
              >
                <option value="electricity">Energía (Luz)</option>
                <option value="gas">Gas</option>
                <option value="telecom">Telefonía</option>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Producto / Tarifa"
                value={form.producto}
                onChange={e => setForm({ ...form, producto: e.target.value })}
                placeholder="2.0TD Precio mercado..."
              />
              <Select
                label="Trámite"
                value={form.tramite}
                onChange={e => setForm({ ...form, tramite: e.target.value })}
              >
                {TRAMITES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Consumo anual (kWh)"
                type="number"
                value={form.consumo_anual}
                onChange={e => setForm({ ...form, consumo_anual: e.target.value })}
                placeholder="Auto desde suministro"
              />
              <Input
                label="Fecha activación prevista"
                type="date"
                value={form.fecha_activacion}
                onChange={e => setForm({ ...form, fecha_activacion: e.target.value })}
              />
            </div>

            {/* Adjuntar contrato firmado */}
            <div>
              <p className="text-sm font-medium text-ink-2 mb-1.5">Contrato comercializadora firmado (opcional)</p>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed border-neutral/30 rounded-xl hover:border-info/50 hover:bg-info-container/30 transition-all"
              >
                {attachedFile ? (
                  <>
                    <FileText className="w-5 h-5 text-info shrink-0" />
                    <span className="text-sm text-ink truncate">{attachedFile.name}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-ink-3 shrink-0" />
                    <span className="text-sm text-ink-3">Adjuntar PDF del contrato firmado</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── Sección 3: Contrato Voltis (plantillas — próximamente) ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-ink-3 tracking-widest uppercase">Contrato Voltis</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, voltis_contract_type: f.voltis_contract_type === 'colaboracion' ? '' : 'colaboracion' }))}
                className={`p-4 rounded-xl border-2 text-left transition-all ${form.voltis_contract_type === 'colaboracion' ? 'border-info bg-info-container' : 'border-neutral/20 hover:border-info/30'}`}
              >
                <p className="font-semibold text-sm text-ink">Colaboración</p>
                <p className="text-xs text-ink-3 mt-0.5">Contrato de colaboración Voltis</p>
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, voltis_contract_type: f.voltis_contract_type === 'propuesta' ? '' : 'propuesta' }))}
                className={`p-4 rounded-xl border-2 text-left transition-all ${form.voltis_contract_type === 'propuesta' ? 'border-info bg-info-container' : 'border-neutral/20 hover:border-info/30'}`}
              >
                <p className="font-semibold text-sm text-ink">Propuesta</p>
                <p className="text-xs text-ink-3 mt-0.5">Propuesta de servicio Voltis</p>
              </button>
            </div>
            {form.voltis_contract_type && (
              <div className="flex items-center gap-2 px-3 py-2 bg-warn-container/50 rounded-lg border border-warn/20">
                <AlertTriangle className="w-4 h-4 text-warn shrink-0" />
                <p className="text-xs text-warn">Generación automática disponible cuando se suban las plantillas</p>
              </div>
            )}
          </div>

          {/* Observaciones */}
          <Input
            label="Observaciones (opcional)"
            value={form.observaciones}
            onChange={e => setForm({ ...form, observaciones: e.target.value })}
            placeholder="Notas adicionales..."
          />

          {/* Sync status */}
          {syncStatus === 'syncing' && (
            <div className="flex items-center gap-2 text-xs text-info">
              <div className="w-3 h-3 border-2 border-info border-t-transparent rounded-full animate-spin" />
              Sincronizando con VOLTIS CONTRATACIONES...
            </div>
          )}
          {syncStatus === 'error' && (
            <p className="text-xs text-err">⚠ No se pudo sincronizar con Google Sheets. El contrato se ha guardado en el CRM.</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button
              type="submit"
              disabled={loading || uploading || !form.client_id || !form.supply_id || !form.comercializadora_id}
            >
              {loading || uploading ? 'Guardando...' : 'Guardar contrato'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
