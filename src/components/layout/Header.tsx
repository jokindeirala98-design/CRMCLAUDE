'use client'

import { Pencil, Check, X as XIcon } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  hideMobile?: boolean
  /**
   * When provided, the title is rendered as an inline-editable field.
   * Click on the title to start editing; press Enter or the Save icon to persist.
   */
  onTitleSave?: (newValue: string) => Promise<void> | void
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
    <header className={`sticky top-0 z-30 bg-bg/80 backdrop-blur-xl border-b border-line/60 ${hideMobile ? 'hidden lg:block' : ''}`}>
      <div className="flex items-center justify-between px-4 lg:px-6 py-3">
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
                className="font-sans font-semibold text-lg lg:text-xl text-ink bg-transparent outline-none border-b border-ink/30 focus:border-ink px-0.5 min-w-0 flex-1 max-w-2xl"
              />
              <button
                onClick={persist}
                disabled={saving}
                className="p-1.5 rounded-md text-ok hover:bg-ok-container transition"
                title="Guardar"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="p-1.5 rounded-md text-err hover:bg-err-container transition"
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
              <h1 className="font-sans font-semibold text-lg lg:text-xl text-ink truncate">
                {title}
              </h1>
              <Pencil className="w-3 h-3 text-ink-4 group-hover:text-brand flex-shrink-0 transition" />
            </button>
          ) : (
            <h1 className="font-sans font-semibold text-lg lg:text-xl text-ink truncate">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className={`text-xs text-ink-3 mt-0.5 truncate ${subtitleMono ? 'font-mono' : ''}`}>
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 ml-3">
          {actions}
        </div>
      </div>
    </header>
  )
}
