import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  getUserTokens,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar'

const TYPE_LABELS: Record<string, string> = {
  presentation: 'Presentación',
  followup: 'Seguimiento',
  signing: 'Firma',
  other: 'Cita',
}

// Color mapping for appointment types (Google Calendar colorId 1-11)
const TYPE_COLORS: Record<string, string> = {
  presentation: '1', // lavender-blue
  followup: '2',     // sage green
  signing: '5',      // banana yellow
  other: '8',        // graphite
}

/**
 * POST /api/google/sync-appointment
 *
 * Called by Supabase Database Webhook (INSERT / UPDATE on appointments).
 * Body: { type: 'INSERT'|'UPDATE'|'DELETE', record: { id, ... }, old_record?: { ... } }
 *
 * Also callable directly from the app with { appointmentId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Support both webhook format and direct call format
    const isWebhook = 'type' in body && 'record' in body
    const eventType: string = isWebhook ? body.type : 'UPSERT'
    const record = isWebhook ? body.record : null
    const appointmentId: string = record?.id || body.appointmentId

    if (!appointmentId) {
      return NextResponse.json({ error: 'Missing appointmentId' }, { status: 400 })
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // Handle DELETE
    if (eventType === 'DELETE') {
      const oldRecord = body.old_record
      if (!oldRecord?.google_event_id || !oldRecord?.commercial_id) {
        return NextResponse.json({ skipped: 'no google event to delete' })
      }
      const tokens = await getUserTokens(oldRecord.commercial_id)
      if (!tokens) return NextResponse.json({ skipped: 'no google token' })
      await deleteCalendarEvent(tokens.accessToken, tokens.calendarId, oldRecord.google_event_id)
      return NextResponse.json({ ok: true, action: 'deleted' })
    }

    // Fetch full appointment with client name
    const { data: apt, error } = await admin
      .from('appointments')
      .select('*, client:clients(name)')
      .eq('id', appointmentId)
      .single()

    if (error || !apt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Get Google tokens for the commercial assigned to this appointment
    const tokens = await getUserTokens(apt.commercial_id)
    if (!tokens) {
      return NextResponse.json({ skipped: 'user has no google calendar connected' })
    }

    const typeLabel = TYPE_LABELS[apt.type] || 'Cita'
    const clientName = apt.client?.name || 'Cliente'
    const summary = `${typeLabel} — ${clientName}`

    const startDt = new Date(apt.scheduled_at)
    const endDt = new Date(startDt.getTime() + 60 * 60 * 1000) // +1 hour

    const gcalEvent = {
      summary,
      description: apt.notes
        ? `${apt.notes}\n\n— Voltis CRM`
        : `${typeLabel} con ${clientName}\n\n— Voltis CRM`,
      location: apt.location || undefined,
      colorId: TYPE_COLORS[apt.type] || '8',
      start: { dateTime: startDt.toISOString(), timeZone: 'Europe/Madrid' },
      end: { dateTime: endDt.toISOString(), timeZone: 'Europe/Madrid' },
    }

    if (apt.google_event_id) {
      // Update existing event
      const ok = await updateCalendarEvent(
        tokens.accessToken,
        tokens.calendarId,
        apt.google_event_id,
        gcalEvent
      )
      return NextResponse.json({ ok, action: 'updated', eventId: apt.google_event_id })
    } else {
      // Create new event
      const eventId = await createCalendarEvent(tokens.accessToken, tokens.calendarId, gcalEvent)
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
