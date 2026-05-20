/**
 * WhatsApp Cloud API utilities for VOLTIS CRM
 *
 * Wraps Meta's Graph API (v21.0) for the WhatsApp Business Platform.
 *
 * Required env vars:
 *   WHATSAPP_TOKEN              — System User token (or temporary 24h token in dev)
 *   WHATSAPP_PHONE_NUMBER_ID    — ID of the phone number registered in the app
 *   WHATSAPP_APP_SECRET         — App Secret, used to validate X-Hub-Signature-256
 *   WHATSAPP_VERIFY_TOKEN       — Arbitrary string used in the webhook handshake
 *
 * Webhook payload shape (incoming POST from Meta):
 *   {
 *     object: 'whatsapp_business_account',
 *     entry: [{
 *       id: '<WABA_ID>',
 *       changes: [{
 *         field: 'messages',
 *         value: {
 *           messaging_product: 'whatsapp',
 *           metadata: { display_phone_number, phone_number_id },
 *           contacts: [{ profile: { name }, wa_id }],
 *           messages: [{ from, id, timestamp, type, ... }],
 *           statuses?: [{ id, status, timestamp, ... }],
 *         },
 *       }],
 *     }],
 *   }
 */

import crypto from 'crypto'

const GRAPH_VERSION = 'v21.0'

function token(): string {
  const t = process.env.WHATSAPP_TOKEN
  if (!t) throw new Error('WHATSAPP_TOKEN not configured')
  return t
}

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID not configured')
  return id
}

function base(): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId()}`
}

/* ─── Webhook signature ─────────────────────────────────────────────────── */

/**
 * Validates the X-Hub-Signature-256 header against the raw body using the App
 * Secret. Returns true if the signature matches, false otherwise.
 *
 * IMPORTANT: must be called with the *raw* body bytes (NextRequest.text() or
 * a Buffer), NOT the parsed JSON. Any reserialization changes the bytes and
 * breaks the HMAC check.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) {
    console.warn('[WhatsApp] WHATSAPP_APP_SECRET not configured — webhook signature NOT validated')
    // In production we MUST refuse the request if the secret is missing.
    return false
  }
  // Format from Meta: "sha256=<hex>"
  const expected = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader
  const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(computed, 'hex'))
  } catch {
    return false
  }
}

/* ─── Sending messages ──────────────────────────────────────────────────── */

interface SendOpts {
  /** Reply to a specific message id (will appear quoted in WhatsApp). */
  contextMessageId?: string
}

async function postMessage(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${base()}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.error('[WhatsApp] sendMessage failed:', res.status, data)
    throw new Error(`WhatsApp API ${res.status}: ${JSON.stringify(data)}`)
  }
  return data
}

/** Send a plain text message. */
export async function sendText(to: string, body: string, opts?: SendOpts): Promise<any> {
  return postMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body },
    ...(opts?.contextMessageId ? { context: { message_id: opts.contextMessageId } } : {}),
  })
}

/**
 * Send a document by Media ID (uploaded first to /media) or by public URL.
 * Pass mediaIdOrUrl as a Media ID for files we uploaded to Meta, or a public
 * https URL otherwise.
 */
export async function sendDocument(
  to: string,
  mediaIdOrUrl: string,
  filename: string,
  caption?: string,
): Promise<any> {
  const isUrl = /^https?:\/\//i.test(mediaIdOrUrl)
  const doc: Record<string, unknown> = { filename }
  if (caption) doc.caption = caption
  if (isUrl) doc.link = mediaIdOrUrl
  else doc.id = mediaIdOrUrl
  return postMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'document',
    document: doc,
  })
}

/** Mark a message as read (gives the user the blue ticks). */
export async function markRead(messageId: string): Promise<void> {
  try {
    await postMessage({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    })
  } catch (err) {
    // Non-critical
    console.warn('[WhatsApp] markRead failed (non-fatal):', (err as Error).message)
  }
}

/* ─── Media download ────────────────────────────────────────────────────── */

/**
 * Fetch metadata for a media id (gives us the temporary download URL + mime).
 */
async function getMediaInfo(mediaId: string): Promise<{ url: string; mime_type: string; file_size?: number }> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${token()}` },
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`getMediaInfo ${res.status}: ${err}`)
  }
  return res.json()
}

/**
 * Download a media file by its WhatsApp media_id.
 * Returns the raw bytes plus mime type — feed straight into Gemini.
 */
export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const info = await getMediaInfo(mediaId)
  const res = await fetch(info.url, {
    headers: { 'Authorization': `Bearer ${token()}` },
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`downloadMedia ${res.status}: ${err}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  return { buffer: Buffer.from(arrayBuffer), mimeType: info.mime_type }
}

/* ─── Inbound message types (subset we use) ─────────────────────────────── */

export interface WaTextMessage {
  type: 'text'
  text: { body: string }
}

export interface WaImageMessage {
  type: 'image'
  image: { id: string; mime_type: string; sha256: string; caption?: string }
}

export interface WaDocumentMessage {
  type: 'document'
  document: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string }
}

export interface WaAudioMessage {
  type: 'audio'
  audio: { id: string; mime_type: string; sha256: string; voice?: boolean }
}

export interface WaButtonMessage {
  type: 'button' | 'interactive'
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
  button?: { text: string; payload: string }
}

export type WaInboundMessage = (
  | WaTextMessage
  | WaImageMessage
  | WaDocumentMessage
  | WaAudioMessage
  | WaButtonMessage
  | { type: string; [k: string]: any }
) & {
  from: string         // wa_id (phone number)
  id: string           // message id (used for read receipts + reply context)
  timestamp: string
}

export interface WaInboundEntry {
  contact?: { name?: string; wa_id: string }
  message: WaInboundMessage
  phoneNumberId: string
}

/**
 * Parses the Meta webhook payload and yields normalized inbound entries.
 * Skips status updates (delivery/read receipts), keeps only real messages.
 */
export function parseInboundMessages(payload: any): WaInboundEntry[] {
  const out: WaInboundEntry[] = []
  const entries = Array.isArray(payload?.entry) ? payload.entry : []
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      if (change?.field !== 'messages') continue
      const value = change.value || {}
      const phoneNumberId: string = value?.metadata?.phone_number_id || ''
      const contacts: any[] = Array.isArray(value.contacts) ? value.contacts : []
      const messages: any[] = Array.isArray(value.messages) ? value.messages : []
      for (const msg of messages) {
        const contact = contacts.find(c => c.wa_id === msg.from) || contacts[0]
        out.push({
          contact: contact ? { name: contact?.profile?.name, wa_id: contact.wa_id } : undefined,
          message: msg as WaInboundMessage,
          phoneNumberId,
        })
      }
    }
  }
  return out
}

/* ─── Whitelist helper ──────────────────────────────────────────────────── */

/**
 * Returns the list of allowed sender numbers (E.164 without "+"), parsed from
 * WHATSAPP_ALLOWED_NUMBERS env var (comma-separated). Empty → no whitelist
 * applied (every sender is accepted).
 *
 * Example: WHATSAPP_ALLOWED_NUMBERS=34618511959,34666123456
 */
export function isAllowedSender(waId: string): boolean {
  const raw = process.env.WHATSAPP_ALLOWED_NUMBERS
  if (!raw || !raw.trim()) return true
  const allowed = raw.split(',').map(s => s.trim().replace(/[^\d]/g, '')).filter(Boolean)
  if (allowed.length === 0) return true
  const normalized = waId.replace(/[^\d]/g, '')
  return allowed.includes(normalized)
}
