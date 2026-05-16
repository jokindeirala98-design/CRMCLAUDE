/**
 * GET /api/portal/v2/savings
 *
 * Comparativa directa Voltis vs comercializadora anterior, por mes.
 *
 * Estrategia: para cada factura Voltis del cliente, buscamos la factura
 * NO-Voltis del MISMO mes del AÑO ANTERIOR (mismo supply_id). Si existe,
 * calculamos el ahorro directamente:
 *
 *     ahorro_mes = total_antes - total_voltis
 *
 * No requiere simulación ni tabla voltis_contracts. Se activa solo cuando
 * empiezan a llegar facturas Voltis. Si no hay factura del año anterior
 * para un mes, ese mes aparece marcado como "sin comparativa" y no se
 * incluye en el total.
 *
 * El cliente del portal selecciona qué meses incluir y ve el total
 * acumulado de ahorro (estilo AnualEconomics).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { PORTAL_SESSION_COOKIE, resolveSession, auditLog } from '@/lib/portal/auth'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface InvoiceLite {
  id: string
  supply_id: string
  source: string | null
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  extracted_data: any
}

interface MonthlyMatch {
  /** YYYY-MM del mes (el mes "Voltis"). */
  month: string
  monthLabel: string
  year: number
  monthIdx: number
  supplyId: string
  supplyName: string | null
  supplyCups: string | null
  supplyType: 'luz' | 'gas'
  /** Factura Voltis de ese mes. */
  voltis: { id: string; total: number; consumoKwh: number; periodStart: string | null; periodEnd: string | null }
  /** Factura comercializadora anterior del MISMO mes del año anterior, si existe. */
  prior?: { id: string; total: number; consumoKwh: number; periodStart: string | null; periodEnd: string | null; sourceLabel: string }
  /** Ahorro = prior.total − voltis.total. Solo si hay prior. */
  ahorro?: number
  /** Si NO hay prior, motivo. */
  noPriorReason?: string
}

const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  if (!sessionToken) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const ctx = await resolveSession(sessionToken)
  if (!ctx) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const sb = admin()
  const clientId = ctx.clientId

  // Cargamos supplies + todas las facturas del cliente
  const [supRes, invRes] = await Promise.all([
    sb.from('supplies')
      .select('id, type, cups, name')
      .eq('client_id', clientId),
    sb.from('invoices')
      .select('id, supply_id, source, period_start, period_end, total_amount, extracted_data, comercializadora_id')
      .order('period_end', { ascending: true }),
  ])

  const supplies = supRes.data || []
  const supplyIds = new Set(supplies.map(s => s.id))
  const supplyById = new Map(supplies.map(s => [s.id, s]))
  const invoices: InvoiceLite[] = (invRes.data || []).filter(i => supplyIds.has(i.supply_id))

  // Separamos Voltis vs antiguas
  const voltis = invoices.filter(i => isVoltis(i))
  const antiguas = invoices.filter(i => !isVoltis(i))

  if (voltis.length === 0) {
    auditLog({ ctx, action: 'view_savings_empty' }).catch(() => {})
    return NextResponse.json({
      empty: true,
      reason: 'Aún no hemos cargado ninguna factura emitida por Voltis. El módulo de ahorro se activa automáticamente con la primera factura.',
    })
  }

  // Index facturas antiguas por (supply_id, year-month) para lookup rápido
  // Para cada Voltis con period_end YYYY-MM, buscamos antigua con (YYYY-1)-MM
  const antiguasByKey = new Map<string, InvoiceLite[]>()
  for (const inv of antiguas) {
    const k = monthKey(inv)
    if (!k) continue
    const id = `${inv.supply_id}__${k}`
    if (!antiguasByKey.has(id)) antiguasByKey.set(id, [])
    antiguasByKey.get(id)!.push(inv)
  }

  const matches: MonthlyMatch[] = []
  for (const v of voltis) {
    const k = monthKey(v)
    if (!k) continue
    const [yr, mo] = k.split('-').map(s => parseInt(s, 10))
    const sup = supplyById.get(v.supply_id)
    if (!sup) continue
    const priorKey = `${v.supply_id}__${yr - 1}-${String(mo).padStart(2, '0')}`
    const priors = antiguasByKey.get(priorKey) || []
    // Si hay varios (raro), sumamos sus importes y kWh
    let priorBlock: MonthlyMatch['prior'] | undefined
    if (priors.length > 0) {
      const totalPrior = priors.reduce((a, p) => a + (Number(p.total_amount) || 0), 0)
      const consumoPrior = priors.reduce((a, p) => a + (Number(p.extracted_data?.economics?.consumoTotalKwh) || 0), 0)
      priorBlock = {
        id: priors[0].id,
        total: round2(totalPrior),
        consumoKwh: Math.round(consumoPrior),
        periodStart: priors[0].period_start,
        periodEnd: priors[0].period_end,
        sourceLabel: priors[0].source || 'Comercializadora anterior',
      }
    }
    const vTotal = Number(v.total_amount) || 0
    const vConsumo = Number(v.extracted_data?.economics?.consumoTotalKwh) || 0
    matches.push({
      month: k,
      monthLabel: `${MESES_SHORT[mo - 1]} ${String(yr).slice(2)}`,
      year: yr,
      monthIdx: mo - 1,
      supplyId: v.supply_id,
      supplyName: sup.name,
      supplyCups: sup.cups,
      supplyType: (sup.type === 'gas' ? 'gas' : 'luz') as 'luz' | 'gas',
      voltis: {
        id: v.id,
        total: round2(vTotal),
        consumoKwh: Math.round(vConsumo),
        periodStart: v.period_start,
        periodEnd: v.period_end,
      },
      prior: priorBlock,
      ahorro: priorBlock ? round2(priorBlock.total - vTotal) : undefined,
      noPriorReason: priorBlock ? undefined : `Sin factura de ${MESES_SHORT[mo - 1]} ${yr - 1} para comparar`,
    })
  }

  // Orden por mes ascendente
  matches.sort((a, b) => a.month.localeCompare(b.month))

  // Totales globales (todos los meses con prior)
  const matched = matches.filter(m => m.prior && m.ahorro !== undefined)
  const totalVoltis = round2(matched.reduce((a, m) => a + m.voltis.total, 0))
  const totalPrior = round2(matched.reduce((a, m) => a + (m.prior?.total || 0), 0))
  const ahorroTotal = round2(totalPrior - totalVoltis)
  const ahorroPct = totalPrior > 0 ? round2((ahorroTotal / totalPrior) * 100) : 0

  auditLog({ ctx, action: 'view_savings' }).catch(() => {})
  const res = NextResponse.json({
    empty: false,
    matches,
    totals: {
      totalVoltis,
      totalPrior,
      ahorroTotal,
      ahorroPct,
      mesesComparables: matched.length,
      mesesSinComparar: matches.length - matched.length,
    },
  })
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  return res
}

function isVoltis(inv: InvoiceLite): boolean {
  return (inv.source || '').toLowerCase() === 'voltis'
}

function monthKey(inv: InvoiceLite): string | null {
  const d = inv.period_end || inv.period_start
  if (!d) return null
  const dt = new Date(d)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
