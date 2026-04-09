import { NextRequest, NextResponse } from 'next/server'
import { normalizeCups } from '@/lib/utils/cups'
import { getGreeningToken, fetchSipsData, fetchSipsForCups } from '@/lib/sips'

// Re-export SipsData type for consumers that import from this route
export type { SipsData } from '@/lib/sips'

/**
 * POST /api/sips
 *
 * Queries SIPS data for a CUPS code.
 * Routes automatically:
 *   - Gas (supply_type="gas" or gas CUPS pattern) → TotalEnergies
 *   - Electricity → Greening Energy API
 *
 * Body: { cups: string, supply_type?: "luz" | "gas" }
 */
export async function POST(request: NextRequest) {
  try {
    const { cups, supply_type } = await request.json()

    if (!cups || typeof cups !== 'string') {
      return NextResponse.json({ success: false, error: 'CUPS es requerido' }, { status: 400 })
    }

    // If supply_type is gas, route to TotalEnergies via the unified function
    if (supply_type === 'gas') {
      const data = await fetchSipsForCups(cups, 'gas')
      if (!data) {
        return NextResponse.json(
          { success: false, error: 'No se pudieron obtener datos SIPS de gas para este CUPS' },
          { status: 404 }
        )
      }
      return NextResponse.json({ success: true, data, source: 'totalenergies' })
    }

    // Default: electricity via Greening
    const cleanCups = normalizeCups(cups)
    if (!cleanCups) {
      return NextResponse.json({ success: false, error: 'Formato de CUPS inválido' }, { status: 400 })
    }

    const token = await getGreeningToken()
    const data = await fetchSipsData(cleanCups, token)

    return NextResponse.json({ success: true, data, source: 'greening' })
  } catch (error: any) {
    console.error('[SIPS] Route error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error consultando SIPS' },
      { status: 500 }
    )
  }
}
