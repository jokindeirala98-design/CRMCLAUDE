/**
 * ADX Energía (Audax) SIPS Gas integration.
 *
 * Uses the extranet at extranet.adxenergia.es to fetch SIPS gas data.
 * Two endpoints:
 *   - rps_nemon.php     → supply point data (datos suministro)
 *   - rps_nemon_gas.php  → gas consumption + supply data (lecturas + suministros)
 *
 * Auth: PHP session (PHPSESSID) + API token in request body.
 * Login: SSO via contrataciones.adxenergia.es (automated below).
 */

import type { SipsData } from '@/lib/sips'

// ─── Config ─────────────────────────────────────────────────────────
const ADX_BASE = 'https://extranet.adxenergia.es/comisionistas/rps'
const ADX_GAS_URL = `${ADX_BASE}/rps_nemon_gas.php`
const ADX_LOGIN_URL = 'https://contrataciones.adxenergia.es/intranet/api/login'

// ─── Cached session ─────────────────────────────────────────────────
let cachedSession: string | null = null
let cachedToken: string | null = null
let sessionExpiry = 0

// ─── Debug helper ───────────────────────────────────────────────────
let debugLog: string[] = []
function dbg(msg: string) {
  debugLog.push(msg)
  console.log(`[ADX] ${msg}`)
}

// ─── Credentials ────────────────────────────────────────────────────
function getAdxCredentials(): { user: string; password: string } | null {
  const user = process.env.ADX_USER
  const password = process.env.ADX_PASSWORD
  if (!user || !password) return null
  return { user, password }
}

// ─── Login to ADX (try to automate session) ─────────────────────────

async function tryLogin(): Promise<{ session: string; token: string } | null> {
  const creds = getAdxCredentials()
  if (!creds) { dbg('login:no_creds'); return null }

  dbg('login:attempting')

  try {
    // Step 1: Try direct API login at contrataciones.adxenergia.es
    const loginRes = await fetch(ADX_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        user: creds.user,
        password: creds.password,
      }),
      redirect: 'manual',
    })

    dbg(`login:status=${loginRes.status}`)

    if (loginRes.ok) {
      const body = await loginRes.text()
      dbg(`login:body=${body.substring(0, 120)}`)

      // Try to extract token from response
      try {
        const data = JSON.parse(body)
        const token = data.token || data.Token || data.access_token || data.sessionToken || null
        const session = data.session || data.PHPSESSID || null

        // Also check Set-Cookie for PHPSESSID
        let phpSession: string | null = session
        const cookies = loginRes.headers.get('set-cookie') || ''
        const sessMatch = cookies.match(/PHPSESSID=([^;]+)/)
        if (sessMatch) phpSession = sessMatch[1]

        if (token || phpSession) {
          dbg(`login:success token=${token?.substring(0, 20)}... session=${phpSession?.substring(0, 15)}...`)
          return { session: phpSession || '', token: token || '' }
        }
      } catch {}
    }

    // Step 2: Try form-based login at extranet
    const formRes = await fetch('https://extranet.adxenergia.es/comisionistas/index.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        user: creds.user,
        password: creds.password,
        login: '1',
      }).toString(),
      redirect: 'manual',
    })

    dbg(`login:extranet:status=${formRes.status}`)

    const extranetCookies = formRes.headers.get('set-cookie') || ''
    const sessMatch2 = extranetCookies.match(/PHPSESSID=([^;]+)/)
    if (sessMatch2) {
      dbg(`login:extranet:session=${sessMatch2[1].substring(0, 15)}...`)
      return { session: sessMatch2[1], token: '' }
    }

  } catch (err: any) {
    dbg(`login:err=${err.message.substring(0, 60)}`)
  }

  return null
}

// ─── Fetch SIPS gas data ────────────────────────────────────────────

export async function fetchAdxSipsGas(cups: string): Promise<SipsData> {
  debugLog = []
  dbg(`CUPS=${cups}`)

  const manualSession = process.env.ADX_SESSION
  const manualToken = process.env.ADX_TOKEN || ''

  // Try cached session first, then manual env vars, then auto-login
  let session = cachedSession && Date.now() < sessionExpiry ? cachedSession : null
  let token = cachedToken || manualToken

  if (session) {
    dbg('using_cached_session')
  } else if (manualSession) {
    session = manualSession
    token = manualToken
    dbg('using_manual_session')
  } else {
    // Try automated login
    const loginResult = await tryLogin()
    if (loginResult) {
      session = loginResult.session
      token = loginResult.token || manualToken
      cachedSession = session
      cachedToken = token
      sessionExpiry = Date.now() + 4 * 60 * 60 * 1000 // 4h cache
    }
  }

  if (!session) {
    const debug = debugLog.join(' → ')
    throw new Error(`ADX: No hay sesión disponible. Configura ADX_SESSION y ADX_TOKEN en Vercel. Debug: ${debug}`)
  }

  // Build request body matching portal exactly
  const dataPayload = JSON.stringify({
    typeenergy: 'gas',
    token: token,
    request: 'detail',
    cups: cups,
  })

  const formBody = new URLSearchParams({
    cups: cups,
    tipo: 'detail',
    data: dataPayload,
  })

  dbg(`fetching:session=${session.substring(0, 10)}...`)

  try {
    const res = await fetch(ADX_GAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://extranet.adxenergia.es',
        'Referer': 'https://extranet.adxenergia.es/comisionistas/index.php?sec=rps-comi',
        'Cookie': `PHPSESSID=${session}`,
      },
      body: formBody.toString(),
    })

    dbg(`response:status=${res.status}`)

    if (!res.ok) {
      // Session might be expired
      if (res.status === 302 || res.status === 401 || res.status === 403) {
        dbg('session_expired')
        cachedSession = null
        sessionExpiry = 0
        throw new Error(`ADX: Sesión expirada (${res.status}). Actualiza ADX_SESSION en Vercel.`)
      }
      throw new Error(`ADX: HTTP ${res.status}`)
    }

    const text = await res.text()
    dbg(`response:len=${text.length}`)

    // Check if response is HTML (redirect to login page)
    if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('login')) {
      dbg('session_expired:html_response')
      cachedSession = null
      sessionExpiry = 0
      throw new Error('ADX: Sesión expirada (respuesta HTML). Actualiza ADX_SESSION en Vercel.')
    }

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      dbg(`not_json=${text.substring(0, 80)}`)
      throw new Error(`ADX: Respuesta no es JSON: ${text.substring(0, 100)}`)
    }

    dbg('parsing_response')
    return parseAdxResponse(cups, data)

  } catch (err: any) {
    if (err.message.startsWith('ADX:')) throw err
    const debug = debugLog.join(' → ')
    throw new Error(`ADX SIPS Gas debug: ${debug} → err=${err.message}`)
  }
}

// ─── Parse ADX response into SipsData ───────────────────────────────

function parseAdxResponse(cups: string, data: any): SipsData {
  const result: SipsData = { cups }

  // The response has two possible structures:
  // Structure 1 (rps_nemon_gas.php with tipo=detail): { suministros: [...], lecturas: [...] }
  // Structure 2 (rps_nemon.php): { cups, suministros: { results: [...] }, total_results, distributor_table }
  const suministro = data.suministros?.[0] ||
                     data.suministros?.results?.[0] ||
                     null

  if (suministro) {
    result.distribuidora = suministro.Distribuidora || undefined
    result.tariff = mapAdxTariff(suministro.Cod_Peaje)
    result.codigoPostal = suministro.Cod_Postal_Suministro || undefined
    result.municipio = suministro.Localidad_Suministro || undefined
    result.provincia = suministro.Provincia_Suministro || undefined

    // Address
    const parts = [
      suministro.Tipo_Via_Suministro,
      suministro.Via_Suministro,
      suministro.Num_Finca_Suministro,
      suministro.Piso_Suministro,
      suministro.Puerta_Suministro,
    ].filter(Boolean)
    if (parts.length > 0) {
      result.direccion = parts.join(' ')
    }

    // Titular
    const titular = suministro.Nombre_Completo_Titular?.trim() ||
                    [suministro.Aprellido_1_Titular, suministro.Aprellido_2_Titular, suministro.Nombre_Titular]
                      .filter(Boolean).join(' ').trim()
    if (titular) result.titular = titular

    dbg(`supply: dist=${result.distribuidora} tariff=${result.tariff} loc=${result.municipio}`)
  }

  // Parse consumption history from lecturas
  const lecturas = data.lecturas || []
  if (lecturas.length > 0) {
    // Sort by start date ascending
    const sorted = [...lecturas].sort((a: any, b: any) =>
      new Date(a.Fec_Ini_Consumo).getTime() - new Date(b.Fec_Ini_Consumo).getTime()
    )

    result.consumptionHistory = sorted.map((entry: any) => {
      const p1 = entry.Consumo_kWh_P1 || 0
      const p2 = entry.Consumo_kWh_P2 || 0
      return {
        fecha: entry.Fec_Fin_consumo || entry.Fec_Fin_Consumo || '',
        fechaInicio: entry.Fec_Ini_Consumo || '',
        fechaFin: entry.Fec_Fin_consumo || entry.Fec_Fin_Consumo || '',
        P1: p1, P2: p2, P3: 0, P4: 0, P5: 0, P6: 0,
        total: p1 + p2,
      }
    })

    // Use pre-calculated kWhAnual if available, otherwise sum last 12
    const kWhAnual = suministro?.kWhAnual || suministro?.kWhAnual_p1 || 0

    if (kWhAnual > 0) {
      result.totalConsumptionKwh = kWhAnual
      result.totalConsumption = `${Math.round(kWhAnual).toLocaleString('es-ES')} kWh`
      dbg(`consumo_anual=${kWhAnual} (pre-calculated)`)
    } else {
      // Fallback: sum last 12 entries
      const last12 = result.consumptionHistory.slice(-12)
      const total = last12.reduce((s, e) => s + e.total, 0)
      result.totalConsumptionKwh = Math.round(total)
      result.totalConsumption = `${Math.round(total).toLocaleString('es-ES')} kWh`
      dbg(`consumo_anual=${total} (sum last 12)`)
    }

    result.consumoPeriodos = {
      P1: result.totalConsumptionKwh,
      P2: 0, P3: 0, P4: 0, P5: 0, P6: 0,
    }
  } else {
    result.consumptionHistory = []
    result.totalConsumptionKwh = 0
    result.totalConsumption = '0 kWh'
    result.consumoPeriodos = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  }

  // Gas doesn't have potencia contratada
  result.potenciaContratada = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  result.maximetroHistory = []
  result.reactivaHistory = []

  dbg(`parsed: ${result.consumptionHistory?.length || 0} lecturas, total=${result.totalConsumptionKwh} kWh`)
  return result
}

// ─── Tariff mapping ─────────────────────────────────────────────────

function mapAdxTariff(code: string | undefined): string | undefined {
  if (!code) return undefined
  const clean = code.trim().toUpperCase()
  const map: Record<string, string> = {
    'R1': 'RL.1',
    'R2': 'RL.2',
    'R3': 'RL.3',
    'R4': 'RL.4',
    'R5': 'RL.5',
    'RL1': 'RL.1',
    'RL2': 'RL.2',
    'RL3': 'RL.3',
    'RL4': 'RL.4',
    'RL5': 'RL.5',
    'RL.1': 'RL.1',
    'RL.2': 'RL.2',
    'RL.3': 'RL.3',
    'RL.4': 'RL.4',
    'RL.5': 'RL.5',
  }
  return map[clean] || clean
}
