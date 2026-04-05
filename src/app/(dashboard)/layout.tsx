'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { MobileDrawer } from '@/components/layout/MobileDrawer'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { GlobalSearch } from '@/components/layout/GlobalSearch'
import { UploadProgress } from '@/components/ui/UploadProgress'
import { motion, AnimatePresence } from 'framer-motion'
import { usePathname } from 'next/navigation'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const pathname = usePathname()

  return (
    <AuthProvider>
      <ToastProvider>
        <div className="flex min-h-screen bg-surface overflow-x-hidden">
          {/* Desktop Sidebar */}
          <Sidebar />

          <main className="flex-1 min-w-0 pb-20 lg:pb-0 relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
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
        </div>
      </ToastProvider>
    </AuthProvider>
  )
}
