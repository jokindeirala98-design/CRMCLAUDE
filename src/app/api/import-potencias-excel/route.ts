import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface PotenciasEntry {
  tariff: string
  potencias: Record<string, number> // { P1: kW, P2: kW, ... }
}

/**
 * POST /api/import-potencias-excel
 *
 * Imports contracted power (potencia contratada) from Excel invoice data
 * for a batch of supplies identified by CUPS.
 *
 * Body: { data: { [cups: string]: PotenciasEntry } }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data: Record<string, PotenciasEntry> = body.data

    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Body must contain a "data" object' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const cupsList = Object.keys(data)

    // Fetch all supplies matching these CUPS
    const { data: supplies, error: supplyErr } = await supabase
      .from('supplies')
      .select('id, cups, tariff, consumption_data, power_data')
      .in('cups', cupsList)

    if (supplyErr) {
      return NextResponse.json({ error: supplyErr.message }, { status: 500 })
    }

    const results: { cups: string; supply_id: string; status: string; potencias?: Record<string, number> }[] = []
    let updated = 0
    let skipped = 0

    for (const supply of (supplies || [])) {
      const entry = data[supply.cups]
      if (!entry) { skipped++; continue }

      const { potencias } = entry

      // Build potenciaContratada object with numeric P1..P6 keys
      const potenciaContratada: Record<string, number> = {}
      for (const [period, kw] of Object.entries(potencias)) {
        // Normalize: "P1 (Punta)" → "P1" (already done client-side, but be safe)
        const key = period.split(' ')[0]
        potenciaContratada[key] = kw
      }

      // Update consumption_data.potenciaContratada
      const updatedConsumptionData = {
        ...(supply.consumption_data || {}),
        potenciaContratada,
        potencia_source: 'excel_invoices',
        potencia_updated_at: new Date().toISOString(),
      }

      // Update the supply record
      const { error: updateErr } = await supabase
        .from('supplies')
        .update({
          consumption_data: updatedConsumptionData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', supply.id)

      if (updateErr) {
        results.push({ cups: supply.cups, supply_id: supply.id, status: 'error: ' + updateErr.message })
        continue
      }

      // Update consumption_snapshots if a row exists
      const snapshotUpdate: Record<string, number | null> = {
        potencia_p1: potenciaContratada['P1'] ?? null,
        potencia_p2: potenciaContratada['P2'] ?? null,
        potencia_p3: potenciaContratada['P3'] ?? null,
        potencia_p4: potenciaContratada['P4'] ?? null,
        potencia_p5: potenciaContratada['P5'] ?? null,
        potencia_p6: potenciaContratada['P6'] ?? null,
      }

      await supabase
        .from('consumption_snapshots')
        .update(snapshotUpdate)
        .eq('supply_id', supply.id)

      updated++
      results.push({ cups: supply.cups, supply_id: supply.id, status: 'ok', potencias: potenciaContratada })
    }

    // Report CUPS not found in DB
    const foundCups = new Set((supplies || []).map(s => s.cups))
    const notFound = cupsList.filter(c => !foundCups.has(c))

    return NextResponse.json({
      ok: true,
      updated,
      skipped,
      not_found: notFound.length,
      not_found_cups: notFound,
      results,
    })
  } catch (err: any) {
    console.error('[import-potencias-excel]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
