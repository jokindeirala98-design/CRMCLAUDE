import { NextRequest, NextResponse } from 'next/server'
import type { CRMContext } from '@/app/api/crm-context/route'

/**
 * POST /api/smart-command
 *
 * Context-aware CRM command interpreter powered by Gemini AI.
 * Receives full CRM context (clients, users, statuses, counts) so the AI
 * can make intelligent decisions, reference real data, and execute accurately.
 *
 * Supports 30+ action types for comprehensive CRM automation.
 */

export type SmartAction =
  | 'create_client'
  | 'create_supply'
  | 'edit_client'
  | 'edit_supply'
  | 'delete_client'
  | 'delete_supply'
  | 'assign_commercial'
  | 'merge_clients'
  | 'move_supply'
  | 'attach_documents'
  | 'add_to_supply'
  | 'query_data'
  | 'navigate'
  | 'update_supply_status'
  | 'create_task'
  | 'complete_task'
  | 'create_incident'
  | 'close_incident'
  | 'create_appointment'
  | 'cancel_appointment'
  | 'generate_report'
  | 'generate_contract'
  | 'mark_contract_signed'
  | 'contact_client'
  | 'import_data'
  | 'export_data'
  | 'bulk_update'
  | 'analytics'
  | 'activate_subscription'
  | 'search_client'
  | 'search_supply'
  | 'reanalyze_invoice'
  | 'needs_clarification'
  | 'unknown'

export interface ClarificationQuestion {
  id: string
  question: string
  options?: string[]
}

export interface SmartCommandResult {
  action: SmartAction
  confidence: number
  raw_interpretation?: string

  // Client-related
  client_search?: string
  client_name?: string
  client_id?: string

  // Supply-related
  supply_search?: string
  cups?: string
  new_status?: string

  // Navigation
  navigate_to?: 'client_detail' | 'supply_detail' | 'client_edit' | 'supply_edit'

  // Edit fields
  field_name?: string
  field_value?: string

  // Contact
  contact_method?: 'email' | 'whatsapp' | 'call' | 'sms'
  message_content?: string

  // Export/Import
  export_format?: 'excel' | 'csv'

  // Analytics
  analytics_type?: 'pipeline' | 'ranking' | 'summary' | 'stale' | 'expiring'
  time_range?: 'today' | 'week' | 'month' | 'quarter' | 'year'

  // Task-related
  assignee_search?: string
  assignee_id?: string
  task_title?: string
  task_description?: string
  task_priority?: 'high' | 'medium' | 'low'
  task_search?: string

  // Incident-related
  incident_title?: string
  incident_description?: string
  incident_priority?: 'high' | 'medium' | 'low'
  incident_search?: string

  // Appointment-related
  appointment_type?: 'presentation' | 'followup' | 'signing' | 'other'
  appointment_date?: string
  appointment_notes?: string

  // Document-related
  doc_hint?: 'invoice' | 'cif' | 'nif' | 'bank_certificate' | 'contract' | null

  // Query-related
  query_type?: 'count' | 'list' | 'status' | 'detail' | 'summary'
  query_entity?: 'clients' | 'supplies' | 'invoices' | 'contracts' | 'prescorings' | 'appointments' | 'incidents' | 'tasks' | 'subscriptions'
  query_filters?: Record<string, string>
  query_field?: string
  query_sql_hint?: string

  // Report-related
  report_type?: 'economico' | 'potencias_consumos'

  // Target for move/merge
  target_client_search?: string

  // Contract
  contract_action?: 'generate' | 'view' | 'mark_signed' | 'send'

  // Bulk
  bulk_entity?: 'clients' | 'supplies'
  bulk_ids?: string[]

  // Clarification
  clarification_questions?: ClarificationQuestion[]
  clarification_context?: string
}

function buildGeminiPrompt(crmContext?: CRMContext): string {
  let contextBlock = ''

  if (crmContext) {
    const statusLines = Object.entries(crmContext.supply_counts_by_status)
      .map(([status, count]) => `  ${status.replace(/_/g, ' ')}: ${count}`)
      .join('\n')

    const userLines = crmContext.users
      .map(u => `  - ${u.full_name} (${u.role}) [id: ${u.id.slice(0, 8)}...] email: ${u.email}`)
      .join('\n')

    const clientSample = crmContext.client_names.slice(0, 60).join(', ')
    const comercializadoras = crmContext.comercializadoras.join(', ')

    const recentSupplyLines = crmContext.recent_supplies.slice(0, 10)
      .map(s => `  - ${s.client_name} | CUPS: ${s.cups} | ${s.type} | ${s.status.replace(/_/g, ' ')}`)
      .join('\n')

    contextBlock = `
=== LIVE CRM DATA (use this to resolve names, IDs, and answer queries) ===

TEAM USERS:
${userLines}

STATS:
- Total clients: ${crmContext.total_clients}
- Total supplies: ${crmContext.total_supplies}
- Total invoices: ${crmContext.total_invoices}
- Total prescorings: ${crmContext.total_prescorings} (${crmContext.pending_prescorings} pending)
- Open incidents: ${crmContext.open_incidents}
- Pending tasks: ${crmContext.pending_tasks}
- Active subscriptions: ${crmContext.active_subscriptions}

SUPPLY PIPELINE:
${statusLines}

KNOWN CLIENT NAMES (sample):
${clientSample}

RECENT SUPPLY ACTIVITY:
${recentSupplyLines}

COMERCIALIZADORAS: ${comercializadoras}
=== END CRM DATA ===
`
  }

  return `You are the intelligent command center of "Voltis Energia" CRM — a Spanish energy consultancy.
You are an expert administrative assistant who knows the ENTIRE application, all its data, clients, users, supply pipeline, invoices, and business processes.

The user types commands in natural language (Spanish). You must interpret and return ONLY valid JSON (no markdown, no code fences).
${contextBlock}

AVAILABLE ACTIONS (30+ action types):

CLIENT MANAGEMENT:
1. "create_client" — Create a new client. E.g., "crea cliente", "nuevo cliente", "dar de alta"
2. "edit_client" — Edit client fields (phone, email, fiscal_address, etc.). E.g., "cambia el telefono de Jose a 666123456", "actualiza email de Marina a email@example.com"
3. "delete_client" — Delete a client. E.g., "elimina cliente X", "borra cliente Y"
4. "search_client" — Find/look up a client. E.g., "busca cliente Marina", "quien es cliente XYZ"
5. "merge_clients" — Merge two clients. E.g., "fusiona cliente A con cliente B", "une Cliente X y Cliente Y"
6. "contact_client" — Contact client via email/whatsapp/call/sms. E.g., "envia email a X", "whatsapp a Jose", "llama a Marina", "sms a Cliente"

SUPPLY MANAGEMENT:
7. "create_supply" — Create NEW supply/suministro(s) for an EXISTING client. E.g., "nuevo suministro para X", "suministro de cliente Y", "crear suministro para Bar Marina"
8. "edit_supply" — Edit supply fields (tariff, CUPS, type, etc.). E.g., "cambia la tarifa del suministro a 3.0", "actualiza CUPS de X a ES00..."
9. "delete_supply" — Delete a supply. E.g., "elimina suministro de X", "borra suministro CUPS..."
10. "move_supply" — Move supply to another client. E.g., "mueve suministro de A a B", "pasa suministro a cliente Y"
11. "add_to_supply" — Add documents to EXISTING supply. E.g., "anade al suministro existente", "añade al suministro de X"
12. "search_supply" — Find/search a supply. E.g., "busca CUPS ES0021...", "encuentra suministro de X"
13. "update_supply_status" — Change supply pipeline status. E.g., "pasa X a firmado", "cambia estado a presentacion_pendiente"

DOCUMENT & FILE MANAGEMENT:
14. "attach_documents" — Attach files to client/supply. E.g., "esto es de Cliente X", "adjunta factura a Marina", "sube contrato a suministro"
15. "generate_report" — Create economic/power study report. E.g., "genera informe economico de X", "estudio de potencias para Cliente Y"
16. "generate_contract" — Generate contract. E.g., "genera contrato de X", "crea contrato para Cliente"
17. "mark_contract_signed" — Mark contract as signed. E.g., "marca contrato de X como firmado", "contrato firmado"
18. "reanalyze_invoice" — Re-scan/reanalyze invoice. E.g., "reanaliza factura", "vuelve a escanear factura"
19. "import_data" — Import clients/supplies from file. E.g., "importa clientes desde excel", "carga datos de CSV"
20. "export_data" — Export data to file. E.g., "exporta clientes a excel", "descargar listado suministros a CSV"

TASK & INCIDENT MANAGEMENT:
21. "create_task" — Create task and assign to user. E.g., "crea tarea para Jose: llamar a cliente", "nueva tarea para Marina"
22. "complete_task" — Mark task as complete. E.g., "completa tarea X", "tarea X hecha", "finaliza tarea de Y"
23. "create_incident" — Create incident. E.g., "abre incidencia para X", "nueva incidencia de Cliente Y"
24. "close_incident" — Close incident. E.g., "cierra incidencia de X", "resuelve incidencia Y", "finaliza incidencia"

APPOINTMENTS & SUBSCRIPTIONS:
25. "create_appointment" — Schedule meeting. E.g., "cita con X el 15 de marzo", "agenda reunion para Cliente Y"
26. "cancel_appointment" — Cancel appointment. E.g., "cancela cita con X", "elimina reunion de Y"
27. "activate_subscription" — Activate subscription. E.g., "activa suscripcion de Cliente X", "suscribe a Y"

ASSIGNMENT & ORGANIZATION:
28. "assign_commercial" — Assign client to commercial user. E.g., "asigna Cliente X a Javier", "pasa cliente Y a Jose"

BULK OPERATIONS:
29. "bulk_update" — Update multiple supplies/clients. E.g., "actualiza varios suministros a firmado", "cambia estado de lista X a completado"

DATA ANALYTICS:
30. "analytics" — Get analytics data. E.g., "embudo" (pipeline), "ranking comerciales" (ranking), "resumen de hoy" (summary), "suministros estancados" (stale), "contratos por vencer" (expiring)

NAVIGATION & QUERIES:
31. "navigate" — Open client/supply detail/edit page. E.g., "abre ficha de Cliente X", "ve a detalle de Y", "edita cliente Z"
32. "query_data" — Answer questions about CRM data. Has these query_types:
   - "detail" (field-specific): "telefono de concesionario honda?", "dame email de Jose Miguel", "cif de Bar Marina", "cups de Matadero SL", "tarifa del suministro de X", "comercializadora de Y"
   - "count": "cuantos clientes en fase firma?", "cuantos suministros pendientes?"
   - "list": "lista de clientes", "muestrame suministros firmados", "dame facturas de suministros de Belate", "facturas de X", "tareas de Marina"
   - "status": "estado de suministro de X", "en que fase esta X"
   IMPORTANT: For list queries scoped to a client (e.g., "dame facturas de Belate"), set client_search to the client name.
   IMPORTANT: For detail queries, ALWAYS set query_field to the specific field (phone, email, fiscal_address, cif_nif, cups, tariff, comercializadora, status, address, name, type, notes). The query can be as simple as "telefono de X?" — detect the field being asked about.

OTHER:
33. "needs_clarification" — Command is ambiguous
34. "unknown" — Cannot understand

SUPPLY PIPELINE (in order):
primer_contacto → prescoring_pendiente → prescoring_completado → estudio_en_curso → estudio_completado → presentacion_pendiente → presentacion_realizada → rechazado → pendiente_firma → firmado → suscrito → seguimiento_activo

JSON RESPONSE STRUCTURE:
{
  "action": "<action>",
  "confidence": 0.0-1.0,
  "raw_interpretation": "brief explanation in Spanish",

  // Client/Supply identification
  "client_search": "client name to search",
  "client_name": "new client name (for create_client)",
  "client_id": "exact UUID if matched from CRM data",
  "supply_search": "supply identifier or CUPS",
  "cups": "CUPS code",

  // Navigation & editing
  "navigate_to": "client_detail|supply_detail|client_edit|supply_edit",
  "field_name": "phone|email|fiscal_address|tariff|cups|name|etc",
  "field_value": "new value for the field",

  // Status & pipeline
  "new_status": "target supply status",

  // User assignment
  "assignee_search": "person name",
  "assignee_id": "exact user UUID if matched from CRM data",

  // Task management
  "task_title": "task title",
  "task_description": "task details",
  "task_priority": "high|medium|low",
  "task_search": "task identifier or description to find",

  // Incident management
  "incident_title": "incident title",
  "incident_description": "details",
  "incident_priority": "high|medium|low",
  "incident_search": "incident identifier or description to find",

  // Appointment management
  "appointment_type": "presentation|followup|signing|other",
  "appointment_date": "ISO date if mentioned",
  "appointment_notes": "notes",

  // Contact management
  "contact_method": "email|whatsapp|call|sms",
  "message_content": "message to send",

  // Document management
  "doc_hint": "invoice|cif|nif|bank_certificate|contract|null",
  "contract_action": "generate|view|mark_signed|send",

  // Query parameters
  "query_type": "count|list|status|detail|summary",
  "query_entity": "clients|supplies|invoices|contracts|prescorings|appointments|incidents|tasks|subscriptions",
  "query_field": "specific field name for field queries (e.g., 'phone', 'email', 'tariff')",
  "query_filters": {"status": "...", "type": "...", "commercial_id": "..."},
  "query_sql_hint": "Supabase query hint",

  // Report generation
  "report_type": "economico|potencias_consumos",

  // Export/Import
  "export_format": "excel|csv",

  // Analytics
  "analytics_type": "pipeline|ranking|summary|stale|expiring",
  "time_range": "today|week|month|quarter|year",

  // Bulk operations
  "bulk_entity": "clients|supplies",
  "bulk_ids": ["id1", "id2", "..."],

  // Merges & moves
  "target_client_search": "target client name for merge/move",

  // Clarification
  "clarification_questions": [{"id": "q1", "question": "¿...?", "options": [...]}],
  "clarification_context": "what you understood"
}

CRITICAL INTERPRETATION RULES:

1. SPANISH LANGUAGE PATTERNS:
   - "telefono de Jose" / "telefono de concesionario honda?" / "email de Marina" → query_data with query_type: "detail" and query_field
   - "dame email de X" / "necesito el cif de Y" / "cual es la tarifa de Z" / "cups de Matadero" → query_data with query_type: "detail"
   - "abre ficha de X" / "ve a cliente X" / "detalle de Y" → navigate with navigate_to: 'client_detail'
   - "edita cliente X" / "cambia datos de Y" → navigate with navigate_to: 'client_edit'
   - "cambia el telefono de X a 666..." → edit_client with field_name: 'phone', field_value: '666...'
   - "actualiza email de X" → edit_client with field_name: 'email'
   - "cambia tarifa del suministro a 3.0" → edit_supply with field_name: 'tariff', field_value: '3.0'
   - "elimina cliente X" / "borra cliente Y" → delete_client
   - "asigna X a Javier" / "pasa cliente X a Jose" → assign_commercial
   - "fusiona/une cliente X con Y" → merge_clients with target_client_search: 'Y'
   - "mueve suministro de X a Y" → move_supply with target_client_search: 'Y'
   - "completa tarea X" / "tarea X hecha" → complete_task
   - "cierra incidencia de X" / "resuelve incidencia X" → close_incident
   - "cancela cita con X" → cancel_appointment
   - "genera contrato de X" → generate_contract
   - "marca contrato de X como firmado" → mark_contract_signed
   - "envia email a X" / "whatsapp a X" / "llama a X" → contact_client with contact_method
   - "importa clientes desde excel" → import_data
   - "exporta clientes a excel" / "descargar listado" → export_data
   - "embudo" / "pipeline" / "funnel" → analytics with analytics_type: 'pipeline'
   - "ranking comerciales" / "quien lleva mas" → analytics with analytics_type: 'ranking'
   - "resumen de hoy/semana" → analytics with analytics_type: 'summary', time_range
   - "suministros estancados" / "sin mover" → analytics with analytics_type: 'stale'
   - "contratos por vencer" → analytics with analytics_type: 'expiring'
   - "activa suscripcion de X" → activate_subscription
   - "busca CUPS ES0021..." → search_supply
   - "reanaliza factura" / "vuelve a escanear" → reanalyze_invoice
   - "actualiza varios suministros a firmado" → bulk_update

2. DATA MATCHING:
   - You KNOW the CRM data. When user says "Jose", match to real user. When they say "Bar Marina", match exact client name.
   - When user asks about data in CRM DATA above, use query_data with appropriate query_filters.
   - For query_data with field queries: set query_field to the specific field (e.g., 'phone', 'email', 'tariff', 'status').
   - You can answer simple counts from the STATS section. Set query_sql_hint to guide the frontend.

3. ACTION DISAMBIGUATION:
   - "suministro [client] + files" = create_supply (new supply from invoices)
   - "suministro [client] + no files" = create_supply (create new supply)
   - "anade al suministro existente [CUPS]" = add_to_supply (add docs to existing)
   - "pasa X a firmado" = update_supply_status (change status)
   - If ambiguous, use needs_clarification with Spanish questions
   - When possible, include client_id or assignee_id from CRM DATA UUIDs
   - Extract EXACT names (don't translate)
   - Only include relevant fields in response

IMPORTANT: Return ONLY the JSON. No text before or after.`
}

async function interpretWithGemini(
  command: string,
  hasFiles: boolean,
  fileNames: string[],
  crmContext?: CRMContext
): Promise<SmartCommandResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return interpretWithHeuristics(command, hasFiles, crmContext)

  try {
    const fileContext = hasFiles
      ? `\nThe user HAS uploaded ${fileNames.length} file(s): ${fileNames.join(', ')}`
      : '\nThe user has NOT uploaded any files.'

    const prompt = buildGeminiPrompt(crmContext)

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${prompt}\n${fileContext}\n\nUser command: "${command}"`,
            }],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
      }
    )

    const data = await response.json()
    if (!response.ok) return interpretWithHeuristics(command, hasFiles, crmContext)

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) return interpretWithHeuristics(command, hasFiles, crmContext)

    const cleanJson = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleanJson)

    return {
      action: parsed.action || 'unknown',
      confidence: parsed.confidence || 0.5,
      raw_interpretation: parsed.raw_interpretation,
      client_search: parsed.client_search,
      client_name: parsed.client_name,
      client_id: parsed.client_id,
      supply_search: parsed.supply_search,
      cups: parsed.cups,
      new_status: parsed.new_status,
      navigate_to: parsed.navigate_to,
      field_name: parsed.field_name,
      field_value: parsed.field_value,
      contact_method: parsed.contact_method,
      message_content: parsed.message_content,
      export_format: parsed.export_format,
      analytics_type: parsed.analytics_type,
      time_range: parsed.time_range,
      assignee_search: parsed.assignee_search,
      assignee_id: parsed.assignee_id,
      task_title: parsed.task_title,
      task_description: parsed.task_description,
      task_priority: parsed.task_priority,
      task_search: parsed.task_search,
      incident_title: parsed.incident_title,
      incident_description: parsed.incident_description,
      incident_priority: parsed.incident_priority,
      incident_search: parsed.incident_search,
      appointment_type: parsed.appointment_type,
      appointment_date: parsed.appointment_date,
      appointment_notes: parsed.appointment_notes,
      doc_hint: parsed.doc_hint || null,
      query_type: parsed.query_type,
      query_entity: parsed.query_entity,
      query_field: parsed.query_field,
      query_filters: parsed.query_filters,
      query_sql_hint: parsed.query_sql_hint,
      report_type: parsed.report_type,
      target_client_search: parsed.target_client_search,
      contract_action: parsed.contract_action,
      bulk_entity: parsed.bulk_entity,
      bulk_ids: parsed.bulk_ids,
      clarification_questions: parsed.clarification_questions,
      clarification_context: parsed.clarification_context,
    }
  } catch (error) {
    console.error('Gemini smart-command error:', error)
    return interpretWithHeuristics(command, hasFiles, crmContext)
  }
}

function interpretWithHeuristics(command: string, hasFiles: boolean, crmContext?: CRMContext): SmartCommandResult {
  const lower = command.toLowerCase().trim()

  // DELETE OPERATIONS
  if (/(?:elimina|borra|delete|remove)\s+(?:el\s+)?cliente\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:elimina|borra|delete|remove)\s+(?:el\s+)?cliente\s+(.+)/i)
    return { action: 'delete_client', client_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Eliminar cliente' }
  }

  if (/(?:elimina|borra|delete|remove)\s+(?:el\s+)?suministro\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:elimina|borra|delete|remove)\s+(?:el\s+)?suministro\s+(.+)/i)
    return { action: 'delete_supply', supply_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Eliminar suministro' }
  }

  // EDIT OPERATIONS - field changes
  if (/(?:cambia|actualiza|modifica|edit)\s+(?:el\s+)?(?:teléfono|telefono|phone)\s+de\s+(.+?)\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:cambia|actualiza|modifica|edit)\s+(?:el\s+)?(?:teléfono|telefono|phone)\s+de\s+(.+?)\s+a\s+(.+)/i)
    return { action: 'edit_client', client_search: m?.[1]?.trim(), field_name: 'phone', field_value: m?.[2]?.trim(), confidence: 0.95, raw_interpretation: 'Cambiar teléfono de cliente' }
  }

  if (/(?:cambia|actualiza|modifica|edit)\s+(?:el\s+)?email\s+de\s+(.+?)\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:cambia|actualiza|modifica|edit)\s+(?:el\s+)?email\s+de\s+(.+?)\s+a\s+(.+)/i)
    return { action: 'edit_client', client_search: m?.[1]?.trim(), field_name: 'email', field_value: m?.[2]?.trim(), confidence: 0.95, raw_interpretation: 'Cambiar email de cliente' }
  }

  if (/(?:cambia|actualiza|modifica)\s+(?:el\s+)?(?:domicilio|dirección|direction|fiscal)\s+de\s+(.+?)\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:cambia|actualiza|modifica)\s+(?:el\s+)?(?:domicilio|dirección|direction|fiscal)\s+de\s+(.+?)\s+a\s+(.+)/i)
    return { action: 'edit_client', client_search: m?.[1]?.trim(), field_name: 'fiscal_address', field_value: m?.[2]?.trim(), confidence: 0.9, raw_interpretation: 'Cambiar dirección de cliente' }
  }

  // EDIT SUPPLY - tariff/CUPS changes
  if (/(?:cambia|actualiza|modifica)\s+(?:la\s+)?(?:tarifa|rate)\s+(?:del\s+suministro\s+)?(?:de\s+)?(.+?)\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:cambia|actualiza|modifica)\s+(?:la\s+)?(?:tarifa|rate)\s+(?:del\s+suministro\s+)?(?:de\s+)?(.+?)\s+a\s+(.+)/i)
    return { action: 'edit_supply', supply_search: m?.[1]?.trim(), field_name: 'tariff', field_value: m?.[2]?.trim(), confidence: 0.9, raw_interpretation: 'Cambiar tarifa de suministro' }
  }

  if (/(?:cambia|actualiza|modifica)\s+(?:el\s+)?(?:cups|codigo)\s+(?:del\s+suministro\s+)?(?:de\s+)?(.+?)\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:cambia|actualiza|modifica)\s+(?:el\s+)?(?:cups|codigo)\s+(?:del\s+suministro\s+)?(?:de\s+)?(.+?)\s+a\s+(.+)/i)
    return { action: 'edit_supply', supply_search: m?.[1]?.trim(), field_name: 'cups', field_value: m?.[2]?.trim(), confidence: 0.9, raw_interpretation: 'Cambiar CUPS de suministro' }
  }

  // QUERY DATA - specific field queries — MUST be before NAVIGATE to avoid "muestra el telefono de X" being caught as navigate
  const fieldQueryPatterns: { pattern: RegExp; field: string; label: string }[] = [
    { pattern: /(?:tel[eé]fono|phone|tfno|movil|m[oó]vil|numero)\s+(?:de\s+|del\s+)(.+)/i, field: 'phone', label: 'Consultar teléfono de cliente' },
    { pattern: /(?:email|correo|mail|e-mail)\s+(?:de\s+|del\s+)(.+)/i, field: 'email', label: 'Consultar email de cliente' },
    { pattern: /(?:domicilio|direcci[oó]n|address|fiscal)\s+(?:de\s+|del\s+)(.+)/i, field: 'fiscal_address', label: 'Consultar dirección de cliente' },
    { pattern: /(?:cif|nif|dni|cif.nif)\s+(?:de\s+|del\s+)(.+)/i, field: 'cif_nif', label: 'Consultar CIF/NIF de cliente' },
    { pattern: /(?:cups)\s+(?:de\s+|del\s+)(.+)/i, field: 'cups', label: 'Consultar CUPS de cliente' },
    { pattern: /(?:tarifa)\s+(?:de\s+|del\s+)(.+)/i, field: 'tariff', label: 'Consultar tarifa de cliente' },
    { pattern: /(?:comercializadora)\s+(?:de\s+|del\s+)(.+)/i, field: 'comercializadora', label: 'Consultar comercializadora de cliente' },
    { pattern: /(?:estado|status)\s+(?:de\s+|del\s+)(.+)/i, field: 'status', label: 'Consultar estado de cliente' },
  ]
  for (const { pattern, field, label } of fieldQueryPatterns) {
    const directMatch = lower.replace(/^[¿?]+/, '').trim().match(pattern)
    if (directMatch) {
      return { action: 'query_data', query_type: 'detail', query_entity: 'clients', query_field: field, client_search: directMatch[1]?.trim().replace(/[?¿!¡.,;:]+$/g, ''), confidence: 0.9, raw_interpretation: label }
    }
    const prefixed = lower.match(new RegExp(`(?:dame|dime|cu[aá]l es|necesito|quiero|sabes|muestra|muestrame|ense[ñn]ame)\\s+(?:el\\s+|la\\s+)?${pattern.source}`, 'i'))
    if (prefixed) {
      return { action: 'query_data', query_type: 'detail', query_entity: 'clients', query_field: field, client_search: prefixed[1]?.trim().replace(/[?¿!¡.,;:]+$/g, ''), confidence: 0.95, raw_interpretation: label }
    }
  }

  // NAVIGATE OPERATIONS
  if (/(?:abre|ve|abrir|mostra|muestra|detalle?|ficha)\s+(?:la\s+ficha\s+)?(?:de\s+|del\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:abre|ve|abrir|mostra|muestra|detalle?|ficha)\s+(?:la\s+ficha\s+)?(?:de\s+|del\s+)?(.+)/i)
    const search = m?.[1]?.trim().replace(/[.,;:!?]+$/, '')
    return { action: 'navigate', navigate_to: 'client_detail', client_search: search, confidence: 0.85, raw_interpretation: 'Abrir ficha de cliente' }
  }

  if (/(?:edita|edit|modifica)\s+(?:el\s+)?cliente\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:edita|edit|modifica)\s+(?:el\s+)?cliente\s+(.+)/i)
    return { action: 'navigate', navigate_to: 'client_edit', client_search: m?.[1]?.trim(), confidence: 0.85, raw_interpretation: 'Editar cliente' }
  }

  if (/(?:edita|edit|modifica)\s+(?:el\s+)?suministro\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:edita|edit|modifica)\s+(?:el\s+)?suministro\s+(.+)/i)
    return { action: 'navigate', navigate_to: 'supply_edit', supply_search: m?.[1]?.trim(), confidence: 0.85, raw_interpretation: 'Editar suministro' }
  }

  // CREATE CLIENT
  if (/(?:crea(?:r)?|nuevo?|dar de alta|alta)\s+(?:un\s+)?(?:nuevo?\s+)?cliente/i.test(lower)) {
    return { action: 'create_client', confidence: 0.9, raw_interpretation: 'Crear nuevo cliente' }
  }

  // ASSIGN COMMERCIAL
  if (/(?:asigna|pasa|asignar)\s+(?:al\s+)?(?:cliente\s+)?(.+?)\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:asigna|pasa|asignar)\s+(?:al\s+)?(?:cliente\s+)?(.+?)\s+a\s+(.+)/i)
    return { action: 'assign_commercial', client_search: m?.[1]?.trim(), assignee_search: m?.[2]?.trim(), confidence: 0.85, raw_interpretation: 'Asignar cliente a comercial' }
  }

  // MERGE CLIENTS
  if (/(?:fusiona|une|merge|combina)\s+(?:cliente\s+)?(.+?)\s+(?:con|y)\s+(?:cliente\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:fusiona|une|merge|combina)\s+(?:cliente\s+)?(.+?)\s+(?:con|y)\s+(?:cliente\s+)?(.+)/i)
    return { action: 'merge_clients', client_search: m?.[1]?.trim(), target_client_search: m?.[2]?.trim(), confidence: 0.85, raw_interpretation: 'Fusionar clientes' }
  }

  // MOVE SUPPLY
  if (/(?:mueve|pasa|move)\s+(?:el\s+)?suministro\s+(?:de\s+)?(.+?)\s+a\s+(?:cliente\s+|al\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:mueve|pasa|move)\s+(?:el\s+)?suministro\s+(?:de\s+)?(.+?)\s+a\s+(?:cliente\s+|al\s+)?(.+)/i)
    return { action: 'move_supply', supply_search: m?.[1]?.trim(), target_client_search: m?.[2]?.trim(), confidence: 0.85, raw_interpretation: 'Mover suministro a otro cliente' }
  }

  // QUERY DATA - counts
  if (/(?:cuantos?|cu[aá]ntos?|cu[aá]ntas?)\s/i.test(lower)) {
    let entity: SmartCommandResult['query_entity'] = 'clients'
    if (/suministro/i.test(lower)) entity = 'supplies'
    if (/factura/i.test(lower)) entity = 'invoices'
    if (/contrato/i.test(lower)) entity = 'contracts'
    if (/prescoring/i.test(lower)) entity = 'prescorings'
    if (/cita|reunion/i.test(lower)) entity = 'appointments'
    if (/incidencia/i.test(lower)) entity = 'incidents'
    if (/tarea/i.test(lower)) entity = 'tasks'
    if (/suscripción|suscripcion/i.test(lower)) entity = 'subscriptions'

    const filters: Record<string, string> = {}
    const SUPPLY_STATUSES = ['primer_contacto','prescoring_pendiente','prescoring_completado','estudio_en_curso','estudio_completado','presentacion_pendiente','presentacion_realizada','rechazado','pendiente_firma','firmado','suscrito','seguimiento_activo']
    for (const s of SUPPLY_STATUSES) {
      if (lower.includes(s.replace(/_/g, ' '))) { filters.status = s; break }
    }
    if (lower.includes('pendiente de presentar') || lower.includes('pendientes de presentar')) filters.status = 'presentacion_pendiente'
    if (lower.includes('pendiente de firma') || lower.includes('pendientes de firma')) filters.status = 'pendiente_firma'
    if (lower.includes('firmado')) filters.status = 'firmado'
    if (lower.includes('suscrito')) filters.status = 'suscrito'

    return { action: 'query_data', query_type: 'count', query_entity: entity, query_filters: Object.keys(filters).length > 0 ? filters : undefined, confidence: 0.8, raw_interpretation: `Consulta: contar ${entity}` }
  }

  // QUERY DATA - lists (with optional client scope: "dame facturas de belate", "muestra suministros de matadero sl")
  if (/^(?:dame|muestra|lista|muestrame|dime|ense[ñn]ame|ver)\s/i.test(lower)) {
    let entity: SmartCommandResult['query_entity'] = 'clients'
    if (/suministro/i.test(lower)) entity = 'supplies'
    if (/factura/i.test(lower)) entity = 'invoices'
    if (/incidencia/i.test(lower)) entity = 'incidents'
    if (/tarea/i.test(lower)) entity = 'tasks'
    if (/contrato/i.test(lower)) entity = 'contracts'
    // Extract client name: "de [suministros de] belate", "del cliente X", "de X"
    let clientSearch: string | undefined
    const clientMatch = lower.match(/(?:de\s+(?:suministros?\s+de\s+|cliente\s+)?)([a-záéíóúñü][\w\s.]+?)(?:\?|$)/i)
    if (clientMatch) {
      // Remove the entity word itself from the match to get the actual client name
      let candidate = clientMatch[1].trim().replace(/[?¿!¡.,;:]+$/g, '')
      // If the match IS the entity word (e.g., "dame facturas" → no client), skip
      const entityWords = ['facturas', 'suministros', 'suministro', 'clientes', 'cliente', 'incidencias', 'tareas', 'contratos']
      if (!entityWords.includes(candidate.toLowerCase()) && candidate.length > 1) {
        clientSearch = candidate
      }
    }
    return { action: 'query_data', query_type: 'list', query_entity: entity, client_search: clientSearch, confidence: clientSearch ? 0.85 : 0.7, raw_interpretation: `Consulta: listar ${entity}${clientSearch ? ` de ${clientSearch}` : ''}` }
  }

  // SEARCH SUPPLY - by CUPS
  if (/(?:busca|find|search)\s+(?:cups|código)\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:busca|find|search)\s+(?:cups|código)\s+(.+)/i)
    return { action: 'search_supply', cups: m?.[1]?.trim(), confidence: 0.95, raw_interpretation: 'Buscar suministro por CUPS' }
  }

  // SEARCH CLIENT
  if (/(?:busca|find|search)\s+(?:cliente\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:busca|find|search)\s+(?:cliente\s+)?(.+)/i)
    return { action: 'search_client', client_search: m?.[1]?.trim(), confidence: 0.75, raw_interpretation: 'Buscar cliente' }
  }

  // ANALYTICS - pipeline/embudo
  if (/(?:embudo|pipeline|funnel|stages)\b/i.test(lower)) {
    let timeRange: SmartCommandResult['time_range'] = undefined
    if (/hoy|today/i.test(lower)) timeRange = 'today'
    else if (/semana|week/i.test(lower)) timeRange = 'week'
    else if (/mes|month/i.test(lower)) timeRange = 'month'
    else if (/trimestre|quarter/i.test(lower)) timeRange = 'quarter'
    else if (/a[ñn]o|year/i.test(lower)) timeRange = 'year'
    return { action: 'analytics', analytics_type: 'pipeline', time_range: timeRange, confidence: 0.9, raw_interpretation: 'Análisis: embudo de ventas' }
  }

  // ANALYTICS - ranking
  if (/(?:ranking|quien lleva|quien tiene mas|mejores comerciales|top comerciales)/i.test(lower)) {
    let timeRange: SmartCommandResult['time_range'] = undefined
    if (/hoy|today/i.test(lower)) timeRange = 'today'
    else if (/semana|week/i.test(lower)) timeRange = 'week'
    else if (/mes|month/i.test(lower)) timeRange = 'month'
    else if (/trimestre|quarter/i.test(lower)) timeRange = 'quarter'
    else if (/a[ñn]o|year/i.test(lower)) timeRange = 'year'
    return { action: 'analytics', analytics_type: 'ranking', time_range: timeRange, confidence: 0.9, raw_interpretation: 'Análisis: ranking de comerciales' }
  }

  // ANALYTICS - summary
  if (/(?:resumen|summary|overview|estado general)\s+(?:de\s+)?(?:hoy|semana|mes|today|week|month)/i.test(lower)) {
    let timeRange: SmartCommandResult['time_range'] = 'today'
    if (/semana|week/i.test(lower)) timeRange = 'week'
    else if (/mes|month/i.test(lower)) timeRange = 'month'
    else if (/trimestre|quarter/i.test(lower)) timeRange = 'quarter'
    else if (/a[ñn]o|year/i.test(lower)) timeRange = 'year'
    return { action: 'analytics', analytics_type: 'summary', time_range: timeRange, confidence: 0.85, raw_interpretation: 'Análisis: resumen del período' }
  }

  // ANALYTICS - stale supplies
  if (/(?:estancado|sin mover|parado|atrapado|inactivo)\s+(?:suministro)?/i.test(lower)) {
    return { action: 'analytics', analytics_type: 'stale', confidence: 0.85, raw_interpretation: 'Análisis: suministros estancados' }
  }

  // ANALYTICS - expiring contracts
  if (/(?:por vencer|vencimiento|expira|a punto de vencer|proximo vencimiento)/i.test(lower)) {
    return { action: 'analytics', analytics_type: 'expiring', confidence: 0.85, raw_interpretation: 'Análisis: contratos por vencer' }
  }

  // REPORT - economic
  if (/(?:informe|estudio|reporte)\s+(?:econ[oó]mico)/i.test(lower)) {
    const m = lower.match(/(?:de\s+|del\s+)(.+)/i)
    return { action: 'generate_report', report_type: 'economico', client_search: m?.[1]?.trim(), confidence: 0.8, raw_interpretation: 'Generar informe economico' }
  }

  // REPORT - power/potencias
  if (/(?:informe|estudio|reporte)\s+(?:de\s+)?(?:potencia|potencias|power|consumo)/i.test(lower)) {
    const m = lower.match(/(?:de\s+|del\s+)(.+)/i)
    return { action: 'generate_report', report_type: 'potencias_consumos', client_search: m?.[1]?.trim(), confidence: 0.8, raw_interpretation: 'Generar estudio de potencias' }
  }

  // UPDATE STATUS
  if (/(?:pasa|cambia|mover?|actualiza)\s.*(?:a\s+|al estado\s+)/i.test(lower)) {
    const SUPPLY_STATUSES = ['primer_contacto','prescoring_pendiente','prescoring_completado','estudio_en_curso','estudio_completado','presentacion_pendiente','presentacion_realizada','rechazado','pendiente_firma','firmado','suscrito','seguimiento_activo']
    let ns: string | undefined
    for (const s of SUPPLY_STATUSES) { if (lower.includes(s.replace(/_/g, ' '))) { ns = s; break } }
    if (lower.includes('firmado')) ns = 'firmado'
    if (lower.includes('suscrito')) ns = 'suscrito'
    const cm = lower.match(/(?:de\s+|del\s+)([^a]+?)(?:\s+a\s+)/i)
    return { action: 'update_supply_status', supply_search: cm?.[1]?.trim(), new_status: ns, confidence: 0.7, raw_interpretation: `Cambiar estado a ${ns || '?'}` }
  }

  // TASK - create
  const tm = lower.match(/(?:crea(?:r)?|nueva?)\s+(?:una?\s+)?tarea\s+(?:para\s+|a\s+)([^:,.]+?)(?:[:.]\s*(.+))?$/i)
  if (tm) {
    return { action: 'create_task', assignee_search: tm[1]?.trim(), task_title: tm[2]?.trim() || '', confidence: 0.85, raw_interpretation: 'Crear tarea' }
  }

  // TASK - complete
  if (/(?:completa|finaliza|termina|marca como hecha)\s+(?:la\s+)?(?:tarea\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:completa|finaliza|termina|marca como hecha)\s+(?:la\s+)?(?:tarea\s+)?(.+)/i)
    return { action: 'complete_task', task_search: m?.[1]?.trim(), confidence: 0.85, raw_interpretation: 'Completar tarea' }
  }

  // INCIDENT - create
  const im = lower.match(/(?:crea(?:r)?|nueva?|abr(?:e|ir))\s+(?:una?\s+)?incidencia\s+(?:para\s+|en\s+|de\s+)(.+)/i)
  if (im) {
    return { action: 'create_incident', client_search: im[1]?.trim(), confidence: 0.8, raw_interpretation: 'Crear incidencia' }
  }

  // INCIDENT - close
  if (/(?:cierra|cierre|resolve|resuelve|finaliza|termina|closes?)\s+(?:la\s+)?(?:incidencia\s+)?(?:de\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:cierra|cierre|resolve|resuelve|finaliza|termina|closes?)\s+(?:la\s+)?(?:incidencia\s+)?(?:de\s+)?(.+)/i)
    return { action: 'close_incident', incident_search: m?.[1]?.trim(), confidence: 0.85, raw_interpretation: 'Cerrar incidencia' }
  }

  // APPOINTMENT - create
  if (/(?:cita|reuni[oó]n|agenda|visita)\s/i.test(lower)) {
    const m = lower.match(/(?:con\s+|para\s+|en\s+)(.+)/i)
    return { action: 'create_appointment', client_search: m?.[1]?.trim(), confidence: 0.7, raw_interpretation: 'Agendar cita' }
  }

  // APPOINTMENT - cancel
  if (/(?:cancela|elimina|borra|removes?)\s+(?:la\s+)?(?:cita|reuni[oó]n|appointment)\s+(?:con\s+|de\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:cancela|elimina|borra|removes?)\s+(?:la\s+)?(?:cita|reuni[oó]n|appointment)\s+(?:con\s+|de\s+)?(.+)/i)
    return { action: 'cancel_appointment', client_search: m?.[1]?.trim(), confidence: 0.85, raw_interpretation: 'Cancelar cita' }
  }

  // CONTACT CLIENT - email
  if (/(?:envi[aá]|send)\s+(?:un\s+)?email\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:envi[aá]|send)\s+(?:un\s+)?email\s+a\s+(.+)/i)
    return { action: 'contact_client', contact_method: 'email', client_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Enviar email a cliente' }
  }

  // CONTACT CLIENT - whatsapp
  if (/(?:whatsapp|watsap|wa)\s+(?:a\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:whatsapp|watsap|wa)\s+(?:a\s+)?(.+)/i)
    return { action: 'contact_client', contact_method: 'whatsapp', client_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Enviar WhatsApp a cliente' }
  }

  // CONTACT CLIENT - call
  if (/(?:llama|call|telefona)\s+(?:a\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:llama|call|telefona)\s+(?:a\s+)?(.+)/i)
    return { action: 'contact_client', contact_method: 'call', client_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Llamar a cliente' }
  }

  // CONTACT CLIENT - SMS
  if (/(?:sms|text|mensaje)\s+(?:a\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:sms|text|mensaje)\s+(?:a\s+)?(.+)/i)
    return { action: 'contact_client', contact_method: 'sms', client_search: m?.[1]?.trim(), confidence: 0.85, raw_interpretation: 'Enviar SMS a cliente' }
  }

  // GENERATE CONTRACT
  if (/(?:genera|generate|create)\s+(?:un\s+)?(?:contrato|contract)\s+(?:de\s+|para\s+|del\s+)(.+)/i.test(lower)) {
    const m = lower.match(/(?:genera|generate|create)\s+(?:un\s+)?(?:contrato|contract)\s+(?:de\s+|para\s+|del\s+)(.+)/i)
    return { action: 'generate_contract', contract_action: 'generate', client_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Generar contrato' }
  }

  // MARK CONTRACT SIGNED
  if (/(?:marca|mark)\s+(?:el\s+)?contrato\s+(?:de\s+)?(.+?)\s+como\s+firmado/i.test(lower)) {
    const m = lower.match(/(?:marca|mark)\s+(?:el\s+)?contrato\s+(?:de\s+)?(.+?)\s+como\s+firmado/i)
    return { action: 'mark_contract_signed', contract_action: 'mark_signed', client_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Marcar contrato como firmado' }
  }

  // EXPORT DATA
  if (/(?:exporta|export|descarga|download)\s+(?:listado\s+de\s+)?(?:clientes|suministros|clients|supplies)\s+(?:a\s+)?(?:excel|csv)/i.test(lower)) {
    let format: SmartCommandResult['export_format'] = 'excel'
    if (/csv/i.test(lower)) format = 'csv'
    let entity: SmartCommandResult['bulk_entity'] = 'clients'
    if (/suministro/i.test(lower)) entity = 'supplies'
    return { action: 'export_data', export_format: format, bulk_entity: entity, confidence: 0.9, raw_interpretation: `Exportar ${entity} a ${format}` }
  }

  // IMPORT DATA
  if (/(?:importa|import|carga|load)\s+(?:clientes|suministros|clients|supplies)\s+(?:desde\s+|from\s+)?(?:excel|csv|archivo)/i.test(lower)) {
    let entity: SmartCommandResult['bulk_entity'] = 'clients'
    if (/suministro/i.test(lower)) entity = 'supplies'
    return { action: 'import_data', bulk_entity: entity, confidence: 0.85, raw_interpretation: `Importar ${entity} desde archivo` }
  }

  // BULK UPDATE
  if (/(?:actualiza|update)\s+(?:varios|multiple)\s+(?:suministros|supplies|clientes|clients)\s+a\s+(.+)/i.test(lower)) {
    const m = lower.match(/(?:actualiza|update)\s+(?:varios|multiple)\s+(?:suministros|supplies|clientes|clients)\s+a\s+(.+)/i)
    let entity: SmartCommandResult['bulk_entity'] = 'supplies'
    if (/cliente/i.test(lower)) entity = 'clients'
    return { action: 'bulk_update', bulk_entity: entity, field_value: m?.[1]?.trim(), confidence: 0.8, raw_interpretation: `Actualizar múltiples ${entity}` }
  }

  // ACTIVATE SUBSCRIPTION
  if (/(?:activa|activate|enable)\s+(?:la\s+)?(?:suscripción|suscripcion|subscription)\s+(?:de\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:activa|activate|enable)\s+(?:la\s+)?(?:suscripción|suscripcion|subscription)\s+(?:de\s+)?(.+)/i)
    return { action: 'activate_subscription', client_search: m?.[1]?.trim(), confidence: 0.9, raw_interpretation: 'Activar suscripción' }
  }

  // REANALYZE INVOICE
  if (/(?:reanaliza|reanalyze|vuelve a escanear|re-scan|rescannear)\s+(?:la\s+)?(?:factura|invoice)/i.test(lower)) {
    return { action: 'reanalyze_invoice', confidence: 0.9, raw_interpretation: 'Reanalizar factura' }
  }

  // CREATE SUPPLY — with files
  if (hasFiles && /(?:suministro|suministros)\s+(?:de\s+|del\s+|para\s+|a\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/(?:suministro|suministros)\s+(?:de\s+|del\s+|para\s+|a\s+)?(.+)/i)
    return { action: 'create_supply', client_search: m?.[1]?.trim()?.replace(/[.,;:!?]+$/, ''), confidence: 0.9, raw_interpretation: 'Crear suministro con facturas' }
  }

  // CREATE SUPPLY — without files
  if (/(?:nuevo|crear?|a[ñn]ad(?:e|ir))\s+(?:un\s+)?suministro\s+(?:para\s+|a\s+|de\s+|del\s+)?(.+)/i.test(lower)) {
    const m = lower.match(/suministro\s+(?:para\s+|a\s+|de\s+|del\s+)?(.+)/i)
    return { action: 'create_supply', client_search: m?.[1]?.trim()?.replace(/[.,;:!?]+$/, ''), confidence: 0.85, raw_interpretation: 'Crear nuevo suministro' }
  }

  if (/^suministro\s+/i.test(lower)) {
    const m = lower.match(/^suministro\s+(?:de\s+|del\s+|para\s+|a\s+)?(.+)/i)
    return { action: 'create_supply', client_search: m?.[1]?.trim()?.replace(/[.,;:!?]+$/, ''), confidence: 0.8, raw_interpretation: 'Crear suministro' }
  }

  // ADD TO SUPPLY — existing supply
  if (/(?:a[ñn]ad(?:e|ir)|mete|pon)\s.*(?:al suministro|suministro existente)/i.test(lower)) {
    const m = lower.match(/(?:de\s+|del\s+)(.+)/i)
    return { action: 'add_to_supply', supply_search: m?.[1]?.trim(), confidence: 0.7, raw_interpretation: 'Añadir al suministro existente' }
  }

  // ATTACH DOCUMENTS
  let docHint: SmartCommandResult['doc_hint'] = null
  if (/factura|recibo/i.test(lower)) docHint = 'invoice'
  else if (/\bcif\b/i.test(lower)) docHint = 'cif'
  else if (/\bnif\b|\bdni\b/i.test(lower)) docHint = 'nif'
  else if (/banco|bancari|iban/i.test(lower)) docHint = 'bank_certificate'
  else if (/contrato/i.test(lower)) docHint = 'contract'

  const attachPatterns = [
    /(?:esto|estos|estas|este)\s+(?:es|son|va|van)\s+(?:de\s+|del\s+|para\s+)(.+)/i,
    /(?:adjunta|adjuntar|asigna|asignar|pon|mete|sube|subir)\s+(?:esto\s+|todo\s+)?(?:a\s+|al\s+|en\s+|de\s+|del\s+|para\s+)(.+)/i,
    /(?:documentos?|facturas?|archivos?)\s+(?:de\s+|del\s+|para\s+)(.+)/i,
  ]
  for (const p of attachPatterns) {
    const m = lower.match(p)
    if (m) return { action: 'attach_documents', client_search: m[1]?.trim().replace(/[.,;:!?]+$/, ''), doc_hint: docHint, confidence: 0.75, raw_interpretation: 'Adjuntar documentos' }
  }

  if (hasFiles && lower.length > 2 && lower.length < 100) {
    return { action: 'attach_documents', client_search: lower.replace(/[.,;:!?]+$/, ''), doc_hint: docHint, confidence: 0.5, raw_interpretation: 'Posible adjuntar documentos' }
  }

  // Fallback: try search_client
  if (lower.length > 2 && lower.length < 60) {
    return { action: 'search_client', client_search: lower, confidence: 0.4, raw_interpretation: 'Buscar cliente' }
  }

  return { action: 'unknown', confidence: 0 }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { command, has_files, file_names, clarification_answers, crm_context } = body as {
      command: string
      has_files: boolean
      file_names?: string[]
      clarification_answers?: Record<string, string>
      crm_context?: CRMContext
    }

    if (!command || command.trim().length === 0) {
      return NextResponse.json({ action: 'unknown', confidence: 0, error: 'command is required' }, { status: 400 })
    }

    let fullCommand = command.trim()
    if (clarification_answers && Object.keys(clarification_answers).length > 0) {
      const answers = Object.entries(clarification_answers).map(([q, a]) => `${q}: ${a}`).join('. ')
      fullCommand = `${command.trim()}. Aclaraciones del usuario: ${answers}`
    }

    const result = await interpretWithGemini(fullCommand, has_files ?? false, file_names || [], crm_context)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Smart command error:', error)
    return NextResponse.json({ action: 'unknown', confidence: 0, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
