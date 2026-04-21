'use client'

import { useState, useEffect } from 'react'
import { X, Download, Loader2, FileSpreadsheet, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getPeriodCount } from '@/lib/boe-prices'

interface Props {
  supplyId: string
  cups: string
  tariff: string
  clientName: string
  comercializadoraActual?: string
  /** kWh por período extraídos de SIPS */
  consumptionByPeriod?: number[]
  /** kW por período extraídos de SIPS */
  powersByPeriod?: number[]
  /** Comercializadoras disponibles en el CRM */
  comercializadoras?: { id: string; name: string }[]
  onClose: () => void
}

const PERIOD_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

function pctColor(pct: number) {
  if (pct < 0.20) return 'text-ok bg-ok-container/30'
  if (pct < 0.39) return 'text-warn bg-warn-container/30'
  return 'text-err bg-err-container/30'
}

export function EconomicStudyModal({
  supplyId,
  cups,
  tariff,
  clientName,
  comercializadoraActual = '—',
  consumptionByPeriod = [],
  powersByPeriod = [],
  comercializadoras = [],
  onClose,
}: Props) {
  const periodCount = getPeriodCount(tariff)
  const periods = PERIOD_LABELS.slice(0, periodCount)

  const [nuevaComercializadora, setNuevaComercializadora] = useState('')
  const [preciosNuevos, setPreciosNuevos] = useState<string[]>(
    Array(periodCount).fill('')
  )
  const [ssaa, setSsaa] = useState('')
  const [excesos, setExcesos] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const totalKwh = consumptionByPeriod.reduce((a, b) => a + b, 0)

  const handlePriceChange = (i: number, val: string) => {
    const next = [...preciosNuevos]
    next[i] = val.replace(',', '.')
    setPreciosNuevos(next)
  }

  const allPricesFilled = preciosNuevos.every(p => p !== '' && !isNaN(parseFloat(p)))

  const handleGenerate = async () => {
    if (!nuevaComercializadora) { setError('Selecciona la comercializadora nueva'); return }
    if (!allPricesFilled) { setError('Rellena el precio €/kWh para todos los períodos'); return }
    setError('')
    setGenerating(true)
    try {
      const res = await fetch(`/api/supplies/${supplyId}/economic-study`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nueva_comercializadora: nuevaComercializadora,
          precios_nuevos: preciosNuevos.map(p => parseFloat(p)),
          ssaa: ssaa ? parseFloat(ssaa) : 0,
          excesos: excesos ? parseFloat(excesos) : 0,
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
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg rounded-2xl shadow-2xl w-full max-w-lg border border-line flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
          <div>
            <p className="text-sm font-bold text-ink flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-brand" />
              Estudio económico comparativo
            </p>
            <p className="text-xs text-ink-3 mt-0.5">{clientName} · {cups} · <span className="font-semibold text-brand">{tariff}</span></p>
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Info */}
          <div className="flex items-start gap-2 p-3 bg-info-container/30 rounded-xl border border-info/20 text-xs text-ink-3">
            <Info className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
            <span>Los datos del cliente, CUPS, tarifa, kW y consumos por período se rellenan automáticamente. Solo tienes que indicar la comercializadora nueva y el precio ofertado por período.</span>
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
                  <select
                    value={nuevaComercializadora}
                    onChange={e => setNuevaComercializadora(e.target.value)}
                    className="w-full bg-transparent text-sm font-semibold text-ink focus:outline-none"
                  >
                    <option value="">Seleccionar…</option>
                    {comercializadoras.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Nombre comercializadora"
                    value={nuevaComercializadora}
                    onChange={e => setNuevaComercializadora(e.target.value)}
                    className="w-full bg-transparent text-sm font-semibold text-ink placeholder:text-ink-4 focus:outline-none"
                  />
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
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0,0000"
                              value={preciosNuevos[i]}
                              onChange={e => handlePriceChange(i, e.target.value)}
                              className="w-20 text-right text-xs font-semibold bg-ok-container/20 border border-ok/30 rounded-lg px-2 py-1.5 text-ink placeholder:text-ink-4 focus:outline-none focus:border-ok"
                            />
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
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={ssaa}
                  onChange={e => setSsaa(e.target.value.replace(',', '.'))}
                  className="w-full text-right text-sm bg-bg-2 border border-line rounded-lg px-3 py-2 text-ink placeholder:text-ink-4 focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-[10px] text-ink-3 uppercase font-bold block mb-1">Excesos potencia (€/año)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={excesos}
                  onChange={e => setExcesos(e.target.value.replace(',', '.'))}
                  className="w-full text-right text-sm bg-bg-2 border border-line rounded-lg px-3 py-2 text-ink placeholder:text-ink-4 focus:outline-none focus:border-brand"
                />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-err bg-err-container/30 border border-err/20 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-line flex-shrink-0 bg-bg-2/50">
          <p className="text-[10px] text-ink-4">El Excel generado es editable y contiene la plantilla completa de Voltis.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} className="text-sm">
              Cancelar
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generating || !nuevaComercializadora || !allPricesFilled}
              className="flex items-center gap-2 text-sm"
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generando…</>
              ) : (
                <><Download className="w-4 h-4" /> Descargar Excel</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
