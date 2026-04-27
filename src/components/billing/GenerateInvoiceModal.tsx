'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Trash2, Eye, Send, FileText, Loader2, CheckCircle, ChevronLeft } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format'

interface InvoiceLine {
  concept: string
  amount: string
}

interface Props {
  onClose: () => void
  onCreated: () => void
  preselectedClientId?: string
  preselectedSubscriptionId?: string
}

type Step = 'form' | 'preview' | 'done'

function fmtEur(n: number) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

export function GenerateInvoiceModal({ onClose, onCreated, preselectedClientId, preselectedSubscriptionId }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [clients, setClients] = useState<any[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ billing_id: string; invoice_number: string; pdf_url: string; total_amount: number } | null>(null)
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [selectedClient, setSelectedClient] = useState<any>(null)

  const [form, setForm] = useState({
    client_id: preselectedClientId || '',
    subscription_id: preselectedSubscriptionId || '',
    due_date: (() => {
      const d = new Date(); d.setDate(d.getDate() + 30)
      return d.toISOString().split('T')[0]
    })(),
  })

  const [lines, setLines] = useState<InvoiceLine[]>([
    { concept: 'Honorarios de consultoría energética', amount: '' },
  ])

  // Fetch clients
  useEffect(() => {
    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, name, cif_nif, email, fiscal_address')
        .order('name')
      setClients(data || [])
      setLoadingClients(false)
    }
    fetchClients()
  }, [])

  // Preload client if provided
  useEffect(() => {
    if (preselectedClientId && clients.length > 0) {
      const c = clients.find((cl) => cl.id === preselectedClientId)
      if (c) {
        setSelectedClient(c)
        setClientSearch(c.name)
      }
    }
  }, [preselectedClientId, clients])

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.cif_nif || '').toLowerCase().includes(clientSearch.toLowerCase())
  ).slice(0, 8)

  const baseAmount = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const vatAmount = Math.round(baseAmount * 0.21 * 100) / 100
  const totalAmount = baseAmount + vatAmount

  const addLine = () => setLines((prev) => [...prev, { concept: '', amount: '' }])
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))
  const updateLine = (i: number, field: keyof InvoiceLine, value: string) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))

  const canPreview = selectedClient && lines.every((l) => l.concept && l.amount) && baseAmount > 0

  // ── Generate PDF (no email) ──
  const handleGenerate = async (sendEmail: boolean) => {
    if (!canPreview) return
    setGenerating(true)
    try {
      const res = await fetch('/api/billing/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selectedClient.id,
          subscription_id: form.subscription_id || undefined,
          lines: lines.map((l) => ({ concept: l.concept, amount: parseFloat(l.amount) })),
          base_amount: baseAmount,
          due_date: form.due_date,
          send_email: sendEmail,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error generando factura')
      setResult(data)
      setStep('done')
      onCreated()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setGenerating(false)
    }
  }

  // ── Resend email for existing invoice ──
  const handleResend = async () => {
    if (!result) return
    setSending(true)
    try {
      await fetch('/api/billing/generate-invoice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_id: result.billing_id }),
      })
      alert('✅ Factura enviada correctamente')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSending(false)
    }
  }

  // ── Invoice HTML preview ──
  const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const dueFormatted = form.due_date
    ? new Date(form.due_date + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        className="bg-bg rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] overflow-hidden flex flex-col"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line/60">
          <div className="flex items-center gap-3">
            {step === 'preview' && (
              <button onClick={() => setStep('form')} className="p-1.5 rounded-lg hover:bg-bg-2 transition">
                <ChevronLeft className="w-4 h-4 text-ink-3" />
              </button>
            )}
            <FileText className="w-5 h-5 text-brand" />
            <div>
              <h2 className="font-semibold text-ink text-base">
                {step === 'form' ? 'Nueva factura' : step === 'preview' ? 'Vista previa' : '✅ Factura generada'}
              </h2>
              <p className="text-xs text-ink-3">
                {step === 'form' ? 'Completa los datos del cliente y el concepto' :
                 step === 'preview' ? 'Revisa la factura antes de enviar' :
                 `Nº ${result?.invoice_number}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-2 transition">
            <X className="w-5 h-5 text-ink-3" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {/* ══════════ STEP 1: FORM ══════════ */}
            {step === 'form' && (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-6 space-y-5"
              >
                {/* Client selector */}
                <div>
                  <label className="block text-xs font-semibold text-ink-3 uppercase tracking-wider mb-1.5">Cliente *</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={clientSearch}
                      onChange={(e) => {
                        setClientSearch(e.target.value)
                        setShowClientDropdown(true)
                        if (!e.target.value) setSelectedClient(null)
                      }}
                      onFocus={() => setShowClientDropdown(true)}
                      placeholder="Buscar cliente por nombre o CIF..."
                      className="w-full px-3 py-2.5 bg-bg-2 rounded-xl text-sm text-ink border border-line/40 focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                    {selectedClient && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <CheckCircle className="w-4 h-4 text-ok" />
                      </div>
                    )}
                    {showClientDropdown && clientSearch && filteredClients.length > 0 && (
                      <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-bg border border-line/60 rounded-xl shadow-lg overflow-hidden">
                        {filteredClients.map((c) => (
                          <button
                            key={c.id}
                            onMouseDown={() => {
                              setSelectedClient(c)
                              setClientSearch(c.name)
                              setShowClientDropdown(false)
                              setForm((f) => ({ ...f, client_id: c.id }))
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-bg-2 transition"
                          >
                            <p className="text-sm font-medium text-ink">{c.name}</p>
                            <p className="text-xs text-ink-3">{c.cif_nif || 'Sin CIF'} · {c.email || 'Sin email'}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedClient?.email === null && (
                    <p className="mt-1 text-xs text-warn">⚠️ Este cliente no tiene email registrado — no se podrá enviar por correo</p>
                  )}
                </div>

                {/* Invoice lines */}
                <div>
                  <label className="block text-xs font-semibold text-ink-3 uppercase tracking-wider mb-1.5">Conceptos *</label>
                  <div className="space-y-2">
                    {lines.map((line, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={line.concept}
                          onChange={(e) => updateLine(i, 'concept', e.target.value)}
                          placeholder="Descripción del concepto..."
                          className="flex-1 px-3 py-2 bg-bg-2 rounded-xl text-sm text-ink border border-line/40 focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                        <input
                          type="number"
                          value={line.amount}
                          onChange={(e) => updateLine(i, 'amount', e.target.value)}
                          placeholder="Importe €"
                          step="0.01"
                          min="0"
                          className="w-28 px-3 py-2 bg-bg-2 rounded-xl text-sm text-ink border border-line/40 focus:outline-none focus:ring-2 focus:ring-brand/30 text-right"
                        />
                        {lines.length > 1 && (
                          <button
                            onClick={() => removeLine(i)}
                            className="p-2 rounded-xl text-err hover:bg-err-container/30 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addLine}
                    className="mt-2 flex items-center gap-1.5 text-xs text-brand hover:text-brand/80 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Añadir línea
                  </button>
                </div>

                {/* Due date */}
                <div>
                  <label className="block text-xs font-semibold text-ink-3 uppercase tracking-wider mb-1.5">Fecha de vencimiento</label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                    className="px-3 py-2 bg-bg-2 rounded-xl text-sm text-ink border border-line/40 focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>

                {/* Totals summary */}
                {baseAmount > 0 && (
                  <div className="bg-bg-2 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-3">Base imponible</span>
                      <span className="text-ink">{fmtEur(baseAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-3">IVA 21%</span>
                      <span className="text-ink">{fmtEur(vatAmount)}</span>
                    </div>
                    <div className="border-t border-line/40 pt-2 flex justify-between">
                      <span className="font-semibold text-ink">Total</span>
                      <span className="font-bold text-ink text-base">{fmtEur(totalAmount)}</span>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={onClose}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-ink-3 bg-bg-2 hover:bg-bg-2/70 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => setStep('preview')}
                    disabled={!canPreview}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-brand text-white hover:bg-brand/90 transition disabled:opacity-40"
                  >
                    <Eye className="w-4 h-4" />
                    Vista previa
                  </button>
                </div>
              </motion.div>
            )}

            {/* ══════════ STEP 2: PREVIEW ══════════ */}
            {step === 'preview' && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="p-6"
              >
                {/* Invoice HTML preview */}
                <div className="bg-white rounded-2xl border border-line/30 overflow-hidden shadow-sm mb-6">
                  <InvoicePreview
                    client={selectedClient}
                    lines={lines}
                    invoiceDate={today}
                    dueDate={dueFormatted}
                    baseAmount={baseAmount}
                    vatAmount={vatAmount}
                    totalAmount={totalAmount}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => handleGenerate(false)}
                    disabled={generating}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold border border-line/60 text-ink hover:bg-bg-2 transition disabled:opacity-40"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Solo guardar PDF
                  </button>
                  <button
                    onClick={() => handleGenerate(true)}
                    disabled={generating || !selectedClient?.email}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-brand text-white hover:bg-brand/90 transition disabled:opacity-40"
                    title={!selectedClient?.email ? 'El cliente no tiene email' : undefined}
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Generar y enviar por email
                  </button>
                </div>
              </motion.div>
            )}

            {/* ══════════ STEP 3: DONE ══════════ */}
            {step === 'done' && result && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-8 flex flex-col items-center text-center"
              >
                <div className="w-16 h-16 rounded-2xl bg-ok-container/40 flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-ok" />
                </div>
                <h3 className="text-xl font-bold text-ink mb-1">Factura generada</h3>
                <p className="text-ink-3 text-sm mb-1">Nº {result.invoice_number}</p>
                <p className="text-ink font-semibold text-lg mb-6">{fmtEur(result.total_amount)}</p>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                  <a
                    href={result.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-line/60 text-ink hover:bg-bg-2 transition"
                  >
                    <FileText className="w-4 h-4" />
                    Ver PDF
                  </a>
                  {selectedClient?.email && (
                    <button
                      onClick={handleResend}
                      disabled={sending}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-brand text-white hover:bg-brand/90 transition disabled:opacity-40"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Reenviar email
                    </button>
                  )}
                </div>
                <button onClick={onClose} className="mt-4 text-sm text-ink-3 hover:text-ink transition">
                  Cerrar
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

// ── Invoice HTML preview component ──
function InvoicePreview({
  client,
  lines,
  invoiceDate,
  dueDate,
  baseAmount,
  vatAmount,
  totalAmount,
}: {
  client: any
  lines: InvoiceLine[]
  invoiceDate: string
  dueDate?: string
  baseAmount: number
  vatAmount: number
  totalAmount: number
}) {
  const today = new Date()
  const year = today.getFullYear()
  const yearShort = String(year).slice(-2)
  const invoiceNumPreview = `XX/${yearShort}`

  const fmtEur = (n: number) =>
    n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

  return (
    <div style={{ padding: '32px', fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#1a1a2e', lineHeight: 1.5 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#1a3a6b', marginBottom: '2px' }}>Voltis</div>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#2563eb', marginBottom: '12px' }}>energía</div>
          <div style={{ fontSize: '10px', fontWeight: '700', color: '#1a3a6b', marginBottom: '2px' }}>VOLTIS SOLUCIONES S.L.</div>
          <div style={{ fontSize: '9px', color: '#666' }}>B-71548705</div>
          <div style={{ fontSize: '9px', color: '#666' }}>Calle Berriobide 38, Oficina 209</div>
          <div style={{ fontSize: '9px', color: '#666' }}>31013 ANSOÁIN/ANTSOAIN</div>
          <div style={{ fontSize: '9px', color: '#666' }}>654 054 822</div>
          <div style={{ fontSize: '9px', color: '#666' }}>facturacion@voltisenergia.com</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '8px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Facturar a</div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#1a1a2e' }}>{client?.name || '—'}</div>
          {client?.cif_nif && <div style={{ fontSize: '9px', color: '#555' }}>{client.cif_nif}</div>}
          {client?.fiscal_address && <div style={{ fontSize: '9px', color: '#555' }}>{client.fiscal_address}</div>}
          {client?.email && <div style={{ fontSize: '9px', color: '#555' }}>{client.email}</div>}
        </div>
      </div>

      {/* Blue divider */}
      <div style={{ height: '2px', backgroundColor: '#1a3a6b', marginBottom: '12px' }} />

      {/* Meta row */}
      <div style={{ display: 'flex', gap: '32px', marginBottom: '16px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '8px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Núm. Factura</div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a3a6b' }}>{invoiceNumPreview}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '8px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Fecha</div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a3a6b' }}>{invoiceDate}</div>
        </div>
        {dueDate && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '8px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vencimiento</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a3a6b' }}>{dueDate}</div>
          </div>
        )}
      </div>

      {/* Title */}
      <div style={{ textAlign: 'center', fontSize: '15px', fontWeight: '700', color: '#1a3a6b', letterSpacing: '0.5px', marginBottom: '16px', textTransform: 'uppercase' }}>
        Minuta de Honorarios
      </div>

      {/* Concept table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px' }}>
        <thead>
          <tr style={{ backgroundColor: '#1a3a6b' }}>
            <th style={{ padding: '7px 12px', color: '#fff', fontSize: '8px', fontWeight: '700', textTransform: 'uppercase', textAlign: 'left' }}>Concepto</th>
            <th style={{ padding: '7px 12px', color: '#fff', fontSize: '8px', fontWeight: '700', textTransform: 'uppercase', textAlign: 'right', width: '100px' }}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {lines.filter((l) => l.concept).map((line, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 1 ? '#f8f9fc' : '#fff', borderBottom: '0.5px solid #eee' }}>
              <td style={{ padding: '9px 12px', fontSize: '10px', color: '#333' }}>{line.concept || '—'}</td>
              <td style={{ padding: '9px 12px', fontSize: '10px', color: '#333', textAlign: 'right' }}>
                {line.amount ? fmtEur(parseFloat(line.amount)) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ marginLeft: 'auto', width: '220px' }}>
        <div style={{ height: '0.5px', backgroundColor: '#ddd', marginBottom: '6px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: '10px' }}>
          <span style={{ color: '#666' }}>Base Imponible</span>
          <span style={{ color: '#333' }}>{fmtEur(baseAmount)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: '10px' }}>
          <span style={{ color: '#666' }}>IVA 21%</span>
          <span style={{ color: '#333' }}>{fmtEur(vatAmount)}</span>
        </div>
        <div style={{ height: '0.5px', backgroundColor: '#ddd', margin: '6px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#1a3a6b', padding: '8px', borderRadius: '4px' }}>
          <span style={{ color: '#fff', fontSize: '11px', fontWeight: '700' }}>TOTAL FACTURA</span>
          <span style={{ color: '#fff', fontSize: '11px', fontWeight: '700' }}>{fmtEur(totalAmount)}</span>
        </div>
      </div>

      {/* IBAN */}
      <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#f0f4ff', borderRadius: '6px', textAlign: 'center' }}>
        <div style={{ fontSize: '8px', color: '#888', marginBottom: '2px' }}>Ingresar en:</div>
        <div style={{ fontSize: '10px', fontWeight: '700', color: '#1a3a6b', letterSpacing: '1px' }}>ES19 0182 5000 8402 0187 5295</div>
      </div>
    </div>
  )
}
