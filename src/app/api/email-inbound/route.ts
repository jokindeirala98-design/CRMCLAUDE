import { NextRequest, NextResponse } from 'next/server'
import { createBotSupabase, notifyUser } from '@/lib/telegram'
import { processTelegramInboxItem } from '@/lib/telegram-process'

/**
 * Email Inbound Webhook — receives forwarded invoices from email.
 *
 * Works with SendGrid Inbound Parse, Mailgun, Resend, or Postmark.
 * The email provider POSTs multipart/form-data with:
 *   - from: sender email
 *   - subject: email subject
 *   - attachments: file(s)
 *
 * Flow:
 *   1. Identify commercial by sender email
 *   2. Extract PDF/image attachments
 *   3. For each attachment:
 *      a) Upload to Supabase Storage
 *      b) Create telegram_inbox record (reuse same pipeline)
 *      c) Process via processTelegramInboxItem (Gemini → find/create client → find/create supply → create invoice)
 *   4. Notify commercial via Telegram with results
 *
 * Now supports FULL supply creation for new CUPS (same as Telegram bot).
 */

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    const fromEmail = extractEmail(formData.get('from') as string || formData.get('sender') as string || '')
    const subject = formData.get('subject') as string || ''

    if (!fromEmail) {
      console.error('[Email Inbound] No sender email found')
      return NextResponse.json({ error: 'No sender' }, { status: 400 })
    }

    const supabase = createBotSupabase()

    // ── Find commercial by email ──
    const { data: profile } = await supabase
      .from('users_profile')
      .select('id, full_name, email')
      .eq('email', fromEmail)
      .single()

    if (!profile) {
      console.log(`[Email Inbound] Unknown sender: ${fromEmail}`)
      return NextResponse.json({ error: 'Sender not found in CRM' }, { status: 404 })
    }

    // ── Get Telegram chat for notifications ──
    const { data: telegramLink } = await supabase
      .from('telegram_links')
      .select('telegram_chat_id')
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .single()

    const chatId = telegramLink?.telegram_chat_id

    // ── Extract attachments ──
    const attachments: { buffer: Buffer; name: string; type: 'pdf' | 'image'; mime: string }[] = []

    const entries = Array.from(formData.entries())
    for (const [key, value] of entries) {
      if (value instanceof File && value.size > 0) {
        const mime = value.type || ''
        const name = value.name || 'attachment'

        if (mime.includes('pdf') || name.endsWith('.pdf')) {
          const buf = Buffer.from(await value.arrayBuffer())
          attachments.push({ buffer: buf, name, type: 'pdf', mime: 'application/pdf' })
        } else if (mime.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name)) {
          const buf = Buffer.from(await value.arrayBuffer())
          attachments.push({ buffer: buf, name, type: 'image', mime: mime || 'image/jpeg' })
        }
      }
    }

    if (attachments.length === 0) {
      if (chatId) {
        await notifyUser(chatId,
          `📧 Recibí un email de <b>${fromEmail}</b> pero no tiene adjuntos válidos (PDF o imagen).\n` +
          `Asunto: ${subject || '(sin asunto)'}`
        )
      }
      return NextResponse.json({ message: 'No valid attachments' })
    }

    // ── Notify start ──
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    if (chatId) {
      await notifyUser(chatId,
        `📧 Email recibido de <b>${fromEmail}</b>\n` +
        `📎 ${attachments.length} adjunto${attachments.length !== 1 ? 's' : ''} · Procesando...`
      )
    }

    // ── Process each attachment through the unified pipeline ──
    let processedCount = 0
    let errorCount = 0
    let newSupplies = 0
    let existingSupplies = 0
    const results: { name: string; cups?: string; clientName?: string; isNew: boolean; supplyId?: string; error?: string }[] = []

    for (const att of attachments) {
      try {
        // 1. Upload to Supabase Storage
        const storagePath = `documents/${profile.id}/${Date.now()}_email_${att.name}`
        const { error: uploadErr } = await supabase.storage.from('documents').upload(storagePath, att.buffer, {
          contentType: att.mime,
        })

        let fileUrl = ''
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
          fileUrl = urlData.publicUrl
        }

        // 2. Create telegram_inbox record (reuse same table for unified tracking)
        const { data: inboxRow, error: inboxErr } = await supabase
          .from('telegram_inbox')
          .insert({
            user_id: profile.id,
            chat_id: chatId || 0,
            sender_name: `Email: ${fromEmail}`,
            file_url: fileUrl,
            file_type: att.type,
            file_name: att.name,
            status: 'pending',
          })
          .select('id')
          .single()

        if (inboxErr || !inboxRow) {
          console.error(`[Email Inbound] Failed to create inbox row:`, inboxErr)
          errorCount++
          results.push({ name: att.name, isNew: false, error: 'Error creando registro' })
          continue
        }

        // 3. Process through unified pipeline (Gemini → client match → supply creation → invoice)
        const base64 = att.buffer.toString('base64')
        const result = await processTelegramInboxItem(
          inboxRow.id,
          base64,
          att.mime,
          {
            file_url: fileUrl,
            file_type: att.type,
            file_name: att.name,
            user_id: profile.id,
          }
        )

        if (result.ok && !result.skipped) {
          processedCount++
          if (result.is_existing_supply) {
            existingSupplies++
          } else {
            newSupplies++
          }

          // Get client name for notification
          let clientName = ''
          if (result.client_id) {
            const { data: cl } = await supabase
              .from('clients')
              .select('name')
              .eq('id', result.client_id)
              .single()
            clientName = cl?.name || ''
          }

          results.push({
            name: att.name,
            cups: result.cups || undefined,
            clientName,
            isNew: !result.is_existing_supply,
            supplyId: result.supply_id,
          })
        } else {
          errorCount++
          results.push({ name: att.name, isNew: false, error: result.error || 'Error procesando' })
        }
      } catch (err: any) {
        console.error('[Email Inbound] Attachment processing error:', err)
        errorCount++
        results.push({ name: att.name, isNew: false, error: err.message || 'Error inesperado' })
      }
    }

    // ── Send detailed notification ──
    if (chatId) {
      const lines: string[] = [`📧 <b>Email procesado</b> — ${fromEmail}\n`]

      if (processedCount > 0) {
        lines.push(`✅ ${processedCount} factura${processedCount !== 1 ? 's' : ''} procesada${processedCount !== 1 ? 's' : ''}`)
        if (newSupplies > 0) lines.push(`🆕 ${newSupplies} suministro${newSupplies !== 1 ? 's' : ''} nuevo${newSupplies !== 1 ? 's' : ''}`)
        if (existingSupplies > 0) lines.push(`📂 ${existingSupplies} añadida${existingSupplies !== 1 ? 's' : ''} a suministro${existingSupplies !== 1 ? 's' : ''} existente${existingSupplies !== 1 ? 's' : ''}`)
      }
      if (errorCount > 0) {
        lines.push(`⚠️ ${errorCount} con error`)
      }

      lines.push('')

      // Detail per file (limit to 10 to avoid huge messages)
      const detailResults = results.slice(0, 10)
      for (const r of detailResults) {
        if (r.error) {
          lines.push(`❌ ${r.name}: ${r.error}`)
        } else {
          const emoji = r.isNew ? '🆕' : '📂'
          const cupsStr = r.cups ? `<code>${r.cups}</code>` : 'Sin CUPS'
          const link = r.supplyId ? `<a href="${appUrl}/supplies/${r.supplyId}">Ver →</a>` : ''
          lines.push(`${emoji} ${cupsStr} · ${r.clientName || '-'} ${link}`)
        }
      }

      if (results.length > 10) {
        lines.push(`\n... y ${results.length - 10} más`)
      }

      await notifyUser(chatId, lines.join('\n'))
    }

    return NextResponse.json({
      message: 'Processed',
      processed: processedCount,
      new_supplies: newSupplies,
      existing_supplies: existingSupplies,
      errors: errorCount,
    })
  } catch (err: any) {
    console.error('[Email Inbound] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/* ─── Utility ──────────────────────────────────────────────────────────────── */
function extractEmail(from: string): string | null {
  if (!from) return null
  const match = from.match(/<([^>]+)>/)
  if (match) return match[1].toLowerCase()
  if (from.includes('@')) return from.trim().toLowerCase()
  return null
}
