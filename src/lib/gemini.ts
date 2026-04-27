/**
 * Shared Gemini AI analysis library for VOLTIS CRM
 * v6.0 - Model auto-discovery fallback chain, robust invoice extraction
 */

import { normalizeCups, extractCups } from '@/lib/utils/cups'
import { normalizeTariff } from '@/lib/consumption-utils'

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
  'gemini-2.5-flash',               // primary — works for new API keys (2025)
  'gemini-flash-latest',            // alias → resolves to latest flash (fallback if 2.5 is overloaded)
  'gemini-2.5-flash-lite',          // lite — lower demand, good for fallback
  'gemini-2.5-pro',                 // pro variant (higher cost, better accuracy)
  'gemini-2.0-flash',               // legacy — only available for older keys
  'gemini-2.0-flash-lite',          // legacy lite
  'gemini-1.5-flash',               // legacy fallback
  'gemini-1.5-pro',                 // legacy fallback pro
]

let _cachedModel: string | null = null
// Track 503 "high demand" errors separately — the key is valid but models are overloaded
let _lastOverloadedAt = 0

async function getWorkingModel(apiKey: string): Promise<string> {
  if (_cachedModel) return _cachedModel

  let anyOverloaded = false

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
          signal: AbortSignal.timeout(8000),
        }
      )
      // 401/403 means the API key itself is invalid — no point trying other models
      if (res.status === 401 || res.status === 403) {
        const d = await res.json().catch(() => ({}))
        const msg = d?.error?.message || 'API key invalid or unauthorized'
        throw new GeminiError(msg, res.status, false)
      }
      // 429/503 = overloaded / rate limited — try next model, remember for error message
      if (res.status === 429 || res.status === 503) {
        anyOverloaded = true
        console.warn(`[Gemini] Model ${model} overloaded (${res.status}), trying next`)
        continue
      }
      if (res.ok) {
        const d = await res.json()
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          console.log(`[Gemini] Using model: ${model}`)
          _cachedModel = model
          _lastOverloadedAt = 0
          return model
        }
        // response ok but no text (e.g. gemini-2.5-pro returning empty) — check body for overload hint
        const reason = d.candidates?.[0]?.finishReason
        if (reason === 'OVERLOAD' || reason === 'OTHER') {
          anyOverloaded = true
          continue
        }
      }
      // Any other non-ok status (404, model not found, deprecated) → try next
    } catch (e) {
      // Re-throw auth errors immediately — no point retrying with a bad key
      if (e instanceof GeminiError && (e.status === 401 || e.status === 403)) throw e
      // Otherwise (network error, timeout) try next model
    }
  }

  if (anyOverloaded) {
    _lastOverloadedAt = Date.now()
    throw new GeminiError(
      'Gemini sobrecargado por alta demanda. Inténtalo de nuevo en unos minutos.',
      503,
      true, // retryable
    )
  }

  throw new GeminiError('No Gemini model available. Check API key and quota.', 0, false)
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  API CALLER                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Custom error with an HTTP-like status so the retry wrapper can decide
 * whether a failure is transient (retryable) or permanent.
 */
class GeminiError extends Error {
  status: number
  retryable: boolean
  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
    this.retryable = retryable
  }
}

/**
 * Low-level single Gemini call. Throws GeminiError with retryable flag so the
 * wrapper can backoff properly on 503/429/timeout/"high demand".
 */
async function callGeminiOnce(
  prompt: string,
  base64Data: string,
  mimeType: string,
  extraPages?: Array<{ base64Data: string; mimeType: string }>
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY no configurada', 0, false)

  const model = await getWorkingModel(apiKey)

  // Build image parts — first page + any additional pages (multi-page invoice support)
  const imageParts: any[] = [{ inlineData: { mimeType, data: base64Data } }]
  if (extraPages?.length) {
    const pageLabel = extraPages.length === 1
      ? 'NOTA: Se adjunta una segunda página de la misma factura. Analiza AMBAS páginas juntas para una extracción completa.'
      : `NOTA: Se adjuntan ${extraPages.length} páginas adicionales de la misma factura. Analiza TODAS las páginas juntas.`
    imageParts.push({ text: pageLabel })
    for (const page of extraPages) {
      imageParts.push({ inlineData: { mimeType: page.mimeType, data: page.base64Data } })
    }
  }

  let response: Response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          // systemInstruction separates the extraction rules from the document
          // so the model treats them as instructions, not as part of the invoice.
          system_instruction: { parts: [{ text: prompt }] },
          contents: [{
            role: 'user',
            parts: [
              { text: 'Analiza el documento adjunto y extrae los datos siguiendo estrictamente las instrucciones del sistema. Devuelve SOLO JSON sin texto adicional.' },
              ...imageParts,
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 16384, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(90000),
      }
    )
  } catch (e: any) {
    const msg = e?.message || 'network error'
    // Timeouts and abort errors are retryable
    const isTimeout = /timeout|abort|ETIMEDOUT|network/i.test(msg)
    throw new GeminiError(`Gemini network error: ${msg}`, 0, isTimeout)
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const errMsg: string = data?.error?.message || `Gemini Error: ${response.status}`
    // If this model stopped working, clear cache and throw so retry can pick next
    if (errMsg.includes('no longer available') || errMsg.includes('deprecated')) {
      _cachedModel = null
    }
    const status = response.status
    const retryable =
      status === 429 ||
      status === 503 ||
      status === 504 ||
      /rate.?limit|quota|overload|high demand|unavailable|try again/i.test(errMsg)
    throw new GeminiError(errMsg, status, retryable)
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!content) {
    const reason = data.candidates?.[0]?.finishReason
    if (reason && reason !== 'STOP') {
      const retryable = reason === 'OTHER' || reason === 'MAX_TOKENS'
      throw new GeminiError(`Gemini stopped: ${reason}`, 0, retryable)
    }
    throw new GeminiError('No content in Gemini response', 0, true)
  }
  return content
}

/**
 * Retry wrapper around callGeminiOnce with exponential backoff + jitter.
 * Retries up to `maxAttempts` times on retryable errors only.
 */
export async function callGemini(
  prompt: string,
  base64Data: string,
  mimeType: string,
  maxAttempts = 3,
  extraPages?: Array<{ base64Data: string; mimeType: string }>
): Promise<string> {
  let lastErr: any = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGeminiOnce(prompt, base64Data, mimeType, extraPages)
    } catch (e: any) {
      lastErr = e
      const retryable = e instanceof GeminiError ? e.retryable : false
      if (!retryable || attempt === maxAttempts - 1) break
      // Backoff: 2s, 4s, 8s + jitter (0–500ms)
      const base = 2000 * Math.pow(2, attempt)
      const jitter = Math.floor(Math.random() * 500)
      const wait = base + jitter
      console.warn(`[Gemini] retryable error (attempt ${attempt + 1}/${maxAttempts}): ${e?.message}. Retrying in ${wait}ms...`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw lastErr
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CLAUDE (ANTHROPIC) FALLBACK                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Calls Anthropic Claude as a fallback extractor when Gemini is unavailable.
 * Uses the same prompt and image data — returns the raw JSON text string.
 * Requires ANTHROPIC_API_KEY env var.
 */
async function callClaudeForExtraction(
  prompt: string,
  base64Data: string,
  mimeType: string,
  extraPages?: Array<{ base64Data: string; mimeType: string }>
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada — no hay extractor de respaldo disponible.')

  // Build the content array for Claude's messages API
  const content: any[] = []

  // Primary image
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: mimeType as any, data: base64Data },
  })

  // Extra pages (multi-page invoices)
  if (extraPages?.length) {
    const pageNote = extraPages.length === 1
      ? 'NOTA: Se adjunta una segunda página de la misma factura. Analiza AMBAS páginas juntas.'
      : `NOTA: Se adjuntan ${extraPages.length} páginas adicionales. Analiza TODAS las páginas juntas.`
    content.push({ type: 'text', text: pageNote })
    for (const page of extraPages) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: page.mimeType as any, data: page.base64Data },
      })
    }
  }

  content.push({
    type: 'text',
    text: 'Analiza el documento adjunto y extrae los datos siguiendo estrictamente las instrucciones del sistema. Devuelve SOLO JSON sin texto adicional.',
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 16384,
      system: prompt,
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(90000),
  })

  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    const msg = d?.error?.message || `Claude API error ${res.status}`
    throw new Error(msg)
  }

  const data = await res.json()
  const text = data?.content?.[0]?.text || ''
  if (!text) throw new Error('Claude devolvió respuesta vacía')

  console.log('[Claude] Fallback extraction successful')
  return text
}

/**
 * Translate raw Gemini errors to user-friendly Spanish messages.
 */
function getUserFriendlyError(err: any): string {
  const raw: string = err?.message || String(err || 'Error desconocido')
  if (!raw) return 'Error desconocido al analizar la factura.'
  if (/api.?key|GEMINI_API_KEY/i.test(raw)) return 'Clave de API de Gemini inválida. Actualízala en Vercel → Settings → Environment Variables (GEMINI_API_KEY).'
  if (/unauthorized|401/i.test(raw)) return 'Clave de API de Gemini caducada o inválida. Ve a aistudio.google.com, genera una nueva clave y actualízala en Vercel → Settings → Environment Variables (GEMINI_API_KEY).'
  if (/No Gemini model available/i.test(raw)) return 'Clave de API de Gemini caducada o inválida. Ve a aistudio.google.com, genera una nueva clave y actualízala en Vercel → Settings → Environment Variables (GEMINI_API_KEY).'
  if (/quota|rate.?limit|429/i.test(raw)) return 'Demasiadas peticiones a la IA. Espera un minuto y vuelve a intentarlo.'
  if (/503|overload|unavailable|high demand/i.test(raw)) return 'El servicio de IA está saturado. Inténtalo de nuevo en unos segundos.'
  if (/timeout|abort/i.test(raw)) return 'La IA tardó demasiado en responder. Vuelve a intentarlo con un archivo más pequeño si persiste.'
  if (/SAFETY|BLOCK|finishReason/i.test(raw)) return 'La IA bloqueó la respuesta por filtros de seguridad. Revisa el documento.'
  if (/No content/i.test(raw)) return 'La IA devolvió una respuesta vacía. Vuelve a intentarlo.'
  return raw
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PROMPTS                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

const INVOICE_PROMPT = `### ROL
Actúa como un Auditor Energético Senior especializado en el mercado español (OMIE/REE).
Tu misión es convertir imágenes/PDFs de facturas en un objeto JSON puro, resolviendo discrepancias matemáticas y normalizando conceptos.
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

0. **CUPS (MANDATORIO — MÁXIMA PRIORIDAD):**
   - El CUPS (Código Universal de Punto de Suministro) SIEMPRE empieza por "ES".
   - FORMATO EXACTO — hay dos variantes válidas:
     * CORTO (20 chars): ES + 16 dígitos + 2 letras mayúsculas de control. Ejemplo: "ES0021000012345678AB"
     * LARGO (22 chars): ES + 16 dígitos + 2 letras mayúsculas + 2 chars de sufijo alfanumérico. Ejemplo: "ES0021000006597248MV0F"
   - ⚠️ CRÍTICO: Si ves un CUPS que termina en letras seguidas de más caracteres (p.ej. "MV0F", "AA1B"), DEBES incluir TODOS los caracteres hasta el final. NUNCA cortes el CUPS a mitad del sufijo.
   - ⚠️ VERIFICACIÓN DE LONGITUD: Cuenta los caracteres del CUPS que has extraído. Si el resultado tiene 19 o 21 caracteres, es INCORRECTO (faltan caracteres). Vuelve a leer el documento y extrae el CUPS completo.
   - UBICACIÓN VISUAL — Escanea TODO el documento, no solo la cabecera. El CUPS puede aparecer en CUALQUIERA de estas zonas:
     * Cabecera/datos del suministro (zona superior)
     * Sección "DATOS DEL CONTRATO" o "INFORMACIÓN DEL CONTRATO" (frecuente en la parte inferior)
     * Sección "Datos del punto de suministro"
     * Pie de página o reverso de la factura
     * Junto al texto "Código unificado de punto de suministro", "CUPS", "Punto de suministro", "Contrato de acceso"
     * Debajo del nombre del titular, CIF o dirección de suministro
   - ERRORES COMUNES OCR: No confundas "0" (cero) con "O" (letra), ni "1" con "l". Los 16 caracteres centrales son SIEMPRE DÍGITOS.
   - Si hay VARIOS CUPS en el documento (ej: factura resumen multi-punto), extrae el CUPS PRINCIPAL del punto de suministro facturado.
   - NUNCA inventes un CUPS. Si no lo encuentras claramente después de revisar TODO el documento, deja el campo vacío.

1. **DATOS DE TITULAR Y SUMINISTRO (MANDATORIO):**
   - holder_name: nombre EXACTO del titular tal como aparece (ej: "AYUNTAMIENTO DE AOIZ", no "Ayuntamiento").
   - holder_cif_nif: CIF o NIF del titular tal como aparece.
   - supply_address: DIRECCIÓN COMPLETA del punto de suministro (calle, número, CP, municipio).
   - comercializadora: nombre EXACTO de la empresa emisora de la factura (Naturgy, Endesa, Galp, TotalEnergies, Axpo, Iberdrola, Repsol, EDP, Holaluz, Audax, etc.). OBLIGATORIO — siempre está impreso en la factura (logo, cabecera o pie de página).
   - tariff: tarifa exacta (2.0TD, 3.0TD, 6.1TD, RL.1, RL.2, etc.).

2. **FACTURAS DE ANULACIÓN / ABONOS:** Si la factura es rectificativa o abono, devuelve TODOS los valores en NEGATIVO.

════════════════════════════════════════════════════════════════════════════
REGLAS ESPECÍFICAS PARA FACTURAS DE ELECTRICIDAD
════════════════════════════════════════════════════════════════════════════

⚠️ REGLA ABSOLUTA — NO OMITAS NINGUNA LÍNEA DE LA TABLA DE LA FACTURA ⚠️

Las facturas españolas 2.0TD / 3.0TD / 6.1TD (RD 148/2021) tienen una tabla con
20+ líneas. CADA LÍNEA de esa tabla DEBE aparecer en "rawLineItems" del JSON de
salida, SIN EXCEPCIÓN. Si dudas de cómo clasificarla, ponla con category="otro"
pero NUNCA la omitas. La suma de TODOS los rawLineItems (sin IVA) debe dar el
"Total Bruto" impreso; con IVA debe dar el "Total Factura" impreso.

LUZ-0. **rawLineItems — CAMPO OBLIGATORIO (LUZ Y GAS):**
   Devuelve un array "rawLineItems" con UN objeto por cada línea de la tabla de
   conceptos de la factura. Formato de cada objeto:
     {
       "description": "texto literal de la línea",
       "category": <ver lista exhaustiva abajo>,
       "periodo": "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | null,
       "kwh": <número o null>,
       "kw": <número o null>,
       "dias": <número o null>,
       "precioUnitario": <número o null>,
       "total": <número sin IVA>
     }

   Categorías válidas (usa EXACTAMENTE una de estas):
   LUZ:
     energia_comercializacion | energia_peaje | energia_cargo
     potencia_peaje | potencia_cargo | potencia_comercializacion
     alquiler_equipos | bono_social | compensacion_excedentes
     impuesto_electrico | exceso_potencia | descuento_energia | descuento_potencia
   GAS:
     gas_termino_variable  (Consumo gas / Término de energía / kWh × €/kWh)
     gas_termino_fijo      (Término fijo / Cuota de servicio — cuota diaria × días)
     gas_peaje_fijo        (Peaje red local/transporte FIJO, Peaje RL.x fijo)
     gas_peaje_variable    (Peaje red local/transporte VARIABLE, sobre kWh)
     gas_cargo             (Cargos regulados gas)
     gas_regasificacion    (Regasificación, a veces con signo negativo)
     gas_cuota_gts         (Cuota Gestor Técnico del Sistema)
     gas_tasa_cnmc         (Tasa CNMC)
     gas_aportacion_fondo  (Aportación Fondo Nacional Eficiencia Energética)
     impuesto_hidrocarburos (Impuesto Especial sobre Hidrocarburos)
   COMUNES:
     alquiler_equipos | descuento_energia | iva | otro

   Guía de clasificación (LUZ):
   - "Energía Precio horario" / "Término de energía" / "Coste energía" / "Coste mercado"
     / "Total Coste de Energía Producto" → energia_comercializacion. Puede venir como
     UN flat (periodo=null) Iberdrola/Endesa, o como 1 línea POR PERIODO ya consolidada
     (ACCIONA, CIDE): en ese caso emite una entrada POR PERIODO con kwh y total del periodo.
   - "Energía facturada peajes P1/.../P6" → energia_peaje, con periodo
   - "Energía facturada cargos P1/.../P6" → energia_cargo, con periodo
   - "Total término de Potencia" / "Potencia facturada peajes/cargos" → si aparece
     consolidada por periodo, emítela como potencia_comercializacion con periodo, kw, dias.
     Si aparece desglosada en peaje+cargo, emite ambas líneas por cada periodo.
   - "Alquiler de equipos de medida" / "Alquiler contador" → alquiler_equipos
   - "Financiación bono social" / "Bono social" → bono_social
   - "Compensación de excedentes" / "Energía excedentaria" / "Autoconsumo" → compensacion_excedentes (negativo si resta)
   - "Impuesto sobre la electricidad" / "Impuesto eléctrico" → impuesto_electrico
   - "Exceso de potencia" / "Penalización reactiva" / "Total excesos de Potencia" → exceso_potencia
   - "IVA" / "IGIC" → iva
   - Cualquier otra línea que no encaje → otro (NO la omitas)

   Guía de clasificación (GAS — típico Iberdrola, Naturgy, Axpo, Endesa):
   - "Consumo gas" / "Término variable" / "Término de energía" (kWh × €/kWh) → gas_termino_variable
   - "Término fijo" / "Cuota de servicio" (días × €/día) → gas_termino_fijo
   - "Peaje Red Local Fijo" / "Peaje Transporte Fijo" / "Peaje RL.x fijo" → gas_peaje_fijo
   - "Peaje Variable" / "Peaje Red Local Variable" → gas_peaje_variable
   - "Cargos" / "Cargo regulado gas" → gas_cargo
   - "Regasificación" → gas_regasificacion (puede ser negativo)
   - "Cuota GTS" / "Gestor Técnico del Sistema" → gas_cuota_gts
   - "Tasa CNMC" → gas_tasa_cnmc
   - "Aportación Fondo Nacional de Eficiencia Energética" → gas_aportacion_fondo
   - "Impuesto Especial sobre Hidrocarburos" → impuesto_hidrocarburos
   - "Alquiler de contador" → alquiler_equipos
   - IVA → iva

⚠️ LUZ-0-TRAMPA. **"De los cuales peajes y cargos" son INFORMATIVOS — NO EMITIR:**
   Muchas facturas (ON510, Som Energia, algunas Endesa) muestran debajo de cada línea
   de periodo un sub-desglose indicando "De los cuales peajes y cargos: X,XX €". Estas
   líneas son DESGLOSE INFORMATIVO, no son cargos adicionales — el importe YA está
   incluido en la línea padre. NO las emitas como rawLineItems separados; eso
   causaría doble conteo. Solo emite la línea principal del periodo.

⚠️ LUZ-0-CONSOLIDADA. **Facturas con energía/potencia CONSOLIDADA por periodo (ACCIONA, 6.1TD):**
   Algunas comercializadoras (típicamente en 6.1TD: ACCIONA, Endesa empresas) no
   muestran el desglose peajes+cargos línea por línea, sino UNA cifra total por
   periodo. Ejemplo ACCIONA:
     "Total Coste de Energía Producto P2: 31.231 kWh → 4.115,34 €"
     "Total Coste de Energía Producto P3: 20.806 kWh → 2.298,03 €"
     "Total Coste de Energía Producto P6: 43.507 kWh → 4.062,26 €"
   En ese caso emite UNA línea energia_comercializacion POR PERIODO con kwh y total
   del periodo (periodo="P2", kwh=31231, total=4115.34). Los kWh pueden venir en una
   fila aparte ("Energía Activa consumida P2 31.231 kWh") — cruza ambas filas y
   consolida en un único rawLineItem por periodo.
   Lo mismo para potencia: si ves "Total término de Potencia P1 ... €" consolidado,
   emite potencia_comercializacion con periodo, kw, dias, total.

LUZ-0b. **VERIFICACIÓN MATEMÁTICA OBLIGATORIA sobre rawLineItems:**
   Antes de emitir el JSON, calcula:
     A = Σ total de rawLineItems con category !== "iva"
     B = Σ total de rawLineItems con category === "iva"
     C = A + B
   Si C difiere del "Total a Pagar" impreso en más de 0,05 €, RE-ESCANEA la
   factura buscando líneas omitidas y corrige rawLineItems hasta que cuadre.

LUZ-0c. **CÓMO RECONOCER EL DESGLOSE PEAJES+CARGOS (muy común):**
   Las facturas 3.0TD/6.1TD tienen típicamente 12 líneas de potencia (6 peajes + 6 cargos)
   y 6–12 líneas de energía (6 peajes + 6 cargos + opcional 1 flat de comercialización).
   Si solo ves 1–2 líneas de potencia en una factura 3.0TD, te has dejado el resto.

LUZ-1. **Campos derivados consumo[] y potencia[] (CASO A y CASO B):**
   Además de rawLineItems, devuelve los arrays agregados consumo[] y potencia[].

   CASO A (Precio Fragmentado — MUY COMÚN en facturas 3.0TD/6.1TD):
     Si el precio de energía de un periodo está dividido en componentes separados
     (ej: "Término Energía Tarifa Acceso", "Término Cargos Energía Acceso",
     "Término Energía Variable"), SÚMALOS en un único precioKwh por periodo.
     Ejemplo factura TotalEnergies P2:
       Peaje:   4241 kWh × 0,012343 = 52,35 €
       Cargo:   4241 kWh × 0,024066 = 102,06 €
       Variable: 4241 kWh × 0,108300 = 459,30 €
       → precioKwh CONSOLIDADO = 0,012343 + 0,024066 + 0,108300 = 0,144709 €/kWh
       → total = 52,35 + 102,06 + 459,30 = 613,71 €
     En rawLineItems sí emite las 3 líneas separadas (peaje, cargo, variable).
     En consumo[] emite UNA entrada por periodo con el precioKwh SUMADO y total SUMADO.

   CASO B (Precio Faltante):
     Si falta el precio unitario pero tienes Total y kWh, calcula:
       precioKwh = TotalPeriodo / kWh.
     Si hay un precio fijo único, aplícalo a todos los periodos facturados.

LUZ-2. **POTENCIA — kW contratados por periodo y precioKwDia:**
   Extrae kW contratados y coste total por periodo. Si potencia está fragmentada en
   "Término Potencia Tarifa Acceso" + "Término Cargos Potencia Acceso", súmalos en
   potencia[] con el total combinado. En rawLineItems emite ambas líneas por separado.

   ⚠️ PRECIO DE POTENCIA: el campo precioKwDia SIEMPRE debe expresarse en €/kW·DÍA.
   Hay tres formatos posibles — detéctalos por el valor numérico y la unidad:

   FORMATO A — Precio diario explícito (más común, valor pequeño < 1):
     "P1  260 kW × 0,078882 €/kW·día × 30 días = 615,28 €"
     "P1  260 kW × 0,078882 €/kW × (30/365) días = 615,28 €"
     → precioKwDia = 0.078882  (ya es diario — úsalo directamente)
     → dias = 30
     → verificación: 260 × 0.078882 × 30 = 615.28 ✓
     Nota: en la notación (30/365) el precio sigue siendo diario; días = el numerador (30).

   FORMATO B — Precio anual explícito (valor grande > 5, unidad €/kW·año o €/kW/año):
     "P1  260 kW × 28,79 €/kW·año × (30/365) = 614,96 €"
     "P1  260 kW × 28,79 €/kW/año × 30 días"
     → precioKwDia = 28.79 / 365 = 0.078877  (DIVIDE por 365 para convertir a diario)
     → dias = 30
     → verificación: 260 × (28.79/365) × 30 = 614.96 ✓

   FORMATO C — Sin precio unitario, solo total:
     → precioKwDia = total / (kw × dias)

   REGLA DE ORO para distinguir A de B:
     - Si el precio tiene unidad €/kW·día o €/kW·dia → formato A (diario, no dividas)
     - Si el precio tiene unidad €/kW·año, €/kW/año, €/kW·year → formato B (anual, divide /365)
     - Si no hay unidad pero el valor es < 2 → probablemente diario (formato A)
     - Si no hay unidad pero el valor es > 5 → probablemente anual (formato B, divide /365)
     - SIEMPRE verifica: total ≈ kw × precioKwDia × dias (donde precioKwDia ya es diario)

   CASO peajes + cargos separados:
     Si potencia viene en dos líneas (peaje + cargo) con el mismo periodo, suma ambos totales
     en potencia[] (precioKwDia = suma de ambos precioUnitario_diario, total = suma de totales).
     En rawLineItems emite las dos líneas por separado.

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
   - AUTOCONSUMO: Si aparece "Energía Excedentaria" / "Compensación de excedentes",
     extráelo como rawLineItem con category="compensacion_excedentes" y valor NEGATIVO.

LUZ-5. **AUDITORÍA DE POTENCIA INDUSTRIAL:**
   - Busca "Resumen de Factura" o "Detalle de Potencia".
   - costeTotalPotencia = SOLO el término fijo por potencia contratada.
   - CUALQUIER penalización/exceso de potencia DEBE ir a otrosConceptos como 'EXCESO DE POTENCIA'.

LUZ-6. **BUCLE DE AUDITORÍA INTERNA (REGLA DE ORO — ejecuta ANTES de responder):**
   Este proceso mental es OBLIGATORIO. No respondas hasta que el error sea cero:

   1. Extrae visualmente el "Total a Pagar" / "Total con Impuestos" del documento.
   2. Suma: (costeNetoConsumo) + (costeTotalPotencia) + Σ(otrosConceptos incluyendo IE, alquiler, IVA).
   3. Compara: si la diferencia con el total impreso es > 0,05€, busca el concepto que falta
      (ej: recargos por reactiva, financiación bono social, SRAD, otros) y CORRÍGELO.
   4. NO TE DETENGAS hasta que el error sea cero.
   5. Valida costeTotalPotencia ≈ suma de TODAS las líneas de potencia (peajes + cargos).
      En facturas 3.0TD/6.1TD debe haber 12 líneas de potencia (6 peajes + 6 cargos).
      Si solo has capturado 1–2, re-escanea.
   6. Valida Σ kwh de consumo[] = consumoTotalKwh. Si no cuadra, probablemente
      confundiste el flat "Precio horario" con P1.
   7. Valida que Σ total de rawLineItems (sin IVA) ≈ Base Imponible, y con IVA ≈ Total Factura.

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
BASE DE CONOCIMIENTO — ASESORÍA ENERGÉTICA ESPAÑA (V2.0)
════════════════════════════════════════════════════════════════════════════
Esta sección contiene el conocimiento de un asesor energético senior para
resolver ambigüedades. Aplica estas reglas ANTES de emitir el JSON final.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A. IDENTIFICACIÓN DE COMERCIALIZADORA Y SUS PATRONES PROPIOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A1. IBERDROLA / i-DE:
   - Energía: UN flat "Energía Precio horario X.XXX kWh × 0,XXXXXX €/kWh"
     → energia_comercializacion, periodo=null. NO confundas ese total flat con P1.
   - Debajo de la energía flat aparecen por separado peajes/cargos POR PERIODO:
     "Energía facturada peajes P1 1.080 kWh × 0,028528 €/kWh" → energia_peaje
     "Energía facturada cargos P1 1.080 kWh × 0,032503 €/kWh" → energia_cargo
   - Potencia: siempre desglosada en peaje+cargo por cada uno de los 6 periodos (3.0TD) o 2 periodos (2.0TD).
   - No hay "subtotal energía" intermedio — ve directo al flat + peajes/cargos.
   - IVA siempre 21% para Península, IGIC 7% para Canarias.
   - Bono social: línea "Financiación Bono Social Fijo" → bono_social (cargo positivo, no crédito).
   - SRAD (Servicio de Recarga Auto Día): si aparece, → otro.

A2. ENDESA / e-distribución:
   - 3.0TD empresarial: puede mostrar la energía como SUMA por periodo consolidada
     "Coste Energía P1 = X kWh × Y €/kWh = Z €" → cada periodo → energia_comercializacion.
   - También puede mostrar el clásico flat de comercialización + peajes separados.
   - Siempre verifica si hay "Ajuste por desvíos" o "Desvíos de energía" → otro.
   - Facturas domésticas 2.0TD: pueden incluir "Precio Fijo de Energía" (mercado libre)
     o tarifas horarias P1/P2 (PVPC o discriminación horaria). Consulta sección D.

A3. NATURGY / UnionFenosa:
   - Formato similar a Iberdrola pero con peajes/cargos a veces consolidados.
   - "Acceso a redes" = suma de peajes + cargos. Si viene así, clasifica como
     energia_peaje el tramo de peaje y energia_cargo el tramo de cargos.
   - Gas: "Término Variable" = gas_termino_variable, "Término Fijo" = gas_termino_fijo.
   - Puede tener "Financiación del Bono Social de Gas" → bono_social (positivo, cargo).
   - "Tasa CNMC" → gas_tasa_cnmc, "Cuota del GTS" → gas_cuota_gts.

A4. REPSOL / Respol LUZ y GAS:
   - Formato compacto. Energía a veces en tabla única con columnas P1–P6.
   - Si la tabla muestra "Término de energía" con un precio único para todos los periodos
     y luego "Peajes y cargos de energía" también como único concepto → suma ambos como
     costa bruta de consumo total; distribúyelos en rawLineItems por categoría.
   - Frecuentemente incluye descuento en % ("Descuento comercial X%") → descuento_energia.

A5. EDP / Hidrocantábrico:
   - Similar a Naturgy pero puede tener "Término de Potencia Acceso" consolidado.
   - A veces la potencia viene como "kW × días × €/kW·día" en una sola línea por periodo.
   - En facturas 3.0TD puede haber un "Total Potencia P1" que agrupa peaje+cargo.
     Si ves un solo importe por periodo de potencia, clasifica como potencia_comercializacion.

A6. TOTALENERGIES / GDF Suez:
   - Usa el formato clásico desglosado (peaje + cargo + comercialización por periodo).
   - Puede incluir "Prima de reserva de capacidad" → otro.
   - "Ajuste por reactiva" o "Energía reactiva" → exceso_potencia (penalización).

A7. ACCIONA / CIDE / Som Energia / Facturas 6.1TD consolidadas:
   - No muestran peajes/cargos por separado sino un "Total coste energía P2 = X€".
   - Ves las lecturas (kWh por periodo) y el coste total del periodo como un bloque.
   - Debes emitir energía como energia_comercializacion con periodo, kwh y total del periodo.
   - Para potencia: "Total potencia P1 = kW × días × €/kW·día" → potencia_comercializacion.

A8. AUDAX / HOLALUZ / FACTOR ENERGÍA / ESCANDINAVA:
   - Formatos muy variables, frecuentemente solo UN precio de energía (libre).
   - Si no ves desglose peajes/cargos, puede ser que la comercializadora los incluya
     en su precio comercial. En ese caso todo va a energia_comercializacion.
   - Verifica que la suma cuadre con el total.

A9. SWAP ENERGÍA / SWAP ENERGIA:
   - Comercializadora libre española. Facturas en español con diseño en dos páginas.
   - CUPS y datos del contrato suelen aparecer en la SEGUNDA PÁGINA bajo el título
     "DATOS DEL CONTRATO" o similar — busca en TODA la imagen, no solo en la cabecera.
   - Tarifa 3.0TD habitual: 6 periodos de potencia (P1–P6) y 6 periodos de energía.
   - Potencia: todos los periodos suelen tener la misma potencia contratada (ej. 69 kW).
   - Energía: desglosada por periodo (P1/P2/P3/P4/P5/P6) en kWh y €/kWh.
   - El precio de la energía suele mostrarse como "Término de energía Px = Y kWh × Z €/kWh".
   - Si la factura tiene 2 páginas enviadas como imágenes separadas y estás viendo solo
     una, extrae lo que puedas — el CUPS puede estar en la página no visible.
   - Totales: "Total base imponible", "IVA 21%", "Total factura" o "Total a pagar".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
B. PVPC VS. MERCADO LIBRE — CÓMO DISTINGUIRLOS Y EXTRAER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

B1. PVPC (Precio Voluntario al Pequeño Consumidor — tarifa regulada):
   - Indicadores: "PVPC", "Precio regulado", "Tarifa de Último Recurso (TUR)", "BOE".
   - Los precios varían hora a hora. La factura muestra un precio medio del periodo.
   - En la factura: "Término de energía PVPC X.XXX kWh × Y €/kWh" → energia_comercializacion.
   - Con discriminación horaria 2.0DHA: P1 (punta), P2 (llano/valle) distintos precios.
   - costeBrutoConsumo = el importe del término de energía ANTES de impuestos.
   - IVA en PVPC puede ser temporal 5% o 10% en períodos de crisis energética (2022–2023).
     A partir de 2024 vuelve a 21%. Extrae el IVA que aparezca, no asumas siempre 21%.

B2. MERCADO LIBRE:
   - Precio fijo pactado con la comercializadora.
   - Puede ser un único precio por kWh o diferenciado por periodos.
   - Si ves precios de energía diferentes por periodo Y no es PVPC, es mercado libre.
   - Los descuentos comerciales (tipo "5% descuento en energía") son típicos del mercado libre.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
C. CUÁL "TOTAL" USAR EN CASOS AMBIGUOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

C1. JERARQUÍA DE TOTALES (usa en este orden de prioridad):
   1. "Total a Pagar" / "Importe Total" / "Total con Impuestos" → totalFactura (SIEMPRE este).
   2. Si solo ves "Base Imponible" → es el total SIN IVA. totalFactura = base + IVA.
   3. Si hay "Subtotal" y "Total" distintos → usa el "Total" final después de IVA.

C2. FACTURAS CON VARIOS BLOQUES:
   - Algunas facturas tienen un bloque "Consumo estimado" y otro "Regularización".
     Suma AMBOS para obtener totalFactura final. Suma también kWh de ambos bloques.
   - Si hay "Abono anterior" o "Ajuste de lectura" → puede restar del total. Inclúyelo.

C3. REDONDEOS Y DESCUENTOS GLOBALES:
   - Si hay "Redondeo" o "Descuento por pronto pago" sobre el total final → inclúyelo
     como rawLineItem category="otro" y réstalo si es negativo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
D. TRATAMIENTO DE DESCUENTOS — REGLAS DE CLASIFICACIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

D1. DESCUENTO ENERGÍA (category: descuento_energia, total: NEGATIVO):
   - "Descuento comercial X% sobre término de energía" → descuento_energia.
   - "Bonificación por consumo" / "Dto. consumo" → descuento_energia.
   - "Descuento precio fijo garantizado" → descuento_energia.
   - SIEMPRE guarda el total como valor NEGATIVO o positivo pero al calcular
     descuentoEnergia en economics usa el VALOR ABSOLUTO.

D2. DESCUENTO POTENCIA (category: descuento_potencia):
   - "Descuento sobre potencia contratada" → descuento_potencia.
   - Este descuento reduce costeTotalPotencia, NO aparece en otrosConceptos.

D3. DESCUENTO SOBRE FACTURA COMPLETA:
   - "Descuento por domiciliación" / "Dto. cliente fidelizado" aplicado al total:
     Si solo hay un importe global sin especificar a qué se aplica → descuento_energia
     como aproximación conservadora (afecta el término energético).
   - Si viene desglosado en energía + potencia → separa en descuento_energia y descuento_potencia.

D4. COMPENSACIÓN DE EXCEDENTES (autoconsumo):
   - "Energía excedentaria compensada" / "Autoconsumo vertido" → compensacion_excedentes.
   - Total NEGATIVO (resta de la factura). No confundas con descuento.
   - Extrae el kWh vertido y el precio de compensación si aparecen.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E. POTENCIA — CASOS ESPECIALES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

E1. POTENCIA CONTRATADA vs FACTURADA vs EXCEDIDA:
   - "Potencia contratada P1: 15 kW" → es un dato informativo, NO lo emitas como coste.
   - "Potencia facturada P1: 15,00 kW × 31 días × 0,040 €/kW·día = 18,60 €" → SÍ es un coste.
   - Si facturada ≠ contratada, la comercializadora ha aplicado potencia máxica (maxímetro).
   - "Maxímetro" / "Potencia máxica" / "Potencia medida" > contratada → la diferencia
     de coste va a otrosConceptos como 'EXCESO DE POTENCIA'.

E2. EXCESO DE POTENCIA — DETECCIÓN:
   - "Exceso de potencia P1" / "Penalización por exceso" / "Método cuarto-horario" → exceso_potencia.
   - El exceso suele calcularse como 2× el precio de la potencia del exceso detectado.
   - Si ves "Potencia Reactiva" / "Energía reactiva" / "cos φ" → es una penalización
     por bajo factor de potencia. Clasifica como exceso_potencia.
   - Cuando aparece TANTO "Exceso de potencia P1 (puntas)" COMO "Exceso de potencia P1 (método
     cuarto-horario)", son el MISMO concepto expresado de dos maneras → emite SOLO UNO con
     el mayor importe (evita doble conteo).

E3. TARIFA 2.0TD (doméstica — reforma tarifaria 2021, sustituye a 2.0A/2.0DHA/2.1A/2.1DHA):
   - Potencia: P1 (punta) y P2 (valle). El kW contratado suele ser el mismo en ambos.
   - Energía: el término de energía puede presentarse en 4 formatos distintos. DETECTA el
     formato y aplica la lógica correspondiente. Añade "energyPricingFormat" al JSON.

   ══ CASO 1 — Precio único (tarifa plana) ══════════════════════════════
   Detección: solo hay UN precio €/kWh para toda la energía, sin distinción de franjas.
   Acción: pon ese precio en P1. En consumo[] emite UNA entrada P1 con todo el kWh.
   rawLineItems: category = "energia_comercializacion", periodo = "P1".
   energyPricingFormat = "precio_unico"

   ══ CASO 2 — Precios por período explícitos (P1/P2 o P1/P2/P3) ════════
   Detección: la factura desglosa precios distintos por P1, P2 (y quizás P3).
   Palabras clave: "P1", "P2", "Punta", "Valle", "Llano".
   Acción: asigna cada precio directamente a su período. NO calcules nada.
   rawLineItems: periodo = "P1" / "P2" / "P3" según la factura.
   energyPricingFormat = "por_periodo"

   ══ CASO 3 — Horas promocionadas / No promocionadas ═══════════════════
   Detección: aparecen los términos "Horas promocionadas" y "Horas no promocionadas"
   (Iberdrola "Plan Elige X horas" y similares). Hay DOS franjas con precios distintos.
   Nomenclatura:
     "Horas NO promocionadas" → category="energia_no_promocionada"  (precio caro, pocas horas)
     "Horas promocionadas"    → category="energia_promocionada"     (precio barato, más horas)
   Acción: emite AMBAS líneas en rawLineItems con sus kWh y precio exactos tal como
   aparecen en la factura. NO calcules la media aquí — el CRM lo hace.
   En consumo[] emite DOS entradas: periodo="P1" (no promoc.) y periodo="P2" (promoc.).
   Usa los kWh y el precioKwh tal como aparecen en cada franja.
   energyPricingFormat = "promocionadas"

   Ejemplo (Iberdrola): "28,69 kWh × 0,261846 €/kWh" (no promoc.) + "83,31 kWh × 0,143935 €/kWh" (promoc.)
   → rawLineItems: [{category:"energia_no_promocionada", kwh:28.69, precioUnitario:0.261846, total:7.51},
                    {category:"energia_promocionada",    kwh:83.31, precioUnitario:0.143935, total:11.99}]
   → consumo: [{periodo:"P1", kwh:28.69, precioKwh:0.261846, total:7.51},
               {periodo:"P2", kwh:83.31, precioKwh:0.143935, total:11.99}]

   energyPricingFormat = "promocionadas"

   ══ NOTA POTENCIA en 2.0TD ═══════════════════════════════════════════
   - La potencia siempre tiene P1 (punta) y P2 (valle) con el mismo kW contratado.
   - Si la factura solo muestra UN kW y un precio: ese kW aplica a P1 y P2.
   - Si muestra DOS kW (pueden ser iguales): P1=punta, P2=llano/valle.

E4. TARIFA 3.0TD (pequeña/mediana empresa):
   - 6 periodos de potencia y 6 de energía. kW contratado puede ser diferente por periodo.
   - P1 (punta), P2 (llano alto), P3 (llano bajo), P4 (valle alto), P5 (valle bajo), P6 (supervalle nocturno).
   - En verano P1/P2/P3 se desplazan. La factura siempre indica qué periodo es cuál.

E5. TARIFA 6.1TD y superiores (gran empresa):
   - Igual que 3.0TD pero con límites de potencia mayores (>15 kW en algún periodo).
   - Puede tener facturación por "Término de Inspección" (SRAD) → otro.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
F. IVA E IMPUESTOS — REGLAS ESPECÍFICAS ESPAÑA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

F1. IVA ELECTRICIDAD (España peninsular):
   - Tipo general: 21%. Temporal reducción 5% o 10% durante crisis energética 2022–2023.
   - Canarias / Ceuta / Melilla: IGIC 7% (o 3% para colectivos específicos), NO IVA.
   - La BASE del IVA = costeBrutoConsumo + costeTotalPotencia + impuestoEléctrico
     + alquilerEquipos + bonoSocial + otrosConceptos (SIN contar el propio IVA).
   - Si la base imponible no cuadra con la suma de conceptos, probablemente hay un
     concepto no extractado. RE-ESCANEA.

F2. IMPUESTO SOBRE LA ELECTRICIDAD (IE — antes "Impuesto Eléctrico"):
   - Tipo: 5,11269% sobre la base del IE (que es ≈ energía + potencia + alquiler + bono social).
   - NUNCA apliques el IE sobre el IVA, ni viceversa.
   - Algunos años (2022–2023) se redujo temporalmente al 0,5%. Extrae el porcentaje impreso.
   - La base del IE se calcula ANTES de IVA. Si ves "IE 5,11% s/ 812,92" → base = 812,92.

F3. GAS — IMPUESTO ESPECIAL SOBRE HIDROCARBUROS (IEH):
   - Se expresa en €/GJ o €/kWh. Ejemplo: "IEH 0,00234 €/kWh × 2.450 kWh = 5,73 €".
   - La base del IVA en gas incluye término variable + término fijo + IEH + alquiler.
   - IVA del gas = 21% general. En períodos de crisis puede haber reducciones.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
G. FACTURAS ESTIMADAS, AJUSTES Y TIPOS ESPECIALES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

G1. FACTURA ESTIMADA ("E" en lectura):
   - Si ves "Lectura estimada" o una "E" junto a la lectura, el consumo es estimado.
   - Extrae los kWh indicados igualmente. El consumo real se regularizará en la siguiente.
   - consumoTotalKwh = kWh estimados facturados.

G2. FACTURA DE REGULARIZACIÓN / LIQUIDACIÓN:
   - Suele venir con dos bloques: un periodo estimado (negativo, abono) + periodo real.
   - totalFactura = suma neta de TODOS los conceptos incluyendo el abono.
   - Puede resultar negativa (abono puro). En ese caso TODOS los valores negativos son correctos.

G3. FACTURA DE COMPLEMENTO / AJUSTE DE ACCESO:
   - "Factura complementaria de acceso" / "Ajuste de peajes" → extraer IGUAL que factura normal.
   - Puede tener importes negativos (devolución de peajes) o positivos (cargo adicional).
   - Identifica si es solo ajuste de peajes o incluye también comercialización.

G4. FACTURA RESUMEN (MULTI-PUNTO):
   - Si una sola factura cubre varios CUPS → extrae el CUPS principal del suministro.
   - totalFactura = total del punto de suministro facturado (no el global multi-punto).
   - Si no puedes distinguir cuál es el principal, extrae el primer CUPS que aparezca.

G5. FACTURA DE ANULACIÓN / ABONO:
   - "Nota de crédito" / "Factura rectificativa" / "Abono factura Nº XXXXXX" → todos los importes en NEGATIVO.
   - El titular, CUPS y periodo son los de la factura original que se anula.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
H. PRECIOS DESGLOSADOS — CÓMO CONSOLIDAR EN UN PRECIO REPRESENTATIVO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

H1. precioKwh EN consumo[] (precio neto representativo por periodo):
   - Para un asesor energético el precio útil es el €/kWh ALL-IN del periodo:
       precioKwh = (peaje_energia_P1 + cargo_energia_P1 + comercializacion_P1) / kWh_P1
   - Si hay descuento global, aplícalo proporcionalmente:
       precioKwhNeto = precioKwhBruto × (costeTotalConsumo / costeBrutoConsumo)
   - Cuando el precio de la comercializadora es un flat (no por periodo), prorratéalo
     por kWh: prorrateado_P1 = (flat_total × kWh_P1) / totalKWh.

H2. costeMedioKwhNeto — LA MÉTRICA CLAVE DEL ASESOR:
   - costeMedioKwhNeto = costeNetoConsumo / consumoTotalKwh.
   - Este precio incluye peajes, cargos y comercialización pero NO incluye potencia,
     impuestos ni alquiler. Es el precio "puro de la energía consumida".
   - Rango habitual España 2024: 0,08 – 0,22 €/kWh. Si obtienes un valor fuera de este
     rango, probablemente hay un error en la extracción (doble conteo o campo faltante).
   - Para gas: rango habitual 2024: 0,04 – 0,12 €/kWh.

H3. SEÑALES DE ALARMA — VALORES FUERA DE RANGO:
   - costeMedioKwhNeto > 0,35 €/kWh → doble conteo (peajes + cargos + plano = triple).
   - costeTotalPotencia > totalFactura × 0,6 → probablemente potencia mal extraída.
   - consumoTotalKwh < 1 → OCR fallido o unidades incorrectas (puede ser MWh → × 1000).
   - totalFactura < 1 € → posible error de punto/coma decimal.
   - descuentoEnergia > costeBrutoConsumo → imposible, revisa.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
I. BONO SOCIAL — CARGO O CRÉDITO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I1. FINANCIACIÓN DEL BONO SOCIAL (cargo para todos los consumidores):
   - "Financiación Bono Social Fijo" / "Coste bono social" → bono_social, total POSITIVO.
   - Todos los consumidores pagan esto para financiar las tarifas sociales.
   - Rango habitual: 0,20–2,00 €/mes según tarifa y días.

I2. DESCUENTO DEL BONO SOCIAL (beneficio para consumidores vulnerables):
   - "Descuento Bono Social X%" / "Bono Social aplicado" → es un descuento, total NEGATIVO.
   - Solo aparece en facturas de consumidores acogidos al Bono Social.
   - En rawLineItems: category="descuento_energia", total negativo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
J. LECTURA DE CONTADORES Y VALIDACIÓN DE kWh
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

J1. LECTURA ACTUAL − LECTURA ANTERIOR = kWh FACTURADOS:
   - Si ves lecturas de contador, verifica: (actual − anterior) × multiplicador = kWh P1.
   - Multiplicador típico para contadores de BT: 1. Para MT: puede ser 4, 40, 400, etc.
   - Si la diferencia de lecturas no cuadra con el kWh de la factura → puede haber
     estimación o corrección de lecturas anteriores.

J2. MWh vs kWh:
   - Algunos contadores en alta tensión miden en MWh. Si ves "consumo: 45,23 MWh" en
     vez de kWh, convierte: 45,23 MWh × 1000 = 45.230 kWh.
   - El precio por kWh en MT suele ser 10–30× menor que en BT porque ya no incluye
     costes de distribución de baja tensión.

J3. ENERGÍA REACTIVA:
   - "kVArh", "cos φ", "factor de potencia" → energía reactiva (no activa).
   - No incluyas kVArh en consumoTotalKwh (que es solo kWh activos).
   - La penalización por reactiva sí va en otrosConceptos como 'EXCESO DE POTENCIA'.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
K. GAS NATURAL — CONOCIMIENTO ADICIONAL DE ASESOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

K1. TARIFAS DE GAS EN ESPAÑA:
   - RL.1: consumo < 5.000 kWh/año (doméstico básico).
   - RL.2: consumo 5.000 – 50.000 kWh/año (doméstico alto / PYME pequeña).
   - RL.3: consumo 50.000 – 100.000 kWh/año (mediana empresa).
   - 3.1, 3.2, 3.3: industrial.
   - La tarifa determina el peaje regulado y los cargos aplicables.

K2. CONVERSIÓN m³ → kWh:
   - Algunas facturas muestran el consumo en m³ con un factor de conversión.
   - kWh = m³ × factor calórico × factor de compresión (Z). Típico: 1 m³ ≈ 11 kWh.
   - Si la factura usa m³, extrae los kWh ya convertidos (suelen aparecer calculados).

K3. PRECIO €/kWh ESTIMADO:
   - Si la factura no muestra explícitamente €/kWh sino solo "consumo X kWh × precio":
     precioKwh = costeBrutoConsumo / consumoKwh. Márcalo como estimado.

K4. DIFERENCIA ENTRE DISTRIBUIDORAS Y COMERCIALIZADORAS EN GAS:
   - Distrigás Sur, Nedgia, Nortegas, Distrinalia → distribuidoras (no comercializadoras).
   - La factura la emite la COMERCIALIZADORA (Naturgy, Endesa Gas, Repsol, etc.).
   - El CUPS de gas empieza por "ES" igual que electricidad pero tiene una estructura
     ligeramente diferente. Puede tener sufijo "GN" o similar.

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
      "energyPricingFormat": "precio_unico" | "por_periodo" | "promocionadas",
      "gasPricing": null,
      "rawLineItems": [
        { "description": "Energía Precio horario 4.663 kWh x 0,129447 €/kWh", "category": "energia_comercializacion", "periodo": null, "kwh": 4663, "kw": null, "dias": null, "precioUnitario": 0.129447, "total": 603.61 },
        { "description": "Potencia facturada peajes P1 31,17 kW x 31 dias x 0,040338 €/kW dia", "category": "potencia_peaje", "periodo": "P1", "kwh": null, "kw": 31.17, "dias": 31, "precioUnitario": 0.040338, "total": 38.98 },
        { "description": "Potencia facturada cargos P1 31,17 kW x 31 dias x 0,013521 €/kW dia", "category": "potencia_cargo", "periodo": "P1", "kwh": null, "kw": 31.17, "dias": 31, "precioUnitario": 0.013521, "total": 13.06 },
        { "description": "Energía facturada peajes P1 1.080 kWh x 0,028528 €/kWh", "category": "energia_peaje", "periodo": "P1", "kwh": 1080, "kw": null, "dias": null, "precioUnitario": 0.028528, "total": 30.81 },
        { "description": "Energía facturada cargos P1 1.080 kWh x 0,032503 €/kWh", "category": "energia_cargo", "periodo": "P1", "kwh": 1080, "kw": null, "dias": null, "precioUnitario": 0.032503, "total": 35.10 },
        { "description": "Alquiler equipos medida 31 dias x 0,197918 €/dia", "category": "alquiler_equipos", "periodo": null, "kwh": null, "kw": null, "dias": 31, "precioUnitario": 0.197918, "total": 6.14 },
        { "description": "Financiación bono social fijo 31 dias x 0,012742 €/dia", "category": "bono_social", "periodo": null, "kwh": null, "kw": null, "dias": 31, "precioUnitario": 0.012742, "total": 0.40 },
        { "description": "Impuesto sobre electricidad 5,11% s/812,92", "category": "impuesto_electrico", "periodo": null, "kwh": null, "kw": null, "dias": null, "precioUnitario": null, "total": 41.56 },
        { "description": "IVA 21%", "category": "iva", "periodo": null, "kwh": null, "kw": null, "dias": null, "precioUnitario": 0.21, "total": 180.73 }
      ]
    }
  }
}

⚠️ IMPORTANTE: rawLineItems del ejemplo está abreviado. En una factura 3.0TD REAL
debes devolver TODAS las líneas (típicamente 20+): las 6 de potencia_peaje, las 6 de
potencia_cargo, TODAS las de energia_peaje/cargo por cada periodo con consumo, más
alquiler, bono social, impuesto eléctrico e IVA. NO ABREVIES.

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
   - "factura" (luz/gas): cups (código ES...), supply_type ("luz" o "gas"), holder_name, holder_cif_nif, total_amount (número), tariff, comercializadora (OBLIGATORIO: empresa que emite la factura, ej. "Naturgy", "Endesa", "Galp", "TotalEnergies", "Axpo", etc.), supply_address, billing_period ("DD/MM/YYYY - DD/MM/YYYY"), economics: { fechaInicio, fechaFin, titular, comercializadora (repetir aquí también), cups, tarifa, totalFactura, consumoTotalKwh, consumo, potencia, otrosConceptos, rawLineItems }
   - "cif"/"nif": cif o nif, holder_name, fiscal_address.
   - "iban": iban, bank_name, account_holder.
   - "contrato": cups, holder_name, comercializadora.

JSON: {"documentType": "...", "extracted": { ... }}`

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  POST-PROCESSING (V3.0)                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Numeric coercion helper — parses "1.234,56" and "1234.56" formats.
 */
function toNum(v: any): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v).trim().replace(/\s/g, '')
  // Spanish number: remove thousand dots if pattern looks like 1.234,56
  const normalized = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000
const round6 = (n: number) => Math.round(n * 1000000) / 1000000

/**
 * Aggressive fuzzy key for deduplicating otrosConceptos.
 * Strips noise tokens (DE, MÉTODO, CUARTOHORARIO, accents, punctuation)
 * so variants like "Exceso de Potencia (Método cuarto horario)" and
 * "Exceso potencia" collapse into the same key.
 */
function fuzzyConceptKey(concepto: string): string {
  return String(concepto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[().,;:\-/]/g, ' ')
    .replace(/\b(DE|DEL|LA|LAS|EL|LOS|POR|CON|SIN|METODO|CUARTOHORARIO|CUARTO HORARIO|HORARIO|HORARIA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Is this concept an excess/penalty line? Matches EXCESO, PENALIZAC*, SOBREPOTENCIA.
 */
function isPenaltyConcept(concepto: string): boolean {
  const k = fuzzyConceptKey(concepto)
  return /EXCESO|PENALIZAC|SOBREPOTENCIA|SOBREPASO/.test(k)
}

type LineItem = {
  description?: string
  category?: string
  periodo?: string | null
  kwh?: number | null
  kw?: number | null
  dias?: number | null
  precioUnitario?: number | null
  total?: number | null
}

/**
 * Deterministic rebuilder: takes rawLineItems from Gemini and rebuilds
 * consumo[], potencia[], otrosConceptos[] and the totalizers from scratch.
 *
 * This is the source of truth when rawLineItems is present. It guarantees
 * that every line of the invoice is accounted for exactly once and that
 * the arithmetic matches the declared total (within tolerance).
 */
function rebuildFromRawLineItems(rawLineItems: LineItem[], eco: any): any {
  const out: any = { ...eco }
  const items = rawLineItems
    .filter(i => i && i.category)
    .map(i => ({
      ...i,
      category: String(i.category).toLowerCase().trim(),
      periodo: i.periodo ? String(i.periodo).toUpperCase().trim() : null,
      kwh: toNum(i.kwh),
      kw: toNum(i.kw),
      dias: toNum(i.dias),
      total: toNum(i.total),
    }))

  const byCat = (cat: string) => items.filter(i => i.category === cat)
  const byCatPrefix = (prefix: string) => items.filter(i => i.category.startsWith(prefix))
  const sumTotal = (arr: typeof items) => arr.reduce((s, i) => s + i.total, 0)

  // ── GAS BRANCH ────────────────────────────────────────────────────────
  // If ANY gas_* category is present, treat this as a gas invoice and build
  // gasPricing from line items. Electricity logic below still runs harmlessly
  // (it will produce empty consumo/potencia arrays because no electric lines).
  const hasGasLines = items.some(i => i.category.startsWith('gas_') || i.category === 'impuesto_hidrocarburos')
  if (hasGasLines) {
    const gTermVar = byCat('gas_termino_variable')
    const gTermFijo = byCat('gas_termino_fijo')
    const gPeajeFijo = byCat('gas_peaje_fijo')
    const gPeajeVar = byCat('gas_peaje_variable')
    const gCargo = byCat('gas_cargo')
    const gRegas = byCat('gas_regasificacion')
    const gGts = byCat('gas_cuota_gts')
    const gCnmc = byCat('gas_tasa_cnmc')
    const gFondo = byCat('gas_aportacion_fondo')
    const gHidro = byCat('impuesto_hidrocarburos')
    const gAlq = byCat('alquiler_equipos')
    const gIva = byCat('iva')
    const gDesc = byCat('descuento_energia')

    const consumoKwhGas = gTermVar.reduce((s, i) => s + i.kwh, 0)
    const costeBrutoGas = sumTotal(gTermVar)
    const precioKwh = consumoKwhGas > 0 ? costeBrutoGas / consumoKwhGas : 0

    // terminoFijoTotal aggregates ALL fixed terms (término fijo + peaje fijo +
    // cargos fijos + regasificación + GTS + CNMC + Fondo) — anything that isn't
    // variable-on-kWh, hidrocarburos, alquiler or IVA.
    const terminoFijoTotal = sumTotal([
      ...gTermFijo, ...gPeajeFijo, ...gPeajeVar, ...gCargo,
      ...gRegas, ...gGts, ...gCnmc, ...gFondo,
    ])
    // Sum ALL days across all fixed-term lines (e.g. 4 días + 56 días = 60)
    const diasFacturados = [...gTermFijo, ...gPeajeFijo].reduce((s, i) => s + i.dias, 0)
    const terminoFijoDiario = diasFacturados > 0 ? terminoFijoTotal / diasFacturados : 0

    // Discounts may come as negative totals (-3.95) or positive (3.95).
    // Always store as POSITIVE value; costeNeto = bruto - abs(descuento).
    const rawDescuento = sumTotal(gDesc)
    const descuentoEnergia = Math.abs(rawDescuento)

    out.supply_type = out.supply_type || 'gas'
    out.consumoTotalKwh = round2(consumoKwhGas)
    out.costeBrutoConsumo = round2(costeBrutoGas)
    out.descuentoEnergia = round2(descuentoEnergia)
    out.costeNetoConsumo = round2(costeBrutoGas - descuentoEnergia)
    out.costeTotalConsumo = out.costeNetoConsumo
    out.consumo = consumoKwhGas > 0 ? [{
      periodo: 'P1',
      kwh: round2(consumoKwhGas),
      precioKwh: round4(precioKwh),
      total: round2(costeBrutoGas),
    }] : []
    out.potencia = []
    out.costeTotalPotencia = 0
    out.otrosConceptos = []

    out.gasPricing = {
      precioKwh: round4(precioKwh),
      precioKwhEstimated: false,
      terminoFijoDiario: round4(terminoFijoDiario),
      diasFacturados: diasFacturados || null,
      terminoFijoTotal: round2(terminoFijoTotal),
      impuestoHidrocarbTotal: round2(sumTotal(gHidro)),
      alquilerTotal: round2(sumTotal(gAlq)),
      ivaPorcentaje: 21,
      ivaTotal: round2(sumTotal(gIva)),
      descuentoTerminoFijo: 0,
      descuentoOtros: 0,
    }

    const declaredTotalGas = toNum(eco.totalFactura)
    const computedGas = round2(
      costeBrutoGas + terminoFijoTotal + sumTotal(gHidro) + sumTotal(gAlq) + sumTotal(gIva) - descuentoEnergia
    )
    out.totalFactura = declaredTotalGas > 0 ? round2(declaredTotalGas) : computedGas
    if (consumoKwhGas > 0 && out.costeNetoConsumo > 0) {
      out.costeMedioKwhNeto = round4(toNum(out.costeNetoConsumo) / consumoKwhGas)
      out.costeMedioKwh = out.costeMedioKwhNeto
    }
    out._rebuiltFromRaw = true
    out._rawLineItemsSum = round2(sumTotal(items))
    return out
  }

  // ── CASO 3: HORAS PROMOCIONADAS / NO PROMOCIONADAS (Iberdrola Plan Elige X horas) ────
  // When the invoice uses "horas_no_promocionada" / "horas_promocionada" categories,
  // compute the weighted average price and store it on all periods.
  // Also store the raw breakdown in energyPricingOriginal for audit traceability.
  const noPromoItems = byCat('energia_no_promocionada')
  const promoItems = byCat('energia_promocionada')
  const hasPromoFormat = noPromoItems.length > 0 || promoItems.length > 0

  if (hasPromoFormat) {
    const kwhNoPromo = noPromoItems.reduce((s, i) => s + i.kwh, 0)
    const kwhPromo = promoItems.reduce((s, i) => s + i.kwh, 0)
    const totalNoPromo = noPromoItems.reduce((s, i) => s + i.total, 0)
    const totalPromo = promoItems.reduce((s, i) => s + i.total, 0)
    const totalKwhPromo = kwhNoPromo + kwhPromo
    const totalEnergyPromo = totalNoPromo + totalPromo

    // Weighted average price = Σ(kWh_i × precio_i) / Σ(kWh_i)
    const precioNoPromo = noPromoItems.length > 0 && kwhNoPromo > 0
      ? noPromoItems.reduce((s, i) => s + i.kwh * (i.precioUnitario || (i.kwh > 0 ? i.total / i.kwh : 0)), 0) / kwhNoPromo
      : 0
    const precioPromo = promoItems.length > 0 && kwhPromo > 0
      ? promoItems.reduce((s, i) => s + i.kwh * (i.precioUnitario || (i.kwh > 0 ? i.total / i.kwh : 0)), 0) / kwhPromo
      : 0

    const precioPonderado = totalKwhPromo > 0
      ? (kwhNoPromo * precioNoPromo + kwhPromo * precioPromo) / totalKwhPromo
      : 0

    // Store the individual period data (P1 = no promo = punta, P2 = promo = valle)
    out.consumo = []
    if (kwhNoPromo > 0) {
      out.consumo.push({ periodo: 'P1', kwh: round2(kwhNoPromo), precioKwh: round6(precioNoPromo), total: round2(totalNoPromo) })
    }
    if (kwhPromo > 0) {
      out.consumo.push({ periodo: 'P2', kwh: round2(kwhPromo), precioKwh: round6(precioPromo), total: round2(totalPromo) })
    }
    out.consumoTotalKwh = round2(totalKwhPromo)
    out.costeBrutoConsumo = round2(totalEnergyPromo)
    out.descuentoEnergia = 0
    out.costeNetoConsumo = round2(totalEnergyPromo)
    out.costeTotalConsumo = round2(totalEnergyPromo)
    // costeMedioKwhNeto = weighted average of both tranches
    out.costeMedioKwhNeto = round6(precioPonderado)
    out.costeMedioKwh = out.costeMedioKwhNeto
    // Store original breakdown for audit
    out.energyPricingFormat = 'promocionadas'
    out.energyPricingOriginal = {
      no_promocionadas: { kwh: round2(kwhNoPromo), precioKwh: round6(precioNoPromo), total: round2(totalNoPromo) },
      promocionadas:    { kwh: round2(kwhPromo),   precioKwh: round6(precioPromo),   total: round2(totalPromo) },
      precioPonderado:  round6(precioPonderado),
    }
    // Continue with potencia and otros (fall through — don't return early)
  }

  // ── ENERGY ────────────────────────────────────────────────────────────
  const energiaComer = hasPromoFormat ? [] : byCat('energia_comercializacion')
  const energiaPeajes = hasPromoFormat ? [] : byCat('energia_peaje')
  const energiaCargos = hasPromoFormat ? [] : byCat('energia_cargo')
  const descEnergiaItems = hasPromoFormat ? [] : byCat('descuento_energia')

  // kWh per period comes from peajes/cargos lines OR from consolidated
  // energia_comercializacion lines with periodo (ACCIONA 6.1TD style).
  const periodKwhMap = new Map<string, number>()
  for (const it of [...energiaPeajes, ...energiaCargos, ...energiaComer]) {
    if (!it.periodo) continue
    const kwh = it.kwh
    if (kwh > 0 && !periodKwhMap.has(it.periodo)) {
      periodKwhMap.set(it.periodo, kwh)
    }
  }

  // Total kWh = sum of per-period kWh. If empty, fall back to flat comercializacion kwh.
  let totalKwh = 0
  for (const v of periodKwhMap.values()) totalKwh += v
  if (totalKwh === 0) {
    const flatKwh = energiaComer.reduce((s, i) => s + i.kwh, 0)
    if (flatKwh > 0) totalKwh = flatKwh
  }

  // Comercializacion can be (a) one flat line on the total (most common, Iberdrola)
  // or (b) per-period lines (e.g. some Endesa/Naturgy). Handle both.
  const flatComerTotal = energiaComer
    .filter(i => !i.periodo)
    .reduce((s, i) => s + i.total, 0)
  const perPeriodComer = new Map<string, number>()
  for (const it of energiaComer) {
    if (it.periodo) perPeriodComer.set(it.periodo, (perPeriodComer.get(it.periodo) || 0) + it.total)
  }

  // Build consolidated consumo[] per period
  const consumoPeriods = Array.from(
    new Set([
      ...Array.from(periodKwhMap.keys()),
      ...Array.from(perPeriodComer.keys()),
      ...energiaPeajes.map(i => i.periodo).filter(Boolean) as string[],
      ...energiaCargos.map(i => i.periodo).filter(Boolean) as string[],
    ])
  ).sort()

  const consumo: any[] = []
  for (const p of consumoPeriods) {
    const kwh = periodKwhMap.get(p) || 0
    if (kwh <= 0) continue
    const peaje = energiaPeajes.filter(i => i.periodo === p).reduce((s, i) => s + i.total, 0)
    const cargo = energiaCargos.filter(i => i.periodo === p).reduce((s, i) => s + i.total, 0)
    const comerPerPeriod = perPeriodComer.get(p) || 0
    // Prorate the flat comercializacion by kWh ratio
    const comerProrated = totalKwh > 0 ? (flatComerTotal * kwh) / totalKwh : 0
    const total = peaje + cargo + comerPerPeriod + comerProrated
    const precioKwh = kwh > 0 ? total / kwh : 0
    consumo.push({
      periodo: p,
      kwh: round2(kwh),
      precioKwh: round4(precioKwh),
      total: round2(total),
    })
  }

  const costeBrutoConsumo = sumTotal([...energiaComer, ...energiaPeajes, ...energiaCargos])
  // Discounts may come as negative totals or positive — always store as positive
  const descuentoEnergia = Math.abs(sumTotal(descEnergiaItems))
  const costeNetoConsumo = costeBrutoConsumo - descuentoEnergia

  // Only overwrite energy fields if NOT already handled by Caso 3 (promocionadas)
  if (!hasPromoFormat) {
    out.consumo = consumo
    out.consumoTotalKwh = round2(totalKwh)
    out.costeBrutoConsumo = round2(costeBrutoConsumo)
    out.descuentoEnergia = round2(descuentoEnergia)
    out.costeNetoConsumo = round2(costeNetoConsumo)
    out.costeTotalConsumo = round2(costeNetoConsumo)
  }

  // ── POWER ─────────────────────────────────────────────────────────────
  const potenciaPeajes = byCat('potencia_peaje')
  const potenciaCargos = byCat('potencia_cargo')
  const potenciaComer = byCat('potencia_comercializacion')

  const potPeriods = Array.from(
    new Set([
      ...potenciaPeajes.map(i => i.periodo).filter(Boolean) as string[],
      ...potenciaCargos.map(i => i.periodo).filter(Boolean) as string[],
      ...potenciaComer.map(i => i.periodo).filter(Boolean) as string[],
    ])
  ).sort()

  const potencia: any[] = []
  for (const p of potPeriods) {
    const peaje = potenciaPeajes.filter(i => i.periodo === p).reduce((s, i) => s + i.total, 0)
    const cargo = potenciaCargos.filter(i => i.periodo === p).reduce((s, i) => s + i.total, 0)
    const comer = potenciaComer.filter(i => i.periodo === p).reduce((s, i) => s + i.total, 0)
    const total = peaje + cargo + comer
    if (total === 0) continue
    const kwRow = potenciaPeajes.find(i => i.periodo === p) || potenciaCargos.find(i => i.periodo === p)
    const dias = kwRow?.dias || null
    const kw = kwRow?.kw || null

    // Prefer summed precioUnitario from raw items (exact value Gemini read from invoice).
    // Summing peaje + cargo + comer gives the combined €/kW·día without rounding loss.
    // Fall back to total/(kw*dias) only when precioUnitario is unavailable.
    const rawPrecioSum =
      potenciaPeajes.filter(i => i.periodo === p).reduce((s, i) => s + (Number(i.precioUnitario) || 0), 0) +
      potenciaCargos.filter(i => i.periodo === p).reduce((s, i) => s + (Number(i.precioUnitario) || 0), 0) +
      potenciaComer.filter(i => i.periodo === p).reduce((s, i) => s + (Number(i.precioUnitario) || 0), 0)
    const precioKwDia = rawPrecioSum > 0 ? rawPrecioSum : (kw && dias ? total / (kw * dias) : null)

    potencia.push({
      periodo: p,
      kw,
      dias,
      precioKwDia: precioKwDia != null ? round6(precioKwDia) : null,
      total: round2(total),
    })
  }

  const costeTotalPotencia = sumTotal([...potenciaPeajes, ...potenciaCargos, ...potenciaComer])
  out.potencia = potencia
  out.costeTotalPotencia = round2(costeTotalPotencia)

  // ── OTROS CONCEPTOS ───────────────────────────────────────────────────
  // Map categories to canonical display names expected by the frontend
  const canonicalMap: Record<string, string> = {
    alquiler_equipos: 'ALQUILER DE EQUIPOS',
    bono_social: 'BONO SOCIAL',
    compensacion_excedentes: 'COMPENSACIÓN EXCEDENTES',
    impuesto_electrico: 'IMPUESTO ELÉCTRICO',
    exceso_potencia: 'EXCESO DE POTENCIA',
    iva: 'IVA / IGIC',
    otro: 'OTROS',
  }
  const otrosConceptos: { concepto: string; total: number }[] = []
  for (const [cat, name] of Object.entries(canonicalMap)) {
    const total = sumTotal(byCat(cat))
    if (total !== 0) otrosConceptos.push({ concepto: name, total: round2(total) })
  }
  out.otrosConceptos = otrosConceptos

  // ── TOTAL FACTURA ────────────────────────────────────────────────────
  // If declared totalFactura is missing, derive from: net consumo + potencia + otros (incl. IVA)
  const ivaTotal = sumTotal(byCat('iva'))
  const declaredTotal = toNum(eco.totalFactura)
  const computedTotalFactura =
    round2(costeNetoConsumo + costeTotalPotencia +
           otrosConceptos.reduce((s, o) => s + o.total, 0))
  if (!declaredTotal || declaredTotal === 0) {
    out.totalFactura = computedTotalFactura
  } else {
    out.totalFactura = round2(declaredTotal)
  }

  // Average €/kWh
  if (totalKwh > 0 && costeNetoConsumo > 0) {
    out.costeMedioKwhNeto = round4(costeNetoConsumo / totalKwh)
    out.costeMedioKwh = out.costeMedioKwhNeto
  }

  // Internal flag for validation step
  out._rebuiltFromRaw = true
  out._rawLineItemsSum = round2(sumTotal(items))
  return out
}

/**
 * Normalize economics block after extraction:
 *  0) If rawLineItems is present, rebuild EVERYTHING from it deterministically
 *  1) Deduplicate otrosConceptos by fuzzy canonical key
 *  2) Collapse duplicate EXCESO/PENALIZACIÓN rows that share the same total
 *  3) Map costeNetoConsumo ↔ costeTotalConsumo for backward compat
 *  4) Derive costeBrutoConsumo from consumo[] if missing
 *  5) Compute costeMedioKwhNeto
 *  6) Gas-specific: flag precioKwhEstimated + normalize gasPricing
 *  7) Math self-check: compute sum and attach validation metadata
 */
function postProcessEconomics(economics: any): any {
  if (!economics || typeof economics !== 'object') return economics
  let eco: any = { ...economics }

  // 0) Authoritative rebuild from rawLineItems when available
  if (Array.isArray(eco.rawLineItems) && eco.rawLineItems.length > 0) {
    try {
      eco = rebuildFromRawLineItems(eco.rawLineItems, eco)
    } catch (e: any) {
      console.warn('[Gemini] rebuildFromRawLineItems failed:', e?.message)
    }
  }

  // 1+2) Deduplicate otrosConceptos
  if (Array.isArray(eco.otrosConceptos)) {
    // Pass 1: fuzzy key dedup (sum totals per canonical concept)
    const byKey = new Map<string, { concepto: string; total: number }>()
    for (const c of eco.otrosConceptos) {
      if (!c || !c.concepto) continue
      const total = toNum(c.total)
      const key = fuzzyConceptKey(c.concepto)
      if (!key) continue
      const existing = byKey.get(key)
      if (existing) {
        existing.total += total
      } else {
        byKey.set(key, { concepto: String(c.concepto).trim(), total })
      }
    }

    // Pass 2: for penalty rows, keep ONE row per unique total (avoids "método
    // cuarto horario vs puntas" double-counting on the same penalty amount)
    const penaltyRows: { concepto: string; total: number }[] = []
    const nonPenaltyRows: { concepto: string; total: number }[] = []
    for (const row of byKey.values()) {
      if (isPenaltyConcept(row.concepto)) penaltyRows.push(row)
      else nonPenaltyRows.push(row)
    }
    const penaltyByTotal = new Map<string, { concepto: string; total: number }>()
    for (const p of penaltyRows) {
      const tKey = (Math.round(p.total * 100) / 100).toFixed(2)
      if (!penaltyByTotal.has(tKey)) penaltyByTotal.set(tKey, p)
    }

    eco.otrosConceptos = [
      ...nonPenaltyRows.map(r => ({ concepto: r.concepto, total: round2(r.total) })),
      ...Array.from(penaltyByTotal.values()).map(r => ({ concepto: r.concepto, total: round2(r.total) })),
    ]
  }

  // 3) costeNetoConsumo ↔ costeTotalConsumo
  if (eco.costeNetoConsumo != null && eco.costeTotalConsumo == null) {
    eco.costeTotalConsumo = eco.costeNetoConsumo
  }
  if (eco.costeTotalConsumo != null && eco.costeNetoConsumo == null) {
    eco.costeNetoConsumo = eco.costeTotalConsumo
  }

  // 4) Derive costeBrutoConsumo from consumo items if missing
  if (eco.costeBrutoConsumo == null && Array.isArray(eco.consumo)) {
    const brute = eco.consumo.reduce((s: number, p: any) => s + toNum(p.total), 0)
    if (brute > 0) eco.costeBrutoConsumo = round2(brute)
  }

  // 4b) Sanity-check consumo[] kWh sum against consumoTotalKwh.
  //    If the model confused the flat "Precio horario 4.663 kWh" block with P1
  //    (common on Iberdrola/Endesa 3.0TD invoices), the sum will be 2× the total
  //    or a single row will equal the total. Flag it as a warning so the
  //    validation layer can catch it.
  if (Array.isArray(eco.consumo) && eco.consumo.length > 0) {
    const totalKwhDeclared = toNum(eco.consumoTotalKwh)
    const sumKwhItems = eco.consumo.reduce((s: number, p: any) => s + toNum(p.kwh), 0)
    if (totalKwhDeclared > 0 && sumKwhItems > 0) {
      const ratio = sumKwhItems / totalKwhDeclared
      // If sum is >1.5× total, or any single period ≥ total (and total has >1 period),
      // mark as suspicious.
      const anyPeriodEqualsTotal = eco.consumo.some(
        (p: any) => Math.abs(toNum(p.kwh) - totalKwhDeclared) < 1 && totalKwhDeclared > 0
      )
      if (ratio > 1.5 || (anyPeriodEqualsTotal && eco.consumo.length > 1)) {
        eco._kwhPeriodMismatch = true
      }
    }
  }

  // 4c) Sanity-check costeTotalPotencia against potencia[] items.
  //    If the model only captured 1–2 of the 12 power lines on a 3.0TD invoice,
  //    the declared costeTotalPotencia will be way smaller than the real sum.
  //    Recompute from items if they look more complete.
  if (Array.isArray(eco.potencia) && eco.potencia.length > 0) {
    const declaredPot = toNum(eco.costeTotalPotencia)
    const sumPotItems = eco.potencia.reduce((s: number, p: any) => s + toNum(p.total), 0)
    if (sumPotItems > declaredPot * 1.2 && sumPotItems > 0) {
      // items sum is meaningfully larger → trust the items
      eco.costeTotalPotencia = round2(sumPotItems)
    } else if (declaredPot > sumPotItems * 1.5 && declaredPot > 0) {
      // declared is much larger than items → items are incomplete, flag it
      eco._potenciaItemsIncomplete = true
    }
  }

  // If we have bruto and descuentoEnergia but no neto, derive it
  if (eco.costeNetoConsumo == null && eco.costeBrutoConsumo != null) {
    const neto = toNum(eco.costeBrutoConsumo) - toNum(eco.descuentoEnergia)
    eco.costeNetoConsumo = round2(neto)
    eco.costeTotalConsumo = eco.costeNetoConsumo
  }

  // 5) costeMedioKwhNeto
  const consumoKwh = toNum(eco.consumoTotalKwh)
  const costeNeto = toNum(eco.costeNetoConsumo ?? eco.costeTotalConsumo)
  if (consumoKwh > 0 && costeNeto > 0) {
    eco.costeMedioKwhNeto = round4(costeNeto / consumoKwh)
    if (eco.costeMedioKwh == null) eco.costeMedioKwh = eco.costeMedioKwhNeto
  }

  // 6) Gas-specific normalization
  if (eco.gasPricing && typeof eco.gasPricing === 'object') {
    const gp: any = { ...eco.gasPricing }
    // Flag estimated price when we had to derive it
    if ((gp.precioKwh == null || toNum(gp.precioKwh) === 0) && consumoKwh > 0 && toNum(eco.costeBrutoConsumo) > 0) {
      gp.precioKwh = round4(toNum(eco.costeBrutoConsumo) / consumoKwh)
      gp.precioKwhEstimated = true
    } else if (gp.precioKwh != null) {
      gp.precioKwhEstimated = gp.precioKwhEstimated === true
    }
    // Default IVA for Spanish gas if missing
    if (gp.ivaPorcentaje == null) gp.ivaPorcentaje = 21
    // Normalize numeric fields
    for (const k of ['precioKwh', 'terminoFijoDiario', 'diasFacturados', 'terminoFijoTotal',
                     'impuestoHidrocarbTotal', 'alquilerTotal', 'ivaTotal', 'descuentoTerminoFijo', 'descuentoOtros']) {
      if (gp[k] != null) gp[k] = typeof gp[k] === 'number' ? gp[k] : toNum(gp[k])
    }
    eco.gasPricing = gp
  }

  // 7) JS-side math self-check
  const totalFactura = toNum(eco.totalFactura)
  let computed = 0
  const isGas = !!eco.gasPricing
  if (isGas) {
    const gp = eco.gasPricing || {}
    const bruto = toNum(eco.costeBrutoConsumo)
    const tFijo = toNum(gp.terminoFijoTotal)
    const hidro = toNum(gp.impuestoHidrocarbTotal)
    const alq = toNum(gp.alquilerTotal)
    const iva = toNum(gp.ivaTotal)
    const dE = toNum(eco.descuentoEnergia)
    const dTF = toNum(gp.descuentoTerminoFijo)
    const dO = toNum(gp.descuentoOtros)
    computed = bruto + tFijo + hidro + alq + iva - dE - dTF - dO
  } else {
    const neto = toNum(eco.costeNetoConsumo ?? eco.costeTotalConsumo)
    const pot = toNum(eco.costeTotalPotencia)
    const otros = Array.isArray(eco.otrosConceptos)
      ? eco.otrosConceptos.reduce((s: number, c: any) => s + toNum(c.total), 0)
      : 0
    computed = neto + pot + otros
  }
  const diff = Math.abs(computed - totalFactura)
  const tolerance = Math.max(0.05, totalFactura * 0.01) // 0.05€ or 1% of total
  const warnings: string[] = []
  if (totalFactura > 0 && diff > tolerance) {
    warnings.push(
      `Descuadre matemático: suma de conceptos ${round2(computed).toFixed(2)}€ vs total factura ${round2(totalFactura).toFixed(2)}€ (diferencia ${round2(diff).toFixed(2)}€)`
    )
  }
  if (!eco.cups && !eco.CUPS) warnings.push('CUPS no extraído')
  if (isGas && eco.gasPricing?.precioKwhEstimated) warnings.push('€/kWh de gas calculado (no explícito en factura)')
  if (eco._kwhPeriodMismatch) warnings.push('Posible confusión entre "Precio horario" total y periodo P1 (revisa kWh por periodo)')
  if (eco._potenciaItemsIncomplete) warnings.push('El detalle por periodo de potencia parece incompleto frente al total declarado')

  // If rebuilt from rawLineItems, also check sum of line items against declared total
  if (eco._rebuiltFromRaw && eco._rawLineItemsSum != null && totalFactura > 0) {
    const rawDiff = Math.abs(toNum(eco._rawLineItemsSum) - totalFactura)
    if (rawDiff > tolerance) {
      warnings.push(
        `Suma de rawLineItems ${Number(eco._rawLineItemsSum).toFixed(2)}€ no cuadra con total factura ${totalFactura.toFixed(2)}€ (falta extraer ${rawDiff.toFixed(2)}€ de líneas)`
      )
    }
  }

  eco.validation = {
    computedTotal: round2(computed),
    declaredTotal: round2(totalFactura),
    diff: round2(diff),
    mathOk: totalFactura > 0 ? diff <= tolerance : null,
    rebuiltFromRawLineItems: !!eco._rebuiltFromRaw,
    warnings,
  }

  // Clean up internal flags before returning
  delete eco._kwhPeriodMismatch
  delete eco._potenciaItemsIncomplete
  delete eco._rebuiltFromRaw
  delete eco._rawLineItemsSum

  return eco
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  IMAGE PRE-PROCESSING                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Enhance JPEG/PNG images before sending to Gemini to improve OCR accuracy.
 * Telegram photos arrive at ~1280px with heavy JPEG compression which makes
 * small text (CUPS, prices, kWh values) blurry.  Normalizing + sharpening
 * recovers contrast and makes character edges cleaner so Gemini reads them
 * more reliably.
 *
 * Returns the original base64 unchanged if sharp is unavailable or fails.
 */
async function enhanceImageForOcr(
  base64Data: string,
  mimeType: string,
): Promise<{ base64Data: string; mimeType: string }> {
  if (!mimeType.startsWith('image/')) return { base64Data, mimeType }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp') as typeof import('sharp').default
    const inputBuffer = Buffer.from(base64Data, 'base64')

    const outputBuffer = await sharp(inputBuffer)
      .normalize()                     // Auto-adjust levels (rescale dark/light to full range)
      .sharpen({ sigma: 1.5 })         // Enhance text edges
      .jpeg({ quality: 95 })           // High-quality JPEG output
      .toBuffer()

    console.log(`[Gemini] Image preprocessed: ${inputBuffer.length} → ${outputBuffer.length} bytes`)
    return { base64Data: outputBuffer.toString('base64'), mimeType: 'image/jpeg' }
  } catch (err: any) {
    console.warn('[Gemini] Image preprocessing skipped:', err?.message)
    return { base64Data, mimeType }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ANALYSIS                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

export async function analyzeDocument(
  base64Data: string,
  mimeType: string,
  docType?: DocumentType,
  extraPages?: Array<{ base64Data: string; mimeType: string }>
): Promise<ExtractedDocumentData> {
  const apiKey = getApiKey()
  if (!apiKey) return { mode: 'manual', documentType: 'otro', error: 'GEMINI_API_KEY no configurada en el servidor' }

  try {
    // ── Pre-process images to improve OCR quality ──────────────────────────
    const enhanced = await enhanceImageForOcr(base64Data, mimeType)
    base64Data = enhanced.base64Data
    mimeType = enhanced.mimeType

    if (extraPages?.length) {
      extraPages = await Promise.all(
        extraPages.map(async (p) => {
          const e = await enhanceImageForOcr(p.base64Data, p.mimeType)
          return { base64Data: e.base64Data, mimeType: e.mimeType }
        })
      )
    }

    let prompt = docType === 'factura' ? INVOICE_PROMPT : INVOICE_PROMPT // Always use invoice prompt - it handles all doc types

    // When ANY page is an image (e.g. Telegram photo → JPEG), apply extra extraction guidance.
    // Telegram compresses photos to 1280×1280 JPEG so small text (CUPS, prices) can be blurry.
    // These instructions push Gemini to try harder before giving up on any field.
    const hasImagePage = mimeType.startsWith('image/') || extraPages?.some(p => p.mimeType.startsWith('image/'))
    if (hasImagePage) {
      const imageHints = `
INSTRUCCIONES ESPECIALES PARA IMÁGENES (PRIORIDAD MÁXIMA — LEE TODO ANTES DE RESPONDER):
Esta entrada es una IMAGEN de factura energética. Puede estar comprimida o ligeramente borrosa.
La imagen ha sido mejorada (normalizada y enfocada) para facilitar la lectura. Usa esa mejora al máximo.

════ 1. CUPS ════
- Busca CUALQUIER secuencia "ES" + 20 caracteres alfanuméricos en TODA la imagen.
- Puede estar en: cabecera, sección "DATOS DEL CONTRATO", pie, tabla de datos del suministro.
- ANTI-ALUCINACIÓN: Solo extrae si puedes leer al menos 18 de los 22 caracteres con seguridad.
  Si lees menos de 18, devuelve null — es mejor null que un CUPS inventado.
- NUNCA rellenes con ceros ni repitas dígitos para completar. Si no estás seguro de un carácter,
  el CUPS entero es null.

════ 2. TIPO DE SUMINISTRO ════
- Si la tarifa contiene "TD" o empieza por 2, 3 o 6 (ej: 2.0TD, 3.0TD, 6.1TD) → supply_type: "luz"
- Si la tarifa empieza por "RL" → supply_type: "gas"
- Si no hay tarifa visible → mira si hay "kWh" (luz) o "m³" (gas) en las tablas de consumo.
- NUNCA pongas supply_type:"gas" si ves kWh o tarifa 3.0TD/2.0TD/6.1TD.

════ 3. ECONOMICS — OBLIGATORIO EXTRAER TODO ════
Aunque la imagen sea borrosa, DEBES extraer todos los valores numéricos de las tablas.

3a. consumo[] — Una entrada por CADA período de energía (P1, P2, P3, P4, P5, P6):
   { periodo:"P1", kwh: X, precioKwh: Y, importe: Z, fecha_inicio:"YYYY-MM-DD", fecha_fin:"YYYY-MM-DD" }
   - Busca columnas: "Energía", "Término de energía", "Consumo activa", "Período", "kWh", "€/kWh"
   - Si ves "P1 7.351 kWh" → kwh=7351. Si ves "P2 4.548 kWh" → kwh=4548. Extrae TODOS los períodos.

3b. potencia[] — Una entrada por CADA período de potencia (P1–P6 para 3.0TD):
   { periodo:"P1", kw: X, precioKwDia: Y, dias: Z, importe: W }
   - Busca: "Potencia contratada", "Término de potencia", "kW contratados", "€/kW·día"
   - En 3.0TD los 6 períodos suelen tener la misma potencia (ej: 69 kW cada uno).
   - precioKwDia es SIEMPRE en €/kW·DÍA. Tres formatos posibles:
       · Diario (valor < 2, unidad €/kW·día): úsalo directamente. importe = kw × precio × dias
       · Anual  (valor > 5, unidad €/kW·año): divide entre 365. precioKwDia = precio_anual/365
       · Notación (días/365): "260kW × 0,078882€/kW × (30/365)días" → precio diario, dias=30
     Verifica siempre: importe ≈ kw × precioKwDia × dias
   - Si peaje+cargo separados, suma en potencia[] pero emíte cada uno en rawLineItems.

3c. otrosConceptos[] — TODOS los conceptos adicionales:
   - Impuesto eléctrico (7%), alquiler equipo, financiación, descuentos, etc.

3d. Totales obligatorios:
   - totalFactura: busca "Total a pagar", "Total factura", "Importe total" (con IVA)
   - costeBrutoConsumo: suma de los importes de energía antes de impuestos
   - costeTotalPotencia: suma de los importes de potencia

════ 4. FECHAS ════
- fechaInicio / fechaFin del período de facturación (formato YYYY-MM-DD)
- Busca "Período de facturación", "Del ... al ..."

════ 5. REGLA GENERAL ════
Extrae TODO lo que puedas leer, aunque sea con baja confianza. Es mejor un valor aproximado
que un null. La única excepción es el CUPS — ahí null es mejor que inventar.

`.trimStart()
      prompt = imageHints + prompt
    }

    let content: string
    let extractorUsed: 'gemini' | 'claude' = 'gemini'
    try {
      content = await callGemini(prompt, base64Data, mimeType, 3, extraPages)
    } catch (geminiErr: any) {
      // If Gemini fails with an auth/permanent error, fall back to Claude
      const isPermanent = geminiErr instanceof GeminiError
        ? !geminiErr.retryable
        : /unauthorized|401|403|api.?key|No Gemini model/i.test(geminiErr?.message || '')
      if (isPermanent && process.env.ANTHROPIC_API_KEY) {
        console.warn('[Gemini] Permanent error — falling back to Claude:', geminiErr?.message)
        content = await callClaudeForExtraction(prompt, base64Data, mimeType, extraPages)
        extractorUsed = 'claude'
      } else {
        throw geminiErr
      }
    }
    const result = safeParseGeminiJSON(content)

    const detectedType: DocumentType = result.documentType || docType || 'otro'
    const extracted = result.extracted || result

    // CUPS: try direct extraction first, then fallback to regex extraction from raw text
    let cups = normalizeCups(extracted.cups || '') || undefined
    if (!cups && content) {
      // Gemini might have returned the CUPS embedded in text — try to extract it
      cups = extractCups(content) || undefined
    }
    // Sanity-check: reject hallucinated/fake CUPS
    // A real CUPS has varied characters. Reject if the 20 chars after "ES" are too uniform
    // (e.g. ES0020000000000000000 or ES1111111111111111 — Gemini filling with zeros/repeats)
    if (cups) {
      const body = cups.slice(2) // everything after "ES"
      const uniqueChars = new Set(body.replace(/\D/g, '').split('')).size
      const zeroCount = (body.match(/0/g) || []).length
      // Reject if fewer than 3 distinct digits OR more than 14 zeros in a 20-char code
      if (uniqueChars < 3 || zeroCount > 14) {
        console.warn(`[Gemini] Rejecting likely hallucinated CUPS: ${cups} (uniqueChars=${uniqueChars}, zeros=${zeroCount})`)
        cups = undefined
      }
    }

    return {
      mode: extractorUsed,
      documentType: detectedType,
      cups,
      supply_type: (['luz', 'gas', 'telefonia'].includes(extracted.supply_type) ? extracted.supply_type : undefined) as 'luz' | 'gas' | 'telefonia' | undefined,
      cif: clean(extracted.cif) || (detectedType !== 'factura' ? clean(extracted.holder_cif_nif) : undefined),
      nif: clean(extracted.nif) || (detectedType !== 'factura' ? clean(extracted.holder_cif_nif) : undefined),
      holder_name: clean(extracted.holder_name) || clean(extracted.account_holder),
      holder_cif_nif: clean(extracted.holder_cif_nif),
      total_amount: extracted.total_amount != null ? String(extracted.total_amount) : '',
      tariff: normalizeTariff(extracted.tariff) || clean(extracted.tariff),
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
    console.error('[Gemini] Analysis failed:', error?.message || error)
    return {
      mode: 'manual',
      documentType: docType || 'otro',
      error: getUserFriendlyError(error),
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  BACKWARD COMPAT ALIASES                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

export type ExtractedInvoiceData = ExtractedDocumentData

export async function analyzeInvoice(
  base64Data: string,
  mimeType: string,
  extraPages?: Array<{ base64Data: string; mimeType: string }>
): Promise<ExtractedInvoiceData> {
  return analyzeDocument(base64Data, mimeType, 'factura', extraPages)
}

export function getMimeType(fileName: string, fileType?: string): string {
  const name = (fileName || '').toLowerCase()
  if (fileType === 'pdf' || name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}
