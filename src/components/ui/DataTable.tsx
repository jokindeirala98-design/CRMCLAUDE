'use client'

import { cn } from '@/lib/utils/cn'

interface Column<T> {
  key: string
  header: string
  render?: (item: T) => React.ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (item: T) => string
  onRowClick?: (item: T) => void
  emptyMessage?: string
  loading?: boolean
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = 'Aún no hay datos',
  loading,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-line p-8">
        <div className="flex items-center justify-center gap-3 text-ink-3">
          <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Cargando...</span>
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-line p-12 text-center">
        <p className="text-sm text-ink-3">{emptyMessage}</p>
        <p className="text-xs text-ink-4 mt-1">Crea el primero para empezar a operar.</p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-xl border border-line overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-bg-2">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'text-left px-5 py-3',
                    'font-mono text-[0.65rem] font-medium text-ink-3 uppercase tracking-[0.08em]',
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item, idx) => (
              <tr
                key={keyExtractor(item)}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  'transition-colors duration-100',
                  onRowClick && 'cursor-pointer hover:bg-bg',
                  idx !== data.length - 1 && 'border-b border-line'
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn('px-5 py-3.5 text-sm text-ink tabular-nums', col.className)}
                  >
                    {col.render
                      ? col.render(item)
                      : String((item as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
