/**
 * IDENTITY EXTRACTOR
 * ──────────────────
 * Specialized Gemini-based extractor for IDENTITY DOCUMENTS.
 * Completely separate from the invoice extractor in gemini.ts.
 *
 * Handles three Spanish document types:
 *   1. DNI español (frente y/o dorso) — particular ID card
 *   2. CIF empresa — company tax identification certificate
 *   3. Certificado de titularidad bancaria — bank account ownership cert
 *
 * Returns a normalized shape that the ClientDetailModal can map directly
 * onto the `clients` table fields.
 */

import { callGemini, safeParseGeminiJSON } from '@/lib/gemini'

export type IdentityDocType = 'dni' | 'cif' | 'cert_bancario' | 'desconocido'

export interface ExtractedIdentityData {
  mode: 'gemini' | 'manual'
  documentType: IdentityDocType
  // Particular (DNI)
  first_name?: string
  last_name?: string
  full_name?: string
  dni?: string
  birth_date?: string          // DD/MM/YYYY
  expiration_date?: string     // DD/MM/YYYY
  nationality?: string
  // Empresa (CIF)
  company_name?: string
  cif?: string
  // Common
  fiscal_address?: string
  // Bank certificate
  iban?: string
  bank_name?: string
  account_holder?: string
  account_holder_id?: string   // CIF/NIF of the account holder if visible
  // Generic
  raw_text?: string
  error?: string
}

const IDENTITY_PROMPT = `Eres un experto en documentos de identidad españoles. Tu tarea es identificar el tipo de documento y extraer sus datos con PRECISIÓN ABSOLUTA. Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional.

════════════════════════════════════════════════════════════════════════════
TIPOS DE DOCUMENTO QUE RECONOCES (SOLO ESTOS 3)
════════════════════════════════════════════════════════════════════════════

1. **DNI español** (Documento Nacional de Identidad):
   - Tarjeta plástica con bandera y "DNI" o "Documento Nacional de Identidad"
   - Frente: foto, NOMBRE, APELLIDOS, sexo, nacionalidad ESP, fecha nacimiento, número DNI (8 dígitos + letra)
   - Dorso: dirección, ciudad, provincia, indicación de validez, MRZ (zona de lectura mecánica con < < <)
   - documentType: "dni"

2. **CIF / Tarjeta de identificación fiscal de empresa**:
   - Documento de la AEAT con "Número de Identificación Fiscal" o "Tarjeta acreditativa del NIF"
   - Contiene: razón social (empresa), CIF/NIF empresa (formato: 1 letra + 7 dígitos + 1 dígito o letra, ej. B12345678), domicilio fiscal
   - documentType: "cif"

3. **Certificado de titularidad bancaria**:
   - Documento del banco (Santander, BBVA, La Caixa, Sabadell, Caja Rural, etc.) que certifica que una cuenta IBAN pertenece a un titular concreto
   - Contiene: IBAN completo (formato: ES + 22 dígitos, normalmente con espacios cada 4), nombre del titular, NIF/CIF del titular, nombre del banco, fecha del certificado
   - documentType: "cert_bancario"

Si el documento NO es ninguno de estos tres → documentType: "desconocido"

════════════════════════════════════════════════════════════════════════════
REGLAS DE EXTRACCIÓN
════════════════════════════════════════════════════════════════════════════

- Devuelve los datos EXACTOS tal como aparecen en el documento. No inventes nada.
- Si un campo no aparece, omítelo del JSON (no pongas "" ni null).
- Para nombres en mayúsculas en el documento, mantén la capitalización del documento.
- DNI español: el número siempre tiene 8 dígitos + 1 letra (ej. "12345678Z"). Devuélvelo sin espacios.
- CIF empresa: formato letra + 7 dígitos + control (ej. "B12345678", "A28017895"). Devuélvelo sin espacios.
- IBAN: formato ES + 22 dígitos (24 caracteres totales). Devuélvelo SIN espacios.
- Direcciones fiscales: incluye calle, número, código postal, ciudad y provincia si aparecen.
- Nombre completo: si en el DNI ves "GARCÍA LÓPEZ, JUAN" → first_name="JUAN", last_name="GARCÍA LÓPEZ", full_name="JUAN GARCÍA LÓPEZ".

════════════════════════════════════════════════════════════════════════════
FORMATO JSON DE RESPUESTA
════════════════════════════════════════════════════════════════════════════

Para DNI:
{
  "documentType": "dni",
  "first_name": "JUAN",
  "last_name": "GARCÍA LÓPEZ",
  "full_name": "JUAN GARCÍA LÓPEZ",
  "dni": "12345678Z",
  "birth_date": "01/01/1980",
  "expiration_date": "01/01/2030",
  "nationality": "ESP",
  "fiscal_address": "C/ MAYOR 12, 31001 PAMPLONA, NAVARRA"
}

Para CIF empresa:
{
  "documentType": "cif",
  "company_name": "AYUNTAMIENTO DE VILLATUERTA",
  "cif": "P3125700I",
  "fiscal_address": "PLAZA DE LOS FUEROS 1, 31132 VILLATUERTA, NAVARRA"
}

Para certificado de titularidad bancaria:
{
  "documentType": "cert_bancario",
  "iban": "ES7630080000000000000000",
  "bank_name": "CAJA RURAL DE NAVARRA",
  "account_holder": "AYUNTAMIENTO DE VILLATUERTA",
  "account_holder_id": "P3125700I",
  "fiscal_address": "PLAZA DE LOS FUEROS 1, 31132 VILLATUERTA, NAVARRA"
}

Si no es ninguno de los tres:
{ "documentType": "desconocido" }
`

/**
 * Analyze an identity document (DNI / CIF / cert bancario) using Gemini.
 * Returns a normalized shape ready to merge into the clients table.
 */
export async function analyzeIdentityDocument(
  base64Data: string,
  mimeType: string
): Promise<ExtractedIdentityData> {
  try {
    const raw = await callGemini(IDENTITY_PROMPT, base64Data, mimeType)
    const parsed = safeParseGeminiJSON(raw) || {}

    const docType = String(parsed.documentType || 'desconocido').toLowerCase()
    if (!['dni', 'cif', 'cert_bancario', 'desconocido'].includes(docType)) {
      return { mode: 'gemini', documentType: 'desconocido', error: `Tipo no reconocido: ${docType}` }
    }

    const out: ExtractedIdentityData = {
      mode: 'gemini',
      documentType: docType as IdentityDocType,
    }

    // Pass-through string fields, trimming and dropping empties
    const fields: (keyof ExtractedIdentityData)[] = [
      'first_name', 'last_name', 'full_name', 'dni', 'birth_date',
      'expiration_date', 'nationality', 'company_name', 'cif',
      'fiscal_address', 'iban', 'bank_name', 'account_holder',
      'account_holder_id', 'raw_text',
    ]
    for (const f of fields) {
      const v = parsed[f]
      if (v != null && String(v).trim() && String(v).trim().toUpperCase() !== 'N/A') {
        ;(out as any)[f] = String(v).trim()
      }
    }

    // Normalize IBAN: strip spaces
    if (out.iban) out.iban = out.iban.replace(/\s+/g, '').toUpperCase()
    // Normalize DNI/CIF: strip spaces, uppercase
    if (out.dni) out.dni = out.dni.replace(/\s+/g, '').toUpperCase()
    if (out.cif) out.cif = out.cif.replace(/\s+/g, '').toUpperCase()
    if (out.account_holder_id) {
      out.account_holder_id = out.account_holder_id.replace(/\s+/g, '').toUpperCase()
    }

    return out
  } catch (e: any) {
    return {
      mode: 'manual',
      documentType: 'desconocido',
      error: e?.message || 'Error al analizar el documento',
    }
  }
}
