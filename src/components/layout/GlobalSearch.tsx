'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, Users, Zap, FileText, CreditCard, ClipboardCheck, CheckSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface SearchResult {
  id: string
  type: 'client' | 'supply' | 'prescoring' | 'task'
  title: string
  subtitle: string
  href: string
}

const TYPE_ICONS: Record<string, any> = {
  client: Users,
  supply: Zap,
  prescoring: ClipboardCheck,
  task: CheckSquare,
}

const TYPE_LABELS: Record<string, string> = {
  client: 'Cliente',
  supply: 'Suministro',
  prescoring: 'Prescoring',
  task: 'Tarea',
}

/**
 * Global keyboard-activated search. No visible search bar.
 * Just start typing anywhere and the modal appears with results.
 * Cmd+K also opens it. Escape closes.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const typingBufferRef = useRef('')
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  // Close on route change
  useEffect(() => {
    setOpen(false)
    setQuery('')
    typingBufferRef.current = ''
  }, [pathname])

  // Keyboard: type to search (invisible trigger) + Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
        return
      }

      // If already open, let the input handle keys
      if (open) return

      // Ignore if user is in an input/textarea/select
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Escape clears buffer
      if (e.key === 'Escape') {
        typingBufferRef.current = ''
        return
      }

      // Only single printable characters trigger search
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typingBufferRef.current += e.key

        // Clear previous timeout
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)

        // After 2+ chars typed, open modal with the query
        if (typingBufferRef.current.length >= 2) {
          setQuery(typingBufferRef.current)
          setOpen(true)
          typingBufferRef.current = ''
        } else {
          // Reset buffer after 800ms of inactivity
          typingTimeoutRef.current = setTimeout(() => {
            typingBufferRef.current = ''
          }, 800)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [open])

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setResults([])
      setSelectedIndex(0)
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      const supabase = createClient()
      const searchResults: SearchResult[] = []

      // Search clients (only existing columns)
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name, cif_nif, email, type')
        .or(`name.ilike.%${query}%,cif_nif.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(5)

      clients?.forEach((c: any) => {
        searchResults.push({
          id: c.id,
          type: 'client',
          title: c.name,
          subtitle: [c.cif_nif, c.email].filter(Boolean).join(' · '),
          href: `/clients/${c.id}`,
        })
      })

      // Search supplies by CUPS, alias (name), address, or client name via join
      const { data: supplies } = await supabase
        .from('supplies')
        .select('id, cups, name, tariff, type, client:clients(name)')
        .or(`cups.ilike.%${query}%,name.ilike.%${query}%,address.ilike.%${query}%`)
        .limit(5)

      supplies?.forEach((s: any) => {
        // Show alias as primary title when present, CUPS as subtitle prefix
        const primary = s.name || s.cups || 'Sin CUPS'
        const cupsSuffix = s.name && s.cups ? `${s.cups} · ` : ''
        searchResults.push({
          id: s.id,
          type: 'supply',
          title: primary,
          subtitle: `${cupsSuffix}${s.client?.name || ''} · ${s.type?.toUpperCase() || ''} ${s.tariff || ''}`.trim(),
          href: `/supplies/${s.id}`,
        })
      })

      // Also search supplies by client name
      const { data: suppliesByClient } = await supabase
        .from('supplies')
        .select('id, cups, tariff, type, client:clients!inner(name)')
        .ilike('client.name' as any, `%${query}%`)
        .limit(5)

      suppliesByClient?.forEach((s: any) => {
        // Avoid duplicates
        if (!searchResults.some(r => r.id === s.id)) {
          searchResults.push({
            id: s.id,
            type: 'supply',
            title: s.cups || 'Sin CUPS',
            subtitle: `${s.client?.name || ''} · ${s.type?.toUpperCase() || ''} ${s.tariff || ''}`.trim(),
            href: `/supplies/${s.id}`,
          })
        }
      })

      // Search prescorings by client name or CUPS
      const { data: prescorings } = await supabase
        .from('prescorings')
        .select('id, client_name, cups, status, supply_id')
        .or(`client_name.ilike.%${query}%,cups.ilike.%${query}%`)
        .limit(5)

      prescorings?.forEach((p: any) => {
        searchResults.push({
          id: p.id,
          type: 'prescoring',
          title: p.client_name || p.cups || 'Prescoring',
          subtitle: `${p.cups || ''} · ${p.status || ''}`,
          href: p.supply_id ? `/supplies/${p.supply_id}` : `/prescorings`,
        })
      })

      // Search tasks by title
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, status, priority')
        .ilike('title', `%${query}%`)
        .limit(5)

      tasks?.forEach((t: any) => {
        searchResults.push({
          id: t.id,
          type: 'task',
          title: t.title,
          subtitle: `${t.priority || ''} · ${t.status || ''}`,
          href: `/tasks`,
        })
      })

      setResults(searchResults)
      setSelectedIndex(0)
      setLoading(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  const handleSelect = useCallback((result: SearchResult) => {
    router.push(result.href)
    setOpen(false)
    setQuery('')
  }, [router])

  const handleClose = () => {
    setOpen(false)
    setQuery('')
  }

  const handleKeyNav = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex])
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={handleClose}
          />
          <div className="flex justify-center px-4 pt-[15vh]">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              className="relative bg-bg rounded-2xl shadow-ambient-lg w-full max-w-lg overflow-hidden"
            >
              {/* Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-container-low">
                <Search className="w-5 h-5 text-ink-3 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyNav}
                  placeholder="Buscar clientes, CUPS, emails..."
                  className="flex-1 bg-transparent text-ink text-sm outline-none placeholder:text-ink-3/50"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="p-1 rounded-lg hover:bg-bg-2">
                    <X className="w-4 h-4 text-ink-3" />
                  </button>
                )}
              </div>

              {/* Results */}
              <div className="max-h-80 overflow-y-auto">
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin w-5 h-5 border-2 border-brand border-t-transparent rounded-full" />
                  </div>
                )}

                {!loading && query.length >= 2 && results.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-ink-3">Sin resultados para &quot;{query}&quot;</p>
                  </div>
                )}

                {!loading && results.length > 0 && (
                  <div className="py-2">
                    {results.map((result, index) => {
                      const Icon = TYPE_ICONS[result.type]
                      return (
                        <button
                          key={`${result.type}-${result.id}`}
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all ${
                            index === selectedIndex
                              ? 'bg-primary/5'
                              : 'hover:bg-bg-2'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            index === selectedIndex ? 'bg-primary/10' : 'bg-bg-2'
                          }`}>
                            <Icon className={`w-4 h-4 ${index === selectedIndex ? 'text-brand' : 'text-ink-3'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink truncate">{result.title}</p>
                            <p className="text-xs text-ink-3 truncate">{result.subtitle}</p>
                          </div>
                          <span className="text-[10px] font-medium text-ink-3 bg-bg-2 px-1.5 py-0.5 rounded flex-shrink-0">
                            {TYPE_LABELS[result.type]}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {!loading && query.length < 2 && (
                  <div className="py-8 text-center">
                    <p className="text-xs text-ink-3">Escribe al menos 2 caracteres para buscar</p>
                  </div>
                )}
              </div>

              {/* Footer hint */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-surface-container-low text-[10px] text-ink-3">
                <div className="flex items-center gap-3">
                  <span><kbd className="px-1 py-0.5 bg-bg-2 rounded font-mono">↑↓</kbd> navegar</span>
                  <span><kbd className="px-1 py-0.5 bg-bg-2 rounded font-mono">↵</kbd> abrir</span>
                  <span><kbd className="px-1 py-0.5 bg-bg-2 rounded font-mono">esc</kbd> cerrar</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}
