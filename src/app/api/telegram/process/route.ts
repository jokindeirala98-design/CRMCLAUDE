import { NextRequest, NextResponse } from 'next/server'
import { processTelegramInboxItem } from '@/lib/telegram-process'

/**
 * POST /api/telegram/process
 *
 * Manual/fallback endpoint to process a single telegram_inbox item.
 * The main processing now happens inline in the webhook, but this
 * route can be used to retry failed items or process pending ones.
 */
export async function POST(req: NextRequest) {
  try {
    const { inbox_id } = await req.json()
    if (!inbox_id) {
      return NextResponse.json({ error: 'inbox_id required' }, { status: 400 })
    }

    const result = await processTelegramInboxItem(inbox_id)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (err: any) {
    console.error('[TelegramProcess] Unexpected error:', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
