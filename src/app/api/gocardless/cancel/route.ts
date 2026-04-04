import { NextRequest, NextResponse } from 'next/server'
import { createClient as supabaseCreateClient } from '@supabase/supabase-js'

/**
 * POST /api/gocardless/cancel
 *
 * Cancels a GoCardless subscription and/or mandate for a given Voltis subscription.
 * - If gocardless_subscription_id exists → cancel the GC subscription
 * - If gocardless_mandate_id exists → cancel the mandate
 * - Updates local subscription status to 'cancelled'
 */

interface CancelRequest {
  subscriptionId: string
  gocardlessMandateId?: string | null
  gocardlessSubscriptionId?: string | null
}

function getGCBaseUrl(): string {
  const env = process.env.GOCARDLESS_ENVIRONMENT || 'sandbox'
  return env === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com'
}

async function gcRequest(path: string, method: 'POST' | 'GET' | 'PUT' | 'DELETE' = 'POST', body?: any) {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN
  if (!token) throw new Error('GOCARDLESS_ACCESS_TOKEN not configured')

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'GoCardless-Version': '2015-07-06',
  }

  const res = await fetch(`${getGCBaseUrl()}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const errText = await res.text()
    // 409 = already cancelled, which is fine
    if (res.status === 409) {
      console.log(`[GoCardless] ${path} already cancelled (409)`)
      return null
    }
    console.error(`[GoCardless] ${path} failed:`, errText)
    throw new Error(`GoCardless API error: ${res.status} — ${errText}`)
  }

  return res.json()
}

export async function POST(request: NextRequest) {
  try {
    const body: CancelRequest = await request.json()
    const { subscriptionId, gocardlessMandateId, gocardlessSubscriptionId } = body

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId es obligatorio' }, { status: 400 })
    }

    if (!process.env.GOCARDLESS_ACCESS_TOKEN) {
      return NextResponse.json({ mode: 'manual', message: 'GoCardless no configurado' }, { status: 200 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    const supabase = supabaseCreateClient(supabaseUrl, supabaseKey)

    const results: string[] = []

    // 1. Cancel GoCardless subscription (recurring payments) if exists
    if (gocardlessSubscriptionId) {
      try {
        await gcRequest(`/subscriptions/${gocardlessSubscriptionId}/actions/cancel`, 'POST', {})
        results.push(`Suscripcion GC ${gocardlessSubscriptionId} cancelada`)
      } catch (e: any) {
        results.push(`Aviso suscripcion GC: ${e.message}`)
      }
    }

    // 2. Cancel the mandate if exists
    if (gocardlessMandateId) {
      try {
        await gcRequest(`/mandates/${gocardlessMandateId}/actions/cancel`, 'POST', {})
        results.push(`Mandato SEPA ${gocardlessMandateId} cancelado`)
      } catch (e: any) {
        results.push(`Aviso mandato: ${e.message}`)
      }
    }

    // 3. Update local subscription
    await supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)

    // 4. Log
    await supabase.from('activity_log').insert({
      entity_type: 'subscription',
      entity_id: subscriptionId,
      action: 'subscription_cancelled',
      description: `Suscripcion cancelada. ${results.join('. ')}`,
      performed_by: 'system',
    })

    return NextResponse.json({
      success: true,
      details: results,
    })
  } catch (err: any) {
    console.error('[GoCardless] Cancel error:', err)
    return NextResponse.json(
      { error: err.message || 'Error cancelando suscripcion' },
      { status: 500 }
    )
  }
}
