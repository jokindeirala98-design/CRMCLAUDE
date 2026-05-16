import { requirePortalSession } from '@/lib/portal/require-session'
import { PortalSideNav } from '../_components/SideNav'
import { PrevisionClient } from './PrevisionClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PrevisionPage() {
  await requirePortalSession()
  return (
    <div className="px-6 md:px-12 pb-24 md:pb-12">
      <div className="flex flex-col md:flex-row gap-6 md:gap-8 pt-4">
        <PortalSideNav />
        <div className="flex-1 min-w-0">
          <PrevisionClient />
        </div>
      </div>
    </div>
  )
}
