/**
 * Excel export — uses the official Voltis template (public/templates/estudio-potencias-template.xlsx)
 * Loads template with ExcelJS, preserving ALL conditional formatting, merges, column widths.
 * Clears data rows and injects PowerStudyResult data.
 *
 * Template structure (replicated exactly):
 *   Row 1 : Headers
 *   Row 2 : CUPS | - | =SUM(D2:I2) | =SUM(D5:D39)…=SUM(I5:I39) | - | =MAX(K5:K39)…=MAX(P5:P39)
 *   Row 3 : ClientName | - | - | =D2/$C$2…%  | - | "AJUSTAR POTENCIAS" or "POTENCIAS OK" (K3:P4 merged, yellow)
 *   Row 4 : - | - | - | "PRIORIZAR CONSUMO Px - Py - Pz" (D4:I4 merged)
 *   Row 5+ : =SUM(D:I) | fechaInicio | fechaFin | P1…P6 activa | - | P1…P6 maximetro
 *
 *   CF ranges (inherited from template):
 *     A5:A39  → GYR colorScale (total consumption)
 *     D3:I3   → GYR colorScale (% per period)
 *     D5:I39  → GYR colorScale (monthly consumption)
 *     K5:P39  → Blue→White→Red colorScale (maximetros)
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'
import type { PowerStudyResult } from '@/app/api/power-study/route'

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const
type Period = (typeof PERIODS)[number]

// Column mapping — matches template layout exactly
const CONSUMO_COL: Record<Period, number> = { P1: 4, P2: 5, P3: 6, P4: 7, P5: 8, P6: 9 }
const MAX_COL:     Record<Period, number> = { P1: 11, P2: 12, P3: 13, P4: 14, P5: 15, P6: 16 }

const DATA_START_ROW = 5   // First data row in template
const MAX_TEMPLATE_ROWS = 39  // Template CF covers up to row 39

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const study: PowerStudyResult = await request.json()

    // ── Load template ────────────────────────────────────────────────────────
    const templatePath = path.join(process.cwd(), 'public', 'templates', 'estudio-potencias-template.xlsx')
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template no encontrado en public/templates/' }, { status: 500 })
    }

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(templatePath)

    const ws = wb.worksheets[0]
    if (!ws) return NextResponse.json({ error: 'Template sin hojas' }, { status: 500 })

    // ── Header data (rows 2-4) ───────────────────────────────────────────────

    // Row 2: CUPS (A2) — formulas already in template, just update CUPS value
    ws.getCell('A2').value = study.cups || ''

    // Row 3: Client name (A3) + adjustment message (K3, merged K3:P4)
    ws.getCell('A3').value = study.clientName || ''

    const pc = study.potenciaContratada ?? {} as Record<Period, number>
    const periodsExcess = PERIODS.filter(p => {
      const cont = (pc as any)[p] || 0
      const maxV = study.maxPotencia?.[p] || 0
      return cont > 0 && maxV > cont
    })
    const periodsLow = PERIODS.filter(p => {
      const cont = (pc as any)[p] || 0
      const maxV = study.maxPotencia?.[p] || 0
      return cont > 0 && maxV > 0 && maxV < cont * 0.85 && !periodsExcess.includes(p)
    })

    const adjustCell = ws.getCell('K3')
    if (periodsExcess.length > 0) {
      adjustCell.value = `AJUSTAR POTENCIAS ${periodsExcess.join(' · ')}`
      adjustCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
      adjustCell.font = { bold: true, size: 14, color: { argb: 'FFC00000' } }
    } else if (periodsLow.length > 0) {
      adjustCell.value = `POSIBLE REDUCCIÓN EN ${periodsLow.join(' · ')}`
      adjustCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }
      adjustCell.font = { bold: true, size: 12, color: { argb: 'FF1F4E79' } }
    } else {
      adjustCell.value = 'POTENCIAS DENTRO DE RANGO'
      adjustCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } }
      adjustCell.font = { bold: true, size: 12, color: { argb: 'FF375623' } }
    }

    // Row 4: Priority message (D4, merged D4:I4)
    const activePeriods = PERIODS
      .filter(p => (study.consumoPorPeriodo?.[p] || 0) > 0)
      .sort((a, b) => (study.consumoPorPeriodo?.[b] || 0) - (study.consumoPorPeriodo?.[a] || 0))
    ws.getCell('D4').value = activePeriods.length > 0
      ? 'PRIORIZAR CONSUMO ' + activePeriods.slice(0, 3).join(' - ')
      : ''

    // ── Clear existing data rows ─────────────────────────────────────────────
    for (let r = DATA_START_ROW; r <= MAX_TEMPLATE_ROWS; r++) {
      for (let c = 1; c <= 16; c++) {
        if (c === 10) continue // Skip J (separator column)
        ws.getCell(r, c).value = null
      }
    }

    // ── Fill data rows ───────────────────────────────────────────────────────
    const meses = study.meses ?? []
    meses.forEach((m, i) => {
      const r = DATA_START_ROW + i

      // Col A: total per month (formula)
      ws.getCell(r, 1).value = { formula: `SUM(D${r}:I${r})` }

      // Col B: start date
      if (m.fechaInicio) {
        const d = new Date(m.fechaInicio)
        ws.getCell(r, 2).value = isNaN(d.getTime()) ? m.fechaInicio : d
        ws.getCell(r, 2).numFmt = 'DD/MM/YYYY'
      }

      // Col C: end date
      if (m.fechaFin) {
        const d = new Date(m.fechaFin)
        ws.getCell(r, 3).value = isNaN(d.getTime()) ? m.fechaFin : d
        ws.getCell(r, 3).numFmt = 'DD/MM/YYYY'
      }

      // Cols D-I: consumo activa P1-P6
      PERIODS.forEach(p => {
        ws.getCell(r, CONSUMO_COL[p]).value = m.consumo?.[p] || 0
      })

      // Cols K-P: maxímetros P1-P6
      PERIODS.forEach(p => {
        const maxV = m.maximetro?.[p] || 0
        ws.getCell(r, MAX_COL[p]).value = maxV > 0 ? maxV : 0
      })
    })

    // ── Extend CF ranges if more than 35 months ──────────────────────────────
    const lastDataRow = DATA_START_ROW + meses.length - 1
    if (lastDataRow > MAX_TEMPLATE_ROWS) {
      // Update existing CF rules to cover additional rows
      const extendCF = (oldRange: string, newRange: string) => {
        const cf = (ws as any).conditionalFormattings
        if (cf) {
          for (const rule of cf) {
            if (rule.ref === oldRange) rule.ref = newRange
          }
        }
      }
      extendCF(`A${DATA_START_ROW}:A${MAX_TEMPLATE_ROWS}`, `A${DATA_START_ROW}:A${lastDataRow}`)
      extendCF(`D${DATA_START_ROW}:I${MAX_TEMPLATE_ROWS}`, `D${DATA_START_ROW}:I${lastDataRow}`)
      extendCF(`K${DATA_START_ROW}:P${MAX_TEMPLATE_ROWS}`, `K${DATA_START_ROW}:P${lastDataRow}`)
    }

    // ── Serialize ────────────────────────────────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer()

    const slug = (study.clientName || study.cups || 'estudio')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
      .replace(/[^a-zA-Z0-9\s]/g, '').trim()
      .replace(/\s+/g, '_').slice(0, 40)
    const filename = `Estudio_Potencias_${slug}.xlsx`

    return new NextResponse(buffer as Buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err: any) {
    console.error('[power-study-excel] Error:', err)
    return NextResponse.json({ error: err.message || 'Error generando Excel' }, { status: 500 })
  }
}
