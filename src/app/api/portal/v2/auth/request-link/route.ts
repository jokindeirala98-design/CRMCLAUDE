/**
 * POST /api/portal/v2/auth/request-link
 *
 * Body: { email: string }
 *
 * Genera (si procede) un magic link y lo envía por email al usuario.
 * Por seguridad SIEMPRE devuelve 200 — no exponemos si el email existe.
 *
 * Rate limit: el cliente solo puede solicitar 1 magic link por minuto
 * por email (anti-spam y anti-enumeración).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createMagicLink } from '@/lib/portal/auth'
import { getPortalBaseUrl, isPortalHost } from '@/lib/portal/host'
import { sendPortalMagicLinkEmail } from '@/lib/portal/email'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // Solo desde el host del portal v2 (defensa en profundidad — el middleware
  // ya hace este chequeo a nivel global).
  const host = req.headers.get('host')
  if (!isPortalHost(host) && process.env.PORTAL_V2_HOST) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }
  const email = String(body?.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ ok: true })  // genérico
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null

  // Logging técnico (no se expone al cliente, solo a Vercel logs).
  // En producción real lo bajamos a debug; ahora lo dejamos verboso para
  // diagnosticar el flujo de envío.
  try {
    const result = await createMagicLink(email, getPortalBaseUrl(), { ip: ip || undefined })
    if (!result) {
      console.log('[portal:request-link] no portal_user activo para email', email)
    } else {
      console.log('[portal:request-link] magic link creado', { email: result.email, url: result.url })
      try {
        await sendPortalMagicLinkEmail({
          to: result.email,
          url: result.url,
          expiresAt: result.expiresAt,
        })
        console.log('[portal:request-link] email enviado a', result.email)
      } catch (err: any) {
        console.error('[portal:request-link] ERROR enviando email:', err?.message || err, err?.name)
      }
    }
  } catch (err: any) {
    console.error('[portal:request-link] error creando magic link:', err?.message || err)
  }

  return NextResponse.json({ ok: true })
}
