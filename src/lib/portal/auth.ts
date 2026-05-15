/**
 * Portal Cliente v2 — Autenticación
 * ──────────────────────────────────────────────────────────────────────────
 * Sistema de login por email + magic link + sesión persistente (30 días).
 *
 * Flujo:
 *  1) Cliente introduce su email en /login
 *  2) Si existe un portal_user activo con ese email, generamos un token
 *     URL-safe (32 bytes hex = 64 chars) y lo guardamos en
 *     portal_magic_links con expiración 30 min
 *  3) Le mandamos el email con el enlace https://cliente.voltisenergia.com/auth/callback?token=...
 *  4) El callback canjea el token: crea una sesión persistente, setea
 *     cookie httpOnly 30 días, invalida el magic link, redirige a /inicio
 *  5) En cada request, el middleware valida la cookie buscando el hash
 *     en portal_sessions; si es válida, renueva last_seen_at
 *
 * Crítico: este módulo usa SUPABASE_SERVICE_ROLE_KEY directamente (no
 * pasa por auth.uid del CRM). Nunca exponer estas funciones desde rutas
 * que el cliente final pueda llamar — solo desde server-side API routes
 * /api/portal/*.
 */
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'crypto'

// ── Constantes ───────────────────────────────────────────────────────────

export const PORTAL_SESSION_COOKIE = 'voltis_portal_v2_session'
export const PORTAL_SESSION_DAYS = 30
export const MAGIC_LINK_EXPIRY_MIN = 30

// ── Tipos ────────────────────────────────────────────────────────────────

export interface PortalUser {
  id: string
  clientId: string
  email: string
  displayName: string | null
  role: 'viewer' | 'admin'
  active: boolean
}

export interface PortalSession {
  id: string
  portalUserId: string
  expiresAt: string
}

export interface PortalContext {
  user: PortalUser
  session: PortalSession
  /** Conveniencia: id del cliente al que pertenece el usuario. */
  clientId: string
}

// ── Cliente Supabase con service role ────────────────────────────────────

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  }
  return createAdmin(url, key, { auth: { persistSession: false } })
}

// ── Generación de tokens ─────────────────────────────────────────────────

/** Genera un token URL-safe de 64 caracteres (32 bytes hex). */
export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/** Hash SHA-256 del token para almacenarlo en la BBDD. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── Magic link ───────────────────────────────────────────────────────────

export interface CreateMagicLinkResult {
  /** Token plano (solo se devuelve UNA vez, para incluirlo en el email). */
  token: string
  /** URL completa al callback con el token. */
  url: string
  /** Email al que se envió (normalizado). */
  email: string
  portalUserId: string
  expiresAt: Date
}

/**
 * Crea un magic link para un email.
 *
 * - Si el email no existe en portal_users (o está inactivo), devuelve
 *   `null` SIN crear nada y SIN exponer si el email existe o no
 *   (defensa contra enumeración de usuarios).
 * - Si existe, genera token, lo guarda y devuelve la URL para el email.
 */
export async function createMagicLink(
  emailRaw: string,
  baseUrl: string,
  options: { ip?: string } = {},
): Promise<CreateMagicLinkResult | null> {
  const email = emailRaw.trim().toLowerCase()
  if (!email || !email.includes('@')) return null

  const sb = adminClient()

  const { data: user, error: userErr } = await sb
    .from('portal_users')
    .select('id, client_id, email, display_name, role, active')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle()

  if (userErr || !user) return null

  const token = generateToken()
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MIN * 60 * 1000)

  const { error: insertErr } = await sb.from('portal_magic_links').insert({
    token,
    portal_user_id: user.id,
    email_lower: email,
    expires_at: expiresAt.toISOString(),
    request_ip: options.ip || null,
  })
  if (insertErr) return null

  // Audit log (no bloquea el flujo si falla)
  await sb.from('portal_audit_log').insert({
    portal_user_id: user.id,
    client_id: user.client_id,
    action: 'request_magic_link',
    ip: options.ip || null,
  }).then(() => {}, () => {})

  return {
    token,
    url: `${baseUrl.replace(/\/$/, '')}/auth/callback?token=${encodeURIComponent(token)}`,
    email,
    portalUserId: user.id,
    expiresAt,
  }
}

// ── Canjeo de magic link → sesión persistente ────────────────────────────

export interface ConsumeMagicLinkResult {
  /** Token PLANO de la cookie de sesión (no se vuelve a almacenar en BD). */
  sessionToken: string
  user: PortalUser
  expiresAt: Date
}

/**
 * Canjea un magic link por una sesión persistente. Idempotente: si el
 * token ya se usó, devuelve null. Crea el registro en portal_sessions
 * con el token hasheado.
 */
export async function consumeMagicLink(
  token: string,
  metadata: { ip?: string; userAgent?: string } = {},
): Promise<ConsumeMagicLinkResult | null> {
  if (!token || token.length < 32) return null

  const sb = adminClient()

  const { data: link, error: linkErr } = await sb
    .from('portal_magic_links')
    .select('token, portal_user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (linkErr || !link) return null
  if (link.used_at) return null
  if (new Date(link.expires_at) < new Date()) return null

  const { data: user, error: userErr } = await sb
    .from('portal_users')
    .select('id, client_id, email, display_name, role, active')
    .eq('id', link.portal_user_id)
    .maybeSingle()

  if (userErr || !user || !user.active) return null

  const sessionToken = generateToken()
  const tokenHash = hashToken(sessionToken)
  const expiresAt = new Date(Date.now() + PORTAL_SESSION_DAYS * 24 * 60 * 60 * 1000)

  // Marcar magic link como usado + crear sesión + actualizar last_login (atómico-ish)
  const { error: sessionErr } = await sb.from('portal_sessions').insert({
    portal_user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    user_agent: metadata.userAgent || null,
    ip: metadata.ip || null,
  })
  if (sessionErr) return null

  await sb.from('portal_magic_links')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)

  await sb.from('portal_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id)

  await sb.from('portal_audit_log').insert({
    portal_user_id: user.id,
    client_id: user.client_id,
    action: 'login',
    ip: metadata.ip || null,
    user_agent: metadata.userAgent || null,
  }).then(() => {}, () => {})

  return {
    sessionToken,
    expiresAt,
    user: {
      id: user.id,
      clientId: user.client_id,
      email: user.email,
      displayName: user.display_name,
      role: user.role as 'viewer' | 'admin',
      active: user.active,
    },
  }
}

// ── Validación de sesión en cada request ─────────────────────────────────

/**
 * Resuelve una cookie de sesión a su PortalContext. Devuelve null si la
 * sesión no existe, está revocada o ha expirado. Actualiza last_seen_at
 * en cada validación para detectar sesiones zombi.
 */
export async function resolveSession(
  sessionTokenPlain: string,
): Promise<PortalContext | null> {
  if (!sessionTokenPlain || sessionTokenPlain.length < 32) return null

  const sb = adminClient()
  const tokenHash = hashToken(sessionTokenPlain)

  const { data: session, error: sErr } = await sb
    .from('portal_sessions')
    .select('id, portal_user_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (sErr || !session) return null
  if (session.revoked_at) return null
  if (new Date(session.expires_at) < new Date()) return null

  const { data: user, error: uErr } = await sb
    .from('portal_users')
    .select('id, client_id, email, display_name, role, active')
    .eq('id', session.portal_user_id)
    .maybeSingle()

  if (uErr || !user || !user.active) return null

  // Renovamos last_seen_at (best effort, no bloquea)
  sb.from('portal_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', session.id)
    .then(() => {}, () => {})

  return {
    user: {
      id: user.id,
      clientId: user.client_id,
      email: user.email,
      displayName: user.display_name,
      role: user.role as 'viewer' | 'admin',
      active: user.active,
    },
    session: {
      id: session.id,
      portalUserId: session.portal_user_id,
      expiresAt: session.expires_at,
    },
    clientId: user.client_id,
  }
}

// ── Cerrar sesión ────────────────────────────────────────────────────────

export async function revokeSession(sessionTokenPlain: string): Promise<void> {
  if (!sessionTokenPlain) return
  const sb = adminClient()
  const tokenHash = hashToken(sessionTokenPlain)
  await sb.from('portal_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
}

// ── Audit helper ─────────────────────────────────────────────────────────

export async function auditLog(args: {
  ctx?: PortalContext | null
  action: string
  resourceId?: string | null
  metadata?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  const sb = adminClient()
  await sb.from('portal_audit_log').insert({
    portal_user_id: args.ctx?.user.id || null,
    client_id: args.ctx?.clientId || null,
    action: args.action,
    resource_id: args.resourceId || null,
    metadata: args.metadata ? JSON.parse(JSON.stringify(args.metadata)) : null,
    ip: args.ip || null,
    user_agent: args.userAgent || null,
  }).then(() => {}, () => {})
}
