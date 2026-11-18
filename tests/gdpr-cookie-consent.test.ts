import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NODE_ENV = 'test';

// Polyfill minimal browser globals for CookieConsentService & React SSR tests
const storageMap = new Map<string, string>();
const cookieJar = new Map<string, string>();

const mockLocalStorage = {
  getItem: (key: string) => (storageMap.has(key) ? storageMap.get(key)! : null),
  setItem: (key: string, val: string) => {
    storageMap.set(key, String(val));
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  }
};

(globalThis as any).window = {
  localStorage: mockLocalStorage,
  location: { hostname: 'cosulmeu.vercel.app', origin: 'https://cosulmeu.vercel.app' },
  addEventListener: () => {},
  removeEventListener: () => {}
};

(globalThis as any).document = {
  _cookieRaw: '',
  get cookie() {
    return Array.from(cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  },
  set cookie(val: string) {
    const [pair, ...attrs] = val.split(';').map(s => s.trim());
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) return;
    const name = decodeURIComponent(pair.slice(0, eqIdx));
    const value = pair.slice(eqIdx + 1);
    const isExpired = attrs.some(a => a.toLowerCase().includes('1970') || a.toLowerCase() === 'max-age=0');
    if (isExpired || value === '') {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, value);
    }
  }
};

import {
  acceptAllCookies,
  getEffectiveCookieCategories,
  getStoredCookieConsent,
  hasCategoryConsent,
  rejectOptionalCookies,
  saveCookieConsentChoice,
  scriptConsentController,
  shouldShowCookieBanner,
  withdrawOptionalCookieConsent
} from '../src/services/CookieConsentService.js';
import {
  applyThemeToDocument,
  THEME_STORAGE_KEY
} from '../src/services/ThemeService.js';
import {
  COOKIE_BANNER_VERSION,
  COOKIE_POLICY_VERSION,
  GDPR_PROCESSING_MATRIX,
  LEGAL_CONFIG
} from '../src/config/legalConfig.js';
import { CookieConsentBanner } from '../src/components/CookieConsentBanner.js';
import { CookiePreferencesModal } from '../src/components/CookiePreferencesModal.js';
import { Footer } from '../src/components/Footer.js';
import { AuthScreen } from '../src/components/AuthScreen.js';
import { AuthProvider } from '../src/auth/AuthProvider.js';
import { ProfileView } from '../src/components/ProfileView.js';
import {
  gdprAdminRequestUpdateSchema,
  gdprConsentRecordSchema,
  gdprDeleteAccountSchema,
  gdprProfileUpdateSchema,
  gdprRequestCreateSchema,
  gdprWithdrawConsentSchema
} from '../src/server/validation.js';

async function startTestServer(app: http.RequestListener): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      })
  };
}

async function runTests() {
  console.log('🧪 Rulare suită completă de teste GDPR & Cookie Consent (18 scenarii)...');
  const { app, ADMIN_API_KEY, executeGdprAccountDeletion } = await import('../server.ts');

  const noop = () => {};

  // =========================================================================
  // TEST 1: Bannerul apare la prima vizită
  // =========================================================================
  storageMap.clear();
  cookieJar.clear();
  scriptConsentController.resetForTests();

  assert.equal(getStoredCookieConsent(), null, 'Nu trebuie să existe consimțământ salvat la prima vizită');
  assert.equal(shouldShowCookieBanner(), true, 'Bannerul trebuie să fie afișat la prima vizită');

  const bannerHtml = renderToStaticMarkup(
    React.createElement(CookieConsentBanner, {
      visible: true,
      onAcceptAll: noop,
      onRejectOptional: noop,
      onCustomize: noop,
      onNavigateLegal: noop
    })
  );
  assert.ok(bannerHtml.includes('Acceptă toate'), 'Bannerul trebuie să conțină butonul Acceptă toate');
  assert.ok(bannerHtml.includes('Respinge opționalele'), 'Bannerul trebuie să conțină butonul Respinge opționalele');
  assert.ok(bannerHtml.includes('Personalizează'), 'Bannerul trebuie să conțină butonul Personalizează');

  // =========================================================================
  // TEST 2: „Acceptă toate” setează corect preferințele și ascunde bannerul
  // =========================================================================
  const acceptedState = acceptAllCookies(null);
  assert.equal(acceptedState.consentGiven, true);
  assert.equal(acceptedState.consentMethod, 'banner_accept_all');
  assert.deepEqual(acceptedState.categories, {
    necessary: true,
    preferences: true,
    analytics: true,
    marketing: true
  });
  assert.equal(shouldShowCookieBanner(), false, 'Bannerul trebuie ascuns după Acceptă toate');

  // =========================================================================
  // TEST 3: „Respinge opționalele” lasă active doar cookie-urile strict necesare
  // =========================================================================
  storageMap.clear();
  const rejectedState = rejectOptionalCookies(null);
  assert.equal(rejectedState.consentGiven, true);
  assert.equal(rejectedState.consentMethod, 'banner_reject_optional');
  assert.deepEqual(rejectedState.categories, {
    necessary: true,
    preferences: false,
    analytics: false,
    marketing: false
  });
  assert.equal(hasCategoryConsent('necessary'), true);
  assert.equal(hasCategoryConsent('preferences'), false);
  assert.equal(hasCategoryConsent('analytics'), false);
  assert.equal(hasCategoryConsent('marketing'), false);
  assert.equal(shouldShowCookieBanner(), false);

  // =========================================================================
  // TEST 4: „Personalizează” salvează strict categoriile alese
  // =========================================================================
  storageMap.clear();
  const customState = saveCookieConsentChoice({
    categories: {
      necessary: true,
      preferences: true,
      analytics: false,
      marketing: false
    },
    consentMethod: 'custom_preferences'
  });
  assert.deepEqual(customState.categories, {
    necessary: true,
    preferences: true,
    analytics: false,
    marketing: false
  });
  assert.equal(hasCategoryConsent('preferences'), true);
  assert.equal(hasCategoryConsent('analytics'), false);
  assert.equal(hasCategoryConsent('marketing'), false);

  // =========================================================================
  // TEST 5: Preferințele persistă după refresh (citire din localStorage)
  // =========================================================================
  const reloaded = getStoredCookieConsent();
  assert.ok(reloaded, 'Consimțământul trebuie citit din localStorage după refresh');
  assert.equal(reloaded.policyVersion, COOKIE_POLICY_VERSION);
  assert.equal(reloaded.bannerVersion, COOKIE_BANNER_VERSION);
  assert.deepEqual(getEffectiveCookieCategories(), {
    necessary: true,
    preferences: true,
    analytics: false,
    marketing: false
  });
  assert.equal(shouldShowCookieBanner(reloaded), false, 'Bannerul nu trebuie să reapară după refresh dacă versiunea e aceeași');

  // =========================================================================
  // TEST 6 & 13: Scripturile opționale NU rulează înainte de consimțământ, și la retragere se opresc + șterg cookie-urile opționale controlate
  // =========================================================================
  storageMap.clear();
  cookieJar.clear();
  scriptConsentController.resetForTests();

  let analyticsLoadCount = 0;
  let analyticsCleanCount = 0;
  let marketingLoadCount = 0;
  let marketingCleanCount = 0;

  scriptConsentController.registerOptionalScript({
    id: 'test-analytics',
    category: 'analytics',
    description: 'Script test analytics',
    loadFn: () => {
      analyticsLoadCount += 1;
      (globalThis as any).document.cookie = 'cosul_meu_analytics_id=abc123; path=/';
    },
    cleanupFn: () => {
      analyticsCleanCount += 1;
    }
  });

  scriptConsentController.registerOptionalScript({
    id: 'test-marketing',
    category: 'marketing',
    description: 'Script test marketing',
    loadFn: () => {
      marketingLoadCount += 1;
      (globalThis as any).document.cookie = 'cosul_meu_marketing_id=xyz789; path=/';
    },
    cleanupFn: () => {
      marketingCleanCount += 1;
    }
  });

  assert.equal(analyticsLoadCount, 0, 'Analytics nu trebuie să ruleze înainte de consimțământ');
  assert.equal(marketingLoadCount, 0, 'Marketing nu trebuie să ruleze înainte de consimțământ');
  assert.equal(cookieJar.has('cosul_meu_analytics_id'), false);
  assert.equal(cookieJar.has('cosul_meu_marketing_id'), false);

  // Acordăm doar analytics (NU marketing)
  saveCookieConsentChoice({
    categories: { necessary: true, preferences: false, analytics: true, marketing: false },
    consentMethod: 'custom_preferences'
  });
  assert.equal(analyticsLoadCount, 1, 'Analytics trebuie să ruleze după acord');
  assert.equal(marketingLoadCount, 0, 'Marketing trebuie să rămână blocat fără acord');
  assert.equal(cookieJar.has('cosul_meu_analytics_id'), true);

  // Retragem consimțământul opțional
  withdrawOptionalCookieConsent(null);
  assert.equal(analyticsCleanCount, 1, 'Retragerea consimțământului trebuie să apeleze cleanup-ul scriptului');
  assert.equal(cookieJar.has('cosul_meu_analytics_id'), false, 'Cookie-ul opțional controlat de aplicație trebuie șters la retragere');
  const snapAfterWithdraw = scriptConsentController.getRegisteredScriptsSnapshot();
  assert.equal(snapAfterWithdraw.every(s => !s.loaded && s.blockedByConsent), true, 'Toate scripturile opționale trebuie marcate blocate după retragere');

  // =========================================================================
  // TEST 7: Schimbarea versiunii politicii / bannerului reafișează bannerul
  // =========================================================================
  assert.equal(
    shouldShowCookieBanner(getStoredCookieConsent(), '2099-01-new-policy', COOKIE_BANNER_VERSION),
    true,
    'Schimbarea versiunii politicii trebuie să reafișeze bannerul'
  );
  assert.equal(
    shouldShowCookieBanner(getStoredCookieConsent(), COOKIE_POLICY_VERSION, '2099-01-new-banner'),
    true,
    'Schimbarea versiunii bannerului trebuie să reafișeze bannerul'
  );

  // =========================================================================
  // TEST 8, 9, 10, 11, 12: Server HTTP Endpoints, Validare Zod, Izolare Cross-User & Securitate
  // =========================================================================
  const { baseUrl, close } = await startTestServer(app);
  try {
    // 8a. Consent endpoint acceptă vizitator anonim validat cu Zod și respinge payload invalid
    const badConsentRes = await fetch(`${baseUrl}/api/gdpr/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorSessionId: 'x', categories: { necessary: false } })
    });
    assert.equal(badConsentRes.status, 400, 'Payload invalid de consimțământ trebuie respins cu 400');

    const okConsentRes = await fetch(`${baseUrl}/api/gdpr/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorSessionId: 'visitor-session-test-123456',
        policyVersion: COOKIE_POLICY_VERSION,
        bannerVersion: COOKIE_BANNER_VERSION,
        consentMethod: 'banner_reject_optional',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false }
      })
    });
    assert.equal(okConsentRes.status, 200);
    const okConsentJson = await okConsentRes.json();
    assert.equal(okConsentJson.success, true);

    // 9a. Endpoint-urile GDPR personale blochează accesul neautentificat (401) sau cu token fals/altui user
    const protectedEndpoints: Array<{ method: string; url: string; body?: unknown }> = [
      { method: 'GET', url: '/api/gdpr/my-data' },
      { method: 'PATCH', url: '/api/gdpr/profile', body: { firstName: 'Ion' } },
      { method: 'GET', url: '/api/gdpr/export?format=json' },
      { method: 'GET', url: '/api/gdpr/export?format=csv' },
      { method: 'GET', url: '/api/gdpr/requests' },
      { method: 'POST', url: '/api/gdpr/requests', body: { requestType: 'access_data' } },
      { method: 'POST', url: '/api/gdpr/withdraw-consents', body: { channels: ['email_marketing'] } },
      { method: 'POST', url: '/api/gdpr/delete-account', body: { confirmationText: 'STERGE CONTUL', password: 'secret' } },
      { method: 'GET', url: '/api/receipts/fake-receipt-id/image' },
      { method: 'DELETE', url: '/api/receipts/fake-receipt-id' }
    ];

    for (const ep of protectedEndpoints) {
      const resNoAuth = await fetch(`${baseUrl}${ep.url}`, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert.equal(
        resNoAuth.status,
        401,
        `Endpoint-ul protejat ${ep.method} ${ep.url} trebuie să returneze 401 fără token valid`
      );

      const resFakeJwt = await fetch(`${baseUrl}${ep.url}`, {
        method: ep.method,
        headers: {
          Authorization: 'Bearer invalid-forged-jwt-user-b',
          ...(ep.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert.equal(
        resFakeJwt.status,
        401,
        `Endpoint-ul protejat ${ep.method} ${ep.url} trebuie să respingă JWT invalid/falsificat`
      );
    }

    // 9b. Rutele /api/admin/gdpr/* sunt protejate prin requireAdminAuth
    const adminNoToken = await fetch(`${baseUrl}/api/admin/gdpr/requests`);
    assert.equal(adminNoToken.status, 401, 'Admin GDPR endpoint trebuie să ceară Bearer token');

    const adminWrongToken = await fetch(`${baseUrl}/api/admin/gdpr/requests`, {
      headers: { Authorization: 'Bearer wrong-admin-token' }
    });
    assert.equal(adminWrongToken.status, 403, 'Admin GDPR endpoint trebuie să respingă token invalid cu 403');

    const adminPatchWrong = await fetch(`${baseUrl}/api/admin/gdpr/requests/1234`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ADMIN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'invalid_status' })
    });
    assert.ok([400, 503].includes(adminPatchWrong.status), 'Admin GDPR PATCH validat Zod sau guard service_role');
  } finally {
    await close();
  }

  // =========================================================================
  // Verificare scheme Zod & reguli de business GDPR (Tests 8, 10, 11)
  // =========================================================================
  assert.equal(
    gdprDeleteAccountSchema.safeParse({ confirmationText: 'nu vreau', password: 'abc' }).success,
    false,
    'Ștergerea contului fără textul exact STERGE CONTUL trebuie respinsă'
  );
  assert.equal(
    gdprDeleteAccountSchema.safeParse({ confirmationText: 'STERGE CONTUL', password: 'password123' }).success,
    true
  );
  assert.equal(
    gdprProfileUpdateSchema.safeParse({
      firstName: 'Ana',
      lastName: 'Ionescu',
      email: 'ana@exemplu.ro',
      phone: '0722111222',
      marketingConsent: false
    }).success,
    true
  );
  assert.equal(
    gdprProfileUpdateSchema.safeParse({ email: 'nu-e-email' }).success,
    false
  );
  assert.equal(
    gdprRequestCreateSchema.safeParse({ requestType: 'export_data', requestedFormat: 'csv' }).success,
    true
  );
  assert.equal(
    gdprAdminRequestUpdateSchema.safeParse({ status: 'procesata', adminResponse: 'Rezolvat conform art. 15 GDPR' }).success,
    true
  );
  assert.equal(
    gdprWithdrawConsentSchema.safeParse({ channels: [] }).success,
    false
  );
  assert.equal(
    gdprConsentRecordSchema.safeParse({
      visitorSessionId: 'vis_test_999999',
      policyVersion: COOKIE_POLICY_VERSION,
      bannerVersion: COOKIE_BANNER_VERSION,
      consentMethod: 'custom_preferences',
      categories: { necessary: true, preferences: true, analytics: false, marketing: false }
    }).success,
    true
  );

  // =========================================================================
  // Verificare SQL Migration 011 RLS & izolare (Tests 9 & 12)
  // =========================================================================
  const migrationSql = fs.readFileSync(
    path.resolve('src/db/migrations/011_gdpr_and_cookie_consent.sql'),
    'utf8'
  );
  assert.ok(migrationSql.includes('ENABLE ROW LEVEL SECURITY'), 'Migrația 011 trebuie să activeze RLS');
  assert.ok(migrationSql.includes('USING (auth.uid() = user_id)'), 'Migrația 011 trebuie să izoleze tabelele per auth.uid()');
  assert.ok(migrationSql.includes('gdpr_operation_logs ENABLE ROW LEVEL SECURITY'), 'gdpr_operation_logs trebuie protejat strict fără acces client');
  assert.ok(migrationSql.includes('trg_protect_cookie_consents_immutable'), 'cookie_consents trebuie protejat împotriva alterării');
  assert.ok(migrationSql.includes('trg_protect_comm_consents_immutable'), 'communication_consents trebuie protejat împotriva alterării');
  assert.ok(
    migrationSql.includes('marketing_opt_in BOOLEAN := COALESCE') &&
    migrationSql.includes('FALSE,\n    FALSE,\n    FALSE,\n    marketing_opt_in'),
    'Triggerul de profil nou trebuie să lase notificările și marketingul dezactivate implicit'
  );

  // =========================================================================
  // TEST 14: Responsive, Dark Mode, Accesibilitate & Separare comunicări în AuthScreen
  // =========================================================================
  const modalHtml = renderToStaticMarkup(
    React.createElement(CookiePreferencesModal, {
      open: true,
      initialCategories: { necessary: true, preferences: false, analytics: false, marketing: false },
      onClose: noop,
      onSavePreferences: noop,
      onAcceptAll: noop,
      onRejectOptional: noop,
      onWithdrawOptional: noop,
      onNavigateLegal: noop
    })
  );
  assert.ok(modalHtml.includes('role="dialog"'), 'Modalul trebuie să aibă role="dialog"');
  assert.ok(modalHtml.includes('aria-modal="true"'), 'Modalul trebuie să aibă aria-modal="true"');
  assert.ok(modalHtml.includes('role="switch"'), 'Modalul trebuie să folosească controale role="switch" accesibile');
  assert.ok(modalHtml.includes('Strict necesare'), 'Modalul trebuie să afișeze categoria Strict necesare');
  assert.ok(modalHtml.includes('0 scripturi instalate în prezent'), 'Modalul trebuie să informeze onest că nu există scripturi de analiză/marketing');

  const authSignupHtml = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(AuthScreen, { initialMode: 'signup' })
    )
  );
  assert.ok(authSignupHtml.includes('Prenume (opțional)'), 'Înregistrarea trebuie să aibă câmp opțional Prenume');
  assert.ok(authSignupHtml.includes('Nume (opțional)'), 'Înregistrarea trebuie să aibă câmp opțional Nume');
  assert.ok(authSignupHtml.includes('Opțional — Newsletter și noutăți prin email'), 'Înregistrarea trebuie să separe bifa de marketing');
  // Checkbox-ul de marketing nu trebuie să fie bifat implicit
  const checkboxTagMatch = authSignupHtml.match(/<input[^>]*type="checkbox"[^>]*>/i);
  assert.ok(checkboxTagMatch, 'Trebuie să existe checkbox-ul de marketing în formularul signup');
  assert.ok(!/\bchecked\b/i.test(checkboxTagMatch[0]), 'Checkbox-ul de marketing nu trebuie să fie bifat implicit');

  const footerHtml = renderToStaticMarkup(
    React.createElement(Footer, {
      activeLegalRoute: null,
      onNavigateLegal: noop,
      onNavigateHome: noop,
      onOpenCookieSettings: noop,
      isAuthenticated: false
    })
  );
  assert.ok(footerHtml.includes('Setări cookie-uri'), 'Footer trebuie să includă permanent butonul Setări cookie-uri');

  const profilePrivacyHtml = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(ProfileView, {
        userProfile: {
          name: 'Ana Test',
          email: 'ana.test@exemplu.ro',
          city: 'București',
          preferredStores: ['kaufland'],
          monthlySavingsGoal: 300,
          notificationsEnabled: false,
          defaultTransportCostEstimate: 0,
          useLoyaltyCards: false,
          theme: 'light'
        },
        onUpdateProfile: noop,
        onResetAllData: noop,
        onOpenCookieSettings: noop,
        initialTab: 'privacy'
      })
    )
  );
  assert.ok(profilePrivacyHtml.includes('role="tablist"'), 'ProfileView trebuie să afișeze bara de tab-uri');
  assert.ok(profilePrivacyHtml.includes('Confidențialitate și date personale'), 'Tab-ul Confidențialitate și date personale trebuie să fie afișat');
  assert.ok(profilePrivacyHtml.includes('Descarcă JSON'), 'Tab-ul GDPR trebuie să includă opțiunea de export JSON');
  assert.ok(profilePrivacyHtml.includes('Resetează memoria locală'), 'Tab-ul GDPR trebuie să includă opțiunea de ștergere date locale');

  // Verificare zero secreți service_role în bundle-ul client src/
  const clientFiles = [
    'src/App.tsx',
    'src/lib/supabase.ts',
    'src/services/CookieConsentService.ts',
    'src/components/ProfileGdprSection.tsx'
  ];
  for (const file of clientFiles) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    assert.ok(
      !content.includes('SUPABASE_SERVICE_ROLE_KEY'),
      `Fișierul client ${file} nu trebuie să conțină referințe la SUPABASE_SERVICE_ROLE_KEY`
    );
  }

  assert.ok(GDPR_PROCESSING_MATRIX.length >= 6, 'Matricea GDPR trebuie să acopere scopurile reale ale platformei');
  assert.equal(LEGAL_CONFIG.operator.operatorType, 'individual');

  // =========================================================================
  // TEST 15: Igienă localStorage pentru cosul_meu_theme înainte și după retragere consimțământ
  // =========================================================================
  storageMap.clear();
  cookieJar.clear();
  applyThemeToDocument('dark', false, false);
  assert.equal(
    storageMap.has(THEME_STORAGE_KEY),
    false,
    'cosul_meu_theme nu trebuie scris în localStorage înainte de consimțământul preferences'
  );
  // Cu consimțământ preferences acordat, tema poate fi salvată local
  saveCookieConsentChoice({
    categories: { necessary: true, preferences: true, analytics: false, marketing: false },
    consentMethod: 'custom_preferences'
  });
  applyThemeToDocument('dark', false, hasCategoryConsent('preferences'));
  assert.equal(storageMap.get(THEME_STORAGE_KEY), 'dark');
  // La respingerea/retragerea opționalelor, cosul_meu_theme este șters
  withdrawOptionalCookieConsent(null);
  assert.equal(
    storageMap.has(THEME_STORAGE_KEY),
    false,
    'Retragerea consimțământului preferences trebuie să șteargă cosul_meu_theme din localStorage'
  );

  // =========================================================================
  // TEST 16: Execuție completă vs parțială pentru executeGdprAccountDeletion
  // =========================================================================
  function createMockSupabaseDeletionClient(opts: {
    failTables?: Record<string, { code?: string; message: string }>;
    failStorageBuckets?: Record<string, string>;
    failAuthDelete?: string | null;
    createdTickets?: any[];
  }) {
    const client: any = {
      storage: {
        from: (bucket: string) => ({
          list: async (prefix: string) => {
            if (prefix === 'user-1') {
              return { data: [{ id: 'file-1', name: 'doc1.jpg' }], error: null };
            }
            return { data: [], error: null };
          },
          remove: async () => {
            const errMsg = opts.failStorageBuckets?.[bucket];
            return errMsg ? { error: { message: errMsg } } : { error: null };
          }
        })
      },
      from: (table: string) => ({
        select: () => ({
          eq: async () => {
            if (table === 'shopping_lists') {
              return { data: [{ id: 'list-1' }], error: null };
            }
            return { data: [], error: null };
          }
        }),
        delete: () => ({
          eq: async () => {
            const err = opts.failTables?.[table];
            return err ? { error: err } : { error: null };
          },
          in: async () => {
            const err = opts.failTables?.[table];
            return err ? { error: err } : { error: null };
          }
        }),
        update: () => ({
          eq: async () => {
            const err = opts.failTables?.[table];
            return err ? { error: err } : { error: null };
          }
        }),
        insert: (payload: any) => {
          opts.createdTickets?.push(payload);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: 'ticket-remed-1' }, error: null })
            })
          };
        }
      }),
      auth: {
        admin: {
          deleteUser: async () =>
            opts.failAuthDelete ? { error: { message: opts.failAuthDelete } } : { error: null }
        }
      }
    };
    return client;
  }

  // 16a. Ștergere completă reușită (inclusiv ignorare grațioasă PGRST205 pentru tabel opțional neaplicat)
  const fullClient = createMockSupabaseDeletionClient({
    failTables: { user_price_observations: { code: 'PGRST205', message: 'Could not find the table' } }
  });
  const fullRes = await executeGdprAccountDeletion({
    userId: 'user-1',
    cleanupClient: fullClient,
    adminClient: fullClient
  });
  assert.equal(fullRes.summary.completedFully, true);
  assert.equal(fullRes.summary.partialFailure, false);
  assert.equal(fullRes.summary.authUserDeleted, true);
  assert.equal(fullRes.summary.receiptImagesDeleted, 1);
  assert.equal(fullRes.summary.avatarFilesDeleted, 1);
  assert.equal(fullRes.summary.failedTables.length, 0);
  assert.equal(fullRes.summary.storageErrors.length, 0);

  // 16b. Eșec parțial (eroare Storage + eroare DB + lipsă Auth admin) -> NU raportează succes complet!
  const tickets: any[] = [];
  const partialClient = createMockSupabaseDeletionClient({
    failTables: { receipts: { code: '42501', message: 'permission denied' } },
    failStorageBuckets: { 'receipt-images': 'Bucket delete denied' },
    failAuthDelete: 'Auth admin failure',
    createdTickets: tickets
  });
  const partialRes = await executeGdprAccountDeletion({
    userId: 'user-1',
    cleanupClient: partialClient,
    adminClient: partialClient
  });
  assert.equal(partialRes.summary.completedFully, false);
  assert.equal(partialRes.summary.partialFailure, true);
  assert.equal(partialRes.summary.authUserDeleted, false);
  assert.equal(partialRes.summary.failedTables.length, 1);
  assert.equal(partialRes.summary.failedTables[0].table, 'receipts');
  assert.equal(partialRes.summary.storageErrors.length, 1);
  assert.equal(partialRes.summary.storageErrors[0].bucket, 'receipt-images');
  assert.ok(partialRes.summary.remediationSteps.length >= 3);
  assert.equal(partialRes.summary.remediationRequestId, 'ticket-remed-1');
  assert.equal(tickets.length, 1);

  // =========================================================================
  // TEST 17: Audit consistență canonică migrații Supabase (fără conflicte audit_log)
  // =========================================================================
  const auditFiles = [
    'src/lib/migrations/002_create_audit_log.sql',
    'src/lib/migrations/003_create_audit_log.sql',
    'src/lib/migrations/gdpr_init.sql'
  ];
  for (const relPath of auditFiles) {
    const sql = fs.readFileSync(path.resolve(relPath), 'utf8');
    assert.ok(sql.includes('actor_hash VARCHAR(64)'), `${relPath} trebuie să folosească schema canonică actor_hash`);
    assert.ok(sql.includes('chk_audit_log_no_pii_metadata'), `${relPath} trebuie să blocheze cheile PII în metadata`);
    assert.ok(sql.includes('current_actor_sha256()'), `${relPath} trebuie să folosească current_actor_sha256()`);
    assert.ok(sql.includes('audit_log_select_admin'), `${relPath} trebuie să permită citirea admin pentru audit_log`);
    assert.ok(sql.includes('prevent_audit_log_mutation'), `${relPath} trebuie să includă triggerul de imutabilitate`);
    assert.equal(
      /CREATE POLICY\s+audit_log_insert_own/i.test(sql),
      false,
      `${relPath} nu trebuie să permită INSERT direct din client în audit_log`
    );
  }

  for (const reqRelPath of [
    'src/db/migrations/011_gdpr_and_cookie_consent.sql',
    'src/lib/migrations/002_create_gdpr_requests.sql',
    'src/lib/migrations/gdpr_init.sql'
  ]) {
    const sql = fs.readFileSync(path.resolve(reqRelPath), 'utf8');
    assert.ok(sql.includes('gdpr_requests_select_admin'), `${reqRelPath} trebuie să includă SELECT admin`);
    assert.ok(sql.includes('gdpr_requests_update_admin'), `${reqRelPath} trebuie să includă UPDATE admin`);
    assert.ok(sql.includes('trg_gdpr_requests_updated_at'), `${reqRelPath} trebuie să actualizeze automat updated_at`);
  }

  // =========================================================================
  // TEST 18: Audit static 0 scripturi externe de tracking/marketing în client & index.html
  // =========================================================================
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
  const forbiddenTrackers = [
    'googletagmanager.com',
    'google-analytics.com',
    'gtag(',
    'fbq(',
    'connect.facebook.net',
    'posthog',
    'plausible.io',
    'mixpanel',
    'hotjar'
  ];
  for (const marker of forbiddenTrackers) {
    assert.equal(
      indexHtml.toLowerCase().includes(marker),
      false,
      `index.html nu trebuie să conțină scripturi de tracking/marketing (${marker})`
    );
  }

  const serverSource = fs.readFileSync(path.resolve('server.ts'), 'utf8');
  for (const requiredAuditAction of [
    "'data_exported'",
    "'gdpr_request_created'",
    "'account_deleted'",
    "'consent_withdrawn'",
    "'data_rectified'",
    "'gdpr_request_resolved'"
  ]) {
    assert.ok(
      serverSource.includes(requiredAuditAction),
      `server.ts trebuie să înregistreze acțiunea critică de audit ${requiredAuditAction}`
    );
  }

  console.log('✅ Toate cele 18 scenarii GDPR & Cookie Consent au trecut cu succes!');
}

runTests().catch(err => {
  console.error('❌ Eroare în suita de teste GDPR & Cookie Consent:', err);
  process.exit(1);
});
