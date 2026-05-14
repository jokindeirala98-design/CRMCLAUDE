/**
 * GET  /api/portal/auth  → devuelve el client_id si la cookie es válida
 * POST /api/portal/auth  → recibe {token}, valida y setea cookie httpOnly
 * DELETE /api/portal/auth → cierra sesión (revoca cookie)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolvePortalToken } from '@/lib/portal-data'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('voltis_portal_token')?.value
  if (!token) return NextResponse.json({ ok: false }, { status: 401 })
  const r = await resolvePortalToken(token)
  if (!r) return NextResponse.json({ ok: false }, { status: 401 })
  return NextResponse.json({ ok: true, clientId: r.clientId })
}

export async function POST(req: NextRequest) {
  const { token } = await req.json()
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token requerido' }, { status: 400 })
  }
  const r = await resolvePortalToken(token)
  if (!r) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  const res = NextResponse.json({ ok: true, clientId: r.clientId })
  res.cookies.set('voltis_portal_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,    // 30 días
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('voltis_portal_token')
  return res
}
