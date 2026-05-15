import { buildDossierPdf } from './src/lib/dossier-pdf.ts'

;(async () => {
  try {
    const bytes = await buildDossierPdf({
      clientName: 'Ayuntamiento de Orcoyen',
      token: '116f38cfd0c246b983a54ad99ee1c5ebe1d3a1c1a0404f0a9c03fd110f23d400',
    })
    console.log('OK', bytes.length, 'bytes')
    const fs = await import('fs')
    fs.writeFileSync('_real_dossier_test.pdf', bytes)
  } catch (e) {
    console.error('FAIL:', e.message)
    console.error(e.stack)
  }
})()
