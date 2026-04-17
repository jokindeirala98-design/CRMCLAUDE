import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/external-session/upsert
 *
 * Lo invoca el bookmarklet desde el navegador del usuario después de hacer
 * login manual en el portal externo (TotalEnergies, ADX, …). Guarda el token
 * + expiry en Supabase (tabla external_sessions) para que el backend del CRM
 * lo use sin tener que actualizar env vars y redeploy.
 *
 * Auth: header `X-Session-Key` debe coincidir con EXTERNAL_SESSION_SECRET.
 *
 * Body:
 *   {
 *     provider: "totalenergies" | "adx" | ...,
 *     token: string,
 *     expires_at: string (ISO 8601) | number (unix seconds/ms),
 *     raw?: any   // opcional, para debug
 *   }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.EXTERNAL_SESSION_SECRET
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'EXTERNAL_SESSION_SECRET no configurado en el servidor' },
      { status: 500 }
    )
  }

  const provided = req.headers.get('x-session-key')
  if (provided !== secret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  const provider = typeof body?.provider === 'string' ? body.provider.trim().toLowerCase() : ''
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const rawExpires = body?.expires_at

  if (!provider || !token) {
    return NextResponse.json(
      { success: false, error: '`provider` y `token` son obligatorios' },
      { status: 400 }
    )
  }

  // Normaliza expires_at → ISO 8601
  let expiresAt: Date | null = null
  if (typeof rawExpires === 'number') {
    // Unix seconds si < 1e12, ms si >=
    expiresAt = new Date(rawExpires < 1e12 ? rawExpires * 1000 : rawExpires)
  } else if (typeof rawExpires === 'string' && rawExpires) {
    const d = new Date(rawExpires)
    if (!isNaN(d.getTime())) expiresAt = d
  }

  // Si no vino expires_at, asumimos 5h (fallback conservador típico de Gigya TE)
  if (!expiresAt || isNaN(expiresAt.getTime())) {
    expiresAt = new Date(Date.now() + 5 * 60 * 60 * 1000)
  }

  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    return NextResponse.json(
      { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY no configurado' },
      { status: 500 }
    )
  }
  const supabase = createClient(url, key)

  const { error } = await supabase
    .from('external_sessions')
    .upsert(
      {
        provider,
        token,
        expires_at: expiresAt.toISOString(),
        raw: body?.raw ?? null,
      },
      { onConflict: 'provider' }
    )

  if (error) {
    console.error('[external-session/upsert] Supabase error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      success: true,
      provider,
      expires_at: expiresAt.toISOString(),
      minutes_remaining: Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60_000)),
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Session-Key',
      },
    }
  )
}

// CORS preflight — permitimos que el bookmarklet llame desde cualquier origen
// (el secret en el header es la protección real).
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Session-Key',
      'Access-Control-Max-Age': '86400',
    },
  })
}
