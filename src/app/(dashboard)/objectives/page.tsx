'use client'

import { useEffect, useState, useCallback } from 'react'
import { Target, Plus, TrendingUp } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { NewObjectiveModal } from '@/components/modals/NewObjectiveModal'
import { createClient } from '@/lib/supabase/client'
import { formatDate, getUserInitials } from '@/lib/utils/format'

export default function ObjectivesPage() {
  const [objectives, setObjectives] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const fetchObjectives = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('objectives')
      .select('*, assigned_to_user:users_profile!assigned_to(full_name)')
      .order('period_end', { ascending: true })

    setObjectives(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchObjectives()
  }, [fetchObjectives])

  // Summary stats
  const totalObjectives = objectives.length
  const completed = objectives.filter((o) => o.current_count >= o.target_count).length
  const inProgress = totalObjectives - completed

  return (
    <div>
      <Header
        title="Objetivos"
        subtitle="Metas de equipo e individuales"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nuevo Objetivo
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* Stats */}
        {totalObjectives > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <Card className="text-center">
              <p className="text-xs text-on-surface-variant font-medium">Total</p>
              <p className="font-display font-bold text-2xl text-on-surface">{totalObjectives}</p>
            </Card>
            <Card className="text-center">
              <p className="text-xs text-on-surface-variant font-medium">En progreso</p>
              <p className="font-display font-bold text-2xl text-primary">{inProgress}</p>
            </Card>
            <Card className="text-center">
              <p className="text-xs text-success font-medium">Completados</p>
              <p className="font-display font-bold text-2xl text-success">{completed}</p>
            </Card>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-6 h-6 border-2 border-secondary border-t-transparent rounded-full" />
          </div>
        ) : objectives.length === 0 ? (
          <Card className="text-center py-12">
            <Target className="w-12 h-12 text-on-surface-variant/30 mx-auto mb-3" />
            <p className="text-on-surface-variant">No hay objetivos definidos</p>
            <p className="text-sm text-on-surface-variant/60 mt-1">
              Crea objetivos para que el equipo vea cuanto falta para llegar a la meta.
            </p>
            <Button className="mt-4" onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4" />
              Crear primer objetivo
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {objectives.map((obj) => {
              const progress = obj.target_count > 0
                ? Math.min((obj.current_count / obj.target_count) * 100, 100)
                : 0
              const remaining = Math.max(obj.target_count - obj.current_count, 0)
              const isCompleted = remaining === 0

              // Check if deadline is approaching
              const daysLeft = Math.ceil(
                (new Date(obj.period_end).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
              )

              return (
                <Card key={obj.id} className={isCompleted ? 'ring-1 ring-success/20' : ''}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-display font-semibold text-on-surface">{obj.title}</h3>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {formatDate(obj.period_start)} - {formatDate(obj.period_end)}
                        {daysLeft > 0 && daysLeft <= 14 && !isCompleted && (
                          <span className="text-warning ml-2 font-medium">({daysLeft} dias restantes)</span>
                        )}
                        {daysLeft <= 0 && !isCompleted && (
                          <span className="text-error ml-2 font-medium">(Vencido)</span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge variant={obj.scope === 'team' ? 'info' : 'default'}>
                        {obj.scope === 'team' ? 'Equipo' : getUserInitials(obj.assigned_to_user?.full_name) || 'Individual'}
                      </Badge>
                      {isCompleted && <Badge variant="success">Cumplido</Badge>}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-surface-container-high rounded-full h-3 mb-2 overflow-hidden">
                    <div
                      className="h-3 rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: `${progress}%`,
                        background: isCompleted
                          ? '#006d43'
                          : progress > 60
                          ? 'linear-gradient(135deg, #005c3a, #008b57)'
                          : 'linear-gradient(135deg, #001e40, #003366)',
                      }}
                    />
                  </div>

                  <div className="flex items-baseline justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-xl text-on-surface">
                        {obj.current_count}
                      </span>
                      <span className="text-sm text-on-surface-variant">
                        / {obj.target_count}
                      </span>
                      <span className="text-xs text-on-surface-variant capitalize">
                        {obj.target_type}
                      </span>
                    </div>
                    {remaining > 0 ? (
                      <span className="text-xs text-on-surface-variant">
                        Faltan <strong className="text-primary">{remaining}</strong>
                      </span>
                    ) : (
                      <div className="flex items-center gap-1 text-success">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span className="text-xs font-semibold">Objetivo cumplido</span>
                      </div>
                    )}
                  </div>

                  {obj.tariff_filter && (
                    <div className="mt-2">
                      <Badge variant="default">Tarifa: {obj.tariff_filter}</Badge>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <NewObjectiveModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={fetchObjectives}
      />
    </div>
  )
}
