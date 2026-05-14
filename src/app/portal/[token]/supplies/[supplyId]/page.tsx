'use client'

/**
 * /portal/{token}/supplies/{supplyId}
 *
 * Reutiliza el componente AnnualEconomics del CRM en modo read-only.
 * Envuelto en un header Voltis verde-bosque + mascota para mantener la
 * estética del portal.
 */
import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Loader2, AlertCircle, Zap, Flame } from 'lucide-react'

const AnnualEconomics = dynamic(
  () => import('@/components/supply/AnnualEconomics'),
  { ssr: false, loading: () => <div className="py-20 text-center text-stone-500">Cargando estudio…</div> }
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

  if (error) return (
    <div className="min-h-screen bg-[#F0F6FF] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <AlertCircle className="w-12 h-12 text-rose-600 mx-auto mb-3" />
        <p className="text-stone-700">{error}</p>
        <button onClick={() => router.push(`/portal/${token}`)} className="mt-4 text-sm text-[#1F3A2E] hover:underline">
          ← Volver al portal
        </button>
      </div>
    </div>
  )
  if (loading || !data) return (
    <div className="min-h-screen bg-[#F0F6FF] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-[#1F3A2E]" />
    </div>
  )

  const isGas = data.supply.type === 'gas' || /^RL/i.test(data.supply.tariff || '')
  const Icon = isGas ? Flame : Zap

  return (
    <div className="min-h-screen bg-[#F0F6FF]">
      {/* Header Voltis verde bosque */}
      <header className="bg-[#1F3A2E] text-[#F6F1E7] px-6 md:px-10 py-6">
        <div className="max-w-7xl mx-auto">
          <button onClick={() => router.push(`/portal/${token}`)}
            className="inline-flex items-center gap-1.5 text-[#C7F24A]/80 hover:text-[#C7F24A] text-sm mb-3">
            <ArrowLeft className="w-4 h-4" /> Volver a tu portal
          </button>
          <div className="flex items-start gap-4">
            <img src="/mascota-transparente.png" alt="Voltis" width={64} height={64}
              style={{ width: 64, height: 'auto', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.2))' }} />
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold text-[#C7F24A]/80">
                <Icon className="w-3 h-3" /> {data.supply.tariff} · {isGas ? 'Gas Natural' : 'Electricidad'}
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mt-1 truncate">
                {data.supply.name || data.supply.cups?.slice(-8) || 'Suministro'}
              </h1>
              <p className="font-mono text-xs text-[#F6F1E7]/70 mt-1 truncate">{data.supply.cups}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido AnnualEconomics full */}
      <main className="max-w-7xl mx-auto px-2 md:px-6 py-6">
        <div className="portal-readonly-wrapper bg-white rounded-2xl shadow-sm border border-stone-200 p-4 md:p-6">
          <style jsx global>{`
            /* Ocultar botones admin que no aplican al portal cliente */
            .portal-readonly-wrapper button:has(svg.lucide-trash-2),
            .portal-readonly-wrapper button:has(svg.lucide-trash),
            .portal-readonly-wrapper button:has(svg.lucide-refresh-cw),
            .portal-readonly-wrapper [data-admin-only="true"] {
              display: none !important;
            }
            /* Ocultar botones cuyo texto explícito sea de admin */
            .portal-readonly-wrapper button[aria-label="Eliminar"],
            .portal-readonly-wrapper button[aria-label="Re-extraer"] {
              display: none !important;
            }
          `}</style>
          <AnnualEconomics
            invoices={data.invoices}
            supplyId={data.supply.id}
            onInvoicesUpdated={() => {}}
            supplyType={(data.supply.type as 'luz'|'gas') || (isGas ? 'gas' : 'luz')}
            potenciaContratada={(data.supply.consumption_data || {}).potenciaContratada}
            consumoPeriodos={(data.supply.consumption_data || {}).consumoPeriodos}
            supplyName={data.supply.name || undefined}
            readOnly={true}
          />
        </div>

        <footer className="text-center py-6 text-xs text-stone-500">
          Voltis Energía · 747 474 360 · admin@voltisenergia.com · voltisenergia.com
        </footer>
      </main>
    </div>
  )
}
