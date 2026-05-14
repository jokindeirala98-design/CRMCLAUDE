/**
 * Google Calendar API helper
 * Used by /api/google/* routes to create, update and delete events
 */

import { createClient as createAdminClient } from '@supabase/supabase-js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GCAL_BASE = 'https://www.googleapis.com/calendar/v3'

// ── Token management ──────────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) {
    console.error('[gcal] token refresh failed', data)
    throw new Error('Failed to refresh Google token: ' + (data.error || 'unknown'))
  }
  return data.access_token as string
}

/**
 * Returns a fresh access token for the SHARED "Voltis CRM" calendar.
 * Uses the admin refresh token stored in app_settings.
 */
export async function getSharedCalendarToken(): Promise<{
  accessToken: string
  calendarId: string
} | null> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data: rows } = await admin
    .from('app_settings')
    .select('key, value')
    .in('key', ['shared_calendar_refresh_token', 'shared_calendar_id'])

  if (!rows || rows.length === 0) return null

  const map = Object.fromEntries(rows.map((r: any) => [r.key, r.value]))
  const refreshToken = map['shared_calendar_refresh_token']
  const calendarId   = map['shared_calendar_id']

  if (!refreshToken || !calendarId) return null

  try {
    const accessToken = await refreshAccessToken(refreshToken)
    return { accessToken, calendarId }
  } catch {
    return null
  }
}

/**
 * Returns a fresh access token + calendarId for a given Supabase user ID.
 * Returns null if the user hasn't connected Google Calendar.
 */
export async function getUserTokens(
  userId: string
): Promise<{ accessToken: string; calendarId: string } | null> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data } = await admin
    .from('users_profile')
    .select('google_refresh_token, google_calendar_id')
    .eq('id', userId)
    .single()

  if (!data?.google_refresh_token) return null

  try {
    const accessToken = await refreshAccessToken(data.google_refresh_token)
    return { accessToken, calendarId: data.google_calendar_id || 'primary' }
  } catch {
    return null
  }
}

// ── Event CRUD ────────────────────────────────────────────────────────────────

export interface GCalEvent {
  summary: string
  description?: string
  location?: string
  colorId?: string // '1'–'11'
  start: { dateTime?: string; date?: string; timeZone?: string }
  end:   { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { email: string; displayName?: string }[]
  organizer?:  { displayName?: string }
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: GCalEvent
): Promise<string | null> {
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  )
  const data = await res.json()
  if (!res.ok) { console.error('[gcal] create event error', data); return null }
  return data.id as string
}

export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Partial<GCalEvent>
): Promise<boolean> {
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    }
  )
  return res.ok
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )
}

// ── Task briefing helper ──────────────────────────────────────────────────────

const PRIORITY_EMOJI: Record<string, string> = {
  high:   '🔴',
  medium: '🟡',
  low:    '🟢',
}

export function buildTasksBriefingDescription(tasks: Array<{
  title: string
  priority: string
  client?: { name: string } | null
  due_date?: string | null
}>): string {
  if (tasks.length === 0) return '✅ No hay tareas pendientes para hoy.'

  const lines = tasks.map((t) => {
    const emoji  = PRIORITY_EMOJI[t.priority] || '⚪'
    const client = t.client?.name ? ` [${t.client.name}]` : ''
    return `${emoji} ${t.title}${client}`
  })

  return `📋 TAREAS PENDIENTES (${tasks.length})\n\n${lines.join('\n')}\n\n— Voltis CRM`
}
