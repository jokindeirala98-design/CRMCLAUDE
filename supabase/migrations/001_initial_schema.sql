-- ============================================
-- VOLTIS CRM - Initial Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. ENUMS
-- ============================================

CREATE TYPE user_role AS ENUM ('admin', 'commercial');
CREATE TYPE client_type AS ENUM ('empresa', 'particular', 'ayuntamiento');
CREATE TYPE client_origin AS ENUM ('auditoria', 'referido', 'captacion', 'otro');
CREATE TYPE supply_type AS ENUM ('luz', 'gas', 'telefonia');
CREATE TYPE service_type AS ENUM ('luz', 'gas', 'telefonia');
CREATE TYPE signing_method AS ENUM ('presencial', 'telematico');
CREATE TYPE extraction_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE prescoring_status AS ENUM ('pending', 'sent', 'approved', 'rejected');
CREATE TYPE study_type AS ENUM ('potencias_consumos', 'economico');
CREATE TYPE study_status AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE contract_type AS ENUM ('voltis', 'comercializadora');
CREATE TYPE contract_status AS ENUM ('draft', 'sent', 'signed', 'rejected', 'expired');
CREATE TYPE subscription_model AS ENUM ('percentage', 'fixed');
CREATE TYPE payment_mode AS ENUM ('immediate', 'quarterly');
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'pending_activation');
CREATE TYPE billing_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');
CREATE TYPE appointment_type AS ENUM ('presentation', 'followup', 'signing', 'other');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE appointment_outcome AS ENUM ('accepted', 'rejected', 'rescheduled');
CREATE TYPE objective_target AS ENUM ('contracts', 'supplies', 'revenue');
CREATE TYPE objective_scope AS ENUM ('team', 'individual');

CREATE TYPE supply_status AS ENUM (
  'primer_contacto',
  'facturas_recibidas',
  'prescoring_pendiente',
  'prescoring_completado',
  'estudio_en_curso',
  'estudio_completado',
  'presentacion_pendiente',
  'presentacion_realizada',
  'rechazado',
  'pendiente_firma',
  'firmado',
  'suscrito',
  'seguimiento_activo'
);

-- ============================================
-- 2. TABLES
-- ============================================

-- Users Profile (extends Supabase Auth)
CREATE TABLE users_profile (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role user_role NOT NULL DEFAULT 'commercial',
  permissions JSONB NOT NULL DEFAULT '{
    "prescorings": false,
    "billing": false,
    "reports": false,
    "settings": false,
    "all_clients": false
  }'::jsonb,
  avatar_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comercializadoras
CREATE TABLE comercializadoras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  tariff_types TEXT[] NOT NULL DEFAULT '{}',
  service_type service_type NOT NULL,
  signing_method signing_method NOT NULL DEFAULT 'telematico',
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT
);

-- Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type client_type NOT NULL DEFAULT 'empresa',
  cif_nif TEXT,
  email TEXT,
  phone TEXT,
  fiscal_address TEXT,
  bank_certificate_url TEXT,
  commercial_id UUID NOT NULL REFERENCES users_profile(id),
  origin client_origin NOT NULL DEFAULT 'auditoria',
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_commercial ON clients(commercial_id);
CREATE INDEX idx_clients_cif_nif ON clients(cif_nif);

-- Supplies (Suministros / CUPS)
CREATE TABLE supplies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  cups TEXT,
  type supply_type NOT NULL DEFAULT 'luz',
  tariff TEXT NOT NULL,
  address TEXT,
  comercializadora_id UUID REFERENCES comercializadoras(id),
  status supply_status NOT NULL DEFAULT 'primer_contacto',
  power_data JSONB,
  consumption_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplies_client ON supplies(client_id);
CREATE INDEX idx_supplies_status ON supplies(status);
CREATE INDEX idx_supplies_cups ON supplies(cups);
CREATE INDEX idx_supplies_tariff ON supplies(tariff);

-- Invoices (Facturas recogidas del cliente)
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'pdf',
  extracted_data JSONB,
  period_start DATE,
  period_end DATE,
  total_amount DECIMAL(12,2),
  extraction_status extraction_status NOT NULL DEFAULT 'pending',
  extraction_confidence DECIMAL(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_supply ON invoices(supply_id);
CREATE INDEX idx_invoices_extraction ON invoices(extraction_status);

-- Prescorings
CREATE TABLE prescorings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  cups TEXT,
  tariff TEXT,
  status prescoring_status NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  requested_by UUID NOT NULL REFERENCES users_profile(id)
);

CREATE INDEX idx_prescorings_status ON prescorings(status);

-- Studies (Estudios)
CREATE TABLE studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  type study_type NOT NULL,
  input_data JSONB,
  result_data JSONB,
  report_url TEXT,
  status study_status NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL REFERENCES users_profile(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_studies_supply ON studies(supply_id);

-- Contracts (Contratos)
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  type contract_type NOT NULL,
  comercializadora_id UUID REFERENCES comercializadoras(id),
  file_url TEXT,
  signed_file_url TEXT,
  docusign_envelope_id TEXT,
  status contract_status NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users_profile(id)
);

CREATE INDEX idx_contracts_client ON contracts(client_id);
CREATE INDEX idx_contracts_supply ON contracts(supply_id);
CREATE INDEX idx_contracts_status ON contracts(status);

-- Subscriptions (Suscripciones)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  model subscription_model NOT NULL,
  percentage_value DECIMAL(5,2),
  plan_tier DECIMAL(8,2),
  payment_mode payment_mode NOT NULL DEFAULT 'quarterly',
  annual_amount DECIMAL(10,2),
  status subscription_status NOT NULL DEFAULT 'pending_activation',
  gocardless_mandate_id TEXT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  next_billing_date DATE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_client ON subscriptions(client_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_next_billing ON subscriptions(next_billing_date);

-- Billing (Facturacion propia Voltis)
CREATE TABLE billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  invoice_number TEXT NOT NULL UNIQUE,
  concept TEXT NOT NULL,
  base_amount DECIMAL(10,2) NOT NULL,
  vat_rate DECIMAL(5,2) NOT NULL DEFAULT 21.00,
  vat_amount DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status billing_status NOT NULL DEFAULT 'draft',
  gocardless_payment_id TEXT,
  file_url TEXT,
  period_start DATE,
  period_end DATE,
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_client ON billing(client_id);
CREATE INDEX idx_billing_status ON billing(status);
CREATE INDEX idx_billing_due_date ON billing(due_date);
CREATE INDEX idx_billing_invoice_number ON billing(invoice_number);

-- Comparatives (Comparativas de ahorro)
CREATE TABLE comparatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'economico',
  old_invoices UUID[] DEFAULT '{}',
  new_invoices UUID[] DEFAULT '{}',
  old_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  new_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  savings_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  savings_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  report_url TEXT,
  sent_to_client BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ,
  quarter TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comparatives_supply ON comparatives(supply_id);

-- Objectives (Objetivos de equipo)
CREATE TABLE objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  target_type objective_target NOT NULL DEFAULT 'contracts',
  tariff_filter TEXT,
  target_count INTEGER NOT NULL,
  current_count INTEGER NOT NULL DEFAULT 0,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  scope objective_scope NOT NULL DEFAULT 'team',
  assigned_to UUID REFERENCES users_profile(id),
  created_by UUID NOT NULL REFERENCES users_profile(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Appointments (Citas)
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  supply_id UUID REFERENCES supplies(id),
  type appointment_type NOT NULL DEFAULT 'presentation',
  scheduled_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  commercial_id UUID NOT NULL REFERENCES users_profile(id),
  status appointment_status NOT NULL DEFAULT 'scheduled',
  outcome appointment_outcome,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_commercial ON appointments(commercial_id);
CREATE INDEX idx_appointments_date ON appointments(scheduled_at);

-- Activity Log
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  performed_by UUID NOT NULL REFERENCES users_profile(id),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX idx_activity_date ON activity_log(created_at DESC);

-- Supply State Log (historial de cambios de estado)
CREATE TABLE supply_state_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  from_state supply_status,
  to_state supply_status NOT NULL,
  changed_by UUID NOT NULL REFERENCES users_profile(id),
  notes TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_state_log_supply ON supply_state_log(supply_id);

-- ============================================
-- 3. FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_clients_updated
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_supplies_updated
  BEFORE UPDATE ON supplies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users_profile (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    'commercial'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Log supply state changes
CREATE OR REPLACE FUNCTION log_supply_state_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO supply_state_log (supply_id, from_state, to_state, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_supply_state_change
  AFTER UPDATE ON supplies
  FOR EACH ROW EXECUTE FUNCTION log_supply_state_change();

-- Auto-calculate billing VAT
CREATE OR REPLACE FUNCTION calculate_billing_vat()
RETURNS TRIGGER AS $$
BEGIN
  NEW.vat_amount = ROUND(NEW.base_amount * (NEW.vat_rate / 100), 2);
  NEW.total_amount = NEW.base_amount + NEW.vat_amount;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_billing_vat
  BEFORE INSERT OR UPDATE OF base_amount, vat_rate ON billing
  FOR EACH ROW EXECUTE FUNCTION calculate_billing_vat();

-- Auto-calculate annual amount for subscriptions
CREATE OR REPLACE FUNCTION calculate_annual_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.model = 'fixed' AND NEW.plan_tier IS NOT NULL THEN
    NEW.annual_amount = ROUND(NEW.plan_tier * 4 * 1.21, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_subscription_annual
  BEFORE INSERT OR UPDATE OF plan_tier, model ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION calculate_annual_amount();

-- Generate sequential invoice numbers
CREATE SEQUENCE IF NOT EXISTS billing_invoice_seq START 1;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number = 'VOLT-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(nextval('billing_invoice_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_billing_invoice_number
  BEFORE INSERT ON billing
  FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();

-- ============================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE users_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercializadoras ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescorings ENABLE ROW LEVEL SECURITY;
ALTER TABLE studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE comparatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_state_log ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper: check if user has specific permission
CREATE OR REPLACE FUNCTION has_permission(perm TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid()
    AND (role = 'admin' OR permissions->>perm = 'true')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Users: everyone sees their own, admins see all
CREATE POLICY "users_select" ON users_profile
  FOR SELECT USING (id = auth.uid() OR is_admin());

CREATE POLICY "users_update_own" ON users_profile
  FOR UPDATE USING (id = auth.uid() OR is_admin());

-- Comercializadoras: everyone reads, admins modify
CREATE POLICY "comercializadoras_select" ON comercializadoras
  FOR SELECT USING (true);

CREATE POLICY "comercializadoras_modify" ON comercializadoras
  FOR ALL USING (is_admin());

-- Clients: commercial sees own, admin sees all
CREATE POLICY "clients_select" ON clients
  FOR SELECT USING (
    commercial_id = auth.uid() OR is_admin() OR has_permission('all_clients')
  );

CREATE POLICY "clients_insert" ON clients
  FOR INSERT WITH CHECK (
    commercial_id = auth.uid() OR is_admin()
  );

CREATE POLICY "clients_update" ON clients
  FOR UPDATE USING (
    commercial_id = auth.uid() OR is_admin()
  );

CREATE POLICY "clients_delete" ON clients
  FOR DELETE USING (is_admin());

-- Supplies: via client ownership
CREATE POLICY "supplies_select" ON supplies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = supplies.client_id
      AND (clients.commercial_id = auth.uid() OR is_admin() OR has_permission('all_clients'))
    )
  );

CREATE POLICY "supplies_insert" ON supplies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = client_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "supplies_update" ON supplies
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = supplies.client_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

-- Invoices: via supply -> client ownership
CREATE POLICY "invoices_select" ON invoices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = invoices.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin() OR has_permission('all_clients'))
    )
  );

CREATE POLICY "invoices_insert" ON invoices
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

-- Prescorings: admins and users with permission
CREATE POLICY "prescorings_select" ON prescorings
  FOR SELECT USING (has_permission('prescorings'));

CREATE POLICY "prescorings_modify" ON prescorings
  FOR ALL USING (has_permission('prescorings'));

-- Studies: via supply -> client ownership
CREATE POLICY "studies_select" ON studies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = studies.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin() OR has_permission('all_clients'))
    )
  );

CREATE POLICY "studies_modify" ON studies
  FOR ALL USING (is_admin() OR has_permission('reports'));

-- Contracts: via client ownership
CREATE POLICY "contracts_select" ON contracts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = contracts.client_id
      AND (clients.commercial_id = auth.uid() OR is_admin() OR has_permission('all_clients'))
    )
  );

CREATE POLICY "contracts_modify" ON contracts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = contracts.client_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

-- Subscriptions: billing permission required for modify
CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = subscriptions.client_id
      AND (clients.commercial_id = auth.uid() OR is_admin() OR has_permission('all_clients'))
    )
  );

CREATE POLICY "subscriptions_modify" ON subscriptions
  FOR ALL USING (has_permission('billing'));

-- Billing: billing permission
CREATE POLICY "billing_select" ON billing
  FOR SELECT USING (has_permission('billing'));

CREATE POLICY "billing_modify" ON billing
  FOR ALL USING (has_permission('billing'));

-- Comparatives: via supply ownership
CREATE POLICY "comparatives_select" ON comparatives
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = comparatives.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin() OR has_permission('all_clients'))
    )
  );

-- Objectives: everyone reads, admins modify
CREATE POLICY "objectives_select" ON objectives
  FOR SELECT USING (true);

CREATE POLICY "objectives_modify" ON objectives
  FOR ALL USING (is_admin());

-- Appointments: commercial sees own, admin sees all
CREATE POLICY "appointments_select" ON appointments
  FOR SELECT USING (
    commercial_id = auth.uid() OR is_admin()
  );

CREATE POLICY "appointments_modify" ON appointments
  FOR ALL USING (
    commercial_id = auth.uid() OR is_admin()
  );

-- Activity log & state log: everyone reads, system inserts
CREATE POLICY "activity_log_select" ON activity_log
  FOR SELECT USING (true);

CREATE POLICY "activity_log_insert" ON activity_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "state_log_select" ON supply_state_log
  FOR SELECT USING (true);

CREATE POLICY "state_log_insert" ON supply_state_log
  FOR INSERT WITH CHECK (true);

-- ============================================
-- 5. SEED DATA: Comercializadoras
-- ============================================

INSERT INTO comercializadoras (name, tariff_types, service_type, signing_method) VALUES
  ('Gana Energia', ARRAY['2.0'], 'luz', 'telematico'),
  ('GALP', ARRAY['3.0', '6.1'], 'luz', 'presencial'),
  ('AXPO', ARRAY['3.0', '6.1'], 'luz', 'telematico'),
  ('INNER', ARRAY['3.0', '6.1'], 'luz', 'telematico'),
  ('Total Energies', ARRAY['3.0', '6.1'], 'luz', 'telematico'),
  ('Repsol', ARRAY['3.0', '6.1'], 'luz', 'telematico'),
  ('GALP Gas', ARRAY['RL1', 'RL2', 'RL3', 'RL4'], 'gas', 'presencial'),
  ('O2', ARRAY['O2'], 'telefonia', 'telematico'),
  ('Euskaltel', ARRAY['Euskaltel'], 'telefonia', 'telematico');

-- ============================================
-- 6. STORAGE BUCKETS (run separately in Supabase dashboard)
-- ============================================
-- Create these buckets manually in Supabase Storage:
-- 1. "invoices" (private) - facturas de clientes
-- 2. "contracts" (private) - contratos generados y firmados
-- 3. "reports" (private) - informes y comparativas
-- 4. "certificates" (private) - certificados bancarios
-- 5. "avatars" (public) - fotos de perfil
