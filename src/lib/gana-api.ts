/**
 * Cliente HTTP para la API REST de GanaEnergia (externos.ganaenergia.com).
 *
 * Endpoints documentados:
 *   POST /login              → { token }
 *   GET  /tarifas            → lista de tarifas vigentes
 *   GET  /cnae               → lista de CNAEs
 *   POST /validarTelefono    → { valid: bool }
 *   POST /validarIban        → { valid: bool, bic?: string }
 *   GET  /distribuidoras     → lista de distribuidoras
 *   POST /costepotencia      → coste asociado a un nivel de potencia
 *   GET  /subusers           → subusuarios bajo nuestra cuenta maestra
 *   GET  /nacionalidades     → lista de nacionalidades
 *   POST /contract           → crea contrato, devuelve { signaturitUrl, contractId }
 *
 * Estrategia de token:
 *   - El token NO caduca (informe del usuario), pero por seguridad se cachea
 *     en la tabla singleton `gana_tokens`. Si la API devuelve 401 → relogin.
 *   - El token nunca sale al cliente: todos los endpoints proxy viven en
 *     /api/gana/* y usan service_role.
 *
 * Credenciales (env):
 *   GANA_USERNAME   → email de la cuenta maestra
 *   GANA_PASSWORD   → contraseña
 *   GANA_BASE_URL   → opcional, default https://externos.ganaenergia.com
 */

import { createClient } from '@supabase/supabase-js'

const BASE_URL = process.env.GANA_BASE_URL ?? 'https://externos.ganaenergia.com'

type FetchOptions = RequestInit & { skipAuth?: boolean; retry?: boolean }

class GanaApiError extends Error {
  status: number
  body: any
  constructor(msg: string, status: number, body: any) {
    super(msg)
    this.name = 'GanaApiError'
    this.status = status
    this.body = body
  }
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ----------------------------------------------------------------------------
// Token cache (singleton row id=1 en gana_tokens)
// ----------------------------------------------------------------------------

let memoryToken: string | null = null

async function readCachedToken(): Promise<string | null> {
  if (memoryToken) return memoryToken
  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('gana_tokens')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    console.warn('[gana-api] read token error:', error.message)
    return null
  }
  memoryToken = data?.token ?? null
  return memoryToken
}

async function writeCachedToken(token: string, username: string): Promise<void> {
  memoryToken = token
  const supabase = supabaseAdmin()
  const { error } = await supabase
    .from('gana_tokens')
    .upsert({ id: 1, token, username, updated_at: new Date().toISOString() })
  if (error) console.warn('[gana-api] write token error:', error.message)
}

async function clearCachedToken(): Promise<void> {
  memoryToken = null
  // No borramos la fila — la sobreescribiremos con el nuevo token.
}

// ----------------------------------------------------------------------------
// Login
// ----------------------------------------------------------------------------

async function login(): Promise<string> {
  const username = process.env.GANA_USERNAME
  const password = process.env.GANA_PASSWORD
  if (!username || !password) {
    throw new Error('Faltan GANA_USERNAME / GANA_PASSWORD en env')
  }

  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!res.ok) {
    throw new GanaApiError(`Login Gana failed: ${res.status}`, res.status, body)
  }

  // Distintos backends devuelven {token}, {access_token}, {data:{token}}, ...
  const token =
    body?.token ??
    body?.access_token ??
    body?.data?.token ??
    body?.data?.access_token ??
    (typeof body === 'string' ? body : null)

  if (!token) {
    throw new GanaApiError('Login Gana: respuesta sin token', res.status, body)
  }

  await writeCachedToken(String(token), username)
  return String(token)
}

// ----------------------------------------------------------------------------
// Fetch genérico
// ----------------------------------------------------------------------------

async function ganaFetch(path: string, opts: FetchOptions = {}): Promise<any> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`

  let token: string | null = null
  if (!opts.skipAuth) {
    token = await readCachedToken()
    if (!token) token = await login()
  }

  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined ?? {}),
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, { ...opts, headers })

  // Token caducado / inválido → relogin y reintento (una vez)
  if (res.status === 401 && !opts.retry && !opts.skipAuth) {
    await clearCachedToken()
    await login()
    return ganaFetch(path, { ...opts, retry: true })
  }

  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!res.ok) {
    throw new GanaApiError(`Gana ${res.status} ${path}`, res.status, body)
  }

  return body
}

// ----------------------------------------------------------------------------
// Endpoints
// ----------------------------------------------------------------------------

export interface GanaTarifaRaw {
  id?: string | number
  nombre?: string
  name?: string
  tipo?: string
  // Posibles formas en las que Gana puede devolver precios:
  precio_p1?: number; precio_p2?: number; precio_p3?: number
  energia_p1?: number; energia_p2?: number; energia_p3?: number
  potencia_p1?: number; potencia_p2?: number
  pot_p1?: number; pot_p2?: number
  [k: string]: any
}

export async function fetchTarifas(): Promise<GanaTarifaRaw[]> {
  const data = await ganaFetch('/tarifas', { method: 'GET' })
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.tarifas)) return data.tarifas
  return []
}

export interface ValidarIbanResult {
  valid: boolean
  bic?: string
  bank?: string
  raw: any
}

export async function validarIban(iban: string): Promise<ValidarIbanResult> {
  const data = await ganaFetch('/validarIban', {
    method: 'POST',
    body: JSON.stringify({ iban: iban.replace(/\s+/g, '').toUpperCase() }),
  })
  const valid = Boolean(data?.valid ?? data?.isValid ?? data?.data?.valid ?? data?.status === 'ok')
  return {
    valid,
    bic: data?.bic ?? data?.data?.bic,
    bank: data?.bank ?? data?.entity ?? data?.data?.bank,
    raw: data,
  }
}

export interface ValidarTelefonoResult {
  valid: boolean
  raw: any
}

export async function validarTelefono(telefono: string): Promise<ValidarTelefonoResult> {
  const data = await ganaFetch('/validarTelefono', {
    method: 'POST',
    body: JSON.stringify({ telefono: telefono.replace(/\s+/g, '') }),
  })
  const valid = Boolean(data?.valid ?? data?.isValid ?? data?.data?.valid ?? data?.status === 'ok')
  return { valid, raw: data }
}

export interface DistribuidoraGana {
  id: string | number
  nombre: string
  codigo?: string
  raw: any
}

export async function fetchDistribuidoras(): Promise<DistribuidoraGana[]> {
  const data = await ganaFetch('/distribuidoras', { method: 'GET' })
  const arr: any[] = Array.isArray(data) ? data : (data?.data ?? data?.distribuidoras ?? [])
  return arr.map(d => ({
    id: d.id ?? d.codigo ?? d.code,
    nombre: d.nombre ?? d.name ?? '',
    codigo: d.codigo ?? d.code,
    raw: d,
  }))
}

export interface CnaeGana {
  codigo: string
  descripcion: string
}

export async function fetchCnaes(): Promise<CnaeGana[]> {
  const data = await ganaFetch('/cnae', { method: 'GET' })
  const arr: any[] = Array.isArray(data) ? data : (data?.data ?? [])
  return arr.map(c => ({
    codigo: String(c.codigo ?? c.code ?? c.id ?? ''),
    descripcion: String(c.descripcion ?? c.description ?? c.nombre ?? c.name ?? ''),
  }))
}

export interface CostePotenciaArgs {
  tarifa: string
  potenciaP1: number
  potenciaP2?: number
  distribuidoraId?: string | number
}

export async function fetchCostePotencia(args: CostePotenciaArgs): Promise<any> {
  return ganaFetch('/costepotencia', {
    method: 'POST',
    body: JSON.stringify({
      tarifa: args.tarifa,
      p1: args.potenciaP1,
      p2: args.potenciaP2 ?? args.potenciaP1,
      distribuidora: args.distribuidoraId,
    }),
  })
}

// ----------------------------------------------------------------------------
// Contract
// ----------------------------------------------------------------------------

export interface CreateContractArgs {
  // Titular
  titular_nombre: string
  titular_cif_nif: string
  // Domicilio fiscal (puede coincidir con el de suministro)
  direccion: {
    via: string
    numero: string
    codigo_postal: string
    municipio: string
    provincia: string
  }
  direccion_suministro?: CreateContractArgs['direccion']
  // Contacto
  email: string
  telefono: string
  // Bancario
  iban: string
  // Suministro
  cups: string
  tarifa_atr: string             // '2.0TD'
  tarifa_gana_id: string | number
  potencia_p1_kw: number
  potencia_p2_kw: number
  // Metadatos
  cnae?: string
  observaciones?: string
}

export interface CreateContractResult {
  ok: boolean
  signaturitUrl?: string
  contractId?: string
  raw: any
}

export async function createContract(args: CreateContractArgs): Promise<CreateContractResult> {
  const payload = {
    titular: {
      nombre: args.titular_nombre,
      nif: args.titular_cif_nif,
      email: args.email,
      telefono: args.telefono,
    },
    direccion_fiscal: args.direccion,
    direccion_suministro: args.direccion_suministro ?? args.direccion,
    iban: args.iban.replace(/\s+/g, '').toUpperCase(),
    cups: args.cups,
    tarifa_atr: args.tarifa_atr,
    tarifa_id: args.tarifa_gana_id,
    potencia: {
      p1: args.potencia_p1_kw,
      p2: args.potencia_p2_kw,
    },
    cnae: args.cnae,
    observaciones: args.observaciones,
  }

  try {
    const data = await ganaFetch('/contract', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const signaturitUrl =
      data?.signaturitUrl ??
      data?.signaturit_url ??
      data?.data?.signaturitUrl ??
      data?.url
    const contractId = data?.contractId ?? data?.id ?? data?.data?.contractId
    return { ok: true, signaturitUrl, contractId, raw: data }
  } catch (e: any) {
    return { ok: false, raw: { error: e?.message, body: e?.body } }
  }
}

// ----------------------------------------------------------------------------
// Refresh helpers (para endpoint admin)
// ----------------------------------------------------------------------------

export type GanaTarifaTipo = 'fija_24h' | 'tramos' | 'mercado'

/**
 * Heurística para clasificar el nombre de tarifa que devuelve Gana.
 * Los nombres pueden variar; cubrir variantes comunes.
 */
export function classifyTarifa(nombre: string): GanaTarifaTipo | null {
  const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (n.includes('24h') || n.includes('fija') || n.includes('plana')) return 'fija_24h'
  if (n.includes('tramo') || n.includes('horario') || n.includes('escalonad')) return 'tramos'
  if (n.includes('mercado') || n.includes('indexad') || n.includes('pvpc') || n.includes('spot')) return 'mercado'
  return null
}

/**
 * Normaliza precios de una respuesta cruda de Gana a las columnas de
 * gana_tarifas. Devuelve null si no hay datos suficientes.
 */
export function normalizeTarifaRow(raw: GanaTarifaRaw): {
  precio_p1: number | null
  precio_p2: number | null
  precio_p3: number | null
  potencia_p1: number | null
  potencia_p2: number | null
} {
  return {
    precio_p1: raw.precio_p1 ?? raw.energia_p1 ?? raw.p1 ?? null,
    precio_p2: raw.precio_p2 ?? raw.energia_p2 ?? raw.p2 ?? null,
    precio_p3: raw.precio_p3 ?? raw.energia_p3 ?? raw.p3 ?? null,
    potencia_p1: raw.potencia_p1 ?? raw.pot_p1 ?? raw.p1_pot ?? null,
    potencia_p2: raw.potencia_p2 ?? raw.pot_p2 ?? raw.p2_pot ?? null,
  }
}

export { GanaApiError }
