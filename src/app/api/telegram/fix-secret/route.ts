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

  // Debug: show env presence (not the actual values)
  const debugEnv = {
    hasBotToken: !!token,
    hasSecret: !!secret,
    secretLength: secret?.length ?? 0,
    appUrl,
  }

  // Step 1: Delete the existing webhook first (Telegram doesn't update secret_token on an already-set webhook)
  const deleteRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: false }),
  })
  const deleteData = await deleteRes.json()

  // Step 2: Re-register with secret_token
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

  return NextResponse.json({ debugEnv, deleteWebhook: deleteData, setWebhook: data, webhookInfo: info.result })
}
