/**
 * POST /api/contracts/sheets-sync
 * Called after saving a contract to push a row to VOLTIS CONTRATACIONES.
 * Body: { contract_id: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { appendContractRow, type ContratacionRow } from '@/lib/google-sheets'

export async function POST(req: NextRequest) {
  try {
    const { contract_id } = await req.json()
    if (!contract_id) return NextResponse.json({ error: 'contract_id required' }, { status: 400 })

    const supabase = createServerSupabaseClient()

    // Fetch full contract with all related data
    const { data: contract, error } = await supabase
      .from('contracts')
      .select(`
        *,
        client:clients(
          id, name, type, cif_nif, email, phone, iban, fiscal_address,
          commercial:users_profile(full_name)
        ),
        supply:supplies(
          cups, tariff, type, address,
          annual_consumption
        ),
        comercializadora:comercializadoras(name)
      `)
      .eq('id', contract_id)
      .single()

    if (error || !contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const client = contract.client
    const supply = contract.supply
    const comercializadora = contract.comercializadora

    // Map service type
    const servicioMap: Record<string, string> = {
      electricity: 'Energía',
      gas: 'GAS',
      telecom: 'Telefonía',
    }
    const servicio = servicioMap[supply?.type || ''] || 'Energía'

    // Map tramite
    const tramiteMap: Record<string, string> = {
      new: 'NUEVA CONTRATACION',
      change: 'CAMBIO DE COMERCIALIZADORA',
      renewal: 'RENOVACION',
      name_change: 'CAMBIO DE NOMBRE',
    }

    // Format date dd-mm-yyyy
    const fmtDate = (iso?: string | null) => {
      if (!iso) return ''
      const d = new Date(iso)
      return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
    }

    // Determine if company/ayuntamiento (has separate firmante)
    const isCompanyOrAyto = client?.type === 'empresa' || client?.type === 'ayuntamiento'

    const row: ContratacionRow = {
      comercial: client?.commercial?.full_name || '',
      fechaFirma: fmtDate(contract.signed_at || contract.generated_at),
      fechaActivacion: fmtDate(contract.fecha_activacion),
      nombre: client?.name || '',
      nifCif: client?.cif_nif || '',
      firmante: isCompanyOrAyto ? (contract.firmante || '') : undefined,
      dniFirmante: isCompanyOrAyto ? (contract.dni_firmante || '') : undefined,
      comercializadora: comercializadora?.name || contract.comercializadora_name || '',
      servicio,
      mail: client?.email || '',
      telefono: client?.phone || '',
      iban: client?.iban || '',
      direccionSuministro: supply?.address || '',
      direccionFiscal: client?.fiscal_address || '',
      cups: supply?.cups || '',
      producto: contract.producto || supply?.tariff || '',
      tramite: tramiteMap[contract.tramite || ''] || contract.tramite || 'NUEVA CONTRATACION',
      observaciones: contract.observaciones || '',
      consumo: contract.consumo_anual || supply?.annual_consumption || '',
      comComercial: client?.commercial?.full_name || '',
      estado: 'PENDIENTE',
    }

    const updatedRange = await appendContractRow(row)

    // Mark contract as synced to sheets
    await supabase
      .from('contracts')
      .update({ sheets_synced_at: new Date().toISOString() })
      .eq('id', contract_id)

    return NextResponse.json({ ok: true, range: updatedRange })
  } catch (err: any) {
    console.error('[sheets-sync]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
