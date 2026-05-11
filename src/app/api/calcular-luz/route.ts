import { NextRequest, NextResponse } from 'next/server'
import {
  calcularComparativa,
  type InputComparativa,
} from '@/lib/comparativas/calcular'

// ── POST /api/calcular-luz ───────────────────────────────────────────────────
// Recibe los inputs del comparador y devuelve la comparativa para las 3 tarifas
// 2.0TD de Gana en paralelo. El cálculo se hace localmente con los precios
// extraídos del endpoint de Gana (validado al céntimo).
//
// Body esperado: InputComparativa (ver src/lib/comparativas/calcular.ts)
// Respuesta: { ok: true, data: ResultadoComparativa } | { ok: false, error }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'Body JSON requerido' },
        { status: 400 },
      )
    }

    const input = normalizar(body)
    const data = calcularComparativa(input)

    return NextResponse.json({ ok: true, data })
  } catch (err: any) {
    const msg = err?.message ?? 'Error inesperado'
    console.error('[api/calcular-luz] Error:', msg)
    // Errores de validación → 400, fallos internos → 500
    const status = msg.startsWith('Input de comparativa inválido') ? 400 : 500
    return NextResponse.json({ ok: false, error: msg }, { status })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizar(raw: any): InputComparativa {
  // Acepta tanto strings con coma decimal como números directos
  const num = (v: unknown, fallback = 0): number => {
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const parsed = parseFloat(v.replace(',', '.'))
      return Number.isFinite(parsed) ? parsed : fallback
    }
    return fallback
  }

  return {
    potencias: {
      p1: num(raw.potencias?.p1),
      p2: num(raw.potencias?.p2),
    },
    energias: {
      punta: num(raw.energias?.punta),
      llano: num(raw.energias?.llano),
      valle: num(raw.energias?.valle),
    },
    dias: num(raw.dias),
    ivaPct: num(raw.ivaPct, 10),
    totalFacturaActual: num(raw.totalFacturaActual),
    alquiler: raw.alquiler !== undefined ? num(raw.alquiler) : 0,
    descuentoDespuesIva:
      raw.descuentoDespuesIva !== undefined ? num(raw.descuentoDespuesIva) : 0,
  }
}
