/**
 * POST /api/supplies/import-from-excel
 *
 * Importa suministros e invoices desde los Excel de facturas en formato VOLTIS.
 * Cada Excel representa 1 suministro (CUPS) con varias columnas = varias facturas.
 *
 * Formato Excel esperado (hoja "Facturas"):
 *   Fila 3:  CUPS
 *   Fila 4:  Titular
 *   Fila 5:  Compañía (comercializadora actual)
 *   Fila 6:  Tarifa
 *   Fila 7:  Nº Factura (por columna)
 *   Fila 8:  Fecha Inicio
 *   Fila 9:  Fecha Fin
 *   Fila 11: Días Facturados
 *   Filas 13-30: Potencia P1-P6 (kW, €/kW·día, €)
 *   Filas 32-49: Consumo P1-P6 (kWh, €/kWh, €)
 *   Fila 51: Total consumo kWh
 *   Fila 52: Coste bruto consumo
 *   Fila 53: Descuento energía
 *   Fila 55: Total coste consumo
 *   Fila 56: Total coste potencia
 *   Fila 57: IVA %
 *   Fila 59: Peajes
 *   Fila 60: Impuesto eléctrico
 *   Fila 61: Alquiler equipos
 *   Fila 62: Otros
 *   Fila 63: IVA / IGIC
 *   Fila 65: Total factura
 *
 * Body: multipart/form-data
 *   files: File[]   (uno o varios .xlsx)
 *   clientId: string (opcional, UUID del cliente preseleccionado)
 *
 * Response: { results: ImportResult[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'

// ── Helpers ────────────────────────────────────────────────────────────────────

function n(v: any): number { return Number(v ?? 0) || 0 }
function s(v: any): string { return String(v ?? '').trim() }

function normalizeTariff(raw: string): string {
  const t = raw.replace(/\s+/g, '').toUpperCase()
  const map: Record<string, string> = {
    '3.0TD': '3.0TD', '3.0': '3.0TD', '30TD': '3.0TD', '30': '3.0TD',
    '6.1TD': '6.1TD', '6.1': '6.1TD', '61TD': '6.1TD', '61': '6.1TD',
    '6.2TD': '6.2TD', '6.2': '6.2TD',
    '6.3TD': '6.3TD', '6.3': '6.3TD',
    '6.4TD': '6.4TD', '6.4': '6.4TD',
    '2.0TD': '2.0TD', '2.0': '2.0TD', '20TD': '2.0TD', '20': '2.0TD',
    '2.0DHA': '2.0DHA', '2.0A': '2.0TD',
  }
  return map[t] || raw
}

/** Número de períodos activos según tarifa */
function periodCount(tariff: string): number {
  const t = normalizeTariff(tariff)
  if (t.startsWith('2.0')) return 2
  return 6  // 3.0TD, 6.1TD, 6.x TD
}

interface ParsedInvoice {
  numFactura: string
  fechaInicio: string
  fechaFin: string
  fechaEmision: string
  dias: number
  potencia: { periodo: string; kw: number; precioKwDia: number; dias: number; total: number }[]
  consumo: { periodo: string; kwh: number; precioKwh: number; total: number }[]
  consumoTotalKwh: number
  costeBrutoConsumo: number
  descuentoEnergia: number
  costeNetoConsumo: number
  costeTotalConsumo: number
  costeTotalPotencia: number
  iva: number
  peajes: number
  impuestoElectrico: number
  alquiler: number
  otros: number
  ivaTotal: number
  totalFactura: number
}

interface ParsedSupplyFile {
  fileName: string
  cups: string
  titular: string
  compania: string
  tarifa: string
  invoices: ParsedInvoice[]
}

/** Parsea una hoja de Excel del formato VOLTIS de facturas */
async function parseExcelFile(buffer: Buffer, fileName: string): Promise<ParsedSupplyFile> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  const ws = wb.getWorksheet('Facturas') || wb.worksheets[0]
  if (!ws) throw new Error(`${fileName}: no se encontró la hoja "Facturas"`)

  // Helper: get cell value from (row, col) — 1-indexed
  const gc = (row: number, col: number): any => ws.getCell(row, col).value

  // Static fields (same across columns, read from first data column = 2)
  const cups    = s(gc(3, 2))
  const titular = s(gc(4, 2))
  const compania = s(gc(5, 2))
  const tarifa  = normalizeTariff(s(gc(6, 2)))

  if (!cups) throw new Error(`${fileName}: no se encontró CUPS en la celda B3`)

  // Determine number of data columns (starting from col 2)
  let maxCol = 2
  while (ws.getCell(1, maxCol + 1).value !== null && ws.getCell(1, maxCol + 1).value !== undefined) {
    maxCol++
    if (maxCol > 50) break // safety limit
  }

  const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
  const pCount = periodCount(tarifa)

  const invoices: ParsedInvoice[] = []

  for (let col = 2; col <= maxCol; col++) {
    const g = (row: number) => gc(row, col)

    // Skip empty columns (no invoice number)
    const numFact = s(g(7))
    if (!numFact) continue

    const fechaInicio = s(g(8))
    const fechaFin    = s(g(9))
    const fechaEmision = s(g(10))
    const dias = n(g(11))

    // Potencia P1-P6 (rows 13-30, 3 rows per period: kW, precio, total)
    const potencia = []
    for (let i = 0; i < 6; i++) {
      const baseRow = 13 + i * 3
      potencia.push({
        periodo: PERIODS[i],
        kw:         n(g(baseRow)),
        precioKwDia: n(g(baseRow + 1)),
        dias,
        total:      n(g(baseRow + 2)),
      })
    }

    // Consumo P1-P6 (rows 32-49, 3 rows per period: kWh, precio, total)
    const consumo = []
    for (let i = 0; i < 6; i++) {
      const baseRow = 32 + i * 3
      consumo.push({
        periodo: PERIODS[i],
        kwh:      n(g(baseRow)),
        precioKwh: n(g(baseRow + 1)),
        total:    n(g(baseRow + 2)),
      })
    }

    invoices.push({
      numFactura:    numFact,
      fechaInicio,
      fechaFin,
      fechaEmision,
      dias,
      potencia,
      consumo,
      consumoTotalKwh:   n(g(51)),
      costeBrutoConsumo: n(g(52)),
      descuentoEnergia:  n(g(53)),
      costeNetoConsumo:  n(g(54)),
      costeTotalConsumo: n(g(55)),
      costeTotalPotencia: n(g(56)),
      iva:               n(g(57)),
      peajes:            n(g(59)),
      impuestoElectrico: n(g(60)),
      alquiler:          n(g(61)),
      otros:             n(g(62)),
      ivaTotal:          n(g(63)),
      totalFactura:      n(g(65)),
    })
  }

  return { fileName, cups, titular, compania, tarifa, invoices }
}

/** Agrega consumo anual por periodo sumando todas las facturas */
function buildAnnualConsumptionData(parsed: ParsedSupplyFile) {
  const consumoPeriodos: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  const potenciaContratada: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }

  for (const inv of parsed.invoices) {
    for (const c of inv.consumo) {
      consumoPeriodos[c.periodo] = (consumoPeriodos[c.periodo] || 0) + c.kwh
    }
    // Take max potencia seen (most recent invoice wins)
    for (const p of inv.potencia) {
      if (p.kw > 0) potenciaContratada[p.periodo] = p.kw
    }
  }

  const totalKwh = Object.values(consumoPeriodos).reduce((a, b) => a + b, 0)

  return { consumoPeriodos, potenciaContratada, totalKwh }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '').trim()
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Parse multipart form
    const formData = await req.formData()
    const clientId      = formData.get('clientId')      as string | null
    const newClientName = formData.get('newClientName') as string | null
    const files = formData.getAll('files') as File[]

    if (!files.length) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 })
    }

    const results = []

    for (const file of files) {
      const fileName = file.name
      try {
        // Parse Excel
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const parsed = await parseExcelFile(buffer, fileName)

        // ── Find or create client ────────────────────────────────────────────
        let resolvedClientId: string | null = clientId || null

        // Priority: 1) clientId param, 2) newClientName param (never auto-extract from Excel Titular)
        const nameToCreate = newClientName?.trim() || ''

        if (!resolvedClientId && nameToCreate) {
          // Try to find existing client by name
          const { data: existing } = await supabase
            .from('clients')
            .select('id')
            .ilike('name', nameToCreate)
            .limit(1)
            .single()

          if (existing) {
            resolvedClientId = existing.id
          } else {
            // Create new client
            const { data: newClient } = await supabase
              .from('clients')
              .insert({
                name: nameToCreate,
                created_at: new Date().toISOString(),
                status: 'active',
              })
              .select('id')
              .single()
            if (newClient) resolvedClientId = newClient.id
          }
        }

        if (!resolvedClientId) {
          results.push({ fileName, cups: parsed.cups, ok: false, error: 'No se pudo determinar el cliente. Especifica un nombre.' })
          continue
        }

        // ── Find or create supply ────────────────────────────────────────────
        const annualData = buildAnnualConsumptionData(parsed)

        let supplyId: string
        const { data: existingSupply } = await supabase
          .from('supplies')
          .select('id, consumption_data')
          .eq('cups', parsed.cups)
          .limit(1)
          .single()

        if (existingSupply) {
          supplyId = existingSupply.id
          // Update consumption_data with aggregated annual data
          await supabase
            .from('supplies')
            .update({
              consumption_data: annualData,
              tariff: parsed.tarifa,
              updated_at: new Date().toISOString(),
            })
            .eq('id', supplyId)
        } else {
          // Create new supply
          const { data: newSupply, error: supplyErr } = await supabase
            .from('supplies')
            .insert({
              cups: parsed.cups,
              client_id: resolvedClientId,
              tariff: parsed.tarifa,
              type: 'luz',
              status: 'facturas_recibidas',
              consumption_data: annualData,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (supplyErr || !newSupply) {
            results.push({ fileName, cups: parsed.cups, ok: false, error: supplyErr?.message || 'Error creando suministro' })
            continue
          }
          supplyId = newSupply.id
        }

        // ── Find comercializadora ────────────────────────────────────────────
        if (parsed.compania) {
          const { data: comerc } = await supabase
            .from('comercializadoras')
            .select('id')
            .ilike('name', `%${parsed.compania}%`)
            .limit(1)
            .single()
          if (comerc) {
            await supabase.from('supplies')
              .update({ comercializadora_id: comerc.id })
              .eq('id', supplyId)
          }
        }

        // ── Create invoice records ───────────────────────────────────────────
        let invoicesCreated = 0
        let invoicesSkipped = 0

        for (const inv of parsed.invoices) {
          // Deduplicate by period_start + period_end + supply_id
          if (inv.fechaInicio && inv.fechaFin) {
            const { data: existingInv } = await supabase
              .from('invoices')
              .select('id')
              .eq('supply_id', supplyId)
              .eq('period_start', inv.fechaInicio)
              .eq('period_end', inv.fechaFin)
              .limit(1)
              .single()
            if (existingInv) { invoicesSkipped++; continue }
          }

          // Build extracted_data.economics matching the BillEconomics type
          const economics = {
            fechaInicio:   inv.fechaInicio,
            fechaFin:      inv.fechaFin,
            cups:          parsed.cups,
            tarifa:        parsed.tarifa,
            supply_type:   'luz' as const,
            comercializadora: parsed.compania || undefined,
            potencia:      inv.potencia.filter(p => p.kw > 0 || p.total > 0),
            consumo:       inv.consumo.filter(c => c.kwh > 0 || c.total > 0).map(c => ({
              ...c,
              total: c.total || c.kwh * c.precioKwh,
            })),
            consumoTotalKwh:    inv.consumoTotalKwh,
            costeBrutoConsumo:  inv.costeBrutoConsumo,
            descuentoEnergia:   inv.descuentoEnergia,
            costeNetoConsumo:   inv.costeNetoConsumo,
            costeTotalConsumo:  inv.costeTotalConsumo,
            costeTotalPotencia: inv.costeTotalPotencia,
            costeMedioKwh: inv.consumoTotalKwh > 0
              ? inv.costeTotalConsumo / inv.consumoTotalKwh
              : 0,
            costeMedioKwhNeto: inv.consumoTotalKwh > 0
              ? inv.costeNetoConsumo / inv.consumoTotalKwh
              : 0,
            otrosConceptos: [
              inv.peajes > 0            && { concepto: 'Peajes y Transportes',  total: inv.peajes },
              inv.impuestoElectrico > 0 && { concepto: 'Impuesto Eléctrico',    total: inv.impuestoElectrico },
              inv.alquiler > 0          && { concepto: 'Alquiler de Equipos',   total: inv.alquiler },
              inv.otros > 0             && { concepto: 'Otros',                 total: inv.otros },
              inv.ivaTotal > 0          && { concepto: `IVA ${inv.iva}%`,       total: inv.ivaTotal },
            ].filter(Boolean),
            totalFactura: inv.totalFactura,
          }

          await supabase.from('invoices').insert({
            supply_id:         supplyId,
            file_url:          '',           // no physical file
            file_type:         'pdf',
            period_start:      inv.fechaInicio || null,
            period_end:        inv.fechaFin    || null,
            total_amount:      inv.totalFactura || null,
            extraction_status: 'completed',
            extracted_data:    { economics, source: 'excel_import', numFactura: inv.numFactura },
            created_at:        new Date().toISOString(),
          })

          invoicesCreated++
        }

        results.push({
          fileName,
          cups: parsed.cups,
          tarifa: parsed.tarifa,
          supplyId,
          ok: true,
          invoicesCreated,
          invoicesSkipped,
          isNew: !existingSupply,
        })

      } catch (fileErr: any) {
        results.push({ fileName, ok: false, error: fileErr.message })
      }
    }

    return NextResponse.json({ results })

  } catch (err: any) {
    console.error('[import-from-excel]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
