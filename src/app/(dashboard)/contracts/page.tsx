'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, Plus, Search,
  Clock, Building2, User, Landmark,
  ChevronRight, Download, Check, RefreshCw,
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
    const porCobrar = contracts.filter(c => !c.paid).reduce((s, c) => s + (c.fee_amount ?? 0), 0)
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
          <div className="flex items-center gap-1 bg-card border border-line/40 rounded-xl p-1">
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
          <div className="flex items-center gap-1 bg-card border border-line/40 rounded-xl p-1">
            {([
              ['all', 'Todos'], ['draft', 'Borrador'], ['sent', 'Enviado'],
              ['signed', 'Firmado'], ['active', 'Activo'], ['expired', 'Expirado'],
            ] as const).map(([s, label]) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterStatus === s ? 'bg-brand text-white' : 'text-ink-3 hover:text-ink hover:bg-bg-2'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Paid filter */}
          <div className="flex items-center gap-1 bg-card border border-line/40 rounded-xl p-1">
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

              return (
                <div
                  key={sc.id}
                  className="rounded-2xl bg-card border border-line/40 hover:border-brand/20 transition-all group"
                >
                  {/* ── Desktop row (md+) ── */}
                  <div className="hidden md:flex items-center gap-3 px-4 py-3">

                    {/* Client icon + name */}
                    <div
                      className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                      onClick={() => cl?.id && router.push(`/clients/${cl.id}`)}
                    >
                      <div className="w-9 h-9 rounded-xl bg-bg-2 flex items-center justify-center flex-shrink-0">
                        <TypeIcon className="w-4 h-4 text-ink-3" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate group-hover:text-brand transition">{cl?.name ?? '—'}</p>
                        <p className="text-[10px] text-ink-3 truncate">{TYPE_LABEL[cl?.type] ?? cl?.type}</p>
                      </div>
                    </div>

                    {/* Ahorro total */}
                    <div className="flex flex-col items-end w-32 shrink-0 text-right">
                      <p className="text-[10px] text-ink-4 uppercase tracking-wide font-mono">Ahorro</p>
                      <p className="text-sm font-semibold text-ink">
                        {sc.ahorro_confirmado ? formatCurrency(sc.ahorro_confirmado) : '—'}
                      </p>
                    </div>

                    {/* Tarifa Voltis badge */}
                    <div className="flex items-center justify-center w-28 shrink-0">
                      <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-lg ${
                        sc.contract_type === 'porcentaje'
                          ? 'bg-volt/20 text-volt-ink'
                          : 'bg-info-container/30 text-info'
                      }`}>
                        {sc.contract_type === 'porcentaje' ? '25% ahorro' : 'Suscripción'}
                      </span>
                    </div>

                    {/* Cantidad (honorarios) */}
                    <div className="flex flex-col items-end w-28 shrink-0 text-right">
                      <p className="text-[10px] text-ink-4 uppercase tracking-wide font-mono">Honorarios</p>
                      <p className="text-sm font-bold text-brand">{fee > 0 ? formatCurrency(fee) : '—'}</p>
                    </div>

                    {/* Paid toggle */}
                    <div className="flex items-center justify-center w-28 shrink-0">
                      <button
                        onClick={() => togglePaid(sc)}
                        disabled={togglingId === sc.id}
                        title={sc.paid ? 'Marcar como pendiente' : 'Marcar como cobrado'}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                          sc.paid
                            ? 'bg-ok-container text-ok border-ok/20 hover:bg-ok/20'
                            : 'bg-bg-2 text-ink-3 border-line/40 hover:bg-warn-container hover:text-warn hover:border-warn/20'
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

                    {/* Descargar + nav */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={async () => { await genPropuesta(sc); setTimeout(() => genContrato(sc), 600) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand hover:text-white transition border border-brand/20"
                        title="Descargar propuesta y contrato"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar
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

                  {/* ── Mobile row ── */}
                  <div className="flex md:hidden flex-col px-4 py-3 gap-2.5">
                    {/* Top: icon + name + nav */}
                    <div className="flex items-center gap-3">
                      <div
                        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                        onClick={() => cl?.id && router.push(`/clients/${cl.id}`)}
                      >
                        <div className="w-8 h-8 rounded-xl bg-bg-2 flex items-center justify-center flex-shrink-0">
                          <TypeIcon className="w-3.5 h-3.5 text-ink-3" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink truncate">{cl?.name ?? '—'}</p>
                          <p className="text-[10px] text-ink-4 truncate">{TYPE_LABEL[cl?.type] ?? cl?.type}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink-4 flex-shrink-0" onClick={() => cl?.id && router.push(`/clients/${cl.id}`)} />
                    </div>

                    {/* Middle: stats row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {sc.ahorro_confirmado ? (
                        <div className="flex flex-col">
                          <span className="text-[9px] text-ink-4 uppercase tracking-wide font-mono">Ahorro</span>
                          <span className="text-xs font-semibold text-ink">{formatCurrency(sc.ahorro_confirmado)}</span>
                        </div>
                      ) : null}
                      <span className="text-ink-4 text-xs">·</span>
                      <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        sc.contract_type === 'porcentaje'
                          ? 'bg-volt/20 text-volt-ink'
                          : 'bg-info-container/30 text-info'
                      }`}>
                        {sc.contract_type === 'porcentaje' ? '25% ahorro' : 'Suscripción'}
                      </span>
                      {fee > 0 && (
                        <>
                          <span className="text-ink-4 text-xs">·</span>
                          <span className="text-xs font-bold text-brand">{formatCurrency(fee)}</span>
                        </>
                      )}
                    </div>

                    {/* Bottom: paid toggle + descargar */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => togglePaid(sc)}
                        disabled={togglingId === sc.id}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition border flex-1 justify-center ${
                          sc.paid
                            ? 'bg-ok-container text-ok border-ok/20'
                            : 'bg-bg-2 text-ink-3 border-line/40'
                        }`}
                      >
                        {togglingId === sc.id
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : sc.paid
                            ? <><Check className="w-3 h-3" /> Cobrado</>
                            : <><Clock className="w-3 h-3" /> Pendiente</>
                        }
                      </button>
                      <button
                        onClick={async () => { await genPropuesta(sc); setTimeout(() => genContrato(sc), 600) }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium bg-brand/10 text-brand border border-brand/20 flex-1 justify-center"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar
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
