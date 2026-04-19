import { NextRequest, NextResponse } from 'next/server'
import {
  sendMessage, editMessage, answerCallback, sendChatAction,
  downloadFile, inlineKeyboard, button, createBotSupabase,
} from '@/lib/telegram'
import { processTelegramInboxItem } from '@/lib/telegram-process'

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
const FILLER_WORDS = /\b(de|del|la|las|los|el|y|e|en|con)\b/gi

function extractSearchKeywords(text: string): string[] {
  // Remove legal suffixes and filler words
  let cleaned = text
    .replace(LEGAL_SUFFIXES, '')
    .replace(FILLER_WORDS, '')
    .replace(/[.,;:'"()]/g, '')
    .trim()

  // Split into words, filter short ones
  const words = cleaned.split(/\s+/).filter(w => w.length >= 3)

  // Return unique significant words
  return Array.from(new Set(words.map(w => w.toLowerCase())))
}

async function searchClients(
  supabase: any,
  rawQuery: string,
  limit: number = 5
): Promise<any[]> {
  // 1. Try exact/substring match first (handles CIF/NIF and close names)
  const { data: exactMatches } = await supabase
    .from('clients')
    .select('id, name, cif_nif, cif, nif')
    .or(`name.ilike.%${rawQuery}%,cif_nif.ilike.%${rawQuery}%,cif.ilike.%${rawQuery}%,nif.ilike.%${rawQuery}%`)
    .limit(limit)

  if (exactMatches?.length) return exactMatches

  // 2. Keyword search — each significant word must match
  const keywords = extractSearchKeywords(rawQuery)
  if (keywords.length === 0) return []

  // Search by each keyword and intersect results
  // Use the most significant keyword (longest) for the primary search
  const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0]

  const { data: keywordMatches } = await supabase
    .from('clients')
    .select('id, name, cif_nif, cif, nif')
    .or(`name.ilike.%${primaryKeyword}%,cif_nif.ilike.%${primaryKeyword}%`)
    .limit(limit * 2) // fetch more so we can filter

  if (!keywordMatches?.length) return []

  // If multiple keywords, filter to ensure all match somewhere
  if (keywords.length > 1) {
    return keywordMatches.filter((c: any) => {
      const haystack = `${c.name} ${c.cif_nif || ''} ${c.cif || ''} ${c.nif || ''}`.toLowerCase()
      // At least the primary keyword must match (it does by query)
      // Check if any OTHER keyword also matches for better relevance
      return keywords.some(k => haystack.includes(k))
    }).slice(0, limit)
  }

  return keywordMatches.slice(0, limit)
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

    // Search by longest keyword
    const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0]

    const { data: nameMatches } = await supabase
      .from('clients')
      .select('id, name, cif_nif, cif, nif')
      .ilike('name', `%${primaryKeyword}%`)
      .limit(10)

    if (!nameMatches?.length) return []

    // Score matches by how many keywords match
    const scored = nameMatches.map((c: any) => {
      const haystack = c.name.toLowerCase()
      const score = keywords.filter(k => haystack.includes(k)).length
      return { ...c, score }
    }).filter((c: any) => c.score > 0)
      .sort((a: any, b: any) => b.score - a.score)

    return scored.slice(0, 5)
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

  // Conversation continuation (e.g., waiting for note text)
  const convo = await getConvo(chatId)
  if (convo && convo.step !== 'idle') {
    return handleConvoStep(msg, convo)
  }

  // Natural text: try quick query
  if (text.length > 1) {
    return handleSearch(chatId, text)
  }

  await sendMessage(chatId,
    '👋 Envíame <b>documentos</b> (foto o PDF) y se guardarán en tu <b>Bandeja</b>.\n\n' +
    'Puedo procesar:\n' +
    '• 📄 <b>Facturas</b> de luz/gas\n' +
    '• 🏢 <b>CIF</b> de empresa\n' +
    '• 🪪 <b>NIF/DNI</b>\n' +
    '• 🏦 <b>IBAN</b>\n' +
    '• 📋 <b>Contratos</b>\n\n' +
    'Comandos: /vincular · /mis · /buscar · /ayuda'
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
      supabase.from('telegram_inbox')
        .update({ media_group_id: mediaGroupId })
        .eq('id', insertedRow.id)
        .catch(() => {})

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
    const result = await processTelegramInboxItem(
      inboxId,
      base64,
      mimeType,
      { file_url: '', file_type: mimeType.includes('pdf') ? 'pdf' : 'image', file_name: 'photo.jpg', user_id: user.userId },
      extraPages.length > 0 ? extraPages : undefined,
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

        // If CUPS wasn't extracted AND it was sent as a compressed photo, guide the user
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
