/**
 * Telegram bot onboarding — registra/asocia comerciales desde el bot.
 *
 * Flujo:
 *   1. Detectamos un chat_id sin user_profile_id en telegram_conversations.
 *   2. State machine: pedimos nombre → email → creamos cuenta y vinculamos.
 *   3. Generamos password aleatoria; usuario la cambia en el primer acceso.
 *
 * Reglas:
 *   - Emails nicolas@voltisenergia.com / jokin@voltisenergia.com → admin.
 *   - Cualquier otro email → commercial.
 *   - Si el email ya existe en users_profile, NO se degrada el rol; sólo se
 *     vincula el chat_id. Para cambiar rol, hacerlo desde el CRM.
 *   - Si Auth ya tiene el email pero no users_profile, se crea el profile
 *     apuntando al auth.user existente (idempotente).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

// Partículas que NO aportan letra a la abreviatura (apellidos compuestos
// españoles: "Jokin de Irala" → JDI, "María del Carmen Pérez" → MCP).
const NICKNAME_STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'da', 'das', 'do', 'dos',
  'van', 'von', 'di', 'le', 'lo',
])

// Emails con privilegios de admin fijos (no se rebajan jamás).
const ADMIN_EMAILS = new Set([
  'nicolas@voltisenergia.com',
  'jokin@voltisenergia.com',
])

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.trim().toLowerCase())
}

/**
 * "Jokin de Irala" → "JDI"
 * "María del Carmen Pérez Sánchez" → "MCPS" (max 4 letras)
 * "Pep" → "P"
 */
export function deriveNickname(fullName: string): string {
  const words = fullName
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^A-Za-z\s'-]/g, '')                      // strip non-letter except espacios/guiones
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0 && !NICKNAME_STOPWORDS.has(w.toLowerCase()))
  const initials = words.map(w => w.charAt(0).toUpperCase()).join('')
  // Cap a 4 letras para no acabar con MCPSGV…
  return initials.slice(0, 4) || 'X'
}

/**
 * 12 caracteres legibles: a-z A-Z 0-9 (sin caracteres ambiguos 0/O/1/l/I).
 */
export function generatePassword(length = 12): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

/**
 * Validación básica de email. No es RFC-compliant; basta para filtrar
 * errores típicos antes de llamar a Supabase Auth.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * Crea el cliente Supabase admin (service role) para operaciones que
 * requieren bypass de RLS (crear auth.users, insertar profiles, etc.).
 */
function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan credenciales Supabase service role')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export interface OnboardedUser {
  id: string
  email: string
  full_name: string
  nickname: string
  role: 'admin' | 'commercial' | 'manager' | string
  /** Solo presente si acabamos de crear la cuenta. */
  generatedPassword?: string
  /** True si la cuenta ya existía y solo vinculamos el chat. */
  alreadyExisted: boolean
}

/**
 * Busca un users_profile por email. Si existe, devuelve sus datos sin tocar
 * el rol. Si NO existe:
 *   - Crea auth.users con la password generada.
 *   - Crea users_profile con role admin (si email en ADMIN_EMAILS) o commercial.
 *   - Calcula nickname desde fullName si no se proporcionó nickname.
 *
 * No vincula el chat_id — eso lo hace el caller actualizando telegram_conversations.
 */
export async function findOrCreateCommercial(args: {
  email: string
  fullName: string
}): Promise<OnboardedUser> {
  const supabase = getAdminClient()
  const email = args.email.trim().toLowerCase()
  const fullName = args.fullName.trim()
  const nickname = deriveNickname(fullName)

  // 1. ¿Existe ya el users_profile?
  const { data: existingProfile } = await supabase
    .from('users_profile')
    .select('id, email, full_name, nickname, role')
    .eq('email', email)
    .maybeSingle()

  if (existingProfile) {
    return {
      id: existingProfile.id,
      email: existingProfile.email,
      full_name: existingProfile.full_name,
      nickname: existingProfile.nickname || deriveNickname(existingProfile.full_name || fullName),
      role: existingProfile.role,
      alreadyExisted: true,
    }
  }

  // 2. ¿Existe en auth.users (sin profile)? Intentamos buscarlo via admin API.
  //    El SDK no expone búsqueda por email directamente; intentamos crearlo y
  //    si falla con 'already registered', lo recuperamos por listUsers paginado.
  const password = generatePassword(12)
  const role = isAdminEmail(email) ? 'admin' : 'commercial'

  // Permisos: admin todo true; commercial todo false (defaults).
  const permissions = role === 'admin'
    ? { prescorings: true, billing: true, reports: true, settings: true, all_clients: true }
    : { prescorings: false, billing: false, reports: false, settings: false, all_clients: false }

  let authUserId: string | null = null

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, nickname, source: 'telegram_bot' },
  })

  if (created?.user) {
    authUserId = created.user.id
  } else if (createErr && /already.*registered|exists/i.test(createErr.message)) {
    // Email ya en auth.users — recuperamos id paginando listUsers.
    const found = await findAuthUserByEmail(supabase, email)
    if (!found) throw new Error(`auth.users tiene el email pero no podemos recuperarlo: ${email}`)
    authUserId = found.id
    // No reseteamos su password (ya existe). Le decimos al bot que recupere
    // la suya con "Olvidé mi contraseña" en la web si no la recuerda.
  } else if (createErr) {
    throw new Error(`No se pudo crear auth.user: ${createErr.message}`)
  }

  if (!authUserId) throw new Error('Sin auth user id tras crear/recuperar')

  // 3. Crear users_profile vinculado.
  const { data: newProfile, error: profileErr } = await supabase
    .from('users_profile')
    .insert({
      id: authUserId,
      email,
      full_name: fullName,
      nickname,
      role,
      permissions,
      active: true,
    })
    .select('id, email, full_name, nickname, role')
    .single()
  if (profileErr) {
    throw new Error(`No se pudo crear users_profile: ${profileErr.message}`)
  }

  return {
    id: newProfile.id,
    email: newProfile.email,
    full_name: newProfile.full_name,
    nickname: newProfile.nickname || nickname,
    role: newProfile.role,
    generatedPassword: created?.user ? password : undefined,  // solo si la creamos nosotros
    alreadyExisted: false,
  }
}

/**
 * Busca un usuario en auth.users por email paginando listUsers.
 * Costoso si hay muchos usuarios, pero solo se llama en el caso raro de
 * "auth tiene el email pero users_profile no".
 */
async function findAuthUserByEmail(supabase: SupabaseClient, email: string): Promise<{ id: string } | null> {
  let page = 1
  const perPage = 1000
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error || !data?.users?.length) return null
    const found = data.users.find(u => u.email?.toLowerCase() === email)
    if (found) return { id: found.id }
    if (data.users.length < perPage) return null
    page++
  }
  return null
}

/**
 * Asocia el chat_id a un user_profile_id en telegram_conversations.
 * Crea la fila si no existe.
 */
export async function linkChatToUser(supabase: SupabaseClient, chatId: number, userProfileId: string) {
  await supabase
    .from('telegram_conversations')
    .upsert({
      chat_id: chatId,
      user_profile_id: userProfileId,
      step: 'idle',
      data: {},
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'chat_id' })
}
