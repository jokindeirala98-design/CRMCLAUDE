/**
 * Portal Cliente v2 — Host detection
 * ──────────────────────────────────────────────────────────────────────
 * Detecta si la petición entrante viene del subdominio del portal
 * cliente o del CRM. La separación se hace por HOST, no por path:
 * el mismo deploy de Next.js sirve ambos dominios.
 *
 *   cliente.voltisenergia.com   → portal cliente v2 (público)
 *   <cualquier-otro-host>       → CRM (interno Voltis)
 *
 * Variable de entorno controla el host del portal:
 *   PORTAL_V2_HOST=cliente.voltisenergia.com
 *
 * Si no está definida, el portal v2 está DESACTIVADO y todo el tráfico
 * va al CRM. Esto permite hacer deploy de la migración sin que se
 * exponga la nueva ruta hasta que esté lista.
 */

/** Host del portal cliente v2 según variable de entorno. */
export function getPortalHost(): string | null {
  const h = process.env.PORTAL_V2_HOST?.trim().toLowerCase()
  return h && h.length > 0 ? h : null
}

/** Hosts adicionales (vista previa, staging) — separados por coma. */
export function getPortalPreviewHosts(): string[] {
  const raw = process.env.PORTAL_V2_PREVIEW_HOSTS?.trim()
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

/** Determina si un host concreto es el del portal cliente. */
export function isPortalHost(host: string | null | undefined): boolean {
  if (!host) return false
  const lower = host.toLowerCase().replace(/:\d+$/, '')  // strip puerto
  const main = getPortalHost()
  if (main && lower === main) return true
  if (getPortalPreviewHosts().includes(lower)) return true
  return false
}

/** Devuelve la base URL pública del portal — útil para construir magic links.
 *  Si recibimos el host de la petición entrante y ese host es un preview
 *  permitido o el host del portal, lo usamos. Si no, fallback al host
 *  configurado en PORTAL_V2_HOST.
 *
 *  ¿Por qué? Si el cliente entra desde `voltis-crm-bueno.vercel.app`
 *  (preview), el enlace que recibe en su email debe llevar a ese mismo
 *  host. Si lo mandamos al host de producción y el DNS aún no está
 *  resuelto, le sale DNS_PROBE_FINISHED_NXDOMAIN.
 */
export function getPortalBaseUrl(requestHost?: string | null): string {
  if (requestHost) {
    const lower = requestHost.toLowerCase().replace(/:\d+$/, '')
    if (isPortalHost(lower) || getPortalPreviewHosts().includes(lower)) {
      return `https://${lower}`
    }
  }
  const host = getPortalHost()
  if (host) return `https://${host}`
  return process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
}
