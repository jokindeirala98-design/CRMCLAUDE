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
 * Por defecto usa la app del CRM, pero se puede sobrescribir con
 * `NEXT_PUBLIC_PORTAL_URL` (ej. https://portal.voltisenergia.com) para que
 * el enlace que recibe el cliente no exponga el CRM interno.
 *
 * Configuración Vercel:
 *   1. Domain Settings → Add domain "portal.voltisenergia.com"
 *   2. DNS: CNAME portal → cname.vercel-dns.com
 *   3. Env Var: NEXT_PUBLIC_PORTAL_URL = "https://portal.voltisenergia.com"
 */
export function voltisPortalBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_PORTAL_URL
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/$/, '')
  return VOLTIS_INFO.app_url
}

/** Construye URL del portal magic link */
export function voltisPortalUrl(token: string): string {
  return `${voltisPortalBaseUrl()}${VOLTIS_INFO.portal_path}/${token}`
}
