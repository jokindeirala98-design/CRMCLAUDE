import { cn } from '@/lib/utils/cn'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-surface-container-high text-on-surface-variant',
  success: 'bg-success-container text-success',
  warning: 'bg-warning-container text-warning',
  error: 'bg-error-container text-error',
  info: 'bg-primary/10 text-primary',
}

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

// Supply status badge with automatic color mapping
const statusColorMap: Record<string, BadgeVariant> = {
  primer_contacto: 'info',
  facturas_recibidas: 'info',
  prescoring_pendiente: 'warning',
  prescoring_completado: 'success',
  estudio_en_curso: 'warning',
  estudio_completado: 'info',
  presentado: 'success',
  presentacion_pendiente: 'warning',
  presentacion_realizada: 'info',
  rechazado: 'error',
  pendiente_firma: 'warning',
  firmado: 'success',
  suscrito: 'success',
  seguimiento_activo: 'success',
  // Billing
  draft: 'default',
  sent: 'info',
  paid: 'success',
  overdue: 'error',
  cancelled: 'default',
  // Subscriptions
  active: 'success',
  paused: 'warning',
  pending_activation: 'warning',
  // Prescoring
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
}

const statusLabelMap: Record<string, string> = {
  primer_contacto: 'Primer contacto',
  facturas_recibidas: 'Facturas recibidas',
  prescoring_pendiente: 'Prescoring pte.',
  prescoring_completado: 'Prescoring OK',
  estudio_en_curso: 'Esperando informes',
  estudio_completado: 'Informe listo',
  presentado: 'Presentado',
  presentacion_pendiente: 'Presentacion pte.',
  presentacion_realizada: 'Presentacion hecha',
  rechazado: 'Rechazado',
  pendiente_firma: 'Pte. firma',
  firmado: 'Firmado',
  suscrito: 'Suscrito',
  seguimiento_activo: 'Seguimiento',
  draft: 'Borrador',
  sent: 'Enviada',
  paid: 'Pagada',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
  active: 'Activa',
  paused: 'Pausada',
  pending_activation: 'Pte. activacion',
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusColorMap[status] || 'default'}>
      {statusLabelMap[status] || status}
    </Badge>
  )
}
