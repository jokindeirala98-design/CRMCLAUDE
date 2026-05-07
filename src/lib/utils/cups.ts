/**
 * CUPS (Codigo Universal de Punto de Suministro) utilities
 *
 * Canonical format: ALWAYS 20 chars
 *   ES (2) + distributor code (4) + 12-digit supply point + 2 control letters
 *
 * Other lengths handled:
 *   22 chars → strip last 2 (ICP/meter suffix, e.g. "0F") → 20 chars
 *   24 chars → strip last 4 → 20 chars
 *   19, 21, 23 chars → always truncation errors, rejected
 *
 * DB storage: always 20 chars — the 2-char suffix is not part of the CUPS.
 * SIPS queries: use cupsBase20() — the SIPS API only accepts the 20-char form.
 */

/**
 * Normalize a CUPS code to its canonical form.
 *
 * Rules:
 *   - Strips whitespace, converts to uppercase
 *   - 24 chars → truncated to 22 (Gemini sometimes appends 2 extra characters)
 *   - Rejects odd-length CUPS (19, 21, 23) — always OCR truncation errors
 *   - Accepts 20 chars (standard without suffix) or 22 chars (with ICP suffix)
 *   - Returns null if not a recognisable CUPS
 */
export function normalizeCups(cups: string | null | undefined): string | null {
  if (!cups) return null
  let clean = cups.trim().toUpperCase().replace(/\s+/g, '')

  if (!clean.startsWith('ES')) return null
  if (clean.length < 18 || clean.length > 24) return null

  // Business rule: canonical CUPS is always 20 chars.
  // Strip any ICP/meter suffix (the last 2 chars beyond position 20).
  if (clean.length === 22) {
    clean = clean.substring(0, 20)
    console.log(`[normalizeCups] Stripped 2-char suffix from 22-char CUPS → 20: ${clean}`)
  }
  if (clean.length === 24) {
    clean = clean.substring(0, 20)
    console.log(`[normalizeCups] Stripped 4-char suffix from 24-char CUPS → 20: ${clean}`)
  }

  // Odd-length CUPS are always truncation errors — reject.
  if (clean.length % 2 !== 0) {
    console.warn(`[normalizeCups] Rejected odd-length CUPS (${clean.length} chars, likely truncated): ${clean}`)
    return null
  }

  // Accept exactly 20 chars
  if (clean.length !== 20) return null

  // Strict validation: ES + 16 alphanumeric + 2 control letters
  if (!/^ES[A-Z0-9]{16}[A-Z]{2}$/.test(clean)) return null

  // ── Supply point sanity check ──────────────────────────────────────────────
  // The 12-character supply point identifier occupies positions 6–17.
  // A real identifier always contains at least one non-zero digit.
  // All-zero identifiers (e.g. "000000000000") are physically impossible and
  // indicate an OCR/Gemini hallucination — reject them.
  //
  // Example of garbage: ES0020000000000000TW0P → supply point = "000000000000" → rejected
  // Example of valid:   ES0021000006751517CW0F → supply point = "000006751517" → accepted
  const pointId = clean.substring(6, 18)
  if (/^0+$/.test(pointId)) {
    console.warn(`[normalizeCups] Rejected CUPS with all-zero supply point identifier: ${clean}`)
    return null
  }

  // ── Distributor code sanity check ─────────────────────────────────────────
  // Positions 2–5 hold the 4-digit distributor code (e.g. "0021" for I-DE Navarra).
  // A distributor code of "0000" is never assigned — another hallucination signal.
  const distCode = clean.substring(2, 6)
  if (/^0+$/.test(distCode)) {
    console.warn(`[normalizeCups] Rejected CUPS with all-zero distributor code: ${clean}`)
    return null
  }

  return clean
}

/**
 * Return the 20-char canonical CUPS. Since normalizeCups() now always returns
 * 20 chars, this is simply an alias — kept for backward compatibility.
 *
 * USE THIS for all DB supply lookups and SIPS queries.
 */
export function cupsBase20(cups: string | null | undefined): string | null {
  return normalizeCups(cups)
}

/**
 * True if two CUPS refer to the same supply point (ignoring the optional 2-char suffix).
 */
export function sameCupsBase(a: string | null | undefined, b: string | null | undefined): boolean {
  const baseA = cupsBase20(a)
  const baseB = cupsBase20(b)
  return !!baseA && !!baseB && baseA === baseB
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

  // Try 20-char match first (canonical form: ES + 16 alphanum + 2 control letters)
  const match20 = text.match(/ES[A-Z0-9]{16}[A-Z]{2}/i)
  if (match20) {
    const result = normalizeCups(match20[0])
    if (result) return result
  }

  // Try 22-char match (with ICP suffix) — normalizeCups will strip to 20
  const match22 = text.match(/ES[A-Z0-9]{16}[A-Z]{2}[A-Z0-9]{2}/i)
  if (match22) {
    const result = normalizeCups(match22[0])
    if (result) return result
  }

  // Lenient: any ES + 18-20 alphanumeric sequence
  const matchLenient = text.match(/ES[A-Z0-9]{18,20}/i)
  if (matchLenient) return normalizeCups(matchLenient[0])

  return null
}
