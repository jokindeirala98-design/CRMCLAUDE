'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Zap, X, ChevronRight, MapPin } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { BulkUploadModal } from '@/components/modals/BulkUploadModal'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

/** Normalize tariff strings for display */
function formatTariff(raw: string | null | undefined): string {
  if (!raw) return '-'
  const s = raw.replace(/\s+/g, '').toUpperCase()
  const tariffMap: Record<string, string> = {
    '2.0': '2.0TD', '20TD': '2.0TD', '2.0A': '2.0TD', '2.0DHA': '2.0DHA',
    '20': '2.0TD', '202020': '2.0TD', '20DHA': '2.0DHA',
    '3.0': '3.0TD', '30TD': '3.0TD', '3.0A': '3.0TD', '30': '3.0TD',
    '6.1': '6.1TD', '61TD': '6.1TD', '6.1A': '6.1TD', '61': '6.1TD',
    '6.2': '6.2TD', '62TD': '6.2TD', '62': '6.2TD',
    '6.3': '6.3TD', '63TD': '6.3TD', '63': '6.3TD',
    '6.4': '6.4TD', '64TD': '6.4TD', '64': '6.4TD',
    'RL.1': 'RL.1', 'RL1': 'RL.1',
    'RL.2': 'RL.2', 'RL2': 'RL.2',
  }
  return tariffMap[s] || raw
}

function fmtKwh(n: number | undefined): string {
  if (!n) return '—'
  return n.toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' kWh'
}

interface Supply {
  id: string
  name?: string
  cups?: string
  tariff?: string
  type?: string
  status?: string
  address?: string
  created_at?: string
  updated_at?: string
  client_id?: string
  consumption_data?: any
  comercializadora_id?: string
  client?: { name?: string; cif_nif?: string }
}

interface SupplyGroup {
  clientId: string
  clientName: string
  clientCif?: string
  supplies: Supply[]
  totalKwh: number
}

// ── Supply cards modal ──────────────────────────────────────────────────────

function SuppliesModal({
  group,
  consumptionMap,
  onClose,
}: {
  group: SupplyGroup
  consumptionMap: Record<string, number>
  onClose: () => void
}) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCardClick = (id: string) => {
    router.push(`/supplies/${id}`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative bg-bg rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
          <div>
            <h2 className="text-base font-bold text-ink">{group.clientName}</h2>
            <p className="text-xs text-ink-3 mt-0.5">
              {group.supplies.length} suministros
              {group.clientCif && ` · ${group.clientCif}`}
              {group.totalKwh > 0 && ` · ${fmtKwh(group.totalKwh)} total`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-bg-2 text-ink-3 hover:text-ink transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cards grid */}
        <div className="overflow-y-auto p-4 scrollbar-thin">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.supplies.map((supply) => {
              const kwh = consumptionMap[supply.id]
              const tariff = formatTariff(supply.tariff)
              const isGas = supply.type === 'gas'

              return (
                <button
                  key={supply.id}
                  onClick={() => handleCardClick(supply.id)}
                  className="group text-left bg-card border border-line rounded-xl p-4 hover:border-brand/40 hover:shadow-ambient-md transition-all duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  {/* Type icon + tariff */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                      isGas ? 'bg-warn-container/40' : 'bg-info-container/40'
                    )}>
                      <Zap className={cn('w-4 h-4', isGas ? 'text-warn' : 'text-info')} />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {tariff !== '-' && <Badge variant="info">{tariff}</Badge>}
                      <StatusBadge status={supply.status ?? ''} />
                    </div>
                  </div>

                  {/* CUPS */}
                  <p className="font-mono text-[11px] text-ink-3 truncate mb-1">
                    {supply.cups || 'Sin CUPS'}
                  </p>

                  {/* Alias / name */}
                  {supply.name && (
                    <p className="text-sm font-semibold text-ink truncate mb-1">{supply.name}</p>
                  )}

                  {/* Address */}
                  {supply.address && (
                    <div className="flex items-center gap-1 mt-1">
                      <MapPin className="w-3 h-3 text-ink-3 shrink-0" />
                      <p className="text-xs text-ink-3 truncate">{supply.address}</p>
                    </div>
                  )}

                  {/* Consumption */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
                    <span className="text-xs text-ink-3">Consumo anual</span>
                    <span className={cn(
                      'text-xs font-semibold',
                      kwh ? 'text-ink' : 'text-ink-3'
                    )}>
                      {kwh ? fmtKwh(kwh) : '—'}
                    </span>
                  </div>

                  {/* Arrow hint on hover */}
                  <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[10px] text-brand font-medium">Ver suministro</span>
                    <ChevronRight className="w-3 h-3 text-brand" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function SuppliesPage() {
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'recent' | 'consumption_desc' | 'consumption_asc'>('consumption_desc')
  const [consumptionMap, setConsumptionMap] = useState<Record<string, number>>({})
  const [showNewModal, setShowNewModal] = useState(false)
  const [openGroup, setOpenGroup] = useState<SupplyGroup | null>(null)
  const router = useRouter()

  const fetchSupplies = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from('supplies')
      .select('id, name, cups, tariff, type, status, address, created_at, updated_at, client_id, consumption_data, comercializadora_id, client:clients(name, cif_nif)')
      .order('created_at', { ascending: false })

    if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    const [suppliesResult, invoicesResult] = await Promise.all([
      query,
      supabase
        .from('invoices')
        .select('supply_id, extracted_data')
        .not('extracted_data', 'is', null)
    ])

    const consumptionData: Record<string, number> = {}
    if (invoicesResult.data) {
      invoicesResult.data.forEach((invoice: any) => {
        const kwh = invoice.extracted_data?.economics?.consumoTotalKwh
        if (kwh && invoice.supply_id) {
          consumptionData[invoice.supply_id] = (consumptionData[invoice.supply_id] || 0) + kwh
        }
      })
    }

    if (suppliesResult.data) {
      suppliesResult.data.forEach((supply: any) => {
        const cp = supply.consumption_data?.consumoPeriodos || {}
        const periodosSum = (Number(cp.P1)||0) + (Number(cp.P2)||0) + (Number(cp.P3)||0)
                          + (Number(cp.P4)||0) + (Number(cp.P5)||0) + (Number(cp.P6)||0)
        if (periodosSum > 0) {
          consumptionData[supply.id] = periodosSum
        } else if (!consumptionData[supply.id]) {
          const totalKwh = Number(supply.consumption_data?.totalKwh) || 0
          if (totalKwh > 0) consumptionData[supply.id] = totalKwh
        }
      })
    }

    setConsumptionMap(consumptionData)
    setSupplies(suppliesResult.data || [])
    setLoading(false)
  }, [filter])

  useEffect(() => { fetchSupplies() }, [fetchSupplies])

  // Build groups
  const sortedSupplies = [...supplies].sort((a, b) => {
    if (sortBy === 'consumption_desc') return (consumptionMap[b.id] || 0) - (consumptionMap[a.id] || 0)
    if (sortBy === 'consumption_asc') return (consumptionMap[a.id] || 0) - (consumptionMap[b.id] || 0)
    return 0
  })

  const groups: SupplyGroup[] = []
  const clientMap = new Map<string, Supply[]>()

  for (const s of sortedSupplies) {
    const key = s.client_id || '__no_client__'
    if (!clientMap.has(key)) clientMap.set(key, [])
    clientMap.get(key)!.push(s)
  }

  for (const [clientId, items] of Array.from(clientMap.entries())) {
    const totalKwh = items.reduce((sum: number, s: Supply) => sum + (consumptionMap[s.id] || 0), 0)
    groups.push({
      clientId,
      clientName: items[0]?.client?.name || 'Sin cliente',
      clientCif: items[0]?.client?.cif_nif,
      supplies: items,
      totalKwh,
    })
  }

  groups.sort((a, b) => {
    if (sortBy === 'consumption_desc') return b.totalKwh - a.totalKwh
    if (sortBy === 'consumption_asc') return a.totalKwh - b.totalKwh
    return 0
  })

  const statusFilters = [
    { key: 'all', label: 'Todos' },
    { key: 'primer_contacto', label: 'Primer contacto' },
    { key: 'prescoring_pendiente', label: 'Prescoring pte.' },
    { key: 'estudio_en_curso', label: 'En estudio' },
    { key: 'pendiente_firma', label: 'Pte. firma' },
    { key: 'firmado', label: 'Firmado' },
    { key: 'suscrito', label: 'Suscrito' },
    { key: 'seguimiento_activo', label: 'Seguimiento' },
  ]

  if (loading) {
    return (
      <div>
        <Header title="Suministros" subtitle="Cargando..." actions={
          <Button onClick={() => setShowNewModal(true)}><Plus className="w-4 h-4" />Importar Facturas</Button>
        } />
        <div className="px-4 lg:px-8 pb-24 lg:pb-8">
          <div className="bg-card rounded-xl border border-line p-8 flex items-center justify-center gap-3 text-ink-3">
            <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">Cargando...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Suministros"
        subtitle={`${supplies.length} suministros registrados`}
        actions={
          <Button onClick={() => setShowNewModal(true)} title="Importar facturas y crear suministros en segundo plano">
            <Plus className="w-4 h-4" />
            Importar Facturas
          </Button>
        }
      />

      <div className="px-4 lg:px-8 pb-24 lg:pb-8 space-y-4">
        {/* Filters */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  filter === f.key ? 'bg-brand text-white' : 'bg-bg-2 text-ink-3 hover:bg-bg-2'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {[
              { key: 'recent', label: 'Más recientes' },
              { key: 'consumption_desc', label: 'Consumo anual ↓' },
              { key: 'consumption_asc', label: 'Consumo anual ↑' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSortBy(key as any)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  sortBy === key ? 'bg-brand text-white' : 'bg-bg-2 text-ink-3 hover:bg-bg-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {supplies.length === 0 ? (
          <div className="bg-card rounded-xl border border-line p-12 text-center">
            <p className="text-sm text-ink-3">No hay suministros todavía</p>
            <p className="text-xs text-ink-4 mt-1">Crea el primero para empezar a operar.</p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-bg-2">
                    <th className="text-left px-5 py-3 font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]">CUPS</th>
                    <th className="text-left px-5 py-3 font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]">Cliente</th>
                    <th className="text-left px-5 py-3 font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]">Tarifa</th>
                    <th className="text-left px-5 py-3 font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]">Tipo</th>
                    <th className="text-left px-5 py-3 font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]">Consumo anual</th>
                    <th className="text-left px-5 py-3 font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group, gi) => {
                    const isMulti = group.supplies.length > 1
                    const isLastGroup = gi === groups.length - 1

                    if (!isMulti) {
                      // Single supply — flat row
                      const item = group.supplies[0]
                      return (
                        <tr
                          key={item.id}
                          onClick={() => router.push(`/supplies/${item.id}`)}
                          className={cn(
                            'cursor-pointer transition-colors duration-100 hover:bg-bg',
                            !isLastGroup && 'border-b border-line'
                          )}
                        >
                          <SupplyRowCells item={item} consumptionMap={consumptionMap} />
                        </tr>
                      )
                    }

                    // Multi-supply group → click opens modal
                    return (
                      <tr
                        key={`group-${group.clientId}`}
                        onClick={() => setOpenGroup(group)}
                        className={cn(
                          'cursor-pointer transition-colors duration-100 hover:bg-bg bg-bg-2/40',
                          !isLastGroup && 'border-b border-line',
                          'group/row'
                        )}
                      >
                        {/* CUPS col: supply count */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-brand/10 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-brand">{group.supplies.length}</span>
                            </div>
                            <span className="text-xs text-ink-3 group-hover/row:text-brand transition-colors">
                              suministros
                            </span>
                          </div>
                        </td>
                        {/* Client name */}
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-semibold text-ink">{group.clientName}</p>
                          {group.clientCif && <p className="text-xs text-ink-3">{group.clientCif}</p>}
                        </td>
                        {/* Tariffs */}
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {Array.from(new Set(group.supplies.map(s => formatTariff(s.tariff)).filter(t => t !== '-'))).map(t => (
                              <Badge key={t} variant="info">{t}</Badge>
                            ))}
                          </div>
                        </td>
                        {/* Type */}
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-ink-3 capitalize">
                            {Array.from(new Set(group.supplies.map(s => s.type).filter(Boolean))).join(' / ')}
                          </span>
                        </td>
                        {/* Total consumption */}
                        <td className="px-5 py-3.5">
                          <span className="text-sm font-medium text-ink">
                            {group.totalKwh > 0 ? fmtKwh(group.totalKwh) : '—'}
                          </span>
                          {group.totalKwh > 0 && (
                            <p className="text-[10px] text-ink-3">total grupo</p>
                          )}
                        </td>
                        {/* Hint */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1 text-ink-3 group-hover/row:text-brand transition-colors">
                            <span className="text-xs font-medium">Ver CUPS</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Supply group modal */}
      <AnimatePresence>
        {openGroup && (
          <SuppliesModal
            group={openGroup}
            consumptionMap={consumptionMap}
            onClose={() => setOpenGroup(null)}
          />
        )}
      </AnimatePresence>

      <BulkUploadModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={fetchSupplies}
      />
    </div>
  )
}

/** Shared cell rendering for a single supply flat row */
function SupplyRowCells({
  item,
  consumptionMap,
}: {
  item: Supply
  consumptionMap: Record<string, number>
}) {
  const consumption = consumptionMap[item.id]
  return (
    <>
      <td className="px-5 py-3.5">
        <span className="font-mono text-xs text-ink">{item.cups || 'Sin CUPS'}</span>
      </td>
      <td className="px-5 py-3.5">
        <div>
          <p className="text-sm font-medium text-ink">{item.client?.name || '-'}</p>
          <p className="text-xs text-ink-3">{item.client?.cif_nif}</p>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <Badge variant="info">{formatTariff(item.tariff)}</Badge>
      </td>
      <td className="px-5 py-3.5">
        <span className="text-sm capitalize text-ink-3">{item.type}</span>
      </td>
      <td className="px-5 py-3.5">
        {consumption ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-ink font-medium">{fmtKwh(consumption)}</span>
          </div>
        ) : (
          <span className="text-sm text-ink-3">—</span>
        )}
      </td>
      <td className="px-5 py-3.5">
        <StatusBadge status={item.status ?? ''} />
      </td>
    </>
  )
}
