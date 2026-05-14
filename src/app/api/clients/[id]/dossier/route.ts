/**
 * GET /api/clients/{id}/dossier
 *
 * Genera (o reutiliza) el magic link del cliente y devuelve un dossier PDF
 * Voltis con QR. Generado con pdf-lib (pure JS), funciona en cualquier
 * entorno serverless sin depender de Chromium.
 *
 * El dossier muestra:
 *   • Branding Voltis editorial (verde bosque + lima)
 *   • Nombre del cliente
 *   • QR para abrir el portal desde móvil
 *   • Enlace en texto plano (copiable)
 *   • Funcionalidades del portal
 *   • Datos de contacto Voltis
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { findOrCreatePortalLink } from '@/lib/portal-data'
import { buildDossierPdf } from '@/lib/dossier-pdf'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerSupabaseClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: prof } = await sb.from('users_profile').select('id, role').eq('id', user.id).maybeSingle()
  if (!prof) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { data: client } = await sb
    .from('clients')
    .select('id, name, alias')
    .eq('id', params.id)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

  const { token, existed } = await findOrCreatePortalLink(params.id, prof.id)
  const clientName = client.alias || client.name
  const filenameBase = (clientName || 'cliente').toLowerCase().replace(/[^a-z0-9]+/g, '-')

  try {
    const pdf = await buildDossierPdf({ clientName, token })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="voltis-acceso-${filenameBase}.pdf"`,
        'X-Link-Existed': existed ? 'true' : 'false',
        'X-Portal-Link': `${process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'}/portal/${token}`,
      },
    })
  } catch (e: any) {
    console.error('[dossier] PDF generation failed:', e?.message, e?.stack)
    return NextResponse.json({
      error: 'No se pudo generar el dossier PDF. Inténtalo de nuevo.',
      detail: e?.message,
    }, { status: 500 })
  }
}
