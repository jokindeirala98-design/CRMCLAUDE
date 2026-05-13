/**
 * GET /api/comparativa/[supplyId]/v2
 *
 * Endpoint paralelo al V1 (`/api/comparativa/[supplyId]`). Devuelve la
 * comparativa **tripartita** del suministro: 4 escenarios S0/S1/S2/S3,
 * descomposición Voltis/Gobierno/Cliente y detección automática de cambios
 * normativos (IE, IEH, IVA).
 *
 * NO toca al V1 — se puede consumir desde el componente nuevo
 * ComparativaVoltisV2.tsx sin afectar al endpoint o componente actuales.
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

    const { data: supply, error: supErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, client_id, name,
        client:clients(id, name, cif, nif, cif_nif),
        comercializadora:comercializadoras(id, name),
        invoices:invoices(*)
      `)
      .eq('id', supplyId)
      .single()

    if (supErr || !supply) {
      return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
    }

    const invoices = (supply.invoices as any[]) || []
    const resultado = computarTripartita({
      invoices,
      supplyTypeHint: supply.type === 'gas' ? 'gas' : 'luz',
    })

    // Otros suministros del cliente con facturas Voltis (para selector de CUPS)
    let otrosCupsClient: Array<{
      id: string; cups: string | null; tariff: string | null; type: string; has_voltis: boolean
    }> = []
    if (supply.client_id) {
      const { data: clientSupplies } = await supabase
        .from('supplies')
        .select('id, cups, tariff, type, invoices:invoices(source)')
        .eq('client_id', supply.client_id)
      otrosCupsClient = (clientSupplies || []).map((s: any) => ({
        id: s.id, cups: s.cups, tariff: s.tariff, type: s.type,
        has_voltis: Array.isArray(s.invoices) && s.invoices.some((inv: any) => inv?.source === 'voltis'),
      }))
    }

    const clientRel = Array.isArray(supply.client) ? supply.client[0] : supply.client
    const comercializadoraRel = Array.isArray(supply.comercializadora)
      ? supply.comercializadora[0]
      : supply.comercializadora

    return NextResponse.json({
      supply: {
        id: supply.id,
        cups: supply.cups,
        tariff: supply.tariff,
        type: supply.type,
        name: supply.name,
        client_id: supply.client_id,
        client_name: clientRel?.name ?? null,
        client_cif: clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null,
        comercializadora: comercializadoraRel?.name ?? null,
      },
      resultado,
      otrosCupsClient,
    })
  } catch (e: any) {
    console.error('[GET /api/comparativa/[supplyId]/v2]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
