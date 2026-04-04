-- =============================================
-- Migration 004: Features Expansion
-- Tasks client link, Incidents, Commissions, Invoice extraction fields
-- =============================================

-- ═══════ TASKS: add client association ═══════
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);

-- ═══════ INCIDENTS ═══════
CREATE TYPE incident_priority AS ENUM ('high', 'medium', 'low');
CREATE TYPE incident_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority incident_priority NOT NULL DEFAULT 'medium',
  status incident_status NOT NULL DEFAULT 'open',
  assigned_to UUID REFERENCES users_profile(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users_profile(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Incident messages (chat thread)
CREATE TABLE IF NOT EXISTS incident_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users_profile(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_incidents_client ON incidents(client_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incident_messages_incident ON incident_messages(incident_id);

-- RLS for incidents
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY incidents_admin_all ON incidents
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY incidents_own ON incidents
  FOR SELECT USING (created_by = auth.uid() OR assigned_to = auth.uid());

CREATE POLICY incidents_update_assigned ON incidents
  FOR UPDATE USING (assigned_to = auth.uid() OR created_by = auth.uid());

CREATE POLICY incident_messages_admin_all ON incident_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY incident_messages_related ON incident_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM incidents
      WHERE incidents.id = incident_messages.incident_id
      AND (incidents.created_by = auth.uid() OR incidents.assigned_to = auth.uid())
    )
  );

CREATE POLICY incident_messages_insert ON incident_messages
  FOR INSERT WITH CHECK (author_id = auth.uid());

-- Triggers
CREATE TRIGGER set_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- ═══════ COMMISSIONS ═══════
CREATE TYPE commission_status AS ENUM ('pending', 'approved', 'paid');

CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_id UUID NOT NULL REFERENCES users_profile(id),
  supply_id UUID REFERENCES supplies(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  month TEXT NOT NULL, -- YYYY-MM
  concept TEXT, -- e.g. 'Cierre suministro luz 2.0TD'
  status commission_status NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_commissions_commercial ON commissions(commercial_id, month);
CREATE INDEX idx_commissions_status ON commissions(status);

ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY commissions_admin_all ON commissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY commissions_own ON commissions
  FOR SELECT USING (commercial_id = auth.uid());

-- ═══════ INVOICES: add extraction fields ═══════
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS holder_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supply_address TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emission_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS detected_type TEXT; -- luz/gas/telefonia
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS detected_tariff TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS detected_comercializadora TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS detected_cups TEXT;

-- ═══════ SUPPLIES: update tariff options ═══════
-- Gas tariffs should be RL1-RL4, Luz should be 2.0, 3.0, 6.1
-- No schema change needed, just update the UI
