/**
 * GET /api/portal/v2/invoices/[id]/download
 *
 * Devuelve URL firmada (10 min) para descargar el PDF original de la
 * factura. Comprueba que la factura pertenece a un suministro del
 * cliente autenticado antes de servir nada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { PORTAL_SESSION_COOKIE, resolveSession, auditLog } from '@/lib/portal/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  if (!sessionToken) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const ctx = await resolveSession(sessionToken)
  if (!ctx) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const invoiceId = params.id
  if (!invoiceId) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const sb = admin()
  // Confirmar que la factura pertenece a un suministro del cliente
  const { data: inv, error } = await sb
    .from('invoices')
    .select('id, file_url, file_type, supply_id, period_end, supplies!inner(client_id)')
    .eq('id', invoiceId)
    .maybeSingle() as any
  if (error || !inv) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

  const supplyClientId = inv.supplies?.client_id || inv.supplies?.[0]?.client_id
  if (supplyClientId !== ctx.clientId) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  if (!inv.file_url) {
    return NextResponse.json({ error: 'Esta factura no tiene PDF asociado' }, { status: 404 })
  }

  // Si file_url ya es una URL completa http(s), redirigimos directamente
  if (/^https?:\/\//i.test(inv.file_url)) {
    auditLog({ ctx, action: 'download_invoice_pdf', resourceId: invoiceId }).catch(() => {})
    return NextResponse.redirect(inv.file_url)
  }

  // Si es una ruta de Storage Supabase (bucket/path), generamos URL firmada
  // Formatos esperados: "bucket-name/path/file.pdf" o solo "path/file.pdf"
  const parts = inv.file_url.split('/')
  const bucket = parts[0]
  const path = parts.slice(1).join('/')
  const { data: signed, error: signErr } = await sb.storage.from(bucket).createSignedUrl(path, 600)
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'No se pudo generar la URL de descarga', detail: signErr?.message }, { status: 500 })
  }

  auditLog({ ctx, action: 'download_invoice_pdf', resourceId: invoiceId }).catch(() => {})
  return NextResponse.redirect(signed.signedUrl)
}
