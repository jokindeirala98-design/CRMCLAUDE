'use client'

import { useEffect, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { NewAppointmentModal } from '@/components/modals/NewAppointmentModal'
import { createClient } from '@/lib/supabase/client'

const DAYS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

const TYPE_COLORS: Record<string, string> = {
  presentation: 'bg-primary/10 text-primary',
  followup: 'bg-success-container text-success',
  signing: 'bg-warning-container text-warning',
  other: 'bg-surface-container-high text-on-surface-variant',
}

const TYPE_LABELS: Record<string, string> = {
  presentation: 'Presentacion',
  followup: 'Seguimiento',
  signing: 'Firma',
  other: 'Otro',
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [appointments, setAppointments] = useState<any[]>([])
  const [showModal, setShowModal] = useState(false)
  const [selectedDay, setSelectedDay] = useState<any>(null)
  const [modalDate, setModalDate] = useState<string>('')

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const fetchAppointments = useCallback(async () => {
    const supabase = createClient()
    const start = new Date(year, month, 1).toISOString()
    const end = new Date(year, month + 1, 0).toISOString()

    const { data } = await supabase
      .from('appointments')
      .select('*, client:clients(name)')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at')

    setAppointments(data || [])
  }, [year, month])

  useEffect(() => {
    fetchAppointments()
  }, [fetchAppointments])

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const offset = firstDay === 0 ? 6 : firstDay - 1

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))

  const getAppointmentsForDay = (day: number) => {
    return appointments.filter((a) => {
      const d = new Date(a.scheduled_at)
      return d.getDate() === day
    })
  }

  const today = new Date()
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day

  const handleDayClick = (day: number) => {
    setSelectedDay(selectedDay === day ? null : day)
  }

  const handleDayDoubleClick = (day: number) => {
    const dateStr = new Date(year, month, day).toISOString().split('T')[0]
    setModalDate(dateStr)
    setShowModal(true)
  }

  // Upcoming appointments (next 7 days)
  const upcoming = appointments
    .filter((a) => {
      const d = new Date(a.scheduled_at)
      const now = new Date()
      const weekLater = new Date()
      weekLater.setDate(weekLater.getDate() + 7)
      return d >= now && d <= weekLater && a.status === 'scheduled'
    })
    .slice(0, 5)

  return (
    <div>
      <Header
        title="Calendario"
        subtitle="Citas, presentaciones y seguimientos"
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nueva Cita
          </Button>
        }
      />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Calendar */}
          <div className="lg:col-span-3">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-display font-bold text-xl text-on-surface">
                    {MONTHS[month]} {year}
                  </h2>
                  <p className="text-xs text-on-surface-variant mt-1">Doble click para crear cita</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
                    <ChevronLeft className="w-5 h-5 text-on-surface-variant" />
                  </button>
                  <button
                    onClick={() => setCurrentDate(new Date())}
                    className="px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5 rounded-xl transition-all"
                  >
                    Hoy
                  </button>
                  <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
                    <ChevronRight className="w-5 h-5 text-on-surface-variant" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAYS.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-on-surface-variant py-2">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: offset }).map((_, i) => (
                  <div key={`empty-${i}`} className="min-h-[80px]" />
                ))}

                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1
                  const dayAppointments = getAppointmentsForDay(day)
                  const isSelected = selectedDay === day
                  const hasAppointments = dayAppointments.length > 0

                  return (
                    <div
                      key={day}
                      onClick={() => handleDayClick(day)}
                      onDoubleClick={() => handleDayDoubleClick(day)}
                      className={`min-h-[80px] rounded-xl p-2 transition-all cursor-pointer ${
                        isToday(day)
                          ? 'bg-primary/5 ring-1 ring-primary/30'
                          : isSelected
                          ? 'bg-secondary/5 ring-1 ring-secondary/30'
                          : 'hover:bg-surface-container-low'
                      }`}
                    >
                      <span className={`text-sm font-medium ${
                        isToday(day) ? 'text-primary font-bold' : 'text-on-surface'
                      }`}>
                        {day}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {dayAppointments.slice(0, 2).map((a) => (
                          <div
                            key={a.id}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium truncate ${TYPE_COLORS[a.type] || TYPE_COLORS.other}`}
                          >
                            {a.client?.name || TYPE_LABELS[a.type] || 'Cita'}
                          </div>
                        ))}
                        {dayAppointments.length > 2 && (
                          <span className="text-[10px] text-on-surface-variant">
                            +{dayAppointments.length - 2} mas
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>

          {/* Sidebar: upcoming + selected day */}
          <div className="space-y-4">
            {/* Selected day detail */}
            {selectedDay && (
              <Card>
                <h3 className="text-sm font-semibold text-on-surface mb-3">
                  {selectedDay} {MONTHS[month]}
                </h3>
                {getAppointmentsForDay(selectedDay).length === 0 ? (
                  <p className="text-xs text-on-surface-variant">Sin citas este dia</p>
                ) : (
                  <div className="space-y-2">
                    {getAppointmentsForDay(selectedDay).map((a) => (
                      <div key={a.id} className="p-2.5 bg-surface-container-low rounded-xl">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={a.type === 'signing' ? 'warning' : 'info'}>
                            {TYPE_LABELS[a.type] || a.type}
                          </Badge>
                          <Badge variant={a.status === 'completed' ? 'success' : 'default'}>
                            {a.status === 'scheduled' ? 'Pendiente' : a.status === 'completed' ? 'Realizada' : a.status}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium text-on-surface">{a.client?.name}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-on-surface-variant">
                          <Clock className="w-3 h-3" />
                          {new Date(a.scheduled_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                          {a.location && (
                            <>
                              <span className="mx-1">·</span>
                              <MapPin className="w-3 h-3" />
                              {a.location}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Upcoming */}
            <Card>
              <h3 className="text-sm font-semibold text-on-surface mb-3">Proximas citas</h3>
              {upcoming.length === 0 ? (
                <p className="text-xs text-on-surface-variant">Sin citas proximas</p>
              ) : (
                <div className="space-y-2">
                  {upcoming.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-container-low transition-all">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        a.type === 'signing' ? 'bg-warning' : a.type === 'presentation' ? 'bg-primary' : 'bg-success'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-on-surface truncate">{a.client?.name}</p>
                        <p className="text-[10px] text-on-surface-variant">
                          {new Date(a.scheduled_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                          {' '}
                          {new Date(a.scheduled_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      <NewAppointmentModal
        open={showModal}
        onClose={() => {
          setShowModal(false)
          setModalDate('')
        }}
        onCreated={fetchAppointments}
        preselectedDate={modalDate}
      />
    </div>
  )
}
