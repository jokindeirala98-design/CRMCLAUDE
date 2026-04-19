import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Voltis CRM - Gestion Energetica',
  description: 'Plataforma de gestion de clientes y suministros energeticos',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#1F3A2E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-bg">
        {children}
      </body>
    </html>
  )
}
