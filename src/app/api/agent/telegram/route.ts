/**
 * Webhook del bot Telegram del Agente IA Comercial.
 *
 * Diferente del bot de facturas existente (/api/telegram). Este SOLO atiende
 * a comerciales autorizados (whitelist en agent_authorized_users) y orquesta
 * el agente comercial.
 *
 * Flujo:
 *  1) Verifica X-Telegram-Bot-Api-Secret-Token contra TELEGRAM_AGENT_WEBHOOK_SECRET.
 *  2) Si llega `callback_query` (botón inline) → procesa acción (enviar/editar/cancelar correo).
 *  3) Si llega `message` con voz → descarga audio → transcribe → llama a /chat.
 *  4) Si llega `message` con texto → llama a /chat.
 *  5) Responde al usuario por Telegram. Si hay emailPreview → muestra preview con botones.
 *
 * Para configurar:
 *   1) Crear segundo bot en BotFather → guardar token en TELEGRAM_AGENT_BOT_TOKEN.
 *   2) Generar secret aleatorio → TELEGRAM_AGENT_WEBHOOK_SECRET.
 *   3) POST a /api/agent/telegram/setup (creado aparte) para registrar webhook.
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

async function answerCallback(callbackQueryId: string, text?: string) {
  return tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text })
}

async function editMessage(chatId: number, messageId: number, text: string, replyMarkup?: any) {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  })
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
// CALLBACK HANDLERS — botones inline del preview de email
// ───────────────────────────────────────────────────────────────────────────

interface PendingEmailRow {
  id: string
  to_email: string
  subject: string
  body: string
  cliente_id: string | null
  conversation_id: string
  telegram_user_id: number
}

async function loadPendingEmail(conversationId: string): Promise<PendingEmailRow | null> {
  // Buscamos el último tool_result de gmail_preview_correo en esa conversación
  const sb = admin()
  const { data } = await sb
    .from('agent_messages')
    .select('id, tool_result, conversation_id')
    .eq('conversation_id', conversationId)
    .eq('role', 'tool')
    .eq('tool_name', 'gmail_preview_correo')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data || !data.tool_result?.ok) return null
  const r = data.tool_result.result || data.tool_result
  return {
    id: data.id,
    to_email: r.to,
    subject: r.subject,
    body: r.body,
    cliente_id: r.cliente_id,
    conversation_id: data.conversation_id,
    telegram_user_id: 0,
  }
}

async function handleCallback(cb: any) {
  const data: string = cb.data || ''
  const chatId = cb.message?.chat?.id
  const messageId = cb.message?.message_id
  const userId = cb.from?.id
  if (!chatId || !userId) return

  const [action, conversationId] = data.split(':')

  if (action === 'email_send') {
    await answerCallback(cb.id, 'Enviando…')
    try {
      const pending = await loadPendingEmail(conversationId)
      if (!pending) {
        await editMessage(chatId, messageId, '⚠️ No hay borrador pendiente.')
        return
      }
      const baseUrl =
        process.env.AGENT_API_BASE_URL ||
        `https://${process.env.VERCEL_URL || 'voltis-crm-bueno.vercel.app'}`
      const sendRes = await fetch(`${baseUrl}/api/agent/gmail/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.AGENT_INTERNAL_TOKEN ? { 'x-internal-token': process.env.AGENT_INTERNAL_TOKEN } : {}),
        },
        body: JSON.stringify({
          telegramUserId: userId,
          to: pending.to_email,
          subject: pending.subject,
          body: pending.body,
          clienteId: pending.cliente_id,
          conversationId,
        }),
      })
      if (sendRes.ok) {
        await editMessage(chatId, messageId, `✅ Correo enviado a <code>${pending.to_email}</code>`)
      } else {
        const err = await sendRes.text()
        await editMessage(chatId, messageId, `❌ Error al enviar:\n<code>${err.slice(0, 300)}</code>\n\nVerifica que has conectado Gmail con /conectar_gmail`)
      }
    } catch (e: any) {
      await editMessage(chatId, messageId, `❌ Error: ${e?.message || 'desconocido'}`)
    }
    return
  }

  if (action === 'email_cancel') {
    await answerCallback(cb.id, 'Cancelado')
    await editMessage(chatId, messageId, '🚫 Borrador descartado.')
    return
  }

  if (action === 'email_edit') {
    await answerCallback(cb.id, 'Vale, dime los cambios')
    await sendMessage(chatId, 'Dime qué cambios hacer al borrador y te lo reescribo.')
    return
  }

  await answerCallback(cb.id)
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
  if (text.startsWith('/start')) {
    await sendMessage(chatId,
      `Hola ${commercialName} 👋\n\nSoy tu asistente comercial. Pregúntame cualquier cosa sobre venta consultiva, redacta correos a clientes, o pide preparación de reunión.\n\n<b>Ejemplos:</b>\n• <i>Tengo un CFO que dice que somos caros, ¿cómo respondo?</i>\n• <i>Redacta un correo a juan@empresa.com para hacer follow-up</i>\n• <i>Prepárame la reunión de mañana con Unice Toys</i>\n\nTambién puedes mandarme notas de voz.`)
    return
  }
  if (text.startsWith('/conectar_gmail')) {
    const baseUrl =
      process.env.AGENT_API_BASE_URL ||
      `https://${process.env.VERCEL_URL || 'voltis-crm-bueno.vercel.app'}`
    await sendMessage(chatId,
      `Para conectar tu Gmail, abre este enlace:\n${baseUrl}/api/agent/gmail/connect?u=${userId}\n\nAutoriza el acceso y vuelve aquí.`)
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

    // Si hay preview de email → mostrarlo con botones inline
    if (result.emailPreview) {
      const p = result.emailPreview
      const preview = `📧 <b>Borrador de correo</b>\n\n<b>Para:</b> <code>${p.to}</code>\n<b>Asunto:</b> ${p.subject}\n\n<b>Cuerpo:</b>\n${p.body.slice(0, 2500)}`
      await sendMessage(chatId, preview, {
        inline_keyboard: [
          [
            { text: '✅ Enviar', callback_data: `email_send:${result.conversationId}` },
            { text: '✏️ Editar', callback_data: `email_edit:${result.conversationId}` },
            { text: '🚫 Cancelar', callback_data: `email_cancel:${result.conversationId}` },
          ],
        ],
      })
      return
    }

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
    if (update.callback_query) {
      await handleCallback(update.callback_query)
    } else if (update.message) {
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
