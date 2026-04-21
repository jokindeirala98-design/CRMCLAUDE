/**
 * POST /api/supplies/[id]/economic-study
 *
 * Genera el Excel "PRE ESTUDIO ECONÓMICO COMPARATIVA" usando la plantilla base.
 * Rellena todos los datos automáticos del suministro y del cliente.
 * El admin sólo aporta: comercializadora nueva + precio €/kWh por período.
 *
 * Body JSON:
 * {
 *   nueva_comercializadora: string
 *   precios_nuevos: number[]   // €/kWh por período [p1, p2, ..., p6]
 *   ssaa?: number              // opcional, manual
 *   excesos?: number           // opcional, manual
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getBOEPrices, normalizeTariff } from '@/lib/boe-prices'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'

// ── Helpers ───────────────────────────────────────────────────────────────────

function set(ws: ExcelJS.Worksheet, cell: string, value: any) {
  ws.getCell(cell).value = value
}

function fmt2(n: number) { return Math.round(n * 100) / 100 }

/** Extrae potencias contratadas por período desde consumption_data (SIPS) */
function extractPowers(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)
  // Intentar campo potenciasContratadas (array)
  if (Array.isArray(sipsData.potenciasContratadas)) {
    return sipsData.potenciasContratadas.slice(0, periodCount).map(Number)
  }
  // Intentar campos individuales p1..p6
  const powers: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    const v = sipsData[`potenciaP${i}`] ?? sipsData[`p${i}`] ?? sipsData[`P${i}`] ?? 0
    powers.push(Number(v))
  }
  if (powers.some(p => p > 0)) return powers
  // Fallback: potencia única aplicada a todos
  const single = Number(sipsData.potenciaContratada ?? sipsData.potencia ?? 0)
  return Array(periodCount).fill(single)
}

/** Extrae consumo anual por período desde consumption_data (SIPS) */
function extractConsumption(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)
  // Intentar consumoPorPeriodo
  if (Array.isArray(sipsData.consumoPorPeriodo)) {
    return sipsData.consumoPorPeriodo.slice(0, periodCount).map(Number)
  }
  // Intentar campos individuales
  const cons: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    const v = sipsData[`consumoP${i}`] ?? sipsData[`energiaP${i}`] ?? 0
    cons.push(Number(v))
  }
  if (cons.some(c => c > 0)) return cons
  // Fallback: consumo total distribuido uniformemente
  const total = Number(sipsData.totalKwh ?? sipsData.total ?? 0)
  return Array(periodCount).fill(Math.round(total / periodCount))
}

/** Precio medio €/kWh actual desde invoices de la supply */
function avgPriceFromInvoices(invoices: any[]): number {
  if (!invoices?.length) return 0
  let totalCost = 0, totalKwh = 0
  for (const inv of invoices) {
    const kwh = Number(inv.consumption_kwh ?? inv.kwh ?? 0)
    const cost = Number(inv.energy_cost ?? inv.importe_energia ?? 0)
    if (kwh > 0 && cost > 0) { totalKwh += kwh; totalCost += cost }
  }
  return totalKwh > 0 ? totalCost / totalKwh : 0
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { nueva_comercializadora, precios_nuevos, ssaa = 0, excesos = 0 } = body

    if (!nueva_comercializadora || !Array.isArray(precios_nuevos)) {
      return NextResponse.json({ error: 'nueva_comercializadora y precios_nuevos son obligatorios' }, { status: 400 })
    }

    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ── Fetch supply + client + invoices ──────────────────────────────────────
    const { data: supply, error } = await supabase
      .from('supplies')
      .select(`
        *,
        client:clients(name, cif_nif, commercial:users_profile!commercial_id(full_name)),
        comercializadora:comercializadoras(name),
        invoices(*)
      `)
      .eq('id', params.id)
      .single()

    if (error || !supply) {
      return NextResponse.json({ error: 'Suministro no encontrado' }, { status: 404 })
    }

    const tariff = supply.tariff || '3.0TD'
    const boe2025 = getBOEPrices(tariff, 2025)
    const boe2026 = getBOEPrices(tariff, 2026)
    const periodCount = boe2026.length

    const sipsData = supply.consumption_data as any
    const powers = extractPowers(sipsData, periodCount)
    const consumption = extractConsumption(sipsData, periodCount)
    const totalKwh = consumption.reduce((a, b) => a + b, 0)
    const actualAvgPrice = avgPriceFromInvoices(supply.invoices || [])
    const comercializadoraActual = supply.comercializadora?.name || 'Comercializadora actual'
    const clientName = supply.client?.name || ''
    const cups = supply.cups || ''
    const tariffLabel = `TARIFA ${normalizeTariff(tariff)}`

    // ── Abrir plantilla ───────────────────────────────────────────────────────
    const templatePath = path.join(process.cwd(), 'templates', 'estudio-economico.xlsx')
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Plantilla no encontrada en /templates/estudio-economico.xlsx' }, { status: 500 })
    }

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(templatePath)
    const ws = wb.worksheets[0]

    // ── Cabecera ──────────────────────────────────────────────────────────────
    set(ws, 'A2', clientName)
    set(ws, 'B3', cups)
    set(ws, 'Q3', tariffLabel)

    // ── Comercializadoras ─────────────────────────────────────────────────────
    set(ws, 'A10', comercializadoraActual)
    set(ws, 'I10', nueva_comercializadora)

    // ── POTENCIA ──────────────────────────────────────────────────────────────
    const DIAS = 365
    const POT_ROWS = [12, 13, 14, 15, 16, 17]  // p1..p6

    let totalPotenciaActual = 0
    let totalPotenciaNueva = 0
    let totalKwPot = 0

    for (let i = 0; i < periodCount; i++) {
      const row = POT_ROWS[i]
      const kw = powers[i] || 0
      const boeActual = boe2025[i]?.pricePerKwDay ?? 0
      const boeNuevo = boe2026[i]?.pricePerKwDay ?? 0

      const costeActual = fmt2(kw * DIAS * boeActual)
      const costeNuevo = fmt2(kw * DIAS * boeNuevo)
      const mesActual = fmt2(kw * boeActual * (DIAS / 12))
      const mesNuevo = fmt2(kw * boeNuevo * (DIAS / 12))

      // ACTUAL
      set(ws, `B${row}`, kw)
      set(ws, `C${row}`, DIAS)
      set(ws, `D${row}`, boeActual)
      set(ws, `E${row}`, mesActual)
      set(ws, `F${row}`, costeActual)

      // NUEVO
      set(ws, `J${row}`, kw)
      set(ws, `K${row}`, DIAS)
      set(ws, `L${row}`, boeNuevo)
      set(ws, `M${row}`, mesNuevo)
      set(ws, `N${row}`, costeNuevo)

      totalPotenciaActual += costeActual
      totalPotenciaNueva += costeNuevo
      totalKwPot += kw
    }

    // Totales potencia
    set(ws, 'B19', totalKwPot)
    set(ws, 'F19', fmt2(totalPotenciaActual))
    set(ws, 'J19', totalKwPot)
    set(ws, 'N19', fmt2(totalPotenciaNueva))

    // ── ENERGÍA ───────────────────────────────────────────────────────────────
    const ENE_ROWS = [30, 31, 32, 33, 34, 35]
    const PERIOD_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

    let totalEnergiaActual = 0
    let totalEnergiaNueva = 0

    set(ws, 'D29', totalKwh)
    set(ws, 'J29', totalKwh)

    for (let i = 0; i < periodCount; i++) {
      const row = ENE_ROWS[i]
      const kwh = consumption[i] || 0
      const pctTotal = totalKwh > 0 ? kwh / totalKwh : 0
      const precioActual = actualAvgPrice || 0
      const precioNuevo = precios_nuevos[i] || 0

      const costeActual = fmt2(kwh * precioActual)
      const costeNuevo = fmt2(kwh * precioNuevo)

      // ACTUAL
      set(ws, `C${row}`, PERIOD_LABELS[i])
      set(ws, `D${row}`, kwh)
      set(ws, `E${row}`, precioActual)
      set(ws, `F${row}`, costeActual)
      set(ws, `G${row}`, pctTotal)

      // NUEVO
      set(ws, `I${row}`, PERIOD_LABELS[i])
      set(ws, `J${row}`, kwh)
      set(ws, `L${row}`, precioNuevo)
      set(ws, `M${row}`, costeNuevo)

      totalEnergiaActual += costeActual
      totalEnergiaNueva += costeNuevo
    }

    // Totales energía
    const avgActual = totalKwh > 0 ? totalEnergiaActual / totalKwh : 0
    set(ws, 'D37', totalKwh)
    set(ws, 'E37', fmt2(avgActual))
    set(ws, 'F37', fmt2(totalEnergiaActual))
    set(ws, 'J37', totalKwh)
    set(ws, 'K37', 0)
    set(ws, 'L37', 0)

    // Diferencia energía
    const difEnergia = fmt2(totalEnergiaActual - totalEnergiaNueva)
    set(ws, 'G40', difEnergia)

    // ── Resumen ───────────────────────────────────────────────────────────────
    const difPotencia = fmt2(totalPotenciaActual - totalPotenciaNueva)
    const difTotal = fmt2(difEnergia + difPotencia + (ssaa || 0) + (excesos || 0))

    set(ws, 'I23', 0)                         // diferencia potencia
    set(ws, 'I24', fmt2(totalEnergiaActual))   // energía actual
    set(ws, 'K25', difTotal)                   // diferencia total

    // ── Generar buffer y devolver ─────────────────────────────────────────────
    const tariffSlug = normalizeTariff(tariff).replace('.', '')
    const clientSlug = clientName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20)
    const filename = `estudio_${clientSlug}_${tariffSlug}.xlsx`

    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: any) {
    console.error('[economic-study]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
