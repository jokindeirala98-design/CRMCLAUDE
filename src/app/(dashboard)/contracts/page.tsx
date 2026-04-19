'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Plus, Download, Trash2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/Card'
import { NewContractModal } from '@/components/modals/NewContractModal'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils/format'

export default function ContractsPage() {
  const router = useRouter()
  const [contracts, setContracts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('contracts')
      .select('*, client:clients(name, cif_nif), supply:supplies(cups, tariff), comercializadora:comercializadoras(name)')
      .order('generated_at', { ascending: false })

    setContracts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchContracts()
  }, [fetchContracts])

  const handleDeleteContract = async (id: string) => {
    setDeletingId(id)
    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('contracts')
        .delete()
        .eq('id', id)

      if (error) throw error

      setContracts(contracts.filter(c => c.id !== id))
      setConfirmDeleteId(null)
    } catch (error) {
      console.error('Error deleting contract:', error)
    } finally {
      setDeletingId(null)
    }
  }

  const stats = {
    total: contracts.length,
    draft: contracts.filter((c) => c.status === 'draft').length,
    sent: contracts.filter((c) => c.status === 'sent').length,
    signed: contracts.filter((c) => c.status === 'signed').length,
  }

  const columns = [
    {
      key: 'type',
      header: 'Tipo',
      render: (item: any) => (
        <Badge variant={item.type === 'voltis' ? 'success' : 'info'}>
          {item.type === 'voltis' ? 'Voltis' : item.comercializadora?.name || 'Comercializadora'}
        </Badge>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      render: (item: any) => (
        <div>
          <p className="text-sm font-medium text-ink">{item.client?.name || '-'}</p>
          <p className="text-xs text-ink-3">{item.client?.cif_nif}</p>
        </div>
      ),
    },
    {
      key: 'supply',
      header: 'Suministro',
      render: (item: any) => (
        <div>
          <span className="font-mono text-xs">{item.supply?.cups || '-'}</span>
          {item.supply?.tariff && (
            <Badge variant="info" className="ml-2">{item.supply.tariff}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'generated_at',
      header: 'Fecha',
      render: (item: any) => (
        <span className="text-sm text-ink-3">
          {item.generated_at ? formatDate(item.generated_at) : '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (item: any) => <StatusBadge status={item.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (item: any) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {confirmDeleteId === item.id ? (
            <div className="flex items-center gap-2 bg-surface/50 rounded px-2 py-1">
              <span className="text-xs text-ink">¿Eliminar?</span>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="text-xs px-2 py-0.5 text-ink hover:bg-bg rounded transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteContract(item.id)}
                disabled={deletingId === item.id}
                className="text-xs px-2 py-0.5 bg-err-container/400/20 text-err hover:bg-err-container/400/30 rounded transition disabled:opacity-50"
              >
                {deletingId === item.id ? '...' : 'Eliminar'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteId(item.id)}
              className="text-ink-3/50 hover:text-err transition-colors duration-200 p-1"
              title="Eliminar contrato"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <Header
        title="Contratos"
        subtitle="Contratos Voltis y de comercializadora"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nuevo Contrato
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total" value={stats.total} color="default" />
          <StatCard label="Borrador" value={stats.draft} color="default" />
          <StatCard label="Enviados" value={stats.sent} color="warning" />
          <StatCard label="Firmados" value={stats.signed} color="success" />
        </div>

        <DataTable
          columns={columns}
          data={contracts}
          keyExtractor={(item) => item.id}
          onRowClick={(item) => {
            if (item.client_id) router.push(`/clients/${item.client_id}`)
          }}
          loading={loading}
          emptyMessage="No hay contratos todavia"
        />
      </div>

      <NewContractModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={fetchContracts}
      />
    </div>
  )
}
