import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config, isDemo } from '../config'

let client: SupabaseClient | null = null

/** The Supabase client, or null in demo mode. Created on first use. */
export function getSupabase(): SupabaseClient | null {
  if (isDemo) return null
  client ??= createClient(config.supabaseUrl!, config.supabaseAnonKey!, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'm2-auth' },
  })
  return client
}
