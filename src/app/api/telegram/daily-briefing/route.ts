import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ── Supabase admin client ─────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

// ── Day names ────────────────────────────────────────────────────────
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DAY_EMOJI = ['☀️', '🌅', '🌅', '🌅', '🌅', '🌅', '🎉']

// ── Send Telegram message ─────────────────────────────────────────────
async function sendMessage(chatId: string, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  })
}

// ── Format task line ──────────────────────────────────────────────────
function formatTask(task: any, index: number): string {
  const zonePrefix = task.zone === 'director' ? '📌 ' : task.is_focus_today ? '☀️ ' : ''
  const priorityTag = task.priority === 'high' ? ' 🔴' : task.priority === 'medium' ? ' 🟡' : ''
  const clientTag = task.client ? ` — <i>${task.client.name}</i>` : ''
  return `${index + 1}. ${zonePrefix}${task.title}${priorityTag}${clientTag}`
}

// ── Build briefing message ─────────────────────────────────────────────
function buildBriefingMessage(
  userName: string,
  tasks: any[],
  weekRange: string,
): string {
  const now = new Date()
  // Adjust to Spain timezone (UTC+1 or UTC+2)
  const day = now.getDay()
  const dayName = DAY_NAMES[day]
  const emoji = DAY_EMOJI[day]

  const focusTasks = tasks.filter(t => t.is_focus_today && t.status !== 'completed')
  const directorTasks = tasks.filter(t => t.zone === 'director' && t.status !== 'completed')
  const mineTasks = tasks.filter(t => t.zone === 'mine' && t.status !== 'completed')
  const inboxTasks = tasks.filter(t => t.zone === 'inbox' && t.status !== 'completed')

  const lines: string[] = []
  lines.push(`${emoji} <b>Buenos días, ${userName.split(' ')[0]}!</b>`)
  lines.push(`<i>${dayName.charAt(0).toUpperCase() + dayName.slice(1)} · Semana ${weekRange}</i>`)
  lines.push('')

  if (focusTasks.length > 0) {
    lines.push('☀️ <b>Foco de hoy:</b>')
    focusTasks.forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}`))
    lines.push('')
  }

  if (directorTasks.length > 0) {
    lines.push('📌 <b>Fijado por dirección:</b>')
    directorTasks.forEach((t, i) => lines.push(`  ${formatTask(t, i)}`))
    lines.push('')
  }

  if (mineTasks.length > 0) {
    lines.push('✏️ <b>Mis tareas:</b>')
    mineTasks.forEach((t, i) => lines.push(`  ${formatTask(t, i)}`))
    lines.push('')
  }

  if (inboxTasks.length > 0) {
    lines.push(`📥 <b>Sin revisar (${inboxTasks.length}):</b>`)
    inboxTasks.slice(0, 3).forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}`))
    if (inboxTasks.length > 3) lines.push(`  <i>... y ${inboxTasks.length - 3} más</i>`)
    lines.push('')
  }

  if (directorTasks.length === 0 && mineTasks.length === 0 && inboxTasks.length === 0) {
    lines.push('✅ <b>No tienes tareas pendientes esta semana.</b>')
    lines.push('¡Buen momento para planificar!')
  }

  lines.push('—')
  lines.push('<i>Responde /agenda para ver tu plan completo.</i>')

  return lines.join('\n')
}

// ── Format week range string ──────────────────────────────────────────
function formatWeekRange(starts: string, ends: string): string {
  const s = new Date(starts + 'T12:00:00')
  const e = new Date(ends + 'T12:00:00')
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${s.getDate()}–${e.getDate()} ${months[e.getMonth()]}`
}

// ── Get current week Monday ───────────────────────────────────────────
function getCurrentWeekMonday(): string {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

// ── Shared logic ──────────────────────────────────────────────────────
async function runBriefing(): Promise<NextResponse> {

  // Get active week for this week
  const monday = getCurrentWeekMonday()
  const { data: week, error: weekError } = await supabase
    .from('weeks')
    .select('*')
    .eq('status', 'active')
    .gte('starts_at', monday)
    .limit(1)
    .maybeSingle()

  if (weekError || !week) {
    return NextResponse.json({ message: 'No active week found — no briefings sent' })
  }

  const weekRange = formatWeekRange(week.starts_at, week.ends_at)

  // Get all users with a telegram_chat_id
  const { data: users, error: usersError } = await supabase
    .from('users_profile')
    .select('id, full_name, telegram_chat_id')
    .eq('active', true)
    .not('telegram_chat_id', 'is', null)

  if (usersError || !users || users.length === 0) {
    return NextResponse.json({ message: 'No users with Telegram linked' })
  }

  const results: { user: string; status: string }[] = []

  for (const user of users) {
    try {
      // Fetch this user's week tasks
      const { data: tasks } = await supabase
        .from('tasks')
        .select('*, client:clients!client_id(name)')
        .eq('week_id', week.id)
        .eq('assigned_to', user.id)
        .neq('status', 'completed')
        .order('sort_order')

      const userTasks = tasks || []

      // Don't send if user has no tasks
      if (userTasks.length === 0) {
        results.push({ user: user.full_name, status: 'skipped (no tasks)' })
        continue
      }

      const message = buildBriefingMessage(user.full_name, userTasks, weekRange)
      await sendMessage(user.telegram_chat_id, message)
      results.push({ user: user.full_name, status: 'sent' })
    } catch (err) {
      results.push({ user: user.full_name, status: `error: ${err}` })
    }
  }

  return NextResponse.json({ week: week.starts_at, results })
}

// ── GET handler — called by Vercel Cron (Authorization: Bearer CRON_SECRET)
// ── or manually with ?secret=CRON_SECRET ──────────────────────────────
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')

  const validHeader = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const validQuery  = secret === process.env.CRON_SECRET

  if (!validHeader && !validQuery) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return runBriefing()
}

// ── POST handler — alternative trigger ────────────────────────────────
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runBriefing()
}
