-- ============================================================================
-- Migration 007: Add DELETE policies for supplies, invoices, and UPDATE for invoices
-- Fix: RLS was blocking all DELETE operations because no DELETE policies existed
-- ============================================================================

-- Supplies: allow delete by commercial owner or admin
CREATE POLICY "supplies_delete" ON supplies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = supplies.client_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

-- Invoices: allow delete by commercial owner or admin
CREATE POLICY "invoices_delete" ON invoices
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = invoices.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

-- Invoices: allow update by commercial owner or admin (needed for re-extraction)
CREATE POLICY "invoices_update" ON invoices
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = invoices.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

-- Studies: allow insert by commercial owner (so they can attach economic reports)
CREATE POLICY "studies_insert_commercial" ON studies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

-- Studies: allow delete by commercial owner or admin
CREATE POLICY "studies_delete_commercial" ON studies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = studies.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );
