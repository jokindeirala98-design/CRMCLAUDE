/**
 * Portal v2 — Inicio (Estudio económico global)
 *
 * Server component que valida sesión y renderiza la zona autenticada.
 * Toda la lógica de visualización del estudio económico vive en el
 * cliente `InicioClient` para poder usar useState/useEffect.
 *
 * Reutiliza el motor `computarOverview` ya existente y la estética
 * cobalto + glass que ya está pulida.
 */
import { requirePortalSession } from '@/lib/portal/require-session'
import { InicioClient } from './InicioClient'
import { PortalSideNav } from '../_components/SideNav'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PortalInicioPage() {
  const ctx = await requirePortalSession()

  return (
    <div className="px-6 md:px-12 pb-24 md:pb-12">
      <div className="flex flex-col md:flex-row gap-6 md:gap-8 pt-4">
        <PortalSideNav />
        <div className="flex-1 min-w-0">
          <InicioClient
            email={ctx.user.email}
            displayName={ctx.user.displayName}
          />
        </div>
      </div>
    </div>
  )
}
