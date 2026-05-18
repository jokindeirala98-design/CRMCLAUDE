/**
 * INVOICE DEDUPE
 * ──────────────
 * Helper centralizado para insertar facturas con detección automática
 * de duplicados y rectificativas.
 *
 * Reglas:
 *   1. Si ya existe una factura con el mismo (supply_id, period_start,
 *      period_end), comparamos por fecha de emisión.
 *      - Si la nueva es MÁS RECIENTE → reemplaza la existente.
 *      - Si la nueva es ANTERIOR → se descarta (sería un dato antiguo).
 *      - Si no hay fecha de emisión en una de las dos, gana la nueva
 *        SOLO si su total_amount es distinto (regularización legítima);
 *        si el total_amount es idéntico, se considera duplicado y se
 *        descarta.
 *   2. Nunca se inserta si el archivo (file_url) ya existe en BD
 *      (insertador subió 2 veces el mismo PDF).
 *
 * El helper se llama desde:
 *   - src/stores/upload-queue.ts (bulk web upload)
 *   - src/app/(dashboard)/supplies/[id]/page.tsx (upload puntual)
 *   - src/app/(dashboard)/inbox/page.tsx (inbox)
 *   - src/lib/telegram-process.ts (bot)
 *   - src/components/modals/NewSupplyModal.tsx (alta supply con facturas)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface InvoiceInsertPayload {
  supply_id: string | null | undefined
  file_url?: string | null
  file_type?: string | null
  extracted_data?: any
  extraction_status?: string | null
  period_start?: string | null
  period_end?: string | null
  total_amount?: number | null
  emission_date?: string | null
  source?: string | null
  [k: string]: any
}

export interface DedupeResult {
  /** La factura terminó en BD (insertada o ya existente equivalente). */
  ok: boolean
  /** ID de la factura final en BD. */
  invoiceId?: string
  /** Acción tomada. */
  action: 'inserted' | 'replaced' | 'skipped_duplicate' | 'skipped_older' | 'error'
  /** Mensaje legible. */
  reason: string
}

/**
 * Intenta extraer la fecha de emisión de la factura desde varios sitios:
 *   - payload.emission_date (caller ya la tiene)
 *   - extracted_data.emission_date
 *   - extracted_data.economics.fechaEmision
 *   - extracted_data.fechaEmision
 * Devuelve ISO yyyy-mm-dd o null.
 */
export function deriveEmissionDate(payload: InvoiceInsertPayload): string | null {
  const candidates = [
    payload.emission_date,
    payload.extracted_data?.emission_date,
    payload.extracted_data?.economics?.fechaEmision,
    payload.extracted_data?.economics?.fecha_emision,
    payload.extracted_data?.fechaEmision,
    payload.extracted_data?.fecha_emision,
  ]
  for (const c of candidates) {
    if (!c) continue
    const iso = toIsoEmission(String(c))
    if (iso) return iso
  }
  return null
}

/** Acepta dd/mm/yyyy, yyyy-mm-dd, "06 de mayo de 2026", etc. */
function toIsoEmission(s: string): string | null {
  const v = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  // dd/mm/yyyy o dd-mm-yyyy
  const m1 = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m1) {
    const yyyy = m1[3].length === 2 ? `20${m1[3]}` : m1[3]
    return `${yyyy}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`
  }
  // "06 de mayo de 2026"
  const mes: Record<string, string> = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  }
  const m2 = v.toLowerCase().match(/^(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})$/)
  if (m2 && mes[m2[2]]) {
    return `${m2[3]}-${mes[m2[2]]}-${m2[1].padStart(2, '0')}`
  }
  return null
}

/**
 * Inserta o reemplaza una factura aplicando dedupe.
 *
 * El supabase client debe tener permisos suficientes para SELECT, INSERT
 * y DELETE en la tabla invoices (admin / service-role en server, RLS en
 * browser si el usuario tiene permiso).
 */
export async function upsertInvoiceWithDedupe(
  supabase: SupabaseClient,
  payload: InvoiceInsertPayload,
): Promise<DedupeResult> {
  const supplyId = payload.supply_id
  if (!supplyId) {
    return { ok: false, action: 'error', reason: 'Falta supply_id' }
  }

  const emissionDate = deriveEmissionDate(payload)
  const finalPayload = { ...payload, emission_date: payload.emission_date ?? emissionDate }

  // ── 1. Comprobación por file_url (mismo PDF subido dos veces) ─────────
  if (payload.file_url) {
    const { data: sameFile } = await supabase
      .from('invoices')
      .select('id')
      .eq('file_url', payload.file_url)
      .limit(1)
      .maybeSingle()
    if (sameFile?.id) {
      return {
        ok: true,
        invoiceId: sameFile.id,
        action: 'skipped_duplicate',
        reason: 'El mismo archivo ya está subido (file_url duplicado).',
      }
    }
  }

  // ── 2. Comprobación por período ───────────────────────────────────────
  //   Si no tenemos period_start/period_end, no podemos dedupar — insertar
  //   directo (mejor que perder la factura).
  if (!payload.period_start || !payload.period_end) {
    const { data, error } = await supabase
      .from('invoices')
      .insert(finalPayload)
      .select('id')
      .single()
    if (error) return { ok: false, action: 'error', reason: error.message }
    return { ok: true, invoiceId: data.id, action: 'inserted', reason: 'Insertada (sin período para dedupe)' }
  }

  // Buscar facturas existentes con mismo período
  const { data: candidates, error: selErr } = await supabase
    .from('invoices')
    .select('id, total_amount, emission_date, created_at')
    .eq('supply_id', supplyId)
    .eq('period_start', payload.period_start)
    .eq('period_end', payload.period_end)
  if (selErr) {
    return { ok: false, action: 'error', reason: `select error: ${selErr.message}` }
  }

  // ── 3. No hay existente → insertar normal ────────────────────────────
  if (!candidates || candidates.length === 0) {
    const { data, error } = await supabase
      .from('invoices')
      .insert(finalPayload)
      .select('id')
      .single()
    if (error) return { ok: false, action: 'error', reason: error.message }
    return { ok: true, invoiceId: data.id, action: 'inserted', reason: 'Insertada (nuevo período).' }
  }

  // ── 4. Hay 1 o más existentes — decidir por fecha de emisión ────────
  const newEm = finalPayload.emission_date ?? null
  const newTotal = roundAmount(finalPayload.total_amount)

  // Detectar duplicado exacto (mismo total, mismas o sin emisión)
  for (const c of candidates) {
    const sameTotal = roundAmount(c.total_amount) === newTotal && newTotal !== null
    const sameEmission = (c.emission_date ?? null) === newEm
    if (sameTotal && sameEmission) {
      return {
        ok: true,
        invoiceId: c.id,
        action: 'skipped_duplicate',
        reason: `Ya existe una factura idéntica (total ${newTotal} €, emisión ${newEm ?? 'sin fecha'}).`,
      }
    }
  }

  // Elegir la "ganadora": comparar emission_date.
  //   - Si la nueva tiene emisión más reciente que TODAS las existentes →
  //     reemplaza (borrar existentes, insertar nueva).
  //   - Si la nueva tiene emisión igual o anterior → skip.
  //   - Si la nueva NO tiene emisión y alguna existente sí → skip (la
  //     existente es más fiable).
  //   - Si ninguna tiene emisión → insertar (puede ser una regularización
  //     legítima con total distinto). Esto evita perder datos.
  const existingMaxEm = candidates
    .map(c => c.emission_date)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined

  if (newEm && (!existingMaxEm || newEm > existingMaxEm)) {
    // La nueva es la más reciente → reemplazar
    const idsToDelete = candidates.map(c => c.id)
    await supabase.from('invoices').delete().in('id', idsToDelete)
    const { data, error } = await supabase
      .from('invoices')
      .insert(finalPayload)
      .select('id')
      .single()
    if (error) return { ok: false, action: 'error', reason: error.message }
    return {
      ok: true,
      invoiceId: data.id,
      action: 'replaced',
      reason: `Reemplazadas ${idsToDelete.length} factura(s) anterior(es) por una más reciente (emisión ${newEm}).`,
    }
  }

  if (newEm && existingMaxEm && newEm <= existingMaxEm) {
    return {
      ok: true,
      action: 'skipped_older',
      reason: `Ya hay una factura más reciente para este período (emisión existente ${existingMaxEm}).`,
    }
  }

  if (!newEm && existingMaxEm) {
    return {
      ok: true,
      action: 'skipped_older',
      reason: `La nueva no tiene fecha de emisión y ya hay una con emisión ${existingMaxEm}.`,
    }
  }

  // Ninguna tiene emisión: si los totales son distintos, insertar (puede
  // ser regularización legítima). Si son iguales, lo detectamos arriba.
  const { data, error } = await supabase
    .from('invoices')
    .insert(finalPayload)
    .select('id')
    .single()
  if (error) return { ok: false, action: 'error', reason: error.message }
  return {
    ok: true,
    invoiceId: data.id,
    action: 'inserted',
    reason: 'Insertada (período con datos previos pero totales distintos y sin fecha de emisión).',
  }
}

function roundAmount(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (!isFinite(n)) return null
  return Math.round(n * 100) / 100
}

/**
 * Wrapper para inserciones en bulk (array). Itera y devuelve resumen.
 */
export async function upsertInvoicesBulk(
  supabase: SupabaseClient,
  payloads: InvoiceInsertPayload[],
): Promise<{
  inserted: number
  replaced: number
  skipped: number
  errors: number
  details: DedupeResult[]
}> {
  let inserted = 0, replaced = 0, skipped = 0, errors = 0
  const details: DedupeResult[] = []
  for (const p of payloads) {
    const r = await upsertInvoiceWithDedupe(supabase, p)
    details.push(r)
    if (r.action === 'inserted') inserted++
    else if (r.action === 'replaced') replaced++
    else if (r.action === 'skipped_duplicate' || r.action === 'skipped_older') skipped++
    else errors++
  }
  return { inserted, replaced, skipped, errors, details }
}
