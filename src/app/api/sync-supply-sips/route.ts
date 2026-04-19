import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSipsForCups } from '@/lib/sips'
import { normalizeTariff } from '@/lib/consumption-utils'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * POST /api/sync-supply-sips
 *
 * Fetches SIPS data for a single supply and updates:
 *   1. supplies.consumption_data  (persists SIPS for future syncs)
 *   2. consumption_snapshots row  (updates potencias + consumos live in the table)
 *
 * Body: { supply_id: string, snapshot_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { supply_id, snapshot_id } = await req.json()
    if (!supply_id || !snapshot_id) {
      return NextResponse.json({ error: 'supply_id y snapshot_id son requeridos' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Fetch supply
    const { data: supply, error: supplyErr } = await supabase
      .from('supplies')
      .select('id, cups, type, tariff, consumption_data, power_data')
      .eq('id', supply_id)
      .single()

    if (supplyErr || !supply) {
      return NextResponse.json({ error: 'Suministro no encontrado' }, { status: 404 })
    }

    if (!supply.cups) {
      return NextResponse.json({ error: 'Este suministro no tiene CUPS asignado' }, { status: 422 })
    }

    // 2. Fetch SIPS (may be gas or electricity)
    const supplyType: 'luz' | 'gas' | undefined =
      supply.type === 'gas' ? 'gas' : supply.type === 'luz' ? 'luz' : undefined

    const sipsData = await fetchSipsForCups(supply.cups, supplyType)

    if (!sipsData) {
      return NextResponse.json({ error: 'No se encontraron datos SIPS para este CUPS' }, { status: 404 })
    }

    // 3. Persist SIPS on the supply record
    const updatedConsumption = {
      ...(supply.consumption_data || {}),
      source: 'greening_sips',
      fetched_at: new Date().toISOString(),
      consumoPeriodos: sipsData.consumoPeriodos,
      potenciaContratada: sipsData.potenciaContratada,
      totalKwh: sipsData.totalConsumptionKwh,
      total: sipsData.totalConsumption,
      history: sipsData.consumptionHistory,
      maximetroHistory: sipsData.maximetroHistory,
      reactivaHistory: sipsData.reactivaHistory,
      sips_tariff: normalizeTariff(sipsData.tariff || '') || sipsData.tariff,
      distribuidora: sipsData.distribuidora,
      codigoPostal: sipsData.codigoPostal,
      municipio: sipsData.municipio,
      provincia: sipsData.provincia,
      cnae: sipsData.cnae,
      tension: sipsData.tension,
      fechaAlta: sipsData.fechaAlta,
      fechaUltimaLectura: sipsData.fechaUltimaLectura,
    }

    const supplyUpdate: Record<string, any> = {
      consumption_data: updatedConsumption,
      updated_at: new Date().toISOString(),
    }
    if (!supply.tariff && sipsData.tariff) {
      supplyUpdate.tariff = normalizeTariff(sipsData.tariff) || sipsData.tariff
    }

    await supabase.from('supplies').update(supplyUpdate).eq('id', supply_id)

    // 4. Build updated snapshot fields from SIPS
    const cp = sipsData.consumoPeriodos
    const pp = sipsData.potenciaContratada

    const snapshotUpdate: Record<string, any> = {
      source: 'sips',
      updated_at: new Date().toISOString(),
      comercializadora: sipsData.distribuidora || undefined,
    }

    if (pp) {
      snapshotUpdate.potencia_p1 = pp.P1 ?? null
      snapshotUpdate.potencia_p2 = pp.P2 ?? null
      snapshotUpdate.potencia_p3 = pp.P3 ?? null
      snapshotUpdate.potencia_p4 = pp.P4 ?? null
      snapshotUpdate.potencia_p5 = pp.P5 ?? null
      snapshotUpdate.potencia_p6 = pp.P6 ?? null
    }

    if (cp) {
      snapshotUpdate.consumo_p1 = cp.P1 ?? null
      snapshotUpdate.consumo_p2 = cp.P2 ?? null
      snapshotUpdate.consumo_p3 = cp.P3 ?? null
      snapshotUpdate.consumo_p4 = cp.P4 ?? null
      snapshotUpdate.consumo_p5 = cp.P5 ?? null
      snapshotUpdate.consumo_p6 = cp.P6 ?? null
    }

    if (sipsData.totalConsumptionKwh) {
      snapshotUpdate.consumo_total = sipsData.totalConsumptionKwh
    } else if (cp) {
      const sum = (cp.P1||0) + (cp.P2||0) + (cp.P3||0) + (cp.P4||0) + (cp.P5||0) + (cp.P6||0)
      if (sum > 0) snapshotUpdate.consumo_total = sum
    }

    if (sipsData.tariff) {
      const tariff = normalizeTariff(sipsData.tariff) || sipsData.tariff
      if (tariff) snapshotUpdate.tariff = tariff
    }

    // Validation
    const hasCups = !!supply.cups
    const hasTariff = !!(snapshotUpdate.tariff || supply.tariff)
    const hasConsumption = (snapshotUpdate.consumo_total || 0) > 0
    snapshotUpdate.validation_status = !hasCups || !hasTariff ? 'Incompleto'
      : !hasConsumption ? 'Revisar'
      : 'OK'

    // 5. Update snapshot row
    const { error: snapErr } = await supabase
      .from('consumption_snapshots')
      .update(snapshotUpdate)
      .eq('id', snapshot_id)

    if (snapErr) {
      console.error('[sync-supply-sips] Snapshot update error:', snapErr)
      return NextResponse.json({ error: snapErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, updated: snapshotUpdate })
  } catch (error: any) {
    console.error('[sync-supply-sips] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
