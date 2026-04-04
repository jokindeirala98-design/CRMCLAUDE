import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/export-prescorings
 *
 * Exports prescoring data to a proper CSV file that Excel opens cleanly.
 * Uses UTF-8 BOM + tab separation for perfect Spanish locale compatibility.
 */

interface PrescoringSummary {
  client_name: string
  cups: string | null
  cif: string | null
  producto: string | null
  tariff: string | null
  consumo_anual: string | null
  entidad: string | null
  telefono: string | null
  poblacion: string | null
  direccion_fiscal: string | null
  status: string
  requested_at: string
  sent_at: string | null
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function escapeField(v: string): string {
  // For tab-separated: only need to escape if contains tab or newline
  const s = (v || '').replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '')
  return s
}

export async function POST(request: NextRequest) {
  try {
    const { prescorings, scope } = await request.json() as {
      prescorings: PrescoringSummary[]
      scope: 'view' | 'all'
    }

    if (!prescorings || !Array.isArray(prescorings)) {
      return NextResponse.json({ error: 'prescorings array required' }, { status: 400 })
    }

    const headers = [
      'ENVIADO', 'FECHA/HORA', 'CUPS', 'NOMBRE', 'CIF',
      'PRODUCTO', 'TARIFA', 'CONSUMO ANUAL', 'ENTIDAD',
      'TELÉFONO', 'POBLACIÓN', 'DIRECCIÓN FISCAL',
    ]

    const rows = prescorings.map((p) => [
      p.status === 'sent' ? 'SI' : 'NO',
      fmtDate(p.requested_at),
      p.cups || '',
      p.client_name || '',
      p.cif || '',
      p.producto || '',
      p.tariff || '',
      p.consumo_anual || '',
      p.entidad || '',
      p.telefono || '',
      p.poblacion || '',
      p.direccion_fiscal || '',
    ].map(v => escapeField(v)).join('\t'))

    // UTF-8 BOM + tab-separated values = Excel opens perfectly with correct encoding
    const tsv = '\uFEFF' + [headers.join('\t'), ...rows].join('\r\n')
    const buffer = Buffer.from(tsv, 'utf-8')

    // Use .xls extension — Excel opens tab-separated files with .xls perfectly
    const filename = `prescorings_${scope}_${new Date().toISOString().split('T')[0]}.xls`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Export prescorings error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
