// tests/incremental-sync.test.ts
// Verificare completă pentru sistemul automat de indexare, salvare și actualizare incrementală (Scenariile A - H)

import dotenv from 'dotenv';
dotenv.config();

import { DatabaseService, getPool, closePool, isPostgresConfigured } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { CatalogExtractedOffer } from '../src/indexing/catalog/catalogTypes.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runIncrementalSyncTests() {
  console.log('============================================================');
  console.log('🧪 TESTARE INCREMENTAL SYNC & POSTGRESQL (SCENARIILE A - H)');
  console.log('============================================================\n');

  const pool = getPool();
  assert(Boolean(pool), 'Pool-ul PostgreSQL Supabase este configurat și conectat.');
  if (!pool) {
    console.error('Baza de date nu este disponibilă.');
    process.exit(1);
  }

  const client = await pool.connect();
  const testEan = `5941999${Date.now().toString().slice(-6)}`;
  const testSkuLidl = `sku-lidl-${Date.now()}`;
  const testSkuCarrefour = `sku-carrefour-${Date.now()}`;

  try {
    // Curățare date de test anterioare dacă există
    await client.query("DELETE FROM products WHERE barcode LIKE '5941999%'");

    // =========================================================================
    // SCENARIUL A: Primul Import (Produse Noi, Oferte Noi, Observații Preț)
    // =========================================================================
    console.log('--- Scenariul A: Primul Import (Produse și oferte noi) ---');
    const runIdA = `run-test-a-${Date.now()}`;
    const offerA: CatalogExtractedOffer = {
      id: `stg-lidl-item-1-${Date.now()}`,
      runId: runIdA,
      documentId: 'doc-test-1',
      retailerId: 'lidl',
      rawTitle: 'Iaurt Grecesc Pilos 10% 400g',
      rawBrand: 'Pilos',
      rawBarcode: testEan,
      rawCategory: 'Lactate',
      normalPrice: 5.99,
      effectivePrice: 5.99,
      currency: 'RON',
      packageQuantity: 400,
      packageUnit: 'g',
      unitPrice: 14.98,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      matchConfidence: 1.0,
      matchMethod: 'gtin_exact',
      stagingStatus: 'VALIDATED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Creare import run
    await client.query(
      `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
       VALUES ($1, 'cat-src-lidl', 'lidl', NOW(), 'running', 1, 0, 0, 0, 0, '[]'::jsonb)`,
      [runIdA]
    );

    const resultA = await DatabaseService.syncBatchIncremental({
      runId: runIdA,
      documentId: 'doc-test-1',
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      offers: [offerA],
      autoPublish: true
    });
    if (!resultA.success) {
      console.error('syncBatchIncremental Error details:', resultA.stats.errors);
    }

    assert(resultA.success === true, 'Importul din Scenariul A a finalizat cu succes.');
    assert(resultA.stats.newProductsCount === 1, `A fost creat exact 1 produs canonic nou (obținut: ${resultA.stats.newProductsCount})`);
    assert(resultA.stats.newOffersCount === 1, `A fost creată exact 1 ofertă nouă (obținut: ${resultA.stats.newOffersCount})`);
    assert(resultA.stats.changedPricesCount === 1, `A fost înregistrat 1 preț nou (obținut: ${resultA.stats.changedPricesCount})`);
    assert(resultA.stats.publishedCount === 1, `A fost marcat ca publicat 1 produs (obținut: ${resultA.stats.publishedCount})`);

    // Verificare DB direct
    const prodResA = await client.query('SELECT * FROM products WHERE barcode = $1', [testEan]);
    assert(prodResA.rows.length === 1, 'Produsul canonic este salvat persistent în tabela products.');
    const canonicalId = prodResA.rows[0].id;

    const offerResA = await client.query('SELECT * FROM product_offers WHERE product_id = $1 AND store_id = $2', [canonicalId, 'lidl']);
    assert(offerResA.rows.length === 1 && parseFloat(offerResA.rows[0].price) === 5.99, 'Oferta este salvată în product_offers cu prețul 5.99.');

    const obsResA = await client.query('SELECT * FROM price_observations WHERE product_id = $1 AND store_id = $2', [canonicalId, 'lidl']);
    assert(obsResA.rows.length === 1 && parseFloat(obsResA.rows[0].price) === 5.99, 'Observația este înregistrată în price_observations cu prețul 5.99.');

    // =========================================================================
    // SCENARIUL B: Re-import Identic (Idempotență & Zero Dubluri)
    // =========================================================================
    console.log('\n--- Scenariul B: Re-import identic (Idempotență & Zero duplicate) ---');
    const runIdB = `run-test-b-${Date.now()}`;
    await client.query(
      `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
       VALUES ($1, 'cat-src-lidl', 'lidl', NOW(), 'running', 1, 0, 0, 0, 0, '[]'::jsonb)`,
      [runIdB]
    );

    const resultB = await DatabaseService.syncBatchIncremental({
      runId: runIdB,
      documentId: 'doc-test-1',
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      offers: [offerA],
      autoPublish: true
    });

    assert(resultB.success === true, 'Re-importul identic a rulat cu succes.');
    assert(resultB.stats.newProductsCount === 0, 'Zero produse noi create la re-import (idempotență catalog).');
    assert(resultB.stats.identifiedExistingCount === 1, 'Produsul a fost identificat ca existent prin EAN.');
    assert(resultB.stats.newOffersCount === 0, 'Zero oferte noi create (oferta exista deja).');
    assert(resultB.stats.unchangedPricesCount === 1, 'Prețul este recunoscut ca neschimbat.');

    const obsResB = await client.query('SELECT * FROM price_observations WHERE product_id = $1 AND store_id = $2', [canonicalId, 'lidl']);
    assert(obsResB.rows.length === 1, 'Istoricul price_observations nu conține duplicate pentru același preț (lungime 1).');

    // =========================================================================
    // SCENARIUL C: Actualizare Incrementală a Prețului (Append-Only History)
    // =========================================================================
    console.log('\n--- Scenariul C: Actualizare incrementală de preț (Append-Only) ---');
    const runIdC = `run-test-c-${Date.now()}`;
    const offerC: CatalogExtractedOffer = {
      ...offerA,
      id: `stg-lidl-item-1-promo-${Date.now()}`,
      runId: runIdC,
      normalPrice: 5.99,
      promoPrice: 4.79,
      effectivePrice: 4.79,
      isPromo: true,
      promoDetails: '-20% Săptămâna Grecească'
    };

    await client.query(
      `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
       VALUES ($1, 'cat-src-lidl', 'lidl', NOW(), 'running', 1, 0, 0, 0, 0, '[]'::jsonb)`,
      [runIdC]
    );

    const resultC = await DatabaseService.syncBatchIncremental({
      runId: runIdC,
      documentId: 'doc-test-2',
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      offers: [offerC],
      autoPublish: true
    });

    assert(resultC.success === true, 'Actualizarea de preț a rulat cu succes.');
    assert(resultC.stats.changedPricesCount === 1, 'A fost detectată exact 1 schimbare de preț.');
    assert(resultC.stats.updatedOffersCount === 1, 'A fost actualizată oferta existentă în product_offers.');

    const offerResC = await client.query('SELECT * FROM product_offers WHERE product_id = $1 AND store_id = $2', [canonicalId, 'lidl']);
    assert(parseFloat(offerResC.rows[0].price) === 4.79, 'Prețul curent în product_offers este acum 4.79.');
    assert(offerResC.rows[0].is_promo === true, 'Oferta este marcată ca promoție.');

    const obsResC = await client.query('SELECT * FROM price_observations WHERE product_id = $1 AND store_id = $2 ORDER BY price ASC', [canonicalId, 'lidl']);
    assert(obsResC.rows.length === 2, 'Istoricul are 2 observații distincte (preț vechi 5.99 și preț nou 4.79).');
    assert(obsResC.rows.some((r: any) => parseFloat(r.price) === 5.99), 'Prețul vechi de 5.99 este păstrat imutabil în istoric.');
    assert(obsResC.rows.some((r: any) => parseFloat(r.price) === 4.79), 'Prețul nou de 4.79 a fost adăugat în istoric.');

    // =========================================================================
    // SCENARIUL D: Expirare Promoție
    // =========================================================================
    console.log('\n--- Scenariul D: Expirare promoție & revenire la preț standard ---');
    const runIdD = `run-test-d-${Date.now()}`;
    const offerD: CatalogExtractedOffer = {
      ...offerA,
      id: `stg-lidl-item-1-ended-${Date.now()}`,
      runId: runIdD,
      normalPrice: 5.99,
      effectivePrice: 5.99,
      isPromo: false
    };

    await client.query(
      `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
       VALUES ($1, 'cat-src-lidl', 'lidl', NOW(), 'running', 1, 0, 0, 0, 0, '[]'::jsonb)`,
      [runIdD]
    );

    const resultD = await DatabaseService.syncBatchIncremental({
      runId: runIdD,
      documentId: 'doc-test-3',
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      offers: [offerD],
      autoPublish: true
    });

    assert(resultD.stats.expiredOffersCount === 1, 'Promoția anterioară a fost marcată ca expirată.');
    const offerResD = await client.query('SELECT * FROM product_offers WHERE product_id = $1 AND store_id = $2', [canonicalId, 'lidl']);
    assert(parseFloat(offerResD.rows[0].price) === 5.99 && offerResD.rows[0].is_promo === false, 'Oferta a revenit la prețul standard de 5.99 și is_promo: false.');

    // =========================================================================
    // SCENARIUL E: Produs Fără Preț (Protecție Împotriva Prețului Zero / Nul)
    // =========================================================================
    console.log('\n--- Scenariul E: Produs fără preț valid (Protecție 0.00 / Nul) ---');
    const runIdE = `run-test-e-${Date.now()}`;
    const offerE: CatalogExtractedOffer = {
      ...offerA,
      id: `stg-lidl-item-no-price-${Date.now()}`,
      effectivePrice: 0,
      normalPrice: 0
    };

    await client.query(
      `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
       VALUES ($1, 'cat-src-lidl', 'lidl', NOW(), 'running', 1, 0, 0, 0, 0, '[]'::jsonb)`,
      [runIdE]
    );

    const resultE = await DatabaseService.syncBatchIncremental({
      runId: runIdE,
      documentId: 'doc-test-4',
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      offers: [offerE],
      autoPublish: true
    });

    assert(resultE.stats.itemsWithoutPriceCount === 1, 'Produsul cu preț 0 a fost contorizat la itemsWithoutPrice.');
    const offerResE = await client.query('SELECT * FROM product_offers WHERE product_id = $1 AND store_id = $2', [canonicalId, 'lidl']);
    assert(parseFloat(offerResE.rows[0].price) === 5.99, 'Prețul cunoscut (5.99) NU a fost suprascris cu 0 sau NULL.');

    // =========================================================================
    // SCENARIUL F: Potrivire Canonică Multi-Retailer (Lidl + Carrefour pe Același EAN)
    // =========================================================================
    console.log('\n--- Scenariul F: Potrivire canonică multi-retailer (același EAN) ---');
    const runIdF = `run-test-f-${Date.now()}`;
    const offerF: CatalogExtractedOffer = {
      id: `stg-carrefour-item-1-${Date.now()}`,
      runId: runIdF,
      documentId: 'doc-carrefour-1',
      retailerId: 'carrefour',
      rawTitle: 'Iaurt Grecesc Pilos 10% 400g (La Carrefour)',
      rawBrand: 'Pilos',
      rawBarcode: testEan, // Același EAN
      normalPrice: 6.29,
      effectivePrice: 6.29,
      currency: 'RON',
      packageQuantity: 400,
      packageUnit: 'g',
      isPromo: false,
      matchConfidence: 1.0,
      matchMethod: 'gtin_exact',
      stagingStatus: 'VALIDATED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
       VALUES ($1, 'cat-src-carrefour', 'carrefour', NOW(), 'running', 1, 0, 0, 0, 0, '[]'::jsonb)`,
      [runIdF]
    );

    const resultF = await DatabaseService.syncBatchIncremental({
      runId: runIdF,
      documentId: 'doc-carrefour-1',
      sourceId: 'cat-src-carrefour',
      retailerId: 'carrefour',
      offers: [offerF],
      autoPublish: true
    });

    assert(resultF.stats.identifiedExistingCount === 1, 'Carrefour a identificat același produs canonic după EAN.');
    assert(resultF.stats.newProductsCount === 0, 'NU s-a creat un produs duplicat în products.');

    const allStoresForProd = await client.query('SELECT store_id, price FROM product_offers WHERE product_id = $1 ORDER BY store_id ASC', [canonicalId]);
    assert(allStoresForProd.rows.length === 2, 'Produsul canonic are exact 2 oferte de la cei 2 retaileri.');
    assert(allStoresForProd.rows.some((r: any) => r.store_id === 'lidl' && parseFloat(r.price) === 5.99), 'Oferta Lidl este 5.99.');
    assert(allStoresForProd.rows.some((r: any) => r.store_id === 'carrefour' && parseFloat(r.price) === 6.29), 'Oferta Carrefour este 6.29.');

    const rpRes = await client.query('SELECT retailer_id FROM retailer_products WHERE product_id = $1', [canonicalId]);
    assert(rpRes.rows.length >= 2, 'Există mapări distincte în retailer_products pentru fiecare retailer.');

    // =========================================================================
    // SCENARIUL G: Protecție Execuții Concurente (Advisory Lock)
    // =========================================================================
    console.log('\n--- Scenariul G: Protecție execuții concurente (Advisory Lock) ---');
    // Luăm manual lock-ul pe retailerul 'profi'
    const lockAcquireRes = await client.query("SELECT pg_try_advisory_lock(hashtext('catalog_sync_profi')) AS acquired");
    assert(lockAcquireRes.rows[0]?.acquired === true, 'Worker-1 a obținut advisory lock pe retailerul profi.');

    const runIdG = `run-test-g-${Date.now()}`;
    const offerG: CatalogExtractedOffer = {
      id: `stg-profi-item-1-${Date.now()}`,
      runId: runIdG,
      documentId: 'doc-profi-1',
      retailerId: 'profi',
      rawTitle: 'Pâine feliată Profi 500g',
      normalPrice: 3.49,
      effectivePrice: 3.49,
      currency: 'RON',
      isPromo: false,
      matchConfidence: 0.95,
      matchMethod: 'name_brand_similarity',
      stagingStatus: 'VALIDATED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const concurrentResult = await DatabaseService.syncBatchIncremental({
      runId: runIdG,
      sourceId: 'cat-src-profi',
      retailerId: 'profi',
      offers: [offerG],
      autoPublish: true
    });

    assert(concurrentResult.success === false, 'Importul concurent a fost refuzat corect.');
    assert(concurrentResult.stats.errors[0]?.includes('blocată'), 'Eroarea raportează blocajul concurent fără corupere.');

    // Eliberăm lock-ul
    await client.query("SELECT pg_advisory_unlock(hashtext('catalog_sync_profi'))");
    console.log('   Advisory lock eliberat cu succes.');

    // =========================================================================
    // SCENARIUL H: Recuperare la Eșec Parțial & Integritate Tranzacțională
    // =========================================================================
    console.log('\n--- Scenariul H: Recuperare la eșec parțial & integritate tranzacțională ---');
    const runIdH = `run-test-h-${Date.now()}`;
    const validOfferH: CatalogExtractedOffer = {
      id: `stg-penny-item-1-${Date.now()}`,
      runId: runIdH,
      documentId: 'doc-penny-1',
      retailerId: 'penny',
      rawTitle: 'Mere Ionatan Penny 1kg',
      normalPrice: 4.29,
      effectivePrice: 4.29,
      currency: 'RON',
      isPromo: false,
      matchConfidence: 0.9,
      matchMethod: 'name_brand_similarity',
      stagingStatus: 'VALIDATED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const invalidOfferH: CatalogExtractedOffer = {
      id: `stg-penny-item-2-${Date.now()}`,
      runId: runIdH,
      documentId: 'doc-penny-1',
      retailerId: 'penny',
      rawTitle: 'Produs fără preț',
      normalPrice: 0,
      effectivePrice: 0,
      currency: 'RON',
      isPromo: false,
      matchConfidence: 0,
      matchMethod: 'unmatched',
      stagingStatus: 'VALIDATED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO catalog_import_runs (id, source_id, retailer_id, started_at, status, total_raw_extracted, auto_matched_count, needs_review_count, published_count, rejected_count, errors)
       VALUES ($1, 'cat-src-penny', 'penny', NOW(), 'running', 2, 0, 0, 0, 0, '[]'::jsonb)`,
      [runIdH]
    );

    const resultH = await DatabaseService.syncBatchIncremental({
      runId: runIdH,
      documentId: 'doc-penny-1',
      sourceId: 'cat-src-penny',
      retailerId: 'penny',
      offers: [validOfferH, invalidOfferH],
      autoPublish: true
    });

    assert(resultH.success === true, 'Lotul hibrid s-a procesat fără crash general.');
    assert(resultH.stats.publishedCount === 1, 'Oferta validă a fost salvată și publicată.');
    assert(resultH.stats.itemsWithoutPriceCount === 1, 'Oferta fără preț a fost izolată corect.');

    // Curățare date de test
    await client.query("DELETE FROM products WHERE barcode LIKE '5941999%'");
    await client.query("DELETE FROM products WHERE name LIKE '%Pilos%'");

    console.log('\n============================================================');
    console.log(`REZULTAT FINAL: ${passed} teste trecute, ${failed} eșuate.`);
    console.log('============================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Eroare neașteptată în suita de teste:', err);
    process.exit(1);
  } finally {
    client.release();
    await closePool();
  }
}

runIncrementalSyncTests();
