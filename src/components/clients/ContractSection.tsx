'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FileText, ChevronDown, ChevronUp, AlertTriangle, Check,
  Loader2, RefreshCw, Euro, Calendar, User, MapPin,
  FileSignature, Printer, Info,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils/format'
import type { ServiceContract, PaymentModality, ServiceContractType } from '@/types/database'

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
  const [showPropuesta, setShowPropuesta] = useState(false)
  const [showContrato, setShowContrato] = useState(false)

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
      setContract(data as ServiceContract)
      setAhorroConfirmado(data.ahorro_confirmado?.toString() ?? '')
      setContractType(data.contract_type as ServiceContractType)
      setIsRenewal(data.is_renewal)
      setPaymentModality(data.payment_modality as PaymentModality)
      setStartDate(data.start_date)
      setRepresentativeName(data.representative_name ?? '')
      setRepresentativeNif(data.representative_nif ?? '')
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
      // Pre-fill representative for particulares
      if (client.type === 'particular') {
        setRepresentativeName(client.name)
        setRepresentativeNif(client.nif ?? '')
      }
    }
    setLoadingContract(false)
  }, [client])

  useEffect(() => {
    if (expanded) fetchContract()
  }, [expanded, fetchContract])

  // Derived values
  const ahorroNum = parseFloat(ahorroConfirmado) || 0
  const feeAmount = contractType === 'porcentaje'
    ? ahorroNum * 0.25
    : (parseFloat(ahorroConfirmado) || 19.99) * 12  // suscripcion: monthly × 12
  const subscriptionMonthly = contractType === 'suscripcion' ? 19.99 : null
  const startDateObj = new Date(startDate + 'T00:00:00')
  const endDateObj = addMonths(startDateObj, 12)
  const paymentSchedule = ahorroNum > 0 || contractType === 'suscripcion'
    ? buildPaymentSchedule(paymentModality, feeAmount, startDateObj)
    : []

  const pendingRevision = client.ahorro_pendiente_revision

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
      subscription_monthly: contractType === 'suscripcion' ? subscriptionMonthly : null,
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

  const hasRequiredData = startDate && representativeName

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
                      : `Ahorro ≤ 1.000€ → suscripción a 19,99€/mes + IVA`}
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
                        {type === 'porcentaje' ? 'Ahorro > 1.000€/año' : '19,99€/mes · Renovaciones'}
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

              {/* ── BLOQUE 5: Firmante del cliente ── */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">Datos del firmante</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">Nombre (Don/Doña)</label>
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
                    <label className="text-[10px] text-ink-3 uppercase font-semibold block mb-1">DNI del firmante</label>
                    <input
                      type="text"
                      value={representativeNif}
                      onChange={e => setRepresentativeNif(e.target.value)}
                      placeholder="12345678A"
                      className="w-full px-3 py-2 text-sm border border-line-2 rounded-lg bg-card focus:outline-none focus:border-brand transition-colors font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
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

                {contract && hasRequiredData && (
                  <>
                    <button
                      onClick={() => setShowPropuesta(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line-2 bg-card text-ink text-xs font-semibold hover:bg-bg-2 transition-all"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Propuesta PDF
                    </button>
                    <button
                      onClick={() => setShowContrato(true)}
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

      {/* PDF Modals */}
      {showPropuesta && (
        <PropuestaModal
          client={client}
          contract={contract!}
          feeAmount={feeAmount}
          endDate={endDateObj}
          onClose={() => setShowPropuesta(false)}
        />
      )}
      {showContrato && (
        <ContratoModal
          client={client}
          contract={contract!}
          feeAmount={feeAmount}
          paymentSchedule={paymentSchedule}
          startDate={startDateObj}
          endDate={endDateObj}
          onClose={() => setShowContrato(false)}
        />
      )}
    </div>
  )
}

// ─── Propuesta Modal ──────────────────────────────────────────────────────────

function PropuestaModal({
  client, contract, feeAmount, endDate, onClose,
}: {
  client: any
  contract: ServiceContract
  feeAmount: number
  endDate: Date
  onClose: () => void
}) {
  const handlePrint = () => {
    window.print()
  }

  const contactName = contract.representative_name || client.name
  const endDateStr = endDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col">
      {/* Toolbar — hidden on print */}
      <div className="no-print flex items-center justify-between px-6 py-3 bg-card border-b border-line">
        <span className="text-sm font-semibold text-ink">Propuesta de colaboración — {client.name}</span>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90"
          >
            <Printer className="w-3.5 h-3.5" /> Generar PDF
          </button>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-line-2 text-xs font-semibold text-ink-3 hover:bg-bg-2">
            Cerrar
          </button>
        </div>
      </div>

      {/* Document */}
      <div className="flex-1 overflow-auto bg-[#f0ede6] p-8 print:p-0 print:bg-white">
        <div
          id="propuesta-doc"
          style={{
            width: '210mm', minHeight: '297mm', margin: '0 auto',
            background: 'white', padding: '18mm 16mm',
            fontFamily: "'Times New Roman', serif",
            color: '#1a1a18', fontSize: '10.5pt', lineHeight: '1.6',
            boxShadow: '0 4px 32px rgba(0,0,0,0.15)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8mm', borderBottom: '1px solid #e0ddd6', paddingBottom: '4mm' }}>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '13pt', color: '#1a3a5c', letterSpacing: '1px' }}>⚡ Voltis Energía</div>
            </div>
            <div style={{ fontSize: '8pt', color: '#888', textAlign: 'right' }}>
              <div>PRC-{new Date().getFullYear()} · v1.0</div>
            </div>
          </div>

          <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '6mm' }}>
            — PROPUESTA DE COLABORACIÓN
          </div>

          {/* Title */}
          <div style={{ marginBottom: '10mm' }}>
            <div style={{ fontSize: '28pt', fontWeight: 'normal', color: '#1a1a18', lineHeight: 1.1 }}>Asesoría energética</div>
            <div style={{ fontSize: '28pt', fontStyle: 'italic', color: '#1a3a5c', lineHeight: 1.1 }}>integral</div>
            <div style={{ fontSize: '10pt', color: '#555', marginTop: '4mm' }}>
              Una propuesta a medida para optimizar el coste energético y dar el primer paso hacia un Sistema de Gestión Energética.
            </div>
          </div>

          <div style={{ borderTop: '1px solid #e0ddd6', borderBottom: '1px solid #e0ddd6', padding: '4mm 0', marginBottom: '8mm' }}>
            <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '2mm' }}>DIRIGIDA A</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '2mm' }}>
              <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase' }}>CLIENTE<br /><span style={{ fontWeight: 'bold' }}>RAZÓN SOCIAL</span></div>
              <div style={{ fontSize: '10.5pt', fontStyle: 'italic', color: '#555' }}>{client.name}</div>
            </div>
          </div>

          <div style={{ marginBottom: '6mm' }}>
            <div>Apreciado/a <span style={{ borderBottom: '1px solid #1a1a18' }}>{contactName}</span>,</div>
            <div style={{ marginTop: '3mm' }}>En relación con nuestra última reunión, le adjunto a continuación el detalle de la propuesta de colaboración entre <strong>Voltis Energía</strong> y su empresa.</div>
          </div>

          {/* Ahorro estimado */}
          <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '3mm' }}>OBJETIVO DEL ESTUDIO</div>
          <div style={{ background: '#f0f4fb', border: '1px solid #dde6f5', borderRadius: '6px', padding: '4mm 5mm', marginBottom: '6mm' }}>
            <div style={{ fontSize: '7.5pt', color: '#1a3a5c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '2mm' }}>AHORRO ESTIMADO</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '10pt', color: '#333' }}>El presente estudio significará, con total seguridad, un ahorro aproximado en el cómputo total de la facturación de energía de la empresa.</div>
              <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#1a3a5c', whiteSpace: 'nowrap', marginLeft: '8mm' }}>
                {contract.ahorro_confirmado ? formatCurrency(contract.ahorro_confirmado) : '—'} <span style={{ fontSize: '12pt' }}>/año</span>
              </div>
            </div>
          </div>

          {/* Punto 01 */}
          <div style={{ display: 'grid', gridTemplateColumns: '30mm 1fr', gap: '4mm', marginBottom: '6mm' }}>
            <div>
              <div style={{ fontSize: '7pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase' }}>PUNTO</div>
              <div style={{ fontSize: '22pt', fontWeight: 'bold', color: '#1a3a5c', lineHeight: 1 }}>01</div>
            </div>
            <div>
              <div style={{ fontSize: '13pt', marginBottom: '3mm' }}>Revisión energética</div>
              <div style={{ fontSize: '9.5pt', color: '#555', marginBottom: '2mm' }}>
                Estado actual de los suministros eléctricos de <span style={{ borderBottom: '1px solid #aaa' }}>{client.name}</span>.
              </div>
              {['A · OPTIMIZACIÓN DE LAS POTENCIAS CONTRATADAS','B · MEJORA DEL DESEMPEÑO ENERGÉTICO','C · REVISIÓN DE TARIFAS DE ACCESO','D · CONDICIONES ECONÓMICAS Y ESTRATEGIA DE COMPRA','E · ÁREAS DE USO SIGNIFICATIVO DE ENERGÍA','F · REUNIONES SEMESTRALES','G · VERIFICACIÓN DE KPIS ECONÓMICOS'].map((item, i) => (
                <div key={i} style={{ fontSize: '7.5pt', fontWeight: 'bold', color: '#1a3a5c', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '1.5mm' }}>{item}</div>
              ))}
            </div>
          </div>

          {/* Punto 02 */}
          <div style={{ display: 'grid', gridTemplateColumns: '30mm 1fr', gap: '4mm', marginBottom: '6mm' }}>
            <div>
              <div style={{ fontSize: '7pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase' }}>PUNTO</div>
              <div style={{ fontSize: '22pt', fontWeight: 'bold', color: '#1a3a5c', lineHeight: 1 }}>02</div>
            </div>
            <div>
              <div style={{ fontSize: '13pt', marginBottom: '2mm' }}>Revisión de propuestas de terceros</div>
              <div style={{ fontSize: '9.5pt', color: '#555' }}>
                Análisis y revisión de las propuestas hechas por terceros a <span style={{ borderBottom: '1px solid #aaa' }}>{client.name}</span> en materia de mejoras de eficiencia energética.
              </div>
            </div>
          </div>

          {/* Punto 03 — Honorarios */}
          <div style={{ display: 'grid', gridTemplateColumns: '30mm 1fr', gap: '4mm', marginBottom: '6mm' }}>
            <div>
              <div style={{ fontSize: '7pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase' }}>PUNTO</div>
              <div style={{ fontSize: '22pt', fontWeight: 'bold', color: '#1a3a5c', lineHeight: 1 }}>03</div>
            </div>
            <div>
              <div style={{ fontSize: '13pt', marginBottom: '3mm' }}>Duración del contrato y honorarios</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm' }}>
                <div style={{ background: '#f8f8f6', border: '1px solid #e0ddd6', borderRadius: '6px', padding: '3mm 4mm' }}>
                  <div style={{ fontSize: '7pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '1.5mm' }}>DURACIÓN DEL CONTRATO</div>
                  <div style={{ fontSize: '13pt' }}>Hasta el {endDateStr}</div>
                  <div style={{ fontSize: '8.5pt', color: '#888', marginTop: '1.5mm' }}>Vigencia desde la firma. La forma de pago queda recogida en el contrato adjunto.</div>
                </div>
                <div style={{ background: '#f0f4fb', border: '1px solid #dde6f5', borderRadius: '6px', padding: '3mm 4mm' }}>
                  <div style={{ fontSize: '7pt', color: '#1a3a5c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '1.5mm' }}>MINUTA ANUAL</div>
                  <div style={{ fontSize: '8.5pt', color: '#555', marginBottom: '2mm' }}>
                    {contract.contract_type === 'porcentaje'
                      ? 'Honorarios anuales (25% sobre ahorro estimado).'
                      : 'Cuota mensual fija de suscripción.'}
                  </div>
                  <div style={{ fontSize: '15pt', fontWeight: 'bold', color: '#1a3a5c' }}>
                    {contract.contract_type === 'porcentaje'
                      ? `${formatCurrency(feeAmount)} + IVA`
                      : `${formatCurrency(19.99)}/mes + IVA`}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid #e0ddd6', marginTop: '8mm', paddingTop: '4mm', display: 'flex', justifyContent: 'space-between', fontSize: '7.5pt', color: '#888' }}>
            <div>Voltis Soluciones S.L. · CIF B71548705<br />C/ Berriobide 38, Of. 209 · Ansoáin (Navarra)</div>
            <div style={{ textAlign: 'right' }}>voltisenergia.com<br />clientes@voltisenergia.com · 747 474 360</div>
          </div>

          {/* Firma */}
          <div style={{ pageBreakBefore: 'always', paddingTop: '12mm' }}>
            <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '6mm' }}>— A SU DISPOSICIÓN</div>
            <div style={{ fontSize: '20pt', lineHeight: 1.2, marginBottom: '8mm' }}>Quedamos a su <em style={{ color: '#1a3a5c' }}>disposición</em></div>
            <div style={{ fontSize: '9.5pt', color: '#555', marginBottom: '10mm' }}>
              Estaremos encantados de resolver cualquier duda. No dude en contactar con nosotros.
            </div>
            <div style={{ borderTop: '1px solid #e0ddd6', paddingTop: '6mm' }}>
              <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '4mm' }}>ACEPTACIÓN DE LA PROPUESTA</div>
              <div style={{ fontSize: '9.5pt', marginBottom: '8mm' }}>Conforme con el alcance, condiciones y honorarios descritos en esta propuesta, ambas partes firman a continuación.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10mm' }}>
                <div>
                  <div style={{ fontSize: '7.5pt', color: '#1a3a5c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '2mm' }}>EL CLIENTE</div>
                  <div style={{ border: '1px dashed #ccc', borderRadius: '4px', height: '25mm', marginBottom: '2mm' }} />
                  <div style={{ fontSize: '7.5pt', color: '#aaa', letterSpacing: '1px', textTransform: 'uppercase' }}>FIRMA Y SELLO</div>
                  <div style={{ borderBottom: '1px solid #1a1a18', marginTop: '4mm', width: '60%' }} />
                  <div style={{ fontSize: '8.5pt', marginTop: '1mm' }}>D./Dña. {contract.representative_name || '______________________'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '7.5pt', color: '#1a3a5c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '2mm' }}>EL ASESOR</div>
                  <div style={{ border: '1px dashed #ccc', borderRadius: '4px', height: '25mm', marginBottom: '2mm' }} />
                  <div style={{ fontSize: '7.5pt', color: '#aaa', letterSpacing: '1px', textTransform: 'uppercase' }}>FIRMA Y SELLO</div>
                  <div style={{ fontWeight: 'bold', marginTop: '4mm' }}>Voltis Soluciones S.L.</div>
                  <div style={{ fontSize: '8.5pt' }}>D. Nicolás Imízcoz García</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body > *:not(#propuesta-doc) { display: none !important; }
          .no-print { display: none !important; }
          #propuesta-doc { box-shadow: none !important; margin: 0 !important; width: 100% !important; }
          @page { margin: 0; size: A4; }
        }
      `}</style>
    </div>
  )
}

// ─── Contrato Modal ───────────────────────────────────────────────────────────

function ContratoModal({
  client, contract, feeAmount, paymentSchedule, startDate, endDate, onClose,
}: {
  client: any
  contract: ServiceContract
  feeAmount: number
  paymentSchedule: PaymentScheduleItem[]
  startDate: Date
  endDate: Date
  onClose: () => void
}) {
  const handlePrint = () => window.print()

  const today = new Date()
  const todayStr = today.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
  const startStr = startDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })

  // Fecha de primer pago = inicio + 15 días
  const firstPaymentDate = new Date(startDate)
  firstPaymentDate.setDate(firstPaymentDate.getDate() + 15)
  const firstPaymentStr = firstPaymentDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })

  const clausulaV = buildClausulaV(contract, feeAmount, paymentSchedule)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col">
      <div className="no-print flex items-center justify-between px-6 py-3 bg-card border-b border-line">
        <span className="text-sm font-semibold text-ink">Contrato de servicios — {client.name}</span>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90">
            <Printer className="w-3.5 h-3.5" /> Generar PDF
          </button>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-line-2 text-xs font-semibold text-ink-3 hover:bg-bg-2">
            Cerrar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#f0ede6] p-8 print:p-0 print:bg-white">
        <div
          id="contrato-doc"
          style={{
            width: '210mm', minHeight: '297mm', margin: '0 auto',
            background: 'white', padding: '18mm 16mm',
            fontFamily: "'Times New Roman', serif",
            color: '#1a1a18', fontSize: '10.5pt', lineHeight: '1.7',
            boxShadow: '0 4px 32px rgba(0,0,0,0.15)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6mm', borderBottom: '1px solid #e0ddd6', paddingBottom: '3mm' }}>
            <div style={{ fontWeight: 'bold', fontSize: '13pt', color: '#1a3a5c' }}>⚡ Voltis Energía</div>
            <div style={{ fontSize: '8pt', color: '#888' }}>CSP-{today.getFullYear()} · v1.0</div>
          </div>
          <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '5mm' }}>— CONTRATO PROFESIONAL</div>

          <div style={{ fontSize: '24pt', fontWeight: 'normal', lineHeight: 1.2, marginBottom: '4mm' }}>
            Contrato de prestación<br />de servicios <em style={{ color: '#1a3a5c' }}>profesionales</em>
          </div>
          <div style={{ fontSize: '9.5pt', color: '#555', marginBottom: '8mm' }}>
            Servicios de asesoría y consultoría energética prestados por <strong>Voltis Soluciones S.L.</strong>
          </div>

          {/* Reunidos */}
          <div style={{ borderTop: '1px solid #e0ddd6', paddingTop: '4mm', marginBottom: '4mm' }}>
            <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '4mm' }}>REUNIDOS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '28mm 1fr', gap: '3mm', marginBottom: '4mm' }}>
              <div>
                <div style={{ fontSize: '7pt', color: '#888', letterSpacing: '1px', textTransform: 'uppercase' }}>DE UNA PARTE</div>
                <div style={{ fontSize: '7.5pt', fontWeight: 'bold', color: '#1a3a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>EL CLIENTE</div>
              </div>
              <div style={{ fontSize: '10pt' }}>
                Don/Doña <span style={{ borderBottom: '1px solid #1a1a18' }}>{contract.representative_name || '______________________'}</span>, mayor de edad, con DNI <span style={{ borderBottom: '1px solid #1a1a18' }}>{contract.representative_nif || '__________'}</span>, en nombre y representación de <span style={{ borderBottom: '1px solid #1a1a18' }}>{client.name}</span>, con CIF <span style={{ borderBottom: '1px solid #1a1a18' }}>{client.cif || '__________'}</span> y domicilio en <span style={{ borderBottom: '1px solid #1a1a18' }}>{client.fiscal_address || '______________________________'}</span> <em>(en adelante «el Cliente»).</em>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '28mm 1fr', gap: '3mm', marginBottom: '4mm' }}>
              <div>
                <div style={{ fontSize: '7pt', color: '#888', letterSpacing: '1px', textTransform: 'uppercase' }}>DE OTRA PARTE</div>
                <div style={{ fontSize: '7.5pt', fontWeight: 'bold', color: '#1a3a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>EL ASESOR</div>
              </div>
              <div style={{ fontSize: '10pt' }}>
                Don <strong>Nicolás Imízcoz García</strong>, mayor de edad, con DNI <strong>73464830R</strong>, en nombre y representación de <strong>Voltis Soluciones S.L.</strong>, con CIF <strong>B71548705</strong> y domicilio en Calle Berriobide 38, Of. 209, Ansoáin (Navarra) 31013 <em>(en adelante «el Asesor»).</em>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6mm', borderTop: '1px solid #e0ddd6', paddingTop: '3mm' }}>
              <div>
                <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '1mm' }}>LUGAR DE FORMALIZACIÓN</div>
                <div style={{ fontSize: '10.5pt' }}>{contract.signing_location || '______________________'}</div>
              </div>
              <div>
                <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '1mm' }}>FECHA</div>
                <div style={{ fontSize: '10.5pt' }}>{todayStr}</div>
              </div>
            </div>
          </div>

          {/* Exponen */}
          <div style={{ marginBottom: '5mm', borderTop: '1px solid #e0ddd6', paddingTop: '4mm' }}>
            <div style={{ fontSize: '7.5pt', color: '#888', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '3mm' }}>EXPONEN</div>
            <div style={{ display: 'grid', gridTemplateColumns: '20mm 1fr', gap: '2mm', marginBottom: '2mm' }}>
              <div style={{ fontSize: '10pt', fontStyle: 'italic', fontWeight: 'bold', color: '#1a3a5c' }}>Primero.</div>
              <div>Que el <strong>Asesor</strong> está especializado en la prestación de servicios de asesoría y consultoría energética.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '20mm 1fr', gap: '2mm' }}>
              <div style={{ fontSize: '10pt', fontStyle: 'italic', fontWeight: 'bold', color: '#1a3a5c' }}>Segundo.</div>
              <div>Que el <strong>Cliente</strong> requiere sus servicios profesionales, que serán concretados en la estipulación <strong>Primera</strong> de este contrato.</div>
            </div>
            <div style={{ marginTop: '3mm' }}>Ambas partes se reconocen mutuamente suficiente capacidad jurídica y de obrar para el otorgamiento del presente contrato, a cuyo efecto acuerdan las siguientes <em>cláusulas.</em></div>
          </div>

          {/* Cláusulas */}
          {[
            {
              num: 'I', title: 'Objeto del contrato y funciones a desarrollar',
              body: <div>El <strong>Asesor</strong> se compromete a prestar auxilio y consejo al <strong>Cliente</strong> en las materias siguientes:<br /><br />
                <span style={{ display: 'block', paddingLeft: '4mm' }}>
                  ▪ Todo lo referido en la <em>«Propuesta de colaboración Voltis Energía — <span style={{ borderBottom: '1px solid #aaa' }}>{client.name}</span>»</em>, presentada y aceptada el <span style={{ borderBottom: '1px solid #aaa' }}>{startStr}</span>, la cual se incluye como <strong>Anexo I</strong>.
                </span>
              </div>,
            },
            {
              num: 'II', title: 'Duración del contrato',
              body: <div>Las partes acuerdan que el contrato tendrá una duración de <strong>doce (12) meses</strong>.</div>,
            },
            {
              num: 'III', title: 'Fecha de inicio de los servicios',
              body: <div>La fecha de inicio de los servicios prestados por el <strong>Asesor</strong> comenzó el día <span style={{ borderBottom: '1px solid #aaa' }}>{startStr}</span>, y su consiguiente pago será el día <span style={{ borderBottom: '1px solid #aaa' }}>{firstPaymentStr}</span>.</div>,
            },
            {
              num: 'IV', title: 'Honorarios',
              body: (
                <div>
                  <div style={{ background: '#f0f4fb', border: '1px solid #dde6f5', borderRadius: '6px', padding: '3mm 4mm', marginBottom: '3mm', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '7.5pt', color: '#1a3a5c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '1mm' }}>PORCENTAJE SOBRE AHORRO</div>
                      <div>Del ahorro económico anual obtenido por el <strong>Cliente</strong> como consecuencia de los servicios de asesoría energética prestados.</div>
                    </div>
                    <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#1a3a5c', marginLeft: '8mm' }}>
                      {contract.contract_type === 'porcentaje' ? '25%' : '—'}
                    </div>
                  </div>
                  {contract.contract_type === 'porcentaje' ? (
                    <div>
                      Tomando como referencia el ahorro estimado recogido en la <em>«Propuesta de colaboración Voltis Energía — <span style={{ borderBottom: '1px solid #aaa' }}>{client.name}</span>»</em> (Anexo I), los honorarios correspondientes al primer año de servicio ascienden a <strong><span style={{ borderBottom: '1px solid #1a1a18' }}>{formatCurrency(feeAmount)}</span> más IVA</strong>, importe equivalente al <strong>25%</strong> del ahorro estimado.<br /><br />
                      Este importe será facturado al Cliente conforme a lo establecido en la cláusula <strong>Quinta</strong> del presente contrato, quedando sujeto a regularización al finalizar el periodo anual en función del ahorro real obtenido.
                    </div>
                  ) : (
                    <div>
                      Los honorarios por el servicio de suscripción ascienden a <strong>19,99 € más IVA mensuales</strong>, lo que representa <strong>{formatCurrency(19.99 * 12)} más IVA</strong> anuales.
                    </div>
                  )}
                  <br />
                  En caso de prórroga del contrato, las partes podrán acordar la revisión de los honorarios con una antelación mínima de un (1) mes respecto a la finalización del periodo contractual.
                </div>
              ),
            },
            {
              num: 'V', title: 'Forma de pago',
              body: clausulaV,
            },
            {
              num: 'VI', title: 'Obligaciones de las partes',
              body: (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm' }}>
                  <div>
                    <div style={{ fontSize: '7.5pt', fontWeight: 'bold', color: '#1a3a5c', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2mm' }}>OBLIGACIONES DEL ASESOR</div>
                    {['Prestar sus servicios de forma diligente.', 'Presentar los documentos correspondientes en tiempo y forma.', 'Asesorar e informar periódicamente al Cliente.'].map((o, i) => (
                      <div key={i} style={{ fontSize: '9.5pt', marginBottom: '1.5mm' }}>▪ {o}</div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: '7.5pt', fontWeight: 'bold', color: '#1a3a5c', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2mm' }}>OBLIGACIONES DEL CLIENTE</div>
                    {['Presentar los documentos para la correcta prestación del servicio.', 'Asistir a las reuniones y visitas necesarias.', 'El pago de los servicios con las condiciones acordadas en las cláusulas Cuarta y Quinta.'].map((o, i) => (
                      <div key={i} style={{ fontSize: '9.5pt', marginBottom: '1.5mm' }}>▪ {o}</div>
                    ))}
                  </div>
                </div>
              ),
            },
            {
              num: 'VII', title: 'Información periódica al Cliente',
              body: <div>El <strong>Asesor</strong> y el <strong>Cliente</strong> se comprometen a mantener un mínimo de <strong>dos (2) reuniones anuales</strong> con el objeto de informarse mutuamente o de entregar los documentos que procedan para la prestación de los servicios por parte del <strong>Asesor</strong>.</div>,
            },
            {
              num: 'VIII', title: 'Resolución del contrato',
              body: <div>El presente contrato podrá ser resuelto:<br /><br />
                ▪ Por <strong>acuerdo de las partes</strong>, mediante notificación fehaciente por escrito, siempre que medie un preaviso mínimo de <strong>un (1) mes</strong>.<br />
                ▪ De forma <strong>unilateral</strong>, por incumplimiento de las obligaciones o declaración de situación de concurso.
              </div>,
            },
            { num: 'IX', title: 'Protección de datos', body: <div>El <strong>Cliente</strong> se muestra conforme con la inclusión de sus datos personales en los ficheros del <strong>Asesor</strong>, pudiendo solicitar en cualquier momento el acceso, rectificación, cancelación u oposición de sus datos.</div> },
            { num: 'X', title: 'Confidencialidad', body: <div>El <strong>Asesor</strong> se compromete a mantener la confidencialidad acerca de los datos e informaciones que el <strong>Cliente</strong> le haya facilitado para la ejecución de los servicios de asesoría encomendados, salvo que deban ser divulgadas por imperativo legal.</div> },
            { num: 'XI', title: 'Sumisión a tribunales', body: <div>Las partes acuerdan que para las discrepancias que pudieran surgir en la interpretación, ejecución o aplicación de esta hoja de encargo, se someten expresamente a los <strong>Juzgados y Tribunales de Pamplona</strong> y renuncian de forma expresa a cualquier otro fuero o jurisdicción que pudiera serles de aplicación.</div> },
          ].map((clausula) => (
            <div key={clausula.num} style={{ display: 'grid', gridTemplateColumns: '22mm 1fr', gap: '3mm', marginBottom: '5mm', borderTop: '1px solid #f0ede6', paddingTop: '3mm' }}>
              <div>
                <div style={{ fontSize: '7pt', color: '#888', letterSpacing: '2px', textTransform: 'uppercase' }}>CLÁUSULA</div>
                <div style={{ fontSize: '20pt', fontStyle: 'italic', fontWeight: 'bold', color: '#1a3a5c', lineHeight: 1 }}>{clausula.num}</div>
              </div>
              <div>
                <div style={{ fontSize: '13pt', marginBottom: '2mm' }}>{clausula.title}</div>
                <div style={{ fontSize: '9.5pt' }}>{clausula.body}</div>
              </div>
            </div>
          ))}

          {/* Firma final */}
          <div style={{ textAlign: 'center', fontStyle: 'italic', fontSize: '10.5pt', margin: '8mm 0 4mm', borderTop: '1px solid #e0ddd6', paddingTop: '5mm' }}>
            — En prueba de conformidad —
          </div>
          <div style={{ fontSize: '9.5pt', textAlign: 'center', marginBottom: '8mm' }}>
            Los comparecientes firman, en el lugar y fecha que figuran en el encabezamiento del presente contrato.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10mm' }}>
            <div>
              <div style={{ fontSize: '7.5pt', color: '#1a3a5c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '2mm' }}>EL CLIENTE</div>
              <div style={{ border: '1px dashed #ccc', borderRadius: '4px', height: '25mm', marginBottom: '2mm' }} />
              <div style={{ fontSize: '7.5pt', color: '#aaa', letterSpacing: '1px', textTransform: 'uppercase' }}>FIRMA Y SELLO</div>
              <div style={{ borderBottom: '1px solid #1a1a18', marginTop: '4mm', width: '70%' }} />
              <div style={{ fontSize: '8.5pt', marginTop: '1mm' }}>D./Dña. {contract.representative_name || '______________________'}</div>
            </div>
            <div>
              <div style={{ fontSize: '7.5pt', color: '#1a3a5c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '2mm' }}>EL ASESOR</div>
              <div style={{ border: '1px dashed #ccc', borderRadius: '4px', height: '25mm', marginBottom: '2mm' }} />
              <div style={{ fontSize: '7.5pt', color: '#aaa', letterSpacing: '1px', textTransform: 'uppercase' }}>FIRMA Y SELLO</div>
              <div style={{ fontWeight: 'bold', marginTop: '4mm' }}>Voltis Soluciones S.L.</div>
              <div style={{ fontSize: '8.5pt' }}>D. Nicolás Imízcoz García</div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid #e0ddd6', marginTop: '8mm', paddingTop: '3mm', display: 'flex', justifyContent: 'space-between', fontSize: '7.5pt', color: '#888' }}>
            <div>Voltis Soluciones S.L. · CIF B71548705<br />C/ Berriobide 38, Of. 209 · Ansoáin (Navarra)</div>
            <div style={{ textAlign: 'right' }}>voltisenergia.com<br />clientes@voltisenergia.com · 747 474 360</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body > *:not(#contrato-doc) { display: none !important; }
          .no-print { display: none !important; }
          #contrato-doc { box-shadow: none !important; margin: 0 !important; width: 100% !important; }
          @page { margin: 0; size: A4; }
        }
      `}</style>
    </div>
  )
}

// ─── Cláusula V builder ───────────────────────────────────────────────────────

function buildClausulaV(
  contract: ServiceContract,
  feeAmount: number,
  schedule: PaymentScheduleItem[],
): React.ReactNode {
  const iban = 'ES19 0182 5000 8402 0187 5295'

  const paymentBox = (content: React.ReactNode, amount: string) => (
    <div style={{ background: '#f8f8f6', border: '1px solid #e0ddd6', borderRadius: '6px', padding: '3mm 4mm', marginBottom: '3mm', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ flex: 1 }}>{content}</div>
      <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#1a3a5c', marginLeft: '6mm', whiteSpace: 'nowrap' }}>{amount}</div>
    </div>
  )

  switch (contract.payment_modality) {
    case 'A':
      return (
        <div>
          {paymentBox(
            <div>Pago único mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.<br /><span style={{ fontFamily: 'monospace', fontSize: '9pt' }}>{iban}</span></div>,
            `${formatCurrency(feeAmount)} + IVA`
          )}
          <div>Se facilitará una factura anualmente por parte del <strong>Asesor</strong> hacia el <strong>Cliente</strong>.</div>
        </div>
      )
    case 'B':
      return (
        <div>
          <div style={{ marginBottom: '3mm' }}>El <strong>Cliente</strong> hará efectiva la cantidad estipulada en cuatro (4) cuotas trimestrales iguales, abonadas al vencimiento de cada trimestre, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</div>
          <div style={{ fontFamily: 'monospace', fontSize: '9pt', marginBottom: '3mm' }}>{iban}</div>
          {schedule.map((item, i) => paymentBox(
            <div><strong>{item.label}</strong> — al {item.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</div>,
            `${formatCurrency(item.amount)} + IVA`
          ))}
        </div>
      )
    case 'C':
      return (
        <div>
          <div style={{ marginBottom: '3mm' }}>El <strong>Cliente</strong> hará efectiva la cantidad estipulada de la siguiente forma, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>:</div>
          <div style={{ fontFamily: 'monospace', fontSize: '9pt', marginBottom: '3mm' }}>{iban}</div>
          {schedule.map((item, i) => paymentBox(
            <div><strong>{item.label}</strong> — al {item.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</div>,
            `${formatCurrency(item.amount)} + IVA`
          ))}
        </div>
      )
    case 'D':
      return (
        <div>
          {paymentBox(
            <div>Pago único al vencimiento del contrato, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.<br /><span style={{ fontFamily: 'monospace', fontSize: '9pt' }}>{iban}</span><br /><span style={{ fontSize: '9pt', color: '#555' }}>Fecha de vencimiento: {schedule[0]?.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>,
            `${formatCurrency(feeAmount)} + IVA`
          )}
        </div>
      )
  }
}
