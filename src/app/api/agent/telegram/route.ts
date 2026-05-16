/**
 * Webhook del bot Telegram del Agente IA Comercial.
 *
 * v2 (mayo 2026): puro asistente de consulta. El bot NO envía correos.
 * Solo responde dudas de comerciales con estilo Alfonso & Christian:
 * técnicas de venta, redacción de correos cortos, manejo de objeciones,
 * preparación de reuniones, etc.
 *
 * Flujo:
 *  1) Verifica X-Telegram-Bot-Api-Secret-Token contra TELEGRAM_AGENT_WEBHOOK_SECRET.
 *  2) Si llega `message` con voz → descarga audio → transcribe → llama a /chat.
 *  3) Si llega `message` con texto → llama a /chat.
 *  4) Responde al usuario por Telegram con la respuesta del agente.
 *
 * Para configurar:
 *   1) Crear bot en BotFather → guardar token en TELEGRAM_AGENT_BOT_TOKEN.
 *   2) Generar secret aleatorio → TELEGRAM_AGENT_WEBHOOK_SECRET.
 *   3) GET /api/agent/telegram/setup para registrar webhook.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { transcribeAudio } from '@/lib/agent/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TG_API = 'https://api.telegram.org/bot'

function agentBotToken(): string {
  // Usamos un bot dedicado al agente para no mezclar con el de facturas.
  // Si no está configurado, fallback al bot principal (no recomendado en prod).
  const t = process.env.TELEGRAM_AGENT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
  if (!t) throw new Error('TELEGRAM_AGENT_BOT_TOKEN no configurado')
  return t
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function tg(method: string, body: any): Promise<any> {
  const res = await fetch(`${TG_API}${agentBotToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) console.error(`[agent-tg] ${method}:`, data)
  return data.result
}

async function sendMessage(chatId: number, text: string, replyMarkup?: any) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup })
}

async function sendChatAction(chatId: number, action = 'typing') {
  return tg('sendChatAction', { chat_id: chatId, action })
}

async function downloadVoice(fileId: string): Promise<Buffer> {
  const t = agentBotToken()
  const fileRes = await fetch(`${TG_API}${t}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  })
  const fileData = await fileRes.json()
  const filePath = fileData?.result?.file_path
  if (!filePath) throw new Error('No pude obtener file_path de Telegram')
  const dlRes = await fetch(`https://api.telegram.org/file/bot${t}/${filePath}`)
  if (!dlRes.ok) throw new Error('No pude descargar audio de Telegram')
  return Buffer.from(await dlRes.arrayBuffer())
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS — autorización
// ───────────────────────────────────────────────────────────────────────────

async function isAuthorized(userId: number): Promise<{ ok: boolean; name?: string }> {
  const sb = admin()
  const { data } = await sb
    .from('agent_authorized_users')
    .select('name, active')
    .eq('telegram_user_id', userId)
    .maybeSingle()
  if (data?.active) return { ok: true, name: data.name }

  const csv = process.env.TELEGRAM_AGENT_AUTHORIZED_IDS || ''
  const ids = csv.split(',').map(s => Number(s.trim())).filter(Boolean)
  if (ids.includes(userId)) return { ok: true, name: 'piloto' }

  return { ok: false }
}

// ───────────────────────────────────────────────────────────────────────────
// FLOW — llamar al agente
// ───────────────────────────────────────────────────────────────────────────

async function callAgent(payload: {
  telegramUserId: number
  commercialName?: string
  message: string
  transcript?: string
  conversationId?: string
  referencedClientId?: string
}): Promise<any> {
  const baseUrl =
    process.env.AGENT_API_BASE_URL ||
    `https://${process.env.VERCEL_URL || 'voltis-crm-bueno.vercel.app'}`
  const internalToken = process.env.AGENT_INTERNAL_TOKEN

  const res = await fetch(`${baseUrl}/api/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalToken ? { 'x-internal-token': internalToken } : {}),
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Agent /chat ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

// ───────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ───────────────────────────────────────────────────────────────────────────

async function handleMessage(msg: any) {
  const chatId = msg.chat?.id
  const userId = msg.from?.id
  const userName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim()
  if (!chatId || !userId) return

  // Whitelist
  const auth = await isAuthorized(userId)
  if (!auth.ok) {
    await sendMessage(chatId,
      `🚫 No estás autorizado a usar el agente comercial.\n\nTu Telegram ID es <code>${userId}</code>. Pide a un admin que te añada.`)
    return
  }
  const commercialName = auth.name || userName || `tg:${userId}`

  // Comandos básicos
  const text: string = msg.text || ''
  if (text.startsWith('/start') || text.startsWith('/help') || text.startsWith('/ayuda')) {
    await sendMessage(chatId,
      `Hola ${commercialName}. Soy tu asistente comercial entrenado en la metodología de Alfonso &amp; Christian aplicada a Voltis.\n\nPregúntame cualquier cosa sobre venta consultiva, manejo de objeciones, redacción de correos, preparación de reuniones. Te respondo con técnicas concretas.\n\n<b>Ejemplos:</b>\n• <i>Tengo un CFO que dice que somos caros, ¿cómo respondo?</i>\n• <i>Redáctame un correo corto a Antonio del ayuntamiento para retomar la propuesta</i>\n• <i>Prepárame la reunión de mañana con Unice Toys</i>\n• <i>¿Cómo abro una llamada en frío?</i>\n\nTambién puedes mandarme notas de voz.\n\n<i>Los correos que te dé son borradores cortos para que copies y envíes tú desde tu Gmail. Yo no envío nada.</i>`)
    return
  }
  if (text.startsWith('/whoami') || text.startsWith('/id')) {
    await sendMessage(chatId, `Tu Telegram ID es <code>${userId}</code>\nNombre registrado: ${commercialName}`)
    return
  }

  // Procesar mensaje (texto o voz)
  await sendChatAction(chatId, 'typing')

  let messageText = text
  let transcript: string | undefined

  if (msg.voice || msg.audio) {
    const fileId = msg.voice?.file_id || msg.audio?.file_id
    try {
      const buf = await downloadVoice(fileId)
      transcript = await transcribeAudio(buf, msg.voice ? 'audio/ogg' : 'audio/mp3')
      messageText = transcript
      await sendMessage(chatId, `🎤 He transcrito tu audio:\n<i>"${transcript.slice(0, 300)}${transcript.length > 300 ? '…' : ''}"</i>`)
      await sendChatAction(chatId, 'typing')
    } catch (e: any) {
      await sendMessage(chatId, `❌ No pude transcribir el audio: ${e?.message}`)
      return
    }
  }

  if (!messageText || !messageText.trim()) {
    await sendMessage(chatId, '¿Qué necesitas? Escríbeme o mándame una nota de voz.')
    return
  }

  // Llamar al agente
  try {
    const result = await callAgent({
      telegramUserId: userId,
      commercialName,
      message: messageText,
      transcript,
    })

    // Respuesta normal
    const reply = result.text || '…'
    // Telegram limita a 4096 chars
    for (let i = 0; i < reply.length; i += 4000) {
      await sendMessage(chatId, reply.slice(i, i + 4000))
    }
  } catch (e: any) {
    console.error('[agent-tg] error llamando a /chat:', e)
    await sendMessage(chatId, `❌ Error: ${e?.message || 'desconocido'}`)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// WEBHOOK ENTRY POINT
// ───────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Verificar secret de Telegram
  const expectedSecret = process.env.TELEGRAM_AGENT_WEBHOOK_SECRET
  if (expectedSecret) {
    const got = req.headers.get('x-telegram-bot-api-secret-token')
    if (got !== expectedSecret) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  let update: any
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  try {
    if (update.message) {
      await handleMessage(update.message)
    }
  } catch (e: any) {
    console.error('[agent-tg] error:', e)
  }

  // Responder 200 siempre para que Telegram no reenvíe
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({
    service: 'agent-telegram-webhook',
    instructions: 'POST aquí desde Telegram. Configura con /api/agent/telegram/setup.',
  })
}
