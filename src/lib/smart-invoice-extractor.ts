/**
 * SMART INVOICE EXTRACTOR
 * ───────────────────────
 * Shared extraction layer used by ALL invoice-ingestion paths:
 *   1. /api/analyze-invoice          (web app — supply page + upload queue)
 *   2. /api/comparativas/extraer-factura  (comparativas 2.0 — already uses this via re-export)
 *   3. telegram-process.ts           (Telegram bot)
 *
 * Features over the bare analyzeInvoice() call:
 *   • Format knowledge-base lookup (comercializadora_formats table)
 *   • 2-pass extraction: if the first pass has a known-format, retry with hints
 *   • Learning: fire-and-forget metric update per comercializadora
 */

import { analyzeInvoice } from '@/lib/gemini'
import { createClient } from '@supabase/supabase-js'
import type { ExtractedInvoiceData } from '@/lib/gemini'

// ── Supabase service client ───────────────────────────────────────────────────
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FormatoInfo {
  id: string
  notas_extraccion: string | null
  confianza: number
}

export interface SmartExtractionResult {
  /** The best extraction result from Gemini (1st or 2nd pass). */
  extracted: ExtractedInvoiceData
  /** Format record ID used (null if no match in DB). */
  formatoId: string | null
  /** Whether a 2nd-pass retry was used. */
  usedRetry: boolean
}

// ── Format knowledge-base lookup ──────────────────────────────────────────────

export async function lookupFormato(
  comercializadora: string | null | undefined,
): Promise<FormatoInfo | null> {
  if (!comercializadora) return null
  try {
    const supabase = getServiceClient()
    const nombre = comercializadora.trim().toUpperCase()

    // 1. Exact match (case-insensitive) or alias match
    const { data } = await supabase
      .from('comercializadora_formats')
      .select('id, notas_extraccion, confianza')
      .or(`nombre.ilike.${nombre},aliases.cs.{${nombre}}`)
      .eq('activa', true)
      .limit(1)
      .single()
    if (data) return data

    // 2. Partial match on first word (brand name)
    const { data: partial } = await supabase
      .from('comercializadora_formats')
      .select('id, notas_extraccion, confianza')
      .ilike('nombre', `%${nombre.split(' ')[0]}%`)
      .eq('activa', true)
      .limit(1)
      .single()
    return partial ?? null
  } catch {
    return null
  }
}

// ── Learning: update metrics per comercializadora ─────────────────────────────

export async function registrarExtraccion(
  formatoId: string | null,
  ok: boolean,
): Promise<void> {
  if (!formatoId) return
  try {
    const supabase = getServiceClient()
    const now = new Date().toISOString()
    const { data: current } = await supabase
      .from('comercializadora_formats')
      .select('facturas_procesadas, extracciones_ok, extracciones_error')
      .eq('id', formatoId)
      .single()
    if (!current) return
    const update: Record<string, unknown> = {
      facturas_procesadas: (current.facturas_procesadas ?? 0) + 1,
      actualizado_en: now,
    }
    if (ok) {
      update.extracciones_ok = (current.extracciones_ok ?? 0) + 1
      update.ultima_extraccion_ok = now
    } else {
      update.extracciones_error = (current.extracciones_error ?? 0) + 1
      update.ultima_extraccion_error = now
    }
    await supabase.from('comercializadora_formats').update(update).eq('id', formatoId)
  } catch {
    // Non-critical — silently swallow
  }
}

// ── Smart 2-pass extraction ───────────────────────────────────────────────────

/**
 * Drop-in replacement for analyzeInvoice() that adds:
 *   - Format-hint lookup for the detected comercializadora
 *   - A second Gemini pass injecting those hints if the first pass
 *     produced no CUPS or no comercializadora (i.e. incomplete extraction)
 *   - Fire-and-forget learning metric update
 *
 * The caller decides the "ok" heuristic for registrarExtraccion;
 * pass `registerLearning: false` to skip it (e.g. when extraer-factura
 * runs its own math validation and wants to register itself).
 */
export async function smartAnalyzeInvoice(
  base64Data: string,
  mimeType: string,
  extraPages?: { base64Data: string; mimeType: string }[],
  options: {
    /** Skip fire-and-forget learning registration (default: true = do register). */
    registerLearning?: boolean
    /** Additional context passed straight through to Gemini on first pass. */
    additionalContext?: string
  } = {},
): Promise<SmartExtractionResult> {
  const { registerLearning = true, additionalContext } = options

  // ── PASS 1: standard extraction ───────────────────────────────────────────
  const extracted = await analyzeInvoice(
    base64Data,
    mimeType,
    extraPages?.length ? extraPages : undefined,
    additionalContext,
  )

  // If error, return early — nothing useful to do
  if (extracted.error) {
    return { extracted, formatoId: null, usedRetry: false }
  }

  // ── Format lookup ─────────────────────────────────────────────────────────
  const formato = await lookupFormato(extracted.comercializadora)
  const formatoId = formato?.id ?? null

  let bestExtracted = extracted
  let usedRetry = false

  // ── PASS 2: retry with format hints if first pass looks incomplete ────────
  // Trigger retry when: we have format notes AND the first pass is missing
  // the CUPS or the cups+comercializadora together (key fields for saving).
  const pass1Incomplete = !extracted.cups || !extracted.comercializadora
  const hasUsableHints =
    formato?.notas_extraccion &&
    !formato.notas_extraccion.includes('PENDIENTE')

  if (pass1Incomplete && hasUsableHints) {
    console.log(
      `[SmartExtractor] Pass 1 incomplete (cups=${extracted.cups ?? 'null'}, ` +
      `comercializadora=${extracted.comercializadora ?? 'null'}). ` +
      `Retrying with format hints for ${extracted.comercializadora ?? 'unknown'}.`,
    )

    const formatContext = [
      `═══ NOTAS ESPECÍFICAS PARA ESTA COMERCIALIZADORA ═══`,
      formato!.notas_extraccion,
      ``,
      `IMPORTANTE: El primer intento de extracción no extrajo todos los campos clave.`,
      `Revisa especialmente el CUPS y el nombre de la comercializadora.`,
    ].join('\n').trim()

    const extracted2 = await analyzeInvoice(
      base64Data,
      mimeType,
      extraPages?.length ? extraPages : undefined,
      formatContext,
    )

    if (!extracted2.error) {
      // Use pass 2 if it improved key fields
      const p2Better =
        (!extracted.cups && extracted2.cups) ||
        (!extracted.comercializadora && extracted2.comercializadora)
      if (p2Better) {
        bestExtracted = extracted2
        usedRetry = true
        console.log(`[SmartExtractor] Pass 2 improved extraction.`)
      }
    }
  }

  // ── Learning (fire-and-forget) ────────────────────────────────────────────
  if (registerLearning) {
    const ok =
      !bestExtracted.error &&
      !!bestExtracted.cups &&
      bestExtracted.documentType === 'factura'
    registrarExtraccion(formatoId, ok)
  }

  return { extracted: bestExtracted, formatoId, usedRetry }
}
