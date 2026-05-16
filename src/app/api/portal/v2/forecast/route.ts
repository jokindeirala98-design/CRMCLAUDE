/**
 * GET /api/portal/v2/forecast?year=2026
 *
 * Genera la previsión anual del cliente, calcada del PDF "Previsión
 * Energética 2026 Unice Toys" en estructura:
 *
 *   • Resumen ejecutivo del año (gasto total, real Q1, estimado Q2-Q4,
 *     luz/gas año, factura media mensual)
 *   • 12 meses con bandera REAL o PREVISIÓN
 *   • 4 trimestres con totales y desglose
 *   • Metodología (datos de partida + fórmula + precisión)
 *   • Fiscalidad aplicada (4 columnas por periodos fiscales)
 *   • Limitaciones
 *
 * Lógica:
 *   Para cada mes del año objetivo:
 *     • Si hay factura Voltis real → importe REAL
 *     • Si NO → simulación = SIPS año anterior × precios Voltis × fiscalidad
 *
 * Los precios Voltis se infieren automáticamente de las facturas existentes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { PORTAL_SESSION_COOKIE, resolveSession, auditLog } from '@/lib/portal/auth'
import { inferContractsFromInvoices } from '@/lib/portal/contract-inference'
import { buildForecast, type HistoricalMonth, type RealVoltisMonth } from '@/lib/portal/forecast-engine'
import { FISCAL_PERIODS } from '@/lib/portal/fiscal'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  if (!sessionToken) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const ctx = await resolveSession(sessionToken)
  if (!ctx) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get('year') || String(new Date().getUTCFullYear()), 10)
  const yearPrev = year - 1

  const sb = admin()
  const clientId = ctx.clientId

  const [supRes, clientRes] = await Promise.all([
    sb.from('supplies').select('id, type, cups, name, consumption_data').eq('client_id', clientId),
    sb.from('clients').select('id, name, cif_nif, nif').eq('id', clientId).maybeSingle(),
  ])
  const supplies = supRes.data || []
  const supplyIds = supplies.map(s => s.id)

  const invRes = supplyIds.length > 0
    ? await sb.from('invoices')
        .select('id, supply_id, source, period_start, period_end, total_amount, extracted_data')
        .in('supply_id', supplyIds)
        .order('period_end', { ascending: true })
    : { data: [] as any[], error: null }

  const invoices = (invRes.data || [])

  // Tipos de supply para inferencia robusta
  const supplyTypes = new Map<string, 'luz' | 'gas'>()
  for (const s of supplies) {
    supplyTypes.set(s.id, s.type === 'gas' ? 'gas' : 'luz')
  }

  // Inferimos contratos Voltis (uno por supply)
  const inferred = inferContractsFromInvoices({ invoices, supplyTypes })

  if (inferred.size === 0) {
    auditLog({ ctx, action: 'view_forecast_empty' }).catch(() => {})
    return NextResponse.json({
      empty: true,
      reason: 'Aún no hay facturas Voltis para inferir tus precios contractuales. La previsión se activa con la primera factura.',
    })
  }

  // Para mantener la lógica del engine actual, identificamos un supply luz y otro gas.
  // En siguientes iteraciones, soportaremos múltiples supplies sumando bloques.
  const luzSupply = supplies.find(s => s.type !== 'gas' && inferred.has(s.id))
  const gasSupply = supplies.find(s => s.type === 'gas' && inferred.has(s.id))

  const luzContract = luzSupply ? inferred.get(luzSupply.id)?.luz || null : null
  const gasContract = gasSupply ? inferred.get(gasSupply.id)?.gas || null : null

  // Histórico (año anterior) + Real Voltis (año actual)
  const histByMonth = new Map<number, HistoricalMonth>()
  const realByMonth = new Map<number, RealVoltisMonth>()

  for (const inv of invoices) {
    const end = inv.period_end || inv.period_start
    if (!end) continue
    const d = new Date(end)
    const yr = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const eco = inv.extracted_data?.economics
    if (!eco) continue

    const isGas = !!eco.gasPricing
    const isVoltis = (inv.source || '').toLowerCase() === 'voltis'
    const dias = computeDias(inv.period_start, inv.period_end)
    const monthIso = `${yr}-${String(m).padStart(2, '0')}-01`

    if (yr === yearPrev) {
      let h = histByMonth.get(m)
      if (!h) { h = { month: monthIso, dias }; histByMonth.set(m, h) }
      h.dias = Math.max(h.dias, dias)
      if (isGas && inv.supply_id === gasSupply?.id) {
        h.consumoGas = (h.consumoGas || 0) + (Number(eco.consumoTotalKwh) || 0)
      } else if (!isGas && inv.supply_id === luzSupply?.id) {
        h.consumoLuz = h.consumoLuz || {}
        h.potenciaLuz = h.potenciaLuz || {}
        for (const c of (eco.consumo || [])) {
          const k = (c.periodo || '').toUpperCase()
          if (['P1','P2','P3','P4','P5','P6'].includes(k)) {
            (h.consumoLuz as any)[k] = ((h.consumoLuz as any)[k] || 0) + Number(c.kwh || 0)
          }
        }
        for (const p of (eco.potencia || [])) {
          const pp = (p.periodo || '').toUpperCase()
          if (['P1','P2','P3','P4','P5','P6'].includes(pp)) {
            const cur = (h.potenciaLuz as any)[pp] || 0
            const nuevo = Number(p.kw || 0)
            if (nuevo > cur) (h.potenciaLuz as any)[pp] = nuevo
          }
        }
      }
    }

    if (yr === year && isVoltis) {
      let r = realByMonth.get(m)
      if (!r) { r = { month: monthIso }; realByMonth.set(m, r) }
      if (isGas && inv.supply_id === gasSupply?.id) {
        r.importeGas = (r.importeGas || 0) + Number(inv.total_amount || 0)
        r.consumoGasKwh = (r.consumoGasKwh || 0) + (Number(eco.consumoTotalKwh) || 0)
      } else if (!isGas && inv.supply_id === luzSupply?.id) {
        r.importeLuz = (r.importeLuz || 0) + Number(inv.total_amount || 0)
        r.consumoLuzKwh = (r.consumoLuzKwh || 0) + (Number(eco.consumoTotalKwh) || 0)
      }
    }
  }

  // ── COMPLETAR HISTÓRICO CON SIPS ───────────────────────────────────
  // Para los meses del año anterior que NO tienen factura histórica,
  // usamos el consumo SIPS del mismo mes. Es exactamente la metodología
  // del doc oficial Unice: "Consumos abril-diciembre 2026: consumos del
  // mismo mes del año anterior según el SIPS oficial del distribuidor."
  for (let m = 1; m <= 12; m++) {
    const monthIso = `${yearPrev}-${String(m).padStart(2, '0')}-01`
    let h = histByMonth.get(m)
    if (!h) {
      const lastDay = new Date(yearPrev, m, 0).getUTCDate()
      h = { month: monthIso, dias: lastDay }
      histByMonth.set(m, h)
    }
    // Completar luz desde SIPS si falta o está vacía
    if (luzSupply && (!h.consumoLuz || sumPeriodos(h.consumoLuz) === 0)) {
      const sipsLuz = findSipsLuzForMonth(luzSupply.consumption_data?.history, yearPrev, m)
      if (sipsLuz) {
        h.consumoLuz = sipsLuz
        h.potenciaLuz = h.potenciaLuz || (luzSupply.consumption_data?.potenciaContratada || {})
      }
    }
    // Completar gas desde SIPS si falta
    if (gasSupply && (h.consumoGas == null || h.consumoGas === 0)) {
      const sipsGas = findSipsGasForMonth(gasSupply.consumption_data?.gasHistory, yearPrev, m)
      if (sipsGas != null) {
        h.consumoGas = sipsGas
      }
    }
  }

  const historical = Array.from(histByMonth.values())
  const realCurrent = Array.from(realByMonth.values())
  const potenciaMaxKw = inferPotenciaMaxKw(luzSupply, invoices)
  const clientName = clientRes.data?.name || 'Cliente'
  const clientCif = clientRes.data?.cif_nif || clientRes.data?.nif || null

  const report = buildForecast(year, clientName, historical, realCurrent, luzContract, gasContract, potenciaMaxKw)

  // Fiscalidad aplicable al año (subset de FISCAL_PERIODS dentro del año)
  const fiscalAplicable = FISCAL_PERIODS.filter(fp => {
    return fp.from.slice(0, 4) === String(year) || fp.to.slice(0, 4) === String(year)
  })

  // Nota fiscal personalizada según potencia
  const notaFiscal = potenciaMaxKw >= 10
    ? `El cliente, con potencias de hasta ${potenciaMaxKw.toFixed(0)} kW, mantiene el IVA al 21 % durante todo el ejercicio aunque haya rebajas vigentes para pequeñas potencias (RDL).`
    : null

  auditLog({ ctx, action: 'view_forecast', metadata: { year } }).catch(() => {})

  const res = NextResponse.json({
    empty: false,
    clientCif,
    potenciaMaxKw,
    luzSupply: luzSupply ? { id: luzSupply.id, cups: luzSupply.cups, name: luzSupply.name } : null,
    gasSupply: gasSupply ? { id: gasSupply.id, cups: gasSupply.cups, name: gasSupply.name } : null,
    luzContract, gasContract,
    fiscalAplicable,
    notaFiscal,
    report,
  })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

function computeDias(start: string | null, end: string | null): number {
  if (!start || !end) return 30
  const d1 = new Date(start), d2 = new Date(end)
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)
}

function sumPeriodos(p?: Partial<Record<string, number>>): number {
  if (!p) return 0
  return Object.values(p).reduce((a, b) => (a || 0) + (b || 0), 0) || 0
}

/**
 * Busca el consumo SIPS de gas para un mes/año concreto.
 * El historial gas viene mensual con fechaInicio/fechaFin.
 */
function findSipsGasForMonth(history: any[] | undefined, year: number, month: number): number | null {
  if (!Array.isArray(history)) return null
  for (const entry of history) {
    const fi = entry?.fechaInicio
    if (!fi) continue
    const d = new Date(fi)
    if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month) {
      const kwh = Number(entry.kwh) || 0
      return kwh > 0 ? kwh : null
    }
  }
  return null
}

/**
 * Busca el consumo SIPS de luz para un mes/año concreto.
 * El historial luz viene por periodo de facturación con fechaFin
 * y desglose P1..P6. Imputamos cada entrada al mes de su fechaFin.
 */
function findSipsLuzForMonth(history: any[] | undefined, year: number, month: number): Record<string, number> | null {
  if (!Array.isArray(history)) return null
  for (const entry of history) {
    const ff = entry?.fecha || entry?.fechaFin
    if (!ff) continue
    const d = new Date(ff)
    if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month) {
      const total = Number(entry.total) || 0
      if (total <= 0) continue
      return {
        P1: Number(entry.P1) || 0,
        P2: Number(entry.P2) || 0,
        P3: Number(entry.P3) || 0,
        P4: Number(entry.P4) || 0,
        P5: Number(entry.P5) || 0,
        P6: Number(entry.P6) || 0,
      }
    }
  }
  return null
}

function inferPotenciaMaxKw(supply: any, invs: any[]): number {
  if (!supply) return 0
  let max = 0
  const cd = supply.consumption_data?.potenciaContratada || {}
  for (const v of Object.values(cd) as any[]) {
    const n = Number(v) || 0
    if (n > max) max = n
  }
  for (const inv of invs) {
    if (inv.supply_id !== supply.id) continue
    const pots = inv.extracted_data?.economics?.potencia || []
    for (const p of pots) {
      const n = Number(p.kw) || 0
      if (n > max) max = n
    }
  }
  return max
}
