import { createClient } from '@supabase/supabase-js'
import { analyzeInvoice } from '@/lib/gemini'
import { normalizeCups } from '@/lib/utils/cups'

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
const FILLER_WORDS = /\b(de|del|la|las|los|el|y|e|en|con)\b/gi

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

function extractKeywords(text: string): string[] {
  const cleaned = text
    .replace(LEGAL_SUFFIXES, '')
    .replace(FILLER_WORDS, '')
    .replace(/[.,;:'"()]/g, '')
    .trim()
  return Array.from(new Set(cleaned.split(/\s+/).filter(w => w.length >= 3).map(w => w.toLowerCase())))
}

export interface ProcessResult {
  ok: boolean
  supply_id?: string
  client_id?: string
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

  // 3. Analyze with Gemini
  let extractedData: any
  try {
    extractedData = await analyzeInvoice(base64, fileMime)
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

  // 4. Extract key fields
  const rawCups = extractedData?.cups || null
  const cups = rawCups ? normalizeCups(rawCups) : null
  const holderName = extractedData?.holder_name || extractedData?.economics?.titular || null
  const holderCif = extractedData?.holder_cif || extractedData?.economics?.cif_titular || null
  const tariff = extractedData?.tariff || extractedData?.economics?.tarifa || null
  const address = extractedData?.supply_address || extractedData?.billing_address || null
  // Detect supply type: gas if RL tariff, otherwise use extracted type or default to 'luz'
  const rawType = extractedData?.type?.toLowerCase() || ''
  const supplyType: string = tariff && /^RL/i.test(tariff) ? 'gas'
    : rawType.includes('gas') ? 'gas'
    : rawType.includes('telef') || rawType.includes('fibra') ? 'telefonia'
    : 'luz'

  // 5. Try to find existing supply by CUPS
  let supplyId: string | null = null
  let clientId: string | null = null
  let isExistingSupply = false

  if (cups && cups.length >= 20) {
    const { data: existingSupplies } = await supabase
      .from('supplies')
      .select('id, client_id, cups, status')
      .eq('cups', cups)
      .limit(1)

    if (existingSupplies?.length) {
      supplyId = existingSupplies[0].id
      clientId = existingSupplies[0].client_id
      isExistingSupply = true
      console.log(`[TelegramProcess] Found existing supply ${supplyId} for CUPS ${cups}`)
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
      const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0]
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

        if (scored[0].score >= 1) {
          clientId = scored[0].id
          console.log(`[TelegramProcess] Matched client by name: ${scored[0].name}`)
        }
      }
    }
  }

  // 8. Create new client if no match
  if (!clientId) {
    const clientName = holderName && holderName !== 'No detectado'
      ? holderName
      : (item.file_name || 'Cliente Telegram')

    // Auto-detect client type: ayuntamiento, empresa, or particular
    const isAyuntamiento = /ayuntamiento|ajuntament|concello|diputaci[oó]n|consejo\s+comarcal|mancomunidad/i.test(clientName)
    const isParticular = holderCif ? /^\d/.test(holderCif.trim()) : false
    const clientType = isAyuntamiento ? 'ayuntamiento' : isParticular ? 'particular' : 'empresa'

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
    console.log(`[TelegramProcess] Created new client: ${clientName} (${clientId})`)
  }

  // 9. Create new supply if none exists — with race-condition protection
  //    The DB has a unique partial index on supplies.cups (WHERE cups IS NOT NULL).
  //    If two channels try to create the same CUPS simultaneously, one INSERT will
  //    fail with a unique constraint violation. We catch that and look up the winner.
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

      // Create prescoring for non-2.0 tariffs
      const tariffNorm = (tariff || '').replace(/\s+/g, '').toUpperCase()
      const skip20 = tariffNorm.startsWith('2.0') || tariffNorm === '20TD' || tariffNorm === '20'
      if (!skip20 && tariff) {
        await supabase.from('prescorings').insert({
          supply_id: supplyId,
          client_name: holderName || 'Telegram',
          cups: cups,
          tariff: tariff,
          status: 'pending',
          requested_by: item.user_id,
        }).then(r => {
          if (r.error) console.error('[TelegramProcess] Prescoring error:', r.error)
        })
      }
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

  // 11. Mark as processed
  await supabase.from('telegram_inbox').update({
    status: 'processed',
    processed_at: new Date().toISOString(),
  }).eq('id', inboxId)

  console.log(`[TelegramProcess] Done: ${inboxId} → supply ${supplyId} (${isExistingSupply ? 'existing' : 'new'})`)

  return {
    ok: true,
    supply_id: supplyId!,
    client_id: clientId!,
    is_existing_supply: isExistingSupply,
    cups,
  }
}

/**
 * Background SIPS + Power Study (call without await if you don't want to block)
 */
export async function fetchSipsAndStudy(supplyId: string, cups: string, holderName: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
  const supabase = getSupabase()

  const sipsRes = await fetch(`${baseUrl}/api/sips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cups }),
  })

  const sipsResult = await sipsRes.json()
  if (!sipsResult.success || !sipsResult.data) return

  const d = sipsResult.data

  await supabase.from('supplies').update({
    consumption_data: {
      source: 'greening_sips',
      fetched_at: new Date().toISOString(),
      total: d.totalConsumption,
      totalKwh: d.totalConsumptionKwh,
      sips_tariff: d.tariff,
      consumoPeriodos: d.consumoPeriodos,
      potenciaContratada: d.potenciaContratada,
      history: (d.consumptionHistory || []).map((h: any) => ({
        fecha: h.fecha, P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6, total: h.total,
      })),
      maximetroHistory: (d.maximetroHistory || []).map((h: any) => ({
        fecha: h.fecha, P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
      })),
      distribuidora: d.distribuidora,
      codigoPostal: d.codigoPostal,
      provincia: d.provincia,
      municipio: d.municipio,
      cnae: d.cnae,
      tension: d.tension,
      fechaAlta: d.fechaAlta,
      fechaUltimaLectura: d.fechaUltimaLectura,
    },
    ...(d.tariff ? { tariff: d.tariff } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', supplyId)

  if (d.consumptionHistory?.length > 0 && d.potenciaContratada) {
    const studyRes = await fetch(`${baseUrl}/api/power-study-auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cups,
        clientName: holderName,
        potenciaContratada: d.potenciaContratada,
        consumptionHistory: d.consumptionHistory,
        maximetroHistory: d.maximetroHistory || [],
      }),
    })

    if (studyRes.ok) {
      const studyResult = await studyRes.json()
      await supabase.from('supplies').update({
        power_study_result: studyResult,
      }).eq('id', supplyId)
    }
  }
}
