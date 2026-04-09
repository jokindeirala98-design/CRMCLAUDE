/**
 * TotalEnergies SIPS Gas integration.
 *
 * Auth flow (Gigya/SAP CDC):
 *   1. POST accounts.identifier.createToken  → aToken
 *   2. POST accounts.login (password + aToken) → sessionToken (st2.s.*)
 *   3. Bearer sessionToken → SigeEnergia API
 *
 * Data endpoint:
 *   POST apipatotallb.sigeenergia.com/api/v1/SIPS/GAS/GetClientesPost
 */

import type { SipsData } from '@/lib/sips'

// ─── Config ─────────────────────────────────────────────────────────
const GIGYA_BASE = 'https://gigya.connectpro.totalenergies.com'
const GIGYA_API_KEY = '3_86LLJ8oxhMd9Tk27SuTp5z9SstBGZ8I--VIgS89iQ8RMT-79QfXT8yluZyVzr5tQ'
const SIGE_API_BASE = 'https://apipatotallb.sigeenergia.com'

let cachedToken: string | null = null
let tokenExpiry: number = 0

// ─── Gigya Authentication ───────────────────────────────────────────

/**
 * Step 1: Create an identifier token for the email.
 * Gigya's identifier-first flow requires this before login.
 */
async function createIdentifierToken(email: string): Promise<string> {
  const params = new URLSearchParams({
    loginID: email,
    APIKey: GIGYA_API_KEY,
    sdk: 'js_latest',
    format: 'json',
  })

  const res = await fetch(`${GIGYA_BASE}/accounts.identifier.createToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    throw new Error(`[TotalEnergies] identifier.createToken failed: ${res.status}`)
  }

  const data = await res.json()
  if (data.errorCode && data.errorCode !== 0) {
    throw new Error(`[TotalEnergies] identifier.createToken error: ${data.errorMessage || data.errorCode}`)
  }

  const token = data.token
  if (!token) {
    throw new Error('[TotalEnergies] identifier.createToken returned no token')
  }

  return token
}

/**
 * Step 2: Login with password + aToken → sessionToken.
 * The sessionToken (format "st2.s.*") is used as Bearer for SigeEnergia.
 */
async function gigyaLogin(email: string, password: string): Promise<string> {
  // Step 1: get identifier token
  const aToken = await createIdentifierToken(email)

  // Step 2: accounts.login
  const params = new URLSearchParams({
    password,
    aToken,
    APIKey: GIGYA_API_KEY,
    targetEnv: 'jssdk',
    sessionExpiration: '20000',
    include: 'profile,data,emails,subscriptions,preferences,',
    includeUserInfo: 'true',
    loginMode: 'standard',
    lang: 'en',
    sdk: 'js_latest',
    format: 'json',
  })

  const res = await fetch(`${GIGYA_BASE}/accounts.login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[TotalEnergies] accounts.login HTTP ${res.status}: ${text}`)
  }

  const data = await res.json()

  if (data.errorCode && data.errorCode !== 0) {
    throw new Error(`[TotalEnergies] Login error: ${data.errorMessage || data.errorCode}`)
  }

  // The sessionToken comes in the JSON response body
  // Gigya REST returns it as sessionInfo.cookieValue or sessionToken
  const sessionToken =
    data.sessionToken ||
    data.sessionInfo?.cookieValue ||
    data.sessionInfo?.sessionToken

  if (!sessionToken) {
    // Fallback: check Set-Cookie header for glt_* cookie
    const cookies = res.headers.get('set-cookie') || ''
    const gltMatch = cookies.match(/glt_[^=]+=([^;]+)/)
    if (gltMatch) {
      return gltMatch[1]
    }
    console.error('[TotalEnergies] Login response keys:', Object.keys(data))
    throw new Error('[TotalEnergies] Login succeeded but no sessionToken found in response')
  }

  return sessionToken
}

/**
 * Get a valid Bearer token, using cache when possible.
 * Token expires after ~5.5 hours (sessionExpiration=20000s).
 * We refresh 10 minutes before expiry to be safe.
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

  console.log('[TotalEnergies] Authenticating via Gigya...')
  const token = await gigyaLogin(email, password)

  cachedToken = token
  // 20000s session - cache for 19000s (leave 1000s = ~16 min margin)
  tokenExpiry = Date.now() + 19000 * 1000
  console.log('[TotalEnergies] Auth successful, token cached')

  return token
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
    'R1': 'RL.1', 'RL1': 'RL.1', 'RL.1': 'RL.1',
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
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json;charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
    },
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

  // Build normalized SipsData
  const result: SipsData = { cups }

  // ── Client / supply point data ──────────────────────────────────
  const cliente = data.ClientesSips?.[0]
  if (cliente) {
    result.distribuidora = cliente.NombreEmpresaDistribuidora || undefined
    result.codigoPostal = cliente.CodigoPostalPS || undefined
    result.provincia = cliente.DesProvinciaPS || cliente.CodigoProvinciaPS || undefined
    result.municipio = cliente.DesMunicipioPS || undefined
    result.cnae = cliente.Cnae || undefined
    result.fechaAlta = cliente.FechaAltaSuministro || undefined
    result.fechaUltimaLectura = cliente.FechaUltimaLectura || undefined

    // Tariff from CodigoPeajeEnVigor (R1 → RL.1, etc.)
    result.tariff = mapGasTariff(cliente.CodigoPeajeEnVigor) ||
                    mapGasTariff(cliente.CodigoTarifaATREnVigor)

    // Build full address from decomposed fields
    const addr = buildAddress(cliente)
    if (addr) (result as any).address = addr
  }

  // ── Consumption history ─────────────────────────────────────────
  if (Array.isArray(data.ConsumosSips) && data.ConsumosSips.length > 0) {
    // Sort chronologically (oldest first)
    const sorted = [...data.ConsumosSips].sort(
      (a, b) =>
        new Date(a.FechaInicioMesConsumo).getTime() -
        new Date(b.FechaInicioMesConsumo).getTime()
    )

    // Gas consumption comes in ConsumoEnWhP1 (in Wh for gas, not kWh)
    // Note: For gas SIPS, the unit is already kWh despite the field name "EnWh"
    // Values like 190, 168, 90 are realistic kWh for residential gas.
    // If they were Wh they'd be 0.19 kWh which makes no sense.
    // The field name is inherited from the electricity schema.
    result.consumptionHistory = sorted.map(entry => {
      const p1 = Math.round(entry.ConsumoEnWhP1 || 0)
      const p2 = Math.round(entry.ConsumoEnWhP2 || 0)
      const total = p1 + p2
      return {
        fecha: entry.FechaFinMesConsumo,
        fechaInicio: entry.FechaInicioMesConsumo,
        fechaFin: entry.FechaFinMesConsumo,
        P1: p1,
        P2: p2,
        P3: 0, P4: 0, P5: 0, P6: 0,
        total,
      }
    })

    // Total consumption = sum of all periods
    const totalKwh = result.consumptionHistory.reduce((s, e) => s + e.total, 0)
    result.totalConsumptionKwh = totalKwh
    result.totalConsumption = `${Math.round(totalKwh).toLocaleString('es-ES')} kWh`

    // Gas has only 1 "period" (P1 = total consumption)
    result.consumoPeriodos = {
      P1: totalKwh,
      P2: 0, P3: 0, P4: 0, P5: 0, P6: 0,
    }

    // No potencia for gas
    result.potenciaContratada = {
      P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0,
    }

    // No maximetro for gas
    result.maximetroHistory = []
    result.reactivaHistory = []
  }

  return result
}

// ─── Bulk fetch for multiple CUPS ───────────────────────────────────

/**
 * Fetch SIPS Gas data for multiple CUPS using the ListCUPS field.
 * Falls back to individual requests if bulk doesn't work.
 */
export async function fetchTotalEnergiesSipsGasBulk(
  cupsList: string[],
  token: string
): Promise<Map<string, SipsData>> {
  const results = new Map<string, SipsData>()

  // Try using ListCUPS field for bulk query first
  if (cupsList.length > 1) {
    try {
      const listStr = cupsList.join(';')
      const res = await fetch(`${SIGE_API_BASE}/api/v1/SIPS/GAS/GetClientesPost`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*',
        },
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
          // Group consumos by CUPS
          const consumosByCups = new Map<string, TotalEnergiesConsumoSips[]>()
          for (const c of data.ConsumosSips || []) {
            const key = c.CodigoCUPS
            if (!consumosByCups.has(key)) consumosByCups.set(key, [])
            consumosByCups.get(key)!.push(c)
          }

          // Build individual SipsData for each client
          for (const cliente of data.ClientesSips) {
            const cupsKey = cliente.CodigoCUPS
            const individualResponse: TotalEnergiesSipsResponse = {
              ClientesSips: [cliente],
              ConsumosSips: consumosByCups.get(cupsKey) || [],
              DatosTitular: null,
            }
            // Re-parse using the same single-CUPS logic
            const sipsData = await parseTotalEnergiesResponse(cupsKey, individualResponse)
            results.set(cupsKey, sipsData)
          }

          console.log(`[TotalEnergies] Bulk query returned ${results.size}/${cupsList.length} CUPS`)

          // If we got all results, return
          if (results.size >= cupsList.length) return results
        }
      }
    } catch (err) {
      console.warn('[TotalEnergies] Bulk query failed, falling back to individual:', err)
    }
  }

  // Fallback: individual queries for missing CUPS (in batches of 5)
  const missing = cupsList.filter(c => !results.has(c))
  const BATCH_SIZE = 5
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE)
    const promises = batch.map(async cups => {
      try {
        const data = await fetchTotalEnergiesSipsGas(cups, token)
        results.set(cups, data)
      } catch (err) {
        console.error(`[TotalEnergies] Failed for ${cups}:`, err)
      }
    })
    await Promise.all(promises)

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < missing.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results
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
  }

  return result
}

// ─── Convenience wrapper ────────────────────────────────────────────

/**
 * Fetch SIPS Gas for a CUPS string (handles auth + normalization).
 * Returns null if CUPS is invalid or fetch fails.
 */
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
