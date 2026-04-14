import { NextRequest, NextResponse } from 'next/server'
import { createClient as supabaseCreateClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * POST /api/gocardless/webhook
 *
 * Receives GoCardless webhook events for:
 *   - mandates (active, failed, cancelled)
 *   - payments (confirmed, failed, charged_back)
 *   - subscriptions (created, cancelled, payment_created)
 *
 * Required env vars:
 *   GOCARDLESS_WEBHOOK_SECRET - For signature verification
 *   SUPABASE_SERVICE_ROLE_KEY - For server-side DB access (falls back to anon key)
 */

function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  return supabaseCreateClient(url, key)
}

/**
 * Verify GoCardless webhook signature.
 * GoCardless signs webhooks using HMAC-SHA256 with the webhook secret.
 * The signature is in the `Webhook-Signature` header.
 */
function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false

  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(computedSignature, 'hex')
    )
  } catch {
    // If buffers are different lengths, timingSafeEqual throws
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await request.text()
    const signature = request.headers.get('webhook-signature')
    const webhookSecret = process.env.GOCARDLESS_WEBHOOK_SECRET

    // Verify webhook signature
    if (webhookSecret) {
      if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        console.error('[GoCardless Webhook] Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 498 })
      }
      console.log('[GoCardless Webhook] Signature verified OK')
    } else {
      console.warn('[GoCardless Webhook] GOCARDLESS_WEBHOOK_SECRET not set — skipping signature verification. SET THIS IN PRODUCTION!')
    }

    const body = JSON.parse(rawBody)
    const events = body.events || []
    const supabase = getServerClient()

    for (const event of events) {
      const { resource_type, action, links } = event

      console.log(`[GoCardless Webhook] ${resource_type}.${action}`, links)

      if (resource_type === 'mandates') {
        const mandateId = links?.mandate

        if (!mandateId) continue

        // Find subscription with this mandate
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('*, client:clients(id, name)')
          .eq('gocardless_mandate_id', mandateId)
          .single()

        if (!subscription) {
          console.warn(`[GoCardless Webhook] No subscription found for mandate: ${mandateId}`)
          continue
        }

        switch (action) {
          case 'active': {
            // 1. Mark subscription as active
            await supabase
              .from('subscriptions')
              .update({ status: 'active' })
              .eq('id', subscription.id)

            await supabase.from('activity_log').insert({
              entity_type: 'subscription',
              entity_id: subscription.id,
              action: 'mandate_active',
              description: `Mandato SEPA activo. Listo para cobros. Mandate: ${mandateId}`,
              performed_by: 'system',
            })

            // 2. AUTO-TRIGGER PAYMENT: create the first payment automatically
            // so no manual "solicitar pago" step is needed.
            if (subscription.annual_amount && subscription.annual_amount > 0) {
              try {
                const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://voltisenergia.com'
                const isImmediate = subscription.payment_mode === 'immediate'

                // For immediate: one single payment of the full annual amount.
                // For quarterly: GoCardless creates a recurring subscription (4 payments every 3 months).
                // Amounts include 21% VAT — annual_amount is the base (before VAT).
                const baseAmount = subscription.annual_amount
                const totalWithVat = Math.round(baseAmount * 1.21 * 100) / 100
                const amountCents = isImmediate
                  ? Math.round(totalWithVat * 100)
                  : Math.round((totalWithVat / 4) * 100)

                const clientName = (subscription.client as any)?.name
                  || subscription.external_client_name
                  || 'Cliente'

                const description = isImmediate
                  ? `Servicio Voltis Energía — Gestión anual ${new Date().getFullYear()}`
                  : `Servicio Voltis Energía — Cuota trimestral 1/4`

                console.log(`[GoCardless Webhook] Auto-triggering payment: ${amountCents} cents, mode=${isImmediate ? 'single' : 'quarterly'}`)

                const payRes = await fetch(`${origin}/api/gocardless/create-payment`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    mandateId,
                    subscriptionId: subscription.id,
                    clientId: subscription.client_id || null,
                    amountCents,
                    description,
                    mode: isImmediate ? 'single' : 'quarterly',
                    installments: isImmediate ? undefined : 4,
                  }),
                })

                if (!payRes.ok) {
                  const errText = await payRes.text()
                  console.error('[GoCardless Webhook] Auto-payment failed:', errText)
                  await supabase.from('activity_log').insert({
                    entity_type: 'subscription',
                    entity_id: subscription.id,
                    action: 'auto_payment_error',
                    description: `Error al crear pago automático tras activación del mandato: ${errText}`,
                    performed_by: 'system',
                  })
                } else {
                  const payData = await payRes.json()
                  console.log('[GoCardless Webhook] Auto-payment created:', payData)
                  await supabase.from('activity_log').insert({
                    entity_type: 'subscription',
                    entity_id: subscription.id,
                    action: 'auto_payment_created',
                    description: `Pago creado automáticamente al activarse el mandato. ${isImmediate ? `Payment: ${payData.paymentId}` : `GC Sub: ${payData.gcSubscriptionId}`}`,
                    performed_by: 'system',
                  })
                }
              } catch (payErr: any) {
                console.error('[GoCardless Webhook] Error auto-creating payment:', payErr?.message)
                await supabase.from('activity_log').insert({
                  entity_type: 'subscription',
                  entity_id: subscription.id,
                  action: 'auto_payment_error',
                  description: `Excepción al crear pago automático: ${payErr?.message}`,
                  performed_by: 'system',
                })
              }
            } else {
              console.warn(`[GoCardless Webhook] Mandate active but no annual_amount on subscription ${subscription.id} — payment NOT auto-created.`)
            }
            break
          }

          case 'failed':
          case 'cancelled':
          case 'expired':
            // Mandate failed — pause subscription
            await supabase
              .from('subscriptions')
              .update({ status: 'paused' })
              .eq('id', subscription.id)

            await supabase.from('activity_log').insert({
              entity_type: 'subscription',
              entity_id: subscription.id,
              action: `mandate_${action}`,
              description: `Mandato SEPA ${action}. Suscripcion pausada. Mandate: ${mandateId}`,
              performed_by: 'system',
            })
            break
        }
      }

      if (resource_type === 'payments') {
        const paymentId = links?.payment
        const mandateId = links?.mandate

        if (!mandateId) continue

        // Find subscription
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('id, client_id')
          .eq('gocardless_mandate_id', mandateId)
          .single()

        if (!subscription) continue

        switch (action) {
          case 'confirmed':
          case 'paid_out':
            // Payment successful — update billing record if exists
            if (paymentId) {
              await supabase
                .from('billing')
                .update({
                  status: 'paid',
                  paid_at: new Date().toISOString(),
                })
                .eq('gocardless_payment_id', paymentId)

              await supabase.from('activity_log').insert({
                entity_type: 'billing',
                entity_id: paymentId,
                action: 'payment_confirmed',
                description: `Pago SEPA confirmado via GoCardless. Payment: ${paymentId}`,
                performed_by: 'system',
              })
            }
            break

          case 'failed':
          case 'charged_back':
            // Payment failed
            if (paymentId) {
              await supabase
                .from('billing')
                .update({ status: 'overdue' })
                .eq('gocardless_payment_id', paymentId)

              await supabase.from('activity_log').insert({
                entity_type: 'billing',
                entity_id: paymentId,
                action: `payment_${action}`,
                description: `Pago SEPA ${action}. Payment: ${paymentId}`,
                performed_by: 'system',
              })
            }
            break
        }
      }

      if (resource_type === 'subscriptions') {
        // Handle GoCardless subscription events (recurring payment schedules)
        const gcSubscriptionId = links?.subscription
        const mandateId = links?.mandate

        if (!gcSubscriptionId) continue

        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('id')
          .eq('gocardless_subscription_id', gcSubscriptionId)
          .single()

        if (!subscription) continue

        switch (action) {
          case 'cancelled':
          case 'finished':
            await supabase
              .from('subscriptions')
              .update({
                status: action === 'cancelled' ? 'cancelled' : 'active',
                ...(action === 'cancelled' ? { cancelled_at: new Date().toISOString() } : {}),
              })
              .eq('id', subscription.id)

            await supabase.from('activity_log').insert({
              entity_type: 'subscription',
              entity_id: subscription.id,
              action: `gc_subscription_${action}`,
              description: `Suscripcion GoCardless ${action}. GC Sub: ${gcSubscriptionId}`,
              performed_by: 'system',
            })
            break

          case 'payment_created':
            // A new payment was automatically created by the recurring subscription
            await supabase.from('activity_log').insert({
              entity_type: 'subscription',
              entity_id: subscription.id,
              action: 'gc_payment_scheduled',
              description: `Nuevo pago programado por suscripcion GoCardless. GC Sub: ${gcSubscriptionId}`,
              performed_by: 'system',
            })
            break
        }
      }
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('[GoCardless Webhook] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
