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
 *   Fila 65: Total factura
 *
 * Body: multipart/form-data
 *   files: File[]   (uno o varios .xlsx)
 *   clientId: string (opcional, UUID del cliente preseleccionado)
 *   newClientName: string (opcional, nombre para crear nuevo cliente)
 *
 * Response: { results: ImportResult[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { fetchSipsForCups } from '@/lib/sips'
import { normalizeTariff as normalizeTariffLib } from '@/lib/consumption-utils'

export const maxDuration = 300

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

  const gc = (row: number, col: number): any => ws.getCell(row, col).value

  const cups    = s(gc(3, 2))
  const titular = s(gc(4, 2))
  const compania = s(gc(5, 2))
  const tarifa  = normalizeTariff(s(gc(6, 2)))

  if (!cups) throw new Error(`${fileName}: no se encontró CUPS en la celda B3`)

  // Find number of data columns
  let maxCol = 2
  while (ws.getCell(1, maxCol + 1).value !== null && ws.getCell(1, maxCol + 1).value !== undefined) {
    maxCol++
    if (maxCol > 50) break
  }

  const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
  const invoices: ParsedInvoice[] = []

  for (let col = 2; col <= maxCol; col++) {
    const g = (row: number) => gc(row, col)
    const numFact = s(g(7))
    if (!numFact) continue

    const dias = n(g(11))
    const potencia = []
    for (let i = 0; i < 6; i++) {
      const baseRow = 13 + i * 3
      potencia.push({
        periodo: PERIODS[i],
        kw:          n(g(baseRow)),
        precioKwDia: n(g(baseRow + 1)),
        dias,
        total:       n(g(baseRow + 2)),
      })
    }

    const consumo = []
    for (let i = 0; i < 6; i++) {
      const baseRow = 32 + i * 3
      consumo.push({
        periodo:   PERIODS[i],
        kwh:       n(g(baseRow)),
        precioKwh: n(g(baseRow + 1)),
        total:     n(g(baseRow + 2)),
      })
    }

    invoices.push({
      numFactura:    numFact,
      fechaInicio:   s(g(8)),
      fechaFin:      s(g(9)),
      fechaEmision:  s(g(10)),
      dias,
      potencia,
      consumo,
      consumoTotalKwh:    n(g(51)),
      costeBrutoConsumo:  n(g(52)),
      descuentoEnergia:   n(g(53)),
      costeNetoConsumo:   n(g(54)),
      costeTotalConsumo:  n(g(55)),
      costeTotalPotencia: n(g(56)),
      iva:                n(g(57)),
      peajes:             n(g(59)),
      impuestoElectrico:  n(g(60)),
      alquiler:           n(g(61)),
      otros:              n(g(62)),
      ivaTotal:           n(g(63)),
      totalFactura:       n(g(65)),
    })
  }

  return { fileName, cups, titular, compania, tarifa, invoices }
}

/** Agrega consumo anual por periodo sumando todos los datos del Excel.
 *  NOTA: potenciaContratada NO se extrae del Excel — siempre se obtiene de SIPS.
 *  Los datos de consumo de las hojas Excel pueden no coincidir con los valores oficiales del distribuidor.
 */
function buildAnnualConsumptionData(parsed: ParsedSupplyFile) {
  const consumoPeriodos: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
  // potenciaContratada is intentionally omitted here — it will be set from SIPS only

  for (const inv of parsed.invoices) {
    for (const c of inv.consumo) {
      consumoPeriodos[c.periodo] = (consumoPeriodos[c.periodo] || 0) + c.kwh
    }
    // inv.potencia is stored in invoice extracted_data for billing reference,
    // but is NOT aggregated into consumption_data.potenciaContratada
  }

  const totalKwh = Object.values(consumoPeriodos).reduce((a, b) => a + b, 0)
  return { consumoPeriodos, totalKwh }
}

/** Procesa un fichero Excel: crea/actualiza suministro e inserta facturas */
async function processFile(
  file: File,
  resolvedClientId: string,
  newClientName: string,
  supabase: any
): Promise<{ fileName: string; cups?: string; ok: boolean; invoicesCreated?: number; invoicesSkipped?: number; isNew?: boolean; tarifa?: string; supplyId?: string; error?: string }> {
  const fileName = file.name
  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const parsed = await parseExcelFile(buffer, fileName)
    const annualData = buildAnnualConsumptionData(parsed)

    // ── Find or create supply ────────────────────────────────────────────────
    const { data: existingSupply } = await supabase
      .from('supplies')
      .select('id, consumption_data')
      .eq('cups', parsed.cups)
      .limit(1)
      .single()

    let supplyId: string

    if (existingSupply) {
      supplyId = existingSupply.id
      await supabase
        .from('supplies')
        .update({
          consumption_data: annualData,
          tariff: parsed.tarifa,
          updated_at: new Date().toISOString(),
        })
        .eq('id', supplyId)
    } else {
      const { data: newSupply, error: supplyErr } = await supabase
        .from('supplies')
        .insert({
          cups: parsed.cups,
          client_id: resolvedClientId,
          tariff: parsed.tarifa,
          type: 'luz',
          status: 'estudio_en_curso',
          consumption_data: annualData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (supplyErr || !newSupply) {
        // Race condition: another parallel file already inserted this CUPS
        const isUniqueConflict = supplyErr?.code === '23505'
          || supplyErr?.message?.includes('unique')
          || supplyErr?.message?.includes('duplicate')
        if (isUniqueConflict) {
          const { data: raced } = await supabase
            .from('supplies')
            .select('id, consumption_data')
            .eq('cups', parsed.cups)
            .limit(1)
            .single()
          if (raced) {
            // Merge our consumption data into the winner supply and continue
            await supabase.from('supplies').update({
              consumption_data: annualData,
              tariff: parsed.tarifa,
              updated_at: new Date().toISOString(),
            }).eq('id', raced.id)
            supplyId = raced.id
            // Mark as "existing" so SIPS isn't re-triggered
            ;(existingSupply as any) = raced
          } else {
            return { fileName, cups: parsed.cups, ok: false, error: 'Error de conflicto al crear suministro' }
          }
        } else {
          return { fileName, cups: parsed.cups, ok: false, error: supplyErr?.message || 'Error creando suministro' }
        }
      } else {
        supplyId = newSupply.id
      }
    }

    // ── SIPS fetch + power study (fire and forget, only for new supplies) ────
    if (!existingSupply) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'
      void fetchSipsForCups(parsed.cups, 'luz').then(async (sipsData) => {
        if (!sipsData) return
        const sipsNormalizedTariff = sipsData.tariff ? (normalizeTariffLib(sipsData.tariff) || sipsData.tariff) : null
        const merged = {
          ...annualData,
          // ⚠️ Override potenciaContratada with official SIPS value (takes priority over Excel)
          // Excel values can be wrong (e.g. 1.3 kW when real contracted power is 13 kW)
          ...(sipsData.potenciaContratada ? { potenciaContratada: sipsData.potenciaContratada } : {}),
          // Also override consumoPeriodos if SIPS has them (more accurate than Excel aggregation)
          ...(sipsData.consumoPeriodos ? { consumoPeriodos: sipsData.consumoPeriodos } : {}),
          source: 'excel_import_with_sips',
          fetched_at: new Date().toISOString(),
          sips_tariff: sipsData.tariff,
          distribuidora: sipsData.distribuidora,
          codigoPostal: sipsData.codigoPostal,
          provincia: sipsData.provincia,
          municipio: sipsData.municipio,
          cnae: sipsData.cnae,
          tension: sipsData.tension,
          history: sipsData.consumptionHistory || [],
          maximetroHistory: sipsData.maximetroHistory || [],
        }
        await supabase.from('supplies').update({
          consumption_data: merged,
          ...(sipsNormalizedTariff ? { tariff: sipsNormalizedTariff } : {}),
          address: sipsData.municipio ? [sipsData.municipio, sipsData.provincia].filter(Boolean).join(', ') : undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', supplyId)

        if (sipsData.consumptionHistory?.length && sipsData.potenciaContratada) {
          const r = await fetch(`${baseUrl}/api/power-study-auto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cups: parsed.cups,
              clientName: newClientName || 'Excel Import',
              potenciaContratada: sipsData.potenciaContratada,
              consumptionHistory: sipsData.consumptionHistory,
              maximetroHistory: sipsData.maximetroHistory || [],
            }),
          })
          if (r.ok) {
            const studyResult = await r.json()
            await supabase.from('supplies')
              .update({ power_study_result: studyResult, updated_at: new Date().toISOString() })
              .eq('id', supplyId)
          }
        }
      }).catch((err: any) => console.warn('[import-from-excel] SIPS error (non-fatal):', err?.message))
    }

    // ── Find comercializadora (best-effort) ──────────────────────────────────
    if (parsed.compania) {
      supabase
        .from('comercializadoras')
        .select('id')
        .ilike('name', `%${parsed.compania}%`)
        .limit(1)
        .single()
        .then(({ data: comerc }: { data: any }) => {
          if (comerc) {
            supabase.from('supplies').update({ comercializadora_id: comerc.id }).eq('id', supplyId)
          }
        })
        .catch(() => {})
    }

    // ── Batch insert invoices ────────────────────────────────────────────────
    // Fetch existing period pairs to deduplicate
    const { data: existingInvoices } = await supabase
      .from('invoices')
      .select('period_start, period_end')
      .eq('supply_id', supplyId)

    const existingPairs = new Set(
      (existingInvoices || []).map((i: any) => `${i.period_start}|${i.period_end}`)
    )

    const toInsert = []
    for (const inv of parsed.invoices) {
      const pairKey = `${inv.fechaInicio}|${inv.fechaFin}`
      if (existingPairs.has(pairKey)) continue

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
        costeMedioKwh: inv.consumoTotalKwh > 0 ? inv.costeTotalConsumo / inv.consumoTotalKwh : 0,
        costeMedioKwhNeto: inv.consumoTotalKwh > 0 ? inv.costeNetoConsumo / inv.consumoTotalKwh : 0,
        otrosConceptos: [
          inv.peajes > 0            && { concepto: 'Peajes y Transportes',  total: inv.peajes },
          inv.impuestoElectrico > 0 && { concepto: 'Impuesto Eléctrico',    total: inv.impuestoElectrico },
          inv.alquiler > 0          && { concepto: 'Alquiler de Equipos',   total: inv.alquiler },
          inv.otros > 0             && { concepto: 'Otros',                 total: inv.otros },
          inv.ivaTotal > 0          && { concepto: `IVA ${inv.iva}%`,       total: inv.ivaTotal },
        ].filter(Boolean),
        totalFactura: inv.totalFactura,
      }

      toInsert.push({
        supply_id:         supplyId,
        file_url:          '',
        file_type:         'pdf',
        period_start:      inv.fechaInicio || null,
        period_end:        inv.fechaFin    || null,
        total_amount:      inv.totalFactura || null,
        extraction_status: 'completed',
        extracted_data:    { economics, source: 'excel_import', numFactura: inv.numFactura },
        created_at:        new Date().toISOString(),
      })
    }

    let invoicesCreated = 0
    const invoicesSkipped = existingPairs.size

    if (toInsert.length > 0) {
      const { error: invErr } = await supabase.from('invoices').insert(toInsert)
      if (!invErr) {
        invoicesCreated = toInsert.length
        // Advance status: supplies with invoices → "Esperando informes"
        await supabase
          .from('supplies')
          .update({ status: 'estudio_en_curso', updated_at: new Date().toISOString() })
          .eq('id', supplyId)
          .in('status', ['estudio_en_curso', 'facturas_recibidas', 'primer_contacto'])
      } else {
        console.warn(`[import-from-excel] Invoice insert error for ${parsed.cups}:`, invErr.message)
      }
    }

    return {
      fileName,
      cups: parsed.cups,
      tarifa: parsed.tarifa,
      supplyId,
      ok: true,
      invoicesCreated,
      invoicesSkipped,
      isNew: !existingSupply,
    }
  } catch (fileErr: any) {
    return { fileName, ok: false, error: fileErr.message }
  }
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
    const newClientName = (formData.get('newClientName') as string | null)?.trim() || ''
    const files = formData.getAll('files') as File[]

    if (!files.length) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 })
    }

    // ── Resolve client ONCE for all files ───────────────────────────────────
    let resolvedClientId: string | null = clientId || null

    if (!resolvedClientId && newClientName) {
      // Try to find existing client by name
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .ilike('name', newClientName)
        .limit(1)
        .single()

      if (existing) {
        resolvedClientId = existing.id
      } else {
        // Auto-detect client type from name
        const autoType = /ayuntamiento/i.test(newClientName) ? 'ayuntamiento'
          : /comunidad\s+de\s+vecinos|copropiedad|junta\s+de\s+propietarios/i.test(newClientName) ? 'comunidad'
          : 'empresa'

        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert({
            name: newClientName,
            type: autoType,
            commercial_id: user.id,
            origin: 'auditoria',
            marketing_consent: false,
          })
          .select('id')
          .single()

        if (clientErr) {
          return NextResponse.json({ error: `Error creando cliente: ${clientErr.message}` }, { status: 500 })
        }
        if (newClient) resolvedClientId = newClient.id
      }
    }

    if (!resolvedClientId) {
      return NextResponse.json({ error: 'No se pudo determinar el cliente. Especifica un nombre.' }, { status: 400 })
    }

    const finalClientId = resolvedClientId

    // ── Process files in batches of 5 to avoid saturating Supabase connections
    const BATCH_SIZE = 5
    const results: any[] = []

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)
      const settled = await Promise.allSettled(
        batch.map(file => processFile(file, finalClientId, newClientName, supabase))
      )
      for (const r of settled) {
        results.push(
          r.status === 'fulfilled'
            ? r.value
            : { fileName: 'unknown', ok: false, error: (r.reason as any)?.message || 'Error desconocido' }
        )
      }
    }

    return NextResponse.json({ results })

  } catch (err: any) {
    console.error('[import-from-excel]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
