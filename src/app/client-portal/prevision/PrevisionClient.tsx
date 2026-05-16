'use client'

/**
 * Portal v2 — Previsión anual.
 *
 * Renderiza el reporte de previsión: resumen ejecutivo del año, los
 * 4 trimestres con tablas y métricas, gráfico mensual real/previsión,
 * metodología y limitaciones. Calcado del PDF de Unice Toys.
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { AlertCircle, Calendar } from 'lucide-react'

interface ForecastMonth {
  month: string; monthIdx: number; monthLabel: string; isReal: boolean
  consumoLuzKwh: number; costeLuz: number
  consumoGasKwh: number; costeGas: number; totalMes: number
}
interface ForecastQuarter {
  q: number; label: string; isReal: boolean
  months: ForecastMonth[]
  totalLuz: number; totalGas: number; totalTrimestre: number
  consumoLuzKwh: number; consumoGasKwh: number; mediaMensual: number
}
interface Report {
  year: number; clientName: string
  totalAnoPrevisto: number; totalRealQ1: number; totalEstimadoResto: number
  totalLuzAno: number; totalGasAno: number; mediaMensual: number; pctReal: number
  months: ForecastMonth[]; quarters: ForecastQuarter[]
  calibration?: { mape: number; samples: number }
}

const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = (n: number) => `${fmt(n, 2)} €`
const fmtK = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  return String(Math.round(n))
}

export function PrevisionClient() {
  const [data, setData] = useState<Report | null>(null)
  const [empty, setEmpty] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState(new Date().getUTCFullYear())

  useEffect(() => {
    fetch(`/api/portal/v2/forecast?year=${year}`, { credentials: 'same-origin' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error')
        return r.json()
      })
      .then(d => {
        if (d.empty) { setEmpty(d.reason); setData(null) }
        else { setData(d.report); setEmpty(null) }
      })
      .catch(e => setError(e.message))
  }, [year])

  if (error) {
    return (
      <div className="voltis-glass max-w-xl p-6 flex items-start gap-3 text-white">
        <AlertCircle className="w-5 h-5 text-red-300 mt-0.5" />
        <div>
          <div className="font-semibold mb-1">No hemos podido cargar tu previsión</div>
          <p className="text-sm text-white/75">{error}</p>
        </div>
      </div>
    )
  }
  if (empty) {
    return (
      <div className="voltis-glass max-w-2xl p-8 md:p-10 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
        <div className="relative flex items-start gap-5 mb-4">
          <div className="relative w-16 h-16 shrink-0">
            <Image src="/mascota-transparente.png" alt="Voltis" width={64} height={64} />
          </div>
          <div>
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">Previsión</div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">Aún preparando tus datos</h1>
          </div>
        </div>
        <p className="relative text-sm text-white/80 leading-relaxed">{empty}</p>
      </div>
    )
  }
  if (!data) return <Skeleton />

  return (
    <div className="space-y-8">
      {/* Hero */}
      <header className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-6 items-center">
        <div className="relative w-24 h-24">
          <Image src="/mascota-transparente.png" alt="Voltis" width={96} height={96} priority />
        </div>
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] text-white voltis-glass-soft mb-3">
            <Calendar className="w-3 h-3 text-[#B9D1FF]" />
            Informe técnico · ejercicio {data.year}
          </div>
          <h1 className="text-[28px] md:text-[36px] font-semibold leading-[1.06] text-white" style={{ letterSpacing: '-0.02em' }}>
            Previsión energética anual
          </h1>
          <p className="mt-2 text-sm text-white/75 max-w-2xl">
            Análisis trimestral del gasto en luz y gas para <strong className="text-white">{data.clientName}</strong>{' '}
            basado en consumos del año anterior y precios contractuales Voltis.
          </p>
        </div>
        <YearPicker year={year} setYear={setYear} />
      </header>

      {/* Resumen ejecutivo */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Kpi label="Gasto total previsto" value={fmtEur(data.totalAnoPrevisto)} sub="Luz + gas, año completo" accent />
        <Kpi label="Real ya facturado" value={fmtEur(data.totalRealQ1)} sub={`${data.pctReal.toFixed(1)}% del año`} />
        <Kpi label="Estimado restante" value={fmtEur(data.totalEstimadoResto)} sub={`${(100 - data.pctReal).toFixed(1)}% del año`} />
        <Kpi label="Luz" value={fmtEur(data.totalLuzAno)} sub={`${pct(data.totalLuzAno, data.totalAnoPrevisto)}% del total`} />
        <Kpi label="Gas" value={fmtEur(data.totalGasAno)} sub={`${pct(data.totalGasAno, data.totalAnoPrevisto)}% del total`} />
        <Kpi label="Factura media mensual" value={fmtEur(data.mediaMensual)} sub="Promedio anual" />
      </section>

      {/* Gráfico mensual */}
      <MonthlyChart months={data.months} />

      {/* Trimestres */}
      <section className="space-y-6">
        {data.quarters.map(q => <QuarterCard key={q.q} q={q} />)}
      </section>

      {/* Metodología */}
      <details open className="voltis-glass p-5 text-sm text-white/85">
        <summary className="cursor-pointer font-semibold text-white mb-3">Cómo calculamos la previsión</summary>
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#B9D1FF] font-bold mb-1">Datos de partida</div>
            <ul className="space-y-1">
              <li>• <strong className="text-white">Meses ya facturados</strong>: cifras reales extraídas de tus facturas Voltis.</li>
              <li>• <strong className="text-white">Meses futuros</strong>: consumos del mismo mes del año anterior según SIPS oficial.</li>
              <li>• <strong className="text-white">Precios</strong>: tarifa Voltis contractual vigente según contrato firmado.</li>
            </ul>
          </div>
          {data.calibration && (
            <div className="voltis-glass-soft p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[#B9D1FF] font-bold mb-1">Precisión validada</div>
              <p>
                El modelo reproduce las facturas Voltis reales con desviación media de{' '}
                <strong className="text-white">±{data.calibration.mape}%</strong>{' '}
                ({data.calibration.samples} {data.calibration.samples === 1 ? 'mes verificado' : 'meses verificados'}).
              </p>
            </div>
          )}
        </div>
      </details>

      {/* Limitaciones */}
      <details className="voltis-glass-soft p-4 text-sm text-white/85">
        <summary className="cursor-pointer font-semibold text-white">Limitaciones y advertencias</summary>
        <ul className="mt-3 space-y-1.5">
          <li>• <strong className="text-white">Consumo real puede variar</strong>: la previsión asume que consumirás lo mismo que el año anterior. Cambios operativos, estacionalidad atípica o eficiencia energética pueden alterar las cifras.</li>
          <li>• <strong className="text-white">Excesos de potencia (luz)</strong>: no incluidos. Dependen de los maxímetros mensuales y son impredecibles sin medición en tiempo real.</li>
          <li>• <strong className="text-white">Revisión</strong>: esta previsión se actualiza automáticamente cada vez que llega una nueva factura real.</li>
        </ul>
      </details>
    </div>
  )
}

// ── Componentes ─────────────────────────────────────────────────────────

function pct(part: number, total: number): string {
  if (total <= 0) return '—'
  return ((part / total) * 100).toFixed(1)
}

function YearPicker({ year, setYear }: any) {
  const now = new Date().getUTCFullYear()
  const years = [now - 1, now, now + 1]
  return (
    <div className="flex gap-1">
      {years.map(y => (
        <button key={y} onClick={() => setYear(y)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition
            ${year === y ? 'bg-white text-[#0A2061] shadow-md' : 'voltis-glass-soft text-white/80 hover:text-white'}`}>
          {y}
        </button>
      ))}
    </div>
  )
}

function Kpi({ label, value, sub, accent = false }: any) {
  return (
    <div className="voltis-glass p-5 relative overflow-hidden" style={accent ? {
      boxShadow: 'inset 0 0 0 1px rgba(218,180,90,0.55), inset 0 1px 0 rgba(255,255,255,0.30), 0 18px 40px -18px rgba(10,20,60,0.55)',
    } : undefined}>
      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">{label}</div>
      <div className="text-2xl md:text-3xl font-bold num leading-none text-white">{value}</div>
      {sub && <div className="text-[11px] mt-2 text-white/70">{sub}</div>}
    </div>
  )
}

function QuarterCard({ q }: { q: ForecastQuarter }) {
  return (
    <div className="voltis-glass p-6 space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="text-5xl font-bold text-white num leading-none">Q{q.q}</div>
        <div className="min-w-0">
          <div className={`inline-block text-[10px] font-bold tracking-[0.18em] uppercase px-2 py-0.5 rounded ${
            q.isReal ? 'bg-amber-300/20 text-amber-200' : 'bg-sky-300/20 text-sky-200'
          }`}>
            {q.isReal ? 'Real' : 'Estimación'}
          </div>
          <h3 className="text-xl font-bold text-white mt-1">{q.label}</h3>
        </div>
        <div className="md:ml-auto text-right">
          <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-[#B9D1FF]">Total trimestre</div>
          <div className="text-2xl font-bold num text-white">{fmtEur(q.totalTrimestre)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKpi label="Luz" value={fmtEur(q.totalLuz)} sub={`${fmt(q.consumoLuzKwh, 0)} kWh`} />
        <MiniKpi label="Gas" value={fmtEur(q.totalGas)} sub={`${fmt(q.consumoGasKwh, 0)} kWh`} />
        <MiniKpi label="Media mensual" value={fmtEur(q.mediaMensual)} sub="3 meses" />
        <MiniKpi label="% año" value={`${pct(q.totalTrimestre, q.totalTrimestre + 1)}%`} sub="del total" />
      </div>

      {/* Tabla mensual */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#B9D1FF]">
              <th className="text-left py-2">Mes</th>
              <th className="text-right py-2">Consumo luz</th>
              <th className="text-right py-2">Coste luz</th>
              <th className="text-right py-2">Consumo gas</th>
              <th className="text-right py-2">Coste gas</th>
              <th className="text-right py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.months.map(m => (
              <tr key={m.month} className="border-t border-white/10 text-white">
                <td className="py-2 font-semibold">{m.monthLabel}
                  {m.isReal && <span className="ml-2 text-[9px] uppercase text-amber-200">real</span>}
                </td>
                <td className="py-2 text-right num">{fmt(m.consumoLuzKwh, 0)} kWh</td>
                <td className="py-2 text-right num">{fmtEur(m.costeLuz)}</td>
                <td className="py-2 text-right num">{fmt(m.consumoGasKwh, 0)} kWh</td>
                <td className="py-2 text-right num">{fmtEur(m.costeGas)}</td>
                <td className="py-2 text-right num font-bold">{fmtEur(m.totalMes)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-white/30">
              <td className="py-3 font-bold text-white">Total Q{q.q}</td>
              <td className="py-3 text-right font-bold num text-white">{fmt(q.consumoLuzKwh, 0)} kWh</td>
              <td className="py-3 text-right font-bold num text-white">{fmtEur(q.totalLuz)}</td>
              <td className="py-3 text-right font-bold num text-white">{fmt(q.consumoGasKwh, 0)} kWh</td>
              <td className="py-3 text-right font-bold num text-white">{fmtEur(q.totalGas)}</td>
              <td className="py-3 text-right font-bold num text-white">{fmtEur(q.totalTrimestre)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MiniKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="voltis-glass-soft p-3">
      <div className="text-[10px] font-bold tracking-wider uppercase text-[#B9D1FF] mb-1">{label}</div>
      <div className="text-base font-bold num text-white">{value}</div>
      {sub && <div className="text-[10px] text-white/60 mt-0.5">{sub}</div>}
    </div>
  )
}

function MonthlyChart({ months }: { months: ForecastMonth[] }) {
  const max = Math.max(...months.map(m => m.totalMes), 1)
  const w = 900, h = 280, padL = 40, padR = 20, padT = 30, padB = 50
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const barW = (innerW / 12) * 0.7

  return (
    <div className="voltis-glass p-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">Gasto mensual</div>
          <h3 className="text-base font-bold text-white">Año completo, luz + gas</h3>
        </div>
        <div className="flex gap-3 text-[11px]">
          <Legend color="#94B6E0" label="Real" />
          <Legend color="#4A6FE3" label="Previsión" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const y = padT + innerH * (1 - p)
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(255,255,255,0.10)" strokeDasharray="3 4" />
                <text x={padL - 6} y={y + 3} fontSize="9" fill="rgba(185,209,255,0.7)" textAnchor="end">{fmtK(max * p)}</text>
              </g>
            )
          })}
          {months.map((m, i) => {
            const x = padL + (innerW / 12) * i + (innerW / 12 - barW) / 2
            const hBar = (m.totalMes / max) * innerH
            const y = padT + innerH - hBar
            const color = m.isReal ? '#94B6E0' : '#4A6FE3'
            return (
              <g key={m.month}>
                <rect x={x} y={y} width={barW} height={hBar} fill={color} rx={2} />
                <text x={x + barW / 2} y={padT + innerH + 14} fontSize="9" fill="rgba(255,255,255,0.75)" textAnchor="middle">
                  {m.monthLabel}
                </text>
                {m.isReal && (
                  <text x={x + barW / 2} y={padT + innerH + 26} fontSize="7" fill="rgba(245,200,100,0.85)" textAnchor="middle">REAL</text>
                )}
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

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-20 voltis-glass animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-28 voltis-glass animate-pulse" />)}
      </div>
      <div className="h-72 voltis-glass animate-pulse" />
    </div>
  )
}
