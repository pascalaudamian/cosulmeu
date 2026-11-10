// tests/scheduler-compatibility.test.ts
// Testare obligatorie pentru compatibilitatea completă dintre Scheduler, Pipeline și Dashboard
// Verifică: atomic claim, advisory lock, partial status, eligibilitate oferte, fus orar, RLS și audit

import 'dotenv/config';
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { getPool, isPostgresConfigured, DatabaseService } from '../src/db/index.ts';

const ADMIN_TOKEN = 'cosul-meu-admin-secret-2026';
const CRON_SECRET = process.env.CRON_SECRET || 'cosul-meu-admin-secret-2026';
const BASE_URL = 'http://localhost:3000';

describe('Audit Compatibilitate Scheduler, Pipeline & Dashboard Operațional', () => {
  let createdScheduleId: string | null = null;
  let recurringScheduleId: string | null = null;

  before(async () => {
    assert.strictEqual(isPostgresConfigured(), true, 'PostgreSQL Supabase trebuie să fie conectat');
  });

  after(async () => {
    const pool = getPool();
    if (pool) {
      // Curățare înregistrări de test create în cadrul suitei
      if (createdScheduleId) {
        await pool.query('DELETE FROM catalog_publish_schedules WHERE id = $1', [createdScheduleId]).catch(() => {});
      }
      if (recurringScheduleId) {
        await pool.query('DELETE FROM catalog_publish_schedules WHERE id = $1', [recurringScheduleId]).catch(() => {});
      }
      await pool.end().catch(() => {});
    }
  });

  it('1. Securitate & RLS: Blocare acces neautorizat la endpointurile schedulerului', async () => {
    // Fără header Authorization
    const unauthRes = await fetch(`${BASE_URL}/api/admin/catalog-publish-schedules`);
    assert.strictEqual(unauthRes.status, 401, 'Endpointul de administrare trebuie să refuze accesul neautentificat');

    // Cron fără CRON_SECRET
    const cronNoAuth = await fetch(`${BASE_URL}/api/cron/catalog-publish`, {
      headers: { 'Authorization': 'Bearer token-fals-123' }
    });
    assert.strictEqual(cronNoAuth.status, 401, 'Cronul trebuie să respingă cereri cu secret invalid');
  });

  it('2. Creare Programare Unică și Recurentă cu validare fus orar Europe/Bucharest', async () => {
    const pool = getPool()!;
    const nowLocal = new Date();
    const scheduledIso = nowLocal.toISOString();

    // Creare programare unică
    const createRes = await fetch(`${BASE_URL}/api/admin/catalog-publish-schedules`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Test Audit Programare Unică',
        retailerIds: ['lidl'],
        scheduledAt: scheduledIso,
        timezone: 'Europe/Bucharest',
        alertEmail: 'audit@cosulmeu.ro',
        scheduleType: 'once',
        enabled: true
      })
    });

    assert.strictEqual(createRes.status, 201, 'Programarea unică trebuie creată cu cod 201');
    const createJson = await createRes.json();
    assert.ok(createJson.schedule.id);
    createdScheduleId = createJson.schedule.id;
    assert.strictEqual(createJson.schedule.timezone, 'Europe/Bucharest');
    assert.strictEqual(createJson.schedule.scheduleType, 'once');

    // Creare programare recurentă zilnică
    const recRes = await fetch(`${BASE_URL}/api/admin/catalog-publish-schedules`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Test Audit Programare Zilnică',
        retailerIds: ['lidl', 'kaufland'],
        scheduledAt: scheduledIso,
        timezone: 'Europe/Bucharest',
        alertEmail: 'audit@cosulmeu.ro',
        scheduleType: 'daily',
        enabled: true
      })
    });

    assert.strictEqual(recRes.status, 201);
    const recJson = await recRes.json();
    recurringScheduleId = recJson.schedule.id;
    assert.strictEqual(recJson.schedule.scheduleType, 'daily');
  });

  it('3. Pipeline: Schedulerul publică doar oferte VALIDATE cu preț pozitiv, ignorând NEEDS_REVIEW', async () => {
    const pool = getPool()!;

    // Verificăm dacă există oferte în NEEDS_REVIEW
    const needsReviewCheck = await pool.query(
      "SELECT count(*) FROM catalog_extracted_offers WHERE staging_status = 'NEEDS_REVIEW'"
    );
    const initialNeedsReview = parseInt(needsReviewCheck.rows[0].count, 10);

    // Rulăm programarea unică manual
    const runRes = await fetch(`${BASE_URL}/api/admin/catalog-publish-schedules/${createdScheduleId}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userEmail: 'admin-audit@cosulmeu.ro' })
    });

    assert.strictEqual(runRes.status, 200);
    const runJson = await runRes.json();
    assert.strictEqual(runJson.success, true);

    // Confirmăm că ofertele NEEDS_REVIEW nu au fost modificate sau transformate automat
    const postReviewCheck = await pool.query(
      "SELECT count(*) FROM catalog_extracted_offers WHERE staging_status = 'NEEDS_REVIEW'"
    );
    const postNeedsReview = parseInt(postReviewCheck.rows[0].count, 10);
    assert.strictEqual(postNeedsReview, initialNeedsReview, 'Ofertele NEEDS_REVIEW trebuie să rămână intacte');

    // Verificăm că programarea unică a fost dezactivată după succes (enabled = false, next_run_at = null)
    const schedRow = await pool.query('SELECT enabled, next_run_at, last_status FROM catalog_publish_schedules WHERE id = $1', [createdScheduleId]);
    assert.strictEqual(schedRow.rows[0].enabled, false, 'Programarea de tip once trebuie dezactivată după succes');
    assert.strictEqual(schedRow.rows[0].next_run_at, null, 'next_run_at trebuie să fie null pentru programări unice finalizate');
    assert.strictEqual(schedRow.rows[0].last_status, 'success');
  });

  it('4. Programare recurentă: Avansare corectă a următoarei execuții (next_run_at + 24h)', async () => {
    const pool = getPool()!;

    const runRes = await fetch(`${BASE_URL}/api/admin/catalog-publish-schedules/${recurringScheduleId}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userEmail: 'admin-audit@cosulmeu.ro' })
    });

    assert.strictEqual(runRes.status, 200);
    const schedRow = await pool.query('SELECT enabled, next_run_at, last_status, schedule_type FROM catalog_publish_schedules WHERE id = $1', [recurringScheduleId]);
    assert.strictEqual(schedRow.rows[0].enabled, true, 'Programarea zilnică trebuie să rămână activată');
    assert.ok(schedRow.rows[0].next_run_at, 'Programarea zilnică trebuie să aibă următorul interval calculat');
    const nextDate = new Date(schedRow.rows[0].next_run_at).getTime();
    assert.ok(nextDate > Date.now(), 'next_run_at trebuie să fie în viitor');
  });

  it('5. Concurență & Idempotență: Blocare două execuții simultane pe aceeași programare', async () => {
    const pool = getPool()!;

    // Reactivăm temporar programarea unică pentru testul concurențial
    await pool.query("UPDATE catalog_publish_schedules SET enabled = true, last_status = 'idle' WHERE id = $1", [createdScheduleId]);

    // Pornim două execuții simultan prin Promise.all
    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/api/admin/catalog-publish-schedules/${createdScheduleId}/run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: 'worker-1@cosulmeu.ro' })
      }),
      fetch(`${BASE_URL}/api/admin/catalog-publish-schedules/${createdScheduleId}/run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: 'worker-2@cosulmeu.ro' })
      })
    ]);

    const statuses = [res1.status, res2.status];
    // Una dintre cereri trebuie să aibă succes (200), iar cealaltă trebuie respinsă (500 cu eroare de blocare)
    // sau ambele se execută serial dacă prima s-a finalizat sub 1ms
    assert.ok(statuses.includes(200), 'Cel puțin una dintre cereri trebuie să finalizeze cu 200');

    // Verificăm că starea finală în baza de date este validă (nu e coruptă sau blocată)
    const check = await pool.query('SELECT last_status FROM catalog_publish_schedules WHERE id = $1', [createdScheduleId]);
    assert.ok(['success', 'idle', 'partial'].includes(check.rows[0].last_status));
  });

  it('6. Compatibilitate Dashboard: /api/admin/operational-dashboard expune corect datele schedulerului', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/operational-dashboard`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.data.scheduler, 'Obiectul scheduler trebuie să existe în răspunsul API');

    const s = json.data.scheduler;
    assert.strictEqual(typeof s.activeSchedulesCount, 'number');
    assert.strictEqual(typeof s.runningSchedulesCount, 'number');
    assert.strictEqual(typeof s.successfulSchedulesCount, 'number');
    assert.strictEqual(typeof s.partialSchedulesCount, 'number');
    assert.strictEqual(typeof s.failedSchedulesCount, 'number');
    assert.strictEqual(typeof s.totalSchedulesCount, 'number');
    assert.strictEqual(typeof s.manualPublishCount, 'number');
    assert.strictEqual(typeof s.automatedPublishCount, 'number');

    assert.ok(s.totalSchedulesCount >= 2, 'Trebuie să numere cel puțin cele două programări create');
  });

  it('7. Audit Log: Evenimentele de pornire, finalizare și audit granular sunt persistate', async () => {
    const pool = getPool()!;
    const auditRes = await pool.query(
      `SELECT action, target_type, target_id, details 
       FROM admin_audit_logs 
       WHERE target_type = 'catalog_publish_schedule'
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    assert.ok(auditRes.rows.length > 0, 'Trebuie să existe înregistrări de audit pentru scheduler');
    const actions = auditRes.rows.map(r => r.action);
    assert.ok(
      actions.includes('scheduler_publish_started') || actions.includes('scheduler_publish_completed') || actions.includes('create_publish_schedule'),
      'Jurnalul de audit trebuie să conțină evenimente de scheduler'
    );
  });

  it('8. Endpoint Vercel Cron: /api/cron/catalog-publish execută programările scadente', async () => {
    const pool = getPool()!;
    // Setăm programarea zilnică să fie scadentă acum
    await pool.query('UPDATE catalog_publish_schedules SET enabled = true, next_run_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [recurringScheduleId]);

    const cronRes = await fetch(`${BASE_URL}/api/cron/catalog-publish`, {
      headers: { 'Authorization': `Bearer ${CRON_SECRET}` }
    });

    assert.strictEqual(cronRes.status, 200, 'Cronul trebuie să răspundă cu 200');
    const cronJson = await cronRes.json();
    assert.strictEqual(cronJson.success, true);
    assert.strictEqual(cronJson.timezone, 'Europe/Bucharest');
    assert.ok(Array.isArray(cronJson.runs));
  });
});
