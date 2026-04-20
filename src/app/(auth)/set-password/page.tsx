'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { getAuthClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

/**
 * /auth/set-password
 *
 * Landing page for invited users.
 * Supabase sends them here with a magic-link token in the URL hash
 * (#access_token=...&type=invite). We exchange it for a session, then let
 * the user pick their password.
 */
export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const router = useRouter()

  // On mount: exchange the invite token from the URL hash for a session
  useEffect(() => {
    const supabase = getAuthClient()

    // Supabase automatically handles the hash tokens on initialisation.
    // We just need to listen for the session change triggered by the invite link.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
        setUserEmail(session.user.email || '')
        setSessionReady(true)
      }
    })

    // Also check for an existing session in case the page reloads after token exchange
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUserEmail(session.user.email || '')
        setSessionReady(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    const supabase = getAuthClient()

    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return
    }

    // Mark user as active in users_profile
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('users_profile')
        .update({ active: true })
        .eq('id', user.id)
    }

    setDone(true)
    setLoading(false)

    // Redirect to dashboard after a short pause
    setTimeout(() => router.push('/panel'), 2000)
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="font-sans font-bold text-xl text-white">Voltis Energia</span>
        </div>
        <div>
          <h2 className="font-sans font-bold text-4xl text-white leading-tight">
            Bienvenido al equipo
            <br />
            <span className="text-brand-fixed_dim">Configura tu acceso</span>
          </h2>
          <p className="text-white/60 mt-4 text-lg max-w-md">
            Elige una contraseña segura para acceder a tu cuenta de Voltis CRM.
          </p>
        </div>
        <p className="text-white/30 text-sm">Voltis Energia {new Date().getFullYear()}</p>
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="font-sans font-bold text-lg text-ink">Voltis Energia</span>
          </div>

          {done ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-ok-container/40 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-ok" />
              </div>
              <h1 className="font-sans font-bold text-2xl text-ink">¡Todo listo!</h1>
              <p className="text-ink-3 text-sm">Tu cuenta está activa. Redirigiendo al panel…</p>
            </div>
          ) : !sessionReady ? (
            <div className="text-center space-y-3">
              <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-ink-3 text-sm">Verificando enlace de invitación…</p>
              <p className="text-ink-4 text-xs">
                Si esto tarda más de unos segundos, asegúrate de haber abierto el enlace
                exacto que recibiste por email.
              </p>
            </div>
          ) : (
            <>
              <h1 className="font-sans font-bold text-2xl text-ink mb-1">Crear contraseña</h1>
              {userEmail && (
                <p className="text-ink-3 text-sm mb-6">
                  Cuenta: <span className="font-medium text-ink">{userEmail}</span>
                </p>
              )}

              {error && (
                <div className="mb-4 p-3 bg-err-container/40 rounded-xl">
                  <p className="text-sm text-err">{error}</p>
                </div>
              )}

              <form onSubmit={handleSetPassword} className="space-y-4">
                <div className="relative">
                  <Input
                    label="Nueva contraseña"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    hint="Mínimo 8 caracteres"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-8 text-ink-3 hover:text-ink"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <Input
                  label="Confirmar contraseña"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading}
                >
                  {loading ? 'Guardando…' : 'Activar cuenta'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
