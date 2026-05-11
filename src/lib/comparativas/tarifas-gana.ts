// ── Tarifas Gana Energía 2.0TD ────────────────────────────────────────────────
// Extraídas el 2026-05-08 del endpoint POST backcolaboradores2.ganaenergia.com/calcularLuz
// con un caso de prueba limpio (1 kW × 2 periodos, 100 kWh × 3 periodos, 30 días).
// Los precios son los unitarios derivados de ese cálculo. Cuando Gana actualice
// precios, basta con relanzar la extracción y sustituir esta tabla.

export type TarifaSlug = '2.0TD_Sin_mas' | '2.0TD_Online' | '2.0TD_Precio_estable'

export interface TarifaGana {
  /** Identificador estable que devuelve la API */
  id: string
  /** Slug interno de Gana (también lo usan en la URL del PDF de propuesta) */
  slug: TarifaSlug
  /** Nombre comercial para mostrar al cliente */
  nombre: string
  /** Identificador del template PDF en su sistema (para futura integración) */
  idPdf: number
  /** Precio €/kW·día para los dos periodos de potencia (P1 punta, P2 valle) */
  kwDia: { p1: number; p2: number }
  /** Precio €/kWh para los tres periodos de energía */
  kwh: { punta: number; llano: number; valle: number }
  /** Cuota fija mensual de servicio (solo Tarifa Precio de Mercado) */
  servicioGanaEnergia: number
}

export const TARIFAS_GANA_2_0TD: TarifaGana[] = [
  {
    id: '6889f3f00bf70d969ad0cbf5',
    slug: '2.0TD_Sin_mas',
    nombre: 'Tarifa Precio de Mercado',
    idPdf: 299,
    // INDEX: precios de peajes+cargos de potencia (P1=punta, P2=valle)
    kwDia: { p1: 0.0738, p2: 0.0019 },
    // Energía indexada — precios estimados (media pool reciente)
    kwh: { punta: 0.1927, llano: 0.1221, valle: 0.1088 },
    // Cuota mensual servicio Gana ≈ 60 €/año
    servicioGanaEnergia: 5.01,
  },
  {
    id: '69df60ab9db82984a70fa9d3',
    slug: '2.0TD_Online',
    nombre: 'Tarifa 24 horas',
    idPdf: 314,
    // FIJO potencia (actualizados 2025): P1=P2=0.089434 €/kW·día
    kwDia: { p1: 0.089434, p2: 0.089434 },
    // Tarifa plana — mismo precio los tres periodos
    kwh: { punta: 0.1136, llano: 0.1136, valle: 0.1136 },
    servicioGanaEnergia: 0,
  },
  {
    id: '69df64a09db82984a70fa9d5',
    slug: '2.0TD_Precio_estable',
    nombre: 'Tarifa Tramos Horarios',
    idPdf: 317,
    // FIJO potencia (actualizados 2025): P1=P2=0.089434 €/kW·día
    kwDia: { p1: 0.089434, p2: 0.089434 },
    // Precios por tramo horario (actualizados 2025)
    kwh: { punta: 0.168, llano: 0.105, valle: 0.081 },
    servicioGanaEnergia: 0,
  },
]

// ── Conceptos regulados / fijos ──────────────────────────────────────────────

/**
 * Bono Social — coste regulado mensual.
 * En la extracción de mayo 2026 sale ~0.5737 €/mes para un cliente residencial
 * 2.0TD con consumo bajo. Si en el futuro Gana lo escala con el consumo,
 * habría que recalcularlo dinámicamente.
 */
export const BONO_SOCIAL_MES = 0.5737

/**
 * Impuesto eléctrico aplicado por el comparador de Gana sobre la base
 * (potencia + energía). Históricamente era 5.113 % regulado, pero durante la
 * crisis energética se aplicaron tipos reducidos. Verificado contra los 3
 * casos de extracción: 1.7/44.7 = 1.56/41.06 = 1.55/40.86 ≈ 3.80 %.
 */
export const IMPUESTO_ELECTRICO_PCT = 0.0380

/** IVA por defecto que aplica el portal de Gana (10 %). El usuario lo puede sobreescribir. */
export const IVA_PCT_POR_DEFECTO = 10
