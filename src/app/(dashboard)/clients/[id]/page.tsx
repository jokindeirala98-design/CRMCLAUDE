'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, Mail, Phone, MapPin, FileText,
  CreditCard, Zap, Edit2, Trash2, Plus, ExternalLink, FileCheck,
  Send, Sparkles, AlertTriangle, BarChart3, TrendingUp,
  Check, XCircle, Clock, DollarSign, Pencil, X, Flame, Phone as PhoneIcon,
  Loader2, Activity, ShieldOff, ShieldCheck, Copy, CheckCheck, UserCog,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { BulkUploadModal } from '@/components/modals/BulkUploadModal'
import { QuickContractModal } from '@/components/modals/QuickContractModal'
import { NewIncidentModal } from '@/components/modals/NewIncidentModal'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatCurrency, calculateVAT, getUserInitials } from '@/lib/utils/format'
import { normalizeTariff } from '@/lib/consumption-utils'
import { getViewUrl } from '@/lib/utils/storage'
import ConsumptionDistribution from './components/ConsumptionDistribution'
import ContractSection from '@/components/clients/ContractSection'
import { PartnersPanel } from '@/components/clients/PartnersPanel'

export default function ClientDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const { isAdmin } = useAuthStore()
  const [client, setClient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [showQuickContract, setShowQuickContract] = useState(false)
  const [showNewIncident, setShowNewIncident] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clientBillings, setClientBillings] = useState<any[]>([])
  const [editingSupplyName, setEditingSupplyName] = useState<string | null>(null)
  const [supplyNameValue, setSupplyNameValue] = useState('')
  const [copiedCups, setCopiedCups] = useState<string | null>(null)
  const [clientTasks, setClientTasks] = useState<any[]>([])
  const [dismissingTaskIds, setDismissingTaskIds] = useState<Set<string>>(new Set())
  const [togglingFallen, setTogglingFallen] = useState(false)
  const [supplySearch, setSupplySearch] = useState('')
  // Reasignación de comercial
  const [editingCommercial, setEditingCommercial] = useState(false)
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [savingCommercial, setSavingCommercial] = useState(false)

  const fetchClient = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('clients')
      .select(`
        *,
        commercial:users_profile!commercial_id(full_name, email),
        supplies(*, comercializadora:comercializadoras(name), invoices(*)),
        contracts(*),
        subscriptions(*),
        service_contracts(*)
      `)
      .eq('id', id)
      .single()

    setClient(data)
    setLoading(false)
    // Fetch billing records for this client
    if (data) {
      const { data: bills } = await supabase
        .from('billing')
        .select('*')
        .eq('client_id', id as string)
        .order('created_at', { ascending: false })
      setClientBillings(bills || [])
    }

    // Fetch pending tasks associated with this client
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*, assigned_user:assigned_to(full_name)')
      .eq('related_entity_type', 'client')
      .eq('related_entity_id', id as string)
      .in('status', ['pending', 'in_progress'])
      .order('priority', { ascending: false })
    setClientTasks(tasks || [])
  }, [id])

  useEffect(() => {
    fetchClient()
  }, [fetchClient])

  const handleSaveSupplyName = async (supplyId: string) => {
    const supabase = createClient()
    await supabase.from('supplies').update({ name: supplyNameValue.trim() || null }).eq('id', supplyId)
    setClient((prev: any) => ({
      ...prev,
      supplies: prev.supplies?.map((s: any) =>
        s.id === supplyId ? { ...s, name: supplyNameValue.trim() || null } : s
      ),
    }))
    setEditingSupplyName(null)
  }

  // ── Reasignación de comercial ──────────────────────────────────────────────
  const openEditCommercial = async () => {
    if (allUsers.length === 0) {
      const supabase = createClient()
      const { data } = await supabase
        .from('users_profile')
        .select('id, full_name, email, role')
        .order('full_name')
      setAllUsers(data || [])
    }
    setSelectedUserId(client?.commercial_id || '')
    setEditingCommercial(true)
  }

  const saveCommercial = async () => {
    if (savingCommercial) return
    setSavingCommercial(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('clients')
      .update({ commercial_id: selectedUserId || null })
      .eq('id', id)
    if (!error) {
      const newCommercial = allUsers.find(u => u.id === selectedUserId) || null
      setClient((prev: any) => ({
        ...prev,
        commercial_id: selectedUserId || null,
        commercial: newCommercial ? { full_name: newCommercial.full_name, email: newCommercial.email } : null,
      }))
      setEditingCommercial(false)
    }
    setSavingCommercial(false)
  }

  const handleDelete = async () => {
    if (!confirm('¿Estas seguro de eliminar este cliente? Esta accion no se puede deshacer.')) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('clients').delete().eq('id', id)
      if (error) throw error
      router.push('/clients')
    } catch (err) {
      console.error('Error deleting client:', err)
      alert('No se pudo eliminar el cliente. Puede tener suministros asociados.')
      setDeleting(false)
    }
  }

  const handleToggleFallen = async () => {
    if (!client) return
    const newFallen = !client.is_fallen
    const confirmed = newFallen
      ? confirm(`¿Marcar a ${client.name} como CLIENTE CAÍDO?\n\nSe pausarán los pagos y aparecerá como inactivo. Su comercial verá un aviso de decomisión en la liquidación.`)
      : confirm(`¿Reactivar a ${client.name}?\n\nEl cliente volverá a estar activo y se actualizará su estado en VOLTIS CONTRATACIONES.`)
    if (!confirmed) return

    setTogglingFallen(true)
    try {
      const res = await fetch(`/api/clients/${id}/fallen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fallen: newFallen }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al actualizar estado')
      }
      setClient((prev: any) => ({
        ...prev,
        is_fallen: newFallen,
        fallen_at: newFallen ? new Date().toISOString() : null,
      }))
    } catch (e: any) {
      alert(e.message)
    } finally {
      setTogglingFallen(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-2 border-brand border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-ink-3">Cliente no encontrado</p>
        <Button variant="secondary" onClick={() => router.push('/clients')}>
          Volver a clientes
        </Button>
      </div>
    )
  }

  const completeClientTask = async (taskId: string) => {
    setDismissingTaskIds(prev => new Set(prev).add(taskId))
    const supabase = createClient()
    await supabase
      .from('tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', taskId)
    setClientTasks(prev => prev.filter(t => t.id !== taskId))
    setDismissingTaskIds(prev => { const next = new Set(prev); next.delete(taskId); return next })
  }

  // ── Annual consumption helper ────────────────────────────────────────────
  // ÚNICA FUENTE: datos SIPS de Lidera (consumption_data.totalKwh), obtenidos
  // al dar de alta el suministro con el CUPS. NO se calcula a partir de facturas.
  const getSupplyAnnualConsumption = (supply: any): number => {
    const cd = supply?.consumption_data as any
    if (!cd) return 0
    // consumoPeriodos (from SIPS or Excel import) takes priority
    const cp = cd.consumoPeriodos
    if (cp && typeof cp === 'object') {
      const sum = Object.values(cp).reduce((a: number, v) => a + (Number(v) || 0), 0)
      if (sum > 0) return sum
    }
    // Fallback to totalKwh field
    const kwh = Number(cd.totalKwh ?? cd.total ?? 0)
    return Number.isFinite(kwh) && kwh > 0 ? kwh : 0
  }

  const handleCopyCups = (e: React.MouseEvent, cups: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(cups).then(() => {
      setCopiedCups(cups)
      setTimeout(() => setCopiedCups(null), 1800)
    })
  }

  const fmtKwh = (n: number) =>
    n >= 1000 ? `${(n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MWh/año`
              : `${n.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kWh/año`

  // Tariff priority: luz (6.x > 3.0 > 2.0) always before gas (RL5 > RL4 > RL1)
  function tariffPriority(t: string, type?: string): number {
    if (!t) return 0
    const tu = t.trim().toUpperCase()
    if (type === 'gas') {
      if (tu.includes('5')) return 15
      if (tu.includes('4')) return 14
      if (tu.includes('3')) return 13
      if (tu.includes('2')) return 12
      if (tu.includes('1')) return 11
      return 10
    }
    if (tu.startsWith('6.4')) return 64
    if (tu.startsWith('6.3')) return 63
    if (tu.startsWith('6.2')) return 62
    if (tu.startsWith('6.1')) return 61
    if (tu.startsWith('6'))   return 60
    if (tu.startsWith('3.0')) return 40
    if (tu.startsWith('3'))   return 39
    if (tu.startsWith('2.0')) return 20
    if (tu.startsWith('2'))   return 19
    return 5
  }

  // Sorted copy of supplies: luz before gas, tariff descending (6.1 → 3.0 → 2.0 → RL4 → RL1), then consumption descending
  const sortedSupplies: any[] = [...(client.supplies || [])].sort((a, b) => {
    const tp = tariffPriority(b.tariff ?? '', b.type) - tariffPriority(a.tariff ?? '', a.type)
    if (tp !== 0) return tp
    return getSupplyAnnualConsumption(b) - getSupplyAnnualConsumption(a)
  })

  // Filtered supplies by search query (CUPS or name)
  const filteredSupplies = supplySearch.trim()
    ? sortedSupplies.filter((s: any) => {
        const q = supplySearch.toLowerCase()
        return (
          s.cups?.toLowerCase().includes(q) ||
          s.name?.toLowerCase().includes(q)
        )
      })
    : sortedSupplies

  const typeIcons: Record<string, string> = { luz: '⚡', gas: '🔥', telefonia: '📞' }
  const supplyTypeIconComponents: Record<string, React.ElementType> = { luz: Zap, gas: Flame, telefonia: PhoneIcon }

  return (
    <div>
      <Header
        title={client.name}
        subtitle={`${client.type === 'empresa' ? 'Empresa' : client.type === 'ayuntamiento' ? 'Ayuntamiento' : 'Particular'} · ${client.cif_nif || 'Sin NIF'} · Desde ${formatDate(client.created_at)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => router.push('/clients')}>
              <ArrowLeft className="w-4 h-4" />
              Volver
            </Button>
            <Button variant="secondary" onClick={() => setShowNewIncident(true)}>
              <AlertTriangle className="w-4 h-4" />
              Incidencia
            </Button>
            <Button onClick={() => setShowQuickContract(true)}>
              <Sparkles className="w-4 h-4" />
              Generar contrato
            </Button>
            <Button variant="secondary" onClick={() => router.push(`/clients/${id}/edit`)}>
              <Edit2 className="w-4 h-4" />
              Editar
            </Button>
            <Button
              variant={client.is_fallen ? 'secondary' : 'danger'}
              size="sm"
              onClick={handleToggleFallen}
              loading={togglingFallen}
              title={client.is_fallen ? 'Reactivar cliente' : 'Marcar como cliente caído'}
            >
              {client.is_fallen ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">

        {/* ── Cliente caído banner ── */}
        {client.is_fallen && (
          <div className="flex items-center gap-4 px-5 py-4 rounded-xl border border-err/30 bg-err-container/40">
            <ShieldOff className="w-6 h-6 text-err flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-err">Cliente caído</p>
              <p className="text-xs text-err mt-0.5">
                Este cliente está marcado como caído
                {client.fallen_at ? ` desde el ${formatDate(client.fallen_at)}` : ''}.
                Los pagos están pausados y aparecerá un aviso de decomisión en la liquidación del comercial.
              </p>
            </div>
            <button
              onClick={handleToggleFallen}
              disabled={togglingFallen}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ok text-white hover:opacity-90 transition-opacity flex-shrink-0"
            >
              {togglingFallen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Reactivar
            </button>
          </div>
        )}

        {/* Task disclaimers */}
        {clientTasks.length > 0 && (
          <div className="space-y-2">
            {clientTasks.map((task) => {
              const isHigh = task.priority === 'high'
              const isMedium = task.priority === 'medium'
              const bgColor = isHigh ? 'bg-err-container/40 border-err/30' : isMedium ? 'bg-warn-container/40 border-warn/30' : 'bg-ok-container/40 border-ok/30'
              const textColor = isHigh ? 'text-err' : isMedium ? 'text-warn' : 'text-ok'
              const subColor = isHigh ? 'text-err' : isMedium ? 'text-warn' : 'text-ok'
              const iconColor = isHigh ? 'text-err' : isMedium ? 'text-warn' : 'text-ok'
              const btnColor = isHigh
                ? 'bg-err hover:bg-err-container text-white'
                : isMedium
                ? 'bg-warn-container/400 hover:bg-warn-container text-white'
                : 'bg-ok text-white hover:opacity-90'

              return (
                <div key={task.id} className={`flex items-center gap-4 px-5 py-3 rounded-xl border ${bgColor}`}>
                  <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${textColor}`}>{task.title}</p>
                    {task.description && (
                      <p className={`text-xs ${subColor} line-clamp-1 mt-0.5`}>{task.description}</p>
                    )}
                    <div className={`flex items-center gap-3 text-xs ${subColor} mt-0.5`}>
                      {task.due_date && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(task.due_date)}
                        </span>
                      )}
                      {task.assigned_user && <span>{task.assigned_user.full_name}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => completeClientTask(task.id)}
                    disabled={dismissingTaskIds.has(task.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0 ${btnColor}`}
                  >
                    {dismissingTaskIds.has(task.id) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Hecha
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* info grid using edit page aesthetics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Informacion basica */}
          <Card>
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" /> Informacion basica
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] text-ink-3 uppercase font-bold">Tipo</p>
                <p className="text-sm font-medium capitalize">{client.type}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-ink-3 uppercase font-bold">Origen</p>
                <p className="text-sm font-medium capitalize">{client.origin || '—'}</p>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <p className="text-[10px] text-ink-3 uppercase font-bold">Resumen actividad</p>
                <div className="flex gap-4 pt-1">
                  <div className="text-center bg-bg-2 rounded-xl px-4 py-2 border border-line-2-variant/10">
                    <p className="font-sans font-bold text-lg">{client.supplies?.length || 0}</p>
                    <p className="text-[9px] text-ink-3 uppercase">Suministros</p>
                  </div>
                  <div className="text-center bg-bg-2 rounded-xl px-4 py-2 border border-line-2-variant/10">
                    <p className="font-sans font-bold text-lg">{client.contracts?.length || 0}</p>
                    <p className="text-[9px] text-ink-3 uppercase">Contratos</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Asignacion */}
          <Card>
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Pencil className="w-3.5 h-3.5" /> Asignacion
            </h3>
            <div className="space-y-4">
              {/* Comercial asignado */}
              {editingCommercial ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-ink-3 uppercase font-bold px-1">Seleccionar comercial</p>
                  <select
                    value={selectedUserId}
                    onChange={e => setSelectedUserId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="">— Sin asignar —</option>
                    {allUsers.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.full_name || u.email}{u.role ? ` (${u.role})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveCommercial}
                      disabled={savingCommercial}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-brand text-white rounded-xl text-sm font-semibold hover:bg-brand/90 transition-all disabled:opacity-50"
                    >
                      {savingCommercial ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditingCommercial(false)}
                      className="px-3 py-2 rounded-xl text-sm text-ink-3 hover:bg-line/60 transition-all"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-bg-2 p-3 rounded-2xl border border-line-2-variant/10">
                  <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-bold">
                      {getUserInitials(client.commercial?.full_name || client.commercial?.email)?.charAt(0) || '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-ink-3 uppercase font-bold">Comercial asignado</p>
                    <p className="text-sm font-semibold truncate">{client.commercial?.full_name || 'Sin asignar'}</p>
                  </div>
                  {isAdmin() && (
                    <button
                      onClick={openEditCommercial}
                      className="p-1.5 rounded-lg text-ink-4 hover:bg-line/60 hover:text-ink transition-all flex-shrink-0"
                      title="Cambiar comercial"
                    >
                      <UserCog className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 px-3">
                <div className={`p-1 rounded-full ${client.marketing_consent ? 'bg-success/10 text-ok' : 'bg-bg-2 text-ink-3/40'}`}>
                  <Check className="w-3 h-3" />
                </div>
                <p className="text-xs text-ink-3">Consentimiento marketing otorgado</p>
              </div>
            </div>
          </Card>

          {/* Partners externos (solo admins) */}
          <PartnersPanel clientId={client.id} />

          {/* Datos de contacto */}
          <Card>
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" /> Datos de contacto
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] text-ink-3 uppercase font-bold">Email</p>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {client.email || '—'}
                  {client.email && <button onClick={() => navigator.clipboard.writeText(client.email)} className="p-1 hover:bg-primary/10 rounded transition text-brand"><CreditCard className="w-3 h-3"/></button>}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-ink-3 uppercase font-bold">Telefono</p>
                <p className="text-sm font-medium">{client.phone || '—'}</p>
              </div>
              <div className="sm:col-span-2 space-y-1 pt-2 border-t border-line-2-variant/10">
                <p className="text-[10px] text-ink-3 uppercase font-bold">Direccion fiscal</p>
                <p className="text-sm font-medium leading-relaxed">{client.fiscal_address || '—'}</p>
              </div>
            </div>
          </Card>

          {/* Documentacion */}
          <Card>
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-4 flex items-center gap-2">
              <FileCheck className="w-3.5 h-3.5" /> Documentacion
            </h3>
            <div className="space-y-3">
              <DocRow label="CIF" value={client.cif} url={client.cif_file_url} />
              <DocRow label="NIF" value={client.nif} url={client.nif_file_url} />
              <DocRow label="IBAN" value={client.iban} url={client.iban_file_url} />
            </div>
          </Card>

          {/* Notas */}
          <div className="md:col-span-2">
            <Card>
              <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" /> Notas
              </h3>
              <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap min-h-[4rem]">
                {client.notes || 'No hay notas adicionales.'}
              </p>
            </Card>
          </div>
        </div>

        {/* Supplies */}
        <div>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="font-sans font-semibold text-lg text-ink flex-shrink-0">
              Suministros ({client.supplies?.length || 0})
            </h2>
            <div className="flex items-center gap-2 flex-1 min-w-0 max-w-xs">
              <input
                type="text"
                value={supplySearch}
                onChange={e => setSupplySearch(e.target.value)}
                placeholder="Buscar CUPS o nombre…"
                className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-bg-2 border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-ink-4"
              />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {(client.supplies?.length || 0) > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => router.push(`/clients/${id}/economic-overview`)}
                  title="Estudio económico agregado de todos los suministros"
                >
                  <TrendingUp className="w-4 h-4" />
                  Estudio económico global
                </Button>
              )}
              <Button size="sm" onClick={() => setShowBulkUpload(true)}>
                <Plus className="w-4 h-4" />
                Importar facturas
              </Button>
            </div>
          </div>

          {(!client.supplies || client.supplies.length === 0) ? (
            <Card>
              <p className="text-sm text-ink-3 text-center py-6">No hay suministros para este cliente</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSupplies.length === 0 && (
                <div className="col-span-full text-sm text-ink-3 text-center py-6">
                  No hay suministros que coincidan con "{supplySearch}"
                </div>
              )}
              {filteredSupplies.reduce((acc: React.ReactNode[], supply: any, idx: number) => {
                // Section header: inject when tariff group changes
                const getGroup = (s: any) => {
                  if (s.type !== 'gas') return `luz:${normalizeTariff(s.tariff) || s.tariff || ''}`
                  const tu = (s.tariff || '').toUpperCase()
                  if (tu.includes('5')) return 'gas:RL.5'
                  if (tu.includes('4')) return 'gas:RL.4'
                  if (tu.includes('3')) return 'gas:RL.3'
                  if (tu.includes('2')) return 'gas:RL.2'
                  if (tu.includes('1')) return 'gas:RL.1'
                  return 'gas:gas'
                }
                const getGroupLabel = (g: string) => {
                  if (g.startsWith('luz:')) return g.replace('luz:', '') || 'Electricidad'
                  return g.replace('gas:', '')
                }
                const currentGroup = getGroup(supply)
                const prevGroup = idx > 0 ? getGroup(filteredSupplies[idx - 1]) : null
                if (currentGroup !== prevGroup) {
                  const groupSupplies = filteredSupplies.filter((s: any) => getGroup(s) === currentGroup)
                  const icon = supply.type === 'gas' ? '🔥' : '⚡'
                  acc.push(
                    <div key={`header-${currentGroup}`} className="col-span-full flex items-center gap-2 mt-2 mb-0">
                      <span className="text-xs font-bold uppercase tracking-widest text-ink-3">{icon} {getGroupLabel(currentGroup)}</span>
                      <span className="text-[10px] text-ink-4 bg-bg-2 rounded-full px-2 py-0.5 font-semibold">{groupSupplies.length}</span>
                      <div className="flex-1 h-px bg-line-2-variant/30" />
                    </div>
                  )
                }
                const invoiceCount = supply.invoices?.length || 0
                const annualKwh = getSupplyAnnualConsumption(supply)
                const isEditingName = editingSupplyName === supply.id
                const accentByStatus =
                  ['firmado', 'suscrito', 'seguimiento_activo'].includes(supply.status) ? 'from-success/40 to-success/0' :
                  ['estudio_en_curso', 'pendiente_firma'].includes(supply.status) ? 'from-warning/40 to-warning/0' :
                  supply.status === 'rechazado' ? 'from-error/40 to-error/0' :
                  ['presentado', 'estudio_completado'].includes(supply.status) ? 'from-secondary/40 to-secondary/0' :
                  'from-primary/40 to-primary/0'
                acc.push(
                  <div
                    key={supply.id}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => router.prefetch(`/supplies/${supply.id}`)}
                    onFocus={() => router.prefetch(`/supplies/${supply.id}`)}
                    onClick={() => { if (!isEditingName) router.push(`/supplies/${supply.id}`) }}
                    onKeyDown={(e) => {
                      if (isEditingName) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        router.push(`/supplies/${supply.id}`)
                      }
                    }}
                    className="group relative bg-card rounded-2xl shadow-ambient-sm hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    {/* Subtle gradient accent based on status */}
                    <div className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${accentByStatus} pointer-events-none`} />

                    <div className="relative p-4 flex flex-col gap-3">
                      {/* Top row: type icon + status + edit pencil */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-xl shadow-sm group-hover:scale-105 transition-transform">
                          {typeIcons[supply.type] || '⚡'}
                        </div>
                        <div className="flex items-center gap-1">
                          <StatusBadge status={supply.status} />
                        </div>
                      </div>

                      {/* Title (alias) + CUPS */}
                      <div className="min-w-0">
                        {isEditingName ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={supplyNameValue}
                              onChange={e => setSupplyNameValue(e.target.value)}
                              onKeyDown={e => {
                                e.stopPropagation()
                                if (e.key === 'Enter') handleSaveSupplyName(supply.id)
                                if (e.key === 'Escape') setEditingSupplyName(null)
                              }}
                              placeholder="Ej: Luz polideportivo"
                              className="flex-1 min-w-0 px-2 py-1 text-sm bg-bg-2 rounded-lg outline-none focus:ring-2 focus:ring-primary/40"
                              autoFocus
                            />
                            <button onClick={(e) => { e.stopPropagation(); handleSaveSupplyName(supply.id) }} className="p-1 text-ok hover:bg-success/10 rounded">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setEditingSupplyName(null) }} className="p-1 text-err hover:bg-error/10 rounded">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            {/* Nickname (if set) */}
                            {supply.name && (
                              <h3 className="text-sm font-semibold text-ink truncate group-hover:text-brand transition-colors mb-0.5">
                                {supply.name}
                              </h3>
                            )}
                            {/* CUPS: always visible, double-click to set nickname, copy button */}
                            <div
                              className="flex items-center gap-1 min-w-0"
                              onClick={e => e.stopPropagation()}
                            >
                              <p
                                className="font-mono text-[10px] text-ink-3 truncate cursor-text select-text"
                                title="Doble clic para añadir nombre"
                                onDoubleClick={e => {
                                  e.stopPropagation()
                                  setEditingSupplyName(supply.id)
                                  setSupplyNameValue(supply.name || '')
                                }}
                              >
                                {supply.cups || 'Sin CUPS'}
                              </p>
                              {supply.cups && (
                                <button
                                  onClick={e => handleCopyCups(e, supply.cups)}
                                  className="p-0.5 text-ink-3/40 hover:text-brand transition-colors flex-shrink-0"
                                  title="Copiar CUPS"
                                >
                                  {copiedCups === supply.cups
                                    ? <CheckCheck className="w-3 h-3 text-ok" />
                                    : <Copy className="w-3 h-3" />
                                  }
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Stats grid: tariff, type, invoices, annual kWh */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="rounded-lg bg-bg-2/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-ink-3/70 font-semibold">Tarifa</p>
                          <p className="text-xs text-ink font-semibold truncate">{normalizeTariff(supply.tariff || '') || supply.tariff || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-bg-2/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-ink-3/70 font-semibold">Tipo</p>
                          <p className="text-xs text-ink font-semibold capitalize truncate">{supply.type || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-bg-2/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-ink-3/70 font-semibold">Documentos</p>
                          <p className="text-xs font-semibold truncate">
                            <span className={invoiceCount > 0 ? 'text-brand' : 'text-ink-3/50'}>{invoiceCount}</span>
                          </p>
                        </div>
                        <div className="rounded-lg bg-bg-2/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-ink-3/70 font-semibold">Consumo anual</p>
                          <p className="text-xs font-semibold truncate">
                            {annualKwh > 0
                              ? <span className="text-ok">{fmtKwh(annualKwh)}</span>
                              : <span className="text-ink-3/50">—</span>}
                          </p>
                        </div>
                      </div>

                      {/* Address */}
                      {supply.address && (
                        <div className="pt-1 border-t border-line-2-variant/10">
                          <p className="text-[10px] text-ink-3 truncate" title={supply.address}>
                            {supply.address}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )
                return acc
              }, [])}
            </div>
          )}
        </div>

        {/* ─── Distribución de consumo (solo para ayuntamientos) ─── */}
        {client.type === 'ayuntamiento' && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-sans font-semibold text-lg text-ink flex items-center gap-2">
                <Activity className="w-5 h-5 text-brand" />
                Distribución de consumo
              </h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => router.push(`/clients/${id}/audit-report`)}
              >
                <BarChart3 className="w-4 h-4" />
                Informe de auditoría
              </Button>
            </div>
            <ConsumptionDistribution
              clientId={id as string}
              supplies={(client.supplies || []).map((s: any) => ({
                id: s.id,
                cups: s.cups,
                type: s.type,
                tariff: s.tariff,
              }))}
            />
          </div>
        )}

        {/* ─── Contrato de Servicio Voltis ─── */}
        <ContractSection client={client} onUpdate={fetchClient} />

        {/* ─── Subscription History ─── */}
        {client.subscriptions && client.subscriptions.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-3 flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Historial de suscripciones y pagos
            </h3>
            <div className="space-y-3">
              {client.subscriptions
                .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((sub: any) => {
                  const isActive = sub.status === 'active'
                  const isCancelled = sub.status === 'cancelled'
                  const isPending = sub.status === 'pending_activation'
                  const isPercentage = sub.model === 'percentage'
                  const subBillings = clientBillings.filter((b) => b.subscription_id === sub.id)
                  const totalPaid = subBillings.filter((b: any) => b.status === 'paid').reduce((s: number, b: any) => s + b.total_amount, 0)
                  const totalPending = subBillings.filter((b: any) => b.status === 'sent').reduce((s: number, b: any) => s + b.total_amount, 0)
                  const paidCount = subBillings.filter((b: any) => b.status === 'paid').length

                  let planLabel = ''
                  let amountLabel = ''
                  if (isPercentage) {
                    planLabel = `${sub.percentage_value}% del ahorro`
                    if (sub.total_savings) {
                      const amt = calculateVAT(sub.total_savings * (sub.percentage_value / 100))
                      amountLabel = formatCurrency(amt.total)
                    }
                  } else {
                    const tierNames: Record<number, string> = { 19.99: 'Basico', 45: 'Profesional', 90: 'Empresarial', 180: 'Premium', 260: 'Enterprise' }
                    planLabel = `Plan ${tierNames[sub.plan_tier] || sub.plan_tier + '€'}`
                    amountLabel = sub.payment_mode === 'immediate'
                      ? formatCurrency(calculateVAT((sub.plan_tier || 0) * 4).total)
                      : `${formatCurrency(calculateVAT(sub.plan_tier || 0).total)}/trim`
                  }

                  return (
                    <Card key={sub.id} className={`!p-0 overflow-hidden ${isCancelled ? 'opacity-70' : ''}`}>
                      {/* Header */}
                      <div className={`flex items-center gap-3 px-4 py-3 ${isCancelled ? 'bg-err-container/40' : isActive ? 'bg-ok-container/40' : 'bg-warn-container/40'}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isCancelled ? 'bg-err-container' : isActive ? 'bg-ok-container' : 'bg-warn-container'
                        }`}>
                          {isCancelled ? <XCircle className="w-4 h-4 text-err" /> :
                           isActive ? <Check className="w-4 h-4 text-ok" /> :
                           <Clock className="w-4 h-4 text-warn" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${isCancelled ? 'text-err line-through' : 'text-ink'}`}>
                              {planLabel}
                            </p>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                              isCancelled ? 'bg-err-container text-err' :
                              isActive ? 'bg-ok-container text-ok' :
                              'bg-warn-container text-warn'
                            }`}>
                              {isCancelled ? 'Cancelada' : isActive ? 'Activa' : 'Pendiente'}
                            </span>
                          </div>
                          <p className="text-xs text-ink-3">
                            {sub.payment_mode === 'immediate' ? 'Pago unico' : 'Fraccionado (4 trim.)'} · {amountLabel}
                            {isCancelled && sub.cancelled_at && ` · Cancelada el ${formatDate(sub.cancelled_at)}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-ink-3">Desde {formatDate(sub.start_date || sub.created_at)}</p>
                          {paidCount > 0 && (
                            <p className="text-xs font-medium text-brand flex items-center gap-1 justify-end">
                              <DollarSign className="w-3 h-3" />
                              {paidCount} pago{paidCount !== 1 ? 's' : ''} · {formatCurrency(totalPaid)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Payment details */}
                      {subBillings.length > 0 && (
                        <div className="px-4 py-2 border-t border-surface-container-low">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-ink-3">
                                <th className="text-left py-1 font-medium">Fecha</th>
                                <th className="text-left py-1 font-medium">Concepto</th>
                                <th className="text-right py-1 font-medium">Total</th>
                                <th className="text-center py-1 font-medium">Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {subBillings.map((bill: any) => (
                                <tr key={bill.id} className="border-t border-surface-container-low/30">
                                  <td className="py-1.5 text-ink">{formatDate(bill.created_at)}</td>
                                  <td className="py-1.5 text-ink truncate max-w-[200px]">{bill.concept}</td>
                                  <td className="py-1.5 text-ink text-right font-medium">{formatCurrency(bill.total_amount)}</td>
                                  <td className="py-1.5 text-center">
                                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      bill.status === 'paid' ? 'bg-ok-container/40 text-ok' :
                                      bill.status === 'sent' ? 'bg-info-container/40 text-info' :
                                      bill.status === 'overdue' ? 'bg-err-container/40 text-err' :
                                      'bg-slate-50 text-slate-600'
                                    }`}>
                                      {bill.status === 'paid' ? 'Cobrado' : bill.status === 'sent' ? 'Pendiente' : bill.status === 'overdue' ? 'Impagado' : bill.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {totalPending > 0 && (
                            <p className="text-[10px] text-ink-3 mt-1 text-right">Pendiente de cobro: {formatCurrency(totalPending)}</p>
                          )}
                        </div>
                      )}

                      {/* No payments message */}
                      {subBillings.length === 0 && (
                        <div className="px-4 py-2 border-t border-surface-container-low">
                          <p className="text-xs text-ink-3 italic">Sin pagos registrados</p>
                        </div>
                      )}
                    </Card>
                  )
                })}
            </div>
          </div>
        )}
      </div>

      <BulkUploadModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onCreated={fetchClient}
        preselectedClientId={id as string}
      />

      <QuickContractModal
        open={showQuickContract}
        onClose={() => setShowQuickContract(false)}
        onCreated={fetchClient}
        client={client}
      />

      <NewIncidentModal
        open={showNewIncident}
        onClose={() => setShowNewIncident(false)}
        onCreated={fetchClient}
        preselectedClientId={id as string}
      />
    </div>
  )
}

function DocRow({ label, value, url }: { label: string; value: string | null; url: string | null }) {
  return (
    <div className="flex items-center justify-between p-3 bg-bg-2 rounded-xl border border-line-2-variant/10">
      <div className="flex items-center gap-2.5 min-w-0">
        <FileText className="w-4 h-4 text-ink-3 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] text-ink-3 uppercase font-bold">{label}</p>
          <p className="text-sm font-medium truncate">{value || 'No disponible'}</p>
        </div>
      </div>
      {url && (
        <a 
          href={getViewUrl(url)} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-brand text-[10px] font-bold hover:bg-primary/20 transition whitespace-nowrap"
        >
          <ExternalLink className="w-3.5 h-3.5" /> VER
        </a>
      )}
    </div>
  )
}
