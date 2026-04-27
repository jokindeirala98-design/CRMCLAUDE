/**
 * CUPS (Codigo Universal de Punto de Suministro) utilities
 *
 * Valid Spanish CUPS formats:
 *   Short (20 chars): ES + 16 digits + 2 control letters
 *   Long  (22 chars): ES + 16 digits + 2 control letters + 2 suffix chars (e.g. "0F")
 *
 * INVALID lengths: 19, 21, 23 chars — these are always truncated extractions.
 *
 * DB storage: always store the FULL CUPS as it appears on the invoice (20 or 22 chars).
 * SIPS queries: use cupsBase20() to strip the suffix for API calls that need just 20 chars.
 */

/** Full CUPS regex: 20 or 22 chars */
const CUPS_REGEX_FULL = /^ES[A-Z0-9]{18}([A-Z0-9]{2})?$/

/**
 * Normalize a CUPS code to its canonical form, preserving the full 20- or 22-char length.
 *
 * - Trims whitespace and converts to uppercase
 * - Rejects CUPS with odd character count (19, 21, 23 chars) — always truncation errors
 * - Accepts 20 chars (standard) or 22 chars (with suffix like "0F")
 * - Returns null if the string is clearly not a valid CUPS
 */
export function normalizeCups(cups: string | null | undefined): string | null {
  if (!cups) return null
  const clean = cups.trim().toUpperCase().replace(/\s+/g, '')

  if (!clean.startsWith('ES')) return null
  if (clean.length < 18 || clean.length > 24) return null

  // Odd-length CUPS are always truncation errors (19, 21, 23 chars):
  // A 21-char CUPS is a 22-char CUPS missing its last character.
  // A 19-char CUPS is a 20-char CUPS missing its last character.
  // Reject them — better to store null than a wrong CUPS that creates duplicate supplies.
  if (clean.length % 2 !== 0) {
    console.warn(`[normalizeCups] Rejected odd-length CUPS (${clean.length} chars, likely truncated): ${clean}`)
    return null
  }

  // Accept exactly 20 or 22 chars
  if (clean.length !== 20 && clean.length !== 22) return null

  // Strict validation: ES + 16 digits + 2 control letters [+ optional 2 suffix]
  if (/^ES\d{16}[A-Z]{2}([A-Z0-9]{2})?$/.test(clean)) return clean

  // Lenient validation (OCR may confuse O/0, l/1): ES + 18+ alphanumeric
  if (/^ES[A-Z0-9]{18}([A-Z0-9]{2})?$/.test(clean)) return clean

  return null
}

/**
 * Return the 20-char base CUPS (strips the optional 2-char suffix).
 * Use this for SIPS API queries that only accept the base format.
 */
export function cupsBase20(cups: string | null | undefined): string | null {
  const normalized = normalizeCups(cups)
  if (!normalized) return null
  return normalized.substring(0, 20)
}

/**
 * Validate that a string looks like a valid CUPS code (20 or 22 chars).
 */
export function isValidCups(cups: string | null | undefined): boolean {
  return normalizeCups(cups) !== null
}

/**
 * Extract CUPS from a string that might contain extra text.
 * Useful for OCR results that include surrounding text.
 * Always tries to extract the longest valid match (22 chars preferred over 20).
 */
export function extractCups(text: string): string | null {
  if (!text) return null

  // Try 22-char match first (longer = more complete)
  const match22 = text.match(/ES\d{16}[A-Z]{2}[A-Z0-9]{2}/i)
  if (match22) {
    const result = normalizeCups(match22[0])
    if (result) return result
  }

  // Fall back to 20-char match
  const match20 = text.match(/ES\d{16}[A-Z]{2}/i)
  if (match20) {
    const result = normalizeCups(match20[0])
    if (result) return result
  }

  // Lenient: any ES + 18-22 alphanumeric sequence
  const matchLenient = text.match(/ES[A-Z0-9]{18,20}/i)
  if (matchLenient) return normalizeCups(matchLenient[0])

  return null
}
