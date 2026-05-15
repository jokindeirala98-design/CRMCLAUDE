/**
 * Admin · gestión de portal_users desde el CRM
 * ──────────────────────────────────────────────────────────────────────
 *  GET    /api/admin/portal-users?client_id=...   → lista usuarios de un cliente
 *  POST   /api/admin/portal-users                 → crear usuario + enviar invitación
 *  DELETE /api/admin/portal-users?id=...          → desactivar usuario
 *
 * Solo accesible para usuarios admin del CRM. Usa Supabase Auth para
 * verificar el rol, y la service role key para escribir en portal_*.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createMagicLink } from '@/lib/portal/auth'
import { sendPortalMagicLinkEmail } from '@/lib/portal/email'
import { getPortalBaseUrl } from '@/lib/portal/host'

export const runtime = 'nodejs'

async function requireAdmin() {
  const sb = await createServerSupabaseClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: profile } = await sb
    .from('users_profile')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.role !== 'admin') return null
  return { userId: user.id }
}

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

// ── GET — listar portal_users de un cliente ──────────────────────────────

export async function GET(req: NextRequest) {
  const me = await requireAdmin()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id requerido' }, { status: 400 })

  const sb = admin()
  const { data, error } = await sb
    .from('portal_users')
    .select('id, email, display_name, role, active, last_login_at, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data })
}

// ── POST — crear usuario + enviar primer magic link ─────────────────────

export async function POST(req: NextRequest) {
  const me = await requireAdmin()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const clientId  = String(body?.client_id || '').trim()
  const email     = String(body?.email || '').trim().toLowerCase()
  const display   = body?.display_name ? String(body.display_name).trim() : null
  const role      = body?.role === 'admin' ? 'admin' : 'viewer'
  const sendNow   = body?.send_invite !== false

  if (!clientId || !email || !email.includes('@')) {
    return NextResponse.json({ error: 'client_id y email son obligatorios' }, { status: 400 })
  }

  const sb = admin()

  // Upsert: si ya existe el par (client_id, email), lo reactivamos
  const { data: existing } = await sb
    .from('portal_users')
    .select('id, active')
    .eq('client_id', clientId)
    .eq('email', email)
    .maybeSingle()

  let userId: string
  if (existing) {
    userId = existing.id
    await sb.from('portal_users')
      .update({ active: true, display_name: display, role, invited_by_crm: me.userId })
      .eq('id', userId)
  } else {
    const { data: created, error } = await sb.from('portal_users').insert({
      client_id: clientId,
      email,
      display_name: display,
      role,
      invited_by_crm: me.userId,
    }).select('id').maybeSingle()
    if (error || !created) {
      return NextResponse.json({ error: error?.message || 'No se pudo crear el usuario' }, { status: 500 })
    }
    userId = created.id
  }

  // Si el admin pide enviar invitación, generamos magic link + email
  if (sendNow) {
    const link = await createMagicLink(email, getPortalBaseUrl())
    if (link) {
      try {
        await sendPortalMagicLinkEmail({ to: link.email, url: link.url, expiresAt: link.expiresAt })
      } catch (e) {
        // Si falla el email, devolvemos el link al admin para que lo
        // copie y lo mande manualmente.
        return NextResponse.json({
          ok: true, userId, email_sent: false, manual_url: link.url,
        })
      }
    }
  }

  return NextResponse.json({ ok: true, userId, email_sent: sendNow })
}

// ── DELETE — desactivar usuario ─────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const me = await requireAdmin()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const sb = admin()
  // Desactivamos en lugar de borrar para preservar el log de auditoría
  const { error } = await sb.from('portal_users').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Revocamos todas sus sesiones activas
  await sb.from('portal_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('portal_user_id', id)
    .is('revoked_at', null)

  return NextResponse.json({ ok: true })
}
