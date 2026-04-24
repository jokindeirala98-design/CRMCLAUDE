/**
 * POST /api/supplies/[id]/economic-study
 *
 * Genera el Excel "PRE ESTUDIO ECONÓMICO COMPARATIVA" usando la plantilla base.
 * Rellena todos los datos automáticos del suministro y del cliente.
 *
 * Body JSON:
 * {
 *   nueva_comercializadora: string
 *   precios_nuevos: number[]     // €/kWh por período [p1..p6]
 *   ssaa?: number
 *   excesos?: number
 *   notes?: string               // notas internas admin
 *   save?: boolean               // si true: sube a storage + crea study record + guarda notas
 * }
 *
 * Respuesta: siempre devuelve el Excel como descarga.
 * Si save=true, además persiste en Supabase antes de responder.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBOEPrices, normalizeTariff } from '@/lib/boe-prices'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'

// ── Helpers ───────────────────────────────────────────────────────────────────

function set(ws: ExcelJS.Worksheet, cell: string, value: any) {
  ws.getCell(cell).value = value
}

/** Monetary totals: round to 2 decimal places (cents) */
function fmt2(n: number) { return Math.round(n * 100) / 100 }

/**
 * Write a price (€/kWh or €/kW·día) to a cell with full 6-decimal precision.
 * Does NOT round — writes the exact number so BOE values like 0.081083 appear intact.
 * Forces the cell number format to show 6 decimal places regardless of template format.
 */
function setPrice(ws: ExcelJS.Worksheet, cell: string, value: number) {
  const c = ws.getCell(cell)
  c.value = value           // raw JS number, no rounding
  c.numFmt = '0.000000'     // always 6 decimal places, overrides template format
}

const PERIOD_KEYS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

// ── Logo helpers (module-level) ────────────────────────────────────────────────
const _cwd = process.cwd()

function slugLogo(name: string) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

async function tryLoadLogo(name: string): Promise<Buffer | null> {
  const slug = slugLogo(name)
  const candidates = [
    path.join(_cwd, 'public', 'logos', `${slug}.png`),
    path.join(_cwd, 'public', 'logos', `${slug}.jpg`),
    path.join(_cwd, 'logos', `${slug}.png`),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return fs.readFileSync(p) } catch { continue }
    }
  }
  return null
}

// Border style for table cells
const THIN_BORDER: ExcelJS.Border = { style: 'thin', color: { argb: 'FFB0B0B0' } }
const THIN_ALL: Partial<ExcelJS.Borders> = {
  top: THIN_BORDER, bottom: THIN_BORDER,
  left: THIN_BORDER, right: THIN_BORDER,
}

function applyBorders(ws: ExcelJS.Worksheet, fromRow: number, toRow: number, fromCol: number, toCol: number) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = fromCol; c <= toCol; c++) {
      const cell = ws.getCell(r, c)
      cell.border = THIN_ALL
    }
  }
}

function extractPowers(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)

  // Format 1: potenciaContratada as object { P1: 120, P2: 130, ... }
  const pc = sipsData.potenciaContratada
  if (pc && typeof pc === 'object' && !Array.isArray(pc)) {
    const vals = PERIOD_KEYS.slice(0, periodCount).map(k => Number(pc[k] ?? pc[k.toLowerCase()] ?? 0))
    if (vals.some(v => v > 0)) return vals
  }

  // Format 2: potenciasContratadas as array
  if (Array.isArray(sipsData.potenciasContratadas))
    return sipsData.potenciasContratadas.slice(0, periodCount).map(Number)

  // Format 3: flat keys potenciaP1, potenciaP2...
  const byKey: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    byKey.push(Number(sipsData[`potenciaP${i}`] ?? sipsData[`p${i}`] ?? sipsData[`P${i}`] ?? 0))
  }
  if (byKey.some(v => v > 0)) return byKey

  // Format 4: single number — distribute equally
  if (typeof pc === 'number' && pc > 0) return Array(periodCount).fill(pc)

  return Array(periodCount).fill(0)
}

function extractConsumption(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)

  // Format 1: consumoPeriodos as object { P1: 56208, P2: 70237, ... }
  const cp = sipsData.consumoPeriodos
  if (cp && typeof cp === 'object' && !Array.isArray(cp)) {
    const vals = PERIOD_KEYS.slice(0, periodCount).map(k => Number(cp[k] ?? cp[k.toLowerCase()] ?? 0))
    if (vals.some(v => v > 0)) return vals
  }

  // Format 2: consumoPorPeriodo as array
  if (Array.isArray(sipsData.consumoPorPeriodo))
    return sipsData.consumoPorPeriodo.slice(0, periodCount).map(Number)

  // Format 3: flat keys
  const byKey: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    byKey.push(Number(sipsData[`consumoP${i}`] ?? sipsData[`energiaP${i}`] ?? 0))
  }
  if (byKey.some(v => v > 0)) return byKey

  // Format 4: totalKwh — distribute equally
  const total = Number(sipsData.totalKwh ?? sipsData.total ?? 0)
  if (total > 0) return Array(periodCount).fill(Math.round(total / periodCount))

  return Array(periodCount).fill(0)
}

const POTENCIA_CATS = new Set([
  'potencia_peaje', 'potencia_cargo', 'potencia_comercializacion', 'potencia',
])

/**
 * Calculate WEIGHTED AVERAGE power price per period across ALL invoices.
 *
 * avgPrice[P] = Σ(totalCost_P across all invoices) / Σ(kW_P × dias_P across all invoices)
 *
 * This mirrors how AnnualEconomics calculates the representative price from
 * historical billing, rather than trusting a single invoice's price.
 *
 * Tries two sources per invoice in order:
 *   1. economics.potencia[]  — aggregated per-period object from Gemini (precioKwDia or total)
 *   2. rawLineItems          — individual lines (potencia_peaje + potencia_cargo per period)
 */
function extractAvgPowerPricesFromAllInvoices(
  invoices: any[],
  periodCount: number,
): number[] {
  // Accumulators: total cost and total kW×dias per period
  const totalEur = Array(periodCount).fill(0)
  const totalKwDias = Array(periodCount).fill(0)

  for (const inv of invoices) {
    const ed = inv.extracted_data as any
    if (!ed) continue
    const eco = ed.economics || {}

    // ── Source 1: potencia[] array ──────────────────────────────────────────
    const potenciaArr: any[] | undefined = eco.potencia ?? ed.potencia
    if (Array.isArray(potenciaArr) && potenciaArr.length > 0) {
      let got = false
      for (let i = 0; i < periodCount; i++) {
        const p = PERIOD_KEYS[i]
        const item = potenciaArr.find(
          (x: any) => x.periodo === p || x.periodo === `Periodo ${i + 1}`
        )
        if (!item) continue
        const kw = Number(item.kw) || 0
        const dias = Number(item.dias) || 0
        const total = Number(item.total) || 0
        const precio = Number(item.precioKwDia) || Number(item.precioKw) || 0

        if (kw > 0 && dias > 0) {
          const costForPeriod = total > 0 ? total : (precio > 0 ? kw * dias * precio : 0)
          if (costForPeriod > 0) {
            totalEur[i] += costForPeriod
            totalKwDias[i] += kw * dias
            got = true
          }
        }
      }
      if (got) continue  // skip rawLineItems for this invoice
    }

    // ── Source 2: rawLineItems fallback ─────────────────────────────────────
    const rawItems: any[] | undefined = eco.rawLineItems ?? ed.rawLineItems
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      const byPeriod: Record<string, { kw: number; dias: number; total: number }> = {}
      for (const item of rawItems) {
        if (!POTENCIA_CATS.has(item.category)) continue
        const p = item.periodo as string
        if (!p || !PERIOD_KEYS.includes(p)) continue
        if (!byPeriod[p]) byPeriod[p] = { kw: 0, dias: 0, total: 0 }
        if (Number(item.kw) > 0) byPeriod[p].kw = Number(item.kw)
        if (Number(item.dias) > 0) byPeriod[p].dias = Number(item.dias)
        byPeriod[p].total += Number(item.total) || 0
      }
      for (let i = 0; i < periodCount; i++) {
        const p = PERIOD_KEYS[i]
        const row = byPeriod[p]
        if (!row || row.kw <= 0 || row.dias <= 0 || row.total <= 0) continue
        totalEur[i] += row.total
        totalKwDias[i] += row.kw * row.dias
      }
    }
  }

  // Weighted averages
  return totalEur.map((eur, i) => totalKwDias[i] > 0 ? eur / totalKwDias[i] : 0)
}

/**
 * Extract kW powers from invoices (for fallback when SIPS not available).
 * Returns the most recently billed kW per period.
 */
function extractInvoicePowerKw(invoices: any[], periodCount: number): number[] {
  const powers = Array(periodCount).fill(0)
  if (!invoices?.length) return powers

  const sorted = [...invoices].sort((a, b) => {
    const da = a.period_end || a.period_start || ''
    const db = b.period_end || b.period_start || ''
    return db.localeCompare(da)
  })

  for (const inv of sorted) {
    const ed = inv.extracted_data as any
    if (!ed) continue
    const eco = ed.economics || {}

    const potenciaArr: any[] | undefined = eco.potencia ?? ed.potencia
    if (Array.isArray(potenciaArr) && potenciaArr.length > 0) {
      let filled = 0
      for (let i = 0; i < periodCount; i++) {
        const p = PERIOD_KEYS[i]
        const item = potenciaArr.find(
          (x: any) => x.periodo === p || x.periodo === `Periodo ${i + 1}`
        )
        const kw = Number(item?.kw) || 0
        if (kw > 0 && powers[i] === 0) { powers[i] = kw; filled++ }
      }
      if (filled > 0) break
    }
  }
  return powers
}

/**
 * Extract invoice-level energy prices per period.
 * Returns array indexed [0..periodCount-1], 0 if period has no data.
 */
function extractInvoiceEnergyPrices(invoices: any[], periodCount: number): number[] {
  const prices = Array(periodCount).fill(0)
  if (!invoices?.length) return prices

  const sorted = [...invoices].sort((a, b) => {
    const da = a.period_end || a.period_start || ''
    const db = b.period_end || b.period_start || ''
    return db.localeCompare(da)
  })

  for (const inv of sorted) {
    const eco = inv.extracted_data?.economics
    if (!eco?.consumo?.length) continue

    let filled = 0
    for (let i = 0; i < periodCount; i++) {
      const p = PERIOD_KEYS[i]
      const item = eco.consumo.find((x: any) => x.periodo === p || x.periodo === `Periodo ${i + 1}`)
      if (item && item.precioKwh > 0 && prices[i] === 0) {
        prices[i] = Number(item.precioKwh)
        filled++
      }
    }
    if (filled > 0) break
  }

  return prices
}

function avgPriceFromInvoices(invoices: any[]): number {
  if (!invoices?.length) return 0
  let totalCost = 0, totalKwh = 0
  for (const inv of invoices) {
    const ed = inv.extracted_data as any
    const kwh = Number(
      inv.consumption_kwh ?? inv.kwh ??
      ed?.economics?.consumoTotalKwh ?? ed?.consumoKwh ?? 0
    )
    const cost = Number(
      inv.energy_cost ?? inv.importe_energia ??
      ed?.economics?.importeEnergia ?? ed?.importeEnergia ?? 0
    )
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
    const {
      nueva_comercializadora,
      precios_nuevos,
      ssaa = 0,
      excesos = 0,
      notes = '',
      save = false,
    } = body

    if (!nueva_comercializadora || !Array.isArray(precios_nuevos)) {
      return NextResponse.json({ error: 'nueva_comercializadora y precios_nuevos son obligatorios' }, { status: 400 })
    }

    // ── Auth: verify token from Authorization header
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '').trim()

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Use service-role client for data ops (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ── Fetch supply + client + invoices ──────────────────────────────────────
    const { data: supply, error } = await supabase
      .from('supplies')
      .select(`
        *,
        client:clients(id, name, cif_nif),
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
    const powerStudyResult = (supply as any).power_study_result as any
    const invoices = supply.invoices || []

    // ── BOE year for "nuevo" column: 2026 if any invoice is from 2026, else 2025 ─
    const latestInvoiceYear = invoices.reduce((maxY: number, inv: any) => {
      const d = inv.period_end || inv.period_start || inv.created_at || ''
      const y = parseInt(String(d).substring(0, 4))
      return (!isNaN(y) && y > maxY) ? y : maxY
    }, 2025)
    const boeNewYear: 2025 | 2026 = latestInvoiceYear >= 2026 ? 2026 : 2025
    const boeNuevo = getBOEPrices(tariff, boeNewYear)

    // Consumption always from SIPS (official distributor data)
    const consumption = extractConsumption(sipsData, periodCount)
    const totalKwh = consumption.reduce((a: number, b: number) => a + b, 0)

    // Powers: ALWAYS from SIPS — never from invoices or Excel data.
    // Priority:
    //   1. power_study_result.potenciaContratada — set by power-study-auto after SIPS fetch
    //   2. consumption_data.potenciaContratada   — set by sync-supply-sips or post-import SIPS merge
    const sipsPowers = extractPowers(sipsData, periodCount)

    let powers: number[]
    if (powerStudyResult?.potenciaContratada) {
      const pc = powerStudyResult.potenciaContratada
      const studyPowers = PERIOD_KEYS.slice(0, periodCount).map(k => Number(pc[k] ?? 0))
      powers = studyPowers.some(v => v > 0) ? studyPowers : sipsPowers
    } else {
      powers = sipsPowers
    }

    // Power prices ACTUAL: weighted average across ALL invoices (AnnualEconomics style)
    // Falls back to BOE of the year matching the invoices if no invoice data available
    const avgPowerPricesActual = extractAvgPowerPricesFromAllInvoices(invoices, periodCount)
    const boeActualFallback = boeNewYear === 2026 ? boe2026 : boe2025

    // Energy prices ACTUAL per period: from invoice
    const energyPricesActual = extractInvoiceEnergyPrices(invoices, periodCount)

    // Fallback: overall average price if per-period not available
    const actualAvgPrice = avgPriceFromInvoices(invoices)

    const comercializadoraActual = supply.comercializadora?.name || 'Comercializadora actual'
    const clientName = supply.client?.name || supply.cups || 'Sin cliente'
    const cups = supply.cups || ''
    const tariffLabel = `TARIFA ${normalizeTariff(tariff)}`

    // ── Logos de comercializadoras ────────────────────────────────────────────
    const [logoActualBuf, logoNuevaBuf] = await Promise.all([
      tryLoadLogo(comercializadoraActual),
      tryLoadLogo(nueva_comercializadora),
    ])

    // ── Abrir plantilla ───────────────────────────────────────────────────────
    // Vercel serverless: only files declared in outputFileTracingIncludes are bundled.
    // We check both root/templates/ (dev) and public/templates/ (Vercel fallback).
    const cwd = _cwd
    const candidates = [
      path.join(cwd, 'templates', 'estudio-economico.xlsx'),
      path.join(cwd, 'public', 'templates', 'estudio-economico.xlsx'),
      path.join(cwd, 'templates', 'estudio-economico-clean.xlsx'),
      path.join(cwd, 'public', 'templates', 'estudio-economico-clean.xlsx'),
    ]

    const loadTemplate = async (): Promise<ExcelJS.Workbook> => {
      for (const templatePath of candidates) {
        if (!fs.existsSync(templatePath)) continue
        try {
          const w = new ExcelJS.Workbook()
          await w.xlsx.readFile(templatePath)
          return w
        } catch {
          // File exists but ExcelJS can't parse it (e.g. has drawings) — try next
          continue
        }
      }
      throw new Error('Plantilla no encontrada. Asegúrate de que estudio-economico.xlsx está en templates/ o public/templates/')
    }

    const wb = await loadTemplate()
    const ws = wb.worksheets[0]

    // ── Cabecera ──────────────────────────────────────────────────────────────
    set(ws, 'A2', clientName)
    set(ws, 'B3', cups)
    set(ws, 'Q3', tariffLabel)
    set(ws, 'A10', comercializadoraActual)
    set(ws, 'I10', nueva_comercializadora)

    // ── Logos (insert after worksheet is loaded) ──────────────────────────────
    const insertLogo = (buf: Buffer | null, colStart: number, rowStart: number) => {
      if (!buf) return
      try {
        const imgId = wb.addImage({ buffer: buf as any, extension: 'png' })
        ws.addImage(imgId, {
          tl: { col: colStart - 1, row: rowStart - 1 } as any,
          ext: { width: 140, height: 45 },
          editAs: 'oneCell',
        } as any)
      } catch { /* logo insert not supported — skip */ }
    }
    insertLogo(logoActualBuf, 1, 8)    // cols A area, row 8 (above A10 name)
    insertLogo(logoNuevaBuf, 9, 8)     // cols I area, row 8 (above I10 name)

    // ── POTENCIA ──────────────────────────────────────────────────────────────
    const DIAS = 365
    const POT_ROWS = [12, 13, 14, 15, 16, 17]
    let totalPotenciaActual = 0, totalPotenciaNueva = 0, totalKwPot = 0

    for (let i = 0; i < periodCount; i++) {
      const row = POT_ROWS[i]
      const kw = powers[i] || 0

      // ACTUAL price: weighted avg from all invoices → fallback to BOE of matching year
      const boeA = avgPowerPricesActual[i] > 0
        ? avgPowerPricesActual[i]
        : (boeActualFallback[i]?.pricePerKwDay ?? 0)

      // NUEVO price: BOE of the year matching the most recent invoice (2025 or 2026)
      const boeN = boeNuevo[i]?.pricePerKwDay ?? 0

      const costeA = fmt2(kw * DIAS * boeA)
      const costeN = fmt2(kw * DIAS * boeN)

      // ACTUAL columns
      set(ws, `B${row}`, kw)
      set(ws, `C${row}`, DIAS)
      setPrice(ws, `D${row}`, boeA)           // €/kW·día actual — full 6-decimal precision
      set(ws, `E${row}`, fmt2(kw * boeA * DIAS / 12))
      set(ws, `F${row}`, costeA)

      // NUEVO columns (BOE of boeNewYear)
      set(ws, `J${row}`, kw)
      set(ws, `K${row}`, DIAS)
      setPrice(ws, `L${row}`, boeN)           // €/kW·día nueva — full 6-decimal precision
      set(ws, `M${row}`, fmt2(kw * boeN * DIAS / 12))
      set(ws, `N${row}`, costeN)

      totalPotenciaActual += costeA
      totalPotenciaNueva += costeN
      totalKwPot += kw
    }

    // Totales potencia
    set(ws, 'B19', totalKwPot)
    set(ws, 'F19', fmt2(totalPotenciaActual))
    set(ws, 'J19', totalKwPot)
    set(ws, 'N19', fmt2(totalPotenciaNueva))

    // ── ENERGÍA ───────────────────────────────────────────────────────────────
    const ENE_ROWS = [30, 31, 32, 33, 34, 35]
    let totalEnergiaActual = 0, totalEnergiaNueva = 0

    set(ws, 'D29', totalKwh)
    set(ws, 'J29', totalKwh)

    for (let i = 0; i < periodCount; i++) {
      const row = ENE_ROWS[i]
      const kwh = consumption[i] || 0
      const pct = totalKwh > 0 ? kwh / totalKwh : 0

      // Energy price ACTUAL: use per-period invoice price, fallback to overall avg
      const precioA = energyPricesActual[i] > 0 ? energyPricesActual[i] : (kwh > 0 ? actualAvgPrice : 0)
      const precioN = precios_nuevos[i] || 0
      const costeA = fmt2(kwh * precioA)
      const costeN = fmt2(kwh * precioN)

      // ACTUAL columns
      set(ws, `C${row}`, PERIOD_KEYS[i])
      set(ws, `D${row}`, kwh)
      setPrice(ws, `E${row}`, precioA)        // €/kWh actual — full precision
      set(ws, `F${row}`, costeA)
      set(ws, `G${row}`, pct)

      // NUEVO columns
      set(ws, `I${row}`, PERIOD_KEYS[i])
      set(ws, `J${row}`, kwh)
      setPrice(ws, `L${row}`, precioN)        // €/kWh nueva (entered by user) — full precision
      set(ws, `M${row}`, costeN)

      totalEnergiaActual += costeA
      totalEnergiaNueva += costeN
    }

    // Totales energía
    const avgActual = totalKwh > 0 ? totalEnergiaActual / totalKwh : 0
    const avgNueva = totalKwh > 0 ? totalEnergiaNueva / totalKwh : 0
    set(ws, 'D37', totalKwh)
    setPrice(ws, 'E37', avgActual)           // precio medio actual €/kWh — full precision
    set(ws, 'F37', fmt2(totalEnergiaActual))
    set(ws, 'J37', totalKwh)
    setPrice(ws, 'L37', avgNueva)            // precio medio nueva €/kWh — full precision
    set(ws, 'M37', fmt2(totalEnergiaNueva))

    // Diferencia energía (ahorro)
    const difEnergia = fmt2(totalEnergiaActual - totalEnergiaNueva)
    set(ws, 'G40', difEnergia)

    // ── Resumen ───────────────────────────────────────────────────────────────
    const difPotencia = fmt2(totalPotenciaActual - totalPotenciaNueva)
    const difTotal = fmt2(difEnergia + difPotencia + (ssaa || 0) + (excesos || 0))

    set(ws, 'I23', fmt2(difPotencia))          // Ahorro potencia
    set(ws, 'I24', fmt2(difEnergia))            // Ahorro energía
    set(ws, 'I25', fmt2(ssaa || 0))             // SSAA
    set(ws, 'I26', fmt2(excesos || 0))          // Excesos
    set(ws, 'M24', fmt2(difTotal))              // Total ahorro (K24:L24 = label "diferencia total:")

    // ── Bordes ───────────────────────────────────────────────────────────────
    // Potencia: columnas B-F (2..6) y J-N (10..14), filas 12-19
    applyBorders(ws, 12, 19, 2, 6)
    applyBorders(ws, 12, 19, 10, 14)
    // Energía: columnas C-G (3..7) y I-M (9..13), filas 29-37
    applyBorders(ws, 29, 37, 3, 7)
    applyBorders(ws, 29, 37, 9, 13)
    // Resumen: I23-I26 and M24
    applyBorders(ws, 23, 26, 9, 9)
    applyBorders(ws, 24, 24, 13, 13)

    // ── Generar buffer ────────────────────────────────────────────────────────
    const tariffSlug = normalizeTariff(tariff).replace('.', '')
    const clientSlug = clientName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20)
    const filename = `estudio_${clientSlug}_${tariffSlug}.xlsx`
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    // ── Guardar en Supabase si save=true ──────────────────────────────────────
    if (save) {
      try {
        const now = new Date().toISOString()
        const storagePath = `studies/${params.id}/${Date.now()}_${filename}`

        // 1. Subir Excel a storage
        await supabase.storage
          .from('documents')
          .upload(storagePath, buffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: false,
          })

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
        const reportUrl = urlData.publicUrl

        // 2. Crear registro en studies
        await supabase.from('studies').insert({
          supply_id: params.id,
          type: 'economico',
          report_url: reportUrl,
          status: 'completed',
          created_by: user.id,
          created_at: now,
          completed_at: now,
        })

        // 3. Guardar notas + avanzar pipeline
        await supabase.from('supplies').update({
          ...(notes ? { study_notes: notes } : {}),
          status: 'estudio_completado',
          updated_at: now,
        }).eq('id', params.id)

        // 4. Notificar al comercial
        if (supply.client?.id) {
          const { data: clientData } = await supabase
            .from('clients')
            .select('commercial_id, name')
            .eq('id', supply.client_id)
            .single()

          if (clientData?.commercial_id) {
            await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/notify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: clientData.commercial_id,
                type: 'estudio_completado',
                title: 'Informe listo',
                message: `El informe económico de ${clientData.name} (${cups}) ya está disponible.`,
                link: `/supplies/${params.id}`,
                metadata: { report_url: reportUrl, supply_id: params.id },
              }),
            }).catch(() => {}) // fire & forget
          }
        }
      } catch (saveErr: any) {
        console.error('[economic-study] save error (non-fatal):', saveErr.message)
        // No bloqueamos la descarga si falla el guardado
      }
    }

    // ── Devolver el Excel ─────────────────────────────────────────────────────
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
