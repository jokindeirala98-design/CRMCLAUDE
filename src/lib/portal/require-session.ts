/**
 * Helper server-side para páginas del portal v2.
 * Si no hay sesión válida, redirige a /client-portal/login.
 */
import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PORTAL_SESSION_COOKIE, resolveSession, type PortalContext } from './auth'

export async function requirePortalSession(): Promise<PortalContext> {
  const token = cookies().get(PORTAL_SESSION_COOKIE)?.value
  if (!token) redirect('/client-portal/login')
  const ctx = await resolveSession(token)
  if (!ctx) redirect('/client-portal/login')
  return ctx
}
