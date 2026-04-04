/**
 * Shared Gemini AI analysis library for VOLTIS CRM
 *
 * Used by: Telegram webhook, analyze-invoice API, email-inbound, etc.
 * Supports: invoices, CIF/NIF documents, bank certificates, general documents
 */

import { normalizeCups } from '@/lib/utils/cups'

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TYPES                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

export type DocumentType = 'factura' | 'cif' | 'nif' | 'iban' | 'contrato' | 'otro'

export interface ClassifiedDocument {
  type: DocumentType
  confidence: number
  description: string
}

export interface ExtractedInvoiceData {
  mode: 'gemini' | 'manual'
  holder_name?: string
  holder_cif_nif?: string
  billing_address?: string
  supply_address?: string
  cups?: string
  emission_date?: string
  billing_period?: string
  type?: 'luz' | 'gas' | 'telefonia'
  tariff?: string
  comercializadora?: string
  total_amount?: string
  economics?: BillEconomics
  error?: string
}

export interface ExtractedDocumentData {
  mode: 'gemini' | 'manual'
  documentType: DocumentType
  // CIF/NIF fields
  cif?: string
  nif?: string
  holder_name?: string
  fiscal_address?: string
  // IBAN / bank certificate fields
  iban?: string
  bank_name?: string
  account_holder?: string
  // General
  raw_text?: string
  error?: string
}

export interface ConsumoItem {
  periodo: string
  kwh: number
  precioKwh: number
  total: number
  precioEstimado?: boolean
}

export interface PotenciaItem {
  periodo: string
  kw: number
  precioKwDia: number
  dias: number
  total: number
}

export interface OtroConcepto {
  concepto: string
  total: number
}

export interface BillEconomics {
  fechaInicio?: string
  fechaFin?: string
  titular?: string
  comercializadora?: string
  cups?: string
  tarifa?: string
  consumo?: ConsumoItem[]
  potencia?: PotenciaItem[]
  otrosConceptos?: OtroConcepto[]
  consumoTotalKwh?: number
  costeTotalConsumo?: number
  costeMedioKwh?: number
  costeTotalPotencia?: number
  totalFactura?: number
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  JSON PARSER                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function safeParseGeminiJSON(raw: string): any {
  let str = raw.trim()

  // 1. Remove markdown code fences
  str = str.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

  // 2. Extract the JSON object ({...}) from surrounding text
  const jsonStart = str.indexOf('{')
  const jsonEnd = str.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    throw new Error('No JSON object found in response')
  }
  str = str.substring(jsonStart, jsonEnd + 1)

  // 3. Try parsing directly first
  try { return JSON.parse(str) } catch (e) { /* continue */ }

  // 4. Fix unescaped newlines/tabs inside JSON string values
  str = str.replace(/"([^"]*?)"/g, (match) => {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  })

  try { return JSON.parse(str) } catch (e) { /* continue */ }

  // 5. Rebuild line by line
  const rejoined = str.split('\n').map(l => l.trim()).filter(l => l).join(' ')
  try { return JSON.parse(rejoined) } catch (e) { /* continue */ }

  // 6. Regex fallback
  const result: any = {}
  const kvRegex = /"(\w+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(\d+(?:\.\d+)?)|null|(true|false))/g
  let m
  while ((m = kvRegex.exec(str)) !== null) {
    const key = m[1]
    if (m[2] !== undefined) result[key] = m[2]
    else if (m[3] !== undefined) result[key] = parseFloat(m[3])
    else if (m[4] !== undefined) result[key] = m[4] === 'true'
    else result[key] = null
  }

  if (Object.keys(result).length > 0) {
    console.log('[Gemini] Parsed via regex fallback, keys:', Object.keys(result))
    return result
  }

  throw new Error('Could not parse JSON from Gemini response after all strategies')
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  HELPERS                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

const clean = (v: any) => (v && v !== 'null' && v !== 'N/A') ? String(v).trim() : undefined
const cleanNum = (v: any): number | undefined => {
  if (v === null || v === undefined || v === 'null' || v === 'N/A' || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? undefined : n
}

function getApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || null
}

async function callGemini(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada')

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Data } },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 16384 },
      }),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    console.error('[Gemini] API error:', response.status, JSON.stringify(data).substring(0, 500))
    throw new Error(data.error?.message || `Gemini API error: ${response.status}`)
  }

  if (!data.candidates?.length) {
    const reason = data.promptFeedback?.blockReason
    throw new Error(reason ? `Gemini bloqueado: ${reason}` : 'Gemini no devolvio resultados')
  }

  const parts = data.candidates[0]?.content?.parts || []

  // Prefer non-thinking parts with JSON
  let content = ''
  for (const part of parts) {
    if (part.text) {
      if (!part.thought && part.text.includes('{')) { content = part.text; break }
      if (part.text.includes('{')) content = part.text
    }
  }
  if (!content) {
    content = parts.map((p: any) => p.text || '').join('\n').trim()
  }

  if (!content) throw new Error('No content in Gemini response')
  return content
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  DOCUMENT CLASSIFIER                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

export async function classifyDocument(base64Data: string, mimeType: string): Promise<ClassifiedDocument> {
  const prompt = `Clasifica este documento en UNA de estas categorias:
- "factura": Factura de electricidad, gas o telefonia
- "cif": Documento CIF de empresa (Certificado de Identificacion Fiscal)
- "nif": Documento NIF/DNI de persona fisica
- "iban": Certificado de titularidad bancaria, datos bancarios, IBAN
- "contrato": Contrato de suministro o comercializadora
- "otro": Cualquier otro documento

Responde SOLO con un JSON:
{"type": "factura|cif|nif|iban|contrato|otro", "confidence": 0.0-1.0, "description": "breve descripcion del documento"}`

  try {
    const content = await callGemini(prompt, base64Data, mimeType)
    const parsed = safeParseGeminiJSON(content)
    return {
      type: parsed.type || 'otro',
      confidence: parsed.confidence || 0.5,
      description: parsed.description || '',
    }
  } catch (err) {
    console.error('[Gemini] Classification failed:', err)
    return { type: 'otro', confidence: 0, description: 'Error clasificando' }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  INVOICE ANALYSIS                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

const INVOICE_PROMPT = `Eres un experto en auditoria energetica espanola. Tu tarea es extraer datos de facturas de electricidad y gas con precision matematica total.

REGLAS CRITICAS DE EXTRACCION (V3.0):

0. **CUPS (MANDATORIO):** Extrae el codigo CUPS completo (empieza por ES, 20-22 caracteres). Es FUNDAMENTAL e INNEGOCIABLE. Formato: ES + 4 digitos distribuidora + 12 digitos punto + 2 caracteres control + (opcional 2 sufijo). Buscalo en 'Datos del contrato', 'Datos del suministro' o 'Punto de suministro'. NO confundas con numero de contrato o referencia. Lee CUIDADOSAMENTE cada digito — NUNCA inventes ni modifiques caracteres.

1. **Periodos P1 a P6:** Extrae cada periodo existente (kwh, precioKwh, total). Si no hay consumo en un periodo, omitelo.

2. **Calculos Faltantes:** Si solo aparece Total y kWh de un periodo, calcula el precioKwh (Total / kWh). Si hay precio fijo, ponlo en todos los periodos facturados.

3. **Agrupacion Estricta y Nombres Canonicos:**
   Usa OBLIGATORIAMENTE estos nombres exactos para agrupar conceptos similares:
   - 'BONO SOCIAL': Cualquier variante de bono.
   - 'ALQUILER DE EQUIPOS': Alquiler de equipos, contadores y gestion de medida.
   - 'PEAJES Y TRANSPORTES': Peajes y cargos desglosados fuera de energia/potencia.
   - 'COMPENSACION EXCEDENTES': Energia vertida (valor negativo si resta).
   - 'IMPUESTO ELECTRICO': Impuesto de electricidad.
   - 'IVA / IGIC': IVA o IGIC.
   - 'EXCESO DE POTENCIA': Penalizaciones, excesos de potencia, metodo cuarto horario o puntas.

4. **Desglose de Energia y Descuentos:**
   - 'costeBrutoConsumo': suma total de los terminos de energia (kWh x precio) ANTES de descuentos.
   - 'descuentoEnergia': descuentos porcentuales o fijos aplicados al termino de consumo/energia.
   - 'costeNetoConsumo': (costeBrutoConsumo - descuentoEnergia).
   - Los descuentos de energia NO deben aparecer en 'otrosConceptos'.

5. **Separacion de Potencia vs Excesos:**
   - 'costeTotalPotencia' es SOLO el termino fijo por potencia contratada.
   - Cualquier penalizacion extra DEBE ir a 'otrosConceptos' como 'EXCESO DE POTENCIA'.

6. **BUCLE DE AUTOCONTROL MATEMATICO (REGLA DE ORO):**
   - Paso A: Extrae 'totalFactura' directamente de "Total a Pagar" en el documento.
   - Paso B: Suma matematicamente: (costeNetoConsumo + costeTotalPotencia + SUMA de otrosConceptos).
   - Paso C: Compara el sumatorio con 'totalFactura'.
   - Paso D: Si la diferencia es mayor a 0.05 euros, RE-ESCANEA buscando conceptos omitidos hasta que la suma coincida.

7. **Facturas de Anulacion:** Devuelve valores en NEGATIVO si es abono/rectificativa.

RESPONDE UNICAMENTE CON UN JSON VALIDO con esta estructura:
{
  "holder_name": "nombre del titular",
  "holder_cif_nif": "CIF o NIF del titular",
  "billing_address": "direccion de facturacion",
  "supply_address": "direccion del punto de suministro",
  "cups": "CUPS completo (ES...)",
  "emission_date": "YYYY-MM-DD",
  "billing_period": "01/01/2024-31/01/2024",
  "type": "luz o gas",
  "tariff": "2.0TD, 3.0TD, 6.1TD, RL.1, RL.2, etc",
  "comercializadora": "nombre comercializadora",
  "total_amount": "125.43",
  "economics": {
    "fechaInicio": "YYYY-MM-DD",
    "fechaFin": "YYYY-MM-DD",
    "titular": "nombre del titular",
    "comercializadora": "nombre comercializadora",
    "cups": "CUPS completo",
    "tarifa": "tarifa",
    "consumo": [
      { "periodo": "P1", "kwh": 123.45, "precioKwh": 0.123456, "total": 15.18, "precioEstimado": false }
    ],
    "potencia": [
      { "periodo": "P1", "kw": 5.5, "precioKwDia": 0.123456, "dias": 30, "total": 20.37 }
    ],
    "otrosConceptos": [
      { "concepto": "IMPUESTO ELECTRICO", "total": 8.50 },
      { "concepto": "IVA / IGIC", "total": 12.30 },
      { "concepto": "BONO SOCIAL", "total": -5.00 },
      { "concepto": "ALQUILER DE EQUIPOS", "total": 0.81 }
    ],
    "consumoTotalKwh": 350.00,
    "costeBrutoConsumo": 48.00,
    "descuentoEnergia": 2.50,
    "costeNetoConsumo": 45.50,
    "costeTotalConsumo": 45.50,
    "costeMedioKwh": 0.13,
    "costeTotalPotencia": 38.20,
    "totalFactura": 108.50
  }
}

REGLAS ADICIONALES:
- La tarifa es clave: para luz es 2.0TD, 3.0TD, 6.1TD etc; para gas es RL.1, RL.2, RL.3, RL.4.
- Si la factura es de GAS no habra periodos P1-P6, adapta la estructura a lo que aparezca.
- Devuelve SOLO el JSON, sin texto antes ni despues.`

export async function analyzeInvoice(base64Data: string, mimeType: string): Promise<ExtractedInvoiceData> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { mode: 'manual', error: 'GEMINI_API_KEY no configurada' }
  }

  try {
    console.log(`[Gemini] Analyzing invoice, mime: ${mimeType}, base64 length: ${base64Data.length}`)
    const content = await callGemini(INVOICE_PROMPT, base64Data, mimeType)

    let extractedData: any
    try {
      extractedData = safeParseGeminiJSON(content)
    } catch (parseErr: any) {
      console.error('[Gemini] JSON parse failed:', parseErr.message)
      return { mode: 'manual', error: 'Error parseando respuesta: ' + parseErr.message }
    }

    // Normalize tariff
    let tariff = clean(extractedData.tariff)
    if (tariff) {
      tariff = tariff.replace(/\s+/g, '').toUpperCase()
      const tariffMap: Record<string, string> = {
        '2.0': '2.0TD', '20TD': '2.0TD', '2.0A': '2.0TD',
        '3.0': '3.0TD', '30TD': '3.0TD', '3.0A': '3.0TD',
        '6.1': '6.1TD', '61TD': '6.1TD', '6.1A': '6.1TD',
        '6.2': '6.2TD', '62TD': '6.2TD',
        '6.3': '6.3TD', '63TD': '6.3TD',
        '6.4': '6.4TD', '64TD': '6.4TD',
      }
      tariff = tariffMap[tariff] || tariff
    }

    // Normalize type
    let type = clean(extractedData.type)
    if (type) {
      type = type.toLowerCase()
      if (type.includes('electr') || type === 'electricidad') type = 'luz'
      if (type.includes('gas')) type = 'gas'
      if (type.includes('telef') || type.includes('fibra') || type.includes('movil')) type = 'telefonia'
    }

    // Parse economics
    let economics: BillEconomics | undefined
    const eco = extractedData.economics
    if (eco && typeof eco === 'object') {
      const consumo: ConsumoItem[] = []
      if (Array.isArray(eco.consumo)) {
        for (const item of eco.consumo) {
          const kwh = cleanNum(item.kwh)
          const precioKwh = cleanNum(item.precioKwh)
          if (item.periodo && kwh !== undefined) {
            consumo.push({
              periodo: String(item.periodo).toUpperCase(),
              kwh: kwh ?? 0,
              precioKwh: precioKwh ?? 0,
              total: cleanNum(item.total) ?? (kwh ?? 0) * (precioKwh ?? 0),
              precioEstimado: item.precioEstimado === true,
            })
          }
        }
      }

      const potencia: PotenciaItem[] = []
      if (Array.isArray(eco.potencia)) {
        for (const item of eco.potencia) {
          const kw = cleanNum(item.kw)
          if (item.periodo && kw !== undefined) {
            potencia.push({
              periodo: String(item.periodo).toUpperCase(),
              kw: kw ?? 0,
              precioKwDia: cleanNum(item.precioKwDia) ?? 0,
              dias: cleanNum(item.dias) ?? 30,
              total: cleanNum(item.total) ?? 0,
            })
          }
        }
      }

      let otrosConceptos: OtroConcepto[] = []
      if (Array.isArray(eco.otrosConceptos)) {
        for (const item of eco.otrosConceptos) {
          const total = cleanNum(item.total)
          if (item.concepto && total !== undefined) {
            otrosConceptos.push({ concepto: String(item.concepto), total })
          }
        }
      }

      // Deduplication
      if (otrosConceptos.length > 0) {
        const seen = new Set<string>()
        otrosConceptos = otrosConceptos.filter(oc => {
          const key = `${oc.concepto.toUpperCase().replace(/\s+/g, '')}-${oc.total}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }

      const consumoTotalKwh = cleanNum(eco.consumoTotalKwh)
        ?? (consumo.length > 0 ? consumo.reduce((s, c) => s + c.kwh, 0) : undefined)
      const costeBrutoConsumo = cleanNum(eco.costeBrutoConsumo)
        ?? (consumo.length > 0 ? consumo.reduce((s, c) => s + c.total, 0) : undefined)
      const descuentoEnergia = cleanNum(eco.descuentoEnergia) ?? 0
      const costeNetoConsumo = cleanNum(eco.costeNetoConsumo)
        ?? (costeBrutoConsumo !== undefined ? costeBrutoConsumo - descuentoEnergia : undefined)
      const costeTotalConsumo = cleanNum(eco.costeTotalConsumo) ?? costeNetoConsumo
      const costeTotalPotencia = cleanNum(eco.costeTotalPotencia)
        ?? (potencia.length > 0 ? potencia.reduce((s, p) => s + p.total, 0) : undefined)
      const costeMedioKwh = cleanNum(eco.costeMedioKwh)
        ?? (consumoTotalKwh && costeTotalConsumo && consumoTotalKwh > 0
            ? costeTotalConsumo / consumoTotalKwh : undefined)

      economics = {
        fechaInicio: clean(eco.fechaInicio),
        fechaFin: clean(eco.fechaFin),
        titular: clean(eco.titular),
        comercializadora: clean(eco.comercializadora),
        cups: clean(eco.cups),
        tarifa: clean(eco.tarifa) || tariff,
        consumo: consumo.length > 0 ? consumo : undefined,
        potencia: potencia.length > 0 ? potencia : undefined,
        otrosConceptos: otrosConceptos.length > 0 ? otrosConceptos : undefined,
        consumoTotalKwh,
        costeTotalConsumo,
        costeMedioKwh,
        costeTotalPotencia,
        totalFactura: cleanNum(eco.totalFactura) ?? cleanNum(extractedData.total_amount),
      }
    }

    return {
      mode: 'gemini',
      holder_name: clean(extractedData.holder_name),
      holder_cif_nif: clean(extractedData.holder_cif_nif),
      billing_address: clean(extractedData.billing_address),
      supply_address: clean(extractedData.supply_address),
      cups: normalizeCups(clean(extractedData.cups) || '') || undefined,
      emission_date: clean(extractedData.emission_date),
      billing_period: clean(extractedData.billing_period),
      type: type as any || undefined,
      tariff: tariff || undefined,
      comercializadora: clean(extractedData.comercializadora),
      total_amount: clean(extractedData.total_amount),
      economics,
    }
  } catch (error: any) {
    console.error('[Gemini] Invoice analysis failed:', error)

    // Retry once with simplified prompt
    try {
      console.warn('[Gemini] Retrying with simplified prompt...')
      const content = await callGemini(
        'Extrae los datos de esta factura de energia en formato JSON. Incluye: holder_name, holder_cif_nif, cups, tariff, type (luz/gas), comercializadora, total_amount, billing_period, emission_date, y economics con consumo por periodo, potencia, otrosConceptos y totales. Devuelve SOLO JSON.',
        base64Data,
        mimeType
      )
      const parsed = safeParseGeminiJSON(content)
      return {
        mode: 'gemini',
        holder_name: clean(parsed.holder_name),
        holder_cif_nif: clean(parsed.holder_cif_nif),
        cups: normalizeCups(clean(parsed.cups) || '') || undefined,
        tariff: clean(parsed.tariff),
        type: clean(parsed.type) as any,
        comercializadora: clean(parsed.comercializadora),
        total_amount: clean(parsed.total_amount),
        billing_period: clean(parsed.billing_period),
        emission_date: clean(parsed.emission_date),
      }
    } catch (retryErr) {
      console.error('[Gemini] Retry also failed:', retryErr)
    }

    return {
      mode: 'manual',
      error: error.message || 'Error desconocido en analisis',
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  DOCUMENT ANALYSIS (CIF, NIF, IBAN, etc.)                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

export async function analyzeDocument(base64Data: string, mimeType: string, docType?: DocumentType): Promise<ExtractedDocumentData> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { mode: 'manual', documentType: docType || 'otro', error: 'GEMINI_API_KEY no configurada' }
  }

  // If we don't know the type, classify first
  let effectiveType = docType
  if (!effectiveType) {
    const classified = await classifyDocument(base64Data, mimeType)
    effectiveType = classified.type
    console.log(`[Gemini] Document classified as: ${effectiveType} (${classified.confidence})`)
  }

  // If it's an invoice, delegate to invoice analyzer
  if (effectiveType === 'factura') {
    const invoiceResult = await analyzeInvoice(base64Data, mimeType)
    return {
      mode: invoiceResult.mode,
      documentType: 'factura',
      cif: invoiceResult.holder_cif_nif?.startsWith('B') || invoiceResult.holder_cif_nif?.startsWith('A')
        ? invoiceResult.holder_cif_nif : undefined,
      nif: invoiceResult.holder_cif_nif && !invoiceResult.holder_cif_nif.startsWith('B') && !invoiceResult.holder_cif_nif.startsWith('A')
        ? invoiceResult.holder_cif_nif : undefined,
      holder_name: invoiceResult.holder_name,
      error: invoiceResult.error,
    }
  }

  try {
    const prompts: Record<string, string> = {
      cif: `Extrae los datos de este documento CIF (Certificado de Identificacion Fiscal) de empresa.
Responde SOLO con JSON:
{
  "cif": "el numero CIF (ej: B12345678)",
  "holder_name": "razon social / nombre empresa",
  "fiscal_address": "domicilio fiscal completo",
  "activity": "actividad economica si aparece"
}`,
      nif: `Extrae los datos de este documento NIF/DNI de persona fisica.
Responde SOLO con JSON:
{
  "nif": "el numero NIF/DNI (ej: 12345678A)",
  "holder_name": "nombre completo de la persona",
  "fiscal_address": "domicilio si aparece",
  "birth_date": "fecha nacimiento si aparece (YYYY-MM-DD)"
}`,
      iban: `Extrae los datos bancarios de este documento (certificado de titularidad bancaria, extracto, etc).
Responde SOLO con JSON:
{
  "iban": "numero IBAN completo (ej: ES12 1234 5678 90 1234567890)",
  "bank_name": "nombre del banco",
  "account_holder": "titular de la cuenta",
  "bic_swift": "codigo BIC/SWIFT si aparece"
}`,
      contrato: `Extrae los datos principales de este contrato de suministro energetico.
Responde SOLO con JSON:
{
  "holder_name": "nombre del titular",
  "cif_nif": "CIF o NIF",
  "cups": "codigo CUPS si aparece",
  "comercializadora": "nombre de la comercializadora",
  "tariff": "tarifa contratada",
  "contract_date": "fecha del contrato (YYYY-MM-DD)"
}`,
      otro: `Extrae toda la informacion relevante de este documento.
Responde SOLO con JSON:
{
  "document_type": "tipo de documento detectado",
  "holder_name": "nombre/titular si aparece",
  "cif_nif": "CIF o NIF si aparece",
  "iban": "IBAN si aparece",
  "summary": "resumen breve del contenido"
}`,
    }

    const prompt = prompts[effectiveType] || prompts.otro
    const content = await callGemini(prompt, base64Data, mimeType)
    const parsed = safeParseGeminiJSON(content)

    return {
      mode: 'gemini',
      documentType: effectiveType,
      cif: clean(parsed.cif) || (clean(parsed.cif_nif)?.match(/^[A-H]/)?.[0] ? clean(parsed.cif_nif) : undefined),
      nif: clean(parsed.nif) || (clean(parsed.cif_nif)?.match(/^\d/)?.[0] ? clean(parsed.cif_nif) : undefined),
      holder_name: clean(parsed.holder_name) || clean(parsed.account_holder),
      fiscal_address: clean(parsed.fiscal_address),
      iban: clean(parsed.iban),
      bank_name: clean(parsed.bank_name),
      account_holder: clean(parsed.account_holder),
      raw_text: clean(parsed.summary),
    }
  } catch (error: any) {
    console.error(`[Gemini] Document analysis failed for ${effectiveType}:`, error)
    return {
      mode: 'manual',
      documentType: effectiveType,
      error: error.message || 'Error en analisis de documento',
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MIME TYPE HELPER                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function getMimeType(fileName: string, fileType?: string): string {
  const name = (fileName || '').toLowerCase()
  if (fileType === 'pdf' || name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}
