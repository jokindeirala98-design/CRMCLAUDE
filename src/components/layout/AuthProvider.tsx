'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthClient, createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import type { UserProfile } from '@/types/database'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading } = useAuthStore()
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    let mounted = true

    const fetchProfile = async () => {
      try {
        // Read session directly from localStorage to avoid lock issues
        const raw = localStorage.getItem('voltis-auth')
        if (!raw) {
          if (mounted) {
            setLoading(false)
            setAuthChecked(true)
            // No session → redirect to login
            router.replace('/login')
          }
          return
        }

        const session = JSON.parse(raw)
        if (!session?.user?.id) {
          if (mounted) {
            setLoading(false)
            setAuthChecked(true)
            router.replace('/login')
          }
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
            setAuthenticated(true)
          } else {
            // Profile not found or error → invalid session, redirect
            localStorage.removeItem('voltis-auth')
            router.replace('/login')
          }
          setLoading(false)
          setAuthChecked(true)
        }
      } catch (err) {
        console.error('Auth error:', err)
        if (mounted) {
          setLoading(false)
          setAuthChecked(true)
          router.replace('/login')
        }
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
            if (mounted) {
              setUser(profile as UserProfile | null)
              if (profile) setAuthenticated(true)
            }
          }, 100)
        } else if (event === 'SIGNED_OUT') {
          if (mounted) {
            setUser(null)
            setAuthenticated(false)
            router.replace('/login')
          }
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setUser, setLoading, router])

  // Show nothing until auth is checked — prevents flash of dashboard without user
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Not authenticated — don't render dashboard children (redirect is in progress)
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
