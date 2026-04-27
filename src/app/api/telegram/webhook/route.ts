import { NextRequest, NextResponse } from 'next/server'
import {
  sendMessage, editMessage, answerCallback, sendChatAction,
  downloadFile, sendDocument, inlineKeyboard, button, createBotSupabase,
} from '@/lib/telegram'
import { processTelegramInboxItem } from '@/lib/telegram-process'
import { analyzeDocument, analyzeInvoice } from '@/lib/gemini'
import { normalizeCups } from '@/lib/utils/cups'
import { fetchSipsForCups } from '@/lib/sips'
import { normalizeTariff } from '@/lib/consumption-utils'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: CallbackQuery
}

interface TelegramMessage {
  message_id: number
  from: { id: number; first_name: string; username?: string }
  chat: { id: number; type: string }
  text?: string
  document?: { file_id: string; file_name?: string; mime_type?: string }
  photo?: { file_id: string; width: number; height: number }[]
  caption?: string
  media_group_id?: string
}

interface CallbackQuery {
  id: string
  from: { id: number }
  message?: { chat: { id: number }; message_id: number; text?: string }
  data?: string
}

/* ─── Conversation state (persisted in Supabase) ─────────────────────────── */
interface ConversationState {
  step: string
  data: Record<string, any>
  expiresAt: number
}

const CONVO_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours — prevents stale client attribution

async function getConvo(chatId: number): Promise<ConversationState | null> {
  try {
    const supabase = createBotSupabase()
    const { data, error } = await supabase
      .from('telegram_conversations')
      .select('step, data, expires_at')
      .eq('chat_id', chatId)
      .single()

    if (error || !data) return null

    if (new Date(data.expires_at).getTime() < Date.now()) {
      await supabase.from('telegram_conversations').delete().eq('chat_id', chatId)
      return null
    }

    return {
      step: data.step,
      data: data.data || {},
      expiresAt: new Date(data.expires_at).getTime(),
    }
  } catch (err) {
    console.error('[Telegram] getConvo error:', err)
    return null
  }
}

async function setConvo(chatId: number, step: string, data: Record<string, any> = {}) {
  try {
    const supabase = createBotSupabase()
    const expiresAt = new Date(Date.now() + CONVO_TTL_MS).toISOString()

    await supabase
      .from('telegram_conversations')
      .upsert({
        chat_id: chatId,
        step,
        data,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'chat_id' })
  } catch (err) {
    console.error('[Telegram] setConvo error:', err)
  }
}

async function clearConvo(chatId: number) {
  try {
    const supabase = createBotSupabase()
    await supabase.from('telegram_conversations').delete().eq('chat_id', chatId)
  } catch (err) {
    console.error('[Telegram] clearConvo error:', err)
  }
}

/* ─── Smart client search ─────────────────────────────────────────────────── */
// Strips legal suffixes, splits into keywords, searches flexibly
const LEGAL_SUFFIXES = /\b(s\.?l\.?u?\.?|s\.?a\.?|s\.?c\.?|s\.?coop\.?|c\.?b\.?|sociedad|limitada|anonima|anónima|cooperativa|comunidad\s+de\s+bienes)\b/gi
const FILLER_WORDS = /\b(de|del|la|las|los|el|y|e|en|con|a)\b/gi
const GENERIC_WORDS = /\b(industria|industrial|industriales|industrias|servicios|servicio|soluciones|solucion|comercial|comerciales|comercio|grafica|graficas|grafico|graficos|tecnologia|tecnologias|tecnico|tecnicos|proyectos|proyecto|construccion|construcciones|obras|obra|gestion|gestiones|consultoria|instalaciones|instalacion|grupo|grupos|internacional|internacionales|nacional|nacionales|iberica|espana|navarra|aragon|cataluna|valencia|asturias|galicia|andalucia)\b/gi

function extractSearchKeywords(text: string): string[] {
  // Remove legal suffixes and filler words
  let cleaned = text
    .replace(LEGAL_SUFFIXES, '')
    .replace(FILLER_WORDS, '')
    .replace(/[.,;:'"()]/g, '')
    .trim()

  // Split into words, filter short ones
  const words = cleaned.split(/\s+/).filter(w => w.length >= 3)

  // Return unique significant words (order-preserving so first = brand name)
  return words.map(w => w.toLowerCase()).filter((w, i, arr) => arr.indexOf(w) === i)
}

/** Brand keywords: same as extractSearchKeywords but also strips generic industry words.
 *  First element is the most distinctive part of the company name. */
function extractBrandKeywords(text: string): string[] {
  let cleaned = text
    .replace(LEGAL_SUFFIXES, '')
    .replace(FILLER_WORDS, '')
    .replace(GENERIC_WORDS, '')
    .replace(/[.,;:'"()]/g, '')
    .trim()
  const words = cleaned.split(/\s+/).filter(w => w.length >= 3)
  return words.map(w => w.toLowerCase()).filter((w, i, arr) => arr.indexOf(w) === i)
}

async function searchClients(
  supabase: any,
  rawQuery: string,
  limit: number = 5
): Promise<any[]> {
  // 1. Try exact/substring match first (includes alias for nickname search)
  const { data: exactMatches } = await supabase
    .from('clients')
    .select('id, name, cif_nif, cif, nif, alias')
    .or(`name.ilike.%${rawQuery}%,alias.ilike.%${rawQuery}%,cif_nif.ilike.%${rawQuery}%,cif.ilike.%${rawQuery}%,nif.ilike.%${rawQuery}%`)
    .limit(limit)

  if (exactMatches?.length) return exactMatches

  // 2. Keyword search — use brand keyword (first non-generic word) as primary
  const keywords = extractSearchKeywords(rawQuery)
  if (keywords.length === 0) return []

  const brandKws = extractBrandKeywords(rawQuery)
  const primaryKeyword = brandKws.length > 0 ? brandKws[0] : keywords[0]

  const { data: keywordMatches } = await supabase
    .from('clients')
    .select('id, name, cif_nif, cif, nif')
    .or(`name.ilike.%${primaryKeyword}%,cif_nif.ilike.%${primaryKeyword}%`)
    .limit(limit * 2)

  if (!keywordMatches?.length) return []

  // Score and filter: require at least 2 keyword matches when there are multiple keywords
  const scored = keywordMatches.map((c: any) => {
    const haystack = `${c.name} ${c.cif_nif || ''} ${c.cif || ''} ${c.nif || ''}`.toLowerCase()
    const score = keywords.filter(k => haystack.includes(k)).length
    return { ...c, score }
  })

  const minScore = keywords.length >= 2 ? 2 : 1
  return scored.filter((c: any) => c.score >= minScore)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit)
}

// For invoice auto-matching: search by holder name AND CIF with keyword splitting
async function findClientByInvoiceData(
  supabase: any,
  holderName: string,
  holderCif: string,
): Promise<any[]> {
  const results: any[] = []

  // 1. CIF/NIF exact match (most reliable)
  if (holderCif) {
    const cleanCif = holderCif.replace(/[\s.-]/g, '').toUpperCase()
    if (cleanCif.length >= 8) {
      const { data } = await supabase
        .from('clients')
        .select('id, name, cif_nif, cif, nif')
        .or(`cif_nif.ilike.%${cleanCif}%,cif.ilike.%${cleanCif}%,nif.ilike.%${cleanCif}%`)
        .limit(3)

      if (data?.length) return data
    }
  }

  // 2. Name keyword search
  if (holderName && holderName !== 'No detectado') {
    const keywords = extractSearchKeywords(holderName)
    if (keywords.length === 0) return []

    // Use brand keyword (first non-generic word) as primary to avoid false positives
    const brandKws = extractBrandKeywords(holderName)
    const primaryKeyword = brandKws.length > 0 ? brandKws[0] : keywords[0]

    const { data: nameMatches } = await supabase
      .from('clients')
      .select('id, name, cif_nif, cif, nif')
      .ilike('name', `%${primaryKeyword}%`)
      .limit(10)

    if (!nameMatches?.length) return []

    // Score matches by how many keywords match; require ≥2 when multiple keywords
    const scored = nameMatches.map((c: any) => {
      const haystack = c.name.toLowerCase()
      const score = keywords.filter(k => haystack.includes(k)).length
      return { ...c, score }
    }).filter((c: any) => c.score > 0)
      .sort((a: any, b: any) => b.score - a.score)

    // Require at least 2 keyword matches when there are multiple keywords
    const minScore = keywords.length >= 2 ? 2 : 1
    return scored.filter((c: any) => c.score >= minScore).slice(0, 5)
  }

  return results
}

/* ─── Main webhook handler ─────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  // ── Security: verify Telegram webhook secret token ──────────────────────
  // Telegram sends the secret (set via setWebhook's secret_token param)
  // in the X-Telegram-Bot-Api-Secret-Token header on every update.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (webhookSecret) {
    const incoming = req.headers.get('x-telegram-bot-api-secret-token') || ''
    if (incoming !== webhookSecret) {
      console.warn('[Telegram Webhook] Invalid secret token — request rejected')
      return NextResponse.json({ ok: false }, { status: 403 })
    }
  }

  try {
    const update: TelegramUpdate = await req.json()

    if (update.callback_query) {
      await handleCallback(update.callback_query)
    } else if (update.message) {
      await handleMessage(update.message)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Telegram Webhook] Error:', err)
    return NextResponse.json({ ok: true })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Voltis CRM Telegram Bot active' })
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MESSAGE HANDLER                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleMessage(msg: TelegramMessage) {
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()

  if (text.startsWith('/')) {
    return handleCommand(msg, text)
  }

  // File received — upload to inbox
  if (msg.document || msg.photo) {
    return handleDocumentFile(msg)
  }

  // Conversation continuation (skip if client is just active with no pending step)
  const convo = await getConvo(chatId)
  if (convo && convo.step !== 'idle' && convo.step !== 'client_active') {
    return handleConvoStep(msg, convo)
  }

  if (!text) return

  // ── "ya" / "listo" → close active client mode ────────────────────────────
  if (/^(ya|listo|fin|hecho|done|ok|stop|salir|cancel|reset)$/i.test(text.trim())) {
    const convo = await getConvo(chatId)
    const activeClient = convo?.data?.clientModeName
    await clearConvo(chatId)
    if (activeClient) {
      return sendMessage(chatId,
        `✅ Sesión de <b>${activeClient}</b> cerrada.\n\nListo para nuevos documentos o clientes.`
      )
    }
    return sendMessage(chatId, '✅ Bot reiniciado. Listo para nuevos documentos.')
  }

  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta con /vincular')

  // ── CUPS detection (must come before CIF/NIF — CUPS starts with "ES") ──────
  const cleanText = text.replace(/[\s.\-()]/g, '').toUpperCase()
  const maybeCups = normalizeCups(cleanText)
  if (maybeCups) {
    return handleCupsText(chatId, maybeCups, user)
  }

  // Detect structured data: CIF, NIF, NIE, IBAN, phone, email
  const isCifPat = /^[A-HJNPQS-W][0-9]{7}[0-9A-J]$/i.test(cleanText)
  const isNifPat = /^[0-9]{8}[TRWAGMYFPDXBNJZSQVHLCKE]$/i.test(cleanText)
  const isNiePat = /^[XYZ][0-9]{7}[TRWAGMYFPDXBNJZSQVHLCKE]$/i.test(cleanText)
  const isIbanPat = /^ES[0-9]{22}$/i.test(cleanText)
  const isPhonePat = /^(\+34)?[6789][0-9]{8}$/.test(text.replace(/[\s.\-()]/g, ''))
  const isEmailPat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)

  if (isCifPat || isNifPat || isNiePat || isIbanPat || isPhonePat || isEmailPat) {
    return handleTextData(chatId, text, user)
  }

  // Otherwise: treat as client name/alias to activate
  if (text.length > 1) {
    return handleClientActivation(chatId, text, user)
  }

  await sendMessage(chatId,
    '👋 Envíame <b>facturas</b> o escribe el <b>nombre de un cliente</b> para activarlo.\n\n' +
    '📋 <b>Flujo habitual:</b>\n' +
    '1. Escribe el nombre del cliente (o parte de él)\n' +
    '2. Envía sus facturas\n' +
    '3. Escribe <b>"ya"</b> cuando termines\n\n' +
    'También puedo procesar facturas sin activar cliente — las identifico automáticamente por CUPS o nombre del titular.\n\n' +
    '⚡ <b>/cancel</b> — reiniciar bot a cero'
  )
}

/* ─── Command router ───────────────────────────────────────────────────────── */
async function handleCommand(msg: TelegramMessage, text: string) {
  const chatId = msg.chat.id
  const [cmd, ...args] = text.split(/\s+/)
  const arg = args.join(' ')

  switch (cmd.toLowerCase()) {
    case '/start':
      if (arg) return handleLinkCode(chatId, arg, msg.from.id)
      return sendMessage(chatId,
        '⚡ <b>Voltis CRM Bot</b>\n\n' +
        'Soy tu asistente. Puedo:\n' +
        '• Guardar <b>documentos</b> que me envíes en tu Bandeja\n' +
        '• Consultar tus <b>clientes y suministros</b>\n' +
        '• Mostrar tus <b>tareas del día</b>\n\n' +
        'Para empezar, vincula tu cuenta con <b>/vincular</b>'
      )

    case '/vincular':
      if (arg) return handleLinkCode(chatId, arg, msg.from.id)
      return sendMessage(chatId,
        '🔗 Para vincular tu cuenta, ve a <b>Ajustes → Telegram</b> en el CRM y copia tu código.\n' +
        'Luego escríbeme:\n<code>/vincular TU_CODIGO</code>'
      )

    case '/cancel':
    case '/reset':
    case '/salir':
      await clearConvo(chatId)
      return sendMessage(chatId,
        '🔄 <b>Bot reiniciado.</b>\n\n' +
        'Todo limpio. Puedes:\n' +
        '• Enviarme facturas directamente\n' +
        '• Escribir el nombre de un cliente para activarlo\n' +
        '• Escribe <b>"ya"</b> cuando termines con un cliente'
      )

    case '/ultimo':
      return handleLastClient(chatId)

    case '/estado':
      if (!arg) return sendMessage(chatId, '🔍 Escribe: <code>/estado CUPS</code>')
      return handleSupplyStatus(chatId, arg)

    case '/nota':
      return handleNoteCommand(chatId, arg)

    case '/mis':
      return handleMySupplies(chatId)

    case '/buscar':
      if (!arg) return sendMessage(chatId, '🔍 Escribe: <code>/buscar nombre o CUPS</code>')
      return handleSearch(chatId, arg)

    case '/pendientes':
      return handlePendingActions(chatId)

    case '/nueva':
      if (!arg) return sendMessage(chatId, '📝 Escribe: <code>/nueva título de la tarea</code>')
      return handleNuevaTarea(chatId, arg)

    case '/semana':
    case '/plan':
      return handleMiSemana(chatId)

    case '/ayuda':
    case '/help':
      return sendMessage(chatId,
        '📖 <b>Comandos disponibles</b>\n\n' +
        '<b>📎 Documentos:</b>\n' +
        '  Envía fotos o PDFs — se guardan en tu Bandeja\n\n' +
        '<b>⚡ Acceso rápido:</b>\n' +
        '/ultimo — Último suministro\n' +
        '/estado [CUPS] — Estado del suministro\n' +
        '/nota [CUPS] [texto] — Nota rápida\n\n' +
        '<b>🔍 Consultas:</b>\n' +
        '/vincular [código] — Vincular cuenta\n' +
        '/mis — Mis suministros pendientes\n' +
        '/buscar [texto] — Buscar cliente/CUPS\n' +
        '/pendientes — Tareas del día\n\n' +
        '<b>📅 Plan semanal:</b>\n' +
        '/nueva [título] — Añadir tarea a la semana\n' +
        '/semana — Ver tus tareas de esta semana'
      )

    default:
      return sendMessage(chatId, '❓ Comando no reconocido. /ayuda para ver opciones.')
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  WEEKLY PLAN COMMANDS                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

function getCurrentWeekMonday(): string {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

async function getActiveWeek(): Promise<{ id: string; starts_at: string; ends_at: string } | null> {
  const supabase = createBotSupabase()
  const monday = getCurrentWeekMonday()
  const { data } = await supabase
    .from('weeks')
    .select('id, starts_at, ends_at')
    .eq('status', 'active')
    .gte('starts_at', monday)
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function handleNuevaTarea(chatId: number, title: string) {
  const user = await getLinkedUser(chatId)
  if (!user) {
    return sendMessage(chatId, '🔒 Vincula tu cuenta con <b>/vincular</b> para usar el plan semanal.')
  }

  const week = await getActiveWeek()
  if (!week) {
    return sendMessage(chatId,
      '⚠️ No hay semana activa esta semana.\n' +
      'Pide a un admin que inicie la semana desde la pestaña <b>Semana</b> en el CRM.'
    )
  }

  const supabase = createBotSupabase()

  // Count existing tasks in inbox for sort_order
  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('week_id', week.id)
    .eq('assigned_to', user.userId)
    .eq('zone', 'inbox')

  await supabase.from('tasks').insert({
    title: title.trim(),
    week_id: week.id,
    assigned_to: user.userId,
    created_by: user.userId,
    zone: 'inbox',
    is_pinned: false,
    origin: 'bot',
    status: 'pending',
    priority: 'medium',
    sort_order: (count || 0),
  })

  return sendMessage(chatId,
    `✅ Tarea añadida a <b>Sin revisar</b>:\n<i>${title.trim()}</i>\n\n` +
    `La puedes mover a tus tareas desde la pestaña <b>Semana</b> en el CRM.`
  )
}

async function handleMiSemana(chatId: number) {
  const user = await getLinkedUser(chatId)
  if (!user) {
    return sendMessage(chatId, '🔒 Vincula tu cuenta con <b>/vincular</b> para ver tu plan semanal.')
  }

  const week = await getActiveWeek()
  if (!week) {
    return sendMessage(chatId,
      '⚠️ No hay semana activa.\nPide a dirección que inicie la semana desde el CRM.'
    )
  }

  const supabase = createBotSupabase()
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, zone, is_focus_today, is_pinned, priority, status')
    .eq('week_id', week.id)
    .eq('assigned_to', user.userId)
    .neq('status', 'completed')
    .order('zone')
    .order('sort_order')

  const allTasks: { title: string; zone: string; is_focus_today: boolean; is_pinned: boolean; priority: string; status: string }[] = tasks || []

  if (allTasks.length === 0) {
    return sendMessage(chatId,
      `📅 <b>Tu semana</b>\n\nNo tienes tareas asignadas esta semana.\n` +
      `Usa <code>/nueva título</code> para añadir una.`
    )
  }

  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const s = new Date(week.starts_at + 'T12:00:00')
  const e = new Date(week.ends_at + 'T12:00:00')
  const weekRange = `${s.getDate()}–${e.getDate()} ${months[e.getMonth()]}`

  const lines: string[] = [`📅 <b>Semana ${weekRange}</b> — ${user.userName.split(' ')[0]}`]

  const director = allTasks.filter(t => t.zone === 'director')
  const mine     = allTasks.filter(t => t.zone === 'mine')
  const inbox    = allTasks.filter(t => t.zone === 'inbox')

  if (director.length > 0) {
    lines.push('\n📌 <b>Fijado por dirección:</b>')
    director.forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}${t.is_focus_today ? ' ☀️' : ''}`))
  }
  if (mine.length > 0) {
    lines.push('\n✏️ <b>Mis tareas:</b>')
    mine.forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}${t.is_focus_today ? ' ☀️' : ''}`))
  }
  if (inbox.length > 0) {
    lines.push(`\n📥 <b>Sin revisar (${inbox.length}):</b>`)
    inbox.slice(0, 4).forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}`))
    if (inbox.length > 4) lines.push(`  <i>... y ${inbox.length - 4} más</i>`)
  }

  lines.push('\n<i>/nueva [título] para añadir una tarea</i>')

  return sendMessage(chatId, lines.join('\n'))
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  LINKING                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleLinkCode(chatId: number, code: string, telegramUserId: number) {
  const supabase = createBotSupabase()

  const { data: link, error } = await supabase
    .from('telegram_links')
    .select('*')
    .eq('link_code', code.trim().toUpperCase())
    .eq('status', 'pending')
    .single()

  if (error || !link) {
    return sendMessage(chatId,
      '❌ Código no válido o expirado.\nGenera uno nuevo en <b>Ajustes → Telegram</b> del CRM.'
    )
  }

  const { error: updateError } = await supabase
    .from('telegram_links')
    .update({
      telegram_chat_id: chatId,
      telegram_user_id: telegramUserId,
      status: 'active',
      linked_at: new Date().toISOString(),
    })
    .eq('id', link.id)

  if (updateError) {
    console.error('[Telegram] Link update error:', updateError)
    return sendMessage(chatId, '❌ Error vinculando la cuenta. Inténtalo de nuevo.')
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('full_name')
    .eq('id', link.user_id)
    .single()

  // Keep telegram_chat_id in sync on users_profile for daily briefing cron
  await supabase
    .from('users_profile')
    .update({ telegram_chat_id: String(chatId) })
    .eq('id', link.user_id)
    .catch(() => {})

  return sendMessage(chatId,
    `✅ ¡Cuenta vinculada correctamente!\n\n` +
    `Bienvenido, <b>${profile?.full_name || 'comercial'}</b>.\n\n` +
    `Ahora puedes enviarme documentos y se guardarán automáticamente en tu Bandeja. 📥`
  )
}

async function getLinkedUser(chatId: number): Promise<{ userId: string; userName: string } | null> {
  const supabase = createBotSupabase()
  const { data } = await supabase
    .from('telegram_links')
    .select('user_id, users_profile:users_profile(full_name)')
    .eq('telegram_chat_id', chatId)
    .eq('status', 'active')
    .single()

  if (!data) return null
  return {
    userId: data.user_id,
    userName: (data as any).users_profile?.full_name || 'Comercial',
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  DOCUMENT PROCESSING — WITH MULTI-PAGE (MEDIA GROUP) SUPPORT             */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleDocumentFile(msg: TelegramMessage) {
  const chatId = msg.chat.id

  const user = await getLinkedUser(chatId)
  if (!user) {
    return sendMessage(chatId, '🔒 Vincula tu cuenta con <b>/vincular</b> para procesar documentos.')
  }

  // Extract file info
  let fileId: string
  let fileType: 'pdf' | 'image' = 'image'
  let fileName = 'file'

  if (msg.document) {
    fileId = msg.document.file_id
    fileName = msg.document.file_name || 'document'
    const mime = msg.document.mime_type || ''
    fileType = mime.includes('pdf') ? 'pdf' : 'image'
  } else if (msg.photo?.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id
    fileType = 'image'
    fileName = 'photo.jpg'
  } else {
    return sendMessage(chatId, '❌ No pude detectar el archivo. Envía una foto o PDF.')
  }

  const isTelegramPhoto = !!msg.photo
  const mimeType = fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'
  const mediaGroupId = msg.media_group_id

  try {
    // Download file from Telegram
    console.log(`[Telegram] Downloading file ${fileId}${mediaGroupId ? ` (group ${mediaGroupId})` : ''} for user ${user.userId}`)
    const { buffer, fileName: dlFileName } = await downloadFile(fileId)
    console.log(`[Telegram] Downloaded ${buffer.length} bytes`)
    const base64 = Buffer.from(buffer).toString('base64')

    // Prepare upload path and extension
    const ext = fileType === 'pdf' ? 'pdf' : 'jpg'
    const safeFileId = fileId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)
    const timestamp = Date.now()
    const storagePath = `telegram/${user.userId}/${timestamp}_${safeFileId}.${ext}`
    const contentType = fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'

    // Upload to Supabase storage
    const supabase = createBotSupabase()
    const fileData = new Uint8Array(buffer)

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, fileData, { contentType, upsert: true })

    if (uploadError) {
      console.error('[Telegram] Upload error:', JSON.stringify(uploadError))
      return sendMessage(chatId, `❌ Error subiendo documento: ${uploadError.message || 'Error de storage'}`)
    }

    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
    console.log(`[Telegram] Uploaded to ${storagePath}`)

    const senderName = msg.from
      ? [msg.from.first_name, msg.from.username ? `(@${msg.from.username})` : ''].filter(Boolean).join(' ')
      : 'Desconocido'

    const { data: insertedRow, error: insertError } = await supabase.from('telegram_inbox').insert({
      user_id: user.userId,
      chat_id: chatId,
      sender_name: senderName,
      file_url: urlData.publicUrl,
      file_type: fileType,
      file_name: dlFileName || fileName,
      status: 'pending',
      created_at: new Date().toISOString(),
    }).select('id').single()

    if (insertError || !insertedRow) {
      console.error('[Telegram] Insert error:', JSON.stringify(insertError))
      return sendMessage(chatId, `❌ Error guardando: ${insertError?.message || 'Error DB'}`)
    }

    const now = Date.now()

    // ── Acknowledgement debounce ──────────────────────────────────────────────
    const convo = await getConvo(chatId) || { step: 'idle', data: {}, expiresAt: 0 }
    const DEBOUNCE_MS = 5000
    const lastNotifAt = convo.data?.last_notif_at || 0
    const fileCount = (convo.data?.pending_file_count || 0) + 1

    if (now - lastNotifAt > DEBOUNCE_MS) {
      await setConvo(chatId, convo.step, { ...(convo.data || {}), last_notif_at: now, pending_file_count: 1 })
      sendMessage(chatId, `📥 Recibido ✓ — Procesando automáticamente...`).catch(() => {})
    } else {
      await setConvo(chatId, convo.step, { ...(convo.data || {}), pending_file_count: fileCount })
    }

    // ── Multi-page album support ──────────────────────────────────────────────
    // Telegram albums (multiple photos sent together) arrive as separate webhook
    // calls each with the same media_group_id.  For a 2-page invoice (e.g. CUPS
    // on page 2, consumption data on page 1) we MUST send both pages to Gemini
    // together; otherwise extraction is incomplete.
    //
    // Strategy:
    //   1. Tag the inbox item with its media_group_id.
    //   2. Wait 4 s for sibling pages to land in telegram_inbox.
    //   3. Atomically claim all unclaimed pages for this group.
    //   4. Whoever wins the claim downloads all pages and processes them together.
    //   5. The loser (0 rows claimed) exits — it's already handled.
    //
    // Falls back gracefully to single-page if the DB columns don't exist yet
    // (pre-migration) or if this is a non-album photo.
    if (mediaGroupId) {
      // Tag this page with its album id (silent fail if column not yet migrated)
      // Note: Supabase query builder is PromiseLike (has .then) but NOT a full Promise
      // (no .catch) — must use try/await or Promise.resolve().catch()
      try {
        await supabase.from('telegram_inbox')
          .update({ media_group_id: mediaGroupId })
          .eq('id', insertedRow.id)
      } catch { /* ignore — column may not exist yet */ }

      // Run migration the first time an album photo is encountered
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
      fetch(`${appUrl}/api/migrate-telegram-album`, { method: 'POST' }).catch(() => {})

      // Wait for sibling pages to be uploaded to Supabase storage + telegram_inbox
      await new Promise(r => setTimeout(r, 4200))

      try {
        // Atomic claim: flip album_processed=true on ALL unclaimed rows for this group
        const { data: claimedPages, error: claimError } = await supabase
          .from('telegram_inbox')
          .update({ album_processed: true })
          .eq('media_group_id', mediaGroupId)
          .eq('user_id', user.userId)
          .eq('album_processed', false)
          .select('id, file_url, file_type, created_at')

        if (claimError) {
          // Columns not yet available (migration pending) — process as single page
          console.log(`[Telegram] Album claim failed (migration pending?): ${claimError.message}`)
        } else if (!claimedPages || claimedPages.length === 0) {
          // Another handler already claimed + is processing all pages — nothing to do
          console.log(`[Telegram] Album ${mediaGroupId}: already claimed by sibling handler, skipping`)
          return
        } else if (claimedPages.length > 1) {
          // We claimed multiple pages — download all and analyze together
          console.log(`[Telegram] Album ${mediaGroupId}: claimed ${claimedPages.length} pages, merging`)

          const sorted = [...claimedPages].sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )

          const pageDataArr = await Promise.all(sorted.map(async (page) => {
            if (page.id === insertedRow.id) {
              // Current page — base64 already in memory
              return { base64Data: base64, mimeType, inboxId: page.id }
            }
            // Download sibling page from Supabase storage
            try {
              const resp = await fetch(page.file_url)
              if (!resp.ok) return null
              const buf = await resp.arrayBuffer()
              const b64 = Buffer.from(buf).toString('base64')
              const mime = page.file_type === 'pdf' ? 'application/pdf' : 'image/jpeg'
              return { base64Data: b64, mimeType: mime, inboxId: page.id }
            } catch {
              return null
            }
          }))

          const validPages = pageDataArr.filter(Boolean) as Array<{ base64Data: string; mimeType: string; inboxId: string }>

          if (validPages.length > 1) {
            const [mainPage, ...restPages] = validPages
            const extraPagesForGemini = restPages.map(p => ({ base64Data: p.base64Data, mimeType: p.mimeType }))
            await processAndNotify(chatId, mainPage.inboxId, mainPage.base64Data, mainPage.mimeType, isTelegramPhoto, user, extraPagesForGemini, now)
            return
          }
          // Fallthrough: only 1 valid page after downloads — process single
        }
        // else: claimed exactly 1 page (this one) — process normally below
      } catch (albumErr: any) {
        console.warn(`[Telegram] Album processing error, falling back to single page: ${albumErr.message}`)
      }
    }

    // Single-page processing (non-album or album fallback)
    await processAndNotify(chatId, insertedRow.id, base64, mimeType, isTelegramPhoto, user, [], now)

  } catch (err: any) {
    console.error('[Telegram] Document processing error:', err)
    return sendMessage(chatId, `❌ Error procesando documento: ${err.message || 'Error desconocido'}\nInténtalo de nuevo.`)
  }
}

/**
 * Core process + notify function used by all document flows.
 * Analyzes the document once, then routes to invoice or client-document handler.
 */
async function processAndNotify(
  chatId: number,
  inboxId: string,
  base64: string,
  mimeType: string,
  isTelegramPhoto: boolean,
  user: { userId: string; userName: string },
  extraPages: Array<{ base64Data: string; mimeType: string }>,
  now: number,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'

  try {
    // ── Step 1: classify with analyzeDocument ─────────────────────────────────
    // This tells us if it's a DNI/NIF/CIF/IBAN/contract or an invoice.
    // We need this to correctly route identity documents.
    const analyzed = await analyzeDocument(base64, mimeType, undefined, extraPages.length ? extraPages : undefined)
    const docType = analyzed.documentType // 'factura' | 'nif' | 'cif' | 'iban' | 'contrato' | 'otro'

    // ── Surface Gemini API errors immediately (invalid key, quota, etc.) ──────
    // analyzeDocument catches all Gemini errors and returns { error: '...' } silently.
    // Without this check the bot just shows "No pude leer" with no hint of the real cause.
    if (analyzed.error) {
      const isKeyIssue = /api.?key|unauthorized|401|403|invalid.*key|key.*invalid/i.test(analyzed.error)
      const isOverload = /sobrecarg|high demand|503|overload|try again later/i.test(analyzed.error)
      const isQuota = /quota|rate.?limit|429|resource.?exhaust/i.test(analyzed.error)
      let userMsg: string
      if (isOverload) {
        userMsg = `⏳ <b>Gemini AI sobrecargado</b>\n\nLos servidores de Google están con alta demanda ahora mismo. Espera 1-2 minutos y reenvía el documento.`
      } else if (isKeyIssue) {
        userMsg = `🔑 <b>Error de API Key</b>\n\n<code>${analyzed.error}</code>\n\nActualiza la <b>GEMINI_API_KEY</b> en Vercel → Settings → Environment Variables y haz un nuevo deploy.`
      } else if (isQuota) {
        userMsg = `⏳ <b>Cuota agotada</b>\n\nSe ha agotado la cuota de Gemini. Espera unos minutos o revisa el plan en Google AI Studio.`
      } else {
        userMsg = `⚠️ <b>Error de Gemini AI</b>\n\n<code>${analyzed.error}</code>`
      }
      await sendMessage(chatId, userMsg)
      return
    }

    // ── Step 2: route identity documents (DNI, CIF, IBAN) immediately ────────
    const isDefinitelyNonInvoice = (
      (docType === 'nif' && (analyzed.nif || analyzed.holder_cif_nif)) ||
      (docType === 'cif' && (analyzed.cif || analyzed.holder_cif_nif)) ||
      (docType === 'iban' && analyzed.iban) ||
      (docType === 'contrato')
    )
    if (isDefinitelyNonInvoice) {
      return handleNonInvoiceDocResult(chatId, inboxId, analyzed, user)
    }

    // ── Step 3: check if analyzeDocument returned useful invoice data ─────────
    const hasInvoiceData = !!(
      analyzed.cups ||
      analyzed.tariff ||
      analyzed.comercializadora ||
      analyzed.billing_period ||
      analyzed.economics?.consumoTotalKwh ||
      analyzed.economics?.costeTotalConsumo ||
      (analyzed.economics?.consumo?.length > 0) ||
      (analyzed.economics?.rawLineItems?.length > 0)
    )

    // ── Step 4: if no invoice data, retry with analyzeInvoice (invoice-specific prompt)
    // This covers BN/Naturgy/other formats where the general classifier returns 'otro'
    if (!hasInvoiceData) {
      const invoiceRetry = await analyzeInvoice(base64, mimeType, extraPages.length ? extraPages : undefined)
      const hasRetryData = !!(
        invoiceRetry.cups ||
        invoiceRetry.holder_name ||
        invoiceRetry.tariff ||
        invoiceRetry.comercializadora ||
        invoiceRetry.billing_period ||
        invoiceRetry.economics?.consumoTotalKwh ||
        invoiceRetry.economics?.costeTotalConsumo ||
        (invoiceRetry.economics?.consumo?.length > 0) ||
        (invoiceRetry.economics?.rawLineItems?.length > 0)
      )
      if (!hasRetryData) {
        await sendMessage(chatId,
          '⚠️ <b>No pude leer el documento.</b>\n\n' +
          'No se encontraron datos de factura ni de identificación. Comprueba que:\n' +
          '• Es un PDF de calidad (no una foto de baja resolución)\n' +
          '• La GEMINI_API_KEY en Vercel es válida y está activa\n\n' +
          'Prueba reenviando como archivo PDF adjunto (📎).'
        )
        return
      }
      invoiceRetry.documentType = 'factura'
      Object.assign(analyzed, invoiceRetry)
    } else {
      analyzed.documentType = 'factura'
    }

    // ── Step 5: invoice flow — fetch real filename from inbox ─────────────────
    // (never hardcode 'photo.jpg')
    const { data: inboxMeta } = await createBotSupabase()
      .from('telegram_inbox').select('file_name').eq('id', inboxId).single()
    const realFileName = inboxMeta?.file_name || 'factura.pdf'

    const result = await processTelegramInboxItem(
      inboxId,
      base64,
      mimeType,
      { file_url: '', file_type: mimeType.includes('pdf') ? 'pdf' : 'image', file_name: realFileName, user_id: user.userId },
      extraPages.length > 0 ? extraPages : undefined,
      analyzed,
    )
    console.log(`[Telegram] Process result for ${inboxId}:`, JSON.stringify(result))

    if (result.ok && !result.skipped) {
      try {
        const supabaseNotif = createBotSupabase()
        const { data: cl } = await supabaseNotif.from('clients').select('name, type').eq('id', result.client_id!).single()
        const clientName = cl?.name || ''
        const isAyto = result.client_type === 'ayuntamiento' || cl?.type === 'ayuntamiento'
        const emoji = result.is_existing_supply ? '📂' : '🆕'
        const typeLabel = result.is_existing_supply ? 'Añadida a suministro existente' : 'Nuevo suministro creado'
        const aytoTag = isAyto ? '\n🏛 <i>Ayuntamiento — sincronizando datos SIPS e informe de consumos...</i>' : ''
        const multiPageTag = extraPages.length > 0 ? '\n📄 <i>Procesadas ' + (extraPages.length + 1) + ' páginas juntas</i>' : ''

        const noCupsPhotoHint = (!result.cups && isTelegramPhoto)
          ? '\n\n📎 <i>Sin CUPS detectado. Para mejor extracción, envía la factura como <b>archivo</b> (📎 adjunto) en lugar de como foto.</i>'
          : (!result.cups ? '\n\n⚠️ <i>CUPS no detectado. Verifica la calidad de la imagen o complétalo manualmente en el CRM.</i>' : '')

        await sendMessage(chatId,
          `${emoji} <b>${typeLabel}</b>\n\n` +
          `👤 ${clientName}\n` +
          `🔌 <code>${result.cups || 'Sin CUPS'}</code>${aytoTag}${multiPageTag}${noCupsPhotoHint}\n\n` +
          `<a href="${appUrl}/supplies/${result.supply_id}">Ver suministro →</a>`
        ).catch(() => {})

        // ── Auto-send comparativa Excel files for 2.0TD electricity invoices ──
        // Detect tariff from analyzed doc (already extracted by Gemini)
        const invoiceTariff = (
          analyzed.tariff ||
          analyzed.economics?.tarifa ||
          analyzed.economics?.tariff || ''
        ).toString().trim().toUpperCase()

        const is2TD = /^2\.?0?TD/i.test(invoiceTariff) || invoiceTariff === '2TD'

        if (is2TD && result.supply_id) {
          // Fire-and-forget: generate and send 3 Excel comparativas via bot
          ;(async () => {
            try {
              const supabase2td = createBotSupabase()
              // Fetch supply SIPS data for consumo/potencia
              const { data: supplyData } = await supabase2td
                .from('supplies')
                .select('consumption_data, cups')
                .eq('id', result.supply_id!)
                .single()
              const cd = supplyData?.consumption_data as any
              const cp = cd?.consumoPeriodos || {}
              const pp = cd?.potenciaContratada || {}

              const consumoP1 = Number(cp.P1) || 0
              const consumoP2 = Number(cp.P2) || 0
              const consumoP3 = Number(cp.P3) || 0
              if (!consumoP1 && !consumoP2 && !consumoP3) {
                // No SIPS data yet — skip comparativa
                return
              }

              // Potencia: for 2.0TD SIPS stores P1 = punta, P3 = valle.
              // P2 is often a SIPS artifact (e.g. 3W → 0.003 kW after /1000).
              // Send P3 explicitly; the comparativa API will use it directly for valle.
              const potenciaP1 = Number(pp.P1) || 0
              const potenciaP3 = Number(pp.P3) || 0
              // potenciaP2: first valid (≥ 0.1 kW) value from P2-P6 — fallback for valley
              const potenciaP2 = (['P2', 'P3', 'P4', 'P5', 'P6'] as const)
                .map(k => Number(pp[k]) || 0)
                .find(v => v >= 0.1) ?? potenciaP1

              // Current energy price from invoice — extract per-period when available
              const eco = analyzed.economics as any

              // Per-period prices from consumo[] (Caso 2 = por_periodo, Caso 3 = promocionadas)
              const consumoArr: any[] = eco?.consumo || []
              const epPeriod: Record<string, { kwhSum: number; eurSum: number }> = {}
              for (const c of consumoArr) {
                const p = String(c.periodo || '').toUpperCase()
                if (!['P1','P2','P3'].includes(p)) continue
                const kwh = Number(c.kwh) || 0
                const precio = Number(c.precioKwh) || 0
                if (kwh <= 0 || precio <= 0) continue
                if (!epPeriod[p]) epPeriod[p] = { kwhSum: 0, eurSum: 0 }
                epPeriod[p].kwhSum += kwh
                epPeriod[p].eurSum += kwh * precio
              }
              const epP1 = epPeriod.P1?.kwhSum > 0 ? epPeriod.P1.eurSum / epPeriod.P1.kwhSum : 0
              const epP2 = epPeriod.P2?.kwhSum > 0 ? epPeriod.P2.eurSum / epPeriod.P2.kwhSum : 0
              const epP3 = epPeriod.P3?.kwhSum > 0 ? epPeriod.P3.eurSum / epPeriod.P3.kwhSum : 0

              // Flat fallback: costeMedioKwhNeto or total/kWh
              const currentEnergyPrice =
                Number(eco?.costeMedioKwhNeto) ||
                Number(eco?.costeMedioKwh) ||
                (() => {
                  const tkwh = Number(eco?.consumoTotalKwh) || 0
                  const ten = Number(eco?.costeTotalConsumo) || Number(eco?.costeNetoConsumo) || 0
                  return tkwh > 0 ? ten / tkwh : 0
                })()

              // Use per-period when available, otherwise flat
              const currentEnergyPriceP1 = epP1 > 0 ? epP1 : currentEnergyPrice
              const currentEnergyPriceP2 = epP2 > 0 ? epP2 : currentEnergyPrice
              const currentEnergyPriceP3 = epP3 > 0 ? epP3 : currentEnergyPrice

              // Current power prices from invoice (€/kW·día per period)
              // Path A: use potencia[] rebuilt array (precioKwDia may be null if Gemini didn't extract kw/dias)
              const potArr: any[] = eco?.potencia || []
              const potPrices: Record<string, number> = {}
              const normP = (raw: any) => { const m = String(raw||'').trim().match(/(?:P|[Pp]er[íi]odo\s*)?([1-6])$/i); return m ? `P${m[1]}` : null }
              for (const item of potArr) {
                const p = normP(item.periodo)
                if (!p || !['P1','P2','P3'].includes(p)) continue
                let price = Number(item.precioKwDia) || Number(item.precioKw) || Number(item.precioUnitario) || 0
                if (!price && Number(item.kw) > 0 && Number(item.dias) > 0 && Number(item.total) > 0) {
                  price = Number(item.total) / (Number(item.kw) * Number(item.dias))
                }
                if (price > 0 && price < 5) potPrices[p] = price
              }
              // Path B: if potencia[] prices still zero, sum precioUnitario from rawLineItems per period
              if (!potPrices.P1 && !potPrices.P2 && !potPrices.P3) {
                const rawItems: any[] = eco?.rawLineItems || []
                const potCats = ['potencia_peaje','potencia_cargo','potencia_comercializacion']
                for (const item of rawItems) {
                  if (!potCats.includes(String(item.category||'').toLowerCase())) continue
                  const p = normP(item.periodo)
                  if (!p || !['P1','P2','P3'].includes(p)) continue
                  let price = Number(item.precioUnitario) || 0
                  if (!price && Number(item.kw) > 0 && Number(item.dias) > 0 && Number(item.total) > 0) {
                    price = Number(item.total) / (Number(item.kw) * Number(item.dias))
                  }
                  if (price > 0 && price < 5) potPrices[p] = (potPrices[p] || 0) + price
                }
              }
              const currentPowerP1 = potPrices.P1 || 0
              const currentPowerP2 = potPrices.P2 > 0 ? potPrices.P2 : (potPrices.P3 > 0 ? potPrices.P3 : potPrices.P1 || 0)

              await sendMessage(chatId,
                `📊 <b>Tarifa 2.0TD detectada</b>\n\n` +
                `Generando comparativa de ahorro Voltis con las 3 opciones de tarifa...`
              )

              const tariffKeys = ['tramos', '24h', 'mercado'] as const
              const tariffLabels: Record<string, string> = {
                tramos: '⏰ Tramos Horarios',
                '24h': '☀️ Precio Fijo 24h',
                mercado: '📈 Precio Mercado',
              }

              // ── Compute savings for all 3 tariffs (no Excel yet) ────────────
              const { compute2TDSavings: computeSavings, VOLTIS_TARIFFS_2TD: tariffs2TD } =
                await import('@/lib/voltis-tariffs-2td')

              // Determine if indexed tariff → use flat price for savings computation
              const isIndexedTariff = (() => {
                // Simple heuristic: if all 3 per-period prices differ significantly, indexed
                const eps = [currentEnergyPriceP1, currentEnergyPriceP2, currentEnergyPriceP3].filter(v => v > 0)
                if (eps.length < 2) return false
                const avg = eps.reduce((s, v) => s + v, 0) / eps.length
                const spread = (Math.max(...eps) - Math.min(...eps)) / avg
                return spread > 0.10
              })()
              const ep4savings = isIndexedTariff
                ? { P1: currentEnergyPrice, P2: currentEnergyPrice, P3: currentEnergyPrice }
                : { P1: currentEnergyPriceP1, P2: currentEnergyPriceP2, P3: currentEnergyPriceP3 }

              const savingsMap: Record<string, number> = {}
              for (const tariffKey of tariffKeys) {
                try {
                  const s = computeSavings(
                    { P1: consumoP1, P2: consumoP2, P3: consumoP3 },
                    { P1: potenciaP1, P2: potenciaP3 > 0.1 ? potenciaP3 : potenciaP2 },
                    ep4savings,
                    currentPowerP1,
                    currentPowerP2,
                    tariffKey,
                  )
                  savingsMap[tariffKey] = s.savings.totalAnnual
                } catch { /* skip */ }
              }

              // ── Send summary and ask user to pick a tariff ───────────────────
              const supplyUrl = `${appUrl}/supplies/${result.supply_id}`
              const ordered = tariffKeys.map((k, i) => ({
                num: i + 1, key: k,
                label: tariffLabels[k] || k,
                saving: savingsMap[k] ?? 0,
              }))
              ordered.sort((a, b) => b.saving - a.saving)
              // Re-number after sorting
              ordered.forEach((o, i) => { o.num = i + 1 })

              const lines = ordered.map(o => {
                const yr = Math.round(o.saving)
                const mo = Math.round(o.saving / 12)
                const sign = yr >= 0 ? '+' : ''
                const star = o.num === 1 ? ' ⭐' : ''
                return `<b>${o.num}. ${o.label}${star}</b>\n   Ahorro: ${sign}${yr}€/año (${sign}${mo}€/mes)`
              }).join('\n\n')

              await sendMessage(chatId,
                `📊 <b>Comparativa Voltis 2.0TD — ${clientName}</b>\n\n` +
                `${lines}\n\n` +
                `Responde <b>1</b>, <b>2</b> o <b>3</b> para recibir la comparativa Excel de esa tarifa.`
              )

              // ── Store params for later Excel generation ──────────────────────
              await setConvo(chatId, 'waiting_tariff_choice', {
                orderedTariffs: ordered.map(o => o.key),
                titular: clientName,
                cups: result.cups || supplyData?.cups || '',
                consumoP1, consumoP2, consumoP3,
                potenciaP1, potenciaP2, potenciaP3,
                currentEnergyPrice,
                currentEnergyPriceP1, currentEnergyPriceP2, currentEnergyPriceP3,
                currentPowerP1, currentPowerP2,
                supplyUrl,
              })
            } catch (comp2tdErr: any) {
              console.error('[Telegram] 2TD comparativa block error:', comp2tdErr.message)
            }
          })()
        }
      } catch {
        sendMessage(chatId, `✅ Factura procesada → ${result.cups || 'sin CUPS'}`).catch(() => {})
      }
    } else if (!result.ok) {
      sendMessage(chatId, `⚠️ Error procesando: ${result.error || 'desconocido'}`).catch(() => {})
    }
  } catch (processErr: any) {
    console.error(`[Telegram] Inline process error:`, processErr.message)
    sendMessage(chatId, `⚠️ Error en procesamiento: ${processErr.message}`).catch(() => {})
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CUPS HANDLER — detect bare CUPS text and create/show supply              */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleCupsText(chatId: number, cups: string, user: { userId: string; userName: string }) {
  await sendChatAction(chatId, 'typing')
  const supabase = createBotSupabase()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'

  // 1. Check if supply already exists
  const { data: existing } = await supabase
    .from('supplies')
    .select('id, cups, tariff, type, status, client:clients(name)')
    .eq('cups', cups)
    .limit(1)
    .maybeSingle()

  if (existing) {
    const clientName = (existing.client as any)?.name || 'Sin cliente'
    return sendMessage(chatId,
      `🔌 <b>Suministro ya registrado</b>\n\n` +
      `👤 ${clientName}\n` +
      `⚡ <code>${cups}</code>\n` +
      `📊 Tarifa: ${existing.tariff || '-'} · ${existing.type?.toUpperCase() || '-'}\n` +
      `📋 ${getStatusLabel(existing.status)}\n\n` +
      `<a href="${appUrl}/supplies/${existing.id}">Ver en CRM →</a>`
    )
  }

  // 2. Supply doesn't exist — check for active client
  const convo = await getConvo(chatId)
  const clientId = convo?.data?.clientModeId
  const clientName = convo?.data?.clientModeName

  if (!clientId) {
    // Save CUPS and ask for client
    await setConvo(chatId, 'await_cups_client', { cups })
    return sendMessage(chatId,
      `🔌 CUPS detectado: <code>${cups}</code>\n\n` +
      `❓ ¿A qué cliente pertenece este suministro?\n` +
      `Escribe el nombre o CIF del cliente:`
    )
  }

  // 3. Active client found — create supply
  await sendMessage(chatId,
    `⏳ Creando suministro y consultando SIPS...\n` +
    `👤 <b>${clientName}</b> · <code>${cups}</code>`
  )
  return createSupplyFromCups(chatId, cups, clientId, clientName!, user, appUrl, supabase)
}

async function createSupplyFromCups(
  chatId: number,
  cups: string,
  clientId: string,
  clientName: string,
  user: { userId: string; userName: string },
  appUrl: string,
  supabase?: any,
) {
  if (!supabase) supabase = createBotSupabase()

  // Detect supply type from CUPS pattern
  const resolvedType: 'luz' | 'gas' = /^ES\d{4}1\d{11}/i.test(cups) ? 'gas' : 'luz'

  // Fetch SIPS
  const sipsData = await fetchSipsForCups(cups, resolvedType).catch((err) => {
    console.warn(`[telegram/cups] SIPS fetch failed for ${cups}:`, err.message)
    return null
  })

  let tariff = ''
  let detectedType: 'luz' | 'gas' = resolvedType

  if (sipsData?.tariff) {
    tariff = normalizeTariff(sipsData.tariff) || sipsData.tariff
    if (/^RL/i.test(tariff)) detectedType = 'gas'
  }

  // Build consumption_data blob
  const consumptionData = sipsData ? {
    source: 'greening_sips',
    fetched_at: new Date().toISOString(),
    total: sipsData.totalConsumption,
    totalKwh: sipsData.totalConsumptionKwh,
    sips_tariff: sipsData.tariff,
    consumoPeriodos: sipsData.consumoPeriodos,
    potenciaContratada: sipsData.potenciaContratada,
    history: sipsData.consumptionHistory || [],
    maximetroHistory: sipsData.maximetroHistory || [],
    reactivaHistory: sipsData.reactivaHistory || [],
    distribuidora: sipsData.distribuidora,
    codigoPostal: sipsData.codigoPostal,
    provincia: sipsData.provincia,
    municipio: sipsData.municipio,
    cnae: sipsData.cnae,
    tension: sipsData.tension,
    fechaAlta: sipsData.fechaAlta,
    fechaUltimaLectura: sipsData.fechaUltimaLectura,
  } : null

  const addressHint = sipsData?.municipio
    ? [sipsData.municipio, sipsData.provincia].filter(Boolean).join(', ')
    : ''

  // Create supply
  const { data: newSupply, error: supplyErr } = await supabase
    .from('supplies')
    .insert({
      client_id: clientId,
      cups,
      type: detectedType,
      tariff: tariff || '',
      address: addressHint,
      status: 'estudio_en_curso',
      consumption_data: consumptionData,
    })
    .select('id')
    .single()

  if (supplyErr) {
    // Race condition: supply created between check and insert
    if (supplyErr.code === '23505' || supplyErr.message?.includes('unique') || supplyErr.message?.includes('duplicate')) {
      const { data: conflict } = await supabase.from('supplies').select('id').eq('cups', cups).limit(1).single()
      return sendMessage(chatId,
        `ℹ️ El suministro ya existía (creado mientras procesaba).\n\n` +
        `<a href="${appUrl}/supplies/${conflict?.id}">Ver en CRM →</a>`
      )
    }
    console.error('[telegram/cups] Insert error:', supplyErr)
    return sendMessage(chatId, `❌ Error creando suministro: ${supplyErr.message}`)
  }

  const supplyId = newSupply!.id

  // Build confirm message
  let sipsLines = ''
  if (sipsData) {
    const kwh = sipsData.totalConsumptionKwh ? `${Math.round(sipsData.totalConsumptionKwh).toLocaleString('es-ES')} kWh/año` : null
    const cp = sipsData.consumoPeriodos as any
    const cpSum = cp ? (Number(cp.P1)||0)+(Number(cp.P2)||0)+(Number(cp.P3)||0)+(Number(cp.P4)||0)+(Number(cp.P5)||0)+(Number(cp.P6)||0) : 0
    const bestKwh = cpSum > 0 ? `${Math.round(cpSum).toLocaleString('es-ES')} kWh/año` : kwh
    sipsLines =
      `\n📊 Tarifa: ${tariff || '-'}\n` +
      `🏢 Distribuidora: ${sipsData.distribuidora || '-'}\n` +
      (addressHint ? `📍 ${addressHint}\n` : '') +
      (bestKwh ? `💡 Consumo anual: ${bestKwh}\n` : '')
  } else {
    sipsLines = `\n⚠️ Sin datos SIPS disponibles — se actualizarán con las facturas\n`
  }

  await sendMessage(chatId,
    `🆕 <b>Suministro creado</b>\n\n` +
    `👤 ${clientName}\n` +
    `🔌 <code>${cups}</code>${sipsLines}\n` +
    `📄 <i>Envíame facturas cuando las tengas para añadirlas a este suministro.</i>\n\n` +
    `<a href="${appUrl}/supplies/${supplyId}">Ver en CRM →</a>`
  )

  // Fire-and-forget: auto power study
  if (sipsData?.consumptionHistory?.length && sipsData?.potenciaContratada) {
    fetch(`${appUrl}/api/power-study-auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cups,
        clientName,
        potenciaContratada: sipsData.potenciaContratada,
        consumptionHistory: sipsData.consumptionHistory,
        maximetroHistory: sipsData.maximetroHistory || [],
      }),
    }).then(async (r) => {
      if (r.ok) {
        const studyResult = await r.json()
        await supabase.from('supplies')
          .update({ power_study_result: studyResult, updated_at: new Date().toISOString() })
          .eq('id', supplyId)
        console.log(`[telegram/cups] Power study saved for ${supplyId}`)
      }
    }).catch((err) => console.warn('[telegram/cups] Power study error:', err.message))
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CLIENT ACTIVATION BY NAME/ALIAS                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleClientActivation(chatId: number, text: string, user: { userId: string; userName: string }) {
  await sendChatAction(chatId, 'typing')
  const supabase = createBotSupabase()
  const clients = await searchClients(supabase, text)

  if (clients.length === 1) {
    const c = clients[0]
    await setConvo(chatId, 'client_active', { clientModeId: c.id, clientModeName: c.name })
    return sendMessage(chatId,
      `✅ <b>Cliente activo: ${c.name}</b>${c.cif_nif ? ` (${c.cif_nif})` : ''}\n\n` +
      `Todo lo que envíes se asociará a este cliente.\n/salir para cambiar de cliente.`
    )
  }

  if (clients.length > 1 && clients.length <= 6) {
    // Store options in convo — callback_data has 64-byte limit, UUIDs alone are 36 bytes
    await setConvo(chatId, 'pick_client_activate', {
      pickOptions: clients.map((c: any) => ({ id: c.id, name: c.name })),
    })
    const rows = clients.map((c: any, i: number) => [
      button(`${c.alias ? c.alias + ' — ' : ''}${c.name.substring(0, 40)}`, `pick:${i}`)
    ])
    rows.push([button('❌ Cancelar', 'cancel')])
    return sendMessage(chatId,
      `🔍 Encontré ${clients.length} clientes con "<b>${text}</b>":`,
      { replyMarkup: inlineKeyboard(rows) }
    )
  }

  if (clients.length > 6) {
    return sendMessage(chatId, `🔍 Demasiados resultados para "<b>${text}</b>". Sé más específico.`)
  }

  const convo = await getConvo(chatId)
  const activeClient = convo?.data?.clientModeId ? convo.data.clientModeName : null
  return sendMessage(chatId,
    `❓ No encontré ningún cliente con "<b>${text}</b>".\n` +
    (activeClient ? `\nCliente activo: <b>${activeClient}</b>` : '') +
    `\n\nUsa /buscar para buscar.`
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TEXT DATA HANDLER (phone, email, IBAN, CIF, NIF, NIE as plain text)      */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleTextData(chatId: number, text: string, user: { userId: string; userName: string }) {
  const supabase = createBotSupabase()
  const clean = text.replace(/[\s.\-()]/g, '').toUpperCase()

  let dataType: string, fieldName: string, displayLabel: string, emoji: string

  if (/^[A-HJNPQS-W][0-9]{7}[0-9A-J]$/i.test(clean)) {
    dataType = 'cif';  fieldName = 'cif';   displayLabel = 'CIF';      emoji = '🏢'
  } else if (/^[0-9]{8}[TRWAGMYFPDXBNJZSQVHLCKE]$/i.test(clean)) {
    dataType = 'nif';  fieldName = 'nif';   displayLabel = 'NIF';      emoji = '🪪'
  } else if (/^[XYZ][0-9]{7}[TRWAGMYFPDXBNJZSQVHLCKE]$/i.test(clean)) {
    dataType = 'nie';  fieldName = 'nif';   displayLabel = 'NIE';      emoji = '🪪'
  } else if (/^ES[0-9]{22}$/i.test(clean)) {
    dataType = 'iban'; fieldName = 'iban';  displayLabel = 'IBAN';     emoji = '🏦'
  } else if (/^(\+34)?[6789][0-9]{8}$/.test(text.replace(/[\s.\-()]/g, ''))) {
    dataType = 'phone'; fieldName = 'phone'; displayLabel = 'Teléfono'; emoji = '📞'
  } else {
    dataType = 'email'; fieldName = 'email'; displayLabel = 'Email';   emoji = '📧'
  }

  let clientId: string | null = null
  let clientName = ''

  // For identifiers: find matching client directly — overrides active client
  if (['cif', 'nif', 'nie'].includes(dataType)) {
    const { data: matches } = await supabase
      .from('clients')
      .select('id, name')
      .or(`cif_nif.ilike.%${clean}%,cif.ilike.%${clean}%,nif.ilike.%${clean}%`)
      .limit(1)
    if (matches?.length) {
      clientId = matches[0].id
      clientName = matches[0].name
      await setConvo(chatId, 'client_active', { clientModeId: clientId, clientModeName: clientName })
    }
  }

  // Fallback: use active client from session
  if (!clientId) {
    const convo = await getConvo(chatId)
    if (convo?.data?.clientModeId) {
      clientId = convo.data.clientModeId
      clientName = convo.data.clientModeName || ''
    }
  }

  if (!clientId) {
    return sendMessage(chatId,
      `${emoji} <code>${text}</code>\n\n` +
      `❓ No sé a qué cliente pertenece este dato.\n` +
      `Escribe el nombre del cliente primero y luego envía los datos.`
    )
  }

  // Build patch — for CIF/NIF also update cif_nif for backwards compat
  const patch: Record<string, any> = { [fieldName]: text.trim(), updated_at: new Date().toISOString() }
  if (dataType === 'cif') patch.cif_nif = clean
  if (dataType === 'nif' || dataType === 'nie') patch.cif_nif = clean

  const { error } = await supabase.from('clients').update(patch).eq('id', clientId)
  if (error) return sendMessage(chatId, `❌ Error guardando: ${error.message}`)

  return sendMessage(chatId, `${emoji} <b>${clientName}</b>\n✅ ${displayLabel} guardado: <code>${text.trim()}</code>`)
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  NON-INVOICE DOCUMENT HANDLER (DNI, bank cert, contract, other)           */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleNonInvoiceDocResult(
  chatId: number,
  inboxId: string,
  analyzed: any,
  user: { userId: string; userName: string },
) {
  const supabase = createBotSupabase()

  // Get file URL from inbox row
  const { data: inboxRow } = await supabase
    .from('telegram_inbox')
    .select('file_url, file_name')
    .eq('id', inboxId)
    .single()
  const fileUrl = inboxRow?.file_url || ''

  const docType = analyzed.documentType // 'cif' | 'nif' | 'iban' | 'contrato' | 'otro'
  const extractedId = (analyzed.cif || analyzed.nif || analyzed.holder_cif_nif || '').replace(/[\s.\-]/g, '').toUpperCase()
  const extractedIban = (analyzed.iban || '').replace(/\s/g, '').toUpperCase()
  const extractedName = analyzed.holder_name || analyzed.account_holder || ''

  // 1 — Find the client
  let clientId: string | null = null
  let clientName = ''
  let foundViaDoc = false

  // Priority 1: identifier extracted from document
  if (extractedId && extractedId.length >= 8) {
    const { data: matches } = await supabase
      .from('clients')
      .select('id, name')
      .or(`cif_nif.ilike.%${extractedId}%,cif.ilike.%${extractedId}%,nif.ilike.%${extractedId}%`)
      .limit(2)

    if (matches?.length === 1) {
      clientId = matches[0].id
      clientName = matches[0].name
      foundViaDoc = true
      // Auto-activate this client
      await setConvo(chatId, 'client_active', { clientModeId: clientId, clientModeName: clientName })
    } else if (matches && matches.length > 1) {
      // Ambiguous — store options in convo, use short pick:N callbacks
      await setConvo(chatId, 'pick_doc_client', {
        pickOptions: matches.map((c: any) => ({ id: c.id, name: c.name })),
        pendingInboxId: inboxId,
        pendingDocType: docType,
      })
      const rows = matches.slice(0, 5).map((c: any, i: number) => [
        button(c.name.substring(0, 40), `pick:${i}`)
      ])
      rows.push([button('❌ Cancelar', 'cancel')])
      await supabase.from('telegram_inbox').update({ status: 'pending_confirm' }).eq('id', inboxId)
      return sendMessage(chatId,
        `🔍 El identificador <code>${extractedId}</code> coincide con varios clientes. ¿A cuál lo asocio?`,
        { replyMarkup: inlineKeyboard(rows) }
      )
    }
  }

  // Priority 2: name from document
  if (!clientId && extractedName && extractedName !== 'No detectado') {
    const matches = await searchClients(supabase, extractedName, 2)
    if (matches?.length === 1) {
      clientId = matches[0].id
      clientName = matches[0].name
      foundViaDoc = true
      await setConvo(chatId, 'client_active', { clientModeId: clientId, clientModeName: clientName })
    }
  }

  // Priority 3: active client from session
  if (!clientId) {
    const convo = await getConvo(chatId)
    if (convo?.data?.clientModeId) {
      clientId = convo.data.clientModeId
      clientName = convo.data.clientModeName || ''
    }
  }

  if (!clientId) {
    await supabase.from('telegram_inbox').update({ status: 'pending_confirm' }).eq('id', inboxId)
    return sendMessage(chatId,
      `📎 Documento recibido (<b>${docTypeLabel(docType)}</b>)\n\n` +
      `❓ No pude identificar el cliente. Escribe el nombre del cliente para asociar este documento.`
    )
  }

  // Priority 3 found via session — ask for confirmation before silently saving
  // Store data in convo (not in callback_data — Telegram has 64-byte limit)
  if (!foundViaDoc) {
    await supabase.from('telegram_inbox').update({ status: 'pending_confirm' }).eq('id', inboxId)
    await setConvo(chatId, 'pending_doc_confirm', {
      pendingInboxId: inboxId,
      pendingDocType: docType,
      pendingClientId: clientId,
      pendingClientName: clientName,
    })
    return sendMessage(chatId,
      `📎 <b>${docTypeLabel(docType)} recibido</b>\n\n` +
      `No encontré datos de cliente en el documento.\n` +
      `¿Pertenece a <b>${clientName}</b>?`,
      {
        replyMarkup: inlineKeyboard([
          [button(`✅ Sí`, `doc_confirm`)],
          [button('❌ Otro cliente', `doc_cancel`)],
        ]),
      }
    )
  }

  // 2 — Update client fields based on document type
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  let savedFields: string[] = []

  if ((docType === 'cif' || docType === 'nif') && extractedId) {
    const field = docType === 'cif' ? 'cif' : 'nif'
    const fileField = docType === 'cif' ? 'cif_file_url' : 'nif_file_url'
    patch[field] = extractedId
    patch.cif_nif = extractedId
    if (fileUrl) patch[fileField] = fileUrl
    savedFields = [extractedId, fileUrl ? '(doc guardado)' : '']
  } else if (docType === 'iban') {
    const ibanVal = extractedIban || extractedId
    if (ibanVal) { patch.iban = ibanVal; savedFields.push(ibanVal) }
    if (fileUrl) { patch.iban_file_url = fileUrl; savedFields.push('(certificado guardado)') }
    if (analyzed.bank_name) savedFields.push(analyzed.bank_name)
  } else if (docType === 'contrato' || docType === 'otro') {
    // For other docs: just store file URL in notes or acknowledge
    savedFields = ['documento archivado']
  }

  if (Object.keys(patch).length > 1) {
    await supabase.from('clients').update(patch).eq('id', clientId)
  }

  // 3 — Mark inbox as processed
  await supabase.from('telegram_inbox').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', inboxId)

  // 4 — Confirm
  const emojiMap: Record<string, string> = { cif: '🏢', nif: '🪪', iban: '🏦', contrato: '📋', otro: '📎' }
  const docEmoji = emojiMap[docType as string] || '📎'
  const sourceTag = foundViaDoc ? ' <i>(identificado del documento)</i>' : ''
  const fieldsTag = savedFields.filter(Boolean).join(' · ')

  return sendMessage(chatId,
    `${docEmoji} <b>${docTypeLabel(docType)} guardado</b>${sourceTag}\n\n` +
    `👤 <b>${clientName}</b>\n` +
    (fieldsTag ? `✅ ${fieldsTag}` : '')
  )
}

function docTypeLabel(t: string): string {
  return { cif: 'CIF', nif: 'DNI/NIF', iban: 'Certificado bancario', contrato: 'Contrato', otro: 'Documento' }[t] || 'Documento'
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  QUICK COMMANDS                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleLastClient(chatId: number) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  const supabase = createBotSupabase()
  const { data: supplies } = await supabase
    .from('supplies')
    .select('id, cups, tariff, status, client:clients!inner(id, name, commercial_id)')
    .eq('client.commercial_id', user.userId)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (!supplies?.length) {
    return sendMessage(chatId, '📭 No tienes suministros aún.')
  }

  const s = supplies[0]
  const client = s.client as any

  return sendMessage(chatId,
    `🕐 <b>Último suministro</b>\n\n` +
    `👤 ${client.name}\n` +
    `🔌 CUPS: <code>${s.cups || '-'}</code>\n` +
    `⚡ Tarifa: ${s.tariff || '-'}\n` +
    `📊 Estado: ${getStatusLabel(s.status)}`,
    { replyMarkup: inlineKeyboard([
      [button('📊 Crear estudio', `quick_estudio:${s.id}`)],
      [button('📞 Agendar llamada', `quick_llamada:${s.id}`)],
    ]) }
  )
}

async function handleSupplyStatus(chatId: number, cupsOrId: string) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  const supabase = createBotSupabase()
  const { data: supply } = await supabase
    .from('supplies')
    .select('id, cups, tariff, type, address, status, client:clients(name), invoices(id, total_amount)')
    .or(`cups.ilike.%${cupsOrId}%,id.eq.${cupsOrId}`)
    .limit(1)
    .single()

  if (!supply) {
    return sendMessage(chatId, `❌ No encontré suministro "<b>${cupsOrId}</b>".`)
  }

  const invoiceCount = supply.invoices?.length || 0
  const totalAmount = supply.invoices?.reduce((sum: number, inv: any) => sum + (inv.total_amount || 0), 0) || 0

  return sendMessage(chatId,
    `📊 <b>Estado del suministro</b>\n\n` +
    `👤 ${(supply.client as any)?.name || '?'}\n` +
    `🔌 CUPS: <code>${supply.cups || '-'}</code>\n` +
    `⚡ Tarifa: ${supply.tariff || '-'}\n` +
    `🏠 Tipo: ${supply.type || '-'}\n` +
    `📍 Dirección: ${supply.address || '-'}\n` +
    `📊 Estado: ${getStatusLabel(supply.status)}\n` +
    `📄 Facturas: ${invoiceCount} (${totalAmount.toFixed(2)}€)`,
    { replyMarkup: inlineKeyboard([
      [button('📊 Crear estudio', `quick_estudio:${supply.id}`)],
      [button('📞 Agendar llamada', `quick_llamada:${supply.id}`)],
      [button('📝 Añadir nota', `quick_nota:${supply.id}`)],
    ]) }
  )
}

async function handleNoteCommand(chatId: number, arg: string) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  if (!arg || !arg.includes(' ')) {
    return sendMessage(chatId, '📝 Escribe: <code>/nota CUPS texto_nota</code>')
  }

  const parts = arg.split(/\s+/)
  const cupsOrId = parts[0]
  const noteText = parts.slice(1).join(' ')

  if (!noteText) {
    return sendMessage(chatId, '📝 Escribe: <code>/nota CUPS texto_nota</code>')
  }

  const supabase = createBotSupabase()
  const { data: supply } = await supabase
    .from('supplies')
    .select('id, cups, client:clients(id, name, notes)')
    .or(`cups.ilike.%${cupsOrId}%,id.eq.${cupsOrId}`)
    .limit(1)
    .single()

  if (!supply) {
    return sendMessage(chatId, `❌ No encontré suministro "<b>${cupsOrId}</b>".`)
  }

  const client = supply.client as any
  if (client?.id) {
    const existingNotes = client.notes || ''
    const ts = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const newNotes = existingNotes ? `${existingNotes}\n[${ts}] ${noteText}` : `[${ts}] ${noteText}`
    await supabase.from('clients').update({ notes: newNotes, updated_at: new Date().toISOString() }).eq('id', client.id)
  }

  return sendMessage(chatId, `✅ Nota añadida a <b>${client?.name || 'cliente'}</b>:\n📝 "${noteText}"`)
}

async function handleMySupplies(chatId: number) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  await sendChatAction(chatId, 'typing')
  const supabase = createBotSupabase()

  const actionStatuses = ['primer_contacto', 'estudio_completado',
    'presentacion_pendiente', 'pendiente_firma']

  const { data: supplies } = await supabase
    .from('supplies')
    .select('id, cups, tariff, status, client:clients!inner(name, commercial_id)')
    .in('status', actionStatuses)
    .eq('client.commercial_id', user.userId)
    .order('updated_at', { ascending: false })
    .limit(15)

  if (!supplies?.length) {
    return sendMessage(chatId, '✅ No tienes suministros pendientes. ¡Todo al día!')
  }

  const lines = supplies.map((s: any) => {
    const label = getStatusLabel(s.status)
    const client = s.client?.name || '?'
    const cups = s.cups ? `...${s.cups.slice(-6)}` : '-'
    return `${label}\n   ${client} · ${cups}`
  })

  return sendMessage(chatId,
    `📋 <b>Suministros pendientes (${supplies.length})</b>\n\n${lines.join('\n\n')}`
  )
}

async function handleSearch(chatId: number, query: string) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  await sendChatAction(chatId, 'typing')
  const supabase = createBotSupabase()

  const clients = await searchClients(supabase, query)

  const { data: supplies } = await supabase
    .from('supplies')
    .select('id, cups, tariff, status, client:clients(name)')
    .or(`cups.ilike.%${query}%,address.ilike.%${query}%`)
    .limit(5)

  if (!clients?.length && !supplies?.length) {
    return sendMessage(chatId, `🔍 Sin resultados para "<b>${query}</b>"`)
  }

  let text = `🔍 <b>Resultados para "${query}"</b>\n`

  if (clients?.length) {
    text += '\n👤 <b>Clientes:</b>\n'
    clients.forEach((c: any) => {
      text += `  • ${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}${c.phone ? ` · ${c.phone}` : ''}\n`
    })
  }

  if (supplies?.length) {
    text += '\n⚡ <b>Suministros:</b>\n'
    supplies.forEach((s: any) => {
      text += `  • <code>${s.cups || '-'}</code> · ${(s.client as any)?.name || '?'} · ${getStatusLabel(s.status)}\n`
    })
  }

  return sendMessage(chatId, text)
}

async function handlePendingActions(chatId: number) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  await sendChatAction(chatId, 'typing')
  const supabase = createBotSupabase()

  const today = new Date().toISOString().split('T')[0]
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, priority, due_date')
    .eq('assigned_to', user.userId)
    .in('status', ['pending', 'in_progress'])
    .order('due_date', { ascending: true })
    .limit(10)

  const { data: appointments } = await supabase
    .from('appointments')
    .select('type, scheduled_at, client:clients(name), notes')
    .eq('commercial_id', user.userId)
    .eq('status', 'scheduled')
    .gte('scheduled_at', `${today}T00:00:00`)
    .lte('scheduled_at', `${today}T23:59:59`)
    .order('scheduled_at', { ascending: true })

  let text = `📅 <b>Tu día — ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</b>\n`

  if (appointments?.length) {
    text += '\n🗓 <b>Citas:</b>\n'
    appointments.forEach((a: any) => {
      const time = new Date(a.scheduled_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      text += `  • ${time} — ${(a.client as any)?.name || '?'} (${a.type})\n`
    })
  } else {
    text += '\n🗓 Sin citas hoy\n'
  }

  if (tasks?.length) {
    text += '\n✅ <b>Tareas:</b>\n'
    const priorityIcon: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' }
    tasks.forEach((t: any) => {
      const icon = priorityIcon[t.priority] || '⚪'
      const overdue = t.due_date && t.due_date < today ? ' ⚠️' : ''
      text += `  ${icon} ${t.title}${overdue}\n`
    })
  } else {
    text += '\n✅ Sin tareas pendientes\n'
  }

  return sendMessage(chatId, text)
}

async function handleExitClientMode(chatId: number) {
  const convo = await getConvo(chatId)
  if (!convo?.data?.clientModeId) {
    return sendMessage(chatId, 'No estás en modo cliente.')
  }
  const name = convo.data.clientModeName
  await clearConvo(chatId)
  return sendMessage(chatId, `✅ Saliste del modo cliente (<b>${name}</b>).`)
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CALLBACK HANDLER                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleCallback(cb: CallbackQuery) {
  const chatId = cb.message?.chat.id
  if (!chatId) return

  const [action, ...params] = (cb.data || '').split(':')

  try {
    switch (action) {
      case 'quick_estudio':
        return answerCallback(cb.id, '📊 Abriendo estudio...')

      case 'quick_llamada':
        return answerCallback(cb.id, '📞 Abriendo agenda...')

      case 'quick_nota':
        {
          const supplyId = params[0]
          if (!supplyId) return answerCallback(cb.id, 'Error: falta ID')
          await setConvo(chatId, 'await_supply_note', { supplyId })
          await answerCallback(cb.id)
          return sendMessage(chatId, '📝 Escribe la nota (o /cancelar):')
        }

      case 'set_client':
        {
          // params[0] = clientId, params[1] = clientName (may be truncated)
          const [clientIdParam, ...nameParts] = params
          const clientNameParam = nameParts.join(':')
          if (!clientIdParam) return answerCallback(cb.id, 'Error: falta ID')
          await setConvo(chatId, 'client_active', { clientModeId: clientIdParam, clientModeName: clientNameParam })
          await answerCallback(cb.id, `✅ Cliente activo: ${clientNameParam}`)
          return sendMessage(chatId,
            `✅ <b>Cliente activo: ${clientNameParam}</b>\n\n` +
            `Todo lo que envíes se asociará a este cliente.\n/salir para cambiar de cliente.`
          )
        }

      case 'assoc_doc':
        {
          // params: [clientId, inboxId, docType]
          const [assocClientId, assocInboxId, assocDocType] = params
          if (!assocClientId || !assocInboxId) return answerCallback(cb.id, 'Error')
          await answerCallback(cb.id, 'Asociando...')

          const user = await getLinkedUser(chatId)
          if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta con /vincular')

          const supabase = createBotSupabase()
          const { data: cl } = await supabase.from('clients').select('name').eq('id', assocClientId).single()
          const { data: inboxRow } = await supabase.from('telegram_inbox').select('file_url').eq('id', assocInboxId).single()
          const fileUrl = inboxRow?.file_url || ''
          const clientNameAssoc = cl?.name || ''

          // Set as active and update fields
          await setConvo(chatId, 'client_active', { clientModeId: assocClientId, clientModeName: clientNameAssoc })
          const patch: Record<string, any> = { updated_at: new Date().toISOString() }
          if (assocDocType === 'iban' && fileUrl) patch.iban_file_url = fileUrl
          else if (assocDocType === 'cif' && fileUrl) patch.cif_file_url = fileUrl
          else if (assocDocType === 'nif' && fileUrl) patch.nif_file_url = fileUrl
          if (Object.keys(patch).length > 1) await supabase.from('clients').update(patch).eq('id', assocClientId)
          await supabase.from('telegram_inbox').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', assocInboxId)

          return sendMessage(chatId, `✅ <b>${clientNameAssoc}</b>\n${docTypeLabel(assocDocType)} guardado correctamente.`)
        }

      case 'cups_client':
        {
          // params: [clientId, encodedClientName, cups]
          const [cupsClientId, encodedName, ...cupsParts] = params
          const cupsClientName = decodeURIComponent(encodedName || '')
          const cupsValue = cupsParts.join(':') // CUPS won't have ':' but join for safety
          if (!cupsClientId || !cupsValue) return answerCallback(cb.id, 'Error: datos incompletos')
          await answerCallback(cb.id, '⏳ Creando suministro...')

          const user = await getLinkedUser(chatId)
          if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta con /vincular')

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
          const supabase = createBotSupabase()

          // Fetch full client name
          const { data: cl } = await supabase.from('clients').select('name').eq('id', cupsClientId).single()
          const fullName = cl?.name || cupsClientName

          await setConvo(chatId, 'client_active', { clientModeId: cupsClientId, clientModeName: fullName })
          await clearConvo(chatId)
          await sendMessage(chatId, `⏳ Creando suministro para <b>${fullName}</b>...\n🔌 <code>${cupsValue}</code>`)
          return createSupplyFromCups(chatId, cupsValue, cupsClientId, fullName, user, appUrl, supabase)
        }

      case 'doc_confirm':
        {
          // User confirmed the session client for a non-invoice doc
          const convo = await getConvo(chatId)
          const d = convo?.data || {}
          if (!d.pendingInboxId || !d.pendingClientId) {
            await answerCallback(cb.id, 'Sesión expirada')
            return sendMessage(chatId, '⏱ La sesión expiró. Por favor reenvía el documento.')
          }
          await answerCallback(cb.id, 'Guardando...')
          const supabase = createBotSupabase()
          await supabase.from('telegram_inbox').update({
            status: 'processed', processed_at: new Date().toISOString()
          }).eq('id', d.pendingInboxId)
          // Restore client_active so subsequent docs go to same client
          await setConvo(chatId, 'client_active', {
            clientModeId: d.pendingClientId,
            clientModeName: d.pendingClientName,
          })
          return sendMessage(chatId,
            `📎 <b>${docTypeLabel(d.pendingDocType)} guardado</b>\n\n` +
            `👤 <b>${d.pendingClientName}</b>\n✅ documento archivado`
          )
        }

      case 'doc_cancel':
        {
          // User said "Otro cliente" — clear pending data and ask for client name
          const convo = await getConvo(chatId)
          const d = convo?.data || {}
          if (d.pendingInboxId) {
            await createBotSupabase().from('telegram_inbox')
              .update({ status: 'pending_confirm' })
              .eq('id', d.pendingInboxId)
          }
          await clearConvo(chatId)
          await answerCallback(cb.id, '✏️ Escribe el nombre del cliente')
          return sendMessage(chatId, `✏️ Escribe el nombre del cliente para este documento.`)
        }

      case 'pick':
        {
          // Generic pick:N — reads convo state to determine what we're picking
          const idx = parseInt(params[0] || '0', 10)
          const convo = await getConvo(chatId)
          const d = convo?.data || {}
          const options = d.pickOptions || []
          const chosen = options[idx]
          if (!chosen) {
            await answerCallback(cb.id, 'Opción no válida')
            return
          }
          await answerCallback(cb.id, `✅ ${chosen.name}`)
          const supabase = createBotSupabase()

          if (convo?.step === 'pick_client_activate') {
            // Activate client mode
            await setConvo(chatId, 'client_active', { clientModeId: chosen.id, clientModeName: chosen.name })
            return sendMessage(chatId,
              `✅ <b>Cliente activo: ${chosen.name}</b>\n\n` +
              `Envía sus documentos. Escribe <b>"ya"</b> cuando termines.`
            )
          }

          if (convo?.step === 'pick_doc_client') {
            // Associate a pending non-invoice doc to the chosen client
            const { pendingInboxId, pendingDocType } = d
            if (!pendingInboxId) return sendMessage(chatId, '⏱ Sesión expirada.')
            const { data: inboxRow } = await supabase.from('telegram_inbox')
              .select('file_url').eq('id', pendingInboxId).single()
            const patch: Record<string, any> = { updated_at: new Date().toISOString() }
            if (pendingDocType === 'iban' && inboxRow?.file_url) patch.iban_file_url = inboxRow.file_url
            else if (pendingDocType === 'cif' && inboxRow?.file_url) patch.cif_file_url = inboxRow.file_url
            else if (pendingDocType === 'nif' && inboxRow?.file_url) patch.nif_file_url = inboxRow.file_url
            if (Object.keys(patch).length > 1) await supabase.from('clients').update(patch).eq('id', chosen.id)
            await supabase.from('telegram_inbox').update({
              status: 'processed', processed_at: new Date().toISOString()
            }).eq('id', pendingInboxId)
            await setConvo(chatId, 'client_active', { clientModeId: chosen.id, clientModeName: chosen.name })
            return sendMessage(chatId,
              `✅ <b>${chosen.name}</b>\n${docTypeLabel(pendingDocType)} guardado correctamente.`
            )
          }

          if (convo?.step === 'pick_cups_client') {
            // Assign a CUPS to the chosen client
            const { pendingCups } = d
            if (!pendingCups) return sendMessage(chatId, '⏱ Sesión expirada.')
            const user = await getLinkedUser(chatId)
            if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta con /vincular')
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
            await setConvo(chatId, 'client_active', { clientModeId: chosen.id, clientModeName: chosen.name })
            await sendMessage(chatId, `⏳ Creando suministro para <b>${chosen.name}</b>...\n🔌 <code>${pendingCups}</code>`)
            return createSupplyFromCups(chatId, pendingCups, chosen.id, chosen.name, user, appUrl, supabase)
          }

          return sendMessage(chatId, '⏱ Sesión expirada. Intenta de nuevo.')
        }

      case 'cancel_doc':
        {
          await clearConvo(chatId)
          await answerCallback(cb.id, '✏️ Escribe el nombre del cliente')
          return sendMessage(chatId, `✏️ Escribe el nombre del cliente para este documento.`)
        }

      case 'cancel':
        await clearConvo(chatId)
        return answerCallback(cb.id, '✅ Cancelado')

      default:
        return answerCallback(cb.id)
    }
  } catch (err: any) {
    console.error('[Telegram] Callback error:', err)
    return answerCallback(cb.id, '❌ Error')
  }
}

/* ─── Conversation steps ──────────────────────────────────────────────────── */
async function handleConvoStep(msg: TelegramMessage, convo: ConversationState) {
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()

  // Cancel any conversation
  if (text === '/cancelar' || text === '/cancel') {
    await clearConvo(chatId)
    return sendMessage(chatId, '✅ Cancelado.')
  }

  // ── Tariff picker: user replies 1 / 2 / 3 to select a comparativa ──────────
  if (convo.step === 'waiting_tariff_choice') {
    const choice = text.trim()
    const choiceNum = parseInt(choice, 10)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
    const d = convo.data

    const orderedTariffs: string[] = d.orderedTariffs || []
    if (![1, 2, 3].includes(choiceNum) || choiceNum > orderedTariffs.length) {
      return sendMessage(chatId,
        `Por favor responde <b>1</b>, <b>2</b> o <b>3</b> para elegir la tarifa.`
      )
    }

    const tariffKey = orderedTariffs[choiceNum - 1] as string
    await clearConvo(chatId)
    await sendMessage(chatId, `⏳ Generando comparativa Excel...`)

    try {
      const res = await fetch(`${appUrl}/api/comparativa-2td`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titular: d.titular,
          cups: d.cups,
          tariffKey,
          consumoP1: d.consumoP1, consumoP2: d.consumoP2, consumoP3: d.consumoP3,
          potenciaP1: d.potenciaP1, potenciaP2: d.potenciaP2, potenciaP3: d.potenciaP3,
          currentEnergyPrice: d.currentEnergyPrice,
          currentEnergyPriceP1: d.currentEnergyPriceP1,
          currentEnergyPriceP2: d.currentEnergyPriceP2,
          currentEnergyPriceP3: d.currentEnergyPriceP3,
          currentPowerP1: d.currentPowerP1,
          currentPowerP2: d.currentPowerP2,
        }),
      })
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const arrayBuf = await res.arrayBuffer()
      const buf = Buffer.from(arrayBuf)
      const tariffLabelsLocal: Record<string, string> = {
        tramos: '📊 Tramos Horarios', '24h': '⏰ Tarifa 24H Fija', mercado: '📈 Precio Mercado',
      }
      const fileName = `Comparativa_Voltis_${tariffKey}_${(d.titular || 'cliente').replace(/\s+/g, '_')}.xlsx`
      await sendDocument(chatId, buf, fileName,
        `${tariffLabelsLocal[tariffKey] || tariffKey} — comparativa ahorro Voltis 2.0TD\n\n` +
        `📋 Ver suministro en CRM: ${d.supplyUrl}`
      )
    } catch (err: any) {
      console.error('[Telegram] tariff_choice Excel error:', err.message)
      await sendMessage(chatId,
        `❌ Error generando el Excel. Puedes verlo en el CRM:\n${d.supplyUrl}`
      )
    }
    return
  }

  if (convo.step === 'await_cups_client') {
    const cups = convo.data.cups as string
    const supabase = createBotSupabase()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'

    const linkedUser = await getLinkedUser(chatId)
    if (!linkedUser) return sendMessage(chatId, '🔒 Vincula tu cuenta con /vincular')

    const clients = await searchClients(supabase, text)

    if (clients.length === 0) {
      return sendMessage(chatId,
        `❓ No encontré ningún cliente con "<b>${text}</b>".\n` +
        `Inténtalo de nuevo o usa /buscar para ver clientes.`
      )
    }

    if (clients.length === 1) {
      const c = clients[0]
      await setConvo(chatId, 'client_active', { clientModeId: c.id, clientModeName: c.name })
      await sendMessage(chatId, `⏳ Creando suministro para <b>${c.name}</b>...\n🔌 <code>${cups}</code>`)
      return createSupplyFromCups(chatId, cups, c.id, c.name, linkedUser, appUrl, supabase)
    }

    // Multiple clients — store in convo, use short pick:N callbacks
    const pickClients = clients.slice(0, 5)
    await setConvo(chatId, 'pick_cups_client', {
      pickOptions: pickClients.map((c: any) => ({ id: c.id, name: c.name })),
      pendingCups: cups,
    })
    const rows = pickClients.map((c: any, i: number) => [
      button(`${c.name.substring(0, 35)}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `pick:${i}`)
    ])
    rows.push([button('❌ Cancelar', 'cancel')])
    return sendMessage(chatId,
      `🔍 Varios clientes coinciden con "<b>${text}</b>". ¿A cuál asigno el CUPS?`,
      { replyMarkup: inlineKeyboard(rows) }
    )
  }

  if (convo.step === 'await_supply_note') {
    const supplyId = convo.data.supplyId
    const user = await getLinkedUser(chatId)
    if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta con /vincular')

    const supabase = createBotSupabase()
    const { data: supply } = await supabase
      .from('supplies')
      .select('id, cups, client:clients(id, name, notes)')
      .eq('id', supplyId)
      .single()

    if (!supply) {
      await clearConvo(chatId)
      return sendMessage(chatId, '❌ Suministro no encontrado.')
    }

    const client = supply.client as any
    if (client?.id) {
      const existingNotes = client.notes || ''
      const ts = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const newNotes = existingNotes ? `${existingNotes}\n[${ts}] ${text}` : `[${ts}] ${text}`
      await supabase.from('clients').update({ notes: newNotes, updated_at: new Date().toISOString() }).eq('id', client.id)
    }

    await clearConvo(chatId)
    return sendMessage(chatId, `✅ Nota añadida a <b>${client?.name || 'cliente'}</b>:\n📝 "${text}"`)
  }

  await clearConvo(chatId)
  await sendMessage(chatId, 'No entendí la respuesta.')
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'primer_contacto': '📞 Primer contacto',
    'facturas_recibidas': '⏳ Esperando informes', // legacy
    'estudio_completado': '📊 Estudio listo',
    'presentacion_pendiente': '📋 Pendiente presentar',
    'pendiente_firma': '✍️ Pendiente firma',
    'contrato_firmado': '✅ Contrato firmado',
    'suscrito': '🎉 Suscrito',
  }
  return labels[status] || status
}
