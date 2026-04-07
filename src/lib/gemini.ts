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
  'gemini-2.5-flash',           // confirmed working for new API keys
  'gemini-flash-latest',         // alias - fallback
  'gemini-3-flash-preview',      // next gen when available
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash-lite',
  'gemini-pro-latest',
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

const INVOICE_PROMPT = `Eres un extractor experto de facturas de energía eléctrica y gas natural en España.
Tu tarea es extraer TODOS los datos disponibles del documento con la máxima precisión.
Responde ÚNICAMENTE con JSON válido. Sin markdown, sin texto adicional, sin comentarios.

════════════════════════════════════
SI ES UNA FACTURA DE ENERGÍA (luz o gas):
════════════════════════════════════

{
  "documentType": "factura",
  "extracted": {
    "cups": "ES0000000000000000XX",
    "supply_type": "luz",
    "holder_name": "NOMBRE COMPLETO DEL TITULAR TAL COMO APARECE EN LA FACTURA",
    "holder_cif_nif": "B12345678",
    "total_amount": 123.45,
    "tariff": "2.0TD",
    "comercializadora": "Nombre de la comercializadora emisora",
    "supply_address": "Dirección completa del punto de suministro",
    "billing_period": "01/01/2024 - 31/01/2024",
    "economics": {
      "fechaInicio": "01/01/2024",
      "fechaFin": "31/01/2024",
      "totalFactura": 123.45,
      "baseImponible": 102.06,
      "iva": 21.43,
      "ivaPct": 21,
      "impuestoElectrico": 3.15,
      "impuestoElectricoPct": 5.11269,
      "consumoTotalKwh": 456.78,
      "consumo": [
        {
          "periodo": "P1",
          "concepto": "Energía activa P1",
          "cantidad": 100.00,
          "unidad": "kWh",
          "precio": 0.150000,
          "importe": 15.00
        },
        {
          "periodo": "P2",
          "concepto": "Energía activa P2",
          "cantidad": 200.00,
          "unidad": "kWh",
          "precio": 0.080000,
          "importe": 16.00
        }
      ],
      "potencia": [
        {
          "periodo": "P1",
          "concepto": "Término de potencia P1",
          "cantidad": 4.40,
          "unidad": "kW",
          "dias": 31,
          "precio": 38.043426,
          "importe": 14.48
        }
      ],
      "otrosConceptos": [
        {
          "concepto": "Alquiler de equipos de medida",
          "importe": 1.22
        },
        {
          "concepto": "Impuesto sobre electricidad (5.11269%)",
          "importe": 3.15
        },
        {
          "concepto": "Descuento comercial",
          "importe": -5.00
        }
      ],
      "descuentos": [
        {
          "concepto": "Descuento por permanencia",
          "importe": -2.50
        }
      ]
    }
  }
}

INSTRUCCIONES CRÍTICAS para la extracción:
1. holder_name: copia el nombre EXACTAMENTE como aparece en la factura (ej: "AYUNTAMIENTO DE AOIZ", no "Ayuntamiento")
2. cups: siempre empieza por "ES", incluye todos los caracteres
3. supply_type: exactamente "luz" o "gas" (nunca "electricidad" ni "eléctrico")
4. consumo: extrae CADA línea de energía activa/reactiva por periodo (P1, P2, P3...)
5. potencia: extrae CADA término de potencia por periodo (P1, P2...)
6. otrosConceptos: incluye impuestos, alquileres de equipos, descuentos, recargos, etc.
7. Todos los importes deben ser números decimales (no strings)
8. Si un periodo no aparece en la factura, no lo incluyas en el array
9. Para facturas de GAS: consumoTotalKwh puede ser en m³ o kWh según la factura

════════════════════════════════════
SI NO ES UNA FACTURA DE ENERGÍA:
════════════════════════════════════

{
  "documentType": "cif",
  "extracted": { "holder_name": "...", "cif": "B12345678", "fiscal_address": "..." }
}

Tipos válidos: "cif", "nif", "iban", "contrato", "otro"
Para IBAN: { "iban": "ES76...", "bank_name": "...", "account_holder": "..." }`

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
