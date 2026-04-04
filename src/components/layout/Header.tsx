'use client'

import { Bell } from 'lucide-react'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  hideMobile?: boolean
}

export function Header({ title, subtitle, actions, hideMobile }: HeaderProps) {
  return (
    <header className={`sticky top-0 z-30 bg-surface/80 backdrop-blur-xl ${hideMobile ? 'hidden lg:block' : ''}`}>
      <div className="flex items-center justify-between px-4 lg:px-8 py-3 lg:py-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display font-bold text-lg lg:text-2xl text-on-surface truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs lg:text-sm text-on-surface-variant mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 lg:gap-3 ml-3">
          {/* Notifications - hidden on mobile (shown in bottom nav) */}
          <button className="hidden lg:flex relative w-10 h-10 items-center justify-center rounded-xl hover:bg-surface-container-high transition-all">
            <Bell className="w-5 h-5 text-on-surface-variant" />
          </button>

          {/* Actions slot */}
          {actions}
        </div>
      </div>
    </header>
  )
}
