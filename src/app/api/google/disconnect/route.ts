import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * POST /api/google/disconnect
 * Removes the stored Google refresh token, disconnecting Calendar sync.
 */
export async function POST() {
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  await admin
    .from('users_profile')
    .update({
      google_refresh_token: null,
      google_calendar_id: null,
      google_tasks_event_id: null,
      google_tasks_event_date: null,
    })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}
