/**
 * Shared Gemini AI analysis library for VOLTIS CRM
 * v6.0 - Model auto-discovery fallback chain, robust invoice extraction
 */

import { normalizeCups } from '@/lib/utils/cups'

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TYPES                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

export type DocumentType = 'factura' | 'cif' | 'nif' | 'iban' | 'contrato' | 'otro'

export interface ExtractedDocumentData {
  mode: 'gemini' | 'manual'
  documentType: DocumentType
  cif?: string
  nif?: string
  holder_name?: string
  holder_cif_nif?: string
  fiscal_address?: string
  iban?: string
  bank_name?: string
  account_holder?: string
  raw_text?: string
  error?: string
  // Invoice specific
  cups?: string
  supply_type?: 'luz' | 'gas' | 'telefonia'
  total_amount?: string
  tariff?: string
  comercializadora?: string
  supply_address?: string
  billing_period?: string
  economics?: any
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  JSON PARSER                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function safeParseGeminiJSON(raw: string): any {
  let str = raw.trim()
  str = str.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const jsonStart = str.indexOf('{')
  const jsonEnd = str.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd <= jsonStart) return {}
  str = str.substring(jsonStart, jsonEnd + 1)
  try { return JSON.parse(str) } catch {
    const res: any = {}
    const kvRegex = /"(\w+)":\s*"([^"]*)"/g
    let m
    while ((m = kvRegex.exec(str)) !== null) {
      res[m[1]] = m[2]
    }
    return res
  }
}

const clean = (v: any) => (v && v !== 'null' && v !== 'N/A' && v !== 'undefined') ? String(v).trim() : undefined

function getApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || null
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MODEL FALLBACK CHAIN                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Models tried in priority order — the first one that returns a successful
 * response is cached for the process lifetime to avoid repeated probing.
 */
const CANDIDATE_MODELS = [
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-pro-preview-03-25',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro-002',
]

let _cachedModel: string | null = null

async function getWorkingModel(apiKey: string): Promise<string> {
  if (_cachedModel) return _cachedModel

  for (const model of CANDIDATE_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply with exactly: {"ok":true}' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 10 },
          }),
          signal: AbortSignal.timeout(5000),
        }
      )
      if (res.ok) {
        const d = await res.json()
        if (d.candidates?.[0]?.content?.parts?.[0]?.text) {
          console.log(`[Gemini] Using model: ${model}`)
          _cachedModel = model
          return model
        }
      }
    } catch {
      // try next
    }
  }

  throw new Error('No Gemini model available. Check API key and quota.')
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  API CALLER                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

async function callGemini(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada')

  const model = await getWorkingModel(apiKey)

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    }
  )

  const data = await response.json()
  if (!response.ok) {
    // If this model stopped working, clear cache and throw so retry can pick next
    if (data.error?.message?.includes('no longer available') || data.error?.message?.includes('deprecated')) {
      _cachedModel = null
    }
    throw new Error(data.error?.message || `Gemini Error: ${response.status}`)
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!content) {
    // Check for safety/finish reason
    const reason = data.candidates?.[0]?.finishReason
    if (reason && reason !== 'STOP') throw new Error(`Gemini stopped: ${reason}`)
    throw new Error('No content in Gemini response')
  }
  return content
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PROMPTS                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

const INVOICE_PROMPT = `Eres un extractor experto de facturas de energía españolas (luz y gas).
Analiza este documento y extrae TODOS los datos disponibles.
Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional.

Si es una factura de energía, devuelve:
{
  "documentType": "factura",
  "extracted": {
    "cups": "ES1234...",
    "supply_type": "luz",
    "holder_name": "Nombre completo del titular",
    "holder_cif_nif": "CIF o NIF del titular (ej: B12345678 o 12345678A)",
    "total_amount": 123.45,
    "tariff": "2.0TD",
    "comercializadora": "Nombre de la comercializadora",
    "supply_address": "Dirección completa del suministro",
    "billing_period": "01/01/2024 - 31/01/2024",
    "economics": {
      "fechaInicio": "01/01/2024",
      "fechaFin": "31/01/2024",
      "totalFactura": 123.45,
      "consumoTotalKwh": 456.78,
      "consumo": [{"concepto": "Energía activa P1", "cantidad": 100, "precio": 0.15, "importe": 15.00}],
      "potencia": [{"concepto": "Potencia P1", "cantidad": 4.4, "precio": 38.04, "importe": 5.21}],
      "otrosConceptos": [{"concepto": "Impuesto eléctrico", "importe": 1.23}]
    }
  }
}

Si NO es una factura de energía (es CIF, NIF, IBAN, contrato u otro documento), devuelve:
{
  "documentType": "cif" | "nif" | "iban" | "contrato" | "otro",
  "extracted": {
    "holder_name": "...",
    "cif": "...",
    "nif": "...",
    "iban": "...",
    "fiscal_address": "..."
  }
}

IMPORTANTE:
- supply_type debe ser exactamente "luz" o "gas"
- cups empieza siempre por "ES"
- Si un campo no está presente, omítelo (no pongas null ni "N/A")
- totalFactura debe ser número decimal, no string`

const MASTER_PROMPT = `Analiza este documento y responde SOLO con JSON (sin markdown, sin texto adicional).
1. Identifica "documentType": "factura", "cif", "nif", "iban", "contrato", o "otro".
2. Extrae TODOS los campos disponibles según el tipo:
   - "factura" (luz/gas): cups (código ES...), supply_type ("luz" o "gas"), holder_name, holder_cif_nif, total_amount (número), tariff, comercializadora, supply_address, billing_period ("DD/MM/YYYY - DD/MM/YYYY"), economics: { fechaInicio, fechaFin, totalFactura, consumoTotalKwh, consumo, potencia, otrosConceptos }
   - "cif"/"nif": cif o nif, holder_name, fiscal_address.
   - "iban": iban, bank_name, account_holder.
   - "contrato": cups, holder_name, comercializadora.

JSON: {"documentType": "...", "extracted": { ... }}`

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ANALYSIS                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

export async function analyzeDocument(base64Data: string, mimeType: string, docType?: DocumentType): Promise<ExtractedDocumentData> {
  const apiKey = getApiKey()
  if (!apiKey) return { mode: 'manual', documentType: 'otro', error: 'GEMINI_API_KEY no configurada en el servidor' }

  try {
    const prompt = docType === 'factura' ? INVOICE_PROMPT : INVOICE_PROMPT // Always use invoice prompt - it handles all doc types
    const content = await callGemini(prompt, base64Data, mimeType)
    const result = safeParseGeminiJSON(content)

    const detectedType: DocumentType = result.documentType || docType || 'otro'
    const extracted = result.extracted || result

    return {
      mode: 'gemini',
      documentType: detectedType,
      cups: normalizeCups(extracted.cups || '') || undefined,
      supply_type: (['luz', 'gas', 'telefonia'].includes(extracted.supply_type) ? extracted.supply_type : undefined) as 'luz' | 'gas' | 'telefonia' | undefined,
      cif: clean(extracted.cif) || (detectedType !== 'factura' ? clean(extracted.holder_cif_nif) : undefined),
      nif: clean(extracted.nif) || (detectedType !== 'factura' ? clean(extracted.holder_cif_nif) : undefined),
      holder_name: clean(extracted.holder_name) || clean(extracted.account_holder),
      holder_cif_nif: clean(extracted.holder_cif_nif),
      total_amount: extracted.total_amount != null ? String(extracted.total_amount) : '',
      tariff: clean(extracted.tariff),
      comercializadora: clean(extracted.comercializadora),
      supply_address: clean(extracted.supply_address),
      billing_period: clean(extracted.billing_period),
      economics: extracted.economics || null,
      iban: clean(extracted.iban),
      bank_name: clean(extracted.bank_name),
      account_holder: clean(extracted.account_holder),
      fiscal_address: clean(extracted.fiscal_address),
    }
  } catch (error: any) {
    console.error('[Gemini] Analysis failed:', error.message)
    return { mode: 'manual', documentType: docType || 'otro', error: error.message }
  }
}

export function getMimeType(fileName: string, fileType?: string): string {
  const name = (fileName || '').toLowerCase()
  if (fileType === 'pdf' || name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}
