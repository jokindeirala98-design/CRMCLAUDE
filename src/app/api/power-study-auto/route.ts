import { NextRequest, NextResponse } from 'next/server'
import type { PowerStudyResult } from '@/app/api/power-study/route'

/**
 * POST /api/power-study-auto
 *
 * Generates a power study automatically from SIPS data.
 * No file upload needed — works with consumption history + maximeter data from SIPS.
 *
 * UNITS: All data arriving here should already be in kWh (consumption) and kW (maximeters).
 * The SIPS route converts from Wh/W at source.
 */

interface RequestBody {
  cups: string
  clientName?: string
  potenciaContratada: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  consumptionHistory: Array<{
    fecha: string
    fechaInicio?: string
    fechaFin?: string
    P1: number; P2: number; P3: number; P4: number; P5: number; P6: number
    total: number
  }>
  maximetroHistory?: Array<{
    fecha: string
    fechaInicio?: string
    fechaFin?: string
    P1: number; P2: number; P3: number; P4: number; P5: number; P6: number
  }>
  reactivaHistory?: Array<{
    fecha: string
    fechaInicio?: string
    fechaFin?: string
    P1: number; P2: number; P3: number; P4: number; P5: number; P6: number
  }>
}

const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json()
    const { cups, clientName, potenciaContratada, consumptionHistory, maximetroHistory, reactivaHistory } = body

    if (!cups || !potenciaContratada || !consumptionHistory?.length) {
      return NextResponse.json(
        { error: 'Se requieren CUPS, potencia contratada e historial de consumo' },
        { status: 400 }
      )
    }

    // ─── Sum consumption per period (already in kWh from SIPS) ───
    const consumoPorPeriodo = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    for (const entry of consumptionHistory) {
      for (const p of PERIODS) {
        consumoPorPeriodo[p] += entry[p] || 0
      }
    }
    const consumoTotal = PERIODS.reduce((sum, p) => sum + consumoPorPeriodo[p], 0)

    // ─── Consumption percentages ───
    const consumoPorcentaje = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    for (const p of PERIODS) {
      consumoPorcentaje[p] = consumoTotal > 0 ? consumoPorPeriodo[p] / consumoTotal : 0
    }

    // ─── Max maximeter per period (already in kW from SIPS) ───
    const maxPotencia = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
    const hasMaximetros = maximetroHistory && maximetroHistory.length > 0

    if (hasMaximetros) {
      for (const entry of maximetroHistory) {
        for (const p of PERIODS) {
          const kw = entry[p] || 0
          if (kw > maxPotencia[p]) {
            maxPotencia[p] = kw
          }
        }
      }
    }
    // If no maximeter data, maxPotencia stays at 0 — we don't fake estimates

    // ─── Check adjustments: deviation >15% in EITHER direction ───
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

    const necesitaAjustePotencias = excesos.some(e => e.necesitaAjuste)

    // ─── Identify priority: which periods have most consumption ───
    const sortedByConsumo = PERIODS
      .map(p => ({ period: p, kwh: consumoPorPeriodo[p] }))
      .sort((a, b) => b.kwh - a.kwh)
    const topPeriods = sortedByConsumo.filter(p => p.kwh > 0).slice(0, 3).map(p => p.period)

    // ─── Build monthly detail ───
    const meses = consumptionHistory.map(entry => {
      const fecha = entry.fecha  // FechaFin from ConsumosSips
      // Match maxímetro by fechaFin (= fecha) — same key used in both arrays
      const maxEntry = hasMaximetros
        ? (maximetroHistory!.find(m => m.fecha === fecha) || maximetroHistory!.find(m => m.fechaFin === fecha) || null)
        : null
      const reactivaEntry = reactivaHistory
        ? (reactivaHistory.find(r => r.fecha === fecha) || reactivaHistory.find(r => r.fechaFin === fecha) || null)
        : null

      const maximetro = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 }
      if (maxEntry) {
        for (const p of PERIODS) maximetro[p] = maxEntry[p] || 0
      }

      const reactiva = reactivaEntry
        ? { P1: reactivaEntry.P1 || 0, P2: reactivaEntry.P2 || 0, P3: reactivaEntry.P3 || 0, P4: reactivaEntry.P4 || 0, P5: reactivaEntry.P5 || 0, P6: reactivaEntry.P6 || 0 }
        : undefined

      return {
        fechaInicio: entry.fechaInicio || fecha,
        fechaFin: entry.fechaFin || fecha,
        mes: entry.fechaFin
          ? (() => { try { return new Date(entry.fechaFin).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) } catch { return fecha.slice(0, 7) } })()
          : fecha.slice(0, 7),
        consumoTotal: entry.total || PERIODS.reduce((sum, p) => sum + (entry[p] || 0), 0),
        consumo: { P1: entry.P1 || 0, P2: entry.P2 || 0, P3: entry.P3 || 0, P4: entry.P4 || 0, P5: entry.P5 || 0, P6: entry.P6 || 0 },
        maximetro,
        reactiva,
      }
    })

    // ─── Reactiva summary ───
    const hasRelevantReactiva = reactivaHistory && reactivaHistory.some(r =>
      PERIODS.some(p => (r[p] || 0) > 1000)
    )
    const reactivaPorPeriodo = reactivaHistory ? PERIODS.reduce((acc, p) => {
      acc[p] = reactivaHistory.reduce((sum, r) => sum + (r[p] || 0), 0)
      return acc
    }, {} as Record<string, number>) : undefined

    const result: PowerStudyResult = {
      cups,
      clientName: clientName || undefined,
      consumoTotal,
      consumoPorPeriodo,
      consumoPorcentaje,
      maxPotencia,
      potenciaContratada,
      excesos,
      necesitaAjustePotencias,
      meses,
      autoGenerated: true,
      hasRealMaximetros: !!hasMaximetros,
      topConsumoPeriods: topPeriods,
      hasRelevantReactiva: !!hasRelevantReactiva,
      reactivaPorPeriodo: reactivaPorPeriodo as any,
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[power-study-auto] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Error generando estudio automático' },
      { status: 500 }
    )
  }
}
