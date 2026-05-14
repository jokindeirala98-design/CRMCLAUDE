/**
 * POST /api/gana/validate
 *
 * Proxy a las validaciones de Gana (IBAN, teléfono). Útil para wizards de
 * contrato 2.0 — antes de enviar el POST /contract validamos campos clave.
 *
 * Body: { type: 'iban' | 'telefono', value: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { validarIban, validarTelefono } from '@/lib/gana-api'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { type, value } = await req.json()
    if (!type || !value || typeof value !== 'string') {
      return NextResponse.json({ error: 'type y value son obligatorios' }, { status: 400 })
    }

    if (type === 'iban') {
      const result = await validarIban(value)
      return NextResponse.json(result)
    }
    if (type === 'telefono') {
      const result = await validarTelefono(value)
      return NextResponse.json(result)
    }
    return NextResponse.json({ error: 'type debe ser iban o telefono' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Internal error', body: e?.body }, { status: 500 })
  }
}
