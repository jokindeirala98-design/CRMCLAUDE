import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * POST /api/bulk-ensure-prescorings
 *
 * Regenera prescorings para todos los suministros que aún no tienen uno.
 * Si se pasa client_id, solo procesa los suministros de ese cliente.
 *
 * Body (optional): { client_id?: string }
 */
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const clientId: string | undefined = body.client_id

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Obtener IDs de suministros que YA tienen prescoring (para excluirlos)
    const { data: existing } = await supabase
      .from('prescorings')
      .select('supply_id')

    const existingSupplyIds = new Set((existing || []).map((r: any) => r.supply_id).filter(Boolean))

    // 2. Buscar suministros sin prescoring
    let query = supabase
      .from('supplies')
      .select('id, tariff, type')
      .order('created_at', { ascending: true })

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data: supplies, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 3. Filtrar los que no tienen prescoring
    const toProcess = (supplies || []).filter((s: any) => !existingSupplyIds.has(s.id))

    if (toProcess.length === 0) {
      return NextResponse.json({ created: 0, skipped: 0, total: 0, message: 'Todos los suministros ya tienen prescoring' })
    }

    // 4. Procesar en lotes de 10 para no saturar
    let created = 0
    let skipped = 0
    const BATCH = 10

    for (let i = 0; i < toProcess.length; i += BATCH) {
      const batch = toProcess.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map((s: any) =>
          ensurePendingPrescoring(supabase, s.id, { userId: 'system', updateNulls: true })
        )
      )
      results.forEach(ok => ok ? created++ : skipped++)
    }

    return NextResponse.json({
      created,
      skipped,
      total: toProcess.length,
      message: `${created} prescorings creados, ${skipped} omitidos (2.0TD o sin datos)`,
    })
  } catch (err: any) {
    console.error('[bulk-ensure-prescorings] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
