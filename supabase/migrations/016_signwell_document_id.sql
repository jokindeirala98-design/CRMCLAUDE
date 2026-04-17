-- Migration 016: Add signwell_document_id to contracts table
-- Mirrors docusign_envelope_id for the SignWell e-signature integration

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS signwell_document_id TEXT DEFAULT NULL;

-- Index for webhook lookups by document ID
CREATE INDEX IF NOT EXISTS idx_contracts_signwell_document_id
  ON contracts (signwell_document_id)
  WHERE signwell_document_id IS NOT NULL;

COMMENT ON COLUMN contracts.signwell_document_id IS
  'SignWell document ID — set when contract is sent for e-signature via SignWell API';
