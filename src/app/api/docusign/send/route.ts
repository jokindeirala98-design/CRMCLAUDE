import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/docusign/send
 *
 * Generates a Voltis subscription contract and sends it via DocuSign.
 * If DocuSign API keys are not configured, returns manual mode.
 *
 * Required env vars:
 *   DOCUSIGN_ACCESS_TOKEN - OAuth access token
 *   DOCUSIGN_ACCOUNT_ID   - Account ID
 *   DOCUSIGN_BASE_URL     - API base URL (e.g., https://demo.docusign.net/restapi)
 *   DOCUSIGN_TEMPLATE_ID  - Template ID for Voltis contract (optional)
 */

interface SendRequest {
  contractId: string
  clientId: string
  subscriptionId: string
  signerEmail: string
  signerName: string
  subscriptionModel: 'fixed' | 'percentage'
  planTier: number | null
  percentageValue: number | null
  paymentMode: 'quarterly' | 'annual'
  clientCif: string | null
  clientIban: string | null
}

export async function POST(request: NextRequest) {
  try {
    const body: SendRequest = await request.json()

    const {
      contractId,
      clientId,
      subscriptionId,
      signerEmail,
      signerName,
      subscriptionModel,
      planTier,
      percentageValue,
      paymentMode,
      clientCif,
      clientIban,
    } = body

    // Validate required fields
    if (!contractId || !signerEmail || !signerName) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: contractId, signerEmail, signerName' },
        { status: 400 }
      )
    }

    // Check if DocuSign is configured
    const accessToken = process.env.DOCUSIGN_ACCESS_TOKEN
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID
    const baseUrl = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi'

    if (!accessToken || !accountId) {
      // Manual mode — DocuSign not configured
      return NextResponse.json(
        {
          mode: 'manual',
          message: 'DocuSign no esta configurado. Contrato creado en modo manual. Configura DOCUSIGN_ACCESS_TOKEN y DOCUSIGN_ACCOUNT_ID en las variables de entorno.',
        },
        { status: 200 }
      )
    }

    // Build subscription description for the contract
    const subscriptionDesc = subscriptionModel === 'percentage'
      ? `${percentageValue}% del ahorro generado`
      : `Suscripcion fija de ${planTier}€/trimestre${paymentMode === 'annual' ? ` (pago anual: ${(planTier! * 4 * 1.21).toFixed(2)}€)` : ''}`

    // Check if using a template
    const templateId = process.env.DOCUSIGN_TEMPLATE_ID

    let envelopeDefinition: any

    if (templateId) {
      // Use pre-configured template with tabs
      envelopeDefinition = {
        templateId,
        templateRoles: [
          {
            email: signerEmail,
            name: signerName,
            roleName: 'Cliente',
            tabs: {
              textTabs: [
                { tabLabel: 'client_name', value: signerName },
                { tabLabel: 'client_cif', value: clientCif || '' },
                { tabLabel: 'client_iban', value: clientIban || '' },
                { tabLabel: 'subscription_model', value: subscriptionDesc },
                { tabLabel: 'contract_date', value: new Date().toLocaleDateString('es-ES') },
              ],
            },
          },
        ],
        status: 'sent',
        emailSubject: `Voltis Energia — Contrato de suscripcion para ${signerName}`,
        emailBlurb: `Estimado/a ${signerName}, adjunto encontrara el contrato de suscripcion con Voltis Energia. Por favor, reviselo y firmelo digitalmente.`,
      }
    } else {
      // Generate contract as HTML document embedded in envelope
      const contractHtml = generateContractHtml({
        clientName: signerName,
        clientCif: clientCif || 'No proporcionado',
        clientIban: clientIban || 'Pendiente',
        subscriptionDesc,
        date: new Date().toLocaleDateString('es-ES'),
      })

      const htmlBase64 = Buffer.from(contractHtml).toString('base64')

      envelopeDefinition = {
        documents: [
          {
            documentBase64: htmlBase64,
            name: `Contrato Voltis - ${signerName}.html`,
            fileExtension: 'html',
            documentId: '1',
          },
        ],
        recipients: {
          signers: [
            {
              email: signerEmail,
              name: signerName,
              recipientId: '1',
              routingOrder: '1',
              tabs: {
                signHereTabs: [
                  {
                    documentId: '1',
                    pageNumber: '1',
                    anchorString: '/firma_cliente/',
                    anchorXOffset: '0',
                    anchorYOffset: '-20',
                  },
                ],
                dateSignedTabs: [
                  {
                    documentId: '1',
                    pageNumber: '1',
                    anchorString: '/fecha_firma/',
                    anchorXOffset: '0',
                    anchorYOffset: '-10',
                  },
                ],
              },
            },
          ],
        },
        status: 'sent',
        emailSubject: `Voltis Energia — Contrato de suscripcion para ${signerName}`,
        emailBlurb: `Estimado/a ${signerName}, adjunto encontrara el contrato de suscripcion con Voltis Energia. Por favor, reviselo y firmelo digitalmente.`,
        eventNotification: {
          url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm.vercel.app'}/api/docusign/webhook`,
          loggingEnabled: true,
          requireAcknowledgment: true,
          envelopeEvents: [
            { envelopeEventStatusCode: 'completed' },
            { envelopeEventStatusCode: 'declined' },
            { envelopeEventStatusCode: 'voided' },
          ],
        },
      }
    }

    // Send to DocuSign API
    const dsResponse = await fetch(
      `${baseUrl}/v2.1/accounts/${accountId}/envelopes`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelopeDefinition),
      }
    )

    if (!dsResponse.ok) {
      const dsError = await dsResponse.text()
      console.error('DocuSign API error:', dsError)
      return NextResponse.json(
        { error: `Error de DocuSign: ${dsResponse.status}`, details: dsError },
        { status: 500 }
      )
    }

    const dsData = await dsResponse.json()

    return NextResponse.json({
      envelopeId: dsData.envelopeId,
      status: dsData.status,
      mode: 'docusign',
    })
  } catch (err: any) {
    console.error('DocuSign send error:', err)
    return NextResponse.json(
      { error: err.message || 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

// Generate HTML contract document
function generateContractHtml(data: {
  clientName: string
  clientCif: string
  clientIban: string
  subscriptionDesc: string
  date: string
}) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px 60px; color: #1a1a1a; line-height: 1.6; }
    .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #FF6B35; padding-bottom: 20px; }
    .header h1 { color: #FF6B35; font-size: 24px; margin: 0; }
    .header p { color: #666; font-size: 12px; margin: 5px 0 0; }
    .section { margin: 25px 0; }
    .section h2 { color: #333; font-size: 16px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
    .field { display: flex; margin: 8px 0; }
    .field-label { font-weight: bold; min-width: 200px; color: #555; }
    .field-value { color: #1a1a1a; }
    .highlight { background: #FFF3E0; padding: 15px; border-radius: 8px; border-left: 4px solid #FF6B35; margin: 20px 0; }
    .signature-section { margin-top: 60px; display: flex; justify-content: space-between; }
    .signature-box { width: 45%; text-align: center; }
    .signature-line { border-top: 1px solid #333; margin-top: 60px; padding-top: 10px; }
    .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 15px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>VOLTIS ENERGIA</h1>
    <p>Consultoria energetica · CIF: B12345678</p>
    <p>Contrato de Suscripcion de Servicios de Consultoria Energetica</p>
  </div>

  <div class="section">
    <h2>1. Datos del Cliente</h2>
    <div class="field"><span class="field-label">Nombre / Razon Social:</span> <span class="field-value">${data.clientName}</span></div>
    <div class="field"><span class="field-label">CIF / NIF:</span> <span class="field-value">${data.clientCif}</span></div>
    <div class="field"><span class="field-label">IBAN:</span> <span class="field-value">${data.clientIban}</span></div>
    <div class="field"><span class="field-label">Fecha del contrato:</span> <span class="field-value">${data.date}</span></div>
  </div>

  <div class="section">
    <h2>2. Objeto del Contrato</h2>
    <p>El presente contrato regula la prestacion de servicios de consultoria energetica por parte de VOLTIS ENERGIA al CLIENTE, incluyendo la auditoria de suministros, optimizacion de tarifas, gestion con comercializadoras, y seguimiento trimestral del ahorro generado.</p>
  </div>

  <div class="section">
    <h2>3. Condiciones Economicas</h2>
    <div class="highlight">
      <strong>Modelo de suscripcion:</strong> ${data.subscriptionDesc}
    </div>
    <p>El cobro se realizara mediante domiciliacion bancaria SEPA en la cuenta indicada por el cliente. El cliente autoriza a Voltis Energia a realizar los cobros correspondientes segun las condiciones pactadas.</p>
  </div>

  <div class="section">
    <h2>4. Duracion y Rescision</h2>
    <p>El contrato tendra una duracion inicial de 12 meses, renovable automaticamente por periodos iguales salvo notificacion por escrito con 30 dias de antelacion. El cliente podra rescindir el contrato en cualquier momento sin penalizacion, respetando el periodo de preaviso.</p>
  </div>

  <div class="section">
    <h2>5. Proteccion de Datos</h2>
    <p>VOLTIS ENERGIA se compromete al tratamiento de los datos personales del CLIENTE de conformidad con el Reglamento General de Proteccion de Datos (RGPD) y la LOPDGDD.</p>
  </div>

  <div class="signature-section">
    <div class="signature-box">
      <p><strong>VOLTIS ENERGIA</strong></p>
      <div class="signature-line">Firma autorizada</div>
    </div>
    <div class="signature-box">
      <p><strong>EL CLIENTE</strong></p>
      <p>/firma_cliente/</p>
      <div class="signature-line">
        ${data.clientName}<br>
        /fecha_firma/
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Voltis Energia S.L. · Consultoria Energetica · Este documento ha sido generado automaticamente y firmado digitalmente a traves de DocuSign.</p>
  </div>
</body>
</html>`
}
