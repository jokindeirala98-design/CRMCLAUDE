'use client'

/**
 * Portal v2 — Ahorros (comparación directa Voltis vs comercializadora anterior).
 *
 * Para cada mes en el que existe factura Voltis, comparamos contra la
 * factura del MISMO mes del año anterior (cuando existe). UX estilo
 * AnualEconomics: lista de meses con checkbox, total acumulado se
 * recalcula al vuelo.
 */
import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { AlertCircle, TrendingDown, Zap, Flame, CheckSquare, Square, MinusSquare } from 'lucide-react'

interface MatchPrior {
  id: string; total: number; consumoKwh: number
  periodStart: string | null; periodEnd: string | null; sourceLabel: string
}
interface MonthlyMatch {
  month: string; monthLabel: string; year: number; monthIdx: number
  supplyId: string
  supplyName: string | null
  supplyCups: string | null
  supplyType: 'luz' | 'gas'
  voltis: { id: string; total: number; consumoKwh: number; periodStart: string | null; periodEnd: string | null }
  prior?: MatchPrior
  ahorro?: number
  noPriorReason?: string
}
interface SavingsResponse {
  empty: boolean
  reason?: string
  matches?: MonthlyMatch[]
  totals?: {
    totalVoltis: number; totalPrior: number; ahorroTotal: number; ahorroPct: number
    mesesComparables: number; mesesSinComparar: number
  }
}

const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = (n: number) => `${fmt(n, 2)} €`

export function AhorrosClient() {
  const [data, setData] = useState<SavingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<'all' | 'luz' | 'gas'>('all')

  useEffect(() => {
    fetch('/api/portal/v2/savings', { credentials: 'same-origin' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error')
        return r.json()
      })
      .then((d: SavingsResponse) => {
        setData(d)
        // Por defecto, seleccionamos TODOS los meses con comparativa
        if (d.matches) {
          const init = new Set<string>()
          for (const m of d.matches) if (m.ahorro !== undefined) init.add(matchKey(m))
          setSelectedMonths(init)
        }
      })
      .catch(e => setError(e.message))
  }, [])

  const filteredMatches = useMemo(() => {
    if (!data?.matches) return []
    if (typeFilter === 'all') return data.matches
    return data.matches.filter(m => m.supplyType === typeFilter)
  }, [data, typeFilter])

  const totals = useMemo(() => {
    let voltis = 0, prior = 0, count = 0
    for (const m of filteredMatches) {
      if (m.ahorro === undefined) continue
      if (!selectedMonths.has(matchKey(m))) continue
      voltis += m.voltis.total
      prior += m.prior?.total || 0
      count++
    }
    const ahorro = prior - voltis
    const pct = prior > 0 ? (ahorro / prior) * 100 : 0
    return { voltis, prior, ahorro, pct, count }
  }, [filteredMatches, selectedMonths])

  if (error) {
    return (
      <div className="voltis-glass max-w-xl p-6 flex items-start gap-3 text-white">
        <AlertCircle className="w-5 h-5 text-red-300 mt-0.5" />
        <div>
          <div className="font-semibold mb-1">No hemos podido cargar tus ahorros</div>
          <p className="text-sm text-white/75">{error}</p>
        </div>
      </div>
    )
  }
  if (!data) return <Skeleton />

  if (data.empty) {
    return (
      <div className="voltis-glass max-w-2xl p-8 md:p-10 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
        <div className="relative flex items-start gap-5 mb-4">
          <div className="relative w-16 h-16 shrink-0">
            <Image src="/mascota-transparente.png" alt="Voltis" width={64} height={64} />
          </div>
          <div>
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">Ahorro acumulado</div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white" style={{ letterSpacing: '-0.02em' }}>
              Aún sin facturas Voltis
            </h1>
          </div>
        </div>
        <p className="relative text-sm text-white/80 leading-relaxed">{data.reason}</p>
      </div>
    )
  }

  const matches = filteredMatches
  const matchesByType = {
    luz: matches.filter(m => m.supplyType === 'luz').length,
    gas: matches.filter(m => m.supplyType === 'gas').length,
  }
  const totalsApi = data.totals!

  return (
    <div className="space-y-7">
      {/* Hero */}
      <header className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
        <div className="relative w-24 h-24">
          <Image src="/mascota-transparente.png" alt="Voltis" width={96} height={96} priority />
        </div>
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] text-white voltis-glass-soft mb-3">
            <TrendingDown className="w-3 h-3 text-[#7fffb9]" />
            Ahorro acumulado · en vivo
          </div>
          <h1 className="text-[28px] md:text-[36px] font-semibold leading-[1.06] text-white" style={{ letterSpacing: '-0.02em' }}>
            Tu ahorro con Voltis, mes a mes
          </h1>
          <p className="mt-2 text-sm text-white/75 max-w-2xl">
            Comparamos cada factura Voltis con la del mismo mes del año anterior.
            Selecciona los meses para ver el ahorro acumulado del periodo.
          </p>
        </div>
      </header>

      {/* Selector tipo + KPIs */}
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold tracking-[0.18em] text-white/65 uppercase mr-2">Tipo</span>
        <Chip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Todos</Chip>
        {matchesByType.luz > 0 && (
          <Chip active={typeFilter === 'luz'} onClick={() => setTypeFilter('luz')}>
            <Zap className="w-3 h-3 inline mr-1" /> Luz ({matchesByType.luz})
          </Chip>
        )}
        {matchesByType.gas > 0 && (
          <Chip active={typeFilter === 'gas'} onClick={() => setTypeFilter('gas')}>
            <Flame className="w-3 h-3 inline mr-1" /> Gas ({matchesByType.gas})
          </Chip>
        )}
      </section>

      {/* KPIs del periodo seleccionado */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label="Ahorro acumulado" value={fmtEur(totals.ahorro)} sub={`${totals.pct.toFixed(2)} % vs comerc. anterior`} positive accent />
        <Kpi label="Pagaste antes" value={fmtEur(totals.prior)} sub={`${totals.count} meses comparables`} />
        <Kpi label="Pagaste con Voltis" value={fmtEur(totals.voltis)} sub="totales del periodo" />
      </section>

      {/* Lista de meses con checkbox */}
      <div className="voltis-glass p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">Meses con factura Voltis</div>
            <h3 className="text-base font-bold text-white">
              {totalsApi.mesesComparables} comparables ·{' '}
              {totalsApi.mesesSinComparar > 0 && <span className="text-white/55">{totalsApi.mesesSinComparar} sin comparar</span>}
            </h3>
          </div>
          <SelectAllToggle matches={matches} selected={selectedMonths} setSelected={setSelectedMonths} />
        </div>

        <div className="space-y-1.5">
          {matches.map(m => {
            const key = matchKey(m)
            const selected = selectedMonths.has(key)
            const comparable = m.ahorro !== undefined
            return (
              <button key={key + m.supplyId} disabled={!comparable}
                onClick={() => toggle(selectedMonths, key, setSelectedMonths)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition
                  ${comparable ? 'hover:bg-white/8 cursor-pointer' : 'opacity-50 cursor-not-allowed'}
                  ${selected ? 'voltis-glass-soft' : ''}`}>
                {comparable
                  ? (selected
                      ? <CheckSquare className="w-4 h-4 text-[#7fffb9] shrink-0" />
                      : <Square className="w-4 h-4 text-white/40 shrink-0" />)
                  : <Square className="w-4 h-4 text-white/20 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {m.monthLabel}
                    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded
                      ${m.supplyType === 'gas' ? 'bg-orange-300/20 text-orange-200' : 'bg-yellow-300/20 text-yellow-200'}`}>
                      {m.supplyType}
                    </span>
                  </div>
                  <div className="text-[10px] text-white/55 num truncate">
                    {m.supplyName || m.supplyCups}
                  </div>
                </div>
                <div className="text-right text-xs num">
                  {comparable && m.prior ? (
                    <>
                      <div className="text-white/60 line-through">{fmtEur(m.prior.total)}</div>
                      <div className="text-white font-bold">{fmtEur(m.voltis.total)}</div>
                    </>
                  ) : (
                    <div className="text-white font-bold">{fmtEur(m.voltis.total)}</div>
                  )}
                </div>
                <div className="text-right ml-3 min-w-[80px]">
                  {comparable ? (
                    <>
                      <div className={`text-sm font-bold num ${m.ahorro! >= 0 ? 'text-[#7fffb9]' : 'text-red-300'}`}>
                        {m.ahorro! >= 0 ? '−' : '+'}{fmt(Math.abs(m.ahorro!), 2)} €
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-white/45">ahorro</div>
                    </>
                  ) : (
                    <div className="text-[10px] text-white/45 italic">{m.noPriorReason}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tabla resumen */}
      <div className="voltis-glass p-5">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">
          Resumen del periodo seleccionado
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#B9D1FF]">
                <th className="text-left py-2">Mes</th>
                <th className="text-left py-2">Suministro</th>
                <th className="text-right py-2">Antes</th>
                <th className="text-right py-2">Voltis</th>
                <th className="text-right py-2">Ahorro</th>
              </tr>
            </thead>
            <tbody>
              {matches
                .filter(m => selectedMonths.has(matchKey(m)) && m.ahorro !== undefined)
                .map(m => (
                  <tr key={matchKey(m) + m.supplyId} className="border-t border-white/10 text-white">
                    <td className="py-2">{m.monthLabel}</td>
                    <td className="py-2 text-white/75 truncate max-w-[200px]">{m.supplyName || m.supplyCups}</td>
                    <td className="py-2 text-right num">{fmtEur(m.prior!.total)}</td>
                    <td className="py-2 text-right num">{fmtEur(m.voltis.total)}</td>
                    <td className={`py-2 text-right num font-bold ${m.ahorro! >= 0 ? 'text-[#7fffb9]' : 'text-red-300'}`}>
                      {fmtEur(m.ahorro!)}
                    </td>
                  </tr>
                ))}
              <tr className="border-t-2 border-white/30">
                <td className="py-3 font-bold text-white" colSpan={2}>Total ({totals.count} meses)</td>
                <td className="py-3 text-right font-bold num text-white">{fmtEur(totals.prior)}</td>
                <td className="py-3 text-right font-bold num text-white">{fmtEur(totals.voltis)}</td>
                <td className={`py-3 text-right font-bold num ${totals.ahorro >= 0 ? 'text-[#7fffb9]' : 'text-red-300'}`}>
                  {fmtEur(totals.ahorro)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Metodología */}
      <details className="voltis-glass-soft p-4 text-sm text-white/85">
        <summary className="cursor-pointer font-semibold text-white">Cómo calculamos el ahorro</summary>
        <ul className="mt-3 space-y-1.5">
          <li>• Para cada factura Voltis, buscamos la factura del <strong className="text-white">mismo mes del año anterior</strong> con tu comercializadora anterior.</li>
          <li>• El ahorro es la diferencia directa entre los dos importes reales — sin estimaciones ni simulaciones.</li>
          <li>• Los meses sin factura del año anterior aparecen como "sin comparar" y no se incluyen en el total.</li>
          <li>• Al añadir nuevas facturas Voltis en el CRM, este panel se actualiza automáticamente.</li>
        </ul>
      </details>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function matchKey(m: MonthlyMatch): string {
  return `${m.supplyId}:${m.month}`
}

function toggle(set: Set<string>, key: string, setSet: (s: Set<string>) => void) {
  const next = new Set(set)
  if (next.has(key)) next.delete(key); else next.add(key)
  setSet(next)
}

function SelectAllToggle({ matches, selected, setSelected }: {
  matches: MonthlyMatch[]; selected: Set<string>; setSelected: (s: Set<string>) => void
}) {
  const comparables = matches.filter(m => m.ahorro !== undefined)
  const allSelected = comparables.every(m => selected.has(matchKey(m)))
  const noneSelected = comparables.every(m => !selected.has(matchKey(m)))
  return (
    <button
      onClick={() => {
        if (allSelected) setSelected(new Set())
        else {
          const next = new Set<string>()
          for (const m of comparables) next.add(matchKey(m))
          setSelected(next)
        }
      }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs voltis-glass-soft text-white/85 hover:text-white">
      {allSelected
        ? <CheckSquare className="w-3.5 h-3.5 text-[#7fffb9]" />
        : noneSelected
          ? <Square className="w-3.5 h-3.5 text-white/50" />
          : <MinusSquare className="w-3.5 h-3.5 text-white/65" />}
      {allSelected ? 'Quitar todos' : 'Seleccionar todos'}
    </button>
  )
}

function Chip({ active, onClick, children }: any) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition
        ${active ? 'bg-white text-[#0A2061] shadow-md' : 'bg-white/20 text-white hover:bg-white/30'}`}>
      {children}
    </button>
  )
}

function Kpi({ label, value, sub, positive = false, accent = false }: any) {
  return (
    <div className="voltis-glass p-5 relative overflow-hidden" style={accent ? {
      boxShadow: 'inset 0 0 0 1px rgba(127,255,185,0.45), inset 0 1px 0 rgba(255,255,255,0.30), 0 18px 40px -18px rgba(10,20,60,0.55)',
    } : undefined}>
      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">{label}</div>
      <div className={`text-2xl md:text-3xl font-bold num leading-none ${positive ? 'text-[#7fffb9]' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-[11px] mt-2 text-white/70">{sub}</div>}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-20 voltis-glass animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <div key={i} className="h-28 voltis-glass animate-pulse" />)}
      </div>
      <div className="h-72 voltis-glass animate-pulse" />
    </div>
  )
}
