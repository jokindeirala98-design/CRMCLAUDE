-- ============================================================
-- FIX: Allow commercial users to INSERT their own records
-- The previous migration (20260427_rls_permissions.sql) was
-- too restrictive — it only allowed admins to INSERT, which
-- broke the inbox page (direct CRM upload) for commercial users.
--
-- Rules:
--   clients  → commercial can INSERT if commercial_id = auth.uid()
--   supplies → commercial can INSERT (client ownership checked in app)
--   invoices → commercial can INSERT (supply ownership checked in app)
-- ============================================================

-- ── clients ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'commercial' AND commercial_id = auth.uid())
  );

-- ── supplies ────────────────────────────────────────────────
DROP POLICY IF EXISTS "supplies_insert" ON public.supplies;
CREATE POLICY "supplies_insert" ON public.supplies
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

-- ── invoices ────────────────────────────────────────────────
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

-- ── prescorings ─────────────────────────────────────────────
-- Prescorings are created by the system during supply pipeline.
-- Allow commercial users to insert them too.
DROP POLICY IF EXISTS "prescorings_insert" ON public.prescorings;
CREATE POLICY "prescorings_insert" ON public.prescorings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

-- ── UPDATE: commercial can update their own clients ──────────
-- Also allow commercial users to UPDATE clients they own
DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'commercial' AND commercial_id = auth.uid())
  );

-- ── UPDATE: commercial can update supplies ───────────────────
DROP POLICY IF EXISTS "supplies_update" ON public.supplies;
CREATE POLICY "supplies_update" ON public.supplies
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );

-- ── UPDATE: commercial can update invoices ───────────────────
DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = 'commercial'
  );
