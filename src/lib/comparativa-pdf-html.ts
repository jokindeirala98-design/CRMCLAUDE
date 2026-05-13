/**
 * src/lib/comparativa-pdf-html.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Genera el HTML A4 print-ready de la comparativa Voltis para que Puppeteer lo
 * convierta a PDF con fidelidad píxel-perfect.
 *
 * Estilo editorial Voltis con CSS inline (cargar fuentes desde Google Fonts).
 * Layout en una sola "página continua" que Puppeteer pagina automáticamente
 * con saltos controlados por `page-break-inside: avoid` en las tarjetas.
 */
import type { ResultadoComparativa, ComparativaMes } from './comparativa-energetica'

interface BuildArgs {
  supply: {
    cups: string | null
    tariff: string | null
    type: string
    client_name: string | null
    comercializadora: string | null
  }
  comparativa: ResultadoComparativa
  mesesSeleccionados?: Set<string>
}

const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const fmt = (n: number | null | undefined, d = 2): string => {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
}
const fmtEur = (n: number | null | undefined, d = 2) => `${fmt(n, d)}&nbsp;€`

const esc = (s: string | null | undefined): string => {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Paleta editorial Voltis hardcoded para HTML inline
const COLORS = {
  bg: '#F4EEE2', bg2: '#EDE8DC', card: '#FBF7EE',
  ink: '#2D3A33', ink3: '#5A6B5F', ink4: '#8A9A8E',
  line: '#E5DCC9',
  brand: '#1F3A2E', brand2: '#2F5C47',
  volt: '#C7F24A', voltInk: '#1D2C0E',
  salvia: '#6B8068', salviaSoft: '#E0E8DC',
  durazno: '#E8B89A',
}

// ════════════════════════════════════════════════════════════════════════════
// CSS print-ready
// ════════════════════════════════════════════════════════════════════════════
function styles(): string {
  return `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: 'Geist', -apple-system, system-ui, sans-serif;
  font-size: 11px;
  line-height: 1.45;
  color: ${COLORS.ink};
  background: ${COLORS.bg};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  width: 210mm;
  min-height: 297mm;
  padding: 14mm 14mm 14mm 14mm;
  margin: 0 auto;
  background: ${COLORS.bg};
  position: relative;
}

.font-serif { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; }
.font-mono  { font-family: 'Geist Mono', monospace; }
.uppercase  { text-transform: uppercase; }
.tracking-wider { letter-spacing: 0.18em; }

/* ── Header ── */
.header {
  border-bottom: 1px solid ${COLORS.line};
  padding-bottom: 16px;
  margin-bottom: 24px;
}
.eyebrow {
  font-family: 'Geist Mono', monospace;
  font-size: 8px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: ${COLORS.salvia};
  margin-bottom: 8px;
}
.title {
  font-family: 'Instrument Serif', serif;
  font-size: 36pt;
  line-height: 1.05;
  color: ${COLORS.brand};
  margin-bottom: 10px;
}
.title em { font-style: italic; color: ${COLORS.ink3}; font-weight: 300; }
.subtitle { color: ${COLORS.ink3}; font-size: 10px; }
.subtitle span.bold { font-weight: 600; color: ${COLORS.ink}; }
.subtitle .sep { color: ${COLORS.ink4}; margin: 0 8px; }
.subtitle .mono { font-family: 'Geist Mono', monospace; font-size: 10px; }

/* ── KPIs ── */
.kpis { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 26px; }
.kpi-main {
  background: ${COLORS.brand};
  color: ${COLORS.volt};
  border-radius: 18px;
  padding: 22px 24px;
  position: relative; overflow: hidden;
}
.kpi-main .label {
  font-family: 'Geist Mono', monospace;
  font-size: 8px; letter-spacing: 0.22em; text-transform: uppercase;
  color: rgba(199, 242, 74, 0.7);
  margin-bottom: 8px;
}
.kpi-main .value {
  font-family: 'Instrument Serif', serif;
  font-size: 44pt; line-height: 1;
}
.kpi-main .value .unit {
  font-size: 22pt; vertical-align: top; margin-left: 8px;
  color: rgba(199, 242, 74, 0.8);
}
.kpi-main .footnote { color: rgba(199, 242, 74, 0.8); font-size: 9px; margin-top: 10px; }

.kpi-card {
  background: ${COLORS.card};
  border: 1px solid ${COLORS.line};
  border-radius: 18px;
  padding: 18px;
}
.kpi-card .label {
  font-family: 'Geist Mono', monospace;
  font-size: 8px; letter-spacing: 0.22em; text-transform: uppercase;
  color: ${COLORS.ink3};
  margin-bottom: 8px;
}
.kpi-card .value {
  font-family: 'Instrument Serif', serif;
  font-size: 22pt; color: ${COLORS.brand};
}
.kpi-card .value .unit { font-size: 11pt; color: ${COLORS.ink3}; margin-left: 4px; }

/* ── Sections ── */
.section { margin-top: 26px; page-break-inside: avoid; }
.section-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.section-num {
  font-family: 'Geist Mono', monospace;
  font-size: 8px; letter-spacing: 0.18em; color: ${COLORS.salvia};
  text-transform: uppercase;
}
.section-title {
  font-family: 'Instrument Serif', serif;
  font-size: 18pt; color: ${COLORS.brand};
}
.section-lead { color: ${COLORS.ink3}; font-size: 10px; margin-bottom: 14px; max-width: 600px; }

/* ── Month card ── */
.mes-card {
  background: ${COLORS.card};
  border: 1px solid ${COLORS.line};
  border-radius: 18px;
  margin-bottom: 12px;
  overflow: hidden;
  page-break-inside: avoid;
}
.mes-head {
  padding: 14px 18px;
  display: flex; align-items: baseline; justify-content: space-between;
}
.mes-head .mes-name {
  font-family: 'Instrument Serif', serif;
  font-size: 16pt; color: ${COLORS.brand};
}
.mes-head .mes-name .year { color: ${COLORS.ink3}; }
.mes-head .mes-meta {
  font-family: 'Geist Mono', monospace;
  font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
  color: ${COLORS.ink3}; margin-left: 12px;
}
.mes-head .mes-ahorro { text-align: right; }
.mes-head .mes-ahorro .lbl {
  font-family: 'Geist Mono', monospace;
  font-size: 7px; letter-spacing: 0.18em; text-transform: uppercase;
  color: ${COLORS.ink3};
}
.mes-head .mes-ahorro .val {
  font-family: 'Instrument Serif', serif;
  font-size: 14pt; color: ${COLORS.salvia};
}

.mes-body {
  border-top: 1px solid ${COLORS.line};
  background: rgba(244, 238, 226, 0.4);
  padding: 14px 18px;
}

/* ── Table ── */
table.detail { width: 100%; border-collapse: collapse; }
table.detail thead th {
  font-family: 'Geist Mono', monospace;
  font-size: 7px; letter-spacing: 0.15em; text-transform: uppercase;
  color: ${COLORS.ink3};
  padding: 6px 2px;
  border-bottom: 2px solid ${COLORS.line};
  text-align: right;
}
table.detail thead th:first-child { text-align: left; }
table.detail tbody td {
  padding: 5px 2px;
  border-bottom: 1px solid rgba(229, 220, 201, 0.4);
  font-size: 10px;
}
table.detail tbody td:not(:first-child) {
  font-family: 'Geist Mono', monospace;
  text-align: right;
}
table.detail tr.sumario td {
  border-top: 2px solid rgba(229, 220, 201, 0.6);
  border-bottom: none;
  padding-top: 8px;
  font-weight: 600;
}
table.detail tr.total td {
  border-top: 2px solid ${COLORS.brand};
  padding-top: 8px;
  font-size: 11px;
  font-weight: 700;
  color: ${COLORS.brand};
}
table.detail tr.total td.savings { color: ${COLORS.salvia}; }
table.detail td.savings { color: ${COLORS.salvia}; font-weight: 600; }
table.detail td.muted { color: ${COLORS.ink3}; }

/* ── Methodology ── */
.method {
  background: ${COLORS.card};
  border: 1px solid ${COLORS.line};
  border-radius: 18px;
  padding: 18px 22px;
  font-size: 10px; line-height: 1.55; color: ${COLORS.ink3};
}
.method .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 14px; }
.method .col-title {
  font-family: 'Geist Mono', monospace;
  font-size: 7px; letter-spacing: 0.18em; text-transform: uppercase;
  color: ${COLORS.salvia};
  margin-bottom: 6px;
}
.method .divider { border-top: 1px solid ${COLORS.line}; padding-top: 14px; margin-top: 10px; }
.method .concept {
  margin-bottom: 4px;
}
.method .concept .lbl { color: ${COLORS.ink}; font-weight: 600; font-size: 10px; }

/* ── Footer ── */
.footer {
  margin-top: 28px;
  padding-top: 14px;
  border-top: 1px solid ${COLORS.line};
  display: flex; justify-content: space-between;
  font-family: 'Geist Mono', monospace;
  font-size: 8px; letter-spacing: 0.1em; color: ${COLORS.ink3};
  text-transform: uppercase;
}

/* ── Print specifics ── */
@page {
  size: A4;
  margin: 0;
}
@media print {
  .page { padding: 14mm; margin: 0; box-shadow: none; }
}
`
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers de fila
// ════════════════════════════════════════════════════════════════════════════

function rowConcepto(label: string, real: number, sim: number, isRegulated = false): string {
  const diff = sim - real
  const savingsClass = isRegulated || diff === 0 ? 'muted' : diff > 0 ? 'savings' : ''
  const diffStr = isRegulated ? '—' : diff > 0 ? `+${fmt(diff, 2)}&nbsp;€` : diff < 0 ? `${fmt(diff, 2)}&nbsp;€` : '—'
  return `
    <tr>
      <td>${esc(label)}</td>
      <td>${fmtEur(real)}</td>
      <td class="muted">${fmtEur(sim)}</td>
      <td class="${savingsClass}">${diffStr}</td>
    </tr>`
}

// ════════════════════════════════════════════════════════════════════════════
// Tarjeta de mes
// ════════════════════════════════════════════════════════════════════════════

function buildMesCard(par: ComparativaMes, isGas: boolean): string {
  const r = par.realVoltis
  const s = par.simuladoAntigua
  const consumo = (par.voltisFactura.consumo || []).reduce((sum, c) => sum + (Number(c.kwh) || 0), 0)
    || Number(par.voltisFactura.consumoTotalKwh) || 0

  let body = ''
  if (isGas) {
    const precioV = par.detallePeriodos?.[0]?.precioKwhVoltis ?? 0
    const precioA = par.detallePeriodos?.[0]?.precioKwhAntigua ?? 0
    body = `
      <table class="detail">
        <thead><tr>
          <th>Concepto</th>
          <th>Voltis</th>
          <th>Antigua (sim.)</th>
          <th>Δ Ahorro</th>
        </tr></thead>
        <tbody>
          <tr><td>Consumo</td><td>${fmt(consumo, 0)} kWh</td><td class="muted">${fmt(consumo, 0)} kWh</td><td class="muted">—</td></tr>
          <tr><td>Precio TV</td><td>${fmt(precioV, 6)} €/kWh</td><td class="muted">${fmt(precioA, 6)} €/kWh</td><td class="muted">—</td></tr>
          ${rowConcepto('Energía (TV)', r.totalEnergia, s.totalEnergia)}
          ${rowConcepto(`IVA ${fmt(r.ivaPorcentaje * 100, 0)} %`, r.ivaImporte, s.ivaImporte)}
          <tr class="total">
            <td>Coste energía + IVA</td>
            <td>${fmtEur(r.totalEnergia + r.ivaImporte)}</td>
            <td class="muted">${fmtEur(s.totalEnergia + s.ivaImporte)}</td>
            <td class="savings">+${fmt(par.ahorroMes, 2)}&nbsp;€</td>
          </tr>
        </tbody>
      </table>`
  } else {
    body = `
      <table class="detail">
        <thead><tr>
          <th>Concepto</th>
          <th>Voltis (real)</th>
          <th>Antigua (sim.)</th>
          <th>Δ Ahorro</th>
        </tr></thead>
        <tbody>
          ${rowConcepto('Energía', r.totalEnergia, s.totalEnergia)}
          ${rowConcepto('Potencia contratada', r.totalPotencia, s.totalPotencia, true)}
          ${r.excesos > 0 ? rowConcepto('Excesos de potencia', r.excesos, s.excesos, true) : ''}
          ${r.bonoSocial > 0 ? rowConcepto('Bono social', r.bonoSocial, s.bonoSocial, true) : ''}
          ${rowConcepto(`Impuesto eléctrico (${fmt(r.ieePorcentaje * 100, 2)} %)`, r.ieeImporte, s.ieeImporte)}
          ${r.alquiler > 0 ? rowConcepto('Alquiler equipos', r.alquiler, s.alquiler, true) : ''}
          <tr class="sumario">
            <td>Base imponible</td>
            <td>${fmtEur(r.baseImponible)}</td>
            <td class="muted">${fmtEur(s.baseImponible)}</td>
            <td class="savings">+${fmt(s.baseImponible - r.baseImponible, 2)}&nbsp;€</td>
          </tr>
          ${rowConcepto(`IVA ${fmt(r.ivaPorcentaje * 100, 0)} %`, r.ivaImporte, s.ivaImporte)}
          <tr class="total">
            <td>Total factura</td>
            <td>${fmtEur(r.totalFactura)}</td>
            <td class="muted">${fmtEur(s.totalFactura)}</td>
            <td class="savings">+${fmt(par.ahorroMes, 2)}&nbsp;€</td>
          </tr>
        </tbody>
      </table>`
  }

  return `
    <article class="mes-card">
      <div class="mes-head">
        <div>
          <span class="mes-name">${MESES_FULL[par.mes]} <span class="year">${par.year}</span></span>
          <span class="mes-meta">${par.diasVoltis} días · ${fmt(consumo, 0)} kWh</span>
        </div>
        <div class="mes-ahorro">
          <div class="lbl">Ahorro</div>
          <div class="val">+${fmt(par.ahorroMes, 2)}&nbsp;€</div>
        </div>
      </div>
      <div class="mes-body">${body}</div>
    </article>`
}

// ════════════════════════════════════════════════════════════════════════════
// Función principal
// ════════════════════════════════════════════════════════════════════════════

export function buildComparativaHtml({ supply, comparativa, mesesSeleccionados }: BuildArgs): string {
  const pares = mesesSeleccionados && mesesSeleccionados.size > 0
    ? comparativa.pares.filter(p => mesesSeleccionados.has(`${p.year}-${p.mes}`))
    : comparativa.pares

  const isGas = comparativa.supplyType === 'gas'

  // Totales sobre meses seleccionados
  let consumoT = 0, voltisT = 0, simT = 0
  for (const p of pares) {
    consumoT += (p.voltisFactura.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
      || Number(p.voltisFactura.consumoTotalKwh) || 0
    voltisT += p.realVoltis.totalFactura
    simT += p.simuladoAntigua.totalFactura
  }
  const ahorroT = simT - voltisT
  const pct = simT > 0 ? (ahorroT / simT) * 100 : 0

  const periodo = pares.length === 0
    ? '—'
    : (() => {
        const sorted = [...pares].sort((a, b) => (a.year - b.year) || (a.mes - b.mes))
        const first = sorted[0]
        const last = sorted[sorted.length - 1]
        return `${MESES_SHORT[first.mes]} ${first.year}${last !== first ? ' – ' + MESES_SHORT[last.mes] + ' ' + last.year : ''}`
      })()

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Comparativa de coste real · ${esc(supply.client_name || 'Cliente')}</title>
<style>${styles()}</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <header class="header">
    <div class="eyebrow">Informe Voltis · Comparativa de coste real · ${isGas ? 'Gas natural' : 'Electricidad'}</div>
    <h1 class="title">
      ${esc(comparativa.comercializadoraVoltis || 'Voltis')}
      <em>vs</em>
      ${esc(comparativa.comercializadoraAntigua || 'comercializadora anterior')}
    </h1>
    <div class="subtitle">
      <span class="bold">${esc(supply.client_name || '—')}</span>
      <span class="sep">·</span>
      <span class="mono">${esc(supply.cups || '—')}</span>
      <span class="sep">·</span>
      <span class="bold">${esc(supply.tariff || '—')}</span>
      <span class="sep">·</span>
      <span>${esc(periodo)}</span>
    </div>
  </header>

  <!-- KPIs -->
  <div class="kpis">
    <div class="kpi-main">
      <div class="label">Ahorro acumulado</div>
      <div class="value">${fmt(ahorroT, 2)}<span class="unit">€</span></div>
      <div class="footnote">${fmt(pct, 1)} % menos que con la comercializadora anterior</div>
    </div>
    <div class="kpi-card">
      <div class="label">Consumo analizado</div>
      <div class="value">${fmt(consumoT, 0)}<span class="unit">kWh</span></div>
    </div>
  </div>

  <!-- MES A MES -->
  <section class="section">
    <div class="section-head">
      <span class="section-num">01</span>
      <h2 class="section-title">Desglose factura a factura</h2>
    </div>
    <p class="section-lead">
      ${isGas
        ? 'Cada mes muestra el coste real de la factura Voltis y lo que habría cobrado la comercializadora antigua al mismo consumo. En gas solo varía el término variable de energía — el resto es regulado.'
        : 'Cada mes muestra el coste real de la factura Voltis y lo que habría cobrado la comercializadora antigua al mismo consumo, aplicando el precio €/kWh de cada periodo P1–P6 del mismo mes del año anterior. Los conceptos regulados (potencia, excesos, bono social, alquiler) son idénticos. IEE e IVA se recalculan con el tipo vigente.'}
    </p>
    ${pares.length === 0
      ? '<div class="method">No hay meses con pareja completa de facturas.</div>'
      : pares.map(p => buildMesCard(p, isGas)).join('')}
  </section>

  <!-- METODOLOGÍA -->
  <section class="section">
    <div class="section-head">
      <span class="section-num">02</span>
      <h2 class="section-title">Cómo se calcula este ahorro</h2>
    </div>
    <div class="method">
      <div class="grid">
        <div>
          <div class="col-title">Método</div>
          <p>Simulación inversa: aplicamos los precios de ${esc(comparativa.comercializadoraAntigua || 'la comercializadora antigua')} del mismo mes natural del año anterior al consumo real facturado por ${esc(comparativa.comercializadoraVoltis || 'la nueva comercializadora')}. ${isGas ? 'Se compara solo el TV Precio Fijo.' : 'Se aplica precio €/kWh por periodo P1–P6 a los kWh facturados en cada periodo (punta, llano, valle).'}</p>
        </div>
        <div>
          <div class="col-title">Por qué es justo</div>
          <p>El consumo se mantiene constante en ambos escenarios. La diferencia es puramente de precio comercial. Los conceptos regulados (peajes, cargos, bono social, alquiler) se pasan idénticos porque dependen del BOE/CNMC, no del comercializador.</p>
        </div>
      </div>
      <div class="divider">
        <div class="col-title">Hipótesis</div>
        <p>Se asume que la comercializadora anterior habría mantenido los precios del año anterior. Si su contrato era indexado a OMIE, la comparativa puede desviarse en momentos de alta volatilidad del mercado.</p>
      </div>
    </div>
  </section>

  <footer class="footer">
    <span>Voltis · Comparativa de coste real</span>
    <span>Generado ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
  </footer>

</div>
</body>
</html>`
}
