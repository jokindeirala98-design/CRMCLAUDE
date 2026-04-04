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
  emptyMessage = 'No hay datos',
  loading,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl p-8">
        <div className="flex items-center justify-center gap-3 text-on-surface-variant">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
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
      <div className="bg-surface-container-lowest rounded-2xl p-12 text-center">
        <p className="text-sm text-on-surface-variant">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-ambient-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-container-low">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider px-5 py-3',
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
                  'transition-colors duration-150',
                  onRowClick && 'cursor-pointer hover:bg-surface-container-low',
                  idx !== data.length - 1 && 'border-b border-surface-container-low'
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-5 py-3.5 text-sm', col.className)}>
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
