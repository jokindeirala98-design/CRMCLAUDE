/**
 * GET /api/comparativa/[supplyId]
 *
 * Devuelve la comparativa de coste real "Voltis vs antigua" del suministro:
 *   - Empareja cada factura source='voltis' con la histórica del mismo mes
 *     natural del año anterior.
 *   - Simula la factura que habría cobrado la antigua al consumo Voltis
 *     (por periodo P1-P6 en luz, sólo TV en gas).
 *   - Agrega los totales y devuelve también el listado de otros suministros
 *     del mismo cliente que también tienen facturas Voltis (para el selector
 *     de CUPS en la UI).
 *
 * Response shape:
 *   {
 *     supply: { id, cups, tariff, type, client_id, client_name, comercializadora? },
 *     comparativa: ResultadoComparativa,   // ver src/lib/comparativa-energetica.ts
 *     otrosCupsClient: { id, cups, tariff, type, has_voltis: boolean }[]
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { computarComparativa } from '@/lib/comparativa-energetica'

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
    if (!supplyId) {
      return NextResponse.json({ error: 'supplyId required' }, { status: 400 })
    }

    // ── 1. Cargar supply + facturas (con source) ─────────────────────────────
    const { data: supply, error: supErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, client_id, name,
        client:clients(id, name),
        comercializadora:comercializadoras(id, name),
        invoices:invoices(*)
      `)
      .eq('id', supplyId)
      .single()

    if (supErr || !supply) {
      return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
    }

    const invoices = (supply.invoices as any[]) || []

    // ── 2. Calcular la comparativa ──────────────────────────────────────────
    const comparativa = computarComparativa(invoices, supply.type as any)

    // ── 3. Otros suministros del mismo cliente con facturas Voltis ──────────
    //    Para alimentar el selector de CUPS de la UI.
    let otrosCupsClient: Array<{
      id: string; cups: string | null; tariff: string | null; type: string; has_voltis: boolean
    }> = []

    if (supply.client_id) {
      const { data: clientSupplies } = await supabase
        .from('supplies')
        .select('id, cups, tariff, type, invoices:invoices(source)')
        .eq('client_id', supply.client_id)

      otrosCupsClient = (clientSupplies || []).map((s: any) => ({
        id: s.id,
        cups: s.cups,
        tariff: s.tariff,
        type: s.type,
        has_voltis: Array.isArray(s.invoices)
          && s.invoices.some((inv: any) => inv?.source === 'voltis'),
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
        comercializadora: comercializadoraRel?.name ?? null,
      },
      comparativa,
      otrosCupsClient,
    })
  } catch (e: any) {
    console.error('[GET /api/comparativa/[supplyId]]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
