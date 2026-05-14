/**
 * Información corporativa Voltis Energía.
 * Datos extraídos de voltisenergia.com/contacto (mayo 2026).
 *
 * Los campos que NO aparecen en la web (CIF, etc.) se omiten deliberadamente.
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

/** Construye URL del portal magic link */
export function voltisPortalUrl(token: string): string {
  return `${VOLTIS_INFO.app_url}${VOLTIS_INFO.portal_path}/${token}`
}
