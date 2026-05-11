/**
 * GET  /api/admin/comercializadora-formats
 *   Devuelve todas las entradas con métricas de extracción.
 *
 * PATCH /api/admin/comercializadora-formats
 *   Actualiza notas de extracción de una comercializadora.
 *   Body: { id: string, notas_extraccion?: string, confianza?: number, activa?: boolean, aliases?: string[] }
 *
 * POST /api/admin/comercializadora-formats/registrar-resultado
 *   Endpoint para registrar el resultado de una extracción manual (aprendizaje).
 *   Body: { nombre: string, ok: boolean, notas?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

// GET — lista con métricas
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getServiceClient()
  const { data, error } = await db
    .from('comercializadora_formats')
    .select('*')
    .order('facturas_procesadas', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Calcular tasa de éxito
  const enriched = (data ?? []).map((f: any) => ({
    ...f,
    tasa_exito: f.facturas_procesadas > 0
      ? Math.round((f.extracciones_ok / f.facturas_procesadas) * 100)
      : null,
  }))

  return NextResponse.json({ data: enriched })
}

// PATCH — actualizar notas/confianza/aliases
export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const { id, notas_extraccion, confianza, activa, aliases, nombre } = body
  const update: Record<string, any> = { actualizado_en: new Date().toISOString() }
  if (notas_extraccion !== undefined) update.notas_extraccion = notas_extraccion
  if (confianza !== undefined) update.confianza = Number(confianza)
  if (activa !== undefined) update.activa = Boolean(activa)
  if (aliases !== undefined) update.aliases = aliases
  if (nombre !== undefined) update.nombre = nombre

  const db = getServiceClient()
  const { data, error } = await db
    .from('comercializadora_formats')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data })
}

// POST — registrar resultado de extracción (aprendizaje manual)
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.nombre) return NextResponse.json({ error: 'nombre requerido' }, { status: 400 })

  const { nombre, ok, notas } = body
  const db = getServiceClient()
  const now = new Date().toISOString()

  // Buscar el formato
  const { data: fmt } = await db
    .from('comercializadora_formats')
    .select('id, facturas_procesadas, extracciones_ok, extracciones_error, notas_extraccion')
    .ilike('nombre', `%${nombre}%`)
    .limit(1)
    .single()

  if (!fmt) {
    // Crear entrada nueva si no existe
    const { data: nueva, error } = await db.from('comercializadora_formats').insert({
      nombre,
      notas_extraccion: notas ?? null,
      facturas_procesadas: 1,
      extracciones_ok: ok ? 1 : 0,
      extracciones_error: ok ? 0 : 1,
      fuente: 'aprendizaje_manual',
      confianza: ok ? 50 : 20,
      ...(ok ? { ultima_extraccion_ok: now } : { ultima_extraccion_error: now }),
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, created: true, data: nueva })
  }

  // Actualizar entrada existente
  const update: Record<string, any> = {
    facturas_procesadas: (fmt.facturas_procesadas ?? 0) + 1,
    actualizado_en: now,
  }
  if (ok) {
    update.extracciones_ok = (fmt.extracciones_ok ?? 0) + 1
    update.ultima_extraccion_ok = now
    // Subir confianza si consistentemente bien
    const newOk = update.extracciones_ok
    const total = update.facturas_procesadas
    if (total >= 3 && newOk / total >= 0.8) {
      update.fuente = 'aprendizaje'
    }
  } else {
    update.extracciones_error = (fmt.extracciones_error ?? 0) + 1
    update.ultima_extraccion_error = now
  }
  // Appendar notas si se proporcionan
  if (notas) {
    const notasActuales = fmt.notas_extraccion ?? ''
    const marcaTiempo = new Date().toLocaleDateString('es-ES')
    update.notas_extraccion = notasActuales
      ? `${notasActuales}\n\n[${marcaTiempo}] ${notas}`
      : `[${marcaTiempo}] ${notas}`
  }

  const { data: updated, error } = await db
    .from('comercializadora_formats')
    .update(update)
    .eq('id', fmt.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, created: false, data: updated })
}
