'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Zap, X, ChevronRight, MapPin, Search,
  SlidersHorizontal, Camera, Upload,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { BulkUploadModal } from '@/components/modals/BulkUploadModal'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    'RL04': 'RL04', 'RL4': 'RL04',
    'RL.1': 'RL.1', 'RL1': 'RL.1',
    'RL.2': 'RL.2', 'RL2': 'RL.2',
  }
  return tariffMap[s] || raw
}

function tariffSortKey(tariff: string): number {
  if (tariff.startsWith('6.4')) return 60
  if (tariff.startsWith('6.3')) return 59
  if (tariff.startsWith('6.2')) return 58
  if (tariff.startsWith('6.1')) return 57
  if (tariff.startsWith('6'))   return 56
  if (tariff.startsWith('3.0')) return 40
  if (tariff.startsWith('2.0')) return 20
  return 0
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

// ── Supply cards modal (desktop + mobile full-screen) ─────────────────────────

function SuppliesModal({ group, consumptionMap, onClose }: {
  group: SupplyGroup
  consumptionMap: Record<string, number>
  onClose: () => void
}) {
  const router = useRouter()
  const [tariffFilter, setTariffFilter] = useState('')

  const sortedSupplies = [...group.supplies].sort((a, b) => {
    const aGas = a.type === 'gas' ? 1 : 0
    const bGas = b.type === 'gas' ? 1 : 0
    if (aGas !== bGas) return aGas - bGas
    return tariffSortKey(formatTariff(b.tariff)) - tariffSortKey(formatTariff(a.tariff))
  })

  const visibleSupplies = tariffFilter
    ? sortedSupplies.filter(s => formatTariff(s.tariff).replace(/\s+/g, '').toUpperCase().startsWith(tariffFilter.toUpperCase()))
    : sortedSupplies

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Backspace') { e.stopPropagation(); e.preventDefault(); setTariffFilter(prev => prev.slice(0, -1)); return }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.stopPropagation(); e.preventDefault(); setTariffFilter(prev => prev + e.key)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel — full screen on mobile, modal on desktop */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="relative bg-bg rounded-t-3xl md:rounded-2xl shadow-2xl w-full md:max-w-3xl h-[92dvh] md:max-h-[82vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle (mobile) */}
        <div className="md:hidden w-10 h-1 bg-line rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-ink">{group.clientName}</h2>
            <p className="text-xs text-ink-3 mt-0.5">
              {visibleSupplies.length !== group.supplies.length
                ? `${visibleSupplies.length} de ${group.supplies.length} suministros`
                : `${group.supplies.length} suministros`}
              {group.clientCif && ` · ${group.clientCif}`}
              {group.totalKwh > 0 && ` · ${fmtKwh(group.totalKwh)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tariffFilter && (
              <button onClick={() => setTariffFilter('')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand/10 text-brand text-xs font-mono font-semibold">
                {tariffFilter.toUpperCase()} <X className="w-3 h-3" />
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-bg-2 text-ink-3 active:scale-90 transition-all">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cards */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {visibleSupplies.length === 0 ? (
            <div className="text-center py-12 text-ink-3 text-sm">
              No hay suministros con tarifa <span className="font-mono font-semibold">{tariffFilter.toUpperCase()}</span>
            </div>
          ) : visibleSupplies.map(supply => {
            const kwh = consumptionMap[supply.id]
            const tariff = formatTariff(supply.tariff)
            const isGas = supply.type === 'gas'
            return (
              <button
                key={supply.id}
                onClick={() => { router.push(`/supplies/${supply.id}`); onClose() }}
                className="w-full text-left bg-card border border-line rounded-2xl p-4 active:scale-[0.98] active:bg-bg-2 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
                    isGas ? 'bg-warn-container/40' : 'bg-info-container/40')}>
                    <Zap className={cn('w-4 h-4', isGas ? 'text-warn' : 'text-info')} />
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {tariff !== '-' && <Badge variant="info">{tariff}</Badge>}
                    <StatusBadge status={supply.status ?? ''} />
                  </div>
                </div>
                <p className="font-mono text-[10px] text-ink-3 truncate">{supply.cups || 'Sin CUPS'}</p>
                {supply.name && <p className="text-sm font-semibold text-ink truncate mt-0.5">{supply.name}</p>}
                {supply.address && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <MapPin className="w-3 h-3 text-ink-3 flex-shrink-0" />
                    <p className="text-xs text-ink-3 truncate">{supply.address}</p>
                  </div>
                )}
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line">
                  <span className="text-xs text-ink-3">Consumo anual</span>
                  <span className={cn('text-xs font-semibold', kwh ? 'text-ink' : 'text-ink-3')}>{fmtKwh(kwh)}</span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Hint (desktop only) */}
        <div className="hidden md:flex px-6 py-2 border-t border-line flex-shrink-0">
          <span className="text-[10px] text-ink-3">Pulsa una tecla para filtrar por tarifa · Esc para cerrar</span>
        </div>
      </motion.div>
    </div>
  )
}

// ── Mobile list row ───────────────────────────────────────────────────────────

function MobileGroupRow({ group, consumptionMap, onClick }: {
  group: SupplyGroup
  consumptionMap: Record<string, number>
  onClick: () => void
}) {
  const isMulti = group.supplies.length > 1
  const first = group.supplies[0]
  const tariff = formatTariff(first?.tariff)
  const isGas = first?.type === 'gas'

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 active:bg-bg-2 transition-colors border-b border-line/40 last:border-0 text-left"
    >
      {/* Icon */}
      <div className={cn(
        'w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0',
        isGas ? 'bg-warn-container/30' : 'bg-info-container/30'
      )}>
        <Zap className={cn('w-4.5 h-4.5', isGas ? 'text-warn' : 'text-info')} style={{ width: 18, height: 18 }} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold text-ink truncate leading-snug">{group.clientName}</p>
        <p className="text-[12px] text-ink-3 truncate leading-snug mt-0.5">
          {isMulti
            ? `${group.supplies.length} suministros · ${fmtKwh(group.totalKwh)}`
            : `${tariff !== '-' ? tariff + ' · ' : ''}${fmtKwh(consumptionMap[first?.id])}`
          }
        </p>
      </div>

      {/* Right: badge or count + chevron */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isMulti ? (
          <span className="text-[11px] font-bold text-brand bg-brand/10 w-6 h-6 rounded-full flex items-center justify-center">
            {group.supplies.length}
          </span>
        ) : (
          <StatusBadge status={first?.status ?? ''} />
        )}
        <ChevronRight className="w-4 h-4 text-ink-3/60" />
      </div>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SuppliesPage() {
  const router = useRouter()
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'recent' | 'consumption_desc' | 'consumption_asc'>('consumption_desc')
  const [consumptionMap, setConsumptionMap] = useState<Record<string, number>>({})
  const [showNewModal, setShowNewModal] = useState(false)
  const [openGroup, setOpenGroup] = useState<SupplyGroup | null>(null)

  // ── Pull-to-reveal search (mobile) ──────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pullY, setPullY] = useState(0)   // 0-THRESHOLD px, drives indicator
  const PULL_THRESHOLD = 72
  const touchStartY = useRef(0)
  const touchActive = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => searchInputRef.current?.focus(), 80)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [])

  // Touch listeners on the scroll container
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      if (searchOpen) return
      if (el.scrollTop > 4) return
      touchStartY.current = e.touches[0].clientY
      touchActive.current = true
    }

    const onMove = (e: TouchEvent) => {
      if (!touchActive.current || searchOpen) return
      if (el.scrollTop > 4) { touchActive.current = false; setPullY(0); return }
      const dy = e.touches[0].clientY - touchStartY.current
      if (dy > 0) {
        // Resist: use square-root easing so it feels elastic
        const resisted = Math.min(Math.sqrt(dy * PULL_THRESHOLD), PULL_THRESHOLD)
        setPullY(resisted)
      }
    }

    const onEnd = () => {
      if (!touchActive.current) return
      touchActive.current = false
      if (pullY >= PULL_THRESHOLD - 4) {
        openSearch()
      }
      setPullY(0)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [searchOpen, pullY, openSearch])

  // ── Data fetch ──────────────────────────────────────────────────────────────

  const fetchSupplies = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const [suppliesResult, invoicesResult] = await Promise.all([
      supabase
        .from('supplies')
        .select('id, name, cups, tariff, type, status, address, created_at, updated_at, client_id, consumption_data, comercializadora_id, client:clients(name, cif_nif)')
        .order('created_at', { ascending: false })
        .then(r => filter !== 'all' ? supabase.from('supplies').select('id, name, cups, tariff, type, status, address, created_at, updated_at, client_id, consumption_data, comercializadora_id, client:clients(name, cif_nif)').eq('status', filter).order('created_at', { ascending: false }) : r),
      supabase.from('invoices').select('supply_id, extracted_data').not('extracted_data', 'is', null),
    ])

    const invoiceKwhSum: Record<string, number> = {}
    invoicesResult.data?.forEach((inv: any) => {
      const kwh = inv.extracted_data?.economics?.consumoTotalKwh
      if (kwh && inv.supply_id) invoiceKwhSum[inv.supply_id] = (invoiceKwhSum[inv.supply_id] || 0) + kwh
    })

    const consumptionData: Record<string, number> = {}
    suppliesResult.data?.forEach((supply: any) => {
      const cd = supply.consumption_data as any
      const isGas = supply.type === 'gas'
      if (isGas) {
        const gasTotal = Number(cd?.totalKwh) || 0
        if (gasTotal > 0) { consumptionData[supply.id] = gasTotal; return }
        const histSum = (cd?.gasHistory || []).reduce((s: number, p: any) => s + (Number(p.kwh) || 0), 0)
        if (histSum > 0) consumptionData[supply.id] = histSum
      } else {
        const cp = cd?.consumoPeriodos || {}
        const periodosSum = (Number(cp.P1)||0)+(Number(cp.P2)||0)+(Number(cp.P3)||0)+(Number(cp.P4)||0)+(Number(cp.P5)||0)+(Number(cp.P6)||0)
        if (periodosSum > 0) { consumptionData[supply.id] = periodosSum; return }
        const sipsTotal = Number(cd?.totalKwh) || Number(cd?.total) || 0
        if (sipsTotal > 0) { consumptionData[supply.id] = sipsTotal; return }
        const invSum = invoiceKwhSum[supply.id] || 0
        if (invSum > 0) consumptionData[supply.id] = invSum
      }
    })

    setConsumptionMap(consumptionData)
    setSupplies(suppliesResult.data || [])
    setLoading(false)
  }, [filter])

  useEffect(() => { fetchSupplies() }, [fetchSupplies])

  // ── Groups ──────────────────────────────────────────────────────────────────

  const allGroups: SupplyGroup[] = useMemo(() => {
    const sorted = [...supplies].sort((a, b) => {
      if (sortBy === 'consumption_desc') return (consumptionMap[b.id] || 0) - (consumptionMap[a.id] || 0)
      if (sortBy === 'consumption_asc') return (consumptionMap[a.id] || 0) - (consumptionMap[b.id] || 0)
      return 0
    })
    const clientMap = new Map<string, Supply[]>()
    sorted.forEach(s => {
      const key = s.client_id || '__no_client__'
      if (!clientMap.has(key)) clientMap.set(key, [])
      clientMap.get(key)!.push(s)
    })
    const groups: SupplyGroup[] = []
    clientMap.forEach((items, clientId) => {
      const totalKwh = items.reduce((sum, s) => sum + (consumptionMap[s.id] || 0), 0)
      groups.push({ clientId, clientName: items[0]?.client?.name || 'Sin cliente', clientCif: items[0]?.client?.cif_nif, supplies: items, totalKwh })
    })
    if (sortBy !== 'recent') groups.sort((a, b) => sortBy === 'consumption_desc' ? b.totalKwh - a.totalKwh : a.totalKwh - b.totalKwh)
    return groups
  }, [supplies, consumptionMap, sortBy])

  // Apply search filter
  const groups = useMemo(() => {
    if (!searchQuery.trim()) return allGroups
    const q = searchQuery.toLowerCase()
    return allGroups.filter(g =>
      g.clientName.toLowerCase().includes(q) ||
      g.clientCif?.toLowerCase().includes(q) ||
      g.supplies.some(s => s.cups?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q))
    )
  }, [allGroups, searchQuery])

  const statusFilters = [
    { key: 'all', label: 'Todos' },
    { key: 'primer_contacto', label: 'Contacto' },
    { key: 'estudio_en_curso', label: 'En estudio' },
    { key: 'pendiente_firma', label: 'Pte. firma' },
    { key: 'firmado', label: 'Firmado' },
    { key: 'suscrito', label: 'Suscrito' },
    { key: 'seguimiento_activo', label: 'Seguimiento' },
  ]

  const handleGroupClick = (group: SupplyGroup) => {
    if (group.supplies.length === 1) {
      router.push(`/supplies/${group.supplies[0].id}`)
    } else {
      setOpenGroup(group)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-dvh lg:h-auto">
      {/* Desktop header */}
      <div className="hidden lg:block">
        <Header
          title="Suministros"
          subtitle={`${supplies.length} suministros registrados`}
          actions={
            <Button onClick={() => setShowNewModal(true)}>
              <Plus className="w-4 h-4" /> Importar Facturas
            </Button>
          }
        />
      </div>

      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center justify-between px-4 pt-safe-top pb-2 bg-bg sticky top-0 z-20"
        style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + 12px)` }}>
        <div>
          <h1 className="text-xl font-bold text-ink">Suministros</h1>
          {!loading && (
            <p className="text-xs text-ink-3 mt-0.5">{supplies.length} registrados</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Search button (alternative to pull) */}
          <button
            onClick={searchOpen ? closeSearch : openSearch}
            className="w-9 h-9 rounded-xl bg-bg-2 flex items-center justify-center active:scale-90 transition-all"
          >
            {searchOpen ? <X className="w-4 h-4 text-ink-3" /> : <Search className="w-4 h-4 text-ink-3" />}
          </button>
          {/* Import (camera + file) */}
          <button
            onClick={() => setShowNewModal(true)}
            className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center active:scale-90 transition-all"
          >
            <Plus className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-y-contain lg:overflow-visible">

        {/* ── Pull-to-reveal indicator (mobile) ── */}
        <div className="lg:hidden overflow-hidden" style={{ height: pullY * 0.55 }}>
          <div className="flex items-end justify-center pb-1.5 gap-1.5 text-ink-3 h-full">
            <Search className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-[11px] font-medium">
              {pullY >= PULL_THRESHOLD - 4 ? 'Suelta para buscar' : 'Desliza para buscar'}
            </span>
          </div>
        </div>

        {/* ── Search bar (mobile) ── */}
        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="lg:hidden overflow-hidden sticky top-[60px] z-10 bg-bg border-b border-line"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="search"
                  inputMode="search"
                  autoComplete="off"
                  placeholder="Buscar cliente o CUPS…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-[16px] text-ink placeholder-ink-3 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-ink-3 active:scale-90 transition-all">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Desktop: filters + sort ── */}
        <div className="hidden lg:block px-8 pb-4 pt-2 space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {statusFilters.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cn('px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all',
                  filter === f.key ? 'bg-brand text-white' : 'bg-bg-2 text-ink-3 hover:text-ink')}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {[{ key: 'recent', label: 'Más recientes' }, { key: 'consumption_desc', label: 'Consumo ↓' }, { key: 'consumption_asc', label: 'Consumo ↑' }].map(({ key, label }) => (
              <button key={key} onClick={() => setSortBy(key as any)}
                className={cn('px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all',
                  sortBy === key ? 'bg-brand text-white' : 'bg-bg-2 text-ink-3 hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Mobile: horizontal status chips ── */}
        <div className="lg:hidden flex gap-2 overflow-x-auto px-4 py-2.5 no-scrollbar">
          {statusFilters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all active:scale-95',
                filter === f.key ? 'bg-brand text-white' : 'bg-bg-2 text-ink-3')}>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-20 gap-3 text-ink-3">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-sm">Cargando…</span>
          </div>
        )}

        {/* ── Empty ── */}
        {!loading && supplies.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-ink-3 px-8 text-center">
            <Zap className="w-10 h-10 opacity-20" />
            <p className="text-sm">No hay suministros todavía</p>
            <button onClick={() => setShowNewModal(true)}
              className="mt-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold active:scale-95 transition-all">
              Importar facturas
            </button>
          </div>
        )}

        {/* ── No search results ── */}
        {!loading && supplies.length > 0 && groups.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-2 text-ink-3">
            <Search className="w-8 h-8 opacity-20" />
            <p className="text-sm">Sin resultados para "{searchQuery}"</p>
          </div>
        )}

        {/* ── Mobile: card list ── */}
        {!loading && groups.length > 0 && (
          <>
            <div className="lg:hidden bg-card border-y border-line/50 mb-20">
              {groups.map(group => (
                <MobileGroupRow
                  key={group.clientId}
                  group={group}
                  consumptionMap={consumptionMap}
                  onClick={() => handleGroupClick(group)}
                />
              ))}
            </div>

            {/* ── Desktop: table ── */}
            <div className="hidden lg:block px-8 pb-8">
              <div className="bg-card rounded-xl border border-line overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line bg-bg-2">
                        {['CUPS', 'Cliente', 'Tarifa', 'Tipo', 'Consumo anual', 'Estado'].map(h => (
                          <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group, gi) => {
                        const isMulti = group.supplies.length > 1
                        const isLastGroup = gi === groups.length - 1

                        if (!isMulti) {
                          const item = group.supplies[0]
                          return (
                            <tr key={item.id}
                              onClick={() => router.push(`/supplies/${item.id}`)}
                              className={cn('group hover:bg-brand/5 cursor-pointer transition-colors',
                                !isLastGroup && 'border-b border-line')}>
                              <td className="px-5 py-3.5">
                                <span className="font-mono text-[11px] text-ink-3 group-hover:text-ink transition-colors">
                                  {item.cups ? item.cups.substring(0, 20) + (item.cups.length > 20 ? '…' : '') : '—'}
                                </span>
                              </td>
                              <td className="px-5 py-3.5">
                                <p className="text-sm font-medium text-ink truncate max-w-[180px]">{group.clientName}</p>
                                {group.clientCif && <p className="text-xs text-ink-3">{group.clientCif}</p>}
                              </td>
                              <td className="px-5 py-3.5">
                                <Badge variant={item.type === 'gas' ? 'warning' : 'info'}>{formatTariff(item.tariff)}</Badge>
                              </td>
                              <td className="px-5 py-3.5">
                                <span className="text-xs text-ink-3">{item.type === 'gas' ? 'Gas' : 'Luz'}</span>
                              </td>
                              <td className="px-5 py-3.5">
                                <span className="text-xs text-ink">{fmtKwh(consumptionMap[item.id])}</span>
                              </td>
                              <td className="px-5 py-3.5">
                                <StatusBadge status={item.status ?? ''} />
                              </td>
                            </tr>
                          )
                        }

                        // Multi-supply group row
                        return (
                          <tr key={group.clientId}
                            onClick={() => setOpenGroup(group)}
                            className={cn('group hover:bg-brand/5 cursor-pointer transition-colors',
                              !isLastGroup && 'border-b border-line')}>
                            <td className="px-5 py-3.5" colSpan={2}>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-ink">{group.clientName}</span>
                                <span className="text-[10px] font-semibold text-brand bg-brand/10 px-1.5 py-0.5 rounded-full">
                                  {group.supplies.length}
                                </span>
                              </div>
                              {group.clientCif && <p className="text-xs text-ink-3">{group.clientCif}</p>}
                            </td>
                            <td className="px-5 py-3.5 text-xs text-ink-3" colSpan={2}>
                              {group.supplies.map(s => formatTariff(s.tariff)).filter(t => t !== '-').join(' · ')}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="text-xs text-ink">{fmtKwh(group.totalKwh)}</span>
                            </td>
                            <td className="px-5 py-3.5">
                              <ChevronRight className="w-4 h-4 text-ink-3 group-hover:text-brand transition-colors" />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
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
        onSuccess={fetchSupplies}
      />
    </div>
  )
}
