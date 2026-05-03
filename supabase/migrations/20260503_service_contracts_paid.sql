-- Añadir campo paid a service_contracts para tracking de cobro
ALTER TABLE service_contracts
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
