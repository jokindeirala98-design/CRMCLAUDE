import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { GlobalSearch } from '@/components/layout/GlobalSearch'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <ToastProvider>
        <div className="flex min-h-screen bg-surface">
          <Sidebar />
          <main className="flex-1 min-w-0 pb-20 lg:pb-0">
            {children}
          </main>
          <MobileNav />
          <GlobalSearch />
        </div>
      </ToastProvider>
    </AuthProvider>
  )
}
