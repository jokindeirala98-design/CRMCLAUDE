/**
 * Precios de acceso a red (peajes) por tarifa según BOE.
 * Unidad: €/kW·día para potencia.
 *
 * Fuente: CNMC / BOE
 * Actualizar anualmente cuando cambie la resolución.
 */

export type TariffType = '2.0TD' | '3.0TD' | '6.1TD' | '6.2TD' | '6.3TD' | '6.4TD'

export interface PeriodBOEPrice {
  period: string   // 'p1', 'p2', ...
  pricePerKwDay: number
  pricePerKwMonth: number
}

// Precios €/kW·día por tarifa y año BOE
const BOE_PRICES: Record<TariffType, Record<2025 | 2026, PeriodBOEPrice[]>> = {
  '2.0TD': {
    2025: [
      { period: 'p1', pricePerKwDay: 0.038904, pricePerKwMonth: 14.200 },
      { period: 'p2', pricePerKwDay: 0.005832, pricePerKwMonth: 2.129 },
      { period: 'p3', pricePerKwDay: 0.002097, pricePerKwMonth: 0.765 },
    ],
    2026: [
      { period: 'p1', pricePerKwDay: 0.040198, pricePerKwMonth: 14.672 },
      { period: 'p2', pricePerKwDay: 0.006026, pricePerKwMonth: 2.200 },
      { period: 'p3', pricePerKwDay: 0.002168, pricePerKwMonth: 0.791 },
    ],
  },
  '3.0TD': {
    2025: [
      { period: 'p1', pricePerKwDay: 0.053859, pricePerKwMonth: 19.659 },
      { period: 'p2', pricePerKwDay: 0.028087, pricePerKwMonth: 10.252 },
      { period: 'p3', pricePerKwDay: 0.011678, pricePerKwMonth: 4.263 },
      { period: 'p4', pricePerKwDay: 0.010086, pricePerKwMonth: 3.681 },
      { period: 'p5', pricePerKwDay: 0.006379, pricePerKwMonth: 2.328 },
      { period: 'p6', pricePerKwDay: 0.003716, pricePerKwMonth: 1.356 },
    ],
    2026: [
      { period: 'p1', pricePerKwDay: 0.055827, pricePerKwMonth: 20.377 },
      { period: 'p2', pricePerKwDay: 0.029089, pricePerKwMonth: 10.618 },
      { period: 'p3', pricePerKwDay: 0.012278, pricePerKwMonth: 4.482 },
      { period: 'p4', pricePerKwDay: 0.010647, pricePerKwMonth: 3.886 },
      { period: 'p5', pricePerKwDay: 0.006887, pricePerKwMonth: 2.514 },
      { period: 'p6', pricePerKwDay: 0.003951, pricePerKwMonth: 1.442 },
    ],
  },
  '6.1TD': {
    2025: [
      { period: 'p1', pricePerKwDay: 0.078882, pricePerKwMonth: 28.792 },
      { period: 'p2', pricePerKwDay: 0.041308, pricePerKwMonth: 15.078 },
      { period: 'p3', pricePerKwDay: 0.017970, pricePerKwMonth: 6.559 },
      { period: 'p4', pricePerKwDay: 0.014170, pricePerKwMonth: 5.172 },
      { period: 'p5', pricePerKwDay: 0.005295, pricePerKwMonth: 1.933 },
      { period: 'p6', pricePerKwDay: 0.002510, pricePerKwMonth: 0.916 },
    ],
    2026: [
      { period: 'p1', pricePerKwDay: 0.081083, pricePerKwMonth: 29.595 },
      { period: 'p2', pricePerKwDay: 0.042506, pricePerKwMonth: 15.515 },
      { period: 'p3', pricePerKwDay: 0.018635, pricePerKwMonth: 6.802 },
      { period: 'p4', pricePerKwDay: 0.014778, pricePerKwMonth: 5.394 },
      { period: 'p5', pricePerKwDay: 0.005822, pricePerKwMonth: 2.125 },
      { period: 'p6', pricePerKwDay: 0.002751, pricePerKwMonth: 1.004 },
    ],
  },
  '6.2TD': {
    2025: [
      { period: 'p1', pricePerKwDay: 0.078882, pricePerKwMonth: 28.792 },
      { period: 'p2', pricePerKwDay: 0.041308, pricePerKwMonth: 15.078 },
      { period: 'p3', pricePerKwDay: 0.017970, pricePerKwMonth: 6.559 },
      { period: 'p4', pricePerKwDay: 0.014170, pricePerKwMonth: 5.172 },
      { period: 'p5', pricePerKwDay: 0.005295, pricePerKwMonth: 1.933 },
      { period: 'p6', pricePerKwDay: 0.002510, pricePerKwMonth: 0.916 },
    ],
    2026: [
      { period: 'p1', pricePerKwDay: 0.081083, pricePerKwMonth: 29.595 },
      { period: 'p2', pricePerKwDay: 0.042506, pricePerKwMonth: 15.515 },
      { period: 'p3', pricePerKwDay: 0.018635, pricePerKwMonth: 6.802 },
      { period: 'p4', pricePerKwDay: 0.014778, pricePerKwMonth: 5.394 },
      { period: 'p5', pricePerKwDay: 0.005822, pricePerKwMonth: 2.125 },
      { period: 'p6', pricePerKwDay: 0.002751, pricePerKwMonth: 1.004 },
    ],
  },
  '6.3TD': {
    2025: [
      { period: 'p1', pricePerKwDay: 0.078882, pricePerKwMonth: 28.792 },
      { period: 'p2', pricePerKwDay: 0.041308, pricePerKwMonth: 15.078 },
      { period: 'p3', pricePerKwDay: 0.017970, pricePerKwMonth: 6.559 },
      { period: 'p4', pricePerKwDay: 0.014170, pricePerKwMonth: 5.172 },
      { period: 'p5', pricePerKwDay: 0.005295, pricePerKwMonth: 1.933 },
      { period: 'p6', pricePerKwDay: 0.002510, pricePerKwMonth: 0.916 },
    ],
    2026: [
      { period: 'p1', pricePerKwDay: 0.081083, pricePerKwMonth: 29.595 },
      { period: 'p2', pricePerKwDay: 0.042506, pricePerKwMonth: 15.515 },
      { period: 'p3', pricePerKwDay: 0.018635, pricePerKwMonth: 6.802 },
      { period: 'p4', pricePerKwDay: 0.014778, pricePerKwMonth: 5.394 },
      { period: 'p5', pricePerKwDay: 0.005822, pricePerKwMonth: 2.125 },
      { period: 'p6', pricePerKwDay: 0.002751, pricePerKwMonth: 1.004 },
    ],
  },
  '6.4TD': {
    2025: [
      { period: 'p1', pricePerKwDay: 0.078882, pricePerKwMonth: 28.792 },
      { period: 'p2', pricePerKwDay: 0.041308, pricePerKwMonth: 15.078 },
      { period: 'p3', pricePerKwDay: 0.017970, pricePerKwMonth: 6.559 },
      { period: 'p4', pricePerKwDay: 0.014170, pricePerKwMonth: 5.172 },
      { period: 'p5', pricePerKwDay: 0.005295, pricePerKwMonth: 1.933 },
      { period: 'p6', pricePerKwDay: 0.002510, pricePerKwMonth: 0.916 },
    ],
    2026: [
      { period: 'p1', pricePerKwDay: 0.081083, pricePerKwMonth: 29.595 },
      { period: 'p2', pricePerKwDay: 0.042506, pricePerKwMonth: 15.515 },
      { period: 'p3', pricePerKwDay: 0.018635, pricePerKwMonth: 6.802 },
      { period: 'p4', pricePerKwDay: 0.014778, pricePerKwMonth: 5.394 },
      { period: 'p5', pricePerKwDay: 0.005822, pricePerKwMonth: 2.125 },
      { period: 'p6', pricePerKwDay: 0.002751, pricePerKwMonth: 1.004 },
    ],
  },
}

export function normalizeTariff(raw: string): TariffType {
  const t = raw.toUpperCase().replace(/\s/g, '')
  if (t.includes('6.4')) return '6.4TD'
  if (t.includes('6.3')) return '6.3TD'
  if (t.includes('6.2')) return '6.2TD'
  if (t.includes('6.1')) return '6.1TD'
  if (t.includes('3.0') || t.includes('3,0')) return '3.0TD'
  return '2.0TD'
}

export function getBOEPrices(tariff: string, year: 2025 | 2026 = 2026): PeriodBOEPrice[] {
  const normalized = normalizeTariff(tariff)
  return BOE_PRICES[normalized]?.[year] ?? BOE_PRICES['3.0TD'][year]
}

export function getPeriodCount(tariff: string): number {
  return getBOEPrices(tariff).length
}
