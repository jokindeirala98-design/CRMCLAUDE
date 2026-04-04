-- Migration: Add new fields to prescorings table for Excel-like prescoring management
-- Fields extracted from invoices: cups, client_name (nombre), cif, producto, tarifa, direccion_fiscal
-- Fields filled manually: consumo_anual, entidad, telefono, poblacion

ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS cif TEXT;
ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS producto TEXT;
ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS consumo_anual TEXT;
ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS entidad TEXT;
ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS poblacion TEXT;
ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS direccion_fiscal TEXT;
ALTER TABLE prescorings ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- Add index for faster filtering on sent_at
CREATE INDEX IF NOT EXISTS idx_prescorings_sent_at ON prescorings(sent_at);
