'use client'

import { useState, useCallback } from 'react'
import { Pencil, Trash2, Check, X, ChevronUp, ChevronDown, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { ConsumptionSnapshot } from '@/types/database'
import { getPeriodsForTariff, getPowerPeriodsForTariff, formatNumber, rowTotal } from '@/lib/consumption-utils'

interface Props {
  rows: ConsumptionSnapshot[]
  onRowUpdated: () => void
  onRowDeleted: () => void
}

type SortKey = 'cups' | 'comercializadora' | 'consumo_total' | 'validation_status'
type SortDir = 'asc' | 'desc'

export default function ConsumptionTable({ rows, onRowUpdated, onRowDeleted }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<ConsumptionSnapshot>>({})
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [search, setSearch] = useState('')
  const [filterTariff, setFilterTariff] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ field }: { field: SortKey }) => {
    if (sortKey !== field) return null
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  // Combined priority: luz (6.x > 3.0 > 2.0) always before gas (RL4 > RL3 > RL2 > RL1)
  function rowPriority(r: ConsumptionSnapshot): number {
    const t = (r.tariff || '').trim().toUpperCase()
    if (r.supply_type === 'gas') {
      if (t.includes('4')) return 14
      if (t.includes('3')) return 13
      if (t.includes('2')) return 12
      if (t.includes('1')) return 11
      return 10
    }
    // luz
    if (t.startsWith('6.4')) return 64
    if (t.startsWith('6.3')) return 63
    if (t.startsWith('6.2')) return 62
    if (t.startsWith('6.1')) return 61
    if (t.startsWith('6'))   return 60
    if (t.startsWith('3.0')) return 40
    if (t.startsWith('3'))   return 39
    if (t.startsWith('2.0')) return 20
    if (t.startsWith('2'))   return 19
    return 5
  }

  // Filter & sort — tariff+type is ALWAYS the primary sort (descending = highest first)
  const filtered = rows
    .filter(r => {
      if (search) {
        const q = search.toLowerCase()
        if (!r.cups?.toLowerCase().includes(q) && !r.address?.toLowerCase().includes(q) && !r.comercializadora?.toLowerCase().includes(q) && !r.name?.toLowerCase().includes(q)) return false
      }
      if (filterTariff !== 'all' && r.tariff !== filterTariff) return false
      if (filterType !== 'all' && r.supply_type !== filterType) return false
      return true
    })
    .sort((a, b) => {
      // Primary: tariff+type, always descending (highest tariff first)
      const primDiff = rowPriority(b) - rowPriority(a)
      if (primDiff !== 0) return primDiff
      // Secondary: user-selected column
      if (!sortKey) return 0
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'consumo_total') return (rowTotal(a) - rowTotal(b)) * dir
      const av = (a as any)[sortKey] ?? ''
      const bv = (b as any)[sortKey] ?? ''
      return String(av).localeCompare(String(bv)) * dir
    })

  // Unique tariffs for filter
  const tariffs = Array.from(new Set(rows.map(r => r.tariff).filter(Boolean))) as string[]

  const startEdit = (row: ConsumptionSnapshot) => {
    setEditingId(row.id)
    setEditValues({
      cups: row.cups,
      tariff: row.tariff,
      supply_type: row.supply_type,
      comercializadora: row.comercializadora,
      address: row.address,
      potencia_p1: row.potencia_p1,
      potencia_p2: row.potencia_p2,
      potencia_p3: row.potencia_p3,
      potencia_p4: row.potencia_p4,
      potencia_p5: row.potencia_p5,
      potencia_p6: row.potencia_p6,
      consumo_p1: row.consumo_p1,
      consumo_p2: row.consumo_p2,
      consumo_p3: row.consumo_p3,
      consumo_p4: row.consumo_p4,
      consumo_p5: row.consumo_p5,
      consumo_p6: row.consumo_p6,
      consumo_total: row.consumo_total,
    })
  }

  const saveEdit = async () => {
    if (!editingId) return
    const supabase = createClient()
    // Recalculate total
    const total = (Number(editValues.consumo_p1) || 0) + (Number(editValues.consumo_p2) || 0) +
      (Number(editValues.consumo_p3) || 0) + (Number(editValues.consumo_p4) || 0) +
      (Number(editValues.consumo_p5) || 0) + (Number(editValues.consumo_p6) || 0)

    await supabase
      .from('consumption_snapshots')
      .update({
        ...editValues,
        consumo_total: total > 0 ? total : editValues.consumo_total,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId)

    setEditingId(null)
    setEditValues({})
    onRowUpdated()
  }

  const deleteRow = async (id: string) => {
    const supabase = createClient()
    await supabase.from('consumption_snapshots').delete().eq('id', id)
    setDeletingId(null)
    onRowDeleted()
  }

  const cellClass = (row: ConsumptionSnapshot, field: string) => {
    const conf = row.confidence_json as Record<string, string> | null
    if (!conf) return ''
    const level = conf[field]
    if (level === 'baja') return 'bg-err-container/40'
    if (level === 'media') return 'bg-warn-container/40'
    return ''
  }

  const EditInput = ({ field, type = 'text', className = 'w-20' }: { field: string; type?: string; className?: string }) => (
    <input
      type={type}
      value={(editValues as any)[field] ?? ''}
      onChange={e => setEditValues(prev => ({ ...prev, [field]: type === 'number' ? (e.target.value ? Number(e.target.value) : null) : e.target.value }))}
      className={`${className} px-1.5 py-0.5 text-xs bg-bg-2 rounded border border-line-2-variant/30 outline-none focus:border-brand`}
      step={type === 'number' ? '0.01' : undefined}
    />
  )

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            placeholder="Buscar CUPS, nombre, dirección, comercializadora..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-2 rounded-lg border border-line-2-variant/20 outline-none focus:border-brand"
          />
        </div>
        <select
          value={filterTariff}
          onChange={e => setFilterTariff(e.target.value)}
          className="text-xs px-2.5 py-1.5 bg-bg-2 rounded-lg border border-line-2-variant/20 outline-none"
        >
          <option value="all">Todas las tarifas</option>
          {tariffs.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-xs px-2.5 py-1.5 bg-bg-2 rounded-lg border border-line-2-variant/20 outline-none"
        >
          <option value="all">Luz y Gas</option>
          <option value="luz">Solo Electricidad</option>
          <option value="gas">Solo Gas</option>
        </select>
        <span className="text-xs text-ink-3 ml-auto">
          {filtered.length} de {rows.length} suministros
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-line-2-variant/15">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-bg-2 text-ink-3">
              <th className="sticky left-0 bg-bg-2 z-10 px-3 py-2 text-left font-semibold cursor-pointer" onClick={() => toggleSort('cups')}>
                <span className="flex items-center gap-1">CUPS <SortIcon field="cups" /></span>
              </th>
              <th className="px-3 py-2 text-left font-semibold" title="Orden fijo: 6.1 → 3.0 → 2.0 → RL4 → RL1">
                <span className="flex items-center gap-1">Tarifa <ChevronDown className="w-3 h-3 opacity-30" /></span>
              </th>
              <th className="px-3 py-2 text-left font-semibold">Tipo</th>
              <th className="px-3 py-2 text-left font-semibold cursor-pointer" onClick={() => toggleSort('comercializadora')}>
                <span className="flex items-center gap-1">Comercializadora <SortIcon field="comercializadora" /></span>
              </th>
              <th className="px-2 py-2 text-right font-semibold">P1</th>
              <th className="px-2 py-2 text-right font-semibold">P2</th>
              <th className="px-2 py-2 text-right font-semibold">P3</th>
              <th className="px-2 py-2 text-right font-semibold">P4</th>
              <th className="px-2 py-2 text-right font-semibold">P5</th>
              <th className="px-2 py-2 text-right font-semibold">P6</th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer" onClick={() => toggleSort('consumo_total')}>
                <span className="flex items-center gap-1 justify-end">Total kWh <SortIcon field="consumo_total" /></span>
              </th>
              <th className="px-2 py-2 text-center font-semibold cursor-pointer" onClick={() => toggleSort('validation_status')}>
                <span className="flex items-center gap-1">Estado <SortIcon field="validation_status" /></span>
              </th>
              <th className="px-2 py-2 text-center font-semibold w-20">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-center py-8 text-ink-3">
                  No hay suministros que mostrar
                </td>
              </tr>
            ) : (
              filtered.map(row => {
                const isEditing = editingId === row.id
                const isDeleting = deletingId === row.id
                const total = rowTotal(row)

                return (
                  <tr key={row.id} className={`border-t border-line-2-variant/10 hover:bg-bg-2/30 ${isEditing ? 'bg-primary/5' : ''} ${isDeleting ? 'bg-err-container/40' : ''}`}>
                    {/* CUPS */}
                    <td className={`sticky left-0 bg-white z-10 px-3 py-2 font-mono ${cellClass(row, 'cups')}`}>
                      {isEditing ? <EditInput field="cups" className="w-40" /> : (
                        <span className="text-ink font-medium">{row.cups || '-'}</span>
                      )}
                    </td>

                    {/* Tarifa */}
                    <td className={`px-3 py-2 ${cellClass(row, 'tariff')}`}>
                      {isEditing ? (
                        <select
                          value={editValues.tariff || ''}
                          onChange={e => setEditValues(prev => ({ ...prev, tariff: e.target.value }))}
                          className="text-xs px-1.5 py-0.5 bg-bg-2 rounded border border-line-2-variant/30"
                        >
                          <option value="">-</option>
                          <option value="2.0TD">2.0TD</option>
                          <option value="3.0TD">3.0TD</option>
                          <option value="6.1TD">6.1TD</option>
                          <option value="RL1">RL1</option>
                          <option value="RL2">RL2</option>
                          <option value="RL3">RL3</option>
                          <option value="RL4">RL4</option>
                        </select>
                      ) : (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          row.tariff?.includes('2.0') ? 'bg-info-container/40 text-info' :
                          row.tariff?.includes('3.0') ? 'bg-warn-container/40 text-warn' :
                          row.tariff?.includes('6.1') ? 'bg-err-container/40 text-err' :
                          row.tariff?.startsWith('RL') ? 'bg-info-container/40 text-info' :
                          'bg-slate-50 text-slate-600'
                        }`}>
                          {row.tariff || '-'}
                        </span>
                      )}
                    </td>

                    {/* Tipo */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select
                          value={editValues.supply_type || ''}
                          onChange={e => setEditValues(prev => ({ ...prev, supply_type: e.target.value as 'luz' | 'gas' }))}
                          className="text-xs px-1.5 py-0.5 bg-bg-2 rounded border border-line-2-variant/30"
                        >
                          <option value="luz">Electricidad</option>
                          <option value="gas">Gas</option>
                        </select>
                      ) : (
                        <span className="capitalize">{row.supply_type === 'gas' ? 'Gas' : 'Electricidad'}</span>
                      )}
                    </td>

                    {/* Comercializadora */}
                    <td className={`px-3 py-2 max-w-[150px] truncate ${cellClass(row, 'comercializadora')}`}>
                      {isEditing ? <EditInput field="comercializadora" className="w-28" /> : row.comercializadora || '-'}
                    </td>

                    {/* Consumos P1-P6 */}
                    {(['consumo_p1', 'consumo_p2', 'consumo_p3', 'consumo_p4', 'consumo_p5', 'consumo_p6'] as const).map(field => (
                      <td key={field} className="px-2 py-2 text-right tabular-nums">
                        {isEditing ? (
                          <EditInput field={field} type="number" className="w-16" />
                        ) : (
                          <span className={row[field] != null ? 'text-ink' : 'text-ink-3/30'}>
                            {row[field] != null ? formatNumber(row[field]) : '-'}
                          </span>
                        )}
                      </td>
                    ))}

                    {/* Total */}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                      {formatNumber(total)}
                    </td>

                    {/* Validation status */}
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        row.validation_status === 'OK' ? 'bg-ok-container/40 text-ok' :
                        row.validation_status === 'Revisar' ? 'bg-warn-container/40 text-warn' :
                        'bg-err-container/40 text-err'
                      }`}>
                        {row.validation_status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-2 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={saveEdit} className="p-1 text-ok hover:bg-success/10 rounded">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => { setEditingId(null); setEditValues({}) }} className="p-1 text-err hover:bg-error/10 rounded">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : isDeleting ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => deleteRow(row.id)} className="px-1.5 py-0.5 text-[10px] bg-err text-white rounded font-medium">Si</button>
                          <button onClick={() => setDeletingId(null)} className="px-1.5 py-0.5 text-[10px] bg-slate-200 text-slate-600 rounded">No</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 hover:opacity-100" style={{ opacity: 1 }}>
                          <button onClick={() => startEdit(row)} className="p-1 text-ink-3 hover:text-brand hover:bg-primary/10 rounded" title="Editar">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => setDeletingId(row.id)} className="p-1 text-ink-3 hover:text-err hover:bg-error/10 rounded" title="Eliminar">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
