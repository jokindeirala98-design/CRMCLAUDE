'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Inbox, Users, Zap, Bell } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useAuthStore } from '@/stores/auth'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface MobileNavItem {
  href: string
  label: string
  icon: React.ElementType
}

const navItems: MobileNavItem[] = [
  { href: '/panel', label: 'Panel', icon: LayoutDashboard },
  { href: '/inbox', label: 'Bandeja', icon: Inbox },
  { href: '/clients', label: 'Clientes', icon: Users },
  { href: '/supplies', label: 'Suministros', icon: Zap },
  { href: '/notifications', label: 'Alertas', icon: Bell },
]

export function MobileNav() {
  const pathname = usePathname()
  const { user } = useAuthStore()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!user?.id) return
    const supabase = createClient()

    const fetchCounts = async () => {
      const { count: notifCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false)
      setUnreadCount(notifCount || 0)
    }

    fetchCounts()
    const interval = setInterval(fetchCounts, 30000)
    return () => clearInterval(interval)
  }, [user?.id])

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-outline-variant/20 safe-area-bottom">
      <div className="flex items-center justify-around px-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/panel' && pathname.startsWith(item.href))
          const Icon = item.icon
          const isNotifications = item.href === '/notifications'
          const badgeCount = isNotifications ? unreadCount : 0

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 py-3 rounded-xl min-w-[56px] flex-1 transition-all relative',
                isActive
                  ? 'text-primary'
                  : 'text-on-surface-variant'
              )}
            >
              <div className="relative">
                <Icon className={cn('w-5 h-5', isActive && 'text-secondary')} />
                {badgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 text-white text-[9px] font-bold rounded-full flex items-center justify-center bg-red-500">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </div>
              <span className={cn(
                'text-[10px] font-medium leading-tight',
                isActive ? 'text-primary font-semibold' : 'text-on-surface-variant'
              )}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-secondary rounded-full" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
