-- ============================================
-- Migration 011: Consumption Snapshots & Audit Reports
-- For Ayuntamiento energy distribution analysis
-- ============================================

-- Consumption snapshots - consolidated consumption data per supply
CREATE TABLE consumption_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,

  -- Supply data snapshot
  cups TEXT NOT NULL,
  tariff TEXT,
  supply_type TEXT CHECK (supply_type IN ('luz', 'gas')),
  comercializadora TEXT,
  address TEXT,

  -- Potencias contratadas (kW) - only for electricity
  potencia_p1 DECIMAL, potencia_p2 DECIMAL, potencia_p3 DECIMAL,
  potencia_p4 DECIMAL, potencia_p5 DECIMAL, potencia_p6 DECIMAL,

  -- Consumos por periodo (kWh)
  consumo_p1 DECIMAL, consumo_p2 DECIMAL, consumo_p3 DECIMAL,
  consumo_p4 DECIMAL, consumo_p5 DECIMAL, consumo_p6 DECIMAL,
  consumo_total DECIMAL,

  -- Data origin & quality
  source TEXT DEFAULT 'manual' CHECK (source IN ('invoice_extraction', 'excel_import', 'sips', 'manual')),
  validation_status TEXT DEFAULT 'OK' CHECK (validation_status IN ('OK', 'Revisar', 'Incompleto')),
  observations TEXT,
  confidence_json JSONB,

  -- Period
  periodo TEXT,

  -- Control
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users_profile(id)
);

-- Audit reports - generated reports for ayuntamientos
CREATE TABLE audit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'stale')),

  -- Frozen data snapshot at report generation time
  rows_snapshot JSONB,

  -- Editable report content
  cover_image_url TEXT,
  informe_breve TEXT,
  notas_optimizacion JSONB,

  -- Metadata
  generated_by UUID REFERENCES users_profile(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_consumption_client ON consumption_snapshots(client_id);
CREATE INDEX idx_consumption_supply ON consumption_snapshots(supply_id);
CREATE INDEX idx_consumption_tariff ON consumption_snapshots(client_id, tariff);
CREATE INDEX idx_audit_report_client ON audit_reports(client_id);

-- RLS Policies
ALTER TABLE consumption_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view consumption snapshots of their clients"
  ON consumption_snapshots FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE commercial_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can insert consumption snapshots for their clients"
  ON consumption_snapshots FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE commercial_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can update consumption snapshots of their clients"
  ON consumption_snapshots FOR UPDATE
  USING (
    client_id IN (
      SELECT id FROM clients WHERE commercial_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can delete consumption snapshots of their clients"
  ON consumption_snapshots FOR DELETE
  USING (
    client_id IN (
      SELECT id FROM clients WHERE commercial_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can view audit reports of their clients"
  ON audit_reports FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE commercial_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can manage audit reports for their clients"
  ON audit_reports FOR ALL
  USING (
    client_id IN (
      SELECT id FROM clients WHERE commercial_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );
