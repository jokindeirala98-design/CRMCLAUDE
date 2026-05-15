/**
 * GET /api/public/v1/clients/{id}/export/supply/{supplyId}?year=2025
 * Descarga Excel de un solo supply.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authPortalRequest } from '@/lib/portal-data'
import { buildSupplyExcel } from '@/lib/portal-excel'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { supplyExcelFilename } from '@/lib/utils/download-names'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: { id: string; supplyId: string } }) {
  const auth = await authPortalRequest(req, params.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const url = new URL(req.url)
  const year = url.searchParams.get('year') ? parseInt(url.searchParams.get('year')!, 10) : undefined
  const buf = await buildSupplyExcel(params.supplyId, params.id, { year })

  // Para construir el filename estándar, buscamos cups + client name.
  const sb = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const [{ data: sup }, { data: cli }] = await Promise.all([
    sb.from('supplies').select('cups, name').eq('id', params.supplyId).maybeSingle(),
    sb.from('clients').select('name, alias').eq('id', params.id).maybeSingle(),
  ])
  const filename = supplyExcelFilename({
    cups: sup?.cups,
    clientName: cli?.alias || cli?.name || sup?.name || undefined,
    year,
  })

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
