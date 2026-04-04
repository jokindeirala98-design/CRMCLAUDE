import { NextRequest, NextResponse } from 'next/server'
import { createBotSupabase } from '@/lib/telegram'
import { notifyUser } from '@/lib/telegram'
import { normalizeCups } from '@/lib/utils/cups'

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
 *   3. Analyze with Gemini
 *   4. If CUPS exists → add invoice to existing supply
 *   5. If CUPS new → create supply, notify via Telegram to confirm
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
    const attachments: { buffer: Buffer; name: string; type: 'pdf' | 'image' }[] = []

    // Handle different email provider formats
    // SendGrid: attachment-info (JSON), attachment1, attachment2...
    // Mailgun: attachment-1, attachment-2
    // Generic: look for File entries
    const entries = Array.from(formData.entries())
    for (const [key, value] of entries) {
      if (value instanceof File && value.size > 0) {
        const mime = value.type || ''
        const name = value.name || 'attachment'

        if (mime.includes('pdf') || name.endsWith('.pdf')) {
          const buf = Buffer.from(await value.arrayBuffer())
          attachments.push({ buffer: buf, name, type: 'pdf' })
        } else if (mime.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name)) {
          const buf = Buffer.from(await value.arrayBuffer())
          attachments.push({ buffer: buf, name, type: 'image' })
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

    // ── Process each attachment ──
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

    let processedCount = 0
    let errorCount = 0

    for (const att of attachments) {
      try {
        // Analyze with Gemini
        const base64 = att.buffer.toString('base64')
        const analysisRes = await fetch(`${appUrl}/api/analyze-invoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_base64: base64,
            file_type: att.type,
            file_name: att.name,
          }),
        })

        if (!analysisRes.ok) {
          errorCount++
          continue
        }

        const extracted = await analysisRes.json()
        if (extracted.mode === 'manual' || extracted.error) {
          errorCount++
          continue
        }

        const cups = normalizeCups(extracted.cups)

        // Check if CUPS exists
        let supplyId: string | null = null
        let clientName = ''

        if (cups) {
          const { data: existingSupply } = await supabase
            .from('supplies')
            .select('id, cups, client:clients(id, name)')
            .eq('cups', cups)
            .limit(1)
            .single()

          if (existingSupply) {
            supplyId = existingSupply.id
            clientName = (existingSupply as any).client?.name || ''
          }
        }

        if (supplyId) {
          // ── Add to existing supply ──
          const storagePath = `invoices/${supplyId}/${Date.now()}_email.${att.type === 'pdf' ? 'pdf' : 'jpg'}`
          await supabase.storage.from('documents').upload(storagePath, att.buffer, {
            contentType: att.type === 'pdf' ? 'application/pdf' : 'image/jpeg',
          })
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)

          await supabase.from('invoices').insert({
            supply_id: supplyId,
            file_url: urlData.publicUrl,
            file_type: att.type,
            extracted_data: extracted,
            total_amount: extracted.total_amount ? parseFloat(extracted.total_amount) : null,
            extraction_status: 'completed',
            extraction_confidence: 0.85,
            created_at: new Date().toISOString(),
          })

          processedCount++

          if (chatId) {
            await notifyUser(chatId,
              `📧✅ Factura del email procesada automáticamente.\n\n` +
              `📋 ${extracted.holder_name || '-'}\n` +
              `🔌 <code>${cups}</code>\n` +
              `💰 ${extracted.total_amount || '-'}€\n` +
              `👤 Cliente: ${clientName}\n\n` +
              `<a href="${appUrl}/supplies/${supplyId}">Ver suministro →</a>`
            )
          }
        } else {
          // ── CUPS not in system → notify commercial to decide ──
          if (chatId) {
            await notifyUser(chatId,
              `📧📋 Factura recibida por email (CUPS nuevo):\n\n` +
              `📋 ${extracted.holder_name || '-'}\n` +
              `🔌 <code>${cups || 'No detectado'}</code>\n` +
              `⚡ ${extracted.tariff || '-'}\n` +
              `💰 ${extracted.total_amount || '-'}€\n\n` +
              `Reenvía esta factura como <b>foto/PDF</b> a este chat para crear el suministro.`
            )
          }
          // Still count as processed (notified)
          processedCount++
        }
      } catch (err) {
        console.error('[Email Inbound] Attachment processing error:', err)
        errorCount++
      }
    }

    // Final notification
    if (chatId && (processedCount > 0 || errorCount > 0)) {
      const summary = []
      if (processedCount > 0) summary.push(`${processedCount} procesada${processedCount > 1 ? 's' : ''}`)
      if (errorCount > 0) summary.push(`${errorCount} con error`)
      // Only send summary if multiple attachments
      if (attachments.length > 1) {
        await notifyUser(chatId, `📧 Email procesado: ${summary.join(', ')}`)
      }
    }

    return NextResponse.json({
      message: 'Processed',
      processed: processedCount,
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
  // Handle formats like "Name <email@example.com>" or just "email@example.com"
  const match = from.match(/<([^>]+)>/)
  if (match) return match[1].toLowerCase()
  if (from.includes('@')) return from.trim().toLowerCase()
  return null
}
