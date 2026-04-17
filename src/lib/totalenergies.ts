/**
 * TotalEnergies SIPS Gas integration — Multi-strategy approach.
 *
 * Strategy 0 (PRIMARY): Gigya CDC REST API login → obtain st2.s.* session token
 * Strategy 1: Direct User/Password headers on data endpoints (no login step)
 * Strategy 2: LoginPost → extract token → use token on data endpoints
 * Strategy 3: Manual token from env var (fallback)
 * Strategy 4: CNMC official SIPS API (if configured)
 *
 * The Gigya login automates token refresh — no more manual token updates.
 */

import type { SipsData } from '@/lib/sips'

// ─── Config ─────────────────────────────────────────────────────────
const SIGE_BASE = 'https://apipatotallb.sigeenergia.com'
const SIPS_GAS_URL = `${SIGE_BASE}/api/v1/SIPS/GAS/GetClientesPost`
const LOGIN_URL = `${SIGE_BASE}/api/v1/Usuario/LoginPost`

// Gigya CDC (SAP Customer Data Cloud) for automated login
// The API key is bound to TotalEnergies' private Gigya domain — only works there.
const GIGYA_BASE = 'https://gigya.connectpro.totalenergies.com'
const GIGYA_API_KEY = '3_86LLJ8oxhMd9Tk27SuTp5z9SstBGZ8I--VIgS89iQ8RMT-79QfXT8yluZyVzr5tQ'
const GIGYA_CLIENT_ID = 'C3t1SR2NgvteSa4VR6rJUJxg'

// ─── Cached state ───────────────────────────────────────────────────
let cachedToken: string | null = null
let tokenExpiry = 0

// ─── Credentials helper ─────────────────────────────────────────────

function getCredentials(): { email: string; password: string } | null {
  const email = process.env.TOTALENERGIES_EMAIL
  const password = process.env.TOTALENERGIES_PASSWORD
  if (!email || !password) return null
  return { email, password }
}

// ─── Common headers ─────────────────────────────────────────────────

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://agentes.totalenergies.es',
  'Referer': 'https://agentes.totalenergies.es/',
}

// ─── Request body for SIPS Gas ──────────────────────────────────────

function sipsBody(cups: string): string {
  return JSON.stringify({
    CodigoCUPS: cups,
    NombreEmpresaDistribuidora: '',
    CodigoPostalPS: '',
    CodigoProvinciaPS: '',
    CodigoTarifaATREnVigor: '',
    IsExist: true,
    ListCUPS: '',
    LoadAllDatosCliente: true,
    LoadConsumos: true,
    MunicipioPS: '',
  })
}

// ─── Try-fetch helper ───────────────────────────────────────────────

interface FetchAttempt {
  label: string
  response: Response | null
  status: number
  error?: string
}

async function tryFetch(
  label: string,
  url: string,
  opts: RequestInit
): Promise<FetchAttempt> {
  try {
    const r = await fetch(url, opts)
    if (r.ok) {
      dbg(`${label}:${r.status}OK`)
      return { label, response: r, status: r.status }
    }
    const body = await r.text().catch(() => '')
    const clean = body.substring(0, 200).replace(/<[^>]+>/g, '').trim().substring(0, 80)
    dbg(`${label}:${r.status}[${clean}]`)
    return { label, response: null, status: r.status, error: clean }
  } catch (err: any) {
    dbg(`${label}:ERR[${err.message.substring(0, 60)}]`)
    return { label, response: null, status: 0, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  STRATEGY 0 (PRIMARY): Gigya CDC REST API Login
//  Calls accounts.login directly with email+password to get a
//  session token (st2.s.*), then uses it on the SIPS API.
//  This eliminates the need for manual token updates.
// ═══════════════════════════════════════════════════════════════════

async function tryGigyaLogin(cups: string): Promise<Response | null> {
  const creds = getCredentials()
  if (!creds) { dbg('S0:no_creds'); return null }

  // Check if we have a cached token that hasn't expired
  if (cachedToken && Date.now() < tokenExpiry) {
    dbg('S0:using_cached_token')
    const res = await tryFetch('GigyaCached', SIPS_GAS_URL, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${cachedToken}` },
      body: sipsBody(cups),
    })
    if (res.response) return res.response
    cachedToken = null
    tokenExpiry = 0
    dbg('S0:cached_expired')
  }

  dbg('S0:GigyaLogin')

  try {
    // Step 1: Call Gigya accounts.login — replicate exact portal parameters
    // Portal sends APIKey (uppercase), cid, authMode, sdk, etc.
    const loginParams = new URLSearchParams({
      loginID: creds.email,
      password: creds.password,
      APIKey: GIGYA_API_KEY,
      cid: GIGYA_CLIENT_ID,
      targetEnv: 'jssdk',
      include: 'profile,data,',
      includeUserInfo: 'true',
      sessionExpiration: '-2',
      lang: 'en',
      sdk: 'js_latest',
      authMode: 'cookie',
      pageURL: 'https://connectpro.totalenergies.com/oidc_index?gig_client_id=' + GIGYA_CLIENT_ID,
      sdkBuild: '1535',
      format: 'json',
    })

    const gigyaRes = await fetch(`${GIGYA_BASE}/accounts.login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'Origin': 'https://connectpro.totalenergies.com',
        'Referer': 'https://connectpro.totalenergies.com/',
      },
      body: loginParams.toString(),
    })

    const gigyaBody = await gigyaRes.text()
    dbg(`S0:status=${gigyaRes.status}:len=${gigyaBody.length}`)

    let gigyaData: any
    try { gigyaData = JSON.parse(gigyaBody) } catch {
      dbg(`S0:not_json=${gigyaBody.substring(0, 100)}`)
      return null
    }

    dbg(`S0:errCode=${gigyaData.errorCode}`)

    if (gigyaData.errorCode !== 0) {
      dbg(`S0:Gigya:err=${gigyaData.errorCode}:${(gigyaData.errorMessage || gigyaData.errorDetails || '').substring(0, 80)}`)
      return null
    }

    // Extract session token from response
    const sessionToken = gigyaData.sessionInfo?.sessionToken ||
                         gigyaData.sessionToken ||
                         gigyaData.id_token ||
                         null

    // Also check cookies in response (Gigya sometimes returns token via Set-Cookie)
    let cookieToken: string | null = null
    const setCookie = gigyaRes.headers.get('set-cookie') || ''
    const gltMatch = setCookie.match(/glt_[^=]+=([^;]+)/)
    if (gltMatch) {
      cookieToken = gltMatch[1]
      dbg(`S0:cookie_token=${cookieToken.substring(0, 25)}...`)
    }

    const finalToken = sessionToken || cookieToken

    if (!finalToken) {
      dbg(`S0:no_token keys=[${Object.keys(gigyaData).join(',')}]`)
      if (gigyaData.sessionInfo) {
        dbg(`S0:sessionInfo=[${JSON.stringify(gigyaData.sessionInfo).substring(0, 100)}]`)
      }
      // Log UID for debugging (indicates successful auth even without token)
      if (gigyaData.UID) dbg(`S0:UID=${gigyaData.UID.substring(0, 20)}`)
      return null
    }

    dbg(`S0:Gigya:token=${finalToken.substring(0, 25)}...`)

    // Cache the token (Gigya sessions last ~6h, we'll use 5h to be safe)
    cachedToken = finalToken
    tokenExpiry = Date.now() + 5 * 60 * 60 * 1000

    // Step 2: Use the session token on the SIPS data endpoint
    const body = sipsBody(cups)

    // Try Bearer auth first (this is what the portal uses)
    const r1 = await tryFetch('Gigya(Bearer)', SIPS_GAS_URL, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${finalToken}` },
      body,
    })
    if (r1.response) return r1.response

    // If Bearer fails, the SIPS API might need a SigeEnergia session via LoginPost
    dbg('S0:trying_LoginPost_with_gigya_token')
    const loginRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Authorization': `Bearer ${finalToken}`,
      },
      body: JSON.stringify({}),
    })

    if (loginRes.ok) {
      const loginBody = await loginRes.text()
      dbg(`S0:LoginPost:${loginRes.status}:${loginBody.substring(0, 80)}`)

      let sigeToken: string | null = null
      const authHeader = loginRes.headers.get('Authorization')
      if (authHeader) sigeToken = authHeader.replace(/^Bearer\s+/i, '')
      if (!sigeToken) {
        try {
          const d = JSON.parse(loginBody)
          sigeToken = d.token || d.Token || d.access_token || d.sessionToken || null
        } catch {}
      }

      if (sigeToken) {
        dbg(`S0:SigeToken=${sigeToken.substring(0, 25)}...`)
        const r2 = await tryFetch('Gigya(SigeToken)', SIPS_GAS_URL, {
          method: 'POST',
          headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${sigeToken}` },
          body,
        })
        if (r2.response) return r2.response
      }
    } else {
      dbg(`S0:LoginPost:${loginRes.status}`)
    }

    // Try Validacion header
    const r3 = await tryFetch('Gigya(Validacion)', SIPS_GAS_URL, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Validacion': finalToken },
      body,
    })
    if (r3.response) return r3.response

  } catch (err: any) {
    dbg(`S0:err=${err.message.substring(0, 80)}`)
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════
//  STRATEGY 1: Direct credentials on data endpoint
//  The CORS config allows User/Password headers — some SigeEnergia
//  APIs accept inline credentials without a prior login step.
// ═══════════════════════════════════════════════════════════════════

async function tryDirectCredentials(cups: string): Promise<Response | null> {
  const creds = getCredentials()
  if (!creds) { dbg('S1:no_creds'); return null }

  dbg('S1:DirectCreds')
  const body = sipsBody(cups)

  // 1a: User + Password headers
  const r1 = await tryFetch('Direct(User+Pass)', SIPS_GAS_URL, {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'User': creds.email, 'Password': creds.password },
    body,
  })
  if (r1.response) return r1.response

  // 1b: User + Password + Validacion (email as validation)
  const r2 = await tryFetch('Direct(User+Pass+Val)', SIPS_GAS_URL, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'User': creds.email,
      'Password': creds.password,
      'Validacion': creds.email,
    },
    body,
  })
  if (r2.response) return r2.response

  // 1c: Basic Auth header
  const basic = Buffer.from(`${creds.email}:${creds.password}`).toString('base64')
  const r3 = await tryFetch('Direct(BasicAuth)', SIPS_GAS_URL, {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'Authorization': `Basic ${basic}` },
    body,
  })
  if (r3.response) return r3.response

  return null
}

// ═══════════════════════════════════════════════════════════════════
//  STRATEGY 2: LoginPost → extract token → use on data endpoint
//  Log the FULL response from LoginPost to understand what it returns.
// ═══════════════════════════════════════════════════════════════════

async function tryLoginThenFetch(cups: string): Promise<Response | null> {
  const creds = getCredentials()
  if (!creds) { dbg('S2:no_creds'); return null }

  dbg('S2:LoginPost')

  // Step A: Try LoginPost and log EVERYTHING it returns
  let token: string | null = null

  const loginHeaders = {
    ...BASE_HEADERS,
    'User': creds.email,
    'Password': creds.password,
  }

  try {
    const loginRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ User: creds.email, Password: creds.password }),
    })

    dbg(`Login:status=${loginRes.status}`)

    // Capture ALL response headers
    const headerEntries: string[] = []
    loginRes.headers.forEach((val, key) => {
      headerEntries.push(`${key}=${val.substring(0, 40)}`)
    })
    dbg(`Login:hdrs=[${headerEntries.join(',')}]`)

    // Read and log body
    const bodyText = await loginRes.text()
    dbg(`Login:body=${bodyText.substring(0, 150).replace(/\s+/g, ' ')}`)

    if (loginRes.ok) {
      // Try to extract token from headers
      token = loginRes.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ||
              loginRes.headers.get('Validacion') ||
              loginRes.headers.get('Token') ||
              null

      // Try to extract from body
      if (!token && bodyText) {
        try {
          const data = JSON.parse(bodyText)
          // Check ALL possible token fields
          token = data.token || data.Token || data.access_token ||
                  data.sessionToken || data.bearerToken || data.SessionToken ||
                  data.Authorization || data.authorization ||
                  data.Validacion || data.validacion ||
                  data.Result?.Token || data.result?.token ||
                  data.Result?.Validacion || data.data?.token ||
                  null

          // If body is a simple string (quoted token)
          if (!token && typeof data === 'string' && data.length > 20) {
            token = data
          }

          // Log all keys for debugging
          if (!token) {
            const keys = Object.keys(data)
            dbg(`Login:keys=[${keys.join(',')}]`)
            // Check if any value looks like a token
            for (const k of keys) {
              const v = data[k]
              if (typeof v === 'string' && v.length > 30) {
                dbg(`Login:token_in_"${k}"=${v.substring(0, 30)}`)
                token = v
                break
              }
            }
          }
        } catch {
          // Not JSON — check for raw token
          const st2 = bodyText.match(/(st2\.s\.[A-Za-z0-9._-]{50,})/)
          if (st2) token = st2[1]
          // Or if body itself is a token-like string
          if (!token && bodyText.length > 30 && bodyText.length < 500 && !bodyText.includes('<')) {
            token = bodyText.trim()
          }
        }
      }
    }
  } catch (err: any) {
    dbg(`Login:err=${err.message.substring(0, 60)}`)
  }

  if (!token) {
    dbg('S2:no_token_from_login')
    return null
  }

  dbg(`S2:got_token=${token.substring(0, 25)}...`)
  cachedToken = token
  tokenExpiry = Date.now() + 5 * 60 * 60 * 1000

  // Step B: Use token on data endpoint with various header styles
  const body = sipsBody(cups)
  const styles: Array<{ label: string; headers: Record<string, string> }> = [
    { label: 'Bearer', headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${token}` } },
    { label: 'Validacion', headers: { ...BASE_HEADERS, 'Validacion': token } },
    { label: 'RawAuth', headers: { ...BASE_HEADERS, 'Authorization': token } },
    { label: 'Bearer+Val', headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${token}`, 'Validacion': token } },
    { label: 'Bearer+Creds', headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${token}`, 'User': creds.email, 'Password': creds.password } },
  ]

  for (const { label, headers } of styles) {
    const r = await tryFetch(`Token(${label})`, SIPS_GAS_URL, {
      method: 'POST', headers, body,
    })
    if (r.response) return r.response
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════
//  STRATEGY 3: Manual token
//
//  Fuentes posibles, por orden:
//    3a. Supabase (tabla external_sessions.provider='totalenergies')
//        — lo escribe el bookmarklet tras login manual. No requiere redeploy.
//    3b. Env var TOTALENERGIES_TOKEN (legacy fallback).
// ═══════════════════════════════════════════════════════════════════

async function getTokenFromSupabase(): Promise<string | null> {
  try {
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) { dbg('S3:supa:no_env'); return null }

    const supabase = createClient(url, key)
    const { data, error } = await supabase
      .from('external_sessions')
      .select('token, expires_at')
      .eq('provider', 'totalenergies')
      .maybeSingle()

    if (error) { dbg(`S3:supa:err=${error.message.substring(0, 60)}`); return null }
    if (!data) { dbg('S3:supa:empty'); return null }

    const expires = new Date(data.expires_at).getTime()
    const now = Date.now()
    if (expires <= now) {
      dbg(`S3:supa:expired(${Math.round((now - expires) / 60_000)}m ago)`)
      return null
    }

    const mins = Math.round((expires - now) / 60_000)
    dbg(`S3:supa:ok(${mins}m left)`)
    return data.token as string
  } catch (err: any) {
    dbg(`S3:supa:crash=${err.message?.substring(0, 60)}`)
    return null
  }
}

async function tryManualToken(cups: string): Promise<Response | null> {
  // 3a: Supabase first
  let token = await getTokenFromSupabase()
  let source = 'Supa'

  // 3b: env var fallback
  if (!token) {
    const envToken = process.env.TOTALENERGIES_TOKEN
    if (envToken) {
      token = envToken.replace(/^Bearer\s+/i, '').trim()
      source = 'Env'
    }
  }

  if (!token || token.length < 50) {
    dbg('S3:no_token')
    return null
  }

  dbg(`S3:ManualToken(${source})`)
  const body = sipsBody(cups)

  const r = await tryFetch(`ManualToken(${source})`, SIPS_GAS_URL, {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${token}` },
    body,
  })

  if (r.status === 401) {
    dbg(`S3:expired(${source})`)
    return null
  }

  return r.response
}

// ═══════════════════════════════════════════════════════════════════
//  STRATEGY 4: CNMC Official SIPS API
//  The CNMC provides direct SIPS data access for registered marketers.
//  Endpoint: api.cnmc.gob.es/verticales/v1/SIPS/consulta/v1/
// ═══════════════════════════════════════════════════════════════════

async function tryCnmcSips(cups: string): Promise<SipsData | null> {
  const token = process.env.CNMC_OAUTH_TOKEN
  if (!token) return null

  dbg('S4:CNMC')

  try {
    // Fetch supply point data
    const psRes = await fetch(
      `https://api.cnmc.gob.es/verticales/v1/SIPS/consulta/v1/SIPS2_PS_GAS.csv?cups=${cups}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    )
    if (!psRes.ok) {
      dbg(`S4:CNMC_PS=${psRes.status}`)
      return null
    }

    // Fetch consumption data
    const consumoRes = await fetch(
      `https://api.cnmc.gob.es/verticales/v1/SIPS/consulta/v1/SIPS2_CONSUMOS_GAS.csv?cups=${cups}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    )

    const psText = await psRes.text()
    const consumoText = consumoRes.ok ? await consumoRes.text() : ''

    return parseCnmcCsv(cups, psText, consumoText)
  } catch (err: any) {
    dbg(`S4:CNMC_err=${err.message.substring(0, 50)}`)
    return null
  }
}

function parseCnmcCsv(cups: string, psCsv: string, consumoCsv: string): SipsData {
  const result: SipsData = { cups }

  // Parse PS (supply point) CSV
  const psLines = psCsv.split('\n').filter(l => l.trim())
  if (psLines.length >= 2) {
    const headers = psLines[0].split(';').map(h => h.trim().replace(/"/g, ''))
    const values = psLines[1].split(';').map(v => v.trim().replace(/"/g, ''))
    const ps: Record<string, string> = {}
    headers.forEach((h, i) => { ps[h] = values[i] || '' })

    result.distribuidora = ps['NOMBRE_EMPRESA_DISTRIBUIDORA'] || ps['NombreEmpresaDistribuidora'] || undefined
    result.tariff = mapGasTariff(ps['CODIGO_PEAJE_EN_VIGOR'] || ps['CodigoPeajeEnVigor'])
    result.codigoPostal = ps['CODIGO_POSTAL_PS'] || ps['CodigoPostalPS'] || undefined
    result.municipio = ps['DES_MUNICIPIO_PS'] || ps['DesMunicipioPS'] || undefined
    result.provincia = ps['DES_PROVINCIA_PS'] || ps['DesProvinciaPS'] || undefined
  }

  // Parse consumption CSV
  const consumoLines = consumoCsv.split('\n').filter(l => l.trim())
  if (consumoLines.length >= 2) {
    const headers = consumoLines[0].split(';').map(h => h.trim().replace(/"/g, ''))
    const history: SipsData['consumptionHistory'] = []

    for (let i = 1; i < consumoLines.length; i++) {
      const values = consumoLines[i].split(';').map(v => v.trim().replace(/"/g, ''))
      const row: Record<string, string> = {}
      headers.forEach((h, j) => { row[h] = values[j] || '' })

      const p1 = Math.round(parseFloat(row['CONSUMO_EN_WH_P1'] || row['ConsumoEnWhP1'] || '0'))
      const p2 = Math.round(parseFloat(row['CONSUMO_EN_WH_P2'] || row['ConsumoEnWhP2'] || '0'))
      history.push({
        fecha: row['FECHA_FIN_MES_CONSUMO'] || row['FechaFinMesConsumo'] || '',
        fechaInicio: row['FECHA_INICIO_MES_CONSUMO'] || row['FechaInicioMesConsumo'] || '',
        fechaFin: row['FECHA_FIN_MES_CONSUMO'] || row['FechaFinMesConsumo'] || '',
        P1: p1, P2: p2, P3: 0, P4: 0, P5: 0, P6: 0,
        total: p1 + p2,
      })
    }

    if (history.length > 0) {
      result.consumptionHistory = history
      const total = history.reduce((s, e) => s + e.total, 0)
      result.totalConsumptionKwh = total
      result.totalConsumption = `${Math.round(total).toLocaleString('es-ES')} kWh`
      result.consumoPeriodos = { P1: total, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    }
  }

  // Set defaults
  if (!result.consumptionHistory) {
    result.consumptionHistory = []
    result.totalConsumptionKwh = 0
    result.totalConsumption = '0 kWh'
    result.consumoPeriodos = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  }
  result.potenciaContratada = result.potenciaContratada || { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  result.maximetroHistory = result.maximetroHistory || []
  result.reactivaHistory = result.reactivaHistory || []

  return result
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN: Orchestrate all strategies — collects detailed debug info
// ═══════════════════════════════════════════════════════════════════

// Global debug log for the current request (included in error messages)
let debugLog: string[] = []

function dbg(msg: string) {
  debugLog.push(msg)
  console.log(`[TE] ${msg}`)
}

export async function fetchTotalEnergiesSipsGas(
  cups: string,
  _token?: string
): Promise<SipsData> {
  debugLog = [] // reset for this request
  const creds = getCredentials()
  dbg(`CUPS=${cups}, creds=${creds ? creds.email : 'NONE'}, manualToken=${process.env.TOTALENERGIES_TOKEN ? 'SET' : 'NONE'}`)

  if (!creds && !process.env.TOTALENERGIES_TOKEN) {
    throw new Error('No hay credenciales configuradas. Configura TOTALENERGIES_EMAIL + TOTALENERGIES_PASSWORD en Vercel.')
  }

  // ── Strategy 0: Gigya automated login (PRIMARY — no manual token needed) ──
  try {
    const res = await tryGigyaLogin(cups)
    if (res) {
      const data = await res.json()
      dbg('S0 SUCCESS')
      return parseSigeResponse(cups, data)
    }
  } catch (err: any) {
    dbg(`S0 ERR: ${err.message.substring(0, 80)}`)
  }

  // ── Strategy 1: Direct credentials (fastest, no login step) ──
  try {
    const res = await tryDirectCredentials(cups)
    if (res) {
      const data = await res.json()
      dbg('S1 SUCCESS')
      return parseSigeResponse(cups, data)
    }
  } catch (err: any) {
    dbg(`S1 ERR: ${err.message.substring(0, 80)}`)
  }

  // ── Strategy 2: LoginPost → token → fetch ──
  try {
    const res = await tryLoginThenFetch(cups)
    if (res) {
      const data = await res.json()
      dbg('S2 SUCCESS')
      return parseSigeResponse(cups, data)
    }
  } catch (err: any) {
    dbg(`S2 ERR: ${err.message.substring(0, 80)}`)
  }

  // ── Strategy 3: Manual token from env ──
  try {
    const res = await tryManualToken(cups)
    if (res) {
      const data = await res.json()
      dbg('S3 SUCCESS')
      return parseSigeResponse(cups, data)
    }
  } catch (err: any) {
    dbg(`S3 ERR: ${err.message.substring(0, 80)}`)
  }

  // ── Strategy 4: CNMC official API ──
  try {
    const cnmc = await tryCnmcSips(cups)
    if (cnmc) {
      dbg('S4 SUCCESS')
      return cnmc
    }
  } catch (err: any) {
    dbg(`S4 ERR: ${err.message.substring(0, 80)}`)
  }

  // All strategies failed — include FULL debug log in error
  const fullDebug = debugLog.join(' → ')
  throw new Error(`SIPS Gas debug: ${fullDebug}`)
}

// ─── SigeEnergia response parser ───────────────────────────────────

interface SigeClienteSips {
  CodigoCUPS: string
  CodigoEmpresaDistribuidora?: string
  NombreEmpresaDistribuidora?: string
  CodigoPostalPS?: string
  MunicipioPS?: string
  CodigoProvinciaPS?: string
  DesProvinciaPS?: string
  DesMunicipioPS?: string
  TipoViaPS?: string
  ViaPS?: string
  NumFincaPS?: string
  PisoPS?: string
  PuertaPS?: string
  EscaleraPS?: string
  PortalPS?: string
  CodigoPeajeEnVigor?: string
  Cnae?: string
  CaudalMaximoDiarioEnWh?: number
  FechaAltaSuministro?: string
  FechaUltimoMovimientoContrato?: string
  FechaUltimoCambioComercializador?: string
  FechaUltimaLectura?: string
  CodigoTarifaATREnVigor?: string
  TipoPerfilConsumo?: string
  [key: string]: any
}

interface SigeConsumoSips {
  CodigoCUPS: string
  FechaInicioMesConsumo: string
  FechaFinMesConsumo: string
  CodigoTarifaPeaje?: string
  ConsumoEnWhP1: number
  ConsumoEnWhP2: number
  [key: string]: any
}

interface SigeSipsResponse {
  ClientesSips: SigeClienteSips[]
  ConsumosSips: SigeConsumoSips[]
  DatosTitular: any
}

function parseSigeResponse(cups: string, data: SigeSipsResponse): SipsData {
  const result: SipsData = { cups }

  // Log raw response structure for debugging
  const keys = Object.keys(data || {})
  console.log(`[TE] Response keys: ${keys.join(', ')}`)
  if (data?.ClientesSips) console.log(`[TE] ClientesSips count: ${data.ClientesSips.length}`)
  if (data?.ConsumosSips) console.log(`[TE] ConsumosSips count: ${data.ConsumosSips.length}`)

  const cliente = data?.ClientesSips?.[0]
  if (cliente) {
    result.distribuidora = cliente.NombreEmpresaDistribuidora || undefined
    result.codigoPostal = cliente.CodigoPostalPS || undefined
    result.provincia = cliente.DesProvinciaPS || cliente.CodigoProvinciaPS || undefined
    result.municipio = cliente.DesMunicipioPS || undefined
    result.cnae = cliente.Cnae || undefined
    result.fechaAlta = cliente.FechaAltaSuministro || undefined
    result.fechaUltimaLectura = cliente.FechaUltimaLectura || undefined
    result.tariff = mapGasTariff(cliente.CodigoPeajeEnVigor) ||
                    mapGasTariff(cliente.CodigoTarifaATREnVigor)
    const addr = buildAddress(cliente)
    if (addr) (result as any).address = addr
  }

  if (Array.isArray(data?.ConsumosSips) && data.ConsumosSips.length > 0) {
    const sorted = [...data.ConsumosSips].sort(
      (a, b) =>
        new Date(a.FechaInicioMesConsumo).getTime() -
        new Date(b.FechaInicioMesConsumo).getTime()
    )

    // Log first entry for debugging — check if ConsumoEnWh (total) field exists
    const sample = sorted[0]
    dbg(`ConsumoSample: P1=${sample.ConsumoEnWhP1} P2=${sample.ConsumoEnWhP2} total=${sample.ConsumoEnWh} dates=${sample.FechaInicioMesConsumo}→${sample.FechaFinMesConsumo}`)
    dbg(`ConsumosSips count: ${sorted.length} entries`)

    // For gas: prefer ConsumoEnWh (total field) if it exists and differs from P1,
    // otherwise fall back to P1. Do NOT round per-entry to preserve precision.
    result.consumptionHistory = sorted.map(entry => {
      const p1 = entry.ConsumoEnWhP1 || 0
      const totalField = entry.ConsumoEnWh != null ? Number(entry.ConsumoEnWh) : null
      const consumption = (totalField != null && totalField > 0) ? totalField : p1
      return {
        fecha: entry.FechaFinMesConsumo,
        fechaInicio: entry.FechaInicioMesConsumo,
        fechaFin: entry.FechaFinMesConsumo,
        P1: Math.round(consumption), P2: 0, P3: 0, P4: 0, P5: 0, P6: 0,
        total: consumption,
      }
    })

    // "Consumo Anual" = last 12 entries (matching TotalEnergies portal)
    // The SIPS DB may return 18-24 months of data; portal sums only the last 12.
    const last12 = result.consumptionHistory.slice(-12)
    const annualKwh = last12.reduce((s, e) => s + e.total, 0)
    const allKwh = result.consumptionHistory.reduce((s, e) => s + e.total, 0)
    dbg(`Consumo: annual(last12)=${Math.round(annualKwh)} allTime(${result.consumptionHistory.length}entries)=${Math.round(allKwh)}`)

    result.totalConsumptionKwh = Math.round(annualKwh)
    result.totalConsumption = `${Math.round(annualKwh).toLocaleString('es-ES')} kWh`
    result.consumoPeriodos = { P1: Math.round(annualKwh), P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  } else {
    result.totalConsumptionKwh = 0
    result.totalConsumption = '0 kWh'
    result.consumoPeriodos = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    result.consumptionHistory = []
  }

  result.potenciaContratada = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  result.maximetroHistory = []
  result.reactivaHistory = []

  return result
}

// ─── Gas tariff mapping ─────────────────────────────────────────────

function mapGasTariff(code: string | null | undefined): string | undefined {
  if (!code) return undefined
  const c = code.toUpperCase().trim()
  const map: Record<string, string> = {
    'R1': 'RL.1', 'RL1': 'RL.1', 'RL.1': 'RL.1', 'RLTB5': 'RL.1',
    'R2': 'RL.2', 'RL2': 'RL.2', 'RL.2': 'RL.2',
    'R3': 'RL.3', 'RL3': 'RL.3', 'RL.3': 'RL.3',
    'R4': 'RL.4', 'RL4': 'RL.4', 'RL.4': 'RL.4',
  }
  return map[c] || c
}

// ─── Address builder ────────────────────────────────────────────────

function buildAddress(c: SigeClienteSips): string {
  const parts: string[] = []
  if (c.TipoViaPS && c.ViaPS) {
    parts.push(`${c.TipoViaPS} ${c.ViaPS}`)
  } else if (c.ViaPS) {
    parts.push(c.ViaPS)
  }
  if (c.NumFincaPS && c.NumFincaPS !== '0' && c.NumFincaPS !== '0000') {
    parts.push(c.NumFincaPS.replace(/^0+/, ''))
  }
  const floor: string[] = []
  if (c.EscaleraPS) floor.push(`Esc. ${c.EscaleraPS}`)
  if (c.PisoPS) floor.push(`${c.PisoPS}`)
  if (c.PuertaPS) floor.push(c.PuertaPS)
  if (floor.length) parts.push(floor.join(' '))
  if (c.CodigoPostalPS) parts.push(c.CodigoPostalPS)
  if (c.DesMunicipioPS) parts.push(c.DesMunicipioPS)
  if (c.DesProvinciaPS && c.DesProvinciaPS !== c.DesMunicipioPS) {
    parts.push(c.DesProvinciaPS)
  }
  return parts.join(', ')
}

// ─── Token management (for route.ts compatibility) ──────────────────

export async function getTotalEnergiesToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 10 * 60 * 1000) {
    return cachedToken
  }

  // Manual token
  const manual = process.env.TOTALENERGIES_TOKEN
  if (manual) {
    const clean = manual.replace(/^Bearer\s+/i, '').trim()
    if (clean.length > 50) {
      cachedToken = clean
      tokenExpiry = Date.now() + 5 * 60 * 60 * 1000
      return clean
    }
  }

  // Return a placeholder — the main fetch function handles auth itself
  return '__AUTO__'
}

// ─── Bulk fetch ─────────────────────────────────────────────────────

export async function fetchTotalEnergiesSipsGasBulk(
  cupsList: string[],
  _token?: string
): Promise<Map<string, SipsData>> {
  const results = new Map<string, SipsData>()

  const BATCH_SIZE = 3
  for (let i = 0; i < cupsList.length; i += BATCH_SIZE) {
    const batch = cupsList.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async cups => {
      try {
        const data = await fetchTotalEnergiesSipsGas(cups)
        results.set(cups, data)
      } catch (err) {
        console.error(`[TE] Failed for ${cups}:`, err)
      }
    }))
    if (i + BATCH_SIZE < cupsList.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results
}

// ─── Convenience wrapper ────────────────────────────────────────────

export async function fetchSipsGasForCups(cups: string): Promise<SipsData | null> {
  const clean = cups.replace(/\s/g, '').toUpperCase()
  if (!clean || clean.length < 20) return null

  try {
    return await fetchTotalEnergiesSipsGas(clean)
  } catch (err: any) {
    console.error(`[TE] fetchSipsGasForCups error for ${cups}:`, err)
    throw err
  }
}
