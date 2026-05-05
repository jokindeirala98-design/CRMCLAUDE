'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthClient, createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import type { UserProfile } from '@/types/database'

/**
 * AuthProvider — initialises the auth state from the Supabase session stored
 * in browser cookies (set by createBrowserClient / @supabase/ssr).
 *
 * Flow:
 *   1. On mount: call supabase.auth.getSession() — reads the persisted cookie.
 *   2. If session exists: fetch users_profile row → store in Zustand.
 *   3. If no session or no profile: redirect to /login.
 *   4. onAuthStateChange keeps the store in sync after login/logout.
 *
 * This replaces the broken pattern of reading `voltis-auth` from localStorage,
 * which never existed (Supabase SSR uses document.cookie, not localStorage).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading } = useAuthStore()
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    let mounted = true
    const authClient = getAuthClient()

    const initAuth = async () => {
      try {
        // Read the current session from browser cookies
        const { data: { session }, error } = await authClient.auth.getSession()

        if (error || !session?.user) {
          if (mounted) {
            setUser(null)
            setLoading(false)
            setAuthChecked(true)
            router.replace('/login')
          }
          return
        }

        // Fetch the users_profile row for this session
        const db = createClient()
        const { data: profile } = await db
          .from('users_profile')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (!mounted) return

        if (profile) {
          setUser(profile as UserProfile)
        } else {
          // Authenticated but no profile row — sign out and redirect
          await authClient.auth.signOut()
          setUser(null)
          setLoading(false)
          setAuthChecked(true)
          router.replace('/login')
          return
        }

        setLoading(false)
        setAuthChecked(true)
      } catch {
        // Network error or unexpected failure — fail safe: redirect to login
        if (mounted) {
          setUser(null)
          setLoading(false)
          setAuthChecked(true)
          router.replace('/login')
        }
      }
    }

    // Safety net: if initAuth takes more than 8s, unblock the UI
    const timeout = setTimeout(() => {
      if (mounted) {
        setUser(null)
        setLoading(false)
        setAuthChecked(true)
        router.replace('/login')
      }
    }, 8000)

    initAuth().finally(() => clearTimeout(timeout))

    // Keep store in sync after login / logout events.
    // NOTE: SIGNED_IN can fire on initial page load when restoring session from cookies,
    // racing with initAuth(). We only update user if we get a valid profile back — never
    // call setUser(null) here (that would wipe the user that initAuth() already set).
    const { data: { subscription } } = authClient.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const db = createClient()
          const { data: profile } = await db
            .from('users_profile')
            .select('*')
            .eq('id', session.user.id)
            .single()
          // Only update if we actually got a profile — don't clear existing user on fetch failure
          if (mounted && profile) {
            setUser(profile as UserProfile)
          }
        } else if (event === 'SIGNED_OUT') {
          if (mounted) {
            setUser(null)
            router.replace('/login')
          }
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Session silently refreshed — keep profile up-to-date
          const db = createClient()
          const { data: profile } = await db
            .from('users_profile')
            .select('*')
            .eq('id', session.user.id)
            .single()
          if (mounted && profile) setUser(profile as UserProfile)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setUser, setLoading, router])

  // Show spinner until auth state is resolved
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="w-8 h-8 border-[3px] border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
