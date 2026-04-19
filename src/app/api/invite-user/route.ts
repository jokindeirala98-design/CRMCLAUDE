import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * POST /api/invite-user
 *
 * Sends a Supabase Auth invite email so the recipient can set their
 * password and get an active account automatically.
 *
 * Only admins may call this endpoint.
 * Body: { email, full_name, role, permissions }
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Verify the caller is an admin
    const supabaseUser = createServerSupabaseClient()
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: callerProfile } = await supabaseUser
      .from('users_profile')
      .select('role')
      .eq('id', user.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo los administradores pueden invitar usuarios' }, { status: 403 })
    }

    // 2. Parse body
    const { email, full_name, role = 'commercial', permissions = {} } = await req.json()
    if (!email || !full_name) {
      return NextResponse.json({ error: 'email y full_name son obligatorios' }, { status: 400 })
    }

    // 3. Use admin client (service role) to send the invite
    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
    const redirectTo = `${appUrl}/auth/set-password`

    const { data: inviteData, error: inviteErr } = await adminSupabase.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo,
        data: {
          full_name,
          role,
          permissions,
        },
      }
    )

    if (inviteErr) {
      // If user already exists in auth, the invite API returns an error
      if (inviteErr.message?.toLowerCase().includes('already been registered') ||
          inviteErr.message?.toLowerCase().includes('already registered') ||
          inviteErr.message?.toLowerCase().includes('already exists')) {
        return NextResponse.json(
          { error: `El email ${email} ya tiene una cuenta activa en el sistema.` },
          { status: 409 }
        )
      }
      console.error('[invite-user] inviteUserByEmail error:', inviteErr)
      return NextResponse.json({ error: inviteErr.message }, { status: 500 })
    }

    // 4. Pre-create the users_profile row so the user is visible in the team
    //    table immediately (before they accept). We use upsert so it's idempotent.
    if (inviteData?.user?.id) {
      await adminSupabase.from('users_profile').upsert({
        id: inviteData.user.id,
        email,
        full_name,
        role,
        permissions,
        active: false,          // becomes true once they log in for the first time
        created_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    }

    return NextResponse.json({ ok: true, userId: inviteData?.user?.id })
  } catch (err: any) {
    console.error('[invite-user] unexpected error:', err)
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}
