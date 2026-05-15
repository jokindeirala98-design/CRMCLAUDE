// Genera preview del nuevo dossier con datos del Ayuntamiento de Orcoyen
const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
const QRCode = (await import('qrcode')).default
const fs = await import('fs')
const path = await import('path')

const COBALT_BG     = rgb(0.067, 0.165, 0.392)
const COBALT_DARK   = rgb(0.039, 0.125, 0.373)
const COBALT_MID    = rgb(0.122, 0.278, 0.710)
const SKY_TINT      = rgb(0.180, 0.357, 0.851)
const VOLTIS_BLUE   = rgb(0.122, 0.357, 1.0)
const VOLTIS_SKY    = rgb(0.725, 0.820, 1.0)
const WHITE         = rgb(1, 1, 1)
const WHITE_85      = rgb(0.95, 0.95, 0.95)
const WHITE_70      = rgb(0.85, 0.85, 0.92)
const GREEN_LIVE    = rgb(0.498, 1.0, 0.725)

const clientName = 'AYUNTAMIENTO DE ORCOYEN'
const token = '116f38cfd0c246b983a54ad99ee1c5ebe1d3a1c1a0404f0a9c03fd110f23d400'
const url = `https://voltis-crm-bueno.vercel.app/portal/${token}`

const greetingName = 'Ayuntamiento de Orcoyen'

const pdf = await PDFDocument.create()
const sans = await pdf.embedFont(StandardFonts.Helvetica)
const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold)
const mono = await pdf.embedFont(StandardFonts.Courier)
const A4_W = 595.28, A4_H = 841.89
const page = pdf.addPage([A4_W, A4_H])

// Fondo cobalto gradiente
const bands = 60
for (let i = 0; i < bands; i++) {
  const t = i / (bands - 1)
  let r, g, b
  if (t < 0.4) { const u = t/0.4; r = 0.180+(0.067-0.180)*u; g = 0.357+(0.165-0.357)*u; b = 0.851+(0.392-0.851)*u }
  else { const u = (t-0.4)/0.6; r = 0.067+(0.039-0.067)*u; g = 0.165+(0.125-0.165)*u; b = 0.392+(0.373-0.392)*u }
  page.drawRectangle({ x:0, y: A4_H-((i+1)*A4_H/bands), width: A4_W, height: Math.ceil(A4_H/bands)+1, color: rgb(r,g,b) })
}
// Halos
for (let i=0;i<6;i++) page.drawCircle({ x: A4_W*0.85, y: A4_H-100, size: 150-i*12, color: rgb(1,1,1), opacity: 0.04 })
for (let i=0;i<6;i++) page.drawCircle({ x: A4_W*0.10, y: 200, size: 200-i*14, color: rgb(1,1,1), opacity: 0.025 })

const M = 48
let cursorY = A4_H - 46

// Top bar
page.drawText('Voltis', { x: M, y: cursorY, font: sansBold, size: 13, color: WHITE })
page.drawText('Energía', { x: M + sansBold.widthOfTextAtSize('Voltis', 13) + 6, y: cursorY, font: sans, size: 13, color: WHITE_70 })
const metaR = 'www.voltisenergia.com'
page.drawText(metaR, { x: A4_W-M-sans.widthOfTextAtSize(metaR, 9), y: cursorY, font: sans, size: 9, color: WHITE_70 })

cursorY -= 38

// Eyebrow píldora
const eyebrowText = 'TU PORTAL ESTÁ LISTO'
const eyebrowW = sansBold.widthOfTextAtSize(eyebrowText, 7.5) + 38
page.drawRectangle({ x: M, y: cursorY-6, width: eyebrowW, height: 18, color: WHITE, opacity: 0.14 })
page.drawCircle({ x: M+11, y: cursorY+3, size: 2.4, color: GREEN_LIVE })
page.drawText(eyebrowText, { x: M+20, y: cursorY, font: sansBold, size: 7.5, color: WHITE })

cursorY -= 26

// Titular
page.drawText(`Querido ${greetingName},`, { x: M, y: cursorY, font: sansBold, size: 26, color: WHITE })
cursorY -= 30
page.drawText('bienvenido al club Voltis.', { x: M, y: cursorY, font: sansBold, size: 26, color: WHITE })
cursorY -= 26

// Subtítulo
const subText = 'Hemos preparado un espacio privado donde puedes ver, en cualquier momento, todo lo que pasa con tu energía: consumo, gasto y facturas. Sin contraseñas, sin apps, sin papeleo. Sólo abrir y leer.'
const words = subText.split(/\s+/)
const maxW = A4_W - 2*M - 180
let line = '', subY = cursorY
for (const w of words) {
  const trial = line ? line+' '+w : w
  if (sans.widthOfTextAtSize(trial, 10.5) <= maxW) line = trial
  else { page.drawText(line, { x: M, y: subY, font: sans, size: 10.5, color: WHITE_85 }); subY -= 14; line = w }
}
if (line) page.drawText(line, { x: M, y: subY, font: sans, size: 10.5, color: WHITE_85 })

// Mascota
try {
  const mb = fs.readFileSync('public/mascota-transparente.png')
  const img = await pdf.embedPng(mb)
  const imgW = 140, imgH = (img.height/img.width) * imgW
  page.drawCircle({ x: A4_W-M-imgW/2+8, y: cursorY-imgH/2+28, size: 80, color: VOLTIS_SKY, opacity: 0.35 })
  page.drawImage(img, { x: A4_W-M-imgW+8, y: cursorY-imgH+14, width: imgW, height: imgH })
} catch(e) { console.log('mascot:', e.message) }

cursorY -= 78

// Card portal
const cardH = 168, cardW = A4_W - 2*M
page.drawRectangle({ x: M+2, y: cursorY-cardH-2, width: cardW, height: cardH, color: rgb(0,0,0), opacity: 0.18 })
page.drawRectangle({ x: M, y: cursorY-cardH, width: cardW, height: cardH, color: WHITE, opacity: 0.15, borderColor: WHITE, borderWidth: 0.6, borderOpacity: 0.4 })
page.drawRectangle({ x: M, y: cursorY-cardH*0.4, width: cardW, height: cardH*0.4, color: WHITE, opacity: 0.08 })

const labelY = cursorY - 26
page.drawText('PORTAL PRIVADO DE', { x: M+22, y: labelY, font: sansBold, size: 8, color: WHITE_70 })
page.drawText(clientName, { x: M+22, y: labelY-18, font: sansBold, size: 18, color: WHITE })

const pillText = 'DATOS EN VIVO'
const pillW = sansBold.widthOfTextAtSize(pillText, 7.5) + 30
page.drawRectangle({ x: M+cardW-pillW-22, y: labelY-2, width: pillW, height: 17, color: WHITE, opacity: 0.20 })
page.drawCircle({ x: M+cardW-pillW-22+10, y: labelY+7, size: 2.4, color: GREEN_LIVE })
page.drawText(pillText, { x: M+cardW-pillW-22+18, y: labelY+4, font: sansBold, size: 7.5, color: WHITE })

const urlCaptionY = cursorY - cardH + 92
page.drawText('ÁBRELO DESDE TU NAVEGADOR', { x: M+22, y: urlCaptionY, font: sansBold, size: 7.5, color: WHITE_70 })

const urlBlockY = urlCaptionY - 36
const urlBlockW = cardW - 44 - 130
page.drawRectangle({ x: M+22, y: urlBlockY-4, width: urlBlockW, height: 30, color: COBALT_DARK, opacity: 0.5 })

let i = 0, ux = M+30, uy = urlBlockY+14
const urlSlice1 = url.slice(0, 56), urlSlice2 = url.slice(56, 112)
page.drawText(urlSlice1, { x: ux, y: uy, font: mono, size: 9, color: WHITE })
if (urlSlice2) page.drawText(urlSlice2, { x: ux, y: uy-12, font: mono, size: 9, color: WHITE })

page.drawText('Copia y pega el enlace, guárdalo como marcador o escanea el QR.', { x: M+22, y: urlBlockY-18, font: sans, size: 8.5, color: WHITE_70 })
page.drawText('Es tuyo y sólo tuyo.', { x: M+22, y: urlBlockY-30, font: sans, size: 8.5, color: WHITE_70 })

// QR real
const qrDataUrl = await QRCode.toDataURL(url, { margin: 0, scale: 10, color: { dark: '#0A2A6B', light: '#FFFFFF' }, errorCorrectionLevel: 'M' })
const qrPngBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64')
const qrImg = await pdf.embedPng(qrPngBytes)
const qrSize = 110
const qrX = M+cardW-qrSize-26, qrY = cursorY-cardH+32
page.drawRectangle({ x: qrX-8, y: qrY-8, width: qrSize+16, height: qrSize+16, color: WHITE, borderColor: rgb(0.122,0.357,1.0), borderWidth: 0.5, borderOpacity: 0.15 })
page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize })

cursorY -= cardH + 28

// Inside head
page.drawText('LO QUE ENCONTRARÁS DENTRO', { x: M, y: cursorY, font: sansBold, size: 9, color: WHITE })
const subRight = 'Se actualiza solo con cada nueva factura'
page.drawText(subRight, { x: A4_W-M-sans.widthOfTextAtSize(subRight, 8.5), y: cursorY, font: sans, size: 8.5, color: WHITE_70 })

cursorY -= 18

// Features
const features = [
  ['Tu resumen anual',         'Cuánto pagas en luz y gas, dónde se concentra el gasto y cómo evoluciona mes a mes.'],
  ['Detalle por suministro',   'Consumo, potencias, precios y conceptos exactos de cada una de tus facturas.'],
  ['Descargas en Excel',       'Datos listos para tu contabilidad o cualquier auditoría que necesites hacer.'],
]
const gap = 10, fW = (cardW-gap*2)/3, fH = 86
features.forEach(([title, desc], i) => {
  const x = M + i*(fW+gap)
  page.drawRectangle({ x: x+1, y: cursorY-fH-1, width: fW, height: fH, color: rgb(0,0,0), opacity: 0.12 })
  page.drawRectangle({ x, y: cursorY-fH, width: fW, height: fH, color: WHITE, opacity: 0.13, borderColor: WHITE, borderWidth: 0.5, borderOpacity: 0.35 })
  page.drawRectangle({ x: x+14, y: cursorY-26, width: 22, height: 18, color: WHITE, opacity: 0.20 })
  page.drawText(title, { x: x+14, y: cursorY-42, font: sansBold, size: 11, color: WHITE })
  const ws = desc.split(/\s+/)
  let line = '', dy = cursorY-56
  for (const w of ws) {
    const trial = line ? line+' '+w : w
    if (sans.widthOfTextAtSize(trial, 8.5) <= fW-28) line = trial
    else { page.drawText(line, { x: x+14, y: dy, font: sans, size: 8.5, color: WHITE_85 }); dy -= 11; line = w }
  }
  if (line) page.drawText(line, { x: x+14, y: dy, font: sans, size: 8.5, color: WHITE_85 })
})

cursorY -= fH + 36

// Footer
const footY = 60
const signoffLines = ['Estamos aquí para ti. Si tienes cualquier duda, una llamada o un', 'correo basta — somos personas reales al otro lado, y nos encanta', 'poner las cosas fáciles.']
let sY = footY+28
page.drawText('Estamos aquí para ti.', { x: M, y: sY, font: sansBold, size: 10.5, color: WHITE })
page.drawText('Si tienes cualquier duda, una llamada o un', { x: M+sansBold.widthOfTextAtSize('Estamos aquí para ti.', 10.5)+4, y: sY, font: sans, size: 10, color: WHITE_85 })
sY -= 13
page.drawText('correo basta — somos personas reales al otro lado, y nos encanta', { x: M, y: sY, font: sans, size: 10, color: WHITE_85 })
sY -= 13
page.drawText('poner las cosas fáciles.', { x: M, y: sY, font: sans, size: 10, color: WHITE_85 })

page.drawText('— El equipo de Voltis', { x: M, y: footY-4, font: sans, size: 9, color: WHITE_70 })

page.drawText('CONTACTO', { x: A4_W-M-sansBold.widthOfTextAtSize('CONTACTO', 7.5), y: footY+30, font: sansBold, size: 7.5, color: WHITE_70 })
page.drawText('747 474 360', { x: A4_W-M-sansBold.widthOfTextAtSize('747 474 360', 12), y: footY+14, font: sansBold, size: 12, color: WHITE })
page.drawText('admin@voltisenergia.com', { x: A4_W-M-sans.widthOfTextAtSize('admin@voltisenergia.com', 9), y: footY, font: sans, size: 9, color: WHITE_85 })
page.drawText('www.voltisenergia.com', { x: A4_W-M-sans.widthOfTextAtSize('www.voltisenergia.com', 9), y: footY-12, font: sans, size: 9, color: WHITE_70 })

const bytes = await pdf.save()
fs.writeFileSync('/sessions/hopeful-funny-gates/mnt/outputs/dossier-cobalto-preview.pdf', bytes)
fs.writeFileSync('dossier-cobalto-preview.pdf', bytes)
console.log('OK', bytes.length, 'bytes')
