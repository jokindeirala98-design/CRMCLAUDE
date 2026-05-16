/**
 * GET /api/agent/gmail/callback
 *
 * Google redirige aquí con `code` y `state`. Intercambiamos por tokens y los
 * guardamos cifrados en gmail_credentials.
 */
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, saveGmailCredentials, fetchUserEmail } from '@/lib/agent/gmail'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifyState(state: string): { ok: boolean; telegramUserId?: number } {
  const [data, sig] = state.split('.')
  if (!data || !sig) return { ok: false }
  const secret = process.env.AGENT_INTERNAL_TOKEN || 'no-secret'
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  if (sig !== expected) return { ok: false }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'))
    // Estado válido 10 min
    if (Date.now() - payload.t > 10 * 60 * 1000) return { ok: false }
    return { ok: true, telegramUserId: Number(payload.u) }
  } catch {
    return { ok: false }
  }
}

function html(message: string, ok: boolean) {
  const color = ok ? '#1F3A2E' : '#B91C1C'
  const emoji = ok ? '✅' : '❌'
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Voltis · Gmail</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; text-align: center; background: #f7f5ef;">
<div style="max-width: 480px; margin: 0 auto; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.08);">
<div style="font-size: 48px;">${emoji}</div>
<h1 style="color: ${color}; margin-top: 12px;">${ok ? 'Gmail conectado' : 'No se pudo conectar Gmail'}</h1>
<p style="color: #4a4a4a;">${message}</p>
<p style="color: #888; font-size: 14px; margin-top: 24px;">Ya puedes cerrar esta ventana y volver a Telegram.</p>
</div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') || ''
  const error = url.searchParams.get('error')

  if (error) return html(`Google devolvió: ${error}`, false)
  if (!code) return html('Falta el código de autorización.', false)

  const verified = verifyState(state)
  if (!verified.ok || !verified.telegramUserId) {
    return html('State inválido o expirado. Intenta de nuevo con /conectar_gmail.', false)
  }

  const baseUrl = process.env.AGENT_API_BASE_URL ||
    `${url.protocol}//${req.headers.get('host')}`
  const redirectUri = `${baseUrl}/api/agent/gmail/callback`

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    if (!tokens.refresh_token) {
      return html('Google no devolvió refresh_token. Revoca el acceso anterior en https://myaccount.google.com/permissions y vuelve a intentarlo.', false)
    }
    const email = await fetchUserEmail(tokens.access_token)
    await saveGmailCredentials({
      telegramUserId: verified.telegramUserId,
      gmailAddress: email,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresInSec: tokens.expires_in,
    })
    return html(`Tu cuenta <b>${email}</b> está lista para enviar correos desde el agente.`, true)
  } catch (e: any) {
    return html(`Error: ${e?.message || 'desconocido'}`, false)
  }
}
