import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  getSharedCalendarToken,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar'

const TYPE_LABELS: Record<string, string> = {
  presentation: 'Presentación',
  followup:     'Seguimiento',
  signing:      'Firma',
  other:        'Cita',
}

// Google Calendar colorId 1-11
const TYPE_COLORS: Record<string, string> = {
  presentation: '9',  // blueberry
  followup:     '2',  // sage
  signing:      '5',  // banana
  other:        '8',  // graphite
}

/**
 * POST /api/google/sync-appointment
 *
 * Sincroniza una cita con el calendario compartido "Voltis CRM".
 * Se invoca tras crear/actualizar/eliminar una cita en la agenda.
 *
 * Body: { appointmentId } | webhook { type, record, old_record }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Shared calendar tokens
    const shared = await getSharedCalendarToken()
    if (!shared) {
      return NextResponse.json({ skipped: 'shared calendar not connected' })
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const isWebhook = 'type' in body && 'record' in body
    const eventType: string = isWebhook ? body.type : 'UPSERT'

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (eventType === 'DELETE') {
      const old = body.old_record
      if (!old?.google_event_id) return NextResponse.json({ skipped: 'no event to delete' })
      await deleteCalendarEvent(shared.accessToken, shared.calendarId, old.google_event_id)
      return NextResponse.json({ ok: true, action: 'deleted' })
    }

    // ── CREATE / UPDATE ───────────────────────────────────────────────────────
    const appointmentId: string = isWebhook ? body.record?.id : body.appointmentId
    if (!appointmentId) return NextResponse.json({ error: 'Missing appointmentId' }, { status: 400 })

    const { data: apt, error } = await admin
      .from('appointments')
      .select(`
        *,
        client:clients(name),
        commercial:users_profile!commercial_id(full_name, email)
      `)
      .eq('id', appointmentId)
      .single()

    if (error || !apt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const typeLabel      = TYPE_LABELS[apt.type] || 'Cita'
    const clientName     = apt.client?.name      || 'Cliente'
    const commercialName = apt.commercial?.full_name || 'Comercial'
    const isGroup        = apt.is_group_event === true

    // Title: "Presentación — Bar Estella · [Jokin]"  o  "🌐 Cita grupo — Bar Estella · [Jokin]"
    const prefix  = isGroup ? '🌐 Cita grupo' : typeLabel
    const summary = `${prefix} — ${clientName} · [${commercialName}]`

    const startDt = new Date(apt.scheduled_at)
    const endDt   = new Date(startDt.getTime() + 60 * 60 * 1000) // +1 h por defecto

    // Description
    const lines = [
      `📋 Tipo: ${typeLabel}`,
      `👤 Creado por: ${commercialName}`,
      isGroup ? '🌐 Cita de grupo (todo el equipo)' : '',
      apt.location ? `📍 ${apt.location}` : '',
      apt.notes    ? `\n💬 ${apt.notes}` : '',
      '\n— Voltis CRM',
    ].filter(Boolean)

    const gcalEvent = {
      summary,
      description: lines.join('\n'),
      location:    apt.location || undefined,
      colorId:     isGroup ? '11' : (TYPE_COLORS[apt.type] || '8'), // tomato para grupo
      start: { dateTime: startDt.toISOString(), timeZone: 'Europe/Madrid' },
      end:   { dateTime: endDt.toISOString(),   timeZone: 'Europe/Madrid' },
    }

    if (apt.google_event_id) {
      // Update existing event
      const ok = await updateCalendarEvent(
        shared.accessToken,
        shared.calendarId,
        apt.google_event_id,
        gcalEvent
      )
      return NextResponse.json({ ok, action: 'updated', eventId: apt.google_event_id })
    } else {
      // Create new event
      const eventId = await createCalendarEvent(shared.accessToken, shared.calendarId, gcalEvent)
      if (eventId) {
        await admin
          .from('appointments')
          .update({ google_event_id: eventId })
          .eq('id', appointmentId)
      }
      return NextResponse.json({ ok: true, action: 'created', eventId })
    }
  } catch (err: any) {
    console.error('[sync-appointment] error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
