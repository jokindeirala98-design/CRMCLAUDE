import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeTariff } from '@/lib/consumption-utils'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * POST /api/sync-consumption
 *
 * Fast path: builds consumption_snapshots for a client from existing supply
 * data in the DB — no external API calls, no timeouts.
 *
 * Uses (in priority order):
 *   1. supply.consumption_data (already-fetched SIPS stored on the supply)
 *   2. supply.invoices extracted_data (from Gemini invoice extraction)
 *   3. supply base fields (cups, tariff, address, comercializadora)
 *
 * SIPS is NOT fetched here — it can be triggered per-supply via
 * POST /api/sync-supply-sips  (called from the individual supply detail page).
 *
 * This guarantees the API returns within ~2s regardless of how many
 * supplies the ayuntamiento has.
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
        invoices:invoices(id, file_url, period_start, period_end, extracted_data, created_at, extraction_status)
      `)
      .eq('client_id', client_id)
      .order('created_at', { ascending: true })

    if (supplyErr) {
      return NextResponse.json({ error: supplyErr.message }, { status: 500 })
    }

    if (!supplies || supplies.length === 0) {
      return NextResponse.json({ error: 'No hay suministros registrados para este cliente' }, { status: 404 })
    }

    console.log(`[sync-consumption] Building snapshots for ${supplies.length} supplies (client ${client_id})`)

    // 2. Delete existing snapshots (full refresh)
    const { error: deleteErr } = await supabase
      .from('consumption_snapshots')
      .delete()
      .eq('client_id', client_id)

    if (deleteErr) {
      console.warn('[sync-consumption] Delete warning:', deleteErr.message)
      // Non-fatal — continue with insert (may create duplicates but better than nothing)
    }

    // 3. Build snapshot rows from existing DB data (no external API calls)
    const snapshots = supplies.map((supply: any) => {
      const sips = supply.consumption_data as any
      const invoices = (supply.invoices || []) as any[]
      const comercializadoraName = (supply.comercializadora as any)?.name || null

      // Sort invoices by period_start descending, prefer completed extractions
      const sortedInvoices = [...invoices].sort((a, b) => {
        if (a.extraction_status === 'completed' && b.extraction_status !== 'completed') return -1
        if (b.extraction_status === 'completed' && a.extraction_status !== 'completed') return 1
        return new Date(b.period_start || b.created_at).getTime() - new Date(a.period_start || a.created_at).getTime()
      })
      const bestInvoice = sortedInvoices[0]
      const invoiceData = bestInvoice?.extracted_data as any
      const economics = invoiceData?.economics || invoiceData

      // ── Potencias (SIPS priority → power_data → invoice) ──
      let potencia_p1: number | null = null
      let potencia_p2: number | null = null
      let potencia_p3: number | null = null
      let potencia_p4: number | null = null
      let potencia_p5: number | null = null
      let potencia_p6: number | null = null

      if (sips?.potenciaContratada) {
        const pc = sips.potenciaContratada
        potencia_p1 = toNum(pc.P1); potencia_p2 = toNum(pc.P2); potencia_p3 = toNum(pc.P3)
        potencia_p4 = toNum(pc.P4); potencia_p5 = toNum(pc.P5); potencia_p6 = toNum(pc.P6)
      } else if (supply.power_data) {
        const pd = supply.power_data as any
        const pc = pd.potenciaContratada || pd
        if (pc.P1 != null) {
          potencia_p1 = toNum(pc.P1); potencia_p2 = toNum(pc.P2); potencia_p3 = toNum(pc.P3)
          potencia_p4 = toNum(pc.P4); potencia_p5 = toNum(pc.P5); potencia_p6 = toNum(pc.P6)
        }
      } else if (economics?.potencia) {
        for (const p of economics.potencia) {
          const period = String(p.periodo || '').toUpperCase()
          const kw = Number(p.kw) || null
          if (period === 'P1') potencia_p1 = kw
          else if (period === 'P2') potencia_p2 = kw
          else if (period === 'P3') potencia_p3 = kw
          else if (period === 'P4') potencia_p4 = kw
          else if (period === 'P5') potencia_p5 = kw
          else if (period === 'P6') potencia_p6 = kw
        }
      }

      // ── Consumos (SIPS priority → invoice extraction) ──
      let consumo_p1: number | null = null
      let consumo_p2: number | null = null
      let consumo_p3: number | null = null
      let consumo_p4: number | null = null
      let consumo_p5: number | null = null
      let consumo_p6: number | null = null
      let consumo_total: number | null = null
      let source: 'sips' | 'invoice_extraction' | 'manual' = 'manual'

      if (sips?.consumoPeriodos) {
        const cp = sips.consumoPeriodos
        consumo_p1 = toNum(cp.P1); consumo_p2 = toNum(cp.P2); consumo_p3 = toNum(cp.P3)
        consumo_p4 = toNum(cp.P4); consumo_p5 = toNum(cp.P5); consumo_p6 = toNum(cp.P6)
        consumo_total = toNum(sips.totalKwh) ?? toNum(sips.totalConsumptionKwh) ?? null
        source = 'sips'
      } else if (sips?.history && Array.isArray(sips.history) && sips.history.length > 0) {
        // Aggregate annual totals from history (P1-P6 per period)
        const history = sips.history as Array<Record<string, number>>
        let t = 0
        for (const h of history) {
          t += (h.P1||0) + (h.P2||0) + (h.P3||0) + (h.P4||0) + (h.P5||0) + (h.P6||0)
        }
        // Take the most recent year (last entry if sorted)
        const recent = history[0]
        consumo_p1 = toNum(recent.P1); consumo_p2 = toNum(recent.P2); consumo_p3 = toNum(recent.P3)
        consumo_p4 = toNum(recent.P4); consumo_p5 = toNum(recent.P5); consumo_p6 = toNum(recent.P6)
        consumo_total = toNum(sips.totalKwh) ?? toNum(sips.totalConsumptionKwh) ?? (t > 0 ? Math.round(t / history.length) : null)
        source = 'sips'
      } else if (economics?.consumo) {
        for (const c of economics.consumo) {
          const period = String(c.periodo || '').toUpperCase()
          const kwh = Number(c.kwh) || null
          if (period === 'P1') consumo_p1 = kwh
          else if (period === 'P2') consumo_p2 = kwh
          else if (period === 'P3') consumo_p3 = kwh
          else if (period === 'P4') consumo_p4 = kwh
          else if (period === 'P5') consumo_p5 = kwh
          else if (period === 'P6') consumo_p6 = kwh
        }
        consumo_total = toNum(economics.consumoTotalKwh) ?? null
        source = 'invoice_extraction'
      }

      // Calculate total from periods if not set
      if (!consumo_total) {
        const sum = (consumo_p1||0) + (consumo_p2||0) + (consumo_p3||0) + (consumo_p4||0) + (consumo_p5||0) + (consumo_p6||0)
        if (sum > 0) consumo_total = sum
      }

      // Also try the consolidated totalKwh on SIPS data
      if (!consumo_total && sips?.totalKwh) consumo_total = Number(sips.totalKwh) || null
      if (!consumo_total && sips?.total) consumo_total = Number(sips.total) || null

      // ── Tariff ──
      const rawTariff = supply.tariff || sips?.sips_tariff || sips?.tariff || economics?.tarifa || null
      const tariff = rawTariff ? (normalizeTariff(rawTariff) || rawTariff) : null

      // ── Comercializadora ──
      const comercializadora = comercializadoraName || sips?.distribuidora || economics?.comercializadora || null

      // ── Invoice file URL ──
      const invoiceFileUrl = bestInvoice?.file_url || null

      // ── Validation status ──
      const hasCups = !!supply.cups
      const hasTariff = !!tariff
      const hasConsumption = (consumo_total || 0) > 0
      const hasAddress = !!supply.address
      const validation: 'OK' | 'Revisar' | 'Incompleto' =
        !hasCups || !hasTariff ? 'Incompleto'
        : !hasConsumption || !hasAddress ? 'Revisar'
        : 'OK'

      return {
        client_id,
        supply_id: supply.id,
        name: supply.name || null,
        cups: supply.cups || '',
        tariff,
        supply_type: supply.type === 'gas' ? 'gas' : supply.type === 'luz' ? 'luz' : null,
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
        updated_at: new Date().toISOString(),
      }
    })

    // 4. Insert all snapshots at once
    const { error: insertErr } = await supabase
      .from('consumption_snapshots')
      .insert(snapshots)

    if (insertErr) {
      console.error('[sync-consumption] Insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    const sipsFilled = snapshots.filter(s => s.source === 'sips').length
    const invoiceFilled = snapshots.filter(s => s.source === 'invoice_extraction').length
    const empty = snapshots.filter(s => s.source === 'manual').length

    console.log(`[sync-consumption] Created ${snapshots.length} snapshots: ${sipsFilled} SIPS, ${invoiceFilled} invoice, ${empty} empty`)

    return NextResponse.json({
      success: true,
      count: snapshots.length,
      sips_count: sipsFilled,
      invoice_count: invoiceFilled,
      empty_count: empty,
    })
  } catch (error: any) {
    console.error('[sync-consumption] Unexpected error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toNum(v: any): number | null {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}
