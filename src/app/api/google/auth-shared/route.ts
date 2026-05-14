import { NextResponse } from 'next/server'

/**
 * GET /api/google/auth-shared
 * Inicia el OAuth para conectar el CALENDARIO COMPARTIDO "Voltis CRM".
 * Solo debe llamarlo el admin desde Configuración.
 * Usa state=shared para que el callback sepa dónde guardar el token.
 */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID no configurado' }, { status: 500 })
  }

  const appUrl     = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
  const redirectUri = `${appUrl}/api/google/callback`

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.events',
    access_type:   'offline',
    prompt:        'consent',
    state:         'shared', // flag para el callback
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  )
}
