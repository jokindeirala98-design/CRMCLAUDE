import { NextRequest, NextResponse } from 'next/server'
import { normalizeCups } from '@/lib/utils/cups'

/**
 * POST /api/sips
 *
 * Queries the Greening Energy API to get SIPS data for a CUPS code.
 *
 * Confirmed API endpoints (api.greeningenergy.com):
 *   POST /api/auth/login        → { Token, "refresh-token" }
 *   GET  /api/sips/info?cups=   → { Cups, ConsumoEstimado, PotenciaContratada, ConsumoPeriodos, ... }
 *   GET  /api/sips/info/consumo?cups= → [{ Fecha, P1, P2, P3, P4, P5, P6 }, ...]
 *   GET  /api/sips/info/raw?cups=     → { ClientesSips: [{ full metadata }] }
 *
 * All data endpoints require: Authorization: Bearer <Token>
 */

const GREENING_API_BASE = 'https://api.greeningenergy.com'

// Token cache
let cachedToken: string | null = null
let tokenExpiry: number = 0

async function getGreeningToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
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
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  console.log(`[SIPS] Login status: ${res.status}`)

  if (!res.ok) {
    const text = await res.text()
    console.error('[SIPS] Login failed:', text)
    throw new Error(`No se pudo autenticar con Greening: ${res.status} - ${text}`)
  }

  const data = await res.json()
  // Response format: { Token: "eyJ...", "refresh-token": "..." }
  const token = data.Token
  if (!token) {
    console.error('[SIPS] No Token in login response. Keys:', Object.keys(data))
    throw new Error('Login exitoso pero no se encontró Token en la respuesta')
  }

  cachedToken = token
  // JWT tokens from Greening expire — cache for 55 minutes
  tokenExpiry = Date.now() + 55 * 60 * 1000
  console.log('[SIPS] Auth successful, token cached')
  return token
}

// --- Response interfaces (matching actual Greening API) ---

interface GreeningSipsInfo {
  Cups: string
  ConsumoEstimado: number          // Total kWh
  CodigoCNAE: string
  Tension: number
  TensionFriendlyName: string
  Fases: number
  TipoTarifa: number
  PotenciaContratada: {
    P1: number
    P2: number
    P3: number
    P4: number
    P5: number
    P6: number
  }
  ConsumoPeriodos: {
    P1: number
    P2: number
    P3: number
    P4: number
    P5: number
    P6: number
  }
}

interface GreeningConsumoEntry {
  Fecha: string    // ISO date, e.g. "2026-01-31T00:00:00"
  P1: number
  P2: number
  P3: number
  P4: number
  P5: number
  P6: number
}

interface GreeningMaximetroEntry {
  Fecha: string
  P1: number
  P2: number
  P3: number
  P4: number
  P5: number
  P6: number
}

interface GreeningRawSips {
  ConsumosSips?: Array<{
    CodigoCUPS: string
    FechaInicio: string
    FechaFin: string
    CodigoTarifaATR: string
    Activa1: number; Activa2: number; Activa3: number; Activa4: number; Activa5: number; Activa6: number
    Reactiva1: number; Reactiva2: number; Reactiva3: number; Reactiva4: number; Reactiva5: number; Reactiva6: number
    Potencia1: number; Potencia2: number; Potencia3: number; Potencia4: number; Potencia5: number; Potencia6: number
    [key: string]: any
  }>
  ClientesSips: Array<{
    CodigoCUPS: string
    CodigoEmpresaDistribuidora: string
    NombreEmpresaDistribuidora: string
    CodigoPostalPS: string
    MunicipioPS: string
    CodigoProvinciaPS: string
    FechaAltaSuministro: string
    CodigoTarifaATREnVigor: string
    CodigoTensionV: string
    PotenciaMaximaBIEW: number
    PotenciaMaximaAPMW: number
    PotenciasContratadasEnWP1: number
    PotenciasContratadasEnWP2: number
    PotenciasContratadasEnWP3: number
    PotenciasContratadasEnWP4: number
    PotenciasContratadasEnWP5: number
    PotenciasContratadasEnWP6: number
    FechaUltimoMovimientoContrato: string
    FechaUltimoCambioComercializador: string
    FechaUltimaLectura: string
    [key: string]: any
  }>
}

// --- Normalized output for our CRM ---

export interface SipsData {
  cups: string
  tariff?: string
  totalConsumption?: string          // Friendly string, e.g. "1.64 GWh"
  totalConsumptionKwh?: number       // Raw number in kWh
  consumoPeriodos?: {                // Annual aggregated consumption
    P1: number
    P2: number
    P3: number
    P4: number
    P5: number
    P6: number
  }
  potenciaContratada?: {             // Contracted power in kW
    P1: number
    P2: number
    P3: number
    P4: number
    P5: number
    P6: number
  }
  consumptionHistory?: Array<{       // Monthly consumption history
    fecha: string
    fechaInicio?: string
    fechaFin?: string
    P1: number
    P2: number
    P3: number
    P4: number
    P5: number
    P6: number
    total: number
  }>
  // Maximeter data (monthly peak power readings per period)
  maximetroHistory?: Array<{
    fecha: string
    fechaInicio?: string
    fechaFin?: string
    P1: number
    P2: number
    P3: number
    P4: number
    P5: number
    P6: number
  }>
  // Reactive energy data (kvarh per period)
  reactivaHistory?: Array<{
    fecha: string
    fechaInicio?: string
    fechaFin?: string
    P1: number
    P2: number
    P3: number
    P4: number
    P5: number
    P6: number
  }>
  // Raw info from SIPS
  distribuidora?: string
  codigoPostal?: string
  provincia?: string
  municipio?: string
  cnae?: string
  tension?: string
  fechaAlta?: string
  fechaUltimaLectura?: string
}

// Tariff code mapping (CodigoTarifaATREnVigor → friendly name)
function mapTariffCode(code: string | number): string {
  const map: Record<string, string> = {
    '001': '2.0TD',
    '003': '3.0TD',
    '004': '2.0TD',   // legacy
    '005': '2.0TD',
    '006': '2.0DHA',
    '011': '3.0TD',
    '012': '6.1TD',
    '019': '6.2TD',
    '020': '6.1TD',
    '021': '6.2TD',
    '022': '6.3TD',
    '023': '6.4TD',
    '024': '6.1TD',
    '025': '6.2TD',
  }
  // Also handle TipoTarifa numeric codes
  const tipoMap: Record<string, string> = {
    '202061': '6.1TD',
    '202001': '2.0TD',
    '202030': '3.0TD',
    '202062': '6.2TD',
    '202063': '6.3TD',
    '202064': '6.4TD',
  }
  const s = String(code)
  return map[s] || tipoMap[s] || s
}

async function fetchWithAuth(path: string, cups: string, token: string): Promise<Response> {
  return fetch(`${GREENING_API_BASE}${path}?cups=${encodeURIComponent(cups)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  })
}

async function fetchSipsData(cups: string, token: string): Promise<SipsData> {
  // Fetch all endpoints in parallel (including maximetro)
  const [infoRes, consumoRes, rawRes, maximetroRes] = await Promise.all([
    fetchWithAuth('/api/sips/info', cups, token)
      .catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
    fetchWithAuth('/api/sips/info/consumo', cups, token)
      .catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
    fetchWithAuth('/api/sips/info/raw', cups, token)
      .catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
    // Try maximetro endpoint - may or may not exist in the API
    fetchWithAuth('/api/sips/info/maximetro', cups, token)
      .catch(e => ({ ok: false, status: 0, json: async () => null, text: async () => e.message } as any)),
  ])

  console.log(`[SIPS] Info: ${infoRes.status}, Consumo: ${consumoRes.status}, Raw: ${rawRes.status}, Maximetro: ${maximetroRes.status}`)

  // If main info returns 401, clear token so next request re-authenticates
  if (infoRes.status === 401) {
    cachedToken = null
    tokenExpiry = 0
    throw new Error('Token expirado, reintenta la consulta')
  }

  let infoData: GreeningSipsInfo | null = null
  let consumoData: GreeningConsumoEntry[] = []
  let rawData: GreeningRawSips | null = null

  if (infoRes.ok) {
    try {
      infoData = await infoRes.json()
      console.log('[SIPS] Info OK:', JSON.stringify(infoData).substring(0, 200))
    } catch (e) {
      console.error('[SIPS] Error parsing info:', e)
    }
  } else {
    const text = await infoRes.text?.()
    console.error('[SIPS] Info error:', infoRes.status, text?.substring(0, 200))
  }

  if (consumoRes.ok) {
    try {
      consumoData = await consumoRes.json()
      console.log('[SIPS] Consumo OK, entries:', Array.isArray(consumoData) ? consumoData.length : 'not array')
    } catch (e) {
      console.error('[SIPS] Error parsing consumo:', e)
    }
  }

  if (rawRes.ok) {
    try {
      rawData = await rawRes.json()
      console.log('[SIPS] Raw OK')
    } catch (e) {
      console.error('[SIPS] Error parsing raw:', e)
    }
  }

  let maximetroData: GreeningMaximetroEntry[] = []
  if (maximetroRes.ok) {
    try {
      maximetroData = await maximetroRes.json()
      console.log('[SIPS] Maximetro OK, entries:', Array.isArray(maximetroData) ? maximetroData.length : 'not array')
    } catch (e) {
      console.error('[SIPS] Error parsing maximetro:', e)
    }
  } else {
    console.log('[SIPS] Maximetro endpoint not available (this is expected for some providers)')
  }

  // Build normalized response
  const result: SipsData = { cups }

  // From /api/sips/info
  if (infoData) {
    result.totalConsumptionKwh = infoData.ConsumoEstimado
    // Format total consumption in kWh with Spanish locale (period = thousands separator)
    const kwh = infoData.ConsumoEstimado
    result.totalConsumption = `${Math.round(kwh).toLocaleString('es-ES')} kWh`

    result.consumoPeriodos = infoData.ConsumoPeriodos
    result.potenciaContratada = infoData.PotenciaContratada
    result.cnae = infoData.CodigoCNAE
    result.tension = infoData.TensionFriendlyName || String(infoData.Tension)

    // Determine tariff from TipoTarifa
    result.tariff = mapTariffCode(infoData.TipoTarifa)
  }

  // From /api/sips/info/raw — primary source for ALL historical data
  // The ConsumosSips array contains Activa (kWh), Potencia/maxímetro (kW) and Reactiva (kvarh)
  // with proper FechaInicio/FechaFin for each billing period
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
  }

  if (Array.isArray(rawData?.ConsumosSips) && rawData.ConsumosSips.length > 0) {
    // Sort descending by FechaFin (most recent first)
    const entries: any[] = [...rawData.ConsumosSips].sort(
      (a: any, b: any) => new Date(b.FechaFin).getTime() - new Date(a.FechaFin).getTime()
    )
    console.log(`[SIPS] ConsumosSips: ${entries.length} entries, first: ${entries[0]?.FechaInicio} → ${entries[0]?.FechaFin}`)

    // Consumption (Activa1-6, already in kWh)
    result.consumptionHistory = entries.map((e: any) => {
      const p1 = Math.round(e.Activa1 || 0)
      const p2 = Math.round(e.Activa2 || 0)
      const p3 = Math.round(e.Activa3 || 0)
      const p4 = Math.round(e.Activa4 || 0)
      const p5 = Math.round(e.Activa5 || 0)
      const p6 = Math.round(e.Activa6 || 0)
      return {
        fecha: e.FechaFin,
        fechaInicio: e.FechaInicio,
        fechaFin: e.FechaFin,
        P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6,
        total: p1 + p2 + p3 + p4 + p5 + p6,
      }
    })

    // Maxímetros (Potencia1-6, in kW)
    result.maximetroHistory = entries.map((e: any) => ({
      fecha: e.FechaFin,
      fechaInicio: e.FechaInicio,
      fechaFin: e.FechaFin,
      P1: Math.round((e.Potencia1 || 0) * 1000) / 1000,
      P2: Math.round((e.Potencia2 || 0) * 1000) / 1000,
      P3: Math.round((e.Potencia3 || 0) * 1000) / 1000,
      P4: Math.round((e.Potencia4 || 0) * 1000) / 1000,
      P5: Math.round((e.Potencia5 || 0) * 1000) / 1000,
      P6: Math.round((e.Potencia6 || 0) * 1000) / 1000,
    }))

    // Reactiva (Reactiva1-6, in kvarh)
    result.reactivaHistory = entries.map((e: any) => ({
      fecha: e.FechaFin,
      fechaInicio: e.FechaInicio,
      fechaFin: e.FechaFin,
      P1: Math.round(e.Reactiva1 || 0),
      P2: Math.round(e.Reactiva2 || 0),
      P3: Math.round(e.Reactiva3 || 0),
      P4: Math.round(e.Reactiva4 || 0),
      P5: Math.round(e.Reactiva5 || 0),
      P6: Math.round(e.Reactiva6 || 0),
    }))

    console.log(`[SIPS] Extracted from ConsumosSips: ${result.consumptionHistory.length} consumo, ${result.maximetroHistory.length} maxímetro, ${result.reactivaHistory.length} reactiva entries`)
  } else if (Array.isArray(consumoData) && consumoData.length > 0) {
    // Fallback: use /consumo endpoint when ConsumosSips is absent
    console.log('[SIPS] Falling back to /consumo endpoint (no ConsumosSips)')
    result.consumptionHistory = consumoData.map(entry => {
      const vals = [entry.P1, entry.P2, entry.P3, entry.P4, entry.P5, entry.P6].filter(v => v > 0)
      const maxVal = Math.max(...vals, 0)
      const div = maxVal > 10000 ? 1000 : 1
      const p1 = Math.round((entry.P1 || 0) / div)
      const p2 = Math.round((entry.P2 || 0) / div)
      const p3 = Math.round((entry.P3 || 0) / div)
      const p4 = Math.round((entry.P4 || 0) / div)
      const p5 = Math.round((entry.P5 || 0) / div)
      const p6 = Math.round((entry.P6 || 0) / div)
      return { fecha: entry.Fecha, P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6, total: p1+p2+p3+p4+p5+p6 }
    })
  }

  return result
}

export async function POST(request: NextRequest) {
  try {
    const { cups } = await request.json()

    if (!cups || typeof cups !== 'string') {
      return NextResponse.json({ success: false, error: 'CUPS es requerido' }, { status: 400 })
    }

    // Normalize CUPS to canonical 20-char form
    const cleanCups = normalizeCups(cups)
    if (!cleanCups) {
      return NextResponse.json({ success: false, error: 'Formato de CUPS inválido' }, { status: 400 })
    }

    const token = await getGreeningToken()
    const data = await fetchSipsData(cleanCups, token)

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error('[SIPS] Route error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error consultando SIPS' },
      { status: 500 }
    )
  }
}
