import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeCups } from '@/lib/utils/cups'
import { fetchSipsForCups } from '@/lib/sips'
import { normalizeTariff } from '@/lib/consumption-utils'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'

// SIPS + power study can take a while
export const maxDuration = 60

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * POST /api/supplies/create-from-cups
 *
 * Creates a new supply from a CUPS code, fetching SIPS data immediately.
 * If the supply already exists for that CUPS, returns the existing one.
 *
 * Body: { cups: string, client_id: string, supply_type?: "luz"|"gas", user_id?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { cups, client_id, supply_type, user_id } = await req.json()

    if (!cups || typeof cups !== 'string') {
      return NextResponse.json({ error: 'CUPS es requerido' }, { status: 400 })
    }
    if (!client_id || typeof client_id !== 'string') {
      return NextResponse.json({ error: 'client_id es requerido' }, { status: 400 })
    }

    const cleanCups = normalizeCups(cups)
    if (!cleanCups) {
      return NextResponse.json({ error: 'Formato de CUPS no válido' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // ── 1. Check if supply already exists for this CUPS ──
    const { data: existing } = await supabase
      .from('supplies')
      .select('id, cups, tariff, type, client_id')
      .eq('cups', cleanCups)
      .limit(1)
      .single()

    if (existing) {
      console.log(`[create-from-cups] Supply already exists for ${cleanCups}: ${existing.id}`)
      return NextResponse.json({
        ok: true,
        supply_id: existing.id,
        is_existing: true,
        cups: cleanCups,
        message: 'Ya existía un suministro con este CUPS',
      })
    }

    // ── 2. Fetch SIPS data ──
    // Detect gas from CUPS pattern or explicit supply_type
    const resolvedType: 'luz' | 'gas' = supply_type === 'gas'
      ? 'gas'
      : /^ES\d{4}1\d{11}/i.test(cleanCups) ? 'gas' // gas CUPS pattern
      : 'luz'

    console.log(`[create-from-cups] Fetching SIPS for ${cleanCups} (${resolvedType})`)
    const sipsData = await fetchSipsForCups(cleanCups, resolvedType).catch((err) => {
      console.warn(`[create-from-cups] SIPS fetch failed (non-fatal):`, err.message)
      return null
    })

    // ── 3. Determine tariff and supply type from SIPS ──
    let tariff = ''
    let detectedType: 'luz' | 'gas' = resolvedType

    if (sipsData?.tariff) {
      tariff = normalizeTariff(sipsData.tariff) || sipsData.tariff
      if (/^RL/i.test(tariff)) detectedType = 'gas'
    }

    // ── 4. Build consumption_data blob from SIPS ──
    let consumptionData: any = null
    if (sipsData) {
      consumptionData = {
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
    }

    // Build address hint from SIPS location
    const addressHint = sipsData?.municipio
      ? [sipsData.municipio, sipsData.provincia].filter(Boolean).join(', ')
      : ''

    // ── 5. Create supply ──
    const { data: newSupply, error: supplyErr } = await supabase
      .from('supplies')
      .insert({
        client_id,
        cups: cleanCups,
        type: detectedType,
        tariff: tariff || '',
        address: addressHint,
        status: 'estudio_en_curso',
        consumption_data: consumptionData,
      })
      .select('id')
      .single()

    if (supplyErr) {
      // Unique constraint race — another insert won the race
      if (supplyErr.code === '23505' || supplyErr.message?.includes('unique') || supplyErr.message?.includes('duplicate')) {
        const { data: conflict } = await supabase
          .from('supplies').select('id').eq('cups', cleanCups).limit(1).single()
        return NextResponse.json({
          ok: true, supply_id: conflict?.id, is_existing: true, cups: cleanCups,
        })
      }
      console.error('[create-from-cups] Insert error:', supplyErr)
      return NextResponse.json({ error: supplyErr.message }, { status: 500 })
    }

    const supplyId = newSupply!.id
    console.log(`[create-from-cups] Created supply ${supplyId} for CUPS ${cleanCups}, SIPS=${!!sipsData}`)

    // Garantizar prescoring pendiente (no bloquea si falla).
    ensurePendingPrescoring(supabase, supplyId, { updateNulls: true })
      .catch((err) => console.warn('[create-from-cups] ensurePrescoring fallido:', err))

    // ── 6. Fire-and-forget: auto power study ──
    if (sipsData?.consumptionHistory?.length && sipsData?.potenciaContratada) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
      fetch(`${baseUrl}/api/power-study-auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cups: cleanCups,
          clientName: 'SIPS',
          potenciaContratada: sipsData.potenciaContratada,
          consumptionHistory: sipsData.consumptionHistory,
          maximetroHistory: sipsData.maximetroHistory || [],
        }),
      }).then(async (r) => {
        if (r.ok) {
          const studyResult = await r.json()
          await supabase
            .from('supplies')
            .update({ power_study_result: studyResult, updated_at: new Date().toISOString() })
            .eq('id', supplyId)
          console.log(`[create-from-cups] Power study saved for ${supplyId}`)
        }
      }).catch((err) => console.error('[create-from-cups] Power study error:', err.message))
    }

    return NextResponse.json({
      ok: true,
      supply_id: supplyId,
      is_existing: false,
      cups: cleanCups,
      has_sips: !!sipsData,
      tariff: tariff || null,
      distribuidora: sipsData?.distribuidora || null,
    })
  } catch (error: any) {
    console.error('[create-from-cups] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 })
  }
}
