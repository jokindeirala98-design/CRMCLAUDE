'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, Building2, User, Landmark, ChevronRight,
  Zap, Flame, Phone as PhoneIcon, X, Filter, Check, Pencil,
  ArrowRight, Users, LayoutGrid, List, SlidersHorizontal, Trash2
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { getUserInitials } from '@/lib/utils/format'
import { normalizeTariff } from '@/lib/consumption-utils'
import type { Client, SupplyStatus } from '@/types/database'

// Lazy-load: el modal solo se descarga al abrirse (siempre renderizado pero
// con prop `open` condicional; aún así, dynamic difiere el chunk).
const NewTaskModal = dynamic(
  () => import('@/components/modals/NewTaskModal').then(m => m.NewTaskModal),
  { ssr: false }
)

// ── Status groups for filtering ──
const STATUS_GROUPS: { label: string; statuses: SupplyStatus[] }[] = [
  { label: 'Inicio',     statuses: ['primer_contacto'] },
  { label: 'Informes',   statuses: ['estudio_en_curso', 'estudio_completado'] },
  { label: 'Presentado', statuses: ['presentado'] },
  { label: 'Firma',      statuses: ['pendiente_firma', 'firmado'] },
  { label: 'Activo',     statuses: ['suscrito', 'seguimiento_activo'] },
  { label: 'Rechazado',  statuses: ['rechazado'] },
]

const typeIcons: Record<string, React.ElementType> = {
  empresa:      Building2,
  particular:   User,
  ayuntamiento: Landmark,
}

const supplyTypeIcons: Record<string, React.ElementType> = {
  luz:      Zap,
  gas:      Flame,
  telefonia: PhoneIcon,
}

function getClientMaxStatus(supplies: any[]): SupplyStatus | null {
  if (!supplies?.length) return null
  const ORDER: SupplyStatus[] = [
    'primer_contacto', 'facturas_recibidas', 'estudio_en_curso', // facturas_recibidas kept for legacy DB records
    'estudio_completado', 'presentado', 'pendiente_firma',
    'firmado', 'suscrito', 'seguimiento_activo',
  ]
  let maxIdx = -1
  for (const s of supplies) {
    const idx = ORDER.indexOf(s.status)
    if (idx > maxIdx) maxIdx = idx
  }
  return maxIdx >= 0 ? ORDER[maxIdx] : supplies[0]?.status || null
}

function clientMatchesStatus(client: any, statusFilter: string): boolean {
  if (!statusFilter) return true
  if (statusFilter === 'rechazado') {
    return client.supplies?.some((s: any) => s.status === 'rechazado') || false
  }
  const group = STATUS_GROUPS.find(g => g.label === statusFilter)
  if (!group) return true
  return client.supplies?.some((s: any) => group.statuses.includes(s.status)) || false
}

// Status → top accent bar color
function statusAccentBar(status: SupplyStatus | null): string {
  if (!status) return 'bg-line'
  if (['firmado','suscrito','seguimiento_activo'].includes(status)) return 'bg-ok'
  if (['estudio_en_curso','pendiente_firma'].includes(status))       return 'bg-warn'
  if (status === 'rechazado')                                        return 'bg-err'
  if (['presentado','estudio_completado'].includes(status))          return 'bg-brand'
  return 'bg-line-2'
}

// Status → gradient accent for supply card
function supplyAccentGradient(status: string): string {
  if (['firmado','suscrito','seguimiento_activo'].includes(status)) return 'from-ok/20 to-ok/0'
  if (['estudio_en_curso','pendiente_firma'].includes(status))       return 'from-warn/20 to-warn/0'
  if (status === 'rechazado')                                        return 'from-err/20 to-err/0'
  if (['presentado','estudio_completado'].includes(status))          return 'from-brand/20 to-brand/0'
  return 'from-line to-line/0'
}

export default function ClientsPage() {
  const [clients, setClients]               = useState<any[]>([])
  const [commercials, setCommercials]       = useState<any[]>([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [statusFilter, setStatusFilter]     = useState('')
  const [commercialFilter, setCommercialFilter] = useState('')
  const [typeFilter, setTypeFilter]         = useState('')
  const [sortOrder, setSortOrder]           = useState<'desc' | 'asc'>('desc')
  const [viewMode, setViewMode]             = useState<'grid' | 'list'>('grid')
  const [showFilters, setShowFilters]       = useState(false)
  const [selectedClient, setSelectedClient] = useState<any>(null)
  const [editingSupplyName, setEditingSupplyName] = useState<string | null>(null)
  const [supplyNameValue, setSupplyNameValue]     = useState('')
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(false)
  const [deletingClient, setDeletingClient] = useState(false)
  const [quickTaskFor, setQuickTaskFor]     = useState<{ clientId: string; clientName: string; status: string } | null>(null)
  const [confirmDeleteSupplyId, setConfirmDeleteSupplyId] = useState<string | null>(null)
  const [deletingSupply, setDeletingSupply] = useState(false)
  const [modalTariffFilter, setModalTariffFilter] = useState('')
  const [modalTypeFilter, setModalTypeFilter] = useState('')   // 'luz' | 'gas' | ''
  const [modalSearch, setModalSearch] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const modalSearchRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // ── URL-synced modal helpers ──────────────────────────────────────────────
  // openClient: opens the modal AND inserts an entry into browser history
  // so ← from any child page returns here with the modal re-opened.
  const openClient = useCallback((client: any) => {
    setSelectedClient(client)
    window.history.pushState({ clientId: client.id }, '', `/clients?c=${client.id}`)
  }, [])

  // closeModal: closes via X button — replaces the ?c= URL so it isn't re-opened on ←
  const closeModal = useCallback(() => {
    setSelectedClient(null)
    setEditingSupplyName(null)
    setModalTariffFilter('')
    setModalTypeFilter('')
    setModalSearch('')
    window.history.replaceState(null, '', '/clients')
  }, [])

  // Restore modal from URL on first data load (e.g. after browser ← returns to /clients?c=ID)
  useEffect(() => {
    if (loading || !clients.length) return
    const params = new URLSearchParams(window.location.search)
    const clientId = params.get('c')
    if (clientId && !selectedClient) {
      const client = clients.find((c: any) => c.id === clientId)
      if (client) setSelectedClient(client)
    }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen to popstate so browser back/forward restores or closes the modal
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search)
      const clientId = params.get('c')
      if (clientId) {
        const client = clients.find((c: any) => c.id === clientId)
        setSelectedClient(client || null)
      } else {
        setSelectedClient(null)
        setModalTariffFilter('')
        setModalTypeFilter('')
        setModalSearch('')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [clients])
  // ─────────────────────────────────────────────────────────────────────────

  // Auto-focus search when modal opens for clients with many supplies
  // Also handle Escape to close modal
  useEffect(() => {
    if (!selectedClient) return
    const supplyCount = selectedClient.supplies?.length || 0
    if (supplyCount > 10) {
      // Slight delay so the modal renders first
      const t = setTimeout(() => modalSearchRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [selectedClient?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedClient) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedClient, closeModal])

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()

      // Determine visibility: admins or users with billing permission see all clients;
      // commercial users without billing only see their own.
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const { data: profile } = authUser
        ? await supabase.from('users_profile').select('id, role, permissions').eq('id', authUser.id).single()
        : { data: null }

      const isFullAccess = profile?.role === 'admin' || profile?.permissions?.billing === true

      // SLIM: el listado de clientes NO usa consumption_data, power_data,
      // power_study_result ni demás JSON pesados de supplies. Sólo necesita
      // los campos visibles en las cards/tabla y en el modal de detalle:
      // id, name, cups, tariff, type, status, address (+ timestamps para
      // edición). Quitar los JSONB ahorra MB de payload por carga.
      let clientQuery = supabase
        .from('clients')
        .select(`
          *,
          commercial:users_profile!commercial_id(id, full_name, nickname, email),
          supplies(id, name, cups, tariff, type, status, address, created_at, updated_at)
        `)
        .order('created_at', { ascending: false })

      if (!isFullAccess && authUser) {
        // Commercial without billing → only own clients
        clientQuery = clientQuery.eq('commercial_id', authUser.id)
      }

      const [{ data: clientData }, { data: commercialData }] = await Promise.all([
        clientQuery,
        supabase
          .from('users_profile')
          .select('id, full_name, nickname, email, role')
          .eq('active', true)
          .in('role', ['commercial', 'admin']),
      ])
      setClients(clientData || [])
      setCommercials(commercialData || [])
      setLoading(false)
    }
    fetchData()
  }, [])

  const filtered = useMemo(() => {
    const result = clients.filter(c => {
      if (search) {
        const q = search.toLowerCase()
        const nameMatch  = c.name?.toLowerCase().includes(q)
        const aliasMatch = c.alias?.toLowerCase().includes(q)
        const cifMatch   = (c.cif || c.nif || c.cif_nif || '').toLowerCase().includes(q)
        const emailMatch = (c.email || '').toLowerCase().includes(q)
        const cupsMatch  = c.supplies?.some((s: any) =>
          (s.cups || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
        )
        if (!nameMatch && !aliasMatch && !cifMatch && !emailMatch && !cupsMatch) return false
      }
      if (statusFilter && !clientMatchesStatus(c, statusFilter)) return false
      if (commercialFilter && c.commercial_id !== commercialFilter) return false
      if (typeFilter && c.type !== typeFilter) return false
      return true
    })
    if (sortOrder === 'asc') {
      result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    // desc: DB already returns created_at DESC, no re-sort needed
    return result
  }, [clients, search, statusFilter, commercialFilter, typeFilter, sortOrder])

  const activeFilterCount = [statusFilter, commercialFilter, typeFilter, sortOrder !== 'desc' ? 'sort' : ''].filter(Boolean).length

  const handleSaveSupplyName = async (supplyId: string) => {
    const supabase = createClient()
    await supabase.from('supplies').update({ name: supplyNameValue.trim() || null }).eq('id', supplyId)
    setClients(prev => prev.map(c => ({
      ...c,
      supplies: c.supplies?.map((s: any) =>
        s.id === supplyId ? { ...s, name: supplyNameValue.trim() || null } : s
      ),
    })))
    if (selectedClient) {
      setSelectedClient((prev: any) => ({
        ...prev,
        supplies: prev.supplies?.map((s: any) =>
          s.id === supplyId ? { ...s, name: supplyNameValue.trim() || null } : s
        ),
      }))
    }
    setEditingSupplyName(null)
  }

  const handleDeleteClient = async () => {
    if (!selectedClient?.id) return
    setDeletingClient(true)
    try {
      const supabase = createClient()
      await supabase.from('clients').delete().eq('id', selectedClient.id)
      setClients(prev => prev.filter(c => c.id !== selectedClient.id))
      closeModal()
      setConfirmDeleteClient(false)
    } catch (error) {
      console.error('Error deleting client:', error)
    } finally {
      setDeletingClient(false)
    }
  }

  const handleDeleteSupply = async (supplyId: string) => {
    setDeletingSupply(true)
    try {
      const supabase = createClient()
      await supabase.from('supplies').delete().eq('id', supplyId)
      setClients(prev => prev.map(c => ({
        ...c,
        supplies: c.supplies?.filter((s: any) => s.id !== supplyId),
      })))
      if (selectedClient) {
        setSelectedClient((prev: any) => ({
          ...prev,
          supplies: prev.supplies?.filter((s: any) => s.id !== supplyId),
        }))
      }
      setConfirmDeleteSupplyId(null)
    } catch (error) {
      console.error('Error deleting supply:', error)
    } finally {
      setDeletingSupply(false)
    }
  }

  const stats = useMemo(() => {
    const total        = clients.length
    const withSupplies = clients.filter(c => c.supplies?.length > 0).length
    const signed       = clients.filter(c => c.supplies?.some((s: any) =>
      ['firmado','suscrito','seguimiento_activo'].includes(s.status)
    )).length
    const totalSupplies = clients.reduce((sum, c) => sum + (c.supplies?.length || 0), 0)
    return { total, withSupplies, signed, totalSupplies }
  }, [clients])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-7 h-7 border-2 border-brand border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="relative">
      <Header
        title="Clientes"
        subtitle={`${clients.length} clientes registrados`}
        actions={
          <Button onClick={() => router.push('/clients/new')}>
            <Plus className="w-4 h-4" />
            Nuevo cliente
          </Button>
        }
      />

      <div className="px-4 lg:px-6 pb-24 lg:pb-8 space-y-4 pt-4">

        {/* ── Stat pills ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total clientes',   value: stats.total,        color: 'text-brand' },
            { label: 'Con suministros',  value: stats.withSupplies, color: 'text-brand' },
            { label: 'Firmados',         value: stats.signed,       color: 'text-ok' },
            { label: 'Suministros',      value: stats.totalSupplies, color: 'text-warn' },
          ].map(s => (
            <div key={s.label} className="bg-card rounded-xl border border-line px-4 py-3">
              <p className="text-xs text-ink-3 font-medium">{s.label}</p>
              <p className={`font-sans font-bold text-2xl tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Filters bar ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
              showFilters || activeFilterCount > 0
                ? 'bg-brand/10 text-brand'
                : 'bg-bg-2 text-ink-3 hover:text-ink border border-line'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="w-4.5 h-4.5 rounded-full bg-brand text-bg text-[10px] flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>

          <div className="flex bg-bg-2 border border-line rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-brand/10 text-brand' : 'text-ink-3 hover:text-ink'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-brand/10 text-brand' : 'text-ink-3 hover:text-ink'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Filter chips ── */}
        {showFilters && (
          <div className="flex flex-wrap items-start gap-4 p-4 bg-card border border-line rounded-xl animate-in fade-in slide-in-from-top-2 duration-150">
            {/* Status */}
            <div className="space-y-1.5">
              <p className="label-mono text-ink-4">Estado</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_GROUPS.map(g => (
                  <button
                    key={g.label}
                    onClick={() => setStatusFilter(statusFilter === g.label ? '' : g.label)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      statusFilter === g.label
                        ? 'bg-ink text-bg'
                        : 'bg-bg-2 text-ink-3 hover:text-ink border border-line'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Commercial */}
            <div className="space-y-1.5">
              <p className="label-mono text-ink-4">Comercial</p>
              <select
                value={commercialFilter}
                onChange={e => setCommercialFilter(e.target.value)}
                className="px-3 py-1.5 bg-bg-2 border border-line rounded-lg text-xs text-ink outline-none"
              >
                <option value="">Todos</option>
                {commercials.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                ))}
              </select>
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <p className="label-mono text-ink-4">Tipo</p>
              <div className="flex gap-1.5">
                {['empresa', 'particular', 'ayuntamiento'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all capitalize ${
                      typeFilter === t
                        ? 'bg-ink text-bg'
                        : 'bg-bg-2 text-ink-3 hover:text-ink border border-line'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort order */}
            <div className="space-y-1.5">
              <p className="label-mono text-ink-4">Orden</p>
              <div className="flex gap-1.5">
                {([['desc', 'Más recientes'], ['asc', 'Más antiguos']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setSortOrder(val)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      sortOrder === val
                        ? 'bg-ink text-bg'
                        : 'bg-bg-2 text-ink-3 hover:text-ink border border-line'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {activeFilterCount > 0 && (
              <button
                onClick={() => { setStatusFilter(''); setCommercialFilter(''); setTypeFilter(''); setSortOrder('desc') }}
                className="px-2.5 py-1 rounded-md text-xs font-medium text-err bg-err-container hover:brightness-95 transition-colors ml-auto self-end"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        {/* ── Results count ── */}
        {(search || activeFilterCount > 0) && (
          <p className="text-xs text-ink-3">
            {filtered.length} de {clients.length} clientes
          </p>
        )}

        {/* ── Empty state ── */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-ink-4 mx-auto mb-3" />
            <p className="text-sm font-medium text-ink-3">
              {search || activeFilterCount > 0 ? 'No se encontraron clientes con esos filtros' : 'Aún no hay clientes'}
            </p>
            <p className="text-xs text-ink-4 mt-1">
              {search || activeFilterCount > 0 ? 'Prueba con otros criterios.' : 'Crea el primero para empezar a operar.'}
            </p>
          </div>

        ) : viewMode === 'grid' ? (
          /* ── Grid view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(client => {
              const Icon = typeIcons[client.type] || Building2
              const supplyCount = client.supplies?.length || 0
              const maxStatus = getClientMaxStatus(client.supplies)
              return (
                <div
                  key={client.id}
                  onClick={() => openClient(client)}
                  className="bg-card rounded-xl border border-line hover:border-line-2 hover:shadow-ambient-sm transition-all duration-150 cursor-pointer group overflow-hidden"
                >
                  {/* Status accent line */}
                  <div className={`h-0.5 w-full ${statusAccentBar(maxStatus)}`} />

                  <div className="p-4">
                    {/* Client header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-9 h-9 rounded-lg bg-brand/8 flex items-center justify-center flex-shrink-0 group-hover:bg-brand/15 transition-colors">
                        <Icon className="w-4 h-4 text-brand" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={`text-sm font-semibold truncate ${client.is_fallen ? 'text-err' : 'text-ink'}`}>
                          {client.alias || client.name}
                          {client.is_fallen && <span className="ml-1.5 text-[10px] font-bold bg-err/10 text-err px-1.5 py-0.5 rounded">CAÍDO</span>}
                        </h3>
                        <p className="text-xs text-ink-3 truncate">
                          {client.alias ? client.name : (client.cif || client.nif || client.cif_nif || 'Sin CIF/NIF')}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink-4 group-hover:text-brand flex-shrink-0 transition-colors" />
                    </div>

                    {/* Supply pills */}
                    {supplyCount > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {client.supplies.slice(0, 3).map((s: any) => {
                          const SIcon = supplyTypeIcons[s.type] || Zap
                          return (
                            <div
                              key={s.id}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-bg-2 border border-line text-[10px]"
                            >
                              <SIcon className="w-3 h-3 text-ink-3" />
                              <span className="text-ink font-medium truncate max-w-[90px]">
                                {s.name || s.cups || 'Sin CUPS'}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setQuickTaskFor({ clientId: client.id, clientName: client.name, status: s.status })
                                }}
                                title="Crear tarea"
                              >
                                <StatusBadge status={s.status} />
                              </button>
                            </div>
                          )
                        })}
                        {supplyCount > 3 && (
                          <span className="px-2 py-0.5 rounded-md bg-bg-2 border border-line text-[10px] text-ink-3 font-medium">
                            +{supplyCount - 3} más
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-4 italic mb-3">Sin suministros</p>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-line">
                      <div
                        className="inline-flex items-center justify-center min-w-[32px] h-[22px] px-2 rounded-md bg-[#1F3A2E] text-volt text-[10px] font-bold tracking-wider flex-shrink-0"
                        title={client.commercial?.full_name || client.commercial?.email || 'Sin comercial asignado'}
                      >
                        {client.commercial?.nickname || getUserInitials(client.commercial?.full_name || client.commercial?.email) || '?'}
                      </div>
                      <Badge variant={supplyCount > 0 ? 'info' : 'default'} hideDot>
                        {supplyCount} sum.
                      </Badge>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

        ) : (
          /* ── List view ── */
          <div className="space-y-1">
            {filtered.map(client => {
              const Icon = typeIcons[client.type] || Building2
              const supplyCount = client.supplies?.length || 0
              return (
                <div
                  key={client.id}
                  onClick={() => openClient(client)}
                  className="flex items-center gap-3 px-4 py-3 bg-card border border-line rounded-xl hover:border-line-2 transition-all cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-brand/8 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-brand" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${client.is_fallen ? 'text-err' : 'text-ink'}`}>
                      {client.alias || client.name}
                      {client.is_fallen && <span className="ml-1.5 text-[10px] font-bold bg-err/10 text-err px-1.5 py-0.5 rounded">CAÍDO</span>}
                    </p>
                    <p className="text-xs text-ink-3 truncate">
                      {client.alias ? client.name : (client.cif || client.nif || client.cif_nif || 'Sin CIF/NIF')}
                      {!client.alias && client.email && ` · ${client.email}`}
                    </p>
                  </div>
                  <div className="hidden lg:flex items-center gap-1.5">
                    {client.supplies?.slice(0, 2).map((s: any) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setQuickTaskFor({ clientId: client.id, clientName: client.name, status: s.status })
                        }}
                        title="Crear tarea"
                      >
                        <StatusBadge status={s.status} />
                      </button>
                    ))}
                  </div>
                  <Badge variant="info" hideDot>{supplyCount} sum.</Badge>
                  <span
                    className="hidden sm:inline-flex items-center justify-center min-w-[32px] h-[22px] px-2 rounded-md bg-[#1F3A2E] text-volt text-[10px] font-bold tracking-wider"
                    title={client.commercial?.full_name || client.commercial?.email || 'Sin comercial'}
                  >
                    {client.commercial?.nickname || getUserInitials(client.commercial?.full_name || client.commercial?.email) || '?'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-4 group-hover:text-brand" />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Client Modal ── */}
      {selectedClient && (
        <>
          <div
            className="fixed inset-0 bg-ink/50 z-[100] backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <div
              className="max-w-2xl w-full max-h-[85vh] bg-bg rounded-xl border border-line shadow-ambient-lg overflow-y-auto pointer-events-auto animate-in fade-in zoom-in-95 duration-150"
            >
              {/* Modal header */}
              <div className="sticky top-0 bg-bg/95 backdrop-blur-sm z-10 px-5 py-4 border-b border-line">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    {(() => { const Icon = typeIcons[selectedClient.type] || Building2; return (
                      <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4.5 h-4.5 text-brand" />
                      </div>
                    )})()}
                    <div className="min-w-0">
                      <h2 className="font-sans font-semibold text-base text-ink">{selectedClient.alias || selectedClient.name}</h2>
                      <p className="text-xs text-ink-3 truncate">
                        {selectedClient.alias ? selectedClient.name : (selectedClient.cif || selectedClient.nif || selectedClient.cif_nif || 'Sin CIF/NIF')}
                        {!selectedClient.alias && selectedClient.email && ` · ${selectedClient.email}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setConfirmDeleteClient(true)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-4 hover:text-err transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {(modalTariffFilter || modalTypeFilter || modalSearch) && (
                      <span className="text-[10px] text-brand font-medium">
                        Filtrado
                      </span>
                    )}
                    <button
                      onClick={closeModal}
                      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-bg-2 transition-colors"
                    >
                      <X className="w-4 h-4 text-ink-3" />
                    </button>
                  </div>
                </div>

                {/* Quick actions */}
                {!confirmDeleteClient ? (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="secondary" onClick={() => { closeModal(); router.push(`/clients/${selectedClient.id}`) }}>
                      Ver ficha completa
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { closeModal(); router.push(`/clients/${selectedClient.id}/edit`) }}>
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 bg-err-container border border-err/20 rounded-lg p-4">
                    <p className="text-sm text-ink font-medium mb-3">
                      ¿Eliminar cliente {selectedClient.name}? Se eliminarán también todos sus suministros asociados.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDeleteClient(false)}
                        className="flex-1 px-3 py-2 rounded-lg bg-bg-2 border border-line hover:bg-line text-ink text-sm font-medium transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleDeleteClient}
                        disabled={deletingClient}
                        className="flex-1 px-3 py-2 rounded-lg bg-err hover:opacity-90 text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingClient ? 'Eliminando...' : 'Eliminar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Contact info */}
              <div className="px-5 py-4 border-b border-line">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {selectedClient.phone && (
                    <div>
                      <p className="text-ink-3 mb-0.5">Teléfono</p>
                      <p className="text-ink font-medium">{selectedClient.phone}</p>
                    </div>
                  )}
                  {selectedClient.email && (
                    <div>
                      <p className="text-ink-3 mb-0.5">Email</p>
                      <p className="text-ink font-medium truncate">{selectedClient.email}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-ink-3 mb-0.5">Comercial</p>
                    <p className="text-ink font-medium">
                      {selectedClient.commercial?.full_name || selectedClient.commercial?.email || 'Sin asignar'}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-3 mb-0.5">Tipo</p>
                    <p className="text-ink font-medium capitalize">{selectedClient.type}</p>
                  </div>
                </div>
              </div>

              {/* Supplies */}
              <div className="px-5 py-4">
                {/* Header + filters — only when >10 supplies */}
                {(selectedClient.supplies?.length || 0) > 10 ? (() => {
                  // Derive unique tariff groups from the supplies
                  const tariffGroups = Array.from(
                    new Set(
                      (selectedClient.supplies || [])
                        .map((s: any) => {
                          const raw = (s.tariff || '').trim()
                          const t = normalizeTariff(raw) || raw
                          if (!t) return null
                          if (t.startsWith('6.4')) return '6.4TD'
                          if (t.startsWith('6.3')) return '6.3TD'
                          if (t.startsWith('6.2')) return '6.2TD'
                          if (t.startsWith('6.1')) return '6.1TD'
                          if (t.startsWith('6')) return '6.xTD'
                          if (t.startsWith('3.0') || t.startsWith('30')) return '3.0TD'
                          if (t.startsWith('2.0') || t.startsWith('20')) return '2.0TD'
                          return t
                        })
                        .filter(Boolean)
                    )
                  ) as string[]
                  const hasGas = (selectedClient.supplies || []).some((s: any) => s.type === 'gas')
                  const hasLuz = (selectedClient.supplies || []).some((s: any) => s.type === 'luz')

                  return (
                    <div className="mb-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="label-mono text-ink-4">
                          Suministros ({selectedClient.supplies?.length || 0})
                        </h3>
                        {(modalTariffFilter || modalTypeFilter || modalSearch) && (
                          <button
                            onClick={() => { setModalTariffFilter(''); setModalTypeFilter(''); setModalSearch('') }}
                            className="text-[10px] text-ink-3 hover:text-err transition-colors"
                          >
                            Limpiar filtros
                          </button>
                        )}
                      </div>

                      {/* Search bar */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
                        <input
                          ref={modalSearchRef}
                          type="text"
                          value={modalSearch}
                          onChange={e => setModalSearch(e.target.value)}
                          placeholder="Buscar CUPS o nombre..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-2 border border-line rounded-lg outline-none focus:border-brand/50 transition-colors font-mono placeholder:font-sans placeholder:text-ink-4"
                        />
                        {modalSearch && (
                          <button
                            onClick={() => setModalSearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {/* Type + tariff filter pills */}
                      <div className="flex flex-wrap gap-1.5">
                        {hasLuz && hasGas && (
                          <>
                            <button
                              onClick={() => setModalTypeFilter(modalTypeFilter === 'luz' ? '' : 'luz')}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                                modalTypeFilter === 'luz'
                                  ? 'bg-amber-100 border-amber-300 text-amber-700'
                                  : 'bg-bg-2 border-line text-ink-3 hover:border-line-2'
                              }`}
                            >
                              <Zap className="w-2.5 h-2.5" /> Luz
                            </button>
                            <button
                              onClick={() => setModalTypeFilter(modalTypeFilter === 'gas' ? '' : 'gas')}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                                modalTypeFilter === 'gas'
                                  ? 'bg-orange-100 border-orange-300 text-orange-700'
                                  : 'bg-bg-2 border-line text-ink-3 hover:border-line-2'
                              }`}
                            >
                              <Flame className="w-2.5 h-2.5" /> Gas
                            </button>
                            <div className="w-px h-4 bg-line self-center" />
                          </>
                        )}
                        {tariffGroups.map(tg => {
                          // Normalize for comparison: "2.0TD" → "20"
                          const tgNorm = tg.replace(/\./g, '').replace('TD','').toUpperCase()
                          const filterNorm = modalTariffFilter.replace(/\./g, '').replace('TD','').toUpperCase()
                          const active = filterNorm !== '' && tgNorm.startsWith(filterNorm)
                          return (
                            <button
                              key={tg}
                              onClick={() => setModalTariffFilter(active ? '' : tg)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border transition-colors ${
                                active
                                  ? 'bg-brand/15 border-brand/30 text-brand'
                                  : 'bg-bg-2 border-line text-ink-3 hover:border-line-2'
                              }`}
                            >
                              {tg}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })() : (
                  <h3 className="label-mono text-ink-4 mb-3">
                    Suministros ({selectedClient.supplies?.length || 0})
                  </h3>
                )}

                {(!selectedClient.supplies || selectedClient.supplies.length === 0) ? (
                  <div className="text-center py-8">
                    <Zap className="w-8 h-8 text-ink-4 mx-auto mb-2" />
                    <p className="text-sm font-medium text-ink-3">Aún no hay suministros</p>
                    <p className="text-xs text-ink-4 mt-0.5">Crea el primero para empezar a operar.</p>
                  </div>
                ) : (() => {
                  // Combined filter logic
                  const modalFiltered = selectedClient.supplies.filter((s: any) => {
                    if (modalTypeFilter && s.type !== modalTypeFilter) return false
                    if (modalTariffFilter) {
                      // Normalize both sides: remove dots and TD suffix for comparison
                      const t = (s.tariff || '').replace(/\./g, '').replace('TD','').toUpperCase()
                      const f = modalTariffFilter.replace(/\./g, '').replace('TD','').toUpperCase()
                      if (!t.startsWith(f)) return false
                    }
                    if (modalSearch) {
                      const q = modalSearch.toLowerCase()
                      if (
                        !s.cups?.toLowerCase().includes(q) &&
                        !s.name?.toLowerCase().includes(q) &&
                        !s.tariff?.toLowerCase().includes(q)
                      ) return false
                    }
                    return true
                  })

                  return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {modalFiltered.length === 0 ? (
                      <div className="col-span-2 text-center py-6">
                        <p className="text-xs text-ink-3">Ningún suministro coincide con los filtros.</p>
                        <button onClick={() => { setModalTariffFilter(''); setModalTypeFilter(''); setModalSearch('') }} className="mt-2 text-xs text-brand hover:underline">
                          Limpiar filtros
                        </button>
                      </div>
                    ) : modalFiltered.map((supply: any) => {
                      const SIcon = supplyTypeIcons[supply.type] || Zap
                      const isEditing = editingSupplyName === supply.id

                      return (
                        <div
                          key={supply.id}
                          role="button"
                          tabIndex={confirmDeleteSupplyId === supply.id || isEditing ? -1 : 0}
                          onClick={() => {
                            if (confirmDeleteSupplyId === supply.id || isEditing) return
                            // URL already has ?c=CLIENT_ID — pressing ← will reopen this modal
                            router.push(`/supplies/${supply.id}`)
                          }}
                          onKeyDown={(e) => {
                            if (confirmDeleteSupplyId === supply.id || isEditing) return
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              router.push(`/supplies/${supply.id}`)
                            }
                          }}
                          className="group/card relative bg-card border border-line rounded-xl hover:border-line-2 hover:shadow-ambient-sm transition-all duration-150 cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        >
                          {/* Gradient accent top */}
                          <div className={`absolute inset-x-0 top-0 h-12 bg-gradient-to-b ${supplyAccentGradient(supply.status)} pointer-events-none`} />

                          {/* Delete confirm overlay */}
                          {confirmDeleteSupplyId === supply.id ? (
                            <div className="relative p-3 bg-err-container/50 rounded-xl">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-ink flex-1">¿Eliminar suministro?</span>
                                <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteSupplyId(null) }} className="px-2 py-0.5 rounded-md bg-bg-2 border border-line text-ink-3 text-[10px] font-medium">Cancelar</button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSupply(supply.id) }} disabled={deletingSupply} className="px-2 py-0.5 rounded-md bg-err text-white text-[10px] font-medium disabled:opacity-50">{deletingSupply ? '...' : 'Eliminar'}</button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative p-3.5 flex flex-col gap-2.5">
                              {/* Top */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0 group-hover/card:scale-105 transition-transform">
                                  <SIcon className="w-4 h-4 text-brand" />
                                </div>
                                <div className="flex items-center gap-1">
                                  <StatusBadge status={supply.status} />
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteSupplyId(supply.id) }}
                                    className="p-1 rounded-md text-ink-4 hover:text-err hover:bg-err-container transition-colors opacity-0 group-hover/card:opacity-100"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {/* Title + CUPS */}
                              <div className="min-w-0">
                                {isEditing ? (
                                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <input
                                      ref={nameInputRef}
                                      type="text"
                                      value={supplyNameValue}
                                      onChange={e => setSupplyNameValue(e.target.value)}
                                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleSaveSupplyName(supply.id); if (e.key === 'Escape') setEditingSupplyName(null) }}
                                      placeholder="Nombre..."
                                      className="flex-1 min-w-0 px-2 py-0.5 text-xs bg-bg-2 border border-line rounded-lg outline-none focus:border-ink"
                                      autoFocus
                                    />
                                    <button onClick={(e) => { e.stopPropagation(); handleSaveSupplyName(supply.id) }} className="p-0.5 text-ok"><Check className="w-3.5 h-3.5" /></button>
                                    <button onClick={(e) => { e.stopPropagation(); setEditingSupplyName(null) }} className="p-0.5 text-err"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <h4 className="text-xs font-semibold text-ink truncate">{supply.name || supply.cups || 'Sin CUPS'}</h4>
                                    <button
                                      onClick={e => { e.preventDefault(); e.stopPropagation(); setEditingSupplyName(supply.id); setSupplyNameValue(supply.name || '') }}
                                      className="p-0.5 rounded text-ink-4 hover:text-brand opacity-0 group-hover/card:opacity-100 transition-all"
                                    >
                                      <Pencil className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                )}
                                {supply.name && supply.cups && (
                                  <p className="text-[9px] text-ink-3 font-mono truncate mt-0.5">{supply.cups}</p>
                                )}
                              </div>

                              {/* Stats */}
                              <div className="grid grid-cols-2 gap-1">
                                <div className="rounded-md bg-bg-2 px-2 py-1">
                                  <p className="label-mono text-ink-4 text-[8px]">Tarifa</p>
                                  <p className="text-[11px] text-ink font-semibold truncate">{supply.tariff || '—'}</p>
                                </div>
                                <div className="rounded-md bg-bg-2 px-2 py-1">
                                  <p className="label-mono text-ink-4 text-[8px]">Tipo</p>
                                  <p className="text-[11px] text-ink font-semibold capitalize truncate">{supply.type || '—'}</p>
                                </div>
                              </div>

                              {supply.address && (
                                <p className="text-[9px] text-ink-3 truncate" title={supply.address}>{supply.address}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Quick task modal */}
      <NewTaskModal
        open={!!quickTaskFor}
        onClose={() => setQuickTaskFor(null)}
        onCreated={() => setQuickTaskFor(null)}
        presetClientId={quickTaskFor?.clientId}
        presetTitle={quickTaskFor ? `Seguimiento ${quickTaskFor.clientName}` : ''}
        presetDescription={quickTaskFor ? `Estado actual: ${quickTaskFor.status}` : ''}
      />
    </div>
  )
}
