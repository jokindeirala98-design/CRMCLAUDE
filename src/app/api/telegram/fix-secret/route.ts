/**
 * POST /api/telegram/fix-secret
 * One-time helper: re-registers the Telegram webhook WITH the secret_token.
 * Call once, then delete this file.
 */
import { NextResponse } from 'next/server'

export async function POST() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'

  if (!token) return NextResponse.json({ error: 'No TELEGRAM_BOT_TOKEN' }, { status: 500 })

  const body: Record<string, unknown> = {
    url: `${appUrl}/api/telegram/webhook`,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  }
  if (secret) body.secret_token = secret

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()

  // Verify
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
  const info = await infoRes.json()

  return NextResponse.json({ setWebhook: data, webhookInfo: info.result })
}
