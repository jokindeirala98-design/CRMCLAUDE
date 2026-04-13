import { NextRequest, NextResponse } from 'next/server'
import {
  fetchTotalEnergiesSipsGas,
  fetchTotalEnergiesSipsGasBulk,
} from '@/lib/totalenergies'

/**
 * POST /api/sips-gas
 *
 * Queries SIPS Gas data using multiple strategies:
 * 1. Direct credentials on SigeEnergia API
 * 2. LoginPost → token → SigeEnergia API
 * 3. Manual token from env var
 * 4. CNMC official SIPS API (if configured)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { cups, cupsList } = body

    if (!cups && (!cupsList || !Array.isArray(cupsList) || cupsList.length === 0)) {
      return NextResponse.json(
        { success: false, error: 'Se requiere "cups" (string) o "cupsList" (string[])' },
        { status: 400 }
      )
    }

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

      const results = await fetchTotalEnergiesSipsGasBulk(cleanList)
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

    const data = await fetchTotalEnergiesSipsGas(cleanCups)
    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error('[SIPS-GAS] Route error:', error)
    const msg = error.message || 'Error consultando SIPS Gas'

    if (msg.includes('deben estar configurados')) {
      return NextResponse.json(
        { success: false, error: 'Credenciales de TotalEnergies no configuradas en el servidor' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    )
  }
}
