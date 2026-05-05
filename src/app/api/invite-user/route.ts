import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * POST /api/invite-user
 *
 * Creates a team member account. Two modes:
 *   - password provided → creates user immediately with a set password (no email needed)
 *   - no password → sends a Supabase Auth invite email so they set their own password
 *
 * Only admins may call this endpoint.
 * Body: { email, full_name, role, permissions, password? }
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
      return NextResponse.json({ error: 'Solo los administradores pueden crear usuarios' }, { status: 403 })
    }

    // 2. Parse body
    const { email, full_name, nickname, role = 'commercial', permissions = {}, password } = await req.json()
    if (!email || !full_name) {
      return NextResponse.json({ error: 'email y full_name son obligatorios' }, { status: 400 })
    }

    // 3. Use admin client (service role)
    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    let userId: string | undefined

    if (password) {
      // ── Mode A: Direct password creation ─────────────────────────────────
      // Creates the account immediately — no email confirmation needed.
      const { data: created, error: createErr } = await adminSupabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,   // mark email as confirmed so they can log in right away
        user_metadata: { full_name, role, permissions },
      })

      if (createErr) {
        if (createErr.message?.toLowerCase().includes('already')) {
          return NextResponse.json(
            { error: `El email ${email} ya tiene una cuenta en el sistema.` },
            { status: 409 }
          )
        }
        console.error('[invite-user] createUser error:', createErr)
        return NextResponse.json({ error: createErr.message }, { status: 500 })
      }
      userId = created?.user?.id
    } else {
      // ── Mode B: Email invitation ──────────────────────────────────────────
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
      const { data: inviteData, error: inviteErr } = await adminSupabase.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo: `${appUrl}/auth/set-password`,
          data: { full_name, role, permissions },
        }
      )
      if (inviteErr) {
        if (inviteErr.message?.toLowerCase().includes('already')) {
          return NextResponse.json(
            { error: `El email ${email} ya tiene una cuenta activa en el sistema.` },
            { status: 409 }
          )
        }
        console.error('[invite-user] inviteUserByEmail error:', inviteErr)
        return NextResponse.json({ error: inviteErr.message }, { status: 500 })
      }
      userId = inviteData?.user?.id
    }

    // 4. Pre-create the users_profile row so the user appears in the team table immediately
    if (userId) {
      await adminSupabase.from('users_profile').upsert({
        id: userId,
        email,
        full_name,
        nickname: nickname || null,
        role,
        permissions,
        active: !!password,   // active immediately if password was set; pending if invite sent
        created_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    }

    return NextResponse.json({ ok: true, userId })
  } catch (err: any) {
    console.error('[invite-user] unexpected error:', err)
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}

/**
 * DELETE /api/invite-user
 * Removes a user (admin only). Body: { userId }
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabaseUser = createServerSupabaseClient()
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: callerProfile } = await supabaseUser
      .from('users_profile').select('role').eq('id', user.id).single()
    if (callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores pueden eliminar usuarios' }, { status: 403 })
    }

    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId requerido' }, { status: 400 })
    if (userId === user.id) return NextResponse.json({ error: 'No puedes eliminarte a ti mismo' }, { status: 400 })

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY no configurada en Vercel → Settings → Environment Variables' },
        { status: 500 }
      )
    }

    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Always remove the profile row first (safe regardless of auth state)
    await adminSupabase.from('users_profile').delete().eq('id', userId)

    // Then delete from auth — may fail if user was never confirmed, that's OK
    const { error } = await adminSupabase.auth.admin.deleteUser(userId)
    if (error) {
      // If auth delete failed but profile is gone, return partial success
      console.warn('[invite-user] auth.admin.deleteUser failed (profile already removed):', error.message)
      if (error.message?.toLowerCase().includes('not found') || error.message?.toLowerCase().includes('loading')) {
        // User not in auth but profile removed — treat as success
        return NextResponse.json({ ok: true, warning: 'Perfil eliminado, usuario de auth no encontrado' })
      }
      return NextResponse.json({ error: `Error eliminando usuario: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}

/**
 * PATCH /api/invite-user
 * Sends a password reset email to a team member (admin only).
 * Body: { email }
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabaseUser = createServerSupabaseClient()
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: callerProfile } = await supabaseUser
      .from('users_profile').select('role').eq('id', user.id).single()
    if (callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores pueden restablecer contraseñas' }, { status: 403 })
    }

    const { email, userId, newPassword } = await req.json()

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY no configurada en Vercel → Settings → Environment Variables' },
        { status: 500 }
      )
    }

    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Option A: Admin sets a new password directly
    if (userId && newPassword) {
      const { error } = await adminSupabase.auth.admin.updateUserById(userId, { password: newPassword })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, mode: 'password_set' })
    }

    // Option B: Send password reset email
    if (email) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
      const { error } = await adminSupabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/auth/set-password`,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, mode: 'email_sent' })
    }

    return NextResponse.json({ error: 'Se requiere email o userId + newPassword' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}
