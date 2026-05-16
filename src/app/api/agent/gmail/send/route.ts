/**
 * POST /api/agent/gmail/send
 *
 * Envía un correo desde la cuenta Gmail conectada del comercial. Solo lo
 * llama el handler de Telegram tras confirmación explícita [Enviar] del
 * comercial.
 *
 * Body:
 *  {
 *    telegramUserId: number,
 *    to: string,
 *    subject: string,
 *    body: string,
 *    clienteId?: string,         // opcional, para registrar actividad CRM
 *    conversationId?: string,    // opcional, para log de mensaje
 *  }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendGmailEmail } from '@/lib/agent/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  // Solo accesible con token interno (no exponer al exterior)
  const internalToken = req.headers.get('x-internal-token')
  const expected = process.env.AGENT_INTERNAL_TOKEN
  if (expected && internalToken !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { telegramUserId, to, subject, body: emailBody, clienteId, conversationId } = body
  if (!telegramUserId || !to || !subject || !emailBody) {
    return NextResponse.json({ error: 'Faltan telegramUserId, to, subject o body' }, { status: 400 })
  }

  try {
    const result = await sendGmailEmail({
      telegramUserId,
      to,
      subject,
      body: emailBody,
    })

    // Registrar actividad en el CRM si conocemos el cliente
    if (clienteId) {
      const sb = admin()
      // Si existe una tabla de actividades, registramos. Si no, lo ignoramos
      // sin error (mejor enviar el correo que perderlo por log).
      try {
        await sb.from('activities').insert({
          client_id: clienteId,
          type: 'email_sent_by_agent',
          description: `Email enviado a ${to}: "${subject}"`,
          metadata: {
            from: result.from,
            gmail_message_id: result.id,
            telegram_user_id: telegramUserId,
            conversation_id: conversationId,
          },
        })
      } catch {
        // tabla puede no existir todavía — log silencioso
      }
    }

    // Log en agent_messages para trazabilidad
    if (conversationId) {
      const sb = admin()
      await sb.from('agent_messages').insert({
        conversation_id: conversationId,
        role: 'tool',
        tool_name: 'gmail_send_email_actual',
        tool_result: {
          ok: true,
          to,
          subject,
          gmail_message_id: result.id,
          from: result.from,
        },
      })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error al enviar' }, { status: 500 })
  }
}
