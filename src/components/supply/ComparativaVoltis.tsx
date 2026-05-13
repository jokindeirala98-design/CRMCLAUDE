'use client'

/**
 * ComparativaVoltis.tsx — Informe interactivo de coste real "Voltis vs antigua".
 *
 * Estilo editorial Voltis (paleta crema+sage+volt, Instrument Serif para acentos,
 * Geist Mono para números). El layout NO replica el PDF anterior — diseño nuevo
 * en cuadrícula con tarjetas, líneas finas, sparklines y tabla estilo libro mayor.
 *
 * Utilidades:
 *   - Selector de CUPS si el cliente tiene varios suministros con facturas Voltis.
 *   - Selector de meses con teclado (←/→ foco · espacio toggle · ⌘A todos · esc limpia)
 *     y arrastre (mousedown+drag) — como AnnualEconomics.
 *   - Botón "Descargar PDF" llama al endpoint server-side con Puppeteer.
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Download, Loader2, AlertCircle, Sparkles, ChevronDown, ChevronRight,
  TrendingDown, Zap, Flame, FileText, Info, ArrowRight,
} from 'lucide-react'
import type { ResultadoComparativa, ComparativaMes } from '@/lib/comparativa-energetica'

// ─── Constantes ──────────────────────────────────────────────────────────────

const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// ─── Helpers de formato ──────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, d = 2): string => {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
}
const fmtEur = (n: number | null | undefined, d = 2) => `${fmt(n, d)} €`
const fmtKwh = (n: number | null | undefined) => `${fmt(n, 0)} kWh`
const fmtPct = (n: number | null | undefined) => n !== null && n !== undefined ? `${fmt(n, 1)} %` : '—'

const monthKey = (m: number, y: number) => `${y}-${m}`

// ─── Tipos del payload del endpoint ──────────────────────────────────────────

interface ApiResponse {
  supply: {
    id: string
    cups: string | null
    tariff: string | null
    type: string
    name: string | null
    client_id: string
    client_name: string | null
    comercializadora: string | null
  }
  comparativa: ResultadoComparativa
  otrosCupsClient: Array<{
    id: string; cups: string | null; tariff: string | null; type: string; has_voltis: boolean
  }>
}

interface Props {
  supplyId: string
  /** Modo "render" para Puppeteer: sin botones, layout estático A4. */
  pdfMode?: boolean
  /** Filtro de meses precalculado para pdfMode. Si no, todos. */
  pdfMeses?: string[]
}

// ════════════════════════════════════════════════════════════════════════════
// Componente principal
// ════════════════════════════════════════════════════════════════════════════

export default function ComparativaVoltis({ supplyId, pdfMode = false, pdfMeses }: Props) {
  const router = useRouter()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSupplyId, setActiveSupplyId] = useState<string>(supplyId)
  const [downloading, setDownloading] = useState(false)
  const [expandedMes, setExpandedMes] = useState<string | null>(null)

  // ── Fetch comparativa ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/comparativa/${activeSupplyId}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.error) throw new Error(json.error)
        setData(json)
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Error cargando comparativa') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeSupplyId])

  // ── Selector de meses ─────────────────────────────────────────────────────
  const allMonthKeys = useMemo(() => {
    if (!data) return []
    return data.comparativa.pares.map(p => monthKey(p.mes, p.year))
  }, [data])

  const [selectedMeses, setSelectedMeses] = useState<Set<string>>(new Set())

  // Inicializar: todos los meses disponibles seleccionados
  useEffect(() => {
    if (data) {
      if (pdfMode && pdfMeses && pdfMeses.length > 0) {
        setSelectedMeses(new Set(pdfMeses))
      } else {
        setSelectedMeses(new Set(allMonthKeys))
      }
    }
  }, [data, pdfMode, pdfMeses, allMonthKeys])

  const paresFiltrados = useMemo(() => {
    if (!data) return []
    return data.comparativa.pares.filter(p => selectedMeses.has(monthKey(p.mes, p.year)))
  }, [data, selectedMeses])

  // ── Totales filtrados ─────────────────────────────────────────────────────
  // IMPORTANTE: el ahorro acumulado tiene que coincidir con la suma de los
  // ahorros mensuales que se muestran en las MesCard.
  //   ahorroMes (backend, línea 854) = realAntigua.totalFactura − realVoltis.totalFactura
  // Antes el frontend agregaba `simuladoAntigua` (contrafactual = precios Voltis ×
  // consumo antiguo), que es solo el efecto-consumo. Para UNICE eso daba 14.165 €
  // mientras la suma de meses era 34.318 €. Ahora agregamos realAntigua para que
  // ambos números cuadren (mismo concepto: factura real antigua − factura real
  // Voltis del mismo mes, incluye tanto efecto-tarifa como efecto-consumo).
  const totales = useMemo(() => {
    let consumo = 0
    let consumoAntigua = 0
    let voltis = 0
    let realAntigua = 0
    let simulado = 0  // contrafactual (referencia para "precio medio si tarifa Voltis al consumo antiguo")
    for (const p of paresFiltrados) {
      consumo += (p.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
        || Number(p.voltisFactura.consumoTotalKwh) || 0
      consumoAntigua += (p.antiguaFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
        || Number(p.antiguaFactura.consumoTotalKwh) || 0
      voltis += p.realVoltis.totalFactura
      realAntigua += p.realAntigua.totalFactura
      simulado += p.simuladoAntigua.totalFactura
    }
    const ahorro = realAntigua - voltis           // ← coincide con Σ ahorroMes
    const pct = realAntigua > 0 ? (ahorro / realAntigua) * 100 : 0
    const eurKwhVoltis = consumo > 0 ? voltis / consumo : 0
    const eurKwhAntigua = consumoAntigua > 0 ? realAntigua / consumoAntigua : 0
    const eurKwhSim = consumo > 0 ? simulado / consumo : 0
    return { consumo, consumoAntigua, voltis, realAntigua, simulado, ahorro, pct, eurKwhVoltis, eurKwhAntigua, eurKwhSim }
  }, [paresFiltrados])

  // ── Toggle mes ────────────────────────────────────────────────────────────
  const toggleMes = useCallback((key: string) => {
    setSelectedMeses(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  // ── Descargar PDF ─────────────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    setDownloading(true)
    try {
      const mesesParam = Array.from(selectedMeses).join(',')
      const url = `/api/comparativa/${activeSupplyId}/pdf?meses=${encodeURIComponent(mesesParam)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Error generando PDF')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const cli = (data?.supply.client_name || 'cliente').replace(/[^\w]+/g, '_')
      const cups = (data?.supply.cups || '').slice(-8)
      a.download = `Comparativa_${cli}_${cups}.pdf`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      alert(e?.message || 'Error descargando PDF')
    } finally {
      setDownloading(false)
    }
  }

  // ── Estados ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-err/30 bg-err-container/40 p-6 max-w-xl mx-auto">
        <div className="flex items-center gap-3 text-err">
          <AlertCircle className="w-5 h-5" />
          <p className="font-semibold">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null
  if (data.comparativa.pares.length === 0) {
    return (
      <EmptyState supplyType={data.supply.type as 'luz' | 'gas'} />
    )
  }

  const { supply, comparativa, otrosCupsClient } = data
  const isGas = comparativa.supplyType === 'gas'
  const cupsWithVoltis = otrosCupsClient.filter(s => s.has_voltis)

  // ════════════════════════════════════════════════════════════════════════
  // LAYOUT
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className={pdfMode ? 'comparativa-pdf-root font-sans text-ink bg-bg' : 'comparativa-root font-sans text-ink'}>
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <Header
        supply={supply}
        comparativa={comparativa}
        cupsWithVoltis={cupsWithVoltis}
        activeSupplyId={activeSupplyId}
        onChangeSupply={(id) => { setActiveSupplyId(id); setExpandedMes(null) }}
        onDownloadPdf={handleDownloadPdf}
        downloading={downloading}
        onBack={pdfMode ? undefined : () => router.back()}
        pdfMode={pdfMode}
      />

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <Kpis
        ahorro={totales.ahorro}
        ahorroPct={totales.pct}
        consumo={totales.consumo}
        isGas={isGas}
      />

      {/* ── SELECTOR DE MESES (oculto en PDF mode) ─────────────────────── */}
      {!pdfMode && (
        <MesesSelector
          pares={comparativa.pares}
          selected={selectedMeses}
          onToggle={toggleMes}
          onSelectAll={() => setSelectedMeses(new Set(allMonthKeys))}
          onClear={() => setSelectedMeses(new Set())}
        />
      )}

      {/* ── DESGLOSE MES A MES ──────────────────────────────────────────── */}
      <section className="px-6 md:px-10 mt-10">
        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-[10px] tracking-[0.18em] font-bold text-[#4A6FE3] uppercase num">01</span>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-800">
            Desglose factura a factura
          </h2>
        </div>
        <p className="text-sm text-ink-3 mb-6 max-w-2xl">
          {isGas
            ? 'Cada mes compara la factura real Voltis del mes en curso con la factura real de la comercializadora antigua del mismo mes del año anterior. En gas solo es competitivo el término variable de energía — los regulados se pasan idénticos.'
            : 'Cada mes compara la factura real Voltis del mes en curso con la factura real de la comercializadora antigua del mismo mes del año anterior. El ahorro incluye tanto el efecto de tarifa como la variación de consumo entre los dos periodos.'}
        </p>

        <div className="grid gap-4">
          {paresFiltrados.length === 0 ? (
            <div className="rounded-2xl border border-line bg-card p-8 text-center text-ink-3 text-sm">
              No hay meses seleccionados.
            </div>
          ) : (
            paresFiltrados.map(par => (
              <MesCard
                key={monthKey(par.mes, par.year)}
                par={par}
                isGas={isGas}
                expanded={expandedMes === monthKey(par.mes, par.year)}
                onToggle={() => setExpandedMes(
                  expandedMes === monthKey(par.mes, par.year) ? null : monthKey(par.mes, par.year)
                )}
                pdfMode={pdfMode}
              />
            ))
          )}
        </div>
      </section>

      {/* ── PRECIO MEDIO €/kWh MES A MES ────────────────────────────────── */}
      {paresFiltrados.length >= 2 && (
        <section className="px-6 md:px-10 mt-12">
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-[10px] tracking-[0.18em] font-bold text-[#4A6FE3] uppercase num">02</span>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-800">
              Precio medio €/kWh, mes a mes
            </h2>
          </div>
          <PrecioMedioPanel pares={paresFiltrados} totales={totales} />
        </section>
      )}

      {/* ── METODOLOGÍA ─────────────────────────────────────────────────── */}
      <section className="px-6 md:px-10 mt-12 mb-12">
        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-[10px] tracking-[0.18em] font-bold text-[#4A6FE3] uppercase num">03</span>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-800">
            Cómo se calcula este ahorro
          </h2>
        </div>
        <MetodologiaPanel isGas={isGas} comercializadoraVoltis={comparativa.comercializadoraVoltis} comercializadoraAntigua={comparativa.comercializadoraAntigua} />
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="px-6 md:px-10 py-8 border-t border-line text-[11px] text-ink-3 flex items-center justify-between">
        <span className="font-mono tracking-wider uppercase">
          Voltis · Comparativa de coste real
        </span>
        <span className="font-mono">
          Generado {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      </footer>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// HEADER
// ════════════════════════════════════════════════════════════════════════════

function Header({
  supply, comparativa, cupsWithVoltis, activeSupplyId, onChangeSupply,
  onDownloadPdf, downloading, onBack, pdfMode,
}: {
  supply: ApiResponse['supply']
  comparativa: ResultadoComparativa
  cupsWithVoltis: ApiResponse['otrosCupsClient']
  activeSupplyId: string
  onChangeSupply: (id: string) => void
  onDownloadPdf: () => void
  downloading: boolean
  onBack?: () => void
  pdfMode: boolean
}) {
  const [cupsOpen, setCupsOpen] = useState(false)
  const isGas = comparativa.supplyType === 'gas'
  return (
    <header className="relative overflow-hidden pb-10" style={{
      background: 'linear-gradient(135deg, #A8C8F0 0%, #6FA0E8 60%, #4A6FE3 100%)',
    }}>
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-10 right-10 w-96 h-96 rounded-full" style={{ background: 'radial-gradient(circle, #FFFFFF 0%, transparent 70%)' }} />
      </div>

      <div className="relative px-6 md:px-10 pt-8">
        {/* Top row: back + actions */}
        {!pdfMode && (
          <div className="flex items-center justify-between mb-8">
            {onBack ? (
              <button onClick={onBack}
                className="flex items-center gap-2 text-xs font-medium text-white/80 hover:text-white transition">
                <ArrowLeft className="w-4 h-4" />
                Volver al suministro
              </button>
            ) : <span />}
            <button
              onClick={onDownloadPdf}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-[#4A6FE3] text-xs font-bold tracking-wide hover:bg-blue-50 transition disabled:opacity-60 shadow-md"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Descargar PDF
            </button>
          </div>
        )}

        <div className="flex items-center gap-8 flex-wrap">
          {!pdfMode && <BuddyIcon size={88} />}
          <div className="flex-1 min-w-0">
            {/* Eyebrow */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] font-bold tracking-[0.22em] text-white/70 uppercase">
                Informe Voltis · Comparativa de coste real
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/25 text-white text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm">
                {isGas ? <Flame className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                {isGas ? 'Gas' : 'Electricidad'}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-3xl md:text-5xl font-bold text-white leading-tight">
              {comparativa.comercializadoraVoltis ?? 'Voltis'}{' '}
              <span className="text-white/70 italic font-light">vs</span>{' '}
              {comparativa.comercializadoraAntigua ?? 'comercializadora anterior'}
            </h1>

            {/* Subtitle */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/80 mt-3">
              <span className="font-semibold text-white">{supply.client_name ?? '—'}</span>
              <span className="text-white/50">·</span>
              {cupsWithVoltis.length > 1 ? (
                <div className="relative">
                  <button
                    onClick={() => setCupsOpen(o => !o)}
                    className="inline-flex items-center gap-1 font-mono text-[11px] bg-white/20 px-2 py-1 rounded-md hover:bg-white/30 backdrop-blur-sm transition text-white"
                  >
                    {supply.cups ? supply.cups.slice(0, 4) + '…' + supply.cups.slice(-6) : 'sin CUPS'}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {cupsOpen && (
                    <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[280px] overflow-hidden">
                      {cupsWithVoltis.map(s => (
                        <button
                          key={s.id}
                          onClick={() => { onChangeSupply(s.id); setCupsOpen(false) }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition flex items-center justify-between ${s.id === activeSupplyId ? 'bg-blue-50' : ''}`}
                        >
                          <span className="font-mono text-[11px] text-slate-700">{s.cups || '—'}</span>
                          <span className="text-[10px] text-slate-500 uppercase tracking-wider">{s.tariff || s.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="font-mono text-[11px] bg-white/20 px-2 py-0.5 rounded-md backdrop-blur-sm">{supply.cups || '—'}</span>
              )}
              <span className="text-white/50">·</span>
              <span className="font-semibold">{supply.tariff || '—'}</span>
              <span className="text-white/50">·</span>
              <span>
                {comparativa.pares.length === 0
                  ? '—'
                  : (() => {
                      const sorted = [...comparativa.pares].sort((a, b) => (a.year - b.year) || (a.mes - b.mes))
                      const first = sorted[0]
                      const last = sorted[sorted.length - 1]
                      return `${MESES_SHORT[first.mes]} ${first.year}${last !== first ? ` – ${MESES_SHORT[last.mes]} ${last.year}` : ''}`
                    })()
                }
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BUDDY — mascota Voltis SVG inline (idéntico al informe global)
// ════════════════════════════════════════════════════════════════════════════

function BuddyIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 100 115" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))' }}>
      <defs>
        <radialGradient id="bulbGradCV" cx="0.4" cy="0.3">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#E0EFFF" />
          <stop offset="100%" stopColor="#A8C8F0" />
        </radialGradient>
        <linearGradient id="bodyGradCV" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A6FE3" />
          <stop offset="100%" stopColor="#2E4FBF" />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="42" rx="34" ry="36" fill="url(#bulbGradCV)" stroke="#FFFFFF" strokeWidth="1.5" />
      <path d="M35 38 Q40 28 45 38 Q50 28 55 38 Q60 28 65 38" stroke="#4A6FE3" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="36" y="72" width="28" height="22" rx="6" fill="url(#bodyGradCV)" />
      <ellipse cx="50" cy="93" rx="14" ry="3" fill="#2E4FBF" opacity="0.4" />
      <circle cx="44" cy="82" r="2.2" fill="#FFFFFF" />
      <circle cx="56" cy="82" r="2.2" fill="#FFFFFF" />
      <circle cx="44.5" cy="82.5" r="0.9" fill="#1E293B" />
      <circle cx="56.5" cy="82.5" r="0.9" fill="#1E293B" />
      <path d="M46 88 Q50 91 54 88" stroke="#FFFFFF" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <rect x="40" y="94" width="6" height="14" rx="3" fill="url(#bodyGradCV)" />
      <rect x="54" y="94" width="6" height="14" rx="3" fill="url(#bodyGradCV)" />
    </svg>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// KPIs
// ════════════════════════════════════════════════════════════════════════════

function Kpis({ ahorro, ahorroPct, consumo, isGas }: {
  ahorro: number; ahorroPct: number; consumo: number; isGas: boolean
}) {
  // Negative savings (paid more with Voltis) → red KPI; positive → blue gradient
  const positivo = ahorro >= 0
  return (
    <section className="px-6 md:px-10 -mt-6 mb-2 grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
      {/* Ahorro total — el grande, gradiente azul Voltis */}
      <div className="md:col-span-2 rounded-3xl p-8 relative overflow-hidden" style={{
        background: positivo
          ? 'linear-gradient(135deg, #4A6FE3 0%, #2E4FBF 100%)'
          : 'linear-gradient(135deg, #DC2626 0%, #991B1B 100%)',
        color: '#FFFFFF',
        boxShadow: '0 20px 60px -15px rgba(74,111,227,0.45)',
      }}>
        <div className="absolute -bottom-12 -right-8 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="text-[10px] font-bold tracking-[0.22em] uppercase mb-3" style={{ color: '#C7DBFF' }}>
          Ahorro acumulado
        </div>
        <div className="text-[3.5rem] md:text-[5rem] font-bold leading-none num">
          {ahorro >= 0 ? '' : '−'}{fmt(Math.abs(ahorro), 2)}
          <span className="text-[1.75rem] md:text-[2.5rem] align-top ml-2 opacity-80">€</span>
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm opacity-90">
          <TrendingDown className="w-4 h-4" />
          <span>
            {positivo
              ? `${fmtPct(ahorroPct)} menos que con la comercializadora anterior`
              : `${fmtPct(Math.abs(ahorroPct))} más caro que con la anterior`}
          </span>
        </div>
      </div>

      {/* Consumo */}
      <div className="rounded-3xl bg-white p-6 flex flex-col justify-between" style={{
        boxShadow: '0 10px 40px -10px rgba(74,111,227,0.25)',
      }}>
        <div>
          <div className="flex items-center gap-2 mb-3 text-[#4A6FE3]">
            {isGas ? <Flame className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase">Consumo analizado</div>
          </div>
          <div className="text-4xl font-bold num text-slate-800">
            {fmt(consumo, 0)}
            <span className="text-base text-slate-500 ml-1 font-medium">kWh</span>
          </div>
        </div>
        <div className="mt-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          {isGas ? 'Gas natural' : 'Electricidad'}
        </div>
      </div>
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SELECTOR DE MESES (teclado · arrastre)
// ════════════════════════════════════════════════════════════════════════════

function MesesSelector({
  pares, selected, onToggle, onSelectAll, onClear,
}: {
  pares: ComparativaMes[]
  selected: Set<string>
  onToggle: (key: string) => void
  onSelectAll: () => void
  onClear: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [dragMode, setDragMode] = useState<'select' | 'deselect'>('select')

  const keys = pares.map(p => monthKey(p.mes, p.year))

  // Keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setFocusIdx(i => Math.min(i + 1, keys.length - 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setFocusIdx(i => Math.max(i - 1, 0))
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (keys[focusIdx]) onToggle(keys[focusIdx])
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onSelectAll()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClear()
    }
  }

  // Drag handlers
  const onMouseDownChip = (key: string) => {
    setDragging(true)
    setDragMode(selected.has(key) ? 'deselect' : 'select')
    onToggle(key)
  }
  const onMouseEnterChip = (key: string) => {
    if (!dragging) return
    if (dragMode === 'select' && !selected.has(key)) onToggle(key)
    if (dragMode === 'deselect' && selected.has(key)) onToggle(key)
  }
  useEffect(() => {
    const up = () => setDragging(false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  return (
    <section className="px-6 md:px-10 mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono tracking-[0.22em] uppercase text-ink-3">
          Meses incluidos · {selected.size} de {pares.length}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <kbd className="px-1.5 py-0.5 rounded bg-bg-2 border border-line text-ink-3">←/→</kbd>
          <span className="text-ink-3">foco</span>
          <kbd className="px-1.5 py-0.5 rounded bg-bg-2 border border-line text-ink-3">espacio</kbd>
          <span className="text-ink-3">toggle</span>
          <kbd className="px-1.5 py-0.5 rounded bg-bg-2 border border-line text-ink-3">⌘A</kbd>
          <span className="text-ink-3">todos</span>
          <kbd className="px-1.5 py-0.5 rounded bg-bg-2 border border-line text-ink-3">esc</kbd>
          <span className="text-ink-3">limpiar</span>
        </div>
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-2 outline-none focus:ring-2 focus:ring-brand/20 rounded-xl p-1 select-none"
      >
        {pares.map((p, idx) => {
          const key = monthKey(p.mes, p.year)
          const sel = selected.has(key)
          const focused = focusIdx === idx
          return (
            <button
              key={key}
              onMouseDown={(e) => { e.preventDefault(); setFocusIdx(idx); onMouseDownChip(key) }}
              onMouseEnter={() => onMouseEnterChip(key)}
              className={`
                px-3 py-2 rounded-xl border transition font-mono text-[11px] tracking-wide
                ${sel
                  ? 'bg-brand text-volt border-brand'
                  : 'bg-card text-ink border-line hover:border-brand/40'}
                ${focused ? 'ring-2 ring-brand/40 ring-offset-2 ring-offset-bg' : ''}
              `}
            >
              <span className="block leading-tight">{MESES_SHORT[p.mes].toUpperCase()}</span>
              <span className="block leading-tight text-[9px] opacity-70">{p.year}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TARJETA DE MES
// ════════════════════════════════════════════════════════════════════════════

function MesCard({ par, isGas, expanded, onToggle, pdfMode }: {
  par: ComparativaMes
  isGas: boolean
  expanded: boolean
  onToggle: () => void
  pdfMode: boolean
}) {
  const consumo = (par.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
    || Number(par.voltisFactura.consumoTotalKwh) || 0

  return (
    <article className="rounded-3xl bg-card border border-line overflow-hidden">
      {/* Header de la tarjeta */}
      <button
        onClick={onToggle}
        disabled={pdfMode}
        className={`w-full text-left px-6 py-5 flex items-center justify-between gap-4 ${pdfMode ? '' : 'hover:bg-bg-2/40'} transition`}
      >
        <div className="flex items-baseline gap-4 min-w-0">
          <span className="font-serif text-2xl text-brand">
            {MESES_FULL[par.mes]} <span className="text-ink-3">{par.year}</span>
          </span>
          <span className="text-[11px] font-mono uppercase tracking-wider text-ink-3 hidden md:inline">
            {par.diasVoltis} días · {fmt(consumo, 0)} kWh
          </span>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3">Ahorro</div>
            <div className="text-2xl font-bold num text-[#4A6FE3]">+{fmt(par.ahorroMes, 2)} €</div>
          </div>
          {!pdfMode && (
            <ChevronRight className={`w-5 h-5 text-ink-3 transition ${expanded ? 'rotate-90' : ''}`} />
          )}
        </div>
      </button>

      {/* Body — siempre visible en pdfMode */}
      {(expanded || pdfMode) && (
        <div className="border-t border-line bg-bg/40 px-6 py-6">
          {isGas
            ? <DesgloseGas par={par} />
            : <DesgloseLuz par={par} />}
        </div>
      )}
    </article>
  )
}

// ─── Desglose LUZ — tabla concepto a concepto + detalle por periodo ────────

function DesgloseLuz({ par }: { par: ComparativaMes }) {
  const r = par.realVoltis
  const s = par.simuladoAntigua

  const row = (label: string, real: number, sim: number, isPriceless = false) => {
    const diff = sim - real
    return (
      <tr className="border-b border-line/40 last:border-b-0">
        <td className="py-2.5 text-sm">{label}</td>
        <td className="py-2.5 text-right font-mono text-sm">{fmtEur(real)}</td>
        <td className="py-2.5 text-right font-mono text-sm text-ink-3">{fmtEur(sim)}</td>
        <td className={`py-2.5 text-right font-mono text-sm ${isPriceless ? 'text-ink-3' : diff > 0 ? 'text-salvia font-semibold' : diff < 0 ? 'text-err' : 'text-ink-3'}`}>
          {isPriceless ? '—' : diff > 0 ? `+${fmt(diff, 2)} €` : diff < 0 ? `${fmt(diff, 2)} €` : '—'}
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-6">
      {/* Tabla concepto a concepto */}
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-line">
            <th className="py-2 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Concepto</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Voltis (real)</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Antigua (simulada)</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Δ Ahorro</th>
          </tr>
        </thead>
        <tbody>
          {row('Energía', r.totalEnergia, s.totalEnergia)}
          {row('Potencia contratada', r.totalPotencia, s.totalPotencia, true)}
          {r.excesos > 0 && row('Excesos de potencia', r.excesos, s.excesos, true)}
          {r.bonoSocial > 0 && row('Bono social', r.bonoSocial, s.bonoSocial, true)}
          {row(`Impuesto eléctrico (${fmt(r.ieePorcentaje * 100, 2)} %)`, r.ieeImporte, s.ieeImporte)}
          {r.alquiler > 0 && row('Alquiler equipos', r.alquiler, s.alquiler, true)}
          <tr className="border-t-2 border-line/60">
            <td className="py-3 text-sm font-semibold">Base imponible</td>
            <td className="py-3 text-right font-mono text-sm font-semibold">{fmtEur(r.baseImponible)}</td>
            <td className="py-3 text-right font-mono text-sm font-semibold text-ink-3">{fmtEur(s.baseImponible)}</td>
            <td className="py-3 text-right font-mono text-sm font-semibold text-salvia">+{fmt(s.baseImponible - r.baseImponible, 2)} €</td>
          </tr>
          {row(`IVA ${fmt(r.ivaPorcentaje * 100, 0)} %`, r.ivaImporte, s.ivaImporte)}
          <tr className="border-t-2 border-brand/60">
            <td className="py-3 text-sm font-semibold">Total factura</td>
            <td className="py-3 text-right font-mono text-base font-bold text-brand">{fmtEur(r.totalFactura)}</td>
            <td className="py-3 text-right font-mono text-base font-bold text-ink-3">{fmtEur(s.totalFactura)}</td>
            <td className="py-3 text-right font-mono text-base font-bold text-salvia">+{fmt(s.totalFactura - r.totalFactura, 2)} €</td>
          </tr>
        </tbody>
      </table>

      {/* Detalle por periodo si lo hay */}
      {par.detallePeriodos && par.detallePeriodos.length > 0 && (
        <details className="rounded-xl bg-card border border-line overflow-hidden">
          <summary className="px-4 py-2.5 cursor-pointer text-xs font-mono uppercase tracking-wider text-ink-3 hover:bg-bg-2/40 transition flex items-center gap-2">
            <Info className="w-3.5 h-3.5" />
            Ver simulación por periodo P1–P6
          </summary>
          <table className="w-full mt-2">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 px-3 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Periodo</th>
                <th className="py-2 px-3 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">kWh Voltis</th>
                <th className="py-2 px-3 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">€/kWh Voltis</th>
                <th className="py-2 px-3 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">€/kWh Antigua</th>
                <th className="py-2 px-3 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Coste sim.</th>
              </tr>
            </thead>
            <tbody>
              {par.detallePeriodos.filter(d => d.kwh > 0).map(d => (
                <tr key={d.periodo} className="border-b border-line/40 last:border-b-0">
                  <td className="py-2 px-3 text-sm font-semibold text-brand">{d.periodo}</td>
                  <td className="py-2 px-3 text-right font-mono text-sm">{fmt(d.kwh, 0)}</td>
                  <td className="py-2 px-3 text-right font-mono text-sm">{fmt(d.precioKwhVoltis, 6)}</td>
                  <td className="py-2 px-3 text-right font-mono text-sm text-ink-3">{fmt(d.precioKwhAntigua, 6)}</td>
                  <td className="py-2 px-3 text-right font-mono text-sm">{fmtEur(d.costeEnergiaSimulada)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

// ─── Desglose GAS — solo TV energía ─────────────────────────────────────────

function DesgloseGas({ par }: { par: ComparativaMes }) {
  const r = par.realVoltis
  const s = par.simuladoAntigua
  const consumo = (par.voltisFactura.consumo || []).reduce((sum, c) => sum + (Number(c.kwh) || 0), 0)
    || Number(par.voltisFactura.consumoTotalKwh) || 0
  const precioVoltis = par.detallePeriodos?.[0]?.precioKwhVoltis ?? 0
  const precioAntigua = par.detallePeriodos?.[0]?.precioKwhAntigua ?? 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div className="p-4 rounded-xl bg-card border border-line">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">Consumo</div>
          <div className="font-serif text-2xl text-brand">{fmt(consumo, 0)} <span className="text-sm text-ink-3">kWh</span></div>
        </div>
        <div className="p-4 rounded-xl bg-card border border-line">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">Precio TV Voltis</div>
          <div className="font-serif text-2xl text-brand">{fmt(precioVoltis, 6)} <span className="text-sm text-ink-3">€/kWh</span></div>
        </div>
        <div className="p-4 rounded-xl bg-card border border-line">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">Precio TV Antigua</div>
          <div className="font-serif text-2xl text-ink-3">{fmt(precioAntigua, 6)} <span className="text-sm text-ink-3">€/kWh</span></div>
        </div>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-line">
            <th className="py-2 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Concepto</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Voltis</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Antigua (sim.)</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Δ Ahorro</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line/40">
            <td className="py-2.5 text-sm">Energía (TV)</td>
            <td className="py-2.5 text-right font-mono text-sm">{fmtEur(r.totalEnergia)}</td>
            <td className="py-2.5 text-right font-mono text-sm text-ink-3">{fmtEur(s.totalEnergia)}</td>
            <td className="py-2.5 text-right font-mono text-sm text-salvia font-semibold">+{fmt(s.totalEnergia - r.totalEnergia, 2)} €</td>
          </tr>
          <tr className="border-b border-line/40">
            <td className="py-2.5 text-sm">IVA {fmt(r.ivaPorcentaje * 100, 0)} %</td>
            <td className="py-2.5 text-right font-mono text-sm">{fmtEur(r.ivaImporte)}</td>
            <td className="py-2.5 text-right font-mono text-sm text-ink-3">{fmtEur(s.ivaImporte)}</td>
            <td className="py-2.5 text-right font-mono text-sm text-salvia font-semibold">+{fmt(s.ivaImporte - r.ivaImporte, 2)} €</td>
          </tr>
          <tr className="border-t-2 border-brand/60">
            <td className="py-3 text-sm font-semibold">Coste energía + IVA</td>
            <td className="py-3 text-right font-mono text-base font-bold text-brand">{fmtEur(r.totalEnergia + r.ivaImporte)}</td>
            <td className="py-3 text-right font-mono text-base font-bold text-ink-3">{fmtEur(s.totalEnergia + s.ivaImporte)}</td>
            <td className="py-3 text-right font-mono text-base font-bold text-[#4A6FE3]">+{fmt(par.ahorroMes, 2)} €</td>
          </tr>
        </tbody>
      </table>

      <p className="text-[11px] text-ink-3 italic max-w-2xl">
        En gas, los conceptos regulados (término fijo, peaje TV Red Local, IEH, GTS,
        CNMC, alquileres) no dependen del comercializador y se ignoran en el cálculo
        del ahorro. Solo varía el término variable de energía.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL PRECIO MEDIO
// ════════════════════════════════════════════════════════════════════════════

function PrecioMedioPanel({ pares, totales }: {
  pares: ComparativaMes[]
  totales: { eurKwhVoltis: number; eurKwhAntigua: number }
}) {
  // €/kWh real por mes — Voltis a su consumo, antigua a su propio consumo
  // (ambos divididos por su consumo respectivo del mismo mes).
  const data = pares.map(p => {
    const consumoV = (p.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(p.voltisFactura.consumoTotalKwh) || 0
    const consumoA = (p.antiguaFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(p.antiguaFactura.consumoTotalKwh) || 0
    return {
      mes: p.mes,
      year: p.year,
      consumo: consumoV,
      eurKwhVoltis: consumoV > 0 ? p.realVoltis.totalFactura / consumoV : 0,
      eurKwhSim: consumoA > 0 ? p.realAntigua.totalFactura / consumoA : 0,
    }
  })

  const max = Math.max(...data.flatMap(d => [d.eurKwhVoltis, d.eurKwhSim]), 0.01)
  const min = Math.min(...data.flatMap(d => [d.eurKwhVoltis, d.eurKwhSim]).filter(v => v > 0), max)
  const range = Math.max(max - min, 0.01)

  // SVG sparkline
  const w = 800, h = 200, pad = 30
  const xStep = data.length > 1 ? (w - 2 * pad) / (data.length - 1) : 0
  const yFor = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad)

  const pathFor = (key: 'eurKwhVoltis' | 'eurKwhSim') => {
    return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * xStep} ${yFor(d[key])}`).join(' ')
  }

  return (
    <div className="rounded-3xl bg-white p-6 space-y-6" style={{ boxShadow: '0 10px 40px -10px rgba(74,111,227,0.15)', border: '1px solid #E0EAFF' }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Coste medio (todo incluido)</div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-[#4A6FE3] num">{fmt(totales.eurKwhVoltis, 6)}</span>
            <span className="text-sm text-slate-500">€/kWh Voltis</span>
            <span className="text-slate-300 mx-2">·</span>
            <span className="text-2xl font-bold text-slate-700 num">{fmt(totales.eurKwhAntigua, 6)}</span>
            <span className="text-sm text-slate-500">€/kWh antigua</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Diferencia €/kWh</div>
          <div className="text-2xl font-bold text-[#4A6FE3] num">−{fmt(totales.eurKwhAntigua - totales.eurKwhVoltis, 6)}</div>
        </div>
      </div>

      {/* Sparkline */}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto max-w-full" preserveAspectRatio="xMidYMid meet">
          {/* Antigua (referencia) */}
          <path d={pathFor('eurKwhSim')} fill="none" stroke="#8A9A8E" strokeWidth={1.5} strokeDasharray="4 3" />
          {/* Voltis */}
          <path d={pathFor('eurKwhVoltis')} fill="none" stroke="#1F3A2E" strokeWidth={2.5} />
          {/* Puntos + etiquetas */}
          {data.map((d, i) => (
            <g key={i}>
              <circle cx={pad + i * xStep} cy={yFor(d.eurKwhVoltis)} r={4} fill="#C7F24A" stroke="#1F3A2E" strokeWidth={1.5} />
              <circle cx={pad + i * xStep} cy={yFor(d.eurKwhSim)} r={3} fill="#FBF7EE" stroke="#8A9A8E" strokeWidth={1} />
              <text x={pad + i * xStep} y={h - 5} textAnchor="middle" className="font-mono" fontSize="10" fill="#5A6B5F">
                {MESES_SHORT[d.mes]} {String(d.year).slice(-2)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Tabla mes vs mes */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <th className="py-2 text-left text-[10px] font-mono uppercase tracking-wider text-ink-3">Mes</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">€/kWh Voltis</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">€/kWh Antigua</th>
            <th className="py-2 text-right text-[10px] font-mono uppercase tracking-wider text-ink-3">Δ</th>
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={`${d.year}-${d.mes}`} className="border-b border-line/40 last:border-b-0">
              <td className="py-2 text-sm">{MESES_FULL[d.mes]} {d.year}</td>
              <td className="py-2 text-right font-mono text-sm">{fmt(d.eurKwhVoltis, 6)}</td>
              <td className="py-2 text-right font-mono text-sm text-ink-3">{fmt(d.eurKwhSim, 6)}</td>
              <td className="py-2 text-right font-mono text-sm text-salvia font-semibold">−{fmt(d.eurKwhSim - d.eurKwhVoltis, 6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// METODOLOGÍA
// ════════════════════════════════════════════════════════════════════════════

function MetodologiaPanel({ isGas, comercializadoraVoltis, comercializadoraAntigua }: {
  isGas: boolean
  comercializadoraVoltis: string | null
  comercializadoraAntigua: string | null
}) {
  return (
    <div className="rounded-3xl bg-card border border-line p-6 md:p-8 space-y-6 text-sm leading-relaxed text-ink-3">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-salvia mb-2">Método</div>
          <p>
            Simulación inversa: aplicamos los precios de {comercializadoraAntigua ?? 'la comercializadora antigua'} del
            mismo mes natural del año anterior al consumo real facturado por {comercializadoraVoltis ?? 'la comercializadora actual'}.
            {isGas
              ? ' Se compara solo el TV Precio Fijo (término variable de energía).'
              : ' Se aplica precio €/kWh por periodo P1–P6 de la antigua a los kWh facturados por Voltis en cada periodo, diferenciando punta, llano y valle.'}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-salvia mb-2">Por qué es justo</div>
          <p>
            El consumo se ha mantenido constante en ambos escenarios. La diferencia es
            puramente de precio comercial, no de uso. Los conceptos regulados (peajes,
            cargos, bono social, alquiler) se pasan idénticos porque dependen del BOE
            o la CNMC, no del comercializador.
          </p>
        </div>
      </div>

      <div className="border-t border-line pt-6">
        <div className="text-[10px] font-mono uppercase tracking-wider text-salvia mb-3">Concepto a concepto</div>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
          {isGas
            ? (<>
                <Concepto label="Término variable (energía €/kWh)" detalle="Único concepto competitivo. Se sustituye el precio Voltis por el de la antigua del mismo mes año anterior." />
                <Concepto label="Término fijo, peajes, IEH, GTS, CNMC, alquileres" detalle="Costes regulados, idénticos con cualquier comercializadora." />
                <Concepto label="IVA" detalle={'Se aplica el tipo vigente del periodo Voltis (21 % general, 10 % en periodos con reducción gubernamental).'} />
              </>)
            : (<>
                <Concepto label="Término de energía (P1–P6)" detalle="kWh facturados Voltis × €/kWh antigua del mismo periodo del año anterior. Cada periodo (punta, llano, valle) se aplica con su propio precio." />
                <Concepto label="Término de potencia" detalle="Regulado: depende de la potencia contratada y los peajes CNMC. Idéntico en ambos escenarios." />
                <Concepto label="Excesos de potencia" detalle="Regulado: depende de los maxímetros del periodo. Idéntico." />
                <Concepto label="Impuesto eléctrico (Ley 38/1992)" detalle="Tipo vigente del periodo Voltis × (energía + potencia + excesos)." />
                <Concepto label="Bono social, alquiler equipos" detalle="Cargos regulados, idénticos." />
                <Concepto label="IVA" detalle="Tipo vigente del periodo Voltis × base imponible." />
              </>)}
        </div>
      </div>

      <div className="border-t border-line pt-6">
        <div className="text-[10px] font-mono uppercase tracking-wider text-salvia mb-2">Hipótesis</div>
        <p>
          Se asume que la comercializadora anterior habría mantenido los precios del
          año anterior. Si su contrato era indexado a OMIE, la comparativa puede
          desviarse en momentos de alta volatilidad del mercado.
        </p>
      </div>
    </div>
  )
}

function Concepto({ label, detalle }: { label: string; detalle: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <ArrowRight className="w-3.5 h-3.5 mt-1 text-salvia shrink-0" />
      <div>
        <div className="text-ink font-semibold">{label}</div>
        <div className="text-ink-3 text-[13px]">{detalle}</div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ════════════════════════════════════════════════════════════════════════════

function EmptyState({ supplyType }: { supplyType: 'luz' | 'gas' }) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-card p-12 text-center max-w-2xl mx-auto">
      <Sparkles className="w-10 h-10 text-salvia mx-auto mb-4" />
      <h3 className="font-serif text-2xl text-brand mb-2">Aún no hay comparativa</h3>
      <p className="text-sm text-ink-3 max-w-md mx-auto">
        Sube una factura {supplyType === 'gas' ? 'de gas' : 'de luz'} de la nueva
        comercializadora en el bloque "Facturas con Voltis" del gestor de documentos.
        Cuando exista la factura del mismo mes del año anterior, la comparativa
        aparecerá automáticamente aquí.
      </p>
    </div>
  )
}
