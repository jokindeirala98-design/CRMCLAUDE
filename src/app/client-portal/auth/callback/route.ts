/**
 * GET /auth/callback?token=...
 *
 * Endpoint que llega cuando el usuario pulsa el enlace del email.
 * Canjea el magic link por una sesión persistente, setea cookie httpOnly
 * de 30 días, y redirige a /client-portal/inicio.
 *
 * Si el token es inválido o ha expirado, redirige a /client-portal/login
 * con un mensaje de error.
 */
import { NextRequest, NextResponse } from 'next/server'
import { consumeMagicLink, PORTAL_SESSION_COOKIE, PORTAL_SESSION_DAYS } from '@/lib/portal/auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined
  const userAgent = req.headers.get('user-agent') || undefined

  const result = await consumeMagicLink(token, { ip, userAgent })

  const url = req.nextUrl.clone()
  if (!result) {
    url.pathname = '/client-portal/login'
    url.search = '?error=invalid_link'
    return NextResponse.redirect(url)
  }

  url.pathname = '/client-portal/inicio'
  url.search = ''
  const res = NextResponse.redirect(url)
  res.cookies.set(PORTAL_SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PORTAL_SESSION_DAYS * 24 * 60 * 60,
  })
  return res
}
