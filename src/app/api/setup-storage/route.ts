import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/setup-storage
 *
 * One-time setup endpoint: creates the "documents" storage bucket if it doesn't exist.
 * Requires SUPABASE_SERVICE_ROLE_KEY in environment variables (falls back to anon key,
 * but anon key may lack permission to create buckets — set the service role key).
 *
 * Find your service role key in:
 *   Supabase Dashboard → Project Settings → API → service_role (secret)
 *
 * Add to .env.local:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  try {
    // Check if bucket already exists
    const { data: existing } = await supabase.storage.getBucket('documents')

    if (existing) {
      return NextResponse.json({
        ok: true,
        message: 'Bucket "documents" ya existe.',
        bucket: existing,
      })
    }

    // Create the bucket
    const { data, error } = await supabase.storage.createBucket('documents', {
      public: true,
      fileSizeLimit: 52428800, // 50 MB
    })

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          hint: 'Asegúrate de que SUPABASE_SERVICE_ROLE_KEY está configurado en .env.local. La anon key no tiene permisos para crear buckets.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'Bucket "documents" creado correctamente.',
      bucket: data,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
