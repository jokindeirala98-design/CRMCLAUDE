/**
 * POST /api/billing/generate-invoice
 *
 * Creates a billing record, generates a PDF from the Voltis template,
 * uploads it to Supabase Storage, and optionally sends it by email.
 *
 * Body: {
 *   client_id: string
 *   concept: string            // single line concept (can include \n for multiline)
 *   lines?: { concept: string; amount: number }[]   // optional multi-line
 *   base_amount: number
 *   due_date?: string          // ISO date
 *   subscription_id?: string
 *   send_email?: boolean       // if true, sends to client's email
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { generateInvoicePDF } from '@/lib/generate-invoice-pdf'
import { Resend } from 'resend'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const resendKey = process.env.RESEND_API_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      client_id,
      concept,
      lines,
      base_amount,
      due_date,
      subscription_id,
      send_email = false,
    } = body

    if (!client_id || !base_amount) {
      return NextResponse.json({ error: 'client_id y base_amount son requeridos' }, { status: 400 })
    }

    const supabase = createSupabase(supabaseUrl, supabaseKey)

    // ── 1. Fetch client ──
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name, cif_nif, email, fiscal_address')
      .eq('id', client_id)
      .single()

    if (clientErr || !client) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    // ── 2. Generate sequential invoice number ──
    const year = new Date().getFullYear()
    const yearShort = String(year).slice(-2)
    const { data: lastBilling } = await supabase
      .from('billing')
      .select('invoice_number')
      .ilike('invoice_number', `%/${yearShort}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let seq = 1
    if (lastBilling?.invoice_number) {
      const match = lastBilling.invoice_number.match(/^(\d+)\//)
      if (match) seq = parseInt(match[1]) + 1
    }
    const invoiceNumber = `${String(seq).padStart(2, '0')}/${yearShort}`

    // ── 3. Build invoice data ──
    const vatRate = 21
    const vatAmount = Math.round(base_amount * (vatRate / 100) * 100) / 100
    const totalAmount = base_amount + vatAmount
    const invoiceDate = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const dueDateStr = due_date
      ? new Date(due_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : undefined

    // Parse address: "Street, CP, City" or just use as-is
    let clientAddress: string | null = null
    let clientCity: string | null = null
    if (client.fiscal_address) {
      const parts = client.fiscal_address.split(',').map((p: string) => p.trim())
      if (parts.length >= 2) {
        clientAddress = parts.slice(0, -1).join(', ')
        clientCity = parts[parts.length - 1]
      } else {
        clientAddress = client.fiscal_address
      }
    }

    const invoiceLines: { concept: string; amount: number }[] = lines && lines.length > 0
      ? lines
      : [{ concept: concept || 'Honorarios de consultoría energética', amount: base_amount }]

    const invoiceData = {
      invoiceNumber,
      invoiceDate,
      dueDate: dueDateStr,
      clientName: client.name,
      clientCif: client.cif_nif,
      clientAddress,
      clientCity,
      clientEmail: client.email,
      lines: invoiceLines,
    }

    // ── 4. Generate PDF ──
    const pdfBuffer = generateInvoicePDF(invoiceData)

    // ── 5. Upload to Supabase Storage ──
    const fileName = `facturas/${invoiceNumber.replace('/', '-')}_${client.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })

    if (uploadErr) {
      console.error('[generate-invoice] Upload error:', uploadErr)
      return NextResponse.json({ error: `Error subiendo PDF: ${uploadErr.message}` }, { status: 500 })
    }

    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(fileName)
    const pdfUrl = urlData.publicUrl

    // ── 6. Create billing record ──
    const { data: billing, error: billingErr } = await supabase
      .from('billing')
      .insert({
        client_id,
        subscription_id: subscription_id || null,
        invoice_number: invoiceNumber,
        concept: invoiceLines.map((l) => l.concept).join(' / '),
        base_amount,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        total_amount: totalAmount,
        status: send_email ? 'sent' : 'draft',
        file_url: pdfUrl,
        due_date: due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (billingErr) {
      console.error('[generate-invoice] Billing insert error:', billingErr)
      return NextResponse.json({ error: `Error creando factura: ${billingErr.message}` }, { status: 500 })
    }

    // ── 7. Send email if requested ──
    let emailSent = false
    if (send_email && client.email && resendKey) {
      try {
        const resend = new Resend(resendKey)
        const htmlBody = buildInvoiceEmail(invoiceData, pdfUrl, totalAmount)

        await resend.emails.send({
          from: 'Voltis Energía <facturacion@voltisenergia.com>',
          to: [client.email],
          subject: `Voltis Energía te ha emitido la factura ${invoiceNumber}`,
          html: htmlBody,
          attachments: [
            {
              filename: `Factura_${invoiceNumber.replace('/', '-')}_Voltis.pdf`,
              content: Buffer.from(pdfBuffer).toString('base64'),
            },
          ],
        })
        emailSent = true
      } catch (emailErr: any) {
        console.error('[generate-invoice] Email send error:', emailErr)
        // Don't fail the whole operation if email fails
      }
    } else if (send_email && !resendKey) {
      console.warn('[generate-invoice] RESEND_API_KEY not configured — email not sent')
    }

    return NextResponse.json({
      ok: true,
      billing_id: billing.id,
      invoice_number: invoiceNumber,
      pdf_url: pdfUrl,
      email_sent: emailSent,
      total_amount: totalAmount,
    })
  } catch (err: any) {
    console.error('[generate-invoice] Error:', err)
    return NextResponse.json({ error: err.message || 'Error generando factura' }, { status: 500 })
  }
}

/**
 * POST /api/billing/generate-invoice?action=send
 * Re-sends an existing invoice by email.
 */
export async function PUT(req: NextRequest) {
  try {
    const { billing_id } = await req.json()
    if (!billing_id) return NextResponse.json({ error: 'billing_id requerido' }, { status: 400 })

    const supabase = createSupabase(supabaseUrl, supabaseKey)

    const { data: billing, error: billingErr } = await supabase
      .from('billing')
      .select('*, client:clients(name, cif_nif, email)')
      .eq('id', billing_id)
      .single()

    if (billingErr || !billing) {
      return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })
    }

    const client = (billing as any).client
    if (!client?.email) {
      return NextResponse.json({ error: 'El cliente no tiene email registrado' }, { status: 422 })
    }

    if (!billing.file_url) {
      return NextResponse.json({ error: 'La factura no tiene PDF generado' }, { status: 422 })
    }

    if (!resendKey) {
      return NextResponse.json({ error: 'RESEND_API_KEY no configurado' }, { status: 500 })
    }

    // Fetch the PDF from Supabase storage
    const pdfResponse = await fetch(billing.file_url)
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())

    const resend = new Resend(resendKey)
    const invoiceData = {
      invoiceNumber: billing.invoice_number,
      invoiceDate: new Date(billing.created_at).toLocaleDateString('es-ES'),
      clientName: client.name,
      clientCif: client.cif_nif,
      clientAddress: null,
      clientCity: null,
      clientEmail: client.email,
      lines: [{ concept: billing.concept, amount: billing.base_amount }],
    }
    const htmlBody = buildInvoiceEmail(invoiceData, billing.file_url, billing.total_amount)

    await resend.emails.send({
      from: 'Voltis Energía <facturacion@voltisenergia.com>',
      to: [client.email],
      subject: `Voltis Energía te ha emitido la factura ${billing.invoice_number}`,
      html: htmlBody,
      attachments: [
        {
          filename: `Factura_${billing.invoice_number.replace('/', '-')}_Voltis.pdf`,
          content: pdfBuffer.toString('base64'),
        },
      ],
    })

    await supabase.from('billing').update({ status: 'sent' }).eq('id', billing_id)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[generate-invoice PUT] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Email HTML template ──
function buildInvoiceEmail(
  data: {
    invoiceNumber: string
    invoiceDate: string
    clientName: string
    clientCif: string | null
    lines: { concept: string; amount: number }[]
  },
  pdfUrl: string,
  totalAmount: number
): string {
  const fmtEur = (n: number) =>
    n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

  const lineRows = data.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0">${l.concept}</td>
        <td style="padding:10px 16px;font-size:14px;color:#333;text-align:right;border-bottom:1px solid #f0f0f0">${fmtEur(l.amount)}</td>
      </tr>`
    )
    .join('')

  const base = data.lines.reduce((s, l) => s + l.amount, 0)
  const vat = Math.round(base * 0.21 * 100) / 100

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a3a6b,#2563eb);padding:32px 40px;text-align:center">
            <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;letter-spacing:-0.5px">Voltis Energía</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px">Te ha emitido una factura</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px">
            <p style="margin:0 0 8px;font-size:16px;color:#1a1a2e">Hola, <strong>${data.clientName}</strong>.</p>
            <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.6">Voltis Energía ha emitido una factura para ti con fecha ${data.invoiceDate}.</p>
            <!-- Invoice box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8eaf0;border-radius:8px;overflow:hidden;margin-bottom:24px">
              <tr style="background:#f8f9fc">
                <td style="padding:12px 16px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Concepto</td>
                <td style="padding:12px 16px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;text-align:right">Importe</td>
              </tr>
              ${lineRows}
              <tr>
                <td style="padding:8px 16px;font-size:13px;color:#666;text-align:right;background:#f8f9fc" colspan="1">Base Imponible</td>
                <td style="padding:8px 16px;font-size:13px;color:#666;text-align:right;background:#f8f9fc">${fmtEur(base)}</td>
              </tr>
              <tr>
                <td style="padding:8px 16px;font-size:13px;color:#666;text-align:right;background:#f8f9fc">IVA 21%</td>
                <td style="padding:8px 16px;font-size:13px;color:#666;text-align:right;background:#f8f9fc">${fmtEur(vat)}</td>
              </tr>
              <tr style="background:#1a3a6b">
                <td style="padding:14px 16px;font-size:15px;color:#fff;font-weight:700">TOTAL FACTURA</td>
                <td style="padding:14px 16px;font-size:15px;color:#fff;font-weight:700;text-align:right">${fmtEur(totalAmount)}</td>
              </tr>
            </table>
            <!-- IBAN -->
            <div style="background:#f0f4ff;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px">
              <p style="margin:0 0 4px;font-size:12px;color:#888">Ingresar en:</p>
              <p style="margin:0;font-size:14px;font-weight:700;color:#1a3a6b;letter-spacing:1px">ES19 0182 5000 8402 0187 5295</p>
            </div>
            <!-- PDF button -->
            <div style="text-align:center;margin-bottom:8px">
              <a href="${pdfUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none">
                📄 Ver factura en PDF
              </a>
            </div>
            <p style="margin:16px 0 0;font-size:12px;color:#aaa;text-align:center">La factura también está adjunta a este correo.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;background:#f8f9fc;border-top:1px solid #eee">
            <p style="margin:0;font-size:11px;color:#aaa;text-align:center">
              Voltis Soluciones S.L. · B-71548705 · Calle Berriobide 38, Oficina 209, 31013 Ansoáin<br>
              <a href="mailto:facturacion@voltisenergia.com" style="color:#2563eb">facturacion@voltisenergia.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
