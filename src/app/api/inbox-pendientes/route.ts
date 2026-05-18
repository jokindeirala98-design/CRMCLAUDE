/**
 * GET /api/inbox-pendientes
 *
 * Devuelve los estudios económicos pendientes para mostrarlos en /inbox.
 *
 * - Admin: TODAS las admin_tasks pendientes.
 * - Comercial: las admin_tasks pendientes cuyos clientes son suyos.
 *
 * Cada item viene enriquecido con supply, client (con comercial) y nº de
 * facturas en el supply. Orden cronológico: más antiguas primero (FIFO,
 * para que los estudios que llevan más esperando se aborden antes).
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users_profile').select('id, role').eq('id', user.id).single()

    const isAdmin = profile?.role === 'admin'

    // Query base: admin_tasks pendientes con joins habituales.
    // Para no-admin filtramos por client.commercial_id = user.id.
    let query = supabase
      .from('admin_tasks')
      .select(`
        id, type, supply_id, client_id, status, created_at,
        supply:supplies(id, cups, tariff, type, name, address, created_at),
        client:clients(
          id, name, alias, cif, nif, cif_nif, commercial_id,
          commercial:users_profile!commercial_id(id, full_name, nickname, email)
        )
      `)
      .eq('status', 'pending')
      // Más antiguas primero para FIFO
      .order('created_at', { ascending: true })

    const { data: tasks, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let visible = (tasks || []) as any[]

    // Filtrado por comercial si no es admin
    if (!isAdmin) {
      visible = visible.filter(t => {
        const c = Array.isArray(t.client) ? t.client[0] : t.client
        return c?.commercial_id === user.id
      })
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

    // Para el tracker admin (Panel) hay un filtro de "ocultar clientes con
    // >4 supplies" para no saturar la vista. En "Estudios pendientes"
    // (página dedicada) NO aplicamos ese filtro — el usuario quiere ver
    // todos los estudios sin perderse ninguno. Los ayuntamientos grandes
    // (Estella, etc.) aparecerán también.

    const enriched = visible.map((t: any) => ({
      ...t,
      supply: Array.isArray(t.supply) ? t.supply[0] : t.supply,
      client: Array.isArray(t.client) ? t.client[0] : t.client,
      invoiceCount: invoiceCounts[t.supply_id] || 0,
    }))

    return NextResponse.json({
      tasks: enriched,
      isAdmin,
      total: enriched.length,
    })
  } catch (e: any) {
    console.error('[GET /api/inbox-pendientes]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
