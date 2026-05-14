'use client'

/**
 * /portal/{token}/supplies/{supplyId}
 *
 * Detalle de un suministro en el portal cliente.
 * Estética Voltis azul real (voltisenergia.com): hero sky #88B9E7 + electric
 * #3B4FE4, mascota azul, fondo gris-papel.
 *
 * En modo readOnly se reemplaza el botón "Generar informe" del CRM por
 * "Descargar Excel de suministro".
 */
import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Loader2, AlertCircle, Zap, Flame, Download } from 'lucide-react'

const AnnualEconomics = dynamic(
  () => import('@/components/supply/AnnualEconomics'),
  { ssr: false, loading: () => <div className="py-20 text-center text-slate-500">Cargando estudio…</div> }
)

interface SupplyData {
  supply: {
    id: string; cups: string | null; tariff: string | null; type: string | null
    name: string | null; clientId: string
    consumption_data?: any
  }
  invoices: any[]
}

export default function PortalSupplyPage() {
  const { token, supplyId } = useParams<{ token: string; supplyId: string }>()
  const router = useRouter()
  const [clientId, setClientId] = useState<string>('')
  const [data, setData] = useState<SupplyData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  // ── One-shot init: auth + supply data en UNA SOLA request ───────────────
  // Si hubo prefetch on hover, la respuesta viene del cache HTTP del navegador
  // (Cache-Control: private, max-age=60) y la apertura es instantánea.
  useEffect(() => {
    if (!token || !supplyId) return
    let cancelled = false
    setLoading(true); setError(null)

    fetch(`/api/portal/supply/${supplyId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || 'No se pudo cargar el suministro')
        return d
      })
      .then(d => {
        if (cancelled) return
        setClientId(d.clientId)
        setData({ supply: d.supply, invoices: d.invoices })
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [token, supplyId])

  // Descargar Excel del suministro
  const downloadSupplyExcel = async () => {
    if (!clientId || !supplyId || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/public/v1/clients/${clientId}/export/supply/${supplyId}`)
      if (!res.ok) throw new Error('No se pudo generar el Excel')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = (data?.supply.name || data?.supply.cups || 'suministro').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      a.download = `voltis-${safeName}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e.message || 'Error descargando Excel')
    } finally {
      setDownloading(false)
    }
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: '#F7F7F7' }}>
      <div className="text-center max-w-md">
        <AlertCircle className="w-12 h-12 text-rose-600 mx-auto mb-3" />
        <p className="text-slate-700">{error}</p>
        <button onClick={() => router.push(`/portal/${token}`)} className="mt-4 text-sm text-[#3B4FE4] hover:underline">
          ← Volver al portal
        </button>
      </div>
    </div>
  )
  if (loading || !data) return <SupplyPageSkeleton />


  const isGas = data.supply.type === 'gas' || /^RL/i.test(data.supply.tariff || '')
  const Icon = isGas ? Flame : Zap

  return (
    <div className="min-h-screen" style={{ background: '#F7F7F7' }}>
      {/* Header Voltis azul cielo (paleta voltisenergia.com) */}
      <header className="text-white px-6 md:px-10 py-6 relative overflow-hidden"
        style={{ background: '#88B9E7' }}>
        {/* Banda inferior azul electric */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: '#3B4FE4' }} />

        <div className="max-w-7xl mx-auto relative">
          <button onClick={() => router.push(`/portal/${token}`)}
            className="inline-flex items-center gap-1.5 text-white/85 hover:text-white text-sm mb-4 font-medium">
            <ArrowLeft className="w-4 h-4" /> Volver a tu portal
          </button>
          <div className="flex items-start gap-5">
            <img src="/mascota-transparente.png" alt="Voltis" width={84} height={84}
              style={{ width: 84, height: 'auto', filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.15))' }} />
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-bold text-white/90">
                <Icon className="w-3 h-3" /> {data.supply.tariff} · {isGas ? 'Gas Natural' : 'Electricidad'}
              </div>
              <h1 className="text-2xl md:text-4xl font-bold mt-1 truncate text-white">
                {data.supply.name || data.supply.cups?.slice(-8) || 'Suministro'}
              </h1>
              <p className="font-mono text-xs text-white/80 mt-1 truncate">{data.supply.cups}</p>
            </div>
            {/* Botón Descargar Excel — esquina derecha del hero */}
            <button onClick={downloadSupplyExcel} disabled={downloading}
              className="hidden md:inline-flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition shadow-lg
                         disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: '#3B4FE4', color: '#FFFFFF' }}>
              {downloading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />
              }
              {downloading ? 'Generando…' : 'Descargar Excel del suministro'}
            </button>
          </div>
          {/* Botón móvil */}
          <button onClick={downloadSupplyExcel} disabled={downloading}
            className="md:hidden mt-4 w-full inline-flex justify-center items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition shadow-lg
                       disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: '#3B4FE4', color: '#FFFFFF' }}>
            {downloading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />
            }
            {downloading ? 'Generando…' : 'Descargar Excel del suministro'}
          </button>
        </div>
      </header>

      {/* ── Resumen rápido (especialmente útil en móvil) ───────────────── */}
      <main className="max-w-7xl mx-auto px-3 md:px-6 py-6">
        <MobileSummary data={data} onDownload={downloadSupplyExcel} downloading={downloading} />

        <div className="portal-readonly-wrapper bg-white rounded-2xl shadow-sm border border-slate-200 p-2 md:p-6 overflow-hidden">
          <style jsx global>{`
            /* ═══════════════════════════════════════════════════════════════════
               OVERRIDE BRANDING — Paleta verde/crema del CRM → azul Voltis.
               Aplicado solo dentro del wrapper del portal cliente, sin afectar
               al CRM principal. La intención es que el cliente vea coherencia
               con voltisenergia.com (sky #88B9E7, electric #3B4FE4).
               ═══════════════════════════════════════════════════════════════════ */

            /* Fondo papel crema → blanco roto / gris claro */
            .portal-readonly-wrapper [style*="background: #FBF7EE"],
            .portal-readonly-wrapper [style*="background: #F9F5EC"],
            .portal-readonly-wrapper [style*="background-color: #FBF7EE"],
            .portal-readonly-wrapper [style*="background-color: #F9F5EC"] {
              background: #F7F7F7 !important;
            }

            /* Verde bosque oscuro → ink negro azulado */
            .portal-readonly-wrapper [style*="color: #2D3A33"],
            .portal-readonly-wrapper .text-\\[\\#2D3A33\\] {
              color: #1A1A1A !important;
            }

            /* Verde medio (eyebrow / labels) → electric blue */
            .portal-readonly-wrapper [style*="color: #6B8068"],
            .portal-readonly-wrapper .text-\\[\\#6B8068\\] {
              color: #3B4FE4 !important;
            }

            /* Verde apagado (sub-labels) → gris body Voltis */
            .portal-readonly-wrapper [style*="color: #8A9A8E"],
            .portal-readonly-wrapper .text-\\[\\#8A9A8E\\] {
              color: #6E7180 !important;
            }
            .portal-readonly-wrapper [style*="color: #5A6B5F"],
            .portal-readonly-wrapper .text-\\[\\#5A6B5F\\] {
              color: #4B5563 !important;
            }

            /* Líneas/bordes crema → gris neutro */
            .portal-readonly-wrapper [style*="border-color: #E5DCC9"],
            .portal-readonly-wrapper [style*="borderColor: #E5DCC9"],
            .portal-readonly-wrapper .border-\\[\\#E5DCC9\\] {
              border-color: #E2E8F0 !important;
            }

            /* Fondo "info" verde → fondo azul tenue */
            .portal-readonly-wrapper [style*="background: #EDE8DC"] {
              background: #EEF2FF !important;
            }

            /* Texto info color verde → electric blue */
            .portal-readonly-wrapper .text-info {
              color: #3B4FE4 !important;
            }

            /* Botones gradient verde-bosque → azul Voltis */
            .portal-readonly-wrapper [style*="linear-gradient(135deg, #6B8068"] {
              background: linear-gradient(135deg, #4A6FE3, #3B4FE4) !important;
            }

            /* Ocultar botones admin y de informe */
            .portal-readonly-wrapper button:has(svg.lucide-trash-2),
            .portal-readonly-wrapper button:has(svg.lucide-trash),
            .portal-readonly-wrapper button:has(svg.lucide-refresh-cw),
            .portal-readonly-wrapper [data-admin-only="true"] {
              display: none !important;
            }
            .portal-readonly-wrapper button[aria-label="Eliminar"],
            .portal-readonly-wrapper button[aria-label="Re-extraer"],
            .portal-readonly-wrapper button[aria-label="Generar informe"] {
              display: none !important;
            }

            /* ═══════════════ Optimización móvil: tablas con scroll horizontal ═══
               El AnnualEconomics tiene matrices anchas (12-13 columnas).
               En móvil hacemos que las tablas internas tengan overflow-x y un
               sutil indicador visual para que el usuario sepa que puede deslizar. */
            @media (max-width: 768px) {
              .portal-readonly-wrapper {
                font-size: 0.92rem;
              }
              /* Cualquier elemento ancho dentro del wrapper se hace scrollable */
              .portal-readonly-wrapper table,
              .portal-readonly-wrapper [class*="grid-cols-"] {
                /* Tailwind grids con muchas columnas — ya manejados por overflow del padre */
              }
              /* Header secciones más pequeños */
              .portal-readonly-wrapper h2, .portal-readonly-wrapper h3 {
                font-size: 1.1rem !important;
                line-height: 1.3 !important;
              }
              .portal-readonly-wrapper .text-3xl,
              .portal-readonly-wrapper .text-4xl {
                font-size: 1.4rem !important;
              }
              /* Padding reducido en cards */
              .portal-readonly-wrapper .p-8 { padding: 1rem !important; }
              .portal-readonly-wrapper .p-6 { padding: 0.875rem !important; }
              .portal-readonly-wrapper .px-8 { padding-left: 1rem !important; padding-right: 1rem !important; }
              .portal-readonly-wrapper .py-12 { padding-top: 1.5rem !important; padding-bottom: 1.5rem !important; }
            }
          `}</style>
          <AnnualEconomics
            invoices={data.invoices}
            supplyId={data.supply.id}
            onInvoicesUpdated={() => {}}
            supplyType={(data.supply.type as 'luz'|'gas') || (isGas ? 'gas' : 'luz')}
            potenciaContratada={(data.supply.consumption_data || {}).potenciaContratada}
            consumoPeriodos={(data.supply.consumption_data || {}).consumoPeriodos}
            sipsHistory={(data.supply.consumption_data || {}).history}
            maximetroHistory={(data.supply.consumption_data || {}).maximetroHistory}
            supplyName={data.supply.name || undefined}
            readOnly={true}
          />
        </div>

        <footer className="text-center py-6 text-xs text-slate-500">
          Voltis Energía · 747 474 360 · admin@voltisenergia.com · voltisenergia.com
        </footer>
      </main>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tarjetas resumen — pensadas para móvil pero también enriquecen el escritorio.
// Se muestran ANTES del AnnualEconomics para que el cliente vea de un vistazo
// los números clave sin scroll.
// ════════════════════════════════════════════════════════════════════════════

function MobileSummary({ data, onDownload, downloading }: {
  data: SupplyData; onDownload: () => void; downloading: boolean
}) {
  // Calcular agregados ligeros a partir de invoices
  const stats = React.useMemo(() => {
    const invs = data.invoices || []
    let totalGasto = 0, totalKwh = 0
    const years = new Set<number>()
    for (const inv of invs) {
      const eco = (inv.extracted_data || {}).economics || {}
      totalGasto += Number(eco.totalFactura || inv.total_amount || 0) || 0
      totalKwh += Number(eco.consumoTotalKwh || 0) || 0
      if (inv.period_end) {
        const y = Number(String(inv.period_end).slice(0, 4))
        if (y) years.add(y)
      }
    }
    const eurPorKwh = totalKwh > 0 ? totalGasto / totalKwh : 0
    return {
      facturas: invs.length,
      gasto: totalGasto,
      kwh: totalKwh,
      eurPorKwh,
      años: years.size,
    }
  }, [data.invoices])

  const fmt = (n: number, d = 0) =>
    n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })

  return (
    <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
      <SummaryCard label="Gasto total" value={`${fmt(stats.gasto, 2)} €`} accent="#3B4FE4" />
      <SummaryCard label="Consumo total" value={`${fmt(stats.kwh, 0)} kWh`} />
      <SummaryCard label="€/kWh medio" value={stats.eurPorKwh > 0 ? `${fmt(stats.eurPorKwh, 4)} €` : '—'} />
      <SummaryCard label="Facturas" value={String(stats.facturas)} subtitle={stats.años > 0 ? `${stats.años} año${stats.años > 1 ? 's' : ''}` : undefined} />
    </div>
  )
}

function SummaryCard({ label, value, subtitle, accent }: {
  label: string; value: string; subtitle?: string; accent?: string
}) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
      <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-slate-500 mb-2">{label}</div>
      <div className="text-xl md:text-2xl font-bold leading-tight" style={{ color: accent || '#1A1A1A' }}>
        {value}
      </div>
      {subtitle && <div className="text-[11px] text-slate-500 mt-1">{subtitle}</div>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Skeleton — placeholder durante carga del detalle.
// Reduce drásticamente la sensación de espera frente a un spinner centrado.
// ════════════════════════════════════════════════════════════════════════════

function SupplyPageSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#F7F7F7' }}>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        .skel { animation: pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite; background: rgba(255,255,255,0.85); border-radius: 12px; border: 1px solid #E2E8F0; }
        .skel-d { animation: pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite; background: rgba(255,255,255,0.35); border-radius: 12px; }
      `}</style>
      {/* Hero */}
      <div className="px-6 md:px-10 py-6" style={{ background: '#88B9E7' }}>
        <div className="skel-d mb-4" style={{ width: 130, height: 14 }} />
        <div className="flex items-start gap-5">
          <div className="skel-d" style={{ width: 84, height: 84, borderRadius: '50%' }} />
          <div className="flex-1 min-w-0">
            <div className="skel-d mb-2" style={{ width: 220, height: 12 }} />
            <div className="skel-d mb-2" style={{ width: 320, height: 32 }} />
            <div className="skel-d" style={{ width: 180, height: 12 }} />
          </div>
        </div>
      </div>
      {/* Resumen cards */}
      <div className="max-w-7xl mx-auto px-3 md:px-6 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skel" style={{ height: 90 }} />
          ))}
        </div>
        {/* Body */}
        <div className="skel" style={{ height: 500 }} />
      </div>
    </div>
  )
}
