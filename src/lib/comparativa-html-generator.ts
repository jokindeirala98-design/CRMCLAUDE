/**
 * src/lib/comparativa-html-generator.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Generador de HTML standalone para la comparativa Voltis V2.
 *
 * Recibe los datos calculados (ResultadoTripartito + supply + PDFs base64) y
 * devuelve un string HTML autocontenido: CSS, JS, SVGs y PDFs embebidos. El
 * comercial lo descarga y lo manda al cliente; el cliente abre el archivo en
 * el navegador y puede convertirlo a PDF con "Imprimir → Guardar como PDF".
 *
 * Sigue las reglas del prompt-de-sistema Voltis:
 *   - Paleta exacta (#1B4FA0 / #B8C5D6 / etc.)
 *   - Tipografía Inter (Google Fonts con fallback)
 *   - Solo PDFs del periodo comparado embebidos (típicamente 6 archivos)
 *   - Reglas @media print obligatorias
 *   - Honestidad metodológica: descomposición tarifa/normativo/consumo
 */

import type { ResultadoTripartito } from '@/lib/comparativa-tripartita'

export interface SupplyInfo {
  id: string
  cups: string | null
  tariff: string | null
  type: string
  name: string | null
  client_name: string | null
  client_cif: string | null
}

export interface PdfEmbed {
  invoiceId: string
  side: 'antigua' | 'voltis'
  supplyType: 'luz' | 'gas'
  base64: string
  mime: string
  filename: string
  sizeKb: number
  mesLabel: string
  comercializadora: string | null
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// ── Formateadores españoles ────────────────────────────────────────────────
const fEur = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €' : '—'
const fKwh = (n: number) => Number.isFinite(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' kWh' : '—'
const fPct = (n: number, d = 1) => Number.isFinite(n) ? n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %' : '—'
const fNum = (n: number) => Number.isFinite(n) ? n.toLocaleString('es-ES') : '—'
const fPrice = (n: number) => Number.isFinite(n) ? n.toLocaleString('es-ES', { minimumFractionDigits: 5, maximumFractionDigits: 5 }) + ' €/kWh' : '—'

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))

// ── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
  --voltis-blue: #1B4FA0; --voltis-blue-dark: #133B7A;
  --voltis-blue-light: #7FB3E8; --voltis-blue-hero: #A7C8EC;
  --voltis-blue-soft: #EEF4FB; --bg: #FFFFFF; --bg-soft: #F7F9FC;
  --text: #1A1A1A; --text-2: #5A5A5A; --text-3: #8A8A8A;
  --border: #E5E8EE; --border-strong: #D0D5DD; --grey-antes: #B8C5D6;
}
* { box-sizing: border-box; }
html, body { margin:0; padding:0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px; line-height: 1.55; color: var(--text); background: var(--bg-soft);
  -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
}
.hero { background: linear-gradient(135deg, #A7C8EC 0%, #7FB3E8 100%); position: relative; overflow: hidden; }
.topbar { background: rgba(255,255,255,0.97); border-bottom: 1px solid rgba(255,255,255,0.6);
  padding: 16px 32px; display: flex; align-items: center; gap: 16px; max-width: 1200px; margin: 0 auto;
}
.topbar-logo { height: 52px; }
.topbar-divider { width: 1px; height: 28px; background: var(--border); }
.topbar-info .label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
.topbar-info .name { font-size: 14px; font-weight: 600; color: var(--text); }
.topbar-right { margin-left: auto; text-align: right; font-size: 12px; line-height: 1.5; }
.topbar-right .small { color: var(--text-3); }
.topbar-right .big { font-weight: 600; color: var(--text); font-family: 'SF Mono', Menlo, monospace; font-size: 11px; }
.hero-content { max-width: 1200px; margin: 0 auto; padding: 48px 32px 64px;
  display: flex; align-items: center; gap: 32px; }
.hero-text { flex: 1; color: #fff; }
.hero-text h1 { font-size: 38px; font-weight: 800; margin: 0 0 14px; line-height: 1.1; letter-spacing: -0.8px; color: #fff; }
.hero-text p { font-size: 16px; margin: 0; max-width: 540px; color: rgba(255,255,255,0.95); line-height: 1.5; }
.hero-mascot { width: 200px; height: auto; flex-shrink: 0; filter: drop-shadow(0 12px 32px rgba(19, 59, 122, 0.25)); }
.container { max-width: 1200px; margin: -32px auto 0; padding: 0 32px 48px; position: relative; z-index: 2; }
.tabs { background: #fff; border-radius: 14px; padding: 6px; display: flex; gap: 4px;
  box-shadow: 0 4px 24px rgba(19,59,122,0.08); border: 1px solid var(--border);
  margin-bottom: 28px; overflow-x: auto; }
.tab { border: none; background: transparent; padding: 10px 18px; font-size: 13.5px; font-weight: 500;
  color: var(--text-2); cursor: pointer; border-radius: 10px; white-space: nowrap; font-family: inherit;
  transition: all 0.15s; display: flex; align-items: center; gap: 8px; }
.tab:hover { color: var(--voltis-blue); }
.tab.active { background: var(--voltis-blue); color: #fff; }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.section-header { margin: 4px 4px 20px; }
.section-header .meta { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; margin: 0 0 6px; }
.section-header h2 { font-size: 24px; font-weight: 700; margin: 0; color: var(--text); letter-spacing: -0.3px; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px; }
.kpi { background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; transition: all 0.15s; }
.kpi-label { font-size: 11px; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; margin-bottom: 8px; }
.kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; color: var(--text); }
.kpi-value.accent { color: var(--voltis-blue); }
.kpi-hint { font-size: 12px; color: var(--text-3); margin-top: 4px; }
.card { background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 22px; margin-bottom: 24px; }
.card h3 { margin: 0 0 14px; font-size: 14px; font-weight: 600; color: var(--text); }
.simple-card { border-top-width: 4px; border-top-style: solid; }
.simple-table { width: 100%; border-collapse: collapse; }
.simple-table td { padding: 12px 0; font-size: 13px; }
.simple-table td:first-child { color: var(--text-2); }
.simple-table td:last-child { text-align: right; font-weight: 600; color: var(--text); font-size: 14px; }
.simple-table tr:not(:last-child) { border-bottom: 1px solid var(--border); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table thead th { padding: 12px 14px; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.6px; color: var(--text-2); border-bottom: 2px solid var(--voltis-blue); }
.data-table thead th:first-child { text-align: left; }
.data-table thead th:not(:first-child) { text-align: right; }
.data-table tbody td { padding: 14px; font-size: 14px; border-bottom: 1px solid var(--border); }
.data-table tbody td:first-child { text-align: left; }
.data-table tbody td:not(:first-child) { text-align: right; }
.data-table tbody tr:hover { background: #FAFBFD; }
.data-table tr.total td { background: var(--voltis-blue-soft); border-top: 2px solid var(--voltis-blue); padding: 16px; font-weight: 700; color: var(--voltis-blue-dark); }
.data-table .save { color: var(--voltis-blue); font-weight: 600; }
.cols-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
.hbar-row { display: flex; flex-direction: column; gap: 14px; }
.hbar { height: 10px; background: var(--bg-soft); border-radius: 6px; overflow: hidden; }
.hbar > div { height: 100%; border-radius: 6px; transition: width 0.3s; }
.tripartita-bar { height: 24px; border-radius: 12px; overflow: hidden; display: flex; border: 1px solid var(--border); margin-bottom: 12px; }
.legend { display: flex; gap: 18px; font-size: 12px; flex-wrap: wrap; }
.legend-item { display: flex; align-items: center; gap: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; }
.doc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.doc-card { background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 16px;
  display: flex; flex-direction: column; gap: 10px; cursor: pointer; transition: all 0.15s; text-decoration: none; color: var(--text); }
.doc-card:hover { transform: translateY(-1px); }
.doc-card .icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.doc-card .title { font-size: 13px; font-weight: 600; }
.doc-card .subtitle { font-size: 11px; color: var(--text-3); }
.doc-card .size { font-size: 11px; color: var(--text-3); margin-top: auto; }
.bar-chart svg { width: 100%; height: auto; }
.btn-print { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px;
  background: var(--voltis-blue); color: #fff; border: none; border-radius: 10px;
  font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-print:hover { background: var(--voltis-blue-dark); }
.warning { padding: 14px; border-radius: 12px; background: #FFF7ED; border: 1px solid #FED7AA; color: #9A3412; font-size: 13px; margin-top: 24px; }
footer { margin-top: 32px; padding: 20px 0; border-top: 1px solid var(--border);
  font-size: 11px; color: var(--text-3); display: flex; justify-content: space-between; }

@media (max-width: 720px) {
  body { font-size: 14px; }
  .topbar { padding: 12px 16px; flex-wrap: wrap; gap: 10px; }
  .topbar-right { width: 100%; text-align: left; margin-left: 0; }
  .hero-content { flex-direction: column; align-items: center; padding: 28px 16px 36px; gap: 18px; text-align: center; }
  .hero-mascot { width: 130px; order: -1; }
  .hero-text { text-align: center; }
  .hero-text h1 { font-size: 26px; line-height: 1.15; }
  .hero-text p { font-size: 14px; }
  .container { padding: 0 12px 32px; margin-top: -20px; }

  .tabs { padding: 4px; gap: 2px; }
  .tab { padding: 10px 12px; font-size: 12px; min-height: 40px; }
  .tab span { white-space: nowrap; }
  .tab svg { display: none; }   /* en móvil quitamos iconos, solo label */

  .section-header h2 { font-size: 19px; }
  .kpi-grid { grid-template-columns: 1fr; gap: 10px; margin-bottom: 18px; }
  .kpi { padding: 14px 16px; }
  .kpi-value { font-size: 22px; }
  .card { padding: 16px; margin-bottom: 18px; }
  .card h3 { font-size: 13px; }
  .cols-2 { grid-template-columns: 1fr; gap: 12px; }
  .simple-table td { padding: 9px 0; font-size: 12.5px; }

  /* Tablas: scroll horizontal — la celda no rompe a varias líneas */
  .card > .data-table,
  .data-table { display: block; overflow-x: auto; white-space: nowrap; }
  .data-table thead th, .data-table tbody td { padding: 10px 12px; font-size: 12.5px; }

  /* Charts más bajos en móvil */
  .bar-chart svg { max-height: 220px; }

  .doc-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
  .doc-card { padding: 12px; }
  .doc-card .icon { width: 32px; height: 32px; }
  .doc-card .title { font-size: 12px; }

  .btn-print { padding: 10px 18px; font-size: 13px; }
  footer { flex-direction: column; gap: 6px; text-align: center; }
}

@media print {
  @page { margin: 1.5cm; size: A4; }
  body { background: white !important; font-size: 11pt; }
  .tab-panel { display: block !important; page-break-before: always; }
  .tab-panel:first-of-type { page-break-before: auto; }
  .tabs { display: none !important; }
  .card, .kpi, .doc-card { page-break-inside: avoid; break-inside: avoid; }
  table { page-break-inside: avoid; }
  thead { display: table-header-group; }
  * { transition: none !important; animation: none !important;
    -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .hero { background: white !important; border-bottom: 2px solid var(--voltis-blue); }
  .hero-text h1, .hero-text p { color: var(--text) !important; }
  .btn-print, .doc-card, .hero-mascot { display: none !important; }
}
`

// ── Buddy mascot ──────────────────────────────────────────────────────────
// Si existe `public/voltis-mascota.png` se embebe en base64. Si no,
// fallback al SVG inline. El endpoint que llama a generarHtmlStandalone
// pasa `mascotBase64` cuando ha podido leer el archivo del disco.

const BUDDY_SVG_FALLBACK = `<svg class="hero-mascot" viewBox="0 0 100 115" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bulbG" cx="0.4" cy="0.3">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="40%" stop-color="#E0EFFF"/>
      <stop offset="100%" stop-color="#A7C8EC"/>
    </radialGradient>
    <linearGradient id="bodyG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1B4FA0"/>
      <stop offset="100%" stop-color="#133B7A"/>
    </linearGradient>
  </defs>
  <ellipse cx="50" cy="42" rx="34" ry="36" fill="url(#bulbG)" stroke="#fff" stroke-width="1.5"/>
  <path d="M35 38 Q40 28 45 38 Q50 28 55 38 Q60 28 65 38" stroke="#1B4FA0" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <rect x="36" y="72" width="28" height="22" rx="6" fill="url(#bodyG)"/>
  <ellipse cx="50" cy="93" rx="14" ry="3" fill="#133B7A" opacity="0.4"/>
  <circle cx="44" cy="82" r="2.2" fill="#fff"/>
  <circle cx="56" cy="82" r="2.2" fill="#fff"/>
  <circle cx="44.5" cy="82.5" r="0.9" fill="#1E293B"/>
  <circle cx="56.5" cy="82.5" r="0.9" fill="#1E293B"/>
  <path d="M46 88 Q50 91 54 88" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <rect x="40" y="94" width="6" height="14" rx="3" fill="url(#bodyG)"/>
  <rect x="54" y="94" width="6" height="14" rx="3" fill="url(#bodyG)"/>
</svg>`

function buddyHtml(mascotBase64?: string | null, mascotMime?: string): string {
  if (mascotBase64) {
    return `<img class="hero-mascot" src="data:${mascotMime || 'image/png'};base64,${mascotBase64}" alt="Buddy"/>`
  }
  return BUDDY_SVG_FALLBACK
}

// ── Charts SVG ────────────────────────────────────────────────────────────

function groupedBarsSVG(months: Array<{ label: string; antes: number; ahora: number }>, fmt: (v: number) => string): string {
  if (!months.length) return ''
  const w = 800, h = 260, pad = { top: 20, right: 16, left: 60, bottom: 36 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom
  const max = Math.max(...months.flatMap(m => [m.antes, m.ahora]), 1) * 1.1
  const groupW = plotW / months.length
  const barW = (groupW - 8) / 2

  const grid = [0, 0.25, 0.5, 0.75, 1].map(p => {
    const y = pad.top + plotH - plotH * p
    return `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="#E5E8EE" stroke-dasharray="3 3"/>
    <text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#8A8A8A">${esc(fmt(max * p))}</text>`
  }).join('')

  const bars = months.map((m, i) => {
    const x = pad.left + i * groupW + 4
    const hA = (m.antes / max) * plotH
    const hB = (m.ahora / max) * plotH
    return `<rect x="${x}" y="${pad.top + plotH - hA}" width="${barW}" height="${hA}" rx="4" fill="#B8C5D6"/>
    <rect x="${x + barW + 6}" y="${pad.top + plotH - hB}" width="${barW}" height="${hB}" rx="4" fill="#1B4FA0"/>
    <text x="${x + barW + 3}" y="${h - 12}" text-anchor="middle" font-size="11" fill="#5A5A5A">${esc(m.label)}</text>`
  }).join('')

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
    ${grid}
    ${bars}
    <g transform="translate(${pad.left}, 8)">
      <rect width="10" height="10" rx="2" fill="#B8C5D6"/>
      <text x="16" y="9" font-size="11" fill="#5A5A5A">Antes</text>
      <rect x="70" width="10" height="10" rx="2" fill="#1B4FA0"/>
      <text x="86" y="9" font-size="11" fill="#5A5A5A">Voltis</text>
    </g>
  </svg>`
}

function hBarsRow(rows: Array<{ label: string; value: number; color: string }>, max: number, fmt: (v: number) => string): string {
  return `<div class="hbar-row">
    ${rows.map(r => `
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px">
          <span style="color:#5A5A5A;font-weight:500">${esc(r.label)}</span>
          <span style="color:#1A1A1A;font-weight:600">${esc(fmt(r.value))}</span>
        </div>
        <div class="hbar"><div style="width:${(r.value / max) * 100}%;background:${r.color}"></div></div>
      </div>
    `).join('')}
  </div>`
}

function tripartitaBarHTML(d: ResultadoTripartito['descomposicion']): string {
  const total = Math.max(Math.abs(d.ahorroTarifa) + Math.abs(d.ahorroNormativo) + Math.abs(d.ahorroConsumo), 1)
  const wT = (Math.abs(d.ahorroTarifa) / total) * 100
  const wN = (Math.abs(d.ahorroNormativo) / total) * 100
  const wC = (Math.abs(d.ahorroConsumo) / total) * 100
  return `
    <div class="tripartita-bar">
      <div title="Tarifa: ${esc(fEur(d.ahorroTarifa))}" style="width:${wT}%;background:#1B4FA0"></div>
      <div title="Normativo: ${esc(fEur(d.ahorroNormativo))}" style="width:${wN}%;background:#7FB3E8"></div>
      <div title="Consumo: ${esc(fEur(d.ahorroConsumo))}" style="width:${wC}%;background:#A7C8EC"></div>
    </div>
    <div class="legend">
      <div class="legend-item"><div class="swatch" style="background:#1B4FA0"></div><span style="color:#5A5A5A">Tarifa (Voltis)</span> <strong>${esc(fEur(d.ahorroTarifa))}</strong></div>
      <div class="legend-item"><div class="swatch" style="background:#7FB3E8"></div><span style="color:#5A5A5A">Normativo (Gobierno)</span> <strong>${esc(fEur(d.ahorroNormativo))}</strong></div>
      <div class="legend-item"><div class="swatch" style="background:#A7C8EC"></div><span style="color:#5A5A5A">Consumo (Cliente)</span> <strong>${esc(fEur(d.ahorroConsumo))}</strong></div>
    </div>
  `
}

// ── KPIs + cards reutilizables ─────────────────────────────────────────────

function kpi(label: string, value: string, hint?: string, accent = false): string {
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value ${accent ? 'accent' : ''}">${esc(value)}</div>
    ${hint ? `<div class="kpi-hint">${esc(hint)}</div>` : ''}
  </div>`
}

function simpleCard(title: string, color: string, rows: Array<[string, string]>): string {
  return `<div class="card simple-card" style="border-top-color:${color}">
    <h3>${esc(title)}</h3>
    <table class="simple-table"><tbody>
      ${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
    </tbody></table>
  </div>`
}

type Cell = string | { value: string; cls?: string }
function dataTable(headers: string[], rows: Cell[][], totalRow?: Cell[]): string {
  const cell = (c: Cell) => typeof c === 'string' ? `<td>${esc(c)}</td>` : `<td class="${c.cls || ''}">${esc(c.value)}</td>`
  return `<table class="data-table">
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}
      ${totalRow ? `<tr class="total">${totalRow.map(cell).join('')}</tr>` : ''}
    </tbody>
  </table>`
}

// ── Paneles ────────────────────────────────────────────────────────────────

function ahorroPanel(r: ResultadoTripartito, supplyType: 'luz' | 'gas', active: boolean): string {
  const d = r.descomposicion
  const kwhAntes = r.S0.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const kwhAhora = r.S3.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const eAntes = r.S0.porMes.reduce((s, m) => s + m.resumen.totalEnergia, 0)
  const eAhora = r.S3.porMes.reduce((s, m) => s + m.resumen.totalEnergia, 0)
  const pAntes = kwhAntes > 0 ? eAntes / kwhAntes : 0
  const pAhora = kwhAhora > 0 ? eAhora / kwhAhora : 0
  const varKwh = kwhAhora - kwhAntes
  const varKwhPct = kwhAntes > 0 ? (varKwh / kwhAntes) * 100 : 0
  const varP = pAhora - pAntes
  const varPct = pAntes > 0 ? (varP / pAntes) * 100 : 0

  return `<div class="tab-panel ${active ? 'active' : ''}" id="panel-ahorro-${supplyType}">
    <div class="section-header">
      <div class="meta">${supplyType.toUpperCase()} · COMPARATIVA REAL</div>
      <h2>Ahorro total verificado: ${esc(fEur(d.ahorroTotal))}</h2>
    </div>
    <div class="kpi-grid">
      ${kpi(`Ahorro ${r.cobertura.mesesComparados}M`, fEur(d.ahorroTotal), fPct(d.pctTotal), true)}
      ${kpi('Variación consumo', `${varKwh >= 0 ? '+' : ''}${fNum(varKwh)} kWh`, fPct(varKwhPct))}
      ${kpi('Precio medio energía', fPrice(pAhora), `Antes ${fPrice(pAntes)} · ${fPct(varPct)}`)}
    </div>

    <div class="cols-2">
      ${simpleCard(`Antes · ${r.comercializadoraAntigua || 'Comercializadora previa'}`, '#B8C5D6', [
        ['Total facturado', fEur(r.S0.total)],
        ['Energía consumida', fKwh(kwhAntes)],
        ['Coste energía pura', fEur(eAntes)],
        ['€/kWh sólo energía', fPrice(pAntes)],
      ])}
      ${simpleCard(`Ahora · ${r.comercializadoraVoltis || 'Voltis'}`, '#1B4FA0', [
        ['Total facturado', fEur(r.S3.total)],
        ['Energía consumida', fKwh(kwhAhora)],
        ['Coste energía pura', fEur(eAhora)],
        ['€/kWh sólo energía', fPrice(pAhora)],
      ])}
    </div>

    <div class="card">
      <h3>Coste mes a mes</h3>
      ${dataTable(
        ['Mes', 'Antes', 'Ahora', 'Ahorro €', 'Variación %'],
        r.S0.porMes.map((m, i) => {
          const ahora = r.S3.porMes[i]?.total || 0
          const ahorro = m.total - ahora
          const pct = m.total > 0 ? (ahorro / m.total) * 100 : 0
          return [
            `${MESES[m.mes]} ${m.year}`,
            fEur(m.total),
            fEur(ahora),
            { value: fEur(ahorro), cls: ahorro > 0 ? 'save' : '' },
            fPct(pct),
          ]
        }),
        ['Total', fEur(r.S0.total), fEur(r.S3.total), { value: fEur(d.ahorroTotal), cls: 'save' }, fPct(d.pctTotal)],
      )}
    </div>

    <div class="card">
      <h3>Precio medio sólo término variable de energía</h3>
      ${hBarsRow([
        { label: 'Antes', value: pAntes, color: '#B8C5D6' },
        { label: 'Ahora · Voltis', value: pAhora, color: '#1B4FA0' },
      ], Math.max(pAntes, pAhora) * 1.15, fPrice)}
    </div>

    ${supplyType === 'gas' ? `
      <div class="section-header">
        <div class="meta">GAS · DESCOMPOSICIÓN</div>
        <h2>¿De dónde viene el ahorro?</h2>
      </div>
      <div class="kpi-grid">
        ${kpi('Por cambio de tarifa (Voltis)', fEur(d.ahorroTarifa), `${fPct(d.pctTarifa)} sobre S0`, true)}
        ${kpi('Por cambio normativo (Gobierno)', fEur(d.ahorroNormativo), `${fPct(d.pctNormativo)} sobre S0`)}
        ${kpi('Por menor consumo (Cliente)', fEur(d.ahorroConsumo), `${fPct(d.pctConsumo)} sobre S0`)}
        ${kpi('Ahorro total verificado', fEur(d.ahorroTotal), fPct(d.pctTotal), true)}
      </div>
      <div class="card">
        <h3>Descomposición del ahorro</h3>
        ${tripartitaBarHTML(d)}
      </div>
    ` : ''}
  </div>`
}

function consumosPanel(r: ResultadoTripartito): string {
  const kwhA = r.S0.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const kwhB = r.S3.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const dA = r.S0.porMes.reduce((s, m) => s + m.resumen.dias, 0)
  const dB = r.S3.porMes.reduce((s, m) => s + m.resumen.dias, 0)
  const mA = dA > 0 ? kwhA / dA : 0
  const mB = dB > 0 ? kwhB / dB : 0
  const varT = kwhA > 0 ? ((kwhB - kwhA) / kwhA) * 100 : 0
  const varM = mA > 0 ? ((mB - mA) / mA) * 100 : 0

  return `<div class="tab-panel" id="panel-consumos-luz">
    <div class="section-header">
      <div class="meta">LUZ · CONSUMOS</div>
      <h2>Evolución del consumo eléctrico</h2>
    </div>
    <div class="kpi-grid">
      ${kpi('Antes', fKwh(kwhA), `${dA} días`)}
      ${kpi('Ahora', fKwh(kwhB), `${dB} días`, true)}
      ${kpi('Variación total', fPct(varT), `${kwhB - kwhA >= 0 ? '+' : ''}${fNum(kwhB - kwhA)} kWh`)}
      ${kpi('Variación medio diario', fPct(varM), `${fNum(mA)} → ${fNum(mB)} kWh/día`)}
    </div>
    <div class="card">
      <h3>Consumo total mensual</h3>
      <div class="bar-chart">${groupedBarsSVG(
        r.S0.porMes.map((m, i) => ({
          label: `${MESES_SHORT[m.mes]} ${String(m.year).slice(2)}`,
          antes: m.resumen.consumoKwh,
          ahora: r.S3.porMes[i]?.resumen.consumoKwh || 0,
        })),
        fKwh,
      )}</div>
    </div>
    <div class="card">
      <h3>Detalle factura a factura</h3>
      ${dataTable(
        ['Mes', 'Antes (kWh · días)', 'Ahora (kWh · días)', 'Δ kWh', 'Δ %'],
        r.S0.porMes.map((m, i) => {
          const a = r.S3.porMes[i]
          const da = m.resumen.consumoKwh
          const db = a?.resumen.consumoKwh || 0
          const delta = db - da
          const pct = da > 0 ? (delta / da) * 100 : 0
          return [
            `${MESES[m.mes]} ${m.year}`,
            `${fNum(da)} · ${m.resumen.dias}`,
            `${fNum(db)} · ${a?.resumen.dias || 0}`,
            `${delta >= 0 ? '+' : ''}${fNum(delta)}`,
            fPct(pct),
          ]
        }),
      )}
    </div>
  </div>`
}

function estimacionPanel(r: ResultadoTripartito, supplyType: 'luz' | 'gas'): string {
  const d = r.descomposicion
  const cn = r.cambiosNormativos
  const huboNorm = cn.some(c => c.ivaCambio || c.ieCambio || c.iehCambio)

  return `<div class="tab-panel" id="panel-estimacion-${supplyType}">
    <div class="section-header">
      <div class="meta">${supplyType.toUpperCase()} · METODOLOGÍA TRIPARTITA</div>
      <h2>¿De dónde viene cada euro de ahorro?</h2>
    </div>
    <div class="kpi-grid">
      ${kpi('Por cambio de tarifa (Voltis)', fEur(d.ahorroTarifa), `${fPct(d.pctTarifa)} sobre S0`, true)}
      ${kpi('Por cambio normativo (Gobierno)', fEur(d.ahorroNormativo), `${fPct(d.pctNormativo)} sobre S0`)}
      ${kpi('Por menor consumo (Cliente)', fEur(d.ahorroConsumo), `${fPct(d.pctConsumo)} sobre S0`)}
      ${kpi('Ahorro total verificado', fEur(d.ahorroTotal), fPct(d.pctTotal), true)}
    </div>
    <div class="card"><h3>Descomposición del ahorro</h3>${tripartitaBarHTML(d)}</div>
    <div class="card">
      <h3>Los 4 escenarios</h3>
      ${dataTable(
        ['Escenario', 'Qué representa', 'Total'],
        [
          ['S0 · Antigua real', 'Lo que pagaste con tu antigua comercializadora', fEur(d.S0)],
          ['S1 · Voltis @ régimen antiguo', 'Mismo consumo, precios Voltis, IVA/IE/IEH del año pasado', fEur(d.S1)],
          ['S2 · Voltis @ régimen actual', 'Mismo consumo, precios Voltis, IVA/IE/IEH del año en curso', fEur(d.S2)],
          ['S3 · Voltis real', 'Lo que has pagado realmente con Voltis', fEur(d.S3)],
        ],
      )}
      <div style="margin-top:14px;padding:12px;background:#EEF4FB;border-radius:10px;font-size:12px;color:#5A5A5A">
        <strong style="color:#133B7A">Identidad verificada:</strong> S0 − S3 = (S0 − S1) + (S1 − S2) + (S2 − S3) =
        tarifa + normativo + consumo. Residual de verificación: <strong>${esc(fEur(d.residualVerificacion, 4))}</strong>
      </div>
    </div>
    <div class="card">
      <h3>Cambios normativos detectados</h3>
      ${!huboNorm
        ? `<p style="font-size:13px;color:#5A5A5A;margin:0">No hay cambios fiscales relevantes entre los periodos comparados. Todo el ahorro de tarifa es atribuible a Voltis.</p>`
        : dataTable(
            ['Mes', 'IVA', supplyType === 'luz' ? 'IE' : 'IEH', '¿Cambio?'],
            cn.map(c => [
              `${MESES[c.mes]} ${c.year}`,
              c.ivaCambio ? `${fPct(c.ivaAntigua * 100)} → ${fPct(c.ivaVoltis * 100)}` : fPct(c.ivaVoltis * 100),
              supplyType === 'luz'
                ? (c.ieCambio
                    ? `${fPct((c.ieAntigua ?? 0) * 100, 3)} → ${fPct((c.ieVoltis ?? 0) * 100, 3)}`
                    : fPct((c.ieVoltis ?? 0) * 100, 3))
                : (c.iehCambio
                    ? `${(c.iehAntigua ?? 0).toFixed(6)} → ${(c.iehVoltis ?? 0).toFixed(6)} €/kWh`
                    : `${(c.iehVoltis ?? 0).toFixed(6)} €/kWh`),
              (c.ivaCambio || c.ieCambio || c.iehCambio) ? 'Sí' : '—',
            ]),
          )}
    </div>
    <div class="card">
      <h3>Detalle mes a mes</h3>
      ${dataTable(
        ['Mes', 'S0 antigua', 'S1 Voltis@antiguo', 'S2 Voltis@actual', 'S3 Voltis real'],
        r.S0.porMes.map((m, i) => [
          `${MESES[m.mes]} ${m.year}`,
          fEur(m.total),
          fEur(r.S1.porMes[i]?.total || 0),
          fEur(r.S2.porMes[i]?.total || 0),
          fEur(r.S3.porMes[i]?.total || 0),
        ]),
        ['Total', fEur(d.S0), fEur(d.S1), fEur(d.S2), fEur(d.S3)],
      )}
    </div>
  </div>`
}

function documentosPanel(pdfsLuz: PdfEmbed[], pdfsGas: PdfEmbed[]): string {
  const docCard = (p: PdfEmbed, color: string) => `
    <div class="doc-card" style="border-top:3px solid ${color}" onclick="window.downloadDoc('${esc(p.invoiceId)}')">
      <div class="icon" style="background:${color}1F;color:${color}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div class="title">${esc(p.mesLabel)}</div>
      <div class="subtitle">${esc(p.comercializadora || (p.side === 'voltis' ? 'Voltis' : 'Antigua'))}</div>
      <div class="size">${fNum(p.sizeKb)} KB · click para descargar</div>
    </div>
  `

  const seccion = (titulo: string, pdfs: PdfEmbed[]) => {
    if (!pdfs.length) return ''
    const antiguas = pdfs.filter(p => p.side === 'antigua')
    const voltis = pdfs.filter(p => p.side === 'voltis')
    return `<div style="margin-bottom:32px">
      <h3 style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1A1A1A">${esc(titulo)}</h3>
      ${antiguas.length ? `<h4 style="margin:0 0 10px;color:#5A5A5A;font-size:12px;text-transform:uppercase;letter-spacing:0.6px">Antigua comercializadora</h4>
        <div class="doc-grid" style="margin-bottom:18px">${antiguas.map(p => docCard(p, '#B8C5D6')).join('')}</div>` : ''}
      ${voltis.length ? `<h4 style="margin:0 0 10px;color:#5A5A5A;font-size:12px;text-transform:uppercase;letter-spacing:0.6px">Voltis</h4>
        <div class="doc-grid">${voltis.map(p => docCard(p, '#1B4FA0')).join('')}</div>` : ''}
    </div>`
  }

  return `<div class="tab-panel" id="panel-documentos">
    <div class="section-header">
      <div class="meta">DOCUMENTOS</div>
      <h2>Facturas del periodo comparado</h2>
    </div>
    ${seccion('Luz', pdfsLuz)}
    ${seccion('Gas', pdfsGas)}
    ${(pdfsLuz.length + pdfsGas.length) === 0 ? `<p style="font-size:13px;color:#8A8A8A">No hay facturas adjuntas en este informe.</p>` : ''}
  </div>`
}

// ── HTML completo ─────────────────────────────────────────────────────────

// ── Iconos SVG inline (Tabler-style) ──────────────────────────────────────
const ICON = {
  bolt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0"><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/></svg>',
  chart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0"><path d="M3 13a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M9 9a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M15 5a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M4 20h14"/></svg>',
  calc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0"><path d="M4 3m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M8 7m0 1a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v1a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1z"/><path d="M8 14l0 .01"/><path d="M12 14l0 .01"/><path d="M16 14l0 .01"/><path d="M8 17l0 .01"/><path d="M12 17l0 .01"/><path d="M16 17l0 .01"/></svg>',
  flame: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0"><path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a5 5 0 0 0 10 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -2 2z"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/></svg>',
}

/**
 * Genera HTML standalone con AMBOS suministros (luz + gas) si el cliente
 * tiene los dos. Si solo tiene uno, omite las pestañas del otro.
 * El parámetro `pdfs` agrupa todas las facturas (tanto luz como gas).
 */
export function generarHtmlStandalone(args: {
  supply: SupplyInfo
  /** Resultado tripartito de luz (si el cliente tiene supply de luz con facturas Voltis). */
  resultadoLuz?: ResultadoTripartito | null
  /** Resultado tripartito de gas (si el cliente tiene supply de gas con facturas Voltis). */
  resultadoGas?: ResultadoTripartito | null
  /** PDFs embebidos de TODAS las facturas (luz + gas) del periodo comparado. */
  pdfs: PdfEmbed[]
  /** CUPS del suministro principal (el que el usuario abrió). */
  cupsPrincipal?: string | null
  /** Imagen mascota Buddy en base64 (sin prefijo data:). Si no, se usa SVG fallback. */
  mascotBase64?: string | null
  /** MIME de la mascota (image/png, image/jpeg…). Default: image/png. */
  mascotMime?: string
}): string {
  const { supply, resultadoLuz, resultadoGas, pdfs, cupsPrincipal, mascotBase64, mascotMime } = args
  const hasLuz = !!resultadoLuz && resultadoLuz.pares.length > 0
  const hasGas = !!resultadoGas && resultadoGas.pares.length > 0

  if (!hasLuz && !hasGas) {
    // Caso extremo: ningún resultado válido. Devolver HTML mínimo.
    return `<!DOCTYPE html><html><body style="font-family:Inter;padding:40px;text-align:center">
      <h1>Comparativa Voltis</h1>
      <p>No se han encontrado parejas factura antigua ↔ Voltis para generar la comparativa.</p>
    </body></html>`
  }

  // Pestañas dinámicas según lo que haya disponible
  const tabs: Array<{ id: string; label: string; icon: string }> = []
  if (hasLuz) {
    tabs.push({ id: 'ahorro-luz', label: 'Ahorro luz', icon: ICON.bolt })
    tabs.push({ id: 'consumos-luz', label: 'Consumos luz', icon: ICON.chart })
    tabs.push({ id: 'estimacion-luz', label: 'Estimación luz', icon: ICON.calc })
  }
  if (hasGas) {
    tabs.push({ id: 'ahorro-gas', label: 'Ahorro gas', icon: ICON.flame })
    tabs.push({ id: 'estimacion-gas', label: 'Estimación gas', icon: ICON.calc })
  }
  tabs.push({ id: 'documentos', label: 'Documentos', icon: ICON.file })

  // Texto hero — se construye combinando luz/gas
  const cobertura = (hasLuz ? resultadoLuz! : resultadoGas!).cobertura
  const periodo = cobertura.desde && cobertura.hasta
    ? `${MESES_SHORT[cobertura.desde.mes]} ${cobertura.desde.year} – ${MESES_SHORT[cobertura.hasta.mes]} ${cobertura.hasta.year}`
    : '—'
  const tipoDescr = hasLuz && hasGas
    ? 'eléctrica y de gas natural'
    : (hasLuz ? 'eléctrica' : 'de gas natural')
  const comercAntigua = (hasLuz && resultadoLuz?.comercializadoraAntigua)
    || (hasGas && resultadoGas?.comercializadoraAntigua)
    || 'tu antigua comercializadora'

  // CUPS / tarifa visibles en el topbar: el principal si está, si no el primero disponible
  const cupsVisible = cupsPrincipal || supply.cups || (hasLuz ? resultadoLuz?.cups : null) || (hasGas ? resultadoGas?.cups : null) || '—'
  const tarifaVisible = supply.tariff
    || (hasLuz ? resultadoLuz?.tarifa : null)
    || (hasGas ? resultadoGas?.tarifa : null)
    || '—'

  // Diccionario JS de PDFs embebidos (compartido luz + gas)
  const docsObj = pdfs.reduce<Record<string, { data: string; mime: string; filename: string }>>((acc, p) => {
    acc[p.invoiceId] = { data: p.base64, mime: p.mime, filename: p.filename }
    return acc
  }, {})

  // Validación: sumar facturas mal de ambos
  const facturasMal =
    (resultadoLuz?.validacionFacturas.filter(v => !v.ok).length || 0)
    + (resultadoGas?.validacionFacturas.filter(v => !v.ok).length || 0)

  // PDFs filtrados por tipo para la pestaña Documentos
  const pdfsLuz = pdfs.filter(p => p.supplyType === 'luz')
  const pdfsGas = pdfs.filter(p => p.supplyType === 'gas')

  const firstTabId = tabs[0].id

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Voltis · Comparativa · ${esc(supply.client_name || 'Cliente')}</title>
<style>${CSS}</style>
</head>
<body>
  <header class="hero">
    <div class="topbar">
      <div style="display:flex;flex-direction:column;line-height:1.3">
        <span class="label">Cliente</span>
        <span class="name">${esc(supply.client_name || '—')}</span>
      </div>
      <div class="topbar-right">
        <div class="small">CUPS</div>
        <div class="big">${esc(cupsVisible)}</div>
        <div class="small">${esc(tarifaVisible)} · ${hasLuz && hasGas ? 'Luz + Gas' : (hasLuz ? 'Electricidad' : 'Gas natural')}</div>
      </div>
    </div>
    <div class="hero-content">
      <div class="hero-text">
        <h1>Tu ahorro energético, en datos</h1>
        <p>Comparativa ${esc(tipoDescr)} de ${cobertura.mesesComparados} ${cobertura.mesesComparados === 1 ? 'mes' : 'meses'} (${esc(periodo)}) con Voltis frente a ${esc(comercAntigua)}.</p>
      </div>
      ${buddyHtml(mascotBase64, mascotMime)}
    </div>
  </header>

  <div class="container">
    <div class="tabs">
      ${tabs.map(t => `<button class="tab ${t.id === firstTabId ? 'active' : ''}" data-tab="${esc(t.id)}">${t.icon}<span>${esc(t.label)}</span></button>`).join('')}
    </div>

    ${hasLuz ? ahorroPanel(resultadoLuz!, 'luz', firstTabId === 'ahorro-luz') : ''}
    ${hasLuz ? consumosPanel(resultadoLuz!) : ''}
    ${hasLuz ? estimacionPanel(resultadoLuz!, 'luz') : ''}
    ${hasGas ? ahorroPanel(resultadoGas!, 'gas', firstTabId === 'ahorro-gas') : ''}
    ${hasGas ? estimacionPanel(resultadoGas!, 'gas') : ''}
    ${documentosPanel(pdfsLuz, pdfsGas)}

    ${facturasMal > 0 ? `<div class="warning"><strong>⚠ Validación:</strong> ${facturasMal} factura(s) tienen una desviación &gt;0,10 € entre el total declarado y la reconstrucción.</div>` : ''}

    <div style="text-align:center;margin-top:32px">
      <button class="btn-print" onclick="window.print()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Imprimir / Guardar como PDF
      </button>
    </div>

    <footer>
      <span style="text-transform:uppercase;letter-spacing:0.8px">Voltis · Comparativa de coste real</span>
      <span>Generado ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
    </footer>
  </div>

  <script>
  (function() {
    function init() {
      try {
        // ── Tabs: click + touchend para iOS, sin doble disparo ─────────────
        var tabs = document.querySelectorAll('.tab');
        var panels = document.querySelectorAll('.tab-panel');
        function activate(tabBtn) {
          for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
          for (var j = 0; j < panels.length; j++) panels[j].classList.remove('active');
          tabBtn.classList.add('active');
          var target = document.getElementById('panel-' + tabBtn.dataset.tab);
          if (target) target.classList.add('active');
        }
        Array.prototype.forEach.call(tabs, function(t) {
          t.addEventListener('click', function(e) { e.preventDefault(); activate(t); });
        });

        // ── Documentos: base64 → blob → download ───────────────────────────
        var DOCS = window.__VOLTIS_DOCS__ || {};
        function b64ToBlob(b64, mime) {
          var bin = atob(b64);
          var buf = new Uint8Array(bin.length);
          for (var k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
          return new Blob([buf], { type: mime });
        }
        window.downloadDoc = function(key) {
          var doc = DOCS[key];
          if (!doc) return;
          var blob = b64ToBlob(doc.data, doc.mime);
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = doc.filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function() { URL.revokeObjectURL(url); }, 100);
        };
      } catch (err) {
        console.error('[Voltis HTML] init error:', err);
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
  </script>
  <script id="__voltis_docs_data" type="application/json">${JSON.stringify(docsObj).replace(/</g, '\\u003c')}</script>
  <script>
    try { window.__VOLTIS_DOCS__ = JSON.parse(document.getElementById('__voltis_docs_data').textContent); }
    catch(e) { window.__VOLTIS_DOCS__ = {}; console.error('[Voltis HTML] DOCS parse error', e); }
  </script>
</body>
</html>`
}
