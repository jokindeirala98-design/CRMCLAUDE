/**
 * Capa de datos del portal cliente.
 *
 * Funciones puras que dado un client_id devuelven los datos agregados/detalle
 * necesarios. Se usan tanto desde:
 *   - Magic link humano (cookie de portal)
 *   - API key de Partner externo (Kivatio)
 *
 * NO sabe quién está llamando: las restricciones de acceso las aplica el
 * endpoint que las usa antes de invocar estas funciones.
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface PortalSupplyRow {
  id: string
  cups: string | null
  tariff: string | null
  type: string | null
  name: string | null
  consumoAnualKwh: number
  costeAnualEur: number
  nFacturas: number
  iconCategory: 'luz' | 'gas'
  // Para subtotales
  tariffGroup: string         // '2.0TD' | '3.0TD' | '6.1TD' | 'gas RL.x' …
}

export interface PortalOverview {
  client: {
    id: string
    name: string
    alias: string | null
  }
  years: number[]            // años con facturas, descendente
  defaultYear: number
  totalSupplies: number
  totalSuppliesLuz: number
  totalSuppliesGas: number
  totalCostAnual: number
  totalKwhAnual: number
  // Subtotales por grupo de tarifa
  byTariff: Array<{ tariff: string; supplies: number; cost: number; kwh: number }>
  supplies: PortalSupplyRow[]
  meta: {
    year: number             // año filtrado
    type: 'all' | 'luz' | 'gas'
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tariffGroup(tariff: string | null, type: string | null): string {
  if (type === 'gas' || /^RL/i.test(tariff || '')) return tariff || 'Gas'
  const t = (tariff || '').toUpperCase().replace(/\s/g, '')
  if (t.startsWith('2.0') || t.startsWith('20TD')) return '2.0TD'
  if (t.startsWith('3.0') || t.startsWith('30TD')) return '3.0TD'
  if (t.startsWith('6.1')) return '6.1TD'
  if (t.startsWith('6.2')) return '6.2TD'
  if (t.startsWith('6.3')) return '6.3TD'
  if (t.startsWith('6.4')) return '6.4TD'
  return tariff || 'Otra'
}

function tariffOrder(t: string): number {
  if (t === '2.0TD') return 1
  if (t === '3.0TD') return 2
  if (t === '6.1TD') return 3
  if (t === '6.2TD') return 4
  if (t === '6.3TD') return 5
  if (t === '6.4TD') return 6
  if (/^RL/i.test(t)) return 10
  return 99
}

// ── API: Overview ────────────────────────────────────────────────────────────

export async function getPortalOverview(
  clientId: string,
  options: { year?: number; type?: 'all' | 'luz' | 'gas' } = {},
): Promise<PortalOverview | null> {
  const sb = admin()
  const { data: client, error: errC } = await sb
    .from('clients')
    .select('id, name, alias')
    .eq('id', clientId)
    .maybeSingle()
  if (errC || !client) return null

  // Cargar todos los supplies del cliente
  const { data: supplies } = await sb
    .from('supplies')
    .select('id, cups, tariff, type, name')
    .eq('client_id', clientId)

  const sup = supplies ?? []
  const sids = sup.map(s => s.id)

  // Cargar todas las invoices (con economics)
  let invs: any[] = []
  if (sids.length > 0) {
    for (let i = 0; i < sids.length; i += 25) {
      const batch = sids.slice(i, i + 25)
      const { data } = await sb
        .from('invoices')
        .select('id, supply_id, period_start, period_end, total_amount, extracted_data')
        .in('supply_id', batch)
      invs = invs.concat(data ?? [])
    }
  }

  // Determinar años disponibles
  const yearsSet = new Set<number>()
  for (const inv of invs) {
    if (!inv.period_end) continue
    try { yearsSet.add(new Date(inv.period_end).getFullYear()) } catch {}
  }
  const years = [...yearsSet].sort((a, b) => b - a)
  const defaultYear = years[0] ?? new Date().getFullYear()
  const filterYear = options.year ?? defaultYear
  const filterType = options.type ?? 'all'

  // Agregar por supply
  const rows: PortalSupplyRow[] = []
  for (const s of sup) {
    const isGas = s.type === 'gas' || /^RL/i.test(s.tariff || '')
    if (filterType === 'luz' && isGas) continue
    if (filterType === 'gas' && !isGas) continue

    const supInvs = invs.filter(i => i.supply_id === s.id && i.period_end &&
      new Date(i.period_end).getFullYear() === filterYear)
    let coste = 0
    let kwh = 0
    for (const inv of supInvs) {
      const total = Number(inv.total_amount) || Number((inv.extracted_data || {})?.economics?.totalFactura) || 0
      coste += total
      const eco = (inv.extracted_data || {})?.economics
      if (eco?.consumoTotalKwh) kwh += Number(eco.consumoTotalKwh) || 0
    }

    rows.push({
      id: s.id,
      cups: s.cups,
      tariff: s.tariff,
      type: s.type,
      name: s.name,
      consumoAnualKwh: Math.round(kwh),
      costeAnualEur: Math.round(coste * 100) / 100,
      nFacturas: supInvs.length,
      iconCategory: isGas ? 'gas' : 'luz',
      tariffGroup: tariffGroup(s.tariff, s.type),
    })
  }

  // Subtotales por grupo de tarifa
  const byTariffMap = new Map<string, { supplies: number; cost: number; kwh: number }>()
  for (const r of rows) {
    const g = r.tariffGroup
    const cur = byTariffMap.get(g) || { supplies: 0, cost: 0, kwh: 0 }
    cur.supplies++; cur.cost += r.costeAnualEur; cur.kwh += r.consumoAnualKwh
    byTariffMap.set(g, cur)
  }
  const byTariff = [...byTariffMap.entries()]
    .map(([tariff, v]) => ({ tariff, ...v, cost: Math.round(v.cost*100)/100, kwh: Math.round(v.kwh) }))
    .sort((a, b) => tariffOrder(a.tariff) - tariffOrder(b.tariff))

  rows.sort((a, b) => b.costeAnualEur - a.costeAnualEur)

  return {
    client: { id: client.id, name: client.name, alias: client.alias },
    years,
    defaultYear,
    totalSupplies: sup.length,
    totalSuppliesLuz: sup.filter(s => !(s.type === 'gas' || /^RL/i.test(s.tariff || ''))).length,
    totalSuppliesGas: sup.filter(s => s.type === 'gas' || /^RL/i.test(s.tariff || '')).length,
    totalCostAnual: Math.round(rows.reduce((a, r) => a + r.costeAnualEur, 0) * 100) / 100,
    totalKwhAnual: rows.reduce((a, r) => a + r.consumoAnualKwh, 0),
    byTariff,
    supplies: rows,
    meta: { year: filterYear, type: filterType },
  }
}

// ── API: Supply detail ───────────────────────────────────────────────────────

export interface PortalSupplyDetail {
  supply: {
    id: string
    cups: string | null
    tariff: string | null
    type: string | null
    name: string | null
    clientId: string
  }
  invoices: Array<{
    id: string
    period_start: string | null
    period_end: string | null
    total_amount: number | null
    economics: any
    file_url?: string | null
  }>
  years: number[]
}

export async function getPortalSupplyDetail(supplyId: string, expectedClientId: string): Promise<PortalSupplyDetail | null> {
  const sb = admin()
  const { data: supply } = await sb
    .from('supplies')
    .select('id, cups, tariff, type, name, client_id')
    .eq('id', supplyId)
    .maybeSingle()
  if (!supply) return null
  if (supply.client_id !== expectedClientId) return null  // guardia anti-fuga

  const { data: invs } = await sb
    .from('invoices')
    .select('id, period_start, period_end, total_amount, extracted_data, file_url')
    .eq('supply_id', supplyId)
    .order('period_end', { ascending: true, nullsFirst: false })

  const yearsSet = new Set<number>()
  const invoices = (invs ?? []).map(inv => {
    if (inv.period_end) {
      try { yearsSet.add(new Date(inv.period_end).getFullYear()) } catch {}
    }
    return {
      id: inv.id,
      period_start: inv.period_start,
      period_end: inv.period_end,
      total_amount: inv.total_amount,
      economics: (inv.extracted_data || {})?.economics ?? null,
      file_url: inv.file_url,
    }
  })

  return {
    supply: {
      id: supply.id, cups: supply.cups, tariff: supply.tariff,
      type: supply.type, name: supply.name, clientId: supply.client_id,
    },
    invoices,
    years: [...yearsSet].sort((a, b) => b - a),
  }
}

// ── Magic link helpers ───────────────────────────────────────────────────────

export async function findOrCreatePortalLink(clientId: string, createdBy?: string | null): Promise<{ token: string; existed: boolean }> {
  const sb = admin()
  const { data: existing } = await sb
    .from('client_portal_access')
    .select('token')
    .eq('client_id', clientId)
    .eq('type', 'magic_link')
    .is('revoked_at', null)
    .maybeSingle()
  if (existing?.token) return { token: existing.token, existed: true }
  // Generar token nuevo
  const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'')   // 64 chars hex
  const { error } = await sb
    .from('client_portal_access')
    .insert({ client_id: clientId, token, type: 'magic_link', created_by: createdBy })
  if (error) throw new Error('No se pudo crear el acceso: ' + error.message)
  return { token, existed: false }
}

export async function resolvePortalToken(token: string): Promise<{ clientId: string } | null> {
  const sb = admin()
  const { data } = await sb
    .from('client_portal_access')
    .select('client_id, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (!data) return null
  if (data.revoked_at) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  // touch last_used_at (best effort, no await)
  sb.from('client_portal_access').update({ last_used_at: new Date().toISOString() }).eq('token', token).then(() => {})
  return { clientId: data.client_id }
}

// ── Partner API key auth ─────────────────────────────────────────────────────

import { createHash } from 'crypto'

export async function resolvePartnerApiKey(apiKey: string): Promise<{ partnerId: string; partnerName: string } | null> {
  const sb = admin()
  // Hash simple (sha256) — para producción puro usaríamos bcrypt async pero requiere lib
  const hash = createHash('sha256').update(apiKey).digest('hex')
  const { data } = await sb
    .from('partners')
    .select('id, name, active')
    .eq('api_key_hash', hash)
    .eq('active', true)
    .maybeSingle()
  if (!data) return null
  return { partnerId: data.id, partnerName: data.name }
}

export async function partnerCanAccessClient(partnerId: string, clientId: string): Promise<boolean> {
  const sb = admin()
  const { data } = await sb
    .from('partner_clients')
    .select('client_id')
    .eq('partner_id', partnerId)
    .eq('client_id', clientId)
    .maybeSingle()
  return !!data
}

// ── Auth wrapper para endpoints públicos ─────────────────────────────────────

import type { NextRequest } from 'next/server'

export interface PortalAuthResult {
  ok: boolean
  clientId?: string
  authType?: 'magic_link' | 'partner_api'
  partnerId?: string
  error?: string
  status?: number
}

export async function authPortalRequest(req: NextRequest, requiredClientId?: string): Promise<PortalAuthResult> {
  // 1. Bearer token (Partner API)
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer vlt_')) {
    const apiKey = authHeader.slice('Bearer '.length)
    const partner = await resolvePartnerApiKey(apiKey)
    if (!partner) return { ok: false, error: 'Invalid API key', status: 401 }
    if (requiredClientId) {
      const allowed = await partnerCanAccessClient(partner.partnerId, requiredClientId)
      if (!allowed) return { ok: false, error: 'Forbidden: client not shared with you', status: 403 }
    }
    return { ok: true, clientId: requiredClientId, authType: 'partner_api', partnerId: partner.partnerId }
  }

  // 2. Cookie portal (magic link)
  const cookieToken = req.cookies.get('voltis_portal_token')?.value
  if (cookieToken) {
    const resolved = await resolvePortalToken(cookieToken)
    if (!resolved) return { ok: false, error: 'Token inválido o revocado', status: 401 }
    if (requiredClientId && resolved.clientId !== requiredClientId) {
      return { ok: false, error: 'Forbidden', status: 403 }
    }
    return { ok: true, clientId: resolved.clientId, authType: 'magic_link' }
  }

  return { ok: false, error: 'No autenticado', status: 401 }
}
