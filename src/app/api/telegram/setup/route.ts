import { NextRequest, NextResponse } from 'next/server'
import { setWebhook, getWebhookInfo, deleteWebhook } from '@/lib/telegram'

/**
 * GET /api/telegram/setup — Check webhook status
 * POST /api/telegram/setup — Register webhook with Telegram
 * DELETE /api/telegram/setup — Remove webhook
 */

export async function GET() {
  try {
    const info = await getWebhookInfo()
    return NextResponse.json({ ok: true, webhook: info })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const appUrl = body.url || process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)

    if (!appUrl) {
      return NextResponse.json(
        { error: 'No app URL configured. Set NEXT_PUBLIC_APP_URL or VERCEL_URL.' },
        { status: 400 }
      )
    }

    const webhookUrl = `${appUrl}/api/telegram/webhook`
    await setWebhook(webhookUrl)

    return NextResponse.json({ ok: true, webhookUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    await deleteWebhook()
    return NextResponse.json({ ok: true, message: 'Webhook removed' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
