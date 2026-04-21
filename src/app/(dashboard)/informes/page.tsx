'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import {
  FileSpreadsheet,
  Download,
  Upload,
  Eye,
  Loader2,
  Building2,
  Zap,
  FileText,
  CheckCircle2,
  Search,
  ChevronRight,
  ArrowLeft,
  BarChart2,
  X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getViewUrl, getDownloadUrl } from '@/lib/utils/storage'
import { advanceSupplyPipeline } from '@/lib/supply-pipeline'
import { EconomicStudyModal } from '@/components/modals/EconomicStudyModal'
import { getPeriodCount } from '@/lib/boe-prices'

/* ---------- types ---------- */
interface PendingSupply {
  id: string
  cups: string | null
  tariff: string
  type: string
  status: string
  address: string | null
  created_at: string
  client_id: string | null
  client: {
    id: string
    name: string
    cif_nif: string | null
    email: string | null
    phone: string | null
    type: string
  } | null
  comercializadora: { name: string } | null
  invoices: {
    id: string
    file_url: string
    file_type: string
    extracted_data: Record<string, unknown> | null
    total_amount: number | null
  }[]
  consumption_data: Record<string, unknown> | null
  studies: {
    id: string
    report_url: string | null
    status: string
    type: string
  }[]
}

interface ClientGroup {
  clientId: string
  clientName: string
  clientCif: string | null
  clientEmail: string | null
  clientPhone: string | null
  clientType: string
  supplies: PendingSupply[]
  totalConsumption: number
}

/* ---------- helpers ---------- */
function getSupplyConsumption(s: PendingSupply): number {
  // Try consumption_data.totalKwh first (from SIPS)
  const cd = s.consumption_data as any
  if (cd?.totalKwh && Number(cd.totalKwh) > 0) return Number(cd.totalKwh)
  if (cd?.total && Number(cd.total) > 0) return Number(cd.total)
  // Fall back to summing invoices
  let sum = 0
  for (const inv of s.invoices) {
    const ed = inv.extracted_data as any
    const kwh = ed?.economics?.consumoTotalKwh
    if (kwh) sum += Number(kwh)
  }
  return sum
}

function fmtKwh(val: number): string {
  if (val <= 0) return 'Sin datos'
  return `${val.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kWh/año`
}

function extractConsumptionByPeriod(cd: Record<string, unknown> | null, periodCount: number): number[] {
  if (!cd) return Array(periodCount).fill(0)
  const d = cd as any
  if (Array.isArray(d.consumoPorPeriodo)) return d.consumoPorPeriodo.slice(0, periodCount).map(Number)
  const cons: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    cons.push(Number(d[`consumoP${i}`] ?? d[`energiaP${i}`] ?? 0))
  }
  if (cons.some(c => c > 0)) return cons
  const total = Number(d.totalKwh ?? d.total ?? 0)
  return Array(periodCount).fill(Math.round(total / periodCount))
}

function extractPowersByPeriod(cd: Record<string, unknown> | null, periodCount: number): number[] {
  if (!cd) return Array(periodCount).fill(0)
  const d = cd as any
  if (Array.isArray(d.potenciasContratadas)) return d.potenciasContratadas.slice(0, periodCount).map(Number)
  const powers: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    powers.push(Number(d[`potenciaP${i}`] ?? d[`p${i}`] ?? d[`P${i}`] ?? 0))
  }
  if (powers.some(p => p > 0)) return powers
  const single = Number(d.potenciaContratada ?? d.potencia ?? 0)
  return Array(periodCount).fill(single)
}

function formatTariff(raw: string | null | undefined): string {
  if (!raw) return '-'
  const s = raw.replace(/\s+/g, '').toUpperCase()
  const map: Record<string, string> = {
    '2.0': '2.0TD', '20TD': '2.0TD', '2.0A': '2.0TD', '20': '2.0TD', '202020': '2.0TD',
    '3.0': '3.0TD', '30TD': '3.0TD', '3.0A': '3.0TD', '30': '3.0TD',
    '6.1': '6.1TD', '61TD': '6.1TD', '6.1A': '6.1TD', '61': '6.1TD',
    '6.2': '6.2TD', '62TD': '6.2TD', '62': '6.2TD',
    '6.3': '6.3TD', '63TD': '6.3TD', '63': '6.3TD',
    '6.4': '6.4TD', '64TD': '6.4TD', '64': '6.4TD',
  }
  return map[s] || raw
}

/* ========== component ========== */
export default function InformesPage() {
  const [supplies, setSupplies] = useState<PendingSupply[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<ClientGroup | null>(null)
  const [economicStudySupply, setEconomicStudySupply] = useState<PendingSupply | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeSupplyRef = useRef<string | null>(null)

  const router = useRouter()
  const supabase = createClient()
  const { user } = useAuthStore()

  /* --- fetch --- */
  const fetchPending = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, status, address, created_at, consumption_data, client_id,
        client:clients(id, name, cif_nif, email, phone, type),
        comercializadora:comercializadoras(name),
        invoices:invoices(id, file_url, file_type, extracted_data, total_amount),
        studies:studies(id, report_url, status, type)
      `)
      .eq('status', 'estudio_en_curso')

    if (!error && data) {
      setSupplies(data as unknown as PendingSupply[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPending() }, [fetchPending])

  /* --- group by client & sort by total consumption --- */
  const clientGroups: ClientGroup[] = (() => {
    const map = new Map<string, ClientGroup>()
    for (const s of supplies) {
      const cid = s.client?.id || s.client_id || 'unknown'
      if (!map.has(cid)) {
        map.set(cid, {
          clientId: cid,
          clientName: s.client?.name || 'Sin cliente',
          clientCif: s.client?.cif_nif || null,
          clientEmail: s.client?.email || null,
          clientPhone: s.client?.phone || null,
          clientType: s.client?.type || '',
          supplies: [],
          totalConsumption: 0,
        })
      }
      const g = map.get(cid)!
      g.supplies.push(s)
      g.totalConsumption += getSupplyConsumption(s)
    }
    return Array.from(map.values()).sort((a, b) => b.totalConsumption - a.totalConsumption)
  })()

  /* --- filter --- */
  const filtered = clientGroups.filter((g) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      g.clientName.toLowerCase().includes(q) ||
      (g.clientCif || '').toLowerCase().includes(q) ||
      g.supplies.some(s => (s.cups || '').toLowerCase().includes(q))
    )
  })

  /* --- upload report --- */
  const handleUploadReport = (supplyId: string) => {
    activeSupplyRef.current = supplyId
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const supplyId = activeSupplyRef.current
    if (!file || !supplyId) return

    setUploading(supplyId)
    try {
      const filePath = `reports/${supplyId}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file)
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath)
      const reportUrl = urlData.publicUrl

      await supabase.from('studies').insert({
        supply_id: supplyId,
        type: 'economico',
        report_url: reportUrl,
        status: 'completed',
        created_by: user?.id || '',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })

      await advanceSupplyPipeline({
        supabase,
        supplyId,
        event: 'report_uploaded',
        userId: user?.id,
      })

      // Notify the commercial
      const supply = supplies.find(s => s.id === supplyId)
      if (supply?.client?.id) {
        const { data: clientData } = await supabase
          .from('clients')
          .select('commercial_id, name')
          .eq('id', supply.client.id)
          .single()

        if (clientData?.commercial_id) {
          // Use notify API for in-app + Telegram push
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: clientData.commercial_id,
              type: 'estudio_completado',
              title: 'Informe listo',
              message: `El informe economico de ${clientData.name} (${supply.cups || 'sin CUPS'}) ya esta disponible.`,
              link: `/supplies/${supplyId}`,
              metadata: {
                report_url: reportUrl,
                client_name: clientData.name,
                cups: supply.cups,
                supply_id: supplyId,
              },
            }),
          })
        }
      }

      // Remove supply from local state
      setSupplies(prev => prev.filter(s => s.id !== supplyId))
      // If the selected client has no more supplies after removal, go back
      if (selectedClient) {
        const remaining = selectedClient.supplies.filter(s => s.id !== supplyId)
        if (remaining.length === 0) {
          setSelectedClient(null)
        } else {
          setSelectedClient({
            ...selectedClient,
            supplies: remaining,
            totalConsumption: remaining.reduce((acc, s) => acc + getSupplyConsumption(s), 0),
          })
        }
      }
    } catch (err: any) {
      console.error('Error uploading report:', err)
      alert(`Error subiendo informe: ${err.message}`)
    } finally {
      setUploading(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /* ---------- RENDER ---------- */

  // Client detail view
  if (selectedClient) {
    return (
      <div className="min-h-screen bg-bg">
        <Header
          title={selectedClient.clientName}
          subtitle={`${selectedClient.supplies.length} suministro${selectedClient.supplies.length !== 1 ? 's' : ''} pendiente${selectedClient.supplies.length !== 1 ? 's' : ''} · ${fmtKwh(selectedClient.totalConsumption)}`}
          actions={
            <button
              onClick={() => setSelectedClient(null)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink-3 hover:text-ink bg-bg-2 hover:bg-bg-2 rounded-xl transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver
            </button>
          }
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.doc,.docx"
          onChange={handleFileSelected}
          className="hidden"
        />

        <div className="px-4 lg:px-6 pb-8 space-y-4">
          {/* Client info card */}
          <div className="p-4 bg-card rounded-2xl border border-line-2-variant/10 shadow-ambient-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-brand" />
              </div>
              <div className="text-sm space-y-0.5">
                <p className="font-semibold text-ink">{selectedClient.clientName}</p>
                {selectedClient.clientCif && <p className="text-ink-3 text-xs">{selectedClient.clientCif}</p>}
                {selectedClient.clientEmail && <p className="text-ink-3 text-xs">{selectedClient.clientEmail}</p>}
                {selectedClient.clientPhone && <p className="text-ink-3 text-xs">{selectedClient.clientPhone}</p>}
              </div>
            </div>
          </div>

          {/* Supply cards */}
          {selectedClient.supplies.map((supply) => {
            const isUploading = uploading === supply.id
            const consumption = getSupplyConsumption(supply)

            return (
              <div
                key={supply.id}
                className="bg-card rounded-2xl border border-line-2-variant/10 shadow-ambient-sm overflow-hidden"
              >
                {/* Supply header */}
                <div className="p-4 border-b border-line-2-variant/10">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-warn-container/40 flex items-center justify-center flex-shrink-0">
                      <Zap className="w-4 h-4 text-warn" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-medium text-ink truncate">
                        {supply.cups || 'Sin CUPS'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-brand rounded font-medium">
                          {formatTariff(supply.tariff)}
                        </span>
                        <span className="text-xs text-ink-3 capitalize">{supply.type}</span>
                        {consumption > 0 && (
                          <span className="text-xs text-ink-3">· {fmtKwh(consumption)}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/supplies/${supply.id}#sips-data`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-ok-container/40 text-ok border border-ok/30 rounded-lg hover:bg-ok-container transition-colors"
                      title="Ver tabla de consumos y maxímetros"
                    >
                      <BarChart2 className="w-3.5 h-3.5" />
                      CONS&amp;POTS
                    </button>
                  </div>
                  {supply.comercializadora && (
                    <p className="text-xs text-ink-3 mt-2 ml-12">
                      Comercializadora: <span className="font-medium text-ink">{supply.comercializadora.name}</span>
                    </p>
                  )}
                  {supply.address && (
                    <p className="text-xs text-ink-3 mt-1 ml-12 truncate">{supply.address}</p>
                  )}
                </div>

                {/* Invoices */}
                <div className="p-4 space-y-2">
                  <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">
                    Facturas ({supply.invoices.length})
                  </p>
                  {supply.invoices.length === 0 && (
                    <p className="text-xs text-ink-3 italic">Sin facturas adjuntas</p>
                  )}
                  {supply.invoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center gap-2 p-2.5 bg-bg-2/50 rounded-xl"
                    >
                      <FileText className="w-4 h-4 text-err flex-shrink-0" />
                      <span className="text-xs text-ink flex-1 truncate">
                        Factura {inv.file_type?.toUpperCase()}
                        {inv.total_amount != null && ` · ${inv.total_amount.toFixed(2)} €`}
                      </span>
                      <div className="flex items-center gap-1">
                        <a
                          href={getViewUrl(inv.file_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
                          title="Ver factura"
                        >
                          <Eye className="w-3.5 h-3.5 text-ink-3 hover:text-brand" />
                        </a>
                        <a
                          href={getDownloadUrl(inv.file_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
                          title="Descargar factura"
                        >
                          <Download className="w-3.5 h-3.5 text-ink-3 hover:text-brand" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Generar informe económico */}
                <div className="px-4 pb-4 space-y-2">
                  <button
                    onClick={() => setEconomicStudySupply(supply)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand text-white rounded-xl font-semibold text-sm hover:bg-secondary/90 transition-all active:scale-[0.98]"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Generar Informe Económico
                  </button>
                  {/* Mantener subida manual como fallback */}
                  <button
                    onClick={() => handleUploadReport(supply.id)}
                    disabled={isUploading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-bg-2 text-ink-3 rounded-xl text-xs font-medium hover:bg-bg-2/80 transition-all disabled:opacity-50 border border-line"
                  >
                    {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {isUploading ? 'Subiendo...' : 'Subir archivo existente'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Economic Study Modal */}
        {economicStudySupply && (
          <EconomicStudyModal
            supplyId={economicStudySupply.id}
            cups={economicStudySupply.cups || ''}
            tariff={economicStudySupply.tariff || '3.0TD'}
            clientName={selectedClient.clientName}
            comercializadoraActual={economicStudySupply.comercializadora?.name}
            consumptionByPeriod={extractConsumptionByPeriod(
              economicStudySupply.consumption_data,
              getPeriodCount(economicStudySupply.tariff || '3.0TD')
            )}
            powersByPeriod={extractPowersByPeriod(
              economicStudySupply.consumption_data,
              getPeriodCount(economicStudySupply.tariff || '3.0TD')
            )}
            autoSave={true}
            onClose={() => setEconomicStudySupply(null)}
            onSaved={() => {
              const supplyId = economicStudySupply.id
              setSupplies(prev => prev.filter(s => s.id !== supplyId))
              setEconomicStudySupply(null)
              const remaining = selectedClient.supplies.filter(s => s.id !== supplyId)
              if (remaining.length === 0) {
                setSelectedClient(null)
              } else {
                setSelectedClient({
                  ...selectedClient,
                  supplies: remaining,
                  totalConsumption: remaining.reduce((acc, s) => acc + getSupplyConsumption(s), 0),
                })
              }
            }}
          />
        )}
      </div>
    )
  }

  /* --- Main list view (grouped by client, sorted by consumption) --- */
  return (
    <div className="min-h-screen bg-bg">
      <Header
        title="Informes Pendientes"
        subtitle={`${supplies.length} suministro${supplies.length !== 1 ? 's' : ''} de ${clientGroups.length} cliente${clientGroups.length !== 1 ? 's' : ''}`}
      />

      <div className="px-4 lg:px-6 pb-8 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por cliente, CIF o CUPS..."
            className="w-full pl-10 pr-4 py-3 text-sm bg-card border border-line-2-variant/20 rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-ink placeholder:text-ink-3/50"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.doc,.docx"
          onChange={handleFileSelected}
          className="hidden"
        />

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand animate-spin" />
            <p className="text-sm text-ink-3 mt-3">Cargando informes pendientes...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-ok-container/40 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-ok" />
            </div>
            <p className="text-lg font-sans font-semibold text-ink">Todo al dia</p>
            <p className="text-sm text-ink-3 mt-1">No hay informes economicos pendientes</p>
          </div>
        )}

        {/* Client rows */}
        {!loading && (
          <div className="bg-card rounded-2xl overflow-hidden shadow-ambient-sm border border-line-2-variant/10">
            <AnimatePresence>
              {filtered.map((group, idx) => (
                <motion.button
                  key={group.clientId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -80 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => setSelectedClient(group)}
                  className={`w-full flex items-center gap-4 p-4 text-left hover:bg-bg-2/40 transition-colors ${
                    idx !== filtered.length - 1 ? 'border-b border-line-2-variant/10' : ''
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-warn-container/40 flex items-center justify-center flex-shrink-0">
                    <FileSpreadsheet className="w-5 h-5 text-warn" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {group.clientName}
                    </p>
                    <p className="text-xs text-ink-3 mt-0.5">
                      {group.supplies.length} suministro{group.supplies.length !== 1 ? 's' : ''}
                      {group.clientCif && ` · ${group.clientCif}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-ink">
                      {group.totalConsumption > 0
                        ? group.totalConsumption.toLocaleString('es-ES', { maximumFractionDigits: 0 })
                        : '—'}
                    </p>
                    {group.totalConsumption > 0 && (
                      <p className="text-[10px] text-ink-3">kWh/año</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-ink-3 flex-shrink-0" />
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
