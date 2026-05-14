/**
 * POST /api/admin/partners/{slug}/clients/{clientId}   → otorga acceso
 * DELETE /api/admin/partners/{slug}/clients/{clientId} → revoca acceso
 * GET    /api/admin/partners/{slug}/clients/{clientId} → estado
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export const runtime = 'nodejs'

async function checkAdmin(req: NextRequest) {
  const sb = createServerSupabaseClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: prof } = await sb.from('users_profile').select('id, role').eq('id', user.id).maybeSingle()
  if (prof?.role !== 'admin') return null
  return prof
}

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function findPartner(slug: string) {
  const { data } = await admin().from('partners').select('id').eq('slug', slug).maybeSingle()
  return data?.id ?? null
}

export async function GET(req: NextRequest, { params }: { params: { slug: string; clientId: string } }) {
  const prof = await checkAdmin(req)
  if (!prof) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const pid = await findPartner(params.slug)
  if (!pid) return NextResponse.json({ shared: false })
  const { data } = await admin().from('partner_clients').select('granted_at')
    .eq('partner_id', pid).eq('client_id', params.clientId).maybeSingle()
  return NextResponse.json({ shared: !!data, granted_at: data?.granted_at ?? null })
}

export async function POST(req: NextRequest, { params }: { params: { slug: string; clientId: string } }) {
  const prof = await checkAdmin(req)
  if (!prof) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const pid = await findPartner(params.slug)
  if (!pid) return NextResponse.json({ error: 'Partner no existe' }, { status: 404 })
  const { error } = await admin().from('partner_clients').upsert({
    partner_id: pid, client_id: params.clientId, granted_by: prof.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shared: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { slug: string; clientId: string } }) {
  const prof = await checkAdmin(req)
  if (!prof) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const pid = await findPartner(params.slug)
  if (!pid) return NextResponse.json({ error: 'Partner no existe' }, { status: 404 })
  const { error } = await admin().from('partner_clients')
    .delete().eq('partner_id', pid).eq('client_id', params.clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shared: false })
}
