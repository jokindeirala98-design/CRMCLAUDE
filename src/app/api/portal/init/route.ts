/**
 * POST /api/portal/init  { token }
 *
 * Inicialización ONE-SHOT del portal cliente. Valida el token, setea la
 * cookie httpOnly Y devuelve TODO el dataset raw del estudio económico
 * global en la MISMA respuesta. Esto elimina el round-trip secuencial
 *   auth → data
 * que antes hacía la página, reduciendo el cold-load del portal a la
 * mitad (típicamente 600-1500 ms → 300-700 ms en móvil 4G).
 *
 * El cliente front-end llama una sola vez al cargar la página principal.
 * Si la cookie ya existe (cliente recurrente), se valida con ella sin
 * necesidad de re-enviar el token del URL.
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { token?: string }
    let token = body?.token
    // Fallback: cookie
    if (!token) token = req.cookies.get('voltis_portal_token')?.value
    if (!token) return NextResponse.json({ error: 'token requerido' }, { status: 400 })

    const r = await resolvePortalToken(token)
    if (!r) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

    const clientId = r.clientId
    const sb = admin()

    // Fetch cliente + supplies+invoices en paralelo
    const [clientRes, suppliesRes] = await Promise.all([
      sb.from('clients')
        .select('id, name, cif, nif, cif_nif, type, alias')
        .eq('id', clientId)
        .single(),
      sb.from('supplies')
        .select(`
          id, cups, type, tariff, name, address, consumption_data,
          comercializadora:comercializadoras(id, name),
          invoices:invoices(id, supply_id, source, period_start, period_end, total_amount, extracted_data)
        `)
        .eq('client_id', clientId),
    ])

    if (!clientRes.data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    const supplies = suppliesRes.data || []

    const flatSupplies = supplies.map((s: any) => {
      const com = Array.isArray(s.comercializadora) ? s.comercializadora[0] : s.comercializadora
      const cd = (s.consumption_data || {}) as any
      const consumoAnual = Number(cd.totalKwh) || Number(cd.total) || 0
      return {
        id: s.id, cups: s.cups,
        type: (s.type === 'gas' ? 'gas' : 'luz') as 'luz' | 'gas',
        tariff: s.tariff, name: s.name, address: s.address,
        comercializadora: com?.name || null,
        distribuidora: cd.distribuidora || null,
        consumoAnualKwh: consumoAnual,
        fechaSipsActualizado: cd.fetched_at || cd.fechaUltimaLectura || null,
        potenciaContratada: cd.potenciaContratada || null,
      }
    })

    const compactInvoices: any[] = []
    for (const s of supplies as any[]) {
      for (const inv of (Array.isArray(s.invoices) ? s.invoices : [])) {
        compactInvoices.push(compactInvoice({
          ...inv,
          supply_id: inv.supply_id ?? s.id,
        }))
      }
    }

    const res = NextResponse.json({
      client: {
        id: clientRes.data.id,
        name: clientRes.data.name,
        alias: clientRes.data.alias,
        cif: clientRes.data.cif || clientRes.data.cif_nif || clientRes.data.nif || null,
        type: clientRes.data.type,
      },
      clientId,
      supplies: flatSupplies,
      invoices: compactInvoices,
    })

    // Setear cookie (sesión muy larga, ya consensuada)
    res.cookies.set('voltis_portal_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10,    // 10 años
    })

    // Cache-Control: respuesta privada cacheable 60s por el navegador del cliente.
    // Útil cuando navega entre suministros y vuelve al global.
    res.headers.set('Cache-Control', 'private, max-age=60')
    return res
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
