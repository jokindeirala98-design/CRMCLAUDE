/**
 * Voltis 2.0TD tariff pricing — energy (€/kWh) and power (€/kW·día).
 *
 * Energy period mapping for 2.0TD:
 *   P1 = Punta  (peak hours, weekdays)
 *   P2 = Llano  (shoulder hours)
 *   P3 = Valle  (off-peak, nights & weekends)
 *
 * Power period mapping for 2.0TD:
 *   P1 = Punta  (supervised peak kW)
 *   P2 = Valle  (supervised off-peak kW)
 */

export const VOLTIS_TARIFFS_2TD = {
  tramos: {
    name: 'Tramos Horarios',
    shortName: 'TRAMOS',
    energy: { P1: 0.171, P2: 0.104, P3: 0.080 },   // punta / llano / valle €/kWh
    power:  { P1: 0.089434, P2: 0.089434 },           // punta / valle €/kW·día
  },
  '24h': {
    name: 'Tarifa 24H Fija',
    shortName: '24H FIJA',
    energy: { P1: 0.119, P2: 0.119, P3: 0.119 },
    power:  { P1: 0.089434, P2: 0.089434 },
  },
  mercado: {
    name: 'Precio Mercado',
    shortName: 'MERCADO',
    energy: { P1: 0.182, P2: 0.108, P3: 0.086 },
    power:  { P1: 0.075903, P2: 0.001988 },
  },
} as const

export type VoltisKey2TD = keyof typeof VOLTIS_TARIFFS_2TD

/** IVA applied to electricity bills in Spain */
export const IVA = 1.21

/**
 * Compute annual comparison for a single Voltis tariff vs. current prices.
 *
 * @param consumo      Annual kWh by period: { P1, P2, P3 }
 * @param potencia     Contracted kW by period: { P1, P2 }
 * @param currentEnergyPrice  Current avg €/kWh (flat rate applied to all periods)
 * @param currentPowerP1      Current €/kW·día for power period 1
 * @param currentPowerP2      Current €/kW·día for power period 2
 * @param tariffKey    Which Voltis tariff to compare against
 */
export function compute2TDSavings(
  consumo: { P1: number; P2: number; P3: number },
  potencia: { P1: number; P2: number },
  currentEnergyPrice: number,
  currentPowerP1: number,
  currentPowerP2: number,
  tariffKey: VoltisKey2TD,
) {
  const t = VOLTIS_TARIFFS_2TD[tariffKey]
  const totalKwh = consumo.P1 + consumo.P2 + consumo.P3

  // ── Current annual costs (ex-IVA) ──────────────────────────────────────────
  const currentEnergyNet = totalKwh * currentEnergyPrice
  const currentPowerNet  = potencia.P1 * currentPowerP1 * 365
                         + potencia.P2 * currentPowerP2 * 365

  // ── New annual costs (ex-IVA) ───────────────────────────────────────────────
  const newEnergyNet = consumo.P1 * t.energy.P1
                     + consumo.P2 * t.energy.P2
                     + consumo.P3 * t.energy.P3

  const newPowerNet  = potencia.P1 * t.power.P1 * 365
                     + potencia.P2 * t.power.P2 * 365

  // ── With IVA ────────────────────────────────────────────────────────────────
  const currentEnergy = currentEnergyNet * IVA
  const currentPower  = currentPowerNet  * IVA
  const newEnergy     = newEnergyNet     * IVA
  const newPower      = newPowerNet      * IVA

  const currentTotal = currentEnergy + currentPower
  const newTotal     = newEnergy + newPower

  // ── Savings (positive = saving money) ───────────────────────────────────────
  const energySaving = currentEnergy - newEnergy
  const powerSaving  = currentPower  - newPower
  const totalAnnual  = energySaving + powerSaving
  const totalMonthly = totalAnnual / 12

  return {
    current: {
      energyNet: currentEnergyNet,
      powerNet:  currentPowerNet,
      energy:    currentEnergy,
      power:     currentPower,
      total:     currentTotal,
      // Per period breakdown
      energyP1: consumo.P1 * currentEnergyPrice * IVA,
      energyP2: consumo.P2 * currentEnergyPrice * IVA,
      energyP3: consumo.P3 * currentEnergyPrice * IVA,
      powerP1:  potencia.P1 * currentPowerP1 * 365 * IVA,
      powerP2:  potencia.P2 * currentPowerP2 * 365 * IVA,
    },
    nuevo: {
      energyNet: newEnergyNet,
      powerNet:  newPowerNet,
      energy:    newEnergy,
      power:     newPower,
      total:     newTotal,
      // Per period breakdown
      energyP1: consumo.P1 * t.energy.P1 * IVA,
      energyP2: consumo.P2 * t.energy.P2 * IVA,
      energyP3: consumo.P3 * t.energy.P3 * IVA,
      powerP1:  potencia.P1 * t.power.P1 * 365 * IVA,
      powerP2:  potencia.P2 * t.power.P2 * 365 * IVA,
    },
    savings: {
      energy:       energySaving,
      power:        powerSaving,
      totalAnnual,
      totalMonthly,
    },
  }
}
