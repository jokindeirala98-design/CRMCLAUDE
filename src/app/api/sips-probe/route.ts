import { NextRequest, NextResponse } from 'next/server'

const GREENING_API_BASE = 'https://api.greeningenergy.com'

async function getToken() {
  const res = await fetch(`${GREENING_API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: process.env.GREENING_EMAIL, password: process.env.GREENING_PASSWORD }),
  })
  const data = await res.json()
  return data.Token
}

// Try many possible endpoint paths and return status + sample data for each
export async function POST(req: NextRequest) {
  const { cups } = await req.json()
  const token = await getToken()

  const pathsToTry = [
    '/api/sips/info/maximetro',
    '/api/sips/info/Maximetro',
    '/api/sips/info/maxímetro',
    '/api/sips/info/reactiva',
    '/api/sips/info/Reactiva',
    '/api/sips/info/reactive',
    '/api/sips/info/potencia',
    '/api/sips/info/potencias',
    '/api/sips/info/demanda',
    '/api/sips/info/maxdemanda',
    '/api/sips/maximetro',
    '/api/sips/reactiva',
    '/api/sips/info/history',
    '/api/sips/info/lecturas',
    '/api/sips/lecturas',
    '/api/sips/info/consumo/maximetro',
    '/api/sips/info/consumo/reactiva',
    '/api/sips/raw',
    '/api/sips/info/raw/maximetro',
  ]

  const results: Record<string, any> = {}

  await Promise.all(pathsToTry.map(async (path) => {
    try {
      const r = await fetch(`${GREENING_API_BASE}${path}?cups=${encodeURIComponent(cups)}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      })
      let body: any = null
      try {
        const text = await r.text()
        body = text.length < 500 ? text : text.slice(0, 500) + '...'
        try { body = JSON.parse(text.length < 2000 ? text : '{"truncated":true,"sample":' + text.slice(0, 300) + '}') } catch {}
      } catch {}
      results[path] = { status: r.status, body }
    } catch (e: any) {
      results[path] = { status: 'error', error: e.message }
    }
  }))

  return NextResponse.json(results)
}
