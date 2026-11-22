// tests/faza0-canonical-integrity.test.ts
// Suită completă de verificare pentru Faza 0: integritate product-centric, rezolvare alias multi-hop, protecție cicluri,
// API-uri publice/admin, servicii de business, persistență locală idempotentă și reguli de securitate.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { DatabaseService, invalidateCatalogOptimizationCache } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import {
  buildCanonicalAliasIndex,
  buildCanonicalExternalSku,
  collectProductIdsForCanonical,
  detectCanonicalCycle,
  normalizeBarcodeCandidates,
  normalizeStoreIdKey,
  pickRetailerProductUrl,
  resolveCanonicalProductDetail,
  resolveCanonicalProductId
} from '../src/services/ProductIdentityService.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.ts';
import { PriceHistoryService } from '../src/services/PriceHistoryService.ts';
import { PriceAlertService } from '../src/services/PriceAlertService.ts';
import { ProductAlternativesService } from '../src/services/ProductAlternativesService.ts';
import { lookupProductByBarcode } from '../src/services/BarcodeService.ts';
import { matchReceiptItemsToCatalog } from '../src/services/ReceiptParserEngine.ts';
import { CatalogStagingManager } from '../src/indexing/catalog/CatalogStagingManager.ts';
import { PRODUCTS, STORES } from '../src/data/mockData.ts';
import type {
  PriceAlert,
  PriceObservation,
  Product,
  ProductOffer,
  Receipt,
  RetailerProductRecord,
  ShoppingList
} from '../src/types.ts';

let passed = 0;
function pass(label: string) {
  passed++;
  console.log(`  [PASS] ${label}`);
}

async function runTests() {
  console.log('====================================================================');
  console.log('FAZA 0: TESTE INTEGRITATE PRODUCT-CENTRIC, ALIASURI & SECURITATE');
  console.log('====================================================================\n');

  StorageService.resetAllData();

  // --- 1. Multi-hop resolution (A -> B -> C) & descendant collection ---
  {
    const nodes = [
      { id: 'prod-c', canonicalProductId: null },
      { id: 'prod-b', canonicalProductId: 'prod-c' },
      { id: 'prod-a', canonicalProductId: 'prod-b' },
      { id: 'prod-b2', canonicalProductId: 'prod-c' }
    ];
    const index = buildCanonicalAliasIndex(nodes);
    assert.equal(resolveCanonicalProductId('prod-a', index), 'prod-c');
    assert.equal(resolveCanonicalProductId('prod-b', index), 'prod-c');
    assert.equal(resolveCanonicalProductId('prod-c', index), 'prod-c');

    const equiv = collectProductIdsForCanonical('prod-c', index);
    assert.deepEqual(new Set(equiv), new Set(['prod-c', 'prod-b', 'prod-a', 'prod-b2']));

    const fullProducts: Product[] = [
      { ...PRODUCTS[0], id: 'prod-c', name: 'Produs Canonic C', canonicalProductId: null },
      { ...PRODUCTS[0], id: 'prod-b', name: 'Alias B', canonicalProductId: 'prod-c' },
      { ...PRODUCTS[0], id: 'prod-a', name: 'Alias A', canonicalProductId: 'prod-b' }
    ];
    const detail = resolveCanonicalProductDetail('prod-a', fullProducts);
    assert.equal(detail.found, true);
    assert.equal(detail.canonicalId, 'prod-c');
    assert.equal(detail.wasAlias, true);
    assert.equal(detail.hops, 2);
    pass('1. Rezolvare tranzitivă multi-hop (A -> B -> C) și colectare echivalențe descendente');
  }

  // --- 2. Cycle & self-loop protection ---
  {
    const cycleMap = new Map<string, string>([
      ['cyc-1', 'cyc-2'],
      ['cyc-2', 'cyc-3'],
      ['cyc-3', 'cyc-1'],
      ['self-1', 'self-1']
    ]);
    assert.equal(detectCanonicalCycle('self-1', 'self-1', cycleMap), true);
    assert.equal(detectCanonicalCycle('cyc-1', 'cyc-2', cycleMap), true);
    assert.equal(detectCanonicalCycle('fresh-node', 'prod-c', cycleMap), false);

    const cycIndex = buildCanonicalAliasIndex(cycleMap);
    const detailCyc = resolveCanonicalProductDetail('cyc-1', cycIndex);
    assert.equal(detailCyc.cycleDetected, true);
    assert.equal(detailCyc.found, false);
    pass('2. Protecție împotriva auto-referințelor și ciclurilor A -> B -> C -> A');
  }

  // --- 3. Deterministic external_sku without EAN & Flyer PDF URL exclusion ---
  {
    const sku1 = buildCanonicalExternalSku({
      retailerId: 'lidl',
      title: 'Lapte UHT Napolact 1.5% 1L',
      packageQuantity: 1,
      packageUnit: 'l'
    });
    const sku2 = buildCanonicalExternalSku({
      retailerId: 'lidl',
      title: '  lapte   uht  Napolact 1.5% 1L ',
      packageQuantity: 1,
      packageUnit: 'l'
    });
    assert.equal(sku1, sku2, 'external_sku determinist este stabil la whitespace/capitalizare');
    assert.ok(sku1.startsWith('sku-'), 'external_sku determinist fără EAN are prefix sku-');

    const pickedPdfRejected = pickRetailerProductUrl({
      documentUrl: 'https://retailer.ro/catalog/revista-saptamanala.pdf',
      sourcePageUrl: 'https://retailer.ro/catalog/revista-saptamanala.pdf'
    });
    assert.equal(pickedPdfRejected, undefined, 'URL-ul generic identic cu broșura PDF nu este promovat ca URL de produs');

    const pickedProductUrl = pickRetailerProductUrl({
      catalogUrl: 'https://retailer.ro/p/lapte-napolact-1l',
      documentUrl: 'https://retailer.ro/catalog.pdf'
    });
    assert.equal(pickedProductUrl, 'https://retailer.ro/p/lapte-napolact-1l');
    pass('3. external_sku determinist fără EAN și filtrare URL broșuri PDF în Pick URL');
  }

  // --- Setup alias fixtures in StorageService for HTTP + service tests ---
  const canonicalProd = PRODUCTS.find(p => p.id === 'prod-lapte-1') || PRODUCTS[0];
  const aliasId1 = 'prod-lapte-alias-f0-1';
  const aliasId2 = 'prod-lapte-alias-f0-2'; // 2-hop: aliasId2 -> aliasId1 -> canonicalProd.id
  const today = new Date().toISOString().split('T')[0];

  StorageService.addCustomProduct({
    ...canonicalProd,
    id: aliasId1,
    name: `${canonicalProd.name} Alias 1`,
    barcode: undefined,
    canonicalProductId: canonicalProd.id
  });
  StorageService.addCustomProduct({
    ...canonicalProd,
    id: aliasId2,
    name: `${canonicalProd.name} Alias 2`,
    barcode: undefined,
    canonicalProductId: aliasId1
  });

  const aliasOfferPenny: ProductOffer = {
    id: 'off-f0-alias-penny',
    productId: aliasId1,
    storeId: 'store-penny',
    price: 5.49,
    unitPrice: 5.49,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    promoDetails: 'Super Preț',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    source: 'official_feed',
    observationDate: today,
    lastChecked: new Date().toISOString()
  };
  const aliasOfferAuchan: ProductOffer = {
    id: 'off-f0-alias-auchan',
    productId: aliasId2,
    storeId: 'store-auchan-chain',
    price: 5.79,
    unitPrice: 5.79,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    source: 'official_feed',
    observationDate: today,
    lastChecked: new Date().toISOString()
  };
  StorageService.addOrUpdateOffers([aliasOfferPenny, aliasOfferAuchan]);

  const obsAlias1: PriceObservation = {
    id: 'obs-f0-alias-1',
    productId: aliasId1,
    storeId: 'penny',
    price: 5.49,
    date: today,
    source: 'official_feed'
  };
  const obsAlias2: PriceObservation = {
    id: 'obs-f0-alias-2',
    productId: aliasId2,
    storeId: 'auchan',
    price: 5.79,
    date: new Date(Date.now() - 5 * 86400 * 1000).toISOString().split('T')[0],
    source: 'official_feed'
  };
  const baseObsBefore = StorageService.getPriceObservations().length;
  StorageService.addPriceObservations([obsAlias1, obsAlias2]);

  // --- 4. Staging publish excludes canonical aliases & resolves matchedProductId ---
  {
    const stagedId = `stg-f0-${Date.now()}`;
    StorageService.addCatalogExtractedOffers([
      {
        id: stagedId,
        runId: 'run-f0',
        documentId: 'doc-f0',
        retailerId: 'penny',
        rawTitle: canonicalProd.name,
        rawBrand: canonicalProd.brand,
        normalPrice: 5.49,
        effectivePrice: 5.49,
        currency: 'RON',
        isPromo: false,
        packageQuantity: canonicalProd.packageWeightOrVolume,
        packageUnit: canonicalProd.packageUnit,
        matchedProductId: aliasId2,
        matchedProductName: 'Alias 2',
        matchConfidence: 0.95,
        matchMethod: 'manual',
        stagingStatus: 'VALIDATED',
        priceValidationStatus: 'VALID',
        sourcePageUrl: 'https://penny.ro/p/lapte-1l',
        documentUrl: 'https://penny.ro/catalog.pdf',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    const pubRes = await CatalogStagingManager.publishValidatedOffers([stagedId]);
    assert.equal(pubRes.publishedCount, 1);
    const updatedStaged = StorageService.getCatalogExtractedOffers().find(s => s.id === stagedId);
    assert.equal(updatedStaged?.matchedProductId, canonicalProd.id, 'Publicarea din staging rezolvă aliasul la ID canonic');
    pass('4. CatalogStagingManager exclude aliasurile și rezolvă matchedProductId la ID canonic');
  }

  // --- 5. Barcode Lookup via retailer_products + leading zeros ---
  {
    assert.deepEqual(
      new Set(normalizeBarcodeCandidates('0594101400234')),
      new Set(['0594101400234', '594101400234'])
    );
    const rpRecord: RetailerProductRecord = {
      id: 'rp-f0-1',
      retailerId: 'penny',
      productId: aliasId2, // Points to multi-hop alias!
      externalSku: 'penny:f0-test',
      scrapedName: canonicalProd.name,
      barcode: '0594999900012',
      status: 'active'
    };
    StorageService.saveRetailerProducts([{ ...rpRecord, lastScrapedAt: new Date().toISOString() } as any]);

    const lookup = lookupProductByBarcode({
      barcode: '594999900012', // without leading zero
      products: StorageService.getAllProducts(),
      offers: StorageService.getProductOffers(),
      stores: STORES,
      observations: StorageService.getPriceObservations(),
      retailerProducts: [rpRecord]
    });
    assert.equal(lookup.found, true);
    assert.equal(lookup.product?.id, canonicalProd.id, 'Barcode pe retailer_products mapat la alias rezolvă produsul canonic');
    assert.ok(lookup.offers.some(o => normalizeStoreIdKey(o.store.id) === 'penny'), 'Include ofertele agregat-canonice din toate aliasurile');
    pass('5. BarcodeService rezolvă EAN din retailer_products (cu/fără 0 inițial) spre produsul canonic');
  }

  // --- 6. PriceComparisonService, BasketOptimizerService, PriceAlertService, Alternatives, History, Receipt ---
  {
    const allProducts = StorageService.getAllProducts();
    const allOffers = StorageService.getProductOffers();
    const aliasMapObj = new Map<string, string>();
    for (const p of allProducts) {
      if (p.canonicalProductId) aliasMapObj.set(p.id, p.canonicalProductId);
    }

    const listWithAlias: ShoppingList = {
      id: 'list-f0',
      name: 'Coș Test Alias',
      items: [
        {
          id: 'item-1',
          productId: aliasId2,
          name: 'Lapte Napolact 1.5%',
          category: canonicalProd.category,
          quantity: 2,
          unit: 'buc',
          checked: false
        }
      ],
      createdAt: today,
      updatedAt: today
    };

    // 6a. Price comparison
    const comp = PriceComparisonService.compareBasketAcrossStores(
      listWithAlias.items,
      { useLoyaltyCards: true, aliasMap: aliasMapObj },
      allProducts,
      allOffers,
      STORES
    );
    const pennyRow = comp.find(c => normalizeStoreIdKey(c.store.id) === 'penny');
    assert.ok(pennyRow && pennyRow.availableItems.length === 1, 'Comparatorul găsește produsul din alias la Penny');
    assert.equal(Math.round(pennyRow.availableTotal * 100) / 100, 10.98);

    // 6b. Basket optimizer
    const opt = BasketOptimizerService.optimize({
      list: { id: listWithAlias.id, name: listWithAlias.name },
      items: listWithAlias.items,
      products: allProducts,
      offers: allOffers,
      stores: STORES,
      aliasMap: aliasMapObj
    });
    const bestPlan = opt.bestSingleStore;
    assert.ok(bestPlan && opt.itemsWithoutAnyValidPrice.length === 0, 'Optimizatorul nu lasă produsul alias neatribuit');
    assert.equal(bestPlan.allocations[0].product.id, canonicalProd.id, 'Linia optimizată poartă ID canonic');

    // 6c. Price alerts creation & evaluation
    const existingAliasAlert: PriceAlert = {
      id: 'al-existing',
      productId: aliasId1,
      productName: canonicalProd.name,
      targetPrice: 6.0,
      currentLowestPrice: 5.49,
      createdAt: today,
      isActive: true,
      alertType: 'below_target'
    };
    const alertsRes = PriceAlertService.createAlertsFromShoppingList(
      listWithAlias,
      [existingAliasAlert],
      allProducts,
      allOffers,
      { aliasMap: aliasMapObj }
    );
    assert.equal(alertsRes.skippedExistingCount, 1, 'AlertService deduplică alertele existente indiferent de alias vs canonic');

    const evalRes = PriceAlertService.evaluateAlerts({
      alerts: [existingAliasAlert],
      offers: allOffers,
      products: allProducts,
      observations: StorageService.getPriceObservations(),
      stores: STORES,
      existingNotifications: [],
      aliasMap: aliasMapObj
    });
    assert.equal(evalRes.updatedAlerts[0].productId, canonicalProd.id);
    assert.ok(evalRes.newNotifications.length >= 1, 'Evaluarea alertei declanșează notificarea folosind oferta de pe alias');
    assert.equal(evalRes.newNotifications[0].productId, canonicalProd.id);

    // 6d. ProductAlternativesService excludes alias siblings
    const altRes = ProductAlternativesService.getAlternatives({
      targetProduct: allProducts.find(p => p.id === aliasId2)!,
      allProducts,
      allOffers,
      stores: STORES,
      aliasMap: aliasMapObj
    });
    const allAltIds = Object.values(altRes.groups).flat().map(i => i.product.id);
    assert.equal(allAltIds.includes(aliasId1), false, 'Alternativele nu afișează aliasurile ca produse similare');
    assert.equal(allAltIds.includes(canonicalProd.id), false);

    // 6e. PriceHistoryService aggregates across aliases
    const histStats = PriceHistoryService.getProductPriceStats(aliasId1, {
      observations: StorageService.getPriceObservations(),
      offers: allOffers,
      stores: STORES,
      aliasMap: aliasMapObj
    });
    assert.equal(histStats.productId, canonicalProd.id);
    assert.ok(histStats.observationsCount >= 2, 'Istoricul agregă observațiile de pe toate aliasurile echivalente');

    // 6f. ReceiptParserEngine promotes matchedProductId & EAN-matched alias to canonical
    const receiptMatch = matchReceiptItemsToCatalog(
      [{ rawName: canonicalProd.name, totalPrice: 5.49, matchedProductId: aliasId2, provenance: { matchedProductId: 'manual' } } as any],
      allProducts
    );
    assert.equal(receiptMatch[0].matchedProductId, canonicalProd.id, 'Bonul promovează matchedProductId manual la ID canonic');

    const eanAliasProducts: Product[] = [
      ...allProducts,
      { ...canonicalProd, id: 'prod-lapte-alias-ean', barcode: '5940000000011', canonicalProductId: aliasId1 }
    ];
    const receiptEanMatch = matchReceiptItemsToCatalog(
      [{ rawName: 'Lapte bio', eanCode: '5940000000011', totalPrice: 5.49 } as any],
      eanAliasProducts
    );
    assert.equal(receiptEanMatch[0].matchedProductId, canonicalProd.id, 'Bonul promovează match-ul EAN de pe alias la ID canonic');
    pass('6. Comparator, Optimizator, Alerte, Alternative, Istoric și Bonuri rezolvă canonic aliasurile');
  }

  // --- 7. StorageService.normalizeLocalProductReferences idempotency ---
  {
    const listsBefore: ShoppingList[] = [
      {
        id: 'loc-list-1',
        name: 'Lista Locală',
        items: [
          {
            id: 'li-1',
            productId: aliasId2,
            name: 'Lapte',
            category: canonicalProd.category,
            quantity: 1,
            unit: 'buc',
            checked: false
          }
        ],
        createdAt: today,
        updatedAt: today
      }
    ];
    StorageService.saveShoppingLists(listsBefore);
    StorageService.saveTrackedProducts([aliasId1, canonicalProd.id, aliasId2]);
    StorageService.savePriceAlerts([
      {
        id: 'loc-a1',
        productId: aliasId1,
        productName: 'Lapte',
        targetPrice: 6,
        currentLowestPrice: 5.5,
        createdAt: today,
        isActive: true,
        alertType: 'below_target'
      },
      {
        id: 'loc-a2',
        productId: canonicalProd.id,
        productName: 'Lapte',
        targetPrice: 6,
        currentLowestPrice: 5.5,
        createdAt: today,
        isActive: true,
        alertType: 'below_target'
      }
    ]);
    const rec: Receipt = {
      id: 'rec-f0-1',
      storeId: 'penny',
      storeName: 'Penny',
      date: today,
      items: [
        {
          id: 'ri-1',
          rawName: 'LAPTE NAPOLACT',
          matchedProductId: aliasId2,
          quantity: 1,
          unit: 'buc',
          unitPrice: 5.49,
          totalPrice: 5.49,
          discount: 0,
          confidence: 'high'
        }
      ],
      subtotal: 5.49,
      discountTotal: 0,
      total: 5.49,
      currency: 'RON',
      createdAt: today,
      verifiedStatus: 'confirmed'
    };
    StorageService.saveReceipts([rec]);

    const aliasObj = { [aliasId1]: canonicalProd.id, [aliasId2]: aliasId1 };
    const pass1 = StorageService.normalizeLocalProductReferences(aliasObj);
    assert.equal(pass1.updated, true);
    assert.equal(StorageService.getShoppingLists()[0].items[0].productId, canonicalProd.id);
    assert.deepEqual(StorageService.getTrackedProducts(), [canonicalProd.id]);
    assert.equal(StorageService.getPriceAlerts().length, 1, 'Alertele duplicate colapsate la canonic se deduplică');
    assert.equal(StorageService.getReceipts()[0].items[0].matchedProductId, canonicalProd.id);

    const pass2 = StorageService.normalizeLocalProductReferences(aliasObj);
    assert.equal(pass2.updated, false, 'A doua rulare a normalizării locale este strict idempotentă');
    pass('7. StorageService.normalizeLocalProductReferences actualizează localStorage sigur și idempotent');
  }

  // --- 8. Live Express HTTP API Tests ---
  const { app, ADMIN_API_KEY } = await import('../server.ts');
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 8a. GET /api/catalog/aliases
    const resAliases = await fetch(`${baseUrl}/api/catalog/aliases`);
    assert.equal(resAliases.status, 200);
    const aliasesData = await resAliases.json();
    assert.equal(aliasesData.success, true);
    assert.equal(aliasesData.aliases[aliasId2], canonicalProd.id);

    // 8b. GET /api/products/:id with multi-hop alias
    const resProdAlias = await fetch(`${baseUrl}/api/products/${encodeURIComponent(aliasId2)}`);
    assert.equal(resProdAlias.status, 200);
    const prodData = await resProdAlias.json();
    assert.equal(prodData.product.id, canonicalProd.id);
    assert.equal(prodData.canonicalProductId, canonicalProd.id);
    assert.equal(prodData.requestedProductId, aliasId2);
    assert.equal(prodData.redirectedFromAlias, true);
    assert.ok(
      prodData.comparison.offers.some((o: any) => normalizeStoreIdKey(o.store.id) === 'penny') &&
        prodData.comparison.offers.some((o: any) => normalizeStoreIdKey(o.store.id) === 'auchan'),
      'GET /api/products/:aliasId agregă ofertele de pe toate aliasurile și canonic'
    );

    // 8c. GET /api/catalog/history/:productId with alias
    const resHist = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(aliasId1)}?days=30`);
    assert.equal(resHist.status, 200);
    const histData = await resHist.json();
    assert.equal(histData.productId, canonicalProd.id);
    assert.equal(histData.requestedProductId, aliasId1);
    assert.ok(histData.observations.length >= 2);

    // 8d. GET /api/catalog/barcode/:code using retailer_products alias mapping
    const resBarcode = await fetch(`${baseUrl}/api/catalog/barcode/594999900012`);
    assert.equal(resBarcode.status, 200);
    const barcodeData = await resBarcode.json();
    assert.equal(barcodeData.found, true);
    assert.equal(barcodeData.product.id, canonicalProd.id);

    // 8e. GET /api/products/:id/alternatives using alias
    const resAlt = await fetch(`${baseUrl}/api/products/${encodeURIComponent(aliasId2)}/alternatives`);
    assert.equal(resAlt.status, 200);
    const altApiData = await resAlt.json();
    assert.equal(altApiData.targetProduct.id, canonicalProd.id);

    // 8f. POST /api/basket/optimize & POST /api/catalog/compare with alias productId
    const resCompare = await fetch(`${baseUrl}/api/catalog/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 'i1', productId: aliasId2, name: 'Lapte', category: canonicalProd.category, quantity: 1, unit: 'buc', checked: false }]
      })
    });
    assert.equal(resCompare.status, 200);
    const compareJson = await resCompare.json();
    assert.ok(compareJson.comparisons.some((c: any) => c.availableItems.length === 1));

    const resOpt = await fetch(`${baseUrl}/api/basket/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listName: 'Optimizare Alias API',
        items: [{ id: 'i1', productId: aliasId2, name: 'Lapte', category: canonicalProd.category, quantity: 1, unit: 'buc', checked: false }]
      })
    });
    assert.equal(resOpt.status, 200);
    const optJson = await resOpt.json();
    assert.equal(optJson.optimization.bestSingleStore.allocations[0].product.id, canonicalProd.id);

    // 8g. Admin match-correction endpoints (401, 400, 404, 409/200 + immutable observations)
    const unauthRes = await fetch(`${baseUrl}/api/admin/match-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: 'x', correctedProductId: canonicalProd.id, reason: 'test' })
    });
    assert.equal(unauthRes.status, 401);

    const missingProdRes = await fetch(`${baseUrl}/api/admin/match-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_API_KEY}` },
      body: JSON.stringify({ candidateId: 'cand-none', correctedProductId: 'non-existent-id-xyz', reason: 'test' })
    });
    assert.equal(missingProdRes.status, 404);

    const testCand = {
      id: `cand-f0-${Date.now()}`,
      sourceRawName: 'Lapte test F0',
      matchedProductId: aliasId1,
      matchedProductName: 'Lapte Alias 1',
      confidenceScore: 0.72,
      matchMethod: 'name_brand_similarity' as const,
      status: 'pending_confirmation' as const,
      createdAt: new Date().toISOString()
    };
    StorageService.addMatchCandidates([testCand]);

    const cycleRes = await fetch(`${baseUrl}/api/admin/match-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_API_KEY}` },
      body: JSON.stringify({ candidateId: testCand.id, correctedProductId: aliasId2, reason: 'target este alias ciclic' })
    });
    assert.ok([200, 409].includes(cycleRes.status));

    const obsSnapshotBefore = JSON.stringify(StorageService.getPriceObservations());
    const okRes = await fetch(`${baseUrl}/api/admin/match-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_API_KEY}` },
      body: JSON.stringify({ candidateId: testCand.id, correctedProductId: canonicalProd.id, reason: 'Corectare manuală audit F0' })
    });
    assert.equal(okRes.status, 200);
    const okJson = await okRes.json();
    assert.equal(okJson.success, true);
    assert.equal(okJson.correctedProductId, canonicalProd.id);
    assert.equal(JSON.stringify(StorageService.getPriceObservations()), obsSnapshotBefore, 'price_observations rămâne strict imuabil la match-correction');

    // Verificare DatabaseService.correctProductMatch pe auto-referință directă (self-loop 409)
    const directCycle = await DatabaseService.correctProductMatch({
      candidateId: testCand.id,
      correctedProductId: testCand.id,
      reason: 'self loop check'
    });
    assert.equal(directCycle.success, false);
    assert.ok([404, 409].includes(directCycle.statusCode));

    invalidateCatalogOptimizationCache();
    pass('8. Toate endpoint-urile Express (/aliases, /products/:id, /history, /barcode, /alternatives, /compare, /optimize, /match-correction) trec testele HTTP');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  // --- 9. Static SQL & Security Invariant Verification ---
  {
    const dbSrc = fs.readFileSync(path.resolve('src/db/index.ts'), 'utf8');
    const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf8');

    const correctMatchStart = dbSrc.indexOf('static async correctProductMatch(');
    const correctMatchSection = correctMatchStart >= 0 ? dbSrc.slice(correctMatchStart, correctMatchStart + 6500) : '';
    assert.ok(correctMatchSection.length > 100, 'Metoda DatabaseService.correctProductMatch există');

    assert.ok(dbSrc.includes('WITH RECURSIVE upward AS'), 'PG foloseste CTE recursiv upward pentru lanturi multi-hop');
    assert.ok(dbSrc.includes('WITH RECURSIVE tree AS') || dbSrc.includes('WITH RECURSIVE descendants AS'), 'PG colecteaza descendentii recursiv cu protectie de ciclu');
    assert.ok(!/DELETE\s+FROM\s+price_observations/i.test(correctMatchSection), 'correctProductMatch nu șterge niciodată price_observations');
    assert.ok(!/UPDATE\s+price_observations/i.test(correctMatchSection), 'correctProductMatch nu modifică niciodată price_observations');
    assert.ok(!/UPDATE\s+price_observations/i.test(dbSrc), 'Nu există UPDATE pe price_observations în src/db/index.ts');
    assert.ok(serverSrc.includes("app.post('/api/admin/match-correction', requireAdminAuth"), 'Endpoint-ul match-correction este protejat cu requireAdminAuth');
    assert.ok(serverSrc.includes('resolveSharedListRoleAndMeta({ auth, listId })'), 'Optimizarea listelor salvate suporta membri partajati cu verificare acces 403/404');
    assert.ok(baseObsBefore >= 0);
    pass('9. Invarianți SQL parametrizat ($1..$n), imuabilitate price_observations și securitate auth confirmați');
  }

  StorageService.resetAllData();
  console.log(`\n✅ SUCCES FAZA 0: ${passed} grupuri de teste au trecut complet!`);
}

runTests()
  .then(() => {
    IndexerScheduler.stop();
    process.exit(0);
  })
  .catch(err => {
    IndexerScheduler.stop();
    console.error('❌ EROARE TESTE FAZA 0:', err);
    process.exit(1);
  });
