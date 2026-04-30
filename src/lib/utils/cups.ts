/**
 * CUPS (Codigo Universal de Punto de Suministro) utilities
 *
 * Canonical format: always 22 chars
 *   ES (2) + distributor code (4) + 12-digit supply point + 2 control letters + 2 suffix (e.g. "0F")
 *
 * Other lengths handled:
 *   20 chars → valid (older invoices omit the 2-char ICP/meter suffix)
 *   24 chars → Gemini/OCR picked up 2 extra chars — strip last 2 → 22 chars
 *   19, 21, 23 chars → always truncation errors, rejected
 *
 * IMPORTANT: a 20-char and 22-char CUPS that share the same first 20 chars are
 * THE SAME supply point. Always use cupsBase20() when querying the DB so both
 * variants match the same supply (ILIKE 'ES...base20...%').
 *
 * DB storage: store the longest version seen (prefer 22 over 20).
 * SIPS queries: use cupsBase20() — the SIPS API only accepts the base 20-char form.
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

  // 24 chars: OCR/Gemini sometimes captures 2 extra characters after the 22-char CUPS.
  // Business rule: strip the last 2 to recover the canonical 22-char form.
  if (clean.length === 24) {
    clean = clean.substring(0, 22)
    console.log(`[normalizeCups] Truncated 24-char CUPS to 22: ${clean}`)
  }

  // Odd-length CUPS are always truncation errors (19, 21, 23 chars):
  //   21-char → 22-char with last char missing
  //   19-char → 20-char with last char missing
  // Reject — better to store null than a wrong CUPS that creates duplicate supplies.
  if (clean.length % 2 !== 0) {
    console.warn(`[normalizeCups] Rejected odd-length CUPS (${clean.length} chars, likely truncated): ${clean}`)
    return null
  }

  // Accept exactly 20 or 22 chars
  if (clean.length !== 20 && clean.length !== 22) return null

  // Strict validation: ES + 16 digits + 2 control letters [+ optional 2 suffix]
  if (!/^ES[A-Z0-9]{18}([A-Z0-9]{2})?$/.test(clean)) return null

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
 * Return the 20-char base CUPS (strips the optional 2-char ICP/meter suffix).
 *
 * USE THIS for:
 *   - All DB supply lookups: .ilike('cups', cupsBase20(cups) + '%')
 *   - SIPS API queries (the SIPS API only accepts the 20-char base form)
 *   - Comparing two CUPS that might differ only in their suffix
 *
 * Example: cupsBase20('ES0021000006751517CW0F') === cupsBase20('ES0021000006751517CW')
 *          → both return 'ES0021000006751517CW'
 */
export function cupsBase20(cups: string | null | undefined): string | null {
  const normalized = normalizeCups(cups)
  if (!normalized) return null
  return normalized.substring(0, 20)
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
