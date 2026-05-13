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
    // consumoPeriodos (ConsumoPeriodos from SIPS) = annual breakdown by period — most accurate annual total
    const cpAnnual = sipsData.consumoPeriodos as { P1?: number; P2?: number; P3?: number; P4?: number; P5?: number; P6?: number } | undefined
    const consumoPeriodosSum = cpAnnual
      ? (Number(cpAnnual.P1)||0) + (Number(cpAnnual.P2)||0) + (Number(cpAnnual.P3)||0)
        + (Number(cpAnnual.P4)||0) + (Number(cpAnnual.P5)||0) + (Number(cpAnnual.P6)||0)
      : 0
    const estimatedKwh = sipsData.totalConsumptionKwh || 0
    // Prefer consumoPeriodos sum over ConsumoEstimado (which is often inaccurate)
    const bestTotalKwh = consumoPeriodosSum > 0
      ? consumoPeriodosSum
      : (estimatedKwh || null)

    // ── potenciaContratada resolution ─────────────────────────────────────────
    // SIPS sometimes returns placeholder values (35 W → 0.035 kW) which sips.ts
    // already discards (returns undefined). In that case we must NOT overwrite
    // a valid manually-corrected value already in the DB with null.
    // Strategy:
    //   1. If SIPS returned a valid value → use it.
    //   2. Otherwise → keep existing DB value IF it has any period ≥ 0.5 kW.
    //   3. Otherwise → null (both SIPS and DB are artifacts).
    const existingPot = supply.consumption_data?.potenciaContratada as Record<string, number> | undefined | null
    const existingPotIsValid = existingPot != null &&
      Object.values(existingPot).some(v => Number(v) >= 0.5)
    const resolvedPotenciaContratada = sipsData.potenciaContratada
      ?? (existingPotIsValid ? existingPot : null)

    const updatedConsumption = {
      ...(supply.consumption_data || {}),
      source: 'greening_sips',
      fetched_at: new Date().toISOString(),
      // undefined means artifact was discarded — store null explicitly so it clears stale values
      consumoPeriodos: sipsData.consumoPeriodos ?? null,
      potenciaContratada: resolvedPotenciaContratada,
      totalKwh: bestTotalKwh,
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
    const cp = sipsData.consumoPeriodos as { P1?: number; P2?: number; P3?: number; P4?: number; P5?: number; P6?: number } | undefined
    // Use resolved potenciaContratada (SIPS value OR valid existing value, never artifact)
    const pp = resolvedPotenciaContratada as { P1?: number; P2?: number; P3?: number; P4?: number; P5?: number; P6?: number } | null

    const snapshotUpdate: Record<string, any> = {
      source: 'sips',
      updated_at: new Date().toISOString(),
      comercializadora: sipsData.distribuidora || undefined,
    }

    if (pp && Object.values(pp).some(v => (v ?? 0) >= 0.5)) {
      snapshotUpdate.potencia_p1 = pp.P1 ?? null
      snapshotUpdate.potencia_p2 = pp.P2 ?? null
      snapshotUpdate.potencia_p3 = pp.P3 ?? null
      snapshotUpdate.potencia_p4 = pp.P4 ?? null
      snapshotUpdate.potencia_p5 = pp.P5 ?? null
      snapshotUpdate.potencia_p6 = pp.P6 ?? null
    } else {
      // No valid potencia available — clear any artifact values stored previously
      snapshotUpdate.potencia_p1 = null
      snapshotUpdate.potencia_p2 = null
      snapshotUpdate.potencia_p3 = null
      snapshotUpdate.potencia_p4 = null
      snapshotUpdate.potencia_p5 = null
      snapshotUpdate.potencia_p6 = null
    }

    if (cp) {
      snapshotUpdate.consumo_p1 = cp.P1 ?? null
      snapshotUpdate.consumo_p2 = cp.P2 ?? null
      snapshotUpdate.consumo_p3 = cp.P3 ?? null
      snapshotUpdate.consumo_p4 = cp.P4 ?? null
      snapshotUpdate.consumo_p5 = cp.P5 ?? null
      snapshotUpdate.consumo_p6 = cp.P6 ?? null
    }

    // consumo_total: prefer consumoPeriodos sum (measured), fall back to ConsumoEstimado
    if (cp) {
      const sum = (cp.P1||0) + (cp.P2||0) + (cp.P3||0) + (cp.P4||0) + (cp.P5||0) + (cp.P6||0)
      if (sum > 0) {
        snapshotUpdate.consumo_total = sum
      } else if (sipsData.totalConsumptionKwh && sipsData.totalConsumptionKwh > 0) {
        snapshotUpdate.consumo_total = sipsData.totalConsumptionKwh
      }
    } else if (sipsData.totalConsumptionKwh && sipsData.totalConsumptionKwh > 0) {
      snapshotUpdate.consumo_total = sipsData.totalConsumptionKwh
    }

    // ── GAS: meter todo el consumo en P1 ────────────────────────────────────
    // Gas no tiene desglose por periodo, así que volcamos consumo_total a P1
    // para que las funciones que suman periodos (rowTotal, periodTotals,
    // totalConsumption) lo recojan correctamente.
    const isGas = supply.type === 'gas' || /^RL/i.test(supply.tariff || '')
    if (isGas && snapshotUpdate.consumo_total > 0 && !snapshotUpdate.consumo_p1) {
      snapshotUpdate.consumo_p1 = snapshotUpdate.consumo_total
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

    // 6. Update prescoring consumo_anual if a row exists for this supply
    if (bestTotalKwh && bestTotalKwh > 0) {
      const consumoAnualStr = `${Math.round(bestTotalKwh).toLocaleString('es-ES')} kWh`
      await supabase
        .from('prescorings')
        .update({ consumo_anual: consumoAnualStr })
        .eq('supply_id', supply_id)
    }

    return NextResponse.json({ success: true, updated: snapshotUpdate })
  } catch (error: any) {
    console.error('[sync-supply-sips] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
