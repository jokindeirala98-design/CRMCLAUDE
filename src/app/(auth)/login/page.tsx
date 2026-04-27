'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap } from 'lucide-react'
import { getAuthClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = getAuthClient()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError('Credenciales incorrectas')
      setLoading(false)
      return
    }

    // router.refresh() forces Next.js to re-run middleware with the new session cookie
    // before navigating, preventing the infinite loading / redirect loop
    router.refresh()
    router.push('/panel')
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
            Gestion Energetica
            <br />
            <span className="text-brand-fixed_dim">Inteligente</span>
          </h2>
          <p className="text-white/60 mt-4 text-lg max-w-md">
            Plataforma integral para la gestion de clientes, suministros y ahorro energetico.
          </p>
        </div>

        <p className="text-white/30 text-sm">
          Voltis Energia {new Date().getFullYear()}
        </p>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-bg">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="font-sans font-bold text-xl text-brand">Voltis Energia</span>
          </div>

          <h1 className="font-sans font-bold text-2xl text-ink">
            Iniciar sesion
          </h1>
          <p className="text-sm text-ink-3 mt-1 mb-8">
            Accede a tu panel de gestion
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              id="email"
              label="Email"
              type="email"
              placeholder="tu@voltisenergia.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              id="password"
              label="Contrasena"
              type="password"
              placeholder="Tu contrasena"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && (
              <div className="bg-err-container rounded-xl px-4 py-2.5">
                <p className="text-sm text-err font-medium">{error}</p>
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Acceder
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
