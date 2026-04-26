/**
 * Telegram Bot utilities for VOLTIS CRM
 *
 * Handles: sending messages, inline keyboards, file downloads, webhook setup.
 * Bot token stored in TELEGRAM_BOT_TOKEN env var.
 */

const API = 'https://api.telegram.org/bot'

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN not configured')
  return t
}

/* ─── Core API call ────────────────────────────────────────────────────────── */
async function tg(method: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!data.ok) {
    console.error(`[Telegram] ${method} failed:`, data)
    throw new Error(data.description || 'Telegram API error')
  }
  return data.result
}

/* ─── Message sending ──────────────────────────────────────────────────────── */
export async function sendMessage(
  chatId: number | string,
  text: string,
  opts?: {
    parseMode?: 'HTML' | 'MarkdownV2'
    replyMarkup?: InlineKeyboard | ReplyKeyboard
  }
): Promise<any> {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts?.parseMode || 'HTML',
    reply_markup: opts?.replyMarkup,
  })
}

export async function editMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboard
): Promise<any> {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  })
}

export async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  await tg('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  })
}

export async function sendChatAction(chatId: number | string, action: string = 'typing'): Promise<void> {
  await tg('sendChatAction', { chat_id: chatId, action })
}

/* ─── Document sending ─────────────────────────────────────────────────────── */
/**
 * Send a file (Buffer) as a Telegram document.
 * Uses multipart/form-data as required by the Telegram Bot API.
 */
export async function sendDocument(
  chatId: number | string,
  fileBuffer: Buffer,
  fileName: string,
  caption?: string,
): Promise<any> {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('document', new Blob([new Uint8Array(fileBuffer)]), fileName)
  if (caption) {
    form.append('caption', caption)
    form.append('parse_mode', 'HTML')
  }
  const res = await fetch(`${API}${token()}/sendDocument`, { method: 'POST', body: form })
  const data = await res.json()
  if (!data.ok) {
    console.error(`[Telegram] sendDocument failed:`, data)
    throw new Error(data.description || 'Telegram sendDocument error')
  }
  return data.result
}

/* ─── File handling ────────────────────────────────────────────────────────── */
export async function getFileUrl(fileId: string): Promise<string> {
  const file = await tg('getFile', { file_id: fileId })
  return `https://api.telegram.org/file/bot${token()}/${file.file_path}`
}

export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const file = await tg('getFile', { file_id: fileId })
  const url = `https://api.telegram.org/file/bot${token()}/${file.file_path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to download file from Telegram')
  const buffer = Buffer.from(await res.arrayBuffer())
  const fileName = file.file_path?.split('/').pop() || 'file'
  return { buffer, fileName }
}

/* ─── Webhook management ───────────────────────────────────────────────────── */
export async function setWebhook(url: string): Promise<void> {
  const body: Record<string, unknown> = {
    url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  }
  // Include secret_token so Telegram signs every incoming update.
  // The webhook handler verifies this via X-Telegram-Bot-Api-Secret-Token.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret) body.secret_token = secret
  await tg('setWebhook', body)
  console.log(`[Telegram] Webhook set to: ${url}${secret ? ' (with secret)' : ''}`)
}

export async function deleteWebhook(): Promise<void> {
  await tg('deleteWebhook', { drop_pending_updates: true })
}

export async function getWebhookInfo(): Promise<any> {
  return tg('getWebhookInfo')
}

/* ─── Inline keyboard helpers ──────────────────────────────────────────────── */
export interface InlineButton {
  text: string
  callback_data: string
}

export interface InlineKeyboard {
  inline_keyboard: InlineButton[][]
}

export interface ReplyKeyboard {
  keyboard: { text: string }[][]
  resize_keyboard: boolean
  one_time_keyboard: boolean
}

export function inlineKeyboard(rows: InlineButton[][]): InlineKeyboard {
  return { inline_keyboard: rows }
}

export function button(text: string, data: string): InlineButton {
  return { text, callback_data: data }
}

/* ─── Notification helper (call from any CRM event) ───────────────────────── */
export async function notifyUser(chatId: number | string, text: string): Promise<boolean> {
  try {
    await sendMessage(chatId, text)
    return true
  } catch (err) {
    console.error(`[Telegram] Failed to notify chat ${chatId}:`, err)
    return false
  }
}

/* ─── Supabase admin client for bot operations ─────────────────────────────── */
export function createBotSupabase() {
  const { createClient } = require('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}
