'use client'

/**
 * Comparativa 2.0TD con tarifas Gana — flujo commer-style completo.
 *
 * Aplica la lógica desensamblada de commer.es:
 *   - Cálculo con IE × IVA, alquiler contador, financiación bono social, fee gestión
 *   - Detección bono social → "Mantener tarifa actual"
 *   - Detección 3.0TD (>15 kW) → "Tarifa personalizada empresa"
 *   - Optimización de potencia (recomendar ceil(maxDemandada × 1.1, 0.1))
 *   - Mensaje según mix de consumo (valle / punta / equilibrado)
 *   - Animated loading sequence
 */

import React, { useEffect, useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Loader2, X, Download, AlertTriangle, TrendingUp, TrendingDown,
  Zap, Calculator, CheckCircle2, Info, Edit2, RefreshCw, Sparkles,
  Receipt, Gauge, Activity, Award, ShieldCheck, AlertOctagon,
  Building2, BadgePercent, ChevronDown,
} from 'lucide-react'

interface Props {
  supplyId: string
  onClose: () => void
}

type ScenarioGroup = 'full_2tdcalc' | 'bono_social' | 'tarifa_3_0_personalizada' | 'no_data' | 'indexada_insuficiente'

interface PriceRange {
  min: number; max: number; mean: number; weightedMean: number; median: number
  variability: number; samples: number
}
interface PriceAnalysis {
  numBills: number
  tariffNature: 'fija' | 'variable' | 'indexada_detectada' | 'desconocida'
  indexedDetectedKeywords: string[]
  energyP1: PriceRange | null; energyP2: PriceRange | null; energyP3: PriceRange | null
  powerP1: PriceRange | null; powerP2: PriceRange | null
  totalKwh: { p1: number; p2: number; p3: number; total: number }
  totalDays: number; totalAmount: number
}

interface ScenarioResult {
  tipo: 'fija_24h' | 'tramos' | 'mercado'
  nombre: string
  preciosNuevos: {
    energiaP1: number; energiaP2: number; energiaP3: number
    potenciaP1: number; potenciaP2: number
    managementFeeDay: number
  }
  costeActualAnual: number
  desglose: {
    potenciaAnualNeta: number
    energiaAnualNeta: number
    feeGestionAnual: number
    bonoSocialAnual: number
    baseNetaAnual: number
    impuestosBaseSinAlq: number
    alquilerContadorAnual: number
    descuentoBonoSocial: number
    costeAnualConIva: number
  }
  costeMensualGana: number
  ahorroMensual: number
  ahorroAnual: number
  ahorroPorcentaje: number
}

interface PowerOptimization {
  contratadoKw: number
  maxDemandadoKw: number
  recomendadoKw: number
  ahorroAnualEur: number
  precioKwDiaUsado: number
}

interface ApiResponse {
  supply: {
    id: string; cups: string; tariff: string; name: string | null
    client_id: string | null
    client_name: string | null
    client_cif: string | null
  }
  input: {
    consumoP1: number; consumoP2: number; consumoP3: number
    potenciaP1: number; potenciaP2: number
    currentEnergyP1: number; currentEnergyP2: number; currentEnergyP3: number
    currentPowerP1: number; currentPowerP2: number
    totalBillAmount?: number
    diasFacturados?: number
    hasBonoSocial?: boolean
    bonoSocialDiscount?: number
    potenciaMaxDemandadaKw?: number
    fixedFeesMonthly?: number
  }
  result: {
    scenarioGroup: ScenarioGroup
    scenarios: ScenarioResult[]
    bestScenario: ScenarioResult | null
    warnings: string[]
    notice?: string
    consumoAnualKwh: number
    costeActualAnual: number
    powerOptimization: PowerOptimization | null
    consumoMix: {
      p1: number; p2: number; p3: number
      perfil: 'valle' | 'punta' | 'equilibrado'
      recomendacionTextual: string
    }
    priceAnalysis: PriceAnalysis | null
  }
  bills?: any[]
  lastInvoicePeriod?: { start: string | null; end: string | null } | null
}

const fmt = (n: number, decimals = 2) => n.toLocaleString('es-ES', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
})
const fmtEur = (n: number) => `${fmt(n)} €`
const fmtInt = (n: number) => Math.round(n).toLocaleString('es-ES')
const fmtPct = (n: number) => `${fmt(n * 100, 1)}%`

const SCENARIO_META: Record<ScenarioResult['tipo'], {
  label: string; subtitle: string; emoji: string
  ring: string; bgFrom: string; bgTo: string
}> = {
  fija_24h: {
    label: 'Precio Fijo 24H',
    subtitle: 'Precio estable todo el día',
    emoji: '⚡',
    ring: 'ring-emerald-500',
    bgFrom: 'from-emerald-50',
    bgTo: 'to-emerald-100/60',
  },
  tramos: {
    label: 'Por Tramos Horarios',
    subtitle: 'Precios bajos en valle (noches y findes)',
    emoji: '🌙',
    ring: 'ring-sky-500',
    bgFrom: 'from-sky-50',
    bgTo: 'to-sky-100/60',
  },
  mercado: {
    label: 'Indexada al Mercado',
    subtitle: 'Energía a precio de coste + gestión',
    emoji: '📈',
    ring: 'ring-amber-500',
    bgFrom: 'from-amber-50',
    bgTo: 'to-amber-100/60',
  },
}

const LOADING_STEPS = [
  { label: 'Escaneando factura más reciente…',     icon: Receipt },
  { label: 'Identificando tu consumo real…',       icon: Activity },
  { label: 'Detectando tarifas ocultas…',          icon: AlertOctagon },
  { label: 'Comparando con base Gana Energía…',    icon: Sparkles },
  { label: 'Calculando tu ahorro final…',          icon: Calculator },
]

export default function ComparativaGana({ supplyId, onClose }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const minLoadingDone = useRef(false)
  const apiDone = useRef(false)
  const [editable, setEditable] = useState<ApiResponse['input'] | null>(null)
  const [recalcResult, setRecalcResult] = useState<ApiResponse['result'] | null>(null)
  const [recalculating, setRecalculating] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!loading) return
    const id = setInterval(() => setStepIdx(i => Math.min(i + 1, LOADING_STEPS.length - 1)), 700)
    const finish = setTimeout(() => { minLoadingDone.current = true; tryShow() }, 2500)
    return () => { clearInterval(id); clearTimeout(finish) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  function tryShow() {
    if (apiDone.current && minLoadingDone.current) setLoading(false)
  }

  useEffect(() => {
    let active = true
    minLoadingDone.current = false; apiDone.current = false
    setLoading(true); setError(null); setStepIdx(0)
    fetch(`/api/gana/comparativa/${supplyId}`)
      .then(async r => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`)
        if (!active) return
        setData(json); setEditable(json.input); setRecalcResult(json.result)
        apiDone.current = true; tryShow()
      })
      .catch(e => {
        if (!active) return
        setError(e.message); apiDone.current = true; setLoading(false)
      })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyId])

  async function recalculate() {
    if (!editable) return
    setRecalculating(true)
    try {
      const r = await fetch('/api/gana/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: editable }),
      })
      const json = await r.json()
      if (r.ok) setRecalcResult(json.result)
    } finally { setRecalculating(false) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sortedScenarios = useMemo(() => {
    const list = recalcResult?.scenarios ?? []
    return [...list].sort((a, b) => b.ahorroAnual - a.ahorroAnual)
  }, [recalcResult])

  async function downloadXlsx(scenario: ScenarioResult) {
    if (!data) return
    setDownloading(scenario.tipo)
    try {
      // Usa el endpoint específico que genera Excel con los MISMOS valores
      // commer-style que muestra la UI (no recalcula con IVA 21%).
      const res = await fetch(`/api/gana/comparativa/${supplyId}/excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: scenario.tipo }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Comparativa_Gana_${scenario.nombre.replace(/\s+/g, '_')}_${(data.supply.client_name || 'cliente').replace(/\s+/g, '_')}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`Error generando Excel: ${e?.message ?? e}`)
    } finally {
      setDownloading(null)
    }
  }

  if (!mounted) return null

  const result = recalcResult
  const consumoAnual = result?.consumoAnualKwh ?? 0
  const facturaAnualActual = result?.costeActualAnual ?? 0
  const bestScenario = sortedScenarios[0] ?? null
  const tieneAhorro = bestScenario && bestScenario.ahorroAnual > 50
  const isSpecialCase = result && result.scenarioGroup !== 'full_2tdcalc'

  // ─── Render ─────────────────────────────────────────────────────────────
  const content = (
    <div className="fixed inset-0 z-[9999] bg-stone-900/70 backdrop-blur-md flex items-stretch md:items-center md:justify-center md:p-4 overflow-y-auto">
      <div className="bg-stone-50 w-full md:max-w-6xl md:rounded-3xl shadow-2xl md:my-4 flex flex-col max-h-[100vh] md:max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-stone-200 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-500 grid place-items-center flex-shrink-0 shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-bold text-stone-900 truncate">
                Comparativa Gana 2.0TD
              </h2>
              <p className="text-xs md:text-sm text-stone-500 truncate">
                {data?.supply.client_name ?? 'Cargando…'}
                {data?.supply.cups && <span className="font-mono ml-2">· {data.supply.cups}</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-stone-100 rounded-lg flex-shrink-0 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5 text-stone-600" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && <LoadingSequence stepIdx={stepIdx} />}

          {error && !loading && (
            <div className="p-6 md:p-10">
              <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800">
                <div className="flex items-center gap-2 font-semibold mb-2">
                  <AlertTriangle className="w-5 h-5" /> No se pudo calcular
                </div>
                <p className="text-sm">{error}</p>
                {error.includes('refresh-tarifas') && (
                  <p className="text-xs mt-3 text-rose-700">
                    Un admin debe ejecutar <code>POST /api/gana/refresh-tarifas</code> antes.
                  </p>
                )}
              </div>
            </div>
          )}

          {data && result && !loading && !error && (
            <div className="p-4 md:p-8 space-y-6">

              {/* Hero block */}
              <div className="rounded-3xl bg-white border border-stone-200 p-6 md:p-8 shadow-sm">
                <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
                  <div>
                    <div className="text-xs uppercase tracking-wide font-semibold text-stone-500 mb-1">
                      Análisis completado
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold text-stone-900">
                      {data.supply.client_name ?? 'Cliente'}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone="default" icon={Zap}>{data.supply.tariff}</Badge>
                      {result.priceAnalysis && (
                        <Badge
                          tone={
                            result.priceAnalysis.tariffNature === 'fija' ? 'ok' :
                            result.priceAnalysis.tariffNature === 'indexada_detectada' ? 'warn' :
                            result.priceAnalysis.tariffNature === 'variable' ? 'warn' : 'info'
                          }
                          icon={Receipt}
                        >
                          {result.priceAnalysis.numBills} {result.priceAnalysis.numBills === 1 ? 'factura' : 'facturas'}
                          {result.priceAnalysis.tariffNature === 'fija' && ' · tarifa fija'}
                          {result.priceAnalysis.tariffNature === 'variable' && ' · precios variables'}
                          {result.priceAnalysis.tariffNature === 'indexada_detectada' && ' · indexada detectada'}
                        </Badge>
                      )}
                      {result.powerOptimization && (
                        <Badge tone="ok" icon={Gauge}>Optimización potencia disponible</Badge>
                      )}
                    </div>
                  </div>

                  {!isSpecialCase && tieneAhorro && bestScenario && (
                    <div className="text-right">
                      <div className="text-xs uppercase font-semibold text-emerald-700 mb-1">
                        Mejor ahorro detectado
                      </div>
                      <div className="text-3xl md:text-4xl font-bold text-emerald-700">
                        {fmtEur(bestScenario.ahorroAnual)} <span className="text-base font-medium">/año</span>
                      </div>
                      <div className="text-sm text-stone-500 mt-1">
                        {fmtEur(bestScenario.ahorroMensual)} mensuales · {fmt(bestScenario.ahorroPorcentaje, 1)}%
                      </div>
                    </div>
                  )}
                </div>

                {/* KPI strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Kpi icon={Receipt}  label="Factura anual extrapolada" value={fmtEur(facturaAnualActual)} />
                  <Kpi icon={Activity} label="Consumo anual"               value={`${fmtInt(consumoAnual)} kWh`} />
                  <Kpi icon={Gauge}    label="Potencia contratada"
                       value={`P1 ${fmt(data.input.potenciaP1, 2)} · P2 ${fmt(data.input.potenciaP2, 2)} kW`} />
                  <Kpi icon={Receipt}  label="€/kWh medio actual"
                       value={(() => {
                         const total = data.input.consumoP1 + data.input.consumoP2 + data.input.consumoP3
                         if (total <= 0) return '—'
                         const sum = data.input.consumoP1 * data.input.currentEnergyP1
                                 + data.input.consumoP2 * data.input.currentEnergyP2
                                 + data.input.consumoP3 * data.input.currentEnergyP3
                         return fmt(sum / total, 4)
                       })()} />
                </div>

                {/* Desglose kWh */}
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <PeriodBar label="P1 Punta"  value={data.input.consumoP1} total={consumoAnual} color="bg-rose-500" />
                  <PeriodBar label="P2 Llano"  value={data.input.consumoP2} total={consumoAnual} color="bg-amber-500" />
                  <PeriodBar label="P3 Valle"  value={data.input.consumoP3} total={consumoAnual} color="bg-emerald-500" />
                </div>

                {/* Análisis precios actuales (rangos) */}
                {result.priceAnalysis && result.priceAnalysis.numBills > 1 && (
                  <details className="mt-4 rounded-xl border border-stone-200 bg-stone-50 overflow-hidden">
                    <summary className="px-4 py-3 cursor-pointer hover:bg-stone-100 text-sm font-semibold text-stone-700 flex items-center gap-2">
                      <ChevronDown className="w-4 h-4" />
                      Rango de precios actuales · {result.priceAnalysis.numBills} facturas analizadas
                    </summary>
                    <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      {(['energyP1','energyP2','energyP3'] as const).map((k, i) => {
                        const r = result.priceAnalysis![k]
                        const labels = ['P1 Punta', 'P2 Llano', 'P3 Valle'][i]
                        if (!r) return null
                        return (
                          <div key={k} className="bg-white rounded-lg border border-stone-200 p-2.5">
                            <div className="font-semibold text-stone-700 text-[11px] mb-1">{labels}</div>
                            <div className="font-mono text-stone-900">
                              {fmt(r.weightedMean, 5)} <span className="text-[10px] text-stone-500">€/kWh</span>
                            </div>
                            <div className="text-[10px] text-stone-500 mt-0.5">
                              Rango: {fmt(r.min, 4)}–{fmt(r.max, 4)} · σ {fmt(r.variability * 100, 1)}%
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )}

                {/* Perfil de consumo */}
                <div className="mt-4 rounded-xl bg-stone-50 border border-stone-200 p-3 flex items-start gap-2.5 text-sm text-stone-700">
                  <Activity className="w-4 h-4 mt-0.5 text-stone-500 flex-shrink-0" />
                  <div>
                    <span className="font-semibold capitalize">Perfil {result.consumoMix.perfil}:</span>
                    {' '}{result.consumoMix.recomendacionTextual}
                  </div>
                </div>

                {result.warnings.length > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 mb-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Avisos
                    </div>
                    <ul className="text-xs text-amber-800 space-y-1">
                      {result.warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-1 w-1 h-1 rounded-full bg-amber-600 flex-shrink-0" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Special cases */}
              {result.scenarioGroup === 'bono_social' && (
                <SpecialNotice
                  icon={BadgePercent}
                  tone="info"
                  title="Mantén tu Bono Social"
                  body={result.notice || ''}
                />
              )}
              {result.scenarioGroup === 'tarifa_3_0_personalizada' && (
                <SpecialNotice
                  icon={Building2}
                  tone="info"
                  title="Tarifa personalizada empresa (3.0TD)"
                  body={result.notice || ''}
                />
              )}
              {result.scenarioGroup === 'no_data' && (
                <SpecialNotice
                  icon={AlertTriangle}
                  tone="warn"
                  title="Faltan datos para calcular"
                  body={result.notice || ''}
                />
              )}
              {result.scenarioGroup === 'indexada_insuficiente' && (
                <SpecialNotice
                  icon={AlertTriangle}
                  tone="warn"
                  title="Tarifa indexada · sube más facturas"
                  body={result.notice || ''}
                />
              )}

              {/* Tu tarifa ya es competitiva */}
              {result.scenarioGroup === 'full_2tdcalc' && !tieneAhorro && bestScenario && (
                <div className="rounded-3xl bg-emerald-50 border border-emerald-200 p-6 md:p-8 flex items-center gap-4">
                  <ShieldCheck className="w-10 h-10 text-emerald-600 flex-shrink-0" />
                  <div>
                    <h3 className="text-lg font-bold text-emerald-900">Tu tarifa ya es competitiva</h3>
                    <p className="text-sm text-emerald-800 mt-1">
                      Con los precios actuales de Gana Energía no podemos mejorar significativamente tu factura
                      {bestScenario.ahorroAnual > 0
                        ? ` (ahorro máximo: ${fmtEur(bestScenario.ahorroAnual)}/año)`
                        : ` (cambiar sumaría ${fmtEur(-bestScenario.ahorroAnual)}/año)`}.
                      Considera mantener la comercializadora actual.
                    </p>
                  </div>
                </div>
              )}

              {/* Power optimization */}
              {result.powerOptimization && (
                <div className="rounded-3xl bg-gradient-to-br from-sky-50 to-cyan-50 border border-sky-200 p-6 md:p-8">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white grid place-items-center flex-shrink-0">
                      <Gauge className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-sky-900">Optimización de potencia</h3>
                      <p className="text-sm text-sky-800 mt-1">
                        Tu maxímetro indica que solo demandas{' '}
                        <strong>{fmt(result.powerOptimization.maxDemandadoKw, 2)} kW</strong> y tienes
                        contratados <strong>{fmt(result.powerOptimization.contratadoKw, 1)} kW</strong>.
                        Podrías reducir a <strong>{fmt(result.powerOptimization.recomendadoKw, 1)} kW</strong>{' '}
                        (110% del máximo demandado).
                      </p>
                      <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-sky-200 text-sky-900 font-bold">
                        <TrendingUp className="w-4 h-4" />
                        Ahorro adicional: {fmtEur(result.powerOptimization.ahorroAnualEur)} /año
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Scenario cards */}
              {result.scenarioGroup === 'full_2tdcalc' && sortedScenarios.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {sortedScenarios.map((sc, idx) => {
                    const meta = SCENARIO_META[sc.tipo]
                    const isBest = idx === 0 && sc.ahorroAnual > 50
                    const ahorroPositivo = sc.ahorroAnual > 0
                    return (
                      <div
                        key={sc.tipo}
                        className={`relative rounded-3xl bg-gradient-to-br ${meta.bgFrom} ${meta.bgTo} border border-stone-200 p-5 flex flex-col shadow-sm ${
                          isBest ? `ring-2 ring-offset-2 ${meta.ring}` : ''
                        }`}
                      >
                        {isBest && (
                          <div className="absolute -top-3 left-4 px-3 py-1 rounded-full bg-stone-900 text-white text-xs font-bold flex items-center gap-1 shadow-md">
                            <Award className="w-3 h-3" /> Mejor opción
                          </div>
                        )}

                        <div className="mb-4">
                          <div className="text-2xl mb-1">{meta.emoji}</div>
                          <div className="font-bold text-lg text-stone-900">{meta.label}</div>
                          <div className="text-xs text-stone-600 mt-0.5">{meta.subtitle}</div>
                        </div>

                        <div className="text-center my-2 pb-3 border-b border-stone-200">
                          <div className="text-xs uppercase tracking-wide text-stone-500">
                            Ahorro anual
                          </div>
                          <div className={`text-3xl md:text-4xl font-bold mt-1 ${
                            ahorroPositivo ? 'text-emerald-700' : 'text-stone-500'
                          }`}>
                            {ahorroPositivo
                              ? <TrendingUp className="inline w-6 h-6 mr-1" />
                              : <TrendingDown className="inline w-6 h-6 mr-1" />}
                            {fmtEur(sc.ahorroAnual)}
                          </div>
                          <div className="text-xs text-stone-600 mt-1">
                            {fmtEur(sc.ahorroMensual)}/mes · {fmt(sc.ahorroPorcentaje, 1)}%
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs text-stone-700 pt-3">
                          <Row label="Factura mensual Gana:" value={fmtEur(sc.costeMensualGana)} mono />
                          <Row label="Coste anual actual:"  value={fmtEur(sc.costeActualAnual)} mono />
                          <Row label="Coste anual Gana:"    value={fmtEur(sc.desglose.costeAnualConIva)} mono />
                        </div>

                        <details className="mt-3 text-xs text-stone-600">
                          <summary className="cursor-pointer hover:text-stone-900 font-medium flex items-center gap-1">
                            <ChevronDown className="w-3 h-3" /> Desglose
                          </summary>
                          <div className="mt-2 space-y-1 font-mono text-[11px]">
                            <Row label="① Potencia neto:"    value={fmtEur(sc.desglose.potenciaAnualNeta)} mono />
                            <Row label="② Energía neto:"     value={fmtEur(sc.desglose.energiaAnualNeta)} mono />
                            <Row label="③ Fee gestión:"       value={fmtEur(sc.desglose.feeGestionAnual)} mono />
                            <Row label="④ Bono social fin.:"  value={fmtEur(sc.desglose.bonoSocialAnual)} mono />
                            <Row label="─ Base neta:"         value={fmtEur(sc.desglose.baseNetaAnual)} mono />
                            <Row label="× IE + IVA:"           value={fmtEur(sc.desglose.impuestosBaseSinAlq)} mono />
                            <Row label="+ Alquiler contador:" value={fmtEur(sc.desglose.alquilerContadorAnual)} mono />
                            {sc.desglose.descuentoBonoSocial > 0 && (
                              <Row label="− Descuento bono:" value={`-${fmtEur(sc.desglose.descuentoBonoSocial)}`} mono />
                            )}
                          </div>
                          <div className="mt-2 pt-2 border-t border-stone-200 grid grid-cols-3 gap-1 text-[10px]">
                            <div>P1: {fmt(sc.preciosNuevos.energiaP1, 5)}</div>
                            <div>P2: {fmt(sc.preciosNuevos.energiaP2, 5)}</div>
                            <div>P3: {fmt(sc.preciosNuevos.energiaP3, 5)}</div>
                          </div>
                        </details>

                        <button
                          onClick={() => downloadXlsx(sc)}
                          disabled={downloading === sc.tipo}
                          className={`mt-4 w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${
                            isBest
                              ? 'bg-stone-900 text-white hover:bg-stone-800 shadow-md'
                              : 'bg-white text-stone-900 border border-stone-300 hover:bg-stone-50'
                          }`}
                        >
                          {downloading === sc.tipo
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Download className="w-4 h-4" />}
                          Descargar Excel
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Edit data */}
              {!isSpecialCase && (
                <details
                  open={showEdit}
                  onToggle={(e) => setShowEdit((e.currentTarget as HTMLDetailsElement).open)}
                  className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm"
                >
                  <summary className="flex items-center gap-2 px-5 py-4 cursor-pointer hover:bg-stone-50 text-sm font-semibold text-stone-700">
                    <Edit2 className="w-4 h-4" />
                    Ajustar datos (potencias, consumos, precios)
                  </summary>
                  <div className="px-5 pb-5 grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-stone-100 pt-4">
                    <Field label="Potencia P1 (kW)"        value={editable!.potenciaP1}     onChange={v => setEditable({ ...editable!, potenciaP1: v })} step="0.001" />
                    <Field label="Potencia P2 (kW)"        value={editable!.potenciaP2}     onChange={v => setEditable({ ...editable!, potenciaP2: v })} step="0.001" />
                    <Field label="Consumo P1 kWh/año"      value={editable!.consumoP1}      onChange={v => setEditable({ ...editable!, consumoP1: v })} step="1" />
                    <Field label="Consumo P2 kWh/año"      value={editable!.consumoP2}      onChange={v => setEditable({ ...editable!, consumoP2: v })} step="1" />
                    <Field label="Consumo P3 kWh/año"      value={editable!.consumoP3}      onChange={v => setEditable({ ...editable!, consumoP3: v })} step="1" />
                    <Field label="Precio P1 (€/kWh)"       value={editable!.currentEnergyP1} onChange={v => setEditable({ ...editable!, currentEnergyP1: v })} step="0.000001" />
                    <Field label="Precio P2 (€/kWh)"       value={editable!.currentEnergyP2} onChange={v => setEditable({ ...editable!, currentEnergyP2: v })} step="0.000001" />
                    <Field label="Precio P3 (€/kWh)"       value={editable!.currentEnergyP3} onChange={v => setEditable({ ...editable!, currentEnergyP3: v })} step="0.000001" />
                    <Field label="Pot. P1 (€/kW·día)"      value={editable!.currentPowerP1}  onChange={v => setEditable({ ...editable!, currentPowerP1: v })} step="0.000001" />
                    <Field label="Pot. P2 (€/kW·día)"      value={editable!.currentPowerP2}  onChange={v => setEditable({ ...editable!, currentPowerP2: v })} step="0.000001" />
                    <div className="col-span-2 md:col-span-4 flex justify-end pt-2">
                      <button
                        onClick={recalculate}
                        disabled={recalculating}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {recalculating
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <RefreshCw className="w-4 h-4" />}
                        Recalcular
                      </button>
                    </div>
                  </div>
                </details>
              )}

              {/* Footer */}
              <div className="rounded-2xl border border-stone-200 bg-white p-4 text-xs text-stone-500 flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  Cálculo basado en el modelo de Commer Energía: 365 días/año, IE ×1.005, IVA ×1.10, alquiler
                  contador 0.02663 €/día, financiación bono social 0.019122 €/día (si no tiene bono).
                  Precios actuales extraídos de la última factura{data.lastInvoicePeriod?.end
                    ? ` (periodo hasta ${new Date(data.lastInvoicePeriod.end).toLocaleDateString('es-ES')})`
                    : ''}.
                  Si hay cargos fijos extra (Smart Iberdrola, mantenimiento) se reportan como aviso,
                  no se restan al ahorro.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function LoadingSequence({ stepIdx }: { stepIdx: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-sky-500 grid place-items-center mb-6 shadow-xl shadow-emerald-500/30 animate-pulse">
        <Sparkles className="w-9 h-9 text-white" />
      </div>
      <div className="text-lg font-bold text-stone-900 mb-1">Análisis inteligente</div>
      <div className="text-sm text-stone-500 mb-8">Calculando ahorros con tarifas Gana Energía</div>
      <div className="w-full max-w-md space-y-2">
        {LOADING_STEPS.map((s, i) => {
          const done = i < stepIdx
          const active = i === stepIdx
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                active ? 'bg-emerald-50 border border-emerald-200' :
                done   ? 'bg-stone-50 opacity-60' : 'opacity-30'
              }`}
            >
              {done
                ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                : active
                  ? <Loader2 className="w-5 h-5 text-emerald-600 animate-spin flex-shrink-0" />
                  : <s.icon className="w-5 h-5 text-stone-400 flex-shrink-0" />}
              <span className={`text-sm ${
                active ? 'text-emerald-900 font-medium' :
                done   ? 'text-stone-700' : 'text-stone-400'
              }`}>{s.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Kpi(props: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-center gap-2 text-stone-500 text-[11px] uppercase tracking-wide font-medium">
        <props.icon className="w-3.5 h-3.5" /> {props.label}
      </div>
      <div className="mt-1 font-bold text-stone-900 text-sm md:text-base">{props.value}</div>
    </div>
  )
}

function Badge(props: { tone: 'default' | 'warn' | 'info' | 'ok'; icon: any; children: React.ReactNode }) {
  const tones = {
    default: 'bg-stone-100 text-stone-700',
    warn:    'bg-amber-100 text-amber-800',
    info:    'bg-sky-100 text-sky-800',
    ok:      'bg-emerald-100 text-emerald-800',
  } as const
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${tones[props.tone]}`}>
      <props.icon className="w-3 h-3" /> {props.children}
    </span>
  )
}

function PeriodBar(props: { label: string; value: number; total: number; color: string }) {
  const pct = props.total > 0 ? (props.value / props.total) * 100 : 0
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-semibold text-stone-700">{props.label}</span>
        <span className="text-[10px] text-stone-500">{fmt(pct, 1)}%</span>
      </div>
      <div className="text-sm font-bold text-stone-900 mb-1.5">
        {fmtInt(props.value)} <span className="text-[10px] font-normal text-stone-500">kWh</span>
      </div>
      <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
        <div className={`h-full ${props.color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Field(props: {
  label: string
  value: number
  onChange: (v: number) => void
  step: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-stone-600">{props.label}</span>
      <input
        type="number"
        value={props.value}
        step={props.step}
        onChange={e => props.onChange(parseFloat(e.target.value) || 0)}
        className="px-2 py-1.5 rounded-lg border border-stone-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </label>
  )
}

function Row(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-600">{props.label}</span>
      <span className={`${props.mono ? 'font-mono' : ''} font-medium text-stone-900`}>{props.value}</span>
    </div>
  )
}

function SpecialNotice(props: {
  icon: any; tone: 'info' | 'warn'; title: string; body: string
}) {
  const tones = {
    info: 'bg-sky-50 border-sky-200 text-sky-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
  } as const
  const iconBg = {
    info: 'bg-sky-600',
    warn: 'bg-amber-600',
  } as const
  return (
    <div className={`rounded-3xl border p-6 md:p-8 ${tones[props.tone]}`}>
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-2xl ${iconBg[props.tone]} text-white grid place-items-center flex-shrink-0`}>
          <props.icon className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold">{props.title}</h3>
          <p className="text-sm mt-1 opacity-90">{props.body}</p>
        </div>
      </div>
    </div>
  )
}
