import { NextRequest, NextResponse } from 'next/server'
import {
  sendMessage, editMessage, answerCallback, sendChatAction,
  downloadFile, inlineKeyboard, button, createBotSupabase,
} from '@/lib/telegram'
import { normalizeCups } from '@/lib/utils/cups'

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

/* ─── Conversation state (in-memory, per chat) ─────────────────────────────── */
// For production, use Redis or Supabase. For MVP this is fine (stateless restarts clear it).
const conversations = new Map<number, ConversationState>()

interface ConversationState {
  step: string
  data: Record<string, any>
  expiresAt: number
}

function getConvo(chatId: number): ConversationState | null {
  const c = conversations.get(chatId)
  if (!c) return null
  if (Date.now() > c.expiresAt) {
    conversations.delete(chatId)
    return null
  }
  return c
}

function setConvo(chatId: number, step: string, data: Record<string, any> = {}) {
  conversations.set(chatId, {
    step,
    data,
    expiresAt: Date.now() + 30 * 60 * 1000, // 30 min timeout
  })
}

function clearConvo(chatId: number) {
  conversations.delete(chatId)
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
    return NextResponse.json({ ok: true }) // Always 200 so Telegram doesn't retry
  }
}

/* Also allow GET for webhook verification */
export async function GET() {
  return NextResponse.json({ status: 'Voltis CRM Telegram Bot active' })
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MESSAGE HANDLER                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleMessage(msg: TelegramMessage) {
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()

  // ── Commands ──
  if (text.startsWith('/')) {
    return handleCommand(msg, text)
  }

  // ── File received (invoice) ──
  if (msg.document || msg.photo) {
    return handleInvoiceFile(msg)
  }

  // ── Conversation continuation ──
  const convo = getConvo(chatId)
  if (convo) {
    return handleConvoStep(msg, convo)
  }

  // ── Natural text: try quick query ──
  if (text.length > 1) {
    return handleTextQuery(msg, text)
  }

  await sendMessage(chatId,
    '👋 Envíame una <b>factura</b> (foto o PDF) para analizarla y crear un suministro.\n\n' +
    'Comandos:\n' +
    '/vincular — Vincular tu cuenta CRM\n' +
    '/mis — Mis suministros pendientes\n' +
    '/buscar nombre — Buscar cliente o CUPS\n' +
    '/ayuda — Ver todos los comandos'
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
        '• Analizar facturas que me envíes (foto/PDF)\n' +
        '• Crear suministros automáticamente\n' +
        '• Consultar tus clientes y suministros\n' +
        '• Enviarte notificaciones del CRM\n\n' +
        'Para empezar, vincula tu cuenta con <b>/vincular</b>'
      )

    case '/vincular':
      if (arg) return handleLinkCode(chatId, arg, msg.from.id)
      return sendMessage(chatId,
        '🔗 Para vincular tu cuenta, ve a <b>Ajustes → Telegram</b> en el CRM y copia tu código.\n' +
        'Luego escríbeme:\n<code>/vincular TU_CODIGO</code>'
      )

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
        '/vincular [código] — Vincular cuenta CRM\n' +
        '/mis — Mis suministros con acción pendiente\n' +
        '/buscar [texto] — Buscar cliente o CUPS\n' +
        '/pendientes — Tareas y citas del día\n' +
        '/ayuda — Este mensaje\n\n' +
        '📎 También puedes enviarme directamente una <b>foto o PDF de factura</b> y la proceso automáticamente.'
      )

    default:
      return sendMessage(chatId, '❓ Comando no reconocido. Escribe /ayuda para ver los disponibles.')
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  LINKING                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleLinkCode(chatId: number, code: string, telegramUserId: number) {
  const supabase = createBotSupabase()

  // Find pending link with this code
  const { data: link, error } = await supabase
    .from('telegram_links')
    .select('*')
    .eq('link_code', code.trim().toUpperCase())
    .eq('status', 'pending')
    .single()

  if (error || !link) {
    return sendMessage(chatId,
      '❌ Código no válido o expirado.\n' +
      'Genera uno nuevo en <b>Ajustes → Telegram</b> del CRM.'
    )
  }

  // Activate the link
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

  // Get user name
  const { data: profile } = await supabase
    .from('users_profile')
    .select('full_name')
    .eq('id', link.user_id)
    .single()

  return sendMessage(chatId,
    `✅ ¡Cuenta vinculada correctamente!\n\n` +
    `Bienvenido, <b>${profile?.full_name || 'comercial'}</b>.\n\n` +
    `Ahora puedes:\n` +
    `• Enviarme facturas para analizarlas\n` +
    `• Recibir notificaciones del CRM\n` +
    `• Consultar tus clientes y suministros\n\n` +
    `Prueba enviándome una foto de factura 📸`
  )
}

/* ─── Get linked user ──────────────────────────────────────────────────────── */
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
/*  INVOICE PROCESSING                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleInvoiceFile(msg: TelegramMessage) {
  const chatId = msg.chat.id

  // Check linked account
  const user = await getLinkedUser(chatId)
  if (!user) {
    return sendMessage(chatId,
      '🔒 Primero vincula tu cuenta CRM con <b>/vincular</b> para poder procesar facturas.'
    )
  }

  await sendChatAction(chatId, 'typing')

  // Download file
  let fileId: string
  let fileType: 'pdf' | 'image' = 'image'

  if (msg.document) {
    fileId = msg.document.file_id
    const mime = msg.document.mime_type || ''
    fileType = mime.includes('pdf') ? 'pdf' : 'image'
  } else if (msg.photo?.length) {
    // Get highest resolution photo
    fileId = msg.photo[msg.photo.length - 1].file_id
    fileType = 'image'
  } else {
    return sendMessage(chatId, '❌ No pude detectar el archivo. Envía una foto o PDF.')
  }

  const statusMsg = await sendMessage(chatId, '⏳ Descargando factura...')

  try {
    const { buffer, fileName } = await downloadFile(fileId)

    await editMessage(chatId, statusMsg.message_id, '🔍 Analizando factura con IA...')

    // Call our analyze-invoice API
    const base64 = buffer.toString('base64')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

    const analysisRes = await fetch(`${appUrl}/api/analyze-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_base64: base64,
        file_type: fileType,
        file_name: fileName,
      }),
    })

    if (!analysisRes.ok) throw new Error('Analysis API failed')
    const extracted = await analysisRes.json()

    if (extracted.mode === 'manual' || extracted.error) {
      return editMessage(chatId, statusMsg.message_id,
        '⚠️ No pude extraer los datos automáticamente.\n' +
        'Sube esta factura manualmente desde la <b>Bandeja</b> del CRM.'
      )
    }

    // Store file buffer and extraction in conversation
    const cups = normalizeCups(extracted.cups)
    const supabase = createBotSupabase()

    // Check if CUPS exists in system
    let existingSupply: any = null
    if (cups) {
      const { data: supplies } = await supabase
        .from('supplies')
        .select('id, cups, tariff, client:clients(id, name)')
        .eq('cups', cups)
        .limit(1)

      if (supplies?.length) {
        existingSupply = supplies[0]
      }
    }

    // Build summary
    const holder = extracted.holder_name || 'No detectado'
    const tariff = extracted.tariff || '-'
    const total = extracted.total_amount || '-'
    const period = extracted.billing_period || '-'
    const comercializadora = extracted.comercializadora || '-'

    if (existingSupply) {
      // CUPS found → offer to add invoice to existing supply
      const clientName = existingSupply.client?.name || 'Sin cliente'

      setConvo(chatId, 'confirm_existing', {
        supplyId: existingSupply.id,
        clientId: existingSupply.client?.id,
        clientName,
        cups,
        extracted,
        fileBuffer: base64,
        fileType,
        fileName,
        userId: user.userId,
      })

      return editMessage(chatId, statusMsg.message_id,
        `✅ <b>Factura analizada</b>\n\n` +
        `📋 Titular: ${holder}\n` +
        `🔌 CUPS: <code>${cups}</code>\n` +
        `⚡ Tarifa: ${tariff}\n` +
        `💰 Total: ${total}€\n` +
        `📅 Período: ${period}\n` +
        `🏢 Comercializadora: ${comercializadora}\n\n` +
        `✅ Este CUPS ya existe en el sistema asignado a <b>${clientName}</b>.\n` +
        `¿Añadir esta factura al suministro existente?`,
        inlineKeyboard([
          [button('✅ Sí, añadir factura', 'add_to_existing')],
          [button('❌ Cancelar', 'cancel')],
        ])
      )
    } else {
      // CUPS not found → ask if new or existing client
      setConvo(chatId, 'choose_client_type', {
        cups,
        extracted,
        fileBuffer: base64,
        fileType,
        fileName,
        userId: user.userId,
        holder,
      })

      return editMessage(chatId, statusMsg.message_id,
        `✅ <b>Factura analizada</b>\n\n` +
        `📋 Titular: ${holder}\n` +
        `🔌 CUPS: <code>${cups || 'No detectado'}</code>\n` +
        `⚡ Tarifa: ${tariff}\n` +
        `💰 Total: ${total}€\n` +
        `📅 Período: ${period}\n` +
        `🏢 Comercializadora: ${comercializadora}\n\n` +
        `Este CUPS no está en el sistema. ¿Es un cliente nuevo o existente?`,
        inlineKeyboard([
          [button('🆕 Cliente nuevo', 'new_client')],
          [button('👤 Cliente existente', 'existing_client')],
          [button('❌ Cancelar', 'cancel')],
        ])
      )
    }
  } catch (err: any) {
    console.error('[Telegram] Invoice processing error:', err)
    await editMessage(chatId, statusMsg.message_id,
      `❌ Error procesando la factura: ${err.message || 'Error desconocido'}\n` +
      `Inténtalo de nuevo o súbela manualmente desde la Bandeja del CRM.`
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CALLBACK HANDLER (inline keyboard responses)                             */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleCallback(cb: CallbackQuery) {
  const chatId = cb.message?.chat.id
  const msgId = cb.message?.message_id
  const data = cb.data || ''

  if (!chatId || !msgId) return answerCallback(cb.id)

  await answerCallback(cb.id)

  const convo = getConvo(chatId)
  if (!convo) {
    return editMessage(chatId, msgId, '⏰ Sesión expirada. Envía la factura de nuevo.')
  }

  // ── Add invoice to existing supply ──
  if (data === 'add_to_existing' && convo.step === 'confirm_existing') {
    await editMessage(chatId, msgId, '⏳ Subiendo factura al suministro...')
    try {
      await uploadInvoiceAndCreate(convo.data, false)
      clearConvo(chatId)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      return editMessage(chatId, msgId,
        `✅ <b>Factura añadida correctamente</b>\n\n` +
        `Suministro: <code>${convo.data.cups}</code>\n` +
        `Cliente: ${convo.data.clientName}\n\n` +
        `<a href="${appUrl}/supplies/${convo.data.supplyId}">Ver suministro en el CRM →</a>`
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── New client ──
  if (data === 'new_client' && convo.step === 'choose_client_type') {
    setConvo(chatId, 'await_new_client_name', convo.data)
    return editMessage(chatId, msgId,
      `🆕 <b>Nuevo cliente</b>\n\n` +
      `Titular detectado: <b>${convo.data.holder}</b>\n\n` +
      `Escribe el nombre del cliente (o envía "ok" para usar el titular detectado):`
    )
  }

  // ── Existing client ──
  if (data === 'existing_client' && convo.step === 'choose_client_type') {
    setConvo(chatId, 'await_client_search', convo.data)
    return editMessage(chatId, msgId,
      '🔍 Escribe el nombre del cliente para buscarlo:'
    )
  }

  // ── Client selected from search ──
  if (data.startsWith('select_client:')) {
    const clientId = data.replace('select_client:', '')
    const supabase = createBotSupabase()
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .single()

    if (!client) return editMessage(chatId, msgId, '❌ Cliente no encontrado.')

    await editMessage(chatId, msgId, `⏳ Creando suministro para <b>${client.name}</b>...`)

    try {
      const result = await uploadInvoiceAndCreate({
        ...convo.data,
        clientId: client.id,
        clientName: client.name,
        isNewClient: false,
      }, true)

      clearConvo(chatId)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      return editMessage(chatId, msgId,
        `✅ <b>Suministro creado</b>\n\n` +
        `Cliente: ${client.name}\n` +
        `CUPS: <code>${convo.data.cups || 'Por asignar'}</code>\n\n` +
        `<a href="${appUrl}/supplies/${result.supplyId}">Ver suministro en el CRM →</a>`
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Cancel ──
  if (data === 'cancel') {
    clearConvo(chatId)
    return editMessage(chatId, msgId, '🚫 Operación cancelada.')
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CONVERSATION STEPS (text input after prompt)                             */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleConvoStep(msg: TelegramMessage, convo: ConversationState) {
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()

  // ── New client name ──
  if (convo.step === 'await_new_client_name') {
    const clientName = text.toLowerCase() === 'ok' ? convo.data.holder : text
    await sendChatAction(chatId, 'typing')

    const statusMsg = await sendMessage(chatId, `⏳ Creando cliente <b>${clientName}</b> y suministro...`)

    try {
      const result = await uploadInvoiceAndCreate({
        ...convo.data,
        clientName,
        isNewClient: true,
      }, true)

      clearConvo(chatId)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      return editMessage(chatId, statusMsg.message_id,
        `✅ <b>Cliente y suministro creados</b>\n\n` +
        `Cliente: ${clientName}\n` +
        `CUPS: <code>${convo.data.cups || 'Por asignar'}</code>\n\n` +
        `<a href="${appUrl}/supplies/${result.supplyId}">Ver suministro →</a>`
      )
    } catch (err: any) {
      return editMessage(chatId, statusMsg.message_id, `❌ Error: ${err.message}`)
    }
  }

  // ── Search for existing client ──
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
        `❌ No encontré clientes con "<b>${text}</b>".\n\nEscribe otro nombre o usa /cancelar.`,
        { replyMarkup: inlineKeyboard([
          [button('🆕 Crear cliente nuevo', 'new_client')],
          [button('❌ Cancelar', 'cancel')],
        ]) }
      )
    }

    // Re-set convo for client selection
    setConvo(chatId, 'choose_client_type', convo.data)

    const buttons = clients.map((c: any) =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `select_client:${c.id}`)]
    )
    buttons.push([button('❌ Cancelar', 'cancel')])

    return sendMessage(chatId, '👤 Selecciona el cliente:', { replyMarkup: inlineKeyboard(buttons) })
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

  // ── Create new client if needed ──
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

  // ── Create new supply if needed ──
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

    // Auto-create prescoring for non-2.0 tariffs
    const tariffNorm = (tariff || '').replace(/\s+/g, '').toUpperCase()
    const needsPrescoring = tariffNorm &&
      !tariffNorm.startsWith('2.0') && tariffNorm !== '20TD' &&
      tariffNorm !== '20' && tariffNorm !== '202020' &&
      tariffNorm !== '2.0DHA' && tariffNorm !== '20DHA'

    if (needsPrescoring) {
      await supabase.from('prescorings').insert({
        supply_id: supplyId,
        client_name: data.clientName || extracted.holder_name || '',
        cups,
        tariff,
        status: 'pending',
        requested_by: userId,
        requested_at: new Date().toISOString(),
      }).then(() => {}) // Don't throw on prescoring failure
    }
  }

  // ── Upload file to storage ──
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

  // ── Create invoice record ──
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

  // Get supplies of this commercial's clients that need action
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
    return sendMessage(chatId, '✅ No tienes suministros pendientes de acción. ¡Todo al día!')
  }

  const statusLabels: Record<string, string> = {
    primer_contacto: '📞 Primer contacto',
    facturas_recibidas: '📄 Facturas recibidas',
    estudio_completado: '📊 Estudio listo',
    presentacion_pendiente: '📋 Pendiente presentar',
    pendiente_firma: '✍️ Pendiente firma',
  }

  const lines = supplies.map((s: any) => {
    const label = statusLabels[s.status] || s.status
    const client = s.client?.name || '?'
    const cups = s.cups ? s.cups.slice(-6) : '-'
    return `${label}\n   ${client} · ...${cups}`
  })

  return sendMessage(chatId,
    `📋 <b>Tus suministros pendientes (${supplies.length})</b>\n\n${lines.join('\n\n')}`
  )
}

async function handleSearch(chatId: number, query: string) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  await sendChatAction(chatId, 'typing')
  const supabase = createBotSupabase()

  // Search clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, cif_nif, phone')
    .or(`name.ilike.%${query}%,cif_nif.ilike.%${query}%`)
    .limit(5)

  // Search supplies by CUPS
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
      text += `  • <code>${s.cups || '-'}</code> · ${s.client?.name || '?'} · ${s.status}\n`
    })
  }

  return sendMessage(chatId, text)
}

async function handlePendingActions(chatId: number) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  await sendChatAction(chatId, 'typing')
  const supabase = createBotSupabase()

  // Get today's tasks
  const today = new Date().toISOString().split('T')[0]
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, priority, due_date')
    .eq('assigned_to', user.userId)
    .in('status', ['pending', 'in_progress'])
    .order('due_date', { ascending: true })
    .limit(10)

  // Get today's appointments
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
      text += `  • ${time} — ${a.client?.name || '?'} (${a.type})\n`
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

/* ─── Text query (no command prefix) ───────────────────────────────────────── */
async function handleTextQuery(msg: TelegramMessage, text: string) {
  const chatId = msg.chat.id

  // If it looks like a search query, search
  if (text.length >= 3 && !text.includes('/')) {
    return handleSearch(chatId, text)
  }

  return sendMessage(chatId,
    '💡 Puedo:\n' +
    '• Recibir <b>facturas</b> (foto/PDF)\n' +
    '• <b>Buscar</b> clientes o CUPS\n' +
    '• Ver tus <b>/pendientes</b> del día\n' +
    '• Ver tus <b>/mis</b> suministros'
  )
}
