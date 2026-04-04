import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://api.greeningenergy.com'

async function getToken() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.GREENING_EMAIL, password: process.env.GREENING_PASSWORD }),
  })
  const data = await res.json()
  return data.Token
}

export async function POST(req: NextRequest) {
  const { cups } = await req.json()
  const token = await getToken()

  const rawRes = await fetch(`${BASE}/api/sips/info/raw?cups=${encodeURIComponent(cups)}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })

  const raw = rawRes.ok ? await rawRes.json() : { error: rawRes.status }

  const consumosSips = raw?.ConsumosSips || []

  return NextResponse.json({
    consumosSipsCount: consumosSips.length,
    consumosSipsKeys: consumosSips.length > 0 ? Object.keys(consumosSips[0]) : [],
    consumosSipsSample: consumosSips.slice(0, 3),
    allTopLevelKeys: Object.keys(raw || {}),
    // Also check if top-level has Maximetros key
    hasMaximetros: 'Maximetros' in (raw || {}) || 'MaximetrosSips' in (raw || {}) || 'maximetros' in (raw || {}),
  })
}
