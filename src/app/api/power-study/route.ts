import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type P6Map = { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
const ZERO6: P6Map = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const

interface ParsedRow {
  fechaInicio: string
  fechaFin: string
  consumo: P6Map
  maximetro: P6Map
  reactiva: P6Map  // kvarh
}

interface ParsedData {
  cups: string
  rows: ParsedRow[]
}

// ── Bruto HTML (comercializadora export) — values in Wh/varh → /1000 ──
function parseHTMLTable(html: string): ParsedData | null {
  try {
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    const rows: string[][] = []
    let match
    while ((match = rowRegex.exec(html)) !== null) {
      const rowHtml = match[1]
      const cells: string[] = []
      let cm
      const re = /<td[^>]*>([\s\S]*?)<\/td>/gi
      while ((cm = re.exec(rowHtml)) !== null) {
        cells.push(cm[1].replace(/<[^>]*>/g, '').trim())
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length < 2) return null

    const header = rows[0]
    const colMap: Record<string, number> = {}
    header.forEach((h, i) => { colMap[h.trim()] = i })

    let cups = ''
    const dataRows: ParsedRow[] = []

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (r[colMap['CUPS']]?.trim()) { cups = r[colMap['CUPS']].trim(); continue }
      const fechaInicio = r[colMap['Fecha Lectura Inicial']] || ''
      const fechaFin = r[colMap['Fecha Lectura Final']] || ''
      if (!fechaInicio || !fechaFin) continue

      const pv = (key: string): number => {
        const idx = colMap[key]
        if (idx === undefined) return 0
        const v = parseFloat(r[idx] || '0')
        return isNaN(v) ? 0 : v
      }

      dataRows.push({
        fechaInicio: fechaInicio.split('T')[0],
        fechaFin: fechaFin.split('T')[0],
        consumo: {
          P1: Math.round(pv('P1 Activa') / 1000), P2: Math.round(pv('P2 Activa') / 1000),
          P3: Math.round(pv('P3 Activa') / 1000), P4: Math.round(pv('P4 Activa') / 1000),
          P5: Math.round(pv('P5 Activa') / 1000), P6: Math.round(pv('P6 Activa') / 1000),
        },
        maximetro: {
          P1: pv('P1 Maximetro') / 1000, P2: pv('P2 Maximetro') / 1000,
          P3: pv('P3 Maximetro') / 1000, P4: pv('P4 Maximetro') / 1000,
          P5: pv('P5 Maximetro') / 1000, P6: pv('P6 Maximetro') / 1000,
        },
        reactiva: {
          P1: Math.round(pv('P1 Reactiva') / 1000), P2: Math.round(pv('P2 Reactiva') / 1000),
          P3: Math.round(pv('P3 Reactiva') / 1000), P4: Math.round(pv('P4 Reactiva') / 1000),
          P5: Math.round(pv('P5 Reactiva') / 1000), P6: Math.round(pv('P6 Reactiva') / 1000),
        },
      })
    }
    return { cups, rows: dataRows }
  } catch (err) {
    console.error('[power-study] HTML parse error:', err)
    return null
  }
}

// ── CSV/TSV (comercializadora export) — values in Wh/varh → /1000 ──
function parseCSV(text: string): ParsedData | null {
  try {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return null
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
    const header = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''))
    const colMap: Record<string, number> = {}
    header.forEach((h, i) => { colMap[h] = i })

    let cups = ''
    const dataRows: ParsedRow[] = []

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(sep).map(c => c.trim().replace(/"/g, ''))
      if (cells[colMap['CUPS']]?.trim()) { cups = cells[colMap['CUPS']].trim(); continue }
      const fechaInicio = cells[colMap['Fecha Lectura Inicial']] || ''
      const fechaFin = cells[colMap['Fecha Lectura Final']] || ''
      if (!fechaInicio || !fechaFin) continue

      const pv = (key: string): number => {
        const idx = colMap[key]
        if (idx === undefined) return 0
        const v = parseFloat(cells[idx] || '0')
        return isNaN(v) ? 0 : v
      }

      dataRows.push({
        fechaInicio: fechaInicio.split('T')[0],
        fechaFin: fechaFin.split('T')[0],
        consumo: {
          P1: Math.round(pv('P1 Activa') / 1000), P2: Math.round(pv('P2 Activa') / 1000),
          P3: Math.round(pv('P3 Activa') / 1000), P4: Math.round(pv('P4 Activa') / 1000),
          P5: Math.round(pv('P5 Activa') / 1000), P6: Math.round(pv('P6 Activa') / 1000),
        },
        maximetro: {
          P1: pv('P1 Maximetro') / 1000, P2: pv('P2 Maximetro') / 1000,
          P3: pv('P3 Maximetro') / 1000, P4: pv('P4 Maximetro') / 1000,
          P5: pv('P5 Maximetro') / 1000, P6: pv('P6 Maximetro') / 1000,
        },
        reactiva: {
          P1: Math.round(pv('P1 Reactiva') / 1000), P2: Math.round(pv('P2 Reactiva') / 1000),
          P3: Math.round(pv('P3 Reactiva') / 1000), P4: Math.round(pv('P4 Reactiva') / 1000),
          P5: Math.round(pv('P5 Reactiva') / 1000), P6: Math.round(pv('P6 Reactiva') / 1000),
        },
      })
    }
    return { cups, rows: dataRows }
  } catch (err) {
    console.error('[power-study] CSV parse error:', err)
    return null
  }
}

/**
 * Parse Lidera / Greening SIPS export (.xlsx)
 * All values already in kWh (consumo), kW (maximetro), kvarh (reactiva) — no conversion needed.
 */
function parseLideraXlsx(buffer: ArrayBuffer): ParsedData | null {
  const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const tmpIn = join(tmpdir(), `sips_in_${uid}.xlsx`)
  const tmpOut = join(tmpdir(), `sips_out_${uid}.json`)

  try {
    writeFileSync(tmpIn, Buffer.from(buffer))

    const pyScript = [
      'import pandas as pd, json',
      `df = pd.read_excel(r'${tmpIn}', engine='openpyxl')`,
      `df['FechaInicio'] = pd.to_datetime(df['FechaInicio'], errors='coerce').dt.strftime('%Y-%m-%d')`,
      `df['FechaFin'] = pd.to_datetime(df['FechaFin'], errors='coerce').dt.strftime('%Y-%m-%d')`,
      'df = df.fillna(0)',
      `f = open(r'${tmpOut}', 'w')`,
      'json.dump(df.to_dict(orient="records"), f)',
      'f.close()',
    ].join('; ')

    execSync(`python3 -c "${pyScript}"`, { timeout: 30000 })

    const rows: any[] = JSON.parse(readFileSync(tmpOut, 'utf-8'))
    if (!rows.length) return null

    const cups = String(rows[0]?.CodigoCUPS || '').trim()
    const pv = (r: any, key: string): number => {
      const v = parseFloat(String(r[key] ?? '0'))
      return isNaN(v) ? 0 : v
    }

    const dataRows: ParsedRow[] = rows.map((r) => ({
      fechaInicio: String(r.FechaInicio || ''),
      fechaFin: String(r.FechaFin || ''),
      // Already in kWh — no division
      consumo: {
        P1: pv(r, 'Consumo P1'), P2: pv(r, 'Consumo P2'), P3: pv(r, 'Consumo P3'),
        P4: pv(r, 'Consumo P4'), P5: pv(r, 'Consumo P5'), P6: pv(r, 'Consumo P6'),
      },
      // Already in kW
      maximetro: {
        P1: pv(r, 'Maximetro P1'), P2: pv(r, 'Maximetro P2'), P3: pv(r, 'Maximetro P3'),
        P4: pv(r, 'Maximetro P4'), P5: pv(r, 'Maximetro P5'), P6: pv(r, 'Maximetro P6'),
      },
      // Already in kvarh
      reactiva: {
        P1: pv(r, 'Reactiva P1'), P2: pv(r, 'Reactiva P2'), P3: pv(r, 'Reactiva P3'),
        P4: pv(r, 'Reactiva P4'), P5: pv(r, 'Reactiva P5'), P6: pv(r, 'Reactiva P6'),
      },
    }))

    return { cups, rows: dataRows }
  } catch (err) {
    console.error('[power-study] Lidera xlsx parse error:', err)
    return null
  } finally {
    try { unlinkSync(tmpIn) } catch {}
    try { unlinkSync(tmpOut) } catch {}
  }
}

export interface PowerStudyResult {
  cups: string
  clientName?: string
  consumoTotal: number
  consumoPorPeriodo: P6Map
  consumoPorcentaje: P6Map
  maxPotencia: P6Map
  potenciaContratada: P6Map
  excesos: {
    period: string
    maxRegistrado: number
    contratada: number
    excesoPorcentaje: number
    necesitaAjuste: boolean
  }[]
  necesitaAjustePotencias: boolean
  meses: {
    fechaInicio: string
    fechaFin: string
    consumoTotal: number
    consumo: P6Map
    maximetro: P6Map
    reactiva?: P6Map
  }[]
  // Reactiva — only populated when any kvarh value > 1000
  hasRelevantReactiva?: boolean
  reactivaPorPeriodo?: P6Map
  maxReactiva?: P6Map
  // Metadata
  autoGenerated?: boolean
  hasRealMaximetros?: boolean
  topConsumoPeriods?: string[]
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const potenciaContratadaStr = formData.get('potenciaContratada') as string | null
    const clientName = formData.get('clientName') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    let potenciaContratada: P6Map = { ...ZERO6 }
    if (potenciaContratadaStr) {
      try { potenciaContratada = JSON.parse(potenciaContratadaStr) } catch {}
    }

    const buffer = await file.arrayBuffer()
    const fileName = file.name.toLowerCase()

    let parsed: ParsedData | null

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      parsed = parseLideraXlsx(buffer)
    } else {
      const text = new TextDecoder('utf-8').decode(buffer)
      parsed = (text.includes('<table') || text.includes('<TABLE'))
        ? parseHTMLTable(text)
        : parseCSV(text)
    }

    if (!parsed || parsed.rows.length === 0) {
      return NextResponse.json({
        error: 'No se pudo parsear el archivo. Usa el export .xlsx de Lidera/Greening, o un export HTML/CSV de comercializadora.',
      }, { status: 400 })
    }

    // ── Consumo totals ──
    const consumoPorPeriodo: P6Map = { ...ZERO6 }
    for (const row of parsed.rows) {
      for (const p of PERIODS) consumoPorPeriodo[p] += row.consumo[p]
    }
    const consumoTotal = PERIODS.reduce((s, p) => s + consumoPorPeriodo[p], 0)

    const consumoPorcentaje: P6Map = { ...ZERO6 }
    for (const p of PERIODS) {
      consumoPorcentaje[p] = consumoTotal > 0 ? consumoPorPeriodo[p] / consumoTotal : 0
    }

    // ── Max maximetro ──
    const maxPotencia: P6Map = { ...ZERO6 }
    for (const row of parsed.rows) {
      for (const p of PERIODS) {
        if (row.maximetro[p] > maxPotencia[p]) maxPotencia[p] = row.maximetro[p]
      }
    }

    // ── Excesos / ajustes: desviación >15% en CUALQUIER dirección ──
    const excesos = PERIODS.map(p => {
      const contratada = potenciaContratada[p] || 0
      const max = maxPotencia[p]
      const excesoPorcentaje = contratada > 0 ? ((max - contratada) / contratada) * 100 : 0
      return {
        period: p,
        maxRegistrado: Math.round(max * 1000) / 1000,
        contratada,
        excesoPorcentaje: Math.round(excesoPorcentaje * 10) / 10,
        necesitaAjuste: contratada > 0 && max > 0 && Math.abs(excesoPorcentaje) >= 15,
      }
    })

    // ── Reactiva — only relevant if ANY cell > 1000 kvarh ──
    let hasRelevantReactiva = false
    const reactivaPorPeriodo: P6Map = { ...ZERO6 }
    const maxReactiva: P6Map = { ...ZERO6 }

    for (const row of parsed.rows) {
      for (const p of PERIODS) {
        const v = row.reactiva[p]
        reactivaPorPeriodo[p] += v
        if (v > maxReactiva[p]) maxReactiva[p] = v
        if (v > 1000) hasRelevantReactiva = true
      }
    }

    // ── Monthly detail ──
    const meses = parsed.rows.map(row => ({
      fechaInicio: row.fechaInicio,
      fechaFin: row.fechaFin,
      consumoTotal: PERIODS.reduce((s, p) => s + row.consumo[p], 0),
      consumo: { ...row.consumo },
      maximetro: { ...row.maximetro },
      reactiva: hasRelevantReactiva ? { ...row.reactiva } : undefined,
    }))

    // ── Top consumption periods ──
    const topConsumoPeriods = PERIODS
      .map(p => ({ period: p, kwh: consumoPorPeriodo[p] }))
      .sort((a, b) => b.kwh - a.kwh)
      .filter(p => p.kwh > 0)
      .slice(0, 3)
      .map(p => p.period)

    const result: PowerStudyResult = {
      cups: parsed.cups,
      clientName: clientName || undefined,
      consumoTotal,
      consumoPorPeriodo,
      consumoPorcentaje,
      maxPotencia,
      potenciaContratada,
      excesos,
      necesitaAjustePotencias: excesos.some(e => e.necesitaAjuste),
      meses,
      hasRelevantReactiva,
      reactivaPorPeriodo: hasRelevantReactiva ? reactivaPorPeriodo : undefined,
      maxReactiva: hasRelevantReactiva ? maxReactiva : undefined,
      hasRealMaximetros: true,
      topConsumoPeriods,
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[power-study] Error:', err)
    return NextResponse.json({ error: err.message || 'Error procesando estudio de potencias' }, { status: 500 })
  }
}
