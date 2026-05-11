/**
 * Generador de PDF de comparativa eléctrica — Voltis Energía.
 *
 * Pure-JS, sin dependencias externas, mismo patrón que generate-invoice-pdf.ts.
 * Produce un PDF A4 (595×842 pt) con la comparativa de las 3 tarifas 2.0TD de
 * Gana Energía, marca Voltis y, claramente identificada como la
 * comercializadora propuesta, "Gana Energía".
 *
 * Estructura mimética (en información) al PDF que produce el portal de
 * colaboradores de Gana, pero con identidad Voltis.
 */

import type { ResultadoComparativa, ResultadoTarifa } from './calcular'

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ComparativaPdfData {
  /** Nº de comparativa interno (ej. "COMP-2026-0001") */
  numero?: string
  /** Fecha de generación, ISO date (YYYY-MM-DD) */
  fecha: string

  cliente?: {
    nombre?: string
    dni?: string
    email?: string
    telefono?: string
  }

  suministro?: {
    cups?: string
    direccion?: string
    distribuidora?: string
    comercializadoraActual?: string
    /** Siempre "2.0TD" en este MVP */
    tarifa?: string
  }

  /** Datos del comercial Voltis que genera la comparativa */
  comercial?: {
    nombre?: string
    email?: string
    telefono?: string
  }

  /** Resultado del motor de cálculo (las 3 tarifas) */
  resultado: ResultadoComparativa

  /** Extras opcionales que el cliente paga ahora (ahorro extra al cambiar) */
  extras?: { concepto: string; importeAnual: number }[]
}

// ── Paleta Voltis (de tailwind.config.ts) ────────────────────────────────────

const C = {
  brand:    [31, 58, 46]   as [number, number, number],   // #1F3A2E
  brand2:   [47, 92, 71]   as [number, number, number],   // #2F5C47
  ink:      [45, 58, 51]   as [number, number, number],   // #2D3A33
  ink3:     [90, 107, 95]  as [number, number, number],   // #5A6B5F
  ink4:     [138, 154, 142] as [number, number, number],  // #8A9A8E
  line:     [229, 220, 201] as [number, number, number],  // #E5DCC9
  line2:    [217, 208, 186] as [number, number, number],  // #D9D0BA
  card:     [251, 247, 238] as [number, number, number],  // #FBF7EE
  bg:       [244, 238, 226] as [number, number, number],  // #F4EEE2
  salvia:   [107, 128, 104] as [number, number, number],  // #6B8068
  salviaSoft: [224, 232, 220] as [number, number, number],// #E0E8DC
  volt:     [199, 242, 74]  as [number, number, number],  // #C7F24A
  voltInk:  [29, 44, 14]    as [number, number, number],  // #1D2C0E
  ok:       [76, 138, 84]   as [number, number, number],  // sage-derived
  warn:     [196, 138, 50]  as [number, number, number],
  white:    [255, 255, 255] as [number, number, number],
}

// ── PDF builder (igual patrón que generate-invoice-pdf.ts) ───────────────────

function pdfHex(s: string): string {
  const bytes: string[] = []
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c < 256) bytes.push(c.toString(16).padStart(2, '0'))
    else if (c === 0x20ac) bytes.push('80') // €
    else if (c === 0x2018 || c === 0x2019) bytes.push('27') // typographic quotes → '
    else if (c === 0x201c || c === 0x201d) bytes.push('22') // typographic quotes → "
    else bytes.push('3f') // ?
  }
  return '<' + bytes.join('') + '>'
}

class PDF {
  private W = 595
  private H = 842
  private ops: string[] = []

  private py(y: number) { return this.H - y }

  rect(x: number, y: number, w: number, h: number, fill: [number, number, number]) {
    const pdfY = this.py(y + h)
    this.ops.push(
      `${(fill[0]/255).toFixed(4)} ${(fill[1]/255).toFixed(4)} ${(fill[2]/255).toFixed(4)} rg`,
      `${x} ${pdfY} ${w} ${h} re f`,
    )
  }

  border(x: number, y: number, w: number, h: number, color: [number, number, number], lw = 0.4) {
    const pdfY = this.py(y + h)
    this.ops.push(
      `${(color[0]/255).toFixed(4)} ${(color[1]/255).toFixed(4)} ${(color[2]/255).toFixed(4)} RG`,
      `${lw.toFixed(2)} w`,
      `${x} ${pdfY} ${w} ${h} re S`,
    )
  }

  hline(x1: number, y: number, x2: number, color: [number, number, number] = C.line, lw = 0.5) {
    const pdfY = this.py(y)
    this.ops.push(
      `${(color[0]/255).toFixed(4)} ${(color[1]/255).toFixed(4)} ${(color[2]/255).toFixed(4)} RG`,
      `${lw.toFixed(2)} w`,
      `${x1} ${pdfY} m ${x2} ${pdfY} l S`,
    )
  }

  text(
    x: number, y: number,
    s: string,
    size: number,
    font: 'R' | 'B' = 'R',
    color: [number, number, number] = C.ink,
    align: 'left' | 'right' | 'center' = 'left',
    maxWidth?: number,
  ) {
    if (!s) return
    const baseline = this.py(y + size * 0.72)
    let tx = x
    if (align === 'right' && maxWidth != null) tx = x + maxWidth - this.approxWidth(s, size, font)
    if (align === 'center' && maxWidth != null) tx = x + (maxWidth - this.approxWidth(s, size, font)) / 2
    this.ops.push(
      `BT`,
      `${(color[0]/255).toFixed(4)} ${(color[1]/255).toFixed(4)} ${(color[2]/255).toFixed(4)} rg`,
      `/F${font} ${size} Tf`,
      `${tx.toFixed(2)} ${baseline.toFixed(2)} Tm`,
      `${pdfHex(s)} Tj`,
      `ET`,
    )
  }

  /** Approximation suficiente para alinear (Helvetica). Bold ~7% más ancho. */
  private approxWidth(s: string, size: number, font: 'R' | 'B' = 'R'): number {
    const factor = font === 'B' ? 0.56 : 0.52
    return s.length * size * factor
  }

  /**
   * Texto con dot leader hasta el ancho dado (estilo "Concepto ........... 12,34 €").
   */
  rowDots(
    x: number, y: number, width: number,
    label: string, value: string,
    size: number, font: 'R' | 'B' = 'R',
    color: [number, number, number] = C.ink,
  ) {
    this.text(x, y, label, size, font, color)
    this.text(x, y, value, size, font, color, 'right', width)
    // Puntos sutiles para guiar la lectura entre label y value
    const labelW = this.approxWidth(label, size, font) + 4
    const valueW = this.approxWidth(value, size, font) + 4
    const dotsStart = x + labelW
    const dotsEnd = x + width - valueW
    if (dotsEnd > dotsStart + 8) {
      this.ops.push(
        `BT`,
        `${(C.line2[0]/255).toFixed(4)} ${(C.line2[1]/255).toFixed(4)} ${(C.line2[2]/255).toFixed(4)} rg`,
        `/FR ${size} Tf`,
        `${dotsStart.toFixed(2)} ${this.py(y + size * 0.72).toFixed(2)} Tm`,
        `${pdfHex('.'.repeat(Math.floor((dotsEnd - dotsStart) / (size * 0.36))))} Tj`,
        `ET`,
      )
    }
  }

  build(): Buffer {
    const body: string[] = []
    const offsets: number[] = []
    let pos = 0
    const push = (s: string) => { body.push(s); pos += Buffer.byteLength(s, 'latin1') }

    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')

    offsets[1] = pos
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

    offsets[2] = pos
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

    offsets[4] = pos
    push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n')

    offsets[5] = pos
    push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n')

    const streamContent = this.ops.join('\n')
    const streamBytes = Buffer.byteLength(streamContent, 'latin1')
    offsets[6] = pos
    push(`6 0 obj\n<< /Length ${streamBytes} >>\nstream\n`)
    push(streamContent)
    push('\nendstream\nendobj\n')

    offsets[3] = pos
    push(
      '3 0 obj\n<< /Type /Page /Parent 2 0 R' +
      ` /MediaBox [0 0 ${this.W} ${this.H}]` +
      ' /Contents 6 0 R' +
      ' /Resources << /Font << /FR 4 0 R /FB 5 0 R >> >> >>\nendobj\n'
    )

    const xrefOffset = pos
    const count = 7
    push(`xref\n0 ${count}\n`)
    push(`0000000000 65535 f \n`)
    for (let i = 1; i < count; i++) {
      push(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`)
    }

    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

    return Buffer.from(body.join(''), 'latin1')
  }
}

// ── Helpers de formato ───────────────────────────────────────────────────────

function fmtEur(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function fmtKwh(n: number): string {
  return Math.round(n).toLocaleString('es-ES') + ' kWh'
}

function fmtKw(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + ' kW'
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Layout principal ─────────────────────────────────────────────────────────

export function generateComparativaPDF(data: ComparativaPdfData): Buffer {
  const p = new PDF()
  const W = 595
  const margin = 36
  const innerW = W - margin * 2

  const ahorroExtras = (data.extras ?? []).reduce((s, e) => s + e.importeAnual, 0)
  const mejor = data.resultado.resultados.find(
    (r) => r.tarifa.id === data.resultado.mejorTarifaId,
  ) ?? data.resultado.resultados[0]

  // ══ HEADER (banda verde Voltis) ═══════════════════════════════════════════
  p.rect(0, 0, W, 88, C.brand)
  // "Logo": círculo con icono
  p.rect(margin, 22, 44, 44, C.volt)
  p.text(margin + 12, 35, 'V', 22, 'B', C.voltInk)
  // Tipografía
  p.text(margin + 56, 24, 'VOLTIS ENERGÍA', 18, 'B', C.white)
  p.text(margin + 56, 47, 'energía honesta y bien pensada', 9, 'R', [200, 218, 200])
  // Right side — número y fecha
  p.text(0, 28, 'COMPARATIVA ELÉCTRICA', 9, 'B', [200, 218, 200], 'right', W - margin)
  p.text(0, 44, data.numero || `COMP-${data.fecha.replace(/-/g, '')}`, 12, 'B', C.white, 'right', W - margin)
  p.text(0, 64, fmtFecha(data.fecha), 9, 'R', [200, 218, 200], 'right', W - margin)

  // ══ DATOS DEL CLIENTE Y SUMINISTRO ═════════════════════════════════════════
  let y = 110

  p.text(margin, y, 'DATOS DEL CLIENTE', 8, 'B', C.salvia)
  p.text(margin + innerW / 2 + 8, y, 'DATOS DEL SUMINISTRO', 8, 'B', C.salvia)
  p.hline(margin, y + 12, margin + innerW / 2 - 8, C.line)
  p.hline(margin + innerW / 2 + 8, y + 12, margin + innerW, C.line)
  y += 18

  const colW = innerW / 2 - 8
  const left = margin
  const right = margin + innerW / 2 + 8

  let yL = y
  let yR = y
  const dataRow = (x: number, yy: number, label: string, value: string | undefined | null) => {
    p.text(x, yy, label, 8, 'R', C.ink4)
    p.text(x + 70, yy, (value && String(value).trim()) || '—', 9, 'R', C.ink, 'left', colW - 70)
  }

  dataRow(left, yL, 'Titular', data.cliente?.nombre); yL += 14
  dataRow(left, yL, 'DNI/CIF', data.cliente?.dni); yL += 14
  dataRow(left, yL, 'Email', data.cliente?.email); yL += 14
  dataRow(left, yL, 'Teléfono', data.cliente?.telefono); yL += 14

  dataRow(right, yR, 'CUPS', data.suministro?.cups); yR += 14
  dataRow(right, yR, 'Dirección', data.suministro?.direccion); yR += 14
  dataRow(right, yR, 'Distribuidora', data.suministro?.distribuidora); yR += 14
  dataRow(right, yR, 'Tarifa acceso', data.suministro?.tarifa || '2.0TD'); yR += 14

  y = Math.max(yL, yR) + 8

  // ══ TU SITUACIÓN ACTUAL ════════════════════════════════════════════════════
  p.rect(margin, y, innerW, 24, C.salviaSoft)
  p.text(margin + 12, y + 7, 'TU SITUACIÓN ACTUAL', 10, 'B', C.brand)
  p.text(0, y + 7, `Comercializadora: ${data.suministro?.comercializadoraActual || '—'}`, 9, 'R', C.ink, 'right', W - margin - 12)
  y += 32

  // Tabla resumen consumo
  const input = data.resultado.input
  p.rect(margin, y, innerW, 70, C.card)
  p.border(margin, y, innerW, 70, C.line)
  // Potencia
  const pcol = margin + 16
  p.text(pcol, y + 10, 'POTENCIA CONTRATADA', 7, 'B', C.ink4)
  p.text(pcol, y + 24, fmtKw(input.potencias.p1), 11, 'B', C.ink)
  p.text(pcol + 70, y + 27, 'Punta (P1)', 8, 'R', C.ink3)
  p.text(pcol, y + 44, fmtKw(input.potencias.p2), 11, 'B', C.ink)
  p.text(pcol + 70, y + 47, 'Valle (P2)', 8, 'R', C.ink3)
  // Energía
  const ecol = margin + innerW * 0.40
  p.text(ecol, y + 10, 'CONSUMO ANUAL', 7, 'B', C.ink4)
  p.text(ecol, y + 24, fmtKwh(input.energias.punta), 10, 'R', C.ink)
  p.text(ecol + 90, y + 24, 'Punta', 8, 'R', C.ink3)
  p.text(ecol, y + 38, fmtKwh(input.energias.llano), 10, 'R', C.ink)
  p.text(ecol + 90, y + 38, 'Llano', 8, 'R', C.ink3)
  p.text(ecol, y + 52, fmtKwh(input.energias.valle), 10, 'R', C.ink)
  p.text(ecol + 90, y + 52, 'Valle', 8, 'R', C.ink3)
  // Total
  const tcol = margin + innerW * 0.72
  const totalKwh = input.energias.punta + input.energias.llano + input.energias.valle
  p.text(tcol, y + 10, 'TOTAL ANUAL', 7, 'B', C.ink4)
  p.text(tcol, y + 24, fmtKwh(totalKwh), 13, 'B', C.brand)
  p.text(tcol, y + 44, 'Pagado al año', 8, 'R', C.ink3)
  p.text(tcol, y + 56, fmtEur(input.totalFacturaActual), 13, 'B', C.brand)
  y += 80

  // ══ PROPUESTA GANA ENERGÍA ═════════════════════════════════════════════════
  p.rect(margin, y, innerW, 28, C.brand)
  p.text(margin + 12, y + 6, 'PROPUESTA · GANA ENERGÍA', 11, 'B', C.white)
  p.text(0, y + 8, 'Comercializadora propuesta', 8, 'R', [200, 218, 200], 'right', W - margin - 12)
  y += 38

  // Tres tarjetas de tarifa lado a lado
  const tariffs = data.resultado.resultados
  const cardGap = 8
  const cardW = (innerW - cardGap * 2) / 3
  const cardH = 110

  for (let i = 0; i < tariffs.length; i++) {
    const r = tariffs[i]
    const cx = margin + i * (cardW + cardGap)
    const esMejor = r.tarifa.id === data.resultado.mejorTarifaId

    if (esMejor) {
      p.rect(cx, y, cardW, cardH, C.salviaSoft)
      p.border(cx, y, cardW, cardH, C.salvia, 1.2)
      // Badge "MEJOR OPCIÓN"
      p.rect(cx + cardW - 78, y - 8, 70, 16, C.brand)
      p.text(cx + cardW - 78, y - 4, 'MEJOR OPCIÓN', 7, 'B', C.volt, 'center', 70)
    } else {
      p.rect(cx, y, cardW, cardH, C.card)
      p.border(cx, y, cardW, cardH, C.line, 0.5)
    }

    const tx = cx + 12
    p.text(tx, y + 10, '2.0TD', 7, 'B', C.ink4)
    p.text(tx, y + 22, r.tarifa.nombre, 10, 'B', C.brand)
    p.hline(tx, y + 40, cx + cardW - 12, C.line, 0.4)

    p.text(tx, y + 46, 'Total con Gana', 7, 'R', C.ink4)
    p.text(tx, y + 56, fmtEur(r.total), 14, 'B', C.ink)

    p.text(tx, y + 76, 'Ahorro anual', 7, 'R', C.ink4)
    const ahorroColor = r.ahorro > 0 ? C.ok : (r.ahorro < 0 ? C.warn : C.ink)
    const sign = r.ahorro >= 0 ? '+' : ''
    p.text(tx, y + 86, `${sign}${fmtEur(r.ahorro)}`, 12, 'B', ahorroColor)
    if (input.totalFacturaActual > 0) {
      const pct = (r.ahorro / input.totalFacturaActual) * 100
      p.text(tx + 80, y + 89, `(${sign}${pct.toFixed(1)} %)`, 8, 'R', C.ink3)
    }
  }

  y += cardH + 20

  // ══ DESGLOSE DE LA MEJOR OPCIÓN ════════════════════════════════════════════
  p.text(margin, y, `DESGLOSE — ${mejor.tarifa.nombre.toUpperCase()}`, 8, 'B', C.salvia)
  p.hline(margin, y + 12, margin + innerW, C.line)
  y += 18

  const desglose: { label: string; value: number; bold?: boolean }[] = [
    { label: 'Coste potencia P1 (Punta)', value: mejor.costePotencia.p1 },
    { label: 'Coste potencia P2 (Valle)', value: mejor.costePotencia.p2 },
    { label: 'Coste energía Punta', value: mejor.costeEnergia.punta },
    { label: 'Coste energía Llano', value: mejor.costeEnergia.llano },
    { label: 'Coste energía Valle', value: mejor.costeEnergia.valle },
  ]
  if (mejor.servicioGanaEnergia > 0) {
    desglose.push({ label: 'Servicio Gana Energía', value: mejor.servicioGanaEnergia })
  }
  desglose.push({ label: 'Bono Social', value: mejor.bonoSocial })
  desglose.push({ label: 'Impuesto eléctrico', value: mejor.impuestoElectrico })
  desglose.push({ label: 'Subtotal sin IVA', value: mejor.totalSinIva, bold: true })
  desglose.push({ label: `IVA (${data.resultado.input.ivaPct}%)`, value: mejor.iva })
  if (mejor.alquiler > 0) desglose.push({ label: 'Alquiler de equipo', value: mejor.alquiler })
  if (mejor.descuentoDespuesIva > 0) desglose.push({ label: 'Descuento', value: -mejor.descuentoDespuesIva })
  desglose.push({ label: 'TOTAL ANUAL', value: mejor.total, bold: true })

  for (const row of desglose) {
    if (row.bold) p.hline(margin, y - 1, margin + innerW, C.line, 0.3)
    p.rowDots(
      margin, y, innerW,
      row.label, fmtEur(row.value),
      row.bold ? 9 : 8,
      row.bold ? 'B' : 'R',
      row.bold ? C.brand : C.ink,
    )
    y += row.bold ? 13 : 11
  }
  y += 6

  // ══ EXTRAS (si los hay) ═══════════════════════════════════════════════════
  if ((data.extras ?? []).length > 0) {
    p.text(margin, y, 'AHORRO ADICIONAL AL CANCELAR EXTRAS', 8, 'B', C.salvia)
    p.hline(margin, y + 12, margin + innerW, C.line)
    y += 18

    for (const e of data.extras!) {
      p.rowDots(margin, y, innerW, e.concepto, `${fmtEur(e.importeAnual)}/año`, 8, 'R', C.ink)
      y += 11
    }
    p.hline(margin, y - 1, margin + innerW, C.line, 0.3)
    p.rowDots(margin, y, innerW, 'Total ahorro extras anual', fmtEur(ahorroExtras), 9, 'B', C.brand)
    y += 18
  }

  // ══ RESUMEN AHORRO ═════════════════════════════════════════════════════════
  const ahorroBaseAnual = mejor.ahorroAnyo
  const ahorroTotalAnual = ahorroBaseAnual + ahorroExtras

  const ahorroBoxH = 60
  p.rect(margin, y, innerW, ahorroBoxH, C.brand)
  p.text(margin + 16, y + 10, 'AHORRARÁS AL AÑO', 9, 'B', C.volt)
  p.text(margin + 16, y + 24, fmtEur(ahorroTotalAnual), 28, 'B', C.white)
  p.text(margin + 16, y + 50, `con ${mejor.tarifa.nombre} de Gana Energía`, 9, 'R', [200, 218, 200])

  if (ahorroExtras > 0) {
    const detailX = margin + innerW * 0.65
    p.text(detailX, y + 14, 'En tarifa de luz:', 8, 'R', [200, 218, 200])
    p.text(0, y + 14, fmtEur(ahorroBaseAnual), 9, 'B', C.white, 'right', W - margin - 16)
    p.text(detailX, y + 28, 'En extras cancelados:', 8, 'R', [200, 218, 200])
    p.text(0, y + 28, fmtEur(ahorroExtras), 9, 'B', C.white, 'right', W - margin - 16)
    p.hline(detailX, y + 40, W - margin - 16, [200, 218, 200], 0.3)
    p.text(detailX, y + 44, 'Total:', 8, 'B', C.volt)
    p.text(0, y + 44, fmtEur(ahorroTotalAnual), 10, 'B', C.volt, 'right', W - margin - 16)
  }

  y += ahorroBoxH + 14

  // ══ FOOTER ═════════════════════════════════════════════════════════════════
  const footY = 800
  p.hline(margin, footY - 24, W - margin, C.line, 0.3)

  if (data.comercial?.nombre) {
    p.text(margin, footY - 16, 'Comparativa generada por:', 7, 'R', C.ink4)
    p.text(margin, footY - 5, data.comercial.nombre, 9, 'B', C.ink)
    if (data.comercial.email) {
      p.text(margin + 130, footY - 5, data.comercial.email, 8, 'R', C.ink3)
    }
  }

  p.text(0, footY - 16, 'Voltis Soluciones S.L. · B-71548705 · voltisenergia.com', 7, 'R', C.ink4, 'right', W - margin)
  p.text(0, footY - 5, `Tarifas vigentes a ${fmtFecha(data.fecha)} — sujetas a revisión`, 7, 'R', C.ink4, 'right', W - margin)

  return p.build()
}
