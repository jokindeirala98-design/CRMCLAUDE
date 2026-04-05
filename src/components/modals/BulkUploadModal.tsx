'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Upload, FileText, AlertCircle } from 'lucide-react'
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COMPONENT                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function BulkUploadModal({ open, onClose, onCreated, preselectedClientId }: BulkUploadModalProps) {
  const [localFiles, setLocalFiles] = useState<{ id: string; file: File }[]>([])
  const [clientId, setClientId] = useState(preselectedClientId || '')
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const dragZoneRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addJob = useUploadQueue((s) => s.addJob)

  // ── Initialize ──
  useEffect(() => {
    if (!open) return
    setLocalFiles([])
    setError('')
    setUploading(false)
    setClientId(preselectedClientId || '')

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
    dragZoneRef.current?.classList.add('border-secondary/60', 'bg-secondary/5')
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragZoneRef.current?.classList.remove('border-secondary/60', 'bg-secondary/5')
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragZoneRef.current?.classList.remove('border-secondary/60', 'bg-secondary/5')
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

  // ── Submit: upload to storage, create job, close ──
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
        url: '', // Will be filled in the background
        storagePath: '', // Will be filled in the background
        status: 'pending',
      }))

      // Get client name for the widget
      const client = clients.find((c) => c.id === clientId)
      const clientName = client?.name || 'Auto-detectar cliente'

      // Create background job
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`
      addJob({
        id: jobId,
        clientId: clientId || '', // Can be empty, processor will find/create it
        clientName,
        files: queuedFiles,
        status: 'uploading',
        createdAt: Date.now(),
      })

      // Close modal immediately — user is free
      onClose()
      
      // OnCreated is still called to potentially refresh some parent state
      onCreated()
    } catch (err: any) {
      setError(err.message || 'Error al encolar archivos')
      setUploading(false)
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
            className="bg-surface rounded-2xl shadow-ambient-lg w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/30 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-secondary/10 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-secondary" />
                </div>
                <div>
                  <h2 className="font-display font-semibold text-on-surface">
                    Importar Facturas
                  </h2>
                  <p className="text-xs text-on-surface-variant">
                    Se procesarán en segundo plano
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-low transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {/* Client selector */}
                <SearchableClientSelector
                  label="Cliente"
                  value={clientId}
                  onChange={setClientId}
                  clients={clients}
                  placeholder="Buscar cliente (o dejar vacío para auto-detectar)"
                />

              {/* Drop zone */}
              <div
                ref={dragZoneRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed border-outline-variant/40 rounded-2xl p-8 text-center transition-all cursor-pointer hover:border-secondary/40 hover:bg-secondary/5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-secondary mx-auto mb-3" />
                <p className="text-sm font-medium text-on-surface">
                  Arrastra todas las facturas aquí
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
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
                  <p className="text-xs font-medium text-on-surface-variant">
                    {localFiles.length} archivo{localFiles.length !== 1 ? 's' : ''} seleccionado{localFiles.length !== 1 ? 's' : ''}
                  </p>
                  <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                    {localFiles.map((lf) => (
                      <div key={lf.id} className="flex items-center gap-2 py-1.5 px-3 bg-surface-container-low rounded-lg text-xs">
                        <FileText className="w-3.5 h-3.5 text-on-surface-variant flex-shrink-0" />
                        <span className="flex-1 truncate text-on-surface">{lf.file.name}</span>
                        <span className="text-on-surface-variant">{(lf.file.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button
                          onClick={() => removeFile(lf.id)}
                          className="p-0.5 text-on-surface-variant hover:text-error flex-shrink-0"
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
                <div className="bg-secondary/5 border border-secondary/20 rounded-xl px-4 py-3 text-xs text-on-surface-variant">
                  <p>
                    Al pulsar <b className="text-on-surface">Procesar</b>, el modal se cerrará y las facturas se
                    analizarán en segundo plano. Podrás seguir usando la app normalmente.
                    Verás el progreso en la esquina inferior derecha.
                  </p>
                </div>
              )}

              {error && (
                <div className="bg-error-container rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />
                  <p className="text-sm text-error font-medium">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 justify-end px-6 py-4 border-t border-outline-variant/30 flex-shrink-0">
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
