/**
 * POST /api/signwell/send
 *
 * Generates a filled DOCX contract (Contrato + Propuesta), uploads both files
 * to SignWell as a single multi-file document, and sends to the client via
 * SMS (default) or email for e-signature.
 *
 * On success, stores the SignWell document_id on the contract record and
 * returns the signing URL for display / logs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fillContractTemplates, buildTemplateData, type ContractType } from '@/lib/contracts/fillTemplate'

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ---------------------------------------------------------------------------
// SignWell API helper
// ---------------------------------------------------------------------------
const SIGNWELL_BASE = 'https://www.signwell.com/api/v1'
const SIGNWELL_AUTH = `Basic ${process.env.SIGNWELL_API_KEY_B64}`

async function swFetch(endpoint: string, body: unknown) {
  const res = await fetch(`${SIGNWELL_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: SIGNWELL_AUTH,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`SignWell ${endpoint} ${res.status}: ${JSON.stringify(data)}`)
  }
  return data
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      contractId,
      clientId,
      subscriptionId,
      contractType,           // 'b1_directo' | '25en4'
      deliveryMethod = 'sms', // 'sms' | 'email' | 'both'
      signerEmail,
      signerPhone,            // E.164 format: "+34612345678"
      signerName,
      repName,                // Representative name (empresa)
      repDni,                 // Representative DNI
      annualAmount,
      totalSavings,
      tariff,
      city,
    }: {
      contractId: string
      clientId: string
      subscriptionId?: string
      contractType: ContractType
      deliveryMethod?: 'sms' | 'email' | 'both'
      signerEmail: string
      signerPhone?: string
      signerName: string
      repName: string
      repDni: string
      annualAmount: number
      totalSavings: number
      tariff?: string
      city?: string
    } = body

    if (!contractId || !clientId || !contractType || !signerEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // -------------------------------------------------------------------
    // 1. Fetch client record
    // -------------------------------------------------------------------
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // -------------------------------------------------------------------
    // 2. Build template data and generate filled DOCXs
    // -------------------------------------------------------------------
    const templateData = buildTemplateData({
      contractType,
      client,
      repName: repName || client.name,
      repDni: repDni || client.nif || client.cif || '',
      annualAmount,
      totalSavings,
      tariff,
      city,
    })

    const { contrato, propuesta } = await fillContractTemplates(templateData)

    // -------------------------------------------------------------------
    // 3. Prepare recipient
    // -------------------------------------------------------------------
    const shouldSendSms = (deliveryMethod === 'sms' || deliveryMethod === 'both') && !!signerPhone
    const shouldSendEmail = deliveryMethod === 'email' || deliveryMethod === 'both' || !shouldSendSms

    const recipient: Record<string, unknown> = {
      id: '1',
      name: signerName,
      email: signerEmail,
      send_email: shouldSendEmail,
    }

    if (shouldSendSms && signerPhone) {
      // Normalize phone to E.164 with Spain prefix if missing
      const normalizedPhone = signerPhone.startsWith('+')
        ? signerPhone
        : `+34${signerPhone.replace(/\s/g, '')}`
      recipient.phone = normalizedPhone
      recipient.send_sms = true
    }

    // -------------------------------------------------------------------
    // 4. Signature field placement
    // The client signature is in a table at the bottom of the last page.
    // We use text anchoring on "EL CLIENTE" to position the field.
    // -------------------------------------------------------------------
    const signatureField = {
      recipient_id: '1',
      type: 'signature',
      required: true,
      lock_sign_date: false,
      // Anchor to "EL CLIENTE" text — place field below/right of it
      placeholder_id: 'sig_cliente',
      text_anchor: {
        anchor_string: 'EL CLIENTE',
        anchor_string_page: 'last',
        anchor_x_offset: '0',
        anchor_y_offset: '20',
        anchor_units: 'pixels',
      },
    }

    // Date field next to signature
    const dateField = {
      recipient_id: '1',
      type: 'date_signed',
      required: true,
      placeholder_id: 'date_cliente',
      text_anchor: {
        anchor_string: 'EL CLIENTE',
        anchor_string_page: 'last',
        anchor_x_offset: '0',
        anchor_y_offset: '80',
        anchor_units: 'pixels',
      },
    }

    // -------------------------------------------------------------------
    // 5. Create SignWell document
    // -------------------------------------------------------------------
    const contractLabel = contractType === 'b1_directo'
      ? 'Contrato B1 — 25% Ahorro Directo'
      : 'Contrato — 25% Ahorro (50%+50% Trimestral)'

    const smsMessage = `Voltis Energía: Por favor, firme su ${contractLabel}. El documento incluye el contrato y la propuesta de colaboración.`

    const swPayload = {
      test_mode: process.env.SIGNWELL_TEST_MODE === 'true',
      files: [
        {
          name: `Contrato_VoltisEnergia_${client.name.replace(/\s+/g, '_')}.docx`,
          file_base64: contrato.toString('base64'),
        },
        {
          name: `Propuesta_VoltisEnergia_${client.name.replace(/\s+/g, '_')}.docx`,
          file_base64: propuesta.toString('base64'),
        },
      ],
      subject: `Contrato de Servicios — Voltis Energía`,
      message: `Estimado/a ${signerName},\n\nAdjunto encontrará su contrato de asesoría energética con Voltis Energía (${contractLabel}), junto con la propuesta de colaboración.\n\nPor favor, revíselo y fírmelo digitalmente.\n\nGracias,\nEquipo Voltis Energía`,
      sms_message: smsMessage,
      recipients: [recipient],
      fields: [signatureField, dateField],
      custom_requester_name: 'Voltis Energía',
      custom_requester_email: 'jokin@voltisenergia.com',
      allow_decline: true,
      allow_reassign: false,
      expires_in: 30, // days
      send_completed_emails: true,
      completed_redirect_url: `${process.env.NEXT_PUBLIC_APP_URL}/clients/${clientId}?contract=signed`,
    }

    const swDoc = await swFetch('/documents', swPayload)

    const signwellDocumentId: string = swDoc.id
    const signingUrl: string | undefined = swDoc.recipients?.[0]?.embedded_signing_url

    // -------------------------------------------------------------------
    // 6. Update contract record with SignWell document ID
    // -------------------------------------------------------------------
    await supabase
      .from('contracts')
      .update({
        signwell_document_id: signwellDocumentId,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .eq('id', contractId)

    // Log activity
    await supabase.from('activity_log').insert({
      client_id: clientId,
      type: 'contract_sent',
      description: `Contrato enviado para firma electrónica (SignWell) — ${contractLabel} — ${deliveryMethod.toUpperCase()}`,
      metadata: {
        signwellDocumentId,
        contractType,
        deliveryMethod,
        signerEmail,
        signerPhone: signerPhone || null,
        subscriptionId,
      },
    })

    return NextResponse.json({
      success: true,
      mode: 'signwell',
      signwellDocumentId,
      signingUrl,
      deliveryMethod,
    })

  } catch (err: unknown) {
    console.error('[signwell/send] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
