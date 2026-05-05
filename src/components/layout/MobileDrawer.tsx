'use client'

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  X,
  Settings,
  LogOut,
  Zap,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  CreditCard,
  Receipt,
  CalendarDays,
  DollarSign,
  BarChart3,
  LucideIcon
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { getAuthClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  permission?: string
  adminOnly?: boolean
}

// ── Drawer nav groups ─────────────────────────────────────────────────────────
const drawerGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operación',
    items: [
      { href: '/supplies',    label: 'Suministros',  icon: Zap },
      { href: '/prescorings', label: 'Prescorings',  icon: ClipboardCheck, permission: 'prescorings' },
      { href: '/informes',    label: 'Informes',     icon: FileSpreadsheet, adminOnly: true },
      { href: '/contracts',   label: 'Contratos',    icon: FileText },
      { href: '/agenda',      label: 'Agenda',       icon: CalendarDays },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { href: '/subscriptions', label: 'Suscripciones', icon: CreditCard,  permission: 'billing' },
      { href: '/billing',       label: 'Facturación',   icon: Receipt,     permission: 'billing' },
      { href: '/commissions',   label: 'Comisiones',    icon: DollarSign },
      { href: '/reports',       label: 'Estadísticas',  icon: BarChart3,   permission: 'reports' },
    ],
  },
]

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const pathname = usePathname()
  const { user, hasPermission, isAdmin } = useAuthStore()

  const filterItem = (item: NavItem) => {
    if (item.adminOnly && !isAdmin()) return false
    if (item.permission && !hasPermission(item.permission)) return false
    return true
  }

  const handleLogout = async () => {
    const supabase = getAuthClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-ink/30 backdrop-blur-sm lg:hidden"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed top-0 right-0 bottom-0 z-[70] w-[82%] max-w-xs bg-bg border-l border-line lg:hidden flex flex-col shadow-ambient-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center overflow-hidden">
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt={user?.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-volt text-sm font-bold leading-none">
                      {(user as any)?.initials || user?.full_name?.charAt(0) || 'V'}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">{user?.full_name || user?.email}</p>
                  <p className="text-[10px] text-ink-4 capitalize">{user?.role}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-bg-2 text-ink-3 active:scale-90 hover:bg-line transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Nav Groups */}
            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
              {drawerGroups.map((group) => {
                const visibleItems = group.items.filter(filterItem)
                if (visibleItems.length === 0) return null

                return (
                  <div key={group.label}>
                    <p className="label-mono text-ink-4 px-3 mb-2">{group.label}</p>
                    <div className="space-y-0.5">
                      {visibleItems.map((item) => {
                        const isActive = pathname.startsWith(item.href)
                        const Icon = item.icon
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={onClose}
                            className={cn(
                              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all active:scale-95',
                              isActive
                                ? 'bg-ink text-bg'
                                : 'text-ink-3 hover:bg-line/60 hover:text-ink'
                            )}
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="px-4 pb-6 pt-3 border-t border-line space-y-0.5">
              <Link
                href="/settings"
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  pathname.startsWith('/settings')
                    ? 'bg-ink text-bg'
                    : 'text-ink-3 hover:bg-line/60 hover:text-ink'
                )}
              >
                <Settings className="w-4 h-4" />
                <span>Configuración</span>
              </Link>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-err hover:bg-err-container/30 transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
