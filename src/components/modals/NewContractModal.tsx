'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Upload, FileText, ExternalLink, CheckCircle2,
  Building2, Zap, Euro, Calendar, User, MapPin,
  Printer, ChevronLeft, Loader2, Check, Info,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { formatCurrency } from '@/lib/utils/format'
import type { ServiceContract, PaymentModality, ServiceContractType } from '@/types/database'
import { generatePropuestaHTML, generateContratoHTML, generateAndDownloadPDF } from '@/lib/voltis-contract-templates'

// ─── Shared types & helpers ───────────────────────────────────────────────────

interface PaymentScheduleItem { label: string; date: Date; amount: number; isPast?: boolean }

const TRAMITES = [
  { value: 'new', label: 'Nueva contratación' },
  { value: 'change', label: 'Cambio de comercializadora' },
  { value: 'renewal', label: 'Renovación' },
  { value: 'name_change', label: 'Cambio de nombre' },
]

const MODALITY_DESCRIPTIONS: Record<PaymentModality, string> = {
  A: '100% a la firma del contrato. Una sola factura.',
  B: '4 cuotas iguales al final de cada trimestre natural.',
  C: '50% a la firma + 4 cuotas trimestrales de 12,5% cada una.',
  D: '100% al vencimiento del contrato (12 meses).',
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function formatDateES(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Cuota trimestral Voltis (sin IVA) en función del ahorro anual estimado */
function getSubscriptionQuarterly(ahorro: number): number {
  if (ahorro <= 200) return 0
  if (ahorro <= 350) return 20
  if (ahorro <= 750) return 45
  return 90  // 751-999 € (≥1000 usa modelo porcentaje)
}

function buildPaymentSchedule(modality: PaymentModality, feeAmount: number, startDate: Date): PaymentScheduleItem[] {
  const today = new Date()
  switch (modality) {
    case 'A': return [{ label: 'Pago único', date: startDate, amount: feeAmount }]
    case 'B': {
      const q = feeAmount / 4
      return [1, 2, 3, 4].map(i => ({ label: `Cuota T${i}`, date: addMonths(startDate, i * 3), amount: q, isPast: addMonths(startDate, i * 3) < today }))
    }
    case 'C': {
      const half = feeAmount / 2
      const quarter = half / 4
      return [
        { label: 'Entrada (50%)', date: startDate, amount: half },
        ...[1, 2, 3, 4].map(i => ({ label: `Cuota T${i} (12,5%)`, date: addMonths(startDate, i * 3), amount: quarter, isPast: addMonths(startDate, i * 3) < today })),
      ]
    }
    case 'D': return [{ label: 'Pago único al vencimiento', date: addMonths(startDate, 12), amount: feeAmount }]
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  preselectedClientId?: string
  preselectedSupplyId?: string
}

type ContractMode = 'select' | 'comercializadora' | 'voltis'

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function NewContractModal({ open, onClose, onCreated, preselectedClientId, preselectedSupplyId }: Props) {
  const { user } = useAuthStore()
  const [mode, setMode] = useState<ContractMode>(preselectedClientId ? 'voltis' : 'select')

  useEffect(() => {
    if (open) setMode(preselectedClientId ? 'voltis' : 'select')
  }, [open, preselectedClientId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-bg rounded-3xl shadow-ambient-lg w-full max-w-3xl mx-4 max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 bg-bg z-10 flex items-center justify-between p-6 border-b border-surface-container-low">
          <div className="flex items-center gap-2">
            {mode !== 'select' && (
              <button onClick={() => setMode('select')} className="p-1.5 rounded-lg hover:bg-bg-2 transition-all mr-1">
                <ChevronLeft className="w-4 h-4 text-ink-3" />
              </button>
            )}
            <div>
              <h2 className="font-sans font-bold text-lg text-ink">
                {mode === 'select' ? 'Nuevo Contrato' : mode === 'comercializadora' ? 'Contrato Comercializadora' : 'Contrato Voltis'}
              </h2>
              <p className="text-xs text-ink-3 mt-0.5">
                {mode === 'select' ? 'Elige el tipo de contrato' :
                 mode === 'comercializadora' ? 'Asociar contrato firmado a un suministro' :
                 'Generar propuesta y contrato de servicios'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
            <X className="w-5 h-5 text-ink-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {mode === 'select' && (
            <motion.div key="select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6">
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setMode('comercializadora')}
                  className="flex flex-col items-start gap-3 p-5 rounded-2xl border-2 border-line hover:border-brand/50 hover:bg-bg-2 transition-all text-left group"
                >
                  <div className="w-10 h-10 rounded-xl bg-info-container flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-info" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-ink group-hover:text-brand transition-colors">Comercializadora</p>
                    <p className="text-xs text-ink-3 mt-1 leading-relaxed">Registrar y asociar un contrato firmado con una comercializadora a un suministro del cliente.</p>
                  </div>
                </button>
                <button
                  onClick={() => setMode('voltis')}
                  className="flex flex-col items-start gap-3 p-5 rounded-2xl border-2 border-line hover:border-brand/50 hover:bg-bg-2 transition-all text-left group"
                >
                  <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-brand" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-ink group-hover:text-brand transition-colors">Contrato Voltis</p>
                    <p className="text-xs text-ink-3 mt-1 leading-relaxed">Configurar y generar la propuesta de colaboración (PRC) y el contrato de prestación de servicios (CSP).</p>
                  </div>
                </button>
              </div>
            </motion.div>
          )}

          {mode === 'comercializadora' && (
            <motion.div key="comercializadora" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ComercializadoraForm
                preselectedClientId={preselectedClientId}
                preselectedSupplyId={preselectedSupplyId}
                userId={user?.id}
                onClose={onClose}
                onCreated={onCreated}
              />
            </motion.div>
          )}

          {mode === 'voltis' && (
            <motion.div key="voltis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <VoltisContractForm
                preselectedClientId={preselectedClientId}
                userId={user?.id}
                onClose={onClose}
                onCreated={onCreated}
              />
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Comercializadora Form ────────────────────────────────────────────────────

function ComercializadoraForm({ preselectedClientId, preselectedSupplyId, userId, onClose, onCreated }: {
  preselectedClientId?: string
  preselectedSupplyId?: string
  userId?: string
  onClose: () => void
  onCreated: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [clients, setClients] = useState<any[]>([])
  const [supplies, setSupplies] = useState<any[]>([])
  const [comercializadoras, setComercializadoras] = useState<any[]>([])
  const [selectedClient, setSelectedClient] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle')
  const [attachedFile, setAttachedFile] = useState<File | null>(null)

  const [form, setForm] = useState({
    client_id: preselectedClientId || '',
    supply_id: preselectedSupplyId || '',
    comercializadora_id: '',
    tramite: 'change',
    servicio: 'electricity',
    producto: '',
    firmante: '',
    dni_firmante: '',
    consumo_anual: '',
    fecha_activacion: new Date().toISOString().split('T')[0],
  })

  const isCompanyOrAyto = selectedClient?.type === 'empresa' || selectedClient?.type === 'ayuntamiento'

  useEffect(() => {
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
        const { data } = await supabase.from('supplies').select('id, cups, tariff, type, address, consumption_data').eq('client_id', preselectedClientId).order('created_at', { ascending: false })
        setSupplies(data || [])
      }
    }
    fetchData()
  }, [preselectedClientId])

  useEffect(() => {
    if (!form.client_id) { setSupplies([]); setSelectedClient(null); return }
    const fetch = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('supplies').select('id, cups, tariff, type, address, consumption_data').eq('client_id', form.client_id).order('created_at', { ascending: false })
      setSupplies(data || [])
      const client = clients.find(c => c.id === form.client_id)
      setSelectedClient(client || null)
    }
    fetch()
  }, [form.client_id, clients])

  useEffect(() => {
    if (!form.supply_id) return
    const supply = supplies.find(s => s.id === form.supply_id)
    if (!supply) return
    const cd = supply.consumption_data as any
    const cp = cd?.consumoPeriodos || {}
    const pSum = (Number(cp.P1)||0)+(Number(cp.P2)||0)+(Number(cp.P3)||0)+(Number(cp.P4)||0)+(Number(cp.P5)||0)+(Number(cp.P6)||0)
    const kwh = pSum > 0 ? pSum : (Number(cd?.totalKwh) || 0)
    setForm(f => ({
      ...f,
      servicio: supply.type === 'luz' ? 'electricity' : supply.type === 'gas' ? 'gas' : 'telecom',
      producto: supply.tariff || '',
      consumo_anual: kwh > 0 ? String(Math.round(kwh)) : '',
    }))
  }, [form.supply_id, supplies])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_id || !form.supply_id || !form.comercializadora_id) return
    setLoading(true)
    const supabase = createClient()
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
      fecha_activacion: form.fecha_activacion || null,
      signed_file_url: signedFileUrl,
      status: signedFileUrl ? 'signed' : 'draft',
      signed_at: signedFileUrl ? new Date().toISOString() : null,
      generated_at: new Date().toISOString(),
      created_by: userId,
    }).select('id').single()

    if (!error && newContract?.id) {
      setSyncStatus('syncing')
      try {
        const res = await fetch('/api/contracts/sheets-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract_id: newContract.id }) })
        setSyncStatus(res.ok ? 'ok' : 'error')
      } catch { setSyncStatus('error') }
    }
    setLoading(false)
    onCreated()
    onClose()
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-5">
      {/* Cliente y suministro */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-ink-3 tracking-widest uppercase">Cliente y suministro</p>
        <SearchableClientSelector label="Cliente" required value={form.client_id} onChange={(id) => setForm({ ...form, client_id: id, supply_id: '' })} clients={clients} placeholder="Buscar cliente..." />
        {selectedClient && (selectedClient.nif_file_url || selectedClient.cif_file_url || selectedClient.iban_file_url) && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-ink-4">Documentos:</span>
            {selectedClient.nif_file_url && <a href={selectedClient.nif_file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-info-container text-info text-xs font-medium hover:opacity-80"><FileText className="w-3 h-3" />DNI<ExternalLink className="w-2.5 h-2.5 opacity-70" /></a>}
            {selectedClient.cif_file_url && <a href={selectedClient.cif_file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-info-container text-info text-xs font-medium hover:opacity-80"><FileText className="w-3 h-3" />CIF<ExternalLink className="w-2.5 h-2.5 opacity-70" /></a>}
            {selectedClient.iban_file_url && <a href={selectedClient.iban_file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-info-container text-info text-xs font-medium hover:opacity-80"><FileText className="w-3 h-3" />Cert. bancario<ExternalLink className="w-2.5 h-2.5 opacity-70" /></a>}
          </div>
        )}
        <Select label="Suministro (CUPS)" required value={form.supply_id} onChange={(e) => setForm({ ...form, supply_id: e.target.value })} disabled={!form.client_id}>
          <option value="">Seleccionar suministro</option>
          {supplies.map((s) => <option key={s.id} value={s.id}>{s.cups || 'Sin CUPS'} — {s.type?.toUpperCase()} {s.tariff}</option>)}
        </Select>
        {isCompanyOrAyto && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-info-container/50 rounded-xl border border-info/20">
            <p className="col-span-2 text-xs font-medium text-info">Empresa / Ayuntamiento — indica el representante firmante</p>
            <Input label="Nombre del firmante" value={form.firmante} onChange={e => setForm({ ...form, firmante: e.target.value })} placeholder="Nombre y apellidos" />
            <Input label="DNI del firmante" value={form.dni_firmante} onChange={e => setForm({ ...form, dni_firmante: e.target.value })} placeholder="12345678A" />
          </div>
        )}
      </div>

      {/* Comercializadora */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-ink-3 tracking-widest uppercase">Comercializadora</p>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Comercializadora" required value={form.comercializadora_id} onChange={(e) => setForm({ ...form, comercializadora_id: e.target.value })}>
            <option value="">Seleccionar</option>
            {comercializadoras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select label="Servicio" value={form.servicio} onChange={(e) => setForm({ ...form, servicio: e.target.value })}>
            <option value="electricity">Energía (Luz)</option>
            <option value="gas">Gas</option>
            <option value="telecom">Telefonía</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Producto / Tarifa" value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })} placeholder="2.0TD..." />
          <Select label="Trámite" value={form.tramite} onChange={e => setForm({ ...form, tramite: e.target.value })}>
            {TRAMITES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Consumo anual (kWh)" type="number" value={form.consumo_anual} onChange={e => setForm({ ...form, consumo_anual: e.target.value })} placeholder="Auto desde suministro" />
          <Input label="Fecha activación prevista" type="date" value={form.fecha_activacion} onChange={e => setForm({ ...form, fecha_activacion: e.target.value })} />
        </div>
        <div>
          <p className="text-sm font-medium text-ink-2 mb-1.5">Contrato firmado (opcional)</p>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setAttachedFile(f) }} />
          <button type="button" onClick={() => fileRef.current?.click()} className="w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed border-neutral/30 rounded-xl hover:border-info/50 hover:bg-info-container/30 transition-all">
            {attachedFile ? <><FileText className="w-5 h-5 text-info shrink-0" /><span className="text-sm text-ink truncate">{attachedFile.name}</span></> : <><Upload className="w-5 h-5 text-ink-3 shrink-0" /><span className="text-sm text-ink-3">Adjuntar PDF del contrato firmado</span></>}
          </button>
        </div>
      </div>

      {syncStatus === 'error' && <p className="text-xs text-err">⚠ No se pudo sincronizar con Google Sheets.</p>}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={loading || uploading || !form.client_id || !form.supply_id || !form.comercializadora_id}>
          {loading || uploading ? 'Guardando...' : 'Guardar contrato'}
        </Button>
      </div>
    </form>
  )
}

// ─── Voltis Contract Form ─────────────────────────────────────────────────────

function VoltisContractForm({ preselectedClientId, userId, onClose, onCreated }: {
  preselectedClientId?: string
  userId?: string
  onClose: () => void
  onCreated: () => void
}) {
  const [clients, setClients] = useState<any[]>([])
  const [selectedClient, setSelectedClient] = useState<any>(null)
  const [existingContract, setExistingContract] = useState<ServiceContract | null>(null)
  const [savedContract, setSavedContract] = useState<ServiceContract | null>(null)
  const [loadingClient, setLoadingClient] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form fields
  const [clientId, setClientId] = useState(preselectedClientId || '')
  const [ahorroConfirmado, setAhorroConfirmado] = useState('')
  const [contractType, setContractType] = useState<ServiceContractType>('porcentaje')
  const [isRenewal, setIsRenewal] = useState(false)
  const [paymentModality, setPaymentModality] = useState<PaymentModality>('A')
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [representativeName, setRepresentativeName] = useState('')
  const [representativeNif, setRepresentativeNif] = useState('')
  const [signingLocation, setSigningLocation] = useState('')

  useEffect(() => {
    const fetch = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('clients').select('id, name, type, cif, nif, cif_nif, fiscal_address, ahorro_sugerido, ahorro_pendiente_revision').order('name')
      setClients(data || [])
      if (preselectedClientId) {
        const c = data?.find((x: any) => x.id === preselectedClientId)
        if (c) handleSelectClient(c, data || [])
      }
    }
    fetch()
  }, [preselectedClientId])

  const handleSelectClient = async (client: any, allClients?: any[]) => {
    setSelectedClient(client)
    setClientId(client.id)
    setLoadingClient(true)
    const supabase = createClient()
    const { data: sc } = await supabase
      .from('service_contracts')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Personas físicas: particular + autónomo → datos vienen de la ficha del cliente, no del contrato
    const isNatural = ['particular', 'autonomo'].includes(client.type)

    if (sc) {
      setExistingContract(sc as ServiceContract)
      setAhorroConfirmado(sc.ahorro_confirmado?.toString() ?? '')
      setContractType(sc.contract_type as ServiceContractType)
      setIsRenewal(sc.is_renewal)
      setPaymentModality(sc.payment_modality as PaymentModality)
      setStartDate(sc.start_date)
      // Para personas físicas siempre usamos los datos de la ficha del cliente
      setRepresentativeName(isNatural ? client.name : (sc.representative_name ?? ''))
      setRepresentativeNif(isNatural ? (client.nif ?? client.cif_nif ?? '') : (sc.representative_nif ?? ''))
      setSigningLocation(sc.signing_location ?? '')
    } else {
      setExistingContract(null)
      const ahorro = client.ahorro_sugerido ?? 0
      setContractType(ahorro > 1000 ? 'porcentaje' : 'suscripcion')
      setAhorroConfirmado('')
      setIsRenewal(false)
      setPaymentModality('A')
      setStartDate(new Date().toISOString().split('T')[0])
      if (client.fiscal_address) {
        const parts = client.fiscal_address.split(',')
        setSigningLocation(parts[parts.length - 1]?.trim() ?? '')
      }
      setRepresentativeName(isNatural ? client.name : '')
      setRepresentativeNif(isNatural ? (client.nif ?? client.cif_nif ?? '') : '')
    }
    setLoadingClient(false)
  }

  // Personas físicas (particular + autónomo) → sin representante manual
  const isNatural = selectedClient ? ['particular', 'autonomo'].includes(selectedClient.type) : false

  // Derived
  const ahorroNum = parseFloat(ahorroConfirmado) || 0
  const subscriptionQuarterly = contractType === 'suscripcion' ? getSubscriptionQuarterly(ahorroNum) : 0
  const feeAmount = contractType === 'porcentaje' ? ahorroNum * 0.25 : subscriptionQuarterly * 4
  const startDateObj = new Date(startDate + 'T00:00:00')
  const endDateObj = addMonths(startDateObj, 12)
  const paymentSchedule = ahorroNum > 0 || contractType === 'suscripcion'
    ? buildPaymentSchedule(paymentModality, feeAmount, startDateObj)
    : []

  const handleSave = async () => {
    if (!clientId || !startDate) return
    setSaving(true)
    const supabase = createClient()
    const payload = {
      client_id: clientId,
      contract_type: contractType,
      is_renewal: isRenewal,
      ahorro_confirmado: ahorroNum || null,
      fee_percentage: 25,
      fee_amount: contractType === 'porcentaje' ? feeAmount : null,
      subscription_monthly: contractType === 'suscripcion' ? subscriptionQuarterly : null,
      payment_modality: paymentModality,
      start_date: startDate,
      end_date: endDateObj.toISOString().split('T')[0],
      representative_name: representativeName || null,
      representative_nif: representativeNif || null,
      signing_location: signingLocation || null,
      created_by: userId,
    }

    let saved: ServiceContract | null = null
    if (existingContract?.id) {
      const { data } = await supabase.from('service_contracts').update(payload).eq('id', existingContract.id).select().single()
      saved = data as ServiceContract
    } else {
      const { data } = await supabase.from('service_contracts').insert(payload).select().single()
      saved = data as ServiceContract
    }

    setSavedContract(saved)
    setSaving(false)
    onCreated()
  }

  const contractForPDF = savedContract || existingContract

  return (
    <div className="p-6 space-y-5 min-h-[520px]">
      {/* Client selector */}
      <SearchableClientSelector
        label="Cliente"
        required
        value={clientId}
        onChange={(id) => {
          const c = clients.find(x => x.id === id)
          if (c) handleSelectClient(c)
        }}
        clients={clients}
        placeholder="Buscar cliente..."
      />

      {loadingClient && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
        </div>
      )}

      {selectedClient && !loadingClient && (
        <>
          {/* ── Layout 2 columnas ── */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">

            {/* COL IZQ: Ahorro + Tipo + Modalidad */}
            <div className="space-y-4">

              {/* Ahorro */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Ahorro estimado</p>
                {selectedClient.ahorro_sugerido > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-2 border border-line-2">
                    <div>
                      <p className="text-[9px] text-ink-4 uppercase font-semibold">Sugerido por comparativas</p>
                      <p className="text-sm font-bold text-ink">{formatCurrency(selectedClient.ahorro_sugerido)}/año</p>
                    </div>
                    <button onClick={() => setAhorroConfirmado(selectedClient.ahorro_sugerido.toFixed(2))} className="text-[10px] font-semibold text-brand hover:opacity-70 px-2 py-1 rounded-md hover:bg-bg transition-colors">
                      Usar
                    </button>
                  </div>
                )}
                <div className="relative">
                  <Euro className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                  <input type="number" value={ahorroConfirmado} onChange={e => setAhorroConfirmado(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-12 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">€/año</span>
                </div>
                {ahorroNum > 0 && (
                  <div className={`flex items-center gap-2 text-[10px] px-2.5 py-1.5 rounded-lg ${ahorroNum > 1000 ? 'bg-info-container/60 text-info' : 'bg-warn-container/60 text-warn'}`}>
                    <Info className="w-3 h-3 flex-shrink-0" />
                    {ahorroNum > 1000
                      ? `25% → ${formatCurrency(feeAmount)} + IVA/año`
                      : subscriptionQuarterly === 0
                        ? `Suscripción → 0€/trimestre (ahorro ≤ 200€)`
                        : `Suscripción → ${subscriptionQuarterly}€/trimestre + IVA`}
                  </div>
                )}
              </div>

              {/* Tipo de contrato */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Tipo de contrato</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['porcentaje', 'suscripcion'] as const).map(type => (
                    <button key={type} onClick={() => setContractType(type)} className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all text-left ${contractType === type ? 'bg-brand text-white border-brand' : 'bg-card border-line-2 text-ink-3 hover:border-brand/40'}`}>
                      {type === 'porcentaje' ? '25% ahorro' : 'Suscripción'}
                      <p className={`text-[10px] font-normal mt-0.5 ${contractType === type ? 'text-white/70' : 'text-ink-4'}`}>
                        {type === 'porcentaje' ? '> 1.000€/año' : `${subscriptionQuarterly}€/trim`}
                      </p>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-3 cursor-pointer select-none">
                  <input type="checkbox" checked={isRenewal} onChange={e => setIsRenewal(e.target.checked)} className="rounded border-line-2" />
                  Es renovación (año 2+)
                </label>
              </div>

              {/* Modalidad de pago */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Modalidad de pago</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['A', 'B', 'C', 'D'] as PaymentModality[]).map(m => (
                    <button key={m} onClick={() => setPaymentModality(m)} className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all text-left ${paymentModality === m ? 'bg-brand text-white border-brand' : 'bg-card border-line-2 text-ink-3 hover:border-brand/40'}`}>
                      <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">Mod. {m}</span>
                      <p className={`text-[10px] font-normal mt-0.5 leading-tight ${paymentModality === m ? 'text-white/80' : 'text-ink-4'}`}>{MODALITY_DESCRIPTIONS[m]}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* COL DER: Fechas + Firmante + Calendario */}
            <div className="space-y-4">

              {/* Fechas */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Fechas</p>
                <div>
                  <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">Inicio servicios</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full pl-8 pr-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">Vencimiento (auto)</label>
                  <div className="flex items-center px-3 py-2 text-sm bg-bg-2 border border-line-2 rounded-lg text-ink-3">{formatDateES(endDateObj)}</div>
                </div>
              </div>

              {/* Firmante — solo empresas/ayuntamientos */}
              {!isNatural && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Representante firmante</p>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                    <input type="text" value={representativeName} onChange={e => setRepresentativeName(e.target.value)} placeholder="Nombre del representante" className="w-full pl-8 pr-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors" />
                  </div>
                  <input type="text" value={representativeNif} onChange={e => setRepresentativeNif(e.target.value)} placeholder="DNI: 12345678A" className="w-full px-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors font-mono" />
                </div>
              )}

              {/* Lugar de formalización — siempre visible */}
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                <input type="text" value={signingLocation} onChange={e => setSigningLocation(e.target.value)} placeholder="Ciudad (ej: Pamplona)" className="w-full pl-8 pr-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors" />
              </div>

              {/* Calendario de pagos */}
              {paymentSchedule.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Calendario de pagos</p>
                  <div className="rounded-xl border border-line-2 overflow-hidden">
                    {paymentSchedule.map((item, i) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-2 text-xs border-b border-line last:border-0 ${i === 0 ? 'bg-ok-container/30' : 'bg-card'}`}>
                        <span className="font-medium text-ink">{item.label}</span>
                        <span className="font-semibold text-ink tabular-nums">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-bg-2 text-xs">
                      <span className="font-bold text-ink">Total + IVA</span>
                      <span className="font-bold text-ink tabular-nums">{formatCurrency(feeAmount)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !clientId || !startDate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Guardar configuración
            </button>

            {contractForPDF && (isNatural || representativeName) && (
              <>
                <button
                  onClick={async () => {
                    const repName = isNatural ? selectedClient.name : representativeName
                    const startDateObj = new Date(startDate + 'T00:00:00')
                    const endDateObj = addMonths(startDateObj, 12)
                    const html = generatePropuestaHTML({
                      clientName: selectedClient.name,
                      representativeName: repName,
                      ahorroConfirmado: ahorroNum || null,
                      feeAmount,
                      subscriptionQuarterly,
                      startDate: startDateObj,
                      endDate: endDateObj,
                      contractType,
                    })
                    const filename = `Propuesta_Voltis_${selectedClient.name.replace(/\s+/g, '_')}.pdf`
                    const pdfBlob = await generateAndDownloadPDF(html, filename)
                    if (contractForPDF?.id) {
                      const supabase = createClient()
                      const path = `service_contracts/${selectedClient.id}/propuesta-${Date.now()}.html`
                      const { data: up } = await supabase.storage.from('documents').upload(path, pdfBlob, { contentType: 'text/html', upsert: false })
                      if (up) {
                        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
                        await supabase.from('service_contracts').update({ proposal_url: urlData.publicUrl }).eq('id', contractForPDF.id)
                        onCreated()
                      }
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line-2 bg-card text-ink text-xs font-semibold hover:bg-bg-2 transition-all"
                >
                  <Printer className="w-3.5 h-3.5" /> Propuesta PDF
                </button>
                <button
                  onClick={async () => {
                    const repName = isNatural ? selectedClient.name : representativeName
                    const repNif = isNatural ? (selectedClient.nif ?? selectedClient.cif_nif ?? '') : representativeNif
                    const startDateObj = new Date(startDate + 'T00:00:00')
                    const endDateObj = addMonths(startDateObj, 12)
                    const firstPaymentDate = new Date(startDateObj)
                    firstPaymentDate.setDate(firstPaymentDate.getDate() + 15)
                    const schedule = ahorroNum > 0 || contractType === 'suscripcion'
                      ? buildPaymentSchedule(paymentModality, feeAmount, startDateObj)
                      : []
                    const html = generateContratoHTML({
                      clientName: selectedClient.name,
                      clientCif: selectedClient.cif ?? selectedClient.cif_nif ?? '',
                      clientFiscalAddress: selectedClient.fiscal_address ?? '',
                      representativeName: repName,
                      representativeNif: repNif,
                      signingLocation,
                      startDate: startDateObj,
                      endDate: endDateObj,
                      firstPaymentDate,
                      ahorroConfirmado: ahorroNum || null,
                      feeAmount,
                      subscriptionQuarterly,
                      contractType,
                      paymentModality,
                      paymentSchedule: schedule,
                      isNatural,
                    })
                    const filename = `Contrato_Voltis_${selectedClient.name.replace(/\s+/g, '_')}.pdf`
                    const pdfBlob = await generateAndDownloadPDF(html, filename)
                    if (contractForPDF?.id) {
                      const supabase = createClient()
                      const path = `service_contracts/${selectedClient.id}/contrato-${Date.now()}.html`
                      const { data: up } = await supabase.storage.from('documents').upload(path, pdfBlob, { contentType: 'text/html', upsert: false })
                      if (up) {
                        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
                        await supabase.from('service_contracts').update({ contract_url: urlData.publicUrl }).eq('id', contractForPDF.id)
                        onCreated()
                      }
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line-2 bg-card text-ink text-xs font-semibold hover:bg-bg-2 transition-all"
                >
                  <FileText className="w-3.5 h-3.5" /> Contrato PDF
                </button>
              </>
            )}

            {savedContract && (
              <span className="flex items-center gap-1 text-xs text-ok font-semibold ml-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Guardado
              </span>
            )}
          </div>
        </>
      )}

    </div>
  )
}

// ─── PDF generation via voltis-contract-templates.ts openInNewWindow ─────────
// VoltisProModal and VoltisContratoModal replaced — PDF buttons call openInNewWindow directly.
