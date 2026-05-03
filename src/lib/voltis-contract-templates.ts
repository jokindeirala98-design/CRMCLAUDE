/**
 * voltis-contract-templates.ts
 * Genera HTML completo (idéntico al diseño original) para la propuesta (PRC, 4 pp.)
 * y el contrato de prestación de servicios (CSP, 6 pp.).
 *
 * Uso:
 *   const html = generatePropuestaHTML({ client, contract, feeAmount, endDate })
 *   const w = window.open('', '_blank')
 *   w!.document.write(html)
 *   w!.document.close()
 *   // El usuario pulsa Ctrl+P en la nueva ventana
 */

const BASE_CSS = `
:root{
  --paper:#fbfaf7;--ink:#1a1d1a;--ink-2:#3a3d3a;--ink-3:#6b6f6b;--ink-4:#a8aaa6;
  --rule:#d9d8d2;--rule-soft:#e8e7e1;
  --accent:oklch(0.50 0.10 235);--accent-soft:oklch(0.95 0.025 230);--accent-ink:oklch(0.34 0.09 235);
  --serif:'Fraunces',Georgia,serif;--sans:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e7e5df;color:var(--ink);font-family:var(--sans);font-size:12pt;line-height:1.55;-webkit-font-smoothing:antialiased}
.viewer{display:flex;flex-direction:column;align-items:center;gap:18px;padding:36px 16px 80px;min-height:100vh}
.page{width:210mm;height:297mm;min-height:297mm;background:var(--paper);box-shadow:0 1px 0 rgba(0,0,0,.04),0 24px 60px -28px rgba(20,25,20,.25),0 8px 16px -8px rgba(20,25,20,.10);position:relative;padding:18mm 20mm 16mm;display:flex;flex-direction:column;color:var(--ink);overflow:hidden}
.page-body{flex:1;display:flex;flex-direction:column}
.runhead{display:flex;align-items:center;justify-content:space-between;font-size:9pt;color:var(--ink-3);letter-spacing:.04em;padding-bottom:4mm;border-bottom:.5pt solid var(--rule-soft);margin-bottom:7mm}
.runhead .left{display:flex;align-items:center;gap:10px}
.brand{display:inline-flex;align-items:center;gap:8px;font-family:var(--serif);font-weight:500;font-size:11pt;color:var(--ink);letter-spacing:-.005em}
.brand-mark{width:18px;height:18px;border-radius:4px;background:var(--accent);position:relative;display:inline-block}
.brand-mark::before{content:"";position:absolute;inset:4px;background:var(--paper);clip-path:polygon(58% 0,0 58%,42% 58%,30% 100%,100% 38%,58% 38%)}
.runhead .right{color:var(--ink-3)}
.runfoot{margin-top:auto;padding-top:6mm;border-top:.5pt solid var(--rule-soft);display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:end;font-size:8.5pt;color:var(--ink-3)}
.runfoot .legal{line-height:1.5}.runfoot .legal b{color:var(--ink-2);font-weight:600}
.runfoot .pageno{font-family:var(--mono);font-size:9pt;color:var(--ink-2);white-space:nowrap}
.runfoot .pageno em{color:var(--ink-4);font-style:normal}
.runfoot .contact{text-align:right;line-height:1.5}
.cover{display:flex;flex-direction:column;gap:0;flex:1}
.cover-eyebrow{font-family:var(--mono);font-size:9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-ink);display:inline-flex;align-items:center;gap:10px;margin-bottom:14mm}
.cover-eyebrow::before{content:"";width:22px;height:1px;background:var(--accent)}
.cover h1{font-family:var(--serif);font-weight:400;font-size:42pt;line-height:1.04;letter-spacing:-.02em;color:var(--ink);text-wrap:balance}
.cover h1 em{font-style:italic;color:var(--accent-ink);font-weight:400}
.cover-sub{margin-top:10mm;font-size:11.5pt;line-height:1.5;color:var(--ink-2);max-width:135mm;text-wrap:pretty}
.cover-rule{height:.5pt;background:var(--rule);margin:18mm 0 12mm}
.section-title{font-family:var(--mono);font-size:9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6mm;display:flex;align-items:center;gap:10px}
.section-title::after{content:"";flex:1;height:.5pt;background:var(--rule-soft)}
.party-grid{display:grid;grid-template-columns:1fr;gap:8mm}
.party{display:grid;grid-template-columns:34mm 1fr;gap:8mm;padding:6mm 0;border-top:.5pt solid var(--rule-soft)}
.party:last-child{border-bottom:.5pt solid var(--rule-soft)}
.party-tag{font-family:var(--mono);font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);padding-top:3px}
.party-tag .role{color:var(--accent-ink);display:block;margin-top:2px;font-weight:500}
.party-body{font-size:11pt;line-height:1.65;color:var(--ink-2)}
.party-body strong{color:var(--ink);font-weight:600}
.party-body .alias{color:var(--ink-3);font-style:italic}
.cover-meta{margin-top:14mm;display:grid;grid-template-columns:1fr 1fr;gap:8mm;padding-top:8mm;border-top:.5pt solid var(--rule-soft)}
.cover-meta .field{display:flex;flex-direction:column;gap:4px}
.cover-meta .label{font-family:var(--mono);font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.cover-meta .value{font-family:var(--serif);font-size:14pt;color:var(--ink);border-bottom:.5pt solid var(--ink-4);padding-bottom:3mm}
.expone-list{display:flex;flex-direction:column;gap:5mm;margin-bottom:10mm}
.expone-item{display:grid;grid-template-columns:18mm 1fr;gap:6mm;font-size:11pt;line-height:1.6;color:var(--ink-2)}
.expone-item .ord{font-family:var(--serif);font-style:italic;font-size:11pt;color:var(--accent-ink);font-weight:500}
.bridge{font-size:11pt;line-height:1.65;color:var(--ink-2);padding:6mm 0;border-top:.5pt solid var(--rule-soft);border-bottom:.5pt solid var(--rule-soft);margin:4mm 0 12mm}
.clauses{display:flex;flex-direction:column;gap:6mm}
.clause{display:grid;grid-template-columns:34mm 1fr;gap:8mm;page-break-inside:avoid;break-inside:avoid}
.clause-num{display:flex;flex-direction:column;gap:2px;border-right:.5pt solid var(--rule-soft);padding-right:6mm}
.clause-num .kicker{font-family:var(--mono);font-size:8pt;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-4)}
.clause-num .ord{font-family:var(--serif);font-weight:300;font-size:26pt;line-height:1;letter-spacing:-.02em;color:var(--ink)}
.clause-num .ord em{font-style:italic;color:var(--accent-ink);font-weight:400}
.clause-body h2{font-family:var(--serif);font-weight:400;font-size:14pt;line-height:1.2;letter-spacing:-.005em;color:var(--ink);margin-bottom:4mm}
.clause-body p{font-size:10.5pt;line-height:1.5;color:var(--ink-2);margin-bottom:2.5mm;text-wrap:pretty}
.clause-body p:last-child{margin-bottom:0}
.clause-body strong{color:var(--ink);font-weight:600}
.clause-body em{color:var(--accent-ink);font-style:italic}
.blank{display:inline-block;min-width:24mm;border-bottom:.5pt solid var(--ink-4);padding:0 3px;color:var(--ink);text-align:center}
.blank.short{min-width:14mm}.blank.long{min-width:50mm}.blank.amt{min-width:24mm}
.cb-list{list-style:none;display:flex;flex-direction:column;gap:2.5mm;margin:2mm 0 0;padding:0}
.cb-list>li{display:flex;align-items:flex-start;gap:9px;font-size:10.5pt;line-height:1.5;color:var(--ink-2)}
.cb-list>li::before{content:"";flex:0 0 5px;width:5px;height:5px;border-radius:1px;background:var(--accent);margin-top:8px}
.cb-list>li>.li-body{flex:1;min-width:0}
.cb-sub{list-style:none;margin:2mm 0 0;padding:0;display:flex;flex-direction:column;gap:1.5mm}
.cb-sub>li{display:flex;align-items:flex-start;gap:7px;font-size:10.5pt;line-height:1.5;color:var(--ink-3)}
.cb-sub>li::before{content:"›";flex:0 0 auto;color:var(--ink-4);font-family:var(--serif);line-height:1.4}
.cb-sub>li>.li-body{flex:1;min-width:0}
.fees{margin:2mm 0 4mm;background:var(--accent-soft);border-radius:6px;padding:5mm 7mm;display:grid;grid-template-columns:1fr auto;gap:6mm;align-items:center;border:.5pt solid color-mix(in oklch,var(--accent) 20%,transparent)}
.fees .label{font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm}
.fees .desc{font-size:10.5pt;color:var(--ink-2);line-height:1.5}
.fees .figure{font-family:var(--serif);font-weight:300;font-size:28pt;line-height:1;color:var(--ink);white-space:nowrap}
.fees .figure .pct{font-size:18pt;color:var(--ink-3);margin-left:2mm;font-style:normal}
.oblig-grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:2mm}
.oblig-col h3{font-family:var(--mono);font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:4mm;padding-bottom:2.5mm;border-bottom:.5pt solid var(--rule-soft)}
.pay-row{display:grid;grid-template-columns:1fr;gap:3mm;border:.5pt solid var(--rule);border-radius:5px;padding:4mm 5mm;margin:2mm 0 3mm}
.pay-row .top{display:grid;grid-template-columns:1fr auto;gap:4mm;align-items:baseline}
.pay-row .top .amt{font-family:var(--serif);font-size:18pt;font-weight:400;color:var(--ink);white-space:nowrap}
.pay-row .top .amt .vat{font-size:10pt;color:var(--ink-3);font-family:var(--sans);font-weight:400}
.pay-row .top .desc{font-size:10.5pt;color:var(--ink-2);line-height:1.5}
.iban{font-family:var(--mono);font-size:10pt;color:var(--ink);background:#f1efe9;padding:2mm 3mm;border-radius:3px;display:inline-block;letter-spacing:.04em}
.callout{margin-top:3mm;padding:4mm 5mm;border-left:1.5pt solid var(--accent);background:#f5f3ec;border-radius:0 4px 4px 0}
.callout .label{font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:3mm}
.callout .row{display:grid;grid-template-columns:18mm 1fr;gap:5mm;font-size:10.5pt;line-height:1.55;color:var(--ink-2);margin-bottom:2mm}
.callout .row:last-child{margin-bottom:0}
.callout .row .tag{font-family:var(--mono);font-size:8.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding-top:2pt}
.callout .row .tag.up{color:oklch(0.48 0.16 145)}.callout .row .tag.down{color:oklch(0.50 0.13 30)}
.signing-intro{text-align:center;font-family:var(--serif);font-style:italic;font-size:13pt;color:var(--ink-2);margin:6mm 0 3mm}
.signing-sub{text-align:center;font-size:10pt;color:var(--ink-3);max-width:130mm;margin:0 auto 8mm;line-height:1.45}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:12mm;margin-top:2mm}
.sig{display:flex;flex-direction:column}
.sig .role{font-family:var(--mono);font-size:8.5pt;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:3mm}
.sig .box{height:30mm;border:.5pt dashed var(--ink-4);border-radius:4px;background:repeating-linear-gradient(45deg,transparent 0 8px,rgba(0,0,0,.015) 8px 16px);margin-bottom:3mm;display:flex;align-items:flex-end;padding:3mm 4mm;font-family:var(--mono);font-size:7.5pt;color:var(--ink-4);letter-spacing:.1em;text-transform:uppercase}
.sig .name{font-family:var(--serif);font-size:13pt;color:var(--ink);font-weight:500}
.sig .id{font-size:9.5pt;color:var(--ink-3);margin-top:1mm}
.anchor{font-family:var(--mono);font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-4)}
@media print{html,body{background:#fff}.viewer{padding:0;gap:0}.page{box-shadow:none;width:210mm;min-height:297mm;height:297mm;page-break-after:always;margin:0}.page:last-child{page-break-after:auto}@page{size:A4;margin:0}}
`

const GOOGLE_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />`

const FOOTER = (left: string, page: number, total: number) => `
<div class="runfoot">
  <div class="legal"><b>Voltis Soluciones S.L.</b> · CIF B71548705<br/>C/ Berriobide 38, Of. 209 · Ansoáin (Navarra)</div>
  <div class="pageno">0${page}<em> / 0${total}</em></div>
  <div class="contact">voltisenergia.com<br/>clientes@voltisenergia.com · 747 474 360</div>
</div>`

const RUNHEAD = (right: string, anchor?: string) => `
<div class="runhead">
  <div class="left">
    <span class="brand"><span class="brand-mark"></span>Voltis Energía</span>
    ${anchor ? `<span style="opacity:.5">·</span><span class="anchor">${anchor}</span>` : ''}
  </div>
  <div class="right">${right}</div>
</div>`

function fmtCurrency(n: number) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function fmtDateLong(d: Date) {
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function addMonths(d: Date, m: number) {
  const r = new Date(d); r.setMonth(r.getMonth() + m); return r
}

// ─── PROPUESTA (4 páginas) ────────────────────────────────────────────────────

export interface PropuestaData {
  clientName: string
  representativeName: string
  ahorroConfirmado: number | null
  feeAmount: number
  startDate: Date
  endDate: Date
  contractType: 'porcentaje' | 'suscripcion'
  year?: number
}

export function generatePropuestaHTML(d: PropuestaData): string {
  const year = d.year ?? new Date().getFullYear()
  const endDateStr = fmtDateLong(d.endDate)
  const ahorroStr = d.ahorroConfirmado ? fmtCurrency(d.ahorroConfirmado) : '—'
  const minutaStr = d.contractType === 'porcentaje'
    ? `${fmtCurrency(d.feeAmount)} € + IVA`
    : `${fmtCurrency(19.99)}/mes + IVA`

  const page1 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year} · v1.0`)}
      <div class="cover">
        <div class="cover-eyebrow">Propuesta de colaboración</div>
        <h1>Asesoría energética<br/><em>integral</em></h1>
        <p class="cover-sub">Una propuesta a medida para optimizar el coste energético y dar el primer paso hacia un <strong>Sistema de Gestión Energética</strong>.</p>
        <div class="cover-rule"></div>
        <div class="section-title">Dirigida a</div>
        <div class="party-grid">
          <div class="party">
            <div class="party-tag">Cliente<span class="role">Razón social</span></div>
            <div class="party-body"><strong>${d.clientName}</strong></div>
          </div>
        </div>
        <p style="margin-top:8mm;font-size:11pt;line-height:1.6;color:var(--ink-2)">Apreciado/a <strong>${d.representativeName || d.clientName}</strong>,</p>
        <p style="margin-top:3mm;font-size:11pt;line-height:1.6;color:var(--ink-2)">En relación con nuestra última reunión, le adjunto a continuación el detalle de la propuesta de colaboración entre <strong>Voltis Energía</strong> y su empresa.</p>
        <div style="margin-top:8mm">
          <div class="section-title">Objetivo del estudio</div>
          <div class="fees">
            <div>
              <div class="label">Ahorro estimado</div>
              <div class="desc">El presente estudio significará, con total seguridad, un ahorro aproximado en el cómputo total de la facturación de energía de la empresa.</div>
            </div>
            <div class="figure"><strong>${d.ahorroConfirmado ? fmtCurrency(d.ahorroConfirmado) : '—'}</strong><span class="pct">€/año</span></div>
          </div>
          <p style="font-size:10.5pt;line-height:1.5;color:var(--ink-2);margin-top:3mm">Además, este estudio resulta <strong>imprescindible</strong> como punto de partida para la implantación futura de un <em>Sistema de Gestión Energética (SGE)</em>. A continuación se detalla el alcance del estudio y las áreas de trabajo concretas.</p>
        </div>
      </div>
      ${FOOTER('', 1, 4)}
    </div>
  </article>`

  const page2 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year}`, 'Propuesta de colaboración')}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>01</em></div></div>
          <div class="clause-body" style="font-size:10pt">
            <h2>Revisión energética</h2>
            <p style="font-size:10pt;margin-bottom:2mm">Estado actual de los suministros eléctricos de <strong>${d.clientName}</strong>.</p>
            <div style="display:flex;flex-direction:column;gap:2mm;margin-top:2mm">
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">A · Optimización de las potencias contratadas</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Ajuste de las potencias contratadas en cada suministro eléctrico en función de las potencias realmente demandadas por las instalaciones e infraestructuras del cliente.</p>
                <ul class="cb-list" style="margin-top:1.5mm"><li><span class="li-body">Tarifas <strong>.TD</strong> · revisión de las demandas reales registradas por los contadores eléctricos a través de la página de la distribuidora, ajustadas mediante nuestro software especializado.</span></li></ul>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">B · Mejora del desempeño energético</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Identificación de oportunidades para la mejora del desempeño energético y de posibles desviaciones de consumo, teniendo en cuenta el patrón habitual en función del uso y comparando con suministros de características similares.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">C · Revisión de tarifas de acceso</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Comprobación de que las tarifas de acceso son las apropiadas en cada caso, atendiendo a los consumos reales. Se incluye propuesta de eliminación de posibles penalizaciones detectadas, especialmente en <em>energía reactiva</em>.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">D · Condiciones económicas y estrategia de compra</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Revisión de las condiciones económicas del suministro y, si procede, definición de una estrategia de compra de energía para los próximos meses.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">E · Áreas de uso significativo de energía</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Identificación de las áreas de uso significativo de energía y de consumo, para valorar su posterior medición y control:</p>
                <div class="oblig-grid" style="margin-top:2mm">
                  <div class="oblig-col"><h3>Sustitución de contadores</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Presupuesto para la sustitución de contadores eléctricos en régimen de alquiler por contadores de altas prestaciones en propiedad.</p></div>
                  <div class="oblig-col"><h3>Medidores específicos</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Presupuesto para la instalación de medidores en edificios, plantas fotovoltaicas, líneas o máquinas concretas.</p></div>
                </div>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">F · Reuniones semestrales</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Reuniones semestrales con los miembros responsables de la planificación energética, con el objetivo de recabar las aportaciones derivadas de la observación directa del entorno y de los procesos del día a día.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">G · Verificación de KPIs económicos</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Reunión semestral para verificar que los KPIs económicos se estén cumpliendo según lo estipulado.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">H · Revisión de suministros y empleados</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Revisión de hasta <strong>10 suministros</strong> y contrataciones de los empleados de <strong>${d.clientName}</strong>.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
      ${FOOTER('', 2, 4)}
    </div>
  </article>`

  const page3 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year}`, 'Propuesta de colaboración')}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>02</em></div></div>
          <div class="clause-body">
            <h2>Revisión de propuestas de terceros</h2>
            <p>Análisis y revisión de las propuestas hechas por terceros a <strong>${d.clientName}</strong> en materia de mejoras de eficiencia energética: instalaciones de techos solares, tecnología <strong>LED</strong>, sistemas de gestión energética, y cualquier otra iniciativa relacionada con el ahorro y la eficiencia.</p>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>03</em></div></div>
          <div class="clause-body">
            <h2>Duración del contrato y honorarios</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:1mm">
              <div class="pay-row" style="margin:0">
                <div class="top" style="grid-template-columns:1fr;gap:2mm">
                  <div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)">Duración del contrato</div>
                  <div class="amt" style="font-family:var(--serif);font-size:13pt;white-space:normal;line-height:1.3">Hasta el ${endDateStr}</div>
                </div>
                <div style="font-size:9.5pt;color:var(--ink-3);line-height:1.45">Vigencia desde la firma de la propuesta por parte del cliente. La forma de pago y las condiciones quedan recogidas en el contrato adjunto.</div>
              </div>
              <div class="fees" style="margin:0;padding:5mm 6mm;display:flex;flex-direction:column;gap:3mm;align-items:flex-start;border-radius:5px">
                <div>
                  <div class="label">Minuta anual</div>
                  <div class="desc" style="font-size:9.5pt;margin-top:1mm">Honorarios anuales por los servicios profesionales descritos. Aplicables desde el momento en que se reciba la propuesta firmada.</div>
                </div>
                <div class="figure" style="font-size:22pt;line-height:1.1">${minutaStr}</div>
              </div>
            </div>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>04</em></div></div>
          <div class="clause-body">
            <h2>Otros servicios complementarios</h2>
            <p>Le ponemos en su conocimiento otros aspectos en los que puede contar con nosotros siempre que lo estime oportuno:</p>
            <div class="oblig-grid" style="margin-top:2mm">
              <div class="oblig-col"><h3>Gestión energética avanzada</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Ayuda y soporte en la gestión energética de las instalaciones y equipamientos consumidores de energía.</p></div>
              <div class="oblig-col"><h3>Energías renovables</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Presupuestos y análisis de proyectos de implantación de energías renovables en las instalaciones.</p></div>
              <div class="oblig-col" style="margin-top:3mm"><h3>Normativa y certificaciones</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Implantación de normativa energética: auditorías y certificación energética de edificios.</p></div>
              <div class="oblig-col" style="margin-top:3mm"><h3>Captación de fondos</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Ayuda y soporte para la captación de fondos destinados a proyectos e inversiones en eficiencia energética.</p></div>
            </div>
          </div>
        </section>
      </div>
      ${FOOTER('', 3, 4)}
    </div>
  </article>`

  const page4 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year}`, 'Propuesta de colaboración')}
      <div class="cover" style="flex:none">
        <div class="cover-eyebrow" style="margin-bottom:8mm">A su disposición</div>
        <h1 style="font-size:30pt">Quedamos a<br/>su <em>disposición</em></h1>
        <p class="cover-sub" style="margin-top:6mm">Estaremos encantados de resolver cualquier duda que pudiera surgirle sobre el alcance de esta propuesta o sobre cómo implementarla en su empresa. No dude en contactar con nosotros a través de cualquiera de los canales habituales.</p>
        <div style="margin-top:10mm;display:grid;grid-template-columns:repeat(3,1fr);gap:6mm">
          <div class="pay-row" style="margin:0"><div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm">Email</div><div style="font-family:var(--serif);font-size:13pt;color:var(--ink)">clientes@voltisenergia.com</div></div>
          <div class="pay-row" style="margin:0"><div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm">Teléfono</div><div style="font-family:var(--serif);font-size:13pt;color:var(--ink)">747 474 360</div></div>
          <div class="pay-row" style="margin:0"><div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm">Web</div><div style="font-family:var(--serif);font-size:13pt;color:var(--ink)">voltisenergia.com</div></div>
        </div>
      </div>
      <div style="margin-top:14mm">
        <div class="section-title">Aceptación de la propuesta</div>
        <p style="font-size:10.5pt;line-height:1.5;color:var(--ink-2);margin-bottom:6mm">Conforme con el alcance, condiciones y honorarios descritos en esta propuesta, ambas partes firman a continuación.</p>
        <div class="sigs">
          <div class="sig">
            <div class="role">El Cliente</div>
            <div class="box">Firma y sello</div>
            <div class="name" style="border-bottom:.5pt solid var(--ink-3);min-height:1.2em;margin-bottom:3mm"></div>
            <div class="id">D./Dña. ${d.representativeName || '____________________________'}</div>
          </div>
          <div class="sig">
            <div class="role">El Asesor</div>
            <div class="box">Firma y sello</div>
            <div class="name">Voltis Soluciones S.L.</div>
            <div class="id">D. Nicolás Imízcoz García</div>
          </div>
        </div>
      </div>
      ${FOOTER('', 4, 4)}
    </div>
  </article>`

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Propuesta de colaboración — ${d.clientName}</title>${GOOGLE_FONTS}<style>${BASE_CSS}</style></head><body><div class="viewer">${page1}${page2}${page3}${page4}</div></body></html>`
}

// ─── CONTRATO (6 páginas) ─────────────────────────────────────────────────────

export interface PaymentScheduleItem { label: string; date: Date; amount: number }

export interface ContratoData {
  clientName: string
  clientCif: string
  clientFiscalAddress: string
  representativeName: string
  representativeNif: string
  signingLocation: string
  startDate: Date
  endDate: Date
  firstPaymentDate: Date
  ahorroConfirmado: number | null
  feeAmount: number
  contractType: 'porcentaje' | 'suscripcion'
  paymentModality: 'A' | 'B' | 'C' | 'D'
  paymentSchedule: PaymentScheduleItem[]
  year?: number
}

function buildClausulaV(d: ContratoData): string {
  const iban = 'ES19&nbsp;&nbsp;0182&nbsp;&nbsp;5000&nbsp;&nbsp;8402&nbsp;&nbsp;0187&nbsp;&nbsp;5295'
  const fmtItem = (item: PaymentScheduleItem) => `
    <div class="pay-row">
      <div class="top">
        <div class="desc"><strong>${item.label}</strong> — al ${fmtDateLong(item.date)}</div>
        <div class="amt">${fmtCurrency(item.amount)}<span class="vat"> + IVA</span></div>
      </div>
    </div>`

  switch (d.paymentModality) {
    case 'A': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada en la cláusula anterior de la forma siguiente:</p>
      <div class="pay-row">
        <div class="top">
          <div class="desc">Pago único mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</div>
          <div class="amt">${fmtCurrency(d.feeAmount)}<span class="vat"> + IVA</span></div>
        </div>
        <div><span class="iban">${iban}</span></div>
      </div>
      <ul class="cb-list"><li><span class="li-body">Se facilitará una factura anualmente por parte del <strong>Asesor</strong> hacia el <strong>Cliente</strong> para hacer efectivo el ingreso por los servicios prestados.</span></li></ul>
      <div class="callout">
        <div class="label">Regularización al cierre del periodo anual</div>
        <div class="row"><span class="tag up">+ Ahorro</span><span>Si el ahorro real obtenido <strong>supera</strong> el estimado, el <strong>Asesor</strong> podrá emitir factura al <strong>Cliente</strong> por el <strong>25%</strong> de la diferencia positiva.</span></div>
        <div class="row"><span class="tag down">– Ahorro</span><span>Si el ahorro real obtenido es <strong>inferior</strong> al estimado, el <strong>Cliente</strong> podrá solicitar la regularización. El <strong>Asesor</strong> emitirá factura rectificativa ajustando los honorarios.</span></div>
      </div>`

    case 'B': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada en cuatro (4) cuotas trimestrales iguales, abonadas al vencimiento de cada trimestre, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</p>
      <div style="margin:2mm 0 3mm"><span class="iban">${iban}</span></div>
      ${d.paymentSchedule.map(fmtItem).join('')}`

    case 'C': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada de la siguiente forma: el 50% a la firma del contrato y el resto en cuatro (4) cuotas trimestrales, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</p>
      <div style="margin:2mm 0 3mm"><span class="iban">${iban}</span></div>
      ${d.paymentSchedule.map(fmtItem).join('')}`

    case 'D': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada en un único pago al vencimiento del contrato, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</p>
      <div class="pay-row">
        <div class="top">
          <div class="desc">Pago único al vencimiento — ${fmtDateLong(d.paymentSchedule[0]?.date ?? d.endDate)}<br/><span class="iban" style="margin-top:2mm;display:inline-block">${iban}</span></div>
          <div class="amt">${fmtCurrency(d.feeAmount)}<span class="vat"> + IVA</span></div>
        </div>
      </div>`
  }
}

export function generateContratoHTML(d: ContratoData): string {
  const year = d.year ?? new Date().getFullYear()
  const today = new Date()
  const todayStr = fmtDateLong(today)
  const startStr = fmtDateLong(d.startDate)
  const firstPayStr = fmtDateLong(d.firstPaymentDate)
  const anchor = 'Contrato de prestación de servicios profesionales'

  const page1 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year} · v1.0`)}
      <div class="cover">
        <div class="cover-eyebrow">Contrato profesional</div>
        <h1>Contrato de prestación<br/>de servicios <em>profesionales</em></h1>
        <p class="cover-sub">Servicios de asesoría y consultoría energética prestados por <strong>Voltis Soluciones&nbsp;S.L.</strong></p>
        <div class="cover-rule"></div>
        <div class="section-title">Reunidos</div>
        <div class="party-grid">
          <div class="party">
            <div class="party-tag">De una parte<span class="role">El cliente</span></div>
            <div class="party-body">Don/Doña <strong>${d.representativeName}</strong>, mayor de edad, con DNI <strong>${d.representativeNif || '___________'}</strong>, en nombre y representación de <strong>${d.clientName}</strong>, con CIF <strong>${d.clientCif || '___________'}</strong> y domicilio en <strong>${d.clientFiscalAddress || '________________________________'}</strong> <span class="alias">(en adelante «el Cliente»).</span></div>
          </div>
          <div class="party">
            <div class="party-tag">De otra parte<span class="role">El asesor</span></div>
            <div class="party-body">Don <strong>Nicolás Imízcoz García</strong>, mayor de edad, con DNI <strong>73464830R</strong>, en nombre y representación de <strong>Voltis Soluciones S.L.</strong>, con CIF <strong>B71548705</strong> y domicilio en Calle Berriobide&nbsp;38, Of.&nbsp;209, Ansoáin (Navarra)&nbsp;31013 <span class="alias">(en adelante «el Asesor»).</span></div>
          </div>
        </div>
        <div class="cover-meta">
          <div class="field"><div class="label">Lugar de formalización</div><div class="value">${d.signingLocation || '________________________'}</div></div>
          <div class="field"><div class="label">Fecha</div><div class="value">${todayStr}</div></div>
        </div>
      </div>
      ${FOOTER('', 1, 6)}
    </div>
  </article>`

  const page2 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="section-title">Exponen</div>
      <div class="expone-list">
        <div class="expone-item"><span class="ord">Primero.</span><p>Que el <strong>Asesor</strong> está especializado en la prestación de servicios de asesoría y consultoría energética.</p></div>
        <div class="expone-item"><span class="ord">Segundo.</span><p>Que el <strong>Cliente</strong> requiere sus servicios profesionales, que serán concretados en la estipulación <strong>Primera</strong> de este contrato.</p></div>
      </div>
      <p class="bridge">Ambas partes se reconocen mutuamente suficiente capacidad jurídica y de obrar para el otorgamiento del presente contrato, a cuyo efecto acuerdan las siguientes <em>cláusulas</em>.</p>
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>I</em></div></div>
          <div class="clause-body">
            <h2>Objeto del contrato y funciones a desarrollar</h2>
            <p>El <strong>Asesor</strong> se compromete a prestar auxilio y consejo al <strong>Cliente</strong> en las materias siguientes:</p>
            <ul class="cb-list"><li><span class="li-body">Todo lo referido en la <em>«Propuesta de colaboración Voltis Energía — ${d.clientName}»</em>, presentada y aceptada el ${startStr}, la cual se incluye como <strong>Anexo&nbsp;I</strong>.</span></li></ul>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>II</em></div></div>
          <div class="clause-body"><h2>Duración del contrato</h2><p>Las partes acuerdan que el contrato tendrá una duración de <strong>doce&nbsp;(12) meses</strong>.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>III</em></div></div>
          <div class="clause-body"><h2>Fecha de inicio de los servicios</h2><p>La fecha de inicio de los servicios prestados por el <strong>Asesor</strong> comenzó el día <strong>${startStr}</strong>, y su consiguiente pago será el día <strong>${firstPayStr}</strong>.</p></div>
        </section>
      </div>
      ${FOOTER('', 2, 6)}
    </div>
  </article>`

  const honorariosDesc = d.contractType === 'porcentaje'
    ? `<p>Tomando como referencia el ahorro estimado recogido en la <em>«Propuesta de colaboración Voltis Energía — ${d.clientName}»</em> (Anexo&nbsp;I), los honorarios correspondientes al primer año de servicio ascienden a <strong>${fmtCurrency(d.feeAmount)} más IVA</strong>, importe equivalente al <strong>25%</strong> del ahorro estimado.</p><p>Este importe será facturado al <strong>Cliente</strong> conforme a lo establecido en la cláusula <strong>Quinta</strong> del presente contrato, quedando sujeto a regularización al finalizar el periodo anual en función del ahorro real obtenido.</p>`
    : `<p>Los honorarios por el servicio de suscripción ascienden a <strong>19,99 € más IVA mensuales</strong>, lo que representa <strong>${fmtCurrency(19.99 * 12)} más IVA</strong> anuales, facturados conforme a la cláusula <strong>Quinta</strong>.</p>`

  const page3 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>IV</em></div></div>
          <div class="clause-body">
            <h2>Honorarios</h2>
            <div class="fees">
              <div>
                <div class="label">${d.contractType === 'porcentaje' ? 'Porcentaje sobre ahorro' : 'Cuota mensual fija'}</div>
                <div class="desc">Del ahorro económico anual obtenido por el <strong>Cliente</strong> como consecuencia de los servicios de asesoría energética prestados.</div>
              </div>
              <div class="figure">${d.contractType === 'porcentaje' ? '<strong>25</strong><span class="pct">%</span>' : '<strong>19,99</strong><span class="pct">€/mes</span>'}</div>
            </div>
            ${honorariosDesc}
            <p>En caso de prórroga del contrato, las partes podrán acordar la revisión de los honorarios con una antelación mínima de un&nbsp;(1)&nbsp;mes respecto a la finalización del periodo contractual.</p>
          </div>
        </section>
      </div>
      ${FOOTER('', 3, 6)}
    </div>
  </article>`

  const page4 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>V</em></div></div>
          <div class="clause-body">
            <h2>Forma de pago</h2>
            ${buildClausulaV(d)}
          </div>
        </section>
      </div>
      ${FOOTER('', 4, 6)}
    </div>
  </article>`

  const page5 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>VI</em></div></div>
          <div class="clause-body">
            <h2>Obligaciones de las partes</h2>
            <div class="oblig-grid">
              <div class="oblig-col"><h3>Obligaciones del Asesor</h3><ul class="cb-list"><li><span class="li-body">Prestar sus servicios de forma diligente.</span></li><li><span class="li-body">Presentar los documentos correspondientes en tiempo y forma ante el equipo de la empresa.</span></li><li><span class="li-body">Asesorar e informar periódicamente al <strong>Cliente</strong> de todos aquellos aspectos relacionados con sus asuntos.</span></li></ul></div>
              <div class="oblig-col"><h3>Obligaciones del Cliente</h3><ul class="cb-list"><li><span class="li-body">Presentar los documentos que correspondan para la correcta prestación del servicio.</span></li><li><span class="li-body">Asistir a las reuniones y visitas necesarias para el asesoramiento.</span></li><li><span class="li-body">El pago de los servicios prestados con las condiciones acordadas en las cláusulas <strong>Cuarta</strong> y <strong>Quinta</strong> de este contrato.</span></li></ul></div>
            </div>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>VII</em></div></div>
          <div class="clause-body"><h2>Información periódica al Cliente</h2><p>El <strong>Asesor</strong> y el <strong>Cliente</strong> se comprometen a mantener un mínimo de <strong>dos&nbsp;(2) reuniones anuales</strong> con el objeto de informarse mutuamente o de entregar los documentos que procedan para la prestación de los servicios por parte del <strong>Asesor</strong>.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>VIII</em></div></div>
          <div class="clause-body">
            <h2>Resolución del contrato</h2>
            <p>El presente contrato podrá ser resuelto:</p>
            <ul class="cb-list">
              <li><span class="li-body">Por <strong>acuerdo de las partes</strong>, mediante notificación fehaciente por escrito a la otra parte, y siempre que medie un preaviso mínimo de <strong>un&nbsp;(1) mes</strong>.</span></li>
              <li><span class="li-body">De forma <strong>unilateral</strong>, cuando concurra alguna de las siguientes causas:<ul class="cb-sub"><li><span class="li-body">Incumplimiento de las obligaciones especificadas en el contrato.</span></li><li><span class="li-body">Declaración de situación de concurso del <strong>Cliente</strong> o del <strong>Asesor</strong>, o situaciones análogas que impliquen el fin de la relación contractual.</span></li></ul></span></li>
            </ul>
          </div>
        </section>
      </div>
      ${FOOTER('', 5, 6)}
    </div>
  </article>`

  const page6 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>IX</em></div></div>
          <div class="clause-body"><h2>Protección de datos</h2><p>El <strong>Cliente</strong> se muestra conforme con la inclusión de sus datos personales en los ficheros del <strong>Asesor</strong>.</p><p>El <strong>Cliente</strong> puede solicitar en cualquier momento el acceso, rectificación, cancelación u oposición de sus datos al <strong>Asesor</strong>.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>X</em></div></div>
          <div class="clause-body"><h2>Confidencialidad</h2><p>El <strong>Asesor</strong> se compromete a mantener la confidencialidad acerca de los datos e informaciones que el <strong>Cliente</strong> le haya facilitado para la ejecución de los servicios de asesoría encomendados, salvo que deban ser divulgadas por imperativo legal.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>XI</em></div></div>
          <div class="clause-body"><h2>Sumisión a tribunales</h2><p>Las partes acuerdan que para las discrepancias que pudieran surgir en la interpretación, ejecución o aplicación de esta hoja de encargo, se someten expresamente a los <strong>Juzgados y Tribunales de Pamplona</strong> y renuncian de forma expresa a cualquier otro fuero o jurisdicción que pudiera serles de aplicación.</p></div>
        </section>
      </div>
      <div style="margin-top:6mm">
        <div class="signing-intro">— En prueba de conformidad —</div>
        <p class="signing-sub">Los comparecientes firman, en el lugar y fecha que figuran en el encabezamiento del presente contrato.</p>
        <div class="sigs">
          <div class="sig">
            <div class="role">El Cliente</div>
            <div class="box">Firma y sello</div>
            <div class="name" style="border-bottom:.5pt solid var(--ink-3);min-height:1.2em;margin-bottom:3mm"></div>
            <div class="id">D./Dña. ${d.representativeName || '____________________________'}</div>
          </div>
          <div class="sig">
            <div class="role">El Asesor</div>
            <div class="box">Firma y sello</div>
            <div class="name">Voltis Soluciones S.L.</div>
            <div class="id">D. Nicolás Imízcoz García</div>
          </div>
        </div>
      </div>
      ${FOOTER('', 6, 6)}
    </div>
  </article>`

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Contrato de servicios — ${d.clientName}</title>${GOOGLE_FONTS}<style>${BASE_CSS}</style></head><body><div class="viewer">${page1}${page2}${page3}${page4}${page5}${page6}</div></body></html>`
}

/** Abre el HTML en una nueva ventana lista para imprimir como PDF */
export function openInNewWindow(html: string) {
  const w = window.open('', '_blank')
  if (!w) { alert('Activa las ventanas emergentes para este sitio'); return }
  w.document.write(html)
  w.document.close()
}
