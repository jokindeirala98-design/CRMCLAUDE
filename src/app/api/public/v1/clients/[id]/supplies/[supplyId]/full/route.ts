/**
 * GET /api/public/v1/clients/{id}/supplies/{supplyId}/full
 *
 * Devuelve TODOS los datos del supply + todas las invoices con extracted_data
 * completo. Lo consume el portal para renderizar AnnualEconomics en read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authPortalRequest } from '@/lib/portal-data'
import { createClient as createAdmin } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest, { params }: { params: { id: string; supplyId: string } }) {
  const auth = await authPortalRequest(req, params.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = admin()
  const { data: supply } = await sb
    .from('supplies')
    .select('id, cups, tariff, type, name, client_id, consumption_data')
    .eq('id', params.supplyId)
    .maybeSingle()
  if (!supply || supply.client_id !== params.id) {
    return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
  }
  const { data: invoices } = await sb
    .from('invoices')
    .select('id, file_url, file_type, period_start, period_end, total_amount, extraction_status, created_at, extracted_data, source')
    .eq('supply_id', params.supplyId)
    .order('period_end', { ascending: false, nullsFirst: false })

  return NextResponse.json({
    supply: {
      id: supply.id, cups: supply.cups, tariff: supply.tariff, type: supply.type,
      name: supply.name, clientId: supply.client_id,
      consumption_data: supply.consumption_data,
    },
    invoices: invoices ?? [],
  })
}
