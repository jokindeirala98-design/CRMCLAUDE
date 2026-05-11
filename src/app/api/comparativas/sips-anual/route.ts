import { NextRequest, NextResponse } from 'next/server'
import { fetchSipsForCups } from '@/lib/sips'
import { normalizeCups } from '@/lib/utils/cups'
import { normalizeTariff } from '@/lib/consumption-utils'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ── POST /api/comparativas/sips-anual ────────────────────────────────────────
//
// Wrapper sobre la integración SIPS existente para devolver al comparador un
// shape compacto con el consumo anual real por periodo y la potencia oficial
// contratada del CUPS.
//
// Body: { cups: string }
// Respuesta:
//   {
//     ok: true,
//     data: {
//       cups, tarifa, distribuidora, codigoPostal, provincia, municipio,
//       potenciasContratadas: { p1, p2 },           // kW oficiales SIPS
//       consumoAnual: { punta, llano, valle, total }, // kWh anuales (P1, P2, P3)
//       diasCobertura: number,                       // días que cubre el dato
//     }
//   }
//
// Solo acepta tarifa 2.0TD. Si SIPS reporta otra tarifa, devolvemos 422.

export async function POST(request: NextRequest) {
  // Auth
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => null) as { cups?: string } | null
    const cupsInput = body?.cups
    if (!cupsInput) {
      return NextResponse.json({ ok: false, error: 'cups es requerido' }, { status: 400 })
    }

    const cups = normalizeCups(cupsInput)
    if (!cups) {
      return NextResponse.json({ ok: false, error: 'Formato de CUPS inválido' }, { status: 400 })
    }

    const sips = await fetchSipsForCups(cups, 'luz')
    if (!sips) {
      return NextResponse.json(
        { ok: false, error: 'SIPS no devolvió datos para este CUPS. Puede que la distribuidora no tenga histórico o que el suministro sea muy reciente.' },
        { status: 404 },
      )
    }

    // Tarifa
    const tarifa = normalizeTariff(sips.tariff || '') || sips.tariff || ''
    if (tarifa && tarifa !== '2.0TD') {
      return NextResponse.json(
        {
          ok: false,
          error: `Solo se admite tarifa 2.0TD por ahora. SIPS reporta ${tarifa} para este CUPS.`,
          tarifaDetectada: tarifa,
        },
        { status: 422 },
      )
    }

    // ── Consumo anual: priorizamos consumptionHistory (12 meses reales) ───
    // y usamos consumoPeriodos como fallback si no hay histórico.
    const history = Array.isArray(sips.consumptionHistory) ? sips.consumptionHistory : []
    let punta = 0
    let llano = 0
    let valle = 0
    let diasCobertura = 0

    if (history.length > 0) {
      // Tomamos hasta los últimos 12 entries (mensuales típicamente)
      const last12 = history.slice(0, 12)
      for (const h of last12) {
        punta += num(h.P1) ?? 0
        llano += num(h.P2) ?? 0
        valle += num(h.P3) ?? 0
        diasCobertura += diasDesdeFechas(h.fechaInicio, h.fechaFin) ?? estimaDiasMes(h.fecha) ?? 30
      }
    } else if (sips.consumoPeriodos) {
      // Fallback: si solo tenemos el consumo agregado, asumimos que es anual
      punta = num(sips.consumoPeriodos.P1) ?? 0
      llano = num(sips.consumoPeriodos.P2) ?? 0
      valle = num(sips.consumoPeriodos.P3) ?? 0
      diasCobertura = 365
    } else {
      return NextResponse.json(
        { ok: false, error: 'SIPS no contiene datos de consumo para este CUPS.' },
        { status: 404 },
      )
    }

    const total = round1(punta + llano + valle)

    // Potencias contratadas oficiales (P1, P2 en 2.0TD)
    const pot = sips.potenciaContratada
    const potP1 = pot ? num(pot.P1) ?? 0 : 0
    const potP2 = pot ? (num(pot.P2) ?? num(pot.P1) ?? 0) : potP1

    return NextResponse.json({
      ok: true,
      data: {
        cups,
        tarifa: tarifa || '2.0TD',
        distribuidora: sips.distribuidora ?? null,
        codigoPostal: sips.codigoPostal ?? null,
        provincia: sips.provincia ?? null,
        municipio: sips.municipio ?? null,
        potenciasContratadas: { p1: potP1, p2: potP2 },
        consumoAnual: {
          punta: round1(punta),
          llano: round1(llano),
          valle: round1(valle),
          total,
        },
        diasCobertura,
        fuente: history.length > 0 ? 'historial_12m' : 'agregado_periodo',
      },
    })
  } catch (err: any) {
    console.error('[api/comparativas/sips-anual] Error:', err)
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Error consultando SIPS' },
      { status: 500 },
    )
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function diasDesdeFechas(inicio: unknown, fin: unknown): number | null {
  if (typeof inicio !== 'string' || typeof fin !== 'string') return null
  const a = new Date(inicio)
  const b = new Date(fin)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
  return diff > 0 ? diff : null
}

function estimaDiasMes(fecha: unknown): number | null {
  if (typeof fecha !== 'string') return null
  // Acepta "YYYY-MM" o "YYYY-MM-DD"
  const match = fecha.match(/^(\d{4})-(\d{1,2})/)
  if (!match) return null
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  if (!year || !month) return null
  // Días reales del mes
  return new Date(year, month, 0).getDate()
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
