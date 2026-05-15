/**
 * HTML del dossier para impresión a PDF Voltis.
 *
 * Estética editorial minimalista — sin emojis, sin watermarks, tipografía
 * "Instrument Serif" para titulares + "Inter" para texto. Imagen embebida
 * en base64 para que funcione tanto online como offline.
 */
import fs from 'fs'
import path from 'path'
import { VOLTIS_INFO, voltisPortalUrl, voltisFullAddress } from './voltis-info'

let MASCOT_B64_CACHE: string | null = null
function mascotBase64(): string {
  if (MASCOT_B64_CACHE) return MASCOT_B64_CACHE
  try {
    const filePath = path.join(process.cwd(), 'public', 'mascota-transparente.png')
    const buf = fs.readFileSync(filePath)
    MASCOT_B64_CACHE = `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    MASCOT_B64_CACHE = ''
  }
  return MASCOT_B64_CACHE
}

export function buildDossierHtml(args: {
  clientName: string
  token: string
}): string {
  const url = voltisPortalUrl(args.token)
  const addr = voltisFullAddress()
  const mascot = mascotBase64()

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Voltis · ${escapeHtml(args.clientName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #FBF8F1; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: #1E2522;
    line-height: 1.5;
    font-size: 11pt;
  }

  /* ── Page ─────────────────────────────────────────────────── */
  .page {
    width: 210mm;
    height: 297mm;
    padding: 18mm 18mm 14mm 18mm;
    position: relative;
    background: #FBF8F1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Decorativo: línea lima superior */
  .top-rule {
    position: absolute; top: 0; left: 0; right: 0;
    height: 4px; background: #C7F24A;
  }

  /* ── Header ───────────────────────────────────────────────── */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12mm;
  }
  .header-brand { display: flex; align-items: center; gap: 10px; }
  .header-brand-name {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 22pt; color: #1F3A2E; letter-spacing: -0.01em;
    line-height: 1;
  }
  .header-brand-tag {
    font-size: 7.5pt; letter-spacing: 0.18em; text-transform: uppercase;
    color: #6E7A72; font-weight: 500; margin-top: 2px;
  }
  .header-doc {
    font-size: 8pt; letter-spacing: 0.16em; text-transform: uppercase;
    color: #6E7A72; font-weight: 600; text-align: right;
  }

  /* ── Hero ────────────────────────────────────────────────── */
  .hero {
    display: grid; grid-template-columns: 1fr auto; gap: 32px;
    align-items: center; margin-bottom: 16mm;
    padding: 12mm 0; border-top: 1px solid #E2DCC9;
    border-bottom: 1px solid #E2DCC9;
  }
  .hero-eyebrow {
    font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase;
    color: #1F3A2E; font-weight: 700; margin-bottom: 14px;
  }
  .hero-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 38pt; color: #1F3A2E; line-height: 1.05;
    letter-spacing: -0.02em; margin: 0 0 12px 0;
    font-weight: 400;
  }
  .hero-title em { font-style: italic; color: #1F3A2E; }
  .hero-sub {
    font-size: 11pt; color: #4A5852; line-height: 1.55;
    max-width: 320px;
  }
  .hero-mascot {
    width: 110px; height: auto; opacity: 0.95;
    filter: drop-shadow(0 6px 18px rgba(31,58,46,0.12));
  }

  /* ── Cliente / Acceso ────────────────────────────────────── */
  .access {
    display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 14px;
    margin-bottom: 12mm;
  }
  .card {
    background: white; border: 1px solid #E2DCC9; border-radius: 14px;
    padding: 16px 18px;
  }
  .card-dark {
    background: #1F3A2E; color: #FBF8F1; border-color: #1F3A2E;
  }
  .label {
    font-size: 7pt; letter-spacing: 0.20em; text-transform: uppercase;
    font-weight: 700; opacity: 0.7;
  }
  .label-dark { color: #C7F24A; opacity: 0.85; }
  .client-name {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 19pt; line-height: 1.15;
    color: #FBF8F1; margin: 6px 0 0 0; font-weight: 400;
  }
  .url-monospace {
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 8.5pt; color: #1F3A2E; word-break: break-all;
    line-height: 1.45; margin: 8px 0 0 0; font-weight: 500;
  }
  .cta {
    display: inline-block; margin-top: 12px;
    background: #C7F24A; color: #1F3A2E;
    padding: 8px 16px; border-radius: 999px;
    font-size: 9pt; font-weight: 700; text-decoration: none;
    letter-spacing: 0.02em;
  }

  /* ── Contenido ───────────────────────────────────────────── */
  .section-title {
    font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase;
    color: #1F3A2E; font-weight: 700; margin: 0 0 10px 0;
  }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .feature {
    border-left: 2px solid #C7F24A; padding: 2px 0 2px 14px;
  }
  .feature-title {
    font-size: 10pt; font-weight: 700; color: #1F3A2E;
    margin: 0 0 4px 0;
  }
  .feature-desc {
    font-size: 9.5pt; color: #4A5852; line-height: 1.5; margin: 0;
  }

  /* ── Pasos ───────────────────────────────────────────────── */
  .steps {
    margin-top: 10mm;
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px;
  }
  .step {
    border-top: 1px solid #E2DCC9; padding-top: 10px;
  }
  .step-num {
    font-family: 'Instrument Serif', Georgia, serif;
    font-style: italic; font-size: 22pt; color: #1F3A2E;
    line-height: 1; margin-bottom: 6px;
  }
  .step-desc {
    font-size: 9.5pt; color: #4A5852; line-height: 1.5;
  }
  .step-desc b { color: #1F3A2E; font-weight: 600; }

  /* ── Footer ──────────────────────────────────────────────── */
  .footer {
    margin-top: auto; padding-top: 10mm;
    display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
    align-items: end; font-size: 8.5pt; color: #6E7A72;
    border-top: 1px solid #E2DCC9;
  }
  .footer-left { line-height: 1.6; }
  .footer-right {
    text-align: right; line-height: 1.6;
  }
  .footer b { color: #1F3A2E; font-weight: 600; }
  .footer-tag {
    font-size: 7pt; letter-spacing: 0.20em; text-transform: uppercase;
    color: #6E7A72; margin-bottom: 6px;
  }

  /* Watermark sutil */
  .signature {
    position: absolute; bottom: 6mm; left: 18mm; right: 18mm;
    font-size: 7pt; color: #B4ADA0;
    display: flex; justify-content: space-between;
    font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="top-rule"></div>

    <!-- Header -->
    <div class="header">
      <div class="header-brand">
        <div>
          <div class="header-brand-name">Voltis</div>
          <div class="header-brand-tag">Energía · Navarra</div>
        </div>
      </div>
      <div class="header-doc">
        Acceso al portal del cliente<br/>
        <span style="color:#9CA29D; font-weight:500">${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })}</span>
      </div>
    </div>

    <!-- Hero -->
    <div class="hero">
      <div>
        <div class="hero-eyebrow">Tu portal energético</div>
        <h1 class="hero-title">Tus datos <em>siempre</em><br/>contigo, sin esfuerzo.</h1>
        <p class="hero-sub">
          Consulta tu consumo, tu gasto y todas tus facturas desde un único enlace.
          Sin contraseña, sin app: sólo abrir y leer.
        </p>
      </div>
      ${mascot ? `<img class="hero-mascot" src="${mascot}" alt="" />` : ''}
    </div>

    <!-- Cliente + Acceso -->
    <div class="access">
      <div class="card card-dark">
        <div class="label label-dark">Tu portal privado</div>
        <div class="client-name">${escapeHtml(args.clientName)}</div>
        <div style="margin-top: 14px; font-size: 8.5pt; color: rgba(251,248,241,0.7); line-height: 1.5;">
          Un enlace propio para tu organización. Datos actualizados con cada nueva factura.
        </div>
      </div>
      <div class="card">
        <div class="label">Enlace de acceso</div>
        <div class="url-monospace">${url}</div>
        <a href="${url}" class="cta">Abrir portal</a>
      </div>
    </div>

    <!-- Qué encontrarás -->
    <div class="section-title">¿Qué encontrarás dentro?</div>
    <div class="grid-3">
      <div class="feature">
        <div class="feature-title">Resumen anual</div>
        <p class="feature-desc">Cuánto pagas en luz y gas, dónde se concentra el gasto, evolución mes a mes.</p>
      </div>
      <div class="feature">
        <div class="feature-title">Detalle por suministro</div>
        <p class="feature-desc">Consumo, potencias, precios y conceptos exactos de cada factura.</p>
      </div>
      <div class="feature">
        <div class="feature-title">Descargas Excel</div>
        <p class="feature-desc">Listo para tu contabilidad o para auditoría interna.</p>
      </div>
    </div>

    <!-- Pasos -->
    <div class="section-title" style="margin-top: 14mm;">Cómo guardarlo en tu navegador</div>
    <div class="steps">
      <div class="step">
        <div class="step-num">01</div>
        <div class="step-desc">Abre el enlace en <b>Google Chrome</b> o el navegador que prefieras.</div>
      </div>
      <div class="step">
        <div class="step-num">02</div>
        <div class="step-desc">Pulsa la <b>estrella</b> junto a la barra de direcciones para guardarlo.</div>
      </div>
      <div class="step">
        <div class="step-num">03</div>
        <div class="step-desc">Lo tendrás <b>siempre disponible</b> desde tus marcadores.</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-left">
        <div class="footer-tag">Tu asesor energético</div>
        <div><b>${VOLTIS_INFO.name}</b></div>
        <div>${addr}</div>
      </div>
      <div class="footer-right">
        <div class="footer-tag">Contacto</div>
        <div><b>${VOLTIS_INFO.phone}</b></div>
        <div>${VOLTIS_INFO.email}</div>
        <div>${VOLTIS_INFO.website}</div>
      </div>
    </div>

    <div class="signature">
      <span>Acceso privado y personal</span>
      <span>${VOLTIS_INFO.name.toUpperCase()}</span>
    </div>
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string))
}
