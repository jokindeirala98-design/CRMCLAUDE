import Image from 'next/image'
import { requirePortalSession } from '@/lib/portal/require-session'
import { PortalSideNav } from '../_components/SideNav'

export const dynamic = 'force-dynamic'

export default async function FacturasPage() {
  await requirePortalSession()
  return (
    <div className="px-6 md:px-12 pb-24 md:pb-12">
      <div className="flex flex-col md:flex-row gap-6 md:gap-8 pt-4">
        <PortalSideNav />
        <div className="flex-1 min-w-0">
          <div className="voltis-glass p-8 md:p-10 max-w-3xl relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)' }} />
            <div className="relative flex items-start gap-5 mb-5">
              <div className="relative w-16 h-16 shrink-0">
                <Image src="/mascota-transparente.png" alt="Voltis" width={64} height={64} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF] mb-1">Próximamente</div>
                <h1 className="text-2xl md:text-3xl font-semibold text-white" style={{ letterSpacing: '-0.02em' }}>Facturas</h1>
              </div>
            </div>
            <p className="relative text-sm text-white/80 leading-relaxed">
              Listado de todas tus facturas con desglose económico y descarga directa del PDF original.
              Mientras tanto, puedes ver el detalle de cada suministro desde la página de Inicio.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
