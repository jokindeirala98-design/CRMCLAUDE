'use client'

/**
 * Inicio del portal v2 — cliente.
 *
 * Carga datos del endpoint /api/portal/v2/overview, aplica
 * `computarOverview` para obtener agregaciones, renderiza:
 *
 *   • Hero con saludo personalizado al cliente
 *   • Filtros de periodo / tipo
 *   • KPIs glass cobalto
 *   • BloqueLuz + BloqueGas con concentración por periodo
 *   • Top consumidores y Top gastadores
 *   • Banner de cobertura
 *
 * El diseño actual mantiene la estética cobalto pulida. Cuando Claude
 * Design devuelva mockups, sustituiremos esta versión sin tocar el
 * motor de datos.
 */
import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import {
  Loader2, AlertCircle, Zap, Flame, TrendingUp, Activity, BarChart3, Info,
  AlertTriangle,
} from 'lucide-react'
import { computarOverview, type OverviewMode } from '@/lib/economic-overview'

// ── Tipos ────────────────────────────────────────────────────────────────

type Mode = 'global' | 'year' | 'custom'
type TypeFilter = 'all' | 'luz' | 'gas'

interface RawDataset {
  client: { id: string; name: string; cif: string | null; type: string }
  supplies: any[]
  invoices: any[]
  portalUser: { id: string; email: string; displayName: string | null; role: string }
}

// ── Formatos ────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, d = 2): string => {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
}
const fmtEur = (n: number | null | undefined) => `${fmt(n, 2)} €`
const fmtKwh = (n: number | null | undefined) => `${fmt(n, 0)} kWh`
const fmtPct = (n: number) => `${fmt(n, 1)} %`

function formatGreetingName(name: string): string {
  if (!name) return 'cliente'
  const lower = ['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'para', 'por', 'a', 'al']
  return name
    .trim()
    .toLowerCase()
    .replace(/[,.]?\s*(s\.?l\.?u\.?|s\.?a\.?u?\.?|c\.?b\.?|s\.?coop)$/i, '')
    .split(/\s+/)
    .map((w, i) => (i === 0 || !lower.includes(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w)
    .join(' ')
}

// ── Página ───────────────────────────────────────────────────────────────

export function InicioClient({ email, displayName }: { email: string; displayName: string | null }) {
  const [raw, setRaw] = useState<RawDataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('global')
  const [yearSelected, setYearSelected] = useState<number | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  // Fetch de datos
  useEffect(() => {
    let cancel = false
    fetch('/api/portal/v2/overview', { credentials: 'same-origin' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error de carga')
        return r.json()
      })
      .then((data: RawDataset) => { if (!cancel) setRaw(data) })
      .catch(err => { if (!cancel) setError(err.message) })
    return () => { cancel = true }
  }, [])

  // Años disponibles
  const availableYears = useMemo(() => {
    if (!raw) return []
    const years = new Set<number>()
    for (const inv of raw.invoices) {
      const d = inv.period_end || inv.period_start
      if (d) years.add(new Date(d).getFullYear())
    }
    return Array.from(years).sort((a, b) => b - a)
  }, [raw])

  // Cómputo del overview en el cliente
  const data = useMemo(() => {
    if (!raw) return null
    const engineMode: OverviewMode = mode === 'global' || mode === 'year' ? 'custom' : 'custom'
    let from: string | undefined
    let to: string | undefined
    if (mode === 'year' && yearSelected) {
      from = `${yearSelected}-01-01`
      to = `${yearSelected}-12-31`
    } else if (mode === 'global') {
      from = '2000-01-01'
      to = '2099-12-31'
    }
    return computarOverview({
      supplies: raw.supplies,
      invoices: raw.invoices,
      mode: engineMode,
      from, to,
      typeFilter,
    })
  }, [raw, mode, yearSelected, typeFilter])

  // ── Estados de carga / error ─────────────────────────────────────────
  if (error) {
    return (
      <div className="voltis-glass max-w-xl mx-auto mt-12 p-6 flex items-start gap-3 text-white">
        <AlertCircle className="w-5 h-5 text-red-300 mt-0.5" />
        <div>
          <div className="font-semibold mb-1">No hemos podido cargar tus datos</div>
          <p className="text-sm text-white/75">{error}</p>
        </div>
      </div>
    )
  }
  if (!raw || !data) return <SkeletonInicio />

  const friendlyName = formatGreetingName(displayName || raw.client.name)

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Hero */}
      <header className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
        <div className="relative w-28 h-28">
          <Image src="/mascota-transparente.png" alt="Voltis" width={112} height={112} priority />
        </div>
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] text-white voltis-glass-soft mb-3">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#7fffb9', boxShadow: '0 0 8px #7fffb9' }} />
            Tu portal energético · en vivo
          </div>
          <h1 className="text-[28px] md:text-[36px] font-semibold leading-[1.06] text-white" style={{ letterSpacing: '-0.02em' }}>
            {raw.client.name}
          </h1>
          <p className="mt-2 text-[12px] md:text-[13px] text-white/75">
            Estudio económico global ·{' '}
            <span className="text-white font-semibold">{data.totals.suministrosCount} suministros</span> ·{' '}
            <span className="text-white font-semibold">{data.totals.invoicesCount} facturas</span> analizadas
          </p>
        </div>
      </header>

      {/* Filtros */}
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold tracking-[0.18em] text-white/65 uppercase mr-2">Periodo</span>
        <Chip active={mode === 'global'} onClick={() => { setMode('global'); setYearSelected(null) }}>Global</Chip>
        {availableYears.map(yr => (
          <Chip key={yr} active={mode === 'year' && yearSelected === yr}
            onClick={() => { setMode('year'); setYearSelected(yr) }}>{yr}</Chip>
        ))}
        <span className="text-[10px] font-bold tracking-[0.18em] text-white/65 uppercase ml-4 mr-2">Tipo</span>
        <Chip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Todos</Chip>
        <Chip active={typeFilter === 'luz'} onClick={() => setTypeFilter('luz')}><Zap className="w-3 h-3 inline mr-1" />Luz</Chip>
        <Chip active={typeFilter === 'gas'} onClick={() => setTypeFilter('gas')}><Flame className="w-3 h-3 inline mr-1" />Gas</Chip>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi highlight icon={<TrendingUp className="w-4 h-4" />} label="Gasto total del periodo"
          value={fmt(data.totals.gastoTotal, 2)} unit="€"
          hint={data.totals.gastoAnualizado > data.totals.gastoTotal * 1.05
            ? `Anualizado: ${fmt(data.totals.gastoAnualizado, 0)} €/año` : undefined} />
        <Kpi icon={<Activity className="w-4 h-4" />} label="Consumo anual oficial"
          value={fmt(data.totals.consumoTotalKwh, 0)} unit="kWh"
          hint={`Cobertura facturas: ${fmtPct(data.totals.coberturaFacturasPct)}`} />
        <Kpi icon={<BarChart3 className="w-4 h-4" />} label="Suministros activos"
          value={String(data.totals.suministrosCount)} unit="totales"
          hint={`${data.totals.suministrosConFacturas} con facturas en el periodo`} />
      </section>

      {/* Cobertura */}
      <CoberturaBanner totals={data.totals} fechaSips={data.fechaSipsMasReciente} />

      {/* Bloques por tipo */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BloqueLuz luz={data.totals.porTipo.luz} concentracion={data.concentracionPeriodos} />
        <BloqueGas gas={data.totals.porTipo.gas} />
      </section>

      {/* Top consumidores / gastadores */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TopCard title="Top consumidores" subtitle="Mayor consumo anual" icon={<Zap className="w-4 h-4" />}
          items={data.topConsumidores} metric="consumo" />
        <TopCard title="Top gastadores" subtitle="Mayor gasto en el periodo" icon={<TrendingUp className="w-4 h-4" />}
          items={data.topGastadores} metric="gasto" />
      </section>

      {/* Saludo de pie */}
      <p className="text-[11px] text-white/45 max-w-2xl">
        Conectado como <span className="text-white/70">{email}</span> ·{' '}
        Los datos se actualizan automáticamente cada vez que llega una nueva factura.
      </p>
    </div>
  )
}

// ── Componentes ─────────────────────────────────────────────────────────

function Chip({ active, onClick, children }: any) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition
        ${active ? 'bg-white text-[#0A2061] shadow-md' : 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm'}`}>
      {children}
    </button>
  )
}

function Kpi({ icon, label, value, unit, hint, highlight = false }: any) {
  return (
    <div className="voltis-glass p-5 relative overflow-hidden" style={highlight ? {
      boxShadow: 'inset 0 0 0 1px rgba(218,180,90,0.55), inset 0 1px 0 rgba(255,255,255,0.30), 0 18px 40px -18px rgba(10,20,60,0.55)',
    } : undefined}>
      <div className="absolute inset-x-0 top-0 h-2/5 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
      <div className="relative flex items-center gap-2 mb-3 text-[#B9D1FF]">
        {icon}
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase">{label}</div>
      </div>
      <div className="relative flex items-baseline gap-2">
        <span className="text-[34px] font-bold num leading-none text-white">{value}</span>
        {unit && <span className="text-sm font-medium text-[#B9D1FF]">{unit}</span>}
      </div>
      {hint && <div className="relative text-[11px] mt-2 text-white/70">{hint}</div>}
    </div>
  )
}

function CoberturaBanner({ totals, fechaSips }: any) {
  const cobertura = totals.coberturaFacturasPct
  const sinFacturas = totals.suministrosSinConsumo > 0
  return (
    <div className="voltis-glass-soft px-4 py-3 flex items-start gap-3">
      <Info className="w-4 h-4 flex-shrink-0 text-[#B9D1FF] mt-0.5" />
      <div className="flex-1 text-xs text-white/80 leading-relaxed">
        <span className="font-semibold text-white">Cobertura {fmtPct(cobertura)}.</span>{' '}
        Las facturas analizadas cubren <span className="num">{fmt(totals.consumoFacturadoTotalKwh, 0)}</span> kWh
        de los <span className="num">{fmt(totals.consumoTotalKwh, 0)}</span> kWh anuales totales según SIPS/distribuidora.
        {fechaSips && <> Datos oficiales actualizados a {new Date(fechaSips).toLocaleDateString('es-ES')}.</>}
        {sinFacturas && <> {totals.suministrosSinConsumo} suministros aún sin consumo SIPS registrado.</>}
      </div>
    </div>
  )
}

function BloqueLuz({ luz, concentracion }: any) {
  if (luz.suministros === 0) return null
  const periodos = [
    { k: 'P1', lbl: 'Punta', color: '#FBBF24' },
    { k: 'P2', lbl: 'Llano', color: '#A78BFA' },
    { k: 'P3', lbl: 'Valle', color: '#34D399' },
    { k: 'P4', lbl: 'P4', color: '#FB7185' },
    { k: 'P5', lbl: 'P5', color: '#60A5FA' },
    { k: 'P6', lbl: 'Supervalle', color: '#22C55E' },
  ]
  const totalP = Object.values<number>(luz.consumoPorPeriodo).reduce((s, v) => s + v, 0) || 1
  return (
    <div className="voltis-glass p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(254,243,199,0.18)', color: '#FBBF24' }}><Zap className="w-5 h-5" /></div>
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">Electricidad</div>
          <h3 className="text-xl font-bold text-white">{luz.suministros} suministros</h3>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MiniKpi label="Gasto" value={fmtEur(luz.gasto)} />
        <MiniKpi label="Consumo anual" value={fmtKwh(luz.consumoAnualKwh)} />
        <MiniKpi label="€/kWh medio" value={fmt(luz.eurPorKwhMedio, 4)} unit="€/kWh" />
      </div>
      {totalP > 1 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">Concentración por periodo</div>
            <div className="text-xs text-white/75">
              Dominante: <strong className="text-white">{concentracion.dominante}</strong> · {fmtPct(concentracion.dominantePct)}
            </div>
          </div>
          <div className="flex h-7 rounded-lg overflow-hidden">
            {periodos.map(p => {
              const pct = ((luz.consumoPorPeriodo as any)[p.k] / totalP) * 100
              if (pct < 0.5) return null
              return (
                <div key={p.k} style={{ width: `${pct}%`, background: p.color }}
                  className="flex items-center justify-center text-[10px] font-bold text-white"
                  title={`${p.k} ${p.lbl}: ${fmtPct(pct)}`}>
                  {pct > 8 ? `${p.k} ${pct.toFixed(0)}%` : ''}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function BloqueGas({ gas }: any) {
  if (gas.suministros === 0) return null
  return (
    <div className="voltis-glass p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(255,237,213,0.18)', color: '#FB923C' }}><Flame className="w-5 h-5" /></div>
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">Gas natural</div>
          <h3 className="text-xl font-bold text-white">{gas.suministros} suministros</h3>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MiniKpi label="Gasto" value={fmtEur(gas.gasto)} />
        <MiniKpi label="Consumo anual" value={fmtKwh(gas.consumoAnualKwh)} />
        <MiniKpi label="€/kWh medio" value={fmt(gas.eurPorKwhMedio, 4)} unit="€/kWh" />
      </div>
      <div className="voltis-glass-soft p-3 text-xs text-white/80 leading-relaxed">
        Consumo anual oficial del Excel ConsumoAnual de la distribuidora. El único concepto competitivo es el{' '}
        <strong className="text-white">TV Precio Fijo (€/kWh)</strong> — término fijo, peaje, IEH y alquileres son regulados.
      </div>
    </div>
  )
}

function MiniKpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="voltis-glass-soft p-3">
      <div className="text-[10px] font-bold tracking-wider uppercase text-[#B9D1FF] mb-1">{label}</div>
      <div className="text-base font-bold num text-white">
        {value} {unit && <span className="text-xs font-medium text-[#B9D1FF]">{unit}</span>}
      </div>
    </div>
  )
}

function TopCard({ title, subtitle, icon, items, metric }: any) {
  if (!items?.length) return null
  return (
    <div className="voltis-glass p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="rounded-xl p-2 text-[#B9D1FF]" style={{ background: 'rgba(185,209,255,0.15)' }}>{icon}</div>
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">{title}</div>
          <div className="text-sm font-semibold text-white">{subtitle}</div>
        </div>
      </div>
      <div className="space-y-1">
        {items.slice(0, 5).map((r: any, i: number) => {
          const name = r.supply.name || `Suministro ${(r.supply.cups || '').slice(-4) || ''}`
          return (
            <div key={r.supply.id} className="w-full flex items-center gap-3 p-3 rounded-xl">
              <div className="text-xs font-bold text-[#B9D1FF] w-6">#{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{name}</div>
                <div className="text-[10px] num text-white/65">{r.supply.cups} · {r.supply.tariff}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold num text-white">
                  {metric === 'consumo' ? fmt(r.consumoAnualKwh, 0) : fmt(r.totalGasto, 2)}
                </div>
                <div className="text-[10px] text-[#B9D1FF]">{metric === 'consumo' ? 'kWh/año' : '€'}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SkeletonInicio() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-6">
        <div className="w-28 h-28 rounded-full voltis-glass-soft animate-pulse" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-32 voltis-glass-soft rounded animate-pulse" />
          <div className="h-8 w-3/4 voltis-glass-soft rounded animate-pulse" />
          <div className="h-3 w-1/2 voltis-glass-soft rounded animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <div key={i} className="h-32 voltis-glass animate-pulse" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[0, 1].map(i => <div key={i} className="h-64 voltis-glass animate-pulse" />)}
      </div>
    </div>
  )
}
