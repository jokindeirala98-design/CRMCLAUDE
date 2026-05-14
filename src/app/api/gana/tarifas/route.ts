/**
 * GET /api/gana/tarifas
 *
 * Devuelve las tarifas Gana vigentes para usar en la UI de comparativa 2.0.
 * Lectura sencilla del cache `gana_tarifas` con vigente=true.
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('gana_tarifas')
      .select('id, external_id, nombre, tipo, tarifa_atr, precio_p1, precio_p2, precio_p3, potencia_p1, potencia_p2, extras_anuales, fetched_at')
      .eq('vigente', true)
      .order('tipo', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ tarifas: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 })
  }
}
