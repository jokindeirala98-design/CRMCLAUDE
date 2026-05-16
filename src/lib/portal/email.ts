/**
 * Portal Cliente v2 — Envío de emails transaccionales (Resend).
 *
 * Por ahora solo el email del magic link de acceso. Se irá ampliando
 * con: notificación de invitación, alerta de consumo anómalo,
 * factura nueva disponible, etc.
 */
import { Resend } from 'resend'
import { VOLTIS_INFO } from '@/lib/voltis-info'

const RESEND_KEY = process.env.RESEND_API_KEY || ''
const FROM = process.env.PORTAL_EMAIL_FROM || 'Voltis Energía <portal@voltisenergia.com>'

function client() {
  if (!RESEND_KEY) return null
  return new Resend(RESEND_KEY)
}

// ── Magic link ───────────────────────────────────────────────────────────

export interface MagicLinkEmail {
  to: string
  url: string
  expiresAt: Date
  /** Nombre del cliente al que da acceso este link. Si el usuario tiene
   *  acceso a varios clientes, mandamos un email por cada uno con el
   *  nombre del cliente en el subject para que sepa cuál abrir. */
  clientName?: string
}

export async function sendPortalMagicLinkEmail(args: MagicLinkEmail): Promise<void> {
  const resend = client()
  if (!resend) {
    // En cualquier entorno SIN Resend, log a stdout (Vercel logs) y
    // marcamos como skipped. Permite copiar el link a mano mientras se
    // configura.
    console.warn('[portal-email] RESEND_API_KEY no configurada — magic link a stdout:')
    console.warn('[portal-email]   to=' + args.to)
    console.warn('[portal-email]   url=' + args.url)
    return
  }

  const minutes = Math.round((args.expiresAt.getTime() - Date.now()) / 60000)

  const html = renderMagicLinkHtml(args.url, minutes)
  const text = renderMagicLinkText(args.url, minutes)

  const subject = args.clientName
    ? `Tu acceso a Voltis — ${args.clientName}`
    : 'Tu acceso a Voltis · enlace de un solo uso'

  console.log('[portal-email] enviando a', args.to, 'via Resend (from=' + FROM + ')', 'subject:', subject)
  const res = await resend.emails.send({
    from: FROM,
    to: [args.to],
    subject,
    html,
    text,
  })
  // El SDK de Resend devuelve { data, error } en vez de tirar
  if ((res as any)?.error) {
    const e = (res as any).error
    throw new Error(`Resend error: ${e.name || ''} — ${e.message || JSON.stringify(e)}`)
  }
  console.log('[portal-email] OK id=', (res as any)?.data?.id)
}

// ── Plantillas HTML / texto ──────────────────────────────────────────────

function renderMagicLinkHtml(url: string, minutes: number): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Acceso a Voltis</title>
</head>
<body style="margin:0;padding:0;background:#0A2061;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0B1B3E;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0A2061;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 24px 60px -20px rgba(0,0,0,0.4);">
        <tr><td style="padding:36px 36px 0 36px;">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#1F47B5;font-weight:700;">Voltis Energía · Acceso</div>
          <h1 style="margin:14px 0 8px 0;font-size:24px;color:#0B1B3E;line-height:1.2;">Tu enlace de acceso al portal</h1>
          <p style="margin:0;color:#4A5A82;font-size:14.5px;line-height:1.6;">
            Hemos recibido una solicitud de acceso a tu portal energético.
            Pulsa el botón de abajo para entrar — el enlace caduca en
            <strong>${minutes} minutos</strong> y solo puede usarse una vez.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:28px 36px;">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;background:#1F47B5;color:#FFFFFF;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.01em;">
            Acceder a mi portal
          </a>
        </td></tr>
        <tr><td style="padding:0 36px 28px 36px;">
          <p style="margin:0 0 8px 0;font-size:12px;color:#4A5A82;line-height:1.6;">
            Si el botón no funciona, copia y pega este enlace en tu navegador:
          </p>
          <p style="margin:0;font-size:11.5px;color:#1F47B5;word-break:break-all;font-family:ui-monospace,SF Mono,Menlo,monospace;">
            ${escapeHtml(url)}
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px 32px 36px;border-top:1px solid #EAF1FF;">
          <p style="margin:0;font-size:11.5px;color:#4A5A82;line-height:1.6;">
            Si no has solicitado este acceso, ignora este correo. Nadie podrá
            entrar a tu portal sin pulsar el enlace.
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px 32px 36px;background:#F4F7FF;text-align:center;">
          <div style="font-size:11px;color:#4A5A82;">
            <strong style="color:#0B1B3E;">Voltis Energía</strong><br />
            ${escapeHtml(VOLTIS_INFO.phone)} · ${escapeHtml(VOLTIS_INFO.email)}<br />
            <span style="color:#1F47B5;">www.${escapeHtml(VOLTIS_INFO.website)}</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function renderMagicLinkText(url: string, minutes: number): string {
  return `Voltis Energía · Acceso al portal

Hemos recibido una solicitud de acceso a tu portal energético.
Usa el enlace de abajo para entrar (válido durante ${minutes} minutos, un solo uso):

${url}

Si no has solicitado este acceso, ignora este correo.

Voltis Energía · ${VOLTIS_INFO.phone} · ${VOLTIS_INFO.email}
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
