'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Upload, Check, AlertCircle, Loader2, CheckCircle,
  X, Zap, FileText, User, ArrowRight, Clipboard,
  Send, Download, Trash2, CheckSquare, Square, Image,
  ArrowLeft, RefreshCw, ExternalLink,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { normalizeCups } from '@/lib/utils/cups'

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'inbox' | 'client' | 'invoices' | 'analyzing' | 'review' | 'submitting' | 'success'

interface TelegramFile {
  id: string
  user_id: string
  chat_id: number
  sender_name: string | null
  file_url: string
  file_type: 'pdf' | 'image'
  file_name: string | null
  status: string
  created_at: string
}

interface UploadFile {
  id: string
  file?: File
  remoteUrl?: string
  fileName: string
  fileType: 'pdf' | 'image'
  telegramInboxId?: string
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
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const supabase = createClient()

  // Flow state
  const [step, setStep] = useState<Step>('inbox')
  const [mode, setMode] = useState<'telegram' | 'manual'>('telegram')

  // Telegram inbox
  const [telegramFiles, setTelegramFiles] = useState<TelegramFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loadingInbox, setLoadingInbox] = useState(true)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null)
  const [creatingNewClient, setCreatingNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const clientInputRef = useRef<HTMLInputElement>(null)

  // Working files (unified for both telegram and manual)
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

  // ── Load Telegram inbox ──
  const fetchInbox = useCallback(async () => {
    setLoadingInbox(true)
    const { data } = await supabase
      .from('telegram_inbox')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setTelegramFiles((data as TelegramFile[]) || [])
    setLoadingInbox(false)
  }, [supabase])

  useEffect(() => { fetchInbox() }, [fetchInbox])

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
  }, [supabase])

  // ── Selection helpers ──
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === telegramFiles.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(telegramFiles.map(f => f.id)))
    }
  }

  // ── Delete Telegram files ──
  const deleteSelected = async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    setDeletingIds(new Set(ids))

    for (const id of ids) {
      const file = telegramFiles.find(f => f.id === id)
      if (!file) continue
      // Try to remove from storage
      try {
        const url = new URL(file.file_url)
        const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/documents\/(.+)/)
        if (pathMatch) {
          await supabase.storage.from('documents').remove([pathMatch[1]])
        }
      } catch {}
      await supabase.from('telegram_inbox').delete().eq('id', id)
    }

    setTelegramFiles(prev => prev.filter(f => !ids.includes(f.id)))
    setSelectedIds(new Set())
    setDeletingIds(new Set())
  }

  // ── Delete single file ──
  const deleteSingle = async (id: string) => {
    setDeletingIds(new Set([id]))
    const file = telegramFiles.find(f => f.id === id)
    if (file) {
      try {
        const url = new URL(file.file_url)
        const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/documents\/(.+)/)
        if (pathMatch) {
          await supabase.storage.from('documents').remove([pathMatch[1]])
        }
      } catch {}
      await supabase.from('telegram_inbox').delete().eq('id', id)
    }
    setTelegramFiles(prev => prev.filter(f => f.id !== id))
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
    setDeletingIds(new Set())
  }

  // ── Start analysis from Telegram files ──
  const startFromTelegram = () => {
    const selected = telegramFiles.filter(f => selectedIds.has(f.id))
    if (!selected.length) return

    const workingFiles: UploadFile[] = selected.map(tf => ({
      id: tf.id,
      remoteUrl: tf.file_url,
      fileName: tf.file_name || 'documento',
      fileType: tf.file_type as 'pdf' | 'image',
      telegramInboxId: tf.id,
      status: 'pending',
    }))

    setFiles(workingFiles)
    setMode('telegram')
    setStep('client')
  }

  // ── Start manual upload flow ──
  const startManual = () => {
    setFiles([])
    setMode('manual')
    setStep('client')
  }

  // ── Filtered clients ──
  const filteredClients = clientSearch.trim()
    ? clients.filter(c => {
        const q = clientSearch.toLowerCase()
        return c.name.toLowerCase().includes(q) || (c.cif_nif || '').toLowerCase().includes(q)
      })
    : []

  const showNewClientButton = clientSearch.trim().length >= 2 && filteredClients.length === 0

  // ── Select client (then go to analyze or invoices) ──
  const handleSelectClient = (client: ClientOption) => {
    setSelectedClient(client)
    setClientSearch('')
    setCreatingNewClient(false)
    if (mode === 'telegram') {
      // Files already loaded from Telegram — go straight to analysis
      setStep('analyzing')
      // Trigger analysis after state update
      setTimeout(() => runAnalysis(), 50)
    } else {
      setStep('invoices')
    }
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
        if (mode === 'telegram') {
          setStep('analyzing')
          setTimeout(() => runAnalysis(), 50)
        } else {
          setStep('invoices')
        }
      }
    } catch (err) {
      console.error('Error creating client:', err)
    } finally {
      setCreatingNewClient(false)
    }
  }

  // ── Manual file handling ──
  const addFiles = (fileList: File[]) => {
    const valid = fileList.filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'))
    if (!valid.length) return
    const newFiles: UploadFile[] = valid.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      fileName: f.name,
      fileType: f.type.startsWith('image') ? 'image' as const : 'pdf' as const,
      status: 'pending' as const,
    }))
    setFiles(prev => [...prev, ...newFiles])
  }

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id))

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
      if (pastedFiles.length > 0) { e.preventDefault(); addFiles(pastedFiles) }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [step])

  // ── Drag & drop ──
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    addFiles(Array.from(e.dataTransfer.files))
  }

  // ── Read local file as base64 ──
  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  // ── Fetch remote file (Telegram URL) as base64 ──
  const fetchUrlAsBase64 = async (url: string): Promise<string> => {
    const res = await fetch(url)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  // ── Analyze all files (unified for both modes) ──
  const runAnalysis = async () => {
    // Use ref to get latest files since this might be called from setTimeout
    const currentFiles = files.length > 0 ? files : []
    if (currentFiles.length === 0) return
    setStep('analyzing')
    setError(null)
    setScanProgress({ done: 0, total: currentFiles.length })

    let firstData: any = null

    const getBase64 = async (uf: UploadFile): Promise<string> => {
      if (uf.file) return readFileAsBase64(uf.file)
      if (uf.remoteUrl) return fetchUrlAsBase64(uf.remoteUrl)
      throw new Error('No file source')
    }

    // Analyze first file
    const first = currentFiles[0]
    setFiles(prev => prev.map(f => f.id === first.id ? { ...f, status: 'analyzing' as const } : f))
    try {
      const b64 = await getBase64(first)
      const res = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_base64: b64,
          file_type: first.fileType === 'image' ? 'image' : 'pdf',
          file_name: first.fileName,
        }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      firstData = await res.json()
      setFiles(prev => prev.map(f => f.id === first.id ? { ...f, status: 'success' as const, extractedData: firstData } : f))
    } catch {
      setFiles(prev => prev.map(f => f.id === first.id ? { ...f, status: 'error' as const, error: 'Error al analizar' } : f))
    }
    setScanProgress({ done: 1, total: currentFiles.length })

    // Analyze rest in parallel batches of 3
    const rest = currentFiles.slice(1)
    for (let i = 0; i < rest.length; i += 3) {
      const batch = rest.slice(i, i + 3)
      await Promise.allSettled(batch.map(async (uf) => {
        setFiles(prev => prev.map(f => f.id === uf.id ? { ...f, status: 'analyzing' as const } : f))
        try {
          const b64 = await getBase64(uf)
          const res = await fetch('/api/analyze-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file_base64: b64,
              file_type: uf.fileType === 'image' ? 'image' : 'pdf',
              file_name: uf.fileName,
            }),
          })
          if (!res.ok) throw new Error()
          const data = await res.json()
          setFiles(prev => prev.map(f => f.id === uf.id ? { ...f, status: 'success' as const, extractedData: data } : f))
        } catch {
          setFiles(prev => prev.map(f => f.id === uf.id ? { ...f, status: 'error' as const, error: 'Error' } : f))
        }
      }))
      setScanProgress(prev => ({ ...prev, done: Math.min(prev.done + batch.length, currentFiles.length) }))
    }

    // Build review from first analyzed data
    const cups = firstData?.cups ? normalizeCups(firstData.cups) : null
    setExtractedCups(cups || null)
    setExtractedTariff(firstData?.tariff || firstData?.economics?.tarifa || null)
    setExtractedAddress(firstData?.supply_address || firstData?.billing_address || null)
    setExtractedHolder(firstData?.holder_name || firstData?.economics?.titular || null)

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

      // Helper: create invoice record
      const createInvoice = async (supplyId: string, uf: UploadFile) => {
        if (uf.remoteUrl) {
          // Telegram file — already in Supabase storage
          await supabase.from('invoices').insert({
            supply_id: supplyId,
            file_url: uf.remoteUrl,
            file_type: uf.fileType === 'image' ? 'image' : 'pdf',
            extraction_status: 'completed',
            extracted_data: uf.extractedData,
          })
        } else if (uf.file) {
          // Manual upload
          const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const path = `invoices/${user!.id}/${uid}-${uf.file.name}`
          const { error: upErr } = await supabase.storage.from('documents').upload(path, uf.file)
          if (upErr) { console.error(upErr); return }
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
          await supabase.from('invoices').insert({
            supply_id: supplyId,
            file_url: urlData.publicUrl,
            file_type: uf.fileType === 'image' ? 'image' : 'pdf',
            extraction_status: 'completed',
            extracted_data: uf.extractedData,
          })
        }
      }

      // If CUPS exists, add invoices to existing supply
      if (existingSupply) {
        for (const uf of files.filter(f => f.status === 'success')) {
          await createInvoice(existingSupply.id, uf)
        }
        await markTelegramProcessed()
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

      for (const uf of files.filter(f => f.status === 'success')) {
        await createInvoice(supply.id, uf)
      }

      await markTelegramProcessed()

      // Create prescoring if needed
      const tariffNorm = (extractedTariff || '').replace(/\s+/g, '').toUpperCase()
      const skip20 = tariffNorm.startsWith('2.0') || tariffNorm === '20TD' || tariffNorm === '20' || tariffNorm === '202020' || tariffNorm === '2.0DHA' || tariffNorm === '20DHA'
      if (!skip20) {
        await supabase.from('prescorings').insert({
          supply_id: supply.id,
          client_name: extractedHolder || selectedClient.name,
          cups: normalizedCups,
          tariff: extractedTariff,
          status: 'pending',
          requested_by: user.id,
        })
      }

      // Background SIPS fetch
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

  // ── Mark telegram inbox files as processed ──
  const markTelegramProcessed = async () => {
    const telegramIds = files.filter(f => f.telegramInboxId).map(f => f.telegramInboxId!)
    if (!telegramIds.length) return
    for (const id of telegramIds) {
      await supabase
        .from('telegram_inbox')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', id)
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
    setStep('inbox')
    setMode('telegram')
    setSelectedClient(null)
    setClientSearch('')
    setNewClientName('')
    setFiles([])
    setSelectedIds(new Set())
    setExtractedCups(null)
    setExtractedTariff(null)
    setExtractedAddress(null)
    setExtractedHolder(null)
    setExistingSupply(null)
    setSuccessSupplyId(null)
    setError(null)
    fetchInbox()
  }

  // ── Go back ──
  const goBack = () => {
    if (step === 'client') { reset(); return }
    if (step === 'invoices') { setStep('client'); return }
    if (step === 'review') {
      if (mode === 'telegram') setStep('client')
      else setStep('invoices')
    }
  }

  const successCount = files.filter(f => f.status === 'success').length

  // ── Time ago ──
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'ahora'
    if (mins < 60) return `hace ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `hace ${hours}h`
    return `hace ${Math.floor(hours / 24)}d`
  }

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-surface">
      <Header
        title={step === 'inbox' ? 'Bandeja de Entrada' : 'Procesar Documentos'}
        subtitle={step === 'inbox' ? 'Documentos recibidos por Telegram' : 'Selecciona cliente y analiza'}
      />

      <div className="px-4 lg:px-8 py-6 max-w-xl mx-auto">

        {/* ═══ MAIN VIEW: TELEGRAM INBOX ═══ */}
        {step === 'inbox' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

            {/* Actions bar */}
            {telegramFiles.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-on-surface-variant hover:bg-surface-container-high transition"
                >
                  {selectedIds.size === telegramFiles.length
                    ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
                    : <Square className="w-3.5 h-3.5" />
                  }
                  {selectedIds.size === telegramFiles.length ? 'Deseleccionar' : 'Seleccionar todo'}
                </button>

                <div className="flex-1" />

                {selectedIds.size > 0 && (
                  <>
                    <button
                      onClick={deleteSelected}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-error/80 hover:bg-error/5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Eliminar ({selectedIds.size})
                    </button>
                    <button
                      onClick={startFromTelegram}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold text-white gradient-primary transition hover:opacity-90 active:scale-[0.98]"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      Analizar ({selectedIds.size})
                    </button>
                  </>
                )}

                <button
                  onClick={fetchInbox}
                  className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high transition"
                  title="Refrescar"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* File list */}
            {loadingInbox ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
                <p className="text-sm text-on-surface-variant">Cargando documentos...</p>
              </div>
            ) : telegramFiles.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-surface-container-high flex items-center justify-center">
                  <Send className="w-7 h-7 text-on-surface-variant/50" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-on-surface">No hay documentos pendientes</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Los comerciales pueden enviar facturas por Telegram
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-surface-container-low rounded-2xl border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/10">
                {telegramFiles.map(tf => {
                  const isSelected = selectedIds.has(tf.id)
                  const isDeleting = deletingIds.has(tf.id)
                  return (
                    <div
                      key={tf.id}
                      onClick={() => toggleSelect(tf.id)}
                      className={`flex items-center gap-3 px-4 py-3 transition-all cursor-pointer ${
                        isSelected ? 'bg-primary/5' : 'hover:bg-surface-container-high'
                      } ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}
                    >
                      {/* Checkbox */}
                      <div className="flex-shrink-0">
                        {isSelected
                          ? <CheckSquare className="w-5 h-5 text-primary" />
                          : <Square className="w-5 h-5 text-on-surface-variant/40" />
                        }
                      </div>

                      {/* Icon */}
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        tf.file_type === 'pdf' ? 'bg-red-500/10' : 'bg-blue-500/10'
                      }`}>
                        {tf.file_type === 'pdf'
                          ? <FileText className="w-4 h-4 text-red-500" />
                          : <Image className="w-4 h-4 text-blue-500" />
                        }
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">
                          {tf.file_name || 'Documento'}
                        </p>
                        <p className="text-xs text-on-surface-variant truncate">
                          {tf.sender_name || 'Comercial'} &middot; {timeAgo(tf.created_at)}
                        </p>
                      </div>

                      {/* Quick actions */}
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <a
                          href={tf.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg hover:bg-surface-container-high transition"
                          title="Ver / Descargar"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-on-surface-variant" />
                        </a>
                        <button
                          onClick={() => deleteSingle(tf.id)}
                          className="p-1.5 rounded-lg hover:bg-error/5 transition"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-on-surface-variant hover:text-error" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Manual upload */}
            <div className="pt-2">
              <button
                onClick={startManual}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border-2 border-dashed border-outline-variant/30 hover:border-primary/40 hover:bg-primary/[0.02] transition-all text-on-surface-variant hover:text-primary"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm font-medium">Subir facturas manualmente</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ STEP: CLIENT SELECTION ═══ */}
        {step === 'client' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <button onClick={goBack} className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface transition">
              <ArrowLeft className="w-3.5 h-3.5" /> Volver a bandeja
            </button>

            {/* Telegram badge */}
            {mode === 'telegram' && files.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[#2AABEE]/5 rounded-xl border border-[#2AABEE]/20">
                <Send className="w-4 h-4 text-[#2AABEE]" />
                <span className="text-xs font-medium text-on-surface">
                  {files.length} documento{files.length !== 1 ? 's' : ''} de Telegram
                </span>
              </div>
            )}

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

        {/* ═══ STEP: MANUAL INVOICES UPLOAD ═══ */}
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
                <p className="text-xs text-on-surface-variant mt-1">PDF o imagenes &middot; <span className="text-primary font-medium">Ctrl+V</span> para pegar</p>
              </div>
            </div>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,image/*" className="hidden"
              onChange={e => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = '' }} />

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-container-low">
                    <FileText className="w-4 h-4 text-on-surface-variant flex-shrink-0" />
                    <span className="text-xs text-on-surface truncate flex-1">{f.fileName}</span>
                    <span className="text-[10px] text-on-surface-variant">{f.file ? `${(f.file.size / 1024).toFixed(0)} KB` : ''}</span>
                    <button onClick={() => removeFile(f.id)} className="p-1 rounded-lg hover:bg-surface-container-high transition">
                      <X className="w-3 h-3 text-on-surface-variant" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={goBack}
                className="px-4 py-2.5 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition">
                Atras
              </button>
              <button
                onClick={runAnalysis}
                disabled={files.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white gradient-primary disabled:opacity-40 transition hover:opacity-90 active:scale-[0.98]"
              >
                <Zap className="w-4 h-4" />
                Analizar {files.length} factura{files.length !== 1 ? 's' : ''}
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ ANALYZING ═══ */}
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

        {/* ═══ REVIEW ═══ */}
        {step === 'review' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {existingSupply && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">CUPS ya existe en el sistema</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Las facturas se a&ntilde;adiran al suministro existente.
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
                    <span className="text-on-surface truncate">{f.fileName}</span>
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
              <button onClick={goBack}
                className="px-4 py-2.5 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition">
                Atras
              </button>
              <button
                onClick={submitSupply}
                disabled={successCount === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white gradient-primary disabled:opacity-40 transition hover:opacity-90 active:scale-[0.98]"
              >
                {existingSupply ? (
                  <>
                    <Plus className="w-4 h-4" />
                    A&ntilde;adir facturas
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Crear suministro
                  </>
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
            {extractedCups && (
              <p className="text-sm text-on-surface-variant text-center">
                <span className="font-mono text-xs">{extractedCups}</span>
              </p>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={reset}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container-high transition border border-outline-variant/30">
                Volver a bandeja
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
