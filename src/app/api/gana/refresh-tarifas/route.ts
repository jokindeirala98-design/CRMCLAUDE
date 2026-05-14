/**
 * POST /api/gana/refresh-tarifas
 *
 * Refresca el cache de tarifas Gana en BD desde /tarifas de su API.
 * Solo admins pueden lanzarlo. La cuenta maestra Gana se usa via env vars.
 *
 * Estrategia: marca todas las filas vigentes=false, e inserta las nuevas
 * vigente=true. Mantenemos historia para auditar cambios de precios.
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { fetchTarifas, classifyTarifa, normalizeTarifaRow } from '@/lib/gana-api'

export const runtime = 'nodejs'

export async function POST() {
  try {
    // Auth
    const ssb = createServerSupabaseClient()
    const { data: { user } } = await ssb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await ssb
      .from('users_profile')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admins' }, { status: 403 })
    }

    // Service client para escritura
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )

    const raws = await fetchTarifas()

    if (!Array.isArray(raws) || raws.length === 0) {
      return NextResponse.json({ error: 'Gana devolvió 0 tarifas' }, { status: 502 })
    }

    // Marcar previas como no vigentes
    await admin.from('gana_tarifas').update({ vigente: false }).eq('vigente', true)

    const rows = raws.map(raw => {
      const nombre = String(raw.nombre ?? raw.name ?? 'Sin nombre')
      const tipo = classifyTarifa(nombre)
      const precios = normalizeTarifaRow(raw)
      const extras = tipo === 'mercado' ? 50 : 0   // confirmado por usuario: +50€/año indexado
      return {
        external_id: raw.id ? String(raw.id) : null,
        nombre,
        tipo: tipo ?? 'fija_24h',     // por defecto fija si no clasifica
        tarifa_atr: '2.0TD',
        precio_p1: precios.precio_p1,
        precio_p2: precios.precio_p2,
        precio_p3: precios.precio_p3,
        potencia_p1: precios.potencia_p1,
        potencia_p2: precios.potencia_p2,
        extras_anuales: extras,
        raw,
        vigente: true,
      }
    })

    const { data, error } = await admin
      .from('gana_tarifas')
      .insert(rows)
      .select('id, nombre, tipo, precio_p1, precio_p2, precio_p3, potencia_p1, potencia_p2, extras_anuales')

    if (error) {
      console.error('[gana/refresh-tarifas] insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, count: data?.length ?? 0, tarifas: data })
  } catch (e: any) {
    console.error('[gana/refresh-tarifas] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 })
  }
}
