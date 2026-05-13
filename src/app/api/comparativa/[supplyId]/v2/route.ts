/**
 * GET /api/comparativa/[supplyId]/v2
 *
 * Endpoint paralelo al V1. Devuelve la comparativa **tripartita por cliente**
 * agregando TODOS los supplies del cliente con facturas Voltis. Si el cliente
 * tiene luz + gas → ambos resultados. Si tiene varios supplies del mismo tipo
 * (ayuntamientos: Estella tiene 91 supplies) → suma de todos en un solo
 * resultado por tipo.
 *
 * Response shape:
 *   {
 *     supply: { ... datos del supply principal abierto, para topbar ... },
 *     resultadoLuz: ResultadoTripartito | null,
 *     resultadoGas: ResultadoTripartito | null,
 *     supplies: Array<{ id, cups, tariff, type, has_voltis }>,   // todos los del cliente
 *   }
 *
 * NO toca al V1 — solo se consume desde ComparativaVoltisV2.tsx.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { computarTripartita } from '@/lib/comparativa-tripartita'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: { supplyId: string } },
) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supplyId = params.supplyId
    if (!supplyId) return NextResponse.json({ error: 'supplyId required' }, { status: 400 })

    // 1. Supply principal — solo para topbar (cliente, CUPS visible, tarifa)
    const { data: principal, error: supErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, client_id, name,
        client:clients(id, name, cif, nif, cif_nif, alias),
        comercializadora:comercializadoras(id, name)
      `)
      .eq('id', supplyId)
      .single()

    if (supErr || !principal) {
      return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
    }

    // 2. TODOS los supplies del cliente con sus facturas
    const { data: clientSupplies } = await supabase
      .from('supplies')
      .select(`id, cups, tariff, type, name, invoices:invoices(*)`)
      .eq('client_id', principal.client_id)

    if (!clientSupplies || clientSupplies.length === 0) {
      return NextResponse.json({ error: 'Sin supplies en el cliente' }, { status: 404 })
    }

    // 3. Separar facturas por tipo (luz / gas) cruzando todos los supplies
    //    del cliente. La función computarTripartita empareja por mes natural,
    //    así que cliente con varios supplies de luz se agregan correctamente.
    const invoicesLuz: any[] = []
    const invoicesGas: any[] = []
    const supplyResumen: Array<{ id: string; cups: string | null; tariff: string | null; type: string; name: string | null; has_voltis: boolean }> = []
    for (const s of clientSupplies as any[]) {
      const invs = Array.isArray(s.invoices) ? s.invoices : []
      const tipo = (s.type === 'gas' || /^RL/i.test(s.tariff || '')) ? 'gas' : 'luz'
      const hasVoltis = invs.some((inv: any) => inv?.source === 'voltis')
      supplyResumen.push({
        id: s.id, cups: s.cups, tariff: s.tariff, type: s.type, name: s.name,
        has_voltis: hasVoltis,
      })
      for (const inv of invs) {
        if (tipo === 'gas') invoicesGas.push(inv)
        else invoicesLuz.push(inv)
      }
    }

    const resultadoLuz = invoicesLuz.length > 0
      ? computarTripartita({ invoices: invoicesLuz, supplyTypeHint: 'luz' })
      : null
    const resultadoGas = invoicesGas.length > 0
      ? computarTripartita({ invoices: invoicesGas, supplyTypeHint: 'gas' })
      : null

    const clientRel = Array.isArray(principal.client) ? principal.client[0] : principal.client
    const comercRel = Array.isArray(principal.comercializadora) ? principal.comercializadora[0] : principal.comercializadora

    return NextResponse.json({
      supply: {
        id: principal.id,
        cups: principal.cups,
        tariff: principal.tariff,
        type: principal.type,
        name: principal.name,
        client_id: principal.client_id,
        client_name: clientRel?.name ?? null,
        client_alias: clientRel?.alias ?? null,
        client_cif: clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null,
        comercializadora: comercRel?.name ?? null,
      },
      resultadoLuz,
      resultadoGas,
      supplies: supplyResumen,
      stats: {
        suppliesLuz: supplyResumen.filter(s => s.type !== 'gas' && !/^RL/i.test(s.tariff || '')).length,
        suppliesGas: supplyResumen.filter(s => s.type === 'gas' || /^RL/i.test(s.tariff || '')).length,
        suppliesLuzVoltis: supplyResumen.filter(s => s.has_voltis && s.type !== 'gas' && !/^RL/i.test(s.tariff || '')).length,
        suppliesGasVoltis: supplyResumen.filter(s => s.has_voltis && (s.type === 'gas' || /^RL/i.test(s.tariff || ''))).length,
      },
    })
  } catch (e: any) {
    console.error('[GET /api/comparativa/[supplyId]/v2]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
