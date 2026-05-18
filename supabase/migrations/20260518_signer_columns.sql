-- 2026-05-18 — Representante legal (firmante) en clientes tipo empresa
--
-- En empresas, el CIF es de la empresa y el NIF que aporta el comercial
-- es el del representante legal que firmará en su nombre. Hasta ahora
-- el bot estaba sobreescribiendo `name`/`cif_nif` con los datos del
-- representante, machacando la información de la empresa.
--
-- Nuevas columnas:
--   signer_name  TEXT — nombre del representante legal (persona física)
--   signer_nif   TEXT — DNI/NIF del representante legal
--
-- Para particulares estos campos son NULL (su DNI sigue en `nif`).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS signer_name TEXT,
  ADD COLUMN IF NOT EXISTS signer_nif  TEXT;

COMMENT ON COLUMN public.clients.signer_name IS
  'Empresa: nombre del representante legal que firma. Particular: NULL (el cliente firma como sí mismo).';
COMMENT ON COLUMN public.clients.signer_nif IS
  'Empresa: NIF del representante legal. Particular: NULL (el cliente firma con su propio NIF).';
