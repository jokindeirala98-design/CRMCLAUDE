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

  const [rawRes, consumoRes, infoRes] = await Promise.all([
    fetch(`${BASE}/api/sips/info/raw?cups=${encodeURIComponent(cups)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    }),
    fetch(`${BASE}/api/sips/info/consumo?cups=${encodeURIComponent(cups)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    }),
    fetch(`${BASE}/api/sips/info?cups=${encodeURIComponent(cups)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    }),
  ])

  const raw = rawRes.ok ? await rawRes.json() : { error: rawRes.status }
  const consumo = consumoRes.ok ? await consumoRes.json() : { error: consumoRes.status }
  const info = infoRes.ok ? await infoRes.json() : { error: infoRes.status }

  // Extract top-level keys from raw client data
  const rawClient = raw?.ClientesSips?.[0] || raw?.clientesSips?.[0] || null
  const rawKeys = rawClient ? Object.keys(rawClient) : []

  // Look for arrays in raw that might contain maximeter/reactiva data
  const arrayFields: Record<string, any> = {}
  if (rawClient) {
    for (const key of rawKeys) {
      if (Array.isArray(rawClient[key]) && rawClient[key].length > 0) {
        arrayFields[key] = {
          length: rawClient[key].length,
          sampleKeys: Object.keys(rawClient[key][0] || {}),
          sample: rawClient[key].slice(0, 2),
        }
      }
    }
  }

  // Also check top-level arrays in raw response
  const topLevelArrays: Record<string, any> = {}
  for (const key of Object.keys(raw || {})) {
    if (Array.isArray(raw[key]) && raw[key].length > 0) {
      topLevelArrays[key] = {
        length: raw[key].length,
        sampleKeys: Object.keys(raw[key][0] || {}),
        sample: raw[key].slice(0, 2),
      }
    }
  }

  // Check consumo entries for extra fields beyond P1-P6
  const consumoSample = Array.isArray(consumo) ? consumo.slice(0, 2) : consumo
  const consumoKeys = Array.isArray(consumo) && consumo.length > 0 ? Object.keys(consumo[0]) : []

  return NextResponse.json({
    rawKeys,
    rawArrayFields: arrayFields,
    rawTopLevelArrays: topLevelArrays,
    rawNonArrayFields: rawClient ? Object.fromEntries(
      Object.entries(rawClient).filter(([k, v]) => !Array.isArray(v) && typeof v !== 'object')
    ) : null,
    consumoEntryCount: Array.isArray(consumo) ? consumo.length : 'not array',
    consumoKeys,
    consumoSample,
    infoKeys: Object.keys(info || {}),
    infoData: info,
  })
}
