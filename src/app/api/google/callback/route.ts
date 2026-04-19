import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * GET /api/google/callback
 * Handles the OAuth 2.0 redirect from Google.
 * Exchanges the code for tokens and stores the refresh_token in users_profile.
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
  const settingsUrl = `${appUrl}/configuracion`
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error || !code) {
    console.error('[gcal callback] error or missing code:', error)
    return NextResponse.redirect(`${settingsUrl}?gcal=error`)
  }

  // Exchange authorization code for tokens
  const redirectUri = `${appUrl}/api/google/callback`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenRes.json()

  if (!tokens.refresh_token) {
    console.error('[gcal callback] no refresh_token in response', tokens)
    return NextResponse.redirect(`${settingsUrl}?gcal=error&reason=no_refresh_token`)
  }

  // Get current logged-in user
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`)
  }

  // Persist tokens in users_profile
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { error: dbError } = await admin
    .from('users_profile')
    .update({
      google_refresh_token: tokens.refresh_token,
      google_calendar_id: 'primary',
    })
    .eq('id', user.id)

  if (dbError) {
    console.error('[gcal callback] db update error', dbError)
    return NextResponse.redirect(`${settingsUrl}?gcal=error&reason=db`)
  }

  return NextResponse.redirect(`${settingsUrl}?gcal=connected`)
}
