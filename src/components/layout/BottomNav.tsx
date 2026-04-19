'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Users,
  Zap,
  Menu,
  LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface TabItem {
  label: string
  href: string
  icon: LucideIcon
}

const tabs: TabItem[] = [
  { label: 'Panel',        href: '/panel',    icon: LayoutDashboard },
  { label: 'Bandeja',      href: '/inbox',    icon: Inbox },
  { label: 'Clientes',     href: '/clients',  icon: Users },
  { label: 'Suministros',  href: '/supplies', icon: Zap },
]

interface BottomNavProps {
  onMenuClick: () => void
}

export function BottomNav({ onMenuClick }: BottomNavProps) {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-bg/90 backdrop-blur-xl border-t border-line" />

      <div className="relative flex items-center justify-around h-16 px-1 pb-safe">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          const Icon = tab.icon

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all active:scale-90',
                isActive ? 'text-ink' : 'text-ink-4'
              )}
            >
              <div className={cn(
                'p-1 rounded-md transition-colors',
                isActive && 'bg-line'
              )}>
                <Icon className={cn('w-5 h-5', isActive ? 'stroke-[2.5]' : 'stroke-[2]')} />
              </div>
              <span className={cn(
                'text-[9px] font-semibold tracking-wide',
                isActive ? 'text-ink' : 'text-ink-4'
              )}>
                {tab.label}
              </span>
            </Link>
          )
        })}

        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all active:scale-90 text-ink-4"
        >
          <div className="p-1">
            <Menu className="w-5 h-5 stroke-[2]" />
          </div>
          <span className="text-[9px] font-semibold tracking-wide">Menú</span>
        </button>
      </div>
    </nav>
  )
}
