export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

export function formatNumber(num: number, decimals = 0): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num)
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatDateShort(date: string | Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

export function generateInvoiceNumber(sequence: number): string {
  const year = new Date().getFullYear()
  return `VOLT-${year}-${String(sequence).padStart(5, '0')}`
}

export function calculateVAT(baseAmount: number, vatRate = 21): {
  base: number
  vat: number
  total: number
} {
  const vat = baseAmount * (vatRate / 100)
  return {
    base: Math.round(baseAmount * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    total: Math.round((baseAmount + vat) * 100) / 100,
  }
}

export function calculateAnnualFromQuarterly(quarterlyAmount: number): number {
  return calculateVAT(quarterlyAmount * 4).total
}

/**
 * Validate an IBAN.
 * Supports Spanish (ES) and other European IBANs.
 * Returns { valid: boolean, error?: string }
 */
export function validateIBAN(iban: string): { valid: boolean; error?: string } {
  // Remove spaces and convert to uppercase
  const cleaned = iban.replace(/\s/g, '').toUpperCase()

  if (!cleaned) {
    return { valid: false, error: 'IBAN es obligatorio' }
  }

  // Basic format check: 2 letters + 2 digits + up to 30 alphanumeric chars
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) {
    return { valid: false, error: 'Formato IBAN invalido' }
  }

  // Country-specific length validation
  const countryLengths: Record<string, number> = {
    ES: 24, DE: 22, FR: 27, IT: 27, PT: 25, GB: 22, NL: 18, BE: 16,
    AT: 20, IE: 22, LU: 20, CH: 21, DK: 18, SE: 24, NO: 15, FI: 18,
    PL: 28, CZ: 24, SK: 24, HU: 28, RO: 24, BG: 22, HR: 21, SI: 19,
    EE: 20, LT: 20, LV: 21, MT: 31, CY: 28, GR: 27,
  }

  const country = cleaned.substring(0, 2)
  const expectedLength = countryLengths[country]
  if (expectedLength && cleaned.length !== expectedLength) {
    return { valid: false, error: `IBAN ${country} debe tener ${expectedLength} caracteres (tiene ${cleaned.length})` }
  }

  // MOD-97 check (ISO 7064)
  // Move first 4 chars to end, convert letters to numbers (A=10, B=11, etc.)
  const rearranged = cleaned.substring(4) + cleaned.substring(0, 4)
  const numericStr = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))

  // Calculate mod 97 using string chunks (to avoid BigInt issues)
  let remainder = 0
  for (let i = 0; i < numericStr.length; i += 7) {
    const chunk = String(remainder) + numericStr.substring(i, i + 7)
    remainder = parseInt(chunk, 10) % 97
  }

  if (remainder !== 1) {
    return { valid: false, error: 'IBAN no valido (checksum incorrecto)' }
  }

  return { valid: true }
}

/**
 * Converts a user's full_name or email into a 3-letter uppercase code.
 * Examples:
 *   "Jokin Imizcoz" → "JOK"
 *   "Jose García" → "JOS"
 *   "Javier López" → "JAV"
 *   "jokin@voltisenergia.com" → "JOK"
 *   "jose@voltisenergia.com" → "JOS"
 *   "javier@voltisenergia.com" → "JAV"
 */
export function getUserInitials(fullNameOrEmail?: string | null): string {
  if (!fullNameOrEmail) return '???'

  // If it's an email, extract the local part (before @)
  let name = fullNameOrEmail.includes('@')
    ? fullNameOrEmail.split('@')[0]
    : fullNameOrEmail

  // Clean and get first name only
  name = name.trim().split(/[\s.]+/)[0]

  if (!name) return '???'

  // Return first 3 characters uppercased
  return name.slice(0, 3).toUpperCase()
}
