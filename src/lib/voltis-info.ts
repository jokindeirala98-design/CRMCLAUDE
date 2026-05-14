/**
 * Información corporativa Voltis Energía.
 *
 * Edita aquí los datos UNA SOLA VEZ y se propagan al dossier de bienvenida,
 * footers de PDFs y cualquier otro sitio donde aparezcan los datos de la empresa.
 */
export const VOLTIS_INFO = {
  name: 'Voltis Energía',
  legal_name: 'Voltis Energía S.L.',
  cif: 'B12345678',                                    // ← edítame
  address_street: 'Calle Mayor, 1',                    // ← edítame
  address_city: 'Pamplona',                            // ← edítame
  address_postcode: '31001',                           // ← edítame
  address_province: 'Navarra',                         // ← edítame
  phone: '+34 948 00 00 00',                           // ← edítame
  email: 'hola@voltisenergia.com',                     // ← edítame
  website: 'voltisenergia.com',
  app_url: 'https://voltis-crm-bueno.vercel.app',
  portal_path: '/portal',
  tagline: 'Energía clara, sin sorpresas',             // claim opcional
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
