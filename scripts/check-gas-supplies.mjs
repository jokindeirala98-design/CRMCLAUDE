/**
 * scripts/check-gas-supplies.mjs
 *
 * Diagnóstico: busca los suministros de gas del Ayuntamiento de Estella en Supabase.
 * Muestra qué CUPS existen, cómo están almacenados y si hay facturas asociadas.
 *
 * Ejecutar:
 *   cd "/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm"
 *   node scripts/check-gas-supplies.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxemljd3JtbXdobmFmYWloaHFoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg5Mzc4NiwiZXhwIjoyMDkwNDY5Nzg2fQ.5q6Y16ywI0qPcNgZ49hIqdWSDEM5thfZEL0_7Rvc01M'

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// CUPS de gas de Estella que necesitamos importar
const GAS_CUPS = [
  'ES0226060006617582PC', // AYUNTAMIENTO
  'ES0226060010035392YF', // CASA DE CULTURA
  'ES0226060004334117HH', // COLEGIO
  'ES0226060014476606VJ', // 0-3 AÑOS
  'ES0226060005680226XY', // BIBLIOTECA
  'ES0226060000627628MW', // ANTIGUO AYUNTAMIENTO
  'ES0226060022658874GP', // SAN BENITO
  'ES0226060000274946NW', // ESTACION TRATAMIENTO
  'ES0226060005881793BR', // CARPA
  'ES0226060017572017GS', // CENTRO JUVENIL
  'ES0226060012233507BN', // FRONTON REMONTIVAL
  'ES0226060018445556BZ', // FRONTON LIZARRA
  'ES0226060019655330DB', // PISCINAS
]

async function main() {
  console.log('🔍 Buscando cliente Ayuntamiento de Estella...\n')

  // 1. Buscar el cliente
  const { data: clients } = await sb
    .from('clients')
    .select('id, name')
    .ilike('name', '%estella%')

  console.log('Clientes encontrados:', clients?.map(c => `${c.id} — ${c.name}`).join('\n  ') || 'NINGUNO')

  if (!clients?.length) {
    console.log('\n❌ No se encontró cliente Estella. Buscando todos los clientes...')
    const { data: allClients } = await sb.from('clients').select('id, name').limit(30)
    console.log('Todos los clientes:')
    allClients?.forEach(c => console.log(`  ${c.id} — ${c.name}`))
    return
  }

  for (const client of clients) {
    console.log(`\n📋 Cliente: ${client.name} (${client.id})`)

    // 2. Buscar todos sus suministros
    const { data: allSupplies } = await sb
      .from('supplies')
      .select('id, cups, supply_type, name')
      .eq('client_id', client.id)

    const gasSupplies = allSupplies?.filter(s => s.supply_type === 'gas') || []
    const electricSupplies = allSupplies?.filter(s => s.supply_type !== 'gas') || []

    console.log(`  Suministros eléctricos: ${electricSupplies.length}`)
    console.log(`  Suministros gas: ${gasSupplies.length}`)

    if (gasSupplies.length > 0) {
      console.log('\n  Gas supplies encontrados:')
      gasSupplies.forEach(s => console.log(`    ✅ ${s.cups} — ${s.name} (${s.id})`))
    } else {
      console.log('\n  ⚠️  No hay suministros de gas registrados como supplies.')
      console.log('  Los CUPS que necesitamos crear:')
      GAS_CUPS.forEach(c => console.log(`    → ${c}`))
    }

    // 3. Verificar si tiene consumption_data con gasHistory
    const { data: clientData } = await sb
      .from('clients')
      .select('consumption_data')
      .eq('id', client.id)
      .single()

    const hasGasHistory = clientData?.consumption_data?.gasHistory?.length > 0
    console.log(`\n  gasHistory en consumption_data: ${hasGasHistory ? clientData.consumption_data.gasHistory.length + ' registros' : 'vacío o no existe'}`)

    // 4. Facturas de gas existentes
    const { data: invoices } = await sb
      .from('invoices')
      .select('id, supply_id, period_start, period_end')
      .in('supply_id', gasSupplies.map(s => s.id))

    console.log(`  Facturas de gas en invoices: ${invoices?.length || 0}`)
  }

  // 5. Buscar directamente por CUPS (por si están en otro cliente)
  console.log('\n🔍 Buscando CUPS de gas directamente en supplies...')
  const { data: byLike } = await sb
    .from('supplies')
    .select('id, cups, supply_type, name, client_id')
    .like('cups', 'ES0226%')
    .eq('supply_type', 'gas')
    .limit(30)

  if (byLike?.length) {
    console.log(`Suministros gas ES0226* encontrados: ${byLike.length}`)
    byLike.forEach(s => console.log(`  ${s.cups} — ${s.name} (client: ${s.client_id})`))
  } else {
    console.log('❌ No hay supplies de gas con CUPS ES0226 en la BD')
    console.log('\n→ Necesitamos CREAR los 13 suministros de gas antes de importar facturas.')
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
