import { createClient } from '@supabase/supabase-js'
import { analyzeInvoice } from '@/lib/gemini'
import { normalizeCups } from '@/lib/utils/cups'
import { fetchSipsForCups } from '@/lib/sips'
import { advanceSupplyPipeline } from '@/lib/supply-pipeline'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'

/**
 * Shared processing logic for telegram_inbox items.
 * Can be called:
 * - Directly from the webhook (with base64 already available)
 * - From the /api/telegram/process route (re-downloads from storage)
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getSupabase() {
  return createClient(supabaseUrl, supabaseKey)
}

// Legal suffixes for client name cleaning
const LEGAL_SUFFIXES = /\b(s\.?l\.?u?\.?|s\.?a\.?|s\.?c\.?|s\.?coop\.?|c\.?b\.?|sociedad|limitada|anonima|anónima|cooperativa|comunidad\s+de\s+bienes)\b/gi
const FILLER_WORDS = /\b(de|del|la|las|los|el|y|e|en|con|a)\b/gi
/**
 * Generic industry/descriptor words that appear in many company names.
 * Stripping these before picking the "brand keyword" prevents false positives
 * such as searching for "industria" and matching "Cromado industriales sarrasin"
 * when the invoice belongs to "Rodona Industria Grafica SL".
 */
const GENERIC_WORDS = /\b(industria|industrial|industriales|industrias|servicios|servicio|soluciones|solucion|solucions|comercial|comerciales|comercio|grafica|graficas|grafico|graficos|tecnologia|tecnologias|tecnico|tecnicos|proyectos|proyecto|construccion|construcciones|obras|obra|gestion|gestiones|consultoria|instalaciones|instalacion|grupo|grupos|internacional|internacionales|nacional|nacionales|iberica|ibericas|espana|navarra|aragon|cataluna|valencia|asturias|galicia|andalucia)\b/gi

/** All keywords (brand + generic) — used for scoring. */
function extractKeywords(text: string): string[] {
  const cleaned = text
    .replace(LEGAL_SUFFIXES, '')
    .replace(FILLER_WORDS, '')
    .replace(/[.,;:'"()]/g, '')
    .trim()
  return Array.from(new Set(cleaned.split(/\s+/).filter(w => w.length >= 3).map(w => w.toLowerCase())))
}

/**
 * Brand-only keywords: same as extractKeywords but also strips generic industry/
 * descriptor words. The first element is the most distinctive part of the name.
 * Used to pick the PRIMARY search term so we don't search for generic words.
 */
function extractBrandKeywords(text: string): string[] {
  const cleaned = text
    .replace(LEGAL_SUFFIXES, '')
    .replace(FILLER_WORDS, '')
    .replace(GENERIC_WORDS, '')
    .replace(/[.,;:'"()]/g, '')
    .trim()
  // Preserve original word order (don't deduplicate-sort); first word = brand name
  return cleaned.split(/\s+/).filter(w => w.length >= 3).map(w => w.toLowerCase())
    .filter((w, i, arr) => arr.indexOf(w) === i) // unique, order-preserving
}

/** Convert DD/MM/YYYY or DD/MM/YY to YYYY-MM-DD for PostgreSQL. */
function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m) {
    const day = m[1].padStart(2, '0')
    const month = m[2].padStart(2, '0')
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${month}-${day}`
  }
  return null
}

export interface ProcessResult {
  ok: boolean
  supply_id?: string
  client_id?: string
  client_type?: string
  is_existing_supply?: boolean
  cups?: string | null
  error?: string
  skipped?: boolean
}

/**
 * Process a single telegram_inbox item.
 * @param inboxId - UUID of the telegram_inbox row
 * @param base64Data - Optional pre-computed base64 of the file (avoids re-download)
 * @param mimeType - Optional mime type if base64Data is provided
 * @param itemData - Optional pre-fetched item data (avoids re-querying the DB)
 */
export async function processTelegramInboxItem(
  inboxId: string,
  base64Data?: string,
  mimeType?: string,
  itemData?: { file_url: string; file_type: string; file_name: string; user_id: string },
  extraPages?: Array<{ base64Data: string; mimeType: string }>,
  preAnalyzed?: any,
): Promise<ProcessResult> {
  const supabase = getSupabase()

  // 1. Get the inbox item — use provided data or fetch from DB
  let item = itemData as any

  if (!item) {
    const { data, error: fetchErr } = await supabase
      .from('telegram_inbox')
      .select('*')
      .eq('id', inboxId)
      .single()

    if (fetchErr || !data) {
      return { ok: false, error: 'Item not found: ' + (fetchErr?.message || 'no data') }
    }

    if (data.status !== 'pending') {
      return { ok: true, skipped: true }
    }

    item = data
  }

  // Mark as processing
  await supabase
    .from('telegram_inbox')
    .update({ status: 'processing' })
    .eq('id', inboxId)

  console.log(`[TelegramProcess] Processing ${inboxId}: ${item.file_name}`)

  // 2. Get base64 — use provided data or download from storage
  let base64 = base64Data
  let fileMime = mimeType

  if (!base64) {
    const fileRes = await fetch(item.file_url)
    if (!fileRes.ok) {
      await supabase.from('telegram_inbox').update({ status: 'error' }).eq('id', inboxId)
      return { ok: false, error: `Failed to download file: ${fileRes.status}` }
    }
    const blob = await fileRes.blob()
    const buffer = Buffer.from(await blob.arrayBuffer())
    base64 = buffer.toString('base64')
  }

  if (!fileMime) {
    fileMime = item.file_type === 'pdf' ? 'application/pdf' : 'image/jpeg'
  }

  // 3. Analyze with Gemini (skip if pre-analyzed data was passed from webhook)
  let extractedData: any
  if (preAnalyzed) {
    extractedData = preAnalyzed
    console.log(`[TelegramProcess] Using pre-analyzed data for ${inboxId}:`, {
      cups: extractedData?.cups,
      holder: extractedData?.holder_name,
    })
  } else {
    try {
      extractedData = await analyzeInvoice(base64, fileMime, extraPages)
      console.log(`[TelegramProcess] Analysis done:`, {
        cups: extractedData?.cups,
        holder: extractedData?.holder_name,
        cif: extractedData?.holder_cif || extractedData?.economics?.cif_titular,
      })
    } catch (analysisErr: any) {
      console.error(`[TelegramProcess] Analysis failed:`, analysisErr)
      await supabase.from('telegram_inbox').update({
        status: 'error',
        processed_at: new Date().toISOString(),
      }).eq('id', inboxId)
      return { ok: false, error: 'Analysis failed: ' + analysisErr.message }
    }
  }

  // 4. Extract key fields
  const rawCups = extractedData?.cups || null
  const cups = rawCups ? normalizeCups(rawCups) : null
  const holderName = extractedData?.holder_name || extractedData?.economics?.titular || null
  const holderCif = extractedData?.holder_cif || extractedData?.economics?.cif_titular || null
  const tariff = extractedData?.tariff || extractedData?.economics?.tarifa || null
  const address = extractedData?.supply_address || extractedData?.billing_address || null
  // Detect supply type: gas ONLY if tariff is RL.x (gas access tariff) or supply_type explicitly gas.
  // Never classify as gas based on supply_type alone when a non-RL tariff is present —
  // secondary pages (charts, contract detail) can be mis-classified by Gemini without full context.
  const rawType = (extractedData?.supply_type || extractedData?.economics?.supply_type || '').toLowerCase()
  const tariffIsGas = tariff && /^RL/i.test(tariff)
  const tariffIsElec = tariff && /^[236]\./i.test(tariff) // 2.0TD, 3.0TD, 6.1TD → always electricity
  const supplyType: string = tariffIsGas ? 'gas'
    : tariffIsElec ? 'luz'  // explicit electricity tariff overrides any rawType
    : rawType === 'gas' || rawType.includes('gas') ? 'gas'
    : rawType === 'telefonia' || rawType.includes('telef') || rawType.includes('fibra') ? 'telefonia'
    : 'luz'

  // 5. Try to find existing supply by CUPS
  let supplyId: string | null = null
  let clientId: string | null = null
  let isExistingSupply = false

  if (cups && cups.length >= 20) {
    const { data: existingSupplies } = await supabase
      .from('supplies')
      .select('id, client_id, cups, tariff, address, type, status')
      .eq('cups', cups)
      .limit(1)

    if (existingSupplies?.length) {
      supplyId = existingSupplies[0].id
      clientId = existingSupplies[0].client_id
      isExistingSupply = true
      console.log(`[TelegramProcess] Found existing supply ${supplyId} for CUPS ${cups}`)

      // Patch any missing fields on the existing supply
      const existing = existingSupplies[0] as any
      const patch: Record<string, any> = {}
      if (tariff && !existing.tariff) patch.tariff = tariff
      if (address && !existing.address) patch.address = address
      if (Object.keys(patch).length) {
        await supabase.from('supplies').update(patch).eq('id', supplyId)
        console.log(`[TelegramProcess] Patched existing supply ${supplyId}:`, patch)
      }
    }
  }

  // 6. Try to find client by CIF/NIF
  if (!clientId && holderCif) {
    const cleanCif = holderCif.replace(/[\s.-]/g, '').toUpperCase()
    if (cleanCif.length >= 8) {
      const { data: cifMatches } = await supabase
        .from('clients')
        .select('id, name')
        .or(`cif_nif.ilike.%${cleanCif}%,cif.ilike.%${cleanCif}%,nif.ilike.%${cleanCif}%`)
        .limit(1)

      if (cifMatches?.length) {
        clientId = cifMatches[0].id
        console.log(`[TelegramProcess] Matched client by CIF: ${cifMatches[0].name}`)
      }
    }
  }

  // 7. Try by holder name keywords
  if (!clientId && holderName && holderName !== 'No detectado') {
    const keywords = extractKeywords(holderName)
    if (keywords.length > 0) {
      // Use the first brand keyword (non-generic, original word order) as the
      // primary search term. This avoids searching for generic words like
      // "industria" that appear as substrings in many unrelated company names.
      const brandKeywords = extractBrandKeywords(holderName)
      const primaryKeyword = brandKeywords.length > 0
        ? brandKeywords[0]   // e.g. "rodona" instead of "industria"
        : keywords[0]        // fallback: first keyword if all are generic

      const { data: nameMatches } = await supabase
        .from('clients')
        .select('id, name')
        .ilike('name', `%${primaryKeyword}%`)
        .limit(5)

      if (nameMatches?.length) {
        const scored = nameMatches.map(c => ({
          ...c,
          score: keywords.filter(k => c.name.toLowerCase().includes(k)).length,
        })).sort((a, b) => b.score - a.score)

        // When there are multiple keywords, require at least 2 to match
        // to avoid single-word false positives (e.g. "industria" ≠ "industriales")
        const minScore = keywords.length >= 2 ? 2 : 1
        if (scored[0].score >= minScore) {
          clientId = scored[0].id
          console.log(`[TelegramProcess] Matched client by name: ${scored[0].name} (score ${scored[0].score}/${keywords.length})`)
        }
      }
    }
  }

  // 8. Create new client if no match
  let clientType: string = 'empresa'
  if (!clientId) {
    const clientName = holderName && holderName !== 'No detectado'
      ? holderName
      : (item.file_name || 'Cliente Telegram')

    // Auto-detect client type: ayuntamiento, empresa, or particular
    const isAyuntamiento = /ayuntamiento|ajuntament|concello|diputaci[oó]n|consejo\s+comarcal|mancomunidad/i.test(clientName)
    const isParticular = holderCif ? /^\d/.test(holderCif.trim()) : false
    clientType = isAyuntamiento ? 'ayuntamiento' : isParticular ? 'particular' : 'empresa'

    // Try with 'telegram' origin first; if the enum value doesn't exist yet, fallback to 'captacion'
    let newClient: any = null
    let clientErr: any = null

    const clientPayload = {
      name: clientName,
      type: clientType,
      commercial_id: item.user_id,
      cif_nif: holderCif || null,
      marketing_consent: false,
    }

    const res1 = await supabase
      .from('clients')
      .insert({ ...clientPayload, origin: 'telegram' })
      .select('id')
      .single()

    if (res1.error) {
      console.warn(`[TelegramProcess] 'telegram' origin failed, trying 'captacion':`, res1.error.message)
      const res2 = await supabase
        .from('clients')
        .insert({ ...clientPayload, origin: 'captacion' })
        .select('id')
        .single()
      newClient = res2.data
      clientErr = res2.error
    } else {
      newClient = res1.data
    }

    if (clientErr || !newClient) {
      console.error(`[TelegramProcess] Failed to create client:`, clientErr)
      await supabase.from('telegram_inbox').update({ status: 'error' }).eq('id', inboxId)
      return { ok: false, error: 'Failed to create client: ' + (clientErr?.message || 'unknown') }
    }

    clientId = newClient.id
    console.log(`[TelegramProcess] Created new client: ${clientName} (${clientId}) type=${clientType}`)
  } else {
    // Fetch existing client type for ayuntamiento detection
    const { data: existingClient } = await supabase
      .from('clients')
      .select('type')
      .eq('id', clientId)
      .single()
    clientType = existingClient?.type || 'empresa'
  }

  // 8b. If we matched client by CIF/name (not by CUPS), look for an existing supply
  // for this client that we can reuse instead of creating a duplicate.
  //
  // Priority order:
  //   1. Exact CUPS match (safety net — step 5 should have caught this already)
  //   2. Supply with no CUPS + same type → fill in the missing data
  //   3. Any supply updated within the last 3 minutes + same type →
  //      handles multi-page invoices processed as individual photos:
  //      page 1 creates the supply (with CUPS), page 2 (no CUPS, economics detail)
  //      arrives seconds later and should merge into that same supply.
  if (clientId && !supplyId) {
    const { data: clientSupplies } = await supabase
      .from('supplies')
      .select('id, cups, tariff, address, type, updated_at')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(10)

    if (clientSupplies?.length) {
      // 1st priority: exact CUPS match (shouldn't happen here but safety net)
      const exactMatch = cups ? clientSupplies.find(s => s.cups === cups) : null

      // 2nd priority: supply without CUPS and same type → fill in the gap
      const noCupsMatch = clientSupplies.find(s => !s.cups && (s.type === supplyType || !s.type))

      // 3rd priority: any supply updated within last 3 minutes (TYPE-AGNOSTIC when no CUPS).
      // Only used when this page has no CUPS — it needs to latch onto an existing supply.
      // Multi-page invoices sent as separate Telegram photos: one page may have the CUPS
      // (and be mis-classified as a different type due to limited context) while another
      // has the economics data.  We must NOT require a type match here — whichever page
      // ran first already set the correct type; the secondary page just adds its data.
      const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString()
      const recentMatch = !cups
        ? clientSupplies.find(s => (s.updated_at || '') > threeMinAgo)
        : null

      const targetSupply = exactMatch || noCupsMatch || recentMatch

      if (targetSupply) {
        supplyId = targetSupply.id
        isExistingSupply = true
        const matchReason = exactMatch ? 'exact CUPS' : noCupsMatch ? 'no-CUPS supply' : 'recent supply (recency merge)'
        console.log(`[TelegramProcess] Reusing supply ${supplyId} via ${matchReason} (was: cups=${targetSupply.cups || 'null'})`)

        // Patch any missing fields on the existing supply.
        // IMPORTANT: never overwrite an established type (e.g. 'luz') with a
        // mis-detected type from a secondary page ('gas') — preserve the first page's value.
        const patch: Record<string, any> = {}
        if (cups && !targetSupply.cups) patch.cups = cups
        if (tariff && !targetSupply.tariff) patch.tariff = tariff
        if (address && !targetSupply.address) patch.address = address
        if (supplyType && !targetSupply.type) patch.type = supplyType
        // Correct type if the existing supply was wrongly set to gas for an electricity CUPS
        // (can happen when the CUPS-bearing page arrives first with limited context)
        if (targetSupply.type === 'gas' && supplyType === 'luz') patch.type = 'luz'
        if (Object.keys(patch).length) {
          patch.updated_at = new Date().toISOString()
          await supabase.from('supplies').update(patch).eq('id', supplyId)
          console.log(`[TelegramProcess] Patched supply ${supplyId}:`, patch)
        }
      }
    }
  }

  // 9. Create new supply if none exists — with race-condition protection
  if (!supplyId) {
    const { data: newSupply, error: supplyErr } = await supabase
      .from('supplies')
      .insert({
        client_id: clientId,
        cups: cups || null,
        type: supplyType,
        tariff: tariff || '',
        address: address || '',
        status: 'estudio_en_curso',
      })
      .select('id')
      .single()

    if (supplyErr) {
      // Unique constraint conflict — another channel already created this CUPS
      if (cups && (supplyErr.code === '23505' || supplyErr.message?.includes('unique') || supplyErr.message?.includes('duplicate'))) {
        console.log(`[TelegramProcess] CUPS ${cups} conflict — looking up existing supply`)
        const { data: existing } = await supabase
          .from('supplies')
          .select('id, client_id')
          .eq('cups', cups)
          .limit(1)
          .single()

        if (existing) {
          supplyId = existing.id
          clientId = existing.client_id
          isExistingSupply = true
          console.log(`[TelegramProcess] Resolved conflict → existing supply ${supplyId}`)
        } else {
          console.error(`[TelegramProcess] Conflict but supply not found for ${cups}`)
          await supabase.from('telegram_inbox').update({ status: 'error' }).eq('id', inboxId)
          return { ok: false, error: 'Supply conflict — could not resolve' }
        }
      } else {
        console.error(`[TelegramProcess] Failed to create supply:`, supplyErr)
        await supabase.from('telegram_inbox').update({ status: 'error' }).eq('id', inboxId)
        return { ok: false, error: 'Failed to create supply: ' + supplyErr.message }
      }
    } else if (newSupply) {
      supplyId = newSupply.id
      console.log(`[TelegramProcess] Created new supply: ${supplyId}`)
    }
  }

  // 10. Create invoice record (with full period dates and amount)
  const eco = extractedData?.economics
  const periodStart = eco?.fechaInicio
    ? toIsoDate(eco.fechaInicio)
    : toIsoDate(extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[0])
  const periodEnd = eco?.fechaFin
    ? toIsoDate(eco.fechaFin)
    : toIsoDate(extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[1])
  const totalAmount = eco?.totalFactura
    ?? (extractedData?.total_amount ? parseFloat(extractedData.total_amount) : null)

  const { error: invoiceErr } = await supabase.from('invoices').insert({
    supply_id: supplyId,
    file_url: item.file_url,
    file_type: item.file_type === 'pdf' ? 'pdf' : 'image',
    extraction_status: 'completed',
    extracted_data: extractedData,
    period_start: periodStart,
    period_end: periodEnd,
    total_amount: totalAmount,
  })

  if (invoiceErr) {
    console.error(`[TelegramProcess] Invoice creation error:`, invoiceErr)
  }

  // 10b. Ensure prescoring row exists and is fully populated from invoice data
  if (supplyId) {
    await ensurePendingPrescoring(supabase, supplyId, {
      userId: item.user_id,
      updateNulls: true,
    })
  }

  // 10c. Auto-advance pipeline (for existing supplies that may be in early stages)
  if (supplyId) {
    await advanceSupplyPipeline({
      supabase,
      supplyId,
      event: 'invoices_added',
    })
  }

  // 11. Mark as processed
  await supabase.from('telegram_inbox').update({
    status: 'processed',
    processed_at: new Date().toISOString(),
  }).eq('id', inboxId)

  console.log(`[TelegramProcess] Done: ${inboxId} → supply ${supplyId} (${isExistingSupply ? 'existing' : 'new'})`)

  // 12. Fetch SIPS + power study (awaited so consumption_data is ready before caller returns)
  if (cups && cups.length >= 20 && supplyId) {
    await fetchSipsAndStudy(supplyId, cups, holderName || 'Telegram').catch(err => {
      console.error(`[TelegramProcess] SIPS error (non-fatal):`, err.message)
    })
  }

  // 13. For ayuntamiento clients, trigger sync-consumption (fire-and-forget OK — secondary)
  if (clientType === 'ayuntamiento' && clientId) {
    triggerAyuntamientoSync(clientId).catch(err => {
      console.error(`[TelegramProcess] Background ayuntamiento sync error:`, err.message)
    })
  }

  return {
    ok: true,
    supply_id: supplyId!,
    client_id: clientId!,
    client_type: clientType,
    is_existing_supply: isExistingSupply,
    cups,
  }
}

/**
 * Background SIPS + Power Study (fire-and-forget from processTelegramInboxItem)
 */
export async function fetchSipsAndStudy(supplyId: string, cups: string, holderName: string) {
  const supabase = getSupabase()

  console.log(`[TelegramProcess] Fetching SIPS for supply ${supplyId}, CUPS ${cups}`)

  // Use shared lib instead of calling API route (avoids self-referencing HTTP calls)
  const sipsData = await fetchSipsForCups(cups)
  if (!sipsData) {
    console.warn(`[TelegramProcess] No SIPS data returned for ${cups}`)
    return
  }

  const updatedConsumption = {
    source: 'greening_sips',
    fetched_at: new Date().toISOString(),
    total: sipsData.totalConsumption,
    totalKwh: sipsData.totalConsumptionKwh,
    sips_tariff: sipsData.tariff,
    consumoPeriodos: sipsData.consumoPeriodos,
    potenciaContratada: sipsData.potenciaContratada,
    history: sipsData.consumptionHistory || [],
    maximetroHistory: sipsData.maximetroHistory || [],
    reactivaHistory: sipsData.reactivaHistory || [],
    distribuidora: sipsData.distribuidora,
    codigoPostal: sipsData.codigoPostal,
    provincia: sipsData.provincia,
    municipio: sipsData.municipio,
    cnae: sipsData.cnae,
    tension: sipsData.tension,
    fechaAlta: sipsData.fechaAlta,
    fechaUltimaLectura: sipsData.fechaUltimaLectura,
  }

  await supabase.from('supplies').update({
    consumption_data: updatedConsumption,
    ...(sipsData.tariff ? { tariff: sipsData.tariff } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', supplyId)

  console.log(`[TelegramProcess] SIPS saved for supply ${supplyId}`)

  // Patch prescoring with SIPS-derived fields (consumo_anual, poblacion, entidad)
  // This runs after SIPS is saved, so ensurePrescoring will pick up consumption_data
  await ensurePendingPrescoring(supabase, supplyId, { updateNulls: true })

  // Power study auto-generation
  if (sipsData.consumptionHistory?.length && sipsData.potenciaContratada) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
    try {
      const studyRes = await fetch(`${baseUrl}/api/power-study-auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cups,
          clientName: holderName,
          potenciaContratada: sipsData.potenciaContratada,
          consumptionHistory: sipsData.consumptionHistory,
          maximetroHistory: sipsData.maximetroHistory || [],
        }),
      })

      if (studyRes.ok) {
        const studyResult = await studyRes.json()
        await supabase.from('supplies').update({
          power_study_result: studyResult,
        }).eq('id', supplyId)
        console.log(`[TelegramProcess] Power study saved for supply ${supplyId}`)
      }
    } catch (err: any) {
      console.error(`[TelegramProcess] Power study error:`, err.message)
    }
  }
}

/**
 * Trigger sync-consumption for an ayuntamiento client.
 * This builds the consumption_snapshots table from SIPS data
 * so the "Estudios de Suministro" modal shows data automatically.
 */
async function triggerAyuntamientoSync(clientId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
  console.log(`[TelegramProcess] Triggering ayuntamiento sync for client ${clientId}`)

  try {
    const res = await fetch(`${baseUrl}/api/sync-consumption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    })
    const data = await res.json()
    if (data.success) {
      console.log(`[TelegramProcess] Ayuntamiento sync OK: ${data.count} snapshots`)
    } else {
      console.warn(`[TelegramProcess] Ayuntamiento sync failed:`, data.error)
    }
  } catch (err: any) {
    console.error(`[TelegramProcess] Ayuntamiento sync error:`, err.message)
  }
}
