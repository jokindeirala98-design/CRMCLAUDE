import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * GET /api/storage?path=invoices/xxx/file.pdf&action=view|download
 *
 * Generates a signed URL for viewing or downloading files from Supabase Storage.
 * Handles both public and private buckets by using signed URLs.
 */

function createSupabaseAdmin() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: any[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: any) =>
              cookieStore.set(name, value, options)
            )
          } catch { /* Server Component */ }
        },
      },
    }
  )
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filePath = searchParams.get('path')
    const action = searchParams.get('action') || 'view'
    const bucket = searchParams.get('bucket') || 'documents'

    if (!filePath) {
      return NextResponse.json({ error: 'Path es requerido' }, { status: 400 })
    }

    const supabase = createSupabaseAdmin()

    // Try to extract path from full public URL if needed
    let cleanPath = filePath
    const publicUrlPrefix = `/storage/v1/object/public/${bucket}/`
    if (cleanPath.includes(publicUrlPrefix)) {
      cleanPath = cleanPath.split(publicUrlPrefix).pop() || cleanPath
    }
    // Also handle full Supabase URLs
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    if (cleanPath.startsWith(supabaseUrl)) {
      cleanPath = cleanPath.replace(supabaseUrl, '')
      if (cleanPath.includes(publicUrlPrefix)) {
        cleanPath = cleanPath.split(publicUrlPrefix).pop() || cleanPath
      }
    }

    // Generate signed URL (works for both public and private buckets)
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(cleanPath, 3600, {
        download: action === 'download',
      })

    if (error || !data?.signedUrl) {
      console.error('[storage] Signed URL error:', error)

      // Fallback: try public URL
      const { data: publicData } = supabase.storage
        .from(bucket)
        .getPublicUrl(cleanPath, {
          download: action === 'download',
        })

      if (publicData?.publicUrl) {
        return NextResponse.redirect(publicData.publicUrl)
      }

      return NextResponse.json(
        { error: 'No se pudo generar URL para el archivo' },
        { status: 404 }
      )
    }

    return NextResponse.redirect(data.signedUrl)
  } catch (err: any) {
    console.error('[storage] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Error accediendo al archivo' },
      { status: 500 }
    )
  }
}
