import { NextRequest, NextResponse } from 'next/server'
import { createClient as supabaseCreateClient } from '@supabase/supabase-js'

/**
 * POST /api/gocardless/create-mandate
 *
 * Creates a GoCardless SEPA mandate using the Billing Request Flow (hosted).
 *
 * Flujo con MINIMA friccion — el cliente solo confirma:
 *   1. Voltis crea la suscripcion en el CRM con IBAN del cliente
 *   2. Se llama a la API de GoCardless para pre-rellenar IBAN + datos del cliente
 *      directamente (sin que el cliente tenga que escribir nada)
 *   3. Se crea el Billing Request Flow → solo muestra pantalla de confirmacion
 *   4. El cliente recibe el enlace, abre y ve TODO ya rellenado → pulsa "Confirmar"
 *   5. GoCardless activa el mandato SEPA → webhook dispara el cobro automaticamente
 *
 * Pre-fills via API: nombre, email, IBAN completo
 * El cliente SOLO hace clic en "Confirmar". Nada más.
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

    // ── Step 2: Collect Bank Account via API (pre-fill IBAN server-side) ──
    // This uses the partner flow to skip the IBAN entry step entirely.
    // The hosted form will then only ask for confirmation, not for bank details.
    if (clientIban) {
      const cleanIban = clientIban.replace(/\s+/g, '').toUpperCase()
      try {
        console.log('[GoCardless] Pre-filling bank account (IBAN)...')
        await gcFetch(`/billing_requests/${billingRequestId}/actions/collect_bank_account`, 'POST', {
          data: {
            country_code: 'ES',
            iban: cleanIban,
            account_holder_name: clientName,
          },
        }, `${idempotencyBase}-bank`)
        console.log('[GoCardless] Bank account pre-filled OK.')
      } catch (ibanErr: any) {
        // If pre-filling fails (e.g. invalid IBAN format) we continue to the hosted
        // flow and let the client enter it manually. Non-fatal.
        console.warn('[GoCardless] Could not pre-fill IBAN (client will enter manually):', ibanErr?.message)
      }
    }

    // ── Step 3: Collect Customer Details via API (pre-fill name, email) ──
    try {
      console.log('[GoCardless] Pre-filling customer details...')
      await gcFetch(`/billing_requests/${billingRequestId}/actions/collect_customer_details`, 'POST', {
        data: {
          given_name: givenName,
          family_name: familyName,
          email: clientEmail,
        },
      }, `${idempotencyBase}-customer`)
      console.log('[GoCardless] Customer details pre-filled OK.')
    } catch (custErr: any) {
      console.warn('[GoCardless] Could not pre-fill customer details:', custErr?.message)
    }

    // ── Step 4: Create Billing Request Flow (Hosted confirmation page) ──
    // At this point IBAN and customer data are already filled via the API above.
    // The client only sees a confirmation screen — one click to authorize.
    console.log('[GoCardless] Creating Billing Request Flow (confirmation only)...')
    const flowRes = await gcFetch('/billing_request_flows', 'POST', {
      billing_request_flows: {
        redirect_uri: `${origin}/subscriptions?gc_complete=true&sub=${subscriptionId}`,
        exit_uri: `${origin}/subscriptions?gc_exit=true&sub=${subscriptionId}`,
        show_redirect_buttons: true,
        // Fallback pre-fill in case the API steps above were skipped
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
