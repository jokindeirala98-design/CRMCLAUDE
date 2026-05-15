/**
 * Helpers centralizados para nombres de descarga del CRM.
 *
 * Convención del usuario:
 *   • Comparativa:        `comparativa_{cups4}_{tarifa}.{ext}`
 *                         ej. `comparativa_1910_2.0.xlsx`
 *   • Factura cliente:    `{cups4}_{periodo}_{cliente}.{ext}`
 *                         ej. `1910_Mayo2025_AyuntamientoOrcoyen.pdf`
 *   • Excel suministro:   `suministro_{cups4}.xlsx`
 *   • Excel global:       `voltis_{cliente}_{año|global}.xlsx`
 *   • Dossier acceso:     `voltis_acceso_{cliente}.pdf`
 *
 * Reglas comunes:
 *   - cups4 = los 4 ÚLTIMOS DÍGITOS del CUPS (excluye las 2 letras finales).
 *     Ej: ES0021000006851910ST → 1910;  ES0226060006587544JC → 7544
 *   - tarifa = "2.0", "3.0", "6.1", "RL.4"… (mantiene formato original)
 *   - periodo = "Mayo2025" (mes en mayúscula primera, sin espacio, año)
 *   - cliente = PascalCase sin acentos ni espacios. Truncado a 30 chars.
 *   - Sin caracteres prohibidos en sistemas de archivos (/ \ : * ? " < > |).
 */

// ─── Constantes ─────────────────────────────────────────────────────────────

const MONTH_NAMES_CAP = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// ─── Bloques fundamentales ──────────────────────────────────────────────────

/** Limpia un string para usarlo como parte de un filename de SO. */
export function sanitizeForFilename(s: string): string {
  if (!s) return ''
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quitar acentos
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')              // chars prohibidos SO
    .replace(/\s+/g, ' ').trim()                        // espacios colapsados
}

/** Convierte "Ayuntamiento de Orcoyen" → "AyuntamientoOrcoyen". */
export function clientNameForFile(name?: string | null, max = 30): string {
  if (!name) return 'Cliente'
  const clean = sanitizeForFilename(name)
    .replace(/\b(de|del|la|el|los|las|y|en|para|por)\b/gi, '')   // remover artículos
    .replace(/[.,]/g, '')
    .split(/\s+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('')
  return clean.slice(0, max) || 'Cliente'
}

/**
 * Extrae los 4 últimos DÍGITOS del CUPS.
 *
 * Un CUPS español tiene formato `ES XXXX XXXX XXXX XXXX LL` (18 dígitos + 2
 * letras de verificación). Devolvemos los 4 últimos dígitos antes de las
 * letras, que es el identificador visual habitual en Voltis.
 *
 * Si el CUPS está mal formado o ausente, devolvemos `0000`.
 */
export function cupsLast4(cups?: string | null): string {
  if (!cups) return '0000'
  const onlyDigits = cups.replace(/[^0-9]/g, '')
  return (onlyDigits.slice(-4) || '0000').padStart(4, '0')
}

/**
 * Normaliza la tarifa para uso en filename:
 *   "2.0TD" → "2.0",  "3.0TD" → "3.0",  "6.1TD" → "6.1",  "RL.4" → "RL.4"
 */
export function tariffShort(tariff?: string | null): string {
  if (!tariff) return ''
  const t = String(tariff).trim()
  const m = t.match(/^(\d\.\d|RL\.?\s?\d|6\.\d)/i)
  if (m) return m[1].replace(/\s+/g, '').toUpperCase().replace('RL', 'RL.')
  return t.replace(/[^A-Za-z0-9.]/g, '')
}

/**
 * Construye "Mayo2025" a partir de una fecha (string ISO o Date).
 * Si no hay fecha, devuelve cadena vacía.
 */
export function periodForFile(date?: string | Date | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (!d || isNaN(d.getTime())) return ''
  return `${MONTH_NAMES_CAP[d.getMonth()]}${d.getFullYear()}`
}

// ─── Builders de filename ───────────────────────────────────────────────────

/**
 * Nombre estándar para una comparativa eléctrica/gas.
 *
 * Ejemplo: `comparativa_1910_2.0.xlsx`
 *          `comparativa_1910_2.0_Nordy.xlsx` (con variante comercializadora)
 */
export function comparativaFilename(opts: {
  cups?: string | null
  tariff?: string | null
  ext?: 'xlsx' | 'pdf' | 'html'
  variant?: string | null     // ej. "Nordy", "Gana", "Fija24H"
}): string {
  const cups4 = cupsLast4(opts.cups)
  const tar = tariffShort(opts.tariff) || '2.0'
  const variant = opts.variant
    ? '_' + sanitizeForFilename(opts.variant).replace(/\s+/g, '')
    : ''
  const ext = opts.ext || 'xlsx'
  return `comparativa_${cups4}_${tar}${variant}.${ext}`
}

/**
 * Nombre estándar para una factura del cliente.
 *
 * Ejemplo: `1910_Mayo2025_AyuntamientoOrcoyen.pdf`
 */
export function invoiceFilename(opts: {
  cups?: string | null
  periodEnd?: string | Date | null
  periodStart?: string | Date | null
  clientName?: string | null
  ext?: 'pdf' | 'xlsx'
}): string {
  const cups4 = cupsLast4(opts.cups)
  const period = periodForFile(opts.periodEnd) || periodForFile(opts.periodStart) || 'SinPeriodo'
  const client = clientNameForFile(opts.clientName)
  const ext = opts.ext || 'pdf'
  return `${cups4}_${period}_${client}.${ext}`
}

/**
 * Nombre estándar para Excel anual de un suministro (portal o CRM).
 *
 * Ejemplo: `suministro_1910_AyuntamientoOrcoyen.xlsx`
 */
export function supplyExcelFilename(opts: {
  cups?: string | null
  clientName?: string | null
  year?: number | null
}): string {
  const cups4 = cupsLast4(opts.cups)
  const client = clientNameForFile(opts.clientName)
  const yr = opts.year ? `_${opts.year}` : ''
  return `suministro_${cups4}_${client}${yr}.xlsx`
}

/**
 * Nombre estándar para Excel global del cliente.
 *
 * Ejemplo: `voltis_AyuntamientoOrcoyen_2025.xlsx` o `voltis_AyuntamientoOrcoyen_global.xlsx`
 */
export function clientExcelFilename(opts: {
  clientName?: string | null
  year?: number | null
}): string {
  const client = clientNameForFile(opts.clientName)
  const yr = opts.year ? String(opts.year) : 'global'
  return `voltis_${client}_${yr}.xlsx`
}

/**
 * Nombre estándar para el dossier PDF de acceso al portal.
 *
 * Ejemplo: `voltis_acceso_AyuntamientoOrcoyen.pdf`
 */
export function dossierFilename(opts: { clientName?: string | null }): string {
  const client = clientNameForFile(opts.clientName)
  return `voltis_acceso_${client}.pdf`
}
