// Reproducir el error en runtime
process.chdir('/sessions/hopeful-funny-gates/mnt/voltis-crm')

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const QRCode = require('qrcode')

;(async () => {
  try {
    // Replico el comportamiento del endpoint con drawRectangle + borderOpacity
    const pdf = await PDFDocument.create()
    const sans = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([595, 841])

    // Test 1: drawRectangle con borderOpacity
    page.drawRectangle({
      x: 50, y: 100, width: 200, height: 100,
      color: rgb(1, 1, 1), opacity: 0.15,
      borderColor: rgb(1, 1, 1), borderWidth: 0.6, borderOpacity: 0.4,
    })
    console.log('drawRectangle con borderOpacity → OK')

    // Test 2: page.drawText con valores que mi código usa
    page.drawText('Voltis', { x: 50, y: 50, font: sans, size: 13, color: rgb(1, 1, 1) })
    console.log('drawText → OK')

    // Test 3: QR
    const qrData = await QRCode.toDataURL('https://test.com', { margin: 0, scale: 10, color: { dark: '#0A2A6B', light: '#FFFFFF' }, errorCorrectionLevel: 'M' })
    const qrBytes = Buffer.from(qrData.split(',')[1], 'base64')
    const qrImg = await pdf.embedPng(qrBytes)
    page.drawImage(qrImg, { x: 50, y: 200, width: 100, height: 100 })
    console.log('QR → OK')

    // Test 4: Save
    const bytes = await pdf.save()
    console.log('save → OK, bytes:', bytes.length)
  } catch (e) {
    console.error('FAIL:', e.message)
    console.error(e.stack)
  }
})()
