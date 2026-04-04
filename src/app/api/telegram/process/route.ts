import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { analyzeInvoice } from '@/lib/gemini'
import { normalizeCups } from '@/lib/utils/cups'

/**
 * POST /api/telegram/process
 *
 * Processes a single telegram_inbox item:
 * 1. Download file from Supabase storage URL
 * 2. Analyze with Gemini (extract CUPS, CIF, holder, tariff, address)
 * 3. Match to existing supply (by CUPS) or existing client (by CIF/name)
 * 4. Create client if needed, create supply if needed, create invoice
 * 5. Mark telegram_inbox item as processed
 * 6. Trigger SIPS + power study if CUPS found
 *
 * Called from the webhook after file upload. Runs independently per file.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getSupabase() {
  return createClient(supabaseUrl, supabaseKey)
}

// Legal suffixes for client name cleaning
const LEGAL_SUFFIXES = /\b(s\.?l\.?u?\.?|s\.?a\.?|s\.?c\.?|s\.?coop\.?|c\.?b\.?|sociedad|limitada|anonima|anónima|cooperativa|comunidad\s+de\s+bienes)\b/gi
const FILLER_WORDS = /\b(de|del|la|las|los|el|y|e|en|con)\b/gi

function extractKeywords(text: string): string[] {
  const cleaned = text
    .replace(LEGAL_SUFFIXES, '')
    .replace(FILLER_WORDS, '')
    .replace(/[.,;:'"()]/g, '')
    .trim()
  return Array.from(new Set(cleaned.split(/\s+/).filter(w => w.length >= 3).map(w => w.toLowerCase())))
}

export async function POST(req: NextRequest) {
  try {
    const { inbox_id } = await req.json()
    if (!inbox_id) {
      return NextResponse.json({ error: 'inbox_id required' }, { status: 400 })
    }

    const supabase = getSupabase()

    // 1. Get the inbox item
    const { data: item, error: fetchErr } = await supabase
      .from('telegram_inbox')
      .select('*')
      .eq('id', inbox_id)
      .single()

    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    if (item.status !== 'pending') {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Already processed' })
    }

    // Mark as processing to prevent double-processing
    await supabase
      .from('telegram_inbox')
      .update({ status: 'processing' })
      .eq('id', inbox_id)

    console.log(`[TelegramProcess] Processing ${inbox_id}: ${item.file_name}`)

    // 2. Download file from Supabase storage URL and convert to base64
    const fileRes = await fetch(item.file_url)
    if (!fileRes.ok) {
      throw new Error(`Failed to download file: ${fileRes.status}`)
    }
    const blob = await fileRes.blob()
    const buffer = Buffer.from(await blob.arrayBuffer())
    const base64 = buffer.toString('base64')

    // 3. Analyze with Gemini
    const mimeType = item.file_type === 'pdf' ? 'application/pdf' : 'image/jpeg'
    let extractedData: any

    try {
      extractedData = await analyzeInvoice(base64, mimeType)
      console.log(`[TelegramProcess] Analysis done:`, {
        cups: extractedData?.cups,
        holder: extractedData?.holder_name,
        cif: extractedData?.holder_cif || extractedData?.economics?.cif_titular,
      })
    } catch (analysisErr: any) {
      console.error(`[TelegramProcess] Analysis failed:`, analysisErr)
      // Mark as error but don't block — admin can retry manually
      await supabase.from('telegram_inbox').update({
        status: 'error',
        processed_at: new Date().toISOString(),
      }).eq('id', inbox_id)
      return NextResponse.json({ ok: false, error: 'Analysis failed', detail: analysisErr.message })
    }

    // 4. Extract key fields
    const rawCups = extractedData?.cups || null
    const cups = rawCups ? normalizeCups(rawCups) : null
    const holderName = extractedData?.holder_name || extractedData?.economics?.titular || null
    const holderCif = extractedData?.holder_cif || extractedData?.economics?.cif_titular || null
    const tariff = extractedData?.tariff || extractedData?.economics?.tarifa || null
    const address = extractedData?.supply_address || extractedData?.billing_address || null

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

    // 6. If no supply found, try to find client by CIF/NIF
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

    // 7. If still no client, try by holder name keywords
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
          // Score by keyword overlap
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

    // 8. If still no client → create new client
    if (!clientId) {
      const clientName = holderName && holderName !== 'No detectado'
        ? holderName
        : (item.file_name || 'Cliente Telegram')

      const { data: newClient, error: clientErr } = await supabase
        .from('clients')
        .insert({
          name: clientName,
          type: 'empresa',
          commercial_id: item.user_id,
          origin: 'telegram',
          cif_nif: holderCif || null,
          marketing_consent: false,
        })
        .select('id')
        .single()

      if (clientErr || !newClient) {
        console.error(`[TelegramProcess] Failed to create client:`, clientErr)
        await supabase.from('telegram_inbox').update({ status: 'error' }).eq('id', inbox_id)
        return NextResponse.json({ ok: false, error: 'Failed to create client' })
      }

      clientId = newClient.id
      console.log(`[TelegramProcess] Created new client: ${clientName} (${clientId})`)
    }

    // 9. If no existing supply → create new supply
    if (!supplyId) {
      const { data: newSupply, error: supplyErr } = await supabase
        .from('supplies')
        .insert({
          client_id: clientId,
          cups: cups || null,
          type: 'luz',
          tariff: tariff || '',
          address: address || '',
          status: 'estudio_en_curso',
        })
        .select('id')
        .single()

      if (supplyErr || !newSupply) {
        console.error(`[TelegramProcess] Failed to create supply:`, supplyErr)
        await supabase.from('telegram_inbox').update({ status: 'error' }).eq('id', inbox_id)
        return NextResponse.json({ ok: false, error: 'Failed to create supply' })
      }

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

    // 10. Create invoice record
    const { error: invoiceErr } = await supabase.from('invoices').insert({
      supply_id: supplyId,
      file_url: item.file_url,
      file_type: item.file_type === 'pdf' ? 'pdf' : 'image',
      extraction_status: 'completed',
      extracted_data: extractedData,
    })

    if (invoiceErr) {
      console.error(`[TelegramProcess] Invoice creation error:`, invoiceErr)
    }

    // 11. Mark telegram_inbox as processed
    await supabase.from('telegram_inbox').update({
      status: 'processed',
      processed_at: new Date().toISOString(),
    }).eq('id', inbox_id)

    // 12. Background: fetch SIPS + power study (non-blocking)
    if (cups && cups.length >= 20 && !isExistingSupply) {
      fetchSipsAndStudy(supplyId!, cups!, holderName || 'Telegram').catch(err => {
        console.error('[TelegramProcess] SIPS background error:', err)
      })
    }

    console.log(`[TelegramProcess] Done: ${inbox_id} → supply ${supplyId} (${isExistingSupply ? 'existing' : 'new'})`)

    return NextResponse.json({
      ok: true,
      supply_id: supplyId,
      client_id: clientId,
      is_existing_supply: isExistingSupply,
      cups,
    })

  } catch (err: any) {
    console.error('[TelegramProcess] Unexpected error:', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

// ── Background SIPS + Power Study ──
async function fetchSipsAndStudy(supplyId: string, cups: string, holderName: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
  const supabase = getSupabase()

  // Fetch SIPS
  const sipsRes = await fetch(`${baseUrl}/api/sips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cups }),
  })

  const sipsResult = await sipsRes.json()
  if (!sipsResult.success || !sipsResult.data) return

  const d = sipsResult.data

  // Update supply with consumption data
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

  // Power study
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
