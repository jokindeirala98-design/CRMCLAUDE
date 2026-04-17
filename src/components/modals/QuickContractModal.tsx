'use client'

import { useState, useEffect } from 'react'
import { X, FileText, Send, CheckCircle2, Loader2, MessageSquare, Mail, Smartphone } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format'
import { useAuthStore } from '@/stores/auth'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  client: any
}

type SubscriptionModel = 'fixed' | 'percentage'
type ContractVariant = 'b1_directo' | '25en4'
type DeliveryMethod = 'sms' | 'email' | 'both'
type Step = 'config' | 'review' | 'sending' | 'done'

const PLAN_TIERS = [
  { value: '19.99', label: 'Básico — 19,99€/trimestre', price: 19.99 },
  { value: '45', label: 'Profesional — 45€/trimestre', price: 45 },
  { value: '90', label: 'Empresarial — 90€/trimestre', price: 90 },
  { value: '180', label: 'Premium — 180€/trimestre', price: 180 },
]

const CONTRACT_VARIANT_LABELS: Record<ContractVariant, string> = {
  b1_directo: 'Cobro directo — 25% del ahorro anual (pago único)',
  '25en4': '25% del ahorro — 50% inicio + 50% trimestral (4 pagos)',
}

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  sms: 'SMS (enlace de firma por SMS)',
  email: 'Email',
  both: 'SMS + Email',
}

export function QuickContractModal({ open, onClose, onCreated, client }: Props) {
  const { user } = useAuthStore()
  const [step, setStep] = useState<Step>('config')

  // Model & plan
  const [model, setModel] = useState<SubscriptionModel>('percentage')
  const [contractVariant, setContractVariant] = useState<ContractVariant>('b1_directo')
  const [planTier, setPlanTier] = useState('45')
  const [paymentMode, setPaymentMode] = useState<'quarterly' | 'annual'>('quarterly')

  // Economics (for percentage model)
  const [estimatedSavings, setEstimatedSavings] = useState('')
  const [annualFee, setAnnualFee] = useState('')   // calculated or manual

  // Signer info
  const [signerName, setSignerName] = useState(client?.name || '')
  const [signerEmail, setSignerEmail] = useState(client?.email || '')
  const [signerPhone, setSignerPhone] = useState(client?.phone || '')
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('sms')

  // Representative (for empresa)
  const [repName, setRepName] = useState('')
  const [repDni, setRepDni] = useState('')

  // Supply
  const [selectedSupplyId, setSelectedSupplyId] = useState('')

  // State
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const isEmpresa = client?.type === 'empresa' || client?.type === 'ayuntamiento'

  useEffect(() => {
    if (open) {
      setStep('config')
      setSignerName(client?.name || '')
      setSignerEmail(client?.email || '')
      setSignerPhone(client?.phone || '')
      setRepName('')
      setRepDni(client?.nif || client?.cif || '')
      setError('')
      setResult(null)
      if (client?.supplies?.length === 1) {
        setSelectedSupplyId(client.supplies[0].id)
      } else {
        setSelectedSupplyId('')
      }
    }
  }, [open, client])

  // -----------------------------------------------------------------------
  // Derived values
  // -----------------------------------------------------------------------
  const selectedTier = PLAN_TIERS.find((t) => t.value === planTier)
  const quarterlyAmount = model === 'fixed' ? (selectedTier?.price || 0) : 0
  const annualFixed = quarterlyAmount * 4 * 1.21

  // For percentage model: 25% of estimated savings
  const parsedSavings = parseFloat(estimatedSavings) || 0
  const calculatedFee = Math.round(parsedSavings * 0.25)
  const effectiveAnnualFee = annualFee ? parseFloat(annualFee) : (model === 'percentage' ? calculatedFee : annualFixed)

  // Determine GoCardless payment mode
  const gcPaymentMode = model === 'fixed'
    ? (paymentMode === 'annual' ? 'immediate' : 'quarterly')
    : (contractVariant === 'b1_directo' ? 'immediate' : 'quarterly')

  const selectedSupply = client?.supplies?.find((s: any) => s.id === selectedSupplyId)

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------
  const canProceed = () => {
    if (!selectedSupplyId) return false
    if (!signerEmail) return false
    if (deliveryMethod !== 'email' && !signerPhone) return false
    if (model === 'percentage' && !estimatedSavings) return false
    if (isEmpresa && !repName) return false
    return true
  }

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------
  const handleGenerateAndSend = async () => {
    if (!canProceed()) {
      setError('Completa todos los campos obligatorios')
      return
    }

    setStep('sending')
    setLoading(true)
    setError('')

    try {
      const supabase = createClient()

      // 1. Create contract in DB
      const { data: contract, error: contractErr } = await supabase
        .from('contracts')
        .insert({
          client_id: client.id,
          supply_id: selectedSupplyId,
          type: 'voltis',
          status: 'draft',
          created_by: user?.id,
          generated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (contractErr) throw contractErr

      // 2. Create subscription record (pending activation)
      const { data: subscription, error: subErr } = await supabase
        .from('subscriptions')
        .insert({
          client_id: client.id,
          model: model,
          plan_tier: model === 'fixed' ? parseFloat(planTier) : null,
          percentage_value: model === 'percentage' ? 25 : null,
          payment_mode: gcPaymentMode,
          annual_amount: effectiveAnnualFee,
          total_savings: model === 'percentage' ? parsedSavings : null,
          status: 'pending_activation',
          start_date: new Date().toISOString(),
          client_iban: client.iban || null,
          external_client_name: client.name,
          external_client_email: client.email,
        })
        .select()
        .single()

      if (subErr) throw subErr

      // 3. Send to SignWell
      const swContractType = model === 'fixed'
        ? 'b1_directo'  // fixed plans use B1 style contract (single page, simple)
        : contractVariant

      const response = await fetch('/api/signwell/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: contract.id,
          clientId: client.id,
          subscriptionId: subscription.id,
          contractType: swContractType,
          deliveryMethod,
          signerEmail,
          signerPhone: signerPhone || undefined,
          signerName,
          repName: repName || (isEmpresa ? signerName : client.name),
          repDni: repDni || client.nif || client.cif || '',
          annualAmount: effectiveAnnualFee,
          totalSavings: parsedSavings || effectiveAnnualFee * 4,
          tariff: selectedSupply?.tariff,
          city: client.fiscal_address?.split(',').pop()?.trim(),
        }),
      })

      const resData = await response.json()

      if (!response.ok) {
        throw new Error(resData.error || 'Error enviando a SignWell')
      }

      setResult({
        contractId: contract.id,
        subscriptionId: subscription.id,
        signwellDocumentId: resData.signwellDocumentId,
        deliveryMethod: resData.deliveryMethod,
        mode: 'signwell',
      })
      setStep('done')
      onCreated()

    } catch (err: any) {
      console.error('Contract generation error:', err)
      setError(err.message || 'Error generando contrato')
      setStep('review')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  // Delivery method icon
  const DeliveryIcon = deliveryMethod === 'sms' ? Smartphone : deliveryMethod === 'both' ? MessageSquare : Mail
  const deliveryColor = deliveryMethod === 'email' ? 'text-blue-500' : 'text-green-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative bg-surface rounded-3xl shadow-ambient-lg w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-surface-container-low sticky top-0 bg-surface z-10">
          <div>
            <h2 className="font-display font-bold text-lg text-on-surface">
              Generar Contrato Voltis
            </h2>
            <p className="text-sm text-on-surface-variant mt-0.5">
              {client.name} — Contrato + SignWell e-firma
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
            <X className="w-5 h-5 text-on-surface-variant" />
          </button>
        </div>

        <div className="p-6">
          {/* ═══ STEP: CONFIG ═══ */}
          {step === 'config' && (
            <div className="space-y-5">

              {/* Supply selection */}
              {client.supplies && client.supplies.length > 0 ? (
                <Select
                  label="Suministro"
                  value={selectedSupplyId}
                  onChange={(e) => setSelectedSupplyId(e.target.value)}
                >
                  <option value="">Seleccionar suministro</option>
                  {client.supplies.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.cups || 'Sin CUPS'} — {s.type?.toUpperCase()} {s.tariff}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="p-4 bg-warning-container/30 rounded-xl text-sm text-warning font-medium">
                  Este cliente no tiene suministros. Crea uno primero.
                </div>
              )}

              {/* Subscription model */}
              <div>
                <label className="block text-sm font-medium text-on-surface mb-2">
                  Modelo de suscripción
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* 25% del ahorro */}
                  <button
                    onClick={() => setModel('percentage')}
                    className={`p-4 rounded-2xl border-2 transition-all text-left ${
                      model === 'percentage'
                        ? 'border-primary bg-primary/5'
                        : 'border-surface-container-high bg-surface-container-lowest hover:border-outline-variant'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${model === 'percentage' ? 'border-primary' : 'border-outline-variant'}`}>
                        {model === 'percentage' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                      </div>
                      <span className="font-display font-bold text-on-surface">25% del ahorro</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      El cliente paga el 25% del ahorro generado
                    </p>
                  </button>

                  {/* Cuota fija */}
                  <button
                    onClick={() => setModel('fixed')}
                    className={`p-4 rounded-2xl border-2 transition-all text-left ${
                      model === 'fixed'
                        ? 'border-primary bg-primary/5'
                        : 'border-surface-container-high bg-surface-container-lowest hover:border-outline-variant'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${model === 'fixed' ? 'border-primary' : 'border-outline-variant'}`}>
                        {model === 'fixed' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                      </div>
                      <span className="font-display font-bold text-on-surface">Cuota fija</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Cuota fija trimestral por plan
                    </p>
                  </button>
                </div>
              </div>

              {/* Percentage model options */}
              {model === 'percentage' && (
                <div className="space-y-4">
                  {/* Contract variant */}
                  <div>
                    <label className="block text-sm font-medium text-on-surface mb-2">
                      Modalidad de cobro
                    </label>
                    <div className="space-y-2">
                      {(['b1_directo', '25en4'] as ContractVariant[]).map((v) => (
                        <button
                          key={v}
                          onClick={() => setContractVariant(v)}
                          className={`w-full p-3 rounded-xl border-2 transition-all text-left ${
                            contractVariant === v
                              ? 'border-primary bg-primary/5'
                              : 'border-surface-container-high hover:border-outline-variant'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${contractVariant === v ? 'border-primary' : 'border-outline-variant'}`}>
                              {contractVariant === v && <div className="w-2 h-2 rounded-full bg-primary" />}
                            </div>
                            <span className="text-sm font-medium text-on-surface">
                              {CONTRACT_VARIANT_LABELS[v]}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Estimated savings */}
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Ahorro estimado anual (€)"
                      type="number"
                      value={estimatedSavings}
                      onChange={(e) => {
                        setEstimatedSavings(e.target.value)
                        setAnnualFee('')  // auto-calculate
                      }}
                      placeholder="5000"
                      hint="De la propuesta de ahorro energético"
                    />
                    <div>
                      <label className="block text-sm font-medium text-on-surface mb-1.5">
                        Honorarios anuales (€)
                      </label>
                      <div className={`flex items-center rounded-xl border px-3 h-10 text-sm ${
                        annualFee ? 'border-primary bg-primary/5' : 'border-surface-container-high bg-surface-container-lowest'
                      }`}>
                        <span className="text-on-surface-variant mr-2">25% =</span>
                        <input
                          type="number"
                          value={annualFee || calculatedFee || ''}
                          onChange={(e) => setAnnualFee(e.target.value)}
                          className="flex-1 bg-transparent outline-none text-on-surface font-medium"
                          placeholder={calculatedFee ? String(calculatedFee) : '0'}
                        />
                        <span className="text-on-surface-variant">€</span>
                      </div>
                      {calculatedFee > 0 && !annualFee && (
                        <p className="text-xs text-on-surface-variant mt-1">
                          Calculado automáticamente
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Fixed plan options */}
              {model === 'fixed' && (
                <div className="space-y-3">
                  <Select
                    label="Plan de suscripción"
                    value={planTier}
                    onChange={(e) => setPlanTier(e.target.value)}
                    options={PLAN_TIERS.map((t) => ({ value: t.value, label: t.label }))}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setPaymentMode('quarterly')}
                      className={`p-3 rounded-xl border-2 transition-all text-center ${paymentMode === 'quarterly' ? 'border-primary bg-primary/5' : 'border-surface-container-high'}`}
                    >
                      <p className="text-sm font-semibold text-on-surface">Trimestral</p>
                      <p className="text-lg font-display font-bold text-primary mt-1">{formatCurrency(quarterlyAmount)}</p>
                      <p className="text-xs text-on-surface-variant">/trimestre</p>
                    </button>
                    <button
                      onClick={() => setPaymentMode('annual')}
                      className={`p-3 rounded-xl border-2 transition-all text-center ${paymentMode === 'annual' ? 'border-primary bg-primary/5' : 'border-surface-container-high'}`}
                    >
                      <p className="text-sm font-semibold text-on-surface">Anual</p>
                      <p className="text-lg font-display font-bold text-primary mt-1">{formatCurrency(annualFixed)}</p>
                      <p className="text-xs text-on-surface-variant">/año (IVA inc.)</p>
                    </button>
                  </div>
                </div>
              )}

              {/* Representative fields for empresa */}
              {isEmpresa && (
                <div className="p-4 bg-surface-container-low rounded-2xl space-y-3">
                  <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Datos del representante legal
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Nombre del representante *"
                      value={repName}
                      onChange={(e) => setRepName(e.target.value)}
                      placeholder="Juan García López"
                    />
                    <Input
                      label="DNI del representante *"
                      value={repDni}
                      onChange={(e) => setRepDni(e.target.value)}
                      placeholder="12345678A"
                    />
                  </div>
                </div>
              )}

              {/* Signer + delivery */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                  Envío del contrato
                </p>

                {/* Delivery method */}
                <div>
                  <label className="block text-sm font-medium text-on-surface mb-2">
                    Método de envío
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['sms', 'email', 'both'] as DeliveryMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setDeliveryMethod(m)}
                        className={`p-2.5 rounded-xl border-2 transition-all flex flex-col items-center gap-1 text-center ${
                          deliveryMethod === m
                            ? 'border-primary bg-primary/5'
                            : 'border-surface-container-high hover:border-outline-variant'
                        }`}
                      >
                        {m === 'sms' && <Smartphone className="w-4 h-4 text-green-500" />}
                        {m === 'email' && <Mail className="w-4 h-4 text-blue-500" />}
                        {m === 'both' && <MessageSquare className="w-4 h-4 text-purple-500" />}
                        <span className="text-xs font-medium text-on-surface">{m === 'sms' ? 'SMS' : m === 'email' ? 'Email' : 'SMS + Email'}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={`Nombre del firmante`}
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Nombre completo"
                  />
                  <Input
                    label="Email del firmante *"
                    type="email"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                    placeholder="email@ejemplo.com"
                  />
                </div>

                {deliveryMethod !== 'email' && (
                  <Input
                    label={`Teléfono para SMS *`}
                    type="tel"
                    value={signerPhone}
                    onChange={(e) => setSignerPhone(e.target.value)}
                    placeholder="+34 612 345 678"
                    hint="Se enviará un SMS con el enlace para firmar"
                  />
                )}
              </div>

              {error && (
                <div className="p-3 bg-error-container/30 rounded-xl text-sm text-error font-medium">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button onClick={() => { if (canProceed()) setStep('review'); else setError('Completa todos los campos obligatorios') }} disabled={!selectedSupplyId}>
                  Revisar y enviar
                </Button>
              </div>
            </div>
          )}

          {/* ═══ STEP: REVIEW ═══ */}
          {step === 'review' && (
            <div className="space-y-5">
              <Card className="bg-surface-container-low/50">
                <h3 className="text-sm font-semibold text-on-surface mb-3">Resumen del contrato</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Cliente</span>
                    <span className="font-medium text-on-surface">{client.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">CIF/NIF</span>
                    <span className="font-medium text-on-surface">{client.cif || client.nif || '-'}</span>
                  </div>
                  {isEmpresa && (
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Representante</span>
                      <span className="font-medium text-on-surface">{repName} — {repDni}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Suministro</span>
                    <span className="font-mono font-medium text-on-surface">
                      {selectedSupply?.cups || 'Sin CUPS'} ({selectedSupply?.tariff || '-'})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Modelo</span>
                    <Badge variant="info">
                      {model === 'percentage'
                        ? `25% del ahorro — ${contractVariant === 'b1_directo' ? 'Pago único' : '50%+4 trim.'}`
                        : `Fijo — ${formatCurrency(parseFloat(planTier))}/trim`}
                    </Badge>
                  </div>
                  {model === 'percentage' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-on-surface-variant">Ahorro estimado</span>
                        <span className="font-medium text-on-surface">{formatCurrency(parsedSavings)}/año</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-on-surface-variant">Honorarios</span>
                        <span className="font-medium text-on-surface">{formatCurrency(effectiveAnnualFee)}/año</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Envío</span>
                    <span className="font-medium text-on-surface">
                      {deliveryMethod === 'sms' ? `SMS → ${signerPhone}` : deliveryMethod === 'email' ? `Email → ${signerEmail}` : `SMS + Email → ${signerPhone}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Firmante</span>
                    <span className="font-medium text-on-surface">{signerName}</span>
                  </div>
                </div>
              </Card>

              <Card className="bg-primary/5 border border-primary/20">
                <div className="flex items-start gap-3">
                  <DeliveryIcon className={`w-5 h-5 ${deliveryColor} flex-shrink-0 mt-0.5`} />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">
                      Se enviará por SignWell vía {DELIVERY_LABELS[deliveryMethod]}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      El contrato (+ propuesta) se generará con los datos del cliente y se enviará para firma digital.
                      Al firmarlo, se creará automáticamente el mandato SEPA en GoCardless para el cobro.
                    </p>
                  </div>
                </div>
              </Card>

              {error && (
                <div className="p-3 bg-error-container/30 rounded-xl text-sm text-error font-medium">
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="secondary" onClick={() => setStep('config')}>
                  Modificar
                </Button>
                <Button onClick={handleGenerateAndSend} loading={loading}>
                  <Send className="w-4 h-4" />
                  Generar y enviar
                </Button>
              </div>
            </div>
          )}

          {/* ═══ STEP: SENDING ═══ */}
          {step === 'sending' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-display font-semibold text-on-surface">Generando contrato...</p>
                <p className="text-sm text-on-surface-variant mt-1">
                  Rellenando plantilla y enviando por SignWell
                </p>
              </div>
            </div>
          )}

          {/* ═══ STEP: DONE ═══ */}
          {step === 'done' && result && (
            <div className="flex flex-col items-center justify-center py-8 gap-5">
              <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <div className="text-center">
                <p className="font-display font-bold text-lg text-on-surface">
                  Contrato enviado
                </p>
                <p className="text-sm text-on-surface-variant mt-2">
                  {result.deliveryMethod === 'sms'
                    ? `SMS enviado a ${signerPhone} con el enlace de firma.`
                    : result.deliveryMethod === 'email'
                    ? `Email enviado a ${signerEmail} para firma.`
                    : `SMS y email enviados. Enlace de firma enviado a ${signerPhone}.`}
                </p>
                <p className="text-xs text-on-surface-variant mt-2">
                  Al firmar, se creará el mandato SEPA y el cobro quedará automatizado.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => { onCreated(); onClose() }}>
                  Cerrar
                </Button>
                <Button onClick={() => { onCreated(); onClose() }}>
                  Volver al cliente
                </Button>
              </div>
            </div>
          )}

        </div>
      </motion.div>
    </div>
  )
}
