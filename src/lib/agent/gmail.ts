/**
 * Gmail OAuth + envío de correos para el agente comercial.
 *
 * Flow:
 *  1) /api/agent/gmail/connect?u={telegramUserId}  → redirige a Google OAuth.
 *  2) /api/agent/gmail/callback  → Google redirige aquí con `code`.
 *  3) Intercambiamos code por refresh_token + access_token.
 *  4) Guardamos cifrado en gmail_credentials (AES-256-GCM con AGENT_ENCRYPTION_KEY).
 *  5) /api/agent/gmail/send  → envía correo en nombre del comercial.
 *
 * Scope mínimo: gmail.send (no podemos leer la bandeja, solo enviar). Si en el
 * futuro quieres leer respuestas para análisis, añade gmail.readonly.
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send']

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CIFRADO de refresh tokens
// ───────────────────────────────────────────────────────────────────────────

function getKey(): Buffer {
  const raw = process.env.AGENT_ENCRYPTION_KEY
  if (!raw) throw new Error('AGENT_ENCRYPTION_KEY no configurada (32 bytes hex/base64)')
  // Aceptamos hex (64 chars) o base64 (44 chars con padding)
  if (raw.length === 64) return Buffer.from(raw, 'hex')
  return Buffer.from(raw, 'base64').subarray(0, 32)
}

export function encryptToken(plain: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // formato: iv(12)::tag(16)::ciphertext en hex separado por ::
  return `${iv.toString('hex')}::${tag.toString('hex')}::${enc.toString('hex')}`
}

export function decryptToken(enc: string): string {
  const key = getKey()
  const [ivHex, tagHex, ctHex] = enc.split('::')
  if (!ivHex || !tagHex || !ctHex) throw new Error('Formato cifrado inválido')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const dec = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()])
  return dec.toString('utf-8')
}

// ───────────────────────────────────────────────────────────────────────────
// OAUTH ENDPOINTS HELPERS
// ───────────────────────────────────────────────────────────────────────────

function getClientId() {
  const v = process.env.GMAIL_OAUTH_CLIENT_ID
  if (!v) throw new Error('GMAIL_OAUTH_CLIENT_ID no configurado')
  return v
}
function getClientSecret() {
  const v = process.env.GMAIL_OAUTH_CLIENT_SECRET
  if (!v) throw new Error('GMAIL_OAUTH_CLIENT_SECRET no configurado')
  return v
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  token_type: string
  id_token?: string
}> {
  const body = new URLSearchParams({
    code,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`OAuth exchange failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ───────────────────────────────────────────────────────────────────────────
// CREDENTIALS STORAGE
// ───────────────────────────────────────────────────────────────────────────

export async function saveGmailCredentials(params: {
  telegramUserId: number
  gmailAddress: string
  refreshToken: string
  accessToken: string
  expiresInSec: number
}) {
  const sb = admin()
  const expiresAt = new Date(Date.now() + (params.expiresInSec - 60) * 1000).toISOString()
  await sb.from('gmail_credentials').upsert({
    telegram_user_id: params.telegramUserId,
    gmail_address: params.gmailAddress,
    refresh_token_encrypted: encryptToken(params.refreshToken),
    access_token: params.accessToken,
    access_token_expires_at: expiresAt,
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'telegram_user_id' })
}

export async function getValidAccessToken(telegramUserId: number): Promise<{
  accessToken: string
  gmailAddress: string
} | null> {
  const sb = admin()
  const { data } = await sb
    .from('gmail_credentials')
    .select('refresh_token_encrypted, access_token, access_token_expires_at, gmail_address, status')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()

  if (!data || data.status !== 'active') return null

  const expiresAt = data.access_token_expires_at ? new Date(data.access_token_expires_at).getTime() : 0
  const valid = data.access_token && Date.now() < expiresAt
  if (valid) return { accessToken: data.access_token, gmailAddress: data.gmail_address }

  // Refresh
  try {
    const refresh = decryptToken(data.refresh_token_encrypted)
    const t = await refreshAccessToken(refresh)
    const newExpires = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString()
    await sb.from('gmail_credentials').update({
      access_token: t.access_token,
      access_token_expires_at: newExpires,
      last_used_at: new Date().toISOString(),
    }).eq('telegram_user_id', telegramUserId)
    return { accessToken: t.access_token, gmailAddress: data.gmail_address }
  } catch (e: any) {
    await sb.from('gmail_credentials').update({ status: 'error' }).eq('telegram_user_id', telegramUserId)
    return null
  }
}

// ───────────────────────────────────────────────────────────────────────────
// USERINFO — para saber el email del comercial tras OAuth
// ───────────────────────────────────────────────────────────────────────────

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('No pude obtener userinfo')
  const data = await res.json()
  return data.email
}

// ───────────────────────────────────────────────────────────────────────────
// SEND EMAIL
// ───────────────────────────────────────────────────────────────────────────

function buildRawEmail(params: {
  from: string
  to: string
  subject: string
  body: string
}): string {
  const { from, to, subject, body } = params
  // Codificar asunto como UTF-8 base64 para acentos
  const encSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`
  const isHtml = /<[a-z][\s\S]*>/i.test(body)
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encSubject}`,
    'MIME-Version: 1.0',
    isHtml
      ? 'Content-Type: text/html; charset=UTF-8'
      : 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf-8').toString('base64'),
  ]
  const raw = headers.join('\r\n')
  // base64 url-safe
  return Buffer.from(raw, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sendGmailEmail(params: {
  telegramUserId: number
  to: string
  subject: string
  body: string
}): Promise<{ id: string; threadId: string; from: string }> {
  const creds = await getValidAccessToken(params.telegramUserId)
  if (!creds) throw new Error('Gmail no conectado. Pídele al comercial /conectar_gmail')

  const raw = buildRawEmail({
    from: creds.gmailAddress,
    to: params.to,
    subject: params.subject,
    body: params.body,
  })

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { id: data.id, threadId: data.threadId, from: creds.gmailAddress }
}
