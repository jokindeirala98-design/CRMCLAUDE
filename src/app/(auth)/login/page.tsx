'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Zap } from 'lucide-react'
import { getAuthClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// ── Inner component that uses useSearchParams ─────────────────────────────────
function LoginForm() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const router       = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const e = searchParams.get('error')
    if (e === 'session_expired') setError('Tu sesión ha expirado. Vuelve a iniciar sesión.')
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = getAuthClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Credenciales incorrectas. Verifica tu email y contraseña.')
      setLoading(false)
      return
    }

    // Use full page reload to ensure clean state after login.
    // router.push() can cause hydration mismatches when session cookies
    // are set by signInWithPassword but the React tree is still mid-render.
    window.location.href = '/panel'
  }

  return (
    <div className="w-full max-w-sm">

      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-3 mb-10">
        <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center">
          <Zap className="w-6 h-6 text-white" />
        </div>
        <span className="font-sans font-bold text-xl text-brand">Voltis Energía</span>
      </div>

      <h1 className="font-sans font-bold text-2xl text-ink">Iniciar sesión</h1>
      <p className="text-sm text-ink-3 mt-1 mb-8">Accede a tu panel de gestión</p>

      <form onSubmit={handleLogin} className="space-y-4">
        <Input
          id="email"
          label="Email"
          type="email"
          placeholder="tu@voltisenergia.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <Input
          id="password"
          label="Contraseña"
          type="password"
          placeholder="Tu contraseña"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {error && (
          <div className="bg-err-container rounded-xl px-4 py-3">
            <p className="text-sm text-err font-medium">{error}</p>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Acceder
        </Button>
      </form>

      <p className="text-center text-[11px] text-ink-4 mt-8">
        Acceso restringido a miembros del equipo Voltis Energía
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  return (
    <div className="min-h-screen flex">

      {/* Left: Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="font-sans font-bold text-xl text-white">Voltis Energía</span>
        </div>

        <div>
          <h2 className="font-sans font-bold text-4xl text-white leading-tight">
            Gestión Energética<br />
            <span className="opacity-60 accent-italic">Inteligente</span>
          </h2>
          <p className="text-white/60 mt-4 text-lg max-w-md">
            Plataforma integral para la gestión de clientes, suministros y ahorro energético.
          </p>
        </div>

        <p className="text-white/30 text-sm">© Voltis Energía {new Date().getFullYear()}</p>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-bg">
        <Suspense fallback={<div className="w-full max-w-sm" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
