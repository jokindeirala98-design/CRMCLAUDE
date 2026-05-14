/**
 * GET /api/public/v1/clients/{id}/overview
 *
 * Devuelve overview agregado del cliente (KPIs + supplies + subtotales).
 * Acepta auth por cookie magic-link o Bearer API key Partner.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authPortalRequest, getPortalOverview } from '@/lib/portal-data'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authPortalRequest(req, params.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const yearParam = url.searchParams.get('year')
  const typeParam = (url.searchParams.get('type') as 'all'|'luz'|'gas'|null) || 'all'

  const overview = await getPortalOverview(params.id, {
    year: yearParam ? parseInt(yearParam, 10) : undefined,
    type: typeParam,
  })
  if (!overview) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  return NextResponse.json(overview, {
    headers: { 'Cache-Control': 'private, max-age=120' },
  })
}
