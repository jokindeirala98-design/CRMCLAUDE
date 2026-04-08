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
          generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(50000),
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

LUZ-1. **Campos derivados consumo[] y potencia[]:**
   Además de rawLineItems, devuelve también los arrays agregados consumo[] y potencia[]
   por comodidad del frontend. El post-procesado en el backend los recalculará desde
   rawLineItems de todas formas, así que prioriza la COMPLETITUD de rawLineItems sobre
   la perfección de estos arrays.

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
    const diasFacturados = (gTermFijo[0]?.dias || gPeajeFijo[0]?.dias || 0)
    const terminoFijoDiario = diasFacturados > 0 ? terminoFijoTotal / diasFacturados : 0

    out.supply_type = out.supply_type || 'gas'
    out.consumoTotalKwh = round2(consumoKwhGas)
    out.costeBrutoConsumo = round2(costeBrutoGas)
    out.descuentoEnergia = round2(sumTotal(gDesc))
    out.costeNetoConsumo = round2(costeBrutoGas - sumTotal(gDesc))
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
      costeBrutoGas + terminoFijoTotal + sumTotal(gHidro) + sumTotal(gAlq) + sumTotal(gIva) - sumTotal(gDesc)
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

  // ── ENERGY ────────────────────────────────────────────────────────────
  const energiaComer = byCat('energia_comercializacion')
  const energiaPeajes = byCat('energia_peaje')
  const energiaCargos = byCat('energia_cargo')
  const descEnergiaItems = byCat('descuento_energia')

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
  const descuentoEnergia = sumTotal(descEnergiaItems)
  const costeNetoConsumo = costeBrutoConsumo - descuentoEnergia

  out.consumo = consumo
  out.consumoTotalKwh = round2(totalKwh)
  out.costeBrutoConsumo = round2(costeBrutoConsumo)
  out.descuentoEnergia = round2(descuentoEnergia)
  out.costeNetoConsumo = round2(costeNetoConsumo)
  out.costeTotalConsumo = round2(costeNetoConsumo)

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
    const precioKwDia = kw && dias ? total / (kw * dias) : null
    potencia.push({
      periodo: p,
      kw,
      dias,
      precioKwDia: precioKwDia != null ? round4(precioKwDia) : null,
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
