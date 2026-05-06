import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { analyzeInvoice } from '@/lib/gemini'

/**
 * POST /api/admin/reextract-client
 *
 * Re-runs Gemini extraction on ALL invoices for a given client.
 * Useful after updating the INVOICE_PROMPT to fix historical data.
 *
 * Body: { clientName?: string, clientId?: string }
 * Admin-only.
 */
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check — admin only
    const supabaseUser = createServerSupabaseClient()
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabaseUser
      .from('users_profile')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo los administradores pueden usar esta función' }, { status: 403 })
    }

    const { clientName, clientId } = await req.json()
    if (!clientName && !clientId) {
      return NextResponse.json({ error: 'Se requiere clientName o clientId' }, { status: 400 })
    }

    // 2. Use service role for full access
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // 3. Find client
    let resolvedClientId: string | null = clientId || null

    if (!resolvedClientId && clientName) {
      const { data: clients } = await adminSupabase
        .from('clients')
        .select('id, name')
        .ilike('name', `%${clientName}%`)
        .limit(5)

      if (!clients?.length) {
        return NextResponse.json({ error: `No se encontró cliente con nombre "${clientName}"` }, { status: 404 })
      }
      if (clients.length > 1) {
        return NextResponse.json({
          error: `Varios clientes coinciden: ${clients.map(c => `${c.name} (${c.id})`).join(', ')}. Usa clientId.`,
          clients,
        }, { status: 409 })
      }
      resolvedClientId = clients[0].id
    }

    // 4. Get all invoices for this client (via supplies)
    const { data: invoices, error: invErr } = await adminSupabase
      .from('invoices')
      .select('id, file_url, file_type, extracted_data, supply_id, supplies!inner(client_id)')
      .eq('supplies.client_id', resolvedClientId)
      .not('file_url', 'is', null)

    if (invErr) {
      return NextResponse.json({ error: invErr.message }, { status: 500 })
    }

    if (!invoices?.length) {
      return NextResponse.json({ message: 'No se encontraron facturas para este cliente', total: 0 })
    }

    // 5. Re-extract each invoice
    const results: Array<{ id: string; status: 'ok' | 'error'; error?: string; cups?: string }> = []

    for (const invoice of invoices) {
      try {
        // Download the PDF/image from storage
        const fileUrl = invoice.file_url as string
        const fileType = invoice.file_type as string

        const fileRes = await fetch(fileUrl)
        if (!fileRes.ok) {
          results.push({ id: invoice.id, status: 'error', error: `HTTP ${fileRes.status} fetching file` })
          continue
        }

        const buffer = Buffer.from(await fileRes.arrayBuffer())
        const base64 = buffer.toString('base64')
        const mimeType = fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'

        // Re-run Gemini extraction with the updated prompt
        const extractedData = await analyzeInvoice(base64, mimeType)

        // Update the invoice with new extracted data
        const { error: updateErr } = await adminSupabase
          .from('invoices')
          .update({
            extracted_data: extractedData,
            extraction_status: 'completed',
          })
          .eq('id', invoice.id)

        if (updateErr) {
          results.push({ id: invoice.id, status: 'error', error: updateErr.message })
        } else {
          results.push({ id: invoice.id, status: 'ok', cups: extractedData?.cups })
        }

        // Small delay between calls to avoid rate limiting
        await new Promise(r => setTimeout(r, 1500))

      } catch (err: any) {
        results.push({ id: invoice.id, status: 'error', error: err.message })
      }
    }

    const ok = results.filter(r => r.status === 'ok').length
    const errors = results.filter(r => r.status === 'error').length

    return NextResponse.json({
      clientId: resolvedClientId,
      total: invoices.length,
      ok,
      errors,
      results,
    })

  } catch (err: any) {
    console.error('[reextract-client]', err)
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}
