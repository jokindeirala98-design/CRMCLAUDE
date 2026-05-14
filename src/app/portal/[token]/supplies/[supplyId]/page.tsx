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

  // 1. Validar token y obtener clientId
  useEffect(() => {
    fetch('/api/portal/auth').then(async r => {
      if (!r.ok) throw new Error('Sesión inválida')
      const d = await r.json()
      setClientId(d.clientId)
    }).catch(e => { setError(e.message); setLoading(false) })
  }, [])

  // 2. Cargar supply con sus invoices completas
  useEffect(() => {
    if (!clientId || !supplyId) return
    setLoading(true)
    fetch(`/api/public/v1/clients/${clientId}/supplies/${supplyId}/full`)
      .then(async r => {
        if (!r.ok) throw new Error('No se pudo cargar el suministro')
        return r.json()
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [clientId, supplyId])

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
  if (loading || !data) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#F7F7F7' }}>
      <Loader2 className="w-8 h-8 animate-spin text-[#3B4FE4]" />
    </div>
  )

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

      {/* Contenido AnnualEconomics full */}
      <main className="max-w-7xl mx-auto px-2 md:px-6 py-6">
        <div className="portal-readonly-wrapper bg-white rounded-2xl shadow-sm border border-slate-200 p-4 md:p-6">
          <style jsx global>{`
            /* Ocultar botones admin y "Generar informe" en modo cliente */
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
            /* Si el botón Generar informe se identifica solo por texto, lo escondemos
               vía heurística: cualquier botón cuyo texto contenga "Generar informe". */
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
