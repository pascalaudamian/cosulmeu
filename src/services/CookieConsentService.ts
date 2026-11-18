import {
  CONSENT_STORAGE_KEY,
  COOKIE_BANNER_VERSION,
  COOKIE_POLICY_VERSION,
  VISITOR_PSEUDONYM_KEY
} from '../config/legalConfig.js';
import type {
  CookieConsentCategoriesState,
  CookieConsentCategory,
  CookieConsentMethod,
  CookieConsentState
} from '../types.js';

export interface RegisteredOptionalScript {
  id: string;
  category: Exclude<CookieConsentCategory, 'necessary'>;
  description: string;
  src?: string;
  loaded: boolean;
  blockedByConsent: boolean;
  loadFn: () => void;
  cleanupFn?: () => void;
}

const DEFAULT_CATEGORIES: CookieConsentCategoriesState = {
  necessary: true,
  preferences: false,
  analytics: false,
  marketing: false
};

const APP_OPTIONAL_COOKIE_NAMES_BY_CATEGORY: Record<Exclude<CookieConsentCategory, 'necessary'>, string[]> = {
  preferences: ['cosul_meu_pref_cookie'],
  analytics: ['cosul_meu_analytics_id', '_ga', '_gid', '_gat'],
  marketing: ['cosul_meu_marketing_id', '_fbp']
};

function hasBrowserWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getOrCreateVisitorSessionId(): string {
  if (!hasBrowserWindow()) {
    return 'ssr-visitor-session';
  }
  try {
    const existing = window.localStorage.getItem(VISITOR_PSEUDONYM_KEY);
    if (existing && existing.trim().length >= 8) {
      return existing.trim();
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `vis_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(VISITOR_PSEUDONYM_KEY, generated);
    return generated;
  } catch {
    return `vis_${Date.now()}`;
  }
}

export function getStoredCookieConsent(): CookieConsentState | null {
  if (!hasBrowserWindow()) return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentState>;
    if (!parsed || typeof parsed !== 'object' || !parsed.categories) return null;
    return {
      visitorSessionId: parsed.visitorSessionId || getOrCreateVisitorSessionId(),
      policyVersion: parsed.policyVersion || '',
      bannerVersion: parsed.bannerVersion || '',
      consentGiven: Boolean(parsed.consentGiven),
      consentMethod: (parsed.consentMethod as CookieConsentMethod) || 'custom_preferences',
      categories: {
        necessary: true,
        preferences: Boolean(parsed.categories.preferences),
        analytics: Boolean(parsed.categories.analytics),
        marketing: Boolean(parsed.categories.marketing)
      },
      updatedAt: parsed.updatedAt || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function shouldShowCookieBanner(
  stored: CookieConsentState | null = getStoredCookieConsent(),
  expectedPolicyVersion: string = COOKIE_POLICY_VERSION,
  expectedBannerVersion: string = COOKIE_BANNER_VERSION
): boolean {
  if (!stored) return true;
  if (!stored.consentGiven) return true;
  if (stored.policyVersion !== expectedPolicyVersion) return true;
  if (stored.bannerVersion !== expectedBannerVersion) return true;
  return false;
}

export function hasCategoryConsent(
  category: CookieConsentCategory,
  stored: CookieConsentState | null = getStoredCookieConsent()
): boolean {
  if (category === 'necessary') return true;
  if (!stored || !stored.consentGiven) return false;
  return Boolean(stored.categories[category]);
}

function expireAppCookie(cookieName: string): void {
  if (typeof document === 'undefined') return;
  const expiry = 'Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = `${encodeURIComponent(cookieName)}=; expires=${expiry}; path=/; SameSite=Lax`;
  if (typeof window !== 'undefined' && window.location?.hostname) {
    document.cookie = `${encodeURIComponent(cookieName)}=; expires=${expiry}; path=/; domain=${window.location.hostname}; SameSite=Lax`;
  }
}

function writeConsentState(state: CookieConsentState): void {
  if (!hasBrowserWindow()) return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

type ConsentListener = (state: CookieConsentState | null) => void;

class ScriptConsentController {
  private registry = new Map<string, RegisteredOptionalScript>();
  private listeners = new Set<ConsentListener>();

  subscribe(listener: ConsentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(state: CookieConsentState | null): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // ignore listener failure
      }
    }
  }

  registerOptionalScript(params: {
    id: string;
    category: Exclude<CookieConsentCategory, 'necessary'>;
    description: string;
    src?: string;
    loadFn: () => void;
    cleanupFn?: () => void;
  }): void {
    const existing = this.registry.get(params.id);
    if (existing) {
      return;
    }
    this.registry.set(params.id, {
      id: params.id,
      category: params.category,
      description: params.description,
      src: params.src,
      loaded: false,
      blockedByConsent: true,
      loadFn: params.loadFn,
      cleanupFn: params.cleanupFn
    });
    this.evaluateAndLoadScripts();
  }

  evaluateAndLoadScripts(state: CookieConsentState | null = getStoredCookieConsent()): {
    loadedIds: string[];
    blockedIds: string[];
  } {
    const loadedIds: string[] = [];
    const blockedIds: string[] = [];

    for (const script of this.registry.values()) {
      const allowed = hasCategoryConsent(script.category, state);
      if (allowed) {
        script.blockedByConsent = false;
        if (!script.loaded) {
          try {
            script.loadFn();
            script.loaded = true;
          } catch {
            script.loaded = false;
          }
        }
        if (script.loaded) {
          loadedIds.push(script.id);
        }
      } else {
        script.blockedByConsent = true;
        if (script.loaded && script.cleanupFn) {
          try {
            script.cleanupFn();
          } catch {
            // ignore cleanup error
          }
        }
        script.loaded = false;
        blockedIds.push(script.id);
      }
    }

    return { loadedIds, blockedIds };
  }

  cleanupWithdrawnOptionalStorage(categories: CookieConsentCategoriesState): void {
    (['preferences', 'analytics', 'marketing'] as const).forEach(cat => {
      if (!categories[cat]) {
        const names = APP_OPTIONAL_COOKIE_NAMES_BY_CATEGORY[cat] || [];
        for (const cookieName of names) {
          expireAppCookie(cookieName);
        }
      }
    });

    if (!categories.preferences && hasBrowserWindow()) {
      try {
        window.localStorage.removeItem('cosul_meu_theme');
      } catch {
        // ignore storage remove error
      }
    }

    for (const script of this.registry.values()) {
      if (!categories[script.category]) {
        if (script.cleanupFn) {
          try {
            script.cleanupFn();
          } catch {
            // ignore
          }
        }
        script.loaded = false;
        script.blockedByConsent = true;
      }
    }
  }

  getRegisteredScriptsSnapshot(): Array<{
    id: string;
    category: Exclude<CookieConsentCategory, 'necessary'>;
    description: string;
    loaded: boolean;
    blockedByConsent: boolean;
  }> {
    return Array.from(this.registry.values()).map(s => ({
      id: s.id,
      category: s.category,
      description: s.description,
      loaded: s.loaded,
      blockedByConsent: s.blockedByConsent
    }));
  }

  notifyChange(state: CookieConsentState | null): void {
    this.notify(state);
  }

  resetForTests(): void {
    this.registry.clear();
    this.listeners.clear();
  }
}

export const scriptConsentController = new ScriptConsentController();

export async function syncConsentWithServer(
  state: CookieConsentState,
  accessToken?: string | null
): Promise<{ synced: boolean; error?: string }> {
  if (typeof fetch !== 'function') {
    return { synced: false };
  }
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const res = await fetch('/api/gdpr/consent', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        visitorSessionId: state.visitorSessionId,
        policyVersion: state.policyVersion,
        bannerVersion: state.bannerVersion,
        consentMethod: state.consentMethod,
        categories: state.categories
      })
    });
    if (!res.ok) {
      return { synced: false, error: `HTTP ${res.status}` };
    }
    return { synced: true };
  } catch (err: any) {
    return { synced: false, error: err?.message || 'Eroare rețea' };
  }
}

export function saveCookieConsentChoice(params: {
  categories: Partial<CookieConsentCategoriesState>;
  consentMethod: CookieConsentMethod;
  accessToken?: string | null;
  policyVersion?: string;
  bannerVersion?: string;
}): CookieConsentState {
  const normalizedCategories: CookieConsentCategoriesState = {
    necessary: true,
    preferences: Boolean(params.categories.preferences),
    analytics: Boolean(params.categories.analytics),
    marketing: Boolean(params.categories.marketing)
  };

  const state: CookieConsentState = {
    visitorSessionId: getOrCreateVisitorSessionId(),
    policyVersion: params.policyVersion || COOKIE_POLICY_VERSION,
    bannerVersion: params.bannerVersion || COOKIE_BANNER_VERSION,
    consentGiven: true,
    consentMethod: params.consentMethod,
    categories: normalizedCategories,
    updatedAt: new Date().toISOString()
  };

  writeConsentState(state);
  scriptConsentController.cleanupWithdrawnOptionalStorage(normalizedCategories);
  scriptConsentController.evaluateAndLoadScripts(state);
  scriptConsentController.notifyChange(state);
  void syncConsentWithServer(state, params.accessToken);
  return state;
}

export function acceptAllCookies(accessToken?: string | null): CookieConsentState {
  return saveCookieConsentChoice({
    categories: {
      necessary: true,
      preferences: true,
      analytics: true,
      marketing: true
    },
    consentMethod: 'banner_accept_all',
    accessToken
  });
}

export function rejectOptionalCookies(accessToken?: string | null): CookieConsentState {
  return saveCookieConsentChoice({
    categories: { ...DEFAULT_CATEGORIES },
    consentMethod: 'banner_reject_optional',
    accessToken
  });
}

export function withdrawOptionalCookieConsent(accessToken?: string | null): CookieConsentState {
  return saveCookieConsentChoice({
    categories: { ...DEFAULT_CATEGORIES },
    consentMethod: 'withdrawal',
    accessToken
  });
}

export function getEffectiveCookieCategories(): CookieConsentCategoriesState {
  const stored = getStoredCookieConsent();
  if (!stored || !stored.consentGiven) {
    return { ...DEFAULT_CATEGORIES };
  }
  return stored.categories;
}
