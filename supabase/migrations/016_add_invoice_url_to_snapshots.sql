-- ============================================
-- Migration 016: Add invoice_file_url to consumption_snapshots
-- This column was missing, causing sync-consumption inserts to fail
-- ============================================

ALTER TABLE consumption_snapshots ADD COLUMN IF NOT EXISTS invoice_file_url TEXT;
