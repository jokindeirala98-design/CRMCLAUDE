import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * GET /api/export-data?entity=clients&format=csv
 *
 * Exports CRM data as CSV. Supports: clients, supplies, invoices, tasks, incidents, appointments, subscriptions.
 * Returns CSV text that the frontend converts to a downloadable file.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const entity = searchParams.get('entity') || 'clients'
  const format = searchParams.get('format') || 'csv'
  const status = searchParams.get('status') || null
  const commercial_id = searchParams.get('commercial_id') || null

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    let data: any[] = []
    let columns: string[] = []

    switch (entity) {
      case 'clients': {
        let q = supabase.from('clients').select('id, name, type, cif_nif, email, phone, fiscal_address, origin, created_at, commercial:users_profile!commercial_id(full_name)')
        if (commercial_id) q = q.eq('commercial_id', commercial_id)
        const { data: rows } = await q.order('created_at', { ascending: false }).limit(5000)
        columns = ['Nombre', 'Tipo', 'CIF/NIF', 'Email', 'Teléfono', 'Dirección Fiscal', 'Origen', 'Comercial', 'Fecha Alta']
        data = (rows || []).map((r: any) => [
          r.name, r.type, r.cif_nif || '', r.email || '', r.phone || '',
          r.fiscal_address || '', r.origin || '', r.commercial?.full_name || '',
          r.created_at ? new Date(r.created_at).toLocaleDateString('es-ES') : '',
        ])
        break
      }
      case 'supplies': {
        let q = supabase.from('supplies').select('id, cups, type, tariff, status, address, created_at, client:clients(name), comercializadora:comercializadoras(name)')
        if (status) q = q.eq('status', status)
        const { data: rows } = await q.order('created_at', { ascending: false }).limit(5000)
        columns = ['Cliente', 'CUPS', 'Tipo', 'Tarifa', 'Estado', 'Direccion', 'Comercializadora', 'Fecha Alta']
        data = (rows || []).map((r: any) => [
          (r.client as any)?.name || '', r.cups || '', r.type, r.tariff || '',
          r.status?.replace(/_/g, ' ') || '', r.address || '',
          (r.comercializadora as any)?.name || '',
          r.created_at ? new Date(r.created_at).toLocaleDateString('es-ES') : '',
        ])
        break
      }
      case 'tasks': {
        const { data: rows } = await supabase.from('tasks').select('id, title, description, priority, status, created_at, assigned:users_profile!assigned_to(full_name), client:clients(name)').order('created_at', { ascending: false }).limit(5000)
        columns = ['Titulo', 'Descripcion', 'Prioridad', 'Estado', 'Asignado a', 'Cliente', 'Fecha']
        data = (rows || []).map((r: any) => [
          r.title, r.description || '', r.priority, r.status,
          (r.assigned as any)?.full_name || '', (r.client as any)?.name || '',
          r.created_at ? new Date(r.created_at).toLocaleDateString('es-ES') : '',
        ])
        break
      }
      case 'incidents': {
        const { data: rows } = await supabase.from('incidents').select('id, title, description, priority, status, created_at, client:clients(name)').order('created_at', { ascending: false }).limit(5000)
        columns = ['Titulo', 'Descripcion', 'Prioridad', 'Estado', 'Cliente', 'Fecha']
        data = (rows || []).map((r: any) => [
          r.title, r.description || '', r.priority, r.status,
          (r.client as any)?.name || '',
          r.created_at ? new Date(r.created_at).toLocaleDateString('es-ES') : '',
        ])
        break
      }
      case 'appointments': {
        const { data: rows } = await supabase.from('appointments').select('id, type, status, scheduled_at, notes, client:clients(name), commercial:users_profile!commercial_id(full_name)').order('scheduled_at', { ascending: false }).limit(5000)
        columns = ['Tipo', 'Estado', 'Fecha', 'Cliente', 'Comercial', 'Notas']
        data = (rows || []).map((r: any) => [
          r.type, r.status,
          r.scheduled_at ? new Date(r.scheduled_at).toLocaleDateString('es-ES') : '',
          (r.client as any)?.name || '', (r.commercial as any)?.full_name || '',
          r.notes || '',
        ])
        break
      }
      default: {
        return NextResponse.json({ error: `Entidad "${entity}" no soportada` }, { status: 400 })
      }
    }

    // Build CSV
    const escapeCsv = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    }

    const csvLines = [
      columns.map(escapeCsv).join(','),
      ...data.map(row => row.map((v: string) => escapeCsv(v || '')).join(',')),
    ]
    const csvContent = csvLines.join('\n')

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${entity}_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
