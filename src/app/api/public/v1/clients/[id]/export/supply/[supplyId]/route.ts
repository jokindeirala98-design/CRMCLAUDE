/**
 * GET /api/public/v1/clients/{id}/export/supply/{supplyId}?year=2025
 * Descarga Excel de un solo supply.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authPortalRequest } from '@/lib/portal-data'
import { buildSupplyExcel } from '@/lib/portal-excel'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: { id: string; supplyId: string } }) {
  const auth = await authPortalRequest(req, params.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const url = new URL(req.url)
  const year = url.searchParams.get('year') ? parseInt(url.searchParams.get('year')!, 10) : undefined
  const buf = await buildSupplyExcel(params.supplyId, params.id, { year })
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="anual-economics-supply-${year ?? 'all'}.xlsx"`,
    },
  })
}
