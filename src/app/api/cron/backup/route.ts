/**
 * /api/cron/backup
 * ─────────────────
 * Cron diario (2:00 AM UTC) que genera un Excel completo con todos los datos
 * del CRM y lo envía por email a nicolasvoltis@gmail.com como adjunto.
 *
 * Tablas incluidas:
 *   - clientes
 *   - suministros
 *   - facturas (sin extracted_data para no inflar el fichero)
 *   - prescorings
 *   - contratos
 *
 * Autenticación: Authorization: Bearer <CRON_SECRET>
 * (Vercel Cron envía esta cabecera automáticamente)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { Resend } from 'resend'

// ── helpers ────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  })
}

function isoNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
}

/** Apply a standard header style to the first row of a sheet */
function styleHeader(sheet: ExcelJS.Worksheet, numCols: number) {
  const headerRow = sheet.getRow(1)
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > numCols) return
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' }, // dark navy — Voltis brand
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    }
  })
  headerRow.height = 22
}

/** Auto-fit column widths (rough heuristic) */
function autoFitColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach(col => {
    let maxLen = 10
    col.eachCell({ includeEmpty: false }, cell => {
      const len = cell.value ? String(cell.value).length : 0
      if (len > maxLen) maxLen = len
    })
    col.width = Math.min(maxLen + 4, 60)
  })
}

// ── main handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // 1. Auth check
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Supabase service-role client (bypasses RLS)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  try {
    // 3. Fetch all tables in parallel
    const [
      { data: clients,     error: eClients     },
      { data: supplies,    error: eSupplies     },
      { data: invoices,    error: eInvoices     },
      { data: prescorings, error: ePrescorings  },
      { data: contracts,   error: eContracts    },
    ] = await Promise.all([
      supabase
        .from('clients')
        .select('id, name, cif, nif, cif_nif, email, phone, fiscal_address, address, segment, created_at, updated_at')
        .order('created_at', { ascending: false }),

      supabase
        .from('supplies')
        .select('id, client_id, cups, tariff, type, address, status, power_p1, power_p2, power_p3, power_p4, power_p5, power_p6, distributor, created_at, updated_at')
        .order('created_at', { ascending: false }),

      supabase
        .from('invoices')
        .select('id, supply_id, period_start, period_end, total_amount, status, created_at, extracted_data')
        .order('created_at', { ascending: false }),

      supabase
        .from('prescorings')
        .select('id, supply_id, client_name, cups, cif, producto, tariff, consumo_anual, entidad, telefono, poblacion, direccion_fiscal, status, requested_at, requested_by, score, notes')
        .order('requested_at', { ascending: false }),

      supabase
        .from('contracts')
        .select('id, supply_id, client_id, status, signed_at, created_at, updated_at')
        .order('created_at', { ascending: false }),
    ])

    // Log any errors but continue (partial backup is better than nothing)
    if (eClients)     console.error('[backup] clients error',     eClients)
    if (eSupplies)    console.error('[backup] supplies error',    eSupplies)
    if (eInvoices)    console.error('[backup] invoices error',    eInvoices)
    if (ePrescorings) console.error('[backup] prescorings error', ePrescorings)
    if (eContracts)   console.error('[backup] contracts error',   eContracts)

    // 4. Build Excel workbook
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Voltis CRM'
    wb.created = new Date()

    // ── Sheet: Clientes ──────────────────────────────────────────────────
    {
      const ws = wb.addWorksheet('Clientes')
      ws.columns = [
        { header: 'ID',              key: 'id',             },
        { header: 'Nombre',          key: 'name',           },
        { header: 'CIF/NIF',         key: 'cif_nif_combined'},
        { header: 'Email',           key: 'email',          },
        { header: 'Teléfono',        key: 'phone',          },
        { header: 'Dirección Fiscal',key: 'fiscal_address', },
        { header: 'Dirección',       key: 'address',        },
        { header: 'Segmento',        key: 'segment',        },
        { header: 'Creado',          key: 'created_at',     },
        { header: 'Actualizado',     key: 'updated_at',     },
      ]
      ;(clients ?? []).forEach((c: any) => {
        ws.addRow({
          ...c,
          cif_nif_combined: c.cif || c.nif || c.cif_nif || '',
        })
      })
      styleHeader(ws, ws.columns.length)
      autoFitColumns(ws)
    }

    // ── Sheet: Suministros ───────────────────────────────────────────────
    {
      const ws = wb.addWorksheet('Suministros')
      ws.columns = [
        { header: 'ID',          key: 'id'         },
        { header: 'Cliente ID',  key: 'client_id'  },
        { header: 'CUPS',        key: 'cups'        },
        { header: 'Tarifa',      key: 'tariff'      },
        { header: 'Tipo',        key: 'type'        },
        { header: 'Dirección',   key: 'address'     },
        { header: 'Estado',      key: 'status'      },
        { header: 'P1 (kW)',     key: 'power_p1'    },
        { header: 'P2 (kW)',     key: 'power_p2'    },
        { header: 'P3 (kW)',     key: 'power_p3'    },
        { header: 'P4 (kW)',     key: 'power_p4'    },
        { header: 'P5 (kW)',     key: 'power_p5'    },
        { header: 'P6 (kW)',     key: 'power_p6'    },
        { header: 'Distribuidora', key: 'distributor'},
        { header: 'Creado',      key: 'created_at'  },
        { header: 'Actualizado', key: 'updated_at'  },
      ]
      ;(supplies ?? []).forEach((s: any) => ws.addRow(s))
      styleHeader(ws, ws.columns.length)
      autoFitColumns(ws)
    }

    // ── Sheet: Facturas ──────────────────────────────────────────────────
    {
      const ws = wb.addWorksheet('Facturas')
      ws.columns = [
        { header: 'ID',                  key: 'id'                  },
        { header: 'Suministro ID',        key: 'supply_id'           },
        { header: 'Inicio Período',       key: 'period_start'        },
        { header: 'Fin Período',          key: 'period_end'          },
        { header: 'Importe (€)',          key: 'total_amount'        },
        { header: 'Estado',               key: 'status'              },
        // ── campos de extracted_data ──
        { header: 'Titular',              key: 'holder_name'         },
        { header: 'CIF/NIF Titular',      key: 'holder_cif_nif'      },
        { header: 'CUPS',                 key: 'cups'                },
        { header: 'Comercializadora',     key: 'comercializadora'    },
        { header: 'Tarifa',               key: 'tariff'              },
        { header: 'Consumo Total (kWh)',  key: 'consumo_kwh'         },
        { header: 'P1 (kWh)',             key: 'consumo_p1'          },
        { header: 'P2 (kWh)',             key: 'consumo_p2'          },
        { header: 'P3 (kWh)',             key: 'consumo_p3'          },
        { header: 'Potencia P1 (kW)',     key: 'power_p1'            },
        { header: 'Potencia P2 (kW)',     key: 'power_p2'            },
        { header: 'Dirección Suministro', key: 'supply_address'      },
        { header: 'Días Facturados',      key: 'days'                },
        { header: 'Creado',               key: 'created_at'          },
      ]

      ;(invoices ?? []).forEach((inv: any) => {
        const ex: any = inv.extracted_data || {}
        const econ: any = ex.economics || {}
        const periods: any = ex.consumption_periods || ex.consumptionPeriods || {}
        const powers: any = ex.contracted_powers || ex.contractedPowers || {}

        ws.addRow({
          id:               inv.id,
          supply_id:        inv.supply_id,
          period_start:     inv.period_start,
          period_end:       inv.period_end,
          total_amount:     inv.total_amount,
          status:           inv.status,
          // extracted
          holder_name:      ex.holder_name      || ex.holderName      || '',
          holder_cif_nif:   ex.holder_cif_nif   || ex.holderCifNif    || '',
          cups:             ex.cups              || '',
          comercializadora: ex.comercializadora  || ex.supplier        || '',
          tariff:           ex.tariff            || ex.rate            || '',
          consumo_kwh:      econ.consumoTotalKwh || econ.totalKwh      || ex.total_kwh || '',
          consumo_p1:       periods.p1           || periods.P1         || '',
          consumo_p2:       periods.p2           || periods.P2         || '',
          consumo_p3:       periods.p3           || periods.P3         || '',
          power_p1:         powers.p1            || powers.P1          || '',
          power_p2:         powers.p2            || powers.P2          || '',
          supply_address:   ex.supply_address    || ex.supplyAddress   || ex.address || '',
          days:             ex.billing_days      || ex.billingDays     || ex.days     || '',
          created_at:       inv.created_at,
        })
      })

      styleHeader(ws, ws.columns.length)
      autoFitColumns(ws)
    }

    // ── Sheet: Prescoring ────────────────────────────────────────────────
    {
      const ws = wb.addWorksheet('Prescoring')
      ws.columns = [
        { header: 'ID',              key: 'id'              },
        { header: 'Suministro ID',   key: 'supply_id'       },
        { header: 'Cliente',         key: 'client_name'     },
        { header: 'CUPS',            key: 'cups'            },
        { header: 'CIF/NIF',         key: 'cif'             },
        { header: 'Producto',        key: 'producto'        },
        { header: 'Tarifa',          key: 'tariff'          },
        { header: 'Consumo Anual',   key: 'consumo_anual'   },
        { header: 'Entidad Actual',  key: 'entidad'         },
        { header: 'Teléfono',        key: 'telefono'        },
        { header: 'Población',       key: 'poblacion'       },
        { header: 'Dir. Fiscal',     key: 'direccion_fiscal'},
        { header: 'Estado',          key: 'status'          },
        { header: 'Score',           key: 'score'           },
        { header: 'Notas',           key: 'notes'           },
        { header: 'Solicitado',      key: 'requested_at'    },
        { header: 'Solicitado por',  key: 'requested_by'    },
      ]
      ;(prescorings ?? []).forEach((p: any) => ws.addRow(p))
      styleHeader(ws, ws.columns.length)
      autoFitColumns(ws)
    }

    // ── Sheet: Contratos ─────────────────────────────────────────────────
    {
      const ws = wb.addWorksheet('Contratos')
      ws.columns = [
        { header: 'ID',            key: 'id'         },
        { header: 'Suministro ID', key: 'supply_id'  },
        { header: 'Cliente ID',    key: 'client_id'  },
        { header: 'Estado',        key: 'status'     },
        { header: 'Firmado',       key: 'signed_at'  },
        { header: 'Creado',        key: 'created_at' },
        { header: 'Actualizado',   key: 'updated_at' },
      ]
      ;(contracts ?? []).forEach((c: any) => ws.addRow(c))
      styleHeader(ws, ws.columns.length)
      autoFitColumns(ws)
    }

    // ── Sheet: Resumen ───────────────────────────────────────────────────
    {
      const ws = wb.addWorksheet('Resumen')
      ws.getColumn(1).width = 28
      ws.getColumn(2).width = 16

      const title = ws.getCell('A1')
      title.value = `Backup Voltis CRM — ${today()}`
      title.font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' } }
      ws.mergeCells('A1:B1')

      const rows: [string, number][] = [
        ['Clientes',     (clients     ?? []).length],
        ['Suministros',  (supplies    ?? []).length],
        ['Facturas',     (invoices    ?? []).length],
        ['Prescorings',  (prescorings ?? []).length],
        ['Contratos',    (contracts   ?? []).length],
      ]

      rows.forEach(([label, count], i) => {
        const r = ws.getRow(i + 3)
        r.getCell(1).value = label
        r.getCell(2).value = count
        r.getCell(1).font = { bold: true }
        r.getCell(2).alignment = { horizontal: 'center' }
      })

      ws.getRow(2).height = 8 // spacer
    }

    // 5. Write workbook to buffer
    const buffer = await wb.xlsx.writeBuffer()

    // 6. Send via Resend
    const resend = new Resend(process.env.RESEND_API_KEY)
    const filename = `voltis-crm-backup-${isoNow()}.xlsx`

    const { error: emailError } = await resend.emails.send({
      from: 'Voltis CRM <facturacion@voltisenergia.com>',
      to: ['admin@voltisenergia.com'],
      subject: `📦 Backup CRM — ${today()}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="color:#1E3A5F;margin-bottom:8px">Backup diario — Voltis CRM</h2>
          <p style="color:#444;margin-bottom:16px">
            Se adjunta la copia de seguridad completa del CRM generada el <strong>${today()}</strong>.
          </p>
          <table style="border-collapse:collapse;width:100%;font-size:14px">
            <tr style="background:#1E3A5F;color:#fff">
              <th style="padding:8px 12px;text-align:left">Tabla</th>
              <th style="padding:8px 12px;text-align:right">Registros</th>
            </tr>
            ${[
              ['Clientes',    (clients     ?? []).length],
              ['Suministros', (supplies    ?? []).length],
              ['Facturas',    (invoices    ?? []).length],
              ['Prescorings', (prescorings ?? []).length],
              ['Contratos',   (contracts   ?? []).length],
            ].map(([label, count], i) =>
              `<tr style="background:${i % 2 === 0 ? '#f8f9fa' : '#fff'}">
                <td style="padding:7px 12px">${label}</td>
                <td style="padding:7px 12px;text-align:right"><strong>${count}</strong></td>
              </tr>`
            ).join('')}
          </table>
          <p style="color:#888;font-size:12px;margin-top:24px">
            Este email es generado automáticamente cada noche por Voltis CRM.
          </p>
        </div>
      `,
      attachments: [
        {
          filename,
          content: Buffer.from(buffer).toString('base64'),
        },
      ],
    })

    if (emailError) {
      console.error('[backup] Resend error', emailError)
      return NextResponse.json(
        { success: false, error: 'email_failed', detail: emailError },
        { status: 500 }
      )
    }

    console.log('[backup] Sent backup email', {
      filename,
      clients:     (clients     ?? []).length,
      supplies:    (supplies    ?? []).length,
      invoices:    (invoices    ?? []).length,
      prescorings: (prescorings ?? []).length,
      contracts:   (contracts   ?? []).length,
    })

    return NextResponse.json({
      success: true,
      filename,
      records: {
        clients:     (clients     ?? []).length,
        supplies:    (supplies    ?? []).length,
        invoices:    (invoices    ?? []).length,
        prescorings: (prescorings ?? []).length,
        contracts:   (contracts   ?? []).length,
      },
    })
  } catch (err: any) {
    console.error('[backup] Unexpected error', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'unknown' },
      { status: 500 }
    )
  }
}
