'use client'

import { useEffect, useState } from 'react'
import { Plus, Download, Filter, FileText, Send, CheckCircle } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { StatCard, Card } from '@/components/ui/Card'
import { NewInvoiceModal } from '@/components/billing/NewInvoiceModal'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils/format'
import type { Billing } from '@/types/database'

export default function BillingPage() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  const fetchInvoices = async () => {
    const supabase = createClient()
    let query = supabase
      .from('billing')
      .select('*, client:clients(name, cif_nif, email)')
      .order('created_at', { ascending: false })

    if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    const { data } = await query
    setInvoices(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchInvoices()
  }, [filter])

  const handleMarkPaid = async (id: string) => {
    const supabase = createClient()
    await supabase
      .from('billing')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', id)
    fetchInvoices()
  }

  const stats = {
    total: invoices.reduce((sum, i) => sum + (i.total_amount || 0), 0),
    paid: invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + (i.total_amount || 0), 0),
    pending: invoices.filter((i) => i.status === 'sent').reduce((sum, i) => sum + (i.total_amount || 0), 0),
    overdue: invoices.filter((i) => i.status === 'overdue').reduce((sum, i) => sum + (i.total_amount || 0), 0),
  }

  const columns = [
    {
      key: 'invoice_number',
      header: 'N. Factura',
      render: (item: any) => (
        <span className="font-mono text-sm font-medium text-on-surface">{item.invoice_number}</span>
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
      key: 'concept',
      header: 'Concepto',
      render: (item: any) => (
        <span className="text-sm text-on-surface-variant">{item.concept}</span>
      ),
    },
    {
      key: 'base_amount',
      header: 'Base',
      render: (item: any) => (
        <span className="text-sm text-on-surface">{formatCurrency(item.base_amount)}</span>
      ),
    },
    {
      key: 'total_amount',
      header: 'Total',
      render: (item: any) => (
        <span className="font-display font-semibold text-on-surface">{formatCurrency(item.total_amount)}</span>
      ),
    },
    {
      key: 'due_date',
      header: 'Vencimiento',
      render: (item: any) => (
        <span className="text-sm text-on-surface-variant">{formatDate(item.due_date)}</span>
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
        <div className="flex items-center gap-1">
          {item.status === 'sent' && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMarkPaid(item.id) }}
              className="p-1.5 rounded-lg text-success hover:bg-success-container/30 transition-all"
              title="Marcar como pagada"
            >
              <CheckCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <Header
        title="Facturacion"
        subtitle="Gestion de facturas propias de Voltis Energia"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nueva Factura
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Facturado Total" value={formatCurrency(stats.total)} color="default" />
          <StatCard label="Cobrado" value={formatCurrency(stats.paid)} color="success" />
          <StatCard label="Pendiente" value={formatCurrency(stats.pending)} color="warning" />
          <StatCard label="Vencido" value={formatCurrency(stats.overdue)} color="error" />
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'Todas' },
            { key: 'draft', label: 'Borrador' },
            { key: 'sent', label: 'Enviadas' },
            { key: 'paid', label: 'Pagadas' },
            { key: 'overdue', label: 'Vencidas' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === f.key
                  ? 'gradient-primary text-white'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={invoices}
          keyExtractor={(item) => item.id}
          loading={loading}
          emptyMessage="No hay facturas todavia"
        />
      </div>

      {showModal && (
        <NewInvoiceModal
          onClose={() => setShowModal(false)}
          onCreated={fetchInvoices}
        />
      )}
    </div>
  )
}
