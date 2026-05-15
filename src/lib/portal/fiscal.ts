/**
 * Portal Cliente v2 — Fiscalidad energética por periodos.
 *
 * Recopila los tipos impositivos vigentes en cada momento para luz y gas,
 * con los matices que aplican a grandes consumidores (potencia > 10 kW).
 *
 * Fuentes:
 *  - IE Eléctrico: 5,11 % general; 0,5 % temporal 2024-2026 según RDL
 *  - IVA Luz: 21 % general; 10 % temporal sólo si potencia < 10 kW
 *  - IEH Gas: 0,65 €/GJ general; 0,30 €/GJ temporal 2024-2026
 *  - IVA Gas: 21 % general; 10 % temporal en periodos concretos
 *
 * Cada entrada tiene un rango de fechas [from, to] con los tipos
 * aplicables. Cuando entra una factura, miramos en qué tramo cae su
 * `period_end` y aplicamos los tipos correspondientes.
 *
 * La fuente de verdad es BOE — esta tabla se mantiene a mano. Si cambia
 * la normativa, se actualiza este archivo y todo el motor se recalcula.
 */

export interface FiscalPeriod {
  from: string                // YYYY-MM-DD inclusive
  to: string                  // YYYY-MM-DD inclusive
  ieLuzPct: number            // % aplicado sobre la base imponible luz
  ivaLuzPct: number           // % IVA luz para potencia > 10 kW
  ivaLuzReducidaPct: number   // % IVA luz para potencia < 10 kW (rebaja temporal)
  iehGasEurGj: number         // €/GJ
  ivaGasPct: number           // % IVA gas
}

// Tabla histórica + actual. Los valores reales DEL CLIENTE Unice Toys
// están aquí codificados — actualizar conforme cambia la normativa.
//
// IMPORTANTE: estas son fechas DE FIN DE PERIODO DE FACTURA. Una factura
// emitida en abril 2026 con period_end en marzo 2026 aplica fiscalidad
// del tramo en el que cae el period_end.
export const FISCAL_PERIODS: FiscalPeriod[] = [
  // 2025 — fiscalidad temporal reducida (toda la dynia)
  {
    from: '2025-01-01', to: '2025-12-31',
    ieLuzPct: 5.1127, ivaLuzPct: 21, ivaLuzReducidaPct: 21,
    iehGasEurGj: 0.65, ivaGasPct: 21,
  },
  // Enero–Febrero 2026 — IE Luz 5,11 % (final del tramo regular)
  {
    from: '2026-01-01', to: '2026-02-28',
    ieLuzPct: 5.1127, ivaLuzPct: 21, ivaLuzReducidaPct: 10,
    iehGasEurGj: 0.65, ivaGasPct: 21,
  },
  // Marzo 2026 — IE Luz baja al 0,5 %
  {
    from: '2026-03-01', to: '2026-03-31',
    ieLuzPct: 0.5, ivaLuzPct: 21, ivaLuzReducidaPct: 10,
    iehGasEurGj: 0.30, ivaGasPct: 21,
  },
  // Abril–Mayo 2026 — RDL 7/2026: IE Luz 0,5 %, IEH gas 0,30, IVA gas 10
  {
    from: '2026-04-01', to: '2026-05-31',
    ieLuzPct: 0.5, ivaLuzPct: 21, ivaLuzReducidaPct: 10,
    iehGasEurGj: 0.30, ivaGasPct: 10,
  },
  // Junio 2026 — desactivación anticipada (BOE 14 mayo 2026)
  {
    from: '2026-06-01', to: '2026-06-30',
    ieLuzPct: 5.1127, ivaLuzPct: 21, ivaLuzReducidaPct: 21,
    iehGasEurGj: 0.65, ivaGasPct: 21,
  },
  // Julio–Diciembre 2026 — vuelta a régimen normal
  {
    from: '2026-07-01', to: '2026-12-31',
    ieLuzPct: 5.1127, ivaLuzPct: 21, ivaLuzReducidaPct: 21,
    iehGasEurGj: 0.65, ivaGasPct: 21,
  },
]

/** Encuentra el periodo fiscal que aplica a una fecha. */
export function fiscalAt(date: Date | string): FiscalPeriod {
  const d = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10)
  for (const fp of FISCAL_PERIODS) {
    if (d >= fp.from && d <= fp.to) return fp
  }
  // Fallback al último periodo conocido — evita crash si falta un tramo
  return FISCAL_PERIODS[FISCAL_PERIODS.length - 1]
}

/**
 * Tipo de IVA luz que aplica al cliente dado.
 *   potenciaMaxKw < 10 → puede recibir la rebaja temporal cuando esté activa
 *   potenciaMaxKw ≥ 10 → mantiene 21 % siempre (gran consumidor)
 */
export function ivaLuzPctFor(potenciaMaxKw: number, date: Date | string): number {
  const fp = fiscalAt(date)
  return potenciaMaxKw < 10 ? fp.ivaLuzReducidaPct : fp.ivaLuzPct
}
