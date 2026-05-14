'use client'

/**
 * Panel "Partners externos" en la ficha de cliente.
 * Solo visible para admins. Toggle individual por partner.
 */
import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react'

const PARTNERS = [
  { slug: 'kivatio', name: 'Kivatio', description: 'Permitir consulta vía API' },
]

export function PartnersPanel({ clientId }: { clientId: string }) {
  const [states, setStates] = useState<Record<string, { shared: boolean; loading: boolean; granted_at?: string | null }>>({})

  useEffect(() => {
    PARTNERS.forEach(p => {
      setStates(s => ({ ...s, [p.slug]: { shared: false, loading: true } }))
      fetch(`/api/admin/partners/${p.slug}/clients/${clientId}`)
        .then(r => r.json())
        .then(d => setStates(s => ({ ...s, [p.slug]: { shared: !!d.shared, granted_at: d.granted_at, loading: false } })))
        .catch(() => setStates(s => ({ ...s, [p.slug]: { shared: false, loading: false } })))
    })
  }, [clientId])

  async function toggle(slug: string) {
    const cur = states[slug]
    if (!cur || cur.loading) return
    setStates(s => ({ ...s, [slug]: { ...cur, loading: true } }))
    const res = await fetch(`/api/admin/partners/${slug}/clients/${clientId}`, {
      method: cur.shared ? 'DELETE' : 'POST',
    })
    const data = await res.json()
    setStates(s => ({ ...s, [slug]: { shared: !!data.shared, granted_at: cur.shared ? null : new Date().toISOString(), loading: false } }))
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="text-xs uppercase tracking-wide font-semibold text-stone-500 mb-3">
        Partners externos
      </div>
      <div className="space-y-2">
        {PARTNERS.map(p => {
          const st = states[p.slug] ?? { shared: false, loading: true }
          return (
            <div key={p.slug} className="flex items-start gap-3 p-3 rounded-lg border border-stone-100 hover:bg-stone-50">
              <button
                onClick={() => toggle(p.slug)}
                disabled={st.loading}
                className={`mt-0.5 relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                  st.shared ? 'bg-brand' : 'bg-stone-300'
                } disabled:opacity-50`}
              >
                {st.loading
                  ? <Loader2 className="absolute left-1 top-1 w-4 h-4 animate-spin text-white" />
                  : (
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      st.shared ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  )
                }
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-stone-900 text-sm">{p.name}</span>
                  {st.shared
                    ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium"><ShieldCheck className="w-3 h-3"/> Activo</span>
                    : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500"><ShieldOff className="w-3 h-3"/> Inactivo</span>
                  }
                </div>
                <div className="text-xs text-stone-500 mt-0.5">{p.description}</div>
                {st.shared && st.granted_at && (
                  <div className="text-[10px] text-stone-400 mt-1">Activo desde {new Date(st.granted_at).toLocaleDateString('es-ES')}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
