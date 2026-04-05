import { NextResponse } from 'next/server'

const MODELS = [
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-pro-preview-03-25',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-8b',
]

async function testModel(model: string, apiKey: string): Promise<{ model: string; ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say "ok" in JSON: {"status":"ok"}' }] }],
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

  const results = await Promise.all(MODELS.map((m) => testModel(m, apiKey)))
  const working = results.filter((r) => r.ok).map((r) => r.model)

  return NextResponse.json({ working, all: results })
}
