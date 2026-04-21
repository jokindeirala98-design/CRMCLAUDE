-- ================================================================
-- Contracts: new fields for Sheets sync + Voltis contract generation
-- ================================================================
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS firmante           text,
  ADD COLUMN IF NOT EXISTS dni_firmante       text,
  ADD COLUMN IF NOT EXISTS tramite            text DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS producto           text,
  ADD COLUMN IF NOT EXISTS observaciones      text,
  ADD COLUMN IF NOT EXISTS consumo_anual      numeric,
  ADD COLUMN IF NOT EXISTS servicio           text DEFAULT 'electricity',
  ADD COLUMN IF NOT EXISTS fecha_activacion   date,
  ADD COLUMN IF NOT EXISTS comercializadora_name text,
  ADD COLUMN IF NOT EXISTS sheets_synced_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voltis_contract_type text, -- 'colaboracion' | 'propuesta'
  ADD COLUMN IF NOT EXISTS voltis_file_url    text;   -- generated Voltis contract PDF

-- ================================================================
-- Clients: "cliente caído" flag
-- ================================================================
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_fallen          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallen_at          timestamptz,
  ADD COLUMN IF NOT EXISTS fallen_reason      text;

-- Index for quick filtering of fallen clients
CREATE INDEX IF NOT EXISTS idx_clients_is_fallen ON clients(is_fallen) WHERE is_fallen = true;

-- ================================================================
-- Disable RLS on contracts (internal CRM)
-- ================================================================
ALTER TABLE contracts DISABLE ROW LEVEL SECURITY;
