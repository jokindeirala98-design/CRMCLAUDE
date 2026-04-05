import { NextRequest, NextResponse } from 'next/server'

export type DocumentType = 'invoice' | 'cif' | 'nif' | 'bank_certificate' | 'other'

interface ClassifyDocumentsRequest {
  file_url: string
  file_name: string
}

interface ClassifyDocumentsResponse {
  type: DocumentType
  confidence: number
  error?: string
}

/**
 * POST /api/classify-documents
 *
 * Classifies documents based on filename heuristics.
 * Can be extended later to use Google Gemini API for advanced OCR/image analysis.
 *
 * Request body:
 *   {
 *     file_url: string (optional, for future AI classification)
 *     file_name: string (required for filename-based heuristics)
 *   }
 *
 * Response:
 *   {
 *     type: 'invoice' | 'cif' | 'nif' | 'bank_certificate' | 'other',
 *     confidence: number (0-1)
 *   }
 */

function classifyByFileName(fileName: string): { type: DocumentType; confidence: number } {
  const lowerFileName = fileName.toLowerCase()

  // Remove extension and whitespace
  const cleanName = lowerFileName.replace(/\.[^.]+$/, '').trim()

  // CIF classification
  if (cleanName.includes('cif') || cleanName.includes('certificate of incorporation')) {
    return { type: 'cif', confidence: 0.95 }
  }

  // NIF classification
  if (
    cleanName.includes('nif') ||
    cleanName.includes('dni') ||
    cleanName.includes('documento nacional') ||
    cleanName.includes('national id')
  ) {
    return { type: 'nif', confidence: 0.95 }
  }

  // Bank certificate classification
  if (
    cleanName.includes('iban') ||
    cleanName.includes('banco') ||
    cleanName.includes('bancari') ||
    cleanName.includes('titularidad') ||
    cleanName.includes('bank') ||
    cleanName.includes('cuenta') ||
    cleanName.includes('account')
  ) {
    return { type: 'bank_certificate', confidence: 0.9 }
  }

  // Invoice classification
  if (
    cleanName.includes('factura') ||
    cleanName.includes('invoice') ||
    cleanName.includes('invoice_') ||
    cleanName.includes('bill') ||
    cleanName.includes('recibo') ||
    cleanName.match(/inv[_-]?\d/) ||
    cleanName.match(/fac[_-]?\d/)
  ) {
    return { type: 'invoice', confidence: 0.92 }
  }

  // Default: other
  return { type: 'other', confidence: 0.3 }
}

async function classifyWithAI(
  fileUrl: string,
  fileName: string
): Promise<{ type: DocumentType; confidence: number }> {
  const apiKey = process.env.GEMINI_API_KEY

  // If no API key, fall back to filename-based classification
  if (!apiKey) {
    return classifyByFileName(fileName)
  }

  try {
    // Download the file to get base64 data for Gemini API
    const response = await fetch(fileUrl)
    if (!response.ok) {
      // Fall back to filename classification if fetch fails
      return classifyByFileName(fileName)
    }

    const buffer = await response.arrayBuffer()
    const base64Data = Buffer.from(buffer).toString('base64')

    // Determine MIME type from filename
    let mimeType = 'image/jpeg'
    if (fileName.toLowerCase().includes('.pdf')) {
      mimeType = 'application/pdf'
    } else if (fileName.toLowerCase().includes('.png')) {
      mimeType = 'image/png'
    } else if (fileName.toLowerCase().includes('.webp')) {
      mimeType = 'image/webp'
    }

    // Call Google Gemini API with vision capabilities
    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Classify this document image and return ONLY valid JSON (no markdown, no explanation):
                  {
                    "type": "invoice" | "cif" | "nif" | "bank_certificate" | "other",
                    "confidence": 0.0-1.0
                  }

                  Guidelines:
                  - "invoice": utility bills, invoices (luz, gas, telefonica), receipts
                  - "cif": Company tax ID documents (Certificate of Incorporation)
                  - "nif": Personal tax ID documents (National ID, DNI)
                  - "bank_certificate": Bank account proofs, account titleholders, IBAN documents
                  - "other": Any other document type

                  Be strict about classification. Return high confidence (0.9+) only if you're certain.`,
                },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 512,
          },
        }),
      }
    )

    const geminiData = await geminiResponse.json()

    if (!geminiResponse.ok) {
      console.error('Gemini API error:', geminiData)
      // Fall back to filename classification
      return classifyByFileName(fileName)
    }

    // Extract text from Gemini response
    const content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      return classifyByFileName(fileName)
    }

    // Parse JSON response
    const parsed = JSON.parse(content)
    return {
      type: parsed.type || 'other',
      confidence: parsed.confidence || 0.5,
    }
  } catch (error) {
    console.error('Error classifying with Gemini:', error)
    // Always fall back to filename classification on error
    return classifyByFileName(fileName)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ClassifyDocumentsResponse>> {
  try {
    const body = (await request.json()) as ClassifyDocumentsRequest

    const { file_url, file_name } = body

    if (!file_name) {
      return NextResponse.json(
        {
          type: 'other',
          confidence: 0,
          error: 'file_name is required',
        } as ClassifyDocumentsResponse,
        { status: 400 }
      )
    }

    // If file_url is provided and Gemini API is configured, try AI classification
    // Otherwise, use filename-based heuristics
    let result: { type: DocumentType; confidence: number }

    if (file_url) {
      result = await classifyWithAI(file_url, file_name)
    } else {
      result = classifyByFileName(file_name)
    }

    return NextResponse.json({
      type: result.type,
      confidence: result.confidence,
    } as ClassifyDocumentsResponse)
  } catch (error) {
    console.error('API route error:', error)
    return NextResponse.json(
      {
        type: 'other',
        confidence: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ClassifyDocumentsResponse,
      { status: 500 }
    )
  }
}
