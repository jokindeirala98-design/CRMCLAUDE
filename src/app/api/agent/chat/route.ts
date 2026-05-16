/**
 * POST /api/agent/chat
 *
 * Endpoint principal del agente comercial. Recibe un mensaje de un comercial
 * (con su Telegram user id) y devuelve la respuesta del agente tras orquestar
 * tool calling con Gemini.
 *
 * Body JSON:
 *  {
 *    telegramUserId: number,           // ID del comercial (whitelist check)
 *    message: string,                  // texto del usuario
 *    transcript?: string,              // si vino de audio, transcripción
 *    conversationId?: string,          // para continuar conversación existente
 *    referencedClientId?: string,      // si ya se sabe sobre qué cliente
 *  }
 *
 * Seguridad:
 *  - Verifica que el telegramUserId está en agent_authorized_users (active=true)
 *    o en la env var TELEGRAM_AGENT_AUTHORIZED_IDS como fallback.
 *  - Header X-Internal-Token requerido si la llamada NO viene del bot
 *    (para evitar uso externo).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runChat, type ChatRequest } from '@/lib/agent/orchestrator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function isAuthorized(telegramUserId: number): Promise<{ ok: boolean; name?: string }> {
  // 1) Tabla agent_authorized_users
  const sb = admin()
  const { data } = await sb
    .from('agent_authorized_users')
    .select('name, active')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()
  if (data?.active) return { ok: true, name: data.name }

  // 2) Fallback: env var CSV
  const csv = process.env.TELEGRAM_AGENT_AUTHORIZED_IDS || ''
  const ids = csv.split(',').map(s => Number(s.trim())).filter(Boolean)
  if (ids.includes(telegramUserId)) return { ok: true, name: 'piloto' }

  return { ok: false }
}

export async function POST(req: NextRequest) {
  // Protección contra uso externo: header secreto si no viene del bot
  // (el bot añade automáticamente x-internal-token = AGENT_INTERNAL_TOKEN)
  const internalToken = req.headers.get('x-internal-token')
  const expectedToken = process.env.AGENT_INTERNAL_TOKEN
  if (expectedToken && internalToken !== expectedToken) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: ChatRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  if (!body.telegramUserId || !body.message) {
    return NextResponse.json({ error: 'Faltan telegramUserId o message' }, { status: 400 })
  }

  // Whitelist
  const auth = await isAuthorized(body.telegramUserId)
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'No autorizado. Pide a admin@voltis que te añada a agent_authorized_users.' },
      { status: 403 },
    )
  }

  try {
    const t0 = Date.now()
    const res = await runChat({
      ...body,
      commercialName: body.commercialName || auth.name,
    })
    return NextResponse.json({
      ...res,
      totalEndpointMs: Date.now() - t0,
    })
  } catch (e: any) {
    console.error('[agent/chat] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Error interno', stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined },
      { status: 500 },
    )
  }
}
