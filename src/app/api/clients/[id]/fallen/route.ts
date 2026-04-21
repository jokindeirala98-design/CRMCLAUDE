/**
 * POST /api/clients/[id]/fallen
 * Body: { fallen: boolean, reason?: string }
 *
 * Marks (or unmarks) a client as "caído" (fallen):
 *  - Updates is_fallen, fallen_at, fallen_reason in Supabase
 *  - Updates the Estado column in VOLTIS CONTRATACIONES for all rows matching this client
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { markClientFallen } from '@/lib/google-sheets'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { fallen, reason } = await req.json()
    const clientId = params.id

    if (typeof fallen !== 'boolean') {
      return NextResponse.json({ error: 'fallen must be a boolean' }, { status: 400 })
    }

    const supabase = createServerSupabaseClient()

    // Auth check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get client with their CUPS values for sheet update
    const { data: clientData, error: clientErr } = await supabase
      .from('clients')
      .select('id, name, supplies(cups)')
      .eq('id', clientId)
      .single()

    if (clientErr || !clientData) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Update Supabase
    const updateData: Record<string, any> = {
      is_fallen: fallen,
      fallen_reason: fallen ? (reason || null) : null,
      fallen_at: fallen ? new Date().toISOString() : null,
    }

    const { error: updateErr } = await supabase
      .from('clients')
      .update(updateData)
      .eq('id', clientId)

    if (updateErr) throw updateErr

    // Update Google Sheets — mark all CUPS for this client as CAÍDO / PENDIENTE
    const cupsList: string[] = (clientData.supplies || [])
      .map((s: any) => s.cups)
      .filter(Boolean)

    const sheetErrors: string[] = []
    for (const cups of cupsList) {
      try {
        await markClientFallen(cups, fallen)
      } catch (e: any) {
        sheetErrors.push(`CUPS ${cups}: ${e.message}`)
      }
    }

    return NextResponse.json({
      ok: true,
      fallen,
      sheetErrors: sheetErrors.length ? sheetErrors : undefined,
    })
  } catch (err: any) {
    console.error('[clients/fallen]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
