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

  // ── Strategy 1: GET resumen.html with User/Password headers ──
  // (the portal loads this page first after auth — may return token)
  for (const method of ['GET', 'POST'] as const) {
    try {
      const res = await fetch(`${SIGE_API_BASE}/resumen.html`, {
        method,
        headers: {
          'Accept': 'text/html, application/json, */*',
          'User': user,
          'Password': password,
        },
      })
      console.log(`[TotalEnergies] Strategy 1 (${method} resumen.html): status ${res.status}`)
      const token = await extractToken(res, `resumen.html ${method}`)
      if (token) return token
    } catch (err: any) {
      errors.push(`resumen.html ${method}: ${err.message}`)
    }
  }

  // ── Strategy 2: POST to login-like endpoints with various body formats ──
  const loginEndpoints = [
    '/api/v1/Login',
    '/api/v1/Account/Login',
    '/api/v1/Auth/Login',
    '/api/Login',
    '/api/v1/Agente/Login',
    '/api/v1/Usuario/Login',
  ]

  for (const endpoint of loginEndpoints) {
    // Try JSON body
    try {
      const res = await fetch(`${SIGE_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*',
          'User': user,
          'Password': password,
        },
        body: JSON.stringify({ User: user, Password: password }),
      })
      console.log(`[TotalEnergies] Strategy 2 (${endpoint} JSON): status ${res.status}`)
      if (res.ok) {
        const token = await extractToken(res, endpoint)
        if (token) return token
      }
    } catch (err: any) {
      errors.push(`${endpoint}: ${err.message}`)
    }

    // Try form-urlencoded
    try {
      const res = await fetch(`${SIGE_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json, text/plain, */*',
        },
        body: new URLSearchParams({ User: user, Password: password }).toString(),
      })
      console.log(`[TotalEnergies] Strategy 2 (${endpoint} form): status ${res.status}`)
      if (res.ok) {
        const token = await extractToken(res, `${endpoint} form`)
        if (token) return token
      }
    } catch {}
  }

  // ── Strategy 3: Direct API call with User/Password headers ──
  try {
    const testRes = await fetch(`${SIGE_API_BASE}/api/v1/SIPS/GAS/GetClientesPost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'User': user,
        'Password': password,
      },
      body: JSON.stringify({
        CodigoCUPS: '',
        IsExist: true,
        ListCUPS: '',
        LoadAllDatosCliente: false,
        LoadConsumos: false,
      }),
    })
    console.log(`[TotalEnergies] Strategy 3 (direct auth): status ${testRes.status}`)
    if (testRes.ok) {
      console.log('[TotalEnergies] Direct auth with User/Password headers works!')
      return '__DIRECT_AUTH__'
    }
    const token = await extractToken(testRes, 'direct auth')
    if (token) return token
  } catch (err: any) {
    errors.push(`direct auth: ${err.message}`)
  }

  // ── Strategy 4: Gigya fallback ──
  console.log('[TotalEnergies] Trying Gigya fallback...')
  try {
    return await gigyaLogin(user, password)
  } catch (err: any) {
    errors.push(`gigya: ${err.message}`)
  }

  console.error('[TotalEnergies] All strategies failed:', errors.join(' | '))
  throw new Error(`[TotalEnergies] Auth failed. Tried ${errors.length} strategies. Last: ${errors[errors.length - 1] || 'unknown'}`)
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

  const email = process.env.TOTALENERGIES_EMAIL
  const password = process.env.TOTALENERGIES_PASSWORD

  if (!email || !password) {
    throw new Error(
      'TOTALENERGIES_EMAIL y TOTALENERGIES_PASSWORD deben estar configurados en las variables de entorno'
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

function buildApiHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Accept': 'application/json, text/plain, */*',
  }

  if (token === '__DIRECT_AUTH__') {
    // Direct auth mode: pass credentials on every request
    headers['User'] = process.env.TOTALENERGIES_EMAIL || ''
    headers['Password'] = process.env.TOTALENERGIES_PASSWORD || ''
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
  const res = await fetch(`${SIGE_API_BASE}/api/v1/SIPS/GAS/GetClientesPost`, {
    method: 'POST',
    headers: buildApiHeaders(token),
    body: JSON.stringify({
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
    }),
  })

  if (res.status === 401) {
    cachedToken = null
    tokenExpiry = 0
    throw new Error('[TotalEnergies] Token expirado, reintenta la consulta')
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[TotalEnergies] GetClientesPost HTTP ${res.status}: ${text}`)
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
