/**
 * TotalEnergies SIPS Gas integration — Multi-strategy approach.
 *
 * Strategy 1: Direct User/Password headers on data endpoints (no login step)
 * Strategy 2: LoginPost → extract token → use token on data endpoints
 * Strategy 3: CNMC official SIPS API (if configured)
 *
 * The SigeEnergia API at apipatotallb.sigeenergia.com accepts
 * User + Password as custom request headers (confirmed by CORS config).
 * The portal at agentes.totalenergies.es uses this same mechanism.
 */

import type { SipsData } from '@/lib/sips'

// ─── Config ─────────────────────────────────────────────────────────
const SIGE_BASE = 'https://apipatotallb.sigeenergia.com'
const SIPS_GAS_URL = `${SIGE_BASE}/api/v1/SIPS/GAS/GetClientesPost`
const LOGIN_URL = `${SIGE_BASE}/api/v1/Usuario/LoginPost`

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
      console.log(`[TE] ${label}: ${r.status} OK`)
      return { label, response: r, status: r.status }
    }
    const body = await r.text().catch(() => '')
    const clean = body.substring(0, 300).replace(/<[^>]+>/g, '').trim()
    console.log(`[TE] ${label}: ${r.status} — ${clean.substring(0, 100)}`)
    return { label, response: null, status: r.status, error: clean.substring(0, 100) }
  } catch (err: any) {
    console.log(`[TE] ${label}: ERR — ${err.message}`)
    return { label, response: null, status: 0, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  STRATEGY 1: Direct credentials on data endpoint
//  The CORS config allows User/Password headers — some SigeEnergia
//  APIs accept inline credentials without a prior login step.
// ═══════════════════════════════════════════════════════════════════

async function tryDirectCredentials(cups: string): Promise<Response | null> {
  const creds = getCredentials()
  if (!creds) return null

  console.log('[TE] Strategy 1: Direct User/Password on data endpoint')
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
  if (!creds) return null

  console.log('[TE] Strategy 2: LoginPost → token → data')

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

    console.log(`[TE] LoginPost: status=${loginRes.status}`)

    // Log ALL response headers
    const headerEntries: string[] = []
    loginRes.headers.forEach((val, key) => {
      headerEntries.push(`${key}: ${val}`)
    })
    console.log(`[TE] LoginPost headers: ${headerEntries.join(' | ')}`)

    // Read and log full body
    const bodyText = await loginRes.text()
    console.log(`[TE] LoginPost body: ${bodyText.substring(0, 500)}`)

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
            console.log(`[TE] LoginPost JSON keys: ${keys.join(', ')}`)
            // Check if any value looks like a token
            for (const k of keys) {
              const v = data[k]
              if (typeof v === 'string' && v.length > 30) {
                console.log(`[TE] LoginPost potential token in "${k}": ${v.substring(0, 50)}...`)
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
    console.log(`[TE] LoginPost error: ${err.message}`)
  }

  if (!token) {
    console.log('[TE] Strategy 2: No token obtained from LoginPost')
    return null
  }

  console.log(`[TE] Strategy 2: Got token (${token.substring(0, 20)}...), trying data endpoint`)
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
//  STRATEGY 3: Manual token from env var
// ═══════════════════════════════════════════════════════════════════

async function tryManualToken(cups: string): Promise<Response | null> {
  const manualToken = process.env.TOTALENERGIES_TOKEN
  if (!manualToken) return null

  const token = manualToken.replace(/^Bearer\s+/i, '').trim()
  if (token.length < 50) return null

  console.log('[TE] Strategy 3: Manual TOTALENERGIES_TOKEN')
  const body = sipsBody(cups)

  const r = await tryFetch('ManualToken', SIPS_GAS_URL, {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'Authorization': `Bearer ${token}` },
    body,
  })

  if (r.status === 401) {
    console.log('[TE] Manual token expired')
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

  console.log('[TE] Strategy 4: CNMC SIPS API')

  try {
    // Fetch supply point data
    const psRes = await fetch(
      `https://api.cnmc.gob.es/verticales/v1/SIPS/consulta/v1/SIPS2_PS_GAS.csv?cups=${cups}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    )
    if (!psRes.ok) {
      console.log(`[TE] CNMC PS_GAS: ${psRes.status}`)
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
    console.log(`[TE] CNMC error: ${err.message}`)
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
//  MAIN: Orchestrate all strategies
// ═══════════════════════════════════════════════════════════════════

export async function fetchTotalEnergiesSipsGas(
  cups: string,
  _token?: string
): Promise<SipsData> {
  console.log(`[TE] Fetching SIPS Gas for ${cups}`)
  const allErrors: string[] = []

  // ── Strategy 1: Direct credentials (fastest, no login step) ──
  try {
    const res = await tryDirectCredentials(cups)
    if (res) {
      const data = await res.json()
      console.log(`[TE] Strategy 1 (Direct creds) SUCCESS`)
      return parseSigeResponse(cups, data)
    }
    allErrors.push('S1:DirectCreds=no_success')
  } catch (err: any) {
    allErrors.push(`S1:DirectCreds=${err.message.substring(0, 50)}`)
  }

  // ── Strategy 2: LoginPost → token → fetch ──
  try {
    const res = await tryLoginThenFetch(cups)
    if (res) {
      const data = await res.json()
      console.log(`[TE] Strategy 2 (LoginPost) SUCCESS`)
      return parseSigeResponse(cups, data)
    }
    allErrors.push('S2:LoginPost=no_success')
  } catch (err: any) {
    allErrors.push(`S2:LoginPost=${err.message.substring(0, 50)}`)
  }

  // ── Strategy 3: Manual token from env ──
  try {
    const res = await tryManualToken(cups)
    if (res) {
      const data = await res.json()
      console.log(`[TE] Strategy 3 (ManualToken) SUCCESS`)
      return parseSigeResponse(cups, data)
    }
    allErrors.push('S3:ManualToken=expired_or_missing')
  } catch (err: any) {
    allErrors.push(`S3:ManualToken=${err.message.substring(0, 50)}`)
  }

  // ── Strategy 4: CNMC official API ──
  try {
    const cnmc = await tryCnmcSips(cups)
    if (cnmc) {
      console.log(`[TE] Strategy 4 (CNMC) SUCCESS`)
      return cnmc
    }
    allErrors.push('S4:CNMC=not_configured_or_failed')
  } catch (err: any) {
    allErrors.push(`S4:CNMC=${err.message.substring(0, 50)}`)
  }

  // All strategies failed
  const summary = allErrors.join(' | ')
  console.error(`[TE] All strategies failed: ${summary}`)
  throw new Error(`Todas las estrategias SIPS Gas fallaron: ${summary}`)
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
