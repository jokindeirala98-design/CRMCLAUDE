-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: contratos de servicio Voltis (propuesta + contrato de prestación)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Campos de ahorro en clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS ahorro_sugerido        numeric(12,2),
  ADD COLUMN IF NOT EXISTS ahorro_pendiente_revision boolean DEFAULT false;

-- 2. Tabla service_contracts
CREATE TABLE IF NOT EXISTS service_contracts (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id             uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

  -- Tipo y precio
  contract_type         text NOT NULL CHECK (contract_type IN ('porcentaje','suscripcion')),
  is_renewal            boolean NOT NULL DEFAULT false,
  ahorro_confirmado     numeric(12,2),          -- validado por el admin
  fee_percentage        numeric(5,2) DEFAULT 25, -- siempre 25%
  fee_amount            numeric(12,2),           -- ahorro_confirmado * fee_percentage/100
  subscription_monthly  numeric(10,2),           -- para tipo suscripcion (default 19.99)

  -- Forma de pago: A=único inicio, B=trimestral vencido, C=50%+4 cuotas, D=único vencimiento
  payment_modality      text NOT NULL DEFAULT 'A' CHECK (payment_modality IN ('A','B','C','D')),

  -- Fechas
  start_date            date NOT NULL,
  end_date              date,                    -- calculado: start_date + 12 meses

  -- Datos del firmante (representante del cliente)
  representative_name   text,
  representative_nif    text,
  signing_location      text,                    -- ciudad donde se formaliza

  -- Estado del documento
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','signed','active','expired')),
  proposal_url          text,
  contract_url          text,
  notes                 text,

  created_by            uuid REFERENCES users_profile(id),
  created_at            timestamptz DEFAULT now() NOT NULL,
  updated_at            timestamptz DEFAULT now() NOT NULL
);

-- Índice para consultas por cliente
CREATE INDEX IF NOT EXISTS service_contracts_client_id_idx ON service_contracts(client_id);

-- RLS
ALTER TABLE service_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users manage service_contracts" ON service_contracts;
CREATE POLICY "Authenticated users manage service_contracts"
  ON service_contracts FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_service_contracts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_contracts_updated_at ON service_contracts;
CREATE TRIGGER service_contracts_updated_at
  BEFORE UPDATE ON service_contracts
  FOR EACH ROW EXECUTE FUNCTION update_service_contracts_updated_at();
