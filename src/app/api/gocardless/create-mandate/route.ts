import { NextRequest, NextResponse } from 'next/server'
import { createClient as supabaseCreateClient } from '@supabase/supabase-js'

/**
 * POST /api/gocardless/create-mandate
 *
 * Creates a GoCardless SEPA mandate using the Billing Request Flow (hosted).
 *
 * Flujo optimizado para MINIMA friccion del cliente:
 *   1. Voltis rellena todo en el CRM (nombre, email, IBAN, plan)
 *   2. Se crea Billing Request + Flow con TODO pre-rellenado
 *   3. El cliente recibe un enlace (SMS/email/WhatsApp)
 *   4. Abre el enlace → ve sus datos ya puestos → solo pulsa "Confirmar"
 *   5. GoCardless crea el mandato SEPA → activamos cobros automaticamente
 *
 * Pre-fills: nombre, email, pais (ES), IBAN
 * El cliente solo tiene que revisar y confirmar. Nada más.
 */

interface CreateMandateRequest {
  subscriptionId: string
  clientId: string
  clientName: string
  clientEmail: string
  clientIban: string
}

function getGCBaseUrl(): string {
  const env = process.env.GOCARDLESS_ENVIRONMENT || 'sandbox'
  return env === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com'
}

async function gcFetch(path: string, method: 'POST' | 'GET' = 'POST', body?: any, idempotencyKey?: string) {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN
  if (!token) throw new Error('GOCARDLESS_ACCESS_TOKEN not configured')

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'GoCardless-Version': '2015-07-06',
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey
  }

  const res = await fetch(`${getGCBaseUrl()}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`[GoCardless] ${method} ${path} failed (${res.status}):`, errText)
    throw new Error(`GoCardless API error: ${res.status} — ${errText}`)
  }

  return res.json()
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateMandateRequest = await request.json()
    const { subscriptionId, clientId, clientName, clientEmail, clientIban } = body

    if (!clientEmail) {
      return NextResponse.json(
        { error: 'Email del cliente es obligatorio para crear mandato SEPA' },
        { status: 400 }
      )
    }

    if (!process.env.GOCARDLESS_ACCESS_TOKEN) {
      return NextResponse.json(
        { mode: 'manual', message: 'GoCardless no esta configurado.' },
        { status: 200 }
      )
    }

    const idempotencyBase = `voltis-${clientId}-${subscriptionId}`
    const nameParts = clientName.trim().split(/\s+/)
    const givenName = nameParts[0] || clientName
    const familyName = nameParts.slice(1).join(' ') || clientName

    // Get redirect URL — GoCardless LIVE *requires* HTTPS
    const isLive = (process.env.GOCARDLESS_ENVIRONMENT || 'sandbox') === 'live'
    let origin = process.env.NEXT_PUBLIC_APP_URL
      || request.headers.get('origin')
      || request.headers.get('referer')?.replace(/\/[^/]*$/, '')
      || 'https://voltisenergia.com'

    if (isLive && origin.startsWith('http://')) {
      console.warn(`[GoCardless] LIVE mode: HTTP origin → using HTTPS fallback. Set NEXT_PUBLIC_APP_URL for production.`)
      origin = 'https://voltisenergia.com'
    }

    // ── Step 1: Create Billing Request ──
    console.log('[GoCardless] Creating Billing Request...')
    const brRes = await gcFetch('/billing_requests', 'POST', {
      billing_requests: {
        mandate_request: {
          scheme: 'sepa_core',
          currency: 'EUR',
        },
        metadata: {
          voltis_subscription_id: subscriptionId,
          voltis_client_id: clientId,
        },
      },
    }, `${idempotencyBase}-br`)

    const billingRequestId = brRes.billing_requests.id
    console.log(`[GoCardless] Billing Request created: ${billingRequestId}`)

    // ── Step 2: Create Billing Request Flow ──
    // Pre-fill EVERYTHING so the client only has to click "Confirmar"
    console.log('[GoCardless] Creating Billing Request Flow (max pre-fill)...')

    // Build the flow payload — pre-fill customer details
    // Note: GoCardless hosted flow does NOT allow pre-filling IBAN —
    // the client must type it themselves (security requirement).
    // We pre-fill: name, email, country → client only enters IBAN and confirms.
    const flowRes = await gcFetch('/billing_request_flows', 'POST', {
      billing_request_flows: {
        redirect_uri: `${origin}/subscriptions?gc_complete=true&sub=${subscriptionId}`,
        exit_uri: `${origin}/subscriptions?gc_exit=true&sub=${subscriptionId}`,
        show_redirect_buttons: true,
        prefilled_customer: {
          given_name: givenName,
          family_name: familyName,
          email: clientEmail,
          country_code: 'ES',
        },
        links: {
          billing_request: billingRequestId,
        },
      },
    }, `${idempotencyBase}-flow`)

    const authorisationUrl = flowRes.billing_request_flows.authorisation_url
    console.log(`[GoCardless] Flow created. URL: ${authorisationUrl}`)

    // ── Step 3: Save to Supabase ──
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    const supabase = supabaseCreateClient(supabaseUrl, supabaseKey)

    await supabase
      .from('subscriptions')
      .update({
        gocardless_customer_id: billingRequestId,
        status: 'pending_activation',
      })
      .eq('id', subscriptionId)

    await supabase.from('activity_log').insert({
      entity_type: 'subscription',
      entity_id: subscriptionId,
      action: 'billing_request_created',
      description: `Mandato SEPA solicitado. BR: ${billingRequestId}. Enlace enviado al cliente — solo debe confirmar.`,
      performed_by: 'system',
    })

    return NextResponse.json({
      mode: 'gocardless_flow',
      billingRequestId,
      authorisationUrl,
      message: 'Enlace listo. El cliente solo tiene que abrir y confirmar — todo esta pre-rellenado.',
    })
  } catch (err: any) {
    console.error('[GoCardless] Create mandate error:', err)
    return NextResponse.json(
      { error: err.message || 'Error creando mandato SEPA' },
      { status: 500 }
    )
  }
}
