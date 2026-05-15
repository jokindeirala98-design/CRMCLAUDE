/**
 * Layout del portal cliente.
 *
 * - Sin sidebar del CRM.
 * - Estética Voltis cobalto (verificada en voltisenergia.com).
 * - Self-contained: el cliente nunca ve elementos internos del CRM.
 * - Preload de la mascota para que cargue instantánea cuando el hero entra.
 */
import './portal.css'

export const metadata = {
  title: 'Voltis Energía · Portal del cliente',
  description: 'Tu informe energético, siempre disponible',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Preload del asset crítico: la mascota aparece arriba en el hero.
          Cargarla en paralelo con el HTML hace que aparezca sin flash. */}
      <link
        rel="preload"
        as="image"
        href="/mascota-transparente.png"
        // @ts-ignore  fetchpriority no está en los typings de React aún
        fetchpriority="high"
      />
      <div className="min-h-screen bg-white text-[#0B1B3E]">
        {children}
      </div>
    </>
  )
}
