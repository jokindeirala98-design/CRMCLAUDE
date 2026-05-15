/**
 * Portal Cliente v2 — Inicio.
 *
 * Server component que verifica la sesión y, si está OK, muestra el
 * dashboard. Si no, redirige a /client-portal/login.
 *
 * Esta primera versión muestra un placeholder de bienvenida; en la
 * Fase 1 se migra aquí el contenido del portal v1 actual.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { PORTAL_SESSION_COOKIE, resolveSession } from '@/lib/portal/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PortalInicioPage() {
  const cookieStore = cookies()
  const token = cookieStore.get(PORTAL_SESSION_COOKIE)?.value
  if (!token) redirect('/client-portal/login')

  const ctx = await resolveSession(token)
  if (!ctx) redirect('/client-portal/login')

  const greeting = ctx.user.displayName?.trim() || ctx.user.email.split('@')[0]

  return (
    <div className="px-6 md:px-12 pt-6 pb-24">
      {/* Hero */}
      <section className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center mb-10">
        <div className="relative w-28 h-28">
          <Image src="/mascota-transparente.png" alt="Voltis" width={112} height={112} priority />
        </div>
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] text-white voltis-glass-soft mb-3">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#7fffb9', boxShadow: '0 0 8px #7fffb9' }} />
            Portal energético · en vivo
          </div>
          <h1 className="text-[32px] md:text-[40px] font-semibold leading-[1.06] text-white" style={{ letterSpacing: '-0.02em' }}>
            Hola, {greeting}.
          </h1>
          <p className="mt-2 text-sm text-white/75 max-w-2xl">
            Tu espacio privado para ver consumo, gasto, ahorro y previsión.
            Se actualiza solo con cada nueva factura.
          </p>
        </div>
      </section>

      {/* Bloques de acceso (placeholder hasta Fase 1) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <PortalSectionCard
          title="Estudio económico"
          subtitle="Visión global"
          desc="Cuánto pagas en luz y gas, dónde se concentra el gasto y cómo evoluciona mes a mes."
          href="/client-portal/inicio"
          available={false}
        />
        <PortalSectionCard
          title="Ahorros"
          subtitle="vs comercializadora anterior"
          desc="Comparativa trimestral, semestral y anual con descomposición transparente."
          href="/client-portal/ahorros"
          available={false}
        />
        <PortalSectionCard
          title="Previsión"
          subtitle="Próximos meses"
          desc="Estimación mes a mes con consumos del año anterior y precios Voltis."
          href="/client-portal/prevision"
          available={false}
        />
      </section>

      {/* Cuenta */}
      <section className="voltis-glass mt-10 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#B9D1FF] font-bold mb-1">Sesión</div>
          <div className="text-sm text-white">
            Conectado como <span className="font-semibold">{ctx.user.email}</span>
          </div>
        </div>
        <LogoutButton />
      </section>

      <p className="text-[11px] text-white/45 mt-10 max-w-2xl">
        Estamos terminando la nueva plataforma. En unos días podrás navegar
        todos los módulos desde aquí. Mientras tanto, tu acceso ya está
        activado.
      </p>
    </div>
  )
}

function PortalSectionCard({ title, subtitle, desc, href, available }: { title: string; subtitle: string; desc: string; href: string; available: boolean }) {
  const inner = (
    <div className="voltis-glass p-6 h-full flex flex-col gap-3 relative overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#B9D1FF] font-bold">{subtitle}</div>
      <h3 className="text-lg font-bold text-white">{title}</h3>
      <p className="text-sm text-white/75 leading-relaxed flex-1">{desc}</p>
      {!available && (
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/55">Próximamente</span>
      )}
    </div>
  )
  if (!available) {
    return <div className="opacity-70 cursor-not-allowed">{inner}</div>
  }
  return <Link href={href} className="block hover:scale-[1.01] transition">{inner}</Link>
}

function LogoutButton() {
  return (
    <form action="/api/portal/v2/auth/logout" method="post">
      <button type="submit"
        className="text-xs px-4 py-2 rounded-full voltis-glass-soft hover:bg-white/10 transition text-white">
        Cerrar sesión
      </button>
    </form>
  )
}
