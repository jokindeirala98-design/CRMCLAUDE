import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSipsForCups } from '@/lib/sips'
import type { SipsData } from '@/lib/sips'
import { normalizeTariff } from '@/lib/consumption-utils'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * POST /api/sync-consumption
 *
 * Builds or refreshes `consumption_snapshots` for a given client_id,
 * pulling data from supplies → SIPS (priority) + invoices (fallback).
 *
 * NEW: For supplies that have a CUPS but no consumption_data yet,
 * automatically fetches SIPS from Greening and persists it on the supply.
 */
export async function POST(req: NextRequest) {
  try {
    const { client_id } = await req.json()
    if (!client_id) {
      return NextResponse.json({ error: 'client_id requerido' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Fetch all supplies for this client (with related data)
    const { data: supplies, error: supplyErr } = await supabase
      .from('supplies')
      .select(`
        id, name, cups, type, tariff, address, status,
        consumption_data, power_data,
        comercializadora:comercializadoras(name),
        invoices:invoices(id, file_url, period_start, period_end, extracted_data, created_at)
      `)
      .eq('client_id', client_id)
      .order('created_at', { ascending: true })

    if (supplyErr) {
      return NextResponse.json({ error: supplyErr.message }, { status: 500 })
    }

    if (!supplies || supplies.length === 0) {
      return NextResponse.json({ error: 'No hay suministros para este cliente' }, { status: 400 })
    }

    // 2. Auto-fetch SIPS for supplies that have CUPS but no consumption_data
    console.log(`[sync-consumption] ${supplies.length} supplies found for client ${client_id}`)

    const suppliesNeedingSips = supplies.filter(
      (s: any) => s.cups && (!s.consumption_data || !s.consumption_data.potenciaContratada)
    )

    if (suppliesNeedingSips.length > 0) {
      console.log(`[sync-consumption] Fetching SIPS for ${suppliesNeedingSips.length} supplies...`)

      // Fetch SIPS in parallel (max 5 concurrent to avoid rate limits)
      const BATCH_SIZE = 5
      for (let i = 0; i < suppliesNeedingSips.length; i += BATCH_SIZE) {
        const batch = suppliesNeedingSips.slice(i, i + BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map(async (supply: any) => {
            const supplyType: 'luz' | 'gas' | undefined =
              supply.type === 'gas' ? 'gas' : supply.type === 'luz' ? 'luz' : undefined
            const sipsData = await fetchSipsForCups(supply.cups, supplyType)
            if (!sipsData) return null

            // Build consumption_data object (same format as supply detail page)
            const updatedConsumption = {
              ...(supply.consumption_data || {}),
              source: 'greening_sips',
              fetched_at: new Date().toISOString(),
              history: sipsData.consumptionHistory || (supply.consumption_data?.history || []),
              maximetroHistory: sipsData.maximetroHistory || (supply.consumption_data?.maximetroHistory || []),
              reactivaHistory: sipsData.reactivaHistory || (supply.consumption_data?.reactivaHistory || []),
              potenciaContratada: sipsData.potenciaContratada || supply.consumption_data?.potenciaContratada,
              consumoPeriodos: sipsData.consumoPeriodos || supply.consumption_data?.consumoPeriodos,
              total: sipsData.totalConsumption || supply.consumption_data?.total,
              totalKwh: sipsData.totalConsumptionKwh || supply.consumption_data?.totalKwh,
              sips_tariff: normalizeTariff(sipsData.tariff) || sipsData.tariff || supply.consumption_data?.sips_tariff,
              distribuidora: sipsData.distribuidora || supply.consumption_data?.distribuidora,
              codigoPostal: sipsData.codigoPostal || supply.consumption_data?.codigoPostal,
              provincia: sipsData.provincia || supply.consumption_data?.provincia,
              municipio: sipsData.municipio || supply.consumption_data?.municipio,
              cnae: sipsData.cnae || supply.consumption_data?.cnae,
              tension: sipsData.tension || supply.consumption_data?.tension,
              fechaAlta: sipsData.fechaAlta || supply.consumption_data?.fechaAlta,
              fechaUltimaLectura: sipsData.fechaUltimaLectura || supply.consumption_data?.fechaUltimaLectura,
            }

            // Persist on the supply record
            const updateData: any = {
              consumption_data: updatedConsumption,
              updated_at: new Date().toISOString(),
            }
            // Also update tariff if we got one from SIPS and supply doesn't have one
            if (!supply.tariff && sipsData.tariff) {
              updateData.tariff = normalizeTariff(sipsData.tariff) || sipsData.tariff
            }

            await supabase
              .from('supplies')
              .update(updateData)
              .eq('id', supply.id)

            // Mutate the supply object in-memory so snapshot building uses fresh data
            supply.consumption_data = updatedConsumption
            if (updateData.tariff) supply.tariff = updateData.tariff

            console.log(`[sync-consumption] SIPS OK for ${supply.cups}`)
            return sipsData
          })
        )

        const failed = results.filter(r => r.status === 'rejected')
        if (failed.length > 0) {
          console.warn(`[sync-consumption] ${failed.length} SIPS fetches failed in batch`)
        }
      }
    }

    // 3. Delete existing snapshots for this client (full refresh)
    await supabase
      .from('consumption_snapshots')
      .delete()
      .eq('client_id', client_id)

    // 4. Build snapshot rows
    const snapshots = supplies.map((supply: any) => {
      const sips = supply.consumption_data as any
      const invoices = (supply.invoices || []) as any[]
      const comercializadoraName = supply.comercializadora?.name || null

      // Sort invoices by period_start descending to get the most recent
      const sortedInvoices = [...invoices].sort((a, b) =>
        new Date(b.period_start || b.created_at).getTime() - new Date(a.period_start || a.created_at).getTime()
      )
      const bestInvoice = sortedInvoices[0]
      const economics = bestInvoice?.extracted_data?.economics

      // ── Potencias (SIPS priority, invoice fallback) ──
      let potencia_p1: number | null = null
      let potencia_p2: number | null = null
      let potencia_p3: number | null = null
      let potencia_p4: number | null = null
      let potencia_p5: number | null = null
      let potencia_p6: number | null = null

      if (sips?.potenciaContratada) {
        const pc = sips.potenciaContratada
        potencia_p1 = pc.P1 ?? null
        potencia_p2 = pc.P2 ?? null
        potencia_p3 = pc.P3 ?? null
        potencia_p4 = pc.P4 ?? null
        potencia_p5 = pc.P5 ?? null
        potencia_p6 = pc.P6 ?? null
      } else if (economics?.potencia) {
        for (const p of economics.potencia) {
          const period = String(p.periodo || '').toUpperCase()
          const kw = Number(p.kw) || 0
          if (period === 'P1') potencia_p1 = kw
          else if (period === 'P2') potencia_p2 = kw
          else if (period === 'P3') potencia_p3 = kw
          else if (period === 'P4') potencia_p4 = kw
          else if (period === 'P5') potencia_p5 = kw
          else if (period === 'P6') potencia_p6 = kw
        }
      }

      // ── Consumos (SIPS priority, invoice fallback) ──
      let consumo_p1: number | null = null
      let consumo_p2: number | null = null
      let consumo_p3: number | null = null
      let consumo_p4: number | null = null
      let consumo_p5: number | null = null
      let consumo_p6: number | null = null
      let consumo_total: number | null = null
      let source: 'sips' | 'invoice_extraction' = 'invoice_extraction'

      if (sips?.consumoPeriodos) {
        const cp = sips.consumoPeriodos
        consumo_p1 = cp.P1 ?? null
        consumo_p2 = cp.P2 ?? null
        consumo_p3 = cp.P3 ?? null
        consumo_p4 = cp.P4 ?? null
        consumo_p5 = cp.P5 ?? null
        consumo_p6 = cp.P6 ?? null
        consumo_total = sips.totalKwh ?? sips.totalConsumptionKwh ?? null
        source = 'sips'
      } else if (economics?.consumo) {
        for (const c of economics.consumo) {
          const period = String(c.periodo || '').toUpperCase()
          const kwh = Number(c.kwh) || 0
          if (period === 'P1') consumo_p1 = kwh
          else if (period === 'P2') consumo_p2 = kwh
          else if (period === 'P3') consumo_p3 = kwh
          else if (period === 'P4') consumo_p4 = kwh
          else if (period === 'P5') consumo_p5 = kwh
          else if (period === 'P6') consumo_p6 = kwh
        }
        consumo_total = economics.consumoTotalKwh ?? null
      }

      // Calculate total from periods if not available
      if (!consumo_total || consumo_total === 0) {
        const sum = (consumo_p1 || 0) + (consumo_p2 || 0) + (consumo_p3 || 0)
          + (consumo_p4 || 0) + (consumo_p5 || 0) + (consumo_p6 || 0)
        if (sum > 0) consumo_total = sum
      }

      // Also try SIPS total if we still have nothing
      if (!consumo_total && sips?.totalConsumptionKwh) {
        consumo_total = Number(sips.totalConsumptionKwh) || null
      }

      // ── Tariff (supply priority, then SIPS, then invoice) — always normalize ──
      const rawTariff = supply.tariff || sips?.sips_tariff || sips?.tariff || economics?.tarifa || null
      const tariff = rawTariff ? (normalizeTariff(rawTariff) || rawTariff) : null

      // ── Invoice file URL (best available) ──
      const invoiceFileUrl = bestInvoice?.file_url || null

      // ── Comercializadora (supply relation, then SIPS, then invoice) ──
      const comercializadora = comercializadoraName || sips?.distribuidora || economics?.comercializadora || null

      // ── Validation ──
      const hasCups = !!supply.cups
      const hasTariff = !!tariff
      const hasConsumption = (consumo_total || 0) > 0
      const hasAddress = !!supply.address
      const validation = (!hasCups || !hasTariff) ? 'Incompleto' as const
        : (!hasConsumption || !hasAddress) ? 'Revisar' as const
        : 'OK' as const

      return {
        client_id,
        supply_id: supply.id,
        name: supply.name || null,
        cups: supply.cups || '',
        tariff,
        supply_type: supply.type || null,
        comercializadora,
        address: supply.address || null,
        potencia_p1, potencia_p2, potencia_p3, potencia_p4, potencia_p5, potencia_p6,
        consumo_p1, consumo_p2, consumo_p3, consumo_p4, consumo_p5, consumo_p6,
        consumo_total,
        source,
        validation_status: validation,
        observations: null,
        confidence_json: null,
        invoice_file_url: invoiceFileUrl,
        periodo: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    })

    // 5. Insert all snapshots
    const { error: insertErr } = await supabase
      .from('consumption_snapshots')
      .insert(snapshots)

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, count: snapshots.length })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
