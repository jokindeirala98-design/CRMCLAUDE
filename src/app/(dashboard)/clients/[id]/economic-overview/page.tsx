'use client'

/**
 * /clients/[id]/economic-overview
 *
 * Estudio económico global a nivel cliente: agrega todas las facturas
 * históricas de todos sus suministros y permite filtrar por modo de periodo
 * (últimas 12 facturas / año pasado / rango personalizado) y por tipo
 * (luz / gas / todos).
 *
 * Drill-down: clic en un suministro del ranking → navega a la ficha del
 * suministro con su tab AnnualEconomics abierto.
 */

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, AlertCircle, Zap, Flame,
  TrendingDown, Building2, Receipt, ChevronRight,
} from 'lucide-react'

type Mode = 'last12' | 'previous_year' | 'custom'
type TypeFilter = 'all' | 'luz' | 'gas'

interface RankingItem {
  supply: {
    id: string
    cups: string | null
    type: 'luz' | 'gas' | null
    tariff: string | null
    name: string | null
    address: string | null
    comercializadora: string | null
    consumoAnualKwh: number
  }
  invoicesCount: number
  windowFrom: string | null
  windowTo: string | null
  consumoAnualKwh: number
  totalGasto: number
  eurPorKwh: number
  sinFacturas: boolean
}

interface Monthly {
  year: number
  month: number
  totalLuz: number
  totalGas: number
  total: number
  kwhLuz: number
  kwhGas: number
  invoicesCount: number
}

interface Overview {
  client: { id: string; name: string; cif: string | null; type: string }
  mode: Mode
  windowDescription: string
  typeFilter: TypeFilter
  totals: {
    gastoTotal: number
    consumoTotalKwh: number
    eurPorKwhMedio: number
    suministrosCount: number
    suministrosConFacturas: number
    invoicesCount: number
    porTipo: {
      luz: { gasto: number; consumoAnualKwh: number; suministros: number }
      gas: { gasto: number; consumoAnualKwh: number; suministros: number }
    }
  }
  ranking: RankingItem[]
  monthly: Monthly[]
  porTarifa: Array<{ tarifa: string; suministros: number; gasto: number; consumoAnualKwh: number }>
}

const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const fmt = (n: number | null | undefined, d = 2): string => {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
}
const fmtEur = (n: number | null | undefined) => `${fmt(n, 2)} €`
const fmtKwh = (n: number | null | undefined) => `${fmt(n, 0)} kWh`
const fmtPct = (n: number) => `${fmt(n, 1)} %`

export default function EconomicOverviewPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = String(params?.id || '')

  const [mode, setMode] = useState<Mode>('last12')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────
  // En modo 'custom' esperamos a que el usuario rellene las dos fechas
  // antes de disparar la consulta al endpoint.
  const customReady = mode !== 'custom' || (from && to)

  useEffect(() => {
    if (!clientId) return
    if (!customReady) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    const qs = new URLSearchParams({ mode, type: typeFilter })
    if (mode === 'custom' && from && to) {
      qs.set('from', from)
      qs.set('to', to)
    }

    fetch(`/api/clients/${clientId}/economic-overview?${qs}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.error) throw new Error(json.error)
        setData(json)
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Error') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [clientId, mode, typeFilter, from, to, customReady])

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    )
  }

  // En modo custom sin fechas todavía mostramos la cabecera + selector de
  // periodo para que el usuario pueda introducir las fechas, no un error.
  if (!customReady && !data) {
    return (
      <CustomEmptyState
        clientId={clientId}
        mode={mode}
        setMode={setMode}
        from={from}
        to={to}
        setFrom={setFrom}
        setTo={setTo}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        router={router}
      />
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6 rounded-2xl border border-err/30 bg-err-container/40">
        <div className="flex items-center gap-3 text-err">
          <AlertCircle className="w-5 h-5" />
          <p>{error || 'No hay datos'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-ink font-sans">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-6 md:px-10 pt-8 pb-6 border-b border-line/60">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.push(`/clients/${clientId}`)}
            className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-ink-3 hover:text-brand transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver al cliente
          </button>
        </div>

        <div className="text-[10px] font-mono tracking-[0.22em] text-salvia uppercase mb-3">
          Estudio económico global
        </div>
        <h1 className="font-serif text-[2.5rem] md:text-[3.5rem] leading-[1.05] text-brand mb-2">
          {data.client.name}
        </h1>
        <p className="text-xs text-ink-3">
          {data.windowDescription} · {data.totals.suministrosCount} suministros
          {data.totals.suministrosConFacturas < data.totals.suministrosCount && (
            <span> ({data.totals.suministrosConFacturas} con facturas en el periodo)</span>
          )}
          {' · '}{data.totals.invoicesCount} facturas
        </p>
      </header>

      {/* ── Filtros ────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-10 mt-6 flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mr-2">Periodo</div>
        <ModeChip active={mode === 'last12'} onClick={() => setMode('last12')}>Últimas 12 facturas</ModeChip>
        <ModeChip active={mode === 'previous_year'} onClick={() => setMode('previous_year')}>Año pasado ({new Date().getFullYear() - 1})</ModeChip>
        <ModeChip active={mode === 'custom'} onClick={() => setMode('custom')}>Personalizado</ModeChip>
        {mode === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="px-2 py-1 text-xs rounded-lg bg-card border border-line font-mono" />
            <span className="text-ink-4">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="px-2 py-1 text-xs rounded-lg bg-card border border-line font-mono" />
          </div>
        )}

        <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 ml-6 mr-2">Tipo</div>
        <ModeChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Todos</ModeChip>
        <ModeChip active={typeFilter === 'luz'} onClick={() => setTypeFilter('luz')}><Zap className="w-3 h-3 inline mr-1" />Luz</ModeChip>
        <ModeChip active={typeFilter === 'gas'} onClick={() => setTypeFilter('gas')}><Flame className="w-3 h-3 inline mr-1" />Gas</ModeChip>
      </section>

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-10 mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard big label="Gasto total" value={fmt(data.totals.gastoTotal, 2)} unit="€" theme="brand" />
        <KpiCard label="Consumo anual" value={fmt(data.totals.consumoTotalKwh, 0)} unit="kWh" />
        <KpiCard label="€/kWh medio" value={fmt(data.totals.eurPorKwhMedio, 4)} unit="€/kWh" />
        <KpiCard label="Suministros" value={String(data.totals.suministrosCount)} unit="totales" />
      </section>

      {/* ── Desglose por tipo (consumo siempre SIPS/Excel, gasto del periodo) ── */}
      <section className="px-6 md:px-10 mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <TipoCard
          icon={<Zap className="w-4 h-4 text-info" />}
          label="Electricidad"
          gasto={data.totals.porTipo.luz.gasto}
          kwh={data.totals.porTipo.luz.consumoAnualKwh}
          count={data.totals.porTipo.luz.suministros}
          total={data.totals.gastoTotal}
        />
        <TipoCard
          icon={<Flame className="w-4 h-4 text-warn" />}
          label="Gas natural"
          gasto={data.totals.porTipo.gas.gasto}
          kwh={data.totals.porTipo.gas.consumoAnualKwh}
          count={data.totals.porTipo.gas.suministros}
          total={data.totals.gastoTotal}
        />
      </section>

      {/* ── Serie mensual (solo si hay >1 mes) ─────────────────────────── */}
      {data.monthly.length >= 2 && (
        <section className="px-6 md:px-10 mt-10">
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-[10px] tracking-[0.18em] font-mono text-salvia uppercase">01</span>
            <h2 className="font-serif text-2xl md:text-3xl text-brand">Evolución mensual</h2>
          </div>
          <MonthlyChart monthly={data.monthly} />
        </section>
      )}

      {/* ── Ranking ────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-10 mt-10">
        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-[10px] tracking-[0.18em] font-mono text-salvia uppercase">02</span>
          <h2 className="font-serif text-2xl md:text-3xl text-brand">Ranking de suministros</h2>
        </div>
        <p className="text-sm text-ink-3 mb-4">
          Clic en un suministro para ver su Anual Economics completo factura a factura.
        </p>

        <div className="rounded-2xl border border-line bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="py-3 px-4 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Suministro</th>
                <th className="py-3 px-4 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Tipo</th>
                <th className="py-3 px-4 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Tarifa</th>
                <th className="py-3 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Facturas</th>
                <th className="py-3 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Consumo</th>
                <th className="py-3 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">€/kWh</th>
                <th className="py-3 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Gasto total</th>
                <th className="py-3 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">% total</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {data.ranking.map((r) => {
                const pct = data.totals.gastoTotal > 0 ? (r.totalGasto / data.totals.gastoTotal) * 100 : 0
                const isGas = r.supply.type === 'gas'
                return (
                  <tr
                    key={r.supply.id}
                    onClick={() => router.push(`/supplies/${r.supply.id}?tab=economics`)}
                    className={`border-b border-line/40 last:border-b-0 cursor-pointer hover:bg-bg-2/40 transition group ${r.sinFacturas ? 'opacity-60' : ''}`}
                  >
                    <td className="py-3 px-4">
                      <div className="text-sm font-semibold text-ink">{r.supply.name || r.supply.cups || '—'}</div>
                      <div className="text-[10px] font-mono text-ink-3">{r.supply.cups || '—'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${isGas ? 'bg-warn-container/40 text-warn' : 'bg-info-container/40 text-info'}`}>
                        {isGas ? <Flame className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                        {isGas ? 'gas' : 'luz'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold text-ink">{r.supply.tariff || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono text-sm">
                      {r.sinFacturas ? <span className="text-ink-4 italic">sin facturas</span> : r.invoicesCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-sm">{fmtKwh(r.consumoAnualKwh)}</td>
                    <td className="py-3 px-4 text-right font-mono text-sm text-ink-3">{r.totalGasto > 0 ? fmt(r.eurPorKwh, 4) : '—'}</td>
                    <td className="py-3 px-4 text-right font-mono text-sm font-semibold text-brand">{r.totalGasto > 0 ? fmtEur(r.totalGasto) : '—'}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-ink-3">{r.totalGasto > 0 ? fmtPct(pct) : '—'}</td>
                    <td className="py-3 px-4 text-right">
                      <ChevronRight className="w-4 h-4 text-ink-3 group-hover:text-brand transition" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-brand/60 bg-bg-2/30">
                <td className="py-3 px-4 text-sm font-semibold" colSpan={4}>TOTAL</td>
                <td className="py-3 px-4 text-right font-mono text-sm font-semibold">{fmtKwh(data.totals.consumoTotalKwh)}</td>
                <td className="py-3 px-4 text-right font-mono text-sm font-semibold">{fmt(data.totals.eurPorKwhMedio, 4)}</td>
                <td className="py-3 px-4 text-right font-mono text-base font-bold text-brand">{fmtEur(data.totals.gastoTotal)}</td>
                <td className="py-3 px-4 text-right font-mono text-xs">100,0 %</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ── Por tarifa ─────────────────────────────────────────────────── */}
      {data.porTarifa.length > 1 && (
        <section className="px-6 md:px-10 mt-10">
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-[10px] tracking-[0.18em] font-mono text-salvia uppercase">03</span>
            <h2 className="font-serif text-2xl md:text-3xl text-brand">Reparto por tarifa</h2>
          </div>
          <div className="rounded-2xl border border-line bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-2 px-4 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Tarifa</th>
                  <th className="py-2 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Suministros</th>
                  <th className="py-2 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Consumo</th>
                  <th className="py-2 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Gasto total</th>
                  <th className="py-2 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">% del total</th>
                </tr>
              </thead>
              <tbody>
                {data.porTarifa.map(t => {
                  const pct = data.totals.gastoTotal > 0 ? (t.gasto / data.totals.gastoTotal) * 100 : 0
                  return (
                    <tr key={t.tarifa} className="border-b border-line/40 last:border-b-0">
                      <td className="py-2 px-4 text-sm font-semibold">{t.tarifa}</td>
                      <td className="py-2 px-4 text-right font-mono text-sm">{t.suministros}</td>
                      <td className="py-2 px-4 text-right font-mono text-sm">{fmtKwh(t.consumoAnualKwh)}</td>
                      <td className="py-2 px-4 text-right font-mono text-sm font-semibold">{fmtEur(t.gasto)}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs text-ink-3">{fmtPct(pct)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="px-6 md:px-10 py-8 mt-10 border-t border-line text-[11px] text-ink-3 flex items-center justify-between">
        <span className="font-mono tracking-wider uppercase">Voltis · Estudio económico global</span>
        <span className="font-mono">
          Generado {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      </footer>
    </div>
  )
}

// ── Sub-componentes ─────────────────────────────────────────────────────────

function ModeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl border text-xs font-mono transition ${
        active
          ? 'bg-brand text-volt border-brand'
          : 'bg-card text-ink border-line hover:border-brand/40'
      }`}
    >
      {children}
    </button>
  )
}

function KpiCard({ label, value, unit, theme, big }: {
  label: string; value: string; unit?: string; theme?: 'brand'; big?: boolean
}) {
  if (theme === 'brand') {
    return (
      <div className={`rounded-3xl bg-brand text-volt p-6 ${big ? 'md:col-span-2' : ''} relative overflow-hidden`}>
        <div className="absolute -bottom-12 -right-8 w-48 h-48 rounded-full bg-volt/10 blur-2xl pointer-events-none" />
        <div className="text-[10px] font-mono tracking-[0.22em] uppercase text-volt/70 mb-3">{label}</div>
        <div className="font-serif text-[3rem] md:text-[3.5rem] leading-none">
          {value} {unit && <span className="text-[1.5rem] text-volt/80">{unit}</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-3xl bg-card border border-line p-5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-2">{label}</div>
      <div className="font-serif text-2xl text-brand">
        {value} {unit && <span className="text-sm text-ink-3 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

function TipoCard({ icon, label, gasto, kwh, count, total }: {
  icon: React.ReactNode; label: string; gasto: number; kwh: number; count: number; total: number
}) {
  const pct = total > 0 ? (gasto / total) * 100 : 0
  return (
    <div className="rounded-2xl bg-card border border-line p-5">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-3">
        {icon}
        {label} · {count} suministros
      </div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-serif text-2xl text-brand">{fmtEur(gasto)}</div>
          <div className="text-xs text-ink-3 mt-1">{fmtKwh(kwh)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3">% del total</div>
          <div className="font-serif text-lg text-salvia">{fmtPct(pct)}</div>
        </div>
      </div>
      {/* barra horizontal */}
      <div className="mt-3 h-1.5 rounded-full bg-bg-2 overflow-hidden">
        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CustomEmptyState({
  clientId, mode, setMode, from, to, setFrom, setTo, typeFilter, setTypeFilter, router,
}: {
  clientId: string
  mode: Mode; setMode: (m: Mode) => void
  from: string; to: string; setFrom: (s: string) => void; setTo: (s: string) => void
  typeFilter: TypeFilter; setTypeFilter: (t: TypeFilter) => void
  router: ReturnType<typeof useRouter>
}) {
  return (
    <div className="min-h-screen bg-bg text-ink font-sans">
      <header className="px-6 md:px-10 pt-8 pb-6 border-b border-line/60">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.push(`/clients/${clientId}`)}
            className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-ink-3 hover:text-brand transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver al cliente
          </button>
        </div>
        <div className="text-[10px] font-mono tracking-[0.22em] text-salvia uppercase mb-3">
          Estudio económico global
        </div>
        <h1 className="font-serif text-[2.5rem] md:text-[3rem] leading-[1.05] text-brand mb-2">
          Selecciona un periodo
        </h1>
      </header>
      <section className="px-6 md:px-10 mt-6 flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mr-2">Periodo</div>
        <ModeChip active={mode === 'last12'} onClick={() => setMode('last12')}>Últimas 12 facturas</ModeChip>
        <ModeChip active={mode === 'previous_year'} onClick={() => setMode('previous_year')}>Año pasado ({new Date().getFullYear() - 1})</ModeChip>
        <ModeChip active={mode === 'custom'} onClick={() => setMode('custom')}>Personalizado</ModeChip>
        {mode === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="px-2 py-1 text-xs rounded-lg bg-card border border-line font-mono" />
            <span className="text-ink-4">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="px-2 py-1 text-xs rounded-lg bg-card border border-line font-mono" />
          </div>
        )}
        <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 ml-6 mr-2">Tipo</div>
        <ModeChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Todos</ModeChip>
        <ModeChip active={typeFilter === 'luz'} onClick={() => setTypeFilter('luz')}><Zap className="w-3 h-3 inline mr-1" />Luz</ModeChip>
        <ModeChip active={typeFilter === 'gas'} onClick={() => setTypeFilter('gas')}><Flame className="w-3 h-3 inline mr-1" />Gas</ModeChip>
      </section>
      <section className="px-6 md:px-10 mt-12 max-w-2xl">
        <div className="rounded-2xl border border-dashed border-line bg-card p-8 text-center">
          <p className="text-sm text-ink-3">
            Indica una fecha de inicio y otra de fin para ver el estudio económico del rango personalizado.
          </p>
        </div>
      </section>
    </div>
  )
}

function MonthlyChart({ monthly }: { monthly: Monthly[] }) {
  const max = Math.max(...monthly.map(m => m.total), 1)
  const w = 800
  const h = 240
  const pad = 30
  const xStep = monthly.length > 1 ? (w - 2 * pad) / (monthly.length - 1) : 0
  const yFor = (v: number) => h - pad - (v / max) * (h - 2 * pad)

  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Bars stacked (luz + gas) */}
          {monthly.map((m, i) => {
            const x = pad + i * xStep - 12
            const yLuz = yFor(m.totalLuz)
            const yGas = yFor(m.totalLuz + m.totalGas)
            const hLuz = (h - pad) - yLuz
            const hGas = yLuz - yGas
            return (
              <g key={i}>
                {m.totalGas > 0 && <rect x={x} y={yGas} width={24} height={hGas} fill="#E8B89A" />}
                {m.totalLuz > 0 && <rect x={x} y={yLuz} width={24} height={hLuz} fill="#6B8068" />}
                <text x={pad + i * xStep} y={h - 6} textAnchor="middle" className="font-mono" fontSize="9" fill="#5A6B5F">
                  {MESES_SHORT[m.month]} {String(m.year).slice(-2)}
                </text>
                <text x={pad + i * xStep} y={yFor(m.total) - 4} textAnchor="middle" className="font-mono" fontSize="9" fill="#2D3A33">
                  {m.total > 10000 ? `${Math.round(m.total / 1000)}k` : Math.round(m.total)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex items-center gap-4 mt-4 text-[11px] font-mono text-ink-3">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#6B8068' }} /> Electricidad</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#E8B89A' }} /> Gas</div>
      </div>
    </div>
  )
}
