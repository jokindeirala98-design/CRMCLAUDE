import { NextRequest, NextResponse } from 'next/server'
import { createClient as supabaseCreateClient } from '@supabase/supabase-js'

/**
 * POST /api/docusign/webhook
 *
 * Receives DocuSign Connect webhook events.
 * When a contract is signed (status: completed):
 *   1. Updates contract status to 'signed'
 *   2. Updates supply status to 'firmado'
 *   3. Triggers GoCardless mandate creation for SEPA direct debit
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY - For server-side DB access
 *   GOCARDLESS_ACCESS_TOKEN  - For creating mandate (optional)
 */

// Use service role key for server-side operations
function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  return supabaseCreateClient(url, key)
}

export async function POST(request: NextRequest) {
  try {
    // DocuSign sends XML by default, but we configured JSON
    const contentType = request.headers.get('content-type') || ''
    let envelopeId: string
    let status: string

    if (contentType.includes('application/json')) {
      const body = await request.json()
      envelopeId = body.envelopeId || body.data?.envelopeId
      status = body.status || body.data?.envelopeSummary?.status
    } else {
      // Parse XML body (simplified — DocuSign Connect uses XML)
      const text = await request.text()
      // Extract envelope ID and status from XML
      const envMatch = text.match(/<EnvelopeID>(.*?)<\/EnvelopeID>/i)
      const statusMatch = text.match(/<Status>(.*?)<\/Status>/i)
      envelopeId = envMatch?.[1] || ''
      status = statusMatch?.[1] || ''
    }

    if (!envelopeId) {
      return NextResponse.json({ error: 'Missing envelopeId' }, { status: 400 })
    }

    console.log(`[DocuSign Webhook] Envelope ${envelopeId} — Status: ${status}`)

    const supabase = getServerClient()

    // Find the contract by envelope ID
    const { data: contract } = await supabase
      .from('contracts')
      .select('*, client:clients(id, name, email, iban), supply:supplies(id, status)')
      .eq('docusign_envelope_id', envelopeId)
      .single()

    if (!contract) {
      console.error(`[DocuSign Webhook] Contract not found for envelope: ${envelopeId}`)
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const normalizedStatus = status?.toLowerCase()

    if (normalizedStatus === 'completed' || normalizedStatus === 'signed') {
      // ═══ CONTRACT SIGNED ═══

      // 1. Update contract status
      await supabase
        .from('contracts')
        .update({
          status: 'signed',
          signed_at: new Date().toISOString(),
        })
        .eq('id', contract.id)

      // 2. Update supply status to 'firmado'
      if (contract.supply?.id) {
        await supabase
          .from('supplies')
          .update({
            status: 'firmado',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contract.supply.id)
      }

      // 3. Find pending subscription for this client
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('client_id', contract.client_id)
        .eq('status', 'pending_activation')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      // 4. Trigger GoCardless mandate creation
      if (subscription && contract.client?.iban) {
        try {
          const gcResponse = await fetch(
            `${process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm.vercel.app'}/api/gocardless/create-mandate`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subscriptionId: subscription.id,
                clientId: contract.client_id,
                clientName: contract.client?.name,
                clientEmail: contract.client?.email,
                clientIban: contract.client?.iban,
              }),
            }
          )

          const gcData = await gcResponse.json()
          if (gcData.mandateId) {
            // Update subscription with mandate
            await supabase
              .from('subscriptions')
              .update({
                gocardless_mandate_id: gcData.mandateId,
                status: 'active',
              })
              .eq('id', subscription.id)

            // Update supply to 'suscrito'
            if (contract.supply?.id) {
              await supabase
                .from('supplies')
                .update({
                  status: 'suscrito',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', contract.supply.id)
            }
          }
        } catch (gcErr) {
          console.error('[DocuSign Webhook] GoCardless trigger failed:', gcErr)
          // Don't fail the webhook — contract is still signed
        }
      } else if (subscription) {
        // No IBAN — activate subscription without mandate, mark for manual SEPA setup
        await supabase
          .from('subscriptions')
          .update({ status: 'active' })
          .eq('id', subscription.id)
      }

      // 5. Log activity
      await supabase.from('activity_log').insert({
        entity_type: 'contract',
        entity_id: contract.id,
        action: 'signed',
        description: `Contrato firmado digitalmente via DocuSign. Envelope: ${envelopeId}`,
        performed_by: 'system',
      })

      console.log(`[DocuSign Webhook] Contract ${contract.id} signed successfully`)

    } else if (normalizedStatus === 'declined' || normalizedStatus === 'voided') {
      // ═══ CONTRACT REJECTED/VOIDED ═══
      await supabase
        .from('contracts')
        .update({ status: 'rejected' })
        .eq('id', contract.id)

      await supabase.from('activity_log').insert({
        entity_type: 'contract',
        entity_id: contract.id,
        action: 'rejected',
        description: `Contrato ${normalizedStatus} via DocuSign. Envelope: ${envelopeId}`,
        performed_by: 'system',
      })
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('[DocuSign Webhook] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
