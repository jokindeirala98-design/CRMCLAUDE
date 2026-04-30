'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronDown, FileSpreadsheet, Plus, Download, FileText, RefreshCw, Upload, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import ConsumptionStats from './ConsumptionStats'
import ConsumptionTable from './ConsumptionTable'
import ImportConsumptionModal from './ImportConsumptionModal'
import QuickEntryModal from './QuickEntryModal'
import type { ConsumptionSnapshot } from '@/types/database'

interface Props {
  clientId: string
  supplies: Array<{ id: string; cups: string | null; type: string; tariff: string }>
}

export default function ConsumptionDistribution({ clientId, supplies }: Props) {
  const [rows, setRows] = useState<ConsumptionSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [showQuickEntry, setShowQuickEntry] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncingSips, setSyncingSips] = useState(false)
  const [sipsResult, setSipsResult] = useState<{ synced: number; total: number } | null>(null)

  const fetchRows = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('consumption_snapshots')
      .select('*')
      .eq('client_id', clientId)
      .order('cups', { ascending: true })

    setRows(data || [])
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Sync from existing invoices/supplies
  const syncFromInvoices = async () => {
    setSyncing(true)
    try {
      const supabase = createClient()

      // Get all supplies with their invoices
      const { data: clientSupplies } = await supabase
        .from('supplies')
        .select('*, invoices(*)')
        .eq('client_id', clientId)

      if (!clientSupplies) { setSyncing(false); return }

      for (const supply of clientSupplies) {
        // Check if snapshot already exists for this supply
        const existing = rows.find(r => r.supply_id === supply.id)
        if (existing) continue

        // Get best invoice data
        const completedInvoice = supply.invoices?.find((inv: any) => inv.extraction_status === 'completed')
        const extractedData = completedInvoice?.extracted_data as Record<string, any> | null

        const data: Record<string, any> = {
          client_id: clientId,
          supply_id: supply.id,
          cups: supply.cups || '',
          tariff: supply.tariff || extractedData?.detected_tariff || null,
          supply_type: supply.type === 'gas' ? 'gas' : 'luz',
          comercializadora: extractedData?.detected_comercializadora || null,
          address: supply.address || extractedData?.supply_address || null,
          source: 'invoice_extraction',
          validation_status: supply.cups ? 'OK' : 'Incompleto',
        }

        // Extract power data if available
        if (supply.power_data) {
          const pd = supply.power_data as Record<string, any>
          if (pd.potenciaContratada) {
            const pot = pd.potenciaContratada
            data.potencia_p1 = pot.P1 || null
            data.potencia_p2 = pot.P2 || null
            data.potencia_p3 = pot.P3 || null
            data.potencia_p4 = pot.P4 || null
            data.potencia_p5 = pot.P5 || null
            data.potencia_p6 = pot.P6 || null
          }
        }

        // Extract consumption from SIPS data if available
        if (supply.consumption_data) {
          const cd = supply.consumption_data as Record<string, any>
          if (cd.history && Array.isArray(cd.history) && cd.history.length > 0) {
            // Get most recent year
            const latest = cd.history[cd.history.length - 1]
            if (latest.consumoAnual) {
              data.consumo_total = latest.consumoAnual
            }
          }
        }

        await supabase.from('consumption_snapshots').insert(data)
      }

      await fetchRows()
    } catch (err) {
      console.error('Error syncing from invoices:', err)
    }
    setSyncing(false)
  }

  // Batch SIPS sync for all supplies of this client, then rebuild snapshots
  const syncSips = async (force = false) => {
    setSyncingSips(true)
    setSipsResult(null)
    try {
      // Step 1: fetch SIPS for supplies without data (or all if force=true)
      const res = await fetch('/api/batch-sips-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, force }),
      })
      const data = await res.json()
      if (res.ok) {
        setSipsResult({ synced: data.synced, total: data.total })
      } else {
        console.error('[syncSips] batch-sips-sync error:', data.error)
      }
    } catch (e) {
      console.error('[syncSips]', e)
    }

    // Step 2: always rebuild snapshots (catches any case where batch-sips-sync
    // internal sync-consumption call failed or was skipped)
    try {
      await fetch('/api/sync-consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
    } catch (e) {
      console.error('[syncSips] sync-consumption error:', e)
    }

    // Step 3: refresh rows from DB
    await fetchRows()
    setSyncingSips(false)
  }

  // Export to Excel
  const exportExcel = async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Suministros')

    ws.addRow([
      'CUPS', 'Tarifa', 'Tipo', 'Comercializadora', 'Direccion',
      'Pot. P1 (kW)', 'Pot. P2 (kW)', 'Pot. P3 (kW)', 'Pot. P4 (kW)', 'Pot. P5 (kW)', 'Pot. P6 (kW)',
      'Cons. P1 (kWh)', 'Cons. P2 (kWh)', 'Cons. P3 (kWh)', 'Cons. P4 (kWh)', 'Cons. P5 (kWh)', 'Cons. P6 (kWh)',
      'Consumo Total (kWh)', 'Estado', 'Observaciones',
    ])

    rows.forEach(r => {
      ws.addRow([
        r.cups, r.tariff, r.supply_type === 'gas' ? 'Gas' : 'Electricidad',
        r.comercializadora, r.address,
        r.potencia_p1, r.potencia_p2, r.potencia_p3, r.potencia_p4, r.potencia_p5, r.potencia_p6,
        r.consumo_p1, r.consumo_p2, r.consumo_p3, r.consumo_p4, r.consumo_p5, r.consumo_p6,
        r.consumo_total, r.validation_status, r.observations,
      ])
    })

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `distribucion_consumos_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full" />
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs text-ink-3">
            {rows.length} suministros registrados
          </p>
          {syncingSips && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <span className="animate-spin w-3 h-3 border border-amber-500 border-t-transparent rounded-full" />
              Sincronizando SIPS...
            </span>
          )}
          {sipsResult && !syncingSips && (
            <span className="text-xs text-green-600">
              ✓ SIPS: {sipsResult.synced}/{sipsResult.total} actualizados
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => syncSips(false)}
            disabled={syncingSips}
            title="Recargar datos (sincroniza SIPS y reconstruye tabla)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingSips ? 'animate-spin' : ''}`} />
          </Button>

          {rows.length > 0 && (
            <>
              <Button variant="secondary" size="sm" onClick={exportExcel}>
                <Download className="w-3.5 h-3.5" />
                Exportar Excel
              </Button>
              <Button size="sm" onClick={() => window.location.href = `/clients/${clientId}/audit-report`}>
                <FileText className="w-3.5 h-3.5" />
                Generar informe
              </Button>
            </>
          )}

          {/* Add data menu */}
          <div className="relative">
            <Button size="sm" onClick={() => setShowMenu(!showMenu)}>
              <Plus className="w-3.5 h-3.5" />
              Datos
              <ChevronDown className="w-3 h-3" />
            </Button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-line-2-variant/15 py-1 z-20">
                  <button
                    onClick={() => { syncSips(); setShowMenu(false) }}
                    disabled={syncingSips}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-bg-2 transition-colors text-left"
                  >
                    <Zap className="w-4 h-4 text-amber-500" />
                    <div>
                      <p className="font-medium text-xs">Sincronizar SIPS</p>
                      <p className="text-[10px] text-ink-3">Actualiza potencias y consumos SIPS</p>
                    </div>
                  </button>
                  <button
                    onClick={() => { syncFromInvoices(); setShowMenu(false) }}
                    disabled={syncing}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-bg-2 transition-colors text-left"
                  >
                    <Upload className="w-4 h-4 text-ink-3" />
                    <div>
                      <p className="font-medium text-xs">Importar desde facturas CRM</p>
                      <p className="text-[10px] text-ink-3">Extrae de facturas ya procesadas</p>
                    </div>
                  </button>
                  <button
                    onClick={() => { setShowImport(true); setShowMenu(false) }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-bg-2 transition-colors text-left"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-ink-3" />
                    <div>
                      <p className="font-medium text-xs">Importar Excel de consumos</p>
                      <p className="text-[10px] text-ink-3">Matching por CUPS</p>
                    </div>
                  </button>
                  <button
                    onClick={() => { setShowQuickEntry(true); setShowMenu(false) }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-bg-2 transition-colors text-left"
                  >
                    <Plus className="w-4 h-4 text-ink-3" />
                    <div>
                      <p className="font-medium text-xs">Anadir manualmente</p>
                      <p className="text-[10px] text-ink-3">Entrada rapida por suministro</p>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {rows.length > 0 && <ConsumptionStats rows={rows} />}

      {/* Table or empty state */}
      {rows.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <FileSpreadsheet className="w-10 h-10 text-ink-3/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-ink">No hay datos de consumo todavia</p>
            <p className="text-xs text-ink-3 mt-1 mb-4">
              Importa datos desde las facturas del CRM, un Excel o anaade manualmente
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={syncFromInvoices} loading={syncing}>
                <Upload className="w-3.5 h-3.5" />
                Importar desde facturas
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Importar Excel
              </Button>
              <Button size="sm" onClick={() => setShowQuickEntry(true)}>
                <Plus className="w-3.5 h-3.5" />
                Anadir manual
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="!p-3">
          <ConsumptionTable
            rows={rows}
            onRowUpdated={fetchRows}
            onRowDeleted={fetchRows}
          />
        </Card>
      )}

      {/* Modals */}
      <ImportConsumptionModal
        open={showImport}
        onClose={() => setShowImport(false)}
        clientId={clientId}
        existingRows={rows}
        onImported={fetchRows}
      />

      <QuickEntryModal
        open={showQuickEntry}
        onClose={() => setShowQuickEntry(false)}
        clientId={clientId}
        supplies={supplies}
        onCreated={fetchRows}
      />
    </div>
  )
}
