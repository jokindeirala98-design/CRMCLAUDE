/**
 * ensurePendingPrescoring
 * ────────────────────────
 * Idempotent helper that guarantees a row in `prescorings` exists for the
 * given supply, building it from whatever data is currently available
 * (client, latest invoice extraction, SIPS consumption_data).
 *
 * Called from EVERY path where a CUPS/supply enters the application:
 *   - NewSupplyModal.handleSubmit (manual creation)
 *   - upload-queue.ts (bulk background create)
 *   - supplies/[id]/page.tsx handleUploadInvoices (when invoices are added
 *     to an existing supply that never had a prescoring row)
 *
 * Behavior:
 *   - Skips 2.0 tariffs (those don't need prescoring).
 *   - No-op if a row already exists for that supply (any status).
 *   - Best-effort: never throws; logs and returns false on failure so callers
 *     can stay focused on their primary work.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface EnsurePrescoringOptions {
  /** id of the user requesting the prescoring (falls back to 'system') */
  userId?: string | null
  /** Force creation even if a row already exists (rarely needed). */
  force?: boolean
  /**
   * If true and a row already exists, patch any null/empty fields with
   * freshly-computed data (non-destructive — never overwrites existing values).
   * Useful after invoices are added to an existing supply.
   */
  updateNulls?: boolean
}

/** True if the tariff is a 2.0 (residential) tariff that does not need prescoring. */
function isResidentialTariff(tariff: string | null | undefined): boolean {
  if (!tariff) return false
  const t = String(tariff).replace(/\s+/g, '').toUpperCase()
  return t.startsWith('2.0') || t === '20TD' || t === '20' || t === '202020' || t === '2.0DHA' || t === '20DHA'
}

export async function ensurePendingPrescoring(
  supabase: SupabaseClient,
  supplyId: string,
  options: EnsurePrescoringOptions = {}
): Promise<boolean> {
  if (!supplyId) return false
  const { userId = null, force = false, updateNulls = false } = options

  try {
    // 1. Check existing prescoring row (any status) — idempotency guard
    let existingId: string | null = null
    if (!force) {
      const { data: existing } = await supabase
        .from('prescorings')
        .select('id')
        .eq('supply_id', supplyId)
        .limit(1)
        .maybeSingle()
      if (existing) {
        if (!updateNulls) return false
        existingId = existing.id
      }
    }

    // 2. Load supply with client + latest invoice
    const { data: supply, error: supplyErr } = await supabase
      .from('supplies')
      .select(`
        id, cups, tariff, type, address, consumption_data,
        client:clients(id, name, cif, nif, cif_nif, phone, fiscal_address),
        invoices(extracted_data, created_at)
      `)
      .eq('id', supplyId)
      .single()

    if (supplyErr || !supply) {
      console.warn('[ensurePrescoring] supply lookup failed', { supplyId, supplyErr })
      return false
    }

    // 3. Skip 2.0 tariffs — those don't need prescoring
    if (isResidentialTariff(supply.tariff)) return false

    // 4. Build the prescoring payload from the best available data
    const client: any = (supply as any).client || null
    const invoices: any[] = (supply as any).invoices || []
    // Pick the most recent invoice with extracted data
    const latestInvoice = invoices
      .filter(i => i?.extracted_data)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]
    const extracted = latestInvoice?.extracted_data || {}
    const sips: any = (supply as any).consumption_data || {}

    const clientName =
      extracted.holder_name ||
      client?.name ||
      ''

    const cif =
      extracted.holder_cif_nif ||
      client?.cif ||
      client?.nif ||
      client?.cif_nif ||
      null

    const producto =
      supply.type === 'luz' ? 'Electricidad' :
      supply.type === 'gas' ? 'Gas' :
      supply.type === 'telefonia' ? 'Telefonía' :
      'Electricidad'

    // consumoPeriodos is the annual breakdown from SIPS — most accurate source
    const cp = (sips?.consumoPeriodos || {}) as { P1?: number; P2?: number; P3?: number; P4?: number; P5?: number; P6?: number }
    const periodosSum = (Number(cp.P1)||0) + (Number(cp.P2)||0) + (Number(cp.P3)||0)
                      + (Number(cp.P4)||0) + (Number(cp.P5)||0) + (Number(cp.P6)||0)
    const consumoAnualNum = periodosSum > 0
      ? periodosSum
      : (Number(sips?.totalKwh) > 0 ? Number(sips?.totalKwh) : (extracted?.economics?.consumoTotalKwh || 0))
    const consumoAnual = consumoAnualNum > 0 ? consumoAnualNum : null

    const poblacion = sips?.municipio || null
    const direccionFiscal =
      client?.fiscal_address ||
      extracted?.fiscal_address ||
      extracted?.billing_address ||
      supply.address ||
      null

    const payload = {
      supply_id: supplyId,
      client_name: clientName,
      cups: supply.cups || null,
      cif: cif,
      producto,
      tariff: supply.tariff || null,
      consumo_anual: consumoAnual ? `${Math.round(Number(consumoAnual)).toLocaleString('es-ES')} kWh` : null,
      entidad: extracted?.comercializadora || null,
      telefono: client?.phone || null,
      poblacion,
      direccion_fiscal: direccionFiscal,
      status: 'pending',
      requested_at: new Date().toISOString(),
      requested_by: userId || 'system',
    }

    // If updating nulls on an existing row, patch only the fields that are currently null/empty
    if (existingId) {
      const { data: currentRow } = await supabase
        .from('prescorings')
        .select('client_name, cif, producto, consumo_anual, entidad, telefono, poblacion, direccion_fiscal')
        .eq('id', existingId)
        .single()

      if (currentRow) {
        const patch: Record<string, unknown> = {}
        const nullOrEmpty = (v: unknown) => v === null || v === undefined || v === ''
        if (nullOrEmpty(currentRow.client_name) && payload.client_name) patch.client_name = payload.client_name
        if (nullOrEmpty(currentRow.cif) && payload.cif) patch.cif = payload.cif
        if (nullOrEmpty(currentRow.producto) && payload.producto) patch.producto = payload.producto
        // consumo_anual: always overwrite — SIPS is the authoritative source
        if (payload.consumo_anual) patch.consumo_anual = payload.consumo_anual
        if (nullOrEmpty(currentRow.entidad) && payload.entidad) patch.entidad = payload.entidad
        if (nullOrEmpty(currentRow.telefono) && payload.telefono) patch.telefono = payload.telefono
        if (nullOrEmpty(currentRow.poblacion) && payload.poblacion) patch.poblacion = payload.poblacion
        if (nullOrEmpty(currentRow.direccion_fiscal) && payload.direccion_fiscal) patch.direccion_fiscal = payload.direccion_fiscal

        if (Object.keys(patch).length > 0) {
          const { error: patchErr } = await supabase.from('prescorings').update(patch).eq('id', existingId)
          if (patchErr) {
            console.error('[ensurePrescoring] patch failed', { supplyId, patchErr })
            return false
          }
          console.log('[ensurePrescoring] patched null fields for supply', supplyId, Object.keys(patch))
        }
      }
      return true
    }

    const { error: insertErr } = await supabase.from('prescorings').insert(payload)
    if (insertErr) {
      console.error('[ensurePrescoring] insert failed', { supplyId, insertErr })
      return false
    }

    console.log('[ensurePrescoring] created pending row for supply', supplyId)
    return true
  } catch (err) {
    console.error('[ensurePrescoring] unexpected error', { supplyId, err })
    return false
  }
}
