'use client'

/**
 * Portal v2 — Login (solicitud de magic link).
 *
 * El cliente introduce su email; si está registrado como portal_user
 * activo, le mandamos un enlace de acceso de un solo uso. Nunca
 * confirmamos si el email existe o no para evitar enumeración.
 */
import { useState } from 'react'
import Image from 'next/image'

type State = 'idle' | 'submitting' | 'sent' | 'error'

export default function PortalLoginPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'submitting') return
    setState('submitting')
    setErrorMsg(null)
    try {
      const res = await fetch('/api/portal/v2/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'No se pudo enviar el correo')
      }
      setState('sent')
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error inesperado')
      setState('error')
    }
  }

  return (
    <div className="min-h-[calc(100vh-160px)] flex items-center justify-center px-6">
      <div className="voltis-glass w-full max-w-md p-8 md:p-10 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.08), transparent)' }} />

        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div className="relative w-14 h-14">
              <Image src="/mascota-transparente.png" alt="Voltis" width={56} height={56} priority />
            </div>
            <div>
              <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B9D1FF]">
                Portal cliente
              </div>
              <h1 className="text-xl font-bold text-white">Accede a tu energía</h1>
            </div>
          </div>

          {state === 'sent' ? (
            <div className="space-y-4 text-white/85">
              <p className="text-sm leading-relaxed">
                Si <span className="font-semibold text-white">{email}</span> está registrado en
                Voltis, te hemos enviado un enlace de acceso. Es válido durante 30 minutos.
              </p>
              <p className="text-xs text-white/65">
                Revisa también la carpeta de spam. Si no aparece, contáctanos.
              </p>
              <button
                onClick={() => { setState('idle'); setEmail('') }}
                className="text-xs text-[#B9D1FF] hover:text-white transition underline underline-offset-4">
                Probar con otro email
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-[10px] uppercase tracking-[0.18em] text-white/70 mb-2">
                  Tu email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="nombre@empresa.com"
                  className="w-full px-4 py-3 rounded-xl bg-white/8 border border-white/20
                             text-white placeholder:text-white/40 focus:outline-none
                             focus:ring-2 focus:ring-[#B9D1FF]/40 focus:border-white/40 transition" />
              </div>

              <button
                type="submit"
                disabled={state === 'submitting'}
                className="w-full py-3 rounded-xl font-semibold text-sm transition
                           disabled:opacity-60 disabled:cursor-not-allowed
                           bg-white text-[#0A2061] hover:bg-white/90">
                {state === 'submitting' ? 'Enviando enlace…' : 'Enviar enlace de acceso'}
              </button>

              {errorMsg && (
                <p className="text-xs text-red-300/90 bg-red-500/10 border border-red-500/30
                              rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}

              <p className="text-[11px] text-white/55 leading-relaxed pt-2">
                No usamos contraseñas. Cada vez que entres, te mandaremos un enlace
                seguro a tu correo. La sesión se mantiene durante 30 días.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
