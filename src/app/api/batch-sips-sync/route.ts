/**
 * POST /api/batch-sips-sync
 *
 * Sincroniza SIPS para los suministros de luz de un cliente.
 * Soporta paginación para evitar timeouts de Vercel.
 *
 * Body: { client_id: string, force?: boolean, offset?: number, limit?: number }
 * Response: { synced, skipped, errors, processed, total, done }
 *   - processed: cuántos procesó esta llamada
 *   - total: total de supplies luz del cliente
 *   - done: true si ya no quedan más
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSipsForCups } from '@/lib/sips'
import { cupsBase20 } from '@/lib/utils/cups'

export const maxDuration = 60

const CONCURRENCY = 6

// Service-role client (bypasses RLS, same as sync-consumption)
function getServiceClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

async function runConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number,
): Promise<void> {
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { client_id, force = false, offset = 0, limit = 15 } = body

    if (!client_id) {
      return NextResponse.json({ error: 'client_id requerido' }, { status: 400 })
    }

    const supabase = getServiceClient()

    // Count total luz supplies
    const { count: totalCount } = await supabase
      .from('supplies')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .eq('type', 'luz')

    const total = totalCount ?? 0

    // Fetch the page
    const { data: supplies, error: supErr } = await supabase
      .from('supplies')
      .select('id, cups, tariff, consumption_data')
      .eq('client_id', client_id)
      .eq('type', 'luz')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    if (supErr) {
      return NextResponse.json({ error: supErr.message }, { status: 500 })
    }

    if (!supplies || supplies.length === 0) {
      return NextResponse.json({ synced: 0, skipped: 0, errors: 0, processed: 0, total, done: true })
    }

    // Skip supplies that already have SIPS data (unless force)
    const toSync = force
      ? supplies
      : supplies.filter(s => {
          const cd = s.consumption_data as any
          if (cd?.potenciaContratada?.P1 && Number(cd.potenciaContratada.P1) > 0) return false
          if (cd?.source === 'sips' && cd?.totalConsumptionKwh) return false
          return true
        })

    let synced = 0
    let skipped = supplies.length - toSync.length
    let errors = 0

    console.log(`[batch-sips-sync] client=${client_id} offset=${offset} page=${supplies.length} toSync=${toSync.length} force=${force}`)

    await runConcurrent(toSync, async (supply) => {
      if (!supply.cups) { errors++; return }

      const cups = cupsBase20(supply.cups) || supply.cups
      try {
        const sipsData = await fetchSipsForCups(cups, 'luz')
        if (!sipsData) {
          console.warn(`[batch-sips-sync] No SIPS data for ${cups}`)
          errors++
          return
        }

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

        const updatePayload: any = { consumption_data: merged }
        if (sipsData.tariff && !supply.tariff) {
          updatePayload.tariff = sipsData.tariff
        }

        const { error: updErr } = await supabase
          .from('supplies')
          .update(updatePayload)
          .eq('id', supply.id)

        if (updErr) {
          console.error(`[batch-sips-sync] DB update error ${supply.id}:`, updErr.message)
          errors++
        } else {
          console.log(`[batch-sips-sync] ✓ ${cups}`)
          synced++
        }
      } catch (e: any) {
        console.error(`[batch-sips-sync] SIPS error ${cups}:`, e.message)
        errors++
      }
    }, CONCURRENCY)

    const processed = offset + supplies.length
    const done = processed >= total

    // After last chunk: rebuild consumption_snapshots
    if (done && (synced > 0 || force)) {
      try {
        const host = req.headers.get('host') || 'localhost:3000'
        const proto = host.includes('localhost') ? 'http' : 'https'
        await fetch(`${proto}://${host}/api/sync-consumption`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id }),
        })
        console.log('[batch-sips-sync] sync-consumption triggered')
      } catch (e: any) {
        console.warn('[batch-sips-sync] sync-consumption call failed:', e.message)
      }
    }

    return NextResponse.json({ synced, skipped, errors, processed, total, done })
  } catch (e: any) {
    console.error('[batch-sips-sync] Fatal error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
