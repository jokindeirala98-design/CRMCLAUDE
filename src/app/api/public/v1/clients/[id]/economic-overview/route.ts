/**
 * GET /api/public/v1/clients/{id}/economic-overview
 *
 * Versión pública (portal cliente / Kivatio) del endpoint estudio económico.
 * Replica EXACTAMENTE la lógica del endpoint interno /api/clients/[id]/economic-overview
 * pero usa auth dual (cookie portal o Bearer API key).
 *
 * Mantenemos un endpoint paralelo en vez de tocar el interno para no romper
 * el CRM si en el futuro cambian políticas de auth de Supabase.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authPortalRequest } from '@/lib/portal-data'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { computarOverview, type OverviewMode } from '@/lib/economic-overview'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

function compactInvoice(inv: any) {
  const eco = inv.extracted_data?.economics
  return {
    id: inv.id,
    supply_id: inv.supply_id,
    source: inv.source || 'historica',
    period_start: inv.period_start,
    period_end: inv.period_end,
    total_amount: inv.total_amount,
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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Auth dual: portal cookie o Bearer Kivatio
    const auth = await authPortalRequest(req, params.id)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    const sb = admin()

    // 1. Cliente
    const { data: client } = await sb
      .from('clients')
      .select('id, name, cif, nif, cif_nif, type, alias')
      .eq('id', clientId)
      .single()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // 2. Supplies + invoices
    const { data: supplies } = await sb
      .from('supplies')
      .select(`
        id, cups, type, tariff, name, address, consumption_data,
        comercializadora:comercializadoras(id, name),
        invoices:invoices(id, supply_id, source, period_start, period_end, total_amount, extracted_data)
      `)
      .eq('client_id', clientId)

    if (!supplies) return NextResponse.json({ error: 'No supplies' }, { status: 404 })

    // 3. Flatten
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
      for (const inv of (Array.isArray(s.invoices) ? s.invoices : [])) {
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

    if (isRaw) {
      const compactInvoices = allInvoices.map(compactInvoice)
      return NextResponse.json({
        client: { id: client.id, name: client.name, alias: client.alias, cif: client.cif || client.cif_nif || client.nif || null, type: client.type },
        supplies: flatSupplies,
        invoices: compactInvoices,
      })
    }

    const result = computarOverview({
      supplies: flatSupplies,
      invoices: allInvoices,
      mode: modeParam,
      from,
      to,
      typeFilter: typeParam,
    })
    return NextResponse.json({
      client: { id: client.id, name: client.name, alias: client.alias, cif: client.cif || client.cif_nif || client.nif || null, type: client.type },
      ...result,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
