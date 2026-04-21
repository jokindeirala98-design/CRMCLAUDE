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

function extractPowers(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)
  if (Array.isArray(sipsData.potenciasContratadas))
    return sipsData.potenciasContratadas.slice(0, periodCount).map(Number)
  const powers: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    const v = sipsData[`potenciaP${i}`] ?? sipsData[`p${i}`] ?? sipsData[`P${i}`] ?? 0
    powers.push(Number(v))
  }
  if (powers.some(p => p > 0)) return powers
  const single = Number(sipsData.potenciaContratada ?? sipsData.potencia ?? 0)
  return Array(periodCount).fill(single)
}

function extractConsumption(sipsData: any, periodCount: number): number[] {
  if (!sipsData) return Array(periodCount).fill(0)
  if (Array.isArray(sipsData.consumoPorPeriodo))
    return sipsData.consumoPorPeriodo.slice(0, periodCount).map(Number)
  const cons: number[] = []
  for (let i = 1; i <= periodCount; i++) {
    const v = sipsData[`consumoP${i}`] ?? sipsData[`energiaP${i}`] ?? 0
    cons.push(Number(v))
  }
  if (cons.some(c => c > 0)) return cons
  const total = Number(sipsData.totalKwh ?? sipsData.total ?? 0)
  return Array(periodCount).fill(Math.round(total / periodCount))
}

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
    set(ws, 'A10', comercializadoraActual)
    set(ws, 'I10', nueva_comercializadora)

    // ── POTENCIA ──────────────────────────────────────────────────────────────
    const DIAS = 365
    const POT_ROWS = [12, 13, 14, 15, 16, 17]
    let totalPotenciaActual = 0, totalPotenciaNueva = 0, totalKwPot = 0

    for (let i = 0; i < periodCount; i++) {
      const row = POT_ROWS[i]
      const kw = powers[i] || 0
      const boeA = boe2025[i]?.pricePerKwDay ?? 0
      const boeN = boe2026[i]?.pricePerKwDay ?? 0
      const costeA = fmt2(kw * DIAS * boeA)
      const costeN = fmt2(kw * DIAS * boeN)

      set(ws, `B${row}`, kw);  set(ws, `C${row}`, DIAS)
      set(ws, `D${row}`, boeA); set(ws, `E${row}`, fmt2(kw * boeA * DIAS / 12))
      set(ws, `F${row}`, costeA)
      set(ws, `J${row}`, kw);  set(ws, `K${row}`, DIAS)
      set(ws, `L${row}`, boeN); set(ws, `M${row}`, fmt2(kw * boeN * DIAS / 12))
      set(ws, `N${row}`, costeN)

      totalPotenciaActual += costeA; totalPotenciaNueva += costeN; totalKwPot += kw
    }
    set(ws, 'B19', totalKwPot); set(ws, 'F19', fmt2(totalPotenciaActual))
    set(ws, 'J19', totalKwPot); set(ws, 'N19', fmt2(totalPotenciaNueva))

    // ── ENERGÍA ───────────────────────────────────────────────────────────────
    const ENE_ROWS = [30, 31, 32, 33, 34, 35]
    const PERIOD_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
    let totalEnergiaActual = 0, totalEnergiaNueva = 0

    set(ws, 'D29', totalKwh); set(ws, 'J29', totalKwh)

    for (let i = 0; i < periodCount; i++) {
      const row = ENE_ROWS[i]
      const kwh = consumption[i] || 0
      const pct = totalKwh > 0 ? kwh / totalKwh : 0
      const precioA = actualAvgPrice || 0
      const precioN = precios_nuevos[i] || 0
      const costeA = fmt2(kwh * precioA)
      const costeN = fmt2(kwh * precioN)

      set(ws, `C${row}`, PERIOD_LABELS[i]); set(ws, `D${row}`, kwh)
      set(ws, `E${row}`, precioA); set(ws, `F${row}`, costeA); set(ws, `G${row}`, pct)
      set(ws, `I${row}`, PERIOD_LABELS[i]); set(ws, `J${row}`, kwh)
      set(ws, `L${row}`, precioN); set(ws, `M${row}`, costeN)

      totalEnergiaActual += costeA; totalEnergiaNueva += costeN
    }

    const avgActual = totalKwh > 0 ? totalEnergiaActual / totalKwh : 0
    set(ws, 'D37', totalKwh); set(ws, 'E37', fmt2(avgActual)); set(ws, 'F37', fmt2(totalEnergiaActual))
    set(ws, 'J37', totalKwh); set(ws, 'K37', 0); set(ws, 'L37', 0)

    const difEnergia = fmt2(totalEnergiaActual - totalEnergiaNueva)
    set(ws, 'G40', difEnergia)

    // ── Resumen ───────────────────────────────────────────────────────────────
    const difPotencia = fmt2(totalPotenciaActual - totalPotenciaNueva)
    const difTotal = fmt2(difEnergia + difPotencia + (ssaa || 0) + (excesos || 0))
    set(ws, 'I23', 0)
    set(ws, 'I24', fmt2(totalEnergiaActual))
    set(ws, 'K25', difTotal)

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

        // 3. Guardar notas + avanzar pipeline si procede
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
