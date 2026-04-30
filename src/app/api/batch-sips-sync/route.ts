/**
 * POST /api/batch-sips-sync
 *
 * Dispara la sincronización de SIPS para todos los suministros de un cliente
 * que aún no tienen datos SIPS (o fuerza todos si force=true).
 * Después de actualizar supplies, llama a /api/sync-consumption para
 * reconstruir los consumption_snapshots.
 *
 * Body: { client_id: string, force?: boolean }
 * Response: { synced: number, skipped: number, errors: number, total: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { fetchSipsForCups } from '@/lib/sips'
import { cupsBase20 } from '@/lib/utils/cups'

export const maxDuration = 300

// Semaphore — how many SIPS calls to run in parallel
const CONCURRENCY = 4

async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number
): Promise<void> {
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { client_id, force = false } = body

    if (!client_id) {
      return NextResponse.json({ error: 'client_id requerido' }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()

    // Get all luz supplies for the client
    const { data: supplies, error: supErr } = await supabase
      .from('supplies')
      .select('id, cups, tariff, consumption_data')
      .eq('client_id', client_id)
      .eq('supply_type', 'luz')

    if (supErr) {
      return NextResponse.json({ error: supErr.message }, { status: 500 })
    }

    if (!supplies || supplies.length === 0) {
      return NextResponse.json({ synced: 0, skipped: 0, errors: 0, total: 0 })
    }

    // Filter supplies that need SIPS (unless force=true)
    const toSync = force
      ? supplies
      : supplies.filter(s => {
          const cd = s.consumption_data as any
          // Skip if we already have potenciaContratada with at least P1
          if (cd?.potenciaContratada?.P1 && Number(cd.potenciaContratada.P1) > 0) return false
          return true
        })

    let synced = 0
    let skipped = supplies.length - toSync.length
    let errors = 0

    console.log(`[batch-sips-sync] client=${client_id} total=${supplies.length} toSync=${toSync.length} force=${force}`)

    await runWithConcurrency(toSync, async (supply) => {
      if (!supply.cups) { errors++; return }

      const cups = cupsBase20(supply.cups) || supply.cups
      try {
        const sipsData = await fetchSipsForCups(cups, 'luz')
        if (!sipsData) { errors++; return }

        // Merge SIPS data into consumption_data
        const existing = (supply.consumption_data as any) || {}
        const merged = {
          ...existing,
          source: 'sips',
          totalConsumption: sipsData.totalConsumption,
          totalConsumptionKwh: sipsData.totalConsumptionKwh,
          consumoPeriodos: sipsData.consumoPeriodos,
          potenciaContratada: sipsData.potenciaContratada,
          consumptionHistory: sipsData.consumptionHistory,
          maximetroHistory: sipsData.maximetroHistory,
          reactivaHistory: sipsData.reactivaHistory,
          distribuidora: sipsData.distribuidora,
          codigoPostal: sipsData.codigoPostal,
          provincia: sipsData.provincia,
          municipio: sipsData.municipio,
          cnae: sipsData.cnae,
          tension: sipsData.tension,
          fechaAlta: sipsData.fechaAlta,
          fechaUltimaLectura: sipsData.fechaUltimaLectura,
          sipsUpdatedAt: new Date().toISOString(),
        }

        // Update tariff if SIPS has it and supply doesn't
        const updatePayload: any = { consumption_data: merged }
        if (sipsData.tariff && !supply.tariff) {
          updatePayload.tariff = sipsData.tariff
        }

        const { error: updErr } = await supabase
          .from('supplies')
          .update(updatePayload)
          .eq('id', supply.id)

        if (updErr) {
          console.error(`[batch-sips-sync] Error updating supply ${supply.id}:`, updErr.message)
          errors++
        } else {
          console.log(`[batch-sips-sync] ✓ ${cups}`)
          synced++
        }
      } catch (e: any) {
        console.error(`[batch-sips-sync] Error SIPS ${cups}:`, e.message)
        errors++
      }
    }, CONCURRENCY)

    // Rebuild consumption_snapshots by calling the existing sync-consumption endpoint
    if (synced > 0) {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

        // Call sync-consumption directly using Supabase service role (mirrors the route logic)
        const { createClient: createAdminClient } = await import('@supabase/supabase-js')
        const adminSupabase = createAdminClient(supabaseUrl, serviceKey)

        // Import and call the sync logic from our shared util
        // Since we can't easily import a Next.js route handler, call via HTTP internally
        const host = req.headers.get('host') || 'localhost:3000'
        const proto = host.startsWith('localhost') ? 'http' : 'https'
        const syncRes = await fetch(`${proto}://${host}/api/sync-consumption`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Forward cookies for auth
            'Cookie': req.headers.get('cookie') || '',
          },
          body: JSON.stringify({ client_id }),
        })
        if (!syncRes.ok) {
          const txt = await syncRes.text()
          console.warn('[batch-sips-sync] sync-consumption returned', syncRes.status, txt)
        } else {
          console.log('[batch-sips-sync] consumption_snapshots rebuilt successfully')
        }
      } catch (e: any) {
        console.error('[batch-sips-sync] sync-consumption error:', e.message)
      }
    }

    return NextResponse.json({
      synced,
      skipped,
      errors,
      total: supplies.length,
    })
  } catch (e: any) {
    console.error('[batch-sips-sync] Fatal error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
