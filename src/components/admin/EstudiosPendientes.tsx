'use client'

/**
 * EstudiosPendientes.tsx — sección del panel admin con las tareas pendientes
 * de subir estudio económico. Cada card es una dropzone que acepta PDF/XLSX:
 * al soltar, modal de confirmación → upload → marca tarea completada → desaparece.
 *
 * Solo se muestra a usuarios con role='admin' (el endpoint lo refuerza).
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, FileSpreadsheet, Upload, Zap, Flame, ChevronRight,
  Loader2, X, AlertCircle, CheckCircle2,
} from 'lucide-react'

interface AdminTask {
  id: string
  type: 'estudio_economico_pendiente'
  supply_id: string
  client_id: string
  created_at: string
  invoiceCount: number
  supply: {
    id: string
    cups: string | null
    tariff: string | null
    type: string
    name: string | null
    address: string | null
  } | null
  client: {
    id: string
    name: string
    alias: string | null
    cif: string | null
    nif: string | null
    cif_nif: string | null
    commercial_id: string | null
    commercial: {
      id: string
      full_name: string | null
      nickname: string | null
      email: string | null
    } | null
  } | null
}

interface PendingDrop {
  task: AdminTask
  file: File
}

export function EstudiosPendientes() {
  const router = useRouter()
  const [tasks, setTasks] = useState<AdminTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin-tasks')
      const data = await res.json()
      if (!res.ok) {
        // Si el endpoint devuelve 403 (no admin) ocultamos la sección sin mostrar error
        if (res.status === 403) { setTasks([]); return }
        throw new Error(data.error || 'Error cargando tareas')
      }
      setTasks(data.tasks || [])
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // ── Drag & drop ─────────────────────────────────────────────────────────
  const handleDragOver = (taskId: string) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    setDragOverId(taskId)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    setDragOverId(null)
  }
  const handleDrop = (task: AdminTask) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    setDragOverId(null)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setPendingDrop({ task, file })
  }
  const handleFileInput = (task: AdminTask) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingDrop({ task, file })
    e.target.value = ''  // permite re-seleccionar el mismo archivo
  }

  // ── Confirm + subida ────────────────────────────────────────────────────
  const confirmUpload = async () => {
    if (!pendingDrop) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', pendingDrop.file)
      const res = await fetch(`/api/admin-tasks/${pendingDrop.task.id}/complete`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error subiendo')
      // Quitar la tarea de la lista
      setTasks(prev => prev.filter(t => t.id !== pendingDrop.task.id))
      setToast({ type: 'ok', msg: `Estudio guardado para ${clientLabel(pendingDrop.task)}` })
      setTimeout(() => setToast(null), 3500)
    } catch (e: any) {
      setToast({ type: 'err', msg: e?.message || 'Error subiendo' })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setUploading(false)
      setPendingDrop(null)
    }
  }

  // No mostramos el bloque si no hay tareas y no estamos cargando
  if (!loading && tasks.length === 0 && !error) return null

  return (
    <section className="mt-6">
      <header className="flex items-end justify-between mb-3 px-1">
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-ink-3 mb-1">Tracker admin</div>
          <h2 className="text-lg font-bold text-ink">Estudios económicos pendientes</h2>
        </div>
        {tasks.length > 0 && (
          <div className="text-xs text-ink-3">
            <span className="font-bold text-[#4A6FE3]">{tasks.length}</span> pendiente{tasks.length === 1 ? '' : 's'}
          </div>
        )}
      </header>

      {loading && (
        <div className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando tareas…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-err/40 bg-err-container/40 p-4 text-sm text-err flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {tasks.map(task => {
            const isGas = task.supply?.type === 'gas' || /^RL/i.test(task.supply?.tariff || '')
            const TypeIcon = isGas ? Flame : Zap
            const drag = dragOverId === task.id
            return (
              <div
                key={task.id}
                onDragOver={handleDragOver(task.id)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(task)}
                onClick={() => router.push(`/supplies/${task.supply_id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    router.push(`/supplies/${task.supply_id}`)
                  }
                }}
                className={`relative rounded-xl border transition-all cursor-pointer ${
                  drag
                    ? 'border-2 border-[#4A6FE3] bg-blue-50 scale-[1.01]'
                    : 'border border-line bg-card hover:border-[#A8C8F0] hover:shadow-sm'
                }`}
                style={{ padding: 10 }}
                title={`Abrir ${clientLabel(task)}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isGas ? 'bg-warn-container/40 text-warn' : 'bg-blue-100 text-[#4A6FE3]'}`}>
                    <TypeIcon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-ink truncate">
                        {clientLabel(task)}
                      </span>
                      <CommercialBadge commercial={task.client?.commercial} />
                    </div>
                    <div className="text-[10px] text-ink-3 truncate font-mono">
                      {task.supply?.cups
                        ? `${task.supply.cups.slice(0, 4)}…${task.supply.cups.slice(-6)}`
                        : 'Sin CUPS'}
                      {task.supply?.tariff && ` · ${task.supply.tariff}`}
                    </div>
                  </div>
                  <div className="text-[10px] text-ink-4 flex-shrink-0">
                    <span className="font-semibold text-ink-2">{task.invoiceCount}</span> fra.
                  </div>
                </div>

                {/* Dropzone — al hacer click NO debe navegar al supply, solo abrir el file picker */}
                <label
                  htmlFor={`file-${task.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg cursor-pointer transition text-[10px] font-semibold ${
                    drag
                      ? 'bg-[#4A6FE3] text-white'
                      : 'bg-bg-2 text-ink-2 hover:bg-blue-50 hover:text-[#4A6FE3]'
                  }`}
                >
                  <Upload className="w-3 h-3" />
                  {drag ? 'Suelta el estudio' : 'Arrastra o sube el estudio'}
                  <input
                    id={`file-${task.id}`}
                    type="file"
                    className="hidden"
                    accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileInput(task)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de confirmación */}
      {pendingDrop && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !uploading && setPendingDrop(null)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 border border-line"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-ink mb-1">Confirmar estudio económico</h3>
            <p className="text-sm text-ink-3 mb-4">¿Quieres adjuntar este archivo como <b>estudio económico</b> del suministro?</p>

            <div className="rounded-xl border border-line bg-bg-2 p-3 mb-4 flex items-center gap-3">
              {/\.pdf$/i.test(pendingDrop.file.name)
                ? <FileText className="w-8 h-8 text-[#DC2626]" />
                : <FileSpreadsheet className="w-8 h-8 text-[#16a34a]" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink truncate">{pendingDrop.file.name}</div>
                <div className="text-xs text-ink-3">{(pendingDrop.file.size / 1024).toLocaleString('es-ES', { maximumFractionDigits: 0 })} KB</div>
              </div>
            </div>

            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 mb-4 text-xs text-slate-700">
              <div><b>Cliente:</b> {clientLabel(pendingDrop.task)}</div>
              <div className="font-mono mt-1"><b>CUPS:</b> {pendingDrop.task.supply?.cups || '—'}</div>
              <div className="mt-1"><b>Tarifa:</b> {pendingDrop.task.supply?.tariff || '—'}</div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDrop(null)}
                disabled={uploading}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-ink-2 hover:bg-bg-2 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmUpload}
                disabled={uploading}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#4A6FE3] hover:bg-[#2E4FBF] transition flex items-center gap-2 disabled:opacity-60"
              >
                {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Subiendo…</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Confirmar y adjuntar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[300] rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-medium ${
          toast.type === 'ok' ? 'bg-[#16a34a] text-white' : 'bg-[#DC2626] text-white'
        }`}>
          {toast.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-1 opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </section>
  )
}

function clientLabel(t: AdminTask): string {
  const c = t.client
  if (!c) return t.supply?.name || 'Cliente sin nombre'
  return c.alias || c.name || 'Cliente sin nombre'
}

/** Iniciales a partir de un nombre: "Jokin de Irala" → "JDI". */
function initialsFrom(name: string): string {
  const stop = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'van', 'von', 'di', 'le'])
  const words = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/\s+/).filter(w => w.length > 0 && !stop.has(w.toLowerCase()))
  return words.map(w => w.charAt(0).toUpperCase()).join('').slice(0, 4) || '?'
}

/**
 * Badge con las iniciales del comercial responsable. Si users_profile tiene
 * nickname, se usa directamente; si no, se deriva del full_name (regla del
 * client-matcher: ignora partículas de/la/del/etc).
 */
export function CommercialBadge({ commercial }: {
  commercial?: { full_name: string | null; nickname: string | null; email: string | null } | null
}) {
  if (!commercial) return null
  const initials = commercial.nickname || (commercial.full_name ? initialsFrom(commercial.full_name) : null)
  if (!initials) return null
  const label = commercial.full_name || commercial.email || 'Comercial'
  return (
    <span
      title={`Comercial: ${label}`}
      className="inline-flex items-center justify-center min-w-[28px] h-[22px] px-1.5 rounded-md bg-[#4A6FE3] text-white text-[10px] font-bold tracking-wider flex-shrink-0"
    >
      {initials}
    </span>
  )
}
