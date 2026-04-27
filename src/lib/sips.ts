/**
 * Shared SIPS data fetching logic.
 *
 * Used by:
 *   - /api/sips          (single supply lookup)
 *   - /api/sync-consumption (bulk fetch for ayuntamiento clients)
 */

import { normalizeCups } from '@/lib/utils/cups'

// ─── Greening API config ─────────────────────────────────────
const GREENING_API_BASE = 'https://api.greeningenergy.com'

let cachedToken: string | null = null
let tokenExpiry: number = 0

export async function getGreeningToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken
  }

  const email = process.env.GREENING_EMAIL
  const password = process.env.GREENING_PASSWORD

  if (!email || !password) {
    throw new Error('GREENING_EMAIL y GREENING_PASSWORD deben estar configurados en las variables de entorno')
  }

  console.log('[SIPS] Authenticating with Greening API...')

  const res = await fetch(`${GREENING_API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[SIPS] Login failed:', text)
    throw new Error(`No se pudo autenticar con Greening: ${res.status} - ${text}`)
  }

  const data = await res.json()
  const token = data.Token
  if (!token) {
    throw new Error('Login exitoso pero no se encontró Token en la respuesta')
  }

  cachedToken = token
  tokenExpiry = Date.now() + 55 * 60 * 1000
  console.log('[SIPS] Auth successful, token cached')
  return token
}

// ─── Greening API response interfaces ────────────────────────

interface GreeningSipsInfo {
  Cups: string
  ConsumoEstimado: number
  CodigoCNAE: string
  Tension: number
  TensionFriendlyName: string
  Fases: number
  TipoTarifa: number
  PotenciaContratada: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  ConsumoPeriodos: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
}

interface GreeningConsumoEntry {
  Fecha: string
  P1: number; P2: number; P3: number; P4: number; P5: number; P6: number
}

interface GreeningRawSips {
  ConsumosSips?: Array<{
    CodigoCUPS: string; FechaInicio: string; FechaFin: string; CodigoTarifaATR: string
    Activa1: number; Activa2: number; Activa3: number; Activa4: number; Activa5: number; Activa6: number
    Reactiva1: number; Reactiva2: number; Reactiva3: number; Reactiva4: number; Reactiva5: number; Reactiva6: number
    Potencia1: number; Potencia2: number; Potencia3: number; Potencia4: number; Potencia5: number; Potencia6: number
    [key: string]: any
  }>
  ClientesSips: Array<{
    CodigoCUPS: string; CodigoEmpresaDistribuidora: string; NombreEmpresaDistribuidora: string
    CodigoPostalPS: string; MunicipioPS: string; CodigoProvinciaPS: string
    FechaAltaSuministro: string; CodigoTarifaATREnVigor: string; CodigoTensionV: string
    PotenciaMaximaBIEW: number; PotenciaMaximaAPMW: number
    PotenciasContratadasEnWP1: number; PotenciasContratadasEnWP2: number; PotenciasContratadasEnWP3: number
    PotenciasContratadasEnWP4: number; PotenciasContratadasEnWP5: number; PotenciasContratadasEnWP6: number
    FechaUltimoMovimientoContrato: string; FechaUltimaCambioComercializador: string; FechaUltimaLectura: string
    [key: string]: any
  }>
}

// ─── Normalized output ───────────────────────────────────────

export interface SipsData {
  cups: string
  tariff?: string
  totalConsumption?: string
  totalConsumptionKwh?: number
  consumoPeriodos?: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  potenciaContratada?: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  consumptionHistory?: Array<{
    fecha: string; fechaInicio?: string; fechaFin?: string
    P1: number; P2: number; P3: number; P4: number; P5: number; P6: number; total: number
  }>
  maximetroHistory?: Array<{
    fecha: string; fechaInicio?: string; fechaFin?: string
    P1: number; P2: number; P3: number; P4: number; P5: number; P6: number
  }>
  reactivaHistory?: Array<{
    fecha: string; fechaInicio?: string; fechaFin?: string
    P1: number; P2: number; P3: number; P4: number; P5: number; P6: number
  }>
  distribuidora?: string
  codigoPostal?: string
  provincia?: string
  municipio?: string
  cnae?: string
  tension?: string
  fechaAlta?: string
  fechaUltimaLectura?: string
}

// ─── Helpers ─────────────────────────────────────────────────

function mapTariffCode(code: string | number): string {
  const map: Record<string, string> = {
    '001': '2.0TD', '003': '3.0TD', '004': '2.0TD', '005': '2.0TD',
    '006': '2.0DHA', '011': '3.0TD', '012': '6.1TD', '019': '6.2TD',
    '020': '6.1TD', '021': '6.2TD', '022': '6.3TD', '023': '6.4TD',
    '024': '6.1TD', '025': '6.2TD',
  }
  const tipoMap: Record<string, string> = {
    '202001': '2.0TD', '202020': '2.0TD', '202030': '3.0TD',
    '202061': '6.1TD', '202062': '6.2TD', '202063': '6.3TD', '202064': '6.4TD',
  }
  const s = String(code)
  return map[s] || tipoMap[s] || s
}

async function fetchWithAuth(path: string, cups: string, token: string): Promise<Response> {
  return fetch(`${GREENING_API_BASE}${path}?cups=${encodeURIComponent(cups)}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })
}

// ─── Main fetch function ─────────────────────────────────────

export async function fetchSipsData(cups: string, token: string): Promise<SipsData> {
  const [infoRes, consumoRes, rawRes, maximetroRes] = await Promise.all([
    fetchWithAuth('/api/sips/info', cups, token).catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
    fetchWithAuth('/api/sips/info/consumo', cups, token).catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
    fetchWithAuth('/api/sips/info/raw', cups, token).catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
    fetchWithAuth('/api/sips/info/maximetro', cups, token).catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
  ])

  console.log(`[SIPS] Info: ${infoRes.status}, Consumo: ${consumoRes.status}, Raw: ${rawRes.status}, Maximetro: ${maximetroRes.status}`)

  if (infoRes.status === 401) {
    cachedToken = null
    tokenExpiry = 0
    throw new Error('Token expirado, reintenta la consulta')
  }

  let infoData: GreeningSipsInfo | null = null
  let consumoData: GreeningConsumoEntry[] = []
  let rawData: GreeningRawSips | null = null

  if (infoRes.ok) {
    try { infoData = await infoRes.json() } catch (e) { console.error('[SIPS] Error parsing info:', e) }
  }
  if (consumoRes.ok) {
    try { consumoData = await consumoRes.json() } catch (e) { console.error('[SIPS] Error parsing consumo:', e) }
  }
  if (rawRes.ok) {
    try { rawData = await rawRes.json() } catch (e) { console.error('[SIPS] Error parsing raw:', e) }
  }

  let maximetroData: Array<{ Fecha: string; P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }> = []
  if (maximetroRes.ok) {
    try { maximetroData = await maximetroRes.json() } catch (e) { console.error('[SIPS] Error parsing maximetro:', e) }
  }

  // Build normalized response
  const result: SipsData = { cups }

  if (infoData) {
    result.totalConsumptionKwh = infoData.ConsumoEstimado
    result.totalConsumption = `${Math.round(infoData.ConsumoEstimado).toLocaleString('es-ES')} kWh`
    result.consumoPeriodos = infoData.ConsumoPeriodos
    result.potenciaContratada = infoData.PotenciaContratada
    result.cnae = infoData.CodigoCNAE
    result.tension = infoData.TensionFriendlyName || String(infoData.Tension)
    result.tariff = mapTariffCode(infoData.TipoTarifa)
  }

  if (rawData?.ClientesSips?.[0]) {
    const raw = rawData.ClientesSips[0]
    result.distribuidora = raw.NombreEmpresaDistribuidora
    result.codigoPostal = raw.CodigoPostalPS
    result.provincia = raw.CodigoProvinciaPS
    result.municipio = raw.MunicipioPS
    result.fechaAlta = raw.FechaAltaSuministro
    result.fechaUltimaLectura = raw.FechaUltimaLectura
    if (!result.tariff && raw.CodigoTarifaATREnVigor) {
      result.tariff = mapTariffCode(raw.CodigoTarifaATREnVigor)
    }

    // Enrich potenciaContratada using raw SIPS PotenciasContratadasEnWP* fields.
    // The raw endpoint stores potencias in Watts — divide by 1000 to get kW.
    // This fills in periods that the /info endpoint leaves as 0 or null,
    // which is common for 2.0TD supplies where some distributors only populate P1.
    const rawPotW = {
      P1: Number(raw.PotenciasContratadasEnWP1 || 0) / 1000,
      P2: Number(raw.PotenciasContratadasEnWP2 || 0) / 1000,
      P3: Number(raw.PotenciasContratadasEnWP3 || 0) / 1000,
      P4: Number(raw.PotenciasContratadasEnWP4 || 0) / 1000,
      P5: Number(raw.PotenciasContratadasEnWP5 || 0) / 1000,
      P6: Number(raw.PotenciasContratadasEnWP6 || 0) / 1000,
    }
    // Sanity-check: SIPS sometimes stores artifact values like 3 (Watts) for periods
    // that should be 0 in a 2.0TD. After dividing by 1000 this becomes 0.003 kW —
    // clearly wrong. Discard any value < 0.05 kW that is also < 1% of P1.
    const p1Ref = rawPotW.P1
    for (const k of ['P2', 'P3', 'P4', 'P5', 'P6'] as const) {
      if (rawPotW[k] > 0 && rawPotW[k] < 0.05 && (p1Ref === 0 || rawPotW[k] < p1Ref * 0.01)) {
        rawPotW[k] = 0
      }
    }
    const hasRawPotencia = Object.values(rawPotW).some(v => v > 0)
    if (hasRawPotencia) {
      if (!result.potenciaContratada) {
        result.potenciaContratada = rawPotW
      } else {
        // Fill any zeros left by the /info endpoint with raw SIPS values
        for (const k of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const) {
          if (!(result.potenciaContratada[k] > 0) && rawPotW[k] > 0) {
            result.potenciaContratada[k] = rawPotW[k]
          }
        }
      }
    }
  }

  if (Array.isArray(rawData?.ConsumosSips) && rawData.ConsumosSips.length > 0) {
    const entries: any[] = [...rawData.ConsumosSips].sort(
      (a: any, b: any) => new Date(b.FechaFin).getTime() - new Date(a.FechaFin).getTime()
    )

    result.consumptionHistory = entries.map((e: any) => {
      const p1 = Math.round(e.Activa1 || 0), p2 = Math.round(e.Activa2 || 0), p3 = Math.round(e.Activa3 || 0)
      const p4 = Math.round(e.Activa4 || 0), p5 = Math.round(e.Activa5 || 0), p6 = Math.round(e.Activa6 || 0)
      return { fecha: e.FechaFin, fechaInicio: e.FechaInicio, fechaFin: e.FechaFin, P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6, total: p1+p2+p3+p4+p5+p6 }
    })

    result.maximetroHistory = entries.map((e: any) => ({
      fecha: e.FechaFin, fechaInicio: e.FechaInicio, fechaFin: e.FechaFin,
      P1: Math.round((e.Potencia1||0)*1000)/1000, P2: Math.round((e.Potencia2||0)*1000)/1000,
      P3: Math.round((e.Potencia3||0)*1000)/1000, P4: Math.round((e.Potencia4||0)*1000)/1000,
      P5: Math.round((e.Potencia5||0)*1000)/1000, P6: Math.round((e.Potencia6||0)*1000)/1000,
    }))

    result.reactivaHistory = entries.map((e: any) => ({
      fecha: e.FechaFin, fechaInicio: e.FechaInicio, fechaFin: e.FechaFin,
      P1: Math.round(e.Reactiva1||0), P2: Math.round(e.Reactiva2||0),
      P3: Math.round(e.Reactiva3||0), P4: Math.round(e.Reactiva4||0),
      P5: Math.round(e.Reactiva5||0), P6: Math.round(e.Reactiva6||0),
    }))
  } else if (Array.isArray(consumoData) && consumoData.length > 0) {
    result.consumptionHistory = consumoData.map(entry => {
      const vals = [entry.P1, entry.P2, entry.P3, entry.P4, entry.P5, entry.P6].filter(v => v > 0)
      const maxVal = Math.max(...vals, 0)
      const div = maxVal > 10000 ? 1000 : 1
      const p1 = Math.round((entry.P1||0)/div), p2 = Math.round((entry.P2||0)/div), p3 = Math.round((entry.P3||0)/div)
      const p4 = Math.round((entry.P4||0)/div), p5 = Math.round((entry.P5||0)/div), p6 = Math.round((entry.P6||0)/div)
      return { fecha: entry.Fecha, P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6, total: p1+p2+p3+p4+p5+p6 }
    })
  }

  return result
}

/**
 * Convenience: fetch SIPS for a CUPS string (handles normalization + auth).
 * Returns null if CUPS is invalid or fetch fails.
 *
 * Routes automatically:
 *   - Gas CUPS (22-char ending in letters like "MW") → TotalEnergies
 *   - Electricity CUPS → Greening (as before)
 *
 * If supply_type is provided, it overrides auto-detection.
 */
export async function fetchSipsForCups(
  cups: string,
  supply_type?: 'luz' | 'gas'
): Promise<SipsData | null> {
  try {
    const cleanCups = normalizeCups(cups) || cups.replace(/\s/g, '').toUpperCase()
    if (!cleanCups || cleanCups.length < 20) return null

    const isGas = supply_type === 'gas' || isGasCups(cleanCups)

    if (isGas) {
      // Route gas to TotalEnergies
      try {
        const { fetchSipsGasForCups } = await import('@/lib/totalenergies')
        const result = await fetchSipsGasForCups(cleanCups)
        if (result) return result
      } catch (err) {
        console.warn(`[SIPS] TotalEnergies gas fetch failed for ${cleanCups}, no fallback available:`, err)
        return null
      }
    }

    // Electricity → Greening
    const token = await getGreeningToken()
    return await fetchSipsData(cleanCups, token)
  } catch (err) {
    console.error(`[SIPS] Error fetching for ${cups}:`, err)
    return null
  }
}

/**
 * Heuristic: gas CUPS in Spain typically end with 2 letters (e.g. "MW", "MX")
 * after the 20-digit base, while electricity CUPS end with 2 alphanumeric
 * characters that are often numbers. This is not 100% reliable —
 * the supply_type override is preferred when available.
 */
function isGasCups(cups: string): boolean {
  // Gas CUPS are 22 chars: ES + 16 digits + 2 letters + 2 suffix letters
  // The last 2 characters (positions 20-21) are often letters for gas
  if (cups.length >= 22) {
    const suffix = cups.slice(20, 22)
    return /^[A-Z]{2}$/.test(suffix)
  }
  return false
}
