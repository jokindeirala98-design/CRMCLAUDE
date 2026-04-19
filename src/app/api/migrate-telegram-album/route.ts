import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/migrate-telegram-album
 *
 * Adds album-buffering columns to telegram_inbox so multi-page Telegram photo
 * albums (e.g. a 2-photo invoice) are analyzed together instead of separately.
 *
 *   media_group_id TEXT  — Telegram album ID shared by all photos in one album
 *   album_processed BOOLEAN DEFAULT FALSE — true once the album has been claimed
 *                                           and sent to Gemini together
 *
 * Safe to call repeatedly (IF NOT EXISTS / idempotent).
 */
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const sql = `
ALTER TABLE telegram_inbox ADD COLUMN IF NOT EXISTS media_group_id TEXT;
ALTER TABLE telegram_inbox ADD COLUMN IF NOT EXISTS album_processed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS telegram_inbox_media_group_idx ON telegram_inbox (media_group_id) WHERE media_group_id IS NOT NULL;
  `.trim()

  const { error } = await supabase.rpc('exec_sql', { query: sql })

  if (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
      manualSQL: `-- Run in Supabase SQL Editor:\n${sql}`,
    })
  }

  return NextResponse.json({ success: true })
}
