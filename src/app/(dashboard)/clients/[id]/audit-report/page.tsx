'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ConsumptionSnapshot, AuditReport } from '@/types/database'
import { Header } from '@/components/layout/Header'
import { TechnicalAuditTable } from '@/components/audit-report/TechnicalAuditTable'
import { TechnologicalReportView } from '@/components/audit-report/TechnologicalReportView'
import { validateRowsForReport } from '@/lib/consumption-utils'

export default function AuditReportPage() {
  const { id } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [client, setClient] = useState<any>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [rows, setRows] = useState<ConsumptionSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [informeBreve, setInformeBreve] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [view, setView] = useState<'table' | 'report'>(
    (searchParams.get('view') as 'table' | 'report') || 'table'
  )
  const [isSyncingSupply, setIsSyncingSupply] = useState(false)

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const { data: clientData } = await supabase.from('clients').select('*').eq('id', id).single()
    setClient(clientData)

    const { data: reports } = await supabase
      .from('audit_reports').select('*').eq('client_id', id)
      .order('created_at', { ascending: false }).limit(1)

    if (reports && reports.length > 0) {
      const r = reports[0] as AuditReport
      setReport(r)
      setInformeBreve(r.informe_breve || '')
    }

    const { data: snapshots } = await supabase
      .from('consumption_snapshots').select('*').eq('client_id', id)
      .order('cups', { ascending: true })
    setRows(snapshots || [])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncingSupplyId, setSyncingSupplyId] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch('/api/sync-consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id }),
      })
      const data = await res.json()
      if (data.success) await fetchData()
      else setSyncError(data.error || 'Error al cargar datos')
    } catch (err: any) { setSyncError(err?.message || 'Error de conexión') }
    setSyncing(false)
  }

  const handleSyncSupplySips = async (snapshotId: string, supplyId: string) => {
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
        setRows(prev => prev.map(r => r.id === snapshotId ? { ...r, ...data.updated } : r))
      } else {
        console.warn('[audit-report] SIPS per-supply error:', data.error)
      }
    } catch (err) { console.error('[audit-report] SIPS per-supply exception:', err) }
    setIsSyncingSupply(false)
    setSyncingSupplyId(null)
  }

  const generateReport = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id, title: `Informe energético — ${client?.name}` }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
        setView('report')
      }
    } catch (err) { console.error('Error generating report:', err) }
    setGenerating(false)
  }

  const saveReport = async () => {
    if (!report) return
    setSaving(true)
    try {
      await fetch('/api/audit-report', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: report.id, informe_breve: informeBreve, status: 'published' }),
      })
      setSaved(true); setIsEditing(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) { console.error('Error saving:', err) }
    setSaving(false)
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

  const handlePrint = () => {
    const reportEl = document.getElementById('audit-report')
    if (!reportEl) return

    // Recopilar todas las hojas de estilo (Tailwind, etc.)
    const styleLinks: string[] = []
    const styleBlocks: string[] = []
    Array.from(document.styleSheets).forEach(ss => {
      try {
        if (ss.href) {
          styleLinks.push(`<link rel="stylesheet" href="${ss.href}">`)
        } else {
          const rules = Array.from(ss.cssRules).map(r => r.cssText).join('\n')
          if (rules) styleBlocks.push(`<style>${rules}</style>`)
        }
      } catch {
        if (ss.href) styleLinks.push(`<link rel="stylesheet" href="${ss.href}">`)
      }
    })

    const clientName = client?.name || 'cliente'
    const reportHtml = reportEl.outerHTML

    const printWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printWindow) return

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Estudio de suministros (${clientName})</title>
  ${styleLinks.join('\n')}
  ${styleBlocks.join('\n')}
  <style>
    *, *::before, *::after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    @page { margin: 10mm 8mm; size: A4 portrait; }
    html, body { margin: 0; padding: 0; background: #F4EEE2; }
    /* Quitar overflow hidden y sombras del contenedor raíz */
    #audit-report {
      overflow: visible !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }
  </style>
</head>
<body>
  ${reportHtml}
</body>
</html>`)
    printWindow.document.close()

    // Esperar a que carguen fuentes/estilos y luego imprimir
    const doPrint = () => {
      setTimeout(() => {
        printWindow.focus()
        printWindow.print()
        printWindow.close()
      }, 600)
    }

    if (printWindow.document.readyState === 'complete') {
      doPrint()
    } else {
      printWindow.onload = doPrint
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-brand" />
      </div>
    )
  }

  if (view === 'report' && report) {
    return (
      <TechnologicalReportView 
        rows={rows}
        client={client}
        report={report}
        informeBreve={informeBreve}
        setInformeBreve={setInformeBreve}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        onSave={saveReport}
        saving={saving}
        saved={saved}
        onPrint={handlePrint}
        onBackToTable={() => setView('table')}
      />
    )
  }

  return (
    <div>
      <Header 
        title="Informe de suministros" 
        subtitle={client?.name} 
        actions={
          <Button variant="ghost" onClick={() => router.push(`/clients/${id}`)}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Volver
          </Button>
        }
      />
      <div className="px-6 lg:px-8 pb-8">
        <TechnicalAuditTable
          rows={rows}
          clientName={client?.name}
          syncing={syncing}
          onSync={handleSync}
          onUpdateName={handleUpdateName}
          onSyncSupplySips={handleSyncSupplySips}
          isSyncingSupply={isSyncingSupply}
          syncingSupplyId={syncingSupplyId}
          onViewReport={() => setView('report')}
          hasReport={!!report}
          onGenerateReport={generateReport}
          generating={generating}
          syncError={syncError}
        />
      </div>
    </div>
  )
}
