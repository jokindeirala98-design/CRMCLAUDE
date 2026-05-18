/**
 * POST /api/gana/comparativa/[supplyId]/excel
 *
 * Genera el .xlsx en el formato FG NUTRICION pero usando EXACTAMENTE los
 * mismos números que muestra la UI (motor commer-style). Las celdas son
 * valores absolutos, no fórmulas — así garantizamos que CRM y Excel
 * coincidan al céntimo.
 *
 * Body: { tipo: 'fija_24h' | 'tramos' | 'mercado' }
 */
import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  computarComparativaGanaMulti,
  computarComparativaGana,
  buildScenariosFromTarifas,
  type GanaTarifaRow,
  type BillSample,
  type InputComparativa2td,
} from '@/lib/comparativa-2td-gana'
import { comparativaFilename } from '@/lib/utils/download-names'

export const runtime = 'nodejs'

// ── Helpers extracción factura (idénticos al endpoint GET principal) ─────────

function getByPeriod(items: any[] | undefined, period: 'P1' | 'P2' | 'P3', key: string): number | undefined {
  if (!Array.isArray(items)) return undefined
  for (const it of items) {
    const per = String(it.periodo || '').toUpperCase().replace(/[^P1-9]/g, '')
    if (per !== period) continue
    const v = Number(it[key] ?? 0)
    if (isFinite(v) && v > 0) return v
  }
  return undefined
}

function getPowerNormalized(items: any[] | undefined, period: 'P1' | 'P2', key: string): number | undefined {
  if (!Array.isArray(items)) return undefined
  const p1 = getByPeriod(items, 'P1', key)
  if (period === 'P1') return p1
  const p2 = getByPeriod(items, 'P2', key)
  if (p2 !== undefined) return p2
  const p3 = getByPeriod(items, 'P3', key)
  if (p3 !== undefined) return p3
  return p1
}

function detectFixedFees(eco: any): number {
  if (!eco?.otrosConceptos || !Array.isArray(eco.otrosConceptos)) return 0
  const KEYWORDS = ['smart', 'mantenimiento', 'seguro', 'protec', 'cobertura', 'asistencia', 'plus', 'club', 'tranquilidad', 'happy', 'plan ', 'servicio']
  let total = 0
  for (const c of eco.otrosConceptos) {
    const txt = String(c.concepto ?? '').toLowerCase()
    const monto = Number(c.total ?? 0)
    if (!isFinite(monto) || monto <= 0) continue
    if (KEYWORDS.some(kw => txt.includes(kw))) total += monto
  }
  const dias = Number(eco.diasFacturados ?? 30)
  return dias > 0 ? (total / dias) * 30 : total
}

function detectBonoSocial(eco: any, clientCif?: string | null): { has: boolean; discount: number } {
  if (clientCif) {
    const firstLetter = clientCif.trim().charAt(0).toUpperCase()
    if ('ABCDEFGHJPQRSUVN'.includes(firstLetter)) return { has: false, discount: 0 }
  }
  if (!eco?.otrosConceptos || !Array.isArray(eco.otrosConceptos)) return { has: false, discount: 0 }
  const FALSE_POSITIVE = ['financiación bono', 'financiacion bono', 'cofinanc', 'aportación bono']
  const TRUE_POSITIVE = ['descuento bono', 'bono social aplicado', 'tarifa social', 'tarifa de último recurso', 'tarifa ultimo recurso', 'tur ', 'bono social tur']
  let discount = 0
  let detected = false
  for (const c of eco.otrosConceptos) {
    const txt = String(c.concepto ?? '').toLowerCase()
    const monto = Number(c.total ?? 0)
    if (!isFinite(monto)) continue
    const isFalse = FALSE_POSITIVE.some(kw => txt.includes(kw))
    const isTrue = TRUE_POSITIVE.some(kw => txt.includes(kw))
    const isNegBono = txt.includes('bono social') && monto < -0.01
    if (isFalse && !isTrue && !isNegBono) continue
    if (isTrue || isNegBono) { detected = true; discount += Math.abs(monto) }
  }
  return { has: detected, discount }
}

function buildBillFromInvoice(inv: any, clientCif?: string | null): BillSample | null {
  const eco = (inv?.extracted_data as any)?.economics
  if (!eco) return null
  const dias = Number(eco.diasFacturados ?? 0) || (() => {
    if (inv.period_start && inv.period_end) {
      const ms = new Date(inv.period_end).getTime() - new Date(inv.period_start).getTime()
      return Math.max(1, Math.round(ms / 86400000))
    }
    return 30
  })()
  const bono = detectBonoSocial(eco, clientCif)
  return {
    invoiceId: inv.id,
    fechaInicio: eco.fechaInicio ?? inv.period_start,
    fechaFin: eco.fechaFin ?? inv.period_end,
    diasFacturados: dias,
    totalFactura: Number(eco.totalFactura ?? inv.total_amount ?? 0) || undefined,
    comercializadora: String(eco.comercializadora || inv.extracted_data?.comercializadora || ''),
    tarifa: String(eco.tarifa || inv.extracted_data?.tariff || ''),
    kwhP1: getByPeriod(eco.consumo, 'P1', 'kwh'),
    kwhP2: getByPeriod(eco.consumo, 'P2', 'kwh'),
    kwhP3: getByPeriod(eco.consumo, 'P3', 'kwh'),
    energyP1: getByPeriod(eco.consumo, 'P1', 'precioKwh'),
    energyP2: getByPeriod(eco.consumo, 'P2', 'precioKwh'),
    energyP3: getByPeriod(eco.consumo, 'P3', 'precioKwh'),
    powerP1: getPowerNormalized(eco.potencia, 'P1', 'precioKwDia'),
    powerP2: getPowerNormalized(eco.potencia, 'P2', 'precioKwDia'),
    hasBonoSocial: bono.has,
    bonoSocialDiscount: bono.discount,
    fixedFeesMonthly: detectFixedFees(eco),
  }
}

// ── Excel helpers (idéntico estilo al original FG NUTRICION) ────────────────

const CLR = {
  ink:'FF000000', ink3:'FF404040', ink4:'FF808080',
  crema:'FFFFFFFF', line2:'FF000000',
  salvia:'FF31849B', salviaDark:'FF17375E', salviaSoft:'FFB7DEE8',
  volt:'FFC6EFCE', voltDark:'FF375623',
  green:'FF375623', greenSoft:'FFC6EFCE',
  red:'FF9C0006', redSoft:'FFFFC7CE',
  white:'FFFFFFFF',
}

function sc(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue, opts: any = {}) {
  const c = ws.getCell(row, col)
  c.value = value
  c.font = { name: 'Arial', bold: !!opts.bold, italic: !!opts.italic, size: opts.size ?? 11, color: { argb: opts.color ?? CLR.ink } }
  if (opts.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } }
  c.alignment = { horizontal: opts.align ?? 'left', vertical: 'middle', wrapText: !!opts.wrap }
  if (opts.border !== false) {
    const b = { style: 'thin' as ExcelJS.BorderStyle, color: { argb: CLR.line2 } }
    c.border = { top: b, bottom: b, left: b, right: b }
  }
  if (opts.numFmt) c.numFmt = opts.numFmt
  return c
}

function mc(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number, value: ExcelJS.CellValue, opts: any = {}) {
  ws.mergeCells(r1, c1, r2, c2)
  sc(ws, r1, c1, value, opts)
}

const A=1, B=2, C=3, D=4, E=5, F=6, G=7, H=8, I=9, J=10, K=11, L=12, M=13, N=14, O=15, P=16, Q=17, R=18

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: { supplyId: string } }) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { tipo, comercializadora, attach, input: editedInput } = await req.json() as {
      tipo: 'fija_24h' | 'tramos' | 'mercado'
      comercializadora?: string                // 'gana' | 'nordy' | …
      attach?: boolean
      /** Si viene, se usa como input directo (lo que el comercial editó en
       *  el panel "Ajustar datos"). Si no, se reconstruye desde BD. */
      input?: InputComparativa2td
    }
    if (!['fija_24h', 'tramos', 'mercado'].includes(tipo)) {
      return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
    }
    const targetComerc = (comercializadora || 'gana').toLowerCase()
    const supplyId = params.supplyId

    // 1) Supply + cliente
    const { data: supply } = await supabase
      .from('supplies')
      .select(`id, cups, tariff, type, name, consumption_data, client:clients(id, name, alias, cif, nif, cif_nif)`)
      .eq('id', supplyId)
      .single()
    if (!supply) return NextResponse.json({ error: 'Supply not found' }, { status: 404 })

    const clientRel = Array.isArray(supply.client) ? supply.client[0] : supply.client
    const clientCif = clientRel?.cif ?? clientRel?.cif_nif ?? clientRel?.nif ?? null
    const clientName = clientRel?.alias || clientRel?.name || 'Cliente'

    // 2) Facturas
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, period_start, period_end, extracted_data, total_amount')
      .eq('supply_id', supplyId)
      .order('period_end', { ascending: false, nullsFirst: false })
      .limit(24)

    const bills: BillSample[] = []
    for (const inv of invoices ?? []) {
      const b = buildBillFromInvoice(inv, clientCif)
      if (b) bills.push(b)
    }

    // 3) SIPS
    const consData = (supply.consumption_data as any) ?? {}
    const potSrc = consData.potenciaContratada ?? {}
    const consSrc = consData.consumoPeriodos ?? {}
    const maxSrc = consData.potenciaMaxDemandada ?? consData.maximetros ?? {}

    const sipPotP1 = Number(potSrc.P1 ?? potSrc.p1 ?? 0)
    const sipPotP2Raw = Number(potSrc.P2 ?? potSrc.p2 ?? 0)
    const sipPotP3 = Number(potSrc.P3 ?? potSrc.p3 ?? 0)
    let potenciaP1 = sipPotP1
    let potenciaP2 = (sipPotP2Raw < 0.5 && sipPotP3 > 0.1) ? sipPotP3 : (sipPotP2Raw || sipPotP3 || sipPotP1)

    if (potenciaP1 === 0 && potenciaP2 === 0) {
      const lastEco = (invoices?.[0]?.extracted_data as any)?.economics
      if (lastEco?.potencia) {
        potenciaP1 = getPowerNormalized(lastEco.potencia, 'P1', 'kw') ?? 0
        potenciaP2 = getPowerNormalized(lastEco.potencia, 'P2', 'kw') ?? 0
      }
    }

    let consumoP1 = Number(consSrc.P1 ?? consSrc.p1 ?? 0)
    let consumoP2 = Number(consSrc.P2 ?? consSrc.p2 ?? 0)
    let consumoP3 = Number(consSrc.P3 ?? consSrc.p3 ?? 0)
    if (consumoP1 === 0 && consumoP2 === 0 && consumoP3 === 0 && bills.length > 0) {
      const totalDays = bills.reduce((a, b) => a + (b.diasFacturados ?? 0), 0)
      if (totalDays > 0) {
        const factor = 365 / totalDays
        consumoP1 = bills.reduce((a, b) => a + (b.kwhP1 ?? 0), 0) * factor
        consumoP2 = bills.reduce((a, b) => a + (b.kwhP2 ?? 0), 0) * factor
        consumoP3 = bills.reduce((a, b) => a + (b.kwhP3 ?? 0), 0) * factor
      }
    }

    const potenciaMaxDemandadaKw = Math.max(
      Number(maxSrc.P1 ?? maxSrc.p1 ?? maxSrc.max ?? 0),
      Number(maxSrc.P2 ?? maxSrc.p2 ?? 0),
      Number(consData.maxDemandedKw ?? 0),
    )

    // 4) Tarifas (todas las comercializadoras)
    const { data: tarifas } = await supabase
      .from('gana_tarifas')
      .select('id, comercializadora, nombre, tipo, precio_p1, precio_p2, precio_p3, potencia_p1, potencia_p2, extras_anuales')
      .eq('vigente', true)
      .eq('tarifa_atr', '2.0TD')

    const scenarios = buildScenariosFromTarifas((tarifas ?? []) as GanaTarifaRow[])

    // 5) Calcular con el motor commer.
    //    Si el cliente nos pasa un `input` editado (panel "Ajustar datos"
    //    de la UI tras pulsar "Actualizar y comparar"), usamos el motor
    //    single-input para respetar los valores manuales del comercial.
    //    Si no, el motor multi-bill desde BD + SIPS (comportamiento
    //    original).
    const result = editedInput
      ? computarComparativaGana({ input: editedInput, scenarios })
      : computarComparativaGanaMulti({
          potenciaP1, potenciaP2,
          consumoP1, consumoP2, consumoP3,
          bills, scenarios,
          potenciaMaxDemandadaKw: potenciaMaxDemandadaKw || undefined,
        })

    // Filtrar por tipo + comercializadora (puede haber 2 de mismo tipo: Gana tramos + Nordy tramos)
    const scenario = result.scenarios.find(
      s => s.tipo === tipo && (s.comercializadora || 'gana').toLowerCase() === targetComerc,
    )
    if (!scenario) return NextResponse.json({ error: 'Escenario no calculable' }, { status: 400 })

    // ── Generar Excel ──────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Voltis CRM'
    wb.created = new Date()
    const ws = wb.addWorksheet('Comparativa 2.0TD', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      properties: { tabColor: { argb: CLR.salvia } },
    })

    // Column widths
    const widths = [10, 12, 15, 13, 12, 13.16, 12, 12, 12.5, 12, 12, 12, 14.5, 13, 13, 13, 20, 18]
    widths.forEach((w, i) => ws.getColumn(i + 1).width = w)

    // Valores reales del motor commer
    const cups = supply.cups || ''
    const tariffName = scenario.nombre

    // POTENCIA (filas 1-16)
    const potP1ActualEur  = scenario.costeActualAnual    // no usado directamente
    const potP1NetoNuevo  = scenario.desglose.potenciaAnualNeta / 1.1055  // sin IE×IVA
    // Para mostrar valores compatibles con el formato Excel original:
    //   - Sin IVA en columnas H, I → multiplicamos por 1 (neto)
    //   - Con IVA en columna K → ya incluye IE×IVA = 1.1055
    // OJO: el Excel original mostraba IVA 1.21; ahora mostramos commer-style.

    // ─── HEADER VOLTIS ─────────────────────────────────────────────────────
    mc(ws, 1, N, 1, P, 'VOLTIS', { bold: true, size: 20, color: CLR.white, bg: CLR.salviaDark, align: 'center' })
    mc(ws, 2, N, 2, P, 'energía', { italic: true, size: 14, color: CLR.salvia, bg: CLR.salviaSoft, align: 'center' })
    mc(ws, 3, N, 3, P, `${(scenario.comercializadora || 'gana').toUpperCase()} ${tariffName.toUpperCase()}`,
       { bold: true, size: 9, color: CLR.ink3, bg: CLR.salviaSoft, align: 'center' })
    mc(ws, 1, Q, 1, R, clientName.toUpperCase(), { bold: true, size: 12, color: CLR.white, bg: CLR.salviaDark, align: 'center', wrap: true })
    mc(ws, 2, Q, 2, R, cups, { italic: true, size: 9, color: CLR.ink4, bg: CLR.crema, align: 'center' })

    // ─── POTENCIAS section ─────────────────────────────────────────────────
    mc(ws, 1, A, 1, D, 'CALCULADORA DIFERENCIA POTENCIAS 2.0TD', { bold: true, size: 10, color: CLR.white, bg: CLR.salviaDark, align: 'center', wrap: true })

    sc(ws, 4, H, 'ANUALMENTE', { bold: true, size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 4, K, 'IVA INCL.',  { bold: true, size: 10, color: CLR.ink3, align: 'center' })

    sc(ws, 5, A, 'ACTUAL', { bold: true, size: 12, color: CLR.white, bg: CLR.ink3, align: 'center' })
    ;[B, C, E, F, H, I].forEach(col => {
      sc(ws, 6, col, [B, E, H].includes(col) ? 'p1' : 'p2', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    })
    sc(ws, 6, K, 'TOTAL:', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })

    // ACTUAL row 7 — kW + precio actual + anual neto + total con IVA commer
    const currentPotP1 = result.priceAnalysis?.powerP1?.weightedMean ?? 0
    const currentPotP2 = result.priceAnalysis?.powerP2?.weightedMean ?? 0
    const actualPotEneroP1 = potenciaP1 * currentPotP1 * 365
    const actualPotEneroP2 = potenciaP2 * currentPotP2 * 365
    const actualPotIVA = (actualPotEneroP1 + actualPotEneroP2) * 1.1055   // IE × IVA commer

    sc(ws, 7, B, potenciaP1,   { bold: true, size: 12, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 7, C, potenciaP2,   { bold: true, size: 12, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 7, E, currentPotP1, { bold: true, size: 12, align: 'center', numFmt: '#,##0.000000' })
    sc(ws, 7, F, currentPotP2, { bold: true, size: 12, align: 'center', numFmt: '#,##0.000000' })
    sc(ws, 7, H, actualPotEneroP1, { bold: true, size: 12, align: 'center', numFmt: '#,##0.00' })
    sc(ws, 7, I, actualPotEneroP2, { bold: true, size: 12, align: 'center', numFmt: '#,##0.00' })
    sc(ws, 7, K, actualPotIVA, { bold: true, size: 12, align: 'center', numFmt: '#,##0.00', bg: CLR.crema })

    mc(ws, 7, M, 7, N, 'POR POTENCIA:', { bold: true, size: 12, color: CLR.salviaDark, align: 'center', bg: CLR.salviaSoft })
    sc(ws, 8, M, 'MENSUAL', { bold: true, size: 11, color: CLR.ink3, align: 'center' })
    sc(ws, 8, N, 'ANUAL',   { bold: true, size: 11, color: CLR.ink3, align: 'center' })
    sc(ws, 9, M, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })
    sc(ws, 9, N, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })

    // Diferencia potencia ANUAL = actual - nuevo (ambos IVA commer)
    const nuevaPotIVA = scenario.desglose.potenciaAnualNeta * 1.1055
    const difPotAnual = actualPotIVA - nuevaPotIVA
    const difPotMensual = difPotAnual / 12
    const powColor = difPotAnual >= 0 ? CLR.green : CLR.red
    const powBg = difPotAnual >= 0 ? CLR.greenSoft : CLR.redSoft

    sc(ws, 10, M, difPotMensual, { bold: true, size: 12, color: powColor, numFmt: '#,##0.00 €', align: 'center', bg: powBg })
    sc(ws, 10, N, difPotAnual,   { bold: true, size: 12, color: powColor, numFmt: '#,##0.00 €', align: 'center', bg: powBg })

    sc(ws, 11, H, 'ANUALMENTE', { bold: true, size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 11, K, 'IVA INCL.',  { bold: true, size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 12, A, 'NUEVO', { bold: true, size: 12, color: CLR.white, bg: CLR.salvia, align: 'center' })
    ;[B, C, E, F, H, I].forEach(col => {
      sc(ws, 13, col, [B, E, H].includes(col) ? 'p1' : 'p2', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    })
    sc(ws, 13, K, 'TOTAL:', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })

    const nuevoPotNetoP1 = potenciaP1 * scenario.preciosNuevos.potenciaP1 * 365
    const nuevoPotNetoP2 = potenciaP2 * scenario.preciosNuevos.potenciaP2 * 365
    sc(ws, 14, B, potenciaP1, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 14, C, potenciaP2, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000' })
    sc(ws, 14, E, scenario.preciosNuevos.potenciaP1, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000000', bg: CLR.salviaSoft })
    sc(ws, 14, F, scenario.preciosNuevos.potenciaP2, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.000000', bg: CLR.salviaSoft })
    sc(ws, 14, H, nuevoPotNetoP1, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.00' })
    sc(ws, 14, I, nuevoPotNetoP2, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.00' })
    sc(ws, 14, K, nuevaPotIVA, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.00', bg: CLR.salviaSoft })

    mc(ws, 14, Q, 14, R, 'TOTAL AHORRO ESTIMADO:', { bold: true, size: 14, color: CLR.white, bg: CLR.salviaDark, align: 'center' })
    sc(ws, 15, J, 365, { size: 11, color: CLR.ink4, align: 'center', numFmt: '#,##0' })
    sc(ws, 15, Q, 'MENSUAL', { bold: true, size: 12, color: CLR.ink, align: 'center', bg: CLR.crema })
    sc(ws, 15, R, 'ANUAL',   { bold: true, size: 12, color: CLR.ink, align: 'center', bg: CLR.crema })

    // Total ahorro = el del motor commer
    const totalAhorroAnual = scenario.ahorroAnual
    const totalAhorroMensual = scenario.ahorroMensual
    const totColor = totalAhorroAnual >= 0 ? CLR.voltDark : CLR.red
    sc(ws, 16, Q, totalAhorroMensual, { bold: true, size: 16, color: totColor, numFmt: '#,##0.00 €', align: 'center', bg: CLR.volt })
    sc(ws, 16, R, totalAhorroAnual,   { bold: true, size: 16, color: totColor, numFmt: '#,##0.00 €', align: 'center', bg: CLR.volt })

    // ─── ENERGIA section ───────────────────────────────────────────────────
    mc(ws, 18, A, 18, D, 'CALCULADORA DIFERENCIA ENERGIA 2.0TD', { bold: true, size: 10, color: CLR.white, bg: CLR.salviaDark, align: 'center', wrap: true })

    const totalKwh = consumoP1 + consumoP2 + consumoP3
    mc(ws, 22, B, 22, C, 'CONSUMO ANUAL KWH', { bold: true, size: 12, color: CLR.white, bg: CLR.salvia, align: 'center' })
    mc(ws, 23, B, 23, C, totalKwh, { bold: true, size: 12, color: CLR.ink, align: 'center', numFmt: '#,##0', bg: CLR.crema })
    sc(ws, 23, N, 'IVA INCL.', { size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 24, J, 'ESTA FACTURA:', { bold: true, size: 9, color: CLR.ink3, align: 'center', wrap: true })

    sc(ws, 25, A, 'CONSUMO',       { bold: true, size: 12, color: CLR.ink,  align: 'center' })
    sc(ws, 25, F, 'Precio actual:', { size: 10, color: CLR.ink3, align: 'center', wrap: true })
    sc(ws, 25, N, 'TOTAL:',        { bold: true, size: 12, color: CLR.salviaDark, align: 'center' })

    sc(ws, 26, J, 'P1', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 26, K, 'P2', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 26, L, 'P3', { bold: true, size: 14, color: CLR.ink, align: 'center' })

    const currentE1 = result.priceAnalysis?.tariffNature === 'fija' ? (result.priceAnalysis.energyP1?.median ?? 0) : (result.priceAnalysis?.energyP1?.weightedMean ?? 0)
    const currentE2 = result.priceAnalysis?.tariffNature === 'fija' ? (result.priceAnalysis.energyP2?.median ?? 0) : (result.priceAnalysis?.energyP2?.weightedMean ?? 0)
    const currentE3 = result.priceAnalysis?.tariffNature === 'fija' ? (result.priceAnalysis.energyP3?.median ?? 0) : (result.priceAnalysis?.energyP3?.weightedMean ?? 0)

    const actualEneP1 = consumoP1 * currentE1
    const actualEneP2 = consumoP2 * currentE2
    const actualEneP3 = consumoP3 * currentE3
    const actualEneIVA = (actualEneP1 + actualEneP2 + actualEneP3) * 1.1055

    sc(ws, 26, N, actualEneIVA, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00 €', align: 'center', bg: CLR.crema })

    sc(ws, 27, B, 'P1', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, C, 'P2', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, D, 'P3', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, F, 'P1', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, G, 'P2', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, H, 'P3', { bold: true, size: 14, color: CLR.ink, align: 'center' })
    sc(ws, 27, J, actualEneP1, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00', align: 'center' })
    sc(ws, 27, K, actualEneP2, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00', align: 'center' })
    sc(ws, 27, L, actualEneP3, { bold: true, size: 12, color: CLR.ink, numFmt: '#,##0.00', align: 'center' })
    mc(ws, 27, P, 27, Q, 'POR ENERGIA:', { bold: true, size: 12, color: CLR.salviaDark, align: 'center', bg: CLR.salviaSoft })

    sc(ws, 28, B, consumoP1, { bold: true, size: 11, align: 'center', numFmt: '#,##0' })
    sc(ws, 28, C, consumoP2, { bold: true, size: 11, align: 'center', numFmt: '#,##0' })
    sc(ws, 28, D, consumoP3, { bold: true, size: 11, align: 'center', numFmt: '#,##0' })
    sc(ws, 28, F, currentE1, { bold: true, size: 12, align: 'center', numFmt: '#,##0.0000' })
    sc(ws, 28, G, currentE2, { bold: true, size: 12, align: 'center', numFmt: '#,##0.0000' })
    sc(ws, 28, H, currentE3, { bold: true, size: 12, align: 'center', numFmt: '#,##0.0000' })
    sc(ws, 28, P, 'MENSUAL', { bold: true, size: 11, color: CLR.ink3, align: 'center' })
    sc(ws, 28, Q, 'ANUAL',   { bold: true, size: 11, color: CLR.ink3, align: 'center' })

    sc(ws, 29, P, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })
    sc(ws, 29, Q, 'DIFERENCIA', { bold: true, size: 11, color: CLR.salviaDark, align: 'center' })

    // Diferencia energía
    const nuevaEneIVA = scenario.desglose.energiaAnualNeta * 1.1055
    const difEneAnual = actualEneIVA - nuevaEneIVA
    const difEneMensual = difEneAnual / 12
    const eneColor = difEneAnual >= 0 ? CLR.green : CLR.red
    const eneBg = difEneAnual >= 0 ? CLR.greenSoft : CLR.redSoft

    sc(ws, 30, F, 'Precio Nuevo:',   { bold: true, size: 10, color: CLR.salviaDark, align: 'center', wrap: true })
    sc(ws, 30, J, 'NUEVA FACTURA:',  { bold: true, size: 9, color: CLR.salviaDark, align: 'center', wrap: true })
    sc(ws, 30, N, 'IVA INCL.',       { size: 10, color: CLR.ink3, align: 'center' })
    sc(ws, 30, P, difEneMensual, { bold: true, size: 12, color: eneColor, numFmt: '#,##0.00 €', align: 'center', bg: eneBg })
    sc(ws, 30, Q, difEneAnual,   { bold: true, size: 12, color: eneColor, numFmt: '#,##0.00 €', align: 'center', bg: eneBg })

    sc(ws, 32, F, 'P1', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, G, 'P2', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, H, 'P3', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, J, 'P1', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, K, 'P2', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, L, 'P3', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })
    sc(ws, 32, N, 'TOTAL:', { bold: true, size: 14, color: CLR.salviaDark, align: 'center' })

    const nuevaEneP1 = consumoP1 * scenario.preciosNuevos.energiaP1
    const nuevaEneP2 = consumoP2 * scenario.preciosNuevos.energiaP2
    const nuevaEneP3 = consumoP3 * scenario.preciosNuevos.energiaP3

    sc(ws, 33, F, scenario.preciosNuevos.energiaP1, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.0000', bg: CLR.salviaSoft })
    sc(ws, 33, G, scenario.preciosNuevos.energiaP2, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.0000', bg: CLR.salviaSoft })
    sc(ws, 33, H, scenario.preciosNuevos.energiaP3, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.0000', bg: CLR.salviaSoft })
    sc(ws, 33, J, nuevaEneP1, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.00' })
    sc(ws, 33, K, nuevaEneP2, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.00' })
    sc(ws, 33, L, nuevaEneP3, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.00' })
    sc(ws, 33, N, nuevaEneIVA, { bold: true, size: 12, color: CLR.salviaDark, align: 'center', numFmt: '#,##0.00 €', bg: CLR.salviaSoft })

    // Row heights
    const heights: Record<number, number> = {
      1:22, 2:14, 3:20, 4:18, 5:22, 6:24, 7:22, 8:18, 9:24, 10:24,
      11:18, 12:22, 13:24, 14:22, 15:18, 16:30,
      17:12, 18:22, 19:10, 20:10, 21:12,
      22:22, 23:22, 24:26, 25:26, 26:24, 27:24, 28:22, 29:24, 30:28,
      31:12, 32:24, 33:22,
    }
    Object.entries(heights).forEach(([r, h]) => { ws.getRow(Number(r)).height = h })

    const buffer = Buffer.from(await wb.xlsx.writeBuffer())
    const comercLabel = (scenario.comercializadora || 'gana').toLowerCase() === 'nordy' ? 'Nordy' : 'Gana'
    // Nombre estándar: comparativa_{cups4}_{tarifa}_{Comercializadora}.xlsx
    // ej. comparativa_1910_2.0_Nordy.xlsx
    const filename = comparativaFilename({
      cups: supply.cups,
      tariff: supply.tariff || '2.0TD',
      variant: comercLabel,
      ext: 'xlsx',
    })

    // ── Si attach=true: subir a Storage y asociar al supply ────────────────
    if (attach) {
      const adminSupabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      )
      const storagePath = `${supplyId}/${Date.now()}_${filename}`

      // Helper: subir, y si el bucket no existe → crearlo y reintentar.
      const tryUpload = async () => adminSupabase.storage
        .from('estudios-economicos')
        .upload(storagePath, buffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        })

      let { error: upErr } = await tryUpload()

      if (upErr && /Bucket not found|bucket/i.test(upErr.message)) {
        // Auto-crear bucket público (idempotente: si ya existe en concurrencia, no falla)
        await adminSupabase.storage.createBucket('estudios-economicos', {
          public: true,
          fileSizeLimit: 10 * 1024 * 1024,    // 10 MB
          allowedMimeTypes: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/pdf',
          ],
        }).catch(() => null)
        // Reintentar subida
        const retry = await tryUpload()
        upErr = retry.error
      }

      if (upErr) {
        // Subida sigue fallando — devolvemos el archivo igualmente al usuario
        // (download funciona) y avisamos en header para que el admin lo vea.
        console.error('[gana excel] storage upload failed:', upErr)
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-cache',
            'X-Attach-Failed': 'true',
            'X-Attach-Error': upErr.message.slice(0, 200),
          },
        })
      }
      const { data: urlData } = adminSupabase.storage
        .from('estudios-economicos')
        .getPublicUrl(storagePath)

      // Perfil del usuario que adjunta
      const { data: profile } = await supabase
        .from('users_profile')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      await adminSupabase
        .from('supplies')
        .update({
          economic_study_url: urlData?.publicUrl ?? null,
          economic_study_filename: filename,
          economic_study_uploaded_at: new Date().toISOString(),
          economic_study_uploaded_by: profile?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', supplyId)

      // Insertar también en la tabla `studies` para que aparezca en el
      // "Gestor de documentos" del supply, que lee de esa tabla.
      // (El campo supplies.economic_study_url se mantiene por compat,
      // pero la UI del CRM lista las comparativas desde `studies`.)
      const nowIso = new Date().toISOString()
      await adminSupabase.from('studies').insert({
        supply_id: supplyId,
        type: 'economico',
        report_url: urlData?.publicUrl ?? null,
        status: 'completed',
        created_by: profile?.id ?? user.id,
        created_at: nowIso,
        completed_at: nowIso,
      })

      // Cerrar admin_task si existía pendiente
      await adminSupabase
        .from('admin_tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: profile?.id ?? null,
        })
        .eq('supply_id', supplyId)
        .eq('type', 'estudio_economico_pendiente')
        .eq('status', 'pending')

      // Devolver el archivo TAMBIÉN (para que el usuario lo descargue)
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache',
          'X-Attached-To-Supply': 'true',
          'X-Attached-Url': urlData?.publicUrl ?? '',
        },
      })
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e: any) {
    console.error('[POST /api/gana/comparativa/[supplyId]/excel]', e)
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 })
  }
}
