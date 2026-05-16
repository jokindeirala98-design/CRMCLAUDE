'use client'

/**
 * Portal v2 — Previsión Energética, calcado del PDF Unice Toys 2026.
 *
 * 8 secciones (las mismas páginas del PDF):
 *  1) Portada con título grande + cliente + CIF + periodo + gasto total
 *  2) Resumen ejecutivo (6 KPIs + gráfico mensual del año)
 *  3-6) Q1/Q2/Q3/Q4 con badge REAL o ESTIMACIÓN
 *  7) Metodología
 *  8) Fiscalidad aplicada (4 columnas) + nota fiscal + limitaciones
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { AlertCircle } from 'lucide-react'

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
interface FiscalPeriod {
  from: string; to: string
  ieLuzPct: number; ivaLuzPct: number; ivaLuzReducidaPct: number
  iehGasEurGj: number; ivaGasPct: number
}
interface ForecastResponse {
  empty: boolean; reason?: string
  clientCif?: string | null
  potenciaMaxKw?: number
  fiscalAplicable?: FiscalPeriod[]
  notaFiscal?: string | null
  report?: Report
}

const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = (n: number) => `${fmt(n, 2)} €`
const fmtK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(Math.round(n))
const pct = (part: number, total: number) => total > 0 ? ((part / total) * 100).toFixed(1) : '—'

export function PrevisionClient() {
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState(new Date().getUTCFullYear())

  useEffect(() => {
    fetch(`/api/portal/v2/forecast?year=${year}`, { credentials: 'same-origin' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error')
        return r.json()
      })
      .then((d: ForecastResponse) => setData(d))
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
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">Previsión</div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">Aún preparando tus datos</h1>
          </div>
        </div>
        <p className="relative text-sm text-white/80 leading-relaxed">{data.reason}</p>
      </div>
    )
  }

  const report = data.report!

  return (
    <div className="space-y-12">
      {/* 1) Portada */}
      <Portada report={report} clientCif={data.clientCif} year={year} setYear={setYear} />

      {/* 2) Resumen ejecutivo */}
      <ResumenEjecutivo report={report} />

      {/* 3-6) Trimestres */}
      <section className="space-y-8">
        <SectionTitle num="02" title={`Primer trimestre`} subtitle={report.quarters[0]?.label} badge={report.quarters[0]?.isReal ? 'real' : 'estimacion'} bigNumber="Q1" />
        {report.quarters[0] && <QuarterBlock q={report.quarters[0]} />}
      </section>
      <section className="space-y-8">
        <SectionTitle num="03" title={`Segundo trimestre`} subtitle={report.quarters[1]?.label} badge={report.quarters[1]?.isReal ? 'real' : 'estimacion'} bigNumber="Q2" />
        {report.quarters[1] && <QuarterBlock q={report.quarters[1]} />}
      </section>
      <section className="space-y-8">
        <SectionTitle num="04" title={`Tercer trimestre`} subtitle={report.quarters[2]?.label} badge={report.quarters[2]?.isReal ? 'real' : 'estimacion'} bigNumber="Q3" />
        {report.quarters[2] && <QuarterBlock q={report.quarters[2]} />}
      </section>
      <section className="space-y-8">
        <SectionTitle num="05" title={`Cuarto trimestre`} subtitle={report.quarters[3]?.label} badge={report.quarters[3]?.isReal ? 'real' : 'estimacion'} bigNumber="Q4" />
        {report.quarters[3] && <QuarterBlock q={report.quarters[3]} />}
      </section>

      {/* 7) Metodología */}
      <Metodologia report={report} potenciaMaxKw={data.potenciaMaxKw || 0} />

      {/* 8) Fiscalidad y limitaciones */}
      <FiscalidadAplicada periods={data.fiscalAplicable || []} notaFiscal={data.notaFiscal || null} />
      <Limitaciones />
    </div>
  )
}

// ── 1) Portada ─────────────────────────────────────────────────────────

function Portada({ report, clientCif, year, setYear }: { report: Report; clientCif: string | null | undefined; year: number; setYear: (y: number) => void }) {
  const now = new Date().getUTCFullYear()
  return (
    <header className="voltis-glass p-8 md:p-12 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-2">
            Análisis energético
          </div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/55 mb-4">
            Informe técnico · Ejercicio {report.year}
          </div>
          <h1 className="text-[36px] md:text-[52px] font-bold leading-[1.04] text-white" style={{ letterSpacing: '-0.02em' }}>
            Previsión<br />energética anual
          </h1>
          <p className="mt-4 text-sm md:text-base text-white/80 max-w-2xl">
            Análisis trimestral del gasto en luz y gas para <strong className="text-white">{report.clientName}</strong>{' '}
            basado en consumos SIPS oficiales y precios contractuales auditados.
          </p>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <YearPicker year={year} setYear={setYear} now={now} />
          <div className="relative w-20 h-20 md:w-28 md:h-28">
            <Image src="/mascota-transparente.png" alt="Voltis" width={112} height={112} />
          </div>
        </div>
      </div>

      <div className="relative mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <FooterCard label="Cliente" value={report.clientName} />
        <FooterCard label="CIF" value={clientCif || '—'} mono />
        <FooterCard label="Periodo" value={`Enero – Diciembre ${report.year}`} />
        <FooterCard label="Gasto total previsto" value={fmtEur(report.totalAnoPrevisto)} highlight />
      </div>
    </header>
  )
}

function YearPicker({ year, setYear, now }: { year: number; setYear: (y: number) => void; now: number }) {
  const opts = [now - 1, now, now + 1]
  return (
    <div className="flex gap-1">
      {opts.map(y => (
        <button key={y} onClick={() => setYear(y)}
          className={`px-3 py-1 rounded-full text-[11px] font-semibold transition
            ${year === y ? 'bg-white text-[#0A2061]' : 'voltis-glass-soft text-white/80 hover:text-white'}`}>
          {y}
        </button>
      ))}
    </div>
  )
}

function FooterCard({ label, value, highlight, mono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div className={`voltis-glass-soft p-4 ${highlight ? 'ring-1 ring-[#DAB45A]/40' : ''}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#B9D1FF] font-bold mb-1">{label}</div>
      <div className={`${highlight ? 'text-xl md:text-2xl' : 'text-base'} font-bold text-white ${mono ? 'num' : ''}`}>{value}</div>
    </div>
  )
}

// ── 2) Resumen ejecutivo ────────────────────────────────────────────────

function ResumenEjecutivo({ report }: { report: Report }) {
  return (
    <section className="space-y-5">
      <SectionTitle num="01" title="Visión global del año" subtitle={`Importes consolidados de luz y gas combinando los datos reales facturados con la previsión para los meses restantes, calculada con precios contractuales Voltis y consumos SIPS del ejercicio anterior.`} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Kpi icon="€" label={`Gasto total ${report.year}`} value={fmtEur(report.totalAnoPrevisto)} sub="Luz + gas, año completo" accent />
        <Kpi icon="✓" label="Real (ya facturado)" value={fmtEur(report.totalRealQ1)} sub={`${report.pctReal.toFixed(1)} % del año`} />
        <Kpi icon="~" label="Estimado (pendiente)" value={fmtEur(report.totalEstimadoResto)} sub={`${(100 - report.pctReal).toFixed(1)} % del año`} />
        <Kpi label="Luz" value={fmtEur(report.totalLuzAno)} sub={`${pct(report.totalLuzAno, report.totalAnoPrevisto)} % del total`} />
        <Kpi label="Gas" value={fmtEur(report.totalGasAno)} sub={`${pct(report.totalGasAno, report.totalAnoPrevisto)} % del total`} />
        <Kpi label="Factura media mensual" value={fmtEur(report.mediaMensual)} sub="Promedio anual" />
      </div>
      <MonthlyChart months={report.months} year={report.year} />
    </section>
  )
}

function Kpi({ icon, label, value, sub, accent = false }: any) {
  return (
    <div className="voltis-glass p-5 relative overflow-hidden" style={accent ? {
      boxShadow: 'inset 0 0 0 1px rgba(218,180,90,0.55), inset 0 1px 0 rgba(255,255,255,0.30), 0 18px 40px -18px rgba(10,20,60,0.55)',
    } : undefined}>
      <div className="absolute inset-x-0 top-0 h-2/5 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
      {icon && (
        <div className="relative inline-flex items-center justify-center w-7 h-7 rounded-lg voltis-glass-soft text-[#B9D1FF] font-bold text-sm mb-2">{icon}</div>
      )}
      <div className="relative text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-2">{label}</div>
      <div className="relative text-2xl md:text-3xl font-bold num leading-none text-white">{value}</div>
      {sub && <div className="relative text-[11px] mt-2 text-white/70">{sub}</div>}
    </div>
  )
}

function MonthlyChart({ months, year }: { months: ForecastMonth[]; year: number }) {
  const max = Math.max(...months.flatMap(m => [m.costeLuz + m.costeGas]), 1)
  const w = 900, h = 280, padL = 56, padR = 16, padT = 24, padB = 50
  const innerW = w - padL - padR, innerH = h - padT - padB
  const groupW = innerW / 12
  const barW = (groupW / 2) * 0.85

  return (
    <div className="voltis-glass p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">Gasto mensual {year} (€)</div>
          <div className="text-xs text-white/70 mt-1">
            Desglose por mes y suministro. Barras claras corresponden a meses ya facturados,
            las oscuras a la previsión.
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <Legend color="#B9D1FF" label="Luz real" />
          <Legend color="#1F47B5" label="Luz previsión" />
          <Legend color="#FFD8AA" label="Gas real" />
          <Legend color="#FB923C" label="Gas previsión" />
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
            const x0 = padL + groupW * i + (groupW - barW * 2) / 2
            const luzColor = m.isReal ? '#B9D1FF' : '#1F47B5'
            const gasColor = m.isReal ? '#FFD8AA' : '#FB923C'
            const hLuz = (m.costeLuz / max) * innerH
            const hGas = (m.costeGas / max) * innerH
            const yLuz = padT + innerH - hLuz
            const yGas = padT + innerH - hGas
            return (
              <g key={m.month}>
                <rect x={x0} y={yLuz} width={barW * 0.92} height={hLuz} fill={luzColor} rx={1.5} />
                <rect x={x0 + barW} y={yGas} width={barW * 0.92} height={hGas} fill={gasColor} rx={1.5} />
                <text x={x0 + barW} y={padT + innerH + 14} fontSize="9" fill="rgba(255,255,255,0.75)" textAnchor="middle">
                  {m.monthLabel}
                </text>
                {m.isReal && (
                  <text x={x0 + barW} y={padT + innerH + 26} fontSize="7" fill="rgba(245,200,100,0.85)" textAnchor="middle">REAL</text>
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

// ── Section title con número + badge ──────────────────────────────────

function SectionTitle({ num, title, subtitle, badge, bigNumber }: { num: string; title: string; subtitle?: string; badge?: 'real' | 'estimacion'; bigNumber?: string }) {
  return (
    <div className="flex items-end gap-5 flex-wrap">
      {bigNumber && (
        <div className="text-6xl md:text-7xl font-bold text-white num leading-none">{bigNumber}</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">{num} · {title.toUpperCase()}</div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-2xl md:text-3xl font-bold text-white">{title}</h2>
          {badge && (
            <span className={`text-[10px] font-bold tracking-[0.18em] uppercase px-2 py-1 rounded
              ${badge === 'real' ? 'bg-amber-300/20 text-amber-200' : 'bg-sky-300/20 text-sky-200'}`}>
              {badge === 'real' ? 'Real' : 'Estimación'}
            </span>
          )}
        </div>
        {subtitle && <p className="text-sm text-white/70 mt-2 max-w-3xl">{subtitle}</p>}
      </div>
    </div>
  )
}

// ── 3-6) Trimestre block ────────────────────────────────────────────────

function QuarterBlock({ q }: { q: ForecastQuarter }) {
  return (
    <div className="voltis-glass p-6 space-y-5">
      {/* Mini KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKpi label="Total trimestre" value={fmtEur(q.totalTrimestre)} sub={`${pct(q.totalTrimestre, q.totalTrimestre)} % del año`} />
        <MiniKpi label="Luz" value={fmtEur(q.totalLuz)} sub={`${fmt(q.consumoLuzKwh, 0)} kWh`} />
        <MiniKpi label="Gas" value={fmtEur(q.totalGas)} sub={`${fmt(q.consumoGasKwh, 0)} kWh`} />
        <MiniKpi label="Media mensual" value={fmtEur(q.mediaMensual)} sub="3 meses" />
      </div>

      {/* Tabla del trimestre */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#B9D1FF]">
              <th className="text-left py-2">Mes</th>
              <th className="text-right py-2">Consumo luz</th>
              <th className="text-right py-2">Coste luz</th>
              <th className="text-right py-2">Consumo gas</th>
              <th className="text-right py-2">Coste gas</th>
              <th className="text-right py-2">Total mes</th>
            </tr>
          </thead>
          <tbody>
            {q.months.map(m => (
              <tr key={m.month} className="border-t border-white/10 text-white">
                <td className="py-2 font-semibold">
                  {m.monthLabel}
                  {m.isReal && <span className="ml-2 text-[9px] uppercase text-amber-200">real</span>}
                </td>
                <td className="py-2 text-right num">{fmt(m.consumoLuzKwh, 0)} kWh</td>
                <td className="py-2 text-right num">{fmtEur(m.costeLuz)}</td>
                <td className="py-2 text-right num">{fmt(m.consumoGasKwh, 0)} kWh</td>
                <td className="py-2 text-right num">{fmtEur(m.costeGas)}</td>
                <td className="py-2 text-right num font-bold">{fmtEur(m.totalMes)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-white/30 text-white">
              <td className="py-3 font-bold">Total Q{q.q}</td>
              <td className="py-3 text-right font-bold num">{fmt(q.consumoLuzKwh, 0)} kWh</td>
              <td className="py-3 text-right font-bold num">{fmtEur(q.totalLuz)}</td>
              <td className="py-3 text-right font-bold num">{fmt(q.consumoGasKwh, 0)} kWh</td>
              <td className="py-3 text-right font-bold num">{fmtEur(q.totalGas)}</td>
              <td className="py-3 text-right font-bold num">{fmtEur(q.totalTrimestre)}</td>
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

// ── 7) Metodología ──────────────────────────────────────────────────────

function Metodologia({ report, potenciaMaxKw }: { report: Report; potenciaMaxKw: number }) {
  return (
    <section className="space-y-5">
      <SectionTitle num="06" title="Cómo calculamos la previsión" subtitle="La metodología combina datos reales del SIPS con precios contractuales Voltis vigentes y la fiscalidad oficial aplicable. El modelo se valida contra las facturas reales conforme van llegando." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="voltis-glass p-5">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">Datos de partida</div>
          <ul className="space-y-2 text-sm text-white/85">
            <li>• <strong className="text-white">Meses ya facturados</strong>: cifras reales extraídas de las facturas Voltis oficiales.</li>
            <li>• <strong className="text-white">Meses futuros</strong>: consumos del mismo mes del año anterior según SIPS oficial del distribuidor.</li>
            <li>• <strong className="text-white">Precios</strong>: tarifa Voltis contractual fija inferida automáticamente de tus facturas Voltis recientes.</li>
          </ul>
        </div>

        <div className="voltis-glass p-5">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">Fórmula de cálculo</div>
          <div className="space-y-3 text-sm text-white/85">
            <div>
              <div className="font-semibold text-white mb-1">Luz</div>
              <code className="text-[12px] text-[#B9D1FF] num leading-relaxed">
                Coste = Σ(kW × precio_potencia_día × días)_P1..P6<br />
                {'      '}+ Σ(kWh × precio_energía)_P1..P6<br />
                {'      '}+ bono social + alquiler + IE + IVA
              </code>
            </div>
            <div>
              <div className="font-semibold text-white mb-1">Gas</div>
              <code className="text-[12px] text-[#B9D1FF] num leading-relaxed">
                Coste = (días × término_fijo_diario)<br />
                {'      '}+ (kWh × precio_kWh) + IEH + alquiler<br />
                {'      '}+ GTS + CNMC + corrector + IVA
              </code>
            </div>
          </div>
        </div>
      </div>

      {report.calibration && (
        <div className="voltis-glass-soft p-4 border border-[#7fffb9]/30">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#7fffb9] mb-2">Precisión validada</div>
          <p className="text-sm text-white/85">
            El modelo reproduce las facturas Voltis reales con desviación media de{' '}
            <strong className="text-white">±{report.calibration.mape} %</strong>{' '}
            ({report.calibration.samples} {report.calibration.samples === 1 ? 'mes verificado' : 'meses verificados'}).
          </p>
        </div>
      )}
    </section>
  )
}

// ── 8) Fiscalidad ───────────────────────────────────────────────────────

function FiscalidadAplicada({ periods, notaFiscal }: { periods: FiscalPeriod[]; notaFiscal: string | null }) {
  if (!periods || periods.length === 0) return null
  return (
    <section className="space-y-5">
      <SectionTitle num="07" title="Fiscalidad aplicada" subtitle="Tipos impositivos vigentes en cada periodo del año según RDL y las posibles desactivaciones anticipadas anunciadas por el regulador." />

      <div className="voltis-glass p-5">
        <div className={`grid gap-4 ${periods.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : periods.length === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-2 md:grid-cols-4'}`}>
          {periods.map((fp, i) => (
            <div key={i} className="voltis-glass-soft p-4">
              <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3 leading-tight">
                {formatPeriodRange(fp.from, fp.to)}
              </div>
              <FiscalRow label="IE luz" value={`${fp.ieLuzPct.toFixed(2)} %`} />
              <FiscalRow label="IVA luz" value={`${fp.ivaLuzPct} %`} />
              <FiscalRow label="IEH gas" value={`${fp.iehGasEurGj.toFixed(2)} €/GJ`} />
              <FiscalRow label="IVA gas" value={`${fp.ivaGasPct} %`} />
            </div>
          ))}
        </div>

        {notaFiscal && (
          <div className="mt-4 voltis-glass-soft p-4 border-l-2 border-[#B9D1FF]/50">
            <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-[#B9D1FF] mb-2">Nota fiscal</div>
            <p className="text-sm text-white/85 leading-relaxed">{notaFiscal}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function FiscalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-t border-white/10 py-1 first:border-t-0">
      <span className="text-xs text-white/70">{label}</span>
      <span className="text-sm font-bold text-white num">{value}</span>
    </div>
  )
}

function formatPeriodRange(from: string, to: string): string {
  const MESES_ABBR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const f = new Date(from + 'T00:00:00Z')
  const t = new Date(to + 'T00:00:00Z')
  const fLbl = `${MESES_ABBR[f.getUTCMonth()]} ${f.getUTCFullYear()}`
  const tLbl = `${MESES_ABBR[t.getUTCMonth()]} ${t.getUTCFullYear()}`
  return fLbl === tLbl ? fLbl : `${fLbl} – ${tLbl}`
}

function Limitaciones() {
  return (
    <section className="voltis-glass-soft p-5">
      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-3">Limitaciones y advertencias</div>
      <ul className="space-y-2 text-sm text-white/85">
        <li>• <strong className="text-white">Consumo real puede variar</strong>: la previsión asume que el cliente consumirá lo mismo que en el año anterior. Cambios operativos, estacionalidad atípica o eficiencia energética pueden alterar las cifras.</li>
        <li>• <strong className="text-white">Excesos de potencia (luz)</strong>: no incluidos. Dependen de los maxímetros mensuales y son impredecibles sin medición en tiempo real.</li>
        <li>• <strong className="text-white">Revisión</strong>: esta previsión se actualiza automáticamente cada vez que entra una nueva factura real al CRM.</li>
      </ul>
    </section>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-72 voltis-glass animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[0,1,2,3,4,5].map(i => <div key={i} className="h-28 voltis-glass animate-pulse" />)}
      </div>
      <div className="h-72 voltis-glass animate-pulse" />
    </div>
  )
}
