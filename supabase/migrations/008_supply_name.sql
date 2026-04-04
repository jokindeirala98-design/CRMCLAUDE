-- ============================================================================
-- Migration 008: Add `name` column to supplies for custom supply labels
-- Users can optionally name their supplies (e.g. "Oficina Central", "Nave 2")
-- ============================================================================

ALTER TABLE supplies ADD COLUMN IF NOT EXISTS name text DEFAULT NULL;
