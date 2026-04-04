'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Users,
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
  { label: 'Panel', href: '/panel', icon: LayoutDashboard },
  { label: 'Bandeja', href: '/inbox', icon: Inbox },
  { label: 'Clientes', href: '/clients', icon: Users },
]

interface BottomNavProps {
  onMenuClick: () => void
}

export function BottomNav({ onMenuClick }: BottomNavProps) {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-surface/80 backdrop-blur-xl border-t border-outline-variant/10" />

      <div className="relative flex items-center justify-around h-16 px-2 pb-safe">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          const Icon = tab.icon

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 flex-1 h-full transition-all active:scale-90",
                isActive ? "text-primary" : "text-on-surface-variant"
              )}
            >
              <div className={cn(
                "p-1 rounded-full transition-colors",
                isActive && "bg-primary/10"
              )}>
                <Icon className={cn("w-6 h-6", isActive ? "stroke-[2.5]" : "stroke-[2]")} />
              </div>
              <span className="text-[10px] font-semibold tracking-wide">
                {tab.label}
              </span>
            </Link>
          )
        })}

        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center gap-1.5 flex-1 h-full transition-all active:scale-90 text-on-surface-variant"
        >
          <div className="p-1">
            <Menu className="w-6 h-6 stroke-[2]" />
          </div>
          <span className="text-[10px] font-semibold tracking-wide">
            Menu
          </span>
        </button>
      </div>
    </nav>
  )
}
