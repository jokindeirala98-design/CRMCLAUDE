/**
 * HTML del dossier de bienvenida para el cliente.
 * Diseño Voltis editorial, minimalista, una sola página A4.
 */
import { VOLTIS_INFO, voltisFullAddress, voltisPortalUrl } from './voltis-info'

export function buildDossierHtml(args: {
  clientName: string
  token: string
}): string {
  const url = voltisPortalUrl(args.token)
  const addr = voltisFullAddress()
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Voltis · Tu portal energético</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif;
         color: #1A1A1A; background: #F6F1E7; }
  .page { width: 210mm; min-height: 297mm; padding: 22mm 20mm; position: relative;
          background: #F6F1E7; display: flex; flex-direction: column; }
  .top { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 16mm; }
  .mascot { width: 64px; height: 64px; flex-shrink: 0; }
  .brand-tag { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
               color: #1F3A2E; font-weight: 700; margin-bottom: 2px; }
  .headline { font-family: 'Instrument Serif', Georgia, serif; font-style: italic;
              font-size: 32px; line-height: 1.15; color: #1F3A2E; margin: 0;
              max-width: 380px; }
  .client-card { background: #1F3A2E; color: #F6F1E7; border-radius: 14px;
                 padding: 18px 22px; margin-bottom: 14mm; }
  .client-label { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
                  color: #C7F24A; font-weight: 700; opacity: 0.9; }
  .client-name { font-size: 24px; font-weight: 700; margin-top: 4px; line-height: 1.15; }
  .section-title { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
                   color: #888; font-weight: 700; margin: 0 0 10px 0; }
  .benefits { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px;
              margin-bottom: 12mm; }
  .benefit { background: white; border: 1px solid #E2DED3; border-radius: 12px;
             padding: 14px; }
  .benefit-icon { width: 28px; height: 28px; background: #C7F24A; border-radius: 8px;
                  display: grid; place-items: center; margin-bottom: 8px;
                  font-size: 14px; }
  .benefit-title { font-size: 12px; font-weight: 700; color: #1F3A2E; margin-bottom: 3px; }
  .benefit-desc { font-size: 11px; color: #555; line-height: 1.4; }
  .link-box { background: white; border: 2px dashed #1F3A2E; border-radius: 14px;
              padding: 18px 22px; margin-bottom: 12mm; text-align: center; }
  .link-label { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
                color: #888; font-weight: 700; margin-bottom: 6px; }
  .link-url { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 13px;
              color: #1F3A2E; font-weight: 600; word-break: break-all; line-height: 1.4; }
  .link-cta { display: inline-block; margin-top: 12px; background: #C7F24A;
              color: #1F3A2E; padding: 8px 18px; border-radius: 8px;
              font-size: 12px; font-weight: 700; text-decoration: none; }
  .steps { background: white; border: 1px solid #E2DED3; border-radius: 14px;
           padding: 16px 22px; margin-bottom: 10mm; }
  .step { display: flex; gap: 12px; align-items: flex-start; margin: 8px 0; font-size: 12px; }
  .step-num { background: #1F3A2E; color: #C7F24A; width: 22px; height: 22px;
              border-radius: 50%; display: grid; place-items: center;
              font-weight: 700; font-size: 11px; flex-shrink: 0; }
  .footer { margin-top: auto; padding-top: 14mm; border-top: 1px solid #DDD8CB;
            display: flex; justify-content: space-between; align-items: flex-end;
            font-size: 10px; color: #666; }
  .footer-brand { display: flex; align-items: center; gap: 8px; }
  .footer-brand strong { color: #1F3A2E; font-size: 12px; }
  .footer-info { text-align: right; line-height: 1.6; }
  .footer-info b { color: #1F3A2E; font-weight: 700; }
  .private-note { font-size: 10px; color: #888; text-align: center; margin: 6mm 0 0 0;
                  font-style: italic; }
</style>
</head>
<body>
  <div class="page">

    <div class="top">
      <img class="mascot" src="${VOLTIS_INFO.app_url}/mascota-transparente.png" alt="" />
      <div>
        <div class="brand-tag">Voltis Energía</div>
        <h1 class="headline">Tu informe energético,<br/>siempre disponible.</h1>
      </div>
    </div>

    <div class="client-card">
      <div class="client-label">Tu portal privado</div>
      <div class="client-name">${escapeHtml(args.clientName)}</div>
    </div>

    <div class="section-title">¿Qué encontrarás dentro?</div>
    <div class="benefits">
      <div class="benefit">
        <div class="benefit-icon">⚡</div>
        <div class="benefit-title">Resumen anual</div>
        <div class="benefit-desc">Cuánto pagas, dónde, y cómo evoluciona mes a mes.</div>
      </div>
      <div class="benefit">
        <div class="benefit-icon">📍</div>
        <div class="benefit-title">Detalle por suministro</div>
        <div class="benefit-desc">Consumo, potencias, precios y conceptos de cada factura.</div>
      </div>
      <div class="benefit">
        <div class="benefit-icon">📊</div>
        <div class="benefit-title">Descargas Excel</div>
        <div class="benefit-desc">Para tu contabilidad o para auditar internamente.</div>
      </div>
    </div>

    <div class="link-box">
      <div class="link-label">Tu enlace de acceso</div>
      <div class="link-url">${url}</div>
      <a href="${url}" class="link-cta">Abrir mi portal</a>
    </div>

    <div class="section-title">Guárdalo como marcador en Chrome</div>
    <div class="steps">
      <div class="step"><div class="step-num">1</div>
        <div>Abre el enlace en Google Chrome.</div></div>
      <div class="step"><div class="step-num">2</div>
        <div>Pulsa la <b>estrella</b> ⭐ junto a la barra de direcciones.</div></div>
      <div class="step"><div class="step-num">3</div>
        <div>Pulsa <b>Guardar</b>. Listo: tendrás acceso permanente desde tus marcadores.</div></div>
    </div>

    <p class="private-note">Tu enlace es privado y personal. No lo compartas con terceros.</p>

    <div class="footer">
      <div class="footer-brand">
        <strong>${VOLTIS_INFO.name}</strong>
      </div>
      <div class="footer-info">
        <b>${VOLTIS_INFO.phone}</b><br/>
        ${VOLTIS_INFO.email}<br/>
        ${addr}<br/>
        ${VOLTIS_INFO.website}
      </div>
    </div>

  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string))
}
