/**
 * Pure-JS PDF invoice generator for Voltis Energía.
 * No external dependencies — generates valid PDF 1.4 binary.
 *
 * A4 page: 595 × 842 pt. Coordinates below are screen-space (top=0, down+),
 * converted to PDF space (bottom=0, up+) internally.
 */

export interface InvoiceData {
  invoiceNumber: string
  invoiceDate: string
  dueDate?: string
  clientName: string
  clientCif: string | null
  clientAddress: string | null
  clientCity: string | null
  clientEmail: string | null
  lines: { concept: string; amount: number }[]
}

// ── Encoding ──────────────────────────────────────────────────────────────────
/** Convert a string to a PDF hex string, using ISO-8859-1 for accented chars. */
function pdfHex(s: string): string {
  const bytes: string[] = []
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    // ISO-8859-1 covers most Spanish/French characters directly
    if (c < 256) {
      bytes.push(c.toString(16).padStart(2, '0'))
    } else if (c === 0x20ac) {
      bytes.push('80') // € in Windows-1252
    } else {
      bytes.push('3f') // '?'
    }
  }
  return '<' + bytes.join('') + '>'
}

function fmtEur(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR'
}

// ── Low-level PDF builder ─────────────────────────────────────────────────────

class PDF {
  private W = 595
  private H = 842
  private ops: string[] = [] // content stream operators

  // Convert from screen coords (top=0) to PDF coords (bottom=0)
  private py(y: number) { return this.H - y }

  // ── Primitives ──
  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number) {
    const pdfY = this.py(y + h) // bottom-left in PDF space
    this.ops.push(
      `${(r/255).toFixed(4)} ${(g/255).toFixed(4)} ${(b/255).toFixed(4)} rg`,
      `${x} ${pdfY} ${w} ${h} re f`,
    )
  }

  strokeRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, lw = 0.5) {
    const pdfY = this.py(y + h)
    this.ops.push(
      `${(r/255).toFixed(4)} ${(g/255).toFixed(4)} ${(b/255).toFixed(4)} RG`,
      `${lw} w`,
      `${x} ${pdfY} ${w} ${h} re S`,
    )
  }

  hline(x1: number, y: number, x2: number, r=0, g=0, b=0, lw=0.5) {
    const pdfY = this.py(y)
    this.ops.push(
      `${(r/255).toFixed(4)} ${(g/255).toFixed(4)} ${(b/255).toFixed(4)} RG`,
      `${lw} w`,
      `${x1} ${pdfY} m ${x2} ${pdfY} l S`,
    )
  }

  /**
   * Draw text. y is screen-space top of the "cell" (baseline ≈ y + size*0.8).
   * font: 'R'=Helvetica, 'B'=Helvetica-Bold
   */
  text(
    x: number, y: number,
    s: string,
    size: number,
    font: 'R' | 'B' = 'R',
    rgb: [number, number, number] = [0, 0, 0],
    align: 'left' | 'right' | 'center' = 'left',
    maxWidth?: number,
  ) {
    if (!s) return
    const baseline = this.py(y + size * 0.72)
    let tx = x
    if (align === 'right' && maxWidth != null) tx = x + maxWidth - this.approxWidth(s, size)
    if (align === 'center' && maxWidth != null) tx = x + (maxWidth - this.approxWidth(s, size)) / 2
    this.ops.push(
      `BT`,
      `${(rgb[0]/255).toFixed(4)} ${(rgb[1]/255).toFixed(4)} ${(rgb[2]/255).toFixed(4)} rg`,
      `/F${font} ${size} Tf`,
      `${tx.toFixed(2)} ${baseline.toFixed(2)} Tm`,
      `${pdfHex(s)} Tj`,
      `ET`,
    )
  }

  /** Very rough character-width approximation for Helvetica. */
  private approxWidth(s: string, size: number): number {
    return s.length * size * 0.52
  }

  // ── Assemble PDF ──
  build(): Buffer {
    const body: string[] = []
    const offsets: number[] = []
    let pos = 0

    const push = (s: string) => { body.push(s); pos += Buffer.byteLength(s, 'latin1') }

    // Header
    const header = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
    push(header)

    // Object 1: Catalog
    offsets[1] = pos
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

    // Object 2: Pages
    offsets[2] = pos
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

    // Object 4: Font Helvetica (regular)
    offsets[4] = pos
    push(
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica' +
      ' /Encoding /WinAnsiEncoding >>\nendobj\n'
    )

    // Object 5: Font Helvetica-Bold
    offsets[5] = pos
    push(
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold' +
      ' /Encoding /WinAnsiEncoding >>\nendobj\n'
    )

    // Object 6: Content stream
    const streamContent = this.ops.join('\n')
    const streamBytes = Buffer.from(streamContent, 'latin1')
    offsets[6] = pos
    push(`6 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`)
    const beforeStream = pos
    push(streamContent)
    push('\nendstream\nendobj\n')

    // Object 3: Page
    offsets[3] = pos
    push(
      '3 0 obj\n<< /Type /Page /Parent 2 0 R' +
      ` /MediaBox [0 0 ${this.W} ${this.H}]` +
      ' /Contents 6 0 R' +
      ' /Resources << /Font << /FR 4 0 R /FB 5 0 R >> >> >>\nendobj\n'
    )

    // xref
    const xrefOffset = pos
    const count = 7
    push(`xref\n0 ${count}\n`)
    push(`0000000000 65535 f \n`)
    for (let i = 1; i < count; i++) {
      push(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`)
    }

    // trailer
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

    // Fix font references in stream: we used /FR and /FB
    // Re-patch the content with proper font names
    return Buffer.from(
      body.join('')
        .replace(/\/FR /g, '/FR ')
        .replace(/\/FB /g, '/FB '),
      'latin1'
    )
  }
}

// Override text() to use /FR and /FB font names
function addText(
  p: PDF,
  x: number, y: number,
  s: string, size: number,
  font: 'R' | 'B' = 'R',
  rgb: [number, number, number] = [0, 0, 0],
  align: 'left' | 'right' | 'center' = 'left',
  maxWidth?: number,
) {
  (p as any).text(x, y, s, size, font, rgb, align, maxWidth)
}

// ── Invoice layout ────────────────────────────────────────────────────────────

export function generateInvoicePDF(data: InvoiceData): Buffer {
  const p = new PDF()
  const W = 595
  const margin = 42

  // ── Header bar ──
  p.fillRect(0, 0, W, 72, 26, 58, 107) // dark blue

  // Company name in header
  addText(p, margin, 14, 'Voltis Energía', 22, 'B', [255, 255, 255])
  addText(p, margin, 44, 'Voltis Soluciones S.L.  ·  B-71548705', 9, 'R', [200, 215, 240])

  // ── Sender info (left column) ──
  let sy = 90
  addText(p, margin, sy, 'Calle Berriobide 38, Oficina 209', 9, 'R', [80, 80, 80]); sy += 14
  addText(p, margin, sy, '31013 Ansoáin, Navarra', 9, 'R', [80, 80, 80]); sy += 14
  addText(p, margin, sy, 'facturacion@voltisenergia.com', 9, 'R', [80, 80, 80]); sy += 14

  // ── Client info (right column) ──
  const cx = 320
  addText(p, cx, 90, 'Facturado a:', 8, 'R', [120, 120, 120])
  addText(p, cx, 106, data.clientName || '', 11, 'B', [20, 20, 40])
  if (data.clientCif)     addText(p, cx, 122, `CIF/NIF: ${data.clientCif}`, 9, 'R', [80, 80, 80])
  if (data.clientAddress) addText(p, cx, 136, data.clientAddress, 9, 'R', [80, 80, 80])
  if (data.clientCity)    addText(p, cx, 150, data.clientCity, 9, 'R', [80, 80, 80])
  if (data.clientEmail)   addText(p, cx, 164, data.clientEmail, 9, 'R', [80, 80, 80])

  // ── Invoice meta ──
  const maxSy = Math.max(sy, 178)
  const metaY = maxSy + 10
  p.hline(margin, metaY, W - margin, 180, 180, 180, 0.4)

  addText(p, margin, metaY + 8, 'Nº Factura:', 9, 'R', [120, 120, 120])
  addText(p, margin + 70, metaY + 8, data.invoiceNumber, 9, 'B', [20, 20, 40])
  addText(p, margin, metaY + 22, 'Fecha:', 9, 'R', [120, 120, 120])
  addText(p, margin + 70, metaY + 22, data.invoiceDate, 9, 'R', [60, 60, 60])
  if (data.dueDate) {
    addText(p, margin, metaY + 36, 'Vencimiento:', 9, 'R', [120, 120, 120])
    addText(p, margin + 70, metaY + 36, data.dueDate, 9, 'R', [60, 60, 60])
  }

  // ── Title ──
  const titleY = metaY + 56
  addText(p, margin, titleY, 'MINUTA DE HONORARIOS', 13, 'B', [26, 58, 107])

  // ── Table header ──
  const tableY = titleY + 20
  const colW = W - margin * 2
  const amtColW = 100
  const concColW = colW - amtColW

  p.fillRect(margin, tableY, colW, 20, 26, 58, 107)
  addText(p, margin + 8, tableY + 4, 'CONCEPTO', 9, 'B', [255, 255, 255])
  addText(p, margin + concColW, tableY + 4, 'IMPORTE', 9, 'B', [255, 255, 255], 'right', amtColW - 8)

  // ── Table rows ──
  let rowY = tableY + 20
  const base = data.lines.reduce((s, l) => s + l.amount, 0)

  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i]
    const bg: [number, number, number] = i % 2 === 0 ? [250, 251, 255] : [255, 255, 255]
    p.fillRect(margin, rowY, colW, 20, ...bg)
    p.strokeRect(margin, rowY, colW, 20, 220, 225, 235, 0.3)
    // Wrap concept text if needed
    const concept = line.concept.length > 70 ? line.concept.substring(0, 68) + '…' : line.concept
    addText(p, margin + 8, rowY + 4, concept, 9, 'R', [40, 40, 40])
    addText(p, margin + concColW, rowY + 4, fmtEur(line.amount), 9, 'R', [40, 40, 40], 'right', amtColW - 8)
    rowY += 20
  }

  // ── Totals ──
  const totY = rowY + 10
  const totX = margin + concColW - 60
  const totW = amtColW + 60

  // Base imponible
  p.fillRect(margin + concColW - 60, totY, totW, 18, 248, 249, 253)
  addText(p, totX + 8, totY + 3, 'Base Imponible:', 9, 'R', [80, 80, 80])
  addText(p, totX, totY + 3, fmtEur(base), 9, 'R', [60, 60, 60], 'right', totW - 8)

  // IVA
  const vatAmount = Math.round(base * 0.21 * 100) / 100
  p.fillRect(totX, totY + 18, totW, 18, 248, 249, 253)
  addText(p, totX + 8, totY + 21, 'IVA 21%:', 9, 'R', [80, 80, 80])
  addText(p, totX, totY + 21, fmtEur(vatAmount), 9, 'R', [60, 60, 60], 'right', totW - 8)

  // Total
  const total = base + vatAmount
  p.fillRect(totX, totY + 36, totW, 22, 26, 58, 107)
  addText(p, totX + 8, totY + 40, 'TOTAL FACTURA:', 10, 'B', [255, 255, 255])
  addText(p, totX, totY + 40, fmtEur(total), 10, 'B', [255, 255, 255], 'right', totW - 8)

  // ── IBAN ──
  const ibanY = totY + 80
  p.fillRect(margin, ibanY, colW, 36, 240, 245, 255)
  addText(p, margin, ibanY + 6, 'Datos bancarios para el pago:', 8, 'R', [100, 100, 100], 'center', colW)
  addText(p, margin, ibanY + 20, 'ES19 0182 5000 8402 0187 5295  ·  BBVA', 10, 'B', [26, 58, 107], 'center', colW)

  // ── Footer ──
  const footY = ibanY + 60
  p.hline(margin, footY, W - margin, 200, 200, 200, 0.3)
  addText(p, 0, footY + 8, 'Voltis Soluciones S.L.  ·  B-71548705  ·  Calle Berriobide 38, Oficina 209, 31013 Ansoáin  ·  facturacion@voltisenergia.com', 7, 'R', [160, 160, 160], 'center', W)

  return p.build()
}
