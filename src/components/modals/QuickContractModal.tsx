'use client'

import { useState, useEffect } from 'react'
import { X, FileText, CreditCard, Send, CheckCircle2, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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
type Step = 'config' | 'review' | 'sending' | 'done'

const PLAN_TIERS = [
  { value: '19.99', label: 'Basico — 19,99€/trimestre', price: 19.99 },
  { value: '45', label: 'Profesional — 45€/trimestre', price: 45 },
  { value: '90', label: 'Empresarial — 90€/trimestre', price: 90 },
  { value: '180', label: 'Premium — 180€/trimestre', price: 180 },
]

export function QuickContractModal({ open, onClose, onCreated, client }: Props) {
  const { user } = useAuthStore()
  const [step, setStep] = useState<Step>('config')
  const [model, setModel] = useState<SubscriptionModel>('percentage')
  const [planTier, setPlanTier] = useState('45')
  const [percentageValue, setPercentageValue] = useState('25')
  const [paymentMode, setPaymentMode] = useState<'quarterly' | 'annual'>('quarterly')
  const [selectedSupplyId, setSelectedSupplyId] = useState('')
  const [signerEmail, setSignerEmail] = useState(client?.email || '')
  const [signerName, setSignerName] = useState(client?.name || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setStep('config')
      setSignerEmail(client?.email || '')
      setSignerName(client?.name || '')
      setError('')
      setResult(null)
      // Auto-select first supply if only one
      if (client?.supplies?.length === 1) {
        setSelectedSupplyId(client.supplies[0].id)
      }
    }
  }, [open, client])

  // Price calculations
  const selectedTier = PLAN_TIERS.find((t) => t.value === planTier)
  const quarterlyAmount = model === 'fixed' ? (selectedTier?.price || 0) : 0
  const annualAmount = quarterlyAmount * 4 * 1.21

  const handleGenerateAndSend = async () => {
    if (!selectedSupplyId) {
      setError('Selecciona un suministro')
      return
    }
    if (!signerEmail) {
      setError('El email del firmante es obligatorio')
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
          percentage_value: model === 'percentage' ? parseFloat(percentageValue) : null,
          payment_mode: paymentMode === 'annual' ? 'immediate' : 'quarterly',
          annual_amount: paymentMode === 'annual' ? annualAmount : null,
          status: 'pending_activation',
          start_date: new Date().toISOString(),
        })
        .select()
        .single()

      if (subErr) throw subErr

      // 3. Send to DocuSign via API route
      const response = await fetch('/api/docusign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: contract.id,
          clientId: client.id,
          subscriptionId: subscription.id,
          signerEmail,
          signerName,
          subscriptionModel: model,
          planTier: model === 'fixed' ? parseFloat(planTier) : null,
          percentageValue: model === 'percentage' ? parseFloat(percentageValue) : null,
          paymentMode,
          clientCif: client.cif || client.cif_nif,
          clientIban: client.iban,
        }),
      })

      const resData = await response.json()

      if (!response.ok) {
        // If DocuSign not configured, still mark contract as sent (manual mode)
        if (resData.mode === 'manual') {
          await supabase
            .from('contracts')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', contract.id)

          setResult({
            contractId: contract.id,
            subscriptionId: subscription.id,
            mode: 'manual',
            message: resData.message,
          })
          setStep('done')
          return
        }
        throw new Error(resData.error || 'Error enviando a DocuSign')
      }

      // Update contract with DocuSign envelope ID
      await supabase
        .from('contracts')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          docusign_envelope_id: resData.envelopeId,
        })
        .eq('id', contract.id)

      setResult({
        contractId: contract.id,
        subscriptionId: subscription.id,
        envelopeId: resData.envelopeId,
        mode: 'docusign',
      })
      setStep('done')
    } catch (err: any) {
      console.error('Contract generation error:', err)
      setError(err.message || 'Error generando contrato')
      setStep('review')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

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
              {client.name} — Contrato + Suscripcion + DocuSign
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
                  Modelo de suscripcion
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setModel('percentage')}
                    className={`p-4 rounded-2xl border-2 transition-all text-left ${
                      model === 'percentage'
                        ? 'border-primary bg-primary/5'
                        : 'border-surface-container-high bg-surface-container-lowest hover:border-outline-variant'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        model === 'percentage' ? 'border-primary' : 'border-outline-variant'
                      }`}>
                        {model === 'percentage' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                      </div>
                      <span className="font-display font-bold text-on-surface">25% del ahorro</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      El cliente paga el 25% del ahorro generado cada trimestre
                    </p>
                  </button>

                  <button
                    onClick={() => setModel('fixed')}
                    className={`p-4 rounded-2xl border-2 transition-all text-left ${
                      model === 'fixed'
                        ? 'border-primary bg-primary/5'
                        : 'border-surface-container-high bg-surface-container-lowest hover:border-outline-variant'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        model === 'fixed' ? 'border-primary' : 'border-outline-variant'
                      }`}>
                        {model === 'fixed' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                      </div>
                      <span className="font-display font-bold text-on-surface">Suscripcion fija</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Cuota fija trimestral segun plan elegido
                    </p>
                  </button>
                </div>
              </div>

              {/* Plan tier (only for fixed) */}
              {model === 'fixed' && (
                <div className="space-y-3">
                  <Select
                    label="Plan de suscripcion"
                    value={planTier}
                    onChange={(e) => setPlanTier(e.target.value)}
                    options={PLAN_TIERS.map((t) => ({ value: t.value, label: t.label }))}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setPaymentMode('quarterly')}
                      className={`p-3 rounded-xl border-2 transition-all text-center ${
                        paymentMode === 'quarterly'
                          ? 'border-primary bg-primary/5'
                          : 'border-surface-container-high'
                      }`}
                    >
                      <p className="text-sm font-semibold text-on-surface">Trimestral</p>
                      <p className="text-lg font-display font-bold text-primary mt-1">
                        {formatCurrency(quarterlyAmount)}
                      </p>
                      <p className="text-xs text-on-surface-variant">/trimestre</p>
                    </button>
                    <button
                      onClick={() => setPaymentMode('annual')}
                      className={`p-3 rounded-xl border-2 transition-all text-center ${
                        paymentMode === 'annual'
                          ? 'border-primary bg-primary/5'
                          : 'border-surface-container-high'
                      }`}
                    >
                      <p className="text-sm font-semibold text-on-surface">Anual</p>
                      <p className="text-lg font-display font-bold text-primary mt-1">
                        {formatCurrency(annualAmount)}
                      </p>
                      <p className="text-xs text-on-surface-variant">/año (IVA inc.)</p>
                    </button>
                  </div>
                </div>
              )}

              {/* Percentage value (only for percentage model) */}
              {model === 'percentage' && (
                <Input
                  label="Porcentaje del ahorro (%)"
                  type="number"
                  value={percentageValue}
                  onChange={(e) => setPercentageValue(e.target.value)}
                  min="1"
                  max="100"
                  hint="Normalmente 25%. El cobro se realiza trimestralmente."
                />
              )}

              {/* Signer info */}
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Nombre del firmante"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Nombre completo"
                />
                <Input
                  label="Email del firmante"
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  placeholder="email@ejemplo.com"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button
                  onClick={() => setStep('review')}
                  disabled={!selectedSupplyId || !signerEmail}
                >
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
                    <span className="font-medium text-on-surface">{client.cif || client.nif || client.cif_nif || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Suministro</span>
                    <span className="font-mono font-medium text-on-surface">
                      {client.supplies?.find((s: any) => s.id === selectedSupplyId)?.cups || 'Sin CUPS'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Modelo</span>
                    <Badge variant="info">
                      {model === 'percentage' ? `${percentageValue}% del ahorro` : `Fijo — ${formatCurrency(parseFloat(planTier))}/trim`}
                    </Badge>
                  </div>
                  {model === 'fixed' && (
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Pago</span>
                      <span className="font-medium text-on-surface">
                        {paymentMode === 'quarterly' ? 'Trimestral' : `Anual (${formatCurrency(annualAmount)})`}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Firmante</span>
                    <span className="font-medium text-on-surface">{signerName} ({signerEmail})</span>
                  </div>
                </div>
              </Card>

              <Card className="bg-primary/5 border border-primary/20">
                <div className="flex items-start gap-3">
                  <Send className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">Se enviara por DocuSign</p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      El contrato se generara automaticamente y se enviara al email del firmante para su firma digital.
                      Tras la firma, se creara automaticamente el mandato SEPA con GoCardless para la domiciliacion bancaria.
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
                  Generar y enviar contrato
                </Button>
              </div>
            </div>
          )}

          {/* ═══ STEP: SENDING ═══ */}
          {step === 'sending' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              </div>
              <div className="text-center">
                <p className="font-display font-semibold text-on-surface">Generando contrato...</p>
                <p className="text-sm text-on-surface-variant mt-1">
                  Creando contrato, suscripcion y enviando a DocuSign
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
                  Contrato generado correctamente
                </p>
                {result.mode === 'docusign' ? (
                  <p className="text-sm text-on-surface-variant mt-2">
                    El contrato ha sido enviado a <strong>{signerEmail}</strong> via DocuSign.
                    Recibiras una notificacion cuando sea firmado.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-on-surface-variant">
                      {result.message || 'DocuSign no esta configurado. El contrato se ha creado en modo manual.'}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Configura las API keys de DocuSign en Ajustes para envio automatico.
                    </p>
                  </div>
                )}
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
