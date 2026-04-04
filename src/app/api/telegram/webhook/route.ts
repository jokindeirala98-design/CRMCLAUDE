import { NextRequest, NextResponse } from 'next/server'
import {
  sendMessage, editMessage, answerCallback, sendChatAction,
  downloadFile, inlineKeyboard, button, createBotSupabase,
} from '@/lib/telegram'
import { normalizeCups } from '@/lib/utils/cups'
import {
  analyzeInvoice, analyzeDocument, classifyDocument, getMimeType,
  type DocumentType, type ExtractedInvoiceData, type ExtractedDocumentData,
} from '@/lib/gemini'

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
// Auto-link timeout: subsequent files within 10 min auto-assign to same client
const AUTO_LINK_MS = 10 * 60 * 1000

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

  // File received — process it individually (one file per webhook call)
  if (msg.document || msg.photo) {
    return handleDocumentFile(msg)
  }

  // Conversation continuation (e.g., waiting for client name, search text, etc.)
  const convo = await getConvo(chatId)
  if (convo && convo.step !== 'idle') {
    return handleConvoStep(msg, convo)
  }

  // Natural text: try quick query
  if (text.length > 1) {
    return handleSearch(chatId, text)
  }

  await sendMessage(chatId,
    '👋 Envíame un <b>documento</b> (foto o PDF) y lo proceso automáticamente.\n\n' +
    'Acepto:\n' +
    '• 📄 <b>Facturas</b> de luz/gas\n' +
    '• 🏢 <b>CIF</b> de empresa\n' +
    '• 🪪 <b>NIF/DNI</b>\n' +
    '• 🏦 <b>Titularidad bancaria</b> (IBAN)\n' +
    '• 📋 <b>Contratos</b>\n\n' +
    'Comandos: /vincular · /mis · /buscar · /cliente · /ayuda'
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
        'Soy tu asistente de Voltis. Puedo:\n' +
        '• Analizar <b>facturas</b> que me envíes (foto/PDF)\n' +
        '• Procesar <b>CIF, NIF, IBAN</b> y asociarlos a clientes\n' +
        '• Crear suministros automáticamente\n' +
        '• Consultar tus clientes y suministros\n\n' +
        'Para empezar, vincula tu cuenta con <b>/vincular</b>'
      )

    case '/vincular':
      if (arg) return handleLinkCode(chatId, arg, msg.from.id)
      return sendMessage(chatId,
        '🔗 Para vincular tu cuenta, ve a <b>Ajustes → Telegram</b> en el CRM y copia tu código.\n' +
        'Luego escríbeme:\n<code>/vincular TU_CODIGO</code>'
      )

    case '/cliente':
      return handleClientModeCommand(chatId, arg)

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
        '  Envía fotos o PDFs directamente\n\n' +
        '<b>👤 Modo cliente:</b>\n' +
        '/cliente [nombre] — Modo cliente (auto-asigna)\n' +
        '/salir — Salir del modo cliente\n\n' +
        '<b>⚡ Acceso rápido:</b>\n' +
        '/ultimo — Último cliente/suministro\n' +
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
    `Ahora puedes enviarme facturas, CIF, NIF, IBAN...\n` +
    `Prueba enviándome una foto de factura 📸`
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
/*  CLIENT MODE (/cliente)                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleClientModeCommand(chatId: number, arg: string) {
  if (!arg) {
    return sendMessage(chatId, '🔍 Escribe: <code>/cliente nombre_del_cliente</code>')
  }

  const supabase = createBotSupabase()
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, cif_nif')
    .or(`name.ilike.%${arg}%,cif_nif.ilike.%${arg}%`)
    .limit(5)

  if (!clients?.length) {
    return sendMessage(chatId, `❌ No encontré clientes con "<b>${arg}</b>".`)
  }

  if (clients.length === 1) {
    const client = clients[0]
    await setConvo(chatId, 'idle', {
      clientModeId: client.id,
      clientModeName: client.name,
    })
    return sendMessage(chatId,
      `📌 <b>Modo cliente activado</b>\n\n` +
      `👤 ${client.name}\n\n` +
      `Todos los documentos que envíes se asignarán automáticamente a este cliente.\n` +
      `Escribe /salir para desactivar.`
    )
  }

  const buttons = clients.map((c: any) =>
    [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `mode_select:${c.id}:${c.name}`)]
  )
  buttons.push([button('❌ Cancelar', 'cancel')])

  return sendMessage(chatId, '👤 Selecciona el cliente:', {
    replyMarkup: inlineKeyboard(buttons),
  })
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
      [button('📌 Modo cliente', `mode_select:${client.id}:${client.name}`)],
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  DOCUMENT PROCESSING — ONE FILE PER WEBHOOK CALL                          */
/*  Each file is processed individually. No batching.                        */
/*  Auto-links to same client if one was chosen recently (10 min window).    */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleDocumentFile(msg: TelegramMessage) {
  const chatId = msg.chat.id

  const user = await getLinkedUser(chatId)
  if (!user) {
    return sendMessage(chatId, '🔒 Vincula tu cuenta con <b>/vincular</b> para procesar documentos.')
  }

  await sendChatAction(chatId, 'typing')

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

  // Check conversation for client mode or auto-link
  const convo = await getConvo(chatId)
  const clientModeId = convo?.data?.clientModeId
  const clientModeName = convo?.data?.clientModeName
  const lastClientId = convo?.data?.lastClientId
  const lastClientName = convo?.data?.lastClientName
  const lastClientAt = convo?.data?.lastClientAt || 0

  // Determine if we should auto-assign
  const autoClientId = clientModeId || (lastClientId && (Date.now() - lastClientAt < AUTO_LINK_MS) ? lastClientId : null)
  const autoClientName = clientModeId ? clientModeName : (autoClientId ? lastClientName : null)

  const statusMsg = await sendMessage(chatId, '⏳ Procesando documento...')

  try {
    // Download
    const { buffer, fileName: dlFileName } = await downloadFile(fileId)
    const base64 = buffer.toString('base64')
    const mimeType = getMimeType(dlFileName || fileName, fileType)

    await editMessage(chatId, statusMsg.message_id, '🔍 Clasificando...')

    // Caption hint
    const caption = (msg.caption || '').toLowerCase()
    let hintType: DocumentType | undefined
    if (caption.includes('factura')) hintType = 'factura'
    else if (caption.includes('cif')) hintType = 'cif'
    else if (caption.includes('nif') || caption.includes('dni')) hintType = 'nif'
    else if (caption.includes('iban') || caption.includes('banco') || caption.includes('bancari')) hintType = 'iban'
    else if (caption.includes('contrato')) hintType = 'contrato'

    // Classify
    let docType: DocumentType
    if (hintType) {
      docType = hintType
    } else {
      const classification = await classifyDocument(base64, mimeType)
      docType = classification.type
    }

    // Route by type
    if (docType === 'factura') {
      return handleInvoiceAnalysis(chatId, statusMsg.message_id, base64, mimeType, fileType, dlFileName || fileName, user, autoClientId, autoClientName)
    } else {
      return handleClientDocument(chatId, statusMsg.message_id, base64, mimeType, fileType, dlFileName || fileName, docType, user, autoClientId, autoClientName)
    }

  } catch (err: any) {
    console.error('[Telegram] Document processing error:', err)
    await editMessage(chatId, statusMsg.message_id,
      `❌ Error procesando documento: ${err.message || 'Error desconocido'}\nInténtalo de nuevo.`
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  INVOICE ANALYSIS                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleInvoiceAnalysis(
  chatId: number,
  statusMsgId: number,
  base64: string,
  mimeType: string,
  fileType: 'pdf' | 'image',
  fileName: string,
  user: { userId: string; userName: string },
  autoClientId: string | null,
  autoClientName: string | null,
) {
  await editMessage(chatId, statusMsgId, '🔍 Analizando factura...')

  const extracted = await analyzeInvoice(base64, mimeType)

  if (extracted.mode === 'manual' || extracted.error) {
    return editMessage(chatId, statusMsgId,
      '⚠️ No pude extraer los datos automáticamente.\n' +
      (extracted.error ? `Detalle: <i>${extracted.error}</i>\n\n` : '\n') +
      'Sube esta factura desde la <b>Bandeja</b> del CRM.'
    )
  }

  const cups = normalizeCups(extracted.cups || '')
  const holder = extracted.holder_name || 'No detectado'
  const tariff = extracted.tariff || '-'
  const total = extracted.total_amount || '-'
  const period = extracted.billing_period || '-'
  const comercializadora = extracted.comercializadora || '-'

  const summary =
    `📋 Titular: ${holder}\n` +
    `🔌 CUPS: <code>${cups || 'No detectado'}</code>\n` +
    `⚡ Tarifa: ${tariff}\n` +
    `💰 Total: ${total}€\n` +
    `📅 Período: ${period}\n` +
    `🏢 Comercializadora: ${comercializadora}`

  const supabase = createBotSupabase()

  // Check if CUPS already exists
  let existingSupply: any = null
  if (cups) {
    const { data: supplies } = await supabase
      .from('supplies')
      .select('id, cups, tariff, client:clients(id, name)')
      .eq('cups', cups)
      .limit(1)

    if (supplies?.length) existingSupply = supplies[0]
  }

  // === AUTO-ASSIGN: client mode or auto-link ===
  if (autoClientId) {
    await editMessage(chatId, statusMsgId, `✅ <b>Factura analizada</b>\n\n${summary}\n\n👤 Cliente: <b>${autoClientName}</b>\n⏳ Guardando...`)

    try {
      const result = await uploadInvoiceAndCreate({
        extracted,
        fileBuffer: base64,
        fileType,
        fileName,
        userId: user.userId,
        cups,
        clientId: existingSupply?.client?.id || autoClientId,
        supplyId: existingSupply?.id,
      }, !existingSupply)

      // Refresh auto-link timestamp
      const convo = await getConvo(chatId)
      await setConvo(chatId, 'idle', {
        ...(convo?.data || {}),
        lastClientId: autoClientId,
        lastClientName: autoClientName,
        lastClientAt: Date.now(),
      })

      return editMessage(chatId, statusMsgId,
        `✅ <b>Factura procesada</b>\n\n${summary}\n\n` +
        `👤 Cliente: <b>${autoClientName}</b>\n` +
        (existingSupply ? '📎 Añadida al suministro existente.' : '🆕 Suministro creado.'),
        inlineKeyboard([
          [button('📊 Crear estudio', `quick_estudio:${result.supplyId}`)],
          [button('📞 Agendar llamada', `quick_llamada:${result.supplyId}`)],
          [button('📄 Más facturas', `quick_mas:${result.supplyId}`)],
        ])
      )
    } catch (err: any) {
      return editMessage(chatId, statusMsgId, `❌ Error: ${err.message}`)
    }
  }

  // === EXISTING SUPPLY: just add invoice ===
  if (existingSupply) {
    const clientName = (existingSupply.client as any)?.name || 'Sin cliente'

    await setConvo(chatId, 'confirm_existing', {
      supplyId: existingSupply.id,
      clientId: (existingSupply.client as any)?.id,
      clientName,
      cups,
      extracted,
      fileBuffer: base64,
      fileType,
      fileName,
      userId: user.userId,
    })

    return editMessage(chatId, statusMsgId,
      `✅ <b>Factura analizada</b>\n\n${summary}\n\n` +
      `✅ CUPS encontrado → <b>${clientName}</b>\n¿Añadir factura?`,
      inlineKeyboard([
        [button('✅ Sí, añadir', 'add_to_existing')],
        [button('❌ Cancelar', 'cancel')],
      ])
    )
  }

  // === NEW CUPS: ask for client ===
  await setConvo(chatId, 'choose_client_type', {
    cups,
    extracted,
    fileBuffer: base64,
    fileType,
    fileName,
    userId: user.userId,
    holder,
  })

  return editMessage(chatId, statusMsgId,
    `✅ <b>Factura analizada</b>\n\n${summary}\n\n` +
    `CUPS no encontrado. ¿Cliente nuevo o existente?`,
    inlineKeyboard([
      [button('🆕 Cliente nuevo', 'new_client')],
      [button('👤 Cliente existente', 'existing_client')],
      [button('❌ Cancelar', 'cancel')],
    ])
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CLIENT DOCUMENT PROCESSING (CIF, NIF, IBAN, etc.)                        */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleClientDocument(
  chatId: number,
  statusMsgId: number,
  base64: string,
  mimeType: string,
  fileType: 'pdf' | 'image',
  fileName: string,
  docType: DocumentType,
  user: { userId: string; userName: string },
  autoClientId: string | null,
  autoClientName: string | null,
) {
  const typeLabels: Record<DocumentType, string> = {
    factura: 'factura', cif: 'CIF', nif: 'NIF/DNI',
    iban: 'titularidad bancaria', contrato: 'contrato', otro: 'documento',
  }
  const typeEmoji: Record<DocumentType, string> = {
    factura: '📄', cif: '🏢', nif: '🪪',
    iban: '🏦', contrato: '📋', otro: '📎',
  }

  await editMessage(chatId, statusMsgId, `🔍 Analizando ${typeLabels[docType]}...`)

  const docData = await analyzeDocument(base64, mimeType, docType)

  if (docData.mode === 'manual' || docData.error) {
    return editMessage(chatId, statusMsgId,
      `⚠️ No pude extraer los datos del ${typeLabels[docType]}.\n` +
      (docData.error ? `Detalle: <i>${docData.error}</i>\n\n` : '\n') +
      'Súbelo manualmente desde el CRM.'
    )
  }

  // Build summary
  const lines: string[] = []
  if (docData.holder_name) lines.push(`👤 Titular: <b>${docData.holder_name}</b>`)
  if (docData.cif) lines.push(`🏢 CIF: <code>${docData.cif}</code>`)
  if (docData.nif) lines.push(`🪪 NIF: <code>${docData.nif}</code>`)
  if (docData.iban) lines.push(`🏦 IBAN: <code>${docData.iban}</code>`)
  if (docData.bank_name) lines.push(`🏛 Banco: ${docData.bank_name}`)
  if (docData.fiscal_address) lines.push(`📍 Dirección: ${docData.fiscal_address}`)
  const summaryText = lines.join('\n')

  // === AUTO-ASSIGN ===
  if (autoClientId) {
    await editMessage(chatId, statusMsgId,
      `${typeEmoji[docType]} <b>${typeLabels[docType].charAt(0).toUpperCase() + typeLabels[docType].slice(1)} analizado</b>\n\n` +
      `${summaryText}\n\n👤 <b>${autoClientName}</b>\n⏳ Guardando...`
    )

    try {
      await saveDocumentToClient(autoClientId, autoClientName || '', {
        docType, docData, fileBuffer: base64, fileType, fileName, mimeType,
      })

      const convo = await getConvo(chatId)
      await setConvo(chatId, 'idle', {
        ...(convo?.data || {}),
        lastClientId: autoClientId,
        lastClientName: autoClientName,
        lastClientAt: Date.now(),
      })

      return editMessage(chatId, statusMsgId,
        `✅ <b>${typeLabels[docType].charAt(0).toUpperCase() + typeLabels[docType].slice(1)} guardado</b>\n\n` +
        `${summaryText}\n\n👤 Cliente: <b>${autoClientName}</b>`
      )
    } catch (err: any) {
      return editMessage(chatId, statusMsgId, `❌ Error: ${err.message}`)
    }
  }

  // === MATCH CLIENT ===
  await setConvo(chatId, 'choose_client_for_doc', {
    docType, docData, fileBuffer: base64, fileType, fileName, userId: user.userId, mimeType,
  })

  const supabase = createBotSupabase()
  const searchTerms: string[] = []
  if (docData.cif) searchTerms.push(docData.cif)
  if (docData.nif) searchTerms.push(docData.nif)
  if (docData.holder_name) searchTerms.push(docData.holder_name)

  let matchedClients: any[] = []
  if (searchTerms.length > 0) {
    const orClauses = searchTerms.map(t =>
      `name.ilike.%${t}%,cif_nif.ilike.%${t}%,cif.ilike.%${t}%,nif.ilike.%${t}%`
    ).join(',')

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, cif_nif, cif, nif')
      .or(orClauses)
      .limit(5)

    matchedClients = clients || []
  }

  const label = typeLabels[docType].charAt(0).toUpperCase() + typeLabels[docType].slice(1)

  if (matchedClients.length === 1) {
    const client = matchedClients[0]
    await setConvo(chatId, 'confirm_doc_client', {
      docType, docData, fileBuffer: base64, fileType, fileName, userId: user.userId, mimeType,
      clientId: client.id, clientName: client.name,
    })

    return editMessage(chatId, statusMsgId,
      `${typeEmoji[docType]} <b>${label} analizado</b>\n\n${summaryText}\n\n` +
      `🔗 Coincide con: <b>${client.name}</b>\n¿Guardar?`,
      inlineKeyboard([
        [button(`✅ Guardar en ${client.name}`, 'save_doc_to_client')],
        [button('👤 Elegir otro', 'choose_other_client_doc')],
        [button('❌ Cancelar', 'cancel')],
      ])
    )
  } else if (matchedClients.length > 1) {
    const buttons = matchedClients.map(c =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `doc_select:${c.id}:${c.name}`)]
    )
    buttons.push([button('🆕 Cliente nuevo', 'doc_new_client')])
    buttons.push([button('❌ Cancelar', 'cancel')])

    return editMessage(chatId, statusMsgId,
      `${typeEmoji[docType]} <b>${label} analizado</b>\n\n${summaryText}\n\n` +
      `Varios clientes posibles:`,
      inlineKeyboard(buttons)
    )
  } else {
    return editMessage(chatId, statusMsgId,
      `${typeEmoji[docType]} <b>${label} analizado</b>\n\n${summaryText}\n\n` +
      `No encontré cliente. ¿Qué hacemos?`,
      inlineKeyboard([
        [button('👤 Buscar cliente', 'search_client_for_doc')],
        [button('🆕 Cliente nuevo', 'doc_new_client')],
        [button('❌ Cancelar', 'cancel')],
      ])
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  SAVE DOCUMENT TO CLIENT                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function saveDocumentToClient(
  clientId: string,
  clientName: string,
  data: Record<string, any>,
): Promise<string> {
  const supabase = createBotSupabase()
  const { docType, docData, fileBuffer, fileType, fileName, mimeType } = data

  // Upload file
  const buffer = Buffer.from(fileBuffer, 'base64')
  const ext = fileType === 'pdf' ? 'pdf' : 'jpg'
  const folder = docType === 'factura' ? 'invoices' : docType
  const storagePath = `clients/${clientId}/${folder}/${Date.now()}_telegram.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, {
      contentType: mimeType || (fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'),
    })

  if (uploadError) console.error('[Telegram] Upload error:', uploadError)

  const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
  const fileUrl = urlData?.publicUrl || null

  // Update client fields
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }

  if (docType === 'cif' && docData.cif) {
    updates.cif = docData.cif
    updates.cif_nif = docData.cif
    if (fileUrl) updates.cif_file_url = fileUrl
    if (docData.holder_name) updates.name = docData.holder_name
    if (docData.fiscal_address) updates.fiscal_address = docData.fiscal_address
    updates.type = 'empresa'
  } else if (docType === 'nif' && docData.nif) {
    updates.nif = docData.nif
    updates.cif_nif = docData.nif
    if (fileUrl) updates.nif_file_url = fileUrl
    if (docData.holder_name) updates.name = docData.holder_name
    if (docData.fiscal_address) updates.fiscal_address = docData.fiscal_address
    updates.type = 'particular'
  } else if (docType === 'iban' && docData.iban) {
    updates.iban = docData.iban.replace(/\s+/g, '')
    if (fileUrl) updates.iban_file_url = fileUrl
    if (fileUrl) updates.bank_certificate_url = fileUrl
  } else if (docType === 'contrato') {
    if (docData.cif) { updates.cif = docData.cif; updates.cif_nif = docData.cif }
    if (docData.nif) { updates.nif = docData.nif; updates.cif_nif = docData.nif }
  } else {
    if (docData.cif) { updates.cif = docData.cif; updates.cif_nif = docData.cif }
    if (docData.nif) { updates.nif = docData.nif; updates.cif_nif = docData.nif }
    if (docData.iban) updates.iban = docData.iban.replace(/\s+/g, '')
  }

  const { error: updateError } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', clientId)

  if (updateError) throw new Error(`Error actualizando cliente: ${updateError.message}`)

  return fileUrl || 'saved'
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CALLBACK HANDLER                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleCallback(cb: CallbackQuery) {
  const chatId = cb.message?.chat.id
  const msgId = cb.message?.message_id
  if (!chatId || !msgId) return
  await answerCallback(cb.id)

  const data = cb.data || ''
  const convo = await getConvo(chatId)

  // ── Client mode selection ──
  if (data.startsWith('mode_select:')) {
    const parts = data.split(':')
    const clientId = parts[1]
    const clientName = parts.slice(2).join(':')
    await setConvo(chatId, 'idle', {
      ...(convo?.data || {}),
      clientModeId: clientId,
      clientModeName: clientName,
    })
    return editMessage(chatId, msgId,
      `📌 <b>Modo cliente activado</b>\n\n👤 ${clientName}\n\nTodos los documentos se asignarán a este cliente.\nEscribe /salir para desactivar.`
    )
  }

  // ── Invoice: add to existing supply ──
  if (data === 'add_to_existing' && convo?.step === 'confirm_existing') {
    await editMessage(chatId, msgId, '⏳ Añadiendo factura...')
    try {
      const result = await uploadInvoiceAndCreate(convo.data, false)

      // Set auto-link
      await setConvo(chatId, 'idle', {
        ...(convo?.data?.clientModeId ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName } : {}),
        lastClientId: convo.data.clientId,
        lastClientName: convo.data.clientName,
        lastClientAt: Date.now(),
      })

      return editMessage(chatId, msgId,
        `✅ Factura añadida a <b>${convo.data.clientName}</b>.`,
        inlineKeyboard([
          [button('📊 Crear estudio', `quick_estudio:${result.supplyId}`)],
          [button('📞 Agendar llamada', `quick_llamada:${result.supplyId}`)],
        ])
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Invoice: new client flow ──
  if (data === 'new_client') {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada. Envía la factura de nuevo.')
    const holder = convo.data.holder || convo.data.extracted?.holder_name || ''
    await setConvo(chatId, 'await_new_client_name', convo.data)
    return editMessage(chatId, msgId,
      `🆕 Escribe el nombre del nuevo cliente.\n\n` +
      (holder ? `💡 Detectado: <b>${holder}</b>\nEscribe "ok" para usarlo.` : '')
    )
  }

  // ── Invoice: search existing client ──
  if (data === 'existing_client') {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    await setConvo(chatId, 'await_client_search', convo.data)
    return editMessage(chatId, msgId, '🔍 Escribe el nombre del cliente:')
  }

  // ── Invoice: select specific client from search results ──
  if (data.startsWith('select_client:')) {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    const parts = data.split(':')
    const clientId = parts[1]
    const clientName = parts.slice(2).join(':')

    await editMessage(chatId, msgId, '⏳ Creando suministro...')
    try {
      const result = await uploadInvoiceAndCreate({ ...convo.data, clientId }, true)

      await setConvo(chatId, 'idle', {
        ...(convo?.data?.clientModeId ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName } : {}),
        lastClientId: clientId,
        lastClientName: clientName,
        lastClientAt: Date.now(),
      })

      return editMessage(chatId, msgId,
        `✅ Suministro creado\n\n👤 <b>${clientName}</b>\n🔌 CUPS: <code>${convo.data.cups || '-'}</code>`,
        inlineKeyboard([
          [button('📊 Crear estudio', `quick_estudio:${result.supplyId}`)],
          [button('📞 Agendar llamada', `quick_llamada:${result.supplyId}`)],
          [button('📄 Más facturas', `quick_mas:${result.supplyId}`)],
        ])
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Document: save to matched client ──
  if (data === 'save_doc_to_client' && convo?.step === 'confirm_doc_client') {
    await editMessage(chatId, msgId, '⏳ Guardando...')
    try {
      await saveDocumentToClient(convo.data.clientId, convo.data.clientName, convo.data)

      await setConvo(chatId, 'idle', {
        ...(convo?.data?.clientModeId ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName } : {}),
        lastClientId: convo.data.clientId,
        lastClientName: convo.data.clientName,
        lastClientAt: Date.now(),
      })

      return editMessage(chatId, msgId,
        `✅ ${getDocTypeLabel(convo.data.docType)} guardado en <b>${convo.data.clientName}</b>.`
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Document: select client from list ──
  if (data.startsWith('doc_select:')) {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    const parts = data.split(':')
    const clientId = parts[1]
    const clientName = parts.slice(2).join(':')

    await editMessage(chatId, msgId, '⏳ Guardando...')
    try {
      await saveDocumentToClient(clientId, clientName, convo.data)

      await setConvo(chatId, 'idle', {
        ...(convo?.data?.clientModeId ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName } : {}),
        lastClientId: clientId,
        lastClientName: clientName,
        lastClientAt: Date.now(),
      })

      return editMessage(chatId, msgId,
        `✅ ${getDocTypeLabel(convo.data.docType)} guardado en <b>${clientName}</b>.`
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Document: choose another client / search ──
  if (data === 'choose_other_client_doc' || data === 'search_client_for_doc') {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    await setConvo(chatId, 'await_client_search_doc', convo.data)
    return editMessage(chatId, msgId, '🔍 Escribe el nombre del cliente:')
  }

  // ── Document: create new client from doc ──
  if (data === 'doc_new_client') {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    const holderName = convo.data.docData?.holder_name || ''
    await setConvo(chatId, 'await_new_client_name_doc', convo.data)
    return editMessage(chatId, msgId,
      `🆕 Escribe el nombre del nuevo cliente.\n\n` +
      (holderName ? `💡 Detectado: <b>${holderName}</b>\nEscribe "ok" para usarlo.` : '')
    )
  }

  // ── Quick actions ──
  if (data.startsWith('quick_estudio:')) {
    const supplyId = data.split(':')[1]
    const user = await getLinkedUser(chatId)
    if (user) {
      const supabase = createBotSupabase()
      await supabase.from('supplies').update({ status: 'facturas_recibidas', updated_at: new Date().toISOString() }).eq('id', supplyId)
      await supabase.from('tasks').insert({
        title: 'Crear estudio de suministro',
        supply_id: supplyId,
        assigned_to: user.userId,
        status: 'pending',
        priority: 'high',
        created_at: new Date().toISOString(),
      }).then(() => {})
    }
    return editMessage(chatId, msgId, `✅ Tarea creada: <b>Crear estudio</b>`)
  }

  if (data.startsWith('quick_llamada:')) {
    const supplyId = data.split(':')[1]
    const user = await getLinkedUser(chatId)
    if (user) {
      const supabase = createBotSupabase()
      const { data: supply } = await supabase
        .from('supplies')
        .select('client:clients(id, name)')
        .eq('id', supplyId)
        .single()

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(10, 0, 0, 0)

      await supabase.from('appointments').insert({
        type: 'llamada',
        supply_id: supplyId,
        client_id: (supply?.client as any)?.id,
        commercial_id: user.userId,
        status: 'scheduled',
        scheduled_at: tomorrow.toISOString(),
        notes: `Llamada para ${(supply?.client as any)?.name || 'cliente'}`,
        created_at: new Date().toISOString(),
      }).then(() => {})
    }
    return editMessage(chatId, msgId, `✅ Llamada agendada para mañana 10:00`)
  }

  if (data.startsWith('quick_mas:')) {
    return editMessage(chatId, msgId, `📄 Envíame más facturas, las procesaré automáticamente.`)
  }

  if (data.startsWith('quick_nota:')) {
    const supplyId = data.split(':')[1]
    await setConvo(chatId, 'await_supply_note', { ...(convo?.data || {}), supplyId })
    return editMessage(chatId, msgId, `📝 Escribe la nota:`)
  }

  // ── Cancel ──
  if (data === 'cancel') {
    // Preserve client mode if active
    const clientModeData = convo?.data?.clientModeId
      ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName }
      : {}
    if (Object.keys(clientModeData).length > 0) {
      await setConvo(chatId, 'idle', clientModeData)
    } else {
      await clearConvo(chatId)
    }
    return editMessage(chatId, msgId, '❌ Cancelado.')
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CONVERSATION STEPS                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleConvoStep(msg: TelegramMessage, convo: ConversationState) {
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()

  // ── New client name (invoice flow) ──
  if (convo.step === 'await_new_client_name') {
    const clientName = text.toLowerCase() === 'ok' ? (convo.data.holder || text) : text
    if (!clientName) return sendMessage(chatId, 'Escribe el nombre del cliente:')

    await sendChatAction(chatId, 'typing')
    const statusMsg = await sendMessage(chatId, `⏳ Creando cliente <b>${clientName}</b> y suministro...`)

    try {
      const result = await uploadInvoiceAndCreate({
        ...convo.data,
        clientName,
        isNewClient: true,
      }, true)

      await setConvo(chatId, 'idle', {
        ...(convo.data.clientModeId ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName } : {}),
        lastClientId: result.clientId,
        lastClientName: clientName,
        lastClientAt: Date.now(),
      })

      return editMessage(chatId, statusMsg.message_id,
        `✅ <b>Cliente y suministro creados</b>\n\n` +
        `👤 ${clientName}\n🔌 CUPS: <code>${convo.data.cups || '-'}</code>`,
        inlineKeyboard([
          [button('📊 Crear estudio', `quick_estudio:${result.supplyId}`)],
          [button('📞 Agendar llamada', `quick_llamada:${result.supplyId}`)],
          [button('📄 Más facturas', `quick_mas:${result.supplyId}`)],
        ])
      )
    } catch (err: any) {
      return editMessage(chatId, statusMsg.message_id, `❌ Error: ${err.message}`)
    }
  }

  // ── New client name (document flow) ──
  if (convo.step === 'await_new_client_name_doc') {
    const clientName = text.toLowerCase() === 'ok'
      ? (convo.data.docData?.holder_name || text)
      : text
    if (!clientName) return sendMessage(chatId, 'Escribe el nombre del cliente:')

    await sendChatAction(chatId, 'typing')
    const statusMsg = await sendMessage(chatId, `⏳ Creando cliente <b>${clientName}</b>...`)

    try {
      const supabase = createBotSupabase()
      const docData = convo.data.docData || {}

      const { data: newClient, error } = await supabase
        .from('clients')
        .insert({
          name: clientName,
          cif_nif: docData.cif || docData.nif || null,
          cif: docData.cif || null,
          nif: docData.nif || null,
          type: docData.cif ? 'empresa' : 'particular',
          fiscal_address: docData.fiscal_address || null,
          iban: docData.iban ? docData.iban.replace(/\s+/g, '') : null,
          commercial_id: convo.data.userId,
          origin: 'captacion',
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (error) throw new Error(`Error creando cliente: ${error.message}`)

      await saveDocumentToClient(newClient.id, clientName, convo.data)

      await setConvo(chatId, 'idle', {
        ...(convo.data.clientModeId ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName } : {}),
        lastClientId: newClient.id,
        lastClientName: clientName,
        lastClientAt: Date.now(),
      })

      const typeLabel = getDocTypeLabel(convo.data.docType)
      return editMessage(chatId, statusMsg.message_id,
        `✅ Cliente <b>${clientName}</b> creado con ${typeLabel} guardado.`
      )
    } catch (err: any) {
      return editMessage(chatId, statusMsg.message_id, `❌ Error: ${err.message}`)
    }
  }

  // ── Search client (invoice flow) ──
  if (convo.step === 'await_client_search') {
    await sendChatAction(chatId, 'typing')
    const supabase = createBotSupabase()

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, cif_nif')
      .or(`name.ilike.%${text}%,cif_nif.ilike.%${text}%`)
      .limit(5)

    if (!clients?.length) {
      return sendMessage(chatId,
        `❌ No encontré "<b>${text}</b>".\nEscribe otro nombre:`,
        { replyMarkup: inlineKeyboard([
          [button('🆕 Crear cliente nuevo', 'new_client')],
          [button('❌ Cancelar', 'cancel')],
        ]) }
      )
    }

    await setConvo(chatId, 'choose_client_type', convo.data)

    const buttons = clients.map((c: any) =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `select_client:${c.id}:${c.name}`)]
    )
    buttons.push([button('❌ Cancelar', 'cancel')])

    return sendMessage(chatId, '👤 Selecciona:', { replyMarkup: inlineKeyboard(buttons) })
  }

  // ── Search client (document flow) ──
  if (convo.step === 'await_client_search_doc') {
    await sendChatAction(chatId, 'typing')
    const supabase = createBotSupabase()

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, cif_nif')
      .or(`name.ilike.%${text}%,cif_nif.ilike.%${text}%`)
      .limit(5)

    if (!clients?.length) {
      return sendMessage(chatId,
        `❌ No encontré "<b>${text}</b>".\nEscribe otro nombre:`,
        { replyMarkup: inlineKeyboard([
          [button('🆕 Crear cliente nuevo', 'doc_new_client')],
          [button('❌ Cancelar', 'cancel')],
        ]) }
      )
    }

    await setConvo(chatId, 'choose_client_for_doc', convo.data)

    const buttons = clients.map((c: any) =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `doc_select:${c.id}:${c.name}`)]
    )
    buttons.push([button('🆕 Crear cliente nuevo', 'doc_new_client')])
    buttons.push([button('❌ Cancelar', 'cancel')])

    return sendMessage(chatId, '👤 Selecciona:', { replyMarkup: inlineKeyboard(buttons) })
  }

  // ── Supply note (from quick_nota button) ──
  if (convo.step === 'await_supply_note') {
    const supplyId = convo.data.supplyId
    const supabase = createBotSupabase()

    const { data: supply } = await supabase
      .from('supplies')
      .select('client_id, client:clients(id, notes, name)')
      .eq('id', supplyId)
      .single()

    if (supply?.client) {
      const client = supply.client as any
      const existingNotes = client.notes || ''
      const ts = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const newNotes = existingNotes ? `${existingNotes}\n[${ts}] ${text}` : `[${ts}] ${text}`
      await supabase.from('clients').update({ notes: newNotes, updated_at: new Date().toISOString() }).eq('id', client.id)
    }

    // Preserve client mode
    const clientModeData = convo.data.clientModeId
      ? { clientModeId: convo.data.clientModeId, clientModeName: convo.data.clientModeName }
      : {}
    await setConvo(chatId, 'idle', clientModeData)

    return sendMessage(chatId, `✅ Nota guardada: "${text}"`)
  }

  // If step is unknown or idle, treat as text query
  if (text.length > 1) {
    return handleSearch(chatId, text)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CORE: Upload invoice + create supply/client                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function uploadInvoiceAndCreate(
  data: Record<string, any>,
  createNewSupply: boolean,
): Promise<{ supplyId: string; clientId: string }> {
  const supabase = createBotSupabase()
  const { extracted, fileBuffer, fileType, fileName, userId } = data

  let clientId = data.clientId
  let supplyId = data.supplyId

  if (data.isNewClient) {
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({
        name: data.clientName,
        cif_nif: extracted.holder_cif_nif || null,
        type: 'empresa',
        commercial_id: userId,
        origin: 'captacion',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) throw new Error(`Error creando cliente: ${error.message}`)
    clientId = newClient.id
  }

  if (createNewSupply) {
    const cups = data.cups || null
    const tariff = extracted.tariff || null
    const type = extracted.type || 'luz'
    const address = extracted.supply_address || extracted.billing_address || null

    const { data: newSupply, error } = await supabase
      .from('supplies')
      .insert({
        client_id: clientId,
        cups,
        tariff,
        type,
        address,
        status: 'facturas_recibidas',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) throw new Error(`Error creando suministro: ${error.message}`)
    supplyId = newSupply.id

    // Auto-prescoring for non-2.0 tariffs
    const tariffNorm = (tariff || '').replace(/\s+/g, '').toUpperCase()
    const needsPrescoring = tariffNorm &&
      !tariffNorm.startsWith('2.0') && tariffNorm !== '20TD' &&
      tariffNorm !== '20' && tariffNorm !== '2.0DHA'

    if (needsPrescoring) {
      await supabase.from('prescorings').insert({
        supply_id: supplyId,
        client_name: data.clientName || extracted.holder_name || '',
        cups,
        tariff,
        status: 'pending',
        requested_by: userId,
        requested_at: new Date().toISOString(),
      }).then(() => {})
    }
  }

  // Upload file
  const buffer = Buffer.from(fileBuffer, 'base64')
  const ext = fileType === 'pdf' ? 'pdf' : 'jpg'
  const storagePath = `invoices/${supplyId}/${Date.now()}_telegram.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, {
      contentType: fileType === 'pdf' ? 'application/pdf' : 'image/jpeg',
    })

  if (uploadError) throw new Error(`Error subiendo archivo: ${uploadError.message}`)

  const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)

  const { error: invoiceError } = await supabase.from('invoices').insert({
    supply_id: supplyId,
    file_url: urlData.publicUrl,
    file_type: fileType,
    extracted_data: extracted,
    total_amount: extracted.total_amount ? parseFloat(extracted.total_amount) : null,
    extraction_status: 'completed',
    extraction_confidence: 0.85,
    created_at: new Date().toISOString(),
  })

  if (invoiceError) throw new Error(`Error creando factura: ${invoiceError.message}`)

  return { supplyId, clientId }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  QUERY COMMANDS                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */
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

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, cif_nif, phone')
    .or(`name.ilike.%${query}%,cif_nif.ilike.%${query}%`)
    .limit(5)

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

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function getDocTypeLabel(docType: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    factura: 'Factura', cif: 'CIF', nif: 'NIF/DNI',
    iban: 'Titularidad bancaria', contrato: 'Contrato', otro: 'Documento',
  }
  return labels[docType] || 'Documento'
}

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
