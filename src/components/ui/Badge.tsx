import { cn } from '@/lib/utils/cn'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

/**
 * Dot color for each variant (6px circle)
 * Container bg + border defined inline via CSS vars or Tailwind
 */
const variantStyles: Record<BadgeVariant, { dot: string; text: string; bg: string; border: string }> = {
  default: {
    dot:    'bg-ink-4',
    text:   'text-ink-3',
    bg:     'bg-bg-2',
    border: 'border-line-2',
  },
  success: {
    dot:    'bg-ok',
    text:   'text-ok',
    bg:     'bg-ok-container',
    border: 'border-ok/30',
  },
  warning: {
    dot:    'bg-warn',
    text:   'text-warn',
    bg:     'bg-warn-container',
    border: 'border-warn/30',
  },
  error: {
    dot:    'bg-err',
    text:   'text-err',
    bg:     'bg-err-container',
    border: 'border-err/30',
  },
  info: {
    dot:    'bg-info',
    text:   'text-info',
    bg:     'bg-info-container',
    border: 'border-info/30',
  },
}

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  /** If true, hides the leading dot (use for filter chips / clickable badges) */
  hideDot?: boolean
  className?: string
  onClick?: () => void
}

export function Badge({ children, variant = 'default', hideDot = false, className, onClick }: BadgeProps) {
  const s = variantStyles[variant]
  return (
    <span
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border',
        s.bg, s.border, s.text,
        onClick && 'cursor-pointer hover:brightness-95 transition-all',
        className
      )}
    >
      {!hideDot && (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', s.dot)} />
      )}
      {children}
    </span>
  )
}

// ── Supply / entity status badge ──────────────────────────────────────────────

const statusColorMap: Record<string, BadgeVariant> = {
  primer_contacto:          'info',
  facturas_recibidas:       'warning', // legacy → show same as estudio_en_curso
  prescoring_pendiente:     'warning',
  prescoring_completado:    'success',
  estudio_en_curso:         'warning',
  estudio_completado:       'info',
  presentado:               'success',
  presentacion_pendiente:   'warning',
  presentacion_realizada:   'info',
  rechazado:                'error',
  pendiente_firma:          'warning',
  firmado:                  'success',
  suscrito:                 'success',
  seguimiento_activo:       'success',
  // Billing
  draft:                    'default',
  sent:                     'info',
  paid:                     'success',
  overdue:                  'error',
  cancelled:                'default',
  // Subscriptions
  active:                   'success',
  paused:                   'warning',
  pending_activation:       'warning',
  // Prescoring
  pending:                  'warning',
  approved:                 'success',
  rejected:                 'error',
}

const statusLabelMap: Record<string, string> = {
  primer_contacto:          'Primer contacto',
  facturas_recibidas:       'Esperando informes', // legacy redirect
  prescoring_pendiente:     'Prescoring pte.',
  prescoring_completado:    'Prescoring OK',
  estudio_en_curso:         'Esperando informes',
  estudio_completado:       'Informe listo',
  presentado:               'Presentado',
  presentacion_pendiente:   'Presentación pte.',
  presentacion_realizada:   'Presentación hecha',
  rechazado:                'Rechazado',
  pendiente_firma:          'Pte. firma',
  firmado:                  'Firmado',
  suscrito:                 'Suscrito',
  seguimiento_activo:       'Seguimiento',
  draft:                    'Borrador',
  sent:                     'Enviada',
  paid:                     'Pagada',
  overdue:                  'Vencida',
  cancelled:                'Cancelada',
  active:                   'Activa',
  paused:                   'Pausada',
  pending_activation:       'Pte. activación',
  pending:                  'Pendiente',
  approved:                 'Aprobado',
  rejected:                 'Rechazado',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusColorMap[status] || 'default'}>
      {statusLabelMap[status] || status}
    </Badge>
  )
}
