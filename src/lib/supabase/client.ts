import { createBrowserClient } from '@supabase/ssr'

export const supabaseUrl = 'https://wqzicwrmmwhnafaihhqh.supabase.co'
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxemljd3JtbXdobmFmYWloaHFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM3ODYsImV4cCI6MjA5MDQ2OTc4Nn0.KGV6_PqLYfr0WcRReaTwjLiTMf5KuMd9K5fHbqNDB7o'

/**
 * Browser-side Supabase client using @supabase/ssr's createBrowserClient.
 * This automatically stores the session in cookies (not localStorage),
 * so the middleware's createServerClient can read it server-side.
 */
let browserClient: ReturnType<typeof createBrowserClient> | null = null

export function getAuthClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  return browserClient
}

// Alias used throughout the app for data queries — same cookie-based client
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  return browserClient
}
