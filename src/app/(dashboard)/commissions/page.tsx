'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download, FileSpreadsheet, Users, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'

const MONTHS = [
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
]

export default function CommissionsPage() {
  const { user } = useAuthStore()
  const [commercials, setCommercials] = useState<{ id: string; full_name: string }[]>([])
  const [selectedComercial, setSelectedComercial] = useState('all')
  const [month, setMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
  const [year, setYear] = useState(() => String(new Date().getFullYear()))
  const [downloading, setDownloading] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const [profileRes, comRes] = await Promise.all([
        supabase.from('users_profile').select('role').eq('id', user?.id).single(),
        supabase.from('users_profile').select('id, full_name').eq('active', true).order('full_name'),
      ])
      setIsAdmin(profileRes.data?.role === 'admin')
      setCommercials(comRes.data || [])
    }
    if (user?.id) load()
  }, [user?.id])

  const downloadLiquidacion = async (comercial: string, all = false) => {
    setError('')
    if (all) setDownloadingAll(true)
    else setDownloading(true)

    try {
      const params = new URLSearchParams({
        comercial: all ? 'all' : comercial,
        month,
        year,
      })
      const res = await fetch(`/api/liquidaciones/generate?${params}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al generar liquidación')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url

      // Build filename from Content-Disposition or fallback
      const cd = res.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="(.+)"/)
      const monthLabel = MONTHS.find(m => m.value === month)?.label.toLowerCase() || month
      a.download = match?.[1] || (all
        ? `liquidaciones_${monthLabel}_${year}.zip`
        : `liquidacion_${comercial.toLowerCase()}_${monthLabel}.xlsx`)

      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDownloading(false)
      setDownloadingAll(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col min-h-screen bg-bg">
        <Header title="Liquidaciones" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 text-warn mx-auto mb-3" />
            <p className="text-ink-2">Sólo los administradores pueden acceder a esta sección.</p>
          </div>
        </div>
      </div>
    )
  }

  const monthLabel = MONTHS.find(m => m.value === month)?.label || ''
  const years = Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() - i))
  const selectedName = commercials.find(c => c.id === selectedComercial)?.full_name || selectedComercial

  return (
    <div className="flex flex-col min-h-screen bg-bg">
      <Header title="Liquidaciones" subtitle="Genera y descarga liquidaciones de comerciales" />

      <div className="flex-1 px-6 py-8 max-w-3xl mx-auto w-full space-y-6">

        {/* ── Selector de período ── */}
        <Card className="p-6">
          <p className="text-sm font-semibold text-ink mb-4">Período</p>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Mes"
              value={month}
              onChange={e => setMonth(e.target.value)}
            >
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Select
              label="Año"
              value={year}
              onChange={e => setYear(e.target.value)}
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
        </Card>

        {/* ── Descarga individual ── */}
        <Card className="p-6">
          <p className="text-sm font-semibold text-ink mb-4">Liquidación individual</p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Select
                label="Comercial"
                value={selectedComercial}
                onChange={e => setSelectedComercial(e.target.value)}
              >
                <option value="">Seleccionar comercial</option>
                {commercials.map(c => (
                  <option key={c.id} value={c.full_name}>{c.full_name}</option>
                ))}
              </Select>
            </div>
            <Button
              onClick={() => downloadLiquidacion(selectedComercial)}
              disabled={downloading || !selectedComercial}
              className="flex items-center gap-2 h-[42px]"
            >
              {downloading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</>
              ) : (
                <><Download className="w-4 h-4" /> Descargar</>
              )}
            </Button>
          </div>

          {selectedComercial && (
            <div className="mt-4 p-3 bg-bg-2 rounded-xl flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-ok shrink-0" />
              <div>
                <p className="text-sm font-semibold text-ink">
                  liquidacion_{selectedComercial.toLowerCase()}_{monthLabel.toLowerCase()}.xlsx
                </p>
                <p className="text-xs text-ink-3">
                  Contratos cerrados en {monthLabel} {year} · Comisiones para rellenar manualmente
                </p>
              </div>
            </div>
          )}
        </Card>

        {/* ── Descarga todos ── */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">Todas las liquidaciones</p>
              <p className="text-xs text-ink-3 mt-0.5">
                Descarga un ZIP con la liquidación de cada comercial para {monthLabel} {year}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => downloadLiquidacion('all', true)}
              disabled={downloadingAll}
              className="flex items-center gap-2"
            >
              {downloadingAll ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</>
              ) : (
                <><Users className="w-4 h-4" /> Descargar todas</>
              )}
            </Button>
          </div>
        </Card>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-err-container rounded-xl border border-err/20">
            <AlertTriangle className="w-5 h-5 text-err shrink-0" />
            <p className="text-sm text-err">{error}</p>
          </div>
        )}

        {/* Info box */}
        <div className="p-4 bg-info-container/40 rounded-xl border border-info/20 text-xs text-ink-3 space-y-1">
          <p className="font-medium text-ink-2">Sobre las liquidaciones</p>
          <p>• Los datos se leen directamente de <strong>VOLTIS CONTRATACIONES</strong> en Google Drive.</p>
          <p>• Si el período tiene clientes con estado <strong>CAÍDO</strong>, aparecerán marcados en rojo con aviso de decomisión para Administración.</p>
          <p>• Las comisiones quedan en blanco para rellenar manualmente hasta que se implemente el sistema de rappels.</p>
          <p>• La descarga incluye los contratos desde el día 1 hasta hoy (o hasta el último día del mes si ya ha pasado).</p>
        </div>
      </div>
    </div>
  )
}
