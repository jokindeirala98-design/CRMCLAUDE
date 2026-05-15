import Image from 'next/image'
import { requirePortalSession } from '@/lib/portal/require-session'
import { PortalSideNav } from '../_components/SideNav'

export const dynamic = 'force-dynamic'

export default async function CuentaPage() {
  const ctx = await requirePortalSession()
  return (
    <div className="px-6 md:px-12 pb-24 md:pb-12">
      <div className="flex flex-col md:flex-row gap-6 md:gap-8 pt-4">
        <PortalSideNav />
        <div className="flex-1 min-w-0 space-y-6">
          <div className="voltis-glass p-8 max-w-3xl relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
            <div className="relative flex items-start gap-5 mb-5">
              <div className="relative w-16 h-16 shrink-0">
                <Image src="/mascota-transparente.png" alt="Voltis" width={64} height={64} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">Tu sesión</div>
                <h1 className="text-2xl md:text-3xl font-semibold text-white" style={{ letterSpacing: '-0.02em' }}>
                  {ctx.user.displayName || 'Tu cuenta'}
                </h1>
              </div>
            </div>
            <dl className="relative grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="voltis-glass-soft p-4">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-[#B9D1FF] font-bold mb-1">Email</dt>
                <dd className="text-white">{ctx.user.email}</dd>
              </div>
              <div className="voltis-glass-soft p-4">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-[#B9D1FF] font-bold mb-1">Rol</dt>
                <dd className="text-white capitalize">{ctx.user.role}</dd>
              </div>
            </dl>

            <form action="/api/portal/v2/auth/logout" method="post" className="relative mt-6">
              <button type="submit"
                className="text-xs px-4 py-2 rounded-full voltis-glass-soft hover:bg-white/10 transition text-white">
                Cerrar sesión
              </button>
            </form>
          </div>

          <p className="text-[11px] text-white/45 max-w-2xl">
            Tu acceso queda registrado por seguridad. Próximamente podrás invitar a otros
            usuarios de tu organización desde esta página.
          </p>
        </div>
      </div>
    </div>
  )
}
