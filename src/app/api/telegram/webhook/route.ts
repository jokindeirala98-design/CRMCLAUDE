import { NextRequest, NextResponse } from 'next/server'
import {
  sendMessage, editMessage, answerCallback, sendChatAction,
  downloadFile, inlineKeyboard, button, createBotSupabase,
} from '@/lib/telegram'
import { processTelegramInboxItem } from '@/lib/telegram-process'
import { analyzeDocument } from '@/lib/gemini'

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

const CONVO_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

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

  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta con /vincular')

  // Detect structured data: CIF, NIF, NIE, IBAN, phone, email
  const cleanText = text.replace(/[\s.\-()]/g, '').toUpperCase()
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
    '👋 Envíame <b>documentos</b> o escribe el <b>nombre de un cliente</b> para activarlo.\n\n' +
    'Acepto:\n' +
    '• 📄 <b>Facturas</b> de luz/gas\n' +
    '• 🪪 <b>DNI / NIF / CIF</b> (foto o PDF)\n' +
    '• 🏦 <b>Certificados bancarios</b>\n' +
    '• 📞 Teléfono  📧 Email  💳 IBAN (texto)\n\n' +
    'Comandos: /vincular · /mis · /buscar · /salir · /ayuda'
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

    case '/salir':
      return handleExitClientMode(chatId)

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
        '/pendientes — Tareas del día'
      )

    default:
      return sendMessage(chatId, '❓ Comando no reconocido. /ayuda para ver opciones.')
  }
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
    // Single Gemini call — classifies AND extracts all fields
    const analyzed = await analyzeDocument(base64, mimeType, undefined, extraPages.length ? extraPages : undefined)
    const docType = analyzed.documentType

    // Route non-invoice documents (DNI, bank cert, contract…) to client doc handler
    if (docType && docType !== 'factura') {
      await handleNonInvoiceDocResult(chatId, inboxId, analyzed, user)
      return
    }

    // Invoice flow — pass pre-analyzed data to skip 2nd Gemini call
    const result = await processTelegramInboxItem(
      inboxId,
      base64,
      mimeType,
      { file_url: '', file_type: mimeType.includes('pdf') ? 'pdf' : 'image', file_name: 'photo.jpg', user_id: user.userId },
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

        sendMessage(chatId,
          `${emoji} <b>${typeLabel}</b>\n\n` +
          `👤 ${clientName}\n` +
          `🔌 <code>${result.cups || 'Sin CUPS'}</code>${aytoTag}${multiPageTag}${noCupsPhotoHint}\n\n` +
          `<a href="${appUrl}/supplies/${result.supply_id}">Ver suministro →</a>`
        ).catch(() => {})
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
    const rows = clients.map((c: any) => [
      button(`${c.alias ? c.alias + ' — ' : ''}${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `set_client:${c.id}:${c.name.substring(0, 40)}`)
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
      // Ambiguous — ask user to pick
      const rows = matches.map((c: any) => [
        button(c.name, `assoc_doc:${c.id}:${inboxId}:${docType}`)
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

  const actionStatuses = ['primer_contacto', 'facturas_recibidas', 'estudio_completado',
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
    'facturas_recibidas': '📄 Facturas recibidas',
    'estudio_completado': '📊 Estudio listo',
    'presentacion_pendiente': '📋 Pendiente presentar',
    'pendiente_firma': '✍️ Pendiente firma',
    'contrato_firmado': '✅ Contrato firmado',
    'suscrito': '🎉 Suscrito',
  }
  return labels[status] || status
}
