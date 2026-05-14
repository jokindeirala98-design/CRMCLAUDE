/**
 * scripts/setup-gas-estella.mjs
 *
 * 1. Crea los 13 suministros de gas del Ayuntamiento de Estella en Supabase.
 * 2. Importa todas las facturas con desglose completo desde el Excel definitivo.
 *
 * Ejecutar:
 *   cd "/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm"
 *   node scripts/setup-gas-estella.mjs
 */

import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxemljd3JtbXdobmFmYWloaHFoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg5Mzc4NiwiZXhwIjoyMDkwNDY5Nzg2fQ.5q6Y16ywI0qPcNgZ49hIqdWSDEM5thfZEL0_7Rvc01M'
const CLIENT_ID = '0c7d2d2c-6551-4ec4-aa7a-f735193aace4' // AYUNTAMIENTO DE ESTELLA

const EXCEL_PATH = path.resolve(__dirname, '..', '..', 'Estella_Lizarra_Gas_DEFINITIVO.xlsx')

// ─── 13 suministros de gas ──────────────────────────────────────────────────
const GAS_SUPPLIES = [
  { cups: 'ES0226060006617582PC', name: 'AYUNTAMIENTO — Gas',           address: 'Ayuntamiento de Estella' },
  { cups: 'ES0226060010035392YF', name: 'CASA DE CULTURA — Gas',        address: 'Casa de Cultura' },
  { cups: 'ES0226060004334117HH', name: 'COLEGIO — Gas',                address: 'Colegio Remontival' },
  { cups: 'ES0226060014476606VJ', name: '0-3 AÑOS — Gas',               address: 'Guardería 0-3 Años' },
  { cups: 'ES0226060005680226XY', name: 'BIBLIOTECA — Gas',             address: 'Biblioteca Municipal' },
  { cups: 'ES0226060000627628MW', name: 'ANTIGUO AYUNTAMIENTO — Gas',   address: 'Antiguo Ayuntamiento' },
  { cups: 'ES0226060022658874GP', name: 'SAN BENITO — Gas',             address: 'San Benito' },
  { cups: 'ES0226060000274946NW', name: 'ESTACIÓN TRATAMIENTO — Gas',   address: 'Estación de Tratamiento' },
  { cups: 'ES0226060005881793BR', name: 'CARPA — Gas',                  address: 'Carpa Municipal' },
  { cups: 'ES0226060017572017GS', name: 'CENTRO JUVENIL — Gas',         address: 'Centro Juvenil' },
  { cups: 'ES0226060012233507BN', name: 'FRONTÓN REMONTIVAL — Gas',     address: 'Frontón Remontival' },
  { cups: 'ES0226060018445556BZ', name: 'FRONTÓN LIZARRA — Gas',        address: 'Frontón Lizarra' },
  { cups: 'ES0226060019655330DB', name: 'PISCINAS — Gas',               address: 'Piscinas Municipales' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────
function toNum(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

function parseDate(v) {
  if (!v) return null
  if (v instanceof Date) {
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate()
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── Paso 1: Crear suministros de gas ────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  PASO 1: Crear suministros de gas en Supabase           ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const supplyIdMap = {}  // cups → id

  for (const s of GAS_SUPPLIES) {
    // Verificar si ya existe
    const { data: existing } = await sb
      .from('supplies')
      .select('id')
      .eq('cups', s.cups)
      .limit(1)

    if (existing?.length) {
      supplyIdMap[s.cups] = existing[0].id
      console.log(`⏭️  Ya existe: ${s.cups} — ${s.name} (${existing[0].id})`)
      continue
    }

    // Crear supply
    const { data: created, error } = await sb
      .from('supplies')
      .insert({
        client_id:   CLIENT_ID,
        cups:        s.cups,
        supply_type: 'gas',
        name:        s.name,
        address:     s.address,
        tariff:      'gas',
        status:      'active',
      })
      .select('id')
      .single()

    if (error) {
      console.log(`❌ Error creando ${s.cups}: ${error.message}`)
    } else {
      supplyIdMap[s.cups] = created.id
      console.log(`✅ Creado: ${s.cups} — ${s.name} (${created.id})`)
    }
  }

  console.log(`\n✅ Suministros listos: ${Object.keys(supplyIdMap).length}/13\n`)

  // ── Paso 2: Importar facturas ────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  PASO 2: Importar facturas con desglose completo        ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  console.log(`📂 Leyendo Excel: ${EXCEL_PATH}`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(EXCEL_PATH)
  console.log(`📋 Hojas: ${wb.worksheets.length}\n`)

  let totalUpdated = 0, totalCreated = 0, totalSkipped = 0
  const errors = []

  for (const ws of wb.worksheets) {
    const cellVal = (r, c) => {
      const v = ws.getCell(r, c).value
      return (v !== null && typeof v === 'object' && 'result' in v) ? v.result : v
    }

    const cups = String(cellVal(1, 2) || '').trim()
    if (!cups.startsWith('ES0226')) {
      console.log(`⚠️  ${ws.name}: CUPS inválido (${cups}), saltando`)
      continue
    }

    const supplyName = String(cellVal(1, 4) || '').trim() || ws.name
    const supplyId = supplyIdMap[cups]

    if (!supplyId) {
      console.log(`❌ ${ws.name}: supply no encontrado para ${cups}`)
      errors.push({ sheet: ws.name, error: 'supply not found' })
      continue
    }

    // Cargar facturas existentes
    const { data: existingInvs } = await sb
      .from('invoices')
      .select('id, period_start, period_end, total_amount')
      .eq('supply_id', supplyId)

    const invIndex = {}
    for (const inv of (existingInvs || [])) {
      if (inv.period_start && inv.period_end) {
        invIndex[`${inv.period_start}|${inv.period_end}`] = inv
      }
    }

    console.log(`🔥 ${ws.name} — ${supplyName}`)
    console.log(`   CUPS: ${cups} | Supply: ${supplyId}`)
    console.log(`   Facturas en BD: ${existingInvs?.length || 0}`)

    let sheetUpdated = 0, sheetCreated = 0, sheetSkipped = 0
    const lastCol = ws.columnCount

    for (let col = 3; col <= lastCol; col++) {
      const fechaInicio = parseDate(cellVal(4, col))
      const fechaFin    = parseDate(cellVal(5, col))
      if (!fechaInicio || !fechaFin) continue

      const dias         = toNum(cellVal(6, col))
      const consumoMWh  = toNum(cellVal(8, col))
      const precioMWh   = toNum(cellVal(9, col))
      const impEnergia  = toNum(cellVal(10, col))
      const cuotaFija   = toNum(cellVal(12, col))
      const cuotaDia    = toNum(cellVal(13, col))
      const impHidro    = toNum(cellVal(14, col))
      const totalFact   = toNum(cellVal(16, col))
      const costeMedio  = toNum(cellVal(17, col))

      if (consumoMWh == null && totalFact == null) {
        sheetSkipped++
        continue
      }

      const consumoKwh    = consumoMWh != null ? Math.round(consumoMWh * 1000) : null
      const precioKwh     = precioMWh  != null ? +(precioMWh / 1000).toFixed(6) : null
      const costeMedioKwh = costeMedio != null ? +(costeMedio / 1000).toFixed(6) : null

      // IVA derivado
      let ivaTotal = null
      if (totalFact != null) {
        const sumSinIva = (impEnergia || 0) + (cuotaFija || 0) + (impHidro || 0)
        const iva = +(totalFact - sumSinIva).toFixed(2)
        if (iva >= 0) ivaTotal = iva
      }

      const economics = {
        supply_type:       'gas',
        fechaInicio,
        fechaFin,
        comercializadora:  'Naturgy',
        cups,
        consumoTotalKwh:   consumoKwh,
        costeBrutoConsumo: impEnergia,
        costeNetoConsumo:  impEnergia,
        costeMedioKwh:     costeMedioKwh ?? precioKwh,
        costeMedioKwhNeto: costeMedioKwh ?? precioKwh,
        totalFactura:      totalFact,
        gasPricing: {
          precioKwh,
          terminoFijoDiario:      cuotaDia,
          diasFacturados:         dias,
          terminoFijoTotal:       cuotaFija,
          impuestoHidrocarbTotal: impHidro,
          ivaTotal,
        }
      }

      const extractedData = {
        economics,
        supply_type:     'gas',
        comercializadora: 'Naturgy',
        cups,
      }

      const key = `${fechaInicio}|${fechaFin}`
      const existing = invIndex[key]

      if (existing) {
        const { error: updErr } = await sb
          .from('invoices')
          .update({
            extracted_data:        extractedData,
            total_amount:          totalFact ?? existing.total_amount,
            extraction_status:     'completed',
            extraction_confidence: 1.0,
          })
          .eq('id', existing.id)

        if (updErr) {
          errors.push({ sheet: ws.name, period: fechaInicio, error: updErr.message })
        } else {
          sheetUpdated++
        }
      } else if (totalFact != null || consumoKwh != null) {
        const { error: insErr } = await sb
          .from('invoices')
          .insert({
            supply_id:             supplyId,
            file_url:              `excel-import:gas:${ws.name}:col${col}`,
            file_type:             'pdf',
            extracted_data:        extractedData,
            period_start:          fechaInicio,
            period_end:            fechaFin,
            total_amount:          totalFact,
            extraction_status:     'completed',
            extraction_confidence: 1.0,
          })

        if (insErr) {
          errors.push({ sheet: ws.name, period: fechaInicio, error: insErr.message })
        } else {
          sheetCreated++
        }
      } else {
        sheetSkipped++
      }
    }

    console.log(`   ✅ Actualizadas: ${sheetUpdated} | ✨ Nuevas: ${sheetCreated} | ⏭️  Saltadas: ${sheetSkipped}\n`)
    totalUpdated += sheetUpdated
    totalCreated += sheetCreated
    totalSkipped += sheetSkipped
  }

  console.log('═══════════════════════════════════════════════════════════')
  console.log(`✅ Suministros creados/verificados: ${Object.keys(supplyIdMap).length}`)
  console.log(`✅ Facturas actualizadas:           ${totalUpdated}`)
  console.log(`✨ Facturas nuevas creadas:          ${totalCreated}`)
  console.log(`⏭️  Saltadas (sin datos):             ${totalSkipped}`)
  if (errors.length) {
    console.log(`\n❌ Errores (${errors.length}):`)
    errors.forEach(e => console.log(`   ${e.sheet} / ${e.period || ''}: ${e.error}`))
  } else {
    console.log('\n🎉 Sin errores. Los 13 suministros de gas están listos en el CRM.')
  }
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message)
  process.exit(1)
})
