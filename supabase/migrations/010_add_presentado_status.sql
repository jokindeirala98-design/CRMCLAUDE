-- ============================================
-- Migration 010: Add 'presentado' to supply_status enum
-- ============================================
-- The application code uses 'presentado' as a status after 'estudio_completado',
-- but this value was missing from the PostgreSQL enum, causing silent update failures.

ALTER TYPE supply_status ADD VALUE IF NOT EXISTS 'presentado' AFTER 'estudio_completado';
