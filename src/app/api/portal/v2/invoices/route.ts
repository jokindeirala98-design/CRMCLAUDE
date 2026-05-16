/**
 * GET /api/portal/v2/invoices
 *
 * Lista todas las facturas del cliente autenticado con metadatos
 * suficientes para el listado del portal: fechas, importe, consumo,
 * comercializadora, supply al que pertenece. Si la factura tiene PDF
 * en Storage, generamos URL firmada de descarga.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { PORTAL_SESSION_COOKIE, resolveSession, auditLog } from '@/lib/portal/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  if (!sessionToken) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const ctx = await resolveSession(sessionToken)
  if (!ctx) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const sb = admin()
  const clientId = ctx.clientId

  const [supRes, invRes] = await Promise.all([
    sb.from('supplies').select('id, type, cups, name, tariff').eq('client_id', clientId),
    sb.from('supplies')
      .select(`
        id,
        invoices:invoices(
          id, supply_id, source, period_start, period_end, total_amount,
          file_url, file_type, created_at, extracted_data
        )
      `)
      .eq('client_id', clientId),
  ])

  const supplies = supRes.data || []
  const supplyById = new Map(supplies.map(s => [s.id, s]))

  const allInvoices: any[] = []
  for (const s of (invRes.data || []) as any[]) {
    for (const inv of (Array.isArray(s.invoices) ? s.invoices : [])) {
      allInvoices.push(inv)
    }
  }

  // Compactar payload (no devolvemos rawLineItems pesado al cliente)
  const compact = allInvoices.map(inv => {
    const sup = supplyById.get(inv.supply_id)
    const eco = inv.extracted_data?.economics
    return {
      id: inv.id,
      supplyId: inv.supply_id,
      supplyName: sup?.name || null,
      supplyCups: sup?.cups || null,
      supplyType: sup?.type === 'gas' ? 'gas' : 'luz',
      tariff: sup?.tariff || null,
      source: (inv.source || 'historica').toLowerCase(),
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      totalAmount: Number(inv.total_amount) || 0,
      consumoKwh: Number(eco?.consumoTotalKwh) || 0,
      comercializadora: eco?.comercializadora || null,
      fileUrl: inv.file_url || null,
      fileType: inv.file_type || null,
      createdAt: inv.created_at,
    }
  })

  // Orden por periodo descendente (factura más reciente arriba)
  compact.sort((a, b) => {
    const da = a.periodEnd || a.periodStart || ''
    const db = b.periodEnd || b.periodStart || ''
    return db.localeCompare(da)
  })

  auditLog({ ctx, action: 'view_invoices', metadata: { count: compact.length } }).catch(() => {})

  const res = NextResponse.json({
    invoices: compact,
    supplies: supplies.map(s => ({ id: s.id, cups: s.cups, name: s.name, type: s.type, tariff: s.tariff })),
  })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
