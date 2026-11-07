import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.js';

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ needsConfirmation?: boolean; error?: string }>;
  signUp: (email: string, password: string, displayName: string, username?: string) => Promise<{ needsConfirmation?: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  updatePassword: (password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readableAuthError(error: { message?: string; status?: number }) {
  const message = (error.message || '').toLowerCase();
  if (error.status === 429 || message.includes('rate')) return 'Prea multe încercări. Te rugăm să aștepți un minut.';
  if (message.includes('confirm') || message.includes('email not confirmed')) return 'Adresa de email nu a fost confirmată. Verifică inbox-ul.';
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) return 'Email sau parolă incorectă.';
  if (message.includes('user already registered') || message.includes('already exists')) return 'Există deja un cont cu această adresă de email.';
  if (message.includes('weak') || message.includes('at least 6') || message.includes('at least 8')) return 'Parola trebuie să aibă cel puțin 8 caractere.';
  return error.message || 'Autentificarea nu a putut fi finalizată. Încearcă din nou.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1. Preluare sesiune inițială
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) {
          setSession(data.session);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    // 2. Ascultare modificări stare de autentificare
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setSession(nextSession);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        return error ? { error: readableAuthError(error) } : {};
      },
      async signUp(email, password, displayName, username) {
        const userEmail = email.trim();
        const trimmedName = displayName.trim();
        const customUsername = username ? username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : undefined;

        const { data, error } = await supabase.auth.signUp({
          email: userEmail,
          password,
          options: {
            data: {
              display_name: trimmedName,
              name: trimmedName,
              username: customUsername,
              is_admin: userEmail === 'pascalau.stefan@gmail.com'
            },
            emailRedirectTo:
              import.meta.env.VITE_SUPABASE_REDIRECT_URL || `${window.location.origin}/auth/callback`
          }
        });

        if (error) {
          return { error: readableAuthError(error) };
        }

        // Dacă utilizatorul a fost creat direct cu sesiune (email auto-confirm activat)
        if (data.session && data.user) {
          return { needsConfirmation: false };
        }

        return { needsConfirmation: !data.session };
      },
      async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo:
            import.meta.env.VITE_SUPABASE_REDIRECT_URL || `${window.location.origin}/auth/callback`
        });
        return error ? { error: readableAuthError(error) } : {};
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        return error ? { error: readableAuthError(error) } : {};
      },
      async signOut() {
        try {
          await supabase.auth.signOut();
        } catch {}
        setSession(null);
      },
      async refreshSession() {
        const { data } = await supabase.auth.refreshSession();
        setSession(data.session);
      }
    }),
    [loading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
