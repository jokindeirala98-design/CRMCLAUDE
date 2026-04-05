'use client'

import { useState, useRef } from 'react'
import { Upload, FileSpreadsheet, AlertTriangle, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { normalizeCUPS, normalizeTariff } from '@/lib/consumption-utils'
import type { ConsumptionSnapshot } from '@/types/database'

interface Props {
  open: boolean
  onClose: () => void
  clientId: string
  existingRows: ConsumptionSnapshot[]
  onImported: () => void
}

interface ParsedRow {
  cups: string
  tariff: string | null
  supply_type: 'luz' | 'gas' | null
  comercializadora: string | null
  address: string | null
  potencia_p1: number | null; potencia_p2: number | null; potencia_p3: number | null
  potencia_p4: number | null; potencia_p5: number | null; potencia_p6: number | null
  consumo_p1: number | null; consumo_p2: number | null; consumo_p3: number | null
  consumo_p4: number | null; consumo_p5: number | null; consumo_p6: number | null
  consumo_total: number | null
  matchedExisting: boolean
  existingId?: string
}

export default function ImportConsumptionModal({ open, onClose, clientId, existingRows, onImported }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload')
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const parseExcel = async (file: File) => {
    setError(null)
    try {
      // Dynamic import xlsx
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[]

      if (jsonData.length === 0) {
        setError('El archivo Excel esta vacio')
        return
      }

      // Map columns - flexible matching
      const rows: ParsedRow[] = jsonData.map(raw => {
        const keys = Object.keys(raw)
        const find = (patterns: string[]) => {
          const key = keys.find(k => patterns.some(p => k.toLowerCase().includes(p)))
          return key ? raw[key] : null
        }
        const num = (v: any) => v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null

        const rawCups = find(['cups', 'punto_suministro', 'punto de suministro', 'codigo'])
        const cups = normalizeCUPS(String(rawCups || ''))

        // Check if this CUPS already exists
        const existing = existingRows.find(r => r.cups === cups)

        return {
          cups: cups || String(rawCups || ''),
          tariff: normalizeTariff(find(['tarifa', 'tariff', 'tipo_tarifa'])),
          supply_type: find(['tipo', 'type', 'energia', 'tipo_suministro'])?.toString().toLowerCase().includes('gas') ? 'gas' as const : 'luz' as const,
          comercializadora: find(['comercializadora', 'comercializador', 'empresa', 'compania']),
          address: find(['direccion', 'address', 'domicilio', 'dir']),
          potencia_p1: num(find(['potencia_p1', 'pot_p1', 'p1_kw'])),
          potencia_p2: num(find(['potencia_p2', 'pot_p2', 'p2_kw'])),
          potencia_p3: num(find(['potencia_p3', 'pot_p3', 'p3_kw'])),
          potencia_p4: num(find(['potencia_p4', 'pot_p4', 'p4_kw'])),
          potencia_p5: num(find(['potencia_p5', 'pot_p5', 'p5_kw'])),
          potencia_p6: num(find(['potencia_p6', 'pot_p6', 'p6_kw'])),
          consumo_p1: num(find(['consumo_p1', 'cons_p1', 'c_p1', 'p1_kwh', 'p1'])),
          consumo_p2: num(find(['consumo_p2', 'cons_p2', 'c_p2', 'p2_kwh', 'p2'])),
          consumo_p3: num(find(['consumo_p3', 'cons_p3', 'c_p3', 'p3_kwh', 'p3'])),
          consumo_p4: num(find(['consumo_p4', 'cons_p4', 'c_p4', 'p4_kwh', 'p4'])),
          consumo_p5: num(find(['consumo_p5', 'cons_p5', 'c_p5', 'p5_kwh', 'p5'])),
          consumo_p6: num(find(['consumo_p6', 'cons_p6', 'c_p6', 'p6_kwh', 'p6'])),
          consumo_total: num(find(['consumo_total', 'total_kwh', 'total', 'consumo_anual'])),
          matchedExisting: !!existing,
          existingId: existing?.id,
        }
      }).filter(r => r.cups)

      if (rows.length === 0) {
        setError('No se encontraron filas con CUPS valido en el Excel')
        return
      }

      setParsedRows(rows)
      setStep('preview')
    } catch (err: any) {
      setError(`Error al leer el archivo: ${err.message}`)
    }
  }

  const handleImport = async () => {
    setStep('importing')
    setProgress(0)
    const supabase = createClient()

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i]
      const total = (row.consumo_p1 || 0) + (row.consumo_p2 || 0) + (row.consumo_p3 || 0) +
        (row.consumo_p4 || 0) + (row.consumo_p5 || 0) + (row.consumo_p6 || 0)

      const data = {
        client_id: clientId,
        cups: row.cups,
        tariff: row.tariff,
        supply_type: row.supply_type,
        comercializadora: row.comercializadora,
        address: row.address,
        potencia_p1: row.potencia_p1, potencia_p2: row.potencia_p2, potencia_p3: row.potencia_p3,
        potencia_p4: row.potencia_p4, potencia_p5: row.potencia_p5, potencia_p6: row.potencia_p6,
        consumo_p1: row.consumo_p1, consumo_p2: row.consumo_p2, consumo_p3: row.consumo_p3,
        consumo_p4: row.consumo_p4, consumo_p5: row.consumo_p5, consumo_p6: row.consumo_p6,
        consumo_total: total > 0 ? total : row.consumo_total,
        source: 'excel_import' as const,
        validation_status: 'OK' as const,
        updated_at: new Date().toISOString(),
      }

      if (row.matchedExisting && row.existingId) {
        await supabase.from('consumption_snapshots').update(data).eq('id', row.existingId)
      } else {
        // Need a supply_id — try to match by CUPS in supplies table
        const { data: supply } = await supabase
          .from('supplies')
          .select('id')
          .eq('client_id', clientId)
          .eq('cups', row.cups)
          .limit(1)
          .single()

        await supabase.from('consumption_snapshots').insert({
          ...data,
          supply_id: supply?.id || clientId, // fallback
        })
      }

      setProgress(Math.round(((i + 1) / parsedRows.length) * 100))
    }

    onImported()
    onClose()
    setStep('upload')
    setParsedRows([])
  }

  const matchedCount = parsedRows.filter(r => r.matchedExisting).length
  const newCount = parsedRows.length - matchedCount

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/15">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <h2 className="font-display font-semibold text-on-surface">Importar consumos desde Excel</h2>
          </div>
          <button onClick={() => { onClose(); setStep('upload'); setParsedRows([]); setError(null) }} className="p-1 hover:bg-surface-container-high rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-outline-variant/30 rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) parseExcel(f) }}
              >
                <Upload className="w-8 h-8 text-on-surface-variant/40 mx-auto mb-3" />
                <p className="text-sm font-medium text-on-surface">Arrastra un archivo Excel o haz clic para seleccionar</p>
                <p className="text-xs text-on-surface-variant mt-1">Formatos: .xlsx, .xls, .csv</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) parseExcel(f) }}
              />

              {error && (
                <div className="flex items-center gap-2 px-4 py-3 bg-red-50 rounded-lg text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="bg-surface-container-low rounded-lg px-4 py-3">
                <p className="text-xs font-semibold text-on-surface-variant mb-2">Columnas esperadas:</p>
                <p className="text-xs text-on-surface-variant">
                  CUPS (obligatorio), Tarifa, Tipo, Comercializadora, Direccion,
                  Potencia P1-P6, Consumo P1-P6, Consumo Total
                </p>
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Los nombres de columna son flexibles (ej: "cups", "CUPS", "punto_suministro" todos funcionan)
                </p>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-xs font-medium text-emerald-700">{parsedRows.length} suministros detectados</span>
                </div>
                {matchedCount > 0 && (
                  <span className="text-xs text-on-surface-variant">
                    {matchedCount} existentes (se actualizaran) · {newCount} nuevos
                  </span>
                )}
              </div>

              <div className="overflow-x-auto max-h-60 rounded-lg border border-outline-variant/15">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold">CUPS</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Tarifa</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Tipo</th>
                      <th className="px-2 py-1.5 text-right font-semibold">C.P1</th>
                      <th className="px-2 py-1.5 text-right font-semibold">C.P2</th>
                      <th className="px-2 py-1.5 text-right font-semibold">C.P3</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                      <th className="px-2 py-1.5 text-center font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, i) => {
                      const total = (row.consumo_p1 || 0) + (row.consumo_p2 || 0) + (row.consumo_p3 || 0) +
                        (row.consumo_p4 || 0) + (row.consumo_p5 || 0) + (row.consumo_p6 || 0)
                      return (
                        <tr key={i} className="border-t border-outline-variant/10">
                          <td className="px-2 py-1.5 font-mono">{row.cups.slice(0, 20)}</td>
                          <td className="px-2 py-1.5">{row.tariff || '-'}</td>
                          <td className="px-2 py-1.5 capitalize">{row.supply_type || '-'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{row.consumo_p1?.toLocaleString('es-ES') || '-'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{row.consumo_p2?.toLocaleString('es-ES') || '-'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{row.consumo_p3?.toLocaleString('es-ES') || '-'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                            {(total || row.consumo_total || 0).toLocaleString('es-ES')}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              row.matchedExisting ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                            }`}>
                              {row.matchedExisting ? 'Actualizar' : 'Nuevo'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="py-8 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm font-medium text-on-surface">Importando suministros...</p>
              <div className="w-64 mx-auto mt-4 bg-surface-container-low rounded-full h-2 overflow-hidden">
                <div className="h-full bg-primary transition-all rounded-full" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-on-surface-variant mt-2">{progress}%</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'preview' && (
          <div className="px-6 py-4 border-t border-outline-variant/15 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setStep('upload'); setParsedRows([]) }}>Volver</Button>
            <Button onClick={handleImport}>
              Importar {parsedRows.length} suministros
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
