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
async function callGeminiOnce(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY no configurada', 0, false)

  const model = await getWorkingModel(apiKey)

  let response: Response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(25000),
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
async function callGemini(
  prompt: string,
  base64Data: string,
  mimeType: string,
  maxAttempts = 3
): Promise<string> {
  let lastErr: any = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGeminiOnce(prompt, base64Data, mimeType)
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

/**
 * Translate raw Gemini errors to user-friendly Spanish messages.
 */
function getUserFriendlyError(err: any): string {
  const raw: string = err?.message || String(err || 'Error desconocido')
  if (!raw) return 'Error desconocido al analizar la factura.'
  if (/api.?key|GEMINI_API_KEY/i.test(raw)) return 'Configuración de IA inválida. Contacta al administrador.'
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

⚠️ ESTRUCTURA OBLIGATORIA DE FACTURAS ESPAÑOLAS 2.0TD / 3.0TD / 6.1TD ⚠️

Desde el RD 148/2021, TODAS las facturas españolas de acceso 2.0TD, 3.0TD y 6.1TD
descomponen la energía y la potencia en TRES bloques distintos que aparecen como
líneas SEPARADAS en la factura. DEBES FUSIONARLOS por periodo antes de devolver el JSON.

LUZ-0. **ENERGÍA — TRES BLOQUES A FUSIONAR:**
   Para CADA periodo P1–P6 con consumo, puede haber hasta TRES líneas distintas:
   (a) "Energía Precio horario" / "Término de energía" / "Coste de la energía"
       → término de COMERCIALIZACIÓN (precio libre de la comercializadora). A veces
       aparece como un único importe flat sobre el total de kWh (ej: "4.663 kWh ×
       0,129447 €/kWh"). En ese caso, DEBES PRORRATEARLO a cada periodo en
       proporción a los kWh reales de ese periodo.
   (b) "Energía facturada peajes P1/P2/P3/P4/P5/P6"  → PEAJE de acceso (regulado distribuidora).
   (c) "Energía facturada cargos P1/P2/P3/P4/P5/P6"  → CARGO del sistema (regulado MITECO).

   Los kWh REALES por periodo están en las líneas (b) o (c), NUNCA en (a) cuando (a)
   es un flat total. No confundas el total "4.663 kWh" con el P1 — busca las líneas
   "Energía facturada peajes Pn X kWh" para sacar los kWh de cada periodo.

   €/kWh REAL por periodo = €/kWh(comercialización) + €/kWh(peaje Pn) + €/kWh(cargo Pn)
   Total € por periodo = kWh(Pn) × €/kWh real(Pn)

LUZ-1. **Periodos P1 a P6:** Extrae cada periodo existente con (kwh, precioKwh, total)
   FUSIONANDO los tres bloques anteriores. Si un periodo tiene 0 kWh, omítelo del array.
   Verifica: Σ kwh de todos los periodos = consumoTotalKwh. Si no cuadra, re-escanea.

LUZ-1b. **POTENCIA — DOS BLOQUES A FUSIONAR:**
   Para CADA periodo P1–P6, la potencia también viene en dos líneas:
   (d) "Potencia facturada peajes P1/.../P6"  → PEAJE de potencia (regulado distribuidora).
   (e) "Potencia facturada cargos P1/.../P6"  → CARGO de potencia (regulado MITECO).
   DEBES sumar peaje + cargo por cada periodo para obtener el total de ese periodo.
   costeTotalPotencia = suma de TODOS los periodos (peajes + cargos de P1 a P6).
   NUNCA devuelvas solo la primera línea de potencia que encuentres — DEBES recorrer
   las 12 líneas (6 peajes + 6 cargos) y agregarlas.

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
   - Paso A: extrae totalFactura del "Total a Pagar" / "Total con Impuestos" impreso.
   - Paso B: suma (costeNetoConsumo + costeTotalPotencia + Σ otrosConceptos).
   - Paso C: compara B contra A.
   - Paso D: si |B − A| > 0.05€, RE-ESCANEA buscando conceptos omitidos hasta que coincida.
   - Paso E: valida que costeTotalPotencia ≈ (suma de TODAS las líneas "Potencia facturada
     peajes" + TODAS las líneas "Potencia facturada cargos"). Si solo has capturado 1–2
     líneas de potencia en una factura 3.0TD/6.1TD, te has dejado las demás — re-escanea.
   - Paso F: valida que Σ kwh de consumo[] = consumoTotalKwh. Si no, los kWh por periodo
     están mal extraídos (probablemente confundiste el flat "Precio horario" con P1).

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

/**
 * Normalize economics block after extraction:
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
  const eco: any = { ...economics }

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

  eco.validation = {
    computedTotal: round2(computed),
    declaredTotal: round2(totalFactura),
    diff: round2(diff),
    mathOk: totalFactura > 0 ? diff <= tolerance : null,
    warnings,
  }

  // Clean up internal flags before returning
  delete eco._kwhPeriodMismatch
  delete eco._potenciaItemsIncomplete

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
