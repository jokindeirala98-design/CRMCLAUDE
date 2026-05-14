/**
 * Layout del portal cliente.
 *
 * - Sin sidebar del CRM.
 * - Estética Voltis editorial: paleta verde bosque, volt y neutros cálidos.
 * - Self-contained: el cliente nunca ve elementos internos del CRM.
 */
import './portal.css'

export const metadata = {
  title: 'Voltis Energía · Portal del cliente',
  description: 'Tu informe energético, siempre disponible',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F6F1E7] text-[#1A1A1A]">
      {children}
    </div>
  )
}
