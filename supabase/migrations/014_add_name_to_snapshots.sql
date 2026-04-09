-- ============================================================================
-- Migration 014: Add `name` column to consumption_snapshots
-- This allows syncing the supply alias/name directly into the snapshots.
-- ============================================================================

ALTER TABLE consumption_snapshots ADD COLUMN IF NOT EXISTS name text;
