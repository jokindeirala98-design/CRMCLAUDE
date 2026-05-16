/**
 * GET /api/portal/v2/forecast?year=2026
 *
 * Devuelve la previsión anual completa para el cliente autenticado.
 * Combina facturas Voltis reales (meses ya facturados) con simulación
 * para los meses futuros (SIPS año anterior × precios Voltis).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { PORTAL_SESSION_COOKIE, resolveSession, auditLog } from '@/lib/portal/auth'
import { buildForecast, type HistoricalMonth, type RealVoltisMonth } from '@/lib/portal/forecast-engine'
import type { LuzContract, GasContract } from '@/lib/portal/billing-engine'

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

  const [supRes, invRes, ctRes, clientRes] = await Promise.all([
    sb.from('supplies').select('id, type, cups, name, consumption_data').eq('client_id', clientId),
    sb.from('invoices').select('id, supply_id, source, period_start, period_end, total_amount, extracted_data').order('period_end', { ascending: true }),
    sb.from('voltis_contracts').select('*').order('start_date', { ascending: false }),
    sb.from('clients').select('id, name').eq('id', clientId).maybeSingle(),
  ])

  const supplies = supRes.data || []
  const supplyIds = new Set(supplies.map(s => s.id))
  const invoices = (invRes.data || []).filter(i => supplyIds.has(i.supply_id))
  const contracts = ctRes.data || []

  const luzSupply = supplies.find(s => s.type !== 'gas')
  const gasSupply = supplies.find(s => s.type === 'gas')

  const luzContractRow = contracts.find(c => c.supply_id === luzSupply?.id)
  const gasContractRow = contracts.find(c => c.supply_id === gasSupply?.id)

  if (!luzContractRow && !gasContractRow) {
    return NextResponse.json({
      empty: true,
      reason: 'Aún no hemos cargado los precios contractuales Voltis para tus suministros. La previsión se activará cuando estén disponibles.',
    })
  }

  const luzContract: LuzContract | null = luzContractRow ? {
    precioKwhP1: Number(luzContractRow.precio_kwh_p1) || 0,
    precioKwhP2: Number(luzContractRow.precio_kwh_p2) || 0,
    precioKwhP3: Number(luzContractRow.precio_kwh_p3) || 0,
    precioKwhP4: Number(luzContractRow.precio_kwh_p4) || 0,
    precioKwhP5: Number(luzContractRow.precio_kwh_p5) || 0,
    precioKwhP6: Number(luzContractRow.precio_kwh_p6) || 0,
    precioKwDiaP1: Number(luzContractRow.precio_kw_dia_p1) || 0,
    precioKwDiaP2: Number(luzContractRow.precio_kw_dia_p2) || 0,
    precioKwDiaP3: Number(luzContractRow.precio_kw_dia_p3) || 0,
    precioKwDiaP4: Number(luzContractRow.precio_kw_dia_p4) || 0,
    precioKwDiaP5: Number(luzContractRow.precio_kw_dia_p5) || 0,
    precioKwDiaP6: Number(luzContractRow.precio_kw_dia_p6) || 0,
  } : null

  const gasContract: GasContract | null = gasContractRow ? {
    precioKwhGas: Number(gasContractRow.precio_kwh_gas) || 0,
    peajeKwhGas: Number(gasContractRow.peaje_kwh_gas) || 0,
    terminoFijoDiarioGas: Number(gasContractRow.termino_fijo_diario_gas) || 0,
  } : null

  // Historical = facturas del año anterior (consumo + días)
  // Real current = facturas Voltis del año actual (importe + consumo)
  const historical: HistoricalMonth[] = []
  const realCurrent: RealVoltisMonth[] = []

  // Agrupamos por mes (YYYY-MM-01)
  const histByMonth = new Map<string, HistoricalMonth>()
  const realByMonth = new Map<string, RealVoltisMonth>()

  for (const inv of invoices) {
    const end = inv.period_end || inv.period_start
    if (!end) continue
    const d = new Date(end)
    const yr = d.getUTCFullYear()
    const mNum = d.getUTCMonth() + 1
    const monthIso = `${yr}-${String(mNum).padStart(2, '0')}-01`
    const eco = inv.extracted_data?.economics
    if (!eco) continue

    const isGas = !!eco.gasPricing
    const dias = computeDias(inv.period_start, inv.period_end)
    const isVoltis = (inv.source || '').toLowerCase() === 'voltis'

    // Historical → cualquier factura del año previo
    if (yr === yearPrev) {
      let h = histByMonth.get(monthIso)
      if (!h) { h = { month: monthIso, dias }; histByMonth.set(monthIso, h) }
      h.dias = Math.max(h.dias, dias)
      if (isGas) {
        h.consumoGas = (h.consumoGas || 0) + (Number(eco.consumoTotalKwh) || 0)
      } else {
        h.consumoLuz = h.consumoLuz || {}
        h.potenciaLuz = h.potenciaLuz || {}
        for (const c of (eco.consumo || [])) {
          const k = (c.periodo || '').toUpperCase()
          if (['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].includes(k)) {
            (h.consumoLuz as any)[k] = ((h.consumoLuz as any)[k] || 0) + Number(c.kwh || 0)
          }
        }
        for (const p of (eco.potencia || [])) {
          const k = (p.periodo || '').toUpperCase()
          if (['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].includes(k)) {
            const cur = (h.potenciaLuz as any)[k] || 0
            const nuevo = Number(p.kw || 0)
            if (nuevo > cur) (h.potenciaLuz as any)[k] = nuevo
          }
        }
      }
    }

    // Real current → facturas Voltis del año objetivo
    if (yr === year && isVoltis) {
      let r = realByMonth.get(monthIso)
      if (!r) { r = { month: monthIso }; realByMonth.set(monthIso, r) }
      if (isGas) {
        r.importeGas = (r.importeGas || 0) + Number(inv.total_amount || 0)
        r.consumoGasKwh = (r.consumoGasKwh || 0) + (Number(eco.consumoTotalKwh) || 0)
      } else {
        r.importeLuz = (r.importeLuz || 0) + Number(inv.total_amount || 0)
        r.consumoLuzKwh = (r.consumoLuzKwh || 0) + (Number(eco.consumoTotalKwh) || 0)
      }
    }
  }

  historical.push(...Array.from(histByMonth.values()))
  realCurrent.push(...Array.from(realByMonth.values()))

  const potenciaMaxKw = inferPotenciaMaxKw(luzSupply, invoices)
  const clientName = clientRes.data?.name || 'Cliente'

  const report = buildForecast(year, clientName, historical, realCurrent, luzContract, gasContract, potenciaMaxKw)

  auditLog({ ctx, action: 'view_forecast', metadata: { year } }).catch(() => {})
  const res = NextResponse.json({ empty: false, report })
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  return res
}

function computeDias(start: string | null, end: string | null): number {
  if (!start || !end) return 30
  const d1 = new Date(start), d2 = new Date(end)
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)
}

function inferPotenciaMaxKw(luzSupply: any, invoices: any[]): number {
  if (!luzSupply) return 0
  let max = 0
  const cd = luzSupply.consumption_data?.potenciaContratada || {}
  for (const v of Object.values(cd) as any[]) {
    const n = Number(v) || 0
    if (n > max) max = n
  }
  for (const inv of invoices) {
    const pots = inv.extracted_data?.economics?.potencia || []
    for (const p of pots) {
      const n = Number(p.kw) || 0
      if (n > max) max = n
    }
  }
  return max
}
