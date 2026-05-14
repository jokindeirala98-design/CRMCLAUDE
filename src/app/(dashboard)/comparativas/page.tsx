'use client'

/**
 * /comparativas — Comparativa Gana 2.0TD.
 *
 * Flujo:
 *   1) Selector de cliente (buscador, con todos los del CRM).
 *   2) Al seleccionar cliente: lista de sus supplies eléctricos 2.0TD
 *      (oculta gas y 3.0TD). Si solo hay 1, se autoselecciona.
 *   3) Al seleccionar supply: se embebe <ComparativaGana supplyId={...}/>
 *      que usa AnnualEconomics existente (todas las facturas + SIPS).
 *   4) Botón "Subir facturas para cliente nuevo" abre el modal Bulk Upload,
 *      que pasa por el mismo pipeline que Telegram (crea cliente/supply/
 *      invoice y rellena extracted_data.economics).
 *
 * La versión manual antigua sigue accesible en /comparativas-manual.
 */

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Search, Building2, Zap, Upload, FileText, ArrowRight,
  Sparkles, Calculator, Loader2, X,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const ComparativaGana = dynamic(
  () => import('@/components/supply/ComparativaGana'),
  { ssr: false },
)
const BulkUploadModal = dynamic(
  () => import('@/components/modals/BulkUploadModal').then(m => m.BulkUploadModal),
  { ssr: false },
)

interface ClientRow {
  id: string
  name: string
  alias: string | null
  cif: string | null
  nif: string | null
  cif_nif: string | null
}

interface SupplyRow {
  id: string
  cups: string | null
  tariff: string | null
  type: string | null
  name: string | null
}

function is2tdElectric(s: SupplyRow): boolean {
  if (s.type === 'gas' || /^RL/i.test(s.tariff || '')) return false
  const t = String(s.tariff || '').toUpperCase().replace(/\s/g, '')
  return t.startsWith('2.0') || t.startsWith('20TD')
}

export default function ComparativasPage() {
  const supabase = useMemo(() => createClient(), [])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null)
  const [supplies, setSupplies] = useState<SupplyRow[]>([])
  const [loadingSupplies, setLoadingSupplies] = useState(false)
  const [selectedSupplyId, setSelectedSupplyId] = useState<string | null>(null)
  const [showBulkUpload, setShowBulkUpload] = useState(false)

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  // Buscar clientes
  useEffect(() => {
    let active = true
    const q = debouncedQuery
    if (q.length === 0) {
      setLoadingClients(true)
      supabase
        .from('clients')
        .select('id, name, alias, cif, nif, cif_nif')
        .order('updated_at', { ascending: false })
        .limit(30)
        .then(({ data }) => {
          if (!active) return
          setClients((data as any) ?? [])
          setLoadingClients(false)
        })
      return () => { active = false }
    }
    setLoadingClients(true)
    const pattern = `%${q}%`
    supabase
      .from('clients')
      .select('id, name, alias, cif, nif, cif_nif')
      .or(`name.ilike.${pattern},alias.ilike.${pattern},cif.ilike.${pattern},nif.ilike.${pattern},cif_nif.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(30)
      .then(({ data }) => {
        if (!active) return
        setClients((data as any) ?? [])
        setLoadingClients(false)
      })
    return () => { active = false }
  }, [debouncedQuery, supabase])

  // Cargar supplies del cliente
  useEffect(() => {
    if (!selectedClient) {
      setSupplies([])
      setSelectedSupplyId(null)
      return
    }
    let active = true
    setLoadingSupplies(true)
    supabase
      .from('supplies')
      .select('id, cups, tariff, type, name')
      .eq('client_id', selectedClient.id)
      .order('tariff', { ascending: true })
      .then(({ data }) => {
        if (!active) return
        const list = ((data as any) ?? []) as SupplyRow[]
        const electricos2td = list.filter(is2tdElectric)
        setSupplies(electricos2td)
        if (electricos2td.length === 1) setSelectedSupplyId(electricos2td[0].id)
        else setSelectedSupplyId(null)
        setLoadingSupplies(false)
      })
    return () => { active = false }
  }, [selectedClient, supabase])

  return (
    <div className="min-h-screen bg-bg">
      <Header title="Comparativas 2.0" subtitle="Compara con tarifas Gana usando facturas del CRM" />

      <div className="container mx-auto px-4 md:px-6 py-6 max-w-6xl space-y-6">

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span>Selecciona un cliente y un suministro 2.0TD para calcular la comparativa con Gana Energía.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowBulkUpload(true)}
              className="gap-2"
            >
              <Upload className="w-4 h-4" /> Subir facturas
            </Button>
            <Link
              href="/comparativas-manual"
              className="text-xs text-stone-500 hover:text-stone-700 underline-offset-2 hover:underline"
            >
              Modo manual ↗
            </Link>
          </div>
        </div>

        {/* Step 1: Cliente */}
        <Card className="p-5 md:p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-xs font-bold">
              1
            </div>
            <h2 className="font-semibold text-stone-900">Selecciona el cliente</h2>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por nombre, alias, CIF o NIF…"
              className="pl-9"
            />
          </div>

          {selectedClient && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
              <Building2 className="w-4 h-4" />
              {selectedClient.alias || selectedClient.name}
              <button onClick={() => setSelectedClient(null)} className="hover:text-emerald-950">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {!selectedClient && (
            <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-stone-100 border border-stone-200 rounded-lg">
              {loadingClients && (
                <div className="p-4 text-center text-stone-500 text-sm flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando…
                </div>
              )}
              {!loadingClients && clients.length === 0 && (
                <div className="p-4 text-center text-stone-500 text-sm">Sin resultados.</div>
              )}
              {clients.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedClient(c)}
                  className="w-full text-left px-4 py-2.5 hover:bg-stone-50 flex items-center justify-between transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-stone-900 truncate">{c.alias || c.name}</div>
                    {c.alias && <div className="text-xs text-stone-500 truncate">{c.name}</div>}
                    <div className="text-[11px] text-stone-400 font-mono">
                      {c.cif ?? c.cif_nif ?? c.nif ?? '—'}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-stone-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Step 2: Supply */}
        {selectedClient && (
          <Card className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-xs font-bold">
                2
              </div>
              <h2 className="font-semibold text-stone-900">Selecciona el suministro 2.0TD eléctrico</h2>
            </div>

            {loadingSupplies && (
              <div className="p-4 text-center text-stone-500 text-sm flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando suministros…
              </div>
            )}

            {!loadingSupplies && supplies.length === 0 && (
              <div className="p-5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                Este cliente no tiene suministros 2.0TD eléctricos en el CRM.{' '}
                Sube alguna factura con el botón "Subir facturas" arriba.
              </div>
            )}

            {!loadingSupplies && supplies.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {supplies.map(s => {
                  const active = s.id === selectedSupplyId
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSupplyId(s.id)}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        active
                          ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                          : 'border-stone-200 bg-white hover:border-emerald-300 hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className={`w-4 h-4 ${active ? 'text-emerald-600' : 'text-stone-400'}`} />
                        <span className="font-semibold text-stone-900 text-sm truncate">
                          {s.name || s.cups || s.id.slice(0, 8)}
                        </span>
                      </div>
                      <div className="text-xs text-stone-500 font-mono truncate">{s.cups ?? '—'}</div>
                      <div className="text-[11px] text-stone-400 mt-1">{s.tariff ?? 'sin tarifa'}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>
        )}

        {/* Step 3: Comparativa (overlay) */}
        {selectedSupplyId && (
          <ComparativaGana
            supplyId={selectedSupplyId}
            onClose={() => setSelectedSupplyId(null)}
          />
        )}

        {/* Empty state */}
        {!selectedClient && !showBulkUpload && (
          <Card className="p-6 md:p-10 border-dashed border-2 border-stone-200 text-center bg-stone-50/50">
            <FileText className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <h3 className="font-semibold text-stone-700">¿Cliente nuevo sin facturas en el CRM?</h3>
            <p className="text-sm text-stone-500 mt-1 max-w-xl mx-auto">
              Pulsa <strong>"Subir facturas"</strong> arriba a la derecha para que el CRM las analice con IA,
              cree el cliente y suministro automáticamente y genere la comparativa Gana con los datos extraídos.
            </p>
          </Card>
        )}
      </div>

      {showBulkUpload && (
        <BulkUploadModal
          open={showBulkUpload}
          onClose={() => setShowBulkUpload(false)}
          onCreated={() => {
            setShowBulkUpload(false)
            // Forzar refresco del listado de clientes / supplies
            setDebouncedQuery(q => q + '')
            if (selectedClient) {
              const c = selectedClient
              setSelectedClient(null)
              setTimeout(() => setSelectedClient(c), 50)
            }
          }}
          preselectedClientId={selectedClient?.id}
        />
      )}
    </div>
  )
}
