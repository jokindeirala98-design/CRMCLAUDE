/**
 * Dossier PDF nativo Voltis — generado con pdf-lib (pure JS, sin Chromium).
 *
 * Diseño editorial premium A4 vertical con QR para acceso desde móvil.
 * Funciona en cualquier entorno serverless (Vercel/AWS Lambda) sin
 * dependencias binarias.
 */
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { VOLTIS_INFO, voltisPortalUrl, voltisFullAddress } from './voltis-info'

// Paleta Voltis (rgb 0..1)
const VERDE_BOSQUE = rgb(0.121, 0.227, 0.180)   // #1F3A2E
const VERDE_LIMA   = rgb(0.780, 0.949, 0.290)   // #C7F24A
const PIEL_PAPEL   = rgb(0.984, 0.972, 0.945)   // #FBF8F1
const TINTA_SUAVE  = rgb(0.290, 0.345, 0.321)   // #4A5852
const TINTA_TENUE  = rgb(0.431, 0.478, 0.447)   // #6E7A72
const LINEA        = rgb(0.886, 0.863, 0.788)   // #E2DCC9
const VERDE_CLARO  = rgb(0.78, 0.85, 0.80)
const PAPEL_TENUE  = rgb(0.71, 0.68, 0.63)

let MASCOT_PNG_BYTES_CACHE: Uint8Array | null = null
function loadMascotBytes(): Uint8Array | null {
  if (MASCOT_PNG_BYTES_CACHE) return MASCOT_PNG_BYTES_CACHE
  try {
    const filePath = path.join(process.cwd(), 'public', 'mascota-transparente.png')
    MASCOT_PNG_BYTES_CACHE = fs.readFileSync(filePath)
    return MASCOT_PNG_BYTES_CACHE
  } catch {
    return null
  }
}

interface DossierArgs {
  clientName: string
  token: string
}

/** Genera el PDF del dossier Voltis. Pure JS, funciona en cualquier serverless. */
export async function buildDossierPdf(args: DossierArgs): Promise<Buffer> {
  const url = voltisPortalUrl(args.token)
  const today = new Date().toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Voltis · ${args.clientName}`)
  pdf.setAuthor('Voltis Energía')
  pdf.setSubject('Acceso al portal energético del cliente')
  pdf.setKeywords(['Voltis', 'portal', 'energía', 'cliente'])
  pdf.setProducer('Voltis CRM')
  pdf.setCreator('Voltis CRM')

  // Fuentes (StandardFonts no requieren embedding extra)
  const serif       = await pdf.embedFont(StandardFonts.TimesRomanItalic)
  const serifBold   = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const sans        = await pdf.embedFont(StandardFonts.Helvetica)
  const sansBold    = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono        = await pdf.embedFont(StandardFonts.Courier)

  // Página A4
  const A4_W = 595.28
  const A4_H = 841.89
  const page = pdf.addPage([A4_W, A4_H])

  // Fondo papel
  page.drawRectangle({ x: 0, y: 0, width: A4_W, height: A4_H, color: PIEL_PAPEL })

  // Regla lima superior
  page.drawRectangle({ x: 0, y: A4_H - 12, width: A4_W, height: 12, color: VERDE_LIMA })

  const M = 56  // margen lateral (~20mm)
  let cursorY = A4_H - 60

  // ── Header brand ──────────────────────────────────────────────────────────
  page.drawText('VOLTIS', { x: M, y: cursorY - 12, font: sansBold, size: 13, color: VERDE_BOSQUE })
  page.drawText('ENERGÍA · NAVARRA', { x: M, y: cursorY - 28, font: sansBold, size: 7, color: TINTA_TENUE })

  // Fecha derecha
  const dateText = today.toUpperCase()
  const headerTopRight = 'ACCESO AL PORTAL DEL CLIENTE'
  page.drawText(headerTopRight, {
    x: A4_W - M - sansBold.widthOfTextAtSize(headerTopRight, 7.5),
    y: cursorY - 12, font: sansBold, size: 7.5, color: TINTA_TENUE,
  })
  page.drawText(dateText, {
    x: A4_W - M - sansBold.widthOfTextAtSize(dateText, 8),
    y: cursorY - 28, font: sansBold, size: 8, color: TINTA_TENUE,
  })

  cursorY -= 80

  // Línea separadora fina
  page.drawLine({
    start: { x: M, y: cursorY }, end: { x: A4_W - M, y: cursorY },
    thickness: 0.6, color: LINEA,
  })

  cursorY -= 50

  // ── Eyebrow ───────────────────────────────────────────────────────────────
  page.drawText('TU PORTAL ENERGÉTICO', {
    x: M, y: cursorY, font: sansBold, size: 8, color: VERDE_BOSQUE,
  })

  cursorY -= 26

  // ── Titular grande ────────────────────────────────────────────────────────
  page.drawText('Tu informe energético,', { x: M, y: cursorY, font: serif, size: 36, color: VERDE_BOSQUE })
  page.drawText('siempre disponible.',    { x: M, y: cursorY - 40, font: serif, size: 36, color: VERDE_BOSQUE })

  cursorY -= 76

  // ── Subtítulo ─────────────────────────────────────────────────────────────
  const subLines = wrapText(
    'Consulta tu consumo, tu gasto y todas tus facturas desde un único enlace privado. Sin contraseña, sin app: sólo abrir y leer.',
    sans, 11, A4_W - 2 * M - 130,
  )
  let subY = cursorY
  for (const line of subLines) {
    page.drawText(line, { x: M, y: subY, font: sans, size: 11, color: TINTA_SUAVE })
    subY -= 16
  }

  // Mascota a la derecha del subtítulo
  const mascotBytes = loadMascotBytes()
  if (mascotBytes) {
    try {
      const img = await pdf.embedPng(mascotBytes)
      const imgW = 96
      const imgH = (img.height / img.width) * imgW
      page.drawImage(img, {
        x: A4_W - M - imgW, y: cursorY - imgH + 24,
        width: imgW, height: imgH,
      })
    } catch {}
  }

  cursorY -= 100

  // ── Tarjeta verde con nombre cliente + Tarjeta clara con QR ───────────────
  const cardY = cursorY
  const cardH = 158
  const cardLeftW = (A4_W - 2 * M) * 0.58
  const cardRightX = M + cardLeftW + 14
  const cardRightW = A4_W - M - cardRightX

  // Tarjeta verde (cliente)
  page.drawRectangle({
    x: M, y: cardY - cardH, width: cardLeftW, height: cardH, color: VERDE_BOSQUE,
  })
  page.drawText('TU PORTAL PRIVADO', {
    x: M + 18, y: cardY - 22, font: sansBold, size: 7, color: VERDE_LIMA,
  })
  const clientNameUpper = args.clientName.toUpperCase()
  const clientLines = wrapText(clientNameUpper, serifBold, 22, cardLeftW - 36)
  let cnY = cardY - 50
  for (const line of clientLines.slice(0, 3)) {
    page.drawText(line, { x: M + 18, y: cnY, font: serifBold, size: 22, color: PIEL_PAPEL })
    cnY -= 26
  }
  page.drawText('Un enlace propio para tu organización.', {
    x: M + 18, y: cardY - cardH + 38, font: sans, size: 9, color: VERDE_CLARO,
  })
  page.drawText('Datos actualizados con cada nueva factura.', {
    x: M + 18, y: cardY - cardH + 24, font: sans, size: 9, color: VERDE_CLARO,
  })

  // Tarjeta clara con QR
  page.drawRectangle({
    x: cardRightX, y: cardY - cardH, width: cardRightW, height: cardH,
    color: rgb(1, 1, 1), borderColor: LINEA, borderWidth: 0.8,
  })
  page.drawText('ESCANEA PARA ABRIR', {
    x: cardRightX + 16, y: cardY - 22, font: sansBold, size: 7, color: TINTA_TENUE,
  })

  // Generar QR como PNG bytes (verde bosque / papel para fidelidad con la paleta)
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1, scale: 8,
    color: { dark: '#1F3A2E', light: '#FBF8F1' },
    errorCorrectionLevel: 'M',
  })
  const qrPngBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64')
  const qrImg = await pdf.embedPng(qrPngBytes)
  const qrSize = 108
  page.drawImage(qrImg, {
    x: cardRightX + (cardRightW - qrSize) / 2,
    y: cardY - cardH + 30,
    width: qrSize, height: qrSize,
  })
  page.drawText('o copia el enlace abajo', {
    x: cardRightX + 16, y: cardY - cardH + 14, font: sans, size: 8, color: TINTA_TENUE,
  })

  cursorY = cardY - cardH - 28

  // ── Enlace en línea separada (para copia manual) ──────────────────────────
  page.drawText('ENLACE DIRECTO', {
    x: M, y: cursorY, font: sansBold, size: 7, color: TINTA_TENUE,
  })
  cursorY -= 14
  const urlLines = chunkUrl(url, 60)
  for (const ul of urlLines) {
    page.drawText(ul, { x: M, y: cursorY, font: mono, size: 9, color: VERDE_BOSQUE })
    cursorY -= 13
  }

  cursorY -= 22

  // ── Sección "Qué encontrarás" ─────────────────────────────────────────────
  page.drawText('¿QUÉ ENCONTRARÁS DENTRO?', {
    x: M, y: cursorY, font: sansBold, size: 8, color: VERDE_BOSQUE,
  })
  cursorY -= 24

  const features = [
    { title: 'Resumen anual',          desc: 'Cuánto pagas en luz y gas, dónde se concentra el gasto y evolución mes a mes.' },
    { title: 'Detalle por suministro', desc: 'Consumo, potencias, precios y conceptos exactos de cada factura.' },
    { title: 'Descargas Excel',        desc: 'Datos listos para tu contabilidad o auditoría interna.' },
  ]
  const colW = (A4_W - 2 * M - 28) / 3
  features.forEach((f, i) => {
    const x = M + i * (colW + 14)
    page.drawRectangle({ x, y: cursorY - 56, width: 2, height: 50, color: VERDE_LIMA })
    page.drawText(f.title, {
      x: x + 12, y: cursorY, font: sansBold, size: 10.5, color: VERDE_BOSQUE,
    })
    const descLines = wrapText(f.desc, sans, 9, colW - 16)
    let dy = cursorY - 16
    for (const line of descLines.slice(0, 3)) {
      page.drawText(line, { x: x + 12, y: dy, font: sans, size: 9, color: TINTA_SUAVE })
      dy -= 12
    }
  })
  cursorY -= 78

  // ── Footer ────────────────────────────────────────────────────────────────
  const footY = 72
  page.drawLine({
    start: { x: M, y: footY + 38 }, end: { x: A4_W - M, y: footY + 38 },
    thickness: 0.6, color: LINEA,
  })
  page.drawText('TU ASESOR ENERGÉTICO', {
    x: M, y: footY + 22, font: sansBold, size: 6.5, color: TINTA_TENUE,
  })
  page.drawText(VOLTIS_INFO.name, {
    x: M, y: footY + 8, font: sansBold, size: 9, color: VERDE_BOSQUE,
  })
  page.drawText(voltisFullAddress(), {
    x: M, y: footY - 6, font: sans, size: 8.5, color: TINTA_SUAVE,
  })

  const contactT = 'CONTACTO'
  page.drawText(contactT, {
    x: A4_W - M - sansBold.widthOfTextAtSize(contactT, 6.5),
    y: footY + 22, font: sansBold, size: 6.5, color: TINTA_TENUE,
  })
  const phoneT = VOLTIS_INFO.phone
  page.drawText(phoneT, {
    x: A4_W - M - sansBold.widthOfTextAtSize(phoneT, 9),
    y: footY + 8, font: sansBold, size: 9, color: VERDE_BOSQUE,
  })
  const emailT = `${VOLTIS_INFO.email}  ·  ${VOLTIS_INFO.website}`
  page.drawText(emailT, {
    x: A4_W - M - sans.widthOfTextAtSize(emailT, 8.5),
    y: footY - 6, font: sans, size: 8.5, color: TINTA_SUAVE,
  })

  // Watermark inferior
  page.drawText('Acceso privado y personal', {
    x: M, y: 32, font: mono, size: 6.5, color: PAPEL_TENUE,
  })
  const wm = VOLTIS_INFO.name.toUpperCase()
  page.drawText(wm, {
    x: A4_W - M - mono.widthOfTextAtSize(wm, 6.5),
    y: 32, font: mono, size: 6.5, color: PAPEL_TENUE,
  })

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

// ─── Helpers de texto ──────────────────────────────────────────────────────

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial
    } else {
      if (current) lines.push(current)
      current = w
    }
  }
  if (current) lines.push(current)
  return lines
}

function chunkUrl(url: string, maxChars: number): string[] {
  const out: string[] = []
  for (let i = 0; i < url.length; i += maxChars) {
    out.push(url.slice(i, i + maxChars))
  }
  return out
}
