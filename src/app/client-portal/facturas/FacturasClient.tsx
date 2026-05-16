'use client'

/**
 * Portal v2 — Facturas.
 *
 * Lista todas las facturas del cliente con filtros por suministro/año/tipo
 * y descarga directa del PDF. La descarga llama a /download que genera
 * URL firmada de Supabase Storage con 10 min de validez.
 */
import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { AlertCircle, Download, FileText, Zap, Flame, Filter, X } from 'lucide-react'

interface Invoice {
  id: string
  supplyId: string
  supplyName: string | null
  supplyCups: string | null
  supplyType: 'luz' | 'gas'
  tariff: string | null
  source: string
  periodStart: string | null
  periodEnd: string | null
  totalAmount: number
  consumoKwh: number
  comercializadora: string | null
  fileUrl: string | null
  fileType: string | null
  createdAt: string
}

interface Supply {
  id: string; cups: string; name: string | null; type: string; tariff: string | null
}

interface Response {
  invoices: Invoice[]
  supplies: Supply[]
}

const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = (n: number) => `${fmt(n, 2)} €`
const MESES_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export function FacturasClient() {
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterSupply, setFilterSupply] = useState<string>('all')
  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterType, setFilterType] = useState<'all' | 'luz' | 'gas'>('all')
  const [filterSource, setFilterSource] = useState<'all' | 'voltis' | 'historica'>('all')

  useEffect(() => {
    fetch('/api/portal/v2/invoices', { credentials: 'same-origin', cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error')
        return r.json()
      })
      .then((d: Response) => setData(d))
      .catch(e => setError(e.message))
  }, [])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const inv of (data?.invoices || [])) {
      const d = inv.periodEnd || inv.periodStart
      if (d) set.add(new Date(d).getUTCFullYear())
    }
    return Array.from(set).sort((a, b) => b - a)
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.invoices.filter(inv => {
      if (filterSupply !== 'all' && inv.supplyId !== filterSupply) return false
      if (filterType !== 'all' && inv.supplyType !== filterType) return false
      if (filterSource !== 'all' && inv.source !== filterSource) return false
      if (filterYear !== 'all') {
        const d = inv.periodEnd || inv.periodStart
        if (!d || new Date(d).getUTCFullYear() !== parseInt(filterYear, 10)) return false
      }
      return true
    })
  }, [data, filterSupply, filterYear, filterType, filterSource])

  const totals = useMemo(() => {
    let total = 0, kwh = 0
    for (const inv of filtered) { total += inv.totalAmount; kwh += inv.consumoKwh }
    return { total, kwh, count: filtered.length }
  }, [filtered])

  const hasActiveFilters = filterSupply !== 'all' || filterYear !== 'all' || filterType !== 'all' || filterSource !== 'all'

  if (error) {
    return (
      <div className="voltis-glass max-w-xl p-6 flex items-start gap-3 text-white">
        <AlertCircle className="w-5 h-5 text-red-300 mt-0.5" />
        <div>
          <div className="font-semibold mb-1">No hemos podido cargar tus facturas</div>
          <p className="text-sm text-white/75">{error}</p>
        </div>
      </div>
    )
  }
  if (!data) return <Skeleton />
  if (data.invoices.length === 0) {
    return (
      <div className="voltis-glass max-w-2xl p-8 md:p-10 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
        <div className="relative flex items-start gap-5 mb-4">
          <div className="relative w-16 h-16 shrink-0">
            <Image src="/mascota-transparente.png" alt="Voltis" width={64} height={64} />
          </div>
          <div>
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">Facturas</div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">Aún no tienes facturas</h1>
          </div>
        </div>
        <p className="relative text-sm text-white/80 leading-relaxed">
          En cuanto cargue tu primera factura aparecerá aquí con su desglose y descarga directa del PDF.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <header className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
        <div className="relative w-20 h-20">
          <Image src="/mascota-transparente.png" alt="Voltis" width={80} height={80} priority />
        </div>
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] text-white voltis-glass-soft mb-3">
            <FileText className="w-3 h-3 text-[#B9D1FF]" />
            {data.invoices.length} facturas en tu portal
          </div>
          <h1 className="text-[28px] md:text-[36px] font-semibold leading-[1.06] text-white" style={{ letterSpacing: '-0.02em' }}>
            Tus facturas
          </h1>
          <p className="mt-2 text-sm text-white/75 max-w-2xl">
            Desglose por suministro y descarga directa del PDF original.
          </p>
        </div>
      </header>

      {/* Filtros */}
      <section className="voltis-glass p-5">
        <div className="flex items-center gap-3 mb-3">
          <Filter className="w-4 h-4 text-[#B9D1FF]" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#B9D1FF] font-bold">Filtros</span>
          {hasActiveFilters && (
            <button onClick={() => { setFilterSupply('all'); setFilterYear('all'); setFilterType('all'); setFilterSource('all') }}
              className="ml-auto text-[11px] text-white/65 hover:text-white flex items-center gap-1">
              <X className="w-3 h-3" /> Quitar filtros
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select label="Suministro" value={filterSupply} onChange={setFilterSupply}
            options={[
              { value: 'all', label: `Todos (${data.supplies.length})` },
              ...data.supplies.map(s => ({
                value: s.id,
                label: `${s.name || (s.cups || '').slice(-4)} · ${s.tariff || s.type}`,
              })),
            ]} />
          <Select label="Año" value={filterYear} onChange={setFilterYear}
            options={[
              { value: 'all', label: 'Todos los años' },
              ...years.map(y => ({ value: String(y), label: String(y) })),
            ]} />
          <Select label="Tipo" value={filterType} onChange={v => setFilterType(v as any)}
            options={[
              { value: 'all', label: 'Luz + Gas' },
              { value: 'luz', label: 'Solo luz' },
              { value: 'gas', label: 'Solo gas' },
            ]} />
          <Select label="Origen" value={filterSource} onChange={v => setFilterSource(v as any)}
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'voltis', label: 'Solo Voltis' },
              { value: 'historica', label: 'Solo antiguas' },
            ]} />
        </div>
      </section>

      {/* Resumen del filtrado */}
      <section className="grid grid-cols-3 gap-3">
        <MiniStat label="Facturas" value={String(totals.count)} />
        <MiniStat label="Consumo total" value={`${fmt(totals.kwh, 0)} kWh`} />
        <MiniStat label="Importe total" value={fmtEur(totals.total)} accent />
      </section>

      {/* Tabla */}
      <div className="voltis-glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-4 text-[10px] uppercase tracking-wider text-[#B9D1FF] font-bold">Periodo</th>
                <th className="text-left py-3 px-4 text-[10px] uppercase tracking-wider text-[#B9D1FF] font-bold">Suministro</th>
                <th className="text-left py-3 px-4 text-[10px] uppercase tracking-wider text-[#B9D1FF] font-bold">Origen</th>
                <th className="text-right py-3 px-4 text-[10px] uppercase tracking-wider text-[#B9D1FF] font-bold">Consumo</th>
                <th className="text-right py-3 px-4 text-[10px] uppercase tracking-wider text-[#B9D1FF] font-bold">Importe</th>
                <th className="text-right py-3 px-4 text-[10px] uppercase tracking-wider text-[#B9D1FF] font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-white/55">
                    Ningún resultado con los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function InvoiceRow({ inv }: { inv: Invoice }) {
  const d = inv.periodEnd || inv.periodStart
  const date = d ? new Date(d) : null
  const periodoLabel = date ? `${MESES_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}` : '—'
  const isVoltis = inv.source === 'voltis'
  const isGas = inv.supplyType === 'gas'

  const downloadUrl = `/api/portal/v2/invoices/${inv.id}/download`

  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition">
      <td className="py-3 px-4 text-white">
        <div className="font-semibold">{periodoLabel}</div>
        {inv.periodStart && inv.periodEnd && (
          <div className="text-[10px] num text-white/55">
            {inv.periodStart.slice(0, 10)} → {inv.periodEnd.slice(0, 10)}
          </div>
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {isGas ? <Flame className="w-3.5 h-3.5 text-orange-300" /> : <Zap className="w-3.5 h-3.5 text-yellow-300" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {inv.supplyName || (inv.supplyCups || '').slice(-4) || 'Suministro'}
            </div>
            <div className="text-[10px] num text-white/55 truncate">{inv.supplyCups} · {inv.tariff}</div>
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
          isVoltis ? 'bg-emerald-300/20 text-emerald-200' : 'bg-white/10 text-white/70'
        }`}>
          {isVoltis ? 'Voltis' : 'Anterior'}
        </span>
        {inv.comercializadora && (
          <div className="text-[10px] text-white/55 mt-0.5">{inv.comercializadora}</div>
        )}
      </td>
      <td className="py-3 px-4 text-right num text-white">
        {inv.consumoKwh > 0 ? `${fmt(inv.consumoKwh, 0)} kWh` : '—'}
      </td>
      <td className="py-3 px-4 text-right num font-bold text-white">{fmtEur(inv.totalAmount)}</td>
      <td className="py-3 px-4 text-right">
        {inv.fileUrl ? (
          <a href={downloadUrl} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1 text-xs text-[#B9D1FF] hover:text-white transition"
            title="Descargar PDF">
            <Download className="w-3.5 h-3.5" /> PDF
          </a>
        ) : (
          <span className="text-[10px] text-white/35">sin PDF</span>
        )}
      </td>
    </tr>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#B9D1FF] font-bold mb-1.5">{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full voltis-glass-soft px-3 py-2 text-sm text-white bg-transparent outline-none cursor-pointer">
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-[#0B1E55] text-white">{o.label}</option>
        ))}
      </select>
    </label>
  )
}

function MiniStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="voltis-glass-soft p-3" style={accent ? { boxShadow: 'inset 0 0 0 1px rgba(218,180,90,0.4)' } : undefined}>
      <div className="text-[10px] uppercase tracking-wider text-[#B9D1FF] font-bold mb-1">{label}</div>
      <div className="text-base font-bold num text-white">{value}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-5">
      <div className="h-20 voltis-glass animate-pulse" />
      <div className="h-32 voltis-glass animate-pulse" />
      <div className="h-72 voltis-glass animate-pulse" />
    </div>
  )
}
