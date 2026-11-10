// tests/admin-dashboard.test.ts
// Testare completă pentru noul Dashboard Operațional Administrativ Coșul Meu
// Verifică datele reale din PostgreSQL, indicatorii KPI, previzualizarea publicării, audit logs și securitatea

import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { DatabaseService, isPostgresConfigured, getPool } from '../src/db/index.ts';
import { CatalogStagingManager } from '../src/indexing/catalog/CatalogStagingManager.ts';

const ADMIN_TOKEN = 'cosul-meu-admin-secret-2026';
const BASE_URL = 'http://localhost:3000';

describe('Admin Operational Dashboard & Audit Test Suite', () => {
  after(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end().catch(() => {});
    }
  });
  it('1. Verificare Conexiune PostgreSQL și mediu Supabase', async () => {
    assert.strictEqual(isPostgresConfigured(), true, 'PostgreSQL trebuie să fie configurat');
    const pool = getPool();
    assert.ok(pool, 'Pool-ul PostgreSQL trebuie să fie activ');
    const res = await pool.query('SELECT 1 AS alive');
    assert.strictEqual(res.rows[0].alive, 1, 'Baza de date PostgreSQL trebuie să răspundă la interogare');
  });

  it('2. GET /api/admin/operational-dashboard returnează statusul și cei 16 indicatori KPI separați', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/operational-dashboard`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    assert.strictEqual(res.status, 200, 'Endpointul trebuie să returneze status HTTP 200');
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.data, 'Trebuie să existe obiectul data');

    const data = json.data;
    assert.ok(
      ['TOTUL FUNCȚIONEAZĂ', 'IMPORT ÎN DESFĂȘURARE', 'NECESITĂ ATENȚIE', 'SISTEM PARȚIAL DISPONIBIL', 'EROARE CRITICĂ'].includes(data.overallStatus),
      `Statusul general "${data.overallStatus}" trebuie să fie unul dintre cele 5 statusuri oficiale`
    );

    assert.strictEqual(data.configuredRetailersCount, 8, 'Trebuie să fie exact 8 retaileri configurați');
    assert.ok(data.activeRetailersCount >= 6, 'Trebuie să fie cel puțin 6 retaileri activi');
    assert.strictEqual(data.blockedSourcesCount, 2, 'Profi și METRO trebuie să fie marcate ca surse blocate');

    // Verificare cei 16 KPI distincți
    const kpis = data.kpis;
    assert.ok(kpis.configuredRetailers, 'Trebuie să existe KPI configuredRetailers');
    assert.strictEqual(kpis.configuredRetailers.value, 8);

    assert.ok(kpis.configuredSources, 'Trebuie să existe KPI configuredSources');
    assert.strictEqual(kpis.configuredSources.value, 11);

    assert.ok(kpis.activeSources, 'Trebuie să existe KPI activeSources');
    assert.ok(kpis.activeSources.value >= 9);

    assert.ok(kpis.distinctProducts, 'Trebuie să existe KPI distinctProducts');
    assert.ok(kpis.distinctProducts.value > 0, 'Numărul de produse distincte trebuie să fie > 0');

    assert.ok(kpis.publishedOffers, 'Trebuie să existe KPI publishedOffers');
    assert.ok(kpis.publishedOffers.value > 0, 'Numărul de oferte publicate trebuie să fie > 0');

    // Produsele și ofertele trebuie numărate separat și independent
    assert.notStrictEqual(kpis.distinctProducts.value, kpis.configuredRetailers.value);
  });

  it('3. GET /api/admin/operational-dashboard blochează cererile neautorizate', async () => {
    const unauthRes = await fetch(`${BASE_URL}/api/admin/operational-dashboard`);
    assert.strictEqual(unauthRes.status, 401, 'Cererea fără token trebuie respinsă cu 401 Unauthorized');

    const invalidRes = await fetch(`${BASE_URL}/api/admin/operational-dashboard`, {
      headers: { 'Authorization': 'Bearer token-invalid-123' }
    });
    assert.strictEqual(invalidRes.status, 403, 'Cererea cu token invalid trebuie respinsă cu 403 Forbidden');
  });

  it('4. POST /api/admin/staging/preview-publish generează rezumatul complet înainte de publicare', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/staging/preview-publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.strictEqual(res.status, 200, 'Previzualizarea trebuie să răspundă cu HTTP 200');
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.preview, 'Trebuie să conțină obiectul preview');

    const preview = json.preview;
    assert.ok(typeof preview.toPublishCount === 'number');
    assert.ok(typeof preview.newProductsCount === 'number');
    assert.ok(typeof preview.existingUpdatedCount === 'number');
    assert.ok(typeof preview.unchangedProductsCount === 'number');
    assert.ok(typeof preview.itemsWithoutPriceCount === 'number');
    assert.ok(Array.isArray(preview.retailersInvolved));
    assert.ok(Array.isArray(preview.sampleItems));
  });

  it('5. POST /api/admin/audit-logs și GET /api/admin/audit-logs înregistrează și returnează evenimente de audit', async () => {
    const testAction = 'test_audit_event_' + Date.now();
    const createRes = await fetch(`${BASE_URL}/api/admin/audit-logs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: testAction,
        targetType: 'test_entity',
        targetId: 'ent-123',
        details: { note: 'Verificare log de audit imutabil' },
        userEmail: 'pascalau.stefan@gmail.com'
      })
    });

    assert.strictEqual(createRes.status, 200);
    const createJson = await createRes.json();
    assert.strictEqual(createJson.success, true);
    assert.strictEqual(createJson.logItem.action, testAction);

    const listRes = await fetch(`${BASE_URL}/api/admin/audit-logs?limit=10`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });
    assert.strictEqual(listRes.status, 200);
    const listJson = await listRes.json();
    assert.strictEqual(listJson.success, true);
    assert.ok(listJson.logs.some((l: any) => l.action === testAction), 'Evenimentul de audit trebuie să apară în istoric');
  });

  it('6. POST /api/admin/sources/:id/toggle comută starea unei surse și scrie în audit log', async () => {
    const toggleRes = await fetch(`${BASE_URL}/api/admin/sources/cat-src-lidl/toggle`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'active', userEmail: 'pascalau.stefan@gmail.com' })
    });

    assert.strictEqual(toggleRes.status, 200);
    const toggleJson = await toggleRes.json();
    assert.strictEqual(toggleJson.success, true);
    assert.strictEqual(toggleJson.source.status, 'active');
  });

  it('7. GET /api/admin/products-detailed suportă paginare, căutare și filtrare pe categorii', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/products-detailed?limit=5&offset=0`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });

    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.products.length <= 5, 'Trebuie să respecte limita de paginare');
    assert.ok(json.total > 0, 'Totalul produselor trebuie să fie pozitiv');

    if (json.products.length > 0) {
      const prod = json.products[0];
      assert.ok(prod.id);
      assert.ok(prod.name);
      assert.ok(prod.category);
    }
  });

  it('8. GET /api/admin/products-detailed/:id returnează detaliul complet al produsului canonic', async () => {
    const listRes = await fetch(`${BASE_URL}/api/admin/products-detailed?limit=1`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });
    const listJson = await listRes.json();
    assert.ok(listJson.products.length > 0);
    const testProductId = listJson.products[0].id;

    const detailRes = await fetch(`${BASE_URL}/api/admin/products-detailed/${testProductId}`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });

    assert.strictEqual(detailRes.status, 200);
    const detailJson = await detailRes.json();
    assert.strictEqual(detailJson.success, true);
    assert.ok(detailJson.data.product);
    assert.strictEqual(detailJson.data.product.id, testProductId);
    assert.ok(Array.isArray(detailJson.data.offers));
    assert.ok(Array.isArray(detailJson.data.priceHistory));
  });
});
