import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * GET /api/google/shared-status
 * Devuelve si el calendario compartido tiene refresh token configurado.
 */
export async function GET() {
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { data } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'shared_calendar_refresh_token')
      .maybeSingle()

    return NextResponse.json({ connected: !!data?.value })
  } catch {
    return NextResponse.json({ connected: false })
  }
}
