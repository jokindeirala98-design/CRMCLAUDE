'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Upload, FileText, AlertCircle, CheckCircle2, Loader2, Zap, TableIcon, UserPlus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { useUploadQueue } from '@/stores/upload-queue'
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

type ExcelResult = {
  fileName: string; cups?: string; tarifa?: string; supplyId?: string
  ok: boolean; error?: string; invoicesCreated?: number; invoicesSkipped?: number; isNew?: boolean
}

const CUPS_RE = /^ES[A-Z0-9]{18}/i
function isCupsValid(val: string): boolean {
  const clean = val.trim().toUpperCase().replace(/\s+/g, '')
  return clean.length >= 20 && CUPS_RE.test(clean)
}

function isXlsx(f: File) { return f.name.toLowerCase().endsWith('.xlsx') }
function isPdfOrImg(f: File) {
  const ext = f.name.toLowerCase().split('.').pop() || ''
  return ['pdf', 'jpg', 'jpeg', 'png'].includes(ext)
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COMPONENT                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function BulkUploadModal({ open, onClose, onCreated, preselectedClientId }: BulkUploadModalProps) {
  const router = useRouter()
  const addJob = useUploadQueue((s) => s.addJob)

  // ── Shared state ──
  const [clients, setClients]     = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId]   = useState(preselectedClientId || '')
  // For Excel: if no existing client selected, allow typing a new name
  const [newClientName, setNewClientName] = useState('')

  // ── File lists (split by type) ──
  const [pdfFiles,  setPdfFiles]  = useState<{ id: string; file: File }[]>([])
  const [xlsxFiles, setXlsxFiles] = useState<{ id: string; file: File }[]>([])

  // ── PDF state ──
  const [pdfError,    setPdfError]    = useState('')
  const [pdfUploading, setPdfUploading] = useState(false)

  // ── Excel state ──
  const [xlsxImporting, setXlsxImporting] = useState(false)
  const [xlsxResults,   setXlsxResults]   = useState<ExcelResult[]>([])
  const [xlsxErr,       setXlsxErr]       = useState('')

  // ── CUPS quick-create ──
  const [cupsInput,      setCupsInput]      = useState('')
  const [cupsLoading,    setCupsLoading]    = useState(false)
  const [cupsSuccessId,  setCupsSuccessId]  = useState<string | null>(null)
  const [cupsSuccessMsg, setCupsSuccessMsg] = useState('')
  const [cupsErr,        setCupsErr]        = useState('')

  const cupsValid = isCupsValid(cupsInput)

  // ── Refs ──
  const dragZoneRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Init ──
  useEffect(() => {
    if (!open) return
    setPdfFiles([]); setXlsxFiles([])
    setPdfError(''); setPdfUploading(false)
    setXlsxImporting(false); setXlsxResults([]); setXlsxErr('')
    setCupsInput(''); setCupsLoading(false); setCupsSuccessId(null); setCupsSuccessMsg(''); setCupsErr('')
    setClientId(preselectedClientId || '')
    setNewClientName('')

    const fetchClients = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('clients').select('id, name').order('name')
      if (data) setClients(data as any[])
    }
    fetchClients()
  }, [open, preselectedClientId])

  // ── Drag & drop (unified zone) ──
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragZoneRef.current?.classList.add('border-brand/60', 'bg-secondary/5')
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragZoneRef.current?.classList.remove('border-brand/60', 'bg-secondary/5')
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragZoneRef.current?.classList.remove('border-brand/60', 'bg-secondary/5')
    addFiles(Array.from(e.dataTransfer.files))
  }
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addFiles = (incoming: File[]) => {
    setPdfError(''); setXlsxErr(''); setXlsxResults([])

    const excels = incoming.filter(isXlsx)
    const pdfs   = incoming.filter(isPdfOrImg).filter(f => f.size <= 20 * 1024 * 1024)

    if (!excels.length && !pdfs.length) {
      setPdfError('Archivos no válidos. Acepta PDF, imágenes o Excel (.xlsx) de menos de 20 MB.')
      return
    }

    if (excels.length) {
      setXlsxFiles(prev => [
        ...prev,
        ...excels
          .filter(f => !prev.some(p => p.file.name === f.name))
          .map(f => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, file: f })),
      ])
    }
    if (pdfs.length) {
      setPdfFiles(prev => [
        ...prev,
        ...pdfs.map(f => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, file: f })),
      ])
    }
  }

  // ── CUPS ──
  const handleCupsChange = (val: string) => {
    setCupsInput(val.toUpperCase().replace(/\s+/g, ''))
    setCupsSuccessId(null); setCupsSuccessMsg(''); setCupsErr('')
  }

  const handleCreateFromCups = async () => {
    if (!clientId) { setCupsErr('Selecciona un cliente antes de crear el suministro'); return }
    if (!cupsValid) { setCupsErr('El CUPS no tiene un formato válido'); return }
    setCupsLoading(true); setCupsErr('')
    try {
      const res = await fetch('/api/supplies/create-from-cups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups: cupsInput.trim(), client_id: clientId }),
      })
      const result = await res.json()
      if (!res.ok || !result.ok) { setCupsErr(result.error || 'Error creando el suministro'); return }
      const msg = result.is_existing ? '✓ Suministro ya existente con ese CUPS'
        : result.has_sips ? '✓ Suministro creado con datos SIPS'
        : '✓ Suministro creado (SIPS no disponible)'
      setCupsSuccessId(result.supply_id); setCupsSuccessMsg(msg); onCreated()
      setTimeout(() => { onClose(); router.push(`/supplies/${result.supply_id}`) }, 1200)
    } catch (err: any) { setCupsErr(err.message || 'Error desconocido') }
    finally { setCupsLoading(false) }
  }

  // ── PDF submit ──
  const handlePdfSubmit = async () => {
    if (!pdfFiles.length) return
    setPdfUploading(true); setPdfError('')
    try {
      const queuedFiles: QueuedFile[] = pdfFiles.map(lf => ({ id: lf.id, file: lf.file, url: '', storagePath: '', status: 'pending' }))
      const client = clients.find((c) => c.id === clientId)
      const clientName = client?.name || 'Auto-detectar cliente'
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`
      addJob({ id: jobId, clientId: clientId || '', clientName, files: queuedFiles, status: 'uploading', createdAt: Date.now() })
      onClose(); onCreated()
    } catch (err: any) { setPdfError(err.message || 'Error al encolar archivos'); setPdfUploading(false) }
  }

  // ── Excel import ──
  const handleXlsxImport = async () => {
    if (!xlsxFiles.length) return
    // Need either a selected client or a new client name
    if (!clientId && !newClientName.trim()) {
      setXlsxErr('Indica el nombre del cliente para asignar estos suministros')
      return
    }
    setXlsxImporting(true); setXlsxErr(''); setXlsxResults([])
    try {
      let accessToken: string | null = null
      try { const raw = localStorage.getItem('voltis-auth'); if (raw) accessToken = JSON.parse(raw)?.access_token ?? null } catch {}

      const fd = new FormData()
      if (clientId) fd.append('clientId', clientId)
      if (!clientId && newClientName.trim()) fd.append('newClientName', newClientName.trim())
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
    } catch (err: any) { setXlsxErr(err.message || 'Error desconocido') }
    finally { setXlsxImporting(false) }
  }

  const totalFiles = pdfFiles.length + xlsxFiles.length
  const hasExcelOnly = xlsxFiles.length > 0 && !clientId

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
                  <h2 className="font-sans font-semibold text-ink">Importar Facturas</h2>
                  <p className="text-xs text-ink-3">PDF, imágenes o Excel · Se procesan automáticamente</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-xl text-ink-3 hover:bg-bg-2 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">

              {/* ─── Selector de cliente ─────────────────────────────────── */}
              <div className="space-y-2">
                <SearchableClientSelector
                  label="Cliente (opcional)"
                  value={clientId}
                  onChange={(id) => { setClientId(id); if (id) setNewClientName('') }}
                  clients={clients}
                  placeholder="Buscar cliente existente..."
                  showAutoDetect
                />

                {/* Si hay Excels → campo de cliente SIEMPRE obligatorio */}
                {xlsxFiles.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-ink-3 mb-1.5 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5" />
                      Cliente para los suministros Excel <span className="text-err">*</span>
                    </label>
                    {!clientId ? (
                      <>
                        <input
                          type="text"
                          value={newClientName}
                          onChange={(e) => setNewClientName(e.target.value)}
                          placeholder="Nombre del cliente (se crea si no existe)"
                          autoFocus
                          className={`w-full h-10 px-3 rounded-xl border text-sm bg-bg-2 outline-none focus:border-brand/60 text-ink transition-all ${
                            xlsxErr && !newClientName.trim() ? 'border-err/50' : 'border-line-2-variant/40'
                          }`}
                        />
                        <p className="mt-1 text-[10px] text-ink-3/70">
                          O selecciona un cliente existente en el desplegable de arriba
                        </p>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-ok-container/20 border border-ok/20 text-sm text-ink">
                        <CheckCircle2 className="w-4 h-4 text-ok flex-shrink-0" />
                        <span className="flex-1 truncate">{clients.find(c => c.id === clientId)?.name}</span>
                        <button onClick={() => setClientId('')} className="text-ink-3 hover:text-err text-xs">cambiar</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ─── Crear desde CUPS ────────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-outline-variant/30" />
                  <span className="text-[10px] font-semibold tracking-wider text-ink-3/60 uppercase">Crear desde CUPS</span>
                  <div className="flex-1 h-px bg-outline-variant/30" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-3 mb-1.5">CUPS del suministro</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={cupsInput}
                      onChange={(e) => handleCupsChange(e.target.value)}
                      placeholder="ES0021000000000000AB"
                      maxLength={22}
                      disabled={cupsLoading || !!cupsSuccessId}
                      className={`w-full h-10 px-3 pr-9 rounded-xl border text-sm font-mono bg-bg-2 outline-none transition-all
                        ${cupsSuccessId ? 'border-success/50 text-ok'
                          : cupsInput.length > 0 && !cupsValid ? 'border-error/40 text-ink'
                          : cupsValid ? 'border-success/50 text-ink'
                          : 'border-line-2-variant/40 text-ink'}
                        focus:border-brand/60 disabled:opacity-60`}
                    />
                    {cupsSuccessId ? <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ok" />
                      : cupsValid ? <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-success/60" />
                      : null}
                  </div>
                  {cupsSuccessMsg && <p className="mt-1.5 text-xs text-ok font-medium">{cupsSuccessMsg}</p>}
                  {cupsErr        && <p className="mt-1.5 text-xs text-err">{cupsErr}</p>}
                  {cupsValid && !cupsSuccessId && !clientId && !cupsErr && (
                    <p className="mt-1.5 text-xs text-warn">⚠ Selecciona un cliente arriba para continuar</p>
                  )}
                </div>

                {cupsValid && !cupsSuccessId && (
                  <button
                    onClick={handleCreateFromCups}
                    disabled={cupsLoading || !clientId}
                    className={`w-full flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium transition-all
                      ${clientId ? 'bg-brand text-on-secondary hover:opacity-90 active:scale-[0.98]'
                        : 'bg-bg-2 text-ink-3/50 cursor-not-allowed'} disabled:opacity-60`}
                  >
                    {cupsLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Consultando SIPS...</>
                      : <><Zap className="w-4 h-4" />Crear suministro desde SIPS</>}
                  </button>
                )}
              </div>

              {/* ─── Zona unificada de archivos ──────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-outline-variant/30" />
                  <span className="text-[10px] font-semibold tracking-wider text-ink-3/60 uppercase">
                    Importar facturas o Excel
                  </span>
                  <div className="flex-1 h-px bg-outline-variant/30" />
                </div>

                {/* Drop zone */}
                {xlsxResults.length === 0 && (
                  <>
                    <div
                      ref={dragZoneRef}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className="border-2 border-dashed border-line-2-variant/40 rounded-2xl p-7 text-center transition-all cursor-pointer hover:border-brand/40 hover:bg-secondary/5"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="flex items-center justify-center gap-3 mb-2">
                        <Upload className="w-6 h-6 text-brand/70" />
                        <TableIcon className="w-6 h-6 text-brand/70" />
                      </div>
                      <p className="text-sm font-medium text-ink">Arrastra aquí tus facturas o Excel</p>
                      <p className="text-xs text-ink-3 mt-1">
                        PDF · Imágenes · Excel (.xlsx) — Los Excel se importan directamente
                      </p>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.xlsx"
                      onChange={handleFileInputChange}
                      className="hidden"
                    />

                    {/* PDF file list */}
                    {pdfFiles.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-ink-3 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          {pdfFiles.length} factura{pdfFiles.length !== 1 ? 's' : ''} PDF/imagen
                        </p>
                        <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                          {pdfFiles.map(({ id, file }) => (
                            <div key={id} className="flex items-center gap-2 py-1.5 px-3 bg-bg-2 rounded-lg text-xs">
                              <FileText className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
                              <span className="flex-1 truncate text-ink">{file.name}</span>
                              <span className="text-ink-3">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                              <button onClick={() => setPdfFiles(p => p.filter(f => f.id !== id))} className="p-0.5 text-ink-3 hover:text-err flex-shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-ink-3 bg-secondary/5 border border-brand/20 rounded-xl px-4 py-2.5 leading-relaxed">
                          Al pulsar <b className="text-ink">Procesar</b>, las facturas se analizarán en segundo plano.
                          {!clientId && <span className="text-ink-3"> El cliente se detectará automáticamente de cada factura.</span>}
                        </p>
                      </div>
                    )}

                    {/* Excel file list */}
                    {xlsxFiles.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-ink-3 flex items-center gap-1.5">
                          <TableIcon className="w-3.5 h-3.5 text-brand/70" />
                          {xlsxFiles.length} Excel — importación directa
                        </p>
                        <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                          {xlsxFiles.map(({ id, file }) => (
                            <div key={id} className="flex items-center gap-2 py-1.5 px-3 bg-secondary/5 border border-brand/15 rounded-lg text-xs">
                              <TableIcon className="w-3.5 h-3.5 text-brand/60 flex-shrink-0" />
                              <span className="flex-1 truncate text-ink">{file.name}</span>
                              <span className="text-ink-3">{(file.size / 1024).toFixed(0)} KB</span>
                              <button onClick={() => { setXlsxFiles(p => p.filter(f => f.id !== id)); setXlsxResults([]) }} className="p-0.5 text-ink-3 hover:text-err flex-shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Errors */}
                    {pdfError && (
                      <div className="bg-err-container rounded-xl px-4 py-2.5 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-err flex-shrink-0" />
                        <p className="text-sm text-err font-medium">{pdfError}</p>
                      </div>
                    )}
                    {xlsxErr && (
                      <div className="bg-err-container rounded-xl px-4 py-2.5 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-err flex-shrink-0" />
                        <p className="text-sm text-err font-medium">{xlsxErr}</p>
                      </div>
                    )}
                  </>
                )}

                {/* Excel results */}
                {xlsxResults.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-ink">Resultado de la importación</p>
                      <button onClick={() => { setXlsxFiles([]); setXlsxResults([]) }} className="text-[10px] text-brand hover:underline">Importar más</button>
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {xlsxResults.map((r, i) => (
                        <div key={i} className={`rounded-xl px-3 py-2.5 text-xs border ${r.ok ? 'bg-ok-container/20 border-ok/20' : 'bg-err-container/20 border-err/20'}`}>
                          <div className="flex items-center gap-2">
                            {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-ok flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-err flex-shrink-0" />}
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
                    <button onClick={onClose} className="w-full h-9 rounded-xl text-sm font-medium bg-brand text-white hover:opacity-90 transition-all">
                      Cerrar
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Footer — acciones según qué archivos hay */}
            {xlsxResults.length === 0 && totalFiles > 0 && (
              <div className="flex gap-3 justify-end px-6 py-4 border-t border-line-2-variant/30 flex-shrink-0 flex-wrap">
                <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>

                {/* Procesar PDFs */}
                {pdfFiles.length > 0 && (
                  <Button onClick={handlePdfSubmit} disabled={pdfUploading}>
                    {pdfUploading ? 'Subiendo…' : `Procesar ${pdfFiles.length} factura${pdfFiles.length !== 1 ? 's' : ''}`}
                  </Button>
                )}

                {/* Importar Excel */}
                {xlsxFiles.length > 0 && (
                  <Button
                    onClick={handleXlsxImport}
                    disabled={xlsxImporting || (!clientId && !newClientName.trim())}
                    title={!clientId && !newClientName.trim() ? 'Indica un cliente para los Excel' : undefined}
                  >
                    {xlsxImporting
                      ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Importando…</>
                      : <><TableIcon className="w-4 h-4 mr-1" />Importar {xlsxFiles.length} Excel</>}
                  </Button>
                )}
              </div>
            )}

            {/* Footer fallback — sin archivos */}
            {xlsxResults.length === 0 && totalFiles === 0 && (
              <div className="flex gap-3 justify-end px-6 py-4 border-t border-line-2-variant/30 flex-shrink-0">
                <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
