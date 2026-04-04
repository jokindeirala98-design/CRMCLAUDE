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
// Stored in telegram_conversations table so state survives serverless cold starts
// and works across Vercel function instances. Timeout: 24 hours.

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

    // Check expiry
    if (new Date(data.expires_at).getTime() < Date.now()) {
      // Expired — clean up
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

  // File received — classify and process
  if (msg.document || msg.photo) {
    return handleDocumentFile(msg)
  }

  // Conversation continuation
  const convo = await getConvo(chatId)
  if (convo) {
    return handleConvoStep(msg, convo)
  }

  // Natural text: try quick query
  if (text.length > 1) {
    return handleTextQuery(msg, text)
  }

  await sendMessage(chatId,
    '👋 Envíame un <b>documento</b> (foto o PDF) y lo proceso automáticamente.\n\n' +
    'Acepto:\n' +
    '• 📄 <b>Facturas</b> de luz/gas\n' +
    '• 🏢 <b>CIF</b> de empresa\n' +
    '• 🪪 <b>NIF/DNI</b>\n' +
    '• 🏦 <b>Titularidad bancaria</b> (IBAN)\n' +
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
        'Soy tu asistente de Voltis. Puedo:\n' +
        '• Analizar <b>facturas</b> que me envíes (foto/PDF)\n' +
        '• Procesar <b>CIF, NIF, IBAN</b> y asociarlos a clientes\n' +
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
        '📎 Envíame directamente <b>fotos o PDFs</b>:\n' +
        '• Facturas de luz/gas → análisis + alta suministro\n' +
        '• CIF/NIF → asociar a cliente\n' +
        '• Titularidad bancaria → guardar IBAN\n' +
        '• Contratos → archivo documental'
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
    `Ahora puedes:\n` +
    `• Enviarme facturas, CIF, NIF, IBAN...\n` +
    `• Recibir notificaciones del CRM\n` +
    `• Consultar tus clientes y suministros\n\n` +
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
/*  DOCUMENT PROCESSING (unified handler for all file types)                 */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleDocumentFile(msg: TelegramMessage) {
  const chatId = msg.chat.id

  const user = await getLinkedUser(chatId)
  if (!user) {
    return sendMessage(chatId,
      '🔒 Primero vincula tu cuenta CRM con <b>/vincular</b> para poder procesar documentos.'
    )
  }

  await sendChatAction(chatId, 'typing')

  // Download file
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

  const statusMsg = await sendMessage(chatId, '⏳ Descargando documento...')

  try {
    const { buffer, fileName: dlFileName } = await downloadFile(fileId)
    const base64 = buffer.toString('base64')
    const mimeType = getMimeType(dlFileName || fileName, fileType)

    await editMessage(chatId, statusMsg.message_id, '🔍 Clasificando documento con IA...')

    // Check if the caption gives us a hint about document type
    const caption = (msg.caption || '').toLowerCase()
    let hintType: DocumentType | undefined
    if (caption.includes('factura')) hintType = 'factura'
    else if (caption.includes('cif')) hintType = 'cif'
    else if (caption.includes('nif') || caption.includes('dni')) hintType = 'nif'
    else if (caption.includes('iban') || caption.includes('banco') || caption.includes('bancari')) hintType = 'iban'
    else if (caption.includes('contrato')) hintType = 'contrato'

    // Classify the document
    let docType: DocumentType
    if (hintType) {
      docType = hintType
    } else {
      const classification = await classifyDocument(base64, mimeType)
      docType = classification.type
      console.log(`[Telegram] Document classified as: ${docType} (${classification.confidence}) — ${classification.description}`)
    }

    // Route based on document type
    if (docType === 'factura') {
      return handleInvoiceAnalysis(chatId, statusMsg.message_id, base64, mimeType, fileType, dlFileName || fileName, user)
    } else {
      return handleClientDocument(chatId, statusMsg.message_id, base64, mimeType, fileType, dlFileName || fileName, docType, user)
    }

  } catch (err: any) {
    console.error('[Telegram] Document processing error:', err)
    await editMessage(chatId, statusMsg.message_id,
      `❌ Error procesando el documento: ${err.message || 'Error desconocido'}\nInténtalo de nuevo o súbelo desde la Bandeja del CRM.`
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  INVOICE ANALYSIS (called directly, no HTTP self-call)                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleInvoiceAnalysis(
  chatId: number,
  statusMsgId: number,
  base64: string,
  mimeType: string,
  fileType: 'pdf' | 'image',
  fileName: string,
  user: { userId: string; userName: string },
) {
  await editMessage(chatId, statusMsgId, '🔍 Analizando factura con IA...')

  // Call Gemini DIRECTLY (no HTTP self-call)
  const extracted = await analyzeInvoice(base64, mimeType)

  if (extracted.mode === 'manual' || extracted.error) {
    return editMessage(chatId, statusMsgId,
      '⚠️ No pude extraer los datos automáticamente.\n' +
      (extracted.error ? `Detalle: <i>${extracted.error}</i>\n\n` : '\n') +
      'Sube esta factura manualmente desde la <b>Bandeja</b> del CRM.'
    )
  }

  const cups = normalizeCups(extracted.cups || '')
  const supabase = createBotSupabase()

  // Check if CUPS exists
  let existingSupply: any = null
  if (cups) {
    const { data: supplies } = await supabase
      .from('supplies')
      .select('id, cups, tariff, client:clients(id, name)')
      .eq('cups', cups)
      .limit(1)

    if (supplies?.length) existingSupply = supplies[0]
  }

  // Build summary
  const holder = extracted.holder_name || 'No detectado'
  const tariff = extracted.tariff || '-'
  const total = extracted.total_amount || '-'
  const period = extracted.billing_period || '-'
  const comercializadora = extracted.comercializadora || '-'

  if (existingSupply) {
    const clientName = existingSupply.client?.name || 'Sin cliente'

    await setConvo(chatId, 'confirm_existing', {
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

    return editMessage(chatId, statusMsgId,
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
) {
  const typeLabels: Record<DocumentType, string> = {
    factura: 'factura', cif: 'CIF', nif: 'NIF/DNI',
    iban: 'titularidad bancaria', contrato: 'contrato', otro: 'documento',
  }
  const typeEmoji: Record<DocumentType, string> = {
    factura: '📄', cif: '🏢', nif: '🪪',
    iban: '🏦', contrato: '📋', otro: '📎',
  }

  await editMessage(chatId, statusMsgId, `🔍 Analizando ${typeLabels[docType]} con IA...`)

  const docData = await analyzeDocument(base64, mimeType, docType)

  if (docData.mode === 'manual' || docData.error) {
    return editMessage(chatId, statusMsgId,
      `⚠️ No pude extraer los datos del ${typeLabels[docType]}.\n` +
      (docData.error ? `Detalle: <i>${docData.error}</i>\n\n` : '\n') +
      'Súbelo manualmente desde el CRM.'
    )
  }

  // Build extracted info summary
  const lines: string[] = []
  if (docData.holder_name) lines.push(`👤 Titular: <b>${docData.holder_name}</b>`)
  if (docData.cif) lines.push(`🏢 CIF: <code>${docData.cif}</code>`)
  if (docData.nif) lines.push(`🪪 NIF: <code>${docData.nif}</code>`)
  if (docData.iban) lines.push(`🏦 IBAN: <code>${docData.iban}</code>`)
  if (docData.bank_name) lines.push(`🏛 Banco: ${docData.bank_name}`)
  if (docData.fiscal_address) lines.push(`📍 Dirección: ${docData.fiscal_address}`)

  const summary = lines.join('\n')

  // Store document data + file in conversation for client selection
  await setConvo(chatId, 'choose_client_for_doc', {
    docType,
    docData,
    fileBuffer: base64,
    fileType,
    fileName,
    userId: user.userId,
    mimeType,
  })

  // Try to find matching clients
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

  if (matchedClients.length === 1) {
    // Auto-match: offer to save to this client
    const client = matchedClients[0]
    const currentConvo = await getConvo(chatId)
    await setConvo(chatId, 'confirm_doc_client', {
      ...(currentConvo?.data || {}),
      clientId: client.id,
      clientName: client.name,
    })

    return editMessage(chatId, statusMsgId,
      `${typeEmoji[docType]} <b>${typeLabels[docType].charAt(0).toUpperCase() + typeLabels[docType].slice(1)} analizado</b>\n\n` +
      `${summary}\n\n` +
      `🔗 Coincide con: <b>${client.name}</b>\n` +
      `¿Guardar en este cliente?`,
      inlineKeyboard([
        [button(`✅ Guardar en ${client.name}`, 'save_doc_to_client')],
        [button('👤 Elegir otro cliente', 'choose_other_client_doc')],
        [button('❌ Cancelar', 'cancel')],
      ])
    )
  } else if (matchedClients.length > 1) {
    // Multiple matches
    const buttons = matchedClients.map(c =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `doc_select_client:${c.id}:${c.name}`)]
    )
    buttons.push([button('🆕 Cliente nuevo', 'doc_new_client')])
    buttons.push([button('❌ Cancelar', 'cancel')])

    return editMessage(chatId, statusMsgId,
      `${typeEmoji[docType]} <b>${typeLabels[docType].charAt(0).toUpperCase() + typeLabels[docType].slice(1)} analizado</b>\n\n` +
      `${summary}\n\n` +
      `Encontré varios clientes posibles. ¿A cuál lo asigno?`,
      inlineKeyboard(buttons)
    )
  } else {
    // No match — ask
    return editMessage(chatId, statusMsgId,
      `${typeEmoji[docType]} <b>${typeLabels[docType].charAt(0).toUpperCase() + typeLabels[docType].slice(1)} analizado</b>\n\n` +
      `${summary}\n\n` +
      `No encontré un cliente que coincida. ¿Qué quieres hacer?`,
      inlineKeyboard([
        [button('👤 Buscar cliente', 'search_client_for_doc')],
        [button('🆕 Crear cliente nuevo', 'doc_new_client')],
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

  // Upload file to storage
  const buffer = Buffer.from(fileBuffer, 'base64')
  const ext = fileType === 'pdf' ? 'pdf' : 'jpg'
  const folder = docType === 'factura' ? 'invoices' : docType
  const storagePath = `clients/${clientId}/${folder}/${Date.now()}_telegram.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, {
      contentType: mimeType || (fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'),
    })

  if (uploadError) {
    console.error('[Telegram] Upload error:', uploadError)
    // Continue even if upload fails — still save extracted data
  }

  const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
  const fileUrl = urlData?.publicUrl || null

  // Update client fields based on document type
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
    // Just store the file
    if (docData.cif) { updates.cif = docData.cif; updates.cif_nif = docData.cif }
    if (docData.nif) { updates.nif = docData.nif; updates.cif_nif = docData.nif }
  } else {
    // 'otro' type: store whatever we found
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
/*  CALLBACK HANDLER (inline keyboard responses)                             */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleCallback(cb: CallbackQuery) {
  const chatId = cb.message?.chat.id
  const msgId = cb.message?.message_id
  if (!chatId || !msgId) return
  await answerCallback(cb.id)

  const data = cb.data || ''
  const convo = await getConvo(chatId)

  // ── Invoice: add to existing supply ──
  if (data === 'add_to_existing' && convo?.step === 'confirm_existing') {
    await editMessage(chatId, msgId, '⏳ Añadiendo factura al suministro...')
    try {
      await uploadInvoiceAndCreate(convo.data, false)
      await clearConvo(chatId)
      return editMessage(chatId, msgId,
        `✅ Factura añadida al suministro de <b>${convo.data.clientName}</b>.`
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
      (holder ? `💡 Nombre detectado: <b>${holder}</b>\nEscribe "ok" para usarlo o escribe otro nombre.` : '')
    )
  }

  // ── Invoice: existing client search ──
  if (data === 'existing_client') {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    await setConvo(chatId, 'await_client_search', convo.data)
    return editMessage(chatId, msgId, '🔍 Escribe el nombre del cliente a buscar:')
  }

  // ── Invoice: select specific client ──
  if (data.startsWith('select_client:')) {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    const clientId = data.split(':')[1]

    await editMessage(chatId, msgId, '⏳ Creando suministro...')
    try {
      const result = await uploadInvoiceAndCreate({ ...convo.data, clientId }, true)
      await clearConvo(chatId)
      return editMessage(chatId, msgId,
        `✅ Suministro creado para CUPS <code>${convo.data.cups || 'nuevo'}</code>.`
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Document: confirm save to matched client ──
  if (data === 'save_doc_to_client' && convo?.step === 'confirm_doc_client') {
    await editMessage(chatId, msgId, '⏳ Guardando documento...')
    try {
      await saveDocumentToClient(convo.data.clientId, convo.data.clientName, convo.data)
      await clearConvo(chatId)
      const typeLabel = getDocTypeLabel(convo.data.docType)
      return editMessage(chatId, msgId,
        `✅ ${typeLabel} guardado en el cliente <b>${convo.data.clientName}</b>.`
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Document: select client from list ──
  if (data.startsWith('doc_select_client:')) {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    const parts = data.split(':')
    const clientId = parts[1]
    const clientName = parts.slice(2).join(':')

    await editMessage(chatId, msgId, '⏳ Guardando documento...')
    try {
      await saveDocumentToClient(clientId, clientName, convo.data)
      await clearConvo(chatId)
      const typeLabel = getDocTypeLabel(convo.data.docType)
      return editMessage(chatId, msgId,
        `✅ ${typeLabel} guardado en el cliente <b>${clientName}</b>.`
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Document: choose another client ──
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
      (holderName ? `💡 Nombre detectado: <b>${holderName}</b>\nEscribe "ok" para usarlo o escribe otro nombre.` : '')
    )
  }

  // ── Cancel ──
  if (data === 'cancel') {
    await clearConvo(chatId)
    return editMessage(chatId, msgId, '❌ Operación cancelada.')
  }
}

function getDocTypeLabel(docType: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    factura: 'Factura', cif: 'CIF', nif: 'NIF/DNI',
    iban: 'Titularidad bancaria', contrato: 'Contrato', otro: 'Documento',
  }
  return labels[docType] || 'Documento'
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CONVERSATION STEPS                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleConvoStep(msg: TelegramMessage, convo: ConversationState) {
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()

  // ── New client name (invoice flow) ──
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

      await clearConvo(chatId)
      return editMessage(chatId, statusMsg.message_id,
        `✅ <b>Cliente y suministro creados</b>\n\nCliente: ${clientName}\nCUPS: <code>${convo.data.cups || 'Por asignar'}</code>`
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
    await sendChatAction(chatId, 'typing')
    const statusMsg = await sendMessage(chatId, `⏳ Creando cliente <b>${clientName}</b>...`)

    try {
      const supabase = createBotSupabase()
      const docData = convo.data.docData || {}

      // Create client
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

      // Save document file to client
      await saveDocumentToClient(newClient.id, clientName, convo.data)

      await clearConvo(chatId)
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
        `❌ No encontré clientes con "<b>${text}</b>".\nEscribe otro nombre o usa /cancelar.`,
        { replyMarkup: inlineKeyboard([
          [button('🆕 Crear cliente nuevo', 'new_client')],
          [button('❌ Cancelar', 'cancel')],
        ]) }
      )
    }

    await setConvo(chatId, 'choose_client_type', convo.data)

    const buttons = clients.map((c: any) =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `select_client:${c.id}`)]
    )
    buttons.push([button('❌ Cancelar', 'cancel')])

    return sendMessage(chatId, '👤 Selecciona el cliente:', { replyMarkup: inlineKeyboard(buttons) })
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
        `❌ No encontré clientes con "<b>${text}</b>".\nEscribe otro nombre.`,
        { replyMarkup: inlineKeyboard([
          [button('🆕 Crear cliente nuevo', 'doc_new_client')],
          [button('❌ Cancelar', 'cancel')],
        ]) }
      )
    }

    await setConvo(chatId, 'choose_client_for_doc', convo.data)

    const buttons = clients.map((c: any) =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `doc_select_client:${c.id}:${c.name}`)]
    )
    buttons.push([button('🆕 Crear cliente nuevo', 'doc_new_client')])
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

    // Auto-create prescoring for non-2.0 tariffs
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

async function handleTextQuery(msg: TelegramMessage, text: string) {
  const chatId = msg.chat.id

  if (text.length >= 3 && !text.includes('/')) {
    return handleSearch(chatId, text)
  }

  return sendMessage(chatId,
    '💡 Puedo:\n' +
    '• Recibir <b>documentos</b> (facturas, CIF, NIF, IBAN...)\n' +
    '• <b>Buscar</b> clientes o CUPS\n' +
    '• Ver tus <b>/pendientes</b> del día\n' +
    '• Ver tus <b>/mis</b> suministros'
  )
}
