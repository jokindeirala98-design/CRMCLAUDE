import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/health-gemini
 *
 * Daily cron that tests the Gemini API key and sends a Telegram alert if it's broken.
 * Triggered by Vercel Cron at 08:00 every morning.
 * Also tests Claude fallback availability.
 */
export async function GET(req: NextRequest) {
  // Vercel cron requests have the Authorization header set automatically
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, string> = {}

  // ── Test Gemini ────────────────────────────────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  if (!geminiKey) {
    results.gemini = 'NO_KEY'
  } else {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply: {"ok":true}' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 10 },
          }),
          signal: AbortSignal.timeout(8000),
        }
      )
      if (res.ok) {
        results.gemini = 'OK'
      } else {
        const d = await res.json().catch(() => ({}))
        results.gemini = `ERROR_${res.status}: ${d?.error?.message || 'unknown'}`
      }
    } catch (e: any) {
      results.gemini = `NETWORK_ERROR: ${e?.message}`
    }
  }

  // ── Test Claude fallback ───────────────────────────────────────────────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    results.claude = 'NO_KEY'
  } else {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Reply: {"ok":true}' }],
        }),
        signal: AbortSignal.timeout(8000),
      })
      results.claude = res.ok ? 'OK' : `ERROR_${res.status}`
    } catch (e: any) {
      results.claude = `NETWORK_ERROR: ${e?.message}`
    }
  }

  // ── Get admin Telegram chat ID from Supabase ──────────────────────────────
  const geminiOk = results.gemini === 'OK'
  const claudeOk = results.claude === 'OK'
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  let adminChatId: string | null = null
  if (botToken) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      const { data } = await supabase
        .from('users_profile')
        .select('telegram_chat_id')
        .eq('role', 'admin')
        .not('telegram_chat_id', 'is', null)
        .limit(1)
        .single()
      adminChatId = data?.telegram_chat_id || null
    } catch { /* no admin linked to Telegram yet */ }
  }

  if (botToken && adminChatId && (!geminiOk || !claudeOk)) {
    const lines: string[] = ['⚠️ *Alerta diaria — Extractores de IA*\n']

    if (!geminiOk) {
      lines.push(`🔴 *Gemini:* ${results.gemini}`)
      lines.push('→ Ve a aistudio\\.google\\.com → crea nueva API key → actualiza GEMINI_API_KEY en Vercel')
    } else {
      lines.push('✅ *Gemini:* OK')
    }

    if (!claudeOk) {
      lines.push(`🔴 *Claude (respaldo):* ${results.claude}`)
      if (results.claude === 'NO_KEY') {
        lines.push('→ Añade ANTHROPIC\\_API\\_KEY en Vercel para tener extractor de respaldo')
      }
    } else if (claudeOk) {
      lines.push('✅ *Claude (respaldo):* OK')
    }

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: lines.join('\n'),
        parse_mode: 'MarkdownV2',
      }),
    }).catch(() => null)
  } else if (botToken && adminChatId && geminiOk && claudeOk) {
    // Optional: daily confirmation that everything is fine
    // Uncomment if you want a daily "all OK" message:
    // await fetch(...sendMessage with "✅ Extractores OK")
  }

  return NextResponse.json({
    ok: geminiOk,
    results,
    timestamp: new Date().toISOString(),
  })
}
