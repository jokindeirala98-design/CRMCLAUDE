'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Upload, FileText, AlertCircle, CheckCircle2, Loader2, Zap, TableIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { useUploadQueue, processJobInBackground } from '@/stores/upload-queue'
import type { QueuedFile } from '@/stores/upload-queue'

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TYPES                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface BulkUploadModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  preselectedClientId?: string
}

// Simple client-side CUPS validation: ES + 18 alphanumeric chars (20 chars total)
const CUPS_RE = /^ES[A-Z0-9]{18}/i
function isCupsValid(val: string): boolean {
  const clean = val.trim().toUpperCase().replace(/\s+/g, '')
  return clean.length >= 20 && CUPS_RE.test(clean)
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COMPONENT                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function BulkUploadModal({ open, onClose, onCreated, preselectedClientId }: BulkUploadModalProps) {
  const router = useRouter()
  const [localFiles, setLocalFiles] = useState<{ id: string; file: File }[]>([])
  const [clientId, setClientId] = useState(preselectedClientId || '')
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const dragZoneRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addJob = useUploadQueue((s) => s.addJob)

  // ── CUPS quick-create state ──
  const [cupsInput, setCupsInput] = useState('')
  const [cupsLoading, setCupsLoading] = useState(false)
  const [cupsSuccessId, setCupsSuccessId] = useState<string | null>(null)
  const [cupsSuccessMsg, setCupsSuccessMsg] = useState('')
  const [cupsErr, setCupsErr] = useState('')

  const cupsValid = isCupsValid(cupsInput)

  // ── Excel import state ──
  type ExcelResult = {
    fileName: string; cups?: string; tarifa?: string; supplyId?: string
    ok: boolean; error?: string; invoicesCreated?: number; invoicesSkipped?: number; isNew?: boolean
  }
  const [xlsxFiles, setXlsxFiles] = useState<{ id: string; file: File }[]>([])
  const [xlsxImporting, setXlsxImporting] = useState(false)
  const [xlsxResults, setXlsxResults] = useState<ExcelResult[]>([])
  const [xlsxErr, setXlsxErr] = useState('')
  const xlsxDragRef = useRef<HTMLDivElement>(null)
  const xlsxInputRef = useRef<HTMLInputElement>(null)

  // ── Initialize ──
  useEffect(() => {
    if (!open) return
    setLocalFiles([])
    setError('')
    setUploading(false)
    setClientId(preselectedClientId || '')
    setCupsInput('')
    setCupsLoading(false)
    setCupsSuccessId(null)
    setCupsSuccessMsg('')
    setCupsErr('')
    setXlsxFiles([])
    setXlsxImporting(false)
    setXlsxResults([])
    setXlsxErr('')

    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('clients').select('id, name').order('name')
      if (data) setClients(data as any[])
    }
    fetchClients()
  }, [open, preselectedClientId])

  // ── Drag & drop ──
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragZoneRef.current?.classList.add('border-brand/60', 'bg-secondary/5')
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragZoneRef.current?.classList.remove('border-brand/60', 'bg-secondary/5')
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragZoneRef.current?.classList.remove('border-brand/60', 'bg-secondary/5')
    addFiles(Array.from(e.dataTransfer.files))
  }
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    addFiles(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addFiles = (incoming: File[]) => {
    setError('')
    const validExts = ['pdf', 'jpg', 'jpeg', 'png']
    const valid = incoming.filter((f) => {
      const ext = f.name.toLowerCase().split('.').pop()
      return validExts.includes(ext || '') && f.size <= 20 * 1024 * 1024
    })
    if (valid.length === 0) {
      setError('Ningún archivo válido. Acepta PDF o imágenes de menos de 20MB.')
      return
    }
    setLocalFiles((prev) => [
      ...prev,
      ...valid.map((f) => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, file: f })),
    ])
  }

  const removeFile = (id: string) => setLocalFiles((prev) => prev.filter((f) => f.id !== id))

  // ── CUPS handler ──
  const handleCupsChange = (val: string) => {
    // Auto-uppercase and strip spaces
    setCupsInput(val.toUpperCase().replace(/\s+/g, ''))
    setCupsSuccessId(null)
    setCupsSuccessMsg('')
    setCupsErr('')
  }

  const handleCreateFromCups = async () => {
    if (!clientId) {
      setCupsErr('Selecciona un cliente antes de crear el suministro')
      return
    }
    if (!cupsValid) {
      setCupsErr('El CUPS no tiene un formato válido')
      return
    }

    setCupsLoading(true)
    setCupsErr('')

    try {
      const res = await fetch('/api/supplies/create-from-cups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups: cupsInput.trim(), client_id: clientId }),
      })
      const result = await res.json()

      if (!res.ok || !result.ok) {
        setCupsErr(result.error || 'Error creando el suministro')
        return
      }

      const msg = result.is_existing
        ? '✓ Suministro ya existente con ese CUPS'
        : result.has_sips
          ? '✓ Suministro creado con datos SIPS'
          : '✓ Suministro creado (SIPS no disponible)'

      setCupsSuccessId(result.supply_id)
      setCupsSuccessMsg(msg)
      onCreated()

      // Navigate to the new supply after a brief flash
      setTimeout(() => {
        onClose()
        router.push(`/supplies/${result.supply_id}`)
      }, 1200)
    } catch (err: any) {
      setCupsErr(err.message || 'Error desconocido')
    } finally {
      setCupsLoading(false)
    }
  }

  // ── Submit files ──
  const handleSubmit = async () => {
    if (localFiles.length === 0) {
      setError('Añade al menos un archivo')
      return
    }

    setUploading(true)
    setError('')

    try {
      const queuedFiles: QueuedFile[] = localFiles.map(lf => ({
        id: lf.id,
        file: lf.file,
        url: '',
        storagePath: '',
        status: 'pending',
      }))

      const client = clients.find((c) => c.id === clientId)
      const clientName = client?.name || 'Auto-detectar cliente'

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`
      addJob({
        id: jobId,
        clientId: clientId || '',
        clientName,
        files: queuedFiles,
        status: 'uploading',
        createdAt: Date.now(),
      })

      onClose()
      onCreated()
    } catch (err: any) {
      setError(err.message || 'Error al encolar archivos')
      setUploading(false)
    }
  }

  // ── Excel drag & drop handlers ──
  const handleXlsxDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); xlsxDragRef.current?.classList.add('border-brand/60', 'bg-secondary/5') }
  const handleXlsxDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); xlsxDragRef.current?.classList.remove('border-brand/60', 'bg-secondary/5') }
  const handleXlsxDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    xlsxDragRef.current?.classList.remove('border-brand/60', 'bg-secondary/5')
    addXlsxFiles(Array.from(e.dataTransfer.files))
  }
  const handleXlsxInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addXlsxFiles(Array.from(e.target.files))
    if (xlsxInputRef.current) xlsxInputRef.current.value = ''
  }
  const addXlsxFiles = (incoming: File[]) => {
    setXlsxErr('')
    setXlsxResults([])
    const valid = incoming.filter(f => f.name.toLowerCase().endsWith('.xlsx'))
    if (!valid.length) { setXlsxErr('Solo se aceptan archivos .xlsx'); return }
    setXlsxFiles(prev => [
      ...prev,
      ...valid
        .filter(f => !prev.some(p => p.file.name === f.name))
        .map(f => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, file: f })),
    ])
  }
  const removeXlsxFile = (id: string) => {
    setXlsxFiles(prev => prev.filter(f => f.id !== id))
    setXlsxResults([])
  }

  const handleXlsxImport = async () => {
    if (!xlsxFiles.length) { setXlsxErr('Añade al menos un Excel'); return }
    setXlsxImporting(true)
    setXlsxErr('')
    setXlsxResults([])

    try {
      let accessToken: string | null = null
      try { const raw = localStorage.getItem('voltis-auth'); if (raw) accessToken = JSON.parse(raw)?.access_token ?? null } catch {}

      const fd = new FormData()
      if (clientId) fd.append('clientId', clientId)
      for (const { file } of xlsxFiles) fd.append('files', file)

      const res = await fetch('/api/supplies/import-from-excel', {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        body: fd,
      })
      const data = await res.json()

      if (!res.ok) { setXlsxErr(data.error || 'Error en la importación'); return }

      setXlsxResults(data.results || [])
      onCreated()
    } catch (err: any) {
      setXlsxErr(err.message || 'Error desconocido')
    } finally {
      setXlsxImporting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-bg rounded-2xl shadow-ambient-lg w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line-2-variant/30 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-secondary/10 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-brand" />
                </div>
                <div>
                  <h2 className="font-sans font-semibold text-ink">
                    Importar Facturas
                  </h2>
                  <p className="text-xs text-ink-3">
                    Se procesarán en segundo plano
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-xl text-ink-3 hover:bg-bg-2 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">

              {/* ── Shared client selector ── */}
              <SearchableClientSelector
                label="Cliente (opcional)"
                value={clientId}
                onChange={setClientId}
                clients={clients}
                placeholder="Buscar cliente existente..."
                showAutoDetect
              />

              {/* ════════════════════════════════════════════
                  SECCIÓN 1 — CREAR DESDE CUPS
              ════════════════════════════════════════════ */}
              <div className="space-y-3">
                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-outline-variant/30" />
                  <span className="text-[10px] font-semibold tracking-wider text-ink-3/60 uppercase">
                    Crear desde CUPS
                  </span>
                  <div className="flex-1 h-px bg-outline-variant/30" />
                </div>

                {/* CUPS input */}
                <div>
                  <label className="block text-xs font-medium text-ink-3 mb-1.5">
                    CUPS del suministro
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={cupsInput}
                      onChange={(e) => handleCupsChange(e.target.value)}
                      placeholder="ES0021000000000000AB"
                      maxLength={22}
                      disabled={cupsLoading || !!cupsSuccessId}
                      className={`w-full h-10 px-3 pr-9 rounded-xl border text-sm font-mono bg-bg-2 outline-none transition-all
                        ${cupsSuccessId
                          ? 'border-success/50 text-ok'
                          : cupsInput.length > 0 && !cupsValid
                            ? 'border-error/40 text-ink'
                            : cupsValid
                              ? 'border-success/50 text-ink'
                              : 'border-line-2-variant/40 text-ink'}
                        focus:border-brand/60 disabled:opacity-60`}
                    />
                    {/* Validation icon */}
                    {cupsSuccessId ? (
                      <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ok" />
                    ) : cupsValid ? (
                      <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-success/60" />
                    ) : null}
                  </div>

                  {/* CUPS success message */}
                  {cupsSuccessMsg && (
                    <p className="mt-1.5 text-xs text-ok font-medium">{cupsSuccessMsg}</p>
                  )}

                  {/* CUPS error */}
                  {cupsErr && (
                    <p className="mt-1.5 text-xs text-err">{cupsErr}</p>
                  )}

                  {/* Hint when CUPS valid but no client selected */}
                  {cupsValid && !cupsSuccessId && !clientId && !cupsErr && (
                    <p className="mt-1.5 text-xs text-warn">
                      ⚠ Selecciona un cliente arriba para continuar
                    </p>
                  )}
                </div>

                {/* Create button — only visible when CUPS is valid and not yet done */}
                {cupsValid && !cupsSuccessId && (
                  <button
                    onClick={handleCreateFromCups}
                    disabled={cupsLoading || !clientId}
                    className={`w-full flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium transition-all
                      ${clientId
                        ? 'bg-brand text-on-secondary hover:opacity-90 active:scale-[0.98]'
                        : 'bg-bg-2 text-ink-3/50 cursor-not-allowed'}
                      disabled:opacity-60`}
                  >
                    {cupsLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Consultando SIPS...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Crear suministro desde SIPS
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* ════════════════════════════════════════════
                  SECCIÓN 2 — IMPORTAR FACTURAS
              ════════════════════════════════════════════ */}
              <div className="space-y-4">
                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-outline-variant/30" />
                  <span className="text-[10px] font-semibold tracking-wider text-ink-3/60 uppercase">
                    O importar facturas
                  </span>
                  <div className="flex-1 h-px bg-outline-variant/30" />
                </div>

                {/* Drop zone */}
                <div
                  ref={dragZoneRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className="border-2 border-dashed border-line-2-variant/40 rounded-2xl p-8 text-center transition-all cursor-pointer hover:border-brand/40 hover:bg-secondary/5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 text-brand mx-auto mb-3" />
                  <p className="text-sm font-medium text-ink">
                    Arrastra todas las facturas aquí
                  </p>
                  <p className="text-xs text-ink-3 mt-1">
                    PDF o imágenes · Se agruparán por CUPS automáticamente
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                {/* File list */}
                {localFiles.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-ink-3">
                      {localFiles.length} archivo{localFiles.length !== 1 ? 's' : ''} seleccionado{localFiles.length !== 1 ? 's' : ''}
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {localFiles.map((lf) => (
                        <div key={lf.id} className="flex items-center gap-2 py-1.5 px-3 bg-bg-2 rounded-lg text-xs">
                          <FileText className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
                          <span className="flex-1 truncate text-ink">{lf.file.name}</span>
                          <span className="text-ink-3">{(lf.file.size / 1024 / 1024).toFixed(1)} MB</span>
                          <button
                            onClick={() => removeFile(lf.id)}
                            className="p-0.5 text-ink-3 hover:text-err flex-shrink-0"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Info box */}
                {localFiles.length > 0 && (
                  <div className="bg-secondary/5 border border-brand/20 rounded-xl px-4 py-3 text-xs text-ink-3">
                    <p>
                      Al pulsar <b className="text-ink">Procesar</b>, el modal se cerrará y las facturas se
                      analizarán en segundo plano. Podrás seguir usando la app normalmente.
                      Verás el progreso en la esquina inferior derecha.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="bg-err-container rounded-xl px-4 py-2.5 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-err flex-shrink-0" />
                    <p className="text-sm text-err font-medium">{error}</p>
                  </div>
                )}
              </div>

              {/* ════════════════════════════════════════════
                  SECCIÓN 3 — IMPORTAR DESDE EXCEL DE FACTURAS
              ════════════════════════════════════════════ */}
              <div className="space-y-3">
                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-outline-variant/30" />
                  <span className="text-[10px] font-semibold tracking-wider text-ink-3/60 uppercase">
                    Importar desde Excel
                  </span>
                  <div className="flex-1 h-px bg-outline-variant/30" />
                </div>

                <p className="text-xs text-ink-3 leading-relaxed">
                  Adjunta los Excel de facturas (formato VOLTIS). Se crean los suministros e importan todas las facturas automáticamente.
                </p>

                {/* Drop zone Excel */}
                {xlsxResults.length === 0 && (
                  <>
                    <div
                      ref={xlsxDragRef}
                      onDragOver={handleXlsxDragOver}
                      onDragLeave={handleXlsxDragLeave}
                      onDrop={handleXlsxDrop}
                      className="border-2 border-dashed border-brand/30 rounded-2xl p-6 text-center transition-all cursor-pointer hover:border-brand/60 hover:bg-secondary/5"
                      onClick={() => xlsxInputRef.current?.click()}
                    >
                      <TableIcon className="w-7 h-7 text-brand/70 mx-auto mb-2" />
                      <p className="text-sm font-medium text-ink">
                        Arrastra tus Excel aquí
                      </p>
                      <p className="text-xs text-ink-3 mt-0.5">
                        Archivos .xlsx · Uno por suministro
                      </p>
                    </div>

                    <input
                      ref={xlsxInputRef}
                      type="file"
                      multiple
                      accept=".xlsx"
                      onChange={handleXlsxInputChange}
                      className="hidden"
                    />

                    {/* File list */}
                    {xlsxFiles.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-ink-3">{xlsxFiles.length} archivo{xlsxFiles.length !== 1 ? 's' : ''} listos</p>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {xlsxFiles.map(({ id, file }) => (
                            <div key={id} className="flex items-center gap-2 py-1.5 px-3 bg-secondary/5 border border-brand/15 rounded-lg text-xs">
                              <TableIcon className="w-3.5 h-3.5 text-brand/60 flex-shrink-0" />
                              <span className="flex-1 truncate text-ink">{file.name}</span>
                              <span className="text-ink-3">{(file.size / 1024).toFixed(0)} KB</span>
                              <button onClick={() => removeXlsxFile(id)} className="p-0.5 text-ink-3 hover:text-err flex-shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {xlsxErr && (
                      <div className="bg-err-container rounded-xl px-4 py-2.5 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-err flex-shrink-0" />
                        <p className="text-sm text-err font-medium">{xlsxErr}</p>
                      </div>
                    )}

                    {xlsxFiles.length > 0 && (
                      <button
                        onClick={handleXlsxImport}
                        disabled={xlsxImporting}
                        className="w-full flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium bg-brand text-white hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
                      >
                        {xlsxImporting ? (
                          <><Loader2 className="w-4 h-4 animate-spin" />Importando…</>
                        ) : (
                          <><TableIcon className="w-4 h-4" />Importar {xlsxFiles.length} Excel</>
                        )}
                      </button>
                    )}
                  </>
                )}

                {/* Results */}
                {xlsxResults.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-ink">Resultado de la importación</p>
                      <button onClick={() => { setXlsxFiles([]); setXlsxResults([]) }} className="text-[10px] text-brand hover:underline">Importar más</button>
                    </div>
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {xlsxResults.map((r, i) => (
                        <div key={i} className={`rounded-xl px-3 py-2.5 text-xs border ${r.ok ? 'bg-ok-container/20 border-ok/20' : 'bg-err-container/20 border-err/20'}`}>
                          <div className="flex items-center gap-2">
                            {r.ok
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-ok flex-shrink-0" />
                              : <AlertCircle className="w-3.5 h-3.5 text-err flex-shrink-0" />}
                            <span className="font-medium text-ink truncate flex-1">{r.fileName}</span>
                          </div>
                          {r.ok ? (
                            <p className="mt-1 text-ink-3 pl-5">
                              {r.cups} · {r.tarifa} · {r.isNew ? 'Nuevo suministro' : 'Suministro existente'} · {r.invoicesCreated} factura{r.invoicesCreated !== 1 ? 's' : ''} importada{r.invoicesCreated !== 1 ? 's' : ''}
                              {r.invoicesSkipped ? ` (${r.invoicesSkipped} ya existían)` : ''}
                            </p>
                          ) : (
                            <p className="mt-1 text-err pl-5">{r.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={onClose}
                      className="w-full h-9 rounded-xl text-sm font-medium bg-brand text-white hover:opacity-90 transition-all"
                    >
                      Cerrar
                    </button>
                  </div>
                )}
              </div>

            </div>

            {/* Footer */}
            <div className="flex gap-3 justify-end px-6 py-4 border-t border-line-2-variant/30 flex-shrink-0">
              <Button variant="secondary" type="button" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={uploading || localFiles.length === 0}
              >
                {uploading
                  ? 'Subiendo...'
                  : `Procesar ${localFiles.length} factura${localFiles.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
