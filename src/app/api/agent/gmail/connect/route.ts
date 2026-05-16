/**
 * GET /api/agent/gmail/connect?u={telegramUserId}
 *
 * Inicia el flow OAuth de Google. Redirige al comercial al login de Google
 * para que autorice envío de correos en su nombre.
 *
 * El `state` lleva el telegramUserId firmado para que el callback sepa quién
 * está conectando sin confiar en cookies.
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildAuthUrl } from '@/lib/agent/gmail'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function signState(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const secret = process.env.AGENT_INTERNAL_TOKEN || 'no-secret'
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const telegramUserId = Number(url.searchParams.get('u'))
  if (!telegramUserId) {
    return NextResponse.json({ error: 'Falta ?u=telegramUserId' }, { status: 400 })
  }

  const baseUrl = process.env.AGENT_API_BASE_URL ||
    `${url.protocol}//${req.headers.get('host')}`
  const redirectUri = `${baseUrl}/api/agent/gmail/callback`

  const state = signState({ u: telegramUserId, t: Date.now() })

  try {
    const authUrl = buildAuthUrl(redirectUri, state)
    return NextResponse.redirect(authUrl)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
