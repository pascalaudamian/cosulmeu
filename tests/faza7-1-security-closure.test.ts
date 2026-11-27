// tests/faza7-1-security-closure.test.ts
// Suită de verificare FAZA 7.1 — Security Closure Audit & SQL Migration Validation
// Acoperă: trigger admin, promovare/revocare server-side, izolare RLS (static + opțional live PG),
// server service_role client, CORS_ALLOWED_ORIGINS și regresii auth/catalog.

import 'dotenv/config';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';

import type { Express } from 'express';
import { supabase as anonSupabase } from '../src/lib/supabase.ts';
import { getPool, getServerSupabaseClient } from '../src/db/index.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import { StorageService } from '../src/services/StorageService.ts';

const ALL_25_TARGET_TABLES = [
  'app_users',
  'app_sessions',
  'receipt_products',
  'stores',
  'products',
  'product_offers',
  'price_observations',
  'promotions',
  'data_sources',
  'product_match_candidates',
  'source_sync_runs',
  'retailer_collectors',
  'indexing_locks',
  'retailer_products',
  'product_matches',
  'indexing_jobs',
  'indexing_runs',
  'quality_anomalies',
  'quality_recollection_queue',
  'daily_quality_reports',
  'catalog_sources',
  'catalog_documents',
  'catalog_import_runs',
  'catalog_extracted_offers',
  'catalog_import_errors'
] as const;

const APPROVED_PUBLIC_SELECT_TABLES = ['stores', 'products', 'product_offers'] as const;

const NON_PUBLIC_ISOLATED_TABLES = ALL_25_TARGET_TABLES.filter(
  (t) => !(APPROVED_PUBLIC_SELECT_TABLES as readonly string[]).includes(t)
);

interface MockUserRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  password_hash: string;
  is_active: boolean;
}

interface MockProfileRow {
  id: string;
  role: string;
  updated_at: string;
}

function createInMemoryAuthPool() {
  const users = new Map<string, MockUserRow>();
  const sessions = new Map<string, { token_hash: string; user_id: string; expires_at: Date }>();
  const profiles = new Map<string, MockProfileRow>();
  const queries: Array<{ sql: string; params: any[] }> = [];

  const mockPool: any = {
    async query(sql: string, params: any[] = []) {
      queries.push({ sql, params });
      const norm = sql.replace(/\s+/g, ' ').trim();

      if (norm.startsWith('INSERT INTO app_users')) {
        const [email, displayName, passwordHash] = params;
        for (const existing of users.values()) {
          if (existing.email === email) {
            const err: any = new Error('duplicate key');
            err.code = '23505';
            throw err;
          }
        }
        const id = '11111111-1111-4111-8111-111111111111';
        const row: MockUserRow = {
          id,
          email,
          display_name: displayName,
          role: 'user',
          password_hash: passwordHash,
          is_active: true
        };
        users.set(id, row);
        profiles.set(id, { id, role: 'user', updated_at: new Date().toISOString() });
        return { rows: [{ id: row.id, email: row.email, display_name: row.display_name, role: row.role }] };
      }

      if (norm.startsWith('INSERT INTO app_sessions')) {
        const [tokenHash, userId, ttlSeconds] = params;
        sessions.set(tokenHash, {
          token_hash: tokenHash,
          user_id: userId,
          expires_at: new Date(Date.now() + Number(ttlSeconds || 3600) * 1000)
        });
        return { rows: [] };
      }

      if (norm.startsWith('SELECT id, email, display_name, role, password_hash FROM app_users')) {
        const [email] = params;
        const found = Array.from(users.values()).find((u) => u.email === email && u.is_active);
        return { rows: found ? [found] : [] };
      }

      if (norm.startsWith('SELECT u.id, u.email, u.display_name, u.role FROM app_sessions s JOIN app_users u')) {
        const [tokenHash] = params;
        const sess = sessions.get(tokenHash);
        if (!sess || sess.expires_at.getTime() <= Date.now()) {
          return { rows: [] };
        }
        const user = users.get(sess.user_id);
        if (!user || !user.is_active) return { rows: [] };
        return { rows: [{ id: user.id, email: user.email, display_name: user.display_name, role: user.role }] };
      }

      if (norm.startsWith('DELETE FROM app_sessions WHERE token_hash')) {
        const [tokenHash] = params;
        sessions.delete(tokenHash);
        return { rows: [] };
      }

      if (norm.startsWith('UPDATE public.profiles SET role = $1')) {
        const [newRole, userId] = params;
        const profile = profiles.get(userId);
        if (!profile) return { rows: [] };
        profile.role = newRole;
        profile.updated_at = new Date().toISOString();
        return { rows: [{ ...profile }] };
      }

      if (norm.startsWith('UPDATE app_users SET role = $1')) {
        const [newRole, userId] = params;
        const user = users.get(userId);
        if (user) {
          user.role = newRole;
        }
        return { rows: [] };
      }

      return { rows: [] };
    },
    async end() {
      return undefined;
    }
  };

  return { mockPool, users, sessions, profiles, queries };
}

describe('FAZA 7.1 — Security Closure Audit & SQL Migration Validation', () => {
  let app: Express;
  let ADMIN_API_KEY: string;
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://staging-audit.cosulmeu.online';
    const serverMod = await import('../server.ts');
    app = serverMod.app;
    ADMIN_API_KEY = serverMod.ADMIN_API_KEY;
    StorageService.resetAllData();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    IndexerScheduler.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.CORS_ALLOWED_ORIGINS;
    const pool = getPool();
    if (pool) {
      await pool.end().catch(() => {});
    }
    (global as any)._postgresPool = undefined;
  });

  // =========================================================================
  // 1. Admin Trigger, Signup & Self-Role Tamper Protection
  // =========================================================================
  describe('1. Trigger Admin, Signup Escalation & Protecție Modificare Rol', () => {
    let origDbUrl: string | undefined;
    let origPool: any;

    beforeEach(() => {
      origDbUrl = process.env.DATABASE_URL;
      origPool = (global as any)._postgresPool;
    });

    afterEach(() => {
      if (origDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = origDbUrl;
      }
      (global as any)._postgresPool = origPool;
    });

    it('Signup ignoră is_admin=true, role=admin și raw_user_meta_data și atribuie strict role="user"', async () => {
      const mem = createInMemoryAuthPool();
      process.env.DATABASE_URL = 'postgres://mock:mock@127.0.0.1:5432/cosulmeu_test';
      (global as any)._postgresPool = mem.mockPool;

      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'attacker@example.ro',
          password: 'StrongTestPassword2026!',
          displayName: 'Test User',
          role: 'admin',
          is_admin: true,
          raw_user_meta_data: { is_admin: true, role: 'admin' }
        })
      });

      assert.strictEqual(regRes.status, 201);
      const regBody = await regRes.json();
      assert.strictEqual(regBody.user.role, 'user', 'Contul nou creat trebuie să aibă strict role="user"');

      const insertQuery = mem.queries.find((q) => q.sql.includes('INSERT INTO app_users'));
      assert.ok(insertQuery);
      const insertHead = insertQuery.sql.split('RETURNING')[0];
      assert.strictEqual(insertHead.includes('role'), false, 'INSERT app_users nu acceptă coloana role din payload');
      assert.strictEqual(insertHead.includes('is_admin'), false, 'INSERT app_users nu acceptă is_admin din payload');
      assert.strictEqual(insertQuery.params.length, 3);
      assert.strictEqual(mem.users.get(regBody.user.id)?.role, 'user');
    });

    it('Încercarea unui utilizator de a-și modifica propriul rol prin PATCH /api/gdpr/profile este ignorată complet', async () => {
      const origGetUser = anonSupabase.auth.getUser.bind(anonSupabase.auth);
      const origFetch = globalThis.fetch;
      const capturedPatches: Array<Record<string, unknown>> = [];

      try {
        (anonSupabase.auth as any).getUser = async () => ({
          data: { user: { id: '22222222-2222-4222-8222-222222222222', email: 'normal@example.ro' } },
          error: null
        });

        globalThis.fetch = (async (input: any, init?: RequestInit) => {
          const urlStr = typeof input === 'string' ? input : input?.url || '';
          if (urlStr.includes('.supabase.co/rest/v1/')) {
            if (urlStr.includes('/rest/v1/profiles') && (init?.method || 'GET').toUpperCase() === 'PATCH') {
              const rawBody = typeof init?.body === 'string' ? init.body : '';
              if (rawBody) capturedPatches.push(JSON.parse(rawBody));
            }
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return origFetch(input, init);
        }) as typeof fetch;

        const patchRes = await fetch(`${baseUrl}/api/gdpr/profile`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer mock-jwt-token'
          },
          body: JSON.stringify({
            displayName: 'Popescu Ion',
            role: 'admin',
            is_admin: true
          })
        });

        assert.strictEqual(patchRes.status, 200);
        assert.strictEqual(capturedPatches.length, 1);
        assert.strictEqual('role' in capturedPatches[0], false, 'role nu poate ajunge în update-ul pe profiles');
        assert.strictEqual('is_admin' in capturedPatches[0], false, 'is_admin nu poate ajunge în update-ul pe profiles');
        assert.strictEqual(capturedPatches[0].display_name, 'Popescu Ion');
      } finally {
        (anonSupabase.auth as any).getUser = origGetUser;
        globalThis.fetch = origFetch;
      }
    });

    it('Promovarea și revocarea admin prin PATCH /api/admin/users/:userId/role funcționează exclusiv autorizat și auditat', async () => {
      const targetUserId = '11111111-1111-4111-8111-111111111111';

      // 1. Fără autorizare / cu token fals -> 401 / 403
      const noAuth = await fetch(`${baseUrl}/api/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' })
      });
      assert.strictEqual(noAuth.status, 401);

      const badAuth = await fetch(`${baseUrl}/api/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer forged-admin-token'
        },
        body: JSON.stringify({ role: 'admin' })
      });
      assert.strictEqual(badAuth.status, 403);

      // 2. Validare UUID și rol permis -> 400
      const badUuid = await fetch(`${baseUrl}/api/admin/users/not-a-uuid/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_API_KEY}`
        },
        body: JSON.stringify({ role: 'admin' })
      });
      assert.strictEqual(badUuid.status, 400);

      const badRole = await fetch(`${baseUrl}/api/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_API_KEY}`
        },
        body: JSON.stringify({ role: 'superadmin' })
      });
      assert.strictEqual(badRole.status, 400);

      // 3. Fără service_role și fără pool -> 503 fail-closed
      delete process.env.DATABASE_URL;
      (global as any)._postgresPool = undefined;
      const noDbRes = await fetch(`${baseUrl}/api/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_API_KEY}`
        },
        body: JSON.stringify({ role: 'admin' })
      });
      assert.strictEqual(noDbRes.status, 503);

      // 4. Cu DB / mockPool configurat: promovare -> admin, apoi revocare -> user
      const mem = createInMemoryAuthPool();
      process.env.DATABASE_URL = 'postgres://mock:mock@127.0.0.1:5432/cosulmeu_test';
      (global as any)._postgresPool = mem.mockPool;
      mem.users.set(targetUserId, {
        id: targetUserId,
        email: 'operator@cosulmeu.online',
        display_name: 'Operator',
        role: 'user',
        password_hash: 'hash',
        is_active: true
      });
      mem.profiles.set(targetUserId, {
        id: targetUserId,
        role: 'user',
        updated_at: new Date().toISOString()
      });

      const promoteRes = await fetch(`${baseUrl}/api/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_API_KEY}`
        },
        body: JSON.stringify({ role: 'admin', reason: 'Promovare operator autorizat' })
      });
      assert.strictEqual(promoteRes.status, 200);
      const promoteBody = await promoteRes.json();
      assert.strictEqual(promoteBody.success, true);
      assert.strictEqual(promoteBody.profile.role, 'admin');
      assert.strictEqual(mem.profiles.get(targetUserId)?.role, 'admin');
      assert.strictEqual(mem.users.get(targetUserId)?.role, 'admin');

      const revokeRes = await fetch(`${baseUrl}/api/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_API_KEY}`
        },
        body: JSON.stringify({ role: 'user', reason: 'Revocare acces administrativ' })
      });
      assert.strictEqual(revokeRes.status, 200);
      const revokeBody = await revokeRes.json();
      assert.strictEqual(revokeBody.success, true);
      assert.strictEqual(revokeBody.profile.role, 'user');
      assert.strictEqual(mem.profiles.get(targetUserId)?.role, 'user');
      assert.strictEqual(mem.users.get(targetUserId)?.role, 'user');

      const auditQueries = mem.queries.filter((q) => q.sql.includes('INSERT INTO admin_audit_logs'));
      assert.ok(auditQueries.some((q) => q.params.includes('admin_role_promoted')));
      assert.ok(auditQueries.some((q) => q.params.includes('admin_role_revoked')));
    });

    it('user-profiles-migration.js este întărit complet (BEFORE INSERT OR UPDATE, search_path=public, fără email hardcodat sau is_admin)', () => {
      const migSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/db/migrations/user-profiles-migration.js'),
        'utf8'
      );

      assert.strictEqual(migSrc.includes('pascalau.stefan@gmail.com'), false);
      assert.strictEqual(migSrc.includes('is_admin'), false);
      assert.ok(migSrc.includes('BEFORE INSERT OR UPDATE ON public.profiles'));
      assert.ok(migSrc.includes('SET search_path = public'));
      assert.ok(migSrc.includes("COALESCE(role, 'user') = 'user'"));
      assert.ok(migSrc.includes('role = profiles.role'));
    });
  });

  // =========================================================================
  // 2. Audit Static & Invariante Migrare SQL PROPOSED_016 (RLS 25 Tabele)
  // =========================================================================
  describe('2. Audit SQL PROPOSED_016_faza7_1_security_closure.sql (RLS & Trigger Invariante)', () => {
    const migrationSql = fs.readFileSync(
      path.join(process.cwd(), 'src/db/migrations/PROPOSED_016_faza7_1_security_closure.sql'),
      'utf8'
    );

    it('Trigger-ele handle_new_user_profile() și protect_profile_role() au SECURITY DEFINER, SET search_path = public și elimină escaladarea', () => {
      assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION public.protect_profile_role()'));
      assert.ok(migrationSql.includes('BEFORE INSERT OR UPDATE ON public.profiles'));
      assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION public.handle_new_user_profile()'));
      assert.ok(migrationSql.includes('SET search_path = public'));
      assert.ok(migrationSql.includes("initial_role VARCHAR(16) := 'user'"));
      assert.ok(migrationSql.includes('role = profiles.role'));
      assert.ok(migrationSql.includes("COALESCE(role, 'user') = 'user'"));
      assert.strictEqual(migrationSql.includes('pascalau.stefan@gmail.com'), false);
      assert.strictEqual(
        /raw_user_meta_data.*is_admin/i.test(migrationSql),
        false,
        'handle_new_user_profile nu are voie să citească is_admin din raw_user_meta_data'
      );
    });

    it('Acoperă toate cele 25 de tabele țintă, activează RLS și păstrează service_role', () => {
      for (const tbl of ALL_25_TARGET_TABLES) {
        assert.ok(
          migrationSql.includes(`'${tbl}'`) || migrationSql.includes(`public.${tbl}`),
          `Tabela ${tbl} trebuie inclusă explicit în PROPOSED_016`
        );
      }
      assert.ok(migrationSql.includes('ALTER VIEW public.retailers SET (security_invoker = true)'));
      assert.ok(migrationSql.includes('FOR ALL TO service_role USING (true) WITH CHECK (true)'));
    });

    it('Blochează complet anon și authenticated pe app_users, app_sessions, receipt_products și pe toate cele 19 tabele nepublice', () => {
      // Pas 3: app_users, app_sessions, receipt_products
      for (const authTbl of ['app_users', 'app_sessions', 'receipt_products']) {
        assert.ok(migrationSql.includes(`'${authTbl}'`));
      }
      assert.ok(migrationSql.includes("REVOKE ALL ON TABLE public.%I FROM anon, authenticated"));

      // Pas 5: price_observations, promotions și cele 17 tabele operaționale/staging
      for (const privTbl of NON_PUBLIC_ISOLATED_TABLES) {
        assert.ok(
          migrationSql.includes(`'${privTbl}'`),
          `Tabela operațională/privată ${privTbl} trebuie izolată strict în PROPOSED_016`
        );
        // Nu trebuie să existe nicio politică FOR SELECT/INSERT/UPDATE/DELETE spre anon sau authenticated pe tabelele izolate
        const publicSelectRegex = new RegExp(`CREATE POLICY\\s+${privTbl}_public_read`, 'i');
        assert.strictEqual(
          publicSelectRegex.test(migrationSql),
          false,
          `Tabela ${privTbl} nu trebuie să aibă politică public_read`
        );
      }
    });

    it('Permite SELECT public exclusiv pe stores, products, product_offers (verificate) și revocă scrierile anon/authenticated', () => {
      assert.ok(migrationSql.includes('CREATE POLICY stores_public_read ON public.stores'));
      assert.ok(migrationSql.includes('FOR SELECT TO anon, authenticated USING (true)'));
      assert.ok(migrationSql.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.stores FROM anon, authenticated'));

      assert.ok(migrationSql.includes('CREATE POLICY products_public_read ON public.products'));
      assert.ok(migrationSql.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.products FROM anon, authenticated'));

      assert.ok(migrationSql.includes('CREATE POLICY product_offers_public_read ON public.product_offers'));
      assert.ok(migrationSql.includes("USING (verification_status = 'verified' AND is_flagged_anomaly = false)"));
      assert.ok(
        migrationSql.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.product_offers FROM anon, authenticated')
      );
    });

    it('Include verificări pre-migrare, post-migrare și rollback sigur (fără dezactivare RLS și fără scrieri publice)', () => {
      assert.ok(migrationSql.includes('[PRE-CHECK]'));
      assert.ok(migrationSql.includes('[POST-CHECK]'));
      assert.strictEqual(migrationSql.includes('DISABLE ROW LEVEL SECURITY'), false);
      assert.ok(migrationSql.includes('ROLLBACK SIGUR'));
    });

    it('Verificare LIVE PostgreSQL (opțională — executată doar dacă DATABASE_URL/SUPABASE_DB_URL există)', async (t) => {
      const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
      if (!connStr) {
        t.skip('[SKIP LIVE PG] Nu există SUPABASE_DB_URL/DATABASE_URL configurat local; verificarea RLS live în Supabase rămâne obligatorie manual.');
        return;
      }

      const pgMod = await import('pg');
      const client = new pgMod.default.Client({
        connectionString: connStr,
        ssl: connStr.includes('localhost') || connStr.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
      });
      await client.connect();
      try {
        const res = await client.query(`
          SELECT c.relname, c.relrowsecurity
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND c.relname = ANY($1)
        `, [Array.from(ALL_25_TARGET_TABLES)]);

        for (const row of res.rows) {
          assert.strictEqual(
            row.relrowsecurity,
            true,
            `Tabela live ${row.relname} trebuie să aibă RLS activ`
          );
        }
      } finally {
        await client.end();
      }
    });
  });

  // =========================================================================
  // 3. Server Supabase Client (`service_role` vs `anon`) & CORS_ALLOWED_ORIGINS
  // =========================================================================
  describe('3. Izolare Service Role Backend & Configurare CORS_ALLOWED_ORIGINS', () => {
    let origServiceKey: string | undefined;

    beforeEach(() => {
      origServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    });

    afterEach(() => {
      if (origServiceKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceKey;
      }
    });

    it('getServerSupabaseClient() folosește anon fallback când lipsește SUPABASE_SERVICE_ROLE_KEY și creează client service_role când cheia este configurată', () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const fallbackClient = getServerSupabaseClient();
      assert.strictEqual(fallbackClient, anonSupabase);

      process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_service_role.signature';
      const adminClient = getServerSupabaseClient();
      assert.notStrictEqual(adminClient, anonSupabase, 'Serverul trebuie să folosească clientul service_role când cheia este setată');
    });

    it('PriceAuditService, PriceQualityMonitoringService și rutele admin din server.ts nu mai folosesc direct clientul anon', () => {
      const auditSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/PriceAuditService.ts'), 'utf8');
      const qualitySrc = fs.readFileSync(path.join(process.cwd(), 'src/services/PriceQualityMonitoringService.ts'), 'utf8');
      const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');

      assert.strictEqual(auditSrc.includes("from '../lib/supabase"), false);
      assert.ok(auditSrc.includes('getServerSupabaseClient'));

      assert.strictEqual(qualitySrc.includes("from '../lib/supabase"), false);
      assert.ok(qualitySrc.includes('getServerSupabaseClient'));

      assert.ok(serverSrc.includes('process.env.CORS_ALLOWED_ORIGINS'));
      assert.ok(serverSrc.includes("app.patch('/api/admin/users/:userId/role', requireAdminAuth"));
    });

    it('CORS_ALLOWED_ORIGINS permite originea configurată și respinge originile neautorizate cu 403', async () => {
      const allowedRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://staging-audit.cosulmeu.online' }
      });
      assert.strictEqual(allowedRes.status, 200);
      assert.strictEqual(
        allowedRes.headers.get('access-control-allow-origin'),
        'https://staging-audit.cosulmeu.online'
      );

      const deniedRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://untrusted-domain.example' }
      });
      assert.strictEqual(deniedRes.status, 403);
    });
  });

  // =========================================================================
  // 4. Regresii Auth Intern & Catalog Public
  // =========================================================================
  describe('4. Regresii Flux Auth Intern & Catalog Public', () => {
    let origDbUrl: string | undefined;
    let origPool: any;

    beforeEach(() => {
      origDbUrl = process.env.DATABASE_URL;
      origPool = (global as any)._postgresPool;
    });

    afterEach(() => {
      if (origDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = origDbUrl;
      }
      (global as any)._postgresPool = origPool;
    });

    it('Flux complet register -> me -> logout -> me(401) -> login funcționează corect cu rol user', async () => {
      const mem = createInMemoryAuthPool();
      process.env.DATABASE_URL = 'postgres://mock:mock@127.0.0.1:5432/cosulmeu_test';
      (global as any)._postgresPool = mem.mockPool;

      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'client.normal@example.ro',
          password: 'ValidUserPassword2026!',
          displayName: 'Client Normal'
        })
      });
      assert.strictEqual(regRes.status, 201);
      const cookieHeader = regRes.headers.get('set-cookie') || '';
      const cookiePair = cookieHeader.split(';')[0];
      assert.ok(cookiePair.startsWith('cosulmeu_session='));

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookiePair }
      });
      assert.strictEqual(meRes.status, 200);
      const meBody = await meRes.json();
      assert.strictEqual(meBody.user.email, 'client.normal@example.ro');
      assert.strictEqual(meBody.user.role, 'user');

      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookiePair }
      });
      assert.strictEqual(logoutRes.status, 200);

      const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookiePair }
      });
      assert.strictEqual(meAfterLogout.status, 401);

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'client.normal@example.ro',
          password: 'ValidUserPassword2026!'
        })
      });
      assert.strictEqual(loginRes.status, 200);
      const loginBody = await loginRes.json();
      assert.strictEqual(loginBody.user.role, 'user');
    });

    it('Rutele publice ale catalogului (/api/stores, /api/products, /api/catalog/compare) funcționează în continuare fără erori', async () => {
      const storesRes = await fetch(`${baseUrl}/api/stores`);
      assert.strictEqual(storesRes.status, 200);
      const storesData = await storesRes.json();
      assert.ok(Array.isArray(storesData) || Array.isArray(storesData.stores));

      const productsRes = await fetch(`${baseUrl}/api/products?limit=5`);
      assert.strictEqual(productsRes.status, 200);

      const compareRes = await fetch(`${baseUrl}/api/catalog/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: 'item-1', name: 'Lapte 1L', quantity: 1, unit: 'buc' }]
        })
      });
      assert.strictEqual(compareRes.status, 200);
    });
  });
});
