/**
 * POST /api/supplies/import-sips-data
 *
 * Bulk-updates supplies with official SIPS annual consumption and contracted power.
 * Accepts a JSON body with per-CUPS data exported from the SIPS portal.
 *
 * Body: {
 *   data: {
 *     [cups: string]: {
 *       consumoPeriodos: { P1: kWh, P2: kWh, ..., P6: kWh }
 *       totalKwh: number
 *       potenciaContratada?: { P1: kW, P2: kW, ..., P6: kW }
 *       tariff?: string
 *     }
 *   }
 * }
 *
 * Auth: service-role key via x-service-key header OR browser session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  try {
    // Auth: service-role key OR browser session
    const xServiceKey = req.headers.get('x-service-key') || ''
    const isServiceKeyAuth = supabaseServiceKey && xServiceKey && xServiceKey === supabaseServiceKey

    if (!isServiceKeyAuth) {
      const authClient = createServerSupabaseClient()
      const { data: { user } } = await authClient.auth.getUser()
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const data: Record<string, {
      consumoPeriodos: Record<string, number>
      totalKwh: number
      potenciaContratada?: Record<string, number>
      tariff?: string
    }> = body.data

    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Body must contain a "data" object keyed by CUPS' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const cupsList = Object.keys(data)

    // Fetch all supplies matching these CUPS (base-20 prefix match)
    const { data: supplies, error: supplyErr } = await supabase
      .from('supplies')
      .select('id, cups, consumption_data, tariff')
      .in('cups', cupsList)

    if (supplyErr) return NextResponse.json({ error: supplyErr.message }, { status: 500 })

    // Also try base-20 prefix matches for supplies stored with 20-char CUPS
    const cupsBase20Map: Record<string, string> = {}
    for (const cups of cupsList) {
      cupsBase20Map[cups.slice(0, 20)] = cups
    }

    const results: { cups: string; supply_id: string; status: string; totalKwh?: number }[] = []
    let updated = 0
    let notFound = 0
    const processedIds = new Set<string>()

    const allSupplies = supplies || []

    for (const supply of allSupplies) {
      if (processedIds.has(supply.id)) continue

      // Match by exact CUPS or by base-20 prefix
      const entry = data[supply.cups] || data[cupsBase20Map[supply.cups?.slice(0, 20)] || '']
      if (!entry) { notFound++; continue }

      processedIds.add(supply.id)

      const { consumoPeriodos, totalKwh, potenciaContratada } = entry

      // Merge into existing consumption_data — SIPS values win
      const updatedConsumptionData = {
        ...(supply.consumption_data || {}),
        consumoPeriodos,
        totalKwh,
        ...(potenciaContratada && Object.keys(potenciaContratada).length > 0
          ? { potenciaContratada }
          : {}),
        sips_source: 'portal_export',
        sips_updated_at: new Date().toISOString(),
      }

      const patch: Record<string, any> = {
        consumption_data: updatedConsumptionData,
        updated_at: new Date().toISOString(),
      }
      // Update tariff only if provided and supply doesn't already have one
      if (entry.tariff && !supply.tariff) {
        patch.tariff = entry.tariff.split(' ')[0] // "2.0TD ML" → "2.0TD"
      }

      const { error: updateErr } = await supabase
        .from('supplies')
        .update(patch)
        .eq('id', supply.id)

      if (updateErr) {
        results.push({ cups: supply.cups, supply_id: supply.id, status: 'error: ' + updateErr.message })
        continue
      }

      // Also update consumption_snapshots if exists
      if (potenciaContratada) {
        const snapshotPatch: Record<string, number | null> = {}
        for (let i = 1; i <= 6; i++) {
          snapshotPatch[`potencia_p${i}`] = potenciaContratada[`P${i}`] ?? null
        }
        await supabase.from('consumption_snapshots').update(snapshotPatch).eq('supply_id', supply.id)
      }

      updated++
      results.push({ cups: supply.cups, supply_id: supply.id, status: 'ok', totalKwh })
    }

    const foundCups = new Set(allSupplies.map(s => s.cups))
    const notFoundCups = cupsList.filter(c => !foundCups.has(c) && !foundCups.has(cupsBase20Map[c.slice(0, 20)] || ''))

    return NextResponse.json({
      ok: true,
      updated,
      not_found: notFoundCups.length,
      not_found_cups: notFoundCups,
      results,
    })
  } catch (err: any) {
    console.error('[import-sips-data]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
