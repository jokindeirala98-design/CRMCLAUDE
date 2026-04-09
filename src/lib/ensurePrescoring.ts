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
  const { userId = null, force = false } = options

  try {
    // 1. Check existing prescoring row (any status) — idempotency guard
    if (!force) {
      const { data: existing } = await supabase
        .from('prescorings')
        .select('id')
        .eq('supply_id', supplyId)
        .limit(1)
        .maybeSingle()
      if (existing) return false
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

    const consumoAnual =
      sips?.total ||
      sips?.totalKwh ||
      extracted?.economics?.consumoTotalKwh ||
      null

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
      consumo_anual: consumoAnual ? String(consumoAnual) : null,
      entidad: extracted?.comercializadora || null,
      telefono: client?.phone || null,
      poblacion,
      direccion_fiscal: direccionFiscal,
      status: 'pending',
      requested_at: new Date().toISOString(),
      requested_by: userId || 'system',
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
