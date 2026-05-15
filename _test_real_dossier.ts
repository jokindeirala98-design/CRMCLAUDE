import { buildDossierPdf } from './src/lib/dossier-pdf'
import fs from 'fs'

;(async () => {
  try {
    const bytes = await buildDossierPdf({
      clientName: 'Ayuntamiento de Orcoyen',
      token: '116f38cfd0c246b983a54ad99ee1c5ebe1d3a1c1a0404f0a9c03fd110f23d400',
    })
    console.log('OK', bytes.length, 'bytes')
    fs.writeFileSync('_real_dossier_test.pdf', bytes)
  } catch (e: any) {
    console.error('FAIL:', e.message)
    console.error(e.stack)
  }
})()
