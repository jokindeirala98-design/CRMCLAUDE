import React from 'react'

interface VoltisLogoProps {
  /** Height in pixels (width scales proportionally, ~2:1 ratio) */
  height?: number
  /** Main wordmark color. Defaults to brand dark green. */
  color?: string
  /** Subtitle "energía" color. Defaults to salvia green. */
  subtitleColor?: string
  className?: string
}

/**
 * Voltis Energía brand wordmark as inline SVG.
 * Layout: "Voltis" grande arriba, "energía" centrado debajo.
 * Aspect ratio ≈ 2 : 1.
 */
export function VoltisLogo({
  height = 40,
  color = '#1F3A2E',
  subtitleColor = '#6B8068',
  className,
}: VoltisLogoProps) {
  const w = Math.round(2 * height)
  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 240 120"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Voltis Energía"
      role="img"
      style={{ display: 'block' }}
    >
      {/* "Voltis" wordmark — centrado horizontalmente */}
      <text
        x="120"
        y="74"
        textAnchor="middle"
        fontFamily='"Inter Tight", "Inter", -apple-system, sans-serif'
        fontWeight="700"
        fontSize="76"
        letterSpacing="-2"
        fill={color}
      >
        Voltis
      </text>
      {/* "energía" subtitle — centrado debajo de Voltis */}
      <text
        x="120"
        y="112"
        textAnchor="middle"
        fontFamily='"Inter Tight", "Inter", -apple-system, sans-serif'
        fontWeight="400"
        fontSize="26"
        letterSpacing="2"
        fill={subtitleColor}
      >
        energía
      </text>
    </svg>
  )
}
