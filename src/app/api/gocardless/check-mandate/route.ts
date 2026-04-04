import { NextRequest, NextResponse } from 'next/server'
import { createClient as supabaseCreateClient } from '@supabase/supabase-js'

/**
 * POST /api/gocardless/check-mandate
 *
 * Checks if a Billing Request has been fulfilled (mandate authorised).
 * If fulfilled, extracts the mandate ID and customer ID, updates the subscription,
 * and returns the mandate info so the frontend can proceed to create payments.
 */

function getGCBaseUrl(): string {
  const env = process.env.GOCARDLESS_ENVIRONMENT || 'sandbox'
  return env === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com'
}

async function gcGet(path: string) {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN
  if (!token) throw new Error('GOCARDLESS_ACCESS_TOKEN not configured')

  const res = await fetch(`${getGCBaseUrl()}${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'GoCardless-Version': '2015-07-06',
    },
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`GoCardless API error: ${res.status} — ${errText}`)
  }

  return res.json()
}

export async function POST(request: NextRequest) {
  try {
    const { subscriptionId, billingRequestId } = await request.json()

    if (!billingRequestId) {
      return NextResponse.json(
        { error: 'billingRequestId es obligatorio' },
        { status: 400 }
      )
    }

    // Check the billing request status
    const brRes = await gcGet(`/billing_requests/${billingRequestId}`)
    const br = brRes.billing_requests
    const status = br.status // pending, ready_to_fulfil, fulfilling, fulfilled, cancelled

    if (status === 'fulfilled') {
      // Mandate was created — extract IDs
      const mandateId = br.links?.mandate_request_mandate || br.mandate_request?.links?.mandate || null
      const customerId = br.links?.customer || null

      if (mandateId && subscriptionId) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        const supabase = supabaseCreateClient(supabaseUrl, supabaseKey)

        await supabase
          .from('subscriptions')
          .update({
            gocardless_mandate_id: mandateId,
            gocardless_customer_id: customerId,
            status: 'active',
          })
          .eq('id', subscriptionId)

        await supabase.from('activity_log').insert({
          entity_type: 'subscription',
          entity_id: subscriptionId,
          action: 'mandate_authorised',
          description: `Mandato SEPA autorizado. Mandate ID: ${mandateId}. Customer: ${customerId}`,
          performed_by: 'system',
        })
      }

      return NextResponse.json({
        status: 'fulfilled',
        mandateId,
        customerId,
      })
    }

    if (status === 'cancelled') {
      return NextResponse.json({
        status: 'cancelled',
        message: 'La solicitud de mandato fue cancelada.',
      })
    }

    // Still pending
    return NextResponse.json({
      status,
      message: 'El mandato aun no ha sido autorizado. El cliente debe completar la autorizacion en el enlace proporcionado.',
    })
  } catch (err: any) {
    console.error('[GoCardless] Check mandate error:', err)
    return NextResponse.json(
      { error: err.message || 'Error verificando mandato' },
      { status: 500 }
    )
  }
}
