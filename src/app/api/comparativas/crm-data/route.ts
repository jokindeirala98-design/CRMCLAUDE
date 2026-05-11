import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * GET /api/comparativas/crm-data
 *
 * Two modes:
 *  ?q=texto        → search supplies by client name or CUPS (returns short list)
 *  ?supply_id=xxx  → load full supply data with extracted invoice prices
 */

// ─── Price extractor helpers (server-side port of AnnualEconomics logic) ──────

function normPeriod(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  const m = s.match(/(?:P|[Pp]er[íi]odo\s*)?([1-6])$/i)
  return m ? `P${m[1]}` : null
}

function getEcoSources(inv: Record<string, unknown>): unknown[] {
  const ed  = inv.extracted_data as Record<string, unknown> | null
  const emd = inv.economics_data  as Record<string, unknown> | null
  return [
    ed?.economics,
    Array.isArray(emd?.potencia) ? emd : (emd?.economics ?? null),
    ed,
  ].filter(Boolean)
}

/** Extract P1/P2 power prices (€/kW·día) from a sorted list of invoices (newest first). */
function extractPowerPrices(invoices: Record<string, unknown>[]): { P1: number; P2: number } {
  for (const inv of invoices) {
    const prices: Record<string, number> = {}
    for (const eco of getEcoSources(inv) as Record<string, unknown>[]) {
      const potArr = Array.isArray(eco?.potencia) ? (eco.potencia as unknown[]) : []
      for (const item of potArr as Record<string, unknown>[]) {
        const p = normPeriod(item.periodo)
        if (!p || !['P1', 'P2', 'P3'].includes(p)) continue
        let price = Number(item.precioKwDia) || Number(item.precioKw) || Number(item.precioUnitario) || 0
        if (!price) {
          const kw  = Number(item.kw)  || 0
          const dias = Number(item.dias) || 0
          const tot = Number(item.total) || 0
          if (kw > 0 && dias > 0 && tot > 0) price = tot / (kw * dias)
        }
        if (price > 0 && price < 5) prices[p] = price
      }
      if (prices.P1 || prices.P2 || prices.P3) break
    }
    if (prices.P1 || prices.P2 || prices.P3) {
      const p1 = prices.P1 || 0
      const p2 = prices.P2 > 0 ? prices.P2 : (prices.P3 > 0 ? prices.P3 : p1)
      return { P1: p1, P2: p2 }
    }
  }
  return { P1: 0, P2: 0 }
}

/** Extract energy prices (€/kWh) per period from invoices (weighted average). */
function extractEnergyPrices(invoices: Record<string, unknown>[]): { P1: number; P2: number; P3: number } {
  const sums: Record<string, { eur: number; kwh: number }> = {
    P1: { eur: 0, kwh: 0 }, P2: { eur: 0, kwh: 0 }, P3: { eur: 0, kwh: 0 },
  }
  let found = false

  for (const inv of invoices) {
    for (const eco of getEcoSources(inv) as Record<string, unknown>[]) {
      const conArr = Array.isArray(eco?.consumo) ? (eco.consumo as unknown[]) : []
      for (const item of conArr as Record<string, unknown>[]) {
        const p = normPeriod(item.periodo)
        if (!p || !['P1', 'P2', 'P3'].includes(p)) continue
        const kwh = Number(item.kwh) || 0
        let price = Number(item.precioKwh) || 0
        if (!price && kwh > 0) {
          const tot = Number(item.total) || 0
          if (tot > 0) price = tot / kwh
        }
        if (kwh > 0 && price > 0 && price < 2) {
          sums[p].eur += price * kwh
          sums[p].kwh += kwh
          found = true
        }
      }
      if (found) break
    }
  }

  return {
    P1: sums.P1.kwh > 0 ? sums.P1.eur / sums.P1.kwh : 0,
    P2: sums.P2.kwh > 0 ? sums.P2.eur / sums.P2.kwh : 0,
    P3: sums.P3.kwh > 0 ? sums.P3.eur / sums.P3.kwh : 0,
  }
}

/** Extract annual consumption by period from invoices (last 12 months). */
function extractAnnualConsumption(invoices: Record<string, unknown>[]): {
  punta: number; llano: number; valle: number; total: number
} {
  let punta = 0, llano = 0, valle = 0

  for (const inv of invoices) {
    for (const eco of getEcoSources(inv) as Record<string, unknown>[]) {
      const conArr = Array.isArray(eco?.consumo) ? (eco.consumo as unknown[]) : []
      for (const item of conArr as Record<string, unknown>[]) {
        const p = normPeriod(item.periodo)
        if (!p) continue
        const kwh = Number(item.kwh) || 0
        if (p === 'P1') punta += kwh
        else if (p === 'P2') llano += kwh
        else if (p === 'P3') valle += kwh
      }
    }
  }

  return { punta, llano, valle, total: punta + llano + valle }
}

/** Detect optional extras in invoices (Pack Smart, etc.) */
function extractExtras(invoices: Record<string, unknown>[]): Array<{ concepto: string; importeAnual: number }> {
  const extraMap: Record<string, number> = {}

  for (const inv of invoices) {
    for (const eco of getEcoSources(inv) as Record<string, unknown>[]) {
      const extras = Array.isArray((eco as Record<string, unknown>)?.extrasOpcionales)
        ? ((eco as Record<string, unknown>).extrasOpcionales as unknown[])
        : []
      for (const ex of extras as Record<string, unknown>[]) {
        const concepto = String(ex.concepto ?? '')
        const importe = Number(ex.importeMensual || ex.importeAnual) || 0
        if (concepto && importe > 0) {
          // Average or accumulate (take max seen across invoices)
          if (!extraMap[concepto] || importe > extraMap[concepto]) {
            extraMap[concepto] = importe
          }
        }
      }
    }
  }

  return Object.entries(extraMap).map(([concepto, imp]) => ({
    concepto,
    importeAnual: imp * 12, // convert monthly to annual
  }))
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()
  const supplyId = searchParams.get('supply_id')?.trim()

  // ── Mode 1: search ──────────────────────────────────────────────────────────
  if (q && q.length >= 2) {
    const { data } = await supabase
      .from('supplies')
      .select('id, cups, tariff, supply_type, client:clients(id, name, type)')
      .or(
        `cups.ilike.%${q}%,clients.name.ilike.%${q}%`
      )
      .eq('supply_type', 'luz')
      .limit(12)

    // Filter out non-2.0TD tariffs
    const results = (data ?? [])
      .filter((s: Record<string, unknown>) => {
        const tariff = String(s.tariff ?? '').toUpperCase()
        return tariff === '2.0TD' || tariff === '' || !tariff
      })
      .map((s: Record<string, unknown>) => {
        const client = s.client as Record<string, unknown> | null
        return {
          id: s.id,
          cups: s.cups,
          tariff: s.tariff,
          clientName: client?.name ?? null,
          clientId: client?.id ?? null,
        }
      })

    return NextResponse.json({ ok: true, results })
  }

  // ── Mode 2: load supply data ────────────────────────────────────────────────
  if (supplyId) {
    // 1. Load supply with client info and SIPS consumption_data
    const { data: supply, error: supplyErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, supply_type, address, name,
        consumption_data, power_data,
        client:clients(id, name, type, fiscal_address)
      `)
      .eq('id', supplyId)
      .single()

    if (supplyErr || !supply) {
      return NextResponse.json({ error: 'Suministro no encontrado' }, { status: 404 })
    }

    // 2. Load last 12 months of invoices (sorted newest first)
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 14) // 14 for buffer

    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, extracted_data, economics_data, period_start, period_end, total_amount, extraction_status')
      .eq('supply_id', supplyId)
      .eq('supply_type', 'luz')
      .in('extraction_status', ['done', 'success'])
      .gte('period_start', twelveMonthsAgo.toISOString().split('T')[0])
      .order('period_start', { ascending: false })
      .limit(14)

    const invList = (invoices ?? []) as Record<string, unknown>[]

    // Sort newest first (by period_start desc)
    invList.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const da = String(a.period_start ?? '')
      const db = String(b.period_start ?? '')
      return db.localeCompare(da)
    })

    // 3. Extract prices from invoices
    const powerPrices = extractPowerPrices(invList)
    const energyPrices = extractEnergyPrices(invList)
    const invoiceConsumption = extractAnnualConsumption(invList)
    const extras = extractExtras(invList)

    // 4. Annual total cost (sum of invoices)
    const totalAnual = invList.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0)

    // 5. Consumption from SIPS if available
    const consumptionData = supply.consumption_data as Record<string, unknown> | null
    let sipsConsumption: { punta: number; llano: number; valle: number; total: number } | null = null

    if (consumptionData) {
      const h = consumptionData.consumptionHistory ?? consumptionData.consumo_historia
      if (Array.isArray(h) && h.length > 0) {
        let p1 = 0, p2 = 0, p3 = 0
        const last12 = (h as Record<string, unknown>[]).slice(0, 12)
        for (const m of last12) {
          p1 += Number(m.P1 ?? m.p1) || 0
          p2 += Number(m.P2 ?? m.p2) || 0
          p3 += Number(m.P3 ?? m.p3) || 0
        }
        if (p1 + p2 + p3 > 0) {
          sipsConsumption = { punta: p1, llano: p2, valle: p3, total: p1 + p2 + p3 }
        }
      }
    }

    // 6. Contracted power from SIPS or supply power_data
    let potencia = { P1: 0, P2: 0 }
    const powerData = supply.power_data as Record<string, unknown> | null
    if (consumptionData?.potenciasContratadas) {
      const pc = consumptionData.potenciasContratadas as Record<string, number>
      potencia = { P1: Number(pc.P1 ?? pc.p1) || 0, P2: Number(pc.P2 ?? pc.p2) || 0 }
    } else if (powerData) {
      potencia = {
        P1: Number(powerData.P1 ?? powerData.p1) || 0,
        P2: Number(powerData.P2 ?? powerData.p2) || 0,
      }
    }

    const client = supply.client as unknown as Record<string, unknown> | null

    return NextResponse.json({
      ok: true,
      supply: {
        id: supply.id,
        cups: supply.cups,
        tariff: supply.tariff,
        address: supply.address ?? supply.name ?? null,
        clientName: client?.name ?? null,
        clientId: client?.id ?? null,
      },
      potencia,
      powerPrices,
      energyPrices,
      consumption: sipsConsumption ?? (invoiceConsumption.total > 0 ? invoiceConsumption : null),
      consumptionSource: sipsConsumption ? 'sips' : (invoiceConsumption.total > 0 ? 'invoices' : null),
      totalAnual: totalAnual > 0 ? totalAnual : null,
      invoiceCount: invList.length,
      extras,
    })
  }

  return NextResponse.json({ error: 'Parámetros incorrectos' }, { status: 400 })
}
