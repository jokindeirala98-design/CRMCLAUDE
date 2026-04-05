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
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
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

const MASTER_PROMPT = `Analiza este documento y responde SOLO con JSON (sin markdown, sin texto adicional).
1. Identifica "documentType": "factura", "cif", "nif", "iban", "contrato", o "otro".
2. Extrae TODOS los campos disponibles según el tipo:
   - "factura" (luz/gas): cups (código ES...), supply_type ("luz" o "gas"), holder_name, holder_cif_nif, total_amount (número), tariff (ej: 2.0TD), comercializadora, supply_address, billing_period ("DD/MM/YYYY - DD/MM/YYYY"), economics: { fechaInicio (DD/MM/YYYY), fechaFin (DD/MM/YYYY), totalFactura (número), consumoTotalKwh (número si es luz), consumo (array), potencia (array), otrosConceptos (array) }
   - "cif"/"nif": cif o nif, holder_name, fiscal_address.
   - "iban": iban, bank_name, account_holder.
   - "contrato": cups, holder_name, comercializadora.

JSON: {"documentType": "...", "extracted": { ... }}`

const INVOICE_PROMPT = `Extrae todos los datos de esta factura de energia (LUZ o GAS) con maxima precision.
Responde SOLO con JSON (sin markdown, sin texto adicional):
{
  "documentType": "factura",
  "extracted": {
    "cups": "ES...",
    "supply_type": "luz",
    "holder_name": "Nombre del titular",
    "holder_cif_nif": "CIF o NIF del titular",
    "total_amount": 0.00,
    "tariff": "2.0TD",
    "comercializadora": "Nombre comercializadora",
    "supply_address": "Direccion del suministro",
    "billing_period": "01/01/2024 - 31/01/2024",
    "economics": {
      "fechaInicio": "01/01/2024",
      "fechaFin": "31/01/2024",
      "totalFactura": 0.00,
      "consumoTotalKwh": 0.00,
      "consumo": [],
      "potencia": [],
      "otrosConceptos": []
    }
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
      supply_type: (['luz','gas','telefonia'].includes(extracted.supply_type) ? extracted.supply_type : undefined) as 'luz' | 'gas' | 'telefonia' | undefined,
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
