'use client'

/**
 * Navegación lateral del Portal v2.
 *
 * En desktop, sidebar vertical fija a la izquierda.
 * En mobile, tab bar inferior.
 *
 * 5 secciones: Inicio · Ahorros · Previsión · Facturas · Cuenta.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  TrendingDown,
  Calendar,
  FileText,
  User,
} from 'lucide-react'

const ITEMS = [
  { href: '/client-portal/inicio',    label: 'Inicio',     Icon: BarChart3 },
  { href: '/client-portal/ahorros',   label: 'Ahorros',    Icon: TrendingDown },
  { href: '/client-portal/prevision', label: 'Previsión',  Icon: Calendar },
  { href: '/client-portal/facturas',  label: 'Facturas',   Icon: FileText },
  { href: '/client-portal/cuenta',    label: 'Cuenta',     Icon: User },
] as const

export function PortalSideNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop: sidebar */}
      <aside className="hidden md:flex flex-col gap-1 sticky top-6 w-44 shrink-0">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname?.startsWith(href)
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition
                ${active
                  ? 'bg-white/14 text-white voltis-glass-soft'
                  : 'text-white/70 hover:text-white hover:bg-white/8'}`}>
              <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-[#B9D1FF]'}`} />
              {label}
            </Link>
          )
        })}
      </aside>

      {/* Mobile: bottom tab bar fija */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 px-3 pb-3 pt-2">
        <div className="voltis-glass flex items-center justify-around py-1 px-1">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = pathname?.startsWith(href)
            return (
              <Link key={href} href={href}
                className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition
                  ${active ? 'text-white bg-white/14' : 'text-white/65 hover:text-white'}`}>
                <Icon className="w-4 h-4" />
                <span className="text-[10px] font-medium tracking-wide">{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
