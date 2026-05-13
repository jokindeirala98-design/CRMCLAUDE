/**
 * GET /api/admin-tasks
 *
 * Devuelve las tareas pendientes del tracker admin. Solo accesible para
 * usuarios con role='admin' (RLS de la tabla admin_tasks lo aplica).
 *
 * Respuesta:
 *   { tasks: Array<{ id, type, supply_id, client_id, created_at, supply, client, invoiceCount }> }
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verificar rol admin (refuerzo del RLS)
    const { data: profile } = await supabase
      .from('users_profile').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
    }

    // Solo tareas de supplies dados de alta en los últimos 3 días.
    // Las tareas antiguas siguen en BD (no se borran) pero no aparecen aquí —
    // así el tracker queda enfocado en lo que entra de nuevo. Si un supply
    // antiguo necesita estudio, el admin puede subirlo desde la ficha del
    // supply directamente sin pasar por el tracker.
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 3)
    const cutoffIso = cutoff.toISOString()

    const { data: tasks, error } = await supabase
      .from('admin_tasks')
      .select(`
        id, type, supply_id, client_id, status, created_at,
        supply:supplies!inner(id, cups, tariff, type, name, address, created_at),
        client:clients(
          id, name, alias, cif, nif, cif_nif, commercial_id,
          commercial:users_profile!commercial_id(id, full_name, nickname, email)
        )
      `)
      .eq('status', 'pending')
      .gte('supply.created_at', cutoffIso)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Contar facturas por supply para mostrar el badge "N facturas"
    const supplyIds = (tasks || []).map((t: any) => t.supply_id).filter(Boolean)
    const invoiceCounts: Record<string, number> = {}
    if (supplyIds.length > 0) {
      const { data: rows } = await supabase
        .from('invoices')
        .select('supply_id')
        .in('supply_id', supplyIds)
      for (const r of (rows || []) as any[]) {
        invoiceCounts[r.supply_id] = (invoiceCounts[r.supply_id] || 0) + 1
      }
    }

    // Ocultar tareas de clientes con MUCHOS supplies (ayuntamientos como
    // Estella con 91 supplies → 91 cards ruidosas). Umbral: 4 supplies por
    // cliente. Esas tareas siguen en BD; se gestionan desde la ficha del
    // cliente/supply, no desde el tracker. Solo clientes pequeños (≤4
    // supplies) generan tarjetas individuales aquí.
    const MAX_SUPPLIES_PER_CLIENT = 4
    const clientIds = Array.from(new Set((tasks || []).map((t: any) => t.client_id).filter(Boolean)))
    const supplyCountPerClient: Record<string, number> = {}
    if (clientIds.length > 0) {
      const { data: supRows } = await supabase
        .from('supplies')
        .select('client_id')
        .in('client_id', clientIds)
      for (const r of (supRows || []) as any[]) {
        supplyCountPerClient[r.client_id] = (supplyCountPerClient[r.client_id] || 0) + 1
      }
    }

    const filtered = (tasks || []).filter((t: any) =>
      (supplyCountPerClient[t.client_id] || 0) <= MAX_SUPPLIES_PER_CLIENT
    )

    const enriched = filtered.map((t: any) => ({
      ...t,
      supply: Array.isArray(t.supply) ? t.supply[0] : t.supply,
      client: Array.isArray(t.client) ? t.client[0] : t.client,
      invoiceCount: invoiceCounts[t.supply_id] || 0,
    }))

    return NextResponse.json({ tasks: enriched })
  } catch (e: any) {
    console.error('[GET /api/admin-tasks]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
