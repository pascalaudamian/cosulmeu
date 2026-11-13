// tests/staging-publish-flow.test.ts
// Testare End-to-End pentru fluxul:
// STAGING -> VALIDARE -> APROBARE -> LISTĂ PREGĂTITĂ -> PREVIZUALIZARE -> ANULARE / CONFLICT 409 -> CONFIRMARE -> PUBLICARE -> IDEMPOTENȚĂ

import 'dotenv/config';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, it, before, after } from 'node:test';
import { getPool, closePool } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { CatalogDocument, CatalogExtractedOffer, CatalogImportRun } from '../src/indexing/catalog/catalogTypes.ts';

describe('Staging -> Validare -> Aprobare -> Previzualizare -> Publicare End-to-End Flow', () => {
  let server: http.Server;
  let baseUrl = '';
  let adminToken = '';
  let hasPgPool = false;

  const ts = Date.now();
  const docId = `doc-test-flow-${ts}`;
  const runId = `run-test-flow-${ts}`;
  const eanPrefix = `59488${String(ts).slice(-4)}`;
  const validOfferIds: string[] = [];
  let zeroPriceOfferId = '';
  let expiredOfferId = '';
  let invalidEanOfferId = '';
  let rejectedOfferId = '';
  let alreadyPublishedOfferId = '';
  let createdProductIds: string[] = [];

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  });

  before(async () => {
    process.env.NODE_ENV = 'test';
    const serverMod = await import('../server.ts');
    adminToken = serverMod.ADMIN_API_KEY;

    const pool = getPool();
    hasPgPool = Boolean(pool);

    server = await new Promise<http.Server>(resolve => {
      const srv = serverMod.app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const nowIso = new Date().toISOString();
    const testDoc: CatalogDocument = {
      id: docId,
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      documentUrl: 'https://www.lidl.ro/c/cataloage-online/test-flow',
      title: `Catalog Test Flow ${ts}`,
      format: 'html',
      downloadStatus: 'downloaded',
      parseStatus: 'parsed',
      rawExtractedCount: 31,
      matchedCount: 0,
      validatedCount: 0,
      publishedCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const testRun: CatalogImportRun = {
      id: runId,
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      startedAt: nowIso,
      completedAt: nowIso,
      status: 'completed',
      totalRawExtracted: 31,
      autoMatchedCount: 0,
      needsReviewCount: 29,
      publishedCount: 0,
      rejectedCount: 1,
      errors: []
    };

    const testOffers: CatalogExtractedOffer[] = [];
    for (let i = 1; i <= 26; i++) {
      const id = `stg-test-flow-${ts}-valid-${i}`;
      validOfferIds.push(id);
      const barcode = `${eanPrefix}${String(i).padStart(4, '0')}`;
      testOffers.push({
        id,
        runId,
        documentId: docId,
        retailerId: 'lidl',
        rawTitle: `Produs Test Flow ${ts} #${i}`,
        rawBrand: 'Pilos Test',
        rawBarcode: barcode,
        rawCategory: 'Lactate și ouă',
        normalPrice: 12.50,
        promoPrice: 9.90,
        effectivePrice: 9.90,
        currency: 'RON',
        packageQuantity: 500,
        packageUnit: 'g',
        unitPrice: 19.80,
        unitPriceMeasure: 'lei/kg',
        isPromo: true,
        validUntil: '2029-12-31',
        matchConfidence: 0.5,
        matchMethod: 'unmatched',
        stagingStatus: 'NEEDS_REVIEW',
        createdAt: nowIso,
        updatedAt: nowIso
      });
    }

    zeroPriceOfferId = `stg-test-flow-${ts}-invalid-price`;
    testOffers.push({
      id: zeroPriceOfferId,
      runId,
      documentId: docId,
      retailerId: 'lidl',
      rawTitle: `Produs Invalid Fără Preț ${ts}`,
      rawBrand: 'Test',
      normalPrice: 10.00,
      effectivePrice: 0,
      currency: 'RON',
      packageQuantity: 1,
      packageUnit: 'buc',
      isPromo: false,
      matchConfidence: 0,
      matchMethod: 'unmatched',
      stagingStatus: 'NEEDS_REVIEW',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    expiredOfferId = `stg-test-flow-${ts}-invalid-expired`;
    testOffers.push({
      id: expiredOfferId,
      runId,
      documentId: docId,
      retailerId: 'lidl',
      rawTitle: `Produs Invalid Expirat ${ts}`,
      rawBrand: 'Test',
      normalPrice: 10.00,
      effectivePrice: 8.50,
      currency: 'RON',
      packageQuantity: 1,
      packageUnit: 'buc',
      isPromo: true,
      validUntil: '2020-01-01',
      matchConfidence: 0,
      matchMethod: 'unmatched',
      stagingStatus: 'NEEDS_REVIEW',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    invalidEanOfferId = `stg-test-flow-${ts}-invalid-ean`;
    testOffers.push({
      id: invalidEanOfferId,
      runId,
      documentId: docId,
      retailerId: 'lidl',
      rawTitle: `Produs Invalid EAN ${ts}`,
      rawBrand: 'Test',
      rawBarcode: 'ABC123INVALID',
      normalPrice: 10.00,
      effectivePrice: 8.50,
      currency: 'RON',
      packageQuantity: 1,
      packageUnit: 'buc',
      isPromo: true,
      validUntil: '2029-12-31',
      matchConfidence: 0,
      matchMethod: 'unmatched',
      stagingStatus: 'NEEDS_REVIEW',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    rejectedOfferId = `stg-test-flow-${ts}-rejected`;
    testOffers.push({
      id: rejectedOfferId,
      runId,
      documentId: docId,
      retailerId: 'lidl',
      rawTitle: `Produs Respins Exclus ${ts}`,
      rawBrand: 'Test',
      normalPrice: 15.00,
      effectivePrice: 12.00,
      currency: 'RON',
      packageQuantity: 1,
      packageUnit: 'buc',
      isPromo: true,
      matchConfidence: 0,
      matchMethod: 'unmatched',
      stagingStatus: 'REJECTED',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    alreadyPublishedOfferId = `stg-test-flow-${ts}-already-published`;
    testOffers.push({
      id: alreadyPublishedOfferId,
      runId,
      documentId: docId,
      retailerId: 'lidl',
      rawTitle: `Produs Deja Publicat Exclus ${ts}`,
      rawBrand: 'Test',
      normalPrice: 15.00,
      effectivePrice: 12.00,
      currency: 'RON',
      packageQuantity: 1,
      packageUnit: 'buc',
      isPromo: true,
      matchConfidence: 0,
      matchMethod: 'unmatched',
      stagingStatus: 'PUBLISHED',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    if (pool) {
      await pool.query(
        `INSERT INTO catalog_documents (id, source_id, retailer_id, document_url, title, format, download_status, parse_status, raw_extracted_count, matched_count, validated_count, published_count, created_at, updated_at)
         VALUES ($1, 'cat-src-lidl', 'lidl', $2, $3, 'html', 'downloaded', 'parsed', 31, 0, 0, 0, NOW(), NOW())`,
        [docId, testDoc.documentUrl, testDoc.title]
      );

      await pool.query(
        `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
         VALUES ($1, 'cat-src-lidl', 'lidl', NOW(), 'completed', 31, 0, 29, 0, 1, '[]'::jsonb)`,
        [runId]
      );

      for (const off of testOffers) {
        await pool.query(
          `INSERT INTO catalog_extracted_offers (
             id, run_id, document_id, retailer_id, raw_title, raw_brand, raw_barcode, raw_category,
             normal_price, promo_price, effective_price, currency, package_quantity, package_unit,
             unit_price, unit_price_measure, is_promo, valid_until, match_confidence, match_method,
             staging_status, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20,
             $21, NOW(), NOW()
           )`,
          [
            off.id,
            off.runId,
            off.documentId,
            off.retailerId,
            off.rawTitle,
            off.rawBrand || null,
            off.rawBarcode || null,
            off.rawCategory || null,
            off.normalPrice,
            off.promoPrice || null,
            off.effectivePrice,
            off.currency,
            off.packageQuantity || null,
            off.packageUnit || null,
            off.unitPrice || null,
            off.unitPriceMeasure || null,
            off.isPromo,
            off.validUntil || null,
            off.matchConfidence,
            off.matchMethod,
            off.stagingStatus
          ]
        );
      }
    } else {
      StorageService.addCatalogDocument(testDoc);
      StorageService.addCatalogImportRun(testRun);
      StorageService.addCatalogExtractedOffers(testOffers);
    }
  });

  after(async () => {
    const pool = getPool();
    if (pool) {
      try {
        const prodRows = await pool.query(
          `SELECT id FROM products WHERE name LIKE $1 OR barcode LIKE $2`,
          [`Produs Test Flow ${ts}%`, `${eanPrefix}%`]
        );
        createdProductIds = prodRows.rows.map(r => String(r.id));
        if (createdProductIds.length > 0) {
          await pool.query('DELETE FROM price_observations WHERE product_id = ANY($1::varchar[])', [createdProductIds]);
          await pool.query('DELETE FROM product_offers WHERE product_id = ANY($1::varchar[])', [createdProductIds]);
          await pool.query('DELETE FROM retailer_products WHERE canonical_product_id = ANY($1::varchar[])', [createdProductIds]);
          await pool.query('DELETE FROM products WHERE id = ANY($1::varchar[])', [createdProductIds]);
        }
        await pool.query('DELETE FROM catalog_extracted_offers WHERE id LIKE $1', [`stg-test-flow-${ts}%`]);
        await pool.query('DELETE FROM catalog_import_runs WHERE id = $1', [runId]);
        await pool.query('DELETE FROM catalog_documents WHERE id = $1', [docId]);
        await pool.query("DELETE FROM admin_audit_logs WHERE target_id LIKE $1 OR details::text LIKE $2", [`stg-test-flow-${ts}%`, `%${ts}%`]);
      } catch (cleanupErr) {
        console.warn('Avertisment cleanup test flow:', cleanupErr);
      }
    } else {
      const memIds = [
        ...validOfferIds,
        zeroPriceOfferId,
        expiredOfferId,
        invalidEanOfferId,
        rejectedOfferId,
        alreadyPublishedOfferId
      ];
      StorageService.removeCatalogExtractedOffersByIds(memIds);
    }

    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await closePool();
  });

  it('1. Validarea individuală respinge oferta cu preț 0 (HTTP 422) și persistă validation_errors', async () => {
    const res = await fetch(`${baseUrl}/api/admin/catalog-importer/staging/${zeroPriceOfferId}/review`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: 'approve', userEmail: 'test-admin@cosulmeu.ro' })
    });

    assert.strictEqual(res.status, 422, 'Oferta cu preț 0 trebuie respinsă cu HTTP 422');
    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.ok(Array.isArray(json.validationErrors) && json.validationErrors.length > 0);

    if (hasPgPool) {
      const dbRow = await getPool()!.query('SELECT staging_status, validation_errors FROM catalog_extracted_offers WHERE id = $1', [zeroPriceOfferId]);
      assert.strictEqual(dbRow.rows[0].staging_status, 'NEEDS_REVIEW');
      assert.ok(Array.isArray(dbRow.rows[0].validation_errors) && dbRow.rows[0].validation_errors.length > 0);
    } else {
      const memRow = StorageService.getCatalogExtractedOffers().find(o => o.id === zeroPriceOfferId)!;
      assert.strictEqual(memRow.stagingStatus, 'NEEDS_REVIEW');
      assert.ok(Array.isArray(memRow.validationErrors) && memRow.validationErrors.length > 0);
    }
  });

  it('2. Aprobă & Validează în masă aprobă cele 26 oferte valide și păstrează cele 3 invalide în NEEDS_REVIEW', async () => {
    const batchIds = [...validOfferIds, zeroPriceOfferId, expiredOfferId, invalidEanOfferId];
    const res = await fetch(`${baseUrl}/api/admin/catalog-importer/staging/bulk-review`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ offerIds: batchIds, action: 'approve', userEmail: 'test-admin@cosulmeu.ro' })
    });

    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.partial, true);
    assert.strictEqual(json.updatedCount, 26, 'Exact 26 oferte valide trebuie aprobate');
    assert.strictEqual(json.failedCount, 3, 'Exact 3 oferte invalide trebuie respinse de validare');
    assert.strictEqual(json.approvedIds.length, 26);
    assert.strictEqual(json.failedItems.length, 3);

    if (hasPgPool) {
      const approvedCheck = await getPool()!.query(
        `SELECT COUNT(*)::int AS cnt FROM catalog_extracted_offers WHERE id = ANY($1::varchar[]) AND staging_status = 'APPROVED' AND validation_errors IS NULL`,
        [validOfferIds]
      );
      assert.strictEqual(approvedCheck.rows[0].cnt, 26, 'Toate cele 26 oferte trebuie să fie APPROVED în PostgreSQL');
    } else {
      const approvedMem = StorageService.getCatalogExtractedOffers().filter(o => validOfferIds.includes(o.id) && o.stagingStatus === 'APPROVED');
      assert.strictEqual(approvedMem.length, 26);
    }
  });

  it('3. Previzualizarea afișează TOATE cele 26+ oferte aprobate (fără trunchiere), exclude REJECTED/PUBLISHED/NEEDS_REVIEW și păstrează datele la anulare', async () => {
    const mixedIds = [...validOfferIds, zeroPriceOfferId, rejectedOfferId, alreadyPublishedOfferId];
    const previewRes = await fetch(`${baseUrl}/api/admin/staging/preview-publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ offerIds: mixedIds })
    });

    assert.strictEqual(previewRes.status, 200);
    const previewJson = await previewRes.json();
    assert.strictEqual(previewJson.success, true);

    const preview = previewJson.preview;
    assert.strictEqual(preview.toPublishCount, 26, 'Trebuie să fie exact 26 oferte eligibile în preview');
    assert.strictEqual(preview.items.length, 26, 'Lista items nu trebuie trunchiată la 2 sau 10');
    assert.strictEqual(preview.sampleItems.length, 26, 'Nici sampleItems nu trebuie trunchiată');
    assert.ok(preview.previewSnapshotHash && preview.previewSnapshotHash.length >= 16);
    assert.strictEqual(preview.newProductsCount, 26);
    assert.strictEqual(preview.newOffersCount, 26);
    assert.ok(preview.items.every((i: any) => validOfferIds.includes(i.id)));
    assert.ok(preview.items[0].ean && preview.items[0].ean.startsWith(eanPrefix));

    // Verificăm și previzualizarea globală (fără filter offerIds) -> include automat toate cele 26 oferte aprobate
    const globalPreviewRes = await fetch(`${baseUrl}/api/admin/staging/preview-publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({})
    });
    assert.strictEqual(globalPreviewRes.status, 200);
    const globalPreviewJson = await globalPreviewRes.json();
    const foundTestInGlobal = globalPreviewJson.preview.items.filter((i: any) => validOfferIds.includes(i.id));
    assert.strictEqual(foundTestInGlobal.length, 26, 'Previzualizarea globală trebuie să conțină automat toate cele 26 oferte aprobate');

    // Simulare "Anulează": nu apelăm publish, re-deschidem previzualizarea -> ofertele rămân intacte
    const reopenRes = await fetch(`${baseUrl}/api/admin/staging/preview-publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ offerIds: validOfferIds })
    });
    const reopenJson = await reopenRes.json();
    assert.strictEqual(reopenJson.preview.toPublishCount, 26);
    assert.strictEqual(reopenJson.preview.previewSnapshotHash, preview.previewSnapshotHash);
  });

  it('4. Conflict de snapshot (HTTP 409) blochează publicarea cu hash expirat', async () => {
    const conflictRes = await fetch(`${baseUrl}/api/admin/catalog-importer/publish-validated`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        offerIds: validOfferIds,
        previewSnapshotHash: 'stale-hash-mismatch-123456',
        userEmail: 'test-admin@cosulmeu.ro'
      })
    });

    assert.strictEqual(conflictRes.status, 409, 'Hash-ul învechit trebuie să întoarcă HTTP 409 Conflict');
    const conflictJson = await conflictRes.json();
    assert.strictEqual(conflictJson.success, false);
    assert.strictEqual(conflictJson.conflict, true);
    assert.strictEqual(conflictJson.requiresRefreshPreview, true);
  });

  it('5. Confirmă & Publică persistă atomic produsele/ofertele și previne dubla publicare', async () => {
    const previewRes = await fetch(`${baseUrl}/api/admin/staging/preview-publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ offerIds: validOfferIds })
    });
    const previewJson = await previewRes.json();
    const { previewSnapshotHash, eligibleOfferIds } = previewJson.preview;
    assert.strictEqual(eligibleOfferIds.length, 26);

    const publishRes = await fetch(`${baseUrl}/api/admin/catalog-importer/publish-validated`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        offerIds: eligibleOfferIds,
        previewSnapshotHash,
        userEmail: 'test-admin@cosulmeu.ro'
      })
    });

    assert.strictEqual(publishRes.status, 200);
    const publishJson = await publishRes.json();
    assert.strictEqual(publishJson.success, true);
    assert.strictEqual(publishJson.publishedCount, 26, 'Toate cele 26 oferte trebuie publicate');
    assert.strictEqual(publishJson.publishedOfferIds.length, 26);

    if (hasPgPool) {
      const pool = getPool()!;
      const stagingCheck = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM catalog_extracted_offers WHERE id = ANY($1::varchar[]) AND staging_status = 'PUBLISHED'`,
        [validOfferIds]
      );
      assert.strictEqual(stagingCheck.rows[0].cnt, 26, 'Toate cele 26 rânduri din staging trebuie să devină PUBLISHED');

      const prodCheck = await pool.query(`SELECT id FROM products WHERE barcode LIKE $1`, [`${eanPrefix}%`]);
      assert.strictEqual(prodCheck.rows.length, 26, 'Toate cele 26 produse canonice trebuie salvate în products');

      const prodIds = prodCheck.rows.map(r => r.id);
      const offerCheck = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM product_offers WHERE product_id = ANY($1::varchar[]) AND store_id = 'lidl'`,
        [prodIds]
      );
      assert.strictEqual(offerCheck.rows[0].cnt, 26, 'Toate cele 26 oferte trebuie salvate în product_offers');

      const obsCheck = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM price_observations WHERE product_id = ANY($1::varchar[]) AND store_id = 'lidl'`,
        [prodIds]
      );
      assert.strictEqual(obsCheck.rows[0].cnt, 26, 'Toate cele 26 observații de preț trebuie înregistrate');

      const docCheck = await pool.query('SELECT published_count FROM catalog_documents WHERE id = $1', [docId]);
      assert.strictEqual(Number(docCheck.rows[0].published_count), 26, 'Contorul published_count pe document trebuie actualizat');
    } else {
      const memPublished = StorageService.getCatalogExtractedOffers().filter(o => validOfferIds.includes(o.id) && o.stagingStatus === 'PUBLISHED');
      assert.strictEqual(memPublished.length, 26);
    }

    // A doua încercare de publicare pe aceleași ID-uri -> idempotentă (0 noi publicări, zero dubluri)
    const secondRes = await fetch(`${baseUrl}/api/admin/catalog-importer/publish-validated`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ offerIds: validOfferIds, userEmail: 'test-admin@cosulmeu.ro' })
    });
    assert.strictEqual(secondRes.status, 200);
    const secondJson = await secondRes.json();
    assert.strictEqual(secondJson.publishedCount, 0, 'A doua publicare pe oferte deja PUBLISHED nu trebuie să creeze duplicate');
  });

  it('6. /api/stores și /api/admin/retailers nu returnează ID-uri duplicate (ex. penny, mega-image, metro)', async () => {
    const [storesRes, retailersRes] = await Promise.all([
      fetch(`${baseUrl}/api/stores`),
      fetch(`${baseUrl}/api/admin/retailers`, { headers: getAuthHeaders() })
    ]);

    assert.strictEqual(storesRes.status, 200);
    assert.strictEqual(retailersRes.status, 200);

    const storesJson = await storesRes.json();
    const retailersJson = await retailersRes.json();

    const storeIds = (storesJson.stores || []).map((s: any) => s.id);
    const retailerIds = (retailersJson.retailers || []).map((r: any) => r.id);

    assert.strictEqual(new Set(storeIds).size, storeIds.length, '/api/stores trebuie să conțină doar ID-uri unice');
    assert.strictEqual(new Set(retailerIds).size, retailerIds.length, '/api/admin/retailers trebuie să conțină doar ID-uri unice');

    for (const criticalId of ['penny', 'mega-image', 'metro']) {
      assert.ok(
        storeIds.filter((id: string) => id === criticalId).length <= 1,
        `/api/stores nu trebuie să dubleze ${criticalId}`
      );
      assert.ok(
        retailerIds.filter((id: string) => id === criticalId).length <= 1,
        `/api/admin/retailers nu trebuie să dubleze ${criticalId}`
      );
    }
  });
});
