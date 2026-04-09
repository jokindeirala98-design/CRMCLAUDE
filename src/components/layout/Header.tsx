'use client'

import { Bell, Pencil, Check, X as XIcon } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  hideMobile?: boolean
  /**
   * When provided, the title is rendered as an inline-editable field.
   * Click on the title to start editing; press Enter or Save icon to persist.
   * The callback receives the new value (may be empty string to clear).
   */
  onTitleSave?: (newValue: string) => Promise<void> | void
  /** Optional placeholder shown in the input when editing and the field is empty. */
  titleEditPlaceholder?: string
  /** Render subtitle in monospace (useful for CUPS, account numbers). */
  subtitleMono?: boolean
}

export function Header({
  title,
  subtitle,
  actions,
  hideMobile,
  onTitleSave,
  titleEditPlaceholder = 'Escribe un nombre…',
  subtitleMono = false,
}: HeaderProps) {
  const editable = !!onTitleSave
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(title)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing, title])

  const persist = async () => {
    if (!onTitleSave) return
    setSaving(true)
    try {
      await onTitleSave(draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <header className={`sticky top-0 z-30 bg-surface/80 backdrop-blur-xl ${hideMobile ? 'hidden lg:block' : ''}`}>
      <div className="flex items-center justify-between px-4 lg:px-8 py-3 lg:py-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); persist() }
                  if (e.key === 'Escape') { setEditing(false) }
                }}
                placeholder={titleEditPlaceholder}
                disabled={saving}
                className="font-display font-bold text-lg lg:text-2xl text-on-surface bg-transparent outline-none border-b-2 border-primary/40 focus:border-primary px-1 min-w-0 flex-1 max-w-2xl"
              />
              <button
                onClick={persist}
                disabled={saving}
                className="p-1.5 rounded-lg text-success hover:bg-success/10 transition"
                title="Guardar"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="p-1.5 rounded-lg text-error hover:bg-error/10 transition"
                title="Cancelar"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
          ) : editable ? (
            <button
              onClick={() => setEditing(true)}
              className="group flex items-center gap-2 max-w-full text-left"
              title="Clic para renombrar"
            >
              <h1 className="font-display font-bold text-lg lg:text-2xl text-on-surface truncate">
                {title}
              </h1>
              <Pencil className="w-3.5 h-3.5 text-on-surface-variant/40 group-hover:text-primary flex-shrink-0 transition" />
            </button>
          ) : (
            <h1 className="font-display font-bold text-lg lg:text-2xl text-on-surface truncate">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className={`text-xs lg:text-sm text-on-surface-variant mt-0.5 truncate ${subtitleMono ? 'font-mono' : ''}`}>
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 lg:gap-3 ml-3">
          {/* Notifications - hidden on mobile (shown in bottom nav) */}
          <button className="hidden lg:flex relative w-10 h-10 items-center justify-center rounded-xl hover:bg-surface-container-high transition-all">
            <Bell className="w-5 h-5 text-on-surface-variant" />
          </button>

          {/* Actions slot */}
          {actions}
        </div>
      </div>
    </header>
  )
}
