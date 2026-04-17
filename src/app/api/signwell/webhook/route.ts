/**
 * POST /api/signwell/webhook
 *
 * Receives SignWell webhook events.
 * On document_completed:
 *   1. Verify the webhook secret
 *   2. Download the signed PDF from SignWell
 *   3. Upload to Supabase Storage under documents/contracts/{contractId}/signed.pdf
 *   4. Update contract status → 'signed', store signed_file_url
 *   5. Update supply status → 'firmado'
 *   6. Trigger GoCardless mandate creation (same as DocuSign webhook did)
 *   7. Log activity
 *
 * On document_declined / document_expired:
 *   - Update contract status → 'rejected'
 *   - Log activity
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const SIGNWELL_AUTH = `Basic ${process.env.SIGNWELL_API_KEY_B64}`
const SIGNWELL_BASE = 'https://www.signwell.com/api/v1'

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------
async function verifySignwellWebhook(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.SIGNWELL_WEBHOOK_SECRET
  if (!secret) return true // Skip verification if secret not configured (dev mode)

  const signature = req.headers.get('x-signwell-signature') || ''
  if (!signature) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const sigBytes = Buffer.from(signature, 'hex')
  const bodyBytes = encoder.encode(body)
  return crypto.subtle.verify('HMAC', key, sigBytes, bodyBytes)
}

// ---------------------------------------------------------------------------
// Download signed PDF from SignWell
// ---------------------------------------------------------------------------
async function downloadSignedPdf(documentId: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${SIGNWELL_BASE}/documents/${documentId}`, {
      headers: { Authorization: SIGNWELL_AUTH },
    })
    if (!res.ok) return null

    const doc = await res.json()
    const pdfUrl: string | undefined = doc.completed_pdf_url || doc.audit_trail_url

    if (!pdfUrl) return null

    const pdfRes = await fetch(pdfUrl)
    if (!pdfRes.ok) return null

    const arrayBuffer = await pdfRes.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Upload signed PDF to Supabase Storage
// ---------------------------------------------------------------------------
async function uploadSignedPdf(
  supabase: ReturnType<typeof supabaseAdmin>,
  contractId: string,
  clientId: string,
  pdfBuffer: Buffer,
): Promise<string | null> {
  const filePath = `contracts/${clientId}/${contractId}/signed.pdf`

  const { error } = await supabase.storage
    .from('documents')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (error) {
    console.error('[signwell/webhook] Storage upload error:', error)
    return null
  }

  const { data } = supabase.storage.from('documents').getPublicUrl(filePath)
  return data?.publicUrl || null
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // Verify signature
  const isValid = await verifySignwellWebhook(req, rawBody)
  if (!isValid) {
    console.warn('[signwell/webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // SignWell sends { event_type, data: { document: {...} } }
  const eventType = event.event_type as string
  const doc = (event.data as Record<string, unknown>)?.document as Record<string, unknown> | undefined

  if (!doc) {
    return NextResponse.json({ ok: true }) // ping / unknown event
  }

  const signwellDocumentId = doc.id as string
  if (!signwellDocumentId) {
    return NextResponse.json({ ok: true })
  }

  const supabase = supabaseAdmin()

  // -------------------------------------------------------------------
  // Find contract by signwell_document_id
  // -------------------------------------------------------------------
  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('*, client:clients(*)')
    .eq('signwell_document_id', signwellDocumentId)
    .single()

  if (contractError || !contract) {
    console.warn('[signwell/webhook] Contract not found for document:', signwellDocumentId)
    return NextResponse.json({ ok: true }) // Don't error — SignWell will retry
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://www.voltisenergia.com'

  // -------------------------------------------------------------------
  // Handle event types
  // -------------------------------------------------------------------
  if (eventType === 'document_completed') {
    // 1. Download signed PDF
    const pdfBuffer = await downloadSignedPdf(signwellDocumentId)

    // 2. Upload to Supabase Storage
    let signedFileUrl: string | null = null
    if (pdfBuffer) {
      signedFileUrl = await uploadSignedPdf(supabase, contract.id, contract.client_id, pdfBuffer)
    }

    // 3. Update contract
    await supabase
      .from('contracts')
      .update({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signed_file_url: signedFileUrl,
      })
      .eq('id', contract.id)

    // 4. Update supply status → firmado
    if (contract.supply_id) {
      await supabase
        .from('supplies')
        .update({ status: 'firmado' })
        .eq('id', contract.supply_id)
    }

    // 5. Trigger GoCardless mandate creation (same logic as docusign/webhook)
    const clientData = contract.client as Record<string, unknown> | null

    if (clientData?.iban) {
      try {
        // Find pending subscription
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('client_id', contract.client_id)
          .eq('status', 'pending_activation')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (subscription) {
          const gcRes = await fetch(`${origin}/api/gocardless/create-mandate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriptionId: subscription.id,
              clientId: contract.client_id,
              clientName: clientData.name,
              clientEmail: clientData.email,
              clientIban: clientData.iban,
            }),
          })

          if (gcRes.ok) {
            const gcData = await gcRes.json()
            if (gcData.mandateId) {
              await supabase
                .from('subscriptions')
                .update({
                  gocardless_mandate_id: gcData.mandateId,
                  status: 'active',
                })
                .eq('id', subscription.id)

              if (contract.supply_id) {
                await supabase
                  .from('supplies')
                  .update({ status: 'suscrito' })
                  .eq('id', contract.supply_id)
              }
            }
          }
        }
      } catch (gcErr) {
        console.error('[signwell/webhook] GoCardless mandate error:', gcErr)
        // Non-fatal — contract is signed, mandate can be created manually
      }
    }

    // 6. Log activity
    await supabase.from('activity_log').insert({
      client_id: contract.client_id,
      type: 'contract_signed',
      description: `Contrato firmado electrónicamente (SignWell)${signedFileUrl ? ' — PDF guardado' : ''}`,
      metadata: {
        signwellDocumentId,
        contractId: contract.id,
        signedFileUrl,
      },
    })

    console.log(`[signwell/webhook] Contract ${contract.id} signed. PDF: ${signedFileUrl || 'unavailable'}`)

  } else if (eventType === 'document_declined' || eventType === 'document_expired') {
    // Update contract to rejected
    await supabase
      .from('contracts')
      .update({ status: 'rejected' })
      .eq('id', contract.id)

    await supabase.from('activity_log').insert({
      client_id: contract.client_id,
      type: 'contract_rejected',
      description: `Contrato ${eventType === 'document_declined' ? 'rechazado' : 'expirado'} (SignWell)`,
      metadata: { signwellDocumentId, contractId: contract.id, eventType },
    })

    console.log(`[signwell/webhook] Contract ${contract.id} ${eventType}`)
  }

  return NextResponse.json({ ok: true })
}
