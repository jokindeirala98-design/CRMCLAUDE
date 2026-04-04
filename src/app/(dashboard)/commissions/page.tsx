'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { formatCurrency, formatDate, getUserInitials } from '@/lib/utils/format'
import type { Commission } from '@/types/database'

type CommissionWithRelations = Commission & {
  commercial?: { full_name: string }
  client?: { name: string }
  supply?: { cups: string | null }
}

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', color: 'warning' as const },
  approved: { label: 'Aprobada', color: 'info' as const },
  paid: { label: 'Pagada', color: 'success' as const },
}

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
  const [commissions, setCommissions] = useState<CommissionWithRelations[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCommercial, setSelectedCommercial] = useState<string>('')
  const [currentDate, setCurrentDate] = useState(new Date())

  const isAdmin = user?.role === 'admin'

  // Get current month in YYYY-MM format
  const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
  const monthDisplay = MONTHS[currentDate.getMonth()]?.label || 'Mes'
  const yearDisplay = currentDate.getFullYear()

  const fetchCommissions = useCallback(async () => {
    const supabase = createClient()

    let query = supabase
      .from('commissions')
      .select(`
        *,
        commercial:users_profile!commercial_id(full_name),
        client:clients(name),
        supply:supplies(cups)
      `)
      .eq('month', currentMonth)

    // If not admin, only show own commissions
    if (!isAdmin) {
      query = query.eq('commercial_id', user?.id)
    } else if (selectedCommercial) {
      // If admin with filter, show selected commercial
      query = query.eq('commercial_id', selectedCommercial)
    }

    const { data } = await query.order('created_at', { ascending: false })
    setCommissions((data as CommissionWithRelations[]) || [])
    setLoading(false)
  }, [currentMonth, selectedCommercial, isAdmin, user?.id])

  const fetchUsers = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('users_profile')
      .select('id, full_name, role')
      .eq('active', true)
      .eq('role', 'commercial')
      .order('full_name')
    setUsers(data || [])
  }, [])

  useEffect(() => {
    fetchCommissions()
  }, [fetchCommissions])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Calculate stats
  const totalEarned = commissions.reduce((sum, c) => sum + c.amount, 0)
  const pending = commissions.filter((c) => c.status === 'pending').reduce((sum, c) => sum + c.amount, 0)
  const paid = commissions.filter((c) => c.status === 'paid').reduce((sum, c) => sum + c.amount, 0)

  const handlePreviousMonth = () => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() - 1)
    setCurrentDate(newDate)
  }

  const handleNextMonth = () => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + 1)
    setCurrentDate(newDate)
  }

  const updateCommissionStatus = async (commissionId: string, newStatus: string) => {
    const supabase = createClient()
    const updates: any = { status: newStatus }
    if (newStatus === 'approved') updates.approved_at = new Date().toISOString()
    if (newStatus === 'paid') updates.paid_at = new Date().toISOString()

    await supabase.from('commissions').update(updates).eq('id', commissionId)
    fetchCommissions()
  }

  const columns = [
    {
      key: 'client',
      header: 'Cliente',
      render: (item: CommissionWithRelations) => (
        <span className="text-sm text-on-surface">{item.client?.name || '-'}</span>
      ),
    },
    {
      key: 'supply',
      header: 'Suministro',
      render: (item: CommissionWithRelations) => (
        <span className="text-sm font-mono text-on-surface-variant">{item.supply?.cups || '-'}</span>
      ),
    },
    {
      key: 'concept',
      header: 'Concepto',
      render: (item: CommissionWithRelations) => (
        <span className="text-sm text-on-surface">{item.concept || '-'}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Importe',
      render: (item: CommissionWithRelations) => (
        <span className="text-sm font-semibold text-on-surface">{formatCurrency(item.amount)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (item: CommissionWithRelations) => {
        const config = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG]
        return (
          <div className="flex items-center gap-2">
            <Badge variant={config.color}>{config.label}</Badge>
            {isAdmin && (
              <button
                onClick={() => {
                  const nextStatus =
                    item.status === 'pending' ? 'approved' : item.status === 'approved' ? 'paid' : 'pending'
                  updateCommissionStatus(item.id, nextStatus)
                }}
                className="text-xs px-2 py-1 rounded-lg bg-surface-container-low text-primary hover:bg-primary hover:text-white transition-all"
              >
                {item.status === 'paid' ? 'Reset' : 'Avanzar'}
              </button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <Header
        title="Comisiones"
        subtitle={`Comisiones de ${monthDisplay} ${yearDisplay}`}
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* Month Navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handlePreviousMonth}
              className="p-2 rounded-xl hover:bg-surface-container-low transition-all"
              title="Mes anterior"
            >
              <ChevronLeft className="w-5 h-5 text-on-surface-variant" />
            </button>
            <span className="text-sm font-semibold text-on-surface min-w-[120px] text-center">
              {monthDisplay} {yearDisplay}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-2 rounded-xl hover:bg-surface-container-low transition-all"
              title="Mes siguiente"
            >
              <ChevronRight className="w-5 h-5 text-on-surface-variant" />
            </button>
          </div>

          {/* Filter by commercial (admin only) */}
          {isAdmin && (
            <Select
              value={selectedCommercial}
              onChange={(e) => setSelectedCommercial(e.target.value)}
            >
              <option value="">Todos los comerciales</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {getUserInitials(u.full_name)}
                </option>
              ))}
            </Select>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <p className="text-xs text-on-surface-variant font-medium">Ganado</p>
            <p className="font-display font-bold text-2xl text-primary mt-1">{formatCurrency(totalEarned)}</p>
          </Card>
          <Card>
            <p className="text-xs text-on-surface-variant font-medium">Pendiente</p>
            <p className="font-display font-bold text-2xl text-warning mt-1">{formatCurrency(pending)}</p>
          </Card>
          <Card>
            <p className="text-xs text-on-surface-variant font-medium">Pagadas</p>
            <p className="font-display font-bold text-2xl text-success mt-1">{formatCurrency(paid)}</p>
          </Card>
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={commissions}
          keyExtractor={(item) => item.id}
          loading={loading}
          emptyMessage={isAdmin ? 'No hay comisiones para este mes.' : 'No tienes comisiones para este mes.'}
        />
      </div>
    </div>
  )
}
