-- Portal de cliente + Partners externos (Kivatio, etc.)
-- ============================================================

-- 1. Acceso magic link de clientes al portal AnualEconomics
CREATE TABLE IF NOT EXISTS public.client_portal_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,                  -- 64 chars URL-safe
  type         text NOT NULL DEFAULT 'magic_link' CHECK (type IN ('magic_link')),
  scopes       text[] DEFAULT ARRAY['read:overview','read:supply','download'],
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,                            -- null = nunca expira
  -- Unicidad: un solo link activo por cliente (parcial)
  CONSTRAINT chk_token_min_len CHECK (length(token) >= 32)
);

-- Índice único parcial: solo 1 magic_link activo por cliente
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_portal_active
  ON public.client_portal_access(client_id, type)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_portal_token ON public.client_portal_access(token);
CREATE INDEX IF NOT EXISTS idx_client_portal_client ON public.client_portal_access(client_id);

ALTER TABLE public.client_portal_access ENABLE ROW LEVEL SECURITY;

-- Lectura: solo admins
DROP POLICY IF EXISTS "client_portal_admin_read" ON public.client_portal_access;
CREATE POLICY "client_portal_admin_read" ON public.client_portal_access
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

DROP POLICY IF EXISTS "client_portal_admin_write" ON public.client_portal_access;
CREATE POLICY "client_portal_admin_write" ON public.client_portal_access
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- 2. Partners externos (Kivatio…)
CREATE TABLE IF NOT EXISTS public.partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,                  -- 'kivatio'
  name          text NOT NULL,                          -- 'Kivatio'
  api_key_hash  text NOT NULL,                          -- bcrypt hash
  api_key_preview text,                                  -- 'vlt_live_xxx…' primeras y últimas chars
  active        boolean NOT NULL DEFAULT true,
  scopes        text[] DEFAULT ARRAY['read:overview','read:supply','download'],
  rate_limit_per_min integer DEFAULT 100,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partners_admin" ON public.partners;
CREATE POLICY "partners_admin" ON public.partners
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- Insertar partner Kivatio inicial (sin key — se genera con UPDATE manual posterior)
INSERT INTO public.partners (slug, name, api_key_hash, api_key_preview, active)
VALUES ('kivatio', 'Kivatio', '__PENDING__', NULL, false)
ON CONFLICT (slug) DO NOTHING;

-- 3. Asignación cliente → partner
CREATE TABLE IF NOT EXISTS public.partner_clients (
  partner_id  uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  PRIMARY KEY (partner_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_clients_partner ON public.partner_clients(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_clients_client ON public.partner_clients(client_id);

ALTER TABLE public.partner_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_clients_admin" ON public.partner_clients;
CREATE POLICY "partner_clients_admin" ON public.partner_clients
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- 4. Log de accesos al portal (auditoría)
CREATE TABLE IF NOT EXISTS public.portal_access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  access_type  text NOT NULL CHECK (access_type IN ('magic_link', 'partner_api')),
  partner_id   uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  endpoint     text,
  ip           inet,
  user_agent   text,
  status       integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_log_client ON public.portal_access_log(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_log_created ON public.portal_access_log(created_at DESC);

ALTER TABLE public.portal_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "portal_log_admin" ON public.portal_access_log;
CREATE POLICY "portal_log_admin" ON public.portal_access_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );
