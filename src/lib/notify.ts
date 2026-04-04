/**
 * Unified notification system — creates in-app notification + sends Telegram push.
 *
 * Usage:
 *   import { notify } from '@/lib/notify'
 *   await notify({
 *     userId: 'uuid',
 *     type: 'estudio_completado',
 *     title: 'Informe listo',
 *     message: 'El informe de García está disponible.',
 *     link: '/supplies/xxx',
 *   })
 */

import { createBotSupabase, notifyUser } from '@/lib/telegram'

interface NotifyOptions {
  userId: string
  type: 'estudio_completado' | 'prescoring_aprobado' | 'prescoring_rechazado' | 'contrato_firmado' | 'general'
  title: string
  message: string
  link?: string
  metadata?: Record<string, unknown>
}

export async function notify(opts: NotifyOptions): Promise<void> {
  const supabase = createBotSupabase()

  // ── 1. Create in-app notification ──
  try {
    await supabase.from('notifications').insert({
      user_id: opts.userId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      link: opts.link || null,
      read: false,
      created_at: new Date().toISOString(),
      metadata: opts.metadata || null,
    })
  } catch (err) {
    console.error('[Notify] Failed to create in-app notification:', err)
  }

  // ── 2. Send Telegram push if linked ──
  try {
    const { data: tgLink } = await supabase
      .from('telegram_links')
      .select('telegram_chat_id')
      .eq('user_id', opts.userId)
      .eq('status', 'active')
      .single()

    if (tgLink?.telegram_chat_id) {
      const emoji: Record<string, string> = {
        estudio_completado: '📊',
        prescoring_aprobado: '✅',
        prescoring_rechazado: '❌',
        contrato_firmado: '✍️',
        general: '🔔',
      }
      const icon = emoji[opts.type] || '🔔'
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      const linkText = opts.link ? `\n\n<a href="${appUrl}${opts.link}">Ver en CRM →</a>` : ''

      await notifyUser(
        tgLink.telegram_chat_id,
        `${icon} <b>${opts.title}</b>\n\n${opts.message}${linkText}`
      )
    }
  } catch (err) {
    // Don't fail the operation if Telegram notification fails
    console.error('[Notify] Telegram push failed:', err)
  }
}

/**
 * Notify the commercial assigned to a client about an event.
 */
export async function notifyClientCommercial(
  clientId: string,
  type: NotifyOptions['type'],
  title: string,
  message: string,
  link?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const supabase = createBotSupabase()

  const { data: client } = await supabase
    .from('clients')
    .select('commercial_id')
    .eq('id', clientId)
    .single()

  if (client?.commercial_id) {
    await notify({
      userId: client.commercial_id,
      type,
      title,
      message,
      link,
      metadata,
    })
  }
}
