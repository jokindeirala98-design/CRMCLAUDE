import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  getUserTokens,
  createCalendarEvent,
  updateCalendarEvent,
  buildTasksBriefingDescription,
} from '@/lib/google-calendar'

/**
 * POST /api/google/sync-tasks
 *
 * Called by:
 *   1. Supabase Database Webhook (INSERT/UPDATE/DELETE on tasks table)
 *   2. Vercel cron at 7:55am daily (/api/cron/daily-tasks)
 *   3. Directly from the app after task creation
 *
 * For each affected user, creates/updates a "📋 Tareas pendientes" event
 * at 8:00–8:15am today in their Google Calendar.
 *
 * Body (webhook): { type, record: { assigned_to, ... } }
 * Body (direct):  { userId }
 * Body (cron):    { all: true }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // Determine which user(s) to sync
    let userIds: string[] = []

    if (body.all) {
      // Cron mode: sync all users with Google Calendar connected
      const { data: profiles } = await admin
        .from('users_profile')
        .select('id')
        .not('google_refresh_token', 'is', null)
      userIds = (profiles || []).map((p: any) => p.id)
    } else if (body.userId) {
      userIds = [body.userId]
    } else if (body.record?.assigned_to) {
      userIds = [body.record.assigned_to]
    } else {
      return NextResponse.json({ skipped: 'no userId found' })
    }

    const results = await Promise.all(userIds.map((uid) => syncUserTasks(admin, uid)))
    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    console.error('[sync-tasks] error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function syncUserTasks(admin: any, userId: string): Promise<string> {
  // Get Google tokens
  const tokens = await getUserTokens(userId)
  if (!tokens) return `${userId}: no google token`

  // Get pending + in_progress tasks for this user
  const { data: tasks } = await admin
    .from('tasks')
    .select('title, priority, client:clients!client_id(name), due_date')
    .eq('assigned_to', userId)
    .in('status', ['pending', 'in_progress'])
    .order('priority', { ascending: true })
    .order('sort_order', { ascending: true })

  const todayStr = new Date().toISOString().split('T')[0] // yyyy-MM-dd

  // Build event content
  const summary = `📋 Tareas pendientes${tasks?.length ? ` (${tasks.length})` : ' — Todo al día'}`
  const description = buildTasksBriefingDescription(tasks || [])

  // Event time: 8:00–8:15am today, Madrid timezone
  const startDt = `${todayStr}T08:00:00`
  const endDt = `${todayStr}T08:15:00`

  const gcalEvent = {
    summary,
    description,
    colorId: '10', // basil (dark green)
    start: { dateTime: startDt, timeZone: 'Europe/Madrid' },
    end: { dateTime: endDt, timeZone: 'Europe/Madrid' },
  }

  // Check if we already have a tasks event for today
  const { data: profile } = await admin
    .from('users_profile')
    .select('google_tasks_event_id, google_tasks_event_date')
    .eq('id', userId)
    .single()

  const existingEventId: string | null = profile?.google_tasks_event_id
  const existingEventDate: string | null = profile?.google_tasks_event_date

  let eventId = existingEventId

  if (existingEventId && existingEventDate === todayStr) {
    // Update today's existing event
    const ok = await updateCalendarEvent(tokens.accessToken, tokens.calendarId, existingEventId, gcalEvent)
    if (!ok) {
      // Event may have been deleted in Google Calendar — create a new one
      eventId = await createCalendarEvent(tokens.accessToken, tokens.calendarId, gcalEvent)
    }
  } else {
    // Create a new event for today
    eventId = await createCalendarEvent(tokens.accessToken, tokens.calendarId, gcalEvent)
  }

  // Persist the event ID and date
  if (eventId) {
    await admin
      .from('users_profile')
      .update({
        google_tasks_event_id: eventId,
        google_tasks_event_date: todayStr,
      })
      .eq('id', userId)
  }

  return `${userId}: ok (${tasks?.length || 0} tasks, event ${eventId})`
}
