/**
 * Centralized supply pipeline logic.
 *
 * This module defines the canonical pipeline order and provides a single
 * function — `advanceSupplyPipeline` — that every code path (UI upload,
 * Telegram bot, email inbound, upload queue, inbox, etc.) should call
 * after a relevant event (invoice added, report uploaded, etc.).
 *
 * Rules:
 *   1. Status only moves FORWARD, never backward (except explicit resets).
 *   2. If the supply is already past the target stage, the call is a no-op.
 *   3. Every transition writes an activity_log entry for traceability.
 */

// ── Pipeline order (index = priority, higher = further along) ──────────────
const PIPELINE_ORDER: string[] = [
  'primer_contacto',        // 0
  'estudio_en_curso',       // 1  ← "Esperando informes" (facturas_recibidas merged here)
  'estudio_completado',     // 2
  'presentado',             // 3
  'pendiente_firma',        // 4
  'firmado',                // 5
  'suscrito',               // 6
  'seguimiento_activo',     // 7
]

function pipelineIndex(status: string): number {
  const idx = PIPELINE_ORDER.indexOf(status)
  // Unknown status (e.g. 'rechazado', 'esperando_informes') → treat as -1
  return idx >= 0 ? idx : -1
}

// ── Events that trigger pipeline transitions ───────────────────────────────
export type PipelineEvent =
  | 'invoices_added'       // One or more invoices were added to the supply
  | 'report_uploaded'      // Economic study / report was uploaded by admin
  | 'report_deleted'       // Report was deleted → go back to estudio_en_curso

// Map events to their target status
const EVENT_TARGET: Record<PipelineEvent, string> = {
  invoices_added: 'estudio_en_curso',
  report_uploaded: 'estudio_completado',
  report_deleted: 'estudio_en_curso',
}

// Events that are allowed to MOVE BACKWARD (e.g. deleting a report)
const BACKWARD_EVENTS = new Set<PipelineEvent>(['report_deleted'])

interface AdvanceOptions {
  /** Supabase client (with service role or authenticated) */
  supabase: any
  /** The supply ID */
  supplyId: string
  /** What happened */
  event: PipelineEvent
  /** Optional: current status (avoids an extra DB read if already known) */
  currentStatus?: string
  /** Optional: who triggered this (user ID for activity_log) */
  userId?: string
}

/**
 * Advance a supply's pipeline status based on an event.
 *
 * Returns the new status if a transition was made, or null if no change.
 */
export async function advanceSupplyPipeline({
  supabase,
  supplyId,
  event,
  currentStatus,
  userId,
}: AdvanceOptions): Promise<string | null> {
  // 1. Determine current status
  let status = currentStatus
  if (!status) {
    const { data } = await supabase
      .from('supplies')
      .select('status')
      .eq('id', supplyId)
      .single()
    status = data?.status
  }
  if (!status) return null

  const targetStatus = EVENT_TARGET[event]
  const currentIdx = pipelineIndex(status)
  const targetIdx = pipelineIndex(targetStatus)

  // 2. Decide whether to transition
  const isBackward = BACKWARD_EVENTS.has(event)

  if (isBackward) {
    // For backward events (e.g. report_deleted), only go back if current
    // status is exactly the next stage after the target (e.g. estudio_completado → estudio_en_curso)
    if (currentIdx !== targetIdx + 1) return null
  } else {
    // Forward events: only advance if current status is BEFORE the target
    if (currentIdx >= targetIdx) return null
  }

  // 3. Update the supply status
  const { error } = await supabase
    .from('supplies')
    .update({ status: targetStatus, updated_at: new Date().toISOString() })
    .eq('id', supplyId)

  if (error) {
    console.error(`[supply-pipeline] Failed to advance ${supplyId} from ${status} to ${targetStatus}:`, error.message)
    return null
  }

  console.log(`[supply-pipeline] ${supplyId}: ${status} → ${targetStatus} (event: ${event})`)

  // 4. Write activity log (fire-and-forget)
  supabase.from('activity_log').insert({
    entity_type: 'supply',
    entity_id: supplyId,
    action: 'pipeline_transition',
    description: `Estado cambiado de "${status}" a "${targetStatus}" por evento: ${event}`,
    performed_by: userId || 'system',
    metadata: { from_status: status, to_status: targetStatus, event },
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {})

  return targetStatus
}

/**
 * Convenience: advance multiple supplies at once (e.g. after bulk invoice upload).
 */
export async function advanceMultipleSupplies(
  supabase: any,
  supplyIds: string[],
  event: PipelineEvent,
  userId?: string,
): Promise<void> {
  await Promise.all(
    supplyIds.map(id => advanceSupplyPipeline({ supabase, supplyId: id, event, userId }))
  )
}
