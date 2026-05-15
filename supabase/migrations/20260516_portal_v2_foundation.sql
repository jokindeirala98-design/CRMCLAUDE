-- ════════════════════════════════════════════════════════════════════════
-- Portal Cliente v2 — Fundación
-- ════════════════════════════════════════════════════════════════════════
-- Sustituye el sistema magic-link-por-URL del portal v1 por una
-- plataforma cliente con login por email, sesiones persistentes,
-- multi-usuario por cliente y log de auditoría completo.
--
-- IMPORTANTE: NO borramos las tablas v1 (client_portal_access, partners,
-- partner_clients, portal_access_log). El portal v1 sigue funcionando
-- mientras migramos. La cohabitación es intencional.
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. portal_users — usuarios del portal cliente
-- ─────────────────────────────────────────────────────────────────────────
-- Cada cliente puede tener varios portal_users con distintos roles.
-- Estos usuarios son DISTINTOS de auth.users (que es para el CRM interno
-- de Voltis). Cero solape entre los dos sistemas.
CREATE TABLE IF NOT EXISTS public.portal_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email           text NOT NULL,
  display_name    text,
  role            text NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('viewer', 'admin')),
  invited_by      uuid REFERENCES public.portal_users(id) ON DELETE SET NULL,
  invited_by_crm  uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  active          boolean NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_portal_users_email_per_client UNIQUE (client_id, email)
);

CREATE INDEX IF NOT EXISTS idx_portal_users_client ON public.portal_users(client_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_portal_users_email  ON public.portal_users(lower(email)) WHERE active = true;

ALTER TABLE public.portal_users ENABLE ROW LEVEL SECURITY;

-- Lectura: solo admins del CRM ven la tabla completa.
DROP POLICY IF EXISTS "portal_users_admin_read" ON public.portal_users;
CREATE POLICY "portal_users_admin_read" ON public.portal_users
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

DROP POLICY IF EXISTS "portal_users_admin_write" ON public.portal_users;
CREATE POLICY "portal_users_admin_write" ON public.portal_users
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- Los endpoints del PORTAL no usan auth.uid() — usan SUPABASE_SERVICE_ROLE_KEY
-- en el server con validación previa del token de sesión (ver auth-portal.ts).
-- Esto deliberado: queremos que el portal nunca dependa de Supabase Auth.

-- ─────────────────────────────────────────────────────────────────────────
-- 2. portal_magic_links — solicitudes de acceso por email
-- ─────────────────────────────────────────────────────────────────────────
-- Tokens efímeros (30 min). Uso único. Tras canje se crea una sesión.
CREATE TABLE IF NOT EXISTS public.portal_magic_links (
  token           text PRIMARY KEY,                       -- 64+ chars URL-safe
  portal_user_id  uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  email_lower     text NOT NULL,                          -- snapshot por si cambia el email luego
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  request_ip      inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_magic_token_len CHECK (length(token) >= 32)
);

CREATE INDEX IF NOT EXISTS idx_portal_magic_user ON public.portal_magic_links(portal_user_id, used_at);
CREATE INDEX IF NOT EXISTS idx_portal_magic_email ON public.portal_magic_links(email_lower, used_at);

ALTER TABLE public.portal_magic_links ENABLE ROW LEVEL SECURITY;
-- Solo admin CRM puede leer (debugging). Los endpoints del portal usan service role.
DROP POLICY IF EXISTS "portal_magic_admin_read" ON public.portal_magic_links;
CREATE POLICY "portal_magic_admin_read" ON public.portal_magic_links
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 3. portal_sessions — sesiones persistentes del portal
-- ─────────────────────────────────────────────────────────────────────────
-- Tras canjear un magic link, se crea una sesión que dura 30 días (renovable
-- al usarse). El token se guarda HASHEADO con sha256 — el cliente solo lo
-- tiene en la cookie httpOnly.
CREATE TABLE IF NOT EXISTS public.portal_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id  uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,                   -- sha256 hex
  expires_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  user_agent      text,
  ip              inet,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_user   ON public.portal_sessions(portal_user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_token  ON public.portal_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_sessions_expiry ON public.portal_sessions(expires_at) WHERE revoked_at IS NULL;

ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "portal_sessions_admin" ON public.portal_sessions;
CREATE POLICY "portal_sessions_admin" ON public.portal_sessions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4. portal_audit_log — auditoría de todo lo que pasa en el portal
-- ─────────────────────────────────────────────────────────────────────────
-- Registramos cada acción significativa: login, logout, vista de factura,
-- descarga, invitar usuario, revocar usuario, etc. Útil para auditorías
-- GDPR y para responder al cliente "¿quién entró este mes?".
CREATE TABLE IF NOT EXISTS public.portal_audit_log (
  id              bigserial PRIMARY KEY,
  portal_user_id  uuid REFERENCES public.portal_users(id) ON DELETE SET NULL,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  action          text NOT NULL,
  -- 'request_magic_link' | 'login' | 'logout' | 'view_overview' |
  -- 'view_invoice' | 'download_invoice_pdf' | 'download_excel_global' |
  -- 'view_savings' | 'view_forecast' | 'download_forecast_pdf' |
  -- 'invite_user' | 'revoke_user' | 'update_profile'
  resource_id     uuid,
  metadata        jsonb,
  ip              inet,
  user_agent      text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_audit_user      ON public.portal_audit_log(portal_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_audit_client    ON public.portal_audit_log(client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_audit_action    ON public.portal_audit_log(action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_audit_recent    ON public.portal_audit_log(occurred_at DESC);

ALTER TABLE public.portal_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "portal_audit_admin" ON public.portal_audit_log;
CREATE POLICY "portal_audit_admin" ON public.portal_audit_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. voltis_contracts — precios Voltis contratados por suministro
-- ─────────────────────────────────────────────────────────────────────────
-- Necesario para el motor de Ahorro y Previsión. Almacena los precios que
-- Voltis aplica al cliente por contrato (peaje + p.fijo combinados por
-- periodo, término fijo gas, etc.). Estos precios NO cambian con el
-- consumo y son la base para simular "qué pagaría con Voltis si consumiera
-- lo mismo que el año anterior".
CREATE TABLE IF NOT EXISTS public.voltis_contracts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id                uuid NOT NULL REFERENCES public.supplies(id) ON DELETE CASCADE,
  start_date               date NOT NULL,
  end_date                 date,
  tariff                   text NOT NULL,
  -- Precios ENERGÍA por periodo (€/kWh) — peaje + p.fijo combinados (precio final que el cliente paga por kWh)
  precio_kwh_p1            numeric(10, 6),
  precio_kwh_p2            numeric(10, 6),
  precio_kwh_p3            numeric(10, 6),
  precio_kwh_p4            numeric(10, 6),
  precio_kwh_p5            numeric(10, 6),
  precio_kwh_p6            numeric(10, 6),
  -- Detalle de los componentes (opcional, para mostrar en la tabla "Precios Voltis aplicados")
  peaje_kwh_p1             numeric(10, 6),
  peaje_kwh_p2             numeric(10, 6),
  peaje_kwh_p3             numeric(10, 6),
  peaje_kwh_p4             numeric(10, 6),
  peaje_kwh_p5             numeric(10, 6),
  peaje_kwh_p6             numeric(10, 6),
  p_fijo_kwh_p1            numeric(10, 6),
  p_fijo_kwh_p2            numeric(10, 6),
  p_fijo_kwh_p3            numeric(10, 6),
  p_fijo_kwh_p4            numeric(10, 6),
  p_fijo_kwh_p5            numeric(10, 6),
  p_fijo_kwh_p6            numeric(10, 6),
  -- Precios POTENCIA por periodo (€/kW día) — solo luz
  precio_kw_dia_p1         numeric(10, 6),
  precio_kw_dia_p2         numeric(10, 6),
  precio_kw_dia_p3         numeric(10, 6),
  precio_kw_dia_p4         numeric(10, 6),
  precio_kw_dia_p5         numeric(10, 6),
  precio_kw_dia_p6         numeric(10, 6),
  -- GAS
  precio_kwh_gas           numeric(10, 6),                 -- término variable energía €/kWh
  peaje_kwh_gas            numeric(10, 6),                 -- peaje de acceso €/kWh
  termino_fijo_diario_gas  numeric(10, 4),                 -- € por día
  -- Otros conceptos
  bono_social_mensual      numeric(10, 4),                 -- € mes
  alquiler_equipos_mensual numeric(10, 4),                 -- € mes
  notas                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_voltis_contract_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_voltis_contracts_supply ON public.voltis_contracts(supply_id);
CREATE INDEX IF NOT EXISTS idx_voltis_contracts_active ON public.voltis_contracts(supply_id, start_date DESC) WHERE end_date IS NULL;

ALTER TABLE public.voltis_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "voltis_contracts_admin" ON public.voltis_contracts;
CREATE POLICY "voltis_contracts_admin" ON public.voltis_contracts
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users_profile up WHERE up.id = auth.uid() AND up.role IN ('admin', 'commercial'))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Vista auxiliar — datos de portal user con cliente
-- ─────────────────────────────────────────────────────────────────────────
-- Útil para joins comunes desde la app
CREATE OR REPLACE VIEW public.v_portal_users_full AS
SELECT
  pu.id,
  pu.client_id,
  pu.email,
  pu.display_name,
  pu.role,
  pu.active,
  pu.last_login_at,
  pu.created_at,
  c.name        AS client_name,
  c.cif_nif     AS client_cif,
  c.type        AS client_type
FROM public.portal_users pu
JOIN public.clients c ON c.id = pu.client_id;

GRANT SELECT ON public.v_portal_users_full TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_portal_users_updated ON public.portal_users;
CREATE TRIGGER tg_portal_users_updated
  BEFORE UPDATE ON public.portal_users
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS tg_voltis_contracts_updated ON public.voltis_contracts;
CREATE TRIGGER tg_voltis_contracts_updated
  BEFORE UPDATE ON public.voltis_contracts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- FIN — Portal v2 foundation
-- ─────────────────────────────────────────────────────────────────────────
