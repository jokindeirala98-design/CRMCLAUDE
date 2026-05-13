/**
 * src/lib/comparativa-tripartita.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Motor de comparativa Voltis V2 — metodología tripartita honesta.
 *
 * Calcula 4 escenarios y descompone el ahorro en sus 3 fuentes reales:
 *
 *   S0 = pagó real ANTES                 (suma facturas comercializadora antigua)
 *   S1 = mismo consumo, precios Voltis, REGIMEN FISCAL del año antiguo
 *   S2 = mismo consumo, precios Voltis, RÉGIMEN FISCAL del año nuevo
 *   S3 = pagó real AHORA                 (suma facturas Voltis)
 *
 *   ahorroTotal      = S0 − S3
 *   ahorroTarifa     = S0 − S1   → atribuible a Voltis (cambio de comercializadora)
 *   ahorroNormativo  = S1 − S2   → atribuible al Gobierno (IE/IEH/IVA)
 *   ahorroConsumo    = S2 − S3   → atribuible al cliente (consume menos)
 *
 *   Por identidad algebraica: (S0−S1) + (S1−S2) + (S2−S3) = S0 − S3 ✓
 *
 * Esta es la metodología "honestidad por encima de venta" del prompt Voltis:
 * separa el ahorro real conseguido por la comercializadora del que se debe a
 * coyuntura fiscal del momento, sin demonizar al competidor previo.
 *
 * ── Diseño ─────────────────────────────────────────────────────────────────
 * Este módulo es PARALELO a comparativa-energetica.ts. NO sustituye ni
 * modifica al viejo (regla: si cambia el contrato del módulo, módulo nuevo).
 * Cuando V2 esté validado en producción, V1 se deprecará y se retirará.
 */

import type { BillEconomics, ConsumoItem, InvoiceRow } from '@/components/supply/AnnualEconomics'

// ── Tipos públicos ─────────────────────────────────────────────────────────

export const PERIODOS_LUZ = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
export type PeriodoLuz = typeof PERIODOS_LUZ[number]

/** Resumen numérico de una factura. */
export interface ResumenFacturaT {
  totalEnergia: number
  totalPotencia: number
  excesos: number
  bonoSocial: number
  alquiler: number
  otrosRegulados: number
  ieePorcentaje: number       // luz: tipo aplicado (0.05, 0.005…). Gas: 0
  ieeImporte: number
  iehImporte: number          // gas: importe Impuesto Hidrocarburos. Luz: 0
  iehPorKwh: number           // gas: IEH / consumoKwh. Luz: 0
  baseImponible: number
  ivaPorcentaje: number       // tipo IVA aplicado (0.05 / 0.10 / 0.21)
  ivaImporte: number
  totalFactura: number
  dias: number
  consumoKwh: number
}

/** Pareja antigua ↔ Voltis del mismo mes natural. */
export interface ParejaMesT {
  mes: number    // 0-11
  year: number   // year de la factura Voltis
  antigua: InvoiceRow
  voltis: InvoiceRow
  antiguaEco: BillEconomics
  voltisEco: BillEconomics
}

/** Detalle por par de cambios normativos detectados (Gobierno, no Voltis). */
export interface CambioNormativoMes {
  mes: number
  year: number
  /** % IVA aplicado en factura antigua (0.21, 0.10, 0.05…) */
  ivaAntigua: number
  ivaVoltis: number
  ivaCambio: boolean
  /** Luz: tipo IE (0.05, 0.005…). Gas: undefined. */
  ieAntigua?: number
  ieVoltis?: number
  ieCambio: boolean
  /** Gas: IEH €/kWh derivado (importe/consumo). Luz: undefined. */
  iehAntigua?: number
  iehVoltis?: number
  iehCambio: boolean
}

/** Detalle del escenario por par (mes a mes). */
export interface EscenarioParT {
  mes: number
  year: number
  total: number
  resumen: ResumenFacturaT
}

export interface EscenarioT {
  /** Total agregado de todos los pares */
  total: number
  /** Detalle mes a mes */
  porMes: EscenarioParT[]
}

export interface DescomposicionT {
  S0: number; S1: number; S2: number; S3: number
  ahorroTotal: number            // S0 − S3
  ahorroTarifa: number           // S0 − S1
  ahorroNormativo: number        // S1 − S2
  ahorroConsumo: number          // S2 − S3
  pctTotal: number               // ahorroTotal / S0 × 100
  pctTarifa: number              // ahorroTarifa / S0 × 100
  pctNormativo: number           // ahorroNormativo / S0 × 100
  pctConsumo: number             // ahorroConsumo / S0 × 100
  /** Identidad: |total − (tarifa+normativo+consumo)|. Debería ser <0.01. */
  residualVerificacion: number
}

export interface ResultadoTripartito {
  supplyType: 'luz' | 'gas'
  cups: string | null
  tarifa: string | null
  comercializadoraAntigua: string | null
  comercializadoraVoltis: string | null
  /** Pares mes a mes (pueden ser menos de 12) */
  pares: ParejaMesT[]
  S0: EscenarioT
  S1: EscenarioT
  S2: EscenarioT
  S3: EscenarioT
  descomposicion: DescomposicionT
  cambiosNormativos: CambioNormativoMes[]
  /** Resumen de cobertura: cuántos meses se han podido comparar */
  cobertura: {
    mesesComparados: number
    desde: { mes: number; year: number } | null
    hasta: { mes: number; year: number } | null
  }
  /** Validación: ¿reproducir cada factura cuadra ±0.10 €? */
  validacionFacturas: Array<{
    invoiceId: string
    side: 'antigua' | 'voltis'
    totalDeclarado: number
    totalRecalculado: number
    delta: number
    ok: boolean   // |delta| ≤ 0.10
  }>
}

// ── Helpers privados ───────────────────────────────────────────────────────

/** Lee el bloque economics del invoice (soporta extracted_data.economics y economics_data legacy). */
function getEco(inv: InvoiceRow): BillEconomics | null {
  const ed = inv.extracted_data
  if (ed?.economics && typeof ed.economics === 'object') return ed.economics as BillEconomics
  const legacy = (inv as any).economics_data
  if (legacy && typeof legacy === 'object') {
    if (legacy.economics) return legacy.economics as BillEconomics
    if (Array.isArray((legacy as any).consumo)) return legacy as BillEconomics
  }
  return null
}

function parseDate(s?: string | null): Date | null {
  if (!s) return null
  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  // dd/mm/yyyy
  const m1 = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/)
  if (m1) {
    let [, dd, mm, yy] = m1
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
    const d = new Date(year, Number(mm) - 1, Number(dd))
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function diasFacturados(start?: string | null, end?: string | null): number {
  const s = parseDate(start)
  const e = parseDate(end)
  if (!s || !e) return 30
  const ms = e.getTime() - s.getTime()
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1)
}

function mesYearDeFactura(inv: InvoiceRow): { mes: number; year: number } | null {
  const eco = getEco(inv)
  const dateStr = inv.period_end || eco?.fechaFin || inv.period_start || eco?.fechaInicio
  const d = parseDate(dateStr || null)
  if (!d) return null
  return { mes: d.getMonth(), year: d.getFullYear() }
}

function indexarConsumoPorPeriodo(items?: ConsumoItem[]): Record<string, { kwh: number; precio: number; total: number }> {
  const out: Record<string, { kwh: number; precio: number; total: number }> = {}
  for (const item of items || []) {
    const p = item.periodo
    if (!p) continue
    out[p] = {
      kwh: Number(item.kwh) || 0,
      precio: Number(item.precioKwh) || 0,
      total: Number(item.total) || 0,
    }
  }
  return out
}

// ── Conceptos de luz: clasificación de otrosConceptos ─────────────────────

const reExceso = /exceso/i
const reBono = /bono\s*social/i
const reAlquiler = /alquiler|equipo.*medida|contador/i
const reIee = /impuesto\s*(eléctrico|electrico)/i
const reIva = /iva/i
const reIeh = /impuesto.*(hidrocarbur|hidrocarbar)/i

function sumarConceptos(items: Array<{ concepto?: string; total?: number }> | undefined, pred: (c: string) => boolean): number {
  if (!items) return 0
  return items.reduce((s, o) => pred((o.concepto || '').toLowerCase()) ? s + (Number(o.total) || 0) : s, 0)
}

/**
 * Reduce una factura de LUZ a su resumen numérico.
 * (Reimplementado aquí — no se importa del módulo V1 para no acoplar.)
 */
function resumirLuz(eco: BillEconomics, periodStart?: string | null, periodEnd?: string | null): ResumenFacturaT {
  const totalEnergia = (eco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
  const totalPotencia = (eco.potencia || []).reduce((s, p) => s + (Number(p.total) || 0), 0)

  const excesos = sumarConceptos(eco.otrosConceptos, c => reExceso.test(c))
  const bonoSocial = sumarConceptos(eco.otrosConceptos, c => reBono.test(c))
  const alquiler = sumarConceptos(eco.otrosConceptos, c => reAlquiler.test(c))
  const ieeImporte = sumarConceptos(eco.otrosConceptos, c => reIee.test(c))
  const ivaImporte = sumarConceptos(eco.otrosConceptos, c => reIva.test(c))

  const baseIee = totalEnergia + totalPotencia + excesos + bonoSocial
  const ieePorcentaje = baseIee > 0 ? ieeImporte / baseIee : 0

  const otrosRegulados = (eco.otrosConceptos || [])
    .filter(o => {
      const c = (o.concepto || '').toLowerCase().trim()
      if (reExceso.test(c) || reBono.test(c) || reAlquiler.test(c) || reIee.test(c) || reIva.test(c) || reIeh.test(c)) return false
      if (!c || c === 'otros' || c.startsWith('total ') || c.includes('base imponible')) return false
      return true
    })
    .reduce((s, o) => s + (Number(o.total) || 0), 0)

  const baseImponible = totalEnergia + totalPotencia + excesos + bonoSocial + alquiler + ieeImporte + otrosRegulados
  const ivaPorcentaje = baseImponible > 0 ? ivaImporte / baseImponible : 0
  const totalFactura = Number(eco.totalFactura) || (baseImponible + ivaImporte)

  return {
    totalEnergia, totalPotencia, excesos, bonoSocial, alquiler, otrosRegulados,
    ieePorcentaje, ieeImporte,
    iehImporte: 0, iehPorKwh: 0,
    baseImponible, ivaPorcentaje, ivaImporte, totalFactura,
    dias: diasFacturados(periodStart, periodEnd),
    consumoKwh: Number(eco.consumoTotalKwh) || (eco.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0),
  }
}

/**
 * Reduce una factura de GAS a su resumen numérico.
 */
function resumirGas(eco: BillEconomics, periodStart?: string | null, periodEnd?: string | null): ResumenFacturaT {
  const gp = eco.gasPricing || {}
  const consumoKwh = Number(eco.consumoTotalKwh) || (eco.consumo || []).reduce((s, c) => s + (Number(c.kwh) || 0), 0)
  const totalEnergia = (eco.consumo || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
    || consumoKwh * (Number(gp.precioKwh) || 0)
  const terminoFijo = Number(gp.terminoFijoTotal) || 0
  const iehImporte = Number(gp.impuestoHidrocarbTotal) || 0
  const alquiler = Number(gp.alquilerTotal) || 0
  const ivaImporte = Number(gp.ivaTotal) || 0

  const otrosRegulados = terminoFijo  // término fijo + cargos ATR — concepto regulado
  const baseImponible = totalEnergia + alquiler + otrosRegulados + iehImporte
  const ivaPorcentaje = (() => {
    const decl = gp.ivaPorcentaje != null ? (gp.ivaPorcentaje >= 1 ? gp.ivaPorcentaje / 100 : gp.ivaPorcentaje) : null
    const calc = baseImponible > 0 ? ivaImporte / baseImponible : 0
    // Normalizar al tipo oficial más cercano
    const tipos = [0, 0.05, 0.10, 0.21]
    const ref = decl ?? calc
    let best = tipos[0]; let diff = Math.abs(ref - best)
    for (const t of tipos) {
      const d = Math.abs(ref - t)
      if (d < diff) { diff = d; best = t }
    }
    return best
  })()

  const totalFactura = Number(eco.totalFactura) || (baseImponible + ivaImporte)
  const iehPorKwh = consumoKwh > 0 ? iehImporte / consumoKwh : 0

  return {
    totalEnergia, totalPotencia: 0, excesos: 0, bonoSocial: 0,
    alquiler, otrosRegulados,
    ieePorcentaje: 0, ieeImporte: 0,
    iehImporte, iehPorKwh,
    baseImponible, ivaPorcentaje, ivaImporte, totalFactura,
    dias: diasFacturados(periodStart, periodEnd),
    consumoKwh,
  }
}

function resumirFactura(eco: BillEconomics, periodStart?: string | null, periodEnd?: string | null): ResumenFacturaT {
  const isGas = eco.supply_type === 'gas' || !!eco.gasPricing || /^RL/i.test(eco.tarifa || '')
  return isGas ? resumirGas(eco, periodStart, periodEnd) : resumirLuz(eco, periodStart, periodEnd)
}

// ── Emparejamiento antigua ↔ Voltis ────────────────────────────────────────

/** Empareja facturas históricas y Voltis por mes natural (mismo mes, año a año). */
function emparejarFacturas(invoices: InvoiceRow[]): ParejaMesT[] {
  const historicas: Array<{ inv: InvoiceRow; eco: BillEconomics; mes: number; year: number }> = []
  const voltis: Array<{ inv: InvoiceRow; eco: BillEconomics; mes: number; year: number }> = []

  for (const inv of invoices) {
    const eco = getEco(inv); if (!eco) continue
    const my = mesYearDeFactura(inv); if (!my) continue
    const src = (inv as any).source || 'historica'
    if (src === 'voltis') voltis.push({ inv, eco, mes: my.mes, year: my.year })
    else historicas.push({ inv, eco, mes: my.mes, year: my.year })
  }

  const pares: ParejaMesT[] = []
  for (const v of voltis) {
    // Buscar histórica del MISMO mes del año anterior preferentemente
    let match = historicas.find(h => h.mes === v.mes && h.year === v.year - 1)
    // Fallback: mismo mes cualquier año anterior
    if (!match) match = historicas.find(h => h.mes === v.mes && h.year < v.year)
    if (!match) continue
    pares.push({
      mes: v.mes, year: v.year,
      antigua: match.inv, voltis: v.inv,
      antiguaEco: match.eco, voltisEco: v.eco,
    })
  }
  // Orden cronológico
  pares.sort((a, b) => (a.year - b.year) || (a.mes - b.mes))
  return pares
}

function inferirSupplyType(invoices: InvoiceRow[]): 'luz' | 'gas' {
  for (const inv of invoices) {
    const eco = getEco(inv)
    if (eco?.gasPricing) return 'gas'
    if (eco?.supply_type === 'gas') return 'gas'
    if (/^RL/i.test(eco?.tarifa || '')) return 'gas'
  }
  return 'luz'
}

// ── Escenarios ─────────────────────────────────────────────────────────────

/**
 * S0: pagó real ANTES. Suma directa de las facturas antiguas.
 */
function escenarioS0(pares: ParejaMesT[]): EscenarioT {
  const porMes = pares.map(p => {
    const resumen = resumirFactura(p.antiguaEco, p.antigua.period_start, p.antigua.period_end)
    return { mes: p.mes, year: p.year, total: resumen.totalFactura, resumen }
  })
  return { total: porMes.reduce((s, m) => s + m.total, 0), porMes }
}

/**
 * S3: pagó real AHORA. Suma directa de las facturas Voltis.
 */
function escenarioS3(pares: ParejaMesT[]): EscenarioT {
  const porMes = pares.map(p => {
    const resumen = resumirFactura(p.voltisEco, p.voltis.period_start, p.voltis.period_end)
    return { mes: p.mes, year: p.year, total: resumen.totalFactura, resumen }
  })
  return { total: porMes.reduce((s, m) => s + m.total, 0), porMes }
}

/**
 * S1/S2: contrafactual con consumo de la factura ANTIGUA y precios de la Voltis
 * del MISMO mes. Régimen fiscal: S1 = antigua, S2 = Voltis.
 *
 * LUZ:
 *   - Energía: Σ_p (kWh_antigua_p × precio_voltis_p)
 *     Si Voltis no facturó ese periodo, fallback a precio Voltis medio.
 *   - Potencia: total potencia Voltis (los precios contratados de Voltis
 *     son los que aplicarían al cliente; el coste de potencia no depende
 *     del consumo). Si el cliente cambió de potencia, esto es aproximado.
 *   - Excesos, bono, alquiler, otros regulados: de la Voltis real.
 *   - IEE = tipo (S1: antigua / S2: Voltis) × (energía+potencia+excesos+bono).
 *   - IVA = tipo (S1: antigua / S2: Voltis) × base imponible.
 *
 * GAS:
 *   - Energía: kWh_antigua × precio_kWh_voltis (TV Precio Fijo + Red Local).
 *   - Término fijo Voltis × días Voltis.
 *   - Alquileres y "otros regulados" de Voltis.
 *   - IEH: S1 → €/kWh antigua × kWh antigua; S2 → €/kWh Voltis × kWh antigua.
 *   - IVA: S1 → % antigua; S2 → % Voltis.
 */
function escenarioContrafactual(pares: ParejaMesT[], regimen: 'antigua' | 'voltis'): EscenarioT {
  const porMes: EscenarioParT[] = []

  for (const p of pares) {
    const isGas = !!p.voltisEco.gasPricing || p.voltisEco.supply_type === 'gas'
    const rAntigua = resumirFactura(p.antiguaEco, p.antigua.period_start, p.antigua.period_end)
    const rVoltis = resumirFactura(p.voltisEco, p.voltis.period_start, p.voltis.period_end)

    let totalEnergia = 0
    if (isGas) {
      // Precio €/kWh Voltis: del consumo total (consumoTotalKwh) → totalEnergia/consumo
      const precioVoltis = rVoltis.consumoKwh > 0 ? rVoltis.totalEnergia / rVoltis.consumoKwh : 0
      totalEnergia = rAntigua.consumoKwh * precioVoltis
    } else {
      // Luz: por periodo
      const consumoA = indexarConsumoPorPeriodo(p.antiguaEco.consumo)
      const consumoV = indexarConsumoPorPeriodo(p.voltisEco.consumo)
      // Precio medio Voltis como fallback
      const kWhVoltis = rVoltis.consumoKwh
      const precioMedioVoltis = kWhVoltis > 0 ? rVoltis.totalEnergia / kWhVoltis : 0
      for (const periodo of PERIODOS_LUZ) {
        const ca = consumoA[periodo] || { kwh: 0, precio: 0, total: 0 }
        const cv = consumoV[periodo] || { kwh: 0, precio: 0, total: 0 }
        if (ca.kwh === 0) continue
        const precio = cv.precio > 0 ? cv.precio : precioMedioVoltis
        totalEnergia += ca.kwh * precio
      }
    }

    // Conceptos no dependientes del consumo: de Voltis real
    const totalPotencia = rVoltis.totalPotencia
    const excesos = rVoltis.excesos
    const bonoSocial = rVoltis.bonoSocial
    const alquiler = rVoltis.alquiler
    const otrosRegulados = rVoltis.otrosRegulados

    // IEE (luz)
    const tipoIee = regimen === 'antigua' ? rAntigua.ieePorcentaje : rVoltis.ieePorcentaje
    const baseIee = totalEnergia + totalPotencia + excesos + bonoSocial
    const ieeImporte = isGas ? 0 : baseIee * tipoIee

    // IEH (gas) — aplicado al consumo ANTIGUO con tarifa €/kWh del régimen elegido
    const tipoIeh = regimen === 'antigua' ? rAntigua.iehPorKwh : rVoltis.iehPorKwh
    const iehImporte = isGas ? rAntigua.consumoKwh * tipoIeh : 0

    // Base imponible y IVA
    const baseImponible = totalEnergia + totalPotencia + excesos + bonoSocial + alquiler + otrosRegulados + ieeImporte + iehImporte
    const tipoIva = regimen === 'antigua' ? rAntigua.ivaPorcentaje : rVoltis.ivaPorcentaje
    const ivaImporte = baseImponible * tipoIva
    const totalFactura = baseImponible + ivaImporte

    const resumen: ResumenFacturaT = {
      totalEnergia, totalPotencia, excesos, bonoSocial,
      alquiler, otrosRegulados,
      ieePorcentaje: isGas ? 0 : tipoIee,
      ieeImporte,
      iehImporte,
      iehPorKwh: tipoIeh,
      baseImponible,
      ivaPorcentaje: tipoIva,
      ivaImporte,
      totalFactura,
      dias: rVoltis.dias,
      consumoKwh: rAntigua.consumoKwh,
    }
    porMes.push({ mes: p.mes, year: p.year, total: totalFactura, resumen })
  }

  return { total: porMes.reduce((s, m) => s + m.total, 0), porMes }
}

// ── Cambios normativos ─────────────────────────────────────────────────────

function detectarCambiosNormativos(pares: ParejaMesT[], supplyType: 'luz' | 'gas'): CambioNormativoMes[] {
  const TOLERANCIA = 0.005   // ±0,5 pp se considera mismo tipo (margen de redondeo)
  return pares.map(p => {
    const rA = resumirFactura(p.antiguaEco, p.antigua.period_start, p.antigua.period_end)
    const rV = resumirFactura(p.voltisEco, p.voltis.period_start, p.voltis.period_end)
    return {
      mes: p.mes, year: p.year,
      ivaAntigua: rA.ivaPorcentaje,
      ivaVoltis: rV.ivaPorcentaje,
      ivaCambio: Math.abs(rA.ivaPorcentaje - rV.ivaPorcentaje) > TOLERANCIA,
      ieAntigua: supplyType === 'luz' ? rA.ieePorcentaje : undefined,
      ieVoltis: supplyType === 'luz' ? rV.ieePorcentaje : undefined,
      ieCambio: supplyType === 'luz' && Math.abs(rA.ieePorcentaje - rV.ieePorcentaje) > TOLERANCIA,
      iehAntigua: supplyType === 'gas' ? rA.iehPorKwh : undefined,
      iehVoltis: supplyType === 'gas' ? rV.iehPorKwh : undefined,
      iehCambio: supplyType === 'gas' && Math.abs(rA.iehPorKwh - rV.iehPorKwh) > 0.00005,  // ±0,05 €/MWh
    }
  })
}

// ── Validación por factura ────────────────────────────────────────────────

function validar(pares: ParejaMesT[]) {
  const out: ResultadoTripartito['validacionFacturas'] = []
  for (const p of pares) {
    const rA = resumirFactura(p.antiguaEco, p.antigua.period_start, p.antigua.period_end)
    const rV = resumirFactura(p.voltisEco, p.voltis.period_start, p.voltis.period_end)
    const decA = Number(p.antiguaEco.totalFactura) || rA.totalFactura
    const decV = Number(p.voltisEco.totalFactura) || rV.totalFactura
    const deltaA = rA.totalFactura - decA
    const deltaV = rV.totalFactura - decV
    out.push({
      invoiceId: p.antigua.id, side: 'antigua',
      totalDeclarado: decA, totalRecalculado: rA.totalFactura,
      delta: deltaA, ok: Math.abs(deltaA) <= 0.10,
    })
    out.push({
      invoiceId: p.voltis.id, side: 'voltis',
      totalDeclarado: decV, totalRecalculado: rV.totalFactura,
      delta: deltaV, ok: Math.abs(deltaV) <= 0.10,
    })
  }
  return out
}

// ── Función pública principal ─────────────────────────────────────────────

export function computarTripartita(args: {
  invoices: InvoiceRow[]
  supplyTypeHint?: 'luz' | 'gas'
}): ResultadoTripartito {
  const supplyType = args.supplyTypeHint || inferirSupplyType(args.invoices)
  const pares = emparejarFacturas(args.invoices)

  // Metadatos
  const firstEco = pares[0] ? pares[0].voltisEco : (args.invoices.length > 0 ? getEco(args.invoices[0]) : null)
  const cups = firstEco?.cups || null
  const tarifa = firstEco?.tarifa || null

  // Comercializadoras
  let comercializadoraAntigua: string | null = null
  let comercializadoraVoltis: string | null = null
  for (const p of pares) {
    if (!comercializadoraAntigua && p.antiguaEco.comercializadora) comercializadoraAntigua = p.antiguaEco.comercializadora
    if (!comercializadoraVoltis && p.voltisEco.comercializadora) comercializadoraVoltis = p.voltisEco.comercializadora
    if (comercializadoraAntigua && comercializadoraVoltis) break
  }

  const S0 = escenarioS0(pares)
  const S3 = escenarioS3(pares)
  const S1 = escenarioContrafactual(pares, 'antigua')
  const S2 = escenarioContrafactual(pares, 'voltis')

  const ahorroTarifa = S0.total - S1.total
  const ahorroNormativo = S1.total - S2.total
  const ahorroConsumo = S2.total - S3.total
  const ahorroTotal = S0.total - S3.total
  const residual = Math.abs(ahorroTotal - (ahorroTarifa + ahorroNormativo + ahorroConsumo))

  const descomposicion: DescomposicionT = {
    S0: S0.total, S1: S1.total, S2: S2.total, S3: S3.total,
    ahorroTotal, ahorroTarifa, ahorroNormativo, ahorroConsumo,
    pctTotal: S0.total > 0 ? (ahorroTotal / S0.total) * 100 : 0,
    pctTarifa: S0.total > 0 ? (ahorroTarifa / S0.total) * 100 : 0,
    pctNormativo: S0.total > 0 ? (ahorroNormativo / S0.total) * 100 : 0,
    pctConsumo: S0.total > 0 ? (ahorroConsumo / S0.total) * 100 : 0,
    residualVerificacion: residual,
  }

  const cambiosNormativos = detectarCambiosNormativos(pares, supplyType)
  const validacionFacturas = validar(pares)

  const cobertura = {
    mesesComparados: pares.length,
    desde: pares.length > 0 ? { mes: pares[0].mes, year: pares[0].year } : null,
    hasta: pares.length > 0 ? { mes: pares[pares.length - 1].mes, year: pares[pares.length - 1].year } : null,
  }

  return {
    supplyType, cups, tarifa,
    comercializadoraAntigua, comercializadoraVoltis,
    pares, S0, S1, S2, S3,
    descomposicion, cambiosNormativos, validacionFacturas,
    cobertura,
  }
}
