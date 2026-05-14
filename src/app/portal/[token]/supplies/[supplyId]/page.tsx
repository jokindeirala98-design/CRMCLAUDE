'use client'

/**
 * /portal/{token}/supplies/{supplyId} — Detalle AnnualEconomics estilo Voltis.
 *
 * Tabla read-only por mes/factura con todos los conceptos.
 * Descarga Excel del supply.
 */
import React, { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  ArrowLeft, Download, Calendar, Loader2, AlertCircle, Zap, Flame,
} from 'lucide-react'

const fmt = (n: number, d=2) => n.toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d})
const fmtEur = (n: number) => `${fmt(n)} €`
const fmtInt = (n: number) => Math.round(n).toLocaleString('es-ES')
const fmtP = (n: number) => fmt(n, 6)

interface SupplyDetail {
  supply: { id: string; cups: string|null; tariff: string|null; type: string|null; name: string|null; clientId: string }
  invoices: Array<{
    id: string; period_start: string|null; period_end: string|null; total_amount: number|null
    economics: any
  }>
  years: number[]
}

export default function PortalSupply() {
  const { token, supplyId } = useParams<{ token: string; supplyId: string }>()
  const router = useRouter()
  const [clientId, setClientId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupplyDetail | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    fetch('/api/portal/auth').then(r => r.json()).then(d => {
      if (!d.ok) { setError('Sesión expirada'); return }
      setClientId(d.clientId)
    })
  }, [])

  useEffect(() => {
    if (!clientId) return
    fetch(`/api/public/v1/clients/${clientId}/supplies/${supplyId}`)
      .then(async r => {
        if (!r.ok) throw new Error('No se pudo cargar el suministro')
        return r.json()
      })
      .then(d => {
        setDetail(d)
        if (!year && d.years.length > 0) setYear(d.years[0])
      })
      .catch(e => setError(e.message))
  }, [clientId, supplyId])

  const filteredInvs = useMemo(() => {
    if (!detail) return []
    if (!year) return detail.invoices
    return detail.invoices.filter(i => i.period_end && new Date(i.period_end).getFullYear() === year)
  }, [detail, year])

  async function downloadExcel() {
    if (!clientId) return
    setDownloading(true)
    try {
      const url = new URL(`/api/public/v1/clients/${clientId}/export/supply/${supplyId}`, window.location.origin)
      if (year) url.searchParams.set('year', String(year))
      const r = await fetch(url)
      if (!r.ok) throw new Error('No se pudo descargar')
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `voltis-${detail?.supply.name || detail?.supply.cups?.slice(-4) || 'supply'}-${year}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
    } finally { setDownloading(false) }
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-rose-700 mx-auto mb-4" />
        <p className="text-stone-700">{error}</p>
        <button onClick={() => router.push(`/portal/${token}`)} className="mt-4 text-sm text-[#1F3A2E] hover:underline">
          Volver al inicio
        </button>
      </div>
    </div>
  )
  if (!detail) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-[#1F3A2E]" />
    </div>
  )

  const isGas = detail.supply.type === 'gas' || /^RL/i.test(detail.supply.tariff || '')
  const ICON = isGas ? Flame : Zap

  return (
    <div className="portal-shell">
      <header className="bg-[#1F3A2E] text-[#F6F1E7] py-8 px-6 md:px-10">
        <div className="max-w-7xl mx-auto">
          <button onClick={() => router.push(`/portal/${token}`)}
            className="inline-flex items-center gap-1.5 text-[#C7F24A]/80 hover:text-[#C7F24A] text-sm mb-4">
            <ArrowLeft className="w-4 h-4" /> Volver a tu portal
          </button>
          <div className="flex items-start gap-4">
            <Image src="/mascota-transparente.png" alt="Voltis" width={56} height={56} />
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-1 text-xs uppercase tracking-widest font-semibold text-[#C7F24A]/80">
                <ICON className="w-3 h-3" /> {detail.supply.tariff} · {isGas ? 'Gas' : 'Electricidad'}
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mt-1 truncate">
                {detail.supply.name || detail.supply.cups?.slice(-8) || 'Suministro'}
              </h1>
              <p className="portal-mono text-xs text-[#F6F1E7]/70 mt-1 truncate">{detail.supply.cups}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-10 py-6 space-y-4">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-stone-200">
            <Calendar className="w-4 h-4 text-[#1F3A2E]" />
            <span className="text-xs text-stone-500 uppercase tracking-wide">Año</span>
            <select value={year ?? ''} onChange={e => setYear(parseInt(e.target.value))}
              className="text-sm bg-transparent outline-none font-semibold text-stone-900">
              {detail.years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={downloadExcel} disabled={downloading}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#C7F24A] text-[#1F3A2E] font-bold hover:bg-[#b8e635] shadow-md disabled:opacity-50">
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Descargar Excel
          </button>
        </div>

        {/* Tabla AnnualEconomics estilo Voltis */}
        {filteredInvs.length === 0 ? (
          <div className="p-10 text-center text-stone-500 bg-white rounded-2xl border border-stone-200">
            No hay facturas para {year}.
          </div>
        ) : (
          <SupplyTable invoices={filteredInvs} />
        )}

        <footer className="text-center py-6 text-xs text-stone-500">
          Voltis Energía · +34 948 00 00 00 · voltisenergia.com
        </footer>
      </main>
    </div>
  )
}

// ─── Tabla detallada ────────────────────────────────────────────────────────

const LAYOUT: Array<{ label: string; key: string; section?: boolean; bold?: boolean }> = [
  { label: 'Fecha inicio', key: 'fechaInicio' },
  { label: 'Fecha fin', key: 'fechaFin' },
  { label: 'Días facturados', key: 'dias' },
  { label: 'Tarifa', key: 'tarifa' },
  { label: 'POTENCIA CONTRATADA (kW)', key: '', section: true },
  { label: 'P1', key: 'kw_P1' }, { label: 'P2', key: 'kw_P2' }, { label: 'P3', key: 'kw_P3' },
  { label: 'P4', key: 'kw_P4' }, { label: 'P5', key: 'kw_P5' }, { label: 'P6', key: 'kw_P6' },
  { label: 'PRECIO POTENCIA (€/kW·día)', key: '', section: true },
  { label: 'P1', key: 'preKw_P1' }, { label: 'P2', key: 'preKw_P2' }, { label: 'P3', key: 'preKw_P3' },
  { label: 'P4', key: 'preKw_P4' }, { label: 'P5', key: 'preKw_P5' }, { label: 'P6', key: 'preKw_P6' },
  { label: 'CONSUMO (kWh)', key: '', section: true },
  { label: 'P1', key: 'kwh_P1' }, { label: 'P2', key: 'kwh_P2' }, { label: 'P3', key: 'kwh_P3' },
  { label: 'P4', key: 'kwh_P4' }, { label: 'P5', key: 'kwh_P5' }, { label: 'P6', key: 'kwh_P6' },
  { label: 'TOTAL kWh', key: 'kwh_total', bold: true },
  { label: 'PRECIO ENERGÍA (€/kWh)', key: '', section: true },
  { label: 'P1', key: 'preKwh_P1' }, { label: 'P2', key: 'preKwh_P2' }, { label: 'P3', key: 'preKwh_P3' },
  { label: 'P4', key: 'preKwh_P4' }, { label: 'P5', key: 'preKwh_P5' }, { label: 'P6', key: 'preKwh_P6' },
  { label: 'TOTALES (€)', key: '', section: true },
  { label: 'Coste energía', key: 'tot_e' },
  { label: 'Coste potencia', key: 'tot_p' },
  { label: 'Impuesto eléctrico', key: 'imp_e' },
  { label: 'Bono social (cargo)', key: 'bono' },
  { label: 'Alquiler contador', key: 'alq' },
  { label: 'IVA', key: 'iva' },
  { label: 'TOTAL FACTURA', key: 'total', bold: true },
  { label: 'Coste medio €/kWh', key: 'coste_medio' },
]

function getVal(inv: any, k: string): any {
  const eco = inv.economics || {}
  if (k === 'fechaInicio') return eco.fechaInicio ?? inv.period_start
  if (k === 'fechaFin') return eco.fechaFin ?? inv.period_end
  if (k === 'dias') return eco.diasFacturados
  if (k === 'tarifa') return eco.tarifa
  if (k === 'kwh_total') return eco.consumoTotalKwh
  if (k === 'tot_e') return eco.costeNetoConsumo ?? eco.costeTotalConsumo
  if (k === 'tot_p') return eco.costeTotalPotencia
  if (k === 'total') return eco.totalFactura ?? inv.total_amount
  if (k === 'coste_medio') return eco.costeMedioKwh
  if (k === 'imp_e') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('impuesto'))?.total
  if (k === 'bono') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('bono'))?.total
  if (k === 'alq') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('alquiler'))?.total
  if (k === 'iva') return eco.ivaTotal
  if (k.startsWith('kw_P')) return (eco.potencia||[]).find((x:any)=>x.periodo===k.slice(3))?.kw
  if (k.startsWith('preKw_')) return (eco.potencia||[]).find((x:any)=>x.periodo===k.slice(6))?.precioKwDia
  if (k.startsWith('kwh_P')) return (eco.consumo||[]).find((x:any)=>x.periodo===k.slice(4))?.kwh
  if (k.startsWith('preKwh_')) return (eco.consumo||[]).find((x:any)=>x.periodo===k.slice(7))?.precioKwh
  return null
}

function formatVal(k: string, v: any): string {
  if (v === undefined || v === null || v === '') return '—'
  if (k.startsWith('pre') || k === 'coste_medio') return fmtP(Number(v))
  if (k.startsWith('kwh_P') || k === 'kwh_total' || k === 'dias') return fmtInt(Number(v))
  if (k.startsWith('kw_P')) return fmt(Number(v), 3)
  if (k === 'fechaInicio' || k === 'fechaFin') return String(v)
  if (k === 'tarifa') return String(v)
  if (typeof v === 'number') return fmtEur(v)
  return String(v)
}

function SupplyTable({ invoices }: { invoices: any[] }) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-[#1F3A2E] text-[#C7F24A] p-3 text-left text-xs uppercase tracking-wide z-10">
                Concepto
              </th>
              {invoices.map((inv, i) => (
                <th key={inv.id} className="bg-[#1F3A2E] text-[#F6F1E7] p-3 text-xs font-semibold min-w-[120px]">
                  Fact {i+1}
                  <div className="text-[10px] font-normal opacity-70 mt-0.5">{inv.period_end}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LAYOUT.map((row, ri) => {
              if (row.section) {
                return (
                  <tr key={ri}>
                    <td colSpan={invoices.length + 1} className="bg-[#E8EBE3] text-[#1F3A2E] font-bold px-3 py-2 text-xs uppercase tracking-widest border-y border-stone-200">
                      {row.label}
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-[#FBF8F1]'}>
                  <td className={`sticky left-0 px-3 py-2 text-stone-700 border-r border-stone-100 ${row.bold ? 'font-bold bg-[#F6F1E7]' : 'bg-inherit'}`}>
                    {row.label}
                  </td>
                  {invoices.map(inv => {
                    const v = getVal(inv, row.key)
                    return (
                      <td key={inv.id} className={`px-3 py-2 text-center text-stone-800 portal-mono text-xs ${row.bold ? 'font-bold text-stone-900' : ''}`}>
                        {formatVal(row.key, v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
