export type ServiceContractType = 'porcentaje' | 'suscripcion'
export type ServiceContractStatus = 'draft' | 'sent' | 'signed' | 'active' | 'expired'
export type PaymentModality = 'A' | 'B' | 'C' | 'D'

export interface ServiceContract {
  id: string
  client_id: string
  contract_type: ServiceContractType
  is_renewal: boolean
  ahorro_confirmado: number | null
  fee_percentage: number          // siempre 25 para tipo porcentaje
  fee_amount: number | null       // calculado: ahorro_confirmado * fee_percentage/100
  subscription_monthly: number | null  // para tipo suscripcion (default 19.99)
  payment_modality: PaymentModality
  start_date: string              // fecha inicio servicios
  end_date: string | null         // start_date + 12 meses (auto)
  representative_name: string | null   // Don/Doña (firmante del cliente)
  representative_nif: string | null    // DNI del firmante
  signing_location: string | null      // lugar de formalización (ciudad cliente)
  status: ServiceContractStatus
  proposal_url: string | null
  contract_url: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SupplyStatus =
  | 'primer_contacto'
  | 'facturas_recibidas'
  | 'prescoring_pendiente'
  | 'prescoring_completado'
  | 'estudio_en_curso'
  | 'estudio_completado'
  | 'presentado'
  | 'presentacion_pendiente'
  | 'presentacion_realizada'
  | 'rechazado'
  | 'pendiente_firma'
  | 'firmado'
  | 'suscrito'
  | 'seguimiento_activo'

export type ClientType = 'empresa' | 'particular' | 'ayuntamiento'
export type SupplyType = 'luz' | 'gas' | 'telefonia'
export type UserRole = 'admin' | 'commercial'
export type SubscriptionModel = 'percentage' | 'fixed'
export type PaymentMode = 'immediate' | 'quarterly'
export type BillingStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
export type ContractType = 'voltis' | 'comercializadora'
export type ContractStatus = 'draft' | 'sent' | 'signed' | 'rejected' | 'expired'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'pending_activation'
export type StudyType = 'potencias_consumos' | 'economico'
export type PrescoringStatus = 'pending' | 'sent' | 'approved' | 'rejected'
export type SigningMethod = 'presencial' | 'telematico'
export type ServiceType = 'luz' | 'gas' | 'telefonia'
export type ClientOrigin = 'auditoria' | 'referido' | 'captacion' | 'otro'
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type InvoiceSource = 'historica' | 'voltis'

export interface UserProfile {
  id: string
  full_name: string
  nickname: string | null   // apodo/alias visible en el CRM (ej. "Alex", "Jokin")
  email: string
  phone: string | null
  role: UserRole
  permissions: Record<string, boolean>
  avatar_url: string | null
  initials: string | null   // "NV" para Nicolás Voltis — mostrado en avatares
  google_id: string | null  // sub de Google OAuth, se rellena al primer login con Google
  active: boolean
  created_at: string
}

export interface Client {
  id: string
  name: string
  type: ClientType
  cif_nif: string | null
  cif: string | null
  cif_file_url: string | null
  nif: string | null
  nif_file_url: string | null
  iban: string | null
  iban_file_url: string | null
  email: string | null
  phone: string | null
  fiscal_address: string | null
  bank_certificate_url: string | null
  commercial_id: string
  origin: ClientOrigin
  marketing_consent: boolean
  notes: string | null
  // Ahorro para generación de contratos
  ahorro_sugerido: number | null          // suma automática de comparativas (referencia)
  ahorro_pendiente_revision: boolean      // flag: el ahorro sugerido cambió desde la última confirmación
  created_at: string
  updated_at: string
  // Relations
  commercial?: UserProfile
  supplies?: Supply[]
  service_contracts?: ServiceContract[]
}

export interface Comercializadora {
  id: string
  name: string
  tariff_types: string[]
  service_type: ServiceType
  signing_method: SigningMethod
  active: boolean
  notes: string | null
}

export interface Supply {
  id: string
  client_id: string
  name: string | null
  cups: string | null
  type: SupplyType
  tariff: string
  address: string | null
  comercializadora_id: string | null
  status: SupplyStatus
  power_data: Record<string, unknown> | null
  consumption_data: Record<string, unknown> | null
  created_at: string
  updated_at: string
  // Relations
  client?: Client
  comercializadora?: Comercializadora
  invoices?: Invoice[]
}

export interface Invoice {
  id: string
  supply_id: string
  file_url: string
  file_type: 'pdf' | 'image'
  extracted_data: Record<string, unknown> | null
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  extraction_status: ExtractionStatus
  extraction_confidence: number | null
  /** 'historica' = factura de la comercializadora antigua del cliente.
   *  'voltis'    = factura de la nueva comercializadora contratada vía Voltis
   *                (Galp, Axpo, Gana, etc.). Dispara comparativa de coste real. */
  source: InvoiceSource
  /** Marca temporal del momento en que se subió como factura Voltis. */
  voltis_uploaded_at: string | null
  created_at: string
}

export interface Prescoring {
  id: string
  supply_id: string
  client_name: string
  cups: string | null
  cif: string | null
  producto: string | null
  tariff: string | null
  consumo_anual: string | null
  entidad: string | null
  telefono: string | null
  poblacion: string | null
  direccion_fiscal: string | null
  status: PrescoringStatus
  requested_at: string
  resolved_at: string | null
  sent_at: string | null
  notes: string | null
  requested_by: string
}

export interface Study {
  id: string
  supply_id: string
  type: StudyType
  input_data: Record<string, unknown> | null
  result_data: Record<string, unknown> | null
  report_url: string | null
  status: 'pending' | 'in_progress' | 'completed'
  created_by: string
  created_at: string
  completed_at: string | null
}

export interface Contract {
  id: string
  client_id: string
  supply_id: string
  type: ContractType
  comercializadora_id: string | null
  file_url: string | null
  signed_file_url: string | null
  docusign_envelope_id: string | null
  signwell_document_id: string | null
  status: ContractStatus
  generated_at: string | null
  sent_at: string | null
  signed_at: string | null
  created_by: string
}

export interface Subscription {
  id: string
  client_id: string | null
  external_client_name: string | null
  external_client_email: string | null
  model: SubscriptionModel
  percentage_value: number | null
  plan_tier: number | null
  payment_mode: PaymentMode
  annual_amount: number | null
  total_savings: number | null
  status: SubscriptionStatus
  gocardless_mandate_id: string | null
  gocardless_subscription_id: string | null
  gocardless_customer_id: string | null
  client_iban: string | null
  start_date: string
  next_billing_date: string | null
  cancelled_at: string | null
  created_at: string
  // Relations
  client?: Client
  billings?: Billing[]
}

export interface Billing {
  id: string
  client_id: string
  subscription_id: string | null
  invoice_number: string
  concept: string
  base_amount: number
  vat_rate: number
  vat_amount: number
  total_amount: number
  status: BillingStatus
  gocardless_payment_id: string | null
  file_url: string | null
  period_start: string | null
  period_end: string | null
  due_date: string
  paid_at: string | null
  created_at: string
  // Relations
  client?: Client
  subscription?: Subscription
}

export interface Comparative {
  id: string
  supply_id: string
  type: 'potencias' | 'economico'
  old_invoices: string[]
  new_invoices: string[]
  old_total: number
  new_total: number
  savings_amount: number
  savings_percentage: number
  report_url: string | null
  sent_to_client: boolean
  sent_at: string | null
  quarter: string
  created_at: string
}

export interface Objective {
  id: string
  title: string
  target_type: 'contracts' | 'supplies' | 'revenue'
  tariff_filter: string | null
  target_count: number
  current_count: number
  period_start: string
  period_end: string
  scope: 'team' | 'individual'
  assigned_to: string | null
  created_by: string
  created_at: string
}

export interface Appointment {
  id: string
  client_id: string
  supply_id: string | null
  type: 'presentation' | 'followup' | 'signing' | 'other'
  scheduled_at: string
  location: string | null
  commercial_id: string
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  outcome: 'accepted' | 'rejected' | 'rescheduled' | null
  notes: string | null
  created_at: string
}

export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface Task {
  id: string
  title: string
  description: string | null
  priority: TaskPriority
  status: TaskStatus
  sort_order: number
  assigned_to: string | null
  created_by: string
  related_entity_type: string | null
  related_entity_id: string | null
  due_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  // Relations
  assigned_user?: UserProfile
  creator_user?: UserProfile
}

export type IncidentPriority = 'high' | 'medium' | 'low'
export type IncidentStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type CommissionStatus = 'pending' | 'approved' | 'paid'

export interface Incident {
  id: string
  client_id: string
  title: string
  description: string | null
  priority: IncidentPriority
  status: IncidentStatus
  assigned_to: string | null
  created_by: string
  resolved_at: string | null
  created_at: string
  updated_at: string
  client?: Client
  assigned_user?: UserProfile
  creator_user?: UserProfile
}

export interface IncidentMessage {
  id: string
  incident_id: string
  author_id: string
  message: string
  created_at: string
  author?: UserProfile
}

export interface Commission {
  id: string
  commercial_id: string
  supply_id: string | null
  client_id: string | null
  amount: number
  month: string
  concept: string | null
  status: CommissionStatus
  approved_at: string | null
  paid_at: string | null
  created_at: string
  commercial?: UserProfile
  client?: Client
  supply?: Supply
}

export interface TaskNote {
  id: string
  task_id: string
  author_id: string | null
  content: string | null
  audio_url: string | null
  audio_duration_seconds: number | null
  created_at: string
  author?: UserProfile
}

export interface ActivityLog {
  id: string
  entity_type: string
  entity_id: string
  action: string
  description: string
  performed_by: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export type NotificationType = 'estudio_completado' | 'prescoring_aprobado' | 'prescoring_rechazado' | 'contrato_firmado' | 'general'

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  message: string
  link?: string | null
  read: boolean
  created_at: string
  metadata?: Record<string, unknown> | null
}

// ─── Consumption & Audit types (Ayuntamiento module) ───

export type ConsumptionSource = 'invoice_extraction' | 'excel_import' | 'sips' | 'manual'
export type ConsumptionValidation = 'OK' | 'Revisar' | 'Incompleto'
export type AuditReportStatus = 'draft' | 'published' | 'stale'

export interface ConsumptionSnapshot {
  id: string
  client_id: string
  supply_id: string
  name: string | null
  cups: string
  tariff: string | null
  supply_type: 'luz' | 'gas' | null
  comercializadora: string | null
  address: string | null
  potencia_p1: number | null
  potencia_p2: number | null
  potencia_p3: number | null
  potencia_p4: number | null
  potencia_p5: number | null
  potencia_p6: number | null
  consumo_p1: number | null
  consumo_p2: number | null
  consumo_p3: number | null
  consumo_p4: number | null
  consumo_p5: number | null
  consumo_p6: number | null
  consumo_total: number | null
  source: ConsumptionSource
  validation_status: ConsumptionValidation
  observations: string | null
  confidence_json: Record<string, unknown> | null
  invoice_file_url: string | null
  periodo: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface AuditReport {
  id: string
  client_id: string
  title: string
  status: AuditReportStatus
  rows_snapshot: ConsumptionSnapshot[] | null
  cover_image_url: string | null
  informe_breve: string | null
  notas_optimizacion: Record<string, unknown> | null
  generated_by: string | null
  created_at: string
  updated_at: string
}

// Helper types for Supabase table definitions
type TableDef<T> = {
  Row: T
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
}

// Supabase Database type (simplified — use supabase gen types for full version)
export interface Database {
  public: {
    Tables: {
      users_profile: TableDef<UserProfile>
      clients: TableDef<Client>
      comercializadoras: TableDef<Comercializadora>
      supplies: TableDef<Supply>
      invoices: TableDef<Invoice>
      prescorings: TableDef<Prescoring>
      studies: TableDef<Study>
      contracts: TableDef<Contract>
      service_contracts: TableDef<ServiceContract>
      subscriptions: TableDef<Subscription>
      billing: TableDef<Billing>
      comparatives: TableDef<Comparative>
      objectives: TableDef<Objective>
      appointments: TableDef<Appointment>
      tasks: TableDef<Task>
      incidents: TableDef<Incident>
      incident_messages: TableDef<IncidentMessage>
      commissions: TableDef<Commission>
      task_notes: TableDef<TaskNote>
      activity_log: TableDef<ActivityLog>
      consumption_snapshots: TableDef<ConsumptionSnapshot>
      audit_reports: TableDef<AuditReport>
    }
  }
}
