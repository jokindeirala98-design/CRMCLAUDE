/**
 * Cliente Gemini para el agente comercial.
 *
 * Soporta:
 *  - Generación de texto con system prompt + historial
 *  - Tool calling estructurado (function calling)
 *  - Multimodal (audio/imagen)
 *  - Estimación de coste por mensaje
 *
 * Modelo por defecto: gemini-2.5-flash (free tier generoso).
 * Precios 2026 (Gemini 2.5 Flash):
 *   input:  $0.075 / 1M tokens
 *   output: $0.30  / 1M tokens
 */

const DEFAULT_MODEL = 'gemini-2.5-flash'
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  return key
}

// ───────────────────────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────────────────────

export interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args: Record<string, any> }
  functionResponse?: { name: string; response: any }
}

export interface GeminiMessage {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export interface GeminiCallOpts {
  model?: string
  systemInstruction?: string
  contents: GeminiMessage[]
  tools?: ToolDefinition[]
  toolChoice?: 'AUTO' | 'ANY' | 'NONE'
  temperature?: number
  maxOutputTokens?: number
}

export interface GeminiCallResult {
  text: string
  toolCalls: Array<{ name: string; args: Record<string, any> }>
  finishReason: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  costUsd: number
  modelUsed: string
  latencyMs: number
  raw: any
}

// ───────────────────────────────────────────────────────────────────────────
// CORE CALL
// ───────────────────────────────────────────────────────────────────────────

export async function geminiCall(opts: GeminiCallOpts): Promise<GeminiCallResult> {
  const model = opts.model || DEFAULT_MODEL
  const url = `${API_BASE}/models/${model}:generateContent?key=${getApiKey()}`

  const body: any = {
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    },
  }

  if (opts.systemInstruction) {
    body.systemInstruction = { role: 'system', parts: [{ text: opts.systemInstruction }] }
  }

  if (opts.tools && opts.tools.length > 0) {
    body.tools = [{ functionDeclarations: opts.tools }]
    body.toolConfig = {
      functionCallingConfig: { mode: opts.toolChoice || 'AUTO' },
    }
  }

  const t0 = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const latencyMs = Date.now() - t0

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`geminiCall ${model} ${res.status}: ${err.slice(0, 500)}`)
  }

  const data = await res.json()
  const candidate = data?.candidates?.[0]
  const parts: GeminiPart[] = candidate?.content?.parts || []

  const text = parts.map(p => p.text || '').filter(Boolean).join('').trim()
  const toolCalls = parts
    .filter(p => p.functionCall)
    .map(p => ({ name: p.functionCall!.name, args: p.functionCall!.args || {} }))

  const usage = data?.usageMetadata || {}
  const promptTokens = Number(usage.promptTokenCount) || 0
  const completionTokens = Number(usage.candidatesTokenCount) || 0
  const totalTokens = Number(usage.totalTokenCount) || promptTokens + completionTokens

  // Gemini 2.5 Flash pricing (2026)
  const costUsd =
    (promptTokens / 1_000_000) * 0.075 +
    (completionTokens / 1_000_000) * 0.30

  return {
    text,
    toolCalls,
    finishReason: candidate?.finishReason || 'STOP',
    usage: { promptTokens, completionTokens, totalTokens },
    costUsd,
    modelUsed: model,
    latencyMs,
    raw: data,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS — multimodal
// ───────────────────────────────────────────────────────────────────────────

/**
 * Transcribe audio (mp3, ogg, wav, m4a) con Gemini multimodal.
 * Usado para notas de voz de Telegram.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/ogg',
): Promise<string> {
  const result = await geminiCall({
    temperature: 0.0,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: audioBuffer.toString('base64') } },
        { text: 'Transcribe esta nota de voz al texto en español de España. Devuelve solo la transcripción literal, sin anotaciones, sin emojis, sin "[música]" ni "[silencio]".' },
      ],
    }],
    maxOutputTokens: 8000,
  })
  return result.text
}
