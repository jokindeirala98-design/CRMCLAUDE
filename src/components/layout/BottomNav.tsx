'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, Zap, Users, DollarSign, Menu, LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface TabItem {
  label: string
  href: string
  icon: LucideIcon
}

const tabs: TabItem[] = [
  { label: 'Agenda',      href: '/agenda',       icon: CalendarDays },
  { label: 'Suministros', href: '/supplies',      icon: Zap },
  { label: 'Clientes',    href: '/clients',       icon: Users },
  { label: 'Comisiones',  href: '/commissions',   icon: DollarSign },
]

interface BottomNavProps {
  onMenuClick: () => void
}

export function BottomNav({ onMenuClick }: BottomNavProps) {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-bg/95 backdrop-blur-xl border-t border-line/60" />
      <div className="relative flex items-center justify-around h-16 px-1 pb-safe">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all active:scale-90 select-none',
                isActive ? 'text-brand' : 'text-ink-4'
              )}
            >
              <div className={cn(
                'w-10 h-7 flex items-center justify-center rounded-xl transition-all',
                isActive && 'bg-brand/12'
              )}>
                <Icon className={cn('w-5 h-5', isActive ? 'stroke-[2.5]' : 'stroke-[1.8]')} />
              </div>
              <span className={cn(
                'text-[9.5px] font-semibold tracking-wide leading-none',
                isActive ? 'text-brand' : 'text-ink-4'
              )}>
                {tab.label}
              </span>
            </Link>
          )
        })}

        {/* Menu */}
        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all active:scale-90 text-ink-4 select-none"
        >
          <div className="w-10 h-7 flex items-center justify-center rounded-xl">
            <Menu className="w-5 h-5 stroke-[1.8]" />
          </div>
          <span className="text-[9.5px] font-semibold tracking-wide leading-none">Más</span>
        </button>
      </div>
    </nav>
  )
}
