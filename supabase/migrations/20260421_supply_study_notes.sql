-- Add study_notes column to supplies for admin internal notes on economic studies
ALTER TABLE supplies
  ADD COLUMN IF NOT EXISTS study_notes text;
