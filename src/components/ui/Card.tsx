import { cn } from '@/lib/utils/cn'

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
  children: React.ReactNode
  className?: string
  accent?: boolean
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
}

export function Card({ children, className, accent, onClick, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      onClick={onClick}
      className={cn(
        'bg-surface-container-lowest rounded-2xl p-5 shadow-ambient-sm transition-all duration-200',
        accent && 'border-l-2 border-secondary',
        onClick && 'cursor-pointer hover:shadow-ambient',
        className
      )}
    >
      {children}
    </div>
  )
}

export function StatCard({
  label,
  value,
  change,
  icon: Icon,
  color = 'default',
}: {
  label: string
  value: string | number
  change?: string
  icon?: React.ElementType
  color?: 'default' | 'success' | 'warning' | 'error'
}) {
  const colorClasses = {
    default: 'bg-surface-container-low text-primary',
    success: 'bg-success-container text-success',
    warning: 'bg-warning-container text-warning',
    error: 'bg-error-container text-error',
  }

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          {change && (
            <span className={cn(
              'inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full mb-2',
              change.startsWith('+') ? 'bg-success-container text-success' : 'bg-error-container text-error'
            )}>
              {change}
            </span>
          )}
          <p className="text-sm text-on-surface-variant font-medium">{label}</p>
          <p className="font-display font-bold text-2xl text-on-surface mt-1">{value}</p>
        </div>
        {Icon && (
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', colorClasses[color])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </Card>
  )
}
