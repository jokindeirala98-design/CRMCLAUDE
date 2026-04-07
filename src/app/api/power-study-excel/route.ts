/**
 * Excel export — uses the official Voltis template (public/templates/estudio-potencias-template.xlsx)
 *
 * DATOS: 100 % extraídos del SIPS correspondiente.
 *   - Rows 2-4 header: rellenadas explícitamente desde `study` (CUPS, clientName, mensajes)
 *   - Rows 5-N data:   TODAS limpiadas y rellenadas desde `study.meses` (SIPS)
 *   - Gráficas:        Generadas dinámicamente desde los datos del SIPS
 *                      (las imágenes estáticas de la plantilla son sustituidas)
 *
 * Dependencias runtime: exceljs, @resvg/resvg-js, jszip
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

/* ══════════════════════════════════════════════════════════════════
   SVG CHART GENERATORS — operaciones de string puras, sin DOM/browser
   Todos los datos provienen del PowerStudyResult (origen SIPS)
══════════════════════════════════════════════════════════════════ */

function fmtK(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}k`
  return String(Math.round(v))
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function niceScale(maxVal: number, ticks = 5): { step: number; effMax: number } {
  const rawStep = (maxVal * 1.15) / ticks
  if (rawStep <= 0) return { step: 1, effMax: ticks }
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const step = Math.ceil(rawStep / mag) * mag
  return { step, effMax: step * ticks }
}

/**
 * Gráfica 1: Consumo mensual normalizado (kWh) — barras azules
 * Sustituye image2.png (cols A-J, filas 40-55 de la plantilla)
 */
function buildConsumptionSVG(meses: PowerStudyResult['meses']): string {
  const W = 900, H = 320
  const mL = 62, mR = 14, mT = 36, mB = 52
  const cW = W - mL - mR, cH = H - mT - mB

  const vals = meses.map(m => m.consumoTotal ?? 0)
  const maxV = Math.max(...vals.filter(v => v > 0), 1)
  const { step, effMax } = niceScale(maxV)
  const n = meses.length
  const slotW = cW / Math.max(n, 1)
  const barW = Math.max(slotW - 4, 2)

  const el: string[] = []
  el.push(`<rect width="${W}" height="${H}" fill="#F8FAFC" rx="6"/>`)
  el.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" font-weight="bold" fill="#1A3A8C" font-family="Calibri,Arial,sans-serif">Consumo mensual normalizado (kWh)</text>`)

  for (let i = 0; i <= 5; i++) {
    const v = i * step
    const y = mT + cH - (v / effMax) * cH
    el.push(`<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W-mR}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-width="${i===0?1:0.7}"/>`)
    el.push(`<text x="${mL-5}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#64748B" font-family="Calibri,Arial,sans-serif">${fmtK(v)}</text>`)
  }

  el.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)
  el.push(`<line x1="${mL}" y1="${mT+cH}" x2="${W-mR}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)

  meses.forEach((m, i) => {
    const v = m.consumoTotal ?? 0
    const bH = Math.max(v > 0 ? (v / effMax) * cH : 0, 0)
    const bx = mL + i * slotW + (slotW - barW) / 2
    const by = mT + cH - bH
    const cx = bx + barW / 2

    el.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bH,0).toFixed(1)}" fill="#2E75B6" rx="1.5" opacity="0.9"/>`)
    if (bH > 20) {
      el.push(`<text x="${cx.toFixed(1)}" y="${(by-3).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#1E3A5F" font-family="Calibri,Arial,sans-serif">${v.toLocaleString('es-ES')}</text>`)
    }

    let lbl = ''
    try {
      const d = new Date(m.fechaFin || m.fechaInicio || '')
      if (!isNaN(d.getTime())) {
        const mn = d.toLocaleDateString('es-ES', { month: 'short' })
        lbl = `${mn[0].toUpperCase()}${mn.slice(1,3)}'${d.getFullYear().toString().slice(2)}`
      }
    } catch { /* ignore */ }

    const ly = mT + cH + 12
    if (n > 24) {
      el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="end" font-size="6.5" fill="#475569" transform="rotate(-45 ${cx.toFixed(1)} ${ly})" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
    } else {
      el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="middle" font-size="7" fill="#475569" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
    }
  })

  el.push(`<text x="${W-mR}" y="${H-2}" text-anchor="end" font-size="7" fill="#94A3B8" font-family="Calibri,Arial,sans-serif">Fuente: SIPS · VOLTIS</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${el.join('')}</svg>`
}

/**
 * Gráfica 2: Maxímetros por período (kW) — barras agrupadas por mes
 * Líneas de referencia = potencia contratada por período
 * Sustituye image1.jpeg → image1.png (cols K-P, filas 41-55 de la plantilla)
 */
function buildMaximetrosSVG(
  meses: PowerStudyResult['meses'],
  potenciaContratada: Record<string, number> | undefined
): string {
  const W = 480, H = 320
  const mL = 52, mR = 14, mT = 36, mB = 52
  const cW = W - mL - mR, cH = H - mT - mB

  const pc = potenciaContratada ?? {}
  const activePeriods = PERIODS.filter(p => meses.some(m => (m.maximetro?.[p] ?? 0) > 0))
  const pColors: Record<Period, string> = {
    P1: '#C00000', P2: '#FF6600', P3: '#FFC000',
    P4: '#70AD47', P5: '#00B0F0', P6: '#7030A0',
  }

  const allVals = meses.flatMap(m => activePeriods.map(p => m.maximetro?.[p] ?? 0))
  const contractedVals = activePeriods.map(p => pc[p] ?? 0).filter(v => v > 0)
  const maxV = Math.max(...allVals, ...contractedVals, 1)
  const { step, effMax } = niceScale(maxV)

  const n = meses.length
  const nP = Math.max(activePeriods.length, 1)
  const slotW = cW / Math.max(n, 1)
  const barW = Math.max((slotW - 4) / nP, 1.5)

  const el: string[] = []
  el.push(`<rect width="${W}" height="${H}" fill="#F8FAFC" rx="6"/>`)
  el.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" font-weight="bold" fill="#1A3A8C" font-family="Calibri,Arial,sans-serif">Maxímetros registrados (kW)</text>`)

  for (let i = 0; i <= 5; i++) {
    const v = i * step
    const y = mT + cH - (v / effMax) * cH
    el.push(`<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W-mR}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-width="${i===0?1:0.7}"/>`)
    el.push(`<text x="${mL-5}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#64748B" font-family="Calibri,Arial,sans-serif">${v.toFixed(0)}</text>`)
  }

  el.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)
  el.push(`<line x1="${mL}" y1="${mT+cH}" x2="${W-mR}" y2="${mT+cH}" stroke="#94A3B8" stroke-width="1.2"/>`)

  // Líneas de potencia contratada (referencia)
  activePeriods.forEach(p => {
    const cont = pc[p] ?? 0
    if (cont > 0) {
      const y = mT + cH - (cont / effMax) * cH
      el.push(`<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W-mR}" y2="${y.toFixed(1)}" stroke="${pColors[p]}" stroke-width="1" stroke-dasharray="4,3" opacity="0.65"/>`)
    }
  })

  // Barras
  meses.forEach((m, i) => {
    const slotX = mL + i * slotW
    activePeriods.forEach((p, pi) => {
      const v = m.maximetro?.[p] ?? 0
      if (v <= 0) return
      const bH = (v / effMax) * cH
      const bx = slotX + pi * barW + (slotW - nP * barW) / 2
      const by = mT + cH - bH
      el.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="${pColors[p]}" rx="1" opacity="0.85"/>`)
    })

    let lbl = ''
    try {
      const d = new Date(m.fechaFin || m.fechaInicio || '')
      if (!isNaN(d.getTime())) {
        const mn = d.toLocaleDateString('es-ES', { month: 'short' })
        lbl = `${mn[0].toUpperCase()}${mn.slice(1,3)}'${d.getFullYear().toString().slice(2)}`
      }
    } catch { /* ignore */ }

    const cx = slotX + slotW / 2
    const ly = mT + cH + 12
    if (n > 16) {
      el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="end" font-size="6.5" fill="#475569" transform="rotate(-45 ${cx.toFixed(1)} ${ly})" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
    } else {
      el.push(`<text x="${cx.toFixed(1)}" y="${ly}" text-anchor="middle" font-size="7" fill="#475569" font-family="Calibri,Arial,sans-serif">${escXml(lbl)}</text>`)
    }
  })

  // Leyenda
  const legendY = H - 14
  let lx = mL
  activePeriods.forEach(p => {
    el.push(`<rect x="${lx}" y="${legendY-7}" width="9" height="9" fill="${pColors[p]}" rx="1"/>`)
    el.push(`<text x="${lx+11}" y="${legendY}" font-size="7.5" fill="#333" font-family="Calibri,Arial,sans-serif">${p}</text>`)
    lx += 32
  })
  if (contractedVals.length > 0) {
    el.push(`<line x1="${lx}" y1="${legendY-3}" x2="${lx+14}" y2="${legendY-3}" stroke="#555" stroke-width="1.2" stroke-dasharray="4,3"/>`)
    el.push(`<text x="${lx+16}" y="${legendY}" font-size="7.5" fill="#333" font-family="Calibri,Arial,sans-serif">Contratada</text>`)
  }

  el.push(`<text x="${W-mR}" y="${H-2}" text-anchor="end" font-size="7" fill="#94A3B8" font-family="Calibri,Arial,sans-serif">Fuente: SIPS · VOLTIS</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${el.join('')}</svg>`
}

/** SVG string → PNG Buffer via @resvg/resvg-js (WASM puro, sin dependencias nativas) */
async function svgToPng(svgStr: string): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js')
  const resvg = new Resvg(svgStr, {
    font: { loadSystemFonts: false },
    fitTo: { mode: 'original' },
  })
  return Buffer.from(resvg.render().asPng())
}

/* ══════════════════════════════════════════════════════════════════
   POST handler
══════════════════════════════════════════════════════════════════ */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const study: PowerStudyResult = await request.json()

    // ── Cargar plantilla ─────────────────────────────────────────────────────
    const templatePath = path.join(process.cwd(), 'public', 'templates', 'estudio-potencias-template.xlsx')
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template no encontrado en public/templates/' }, { status: 500 })
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(templatePath)
    const ws = wb.worksheets[0]
    if (!ws) return NextResponse.json({ error: 'Template sin hojas' }, { status: 500 })

    // ── CABECERA: datos del SIPS (sustituye valores de la plantilla) ─────────
    ws.getCell('A2').value = study.cups || ''
    ws.getCell('A3').value = study.clientName || ''
    // D2:I2, K2:P2, D3:I3 conservan las fórmulas de la plantilla → calculan con datos SIPS

    // ── Mensaje de potencias (K3, merged K3:P4) ──────────────────────────────
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

    // ── Mensaje de priorización (D4, merged D4:I4) ───────────────────────────
    const activePeriods = PERIODS
      .filter(p => (study.consumoPorPeriodo?.[p] ?? 0) > 0)
      .sort((a, b) => (study.consumoPorPeriodo?.[b] ?? 0) - (study.consumoPorPeriodo?.[a] ?? 0))
    ws.getCell('D4').value = activePeriods.length > 0
      ? 'PRIORIZAR CONSUMO ' + activePeriods.slice(0, 3).join(' - ')
      : ''

    // ── GARANTIA DATOS SIPS: limpiar TODAS las celdas de datos de la plantilla
    // Elimina absolutamente todos los valores de Colegio el Huerto (rows 5-39)
    for (let r = DATA_START_ROW; r <= MAX_TEMPLATE_ROWS; r++) {
      for (let c = 1; c <= 16; c++) {
        if (c === 10) continue   // columna J = separador visual
        ws.getCell(r, c).value = null
      }
    }

    // ── Rellenar filas con datos del SIPS ────────────────────────────────────
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

    // ── Extender CF si hay más de 35 meses ───────────────────────────────────
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

    // ── Serializar con ExcelJS ───────────────────────────────────────────────
    const excelBuffer = Buffer.from(await wb.xlsx.writeBuffer())

    // ── Post-proceso con JSZip: sustituir imágenes estáticas por gráficas dinámicas ──
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(excelBuffer)

    // Gráfica 1 – consumo mensual → reemplaza image2.png (cols A-J, filas 40-55)
    const consumptionPng = await svgToPng(buildConsumptionSVG(meses))
    zip.file('xl/media/image2.png', consumptionPng)

    // Gráfica 2 – maxímetros → reemplaza image1.jpeg (renombrada a image1.png)
    const maxPng = await svgToPng(
      buildMaximetrosSVG(meses, study.potenciaContratada as Record<string, number> | undefined)
    )
    zip.remove('xl/media/image1.jpeg')
    zip.file('xl/media/image1.png', maxPng)

    // Actualizar drawing rels: image1.jpeg → image1.png
    const drawingRelsFile = zip.file('xl/drawings/_rels/drawing1.xml.rels')
    if (drawingRelsFile) {
      const relsXml = (await drawingRelsFile.async('string'))
        .replace('Target="../media/image1.jpeg"', 'Target="../media/image1.png"')
      zip.file('xl/drawings/_rels/drawing1.xml.rels', relsXml)
    }

    const finalBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    // ── Nombre del fichero ───────────────────────────────────────────────────
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
