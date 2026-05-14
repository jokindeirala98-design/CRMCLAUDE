/**
 * Mascota oficial Voltis.
 *
 * Reemplaza cualquier icono "Sparkles/Lightbulb" que se usaba como logo
 * decorativo de Voltis. Nunca se debe inventar dibujo: solo este archivo.
 */
'use client'
import Image from 'next/image'

interface Props {
  size?: number          // px
  className?: string
}

export function Mascot({ size = 32, className = '' }: Props) {
  return (
    <Image
      src="/mascota-transparente.png"
      alt="Voltis"
      width={size}
      height={size}
      className={className}
      priority={size >= 60}
    />
  )
}
