/**
 * Excel export — usa la plantilla oficial de Voltis (public/templates/estudio-potencias-template.xlsx)
 *
 * Las gráficas (PNG) se generan en el navegador (Canvas API) y se envían como base64.
 * El servidor usa jszip para sustituirlas en el ZIP del xlsx.
 * Todos los datos de las tablas provienen 100% del SIPS (study.meses).
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'
import type { PowerStudyResult } from '@/app/api/power-study/route'

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = (typeof PERIODS)[number]

const CONSUMO_COL: Record<Period, number> = { P1: 4, P2: 5, P3: 6, P4: 7, P5: 8, P6: 9 }
const MAX_COL:     Record<Period, number> = { P1: 11, P2: 12, P3: 13, P4: 14, P5: 15, P6: 16 }

const DATA_START_ROW = 5
const MAX_TEMPLATE_ROWS = 39

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Body: { study, charts: { consumption?: string, maximetros?: string } }
    // charts are base64 data-URLs generated in the browser via Canvas API
    const body = await request.json()
    const study: PowerStudyResult = body.study ?? body
    const consumptionB64: string | undefined = body.charts?.consumption
    const maximetrosB64: string | undefined = body.charts?.maximetros

    // ── Cargar plantilla ──────────────────────────────────────────────────────
    const templatePath = path.join(process.cwd(), 'public', 'templates', 'estudio-potencias-template.xlsx')
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template no encontrado en public/templates/' }, { status: 500 })
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(templatePath)
    const ws = wb.worksheets[0]
    if (!ws) return NextResponse.json({ error: 'Template sin hojas' }, { status: 500 })

    // ── Cabecera (datos SIPS) ─────────────────────────────────────────────────
    ws.getCell('A2').value = study.cups || ''
    ws.getCell('A3').value = study.clientName || ''

    // ── Mensaje potencias (K3, merged K3:P4) ─────────────────────────────────
    const pc = study.potenciaContratada ?? ({} as Record<string, number>)
    const periodsExcess = PERIODS.filter(p => {
      const cont = (pc as any)[p] ?? 0
      const maxV = study.maxPotencia?.[p] ?? 0
      return cont > 0 && maxV > cont
    })
    const periodsLow = PERIODS.filter(p => {
      const cont = (pc as any)[p] ?? 0
      const maxV = study.maxPotencia?.[p] ?? 0
      return cont > 0 && maxV > 0 && maxV < cont * 0.85 && !periodsExcess.includes(p)
    })

    const adjustCell = ws.getCell('K3')
    if (periodsExcess.length > 0) {
      adjustCell.value = `AJUSTAR POTENCIAS ${periodsExcess.join(' · ')}`
      adjustCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
      adjustCell.font  = { bold: true, size: 13, color: { argb: 'FFC00000' } }
    } else if (periodsLow.length > 0) {
      adjustCell.value = `POSIBLE REDUCCION EN ${periodsLow.join(' · ')}`
      adjustCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }
      adjustCell.font  = { bold: true, size: 11, color: { argb: 'FF1F4E79' } }
    } else {
      adjustCell.value = 'POTENCIAS DENTRO DE RANGO'
      adjustCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } }
      adjustCell.font  = { bold: true, size: 11, color: { argb: 'FF375623' } }
    }

    // ── Mensaje priorización (D4, merged D4:I4) ───────────────────────────────
    const activePeriods = PERIODS
      .filter(p => (study.consumoPorPeriodo?.[p] ?? 0) > 0)
      .sort((a, b) => (study.consumoPorPeriodo?.[b] ?? 0) - (study.consumoPorPeriodo?.[a] ?? 0))
    ws.getCell('D4').value = activePeriods.length > 0
      ? 'PRIORIZAR CONSUMO ' + activePeriods.slice(0, 3).join(' - ')
      : ''

    // ── LIMPIAR todos los datos de la plantilla (Colegio el Huerto) ───────────
    for (let r = DATA_START_ROW; r <= MAX_TEMPLATE_ROWS; r++) {
      for (let c = 1; c <= 16; c++) {
        if (c === 10) continue
        ws.getCell(r, c).value = null
      }
    }

    // ── Rellenar con datos del SIPS ───────────────────────────────────────────
    const meses = study.meses ?? []
    meses.forEach((m, i) => {
      const r = DATA_START_ROW + i
      ws.getCell(r, 1).value = { formula: `SUM(D${r}:I${r})` }
      if (m.fechaInicio) {
        const d = new Date(m.fechaInicio)
        ws.getCell(r, 2).value = isNaN(d.getTime()) ? m.fechaInicio : d
        ws.getCell(r, 2).numFmt = 'DD/MM/YYYY'
      }
      if (m.fechaFin) {
        const d = new Date(m.fechaFin)
        ws.getCell(r, 3).value = isNaN(d.getTime()) ? m.fechaFin : d
        ws.getCell(r, 3).numFmt = 'DD/MM/YYYY'
      }
      PERIODS.forEach(p => {
        ws.getCell(r, CONSUMO_COL[p]).value = m.consumo?.[p] ?? 0
        ws.getCell(r, MAX_COL[p]).value = m.maximetro?.[p] ?? 0
      })
    })

    // ── Extender CF si hay más de 35 meses ────────────────────────────────────
    const lastDataRow = DATA_START_ROW + meses.length - 1
    if (lastDataRow > MAX_TEMPLATE_ROWS) {
      const cf = (ws as any).conditionalFormattings
      if (cf) {
        const ext = (o: string, n: string) => { for (const r of cf) { if (r.ref === o) r.ref = n } }
        ext(`A${DATA_START_ROW}:A${MAX_TEMPLATE_ROWS}`, `A${DATA_START_ROW}:A${lastDataRow}`)
        ext(`D${DATA_START_ROW}:I${MAX_TEMPLATE_ROWS}`, `D${DATA_START_ROW}:I${lastDataRow}`)
        ext(`K${DATA_START_ROW}:P${MAX_TEMPLATE_ROWS}`, `K${DATA_START_ROW}:P${lastDataRow}`)
      }
    }

    // ── Serializar con ExcelJS ────────────────────────────────────────────────
    const excelBuffer = Buffer.from(await wb.xlsx.writeBuffer())

    // ── Post-proceso con JSZip: sustituir imágenes estáticas ──────────────────
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(excelBuffer)

    // Gráfica de consumo mensual → reemplaza image2.png
    if (consumptionB64) {
      const b64 = consumptionB64.replace(/^data:image\/png;base64,/, '')
      zip.file('xl/media/image2.png', Buffer.from(b64, 'base64'))
    }

    // Gráfica de maxímetros → reemplaza image1.jpeg → image1.png
    if (maximetrosB64) {
      const b64 = maximetrosB64.replace(/^data:image\/png;base64,/, '')
      zip.remove('xl/media/image1.jpeg')
      zip.file('xl/media/image1.png', Buffer.from(b64, 'base64'))

      // Actualizar drawing rels: jpeg → png
      const drawingRelsFile = zip.file('xl/drawings/_rels/drawing1.xml.rels')
      if (drawingRelsFile) {
        const xml = (await drawingRelsFile.async('string'))
          .replace('Target="../media/image1.jpeg"', 'Target="../media/image1.png"')
        zip.file('xl/drawings/_rels/drawing1.xml.rels', xml)
      }
    }

    const finalBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const slug = (study.clientName || study.cups || 'estudio')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '').trim()
      .replace(/\s+/g, '_').slice(0, 40)

    return new NextResponse(finalBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Estudio_Potencias_${slug}.xlsx"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err: any) {
    console.error('[power-study-excel] Error:', err)
    return NextResponse.json({ error: err.message || 'Error generando Excel' }, { status: 500 })
  }
}
