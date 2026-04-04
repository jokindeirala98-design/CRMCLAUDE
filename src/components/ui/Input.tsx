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
          <label htmlFor={id} className="block text-sm font-medium text-on-surface">
            {label}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          className={cn(
            'w-full px-4 py-2.5 bg-surface-container-high rounded-xl text-sm text-on-surface',
            'placeholder:text-on-surface-variant/50 font-body',
            'outline-none transition-all duration-200',
            'focus:focus-glow focus:bg-surface-container-lowest',
            error && 'ring-2 ring-error/40',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-error font-medium">{error}</p>}
        {hint && !error && <p className="text-xs text-on-surface-variant">{hint}</p>}
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
          <label htmlFor={id} className="block text-sm font-medium text-on-surface">
            {label}
          </label>
        )}
        <select
          id={id}
          ref={ref}
          className={cn(
            'w-full px-4 py-2.5 bg-surface-container-high rounded-xl text-sm text-on-surface',
            'outline-none transition-all duration-200 font-body appearance-none',
            'focus:focus-glow focus:bg-surface-container-lowest',
            error && 'ring-2 ring-error/40',
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
        {error && <p className="text-xs text-error font-medium">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
