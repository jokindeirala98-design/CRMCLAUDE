import { NextRequest, NextResponse } from 'next/server'
import { normalizeCups } from '@/lib/utils/cups'
import { getGreeningToken, fetchSipsData } from '@/lib/sips'

// Re-export SipsData type for consumers that import from this route
export type { SipsData } from '@/lib/sips'

/**
 * POST /api/sips
 *
 * Queries the Greening Energy API to get SIPS data for a CUPS code.
 * Core logic now lives in @/lib/sips for reuse by sync-consumption.
 */
export async function POST(request: NextRequest) {
  try {
    const { cups } = await request.json()

    if (!cups || typeof cups !== 'string') {
      return NextResponse.json({ success: false, error: 'CUPS es requerido' }, { status: 400 })
    }

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
