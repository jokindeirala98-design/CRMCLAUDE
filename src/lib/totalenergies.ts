/**
 * TotalEnergies SIPS Gas integration.
 *
 * Auth: Direct login to SigeEnergia API with User/Password headers.
 * The agentes.totalenergies.es portal uses this same API at
 * apipatotallb.sigeenergia.com with Bearer st2.s.* tokens.
 *
 * Data endpoint:
 *   POST apipatotallb.sigeenergia.com/api/v1/SIPS/GAS/GetClientesPost
 */

import type { SipsData } from '@/lib/sips'

// ─── Config ─────────────────────────────────────────────────────────
const SIGE_API_BASE = 'https://apipatotallb.sigeenergia.com'

let cachedToken: string | null = null
let tokenExpiry: number = 0

// ─── Authentication ─────────────────────────────────────────────────

/**
 * Login to SigeEnergia API.
 *
 * Strategy 1: POST /api/v1/Login with User + Password headers
 *             (used by agentes.totalenergies.es portal).
 * Strategy 2: POST resumen.html with User + Password headers.
 * Strategy 3: Direct call with User + Password headers on each request
 *             (some SigeEnergia endpoints accept inline credentials).
 *
 * Returns Bearer token string, or { useDirectAuth: true } if the API
 * accepts credentials inline rather than via a login endpoint.
 */
async function sigeLogin(user: string, password: string): Promise<string> {
  const errors: string[] = []

  // Helper to extract token from response
  const extractToken = async (res: Response, label: string): Promise<string | null> => {
    // Check Authorization response header
    const authHeader = res.headers.get('Authorization') || res.headers.get('authorization')
    if (authHeader) {
      console.log(`[TotalEnergies] ${label}: got token from Authorization header`)
      return authHeader.replace(/^Bearer\s+/i, '')
    }

    // Check response body for token
    try {
      const text = await res.text()
      // Try parsing as JSON
      try {
        const data = JSON.parse(text)
        const token = data.token || data.Token || data.access_token ||
                      data.sessionToken || data.bearerToken || data.SessionToken ||
                      data.Authorization || data.authorization ||
                      data.Result?.Token || data.result?.token
        if (token && typeof token === 'string' && token.length > 20) {
          console.log(`[TotalEnergies] ${label}: got token from JSON body`)
          return token.replace(/^Bearer\s+/i, '')
        }
      } catch {}
      // Check if the raw text contains an st2 token
      const st2Match = text.match(/(st2\.s\.[A-Za-z0-9._-]{50,})/)
      if (st2Match) {
        console.log(`[TotalEnergies] ${label}: found st2 token in response`)
        return st2Match[1]
      }
    } catch {}
    return null
  }

  // ── Strategy 1: POST /api/v1/Usuario/LoginPost (confirmed from portal) ──
  // The agentes.totalenergies.es portal uses this endpoint.
  // It accepts User + Password as custom headers AND/OR JSON body.
  // Returns the Bearer token in the Authorization response header.
  const commonHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://agentes.totalenergies.es',
    'Referer': 'https://agentes.totalenergies.es/',
  }

  const loginVariants = [
    // Variant A: User/Password as headers + JSON body (portal style)
    {
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json;charset=UTF-8',
        'User': user,
        'Password': password,
      },
      body: JSON.stringify({ User: user, Password: password }),
    },
    // Variant B: User/Password as headers only, empty body
    {
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json;charset=UTF-8',
        'User': user,
        'Password': password,
      },
      body: JSON.stringify({}),
    },
    // Variant C: Credentials in body only
    {
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({ User: user, Password: password }),
    },
    // Variant D: Form-urlencoded
    {
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User': user,
        'Password': password,
      },
      body: new URLSearchParams({ User: user, Password: password }).toString(),
    },
  ]

  for (let i = 0; i < loginVariants.length; i++) {
    const variant = loginVariants[i]
    try {
      const res = await fetch(`${SIGE_API_BASE}/api/v1/Usuario/LoginPost`, {
        method: 'POST',
        headers: variant.headers,
        body: variant.body,
      })
      console.log(`[TotalEnergies] LoginPost variant ${i + 1}: status ${res.status}`)

      if (res.ok) {
        const token = await extractToken(res, `LoginPost variant ${i + 1}`)
        if (token) return token
        console.log(`[TotalEnergies] LoginPost variant ${i + 1}: 200 OK but no token found`)
      }
    } catch (err: any) {
      errors.push(`LoginPost v${i + 1}: ${err.message}`)
      console.warn(`[TotalEnergies] LoginPost variant ${i + 1} error:`, err.message)
    }
  }

  // ── Strategy 2: Gigya fallback ──
  console.log('[TotalEnergies] Trying Gigya fallback...')
  try {
    return await gigyaLogin(user, password)
  } catch (err: any) {
    errors.push(`gigya: ${err.message}`)
  }

  console.error('[TotalEnergies] All strategies failed:', errors.join(' | '))
  throw new Error(`[TotalEnergies] Auth failed. Details: ${errors.join(' | ')}`)
}

// ─── Gigya Fallback ─────────────────────────────────────────────────

const GIGYA_DOMAINS = [
  'https://gigya.connectpro.totalenergies.com',
  'https://accounts.eu1.gigya.com',
  'https://socialize.eu1.gigya.com',
]

const GIGYA_API_KEYS = [
  '3_86LLJ8oxhMd9Tk27SuTp5z9SstBGZ8I--VIgS89iQ8RMT-79QfXT8yluZyVzr5tQ',
  '3_VfXMKflTmFZcLoeSE09eXUaI3ljE-2Y0ZGVSw7b7IKl-LNjJOC0PxKejOQsKzTzw',
]

async function gigyaLogin(email: string, password: string): Promise<string> {
  for (const base of GIGYA_DOMAINS) {
    for (const apiKey of GIGYA_API_KEYS) {
      try {
        // Step 1: identifier token
        const idParams = new URLSearchParams({
          loginID: email,
          APIKey: apiKey,
          sdk: 'js_latest',
          format: 'json',
        })
        const idRes = await fetch(`${base}/accounts.identifier.createToken`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: idParams.toString(),
        })
        if (!idRes.ok) continue
        const idData = await idRes.json()
        if (idData.errorCode && idData.errorCode !== 0) continue
        if (!idData.token) continue

        // Step 2: login
        const loginParams = new URLSearchParams({
          password,
          aToken: idData.token,
          APIKey: apiKey,
          targetEnv: 'jssdk',
          sessionExpiration: '20000',
          include: 'profile,data,emails,subscriptions,preferences,',
          includeUserInfo: 'true',
          loginMode: 'standard',
          lang: 'es',
          sdk: 'js_latest',
          format: 'json',
        })
        const loginRes = await fetch(`${base}/accounts.login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: loginParams.toString(),
        })
        if (!loginRes.ok) continue
        const loginData = await loginRes.json()
        if (loginData.errorCode && loginData.errorCode !== 0) continue

        const token = loginData.sessionToken ||
                      loginData.sessionInfo?.cookieValue ||
                      loginData.sessionInfo?.sessionToken
        if (token) {
          console.log(`[TotalEnergies] Gigya login OK via ${base}`)
          return token
        }
      } catch (err) {
        console.warn(`[TotalEnergies] Gigya ${base} with key ${apiKey.substring(0, 15)}... failed:`, err)
      }
    }
  }

  throw new Error('[TotalEnergies] All authentication strategies failed. Verify credentials are correct for agentes.totalenergies.es')
}

// ─── Token management ───────────────────────────────────────────────

/**
 * Get a valid auth mechanism, using cache when possible.
 */
export async function getTotalEnergiesToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 10 * 60 * 1000) {
    return cachedToken
  }

  // Priority 1: Manual token (for when auto-auth doesn't work yet)
  // Set TOTALENERGIES_TOKEN in Vercel with the Bearer token from the portal
  const manualToken = process.env.TOTALENERGIES_TOKEN
  if (manualToken) {
    const clean = manualToken.replace(/^Bearer\s+/i, '').trim()
    if (clean.length > 50) {
      console.log('[TotalEnergies] Using manual token from TOTALENERGIES_TOKEN env var')
      cachedToken = clean
      // Manual tokens expire after ~5.5h, cache for 5h
      tokenExpiry = Date.now() + 5 * 60 * 60 * 1000
      return clean
    }
  }

  // Priority 2: Auto-login with email/password
  const email = process.env.TOTALENERGIES_EMAIL
  const password = process.env.TOTALENERGIES_PASSWORD

  if (!email || !password) {
    throw new Error(
      'TOTALENERGIES_EMAIL y TOTALENERGIES_PASSWORD (o TOTALENERGIES_TOKEN) deben estar configurados en las variables de entorno'
    )
  }

  console.log('[TotalEnergies] Authenticating...')
  const token = await sigeLogin(email, password)

  cachedToken = token
  tokenExpiry = Date.now() + 19000 * 1000
  console.log('[TotalEnergies] Auth successful, token cached')

  return token
}

// ─── Helper: build request headers ──────────────────────────────────

function buildApiHeaders(token: string, style: 'bearer' | 'validacion' | 'raw' = 'bearer'): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://agentes.totalenergies.es',
    'Referer': 'https://agentes.totalenergies.es/',
  }

  if (token === '__DIRECT_AUTH__') {
    headers['User'] = process.env.TOTALENERGIES_EMAIL || ''
    headers['Password'] = process.env.TOTALENERGIES_PASSWORD || ''
  } else if (style === 'validacion') {
    // Some SigeEnergia APIs use 'Validacion' header instead of Authorization
    headers['Validacion'] = token
  } else if (style === 'raw') {
    // Token without Bearer prefix
    headers['Authorization'] = token
  } else {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}

// ─── SIPS Gas Data Types ────────────────────────────────────────────

interface TotalEnergiesClienteSips {
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

interface TotalEnergiesConsumoSips {
  CodigoCUPS: string
  FechaInicioMesConsumo: string
  FechaFinMesConsumo: string
  CodigoTarifaPeaje?: string
  ConsumoEnWhP1: number
  ConsumoEnWhP2: number
  CaudalMedioEnWhDia?: number
  CaudalMinimoDiario?: number
  CaudalMaximoDiario?: number
  PorcentajeConsumoNocturno?: number
  [key: string]: any
}

interface TotalEnergiesSipsResponse {
  ClientesSips: TotalEnergiesClienteSips[]
  ConsumosSips: TotalEnergiesConsumoSips[]
  DatosTitular: any
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

function buildAddress(c: TotalEnergiesClienteSips): string {
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

// ─── Main fetch function ────────────────────────────────────────────

/**
 * Fetch SIPS Gas data for a single CUPS from TotalEnergies/SigeEnergia.
 */
export async function fetchTotalEnergiesSipsGas(
  cups: string,
  token: string
): Promise<SipsData> {
  const headers = buildApiHeaders(token)
  let res: Response | null = null
  const allErrors: string[] = []

  // Helper to log response details
  const tryFetch = async (label: string, url: string, opts: RequestInit): Promise<Response | null> => {
    try {
      const r = await fetch(url, opts)
      if (r.ok) {
        console.log(`[TotalEnergies] ${label}: ${r.status} OK`)
        return r
      }
      const body = await r.text().catch(() => '')
      const shortBody = body.substring(0, 200).replace(/<[^>]+>/g, '').trim()
      console.log(`[TotalEnergies] ${label}: ${r.status} - ${shortBody}`)
      allErrors.push(`${label}=${r.status}`)
      return null
    } catch (err: any) {
      console.log(`[TotalEnergies] ${label}: ERROR - ${err.message}`)
      allErrors.push(`${label}=ERR:${err.message.substring(0, 50)}`)
      return null
    }
  }

  // Attempt 1: POST GetClientesPost — exact format the portal sends
  // The portal Angular app sends this body structure
  res = await tryFetch('GetClientes-portal',
    `${SIGE_API_BASE}/api/v1/SIPS/GAS/GetClientesPost`,
    { method: 'POST', headers, body: JSON.stringify({
        CodigoCUPS: cups,
        NombreEmpresaDistribuidora: null,
        CodigoPostalPS: null,
        CodigoProvinciaPS: null,
        CodigoTarifaATREnVigor: null,
        IsExist: true,
        ListCUPS: null,
        LoadAllDatosCliente: true,
        LoadConsumos: true,
        MunicipioPS: null,
    })})

  // Attempt 2: POST GetClientesPost with empty strings (variant)
  if (!res) {
    res = await tryFetch('GetClientes-emptyStr',
      `${SIGE_API_BASE}/api/v1/SIPS/GAS/GetClientesPost`,
      { method: 'POST', headers, body: JSON.stringify({
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
      })})
  }

  // Attempt 3: POST GetClientesPost minimal (just CodigoCUPS)
  if (!res) {
    res = await tryFetch('GetClientes-minimal',
      `${SIGE_API_BASE}/api/v1/SIPS/GAS/GetClientesPost`,
      { method: 'POST', headers, body: JSON.stringify({ CodigoCUPS: cups })})
  }

  // Attempt 4: GET /api/v1/CNMC/Gas?CUPS="CUPS" (portal also calls this)
  if (!res) {
    res = await tryFetch('CNMC/Gas-quoted',
      `${SIGE_API_BASE}/api/v1/CNMC/Gas?CUPS=%22${encodeURIComponent(cups)}%22`,
      { method: 'GET', headers })
  }

  // Attempt 5: GET /api/v1/CNMC/Gas?CUPS=CUPS (without quotes)
  if (!res) {
    res = await tryFetch('CNMC/Gas-plain',
      `${SIGE_API_BASE}/api/v1/CNMC/Gas?CUPS=${encodeURIComponent(cups)}`,
      { method: 'GET', headers })
  }

  // Attempt 6: POST GetConsumoClientePost (alternate endpoint)
  if (!res) {
    res = await tryFetch('GetConsumoCliente',
      `${SIGE_API_BASE}/api/v1/SIPS/Datos/GetConsumoClientePost`,
      { method: 'POST', headers, body: JSON.stringify({ CodigoCUPS: cups })})
  }

  if (!res) {
    const summary = allErrors.join(' | ')
    if (summary.includes('401')) {
      cachedToken = null
      tokenExpiry = 0
      throw new Error('[TotalEnergies] Token expirado, reintenta la consulta')
    }
    // Show ALL attempt results so we can debug
    throw new Error(`[TotalEnergies] Todos los intentos fallaron: ${summary}`)
  }

  const data: TotalEnergiesSipsResponse = await res.json()
  return parseTotalEnergiesResponse(cups, data)
}

// ─── Response parser (shared between single and bulk) ───────────────

function parseTotalEnergiesResponse(
  cups: string,
  data: TotalEnergiesSipsResponse
): SipsData {
  const result: SipsData = { cups }

  const cliente = data.ClientesSips?.[0]
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

  if (Array.isArray(data.ConsumosSips) && data.ConsumosSips.length > 0) {
    const sorted = [...data.ConsumosSips].sort(
      (a, b) =>
        new Date(a.FechaInicioMesConsumo).getTime() -
        new Date(b.FechaInicioMesConsumo).getTime()
    )

    result.consumptionHistory = sorted.map(entry => {
      const p1 = Math.round(entry.ConsumoEnWhP1 || 0)
      const p2 = Math.round(entry.ConsumoEnWhP2 || 0)
      return {
        fecha: entry.FechaFinMesConsumo,
        fechaInicio: entry.FechaInicioMesConsumo,
        fechaFin: entry.FechaFinMesConsumo,
        P1: p1, P2: p2, P3: 0, P4: 0, P5: 0, P6: 0,
        total: p1 + p2,
      }
    })

    const totalKwh = result.consumptionHistory.reduce((s, e) => s + e.total, 0)
    result.totalConsumptionKwh = totalKwh
    result.totalConsumption = `${Math.round(totalKwh).toLocaleString('es-ES')} kWh`
    result.consumoPeriodos = { P1: totalKwh, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    result.potenciaContratada = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    result.maximetroHistory = []
    result.reactivaHistory = []
  } else {
    // No consumption history — still set defaults so downstream code
    // can persist distribuidora / tariff alongside zero-consumption.
    result.totalConsumptionKwh = 0
    result.totalConsumption = '0 kWh'
    result.consumoPeriodos = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    result.potenciaContratada = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    result.consumptionHistory = []
    result.maximetroHistory = []
    result.reactivaHistory = []
  }

  return result
}

// ─── Bulk fetch for multiple CUPS ───────────────────────────────────

export async function fetchTotalEnergiesSipsGasBulk(
  cupsList: string[],
  token: string
): Promise<Map<string, SipsData>> {
  const results = new Map<string, SipsData>()

  if (cupsList.length > 1) {
    try {
      const listStr = cupsList.join(';')
      const res = await fetch(`${SIGE_API_BASE}/api/v1/SIPS/GAS/GetClientesPost`, {
        method: 'POST',
        headers: buildApiHeaders(token),
        body: JSON.stringify({
          CodigoCUPS: '',
          NombreEmpresaDistribuidora: '',
          CodigoPostalPS: '',
          CodigoProvinciaPS: '',
          CodigoTarifaATREnVigor: '',
          IsExist: true,
          ListCUPS: listStr,
          LoadAllDatosCliente: true,
          LoadConsumos: true,
          MunicipioPS: '',
        }),
      })

      if (res.ok) {
        const data: TotalEnergiesSipsResponse = await res.json()
        if (data.ClientesSips?.length > 0) {
          const consumosByCups = new Map<string, TotalEnergiesConsumoSips[]>()
          for (const c of data.ConsumosSips || []) {
            if (!consumosByCups.has(c.CodigoCUPS)) consumosByCups.set(c.CodigoCUPS, [])
            consumosByCups.get(c.CodigoCUPS)!.push(c)
          }
          for (const cliente of data.ClientesSips) {
            const cupsKey = cliente.CodigoCUPS
            const sipsData = parseTotalEnergiesResponse(cupsKey, {
              ClientesSips: [cliente],
              ConsumosSips: consumosByCups.get(cupsKey) || [],
              DatosTitular: null,
            })
            results.set(cupsKey, sipsData)
          }
          console.log(`[TotalEnergies] Bulk query returned ${results.size}/${cupsList.length} CUPS`)
          if (results.size >= cupsList.length) return results
        }
      }
    } catch (err) {
      console.warn('[TotalEnergies] Bulk query failed, falling back to individual:', err)
    }
  }

  // Fallback: individual queries
  const missing = cupsList.filter(c => !results.has(c))
  const BATCH_SIZE = 5
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async cups => {
      try {
        const data = await fetchTotalEnergiesSipsGas(cups, token)
        results.set(cups, data)
      } catch (err) {
        console.error(`[TotalEnergies] Failed for ${cups}:`, err)
      }
    }))
    if (i + BATCH_SIZE < missing.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results
}

// ─── Convenience wrapper ────────────────────────────────────────────

export async function fetchSipsGasForCups(cups: string): Promise<SipsData | null> {
  try {
    const cleanCups = cups.replace(/\s/g, '').toUpperCase()
    if (!cleanCups || cleanCups.length < 20) return null
    const token = await getTotalEnergiesToken()
    return await fetchTotalEnergiesSipsGas(cleanCups, token)
  } catch (err) {
    console.error(`[TotalEnergies] Error fetching gas SIPS for ${cups}:`, err)
    return null
  }
}
