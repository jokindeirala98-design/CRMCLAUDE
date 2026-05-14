/**
 * GET /api/clients/{id}/dossier
 *
 * Genera (o reutiliza) el magic link del cliente y devuelve un dossier HTML
 * imprimible. El usuario puede usar Ctrl+P → "Guardar como PDF" para tener
 * la copia local.
 *
 * Mantenemos HTML (no PDF nativo) para evitar el peso del runtime puppeteer
 * en cold-starts y para que cualquier dispositivo lo pueda abrir directamente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { findOrCreatePortalLink } from '@/lib/portal-data'
import { buildDossierHtml } from '@/lib/dossier-html'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerSupabaseClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Verificar rol
  const { data: prof } = await sb.from('users_profile').select('id, role').eq('id', user.id).maybeSingle()
  if (!prof) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { data: client } = await sb
    .from('clients')
    .select('id, name, alias')
    .eq('id', params.id)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

  const { token, existed } = await findOrCreatePortalLink(params.id, prof.id)
  const html = buildDossierHtml({
    clientName: client.alias || client.name,
    token,
  })

  const filename = `voltis-acceso-${(client.alias || client.name || 'cliente').toLowerCase().replace(/[^a-z0-9]+/g,'-')}.html`
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Link-Existed': existed ? 'true' : 'false',
      'X-Portal-Link': `${process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'}/portal/${token}`,
    },
  })
}
