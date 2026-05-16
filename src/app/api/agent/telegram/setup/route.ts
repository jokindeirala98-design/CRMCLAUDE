/**
 * GET /api/agent/telegram/setup
 *
 * Registra el webhook del bot del agente con Telegram. Lo ejecutas UNA VEZ
 * tras configurar TELEGRAM_AGENT_BOT_TOKEN y TELEGRAM_AGENT_WEBHOOK_SECRET.
 *
 * Acceso: solo si pasas ?token=<AGENT_INTERNAL_TOKEN>.
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const expected = process.env.AGENT_INTERNAL_TOKEN
  if (expected && token !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const botToken = process.env.TELEGRAM_AGENT_BOT_TOKEN
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_AGENT_BOT_TOKEN no configurado' }, { status: 500 })
  }

  const secret = process.env.TELEGRAM_AGENT_WEBHOOK_SECRET
  const baseUrl = process.env.AGENT_API_BASE_URL ||
    `https://${process.env.VERCEL_URL || req.headers.get('host')}`
  const webhookUrl = `${baseUrl}/api/agent/telegram`

  const body: any = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  }
  if (secret) body.secret_token = secret

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()

  // Info actual del webhook
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`)
  const info = await infoRes.json()

  return NextResponse.json({
    setWebhook: data,
    webhookInfo: info,
    configuredUrl: webhookUrl,
  })
}
