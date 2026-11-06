import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.js';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ needsConfirmation?: boolean; error?: string }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation?: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readableAuthError(error: { message?: string; status?: number }) {
  const message = (error.message || '').toLowerCase();
  if (error.status === 429 || message.includes('rate')) return 'Prea multe încercări. Încearcă din nou mai târziu.';
  if (message.includes('confirm')) return 'Verifică adresa de email pentru a activa contul.';
  if (message.includes('password') || message.includes('credential') || message.includes('user')) return 'Email sau parolă invalidă.';
  if (message.includes('weak')) return 'Parola trebuie să aibă cel puțin 8 caractere.';
  return 'Autentificarea nu a putut fi finalizată. Încearcă din nou.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) { setSession(data.session); setLoading(false); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) { setSession(nextSession); setLoading(false); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? { error: readableAuthError(error) } : {};
    },
    async signUp(email, password, displayName) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: import.meta.env.VITE_SUPABASE_REDIRECT_URL || `${window.location.origin}/auth/callback`,
        },
      });
      return error ? { needsConfirmation: false, error: readableAuthError(error) } : { needsConfirmation: !data.session };
    },
    async resetPassword(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: import.meta.env.VITE_SUPABASE_REDIRECT_URL || `${window.location.origin}/auth/callback` });
      return error ? { error: readableAuthError(error) } : {};
    },
    async signOut() { await supabase.auth.signOut(); },
  }), [loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
