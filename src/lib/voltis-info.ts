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
 * Política IRREVOCABLE: el enlace que recibe el cliente JAMÁS expone la URL
 * Vercel del CRM. Siempre será https://portal.voltisenergia.com.
 *
 * Para que ese enlace funcione, hay que dirigir ese dominio al deployment.
 * Tres opciones (elige la que prefieras):
 *
 *  A) Dominio Vercel (recomendado, 5 minutos):
 *     1. Vercel → Project voltis-crm-bueno → Settings → Domains → Add
 *        `portal.voltisenergia.com`.
 *     2. En tu proveedor DNS de voltisenergia.com: CNAME `portal` →
 *        `cname.vercel-dns.com`.
 *     3. Esperar a que Vercel diga "Valid configuration".
 *
 *  B) Redirección desde voltisenergia.com (si el dominio principal lo gestionas tú):
 *     - Configura una regla 301 desde `voltisenergia.com/portal/*` →
 *       `https://voltis-crm-bueno.vercel.app/portal/*`.
 *     - Y cambia abajo `BASE` a `https://voltisenergia.com`.
 *
 *  C) Override por env var:
 *     - Vercel → Settings → Environment Variables → Add
 *       NEXT_PUBLIC_PORTAL_URL = `https://miPortalPersonalizado.com`.
 *
 * Hasta que actives A o B, el enlace mostrará la URL bonita pero dará 404
 * al abrirlo. Una vez configurado, los dossieres ya generados también
 * funcionarán automáticamente (la URL ya está hardcodeada en cada PDF).
 */
const PORTAL_URL_HARDCODED = 'https://portal.voltisenergia.com'

export function voltisPortalBaseUrl(): string {
  // La env var SÓLO se respeta si apunta a otro dominio Voltis (no a Vercel).
  // Si por error alguien la pone a la URL del CRM, se ignora.
  const env = process.env.NEXT_PUBLIC_PORTAL_URL
  if (env && /^https?:\/\//.test(env) && !/vercel\.app/i.test(env)) {
    return env.replace(/\/$/, '')
  }
  return PORTAL_URL_HARDCODED
}

/** Construye URL del portal magic link */
export function voltisPortalUrl(token: string): string {
  return `${voltisPortalBaseUrl()}${VOLTIS_INFO.portal_path}/${token}`
}
