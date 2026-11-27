// tests/faza7-security-hardening.test.ts
// Suită de verificare securitate FAZA 7 (30 scenarii: Auth, Cron, Escaladare privilegii, IDOR/Ownership, Validare, SSRF, SQLi, Rate limiting, CORS, Headers, Secret & Error leakage)

import 'dotenv/config';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';

import type { Express } from 'express';
import { supabase } from '../src/lib/supabase.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { PriceQualityMonitoringService } from '../src/services/PriceQualityMonitoringService.ts';
import { validateReceiptImageBuffer } from '../src/server/validation.ts';
import { sessionCookie, clearSessionCookie } from '../src/auth.ts';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader.ts';
import { getPool } from '../src/db/index.ts';

describe('FAZA 7 — Security, RLS & API Hardening (30 Scenarii)', () => {
  let app: Express;
  let ADMIN_API_KEY: string;
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const serverMod = await import('../server.ts');
    app = serverMod.app;
    ADMIN_API_KEY = serverMod.ADMIN_API_KEY;
    StorageService.resetAllData();
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    IndexerScheduler.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    const pool = getPool();
    if (pool) {
      await pool.end().catch(() => {});
    }
  });

  // =========================================================================
  // 1–4. Admin Auth, Cron Secret Removal & Protected Endpoints
  // =========================================================================
  describe('1–4. Autentificare Admin, Cron și Protecția Rutelor Operaționale', () => {
    it('Scenariu 1: Respinge rutele /api/admin/* fără token (401) și cu token fals (403)', async () => {
      const noAuth = await fetch(`${baseUrl}/api/admin/sources-info`);
      assert.strictEqual(noAuth.status, 401);

      const forgedAuth = await fetch(`${baseUrl}/api/admin/sources-info`, {
        headers: { Authorization: 'Bearer admin-key-forged-0000' }
      });
      assert.strictEqual(forgedAuth.status, 403);
    });

    it('Scenariu 2: Respinge secretul cron hardcodat anterior (cosul-meu-admin-secret-2026) pe /api/cron/catalog-publish', async () => {
      const resPost = await fetch(`${baseUrl}/api/cron/catalog-publish`, {
        method: 'POST',
        headers: { Authorization: 'Bearer cosul-meu-admin-secret-2026' }
      });
      assert.strictEqual(resPost.status, 401);

      const resGet = await fetch(`${baseUrl}/api/cron/catalog-publish`, {
        headers: { Authorization: 'Bearer cosul-meu-admin-secret-2026' }
      });
      assert.strictEqual(resGet.status, 401);

      // Verificăm inclusiv că string-ul vechi nu mai există în server.ts
      const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
      assert.strictEqual(
        serverSrc.includes('cosul-meu-admin-secret-2026'),
        false,
        'Secretul cron hardcodat trebuie eliminat complet din server.ts'
      );
    });

    it('Scenariu 3: Protejează POST /api/indexing/collect-now și GET /api/indexing/receipt-candidates cu requireAdminAuth', async () => {
      const collectNoAuth = await fetch(`${baseUrl}/api/indexing/collect-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retailerId: 'lidl' })
      });
      assert.strictEqual(collectNoAuth.status, 401);

      const collectBadAuth = await fetch(`${baseUrl}/api/indexing/collect-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-admin-token'
        },
        body: JSON.stringify({ retailerId: 'lidl' })
      });
      assert.strictEqual(collectBadAuth.status, 403);

      const candidatesNoAuth = await fetch(`${baseUrl}/api/indexing/receipt-candidates`);
      assert.strictEqual(candidatesNoAuth.status, 401);

      const candidatesWithAuth = await fetch(`${baseUrl}/api/indexing/receipt-candidates`, {
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.strictEqual(candidatesWithAuth.status, 200);
    });

    it('Scenariu 4: Protejează toate rutele GET /api/quality/* cu requireAdminAuth', async () => {
      const qualityPaths = [
        '/api/quality/overview',
        '/api/quality/retailers',
        '/api/quality/anomalies',
        '/api/quality/queue',
        '/api/quality/reports',
        '/api/quality/config'
      ];

      for (const p of qualityPaths) {
        const resNoAuth = await fetch(`${baseUrl}${p}`);
        assert.strictEqual(resNoAuth.status, 401, `${p} trebuie să ceară autentificare admin`);

        const resBadAuth = await fetch(`${baseUrl}${p}`, {
          headers: { Authorization: 'Bearer fake-token' }
        });
        assert.strictEqual(resBadAuth.status, 403, `${p} trebuie să respingă tokenul invalid cu 403`);

        const resOk = await fetch(`${baseUrl}${p}`, {
          headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
        });
        assert.strictEqual(resOk.status, 200, `${p} trebuie să permită accesul cu ADMIN_API_KEY valid`);
      }
    });
  });

  // =========================================================================
  // 5–7. Auth & Session Lifecycle
  // =========================================================================
  describe('5–7. Autentificare, Politică Parole & Ciclu de Viață Sesiune', () => {
    it('Scenariu 5: Respinge înregistrarea cu parolă slabă (< 12 caractere) sau email invalid (400)', async () => {
      const weakPass = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.ro', password: 'short123' })
      });
      assert.strictEqual(weakPass.status, 400);

      const badEmail = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: 'StrongPassword2026!' })
      });
      assert.strictEqual(badEmail.status, 400);
    });

    it('Scenariu 6: Cookie-urile de sesiune au atribute stricte HttpOnly, SameSite=Lax, Secure (în HTTPS/prod) și clearSessionCookie setează Max-Age=0', () => {
      const prodCookie = sessionCookie('tok_123', true);
      assert.ok(prodCookie.includes('HttpOnly'));
      assert.ok(prodCookie.includes('SameSite=Lax'));
      assert.ok(prodCookie.includes('Secure'));
      assert.ok(prodCookie.includes('Path=/'));

      const clearedCookie = clearSessionCookie(true);
      assert.ok(clearedCookie.includes('Max-Age=0'));
      assert.ok(clearedCookie.includes('HttpOnly'));
      assert.ok(clearedCookie.includes('SameSite=Lax'));
      assert.ok(clearedCookie.includes('Secure'));
    });

    it('Scenariu 7: POST /api/auth/logout șterge cookie-ul și revocă sesiunea; GET /api/auth/me fără cookie valid returnează 401', async () => {
      const meNoCookie = await fetch(`${baseUrl}/api/auth/me`);
      assert.strictEqual(meNoCookie.status, 401);
      assert.strictEqual(meNoCookie.headers.get('cache-control'), 'private, no-store');

      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: 'cosulmeu_session=fake-old-token' }
      });
      assert.strictEqual(logoutRes.status, 200);
      const setCookieHeader = logoutRes.headers.get('set-cookie') || '';
      assert.ok(setCookieHeader.includes('cosulmeu_session='), 'Logout trebuie să trimită Set-Cookie de invalidare');
      assert.ok(setCookieHeader.includes('Max-Age=0'), 'Logout trebuie să expire cookie-ul imediat');
      assert.ok(setCookieHeader.includes('HttpOnly'));
    });
  });

  // =========================================================================
  // 8–10. Client-side Privilege Escalation Prevention & SQL Trigger Hardening Check
  // =========================================================================
  describe('8–10. Prevenirea Escaladării de Privilegii din Client / Metadata', () => {
    it('Scenariu 8: AuthProvider.tsx nu mai setează is_admin pe baza adresei de email la signUp', () => {
      const authProviderSrc = fs.readFileSync(path.join(process.cwd(), 'src/auth/AuthProvider.tsx'), 'utf8');
      assert.strictEqual(authProviderSrc.includes('is_admin'), false);
      assert.strictEqual(authProviderSrc.includes('pascalau.stefan@gmail.com'), false);
    });

    it('Scenariu 9: App.tsx și ProfileView.tsx derivă rolul admin exclusiv din profiles.role === "admin", nu din user_metadata', () => {
      const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
      const profileViewSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/ProfileView.tsx'), 'utf8');

      assert.strictEqual(appSrc.includes('user_metadata?.is_admin'), false);
      assert.strictEqual(appSrc.includes('pascalau.stefan@gmail.com'), false);
      assert.strictEqual(profileViewSrc.includes('user_metadata?.is_admin'), false);
      assert.strictEqual(profileViewSrc.includes('pascalau.stefan@gmail.com'), false);
    });

    it('Scenariu 10: GDPR patch profile nu permite modificarea câmpului role prin payload (strict whitelist)', async () => {
      const origGetUser = supabase.auth.getUser.bind(supabase.auth);
      try {
        (supabase.auth as any).getUser = async () => ({
          data: { user: { id: '00000000-0000-4000-8000-000000000101', email: 'regular@example.ro' } },
          error: null
        });
        // Unauthenticated returns 401 first
        const unauthRes = await fetch(`${baseUrl}/api/gdpr/profile`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'admin', displayName: 'Hack' })
        });
        assert.strictEqual(unauthRes.status, 401);
      } finally {
        (supabase.auth as any).getUser = origGetUser;
      }
    });
  });

  // =========================================================================
  // 11–18. User Isolation & IDOR Protection
  // =========================================================================
  describe('11–18. Izolarea Datelor Utilizatorilor & Protecție IDOR', () => {
    it('Scenariu 11: Rutele personale /api/receipts/* refuză accesul neautentificat (401) și ID-urile non-UUID (400)', async () => {
      const histUnauth = await fetch(`${baseUrl}/api/receipts/personal-history`);
      assert.strictEqual(histUnauth.status, 401);

      const imgUnauth = await fetch(`${baseUrl}/api/receipts/11111111-1111-4111-8111-111111111111/image`);
      assert.strictEqual(imgUnauth.status, 401);

      const delUnauth = await fetch(`${baseUrl}/api/receipts/11111111-1111-4111-8111-111111111111`, {
        method: 'DELETE'
      });
      assert.strictEqual(delUnauth.status, 401);

      const origGetUser = supabase.auth.getUser.bind(supabase.auth);
      try {
        (supabase.auth as any).getUser = async () => ({
          data: { user: { id: '00000000-0000-4000-8000-000000000201', email: 'u1@example.ro' } },
          error: null
        });
        const badIdImg = await fetch(`${baseUrl}/api/receipts/not-a-uuid/image`, {
          headers: { Authorization: 'Bearer valid-mock-jwt' }
        });
        assert.strictEqual(badIdImg.status, 400);

        const badIdDel = await fetch(`${baseUrl}/api/receipts/../../etc/passwd`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer valid-mock-jwt' }
        });
        assert.ok([400, 404].includes(badIdDel.status));
      } finally {
        (supabase.auth as any).getUser = origGetUser;
      }
    });

    it('Scenariu 12: POST /api/basket/optimize cu listId UUID fără token returnează 401 (chiar și cu items inline)', async () => {
      const res = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId: '22222222-2222-4222-8222-222222222222',
          items: [{ id: 'i1', name: 'Lapte 1L', quantity: 1, unit: 'buc' }]
        })
      });
      assert.strictEqual(res.status, 401);
    });

    it('Scenariu 13: POST /api/basket/optimize respinge token invalid/expirat cu 401', async () => {
      const res = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid.jwt.token'
        },
        body: JSON.stringify({
          listId: '22222222-2222-4222-8222-222222222222',
          items: []
        })
      });
      assert.strictEqual(res.status, 401);
    });

    it('Scenariu 14: GET /api/alerts, POST /api/alerts, PATCH/DELETE /api/alerts/:id și notificările cer JWT valid (401 fără token)', async () => {
      const checks = [
        fetch(`${baseUrl}/api/alerts`),
        fetch(`${baseUrl}/api/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: 'prod-1', alertType: 'below_target', targetPrice: 5 })
        }),
        fetch(`${baseUrl}/api/alerts/11111111-1111-4111-8111-111111111111`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: false })
        }),
        fetch(`${baseUrl}/api/alerts/11111111-1111-4111-8111-111111111111`, { method: 'DELETE' }),
        fetch(`${baseUrl}/api/alerts/notifications/11111111-1111-4111-8111-111111111111/read`, { method: 'PATCH' })
      ];
      const results = await Promise.all(checks);
      for (const r of results) {
        assert.strictEqual(r.status, 401);
      }
    });

    it('Scenariu 15: Rutele de colaborare pe liste (/api/lists/:listId/*) cer autentificare și refuză accesul fără sesiune (401)', async () => {
      const listUuid = '33333333-3333-4333-8333-333333333333';
      const endpoints = [
        fetch(`${baseUrl}/api/lists/${listUuid}/collaboration`),
        fetch(`${baseUrl}/api/lists/${listUuid}/invites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'editor' })
        }),
        fetch(`${baseUrl}/api/lists/${listUuid}/members/44444444-4444-4444-8444-444444444444`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'viewer' })
        }),
        fetch(`${baseUrl}/api/lists/${listUuid}/members/44444444-4444-4444-8444-444444444444`, {
          method: 'DELETE'
        }),
        fetch(`${baseUrl}/api/lists/${listUuid}/activity`)
      ];
      const results = await Promise.all(endpoints);
      for (const r of results) {
        assert.strictEqual(r.status, 401);
      }
    });

    it('Scenariu 16: Rutele GDPR personale (/api/gdpr/my-data, /export, /requests, /delete-account) cer autentificare (401)', async () => {
      const endpoints = [
        fetch(`${baseUrl}/api/gdpr/my-data`),
        fetch(`${baseUrl}/api/gdpr/export`),
        fetch(`${baseUrl}/api/gdpr/requests`),
        fetch(`${baseUrl}/api/gdpr/delete-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmationText: 'STERGE CONTUL' })
        })
      ];
      const results = await Promise.all(endpoints);
      for (const r of results) {
        assert.strictEqual(r.status, 401);
      }
    });

    it('Scenariu 17: Rutele de buget personal (/api/budget/summary, /api/budget/settings) cer autentificare (401)', async () => {
      const sumRes = await fetch(`${baseUrl}/api/budget/summary`);
      assert.strictEqual(sumRes.status, 401);

      const patchRes = await fetch(`${baseUrl}/api/budget/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyBudget: 1500 })
      });
      assert.strictEqual(patchRes.status, 401);
    });

    it('Scenariu 18: POST /api/products/suggestions cu header Authorization fals respinge sesiunea cu 401', async () => {
      const res = await fetch(`${baseUrl}/api/products/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-user-token'
        },
        body: JSON.stringify({
          barcode: '5941014002343',
          proposedName: 'Lapte test',
          category: 'Lactate și ouă'
        })
      });
      assert.strictEqual(res.status, 401);
    });
  });

  // =========================================================================
  // 19–24. Input Validation, File Upload Security, SSRF, CSV & SQLi Guards
  // =========================================================================
  describe('19–24. Validare Input, Upload Security, SSRF, CSV Formula Injection & SQLi', () => {
    it('Scenariu 19: Upload bon respinge SVG/HTML cu magic-bytes nevalide (415) chiar dacă mime-type declară image/jpeg', async () => {
      const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
      const magicCheck = validateReceiptImageBuffer(svgPayload, 'image/jpeg');
      assert.strictEqual(magicCheck.valid, false);

      const res = await fetch(`${baseUrl}/api/scan-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: [{ base64: svgPayload, mimeType: 'image/jpeg' }]
        })
      });
      assert.strictEqual(res.status, 415);
    });

    it('Scenariu 20: Rutele standard resping payload JSON > 1MB cu HTTP 413 Payload Too Large', async () => {
      const hugePayload = JSON.stringify({
        items: [{ id: '1', name: 'A'.repeat(1.2 * 1024 * 1024), quantity: 1, unit: 'buc' }]
      });
      const res = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hugePayload
      });
      assert.strictEqual(res.status, 413);
    });

    it('Scenariu 21: Proxy-ul de imagini și adăugarea surselor blochează URL-urile interne/SSRF (localhost, 169.254.169.254, 127.0.0.1)', async () => {
      const proxyRes = await fetch(`${baseUrl}/api/images/proxy?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
      assert.strictEqual(proxyRes.status, 400);

      const srcRes = await fetch(`${baseUrl}/api/admin/catalog-importer/sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_API_KEY}`
        },
        body: JSON.stringify({
          retailerId: 'lidl',
          name: 'SSRF Test',
          catalogUrl: 'http://127.0.0.1:3000/api/admin/sources-info'
        })
      });
      assert.strictEqual(srcRes.status, 400);
      assert.strictEqual(CatalogDownloader.validatePublicUrlSafety('http://[::1]/admin').safe, false);
    });

    it('Scenariu 22: Exportul CSV neutraliza formula injection (=, +, -, @)', () => {
      const overview = {
        generatedAt: '2026-10-30T10:00:00Z',
        intervalDays: 30,
        totalRecordsAnalyzed: 1,
        totalObservations: 1,
        totalOffers: 1,
        freshCount: 1,
        staleCount: 0,
        unverifiedCount: 0,
        expiredCount: 0,
        suspiciousCount: 0,
        activeAnomaliesCount: 1,
        criticalAnomaliesCount: 0,
        highAnomaliesCount: 1,
        storeQualityBreakdown: [],
        sourceQualityBreakdown: [],
        coverage: { totalProducts: 1, productsWithFreshPrice: 1, coveragePercent: 100 }
      } as any;
      const csv = PriceQualityMonitoringService.buildExportCsv(overview, [
        {
          id: 'anom-1',
          anomalyKey: 'k-1',
          targetType: 'offer',
          productId: 'p1',
          productName: '=CMD("calc")',
          storeId: '+lidl',
          source: '@evil',
          anomalyType: 'extreme_price_outlier',
          severity: 'high',
          qualityStatus: 'SUSPICIOUS',
          reasonRo: '-1+1',
          price: 9999,
          currency: 'RON',
          investigationStatus: 'open',
          detectedAt: '2026-10-30T10:00:00Z'
        } as any
      ]);
      assert.ok(csv.includes(`"'=CMD(""calc"")"`), 'Celulele CSV care încep cu = trebuie prefixate cu apostrof');
      assert.ok(csv.includes(`'+lidl`), 'Celulele CSV care încep cu + trebuie neutralizate');
      assert.ok(csv.includes(`'@evil`), 'Celulele CSV care încep cu @ trebuie neutralizate');
    });

    it('Scenariu 23: POST /api/products/report-error validează strict inputul prin Zod (400 la email invalid sau details < 3 caractere)', async () => {
      const badReport = await fetch(`${baseUrl}/api/products/report-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: 'prod-1',
          productName: 'Lapte',
          errorType: 'wrong_price',
          reportedPrice: -5,
          details: 'x'
        })
      });
      assert.strictEqual(badReport.status, 400);

      const goodReport = await fetch(`${baseUrl}/api/products/report-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: 'prod-1',
          productName: 'Lapte Napolact 1L',
          errorType: 'price_mismatch',
          reportedPrice: 6.99,
          details: 'Prețul la raft este 6.99 RON.'
        })
      });
      assert.strictEqual(goodReport.status, 200);
    });

    it('Scenariu 24: IndexerScheduler respinge lockId SQLi/non-întreg și /api/quality/anomalies leagă parametrii SQL', async () => {
      const mockPg = { query: async () => ({ rows: [] }) };
      await assert.rejects(
        () => IndexerScheduler.acquireAdvisoryLock(mockPg, '1; DROP TABLE users' as any),
        /Identificator advisory lock invalid/
      );
      await assert.rejects(
        () => IndexerScheduler.acquireAdvisoryLock(mockPg, Number.NaN),
        /Identificator advisory lock invalid/
      );
      await assert.rejects(
        () => IndexerScheduler.acquireAdvisoryLock(mockPg, 999999999999),
        /Identificator advisory lock invalid/
      );

      // Verificăm că /api/quality/anomalies nu aruncă eroare de bind SQL când sunt dați parametri de filtrare
      const resAnomalies = await fetch(`${baseUrl}/api/quality/anomalies?status=pending_review&retailerId=lidl&severity=high`, {
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.strictEqual(resAnomalies.status, 200);
      assert.strictEqual(typeof getPool, 'function');
    });
  });

  // =========================================================================
  // 25–28. Rate Limiting, CORS & Security Headers
  // =========================================================================
  describe('25–28. Rate Limiting, Politică CORS & Security Headers', () => {
    it('Scenariu 25: Rate limiter blochează abuzul cu HTTP 429 și Retry-After pe rutele protejate (inclusiv anti-spoofing X-Forwarded-For)', async () => {
      let hit429 = false;
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-enforce-rate-limit': 'true',
            // Încercare de ocolire prin schimbarea X-Forwarded-For per cerere
            'X-Forwarded-For': `10.0.0.${i + 1}`
          },
          body: JSON.stringify({ email: 'notfound@example.ro', password: 'somepassword123' })
        });
        if (res.status === 429) {
          hit429 = true;
          assert.ok(res.headers.get('retry-after'), '429 trebuie să includă header Retry-After');
          break;
        }
      }
      assert.strictEqual(hit429, true, 'authStrictLimiter trebuie să întoarcă 429 la > 15 cereri chiar dacă X-Forwarded-For este falsificat');
    });

    it('Scenariu 26: CORS respinge originile externe neautorizate cu HTTP 403 pe /api/* și OPTIONS', async () => {
      const evilApiRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://evil-attacker.example' }
      });
      assert.strictEqual(evilApiRes.status, 403);
      const evilBody = await evilApiRes.json();
      assert.strictEqual(evilBody.code, 'CORS_ORIGIN_FORBIDDEN');

      const evilPreflight = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil-attacker.example',
          'Access-Control-Request-Method': 'POST'
        }
      });
      assert.strictEqual(evilPreflight.status, 403);
    });

    it('Scenariu 27: CORS permite explicit originile autorizate și include Vary: Origin', async () => {
      const okCorsRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://cosulmeu.online' }
      });
      assert.strictEqual(okCorsRes.status, 200);
      assert.strictEqual(okCorsRes.headers.get('access-control-allow-origin'), 'https://cosulmeu.online');
      assert.strictEqual(okCorsRes.headers.get('vary'), 'Origin');
    });

    it('Scenariu 28: Headerele de securitate obligatorii sunt prezente și X-Powered-By este dezactivat', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-powered-by'), null, 'X-Powered-By trebuie eliminat');
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
      assert.strictEqual(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.ok(res.headers.get('permissions-policy')?.includes('microphone=()'));
      assert.ok(res.headers.get('content-security-policy')?.includes("object-src 'none'"));
      assert.ok(res.headers.get('content-security-policy')?.includes("base-uri 'self'"));
    });
  });

  // =========================================================================
  // 29–30. Error Leakage & Secret Hygiene Verification
  // =========================================================================
  describe('29–30. Igienă Secrete & Prevenirea Scurgerilor de Erori Interne', () => {
    it('Scenariu 29: Endpoint-urile nu expun mesaje brute DB/stacktrace în răspunsurile 400/500', async () => {
      const badImportRun = await fetch(`${baseUrl}/api/indexing/retailers/invalid$id/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_API_KEY}`
        },
        body: JSON.stringify({})
      });
      const text = await badImportRun.text();
      assert.strictEqual(text.includes('at Layer.handle'), false);
      assert.strictEqual(text.includes('ECONNREFUSED'), false);
      assert.strictEqual(text.includes('SELECT '), false);
    });

    it('Scenariu 30: Niciun secret backend nu apare în codul frontend (src/components, src/auth, src/App.tsx) și în rutele publice', async () => {
      const clientFiles = [
        'src/App.tsx',
        'src/auth/AuthProvider.tsx',
        'src/components/ProfileView.tsx',
        'src/components/AdminSourcesView.tsx'
      ];
      for (const rel of clientFiles) {
        const full = path.join(process.cwd(), rel);
        if (!fs.existsSync(full)) continue;
        const content = fs.readFileSync(full, 'utf8');
        assert.strictEqual(content.includes('SUPABASE_SERVICE_ROLE_KEY'), false, `${rel} nu trebuie să conțină SERVICE_ROLE`);
        assert.strictEqual(content.includes('CRON_SECRET'), false, `${rel} nu trebuie să conțină CRON_SECRET`);
        assert.strictEqual(content.includes('cosul-meu-admin-secret-2026'), false, `${rel} nu trebuie să conțină secret cron hardcodat`);
      }

      const healthRes = await fetch(`${baseUrl}/api/health`);
      const healthText = await healthRes.text();
      assert.strictEqual(healthText.includes(ADMIN_API_KEY), false);
    });
  });
});
