/**
 * Excel export — usa la plantilla oficial de Voltis (public/templates/estudio-potencias-template.xlsx)
 *
 * Las gráficas (PNG) se generan en el navegador (Canvas API) y se envían como base64.
 * El servidor usa jszip para sustituirlas en el ZIP del xlsx.
 * image1 → gráfica de maxímetros
 * image2 → gráfica de consumo mensual
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
    const body = await request.json()
    const study: PowerStudyResult = body.study ?? body

    // Charts from browser Canvas API (base64 PNG data-URLs)
    const consumptionB64: string | undefined = body.charts?.consumption
    const maximetroB64:   string | undefined = body.charts?.maximetro

    // ── Load template ─────────────────────────────────────────────────────────
    const templatePath = path.join(process.cwd(), 'public', 'templates', 'estudio-potencias-template.xlsx')
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template no encontrado en public/templates/' }, { status: 500 })
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(templatePath)
    const ws = wb.worksheets[0]
    if (!ws) return NextResponse.json({ error: 'Template sin hojas' }, { status: 500 })

    // ── Header rows (CUPS, client name) ──────────────────────────────────────
    ws.getCell('A2').value = study.cups || ''
    ws.getCell('A3').value = study.clientName || ''

    // ── Adjustment message (K3, merged K3:P4) ────────────────────────────────
    const pc = study.potenciaContratada ?? ({} as Record<string, number>)
    const adj = PERIODS.map(p => {
      const cont = (pc as any)[p] ?? 0
      const maxV = study.maxPotencia?.[p] ?? 0
      const desvPct = cont > 0 ? ((maxV - cont) / cont) * 100 : 0
      return { period: p, maxV, cont, desvPct, needs: cont > 0 && maxV > 0 && Math.abs(desvPct) > 15 }
    })
    const excess = adj.filter(a => a.needs && a.desvPct > 0)
    const under  = adj.filter(a => a.needs && a.desvPct < 0)

    const adjCell = ws.getCell('K3')
    if (excess.length > 0) {
      adjCell.value = `AJUSTAR POTENCIAS ${excess.map(a => a.period).join(' · ')}`
      adjCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
      adjCell.font  = { bold: true, size: 13, color: { argb: 'FFC00000' } }
    } else if (under.length > 0) {
      adjCell.value = `POSIBLE REDUCCIÓN EN ${under.map(a => a.period).join(' · ')}`
      adjCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }
      adjCell.font  = { bold: true, size: 11, color: { argb: 'FF1F4E79' } }
    } else {
      adjCell.value = 'POTENCIAS DENTRO DE RANGO'
      adjCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } }
      adjCell.font  = { bold: true, size: 11, color: { argb: 'FF375623' } }
    }

    // ── PRIORIZAR message (D4, merged D4:I4) ──────────────────────────────────
    const activePeriods = PERIODS
      .filter(p => (study.consumoPorPeriodo?.[p] ?? 0) > 0)
      .sort((a, b) => (study.consumoPorPeriodo?.[b] ?? 0) - (study.consumoPorPeriodo?.[a] ?? 0))
    ws.getCell('D4').value = activePeriods.length > 0
      ? 'PRIORIZAR CONSUMO ' + activePeriods.slice(0, 3).join(' - ')
      : ''

    // ── Clear template data rows ──────────────────────────────────────────────
    for (let r = DATA_START_ROW; r <= MAX_TEMPLATE_ROWS; r++) {
      for (let c = 1; c <= 16; c++) {
        if (c === 10) continue   // col J — separator, leave as-is
        ws.getCell(r, c).value = null
      }
    }

    // ── Fill data rows from SIPS (sorted chronologically: oldest → newest) ────
    const meses = [...(study.meses ?? [])].sort((a, b) => new Date(a.fechaFin).getTime() - new Date(b.fechaFin).getTime())
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

    // ── Extend conditional formatting if data > template rows ────────────────
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

    // ── Serialize with ExcelJS ─────────────────────────────────────────────────
    const excelBuffer = Buffer.from(await wb.xlsx.writeBuffer())

    // ── Post-process with JSZip: replace chart images + fix drawing dimensions ─
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(excelBuffer)

    // Chart row placement: below data
    const chartStartRow = Math.max(DATA_START_ROW + meses.length + 1, 40)

    // Replace image2 → consumo mensual chart (PNG)
    if (consumptionB64) {
      const b64 = consumptionB64.replace(/^data:image\/\w+;base64,/, '')
      // Remove old files and add new PNG
      zip.remove('xl/media/image2.png')
      zip.remove('xl/media/image2.jpeg')
      zip.file('xl/media/image2.png', Buffer.from(b64, 'base64'))
    }

    // Replace image1 → maxímetro chart (PNG)
    if (maximetroB64) {
      const b64 = maximetroB64.replace(/^data:image\/\w+;base64,/, '')
      zip.remove('xl/media/image1.jpeg')
      zip.remove('xl/media/image1.png')
      zip.file('xl/media/image1.png', Buffer.from(b64, 'base64'))
    }

    // Update rels to point both images to .png
    zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>
</Relationships>`)

    // Rewrite drawing1.xml with proper wide dimensions for 820x300 charts
    // image2 (consumo): cols 0–9, rows chartStartRow to chartStartRow+14
    // image1 (maxímetros): cols 10–16, rows chartStartRow to chartStartRow+14
    const consumoFromRow = chartStartRow
    const consumoToRow = chartStartRow + 15
    const maxFromRow = chartStartRow
    const maxToRow = chartStartRow + 15

    zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${consumoFromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${consumoToRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="3" name="Consumo Mensual"/>
        <xdr:cNvPicPr><a:picLocks noChangeArrowheads="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId2"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr bwMode="auto">
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="7261412" cy="2857500"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${maxFromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${maxToRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="2" name="Maximetros"/>
        <xdr:cNvPicPr><a:picLocks noChangeArrowheads="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr bwMode="auto">
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="5000000" cy="2857500"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`)

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
