/**
 * DOCX Template Filler — Voltis Energía
 *
 * Replaces X-only placeholders in Word documents with real values.
 * Each template has a known, ordered sequence of placeholders identified
 * by running the placeholder analysis scripts.
 *
 * Templates:
 *   b1_directo_contrato.docx   — B1 empresa, 25% cobro directo (pago único)
 *   b1_directo_propuesta.docx  — Propuesta asociada al anterior
 *   25en4_contrato.docx        — 25%, pago 50% inicial + 50% trimestral en 4
 *   25en4_propuesta.docx       — Propuesta asociada al anterior
 */

import JSZip from 'jszip'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContractType = 'b1_directo' | '25en4'

export interface ContractTemplateData {
  // Identification
  contractType: ContractType

  // Location & dates
  city: string            // "Pamplona"
  contractDay: string     // "14"
  contractMonth: string   // "abril"
  contractYear2: string   // "26"  (last 2 digits)

  // Client representative
  repName: string         // "Juan García López"
  repDni: string          // "12345678A"

  // Company
  companyName: string     // "Empresa S.L." | same as repName for particulares
  companyCif: string      // "B12345678"
  fiscalAddress: string   // "Calle Mayor 1, 31001 Pamplona"

  // Service dates
  startDay: string        // "14"
  startMonth: string      // "abril"
  startYear2: string      // "26"
  paymentDay: string      // "14"
  paymentMonth: string    // "julio"   (B1: full month name for "de XXXX de")
  paymentYear: string     // "2026"    (B1 only, full 4-digit year)
  paymentYear2: string    // "26"      (25en4 only, last 2 digits via "de 20XX")

  // Economics
  feePercent: string      // "25"
  annualFeeEur: string    // "1250"   (without € or IVA)
  estimatedSavings: string // "5000"  (for propuesta)

  // Duration (for propuesta)
  endDay: string          // "30"
  endMonth: string        // "abril"
  endYear2: string        // "27"

  // Tariff (for propuesta)
  tariffPrefix: string    // "2.0"  → "2.0TD"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function spanishDate(d: Date): { day: string; month: string; year2: string; year4: string; monthName: string } {
  return {
    day: String(d.getDate()),
    month: MONTHS_ES[d.getMonth()],
    monthName: MONTHS_ES[d.getMonth()],
    year2: String(d.getFullYear()).slice(-2),
    year4: String(d.getFullYear()),
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Replace standalone X-only <w:t> elements in order.
 * Pattern: <w:t ...>XX...</w:t> where content is only X's (and optional whitespace).
 */
function replaceStandaloneXPlaceholders(xmlContent: string, values: string[]): string {
  let idx = 0
  return xmlContent.replace(
    /(<w:t(?:[^>]*)>)(X{2,}\s*)(<\/w:t>)/g,
    (match, openTag, _xs, closeTag) => {
      if (idx < values.length) {
        return `${openTag}${escapeXml(values[idx++])}${closeTag}`
      }
      return match
    },
  )
}

/**
 * Load a template buffer, apply ordered replacements to document.xml,
 * and return the modified DOCX as a Buffer.
 */
async function fillDocxBuffer(
  templateBuffer: Buffer,
  orderedValues: string[],
  inlineReplacements: Array<[string, string]> = [],
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuffer)

  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Invalid DOCX: word/document.xml not found')

  let content = await docFile.async('string')

  // 1. Replace standalone X-only placeholders in order
  content = replaceStandaloneXPlaceholders(content, orderedValues)

  // 2. Apply targeted inline replacements (for XXXXX embedded in longer text nodes)
  for (const [search, replace] of inlineReplacements) {
    content = content.split(search).join(replace)
  }

  zip.file('word/document.xml', content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------------------
// Template-specific fillers
// ---------------------------------------------------------------------------

function loadTemplate(filename: string): Buffer {
  const templateDir = path.join(process.cwd(), 'public', 'contract-templates')
  return fs.readFileSync(path.join(templateDir, filename))
}

/**
 * Fill B1 Directo — CONTRATO
 * 28 ordered placeholders (see analysis map)
 */
async function fillB1DirectoContrato(d: ContractTemplateData): Promise<Buffer> {
  const ordered = [
    d.city,           // [0]  En CITY, a...
    d.contractDay,    // [1]  día del contrato
    d.contractMonth,  // [2]  mes del contrato
    d.contractYear2,  // [3]  año (2 dig.)
    d.repName,        // [4]  Don/Doña REPNAME
    d.repDni,         // [5]  DNI
    d.companyName,    // [6]  nombre empresa
    d.companyCif,     // [7]  CIF empresa
    d.fiscalAddress,  // [8]  domicilio
    d.companyName,    // [9]  ref propuesta (Propuesta ... – COMPANY)
    d.contractDay,    // [10] día aceptación propuesta (=contractDay)
    d.contractMonth,  // [11] mes aceptación
    d.contractYear2,  // [12] año aceptación
    d.startDay,       // [13] fecha inicio servicio día
    d.startMonth,     // [14] mes inicio
    d.startYear2,     // [15] año inicio
    d.paymentDay,     // [16] día primer pago
    d.paymentMonth,   // [17] mes primer pago (full name — "XXXX de" pattern)
    d.paymentYear,    // [18] año primer pago (full 4 digits — "XXXX.")
    d.feePercent,     // [19] % honorarios (CUARTA)
    d.companyName,    // [20] empresa en ref Propuesta (CUARTA)
    d.annualFeeEur,   // [21] importe honorarios €
    d.feePercent,     // [22] % equivalente
    d.annualFeeEur,   // [23] QUINTA: "XXXXX euros" — importe pago anual
    d.feePercent,     // [24] % regularización positiva
    d.feePercent,     // [25] % regularización negativa
    d.companyName,    // [26] nombre firma CLIENTE
    d.repName,        // [27] D. REPNAME firma
  ]
  return fillDocxBuffer(loadTemplate('b1_directo_contrato.docx'), ordered)
}

/**
 * Fill B1 Directo — PROPUESTA
 * Title inline + 8 ordered placeholders
 */
async function fillB1DirectoPropuesta(d: ContractTemplateData): Promise<Buffer> {
  const ordered = [
    d.estimatedSavings, // [0]  ahorro aproximado de SAVINGS€
    d.companyName,      // [1]  suministros eléctricos de COMPANY
    d.companyName,      // [2]  empleados de COMPANY
    d.companyName,      // [3]  terceros hechas a COMPANY
    d.endDay,           // [4]  hasta el DIA de
    d.endMonth,         // [5]  de MONTH de 20
    d.endYear2,         // [6]  20YEAR
    d.annualFeeEur,     // [7]  minuta anual XXXX€
  ]
  // Inline: title "Propuesta de colaboración Voltis Energía – XXXXXXX.:"
  const inlineReplacements: Array<[string, string]> = [
    ['XXXXXXX.', `${escapeXml(d.companyName)}.`],
  ]
  return fillDocxBuffer(loadTemplate('b1_directo_propuesta.docx'), ordered, inlineReplacements)
}

/**
 * Fill 25%en4 — CONTRATO
 * 22 ordered placeholders + 1 inline (payment year hardcoded as 20XX + inline amount)
 */
async function fill25En4Contrato(d: ContractTemplateData): Promise<Buffer> {
  // 25%en4 has payment year as '20XX' text node (not pure X placeholder)
  // and 25% is hardcoded. Also initial payment (50%) is inline.
  const halfFee = Math.round(parseFloat(d.annualFeeEur) / 2).toString()

  const ordered = [
    d.city,           // [0]  En CITY
    d.contractDay,    // [1]
    d.contractMonth,  // [2]
    d.contractYear2,  // [3]
    d.repName,        // [4]
    d.repDni,         // [5]
    d.companyName,    // [6]
    d.companyCif,     // [7]  (template has trailing space — preserved)
    d.fiscalAddress,  // [8]
    d.companyName,    // [9]  propuesta ref
    d.contractDay,    // [10] aceptación
    d.contractMonth,  // [11]
    d.contractYear2,  // [12]
    d.startDay,       // [13]
    d.startMonth,     // [14]
    d.startYear2,     // [15]
    d.paymentDay,     // [16]
    d.paymentMonth,   // [17] mes pago
    // NOTE: payment year uses '20XX' text node → inline replace below
    d.companyName,    // [18] ref propuesta en CUARTA
    d.annualFeeEur,   // [19] honorarios €
    d.companyName,    // [20] firma
    d.repName,        // [21] D. REPNAME firma
  ]

  const inlineReplacements: Array<[string, string]> = [
    // Payment year: '20XX' hardcoded text node → replace XX with year
    ['>20XX<', `>20${escapeXml(d.paymentYear2)}<`],
    // 50% initial payment amount embedded in text
    ['honorarios: XXXXX \u20ac euros', `honorarios: ${escapeXml(halfFee)} \u20ac euros`],
  ]

  return fillDocxBuffer(loadTemplate('25en4_contrato.docx'), ordered, inlineReplacements)
}

/**
 * Fill 25%en4 — PROPUESTA
 * 10 ordered placeholders
 */
async function fill25En4Propuesta(d: ContractTemplateData): Promise<Buffer> {
  const ordered = [
    d.companyName,      // [0]  title: Propuesta ... – COMPANY.:
    d.estimatedSavings, // [1]  ahorro de SAVINGS€
    d.companyName,      // [2]  suministros eléctricos de COMPANY
    d.tariffPrefix,     // [3]  Las tarifas XXX TD
    d.companyName,      // [4]  empleados de COMPANY
    d.companyName,      // [5]  terceros hechas a COMPANY
    d.endDay,           // [6]  hasta el DIA
    d.endMonth,         // [7]  de MONTH
    d.endYear2,         // [8]  20YEAR
    d.annualFeeEur,     // [9]  minuta anual XXXXXX€
  ]
  return fillDocxBuffer(loadTemplate('25en4_propuesta.docx'), ordered)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FilledContractBuffers {
  contrato: Buffer
  propuesta: Buffer
}

/**
 * Fill both Contrato + Propuesta for the given contract type and data.
 * Returns both as Buffers ready for upload to SignWell.
 */
export async function fillContractTemplates(data: ContractTemplateData): Promise<FilledContractBuffers> {
  if (data.contractType === 'b1_directo') {
    const [contrato, propuesta] = await Promise.all([
      fillB1DirectoContrato(data),
      fillB1DirectoPropuesta(data),
    ])
    return { contrato, propuesta }
  } else {
    const [contrato, propuesta] = await Promise.all([
      fill25En4Contrato(data),
      fill25En4Propuesta(data),
    ])
    return { contrato, propuesta }
  }
}

/**
 * Build ContractTemplateData from CRM subscription/client objects.
 * Handles empresa vs particular types.
 */
export function buildTemplateData(params: {
  contractType: ContractType
  client: {
    name: string
    type: string
    cif?: string | null
    nif?: string | null
    fiscal_address?: string | null
  }
  repName: string       // representative name (for empresa; same as client.name for particular)
  repDni: string        // representative DNI/NIF
  annualAmount: number  // annual fee in euros (excl. IVA)
  totalSavings: number  // estimated savings in euros
  tariff?: string       // e.g. "2.0TD"
  city?: string
  startDate?: Date
  paymentDate?: Date
  endDate?: Date
}): ContractTemplateData {
  const now = new Date()
  const start = params.startDate || now
  const payment = params.paymentDate || new Date(now.getFullYear(), now.getMonth() + 3, now.getDate())
  const end = params.endDate || new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())

  const contractDt = spanishDate(now)
  const startDt = spanishDate(start)
  const paymentDt = spanishDate(payment)
  const endDt = spanishDate(end)

  const isEmpresa = params.client.type === 'empresa' || params.client.type === 'ayuntamiento'
  const companyName = params.client.name
  const cif = params.client.cif || params.client.nif || ''
  const address = params.client.fiscal_address || ''
  const city = params.city || (address.split(',').pop()?.trim() || 'Pamplona')
  const tariffPrefix = (params.tariff || '2.0TD').replace('TD', '').replace('RL', '').trim()

  return {
    contractType: params.contractType,
    city,
    contractDay: contractDt.day,
    contractMonth: contractDt.month,
    contractYear2: contractDt.year2,
    repName: params.repName,
    repDni: params.repDni,
    companyName: isEmpresa ? companyName : params.repName,
    companyCif: cif,
    fiscalAddress: address,
    startDay: startDt.day,
    startMonth: startDt.month,
    startYear2: startDt.year2,
    paymentDay: paymentDt.day,
    paymentMonth: paymentDt.month,
    paymentYear: paymentDt.year4,
    paymentYear2: paymentDt.year2,
    feePercent: '25',
    annualFeeEur: Math.round(params.annualAmount).toString(),
    estimatedSavings: Math.round(params.totalSavings || params.annualAmount * 4).toString(),
    endDay: endDt.day,
    endMonth: endDt.month,
    endYear2: endDt.year2,
    tariffPrefix,
  }
}
