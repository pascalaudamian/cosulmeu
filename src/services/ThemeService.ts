import { supabase } from '../lib/supabase.js';
import type { ThemeMode } from '../types.js';

export const THEME_STORAGE_KEY = 'cosul_meu_theme';

export const VALID_THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export function isValidThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function normalizeThemeMode(value: unknown, fallback: ThemeMode = 'light'): ThemeMode {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (isValidThemeMode(normalized)) {
      return normalized;
    }
  }
  return fallback;
}

export function getSystemPrefersDark(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch {
    // Ignore matchMedia access errors in non-browser environments
  }
  return false;
}

export function resolveIsDark(mode: ThemeMode, systemPrefersDark: boolean = getSystemPrefersDark()): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return Boolean(systemPrefersDark);
}

export function getStoredThemeMode(): ThemeMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isValidThemeMode(raw)) {
        return raw;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return 'light';
}

export function persistThemeLocally(mode: ThemeMode): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage write errors
  }
}

export function clearStoredThemeMode(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // Ignore storage remove errors
  }
}

export function applyThemeToDocument(
  mode: ThemeMode,
  systemPrefersDark: boolean = getSystemPrefersDark(),
  persistLocal: boolean = true
): boolean {
  const isDark = resolveIsDark(mode, systemPrefersDark);
  if (persistLocal) {
    persistThemeLocally(mode);
  }

  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.dataset.theme = mode;
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    }
  } catch {
    // Ignore DOM access errors in headless test environments
  }

  return isDark;
}

export function getNextQuickToggleTheme(currentMode: ThemeMode, isCurrentlyDark: boolean): ThemeMode {
  if (currentMode === 'system') {
    return isCurrentlyDark ? 'light' : 'dark';
  }
  return currentMode === 'dark' ? 'light' : 'dark';
}

export interface SupabaseUserPreferencesClient {
  from: (table: string) => any;
}

export async function loadUserThemePreference(
  userId: string,
  client: SupabaseUserPreferencesClient = supabase
): Promise<ThemeMode | null> {
  if (!userId) return null;
  try {
    const { data, error } = await client
      .from('user_preferences')
      .select('theme')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[ThemeService] Nu s-a putut citi tema din user_preferences:', error.message);
      return null;
    }

    if (data && isValidThemeMode(data.theme)) {
      return data.theme;
    }
    return null;
  } catch (err) {
    console.warn('[ThemeService] Eroare la încărcarea preferinței de temă:', err);
    return null;
  }
}

export async function saveUserThemePreference(
  userId: string,
  theme: ThemeMode,
  extra?: {
    notificationsEnabled?: boolean;
    priceAlertsEnabled?: boolean;
    language?: string;
  },
  client: SupabaseUserPreferencesClient = supabase
): Promise<{ ok: boolean; error?: string }> {
  if (!userId) {
    return { ok: false, error: 'Utilizator neautentificat' };
  }

  const normalizedTheme = normalizeThemeMode(theme);
  const payload: Record<string, unknown> = {
    user_id: userId,
    theme: normalizedTheme,
    updated_at: new Date().toISOString()
  };

  if (typeof extra?.notificationsEnabled === 'boolean') {
    payload.notifications_enabled = extra.notificationsEnabled;
  }
  if (typeof extra?.priceAlertsEnabled === 'boolean') {
    payload.price_alerts_enabled = extra.priceAlertsEnabled;
  }
  if (typeof extra?.language === 'string' && extra.language.trim()) {
    payload.language = extra.language.trim();
  }

  try {
    const { error } = await client
      .from('user_preferences')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      console.warn('[ThemeService] Nu s-a putut salva tema în user_preferences:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Eroare necunoscută la salvarea temei';
    console.warn('[ThemeService] Eroare la salvarea temei în user_preferences:', msg);
    return { ok: false, error: msg };
  }
}
