import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeCups } from '@/lib/utils/cups'

export async function POST(request: NextRequest) {
  try {
    const { cups } = await request.json()

    if (!cups || typeof cups !== 'string') {
      return NextResponse.json({ exists: false, error: 'CUPS invalido' })
    }

    // Normalize to canonical 20-char form
    const normalizedCups = normalizeCups(cups)
    if (!normalizedCups) {
      return NextResponse.json({ exists: false, error: 'Formato de CUPS invalido' })
    }

    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set() {},
          remove() {},
        },
      }
    )

    // Check if CUPS exists in any supply (across ALL users/commercials)
    const { data: existingSupplies, error } = await supabase
      .from('supplies')
      .select('id, cups, client_id, status, client:clients(id, name, commercial_id)')
      .eq('cups', normalizedCups)
      .limit(5)

    if (error) {
      console.error('[check-cups] DB error:', error)
      return NextResponse.json({ exists: false, error: error.message })
    }

    if (existingSupplies && existingSupplies.length > 0) {
      return NextResponse.json({
        exists: true,
        supplies: existingSupplies.map((s: any) => ({
          id: s.id,
          cups: s.cups,
          status: s.status,
          client_name: s.client?.name || 'Sin cliente',
          client_id: s.client_id,
        })),
      })
    }

    return NextResponse.json({ exists: false })
  } catch (err: any) {
    console.error('[check-cups] Error:', err)
    return NextResponse.json({ exists: false, error: err.message })
  }
}
