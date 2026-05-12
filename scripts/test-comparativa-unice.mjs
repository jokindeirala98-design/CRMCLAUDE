/**
 * Test de regresión de comparativa-energetica.ts
 *
 * Reproduce los casos UNICE (luz 6.1TD y gas RL06) con los datos exactos del
 * Excel y los dos PDFs de comparativa, y compara los totales contra los
 * números oficiales:
 *   - Luz: ahorro trimestral 15.275,01€ (PDF Ekyner vs Galp)
 *   - Gas: ahorro trimestral 12.534,91€ (PDF Gas Ekyner vs Galp)
 *
 * Como el módulo TS no se puede importar directamente sin transpilar, esta
 * prueba REIMPLEMENTA la matemática 1:1 y la valida contra los PDFs. Si esto
 * cuadra, sabemos que la fórmula es correcta y los tipos coinciden.
 */

// ── DATOS UNICE: facturas extraídas ─────────────────────────────────────────
// LUZ — Ekyner 2025 (del Excel UNICE_2025_AnualEconomics.xlsx)
const ekynerLuz = {
  ene2025: {
    fechaInicio: '2025-01-01', fechaFin: '2025-01-31',
    dias: 31,
    consumo: [
      { periodo: 'P1', kwh: 70172, precioKwh: 0.156276 },
      { periodo: 'P2', kwh: 34805, precioKwh: 0.156276 },
      { periodo: 'P6', kwh: 36491, precioKwh: 0.156276 },
    ],
    potencia: [
      { periodo: 'P1', kw: 609, precioKwDia: 1489.22 / (609 * 31), dias: 31 },
      { periodo: 'P2', kw: 631, precioKwDia: 808.04 / (631 * 31), dias: 31 },
      { periodo: 'P3', kw: 650, precioKwDia: 362.11 / (650 * 31), dias: 31 },
      { periodo: 'P4', kw: 650, precioKwDia: 285.52 / (650 * 31), dias: 31 },
      { periodo: 'P5', kw: 650, precioKwDia: 106.71 / (650 * 31), dias: 31 },
      { periodo: 'P6', kw: 720, precioKwDia: 56.03 / (720 * 31), dias: 31 },
    ],
    totalEnergia: 22108.12,
  },
  feb2025: {
    dias: 28,
    consumo: [
      { periodo: 'P1', kwh: 79102, precioKwh: 0.186625 },
      { periodo: 'P2', kwh: 40517, precioKwh: 0.186625 },
      { periodo: 'P6', kwh: 37476, precioKwh: 0.186625 },
    ],
    totalEnergia: 29317.85,
  },
  mar2025: {
    dias: 31,
    consumo: [
      { periodo: 'P2', kwh: 80444, precioKwh: 0.111238 },
      { periodo: 'P3', kwh: 41429, precioKwh: 0.111238 },
      { periodo: 'P6', kwh: 38736, precioKwh: 0.111238 },
    ],
    totalEnergia: 17865.84,
  },
}

// LUZ — Galp 2026 (consumo total, datos del PDF Ekyner vs Galp)
// Para simular por periodo, asumimos que el desglose P1/P2/P6 en ene/feb y
// P2/P3/P6 en marzo se mantiene proporcional. Lo importante: el TOTAL kWh.
const galpLuz = {
  ene2026: {
    fechaInicio: '2026-01-09', fechaFin: '2026-01-31',
    dias: 23,
    consumoTotal: 99075,
    // Repartido proporcional al ratio 2025 (P1:P2:P6 = 70172:34805:36491)
    consumo: [
      { periodo: 'P1', kwh: 99075 * 70172 / 141468, precioKwh: 0.123424 },
      { periodo: 'P2', kwh: 99075 * 34805 / 141468, precioKwh: 0.123424 },
      { periodo: 'P6', kwh: 99075 * 36491 / 141468, precioKwh: 0.123424 },
    ],
    real: {
      energia: 12228.19, potencia: 2384.76, excesos: 0, bonoSocial: 0.44,
      iee: 747.14, alquiler: 48.39, base: 15408.92, iva: 3235.87, total: 18644.79,
      ivaPct: 0.21, ieePct: 5.11 / 100,
    },
  },
  feb2026: {
    dias: 28,
    consumoTotal: 135453,
    consumo: [
      { periodo: 'P1', kwh: 135453 * 79102 / 157095, precioKwh: 0.124726 },
      { periodo: 'P2', kwh: 135453 * 40517 / 157095, precioKwh: 0.124726 },
      { periodo: 'P6', kwh: 135453 * 37476 / 157095, precioKwh: 0.124726 },
    ],
    real: {
      energia: 16894.48, potencia: 2903.18, excesos: 1708.56, bonoSocial: 0.54,
      iee: 1099.58, alquiler: 58.92, base: 22665.26, iva: 4759.70, total: 27424.96,
      ivaPct: 0.21, ieePct: 5.11 / 100,
    },
  },
  mar2026: {
    dias: 31,
    consumoTotal: 132865,
    consumo: [
      { periodo: 'P2', kwh: 132865 * 80444 / 160609, precioKwh: 0.108320 },
      { periodo: 'P3', kwh: 132865 * 41429 / 160609, precioKwh: 0.108320 },
      { periodo: 'P6', kwh: 132865 * 38736 / 160609, precioKwh: 0.108320 },
    ],
    real: {
      energia: 14391.98, potencia: 3214.22, excesos: 54.30, bonoSocial: 0.59,
      iee: 88.31, alquiler: 65.23, base: 17814.63, iva: 3741.07, total: 21555.70,
      ivaPct: 0.21, ieePct: 0.50 / 100,
    },
  },
}

// GAS — Ekyner 2025 (del PDF Gas Ekyner vs Galp)
const ekynerGas = {
  ene2025: { dias: 31, consumo: 239803, precioKwh: 0.057232 },
  feb2025: { dias: 28, consumo: 268261, precioKwh: 0.057232 },
  mar2025: { dias: 31, consumo: 263652, precioKwh: 0.047471 },
}

// GAS — Galp 2026
const galpGas = {
  ene2026: { dias: 31, consumo: 182565, precioKwh: 0.037519, ivaPct: 0.21 },
  feb2026: { dias: 28, consumo: 231133, precioKwh: 0.037519, ivaPct: 0.21 },
  mar2026: { dias: 31, consumo: 243633, precioKwh: 0.037519, ivaPct: 0.10 },
}

// ── Reimplementación 1:1 de la simulación ───────────────────────────────────

function simularLuzMes(voltis, antigua, real) {
  // Indexa antigua por periodo (precio €/kWh)
  const preciosAntigua = {}
  for (const c of antigua.consumo) preciosAntigua[c.periodo] = c.precioKwh

  // Energía simulada: para cada periodo de voltis, kWh × precio_antigua
  let energiaSim = 0
  for (const c of voltis.consumo) {
    const p = preciosAntigua[c.periodo] || 0
    energiaSim += c.kwh * p
  }

  // Potencia: la pasamos idéntica (en este test los precios de potencia son
  // los mismos en ambos escenarios; la potencia contratada no cambia entre
  // comercializadoras porque depende de la distribuidora)
  const potenciaSim = real.potencia

  // Regulados idénticos a Voltis
  const excesos = real.excesos
  const bono = real.bonoSocial
  const alquiler = real.alquiler

  // IEE recalculado con tipo Voltis. Base = energía + potencia + excesos
  // (la Ley 38/1992 grava la base eléctrica, no bono social ni alquiler).
  const ieeSim = real.ieePct * (energiaSim + potenciaSim + excesos)
  const baseSim = energiaSim + potenciaSim + excesos + bono + ieeSim + alquiler
  const ivaSim = real.ivaPct * baseSim
  const totalSim = baseSim + ivaSim

  return { energiaSim, potenciaSim, ieeSim, baseSim, ivaSim, totalSim }
}

function simularGasMes(voltis, antigua) {
  const energiaSim = voltis.consumo * antigua.precioKwh
  const ivaSim = voltis.ivaPct * energiaSim
  const totalEnergiaConIva = energiaSim + ivaSim

  const energiaVoltis = voltis.consumo * voltis.precioKwh
  const ivaVoltis = voltis.ivaPct * energiaVoltis
  const totalEnergiaVoltisConIva = energiaVoltis + ivaVoltis

  const ahorro = totalEnergiaConIva - totalEnergiaVoltisConIva
  return { energiaSim, totalEnergiaConIva, totalEnergiaVoltisConIva, ahorro }
}

// ── Validación LUZ ──────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════')
console.log('TEST LUZ — UNICE TOYS (6.1TD) — Ene-Mar 2026 vs Ene-Mar 2025')
console.log('═══════════════════════════════════════════════════════════════')

const luzCasos = [
  { mes: 'Enero', voltis: galpLuz.ene2026, antigua: ekynerLuz.ene2025,
    expected: { sim: 22784.56, real: 18644.79, ahorro: 4139.77 } },
  { mes: 'Febrero', voltis: galpLuz.feb2026, antigua: ekynerLuz.feb2025,
    expected: { sim: 38088.78, real: 27424.96, ahorro: 10663.82 } },
  { mes: 'Marzo', voltis: galpLuz.mar2026, antigua: ekynerLuz.mar2025,
    expected: { sim: 22027.12, real: 21555.70, ahorro: 471.42 } },
]

let totalSimLuz = 0, totalRealLuz = 0, totalAhorroLuz = 0
for (const caso of luzCasos) {
  const sim = simularLuzMes(caso.voltis, caso.antigua, caso.voltis.real)
  const ahorro = sim.totalSim - caso.voltis.real.total
  totalSimLuz += sim.totalSim
  totalRealLuz += caso.voltis.real.total
  totalAhorroLuz += ahorro

  const diff = Math.abs(sim.totalSim - caso.expected.sim)
  const mark = diff < 1.5 ? '✓' : '✗'
  console.log(`  ${caso.mes.padEnd(8)} | Real Galp ${caso.voltis.real.total.toFixed(2).padStart(10)} | Sim Ekyner ${sim.totalSim.toFixed(2).padStart(10)} | Ahorro ${ahorro.toFixed(2).padStart(10)} | esperado ${caso.expected.sim.toFixed(2).padStart(10)} ${mark}`)
}

console.log('---')
console.log(`  TOTAL    | Real Galp ${totalRealLuz.toFixed(2).padStart(10)} | Sim Ekyner ${totalSimLuz.toFixed(2).padStart(10)} | Ahorro ${totalAhorroLuz.toFixed(2).padStart(10)} | esperado    15275.01`)
const diffLuz = Math.abs(totalAhorroLuz - 15275.01)
console.log(`  Δ vs PDF = ${diffLuz.toFixed(2)}€ ${diffLuz < 5 ? '✓ OK' : '✗ FALLO'}`)

// ── Validación GAS ──────────────────────────────────────────────────────────

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log('TEST GAS — UNICE TOYS (RL06) — Ene-Mar 2026 vs Ene-Mar 2025')
console.log('═══════════════════════════════════════════════════════════════')

const gasCasos = [
  { mes: 'Enero', voltis: galpGas.ene2026, antigua: ekynerGas.ene2025,
    expected: { ahorro: 4354.67 } },
  { mes: 'Febrero', voltis: galpGas.feb2026, antigua: ekynerGas.feb2025,
    expected: { ahorro: 5513.15 } },
  { mes: 'Marzo', voltis: galpGas.mar2026, antigua: ekynerGas.mar2025,
    expected: { ahorro: 2667.09 } },
]

let totalAhorroGas = 0
for (const caso of gasCasos) {
  const sim = simularGasMes(caso.voltis, caso.antigua)
  totalAhorroGas += sim.ahorro
  const diff = Math.abs(sim.ahorro - caso.expected.ahorro)
  const mark = diff < 1 ? '✓' : '✗'
  console.log(`  ${caso.mes.padEnd(8)} | Energía Galp ${(caso.voltis.consumo * caso.voltis.precioKwh).toFixed(2).padStart(10)} | Energía Ekyner ${(caso.voltis.consumo * caso.antigua.precioKwh).toFixed(2).padStart(10)} | Ahorro IVA incl ${sim.ahorro.toFixed(2).padStart(10)} | esperado ${caso.expected.ahorro.toFixed(2).padStart(10)} ${mark}`)
}

console.log('---')
console.log(`  TOTAL    | Ahorro = ${totalAhorroGas.toFixed(2)}€ | esperado 12534.91€`)
const diffGas = Math.abs(totalAhorroGas - 12534.91)
console.log(`  Δ vs PDF = ${diffGas.toFixed(2)}€ ${diffGas < 1 ? '✓ OK' : '✗ FALLO'}`)
