import { NextResponse } from 'next/server'

async function listAvailableModels(apiKey: string): Promise<string[]> {
  const names: string[] = []
  for (const apiVer of ['v1beta', 'v1']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${apiVer}/models?key=${apiKey}&pageSize=100`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (!res.ok) continue
      const data = await res.json()
      const models = (data.models || []).map((m: any) => m.name?.replace('models/', ''))
      if (models.length > 0) {
        return models
      }
    } catch { /* try next */ }
  }
  return names
}

async function testModel(model: string, apiKey: string, apiVer = 'v1beta'): Promise<{ model: string; ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: {"ok":true}' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20 },
        }),
        signal: AbortSignal.timeout(8000),
      }
    )
    const data = await res.json()
    if (!res.ok) return { model, ok: false, error: data.error?.message || `HTTP ${res.status}` }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return { model, ok: !!text, error: text ? undefined : 'Empty response' }
  } catch (e: any) {
    return { model, ok: false, error: e.message }
  }
}

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key configured' }, { status: 500 })

  // 1. List all models available for this key
  const availableModels = await listAvailableModels(apiKey)

  // 2. Test multimodal candidates (need vision for invoice PDFs)
  const CANDIDATES = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-preview-04-17',
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-pro-preview-05-06',
    'gemini-2.5-pro-preview-06-05',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
  ]

  // Also test v1 variants
  const V1_CANDIDATES = ['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash', 'gemini-1.5-pro']

  const [v1betaResults, v1Results] = await Promise.all([
    Promise.all(CANDIDATES.map((m) => testModel(m, apiKey, 'v1beta'))),
    Promise.all(V1_CANDIDATES.map((m) => testModel(m, apiKey, 'v1'))),
  ])

  const working = [
    ...v1betaResults.filter((r) => r.ok).map((r) => `v1beta/${r.model}`),
    ...v1Results.filter((r) => r.ok).map((r) => `v1/${r.model}`),
  ]

  return NextResponse.json({
    apiKeyPresent: true,
    apiKeyPrefix: apiKey.substring(0, 8) + '...',
    availableModels: availableModels.slice(0, 30),
    working,
    v1betaTests: v1betaResults,
    v1Tests: v1Results,
  })
}
