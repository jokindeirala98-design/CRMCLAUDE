/**
 * Middleware global — enrutado dual-host CRM ↔ Portal Cliente v2.
 *
 * ARQUITECTURA
 * ════════════════════════════════════════════════════════════════════════
 *
 *   cliente.voltisenergia.com   → Portal Cliente v2 (público, login propio)
 *   <cualquier-otro-host>       → CRM interno Voltis (Supabase Auth)
 *
 * El subdominio del portal se configura con la env var PORTAL_V2_HOST.
 * Si no está definida, el portal v2 está DESACTIVADO y todo va al CRM.
 *
 * AISLAMIENTO DE SEGURIDAD
 * ════════════════════════════════════════════════════════════════════════
 * 1. Desde el host del PORTAL no se puede acceder a rutas del CRM —
 *    cualquier intento devuelve 404. Esto incluye /dashboard/*,
 *    /clients/*, /supplies/*, /billing/*, /api/admin/*, etc.
 *
 * 2. Desde el host del CRM no se puede acceder a las rutas /client-portal/*
 *    (las nuevas rutas del portal v2). Devuelve 404.
 *
 * 3. El portal v1 antiguo (/portal/[token]) sigue accesible desde el CRM
 *    por compatibilidad con magic links ya enviados. Será eliminado tras
 *    migrar todos los clientes.
 *
 * 4. /api/portal/v2/* es accesible solo desde el host del portal v2.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { getPortalHost, isPortalHost } from '@/lib/portal/host'

// Rutas que SOLO se sirven en el host del portal v2.
const PORTAL_V2_ONLY_PREFIXES = [
  '/client-portal',         // páginas del portal v2
  '/api/portal/v2',         // endpoints del portal v2
]

// Rutas del CRM que NUNCA deben ser accesibles desde el subdominio cliente.
// Si alguien intenta entrar desde cliente.voltisenergia.com → 404.
const CRM_ONLY_PREFIXES = [
  '/panel',
  '/clients',
  '/supplies',
  '/agenda',
  '/billing',
  '/comparativas',
  '/comparativas-manual',
  '/contracts',
  '/commissions',
  '/inbox',
  '/informes',
  '/prescorings',
  '/calendar',
  '/api/admin',
  '/api/clients',
  '/api/supplies',
  '/api/billing',
  '/api/analyze-invoice',
  '/api/telegram',
  '/api/cron',
  '/api/comparativa',
  '/api/comparativas',
  '/api/contracts',
  '/api/commissions',
  '/api/google',
  '/api/inbox',
]

// Rutas COMUNES que pueden servirse en ambos hosts (assets, autenticación
// del propio CRM cuando se accede desde su dominio).
const PUBLIC_COMMON_PREFIXES = [
  '/_next',
  '/favicon',
  '/icons',
  '/manifest.json',
  '/mascota',
  '/api/health',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')
  const portalHostConfigured = !!getPortalHost()
  const isPortal = isPortalHost(host)

  // MODO PREVIEW: si todavía no hay subdominio configurado, permitimos
  // /client-portal/* desde el dominio principal del CRM para poder probar.
  // Solo entra en juego cuando PORTAL_V2_HOST está vacío. En producción
  // real, cuando configures la env var, el aislamiento estricto kicks in.
  const previewMode = !portalHostConfigured

  // Activos públicos: dejamos pasar tal cual.
  if (PUBLIC_COMMON_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // ═══════════════════════════════════════════════════════════════════
  // PETICIONES AL SUBDOMINIO DEL PORTAL CLIENTE
  // ═══════════════════════════════════════════════════════════════════
  if (isPortal) {
    // 1) Bloqueo absoluto: rutas del CRM no existen en este host.
    if (CRM_ONLY_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
      return new NextResponse('Not Found', { status: 404 })
    }

    // 2) Raíz del portal → /client-portal/inicio (o /client-portal/login)
    if (pathname === '/' || pathname === '') {
      const url = request.nextUrl.clone()
      url.pathname = '/client-portal/inicio'
      return NextResponse.redirect(url)
    }

    // 3) Compatibilidad: el portal v1 antiguo (/portal/[token]) sigue
    //    sirviendo magic links existentes mientras migramos clientes.
    if (pathname.startsWith('/portal/')) {
      return NextResponse.next()
    }

    // 4) /api/portal/* (v1) sigue accesible para compatibilidad.
    //    /api/portal/v2/* es la nueva superficie.
    if (pathname.startsWith('/api/portal')) {
      return NextResponse.next()
    }

    // 5) Cualquier otra ruta dentro del host del portal: continúa.
    return NextResponse.next()
  }

  // ═══════════════════════════════════════════════════════════════════
  // PETICIONES AL HOST DEL CRM
  // ═══════════════════════════════════════════════════════════════════
  // Bloqueo estricto: las rutas del portal v2 no se exponen desde el CRM
  // CUANDO ya hay subdominio configurado. En preview, dejamos pasar
  // /client-portal/* para que puedas probarlo en la URL de Vercel.
  const isPortalRoute = PORTAL_V2_ONLY_PREFIXES.some(
    p => pathname === p || pathname.startsWith(p + '/')
  )
  if (isPortalRoute) {
    if (previewMode) {
      // Modo preview: portal accesible desde el host del CRM.
      return NextResponse.next()
    }
    return new NextResponse('Not Found', { status: 404 })
  }

  // El resto va al flujo normal del CRM (Supabase Auth).
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)',
  ],
}
