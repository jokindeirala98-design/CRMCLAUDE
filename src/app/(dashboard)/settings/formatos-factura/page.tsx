'use client'

import { useEffect, useState } from 'react'

interface FormatoComercializadora {
  id: string
  nombre: string
  aliases: string[]
  tarifa_habitual: string
  notas_extraccion: string | null
  confianza: number
  fuente: string
  activa: boolean
  facturas_procesadas: number
  extracciones_ok: number
  extracciones_error: number
  tasa_exito: number | null
  ultima_extraccion_ok: string | null
  ultima_extraccion_error: string | null
  actualizado_en: string
}

export default function FormatosFacturaPage() {
  const [formatos, setFormatos] = useState<FormatoComercializadora[]>([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState<string | null>(null)
  const [notasEdit, setNotasEdit] = useState('')
  const [confianzaEdit, setConfianzaEdit] = useState(70)
  const [guardando, setGuardando] = useState(false)
  const [filtro, setFiltro] = useState<'todas' | 'pendientes' | 'activas'>('todas')

  async function cargarFormatos() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/comercializadora-formats')
      const json = await res.json()
      setFormatos(json.data ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargarFormatos() }, [])

  async function guardarNotas(id: string) {
    setGuardando(true)
    try {
      await fetch('/api/admin/comercializadora-formats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notas_extraccion: notasEdit, confianza: confianzaEdit }),
      })
      setEditando(null)
      cargarFormatos()
    } finally {
      setGuardando(false)
    }
  }

  async function toggleActiva(id: string, activa: boolean) {
    await fetch('/api/admin/comercializadora-formats', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, activa: !activa }),
    })
    cargarFormatos()
  }

  function iniciarEdicion(f: FormatoComercializadora) {
    setEditando(f.id)
    setNotasEdit(f.notas_extraccion ?? '')
    setConfianzaEdit(f.confianza)
  }

  const formatosFiltrados = formatos.filter(f => {
    if (filtro === 'pendientes') return f.confianza < 50 || f.notas_extraccion?.includes('PENDIENTE')
    if (filtro === 'activas') return f.activa
    return true
  })

  function colorConfianza(c: number) {
    if (c >= 80) return 'text-green-700 bg-green-50'
    if (c >= 50) return 'text-yellow-700 bg-yellow-50'
    return 'text-red-700 bg-red-50'
  }

  function colorTasa(t: number | null) {
    if (t === null) return 'text-gray-400'
    if (t >= 80) return 'text-green-600 font-semibold'
    if (t >= 50) return 'text-yellow-600 font-semibold'
    return 'text-red-600 font-semibold'
  }

  const totalProcesadas = formatos.reduce((s, f) => s + (f.facturas_procesadas ?? 0), 0)
  const totalOk = formatos.reduce((s, f) => s + (f.extracciones_ok ?? 0), 0)
  const tasaGlobal = totalProcesadas > 0 ? Math.round((totalOk / totalProcesadas) * 100) : null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Base de Conocimiento del Extractor</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Gestiona el conocimiento de formatos de factura por comercializadora. El extractor usa estas notas
          automáticamente cuando detecta problemas en la extracción.
        </p>
      </div>

      {/* Resumen global */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Comercializadoras</div>
          <div className="text-2xl font-bold text-gray-900">{formatos.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Facturas procesadas</div>
          <div className="text-2xl font-bold text-gray-900">{totalProcesadas}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Tasa de éxito global</div>
          <div className={`text-2xl font-bold ${tasaGlobal !== null && tasaGlobal >= 80 ? 'text-green-600' : tasaGlobal !== null && tasaGlobal >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
            {tasaGlobal !== null ? `${tasaGlobal}%` : '—'}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Pendientes de análisis</div>
          <div className="text-2xl font-bold text-orange-600">
            {formatos.filter(f => f.confianza < 50).length}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4">
        {(['todas', 'pendientes', 'activas'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filtro === f
                ? 'bg-green-700 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f === 'todas' ? 'Todas' : f === 'pendientes' ? '⚠️ Pendientes' : '✓ Activas'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <div className="space-y-3">
          {formatosFiltrados.map((f) => (
            <div
              key={f.id}
              className={`bg-white rounded-lg border ${!f.activa ? 'opacity-50 border-gray-100' : 'border-gray-200'} overflow-hidden`}
            >
              {/* Cabecera */}
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="font-semibold text-gray-900">{f.nombre}</div>
                  {f.aliases?.length > 0 && (
                    <div className="text-xs text-gray-400 font-mono">
                      {f.aliases.slice(0, 3).join(' · ')}
                      {f.aliases.length > 3 && ` +${f.aliases.length - 3}`}
                    </div>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorConfianza(f.confianza)}`}>
                    {f.confianza}% confianza
                  </span>
                  <span className="text-xs text-gray-400 border border-gray-200 px-2 py-0.5 rounded-full">
                    {f.fuente}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  {/* Métricas */}
                  <div className="flex gap-3 text-sm">
                    <span className="text-gray-500">{f.facturas_procesadas ?? 0} procesadas</span>
                    {f.facturas_procesadas > 0 && (
                      <span className={colorTasa(f.tasa_exito)}>
                        {f.tasa_exito}% éxito
                      </span>
                    )}
                    {f.extracciones_error > 0 && (
                      <span className="text-red-500">{f.extracciones_error} errores</span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => iniciarEdicion(f)}
                      className="text-sm px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Editar notas
                    </button>
                    <button
                      onClick={() => toggleActiva(f.id, f.activa)}
                      className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                        f.activa
                          ? 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                          : 'border border-green-200 text-green-700 bg-green-50 hover:bg-green-100'
                      }`}
                    >
                      {f.activa ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Notas de extracción */}
              <div className="p-4">
                {editando === f.id ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 mb-2">
                      <label className="text-sm text-gray-600 font-medium">Confianza:</label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={confianzaEdit}
                        onChange={e => setConfianzaEdit(Number(e.target.value))}
                        className="w-32"
                      />
                      <span className={`text-sm font-medium ${colorConfianza(confianzaEdit).split(' ')[0]}`}>
                        {confianzaEdit}%
                      </span>
                    </div>
                    <textarea
                      value={notasEdit}
                      onChange={e => setNotasEdit(e.target.value)}
                      rows={8}
                      className="w-full text-sm font-mono border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Notas de extracción: cómo leer las potencias, formato de precios, periodos especiales, etc."
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => guardarNotas(f.id)}
                        disabled={guardando}
                        className="px-4 py-2 bg-green-700 text-white rounded-md text-sm hover:bg-green-800 disabled:opacity-50 transition-colors"
                      >
                        {guardando ? 'Guardando...' : 'Guardar'}
                      </button>
                      <button
                        onClick={() => setEditando(null)}
                        className="px-4 py-2 border border-gray-200 text-gray-600 rounded-md text-sm hover:bg-gray-50 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-600 font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                    {f.notas_extraccion
                      ? f.notas_extraccion
                      : <span className="text-gray-400 italic not-italic font-sans">Sin notas — haz clic en "Editar notas" para añadir el patrón de extracción.</span>
                    }
                  </div>
                )}
              </div>

              {/* Footer con timestamps */}
              {(f.ultima_extraccion_ok || f.ultima_extraccion_error) && (
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex gap-4 text-xs text-gray-400">
                  {f.ultima_extraccion_ok && (
                    <span>✓ Última OK: {new Date(f.ultima_extraccion_ok).toLocaleDateString('es-ES')}</span>
                  )}
                  {f.ultima_extraccion_error && (
                    <span>✗ Último error: {new Date(f.ultima_extraccion_error).toLocaleDateString('es-ES')}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
