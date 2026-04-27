'use client'

import { useEffect, useState } from 'react'
import { Plus, FileText, Send, CheckCircle, Eye, RotateCcw, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/Card'
import { GenerateInvoiceModal } from '@/components/billing/GenerateInvoiceModal'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils/format'

export default function BillingPage() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const fetchInvoices = async () => {
    setLoading(true)
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

  useEffect(() => { fetchInvoices() }, [filter])

  const handleMarkPaid = async (id: string) => {
    const supabase = createClient()
    await supabase.from('billing').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', id)
    fetchInvoices()
  }

  const handleResend = async (id: string) => {
    setResendingId(id)
    try {
      const res = await fetch('/api/billing/generate-invoice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_id: id }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Error enviando email')
      } else {
        fetchInvoices()
      }
    } finally {
      setResendingId(null)
    }
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
      header: 'Nº Factura',
      render: (item: any) => (
        <span className="font-mono text-sm font-medium text-ink">{item.invoice_number}</span>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      render: (item: any) => (
        <div>
          <p className="text-sm font-medium text-ink">{item.client?.name || '-'}</p>
          <p className="text-xs text-ink-3">{item.client?.cif_nif || item.client?.email}</p>
        </div>
      ),
    },
    {
      key: 'concept',
      header: 'Concepto',
      render: (item: any) => (
        <span className="text-sm text-ink-3 max-w-xs truncate block">{item.concept}</span>
      ),
    },
    {
      key: 'base_amount',
      header: 'Base',
      render: (item: any) => (
        <span className="text-sm text-ink">{formatCurrency(item.base_amount)}</span>
      ),
    },
    {
      key: 'total_amount',
      header: 'Total',
      render: (item: any) => (
        <span className="font-semibold text-ink">{formatCurrency(item.total_amount)}</span>
      ),
    },
    {
      key: 'due_date',
      header: 'Vencimiento',
      render: (item: any) => (
        <span className="text-sm text-ink-3">{formatDate(item.due_date)}</span>
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
          {/* View PDF */}
          {item.file_url && (
            <a
              href={item.file_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-lg text-ink-3 hover:bg-bg-2 hover:text-brand transition"
              title="Ver PDF"
            >
              <Eye className="w-4 h-4" />
            </a>
          )}
          {/* Send / resend email */}
          {item.client?.email && item.file_url && (item.status === 'draft' || item.status === 'sent') && (
            <button
              onClick={(e) => { e.stopPropagation(); handleResend(item.id) }}
              disabled={resendingId === item.id}
              className="p-1.5 rounded-lg text-ink-3 hover:bg-info-container/30 hover:text-info transition disabled:opacity-40"
              title={item.status === 'draft' ? 'Enviar por email' : 'Reenviar por email'}
            >
              {resendingId === item.id
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />}
            </button>
          )}
          {/* Mark paid */}
          {item.status === 'sent' && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMarkPaid(item.id) }}
              className="p-1.5 rounded-lg text-ok hover:bg-ok-container/30 transition"
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
        title="Facturación"
        subtitle="Facturas emitidas por Voltis Energía a clientes"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nueva Factura
          </Button>
        }
      />

      <div className="px-4 lg:px-8 pb-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Facturado Total" value={formatCurrency(stats.total)} color="default" />
          <StatCard label="Cobrado" value={formatCurrency(stats.paid)} color="success" />
          <StatCard label="Pendiente cobro" value={formatCurrency(stats.pending)} color="warning" />
          <StatCard label="Vencido" value={formatCurrency(stats.overdue)} color="error" />
        </div>

        {/* Filters */}
        <div className="flex gap-2 overflow-x-auto pb-1">
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
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                filter === f.key
                  ? 'bg-brand text-white'
                  : 'bg-bg-2 text-ink-3 hover:bg-bg-2'
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
          emptyMessage="No hay facturas todavía"
        />
      </div>

      {showModal && (
        <GenerateInvoiceModal
          onClose={() => setShowModal(false)}
          onCreated={fetchInvoices}
        />
      )}
    </div>
  )
}
