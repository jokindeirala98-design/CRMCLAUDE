'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Zap } from 'lucide-react'
import { getAuthClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// ── Google icon ───────────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

// ── Error messages from OAuth callback ────────────────────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: 'Solo se permite el acceso con cuentas @voltisenergia.com.',
  auth_failed:        'Error al autenticar con Google. Inténtalo de nuevo.',
  oauth_cancelled:    'Inicio de sesión cancelado.',
  no_code:            'Error en el proceso OAuth. Inténtalo de nuevo.',
}

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [gLoading, setGLoading] = useState(false)
  const [error,    setError]    = useState('')

  const router       = useRouter()
  const searchParams = useSearchParams()

  // Show error forwarded from OAuth callback
  useEffect(() => {
    const e = searchParams.get('error')
    if (e) setError(ERROR_MESSAGES[e] ?? 'Ha ocurrido un error. Inténtalo de nuevo.')
  }, [searchParams])

  // ── Email / password ───────────────────────────────────────────────────────
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

    router.refresh()
    router.push('/panel')
  }

  // ── Google OAuth ───────────────────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    setGLoading(true)
    setError('')

    const supabase   = getAuthClient()
    const redirectTo = `${window.location.origin}/auth/callback`

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          hd:     'voltisenergia.com', // hint: show Workspace accounts first
          prompt: 'select_account',    // always show account picker
        },
      },
    })

    if (oauthError) {
      setError('No se pudo iniciar el proceso de autenticación con Google.')
      setGLoading(false)
    }
    // On success the browser is redirected to Google — no further action needed
  }

  const busy = loading || gLoading

  return (
    <div className="min-h-screen flex">

      {/* ── Left: Branding ─────────────────────────────────────────────────── */}
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

      {/* ── Right: Login form ───────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-bg">
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

          {/* ── Google button (primary CTA) ── */}
          <button
            onClick={handleGoogleLogin}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-line bg-card hover:bg-bg-2 active:scale-[0.98] transition-all text-sm font-semibold text-ink disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {gLoading ? (
              <svg className="animate-spin w-5 h-5 text-ink-3 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <GoogleIcon />
            )}
            {gLoading ? 'Redirigiendo a Google…' : 'Entrar con Google Workspace'}
          </button>

          {/* ── Divider ── */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-line" />
            <span className="text-[11px] text-ink-4 font-medium whitespace-nowrap">o con email y contraseña</span>
            <div className="flex-1 h-px bg-line" />
          </div>

          {/* ── Email / password form ── */}
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

            <Button type="submit" loading={loading} className="w-full" size="lg" disabled={busy}>
              Acceder
            </Button>
          </form>

          <p className="text-center text-[11px] text-ink-4 mt-8">
            Acceso restringido a miembros del equipo Voltis Energía
          </p>
        </div>
      </div>
    </div>
  )
}
