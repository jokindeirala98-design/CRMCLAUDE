/**
 * Información corporativa Voltis Energía.
 * Datos extraídos de voltisenergia.com (mayo 2026).
 *
 * Paleta brand verificada en el sitio:
 *   • Sky blue        #88B9E7  (hero panel)
 *   • Electric blue   #3B4FE4  (CTAs, mascota, acentos)
 *   • Page grey       #F7F7F7  (fondo)
 *   • Heading ink     #1A1A1A
 *   • Body text       #6E7180
 *   • White cards     #FFFFFF
 *
 * Tipografía: Inter (Google Fonts).
 */
export const VOLTIS_INFO = {
  name: 'Voltis Energía',
  address_street: 'Parque Empresarial Ansoain, Calle Berriobide 38, Of. 209',
  address_city: 'Ansoáin',
  address_postcode: '31013',
  address_province: 'Navarra',
  phone: '747 474 360',
  email: 'admin@voltisenergia.com',
  website: 'voltisenergia.com',
  app_url: 'https://voltis-crm-bueno.vercel.app',
  portal_path: '/portal',
} as const

/** Línea formateada de dirección completa */
export function voltisFullAddress(): string {
  const i = VOLTIS_INFO
  return `${i.address_street}, ${i.address_postcode} ${i.address_city} (${i.address_province})`
}

/**
 * Base URL del portal cliente.
 *
 * Política actual (DNS de portal.voltisenergia.com aún no configurado):
 *   • Por defecto usa la URL del deploy Vercel para que el link FUNCIONE.
 *   • La env var `NEXT_PUBLIC_PORTAL_URL` se respeta SOLO si:
 *       1. Es https://
 *       2. NO apunta a un dominio *.vercel.app (auto-protección)
 *       3. NO contiene "portal.voltisenergia.com" (auto-protección hasta
 *          que el DNS esté configurado — si no, los clientes ven enlaces rotos)
 *
 * Cuando configures el DNS de portal.voltisenergia.com en Vercel + DNS provider,
 * elimina la condición `!isPortalVoltisEnergia` de abajo y los nuevos
 * dossieres saldrán con la URL bonita.
 */
export function voltisPortalBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_PORTAL_URL
  if (env && /^https?:\/\//.test(env)) {
    const isVercel = /\.vercel\.app/i.test(env)
    const isPortalVoltisEnergia = /portal\.voltisenergia\.com/i.test(env)
    // Mientras el dominio no resuelva en DNS, ignoramos esta env var para
    // que el cliente nunca reciba un link roto.
    if (!isVercel && !isPortalVoltisEnergia) {
      return env.replace(/\/$/, '')
    }
  }
  return VOLTIS_INFO.app_url
}

/** Construye URL del portal magic link */
export function voltisPortalUrl(token: string): string {
  return `${voltisPortalBaseUrl()}${VOLTIS_INFO.portal_path}/${token}`
}
