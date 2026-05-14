/**
 * GET /api/gana/debug
 *
 * Sonda con múltiples variantes para descubrir cómo trae tarifas Gana.
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const BASE_URL = process.env.GANA_BASE_URL ?? 'https://externos.ganaenergia.com'

export async function GET() {
  try {
    const ssb = createServerSupabaseClient()
    const { data: { user } } = await ssb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await ssb
      .from('users_profile').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admins' }, { status: 403 })
    }

    const username = process.env.GANA_USERNAME!
    const password = process.env.GANA_PASSWORD!

    // Login
    const loginRes = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const loginBody = await loginRes.json()
    const token = loginBody?.token

    if (!token) {
      return NextResponse.json({ step: 'login', loginBody }, { status: 502 })
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }

    // Sondas: GET / POST / con varios body / paths alternativos
    const probes: { name: string; method: 'GET' | 'POST'; path: string; body?: any }[] = [
      // Variantes del path
      { name: 'GET /tarifas',                        method: 'GET',  path: '/tarifas' },
      { name: 'POST /tarifas (empty)',               method: 'POST', path: '/tarifas', body: {} },
      { name: 'POST /tarifas (tipo electricidad)',   method: 'POST', path: '/tarifas', body: { tipo: 'electricidad' } },
      { name: 'POST /tarifas (tipo luz)',            method: 'POST', path: '/tarifas', body: { tipo: 'luz' } },
      { name: 'POST /tarifas (electricidad)',        method: 'POST', path: '/tarifas', body: { electricidad: true } },
      { name: 'POST /tarifas (2.0TD R1-001 28001)',  method: 'POST', path: '/tarifas',
        body: { tarifa_atr: '2.0TD', distribuidora: 'R1-001', codigo_postal: '28001', tipo: 'luz' } },
      { name: 'POST /tarifas (atr 2.0TD)',           method: 'POST', path: '/tarifas', body: { tarifa_atr: '2.0TD' } },
      { name: 'POST /tarifas (atr 20TD)',            method: 'POST', path: '/tarifas', body: { tarifa_atr: '20TD' } },
      // Paths alternativos
      { name: 'GET /tarifa',                         method: 'GET',  path: '/tarifa' },
      { name: 'GET /precios',                        method: 'GET',  path: '/precios' },
      { name: 'GET /productos',                      method: 'GET',  path: '/productos' },
      { name: 'GET /api/tarifas',                    method: 'GET',  path: '/api/tarifas' },
      { name: 'GET /listarTarifas',                  method: 'GET',  path: '/listarTarifas' },
      { name: 'GET /getTarifas',                     method: 'GET',  path: '/getTarifas' },
      // CNAE variantes
      { name: 'GET /cnae',                           method: 'GET',  path: '/cnae' },
      { name: 'GET /cnaes',                          method: 'GET',  path: '/cnaes' },
      { name: 'GET /listarCnae',                     method: 'GET',  path: '/listarCnae' },
    ]

    const results: any[] = []

    for (const p of probes) {
      try {
        const opts: RequestInit = { method: p.method, headers }
        if (p.body !== undefined) opts.body = JSON.stringify(p.body)
        const r = await fetch(`${BASE_URL}${p.path}`, opts)
        const text = await r.text()
        let body: any
        try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }

        // resumen
        let summary = ''
        if (Array.isArray(body)) summary = `array(${body.length})`
        else if (body?.tarifas) summary = `tarifas(${Array.isArray(body.tarifas) ? body.tarifas.length : '?'})`
        else if (body?.data) summary = `data(${Array.isArray(body.data) ? body.data.length : '?'})`
        else if (typeof body === 'object' && body) summary = `keys: ${Object.keys(body).slice(0, 4).join(',')}`
        else summary = String(body).slice(0, 60)

        results.push({
          probe: p.name,
          status: r.status,
          summary,
          sample: typeof body === 'object' ? JSON.stringify(body).slice(0, 250) : String(body).slice(0, 150),
        })
      } catch (e: any) {
        results.push({ probe: p.name, error: e?.message })
      }
    }

    return NextResponse.json({
      username,
      tokenPrefix: String(token).slice(0, 30) + '...',
      results,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message, stack: e?.stack }, { status: 500 })
  }
}
