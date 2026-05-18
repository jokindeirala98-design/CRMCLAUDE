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
  LogOut,
  ClipboardCheck,
  Inbox,
  DollarSign,
  FileSpreadsheet,
  Calculator,
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

// ── Nav groups ────────────────────────────────────────────────────────────────
// Every item has a `permission` key — non-admin users only see sections
// the owner has explicitly enabled for them in Configuración > Equipo.
// Admins bypass all permission checks (filterItem returns true for isAdmin()).
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'General',
    items: [
      { href: '/panel',   label: 'Panel',   icon: LayoutDashboard, permission: 'panel' },
      { href: '/inbox',   label: 'Estudios pendientes', icon: Inbox, permission: 'inbox' },
      { href: '/agenda',  label: 'Agenda',  icon: CalendarDays,    permission: 'agenda' },
    ],
  },
  {
    label: 'Operación',
    items: [
      { href: '/clients',      label: 'Clientes',         icon: Users,           permission: 'clients' },
      { href: '/supplies',     label: 'Suministros',      icon: Zap,             permission: 'supplies' },
      { href: '/prescorings',  label: 'Prescorings',      icon: ClipboardCheck,  permission: 'prescorings' },
      { href: '/comparativas', label: 'Comparativas 2.0', icon: Calculator,      permission: 'comparativas' },
      { href: '/informes',     label: 'Informes',         icon: FileSpreadsheet, adminOnly: true },
      { href: '/contracts',    label: 'Contratos',        icon: FileText,        permission: 'contracts' },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { href: '/subscriptions', label: 'Suscripciones', icon: CreditCard, permission: 'billing' },
      { href: '/billing',       label: 'Facturación',   icon: Receipt,    permission: 'billing' },
      { href: '/commissions',   label: 'Comisiones',    icon: DollarSign, permission: 'commissions' },
      { href: '/reports',       label: 'Estadísticas',  icon: BarChart3,  permission: 'reports' },
    ],
  },
]

// Flat list kept for backward compat (used by external code that might reference navItems)
export const navItems: NavItem[] = navGroups.flatMap((g) => g.items)

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { user, hasPermission, isAdmin } = useAuthStore()

  const filterItem = (item: NavItem) => {
    if (isAdmin()) return true // admins ven todo
    if (item.adminOnly) return false
    if (item.permission && !hasPermission(item.permission)) return false
    return true
  }

  const handleLogout = async () => {
    const supabase = getAuthClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-4 py-5 w-full hover:opacity-70 transition-opacity cursor-pointer"
        title={collapsed ? 'Expandir menú' : 'Plegar menú'}
      >
        <AnimatePresence initial={false}>
          {collapsed ? (
            <motion.div
              key="icon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center flex-shrink-0"
            >
              <Zap className="w-4 h-4 text-volt" />
            </motion.div>
          ) : (
            <motion.div
              key="logo"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="overflow-hidden flex-shrink-0"
            >
              <VoltisLogo height={34} color="#1F3A2E" subtitleColor="#6B8068" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto space-y-4 pb-2">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter(filterItem)
          if (visibleItems.length === 0) return null

          return (
            <div key={group.label}>
              {/* Group label */}
              {!collapsed && (
                <p className="label-mono text-ink-4 px-3 mb-1">{group.label}</p>
              )}

              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive = pathname.startsWith(item.href)
                  const Icon = item.icon

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100',
                        isActive
                          ? 'bg-salvia text-[#FBF7EE]'
                          : 'text-ink-3 hover:bg-line/60 hover:text-ink'
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
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
              </div>
            </div>
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 pb-4 space-y-1 border-t border-line pt-3">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
            pathname.startsWith('/settings')
              ? 'bg-salvia text-[#FBF7EE]'
              : 'text-ink-3 hover:bg-line/60 hover:text-ink'
          )}
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Configuración</span>}
        </Link>

        {/* User card */}
        <div className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-bg',
          collapsed && 'justify-center'
        )}>
          <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center flex-shrink-0 overflow-hidden">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-volt text-xs font-bold leading-none">
                {user?.initials || getUserInitials(user?.full_name || user?.email) || 'V'}
              </span>
            )}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-ink truncate">
                {user ? (user.full_name || user.email) : 'Cargando...'}
              </p>
              <p className="text-[10px] text-ink-4 capitalize">
                {user?.role || '—'}
              </p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md text-ink-4 hover:text-err hover:bg-err-container/30 transition-all"
              title="Cerrar sesión"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      className="hidden lg:flex flex-col h-screen bg-card border-r border-line sticky top-0 overflow-hidden"
    >
      {sidebarContent}
    </motion.aside>
  )
}
