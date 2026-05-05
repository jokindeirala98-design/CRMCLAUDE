import { NextResponse } from 'next/server'

const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
]

/**
 * GET /api/gemini/status
 * Tests the Gemini API key and returns which model is active.
 * Admin-only diagnostic endpoint.
 */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: 'GEMINI_API_KEY no configurada en Vercel → Settings → Environment Variables',
    })
  }

  for (const model of CANDIDATE_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply with exactly: ok' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 5 },
          }),
          signal: AbortSignal.timeout(8000),
        }
      )

      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({
          ok: false,
          status: res.status,
          error: 'Clave inválida o caducada. Ve a aistudio.google.com → API Keys, genera una nueva y actualízala en Vercel.',
        })
      }

      if (res.status === 429) {
        return NextResponse.json({
          ok: false,
          status: 429,
          error: 'Cuota agotada (demasiadas peticiones). Espera unos minutos o revisa tu plan en aistudio.google.com.',
        })
      }

      if (res.ok) {
        const data = await res.json()
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          return NextResponse.json({ ok: true, model, keyPrefix: apiKey.slice(0, 8) + '…' })
        }
      }
    } catch {
      // Try next model
    }
  }

  return NextResponse.json({
    ok: false,
    error: 'Todos los modelos de Gemini están sobrecargados. Inténtalo en unos minutos.',
  })
}
