'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FileText, ChevronDown, ChevronUp, AlertTriangle, Check,
  Loader2, Euro, Calendar, User, MapPin,
  FileSignature, Printer, Info, ExternalLink, Trash2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils/format'
import type { ServiceContract, PaymentModality, ServiceContractType } from '@/types/database'
import { generatePropuestaHTML, generateContratoHTML, generateAndDownloadPDF } from '@/lib/voltis-contract-templates'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  client: any
  onUpdate?: () => void
}

interface PaymentScheduleItem {
  label: string
  date: Date
  amount: number
  isPast?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MODALITY_LABELS: Record<PaymentModality, string> = {
  A: 'Pago único al inicio',
  B: 'Trimestral vencido (×4)',
  C: 'Entrada 50% + 4 cuotas trimestrales',
  D: 'Pago único al vencimiento',
}

const MODALITY_DESCRIPTIONS: Record<PaymentModality, string> = {
  A: '100% a la firma del contrato. Una sola factura.',
  B: '4 cuotas iguales al final de cada trimestre natural.',
  C: '50% a la firma + 4 cuotas trimestrales de 12,5% cada una.',
  D: '100% al vencimiento del contrato (12 meses).',
}

/** Cuota trimestral Voltis (sin IVA) en función del ahorro anual estimado */
function getSubscriptionQuarterly(ahorro: number): number {
  if (ahorro <= 200) return 0
  if (ahorro <= 350) return 20
  if (ahorro <= 750) return 45
  return 90  // 751-999 € (≥1000 usa modelo porcentaje)
}

/**
 * Devuelve true si el cliente tiene CIF (sociedad mercantil, ayuntamiento, etc.)
 * CIF: letra [ABCDEFGHJKLMNPQRSUVW] + 7 dígitos + dígito/letra de control
 */
function hasCIF(client: any): boolean {
  const id = (client.cif ?? client.cif_nif ?? '').trim().toUpperCase()
  return /^[ABCDEFGHJKLMNPQRSUVW]\d{7}[A-J0-9]$/i.test(id)
}

/**
 * Persona física (firma por sí misma):
 * - "particular" → siempre
 * - "empresa" con NIF (autónomo) → sin CIF
 * Empresa con CIF real y ayuntamiento → necesitan representante firmante
 */
function isNaturalClient(client: any): boolean {
  if (!client) return false
  if (client.type === 'particular') return true
  if (client.type === 'empresa') return !hasCIF(client)
  return false
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function formatDateES(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function buildPaymentSchedule(
  modality: PaymentModality,
  feeAmount: number,
  startDate: Date,
): PaymentScheduleItem[] {
  const today = new Date()
  switch (modality) {
    case 'A':
      return [{ label: 'Pago único', date: startDate, amount: feeAmount }]
    case 'B': {
      const q = feeAmount / 4
      return [1, 2, 3, 4].map(i => ({
        label: `Cuota T${i}`,
        date: addMonths(startDate, i * 3),
        amount: q,
        isPast: addMonths(startDate, i * 3) < today,
      }))
    }
    case 'C': {
      const half = feeAmount / 2
      const quarter = half / 4
      return [
        { label: 'Entrada (50%)', date: startDate, amount: half },
        ...([1, 2, 3, 4].map(i => ({
          label: `Cuota T${i} (12,5%)`,
          date: addMonths(startDate, i * 3),
          amount: quarter,
          isPast: addMonths(startDate, i * 3) < today,
        }))),
      ]
    }
    case 'D':
      return [{ label: 'Pago único al vencimiento', date: addMonths(startDate, 12), amount: feeAmount }]
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ContractSection({ client, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Existing service contract for this client (most recent)
  const [contract, setContract] = useState<ServiceContract | null>(null)
  const [loadingContract, setLoadingContract] = useState(false)

  // Form state
  const [ahorroSugerido] = useState<number>(client.ahorro_sugerido ?? 0)
  const [ahorroConfirmado, setAhorroConfirmado] = useState<string>('')
  const [contractType, setContractType] = useState<ServiceContractType>('porcentaje')
  const [isRenewal, setIsRenewal] = useState(false)
  const [paymentModality, setPaymentModality] = useState<PaymentModality>('A')
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [representativeName, setRepresentativeName] = useState('')
  const [representativeNif, setRepresentativeNif] = useState('')
  const [signingLocation, setSigningLocation] = useState('')

  // Load existing contract
  const fetchContract = useCallback(async () => {
    setLoadingContract(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('service_contracts')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      const isNatural = isNaturalClient(client)
      setContract(data as ServiceContract)
      setAhorroConfirmado(data.ahorro_confirmado?.toString() ?? '')
      setContractType(data.contract_type as ServiceContractType)
      setIsRenewal(data.is_renewal)
      setPaymentModality(data.payment_modality as PaymentModality)
      setStartDate(data.start_date)
      // Personas físicas → siempre usar datos de la ficha del cliente
      setRepresentativeName(isNatural ? client.name : (data.representative_name ?? ''))
      setRepresentativeNif(isNatural ? (client.nif ?? client.cif_nif ?? '') : (data.representative_nif ?? ''))
      setSigningLocation(data.signing_location ?? '')
    } else {
      // Auto-detect type from ahorro
      const ahorro = client.ahorro_sugerido ?? 0
      setContractType(ahorro > 1000 ? 'porcentaje' : 'suscripcion')
      // Pre-fill signing location from fiscal address
      if (client.fiscal_address) {
        const parts = client.fiscal_address.split(',')
        setSigningLocation(parts[parts.length - 1]?.trim() ?? '')
      }
      // Pre-fill representative for personas físicas (particular + empresa con NIF/autónomo)
      if (isNaturalClient(client)) {
        setRepresentativeName(client.name)
        setRepresentativeNif(client.nif ?? client.cif_nif ?? '')
      }
    }
    setLoadingContract(false)
  }, [client])

  useEffect(() => {
    if (expanded) fetchContract()
  }, [expanded, fetchContract])

  // Derived values
  const ahorroNum = parseFloat(ahorroConfirmado) || 0
  const subscriptionQuarterly = contractType === 'suscripcion' ? getSubscriptionQuarterly(ahorroNum) : 0
  const feeAmount = contractType === 'porcentaje'
    ? ahorroNum * 0.25
    : subscriptionQuarterly * 4  // suscripcion: cuota trimestral × 4 = anual
  const startDateObj = new Date(startDate + 'T00:00:00')
  const endDateObj = addMonths(startDateObj, 12)
  const paymentSchedule = ahorroNum > 0 || contractType === 'suscripcion'
    ? buildPaymentSchedule(paymentModality, feeAmount, startDateObj)
    : []

  const pendingRevision = client.ahorro_pendiente_revision

  // Delete contract
  const handleDelete = async () => {
    if (!contract?.id) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('service_contracts').delete().eq('id', contract.id)
    // Reset all form state
    setContract(null)
    setAhorroConfirmado('')
    setContractType(client.ahorro_sugerido > 1000 ? 'porcentaje' : 'suscripcion')
    setIsRenewal(false)
    setPaymentModality('A')
    setStartDate(new Date().toISOString().split('T')[0])
    setRepresentativeName(isNaturalClient(client) ? client.name : '')
    setRepresentativeNif(isNaturalClient(client) ? (client.nif ?? client.cif_nif ?? '') : '')
    setSigningLocation(
      client.fiscal_address
        ? (client.fiscal_address.split(',').pop()?.trim() ?? '')
        : ''
    )
    setConfirmDelete(false)
    setDeleting(false)
    onUpdate?.()
  }

  // Save contract config
  const handleSave = async () => {
    setSaving(true)
    const supabase = createClient()
    const payload = {
      client_id: client.id,
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
    }

    if (contract?.id) {
      await supabase.from('service_contracts').update(payload).eq('id', contract.id)
    } else {
      const { data } = await supabase.from('service_contracts').insert(payload).select().single()
      if (data) setContract(data as ServiceContract)
    }

    // Clear pending revision flag if ahorro was confirmed
    if (pendingRevision && ahorroNum > 0) {
      await supabase.from('clients').update({ ahorro_pendiente_revision: false }).eq('id', client.id)
    }

    setSaving(false)
    onUpdate?.()
  }

  // Personas físicas (particular + empresa con NIF/autónomo) → datos de la ficha, sin pedir representante
  const isNatural = isNaturalClient(client)
  const hasRequiredData = startDate && (isNatural || representativeName)

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-bg-2 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <FileSignature className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-semibold text-ink">Contrato de servicios Voltis</h3>
          {contract && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              contract.status === 'signed' ? 'bg-ok-container text-ok' :
              contract.status === 'sent' ? 'bg-info-container text-info' :
              'bg-bg-2 text-ink-3'
            }`}>
              {contract.status === 'draft' ? 'Borrador' :
               contract.status === 'sent' ? 'Enviado' :
               contract.status === 'signed' ? 'Firmado' :
               contract.status === 'active' ? 'Activo' : 'Expirado'}
            </span>
          )}
          {pendingRevision && (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warn-container text-warn">
              <AlertTriangle className="w-2.5 h-2.5" /> Ahorro actualizado
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-ink-3" /> : <ChevronDown className="w-4 h-4 text-ink-3" />}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-line">

          {loadingContract ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
            </div>
          ) : (
            <>
              {/* Ahorro pendiente de revisión */}
              {pendingRevision && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-warn-container/60 border border-warn/30 mt-4">
                  <AlertTriangle className="w-4 h-4 text-warn flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-warn">
                    <p className="font-semibold">El ahorro estimado ha cambiado</p>
                    <p className="mt-0.5 opacity-80">
                      Se detectó un nuevo valor de {formatCurrency(ahorroSugerido)} desde los informes.
                      Revisa y confirma el ahorro abajo.
                    </p>
                  </div>
                </div>
              )}

              {/* ── BLOQUE 1: Ahorro ── */}
              <div className="pt-4 space-y-3">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Ahorro estimado</p>

                {ahorroSugerido > 0 && (
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-bg-2 border border-line-2">
                    <div>
                      <p className="text-[10px] text-ink-4 uppercase font-semibold">Sugerido (suma de comparativas)</p>
                      <p className="text-sm font-bold text-ink">{formatCurrency(ahorroSugerido)}/año</p>
                    </div>
                    <button
                      onClick={() => setAhorroConfirmado(ahorroSugerido.toFixed(2))}
                      className="text-[10px] font-semibold text-brand hover:text-brand-2 px-2 py-1 rounded-md hover:bg-bg transition-colors"
                    >
                      Usar este valor
                    </button>
                  </div>
                )}

                <div className="relative">
                  <Euro className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                  <input
                    type="number"
                    value={ahorroConfirmado}
                    onChange={e => setAhorroConfirmado(e.target.value)}
                    placeholder={client.type === 'ayuntamiento' ? 'Introducir manualmente' : '0.00'}
                    className="w-full pl-8 pr-4 py-2.5 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">€/año</span>
                </div>

                {ahorroNum > 0 && (
                  <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                    ahorroNum > 1000 ? 'bg-info-container/60 text-info' : 'bg-warn-container/60 text-warn'
                  }`}>
                    <Info className="w-3.5 h-3.5 flex-shrink-0" />
                    {ahorroNum > 1000
                      ? `Ahorro > 1.000€ → contrato por 25% (${formatCurrency(feeAmount)} + IVA/año)`
                      : subscriptionQuarterly === 0
                        ? `Suscripción → 0€/trimestre (ahorro ≤ 200€)`
                        : `Suscripción → ${subscriptionQuarterly}€/trimestre + IVA`}
                  </div>
                )}
              </div>

              {/* ── BLOQUE 2: Tipo de contrato ── */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Tipo de contrato</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['porcentaje', 'suscripcion'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setContractType(type)}
                      className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all text-left ${
                        contractType === type
                          ? 'bg-brand text-white border-brand'
                          : 'bg-card border-line-2 text-ink-3 hover:border-brand/40'
                      }`}
                    >
                      {type === 'porcentaje' ? '25% sobre ahorro' : 'Suscripción fija'}
                      <p className={`text-[10px] font-normal mt-0.5 ${contractType === type ? 'text-white/70' : 'text-ink-4'}`}>
                        {type === 'porcentaje' ? 'Ahorro > 1.000€/año' : `${subscriptionQuarterly}€/trim · Renovaciones`}
                      </p>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isRenewal}
                    onChange={e => setIsRenewal(e.target.checked)}
                    className="rounded border-line-2"
                  />
                  Es renovación (año 2+)
                </label>
              </div>

              {/* ── BLOQUE 3: Modalidad de pago ── */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Modalidad de pago</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['A', 'B', 'C', 'D'] as PaymentModality[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setPaymentModality(m)}
                      className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all text-left ${
                        paymentModality === m
                          ? 'bg-brand text-white border-brand'
                          : 'bg-card border-line-2 text-ink-3 hover:border-brand/40'
                      }`}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">Modalidad {m}</span>
                      <p className={`text-[10px] font-normal mt-0.5 ${paymentModality === m ? 'text-white/80' : 'text-ink-4'}`}>
                        {MODALITY_DESCRIPTIONS[m]}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── BLOQUE 4: Fechas ── */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Fechas</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">Inicio servicios</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                      <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">Vencimiento (auto)</label>
                    <div className="flex items-center px-3 py-2 text-sm bg-bg-2 border border-line-2 rounded-lg text-ink-3">
                      {formatDateES(endDateObj)}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── BLOQUE 5: Firmante — solo empresas/ayuntamientos ── */}
              {!isNatural && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Representante firmante</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">Nombre</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                        <input
                          type="text"
                          value={representativeName}
                          onChange={e => setRepresentativeName(e.target.value)}
                          placeholder="Nombre completo del representante"
                          className="w-full pl-8 pr-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">DNI</label>
                      <input
                        type="text"
                        value={representativeNif}
                        onChange={e => setRepresentativeNif(e.target.value)}
                        placeholder="12345678A"
                        className="w-full px-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Lugar de formalización — siempre visible */}
              <div>
                <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">Lugar de formalización</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
                  <input
                    type="text"
                    value={signingLocation}
                    onChange={e => setSigningLocation(e.target.value)}
                    placeholder="Ciudad donde se firma (ej: Pamplona)"
                    className="w-full pl-8 pr-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
              </div>

              {/* ── BLOQUE 6: Calendario de pagos ── */}
              {paymentSchedule.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Calendario de pagos</p>
                  <div className="rounded-xl border border-line-2 overflow-hidden">
                    {paymentSchedule.map((item, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between px-4 py-2.5 text-xs border-b border-line last:border-0 ${
                          item.isPast ? 'opacity-50' : ''
                        } ${i === 0 ? 'bg-ok-container/30' : 'bg-card'}`}
                      >
                        <span className="font-medium text-ink">{item.label}</span>
                        <span className="text-ink-3">{formatDateES(item.date)}</span>
                        <span className="font-semibold text-ink tabular-nums">
                          {formatCurrency(item.amount)} + IVA
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-2 bg-bg-2 text-xs">
                      <span className="font-bold text-ink">Total anual</span>
                      <span />
                      <span className="font-bold text-ink tabular-nums">{formatCurrency(feeAmount)} + IVA</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── BLOQUE 7: Estado documentos ── */}
              {(contract?.proposal_url || contract?.contract_url) && (
                <div className="flex flex-wrap gap-2">
                  {contract.proposal_url && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success/10 text-success text-[11px] font-medium">
                      <Check className="w-3 h-3" /> Propuesta generada
                    </span>
                  )}
                  {contract.contract_url && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success/10 text-success text-[11px] font-medium">
                      <Check className="w-3 h-3" /> Contrato generado
                    </span>
                  )}
                </div>
              )}

              {/* ── Acciones ── */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving || !startDate}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Guardar configuración
                </button>

                {/* Eliminar contrato */}
                {contract && (
                  confirmDelete ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-err-container/30 border border-err/30">
                      <span className="text-xs text-err font-medium">¿Eliminar definitivamente?</span>
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="text-xs font-semibold text-err hover:underline disabled:opacity-50"
                      >
                        {deleting ? 'Eliminando…' : 'Sí, eliminar'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="text-xs text-ink-3 hover:underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      title="Eliminar contrato"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line-2 text-ink-3 text-xs hover:border-err/40 hover:text-err hover:bg-err-container/20 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Eliminar
                    </button>
                  )
                )}

                {contract && hasRequiredData && (
                  <>
                    <button
                      onClick={async () => {
                        const repName = isNatural ? client.name : representativeName
                        const html = generatePropuestaHTML({
                          clientName: client.name,
                          representativeName: repName,
                          ahorroConfirmado: ahorroNum || null,
                          feeAmount,
                          subscriptionQuarterly,
                          startDate: startDateObj,
                          endDate: endDateObj,
                          contractType,
                        })
                        const filename = `Propuesta_Voltis_${client.name.replace(/\s+/g, '_')}.pdf`
                        const blob = await generateAndDownloadPDF(html, filename)
                        // Guardar PDF en storage
                        const supabase = createClient()
                        const path = `service_contracts/${client.id}/propuesta-${Date.now()}.html`
                        const { data: up } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'text/html', upsert: false })
                        if (up) {
                          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
                          await supabase.from('service_contracts').update({ proposal_url: urlData.publicUrl }).eq('id', contract.id)
                          setContract(prev => prev ? { ...prev, proposal_url: urlData.publicUrl } : prev)
                        }
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line-2 bg-card text-ink text-xs font-semibold hover:bg-bg-2 transition-all"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Propuesta PDF
                    </button>
                    <button
                      onClick={async () => {
                        const repName = isNatural ? client.name : representativeName
                        const repNif = isNatural ? (client.nif ?? client.cif_nif ?? '') : representativeNif
                        const firstPaymentDate = new Date(startDateObj)
                        firstPaymentDate.setDate(firstPaymentDate.getDate() + 15)
                        const html = generateContratoHTML({
                          clientName: client.name,
                          clientCif: client.cif ?? client.cif_nif ?? '',
                          clientFiscalAddress: client.fiscal_address ?? '',
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
                          paymentSchedule,
                          isNatural,
                        })
                        const filename = `Contrato_Voltis_${client.name.replace(/\s+/g, '_')}.pdf`
                        const blob = await generateAndDownloadPDF(html, filename)
                        // Guardar PDF en storage
                        const supabase = createClient()
                        const path = `service_contracts/${client.id}/contrato-${Date.now()}.html`
                        const { data: up } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'text/html', upsert: false })
                        if (up) {
                          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
                          await supabase.from('service_contracts').update({ contract_url: urlData.publicUrl }).eq('id', contract.id)
                          setContract(prev => prev ? { ...prev, contract_url: urlData.publicUrl } : prev)
                        }
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line-2 bg-card text-ink text-xs font-semibold hover:bg-bg-2 transition-all"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Contrato PDF
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}
