/**
 * GET /api/portal/v2/savings
 *
 * Devuelve el reporte de ahorro completo del cliente con la misma
 * estructura que el doc PDF "Ahorro luz / gas 1er Trimestre" de Unice:
 *
 *  - 4 escenarios por suministro (S0/S1/S2/S3) cuando hay datos suficientes.
 *  - Atribución de cada parte del ahorro (tarifa / normativa / consumo).
 *  - Mes a mes con factura prior (Ekyner-style) vs simulación vs Voltis real.
 *  - Precios Voltis aplicados (inferidos automáticamente de las facturas).
 *
 * Activación automática:
 *   • Si hay ≥1 factura Voltis → se calcula. En caso contrario, empty.
 *   • Los precios contractuales se infieren directamente de las facturas
 *     Voltis (no requiere admin que rellene voltis_contracts a mano).
 *   • Si además hay factura prior (mismo mes año anterior) → S0 disponible.
 *   • Si no hay prior, ese mes solo tiene S2/S3.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { PORTAL_SESSION_COOKIE, resolveSession, auditLog } from '@/lib/portal/auth'
import { inferContractsFromInvoices } from '@/lib/portal/contract-inference'
import { calcularFacturaLuz, calcularFacturaGas, type LuzInputs, type GasInputs } from '@/lib/portal/billing-engine'
import { fiscalAt } from '@/lib/portal/fiscal'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

interface MonthlyEntry {
  month: string                 // 'YYYY-MM'
  monthLabel: string            // 'Ene 26'
  year: number
  monthIdx: number              // 0..11
  supplyId: string
  supplyName: string | null
  supplyCups: string | null
  supplyType: 'luz' | 'gas'
  // 4 escenarios (cuando hay datos suficientes)
  s0_priorReal?: number         // Pagó real con comercializadora anterior
  s1_voltisFiscalAnt?: number   // Mismo consumo, precios Voltis, fiscalidad año anterior
  s2_voltisFiscalAct?: number   // Mismo consumo, precios Voltis, fiscalidad año actual
  s3_voltisReal?: number        // Pagó real con Voltis
  // Consumo del prior (lo usamos para mostrar en tablas y como base de simulación)
  consumoPriorKwh?: number
  // Atribución del ahorro mensual
  ahorroCambioTarifa?: number     // S0 - S1
  ahorroCambioNormativo?: number  // S1 - S2 (puede ser negativo si suben impuestos)
  ahorroMenorConsumo?: number     // S2 - S3
  ahorroTotal?: number             // S0 - S3
  // Si falta prior, indicamos motivo
  noPriorReason?: string
}

interface ScenarioBlock {
  type: 'luz' | 'gas'
  supplyId: string
  supplyName: string | null
  supplyCups: string | null
  contract: any                   // precios inferidos (formato libre para UI)
  /** Suma de los meses comparables (con S0 y S3). */
  totals: {
    s0: number; s1: number; s2: number; s3: number
    ahorroCambioTarifa: number
    ahorroCambioNormativo: number
    ahorroMenorConsumo: number
    ahorroTotal: number
    ahorroTotalPct: number
    mesesComparables: number
  }
  months: MonthlyEntry[]
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  if (!sessionToken) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const ctx = await resolveSession(sessionToken)
  if (!ctx) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const sb = admin()
  const clientId = ctx.clientId

  const [supRes, invRes, clientRes] = await Promise.all([
    sb.from('supplies').select('id, type, cups, name, consumption_data').eq('client_id', clientId),
    sb.from('invoices').select('id, supply_id, source, period_start, period_end, total_amount, extracted_data').order('period_end', { ascending: true }),
    sb.from('clients').select('id, name').eq('id', clientId).maybeSingle(),
  ])

  const supplies = supRes.data || []
  const supplyIds = new Set(supplies.map(s => s.id))
  const invoices = (invRes.data || []).filter(i => supplyIds.has(i.supply_id))
  const supplyById = new Map(supplies.map(s => [s.id, s]))

  // Inferimos los contratos Voltis automáticamente
  const inferred = inferContractsFromInvoices({ invoices })

  if (inferred.size === 0) {
    auditLog({ ctx, action: 'view_savings_empty' }).catch(() => {})
    return NextResponse.json({
      empty: true,
      reason: 'Aún no hemos cargado ninguna factura emitida por Voltis. El módulo de ahorro se activará automáticamente con la primera factura.',
    })
  }

  // Indexamos facturas por (supply_id, year-month)
  const invByKey = new Map<string, any[]>()
  for (const inv of invoices) {
    const k = monthKey(inv)
    if (!k) continue
    const key = `${inv.supply_id}__${k}`
    if (!invByKey.has(key)) invByKey.set(key, [])
    invByKey.get(key)!.push(inv)
  }

  // Para cada supply con contrato inferido, construimos el bloque
  const blocks: ScenarioBlock[] = []
  for (const [supplyId, contractInfer] of inferred.entries()) {
    const sup = supplyById.get(supplyId)
    if (!sup) continue
    const potenciaMaxKw = inferPotenciaMaxKw(sup, invoices.filter(i => i.supply_id === supplyId))

    // Encontramos todas las facturas Voltis de este suministro
    const voltisInvs = invoices.filter(i => i.supply_id === supplyId && (i.source || '').toLowerCase() === 'voltis')
    const months: MonthlyEntry[] = []

    for (const v of voltisInvs) {
      const k = monthKey(v)
      if (!k) continue
      const [yr, mo] = k.split('-').map(s => parseInt(s, 10))

      // Factura prior (mismo mes año anterior, NO Voltis)
      const priorKey = `${supplyId}__${yr - 1}-${String(mo).padStart(2, '0')}`
      const priors = (invByKey.get(priorKey) || []).filter(i => (i.source || '').toLowerCase() !== 'voltis')

      const dias = computeDias(v.period_start, v.period_end)
      const eco = v.extracted_data?.economics

      const monthDate = new Date(`${yr}-${String(mo).padStart(2, '0')}-15T00:00:00Z`)
      const fiscalActual = fiscalAt(monthDate)
      const monthDatePrev = new Date(`${yr - 1}-${String(mo).padStart(2, '0')}-15T00:00:00Z`)
      const fiscalAnterior = fiscalAt(monthDatePrev)

      const entry: MonthlyEntry = {
        month: k,
        monthLabel: `${MESES_SHORT[mo - 1]} ${String(yr).slice(2)}`,
        year: yr,
        monthIdx: mo - 1,
        supplyId,
        supplyName: sup.name,
        supplyCups: sup.cups,
        supplyType: (sup.type === 'gas' ? 'gas' : 'luz') as 'luz' | 'gas',
        s3_voltisReal: round2(Number(v.total_amount) || 0),
      }

      if (priors.length > 0) {
        const totalPrior = priors.reduce((a, p) => a + (Number(p.total_amount) || 0), 0)
        const consumoPrior = priors.reduce((a, p) => a + (Number(p.extracted_data?.economics?.consumoTotalKwh) || 0), 0)
        entry.s0_priorReal = round2(totalPrior)
        entry.consumoPriorKwh = Math.round(consumoPrior)

        // Para simular S1/S2: usamos el CONSUMO del prior + precios Voltis + fiscalidad correspondiente
        const priorEco = priors[0].extracted_data?.economics
        if (priorEco) {
          if (contractInfer.type === 'luz' && contractInfer.luz) {
            // Reconstruimos consumo por periodo del prior
            const consumoPorPeriodo: any = {}
            const potenciaPorPeriodo: any = {}
            for (const c of (priorEco.consumo || [])) {
              const p = (c.periodo || '').toUpperCase()
              if (['P1','P2','P3','P4','P5','P6'].includes(p)) consumoPorPeriodo[p] = (consumoPorPeriodo[p] || 0) + Number(c.kwh || 0)
            }
            for (const p of (priorEco.potencia || [])) {
              const pp = (p.periodo || '').toUpperCase()
              if (['P1','P2','P3','P4','P5','P6'].includes(pp)) {
                const cur = potenciaPorPeriodo[pp] || 0
                const nuevo = Number(p.kw || 0)
                if (nuevo > cur) potenciaPorPeriodo[pp] = nuevo
              }
            }
            const priorDias = computeDias(priors[0].period_start, priors[0].period_end)
            const inputs: LuzInputs = {
              consumoPorPeriodo, potenciaPorPeriodo, dias: priorDias,
            }
            const s1Calc = calcularFacturaLuz(inputs, contractInfer.luz, fiscalAnterior, potenciaMaxKw)
            const s2Calc = calcularFacturaLuz(inputs, contractInfer.luz, fiscalActual, potenciaMaxKw)
            entry.s1_voltisFiscalAnt = s1Calc.total
            entry.s2_voltisFiscalAct = s2Calc.total
          } else if (contractInfer.type === 'gas' && contractInfer.gas) {
            const priorDias = computeDias(priors[0].period_start, priors[0].period_end)
            const consumoKwh = Number(priorEco.consumoTotalKwh) || 0
            const inputs: GasInputs = { consumoKwh, dias: priorDias }
            const s1Calc = calcularFacturaGas(inputs, contractInfer.gas, fiscalAnterior)
            const s2Calc = calcularFacturaGas(inputs, contractInfer.gas, fiscalActual)
            entry.s1_voltisFiscalAnt = s1Calc.total
            entry.s2_voltisFiscalAct = s2Calc.total
          }

          if (entry.s0_priorReal !== undefined && entry.s1_voltisFiscalAnt !== undefined) {
            entry.ahorroCambioTarifa = round2(entry.s0_priorReal - entry.s1_voltisFiscalAnt)
            entry.ahorroCambioNormativo = round2(entry.s1_voltisFiscalAnt - (entry.s2_voltisFiscalAct || entry.s1_voltisFiscalAnt))
            entry.ahorroMenorConsumo = round2((entry.s2_voltisFiscalAct || 0) - (entry.s3_voltisReal || 0))
            entry.ahorroTotal = round2(entry.s0_priorReal - (entry.s3_voltisReal || 0))
          }
        }
      } else {
        entry.noPriorReason = `Sin factura de ${MESES_SHORT[mo - 1]} ${yr - 1} para comparar`
      }

      months.push(entry)
    }

    months.sort((a, b) => a.month.localeCompare(b.month))

    // Totals
    const matched = months.filter(m => m.s0_priorReal !== undefined)
    const totals = {
      s0: round2(matched.reduce((a, m) => a + (m.s0_priorReal || 0), 0)),
      s1: round2(matched.reduce((a, m) => a + (m.s1_voltisFiscalAnt || 0), 0)),
      s2: round2(matched.reduce((a, m) => a + (m.s2_voltisFiscalAct || 0), 0)),
      s3: round2(matched.reduce((a, m) => a + (m.s3_voltisReal || 0), 0)),
      ahorroCambioTarifa: 0, ahorroCambioNormativo: 0, ahorroMenorConsumo: 0,
      ahorroTotal: 0, ahorroTotalPct: 0,
      mesesComparables: matched.length,
    }
    totals.ahorroCambioTarifa = round2(totals.s0 - totals.s1)
    totals.ahorroCambioNormativo = round2(totals.s1 - totals.s2)
    totals.ahorroMenorConsumo = round2(totals.s2 - totals.s3)
    totals.ahorroTotal = round2(totals.s0 - totals.s3)
    totals.ahorroTotalPct = totals.s0 > 0 ? round2((totals.ahorroTotal / totals.s0) * 100) : 0

    blocks.push({
      type: contractInfer.type,
      supplyId,
      supplyName: sup.name,
      supplyCups: sup.cups,
      contract: contractInfer.luz || contractInfer.gas,
      totals,
      months,
    })
  }

  auditLog({ ctx, action: 'view_savings' }).catch(() => {})

  const res = NextResponse.json({
    empty: false,
    clientName: clientRes.data?.name || null,
    blocks,
  })
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  return res
}

// ── Helpers ──────────────────────────────────────────────────────────────

function monthKey(inv: any): string | null {
  const d = inv.period_end || inv.period_start
  if (!d) return null
  const dt = new Date(d)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

function computeDias(start: string | null, end: string | null): number {
  if (!start || !end) return 30
  const d1 = new Date(start), d2 = new Date(end)
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)
}

function inferPotenciaMaxKw(supply: any, invs: any[]): number {
  let max = 0
  const cd = supply?.consumption_data?.potenciaContratada || {}
  for (const v of Object.values(cd) as any[]) {
    const n = Number(v) || 0
    if (n > max) max = n
  }
  for (const inv of invs) {
    const pots = inv.extracted_data?.economics?.potencia || []
    for (const p of pots) {
      const n = Number(p.kw) || 0
      if (n > max) max = n
    }
  }
  return max
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
