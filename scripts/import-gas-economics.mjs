/**
 * scripts/import-gas-economics.mjs
 *
 * Importa el desglose completo de facturas de gas del Ayuntamiento de Estella
 * desde el Excel "Estella_Lizarra_Gas_AnualEconomics.xlsx" a Supabase.
 *
 * Llena en cada factura existente:
 *   • Consumo (MWh → kWh)
 *   • Precio gas (€/MWh → €/kWh)
 *   • Importe Energía
 *   • Cuota Fija (€ total + €/día)
 *   • Impuesto Hidrocarburos
 *   • IVA derivado
 *   • Total Factura
 *
 * Para periodos sin factura existente, la crea automáticamente.
 *
 * Ejecutar desde el Mac (desde la carpeta voltis-crm):
 *   cd "/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm"
 *   node scripts/import-gas-economics.mjs
 *
 * El Excel debe estar en: /Users/jokindeirala/Desktop/VOLTIS CRM/Estella_Lizarra_Gas_DEFINITIVO.xlsx
 */

import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://wqzicwrmmwhnafaihhqh.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxemljd3JtbXdobmFmYWloaHFoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg5Mzc4NiwiZXhwIjoyMDkwNDY5Nzg2fQ.5q6Y16ywI0qPcNgZ49hIqdWSDEM5thfZEL0_7Rvc01M'

// Excel definitivo (generado combinando AnualEconomics + Comparativa histórica)
const EXCEL_PATH = path.resolve(__dirname, '..', '..', 'Estella_Lizarra_Gas_DEFINITIVO.xlsx')

// ─── Helpers ────────────────────────────────────────────────────────────────

function toNum(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

/** Convierte DD/MM/YYYY o Date a YYYY-MM-DD */
function parseDate(v) {
  if (!v) return null
  if (v instanceof Date) {
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate()
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  console.log(`\n📂 Leyendo Excel: ${EXCEL_PATH}`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(EXCEL_PATH)
  console.log(`📋 Hojas encontradas: ${wb.worksheets.length}\n`)

  let totalUpdated = 0, totalCreated = 0, totalSkipped = 0
  const errors = []

  for (const ws of wb.worksheets) {
    const sheetName = ws.name

    // Helper: valor de celda (1-indexed)
    const cellVal = (r, c) => {
      const v = ws.getCell(r, c).value
      // ExcelJS devuelve fórmulas como objetos {formula, result}
      return (v !== null && typeof v === 'object' && 'result' in v) ? v.result : v
    }

    // ── Fila 1: CUPS (col B=2) y nombre (col D=4)
    const cups = String(cellVal(1, 2) || '').trim()
    if (!cups.startsWith('ES0226')) {
      console.log(`⚠️  ${sheetName}: sin CUPS válido (${cups}), saltando`)
      continue
    }
    const supplyName = String(cellVal(1, 4) || '').trim() || sheetName

    // Buscar suministro en Supabase
    const { data: supplies, error: supErr } = await sb
      .from('supplies')
      .select('id, cups, supply_type')
      .eq('cups', cups)
      .limit(1)

    if (supErr || !supplies?.length) {
      console.log(`❌ ${sheetName}: suministro no encontrado para CUPS ${cups}`)
      errors.push({ sheet: sheetName, error: 'supply not found' })
      continue
    }

    const supply = supplies[0]
    const supplyId = supply.id

    // Cargar facturas existentes de este suministro
    const { data: existingInvs } = await sb
      .from('invoices')
      .select('id, period_start, period_end, total_amount, extracted_data')
      .eq('supply_id', supplyId)

    // Indexar por "start|end"
    const invIndex = {}
    for (const inv of (existingInvs || [])) {
      if (inv.period_start && inv.period_end) {
        invIndex[`${inv.period_start}|${inv.period_end}`] = inv
      }
    }

    console.log(`🔥 ${sheetName} — ${supplyName}`)
    console.log(`   CUPS: ${cups} | Supply: ${supplyId}`)
    console.log(`   Facturas en BD: ${existingInvs?.length || 0}`)

    let sheetUpdated = 0, sheetCreated = 0, sheetSkipped = 0

    // Recorrer columnas de datos (col 3 en adelante)
    const lastCol = ws.columnCount

    for (let col = 3; col <= lastCol; col++) {
      // ── Fechas (filas 4 y 5)
      const fechaInicio = parseDate(cellVal(4, col))
      const fechaFin    = parseDate(cellVal(5, col))
      if (!fechaInicio || !fechaFin) continue

      // ── Datos de la columna
      const dias         = toNum(cellVal(6, col))   // Días facturados
      const consumoMWh  = toNum(cellVal(8, col))    // Consumo (MWh)
      const precioMWh   = toNum(cellVal(9, col))    // Precio Gas (€/MWh)
      const impEnergia  = toNum(cellVal(10, col))   // Importe Energía (€)
      const cuotaFija   = toNum(cellVal(12, col))   // Cuota Fija (€)
      const cuotaDia    = toNum(cellVal(13, col))   // Cuota Fija (€/día)
      const impHidro    = toNum(cellVal(14, col))   // Imp. Hidrocarburos (€)
      const totalFact   = toNum(cellVal(16, col))   // Total Factura (€)
      const costeMedio  = toNum(cellVal(17, col))   // Coste Medio (€/MWh)

      // Saltar columnas sin datos relevantes
      if (consumoMWh == null && totalFact == null) {
        sheetSkipped++
        continue
      }

      // Conversiones
      const consumoKwh = consumoMWh != null ? Math.round(consumoMWh * 1000) : null
      const precioKwh  = precioMWh  != null ? +(precioMWh / 1000).toFixed(6) : null
      const costeMedioKwh = costeMedio != null ? +(costeMedio / 1000).toFixed(6) : null

      // IVA derivado
      let ivaTotal = null
      if (totalFact != null) {
        const sumSinIva = (impEnergia || 0) + (cuotaFija || 0) + (impHidro || 0)
        const iva = +(totalFact - sumSinIva).toFixed(2)
        if (iva >= 0) ivaTotal = iva
      }

      // ── Estructura economics compatible con BillEconomics de AnnualEconomics.tsx
      const economics = {
        supply_type: 'gas',
        fechaInicio,
        fechaFin,
        comercializadora: 'Naturgy',
        cups,
        consumoTotalKwh:     consumoKwh,
        costeBrutoConsumo:   impEnergia,
        costeNetoConsumo:    impEnergia,
        costeMedioKwh:       costeMedioKwh ?? precioKwh,
        costeMedioKwhNeto:   costeMedioKwh ?? precioKwh,
        totalFactura:        totalFact,
        gasPricing: {
          precioKwh,
          terminoFijoDiario:       cuotaDia,
          diasFacturados:          dias,
          terminoFijoTotal:        cuotaFija,
          impuestoHidrocarbTotal:  impHidro,
          ivaTotal,
        }
      }

      const extractedData = {
        economics,
        supply_type:    'gas',
        comercializadora: 'Naturgy',
        cups,
      }

      const key = `${fechaInicio}|${fechaFin}`
      const existing = invIndex[key]

      if (existing) {
        // UPDATE factura existente
        const { error: updErr } = await sb
          .from('invoices')
          .update({
            extracted_data:      extractedData,
            total_amount:        totalFact ?? existing.total_amount,
            extraction_status:   'completed',
            extraction_confidence: 1.0,
          })
          .eq('id', existing.id)

        if (updErr) {
          console.log(`   ⚠️  Error UPDATE ${fechaInicio}→${fechaFin}: ${updErr.message}`)
          errors.push({ sheet: sheetName, period: fechaInicio, error: updErr.message })
        } else {
          sheetUpdated++
        }
      } else if (totalFact != null || consumoKwh != null) {
        // INSERT nueva factura
        const { error: insErr } = await sb
          .from('invoices')
          .insert({
            supply_id:           supplyId,
            file_url:            `excel-import:gas:${sheetName}:col${col}`,
            file_type:           'pdf',
            extracted_data:      extractedData,
            period_start:        fechaInicio,
            period_end:          fechaFin,
            total_amount:        totalFact,
            extraction_status:   'completed',
            extraction_confidence: 1.0,
          })

        if (insErr) {
          console.log(`   ⚠️  Error INSERT ${fechaInicio}→${fechaFin}: ${insErr.message}`)
          errors.push({ sheet: sheetName, period: fechaInicio, error: insErr.message })
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

  console.log('═══════════════════════════════════════════════')
  console.log(`✅ Total facturas actualizadas:  ${totalUpdated}`)
  console.log(`✨ Total facturas nuevas creadas: ${totalCreated}`)
  console.log(`⏭️  Total saltadas (sin datos):   ${totalSkipped}`)
  if (errors.length) {
    console.log(`\n❌ Errores (${errors.length}):`)
    errors.forEach(e => console.log(`   ${e.sheet} / ${e.period || ''}: ${e.error}`))
  } else {
    console.log('\n🎉 Sin errores. El CRM mostrará el desglose completo.')
  }
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message)
  process.exit(1)
})
