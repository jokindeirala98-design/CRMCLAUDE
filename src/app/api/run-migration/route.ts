import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/run-migration
 *
 * Runs the 007 migration to add DELETE policies for supplies and invoices.
 * Uses the anon key with RPC - if that fails, provides the SQL for manual execution.
 */
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  })

  const statements = [
    `CREATE POLICY "supplies_delete" ON supplies FOR DELETE USING (EXISTS (SELECT 1 FROM clients WHERE clients.id = supplies.client_id AND (clients.commercial_id = auth.uid() OR is_admin())))`,
    `CREATE POLICY "invoices_delete" ON invoices FOR DELETE USING (EXISTS (SELECT 1 FROM supplies JOIN clients ON clients.id = supplies.client_id WHERE supplies.id = invoices.supply_id AND (clients.commercial_id = auth.uid() OR is_admin())))`,
    `CREATE POLICY "invoices_update" ON invoices FOR UPDATE USING (EXISTS (SELECT 1 FROM supplies JOIN clients ON clients.id = supplies.client_id WHERE supplies.id = invoices.supply_id AND (clients.commercial_id = auth.uid() OR is_admin())))`,
  ]

  const results: { sql: string; ok: boolean; error?: string }[] = []

  for (const sql of statements) {
    const { error } = await supabase.rpc('exec_sql', { query: sql })
    if (error) {
      // Policy might already exist
      if (error.message?.includes('already exists')) {
        results.push({ sql, ok: true, error: 'Already exists (skipped)' })
      } else {
        results.push({ sql, ok: false, error: error.message })
      }
    } else {
      results.push({ sql, ok: true })
    }
  }

  const allOk = results.every(r => r.ok)

  return NextResponse.json({
    success: allOk,
    results,
    manualSQL: allOk ? null : `-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/wqzicwrmmwhnafaihhqh/sql/new):

CREATE POLICY "supplies_delete" ON supplies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = supplies.client_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "invoices_delete" ON invoices
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = invoices.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "invoices_update" ON invoices
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM supplies
      JOIN clients ON clients.id = supplies.client_id
      WHERE supplies.id = invoices.supply_id
      AND (clients.commercial_id = auth.uid() OR is_admin())
    )
  );`
  })
}
