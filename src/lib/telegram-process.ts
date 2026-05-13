import { createClient } from '@supabase/supabase-js'
import { smartAnalyzeInvoice } from '@/lib/smart-invoice-extractor'
import { analyzeIdentityDocument } from '@/lib/identityExtractor'
import { normalizeCups, cupsBase20, sameCupsBase } from '@/lib/utils/cups'
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

// Lista canónica de comercializadoras energéticas españolas — para detectar
// cuándo Gemini ha extraído erróneamente el logo (NOVALUZ, IBERDROLA…) como
// `holder_name` en facturas donde el titular real está en otra página.
//
// Se compara normalizando: lowercase, sin acentos, sin sufijos legales
// (SL/SA), sin espacios extra. Si holder_name canónico coincide con una de
// estas, lo descartamos para que el flujo no cree un cliente fantasma.
const COMERCIALIZADORAS_CONOCIDAS = new Set([
  'iberdrola', 'iberdrola clientes',
  'endesa', 'endesa energia', 'endesa energia xxi',
  'naturgy', 'naturgy iberia',
  'repsol', 'repsol comercializadora',
  'totalenergies', 'total energies',
  'holaluz', 'octopus', 'octopus energy',
  'plenitude', 'eni plenitude', 'ekyner',
  'galp', 'galp energia',
  'novaluz', 'nova luz',
  'audax', 'aldro', 'aldro energia',
  'gas natural fenosa', 'fenosa',
  'edp', 'edp comercializadora',
  'acciona', 'acciona energia',
  'nufri', 'pepeenergy', 'pepe energy',
  'cide hcenergia', 'enercluster', 'lucera',
  'imagina energia', 'goiener', 'som energia',
])

function normalizaParaMatch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.,;:]/g, ' ')
    .replace(/\b(s\.?l\.?u?\.?|s\.?a\.?u?\.?|s\.?c\.?|s\.?coop\.?|c\.?b\.?|sociedad|limitada|anonima|cooperativa)\b/g, '')
    .replace(/\s+/g, ' ').trim()
}

function isComercializadoraName(name: string | null | undefined): boolean {
  if (!name) return false
  const norm = normalizaParaMatch(name)
  if (!norm) return false
  if (COMERCIALIZADORAS_CONOCIDAS.has(norm)) return true
  // Match parcial: la palabra principal coincide con una comercializadora
  for (const c of COMERCIALIZADORAS_CONOCIDAS) {
    if (norm === c || norm.startsWith(c + ' ') || norm.endsWith(' ' + c)) return true
  }
  return false
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
  duplicate?: boolean
  duplicate_period?: string  // human-readable period for the notification message
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
  } else if (!item.file_url && inboxId) {
    // itemData was provided (to skip re-analysis) but file_url is empty.
    // The webhook uploads the file to storage BEFORE calling this function,
    // so the real public URL is already in telegram_inbox.file_url.
    // Fetch it so the invoice record has a viewable/downloadable link.
    const { data: dbItem } = await supabase
      .from('telegram_inbox')
      .select('file_url, file_name, file_type')
      .eq('id', inboxId)
      .single()
    if (dbItem?.file_url) {
      item = {
        ...item,
        file_url: dbItem.file_url,
        file_name: item.file_name || dbItem.file_name,
        file_type: item.file_type || dbItem.file_type,
      }
    }
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
      const { extracted: smartResult } = await smartAnalyzeInvoice(base64, fileMime, extraPages)
      extractedData = smartResult
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

  // 3b. Identity document detection — if no CUPS/tariff found by invoice extractor,
  //      try the identity extractor. If it recognises the doc (DNI/CIF/cert bancario),
  //      save the file URL to the client's profile and return early (no supply/invoice).
  // SKIP when preAnalyzed is provided: the webhook already classified this as a factura.
  // Running identity detection here would make a redundant Gemini call and could
  // wrongly classify the invoice as a DNI/CIF, creating garbage "photo.jpg" clients.
  const quickCups = extractedData?.cups ? normalizeCups(extractedData.cups) : null
  const quickTariff = extractedData?.tariff || extractedData?.economics?.tarifa || null
  if (!preAnalyzed && !quickCups && !quickTariff && base64 && fileMime) {
    try {
      const identity = await analyzeIdentityDocument(base64, fileMime)
      if (identity.documentType !== 'desconocido') {
        console.log(`[TelegramProcess] Identity document detected: ${identity.documentType}`)

        // Find or create client from identity data
        let identityClientId: string | null = null
        const identityId = identity.documentType === 'dni' ? identity.dni
          : identity.documentType === 'cif' ? identity.cif
          : identity.iban ? null : null // cert bancario: match by iban/name

        // Try CIF/NIF match first
        if (identityId) {
          const cleanId = identityId.replace(/[\s.-]/g, '').toUpperCase()
          const { data: matches } = await supabase
            .from('clients')
            .select('id')
            .or(`cif_nif.ilike.%${cleanId}%,cif.ilike.%${cleanId}%,nif.ilike.%${cleanId}%`)
            .limit(1)
          if (matches?.length) identityClientId = matches[0].id
        }

        // Try by name
        if (!identityClientId) {
          const nameToSearch = identity.full_name || identity.company_name || identity.account_holder || null
          if (nameToSearch) {
            const brandKeywords = extractBrandKeywords(nameToSearch)
            const keyword = brandKeywords[0]
            if (keyword) {
              const { data: nameMatches } = await supabase
                .from('clients')
                .select('id, name')
                .ilike('name', `%${keyword}%`)
                .limit(1)
              if (nameMatches?.length) identityClientId = nameMatches[0].id
            }
          }
        }

        // Create new client if not found
        // Never use filename as client name — it produces garbage like "photo.jpg"
        const rawClientName = identity.full_name || identity.company_name || identity.account_holder || null
        if (!identityClientId && !rawClientName) {
          // Can't identify who this is — skip silently rather than create garbage record
          console.warn(`[TelegramProcess] Identity doc found (${identity.documentType}) but no name extractable — skipping client creation`)
          await supabase.from('telegram_inbox').update({ status: 'pending_confirm', processed_at: new Date().toISOString() }).eq('id', inboxId)
          return { ok: true, skipped: true }
        }
        if (!identityClientId) {
          const clientName = rawClientName || 'Cliente Telegram'
          // NIE (documentType 'nie') is also a particular person
          const isParticular = identity.documentType === 'dni' || identity.documentType === 'nie'
          const clientPayload = {
            name: clientName,
            type: isParticular ? 'particular' : 'empresa',
            commercial_id: item.user_id,
            cif_nif: identity.dni || identity.cif || null,
            nif: identity.dni || null,
            cif: identity.cif || null,
            marketing_consent: false,
          }
          const res = await supabase.from('clients').insert({ ...clientPayload, origin: 'telegram' }).select('id').single()
          identityClientId = res.data?.id || null
          console.log(`[TelegramProcess] Created client from identity doc: ${identityClientId}`)
        }

        // Save document URL and extracted fields to the client
        if (identityClientId) {
          const patch: Record<string, any> = {}
          if (identity.documentType === 'dni') {
            patch.nif_file_url = item.file_url
            if (identity.dni) { patch.nif = identity.dni; patch.cif_nif = identity.dni }
            if (identity.full_name) patch.name = identity.full_name
            if (identity.fiscal_address) patch.fiscal_address = identity.fiscal_address
          } else if (identity.documentType === 'cif') {
            patch.cif_file_url = item.file_url
            if (identity.cif) { patch.cif = identity.cif; patch.cif_nif = identity.cif }
            if (identity.company_name) patch.name = identity.company_name
            if (identity.fiscal_address) patch.fiscal_address = identity.fiscal_address
          } else if (identity.documentType === 'cert_bancario') {
            patch.iban_file_url = item.file_url
            if (identity.iban) patch.iban = identity.iban
            if (identity.account_holder) patch.name = identity.account_holder
            if (identity.account_holder_id) {
              const id = identity.account_holder_id.toUpperCase()
              if (/^[A-HJNP-SUVW]/.test(id)) { patch.cif = id; patch.cif_nif = id }
              else { patch.nif = id; patch.cif_nif = id }
            }
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from('clients').update(patch).eq('id', identityClientId)
            console.log(`[TelegramProcess] Saved identity doc (${identity.documentType}) to client ${identityClientId}:`, Object.keys(patch))
          }
        }

        await supabase.from('telegram_inbox').update({
          status: 'processed',
          processed_at: new Date().toISOString(),
        }).eq('id', inboxId)

        return {
          ok: true,
          client_id: identityClientId || undefined,
          client_type: (identity.documentType === 'dni' || identity.documentType === 'nie') ? 'particular' : 'empresa',
        }
      }
    } catch (identityErr: any) {
      // Non-fatal — if identity detection fails, continue as normal invoice
      console.warn(`[TelegramProcess] Identity detection failed (continuing as invoice):`, identityErr.message)
    }
  }

  // 4. Extract key fields
  const rawCups = extractedData?.cups || null
  const cups = rawCups ? normalizeCups(rawCups) : null
  let holderName = extractedData?.holder_name || extractedData?.economics?.titular || null

  // ── Filtro anti-comercializadoras ────────────────────────────────────────
  // Si Gemini extrae como "holder_name" lo que en realidad es el logo de la
  // comercializadora (NOVALUZ, IBERDROLA…), nos creaba un cliente erróneo.
  // Si el nombre coincide con una comercializadora conocida y NO hay CIF,
  // lo descartamos para que el flujo decida "no holder" y caiga en match
  // por CUPS o pida más contexto en lugar de crear cliente fantasma.
  if (holderName && isComercializadoraName(holderName)) {
    const cifRaw = (extractedData?.holder_cif_nif || extractedData?.holder_cif || extractedData?.economics?.cif_titular || '').trim()
    if (!cifRaw || cifRaw.length < 8) {
      console.log(`[TelegramProcess] holder_name "${holderName}" parece comercializadora y sin CIF — descartando holder`)
      holderName = null
    }
  }
  const holderCif = extractedData?.holder_cif_nif || extractedData?.holder_cif || extractedData?.economics?.cif_titular || null
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
  // IMPORTANT: match on the 20-char base CUPS (without the optional 2-char ICP/meter suffix).
  // A 20-char CUPS and a 22-char CUPS that share the same first 20 chars are the SAME supply
  // point. Using prefix matching (ILIKE 'base%') prevents duplicate supplies when one invoice
  // has 'ES0021000006751517CW' and another has 'ES0021000006751517CW0F'.
  let supplyId: string | null = null
  let clientId: string | null = null
  let isExistingSupply = false

  if (cups && cups.length >= 20) {
    const base20 = cupsBase20(cups)!
    const { data: existingSupplies } = await supabase
      .from('supplies')
      .select('id, client_id, cups, tariff, address, type, status')
      .ilike('cups', `${base20}%`)
      .limit(1)

    if (existingSupplies?.length) {
      supplyId = existingSupplies[0].id
      clientId = existingSupplies[0].client_id
      isExistingSupply = true
      console.log(`[TelegramProcess] Found existing supply ${supplyId} for CUPS ${cups} (base: ${base20})`)

      // Patch any missing fields on the existing supply
      const existing = existingSupplies[0] as any
      const patch: Record<string, any> = {}
      if (tariff && !existing.tariff) patch.tariff = tariff
      if (address && !existing.address) patch.address = address
      // Upgrade stored CUPS from 20-char to 22-char if we now have the full version
      if (cups.length === 22 && existing.cups?.length === 20) {
        patch.cups = cups
        console.log(`[TelegramProcess] Upgrading CUPS from 20→22 chars: ${existing.cups} → ${cups}`)
      }
      if (Object.keys(patch).length) {
        await supabase.from('supplies').update(patch).eq('id', supplyId)
        console.log(`[TelegramProcess] Patched existing supply ${supplyId}:`, patch)
      }
    } else {
      // ── Match fuzzy CUPS (Hamming ≤ 2) ─────────────────────────────────
      //    Captura errores típicos del OCR/Gemini en el código de
      //    distribuidora (pos 2-5) o letras de control (pos 18-19):
      //    p.ej. ES0022060007937199KN ↔ ES0226060007937199KN. Guard de
      //    seguridad: el segmento 6-17 (punto de suministro) DEBE coincidir
      //    al 100 % — eso garantiza que no fusionamos suministros físicamente
      //    distintos. Misma lógica que el flujo web (upload-queue.ts).
      const { data: candidates } = await supabase
        .from('supplies')
        .select('id, client_id, cups, tariff, address, type')
        .like('cups', 'ES%')
        .limit(500)
      if (candidates && candidates.length > 0) {
        const fuzzyMatch = candidates.find((s: any) => {
          if (!s.cups || s.cups.length !== cups.length) return false
          if (cups.length >= 18 && s.cups.slice(6, 18) !== cups.slice(6, 18)) return false
          let diffs = 0
          for (let i = 0; i < cups.length; i++) {
            if (s.cups[i] !== cups[i]) diffs++
            if (diffs > 2) return false
          }
          return diffs > 0 && diffs <= 2
        })
        if (fuzzyMatch) {
          supplyId = fuzzyMatch.id
          clientId = fuzzyMatch.client_id
          isExistingSupply = true
          console.log(`[TelegramProcess] Fuzzy supply match: CUPS extraído "${cups}" → DB "${fuzzyMatch.cups}" (diff ≤ 2)`)
          // Si nuestro CUPS extraído tiene más sentido que el guardado
          // (raro), no lo sobreescribimos por seguridad: confiamos en el
          // que ya está en BD.
        }
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

        // ── Asociación contextual: si NO tengo CUPS pero el mismo comercial
        //    subió otra factura del mismo cliente con CUPS en los últimos
        //    15 min, asocio al supply hermano en lugar de crear uno fantasma
        //    "sin CUPS". Patrón típico de fotos sueltas: una foto tiene CIF
        //    y otra tiene CUPS — sin esto se crearían dos supplies separados.
        if (!supplyId && !cups) {
          const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
          const { data: recentSibling } = await supabase
            .from('invoices')
            .select('supply_id, supplies:supplies!inner(id, cups, client_id)')
            .eq('uploaded_by', item.user_id)
            .gte('created_at', fifteenMinAgo)
            .order('created_at', { ascending: false })
            .limit(20)
          // Buscar primer sibling cuyo supply pertenezca al mismo cliente Y tenga CUPS
          const match = (recentSibling || []).find((r: any) => {
            const sup = Array.isArray(r.supplies) ? r.supplies[0] : r.supplies
            return sup && sup.client_id === clientId && sup.cups
          })
          if (match) {
            const sup: any = Array.isArray((match as any).supplies) ? (match as any).supplies[0] : (match as any).supplies
            supplyId = sup.id
            isExistingSupply = true
            console.log(`[TelegramProcess] Asociación contextual: factura sin CUPS pero misma comercial + mismo cliente reciente → supply ${supplyId}`)
          }
        }
      }
    }
  }

  // 7a. Match fuzzy por nombre canónico (ignora SL/SA/SLU, promueve nombre y
  //     preserva alias). Este es el camino preferido: misma normalización que
  //     usa la subida web, así clientes como "UNICE TOYS S.L." y "UNICE TOYS"
  //     nunca se duplican.
  if (!clientId && holderName && holderName !== 'No detectado') {
    try {
      const { matchClientByHolderName } = await import('@/lib/client-matcher')
      const hasPostalCodePre = (s?: string | null) => !!s && /\b\d{5}\b/.test(s)
      const fiscalAddrPre =
        [extractedData?.fiscal_address, extractedData?.supply_address].find(hasPostalCodePre) ||
        extractedData?.fiscal_address || extractedData?.supply_address || null
      const matched = await matchClientByHolderName(supabase, {
        holderName,
        cifNif: holderCif,
        fiscalAddress: fiscalAddrPre,
      })
      if (matched) {
        clientId = matched.id
        if (matched.updated) console.log(`[TelegramProcess] Cliente ${matched.name} actualizado con datos de factura nueva`)
        else console.log(`[TelegramProcess] Matched client by canonical name: ${matched.name}`)
      }
    } catch (err) {
      console.warn('[TelegramProcess] Fuzzy match error:', err)
    }
  }

  // 7b. Fallback: keyword scoring (cubre casos no-canónicos, ej. nombres con
  //     erratas o sin sufijo legal pero misma palabra brand).
  if (!clientId && holderName && holderName !== 'No detectado') {
    const keywords = extractKeywords(holderName)
    if (keywords.length > 0) {
      const brandKeywords = extractBrandKeywords(holderName)
      const primaryKeyword = brandKeywords.length > 0 ? brandKeywords[0] : keywords[0]

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

        const minScore = keywords.length >= 2 ? 2 : 1
        if (scored[0].score >= minScore) {
          clientId = scored[0].id
          console.log(`[TelegramProcess] Matched client by keyword fallback: ${scored[0].name} (score ${scored[0].score}/${keywords.length})`)
        }
      }
    }
  }

  // 8. Create new client if no match
  let clientType: string = 'empresa'

  // Best available fiscal address from this invoice — prefer address WITH postal code
  const hasPostalCode = (s?: string | null) => !!s && /\b\d{5}\b/.test(s)
  const invoiceFiscalAddress =
    [extractedData?.fiscal_address, extractedData?.supply_address].find(hasPostalCode) ||
    extractedData?.fiscal_address ||
    extractedData?.supply_address ||
    null

  if (!clientId) {
    const clientName = holderName && holderName !== 'No detectado'
      ? holderName
      : (item.file_name || 'Cliente Telegram')

    // Auto-detect client type: ayuntamiento, empresa, or particular
    const isAyuntamiento = /ayuntamiento|ajuntament|concello|diputaci[oó]n|consejo\s+comarcal|mancomunidad/i.test(clientName)
    // Particular: DNI (starts with digit) or NIE (starts with X, Y, Z)
    const isParticular = holderCif ? (/^\d/.test(holderCif.trim()) || /^[XYZ]/i.test(holderCif.trim())) : false
    clientType = isAyuntamiento ? 'ayuntamiento' : isParticular ? 'particular' : 'empresa'

    // Try with 'telegram' origin first; if the enum value doesn't exist yet, fallback to 'captacion'
    let newClient: any = null
    let clientErr: any = null

    const clientPayload = {
      name: clientName,
      type: clientType,
      commercial_id: item.user_id,
      cif_nif: holderCif || null,
      fiscal_address: invoiceFiscalAddress || null,  // populate from invoice on creation
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
    // Fetch existing client type and fiscal_address
    const { data: existingClient } = await supabase
      .from('clients')
      .select('type, fiscal_address')
      .eq('id', clientId)
      .single()
    clientType = existingClient?.type || 'empresa'

    const existingPatch: Record<string, any> = {}

    // Auto-correct type: if we now know the identifier is a DNI or NIE and client was stored as empresa
    if (holderCif && (/^\d/.test(holderCif.trim()) || /^[XYZ]/i.test(holderCif.trim())) && existingClient?.type === 'empresa') {
      existingPatch.type = 'particular'
      clientType = 'particular'
      console.log(`[TelegramProcess] Auto-corrected client ${clientId} type empresa → particular (DNI/NIE detected)`)
    }

    // Back-fill fiscal_address on existing client if currently empty
    if (!existingClient?.fiscal_address && invoiceFiscalAddress) {
      existingPatch.fiscal_address = invoiceFiscalAddress
    }

    if (Object.keys(existingPatch).length > 0) {
      await supabase.from('clients').update(existingPatch).eq('id', clientId)
    }
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
      // 1st priority: CUPS base-20 match (safety net — handles 20 vs 22-char variants)
      // sameCupsBase('ES...CW', 'ES...CW0F') → true
      const exactMatch = cups ? clientSupplies.find(s => s.cups && sameCupsBase(s.cups, cups)) : null

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

  // 10a. Duplicate invoice check — same supply + same billing period
  if (periodStart && periodEnd && supplyId) {
    const { data: dupCheck } = await supabase
      .from('invoices')
      .select('id')
      .eq('supply_id', supplyId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .limit(1)

    if (dupCheck?.length) {
      console.log(`[TelegramProcess] Duplicate invoice for supply ${supplyId} period ${periodStart}–${periodEnd} — skipping`)
      await supabase.from('telegram_inbox').update({
        status: 'processed',
        processed_at: new Date().toISOString(),
      }).eq('id', inboxId)
      return {
        ok: true,
        supply_id: supplyId!,
        client_id: clientId!,
        client_type: clientType,
        is_existing_supply: true,
        cups,
        duplicate: true,
        duplicate_period: `${periodStart} – ${periodEnd}`,
      }
    }
  }

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
