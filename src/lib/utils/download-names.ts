/**
 * Helpers centralizados para nombres de descarga del CRM.
 *
 * Convención del usuario:
 *   • Comparativa:        `comparativa_{cups4}_{tarifa}.{ext}`
 *                         ej. `comparativa_10ST_2.0.xlsx`
 *   • Factura cliente:    `{cups4}_{periodo}_{cliente}.{ext}`
 *                         ej. `10ST_Mayo2025_AyuntamientoOrcoyen.pdf`
 *   • Excel suministro:   `suministro_{cups4}_{cliente}.xlsx`
 *   • Excel global:       `voltis_{cliente}_{año|global}.xlsx`
 *   • Dossier acceso:     `voltis_acceso_{cliente}.pdf`
 *
 * Para descargas no especificadas explícitamente por el usuario, usar
 * `genericFilename()` que aplica la misma filosofía:
 *   • Empieza por contexto reconocible (ej. "estudio", "informe", "factura").
 *   • Incluye cups4 si hay supply asociado.
 *   • Termina con periodo (mes/año) si es temporal, o "Cliente" si es global.
 *
 * Reglas comunes:
 *   - cups4 = los 4 ÚLTIMOS caracteres del CUPS INCLUYENDO las 2 letras finales.
 *     Ej: ES0021000006851910ST → 10ST;  ES0226060006587544JC → 44JC
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
 * Extrae los 4 últimos caracteres del CUPS, INCLUIDAS las 2 letras de
 * verificación finales.
 *
 * Un CUPS español tiene formato `ES XXXX XXXX XXXX XXXX LL` (18 dígitos + 2
 * letras de verificación). Devolvemos los 4 últimos chars del string limpio
 * (sin espacios), que es el identificador que Voltis usa habitualmente.
 *
 * Ejemplos:
 *   • ES0021000006851910ST → "10ST"
 *   • ES0226060006587544JC → "44JC"
 *   • ES0021000013357495NN → "95NN"
 *
 * Si el CUPS está mal formado o ausente, devolvemos `XXXX`.
 */
export function cupsLast4(cups?: string | null): string {
  if (!cups) return 'XXXX'
  const clean = cups.toUpperCase().replace(/\s+/g, '')
  return clean.slice(-4) || 'XXXX'
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

/**
 * Nombre genérico Voltis para descargas no contempladas explícitamente.
 *
 * Filosofía:
 *   `{tipo}_{cups4?}_{periodo?|cliente?}.{ext}`
 *
 * Todo es opcional menos `tipo`. Solo se incluyen los segmentos relevantes
 * para el caso. Ejemplos:
 *
 *   • genericFilename({ tipo: 'informe-potencias', cups: '...', supplyName: '...' })
 *     → `informe-potencias_10ST_AyuntamientoOrcoyen.pdf`
 *
 *   • genericFilename({ tipo: 'liquidacion', clientName: 'Voltis', date: '2026-05-14' })
 *     → `liquidacion_Voltis_Mayo2026.pdf`
 *
 *   • genericFilename({ tipo: 'prescoring', cups: '...', ext: 'xlsx' })
 *     → `prescoring_10ST.xlsx`
 *
 *   • genericFilename({ tipo: 'backup', date: '2026-05-14' })
 *     → `backup_2026-05-14.zip`
 *
 * Si quieres usar una variante de nombre concreta (PascalCase, kebab),
 * la pasas tal cual y se preserva en el filename.
 */
export function genericFilename(opts: {
  /** Etiqueta del tipo de documento. Se preserva tal cual (ej. "informe-potencias"). */
  tipo: string
  /** Si pertenece a un supply concreto, añade los últimos 4 chars del CUPS. */
  cups?: string | null
  /** Para informes con fecha (mes/año). */
  date?: string | Date | null
  /** Cliente o nombre descriptivo. */
  clientName?: string | null
  supplyName?: string | null
  /** Año o periodo explícito (alternativa a date). */
  year?: number | string | null
  /** Extensión (sin punto). Por defecto pdf. */
  ext?: string
  /** Si quieres añadir una etiqueta extra al final (ej. "v2", "borrador"). */
  suffix?: string | null
}): string {
  const segments: string[] = [sanitizeForFilename(opts.tipo).replace(/\s+/g, '-')]

  if (opts.cups) segments.push(cupsLast4(opts.cups))

  if (opts.supplyName && !opts.cups) {
    segments.push(sanitizeForFilename(opts.supplyName).replace(/\s+/g, ''))
  }

  if (opts.clientName) {
    segments.push(clientNameForFile(opts.clientName))
  }

  if (opts.date) {
    const p = periodForFile(opts.date)
    if (p) segments.push(p)
  } else if (opts.year != null) {
    segments.push(String(opts.year))
  }

  if (opts.suffix) {
    segments.push(sanitizeForFilename(opts.suffix).replace(/\s+/g, ''))
  }

  const ext = (opts.ext || 'pdf').replace(/^\.+/, '')
  return segments.filter(Boolean).join('_') + '.' + ext
}
