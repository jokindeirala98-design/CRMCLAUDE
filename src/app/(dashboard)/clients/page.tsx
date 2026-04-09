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
import { createClient } from '@/lib/supabase/client'
import { getUserInitials } from '@/lib/utils/format'
import { NewTaskModal } from '@/components/modals/NewTaskModal'
import type { Client, SupplyStatus } from '@/types/database'

// ── Status groups for filtering ──
const STATUS_GROUPS: { label: string; statuses: SupplyStatus[] }[] = [
  { label: 'Inicio', statuses: ['primer_contacto', 'facturas_recibidas'] },
  { label: 'Informes', statuses: ['estudio_en_curso', 'estudio_completado'] },
  { label: 'Presentado', statuses: ['presentado'] },
  { label: 'Firma', statuses: ['pendiente_firma', 'firmado'] },
  { label: 'Activo', statuses: ['suscrito', 'seguimiento_activo'] },
  { label: 'Rechazado', statuses: ['rechazado'] },
]

const typeIcons: Record<string, React.ElementType> = {
  empresa: Building2,
  particular: User,
  ayuntamiento: Landmark,
}

const supplyTypeIcons: Record<string, React.ElementType> = {
  luz: Zap,
  gas: Flame,
  telefonia: PhoneIcon,
}

// Get the "most advanced" status among all supplies of a client
function getClientMaxStatus(supplies: any[]): SupplyStatus | null {
  if (!supplies?.length) return null
  const ORDER: SupplyStatus[] = [
    'primer_contacto', 'facturas_recibidas', 'estudio_en_curso',
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

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([])
  const [commercials, setCommercials] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [commercialFilter, setCommercialFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedClient, setSelectedClient] = useState<any>(null)
  const [editingSupplyName, setEditingSupplyName] = useState<string | null>(null)
  const [supplyNameValue, setSupplyNameValue] = useState('')
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(false)
  const [deletingClient, setDeletingClient] = useState(false)
  const [quickTaskFor, setQuickTaskFor] = useState<{ clientId: string; clientName: string; status: string } | null>(null)
  const [confirmDeleteSupplyId, setConfirmDeleteSupplyId] = useState<string | null>(null)
  const [deletingSupply, setDeletingSupply] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const [{ data: clientData }, { data: commercialData }] = await Promise.all([
        supabase
          .from('clients')
          .select(`
            *,
            commercial:users_profile!commercial_id(id, full_name, email),
            supplies(*)
          `)
          .order('created_at', { ascending: false }),
        supabase
          .from('users_profile')
          .select('id, full_name, email, role')
          .eq('active', true)
          .in('role', ['commercial', 'admin']),
      ])
      setClients(clientData || [])
      setCommercials(commercialData || [])
      setLoading(false)
    }
    fetchData()
  }, [])

  // ── Filtered clients ──
  const filtered = useMemo(() => {
    return clients.filter(c => {
      // Search: name, CIF, CUPS, email
      if (search) {
        const q = search.toLowerCase()
        const nameMatch = c.name?.toLowerCase().includes(q)
        const cifMatch = (c.cif || c.nif || c.cif_nif || '').toLowerCase().includes(q)
        const emailMatch = (c.email || '').toLowerCase().includes(q)
        const cupsMatch = c.supplies?.some((s: any) =>
          (s.cups || '').toLowerCase().includes(q) ||
          (s.name || '').toLowerCase().includes(q)
        )
        if (!nameMatch && !cifMatch && !emailMatch && !cupsMatch) return false
      }
      // Status filter
      if (statusFilter && !clientMatchesStatus(c, statusFilter)) return false
      // Commercial filter
      if (commercialFilter && c.commercial_id !== commercialFilter) return false
      // Type filter
      if (typeFilter && c.type !== typeFilter) return false
      return true
    })
  }, [clients, search, statusFilter, commercialFilter, typeFilter])

  const activeFilterCount = [statusFilter, commercialFilter, typeFilter].filter(Boolean).length

  // ── Save supply name ──
  const handleSaveSupplyName = async (supplyId: string) => {
    const supabase = createClient()
    await supabase.from('supplies').update({ name: supplyNameValue.trim() || null }).eq('id', supplyId)
    // Update local state
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

  // ── Delete client ──
  const handleDeleteClient = async () => {
    if (!selectedClient?.id) return
    setDeletingClient(true)
    try {
      const supabase = createClient()
      await supabase.from('clients').delete().eq('id', selectedClient.id)
      // Update local state
      setClients(prev => prev.filter(c => c.id !== selectedClient.id))
      setSelectedClient(null)
      setConfirmDeleteClient(false)
    } catch (error) {
      console.error('Error deleting client:', error)
    } finally {
      setDeletingClient(false)
    }
  }

  // ── Delete supply ──
  const handleDeleteSupply = async (supplyId: string) => {
    setDeletingSupply(true)
    try {
      const supabase = createClient()
      await supabase.from('supplies').delete().eq('id', supplyId)
      // Update local state
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

  // ── Stats ──
  const stats = useMemo(() => {
    const total = clients.length
    const withSupplies = clients.filter(c => c.supplies?.length > 0).length
    const signed = clients.filter(c => c.supplies?.some((s: any) => ['firmado', 'suscrito', 'seguimiento_activo'].includes(s.status))).length
    const totalSupplies = clients.reduce((sum, c) => sum + (c.supplies?.length || 0), 0)
    return { total, withSupplies, signed, totalSupplies }
  }, [clients])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-2 border-secondary border-t-transparent rounded-full" />
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
            Nuevo Cliente
          </Button>
        }
      />

      <div className="px-4 lg:px-8 pb-24 lg:pb-8 space-y-5">
        {/* ── Stat pills ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total clientes', value: stats.total, color: 'text-primary' },
            { label: 'Con suministros', value: stats.withSupplies, color: 'text-secondary' },
            { label: 'Firmados', value: stats.signed, color: 'text-success' },
            { label: 'Suministros', value: stats.totalSupplies, color: 'text-warning' },
          ].map(s => (
            <div key={s.label} className="bg-surface-container-lowest rounded-2xl px-4 py-3 shadow-ambient-sm">
              <p className="text-xs text-on-surface-variant font-medium">{s.label}</p>
              <p className={`font-display font-bold text-2xl ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Filters bar ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              showFilters || activeFilterCount > 0
                ? 'bg-primary/10 text-primary'
                : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* View toggle */}
          <div className="flex bg-surface-container-high rounded-xl overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2.5 transition-colors ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2.5 transition-colors ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Filter chips ── */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 p-4 bg-surface-container-lowest rounded-2xl shadow-ambient-sm animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Status */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">Estado</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_GROUPS.map(g => (
                  <button
                    key={g.label}
                    onClick={() => setStatusFilter(statusFilter === g.label ? '' : g.label)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                      statusFilter === g.label
                        ? 'bg-primary text-white'
                        : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Commercial */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">Comercial</p>
              <select
                value={commercialFilter}
                onChange={e => setCommercialFilter(e.target.value)}
                className="px-3 py-1.5 bg-surface-container-high rounded-xl text-xs text-on-surface outline-none"
              >
                <option value="">Todos</option>
                {commercials.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                ))}
              </select>
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">Tipo</p>
              <div className="flex gap-1.5">
                {['empresa', 'particular', 'ayuntamiento'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all capitalize ${
                      typeFilter === t
                        ? 'bg-primary text-white'
                        : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear all */}
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setStatusFilter(''); setCommercialFilter(''); setTypeFilter('') }}
                className="px-3 py-1 rounded-full text-xs font-medium text-error bg-error/10 hover:bg-error/20 transition-colors ml-auto"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        {/* ── Results count ── */}
        {(search || activeFilterCount > 0) && (
          <p className="text-xs text-on-surface-variant">
            {filtered.length} de {clients.length} clientes
          </p>
        )}

        {/* ── Client grid/list ── */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 text-on-surface-variant/30 mx-auto mb-3" />
            <p className="text-sm text-on-surface-variant">
              {search || activeFilterCount > 0 ? 'No se encontraron clientes con esos filtros' : 'No hay clientes todavia. Crea el primero.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          /* ── Grid view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(client => {
              const Icon = typeIcons[client.type] || Building2
              const supplyCount = client.supplies?.length || 0
              const maxStatus = getClientMaxStatus(client.supplies)
              return (
                <div
                  key={client.id}
                  onClick={() => setSelectedClient(client)}
                  className="bg-surface-container-lowest rounded-2xl shadow-ambient-sm hover:shadow-ambient transition-all duration-200 cursor-pointer group overflow-hidden"
                >
                  {/* Top accent line based on status */}
                  <div className={`h-1 w-full ${
                    maxStatus && ['firmado', 'suscrito', 'seguimiento_activo'].includes(maxStatus) ? 'bg-success' :
                    maxStatus && ['estudio_en_curso', 'pendiente_firma'].includes(maxStatus) ? 'bg-warning' :
                    maxStatus === 'rechazado' ? 'bg-error' :
                    maxStatus && ['presentado', 'estudio_completado'].includes(maxStatus) ? 'bg-secondary' :
                    'bg-primary/30'
                  }`} />

                  <div className="p-5">
                    {/* Client header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/15 transition-colors">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                          {client.name}
                        </h3>
                        <p className="text-xs text-on-surface-variant truncate">
                          {client.cif || client.nif || client.cif_nif || 'Sin CIF/NIF'}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-on-surface-variant/30 group-hover:text-primary flex-shrink-0 transition-colors" />
                    </div>

                    {/* Supply pills */}
                    {supplyCount > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {client.supplies.slice(0, 3).map((s: any) => {
                          const SIcon = supplyTypeIcons[s.type] || Zap
                          return (
                            <div
                              key={s.id}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-container-high/60 text-[10px]"
                            >
                              <SIcon className="w-3 h-3 text-on-surface-variant" />
                              <span className="text-on-surface font-medium truncate max-w-[100px]">
                                {s.name || s.cups || 'Sin CUPS'}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setQuickTaskFor({ clientId: client.id, clientName: client.name, status: s.status })
                                }}
                                className="rounded hover:ring-2 hover:ring-primary/40 transition"
                                title="Crear tarea para este cliente"
                              >
                                <StatusBadge status={s.status} />
                              </button>
                            </div>
                          )
                        })}
                        {supplyCount > 3 && (
                          <span className="px-2 py-1 rounded-lg bg-surface-container-high/60 text-[10px] text-on-surface-variant font-medium">
                            +{supplyCount - 3} más
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-on-surface-variant/50 italic mb-3">Sin suministros</p>
                    )}

                    {/* Footer: commercial + contact */}
                    <div className="flex items-center justify-between pt-2 border-t border-outline-variant/10">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-[10px] font-bold">
                            {(client.commercial?.full_name || client.commercial?.email || '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-[10px] text-on-surface-variant font-medium truncate max-w-[100px]">
                          {getUserInitials(client.commercial?.full_name || client.commercial?.email)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-on-surface-variant">
                        <Badge variant={supplyCount > 0 ? 'info' : 'default'}>
                          {supplyCount} sum.
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* ── List view ── */
          <div className="space-y-2">
            {filtered.map(client => {
              const Icon = typeIcons[client.type] || Building2
              const supplyCount = client.supplies?.length || 0
              return (
                <div
                  key={client.id}
                  onClick={() => setSelectedClient(client)}
                  className="flex items-center gap-4 px-5 py-3 bg-surface-container-lowest rounded-2xl shadow-ambient-sm hover:shadow-ambient transition-all cursor-pointer group"
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate group-hover:text-primary transition-colors">{client.name}</p>
                    <p className="text-xs text-on-surface-variant truncate">
                      {client.cif || client.nif || client.cif_nif || 'Sin CIF/NIF'}
                      {client.email && ` · ${client.email}`}
                    </p>
                  </div>
                  <div className="hidden lg:flex items-center gap-2">
                    {client.supplies?.slice(0, 2).map((s: any) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setQuickTaskFor({ clientId: client.id, clientName: client.name, status: s.status })
                        }}
                        className="rounded hover:ring-2 hover:ring-primary/40 transition"
                        title="Crear tarea para este cliente"
                      >
                        <StatusBadge status={s.status} />
                      </button>
                    ))}
                  </div>
                  <Badge variant="info">{supplyCount} sum.</Badge>
                  <span className="text-xs text-on-surface-variant font-medium hidden sm:block">
                    {getUserInitials(client.commercial?.full_name || client.commercial?.email)}
                  </span>
                  <ChevronRight className="w-4 h-4 text-on-surface-variant/30 group-hover:text-primary" />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Client Modal (centered) ── */}
      {selectedClient && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-[100] backdrop-blur-sm"
            onClick={() => { setSelectedClient(null); setEditingSupplyName(null) }}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <div
              className="max-w-2xl w-full max-h-[85vh] bg-surface rounded-2xl shadow-2xl overflow-y-auto pointer-events-auto animate-in fade-in duration-300"
              style={{
                opacity: 0,
                transform: 'scale(0.95)',
                animation: 'modalAppear 0.3s ease-out forwards'
              }}
            >
              <style jsx>{`
                @keyframes modalAppear {
                  from {
                    opacity: 0;
                    transform: scale(0.95);
                  }
                  to {
                    opacity: 1;
                    transform: scale(1);
                  }
                }
              `}</style>

              {/* Modal header */}
            <div className="sticky top-0 bg-surface/95 backdrop-blur-sm z-10 px-6 py-4 border-b border-outline-variant/15">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 flex-1">
                  {(() => { const Icon = typeIcons[selectedClient.type] || Building2; return (
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                  )})()}
                  <div className="min-w-0">
                    <h2 className="font-display font-semibold text-lg text-on-surface">{selectedClient.name}</h2>
                    <p className="text-xs text-on-surface-variant truncate">
                      {selectedClient.cif || selectedClient.nif || selectedClient.cif_nif || 'Sin CIF/NIF'}
                      {selectedClient.email && ` · ${selectedClient.email}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setConfirmDeleteClient(true)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => { setSelectedClient(null); setEditingSupplyName(null) }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-container-high transition-colors"
                  >
                    <X className="w-5 h-5 text-on-surface-variant" />
                  </button>
                </div>
              </div>

              {/* Quick actions */}
              {!confirmDeleteClient ? (
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setSelectedClient(null); router.push(`/clients/${selectedClient.id}`) }}
                  >
                    Ver ficha completa
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setSelectedClient(null); router.push(`/clients/${selectedClient.id}/edit`) }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar
                  </Button>
                </div>
              ) : (
                <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                  <p className="text-sm text-on-surface font-medium mb-3">
                    ¿Eliminar cliente {selectedClient.name}? Se eliminarán también todos sus suministros asociados.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDeleteClient(false)}
                      className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-sm font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleDeleteClient}
                      disabled={deletingClient}
                      className="flex-1 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deletingClient ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Contact info */}
            <div className="px-6 py-4 border-b border-outline-variant/10">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {selectedClient.phone && (
                  <div>
                    <p className="text-on-surface-variant mb-0.5">Teléfono</p>
                    <p className="text-on-surface font-medium">{selectedClient.phone}</p>
                  </div>
                )}
                {selectedClient.email && (
                  <div>
                    <p className="text-on-surface-variant mb-0.5">Email</p>
                    <p className="text-on-surface font-medium truncate">{selectedClient.email}</p>
                  </div>
                )}
                <div>
                  <p className="text-on-surface-variant mb-0.5">Comercial</p>
                  <p className="text-on-surface font-medium">
                    {selectedClient.commercial?.full_name || selectedClient.commercial?.email || 'Sin asignar'}
                  </p>
                </div>
                <div>
                  <p className="text-on-surface-variant mb-0.5">Tipo</p>
                  <p className="text-on-surface font-medium capitalize">{selectedClient.type}</p>
                </div>
              </div>
            </div>

            {/* Supplies */}
            <div className="px-6 py-4">
              <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3">
                Suministros ({selectedClient.supplies?.length || 0})
              </h3>

              {(!selectedClient.supplies || selectedClient.supplies.length === 0) ? (
                <p className="text-sm text-on-surface-variant text-center py-6 italic">Sin suministros</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedClient.supplies.map((supply: any) => {
                    const SIcon = supplyTypeIcons[supply.type] || Zap
                    const isEditing = editingSupplyName === supply.id
                    const accentColor =
                      ['firmado', 'suscrito', 'seguimiento_activo'].includes(supply.status) ? 'from-success/30 to-success/0' :
                      ['estudio_en_curso', 'pendiente_firma'].includes(supply.status) ? 'from-warning/30 to-warning/0' :
                      supply.status === 'rechazado' ? 'from-error/30 to-error/0' :
                      ['presentado', 'estudio_completado'].includes(supply.status) ? 'from-secondary/30 to-secondary/0' :
                      'from-primary/30 to-primary/0'

                    return (
                      <div
                        key={supply.id}
                        role="button"
                        tabIndex={confirmDeleteSupplyId === supply.id || isEditing ? -1 : 0}
                        onClick={() => {
                          if (confirmDeleteSupplyId === supply.id || isEditing) return
                          setSelectedClient(null)
                          router.push(`/supplies/${supply.id}`)
                        }}
                        onKeyDown={(e) => {
                          if (confirmDeleteSupplyId === supply.id || isEditing) return
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedClient(null); router.push(`/supplies/${supply.id}`) }
                        }}
                        className="group/card relative bg-surface-container-lowest rounded-2xl shadow-ambient-xs hover:shadow-ambient-sm hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <div className={`absolute inset-x-0 top-0 h-14 bg-gradient-to-b ${accentColor} pointer-events-none`} />

                        {/* Delete confirm overlay */}
                        {confirmDeleteSupplyId === supply.id ? (
                          <div className="relative p-3 bg-red-500/10">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-on-surface flex-1">¿Eliminar?</span>
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteSupplyId(null) }} className="px-2 py-0.5 rounded-md bg-surface-container-high text-on-surface-variant text-[10px] font-medium">Cancelar</button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteSupply(supply.id) }} disabled={deletingSupply} className="px-2 py-0.5 rounded-md bg-red-500 text-white text-[10px] font-medium disabled:opacity-50">{deletingSupply ? '...' : 'Eliminar'}</button>
                            </div>
                          </div>
                        ) : (
                          <div className="relative p-3.5 flex flex-col gap-2.5">
                            {/* Top: icon + status + delete */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover/card:scale-105 transition-transform">
                                <SIcon className="w-4 h-4 text-primary" />
                              </div>
                              <div className="flex items-center gap-1">
                                <StatusBadge status={supply.status} />
                                <button
                                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteSupplyId(supply.id) }}
                                  className="p-1 rounded-md text-on-surface-variant/20 hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover/card:opacity-100"
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
                                    className="flex-1 min-w-0 px-2 py-0.5 text-xs bg-surface-container-high rounded-lg outline-none focus:ring-2 focus:ring-primary/40"
                                    autoFocus
                                  />
                                  <button onClick={(e) => { e.stopPropagation(); handleSaveSupplyName(supply.id) }} className="p-0.5 text-success"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={(e) => { e.stopPropagation(); setEditingSupplyName(null) }} className="p-0.5 text-error"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <h4 className="text-xs font-semibold text-on-surface truncate group-hover/card:text-primary transition-colors">
                                    {supply.name || supply.cups || 'Sin CUPS'}
                                  </h4>
                                  <button
                                    onClick={e => { e.preventDefault(); e.stopPropagation(); setEditingSupplyName(supply.id); setSupplyNameValue(supply.name || '') }}
                                    className="p-0.5 rounded text-on-surface-variant/30 hover:text-primary opacity-0 group-hover/card:opacity-100 transition-all"
                                  >
                                    <Pencil className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}
                              {supply.name && supply.cups && (
                                <p className="text-[9px] text-on-surface-variant font-mono truncate mt-0.5">{supply.cups}</p>
                              )}
                            </div>

                            {/* Stats: tariff + type */}
                            <div className="grid grid-cols-2 gap-1.5">
                              <div className="rounded-md bg-surface-container-low/50 px-2 py-1">
                                <p className="text-[8px] uppercase tracking-wider text-on-surface-variant/60 font-semibold">Tarifa</p>
                                <p className="text-[11px] text-on-surface font-semibold truncate">{supply.tariff || '—'}</p>
                              </div>
                              <div className="rounded-md bg-surface-container-low/50 px-2 py-1">
                                <p className="text-[8px] uppercase tracking-wider text-on-surface-variant/60 font-semibold">Tipo</p>
                                <p className="text-[11px] text-on-surface font-semibold capitalize truncate">{supply.type || '—'}</p>
                              </div>
                            </div>

                            {/* Address */}
                            {supply.address && (
                              <p className="text-[9px] text-on-surface-variant truncate" title={supply.address}>{supply.address}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            </div>
          </div>
        </>
      )}

      {/* Quick task modal triggered by clicking a status badge */}
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
