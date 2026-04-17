import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/migrate-client-alias
 *
 * Adds an `alias` TEXT column to the clients table (IF NOT EXISTS — safe to call repeatedly).
 * Called automatically the first time the client edit page loads.
 */
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const sql = `ALTER TABLE clients ADD COLUMN IF NOT EXISTS alias TEXT;
CREATE INDEX IF NOT EXISTS clients_alias_idx ON clients (alias) WHERE alias IS NOT NULL;`

  const { error } = await supabase.rpc('exec_sql', { query: sql })

  if (error) {
    // If the RPC doesn't exist, return the SQL for manual execution
    return NextResponse.json({
      success: false,
      error: error.message,
      manualSQL: `-- Run in Supabase SQL Editor:\nALTER TABLE clients ADD COLUMN IF NOT EXISTS alias TEXT;\nCREATE INDEX IF NOT EXISTS clients_alias_idx ON clients (alias) WHERE alias IS NOT NULL;`,
    })
  }

  return NextResponse.json({ success: true })
}
