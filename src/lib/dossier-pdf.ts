/**
 * Dossier PDF nativo Voltis — generado con pdf-lib (pure JS, sin Chromium).
 *
 * Diseño basado en el template "Voltis Acceso PDF.html" — paleta azul
 * cobalto profundo, saludo personalizado, QR funcional al portal, mascota
 * y footer cálido. El QR enlaza directamente al portal del cliente y se
 * puede escanear desde móvil.
 *
 * Paleta cobalto:
 *   • Voltis Deep    #0A2A6B
 *   • Voltis Blue    #1F5BFF
 *   • Voltis Sky     #B9D1FF
 *   • Voltis Ice     #EAF1FF
 *   • Ink            #0B1B3E
 *   • Ink Soft       #4A5A82
 *
 * Saludo personalizado: "Querido {nombre}, bienvenido al club Voltis."
 */
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { VOLTIS_INFO, voltisPortalUrl } from './voltis-info'

// ── Paleta Voltis cobalto ────────────────────────────────────────────────────
const COBALT_BG     = rgb(0.067, 0.165, 0.392)   // #11308C centro hero
const COBALT_DARK   = rgb(0.039, 0.125, 0.373)   // #0A205F esquina
const COBALT_MID    = rgb(0.122, 0.278, 0.710)   // #1F47B5
const SKY_TINT      = rgb(0.180, 0.357, 0.851)   // #2E5BD9 arriba
const VOLTIS_BLUE   = rgb(0.122, 0.357, 1.0)     // #1F5BFF
const VOLTIS_SKY    = rgb(0.725, 0.820, 1.0)     // #B9D1FF
const VOLTIS_ICE    = rgb(0.918, 0.945, 1.0)     // #EAF1FF
const WHITE         = rgb(1, 1, 1)
const WHITE_85      = rgb(0.95, 0.95, 0.95)
const WHITE_70      = rgb(0.85, 0.85, 0.92)
const WHITE_60      = rgb(0.75, 0.80, 0.90)
const INK_DEEP      = rgb(0.043, 0.106, 0.243)   // #0B1B3E
const GREEN_LIVE    = rgb(0.498, 1.0, 0.725)     // #7fffb9

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

/** Genera el PDF del dossier Voltis (pure JS). */
export async function buildDossierPdf(args: DossierArgs): Promise<Buffer> {
  const url = voltisPortalUrl(args.token)

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Voltis · Acceso al portal — ${args.clientName}`)
  pdf.setAuthor('Voltis Energía')
  pdf.setSubject('Acceso al portal energético del cliente')
  pdf.setKeywords(['Voltis', 'portal', 'energía', 'cliente'])
  pdf.setProducer('Voltis CRM')
  pdf.setCreator('Voltis CRM')

  // Fuentes — Helvetica (sustitutivo de SF Pro Display)
  const sans      = await pdf.embedFont(StandardFonts.Helvetica)
  const sansBold  = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono      = await pdf.embedFont(StandardFonts.Courier)
  const monoBold  = await pdf.embedFont(StandardFonts.CourierBold)

  // Página A4
  const A4_W = 595.28
  const A4_H = 841.89
  const page = pdf.addPage([A4_W, A4_H])

  // ── Fondo cobalto degradado (simulado con bandas) ────────────────────────
  // pdf-lib no soporta gradients reales; aproximamos con varias franjas
  // verticales que cambian del cobalto medio (arriba) al profundo (abajo).
  const bands = 60
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1)
    // interpolación: SKY_TINT → COBALT_BG → COBALT_DARK
    let r: number, g: number, b: number
    if (t < 0.4) {
      const u = t / 0.4
      r = 0.180 + (0.067 - 0.180) * u
      g = 0.357 + (0.165 - 0.357) * u
      b = 0.851 + (0.392 - 0.851) * u
    } else {
      const u = (t - 0.4) / 0.6
      r = 0.067 + (0.039 - 0.067) * u
      g = 0.165 + (0.125 - 0.165) * u
      b = 0.392 + (0.373 - 0.392) * u
    }
    page.drawRectangle({
      x: 0, y: A4_H - ((i + 1) * A4_H / bands),
      width: A4_W, height: Math.ceil(A4_H / bands) + 1,
      color: rgb(r, g, b),
    })
  }

  // Halo blanco sutil arriba-derecha (simulado con círculos translúcidos)
  for (let i = 0; i < 6; i++) {
    page.drawCircle({
      x: A4_W * 0.85, y: A4_H - 100,
      size: 150 - i * 12,
      color: rgb(1, 1, 1), opacity: 0.04,
    })
  }
  for (let i = 0; i < 6; i++) {
    page.drawCircle({
      x: A4_W * 0.10, y: 200,
      size: 200 - i * 14,
      color: rgb(1, 1, 1), opacity: 0.025,
    })
  }

  const M = 48   // margen lateral
  let cursorY = A4_H - 46

  // ── Top bar: marca + meta ────────────────────────────────────────────────
  page.drawText('Voltis', { x: M, y: cursorY, font: sansBold, size: 13, color: WHITE })
  page.drawText('Energía', { x: M + sansBold.widthOfTextAtSize('Voltis', 13) + 6, y: cursorY, font: sans, size: 13, color: WHITE_70 })

  // Derecha del header: "ACCESO · {fecha en español}"
  const metaR = `ACCESO · ${formatSpanishDate(new Date())}`
  page.drawText(metaR, {
    x: A4_W - M - sansBold.widthOfTextAtSize(metaR, 8),
    y: cursorY + 2, font: sansBold, size: 8, color: WHITE_70,
  })

  // ── Mascota a la derecha, alineada con el hero (más compacta) ───────────
  // Posicionada para no solaparse con el título: ancho 130, ocupando la
  // columna derecha. El título tiene maxWidth limitado por su X.
  const mascotBytes = loadMascotBytes()
  const MASCOT_W = 130
  const MASCOT_RIGHT_GUTTER = 24
  let mascotBlock = { left: A4_W, right: A4_W }
  if (mascotBytes) {
    try {
      const img = await pdf.embedPng(mascotBytes)
      const imgW = MASCOT_W
      const imgH = (img.height / img.width) * imgW
      const mascotX = A4_W - M - imgW + MASCOT_RIGHT_GUTTER
      const mascotY = A4_H - 110 - imgH
      page.drawCircle({
        x: mascotX + imgW / 2, y: mascotY + imgH / 2 + 6,
        size: 78, color: VOLTIS_SKY, opacity: 0.28,
      })
      page.drawImage(img, {
        x: mascotX, y: mascotY,
        width: imgW, height: imgH,
      })
      mascotBlock = { left: mascotX, right: mascotX + imgW }
    } catch {}
  }

  // El ancho útil del titular debe acabar antes de la mascota para que el
  // texto NUNCA se solape con la bombilla, sin importar la longitud del
  // nombre del cliente.
  const heroMaxW = (mascotBlock.left - M) - 14

  cursorY -= 38

  // ── Eyebrow píldora ──────────────────────────────────────────────────────
  const eyebrowText = 'TU PORTAL ESTÁ LISTO'
  const eyebrowW = sansBold.widthOfTextAtSize(eyebrowText, 7.5) + 38
  page.drawRectangle({
    x: M, y: cursorY - 6, width: eyebrowW, height: 18,
    color: WHITE, opacity: 0.14,
  })
  page.drawCircle({ x: M + 11, y: cursorY + 3, size: 2.4, color: GREEN_LIVE })
  page.drawText(eyebrowText, {
    x: M + 20, y: cursorY, font: sansBold, size: 7.5, color: WHITE,
  })

  cursorY -= 28

  // ── Titular: "Querido {nombre}, bienvenido al club Voltis." ─────────────
  // Una sola frase fluida, que envuelve dinámicamente respetando el ancho
  // disponible (heroMaxW). Reducimos tamaño automáticamente si el nombre es
  // muy largo para que nunca se rompa de forma fea.
  const greetingName = formatGreetingName(args.clientName)
  const fullHeading = `Querido ${greetingName}, bienvenido al club Voltis.`
  let headingSize = 26
  let headingLines = wrapText(fullHeading, sansBold, headingSize, heroMaxW)
  while (headingLines.length > 3 && headingSize > 18) {
    headingSize -= 1
    headingLines = wrapText(fullHeading, sansBold, headingSize, heroMaxW)
  }
  const headingLineH = Math.round(headingSize * 1.12)
  for (const line of headingLines) {
    page.drawText(line, { x: M, y: cursorY, font: sansBold, size: headingSize, color: WHITE })
    cursorY -= headingLineH
  }

  cursorY -= 6

  // ── Subtítulo (lede) ────────────────────────────────────────────────────
  const subLines = wrapText(
    'Hemos preparado un espacio privado donde puedes ver, en cualquier momento, todo lo que pasa con tu energía: consumo, gasto y facturas. Sin contraseñas, sin apps, sin papeleo. Sólo abrir y leer.',
    sans, 10.5, heroMaxW,
  )
  let subY = cursorY
  for (const line of subLines) {
    page.drawText(line, { x: M, y: subY, font: sans, size: 10.5, color: WHITE_85 })
    subY -= 14
  }
  cursorY = subY - 18

  // ── Card del portal (glassmorphic blanca translúcida) ────────────────────
  const cardH = 168
  const cardW = A4_W - 2 * M
  // Sombra
  page.drawRectangle({
    x: M + 2, y: cursorY - cardH - 2, width: cardW, height: cardH,
    color: rgb(0, 0, 0), opacity: 0.18,
  })
  // Fondo glass
  page.drawRectangle({
    x: M, y: cursorY - cardH, width: cardW, height: cardH,
    color: WHITE, opacity: 0.15,
    borderColor: WHITE, borderWidth: 0.6, borderOpacity: 0.4,
  })
  // Brillo superior
  page.drawRectangle({
    x: M, y: cursorY - cardH * 0.4, width: cardW, height: cardH * 0.4,
    color: WHITE, opacity: 0.08,
  })

  // Card head: "Portal privado de" + nombre cliente + pill "Datos en vivo"
  const labelY = cursorY - 26
  page.drawText('PORTAL PRIVADO DE', {
    x: M + 22, y: labelY, font: sansBold, size: 8, color: WHITE_70,
  })

  // Nombre cliente (puede ocupar 1-2 líneas)
  const nameLines = wrapText(args.clientName.toUpperCase(), sansBold, 18, cardW - 220)
  let nameY = labelY - 18
  for (const line of nameLines.slice(0, 2)) {
    page.drawText(line, { x: M + 22, y: nameY, font: sansBold, size: 18, color: WHITE })
    nameY -= 22
  }

  // Pill "Datos en vivo" arriba derecha
  const pillText = 'DATOS EN VIVO'
  const pillW = sansBold.widthOfTextAtSize(pillText, 7.5) + 30
  page.drawRectangle({
    x: M + cardW - pillW - 22, y: labelY - 2,
    width: pillW, height: 17,
    color: WHITE, opacity: 0.20,
  })
  page.drawCircle({
    x: M + cardW - pillW - 22 + 10, y: labelY + 7, size: 2.4, color: GREEN_LIVE,
  })
  page.drawText(pillText, {
    x: M + cardW - pillW - 22 + 18, y: labelY + 4, font: sansBold, size: 7.5, color: WHITE,
  })

  // URL caption
  const urlCaptionY = cursorY - cardH + 92
  page.drawText('ÁBRELO DESDE TU NAVEGADOR', {
    x: M + 22, y: urlCaptionY, font: sansBold, size: 7.5, color: WHITE_70,
  })

  // URL block (mono, fondo oscuro translúcido)
  const urlBlockY = urlCaptionY - 36
  const urlBlockW = cardW - 44 - 130   // dejar espacio para el QR a la derecha
  page.drawRectangle({
    x: M + 22, y: urlBlockY - 4,
    width: urlBlockW, height: 30,
    color: COBALT_DARK, opacity: 0.5,
  })

  // Render URL — wrap si es muy largo
  const urlLines = chunkUrl(url, 56)
  let urlY = urlBlockY + 14
  for (const ul of urlLines.slice(0, 2)) {
    page.drawText(ul, { x: M + 30, y: urlY, font: mono, size: 9, color: WHITE })
    urlY -= 12
  }

  // Help text bajo URL
  page.drawText('Copia y pega el enlace, guárdalo como marcador o escanea el QR.', {
    x: M + 22, y: urlBlockY - 18,
    font: sans, size: 8.5, color: WHITE_70,
  })
  page.drawText('Es tuyo y sólo tuyo.', {
    x: M + 22, y: urlBlockY - 30,
    font: sans, size: 8.5, color: WHITE_70,
  })

  // QR real funcional a la derecha
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 0,
    scale: 10,
    color: { dark: '#0A2A6B', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
  })
  const qrPngBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64')
  const qrImg = await pdf.embedPng(qrPngBytes)
  const qrSize = 110
  const qrX = M + cardW - qrSize - 26
  const qrY = cursorY - cardH + 32

  // Fondo blanco con padding tras el QR (para mejor escaneo)
  page.drawRectangle({
    x: qrX - 8, y: qrY - 8,
    width: qrSize + 16, height: qrSize + 16,
    color: WHITE,
    borderColor: rgb(0.122, 0.357, 1.0), borderWidth: 0.5, borderOpacity: 0.15,
  })
  page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize })

  cursorY -= cardH + 28

  // ── Inside head: "Lo que encontrarás dentro" ─────────────────────────────
  page.drawText('LO QUE ENCONTRARÁS DENTRO', {
    x: M, y: cursorY, font: sansBold, size: 9, color: WHITE,
  })
  const subRight = 'Se actualiza solo con cada nueva factura'
  page.drawText(subRight, {
    x: A4_W - M - sans.widthOfTextAtSize(subRight, 8.5),
    y: cursorY, font: sans, size: 8.5, color: WHITE_70,
  })

  cursorY -= 18

  // ── 3 feature cards (glass) ──────────────────────────────────────────────
  // Los iconos los dibujamos como rectángulos/líneas simples — pdf-lib no
  // soporta emojis (WinAnsi encoding) ni SVG paths complejos.
  type FeatureGlyph = 'chart' | 'doc' | 'download'
  const features: Array<{ title: string; desc: string; glyph: FeatureGlyph }> = [
    { title: 'Tu resumen anual',         desc: 'Cuánto pagas en luz y gas, dónde se concentra el gasto y cómo evoluciona mes a mes.', glyph: 'chart' },
    { title: 'Detalle por suministro',   desc: 'Consumo, potencias, precios y conceptos exactos de cada una de tus facturas.',         glyph: 'doc' },
    { title: 'Descargas en Excel',       desc: 'Datos listos para tu contabilidad o cualquier auditoría que necesites hacer.',          glyph: 'download' },
  ]
  const gap = 10
  const fW = (cardW - gap * 2) / 3
  const fH = 86
  features.forEach((f, i) => {
    const x = M + i * (fW + gap)
    // Sombra
    page.drawRectangle({
      x: x + 1, y: cursorY - fH - 1, width: fW, height: fH,
      color: rgb(0, 0, 0), opacity: 0.12,
    })
    // Card glass
    page.drawRectangle({
      x, y: cursorY - fH, width: fW, height: fH,
      color: WHITE, opacity: 0.13,
      borderColor: WHITE, borderWidth: 0.5, borderOpacity: 0.35,
    })
    // Glyph background (caja)
    const gx = x + 14, gy = cursorY - 28
    page.drawRectangle({
      x: gx, y: gy, width: 22, height: 18,
      color: WHITE, opacity: 0.20,
    })
    // Glyph dibujado a mano dentro de la caja
    drawFeatureGlyph(page, f.glyph, gx, gy)
    // Título
    page.drawText(f.title, {
      x: x + 14, y: cursorY - 44, font: sansBold, size: 11, color: WHITE,
    })
    // Descripción
    const descLines = wrapText(f.desc, sans, 8.5, fW - 28)
    let dy = cursorY - 58
    for (const line of descLines.slice(0, 3)) {
      page.drawText(line, { x: x + 14, y: dy, font: sans, size: 8.5, color: WHITE_85 })
      dy -= 11
    }
  })

  cursorY -= fH + 36

  // ── Footer cálido ──────────────────────────────────────────────────────
  const footY = 56

  // Signoff izquierda — primera línea bold + resto en regular
  // Layout vertical fijo con suficiente separación entre líneas y firma.
  const signoffMaxW = A4_W - 2 * M - 180

  // Línea 1: "Estamos aquí para ti." + " Si tienes cualquier duda..."
  let sY = footY + 50
  const boldFirst = 'Estamos aquí para ti.'
  page.drawText(boldFirst, { x: M, y: sY, font: sansBold, size: 10.5, color: WHITE })
  const rest = ' Si tienes cualquier duda, una llamada o un correo basta —'
  page.drawText(rest, {
    x: M + sansBold.widthOfTextAtSize(boldFirst, 10.5),
    y: sY, font: sans, size: 10, color: WHITE_85,
  })

  // Líneas 2 y 3
  sY -= 14
  page.drawText('somos personas reales al otro lado, y nos encanta poner las cosas', {
    x: M, y: sY, font: sans, size: 10, color: WHITE_85,
  })
  sY -= 14
  page.drawText('fáciles.', {
    x: M, y: sY, font: sans, size: 10, color: WHITE_85,
  })

  // Firma con espacio respiro
  page.drawText('— El equipo de Voltis', {
    x: M, y: footY - 8, font: sans, size: 9.5, color: WHITE_70,
  })

  // Contacto derecha — alineado verticalmente con el signoff
  page.drawText('CONTACTO', {
    x: A4_W - M - sansBold.widthOfTextAtSize('CONTACTO', 7.5),
    y: footY + 50, font: sansBold, size: 7.5, color: WHITE_70,
  })
  page.drawText(VOLTIS_INFO.phone, {
    x: A4_W - M - sansBold.widthOfTextAtSize(VOLTIS_INFO.phone, 13),
    y: footY + 32, font: sansBold, size: 13, color: WHITE,
  })
  page.drawText(VOLTIS_INFO.email, {
    x: A4_W - M - sans.widthOfTextAtSize(VOLTIS_INFO.email, 9.5),
    y: footY + 16, font: sans, size: 9.5, color: WHITE_85,
  })
  page.drawText(`www.${VOLTIS_INFO.website}`, {
    x: A4_W - M - sans.widthOfTextAtSize(`www.${VOLTIS_INFO.website}`, 9.5),
    y: footY + 2, font: sans, size: 9.5, color: WHITE_70,
  })

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formatea el nombre del cliente para el saludo:
 *   "AYUNTAMIENTO DE ORCOYEN" → "Ayuntamiento de Orcoyen"
 *   "Voltis Energía SL"       → "Voltis Energía"
 * Capitaliza solo la primera letra de cada palabra (excepto preposiciones).
 */
function formatGreetingName(name: string): string {
  if (!name) return 'cliente'
  const lower = ['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'para', 'por', 'a', 'al']
  return name
    .trim()
    .toLowerCase()
    // quitar "S.L.", "S.A.", "S.L.U.", "SLU" al final
    .replace(/[,.]?\s*(s\.?l\.?u\.?|s\.?a\.?u?\.?|c\.?b\.?|s\.?coop|sociedad limitada|sociedad anónima)$/i, '')
    .split(/\s+/)
    .map((w, i) =>
      i === 0 || !lower.includes(w)
        ? w.charAt(0).toUpperCase() + w.slice(1)
        : w
    )
    .join(' ')
}

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

/**
 * Devuelve la fecha en formato "DD DE MES DE YYYY" en mayúsculas:
 *   new Date('2026-05-15') → "15 DE MAYO DE 2026"
 */
function formatSpanishDate(d: Date): string {
  const meses = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
  ]
  return `${d.getDate()} DE ${meses[d.getMonth()]} DE ${d.getFullYear()}`
}

function chunkUrl(url: string, maxChars: number): string[] {
  const out: string[] = []
  for (let i = 0; i < url.length; i += maxChars) {
    out.push(url.slice(i, i + maxChars))
  }
  return out
}

/**
 * Dibuja un icono simple (chart/doc/download) dentro de un cuadro 22×18.
 * Usado en las feature cards. Mejor que un emoji porque las fuentes estándar
 * de pdf-lib (Helvetica/Times/Courier) usan WinAnsi y no soportan Unicode > 256.
 */
function drawFeatureGlyph(page: any, kind: 'chart' | 'doc' | 'download', x: number, y: number) {
  const w = 22, h = 18
  const white = rgb(1, 1, 1)
  if (kind === 'chart') {
    // 3 barras ascendentes
    page.drawRectangle({ x: x + 4,  y: y + 3, width: 3, height: 6,  color: white })
    page.drawRectangle({ x: x + 9,  y: y + 3, width: 3, height: 9,  color: white })
    page.drawRectangle({ x: x + 14, y: y + 3, width: 3, height: 12, color: white })
  } else if (kind === 'doc') {
    // Folio con líneas de texto
    page.drawRectangle({ x: x + 5, y: y + 3, width: 12, height: 13, borderColor: white, borderWidth: 1 })
    page.drawLine({ start: { x: x + 7, y: y + 13 }, end: { x: x + 15, y: y + 13 }, thickness: 1, color: white })
    page.drawLine({ start: { x: x + 7, y: y + 10 }, end: { x: x + 13, y: y + 10 }, thickness: 1, color: white })
    page.drawLine({ start: { x: x + 7, y: y + 7  }, end: { x: x + 14, y: y + 7  }, thickness: 1, color: white })
  } else if (kind === 'download') {
    // Flecha hacia abajo + base
    page.drawLine({ start: { x: x + 11, y: y + 14 }, end: { x: x + 11, y: y + 5 }, thickness: 1.2, color: white })
    page.drawLine({ start: { x: x + 7,  y: y + 9  }, end: { x: x + 11, y: y + 5 }, thickness: 1.2, color: white })
    page.drawLine({ start: { x: x + 15, y: y + 9  }, end: { x: x + 11, y: y + 5 }, thickness: 1.2, color: white })
    page.drawLine({ start: { x: x + 5,  y: y + 3  }, end: { x: x + 17, y: y + 3 }, thickness: 1.2, color: white })
  }
}
