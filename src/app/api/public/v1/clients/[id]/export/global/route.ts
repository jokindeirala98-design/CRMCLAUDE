/**
 * GET /api/public/v1/clients/{id}/export/global?year=2025&type=all
 * Descarga Excel global del cliente con una hoja por supply.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authPortalRequest } from '@/lib/portal-data'
import { buildClientExcel } from '@/lib/portal-excel'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authPortalRequest(req, params.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const year = url.searchParams.get('year') ? parseInt(url.searchParams.get('year')!, 10) : undefined
  const type = (url.searchParams.get('type') as 'all'|'luz'|'gas'|null) || 'all'

  const buf = await buildClientExcel(params.id, { year, type })
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="anual-economics-${year ?? 'global'}.xlsx"`,
    },
  })
}
