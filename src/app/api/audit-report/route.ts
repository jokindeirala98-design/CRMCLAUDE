import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const { client_id, title, generated_by } = await req.json()

    if (!client_id) {
      return NextResponse.json({ error: 'client_id requerido' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch all consumption snapshots for this client
    const { data: rows, error: rowsError } = await supabase
      .from('consumption_snapshots')
      .select('*')
      .eq('client_id', client_id)
      .order('cups', { ascending: true })

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 })
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'No hay datos de consumo para generar el informe' }, { status: 400 })
    }

    // Mark any existing reports as stale
    await supabase
      .from('audit_reports')
      .update({ status: 'stale', updated_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('status', 'published')

    // Create new report with frozen snapshot
    const { data: report, error: createError } = await supabase
      .from('audit_reports')
      .insert({
        client_id,
        title: title || 'Informe de auditoria energetica',
        status: 'draft',
        rows_snapshot: rows,
        generated_by,
      })
      .select()
      .single()

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, report_id: report.id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { report_id, informe_breve, notas_optimizacion, status } = await req.json()

    if (!report_id) {
      return NextResponse.json({ error: 'report_id requerido' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (informe_breve !== undefined) updates.informe_breve = informe_breve
    if (notas_optimizacion !== undefined) updates.notas_optimizacion = notas_optimizacion
    if (status !== undefined) updates.status = status

    const { error } = await supabase
      .from('audit_reports')
      .update(updates)
      .eq('id', report_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
