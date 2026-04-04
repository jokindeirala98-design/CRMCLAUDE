'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Plus, Filter } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { NewSupplyModal } from '@/components/modals/NewSupplyModal'
import { createClient } from '@/lib/supabase/client'

/** Normalize tariff strings for display — handles messy DB values */
function formatTariff(raw: string | null | undefined): string {
  if (!raw) return '-'
  const s = raw.replace(/\s+/g, '').toUpperCase()
  const tariffMap: Record<string, string> = {
    '2.0': '2.0TD', '20TD': '2.0TD', '2.0A': '2.0TD', '2.0DHA': '2.0DHA',
    '20': '2.0TD', '202020': '2.0TD', '20DHA': '2.0DHA',
    '3.0': '3.0TD', '30TD': '3.0TD', '3.0A': '3.0TD', '30': '3.0TD',
    '6.1': '6.1TD', '61TD': '6.1TD', '6.1A': '6.1TD', '61': '6.1TD',
    '6.2': '6.2TD', '62TD': '6.2TD', '62': '6.2TD',
    '6.3': '6.3TD', '63TD': '6.3TD', '63': '6.3TD',
    '6.4': '6.4TD', '64TD': '6.4TD', '64': '6.4TD',
    'RL.1': 'RL.1', 'RL1': 'RL.1',
    'RL.2': 'RL.2', 'RL2': 'RL.2',
  }
  return tariffMap[s] || raw
}

export default function SuppliesPage() {
  const [supplies, setSupplies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'recent' | 'consumption_desc' | 'consumption_asc'>('consumption_desc')
  const [consumptionMap, setConsumptionMap] = useState<Record<string, number>>({})
  const [showNewModal, setShowNewModal] = useState(false)
  const router = useRouter()

  const fetchSupplies = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    // Fetch supplies
    let query = supabase
      .from('supplies')
      .select('*, client:clients(name, cif_nif), comercializadora:comercializadoras(name)')
      .order('created_at', { ascending: false })

    if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    // Fetch supplies and invoices in parallel
    const [suppliesResult, invoicesResult] = await Promise.all([
      query,
      supabase
        .from('invoices')
        .select('supply_id, extracted_data')
        .not('extracted_data', 'is', null)
    ])

    // Calculate consumption map from invoices
    const consumptionData: Record<string, number> = {}
    if (invoicesResult.data) {
      invoicesResult.data.forEach((invoice: any) => {
        const kwh = invoice.extracted_data?.economics?.consumoTotalKwh
        if (kwh && invoice.supply_id) {
          if (!consumptionData[invoice.supply_id]) {
            consumptionData[invoice.supply_id] = 0
          }
          consumptionData[invoice.supply_id] += kwh
        }
      })
    }

    setConsumptionMap(consumptionData)
    setSupplies(suppliesResult.data || [])
    setLoading(false)
  }, [filter])

  useEffect(() => {
    fetchSupplies()
  }, [fetchSupplies])

  const statusFilters = [
    { key: 'all', label: 'Todos' },
    { key: 'primer_contacto', label: 'Primer contacto' },
    { key: 'facturas_recibidas', label: 'Facturas recibidas' },
    { key: 'prescoring_pendiente', label: 'Prescoring pte.' },
    { key: 'estudio_en_curso', label: 'En estudio' },
    { key: 'pendiente_firma', label: 'Pte. firma' },
    { key: 'firmado', label: 'Firmado' },
    { key: 'suscrito', label: 'Suscrito' },
    { key: 'seguimiento_activo', label: 'Seguimiento' },
  ]

  // Sort supplies
  const sortedSupplies = [...supplies].sort((a, b) => {
    if (sortBy === 'consumption_desc') {
      return (consumptionMap[b.id] || 0) - (consumptionMap[a.id] || 0)
    } else if (sortBy === 'consumption_asc') {
      return (consumptionMap[a.id] || 0) - (consumptionMap[b.id] || 0)
    }
    return 0
  })

  const columns = [
    {
      key: 'cups',
      header: 'CUPS',
      render: (item: any) => (
        <span className="font-mono text-xs text-on-surface">{item.cups || 'Sin CUPS'}</span>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      render: (item: any) => (
        <div>
          <p className="text-sm font-medium text-on-surface">{item.client?.name || '-'}</p>
          <p className="text-xs text-on-surface-variant">{item.client?.cif_nif}</p>
        </div>
      ),
    },
    {
      key: 'tariff',
      header: 'Tarifa',
      render: (item: any) => <Badge variant="info">{formatTariff(item.tariff)}</Badge>,
    },
    {
      key: 'type',
      header: 'Tipo',
      render: (item: any) => (
        <span className="text-sm capitalize text-on-surface-variant">{item.type}</span>
      ),
    },
    {
      key: 'comercializadora',
      header: 'Comercializadora',
      render: (item: any) => (
        <span className="text-sm text-on-surface-variant">{item.comercializadora?.name || '-'}</span>
      ),
    },
    {
      key: 'consumption',
      header: 'Consumo',
      render: (item: any) => {
        const consumption = consumptionMap[item.id]
        if (!consumption) return <span className="text-sm text-on-surface-variant">—</span>
        return (
          <span className="text-sm text-on-surface font-medium">
            {consumption.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kWh
          </span>
        )
      },
    },
    {
      key: 'status',
      header: 'Estado',
      render: (item: any) => <StatusBadge status={item.status} />,
    },
  ]

  return (
    <div>
      <Header
        title="Suministros"
        subtitle={`${supplies.length} suministros registrados`}
        actions={
          <Button onClick={() => setShowNewModal(true)}>
            <Plus className="w-4 h-4" />
            Nuevo Suministro
          </Button>
        }
      />

      <div className="px-4 lg:px-8 pb-24 lg:pb-8 space-y-4">
        {/* Status filters and sort selector */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  filter === f.key
                    ? 'gradient-primary text-white'
                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Sort selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setSortBy('recent')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                sortBy === 'recent'
                  ? 'bg-primary text-white'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              Más recientes
            </button>
            <button
              onClick={() => setSortBy('consumption_desc')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                sortBy === 'consumption_desc'
                  ? 'bg-primary text-white'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              Consumo anual ↓
            </button>
            <button
              onClick={() => setSortBy('consumption_asc')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                sortBy === 'consumption_asc'
                  ? 'bg-primary text-white'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              Consumo anual ↑
            </button>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={sortedSupplies}
          keyExtractor={(item) => item.id}
          onRowClick={(item) => router.push(`/supplies/${item.id}`)}
          loading={loading}
          emptyMessage="No hay suministros todavia"
        />
      </div>

      <NewSupplyModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={fetchSupplies}
      />
    </div>
  )
}
