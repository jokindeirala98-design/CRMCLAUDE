import { NextRequest, NextResponse } from 'next/server'
import {
  analyzeDocument, getMimeType,
  type ExtractedDocumentData,
} from '@/lib/gemini'

// Vercel Hobby plan: max 10s per function
// Max duration for Hobby/Pro plans (Vercel)
export const maxDuration = 60

interface DocumentAnalysisRequest {
  file_base64: string
  file_type: string
  file_name?: string
  doc_type?: any
}

export async function POST(request: NextRequest): Promise<NextResponse<ExtractedDocumentData>> {
  try {
    const body = await request.json() as DocumentAnalysisRequest
    const { file_base64, file_type, file_name, doc_type } = body

    if (!file_base64) {
      return NextResponse.json(
        { mode: 'manual', documentType: 'otro', error: 'file_base64 is required' } as ExtractedDocumentData,
        { status: 400 }
      )
    }

    const mimeType = getMimeType(file_name || '', file_type)
    const result = await analyzeDocument(file_base64, mimeType, doc_type)
    return NextResponse.json(result)
  } catch (error) {
    console.error('API route error (analyze-document):', error)
    return NextResponse.json(
      {
        mode: 'manual',
        documentType: 'otro',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ExtractedDocumentData,
      { status: 500 }
    )
  }
}
