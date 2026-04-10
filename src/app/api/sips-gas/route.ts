import { NextRequest, NextResponse } from 'next/server'
import {
  getTotalEnergiesToken,
  fetchTotalEnergiesSipsGas,
  fetchTotalEnergiesSipsGasBulk,
} from '@/lib/totalenergies'

/**
 * POST /api/sips-gas
 *
 * Queries TotalEnergies/SigeEnergia API for SIPS Gas data.
 *
 * Body:
 *   { cups: string }               → single CUPS query
 *   { cupsList: string[] }          → bulk query (multiple CUPS)
 *   { cups: string, supply_type: "gas" }  → explicit gas routing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { cups, cupsList } = body

    // Validate input
    if (!cups && (!cupsList || !Array.isArray(cupsList) || cupsList.length === 0)) {
      return NextResponse.json(
        { success: false, error: 'Se requiere "cups" (string) o "cupsList" (string[])' },
        { status: 400 }
      )
    }

    // Helper: get token, retry once if expired
    const getToken = async (): Promise<string> => {
      try {
        return await getTotalEnergiesToken()
      } catch (err: any) {
        if (err?.message?.includes('expirad')) {
          console.log('[SIPS-GAS] Token expired on first try, retrying...')
          return await getTotalEnergiesToken()
        }
        throw err
      }
    }

    const token = await getToken()

    // ── Bulk query ────────────────────────────────────────────────
    if (Array.isArray(cupsList) && cupsList.length > 0) {
      const cleanList = cupsList
        .map((c: string) => c.replace(/\s/g, '').toUpperCase())
        .filter((c: string) => c.length >= 20)

      if (cleanList.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Ningún CUPS válido en la lista' },
          { status: 400 }
        )
      }

      const results = await fetchTotalEnergiesSipsGasBulk(cleanList, token)

      const data: Record<string, any> = {}
      for (const [k, v] of results.entries()) {
        data[k] = v
      }

      return NextResponse.json({
        success: true,
        count: results.size,
        requested: cleanList.length,
        data,
      })
    }

    // ── Single CUPS query ─────────────────────────────────────────
    const cleanCups = (cups as string).replace(/\s/g, '').toUpperCase()
    if (cleanCups.length < 20) {
      return NextResponse.json(
        { success: false, error: 'Formato de CUPS inválido (mínimo 20 caracteres)' },
        { status: 400 }
      )
    }

    // Try fetch, retry once if token expired mid-request
    let data
    try {
      data = await fetchTotalEnergiesSipsGas(cleanCups, token)
    } catch (err: any) {
      if (err?.message?.includes('expirad')) {
        console.log('[SIPS-GAS] Token expired during fetch, getting fresh token...')
        const freshToken = await getToken()
        data = await fetchTotalEnergiesSipsGas(cleanCups, freshToken)
      } else {
        throw err
      }
    }

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error('[SIPS-GAS] Route error:', error)

    // Specific error messages for common failures
    const msg = error.message || 'Error consultando SIPS Gas'
    if (msg.includes('deben estar configurados')) {
      return NextResponse.json(
        { success: false, error: 'Credenciales de TotalEnergies no configuradas en el servidor' },
        { status: 500 }
      )
    }
    if (msg.includes('Token expirado')) {
      return NextResponse.json(
        { success: false, error: 'Sesión de TotalEnergies expirada, reintenta' },
        { status: 401 }
      )
    }

    // Show actual error for debugging
    return NextResponse.json(
      { success: false, error: `[TotalEnergies] ${msg}` },
      { status: 500 }
    )
  }
}
