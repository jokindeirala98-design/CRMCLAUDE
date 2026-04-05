/**
 * Shared Gemini AI analysis library for VOLTIS CRM
 * Unified Analysis (v5.0) - Combines classification and extraction for speed.
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
  fiscal_address?: string
  iban?: string
  bank_name?: string
  account_holder?: string
  raw_text?: string
  error?: string
  // Invoice specific
  cups?: string
  total_amount?: string
  tariff?: string
  comercializadora?: string
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
  try { return JSON.parse(str) } catch (e) {
    // Basic regex fallback for key-value pairs
    const res: any = {}
    const kvRegex = /"(\w+)":\s*"([^"]*)"/g
    let m
    while ((m = kvRegex.exec(str)) !== null) {
      res[m[1]] = m[2]
    }
    return res
  }
}

const clean = (v: any) => (v && v !== 'null' && v !== 'N/A') ? String(v).trim() : undefined

function getApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || null
}

async function callGemini(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada')

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    }
  )

  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || `Gemini Error: ${response.status}`)
  
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!content) throw new Error('No content in Gemini response')
  return content
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PROMPTS                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

const MASTER_PROMPT = `Analiza este documento y responde SOLO con un JSON.
1. Identifica el "documentType": "factura", "cif", "nif", "iban", "contrato", o "otro".
2. Extrae:
   - "factura": cups (ES...), holder_name, holder_cif_nif, total_amount, tariff, comercializadora.
   - "cif"/"nif": cif o nif, holder_name, fiscal_address.
   - "iban": iban, bank_name, account_holder.
   - "contrato": cups, holder_name, comercializadora.

JSON: {"documentType": "...", "extracted": { ... }}`

const INVOICE_PROMPT = `Extrae datos de esta factura de energia (LUZ/GAS) con precision.
Responde SOLO con JSON:
{
  "documentType": "factura",
  "extracted": {
    "cups": "ES...", 
    "holder_name": "...", 
    "holder_cif_nif": "...", 
    "total_amount": 0.00,
    "tariff": "...",
    "comercializadora": "...",
    "economics": { "consumo": [], "potencia": [], "otrosConceptos": [], "totalFactura": 0.00 }
  }
}`

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ANALYSIS                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

export async function analyzeDocument(base64Data: string, mimeType: string, docType?: DocumentType): Promise<ExtractedDocumentData> {
  const apiKey = getApiKey()
  if (!apiKey) return { mode: 'manual', documentType: 'otro', error: 'No API Key' }

  try {
    const prompt = docType === 'factura' ? INVOICE_PROMPT : MASTER_PROMPT
    const content = await callGemini(prompt, base64Data, mimeType)
    const result = safeParseGeminiJSON(content)
    
    const detectedType = result.documentType || docType || 'otro'
    const extracted = result.extracted || result
    
    return {
      mode: 'gemini',
      documentType: detectedType,
      cups: normalizeCups(extracted.cups || '') || undefined,
      cif: clean(extracted.cif) || clean(extracted.holder_cif_nif),
      nif: clean(extracted.nif) || clean(extracted.holder_cif_nif),
      holder_name: clean(extracted.holder_name) || clean(extracted.account_holder),
      total_amount: String(extracted.total_amount || ''),
      tariff: clean(extracted.tariff),
      comercializadora: clean(extracted.comercializadora),
      economics: extracted.economics,
      iban: clean(extracted.iban),
      bank_name: clean(extracted.bank_name),
      account_holder: clean(extracted.account_holder),
    }
  } catch (error: any) {
    console.error('[Gemini] Analysis failed:', error)
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
