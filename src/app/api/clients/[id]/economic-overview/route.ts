/**
 * GET /api/clients/[id]/economic-overview
 *
 * Estudio económico global del cliente. Agrega todas las facturas históricas
 * (source='historica') de todos sus suministros y devuelve KPIs, ranking,
 * serie mensual y desglose por tipo/tarifa.
 *
 * Query params:
 *   - mode: 'last12' (default) | 'previous_year' | 'custom'
 *   - from: YYYY-MM-DD (custom only)
 *   - to:   YYYY-MM-DD (custom only)
 *   - type: 'luz' | 'gas' | 'all' (default)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { computarOverview, type OverviewMode } from '@/lib/economic-overview'

export const runtime = 'nodejs'

/**
 * Comprime una factura a su forma "lite": solo los campos necesarios para
 * la agregación. Reduce drásticamente el payload (extracted_data.economics
 * suele tener 5-10 KB por factura; comprimido baja a <1 KB).
 */
function compactInvoice(inv: any) {
  const eco = inv.extracted_data?.economics
  return {
    id: inv.id,
    supply_id: inv.supply_id,
    source: inv.source || 'historica',
    period_start: inv.period_start,
    period_end: inv.period_end,
    total_amount: inv.total_amount,
    // Reconstruimos un extracted_data minimal compatible con el motor
    extracted_data: eco ? {
      economics: {
        consumo: eco.consumo,
        consumoTotalKwh: eco.consumoTotalKwh,
        totalFactura: eco.totalFactura,
        potencia: eco.potencia,
        otrosConceptos: eco.otrosConceptos,
        gasPricing: eco.gasPricing,
      },
    } : null,
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const clientId = params.id
    const sp = req.nextUrl.searchParams
    const isRaw = sp.get('raw') === '1'
    const modeParam = (sp.get('mode') || 'last12') as OverviewMode
    if (!['last12', 'previous_year', 'custom'].includes(modeParam)) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }
    const from = sp.get('from') || undefined
    const to = sp.get('to') || undefined
    const typeParam = (sp.get('type') || 'all') as 'luz' | 'gas' | 'all'

    // 1. Carga cliente
    const { data: client } = await supabase
      .from('clients')
      .select('id, name, cif, nif, cif_nif, type')
      .eq('id', clientId)
      .single()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // 2. Carga supplies + facturas históricas con extracted_data
    const { data: supplies } = await supabase
      .from('supplies')
      .select(`
        id, cups, type, tariff, name, address, consumption_data,
        comercializadora:comercializadoras(id, name),
        invoices:invoices(id, supply_id, source, period_start, period_end, total_amount, extracted_data)
      `)
      .eq('client_id', clientId)

    if (!supplies) {
      return NextResponse.json({ error: 'No supplies' }, { status: 404 })
    }

    // 3. Flatten supplies + invoices y filtrar historicas.
    //    El consumo anual autoritativo viene de supply.consumption_data:
    //      - LUZ: SIPS (totalKwh / consumoPeriodos del Greening API)
    //      - GAS: ConsumoAnual del Excel Maestro (mismo campo totalKwh)
    const flatSupplies = supplies.map((s: any) => {
      const com = Array.isArray(s.comercializadora) ? s.comercializadora[0] : s.comercializadora
      const cd = (s.consumption_data || {}) as any
      const consumoAnual = Number(cd.totalKwh) || Number(cd.total) || 0
      return {
        id: s.id,
        cups: s.cups,
        type: (s.type === 'gas' ? 'gas' : 'luz') as 'luz' | 'gas',
        tariff: s.tariff,
        name: s.name,
        address: s.address,
        comercializadora: com?.name || null,
        distribuidora: cd.distribuidora || null,
        consumoAnualKwh: consumoAnual,
        fechaSipsActualizado: cd.fetched_at || cd.fechaUltimaLectura || null,
        potenciaContratada: cd.potenciaContratada || null,
      }
    })
    const allInvoices: any[] = []
    for (const s of supplies as any[]) {
      const invs = Array.isArray(s.invoices) ? s.invoices : []
      for (const inv of invs) {
        allInvoices.push({
          id: inv.id,
          supply_id: inv.supply_id ?? s.id,
          source: inv.source || 'historica',
          period_start: inv.period_start,
          period_end: inv.period_end,
          total_amount: inv.total_amount,
          extracted_data: inv.extracted_data,
        })
      }
    }

    // 4. Modo "raw": devolver solo los datos crudos compactados.
    //    La página los carga UNA vez y recompute en cliente cuando cambian
    //    filtros, eliminando la latencia de red en cada interacción.
    if (isRaw) {
      const compactInvoices = allInvoices.map(compactInvoice)
      return NextResponse.json({
        client: { id: client.id, name: client.name, cif: client.cif || client.cif_nif || client.nif || null, type: client.type },
        supplies: flatSupplies,
        invoices: compactInvoices,
      })
    }

    // 5. Modo computado (retro-compatibilidad): hace el cómputo en servidor.
    const result = computarOverview({
      supplies: flatSupplies,
      invoices: allInvoices,
      mode: modeParam,
      from,
      to,
      typeFilter: typeParam,
    })

    return NextResponse.json({
      client: { id: client.id, name: client.name, cif: client.cif || client.cif_nif || client.nif || null, type: client.type },
      ...result,
    })
  } catch (e: any) {
    console.error('[GET /api/clients/[id]/economic-overview]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
