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
import { createMagicLinksForEmail } from '@/lib/portal/auth'
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

  // Construimos el baseURL a partir del HOST de la petición entrante.
  // Esto garantiza que el cliente reciba un enlace que lleva al mismo
  // dominio desde el que pidió el acceso (preview o producción).
  const baseUrl = getPortalBaseUrl(req.headers.get('host'))

  try {
    // Genera UN magic link por cada portal_user activo asociado a este email.
    // Si pertenece a varios clientes, mandamos un correo por cada uno con
    // el nombre del cliente en el subject para que el destinatario sepa
    // cuál abre.
    const results = await createMagicLinksForEmail(email, baseUrl, { ip: ip || undefined })
    if (results.length === 0) {
      console.log('[portal:request-link] no portal_user activo para email', email)
    } else {
      console.log('[portal:request-link] magic links creados', results.length, 'para', email)
      for (const r of results) {
        try {
          await sendPortalMagicLinkEmail({
            to: r.email,
            url: r.url,
            expiresAt: r.expiresAt,
            clientName: r.clientName || undefined,
          })
          console.log('[portal:request-link] email enviado a', r.email, 'para cliente', r.clientName || 'sin nombre')
        } catch (err: any) {
          console.error('[portal:request-link] ERROR enviando email:', err?.message || err, err?.name)
        }
      }
    }
  } catch (err: any) {
    console.error('[portal:request-link] error creando magic link:', err?.message || err)
  }

  return NextResponse.json({ ok: true })
}
