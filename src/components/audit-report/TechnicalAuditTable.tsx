'use client'

import { useState } from 'react'
import {
  Zap, CheckCircle2, AlertTriangle, Layout, RefreshCw,
  Edit3, Save, ExternalLink, BarChart3, FileText, Database
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { ConsumptionSnapshot } from '@/types/database'
import {
  formatNumber, rowTotal, validateRowsForReport
} from '@/lib/consumption-utils'

interface TechnicalAuditTableProps {
  rows: ConsumptionSnapshot[]
  clientName: string
  syncing: boolean
  onSync: () => Promise<void>
  onUpdateName: (rowId: string, supplyId: string, newName: string) => Promise<void>
  onSyncSupplySips?: (snapshotId: string, supplyId: string) => Promise<void>
  isSyncingSupply: boolean
  syncingSupplyId?: string | null
  onViewReport: () => void
  hasReport: boolean
  onGenerateReport: () => Promise<void>
  generating: boolean
  syncError?: string | null
}

export function TechnicalAuditTable({
  rows,
  clientName,
  syncing,
  onSync,
  onUpdateName,
  onSyncSupplySips,
  isSyncingSupply,
  syncingSupplyId,
  onViewReport,
  hasReport,
  onGenerateReport,
  generating,
  syncError,
}: TechnicalAuditTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const validation = validateRowsForReport(rows)

  const handleEditName = (row: ConsumptionSnapshot) => {
    setEditingId(row.id)
    setEditingName(row.name || '')
  }

  const handleSaveName = async (rowId: string, supplyId: string) => {
    await onUpdateName(rowId, supplyId, editingName)
    setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onSync} loading={syncing}>
            <RefreshCw className="w-4 h-4" />
            {rows.length === 0 ? 'Cargar datos' : 'Recargar'}
          </Button>
          {hasReport && (
            <Button variant="secondary" size="sm" onClick={onViewReport}>
              <FileText className="w-4 h-4" /> Ver informe
            </Button>
          )}
        </div>

        <Button
          size="sm"
          onClick={onGenerateReport}
          loading={generating}
          disabled={rows.length === 0 || !validation.valid}
        >
          <BarChart3 className="w-4 h-4" />
          {hasReport ? 'Regenerar informe' : 'Generar informe'}
        </Button>
      </div>

      {/* Sync error banner */}
      {syncError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-err-container/40 border border-err/30 rounded-xl text-sm text-err">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{syncError}</span>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="!py-3 !px-4">
          <p className="text-[10px] text-ink-3 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-brand" /> Suministros
          </p>
          <p className="font-sans font-black text-2xl text-ink mt-1">{rows.length}</p>
        </Card>
        <Card className="!py-3 !px-4 border-l-4 border-l-success">
          <p className="text-[10px] text-ink-3 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-ok" /> OK
          </p>
          <p className="font-sans font-black text-2xl text-ok mt-1">{rows.filter(r => r.validation_status === 'OK').length}</p>
        </Card>
        <Card className="!py-3 !px-4 border-l-4 border-l-warning">
          <p className="text-[10px] text-ink-3 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-warn" /> Revisar
          </p>
          <p className="font-sans font-black text-2xl text-warn mt-1">{rows.filter(r => r.validation_status === 'Revisar').length}</p>
        </Card>
        <Card className="!py-3 !px-4 border-l-4 border-l-error">
          <p className="text-[10px] text-ink-3 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-err" /> Incompleto
          </p>
          <p className="font-sans font-black text-2xl text-err mt-1">{rows.filter(r => r.validation_status === 'Incompleto').length}</p>
        </Card>
      </div>

      {/* Validation Messages */}
      {(!validation.valid || validation.warnings.length > 0) && rows.length > 0 && (
        <div className="space-y-1">
          {validation.errors.map((e, i) => (
            <p key={i} className="text-xs text-err bg-err-container/40 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {e}
            </p>
          ))}
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-xs text-warn bg-warn-container/40 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {w}
            </p>
          ))}
        </div>
      )}

      {/* SIPS tip when rows have no consumption data */}
      {rows.length > 0 && rows.every(r => !r.consumo_total) && onSyncSupplySips && (
        <div className="flex items-start gap-2 px-4 py-3 bg-info-container/40 border border-info/30 rounded-xl text-xs text-info">
          <Database className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Sin datos de consumo todavía. Pulsa el botón <RefreshCw className="w-3 h-3 inline mx-0.5" /> en cada suministro para cargar datos SIPS desde Lidera (electricidad) o TotalEnergies (gas).
          </span>
        </div>
      )}

      {/* Table Card */}
      <Card className="!p-0 overflow-hidden border-none shadow-ambient-lg bg-card">
        <div className="px-5 py-3.5 border-b border-line-2-variant/10 flex items-center justify-between bg-bg-2/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Layout className="w-4 h-4 text-brand" />
            </div>
            <div>
              <span className="text-sm font-bold text-ink block">Base de Datos Técnica</span>
              <span className="text-[10px] text-ink-3">Análisis detallado de 19 campos críticos</span>
            </div>
          </div>
          {isSyncingSupply && (
            <div className="flex items-center gap-2 text-[10px] text-brand animate-pulse font-bold uppercase tracking-wider">
              <RefreshCw className="w-3 h-3 animate-spin" /> Cargando SIPS...
            </div>
          )}
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="text-[11px] border-collapse w-full tabular-nums" style={{ minWidth: onSyncSupplySips ? 1580 : 1500 }}>
            <thead>
              <tr className="bg-bg-2/50 border-b border-line-2-variant/10">
                <th className="text-left px-4 py-3 font-bold text-ink-3 sticky left-0 bg-bg-2/50 z-20 min-w-[150px]">Nombre (Alias)</th>
                <th className="text-left px-3 py-3 font-bold text-ink-3 min-w-[140px]">Comercializadora</th>
                <th className="text-left px-3 py-3 font-bold text-ink-3 min-w-[180px]">CUPS</th>
                <th className="text-left px-3 py-3 font-bold text-ink-3 min-w-[70px]">Tarifa</th>
                <th className="text-left px-3 py-3 font-bold text-ink-3 min-w-[200px]">Dirección</th>
                {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(p => (
                  <th key={`pot_${p}`} className="text-right px-2 py-3 font-bold text-ink-3 min-w-[65px]">Pot.{p} (kW)</th>
                ))}
                {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(p => (
                  <th key={`con_${p}`} className="text-right px-2 py-3 font-bold text-brand min-w-[75px]">Con.{p} (kWh)</th>
                ))}
                <th className="text-right px-4 py-3 font-bold text-ink min-w-[90px]">Total Anual</th>
                <th className="text-center px-3 py-3 font-bold text-ink-3 min-w-[70px]">Origen</th>
                {onSyncSupplySips && (
                  <th className="text-center px-3 py-3 font-bold text-ink-3 min-w-[50px]">SIPS</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={onSyncSupplySips ? 20 : 19} className="py-12 text-center text-ink-3 italic">
                    No hay datos disponibles. Pulsa &quot;Cargar datos&quot; para comenzar.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const tariffUpper = (row.tariff || '').toUpperCase()
                  const is20 = tariffUpper.includes('2.0')
                  const isGas = row.supply_type === 'gas' || tariffUpper.startsWith('RL')
                  const potPeriods = is20 ? 2 : isGas ? 0 : 6
                  const conPeriods = is20 ? 3 : isGas ? 1 : 6
                  const isEditing = editingId === row.id
                  const isThisRowSyncing = syncingSupplyId === row.id

                  return (
                    <tr key={row.id} className={`border-b border-line-2-variant/5 transition-colors hover:bg-primary/5 ${idx % 2 === 1 ? 'bg-card' : 'bg-card/50'}`}>
                      {/* Name */}
                      <td className="px-4 py-2.5 sticky left-0 bg-card z-10 border-r border-line-2-variant/10">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingName}
                              onChange={e => setEditingName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveName(row.id, row.supply_id)
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                              className="w-full px-2 py-1 bg-bg-2 rounded border border-brand outline-none text-[11px]"
                              autoFocus
                            />
                            <button onClick={() => handleSaveName(row.id, row.supply_id)} className="p-1 text-ok hover:bg-success/10 rounded">
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-between group cursor-pointer"
                            onClick={() => handleEditName(row)}
                          >
                            <span className="font-semibold text-ink truncate">{row.name || '-'}</span>
                            <Edit3 className="w-3 h-3 text-brand opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink-3 truncate">{row.comercializadora || '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-ink-3 truncate tracking-tighter">{row.cups || '-'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                          isGas ? 'bg-warn-container text-warn' : 'bg-info-container text-info'
                        }`}>{row.tariff || '-'}</span>
                      </td>
                      <td className="px-3 py-2.5 truncate text-ink-3/70">{row.address || '-'}</td>
                      {[row.potencia_p1, row.potencia_p2, row.potencia_p3, row.potencia_p4, row.potencia_p5, row.potencia_p6].map((v, i) => (
                        <td key={`pot_${i}`} className={`text-right px-2 py-2.5 ${i >= potPeriods ? 'text-outline-variant/30' : 'text-ink/80'}`}>
                          {i >= potPeriods ? '—' : (v != null ? Number(v).toFixed(2) : '-')}
                        </td>
                      ))}
                      {[row.consumo_p1, row.consumo_p2, row.consumo_p3, row.consumo_p4, row.consumo_p5, row.consumo_p6].map((v, i) => (
                        <td key={`con_${i}`} className={`text-right px-2 py-2.5 font-medium ${i >= conPeriods ? 'text-outline-variant/30' : 'text-brand'}`}>
                          {i >= conPeriods ? '—' : (v != null ? formatNumber(v) : '-')}
                        </td>
                      ))}
                      <td className="text-right px-4 py-2.5 font-bold text-ink bg-bg-2/30">
                        {rowTotal(row) > 0 ? formatNumber(rowTotal(row)) : '-'}
                      </td>
                      {/* Source badge */}
                      <td className="text-center px-3 py-2.5">
                        {row.source === 'sips' ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-ok-container text-ok">SIPS</span>
                        ) : row.source === 'invoice_extraction' ? (
                          <a
                            href={row.invoice_file_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`w-7 h-7 rounded-full flex items-center justify-center mx-auto transition-all ${row.invoice_file_url ? 'bg-secondary/10 text-brand hover:bg-brand hover:text-white shadow-sm' : 'text-outline-variant/30'}`}
                            title={row.invoice_file_url ? 'Ver factura' : 'Factura no disponible'}
                            onClick={e => { if (!row.invoice_file_url) e.preventDefault() }}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-outline-variant/40 italic text-[9px]">—</span>
                        )}
                      </td>
                      {/* Per-row SIPS sync */}
                      {onSyncSupplySips && (
                        <td className="text-center px-3 py-2.5">
                          {row.cups ? (
                            <button
                              onClick={() => onSyncSupplySips(row.id, row.supply_id)}
                              disabled={isThisRowSyncing || isSyncingSupply}
                              title="Cargar datos SIPS para este suministro"
                              className="w-7 h-7 rounded-full bg-primary/10 text-brand hover:bg-brand hover:text-white transition-all flex items-center justify-center mx-auto disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isThisRowSyncing
                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />
                              }
                            </button>
                          ) : (
                            <span className="text-outline-variant/30 text-[9px]">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
