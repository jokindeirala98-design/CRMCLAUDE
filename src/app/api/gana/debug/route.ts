/**
 * GET /api/gana/debug
 *
 * Devuelve la respuesta CRUDA de los endpoints de Gana para diagnosticar
 * el formato real. Solo admins.
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const BASE_URL = process.env.GANA_BASE_URL ?? 'https://externos.ganaenergia.com'

export async function GET() {
  try {
    const ssb = createServerSupabaseClient()
    const { data: { user } } = await ssb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await ssb
      .from('users_profile')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admins' }, { status: 403 })
    }

    // Login fresco
    const username = process.env.GANA_USERNAME
    const password = process.env.GANA_PASSWORD
    if (!username || !password) {
      return NextResponse.json({ error: 'Faltan env vars' }, { status: 500 })
    }

    const loginRes = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const loginText = await loginRes.text()
    let loginBody: any
    try { loginBody = JSON.parse(loginText) } catch { loginBody = loginText }

    if (!loginRes.ok) {
      return NextResponse.json({
        step: 'login',
        status: loginRes.status,
        body: loginBody,
      }, { status: 502 })
    }

    const token =
      loginBody?.token ?? loginBody?.access_token ??
      loginBody?.data?.token ?? loginBody?.data?.access_token

    // Probar varios endpoints y devolver TODO crudo
    const endpoints = ['/tarifas', '/distribuidoras', '/cnae']
    const results: Record<string, any> = {}

    for (const ep of endpoints) {
      try {
        const r = await fetch(`${BASE_URL}${ep}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
        })
        const text = await r.text()
        let body: any
        try { body = JSON.parse(text) } catch { body = text.slice(0, 500) }
        results[ep] = {
          status: r.status,
          contentType: r.headers.get('content-type'),
          isArray: Array.isArray(body),
          keys: body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null,
          firstItem: Array.isArray(body) ? body[0]
            : Array.isArray(body?.data) ? body.data[0]
            : Array.isArray(body?.tarifas) ? body.tarifas[0]
            : null,
          bodySample: typeof body === 'string' ? body : JSON.stringify(body).slice(0, 1500),
        }
      } catch (e: any) {
        results[ep] = { error: e?.message }
      }
    }

    return NextResponse.json({
      baseUrl: BASE_URL,
      username,
      loginStatus: loginRes.status,
      tokenReceived: !!token,
      tokenPrefix: token ? String(token).slice(0, 30) + '...' : null,
      loginBodyKeys: loginBody && typeof loginBody === 'object' ? Object.keys(loginBody) : null,
      endpoints: results,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message, stack: e?.stack }, { status: 500 })
  }
}
