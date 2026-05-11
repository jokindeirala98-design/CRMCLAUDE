import { NextRequest, NextResponse } from 'next/server'
import { calcularComparativa, type InputComparativa } from '@/lib/comparativas/calcular'
import {
  generateComparativaPDF,
  type ComparativaPdfData,
} from '@/lib/comparativas/generate-comparativa-pdf'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ── POST /api/comparativas/generar-pdf ───────────────────────────────────────
//
// Toma los inputs del cálculo + datos del cliente/suministro + extras
// seleccionados, ejecuta el motor y devuelve el PDF binario de la comparativa
// listo para descargar.
//
// Body:
//   {
//     input: InputComparativa,
//     cliente?: { nombre, dni, email, telefono },
//     suministro?: { cups, direccion, distribuidora, comercializadoraActual, tarifa },
//     extras?: [{ concepto, importeAnual }],
//     numero?: string
//   }
//
// Respuesta: application/pdf

export async function POST(request: NextRequest) {
  // Auth
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => null) as any
    if (!body || typeof body !== 'object' || !body.input) {
      return NextResponse.json(
        { ok: false, error: 'body.input es requerido' },
        { status: 400 },
      )
    }

    const input = normalizarInput(body.input)
    const resultado = calcularComparativa(input)

    // Datos del comercial: del usuario autenticado de Supabase
    let comercialNombre: string | undefined
    let comercialEmail: string | undefined = user.email ?? undefined
    try {
      const { data: profile } = await supabase
        .from('users_profile')
        .select('full_name, email')
        .eq('id', user.id)
        .single()
      if (profile) {
        comercialNombre = (profile.full_name as string | null) ?? undefined
        comercialEmail = (profile.email as string | null) ?? comercialEmail
      }
    } catch {
      /* perfil opcional */
    }

    const fecha = new Date().toISOString().slice(0, 10)
    const pdfData: ComparativaPdfData = {
      numero: typeof body.numero === 'string' ? body.numero : `COMP-${fecha.replace(/-/g, '')}`,
      fecha,
      cliente: sanitizeObj(body.cliente, ['nombre', 'dni', 'email', 'telefono']),
      suministro: sanitizeObj(body.suministro, [
        'cups',
        'direccion',
        'distribuidora',
        'comercializadoraActual',
        'tarifa',
      ]),
      comercial: { nombre: comercialNombre, email: comercialEmail },
      resultado,
      extras: sanitizeExtras(body.extras),
    }

    const pdfBuffer = generateComparativaPDF(pdfData)

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBuffer.length),
        'Content-Disposition': `attachment; filename="${pdfData.numero}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[api/comparativas/generar-pdf] Error:', err)
    const status = err?.message?.startsWith?.('Input de comparativa inválido') ? 400 : 500
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Error generando PDF' },
      { status },
    )
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

function normalizarInput(raw: any): InputComparativa {
  return {
    potencias: { p1: num(raw?.potencias?.p1), p2: num(raw?.potencias?.p2) },
    energias: {
      punta: num(raw?.energias?.punta),
      llano: num(raw?.energias?.llano),
      valle: num(raw?.energias?.valle),
    },
    dias: num(raw?.dias, 365),
    ivaPct: num(raw?.ivaPct, 10),
    totalFacturaActual: num(raw?.totalFacturaActual),
    alquiler: raw?.alquiler !== undefined ? num(raw.alquiler) : 0,
    descuentoDespuesIva:
      raw?.descuentoDespuesIva !== undefined ? num(raw.descuentoDespuesIva) : 0,
  }
}

function sanitizeObj<K extends string>(
  obj: any,
  allowedKeys: K[],
): Partial<Record<K, string>> | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const out: Partial<Record<K, string>> = {}
  for (const k of allowedKeys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeExtras(extras: any): { concepto: string; importeAnual: number }[] | undefined {
  if (!Array.isArray(extras)) return undefined
  const out: { concepto: string; importeAnual: number }[] = []
  for (const e of extras) {
    const concepto = typeof e?.concepto === 'string' ? e.concepto.trim() : ''
    const importeAnual = num(e?.importeAnual)
    if (concepto && importeAnual > 0) out.push({ concepto, importeAnual })
  }
  return out.length > 0 ? out : undefined
}
