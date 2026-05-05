-- ============================================================
-- FULL RLS DATA ISOLATION
-- Admin → sees & modifies everything
-- Commercial → sees & modifies only their own clients/supplies
-- Service role (bot, API routes) → bypasses RLS entirely
-- ============================================================

-- ── Helper functions ─────────────────────────────────────────

-- Returns the role of the current session user
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.users_profile WHERE id = auth.uid()
$$;

-- Returns true if the current user owns the given client
-- (is admin OR is the assigned commercial)
CREATE OR REPLACE FUNCTION public.user_can_access_client(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = cid
      AND (
        (SELECT role FROM public.users_profile WHERE id = auth.uid()) = 'admin'
        OR commercial_id = auth.uid()
      )
  )
$$;

-- Returns true if the current user owns the client linked to a supply
CREATE OR REPLACE FUNCTION public.user_can_access_supply(sid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.supplies s
    JOIN public.clients c ON c.id = s.client_id
    WHERE s.id = sid
      AND (
        (SELECT role FROM public.users_profile WHERE id = auth.uid()) = 'admin'
        OR c.commercial_id = auth.uid()
      )
  )
$$;


-- ════════════════════════════════════════════════════════════
-- CLIENTS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_select" ON public.clients;
CREATE POLICY "clients_select" ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR commercial_id = auth.uid()
  );

DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'commercial' AND commercial_id = auth.uid())
  );

DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'commercial' AND commercial_id = auth.uid())
  );

DROP POLICY IF EXISTS "clients_delete" ON public.clients;
CREATE POLICY "clients_delete" ON public.clients
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');


-- ════════════════════════════════════════════════════════════
-- SUPPLIES
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.supplies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supplies_select" ON public.supplies;
CREATE POLICY "supplies_select" ON public.supplies
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = supplies.client_id
        AND clients.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "supplies_insert" ON public.supplies;
CREATE POLICY "supplies_insert" ON public.supplies
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

DROP POLICY IF EXISTS "supplies_update" ON public.supplies;
CREATE POLICY "supplies_update" ON public.supplies
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = supplies.client_id
        AND clients.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "supplies_delete" ON public.supplies;
CREATE POLICY "supplies_delete" ON public.supplies
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');


-- ════════════════════════════════════════════════════════════
-- INVOICES
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.supplies s
      JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = invoices.supply_id
        AND c.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.supplies s
      JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = invoices.supply_id
        AND c.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invoices_delete" ON public.invoices;
CREATE POLICY "invoices_delete" ON public.invoices
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');


-- ════════════════════════════════════════════════════════════
-- PRESCORINGS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.prescorings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prescorings_select" ON public.prescorings;
CREATE POLICY "prescorings_select" ON public.prescorings
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.supplies s
      JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = prescorings.supply_id
        AND c.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "prescorings_insert" ON public.prescorings;
CREATE POLICY "prescorings_insert" ON public.prescorings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

DROP POLICY IF EXISTS "prescorings_update" ON public.prescorings;
CREATE POLICY "prescorings_update" ON public.prescorings
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.supplies s
      JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = prescorings.supply_id
        AND c.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "prescorings_delete" ON public.prescorings;
CREATE POLICY "prescorings_delete" ON public.prescorings
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');


-- ════════════════════════════════════════════════════════════
-- CONTRACTS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_select" ON public.contracts;
CREATE POLICY "contracts_select" ON public.contracts
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = contracts.client_id
        AND clients.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contracts_insert" ON public.contracts;
CREATE POLICY "contracts_insert" ON public.contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

DROP POLICY IF EXISTS "contracts_update" ON public.contracts;
CREATE POLICY "contracts_update" ON public.contracts
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = contracts.client_id
        AND clients.commercial_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contracts_delete" ON public.contracts;
CREATE POLICY "contracts_delete" ON public.contracts
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');


-- ════════════════════════════════════════════════════════════
-- USERS_PROFILE
-- Admins see all profiles (needed for team management).
-- Commercial users see only their own profile.
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_profile_select" ON public.users_profile;
CREATE POLICY "users_profile_select" ON public.users_profile
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "users_profile_insert" ON public.users_profile;
CREATE POLICY "users_profile_insert" ON public.users_profile
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "users_profile_update" ON public.users_profile;
CREATE POLICY "users_profile_update" ON public.users_profile
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "users_profile_delete" ON public.users_profile;
CREATE POLICY "users_profile_delete" ON public.users_profile
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');


-- ════════════════════════════════════════════════════════════
-- TELEGRAM_LINKS
-- Each user can only see and manage their own Telegram link.
-- Admins see all.
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram_links_select" ON public.telegram_links;
CREATE POLICY "telegram_links_select" ON public.telegram_links
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "telegram_links_insert" ON public.telegram_links;
CREATE POLICY "telegram_links_insert" ON public.telegram_links
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "telegram_links_update" ON public.telegram_links;
CREATE POLICY "telegram_links_update" ON public.telegram_links
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "telegram_links_delete" ON public.telegram_links;
CREATE POLICY "telegram_links_delete" ON public.telegram_links
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'admin'
  );


-- ════════════════════════════════════════════════════════════
-- TELEGRAM_INBOX (if table exists)
-- Commercial users see only their own inbox items.
-- ════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'telegram_inbox') THEN
    ALTER TABLE public.telegram_inbox ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "telegram_inbox_select" ON public.telegram_inbox;
    CREATE POLICY "telegram_inbox_select" ON public.telegram_inbox
      FOR SELECT TO authenticated
      USING (
        public.current_user_role() = 'admin'
        OR user_id = auth.uid()
      );

    -- INSERT handled by service role (bot), but allow authenticated users to also insert their own
    DROP POLICY IF EXISTS "telegram_inbox_insert" ON public.telegram_inbox;
    CREATE POLICY "telegram_inbox_insert" ON public.telegram_inbox
      FOR INSERT TO authenticated
      WITH CHECK (
        public.current_user_role() = 'admin'
        OR user_id = auth.uid()
      );

    DROP POLICY IF EXISTS "telegram_inbox_update" ON public.telegram_inbox;
    CREATE POLICY "telegram_inbox_update" ON public.telegram_inbox
      FOR UPDATE TO authenticated
      USING (
        public.current_user_role() = 'admin'
        OR user_id = auth.uid()
      );
  END IF;
END $$;
