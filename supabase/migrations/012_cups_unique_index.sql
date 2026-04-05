-- ============================================================================
-- Migration 012: UNIQUE partial index on supplies.cups
--
-- Prevents race conditions where multiple channels (Telegram, email, web)
-- simultaneously create duplicate supplies for the same CUPS.
-- Only enforced for non-null, non-empty CUPS values.
-- ============================================================================

-- Unique partial index: only one supply per CUPS (ignoring nulls and empty strings)
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplies_cups_unique
  ON supplies (cups)
  WHERE cups IS NOT NULL AND cups != '';

-- Also add an index on invoices for faster period queries
CREATE INDEX IF NOT EXISTS idx_invoices_period
  ON invoices (supply_id, period_start, period_end);
