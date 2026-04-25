import React from 'react'

interface VoltisLogoProps {
  /** Height in pixels (width scales proportionally, ~3.6:1 ratio) */
  height?: number
  /** Main wordmark color. Defaults to brand dark green. */
  color?: string
  /** Subtitle "energía" color. Defaults to salvia green. */
  subtitleColor?: string
  className?: string
}

/**
 * Voltis Energía brand wordmark as inline SVG.
 * Aspect ratio ≈ 360 × 100 (3.6 : 1).
 * Colors aligned with themeSalvia design system.
 */
export function VoltisLogo({
  height = 40,
  color = '#1F3A2E',
  subtitleColor = '#6B8068',
  className,
}: VoltisLogoProps) {
  const w = Math.round(3.6 * height)
  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 360 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Voltis Energía"
      role="img"
      style={{ display: 'block' }}
    >
      {/* "Voltis" wordmark */}
      <text
        x="0" y="72"
        fontFamily='"Inter Tight", "Inter", -apple-system, sans-serif'
        fontWeight="700"
        fontSize="80"
        letterSpacing="-3"
        fill={color}
      >
        Voltis
      </text>
      {/* "energía" subtitle */}
      <text
        x="234" y="96"
        fontFamily='"Inter Tight", "Inter", -apple-system, sans-serif'
        fontWeight="400"
        fontSize="22"
        letterSpacing="0.5"
        fill={subtitleColor}
      >
        energía
      </text>
    </svg>
  )
}
