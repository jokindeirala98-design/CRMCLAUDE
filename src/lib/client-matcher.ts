/**
 * src/lib/client-matcher.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Reconciliación de clientes a partir del nombre extraído de una factura.
 *
 * Normaliza el nombre quitando sufijos legales (SL, S.L., S.A., S.L.U., SLU,
 * SA, COOP, CB, SC, etc.), acentos, mayúsculas y espacios extra. Si encuentra
 * un cliente cuya forma normalizada coincide o cuyas palabras significativas
 * solapan al 100% (excluyendo stopwords), se considera el MISMO cliente.
 *
 * Cuando hay match, se actualiza el cliente con datos nuevos:
 *   - Nombre: se promueve al "más completo" (el que conserva el sufijo legal).
 *   - CIF/NIF / dirección fiscal: se rellenan si estaban vacíos.
 *
 * Si no hay match, devuelve null para que el llamante cree el cliente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Sufijos legales que deben ignorarse en el matching
const LEGAL_SUFFIXES = new Set([
  'sl', 's.l.', 's.l',
  'slu', 's.l.u.', 's.l.u',
  'sa', 's.a.', 's.a',
  'sau', 's.a.u.', 's.a.u',
  'sll', 's.l.l.',
  'slne', 's.l.n.e.',
  'coop', 'cooperativa',
  'cb', 'c.b.',
  'sc', 's.c.', 'sociedad', 'civil',
  'srl', 's.r.l.',
  'limitada', 'anonima', 'anónima',
  'sociedad',
])

// Palabras de conexión a ignorar
const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'en',
  'por', 'con', 'para', 'a', 'al', 'un', 'una', 'unos', 'unas',
])

/** Quita acentos, lowercase, colapsa espacios. */
function basicNormalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Devuelve la "clave canónica" de un nombre de cliente para matching:
 * sin sufijos legales, sin stopwords, sin acentos, sin espacios extra,
 * palabras ordenadas alfabéticamente (para que "TOYS UNICE" == "UNICE TOYS").
 */
export function canonicalClientKey(name: string): string {
  if (!name) return ''
  const normalized = basicNormalize(name)
  const words = normalized.split(' ').filter(w => {
    if (!w) return false
    if (LEGAL_SUFFIXES.has(w)) return false
    if (STOPWORDS.has(w)) return false
    return w.length >= 2
  })
  return [...words].sort().join(' ')
}

/**
 * Devuelve true si dos nombres se refieren al mismo cliente.
 * Equivale a `canonicalClientKey(a) === canonicalClientKey(b)`.
 */
export function sameClientName(a: string, b: string): boolean {
  const ka = canonicalClientKey(a)
  const kb = canonicalClientKey(b)
  return ka.length > 0 && ka === kb
}

/**
 * Heurística para decidir cuál de dos nombres es "más completo" y debe quedar
 * en BD. Prioriza el que tenga sufijo legal explícito (SL, SA…) y, en empate,
 * el más largo.
 */
export function preferMoreCompleteName(existing: string, incoming: string): string {
  const ne = basicNormalize(existing)
  const ni = basicNormalize(incoming)
  const eHasLegal = [...LEGAL_SUFFIXES].some(suf => ne.includes(' ' + suf) || ne.endsWith(suf))
  const iHasLegal = [...LEGAL_SUFFIXES].some(suf => ni.includes(' ' + suf) || ni.endsWith(suf))
  if (iHasLegal && !eHasLegal) return incoming
  if (eHasLegal && !iHasLegal) return existing
  // En empate: el más largo
  return incoming.length > existing.length ? incoming : existing
}

// ────────────────────────────────────────────────────────────────────────────

export interface ClientFromFactura {
  /** Nombre extraído de la factura (puede traer sufijo SL, etc.) */
  holderName?: string | null
  /** CIF/NIF extraído */
  cifNif?: string | null
  /** Dirección fiscal extraída */
  fiscalAddress?: string | null
}

export interface MatchedClient {
  id: string
  name: string
  /** true si el cliente se ha actualizado con datos nuevos (nombre, CIF, dirección). */
  updated: boolean
}

/**
 * Busca un cliente que matchee fuzzy con el holderName extraído. Si lo encuentra:
 *   - Promueve el nombre al más completo (UNICE TOYS → UNICE TOYS SL si toca).
 *   - Rellena CIF / dirección si estaban vacíos.
 * Si no, devuelve null. El llamante decide si crearlo.
 *
 * Pasa una `commercialIdFilter` opcional si quieres limitar la búsqueda a
 * clientes asignados a un comercial concreto (por RLS / scope visual).
 */
export async function matchClientByHolderName(
  supabase: SupabaseClient,
  fact: ClientFromFactura,
  opts: { commercialIdFilter?: string } = {},
): Promise<MatchedClient | null> {
  const holder = (fact.holderName || '').trim()
  if (!holder) return null

  const targetKey = canonicalClientKey(holder)
  if (!targetKey) return null

  // 1. Primer pase: ilike por la palabra más significativa
  const normalized = basicNormalize(holder)
  const words = normalized.split(' ').filter(w => w.length >= 3 && !LEGAL_SUFFIXES.has(w) && !STOPWORDS.has(w))
  const primary = [...words].sort((a, b) => b.length - a.length)[0]
  if (!primary) return null

  let q = supabase.from('clients').select('id, name, alias, cif, nif, cif_nif, fiscal_address').ilike('name', `%${primary}%`).limit(20)
  if (opts.commercialIdFilter) q = q.eq('commercial_id', opts.commercialIdFilter)
  const { data: rows } = await q
  const candidates = (rows || []) as Array<{ id: string; name: string; alias: string | null; cif: string | null; nif: string | null; cif_nif: string | null; fiscal_address: string | null }>

  // 2. Match canónico estricto: misma clave canónica = mismo cliente
  const match = candidates.find(c => canonicalClientKey(c.name) === targetKey)
  if (!match) return null

  // 3. Calcular patch: promover nombre + preservar alias + rellenar campos vacíos
  const patch: Record<string, any> = {}
  const promoted = preferMoreCompleteName(match.name, holder)
  if (promoted !== match.name) {
    patch.name = promoted
    // Regla del usuario: si el cliente NO tenía alias y vamos a sobrescribir
    // el nombre coloquial con el oficial (ej. "unice toys" → "UNICE TOYS S.L."),
    // preservamos el nombre coloquial como alias para mantener el "nombre con
    // el que el comercial conoce al cliente". Solo si el viejo no era ya el
    // oficial completo (evitamos guardar alias=name).
    if (!match.alias && match.name !== promoted) {
      patch.alias = match.name
    }
  }

  const incomingCifNif = (fact.cifNif || '').trim().toUpperCase()
  if (incomingCifNif) {
    if (!match.cif_nif) patch.cif_nif = incomingCifNif
    // Heurística: CIF empieza por letra, NIF por dígito (o NIE con X/Y/Z)
    const isCif = /^[A-HJNP-SUVW]\d{7}[0-9A-J]$/.test(incomingCifNif)
    if (isCif && !match.cif) patch.cif = incomingCifNif
    if (!isCif && !match.nif) patch.nif = incomingCifNif
  }

  const incomingAddr = (fact.fiscalAddress || '').trim()
  if (incomingAddr && !match.fiscal_address) patch.fiscal_address = incomingAddr

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString()
    const { error } = await supabase.from('clients').update(patch).eq('id', match.id)
    if (error) console.warn('[matchClientByHolderName] patch failed:', error.message)
    return { id: match.id, name: patch.name || match.name, updated: !error }
  }
  return { id: match.id, name: match.name, updated: false }
}
