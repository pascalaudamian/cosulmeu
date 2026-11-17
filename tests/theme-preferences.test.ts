// tests/theme-preferences.test.ts
// Teste unitare pentru ThemeService și persistența preferinței de temă în user_preferences (Supabase)

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  THEME_STORAGE_KEY,
  VALID_THEME_MODES,
  isValidThemeMode,
  normalizeThemeMode,
  resolveIsDark,
  getNextQuickToggleTheme,
  applyThemeToDocument,
  loadUserThemePreference,
  saveUserThemePreference,
  type SupabaseUserPreferencesClient
} from '../src/services/ThemeService.ts';

describe('ThemeService & Persistență user_preferences.theme', () => {
  it('1. Validează corect modurile de temă acceptate (light | dark | system)', () => {
    assert.deepStrictEqual(VALID_THEME_MODES, ['light', 'dark', 'system']);
    assert.strictEqual(isValidThemeMode('light'), true);
    assert.strictEqual(isValidThemeMode('dark'), true);
    assert.strictEqual(isValidThemeMode('system'), true);
    assert.strictEqual(isValidThemeMode('midnight'), false);
    assert.strictEqual(isValidThemeMode(null), false);
    assert.strictEqual(isValidThemeMode(undefined), false);
  });

  it('2. Normalizează valorile valide și revine sigur la fallback pentru input invalid', () => {
    assert.strictEqual(normalizeThemeMode(' DARK '), 'dark');
    assert.strictEqual(normalizeThemeMode('System'), 'system');
    assert.strictEqual(normalizeThemeMode('LIGHT'), 'light');
    assert.strictEqual(normalizeThemeMode('unknown', 'light'), 'light');
    assert.strictEqual(normalizeThemeMode(123, 'dark'), 'dark');
  });

  it('3. Rezolvă corect starea isDark pentru light, dark și system', () => {
    assert.strictEqual(resolveIsDark('light', true), false);
    assert.strictEqual(resolveIsDark('light', false), false);
    assert.strictEqual(resolveIsDark('dark', false), true);
    assert.strictEqual(resolveIsDark('dark', true), true);
    assert.strictEqual(resolveIsDark('system', true), true);
    assert.strictEqual(resolveIsDark('system', false), false);
  });

  it('4. Comută corect în getNextQuickToggleTheme indiferent de modul curent', () => {
    assert.strictEqual(getNextQuickToggleTheme('light', false), 'dark');
    assert.strictEqual(getNextQuickToggleTheme('dark', true), 'light');
    assert.strictEqual(getNextQuickToggleTheme('system', true), 'light');
    assert.strictEqual(getNextQuickToggleTheme('system', false), 'dark');
  });

  it('5. Aplică tema pe documentElement și persistă în localStorage atunci când există DOM/storage', () => {
    const storageMap = new Map<string, string>();
    let darkClassPresent = false;
    const fakeDocument = {
      documentElement: {
        classList: {
          toggle: (cls: string, force?: boolean) => {
            if (cls === 'dark') {
              darkClassPresent = Boolean(force);
            }
            return darkClassPresent;
          }
        },
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>
      }
    };
    const fakeWindow = {
      localStorage: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        }
      }
    };

    const prevWindow = (globalThis as any).window;
    const prevDocument = (globalThis as any).document;
    (globalThis as any).window = fakeWindow;
    (globalThis as any).document = fakeDocument;

    try {
      const isDarkOn = applyThemeToDocument('dark', false);
      assert.strictEqual(isDarkOn, true);
      assert.strictEqual(darkClassPresent, true);
      assert.strictEqual(fakeDocument.documentElement.dataset.theme, 'dark');
      assert.strictEqual(fakeDocument.documentElement.style.colorScheme, 'dark');
      assert.strictEqual(storageMap.get(THEME_STORAGE_KEY), 'dark');

      const isSystemDarkOff = applyThemeToDocument('system', false);
      assert.strictEqual(isSystemDarkOff, false);
      assert.strictEqual(darkClassPresent, false);
      assert.strictEqual(fakeDocument.documentElement.dataset.theme, 'system');
      assert.strictEqual(fakeDocument.documentElement.style.colorScheme, 'light');
      assert.strictEqual(storageMap.get(THEME_STORAGE_KEY), 'system');
    } finally {
      (globalThis as any).window = prevWindow;
      (globalThis as any).document = prevDocument;
    }
  });

  it('6. Încarcă preferința de temă din tabela user_preferences folosind coloana theme', async () => {
    const calls: { table?: string; selectCol?: string; eqCol?: string; eqVal?: string } = {};

    const mockClient: SupabaseUserPreferencesClient = {
      from: (table: string) => {
        calls.table = table;
        return {
          select: (col: string) => {
            calls.selectCol = col;
            return {
              eq: (eqCol: string, eqVal: string) => {
                calls.eqCol = eqCol;
                calls.eqVal = eqVal;
                return {
                  maybeSingle: async () => ({ data: { theme: 'dark' }, error: null })
                };
              }
            };
          }
        };
      }
    };

    const loaded = await loadUserThemePreference('user-123', mockClient);
    assert.strictEqual(loaded, 'dark');
    assert.strictEqual(calls.table, 'user_preferences');
    assert.strictEqual(calls.selectCol, 'theme');
    assert.strictEqual(calls.eqCol, 'user_id');
    assert.strictEqual(calls.eqVal, 'user-123');

    const emptyUser = await loadUserThemePreference('', mockClient);
    assert.strictEqual(emptyUser, null);
  });

  it('7. Salvează preferința de temă în user_preferences cu upsert onConflict user_id', async () => {
    let capturedTable = '';
    let capturedPayload: Record<string, unknown> | null = null;
    let capturedOptions: { onConflict?: string } | null = null;

    const mockClient: SupabaseUserPreferencesClient = {
      from: (table: string) => {
        capturedTable = table;
        return {
          upsert: async (payload: Record<string, unknown>, options: { onConflict?: string }) => {
            capturedPayload = payload;
            capturedOptions = options;
            return { error: null };
          }
        };
      }
    };

    const result = await saveUserThemePreference(
      'user-abc',
      'dark',
      { notificationsEnabled: true, priceAlertsEnabled: false, language: 'ro' },
      mockClient
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(capturedTable, 'user_preferences');
    assert.deepStrictEqual(capturedOptions, { onConflict: 'user_id' });
    assert.ok(capturedPayload);
    assert.strictEqual((capturedPayload as Record<string, unknown>).user_id, 'user-abc');
    assert.strictEqual((capturedPayload as Record<string, unknown>).theme, 'dark');
    assert.strictEqual((capturedPayload as Record<string, unknown>).notifications_enabled, true);
    assert.strictEqual((capturedPayload as Record<string, unknown>).price_alerts_enabled, false);
    assert.strictEqual((capturedPayload as Record<string, unknown>).language, 'ro');
    assert.strictEqual(typeof (capturedPayload as Record<string, unknown>).updated_at, 'string');
  });

  it('8. Gestionează curat utilizator neautentificat și erori de bază de date la salvare', async () => {
    const unauth = await saveUserThemePreference('', 'dark');
    assert.strictEqual(unauth.ok, false);
    assert.ok(unauth.error);

    const failingClient: SupabaseUserPreferencesClient = {
      from: () => ({
        upsert: async () => ({ error: { message: 'RLS policy violation' } })
      })
    };
    const failed = await saveUserThemePreference('user-abc', 'system', undefined, failingClient);
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.error, 'RLS policy violation');
  });
});
