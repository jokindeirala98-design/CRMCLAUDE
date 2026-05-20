/**
 * WhatsApp Cloud API webhook
 *
 * GET  — Meta handshake. Returns `hub.challenge` when `hub.verify_token`
 *        matches WHATSAPP_VERIFY_TOKEN.
 *
 * POST — Receives inbound messages. Validates `X-Hub-Signature-256` with
 *        WHATSAPP_APP_SECRET, parses messages, dispatches by type.
 *
 * MVP scope (this iteration):
 *   • text messages           → reply "recibido" (smoke test)
 *   • image / document / audio→ download media, ack to sender, queue for
 *                               processing (TODO: hook into invoice pipeline)
 *
 * Future iterations will reuse the heavy lifting from telegram-process.ts
 * (smartAnalyzeInvoice, supply detection, prescoring, identity flow). For
 * now the goal is to pass Meta's verification and confirm the round-trip
 * works end-to-end.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyWebhookSignature,
  parseInboundMessages,
  sendText,
  markRead,
  downloadMedia,
  isAllowedSender,
  type WaInboundEntry,
} from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 60

// ── GET: handshake ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (!expected) {
    console.error('[WA webhook] WHATSAPP_VERIFY_TOKEN not configured')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  if (mode === 'subscribe' && token === expected && challenge) {
    console.log('[WA webhook] handshake OK')
    // Meta expects raw text body with the challenge value, status 200
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  console.warn('[WA webhook] handshake failed', { mode, tokenMatch: token === expected })
  return new NextResponse('Forbidden', { status: 403 })
}

// ── POST: inbound messages ──────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // Meta retries failed deliveries up to 7 days, so we MUST return 200 once we
  // accept the payload. We never throw past this boundary unless validation
  // fails.
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('[WA webhook] invalid signature, rejecting')
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch (err) {
    console.error('[WA webhook] invalid JSON:', err)
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const entries = parseInboundMessages(payload)
  if (entries.length === 0) {
    // Most likely a status update (delivered/read receipts). Ignore quietly.
    return NextResponse.json({ ok: true })
  }

  // Process each message — do NOT block the response on heavy work.
  // For now we do it inline (simple, easy to debug); when we add the invoice
  // pipeline we'll move to a queue (Supabase function / Vercel cron).
  for (const entry of entries) {
    try {
      await handleInboundMessage(entry)
    } catch (err) {
      console.error('[WA webhook] handler failed:', err)
      // Don't let one failure poison the whole batch.
    }
  }

  return NextResponse.json({ ok: true })
}

// ── Message handler ─────────────────────────────────────────────────────────

async function handleInboundMessage(entry: WaInboundEntry): Promise<void> {
  const { message, contact, phoneNumberId } = entry
  const from = message.from
  const senderName = contact?.name || from

  if (!isAllowedSender(from)) {
    console.warn(`[WA webhook] sender ${from} not in whitelist, ignoring`)
    return
  }

  // Acknowledge (blue ticks). Non-critical if it fails.
  markRead(message.id).catch(() => {})

  console.log(
    `[WA webhook] message from ${senderName} (${from}) type=${message.type} phone_number_id=${phoneNumberId}`,
  )

  switch (message.type) {
    case 'text': {
      const body = (message as any).text?.body || ''
      const trimmed = body.trim().toLowerCase()
      if (trimmed === 'ping') {
        await sendText(from, 'pong', { contextMessageId: message.id })
        return
      }
      if (trimmed === '/help' || trimmed === 'help' || trimmed === 'ayuda') {
        await sendText(from, [
          'Bot Voltis CRM — comandos disponibles:',
          '',
          '• Envía una *foto* o *PDF* de una factura y la procesaré automáticamente.',
          '• Envía un CIF/NIF y lo vincularé al cliente.',
          '• "ping" — comprobar si el bot está vivo.',
          '',
          'En esta versión de prueba solo confirmo recepción. El procesamiento completo llegará en próximas iteraciones.',
        ].join('\n'))
        return
      }
      // Default echo for the MVP
      await sendText(
        from,
        `Recibido: "${body.slice(0, 200)}". Estoy en modo de prueba; pronto procesaré documentos.`,
        { contextMessageId: message.id },
      )
      return
    }

    case 'image':
    case 'document': {
      const mediaContainer: any =
        (message as any)[message.type] || {}
      const mediaId: string | undefined = mediaContainer.id
      const filename: string | undefined = mediaContainer.filename
      const caption: string | undefined = mediaContainer.caption
      if (!mediaId) {
        await sendText(from, 'No he podido extraer el archivo. ¿Puedes reenviarlo?')
        return
      }
      // Probe download to verify token + media access work end-to-end.
      try {
        const { buffer, mimeType } = await downloadMedia(mediaId)
        const sizeKb = Math.round(buffer.length / 1024)
        console.log(
          `[WA webhook] downloaded media id=${mediaId} mime=${mimeType} size=${sizeKb}KB filename=${filename || 'n/a'}`,
        )
        await sendText(
          from,
          `Documento recibido (${sizeKb} KB${filename ? `, ${filename}` : ''})${
            caption ? `\nCaption: ${caption}` : ''
          }.\n\nEn esta versión confirmo recepción; el procesamiento automático (Gemini + alta en CRM) se está implementando.`,
          { contextMessageId: message.id },
        )
      } catch (err) {
        console.error('[WA webhook] downloadMedia failed:', err)
        await sendText(
          from,
          'Recibí tu archivo pero no he podido descargarlo aún. Te aviso cuando esté listo.',
          { contextMessageId: message.id },
        )
      }
      return
    }

    case 'audio':
    case 'voice': {
      await sendText(
        from,
        'Recibí una nota de audio. El procesado de audios llegará más adelante; de momento envíame PDF/foto de la factura.',
        { contextMessageId: message.id },
      )
      return
    }

    default: {
      console.log(`[WA webhook] unsupported message type: ${message.type}`)
      await sendText(
        from,
        `Tipo de mensaje "${message.type}" no soportado todavía. Envía texto, foto o PDF.`,
        { contextMessageId: message.id },
      )
      return
    }
  }
}
