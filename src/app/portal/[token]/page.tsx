'use client'

/**
 * /clients/[id]/economic-overview
 * Estudio Económico Global del cliente — estilo Voltis (azul cielo + Buddy).
 */

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, AlertCircle, Zap, Flame, AlertTriangle,
  TrendingDown, TrendingUp, ChevronRight, Sparkles, Lightbulb,
  Activity, BarChart3, Target, Award, Download, Info,
} from 'lucide-react'
import { computarOverview, type OverviewMode } from '@/lib/economic-overview'
import { clientExcelFilename } from '@/lib/utils/download-names'

type Mode = 'global' | 'year' | 'custom'
type TypeFilter = 'all' | 'luz' | 'gas'
// El motor `computarOverview` espera 'last12' | 'previous_year' | 'custom'.
// Mapeamos nuestro Mode UI → ese tipo internamente.

// Datos crudos que llegan del endpoint en modo ?raw=1
interface RawDataset {
  client: { id: string; name: string; cif: string | null; type: string }
  supplies: any[]
  invoices: any[]
}

// ── Tipos del payload ──────────────────────────────────────────────────────

interface SupplyAggregate {
  supply: {
    id: string; cups: string | null; type: 'luz' | 'gas' | null
    tariff: string | null; name: string | null; address: string | null
    comercializadora: string | null; distribuidora: string | null
    consumoAnualKwh: number; fechaSipsActualizado: string | null
    potenciaContratada: Record<string, number> | null
  }
  invoicesCount: number; mesesCubiertos: number
  windowFrom: string | null; windowTo: string | null
  consumoAnualKwh: number; consumoFacturadoKwh: number
  totalGasto: number; totalEnergia: number; totalPotencia: number
  totalExcesos: number; totalReactiva: number; totalIee: number; totalIva: number
  eurPorKwh: number
  consumoPorPeriodo: Record<string, number>
  precioMedioPorPeriodo: Record<string, number>
  esAnomalo: boolean; sinFacturas: boolean
}

interface Monthly { year: number; month: number; totalLuz: number; totalGas: number; total: number; kwhLuz: number; kwhGas: number; invoicesCount: number }

interface Overview {
  client: { id: string; name: string; cif: string | null; type: string }
  mode: Mode; windowDescription: string; typeFilter: TypeFilter
  fechaSipsMasReciente: string | null
  totals: {
    gastoTotal: number; gastoAnualizado: number
    consumoTotalKwh: number; consumoFacturadoTotalKwh: number
    coberturaFacturasPct: number; eurPorKwhMedio: number
    suministrosCount: number; suministrosConFacturas: number; suministrosSinConsumo: number
    invoicesCount: number
    porTipo: {
      luz: {
        gasto: number; gastoAnualizado: number; consumoAnualKwh: number
        consumoFacturadoKwh: number; suministros: number; eurPorKwhMedio: number
        coberturaPct: number; excesos: number; reactiva: number
        consumoPorPeriodo: Record<string, number>; precioMedioPorPeriodo: Record<string, number>
      }
      gas: {
        gasto: number; gastoAnualizado: number; consumoAnualKwh: number
        consumoFacturadoKwh: number; suministros: number; eurPorKwhMedio: number; coberturaPct: number
      }
    }
  }
  topConsumidores: SupplyAggregate[]
  topGastadores: SupplyAggregate[]
  anomalias: SupplyAggregate[]
  ranking: SupplyAggregate[]
  monthly: Monthly[]
  porTarifa: Array<{ tarifa: string; suministros: number; gasto: number; consumoAnualKwh: number; eurPorKwh: number }>
  porDistribuidora: Array<{ distribuidora: string; suministros: number; consumoAnualKwh: number; gasto: number }>
  concentracionPeriodos: { p1: number; p2: number; p3: number; p4: number; p5: number; p6: number; dominante: string; dominantePct: number }
}

const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const fmt = (n: number | null | undefined, d = 2): string => {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
}
const fmtEur = (n: number | null | undefined) => `${fmt(n, 2)} €`
const fmtKwh = (n: number | null | undefined) => `${fmt(n, 0)} kWh`
const fmtPct = (n: number) => `${fmt(n, 1)} %`

// ════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

export default function PortalGlobalPage() {
  const params = useParams()
  const router = useRouter()
  const token = String(params?.token || '')

  // Estado completo declarado primero
  const [clientId, setClientId] = useState<string>('')
  const [mode, setMode] = useState<Mode>('global')
  const [yearSelected, setYearSelected] = useState<number | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [raw, setRaw] = useState<RawDataset | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const customReady = mode !== 'custom' || (from && to)

  // Años disponibles a partir de las facturas (descendente, sin duplicados)
  const availableYears = useMemo(() => {
    if (!raw) return []
    const ys = new Set<number>()
    for (const inv of raw.invoices) {
      const d = inv.period_end || inv.period_start
      if (!d) continue
      const y = new Date(d).getFullYear()
      if (!isNaN(y) && y > 1990) ys.add(y)
    }
    return [...ys].sort((a, b) => b - a)
  }, [raw])

  // ── One-shot init: auth + dataset en UNA SOLA request ──
  // Sustituye los dos useEffect anteriores (auth → data secuenciales).
  // El endpoint /api/portal/init valida token, setea cookie y devuelve el
  // raw dataset en la misma respuesta. Esto recorta ~1 round-trip
  // (típicamente 300-500ms en móvil 4G).
  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true); setError(null)

    fetch('/api/portal/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || 'Enlace inválido o caducado')
        return d
      })
      .then(d => {
        if (cancelled) return
        setClientId(d.clientId)
        setRaw({ client: d.client, supplies: d.supplies, invoices: d.invoices })
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Error') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [token])

  // ── Cómputo client-side ──
  // Se reejecuta cuando cambian los filtros pero NO hace fetch.
  // Mapping del Mode UI → OverviewMode del motor:
  //   • 'global' → 'last12' (12 facturas más recientes por supply)
  //   • 'year'   → 'custom' con from=YYYY-01-01, to=YYYY-12-31
  //   • 'custom' → 'custom' con las fechas seleccionadas
  const data: Overview | null = useMemo(() => {
    if (!raw || !customReady) return null
    try {
      let engineMode: OverviewMode = 'last12'
      let engineFrom: string | undefined
      let engineTo: string | undefined

      if (mode === 'global') {
        engineMode = 'last12'
      } else if (mode === 'year' && yearSelected) {
        engineMode = 'custom'
        engineFrom = `${yearSelected}-01-01`
        engineTo = `${yearSelected}-12-31`
      } else if (mode === 'custom') {
        engineMode = 'custom'
        engineFrom = from
        engineTo = to
      }

      const result = computarOverview({
        supplies: raw.supplies,
        invoices: raw.invoices,
        mode: engineMode,
        from: engineFrom,
        to: engineTo,
        typeFilter,
      })
      return { client: raw.client, ...result } as Overview
    } catch (e: any) {
      console.error('[overview compute]', e)
      return null
    }
  }, [raw, mode, yearSelected, typeFilter, from, to, customReady])

  if (loading && !raw) {
    return <PortalSkeleton />
  }

  if (!raw) {
    return (
      <div style={{ background: '#F0F6FF', minHeight: '100vh', padding: '3rem' }}>
        <div className="max-w-2xl mx-auto p-6 rounded-2xl bg-white border border-red-200 flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5" />
          <p>{error || 'No hay datos'}</p>
        </div>
      </div>
    )
  }

  // El Header se muestra SIEMPRE (incluso si todavía no hay data por filtros
  // incompletos). Usa raw.client para no perder el nombre del cliente.
  const headerClient = data?.client || raw.client

  return (
    <div className="voltis-overview font-sans" style={{ background: '#F0F6FF', minHeight: '100vh', color: '#1E293B' }}>
      <style jsx global>{`
        .voltis-overview, .voltis-overview * {
          font-family: 'Inter', -apple-system, system-ui, sans-serif;
        }
        .voltis-overview .num {
          font-family: 'Geist Mono', 'SF Mono', monospace;
        }
      `}</style>

      <Header
        client={headerClient}
        totals={data?.totals}
        windowDescription={data?.windowDescription}
        mode={mode} setMode={setMode}
        yearSelected={yearSelected} setYearSelected={setYearSelected}
        availableYears={availableYears}
        from={from} to={to} setFrom={setFrom} setTo={setTo}
        typeFilter={typeFilter} setTypeFilter={setTypeFilter}
        router={router}
      />

      {/* Mientras esperamos a que el modo Personalizado tenga fechas, mostramos
          mensaje informativo en vez de pantalla en blanco. */}
      {!customReady || !data ? (
        <section className="px-6 md:px-12 -mt-12 relative z-10">
          <div className="rounded-2xl bg-white p-8 text-center text-slate-600 shadow-lg">
            {mode === 'custom' && !customReady
              ? 'Selecciona la fecha de inicio y fin del rango personalizado.'
              : 'Sin datos para los filtros seleccionados.'}
          </div>
        </section>
      ) : null}

      {data && customReady && (<>
      {/* KPIs principales */}
      <section className="px-6 md:px-12 -mt-12 pb-8 relative z-10">
        <KpiGrid totals={data.totals} />
      </section>

      {/* Banner cobertura */}
      <section className="px-6 md:px-12 pb-6">
        <CoberturaBanner totals={data.totals} fechaSips={data.fechaSipsMasReciente} />
      </section>

      {/* Por tipo: Luz y Gas en detalle */}
      <section className="px-6 md:px-12 pb-8 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BloqueLuz luz={data.totals.porTipo.luz} concentracion={data.concentracionPeriodos} />
        <BloqueGas gas={data.totals.porTipo.gas} />
      </section>

      {/* Top consumidores + Top gastadores */}
      <section className="px-6 md:px-12 pb-8 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TopCard title="Top consumidores" subtitle="Mayor consumo anual" icon={<Zap className="w-4 h-4" />} items={data.topConsumidores} metric="consumo" router={router} />
        <TopCard title="Top gastadores" subtitle="Mayor gasto en el periodo" icon={<TrendingUp className="w-4 h-4" />} items={data.topGastadores} metric="gasto" router={router} />
      </section>

      {/* Anomalías */}
      {data.anomalias.length > 0 && (
        <section className="px-6 md:px-12 pb-8">
          <AnomaliasCard items={data.anomalias} router={router} />
        </section>
      )}

      {/* Evolución mensual */}
      {data.monthly.length >= 2 && (
        <section className="px-6 md:px-12 pb-8">
          <SectionBlock num="04" title="Evolución mensual" subtitle="Gasto por mes separando luz y gas">
            <MonthlyChart monthly={data.monthly} />
          </SectionBlock>
        </section>
      )}

      {/* Ranking completo */}
      <section className="px-6 md:px-12 pb-8">
        <SectionBlock num="05" title="Todos los suministros" subtitle={`${data.totals.suministrosCount} suministros · ${data.totals.invoicesCount} facturas analizadas`}>
          <RankingTable items={data.ranking} totalGasto={data.totals.gastoTotal} router={router} />
        </SectionBlock>
      </section>

      {/* Reparto por tarifa */}
      {data.porTarifa.length > 1 && (
        <section className="px-6 md:px-12 pb-8">
          <SectionBlock num="06" title="Reparto por tarifa" subtitle="€/kWh por tipo de tarifa — el dato más útil para optimizar">
            <TarifaTable items={data.porTarifa} totalGasto={data.totals.gastoTotal} />
          </SectionBlock>
        </section>
      )}

      {/* Distribuidoras */}
      {data.porDistribuidora.length > 0 && (
        <section className="px-6 md:px-12 pb-8">
          <SectionBlock num="07" title="Distribuidoras" subtitle="Reparto por compañía distribuidora del cliente">
            <DistribuidoraTable items={data.porDistribuidora} />
          </SectionBlock>
        </section>
      )}

      </>)}

      <PortalFooter />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// FOOTER — mascota Voltis + contacto destacado.
// El cliente termina la página viendo el rostro Voltis y los datos para
// contactar si tiene cualquier consulta. Es la "firma" del portal.
// ════════════════════════════════════════════════════════════════════════════

function PortalFooter() {
  return (
    <footer className="px-6 md:px-12 py-12 mt-8 border-t border-blue-100 bg-white">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-6">
        <BuddyIcon size={88} />
        <div className="flex-1 text-center md:text-left">
          <p className="text-base font-semibold text-slate-800 mb-1">
            ¿Tienes alguna duda con tus datos?
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            Para cualquier consulta sobre tus suministros, facturas o este estudio energético,
            escríbenos a{' '}
            <a href="mailto:clientes@voltisenergia.com" className="font-semibold text-[#3B4FE4] hover:underline">
              clientes@voltisenergia.com
            </a>
            {' '}o llámanos al{' '}
            <a href="tel:+34747474360" className="font-semibold text-[#3B4FE4] hover:underline whitespace-nowrap">
              747 474 360
            </a>
            . Te respondemos en menos de 24h.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div className="font-semibold text-slate-700">Voltis Energía</div>
          <div className="num mt-1">
            Generado {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>
    </footer>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// HEADER (hero azul con Buddy)
// ════════════════════════════════════════════════════════════════════════════

function Header({
  client, totals, windowDescription,
  mode, setMode, yearSelected, setYearSelected, availableYears,
  from, to, setFrom, setTo, typeFilter, setTypeFilter, router,
}: any) {
  const suministros = totals?.suministrosCount
  const facturas = totals?.invoicesCount

  return (
    <header className="relative overflow-hidden pb-20" style={{
      background: 'linear-gradient(135deg, #A8C8F0 0%, #6FA0E8 60%, #4A6FE3 100%)',
    }}>
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-10 right-10 w-96 h-96 rounded-full" style={{ background: 'radial-gradient(circle, #FFFFFF 0%, transparent 70%)' }} />
      </div>

      <div className="relative px-6 md:px-12 pt-8">
        <button onClick={() => {
                fetch('/api/portal/auth', { method: 'DELETE' }).finally(() => router.push('/'))
              }}
          className="flex items-center gap-2 text-xs font-medium text-white/80 hover:text-white transition mb-8">
          <ArrowLeft className="w-4 h-4" />
          Cerrar sesión
        </button>

        <div className="flex items-center gap-8 flex-wrap">
          <BuddyIcon size={96} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold tracking-[0.22em] text-white/70 uppercase mb-2">
              Estudio económico global
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
              {client?.name || 'Cliente'}
            </h1>
            <p className="text-sm text-white/80 mt-2">
              {windowDescription ? `${windowDescription} · ` : ''}
              {suministros != null ? `${suministros} suministros · ` : ''}
              {facturas != null ? `${facturas} facturas analizadas` : 'Cargando…'}
            </p>
          </div>
          {client?.id && (
            <DownloadGlobalExcelButton
              clientId={client.id} clientName={client.name}
              mode={mode} from={from} to={to} typeFilter={typeFilter}
              yearSelected={yearSelected}
            />
          )}
        </div>

        {/* Filtros — Periodo */}
        <div className="flex flex-wrap items-center gap-2 mt-8">
          <span className="text-[10px] font-bold tracking-wider text-white/70 uppercase mr-2">Periodo</span>
          <Chip active={mode === 'global'} onClick={() => { setMode('global'); setYearSelected(null) }}>
            Global
          </Chip>
          {availableYears.map((yr: number) => (
            <Chip
              key={yr}
              active={mode === 'year' && yearSelected === yr}
              onClick={() => { setMode('year'); setYearSelected(yr) }}
            >
              {yr}
            </Chip>
          ))}
          <Chip active={mode === 'custom'} onClick={() => setMode('custom')}>
            Personalizado
          </Chip>
          {mode === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-1.5 text-xs rounded-xl bg-white/95 text-slate-700 num" />
              <span className="text-white/70">→</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-1.5 text-xs rounded-xl bg-white/95 text-slate-700 num" />
            </div>
          )}

          <span className="text-[10px] font-bold tracking-wider text-white/70 uppercase ml-6 mr-2">Tipo</span>
          <Chip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Todos</Chip>
          <Chip active={typeFilter === 'luz'} onClick={() => setTypeFilter('luz')}><Zap className="w-3 h-3 inline mr-1" />Luz</Chip>
          <Chip active={typeFilter === 'gas'} onClick={() => setTypeFilter('gas')}><Flame className="w-3 h-3 inline mr-1" />Gas</Chip>
        </div>
      </div>
    </header>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Skeleton UI — placeholder durante carga inicial.
// Aparece INMEDIATAMENTE (sin spinner), reduciendo la sensación de espera.
// Su layout imita la estructura final, así no hay "layout shift" al cargar.
// ════════════════════════════════════════════════════════════════════════════

function PortalSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#F0F6FF' }}>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .skel { animation: pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite; background: rgba(255,255,255,0.65); border-radius: 12px; }
        .skel-dark { animation: pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite; background: rgba(255,255,255,0.3); border-radius: 12px; }
      `}</style>
      {/* Hero skeleton */}
      <div className="pb-20" style={{ background: 'linear-gradient(135deg, #A8C8F0 0%, #6FA0E8 60%, #4A6FE3 100%)' }}>
        <div className="px-6 md:px-12 pt-8">
          <div className="skel-dark mb-8" style={{ width: 120, height: 14 }} />
          <div className="flex items-center gap-8 flex-wrap">
            <div className="skel-dark" style={{ width: 96, height: 96, borderRadius: '50%' }} />
            <div className="flex-1 min-w-0">
              <div className="skel-dark mb-3" style={{ width: 200, height: 12 }} />
              <div className="skel-dark mb-3" style={{ width: 380, height: 40 }} />
              <div className="skel-dark" style={{ width: 280, height: 14 }} />
            </div>
            <div className="skel-dark" style={{ width: 200, height: 42, borderRadius: 999 }} />
          </div>
          <div className="flex gap-2 mt-8">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skel-dark" style={{ width: 110, height: 28, borderRadius: 999 }} />
            ))}
          </div>
        </div>
      </div>
      {/* KPI cards skeleton */}
      <div className="px-6 md:px-12 -mt-12 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skel" style={{ height: 132 }} />
          ))}
        </div>
      </div>
      {/* Cuerpo */}
      <div className="px-6 md:px-12 pt-8 space-y-5">
        <div className="skel" style={{ height: 60 }} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="skel" style={{ height: 260 }} />
          <div className="skel" style={{ height: 260 }} />
        </div>
        <div className="skel" style={{ height: 340 }} />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Prefetch supply data en hover — recorta el tiempo de apertura del detalle.
// Cuando el cliente pasa el ratón sobre una fila/card, ya iniciamos la
// petición al endpoint del suministro. El navegador la cachea y cuando
// hace click, los datos están listos.
// ════════════════════════════════════════════════════════════════════════════

const prefetchedSupplies = new Set<string>()
function prefetchSupply(supplyId: string) {
  if (prefetchedSupplies.has(supplyId)) return
  prefetchedSupplies.add(supplyId)
  // POST silent — el navegador cachea por Cache-Control: private, max-age=60.
  fetch(`/api/portal/supply/${supplyId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    keepalive: true,
  }).catch(() => { prefetchedSupplies.delete(supplyId) })
}

// ════════════════════════════════════════════════════════════════════════════
// Botón Descargar Excel global
// ════════════════════════════════════════════════════════════════════════════

function DownloadGlobalExcelButton({ clientId, clientName, mode, from, to, typeFilter, yearSelected }: {
  clientId: string; clientName?: string; mode: string; from?: string; to?: string; typeFilter: string
  yearSelected?: number | null
}) {
  const [loading, setLoading] = useState(false)
  const handle = async () => {
    if (loading) return
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      // Cuando el modo es 'year' enviamos el año explícito.
      // 'global' y 'custom' delegan en el endpoint (rango por defecto).
      if (mode === 'year' && yearSelected) qs.set('year', String(yearSelected))
      if (typeFilter && typeFilter !== 'all') qs.set('type', typeFilter)
      const res = await fetch(`/api/public/v1/clients/${clientId}/export/global?${qs.toString()}`)
      if (!res.ok) throw new Error('No se pudo generar el Excel global')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = clientExcelFilename({
        clientName,
        year: mode === 'year' && yearSelected ? yearSelected : null,
      })
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e.message || 'Error descargando Excel')
    } finally {
      setLoading(false)
    }
  }
  return (
    <button onClick={handle} disabled={loading}
      className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition shadow-lg
                 disabled:opacity-60 disabled:cursor-not-allowed"
      style={{ background: '#FFFFFF', color: '#4A6FE3' }}>
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <Download className="w-4 h-4" />
      }
      {loading ? 'Generando…' : 'Descargar Excel global'}
    </button>
  )
}

function Chip({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
        active ? 'bg-white text-[#4A6FE3] shadow-md' : 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm'
      }`}
    >
      {children}
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BUDDY — mascota Voltis SVG inline
// ════════════════════════════════════════════════════════════════════════════

function BuddyIcon({ size = 64 }: { size?: number }) {
  return (
    <img
      src="/mascota-transparente.png"
      alt="Voltis"
      width={size}
      height={size}
      style={{
        width: size,
        height: 'auto',
        filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))',
      }}
    />
  )
}

// ════════════════════════════════════════════════════════════════════════════
// KPI Grid principal
// ════════════════════════════════════════════════════════════════════════════

function KpiGrid({ totals }: { totals: Overview['totals'] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Kpi big icon={<TrendingUp className="w-5 h-5" />} label="Gasto total del periodo"
        value={fmt(totals.gastoTotal, 2)} unit="€"
        hint={totals.gastoAnualizado > totals.gastoTotal * 1.05
          ? `Anualizado: ${fmt(totals.gastoAnualizado, 0)} €/año`
          : undefined} />
      <Kpi icon={<Activity className="w-5 h-5" />} label="Consumo anual (oficial)"
        value={fmt(totals.consumoTotalKwh, 0)} unit="kWh"
        hint={`Cobertura facturas: ${fmtPct(totals.coberturaFacturasPct)}`} />
      <Kpi icon={<BarChart3 className="w-5 h-5" />} label="Suministros"
        value={String(totals.suministrosCount)} unit="totales"
        hint={`${totals.suministrosConFacturas} con facturas en el periodo`} />
    </div>
  )
}

function Kpi({ icon, label, value, unit, hint, big = false }: any) {
  return (
    <div className={`rounded-2xl p-6 ${big ? 'md:col-span-1' : ''}`} style={{
      background: big ? 'linear-gradient(135deg, #4A6FE3 0%, #2E4FBF 100%)' : '#FFFFFF',
      color: big ? '#FFFFFF' : '#1E293B',
      boxShadow: '0 10px 40px -10px rgba(74,111,227,0.25)',
    }}>
      <div className="flex items-center gap-2 mb-3" style={{ color: big ? '#C7DBFF' : '#4A6FE3' }}>
        {icon}
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase">{label}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold num">{value}</span>
        {unit && <span className="text-base font-medium" style={{ color: big ? '#C7DBFF' : '#64748B' }}>{unit}</span>}
      </div>
      {hint && <div className="text-xs mt-3" style={{ color: big ? '#C7DBFF' : '#64748B' }}>{hint}</div>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Banner cobertura
// ════════════════════════════════════════════════════════════════════════════

function CoberturaBanner({ totals, fechaSips }: { totals: Overview['totals']; fechaSips: string | null }) {
  // Banner INFORMATIVO en tono neutro. No es una alerta: la cobertura puede
  // ser <100% porque el cliente ha facturado solo parte del año (ej. activación
  // a mitad de año), no porque algo esté "mal" en el estudio.
  const cobertura = totals.coberturaFacturasPct
  const sinFacturas = totals.suministrosSinConsumo > 0

  return (
    <div className="rounded-2xl px-4 py-3 flex items-start gap-3 border bg-blue-50/60 border-blue-200">
      <Info className="w-4 h-4 flex-shrink-0 text-blue-600 mt-0.5" />
      <div className="flex-1 text-xs text-slate-600 leading-relaxed">
        <span className="font-semibold text-slate-800">Cobertura {fmtPct(cobertura)}.</span>{' '}
        Las facturas analizadas cubren <span className="num">{fmt(totals.consumoFacturadoTotalKwh, 0)}</span> kWh
        de los <span className="num">{fmt(totals.consumoTotalKwh, 0)}</span> kWh anuales totales según SIPS/distribuidora.
        {fechaSips && <span> Datos oficiales actualizados a {new Date(fechaSips).toLocaleDateString('es-ES')}.</span>}
        {sinFacturas && <span> {totals.suministrosSinConsumo} suministros aún sin consumo SIPS registrado.</span>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BloqueLuz — todo el detalle eléctrico
// ════════════════════════════════════════════════════════════════════════════

function BloqueLuz({ luz, concentracion }: { luz: Overview['totals']['porTipo']['luz']; concentracion: Overview['concentracionPeriodos'] }) {
  if (luz.suministros === 0) return null
  const periodos: Array<{ k: string; lbl: string; color: string }> = [
    { k: 'P1', lbl: 'Punta', color: '#FBBF24' },
    { k: 'P2', lbl: 'Llano', color: '#A78BFA' },
    { k: 'P3', lbl: 'Valle', color: '#34D399' },
    { k: 'P4', lbl: 'P4', color: '#FB7185' },
    { k: 'P5', lbl: 'P5', color: '#60A5FA' },
    { k: 'P6', lbl: 'Supervalle', color: '#22C55E' },
  ]
  const totalP = Object.values(luz.consumoPorPeriodo).reduce((s, v) => s + v, 0) || 1

  return (
    <div className="rounded-2xl bg-white p-6 space-y-5" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
      <div className="flex items-center gap-3">
        <div className="rounded-xl p-2.5" style={{ background: '#FEF3C7', color: '#B45309' }}><Zap className="w-5 h-5" /></div>
        <div className="flex-1">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-500">Electricidad</div>
          <h3 className="text-xl font-bold text-slate-800">{luz.suministros} suministros</h3>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MiniKpi label="Gasto" value={fmtEur(luz.gasto)} />
        <MiniKpi label="Consumo anual" value={fmtKwh(luz.consumoAnualKwh)} />
        <MiniKpi label="€/kWh medio" value={fmt(luz.eurPorKwhMedio, 4)} unit="€/kWh" />
      </div>

      {(luz.excesos > 0 || luz.reactiva > 0) && (
        <div className="rounded-xl p-3 bg-slate-50 text-xs space-y-1">
          {luz.excesos > 0 && (
            <div className="text-slate-700">
              <strong className="num">{fmtEur(luz.excesos)}</strong> facturados en <strong>excesos de potencia</strong>.
            </div>
          )}
          {luz.reactiva > 0 && (
            <div className="text-slate-700">
              <strong className="num">{fmtEur(luz.reactiva)}</strong> facturados en <strong>energía reactiva</strong>.
            </div>
          )}
        </div>
      )}

      {/* Concentración periodos */}
      {totalP > 1 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-500">Concentración por periodo</div>
            <div className="text-xs text-slate-600">
              Dominante: <strong className="text-slate-800">{concentracion.dominante}</strong> · {fmtPct(concentracion.dominantePct)}
            </div>
          </div>
          <div className="flex h-7 rounded-lg overflow-hidden" style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }}>
            {periodos.map(p => {
              const pct = (luz.consumoPorPeriodo[p.k] / totalP) * 100
              if (pct < 0.5) return null
              return (
                <div key={p.k} style={{ width: `${pct}%`, background: p.color }}
                  className="flex items-center justify-center text-[10px] font-bold text-white"
                  title={`${p.k} ${p.lbl}: ${fmtPct(pct)} · ${fmtKwh(luz.consumoPorPeriodo[p.k])}`}>
                  {pct > 8 ? `${p.k} ${pct.toFixed(0)}%` : ''}
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3 text-[11px]">
            {periodos.map(p => (
              <div key={p.k} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
                <span className="text-slate-600">{p.k}: {fmt(luz.consumoPorPeriodo[p.k], 0)} kWh</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Precio medio por periodo */}
      {Object.values(luz.precioMedioPorPeriodo).some(v => v > 0) && (
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-500 mb-2">Precio medio €/kWh por periodo</div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            {periodos.map(p => {
              const v = luz.precioMedioPorPeriodo[p.k] || 0
              if (v === 0) return null
              return (
                <div key={p.k} className="rounded-lg bg-slate-50 p-2 text-center">
                  <div className="text-[10px] text-slate-500 font-bold">{p.k}</div>
                  <div className="text-sm font-semibold text-slate-800 num">{fmt(v, 4)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BloqueGas
// ════════════════════════════════════════════════════════════════════════════

function BloqueGas({ gas }: { gas: Overview['totals']['porTipo']['gas'] }) {
  if (gas.suministros === 0) return null
  return (
    <div className="rounded-2xl bg-white p-6 space-y-5" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
      <div className="flex items-center gap-3">
        <div className="rounded-xl p-2.5" style={{ background: '#FFEDD5', color: '#C2410C' }}><Flame className="w-5 h-5" /></div>
        <div className="flex-1">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-500">Gas natural</div>
          <h3 className="text-xl font-bold text-slate-800">{gas.suministros} suministros</h3>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MiniKpi label="Gasto" value={fmtEur(gas.gasto)} />
        <MiniKpi label="Consumo anual" value={fmtKwh(gas.consumoAnualKwh)} />
        <MiniKpi label="€/kWh medio" value={fmt(gas.eurPorKwhMedio, 4)} unit="€/kWh" />
      </div>

      <div className="rounded-xl p-3 bg-slate-50 text-xs text-slate-600 leading-relaxed">
        Consumo anual oficial del Excel ConsumoAnual de la distribuidora. En gas el único concepto competitivo es el TV Precio Fijo (€/kWh) — término fijo, peaje, IEH y alquileres son regulados.
      </div>
    </div>
  )
}

function MiniKpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500 mb-1">{label}</div>
      <div className="text-base font-bold num text-slate-800">
        {value} {unit && <span className="text-xs font-medium text-slate-500">{unit}</span>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Top consumidores/gastadores
// ════════════════════════════════════════════════════════════════════════════

function TopCard({ title, subtitle, icon, items, metric, router }: any) {
  const params = useParams()
  const token = String(params?.token || '')
  if (!items?.length) return null
  return (
    <div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="rounded-xl p-2 text-[#4A6FE3] bg-blue-50">{icon}</div>
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-500">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((r: any, i: number) => (
          <button key={r.supply.id}
            onClick={() => router.push(`/portal/${token}/supplies/${r.supply.id}`)}
            onMouseEnter={() => prefetchSupply(r.supply.id)}
            onFocus={() => prefetchSupply(r.supply.id)}
            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 transition text-left">
            <div className="text-xs font-bold text-slate-400 w-6">#{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">{r.supply.name || r.supply.cups}</div>
              <div className="text-[10px] num text-slate-500">{r.supply.cups} · {r.supply.tariff}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold num text-slate-800">
                {metric === 'consumo' ? fmtKwh(r.consumoAnualKwh) : fmtEur(r.totalGasto)}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Anomalías
// ════════════════════════════════════════════════════════════════════════════

function AnomaliasCard({ items, router }: { items: SupplyAggregate[]; router: any }) {
  const params = useParams()
  const token = String(params?.token || '')
  return (
    <div className="rounded-2xl bg-white p-6 border-l-4 border-amber-400" style={{ boxShadow: '0 10px 40px -10px rgba(245,158,11,0.2)' }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="rounded-xl p-2 bg-amber-100 text-amber-700"><AlertTriangle className="w-5 h-5" /></div>
        <div className="flex-1">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-700">Anomalías detectadas</div>
          <h3 className="text-base font-bold text-slate-800">{items.length} suministros con €/kWh fuera de rango</h3>
        </div>
      </div>
      <p className="text-xs text-slate-600 mb-3">
        Suministros con €/kWh fuera de la banda media del cliente. Se listan únicamente como lectura para inspección.
      </p>
      <div className="space-y-2">
        {items.slice(0, 5).map(r => (
          <button key={r.supply.id}
            onClick={() => router.push(`/portal/${token}/supplies/${r.supply.id}`)}
            onMouseEnter={() => prefetchSupply(r.supply.id)}
            onFocus={() => prefetchSupply(r.supply.id)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 transition text-left">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">{r.supply.name || r.supply.cups}</div>
              <div className="text-[10px] num text-slate-500">{r.supply.tariff}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">€/kWh</div>
              <div className="text-sm font-bold num text-amber-900">{fmt(r.eurPorKwh, 4)}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-700" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Sección genérica
// ════════════════════════════════════════════════════════════════════════════

function SectionBlock({ num, title, subtitle, children }: any) {
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-[10px] font-bold tracking-[0.18em] uppercase num text-[#4A6FE3]">{num}</span>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Ranking completo
// ════════════════════════════════════════════════════════════════════════════

function RankingTable({ items, totalGasto, router }: { items: SupplyAggregate[]; totalGasto: number; router: any }) {
  const params = useParams()
  const token = String(params?.token || '')
  return (
    <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="py-3 px-4 text-left text-[10px] font-bold tracking-wider uppercase text-slate-500">Suministro</th>
              <th className="py-3 px-4 text-left text-[10px] font-bold tracking-wider uppercase text-slate-500">Tipo</th>
              <th className="py-3 px-4 text-left text-[10px] font-bold tracking-wider uppercase text-slate-500">Tarifa</th>
              <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">Facturas</th>
              <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">Consumo anual</th>
              <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">€/kWh</th>
              <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">Gasto</th>
              <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">% total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map(r => {
              const pct = totalGasto > 0 ? (r.totalGasto / totalGasto) * 100 : 0
              const isGas = r.supply.type === 'gas'
              return (
                <tr key={r.supply.id}
                  onClick={() => router.push(`/portal/${token}/supplies/${r.supply.id}`)}
                  onMouseEnter={() => prefetchSupply(r.supply.id)}
                  className={`border-b border-slate-50 cursor-pointer hover:bg-blue-50 transition ${r.sinFacturas ? 'opacity-60' : ''} ${r.esAnomalo ? 'bg-amber-50/40' : ''}`}>
                  <td className="py-3 px-4">
                    <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      {r.supply.name || r.supply.cups}
                      {r.esAnomalo && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                    </div>
                    <div className="text-[10px] num text-slate-400">{r.supply.cups}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${isGas ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-800'}`}>
                      {isGas ? <Flame className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                      {isGas ? 'gas' : 'luz'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs font-semibold text-slate-700">{r.supply.tariff || '—'}</td>
                  <td className="py-3 px-4 text-right num text-sm text-slate-700">
                    {r.sinFacturas ? <span className="italic text-slate-400">sin facturas</span> : r.invoicesCount}
                  </td>
                  <td className="py-3 px-4 text-right num text-sm text-slate-700">{fmtKwh(r.consumoAnualKwh)}</td>
                  <td className="py-3 px-4 text-right num text-sm text-slate-500">{r.eurPorKwh > 0 ? fmt(r.eurPorKwh, 4) : '—'}</td>
                  <td className="py-3 px-4 text-right num text-sm font-bold text-[#4A6FE3]">{r.totalGasto > 0 ? fmtEur(r.totalGasto) : '—'}</td>
                  <td className="py-3 px-4 text-right num text-xs text-slate-500">{r.totalGasto > 0 ? fmtPct(pct) : '—'}</td>
                  <td className="py-3 px-2"><ChevronRight className="w-4 h-4 text-slate-300" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tabla por tarifa
// ════════════════════════════════════════════════════════════════════════════

function TarifaTable({ items, totalGasto }: any) {
  return (
    <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="py-3 px-4 text-left text-[10px] font-bold tracking-wider uppercase text-slate-500">Tarifa</th>
            <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">Suministros</th>
            <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">Consumo anual</th>
            <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">€/kWh</th>
            <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">Gasto</th>
            <th className="py-3 px-4 text-right text-[10px] font-bold tracking-wider uppercase text-slate-500">% total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t: any) => {
            const pct = totalGasto > 0 ? (t.gasto / totalGasto) * 100 : 0
            return (
              <tr key={t.tarifa} className="border-b border-slate-50 hover:bg-blue-50/40">
                <td className="py-3 px-4 text-sm font-semibold text-slate-800">{t.tarifa}</td>
                <td className="py-3 px-4 text-right num text-sm">{t.suministros}</td>
                <td className="py-3 px-4 text-right num text-sm">{fmtKwh(t.consumoAnualKwh)}</td>
                <td className="py-3 px-4 text-right num text-sm font-semibold text-[#4A6FE3]">{t.eurPorKwh > 0 ? fmt(t.eurPorKwh, 4) : '—'}</td>
                <td className="py-3 px-4 text-right num text-sm font-bold">{fmtEur(t.gasto)}</td>
                <td className="py-3 px-4 text-right num text-xs text-slate-500">{fmtPct(pct)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Mapping de códigos de distribuidora a nombres reconocibles.
// Los códigos vienen del SIPS — el cliente final no los entiende.
const DISTRIBUIDORA_NAMES: Record<string, string> = {
  '0021': 'Iberdrola Distribución',
  '0022': 'Endesa Distribución',
  '0023': 'Naturgy Distribución (Unión Fenosa)',
  '0024': 'EDP Distribución (HC Energía)',
  '0026': 'Viesgo Distribución',
  '0029': 'E·redes (Iberdrola)',
  '0288': 'i-DE Redes Eléctricas',
  '0226': 'Nedgia Navarra (gas)',
  '0225': 'Nedgia (gas)',
  '0234': 'Madrileña Red de Gas',
  '0235': 'Redexis Gas',
  '0236': 'Nortegas',
}

function prettyDistribuidora(raw: string): string {
  if (!raw || raw === 'Sin distribuidora' || raw === '—') return 'Distribuidora no identificada'
  // Si es un código de 4 dígitos
  if (/^\d{4}$/.test(raw)) {
    return DISTRIBUIDORA_NAMES[raw] || `Distribuidora código ${raw}`
  }
  // Caso explícito por substring
  for (const [code, name] of Object.entries(DISTRIBUIDORA_NAMES)) {
    if (raw.includes(code)) return name
  }
  // Si ya es nombre legible, lo capitalizamos correctamente
  return raw.replace(/\b\w/g, c => c.toUpperCase())
}

function DistribuidoraTable({ items }: any) {
  return (
    <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
      <div className="space-y-2">
        {items.map((d: any) => {
          const name = prettyDistribuidora(d.distribuidora)
          return (
            <div key={d.distribuidora} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
              <div className="text-sm font-semibold text-slate-800">{name}</div>
              <div className="flex items-center gap-6 text-xs text-slate-600">
                <span><strong>{d.suministros}</strong> suministros</span>
                <span className="num">{fmtKwh(d.consumoAnualKwh)}</span>
                <span className="num font-bold text-[#4A6FE3]">{fmtEur(d.gasto)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Gráfico mensual
// ════════════════════════════════════════════════════════════════════════════

function MonthlyChart({ monthly }: { monthly: Monthly[] }) {
  // Mostramos sólo los últimos 13 meses (año + margen). Si el cliente tiene
  // facturas antiguas residuales, evitamos que distorsionen la escala con
  // barras minúsculas indescifrables.
  const data = monthly.slice(-13)
  const max = Math.max(...data.map(m => m.total), 1)
  // Layout en función del nº de barras
  const n = data.length
  const w = 900, h = 280
  const padL = 50, padR = 20, padT = 30, padB = 60   // padB grande para etiquetas rotadas
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const barW = Math.min(40, (innerW / n) * 0.65)
  const xCenter = (i: number) => padL + (innerW / n) * (i + 0.5)
  const yFor = (v: number) => padT + innerH - (v / max) * innerH
  // Grid horizontal cada 25%
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(p => ({
    y: padT + innerH * (1 - p),
    val: max * p,
  }))

  return (
    <div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
      {monthly.length > 13 && (
        <div className="text-[11px] text-slate-500 mb-3">
          Mostrando los últimos 13 meses agregados (de {monthly.length} con datos).
        </div>
      )}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Grid horizontal con etiquetas Y */}
          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={padL} y1={g.y} x2={w - padR} y2={g.y} stroke="#F1F5F9" strokeDasharray="3 4" />
              <text x={padL - 8} y={g.y + 3} textAnchor="end" fontSize="9" fill="#94A3B8" className="num">
                {g.val >= 1000 ? `${Math.round(g.val / 1000)}k` : Math.round(g.val)}
              </text>
            </g>
          ))}

          {/* Barras */}
          {data.map((m, i) => {
            const xc = xCenter(i)
            const x = xc - barW / 2
            const yLuz = yFor(m.totalLuz)
            const yTotal = yFor(m.total)
            const hLuz = (padT + innerH) - yLuz
            const hGas = yLuz - yTotal
            return (
              <g key={`${m.year}-${m.month}`}>
                {m.totalGas > 0 && <rect x={x} y={yTotal} width={barW} height={Math.max(0, hGas)} fill="#FB923C" rx={2} />}
                {m.totalLuz > 0 && <rect x={x} y={yLuz} width={barW} height={Math.max(0, hLuz)} fill="#4A6FE3" rx={2} />}
                {/* Valor total encima — solo si supera 3% del máximo (legible) */}
                {m.total > max * 0.03 && (
                  <text x={xc} y={yTotal - 6} textAnchor="middle" fontSize="10" fill="#1E293B" className="num" fontWeight="600">
                    {m.total >= 1000 ? `${(m.total / 1000).toFixed(m.total >= 10000 ? 0 : 1)}k` : Math.round(m.total)}
                  </text>
                )}
                {/* Etiqueta mes/año rotada 45° para no solaparse */}
                <text x={xc} y={padT + innerH + 14}
                  textAnchor="end" fontSize="10" fill="#64748B" className="num"
                  transform={`rotate(-45, ${xc}, ${padT + innerH + 14})`}>
                  {MESES_SHORT[m.month]} {String(m.year).slice(-2)}
                </text>
              </g>
            )
          })}

          {/* Línea base */}
          <line x1={padL} y1={padT + innerH} x2={w - padR} y2={padT + innerH} stroke="#CBD5E1" strokeWidth="1" />
        </svg>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-slate-600">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#4A6FE3' }} /> Electricidad</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#FB923C' }} /> Gas</div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Empty state custom
// ════════════════════════════════════════════════════════════════════════════

function CustomEmptyState({ clientId, mode, setMode, from, to, setFrom, setTo, typeFilter, setTypeFilter, router }: any) {
  return (
    <div className="min-h-screen" style={{ background: '#F0F6FF' }}>
      <Header data={{ client: { id: clientId, name: '—' }, totals: { suministrosCount: 0, invoicesCount: 0 }, windowDescription: '' }}
        mode={mode} setMode={setMode} from={from} to={to} setFrom={setFrom} setTo={setTo}
        typeFilter={typeFilter} setTypeFilter={setTypeFilter} router={router} />
      <section className="px-6 md:px-12 -mt-12 relative z-10">
        <div className="rounded-2xl bg-white p-8 text-center text-slate-600" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)' }}>
          Selecciona una fecha de inicio y otra de fin para ver el estudio personalizado.
        </div>
      </section>
    </div>
  )
}
