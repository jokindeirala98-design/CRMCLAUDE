/**
 * Layout raíz del Portal Cliente v2.
 *
 * - Fondo cobalto FIJO (parallax tipo Apple): los paneles se mueven al
 *   scrollear, el fondo no.
 * - Estilos importados desde portal.css (scope `.voltis-portal-v2`).
 * - No depende del layout del CRM — el portal es independiente.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { VOLTIS_INFO } from '@/lib/voltis-info'
import './portal.css'

export const metadata: Metadata = {
  title: 'Voltis Energía · Portal Cliente',
  description: 'Tu energía, en datos. Consumo, gasto, ahorro y previsión.',
  robots: { index: false, follow: false },   // portal privado
}

export default function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="voltis-portal-v2 min-h-screen text-white relative">
      {/* Fondo cobalto FIJO — div en lugar de ::before para garantizar
          que tapa cualquier bg que tenga el <body> raíz del proyecto. */}
      <div aria-hidden className="voltis-portal-bg-fixed" />

      {/* Top bar mínima — la navegación principal vive dentro de cada página */}
      <header className="px-6 md:px-12 pt-7 flex items-center justify-between">
        <Link href="/client-portal/inicio" className="flex items-center gap-2.5 text-white">
          <span className="text-base font-semibold tracking-wide">Voltis</span>
          <span className="text-base font-light text-white/65">Energía</span>
        </Link>
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/55 num">
          Portal cliente
        </div>
      </header>

      <main>{children}</main>

      <footer className="px-6 md:px-12 py-10 mt-16 border-t border-white/10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-xs text-white/60">
          <div>
            <span className="font-semibold text-white">Voltis Energía</span> · {VOLTIS_INFO.phone} · {VOLTIS_INFO.email}
          </div>
          <div className="text-white/45">
            Esta plataforma es privada. El acceso queda registrado.
          </div>
        </div>
      </footer>
    </div>
  )
}
