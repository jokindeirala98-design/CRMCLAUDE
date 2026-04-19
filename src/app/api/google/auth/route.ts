import { NextResponse } from 'next/server'

/**
 * GET /api/google/auth
 * Redirects the user to Google OAuth consent screen.
 * Call from the Settings page "Conectar Google Calendar" button.
 */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID no configurado' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
  const redirectUri = `${appUrl}/api/google/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent', // force refresh_token every time
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  )
}
