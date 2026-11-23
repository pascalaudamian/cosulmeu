// tests/faza3b1-canonical-runtime-consistency.test.ts
// Suită completă de regresie FAZA 3B.1 — Canonical Identity Runtime Consistency
// Rulează STRICT în mod izolat (NODE_ENV=test, COSUL_MEU_ISOLATED_TEST=1), fără mutații pe baza de date live.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { DatabaseService } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import {
  buildCanonicalAliasIndex,
  collectProductIdsForCanonical,
  normalizeProductReferences,
  resolveCanonicalProduct,
  resolveCanonicalProductDetail,
  resolveCanonicalProductId,
  resolveProductReferenceMap
} from '../src/services/ProductIdentityService.ts';
import { ShoppingAssistantService } from '../src/services/ShoppingAssistantService.ts';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.ts';
import { BudgetService } from '../src/services/BudgetService.ts';
import { PriceAuditService } from '../src/services/PriceAuditService.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { PriceAlertService } from '../src/services/PriceAlertService.ts';
import { matchReceiptItemsToCatalog } from '../src/services/ReceiptParserEngine.ts';
import { PRODUCTS, STORES } from '../src/data/mockData.ts';
import type {
  PriceAlert,
  PriceObservation,
  Product,
  ProductOffer,
  Receipt,
  ShoppingList
} from '../src/types.ts';

let passed = 0;
function pass(label: string) {
  passed++;
  console.log(`  [PASS] ${label}`);
}

async function runTests() {
  console.log('====================================================================');
  console.log('FAZA 3B.1: TESTE CONSISTENȚĂ CANONICĂ ÎN RUNTIME & REGRESII');
  console.log('====================================================================\n');

  StorageService.resetAllData();

  const baseRoot: Product = {
    ...PRODUCTS[0],
    id: 'f3b1-root-lapte',
    name: 'Lapte UHT Test 1.5% 1L',
    brand: 'Napolact',
    category: 'Lactate și ouă',
    subcategory: 'Lapte',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941234000015',
    baseReferencePrice: 6.5,
    canonicalProductId: null
  };
  const alias1Hop: Product = {
    ...baseRoot,
    id: 'f3b1-alias-1hop',
    name: 'Lapte UHT Test 1.5% 1L (Alias Lidl)',
    barcode: '5941234000022',
    canonicalProductId: baseRoot.id
  };
  const alias2Hop: Product = {
    ...baseRoot,
    id: 'f3b1-alias-2hop',
    name: 'Lapte UHT Test 1.5% 1L (Alias Multi-Hop 2)',
    barcode: '5941234000039',
    canonicalProductId: alias1Hop.id
  };
  const alias3Hop: Product = {
    ...baseRoot,
    id: 'f3b1-alias-3hop',
    name: 'Lapte UHT Test 1.5% 1L (Alias Multi-Hop 3)',
    barcode: undefined,
    canonicalProductId: alias2Hop.id
  };

  // Produs rădăcină distinct din altă categorie (Produse de bază)
  const rootCafea: Product = {
    ...PRODUCTS[0],
    id: 'f3b1-root-cafea',
    name: 'Cafea Boabe Test Gold 500g',
    brand: 'Jacobs',
    category: 'Produse de bază',
    subcategory: 'Cafea',
    defaultUnit: 'buc',
    packageWeightOrVolume: 500,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    barcode: '5941234000091',
    baseReferencePrice: 32.0,
    canonicalProductId: null
  };
  const aliasCafea: Product = {
    ...rootCafea,
    id: 'f3b1-alias-cafea',
    name: 'Cafea Boabe Test Gold 500g Alias',
    barcode: undefined,
    canonicalProductId: rootCafea.id
  };

  // Produs fără observații istorice (pentru test de ștergere permisă)
  const disposableRoot: Product = {
    ...baseRoot,
    id: 'f3b1-disposable-root',
    name: 'Produs Temporar Fără Observații',
    barcode: undefined,
    canonicalProductId: null
  };
  const disposableAlias: Product = {
    ...disposableRoot,
    id: 'f3b1-disposable-alias',
    name: 'Alias Temporar Fără Observații',
    canonicalProductId: disposableRoot.id
  };

  // Noduri cu ciclu invalid (A -> B -> A și self-loop X -> X)
  const cycA: Product = {
    ...baseRoot,
    id: 'f3b1-cyc-a',
    name: 'Produs Ciclu A',
    barcode: undefined,
    canonicalProductId: 'f3b1-cyc-b'
  };
  const cycB: Product = {
    ...baseRoot,
    id: 'f3b1-cyc-b',
    name: 'Produs Ciclu B',
    barcode: undefined,
    canonicalProductId: 'f3b1-cyc-a'
  };
  const selfLoop: Product = {
    ...baseRoot,
    id: 'f3b1-self-loop',
    name: 'Produs Auto-Referință',
    barcode: undefined,
    canonicalProductId: 'f3b1-self-loop'
  };

  for (const p of [
    baseRoot,
    alias1Hop,
    alias2Hop,
    alias3Hop,
    rootCafea,
    aliasCafea,
    disposableRoot,
    disposableAlias,
    cycA,
    cycB,
    selfLoop
  ]) {
    StorageService.addCustomProduct(p);
  }

  // Oferte atașate rădăcinii, alias 1-hop, alias 3-hop și unui nod ciclic
  const offersFixture: ProductOffer[] = [
    {
      id: 'f3b1-off-root-lidl',
      productId: baseRoot.id,
      storeId: 'lidl',
      price: 6.49,
      normalPrice: 7.49,
      promoPrice: 6.49,
      unitPrice: 6.49,
      unitPriceMeasure: 'lei/l',
      isPromo: true,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified',
      lastChecked: '2026-11-22T10:00:00Z',
      lastVerifiedAt: '2026-11-22',
      observationDate: '2026-11-22'
    },
    {
      id: 'f3b1-off-alias1-kaufland',
      productId: alias1Hop.id,
      storeId: 'kaufland',
      price: 5.99,
      normalPrice: 6.99,
      promoPrice: 5.99,
      unitPrice: 5.99,
      unitPriceMeasure: 'lei/l',
      isPromo: true,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified',
      lastChecked: '2026-11-22T12:00:00Z',
      lastVerifiedAt: '2026-11-22',
      observationDate: '2026-11-22'
    },
    {
      id: 'f3b1-off-alias3-carrefour',
      productId: alias3Hop.id,
      storeId: 'carrefour',
      price: 5.79,
      normalPrice: 6.89,
      promoPrice: 5.79,
      unitPrice: 5.79,
      unitPriceMeasure: 'lei/l',
      isPromo: true,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified',
      lastChecked: '2026-11-22T14:00:00Z',
      lastVerifiedAt: '2026-11-22',
      observationDate: '2026-11-22'
    },
    {
      id: 'f3b1-off-cafea-alias',
      productId: aliasCafea.id,
      storeId: 'mega-image',
      price: 29.99,
      normalPrice: 34.99,
      promoPrice: 29.99,
      unitPrice: 59.98,
      unitPriceMeasure: 'lei/kg',
      isPromo: true,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified',
      lastChecked: '2026-11-22T09:00:00Z',
      lastVerifiedAt: '2026-11-22',
      observationDate: '2026-11-22'
    },
    {
      id: 'f3b1-off-cyc',
      productId: cycA.id,
      storeId: 'penny',
      price: 4.5,
      unitPrice: 4.5,
      unitPriceMeasure: 'lei/l',
      isPromo: false,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified',
      lastChecked: '2026-11-22T08:00:00Z',
      lastVerifiedAt: '2026-11-22',
      observationDate: '2026-11-22'
    }
  ];
  StorageService.saveProductOffers(offersFixture);

  // Observații istorice append-only legate inclusiv de alias
  const obsFixture: PriceObservation[] = [
    {
      id: 'f3b1-obs-1',
      productId: baseRoot.id,
      storeId: 'lidl',
      price: 6.99,
      date: '2026-11-10',
      source: 'official_feed'
    },
    {
      id: 'f3b1-obs-2',
      productId: alias3Hop.id,
      storeId: 'carrefour',
      price: 5.79,
      date: '2026-11-22',
      source: 'official_feed'
    }
  ];
  StorageService.addPriceObservations(obsFixture);

  // =========================================================================
  // 1, 2, 3, 4: ProductIdentityService (root, 1-hop, multi-hop, ciclu invalid)
  // =========================================================================
  {
    const allProds = StorageService.getAllProducts();
    const refMap = resolveProductReferenceMap(allProds);

    assert.equal(refMap.get(baseRoot.id)?.id, baseRoot.id, 'Root fără alias se rezolvă la sine');
    assert.equal(refMap.get(alias1Hop.id)?.id, baseRoot.id, 'Alias 1-hop se rezolvă la root');
    assert.equal(refMap.get(alias2Hop.id)?.id, baseRoot.id, 'Alias 2-hop se rezolvă la root');
    assert.equal(refMap.get(alias3Hop.id)?.id, baseRoot.id, 'Alias 3-hop se rezolvă la root');
    assert.equal(refMap.has(cycA.id), false, 'Ciclu A->B->A exclus din refMap');
    assert.equal(refMap.has(selfLoop.id), false, 'Auto-referință exclusă din refMap');

    assert.equal(resolveCanonicalProduct(alias3Hop.id, allProds)?.id, baseRoot.id);
    assert.equal(resolveCanonicalProduct(cycA.id, allProds), undefined);

    const cycDetail = resolveCanonicalProductDetail(cycA.id, allProds);
    assert.equal(cycDetail.cycleDetected, true);
    assert.equal(cycDetail.found, false);

    const normRes = normalizeProductReferences(
      [
        { id: 'r1', productId: alias3Hop.id },
        { id: 'r2', productId: cycA.id },
        { id: 'r3', productId: baseRoot.id }
      ],
      allProds,
      { preserveOriginalField: 'originalProductId', preserveInProvenanceKey: 'originalProductId' }
    );
    assert.equal(normRes[0].productId, baseRoot.id);
    assert.equal((normRes[0] as any).originalProductId, alias3Hop.id);
    assert.equal((normRes[0] as any).provenance.originalProductId, alias3Hop.id);
    assert.equal(normRes[1].productId, cycA.id, 'Referința ciclică nu este suprascrisă fals');
    assert.equal(normRes[2].productId, baseRoot.id);

    pass('1-4. ProductIdentityService: root, 1-hop, multi-hop (3 hopuri) și respingere cicluri');
  }

  // =========================================================================
  // 5 & 6: BasketOptimizerService & ShoppingAssistantService (oferte alias + liste alias + fără coliziune)
  // =========================================================================
  {
    const rawProducts = StorageService.getAllProducts();
    const aliasMap = await DatabaseService.getProductAliasMap();
    const canonicalProducts = await DatabaseService.getProducts();
    const canonicalOffers = await DatabaseService.getOffers();

    // Match direct pe ID alias 3-hop
    const mAliasId = BasketOptimizerService.matchItemToProduct(
      { id: 'li-1', name: 'Lapte UHT Test', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false, productId: alias3Hop.id },
      rawProducts,
      aliasMap
    );
    assert.equal(mAliasId.status, 'matched');
    assert.equal(mAliasId.product?.id, baseRoot.id, 'BasketOptimizer rezolvă productId alias multi-hop la root');
    assert.equal(mAliasId.confidence, 'exact_id');

    // Match pe EAN aparținând aliasului 2-hop
    const mAliasEan = BasketOptimizerService.matchItemToProduct(
      { id: 'li-2', name: 'Produs scanat EAN alias', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false, barcode: alias2Hop.barcode },
      rawProducts,
      aliasMap
    );
    assert.equal(mAliasEan.status, 'matched');
    assert.equal(mAliasEan.product?.id, baseRoot.id, 'BasketOptimizer promovează EAN de pe alias la root canonic');
    assert.equal(mAliasEan.confidence, 'exact_ean');

    // Respingere sigură pentru ID ciclic (nu trebuie să dea match fals)
    const mCycle = BasketOptimizerService.matchItemToProduct(
      { id: 'li-cyc', name: 'Produs Ciclu necunoscut xyz123', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false, productId: cycA.id },
      rawProducts,
      aliasMap
    );
    assert.equal(mCycle.status, 'unconfident');
    assert.equal(mCycle.product, undefined, 'BasketOptimizer nu acceptă productId aflat în ciclu canonic');

    // Fără coliziune de nume între root și alias (root + alias au nume similar, dar trebuie tratate ca un singur produs canonic)
    const mUniqueName = BasketOptimizerService.matchItemToProduct(
      { id: 'li-3', name: 'Cafea Boabe Test Gold 500g', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      rawProducts,
      aliasMap
    );
    assert.equal(mUniqueName.product?.id, rootCafea.id, 'Fără coliziune artificială între rootCafea și aliasCafea');

    // ShoppingAssistantService cu oferte atașate aliasurilor și item de listă pe alias
    const plan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: 'Fă planul pentru lista curentă',
      explicitIntent: 'optimize_list',
      activeList: {
        id: 'list-f3b1',
        name: 'Lista Alias Test',
        createdAt: '2026-11-22T10:00:00Z',
        updatedAt: '2026-11-22T10:00:00Z',
        items: [
          {
            id: 'sli-1',
            productId: alias3Hop.id,
            name: 'Lapte 1.5%',
            category: 'Lactate și ouă',
            quantity: 2,
            unit: 'l',
            checked: false
          },
          {
            id: 'sli-2',
            productId: aliasCafea.id,
            name: 'Cafea Boabe',
            category: 'Produse de bază',
            quantity: 1,
            unit: 'buc',
            checked: false
          }
        ]
      },
      selectedProductId: alias1Hop.id,
      allProducts: rawProducts,
      allOffers: offersFixture,
      allStores: STORES,
      aliasMap
    });
    assert.ok(plan.items.length >= 2, 'ShoppingAssistant planifică produsele din listă chiar dacă referă aliasuri');
    const laptePlan = plan.items.find(i => i.productId === baseRoot.id);
    assert.ok(laptePlan, 'ShoppingAssistant normalizează productId al articolului la root canonic');
    assert.equal(laptePlan!.price, 11.58, 'ShoppingAssistant preia cea mai ieftină ofertă (2 x 5.79 = 11.58 RON de pe alias3Hop -> Carrefour)');
    assert.equal(laptePlan!.unitPrice, 5.79);

    const optRes = BasketOptimizerService.optimize({
      list: { id: 'list-opt', name: 'Optimizare Alias' },
      items: [
        {
          id: 'oi-1',
          productId: alias3Hop.id,
          name: 'Lapte UHT',
          category: 'Lactate și ouă',
          quantity: 1,
          unit: 'l',
          checked: false
        }
      ],
      offers: canonicalOffers,
      stores: STORES,
      products: canonicalProducts,
      aliasMap
    });
    assert.equal(optRes.bestSingleStore?.store.id, 'carrefour');
    assert.equal(optRes.bestSingleStore?.totalPrice, 5.79);

    pass('5-6. ShoppingAssistantService & BasketOptimizerService: oferte alias, liste alias, fără coliziuni root/alias');
  }

  // =========================================================================
  // 7 & 8: Receipt matching, local provenance & BudgetService (lookup categorie prin alias)
  // =========================================================================
  {
    const receiptWithAliases: Receipt = {
      id: 'rcpt-f3b1-1',
      storeId: 'carrefour',
      storeName: 'Carrefour',
      date: '2026-11-20',
      items: [
        {
          id: 'ri-1',
          rawName: 'LAPTE NAPOLACT 1.5%',
          matchedProductId: alias3Hop.id,
          quantity: 2,
          unit: 'l',
          unitPrice: 5.79,
          totalPrice: 11.58,
          discount: 0,
          confidence: 'high',
          matchStatus: 'matched'
        },
        {
          id: 'ri-2',
          rawName: 'CAFEA JACOBS GOLD',
          matchedProductId: aliasCafea.id,
          quantity: 1,
          unit: 'buc',
          unitPrice: 29.99,
          totalPrice: 29.99,
          discount: 0,
          confidence: 'high',
          matchStatus: 'matched'
        },
        {
          id: 'ri-3',
          rawName: 'ARTICOL CICLU INVALID',
          matchedProductId: cycA.id,
          quantity: 1,
          unit: 'buc',
          unitPrice: 10,
          totalPrice: 10,
          discount: 0,
          confidence: 'low',
          matchStatus: 'matched'
        }
      ],
      subtotal: 51.57,
      discountTotal: 0,
      total: 51.57,
      currency: 'RON',
      createdAt: '2026-11-20T12:00:00Z',
      verifiedStatus: 'confirmed'
    };

    const aliasMap = await DatabaseService.getProductAliasMap();
    const canonicalCatalog = await DatabaseService.getProducts();
    const summary = BudgetService.calculateSummary({
      receipts: [receiptWithAliases],
      settings: { monthlyBudget: 500, weeklyBudget: 150, alertThresholdPct: 80 },
      catalogProducts: canonicalCatalog,
      aliasMap
    });

    assert.equal(summary.monthlySpent, 51.57, 'BudgetService nu alterează totalul bonului');
    const lactateCat = summary.categoryBreakdown.find(c => c.category === 'Lactate și ouă');
    const bacanieCat = summary.categoryBreakdown.find(c => c.category === 'Produse de bază');
    assert.ok(lactateCat && lactateCat.amount >= 11.58, 'BudgetService rezolvă categoria prin alias multi-hop');
    assert.ok(bacanieCat && bacanieCat.amount >= 29.99, 'BudgetService rezolvă categoria prin alias 1-hop');

    // Testare StorageService.normalizeLocalProductReferences cu păstrare provenance
    StorageService.saveReceipts([receiptWithAliases]);
    const normReport = StorageService.normalizeLocalProductReferences(StorageService.getAllProducts());
    assert.ok(normReport.upgradedReceiptItems >= 1);
    const savedRcpt = StorageService.getReceipts().find(r => r.id === receiptWithAliases.id)!;
    assert.equal(savedRcpt.items[0].matchedProductId, baseRoot.id);
    assert.equal(savedRcpt.items[0].provenance?.originalMatchedProductId, alias3Hop.id);
    assert.equal(savedRcpt.items[0].totalPrice, 11.58);

    // Matching bon către catalog cu produs alias
    const matchedItems = matchReceiptItemsToCatalog(
      [
        {
          id: 'mr-1',
          rawName: 'Cafea Boabe Test Gold 500g',
          matchedProductId: aliasCafea.id,
          quantity: 1,
          unit: 'buc',
          unitPrice: 29.99,
          totalPrice: 29.99,
          discount: 0,
          confidence: 'medium',
          matchStatus: 'unmatched'
        }
      ],
      StorageService.getAllProducts(),
      aliasMap
    );
    assert.equal(matchedItems[0].matchedProductId, rootCafea.id);

    pass('7-8. Bonuri & BudgetService: rezolvare categorie multi-hop, provenance păstrată și totaluri nealterate');
  }

  // =========================================================================
  // 9: PriceAuditService cu alias multi-hop, staging provenance & blocare cicluri
  // =========================================================================
  {
    const docId = 'f3b1-doc-1';
    StorageService.saveCatalogDocuments([
      {
        id: docId,
        sourceId: 'src-carrefour',
        retailerId: 'carrefour',
        title: 'Catalog Test Carrefour',
        documentUrl: 'https://example.com/catalog.pdf',
        status: 'parsed',
        fetchedAt: '2026-11-22T08:00:00Z',
        createdAt: '2026-11-22T08:00:00Z'
      } as any
    ]);
    StorageService.saveCatalogExtractedOffers([
      {
        id: 'f3b1-stg-1',
        runId: 'run-1',
        documentId: docId,
        retailerId: 'carrefour',
        retailerSku: 'SKU-ORIGIN-CARREFOUR-01',
        rawTitle: 'Lapte UHT Test 1.5% 1L',
        normalPrice: 6.89,
        promoPrice: 5.79,
        effectivePrice: 5.79,
        currency: 'RON',
        isPromo: true,
        matchedProductId: alias3Hop.id,
        matchConfidence: 0.99,
        matchMethod: 'gtin_exact',
        stagingStatus: 'PUBLISHED',
        createdAt: '2026-11-22T08:00:00Z',
        updatedAt: '2026-11-22T08:00:00Z'
      } as any
    ]);

    const audit = await PriceAuditService.getPriceAuditData({ category: 'all', limit: 50 });
    const aliasAuditItem = audit.items.find(i => i.offerId === 'f3b1-off-alias3-carrefour');
    assert.ok(aliasAuditItem, 'PriceAuditService include oferta atașată aliasului 3-hop');
    assert.equal(aliasAuditItem!.productId, baseRoot.id, 'PriceAuditService rezolvă productId multi-hop la rădăcină');
    assert.equal(aliasAuditItem!.originalProductId, alias3Hop.id, 'PriceAuditService păstrează originalProductId');
    assert.equal(aliasAuditItem!.sourceDocumentId, docId, 'PriceAuditService corelează documentul staging prin echivalent canonic');

    // Remediere ofertă alias: actualizează baseReferencePrice pe ROOT, nu pe alias, și nu alterează matchedProductId/retailerSku în staging
    const remRes = await PriceAuditService.remediateOffers({
      items: [
        { offerId: 'f3b1-off-alias3-carrefour', action: 'fix_price', newPrice: 5.89 },
        { offerId: 'f3b1-off-cyc', action: 'fix_price', newPrice: 4.99 }
      ]
    });
    assert.equal(remRes.affectedOffersCount, 1, 'Oferta validă remediată, oferta ciclică blocată');
    assert.ok(remRes.errors.some(e => e.includes('ciclic')), 'PriceAuditService raportează explicit eroarea pentru ciclul invalid');

    const rootAfter = StorageService.getAllProducts().find(p => p.id === baseRoot.id)!;
    const stgAfter = StorageService.getCatalogExtractedOffers().find(s => s.id === 'f3b1-stg-1')!;
    assert.equal(rootAfter.baseReferencePrice, 5.89, 'baseReferencePrice actualizat pe produsul canonic rădăcină');
    assert.equal(stgAfter.matchedProductId, alias3Hop.id, 'matchedProductId din staging nu a fost suprascris distructiv');
    assert.equal(stgAfter.retailerSku, 'SKU-ORIGIN-CARREFOUR-01', 'retailerSku din staging nu a fost alterat');

    pass('9. PriceAuditService: rezolvare multi-hop, provenance staging intangibilă și blocare cicluri');
  }

  // =========================================================================
  // 10 & 13: DatabaseService (getProducts, getOffers, getPublicOffersDetailed, getPriceChangesDetailed, getOperationalMetrics)
  // =========================================================================
  {
    const canonicalProducts = await DatabaseService.getProducts();
    assert.equal(canonicalProducts.some(p => p.id === baseRoot.id), true);
    assert.equal(canonicalProducts.some(p => p.id === alias1Hop.id), false, 'getProducts() exclude alias 1-hop');
    assert.equal(canonicalProducts.some(p => p.id === alias3Hop.id), false, 'getProducts() exclude alias 3-hop');
    assert.equal(canonicalProducts.some(p => p.id === cycA.id), false, 'getProducts() exclude noduri ciclice');
    assert.equal(canonicalProducts.some(p => p.id === selfLoop.id), false, 'getProducts() exclude auto-referințe');

    // StorageService.getAllProducts() păstrează contractul existent (include rădăcini + aliasuri)
    const allStored = StorageService.getAllProducts();
    assert.equal(allStored.some(p => p.id === alias3Hop.id), true, 'StorageService.getAllProducts() rămâne complet');

    const dbOffers = await DatabaseService.getOffers();
    assert.equal(dbOffers.some(o => o.id === 'f3b1-off-alias3-carrefour' && o.productId === baseRoot.id), true, 'getOffers() normalizează alias 3-hop');
    assert.equal(dbOffers.some(o => o.id === 'f3b1-off-cyc'), false, 'getOffers() elimină oferte pe cicluri invalide');

    const pubOffers = await DatabaseService.getPublicOffersDetailed({ limit: 50 });
    const lapteCarrefour = pubOffers.offers.find(o => o.productId === baseRoot.id && o.storeId === 'carrefour');
    assert.ok(lapteCarrefour, 'getPublicOffersDetailed agregă oferta alias 3-hop sub rădăcina canonică');
    assert.equal(lapteCarrefour!.originalProductId, alias3Hop.id);

    const priceChanges = await DatabaseService.getPriceChangesDetailed({ limit: 50 });
    const lapteChange = priceChanges.changes.find(c => c.productId === baseRoot.id && c.storeId === 'carrefour');
    assert.ok(lapteChange, 'getPriceChangesDetailed agregă observațiile de pe alias sub produsul canonic');
    assert.equal(lapteChange!.originalProductId, alias3Hop.id);

    const detailed = await DatabaseService.getProductsDetailed({ search: 'Lapte UHT Test', limit: 20, offset: 0 });
    assert.equal(detailed.products.length, 1, 'getProductsDetailed nu afișează duplicate pentru aliasuri');
    assert.equal(detailed.products[0].id, baseRoot.id);
    assert.equal(detailed.products[0].offersCount, 3, 'getProductsDetailed agregă toate cele 3 oferte (root + alias1 + alias3)');

    const metrics = await DatabaseService.getOperationalMetrics();
    assert.equal(metrics.kpis.distinctProducts.value, canonicalProducts.length, 'getOperationalMetrics numără doar rădăcinile canonice');

    pass('10 & 13. DatabaseService în COSUL_MEU_ISOLATED_TEST=1: parity completă pentru produse, oferte, modificări preț și metrici');
  }

  // =========================================================================
  // 11: Staging candidate cu alias & respingere ciclu (validateStagingOfferCandidate)
  // =========================================================================
  {
    const allStored = StorageService.getAllProducts();
    const stagingAliasIndex = buildCanonicalAliasIndex(allStored);
    const canonicalOnly = allStored.filter(p => !p.canonicalProductId && resolveCanonicalProductId(p.id, stagingAliasIndex) === p.id);
    const canonicalMap = new Map(canonicalOnly.map(p => [p.id, p]));

    const resAliasTarget = DatabaseService.validateStagingOfferCandidate({
      offer: {
        id: 'stg-val-1',
        retailerId: 'carrefour',
        rawTitle: 'Lapte UHT Test 1.5% 1L',
        retailerSku: 'SKU-KEEP-123',
        normalPrice: 6.5,
        effectivePrice: 5.9,
        packageQuantity: 1,
        packageUnit: 'l',
        matchedProductId: alias3Hop.id,
        stagingStatus: 'NEEDS_REVIEW'
      },
      validStoreIds: new Set(['carrefour']),
      validDocumentIds: new Set(),
      productsById: canonicalMap,
      allProducts: canonicalOnly,
      batchSignatures: new Set(),
      existingApprovedSignatures: new Map(),
      aliasIndex: stagingAliasIndex,
      todayStr: '2026-11-22'
    });
    assert.equal(resAliasTarget.valid, true, 'Staging candidate cu alias multi-hop trece validarea');
    assert.equal(resAliasTarget.resolvedProductId, baseRoot.id, 'Staging candidate promovează alias 3-hop la rădăcina canonică');

    const resCycleTarget = DatabaseService.validateStagingOfferCandidate({
      offer: {
        id: 'stg-val-2',
        retailerId: 'carrefour',
        rawTitle: 'Produs Ciclic',
        normalPrice: 6.5,
        effectivePrice: 5.9,
        matchedProductId: cycA.id,
        stagingStatus: 'NEEDS_REVIEW'
      },
      validStoreIds: new Set(['carrefour']),
      validDocumentIds: new Set(),
      productsById: canonicalMap,
      allProducts: canonicalOnly,
      batchSignatures: new Set(),
      existingApprovedSignatures: new Map(),
      aliasIndex: stagingAliasIndex,
      todayStr: '2026-11-22'
    });
    assert.equal(resCycleTarget.valid, false, 'Staging candidate cu țintă ciclică este respins');
    assert.ok(resCycleTarget.errors.some(e => e.includes('ciclic')));

    pass('11. Staging candidate: promovare alias la root, excludere alias din pool și respingere ciclu');
  }

  // =========================================================================
  // 12: Regresii pentru produse rădăcină (PriceComparisonService & PriceAlertService)
  // =========================================================================
  {
    const canonicalProducts = await DatabaseService.getProducts();
    const canonicalOffers = await DatabaseService.getOffers();
    const cmp = PriceComparisonService.getProductComparisonDetails(
      baseRoot.id,
      baseRoot,
      canonicalOffers.filter(o => o.productId === baseRoot.id),
      STORES
    );
    assert.ok(cmp && cmp.offers.length === 3, 'PriceComparisonService compară cele 3 oferte ale produsului canonic');
    assert.equal(cmp!.lowestPrice, 5.89);

    const alert: PriceAlert = {
      id: 'alert-f3b1',
      productId: baseRoot.id,
      productName: baseRoot.name,
      targetPrice: 6.0,
      currentLowestPrice: 6.49,
      createdAt: '2026-11-20',
      isActive: true,
      alertType: 'below_target'
    };
    const evalRes = PriceAlertService.evaluateAlerts({
      alerts: [alert],
      offers: StorageService.getProductOffers(),
      products: StorageService.getAllProducts(),
      observations: StorageService.getPriceObservations(),
      stores: STORES,
      existingNotifications: [],
      aliasMap: await DatabaseService.getProductAliasMap()
    });
    assert.equal(evalRes.newNotifications.length, 1);
    assert.equal(evalRes.newNotifications[0].productId, baseRoot.id);
    assert.equal(evalRes.newNotifications[0].observedPrice, 5.89);

    pass('12. Regresii pentru produse rădăcină (PriceComparisonService & PriceAlertService)');
  }

  // =========================================================================
  // 14: Protecție deleteProducts + price_observations + endpoint-uri HTTP server.ts
  // =========================================================================
  {
    const obsCountBefore = StorageService.getPriceObservations().length;

    // 14a. Blocare ștergere root care are observații istorice pe un alias descendent (alias3Hop are f3b1-obs-2)
    const blockedAliasDelete = await DatabaseService.deleteProducts([alias3Hop.id]);
    assert.equal(blockedAliasDelete.deletedCount, 0, 'Aliasul cu observații istorice nu este șters');
    assert.equal(blockedAliasDelete.blockedCount, 1);
    assert.deepEqual(blockedAliasDelete.blockedIds, [alias3Hop.id]);
    assert.equal(StorageService.getPriceObservations().length, obsCountBefore, 'price_observations rămâne nemodificat');

    // 14b. Ștergerea rădăcinii cu observații pe alias descendent trebuie de asemenea blocată
    const blockedRootDelete = await DatabaseService.deleteProducts([baseRoot.id]);
    assert.equal(blockedRootDelete.deletedCount, 0, 'Root-ul cu observații pe descendent este protejat la ștergere');
    assert.equal(blockedRootDelete.blockedCount, 1);
    assert.equal(StorageService.getPriceObservations().length, obsCountBefore, 'price_observations intangibil');

    // 14c. Ștergere permisă pentru produs fără observații istorice (șterge root + alias descendent)
    const okDelete = await DatabaseService.deleteProducts([disposableRoot.id]);
    assert.ok(okDelete.deletedCount >= 1, 'Șterge curat produsul fără observații');
    assert.equal(okDelete.blockedCount || 0, 0);
    const remainingAfterCleanDelete = StorageService.getAllProducts();
    assert.equal(remainingAfterCleanDelete.some(p => p.id === disposableRoot.id), false, 'Root-ul eligibil a fost șters');
    assert.equal(remainingAfterCleanDelete.some(p => p.id === disposableAlias.id), false, 'Aliasul descendent eligibil a fost șters');
    assert.equal(StorageService.getPriceObservations().length, obsCountBefore, 'price_observations intangibil după delete curat');

    // 14d. Verificări statice SQL în src/db/index.ts și src/services/StorageService.ts
    const dbSrc = fs.readFileSync(path.resolve('src/db/index.ts'), 'utf8');
    const stSrc = fs.readFileSync(path.resolve('src/services/StorageService.ts'), 'utf8');
    assert.equal(/DELETE\s+FROM\s+price_observations/i.test(dbSrc), false, 'Zero DELETE FROM price_observations în src/db/index.ts');
    assert.equal(/UPDATE\s+price_observations/i.test(dbSrc), false, 'Zero UPDATE price_observations în src/db/index.ts');
    assert.equal(/DISABLE\s+TRIGGER/i.test(dbSrc), false, 'Zero DISABLE TRIGGER în src/db/index.ts');
    assert.equal(/KEYS\.PRICE_OBSERVATIONS/.test(stSrc.slice(stSrc.indexOf('static deleteProducts'), stSrc.indexOf('static deleteProduct('))), false, 'StorageService.deleteProducts nu mai atinge KEYS.PRICE_OBSERVATIONS');

    // 14e. Verificare endpoint-uri server.ts reale în isolated mode
    const { app, ADMIN_API_KEY } = await import('../server.ts');
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = srv.address() as any;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const prodRes = await (await fetch(`${baseUrl}/api/products?search=${encodeURIComponent('Lapte UHT Test')}`)).json();
      assert.equal(prodRes.success, true);
      assert.equal(prodRes.products.length, 1, '/api/products returnează doar rădăcina canonică');
      assert.equal(prodRes.products[0].id, baseRoot.id);
      assert.equal(prodRes.products[0].offersCount, 3);
      assert.equal(prodRes.products[0].minPrice, 5.89);

      const catRes = await (await fetch(`${baseUrl}/api/categories`)).json();
      assert.equal(catRes.success, true);
      const lactateInfo = catRes.categories.find((c: any) => c.name === 'Lactate și ouă');
      assert.ok(lactateInfo && lactateInfo.availableWithOffersCount >= 1);

      // Report error pe alias trebuie rezolvat la root canonic
      const errRepRes = await fetch(`${baseUrl}/api/products/report-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: alias3Hop.id,
          productName: alias3Hop.name,
          storeId: 'carrefour',
          errorType: 'price_mismatch',
          reportedPrice: 6.1,
          details: 'Test raportare pe alias 3-hop'
        })
      });
      const errRepJson = await errRepRes.json();
      assert.equal(errRepRes.status, 200);
      assert.equal(errRepJson.canonicalProductId, baseRoot.id);
      const latestRep = StorageService.getUserErrorReports().slice(-1)[0];
      assert.equal(latestRep.productId, baseRoot.id);
      assert.equal(latestRep.originalProductId, alias3Hop.id);

      // Report error pe ciclu invalid respins cu 400
      const cycRepRes = await fetch(`${baseUrl}/api/products/report-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: cycA.id,
          productName: cycA.name,
          errorType: 'wrong_product',
          details: 'Test ciclu invalid'
        })
      });
      assert.equal(cycRepRes.status, 400);

      // DELETE admin pe produs cu price_observations protejate -> 409 Conflict
      const delProtectedRes = await fetch(`${baseUrl}/api/admin/products/${encodeURIComponent(baseRoot.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.equal(delProtectedRes.status, 409, 'DELETE /api/admin/products/:id returnează 409 când există price_observations');
      const delProtectedJson = await delProtectedRes.json();
      assert.equal(delProtectedJson.success, false);
      assert.equal(delProtectedJson.blockedCount, 1);

      // Bulk delete pe alias protejat -> 409 Conflict
      const bulkBlockedRes = await fetch(`${baseUrl}/api/admin/products/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_API_KEY}` },
        body: JSON.stringify({ ids: [alias3Hop.id] })
      });
      assert.equal(bulkBlockedRes.status, 409);
    } finally {
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }

    pass('14. Protecție deleteProducts + price_observations + endpoint-uri server.ts verificate complet');
  }

  StorageService.resetAllData();
  console.log(`\nTOATE CELE ${passed} GRUPURI DE TESTE FAZA 3B.1 AU TRECUT CU SUCCES!`);
}

runTests().catch(err => {
  console.error('EROARE ÎN TESTELE FAZA 3B.1:', err);
  process.exit(1);
});
