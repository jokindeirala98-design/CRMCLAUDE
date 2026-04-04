'use client'

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  X, 
  Settings, 
  LogOut, 
  User,
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

const navItems: NavItem[] = [
  { href: '/supplies', label: 'Suministros', icon: Zap },
  { href: '/prescorings', label: 'Prescorings', icon: ClipboardCheck, permission: 'prescorings' },
  { href: '/informes', label: 'Informes', icon: FileSpreadsheet, adminOnly: true },
  { href: '/contracts', label: 'Contratos', icon: FileText },
  { href: '/subscriptions', label: 'Suscripciones', icon: CreditCard, permission: 'billing' },
  { href: '/billing', label: 'Facturacion', icon: Receipt, permission: 'billing' },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/commissions', label: 'Comisiones', icon: DollarSign },
  { href: '/reports', label: 'Estadisticas', icon: BarChart3, permission: 'reports' },
]

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const pathname = usePathname()
  const { user, hasPermission, isAdmin } = useAuthStore()

  const filteredItems = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin()) return false
    if (item.permission && !hasPermission(item.permission)) return false
    return true
  })

  const handleLogout = async () => {
    const supabase = getAuthClient()
    await supabase.auth.signOut()
    localStorage.removeItem('voltis-auth')
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
            className="fixed inset-0 z-[60] bg-on-surface/40 backdrop-blur-sm lg:hidden"
          />

          {/* Drawer Content */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 z-[70] w-[85%] max-w-sm bg-surface shadow-2xl lg:hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-outline-variant/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center">
                  <span className="text-white text-sm font-bold">
                    {user?.full_name?.charAt(0) || 'U'}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface">{user?.full_name}</p>
                  <p className="text-[11px] text-on-surface-variant capitalize">{user?.role}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 rounded-xl bg-surface-container-high/50 text-on-surface active:scale-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav List */}
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-2">
              <p className="px-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-4 opacity-50">
                Herramientas
              </p>
              {filteredItems.map((item) => {
                const isActive = pathname === item.href
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all active:scale-95",
                      isActive 
                        ? "bg-primary/10 text-primary" 
                        : "text-on-surface-variant hover:bg-surface-container-low"
                    )}
                  >
                    <Icon className={cn("w-5 h-5", isActive ? "stroke-[2.5]" : "stroke-[2]")} />
                    <span className="text-sm font-semibold">{item.label}</span>
                  </Link>
                )
              })}
            </div>

            {/* Footer */}
            <div className="p-4 bg-surface-container-low border-t border-outline-variant/10 space-y-2">
              <Link
                href="/settings"
                onClick={onClose}
                className="flex items-center gap-4 px-4 py-3.5 rounded-2xl text-on-surface-variant active:bg-surface-container-high transition-all"
              >
                <Settings className="w-5 h-5" />
                <span className="text-sm font-semibold">Configuración</span>
              </Link>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-error active:bg-error-container/30 transition-all font-semibold"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-sm">Cerrar sesión</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
