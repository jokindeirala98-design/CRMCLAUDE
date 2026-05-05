'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthClient, createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import type { UserProfile } from '@/types/database'

/**
 * AuthProvider — gestiona el estado de autenticación desde las cookies de Supabase.
 *
 * Flujo:
 *  1. Al montar: lee la sesión desde las cookies (getSession).
 *  2. Si hay sesión válida → busca el perfil en users_profile → guarda en Zustand → muestra la app.
 *  3. Si no hay sesión o no hay perfil → redirige a /login.
 *  4. Solo escucha SIGNED_OUT para limpiar estado. NO maneja SIGNED_IN aquí,
 *     para evitar la race condition donde el listener borra al usuario que initAuth acaba de setear.
 *  5. Timeout de seguridad de 8s: si getSession tarda demasiado, va a /login.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading } = useAuthStore()
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const resolvedRef = useRef(false)

  useEffect(() => {
    let mounted = true
    const authClient = getAuthClient()

    // Resolve once — subsequent calls are no-ops (prevents double-resolve from timeout + initAuth)
    const resolve = (user: UserProfile | null, redirect?: string) => {
      if (!mounted || resolvedRef.current) return
      resolvedRef.current = true
      setUser(user)
      setLoading(false)
      setAuthChecked(true)
      if (redirect) router.replace(redirect)
    }

    const initAuth = async () => {
      try {
        const { data: { session }, error } = await authClient.auth.getSession()

        if (error || !session?.user) {
          resolve(null, '/login')
          return
        }

        const db = createClient()
        const { data: profile } = await db
          .from('users_profile')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (!mounted) return

        if (profile) {
          resolve(profile as UserProfile)
        } else {
          // Usuario autenticado pero sin fila de perfil — cerrar sesión y redirigir
          await authClient.auth.signOut().catch(() => {})
          resolve(null, '/login')
        }
      } catch {
        // Error de red u otro — ir a login para no quedarse bloqueado
        resolve(null, '/login')
      }
    }

    // Seguro de emergencia: si tarda más de 8s, desbloquear la UI
    const timeout = setTimeout(() => resolve(null, '/login'), 8000)

    initAuth().finally(() => clearTimeout(timeout))

    // Solo escuchar SIGNED_OUT — SIGNED_IN puede dispararse al restaurar cookies y
    // crear una race condition que limpia al usuario que initAuth acaba de poner.
    const { data: { subscription } } = authClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && mounted) {
        resolvedRef.current = false
        setUser(null)
        setLoading(false)
        router.replace('/login')
      }
    })

    return () => {
      mounted = false
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [setUser, setLoading, router])

  // Mostrar spinner hasta que se resuelva el estado de auth
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="w-8 h-8 border-[3px] border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
