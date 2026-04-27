import { updateSession } from '@/lib/supabase/middleware'
import type { NextRequest } from 'next/server'

/**
 * Global middleware — enforces Supabase Auth on every page route.
 * - Unauthenticated users are redirected to /login.
 * - Authenticated users on /login are sent to /panel.
 * - API routes are excluded so they can handle their own auth checks.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)',
  ],
}
