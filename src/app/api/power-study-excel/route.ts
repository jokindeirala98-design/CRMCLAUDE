/**
 * Excel export — uses the official Voltis template (public/templates/estudio-potencias-template.xlsx)
 *
 * Charts are generated SERVER-SIDE as SVG → PNG via sharp.
 * This ensures chronological ordering and consistent rendering regardless of browser.
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'
import type { PowerStudyResult } from '@/app/api/power-study/route'
import { buildConsumptionSVG, buildMaximetroSVG } from '@/lib/power-study-charts'

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = (typeof PERIODS)[number]

const CONSUMO_COL: Record<Period, number> = { P1: 4, P2: 5, P3: 6, P4: 7, P5: 8, P6: 9 }
const MAX_COL:     Record<Period, number> = { P1: 11, P2: 12, P3: 13, P4: 14, P5: 15, P6: 16 }

const DATA_START_ROW = 5
const MAX_TEMPLATE_ROWS = 39

/** Convert an SVG string to PNG buffer using sharp */
async function svgToPng(svg: string, width: number, height: number): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default
    const svgBuffer = Buffer.from(svg, 'utf-8')
    return await sharp(svgBuffer)
      .resize(width, height)
      .png()
      .toBuffer()
  } catch (err) {
    console.error('[power-study-excel] SVG→PNG conversion failed:', err)
    return null
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json()
    const study: PowerStudyResult = body.study ?? body
    const pc = study.potenciaContratada ?? ({} as Record<string, number>)
    // Client may send browser-rendered chart PNGs (base64 data URLs)
    const clientCharts = body.charts as { consumption?: string; maximetro?: string } | undefined

    // ── Load template ─────────────────────────────────────────────────────────
    const templatePath = path.join(process.cwd(), 'public', 'templates', 'estudio-potencias-template.xlsx')
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template no encontrado en public/templates/' }, { status: 500 })
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(templatePath)
    const ws = wb.worksheets[0]
    if (!ws) return NextResponse.json({ error: 'Template sin hojas' }, { status: 500 })

    // ── Header rows ──────────────────────────────────────────────────────────
    ws.getCell('A2').value = study.cups || ''
    ws.getCell('A3').value = study.clientName || ''

    // ── Adjustment message (K3) ──────────────────────────────────────────────
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

    // ── PRIORIZAR message (D4) ────────────────────────────────────────────────
    const activePeriods = PERIODS
      .filter(p => (study.consumoPorPeriodo?.[p] ?? 0) > 0)
      .sort((a, b) => (study.consumoPorPeriodo?.[b] ?? 0) - (study.consumoPorPeriodo?.[a] ?? 0))
    ws.getCell('D4').value = activePeriods.length > 0
      ? 'PRIORIZAR CONSUMO ' + activePeriods.slice(0, 3).join(' - ')
      : ''

    // ── Clear template data rows ──────────────────────────────────────────────
    for (let r = DATA_START_ROW; r <= MAX_TEMPLATE_ROWS; r++) {
      for (let c = 1; c <= 16; c++) {
        if (c === 10) continue
        ws.getCell(r, c).value = null
      }
    }

    // ── Fill data rows (sorted: most recent first) ─────────────
    const meses = [...(study.meses ?? [])].sort((a, b) => new Date(b.fechaFin).getTime() - new Date(a.fechaFin).getTime())
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

    // ── Chart PNGs: prefer browser-rendered (fonts work), fall back to server-side
    let consumoPng: Buffer | null = null
    let maximetroPng: Buffer | null = null

    // Use client-provided PNGs if available (base64 data URLs from browser canvas)
    if (clientCharts?.consumption) {
      try {
        const b64 = clientCharts.consumption.replace(/^data:image\/\w+;base64,/, '')
        consumoPng = Buffer.from(b64, 'base64')
      } catch { /* fall through to server-side */ }
    }
    if (clientCharts?.maximetro) {
      try {
        const b64 = clientCharts.maximetro.replace(/^data:image\/\w+;base64,/, '')
        maximetroPng = Buffer.from(b64, 'base64')
      } catch { /* fall through to server-side */ }
    }

    // Fallback: generate server-side (may have font issues on Vercel)
    if (!consumoPng || !maximetroPng) {
      const consumoSvg = buildConsumptionSVG(study.meses, 820, 300)
      const maximetroSvg = buildMaximetroSVG(study.meses, pc as Record<string, number>, 820, 300)
      const [serverConsumoPng, serverMaximetroPng] = await Promise.all([
        svgToPng(consumoSvg, 1640, 600),
        svgToPng(maximetroSvg, 1640, 600),
      ])
      if (!consumoPng) consumoPng = serverConsumoPng
      if (!maximetroPng) maximetroPng = serverMaximetroPng
    }

    // ── Serialize with ExcelJS ────────────────────────────────────────────────
    const excelBuffer = Buffer.from(await wb.xlsx.writeBuffer())

    // ── Post-process with JSZip: replace chart images + fix drawing ───────────
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(excelBuffer)

    const chartStartRow = Math.max(DATA_START_ROW + meses.length + 1, 40)

    // Replace images
    zip.remove('xl/media/image1.jpeg')
    zip.remove('xl/media/image1.png')
    zip.remove('xl/media/image2.png')
    zip.remove('xl/media/image2.jpeg')

    if (consumoPng) zip.file('xl/media/image2.png', consumoPng)
    if (maximetroPng) zip.file('xl/media/image1.png', maximetroPng)

    // Update rels
    zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>
</Relationships>`)

    // Rewrite drawing with proper dimensions
    const toRow = chartStartRow + 15
    zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chartStartRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr><xdr:cNvPr id="3" name="Consumo Mensual"/><xdr:cNvPicPr><a:picLocks noChangeArrowheads="1"/></xdr:cNvPicPr></xdr:nvPicPr>
      <xdr:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
      <xdr:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="7261412" cy="2857500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chartStartRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr><xdr:cNvPr id="2" name="Maximetros"/><xdr:cNvPicPr><a:picLocks noChangeArrowheads="1"/></xdr:cNvPicPr></xdr:nvPicPr>
      <xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
      <xdr:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="5000000" cy="2857500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></xdr:spPr>
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
