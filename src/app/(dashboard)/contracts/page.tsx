'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, Plus, Search, Zap, Euro, TrendingUp,
  CheckCircle2, Clock, Building2, User, Landmark,
  ChevronRight, Printer, Check, X, RefreshCw,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { NewContractModal } from '@/components/modals/NewContractModal'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatCurrency } from '@/lib/utils/format'
import { generatePropuestaHTML, generateContratoHTML, generateAndDownloadPDF } from '@/lib/voltis-contract-templates'

// ── helpers ───────────────────────────────────────────────────────────────────

function addM(date: Date, months: number) {
  const d = new Date(date); d.setMonth(d.getMonth() + months); return d
}

function buildSched(modality: string, fee: number, start: Date) {
  switch (modality) {
    case 'A': return [{ label: 'Pago único', date: start, amount: fee }]
    case 'B': { const q = fee / 4; return [1,2,3,4].map(i => ({ label: `Cuota T${i}`, date: addM(start, i*3), amount: q, isPast: addM(start, i*3) < new Date() })) }
    case 'C': { const half = fee / 2; const q4 = half / 4; return [{ label: 'Entrada 50%', date: start, amount: half }, ...[1,2,3,4].map(i => ({ label: `Cuota T${i}`, date: addM(start, i*3), amount: q4, isPast: addM(start, i*3) < new Date() }))] }
    case 'D': return [{ label: 'Pago al vencimiento', date: addM(start, 12), amount: fee }]
    default:  return [{ label: 'Pago único', date: start, amount: fee }]
  }
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador', sent: 'Enviado', signed: 'Firmado', active: 'Activo', expired: 'Expirado',
}
const STATUS_COLORS: Record<string, string> = {
  draft:   'bg-bg-2 text-ink-3',
  sent:    'bg-info-container/30 text-info',
  signed:  'bg-success/15 text-success',
  active:  'bg-brand/10 text-brand',
  expired: 'bg-warn-container/30 text-warn',
}
const MODALITY_SHORT: Record<string, string> = {
  A: 'Único inicio', B: 'Trimestral ×4', C: '50% + 4 cuotas', D: 'Único fin',
}
const TYPE_ICON: Record<string, any> = {
  ayuntamiento: Landmark, empresa: Building2, particular: User,
}
const TYPE_LABEL: Record<string, string> = {
  ayuntamiento: 'Ayuntamiento', empresa: 'Empresa', particular: 'Particular / Autónomo',
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ContractsPage() {
  const router = useRouter()
  const [contracts, setContracts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'ayuntamiento' | 'empresa' | 'particular'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'sent' | 'signed' | 'active' | 'expired'>('all')
  const [filterPaid, setFilterPaid] = useState<'all' | 'paid' | 'pending'>('all')

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('service_contracts')
      .select(`
        id, contract_type, is_renewal, ahorro_confirmado, fee_amount,
        subscription_monthly, payment_modality, start_date, end_date,
        status, paid, paid_at, proposal_url, contract_url, created_at,
        representative_name, representative_nif, signing_location,
        client:clients(id, name, type, cif_nif, cif, nif, fiscal_address)
      `)
      .order('created_at', { ascending: false })
    setContracts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchContracts() }, [fetchContracts])

  // Toggle paid
  const togglePaid = async (sc: any) => {
    setTogglingId(sc.id)
    const supabase = createClient()
    const newPaid = !sc.paid
    await supabase
      .from('service_contracts')
      .update({ paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null })
      .eq('id', sc.id)
    setContracts(prev => prev.map(c => c.id === sc.id ? { ...c, paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null } : c))
    setTogglingId(null)
  }

  // Filtered list
  const filtered = useMemo(() => {
    return contracts.filter(sc => {
      const cl = sc.client
      if (filterType !== 'all') {
        const t = cl?.type ?? ''
        if (filterType === 'particular' && !['particular', 'autonomo'].includes(t)) return false
        if (filterType === 'ayuntamiento' && t !== 'ayuntamiento') return false
        if (filterType === 'empresa' && !['empresa'].includes(t)) return false
      }
      if (filterStatus !== 'all' && sc.status !== filterStatus) return false
      if (filterPaid === 'paid' && !sc.paid) return false
      if (filterPaid === 'pending' && sc.paid) return false
      if (search) {
        const q = search.toLowerCase()
        if (!cl?.name?.toLowerCase().includes(q) && !cl?.cif_nif?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [contracts, filterType, filterStatus, filterPaid, search])

  // Stats (over ALL contracts, not filtered)
  const stats = useMemo(() => {
    const active = contracts.filter(c => c.status !== 'draft')
    const totalAhorro = contracts.reduce((s, c) => s + (c.ahorro_confirmado ?? 0), 0)
    const totalFee = contracts.reduce((s, c) => s + (c.fee_amount ?? (c.subscription_monthly ?? 0) * 12), 0)
    const cobrado = contracts.filter(c => c.paid).reduce((s, c) => s + (c.fee_amount ?? 0), 0)
    const porCobrar = contracts.filter(c => !c.paid && c.status !== 'draft').reduce((s, c) => s + (c.fee_amount ?? 0), 0)
    return { total: contracts.length, active: active.length, totalAhorro, totalFee, cobrado, porCobrar }
  }, [contracts])

  // PDF generators
  const genPropuesta = async (sc: any) => {
    const cl = sc.client
    const isNatural = ['particular', 'autonomo'].includes(cl?.type)
    const start = sc.start_date ? new Date(sc.start_date) : new Date()
    const end = sc.end_date ? new Date(sc.end_date) : addM(start, 12)
    const repName = isNatural ? cl?.name : sc.representative_name
    const html = generatePropuestaHTML({
      clientName: cl?.name ?? '',
      representativeName: repName ?? '',
      ahorroConfirmado: sc.ahorro_confirmado || null,
      feeAmount: sc.fee_amount ?? 0,
      startDate: start, endDate: end,
      contractType: sc.contract_type,
    })
    await generateAndDownloadPDF(html, `Propuesta_Voltis_${cl?.name ?? 'cliente'}.pdf`)
  }

  const genContrato = async (sc: any) => {
    const cl = sc.client
    const isNatural = ['particular', 'autonomo'].includes(cl?.type)
    const start = sc.start_date ? new Date(sc.start_date) : new Date()
    const end = sc.end_date ? new Date(sc.end_date) : addM(start, 12)
    const firstPay = new Date(start); firstPay.setDate(firstPay.getDate() + 15)
    const repName = isNatural ? cl?.name : sc.representative_name
    const repNif = isNatural ? (cl?.nif ?? cl?.cif_nif ?? '') : sc.representative_nif
    const fee = sc.fee_amount ?? 0
    const html = generateContratoHTML({
      clientName: cl?.name ?? '',
      clientCif: cl?.cif ?? cl?.cif_nif ?? '',
      clientFiscalAddress: cl?.fiscal_address ?? '',
      representativeName: repName ?? '',
      representativeNif: repNif ?? '',
      signingLocation: sc.signing_location ?? '',
      startDate: start, endDate: end, firstPaymentDate: firstPay,
      ahorroConfirmado: sc.ahorro_confirmado || null,
      feeAmount: fee,
      contractType: sc.contract_type,
      paymentModality: sc.payment_modality,
      paymentSchedule: buildSched(sc.payment_modality, fee, start),
      isNatural,
    })
    await generateAndDownloadPDF(html, `Contrato_Voltis_${cl?.name ?? 'cliente'}.pdf`)
  }

  return (
    <div>
      <Header
        title="Contratos Voltis"
        subtitle="Gestión de contratos de servicio y honorarios"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nuevo Contrato
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-10 space-y-6">

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-card border border-line-2-variant/10 p-4">
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">Contratos</p>
            <p className="text-3xl font-bold text-ink">{stats.total}</p>
            <p className="text-[10px] text-ink-3 mt-0.5">{stats.active} activos</p>
          </div>
          <div className="rounded-2xl bg-card border border-line-2-variant/10 p-4">
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">Ahorro acumulado</p>
            <p className="text-2xl font-bold text-ink">{formatCurrency(stats.totalAhorro)}</p>
            <p className="text-[10px] text-ink-3 mt-0.5">para tus clientes</p>
          </div>
          <div className="rounded-2xl bg-card border border-line-2-variant/10 p-4">
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">Por cobrar</p>
            <p className="text-2xl font-bold text-warn">{formatCurrency(stats.porCobrar)}</p>
            <p className="text-[10px] text-ink-3 mt-0.5">honorarios pendientes</p>
          </div>
          <div className="rounded-2xl bg-card border border-line-2-variant/10 p-4">
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">Cobrado</p>
            <p className="text-2xl font-bold text-success">{formatCurrency(stats.cobrado)}</p>
            <p className="text-[10px] text-ink-3 mt-0.5">honorarios recibidos</p>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
            <input
              type="text"
              placeholder="Buscar cliente…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-line-2-variant/20 bg-card text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-brand/40 transition"
            />
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1 bg-card border border-line-2-variant/10 rounded-xl p-1">
            {(['all', 'ayuntamiento', 'empresa', 'particular'] as const).map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterType === t ? 'bg-brand text-white' : 'text-ink-3 hover:text-ink hover:bg-bg-2'}`}
              >
                {t === 'all' ? 'Todos' : t === 'ayuntamiento' ? 'Ayuntamientos' : t === 'empresa' ? 'Empresas' : 'Particulares'}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 bg-card border border-line-2-variant/10 rounded-xl p-1">
            {(['all', 'draft', 'sent', 'signed', 'active', 'expired'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterStatus === s ? 'bg-brand text-white' : 'text-ink-3 hover:text-ink hover:bg-bg-2'}`}
              >
                {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Paid filter */}
          <div className="flex items-center gap-1 bg-card border border-line-2-variant/10 rounded-xl p-1">
            {(['all', 'paid', 'pending'] as const).map(p => (
              <button
                key={p}
                onClick={() => setFilterPaid(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterPaid === p ? 'bg-brand text-white' : 'text-ink-3 hover:text-ink hover:bg-bg-2'}`}
              >
                {p === 'all' ? 'Todos' : p === 'paid' ? '✓ Cobrado' : '⏳ Por cobrar'}
              </button>
            ))}
          </div>

          {loading && <RefreshCw className="w-4 h-4 text-ink-3 animate-spin" />}
        </div>

        {/* ── Results count ── */}
        {!loading && (
          <p className="text-xs text-ink-3">
            {filtered.length} contrato{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* ── Contract list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-ink-3">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-ink-3">
            <FileText className="w-10 h-10 opacity-20" />
            <p className="text-sm">
              {contracts.length === 0
                ? 'No hay contratos todavía. Genera el primero desde la ficha de un cliente.'
                : 'Ningún contrato coincide con los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(sc => {
              const cl = sc.client
              const TypeIcon = TYPE_ICON[cl?.type] ?? User
              const fee = sc.fee_amount ?? (sc.subscription_monthly ? sc.subscription_monthly * 12 : 0)
              const isNatural = ['particular', 'autonomo'].includes(cl?.type)

              return (
                <div
                  key={sc.id}
                  className="rounded-2xl bg-card border border-line-2-variant/10 hover:border-brand/20 transition-all group"
                >
                  <div className="flex items-center gap-0 p-4">

                    {/* Client info */}
                    <div
                      className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                      onClick={() => cl?.id && router.push(`/clients/${cl.id}`)}
                    >
                      <div className="w-9 h-9 rounded-xl bg-bg-2 flex items-center justify-center flex-shrink-0">
                        <TypeIcon className="w-4 h-4 text-ink-3" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate group-hover:text-brand transition">{cl?.name ?? '—'}</p>
                        <p className="text-[10px] text-ink-3 truncate">{TYPE_LABEL[cl?.type] ?? cl?.type} · {cl?.cif_nif ?? cl?.cif ?? '—'}</p>
                      </div>
                    </div>

                    {/* Contract type */}
                    <div className="hidden lg:flex flex-col items-start w-28 shrink-0">
                      <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${sc.contract_type === 'porcentaje' ? 'bg-accent-soft text-accent-ink' : 'bg-info-container/20 text-info'}`}>
                        {sc.contract_type === 'porcentaje' ? '25% ahorro' : 'Suscripción'}
                      </span>
                      {sc.is_renewal && (
                        <span className="text-[9px] text-ink-3 mt-0.5">Renovación</span>
                      )}
                    </div>

                    {/* Ahorro + Fee */}
                    <div className="hidden md:flex flex-col items-end w-36 shrink-0 text-right">
                      {sc.ahorro_confirmado ? (
                        <>
                          <p className="text-xs text-ink-3">Ahorro</p>
                          <p className="text-sm font-semibold text-ink">{formatCurrency(sc.ahorro_confirmado)}</p>
                        </>
                      ) : null}
                      {fee > 0 && (
                        <p className="text-sm font-bold text-brand">{formatCurrency(fee)}</p>
                      )}
                    </div>

                    {/* Modality + dates */}
                    <div className="hidden xl:flex flex-col items-start w-36 shrink-0 pl-4">
                      {sc.payment_modality && (
                        <p className="text-[10px] text-ink-3">{MODALITY_SHORT[sc.payment_modality]}</p>
                      )}
                      {sc.start_date && (
                        <p className="text-[10px] text-ink-3">
                          {formatDate(sc.start_date)}
                          {sc.end_date && ` → ${formatDate(sc.end_date)}`}
                        </p>
                      )}
                    </div>

                    {/* Status */}
                    <div className="hidden sm:flex items-center justify-center w-24 shrink-0">
                      <span className={`text-[10px] font-medium px-2 py-1 rounded-lg ${STATUS_COLORS[sc.status] ?? 'bg-bg-2 text-ink-3'}`}>
                        {STATUS_LABELS[sc.status] ?? sc.status}
                      </span>
                    </div>

                    {/* Paid toggle */}
                    <div className="flex items-center justify-center w-24 shrink-0">
                      <button
                        onClick={() => togglePaid(sc)}
                        disabled={togglingId === sc.id}
                        title={sc.paid ? 'Marcar como pendiente' : 'Marcar como cobrado'}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                          sc.paid
                            ? 'bg-success/10 text-success border-success/20 hover:bg-success/20'
                            : 'bg-bg-2 text-ink-3 border-line-2-variant/20 hover:bg-warn/10 hover:text-warn hover:border-warn/20'
                        }`}
                      >
                        {togglingId === sc.id
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : sc.paid
                            ? <><Check className="w-3 h-3" /> Cobrado</>
                            : <><Clock className="w-3 h-3" /> Pendiente</>
                        }
                      </button>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 pl-2 shrink-0">
                      <button
                        onClick={() => genPropuesta(sc)}
                        className="p-2 rounded-lg text-ink-3 hover:text-brand hover:bg-brand/10 transition"
                        title="Generar propuesta PDF"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => genContrato(sc)}
                        className="p-2 rounded-lg text-ink-3 hover:text-brand hover:bg-brand/10 transition"
                        title="Generar contrato PDF"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => cl?.id && router.push(`/clients/${cl.id}`)}
                        className="p-2 rounded-lg text-ink-3 hover:text-ink hover:bg-bg-2 transition"
                        title="Ver ficha del cliente"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <NewContractModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={fetchContracts}
      />
    </div>
  )
}
