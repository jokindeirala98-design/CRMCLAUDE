import { NextRequest, NextResponse } from 'next/server'
import {
  analyzeInvoice, getMimeType,
  type ExtractedInvoiceData,
} from '@/lib/gemini'

// Re-export types for backward compatibility
export type { ExtractedInvoiceData } from '@/lib/gemini'

// Vercel Hobby plan: max 10s per function (Pro supports 300s, but Next.js defaults to 30-15s)
export const maxDuration = 30

interface InvoiceAnalysisRequest {
  file_base64: string
  file_type: string
  file_name?: string
}

export async function POST(request: NextRequest): Promise<NextResponse<ExtractedInvoiceData>> {
  try {
    const body = await request.json() as InvoiceAnalysisRequest

    const { file_base64, file_type, file_name } = body

    if (!file_base64) {
      return NextResponse.json(
        { mode: 'manual', error: 'file_base64 is required' } as ExtractedInvoiceData,
        { status: 400 }
      )
    }

    const mimeType = getMimeType(file_name || '', file_type)
    const result = await analyzeInvoice(file_base64, mimeType)
    return NextResponse.json(result)
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
