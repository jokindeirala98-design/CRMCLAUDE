'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export interface ClientOption {
  id: string
  name: string
  alias?: string | null
  cif?: string | null
  nif?: string | null
  cif_nif?: string | null
}

interface SearchableClientSelectorProps {
  label?: string
  value: string
  onChange: (clientId: string) => void
  clients: ClientOption[]
  placeholder?: string
  required?: boolean
  error?: string
  disabled?: boolean
  /** Show an "auto-detect" option at the top (for BulkUpload) */
  showAutoDetect?: boolean
}

export const SearchableClientSelector = ({
  label,
  value,
  onChange,
  clients,
  placeholder = 'Buscar cliente...',
  required = false,
  error,
  disabled = false,
  showAutoDetect = false,
}: SearchableClientSelectorProps) => {
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedClient = clients.find((c) => c.id === value)
  const normalizedSearch = search.toLowerCase().trim()
  const filteredClients = clients.filter((c) => {
    const nameMatch = c.name.toLowerCase().includes(normalizedSearch)
    const aliasMatch = (c.alias || '').toLowerCase().includes(normalizedSearch)
    const cifMatch = (c.cif || c.nif || c.cif_nif || '').toLowerCase().includes(normalizedSearch)
    return normalizedSearch === '' || nameMatch || aliasMatch || cifMatch
  })

  // Close dropdown when clicking outside — clear unmatched search text
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        // If no client selected and user left unmatched text, clear it
        if (!selectedClient) setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [selectedClient])

  const handleSelect = (client: ClientOption) => {
    onChange(client.id)
    setSearch('')
    setIsOpen(false)
  }

  const handleSelectAutoDetect = () => {
    onChange('')
    setSearch('')
    setIsOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setSearch('')
    setIsOpen(false)
  }

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-ink">
          {label} {required && <span className="text-err">*</span>}
        </label>
      )}
      <div className="relative" ref={containerRef}>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={selectedClient && !isOpen ? (selectedClient.alias || selectedClient.name) : search}
            onChange={(e) => {
              setSearch(e.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={selectedClient ? '' : placeholder}
            disabled={disabled}
            className={cn(
              'w-full px-4 py-2.5 bg-bg-2 rounded-xl text-sm text-ink',
              'placeholder:text-ink-3/50 font-sans',
              'outline-none transition-all duration-200',
              'focus:focus-glow focus:bg-card',
              disabled && 'opacity-50 cursor-not-allowed',
              error && 'ring-2 ring-error/40'
            )}
          />
          {selectedClient && !isOpen && (
            <button
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-card transition-all"
              type="button"
            >
              <X className="w-4 h-4 text-ink-3" />
            </button>
          )}
        </div>

        {/* Dropdown */}
        {isOpen && (filteredClients.length > 0 || showAutoDetect) && (
          <div className="absolute z-10 top-full mt-1 w-full bg-card border border-line-2-variant/30 rounded-xl shadow-lg max-h-48 overflow-y-auto">
            {/* Auto-detect option */}
            {showAutoDetect && (
              <button
                onClick={handleSelectAutoDetect}
                className={cn(
                  'w-full text-left px-4 py-2.5 hover:bg-bg-2 transition-all border-b border-line-2-variant/10',
                  'flex items-center gap-2',
                  !value && 'bg-secondary/10'
                )}
                type="button"
              >
                <Sparkles className="w-3.5 h-3.5 text-brand flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-brand">Detectar automáticamente</p>
                  <p className="text-xs text-ink-3">Desde el CIF/NIF de la factura</p>
                </div>
              </button>
            )}
            {filteredClients.map((client) => (
              <button
                key={client.id}
                onClick={() => handleSelect(client)}
                className={cn(
                  'w-full text-left px-4 py-2.5 hover:bg-bg-2 transition-all border-b border-line-2-variant/10',
                  'last:border-b-0 flex items-center justify-between gap-2',
                  value === client.id && 'bg-primary/10'
                )}
                type="button"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{client.alias || client.name}</p>
                  <p className="text-xs text-ink-3">
                    {client.alias ? client.name : (client.cif || client.nif || client.cif_nif || '')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* No results message */}
        {isOpen && search && filteredClients.length === 0 && !showAutoDetect && (
          <div className="absolute z-10 top-full mt-1 w-full bg-card border border-line-2-variant/30 rounded-xl shadow-lg p-3 text-center">
            <p className="text-sm text-ink-3">No se encontraron clientes</p>
          </div>
        )}

        {/* No results with auto-detect hint */}
        {isOpen && search && filteredClients.length === 0 && showAutoDetect && (
          <div className="absolute z-10 top-full mt-1 w-full bg-card border border-line-2-variant/30 rounded-xl shadow-lg overflow-hidden">
            <button
              onClick={handleSelectAutoDetect}
              className="w-full text-left px-4 py-2.5 hover:bg-bg-2 transition-all flex items-center gap-2"
              type="button"
            >
              <Sparkles className="w-3.5 h-3.5 text-brand flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-brand">Detectar automáticamente</p>
                <p className="text-xs text-ink-3">El cliente se detectará desde el CIF/NIF de la factura</p>
              </div>
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-err font-medium">{error}</p>}
    </div>
  )
}
