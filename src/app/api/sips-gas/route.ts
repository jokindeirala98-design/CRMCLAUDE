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

    const token = await getTotalEnergiesToken()

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

      // Convert Map to object for JSON response
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

    const data = await fetchTotalEnergiesSipsGas(cleanCups, token)

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error('[SIPS-GAS] Route error:', error)

    // Specific error messages for common failures
    if (error.message?.includes('TOTALENERGIES_EMAIL')) {
      return NextResponse.json(
        { success: false, error: 'Credenciales de TotalEnergies no configuradas en el servidor' },
        { status: 500 }
      )
    }
    if (error.message?.includes('Token expirado')) {
      return NextResponse.json(
        { success: false, error: 'Sesión de TotalEnergies expirada, reintenta' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Error consultando SIPS Gas' },
      { status: 500 }
    )
  }
}
