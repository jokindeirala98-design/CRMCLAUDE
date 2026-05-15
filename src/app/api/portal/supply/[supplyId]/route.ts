/**
 * POST /api/portal/supply/{supplyId}  { token? }
 *
 * Inicialización ONE-SHOT del detalle de suministro en el portal.
 * Valida token, setea cookie y devuelve supply + invoices completas en
 * una sola respuesta. Elimina round-trip secuencial auth → data y
 * acelera la apertura del detalle del suministro.
 *
 * Si la cookie ya está seteada (navegando desde la global), no hace falta
 * pasar el token — la cookie se valida y la respuesta llega igual.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { resolvePortalToken } from '@/lib/portal-data'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: NextRequest, { params }: { params: { supplyId: string } }) {
  try {
    const body = await req.json().catch(() => ({})) as { token?: string }
    let token = body?.token
    if (!token) token = req.cookies.get('voltis_portal_token')?.value
    if (!token) return NextResponse.json({ error: 'token requerido' }, { status: 400 })

    const r = await resolvePortalToken(token)
    if (!r) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

    const sb = admin()
    const supplyId = params.supplyId

    // Fetch supply + facturas en paralelo
    const [supplyRes, invRes] = await Promise.all([
      sb.from('supplies')
        .select('id, cups, tariff, type, name, client_id, consumption_data')
        .eq('id', supplyId)
        .maybeSingle(),
      sb.from('invoices')
        .select('id, file_url, file_type, period_start, period_end, total_amount, extraction_status, created_at, extracted_data, source')
        .eq('supply_id', supplyId)
        .order('period_end', { ascending: false, nullsFirst: false }),
    ])

    const supply = supplyRes.data
    if (!supply || supply.client_id !== r.clientId) {
      return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
    }

    const res = NextResponse.json({
      clientId: r.clientId,
      supply: {
        id: supply.id, cups: supply.cups, tariff: supply.tariff, type: supply.type,
        name: supply.name, clientId: supply.client_id,
        consumption_data: supply.consumption_data,
      },
      invoices: invRes.data ?? [],
    })

    res.cookies.set('voltis_portal_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10,
    })

    // Caché privada con stale-while-revalidate: navegar entre suministros y
    // volver al mismo es instantáneo aunque el cache esté ligeramente rancio.
    res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
    return res
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
