/**
 * scripts/update-gas-tariffs.mjs
 *
 * Actualiza el campo `tariff` de los 13 suministros de gas del
 * Ayuntamiento de Estella con el RL real obtenido del SIPS.
 *
 * Ejecutar:
 *   cd "/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm"
 *   node scripts/update-gas-tariffs.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxemljd3JtbXdobmFmYWloaHFoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg5Mzc4NiwiZXhwIjoyMDkwNDY5Nzg2fQ.5q6Y16ywI0qPcNgZ49hIqdWSDEM5thfZEL0_7Rvc01M'

// Tarifa real por CUPS, obtenida del SIPS (archivo Tabla_12-5-2026-17_39_53)
const CUPS_TARIFF_MAP = {
  'ES0226060006617582PC': 'RL.4',   // AYUNTAMIENTO
  'ES0226060010035392YF': 'RL.4',   // CASA DE CULTURA
  'ES0226060004334117HH': 'RL.5',   // COLEGIO
  'ES0226060014476606VJ': 'RL.4',   // 0-3 AÑOS
  'ES0226060005680226XY': 'RL.4',   // BIBLIOTECA
  'ES0226060000627628MW': 'RL.3',   // ANTIGUO AYUNTAMIENTO
  'ES0226060022658874GP': 'RL.4',   // SAN BENITO
  'ES0226060000274946NW': 'RL.3',   // ESTACIÓN TRATAMIENTO
  'ES0226060005881793BR': 'RL.3',   // CARPA
  'ES0226060017572017GS': 'RL.4',   // CENTRO JUVENIL
  'ES0226060012233507BN': 'RL.4',   // FRONTÓN REMONTIVAL
  'ES0226060018445556BZ': 'RL.1',   // FRONTÓN LIZARRA
  'ES0226060019655330DB': 'RL.2',   // PISCINAS
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Actualizando tarifa RL en suministros de gas (Estella) ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  let updated = 0, errors = 0

  for (const [cups, tariff] of Object.entries(CUPS_TARIFF_MAP)) {
    const { data, error } = await sb
      .from('supplies')
      .update({ tariff })
      .eq('cups', cups)
      .select('id, name')

    if (error) {
      console.log(`❌ ${cups}: ${error.message}`)
      errors++
    } else if (!data?.length) {
      console.log(`⚠️  ${cups}: supply no encontrado en BD`)
    } else {
      console.log(`✅ ${tariff.padEnd(5)} → ${data[0].name} (${cups})`)
      updated++
    }
  }

  console.log(`\n✅ Actualizados: ${updated}/13`)
  if (errors) console.log(`❌ Errores: ${errors}`)
  else console.log('\n🎉 Todos los suministros tienen ahora su RL correcto.')
  console.log('\nRecarga el CRM para ver los suministros agrupados por RL.')
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message)
  process.exit(1)
})
