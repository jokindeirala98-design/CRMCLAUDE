'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { MobileDrawer } from '@/components/layout/MobileDrawer'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { GlobalSearch } from '@/components/layout/GlobalSearch'
import { UploadProgress } from '@/components/ui/UploadProgress'
import { motion, AnimatePresence } from 'framer-motion'
import { usePathname } from 'next/navigation'

// ── Arrow-key history navigation ─────────────────────────────────────────────
// ← flecha izquierda → historia atrás  |  → flecha derecha → historia adelante
// No se activa si el foco está en un campo editable o si hay modificadores.
function useArrowKeyNavigation() {
  const [hint, setHint] = useState<'back' | 'forward' | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const handler = (e: KeyboardEvent) => {
      // Ignorar si hay modificadores (Ctrl, Alt, Meta, Shift)
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return

      // Ignorar si el foco está en un campo editable
      const tag = (e.target as HTMLElement)?.tagName
      const editable = (e.target as HTMLElement)?.isContentEditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        window.history.back()
        setHint('back')
        clearTimeout(timer)
        timer = setTimeout(() => setHint(null), 800)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        window.history.forward()
        setHint('forward')
        clearTimeout(timer)
        timer = setTimeout(() => setHint(null), 800)
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(timer)
    }
  }, [])

  return hint
}

// ── Fullscreen toggle ─────────────────────────────────────────────────────────
// Doble clic en cualquier zona no interactiva ↔ pantalla completa (Fullscreen API).
// Escape sale automáticamente (lo gestiona el navegador).
function useFullscreenOnDblClick() {
  // showHint: true solo durante 2.5 s tras ENTRAR en fullscreen
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onChange = () => {
      if (document.fullscreenElement) {
        setShowHint(true)
        timer = setTimeout(() => setShowHint(false), 2500)
      } else {
        setShowHint(false)
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Ignorar dobles clics sobre elementos interactivos
      if (target.closest('button, a, input, textarea, select, [role="button"], [role="menuitem"], [role="option"], label')) return

      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {})
      } else {
        document.exitFullscreen().catch(() => {})
      }
    }
    window.addEventListener('dblclick', handler)
    return () => window.removeEventListener('dblclick', handler)
  }, [])

  return showHint
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const pathname = usePathname()
  const isFullscreen = useFullscreenOnDblClick()
  const arrowHint = useArrowKeyNavigation()

  return (
    <AuthProvider>
      <ToastProvider>
        <div className="flex min-h-screen bg-bg" style={{ overflowX: 'clip' }}>
          {/* Desktop Sidebar */}
          <Sidebar />

          <main className="flex-1 min-w-0 pb-20 lg:pb-0 relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
                className="h-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Mobile Navigation */}
          <BottomNav onMenuClick={() => setIsDrawerOpen(true)} />
          <MobileDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
          
          <GlobalSearch />
          <UploadProgress />

          {/* Indicador de navegación con flechas ← → */}
          <AnimatePresence>
            {arrowHint && (
              <motion.div
                key={`arrow-${arrowHint}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                  zIndex: 99998, pointerEvents: 'none',
                  background: 'rgba(45,58,51,0.72)', backdropFilter: 'blur(8px)',
                  color: '#E0E8DC', borderRadius: 10, padding: '6px 16px',
                  fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
                  letterSpacing: '0.04em', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                {arrowHint === 'back' ? '← Atrás' : 'Adelante →'}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Indicador de pantalla completa — aparece 2 s al entrar, luego desaparece */}
          <AnimatePresence>
            {isFullscreen && (
              <motion.div
                key="fs-hint"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.25 }}
                style={{
                  position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                  zIndex: 99999, pointerEvents: 'none',
                  background: 'rgba(45,58,51,0.72)', backdropFilter: 'blur(8px)',
                  color: '#E0E8DC', borderRadius: 10, padding: '6px 16px',
                  fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
                  letterSpacing: '0.06em', whiteSpace: 'nowrap',
                }}
              >
                Pantalla completa · Doble clic o ESC para salir
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ToastProvider>
    </AuthProvider>
  )
}
