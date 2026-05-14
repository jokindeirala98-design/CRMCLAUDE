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
 * Política:
 *   • SI `NEXT_PUBLIC_PORTAL_URL` está definida → se usa esa (dominio limpio).
 *   • SI NO → se usa la URL de Vercel para que el enlace SIEMPRE funcione.
 *
 * Activar el dominio limpio (una sola vez):
 *   1. Vercel → Project → Settings → Domains → Add `portal.voltisenergia.com`
 *   2. En tu proveedor DNS: `CNAME portal → cname.vercel-dns.com`
 *   3. Esperar a que Vercel diga "Valid Configuration" (~5 min).
 *   4. Vercel → Settings → Environment Variables → Add:
 *        Key   : NEXT_PUBLIC_PORTAL_URL
 *        Value : https://portal.voltisenergia.com
 *        Scope : Production · Preview · Development
 *   5. Redeploy.
 *
 * A partir de ahí, los nuevos dossieres saldrán con la URL bonita.
 * Hasta entonces, salen con la URL Vercel pero abren correctamente.
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
