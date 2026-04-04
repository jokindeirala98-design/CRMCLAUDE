import { createClient as supabaseCreateClient } from '@supabase/supabase-js'

export const supabaseUrl = 'https://wqzicwrmmwhnafaihhqh.supabase.co'
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxemljd3JtbXdobmFmYWloaHFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM3ODYsImV4cCI6MjA5MDQ2OTc4Nn0.KGV6_PqLYfr0WcRReaTwjLiTMf5KuMd9K5fHbqNDB7o'
const AUTH_STORAGE_KEY = 'voltis-auth'

// Auth client - ONLY for login/logout/session management
let authClient: ReturnType<typeof supabaseCreateClient> | null = null

export function getAuthClient() {
  if (typeof window !== 'undefined' && !authClient) {
    authClient = supabaseCreateClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        storageKey: AUTH_STORAGE_KEY,
        storage: window.localStorage,
        detectSessionInUrl: false,
      },
    })
  }
  if (!authClient) {
    authClient = supabaseCreateClient(supabaseUrl, supabaseAnonKey)
  }
  return authClient
}

// Get the current access token from localStorage directly
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.access_token || null
  } catch {
    return null
  }
}

// Data client - for all DB queries. Uses manual auth header to avoid lock issues.
export function createClient() {
  const token = getAccessToken()
  const headers: Record<string, string> = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return supabaseCreateClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers,
    },
  })
}
