/**
 * Generadores de Excel para el portal cliente.
 *
 * Diferencias luz/gas:
 *   • LUZ: tabla P1-P6 con potencias contratadas, precios potencia, precios
 *     consumo, totales por periodo.
 *   • GAS: tabla simplificada — sin periodos, con término fijo, precio kWh
 *     único, impuesto hidrocarburos, etc.
 *
 * Nombres de hoja:
 *   • Si el supply tiene `name` (ej. "Ayuntamiento Frontón") → ese nombre.
 *   • Si no, los 4 últimos chars del CUPS (incluyendo letras de verificación).
 */
import ExcelJS from 'exceljs'
import { getPortalOverview, getPortalSupplyDetail } from './portal-data'
import { cupsLast4 } from './utils/download-names'

// Sanitizar nombre de hoja Excel (31 chars, sin caracteres prohibidos)
function sheetName(supply: { name: string | null; cups: string | null }, used: Set<string>): string {
  // 1) Si tiene nombre descriptivo (anotación) → prioritario.
  let base = (supply.name || '').trim()
  // 2) Si no, los 4 últimos chars del CUPS (incluye letras de verificación).
  if (!base && supply.cups) {
    base = cupsLast4(supply.cups)
  }
  if (!base) base = 'Suministro'
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
  gasOrange: 'FFEA580C', gasOrangeSoft: 'FFFFEDD5',
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
  type?: 'luz' | 'gas' | null
  invoices: Array<{ period_start: string | null; period_end: string | null; total_amount: number | null; economics: any }>
}

function isGasSupply(supply: SupplyData): boolean {
  if (supply.type === 'gas') return true
  if (/^RL/i.test(supply.tariff || '')) return true
  // Si todas las facturas tienen gasPricing → es gas
  const allGas = supply.invoices.length > 0
    && supply.invoices.every(inv => inv.economics?.gasPricing != null)
  return allGas
}

// ─── Sheet HEADER común (cliente + identificación) ────────────────────────────

function fillHeader(ws: ExcelJS.Worksheet, supply: SupplyData) {
  // Identificador prioritario: name o cups4
  const ident = (supply.name || '').trim() || cupsLast4(supply.cups)
  ws.mergeCells('A1:B1')
  ws.getCell('A1').value = 'Suministro:'
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 11, color: { argb: CLR.white } }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLR.voltisDark } }
  ws.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  ws.getCell('C1').value = ident
  ws.getCell('C1').font = { name: 'Arial', bold: true, size: 12 }
  ws.mergeCells('D1:E1')
  ws.getCell('D1').value = 'Tarifa:'
  ws.getCell('D1').font = { name: 'Arial', bold: true, size: 10, color: { argb: CLR.white } }
  ws.getCell('D1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLR.voltisDark } }
  ws.getCell('D1').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  ws.getCell('F1').value = supply.tariff || ''
  ws.getCell('F1').font = { name: 'Arial', bold: true, size: 10 }
}

// ─── Layout LUZ ────────────────────────────────────────────────────────────────

const LAYOUT_LUZ: Array<[number, string, string|null, string|null]> = [
  [3, 'FACTURA →', null, 'header'],
  [4, 'Fecha Inicio', 'fecha_inicio', null],
  [5, 'Fecha Fin', 'fecha_fin', null],
  [6, 'Días facturados', 'dias', null],
  [7, 'Comercializadora', 'comercializadora', null],
  [8, 'Titular', 'titular', null],
  [9, 'NIF / CIF', 'cif', null],
  [10, 'Dirección suministro', 'direccion', null],
  [11, 'CUPS completo', 'cups_full', null],
  [12, 'POTENCIA CONTRATADA (kW)', null, 'section'],
  [13, '  P1 (kW)', 'kw_P1', null],
  [14, '  P2 (kW)', 'kw_P2', null],
  [15, '  P3 (kW)', 'kw_P3', null],
  [16, '  P4 (kW)', 'kw_P4', null],
  [17, '  P5 (kW)', 'kw_P5', null],
  [18, '  P6 (kW)', 'kw_P6', null],
  [19, 'PRECIO POTENCIA (€/kW·día)', null, 'section'],
  [20, '  P1', 'preKw_P1', null],
  [21, '  P2', 'preKw_P2', null],
  [22, '  P3', 'preKw_P3', null],
  [23, '  P4', 'preKw_P4', null],
  [24, '  P5', 'preKw_P5', null],
  [25, '  P6', 'preKw_P6', null],
  [26, 'CONSUMO ENERGÍA (kWh)', null, 'section'],
  [27, '  P1', 'kwh_P1', null],
  [28, '  P2', 'kwh_P2', null],
  [29, '  P3', 'kwh_P3', null],
  [30, '  P4', 'kwh_P4', null],
  [31, '  P5', 'kwh_P5', null],
  [32, '  P6', 'kwh_P6', null],
  [33, '  TOTAL kWh', 'kwh_total', 'bold'],
  [34, 'PRECIO ENERGÍA (€/kWh)', null, 'section'],
  [35, '  P1', 'preKwh_P1', null],
  [36, '  P2', 'preKwh_P2', null],
  [37, '  P3', 'preKwh_P3', null],
  [38, '  P4', 'preKwh_P4', null],
  [39, '  P5', 'preKwh_P5', null],
  [40, '  P6', 'preKwh_P6', null],
  [41, 'TOTALES (€)', null, 'section'],
  [42, '  Coste energía', 'tot_e', null],
  [43, '  Coste potencia', 'tot_p', null],
  [44, '  Impuesto eléctrico', 'imp_e', null],
  [45, '  Bono social (financiación)', 'bono', null],
  [46, '  Alquiler contador', 'alq', null],
  [47, '  IVA', 'iva', null],
  [48, '  TOTAL FACTURA', 'total', 'bold'],
  [49, 'Coste medio (€/kWh)', 'coste_medio', null],
]

// ─── Layout GAS ────────────────────────────────────────────────────────────────

const LAYOUT_GAS: Array<[number, string, string|null, string|null]> = [
  [3, 'FACTURA →', null, 'header_gas'],
  [4, 'Fecha Inicio', 'fecha_inicio', null],
  [5, 'Fecha Fin', 'fecha_fin', null],
  [6, 'Días facturados', 'dias', null],
  [7, 'Comercializadora', 'comercializadora', null],
  [8, 'Distribuidora', 'distribuidora', null],
  [9, 'Titular', 'titular', null],
  [10, 'NIF / CIF', 'cif', null],
  [11, 'Dirección suministro', 'direccion', null],
  [12, 'CUPS completo', 'cups_full', null],
  [13, 'CONSUMO', null, 'section_gas'],
  [14, '  Consumo (kWh)', 'kwh_total', 'bold'],
  [15, '  Consumo (m³)', 'm3', null],
  [16, '  Factor conversión', 'factor_conv', null],
  [17, 'PRECIOS', null, 'section_gas'],
  [18, '  Precio kWh (€/kWh)', 'gas_precio_kwh', null],
  [19, '  Término fijo (€/día)', 'gas_termino_fijo', null],
  [20, 'TOTALES (€)', null, 'section_gas'],
  [21, '  Coste energía', 'tot_e', null],
  [22, '  Término fijo facturado', 'tot_termino', null],
  [23, '  Impuesto hidrocarburos', 'imp_hidro', null],
  [24, '  Alquiler contador', 'alq', null],
  [25, '  IVA', 'iva', null],
  [26, '  TOTAL FACTURA', 'total', 'bold'],
  [27, 'Coste medio (€/kWh)', 'coste_medio', null],
]

// ─── Render genérico ──────────────────────────────────────────────────────────

function fillSheet(ws: ExcelJS.Worksheet, supply: SupplyData) {
  fillHeader(ws, supply)

  const isGas = isGasSupply(supply)
  const LAYOUT = isGas ? LAYOUT_GAS : LAYOUT_LUZ
  const headerColor = isGas ? CLR.gasOrange : CLR.voltisDark
  const sectionBg = isGas ? CLR.gasOrangeSoft : 'FFE8EBE3'
  const sectionColor = isGas ? CLR.gasOrange : CLR.voltisDark

  for (const [row, lab, _, kind] of LAYOUT) {
    if (kind === 'section' || kind === 'section_gas') {
      lblCell(ws, row, lab, { bg: sectionBg, color: sectionColor })
    } else if (kind === 'header' || kind === 'header_gas') {
      lblCell(ws, row, lab, { bg: headerColor })
    } else {
      lblCell(ws, row, lab, { bg: CLR.soft, color: CLR.ink, bold: false })
    }
  }

  // Datos por factura
  const facts = [...supply.invoices].sort((a, b) => (a.period_end || '').localeCompare(b.period_end || ''))
  facts.forEach((inv, idx) => {
    const col = idx + 3
    const eco = inv.economics || {}
    const gp = eco.gasPricing || {}

    const get = (k: string): any => {
      if (k === 'fecha_inicio') return eco.fechaInicio ?? inv.period_start
      if (k === 'fecha_fin') return eco.fechaFin ?? inv.period_end
      if (k === 'dias') return eco.diasFacturados
      if (k === 'tarifa') return eco.tarifa ?? supply.tariff
      if (k === 'comercializadora') return eco.comercializadora ?? null
      if (k === 'distribuidora') return eco.distribuidora ?? gp.distribuidora ?? null
      if (k === 'titular') return eco.titular ?? eco.holder_name ?? null
      if (k === 'cif') return eco.holder_cif_nif ?? eco.cif ?? eco.nif ?? null
      if (k === 'direccion') return eco.supply_address ?? eco.direccion_suministro ?? null
      if (k === 'cups_full') return eco.cups ?? supply.cups
      if (k === 'kwh_total') return eco.consumoTotalKwh
      if (k === 'tot_e') return eco.costeNetoConsumo ?? eco.costeTotalConsumo
      if (k === 'tot_p') return eco.costeTotalPotencia
      if (k === 'total') return eco.totalFactura ?? inv.total_amount
      if (k === 'coste_medio') return eco.costeMedioKwh ?? eco.costeMedioKwhNeto
      if (k === 'imp_e') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('impuesto el'))?.total ?? eco.impuestoElectricidad
      if (k === 'bono') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('bono'))?.total ?? eco.bonoSocialFijo
      if (k === 'alq') return (eco.otrosConceptos || []).find((o:any)=>String(o.concepto).toLowerCase().includes('alquiler'))?.total ?? eco.alquilerContador
      if (k === 'iva') return eco.ivaTotal
      // Gas específico
      if (k === 'gas_precio_kwh') return gp.precioKwh
      if (k === 'gas_termino_fijo') return gp.terminoFijoDiario
      if (k === 'm3') return gp.consumoM3
      if (k === 'factor_conv') return gp.factorConversion
      if (k === 'tot_termino') return gp.totalTerminoFijo ?? gp.costeTerminoFijo
      if (k === 'imp_hidro') return gp.impuestoHidrocarb ?? gp.impuestoHidrocarburos
      // Por periodo (solo luz)
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
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }
    head.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    for (const [row, _, key, _kind] of LAYOUT) {
      if (!key) continue
      const v = get(key)
      if (v === undefined || v === null) { dataCell(ws, row, col, ''); continue }
      let fmt: string | undefined = '#,##0.00'
      if (['kwh_total','dias','kwh_P1','kwh_P2','kwh_P3','kwh_P4','kwh_P5','kwh_P6','m3'].includes(key)) fmt = '#,##0'
      else if (key.startsWith('kw_P')) fmt = '#,##0.000'
      else if (key === 'factor_conv') fmt = '#,##0.0000'
      else if (key === 'gas_precio_kwh' || key === 'gas_termino_fijo') fmt = '#,##0.000000'
      else if (key.startsWith('pre') || key === 'coste_medio') fmt = '#,##0.000000'
      else if (['fecha_inicio','fecha_fin','tarifa','comercializadora','distribuidora','titular','cif','direccion','cups_full'].includes(key)) fmt = undefined
      else if (key === 'total') fmt = '#,##0.00 €'
      dataCell(ws, row, col, v, fmt)
    }
  })

  ws.getColumn(1).width = 34
  ws.getColumn(2).width = 6
  for (let c = 3; c < 3 + facts.length; c++) ws.getColumn(c).width = 16
  ws.getRow(3).height = 30
}

// ─── Excel global cliente ──────────────────────────────────────────────────────

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
  wsR.getRow(4).values = ['Suministro', 'CUPS (4 últimos)', 'Tarifa', 'Tipo', 'Facturas', 'kWh anual', 'Coste anual (€)']
  wsR.getRow(4).font = { bold: true, color: { argb: CLR.white } }
  wsR.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLR.voltisDark } }
  overview.supplies.forEach((s, i) => {
    wsR.getRow(5 + i).values = [
      s.name || cupsLast4(s.cups),
      cupsLast4(s.cups),
      s.tariff,
      s.iconCategory,
      s.nFacturas,
      s.consumoAnualKwh,
      s.costeAnualEur,
    ]
  })
  wsR.getColumn(1).width = 30
  wsR.getColumn(2).width = 16
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
      type: s.iconCategory as 'luz' | 'gas',
      invoices: filteredInvs,
    })
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

// ─── Excel suministro individual ─────────────────────────────────────────────

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
    type: detail.supply.type as 'luz' | 'gas' | null,
    invoices: filteredInvs,
  })

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
