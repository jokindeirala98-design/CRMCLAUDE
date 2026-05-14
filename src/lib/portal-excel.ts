/**
 * Generadores de Excel para el portal cliente.
 * Reutilizan getPortalOverview y getPortalSupplyDetail.
 */
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { getPortalOverview, getPortalSupplyDetail } from './portal-data'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

// Sanitizar nombre de hoja Excel (31 chars, sin caracteres prohibidos)
function sheetName(supply: { name: string | null; cups: string | null }, used: Set<string>): string {
  let base = (supply.name || '').trim()
  if (!base && supply.cups) {
    base = supply.cups.slice(-4)
  }
  if (!base) base = 'Supply'
  base = base.replace(/[\\\/\?\*\[\]:]/g, '').trim().slice(0, 28)
  let final = base
  let suffix = 2
  while (used.has(final.toLowerCase())) {
    final = `${base} (${suffix})`.slice(0, 31)
    suffix++
  }
  used.add(final.toLowerCase())
  return final
}

const CLR = {
  ink: 'FF000000', ink3: 'FF404040', white: 'FFFFFFFF',
  voltisDark: 'FF1F3A2E', voltisBright: 'FFC7F24A', soft: 'FFF5F0E7',
  border: 'FFB0B0B0',
}

function lblCell(ws: ExcelJS.Worksheet, row: number, value: any, opts: any = {}) {
  const c = ws.getCell(row, 1)
  c.value = value
  c.font = { name: 'Arial', bold: opts.bold ?? true, size: opts.size ?? 10,
             color: { argb: opts.color ?? CLR.white } }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg ?? CLR.voltisDark } }
  c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  const b = { style: 'thin' as ExcelJS.BorderStyle, color: { argb: CLR.border } }
  c.border = { top: b, bottom: b, left: b, right: b }
}

function dataCell(ws: ExcelJS.Worksheet, row: number, col: number, value: any, fmt?: string) {
  const c = ws.getCell(row, col)
  c.value = value
  c.font = { name: 'Arial', size: 10 }
  c.alignment = { horizontal: 'center', vertical: 'middle' }
  const b = { style: 'thin' as ExcelJS.BorderStyle, color: { argb: CLR.border } }
  c.border = { top: b, bottom: b, left: b, right: b }
  if (fmt) c.numFmt = fmt
}

interface SupplyData {
  id: string
  name: string | null
  cups: string | null
  tariff: string | null
  invoices: Array<{ period_start: string | null; period_end: string | null; total_amount: number | null; economics: any }>
}

function fillSheet(ws: ExcelJS.Worksheet, supply: SupplyData) {
  // Header
  ws.mergeCells('A1:B1')
  ws.getCell('A1').value = 'CUPS:'
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 11, color: { argb: CLR.white } }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLR.voltisDark } }
  ws.getCell('C1').value = supply.cups || ''
  ws.getCell('C1').font = { name: 'Consolas', bold: true, size: 11 }
  ws.mergeCells('D1:F1')
  ws.getCell('D1').value = 'Suministro:'
  ws.getCell('D1').font = { name: 'Arial', bold: true, size: 10, color: { argb: CLR.white } }
  ws.getCell('D1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLR.voltisDark } }
  ws.getCell('G1').value = supply.name || ''
  ws.getCell('G1').font = { name: 'Arial', bold: true, size: 10 }

  // Layout vertical (igual que el Excel maestro Orcoyen)
  const LAYOUT: Array<[number, string, string|null, string|null]> = [
    [3, 'PERIODO →', null, 'header'],
    [4, 'Fecha Inicio', 'fecha_inicio', null],
    [5, 'Fecha Fin', 'fecha_fin', null],
    [6, 'Días facturados', 'dias', null],
    [7, 'Tarifa ATR', 'tarifa', null],
    [8, 'POTENCIA CONTRATADA (kW)', null, 'section'],
    [9, '  P1 (kW)', 'kw_P1', null],
    [10, '  P2 (kW)', 'kw_P2', null],
    [11, '  P3 (kW)', 'kw_P3', null],
    [12, '  P4 (kW)', 'kw_P4', null],
    [13, '  P5 (kW)', 'kw_P5', null],
    [14, '  P6 (kW)', 'kw_P6', null],
    [15, 'PRECIO POTENCIA (€/kW·día)', null, 'section'],
    [16, '  P1', 'preKw_P1', null],
    [17, '  P2', 'preKw_P2', null],
    [18, '  P3', 'preKw_P3', null],
    [19, '  P4', 'preKw_P4', null],
    [20, '  P5', 'preKw_P5', null],
    [21, '  P6', 'preKw_P6', null],
    [22, 'CONSUMO ENERGÍA (kWh)', null, 'section'],
    [23, '  P1', 'kwh_P1', null],
    [24, '  P2', 'kwh_P2', null],
    [25, '  P3', 'kwh_P3', null],
    [26, '  P4', 'kwh_P4', null],
    [27, '  P5', 'kwh_P5', null],
    [28, '  P6', 'kwh_P6', null],
    [29, '  TOTAL kWh', 'kwh_total', 'bold'],
    [30, 'PRECIO ENERGÍA (€/kWh)', null, 'section'],
    [31, '  P1', 'preKwh_P1', null],
    [32, '  P2', 'preKwh_P2', null],
    [33, '  P3', 'preKwh_P3', null],
    [34, '  P4', 'preKwh_P4', null],
    [35, '  P5', 'preKwh_P5', null],
    [36, '  P6', 'preKwh_P6', null],
    [37, 'TOTALES (€)', null, 'section'],
    [38, '  Coste energía', 'tot_e', null],
    [39, '  Coste potencia', 'tot_p', null],
    [40, '  Impuesto eléctrico', 'imp_e', null],
    [41, '  Bono social (financiación)', 'bono', null],
    [42, '  Alquiler contador', 'alq', null],
    [43, '  IVA', 'iva', null],
    [44, '  TOTAL FACTURA', 'total', 'bold'],
    [45, 'Coste medio (€/kWh)', 'coste_medio', null],
  ]

  for (const [row, lab, _, kind] of LAYOUT) {
    if (kind === 'section') {
      lblCell(ws, row, lab, { bg: 'FFE8EBE3', color: CLR.voltisDark })
    } else if (kind === 'header') {
      lblCell(ws, row, lab)
    } else {
      lblCell(ws, row, lab, { bg: CLR.soft, color: CLR.ink, bold: false })
    }
  }

  // Datos por factura
  const facts = [...supply.invoices].sort((a, b) => (a.period_end || '').localeCompare(b.period_end || ''))
  facts.forEach((inv, idx) => {
    const col = idx + 3
    const eco = inv.economics || {}
    const get = (k: string) => {
      if (k === 'fecha_inicio') return eco.fechaInicio ?? inv.period_start
      if (k === 'fecha_fin') return eco.fechaFin ?? inv.period_end
      if (k === 'dias') return eco.diasFacturados
      if (k === 'tarifa') return eco.tarifa ?? supply.tariff
      if (k === 'kwh_total') return eco.consumoTotalKwh
      if (k === 'tot_e') return eco.costeNetoConsumo
      if (k === 'tot_p') return eco.costeTotalPotencia
      if (k === 'total') return eco.totalFactura ?? inv.total_amount
      if (k === 'coste_medio') return eco.costeMedioKwh
      if (k === 'imp_e') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('impuesto'))?.total
      if (k === 'bono') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('bono'))?.total
      if (k === 'alq') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('alquiler'))?.total
      if (k === 'iva') return eco.ivaTotal
      if (k && k.startsWith('kw_P')) {
        const p = k.replace('kw_','')
        return (eco.potencia||[]).find((x:any)=>x.periodo===p)?.kw
      }
      if (k && k.startsWith('preKw_')) {
        const p = k.replace('preKw_','')
        return (eco.potencia||[]).find((x:any)=>x.periodo===p)?.precioKwDia
      }
      if (k && k.startsWith('kwh_P')) {
        const p = k.replace('kwh_','')
        return (eco.consumo||[]).find((x:any)=>x.periodo===p)?.kwh
      }
      if (k && k.startsWith('preKwh_')) {
        const p = k.replace('preKwh_','')
        return (eco.consumo||[]).find((x:any)=>x.periodo===p)?.precioKwh
      }
      return null
    }

    // Header columna
    const head = ws.getCell(3, col)
    head.value = `Fact ${idx+1}\n${inv.period_end || ''}`
    head.font = { name: 'Arial', bold: true, size: 9, color: { argb: CLR.white } }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLR.voltisDark } }
    head.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    for (const [row, _, key, kind] of LAYOUT) {
      if (!key) continue
      const v = get(key)
      if (v === undefined || v === null) { dataCell(ws, row, col, ''); continue }
      let fmt = '#,##0.00'
      if (['kwh_total','dias','kwh_P1','kwh_P2','kwh_P3','kwh_P4','kwh_P5','kwh_P6'].includes(key)) fmt = '#,##0'
      else if (key.startsWith('kw_P')) fmt = '#,##0.000'
      else if (key.startsWith('pre') || key === 'coste_medio') fmt = '#,##0.000000'
      else if (key === 'fecha_inicio' || key === 'fecha_fin' || key === 'tarifa') fmt = undefined as any
      else if (key === 'total') fmt = '#,##0.00 €'
      dataCell(ws, row, col, v, fmt)
    }
  })

  ws.getColumn(1).width = 32
  ws.getColumn(2).width = 8
  for (let c = 3; c < 3 + facts.length; c++) ws.getColumn(c).width = 14
  ws.getRow(3).height = 30
}

export async function buildClientExcel(clientId: string, options: { year?: number; type?: 'all'|'luz'|'gas' } = {}): Promise<Buffer> {
  const overview = await getPortalOverview(clientId, options)
  if (!overview) throw new Error('Cliente no encontrado')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Voltis Energía'
  wb.created = new Date()

  // Hoja resumen
  const wsR = wb.addWorksheet('Resumen')
  wsR.getCell('A1').value = overview.client.alias || overview.client.name
  wsR.getCell('A1').font = { name: 'Arial', bold: true, size: 16, color: { argb: CLR.voltisDark } }
  wsR.getCell('A2').value = `Año: ${overview.meta.year}  ·  ${overview.totalSupplies} suministros  ·  ${overview.totalCostAnual.toFixed(2)} €  ·  ${overview.totalKwhAnual.toLocaleString('es-ES')} kWh`
  wsR.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: CLR.ink3 } }
  // Tabla supplies
  wsR.getRow(4).values = ['Suministro', 'CUPS', 'Tarifa', 'Tipo', 'Facturas', 'kWh anual', 'Coste anual (€)']
  wsR.getRow(4).font = { bold: true, color: { argb: CLR.white } }
  wsR.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLR.voltisDark } }
  overview.supplies.forEach((s, i) => {
    wsR.getRow(5 + i).values = [s.name || s.cups, s.cups, s.tariff, s.iconCategory, s.nFacturas, s.consumoAnualKwh, s.costeAnualEur]
  })
  wsR.getColumn(1).width = 26
  wsR.getColumn(2).width = 24
  wsR.getColumn(3).width = 9
  wsR.getColumn(4).width = 8
  wsR.getColumn(5).width = 9
  wsR.getColumn(6).width = 12
  wsR.getColumn(7).width = 14

  // 1 hoja por supply
  const used = new Set<string>()
  for (const s of overview.supplies) {
    const detail = await getPortalSupplyDetail(s.id, clientId)
    if (!detail) continue
    const filteredInvs = options.year
      ? detail.invoices.filter(i => i.period_end && new Date(i.period_end).getFullYear() === options.year)
      : detail.invoices
    const ws = wb.addWorksheet(sheetName({ name: s.name, cups: s.cups }, used))
    fillSheet(ws, {
      id: s.id, name: s.name, cups: s.cups, tariff: s.tariff,
      invoices: filteredInvs,
    })
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

export async function buildSupplyExcel(supplyId: string, clientId: string, options: { year?: number } = {}): Promise<Buffer> {
  const detail = await getPortalSupplyDetail(supplyId, clientId)
  if (!detail) throw new Error('Supply no encontrado')
  const filteredInvs = options.year
    ? detail.invoices.filter(i => i.period_end && new Date(i.period_end).getFullYear() === options.year)
    : detail.invoices

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Voltis Energía'
  const used = new Set<string>()
  const ws = wb.addWorksheet(sheetName({ name: detail.supply.name, cups: detail.supply.cups }, used))
  fillSheet(ws, {
    id: detail.supply.id, name: detail.supply.name, cups: detail.supply.cups, tariff: detail.supply.tariff,
    invoices: filteredInvs,
  })

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
