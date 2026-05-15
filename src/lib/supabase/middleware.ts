import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }: any) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const pathname = request.nextUrl.pathname

  // ⚠️ Rutas PÚBLICAS — no requieren sesión Supabase del CRM y no deben
  // redirigirse a /login. El portal del cliente usa su propio sistema
  // de magic link basado en cookie de portal (independiente de Supabase Auth).
  const PUBLIC_PREFIXES = [
    '/login',
    '/auth',
    '/api',          // API routes manejan su propia auth (Supabase Auth o portal token)
    '/portal',       // Portal cliente (magic link, sin login)
    '/p',            // Alias corto opcional para acceso público
    '/share',        // Cualquier compartido futuro (informe público, etc.)
  ]
  const isPublic = PUBLIC_PREFIXES.some(p => pathname.startsWith(p))

  // Sólo consultamos al usuario Supabase para rutas privadas: evita una
  // ida innecesaria al servicio de auth cuando el visitante no es admin.
  let user: { id: string } | null = null
  if (!isPublic || pathname.startsWith('/login')) {
    const { data } = await supabase.auth.getUser()
    user = data.user as any
  }

  // Redirige a login si: ruta privada y sin sesión.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Si ya hay sesión y el usuario pisa /login → al panel.
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/panel'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
