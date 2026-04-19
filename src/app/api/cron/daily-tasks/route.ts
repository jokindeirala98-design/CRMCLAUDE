import { NextResponse } from 'next/server'

/**
 * GET /api/cron/daily-tasks
 *
 * Vercel Cron Job — runs every day at 7:55 AM (Europe/Madrid = UTC+2 in summer → 05:55 UTC)
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/daily-tasks",
 *     "schedule": "55 5 * * *"
 *   }]
 * }
 *
 * This creates/refreshes the daily "Tareas pendientes" event for ALL users
 * that have Google Calendar connected.
 */
export async function GET(req: Request) {
  // Verify this is called by Vercel Cron (or us manually)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voltis-crm-bueno.vercel.app'

  const res = await fetch(`${appUrl}/api/google/sync-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true }),
  })

  const data = await res.json()
  console.log('[cron/daily-tasks] result:', data)
  return NextResponse.json(data)
}
