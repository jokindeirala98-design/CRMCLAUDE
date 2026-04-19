'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ExternalLink, Loader2, RefreshCw, BarChart3, FileText } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import type { ConsumptionSnapshot, AuditReport } from '@/types/database'
import { TechnicalAuditTable } from '@/components/audit-report/TechnicalAuditTable'
import { useRouter } from 'next/navigation'

interface Props {
  open: boolean
  onClose: () => void
  clientId: string
  clientName: string
}

export function TechnicalAuditModal({ open, onClose, clientId, clientName }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<ConsumptionSnapshot[]>([])
  const [report, setReport] = useState<AuditReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [isSyncingSupply, setIsSyncingSupply] = useState(false)
  const [syncingSupplyId, setSyncingSupplyId] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const autoSyncDone = useRef(false)

  const fetchData = useCallback(async () => {
    if (!open) return
    const supabase = createClient()
    
    // Fetch snapshots
    const { data: snapshots } = await supabase
      .from('consumption_snapshots')
      .select('*')
      .eq('client_id', clientId)
      .order('cups', { ascending: true })
    setRows(snapshots || [])

    // Check for existing report
    const { data: reports } = await supabase
      .from('audit_reports')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
    
    setReport(reports && reports.length > 0 ? reports[0] as AuditReport : null)
    setLoading(false)
  }, [open, clientId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch('/api/sync-consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
      } else {
        const msg = data.error || 'Error al cargar los datos'
        setSyncError(msg)
        console.error('[TechnicalAuditModal] Sync error:', msg)
      }
    } catch (err: any) {
      const msg = err?.message || 'Error de conexión al sincronizar'
      setSyncError(msg)
      console.error('[TechnicalAuditModal] Sync exception:', err)
    }
    setSyncing(false)
  }, [clientId, fetchData])

  const handleSyncSupplySips = useCallback(async (snapshotId: string, supplyId: string) => {
    setIsSyncingSupply(true)
    setSyncingSupplyId(snapshotId)
    try {
      const res = await fetch('/api/sync-supply-sips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supply_id: supplyId, snapshot_id: snapshotId }),
      })
      const data = await res.json()
      if (data.success) {
        // Optimistic update: merge returned fields into the row
        setRows(prev => prev.map(r =>
          r.id === snapshotId ? { ...r, ...data.updated } : r
        ))
      } else {
        console.warn('[TechnicalAuditModal] SIPS per-supply error:', data.error)
      }
    } catch (err) {
      console.error('[TechnicalAuditModal] SIPS per-supply exception:', err)
    }
    setIsSyncingSupply(false)
    setSyncingSupplyId(null)
  }, [])

  // Auto-sync: si el modal está abierto y no hay datos, sincronizar automáticamente (solo una vez)
  useEffect(() => {
    if (open && !loading && rows.length === 0 && !syncing && !autoSyncDone.current) {
      autoSyncDone.current = true
      handleSync()
    }
  }, [open, loading, rows.length, syncing, handleSync])

  // Reset auto-sync flag cuando se cierra el modal
  useEffect(() => {
    if (!open) {
      autoSyncDone.current = false
    }
  }, [open])

  const handleGenerateReport = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, title: `Informe energético — ${clientName}` }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
      }
    } catch (err) {
      console.error('Error generating report:', err)
    }
    setGenerating(false)
  }

  const handleUpdateName = async (rowId: string, supplyId: string, newName: string) => {
    if (!newName.trim()) return
    const supabase = createClient()
    await supabase.from('consumption_snapshots').update({ name: newName.trim() }).eq('id', rowId)
    setIsSyncingSupply(true)
    await supabase.from('supplies').update({ name: newName.trim() }).eq('id', supplyId)
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, name: newName.trim() } : r))
    setIsSyncingSupply(false)
  }

  const handleViewFullReport = () => {
    router.push(`/clients/${clientId}/audit-report?view=report`)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-[2rem] shadow-ambient-2xl w-full max-w-7xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-white z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-brand" />
            </div>
            <div>
              <h2 className="font-sans font-bold text-xl text-slate-900 leading-tight">
                Estudios de Suministro
              </h2>
              <p className="text-sm text-slate-500 font-medium mt-0.5">
                {clientName} — Base de datos técnica y auditoria
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {report && (
              <Button onClick={handleViewFullReport} className="hidden sm:flex group transition-all">
                <FileText className="w-4 h-4 mr-2" />
                Ver Informe Tecnológico
                <ExternalLink className="w-3.5 h-3.5 ml-2 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
              </Button>
            )}
            <button 
              onClick={onClose}
              className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all border border-transparent hover:border-slate-200"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-12 h-12 rounded-full border-2 border-brand border-t-transparent animate-spin" />
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Cargando base técnica...</p>
            </div>
          ) : (
            <TechnicalAuditTable
              rows={rows}
              clientName={clientName}
              syncing={syncing}
              onSync={handleSync}
              onUpdateName={handleUpdateName}
              onSyncSupplySips={handleSyncSupplySips}
              isSyncingSupply={isSyncingSupply}
              syncingSupplyId={syncingSupplyId}
              onViewReport={handleViewFullReport}
              hasReport={!!report}
              onGenerateReport={handleGenerateReport}
              generating={generating}
              syncError={syncError}
            />
          )}
        </div>

        {/* Footer with Mobile Action */}
        {report && (
          <div className="p-4 border-t border-slate-100 bg-slate-50 sm:hidden">
            <Button onClick={handleViewFullReport} className="w-full">
              <FileText className="w-4 h-4 mr-2" />
              Ver Informe Completo
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
