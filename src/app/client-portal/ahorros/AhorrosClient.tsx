'use client'

/**
 * Portal v2 — Ahorros, calcado del PDF "Ahorro luz/gas 1er Trimestre" Unice.
 *
 * Estructura:
 *  1) Hero con título + mascota + tabs Luz/Gas
 *  2) Pregunta destacada + título "Estimación: precios Voltis × consumo año anterior"
 *  3) 4 KPIs principales
 *  4) Descomposición del ahorro total (barra apilada)
 *  5) Tabla "Precios Voltis aplicados"
 *  6) Tabla "Estimación mes a mes"
 *  7) Gráfico "Comparativa mes a mes" (3 barras por mes)
 *  8) Para gas: tabla "Comparativa de los 4 escenarios" + atribución
 *  9) Metodología
 */
import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { AlertCircle, TrendingDown, Zap, Flame, Info } from 'lucide-react'

interface MonthlyEntry {
  month: string; monthLabel: string; year: number; monthIdx: number
  supplyId: string; supplyName: string | null; supplyCups: string | null
  supplyType: 'luz' | 'gas'
  s0_priorReal?: number; s1_voltisFiscalAnt?: number
  s2_voltisFiscalAct?: number; s3_voltisReal?: number
  consumoPriorKwh?: number
  ahorroCambioTarifa?: number; ahorroCambioNormativo?: number
  ahorroMenorConsumo?: number; ahorroTotal?: number
  noPriorReason?: string
}
interface ScenarioBlock {
  type: 'luz' | 'gas'
  supplyId: string; supplyName: string | null; supplyCups: string | null
  contract: any
  totals: {
    s0: number; s1: number; s2: number; s3: number
    ahorroCambioTarifa: number; ahorroCambioNormativo: number
    ahorroMenorConsumo: number; ahorroTotal: number; ahorroTotalPct: number
    mesesComparables: number
  }
  months: MonthlyEntry[]
}
interface SavingsResponse {
  empty: boolean
  reason?: string
  clientName?: string | null
  blocks?: ScenarioBlock[]
}

const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = (n: number) => `${fmt(n, 2)} €`

export function AhorrosClient() {
  const [data, setData] = useState<SavingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/v2/savings', { credentials: 'same-origin' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error')
        return r.json()
      })
      .then((d: SavingsResponse) => {
        setData(d)
        if (d.blocks && d.blocks.length > 0) setActiveBlockId(d.blocks[0].supplyId)
      })
      .catch(e => setError(e.message))
  }, [])

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
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">Ahorros</div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">Aún sin facturas Voltis</h1>
          </div>
        </div>
        <p className="relative text-sm text-white/80 leading-relaxed">{data.reason}</p>
      </div>
    )
  }

  const blocks = data.blocks || []
  const activeBlock = blocks.find(b => b.supplyId === activeBlockId) || blocks[0]

  return (
    <div className="space-y-7">
      {/* Hero */}
      <header className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
        <div className="min-w-0">
          <h1 className="text-[28px] md:text-[36px] font-semibold leading-[1.06] text-white"
            style={{ letterSpacing: '-0.02em' }}>
            Tu ahorro energético, en datos
          </h1>
          <p className="mt-2 text-sm text-white/75 max-w-2xl">
            Comparativa de los meses con Voltis frente a tu antigua comercializadora.
            Sin promesas, solo facturas.
          </p>
        </div>
        <div className="relative w-24 h-24 justify-self-end">
          <Image src="/mascota-transparente.png" alt="Voltis" width={96} height={96} priority />
        </div>
      </header>

      {/* Tabs por supply */}
      <nav className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-2">
        {blocks.map(b => (
          <TabBtn key={b.supplyId} active={b.supplyId === activeBlockId} onClick={() => setActiveBlockId(b.supplyId)}>
            {b.type === 'gas' ? <Flame className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
            Ahorro {b.type}
            {b.supplyName && <span className="text-white/55 ml-1">· {b.supplyName}</span>}
          </TabBtn>
        ))}
      </nav>

      {activeBlock && <BlockView block={activeBlock} />}
    </div>
  )
}

// ── Bloque por supply ───────────────────────────────────────────────────

function BlockView({ block }: { block: ScenarioBlock }) {
  const { totals, months, contract, type } = block
  const ahorroCambioPct = totals.s0 > 0 ? (totals.ahorroCambioTarifa / totals.s0) * 100 : 0
  const restoConsumo = totals.s2 - totals.s3

  return (
    <div className="space-y-7">
      {/* Pregunta destacada */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#B9D1FF] font-bold mb-1">
          ¿Cuánto habría pagado con Voltis si hubiera consumido lo mismo que el año pasado?
        </p>
        <h2 className="text-xl md:text-2xl font-bold text-white">
          Estimación: precios Voltis × consumo año anterior
        </h2>
      </div>

      {/* 4 KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Pagó antes (real)"
          value={fmtEur(totals.s0)}
          sub="consumo real año anterior"
        />
        <Kpi
          label="Habría pagado con Voltis"
          value={fmtEur(totals.s2)}
          sub="mismo consumo, precios Voltis"
          accent="primary"
        />
        <Kpi
          label="Ahorro solo por cambio"
          value={fmtEur(totals.ahorroCambioTarifa)}
          sub={`−${ahorroCambioPct.toFixed(2)} % solo por la tarifa`}
          accent="positive"
        />
        <Kpi
          label="Ahorro por menor consumo"
          value={fmtEur(restoConsumo)}
          sub={`resto hasta los ${fmtEur(totals.s3)} reales`}
          accent="positive"
        />
      </section>

      {/* Descomposición */}
      <Descomposicion totals={totals} />

      {/* Precios Voltis aplicados */}
      {type === 'luz' && contract ? <PreciosLuzTable contract={contract} /> : null}
      {type === 'gas' && contract ? <PreciosGasTable contract={contract} block={block} /> : null}

      {/* Tabla mes a mes */}
      <EstimacionMensual months={months} type={type} />

      {/* Gráfico comparativa */}
      <ComparativaMensualChart months={months} />

      {/* 4 escenarios (gas según PDF Unice) */}
      {type === 'gas' && <CuatroEscenarios totals={totals} />}

      {/* Metodología */}
      <details open className="voltis-glass p-5 text-sm text-white/85">
        <summary className="cursor-pointer font-semibold text-white">Metodología</summary>
        <ul className="mt-3 space-y-1.5">
          {type === 'luz' ? <>
            <li>• <strong className="text-white">Energía</strong>: consumo por periodo × precio Voltis por periodo (peaje + P. Fijo).</li>
            <li>• <strong className="text-white">Potencia y peajes de potencia</strong>: idénticos a las facturas reales Voltis (no dependen del consumo).</li>
            <li>• <strong className="text-white">Excesos de potencia</strong>: los reales aplicados por Voltis en sus facturas (estimación conservadora).</li>
            <li>• <strong className="text-white">Impuesto eléctrico</strong>: tipo vigente cada mes según RDL (cambio normativo).</li>
            <li>• <strong className="text-white">Bono social, alquiler de equipos e IVA</strong>: igual que las facturas reales.</li>
          </> : <>
            <li>• <strong className="text-white">Término variable energía</strong>: consumo × precio Voltis €/kWh (TV Precio Fijo).</li>
            <li>• <strong className="text-white">Peaje de acceso</strong>: consumo × peaje Voltis €/kWh.</li>
            <li>• <strong className="text-white">Término fijo diario</strong>: días × tarifa fija Voltis €/día (incluye peaje, GTS, CNMC, corrector).</li>
            <li>• <strong className="text-white">IEH</strong>: €/GJ según RDL vigente; <strong className="text-white">IVA</strong>: 21 % o 10 % según fecha.</li>
            <li>• <strong className="text-white">Alquiler de equipos</strong>: igual que las facturas reales.</li>
          </>}
          <li>• <strong className="text-white">Validación cruzada</strong>: aplicando la fórmula al consumo real Voltis se reproducen las facturas con ±0,02 €.</li>
        </ul>
      </details>
    </div>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: any) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold transition border-b-2
        ${active ? 'text-white border-white' : 'text-white/65 border-transparent hover:text-white'}`}>
      {children}
    </button>
  )
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'primary' | 'positive' }) {
  const style = accent === 'positive' ? {
    boxShadow: 'inset 0 0 0 1px rgba(127,255,185,0.45), inset 0 1px 0 rgba(255,255,255,0.30), 0 18px 40px -18px rgba(10,20,60,0.55)',
  } : accent === 'primary' ? {
    boxShadow: 'inset 0 0 0 1px rgba(218,180,90,0.45), inset 0 1px 0 rgba(255,255,255,0.30), 0 18px 40px -18px rgba(10,20,60,0.55)',
  } : undefined

  const valueColor = accent === 'positive' ? 'text-[#7fffb9]'
                   : accent === 'primary' ? 'text-white'
                   : 'text-white'

  return (
    <div className="voltis-glass p-5 relative overflow-hidden" style={style}>
      <div className="absolute inset-x-0 top-0 h-2/5 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
      <div className="relative text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">{label}</div>
      <div className={`relative text-2xl md:text-3xl font-bold num leading-none ${valueColor}`}>{value}</div>
      {sub && <div className="relative text-[11px] mt-2 text-white/70">{sub}</div>}
    </div>
  )
}

function Descomposicion({ totals }: { totals: ScenarioBlock['totals'] }) {
  const consumoExtra = totals.s2 - totals.s3
  const pctTarifa = totals.ahorroTotal !== 0 ? (totals.ahorroCambioTarifa / totals.ahorroTotal) * 100 : 0
  const pctConsumo = totals.ahorroTotal !== 0 ? (consumoExtra / totals.ahorroTotal) * 100 : 0
  return (
    <div className="voltis-glass p-5">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">
          Descomposición del ahorro total ({fmtEur(totals.ahorroTotal)})
        </div>
        <div className="text-xs text-white/65">Tarifa {pctTarifa.toFixed(1)} % · Consumo {pctConsumo.toFixed(1)} %</div>
      </div>
      <p className="text-xs text-white/70 mb-3">
        Cuánto se ahorra <strong className="text-white">solo por haber cambiado de comercializadora</strong>{' '}
        y cuánto por haber consumido menos.
      </p>
      <div className="h-7 rounded-lg overflow-hidden flex">
        {pctTarifa > 0 && (
          <div style={{ width: `${pctTarifa}%`, background: '#4A6FE3' }}
            className="flex items-center justify-center text-[10px] font-bold text-white">
            {pctTarifa > 14 ? `Por cambio de tarifa (${pctTarifa.toFixed(1)} %)` : ''}
          </div>
        )}
        {pctConsumo > 0 && (
          <div style={{ width: `${pctConsumo}%`, background: '#7fb3ff' }}
            className="flex items-center justify-center text-[10px] font-bold text-white">
            {pctConsumo > 14 ? `Por menor consumo (${pctConsumo.toFixed(1)} %)` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function PreciosLuzTable({ contract }: { contract: any }) {
  const periodos = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
  const filas = periodos
    .map(p => ({
      p,
      total: Number(contract[`precioKwh${p}`]) || 0,
      kw: Number(contract[`precioKwDia${p}`]) || 0,
    }))
    .filter(f => f.total > 0)

  return (
    <div className="voltis-glass p-5">
      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-2">
        Precios Voltis aplicados (€/kWh por periodo)
      </div>
      <p className="text-xs text-white/70 mb-3">
        Precio final por kWh combinado (peaje + precio fijo), inferido automáticamente
        de tus facturas Voltis.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#B9D1FF]">
              <th className="text-left py-2">Periodo</th>
              <th className="text-right py-2">Precio energía €/kWh</th>
              <th className="text-right py-2">Precio potencia €/kW día</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.p} className="border-t border-white/10 text-white">
                <td className="py-2 font-semibold">{f.p}</td>
                <td className="py-2 text-right num font-bold">{fmt(f.total, 6)}</td>
                <td className="py-2 text-right num">{f.kw > 0 ? fmt(f.kw, 6) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PreciosGasTable({ contract, block }: { contract: any; block: ScenarioBlock }) {
  const tvEnergia = Number(contract.precioKwhGas) || 0
  const peaje = Number(contract.peajeKwhGas) || 0
  const fijoDia = Number(contract.terminoFijoDiarioGas) || 0
  const precioTotal = tvEnergia + peaje

  return (
    <div className="voltis-glass p-5">
      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-2">
        Precios Voltis aplicados al gas
      </div>
      <p className="text-xs text-white/70 mb-3">
        Constantes durante todo el periodo analizado. La energía es plana, sin franjas
        horarias. El término fijo diario incluye los cargos regulados (peaje, GTS, CNMC, corrector).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#B9D1FF]">
              <th className="text-left py-2">Concepto</th>
              <th className="text-left py-2">Unidad</th>
              <th className="text-right py-2">Precio Voltis</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-white/10 text-white">
              <td className="py-2"><div className="font-semibold">Término variable energía</div>
                <div className="text-[10px] text-white/55">TV Precio Fijo</div></td>
              <td className="py-2 text-white/75">€/kWh</td>
              <td className="py-2 text-right num font-bold">{fmt(tvEnergia, 6)}</td>
            </tr>
            <tr className="border-t border-white/10 text-white">
              <td className="py-2"><div className="font-semibold">Peaje de acceso</div>
                <div className="text-[10px] text-white/55">TV Red Local</div></td>
              <td className="py-2 text-white/75">€/kWh</td>
              <td className="py-2 text-right num">{fmt(peaje, 6)}</td>
            </tr>
            <tr className="border-t border-white/10 text-white">
              <td className="py-2"><div className="font-semibold">Término fijo diario</div>
                <div className="text-[10px] text-white/55">suma de los 4 cargos fijos</div></td>
              <td className="py-2 text-white/75">€/día</td>
              <td className="py-2 text-right num">{fmt(fijoDia, 4)}</td>
            </tr>
            <tr className="border-t border-white/20 text-[#7fffb9]">
              <td className="py-2 font-bold">Precio total energético (TV)</td>
              <td className="py-2">€/kWh</td>
              <td className="py-2 text-right num font-bold">{fmt(precioTotal, 6)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EstimacionMensual({ months, type }: { months: MonthlyEntry[]; type: 'luz' | 'gas' }) {
  const filas = months.filter(m => m.s2_voltisFiscalAct !== undefined)
  if (filas.length === 0) return null
  return (
    <div className="voltis-glass p-5">
      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">
        Estimación mes a mes (consumo año anterior × precios Voltis)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#B9D1FF]">
              <th className="text-left py-2">Mes</th>
              <th className="text-right py-2">kWh consumo</th>
              <th className="text-right py-2">Total factura est.</th>
              <th className="text-right py-2">Pagó real (antes)</th>
              <th className="text-right py-2">Pagó Voltis (real)</th>
              <th className="text-right py-2">Ahorro tarifa</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(m => (
              <tr key={m.month} className="border-t border-white/10 text-white">
                <td className="py-2">{m.monthLabel}</td>
                <td className="py-2 text-right num">{fmt(m.consumoPriorKwh || 0, 0)}</td>
                <td className="py-2 text-right num">{fmtEur(m.s2_voltisFiscalAct!)}</td>
                <td className="py-2 text-right num">{m.s0_priorReal !== undefined ? fmtEur(m.s0_priorReal) : '—'}</td>
                <td className="py-2 text-right num">{m.s3_voltisReal !== undefined ? fmtEur(m.s3_voltisReal) : '—'}</td>
                <td className={`py-2 text-right num font-bold ${(m.ahorroCambioTarifa || 0) >= 0 ? 'text-[#7fffb9]' : 'text-red-300'}`}>
                  {m.ahorroCambioTarifa !== undefined ? fmtEur(m.ahorroCambioTarifa) : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-white/30 text-white">
              <td className="py-3 font-bold">Total</td>
              <td className="py-3 text-right font-bold num">{fmt(filas.reduce((a, m) => a + (m.consumoPriorKwh || 0), 0), 0)}</td>
              <td className="py-3 text-right font-bold num">{fmtEur(filas.reduce((a, m) => a + (m.s2_voltisFiscalAct || 0), 0))}</td>
              <td className="py-3 text-right font-bold num">{fmtEur(filas.reduce((a, m) => a + (m.s0_priorReal || 0), 0))}</td>
              <td className="py-3 text-right font-bold num">{fmtEur(filas.reduce((a, m) => a + (m.s3_voltisReal || 0), 0))}</td>
              <td className={`py-3 text-right font-bold num ${filas.reduce((a, m) => a + (m.ahorroCambioTarifa || 0), 0) >= 0 ? 'text-[#7fffb9]' : 'text-red-300'}`}>
                {fmtEur(filas.reduce((a, m) => a + (m.ahorroCambioTarifa || 0), 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ComparativaMensualChart({ months }: { months: MonthlyEntry[] }) {
  const filas = months.filter(m => m.s0_priorReal !== undefined || m.s3_voltisReal !== undefined)
  if (filas.length === 0) return null
  const max = Math.max(...filas.flatMap(m => [m.s0_priorReal || 0, m.s2_voltisFiscalAct || 0, m.s3_voltisReal || 0]), 1)
  const w = 900, h = 280, padL = 56, padR = 16, padT = 24, padB = 50
  const innerW = w - padL - padR, innerH = h - padT - padB
  const groupW = innerW / filas.length
  const barW = (groupW / 4) * 0.95

  return (
    <div className="voltis-glass p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">
          Comparativa mes a mes (€)
        </div>
        <div className="flex gap-3 text-[11px]">
          <Legend color="#B9D1FF" label="Pagó antes (real)" />
          <Legend color="#7fb3ff" label="Habría pagado con Voltis" />
          <Legend color="#1F47B5" label="Pagó con Voltis (real)" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const y = padT + innerH * (1 - p)
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(255,255,255,0.10)" strokeDasharray="3 4" />
                <text x={padL - 6} y={y + 3} fontSize="9" fill="rgba(185,209,255,0.7)" textAnchor="end">
                  {fmt(max * p, 0)} €
                </text>
              </g>
            )
          })}
          {filas.map((m, i) => {
            const x0 = padL + groupW * i + (groupW - barW * 3) / 2
            const values = [
              { v: m.s0_priorReal || 0, c: '#B9D1FF' },
              { v: m.s2_voltisFiscalAct || 0, c: '#7fb3ff' },
              { v: m.s3_voltisReal || 0, c: '#1F47B5' },
            ]
            return (
              <g key={m.month}>
                {values.map((vv, k) => {
                  const hBar = (vv.v / max) * innerH
                  const y = padT + innerH - hBar
                  return <rect key={k} x={x0 + barW * k} y={y} width={barW * 0.92} height={hBar} fill={vv.c} rx={1.5} />
                })}
                <text x={x0 + barW * 1.5} y={padT + innerH + 14} fontSize="10" fill="rgba(255,255,255,0.75)" textAnchor="middle">
                  {m.monthLabel}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      <span className="text-white/75">{label}</span>
    </div>
  )
}

function CuatroEscenarios({ totals }: { totals: ScenarioBlock['totals'] }) {
  return (
    <div className="voltis-glass p-5">
      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-2">
        Comparativa de los 4 escenarios (€)
      </div>
      <p className="text-xs text-white/70 mb-4">
        Análisis detallado. La diferencia entre barras consecutivas explica de dónde viene
        cada parte del ahorro: cambio de tarifa (S0→S1), cambio normativo (S1→S2) y menor consumo (S2→S3).
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <ScenarioCard num={0} label="Pagó real anterior" value={fmtEur(totals.s0)} variant="default" />
        <ScenarioCard num={1} label="Mismo consumo, precios Voltis, fisc. anterior" value={fmtEur(totals.s1)} variant="default" />
        <ScenarioCard num={2} label="Mismo consumo, precios Voltis, fisc. actual" value={fmtEur(totals.s2)} variant="default" />
        <ScenarioCard num={3} label="Pagó real Voltis" value={fmtEur(totals.s3)} variant="accent" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Attribution label="Por cambio de tarifa" value={totals.ahorroCambioTarifa} hint="atribuible a Voltis" />
        <Attribution label="Por cambio normativo" value={totals.ahorroCambioNormativo} hint="atribuible al regulador" />
        <Attribution label="Por menor consumo" value={totals.ahorroMenorConsumo} hint="atribuible al cliente" />
      </div>
    </div>
  )
}

function ScenarioCard({ num, label, value, variant }: { num: number; label: string; value: string; variant: 'default' | 'accent' }) {
  const style = variant === 'accent' ? {
    boxShadow: 'inset 0 0 0 1px rgba(31,71,181,0.65), inset 0 1px 0 rgba(255,255,255,0.30)',
  } : undefined
  return (
    <div className="voltis-glass-soft p-4 relative" style={style}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[14px] font-bold text-[#B9D1FF] num">S{num}</span>
        <div className="text-[9px] font-bold tracking-wider uppercase text-[#B9D1FF] leading-tight">{label}</div>
      </div>
      <div className="text-base font-bold num text-white mt-2">{value}</div>
    </div>
  )
}

function Attribution({ label, value, hint }: { label: string; value: number; hint: string }) {
  const positive = value >= 0
  return (
    <div className="voltis-glass-soft p-4">
      <div className="text-[10px] font-bold tracking-wider uppercase text-[#B9D1FF] mb-1">{label}</div>
      <div className={`text-lg font-bold num ${positive ? 'text-[#7fffb9]' : 'text-red-300'}`}>{fmtEur(value)}</div>
      <div className="text-[10px] text-white/55 mt-1">{hint}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-20 voltis-glass animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-28 voltis-glass animate-pulse" />)}
      </div>
      <div className="h-40 voltis-glass animate-pulse" />
      <div className="h-64 voltis-glass animate-pulse" />
    </div>
  )
}
