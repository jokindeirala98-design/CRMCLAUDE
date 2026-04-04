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
const BATCH_TIMEOUT_MS = 15 * 1000 // 15 seconds

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

  // Flush pending batch if any non-file message arrives (text, command, etc.)
  if (!msg.document && !msg.photo) {
    const pendingBatch = await getConvo(chatId)
    if (pendingBatch?.step === 'batch_collecting' && pendingBatch.data.files?.length > 0) {
      await processBatchFiles(chatId, pendingBatch.data)
      await clearConvo(chatId)
    }
  }

  if (text.startsWith('/')) {
    return handleCommand(msg, text)
  }

  // File received — batch or process immediately
  if (msg.document || msg.photo) {
    return handleDocumentWithBatch(msg)
  }

  // Conversation continuation
  const convo = await getConvo(chatId)

  // Conversation continuation
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

    case '/cliente':
      return handleClientModeCommand(chatId, arg)

    case '/salir':
      return handleExitClientMode(chatId)

    case '/ultimo':
      return handleLastClient(chatId)

    case '/estado':
      if (!arg) return sendMessage(chatId, '🔍 Escribe: <code>/estado CUPS_O_ID</code>')
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
        '<b>Documentos:</b>\n' +
        '  Envía fotos o PDFs directamente\n\n' +
        '<b>Cliente Mode:</b>\n' +
        '/cliente [nombre] — Activar modo cliente\n' +
        '/salir — Desactivar modo cliente\n\n' +
        '<b>Acceso rápido:</b>\n' +
        '/ultimo — Último cliente/suministro\n' +
        '/estado [CUPS] — Ver estado suministro\n' +
        '/nota [CUPS] [text] — Añadir nota rápida\n\n' +
        '<b>Consultas:</b>\n' +
        '/vincular [código] — Vincular cuenta CRM\n' +
        '/mis — Mis suministros con acción pendiente\n' +
        '/buscar [texto] — Buscar cliente o CUPS\n' +
        '/pendientes — Tareas y citas del día\n\n' +
        '📎 Documentos aceptados:\n' +
        '• Facturas de luz/gas\n' +
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
/*  BATCH MODE (NEW)                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleDocumentWithBatch(msg: TelegramMessage) {
  const chatId = msg.chat.id
  const user = await getLinkedUser(chatId)
  if (!user) {
    return sendMessage(chatId,
      '🔒 Primero vincula tu cuenta CRM con <b>/vincular</b> para poder procesar documentos.'
    )
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

  // Check if we're already collecting a batch
  const convo = await getConvo(chatId)
  const now = Date.now()

  if (convo?.step === 'batch_collecting') {
    const lastFileTime = convo.data.batch_last_file_at || 0
    const timeSinceLastFile = now - lastFileTime

    if (timeSinceLastFile > BATCH_TIMEOUT_MS) {
      // Timeout reached — process existing batch first
      await processBatchFiles(chatId, convo.data)
      await clearConvo(chatId)
      // Then create new batch with this file
      return startNewBatch(chatId, fileId, fileType, fileName, msg, user)
    } else {
      // Add to existing batch
      return addToBatch(chatId, fileId, fileType, fileName, msg, convo.data)
    }
  } else {
    // Start new batch
    return startNewBatch(chatId, fileId, fileType, fileName, msg, user)
  }
}

async function startNewBatch(
  chatId: number,
  fileId: string,
  fileType: 'pdf' | 'image',
  fileName: string,
  msg: TelegramMessage,
  user: { userId: string; userName: string }
) {
  const now = Date.now()
  const fileItem = { fileId, fileType, fileName, caption: msg.caption || '', receivedAt: now }

  // Check if user is in client mode
  const existingConvo = await getConvo(chatId)
  const clientModeId = existingConvo?.data?.clientModeId
  const clientModeName = existingConvo?.data?.clientModeName

  await setConvo(chatId, 'batch_collecting', {
    files: [fileItem],
    batch_last_file_at: now,
    userId: user.userId,
    userName: user.userName,
    clientModeId,
    clientModeName,
  })

  const clientModeStr = clientModeName ? ` (👤 ${clientModeName})` : ''
  return sendMessage(chatId, `📥 Documento recibido (1)${clientModeStr}. Sigue enviando o espera unos segundos para procesar...`)
}

async function addToBatch(
  chatId: number,
  fileId: string,
  fileType: 'pdf' | 'image',
  fileName: string,
  msg: TelegramMessage,
  batchData: Record<string, any>
) {
  const now = Date.now()
  const files = batchData.files || []
  files.push({ fileId, fileType, fileName, caption: msg.caption || '', receivedAt: now })

  await setConvo(chatId, 'batch_collecting', {
    ...batchData,
    files,
    batch_last_file_at: now,
  })

  const clientModeStr = batchData.clientModeName ? ` (👤 ${batchData.clientModeName})` : ''
  return sendMessage(chatId, `📥 Documento recibido (${files.length})${clientModeStr}. Sigue enviando o espera unos segundos...`)
}

async function processBatchFiles(chatId: number, batchData: Record<string, any>) {
  const files = batchData.files || []
  if (files.length === 0) return

  await sendChatAction(chatId, 'typing')
  const statusMsg = await sendMessage(chatId, `⏳ Procesando ${files.length} documento${files.length > 1 ? 's' : ''}...`)

  try {
    // Download and classify all files in parallel
    const classifyPromises = files.map(async (file: any) => {
      try {
        const { buffer, fileName: dlFileName } = await downloadFile(file.fileId)
        const base64 = buffer.toString('base64')
        const mimeType = getMimeType(dlFileName || file.fileName, file.fileType)

        // Classify with caption hint
        const caption = (file.caption || '').toLowerCase()
        let hintType: DocumentType | undefined
        if (caption.includes('factura')) hintType = 'factura'
        else if (caption.includes('cif')) hintType = 'cif'
        else if (caption.includes('nif') || caption.includes('dni')) hintType = 'nif'
        else if (caption.includes('iban') || caption.includes('banco')) hintType = 'iban'
        else if (caption.includes('contrato')) hintType = 'contrato'

        let docType: DocumentType
        if (hintType) {
          docType = hintType
        } else {
          const classification = await classifyDocument(base64, mimeType)
          docType = classification.type
        }

        return {
          file,
          base64,
          mimeType,
          docType,
          dlFileName: dlFileName || file.fileName,
          success: true,
        }
      } catch (err: any) {
        console.error('[Telegram] Batch file classify error:', err)
        return {
          file,
          success: false,
          error: err.message,
        }
      }
    })

    const classified = await Promise.all(classifyPromises)
    const successful = classified.filter(c => c.success)
    const failed = classified.filter(c => !c.success)

    if (successful.length === 0) {
      await editMessage(chatId, statusMsg.message_id, '❌ No pude procesar ningún documento.')
      return
    }

    // Analyze all successful files in parallel
    const analyzePromises = successful.map(async (item: any) => {
      if (item.docType === 'factura') {
        const extracted = await analyzeInvoice(item.base64, item.mimeType)
        return { ...item, extracted, analyzed: true }
      } else {
        const extracted = await analyzeDocument(item.base64, item.mimeType, item.docType)
        return { ...item, extracted, analyzed: true }
      }
    })

    const analyzed = await Promise.all(analyzePromises)

    // Group by type
    const invoices = analyzed.filter((a: any) => a.docType === 'factura')
    const clientDocs = analyzed.filter((a: any) => a.docType !== 'factura')

    // For each invoice, check for duplicates and existing supply
    const processedInvoices = []
    for (const inv of invoices) {
      const cups = normalizeCups(inv.extracted.cups || '')
      const supabase = createBotSupabase()

      let existingSupply = null
      if (cups) {
        const { data: supplies } = await supabase
          .from('supplies')
          .select('id, cups, client:clients(id, name)')
          .eq('cups', cups)
          .limit(1)

        if (supplies?.length) existingSupply = supplies[0]
      }

      processedInvoices.push({
        ...inv,
        cups,
        existingSupply,
      })
    }

    // Try to auto-match client docs
    const processedDocs = []
    for (const doc of clientDocs) {
      const docData = doc.extracted
      const searchTerms: string[] = []
      if (docData.cif) searchTerms.push(docData.cif)
      if (docData.nif) searchTerms.push(docData.nif)
      if (docData.holder_name) searchTerms.push(docData.holder_name)

      let matchedClients: any[] = []
      if (searchTerms.length > 0) {
        const supabase = createBotSupabase()
        const orClauses = searchTerms.map(t =>
          `name.ilike.%${t}%,cif_nif.ilike.%${t}%,cif.ilike.%${t}%,nif.ilike.%${t}%`
        ).join(',')

        const { data: clients } = await supabase
          .from('clients')
          .select('id, name, cif_nif')
          .or(orClauses)
          .limit(5)

        matchedClients = clients || []
      }

      let matchedClient = null
      if (matchedClients.length === 1) {
        matchedClient = matchedClients[0]
      }

      processedDocs.push({
        ...doc,
        matchedClients,
        matchedClient,
      })
    }

    // Build batch summary
    let summaryText = `📦 <b>Lote procesado (${successful.length} documento${successful.length > 1 ? 's' : ''})</b>\n`

    if (processedInvoices.length > 0) {
      summaryText += '\n📄 <b>Facturas:</b>\n'
      processedInvoices.forEach((inv: any) => {
        const extracted = inv.extracted
        const tariff = extracted.tariff || '-'
        const total = extracted.total_amount || '-'
        const cups = inv.cups || '-'
        summaryText += `  • CUPS <code>${cups}</code> · ${tariff} · ${total}€\n`
      })
    }

    if (processedDocs.length > 0) {
      summaryText += '\n📎 <b>Documentos:</b>\n'
      processedDocs.forEach((doc: any) => {
        const typeLabel = getDocTypeLabel(doc.docType)
        const holder = doc.extracted.holder_name || '-'
        summaryText += `  • ${typeLabel}: ${holder}\n`
      })
    }

    if (failed.length > 0) {
      summaryText += `\n⚠️ No procesados: ${failed.length}\n`
    }

    // If in client mode, all files auto-associate — process immediately
    if (batchData.clientModeId) {
      summaryText += `\n👤 <b>Cliente:</b> ${batchData.clientModeName}\n`
      summaryText += '\n⏳ Guardando...\n'
      await editMessage(chatId, statusMsg.message_id, summaryText)

      // Process all invoices and docs for this client
      for (const inv of processedInvoices) {
        try {
          await uploadInvoiceAndCreate({
            ...inv,
            clientId: batchData.clientModeId,
            userId: batchData.userId,
            fileBuffer: inv.base64,
            fileType: inv.file.fileType,
            fileName: inv.dlFileName,
            extracted: inv.extracted,
          }, !inv.existingSupply)
        } catch (err: any) {
          console.error('[Telegram] Batch invoice creation error:', err)
        }
      }

      for (const doc of processedDocs) {
        try {
          await saveDocumentToClient(batchData.clientModeId, batchData.clientModeName, {
            docType: doc.docType,
            docData: doc.extracted,
            fileBuffer: doc.base64,
            fileType: doc.file.fileType,
            fileName: doc.dlFileName,
            mimeType: doc.mimeType,
          })
        } catch (err: any) {
          console.error('[Telegram] Batch doc save error:', err)
        }
      }

      summaryText += `✅ ${processedInvoices.length} factura${processedInvoices.length !== 1 ? 's' : ''} + ${processedDocs.length} documento${processedDocs.length !== 1 ? 's' : ''} guardados.`
      return editMessage(chatId, statusMsg.message_id, summaryText)
    }

    // Otherwise, if all matched, auto-create; if not all matched, ask for client
    const allClientDocsMatched = processedDocs.every((d: any) => d.matchedClient)
    const canAutoProcess = processedInvoices.length === 0 && processedDocs.length > 0 && allClientDocsMatched

    if (canAutoProcess) {
      // All docs matched — save automatically
      summaryText += '\n✅ Guardando documentos...\n'
      await editMessage(chatId, statusMsg.message_id, summaryText)

      for (const doc of processedDocs) {
        try {
          await saveDocumentToClient(doc.matchedClient.id, doc.matchedClient.name, {
            docType: doc.docType,
            docData: doc.extracted,
            fileBuffer: doc.base64,
            fileType: doc.file.fileType,
            fileName: doc.dlFileName,
            mimeType: doc.mimeType,
          })
        } catch (err: any) {
          console.error('[Telegram] Batch doc save error:', err)
        }
      }

      summaryText += `✅ ${processedDocs.length} documento${processedDocs.length !== 1 ? 's' : ''} guardados.`
      return editMessage(chatId, statusMsg.message_id, summaryText)
    }

    // Store batch and ask for client assignment
    await setConvo(chatId, 'batch_confirm_client', {
      processedInvoices: processedInvoices.map((i: any) => ({
        base64: i.base64,
        mimeType: i.mimeType,
        docType: i.docType,
        dlFileName: i.dlFileName,
        fileType: i.file.fileType,
        extracted: i.extracted,
        cups: i.cups,
        existingSupply: i.existingSupply,
      })),
      processedDocs: processedDocs.map((d: any) => ({
        base64: d.base64,
        mimeType: d.mimeType,
        docType: d.docType,
        dlFileName: d.dlFileName,
        fileType: d.file.fileType,
        extracted: d.extracted,
      })),
      userId: batchData.userId,
      summaryText,
    })

    summaryText += '\n\n👤 ¿Asignar todo a qué cliente?'
    return editMessage(chatId, statusMsg.message_id, summaryText, inlineKeyboard([
      [button('🔍 Buscar cliente', 'batch_search_client')],
      [button('🆕 Crear cliente nuevo', 'batch_new_client')],
      [button('❌ Cancelar', 'cancel')],
    ]))

  } catch (err: any) {
    console.error('[Telegram] Batch processing error:', err)
    await editMessage(chatId, statusMsg.message_id, `❌ Error procesando lote: ${err.message}`)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CLIENT MODE (NEW)                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleClientModeCommand(chatId: number, arg: string) {
  if (!arg) {
    return sendMessage(chatId, '🔍 Escribe: <code>/cliente [nombre o búsqueda]</code>')
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
    // Auto-select single match
    const client = clients[0]
    const convo = await getConvo(chatId)
    await setConvo(chatId, convo?.step || '', {
      ...(convo?.data || {}),
      clientModeId: client.id,
      clientModeName: client.name,
    })
    return sendMessage(chatId, `📌 <b>Modo cliente activado</b>\n\n👤 ${client.name}\n\nTodos los documentos que envíes se asociarán automáticamente a este cliente.`)
  }

  // Multiple matches — ask to select
  const buttons = clients.map((c: any) =>
    [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `mode_select_client:${c.id}:${c.name}`)]
  )
  buttons.push([button('❌ Cancelar', 'cancel')])

  return sendMessage(chatId, '👤 Selecciona el cliente:', { replyMarkup: inlineKeyboard(buttons) })
}

async function handleExitClientMode(chatId: number) {
  const convo = await getConvo(chatId)
  if (!convo || !convo.data.clientModeId) {
    return sendMessage(chatId, '❌ No estás en modo cliente.')
  }

  const clientName = convo.data.clientModeName
  await setConvo(chatId, convo.step, {
    ...convo.data,
    clientModeId: undefined,
    clientModeName: undefined,
  })

  return sendMessage(chatId, `❌ Modo cliente desactivado.\n\nSaliste de <b>${clientName}</b>.`)
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  QUICK COMMANDS (NEW)                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function handleLastClient(chatId: number) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  const supabase = createBotSupabase()

  // Get last edited supply by this user
  const { data: supplies } = await supabase
    .from('supplies')
    .select('id, cups, tariff, status, client:clients(id, name, commercial_id)')
    .eq('client.commercial_id', user.userId)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (!supplies?.length) {
    return sendMessage(chatId, '📭 No tienes suministros aún.')
  }

  const supply = supplies[0]
  const client = supply.client
  const statusText = getStatusLabel(supply.status)

  return sendMessage(chatId,
    `👤 <b>Último cliente/suministro:</b>\n\n` +
    `${client.name}\n` +
    `CUPS: <code>${supply.cups || '-'}</code>\n` +
    `Tarifa: ${supply.tariff || '-'}\n` +
    `Estado: ${statusText}`,
    { replyMarkup: inlineKeyboard([
      [button('📌 Modo cliente', `mode_select_client:${client.id}:${client.name}`)],
      [button('🔗 Detalles', `quick_supply_details:${supply.id}`)],
    ]) }
  )
}

async function handleSupplyStatus(chatId: number, cupsOrId: string) {
  const user = await getLinkedUser(chatId)
  if (!user) return sendMessage(chatId, '🔒 Vincula tu cuenta primero con /vincular')

  const supabase = createBotSupabase()

  const { data: supply } = await supabase
    .from('supplies')
    .select('id, cups, tariff, type, address, status, client:clients(name), invoices(id, total_amount, created_at)')
    .or(`cups.eq.${cupsOrId},id.eq.${cupsOrId}`)
    .limit(1)
    .single()

  if (!supply) {
    return sendMessage(chatId, `❌ No encontré suministro "<b>${cupsOrId}</b>".`)
  }

  const statusText = getStatusLabel(supply.status)
  const invoiceCount = supply.invoices?.length || 0
  const totalAmount = supply.invoices?.reduce((sum: number, inv: any) => sum + (inv.total_amount || 0), 0) || 0

  return sendMessage(chatId,
    `📊 <b>Estado del suministro</b>\n\n` +
    `👤 Cliente: ${supply.client?.name || '?'}\n` +
    `🔌 CUPS: <code>${supply.cups || '-'}</code>\n` +
    `⚡ Tarifa: ${supply.tariff || '-'}\n` +
    `🏠 Tipo: ${supply.type || '-'}\n` +
    `📍 Dirección: ${supply.address || '-'}\n` +
    `📊 Estado: ${statusText}\n` +
    `📄 Facturas: ${invoiceCount} (${totalAmount}€)\n`,
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

  if (!arg || arg.length < 5) {
    return sendMessage(chatId, '🔍 Escribe: <code>/nota CUPS texto_nota</code>')
  }

  const parts = arg.split(/\s+/)
  const cupsOrId = parts[0]
  const noteText = parts.slice(1).join(' ')

  const supabase = createBotSupabase()
  const { data: supply } = await supabase
    .from('supplies')
    .select('id, cups, client:clients(name)')
    .or(`cups.eq.${cupsOrId},id.eq.${cupsOrId}`)
    .limit(1)
    .single()

  if (!supply) {
    return sendMessage(chatId, `❌ No encontré suministro "<b>${cupsOrId}</b>".`)
  }

  // Append note to client's notes field
  const { data: client } = await supabase
    .from('clients')
    .select('id, notes')
    .eq('id', (supply.client as any)?.id || supply.id)
    .single()

  if (client) {
    const existingNotes = client.notes || ''
    const timestamp = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const newNotes = existingNotes
      ? `${existingNotes}\n[${timestamp}] ${noteText}`
      : `[${timestamp}] ${noteText}`

    await supabase.from('clients').update({ notes: newNotes, updated_at: new Date().toISOString() }).eq('id', client.id)
  }

  return sendMessage(chatId,
    `✅ Nota añadida a <b>${(supply.client as any)?.name || 'suministro'}</b>\n\n` +
    `📝 "${noteText}"`
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  DOCUMENT PROCESSING (unified handler for all file types)                 */
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

  // Check for duplicate invoices (same CUPS + period)
  let duplicateWarning = ''
  if (cups) {
    const period = extracted.billing_period || ''
    const { data: existing } = await supabase
      .from('invoices')
      .select('id, created_at')
      .eq('supply.cups', cups)
      .limit(5)

    if (existing?.length) {
      duplicateWarning = '\n\n⚠️ Advertencia: Esta CUPS ya tiene facturas en el sistema.'
    }
  }

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
      `✅ Este CUPS ya existe en el sistema asignado a <b>${clientName}</b>.` +
      duplicateWarning +
      `\n¿Añadir esta factura al suministro existente?`,
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
      .select('id, name, cif_nif')
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

  // ── Client mode selection ──
  if (data.startsWith('mode_select_client:')) {
    const parts = data.split(':')
    const clientId = parts[1]
    const clientName = parts.slice(2).join(':')
    const existingConvo = await getConvo(chatId)
    await setConvo(chatId, existingConvo?.step || '', {
      ...(existingConvo?.data || {}),
      clientModeId: clientId,
      clientModeName: clientName,
    })
    return editMessage(chatId, msgId, `📌 <b>Modo cliente activado</b>\n\n👤 ${clientName}\n\nTodos los documentos que envíes se asociarán automáticamente a este cliente.`)
  }

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
        `✅ Suministro creado para CUPS <code>${convo.data.cups || 'nuevo'}</code>.\n\n` +
        `👤 Cliente: ${convo.data.clientName || '?'}\n\n` +
        `📌 ¿Qué quieres hacer ahora?`,
        inlineKeyboard([
          [button('📊 Crear estudio', `quick_estudio:${result.supplyId}`)],
          [button('📞 Agendar llamada', `quick_llamada:${result.supplyId}`)],
          [button('📄 Pedir más facturas', `quick_mas_facturas:${result.supplyId}`)],
        ])
      )
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
  }

  // ── Batch: search client ──
  if (data === 'batch_search_client' && convo?.step === 'batch_confirm_client') {
    await setConvo(chatId, 'batch_await_client_search', convo.data)
    return editMessage(chatId, msgId, '🔍 Escribe el nombre del cliente:')
  }

  // ── Quick actions: study, call, more invoices ──
  if (data.startsWith('quick_estudio:')) {
    const supplyId = data.split(':')[1]
    const user = await getLinkedUser(chatId)
    if (user) {
      const supabase = createBotSupabase()
      // Update supply status to indicate study is needed
      await supabase.from('supplies').update({
        status: 'facturas_recibidas',
        updated_at: new Date().toISOString(),
      }).eq('id', supplyId)
      // Create a task for the study
      await supabase.from('tasks').insert({
        title: 'Crear estudio de suministro',
        supply_id: supplyId,
        assigned_to: user.userId,
        status: 'pending',
        priority: 'high',
        created_at: new Date().toISOString(),
      }).then(() => {})
    }
    return editMessage(chatId, msgId, `✅ Tarea creada: <b>Crear estudio</b> para este suministro.`)
  }

  if (data.startsWith('quick_llamada:')) {
    const supplyId = data.split(':')[1]
    const user = await getLinkedUser(chatId)
    if (user) {
      const supabase = createBotSupabase()
      // Get supply info for the task
      const { data: supply } = await supabase
        .from('supplies')
        .select('cups, client:clients(id, name)')
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
    return editMessage(chatId, msgId, `✅ Llamada agendada para mañana a las 10:00.`)
  }

  if (data.startsWith('quick_mas_facturas:')) {
    const supplyId = data.split(':')[1]
    return editMessage(chatId, msgId, `📄 Envíame más facturas de este suministro. Las procesaré automáticamente.`)
  }

  if (data.startsWith('quick_supply_details:')) {
    const supplyId = data.split(':')[1]
    const supabase = createBotSupabase()
    const { data: supply } = await supabase
      .from('supplies')
      .select('id, cups, tariff, type, address, status, client:clients(name), invoices(id, total_amount)')
      .eq('id', supplyId)
      .single()

    if (!supply) return editMessage(chatId, msgId, '❌ Suministro no encontrado.')

    const statusText = getStatusLabel(supply.status)
    const invoiceCount = supply.invoices?.length || 0
    return editMessage(chatId, msgId,
      `📊 <b>Detalles</b>\n\n` +
      `👤 ${(supply.client as any)?.name || '?'}\n` +
      `🔌 CUPS: <code>${supply.cups || '-'}</code>\n` +
      `⚡ Tarifa: ${supply.tariff || '-'}\n` +
      `📊 Estado: ${statusText}\n` +
      `📄 Facturas: ${invoiceCount}`,
      inlineKeyboard([
        [button('📊 Crear estudio', `quick_estudio:${supply.id}`)],
        [button('📞 Agendar llamada', `quick_llamada:${supply.id}`)],
        [button('📝 Añadir nota', `quick_nota:${supply.id}`)],
      ])
    )
  }

  if (data.startsWith('quick_nota:')) {
    const supplyId = data.split(':')[1]
    await setConvo(chatId, 'await_supply_note', { supplyId })
    return editMessage(chatId, msgId, `📝 Escribe la nota:`)
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

  // ── Batch: select client from search ──
  if (data.startsWith('batch_select_client:')) {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    const parts = data.split(':')
    const clientId = parts[1]
    const clientName = parts.slice(2).join(':')

    try {
      await processBatchForClient(chatId, convo.data, clientId, clientName)
    } catch (err: any) {
      return editMessage(chatId, msgId, `❌ Error: ${err.message}`)
    }
    return
  }

  // ── Batch: new client ──
  if (data === 'batch_new_client') {
    if (!convo) return editMessage(chatId, msgId, '⏰ Sesión expirada.')
    // Get holder name from first invoice or doc
    const firstInv = convo.data.processedInvoices?.[0]
    const firstDoc = convo.data.processedDocs?.[0]
    const holderName = firstInv?.extracted?.holder_name || firstDoc?.extracted?.holder_name || ''
    await setConvo(chatId, 'batch_await_new_client_name', convo.data)
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

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'primer_contacto': '📞 Primer contacto',
    'facturas_recibidas': '📄 Facturas recibidas',
    'estudio_completado': '📊 Estudio listo',
    'presentacion_pendiente': '📋 Pendiente presentar',
    'pendiente_firma': '✍️ Pendiente firma',
    'contrato_firmado': '✅ Contrato firmado',
  }
  return labels[status] || status
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
        `✅ <b>Cliente y suministro creados</b>\n\nCliente: ${clientName}\nCUPS: <code>${convo.data.cups || 'Por asignar'}</code>\n\n` +
        `📌 ¿Qué quieres hacer ahora?`,
        inlineKeyboard([
          [button('📊 Crear estudio', `quick_estudio:${result.supplyId}`)],
          [button('📞 Agendar llamada', `quick_llamada:${result.supplyId}`)],
          [button('📄 Pedir más facturas', `quick_mas_facturas:${result.supplyId}`)],
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

  // ── Batch: search client ──
  if (convo.step === 'batch_await_client_search') {
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
          [button('🆕 Crear cliente nuevo', 'batch_new_client')],
          [button('❌ Cancelar', 'cancel')],
        ]) }
      )
    }

    if (clients.length === 1) {
      // Auto-select
      const client = clients[0]
      return processBatchForClient(chatId, convo.data, client.id, client.name)
    }

    await setConvo(chatId, 'batch_choose_client', convo.data)

    const buttons = clients.map((c: any) =>
      [button(`${c.name}${c.cif_nif ? ` (${c.cif_nif})` : ''}`, `batch_select_client:${c.id}:${c.name}`)]
    )
    buttons.push([button('❌ Cancelar', 'cancel')])

    return sendMessage(chatId, '👤 Selecciona el cliente:', { replyMarkup: inlineKeyboard(buttons) })
  }

  // ── Batch: new client name ──
  if (convo.step === 'batch_await_new_client_name') {
    const firstInv = convo.data.processedInvoices?.[0]
    const firstDoc = convo.data.processedDocs?.[0]
    const holderName = firstInv?.extracted?.holder_name || firstDoc?.extracted?.holder_name || ''
    const clientName = text.toLowerCase() === 'ok' ? holderName : text

    if (!clientName) {
      return sendMessage(chatId, '❌ Escribe el nombre del cliente:')
    }

    await sendChatAction(chatId, 'typing')
    const statusMsg = await sendMessage(chatId, `⏳ Creando cliente <b>${clientName}</b>...`)

    try {
      const supabase = createBotSupabase()
      // Collect CIF/NIF from first document
      const docData = firstDoc?.extracted || firstInv?.extracted || {}
      const { data: newClient, error } = await supabase
        .from('clients')
        .insert({
          name: clientName,
          cif_nif: docData.cif || docData.nif || docData.holder_cif_nif || null,
          cif: docData.cif || null,
          nif: docData.nif || null,
          type: docData.cif ? 'empresa' : 'particular',
          fiscal_address: docData.fiscal_address || null,
          commercial_id: convo.data.userId,
          origin: 'captacion',
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (error) throw new Error(`Error creando cliente: ${error.message}`)

      await processBatchForClient(chatId, convo.data, newClient.id, clientName)
    } catch (err: any) {
      return editMessage(chatId, statusMsg.message_id, `❌ Error: ${err.message}`)
    }
    return
  }

  // ── Supply note ──
  if (convo.step === 'await_supply_note') {
    const supplyId = convo.data.supplyId
    const supabase = createBotSupabase()

    // Get client for this supply to update notes
    const { data: supply } = await supabase
      .from('supplies')
      .select('client_id, client:clients(id, notes, name)')
      .eq('id', supplyId)
      .single()

    if (supply?.client) {
      const client = supply.client as any
      const existingNotes = client.notes || ''
      const timestamp = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const newNotes = existingNotes
        ? `${existingNotes}\n[${timestamp}] ${text}`
        : `[${timestamp}] ${text}`
      await supabase.from('clients').update({ notes: newNotes, updated_at: new Date().toISOString() }).eq('id', client.id)
    }

    await clearConvo(chatId)
    return sendMessage(chatId, `✅ Nota guardada: "${text}"`)
  }
}

async function processBatchForClient(
  chatId: number,
  batchData: Record<string, any>,
  clientId: string,
  clientName: string
) {
  const statusMsg = await sendMessage(chatId, `⏳ Procesando lote para <b>${clientName}</b>...`)

  try {
    const processedInvoices = batchData.processedInvoices || []
    const processedDocs = batchData.processedDocs || []

    // Process invoices
    for (const inv of processedInvoices) {
      try {
        await uploadInvoiceAndCreate({
          ...inv,
          clientId,
          userId: batchData.userId,
        }, !inv.existingSupply)
      } catch (err: any) {
        console.error('[Telegram] Batch invoice error:', err)
      }
    }

    // Process docs
    for (const doc of processedDocs) {
      try {
        await saveDocumentToClient(clientId, clientName, {
          docType: doc.docType,
          docData: doc.extracted,
          fileBuffer: doc.base64,
          fileType: doc.fileType,
          fileName: doc.dlFileName,
          mimeType: doc.mimeType,
        })
      } catch (err: any) {
        console.error('[Telegram] Batch doc error:', err)
      }
    }

    await clearConvo(chatId)

    let resultText = `✅ <b>Lote procesado</b>\n\n👤 Cliente: <b>${clientName}</b>\n\n`
    resultText += `✅ ${processedInvoices.length} factura${processedInvoices.length !== 1 ? 's' : ''}\n`
    resultText += `✅ ${processedDocs.length} documento${processedDocs.length !== 1 ? 's' : ''}`

    return editMessage(chatId, statusMsg.message_id, resultText)
  } catch (err: any) {
    console.error('[Telegram] Batch process error:', err)
    return editMessage(chatId, statusMsg.message_id, `❌ Error procesando lote: ${err.message}`)
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
