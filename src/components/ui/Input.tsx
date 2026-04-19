'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          className={cn(
            'w-full px-3.5 py-2.5 bg-bg-2 border border-line rounded-lg text-sm text-ink',
            'placeholder:text-ink-4 font-sans',
            'outline-none transition-all duration-150',
            'focus:border-ink focus:bg-card focus:ring-0',
            error && 'border-err focus:border-err',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-err font-medium">{error}</p>}
        {hint && !error && <p className="text-xs text-ink-3">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options?: { value: string; label: string }[]
  children?: React.ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, children, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <select
          id={id}
          ref={ref}
          className={cn(
            'w-full px-3.5 py-2.5 bg-bg-2 border border-line rounded-lg text-sm text-ink',
            'outline-none transition-all duration-150 font-sans appearance-none',
            'focus:border-ink focus:bg-card',
            error && 'border-err focus:border-err',
            className
          )}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        {error && <p className="text-xs text-err font-medium">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
