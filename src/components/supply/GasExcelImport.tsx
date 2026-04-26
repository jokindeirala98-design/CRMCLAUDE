'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, CheckCircle2, AlertCircle, Loader2, X, Flame, RefreshCw } from 'lucide-react'

interface GasParsedRow {
  cups: string
  nombre: string
  address: string
  tariff: string
  distribuidora: string
  consumo_total: number
  consumo_p1: number; consumo_p2: number; consumo_p3: number
  consumo_p4: number; consumo_p5: number; consumo_p6: number
  provincia: string; municipio: string; codigo_postal: string
  caudal: number; presion: string; cnae: string; fecha_lectura: string
}

interface Props {
  supplyId: string
  cups?: string | null
  existingData?: Record<string, any> | null
  onImported: (newConsumptionData: Record<string, any>) => void
}

function fmtKwh(n: number) {
  if (!n) return '—'
  return `${Math.round(n).toLocaleString('es-ES')} kWh`
}

export function GasExcelImport({ supplyId, cups, existingData, onImported }: Props) {
  const [dragging, setDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [parsed, setParsed] = useState<GasParsedRow | null>(null)
  const [rowsInFile, setRowsInFile] = useState(0)
  const [filesProcessed, setFilesProcessed] = useState(0)
  const [matchedByCups, setMatchedByCups] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const getToken = () => {
    try {
      const r = localStorage.getItem('voltis-auth')
      return r ? JSON.parse(r)?.access_token ?? null : null
    } catch { return null }
  }

  const handleFiles = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return
    setFiles(newFiles)
    setParsed(null)
    setError('')
    setSaved(false)
    setSaving(true)

    const formData = new FormData()
    for (const f of newFiles) formData.append('file', f)
    if (cups) formData.append('targetCups', cups)

    const token = getToken()
    try {
      const res = await fetch(`/api/supplies/${supplyId}/import-gas-excel`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || 'Error al procesar el archivo')
        setSaving(false)
        return
      }
      setParsed(data.parsed)
      setRowsInFile(data.rows_in_file ?? 1)
      setFilesProcessed(data.files_processed ?? newFiles.length)
      setMatchedByCups(data.matched_by_cups ?? false)
      setSaved(true)
      onImported(data.consumption_data)
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    } finally {
      setSaving(false)
    }
  }, [supplyId, cups, onImported])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files).filter(
      f => /\.(xlsx|xls|zip)$/i.test(f.name)
    )
    if (dropped.length > 0) handleFiles(dropped)
  }, [handleFiles])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length > 0) handleFiles(selected)
    e.target.value = ''
  }

  const reset = () => {
    setSaved(false); setFiles([]); setParsed(null); setError('')
  }

  const hasExisting = !!existingData?.fetched_at || !!existingData?.totalKwh
  const existingKwh = existingData?.totalKwh || 0
  const existingDate = existingData?.fetched_at
    ? new Date(existingData.fetched_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="space-y-4">

      {/* Datos ya importados */}
      {hasExisting && !saved && (
        <div className="flex items-start gap-3 rounded-xl border px-4 py-3"
          style={{ background: '#E0E8DC', borderColor: '#C8D8C4' }}>
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#6B8068' }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold" style={{ color: '#3D5C45' }}>Datos importados</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              {existingKwh > 0 && (
                <span className="text-xs" style={{ color: '#5A6E58' }}>
                  <span className="font-semibold">{fmtKwh(existingKwh)}</span> / año
                </span>
              )}
              {existingData?.sips_tariff && (
                <span className="text-xs" style={{ color: '#5A6E58' }}>
                  Tarifa: <span className="font-semibold">{existingData.sips_tariff}</span>
                </span>
              )}
              {existingData?.distribuidora && (
                <span className="text-xs" style={{ color: '#5A6E58' }}>{existingData.distribuidora}</span>
              )}
              {existingDate && (
                <span className="text-xs ml-auto" style={{ color: '#8A9A8E' }}>
                  Actualizado: {existingDate}
                  {existingData?.import_filename && <> · {existingData.import_filename}</>}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Subir Excel de gas"
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none"
        style={{
          minHeight: 120,
          borderColor: dragging ? '#6B8068' : saving ? '#C8D8C4' : '#D9D0BA',
          background: dragging ? '#E0E8DC' : saving ? '#F4EEE2' : '#FBF7EE',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.zip"
          multiple
          className="hidden"
          onChange={onInputChange}
        />

        {saving ? (
          <>
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#6B8068' }} />
            <p className="text-sm font-semibold" style={{ color: '#5A6E58' }}>
              Procesando {files.length > 1 ? `${files.length} archivos` : 'Excel'}…
            </p>
          </>
        ) : saved && parsed ? (
          <>
            <CheckCircle2 className="w-7 h-7" style={{ color: '#6B8068' }} />
            <div className="text-center px-4">
              <p className="text-sm font-bold" style={{ color: '#3D5C45' }}>¡Datos importados!</p>
              <p className="text-xs mt-0.5" style={{ color: '#8A9A8E' }}>
                {filesProcessed} archivo{filesProcessed !== 1 ? 's' : ''} · {rowsInFile} fila{rowsInFile !== 1 ? 's' : ''}
                {matchedByCups ? ' · coincidencia por CUPS' : ''}
              </p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); reset() }}
              className="absolute top-2 right-2 p-1 rounded-full hover:bg-black/5 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" style={{ color: '#8A9A8E' }} />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: '#E0E8DC' }}>
              <Upload className="w-5 h-5" style={{ color: '#6B8068' }} />
            </div>
            <div className="text-center px-4">
              <p className="text-sm font-semibold" style={{ color: '#2D3A33' }}>
                {hasExisting ? 'Actualizar datos con nuevo Excel' : 'Importar Excel de consumos gas'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#8A9A8E' }}>
                Arrastra aquí o haz clic · .xlsx / .xls / .zip · varios archivos a la vez
              </p>
              <p className="text-[11px] mt-1" style={{ color: '#A8B5A0' }}>
                Formatos soportados: ZIP comercializadora, Naturgy (_39/_40), Endesa Gas
              </p>
            </div>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3"
          style={{ background: '#FDECEA', border: '1px solid #F5C6C0' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-err" />
          <div>
            <p className="text-xs font-bold text-err">Error al importar</p>
            <p className="text-xs text-err mt-0.5">{error}</p>
          </div>
          <button onClick={() => setError('')} className="ml-auto">
            <X className="w-3.5 h-3.5 text-err" />
          </button>
        </div>
      )}

      {/* Preview */}
      {parsed && saved && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#E5DCC9' }}>
          <div className="px-4 py-2 flex items-center gap-2"
            style={{ background: '#E0E8DC', borderBottom: '1px solid #D9D0BA' }}>
            <Flame className="w-3.5 h-3.5" style={{ color: '#6B8068' }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#4A5E47' }}>
              Datos importados
            </span>
            <span className="text-xs ml-auto font-mono truncate max-w-[200px]" style={{ color: '#8A9A8E' }}>
              {files.map(f => f.name).join(', ')}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-line">
            {[
              { label: 'Consumo anual', value: fmtKwh(parsed.consumo_total) },
              { label: 'Tarifa', value: parsed.tariff || '—' },
              { label: 'Distribuidora', value: parsed.distribuidora || '—' },
              { label: 'CUPS', value: parsed.cups || '—', mono: true },
              { label: 'Dirección', value: parsed.address || '—' },
              { label: 'Municipio', value: [parsed.municipio, parsed.provincia].filter(Boolean).join(', ') || '—' },
            ].map(({ label, value, mono }) => (
              <div key={label} className="px-3 py-2.5 bg-bg">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
                <p className={`text-xs font-bold text-ink mt-0.5 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px]" style={{ color: '#A8B5A0' }}>
        Los datos importados reemplazan los anteriores y se usan para el estudio económico y el informe de suministros.
      </p>
    </div>
  )
}
