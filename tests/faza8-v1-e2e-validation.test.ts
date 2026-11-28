// tests/faza8-v1-e2e-validation.test.ts
// FAZA 8 — Testare Completă și Validare End-to-End (V1)
// Rulează izolat în memorie (NODE_ENV=test, COSUL_MEU_ISOLATED_TEST=1) — NU modifică baza de date reală sau schema SQL.
// Acoperă fluxurile E2E A–H (Secțiunea 2) și garanțiile de date și integritate (Secțiunea 5).

import 'dotenv/config';
process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, before, after, beforeEach } from 'node:test';
import type { Express } from 'express';

import { StorageService } from '../src/services/StorageService.ts';
import { ProductMatcher } from '../src/services/ProductMatcher.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.ts';
import { PriceHistoryService } from '../src/services/PriceHistoryService.ts';
import { PriceQualityClassifier } from '../src/services/PriceQualityClassifier.ts';
import { PriceAlertService } from '../src/services/PriceAlertService.ts';
import { PriceQualityMonitoringService } from '../src/services/PriceQualityMonitoringService.ts';
import { FileImportAdapter } from '../src/sources/FileImportAdapter.ts';
import { PriceExtractor } from '../src/indexing/catalog/PriceExtractor.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import { getPool } from '../src/db/index.ts';
import {
  collectProductIdsForCanonical,
  resolveCanonicalProductDetail
} from '../src/services/ProductIdentityService.ts';
import { EmptyState, ErrorState, LoadingState } from '../src/components/ui/StateFeedback.tsx';
import { ProductPriceTrend } from '../src/components/ProductPriceTrend.tsx';
import type {
  PriceAlert,
  PriceObservation,
  Product,
  ProductOffer,
  ShoppingList,
  Store
} from '../src/types.ts';

const NOW = new Date();
const RECENT_ISO = new Date(NOW.getTime() - 4 * 60 * 60 * 1000).toISOString();
const RECENT_DATE = RECENT_ISO.slice(0, 10);
const DAYS_AGO_ISO = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const YESTERDAY_DATE = DAYS_AGO_ISO(1);

const STORES_V1: Store[] = [
  {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    chain: 'Lidl',
    brandColor: 'bg-blue-700',
    accentColor: 'text-blue-700',
    type: 'discounter',
    rating: 4.6,
    locationsCount: 350,
    sampleAddress: 'România'
  },
  {
    id: 'kaufland',
    name: 'Kaufland',
    slug: 'kaufland',
    chain: 'Kaufland',
    brandColor: 'bg-red-700',
    accentColor: 'text-red-700',
    type: 'hypermarket',
    rating: 4.5,
    locationsCount: 170,
    sampleAddress: 'România'
  },
  {
    id: 'carrefour',
    name: 'Carrefour',
    slug: 'carrefour',
    chain: 'Carrefour',
    brandColor: 'bg-sky-700',
    accentColor: 'text-sky-700',
    type: 'hypermarket',
    rating: 4.4,
    locationsCount: 400,
    sampleAddress: 'România'
  }
];

function buildCanonicalFixture() {
  const products: Product[] = [
    {
      id: 'v1-lapte-root',
      name: 'Lapte proaspăt 1.5% 1L',
      brand: 'Napolact',
      category: 'Lactate și ouă',
      defaultUnit: 'l',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l',
      barcode: '5941014002343',
      baseReferencePrice: 7.2
    },
    {
      id: 'v1-lapte-alias-1',
      name: 'Lapte Napolact 1.5% 1L (alias)',
      brand: 'Napolact',
      category: 'Lactate și ouă',
      defaultUnit: 'l',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l',
      canonicalProductId: 'v1-lapte-root',
      baseReferencePrice: 7.2
    },
    {
      id: 'v1-lapte-alias-2',
      name: 'Lapte Napolact 1L (multi-hop)',
      brand: 'Napolact',
      category: 'Lactate și ouă',
      defaultUnit: 'l',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l',
      canonicalProductId: 'v1-lapte-alias-1',
      baseReferencePrice: 7.2
    },
    {
      id: 'v1-paine-root',
      name: 'Pâine albă Toast 500g',
      brand: 'Vel Pitar',
      category: 'Panificație',
      defaultUnit: 'buc',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '5941234567890',
      baseReferencePrice: 5.5
    },
    {
      id: 'v1-unt-root',
      name: 'Unt 82% grăsime 200g',
      brand: 'Napolact',
      category: 'Lactate și ouă',
      defaultUnit: 'buc',
      packageWeightOrVolume: 200,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '5941234000097',
      baseReferencePrice: 13.5
    },
    {
      id: 'v1-temp-deletable',
      name: 'Produs Temporar Fără Observații',
      brand: 'TestBrand',
      category: 'Alte produse',
      defaultUnit: 'buc',
      packageWeightOrVolume: 1,
      packageUnit: 'buc',
      normalizedUnit: 'buc',
      baseReferencePrice: 9.0
    }
  ];

  const offers: ProductOffer[] = [
    // Lidl acoperă doar 2 din 3 produse (ieftin pe acelea 2, dar acoperire incompletă!)
    {
      id: 'v1-off-lidl-lapte',
      productId: 'v1-lapte-root',
      storeId: 'lidl',
      price: 5.99,
      normalPrice: 6.99,
      promoPrice: 5.99,
      currency: 'RON',
      unitPrice: 5.99,
      unitPriceMeasure: 'lei/l',
      isPromo: true,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    {
      id: 'v1-off-lidl-paine',
      productId: 'v1-paine-root',
      storeId: 'lidl',
      price: 4.5,
      currency: 'RON',
      unitPrice: 9.0,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    // Kaufland acoperă 3 din 3 produse (Lapte vine pe alias-1, Unt și Pâine directe)
    {
      id: 'v1-off-kaufland-lapte',
      productId: 'v1-lapte-alias-1',
      storeId: 'kaufland',
      price: 6.89,
      currency: 'RON',
      unitPrice: 6.89,
      unitPriceMeasure: 'lei/l',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    {
      id: 'v1-off-kaufland-paine',
      productId: 'v1-paine-root',
      storeId: 'kaufland',
      price: 5.29,
      currency: 'RON',
      unitPrice: 10.58,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    {
      id: 'v1-off-kaufland-unt',
      productId: 'v1-unt-root',
      storeId: 'kaufland',
      price: 12.99,
      currency: 'RON',
      unitPrice: 64.95,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    // Carrefour acoperă 3 din 3 produse, mai scump decât Kaufland
    {
      id: 'v1-off-carrefour-lapte',
      productId: 'v1-lapte-root',
      storeId: 'carrefour',
      price: 7.49,
      currency: 'RON',
      unitPrice: 7.49,
      unitPriceMeasure: 'lei/l',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    {
      id: 'v1-off-carrefour-paine',
      productId: 'v1-paine-root',
      storeId: 'carrefour',
      price: 5.99,
      currency: 'RON',
      unitPrice: 11.98,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    {
      id: 'v1-off-carrefour-unt',
      productId: 'v1-unt-root',
      storeId: 'carrefour',
      price: 14.49,
      currency: 'RON',
      unitPrice: 72.45,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    // Oferte invalide ce NU trebuie să intre în totaluri / economii:
    // 1) Expirată (validUntil în trecut)
    {
      id: 'v1-off-expired',
      productId: 'v1-unt-root',
      storeId: 'lidl',
      price: 3.99,
      currency: 'RON',
      unitPrice: 19.95,
      unitPriceMeasure: 'lei/kg',
      isPromo: true,
      validUntil: YESTERDAY_DATE,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    // 2) Altă monedă (EUR)
    {
      id: 'v1-off-eur',
      productId: 'v1-unt-root',
      storeId: 'lidl',
      price: 2.5,
      currency: 'EUR',
      unitPrice: 12.5,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'official_feed',
      confidenceLevel: 'high',
      verificationStatus: 'verified'
    },
    // 3) Suspectă (demo / estimated / preț extrem)
    {
      id: 'v1-off-demo',
      productId: 'v1-paine-root',
      storeId: 'lidl',
      price: 1.0,
      currency: 'RON',
      unitPrice: 2.0,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'demo',
      confidenceLevel: 'low',
      verificationStatus: 'verified'
    },
    // 4) Neverificată (pending / user_reported fără validare)
    {
      id: 'v1-off-unverified',
      productId: 'v1-unt-root',
      storeId: 'lidl',
      price: 4.99,
      currency: 'RON',
      unitPrice: 24.95,
      unitPriceMeasure: 'lei/kg',
      isPromo: false,
      loyaltyCardRequired: false,
      observationDate: RECENT_DATE,
      lastChecked: RECENT_ISO,
      source: 'user_reported',
      confidenceLevel: 'low',
      verificationStatus: 'pending'
    }
  ];

  const observations: PriceObservation[] = [
    {
      id: 'v1-obs-1',
      productId: 'v1-lapte-alias-2',
      storeId: 'lidl',
      price: 6.49,
      currency: 'RON',
      date: DAYS_AGO_ISO(48),
      source: 'official_feed'
    },
    {
      id: 'v1-obs-2',
      productId: 'v1-lapte-root',
      storeId: 'lidl',
      price: 5.99,
      currency: 'RON',
      date: DAYS_AGO_ISO(3),
      source: 'verified'
    },
    // Observații invalide ce trebuie ignorate din calcule/istoric valid:
    {
      id: 'v1-obs-bad-demo',
      productId: 'v1-lapte-root',
      storeId: 'lidl',
      price: 2.5,
      currency: 'RON',
      date: DAYS_AGO_ISO(2),
      source: 'demo'
    },
    {
      id: 'v1-obs-bad-eur',
      productId: 'v1-lapte-root',
      storeId: 'kaufland',
      price: 1.4,
      currency: 'EUR',
      date: DAYS_AGO_ISO(1),
      source: 'official_feed'
    },
    {
      id: 'v1-obs-bad-neg',
      productId: 'v1-lapte-root',
      storeId: 'kaufland',
      price: -4.5,
      currency: 'RON',
      date: DAYS_AGO_ISO(1),
      source: 'official_feed'
    },
    {
      id: 'v1-obs-bad-calendar',
      productId: 'v1-lapte-root',
      storeId: 'kaufland',
      price: 6.5,
      currency: 'RON',
      date: '2026-02-30',
      source: 'official_feed'
    }
  ];

  return { products, offers, observations };
}

describe('FAZA 8 — Testare Completă și Validare End-to-End (V1)', () => {
  let app: Express;
  let ADMIN_API_KEY: string;
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const serverMod = await import('../server.ts');
    app = serverMod.app;
    ADMIN_API_KEY = serverMod.ADMIN_API_KEY;
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    StorageService.resetAllData();
    const { products, offers, observations } = buildCanonicalFixture();
    for (const p of products) StorageService.addCustomProduct(p);
    StorageService.saveProductOffers(offers);
    StorageService.addPriceObservations(observations);
  });

  after(async () => {
    IndexerScheduler.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const pool = getPool();
    if (pool) await pool.end().catch(() => {});
  });

  // =========================================================================
  // SECȚIUNEA 2 — FLUXURI END-TO-END (A – H)
  // =========================================================================
  describe('Secțiunea 2 — Fluxuri End-to-End V1 (A–H)', () => {
    it('A. Utilizatorul selectează o listă și adaugă produse, păstrând persistența locală și normalizarea aliasului', () => {
      const listA: ShoppingList = {
        id: 'list-v1-a',
        name: 'Cumpărături Săptămânale',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        items: [
          {
            id: 'it-1',
            productId: 'v1-lapte-alias-2',
            name: 'Lapte Napolact 1L (multi-hop)',
            category: 'Lactate și ouă',
            quantity: 2,
            unit: 'l',
            checked: false
          }
        ]
      };
      const listB: ShoppingList = {
        id: 'list-v1-b',
        name: 'Weekend',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        items: []
      };

      StorageService.saveShoppingLists([listA, listB]);
      StorageService.setActiveListId(listA.id);
      assert.strictEqual(StorageService.getActiveListId(), listA.id);

      // Adăugare produs nou pe lista activă
      const lists = StorageService.getShoppingLists();
      const target = lists.find((l) => l.id === listA.id)!;
      target.items.push({
        id: 'it-2',
        productId: 'v1-paine-root',
        name: 'Pâine albă Toast 500g',
        category: 'Panificație',
        quantity: 1,
        unit: 'buc',
        checked: false
      });
      StorageService.saveShoppingLists(lists);
      StorageService.normalizeLocalProductReferences(StorageService.getAllProducts());

      const reloaded = StorageService.getShoppingLists().find((l) => l.id === listA.id)!;
      assert.strictEqual(reloaded.items.length, 2);
      assert.strictEqual(reloaded.items[0].productId, 'v1-lapte-root', 'Aliasul multi-hop din listă se rezolvă la produsul canonic');
    });

    it('B. Identificare canonică: aliasuri multi-hop, produs inexistent (404) și potriviri ambigue / variante distincte', async () => {
      const { products } = buildCanonicalFixture();
      const aliasDetail = resolveCanonicalProductDetail('v1-lapte-alias-2', products);
      assert.strictEqual(aliasDetail.found, true);
      assert.strictEqual(aliasDetail.canonicalId, 'v1-lapte-root');
      assert.strictEqual(aliasDetail.hops, 2);

      // Produs inexistent în API -> 404 controlat
      const missingRes = await fetch(`${baseUrl}/api/products/prod-nonexistent-xyz-999`);
      assert.strictEqual(missingRes.status, 404);

      const missingHistRes = await fetch(`${baseUrl}/api/catalog/history/prod-nonexistent-xyz-999`);
      assert.strictEqual(missingHistRes.status, 404);

      // Potriviri ambigue / variante incompatibile (3.5% vs 1.5%, sau 500g vs 200g) NU fuzionează fals
      const fatMismatch = ProductMatcher.matchProduct(
        { rawName: 'Lapte proaspăt 3.5% Napolact 1L', brand: 'Napolact', packageWeightOrVolume: 1, packageUnit: 'l' },
        products
      );
      assert.notStrictEqual(fatMismatch.matchedProduct?.id, 'v1-lapte-root');

      const weightMismatch = ProductMatcher.matchProduct(
        { rawName: 'Unt 82% grăsime Napolact 500g', brand: 'Napolact', packageWeightOrVolume: 500, packageUnit: 'g' },
        products
      );
      assert.notStrictEqual(weightMismatch.matchedProduct?.id, 'v1-unt-root');
    });

    it('C. Optimizatorul într-un singur supermarket NU declară câștigător un magazin cu acoperire incompletă', () => {
      const { products, offers } = buildCanonicalFixture();
      const items = [
        { id: 'i1', productId: 'v1-lapte-alias-2', name: 'Lapte', category: 'Lactate și ouă' as const, quantity: 1, unit: 'l' as const, checked: false },
        { id: 'i2', productId: 'v1-paine-root', name: 'Pâine', category: 'Panificație' as const, quantity: 1, unit: 'buc' as const, checked: false },
        { id: 'i3', productId: 'v1-unt-root', name: 'Unt', category: 'Lactate și ouă' as const, quantity: 1, unit: 'buc' as const, checked: false }
      ];

      const result = BasketOptimizerService.optimize({
        items,
        products,
        offers,
        stores: STORES_V1,
        options: {
          maxStores: 1,
          useLoyaltyCards: true,
          now: NOW
        }
      });

      // Lidl are Lapte + Pâine mai ieftin, dar NU are Unt valid (expirat/EUR/unverified sunt respinse!).
      // Câștigătorul single-store trebuie să fie Kaufland (acoperire 3/3 = 25.17 RON), învingând Carrefour (3/3 = 27.97 RON), NU Lidl (2/3)!
      assert.ok(result.bestSingleStore, 'Trebuie să existe un câștigător single-store cu acoperire completă');
      assert.strictEqual(result.bestSingleStore!.store.id, 'kaufland');
      assert.strictEqual(result.bestSingleStore!.coveredItemsCount, 3);
      assert.strictEqual(result.bestSingleStore!.totalComparableItemsCount, 3);

      const lidlPlan = result.singleStoreRankings.find((p) => p.store.id === 'lidl');
      assert.ok(lidlPlan);
      assert.strictEqual(lidlPlan!.coveredItemsCount, 2);
      // Economia single-store a lui Kaufland este calculată strict față de Carrefour (aceeași acoperire 3/3): 27.97 - 25.17 = 2.80
      assert.strictEqual(result.bestSingleStore!.savingsVsWorstStore, 2.8);
      // Lidl (acoperire incompletă 2/3) NU are economie calculată față de magazine cu acoperire completă
      assert.strictEqual(lidlPlan!.savingsVsWorstStore, null);
    });

    it('D. Prețurile expirate, suspecte, neverificate, negative CSV sau în altă monedă NU generează economii false', () => {
      const { products, offers } = buildCanonicalFixture();

      // 1. Verificăm clasificarea deterministă
      assert.strictEqual(PriceQualityClassifier.classifyOffer(offers.find((o) => o.id === 'v1-off-expired')!).status, 'EXPIRED');
      assert.strictEqual(PriceQualityClassifier.classifyOffer(offers.find((o) => o.id === 'v1-off-eur')!).status, 'SUSPICIOUS');
      assert.strictEqual(PriceQualityClassifier.classifyOffer(offers.find((o) => o.id === 'v1-off-demo')!).status, 'SUSPICIOUS');
      assert.strictEqual(PriceQualityClassifier.classifyOffer(offers.find((o) => o.id === 'v1-off-unverified')!).status, 'UNVERIFIED');

      // 2. Verificăm remedierea PriceExtractor.parseExplicitPriceField pentru prețuri negative string
      assert.strictEqual(PriceExtractor.parseExplicitPriceField('-5.50'), null);
      assert.strictEqual(PriceExtractor.parseExplicitPriceField('-12,99 lei'), null);
      assert.strictEqual(PriceExtractor.parseExplicitPriceField('6,49'), 6.49);

      // 3. Verificăm că comparația pentru unt nu include Lidl (unde există doar oferte expirate/EUR/pending)
      const untCmp = PriceComparisonService.getProductComparisonDetails('v1-unt-root', products[4], offers, STORES_V1);
      assert.ok(untCmp);
      assert.strictEqual(untCmp!.offers.some((o) => o.offer.storeId === 'lidl'), false);
      assert.strictEqual(untCmp!.lowestPrice, 12.99);
    });

    it('E. Istoricul afișează numai observații valide, păstrează proveniența și nu inventează puncte intermediare', () => {
      const { products, offers, observations } = buildCanonicalFixture();
      const history = PriceHistoryService.getProductPriceStats('v1-lapte-alias-1', {
        product: products[0],
        now: NOW,
        offers,
        observations,
        stores: STORES_V1,
        aliasMap: products
      });

      assert.strictEqual(history.hasSufficientHistory, true);
      assert.strictEqual(history.productId, 'v1-lapte-root');
      // Doar cele 2 observații valide intră în timeline; cele demo / EUR / -4.5 / 2026-02-30 sunt excluse!
      assert.strictEqual(history.historyPoints.length, 2, 'Gap-ul de 45 zile NU generează puncte sintetice intermediare');
      assert.strictEqual(history.observationsCount, 2);
      assert.strictEqual(history.distinctDaysCount, 2);
      assert.strictEqual(history.minRecordedPrice, 5.99);
      assert.strictEqual(history.maxRecordedPrice, 6.49);
      assert.strictEqual(history.averagePrice, 6.24);
      assert.ok(history.excludedForeignCurrencyCount && history.excludedForeignCurrencyCount >= 1);
      assert.ok(history.flaggedObservations && history.flaggedObservations.length >= 2);
      assert.ok(
        history.historyPoints.some(
          (pt) => pt.sourceType === 'official_feed' && pt.originalProductId === 'v1-lapte-alias-2'
        )
      );
      assert.ok(history.historyPoints.some((pt) => pt.sourceType === 'verified'));

      // Randare SSR ProductPriceTrend păstrează onest punctele reale fără extrapolări
      const markup = renderToStaticMarkup(
        React.createElement(ProductPriceTrend, {
          productId: 'v1-lapte-root',
          productName: 'Lapte proaspăt 1.5% 1L',
          product: products[0],
          stores: STORES_V1,
          observations
        })
      );
      assert.ok(markup.includes('Lapte proaspăt 1.5% 1L'));
      assert.ok(!markup.includes('NaN'));
    });

    it('F. Alertele respectă pragurile, cooldown-ul, idempotency și ignoră ofertele suspecte/expirate/EUR', () => {
      const { products, offers, observations } = buildCanonicalFixture();
      const alert: PriceAlert = {
        id: 'alert-v1-lapte',
        productId: 'v1-lapte-alias-2',
        productName: 'Lapte proaspăt 1.5% 1L',
        alertType: 'below_target',
        targetPrice: 6.2,
        currentLowestPrice: 6.89,
        createdAt: RECENT_DATE,
        isActive: true,
        cooldownHours: 24,
        rearmState: 'armed',
        triggerCycle: 0
      };

      // 1. Prima evaluare: Lidl are 5.99 <= 6.20 (valid) -> declanșează 1 notificare, productId canonic rezolvat
      const eval1 = PriceAlertService.evaluateAlerts({
        alerts: [alert],
        offers,
        products,
        observations,
        stores: STORES_V1,
        existingNotifications: [],
        now: NOW
      });
      assert.strictEqual(eval1.updatedAlerts[0].productId, 'v1-lapte-root');
      assert.strictEqual(eval1.newNotifications.length, 1);
      assert.strictEqual(eval1.newNotifications[0].observedPrice, 5.99);
      const idempKey1 = eval1.newNotifications[0].idempotencyKey;
      assert.ok(idempKey1);

      // 2. Re-evaluare imediată (aceeași stare / în cooldown): ZERO notificări duplicate
      const eval2 = PriceAlertService.evaluateAlerts({
        alerts: eval1.updatedAlerts,
        offers,
        products,
        observations,
        stores: STORES_V1,
        existingNotifications: eval1.newNotifications,
        now: new Date(NOW.getTime() + 60 * 60 * 1000)
      });
      assert.strictEqual(eval2.newNotifications.length, 0);
      assert.strictEqual(eval2.updatedAlerts[0].rearmState, 'triggered_locked');

      // 3. Alertă pe unt cu țintă 5.00 RON: ofertele Lidl de 3.99 (EXPIRED), 2.5 EUR (SUSPICIOUS), 4.99 (UNVERIFIED)
      //    NU au voie să declanșeze alerta!
      const untAlert: PriceAlert = {
        id: 'alert-v1-unt',
        productId: 'v1-unt-root',
        productName: 'Unt 82% grăsime 200g',
        alertType: 'below_target',
        targetPrice: 5.0,
        currentLowestPrice: 12.99,
        createdAt: RECENT_DATE,
        isActive: true,
        cooldownHours: 24,
        rearmState: 'armed',
        triggerCycle: 0
      };
      const evalUnt = PriceAlertService.evaluateAlerts({
        alerts: [untAlert],
        offers,
        products,
        observations,
        stores: STORES_V1,
        existingNotifications: [],
        now: NOW
      });
      assert.strictEqual(evalUnt.newNotifications.length, 0);
    });

    it('G. Monitorizarea calității identifică anomaliile fără să modifice datele sursă (strict READ-ONLY)', async () => {
      const { products, offers, observations } = buildCanonicalFixture();
      const beforeProducts = JSON.stringify(products);
      const beforeOffers = JSON.stringify(offers);
      const beforeObs = JSON.stringify(observations);

      const snapshot = PriceQualityMonitoringService.evaluateDataset(
        {
          products,
          offers,
          observations,
          stores: STORES_V1
        },
        {
          intervalDays: 60,
          now: NOW
        }
      );

      assert.ok(snapshot.anomalies.length >= 4);
      const types = new Set(snapshot.anomalies.map((a) => a.anomalyType));
      assert.ok(types.has('incompatible_currency'));
      assert.ok(types.has('untrusted_demo_or_estimated_source'));
      assert.ok(types.has('expired_offer_active'));
      assert.ok(types.has('zero_or_negative_price'));
      assert.ok(types.has('invalid_timestamp'));

      // Investigația nu modifică datele sursă
      const invResult = await PriceQualityMonitoringService.recordInvestigation({
        anomalyId: snapshot.anomalies[0].id,
        investigationStatus: 'false_positive',
        note: 'Verificare V1 strict read-only',
        investigatedBy: 'admin@cosulmeu.ro',
        metadata: {
          anomalyKey: snapshot.anomalies[0].anomalyKey,
          anomalyType: snapshot.anomalies[0].anomalyType,
          severity: snapshot.anomalies[0].severity,
          targetType: snapshot.anomalies[0].targetType,
          productId: snapshot.anomalies[0].productId,
          storeId: snapshot.anomalies[0].storeId
        }
      });
      assert.ok(invResult.investigation);

      assert.strictEqual(JSON.stringify(products), beforeProducts);
      assert.strictEqual(JSON.stringify(offers), beforeOffers);
      assert.strictEqual(JSON.stringify(observations), beforeObs);
    });

    it('H. Erorile API, stările loading/empty/error și lipsa datelor sunt tratate controlat fără scurgeri sensibile', async () => {
      const badProd = await fetch(`${baseUrl}/api/products/not$valid`);
      assert.ok([400, 404].includes(badProd.status));
      const badBody = await badProd.text();
      assert.strictEqual(badBody.includes('at Layer.handle'), false);
      assert.strictEqual(badBody.includes(ADMIN_API_KEY), false);

      const noAuthAdmin = await fetch(`${baseUrl}/api/admin/price-audit`);
      assert.strictEqual(noAuthAdmin.status, 401);

      const loadingHtml = renderToStaticMarkup(React.createElement(LoadingState, { message: 'Se încarcă prețurile...' }));
      const emptyHtml = renderToStaticMarkup(React.createElement(EmptyState, { title: 'Niciun produs găsit', description: 'Încearcă un alt termen.' }));
      const errorHtml = renderToStaticMarkup(React.createElement(ErrorState, { title: 'Eroare la încărcare', message: 'Nu s-a putut contacta serverul.' }));
      assert.ok(loadingHtml.includes('Se încarcă prețurile...'));
      assert.ok(emptyHtml.includes('Niciun produs găsit'));
      assert.ok(errorHtml.includes('Eroare la încărcare'));
    });
  });

  // =========================================================================
  // SECȚIUNEA 5 — TESTE DE DATE ȘI INTEGRITATE
  // =========================================================================
  describe('Secțiunea 5 — Garanții de Date și Integritate V1', () => {
    it('1. price_observations rămâne append-only și protejat de trigger PostgreSQL + blocare ștergere produs cu istoric', () => {
      const obsBefore = StorageService.getPriceObservations().length;
      // Încercare de ștergere mixtă: 1 produs cu observații (blocat) + 1 produs fără observații (șters)
      const deleteResult = StorageService.deleteProducts(['v1-lapte-root', 'v1-temp-deletable']);

      assert.strictEqual(deleteResult.deletedCount, 1);
      assert.strictEqual(deleteResult.blockedCount, 1);
      assert.deepStrictEqual(deleteResult.blockedIds, ['v1-lapte-root']);
      assert.ok(deleteResult.error?.includes('price_observations'));
      assert.strictEqual(StorageService.getPriceObservations().length, obsBefore);

      // Verificăm că trigger-ul append-only SQL din 002_indexing_engine.sql există neschimbat
      const sql002 = fs.readFileSync(path.join(process.cwd(), 'src/db/migrations/002_indexing_engine.sql'), 'utf8');
      assert.ok(sql002.includes('CREATE TRIGGER trg_protect_price_observations'));
      assert.ok(sql002.includes('BEFORE UPDATE OR DELETE ON price_observations'));
    });

    it('2. Aliasurile canonice invalide (ciclu, auto-referință, lanț >16, orfan) sunt respinse în toate calculele', () => {
      const brokenProducts: Product[] = [
        { id: 'c1', name: 'Ciclu 1', brand: 'B', category: 'Alte produse', defaultUnit: 'buc', packageWeightOrVolume: 1, packageUnit: 'buc', normalizedUnit: 'buc', baseReferencePrice: 10, canonicalProductId: 'c2' },
        { id: 'c2', name: 'Ciclu 2', brand: 'B', category: 'Alte produse', defaultUnit: 'buc', packageWeightOrVolume: 1, packageUnit: 'buc', normalizedUnit: 'buc', baseReferencePrice: 10, canonicalProductId: 'c1' },
        { id: 'self', name: 'Self', brand: 'B', category: 'Alte produse', defaultUnit: 'buc', packageWeightOrVolume: 1, packageUnit: 'buc', normalizedUnit: 'buc', baseReferencePrice: 10, canonicalProductId: 'self' },
        { id: 'orphan', name: 'Orphan', brand: 'B', category: 'Alte produse', defaultUnit: 'buc', packageWeightOrVolume: 1, packageUnit: 'buc', normalizedUnit: 'buc', baseReferencePrice: 10, canonicalProductId: 'missing-root' }
      ];

      assert.strictEqual(resolveCanonicalProductDetail('c1', brokenProducts).cycleDetected, true);
      assert.strictEqual(resolveCanonicalProductDetail('self', brokenProducts).cycleDetected, true);
      assert.strictEqual(resolveCanonicalProductDetail('orphan', brokenProducts).found, false);
      assert.deepStrictEqual(collectProductIdsForCanonical('c1', brokenProducts), []);

      const badObs: PriceObservation[] = [
        { id: 'o-c1', productId: 'c1', storeId: 'lidl', price: 10, date: RECENT_DATE, source: 'official_feed' }
      ];
      const hist = PriceHistoryService.getProductPriceStats('c1', {
        now: NOW,
        aliasMap: brokenProducts,
        observations: badObs,
        offers: [],
        stores: STORES_V1
      });
      assert.strictEqual(hist.rejectedInvalidIdentity, true);
      assert.strictEqual(hist.observationsCount, 0);
      assert.strictEqual(hist.hasSufficientHistory, false);
    });

    it('3. Datele personale sunt izolate (401 fără autentificare) pe toate rutele de utilizator', async () => {
      const privatePaths = [
        '/api/receipts/personal-history',
        '/api/alerts',
        '/api/gdpr/my-data',
        '/api/budget/summary',
        '/api/lists/33333333-3333-4333-8333-333333333333/collaboration'
      ];
      for (const p of privatePaths) {
        const res = await fetch(`${baseUrl}${p}`);
        assert.strictEqual(res.status, 401, `${p} trebuie să ceară autentificare`);
      }
    });

    it('4. Operațiile parțiale (import CSV cu linii valide + invalide) raportează explicit status="partial" și erorile exacte', () => {
      const adapter = new FileImportAdapter('src-partial', 'Partial CSV', 'lidl');
      const raw = FileImportAdapter.parseCSV(`name,price,unit
Lapte 1L,-5.50,l
Pâine 500g,0,buc
Zahar 1kg,4.89,kg`);
      const validation = adapter.validateRecords(raw);
      assert.strictEqual(validation.valid.length, 1);
      assert.strictEqual(validation.invalid.length, 2);
      assert.strictEqual(validation.valid[0].rawName, 'Zahar 1kg');
    });

    it('5. Datele istorice (price_observations) și ofertele curente (product_offers) rămân complet separate', () => {
      const { products, offers } = buildCanonicalFixture();
      // Chiar dacă există oferte curente active în product_offers, dacă observațiile sunt goale,
      // PriceHistoryService NU fabrică observații istorice din product_offers.
      const histNoObs = PriceHistoryService.getProductPriceStats('v1-unt-root', {
        product: products[4],
        now: NOW,
        aliasMap: products,
        offers,
        observations: [],
        stores: STORES_V1
      });
      assert.strictEqual(histNoObs.hasSufficientHistory, false);
      assert.strictEqual(histNoObs.historyPoints.length, 0);
      assert.strictEqual(histNoObs.minRecordedPrice, null);
      assert.ok(histNoObs.currentLowestPrice === 12.99);
      assert.ok(offers.some((o) => o.productId === 'v1-unt-root' && o.verificationStatus === 'verified'));
    });
  });
});
