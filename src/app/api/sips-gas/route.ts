import { NextRequest, NextResponse } from 'next/server'
import { fetchAdxSipsGas } from '@/lib/adxenergia'
import {
  fetchTotalEnergiesSipsGas,
  fetchTotalEnergiesSipsGasBulk,
} from '@/lib/totalenergies'

/**
 * POST /api/sips-gas
 *
 * Queries SIPS Gas data. Tries ADX Energía first (simpler auth),
 * falls back to TotalEnergies multi-strategy if ADX fails.
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

    // ── Bulk query (TotalEnergies only for now) ──────────────────
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

    // Strategy A: Try ADX Energía first (more reliable auth)
    let adxError: string | null = null
    const hasAdx = process.env.ADX_SESSION || process.env.ADX_USER
    if (hasAdx) {
      try {
        console.log('[SIPS-GAS] Trying ADX Energía...')
        const data = await fetchAdxSipsGas(cleanCups)
        console.log('[SIPS-GAS] ADX SUCCESS')
        return NextResponse.json({ success: true, data, source: 'adx' })
      } catch (adxErr: any) {
        adxError = adxErr.message || 'Unknown ADX error'
        console.log('[SIPS-GAS] ADX failed:', adxError?.substring(0, 100))
      }
    }

    // Strategy B: TotalEnergies (fallback)
    const hasTe = process.env.TOTALENERGIES_EMAIL || process.env.TOTALENERGIES_TOKEN
    if (hasTe) {
      try {
        const data = await fetchTotalEnergiesSipsGas(cleanCups)
        return NextResponse.json({ success: true, data, source: 'totalenergies' })
      } catch (teErr: any) {
        const teError = teErr.message || 'Unknown TE error'
        const combined = [adxError ? `ADX: ${adxError}` : null, `TE: ${teError}`].filter(Boolean).join(' | ')
        throw new Error(combined)
      }
    }

    // Neither source worked — show ADX error if available
    if (adxError) {
      throw new Error(adxError)
    }
    throw new Error('No hay fuentes SIPS Gas configuradas. Configura ADX_SESSION+ADX_TOKEN o TOTALENERGIES_EMAIL+TOTALENERGIES_PASSWORD en Vercel.')

  } catch (error: any) {
    console.error('[SIPS-GAS] Route error:', error)
    const msg = error.message || 'Error consultando SIPS Gas'
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    )
  }
}
