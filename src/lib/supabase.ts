import { createClient, type Session, type User } from '@supabase/supabase-js';

const supabaseUrl =
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_URL) ||
  'https://bwanbgbimktluajvwzsj.supabase.co';

const supabaseAnonKey =
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3YW5iZ2JpbWt0bHVhanZ3enNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3OTM0ODQsImV4cCI6MjEwOTM2OTQ4NH0.dHSKcUjqitbWOBmV_aG5IjWM5L7nTilVML0DOomd9gs';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type AuthState = { session: Session | null; user: User | null };
