'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('[Dashboard Error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="max-w-md w-full bg-card border border-err/20 rounded-2xl p-8 shadow-ambient-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-err-container flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-err" />
          </div>
          <div>
            <h1 className="font-semibold text-ink">Error en la aplicación</h1>
            <p className="text-xs text-ink-3">Ha ocurrido un error inesperado</p>
          </div>
        </div>

        {error?.message && (
          <div className="bg-bg-2 rounded-xl p-3 mb-4 font-mono text-xs text-ink-3 break-all">
            {error.message}
          </div>
        )}
        {error?.digest && (
          <p className="text-[10px] text-ink-4 mb-4">Código: {error.digest}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand/90 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
          <button
            onClick={() => { window.location.href = '/login' }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-bg-2 text-ink-3 rounded-xl text-sm font-medium hover:bg-line transition-colors"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
