import { NextRequest, NextResponse } from 'next/server'
import { analyzeInvoice, getMimeType } from '@/lib/gemini'
import { normalizeTariff } from '@/lib/consumption-utils'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { lookupFormato, registrarExtraccion } from '@/lib/smart-invoice-extractor'

// La extracción puede tardar (modelo + retries). Dejamos margen como en
// /api/analyze-invoice. Vercel Pro permite hasta 300 s.
export const maxDuration = 120

// ── POST /api/comparativas/extraer-factura ───────────────────────────────────
//
// Wrapper sobre analyzeInvoice() pensado para el flujo de Comparativas 2.0.
// Toma una factura (PDF/JPG/PNG, opcionalmente con extra_pages) y devuelve un
// objeto plano listo para alimentar el motor calcularComparativa.
//
// Mejoras del sistema de aprendizaje:
//  1. Lookup de comercializadora_formats → inyecta notas de formato en 2º intento
//  2. Validación matemática de totales (subtotal × IVA ≈ totalFactura ±20%)
//  3. Si validación falla → retry con formato específico de la BD
//  4. Actualiza métricas de éxito/error por comercializadora en la BD

interface InvoicePage {
  file_base64: string
  file_type?: string
  file_name?: string
}

interface RequestBody extends InvoicePage {
  extra_pages?: InvoicePage[]
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

// lookupFormato and registrarExtraccion are imported from @/lib/smart-invoice-extractor

// ── Validación matemática de totales ─────────────────────────────────────────
// Para 2.0TD: subtotal = Σpotencia + Σenergia. Extrapolado con IVA 21% debe
// estar dentro del ±25% del totalFactura (margen amplio por IE, alquiler, etc.)
interface ValidacionResult {
  ok: boolean
  subtotal: number
  extrapolado: number
  desviacion: number  // fracción: (extrapolado - total) / total
  detalle: string
}

function validarTotalesMatematicos(
  kwP1: number | null, kwP2: number | null,
  precioKwDiaP1: number | null, precioKwDiaP2: number | null,
  kwhPunta: number | null, kwhLlano: number | null, kwhValle: number | null,
  precioKwhPunta: number | null, precioKwhLlano: number | null, precioKwhValle: number | null,
  dias: number,
  totalFactura: number,
): ValidacionResult {
  // Si no hay total o no hay datos suficientes, no podemos validar
  if (!totalFactura || totalFactura <= 0) {
    return { ok: true, subtotal: 0, extrapolado: 0, desviacion: 0, detalle: 'sin_total' }
  }

  const potP1 = (kwP1 ?? 0) * (precioKwDiaP1 ?? 0) * dias
  const potP2 = (kwP2 ?? 0) * (precioKwDiaP2 ?? 0) * dias
  const enPunta = (kwhPunta ?? 0) * (precioKwhPunta ?? 0)
  const enLlano = (kwhLlano ?? 0) * (precioKwhLlano ?? 0)
  const enValle = (kwhValle ?? 0) * (precioKwhValle ?? 0)

  // Requiere al menos potencia O energía para validar
  const potTotal = potP1 + potP2
  const enTotal = enPunta + enLlano + enValle
  if (potTotal === 0 && enTotal === 0) {
    return { ok: true, subtotal: 0, extrapolado: 0, desviacion: 0, detalle: 'sin_datos' }
  }

  const subtotal = potTotal + enTotal
  // IVA 21% + IE pequeño (~1.5%) → factor ~1.23
  const extrapolado = subtotal * 1.23
  const desviacion = Math.abs(extrapolado - totalFactura) / totalFactura

  // Tolerancia del 25%: margen amplio por alquiler equipos, descuentos, bono social, etc.
  const ok = desviacion <= 0.25
  const detalle = ok
    ? `OK (±${(desviacion * 100).toFixed(1)}%)`
    : `FALLO: calculado ${extrapolado.toFixed(2)}€ vs factura ${totalFactura.toFixed(2)}€ (±${(desviacion * 100).toFixed(1)}%)`

  return { ok, subtotal, extrapolado, desviacion, detalle }
}

export async function POST(request: NextRequest) {
  // Auth — solo usuarios autenticados del CRM pueden invocar Gemini.
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null
    if (!body?.file_base64) {
      return NextResponse.json(
        { ok: false, error: 'file_base64 es requerido' },
        { status: 400 },
      )
    }

    const mimeType = getMimeType(body.file_name || '', body.file_type)
    const extraPages = body.extra_pages?.map((p) => ({
      base64Data: p.file_base64,
      mimeType: getMimeType(p.file_name || '', p.file_type),
    }))

    // ── PRIMER INTENTO — extracción estándar ─────────────────────────────────
    const extracted = await analyzeInvoice(
      body.file_base64,
      mimeType,
      extraPages?.length ? extraPages : undefined,
    )

    if (extracted.error) {
      return NextResponse.json({ ok: false, error: extracted.error }, { status: 502 })
    }

    if (extracted.documentType !== 'factura') {
      return NextResponse.json(
        { ok: false, error: `El documento subido no parece una factura energética (detectado: ${extracted.documentType ?? 'desconocido'}).` },
        { status: 422 },
      )
    }

    if (extracted.supply_type && extracted.supply_type !== 'luz') {
      return NextResponse.json(
        { ok: false, error: `Solo se admiten facturas de luz por ahora (detectado: ${extracted.supply_type}).` },
        { status: 422 },
      )
    }

    const tarifa = normalizeTariff(extracted.tariff || '') || extracted.tariff || ''
    if (tarifa && tarifa !== '2.0TD') {
      return NextResponse.json(
        { ok: false, error: `Solo se admite tarifa 2.0TD por ahora. La factura tiene tarifa ${tarifa}.`, tarifaDetectada: tarifa },
        { status: 422 },
      )
    }

    // ── Lookup de formato en BD ──────────────────────────────────────────────
    const formato = await lookupFormato(extracted.comercializadora)
    let formatoId = formato?.id ?? null

    // ── Mapeo rico → shape del comparador ────────────────────────────────────
    let mappedResult = mapearExtraido(extracted)
    const { warnings } = mappedResult

    // ── Validación matemática ────────────────────────────────────────────────
    const validacion = validarTotalesMatematicos(
      mappedResult.potencias.p1, mappedResult.potencias.p2,
      mappedResult.preciosUnitarios.kwDia.p1, mappedResult.preciosUnitarios.kwDia.p2,
      mappedResult.energias.punta, mappedResult.energias.llano, mappedResult.energias.valle,
      mappedResult.preciosUnitarios.kwh.punta, mappedResult.preciosUnitarios.kwh.llano,
      mappedResult.preciosUnitarios.kwh.valle,
      mappedResult.dias,
      mappedResult.totalFactura,
    )

    let usedRetry = false

    // ── SEGUNDO INTENTO si validación falla y tenemos notas de formato ───────
    if (!validacion.ok && formato?.notas_extraccion && !formato.notas_extraccion.includes('PENDIENTE')) {
      console.log(`[extraer-factura] Math validation failed (${validacion.detalle}). Retrying with format hints for ${extracted.comercializadora}`)

      const formatContext = `
═══ NOTAS ESPECÍFICAS PARA ESTA COMERCIALIZADORA (${extracted.comercializadora?.toUpperCase()}) ═══
${formato.notas_extraccion}

IMPORTANTE: El intento anterior de extracción resultó en totales matemáticamente inconsistentes
(calculado: ${validacion.extrapolado.toFixed(2)}€ vs factura: ${mappedResult.totalFactura.toFixed(2)}€).
Revisa especialmente: formato de precios, si son €/kW/mes o €/kW/día, y si los precios incluyen
peajes y cargos juntos o por separado.
`.trim()

      const extracted2 = await analyzeInvoice(
        body.file_base64,
        mimeType,
        extraPages?.length ? extraPages : undefined,
        formatContext,
      )

      if (!extracted2.error && extracted2.documentType === 'factura') {
        const mapped2 = mapearExtraido(extracted2)
        const val2 = validarTotalesMatematicos(
          mapped2.potencias.p1, mapped2.potencias.p2,
          mapped2.preciosUnitarios.kwDia.p1, mapped2.preciosUnitarios.kwDia.p2,
          mapped2.energias.punta, mapped2.energias.llano, mapped2.energias.valle,
          mapped2.preciosUnitarios.kwh.punta, mapped2.preciosUnitarios.kwh.llano,
          mapped2.preciosUnitarios.kwh.valle,
          mapped2.dias,
          mapped2.totalFactura,
        )

        if (val2.ok || val2.desviacion < validacion.desviacion) {
          // El segundo intento mejoró — usarlo
          mappedResult = mapped2
          usedRetry = true
          if (!val2.ok) {
            mappedResult.warnings.push(
              `Validación matemática mejorada tras retry (±${(val2.desviacion * 100).toFixed(1)}%). Revisa precios si la comparativa parece incorrecta.`,
            )
          }
          console.log(`[extraer-factura] Retry improved: ${validacion.detalle} → ${val2.detalle}`)
        } else {
          // El segundo intento no mejoró — mantener el primero
          console.log(`[extraer-factura] Retry did not improve. Keeping first result.`)
        }
      }
    }

    // ── Warning si validación final sigue fallando ───────────────────────────
    const validacionFinal = validarTotalesMatematicos(
      mappedResult.potencias.p1, mappedResult.potencias.p2,
      mappedResult.preciosUnitarios.kwDia.p1, mappedResult.preciosUnitarios.kwDia.p2,
      mappedResult.energias.punta, mappedResult.energias.llano, mappedResult.energias.valle,
      mappedResult.preciosUnitarios.kwh.punta, mappedResult.preciosUnitarios.kwh.llano,
      mappedResult.preciosUnitarios.kwh.valle,
      mappedResult.dias,
      mappedResult.totalFactura,
    )

    if (!validacionFinal.ok && validacionFinal.detalle !== 'sin_total' && validacionFinal.detalle !== 'sin_datos') {
      mappedResult.warnings.push(
        `⚠️ Los precios extraídos no cuadran matemáticamente con el total de la factura (desviación ${(validacionFinal.desviacion * 100).toFixed(0)}%). Verifica los precios €/kW·día y €/kWh antes de calcular.`,
      )
    }

    // ── Actualizar métricas de aprendizaje en BD ─────────────────────────────
    const extraccionOk = validacionFinal.ok ||
      validacionFinal.detalle === 'sin_total' ||
      validacionFinal.detalle === 'sin_datos'
    registrarExtraccion(formatoId, extraccionOk)  // fire-and-forget

    return NextResponse.json({
      ok: true,
      data: {
        cups: mappedResult.cups,
        comercializadora: mappedResult.comercializadora,
        tarifa: mappedResult.tarifa,
        supplyAddress: mappedResult.supplyAddress,
        fechaInicio: mappedResult.fechaInicio,
        fechaFin: mappedResult.fechaFin,
        dias: mappedResult.dias,
        potencias: mappedResult.potencias,
        energias: mappedResult.energias,
        totalFactura: mappedResult.totalFactura,
        preciosUnitarios: mappedResult.preciosUnitarios,
        extrasOpcionales: mappedResult.extrasOpcionales,
        warnings: mappedResult.warnings,
        modoExtraccion: usedRetry ? `${extracted.mode}+retry` : extracted.mode,
        _debug: {
          validacion: validacionFinal.detalle,
          formatoConfianza: formato?.confianza ?? null,
          usedRetry,
        },
      },
    })
  } catch (err: any) {
    console.error('[api/comparativas/extraer-factura] Error:', err)
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Error inesperado' },
      { status: 500 },
    )
  }
}

// ── Mapear resultado de Gemini → shape del comparador ────────────────────────
interface MappedResult {
  cups: string | null
  comercializadora: string | null
  tarifa: string
  supplyAddress: string | null
  fechaInicio: string | null
  fechaFin: string | null
  dias: number
  potencias: { p1: number; p2: number }
  energias: { punta: number; llano: number; valle: number }
  totalFactura: number
  preciosUnitarios: {
    kwDia: { p1: number; p2: number }
    kwh: { punta: number; llano: number; valle: number }
  }
  extrasOpcionales: ExtraOpcional[]
  warnings: string[]
}

function mapearExtraido(extracted: any): MappedResult {
  const tarifa = normalizeTariff(extracted.tariff || '') || extracted.tariff || '2.0TD'
  const eco: any = extracted.economics ?? {}
  const consumo: any[] = Array.isArray(eco.consumo) ? eco.consumo : []
  const potencia: any[] = Array.isArray(eco.potencia) ? eco.potencia : []
  const warnings: string[] = []

  // Detect pricing format (extracted by Gemini)
  const energyPricingFormat: string = eco.energyPricingFormat ?? extracted.energyPricingFormat ?? ''
  const fmtPromo = energyPricingFormat === 'promocionadas'

  // Potencias por periodo (P1=Punta, P2=Valle en 2.0TD)
  const potP1 = findPeriodo(potencia, 'P1')
  const potP2 = findPeriodo(potencia, 'P2') ?? findPeriodo(potencia, 'P3')
  const kwP1 = num(potP1?.kw)
  const kwP2 = num(potP2?.kw) ?? kwP1
  const precioKwDiaP1 = num(potP1?.precioKwDia)
  const precioKwDiaP2 = num(potP2?.precioKwDia)

  if (potP1 == null) warnings.push('No se encontró potencia P1 en la factura.')
  if (potP1 != null && potP2 == null) warnings.push('No se encontró potencia P2; se asume igual que P1.')
  if (precioKwDiaP1 == null) warnings.push('No se encontró el precio €/kW·día P1.')
  if (precioKwDiaP2 == null) warnings.push('No se encontró el precio €/kW·día P2.')

  // Energías por periodo
  const enPunta = findPeriodo(consumo, 'P1')
  const enLlano = findPeriodo(consumo, 'P2')
  const enValle = findPeriodo(consumo, 'P3')
  const flatEnergia = consumo.find((c) => c?.periodo == null && num(c?.kwh))

  let kwhPunta = num(enPunta?.kwh)
  let kwhLlano = num(enLlano?.kwh)
  let kwhValle = num(enValle?.kwh)
  let precioKwhPunta = num(enPunta?.precioKwh)
  let precioKwhLlano = num(enLlano?.precioKwh)
  let precioKwhValle = num(enValle?.precioKwh)

  // ── "Horas promocionadas / no promocionadas" format ─────────────────────────
  // Gemini emits: P1 = no-promo (punta, expensive), P2 = promo (valle, cheap).
  // For 2.0TD comparativa the mapping must be:
  //   Punta (P1) = no-promo price   → kwhPunta from invoice, precioKwhPunta = no-promo
  //   Llano (P2) = no-promo price   → same rate (punta+llano are both "no-promo" hours)
  //   Valle (P3) = promo price      → kwhValle from invoice, precioKwhValle = promo
  // The Gemini P2 slot holds the promo data — remap it to Valle.
  if (fmtPromo) {
    // enLlano (consumo P2) is actually promo = valle
    const promoItem = enLlano   // Gemini P2 = promo (valle in 2.0TD)
    const noPromoItem = enPunta // Gemini P1 = no-promo (punta)

    kwhPunta = num(noPromoItem?.kwh)          // no-promo kWh → punta
    precioKwhPunta = num(noPromoItem?.precioKwh)  // no-promo price

    // Llano uses the same "no-promo" rate (both punta+llano are billed together)
    kwhLlano = null  // kWh split between punta and llano is unknown from this invoice
    precioKwhLlano = precioKwhPunta  // same unit price as punta

    // Valle = promo
    kwhValle = num(promoItem?.kwh)
    precioKwhValle = num(promoItem?.precioKwh)

    warnings.push(
      'Factura con formato "Horas promocionadas / no promocionadas": punta y llano comparten el precio no-promocionado; valle usa el precio promocionado. Ajusta los kWh de punta y llano según los datos SIPS si es necesario.',
    )
  }

  if (kwhPunta == null && kwhLlano == null && kwhValle == null && flatEnergia) {
    kwhPunta = num(flatEnergia.kwh)
    precioKwhPunta = num(flatEnergia.precioKwh)
    warnings.push(
      'La factura no desglosa el consumo por periodos; el total se ha asignado a "Punta". Ajusta los kWh por periodo manualmente para una comparativa correcta.',
    )
  }

  if (kwhPunta == null && kwhLlano == null && kwhValle == null) {
    warnings.push('No se ha podido extraer el consumo por periodos.')
  }
  if (precioKwhPunta == null && precioKwhLlano == null && precioKwhValle == null) {
    warnings.push('No se ha podido extraer el precio €/kWh por periodos. Revisa los precios antes de calcular.')
  }

  // Días y fechas
  const dias =
    num(eco.diasFacturados) ??
    num(eco.totalDias) ??
    num(eco.dias) ??
    diasDesdeFechas(eco.fechaInicio, eco.fechaFin) ??
    30
  const fechaInicio = stringOrNull(eco.fechaInicio)
  const fechaFin = stringOrNull(eco.fechaFin)

  const totalFactura =
    num(eco.totalFactura) ??
    (extracted.total_amount ? num(extracted.total_amount) : null) ??
    0
  if (!totalFactura) warnings.push('No se ha podido extraer el total de la factura.')

  // Extras opcionales
  const rawLineItems: any[] = Array.isArray(eco.rawLineItems) ? eco.rawLineItems : []
  const extrasOpcionales = detectarExtrasOpcionales(rawLineItems, dias)
  if (extrasOpcionales.length > 0) {
    warnings.push(
      `Se detectaron ${extrasOpcionales.length} servicio(s) opcional(es) en la factura (packs/seguros/mantenimiento). Revísalos en la sección de extras.`,
    )
  }

  return {
    cups: extracted.cups ?? null,
    comercializadora: extracted.comercializadora ?? null,
    tarifa: tarifa || '2.0TD',
    supplyAddress: extracted.supply_address ?? null,
    fechaInicio,
    fechaFin,
    dias,
    potencias: { p1: kwP1 ?? 0, p2: kwP2 ?? 0 },
    energias: { punta: kwhPunta ?? 0, llano: kwhLlano ?? 0, valle: kwhValle ?? 0 },
    totalFactura: totalFactura ?? 0,
    preciosUnitarios: {
      kwDia: { p1: precioKwDiaP1 ?? 0, p2: precioKwDiaP2 ?? 0 },
      kwh: { punta: precioKwhPunta ?? 0, llano: precioKwhLlano ?? 0, valle: precioKwhValle ?? 0 },
    },
    extrasOpcionales,
    warnings,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findPeriodo<T extends { periodo?: string | null }>(arr: T[], periodo: string): T | null {
  return arr.find((x) => String(x?.periodo || '').toUpperCase() === periodo) ?? null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  return v.trim()
}

function diasDesdeFechas(inicio: unknown, fin: unknown): number | null {
  const a = stringOrNull(inicio)
  const b = stringOrNull(fin)
  if (!a || !b) return null
  const da = new Date(a)
  const db = new Date(b)
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null
  const diff = Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : null
}

// ── Detección de extras opcionales ───────────────────────────────────────────

const EXTRA_PATTERNS = [
  /smart/i,
  /\bpack\b/i,
  /seguro/i,
  /mantenimi/i,
  /tranquilidad/i,
  /asistencia/i,
  /asesor/i,
  /\bclub\b/i,
  /aver[ií]as/i,
  /\bhogar\b/i,
  /repsol\s+(plus|pro)/i,
  /ok\s*plan/i,
  /reparaciones?\b/i,
  /electrodomestic/i,
  /protecci[óo]n/i,
]

interface ExtraOpcional {
  concepto: string
  importe: number
  importeMensual: number
  importeAnual: number
}

function detectarExtrasOpcionales(items: any[], diasFactura: number): ExtraOpcional[] {
  if (!Array.isArray(items) || items.length === 0) return []
  const meses = diasFactura > 0 ? diasFactura / 30 : 1
  const detected: ExtraOpcional[] = []

  for (const it of items) {
    const desc = String(it?.description ?? '').trim()
    if (!desc) continue
    const total = num(it?.total)
    if (total == null || total <= 0) continue

    const cat = String(it?.category ?? '').toLowerCase()
    const esRegulado =
      cat.startsWith('energia_') || cat.startsWith('potencia_') || cat.startsWith('gas_') ||
      cat === 'impuesto_electrico' || cat === 'impuesto_hidrocarburos' || cat === 'iva' ||
      cat === 'bono_social' || cat === 'compensacion_excedentes' ||
      cat === 'descuento_energia' || cat === 'descuento_potencia' ||
      cat === 'autoconsumo_variable' || cat === 'exceso_potencia' || cat === 'alquiler_equipos'
    if (esRegulado) continue

    const matches = EXTRA_PATTERNS.some((re) => re.test(desc))
    if (!matches) continue

    const importeMensual = total / meses
    if (importeMensual > 50) continue

    detected.push({
      concepto: desc,
      importe: redondear2(total),
      importeMensual: redondear2(importeMensual),
      importeAnual: redondear2(importeMensual * 12),
    })
  }

  const seen = new Set<string>()
  return detected.filter((e) => {
    const key = e.concepto.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}
