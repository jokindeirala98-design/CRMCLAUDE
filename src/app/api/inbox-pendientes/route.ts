/**
 * GET /api/inbox-pendientes
 *
 * Devuelve los estudios económicos pendientes para mostrarlos en /inbox.
 *
 * - Admin: TODAS las admin_tasks pendientes.
 * - Comercial: las admin_tasks pendientes cuyos clientes son suyos.
 *
 * Reglas de visualización:
 *   - Orden FIFO: estudios más antiguos primero.
 *   - Si un cliente tiene MÁS DE 3 suministros pendientes, en /inbox se
 *     muestra una sola card representativa (el supply con MAYOR consumo
 *     anual del cliente) con groupTotal=N. Al click el comercial irá a
 *     la ficha del cliente, donde puede gestionar todos sus supplies.
 *     Esto evita que ayuntamientos como Estella (91 supplies) saturen la
 *     vista con docenas de cards idénticas.
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const GROUP_THRESHOLD = 3   // > 3 supplies → agrupar

// Extrae el consumo anual (kWh) de supply.consumption_data, sumando periodos
// si hay desglose o leyendo totalKwh/total como fallback.
function consumoAnualKwh(cd: any): number {
  if (!cd) return 0
  const cp = cd.consumoPeriodos
  if (cp && typeof cp === 'object') {
    const s = (Number(cp.P1)||0)+(Number(cp.P2)||0)+(Number(cp.P3)||0)
            + (Number(cp.P4)||0)+(Number(cp.P5)||0)+(Number(cp.P6)||0)
    if (s > 0) return s
  }
  const tk = Number(cd.totalKwh)
  if (tk > 0) return tk
  // total puede venir como string "17.784 kWh"
  if (typeof cd.total === 'string') {
    const n = Number(cd.total.replace(/\./g, '').replace(/[^0-9]/g, ''))
    if (n > 0) return n
  }
  if (typeof cd.total === 'number' && cd.total > 0) return cd.total
  return 0
}

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users_profile').select('id, role').eq('id', user.id).single()
    const isAdmin = profile?.role === 'admin'

    const { data: tasks, error } = await supabase
      .from('admin_tasks')
      .select(`
        id, type, supply_id, client_id, status, created_at,
        supply:supplies(id, cups, tariff, type, name, address, consumption_data, created_at),
        client:clients(
          id, name, alias, cif, nif, cif_nif, commercial_id,
          commercial:users_profile!commercial_id(id, full_name, nickname, email)
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let visible = (tasks || []).map((t: any) => ({
      ...t,
      supply: Array.isArray(t.supply) ? t.supply[0] : t.supply,
      client: Array.isArray(t.client) ? t.client[0] : t.client,
    })) as any[]

    if (!isAdmin) {
      visible = visible.filter(t => t.client?.commercial_id === user.id)
    }

    // Contar facturas por supply
    const supplyIds = visible.map(t => t.supply_id).filter(Boolean)
    const invoiceCounts: Record<string, number> = {}
    if (supplyIds.length > 0) {
      const { data: rows } = await supabase
        .from('invoices').select('supply_id').in('supply_id', supplyIds)
      for (const r of (rows || []) as any[]) {
        invoiceCounts[r.supply_id] = (invoiceCounts[r.supply_id] || 0) + 1
      }
    }

    visible = visible.map(t => ({ ...t, invoiceCount: invoiceCounts[t.supply_id] || 0 }))

    // ── Agrupación por cliente cuando > GROUP_THRESHOLD supplies ──────────
    const byClient: Record<string, any[]> = {}
    for (const t of visible) {
      const k = t.client_id || `__no_client_${t.id}`
      byClient[k] = byClient[k] || []
      byClient[k].push(t)
    }

    const final: any[] = []
    for (const tasksOfClient of Object.values(byClient)) {
      if (tasksOfClient.length > GROUP_THRESHOLD) {
        // Elegir el supply con mayor consumo anual; en caso de empate,
        // el que tenga más facturas; en caso de empate, el más antiguo
        // (el primero por orden created_at asc).
        const winner = [...tasksOfClient].sort((a, b) => {
          const ka = consumoAnualKwh(a.supply?.consumption_data)
          const kb = consumoAnualKwh(b.supply?.consumption_data)
          if (kb !== ka) return kb - ka
          const ia = a.invoiceCount || 0
          const ib = b.invoiceCount || 0
          if (ib !== ia) return ib - ia
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })[0]
        final.push({
          ...winner,
          groupTotal: tasksOfClient.length,
          groupTaskIds: tasksOfClient.map(t => t.id),
        })
      } else {
        for (const t of tasksOfClient) {
          final.push({ ...t, groupTotal: 1 })
        }
      }
    }

    // Reordenar el resultado final por created_at asc (FIFO global)
    final.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    return NextResponse.json({
      tasks: final,
      isAdmin,
      total: final.length,
      totalPendingRaw: visible.length,
    })
  } catch (e: any) {
    console.error('[GET /api/inbox-pendientes]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
