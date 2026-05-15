/**
 * POST /api/portal/v2/auth/logout
 *
 * Cierra la sesión actual: revoca el token en BD y elimina la cookie.
 */
import { NextRequest, NextResponse } from 'next/server'
import { revokeSession, PORTAL_SESSION_COOKIE, auditLog, resolveSession } from '@/lib/portal/auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  if (sessionToken) {
    const ctx = await resolveSession(sessionToken)
    await auditLog({
      ctx,
      action: 'logout',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim(),
      userAgent: req.headers.get('user-agent'),
    })
    await revokeSession(sessionToken)
  }

  // Si la petición viene de un <form> HTML, redirigimos al login.
  // Si es fetch (Accept: application/json), devolvemos JSON.
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html')
  let res: NextResponse
  if (wantsHtml) {
    const url = req.nextUrl.clone()
    url.pathname = '/client-portal/login'
    url.search = ''
    res = NextResponse.redirect(url, 303)   // 303 → cliente cambia POST a GET
  } else {
    res = NextResponse.json({ ok: true })
  }

  res.cookies.set(PORTAL_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
