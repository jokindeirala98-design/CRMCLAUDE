'use client'

import { useState } from 'react'
import {
  X, Download, Loader2, FileSpreadsheet, Info, CheckCircle2, StickyNote,
  Sparkles, FileText, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getPeriodCount } from '@/lib/boe-prices'
import { VOLTIS_TARIFFS_2TD, compute2TDSavings, type VoltisKey2TD } from '@/lib/voltis-tariffs-2td'

interface Props {
  supplyId: string
  cups: string
  tariff: string
  clientName: string
  comercializadoraActual?: string
  consumptionByPeriod?: number[]
  powersByPeriod?: number[]
  comercializadoras?: { id: string; name: string }[]
  /** Average energy price (€/kWh) computed from the supply's invoices */
  currentAvgEnergyPrice?: number
  /** Current power prices (€/kW·día) from the supply's most recent invoice */
  currentPowerPriceP1?: number
  currentPowerPriceP2?: number
  /** Si true: guarda en storage + crea study record + avanza pipeline al generar */
  autoSave?: boolean
  onClose: () => void
  /** Callback tras guardar con éxito (para que el padre actualice su estado) */
  onSaved?: () => void
}

const PERIOD_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

function pctColor(pct: number) {
  if (pct < 0.20) return 'text-ok bg-ok-container/30'
  if (pct < 0.39) return 'text-warn bg-warn-container/30'
  return 'text-err bg-err-container/30'
}

function is2TDTariff(t?: string | null): boolean {
  if (!t) return false
  const n = t.trim().replace(/\s+/g, '').toUpperCase()
  return n.startsWith('2.0') || n === '2.0TD' || n === '20TD'
}

function fmt(v: number, dec = 2) {
  return v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

// ─── 2.0TD Comparison PDF (client-side) ─────────────────────────────────────

function open2TDPdf(params: {
  titular: string; cups: string; tariffKey: VoltisKey2TD
  consumo: { P1: number; P2: number; P3: number }
  potencia: { P1: number; P2: number }
  currentEnergyPrice: number; currentPowerP1: number; currentPowerP2: number
}) {
  const { titular, cups, tariffKey, consumo, potencia, currentEnergyPrice, currentPowerP1, currentPowerP2 } = params
  const tariff = VOLTIS_TARIFFS_2TD[tariffKey]
  const result = compute2TDSavings(consumo, potencia, currentEnergyPrice, currentPowerP1, currentPowerP2, tariffKey)
  const fmtSign = (v: number) => (v >= 0 ? '+' : '') + fmt(v)
  const savColor = result.savings.totalAnnual >= 0 ? '#3D7A4B' : '#C0392B'
  const savBg    = result.savings.totalAnnual >= 0 ? '#E8F5E9' : '#FDECEA'
  const totalKwh = consumo.P1 + consumo.P2 + consumo.P3

  const css = `
    *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:A4;margin:0}
    body{background:#F4EEE2;color:#2D3A33}
    .page{width:210mm;min-height:297mm;padding:16mm 14mm;page-break-after:always;display:flex;flex-direction:column;background:#F4EEE2}
    .cover{align-items:center;justify-content:center;gap:12px}
    .logo{font-size:54px;font-weight:900;letter-spacing:0.08em;color:#6B8068}
    .logo-sub{font-size:13px;letter-spacing:0.4em;color:#8A9A8E;font-weight:700}
    .divider{width:60px;height:3px;background:#6B8068;border-radius:99px;margin:6px 0}
    .cover-name{font-size:22px;font-weight:800;color:#2D3A33;margin-top:8px;text-align:center}
    .tariff-badge{display:inline-block;padding:7px 22px;border-radius:99px;background:#E0E8DC;color:#5A6E58;font-size:12px;font-weight:800;letter-spacing:0.15em}
    .cups-badge{font-size:10px;color:#8A9A8E;font-family:monospace;margin-top:4px}
    .sec-title{font-size:9px;font-weight:800;letter-spacing:0.3em;color:#8A9A8E;margin-bottom:8px}
    .section-hd{font-size:13px;font-weight:800;color:#2D3A33;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #E5DCC9}
    .card{background:#FBF7EE;border-radius:10px;border:1px solid #E5DCC9;padding:14px 16px;margin-bottom:12px}
    .card-title{font-size:9px;font-weight:700;letter-spacing:0.2em;color:#5A6B5F;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th{background:#EDE8DC;color:#5A6B5F;font-weight:700;padding:7px 10px;text-align:center;border:1px solid #D9D0BA}
    th:first-child{text-align:left}
    td{padding:6px 10px;border:1px solid #E5DCC9;text-align:center}
    td:first-child{text-align:left;font-weight:600}
    tr:nth-child(even) td{background:#F4EEE2}
    .row-actual td{color:#5A6B5F}
    .row-nuevo td{color:#5A6E58;font-weight:700;background:#E0E8DC!important}
    .row-diff td{font-weight:800}
    .sum-box{background:#FBF7EE;border-radius:12px;border:2px solid #D9D0BA;padding:18px 22px;margin-top:14px;display:flex;justify-content:space-between;align-items:center}
    .sum-lbl{font-size:10px;font-weight:700;letter-spacing:0.15em;color:#5A6B5F}
    .sum-val{font-size:28px;font-weight:900}
    .sum-monthly{font-size:12px;color:#8A9A8E;margin-top:2px}
    .footer-bar{margin-top:auto;padding-top:12px;border-top:1px solid #E5DCC9;font-size:8px;color:#8A9A8E;display:flex;justify-content:space-between}
  `
  const page1 = `<div class="page cover" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">
  <div class="logo">VOLTIS</div>
  <div class="logo-sub">COMPARATIVA TARIFAS 2.0TD</div>
  <div class="divider"></div>
  <div class="cover-name">${titular}</div>
  <div class="tariff-badge">${tariff.name.toUpperCase()}</div>
  <div class="cups-badge">${cups}</div>
</div>`

  const page2 = `<div class="page">
  <div class="sec-title">COMPARATIVA TARIFAS 2.0TD · VOLTIS</div>
  <div class="section-hd">TÉRMINO DE POTENCIA</div>
  <div class="card">
    <div class="card-title">POTENCIA CONTRATADA: P1 ${fmt(potencia.P1)} kW · P2 ${fmt(potencia.P2)} kW</div>
    <table>
      <thead><tr><th>Concepto</th><th>Punta (P1)</th><th>Valle (P2)</th><th>Total anual IVA</th></tr></thead>
      <tbody>
        <tr class="row-actual"><td>Precio actual (€/kW·día)</td><td>${fmt(currentPowerP1, 6)}</td><td>${fmt(currentPowerP2, 6)}</td><td>${fmt(result.current.power)} €</td></tr>
        <tr class="row-nuevo"><td>Voltis ${tariff.name} (€/kW·día)</td><td>${fmt(tariff.power.P1, 6)}</td><td>${fmt(tariff.power.P2, 6)}</td><td>${fmt(result.nuevo.power)} €</td></tr>
        <tr class="row-diff"><td>Diferencia potencia</td><td>—</td><td>—</td><td style="color:${result.savings.power >= 0 ? '#3D7A4B' : '#C0392B'}">${fmtSign(result.savings.power)} €</td></tr>
      </tbody>
    </table>
  </div>
  <div class="section-hd">TÉRMINO DE ENERGÍA</div>
  <div class="card">
    <div class="card-title">CONSUMO SIPS: ${Math.round(totalKwh).toLocaleString('es-ES')} kWh · P1 Punta ${Math.round(consumo.P1).toLocaleString('es-ES')} · P2 Llano ${Math.round(consumo.P2).toLocaleString('es-ES')} · P3 Valle ${Math.round(consumo.P3).toLocaleString('es-ES')} kWh</div>
    <table>
      <thead><tr><th>Concepto</th><th>Punta (P1)</th><th>Llano (P2)</th><th>Valle (P3)</th><th>Total anual IVA</th></tr></thead>
      <tbody>
        <tr class="row-actual"><td>Precio actual (€/kWh)</td><td>${fmt(currentEnergyPrice, 4)}</td><td>${fmt(currentEnergyPrice, 4)}</td><td>${fmt(currentEnergyPrice, 4)}</td><td>${fmt(result.current.energy)} €</td></tr>
        <tr class="row-nuevo"><td>Voltis ${tariff.name} (€/kWh)</td><td>${fmt(tariff.energy.P1, 4)}</td><td>${fmt(tariff.energy.P2, 4)}</td><td>${fmt(tariff.energy.P3, 4)}</td><td>${fmt(result.nuevo.energy)} €</td></tr>
        <tr class="row-diff"><td>Diferencia energía</td><td>—</td><td>—</td><td>—</td><td style="color:${result.savings.energy >= 0 ? '#3D7A4B' : '#C0392B'}">${fmtSign(result.savings.energy)} €</td></tr>
      </tbody>
    </table>
  </div>
  <div class="sum-box">
    <div>
      <div class="sum-lbl">AHORRO TOTAL ESTIMADO ANUAL (IVA INCL.)</div>
      <div class="sum-monthly" style="color:${savColor}">Mensual estimado: ${fmtSign(result.savings.totalMonthly)} €/mes</div>
    </div>
    <div class="sum-val" style="color:${savColor};background:${savBg};padding:10px 18px;border-radius:10px">${fmtSign(result.savings.totalAnnual)} €</div>
  </div>
  <div class="footer-bar">
    <span>Generado por Voltis CRM · Datos SIPS + precios medios facturados · IVA 21% incluido</span>
    <span>${tariff.name} · ${cups}</span>
  </div>
</div>`

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Comparativa 2.0TD — ${titular}</title><style>${css}</style></head><body>${page1}${page2}</body></html>`
  const w = window.open('', '_blank')
  if (!w) { alert('Activa las ventanas emergentes para generar el PDF'); return }
  w.document.open(); w.document.write(html); w.document.close()
  setTimeout(() => w.print(), 800)
}

// ─── Subcomponent: 2.0TD Comparison View ────────────────────────────────────

function Comparativa2TDView({
  cups, clientName,
  consumo, potencia,
  currentEnergyPrice, currentPowerP1, currentPowerP2,
}: {
  cups: string; clientName: string
  consumo: { P1: number; P2: number; P3: number }
  potencia: { P1: number; P2: number }
  currentEnergyPrice: number; currentPowerP1: number; currentPowerP2: number
}) {
  const [downloading, setDownloading] = useState<VoltisKey2TD | null>(null)

  const totalKwh = consumo.P1 + consumo.P2 + consumo.P3

  const results = (Object.keys(VOLTIS_TARIFFS_2TD) as VoltisKey2TD[]).map(key => ({
    key,
    tariff: VOLTIS_TARIFFS_2TD[key],
    result: compute2TDSavings(consumo, potencia, currentEnergyPrice, currentPowerP1, currentPowerP2, key),
  })).sort((a, b) => b.result.savings.totalAnnual - a.result.savings.totalAnnual)

  const hasEnoughData = totalKwh > 0 && currentEnergyPrice > 0

  if (!hasEnoughData) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-6">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#E5DCC9' }}>
          <Zap className="w-6 h-6" style={{ color: '#8A9A8E' }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: '#2D3A33' }}>Datos insuficientes</p>
        <p className="text-xs" style={{ color: '#5A6B5F' }}>
          Necesitas datos de consumo SIPS y al menos una factura procesada para calcular el ahorro.
        </p>
      </div>
    )
  }

  return (
    <div className="px-6 py-5 space-y-3">
      {/* Context */}
      <div className="rounded-xl p-3 text-xs" style={{ background: '#E0E8DC', border: '1px solid #C8D8C4' }}>
        <p style={{ color: '#5A6E58' }}>
          <strong>Consumo SIPS:</strong> {Math.round(totalKwh).toLocaleString('es-ES')} kWh/año
          (P1 {Math.round(consumo.P1).toLocaleString('es-ES')} · P2 {Math.round(consumo.P2).toLocaleString('es-ES')} · P3 {Math.round(consumo.P3).toLocaleString('es-ES')}) ·{' '}
          <strong>Precio medio actual:</strong> {fmt(currentEnergyPrice, 4)} €/kWh · IVA 21% incluido
        </p>
      </div>

      {/* Tariff cards */}
      {results.map((item, idx) => {
        const isBest = idx === 0
        const saving = item.result.savings.totalAnnual
        const savColor = saving >= 0 ? '#3D7A4B' : '#C0392B'
        const savBg    = saving >= 0 ? '#E8F5E9' : '#FDECEA'

        return (
          <div key={item.key} className="rounded-xl p-4"
            style={{
              background: isBest ? '#E0E8DC' : '#F4EEE2',
              border: isBest ? '2px solid #6B8068' : '1px solid #E5DCC9',
            }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {isBest && (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: '#C7F24A', color: '#2D3A33' }}>
                      MEJOR OPCIÓN
                    </span>
                  )}
                  <span className="text-xs font-black tracking-[0.1em]" style={{ color: '#5A6E58' }}>
                    {item.tariff.name.toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <p className="text-[10px]" style={{ color: '#8A9A8E' }}>Energía P1 / P2 / P3</p>
                    <p className="text-[11px] font-bold font-mono" style={{ color: '#2D3A33' }}>
                      {item.tariff.energy.P1.toFixed(3)} / {item.tariff.energy.P2.toFixed(3)} / {item.tariff.energy.P3.toFixed(3)} €/kWh
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: '#8A9A8E' }}>Potencia P1 / P2</p>
                    <p className="text-[11px] font-bold font-mono" style={{ color: '#2D3A33' }}>
                      {item.tariff.power.P1.toFixed(4)} / {item.tariff.power.P2.toFixed(4)} €/kW·día
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: '#8A9A8E' }}>Ahorro potencia</p>
                    <p className="text-[11px] font-bold" style={{ color: item.result.savings.power >= 0 ? '#3D7A4B' : '#C0392B' }}>
                      {item.result.savings.power >= 0 ? '+' : ''}{fmt(item.result.savings.power)} €/año
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: '#8A9A8E' }}>Ahorro energía</p>
                    <p className="text-[11px] font-bold" style={{ color: item.result.savings.energy >= 0 ? '#3D7A4B' : '#C0392B' }}>
                      {item.result.savings.energy >= 0 ? '+' : ''}{fmt(item.result.savings.energy)} €/año
                    </p>
                  </div>
                </div>
              </div>

              {/* Saving badge */}
              <div className="text-right shrink-0">
                <div className="rounded-lg px-3 py-2" style={{ background: savBg }}>
                  <p className="text-[9px] font-bold tracking-wider" style={{ color: savColor }}>AHORRO ANUAL</p>
                  <p className="text-2xl font-black leading-tight" style={{ color: savColor }}>
                    {saving >= 0 ? '+' : ''}{Math.round(saving).toLocaleString('es-ES')} €
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: savColor }}>
                    {(saving / 12 >= 0 ? '+' : '')}{Math.round(saving / 12).toLocaleString('es-ES')} €/mes
                  </p>
                </div>
              </div>
            </div>

            {/* Download row */}
            <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #D9D0BA' }}>
              <button
                onClick={() => open2TDPdf({ titular: clientName, cups, tariffKey: item.key, consumo, potencia, currentEnergyPrice, currentPowerP1, currentPowerP2 })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition hover:opacity-80"
                style={{ background: '#6B8068', color: '#FBF7EE' }}>
                <FileText className="w-3.5 h-3.5" /> PDF
              </button>
              <button
                onClick={async () => {
                  setDownloading(item.key)
                  try {
                    const res = await fetch('/api/comparativa-2td', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        titular: clientName, cups, tariffKey: item.key,
                        consumoP1: consumo.P1, consumoP2: consumo.P2, consumoP3: consumo.P3,
                        potenciaP1: potencia.P1, potenciaP2: potencia.P2,
                        currentEnergyPrice, currentPowerP1, currentPowerP2,
                      }),
                    })
                    if (!res.ok) throw new Error('Error generando Excel')
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `Comparativa_2TD_${item.tariff.shortName}_${clientName.replace(/\s+/g, '_')}.xlsx`
                    a.click()
                    URL.revokeObjectURL(url)
                  } catch {
                    alert('Error al generar Excel.')
                  } finally {
                    setDownloading(null)
                  }
                }}
                disabled={downloading === item.key}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition hover:opacity-80 disabled:opacity-50"
                style={{ background: '#E0E8DC', color: '#5A6E58', border: '1px solid #C8D8C4' }}>
                {downloading === item.key
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando...</>
                  : <><Download className="w-3.5 h-3.5" /> Excel</>}
              </button>
            </div>
          </div>
        )
      })}

      <p className="text-[10px] text-center pt-1" style={{ color: '#8A9A8E' }}>
        Ahorro estimado con IVA 21%. No incluye alquiler de equipos ni otros cargos fijos. Potencia de SIPS.
      </p>
    </div>
  )
}

// ─── Main Modal ──────────────────────────────────────────────────────────────

export function EconomicStudyModal({
  supplyId,
  cups,
  tariff,
  clientName,
  comercializadoraActual = '—',
  consumptionByPeriod = [],
  powersByPeriod = [],
  comercializadoras = [],
  currentAvgEnergyPrice = 0,
  currentPowerPriceP1 = 0,
  currentPowerPriceP2 = 0,
  autoSave = false,
  onClose,
  onSaved,
}: Props) {
  const is2TD = is2TDTariff(tariff)
  const periodCount = getPeriodCount(tariff)
  const periods = PERIOD_LABELS.slice(0, periodCount)

  const [nuevaComercializadora, setNuevaComercializadora] = useState('')
  const [preciosNuevos, setPreciosNuevos] = useState<string[]>(Array(periodCount).fill(''))
  const [ssaa, setSsaa] = useState('')
  const [excesos, setExcesos] = useState('')
  const [notes, setNotes] = useState('')
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const totalKwh = consumptionByPeriod.reduce((a, b) => a + b, 0)

  const handlePriceChange = (i: number, val: string) => {
    const next = [...preciosNuevos]
    next[i] = val.replace(',', '.')
    setPreciosNuevos(next)
  }

  const allPricesFilled = preciosNuevos
    .slice(0, periodCount)
    .every(p => p !== '' && !isNaN(parseFloat(p)))

  const canGenerate = !!nuevaComercializadora && allPricesFilled && !generating

  const handleGenerate = async () => {
    if (!nuevaComercializadora) { setError('Selecciona la comercializadora nueva'); return }
    if (!allPricesFilled) { setError('Rellena el precio €/kWh para todos los períodos'); return }
    setError('')
    setGenerating(true)
    try {
      let accessToken: string | null = null
      try {
        const raw = localStorage.getItem('voltis-auth')
        if (raw) accessToken = JSON.parse(raw)?.access_token ?? null
      } catch {}

      const res = await fetch(`/api/supplies/${supplyId}/economic-study`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          nueva_comercializadora: nuevaComercializadora,
          precios_nuevos: preciosNuevos.slice(0, periodCount).map(p => parseFloat(p)),
          ssaa: ssaa ? parseFloat(ssaa) : 0,
          excesos: excesos ? parseFloat(excesos) : 0,
          notes: notes.trim(),
          save: autoSave,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al generar el estudio')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="(.+)"/)
      a.download = match?.[1] || `estudio_economico_${cups}.xlsx`
      a.click()
      URL.revokeObjectURL(url)

      setDone(true)
      onSaved?.()
      if (autoSave) setTimeout(() => onClose(), 1500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  // ── 2.0TD mode: derive consumo/potencia from props ─────────────────────────
  const consumo2TD = {
    P1: consumptionByPeriod[0] || 0,
    P2: consumptionByPeriod[1] || 0,
    P3: consumptionByPeriod[2] || 0,
  }
  const potencia2TD = {
    P1: powersByPeriod[0] || 0,
    P2: powersByPeriod[1] || 0,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg rounded-2xl shadow-2xl w-full border border-line flex flex-col"
        style={{ maxWidth: is2TD ? '640px' : '512px', maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
          <div>
            <p className="text-sm font-bold text-ink flex items-center gap-2">
              {is2TD
                ? <><Sparkles className="w-4 h-4" style={{ color: '#6B8068' }} /> Comparativa automática Voltis 2.0TD</>
                : <><FileSpreadsheet className="w-4 h-4 text-brand" /> Estudio económico comparativo</>
              }
            </p>
            <p className="text-xs text-ink-3 mt-0.5">
              {clientName} · {cups} · <span className="font-semibold text-brand">{tariff}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {is2TD ? (
            /* ── 2.0TD: Comparativa automática ── */
            <Comparativa2TDView
              cups={cups}
              clientName={clientName}
              consumo={consumo2TD}
              potencia={potencia2TD}
              currentEnergyPrice={currentAvgEnergyPrice}
              currentPowerP1={currentPowerPriceP1}
              currentPowerP2={currentPowerPriceP2}
            />
          ) : done ? (
            /* ── Success state ── */
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-10">
              <div className="w-14 h-14 rounded-full bg-ok-container/40 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-ok" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-ink">Excel descargado</p>
                <p className="text-xs text-ink-3 mt-1">
                  {autoSave
                    ? 'El informe se ha guardado en el suministro y el comercial ha sido notificado.'
                    : 'Revísalo y adjúntalo al suministro cuando esté listo.'}
                </p>
              </div>
              {!autoSave && (
                <Button onClick={onClose} variant="secondary" className="text-sm">Cerrar</Button>
              )}
            </div>
          ) : (
            /* ── Standard mode (3.0TD / 6.xTD): price input form ── */
            <div className="px-6 py-5 space-y-5">
              <div className="flex items-start gap-2 p-3 bg-info-container/30 rounded-xl border border-info/20 text-xs text-ink-3">
                <Info className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
                <span>Los kW y consumos por período se toman de SIPS. Los precios de potencia ACTUAL son la media ponderada de las facturas adjuntas; los de NUEVO son BOE del año de la factura más reciente (2025 ó 2026). Solo necesitas indicar la comercializadora y el precio de energía por período.</span>
              </div>

              {/* Comercializadora */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wider">Comercializadora</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-bg-2 border border-line">
                    <p className="text-[10px] text-ink-3 uppercase font-bold mb-1">Actual</p>
                    <p className="text-sm font-semibold text-ink">{comercializadoraActual}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-bg-2 border border-line">
                    <p className="text-[10px] text-ink-3 uppercase font-bold mb-1">Nueva propuesta</p>
                    {comercializadoras.length > 0 ? (
                      <select value={nuevaComercializadora} onChange={e => setNuevaComercializadora(e.target.value)}
                        className="w-full bg-transparent text-sm font-semibold text-ink focus:outline-none">
                        <option value="">Seleccionar…</option>
                        {comercializadoras.map(c => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input type="text" placeholder="Nombre comercializadora" value={nuevaComercializadora}
                        onChange={e => setNuevaComercializadora(e.target.value)}
                        className="w-full bg-transparent text-sm font-semibold text-ink placeholder:text-ink-4 focus:outline-none" />
                    )}
                  </div>
                </div>
              </div>

              {/* Precios por período */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wider">Precio ofertado por período (€/kWh)</p>
                <div className="rounded-xl border border-line overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-bg-2 text-ink-3">
                        <th className="text-left px-3 py-2 font-semibold">Per.</th>
                        <th className="text-right px-3 py-2 font-semibold">kWh/año</th>
                        <th className="text-right px-3 py-2 font-semibold">% total</th>
                        <th className="text-right px-3 py-2 font-semibold">Precio nuevo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((label, i) => {
                        const kwh = consumptionByPeriod[i] ?? 0
                        const pct = totalKwh > 0 ? kwh / totalKwh : 0
                        return (
                          <tr key={label} className="border-t border-line">
                            <td className="px-3 py-2 font-bold text-ink-2">{label}</td>
                            <td className="px-3 py-2 text-right text-ink font-medium tabular-nums">
                              {kwh > 0 ? kwh.toLocaleString('es-ES') : <span className="text-ink-4">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {kwh > 0 ? (
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${pctColor(pct)}`}>
                                  {(pct * 100).toFixed(1)}%
                                </span>
                              ) : <span className="text-ink-4">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input type="text" inputMode="decimal" placeholder="0,0000"
                                  value={preciosNuevos[i]}
                                  onChange={e => handlePriceChange(i, e.target.value)}
                                  className="w-20 text-right text-xs font-semibold bg-ok-container/20 border border-ok/30 rounded-lg px-2 py-1.5 text-ink placeholder:text-ink-4 focus:outline-none focus:border-ok" />
                                <span className="text-ink-4 text-[10px]">€</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SSAA y Excesos */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wider">Otros conceptos (opcional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-ink-3 uppercase font-bold block mb-1">SSAA (€/año)</label>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={ssaa}
                      onChange={e => setSsaa(e.target.value.replace(',', '.'))}
                      className="w-full text-right text-sm bg-bg-2 border border-line rounded-lg px-3 py-2 text-ink placeholder:text-ink-4 focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="text-[10px] text-ink-3 uppercase font-bold block mb-1">Excesos potencia (€/año)</label>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={excesos}
                      onChange={e => setExcesos(e.target.value.replace(',', '.'))}
                      className="w-full text-right text-sm bg-bg-2 border border-line rounded-lg px-3 py-2 text-ink placeholder:text-ink-4 focus:outline-none focus:border-brand" />
                  </div>
                </div>
              </div>

              {/* Notas */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wider flex items-center gap-1.5">
                  <StickyNote className="w-3.5 h-3.5 text-warn" />
                  Notas internas (solo admins)
                </p>
                <textarea rows={3} placeholder="Ej: Galp v74, fee 12€/MWh, oferta válida hasta 30/04…" value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full text-sm bg-warn-container/10 border border-warn/20 rounded-xl px-3 py-2.5 text-ink placeholder:text-ink-4 focus:outline-none focus:border-warn resize-none" />
                <p className="text-[10px] text-ink-4">Estas notas se guardan en el suministro y son visibles solo para administradores.</p>
              </div>

              {error && (
                <p className="text-xs text-err bg-err-container/30 border border-err/20 rounded-xl px-3 py-2">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer — only for non-2TD in input mode */}
        {!is2TD && !done && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-line flex-shrink-0 bg-bg-2/50">
            <p className="text-[10px] text-ink-4">
              {autoSave
                ? 'Se descargará el Excel y se guardará automáticamente en el suministro.'
                : 'Se descargará el Excel para que lo revises antes de adjuntarlo.'}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} className="text-sm">Cancelar</Button>
              <Button onClick={handleGenerate} disabled={!canGenerate} className="flex items-center gap-2 text-sm">
                {generating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />{autoSave ? 'Generando y guardando…' : 'Generando…'}</>
                ) : (
                  <><Download className="w-4 h-4" />{autoSave ? 'Generar y guardar' : 'Descargar Excel'}</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Footer for 2TD mode — just close */}
        {is2TD && (
          <div className="flex items-center justify-end px-6 py-3 border-t border-line flex-shrink-0">
            <Button variant="secondary" onClick={onClose} className="text-sm">Cerrar</Button>
          </div>
        )}
      </div>
    </div>
  )
}
