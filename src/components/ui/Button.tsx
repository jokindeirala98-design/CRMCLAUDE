'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * ink     — structural dark button (default)
   * volt    — featured CTA, yellow-green accent. Use at most once per screen.
   * ghost   — secondary / low-emphasis
   * danger  — destructive action
   *
   * Legacy aliases (kept for backward compat):
   * primary   → ink
   * secondary → ghost surface
   * tertiary  → volt
   */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger' | 'ink' | 'volt'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    // Map legacy variant names to new system
    const resolvedVariant =
      variant === 'primary'   ? 'ink'   :
      variant === 'secondary' ? 'ghost-surface' :
      variant === 'tertiary'  ? 'volt'  :
      variant

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed select-none',
          // ── Variants ──────────────────────────────────────────────────
          resolvedVariant === 'ink' && [
            'bg-ink text-bg',
            'hover:bg-ink-2 active:scale-[0.98]',
          ],
          resolvedVariant === 'volt' && [
            'bg-volt text-volt-ink',
            'hover:brightness-105 active:scale-[0.98]',
          ],
          resolvedVariant === 'ghost' && [
            'text-ink-2 bg-transparent',
            'hover:bg-line/60 active:bg-line',
          ],
          resolvedVariant === 'ghost-surface' && [
            'bg-bg-2 text-ink border border-line',
            'hover:bg-line/60 active:bg-line',
          ],
          resolvedVariant === 'danger' && [
            'bg-err text-white',
            'hover:opacity-90 active:scale-[0.98]',
          ],
          // ── Sizes ─────────────────────────────────────────────────────
          size === 'sm' && 'text-xs px-3 py-1.5',
          size === 'md' && 'text-sm px-4 py-2.5',
          size === 'lg' && 'text-base px-6 py-3',
          className
        )}
        {...props}
      >
        {loading && (
          <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
