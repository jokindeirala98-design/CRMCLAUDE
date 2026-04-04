import { NextRequest, NextResponse } from 'next/server'
import { normalizeCups } from '@/lib/utils/cups'

interface InvoiceAnalysisRequest {
  file_base64: string    // Base64-encoded file data sent directly from frontend
  file_type: string      // 'pdf' or 'image'
  file_name?: string     // Original filename for MIME type detection
}

// ── Basic supply identification fields ──────────────────────────────────────
export interface ExtractedInvoiceData {
  mode: 'gemini' | 'manual'
  // Supply identification
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
  // Economics data
  economics?: BillEconomics
  error?: string
}

// ── Full economics data extracted from the invoice ──────────────────────────
export interface ConsumoItem {
  periodo: string   // 'P1'...'P6'
  kwh: number
  precioKwh: number
  total: number
  precioEstimado?: boolean
}

export interface PotenciaItem {
  periodo: string   // 'P1'...'P6'
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
  fechaInicio?: string   // YYYY-MM-DD
  fechaFin?: string      // YYYY-MM-DD
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

/**
 * Robustly extract and parse JSON from Gemini's response.
 * Handles: ```json blocks, thinking prefixes, unescaped newlines in strings, etc.
 */
function safeParseGeminiJSON(raw: string): any {
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
  try {
    return JSON.parse(str)
  } catch (e) {
    // Continue to fixes
  }

  // 4. Fix unescaped newlines/tabs inside JSON string values
  str = str.replace(/"([^"]*?)"/g, (match) => {
    return match
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
  })

  // 5. Try again
  try {
    return JSON.parse(str)
  } catch (e) {
    // Continue to more aggressive fix
  }

  // 6. Most aggressive: rebuild line by line
  const lines = str.split('\n').map(l => l.trim()).filter(l => l)
  const rejoined = lines.join(' ')

  try {
    return JSON.parse(rejoined)
  } catch (e) {
    // Last resort
  }

  // 7. Last resort: use regex to extract key-value pairs
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

async function analyzeWithGemini(base64Data: string, mimeType: string): Promise<ExtractedInvoiceData> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return {
      mode: 'manual',
      error: 'GEMINI_API_KEY no configurada',
    }
  }

  try {
    console.log(`[Gemini] Analyzing file, mime: ${mimeType}, base64 length: ${base64Data.length}`)

    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Eres un experto en auditoria energetica espanola. Tu tarea es extraer datos de facturas de electricidad y gas con precision matematica total.

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
- Devuelve SOLO el JSON, sin texto antes ni despues.`,
              },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16384,
        },
      }),
    })

    const geminiData = await geminiResponse.json()

    if (!geminiResponse.ok) {
      console.error('[Gemini] API error status:', geminiResponse.status, JSON.stringify(geminiData).substring(0, 500))
      return {
        mode: 'manual',
        error: geminiData.error?.message || `Gemini API error: ${geminiResponse.status}`,
      }
    }

    // Check if we got valid candidates
    if (!geminiData.candidates || geminiData.candidates.length === 0) {
      console.error('[Gemini] No candidates in response:', JSON.stringify(geminiData).substring(0, 500))
      const blockReason = geminiData.promptFeedback?.blockReason
      return {
        mode: 'manual',
        error: blockReason ? `Gemini bloqueó la petición: ${blockReason}` : 'Gemini no devolvió resultados',
      }
    }

    const candidate = geminiData.candidates[0]

    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      console.warn('[Gemini] Unexpected finishReason:', candidate.finishReason)
    }

    const parts = candidate?.content?.parts || []

    console.log('[Gemini] === FULL RESPONSE DEBUG ===')
    console.log('[Gemini] Model:', geminiData.modelVersion)
    console.log('[Gemini] Parts count:', parts.length)
    parts.forEach((p: any, i: number) => {
      const keys = Object.keys(p)
      console.log(`[Gemini] Part ${i}: keys=${JSON.stringify(keys)}, thought=${p.thought}, textLen=${p.text?.length || 0}`)
      if (p.text) {
        console.log(`[Gemini] Part ${i} text (first 300):`, p.text.substring(0, 300))
      }
    })
    console.log('[Gemini] === END DEBUG ===')

    // Collect ALL text — prefer non-thinking parts with JSON
    let content = ''
    for (const part of parts) {
      if (part.text) {
        if (!part.thought && part.text.includes('{')) {
          content = part.text
          break
        }
        if (part.text.includes('{')) {
          content = part.text
        }
      }
    }
    if (!content) {
      content = parts.map((p: any) => p.text || '').join('\n').trim()
    }

    console.log('[Gemini] Selected content (first 500):', content?.substring(0, 500))

    if (!content) {
      console.error('[Gemini] No content in response:', JSON.stringify(geminiData).substring(0, 500))
      return {
        mode: 'manual',
        error: 'No response from Gemini API',
      }
    }

    // Parse JSON
    let extractedData: any
    try {
      extractedData = safeParseGeminiJSON(content)
    } catch (parseErr: any) {
      console.error('[Gemini] JSON parse failed:', parseErr.message)
      console.error('[Gemini] Full content was:', content)
      return {
        mode: 'manual',
        error: 'Error parseando respuesta de Gemini: ' + parseErr.message,
      }
    }
    console.log('[Gemini] Parsed data keys:', Object.keys(extractedData))

    const clean = (v: any) => (v && v !== 'null' && v !== 'N/A') ? String(v).trim() : undefined
    const cleanNum = (v: any): number | undefined => {
      if (v === null || v === undefined || v === 'null' || v === 'N/A') return undefined
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
      return isNaN(n) ? undefined : n
    }

    // Normalize tariff
    let tariff = clean(extractedData.tariff)
    if (tariff) {
      tariff = tariff.replace(/\s+/g, '').toUpperCase()
      const tariffMap: Record<string, string> = {
        '2.0': '2.0TD', '20TD': '2.0TD', '2.0A': '2.0TD', '2.0DHA': '2.0DHA',
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

    // ── Parse economics block ─────────────────────────────────────────────
    let economics: BillEconomics | undefined
    const eco = extractedData.economics
    if (eco && typeof eco === 'object') {
      // Parse consumo array
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

      // Parse potencia array
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

      // Parse otrosConceptos
      let otrosConceptos: OtroConcepto[] = []
      if (Array.isArray(eco.otrosConceptos)) {
        for (const item of eco.otrosConceptos) {
          const total = cleanNum(item.total)
          if (item.concepto && total !== undefined) {
            otrosConceptos.push({ concepto: String(item.concepto), total })
          }
        }
      }

      // ── Deduplication (from Antigravity engine) ──
      if (otrosConceptos.length > 0) {
        const seen = new Set<string>()
        otrosConceptos = otrosConceptos.filter(oc => {
          const fuzzyName = oc.concepto.toUpperCase()
            .replace(/DE\s+/g, '').replace(/\s+/g, '').replace(/[()]/g, '')
            .replace(/MÉTODO/g, '').replace(/CUARTOHORARIO/g, '').trim()
          const key = `${fuzzyName}-${oc.total}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        // Deduplicate power penalty variations with same total
        const powerSeen = new Set<number>()
        otrosConceptos = otrosConceptos.filter(oc => {
          const isExceso = oc.concepto.toUpperCase().includes('EXCESO') || oc.concepto.toUpperCase().includes('PENALIZACIÓN') || oc.concepto.toUpperCase().includes('PENALIZACION')
          if (isExceso) {
            if (powerSeen.has(oc.total)) return false
            powerSeen.add(oc.total)
          }
          return true
        })
      }

      // ── Derive totals ──
      const consumoTotalKwh = cleanNum(eco.consumoTotalKwh)
        ?? (consumo.length > 0 ? consumo.reduce((s, c) => s + c.kwh, 0) : undefined)

      // Gross/net/discount from Antigravity engine
      const costeBrutoConsumo = cleanNum(eco.costeBrutoConsumo)
        ?? (consumo.length > 0 ? consumo.reduce((s, c) => s + c.total, 0) : undefined)
      const descuentoEnergia = cleanNum(eco.descuentoEnergia) ?? 0
      const costeNetoConsumo = cleanNum(eco.costeNetoConsumo)
        ?? (costeBrutoConsumo !== undefined ? costeBrutoConsumo - descuentoEnergia : undefined)

      const costeTotalConsumo = cleanNum(eco.costeTotalConsumo)
        ?? costeNetoConsumo
        ?? (consumo.length > 0 ? consumo.reduce((s, c) => s + c.total, 0) : undefined)
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

    const result: ExtractedInvoiceData = {
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

    console.log('[Gemini] Final result supply fields OK, economics:', economics ? 'present' : 'absent')
    return result
  } catch (error) {
    console.error('[Gemini] First attempt failed:', error)

    // ── Retry once (from Antigravity engine pattern) ──
    try {
      console.warn('[Gemini] Retrying analysis...')
      const retryResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey!,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Extrae los datos de esta factura de energia en formato JSON. Incluye: holder_name, holder_cif_nif, cups, tariff, type (luz/gas), comercializadora, total_amount, billing_period, emission_date, y economics con consumo por periodo, potencia, otrosConceptos y totales. Devuelve SOLO JSON.' },
              { inlineData: { mimeType, data: base64Data } },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 16384 },
        }),
      })

      if (retryResponse.ok) {
        const retryData = await retryResponse.json()
        const parts = retryData.candidates?.[0]?.content?.parts || []
        let content = ''
        for (const part of parts) {
          if (part.text && !part.thought && part.text.includes('{')) { content = part.text; break }
          if (part.text && part.text.includes('{')) content = part.text
        }
        if (content) {
          const parsed = safeParseGeminiJSON(content)
          const clean = (v: any) => (v && v !== 'null' && v !== 'N/A') ? String(v).trim() : undefined
          console.log('[Gemini] Retry succeeded, keys:', Object.keys(parsed))

          // ── Build economics from retry response (same logic as primary path) ──
          let retryEconomics: ExtractedInvoiceData['economics'] = undefined
          const eco = parsed.economics || parsed
          if (eco) {
            const cleanNum = (v: any): number | undefined => {
              if (v === null || v === undefined || v === '' || v === 'N/A') return undefined
              const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
              return isNaN(n) ? undefined : n
            }

            let consumo: ConsumoItem[] = []
            if (Array.isArray(eco.consumo)) {
              consumo = eco.consumo.filter((c: any) => c && c.periodo).map((c: any) => ({
                periodo: String(c.periodo).toUpperCase(),
                kwh: cleanNum(c.kwh) ?? 0,
                precioKwh: cleanNum(c.precioKwh) ?? 0,
                total: cleanNum(c.total) ?? 0,
              }))
            }

            let potencia: PotenciaItem[] = []
            if (Array.isArray(eco.potencia)) {
              potencia = eco.potencia.filter((p: any) => p && p.periodo).map((p: any) => ({
                periodo: String(p.periodo).toUpperCase(),
                kw: cleanNum(p.kw) ?? cleanNum(p.kwContratados) ?? 0,
                precioKwDia: cleanNum(p.precioKwDia) ?? cleanNum(p.precioKwAnual) ?? 0,
                dias: cleanNum(p.dias) ?? 30,
                total: cleanNum(p.total) ?? 0,
              }))
            }

            let otrosConceptos: OtroConcepto[] = []
            if (Array.isArray(eco.otrosConceptos)) {
              otrosConceptos = eco.otrosConceptos.filter((oc: any) => oc && oc.concepto).map((oc: any) => ({
                concepto: String(oc.concepto),
                total: cleanNum(oc.total) ?? 0,
              }))
            }

            const consumoTotalKwh = cleanNum(eco.consumoTotalKwh)
              ?? (consumo.length > 0 ? consumo.reduce((s, c) => s + c.kwh, 0) : undefined)
            const costeTotalConsumo = cleanNum(eco.costeTotalConsumo) ?? cleanNum(eco.costeNetoConsumo)
              ?? (consumo.length > 0 ? consumo.reduce((s, c) => s + c.total, 0) : undefined)
            const costeTotalPotencia = cleanNum(eco.costeTotalPotencia)
              ?? (potencia.length > 0 ? potencia.reduce((s, p) => s + p.total, 0) : undefined)
            const costeMedioKwh = cleanNum(eco.costeMedioKwh)
              ?? (consumoTotalKwh && costeTotalConsumo && consumoTotalKwh > 0 ? costeTotalConsumo / consumoTotalKwh : undefined)
            const totalFactura = cleanNum(eco.totalFactura) ?? cleanNum(parsed.total_amount)

            if (totalFactura || consumo.length > 0 || potencia.length > 0) {
              retryEconomics = {
                fechaInicio: clean(eco.fechaInicio),
                fechaFin: clean(eco.fechaFin),
                titular: clean(eco.titular),
                comercializadora: clean(eco.comercializadora),
                cups: clean(eco.cups),
                tarifa: clean(eco.tarifa),
                consumo: consumo.length > 0 ? consumo : undefined,
                potencia: potencia.length > 0 ? potencia : undefined,
                otrosConceptos: otrosConceptos.length > 0 ? otrosConceptos : undefined,
                consumoTotalKwh,
                costeTotalConsumo,
                costeMedioKwh,
                costeTotalPotencia,
                totalFactura,
              }
              console.log('[Gemini] Retry economics: present, totalFactura:', totalFactura)
            }
          }

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
            economics: retryEconomics,
          }
        }
      }
    } catch (retryErr) {
      console.error('[Gemini] Retry also failed:', retryErr)
    }

    return {
      mode: 'manual',
      error: error instanceof Error ? error.message : 'Unknown error during analysis',
    }
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ExtractedInvoiceData>> {
  try {
    const body = await request.json() as InvoiceAnalysisRequest

    const { file_base64, file_type, file_name } = body

    if (!file_base64) {
      return NextResponse.json(
        { mode: 'manual', error: 'file_base64 is required' } as ExtractedInvoiceData,
        { status: 400 }
      )
    }

    // Determine MIME type
    let mimeType = 'image/jpeg'
    const name = (file_name || '').toLowerCase()
    if (file_type === 'pdf' || name.endsWith('.pdf')) {
      mimeType = 'application/pdf'
    } else if (name.endsWith('.png')) {
      mimeType = 'image/png'
    } else if (name.endsWith('.webp')) {
      mimeType = 'image/webp'
    }

    const result = await analyzeWithGemini(file_base64, mimeType)
    return NextResponse.json(result)
  } catch (error) {
    console.error('API route error:', error)
    return NextResponse.json(
      {
        mode: 'manual',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ExtractedInvoiceData,
      { status: 500 }
    )
  }
}
