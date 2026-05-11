// ── Motor de cálculo de comparativa de luz 2.0TD ──────────────────────────────
// Función pura que replica el cálculo del comparador de Gana. Validado contra
// el endpoint POST backcolaboradores2.ganaenergia.com/calcularLuz para los
// tres productos comerciales (Precio de Mercado, 24 horas, Tramos Horarios).
//
// La fórmula tal cual la aplica Gana:
//
//   coste_potencia[i]     = potencia_kW[i] × dias × precio_kw_dia[i]
//   coste_energia[i]      = energia_kWh[i] × precio_kwh[i]
//   total_potencia_energia = Σ coste_potencia + Σ coste_energia
//   impuesto_electrico    = total_potencia_energia × 3.80 %
//   total_sin_iva         = total_potencia_energia + servicio_gana + bono_social + impuesto
//   iva_eur               = total_sin_iva × (iva_pct / 100)
//   total_final           = total_sin_iva + iva_eur + alquiler − descuento_post_iva
//
// Se proyectan ahorros a 6 meses y 12 meses asumiendo que la factura introducida
// es representativa del periodo (igual que hace el portal de Gana).

import {
  TARIFAS_GANA_2_0TD,
  BONO_SOCIAL_MES,
  IMPUESTO_ELECTRICO_PCT,
  type TarifaGana,
} from './tarifas-gana'

// ── Tipos públicos ───────────────────────────────────────────────────────────

export interface InputComparativa {
  /** Potencia contratada en cada periodo, en kW */
  potencias: { p1: number; p2: number }
  /** Energía consumida en cada periodo, en kWh */
  energias: { punta: number; llano: number; valle: number }
  /** Días que cubre la factura de referencia (30 = un mes; 365 = año completo) */
  dias: number
  /** IVA aplicable, en porcentaje (10 o 21 normalmente) */
  ivaPct: number
  /** Lo que paga ahora con su comercializadora actual (para calcular ahorro) */
  totalFacturaActual: number
  /** Alquiler de equipo de medida (€), por defecto 0 */
  alquiler?: number
  /** Descuento post-IVA aplicado por Gana (€), por defecto 0 */
  descuentoDespuesIva?: number
  /**
   * Etiqueta del horizonte temporal del cálculo, opcional.
   * 'mensual' (default) trata el resultado como un mes de factura.
   * 'anual' indica que los inputs ya son agregados anuales (12 meses de consumo).
   */
  horizonte?: 'mensual' | 'anual'
}

export interface ResultadoTarifa {
  tarifa: TarifaGana
  /** Coste de potencia desglosado por periodo (€) */
  costePotencia: { p1: number; p2: number; total: number }
  /** Coste de energía desglosado por periodo (€) */
  costeEnergia: { punta: number; llano: number; valle: number; total: number }
  totalPotenciaEnergia: number
  servicioGanaEnergia: number
  bonoSocial: number
  impuestoElectrico: number
  totalSinIva: number
  iva: number
  alquiler: number
  descuentoDespuesIva: number
  total: number
  /** Diferencia con el total de la factura actual (positivo = ahorro) */
  ahorro: number
  ahorro6Meses: number
  ahorroAnyo: number
}

export interface ResultadoComparativa {
  input: InputComparativa
  resultados: ResultadoTarifa[]
  /** ID de la tarifa más barata (la que más ahorro genera) */
  mejorTarifaId: string | null
  /** Marca temporal del cálculo (ISO) */
  calculadoEn: string
}

// ── Función principal ────────────────────────────────────────────────────────

export function calcularComparativa(input: InputComparativa): ResultadoComparativa {
  validarInput(input)

  const resultados = TARIFAS_GANA_2_0TD.map((tarifa) =>
    calcularTarifa(input, tarifa),
  )

  // Tarifa con mayor ahorro
  const mejor = resultados.reduce<ResultadoTarifa | null>(
    (best, curr) => (best === null || curr.ahorro > best.ahorro ? curr : best),
    null,
  )

  return {
    input,
    resultados,
    mejorTarifaId: mejor?.tarifa.id ?? null,
    calculadoEn: new Date().toISOString(),
  }
}

// ── Internos ─────────────────────────────────────────────────────────────────

function calcularTarifa(input: InputComparativa, tarifa: TarifaGana): ResultadoTarifa {
  const { potencias, energias, dias, ivaPct, totalFacturaActual } = input
  const alquiler = input.alquiler ?? 0
  const descuento = input.descuentoDespuesIva ?? 0

  // Potencia
  const costeP1 = redondear(potencias.p1 * dias * tarifa.kwDia.p1)
  const costeP2 = redondear(potencias.p2 * dias * tarifa.kwDia.p2)
  const totalPotencia = redondear(costeP1 + costeP2)

  // Energía
  const costePunta = redondear(energias.punta * tarifa.kwh.punta)
  const costeLlano = redondear(energias.llano * tarifa.kwh.llano)
  const costeValle = redondear(energias.valle * tarifa.kwh.valle)
  const totalEnergia = redondear(costePunta + costeLlano + costeValle)

  const totalPotenciaEnergia = redondear(totalPotencia + totalEnergia)

  // Conceptos adicionales
  // Servicio Gana y Bono Social son cuotas FIJAS MENSUALES. Para periodos
  // distintos a 30 días (típicamente facturas anuales con dias=365) escalamos
  // proporcionalmente al número de meses-equivalente. Mantiene exactitud al
  // céntimo en el caso mensual (mesesEquivalentes ≈ 1) y proyecta correctamente
  // a anual (mesesEquivalentes ≈ 12,17).
  const mesesEquivalentes = dias / 30
  const servicioGana = redondear(tarifa.servicioGanaEnergia * mesesEquivalentes)
  const bonoSocial = redondear(BONO_SOCIAL_MES * mesesEquivalentes)
  const impuestoElectrico = redondear(totalPotenciaEnergia * IMPUESTO_ELECTRICO_PCT)

  // IVA y total
  const totalSinIva = redondear(
    totalPotenciaEnergia + servicioGana + bonoSocial + impuestoElectrico,
  )
  const iva = redondear(totalSinIva * (ivaPct / 100))
  const total = redondear(totalSinIva + iva + alquiler - descuento)

  // Ahorro vs factura actual. Proyectamos a 1 año natural usando 365/dias,
  // que es lo que hace el comparador oficial de Gana (verificado al céntimo).
  const ahorro = redondear(totalFacturaActual - total)
  const factorAnual = dias > 0 ? 365 / dias : 12
  const ahorroAnyo = redondear(ahorro * factorAnual)
  const ahorro6Meses = redondear(ahorroAnyo / 2)

  return {
    tarifa,
    costePotencia: { p1: costeP1, p2: costeP2, total: totalPotencia },
    costeEnergia: {
      punta: costePunta,
      llano: costeLlano,
      valle: costeValle,
      total: totalEnergia,
    },
    totalPotenciaEnergia,
    servicioGanaEnergia: servicioGana,
    bonoSocial,
    impuestoElectrico,
    totalSinIva,
    iva,
    alquiler,
    descuentoDespuesIva: descuento,
    total,
    ahorro,
    ahorro6Meses,
    ahorroAnyo,
  }
}

function validarInput(input: InputComparativa): void {
  const errors: string[] = []
  if (!input || typeof input !== 'object') errors.push('input requerido')
  if (input.dias <= 0) errors.push('dias debe ser > 0')
  if (input.ivaPct < 0 || input.ivaPct > 100) errors.push('ivaPct fuera de rango (0–100)')
  if (input.totalFacturaActual < 0) errors.push('totalFacturaActual no puede ser negativo')

  for (const [k, v] of Object.entries(input.potencias ?? {})) {
    if (v < 0) errors.push(`potencias.${k} no puede ser negativo`)
  }
  for (const [k, v] of Object.entries(input.energias ?? {})) {
    if (v < 0) errors.push(`energias.${k} no puede ser negativo`)
  }

  if (errors.length > 0) {
    throw new Error(`Input de comparativa inválido: ${errors.join(', ')}`)
  }
}

/** Redondea a 2 decimales para evitar errores de coma flotante en la suma */
function redondear(value: number): number {
  return Math.round(value * 100) / 100
}
