/**
 * CUPS (Codigo Universal de Punto de Suministro) utilities
 *
 * CUPS format: ES + 4 digits (distributor) + 12 digits (point) + 2 control chars + optional 2 suffix
 * Base length: 20 chars (ES + 16 digits + 2 control)
 * Full length: 20 or 22 chars (with optional suffix)
 *
 * For SIPS queries and DB storage, always use the 20-char base.
 */

const CUPS_REGEX = /^ES\d{16}[A-Z0-9]{2}([A-Z0-9]{2})?$/

/**
 * Normalize a CUPS code to its canonical 20-char form.
 * - Trims whitespace
 * - Converts to uppercase
 * - ALWAYS strips to 20 chars (removes 2-char suffix if 22)
 * - Returns null only if clearly not a CUPS (too short or doesn't start with ES)
 *
 * IMPORTANT: Invoices often include the 22-char version. The real CUPS
 * is always the first 20 characters. The last 2 are a tariff suffix.
 */
export function normalizeCups(cups: string | null | undefined): string | null {
  if (!cups) return null
  const clean = cups.trim().toUpperCase().replace(/\s+/g, '')
  if (clean.length < 20) return null
  if (!clean.startsWith('ES')) return null

  // ALWAYS take exactly 20 chars — drop suffix if 22
  const base = clean.substring(0, 20)

  // Validate format: ES + 16 digits + 2 alphanumeric control chars
  // If strict validation fails, still return the 20-char base as long as
  // it starts with ES and has enough chars (OCR can sometimes misread digits)
  if (/^ES\d{16}[A-Z0-9]{2}$/.test(base)) {
    return base
  }

  // Lenient: ES + 18 alphanumeric chars (OCR may read O as 0, etc.)
  if (/^ES[A-Z0-9]{18}$/.test(base)) {
    return base
  }

  return null
}

/**
 * Validate that a string looks like a valid CUPS code.
 * Accepts 20-22 char formats.
 */
export function isValidCups(cups: string | null | undefined): boolean {
  if (!cups) return false
  const clean = cups.trim().toUpperCase().replace(/\s+/g, '')
  return CUPS_REGEX.test(clean)
}

/**
 * Extract CUPS from a string that might contain extra text.
 * Useful for OCR results that include surrounding text.
 */
export function extractCups(text: string): string | null {
  const match = text.match(/ES\d{16}[A-Z0-9]{2,4}/i)
  if (!match) return null
  return normalizeCups(match[0])
}
