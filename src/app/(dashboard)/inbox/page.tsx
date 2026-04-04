'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Upload, Check, AlertCircle, Loader2, CheckCircle,
  X, Zap, FileText, User, ArrowRight, Clipboard,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { normalizeCups } from '@/lib/utils/cups'

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'client' | 'invoices' | 'analyzing' | 'review' | 'submitting' | 'success'

interface UploadFile {
  id: string
  file: File
  status: 'pending' | 'analyzing' | 'success' | 'error'
  extractedData?: any
  error?: string
}

interface ClientOption {
  id: string
  name: string
  type: string
  cif_nif?: string | null
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function InboxPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const [supabase] = useState(() => createClient())

  // Flow state
  const [step, setStep] = useState<Step>('client')

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null)
  const [creatingNewClient, setCreatingNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const clientInputRef = useRef<HTMLInputElement>(null)

  // Invoice files
  const [files, setFiles] = useState<UploadFile[]>([])
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  // Review / extracted
  const [extractedCups, setExtractedCups] = useState<string | null>(null)
  const [extractedTariff, setExtractedTariff] = useState<string | null>(null)
  const [extractedAddress, setExtractedAddress] = useState<string | null>(null)
  const [extractedHolder, setExtractedHolder] = useState<string | null>(null)
  const [existingSupply, setExistingSupply] = useState<any>(null)

  // Result
  const [successSupplyId, setSuccessSupplyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Load clients ──
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, type, cif_nif')
        .order('name')
      setClients(data || [])
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Filtered clients ──
  const filteredClients = clientSearch.trim()
    ? clients.filter(c => {
        const q = clientSearch.toLowerCase()
        return c.name.toLowerCase().includes(q) || (c.cif_nif || '').toLowerCase().includes(q)
      })
    : []

  const showNewClientButton = clientSearch.trim().length >= 2 && filteredClients.length === 0

  // ── Select client ──
  const handleSelectClient = (client: ClientOption) => {
    setSelectedClient(client)
    setClientSearch('')
    setCreatingNewClient(false)
    setStep('invoices')
  }

  // ── Create new client ──
  const handleCreateClient = async () => {
    if (!newClientName.trim() || !user?.id) return
    setCreatingNewClient(true)
    try {
      const { data } = await supabase
        .from('clients')
        .insert({
          name: newClientName.trim(),
          type: 'empresa',
          commercial_id: user.id,
          origin: 'captacion',
          marketing_consent: false,
        })
        .select('id, name, type, cif_nif')
        .single()
      if (data) {
        setClients(prev => [data, ...prev])
        setSelectedClient(data)
        setNewClientName('')
        setStep('invoices')
      }
    } catch (err) {
      console.error('Error creating client:', err)
    } finally {
      setCreatingNewClient(false)
    }
  }

  // ── File handling ──
  const addFiles = (fileList: File[]) => {
    const valid = fileList.filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'))
    if (!valid.length) return
    const newFiles: UploadFile[] = valid.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      status: 'pending',
    }))
    setFiles(prev => [...prev, ...newFiles])
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  // ── Paste handler ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (step !== 'invoices') return
      const items = e.clipboardData?.items
      if (!items) return
      const pastedFiles: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) pastedFiles.push(file)
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault()
        addFiles(pastedFiles)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [step])

  // ── Drag & drop ──
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    const droppedFiles = Array.from(e.dataTransfer.files)
    addFiles(droppedFiles)
  }

  // ── Read file as base64 ──
  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  // ── Analyze all files ──
  const startAnalysis = async () => {
    if (files.length === 0) return
    setStep('analyzing')
    setError(null)
    setScanProgress({ done: 0, total: files.length })

    let firstData: any = null

    // Analyze first file immediately
    const first = files[0]
    setFiles(prev => prev.map(f => f.id === first.id ? { ...f, status: 'analyzing' } : f))
    try {
      const b64 = await readFileAsBase64(first.file)
      const res = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_base64: b64,
          file_type: first.file.type.startsWith('image') ? 'image' : 'pdf',
          file_name: first.file.name,
        }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      firstData = await res.json()
      setFiles(prev => prev.map(f => f.id === first.id ? { ...f, status: 'success', extractedData: firstData } : f))
    } catch {
      setFiles(prev => prev.map(f => f.id === first.id ? { ...f, status: 'error', error: 'Error al analizar' } : f))
    }
    setScanProgress({ done: 1, total: files.length })

    // Analyze rest in parallel batches of 3
    const rest = files.slice(1)
    for (let i = 0; i < rest.length; i += 3) {
      const batch = rest.slice(i, i + 3)
      await Promise.allSettled(batch.map(async (uf) => {
        setFiles(prev => prev.map(f => f.id === uf.id ? { ...f, status: 'analyzing' } : f))
        try {
          const b64 = await readFileAsBase64(uf.file)
          const res = await fetch('/api/analyze-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file_base64: b64,
              file_type: uf.file.type.startsWith('image') ? 'image' : 'pdf',
              file_name: uf.file.name,
            }),
          })
          if (!res.ok) throw new Error()
          const data = await res.json()
          setFiles(prev => prev.map(f => f.id === uf.id ? { ...f, status: 'success', extractedData: data } : f))
        } catch {
          setFiles(prev => prev.map(f => f.id === uf.id ? { ...f, status: 'error', error: 'Error' } : f))
        }
      }))
      setScanProgress(prev => ({ ...prev, done: Math.min(prev.done + batch.length, files.length) }))
    }

    // Build review from first analyzed data
    const cups = firstData?.cups ? normalizeCups(firstData.cups) : null
    setExtractedCups(cups || null)
    setExtractedTariff(firstData?.tariff || firstData?.economics?.tarifa || null)
    setExtractedAddress(firstData?.supply_address || firstData?.billing_address || null)
    setExtractedHolder(firstData?.holder_name || firstData?.economics?.titular || null)

    // Check if CUPS already exists
    if (cups) {
      try {
        const checkRes = await fetch('/api/check-cups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cups }),
        })
        const checkData = await checkRes.json()
        if (checkData.exists && checkData.supplies?.length > 0) {
          setExistingSupply(checkData.supplies[0])
        }
      } catch {}
    }

    setStep('review')
  }

  // ── Submit: create supply + upload invoices ──
  const submitSupply = async () => {
    if (!selectedClient || !user?.id) return
    setStep('submitting')
    setError(null)

    try {
      const clientId = selectedClient.id
      const normalizedCups = extractedCups ? normalizeCups(extractedCups) : null

      // If CUPS exists, add invoices to existing supply
      if (existingSupply) {
        for (const uf of files.filter(f => f.status === 'success')) {
          const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const path = `invoices/${user.id}/${uid}-${uf.file.name}`
          const { error: upErr } = await supabase.storage.from('documents').upload(path, uf.file)
          if (upErr) { console.error(upErr); continue }
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
          await supabase.from('invoices').insert({
            supply_id: existingSupply.id,
            file_url: urlData.publicUrl,
            file_type: uf.file.type.startsWith('image') ? 'image' : 'pdf',
            extraction_status: 'completed',
            extracted_data: uf.extractedData,
          })
        }
        setSuccessSupplyId(existingSupply.id)
        setStep('success')
        return
      }

      // Create new supply
      const { data: supply, error: supplyErr } = await supabase
        .from('supplies')
        .insert({
          client_id: clientId,
          cups: normalizedCups,
          type: 'luz',
          tariff: extractedTariff || '',
          address: extractedAddress || '',
          status: 'estudio_en_curso',
        })
        .select('id')
        .single()

      if (supplyErr || !supply) throw new Error(supplyErr?.message || 'Error creando suministro')

      // Upload all successful files
      for (const uf of files.filter(f => f.status === 'success')) {
        const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const path = `invoices/${user.id}/${uid}-${uf.file.name}`
        const { error: upErr } = await supabase.storage.from('documents').upload(path, uf.file)
        if (upErr) { console.error(upErr); continue }
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
        await supabase.from('invoices').insert({
          supply_id: supply.id,
          file_url: urlData.publicUrl,
          file_type: uf.file.type.startsWith('image') ? 'image' : 'pdf',
          extraction_status: 'completed',
          extracted_data: uf.extractedData,
        })
      }

      // Create prescoring — only for tariffs that need it (skip 2.0 tariffs)
      const tariffNorm = (extractedTariff || '').replace(/\s+/g, '').toUpperCase()
      const needsPrescoring = !tariffNorm.startsWith('2.0') && tariffNorm !== '20TD' && tariffNorm !== '20' && tariffNorm !== '202020' && tariffNorm !== '2.0DHA' && tariffNorm !== '20DHA'
      if (needsPrescoring) {
        await supabase.from('prescorings').insert({
          supply_id: supply.id,
          client_name: extractedHolder || selectedClient.name,
          cups: normalizedCups,
          tariff: extractedTariff,
          status: 'pending',
          requested_by: user.id,
        })
      }

      // Background: fetch SIPS + power study
      if (normalizedCups) {
        fetchSipsBackground(supply.id, normalizedCups, clientId, extractedHolder || selectedClient.name)
      }

      setSuccessSupplyId(supply.id)
      setStep('success')
    } catch (err: any) {
      setError(err.message || 'Error al crear suministro')
      setStep('review')
    }
  }

  // ── Background SIPS fetch ──
  const fetchSipsBackground = async (supplyId: string, cups: string, clientId: string, holderName: string) => {
    try {
      const sipsRes = await fetch('/api/sips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups }),
      })
      const sipsResult = await sipsRes.json()
      if (!sipsResult.success || !sipsResult.data) return
      const d = sipsResult.data

      await supabase.from('supplies').update({
        consumption_data: {
          source: 'greening_sips', fetched_at: new Date().toISOString(),
          total: d.totalConsumption, totalKwh: d.totalConsumptionKwh,
          sips_tariff: d.tariff, consumoPeriodos: d.consumoPeriodos,
          potenciaContratada: d.potenciaContratada,
          history: (d.consumptionHistory || []).map((h: any) => ({
            fecha: h.fecha, P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6, total: h.total,
          })),
          maximetroHistory: (d.maximetroHistory || []).map((h: any) => ({
            fecha: h.fecha, P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
          })),
          distribuidora: d.distribuidora, codigoPostal: d.codigoPostal,
          provincia: d.provincia, municipio: d.municipio, cnae: d.cnae,
          tension: d.tension, fechaAlta: d.fechaAlta, fechaUltimaLectura: d.fechaUltimaLectura,
        },
        ...(d.tariff ? { tariff: d.tariff } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', supplyId)

      if (d.consumptionHistory?.length > 0 && d.potenciaContratada) {
        const studyRes = await fetch('/api/power-study-auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cups, clientName: holderName, potenciaContratada: d.potenciaContratada,
            consumptionHistory: d.consumptionHistory, maximetroHistory: d.maximetroHistory || [],
          }),
        })
        if (studyRes.ok) {
          const studyResult = await studyRes.json()
          await supabase.from('supplies').update({ power_study_result: studyResult }).eq('id', supplyId)
        }
      }
    } catch (err) {
      console.error('[Inbox] Background SIPS error:', err)
    }
  }

  // ── Reset ──
  const reset = () => {
    setStep('client')
    setSelectedClient(null)
    setClientSearch('')
    setNewClientName('')
    setFiles([])
    setExtractedCups(null)
    setExtractedTariff(null)
    setExtractedAddress(null)
    setExtractedHolder(null)
    setExistingSupply(null)
    setSuccessSupplyId(null)
    setError(null)
  }

  const successCount = files.filter(f => f.status === 'success').length

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-surface">
      <Header title="Agregar Suministro" subtitle="Crea un suministro con sus facturas" />

      <div className="px-4 lg:px-8 py-6 max-w-xl mx-auto">

        {/* ── Step indicator ── */}
        <div className="flex items-center gap-2 mb-8">
          {['Cliente', 'Facturas', 'Revisar'].map((label, i) => {
            const stepIdx = i === 0 ? 'client' : i === 1 ? 'invoices' : 'review'
            const stepOrder = ['client', 'invoices', 'analyzing', 'review', 'submitting', 'success']
            const currentIdx = stepOrder.indexOf(step)
            const thisIdx = stepOrder.indexOf(stepIdx)
            const isDone = currentIdx > thisIdx
            const isCurrent = step === stepIdx || (i === 2 && ['review', 'analyzing', 'submitting', 'success'].includes(step))
            return (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isDone ? 'bg-primary text-white' :
                  isCurrent ? 'bg-primary/20 text-primary border-2 border-primary' :
                  'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {isDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-xs font-medium ${isCurrent || isDone ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                  {label}
                </span>
                {i < 2 && <div className={`flex-1 h-px ${isDone ? 'bg-primary' : 'bg-outline-variant/30'}`} />}
              </div>
            )
          })}
        </div>

        {/* ═══ STEP 1: CLIENT SELECTION ═══ */}
        {step === 'client' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-on-surface-variant tracking-wider mb-2 block">
                SELECCIONA O CREA UN CLIENTE
              </label>
              <input
                ref={clientInputRef}
                type="text"
                value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setCreatingNewClient(false) }}
                placeholder="Escribe el nombre del cliente..."
                className="w-full px-4 py-3 bg-surface-container-low rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-outline-variant/30 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                autoFocus
              />
            </div>

            {filteredClients.length > 0 && (
              <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/10">
                {filteredClients.slice(0, 8).map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectClient(c)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-container-high transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{c.name}</p>
                      <p className="text-xs text-on-surface-variant truncate">{c.cif_nif || c.type}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-on-surface-variant" />
                  </button>
                ))}
              </div>
            )}

            {showNewClientButton && !creatingNewClient && (
              <button
                onClick={() => { setNewClientName(clientSearch); setCreatingNewClient(true) }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 transition-all"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Plus className="w-4 h-4 text-primary" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-primary">Crear cliente nuevo</p>
                  <p className="text-xs text-on-surface-variant">&quot;{clientSearch}&quot;</p>
                </div>
              </button>
            )}

            <AnimatePresence>
              {creatingNewClient && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="bg-surface-container-low rounded-xl border border-primary/20 p-4 space-y-3">
                    <p className="text-xs font-semibold text-primary tracking-wider">NUEVO CLIENTE</p>
                    <input
                      type="text"
                      value={newClientName}
                      onChange={e => setNewClientName(e.target.value)}
                      placeholder="Nombre del cliente"
                      className="w-full px-3 py-2.5 bg-surface rounded-lg text-sm text-on-surface border border-outline-variant/30 outline-none focus:border-primary/50 transition"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateClient() }}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setCreatingNewClient(false)}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-on-surface-variant hover:bg-surface-container-high transition">
                        Cancelar
                      </button>
                      <button onClick={handleCreateClient}
                        disabled={!newClientName.trim()}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-bold text-white gradient-primary disabled:opacity-50 transition">
                        Crear y continuar
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ═══ STEP 2: INVOICES UPLOAD ═══ */}
        {step === 'invoices' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 rounded-xl border border-primary/20">
              <User className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-on-surface flex-1">{selectedClient?.name}</span>
              <button onClick={() => { setSelectedClient(null); setStep('client') }}
                className="p-1 rounded-lg hover:bg-primary/10 transition">
                <X className="w-3.5 h-3.5 text-on-surface-variant" />
              </button>
            </div>

            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 py-12 px-6 rounded-2xl border-2 border-dashed border-outline-variant/30 hover:border-primary/40 hover:bg-primary/[0.02] transition-all cursor-pointer"
            >
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Upload className="w-6 h-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-on-surface">Arrastra facturas o haz click</p>
                <p className="text-xs text-on-surface-variant mt-1">PDF o imagenes. Tambien puedes <span className="text-primary font-medium">pegar (Ctrl+V)</span> desde el portapapeles</p>
              </div>
            </div>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,image/*" className="hidden"
              onChange={e => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = '' }} />

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-container-low">
                    <FileText className="w-4 h-4 text-on-surface-variant flex-shrink-0" />
                    <span className="text-xs text-on-surface truncate flex-1">{f.file.name}</span>
                    <span className="text-[10px] text-on-surface-variant">{(f.file.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => removeFile(f.id)} className="p-1 rounded-lg hover:bg-surface-container-high transition">
                      <X className="w-3 h-3 text-on-surface-variant" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setStep('client')}
                className="px-4 py-2.5 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition">
                Atras
              </button>
              <button
                onClick={startAnalysis}
                disabled={files.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white gradient-primary disabled:opacity-40 transition hover:opacity-90 active:scale-[0.98]"
              >
                <Zap className="w-4 h-4" />
                Analizar {files.length} factura{files.length !== 1 ? 's' : ''}
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ STEP 3: ANALYZING ═══ */}
        {step === 'analyzing' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-16 gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              <Zap className="w-6 h-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-sm font-medium text-on-surface">Analizando facturas...</p>
            <p className="text-xs text-on-surface-variant">{scanProgress.done} / {scanProgress.total} completadas</p>
            <div className="w-48 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 0}%` }} />
            </div>
          </motion.div>
        )}

        {/* ═══ STEP 4: REVIEW ═══ */}
        {step === 'review' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {existingSupply && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">CUPS ya existe en el sistema</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Cliente: {existingSupply.client_name} — Las facturas se a&ntilde;adiran al suministro existente.
                  </p>
                </div>
              </div>
            )}

            <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-4 space-y-3">
              <p className="text-xs font-semibold text-on-surface-variant tracking-wider">DATOS EXTRAIDOS</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'CUPS', value: extractedCups },
                  { label: 'Tarifa', value: extractedTariff },
                  { label: 'Titular', value: extractedHolder },
                  { label: 'Direccion', value: extractedAddress },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] text-on-surface-variant tracking-wider">{label}</p>
                    <p className="text-sm text-on-surface font-medium truncate">{value || '\u2014'}</p>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-outline-variant/10">
                <p className="text-[10px] text-on-surface-variant tracking-wider">CLIENTE</p>
                <p className="text-sm text-on-surface font-medium">{selectedClient?.name}</p>
              </div>
            </div>

            <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-4">
              <p className="text-xs font-semibold text-on-surface-variant tracking-wider mb-2">
                FACTURAS ({successCount}/{files.length} analizadas)
              </p>
              <div className="space-y-1.5">
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    {f.status === 'success' ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    ) : f.status === 'error' ? (
                      <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                    )}
                    <span className="text-on-surface truncate">{f.file.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error-container/30 text-error text-xs">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setStep('invoices')}
                className="px-4 py-2.5 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition">
                Atras
              </button>
              <button
                onClick={submitSupply}
                disabled={successCount === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white gradient-primary disabled:opacity-40 transition hover:opacity-90 active:scale-[0.98]"
              >
                {existingSupply ? (
                  <><Plus className="w-4 h-4" /> A&ntilde;adir facturas</>
                ) : (
                  <><Zap className="w-4 h-4" /> Crear suministro</>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ SUBMITTING ═══ */}
        {step === 'submitting' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-16 gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-sm font-medium text-on-surface">
              {existingSupply ? 'A\u00f1adiendo facturas...' : 'Creando suministro...'}
            </p>
          </motion.div>
        )}

        {/* ═══ SUCCESS ═══ */}
        {step === 'success' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center py-16 gap-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-lg font-bold text-on-surface">
              {existingSupply ? 'Facturas a\u00f1adidas' : 'Suministro creado'}
            </p>
            <p className="text-sm text-on-surface-variant text-center">
              {extractedCups && <span className="font-mono text-xs">{extractedCups}</span>}
            </p>
            <div className="flex gap-3 mt-4">
              <button onClick={reset}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container-high transition border border-outline-variant/30">
                Agregar otro
              </button>
              {successSupplyId && (
                <button onClick={() => router.push(`/supplies/${successSupplyId}`)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white gradient-primary transition hover:opacity-90">
                  Ver suministro <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.div>
        )}

      </div>
    </div>
  )
}
