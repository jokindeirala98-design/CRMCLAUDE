/**
 * Portal v2 — Inferencia automática de precios Voltis a partir de facturas.
 *
 * En lugar de pedir al admin que rellene la tabla `voltis_contracts` a
 * mano, derivamos los precios contractuales directamente de las facturas
 * Voltis ya extraídas con Gemini. Esto es robusto porque:
 *
 *   precio_kwh_pX = coste_consumo_pX_factura / kwh_consumido_pX_factura
 *
 * y como los precios contractuales son **fijos** durante todo el periodo
 * de vigencia, todas las facturas del cliente devuelven el mismo número.
 * Si tenemos varias facturas, las promediamos para amortiguar pequeños
 * errores de redondeo en la extracción.
 *
 * IMPORTANTE: estos precios incluyen `peaje + precio fijo` ya combinados,
 * porque las facturas españolas no los desglosan factura a factura.
 * Esa es la unidad útil para simular: "cuánto pagaría yo por 1 kWh en P3".
 */
import type { LuzContract, GasContract } from './billing-engine'

export interface InferenceInput {
  /** Facturas con extracted_data.economics ya parseado. */
  invoices: Array<{
    id: string
    supply_id: string
    source: string | null
    period_start: string | null
    period_end: string | null
    extracted_data: any
  }>
  /** Tipo de cada supply (luz/gas). Si no se proporciona, intentamos
   *  detectar por la presencia de gasPricing en las facturas, pero
   *  esto es menos fiable (algunos extractores ponen gasPricing en
   *  facturas de luz por error). */
  supplyTypes?: Map<string, 'luz' | 'gas'>
}

export interface InferredContract {
  supplyId: string
  type: 'luz' | 'gas'
  luz?: LuzContract
  gas?: GasContract
  /** Cuántas facturas Voltis hemos usado para promediar. */
  samples: number
  /** Confianza: 'high' (≥2 facturas con valores consistentes), 'medium' (1), 'low' (no Voltis). */
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Para cada supply, intentamos inferir el contrato Voltis a partir de las
 * facturas con source='voltis'. Si no hay ninguna, devolvemos null para
 * ese supply (el portal mostrará "aún sin contrato").
 */
export function inferContractsFromInvoices(input: InferenceInput): Map<string, InferredContract> {
  const result = new Map<string, InferredContract>()

  // Agrupamos facturas Voltis por supply
  const bySupply = new Map<string, typeof input.invoices>()
  for (const inv of input.invoices) {
    if ((inv.source || '').toLowerCase() !== 'voltis') continue
    if (!inv.extracted_data?.economics) continue
    const arr = bySupply.get(inv.supply_id) || []
    arr.push(inv)
    bySupply.set(inv.supply_id, arr)
  }

  for (const [supplyId, invs] of bySupply.entries()) {
    // Preferimos el tipo del supply en BD (más fiable). Si no se proporciona,
    // detectamos por gasPricing presente Y no-null (algunos extractores
    // ponen la clave a null incluso para luz).
    let type: 'luz' | 'gas' | undefined = input.supplyTypes?.get(supplyId)
    if (!type) {
      const gp = invs[0].extracted_data?.economics?.gasPricing
      type = gp && typeof gp === 'object' ? 'gas' : 'luz'
    }
    if (type === 'gas') {
      result.set(supplyId, inferGasContract(supplyId, invs))
    } else {
      result.set(supplyId, inferLuzContract(supplyId, invs))
    }
  }

  return result
}

// ── Luz ──────────────────────────────────────────────────────────────────

function inferLuzContract(supplyId: string, invs: any[]): InferredContract {
  // Para cada periodo P1..P6, calculamos precio_kwh y precio_kw_dia
  // promediando todas las facturas que tengan ese periodo.
  const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
  const kwhSums: Record<string, { sum: number; n: number }> = {}
  const kwSums: Record<string, { sum: number; n: number }> = {}

  for (const inv of invs) {
    const eco = inv.extracted_data?.economics
    if (!eco) continue
    for (const c of (eco.consumo || [])) {
      const p = (c.periodo || '').toUpperCase()
      if (!PERIODS.includes(p)) continue
      const kwh = Number(c.kwh) || 0
      const total = Number(c.total) || 0
      // El extractor escribe `precioKwh` (más reciente) o `precio` (legacy).
      const precio = Number(c.precioKwh) || Number(c.precio) || (kwh > 0 ? total / kwh : 0)
      if (precio > 0) {
        kwhSums[p] = kwhSums[p] || { sum: 0, n: 0 }
        kwhSums[p].sum += precio; kwhSums[p].n += 1
      }
    }
    for (const pot of (eco.potencia || [])) {
      const p = (pot.periodo || '').toUpperCase()
      if (!PERIODS.includes(p)) continue
      const kw = Number(pot.kw) || 0
      const dias = Number(pot.dias) || 1
      const total = Number(pot.total) || 0
      const precio = Number(pot.precioKwDia) || Number(pot.precio) || (kw > 0 && dias > 0 ? total / (kw * dias) : 0)
      if (precio > 0) {
        kwSums[p] = kwSums[p] || { sum: 0, n: 0 }
        kwSums[p].sum += precio; kwSums[p].n += 1
      }
    }
  }

  const avg = (m: typeof kwhSums, k: string): number => m[k] && m[k].n > 0 ? m[k].sum / m[k].n : 0

  const luz: LuzContract = {
    precioKwhP1: avg(kwhSums, 'P1'),
    precioKwhP2: avg(kwhSums, 'P2'),
    precioKwhP3: avg(kwhSums, 'P3'),
    precioKwhP4: avg(kwhSums, 'P4'),
    precioKwhP5: avg(kwhSums, 'P5'),
    precioKwhP6: avg(kwhSums, 'P6'),
    precioKwDiaP1: avg(kwSums, 'P1'),
    precioKwDiaP2: avg(kwSums, 'P2'),
    precioKwDiaP3: avg(kwSums, 'P3'),
    precioKwDiaP4: avg(kwSums, 'P4'),
    precioKwDiaP5: avg(kwSums, 'P5'),
    precioKwDiaP6: avg(kwSums, 'P6'),
  }

  return {
    supplyId,
    type: 'luz',
    luz,
    samples: invs.length,
    confidence: invs.length >= 2 ? 'high' : 'medium',
  }
}

// ── Gas ──────────────────────────────────────────────────────────────────

function inferGasContract(supplyId: string, invs: any[]): InferredContract {
  let sumKwh = 0, nKwh = 0
  let sumFijo = 0, nFijo = 0
  let sumPeaje = 0, nPeaje = 0

  for (const inv of invs) {
    const eco = inv.extracted_data?.economics
    if (!eco) continue
    const gp = eco.gasPricing
    if (gp) {
      const precioKwh = Number(gp.precioKwh) || 0
      const peajeKwh = Number(gp.peajeKwh) || 0
      const fijoDia = Number(gp.terminoFijoDiario) || 0
      if (precioKwh > 0) { sumKwh += precioKwh; nKwh++ }
      if (peajeKwh > 0) { sumPeaje += peajeKwh; nPeaje++ }
      if (fijoDia > 0) { sumFijo += fijoDia; nFijo++ }
    } else {
      // Fallback: derivar de costeNetoConsumo / consumoTotalKwh
      const kwh = Number(eco.consumoTotalKwh) || 0
      const coste = Number(eco.costeNetoConsumo) || 0
      if (kwh > 0 && coste > 0) {
        sumKwh += coste / kwh; nKwh++
      }
    }
  }

  const gas: GasContract = {
    precioKwhGas: nKwh > 0 ? sumKwh / nKwh : 0,
    peajeKwhGas: nPeaje > 0 ? sumPeaje / nPeaje : 0,
    terminoFijoDiarioGas: nFijo > 0 ? sumFijo / nFijo : 0,
  }

  return {
    supplyId,
    type: 'gas',
    gas,
    samples: invs.length,
    confidence: invs.length >= 2 ? 'high' : 'medium',
  }
}
