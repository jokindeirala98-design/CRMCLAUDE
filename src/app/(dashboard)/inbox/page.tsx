'use client'

/**
 * /inbox — "Estudios pendientes"
 *
 * Página dedicada a los estudios económicos pendientes de hacer.
 * Reemplaza el antiguo wizard de subida de facturas (esa funcionalidad
 * vive ahora en la ficha de cliente / suministro).
 *
 * - Admin: ve TODAS las tareas pendientes del sistema.
 * - Comercial: ve solo las tareas de SUS clientes.
 *
 * Vista:
 *   - Orden cronológico FIFO (más antiguas primero).
 *   - Agrupadas por tarifa: 6.1TD · 3.0TD · 2.0TD · GAS.
 *   - Cada card es una dropzone que acepta PDF/XLSX para adjuntar el
 *     estudio económico (solo admin: si el endpoint responde 403,
 *     mostramos un toast informativo).
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, AlertCircle, FileText, FileSpreadsheet, Upload,
  Zap, Flame, CheckCircle2, X, Inbox as InboxIcon,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { CommercialBadge } from '@/components/admin/EstudiosPendientes'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PendingTask {
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
    created_at?: string
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

type Bucket = '6.1TD' | '3.0TD' | '2.0TD' | 'GAS' | 'OTRA'

// ─── Tariff bucketing ────────────────────────────────────────────────────────

function bucketFor(task: PendingTask): Bucket {
  const supply = task.supply
  const t = (supply?.tariff || '').replace(/\s+/g, '').toUpperCase()
  const isGas = supply?.type === 'gas' || /^RL/i.test(t)
  if (isGas) return 'GAS'
  if (t.startsWith('6.1') || t.startsWith('6.2') || t.startsWith('6.3') || t.startsWith('6.4')) return '6.1TD'
  if (t.startsWith('3.0')) return '3.0TD'
  if (t.startsWith('2.0') || t === '20TD' || t === '20DHA') return '2.0TD'
  return 'OTRA'
}

const BUCKET_ORDER: Bucket[] = ['6.1TD', '3.0TD', '2.0TD', 'GAS', 'OTRA']

const BUCKET_META: Record<Bucket, {
  label: string
  short: string
  description: string
  Icon: typeof Zap
  iconBg: string
  iconColor: string
  accent: string
}> = {
  '6.1TD': {
    label: '6.1TD',
    short: '6.1',
    description: 'Alta tensión / grandes consumidores',
    Icon: Zap,
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-700',
    accent: 'border-l-purple-400',
  },
  '3.0TD': {
    label: '3.0TD',
    short: '3.0',
    description: 'Industriales / empresariales',
    Icon: Zap,
    iconBg: 'bg-blue-100',
    iconColor: 'text-[#4A6FE3]',
    accent: 'border-l-[#4A6FE3]',
  },
  '2.0TD': {
    label: '2.0TD',
    short: '2.0',
    description: 'Hogares y pequeño negocio',
    Icon: Zap,
    iconBg: 'bg-green-100',
    iconColor: 'text-green-700',
    accent: 'border-l-green-400',
  },
  'GAS': {
    label: 'GAS',
    short: 'GAS',
    description: 'Suministros de gas natural',
    Icon: Flame,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    accent: 'border-l-amber-400',
  },
  'OTRA': {
    label: 'Sin tarifa',
    short: '—',
    description: 'Suministros sin tarifa detectada',
    Icon: Zap,
    iconBg: 'bg-bg-2',
    iconColor: 'text-ink-3',
    accent: 'border-l-line',
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clientLabel(t: PendingTask): string {
  const c = t.client
  if (!c) return t.supply?.name || 'Cliente sin nombre'
  return c.alias || c.name || 'Cliente sin nombre'
}

function shortCups(cups: string | null | undefined): string {
  if (!cups) return 'Sin CUPS'
  return `${cups.slice(0, 4)}…${cups.slice(-6)}`
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const day = 24 * 60 * 60 * 1000
  const days = Math.floor(diffMs / day)
  if (days < 1) return 'hoy'
  if (days < 2) return 'ayer'
  if (days < 7) return `hace ${days} días`
  if (days < 30) return `hace ${Math.floor(days / 7)} sem.`
  if (days < 365) return `hace ${Math.floor(days / 30)} meses`
  return `hace ${Math.floor(days / 365)} año${days >= 730 ? 's' : ''}`
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<PendingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ task: PendingTask; file: File } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err' | 'info'; msg: string } | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/inbox-pendientes', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error cargando estudios pendientes')
      setTasks(data.tasks || [])
      setIsAdmin(Boolean(data.isAdmin))
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // ── Drag & drop ──
  const onDragOver = (id: string) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragOverId(id)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragOverId(null)
  }
  const onDrop = (task: PendingTask) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragOverId(null)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setPendingDrop({ task, file })
  }
  const onFileInput = (task: PendingTask) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingDrop({ task, file })
    e.target.value = ''
  }

  // ── Confirm upload ──
  const confirmUpload = async () => {
    if (!pendingDrop) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', pendingDrop.file)
      const res = await fetch(`/api/admin-tasks/${pendingDrop.task.id}/complete`, {
        method: 'POST', body: fd,
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Solo los administradores pueden adjuntar el estudio económico. Pide al admin que lo suba.')
        }
        throw new Error(data.error || 'Error subiendo')
      }
      setTasks(prev => prev.filter(t => t.id !== pendingDrop.task.id))
      setToast({ type: 'ok', msg: `Estudio guardado para ${clientLabel(pendingDrop.task)}` })
      setTimeout(() => setToast(null), 3500)
    } catch (e: any) {
      setToast({ type: 'err', msg: e?.message || 'Error subiendo' })
      setTimeout(() => setToast(null), 5500)
    } finally {
      setUploading(false)
      setPendingDrop(null)
    }
  }

  // ── Agrupar por tarifa ──
  const grouped: Record<Bucket, PendingTask[]> = {
    '6.1TD': [], '3.0TD': [], '2.0TD': [], 'GAS': [], 'OTRA': [],
  }
  for (const t of tasks) grouped[bucketFor(t)].push(t)
  // Cada grupo ya viene ordenado por fecha asc desde el endpoint
  const nonEmptyBuckets = BUCKET_ORDER.filter(b => grouped[b].length > 0)

  return (
    <div className="min-h-screen bg-bg">
      <Header
        title="Estudios pendientes"
        subtitle={tasks.length > 0
          ? `${tasks.length} pendiente${tasks.length === 1 ? '' : 's'} · más antiguos primero`
          : 'Sin estudios pendientes'}
      />

      <main className="px-4 lg:px-6 py-6 max-w-7xl mx-auto">
        {loading && (
          <div className="rounded-2xl border border-line bg-card p-6 text-sm text-ink-3 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando estudios pendientes…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl border border-err/40 bg-err-container/40 p-4 text-sm text-err flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {!loading && !error && tasks.length === 0 && (
          <div className="rounded-2xl border border-line bg-card p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-bg-2 mx-auto mb-3 flex items-center justify-center">
              <InboxIcon className="w-5 h-5 text-ink-3" />
            </div>
            <p className="text-sm font-medium text-ink">Nada pendiente</p>
            <p className="text-xs text-ink-3 mt-1">
              {isAdmin
                ? 'No hay estudios pendientes en el sistema.'
                : 'No tienes estudios pendientes de hacer.'}
            </p>
          </div>
        )}

        {!loading && !error && tasks.length > 0 && (
          <div className="space-y-6">
            {nonEmptyBuckets.map((bucket) => {
              const meta = BUCKET_META[bucket]
              const items = grouped[bucket]
              return (
                <section key={bucket}>
                  <header className="flex items-baseline justify-between mb-3 px-1">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-base font-bold text-ink">{meta.label}</h2>
                      <span className="text-xs text-ink-3 hidden sm:inline">{meta.description}</span>
                    </div>
                    <div className="text-xs text-ink-3">
                      <span className="font-bold text-ink">{items.length}</span> pendiente{items.length === 1 ? '' : 's'}
                    </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {items.map((task) => {
                      const drag = dragOverId === task.id
                      return (
                        <div
                          key={task.id}
                          onDragOver={onDragOver(task.id)}
                          onDragLeave={onDragLeave}
                          onDrop={onDrop(task)}
                          onClick={() => router.push(`/supplies/${task.supply_id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              router.push(`/supplies/${task.supply_id}`)
                            }
                          }}
                          className={`relative rounded-xl border border-l-4 ${meta.accent} transition-all cursor-pointer ${
                            drag
                              ? 'border-2 border-[#4A6FE3] bg-blue-50 scale-[1.01]'
                              : 'border-line bg-card hover:border-[#A8C8F0] hover:shadow-sm'
                          }`}
                          style={{ padding: 10 }}
                          title={`Abrir ${clientLabel(task)}`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.iconBg} ${meta.iconColor}`}>
                              <meta.Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-ink truncate">{clientLabel(task)}</span>
                                <CommercialBadge commercial={task.client?.commercial} />
                              </div>
                              <div className="text-[10px] text-ink-3 truncate font-mono">
                                {shortCups(task.supply?.cups)}
                                {task.supply?.tariff && ` · ${task.supply.tariff}`}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-[10px] text-ink-4 leading-tight">
                                {formatRelative(task.created_at)}
                              </div>
                              <div className="text-[10px] text-ink-4 leading-tight">
                                <span className="font-semibold text-ink-2">{task.invoiceCount}</span> fra.
                              </div>
                            </div>
                          </div>

                          {/* Dropzone */}
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
                              onChange={onFileInput(task)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </main>

      {/* Modal confirmación */}
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
            <p className="text-sm text-ink-3 mb-4">¿Adjuntar este archivo como <b>estudio económico</b> del suministro?</p>

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
          toast.type === 'ok' ? 'bg-[#16a34a] text-white'
            : toast.type === 'err' ? 'bg-[#DC2626] text-white'
            : 'bg-slate-700 text-white'
        }`}>
          {toast.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-1 opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
