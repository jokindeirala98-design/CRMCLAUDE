/**
 * Dossier PDF nativo Voltis — generado con pdf-lib (pure JS, sin Chromium).
 *
 * Paleta brand verificada en voltisenergia.com:
 *   • Sky blue       #88B9E7  (hero)
 *   • Electric blue  #3B4FE4  (mascota, CTA, acentos)
 *   • Page grey      #F7F7F7
 *   • Ink            #1A1A1A
 *   • Body           #6E7180
 *   • White          #FFFFFF
 *
 * Tipografía Inter (sans-serif). Diseño "approachable SaaS":
 * cards blancas con sombra, esquinas redondeadas, mascota azul.
 *
 * Sin QR (el enlace se muestra grande y copiable).
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { VOLTIS_INFO, voltisPortalUrl, voltisFullAddress } from './voltis-info'

// ── Paleta Voltis (verificada en voltisenergia.com) ─────────────────────────
const SKY        = rgb(0.533, 0.725, 0.906)  // #88B9E7 hero
const ELECTRIC   = rgb(0.231, 0.310, 0.894)  // #3B4FE4 acento
const ELEC_DARK  = rgb(0.160, 0.220, 0.690)  // versión oscura para hover/title
const PAGE_BG    = rgb(0.969, 0.969, 0.969)  // #F7F7F7
const INK        = rgb(0.102, 0.102, 0.102)  // #1A1A1A titulares
const BODY       = rgb(0.431, 0.443, 0.502)  // #6E7180 body
const WHITE      = rgb(1, 1, 1)
const LINE       = rgb(0.890, 0.898, 0.918)  // muy claro
const SKY_TINT   = rgb(0.910, 0.945, 0.984)  // #E8F1FB para badges

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

  // Fuentes — Inter no está como StandardFont; usamos Helvetica como sans
  // cercano (proporciones similares) y la diferenciamos por peso.
  const sans      = await pdf.embedFont(StandardFonts.Helvetica)
  const sansMed   = await pdf.embedFont(StandardFonts.Helvetica)         // 500 alias
  const sansBold  = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono      = await pdf.embedFont(StandardFonts.Courier)

  // Página A4
  const A4_W = 595.28
  const A4_H = 841.89
  const page = pdf.addPage([A4_W, A4_H])

  // ── Fondo página gris claro ─────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: A4_W, height: A4_H, color: PAGE_BG })

  // ── Hero panel azul cielo (plano, sin curvas para que el texto sea legible) ─
  const heroH = 270
  page.drawRectangle({
    x: 0, y: A4_H - heroH, width: A4_W, height: heroH, color: SKY,
  })
  // Banda decorativa fina azul electric en la base del hero, a modo de
  // separador limpio (sustituye a la curva redondeada).
  page.drawRectangle({
    x: 0, y: A4_H - heroH - 3, width: A4_W, height: 3, color: ELECTRIC,
  })

  const M = 56  // margen lateral
  const heroTop = A4_H - 56

  // Marca arriba a la izquierda
  page.drawText('VOLTIS', { x: M, y: heroTop, font: sansBold, size: 14, color: WHITE })
  page.drawText('energía', { x: M + sansBold.widthOfTextAtSize('VOLTIS', 14) + 8, y: heroTop, font: sans, size: 11, color: rgb(1, 1, 1) })

  // Etiqueta documento arriba derecha
  const tag = 'ACCESO AL PORTAL DEL CLIENTE'
  page.drawText(tag, {
    x: A4_W - M - sansBold.widthOfTextAtSize(tag, 8),
    y: heroTop, font: sansBold, size: 8, color: rgb(1, 1, 1),
  })
  const dateText = today
  page.drawText(dateText, {
    x: A4_W - M - sans.widthOfTextAtSize(dateText, 9),
    y: heroTop - 14, font: sans, size: 9, color: rgb(1, 1, 1),
  })

  // Hero titular grande
  const heroEyebrow = 'TU PORTAL ENERGÉTICO'
  page.drawText(heroEyebrow, {
    x: M, y: A4_H - 120, font: sansBold, size: 9, color: WHITE,
  })
  // Línea blanca decorativa
  page.drawLine({
    start: { x: M, y: A4_H - 128 },
    end:   { x: M + 28, y: A4_H - 128 },
    thickness: 2, color: WHITE,
  })

  page.drawText('Tu informe energético,', {
    x: M, y: A4_H - 160, font: sansBold, size: 28, color: WHITE,
  })
  page.drawText('siempre disponible.', {
    x: M, y: A4_H - 192, font: sansBold, size: 28, color: WHITE,
  })

  // Subtítulo
  const subLines = wrapText(
    'Consulta tu consumo, tu gasto y todas tus facturas desde un único enlace privado. Sin contraseña, sin app: sólo abrir y leer.',
    sans, 10.5, A4_W - 2 * M - 140,
  )
  let subY = A4_H - 220
  for (const line of subLines) {
    page.drawText(line, { x: M, y: subY, font: sans, size: 10.5, color: WHITE })
    subY -= 14
  }

  // Mascota a la derecha del subtítulo, sobre el hero
  const mascotBytes = loadMascotBytes()
  if (mascotBytes) {
    try {
      const img = await pdf.embedPng(mascotBytes)
      const imgW = 110
      const imgH = (img.height / img.width) * imgW
      page.drawImage(img, {
        x: A4_W - M - imgW + 14,
        y: A4_H - heroH + 18,
        width: imgW, height: imgH,
      })
    } catch {}
  }

  // ── Card cliente: blanco con borde redondeado y sombra ──────────────────
  let cursorY = A4_H - heroH - 36
  const cardH = 132
  const cardW = A4_W - 2 * M
  // Sombra
  drawShadowedCard(page, M, cursorY - cardH, cardW, cardH, 20, WHITE, LINE)

  // Badge azul "TU PORTAL PRIVADO"
  const badgeText = 'TU PORTAL PRIVADO'
  const badgeW = sansBold.widthOfTextAtSize(badgeText, 8) + 24
  page.drawRectangle({
    x: M + 26, y: cursorY - 28, width: badgeW, height: 22,
    color: SKY_TINT,
  })
  page.drawText(badgeText, {
    x: M + 26 + 12, y: cursorY - 22,
    font: sansBold, size: 8, color: ELECTRIC,
  })

  // Nombre del cliente — sans bold negro (estilo headings voltisenergia)
  const clientName = args.clientName
  const clientLines = wrapText(clientName, sansBold, 22, cardW - 80)
  let cnY = cursorY - 58
  for (const line of clientLines.slice(0, 2)) {
    page.drawText(line, { x: M + 26, y: cnY, font: sansBold, size: 22, color: INK })
    cnY -= 26
  }

  page.drawText('Datos actualizados con cada nueva factura.', {
    x: M + 26, y: cursorY - cardH + 22, font: sans, size: 10, color: BODY,
  })

  cursorY -= cardH + 22

  // ── Card enlace: azul electric, prominente, sin QR ─────────────────────────
  const linkCardH = 110
  // Card azul electric con esquinas (simuladas)
  page.drawRectangle({
    x: M, y: cursorY - linkCardH, width: cardW, height: linkCardH,
    color: ELECTRIC,
  })

  page.drawText('ABRE TU PORTAL EN TU NAVEGADOR', {
    x: M + 26, y: cursorY - 26, font: sansBold, size: 9, color: WHITE,
  })

  // Enlace en mono blanco, dos líneas si hace falta
  const urlLines = chunkUrl(url, 64)
  let urlY = cursorY - 52
  for (const ul of urlLines.slice(0, 2)) {
    page.drawText(ul, { x: M + 26, y: urlY, font: mono, size: 11, color: WHITE })
    urlY -= 16
  }

  page.drawText('Copia y pega este enlace, o guárdalo como marcador para acceder cuando quieras.', {
    x: M + 26, y: cursorY - linkCardH + 18, font: sans, size: 8.5, color: rgb(0.85, 0.88, 0.98),
  })

  cursorY -= linkCardH + 28

  // ── Sección "Qué encontrarás" — 3 cards blancas con iconos azules ───────
  page.drawText('¿QUÉ ENCONTRARÁS DENTRO?', {
    x: M, y: cursorY, font: sansBold, size: 9, color: ELECTRIC,
  })
  cursorY -= 18

  const features = [
    { title: 'Resumen anual',          desc: 'Cuánto pagas en luz y gas, dónde se concentra el gasto y evolución mes a mes.' },
    { title: 'Detalle por suministro', desc: 'Consumo, potencias, precios y conceptos exactos de cada factura.' },
    { title: 'Descargas Excel',        desc: 'Datos listos para tu contabilidad o auditoría interna.' },
  ]
  const gap = 12
  const featCardW = (cardW - gap * 2) / 3
  const featCardH = 96
  features.forEach((f, i) => {
    const x = M + i * (featCardW + gap)
    // Card blanca
    page.drawRectangle({
      x, y: cursorY - featCardH, width: featCardW, height: featCardH,
      color: WHITE, borderColor: LINE, borderWidth: 0.6,
    })
    // Bullet azul electric arriba a la izquierda
    page.drawCircle({ x: x + 18, y: cursorY - 18, size: 4, color: ELECTRIC })
    // Título
    page.drawText(f.title, {
      x: x + 32, y: cursorY - 22, font: sansBold, size: 10.5, color: INK,
    })
    // Descripción
    const descLines = wrapText(f.desc, sans, 9, featCardW - 36)
    let dy = cursorY - 42
    for (const line of descLines.slice(0, 4)) {
      page.drawText(line, { x: x + 32, y: dy, font: sans, size: 9, color: BODY })
      dy -= 12
    }
  })

  cursorY -= featCardH + 28

  // ── Footer ────────────────────────────────────────────────────────────────
  const footY = 56
  // Línea separadora muy fina
  page.drawLine({
    start: { x: M, y: footY + 56 }, end: { x: A4_W - M, y: footY + 56 },
    thickness: 0.5, color: LINE,
  })

  // Columna izquierda — asesor
  page.drawText('TU ASESOR ENERGÉTICO', {
    x: M, y: footY + 38, font: sansBold, size: 7, color: BODY,
  })
  page.drawText(VOLTIS_INFO.name, {
    x: M, y: footY + 22, font: sansBold, size: 11, color: INK,
  })
  // Dirección — partida en dos líneas para que no choque con email
  const addrLines = wrapText(voltisFullAddress(), sans, 8.5, cardW / 2 - 10)
  let aY = footY + 8
  for (const line of addrLines.slice(0, 2)) {
    page.drawText(line, { x: M, y: aY, font: sans, size: 8.5, color: BODY })
    aY -= 11
  }

  // Columna derecha — contacto
  const contactT = 'CONTACTO'
  page.drawText(contactT, {
    x: A4_W - M - sansBold.widthOfTextAtSize(contactT, 7),
    y: footY + 38, font: sansBold, size: 7, color: BODY,
  })
  const phoneT = VOLTIS_INFO.phone
  page.drawText(phoneT, {
    x: A4_W - M - sansBold.widthOfTextAtSize(phoneT, 11),
    y: footY + 22, font: sansBold, size: 11, color: ELECTRIC,
  })
  // Email y web en líneas separadas para evitar solapes
  const emailT = VOLTIS_INFO.email
  page.drawText(emailT, {
    x: A4_W - M - sans.widthOfTextAtSize(emailT, 8.5),
    y: footY + 8, font: sans, size: 8.5, color: BODY,
  })
  const webT = VOLTIS_INFO.website
  page.drawText(webT, {
    x: A4_W - M - sans.widthOfTextAtSize(webT, 8.5),
    y: footY - 3, font: sans, size: 8.5, color: ELECTRIC,
  })

  // Watermark inferior muy sutil
  const wm = 'voltisenergia.com · acceso privado y personal'
  page.drawText(wm, {
    x: (A4_W - sans.widthOfTextAtSize(wm, 7)) / 2,
    y: 22, font: sans, size: 7, color: rgb(0.65, 0.66, 0.71),
  })

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Dibuja la "máscara" para simular bordes inferiores redondeados del hero.
 * pdf-lib no soporta clipping, así que tapamos las esquinas con el color de
 * fondo para crear la curva visual.
 */
function drawRoundedBottomMask(page: PDFPage, w: number, baseY: number, radius: number, bgColor: any) {
  // Esquina inferior-izquierda: cuadrado mascarado + cuarto de círculo
  page.drawRectangle({ x: 0, y: baseY, width: radius, height: radius, color: bgColor })
  page.drawCircle({ x: radius, y: baseY + radius, size: radius, color: bgColor })
  // Esquina inferior-derecha
  page.drawRectangle({ x: w - radius, y: baseY, width: radius, height: radius, color: bgColor })
  page.drawCircle({ x: w - radius, y: baseY + radius, size: radius, color: bgColor })
  // Re-tapar interior central: los dos círculos extienden sus mitades internas hacia
  // el centro, lo que crearía un "valle" entre las dos curvas. Tapamos la banda
  // central con el color del hero para que el resultado visual sea limpio.
  // NB: usamos rgb(0.533, 0.725, 0.906) que coincide con SKY.
  page.drawRectangle({
    x: radius, y: baseY, width: w - 2 * radius, height: radius,
    color: rgb(0.533, 0.725, 0.906),
  })
}

/**
 * Dibuja una card blanca con borde claro simulando sombra suave.
 * pdf-lib no soporta sombras nativas; usamos un rectángulo levemente desplazado
 * con borde gris muy claro.
 */
function drawShadowedCard(
  page: PDFPage, x: number, y: number, w: number, h: number,
  _radius: number, fillColor: any, borderColor: any,
) {
  // "Sombra": rectángulo gris muy claro debajo
  page.drawRectangle({
    x: x + 1, y: y - 1, width: w, height: h,
    color: rgb(0.94, 0.94, 0.95),
  })
  // Card principal
  page.drawRectangle({
    x, y, width: w, height: h,
    color: fillColor, borderColor, borderWidth: 0.5,
  })
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

function chunkUrl(url: string, maxChars: number): string[] {
  const out: string[] = []
  for (let i = 0; i < url.length; i += maxChars) {
    out.push(url.slice(i, i + maxChars))
  }
  return out
}
