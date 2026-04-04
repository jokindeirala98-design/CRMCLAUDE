-- Add power_study_result column to supplies table
ALTER TABLE supplies ADD COLUMN IF NOT EXISTS power_study_result JSONB;
