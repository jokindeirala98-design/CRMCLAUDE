/**
 * Layout raíz del Portal Cliente v2.
 *
 * - Fondo cobalto FIJO (parallax tipo Apple): los paneles se mueven al
 *   scrollear, el fondo no.
 * - Tipografías Geist Sans / SF Pro Display vía CSS global.
 * - No depende del layout del CRM — el portal es independiente.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { VOLTIS_INFO } from '@/lib/voltis-info'

export const metadata: Metadata = {
  title: 'Voltis Energía · Portal Cliente',
  description: 'Tu energía, en datos. Consumo, gasto, ahorro y previsión.',
  robots: { index: false, follow: false },   // portal privado
}

export default function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="voltis-portal-v2 voltis-portal-bg min-h-screen text-white">
      <style>{`
        /* ── Tipografías ─────────────────────────────────────────────── */
        .voltis-portal-v2, .voltis-portal-v2 * {
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', system-ui, sans-serif;
        }
        .voltis-portal-v2 .num {
          font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
          font-variant-numeric: tabular-nums;
        }

        /* ── Fondo cobalto FIJO (parallax estilo Apple) ─────────────── */
        .voltis-portal-bg { position: relative; isolation: isolate; }
        .voltis-portal-bg::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: -1;
          background:
            radial-gradient(60% 45% at 12% 8%, rgba(120,160,255,0.22), transparent 65%),
            radial-gradient(50% 40% at 88% 4%, rgba(160,200,255,0.18), transparent 70%),
            radial-gradient(70% 60% at 8% 92%, rgba(70,110,220,0.20), transparent 65%),
            radial-gradient(55% 45% at 92% 88%, rgba(50,90,180,0.18), transparent 70%),
            linear-gradient(180deg, #0A2061 0%, #0B1E55 50%, #0A1A48 100%);
        }

        /* ── Card glass cobalto reutilizable ─────────────────────────── */
        .voltis-glass {
          background: linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%);
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.22),
            inset 0 1px 0 rgba(255,255,255,0.30),
            0 18px 40px -18px rgba(10,20,60,0.55);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-radius: 1rem;
        }
        .voltis-glass-soft {
          background: rgba(255,255,255,0.06);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: 0.75rem;
        }
      `}</style>

      {/* Top bar mínima — la navegación principal vive dentro de cada página */}
      <header className="relative z-10 px-6 md:px-12 pt-7 flex items-center justify-between">
        <Link href="/client-portal/inicio" className="flex items-center gap-2.5 text-white">
          <span className="text-base font-semibold tracking-wide">Voltis</span>
          <span className="text-base font-light text-white/65">Energía</span>
        </Link>
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/55 num">
          Portal cliente · {new Date().getFullYear()}
        </div>
      </header>

      <main className="relative z-10">{children}</main>

      <footer className="relative z-10 px-6 md:px-12 py-10 mt-16 border-t border-white/10">
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
