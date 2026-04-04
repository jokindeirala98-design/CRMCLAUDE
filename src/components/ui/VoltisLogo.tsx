import React from 'react'

interface VoltisLogoProps {
  /** Height in pixels (width scales proportionally, ~3.3:1 ratio) */
  height?: number
  className?: string
}

/**
 * Voltis Energía brand logo as inline SVG.
 * Aspect ratio ≈ 178 × 54 (3.3 : 1).
 */
export function VoltisLogo({ height = 40, className }: VoltisLogoProps) {
  const w = Math.round((178 / 54) * height)
  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 178 54"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Voltis Energía"
      role="img"
    >
      {/* "Voltis" bold dark-blue text */}
      <text
        x="4" y="40"
        fontFamily="'Arial Black', Arial, sans-serif"
        fontWeight="900"
        fontSize="36"
        fill="#1A3A8C"
      >
        Voltis
      </text>
      {/* Ascending diagonal accent bar through the "l" */}
      <polygon points="45,52 55,52 61,2 51,2" fill="#2E75B6" opacity="0.85" />
      {/* "energía" subtitle */}
      <text
        x="73" y="52"
        fontFamily="Arial, sans-serif"
        fontSize="13"
        fill="#2E75B6"
        fontWeight="400"
      >
        energía
      </text>
      {/* Bottom-right accent element */}
      <polygon points="150,44 178,27 178,36 157,53 150,53" fill="#2E75B6" opacity="0.45" />
    </svg>
  )
}
