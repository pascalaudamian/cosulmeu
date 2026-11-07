import { createClient, type Session, type User } from '@supabase/supabase-js';

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  'https://bwanbgbimktluajvwzsj.supabase.co';

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3YW5iZ2JpbWt0bHVhanZ3enNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3OTM0ODQsImV4cCI6MjEwOTM2OTQ4NH0.dHSKcUjqitbWOBmV_aG5IjWM5L7nTilVML0DOomd9gs';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type AuthState = { session: Session | null; user: User | null };
