import { NextRequest, NextResponse } from 'next/server'
import { getMimeType, type ExtractedInvoiceData } from '@/lib/gemini'
import { smartAnalyzeInvoice } from '@/lib/smart-invoice-extractor'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Re-export types for backward compatibility
export type { ExtractedInvoiceData } from '@/lib/gemini'

// Vercel Pro supports up to 300s. Extraction with large line-item lists
// and 3-attempt retry wrapper can take 60+ seconds worst case.
export const maxDuration = 120

interface InvoicePageData {
  file_base64: string
  file_type: string
  file_name?: string
}

interface InvoiceAnalysisRequest extends InvoicePageData {
  // Optional additional pages (e.g. a 2-page invoice scanned as 2 images).
  // All pages are sent to Gemini together in a single request for best extraction.
  extra_pages?: InvoicePageData[]
}

export async function POST(request: NextRequest): Promise<NextResponse<ExtractedInvoiceData>> {
  // Auth guard — only authenticated CRM users can call Gemini analysis routes
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { mode: 'manual', error: 'Unauthorized' } as ExtractedInvoiceData,
      { status: 401 }
    )
  }

  try {
    const body = await request.json() as InvoiceAnalysisRequest

    const { file_base64, file_type, file_name, extra_pages } = body

    if (!file_base64) {
      return NextResponse.json(
        { mode: 'manual', error: 'file_base64 is required' } as ExtractedInvoiceData,
        { status: 400 }
      )
    }

    const mimeType = getMimeType(file_name || '', file_type)

    // Build extra pages array for multi-page invoices
    const extraPages = extra_pages?.map(p => ({
      base64Data: p.file_base64,
      mimeType: getMimeType(p.file_name || '', p.file_type),
    }))

    const { extracted } = await smartAnalyzeInvoice(
      file_base64,
      mimeType,
      extraPages?.length ? extraPages : undefined,
    )
    return NextResponse.json(extracted)
  } catch (error) {
    console.error('API route error:', error)
    return NextResponse.json(
      {
        mode: 'manual',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ExtractedInvoiceData,
      { status: 500 }
    )
  }
}
