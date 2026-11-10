const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || undefined
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || undefined

export const config = {
  supabaseUrl,
  supabaseAnonKey,
  /** Logins are phone + PIN; Supabase needs an email, so each phone maps to one on this private domain. */
  authEmailDomain: 'm2.local',
  timeZone: 'Asia/Gaza',
  version: '0.1.0',
} as const

/** Without Supabase settings the app runs on sample accounts and keeps data on this device. */
export const isDemo = !supabaseUrl || !supabaseAnonKey
