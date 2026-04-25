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
        'bg-[#FBF7EE] rounded-xl border border-[#E5DCC9] p-5 transition-all duration-150',
        accent && 'border-l-2 border-l-brand',
        onClick && 'cursor-pointer hover:border-line-2 hover:shadow-ambient-sm',
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
  const iconBg = {
    default: 'bg-bg-2 text-ink-2',
    success: 'bg-ok-container text-ok',
    warning: 'bg-warn-container text-warn',
    error:   'bg-err-container text-err',
  }

  const changeBg = change?.startsWith('+')
    ? 'bg-ok-container text-ok'
    : 'bg-err-container text-err'

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          {change && (
            <span className={cn(
              'inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded mb-2',
              changeBg
            )}>
              {change}
            </span>
          )}
          <p className="text-sm text-ink-3 font-medium">{label}</p>
          <p className="font-sans font-bold text-2xl text-ink mt-1 tabular-nums">{value}</p>
        </div>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', iconBg[color])}>
            <Icon className="w-4.5 h-4.5" />
          </div>
        )}
      </div>
    </Card>
  )
}
