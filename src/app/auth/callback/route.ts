import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

const ALLOWED_DOMAIN = 'voltisenergia.com'

function generateInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  // OAuth error from Google (user cancelled, etc.)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=oauth_cancelled`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  // Build the response early so we can attach cookies
  const redirectOk  = NextResponse.redirect(`${origin}/panel`)
  const redirectErr = (e: string) => NextResponse.redirect(`${origin}/login?error=${e}`)

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

  // ── 1. Exchange code for session ───────────────────────────────────────────
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options?: any }[]) =>
        cookiesToSet.forEach(({ name, value, options }) =>
          redirectOk.cookies.set(name, value, options)
        ),
    },
  })

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.user) {
    console.error('[auth/callback] exchange error:', exchangeError)
    return redirectErr('auth_failed')
  }

  const user  = data.user
  const email = user.email ?? ''

  // ── 2. Domain restriction — only @voltisenergia.com ───────────────────────
  if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    await supabase.auth.signOut()
    return redirectErr('domain_not_allowed')
  }

  // ── 3. Auto-create users_profile if this is a first login ─────────────────
  // Use service-role client to bypass RLS
  const admin = createAdminClient(supabaseUrl, serviceRoleKey)

  const { data: existing } = await admin
    .from('users_profile')
    .select('id, initials')
    .eq('id', user.id)
    .maybeSingle()

  if (!existing) {
    // New user — build profile from Google metadata
    const meta      = user.user_metadata ?? {}
    const fullName  = (meta.full_name ?? meta.name ?? email.split('@')[0]) as string
    const avatarUrl = (meta.avatar_url ?? meta.picture ?? null) as string | null
    const initials  = generateInitials(fullName)
    const googleId  = (meta.sub ?? meta.provider_id ?? null) as string | null

    const { error: insertErr } = await admin.from('users_profile').insert({
      id:          user.id,
      full_name:   fullName,
      email,
      avatar_url:  avatarUrl,
      initials,
      google_id:   googleId,
      role:        'commercial', // default — admin upgrades if needed
    })

    if (insertErr) {
      console.error('[auth/callback] profile insert error:', insertErr)
      // Don't block login — profile can be created later
    }
  } else if (!existing.initials) {
    // Existing user without initials — back-fill
    const fullName = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? email.split('@')[0]) as string
    await admin
      .from('users_profile')
      .update({ initials: generateInitials(fullName) })
      .eq('id', user.id)
  }

  return redirectOk
}
