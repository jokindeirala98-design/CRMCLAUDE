'use client'

import { useEffect } from 'react'
import { getAuthClient, createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import type { UserProfile } from '@/types/database'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading } = useAuthStore()

  useEffect(() => {
    let mounted = true

    const fetchProfile = async () => {
      try {
        // Read session directly from localStorage to avoid lock issues
        const raw = localStorage.getItem('voltis-auth')
        if (!raw) {
          if (mounted) setLoading(false)
          return
        }

        const session = JSON.parse(raw)
        if (!session?.user?.id) {
          if (mounted) setLoading(false)
          return
        }

        // Use data client (no auth lock) to fetch profile
        const supabase = createClient()
        const { data: profile, error } = await supabase
          .from('users_profile')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (mounted) {
          if (profile && !error) {
            setUser(profile as UserProfile)
          }
          setLoading(false)
        }
      } catch (err) {
        console.error('Auth error:', err)
        if (mounted) setLoading(false)
      }
    }

    fetchProfile()

    // Listen for auth changes (login/logout) using the auth client
    const authClient = getAuthClient()
    const { data: { subscription } } = authClient.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          // Wait a tick for localStorage to be updated by the auth client
          setTimeout(async () => {
            const db = createClient()
            const { data: profile } = await db
              .from('users_profile')
              .select('*')
              .eq('id', session.user.id)
              .single()
            if (mounted) setUser(profile as UserProfile | null)
          }, 100)
        } else if (event === 'SIGNED_OUT') {
          if (mounted) setUser(null)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setUser, setLoading])

  return <>{children}</>
}
