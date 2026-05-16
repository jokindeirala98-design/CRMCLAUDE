/**
 * GET /api/portal/v2/overview
 *
 * Devuelve el dataset crudo del estudio económico global del cliente
 * autenticado. El front-end del portal v2 lo consume al cargar
 * /client-portal/inicio y aplica las agregaciones in-memory (igual que
 * el portal v1).
 *
 * Auth: cookie de sesión portal (voltis_portal_v2_session). NO usa
 * tokens URL — esto es importante para que /client-portal sea
 * inalcanzable sin login.
 *
 * Cache: privada, 60s con stale-while-revalidate de 5 min. Navegar a
 * Ahorros y volver a Inicio es instantáneo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { PORTAL_SESSION_COOKIE, resolveSession, auditLog } from '@/lib/portal/auth'

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

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const ctx = await resolveSession(sessionToken)
  if (!ctx) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
  }

  const sb = admin()
  const clientId = ctx.clientId

  const [clientRes, suppliesRes] = await Promise.all([
    sb.from('clients')
      .select('id, name, cif_nif, nif, type, alias')
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

  if (!clientRes.data) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
  }
  const supplies = suppliesRes.data || []

  // Diagnóstico para Vercel logs: cuántos supplies + facturas estamos
  // sirviendo al cliente. Si está vacío sabemos que el problema es la
  // query, no la UI.
  let totalInvoices = 0
  for (const s of supplies as any[]) {
    if (Array.isArray(s.invoices)) totalInvoices += s.invoices.length
  }
  console.log('[portal:overview] client=' + clientId,
    'name=' + (clientRes.data.name || '?'),
    'supplies=' + supplies.length,
    'invoices=' + totalInvoices)
  if (suppliesRes.error) {
    console.error('[portal:overview] suppliesRes error:', suppliesRes.error.message)
  }

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

  const compactInvoices: any[] = []
  for (const s of supplies as any[]) {
    for (const inv of (Array.isArray(s.invoices) ? s.invoices : [])) {
      compactInvoices.push(compactInvoice({ ...inv, supply_id: inv.supply_id ?? s.id }))
    }
  }

  // Audit log
  auditLog({
    ctx,
    action: 'view_overview',
    ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim(),
    userAgent: req.headers.get('user-agent'),
  }).catch(() => {})

  const res = NextResponse.json({
    client: {
      id: clientRes.data.id,
      name: clientRes.data.name,
      alias: clientRes.data.alias,
      cif: clientRes.data.cif_nif || clientRes.data.nif || null,
      type: clientRes.data.type,
    },
    clientId,
    supplies: flatSupplies,
    invoices: compactInvoices,
    portalUser: {
      id: ctx.user.id,
      email: ctx.user.email,
      displayName: ctx.user.displayName,
      role: ctx.user.role,
    },
  })

  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  return res
}
