'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, Mail, Phone, MapPin, FileText,
  CreditCard, Zap, Edit2, Trash2, Plus, ExternalLink, FileCheck,
  Send, Sparkles, AlertTriangle, BarChart3,
  Check, XCircle, Clock, DollarSign, Pencil, X, Flame, Phone as PhoneIcon,
  Loader2
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { BulkUploadModal } from '@/components/modals/BulkUploadModal'
import { QuickContractModal } from '@/components/modals/QuickContractModal'
import { NewIncidentModal } from '@/components/modals/NewIncidentModal'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatCurrency, calculateVAT, getUserInitials } from '@/lib/utils/format'
import { getViewUrl } from '@/lib/utils/storage'

export default function ClientDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [client, setClient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [showQuickContract, setShowQuickContract] = useState(false)
  const [showNewIncident, setShowNewIncident] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clientBillings, setClientBillings] = useState<any[]>([])
  const [editingSupplyName, setEditingSupplyName] = useState<string | null>(null)
  const [supplyNameValue, setSupplyNameValue] = useState('')
  const [clientTasks, setClientTasks] = useState<any[]>([])
  const [dismissingTaskIds, setDismissingTaskIds] = useState<Set<string>>(new Set())

  const fetchClient = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('clients')
      .select(`
        *,
        commercial:users_profile!commercial_id(full_name, email),
        supplies(*, comercializadora:comercializadoras(name), invoices(*)),
        contracts(*),
        subscriptions(*)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-2 border-secondary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-on-surface-variant">Cliente no encontrado</p>
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
    const kwh = Number(cd.totalKwh ?? cd.total ?? 0)
    return Number.isFinite(kwh) && kwh > 0 ? kwh : 0
  }

  const fmtKwh = (n: number) =>
    n >= 1000 ? `${(n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MWh/año`
              : `${n.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kWh/año`

  // Sorted copy of supplies (highest annual consumption first)
  const sortedSupplies: any[] = [...(client.supplies || [])].sort(
    (a, b) => getSupplyAnnualConsumption(b) - getSupplyAnnualConsumption(a)
  )

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
            <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* Task disclaimers */}
        {clientTasks.length > 0 && (
          <div className="space-y-2">
            {clientTasks.map((task) => {
              const isHigh = task.priority === 'high'
              const isMedium = task.priority === 'medium'
              const bgColor = isHigh ? 'bg-red-50 border-red-300' : isMedium ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-300'
              const textColor = isHigh ? 'text-red-800' : isMedium ? 'text-amber-800' : 'text-green-800'
              const subColor = isHigh ? 'text-red-600' : isMedium ? 'text-amber-600' : 'text-green-600'
              const iconColor = isHigh ? 'text-red-500' : isMedium ? 'text-amber-500' : 'text-green-500'
              const btnColor = isHigh
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : isMedium
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'

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
            <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" /> Informacion basica
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] text-on-surface-variant uppercase font-bold">Tipo</p>
                <p className="text-sm font-medium capitalize">{client.type}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-on-surface-variant uppercase font-bold">Origen</p>
                <p className="text-sm font-medium capitalize">{client.origin || '—'}</p>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <p className="text-[10px] text-on-surface-variant uppercase font-bold">Resumen actividad</p>
                <div className="flex gap-4 pt-1">
                  <div className="text-center bg-surface-container-low rounded-xl px-4 py-2 border border-outline-variant/10">
                    <p className="font-display font-bold text-lg">{client.supplies?.length || 0}</p>
                    <p className="text-[9px] text-on-surface-variant uppercase">Suministros</p>
                  </div>
                  <div className="text-center bg-surface-container-low rounded-xl px-4 py-2 border border-outline-variant/10">
                    <p className="font-display font-bold text-lg">{client.contracts?.length || 0}</p>
                    <p className="text-[9px] text-on-surface-variant uppercase">Contratos</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Asignacion */}
          <Card>
            <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-2">
              <Pencil className="w-3.5 h-3.5" /> Asignacion
            </h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-surface-container-low p-3 rounded-2xl border border-outline-variant/10">
                <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-bold">
                    {getUserInitials(client.commercial?.full_name || client.commercial?.email)?.charAt(0) || '?'}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-on-surface-variant uppercase font-bold">Comercial asignado</p>
                  <p className="text-sm font-semibold">{client.commercial?.full_name || 'Sin asignar'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3">
                <div className={`p-1 rounded-full ${client.marketing_consent ? 'bg-success/10 text-success' : 'bg-surface-container-high text-on-surface-variant/40'}`}>
                  <Check className="w-3 h-3" />
                </div>
                <p className="text-xs text-on-surface-variant">Consentimiento marketing otorgado</p>
              </div>
            </div>
          </Card>

          {/* Datos de contacto */}
          <Card>
            <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" /> Datos de contacto
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] text-on-surface-variant uppercase font-bold">Email</p>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {client.email || '—'}
                  {client.email && <button onClick={() => navigator.clipboard.writeText(client.email)} className="p-1 hover:bg-primary/10 rounded transition text-primary"><CreditCard className="w-3 h-3"/></button>}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-on-surface-variant uppercase font-bold">Telefono</p>
                <p className="text-sm font-medium">{client.phone || '—'}</p>
              </div>
              <div className="sm:col-span-2 space-y-1 pt-2 border-t border-outline-variant/10">
                <p className="text-[10px] text-on-surface-variant uppercase font-bold">Direccion fiscal</p>
                <p className="text-sm font-medium leading-relaxed">{client.fiscal_address || '—'}</p>
              </div>
            </div>
          </Card>

          {/* Documentacion */}
          <Card>
            <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-2">
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
              <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" /> Notas
              </h3>
              <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap min-h-[4rem]">
                {client.notes || 'No hay notas adicionales.'}
              </p>
            </Card>
          </div>
        </div>

        {/* Supplies */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-lg text-on-surface">
              Suministros ({client.supplies?.length || 0})
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setShowBulkUpload(true)}>
                <Plus className="w-4 h-4" />
                Importar facturas
              </Button>
            </div>
          </div>

          {(!client.supplies || client.supplies.length === 0) ? (
            <Card>
              <p className="text-sm text-on-surface-variant text-center py-6">No hay suministros para este cliente</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedSupplies.map((supply: any) => {
                const invoiceCount = supply.invoices?.length || 0
                const annualKwh = getSupplyAnnualConsumption(supply)
                const isEditingName = editingSupplyName === supply.id
                const accentByStatus =
                  ['firmado', 'suscrito', 'seguimiento_activo'].includes(supply.status) ? 'from-success/40 to-success/0' :
                  ['estudio_en_curso', 'pendiente_firma'].includes(supply.status) ? 'from-warning/40 to-warning/0' :
                  supply.status === 'rechazado' ? 'from-error/40 to-error/0' :
                  ['presentado', 'estudio_completado'].includes(supply.status) ? 'from-secondary/40 to-secondary/0' :
                  'from-primary/40 to-primary/0'
                return (
                  <div
                    key={supply.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!isEditingName) router.push(`/supplies/${supply.id}`) }}
                    onKeyDown={(e) => {
                      if (isEditingName) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        router.push(`/supplies/${supply.id}`)
                      }
                    }}
                    className="group relative bg-surface-container-lowest rounded-2xl shadow-ambient-sm hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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
                          {!isEditingName && (
                            <button
                              onClick={e => { e.stopPropagation(); setEditingSupplyName(supply.id); setSupplyNameValue(supply.name || '') }}
                              className="p-1.5 text-on-surface-variant/30 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                              title="Editar nombre"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
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
                              placeholder="Nombre del suministro"
                              className="flex-1 min-w-0 px-2 py-1 text-sm bg-surface-container-high rounded-lg outline-none focus:ring-2 focus:ring-primary/40"
                              autoFocus
                            />
                            <button onClick={(e) => { e.stopPropagation(); handleSaveSupplyName(supply.id) }} className="p-1 text-success hover:bg-success/10 rounded">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setEditingSupplyName(null) }} className="p-1 text-error hover:bg-error/10 rounded">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <h3 className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                              {supply.name || supply.cups || 'Sin CUPS'}
                            </h3>
                            {supply.name && supply.cups && (
                              <p className="text-[10px] font-mono text-on-surface-variant truncate mt-0.5">{supply.cups}</p>
                            )}
                          </>
                        )}
                      </div>

                      {/* Stats grid: tariff, type, invoices, annual kWh */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="rounded-lg bg-surface-container-low/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-semibold">Tarifa</p>
                          <p className="text-xs text-on-surface font-semibold truncate">{supply.tariff || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-surface-container-low/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-semibold">Tipo</p>
                          <p className="text-xs text-on-surface font-semibold capitalize truncate">{supply.type || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-surface-container-low/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-semibold">Documentos</p>
                          <p className="text-xs font-semibold truncate">
                            <span className={invoiceCount > 0 ? 'text-primary' : 'text-on-surface-variant/50'}>{invoiceCount}</span>
                          </p>
                        </div>
                        <div className="rounded-lg bg-surface-container-low/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-semibold">Consumo anual</p>
                          <p className="text-xs font-semibold truncate">
                            {annualKwh > 0
                              ? <span className="text-success">{fmtKwh(annualKwh)}</span>
                              : <span className="text-on-surface-variant/50">—</span>}
                          </p>
                        </div>
                      </div>

                      {/* Address */}
                      {supply.address && (
                        <div className="pt-1 border-t border-outline-variant/10">
                          <p className="text-[10px] text-on-surface-variant truncate" title={supply.address}>
                            {supply.address}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ─── Subscription History ─── */}
        {client.subscriptions && client.subscriptions.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
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
                      <div className={`flex items-center gap-3 px-4 py-3 ${isCancelled ? 'bg-red-50/50' : isActive ? 'bg-emerald-50/50' : 'bg-amber-50/50'}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isCancelled ? 'bg-red-100' : isActive ? 'bg-emerald-100' : 'bg-amber-100'
                        }`}>
                          {isCancelled ? <XCircle className="w-4 h-4 text-red-500" /> :
                           isActive ? <Check className="w-4 h-4 text-emerald-600" /> :
                           <Clock className="w-4 h-4 text-amber-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${isCancelled ? 'text-red-700 line-through' : 'text-on-surface'}`}>
                              {planLabel}
                            </p>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                              isCancelled ? 'bg-red-100 text-red-600' :
                              isActive ? 'bg-emerald-100 text-emerald-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {isCancelled ? 'Cancelada' : isActive ? 'Activa' : 'Pendiente'}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant">
                            {sub.payment_mode === 'immediate' ? 'Pago unico' : 'Fraccionado (4 trim.)'} · {amountLabel}
                            {isCancelled && sub.cancelled_at && ` · Cancelada el ${formatDate(sub.cancelled_at)}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-on-surface-variant">Desde {formatDate(sub.start_date || sub.created_at)}</p>
                          {paidCount > 0 && (
                            <p className="text-xs font-medium text-secondary flex items-center gap-1 justify-end">
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
                              <tr className="text-on-surface-variant">
                                <th className="text-left py-1 font-medium">Fecha</th>
                                <th className="text-left py-1 font-medium">Concepto</th>
                                <th className="text-right py-1 font-medium">Total</th>
                                <th className="text-center py-1 font-medium">Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {subBillings.map((bill: any) => (
                                <tr key={bill.id} className="border-t border-surface-container-low/30">
                                  <td className="py-1.5 text-on-surface">{formatDate(bill.created_at)}</td>
                                  <td className="py-1.5 text-on-surface truncate max-w-[200px]">{bill.concept}</td>
                                  <td className="py-1.5 text-on-surface text-right font-medium">{formatCurrency(bill.total_amount)}</td>
                                  <td className="py-1.5 text-center">
                                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      bill.status === 'paid' ? 'bg-emerald-50 text-emerald-700' :
                                      bill.status === 'sent' ? 'bg-blue-50 text-blue-600' :
                                      bill.status === 'overdue' ? 'bg-red-50 text-red-600' :
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
                            <p className="text-[10px] text-on-surface-variant mt-1 text-right">Pendiente de cobro: {formatCurrency(totalPending)}</p>
                          )}
                        </div>
                      )}

                      {/* No payments message */}
                      {subBillings.length === 0 && (
                        <div className="px-4 py-2 border-t border-surface-container-low">
                          <p className="text-xs text-on-surface-variant italic">Sin pagos registrados</p>
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
    <div className="flex items-center justify-between p-3 bg-surface-container-low rounded-xl border border-outline-variant/10">
      <div className="flex items-center gap-2.5 min-w-0">
        <FileText className="w-4 h-4 text-on-surface-variant flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] text-on-surface-variant uppercase font-bold">{label}</p>
          <p className="text-sm font-medium truncate">{value || 'No disponible'}</p>
        </div>
      </div>
      {url && (
        <a 
          href={getViewUrl(url)} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition whitespace-nowrap"
        >
          <ExternalLink className="w-3.5 h-3.5" /> VER
        </a>
      )}
    </div>
  )
}
