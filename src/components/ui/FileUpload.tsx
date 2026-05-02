'use client'

import { useState, useRef } from 'react'
import { Upload, X, FileText, Image, Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'

interface FileUploadProps {
  label?: string
  hint?: string
  bucket: string
  folder: string
  currentUrl?: string | null
  onUploaded: (url: string) => void
  onRemoved?: () => void
  onFileReady?: (file: File) => void
  accept?: string
  className?: string
}

export function FileUpload({
  label,
  hint,
  bucket,
  folder,
  currentUrl,
  onUploaded,
  onRemoved,
  onFileReady,
  accept = '.pdf,.jpg,.jpeg,.png,.webp',
  className,
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const hasFile = !!currentUrl || !!fileName

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('El archivo no puede superar 10MB')
      return
    }

    // Fire callback so parent can extract data (e.g. NIF/CIF/IBAN) while upload runs
    onFileReady?.(file)

    setUploading(true)
    setError('')

    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const filePath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

      const { data, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path)

      setFileName(file.name)
      onUploaded(urlData.publicUrl)
    } catch (err: any) {
      console.error('Upload error:', err)
      setError(err.message || 'Error al subir el archivo')
    } finally {
      setUploading(false)
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleRemove = () => {
    setFileName(null)
    onRemoved?.()
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label className="block text-sm font-medium text-ink">{label}</label>
      )}

      {hasFile ? (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-ok-container/20 rounded-xl border border-success/20">
          <Check className="w-4 h-4 text-ok flex-shrink-0" />
          <span className="text-sm text-ink truncate flex-1">
            {fileName || 'Archivo adjunto'}
          </span>
          <button
            type="button"
            onClick={handleRemove}
            className="p-1 rounded-lg text-ink-3 hover:text-err hover:bg-err-container/30 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 border-dashed transition-all text-left',
            'border-line-2-variant/40 hover:border-brand/40 hover:bg-secondary/5',
            uploading && 'opacity-50 cursor-not-allowed'
          )}
        >
          {uploading ? (
            <svg className="animate-spin w-4 h-4 text-brand" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <Upload className="w-4 h-4 text-ink-3" />
          )}
          <span className="text-sm text-ink-3">
            {uploading ? 'Subiendo...' : 'Adjuntar archivo'}
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />

      {error && <p className="text-xs text-err font-medium">{error}</p>}
      {hint && !error && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}
