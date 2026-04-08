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

const INVOICE_PROMPT = `Eres un experto en auditoría energética española (luz y gas natural). Tu tarea es extraer datos de facturas con PRECISIÓN MATEMÁTICA TOTAL.
Responde ÚNICAMENTE con JSON válido. Sin markdown, sin texto adicional, sin comentarios.

════════════════════════════════════════════════════════════════════════════
PASO 0 — DETECCIÓN DE TIPO DE DOCUMENTO
════════════════════════════════════════════════════════════════════════════

Identifica "documentType": "factura" | "cif" | "nif" | "iban" | "contrato" | "otro".
Si NO es factura de energía → responde con formato simple (ver FINAL).
Si es factura → detecta "supply_type": "luz" o "gas" (las tarifas RL.x son SIEMPRE gas).

════════════════════════════════════════════════════════════════════════════
REGLAS CRÍTICAS DE EXTRACCIÓN (V3.0) — APLICAN A FACTURAS DE LUZ Y GAS
════════════════════════════════════════════════════════════════════════════

0. **CUPS (MANDATORIO):** Extrae el código CUPS completo (empieza por ES). Es fundamental e innegociable.

1. **DATOS DE TITULAR Y SUMINISTRO (MANDATORIO):**
   - holder_name: nombre EXACTO del titular tal como aparece (ej: "AYUNTAMIENTO DE AOIZ", no "Ayuntamiento").
   - holder_cif_nif: CIF o NIF del titular tal como aparece.
   - supply_address: DIRECCIÓN COMPLETA del punto de suministro (calle, número, CP, municipio).
   - comercializadora: nombre de la empresa emisora.
   - tariff: tarifa exacta (2.0TD, 3.0TD, 6.1TD, RL.1, RL.2, etc.).

2. **FACTURAS DE ANULACIÓN / ABONOS:** Si la factura es rectificativa o abono, devuelve TODOS los valores en NEGATIVO.

════════════════════════════════════════════════════════════════════════════
REGLAS ESPECÍFICAS PARA FACTURAS DE ELECTRICIDAD
════════════════════════════════════════════════════════════════════════════

LUZ-1. **Periodos P1 a P6:** Extrae cada periodo existente (kwh, precioKwh, total). Si no hay consumo en un periodo, omítelo.

LUZ-2. **Cálculos Faltantes:** Si solo aparece Total y kWh, calcula precioKwh = Total / kWh. Si hay precio fijo, ponlo en todos los periodos facturados.

LUZ-3. **AGRUPACIÓN ESTRICTA Y NOMBRES CANÓNICOS (OBLIGATORIO):**
   Usa EXACTAMENTE estos nombres para agrupar conceptos similares en otrosConceptos:
   - 'BONO SOCIAL' — cualquier variante de bono social.
   - 'ALQUILER DE EQUIPOS' — alquiler de equipos, contadores, gestión de medida.
   - 'PEAJES Y TRANSPORTES' — peajes y cargos desglosados fuera de energía/potencia.
   - 'COMPENSACIÓN EXCEDENTES' — energía vertida (negativo si resta).
   - 'IMPUESTO ELÉCTRICO' — impuesto de electricidad.
   - 'IVA / IGIC' — IVA o IGIC.
   - 'EXCESO DE POTENCIA' — penalizaciones, excesos de potencia, método cuarto horario o puntas.

LUZ-4. **DESGLOSE DE ENERGÍA Y DESCUENTOS:**
   - costeBrutoConsumo = suma total de términos de energía (kWh × precio) ANTES de descuentos.
   - descuentoEnergia = descuentos (porcentuales o fijos) aplicados EXCLUSIVAMENTE al término de consumo.
   - costeNetoConsumo = costeBrutoConsumo − descuentoEnergia.
   - costeTotalConsumo = costeNetoConsumo (alias para compatibilidad).
   - MANDATORIO: los descuentos de energía NO deben aparecer en otrosConceptos.

LUZ-5. **AUDITORÍA DE POTENCIA INDUSTRIAL:**
   - Busca "Resumen de Factura" o "Detalle de Potencia".
   - costeTotalPotencia = SOLO el término fijo por potencia contratada.
   - CUALQUIER penalización/exceso de potencia DEBE ir a otrosConceptos como 'EXCESO DE POTENCIA'.

LUZ-6. **BUCLE DE AUTOCONTROL MATEMÁTICO (REGLA DE ORO):**
   - Paso A: extrae totalFactura del "Total a Pagar" impreso.
   - Paso B: suma (costeNetoConsumo + costeTotalPotencia + Σ otrosConceptos).
   - Paso C: compara B contra A.
   - Paso D: si |B − A| > 0.05€, RE-ESCANEA buscando conceptos omitidos hasta que coincida.

════════════════════════════════════════════════════════════════════════════
REGLAS ESPECÍFICAS PARA FACTURAS DE GAS NATURAL
════════════════════════════════════════════════════════════════════════════

GAS-1. **DESGLOSE DE CONSUMO:**
   - consumoKwh exactos facturados.
   - precioKwh (término variable). Si no explícito: precioKwh = costeBrutoConsumo / consumoKwh.
   - costeBrutoConsumo = consumoKwh × precioKwh.

GAS-2. **CLASIFICACIÓN TÉCNICA DE DESCUENTOS (CRÍTICO, 3 CATEGORÍAS):**
   - descuentoEnergia — aplicados EXCLUSIVAMENTE al consumo (% sobre energía, bonificación consumo).
   - descuentoTerminoFijo — aplicados al término fijo / cuota de servicio.
   - descuentoOtros — sobre el total de la factura o promociones genéricas.

GAS-3. **CÁLCULO NETO ENERGÉTICO:**
   - costeNetoConsumo = costeBrutoConsumo − descuentoEnergia.
   - costeTotalConsumo = costeNetoConsumo (alias).

GAS-4. **OTROS CONCEPTOS FIJOS:**
   - terminoFijoTotal (cuota fija / término fijo).
   - impuestoHidrocarbTotal (impuesto sobre hidrocarburos).
   - alquilerTotal (alquiler de contador).
   - ivaPorcentaje, ivaTotal.

GAS-5. **BUCLE DE AUTOCONTROL MATEMÁTICO:**
   - Paso A: extrae totalFactura del "Total a Pagar" impreso.
   - Paso B: suma (costeBrutoConsumo + terminoFijoTotal + impuestoHidrocarbTotal + alquilerTotal) − (descuentoEnergia + descuentoTerminoFijo + descuentoOtros) + ivaTotal.
   - Paso C: si |B − A| > 0.05€, RE-ESCANEA.

════════════════════════════════════════════════════════════════════════════
FORMATO JSON DE RESPUESTA PARA FACTURAS
════════════════════════════════════════════════════════════════════════════

{
  "documentType": "factura",
  "extracted": {
    "cups": "ES0000000000000000XX",
    "supply_type": "luz",
    "holder_name": "AYUNTAMIENTO DE AOIZ",
    "holder_cif_nif": "P3120300F",
    "total_amount": 123.45,
    "tariff": "3.0TD",
    "comercializadora": "Endesa",
    "supply_address": "C/ Mayor 1, 31430 Aoiz, Navarra",
    "billing_period": "01/01/2024 - 31/01/2024",
    "economics": {
      "fechaInicio": "01/01/2024",
      "fechaFin": "31/01/2024",
      "titular": "AYUNTAMIENTO DE AOIZ",
      "comercializadora": "Endesa",
      "cups": "ES0000000000000000XX",
      "tarifa": "3.0TD",
      "consumoTotalKwh": 456.78,
      "consumo": [
        { "periodo": "P1", "kwh": 100.0, "precioKwh": 0.1500, "total": 15.00 },
        { "periodo": "P2", "kwh": 200.0, "precioKwh": 0.0800, "total": 16.00 }
      ],
      "potencia": [
        { "periodo": "P1", "kw": 4.4, "precioKwDia": 0.10423, "dias": 31, "total": 14.22 }
      ],
      "costeBrutoConsumo": 31.00,
      "descuentoEnergia": 2.50,
      "costeNetoConsumo": 28.50,
      "costeTotalConsumo": 28.50,
      "costeTotalPotencia": 14.22,
      "otrosConceptos": [
        { "concepto": "ALQUILER DE EQUIPOS", "total": 1.22 },
        { "concepto": "IMPUESTO ELÉCTRICO", "total": 3.15 },
        { "concepto": "IVA / IGIC", "total": 21.43 },
        { "concepto": "EXCESO DE POTENCIA", "total": 5.50 },
        { "concepto": "BONO SOCIAL", "total": 0.35 }
      ],
      "totalFactura": 123.45,
      "gasPricing": null
    }
  }
}

Para GAS, incluye ADICIONALMENTE en economics:
  "gasPricing": {
    "precioKwh": 0.065,
    "terminoFijoDiario": 0.15,
    "diasFacturados": 31,
    "terminoFijoTotal": 4.65,
    "impuestoHidrocarbTotal": 2.30,
    "alquilerTotal": 1.20,
    "ivaPorcentaje": 21,
    "ivaTotal": 12.45,
    "descuentoTerminoFijo": 0,
    "descuentoOtros": 0
  }

════════════════════════════════════════════════════════════════════════════
SI NO ES FACTURA DE ENERGÍA
════════════════════════════════════════════════════════════════════════════

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
/*  POST-PROCESSING (V3.0)                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Normalize economics block after extraction:
 * 1) Deduplicate otrosConceptos (same canonical concept → sum totals)
 * 2) Map costeNetoConsumo → costeTotalConsumo for backward compat
 * 3) Compute costeMedioKwhNeto from consumoTotalKwh
 */
function postProcessEconomics(economics: any): any {
  if (!economics || typeof economics !== 'object') return economics
  const eco = { ...economics }

  // Numeric coercion helper
  const num = (v: any): number => {
    if (v == null) return 0
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }

  // 1) Deduplicate otrosConceptos by canonical name
  if (Array.isArray(eco.otrosConceptos)) {
    const map = new Map<string, { concepto: string; total: number }>()
    for (const c of eco.otrosConceptos) {
      if (!c || !c.concepto) continue
      const key = String(c.concepto).trim().toUpperCase()
      const total = num(c.total)
      const existing = map.get(key)
      if (existing) {
        existing.total += total
      } else {
        map.set(key, { concepto: String(c.concepto).trim(), total })
      }
    }
    eco.otrosConceptos = Array.from(map.values()).map(c => ({
      concepto: c.concepto,
      total: Math.round(c.total * 100) / 100,
    }))
  }

  // 2) Map costeNetoConsumo → costeTotalConsumo (backward compat)
  if (eco.costeNetoConsumo != null && eco.costeTotalConsumo == null) {
    eco.costeTotalConsumo = eco.costeNetoConsumo
  }
  if (eco.costeTotalConsumo != null && eco.costeNetoConsumo == null) {
    eco.costeNetoConsumo = eco.costeTotalConsumo
  }

  // If costeBrutoConsumo missing but we have consumo items, compute it
  if (eco.costeBrutoConsumo == null && Array.isArray(eco.consumo)) {
    const brute = eco.consumo.reduce((s: number, p: any) => s + num(p.total), 0)
    if (brute > 0) eco.costeBrutoConsumo = Math.round(brute * 100) / 100
  }

  // 3) Compute costeMedioKwhNeto
  const consumoKwh = num(eco.consumoTotalKwh)
  const costeNeto = num(eco.costeNetoConsumo ?? eco.costeTotalConsumo)
  if (consumoKwh > 0 && costeNeto > 0) {
    eco.costeMedioKwhNeto = Math.round((costeNeto / consumoKwh) * 10000) / 10000
    if (eco.costeMedioKwh == null) eco.costeMedioKwh = eco.costeMedioKwhNeto
  }

  return eco
}

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
      economics: extracted.economics ? postProcessEconomics(extracted.economics) : null,
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  BACKWARD COMPAT ALIASES                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

export type ExtractedInvoiceData = ExtractedDocumentData

export async function analyzeInvoice(base64Data: string, mimeType: string): Promise<ExtractedInvoiceData> {
  return analyzeDocument(base64Data, mimeType, 'factura')
}

export function getMimeType(fileName: string, fileType?: string): string {
  const name = (fileName || '').toLowerCase()
  if (fileType === 'pdf' || name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}
