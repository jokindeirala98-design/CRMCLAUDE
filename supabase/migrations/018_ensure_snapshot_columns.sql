-- ============================================================================
-- Migration 018: Ensure all consumption_snapshots columns exist
-- Run this in Supabase SQL editor if the "Estudios de Suministro" modal
-- shows 0 suministros or an error after clicking "Cargar datos".
-- Safe to re-run — all statements use IF NOT EXISTS.
-- ============================================================================

-- From migration 014: supply alias
ALTER TABLE consumption_snapshots ADD COLUMN IF NOT EXISTS name TEXT;

-- From migration 016 (may conflict with 016_signwell_document_id.sql numbering)
ALTER TABLE consumption_snapshots ADD COLUMN IF NOT EXISTS invoice_file_url TEXT;
