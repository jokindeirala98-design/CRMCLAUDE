-- Integración GanaEnergia
-- ------------------------------------------------------------
-- 3 tablas:
--   gana_tokens     → singleton con el JWT (no caduca, pero refrescable)
--   gana_tarifas    → cache de tarifas 2.0TD (24H, Tramos, Mercado) refrescada manualmente
--   gana_contracts  → contratos generados desde el CRM con su signaturitUrl
--
-- Todas las tablas viven detrás de la service_role; los comerciales NO leen
-- credenciales ni el token. Las consultas de tarifas pasan por endpoints API
-- que aplican RLS estándar.

-- 1. Token singleton ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gana_tokens (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- fila única
  token        text NOT NULL,
  username     text,
  obtained_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gana_tokens ENABLE ROW LEVEL SECURITY;

-- Solo service_role accede al token. NO existe ninguna política que permita
-- a usuarios anónimos o autenticados leerlo. Deliberado: las API calls al
-- cliente Gana pasan SIEMPRE por endpoints server-side.

-- 2. Cache de tarifas --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gana_tarifas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador interno de Gana
  external_id      text,                              -- id que devuelve la API
  nombre           text NOT NULL,                     -- "Fija 24H", "Tramos Horarios", "Mercado"
  tipo             text NOT NULL CHECK (tipo IN ('fija_24h', 'tramos', 'mercado')),
  tarifa_atr       text NOT NULL DEFAULT '2.0TD',     -- por ahora solo 2.0TD
  -- Precios (€/kWh, €/kW·día). Pueden ser NULL si Gana no los devuelve.
  precio_p1        numeric(10,6),
  precio_p2        numeric(10,6),
  precio_p3        numeric(10,6),
  potencia_p1      numeric(10,6),
  potencia_p2      numeric(10,6),
  -- Mercado indexado tiene +50€/año extra
  extras_anuales   numeric(10,2) DEFAULT 0,
  -- Datos brutos para auditoría / cambios de esquema futuros
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,
  vigente          boolean NOT NULL DEFAULT true,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gana_tarifas_vigente ON public.gana_tarifas(vigente) WHERE vigente = true;
CREATE INDEX IF NOT EXISTS idx_gana_tarifas_tipo    ON public.gana_tarifas(tipo);

ALTER TABLE public.gana_tarifas ENABLE ROW LEVEL SECURITY;

-- Lectura para todos los autenticados (las tarifas no son secretas)
DROP POLICY IF EXISTS "gana_tarifas_read" ON public.gana_tarifas;
CREATE POLICY "gana_tarifas_read" ON public.gana_tarifas
  FOR SELECT
  TO authenticated
  USING (true);

-- Escritura solo service_role (refresco desde endpoint admin)

-- 3. Contratos generados -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gana_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id        uuid REFERENCES public.supplies(id) ON DELETE SET NULL,
  client_id        uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  -- Tarifa elegida
  tarifa_id        uuid REFERENCES public.gana_tarifas(id) ON DELETE SET NULL,
  tarifa_tipo      text CHECK (tarifa_tipo IN ('fija_24h', 'tramos', 'mercado')),
  -- Resultado de la API
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'signed', 'failed', 'cancelled')),
  gana_contract_id text,
  signaturit_url   text,
  -- Payload enviado a Gana (para reenvío/debug)
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  response         jsonb,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gana_contracts_supply  ON public.gana_contracts(supply_id);
CREATE INDEX IF NOT EXISTS idx_gana_contracts_client  ON public.gana_contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_gana_contracts_status  ON public.gana_contracts(status);
CREATE INDEX IF NOT EXISTS idx_gana_contracts_creator ON public.gana_contracts(created_by);

ALTER TABLE public.gana_contracts ENABLE ROW LEVEL SECURITY;

-- Admins ven todo, comerciales solo los que crearon
DROP POLICY IF EXISTS "gana_contracts_read" ON public.gana_contracts;
CREATE POLICY "gana_contracts_read" ON public.gana_contracts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.id = auth.uid()
        AND (up.role = 'admin' OR public.gana_contracts.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "gana_contracts_insert" ON public.gana_contracts;
CREATE POLICY "gana_contracts_insert" ON public.gana_contracts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
  );

DROP POLICY IF EXISTS "gana_contracts_update" ON public.gana_contracts;
CREATE POLICY "gana_contracts_update" ON public.gana_contracts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.id = auth.uid()
        AND (up.role = 'admin' OR public.gana_contracts.created_by = auth.uid())
    )
  );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.gana_contracts_touch_updated()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gana_contracts_touch ON public.gana_contracts;
CREATE TRIGGER trg_gana_contracts_touch
  BEFORE UPDATE ON public.gana_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.gana_contracts_touch_updated();
