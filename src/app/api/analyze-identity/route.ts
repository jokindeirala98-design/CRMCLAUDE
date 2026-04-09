import { NextRequest, NextResponse } from 'next/server'
import { getMimeType } from '@/lib/gemini'
import {
  analyzeIdentityDocument,
  type ExtractedIdentityData,
} from '@/lib/identityExtractor'

export type { ExtractedIdentityData } from '@/lib/identityExtractor'

// Identity docs are smaller than invoices but we still want margin for retries.
export const maxDuration = 30

interface IdentityAnalysisRequest {
  file_base64: string
  file_type: string
  file_name?: string
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ExtractedIdentityData>> {
  try {
    const body = (await request.json()) as IdentityAnalysisRequest
    const { file_base64, file_type, file_name } = body

    if (!file_base64) {
      return NextResponse.json(
        {
          mode: 'manual',
          documentType: 'desconocido',
          error: 'file_base64 is required',
        } as ExtractedIdentityData,
        { status: 400 }
      )
    }

    const mimeType = getMimeType(file_name || '', file_type)
    const result = await analyzeIdentityDocument(file_base64, mimeType)
    return NextResponse.json(result)
  } catch (error) {
    console.error('analyze-identity route error:', error)
    return NextResponse.json(
      {
        mode: 'manual',
        documentType: 'desconocido',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ExtractedIdentityData,
      { status: 500 }
    )
  }
}
