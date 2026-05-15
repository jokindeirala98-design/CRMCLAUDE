/**
 * Hook reutilizable para BLOQUEAR el scroll del body cuando un modal está
 * abierto. Si el usuario desliza con la rueda o el dedo, el scroll afecta
 * SOLO al contenido del modal, no a la página detrás.
 *
 * Uso:
 *   useBodyScrollLock(modalOpen)
 *
 * Recuerda al ancho original del body para evitar el "jump horizontal" que
 * causa la desaparición de la scrollbar al fijar overflow:hidden.
 */
import { useEffect } from 'react'

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (typeof document === 'undefined') return

    const body = document.body
    const html = document.documentElement

    // Guardamos los valores actuales para restaurarlos al desmontar.
    const prevBodyOverflow   = body.style.overflow
    const prevBodyPaddingR   = body.style.paddingRight
    const prevHtmlOverflow   = html.style.overflow

    // Compensamos el ancho de la scrollbar para que no haya jump.
    const scrollbarWidth = window.innerWidth - html.clientWidth
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'

    return () => {
      body.style.overflow      = prevBodyOverflow
      body.style.paddingRight  = prevBodyPaddingR
      html.style.overflow      = prevHtmlOverflow
    }
  }, [active])
}

/**
 * Variante que TAMBIÉN cierra el modal cuando se pulsa ESC.
 * Útil porque clicar fuera y ESC suelen ir juntos en convenciones de UX.
 */
export function useModalShortcuts(active: boolean, onClose: () => void) {
  useBodyScrollLock(active)

  useEffect(() => {
    if (!active) return
    if (typeof document === 'undefined') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [active, onClose])
}
