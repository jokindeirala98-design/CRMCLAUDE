import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/crm-context
 *
 * Returns a comprehensive summary of the entire CRM state for the AI assistant.
 * Includes: client names, users, supply statuses, recent activity, counts, etc.
 * This context is sent to Gemini so it can make intelligent decisions.
 */

export interface CRMContext {
  timestamp: string

  // Users
  users: { id: string; full_name: string; role: string; email: string }[]

  // Client stats
  total_clients: number
  recent_clients: { id: string; name: string; type: string; created_at: string }[]
  client_names: string[]

  // Supply pipeline stats
  supply_counts_by_status: Record<string, number>
  total_supplies: number

  // Other counts
  total_invoices: number
  total_prescorings: number
  pending_prescorings: number
  open_incidents: number
  pending_tasks: number
  active_subscriptions: number

  // Recent activity
  recent_supplies: { client_name: string; cups: string; status: string; type: string }[]

  // Comercializadoras
  comercializadoras: string[]
}

export async function GET(request: NextRequest) {
  // Auth guard — only authenticated CRM users can read the full CRM context
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const authClient = createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    // Get auth token from request header
    const authHeader = request.headers.get('authorization')
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    })

    // Execute all queries in parallel for speed
    const [
      usersRes,
      clientsCountRes,
      recentClientsRes,
      allClientNamesRes,
      suppliesByStatusRes,
      invoicesCountRes,
      prescoringsCountRes,
      pendingPrescoringsRes,
      openIncidentsRes,
      pendingTasksRes,
      activeSubsRes,
      recentSuppliesRes,
      comercializadorasRes,
    ] = await Promise.all([
      // Users
      supabase.from('users_profile').select('id, full_name, role, email').eq('active', true),

      // Client total
      supabase.from('clients').select('id', { count: 'exact', head: true }),

      // Recent clients (last 20)
      supabase.from('clients').select('id, name, type, created_at').order('created_at', { ascending: false }).limit(20),

      // All client names for fuzzy matching
      supabase.from('clients').select('name').order('name'),

      // All supplies with status for pipeline counts
      supabase.from('supplies').select('status'),

      // Invoice count
      supabase.from('invoices').select('id', { count: 'exact', head: true }),

      // Prescoring count
      supabase.from('prescorings').select('id', { count: 'exact', head: true }),

      // Pending prescorings
      supabase.from('prescorings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),

      // Open incidents
      supabase.from('incidents').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),

      // Pending tasks
      supabase.from('tasks').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),

      // Active subscriptions
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),

      // Recent supplies with client names
      supabase.from('supplies')
        .select('cups, status, type, client:clients(name)')
        .order('updated_at', { ascending: false })
        .limit(15),

      // Comercializadoras
      supabase.from('comercializadoras').select('name').eq('active', true).order('name'),
    ])

    // Build supply counts by status
    const statusCounts: Record<string, number> = {}
    if (suppliesByStatusRes.data) {
      for (const s of suppliesByStatusRes.data) {
        statusCounts[s.status] = (statusCounts[s.status] || 0) + 1
      }
    }

    const context: CRMContext = {
      timestamp: new Date().toISOString(),

      users: (usersRes.data || []).map(u => ({
        id: u.id,
        full_name: u.full_name,
        role: u.role,
        email: u.email,
      })),

      total_clients: clientsCountRes.count || 0,
      recent_clients: (recentClientsRes.data || []).map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        created_at: c.created_at,
      })),
      client_names: (allClientNamesRes.data || []).map(c => c.name),

      supply_counts_by_status: statusCounts,
      total_supplies: suppliesByStatusRes.data?.length || 0,

      total_invoices: invoicesCountRes.count || 0,
      total_prescorings: prescoringsCountRes.count || 0,
      pending_prescorings: pendingPrescoringsRes.count || 0,
      open_incidents: openIncidentsRes.count || 0,
      pending_tasks: pendingTasksRes.count || 0,
      active_subscriptions: activeSubsRes.count || 0,

      recent_supplies: (recentSuppliesRes.data || []).map(s => ({
        client_name: (s.client as any)?.name || 'Sin cliente',
        cups: s.cups || '',
        status: s.status,
        type: s.type,
      })),

      comercializadoras: (comercializadorasRes.data || []).map(c => c.name),
    }

    return NextResponse.json(context)
  } catch (error) {
    console.error('CRM context error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
