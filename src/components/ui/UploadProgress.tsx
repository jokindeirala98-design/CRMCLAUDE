'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUploadQueue, type UploadJob } from '@/stores/upload-queue'
import {
  X, ChevronDown, ChevronUp, Check, AlertCircle, Loader2,
  FileText, CheckCircle2, Minimize2,
} from 'lucide-react'

/**
 * Floating upload progress widget — renders in the bottom-right corner.
 * Supports multiple concurrent jobs, each independently expandable.
 * Auto-dismisses completed jobs after 8 seconds.
 * Positioned above the mobile bottom nav (pb-20 on mobile).
 */
export function UploadProgress() {
  const { jobs, removeJob, isProcessing } = useUploadQueue()
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())
  const [minimized, setMinimized] = useState(false)
  const autoDismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Auto-expand new jobs
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'analyzing' || job.status === 'uploading') {
        setExpandedJobs((prev) => {
          if (prev.has(job.id)) return prev
          const next = new Set(prev)
          next.add(job.id)
          return next
        })
        setMinimized(false)
      }
    }
  }, [jobs])

  // Auto-dismiss completed jobs after 8 seconds
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'done' && job.finishedAt && !autoDismissTimers.current.has(job.id)) {
        const timer = setTimeout(() => {
          removeJob(job.id)
          autoDismissTimers.current.delete(job.id)
        }, 8000)
        autoDismissTimers.current.set(job.id, timer)
      }
    }
    Array.from(autoDismissTimers.current.entries()).forEach(([id, timer]) => {
      if (!jobs.find((j) => j.id === id)) {
        clearTimeout(timer)
        autoDismissTimers.current.delete(id)
      }
    })
  }, [jobs, removeJob])

  const toggleJob = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  if (jobs.length === 0) return null

  // Summary for minimized state
  const activeJobs = jobs.filter((j) => j.status !== 'done' && j.status !== 'error')
  const totalFiles = jobs.reduce((s, j) => s + j.files.length, 0)
  const doneFiles = jobs.reduce((s, j) => s + j.files.filter((f) => f.status === 'done' || f.status === 'error').length, 0)
  const globalPct = totalFiles > 0 ? Math.round((doneFiles / totalFiles) * 100) : 0

  return (
    <div className="fixed bottom-24 lg:bottom-4 right-4 z-[60] flex flex-col items-end gap-2 pointer-events-none max-h-[70vh]">
      {minimized ? (
        /* ── Minimized pill ── */
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={() => setMinimized(false)}
          className="pointer-events-auto flex items-center gap-2 px-3 py-2 bg-surface rounded-full shadow-ambient-lg border border-outline-variant/30 hover:bg-surface-container-low transition-colors"
        >
          <div className="relative w-6 h-6">
            <svg className="w-6 h-6 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-outline-variant/20" />
              <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="text-secondary" stroke="currentColor"
                strokeDasharray={`${globalPct * 0.94} 100`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.5s ease' }}
              />
            </svg>
          </div>
          <span className="text-xs font-medium text-on-surface">
            {activeJobs.length > 0 ? `${globalPct}%` : 'Listo'}
          </span>
          <span className="text-[10px] text-on-surface-variant">
            {jobs.length} proyecto{jobs.length !== 1 ? 's' : ''}
          </span>
        </motion.button>
      ) : (
        /* ── Full widget ── */
        <div className="pointer-events-auto flex flex-col items-end gap-2 overflow-y-auto max-h-[70vh] pr-1">
          {/* Minimize button when multiple jobs */}
          {jobs.length > 1 && (
            <button
              onClick={() => setMinimized(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-surface rounded-full shadow-md border border-outline-variant/30 text-[10px] text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              <Minimize2 className="w-3 h-3" />
              Minimizar todo
            </button>
          )}

          <AnimatePresence mode="popLayout">
            {jobs.map((job, idx) => {
              // A job is "waiting" if it's active but there's another active job before it
              const activeIdx = jobs.findIndex(j => j.status === 'uploading' || j.status === 'analyzing')
              const isWaiting = (job.status === 'uploading' || job.status === 'analyzing') && idx > activeIdx && isProcessing

              return (
                <JobCard
                  key={job.id}
                  job={job}
                  isWaiting={isWaiting}
                  expanded={expandedJobs.has(job.id)}
                  onToggle={() => toggleJob(job.id)}
                  onRemove={() => removeJob(job.id)}
                />
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  JOB CARD                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

import { SearchableClientSelector } from './SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { processJobInBackground, retryFile } from '@/stores/upload-queue'
import { RefreshCw } from 'lucide-react'

function JobCard({
  job,
  isWaiting,
  expanded,
  onToggle,
  onRemove,
}: {
  job: UploadJob
  isWaiting: boolean
  expanded: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const { updateJob } = useUploadQueue()
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [isSelecting, setIsSelecting] = useState(false)

  // Fetch clients only if needed
  useEffect(() => {
    if (isSelecting && clients.length === 0) {
      const fetchClients = async () => {
        const supabase = createClient()
        const { data } = await supabase.from('clients').select('id, name').order('name')
        if (data) setClients(data)
      }
      fetchClients()
    }
  }, [isSelecting, clients.length])

  const handleSelectClient = async (clientId: string) => {
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    
    updateJob(job.id, { 
      clientId, 
      clientName: client.name,
      status: 'analyzing', // Resume
      errorMessage: undefined 
    })
    setIsSelecting(false)
    
    // Re-trigger global queue
    const { processQueue } = await import('@/stores/upload-queue')
    processQueue()
  }
  const total = job.files.length
  const done = job.files.filter((f) => f.status === 'done').length
  const errors = job.files.filter((f) => f.status === 'error').length
  const uploading = job.files.filter((f) => f.status === 'uploading').length
  const analyzing = job.files.filter((f) => f.status === 'analyzing').length
  const finished = done + errors
  const pct = total > 0 ? Math.round((finished / total) * 100) : 0

  const isDone = job.status === 'done'
  const isError = job.status === 'error'
  const isWorking = !isDone && !isError

  let statusLabel = ''
  let statusIcon = <Loader2 className="w-4 h-4 animate-spin" />
  
  if (isWaiting) {
    statusLabel = 'En cola...'
    statusIcon = <Loader2 className="w-4 h-4 text-on-surface-variant/40" />
  } else if (job.status === 'uploading') {
    statusLabel = uploading > 0 ? `Subiendo ${uploading} de ${total}...` : 'Iniciando subida...'
  } else if (job.status === 'analyzing') {
    statusLabel = analyzing > 0 ? `Analizando ${analyzing}...` : `Procesando ${total} archivos...`
  } else if (job.status === 'grouping') {
    statusLabel = 'Agrupando por CUPS...'
  } else if (job.status === 'creating') {
    statusLabel = 'Finalizando proyecto...'
  } else if (isDone) {
    statusLabel = `${done} archivo${done !== 1 ? 's' : ''} procesado${done !== 1 ? 's' : ''}`
    statusIcon = <CheckCircle2 className="w-4 h-4 text-success" />
  } else if (isError) {
    statusLabel = job.errorMessage || 'Error'
    statusIcon = <AlertCircle className="w-4 h-4 text-error" />
  }

  const ringColor = isDone ? 'border-success/30' : isError ? 'border-error/30' : isWorking && !isWaiting ? 'border-secondary/30' : 'border-outline-variant/20'
  const barColor = isDone ? 'bg-success' : isError ? 'bg-error' : isWaiting ? 'bg-outline-variant/30' : 'bg-secondary'

  const isAutoDetectFail = isError && !job.clientId && job.errorMessage?.includes('detectar')

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.9 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className={`bg-surface rounded-2xl shadow-ambient-lg border ${ringColor} overflow-hidden transition-colors`}
      style={{ width: expanded ? 340 : 260 }}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-surface-container-low/50 transition-colors text-left"
      >
        <div className="relative flex-shrink-0">
          {isWorking ? (
            <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-outline-variant/20" />
              {!isWaiting && (
                <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="text-secondary" stroke="currentColor"
                  strokeDasharray={`${pct * 0.94} 100`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.5s ease' }}
                />
              )}
              <text x="18" y="19" textAnchor="middle" dominantBaseline="middle"
                className={`fill-on-surface text-[9px] font-bold ${isWaiting ? 'opacity-40' : ''}`}
                style={{ transform: 'rotate(90deg)', transformOrigin: '18px 18px' }}
              >
                {pct}
              </text>
            </svg>
          ) : (
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isDone ? 'bg-success/10' : 'bg-error/10'}`}>
              {statusIcon}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-on-surface truncate">{job.clientName || 'Sin nombre'}</p>
          <p className="text-[11px] text-on-surface-variant truncate">{statusLabel}</p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-on-surface-variant" />
            : <ChevronUp className="w-3.5 h-3.5 text-on-surface-variant" />}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="p-1 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/30 transition-all"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </button>

      {/* Progress bar */}
      {isWorking && (
        <div className="h-1 bg-surface-container-low">
          <div className={`h-full ${barColor} transition-all duration-500 ease-out`} style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* Manual Selection Fallback */}
      {isAutoDetectFail && !isSelecting && (
        <div className="px-3.5 py-2.5 bg-error-container/10 border-t border-error/5">
          <button
            onClick={(e) => { e.stopPropagation(); setIsSelecting(true) }}
            className="w-full py-2 bg-error text-white rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-error/90 transition-colors shadow-sm"
          >
            Seleccionar Cliente Manualmente
          </button>
        </div>
      )}

      {isSelecting && (
        <div className="p-3 bg-surface border-t border-outline-variant/20 pointer-events-auto">
          <SearchableClientSelector
            clients={clients}
            value=""
            onChange={handleSelectClient}
            placeholder="Escribe el nombre..."
            label="Asignar Cliente"
          />
          <button 
            onClick={() => setIsSelecting(false)}
            className="w-full mt-2 py-1 text-[10px] text-on-surface-variant hover:text-on-surface"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Expanded file list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 py-2 max-h-48 overflow-y-auto space-y-1 border-t border-outline-variant/15">
              {job.files.map((f) => (
                <div key={f.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                  <FileText className="w-3 h-3 text-on-surface-variant flex-shrink-0" />
                  <span className="flex-1 truncate text-on-surface">{f.file.name}</span>
                  
                  {f.status === 'pending' && <span className="text-on-surface-variant opacity-50">Cola</span>}
                  {f.status === 'uploading' && <span className="text-secondary animate-pulse">Subiendo...</span>}
                  {f.status === 'classifying' && <span className="text-secondary">Escaneando...</span>}
                  {f.status === 'analyzing' && <Loader2 className="w-3 h-3 animate-spin text-secondary flex-shrink-0" />}
                  
                  {f.status === 'done' && !f.error && (
                    <div className="flex items-center gap-1">
                       {f.extractedData?.documentType !== 'factura' && (
                         <span className="px-1 py-0.5 bg-secondary/10 text-secondary rounded text-[8px] font-bold uppercase">
                           {f.extractedData?.documentType || 'Doc'}
                         </span>
                       )}
                       <Check className="w-3 h-3 text-success flex-shrink-0" />
                    </div>
                  )}
                  {f.status === 'done' && f.error && (
                    <div className="flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 text-warning flex-shrink-0" />
                      <button
                        onClick={(e) => { e.stopPropagation(); retryFile(job.id, f.id) }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-wider hover:bg-primary/20 transition-colors"
                        title="Reescanear este archivo"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        Reescanear
                      </button>
                    </div>
                  )}
                  {f.status === 'error' && (
                    <div className="flex items-center gap-1">
                      <div className="group relative">
                        <AlertCircle className="w-3 h-3 text-error flex-shrink-0 cursor-help" />
                        <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 shadow-xl border border-white/10 leading-tight">
                          {f.error || 'Error desconocido'}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); retryFile(job.id, f.id) }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-wider hover:bg-primary/20 transition-colors"
                        title="Reescanear este archivo"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        Reescanear
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {(job.status === 'creating' || isDone) && (
                <div className="pt-1 mt-1 border-t border-outline-variant/10 text-[11px] text-on-surface-variant">
                  {isDone ? (
                    <span className="text-success font-medium">
                      Completado{errors > 0 ? ` · ${errors} con error` : ''}
                    </span>
                  ) : (
                    <span>Sincronizando con base de datos...</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
