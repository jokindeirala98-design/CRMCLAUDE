'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import {
  Bell,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  FileText,
  Loader2,
  Trash2,
  CheckCheck,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Notification, NotificationType } from '@/types/database'

const typeConfig: Record<NotificationType, { icon: React.ElementType; color: string; bg: string }> = {
  estudio_completado: { icon: FileSpreadsheet, color: 'text-ok', bg: 'bg-ok-container/40' },
  prescoring_aprobado: { icon: CheckCircle2, color: 'text-ok', bg: 'bg-ok-container/40' },
  prescoring_rechazado: { icon: XCircle, color: 'text-err', bg: 'bg-err-container/40' },
  contrato_firmado: { icon: FileText, color: 'text-info', bg: 'bg-info-container/40' },
  general: { icon: Bell, color: 'text-brand', bg: 'bg-primary/10' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days}d`
  return new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()
  const { user } = useAuthStore()

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setNotifications((data || []) as Notification[])
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const markAsRead = async (notif: Notification) => {
    if (!notif.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', notif.id)
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n))
    }
    if (notif.link) {
      router.push(notif.link)
    }
  }

  const markAllRead = async () => {
    if (!user?.id) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="min-h-screen bg-bg">
      <Header
        title="Notificaciones"
        subtitle={unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo al dia'}
        actions={
          unreadCount > 0 ? (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand bg-secondary/10 rounded-lg hover:bg-secondary/20 transition-all"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Marcar todo leido</span>
            </button>
          ) : undefined
        }
      />

      <div className="px-4 lg:px-6 pb-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-brand animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-bg-2 flex items-center justify-center mb-4">
              <Bell className="w-7 h-7 text-ink-3" />
            </div>
            <p className="text-sm text-ink-3">Sin notificaciones</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {notifications.map((notif) => {
                const config = typeConfig[notif.type as NotificationType] || typeConfig.general
                const Icon = config.icon

                return (
                  <motion.button
                    key={notif.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => markAsRead(notif)}
                    className={`w-full flex items-start gap-3 p-4 rounded-xl text-left transition-all active:scale-[0.99] ${
                      notif.read
                        ? 'bg-white hover:bg-bg-2/50'
                        : 'bg-white border-l-4 border-brand shadow-ambient-sm hover:bg-bg-2/30'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl ${config.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`w-4.5 h-4.5 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm ${notif.read ? 'text-ink' : 'text-ink font-semibold'}`}>
                          {notif.title}
                        </p>
                        <span className="text-[10px] text-ink-3 whitespace-nowrap flex-shrink-0 mt-0.5">
                          {timeAgo(notif.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-ink-3 mt-0.5 line-clamp-2">
                        {notif.message}
                      </p>
                    </div>
                    {!notif.read && (
                      <div className="w-2 h-2 rounded-full bg-brand flex-shrink-0 mt-2" />
                    )}
                  </motion.button>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
