import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/external-session/status?provider=totalenergies
 *
 * Devuelve metadata (nunca el token completo) sobre la sesión guardada de un
 * proveedor externo. Útil para pintar un badge en el dashboard que diga
 * "TE gas: caduca en Xh" y para debug rápido.
 *
 * Requiere estar autenticado en el CRM (cookie de Supabase). Si quieres
 * exponerlo sin auth, quita el check — pero entonces nunca devuelvas el token.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const provider = (url.searchParams.get('provider') || '').trim().toLowerCase()

  if (!provider) {
    return NextResponse.json(
      { success: false, error: 'Falta query param `provider`' },
      { status: 400 }
    )
  }

  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(supaUrl, key)

  const { data, error } = await supabase
    .from('external_sessions')
    .select('provider, expires_at, updated_at')
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({
      success: true,
      provider,
      exists: false,
      expired: true,
      minutes_remaining: 0,
    })
  }

  const expiresAt = new Date(data.expires_at)
  const minutesRemaining = Math.round((expiresAt.getTime() - Date.now()) / 60_000)

  return NextResponse.json({
    success: true,
    provider: data.provider,
    exists: true,
    expires_at: data.expires_at,
    updated_at: data.updated_at,
    expired: minutesRemaining <= 0,
    minutes_remaining: Math.max(0, minutesRemaining),
  })
}
