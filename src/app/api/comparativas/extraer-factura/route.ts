import { NextRequest, NextResponse } from 'next/server'
import { analyzeInvoice, getMimeType } from '@/lib/gemini'
import { normalizeTariff } from '@/lib/consumption-utils'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// La extracción puede tardar (modelo + retries). Dejamos margen como en
// /api/analyze-invoice. Vercel Pro permite hasta 300 s.
export const maxDuration = 120

// ── POST /api/comparativas/extraer-factura ───────────────────────────────────
//
// Wrapper sobre analyzeInvoice() pensado para el flujo de Comparativas 2.0.
// Toma una factura (PDF/JPG/PNG, opcionalmente con extra_pages) y devuelve un
// objeto plano listo para alimentar el motor calcularComparativa:
//
//   {
//     cups, comercializadora, tarifa, supplyAddress, fechaInicio, fechaFin,
//     dias, potencias: { p1, p2 }, energias: { punta, llano, valle },
//     totalFactura,
//     preciosUnitarios: { kwDia: { p1, p2 }, kwh: { punta, llano, valle } },
//     extrasOpcionales: [{ concepto, importeMensual, importeAnual }],
//     warnings: string[],
//   }
//
// extrasOpcionales: detecta packs/servicios opcionales que el cliente paga a su
// comercializadora actual (Smart Iberdrola, Pack Family, Seguros Hogar,
// mantenimiento, asistencia técnica, club...) — al cambiarse a Gana esos
// servicios desaparecen, así que cuentan como ahorro extra anual.
//
// Solo acepta tarifa 2.0TD. Si la factura es 3.0TD/6.1TD/RL.x devuelve 422
// con un mensaje claro para que la UI muestre un banner.

interface InvoicePage {
  file_base64: string
  file_type?: string
  file_name?: string
}

interface RequestBody extends InvoicePage {
  extra_pages?: InvoicePage[]
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

    const extracted = await analyzeInvoice(
      body.file_base64,
      mimeType,
      extraPages?.length ? extraPages : undefined,
    )

    if (extracted.error) {
      return NextResponse.json(
        { ok: false, error: extracted.error },
        { status: 502 },
      )
    }

    if (extracted.documentType !== 'factura') {
      return NextResponse.json(
        {
          ok: false,
          error: `El documento subido no parece una factura energética (detectado: ${extracted.documentType ?? 'desconocido'}).`,
        },
        { status: 422 },
      )
    }

    if (extracted.supply_type && extracted.supply_type !== 'luz') {
      return NextResponse.json(
        {
          ok: false,
          error: `Solo se admiten facturas de luz por ahora (detectado: ${extracted.supply_type}).`,
        },
        { status: 422 },
      )
    }

    const tarifa = normalizeTariff(extracted.tariff || '') || extracted.tariff || ''
    if (tarifa && tarifa !== '2.0TD') {
      return NextResponse.json(
        {
          ok: false,
          error: `Solo se admite tarifa 2.0TD por ahora. La factura tiene tarifa ${tarifa}.`,
          tarifaDetectada: tarifa,
        },
        { status: 422 },
      )
    }

    // ── Mapeo del economics rico → shape del comparador ───────────────────
    const eco: any = extracted.economics ?? {}
    const consumo: any[] = Array.isArray(eco.consumo) ? eco.consumo : []
    const potencia: any[] = Array.isArray(eco.potencia) ? eco.potencia : []

    const warnings: string[] = []

    // Potencias por periodo (P1=Punta, P2=Valle en 2.0TD)
    const potP1 = findPeriodo(potencia, 'P1')
    const potP2 = findPeriodo(potencia, 'P2') ?? findPeriodo(potencia, 'P3')
    const kwP1 = num(potP1?.kw)
    const kwP2 = num(potP2?.kw) ?? kwP1 // En 2.0TD suelen ser iguales
    const precioKwDiaP1 = num(potP1?.precioKwDia)
    const precioKwDiaP2 = num(potP2?.precioKwDia)
    if (potP1 == null) warnings.push('No se encontró potencia P1 en la factura.')
    if (potP1 != null && potP2 == null) warnings.push('No se encontró potencia P2; se asume igual que P1.')
    if (precioKwDiaP1 == null) warnings.push('No se encontró el precio €/kW·día P1.')
    if (precioKwDiaP2 == null) warnings.push('No se encontró el precio €/kW·día P2.')

    // Energías por periodo. En 2.0TD la energía puede venir:
    //  - por periodos: P1=Punta, P2=Llano, P3=Valle (algunas comercializadoras
    //    usan P2=Valle directo si solo hay 2 periodos en su tarifa)
    //  - como flat único (periodo=null) — entonces no podemos desglosar y el
    //    usuario tendrá que rellenar a mano.
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

    if (kwhPunta == null && kwhLlano == null && kwhValle == null && flatEnergia) {
      // Flat único — lo asignamos a Punta y avisamos
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

    // Días y fechas del periodo facturado
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

    // ── Extras opcionales (packs, seguros, mantenimiento...) ───────────────
    // Estos cargos desaparecen al cambiarse a Gana → cuentan como ahorro extra.
    const rawLineItems: any[] = Array.isArray(eco.rawLineItems) ? eco.rawLineItems : []
    const extrasOpcionales = detectarExtrasOpcionales(rawLineItems, dias)
    if (extrasOpcionales.length > 0) {
      warnings.push(
        `Se detectaron ${extrasOpcionales.length} servicio(s) opcional(es) en la factura (packs/seguros/mantenimiento). Revísalos en la sección de extras.`,
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        cups: extracted.cups ?? null,
        comercializadora: extracted.comercializadora ?? null,
        tarifa: tarifa || '2.0TD',
        supplyAddress: extracted.supply_address ?? null,
        fechaInicio,
        fechaFin,
        dias,
        potencias: { p1: kwP1 ?? 0, p2: kwP2 ?? 0 },
        energias: {
          punta: kwhPunta ?? 0,
          llano: kwhLlano ?? 0,
          valle: kwhValle ?? 0,
        },
        totalFactura: totalFactura ?? 0,
        preciosUnitarios: {
          kwDia: { p1: precioKwDiaP1 ?? 0, p2: precioKwDiaP2 ?? 0 },
          kwh: {
            punta: precioKwhPunta ?? 0,
            llano: precioKwhLlano ?? 0,
            valle: precioKwhValle ?? 0,
          },
        },
        extrasOpcionales,
        warnings,
        modoExtraccion: extracted.mode,
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function findPeriodo<T extends { periodo?: string | null }>(
  arr: T[],
  periodo: string,
): T | null {
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
// Patrones típicos de servicios añadidos que las grandes comercializadoras
// venden adjuntos a la luz: Smart Iberdrola, Pack Family, Seguros Hogar,
// Mantenimiento, Tranquilidad, Club Iberdrola, Asistencia técnica, etc.
// Coste típico 3–10 €/mes. Al cambiar de comercializadora estos servicios
// desaparecen → se convierten en ahorro extra.

const EXTRA_PATTERNS = [
  /smart/i,                 // Smart Iberdrola, Smart Solar
  /\bpack\b/i,              // Pack Family, Pack Tranquilidad, Pack Hogar
  /seguro/i,                // Seguro hogar, seguro electrodomésticos
  /mantenimi/i,             // Mantenimiento, mantenimiento integral
  /tranquilidad/i,          // Tranquilidad, tarifa tranquilidad
  /asistencia/i,            // Asistencia técnica, asistencia 24h
  /asesor/i,                // Asesor energético
  /\bclub\b/i,              // Club Iberdrola, Club Energía
  /aver[ií]as/i,            // Averías, cobertura averías
  /\bhogar\b/i,             // Servicio hogar (cuidado: filtramos solo si es servicio)
  /repsol\s+(plus|pro)/i,   // Repsol Plus
  /ok\s*plan/i,             // Plan Endesa OK
  /reparaciones?\b/i,
  /electrodomestic/i,
  /protecci[óo]n/i,         // Protección hogar
]

interface ExtraOpcional {
  concepto: string
  importe: number          // Importe que aparece en esta factura (€)
  importeMensual: number   // Estimado mensual (€)
  importeAnual: number     // Estimado anual (€/año)
}

function detectarExtrasOpcionales(
  items: any[],
  diasFactura: number,
): ExtraOpcional[] {
  if (!Array.isArray(items) || items.length === 0) return []

  const meses = diasFactura > 0 ? diasFactura / 30 : 1
  const detected: ExtraOpcional[] = []

  for (const it of items) {
    const desc = String(it?.description ?? '').trim()
    if (!desc) continue
    const total = num(it?.total)
    // Solo nos interesan cargos positivos en el rango típico de packs (1–25 €/mes)
    if (total == null || total <= 0) continue

    // Excluimos categorías que ya identificamos como cargos regulados
    const cat = String(it?.category ?? '').toLowerCase()
    const esRegulado =
      cat.startsWith('energia_') ||
      cat.startsWith('potencia_') ||
      cat.startsWith('gas_') ||
      cat === 'impuesto_electrico' ||
      cat === 'impuesto_hidrocarburos' ||
      cat === 'iva' ||
      cat === 'bono_social' ||
      cat === 'compensacion_excedentes' ||
      cat === 'descuento_energia' ||
      cat === 'descuento_potencia' ||
      cat === 'autoconsumo_variable' ||
      cat === 'exceso_potencia' ||
      cat === 'alquiler_equipos'
    if (esRegulado) continue

    // Patrón en la descripción
    const matches = EXTRA_PATTERNS.some((re) => re.test(desc))
    if (!matches) continue

    // Filtro de magnitud razonable: < 50 €/mes equivalente
    const importeMensual = total / meses
    if (importeMensual > 50) continue

    detected.push({
      concepto: desc,
      importe: redondear2(total),
      importeMensual: redondear2(importeMensual),
      importeAnual: redondear2(importeMensual * 12),
    })
  }

  // Deduplicar por concepto similar (ignora casing y espacios)
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
