'use client'

/**
 * /portal/{token} — Landing del portal cliente.
 *
 * Valida el magic link, setea cookie y muestra overview con KPIs,
 * subtotales por tarifa, lista supplies y descarga Excel.
 */
import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Activity, Receipt, Gauge, Download, ArrowRight, Calendar, Filter,
  Loader2, AlertCircle,
} from 'lucide-react'

const fmt = (n: number, d=2) => n.toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d})
const fmtEur = (n: number) => `${fmt(n)} €`
const fmtInt = (n: number) => Math.round(n).toLocaleString('es-ES')

interface Overview {
  client: { id: string; name: string; alias: string | null }
  years: number[]
  defaultYear: number
  totalSupplies: number
  totalSuppliesLuz: number
  totalSuppliesGas: number
  totalCostAnual: number
  totalKwhAnual: number
  byTariff: Array<{ tariff: string; supplies: number; cost: number; kwh: number }>
  supplies: Array<{
    id: string; cups: string|null; tariff: string|null; type: string|null; name: string|null
    consumoAnualKwh: number; costeAnualEur: number; nFacturas: number
    iconCategory: 'luz'|'gas'; tariffGroup: string
  }>
  meta: { year: number; type: 'all'|'luz'|'gas' }
}

export default function PortalLanding() {
  const router = useRouter()
  const { token } = useParams<{ token: string }>()
  const [clientId, setClientId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [type, setType] = useState<'all'|'luz'|'gas'>('all')
  const [downloading, setDownloading] = useState(false)

  // 1. Validar token y autenticar
  useEffect(() => {
    if (!token) return
    fetch('/api/portal/auth', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ token }),
    })
    .then(async r => {
      if (!r.ok) throw new Error('Enlace inválido o caducado')
      const d = await r.json()
      setClientId(d.clientId)
    })
    .catch(e => setError(e.message))
  }, [token])

  // 2. Cargar overview
  useEffect(() => {
    if (!clientId) return
    const url = new URL(`/api/public/v1/clients/${clientId}/overview`, window.location.origin)
    if (year) url.searchParams.set('year', String(year))
    if (type !== 'all') url.searchParams.set('type', type)
    fetch(url).then(r => r.json()).then(d => {
      setOverview(d)
      if (!year && d.defaultYear) setYear(d.defaultYear)
    }).catch(e => setError(String(e)))
  }, [clientId, year, type])

  async function downloadGlobal() {
    if (!clientId) return
    setDownloading(true)
    try {
      const url = new URL(`/api/public/v1/clients/${clientId}/export/global`, window.location.origin)
      if (year) url.searchParams.set('year', String(year))
      if (type !== 'all') url.searchParams.set('type', type)
      const r = await fetch(url)
      if (!r.ok) throw new Error('No se pudo descargar')
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `voltis-${overview?.client.alias || 'cliente'}-${year}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
    } finally { setDownloading(false) }
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <AlertCircle className="w-12 h-12 text-rose-700 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-stone-900">No podemos abrir este enlace</h2>
        <p className="text-sm text-stone-600 mt-2">{error}</p>
        <p className="text-xs text-stone-500 mt-4">Contacta con Voltis para regenerar tu acceso.</p>
      </div>
    </div>
  )
  if (!overview) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-[#1F3A2E]" />
    </div>
  )

  return (
    <div className="portal-shell">
      {/* Hero */}
      <header className="bg-[#1F3A2E] text-[#F6F1E7] py-10 px-6 md:px-10">
        <div className="max-w-6xl mx-auto flex items-start gap-4">
          <Image src="/mascota-transparente.png" alt="Voltis" width={70} height={70} priority />
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest font-semibold text-[#C7F24A] opacity-80">
              Portal del cliente
            </div>
            <h1 className="text-2xl md:text-3xl font-bold leading-tight mt-1">
              {overview.client.alias || overview.client.name}
            </h1>
            <p className="portal-serif text-lg md:text-xl text-[#F6F1E7]/80 mt-1">
              Tu informe energético, siempre disponible
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 md:px-10 py-8 space-y-8">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 -mt-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-stone-200 shadow-sm">
            <Calendar className="w-4 h-4 text-[#1F3A2E]" />
            <span className="text-xs text-stone-500 uppercase tracking-wide">Año</span>
            <select
              value={year ?? overview.defaultYear}
              onChange={e => setYear(parseInt(e.target.value))}
              className="text-sm bg-transparent outline-none font-semibold text-stone-900"
            >
              {overview.years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-white border border-stone-200 shadow-sm p-1">
            {(['all','luz','gas'] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  type === t ? 'bg-[#1F3A2E] text-[#C7F24A]' : 'text-stone-600 hover:bg-stone-100'
                }`}>
                {t === 'all' ? 'Todos' : t === 'luz' ? 'Electricidad' : 'Gas'}
              </button>
            ))}
          </div>
          <button
            onClick={downloadGlobal}
            disabled={downloading}
            className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#C7F24A] text-[#1F3A2E] font-bold hover:bg-[#b8e635] shadow-md transition-all disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Descargar Excel ({year})
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Kpi icon={Receipt} label="Gasto total" value={fmtEur(overview.totalCostAnual)} accent />
          <Kpi icon={Activity} label="Consumo total" value={`${fmtInt(overview.totalKwhAnual)} kWh`} />
          <Kpi icon={Gauge} label="Suministros activos"
               value={`${overview.totalSupplies}`}
               subtitle={`${overview.totalSuppliesLuz} luz · ${overview.totalSuppliesGas} gas`} />
        </div>

        {/* Subtotales por tarifa */}
        {overview.byTariff.length > 0 && (
          <section>
            <h2 className="text-sm uppercase tracking-widest text-stone-500 font-semibold mb-3">
              Por tipo de tarifa
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {overview.byTariff.map(b => (
                <div key={b.tariff} className="rounded-2xl bg-white border border-stone-200 p-4">
                  <div className="text-xs text-stone-500 font-semibold">{b.tariff}</div>
                  <div className="text-xl font-bold text-stone-900 mt-1">{fmtEur(b.cost)}</div>
                  <div className="text-xs text-stone-600 mt-1">
                    {b.supplies} suministro{b.supplies !== 1 ? 's' : ''} · {fmtInt(b.kwh)} kWh
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Lista de supplies */}
        <section>
          <h2 className="text-sm uppercase tracking-widest text-stone-500 font-semibold mb-3">
            Tus suministros
          </h2>
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden divide-y divide-stone-100">
            {overview.supplies.map(s => (
              <button
                key={s.id}
                onClick={() => router.push(`/portal/${token}/supplies/${s.id}`)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-stone-50 transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-stone-900 truncate">
                    {s.name || s.cups?.slice(-8) || s.id.slice(0,8)}
                  </div>
                  <div className="portal-mono text-xs text-stone-500 truncate">{s.cups}</div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    {s.tariffGroup} · {s.nFacturas} factura{s.nFacturas !== 1 ? 's' : ''} · {fmtInt(s.consumoAnualKwh)} kWh/año
                  </div>
                </div>
                <div className="text-right ml-4">
                  <div className="text-lg font-bold text-stone-900">{fmtEur(s.costeAnualEur)}</div>
                  <div className="text-xs text-stone-500 mt-1 flex items-center justify-end gap-1">
                    Ver detalle <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center py-6 text-xs text-stone-500">
          Voltis Energía · 747 474 360 · admin@voltisenergia.com · voltisenergia.com
        </footer>
      </main>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, subtitle, accent }:
  { icon: any; label: string; value: string; subtitle?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${
      accent ? 'bg-[#1F3A2E] text-[#F6F1E7]' : 'bg-white border border-stone-200'
    }`}>
      <div className={`flex items-center gap-2 text-xs uppercase tracking-widest font-semibold ${
        accent ? 'text-[#C7F24A]' : 'text-stone-500'
      }`}>
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-2xl md:text-3xl font-bold mt-2 ${accent ? '' : 'text-stone-900'}`}>{value}</div>
      {subtitle && <div className={`text-xs mt-1 ${accent ? 'text-[#F6F1E7]/70' : 'text-stone-500'}`}>{subtitle}</div>}
    </div>
  )
}
