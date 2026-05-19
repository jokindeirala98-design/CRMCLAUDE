/**
 * POST /api/gana/recalculate
 *
 * Recalcula los 3 escenarios con un input editado en la UI (sin volver a
 * tocar BD). Útil cuando el comercial ajusta potencias o precios actuales
 * desde el panel y quiere ver el impacto en los ahorros sin re-fetch del
 * supply completo.
 *
 * Body: { input: InputComparativa2td }
 * Devuelve: { result: ComparativaGanaResult }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  computarComparativaGana,
  buildScenariosFromTarifas,
  type GanaTarifaRow,
  type InputComparativa2td,
} from '@/lib/comparativa-2td-gana'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const input = body?.input as InputComparativa2td | undefined
    if (!input) return NextResponse.json({ error: 'input requerido' }, { status: 400 })

    const { data: tarifas } = await supabase
      .from('gana_tarifas')
      .select('id, comercializadora, nombre, tipo, precio_p1, precio_p2, precio_p3, potencia_p1, potencia_p2, extras_anuales, management_fee_day')
      .eq('vigente', true)
      .eq('tarifa_atr', '2.0TD')

    if (!tarifas || tarifas.length === 0) {
      return NextResponse.json({ error: 'No hay tarifas Gana vigentes' }, { status: 412 })
    }

    const scenarios = buildScenariosFromTarifas(tarifas as GanaTarifaRow[])
    const result = computarComparativaGana({ input, scenarios })

    return NextResponse.json({ result })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 })
  }
}
