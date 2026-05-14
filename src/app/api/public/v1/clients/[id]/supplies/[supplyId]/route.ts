/**
 * GET /api/public/v1/clients/{id}/supplies/{supplyId}
 * Detalle de un supply para el portal cliente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authPortalRequest, getPortalSupplyDetail } from '@/lib/portal-data'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: { id: string; supplyId: string } }) {
  const auth = await authPortalRequest(req, params.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const detail = await getPortalSupplyDetail(params.supplyId, params.id)
  if (!detail) return NextResponse.json({ error: 'Supply not found' }, { status: 404 })

  return NextResponse.json(detail, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  })
}
