/**
 * DELETE /api/supplies/[id]/economic-study/delete
 *
 * Elimina el estudio económico asociado a un supply:
 *   1. Borra el archivo de Supabase Storage (si existe).
 *   2. Limpia los campos economic_study_* en supplies.
 *   3. Re-crea la admin_task de "estudio_economico_pendiente" si el supply
 *      tiene facturas (que es el único caso en que tendría sentido).
 *
 * Solo admins.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users_profile').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
    }

    const supplyId = params.id
    if (!supplyId) return NextResponse.json({ error: 'supplyId required' }, { status: 400 })

    const { data: supply } = await supabase
      .from('supplies')
      .select('id, client_id, economic_study_url, invoices:invoices(id)')
      .eq('id', supplyId)
      .single()
    if (!supply) return NextResponse.json({ error: 'Supply not found' }, { status: 404 })

    // Borrar archivo del storage si existe
    if (supply.economic_study_url) {
      const idx = supply.economic_study_url.indexOf('/estudios-economicos/')
      if (idx !== -1) {
        const path = supply.economic_study_url.substring(idx + '/estudios-economicos/'.length)
        await supabase.storage.from('estudios-economicos').remove([path])
      }
    }

    // Limpiar campos en supply
    await supabase.from('supplies').update({
      economic_study_url: null,
      economic_study_filename: null,
      economic_study_uploaded_at: null,
      economic_study_uploaded_by: null,
      updated_at: new Date().toISOString(),
    }).eq('id', supplyId)

    // Si tiene facturas, re-crear tarea pendiente (si no existe ya)
    const hasInvoices = Array.isArray(supply.invoices) && supply.invoices.length > 0
    if (hasInvoices) {
      const { data: existing } = await supabase
        .from('admin_tasks')
        .select('id')
        .eq('supply_id', supplyId)
        .eq('type', 'estudio_economico_pendiente')
        .eq('status', 'pending')
        .maybeSingle()
      if (!existing) {
        await supabase.from('admin_tasks').insert({
          type: 'estudio_economico_pendiente',
          supply_id: supplyId,
          client_id: supply.client_id,
          status: 'pending',
        })
      }
    }

    return NextResponse.json({ ok: true, taskReopened: hasInvoices })
  } catch (e: any) {
    console.error('[DELETE /api/supplies/[id]/economic-study/delete]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
