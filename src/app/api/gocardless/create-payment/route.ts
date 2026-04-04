import { NextRequest, NextResponse } from 'next/server'
import { createClient as supabaseCreateClient } from '@supabase/supabase-js'

/**
 * POST /api/gocardless/create-payment
 *
 * Creates GoCardless payments against an existing mandate.
 * Supports:
 *   - Single payment (pago unico)
 *   - Subscription (recurring quarterly payments via GoCardless subscriptions)
 *
 * Uses sequential invoice numbering: VOLT-YYYY-NNNNN
 * Includes duplicate payment prevention via idempotency keys.
 */

interface CreatePaymentRequest {
  mandateId: string
  subscriptionId: string
  clientId: string | null
  // Amount in cents (EUR) - total including VAT
  amountCents: number
  description: string
  // 'single' = one-time payment, 'quarterly' = recurring every 3 months
  mode: 'single' | 'quarterly'
  // For quarterly: number of payments (e.g., 4)
  installments?: number
}

function getGCBaseUrl(): string {
  const env = process.env.GOCARDLESS_ENVIRONMENT || 'sandbox'
  return env === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com'
}

async function gcFetch(path: string, method: 'POST' | 'GET', body?: any, idempotencyKey?: string) {
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
    console.error(`[GoCardless] ${path} failed:`, errText)
    throw new Error(`GoCardless API error: ${res.status} — ${errText}`)
  }

  return res.json()
}

/**
 * Generate sequential invoice number: VOLT-YYYY-NNNNN
 * Queries the billing table to find the highest existing number for the current year.
 */
async function generateNextInvoiceNumber(supabase: any): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `VOLT-${year}-`

  // Get the last invoice number for this year
  const { data } = await supabase
    .from('billing')
    .select('invoice_number')
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)

  let nextSeq = 1
  if (data && data.length > 0) {
    const lastNumber = data[0].invoice_number as string
    const lastSeq = parseInt(lastNumber.replace(prefix, ''), 10)
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1
    }
  }

  return `${prefix}${String(nextSeq).padStart(5, '0')}`
}

export async function POST(request: NextRequest) {
  try {
    const body: CreatePaymentRequest = await request.json()
    const { mandateId, subscriptionId, clientId, amountCents, description, mode, installments } = body

    if (!mandateId || !amountCents) {
      return NextResponse.json(
        { error: 'mandateId y amountCents son obligatorios' },
        { status: 400 }
      )
    }

    if (!process.env.GOCARDLESS_ACCESS_TOKEN) {
      return NextResponse.json(
        { mode: 'manual', message: 'GoCardless no configurado' },
        { status: 200 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    const supabase = supabaseCreateClient(supabaseUrl, supabaseKey)

    // ── Duplicate prevention: check if payment already exists for this subscription ──
    const { data: existingPayment } = await supabase
      .from('billing')
      .select('id, gocardless_payment_id')
      .eq('subscription_id', subscriptionId)
      .in('status', ['sent', 'paid'])
      .limit(1)

    if (mode === 'single' && existingPayment && existingPayment.length > 0) {
      console.warn(`[GoCardless] Duplicate payment prevented for subscription ${subscriptionId}`)
      return NextResponse.json({
        mode: 'gocardless',
        type: 'single',
        paymentId: existingPayment[0].gocardless_payment_id,
        amountCents,
        duplicate: true,
        message: 'Ya existe un pago para esta suscripcion',
      })
    }

    // Use subscription ID + mode as idempotency base to prevent GC duplicates
    const idempotencyBase = `voltis-pay-${subscriptionId}-${mode}-${amountCents}`

    if (mode === 'single') {
      // Create a single one-off payment
      const paymentRes = await gcFetch('/payments', 'POST', {
        payments: {
          amount: amountCents,
          currency: 'EUR',
          description,
          metadata: {
            voltis_subscription_id: subscriptionId,
            voltis_client_id: clientId || 'external',
            type: 'single',
          },
          links: {
            mandate: mandateId,
          },
        },
      }, `${idempotencyBase}-single`)

      const paymentId = paymentRes.payments.id
      console.log(`[GoCardless] Single payment created: ${paymentId} (${amountCents} cents)`)

      // Create billing record with sequential invoice number
      const baseAmount = Math.round(amountCents / 1.21) / 100
      const totalAmount = amountCents / 100
      const vatAmount = totalAmount - baseAmount
      const invoiceNumber = await generateNextInvoiceNumber(supabase)

      await supabase.from('billing').insert({
        client_id: clientId || null,
        subscription_id: subscriptionId,
        invoice_number: invoiceNumber,
        concept: description,
        base_amount: Math.round(baseAmount * 100) / 100,
        vat_rate: 21,
        vat_amount: Math.round(vatAmount * 100) / 100,
        total_amount: Math.round(totalAmount * 100) / 100,
        status: 'sent',
        gocardless_payment_id: paymentId,
        due_date: new Date().toISOString().split('T')[0],
      })

      // Log
      await supabase.from('activity_log').insert({
        entity_type: 'subscription',
        entity_id: subscriptionId,
        action: 'payment_created',
        description: `Pago unico de ${(amountCents / 100).toFixed(2)} EUR creado. Factura: ${invoiceNumber}. Payment ID: ${paymentId}`,
        performed_by: 'system',
      })

      return NextResponse.json({
        mode: 'gocardless',
        type: 'single',
        paymentId,
        invoiceNumber,
        amountCents,
      })
    } else {
      // ── Duplicate prevention for quarterly subscriptions ──
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('gocardless_subscription_id')
        .eq('id', subscriptionId)
        .single()

      if (existingSub?.gocardless_subscription_id) {
        console.warn(`[GoCardless] Subscription ${subscriptionId} already has GC subscription: ${existingSub.gocardless_subscription_id}`)
        return NextResponse.json({
          mode: 'gocardless',
          type: 'quarterly',
          gcSubscriptionId: existingSub.gocardless_subscription_id,
          perPaymentCents: amountCents,
          duplicate: true,
          message: 'Ya existe una suscripcion GoCardless para este plan',
        })
      }

      // Create a GoCardless subscription (recurring quarterly)
      const perPaymentCents = amountCents

      const gcSubRes = await gcFetch('/subscriptions', 'POST', {
        subscriptions: {
          amount: perPaymentCents,
          currency: 'EUR',
          name: description,
          interval_unit: 'monthly',
          interval: 3, // every 3 months = quarterly
          count: installments || 4,
          metadata: {
            voltis_subscription_id: subscriptionId,
            voltis_client_id: clientId || 'external',
            type: 'quarterly',
          },
          links: {
            mandate: mandateId,
          },
        },
      }, `${idempotencyBase}-quarterly`)

      const gcSubscriptionId = gcSubRes.subscriptions.id
      console.log(`[GoCardless] Subscription created: ${gcSubscriptionId} (${perPaymentCents} cents x${installments || 4})`)

      // Update our subscription with GC subscription reference
      const nextBilling = new Date()
      nextBilling.setMonth(nextBilling.getMonth() + 3)

      await supabase
        .from('subscriptions')
        .update({
          gocardless_subscription_id: gcSubscriptionId,
          next_billing_date: nextBilling.toISOString().split('T')[0],
        })
        .eq('id', subscriptionId)

      // Log
      await supabase.from('activity_log').insert({
        entity_type: 'subscription',
        entity_id: subscriptionId,
        action: 'subscription_created',
        description: `Suscripcion trimestral creada en GoCardless: ${(perPaymentCents / 100).toFixed(2)} EUR x ${installments || 4} pagos. GC Sub ID: ${gcSubscriptionId}`,
        performed_by: 'system',
      })

      return NextResponse.json({
        mode: 'gocardless',
        type: 'quarterly',
        gcSubscriptionId,
        perPaymentCents,
        installments: installments || 4,
      })
    }
  } catch (err: any) {
    console.error('[GoCardless] Create payment error:', err)
    return NextResponse.json(
      { error: err.message || 'Error creando pago en GoCardless' },
      { status: 500 }
    )
  }
}
