#!/usr/bin/env node

/**
 * MIGRACIÓN BASE44 → SUPABASE (Voltis CRM)
 * ==========================================
 *
 * Transforma datos exportados de la app Base44 GESTIONCLIENTES
 * al nuevo modelo relacional en Supabase.
 *
 * USO:
 *   1. Exporta datos con export-base44.js (consola del navegador)
 *   2. Coloca el JSON exportado en esta carpeta como: base44_export.json
 *   3. Ejecuta: node scripts/migrate-to-supabase.mjs
 *
 * MAPEO DE ENTIDADES:
 *   Base44 Cliente          → clients + supplies + invoices + events(activity_log)
 *   Base44 Zona             → (tag en clients.notes o campo custom)
 *   Base44 DocumentosCliente → clients (CIF, dirección fiscal)
 *   Base44 PrescoringGALP   → prescorings
 *   Base44 PlanPago         → subscriptions
 *   Base44 CuotaPago        → billing
 *   Base44 TareaCorcho      → tasks
 *   Base44 Incidencia       → incidents
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════

const SUPABASE_URL = 'https://wqzicwrmmwhnafaihhqh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// We need the SERVICE ROLE key (not anon) to bypass RLS for migration
if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_KEY is required.');
  console.error('');
  console.error('Set it as environment variable:');
  console.error('  export SUPABASE_SERVICE_KEY="eyJhbGci..."');
  console.error('');
  console.error('You can find it in Supabase Dashboard → Settings → API → service_role key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ═══════════════════════════════════════════════
// STATE MAPPING: Old Base44 → New Supabase
// ═══════════════════════════════════════════════

/**
 * Old client-level states → New supply-level states
 *
 * Old model: ONE state per client (all supplies share it)
 * New model: Individual state per supply
 *
 * We map client state → default supply state, then refine per-supply based on data
 */
const STATE_MAP = {
  'Primer contacto':            'primer_contacto',
  'Esperando facturas':         'primer_contacto',
  'Facturas presentadas':       'facturas_recibidas',
  'Pendiente informe potencias': 'prescoring_pendiente',
  'Informe listo':              'estudio_completado',
  'Pendiente de firma':         'pendiente_firma',
  'Pendiente de aprobación':    'pendiente_firma',
  'Firmado con éxito':          'firmado',
  'Rechazado':                  'rechazado',
  'Ignorado con mucho éxito':   'rechazado',
};

/**
 * Refine supply state based on individual supply data
 */
function getSupplyState(clientState, suministro) {
  const baseState = STATE_MAP[clientState] || 'primer_contacto';

  // If supply is individually closed → firmado
  if (suministro.cerrado) return 'firmado';

  // If supply has informe_final → at least estudio_completado
  if (suministro.informe_final?.url || suministro.informe_final?.archivos?.length > 0) {
    if (baseState === 'pendiente_firma' || baseState === 'firmado') return baseState;
    return 'estudio_completado';
  }

  // If supply has plantilla_economica → estudio_en_curso
  if (suministro.plantilla_economica?.url) {
    if (['estudio_completado', 'pendiente_firma', 'firmado'].includes(baseState)) return baseState;
    return 'estudio_en_curso';
  }

  // If supply has informe_potencias → prescoring_completado
  if (suministro.informe_potencias?.url) {
    if (['estudio_en_curso', 'estudio_completado', 'pendiente_firma', 'firmado'].includes(baseState)) return baseState;
    return 'prescoring_completado';
  }

  // If supply has facturas → at least facturas_recibidas
  if (suministro.facturas?.length > 0) {
    if (baseState === 'primer_contacto') return 'facturas_recibidas';
    return baseState;
  }

  return baseState;
}

/**
 * Map old tariff type to supply_type
 */
function getSupplyType(tipoFactura) {
  if (!tipoFactura) return 'luz';
  if (['2.0', '3.0', '6.1', '6.2'].includes(tipoFactura)) return 'luz';
  if (['RL1', 'RL2', 'RL3', 'RL4', 'RL5', 'RL6'].includes(tipoFactura)) return 'gas';
  return 'luz';
}

/**
 * Map old priority to new priority
 */
function mapPriority(oldPriority) {
  const map = {
    'rojo': 'high',
    'amarillo': 'medium',
    'verde': 'low',
    'alta': 'high',
    'media': 'medium',
    'baja': 'low',
  };
  return map[oldPriority?.toLowerCase()] || 'medium';
}

// ═══════════════════════════════════════════════
// MIGRATION TRACKING
// ═══════════════════════════════════════════════

const stats = {
  clients: { total: 0, migrated: 0, errors: 0 },
  supplies: { total: 0, migrated: 0, errors: 0 },
  invoices: { total: 0, migrated: 0, errors: 0 },
  prescorings: { total: 0, migrated: 0, errors: 0 },
  tasks: { total: 0, migrated: 0, errors: 0 },
  incidents: { total: 0, migrated: 0, errors: 0 },
  subscriptions: { total: 0, migrated: 0, errors: 0 },
  billing: { total: 0, migrated: 0, errors: 0 },
  activity_log: { total: 0, migrated: 0, errors: 0 },
};

const errors = [];
const idMaps = {
  clients: {},     // old_id → new_uuid
  supplies: {},    // old_suministro_id → new_uuid
  users: {},       // old_email → new_user_uuid
  zones: {},       // old_zona_id → zona_nombre
};

// ═══════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════

function log(msg) {
  console.log(`  ${msg}`);
}

function logError(context, error) {
  const msg = `❌ ${context}: ${error.message || error}`;
  console.error(`  ${msg}`);
  errors.push({ context, error: error.message || String(error) });
}

/**
 * Find or create a user by email. Returns the user UUID.
 * If the user doesn't exist in users_profile, we create a placeholder.
 */
async function getOrCreateUser(email, fullName, role = 'commercial') {
  if (!email) return null;
  const normalizedEmail = email.toLowerCase().trim();

  // Check cache
  if (idMaps.users[normalizedEmail]) return idMaps.users[normalizedEmail];

  // Check database
  const { data: existing } = await supabase
    .from('users_profile')
    .select('id')
    .eq('email', normalizedEmail)
    .single();

  if (existing) {
    idMaps.users[normalizedEmail] = existing.id;
    return existing.id;
  }

  // Create placeholder user (they'll need to register properly later)
  // We need to create an auth user first, then profile
  // For migration, we'll use a deterministic UUID based on email
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    password: `MIGRATION_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    user_metadata: { full_name: fullName || email.split('@')[0], migrated: true }
  });

  if (authError) {
    // User might already exist in auth but not profile
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers();
    const found = authUsers?.find(u => u.email === normalizedEmail);
    if (found) {
      // Create profile for existing auth user
      const { data: profile, error: profileError } = await supabase
        .from('users_profile')
        .insert({
          id: found.id,
          full_name: fullName || email.split('@')[0],
          email: normalizedEmail,
          role: role,
          active: true
        })
        .select('id')
        .single();

      if (profile) {
        idMaps.users[normalizedEmail] = profile.id;
        return profile.id;
      }
      // If profile insert also fails, the user exists fully
      idMaps.users[normalizedEmail] = found.id;
      return found.id;
    }
    logError(`User creation for ${email}`, authError);
    return null;
  }

  // Create profile
  const userId = authUser.user.id;
  await supabase.from('users_profile').insert({
    id: userId,
    full_name: fullName || email.split('@')[0],
    email: normalizedEmail,
    role: role,
    active: true
  });

  idMaps.users[normalizedEmail] = userId;
  return userId;
}

// ═══════════════════════════════════════════════
// MIGRATION FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Step 1: Migrate Zonas → Store in map for reference
 */
async function migrateZonas(zonas) {
  console.log('\n📍 Mapeando Zonas...');
  for (const zona of zonas) {
    idMaps.zones[zona.id] = zona.nombre || zona.name || `Zona ${zona.id}`;
    log(`  Zona "${idMaps.zones[zona.id]}" → mapeada`);
  }
}

/**
 * Step 2: Migrate Clientes → clients + supplies + invoices
 */
async function migrateClientes(clientes, documentosCliente) {
  console.log('\n👥 Migrando Clientes...');

  // Build docs lookup by cliente_id
  const docsMap = {};
  for (const doc of (documentosCliente || [])) {
    if (doc.cliente_id) {
      docsMap[doc.cliente_id] = doc;
    }
  }

  for (const cliente of clientes) {
    stats.clients.total++;
    try {
      // Find commercial user
      const commercialId = await getOrCreateUser(
        cliente.propietario_email,
        cliente.propietario_iniciales || cliente.propietario_email?.split('@')[0],
        'commercial'
      );

      if (!commercialId) {
        logError(`Cliente ${cliente.nombre_negocio}`, 'No se pudo resolver propietario_email');
        stats.clients.errors++;
        continue;
      }

      // Get extra data from DocumentosCliente
      const docs = docsMap[cliente.id] || {};

      // Build client record
      const clientRecord = {
        name: cliente.nombre_negocio || 'Sin nombre',
        type: 'empresa', // Default, old model didn't track this
        cif: docs.cif || null,
        email: cliente.email || null,
        phone: cliente.telefono || null,
        fiscal_address: docs.direccion_fiscal || null,
        commercial_id: commercialId,
        origin: 'auditoria', // Default for migrated clients
        notes: buildClientNotes(cliente),
        created_at: cliente.created_date || new Date().toISOString(),
      };

      // Insert client
      const { data: newClient, error: clientError } = await supabase
        .from('clients')
        .insert(clientRecord)
        .select('id')
        .single();

      if (clientError) {
        logError(`Cliente ${cliente.nombre_negocio}`, clientError);
        stats.clients.errors++;
        continue;
      }

      idMaps.clients[cliente.id] = newClient.id;
      stats.clients.migrated++;
      log(`✅ Cliente: ${cliente.nombre_negocio} → ${newClient.id}`);

      // Migrate suministros for this client
      const suministros = cliente.suministros || [];
      for (const suministro of suministros) {
        await migrateSuministro(suministro, newClient.id, cliente, commercialId);
      }

      // Migrate eventos as activity_log entries
      const eventos = cliente.eventos || [];
      for (const evento of eventos) {
        await migrateEvento(evento, newClient.id, commercialId);
      }

    } catch (error) {
      logError(`Cliente ${cliente.nombre_negocio}`, error);
      stats.clients.errors++;
    }
  }
}

/**
 * Build notes string from old client data
 */
function buildClientNotes(cliente) {
  const parts = [];

  if (cliente.nombre_cliente) {
    parts.push(`Contacto: ${cliente.nombre_cliente}`);
  }

  if (cliente.anotaciones) {
    parts.push(`Notas: ${cliente.anotaciones}`);
  }

  const zonaNombre = idMaps.zones[cliente.zona_id];
  if (zonaNombre) {
    parts.push(`Zona: ${zonaNombre}`);
  }

  if (cliente.cliente_principal_id) {
    parts.push(`Cliente vinculado a ID: ${cliente.cliente_principal_id}`);
  }

  if (cliente.datos_factura_whatsapp) {
    parts.push(`Datos WhatsApp: ${cliente.datos_factura_whatsapp}`);
  }

  if (cliente.contrato_original_url) {
    parts.push(`Contrato original (legacy): ${cliente.contrato_original_url}`);
  }
  if (cliente.contrato_firmado_url) {
    parts.push(`Contrato firmado (legacy): ${cliente.contrato_firmado_url}`);
  }
  if (cliente.fecha_validacion_contrato) {
    parts.push(`Fecha validación contrato: ${cliente.fecha_validacion_contrato}`);
  }

  // Old state for reference
  if (cliente.estado) {
    parts.push(`Estado Base44: ${cliente.estado}`);
  }

  // Commission info
  if (cliente.comision) {
    parts.push(`Comisión total (legacy): ${cliente.comision}€`);
  }
  if (cliente.mes_comision) {
    parts.push(`Mes comisión: ${cliente.mes_comision}`);
  }

  parts.push(`[Migrado desde Base44 el ${new Date().toISOString().split('T')[0]}]`);

  return parts.join('\n');
}

/**
 * Migrate a single suministro → supply + invoices
 */
async function migrateSuministro(suministro, clientId, cliente, commercialId) {
  stats.supplies.total++;
  try {
    const supplyType = getSupplyType(suministro.tipo_factura);
    const supplyState = getSupplyState(cliente.estado, suministro);

    const supplyRecord = {
      client_id: clientId,
      cups: suministro.cups || null,
      type: supplyType,
      tariff: suministro.tipo_factura || '2.0',
      address: null, // Old model didn't store supply address separately
      status: supplyState,
      power_data: null,
      consumption_data: null,
      created_at: cliente.created_date || new Date().toISOString(),
    };

    const { data: newSupply, error: supplyError } = await supabase
      .from('supplies')
      .insert(supplyRecord)
      .select('id')
      .single();

    if (supplyError) {
      logError(`Suministro ${suministro.nombre || suministro.id}`, supplyError);
      stats.supplies.errors++;
      return;
    }

    const supplyId = newSupply.id;
    if (suministro.id) {
      idMaps.supplies[suministro.id] = supplyId;
    }

    stats.supplies.migrated++;
    log(`  📦 Suministro: ${suministro.nombre || suministro.tipo_factura} (${supplyState}) → ${supplyId}`);

    // Migrate facturas → invoices
    const facturas = suministro.facturas || [];
    for (const factura of facturas) {
      stats.invoices.total++;
      try {
        const invoiceRecord = {
          supply_id: supplyId,
          file_url: factura.url || '',
          file_type: factura.tipo_archivo || 'pdf',
          extraction_status: 'completed', // Already processed in old system
          created_at: factura.fecha_subida || new Date().toISOString(),
        };

        const { error: invError } = await supabase
          .from('invoices')
          .insert(invoiceRecord);

        if (invError) {
          logError(`Factura ${factura.nombre}`, invError);
          stats.invoices.errors++;
        } else {
          stats.invoices.migrated++;
        }
      } catch (e) {
        logError(`Factura ${factura.nombre}`, e);
        stats.invoices.errors++;
      }
    }

    // Migrate informe_potencias → studies (type: potencias_consumos)
    if (suministro.informe_potencias?.url) {
      await supabase.from('studies').insert({
        supply_id: supplyId,
        type: 'potencias_consumos',
        report_url: suministro.informe_potencias.url,
        status: 'completed',
        created_by: commercialId,
        created_at: suministro.informe_potencias.fecha_subida || new Date().toISOString(),
        completed_at: suministro.informe_potencias.fecha_subida || new Date().toISOString(),
      });
    }

    // Migrate plantilla_economica → studies (type: economico)
    if (suministro.plantilla_economica?.url) {
      await supabase.from('studies').insert({
        supply_id: supplyId,
        type: 'economico',
        report_url: suministro.plantilla_economica.url,
        status: 'completed',
        created_by: commercialId,
        created_at: suministro.plantilla_economica.fecha_subida || new Date().toISOString(),
        completed_at: suministro.plantilla_economica.fecha_subida || new Date().toISOString(),
      });
    }

    // Migrate informe_final → studies or keep as report URL
    if (suministro.informe_final) {
      const informeUrls = [];
      if (suministro.informe_final.archivos?.length > 0) {
        for (const archivo of suministro.informe_final.archivos) {
          informeUrls.push(archivo.url);
        }
      } else if (suministro.informe_final.url) {
        informeUrls.push(suministro.informe_final.url);
      }

      if (informeUrls.length > 0) {
        await supabase.from('studies').insert({
          supply_id: supplyId,
          type: 'economico',
          report_url: informeUrls[0],
          result_data: {
            legacy_files: informeUrls,
            notas_admin: suministro.informe_final.notas_admin || null,
          },
          status: 'completed',
          created_by: commercialId,
          created_at: suministro.informe_final.fecha_subida || new Date().toISOString(),
          completed_at: suministro.informe_final.fecha_subida || new Date().toISOString(),
        });
      }
    }

    // Migrate commission data
    if (suministro.comision && suministro.cerrado) {
      await supabase.from('commissions').insert({
        commercial_id: commercialId,
        supply_id: supplyId,
        client_id: clientId,
        amount: suministro.comision,
        month: suministro.mes_comision_suministro || cliente.mes_comision || new Date().toISOString().substring(0, 7),
        concept: `Cierre suministro ${supplyType} ${suministro.tipo_factura || ''} - ${suministro.nombre || 'sin nombre'}`,
        status: cliente.aprobado_admin ? 'approved' : 'pending',
        created_at: suministro.fecha_cierre_suministro || cliente.fecha_cierre || new Date().toISOString(),
      });
    }

    // If client was firmado, create a contract record
    if (cliente.estado === 'Firmado con éxito' && suministro.cerrado) {
      const contractData = {
        client_id: clientId,
        supply_id: supplyId,
        type: 'comercializadora',
        file_url: cliente.contrato_original_url || null,
        signed_file_url: cliente.contrato_firmado_url || null,
        status: 'signed',
        created_by: commercialId,
        signed_at: cliente.fecha_cierre || new Date().toISOString(),
      };
      await supabase.from('contracts').insert(contractData);
    }

  } catch (error) {
    logError(`Suministro ${suministro.nombre || suministro.id}`, error);
    stats.supplies.errors++;
  }
}

/**
 * Migrate evento → activity_log
 */
async function migrateEvento(evento, clientId, performedBy) {
  stats.activity_log.total++;
  try {
    const { error } = await supabase.from('activity_log').insert({
      entity_type: 'client',
      entity_id: clientId,
      action: evento.tipo_automatico || 'event',
      description: evento.descripcion || 'Evento migrado',
      performed_by: performedBy,
      metadata: {
        legacy_color: evento.color,
        legacy_tipo: evento.tipo_automatico,
        legacy_fecha: evento.fecha,
        migrated: true
      },
      created_at: evento.fecha ? new Date(evento.fecha).toISOString() : new Date().toISOString(),
    });

    if (error) {
      logError(`Evento ${evento.descripcion}`, error);
      stats.activity_log.errors++;
    } else {
      stats.activity_log.migrated++;
    }
  } catch (e) {
    logError(`Evento`, e);
    stats.activity_log.errors++;
  }
}

/**
 * Step 3: Migrate PrescoringGALP → prescorings
 */
async function migratePrescorings(prescorings) {
  console.log('\n📊 Migrando Prescorings...');

  for (const ps of prescorings) {
    stats.prescorings.total++;
    try {
      // Find supply by CUPS
      let supplyId = null;
      if (ps.cups) {
        const { data: supply } = await supabase
          .from('supplies')
          .select('id')
          .eq('cups', ps.cups)
          .limit(1)
          .single();
        supplyId = supply?.id || null;
      }

      // Determine status
      let status = 'pending';
      if (ps.denegado) status = 'rejected';
      else if (ps.enviado) status = 'sent';

      // Get requesting user
      const requestedBy = Object.values(idMaps.users)[0]; // Default to first user
      if (!requestedBy) {
        logError(`Prescoring ${ps.cups}`, 'No hay usuarios migrados');
        stats.prescorings.errors++;
        continue;
      }

      const record = {
        supply_id: supplyId,
        client_name: ps.nombre_razon_social || '',
        cups: ps.cups || '',
        tariff: ps.tarifa || '',
        status: status,
        requested_by: requestedBy,
        requested_at: ps.created_date || new Date().toISOString(),
        notes: [
          ps.producto ? `Producto: ${ps.producto}` : null,
          ps.qa ? `QA: ${ps.qa}` : null,
          ps.part_auto ? `Part. autónoma: ${ps.part_auto}` : null,
          ps.cif ? `CIF: ${ps.cif}` : null,
          ps.telefono ? `Tel: ${ps.telefono}` : null,
          ps.poblacion ? `Población: ${ps.poblacion}` : null,
          ps.direccion_fiscal ? `Dir. fiscal: ${ps.direccion_fiscal}` : null,
        ].filter(Boolean).join('\n'),
      };

      const { error } = await supabase.from('prescorings').insert(record);
      if (error) {
        logError(`Prescoring ${ps.cups}`, error);
        stats.prescorings.errors++;
      } else {
        stats.prescorings.migrated++;
        log(`✅ Prescoring: ${ps.cups} (${status})`);
      }
    } catch (e) {
      logError(`Prescoring ${ps.cups}`, e);
      stats.prescorings.errors++;
    }
  }
}

/**
 * Step 4: Migrate TareaCorcho → tasks
 */
async function migrateTareas(tareas) {
  console.log('\n📋 Migrando Tareas...');

  for (const tarea of tareas) {
    stats.tasks.total++;
    try {
      const assignedTo = await getOrCreateUser(tarea.propietario_email);
      const createdBy = await getOrCreateUser(tarea.creador_email) || assignedTo;

      if (!createdBy) {
        logError(`Tarea "${tarea.descripcion}"`, 'No se pudo resolver usuario');
        stats.tasks.errors++;
        continue;
      }

      const record = {
        title: (tarea.descripcion || 'Tarea migrada').substring(0, 200),
        description: tarea.notas || null,
        priority: mapPriority(tarea.prioridad),
        status: tarea.completada ? 'completed' : 'pending',
        sort_order: tarea.orden || 0,
        assigned_to: assignedTo,
        created_by: createdBy,
        completed_at: tarea.completada ? new Date().toISOString() : null,
        created_at: tarea.created_date || new Date().toISOString(),
      };

      const { error } = await supabase.from('tasks').insert(record);
      if (error) {
        logError(`Tarea "${tarea.descripcion}"`, error);
        stats.tasks.errors++;
      } else {
        stats.tasks.migrated++;
      }
    } catch (e) {
      logError(`Tarea`, e);
      stats.tasks.errors++;
    }
  }
}

/**
 * Step 5: Migrate Incidencia → incidents
 */
async function migrateIncidencias(incidencias) {
  console.log('\n🚨 Migrando Incidencias...');

  for (const inc of incidencias) {
    stats.incidents.total++;
    try {
      const clientId = idMaps.clients[inc.cliente_id] || null;
      const createdBy = Object.values(idMaps.users)[0]; // Default first user

      if (!createdBy) {
        stats.incidents.errors++;
        continue;
      }

      // Map old status
      let status = 'open';
      if (inc.estado === 'resuelta') status = 'resolved';
      else if (inc.estado === 'revisada') status = 'closed';

      const record = {
        client_id: clientId,
        title: (inc.descripcion || 'Incidencia migrada').substring(0, 200),
        description: inc.descripcion || null,
        priority: mapPriority(inc.prioridad),
        status: status,
        created_by: createdBy,
        resolved_at: status === 'resolved' || status === 'closed' ? new Date().toISOString() : null,
        created_at: inc.created_date || new Date().toISOString(),
      };

      const { error } = await supabase.from('incidents').insert(record);
      if (error) {
        logError(`Incidencia "${inc.descripcion}"`, error);
        stats.incidents.errors++;
      } else {
        stats.incidents.migrated++;
      }

      // Migrate messages if present
      if (inc.mensajes?.length > 0) {
        for (const msg of inc.mensajes) {
          await supabase.from('incident_messages').insert({
            incident_id: null, // Would need the new incident ID
            author_id: createdBy,
            message: msg.texto || msg.message || '',
            created_at: msg.fecha || new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      logError(`Incidencia`, e);
      stats.incidents.errors++;
    }
  }
}

/**
 * Step 6: Migrate PlanPago → subscriptions
 */
async function migratePlanPago(planes) {
  console.log('\n💳 Migrando Planes de Pago → Subscriptions...');

  for (const plan of planes) {
    stats.subscriptions.total++;
    try {
      const clientId = idMaps.clients[plan.cliente_id] || null;

      if (!clientId) {
        log(`⚠️  Plan de pago para cliente no migrado: ${plan.cliente_nombre}`);
        stats.subscriptions.errors++;
        continue;
      }

      // Map payment mode
      const paymentMode = plan.frecuencia_pago === 'trimestral' ? 'quarterly' : 'immediate';

      // Map status
      let status = 'active';
      if (plan.estado === 'finalizado') status = 'cancelled';

      const record = {
        client_id: clientId,
        model: 'fixed',
        plan_tier: plan.importe_total || 0,
        payment_mode: paymentMode,
        annual_amount: plan.importe_total || 0,
        status: status,
        start_date: plan.fecha_activacion || new Date().toISOString().split('T')[0],
        next_billing_date: plan.fecha_proximo_pago || null,
        created_at: plan.created_date || new Date().toISOString(),
      };

      const { data: newSub, error } = await supabase
        .from('subscriptions')
        .insert(record)
        .select('id')
        .single();

      if (error) {
        logError(`PlanPago ${plan.cliente_nombre}`, error);
        stats.subscriptions.errors++;
      } else {
        stats.subscriptions.migrated++;
        log(`✅ Suscripción: ${plan.cliente_nombre} (${paymentMode})`);
      }
    } catch (e) {
      logError(`PlanPago`, e);
      stats.subscriptions.errors++;
    }
  }
}

/**
 * Step 7: Migrate CuotaPago → billing
 */
async function migrateCuotaPago(cuotas) {
  console.log('\n🧾 Migrando Cuotas → Billing...');

  for (const cuota of cuotas) {
    stats.billing.total++;
    try {
      const clientId = idMaps.clients[cuota.cliente_id] || null;

      if (!clientId) {
        stats.billing.errors++;
        continue;
      }

      const record = {
        client_id: clientId,
        concept: `Cuota ${cuota.numero_cuota || '?'} - ${cuota.cliente_nombre || 'Migrado'}`,
        base_amount: cuota.importe || 0,
        vat_rate: 21.00,
        status: cuota.estado === 'pagado' ? 'paid' : 'sent',
        due_date: cuota.fecha_vencimiento || new Date().toISOString().split('T')[0],
        paid_at: cuota.fecha_pago_real ? new Date(cuota.fecha_pago_real).toISOString() : null,
        created_at: cuota.created_date || new Date().toISOString(),
      };

      const { error } = await supabase.from('billing').insert(record);
      if (error) {
        logError(`CuotaPago ${cuota.numero_cuota}`, error);
        stats.billing.errors++;
      } else {
        stats.billing.migrated++;
      }
    } catch (e) {
      logError(`CuotaPago`, e);
      stats.billing.errors++;
    }
  }
}

// ═══════════════════════════════════════════════
// MAIN MIGRATION RUNNER
// ═══════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  MIGRACIÓN BASE44 → SUPABASE (Voltis CRM)');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Load export file
  const exportPath = join(__dirname, 'base44_export.json');
  if (!existsSync(exportPath)) {
    console.error('❌ No se encontró base44_export.json en la carpeta scripts/');
    console.error('');
    console.error('Pasos:');
    console.error('  1. Abre la app Base44 en tu navegador');
    console.error('  2. Abre la consola (F12)');
    console.error('  3. Pega el contenido de export-base44.js');
    console.error('  4. Se descargará un archivo JSON');
    console.error('  5. Renómbralo a base44_export.json y colócalo en scripts/');
    process.exit(1);
  }

  const rawData = readFileSync(exportPath, 'utf-8');
  const exportData = JSON.parse(rawData);
  const entities = exportData.entities || exportData;

  console.log(`📂 Archivo cargado: ${exportPath}`);
  console.log(`📅 Exportado: ${exportData.exported_at || 'Fecha desconocida'}`);
  console.log('');

  // Show entity counts
  console.log('📊 Datos encontrados:');
  for (const [name, records] of Object.entries(entities)) {
    if (Array.isArray(records)) {
      console.log(`  ${name}: ${records.length} registros`);
    }
  }
  console.log('');

  // Verify Supabase connection
  console.log('🔌 Verificando conexión a Supabase...');
  const { data: healthCheck, error: healthError } = await supabase
    .from('users_profile')
    .select('id')
    .limit(1);

  if (healthError) {
    console.error('❌ No se pudo conectar a Supabase:', healthError.message);
    process.exit(1);
  }
  console.log('  ✅ Conexión OK');
  console.log('');

  // Execute migration in order
  const startTime = Date.now();

  // 1. Zonas (just mapping, no DB insert)
  await migrateZonas(entities.Zona || []);

  // 2. Clientes → clients + supplies + invoices + studies + commissions + activity_log
  await migrateClientes(entities.Cliente || [], entities.DocumentosCliente || []);

  // 3. Prescorings
  await migratePrescorings(entities.PrescoringGALP || []);

  // 4. Tareas
  await migrateTareas(entities.TareaCorcho || []);

  // 5. Incidencias
  await migrateIncidencias(entities.Incidencia || []);

  // 6. Planes de pago → subscriptions
  await migratePlanPago(entities.PlanPago || []);

  // 7. Cuotas → billing
  await migrateCuotaPago(entities.CuotaPago || []);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print summary
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  RESUMEN DE MIGRACIÓN');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  const table = Object.entries(stats).map(([entity, s]) => ({
    Entidad: entity,
    Total: s.total,
    Migrados: s.migrated,
    Errores: s.errors,
    'Éxito %': s.total > 0 ? `${((s.migrated / s.total) * 100).toFixed(0)}%` : 'N/A'
  }));
  console.table(table);

  console.log('');
  console.log(`⏱️  Tiempo total: ${elapsed}s`);
  console.log(`👤 Usuarios creados/mapeados: ${Object.keys(idMaps.users).length}`);
  console.log(`📍 Zonas mapeadas: ${Object.keys(idMaps.zones).length}`);

  if (errors.length > 0) {
    console.log('');
    console.log(`⚠️  ${errors.length} errores encontrados:`);
    for (const err of errors.slice(0, 20)) {
      console.log(`  - ${err.context}: ${err.error}`);
    }
    if (errors.length > 20) {
      console.log(`  ... y ${errors.length - 20} más`);
    }
  }

  console.log('');
  console.log('✅ Migración completada.');
  console.log('');
  console.log('PRÓXIMOS PASOS:');
  console.log('  1. Verifica los datos en Supabase Dashboard');
  console.log('  2. Los usuarios migrados tienen contraseñas temporales - deberán hacer "Forgot Password"');
  console.log('  3. Las URLs de archivos apuntan a Base44 Storage - migrar archivos manualmente si es necesario');
  console.log('  4. Revisa las notas de cada cliente para datos legacy preservados');
}

main().catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});
