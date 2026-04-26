'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import {
  Download,
  CheckCircle2,
  Circle,
  Send,
  Loader2,
  ChevronDown,
  Search,
  AlertTriangle,
  Clock,
  Zap,
  XCircle,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Prescoring, PrescoringStatus } from '@/types/database'

// ---- COLUMN DEFINITIONS (desktop table) ----
interface Column {
  key: string
  label: string
  width: string
  editable: boolean
  align?: 'left' | 'center' | 'right'
}

const COLUMNS: Column[] = [
  { key: 'status_action', label: '', width: 'w-12', editable: false, align: 'center' },
  { key: 'requested_at', label: 'FECHA', width: 'w-28', editable: false },
  { key: 'cups', label: 'CUPS', width: 'w-52', editable: true },
  { key: 'client_name', label: 'NOMBRE', width: 'w-44', editable: true },
  { key: 'cif', label: 'CIF', width: 'w-28', editable: true },
  { key: 'producto', label: 'PRODUCTO', width: 'w-28', editable: true },
  { key: 'tariff', label: 'TARIFA', width: 'w-24', editable: true },
  { key: 'consumo_anual', label: 'CONSUMO', width: 'w-28', editable: true },
  { key: 'entidad', label: 'ENTIDAD', width: 'w-28', editable: true },
  { key: 'telefono', label: 'TELÉFONO', width: 'w-28', editable: true },
  { key: 'poblacion', label: 'POBLACIÓN', width: 'w-28', editable: true },
  { key: 'direccion_fiscal', label: 'DIR. FISCAL', width: 'w-44', editable: true },
  { key: 'delete', label: '', width: 'w-10', editable: false, align: 'center' },
]

// ---- HELPERS ----
function fmtDate(d: string | null) {
  if (!d) return '-'
  const dt = new Date(d)
  return dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function fmtDateShort(d: string | null) {
  if (!d) return '-'
  const dt = new Date(d)
  return dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}

function daysSinceSent(sentAt: string | null): number {
  if (!sentAt) return 0
  const sent = new Date(sentAt)
  const now = new Date()
  return Math.floor((now.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24))
}

function daysRemaining(sentAt: string | null): number {
  return Math.max(0, 7 - daysSinceSent(sentAt))
}

// ---- INLINE EDITABLE CELL ----
function EditableCell({
  value,
  onChange,
  editable,
}: {
  value: string
  onChange: (val: string) => void
  editable: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (!editable) {
    return <span className="text-xs text-ink truncate block px-2 py-1.5">{value || '-'}</span>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="w-full text-xs bg-white border border-primary/40 rounded px-2 py-1 outline-none ring-1 ring-primary/20 text-ink"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left text-xs text-ink truncate block px-2 py-1.5 rounded hover:bg-primary/5 transition-colors cursor-text"
      title={value || 'Click para editar'}
    >
      {value || <span className="text-ink-3/50 italic">-</span>}
    </button>
  )
}

// ---- MOBILE CARD ----
function PrescoringCard({
  p,
  onToggleSent,
  onResend,
  onReject,
  saving,
  isRejected,
}: {
  p: Prescoring
  onToggleSent: () => void
  onResend: () => void
  onReject?: () => void
  saving: boolean
  isRejected: boolean
}) {
  const isSent = p.status === 'sent'
  const days = isSent ? daysRemaining(p.sent_at) : 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`bg-white rounded-2xl border shadow-ambient-sm overflow-hidden ${
        isRejected ? 'border-error/30' : isSent ? 'border-brand/20' : 'border-line-2-variant/20'
      }`}
    >
      {/* Rejected alert banner */}
      {isRejected && (
        <div className="flex items-center gap-2 px-4 py-2 bg-error/5 border-b border-error/10">
          <AlertTriangle className="w-3.5 h-3.5 text-err" />
          <span className="text-xs font-semibold text-err">Rechazado — pulsa para reenviar</span>
        </div>
      )}

      {/* Sent countdown banner */}
      {isSent && (
        <div className="flex items-center gap-2 px-4 py-2 bg-secondary/5 border-b border-brand/10">
          <Clock className="w-3.5 h-3.5 text-brand" />
          <span className="text-xs text-brand font-medium">
            Enviado {fmtDateShort(p.sent_at)} · {days}d restantes
          </span>
        </div>
      )}

      <div className="p-4">
        {/* Top row: name + action */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-ink truncate">{p.client_name || 'Sin nombre'}</p>
            <p className="text-[11px] text-ink-3 font-mono mt-0.5 truncate">{p.cups || 'Sin CUPS'}</p>
          </div>
          {/* Action button */}
          {isRejected ? (
            <button
              onClick={onResend}
              disabled={saving}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-error/10 hover:bg-error/20 flex items-center justify-center transition-all"
              title="Reenviar"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin text-err" /> : <RefreshCw className="w-5 h-5 text-err" />}
            </button>
          ) : isSent ? (
            <div className="flex items-center gap-1.5">
              {onReject && (
                <button
                  onClick={onReject}
                  disabled={saving}
                  className="flex-shrink-0 w-10 h-10 rounded-xl bg-error/5 hover:bg-error/15 flex items-center justify-center transition-all"
                  title="Marcar como rechazado"
                >
                  <XCircle className="w-4.5 h-4.5 text-error/60 hover:text-err" />
                </button>
              )}
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-brand" />
              </div>
            </div>
          ) : (
            <button
              onClick={onToggleSent}
              disabled={saving}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-bg-2 hover:bg-secondary/10 flex items-center justify-center transition-all"
              title="Marcar como enviado"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin text-brand" /> : <Circle className="w-5 h-5 text-ink-3" />}
            </button>
          )}
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {p.cif && (
            <div>
              <span className="text-[10px] text-ink-3 uppercase">CIF</span>
              <p className="text-xs text-ink">{p.cif}</p>
            </div>
          )}
          {p.tariff && (
            <div>
              <span className="text-[10px] text-ink-3 uppercase">Tarifa</span>
              <p className="text-xs text-ink">{p.tariff}</p>
            </div>
          )}
          {p.consumo_anual && (
            <div>
              <span className="text-[10px] text-ink-3 uppercase">Consumo</span>
              <p className="text-xs text-ink">{p.consumo_anual}</p>
            </div>
          )}
          {p.poblacion && (
            <div>
              <span className="text-[10px] text-ink-3 uppercase">Población</span>
              <p className="text-xs text-ink">{p.poblacion}</p>
            </div>
          )}
        </div>

        {/* Date */}
        <p className="text-[10px] text-ink-3/60 mt-2">{fmtDate(p.requested_at)}</p>
      </div>
    </motion.div>
  )
}

// ---- MAIN COMPONENT ----
export default function PrescoringsPage() {
  const [prescorings, setPrescorings] = useState<Prescoring[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [section, setSection] = useState<'pending' | 'sent'>('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [sendingAll, setSendingAll] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  const supabase = createClient()
  const { user } = useAuthStore()

  // ---- FETCH ----
  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('prescorings')
      .select('*')
      .order('requested_at', { ascending: false })
    setPrescorings((data || []) as Prescoring[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Close export menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ---- DERIVED DATA ----
  // Pending section: pending + rejected (rejected shown with alert badge)
  const pendingItems = prescorings.filter(p => {
    if (p.status === 'pending') return true
    if (p.status === 'rejected') return true // Rejected appear in pending with alert
    return false
  })

  // Sent section: only sent within last 7 days
  const sentItems = prescorings.filter(p => {
    if (p.status !== 'sent') return false
    return daysSinceSent(p.sent_at) <= 7
  })

  // Approved items (keep for reference but don't show in main tabs)
  const approvedItems = prescorings.filter(p => p.status === 'approved')

  // Apply search filter
  const applySearch = (items: Prescoring[]) => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter(p =>
      (p.client_name || '').toLowerCase().includes(q) ||
      (p.cups || '').toLowerCase().includes(q) ||
      (p.cif || '').toLowerCase().includes(q) ||
      (p.poblacion || '').toLowerCase().includes(q)
    )
  }

  const filteredPending = applySearch(pendingItems)
  const filteredSent = applySearch(sentItems)

  const pendingCount = pendingItems.filter(p => p.status === 'pending').length
  const rejectedCount = pendingItems.filter(p => p.status === 'rejected').length

  // ---- MARK AS SENT ----
  const markAsSent = async (p: Prescoring) => {
    setSaving(p.id)
    const now = new Date().toISOString()
    await supabase.from('prescorings').update({ status: 'sent', sent_at: now }).eq('id', p.id)
    setPrescorings(prev => prev.map(item =>
      item.id === p.id ? { ...item, status: 'sent' as PrescoringStatus, sent_at: now } : item
    ))
    setSaving(null)
  }

  // ---- REJECT PRESCORING (admin marks as rejected from sent tab) ----
  const rejectPrescoring = async (p: Prescoring) => {
    setSaving(p.id)
    const now = new Date().toISOString()
    await supabase.from('prescorings').update({ status: 'rejected', resolved_at: now }).eq('id', p.id)

    // Find the commercial who owns this supply to send notification
    try {
      const { data: supplyData } = await supabase
        .from('supplies')
        .select('client:clients(commercial_id, name)')
        .eq('id', p.supply_id)
        .single()

      const client = (supplyData as any)?.client
      if (client?.commercial_id) {
        await supabase.from('notifications').insert({
          user_id: client.commercial_id,
          type: 'prescoring_rechazado',
          title: 'Prescoring rechazado',
          message: `El prescoring de ${p.client_name || client.name} (${p.cups || 'sin CUPS'}) ha sido rechazado.`,
          link: `/supplies/${p.supply_id}`,
          read: false,
          created_at: now,
          metadata: {
            prescoring_id: p.id,
            client_name: p.client_name,
            cups: p.cups,
            supply_id: p.supply_id,
          },
        })
      }
    } catch (err) {
      console.error('Error sending rejection notification:', err)
    }

    setPrescorings(prev => prev.map(item =>
      item.id === p.id ? { ...item, status: 'rejected' as PrescoringStatus, resolved_at: now } : item
    ))
    setSaving(null)
  }

  // ---- RESEND REJECTED (back to sent) ----
  const resendRejected = async (p: Prescoring) => {
    setSaving(p.id)
    const now = new Date().toISOString()
    await supabase.from('prescorings').update({ status: 'sent', sent_at: now, resolved_at: null }).eq('id', p.id)
    setPrescorings(prev => prev.map(item =>
      item.id === p.id ? { ...item, status: 'sent' as PrescoringStatus, sent_at: now, resolved_at: null } : item
    ))
    setSaving(null)
  }

  // ---- SEND ALL PENDING ----
  const sendAll = async () => {
    const toSend = pendingItems.filter(p => p.status === 'pending' || p.status === 'rejected')
    if (!toSend.length) return
    setSendingAll(true)
    const now = new Date().toISOString()
    const ids = toSend.map(p => p.id)
    await supabase.from('prescorings').update({ status: 'sent', sent_at: now, resolved_at: null }).in('id', ids)
    setPrescorings(prev => prev.map(p =>
      ids.includes(p.id) ? { ...p, status: 'sent' as PrescoringStatus, sent_at: now, resolved_at: null } : p
    ))
    setSendingAll(false)
  }

  // ---- UPDATE CELL ----
  const updateCell = async (id: string, field: string, value: string) => {
    setSaving(id)
    await supabase.from('prescorings').update({ [field]: value }).eq('id', id)
    setPrescorings(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
    setSaving(null)
  }

  // ---- DELETE PRESCORING ----
  const deletePrescoring = async (id: string) => {
    setDeleting(true)
    await supabase.from('prescorings').delete().eq('id', id)
    setPrescorings(prev => prev.filter(p => p.id !== id))
    setConfirmDeleteId(null)
    setDeleting(false)
  }

  // ---- EXPORT ----
  const exportCSV = (data: Prescoring[], label: string) => {
    const headers = ['ESTADO', 'FECHA', 'CUPS', 'NOMBRE', 'CIF', 'PRODUCTO', 'TARIFA', 'CONSUMO', 'ENTIDAD', 'TELÉFONO', 'POBLACIÓN', 'DIR. FISCAL']
    const rows = data.map(p => [
      p.status === 'sent' ? 'ENVIADO' : p.status === 'rejected' ? 'RECHAZADO' : 'PENDIENTE',
      fmtDate(p.requested_at),
      p.cups || '',
      p.client_name || '',
      p.cif || '',
      p.producto || '',
      p.tariff || '',
      p.consumo_anual || '',
      p.entidad || '',
      p.telefono || '',
      p.poblacion || '',
      p.direccion_fiscal || '',
    ].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(';'))

    const csv = '\uFEFF' + [headers.join(';'), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prescorings_${label}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const currentItems = section === 'pending' ? filteredPending : filteredSent

  // ---- RENDER ----
  return (
    <div className="min-h-screen bg-bg">
      <Header
        title="Prescorings"
        subtitle={`${pendingCount} pendiente${pendingCount !== 1 ? 's' : ''}${rejectedCount > 0 ? ` · ${rejectedCount} rechazado${rejectedCount !== 1 ? 's' : ''}` : ''} · ${sentItems.length} enviado${sentItems.length !== 1 ? 's' : ''}`}
      />

      <div className="px-4 lg:px-6 pb-24 lg:pb-8 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          {/* Section tabs */}
          <div className="flex bg-bg-2 rounded-xl p-1 w-full sm:w-auto">
            <button
              onClick={() => setSection('pending')}
              className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                section === 'pending'
                  ? 'bg-white text-brand shadow-sm'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Pendientes
              {(pendingCount + rejectedCount) > 0 && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  rejectedCount > 0 ? 'bg-error/10 text-err' : 'bg-warn-container text-warn'
                }`}>
                  {pendingCount + rejectedCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setSection('sent')}
              className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                section === 'sent'
                  ? 'bg-white text-brand shadow-sm'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Enviados
              {sentItems.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-secondary/10 text-brand px-1.5 py-0.5 rounded-full font-bold">
                  {sentItems.length}
                </span>
              )}
            </button>
          </div>

          {/* Search + Actions */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar..."
                className="w-full sm:w-48 pl-8 pr-3 py-2.5 text-xs bg-bg-2 border-0 rounded-lg outline-none focus:ring-1 focus:ring-primary/30 text-ink placeholder:text-ink-3/50"
              />
            </div>

            {section === 'pending' && pendingItems.length > 0 && (
              <button
                onClick={sendAll}
                disabled={sendingAll}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-brand hover:bg-secondary/90 rounded-lg transition-all shadow-sm disabled:opacity-50 whitespace-nowrap"
              >
                {sendingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Enviar todos</span>
                <span className="sm:hidden">Todos</span>
              </button>
            )}

            {/* Export dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-ink bg-bg-2 hover:bg-bg-2 rounded-lg transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Exportar</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              <AnimatePresence>
                {showExportMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-ambient-lg border border-line-2-variant/20 overflow-hidden z-20 min-w-[180px]"
                  >
                    <button
                      onClick={() => { exportCSV(currentItems, section); setShowExportMenu(false) }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-bg-2 transition-colors flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5 text-ink-3" />
                      Exportar vista actual
                    </button>
                    <button
                      onClick={() => { exportCSV(prescorings, 'todos'); setShowExportMenu(false) }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-bg-2 transition-colors flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5 text-ink-3" />
                      Exportar todo
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ===== MOBILE VIEW: Cards ===== */}
        <div className="lg:hidden space-y-3">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-brand mx-auto" />
              <p className="text-xs text-ink-3 mt-2">Cargando...</p>
            </div>
          ) : currentItems.length === 0 ? (
            <EmptyState section={section} />
          ) : (
            <AnimatePresence mode="popLayout">
              {currentItems.map(p => (
                <div key={p.id} className="relative">
                  <PrescoringCard
                    p={p}
                    onToggleSent={() => markAsSent(p)}
                    onResend={() => resendRejected(p)}
                    onReject={p.status === 'sent' ? () => rejectPrescoring(p) : undefined}
                    saving={saving === p.id}
                    isRejected={p.status === 'rejected'}
                  />
                  {/* Delete button for mobile */}
                  <div className="flex justify-end mt-1 px-1">
                    {confirmDeleteId === p.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink-3">¿Eliminar?</span>
                        <button onClick={() => deletePrescoring(p.id)} disabled={deleting} className="px-2 py-0.5 rounded bg-err text-white text-xs font-semibold">
                          {deleting ? '...' : 'Sí'}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-0.5 rounded bg-bg-2 text-ink-3 text-xs">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(p.id)} className="flex items-center gap-1 text-ink-4 hover:text-err text-xs transition-colors">
                        <Trash2 className="w-3 h-3" /> Eliminar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* ===== DESKTOP VIEW: Table ===== */}
        <div className="hidden lg:block bg-white rounded-2xl border border-line-2-variant/20 shadow-ambient-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-bg-2/60">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.width} px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-3 border-b border-line-2-variant/20 ${col.align === 'center' ? 'text-center' : 'text-left'}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="py-16 text-center">
                      <Loader2 className="w-6 h-6 animate-spin text-brand mx-auto" />
                      <p className="text-xs text-ink-3 mt-2">Cargando prescorings...</p>
                    </td>
                  </tr>
                ) : currentItems.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="py-16">
                      <EmptyState section={section} />
                    </td>
                  </tr>
                ) : (
                  currentItems.map((p, rowIdx) => {
                    const isRejected = p.status === 'rejected'
                    const isSent = p.status === 'sent'
                    const days = isSent ? daysRemaining(p.sent_at) : 0

                    return (
                      <tr
                        key={p.id}
                        className={`border-b transition-colors ${
                          isRejected
                            ? 'bg-error/3 border-error/10 hover:bg-error/5'
                            : saving === p.id
                            ? 'bg-primary/3 border-line-2-variant/10'
                            : rowIdx % 2 === 0
                            ? 'bg-white border-line-2-variant/10 hover:bg-primary/3'
                            : 'bg-surface/40 border-line-2-variant/10 hover:bg-primary/3'
                        }`}
                      >
                        {/* Status / Action button */}
                        <td className="w-12 px-2 py-1.5 text-center">
                          {isRejected ? (
                            <button
                              onClick={() => resendRejected(p)}
                              disabled={saving === p.id}
                              className="inline-flex items-center justify-center transition-all group"
                              title="Reenviar prescoring rechazado"
                            >
                              {saving === p.id
                                ? <Loader2 className="w-5 h-5 animate-spin text-err" />
                                : <RefreshCw className="w-5 h-5 text-err group-hover:text-error/80" />
                              }
                            </button>
                          ) : isSent ? (
                            <div className="inline-flex items-center gap-0.5">
                              <button
                                onClick={() => rejectPrescoring(p)}
                                disabled={saving === p.id}
                                className="p-0.5 rounded text-error/30 hover:text-err transition-all"
                                title="Marcar como rechazado"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                              <div className="relative" title={`Enviado · ${days}d restantes`}>
                                <CheckCircle2 className="w-5 h-5 text-brand" />
                                {days <= 2 && (
                                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-warn border border-bg text-[7px] font-bold text-white flex items-center justify-center">
                                    {days}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => markAsSent(p)}
                              disabled={saving === p.id}
                              className="inline-flex items-center justify-center transition-all group"
                              title="Marcar como enviado"
                            >
                              {saving === p.id
                                ? <Loader2 className="w-5 h-5 animate-spin text-brand" />
                                : <Circle className="w-5 h-5 text-ink-3/40 group-hover:text-brand" />
                              }
                            </button>
                          )}
                        </td>

                        {/* Date */}
                        <td className="w-28 px-2 py-1.5">
                          <div className="flex flex-col">
                            <span className="text-xs text-ink-3">{fmtDate(p.requested_at)}</span>
                            {isRejected && (
                              <span className="text-[9px] font-bold text-err bg-error/10 px-1.5 py-0.5 rounded mt-0.5 inline-block w-fit">
                                RECHAZADO
                              </span>
                            )}
                            {isSent && (
                              <span className="text-[9px] text-secondary/70 mt-0.5">
                                {days}d restantes
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Editable cells */}
                        <td className="w-52 px-0 py-0">
                          <EditableCell value={p.cups || ''} onChange={(v) => updateCell(p.id, 'cups', v)} editable={true} />
                        </td>
                        <td className="w-44 px-0 py-0">
                          <EditableCell value={p.client_name || ''} onChange={(v) => updateCell(p.id, 'client_name', v)} editable={true} />
                        </td>
                        <td className="w-28 px-0 py-0">
                          <EditableCell value={p.cif || ''} onChange={(v) => updateCell(p.id, 'cif', v)} editable={true} />
                        </td>
                        <td className="w-28 px-0 py-0">
                          <EditableCell value={p.producto || ''} onChange={(v) => updateCell(p.id, 'producto', v)} editable={true} />
                        </td>
                        <td className="w-24 px-0 py-0">
                          <EditableCell value={p.tariff || ''} onChange={(v) => updateCell(p.id, 'tariff', v)} editable={true} />
                        </td>
                        <td className="w-28 px-0 py-0">
                          <EditableCell value={p.consumo_anual || ''} onChange={(v) => updateCell(p.id, 'consumo_anual', v)} editable={true} />
                        </td>
                        <td className="w-28 px-0 py-0">
                          <EditableCell value={p.entidad || ''} onChange={(v) => updateCell(p.id, 'entidad', v)} editable={true} />
                        </td>
                        <td className="w-28 px-0 py-0">
                          <EditableCell value={p.telefono || ''} onChange={(v) => updateCell(p.id, 'telefono', v)} editable={true} />
                        </td>
                        <td className="w-28 px-0 py-0">
                          <EditableCell value={p.poblacion || ''} onChange={(v) => updateCell(p.id, 'poblacion', v)} editable={true} />
                        </td>
                        <td className="w-44 px-0 py-0">
                          <EditableCell value={p.direccion_fiscal || ''} onChange={(v) => updateCell(p.id, 'direccion_fiscal', v)} editable={true} />
                        </td>
                        {/* Delete */}
                        <td className="w-10 px-1 py-1.5 text-center">
                          {confirmDeleteId === p.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => deletePrescoring(p.id)}
                                disabled={deleting}
                                className="px-1.5 py-0.5 rounded bg-err text-white text-[10px] font-semibold hover:opacity-90 disabled:opacity-50"
                              >
                                {deleting ? '...' : 'OK'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="p-0.5 rounded text-ink-3 hover:text-ink"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(p.id)}
                              className="p-1 rounded text-ink-4 hover:text-err hover:bg-err-container/40 transition-colors"
                              title="Eliminar prescoring"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          {!loading && currentItems.length > 0 && (
            <div className="px-4 py-2.5 border-t border-line-2-variant/10 bg-surface/30 flex items-center justify-between">
              <span className="text-[11px] text-ink-3">
                {currentItems.length} registro{currentItems.length !== 1 ? 's' : ''}
                {section === 'pending' && rejectedCount > 0 && ` · ${rejectedCount} rechazado${rejectedCount !== 1 ? 's' : ''}`}
                {section === 'sent' && ' · Se ocultan tras 7 días'}
                {' · Click en celda para editar'}
              </span>
              {saving && (
                <span className="text-[11px] text-brand flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Guardando...
                </span>
              )}
            </div>
          )}
        </div>

        {/* Info card about auto-creation */}
        {!loading && prescorings.length === 0 && (
          <div className="bg-primary/5 rounded-2xl p-4 lg:p-6 flex items-start gap-3">
            <Zap className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-ink">Los prescorings se crean automaticamente</p>
              <p className="text-xs text-ink-3 mt-1">
                Al adjuntar facturas a un suministro (o crear uno nuevo desde la bandeja), se genera automaticamente una fila de prescoring con los datos extraidos del CUPS, tarifa, cliente y consumo.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- EMPTY STATE ----
function EmptyState({ section }: { section: 'pending' | 'sent' }) {
  return (
    <div className="text-center py-12 px-4">
      {section === 'pending' ? (
        <>
          <Circle className="w-10 h-10 text-ink-3/30 mx-auto" />
          <p className="text-sm text-ink-3 mt-3">No hay prescorings pendientes</p>
          <p className="text-xs text-ink-3/60 mt-1">
            Se crean automaticamente al adjuntar facturas a un suministro
          </p>
        </>
      ) : (
        <>
          <CheckCircle2 className="w-10 h-10 text-ink-3/30 mx-auto" />
          <p className="text-sm text-ink-3 mt-3">No hay prescorings enviados</p>
          <p className="text-xs text-ink-3/60 mt-1">
            Marca pendientes como enviados para que aparezcan aqui (visibles 7 dias)
          </p>
        </>
      )}
    </div>
  )
}
