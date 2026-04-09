'use client'

import { useState } from 'react'
import { 
  Zap, CheckCircle2, AlertTriangle, Layout, RefreshCw, 
  Edit3, Save, ExternalLink, BarChart3, FileText
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
  isSyncingSupply: boolean
  onViewReport: () => void
  hasReport: boolean
  onGenerateReport: () => Promise<void>
  generating: boolean
}

export function TechnicalAuditTable({
  rows,
  clientName,
  syncing,
  onSync,
  onUpdateName,
  isSyncingSupply,
  onViewReport,
  hasReport,
  onGenerateReport,
  generating
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
      {/* Action Bar inside table view */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
           <Button variant="secondary" size="sm" onClick={onSync} loading={syncing}>
            <RefreshCw className="w-4 h-4" />
            {rows.length === 0 ? 'Cargar datos' : 'Sincronizar'}
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

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="!py-3 !px-4">
          <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-primary" /> Suministros
          </p>
          <p className="font-display font-black text-2xl text-on-surface mt-1">{rows.length}</p>
        </Card>
        <Card className="!py-3 !px-4 border-l-4 border-l-success">
          <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-success" /> OK
          </p>
          <p className="font-display font-black text-2xl text-success mt-1">{rows.filter(r => r.validation_status === 'OK').length}</p>
        </Card>
        <Card className="!py-3 !px-4 border-l-4 border-l-warning">
          <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-warning" /> Revisar
          </p>
          <p className="font-display font-black text-2xl text-warning mt-1">{rows.filter(r => r.validation_status === 'Revisar').length}</p>
        </Card>
        <Card className="!py-3 !px-4 border-l-4 border-l-error">
          <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-error" /> Incompleto
          </p>
          <p className="font-display font-black text-2xl text-error mt-1">{rows.filter(r => r.validation_status === 'Incompleto').length}</p>
        </Card>
      </div>

      {/* Validation Messages */}
      {(!validation.valid || validation.warnings.length > 0) && (
        <div className="space-y-1">
          {validation.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {e}
            </p>
          ))}
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {w}
            </p>
          ))}
        </div>
      )}

      {/* Table Card */}
      <Card className="!p-0 overflow-hidden border-none shadow-ambient-lg bg-surface-container-lowest">
        <div className="px-5 py-3.5 border-b border-outline-variant/10 flex items-center justify-between bg-surface-container-low/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Layout className="w-4 h-4 text-primary" />
            </div>
            <div>
              <span className="text-sm font-bold text-on-surface block">Base de Datos Técnica</span>
              <span className="text-[10px] text-on-surface-variant">Análisis detallado de 19 campos críticos</span>
            </div>
          </div>
          {isSyncingSupply && (
            <div className="flex items-center gap-2 text-[10px] text-primary animate-pulse font-bold uppercase tracking-wider">
              <RefreshCw className="w-3 h-3 animate-spin" /> Sincronizando...
            </div>
          )}
        </div>
        
        <div className="overflow-x-auto scrollbar-thin">
          <table className="text-[11px] border-collapse w-full tabular-nums" style={{ minWidth: 1500 }}>
            <thead>
              <tr className="bg-surface-container-low/50 border-b border-outline-variant/10">
                <th className="text-left px-4 py-3 font-bold text-on-surface-variant sticky left-0 bg-surface-container-low/50 z-20 min-w-[150px]">Nombre (Alias)</th>
                <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[140px]">Comercializadora</th>
                <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[180px]">CUPS</th>
                <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[70px]">Tarifa</th>
                <th className="text-left px-3 py-3 font-bold text-on-surface-variant min-w-[200px]">Dirección</th>
                {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(p => (
                  <th key={`pot_${p}`} className="text-right px-2 py-3 font-bold text-on-surface-variant min-w-[65px]">Pot.{p} (kW)</th>
                ))}
                {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(p => (
                  <th key={`con_${p}`} className="text-right px-2 py-3 font-bold text-primary min-w-[75px]">Con.{p} (kWh)</th>
                ))}
                <th className="text-right px-4 py-3 font-bold text-on-surface min-w-[90px]">Total Anual</th>
                <th className="text-center px-4 py-3 font-bold text-on-surface-variant min-w-[80px]">Factura</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={19} className="py-12 text-center text-on-surface-variant italic">
                    No hay datos disponibles. Pulsa &quot;Cargar datos&quot; para comenzar.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const tariffUpper = (row.tariff || '').toUpperCase()
                  const is20 = tariffUpper.includes('2.0')
                  const isGas = row.supply_type === 'gas' || tariffUpper.startsWith('RL')
                  const potPeriods = is20 ? 2 : isGas ? 0 : 6
                  const conPeriods = is20 ? 3 : isGas ? 0 : 6
                  const isEditing = editingId === row.id

                  return (
                    <tr key={row.id} className={`border-b border-outline-variant/5 transition-colors hover:bg-primary/5 ${idx % 2 === 1 ? 'bg-surface-container-lowest' : 'bg-surface-container-lowest/50'}`}>
                      <td className="px-4 py-2.5 sticky left-0 bg-surface-container-lowest z-10 border-r border-outline-variant/10">
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
                              className="w-full px-2 py-1 bg-surface-container-high rounded border border-primary outline-none text-[11px]"
                              autoFocus
                            />
                            <button onClick={() => handleSaveName(row.id, row.supply_id)} className="p-1 text-success hover:bg-success/10 rounded">
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div 
                            className="flex items-center justify-between group cursor-pointer"
                            onClick={() => handleEditName(row)}
                          >
                            <span className="font-semibold text-on-surface truncate">{row.name || '-'}</span>
                            <Edit3 className="w-3 h-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-on-surface-variant truncate">{row.comercializadora || '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-on-surface-variant truncate tracking-tighter">{row.cups || '-'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                          isGas ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                        }`}>{row.tariff || '-'}</span>
                      </td>
                      <td className="px-3 py-2.5 truncate text-on-surface-variant/70">{row.address || '-'}</td>
                      {[row.potencia_p1, row.potencia_p2, row.potencia_p3, row.potencia_p4, row.potencia_p5, row.potencia_p6].map((v, i) => (
                        <td key={`pot_${i}`} className={`text-right px-2 py-2.5 ${i >= potPeriods ? 'text-outline-variant/30' : 'text-on-surface/80'}`}>
                          {i >= potPeriods ? '—' : (v != null ? Number(v).toFixed(2) : '-')}
                        </td>
                      ))}
                      {[row.consumo_p1, row.consumo_p2, row.consumo_p3, row.consumo_p4, row.consumo_p5, row.consumo_p6].map((v, i) => (
                        <td key={`con_${i}`} className={`text-right px-2 py-2.5 font-medium ${i >= conPeriods ? 'text-outline-variant/30' : 'text-primary'}`}>
                          {i >= conPeriods ? '—' : (v != null ? formatNumber(v) : '-')}
                        </td>
                      ))}
                      <td className="text-right px-4 py-2.5 font-bold text-on-surface bg-surface-container-low/30">{formatNumber(rowTotal(row))}</td>
                      <td className="text-center px-4 py-2.5">
                        {row.invoice_file_url ? (
                          <a 
                            href={row.invoice_file_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center mx-auto text-secondary hover:bg-secondary hover:text-white transition-all shadow-sm"
                            title="Ver factura original"
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-outline-variant/30 italic text-[9px]">{row.source === 'sips' ? 'SIPS' : 'Sin archivo'}</span>
                        )}
                      </td>
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
