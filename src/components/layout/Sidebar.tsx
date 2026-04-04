'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Users,
  Zap,
  FileText,
  CreditCard,
  Receipt,
  BarChart3,
  CalendarDays,
  Settings,
  ChevronLeft,
  LogOut,
  ClipboardCheck,
  Inbox,
  DollarSign,
  FileSpreadsheet,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { getUserInitials } from '@/lib/utils/format'
import { useAuthStore } from '@/stores/auth'
import { getAuthClient } from '@/lib/supabase/client'
import { VoltisLogo } from '@/components/ui/VoltisLogo'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  permission?: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { href: '/panel', label: 'Panel', icon: LayoutDashboard },
  { href: '/inbox', label: 'Bandeja', icon: Inbox },
  { href: '/clients', label: 'Clientes', icon: Users },
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

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
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

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5">
        <AnimatePresence initial={false}>
          {collapsed ? (
            <motion.div
              key="icon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0"
            >
              <Zap className="w-5 h-5 text-white" />
            </motion.div>
          ) : (
            <motion.div
              key="logo"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="overflow-hidden flex-shrink-0"
            >
              <VoltisLogo height={38} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {filteredItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-surface-container-lowest text-primary shadow-ambient-sm'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
              )}
            >
              <Icon className={cn('w-5 h-5 flex-shrink-0', isActive && 'text-secondary')} />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="whitespace-nowrap overflow-hidden"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 pb-4 space-y-2">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container-low transition-all"
        >
          <Settings className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Configuracion</span>}
        </Link>

        {/* User card */}
        <div className={cn(
          'flex items-center gap-3 px-3 py-3 rounded-xl bg-surface-container-low',
          collapsed && 'justify-center'
        )}>
          <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">
              {getUserInitials(user?.full_name || user?.email)?.charAt(0) || 'U'}
            </span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">
                {getUserInitials(user?.full_name || user?.email)}
              </p>
              <p className="text-[11px] text-on-surface-variant capitalize">
                {user?.role || 'commercial'}
              </p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/30 transition-all"
              title="Cerrar sesion"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar only - mobile uses MobileNav */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 260 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="hidden lg:flex flex-col h-screen bg-surface-container-low sticky top-0 overflow-hidden"
      >
        {sidebarContent}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-6 -right-3 w-6 h-6 rounded-full bg-surface-container-lowest shadow-ambient-sm flex items-center justify-center hover:bg-surface-container-high transition-all"
        >
          <ChevronLeft
            className={cn(
              'w-3.5 h-3.5 text-on-surface-variant transition-transform',
              collapsed && 'rotate-180'
            )}
          />
        </button>
      </motion.aside>
    </>
  )
}
