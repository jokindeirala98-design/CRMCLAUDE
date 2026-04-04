'use client'

import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export interface ClientOption {
  id: string
  name: string
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
}: SearchableClientSelectorProps) => {
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedClient = clients.find((c) => c.id === value)
  const normalizedSearch = search.toLowerCase().trim()
  const filteredClients = clients.filter((c) => {
    const nameMatch = c.name.toLowerCase().includes(normalizedSearch)
    const cifMatch = (c.cif || c.nif || c.cif_nif || '').toLowerCase().includes(normalizedSearch)
    return normalizedSearch === '' || nameMatch || cifMatch
  })

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (client: ClientOption) => {
    onChange(client.id)
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
        <label className="block text-sm font-medium text-on-surface">
          {label} {required && <span className="text-error">*</span>}
        </label>
      )}
      <div className="relative" ref={containerRef}>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={selectedClient && !isOpen ? selectedClient.name : search}
            onChange={(e) => {
              setSearch(e.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={selectedClient ? '' : placeholder}
            disabled={disabled}
            className={cn(
              'w-full px-4 py-2.5 bg-surface-container-high rounded-xl text-sm text-on-surface',
              'placeholder:text-on-surface-variant/50 font-body',
              'outline-none transition-all duration-200',
              'focus:focus-glow focus:bg-surface-container-lowest',
              disabled && 'opacity-50 cursor-not-allowed',
              error && 'ring-2 ring-error/40'
            )}
          />
          {selectedClient && !isOpen && (
            <button
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-surface-container-lowest transition-all"
              type="button"
            >
              <X className="w-4 h-4 text-on-surface-variant" />
            </button>
          )}
        </div>

        {/* Dropdown */}
        {isOpen && filteredClients.length > 0 && (
          <div className="absolute z-10 top-full mt-1 w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-lg max-h-48 overflow-y-auto">
            {filteredClients.map((client) => (
              <button
                key={client.id}
                onClick={() => handleSelect(client)}
                className={cn(
                  'w-full text-left px-4 py-2.5 hover:bg-surface-container-high transition-all border-b border-outline-variant/10',
                  'last:border-b-0 flex items-center justify-between gap-2',
                  value === client.id && 'bg-primary/10'
                )}
                type="button"
              >
                <div>
                  <p className="text-sm font-medium text-on-surface">{client.name}</p>
                  {(client.cif || client.nif || client.cif_nif) && (
                    <p className="text-xs text-on-surface-variant">
                      {client.cif || client.nif || client.cif_nif}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* No results message */}
        {isOpen && search && filteredClients.length === 0 && (
          <div className="absolute z-10 top-full mt-1 w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-lg p-3 text-center">
            <p className="text-sm text-on-surface-variant">No se encontraron clientes</p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-error font-medium">{error}</p>}
    </div>
  )
}
