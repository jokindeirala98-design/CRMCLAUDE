'use client'

import { useState } from 'react'
import { X, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { normalizeCUPS, normalizeTariff, getPowerPeriodsForTariff, getPeriodsForTariff } from '@/lib/consumption-utils'

interface Props {
  open: boolean
  onClose: () => void
  clientId: string
  supplies: Array<{ id: string; cups: string | null; type: string; tariff: string }>
  onCreated: () => void
}

export default function QuickEntryModal({ open, onClose, clientId, supplies, onCreated }: Props) {
  const [selectedSupplyId, setSelectedSupplyId] = useState<string>('')
  const [cups, setCups] = useState('')
  const [tariff, setTariff] = useState('')
  const [supplyType, setSupplyType] = useState<'luz' | 'gas'>('luz')
  const [comercializadora, setComercializadora] = useState('')
  const [address, setAddress] = useState('')
  const [potencias, setPotencias] = useState<(number | null)[]>([null, null, null, null, null, null])
  const [consumos, setConsumos] = useState<(number | null)[]>([null, null, null, null, null, null])
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')

  if (!open) return null

  const effectiveTariff = tariff || (selectedSupplyId ? supplies.find(s => s.id === selectedSupplyId)?.tariff : '') || ''
  const powerPeriods = getPowerPeriodsForTariff(effectiveTariff)
  const consumPeriods = getPeriodsForTariff(effectiveTariff)

  const handleSelectSupply = (supplyId: string) => {
    setSelectedSupplyId(supplyId)
    const supply = supplies.find(s => s.id === supplyId)
    if (supply) {
      setCups(supply.cups || '')
      setTariff(supply.tariff || '')
      setSupplyType(supply.type as 'luz' | 'gas')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    const supabase = createClient()

    const total = consumos.reduce<number>((s, v) => s + (v || 0), 0)

    const data: Record<string, any> = {
      client_id: clientId,
      supply_id: selectedSupplyId || clientId,
      cups: normalizeCUPS(cups) || cups,
      tariff: normalizeTariff(tariff) || tariff,
      supply_type: supplyType,
      comercializadora: comercializadora || null,
      address: address || null,
      potencia_p1: potencias[0], potencia_p2: potencias[1], potencia_p3: potencias[2],
      potencia_p4: potencias[3], potencia_p5: potencias[4], potencia_p6: potencias[5],
      consumo_p1: consumos[0], consumo_p2: consumos[1], consumo_p3: consumos[2],
      consumo_p4: consumos[3], consumo_p5: consumos[4], consumo_p6: consumos[5],
      consumo_total: total > 0 ? total : null,
      source: 'manual',
      validation_status: 'OK',
    }

    await supabase.from('consumption_snapshots').insert(data)

    setSaving(false)
    onCreated()
    onClose()
    // Reset
    setCups(''); setTariff(''); setComercializadora(''); setAddress('')
    setPotencias([null, null, null, null, null, null])
    setConsumos([null, null, null, null, null, null])
    setSelectedSupplyId('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-2-variant/15">
          <h2 className="font-sans font-semibold text-ink flex items-center gap-2">
            <Plus className="w-4 h-4" /> Entrada rapida de consumo
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-2 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Mode selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('existing')}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                mode === 'existing' ? 'border-brand bg-primary/5 text-brand' : 'border-line-2-variant/20 text-ink-3'
              }`}
            >
              Suministro existente
            </button>
            <button
              onClick={() => setMode('new')}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                mode === 'new' ? 'border-brand bg-primary/5 text-brand' : 'border-line-2-variant/20 text-ink-3'
              }`}
            >
              Nuevo suministro
            </button>
          </div>

          {mode === 'existing' && supplies.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-ink-3 block mb-1">Seleccionar suministro</label>
              <select
                value={selectedSupplyId}
                onChange={e => handleSelectSupply(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-bg-2 rounded-lg border border-line-2-variant/20"
              >
                <option value="">Selecciona...</option>
                {supplies.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.cups || 'Sin CUPS'} — {s.tariff} ({s.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Basic fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-3 block mb-1">CUPS</label>
              <input
                type="text"
                value={cups}
                onChange={e => setCups(e.target.value)}
                placeholder="ES0021..."
                className="w-full text-sm px-3 py-2 bg-bg-2 rounded-lg border border-line-2-variant/20 outline-none focus:border-brand font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-3 block mb-1">Tarifa</label>
              <select
                value={tariff}
                onChange={e => setTariff(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-bg-2 rounded-lg border border-line-2-variant/20"
              >
                <option value="">Selecciona</option>
                <option value="2.0TD">2.0TD</option>
                <option value="3.0TD">3.0TD</option>
                <option value="6.1TD">6.1TD</option>
                <option value="RL1">RL1</option>
                <option value="RL2">RL2</option>
                <option value="RL3">RL3</option>
                <option value="RL4">RL4</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-3 block mb-1">Tipo</label>
              <select
                value={supplyType}
                onChange={e => setSupplyType(e.target.value as 'luz' | 'gas')}
                className="w-full text-sm px-3 py-2 bg-bg-2 rounded-lg border border-line-2-variant/20"
              >
                <option value="luz">Electricidad</option>
                <option value="gas">Gas</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-3 block mb-1">Comercializadora</label>
              <input
                type="text"
                value={comercializadora}
                onChange={e => setComercializadora(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-bg-2 rounded-lg border border-line-2-variant/20 outline-none focus:border-brand"
              />
            </div>
          </div>

          {/* Potencias */}
          {powerPeriods > 0 && (
            <div>
              <label className="text-xs font-semibold text-ink-3 block mb-2">Potencias contratadas (kW)</label>
              <div className="grid grid-cols-6 gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={`pot-${i}`} className={i >= powerPeriods ? 'opacity-30 pointer-events-none' : ''}>
                    <label className="text-[10px] text-ink-3 block mb-0.5">P{i + 1}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={potencias[i] ?? ''}
                      onChange={e => {
                        const v = [...potencias]
                        v[i] = e.target.value ? Number(e.target.value) : null
                        setPotencias(v)
                      }}
                      className="w-full text-xs px-2 py-1.5 bg-bg-2 rounded border border-line-2-variant/20 outline-none focus:border-brand tabular-nums"
                      disabled={i >= powerPeriods}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Consumos */}
          <div>
            <label className="text-xs font-semibold text-ink-3 block mb-2">Consumos (kWh)</label>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={`cons-${i}`} className={i >= consumPeriods ? 'opacity-30 pointer-events-none' : ''}>
                  <label className="text-[10px] text-ink-3 block mb-0.5">P{i + 1}</label>
                  <input
                    type="number"
                    step="1"
                    value={consumos[i] ?? ''}
                    onChange={e => {
                      const v = [...consumos]
                      v[i] = e.target.value ? Number(e.target.value) : null
                      setConsumos(v)
                    }}
                    className="w-full text-xs px-2 py-1.5 bg-bg-2 rounded border border-line-2-variant/20 outline-none focus:border-brand tabular-nums"
                    disabled={i >= consumPeriods}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-line-2-variant/15 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} disabled={!cups}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Guardar
          </Button>
        </div>
      </div>
    </div>
  )
}
