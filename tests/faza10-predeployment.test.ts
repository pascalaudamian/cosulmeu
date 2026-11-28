import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { StorageService } from '../src/services/StorageService.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import { PRODUCTS } from '../src/data/mockData.ts';
import { LEGAL_ROUTES } from '../src/config/legalConfig.ts';
import type { PriceObservation } from '../src/types.ts';

describe('FAZA 10 – Pregătire Pre-Deployment V1 (Audit, Configurație, CSP, CI/CD & FAZA 0 Isolation)', () => {
  let server: http.Server;
  let baseUrl = '';
  let appRef: any;

  const canonicalProd = PRODUCTS.find(p => p.id === 'prod-lapte-1') || PRODUCTS[0];
  const aliasId1 = 'prod-f10-alias-1';
  const aliasId2 = 'prod-f10-alias-2';
  const orphanAliasId = 'prod-f10-orphan-alias';
  const cycleAliasA = 'prod-f10-cycle-a';
  const cycleAliasB = 'prod-f10-cycle-b';
  const todayIso = new Date().toISOString().split('T')[0];
  const isolatedOnlyObsId = 'obs-f10-isolated-only-1';

  before(async () => {
    StorageService.resetAllData();

    StorageService.addCustomProduct({
      ...canonicalProd,
      id: aliasId1,
      name: `${canonicalProd.name} F10 Alias 1`,
      barcode: undefined,
      canonicalProductId: canonicalProd.id
    });
    StorageService.addCustomProduct({
      ...canonicalProd,
      id: aliasId2,
      name: `${canonicalProd.name} F10 Alias 2`,
      barcode: undefined,
      canonicalProductId: aliasId1
    });
    StorageService.addCustomProduct({
      ...canonicalProd,
      id: orphanAliasId,
      name: 'Orphan Alias F10',
      barcode: undefined,
      canonicalProductId: 'missing-canonical-root-f10'
    });
    StorageService.addCustomProduct({
      ...canonicalProd,
      id: cycleAliasA,
      name: 'Cycle A F10',
      barcode: undefined,
      canonicalProductId: cycleAliasB
    });
    StorageService.addCustomProduct({
      ...canonicalProd,
      id: cycleAliasB,
      name: 'Cycle B F10',
      barcode: undefined,
      canonicalProductId: cycleAliasA
    });

    const obs1: PriceObservation = {
      id: isolatedOnlyObsId,
      productId: aliasId1,
      storeId: 'penny',
      price: 5.39,
      date: todayIso,
      source: 'official_feed'
    };
    const obs2: PriceObservation = {
      id: 'obs-f10-isolated-only-2',
      productId: aliasId2,
      storeId: 'auchan',
      price: 5.69,
      date: new Date(Date.now() - 3 * 86400 * 1000).toISOString().split('T')[0],
      source: 'official_feed'
    };
    StorageService.addPriceObservations([obs1, obs2]);

    const apiMod = await import('../api/index.ts');
    appRef = apiMod.default;
    server = http.createServer(appRef);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    process.env.COSUL_MEU_ISOLATED_TEST = '1';
    StorageService.resetAllData();
    IndexerScheduler.stop();
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('10.1 vercel.json: păstrează redirect/API și include fallback SPA fără a captura /api/* sau /assets/*', () => {
    const vercelCfg = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
    assert.equal(vercelCfg.buildCommand, 'bun run build');
    assert.equal(vercelCfg.outputDirectory, 'dist');

    // Redirect existent păstrat
    assert.ok(
      Array.isArray(vercelCfg.redirects) &&
        vercelCfg.redirects.some(
          (r: any) =>
            r.destination === 'https://cosulmeu.online/:path*' &&
            r.permanent === true
        )
    );

    // Rewrite API + SPA fallback
    const rewrites = vercelCfg.rewrites || [];
    assert.ok(rewrites.some((r: any) => r.source === '/api/:path*' && r.destination === '/api'));
    const spaRewrite = rewrites.find((r: any) => r.destination === '/index.html');
    assert.ok(spaRewrite, 'Lipsește rewrite SPA fallback către /index.html în vercel.json');

    // Simulare matching regex Vercel pentru rutele SPA legale vs /api/*
    const spaRegex = new RegExp(`^${spaRewrite.source}$`);
    const frontendRoutes = ['/', ...LEGAL_ROUTES.map(r => r.path)];
    for (const route of frontendRoutes) {
      assert.equal(spaRegex.test(route), true, `Ruta SPA ${route} trebuie să fie capturată de fallback`);
    }

    assert.equal(spaRegex.test('/api'), false, '/api nu trebuie capturat de fallback SPA');
    assert.equal(spaRegex.test('/api/health'), false, '/api/health nu trebuie capturat de fallback SPA');
    assert.equal(spaRegex.test('/api/inexistent-endpoint'), false, 'Endpoint-ul API inexistent nu trebuie capturat de fallback SPA');
    assert.equal(spaRegex.test('/assets/index-abc.js'), false, '/assets/* nu trebuie capturat de fallback SPA');
  });

  it('10.1 Runtime ESM/Serverless: api/index.ts exportă app fără top-level await și /api/inexistent returnează JSON 404', async () => {
    assert.equal(typeof appRef, 'function');
    const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    assert.equal(/\bawait\s+import\(['"]vite['"]\)/.test(serverSrc.split('async function startStandaloneServer')[0]), false);
    assert.ok(serverSrc.includes('!process.env.VERCEL'), 'Scheduler/seed trebuie dezactivate în serverless Vercel');

    const res404 = await fetch(`${baseUrl}/api/ruta-inexistenta-test-10`);
    assert.equal(res404.status, 404);
    const json404 = await res404.json();
    assert.equal(json404.success, false);
    assert.ok(String(res404.headers.get('content-type') || '').includes('application/json'));
  });

  it('10.2 Variabile de mediu: vite.config.ts prioritizează VITE_SUPABASE_* și nu expune secrete server-side', async () => {
    const viteSrc = fs.readFileSync(path.resolve('vite.config.ts'), 'utf8');
    assert.ok(viteSrc.includes('VITE_SUPABASE_URL'));
    assert.ok(viteSrc.includes('VITE_SUPABASE_ANON_KEY'));
    assert.equal(viteSrc.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.equal(viteSrc.includes('ADMIN_API_KEY'), false);
    assert.equal(viteSrc.includes('GEMINI_API_KEY'), false);
    assert.equal(viteSrc.includes('CRON_SECRET'), false);

    // Testăm prioritatea VITE_SUPABASE_URL > NEXT_PUBLIC_cosulmeuSUPABASE_URL > SUPABASE_URL
    const prevViteUrl = process.env.VITE_SUPABASE_URL;
    const prevNextUrl = process.env.NEXT_PUBLIC_cosulmeuSUPABASE_URL;
    const prevSupaUrl = process.env.SUPABASE_URL;
    try {
      process.env.VITE_SUPABASE_URL = 'https://priority-vite.supabase.co';
      process.env.NEXT_PUBLIC_cosulmeuSUPABASE_URL = 'https://priority-next.supabase.co';
      process.env.SUPABASE_URL = 'https://priority-supa.supabase.co';
      const viteCfgMod = await import('../vite.config.ts');
      const resolved = viteCfgMod.default({ mode: 'production', command: 'build' } as any);
      assert.equal(
        resolved.define?.['import.meta.env.VITE_SUPABASE_URL'],
        JSON.stringify('https://priority-vite.supabase.co')
      );
    } finally {
      if (prevViteUrl === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prevViteUrl;
      if (prevNextUrl === undefined) delete process.env.NEXT_PUBLIC_cosulmeuSUPABASE_URL;
      else process.env.NEXT_PUBLIC_cosulmeuSUPABASE_URL = prevNextUrl;
      if (prevSupaUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevSupaUrl;
    }

    const envExample = fs.readFileSync(path.resolve('.env.example'), 'utf8');
    for (const key of [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
      'ADMIN_API_KEY',
      'CRON_SECRET',
      'ALLOWED_ORIGIN',
      'GEMINI_API_KEY',
      'NODE_ENV',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY'
    ]) {
      assert.ok(envExample.includes(key), `.env.example trebuie să documenteze ${key}`);
    }

    const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    assert.ok(serverSrc.includes('process.env.ALLOWED_ORIGIN'));
  });

  it('10.3 CSP & Headere securitate: hash SHA-256 exact pentru scriptul dark-mode + Google Fonts fără unsafe-inline în producție', async () => {
    const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(match && match[1], 'index.html trebuie să conțină scriptul inline dark-mode');
    const expectedHash = `'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`;

    const vercelCfg = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
    const allHeaders = (vercelCfg.headers?.[0]?.headers || []) as Array<{ key: string; value: string }>;
    const headerMap = new Map(allHeaders.map(h => [h.key, h.value]));

    for (const requiredHeader of [
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
      'X-Frame-Options',
      'Content-Security-Policy'
    ]) {
      assert.ok(headerMap.has(requiredHeader), `vercel.json trebuie să seteze header-ul ${requiredHeader}`);
    }

    const vercelCsp = headerMap.get('Content-Security-Policy') || '';
    assert.ok(vercelCsp.includes(expectedHash), `CSP Vercel trebuie să includă hash-ul ${expectedHash}`);
    assert.ok(vercelCsp.includes('https://fonts.googleapis.com'));
    assert.ok(vercelCsp.includes('https://fonts.gstatic.com'));
    const vercelScriptSrc = vercelCsp.match(/script-src\s+([^;]+)/)?.[1] || '';
    assert.equal(vercelScriptSrc.includes("'unsafe-inline'"), false, 'CSP producție Vercel nu trebuie să permită script-src unsafe-inline');

    const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    assert.ok(serverSrc.includes(expectedHash), `server.ts trebuie să includă hash-ul ${expectedHash}`);
    assert.ok(serverSrc.includes('https://fonts.googleapis.com'));
    assert.ok(serverSrc.includes('https://fonts.gstatic.com'));

    // Verificare live a headerelor HTTP din Express test server
    const resHealth = await fetch(`${baseUrl}/api/health`);
    assert.equal(resHealth.status, 200);
    assert.equal(resHealth.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(resHealth.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const expressCsp = resHealth.headers.get('content-security-policy') || '';
    assert.ok(expressCsp.includes('https://fonts.googleapis.com'));
    assert.ok(expressCsp.includes('https://fonts.gstatic.com'));
  });

  it('10.5 CI/CD & Package Manager: aliniere cu bun.lock (fără npm ci) și raportare separată live-PG', () => {
    assert.equal(fs.existsSync(path.resolve('bun.lock')), true);
    assert.equal(fs.existsSync(path.resolve('package-lock.json')), false);

    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    assert.ok(String(pkg.packageManager || '').startsWith('bun@'));
    assert.ok(pkg.scripts['test:node']);
    assert.ok(pkg.scripts['test:v1']);
    assert.ok(pkg.scripts['test:live-pg']);

    const ciYml = fs.readFileSync(path.resolve('.github/workflows/npm-publish-github-packages.yml'), 'utf8');
    assert.equal(ciYml.includes('npm ci'), false, 'Workflow-ul CI nu trebuie să mai apeleze npm ci');
    assert.ok(ciYml.includes('bun install --frozen-lockfile'));
    assert.ok(ciYml.includes('bun run lint'));
    assert.ok(ciYml.includes('bun run build'));
    assert.ok(ciYml.includes('bun run test'));
    assert.ok(ciYml.includes('test:live-pg'));
  });

  it('10.6 GET /api/catalog/history/:productId – modul izolat (produs existent, inexistent, alias valid, alias invalid)', async () => {
    process.env.COSUL_MEU_ISOLATED_TEST = '1';

    // 1. Produs existent
    const resExisting = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(canonicalProd.id)}?days=30`);
    assert.equal(resExisting.status, 200);
    const jsonExisting = await resExisting.json();
    assert.equal(jsonExisting.success, true);
    assert.equal(jsonExisting.productId, canonicalProd.id);
    assert.ok(jsonExisting.observations.some((o: any) => o.id === isolatedOnlyObsId));

    // 2. Alias canonic valid (multi-hop)
    const resValidAlias = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(aliasId2)}?days=30`);
    assert.equal(resValidAlias.status, 200);
    const jsonAlias = await resValidAlias.json();
    assert.equal(jsonAlias.success, true);
    assert.equal(jsonAlias.productId, canonicalProd.id);
    assert.equal(jsonAlias.requestedProductId, aliasId2);
    assert.ok(jsonAlias.observations.length >= 2);

    // 3. Produs inexistent -> 404
    const resMissing = await fetch(`${baseUrl}/api/catalog/history/prod-inexistent-faza10-xyz?days=30`);
    assert.equal(resMissing.status, 404);

    // 4. Alias invalid (orfan / ciclu / format invalid) -> 400
    const resOrphan = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(orphanAliasId)}?days=30`);
    assert.equal(resOrphan.status, 400);

    const resCycle = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(cycleAliasA)}?days=30`);
    assert.equal(resCycle.status, 400);

    const resBadChars = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent('bad<id>')}?days=30`);
    assert.equal(resBadChars.status, 400);
  });

  it('10.6 GET /api/catalog/history/:productId – modul Supabase (fără COSUL_MEU_ISOLATED_TEST, strict read-only)', async () => {
    const prevIsolated = process.env.COSUL_MEU_ISOLATED_TEST;
    delete process.env.COSUL_MEU_ISOLATED_TEST;
    try {
      const resMissing = await fetch(`${baseUrl}/api/catalog/history/prod-inexistent-faza10-xyz?days=30`);
      assert.equal(resMissing.status, 404);

      const resExisting = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(canonicalProd.id)}?days=30`);
      assert.equal(resExisting.status, 200);
      const jsonExisting = await resExisting.json();
      assert.equal(jsonExisting.success, true);
      assert.equal(jsonExisting.productId, canonicalProd.id);
      // Nu trebuie să conțină observațiile sintetice injectate exclusiv în StorageService izolat
      assert.equal(
        jsonExisting.observations.some((o: any) => o.id === isolatedOnlyObsId),
        false,
        'În modul Supabase nu trebuie returnate observațiile sintetice din StorageService izolat'
      );
    } finally {
      if (prevIsolated === undefined) delete process.env.COSUL_MEU_ISOLATED_TEST;
      else process.env.COSUL_MEU_ISOLATED_TEST = prevIsolated;
    }
  });
});
