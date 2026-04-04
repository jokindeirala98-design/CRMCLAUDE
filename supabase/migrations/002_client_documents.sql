-- Separate CIF, NIF and IBAN as independent fields (text + file each)
-- Replace old single cif_nif column with separate cif and nif columns

-- CIF fields
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cif TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cif_file_url TEXT DEFAULT NULL;

-- NIF fields
ALTER TABLE clients ADD COLUMN IF NOT EXISTS nif TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS nif_file_url TEXT DEFAULT NULL;

-- IBAN fields (bank certificate)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS iban TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS iban_file_url TEXT DEFAULT NULL;

-- Migrate old cif_nif data to cif column (best guess: if starts with letter = CIF, else NIF)
UPDATE clients SET cif = cif_nif WHERE cif_nif IS NOT NULL AND cif_nif ~ '^[A-Z]';
UPDATE clients SET nif = cif_nif WHERE cif_nif IS NOT NULL AND cif_nif ~ '^[0-9]';

-- Keep cif_nif column for backwards compatibility but add comments
COMMENT ON COLUMN clients.cif IS 'CIF text value (empresa)';
COMMENT ON COLUMN clients.cif_file_url IS 'CIF document file URL';
COMMENT ON COLUMN clients.nif IS 'NIF text value (particular)';
COMMENT ON COLUMN clients.nif_file_url IS 'NIF document file URL';
COMMENT ON COLUMN clients.iban IS 'IBAN text value';
COMMENT ON COLUMN clients.iban_file_url IS 'IBAN / bank certificate document file URL';
