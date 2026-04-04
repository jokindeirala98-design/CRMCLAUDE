import { NextRequest, NextResponse } from 'next/server'
import { notify } from '@/lib/notify'

/**
 * POST /api/notify — Create in-app notification + Telegram push.
 *
 * Body: { userId, type, title, message, link?, metadata? }
 *
 * This allows client-side code (informes page, etc.) to create
 * notifications that ALSO push to Telegram, without importing
 * server-only telegram lib on the client.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId, type, title, message, link, metadata } = body

    if (!userId || !type || !title || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await notify({ userId, type, title, message, link, metadata })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[Notify API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
