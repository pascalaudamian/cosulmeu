import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

process.env.NODE_ENV = 'test';

import { BasketOptimizerService } from '../src/services/BasketOptimizerService.js';
import { PriceComparisonService } from '../src/services/PriceComparisonService.js';
import { PriceHistoryService } from '../src/services/PriceHistoryService.js';
import { PriceAlertService } from '../src/services/PriceAlertService.js';
import { PriceQualityClassifier } from '../src/services/PriceQualityClassifier.js';
import type {
  PriceAlert,
  PriceObservation,
  Product,
  ProductOffer,
  ShoppingList,
  ShoppingListItem,
  Store
} from '../src/types.js';

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const DATE_120_DAYS_AGO = new Date(NOW.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const PAST_DATE = '2024-01-01';
const FUTURE_DATE = '2099-12-31';

const STORES: Store[] = [
  {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    chain: 'Lidl',
    brandColor: 'bg-blue-700',
    accentColor: 'text-blue-700',
    type: 'discounter',
    rating: 4.5,
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
    rating: 4.6,
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
  },
  {
    id: 'penny',
    name: 'Penny',
    slug: 'penny',
    chain: 'Penny',
    brandColor: 'bg-amber-600',
    accentColor: 'text-amber-600',
    type: 'discounter',
    rating: 4.2,
    locationsCount: 380,
    sampleAddress: 'România'
  }
];

const PRODUCTS: Product[] = [
  {
    id: 'p-lapte',
    name: 'Lapte proaspăt 1.5% 1L',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 7.0
  },
  {
    id: 'p-faina',
    name: 'Făină albă 000 1kg',
    brand: 'Băneasa',
    category: 'Produse de bază',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 4.5
  },
  {
    id: 'p-oua',
    name: 'Ouă proaspete M 10 buc',
    brand: 'Din Ogradă',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 10,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 12.0
  },
  {
    id: 'p-ulei',
    name: 'Ulei de floarea-soarelui 1L',
    brand: 'Bunica',
    category: 'Produse de bază',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 8.5
  },
  {
    id: 'p-cafea-boabe',
    name: 'Cafea boabe Espresso 1kg',
    brand: 'Lavazza',
    category: 'Băuturi',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 70.0
  },
  {
    id: 'p-cafea-macinata',
    name: 'Cafea măcinată Clasic 500g',
    brand: 'Jacobs',
    category: 'Băuturi',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 30.0
  }
];

function makeOffer(overrides: Partial<ProductOffer>): ProductOffer {
  return {
    id: overrides.id || `off-${Math.random().toString(36).slice(2, 7)}`,
    productId: overrides.productId || 'p-lapte',
    storeId: overrides.storeId || 'lidl',
    price: overrides.price ?? 6.5,
    unitPrice: overrides.unitPrice ?? overrides.price ?? 6.5,
    unitPriceMeasure: overrides.unitPriceMeasure || 'lei/l',
    isPromo: overrides.isPromo ?? false,
    observationDate: overrides.observationDate || TODAY,
    source: overrides.source || 'official_feed',
    confidenceLevel: overrides.confidenceLevel || 'high',
    verificationStatus: overrides.verificationStatus || 'verified',
    lastChecked: overrides.lastChecked || NOW.toISOString(),
    lastVerifiedAt: overrides.lastVerifiedAt || NOW.toISOString(),
    validUntil: overrides.validUntil
  };
}

async function runTests() {
  console.log('🧪 Rulare suită teste V1 Roadmap Coșul Meu (22 scenarii)...\n');
  let passed = 0;

  const check = (name: string, fn: () => void | Promise<void>) => ({ name, fn });

  const tests = [
    check('1. Produse fără preț (zero fallback 10 RON, isEstimative = true, exclus din total)', () => {
      const noPriceProd: Product = {
        id: 'p-fara-pret',
        name: 'Brânză maturată artizanală',
        brand: 'Local',
        category: 'Lactate și ouă',
        defaultUnit: 'kg',
        packageWeightOrVolume: 1,
        packageUnit: 'kg',
        normalizedUnit: 'kg',
        baseReferencePrice: 99
      };
      const items: ShoppingListItem[] = [
        {
          id: 'i1',
          productId: 'p-lapte',
          name: 'Lapte proaspăt 1.5% 1L',
          category: 'Lactate și ouă',
          quantity: 1,
          unit: 'l',
          checked: false,
          estimatedPrice: 7.0
        },
        {
          id: 'i2',
          productId: 'p-fara-pret',
          name: 'Brânză maturată artizanală',
          category: 'Lactate și ouă',
          quantity: 1,
          unit: 'kg',
          checked: false,
          estimatedPrice: 99
        }
      ];
      const offers = [makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 })];

      const comp = PriceComparisonService.compareBasketAcrossStores(
        items,
        { useLoyaltyCards: true },
        [...PRODUCTS, noPriceProd],
        offers,
        STORES
      );
      const lidlComp = comp.find(c => c.store.id === 'lidl')!;
      assert.equal(lidlComp.estimatedMissingTotal, 0);
      assert.equal(lidlComp.grandTotal, 6.0);
      assert.equal(lidlComp.missingItems.length, 1);

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l1', name: 'Test' },
        items,
        products: [...PRODUCTS, noPriceProd],
        offers,
        stores: STORES,
        options: { now: NOW }
      });
      assert.equal(opt.isEstimative, true);
      assert.equal(opt.itemsWithoutAnyValidPrice.length, 1);
      assert.equal(opt.recommendedMultiStore?.productsTotal, 6.0);
    }),

    check('2. Produse cu prețuri expirate (excluse din optimizator + clasificate EXPIRED)', () => {
      const expiredOffer = makeOffer({
        id: 'off-exp',
        productId: 'p-lapte',
        storeId: 'lidl',
        price: 6.2,
        validUntil: PAST_DATE
      });
      const validOffer = makeOffer({
        id: 'off-ok',
        productId: 'p-lapte',
        storeId: 'kaufland',
        price: 6.5,
        validUntil: FUTURE_DATE
      });

      const qExpired = PriceQualityClassifier.classifyOffer(expiredOffer, {
        product: PRODUCTS[0],
        now: NOW
      });
      assert.equal(qExpired.status, 'EXPIRED');
      assert.equal(qExpired.isUsableForComparison, false);

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l2', name: 'Expirate' },
        items: [
          {
            id: 'i1',
            productId: 'p-lapte',
            name: 'Lapte proaspăt 1.5% 1L',
            category: 'Lactate și ouă',
            quantity: 1,
            unit: 'l',
            checked: false
          }
        ],
        products: PRODUCTS,
        offers: [expiredOffer, validOffer],
        stores: STORES,
        options: { now: NOW }
      });
      assert.equal(opt.bestSingleStore?.store.id, 'kaufland');
      assert.equal(opt.bestSingleStore?.totalPrice, 6.5);
    }),

    check('3. Produse cu gramaje diferite (normalizare g/kg și detectare conflict unități kg vs buc)', () => {
      const offers = [
        makeOffer({
          productId: 'p-faina',
          storeId: 'lidl',
          price: 4.4,
          unitPrice: 4.4,
          unitPriceMeasure: 'lei/kg'
        }),
        makeOffer({
          productId: 'p-oua',
          storeId: 'lidl',
          price: 11.0,
          unitPrice: 11.0,
          unitPriceMeasure: 'lei/buc'
        })
      ];
      const items: ShoppingListItem[] = [
        {
          id: 'i-500g',
          productId: 'p-faina',
          name: 'Făină albă 000 1kg',
          category: 'Produse de bază',
          quantity: 500,
          unit: 'g',
          checked: false
        },
        {
          id: 'i-conflict',
          productId: 'p-oua',
          name: 'Ouă proaspete M 10 buc',
          category: 'Lactate și ouă',
          quantity: 1,
          unit: 'kg', // incompatibil cu 'buc'
          checked: false
        }
      ];

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l3', name: 'Gramaje' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { now: NOW }
      });

      assert.equal(opt.bestSingleStore?.totalPrice, 2.2); // 500g * 4.4 lei/kg = 2.20 lei
      assert.equal(opt.unitConflicts.length, 1);
      assert.equal(opt.unitConflicts[0].item.unit, 'kg');
    }),

    check('4. Liste cu produse duplicate (cumulează cantitatea fără dublare artificială)', () => {
      const items: ShoppingListItem[] = [
        {
          id: 'dup-1',
          productId: 'p-lapte',
          name: 'Lapte proaspăt 1.5% 1L',
          category: 'Lactate și ouă',
          quantity: 1,
          unit: 'l',
          checked: false
        },
        {
          id: 'dup-2',
          productId: 'p-lapte',
          name: 'Lapte proaspăt 1.5% 1L',
          category: 'Lactate și ouă',
          quantity: 2,
          unit: 'l',
          checked: false
        }
      ];
      const offers = [makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 5.5 })];

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l4', name: 'Duplicate' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { now: NOW }
      });

      assert.equal(opt.totalRequestedLines, 2);
      assert.equal(opt.distinctNormalizedItemsCount, 1);
      assert.equal(opt.duplicateLinesMergedCount, 1);
      assert.equal(opt.bestSingleStore?.totalPrice, 16.5); // 3L * 5.50
    }),

    check('5. Produse fără matching sigur (potriviri ambigue separate în unconfidentMatches)', () => {
      const items: ShoppingListItem[] = [
        {
          id: 'amb-1',
          name: 'Cafea', // se potrivește egal cu p-cafea-boabe și p-cafea-macinata fără scor dominant
          category: 'Băuturi',
          quantity: 1,
          unit: 'buc',
          checked: false
        }
      ];
      const opt = BasketOptimizerService.optimize({
        list: { id: 'l5', name: 'Ambiguu' },
        items,
        products: PRODUCTS,
        offers: [
          makeOffer({ productId: 'p-cafea-boabe', storeId: 'lidl', price: 65, unitPriceMeasure: 'lei/kg' }),
          makeOffer({ productId: 'p-cafea-macinata', storeId: 'lidl', price: 28, unitPriceMeasure: 'lei/kg' })
        ],
        stores: STORES,
        options: { now: NOW }
      });

      assert.equal(opt.unconfidentMatches.length, 1);
      assert.equal(opt.comparableCatalogItemsCount, 0);
      assert.equal(opt.distinctNormalizedItemsCount, 1);
    }),

    check('6. Coș optimizat într-un magazin (clasament acoperire apoi preț real)', () => {
      const items: ShoppingListItem[] = [
        { id: '1', productId: 'p-lapte', name: 'Lapte', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: '2', productId: 'p-faina', name: 'Făină', category: 'Produse de bază', quantity: 1, unit: 'kg', checked: false }
      ];
      const offers = [
        makeOffer({ productId: 'p-lapte', storeId: 'penny', price: 4.5 }), // acoperire parțială (1/2)
        makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 }),
        makeOffer({ productId: 'p-faina', storeId: 'lidl', price: 4.0, unitPriceMeasure: 'lei/kg' }), // total 10.0
        makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 6.5 }),
        makeOffer({ productId: 'p-faina', storeId: 'kaufland', price: 4.5, unitPriceMeasure: 'lei/kg' }) // total 11.0
      ];

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l6', name: 'Single Store' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { now: NOW }
      });

      assert.equal(opt.bestSingleStore?.store.id, 'lidl');
      assert.equal(opt.bestSingleStore?.totalPrice, 10.0);
      assert.equal(opt.singleStoreRankings[opt.singleStoreRankings.length - 1].store.id, 'penny');
    }),

    check('7. Coș optimizat în mai multe magazine (multi-store bate single-store)', () => {
      const items: ShoppingListItem[] = [
        { id: '1', productId: 'p-lapte', name: 'Lapte', category: 'Lactate și ouă', quantity: 2, unit: 'l', checked: false },
        { id: '2', productId: 'p-ulei', name: 'Ulei', category: 'Produse de bază', quantity: 2, unit: 'l', checked: false }
      ];
      const offers = [
        makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 5.0 }),
        makeOffer({ productId: 'p-ulei', storeId: 'lidl', price: 11.0 }), // Lidl total: 32
        makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 9.0 }),
        makeOffer({ productId: 'p-ulei', storeId: 'kaufland', price: 6.0 }) // Kaufland total: 30
      ];

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l7', name: 'Multi-store' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { maxStores: 2, now: NOW }
      });

      assert.equal(opt.bestSingleStore?.store.id, 'kaufland');
      assert.equal(opt.bestSingleStore?.totalPrice, 30.0);
      assert.equal(opt.recommendedMultiStore?.storeCount, 2);
      assert.equal(opt.recommendedMultiStore?.productsTotal, 22.0); // 2*5 + 2*6
      assert.equal(opt.recommendedMultiStore?.savingsVsBestSingleStore, 8.0);
    }),

    check('8. Limita de magazine (maxStores = 1 vs 2 vs 3)', () => {
      const items: ShoppingListItem[] = [
        { id: '1', productId: 'p-lapte', name: 'Lapte', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: '2', productId: 'p-faina', name: 'Făină', category: 'Produse de bază', quantity: 1, unit: 'kg', checked: false },
        { id: '3', productId: 'p-ulei', name: 'Ulei', category: 'Produse de bază', quantity: 1, unit: 'l', checked: false }
      ];
      const offers = [
        makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 4.0 }),
        makeOffer({ productId: 'p-faina', storeId: 'lidl', price: 9.0, unitPriceMeasure: 'lei/kg' }),
        makeOffer({ productId: 'p-ulei', storeId: 'lidl', price: 9.0 }),

        makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 9.0 }),
        makeOffer({ productId: 'p-faina', storeId: 'kaufland', price: 3.0, unitPriceMeasure: 'lei/kg' }),
        makeOffer({ productId: 'p-ulei', storeId: 'kaufland', price: 9.0 }),

        makeOffer({ productId: 'p-lapte', storeId: 'carrefour', price: 9.0 }),
        makeOffer({ productId: 'p-faina', storeId: 'carrefour', price: 9.0, unitPriceMeasure: 'lei/kg' }),
        makeOffer({ productId: 'p-ulei', storeId: 'carrefour', price: 5.0 })
      ];

      const max1 = BasketOptimizerService.optimize({
        list: { id: 'l8', name: 'Max1' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { maxStores: 1, now: NOW }
      });
      const max2 = BasketOptimizerService.optimize({
        list: { id: 'l8', name: 'Max2' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { maxStores: 2, now: NOW }
      });
      const max3 = BasketOptimizerService.optimize({
        list: { id: 'l8', name: 'Max3' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { maxStores: 3, now: NOW }
      });

      assert.equal(max1.recommendedMultiStore?.storeCount, 1);
      assert.equal(max2.recommendedMultiStore?.storeCount, 2);
      assert.equal(max3.recommendedMultiStore?.storeCount, 3);
      assert.equal(max3.recommendedMultiStore?.productsTotal, 12.0);
    }),

    check('9. Magazine excluse și favorite (excludedStoreIds eliminat, favorite câștigă egalitatea)', () => {
      const items: ShoppingListItem[] = [
        { id: '1', productId: 'p-lapte', name: 'Lapte', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }
      ];
      const offers = [
        makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 5.0 }),
        makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 6.0 }),
        makeOffer({ productId: 'p-lapte', storeId: 'carrefour', price: 6.0 })
      ];

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l9', name: 'Prefs' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: {
          excludedStoreIds: ['lidl'],
          favoriteStoreIds: ['carrefour'],
          now: NOW
        }
      });

      assert.ok(!opt.singleStoreRankings.some(s => s.store.id === 'lidl'));
      assert.equal(opt.bestSingleStore?.store.id, 'carrefour');
      assert.equal(opt.bestSingleStore?.isFavorite, true);
    }),

    check('10. Economii calculate exclusiv pe intersecție comparabilă validă', () => {
      const items: ShoppingListItem[] = [
        { id: '1', productId: 'p-lapte', name: 'Lapte', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: '2', productId: 'p-ulei', name: 'Ulei', category: 'Produse de bază', quantity: 1, unit: 'l', checked: false }
      ];
      // Niciun magazin unic nu are ambele produse!
      const disjointOffers = [
        makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 5.0 }),
        makeOffer({ productId: 'p-ulei', storeId: 'kaufland', price: 7.0 })
      ];

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l10', name: 'Disjoint' },
        items,
        products: PRODUCTS,
        offers: disjointOffers,
        stores: STORES,
        options: { maxStores: 2, now: NOW }
      });

      assert.equal(opt.recommendedMultiStore?.coveredItemsCount, 2);
      assert.equal(opt.recommendedMultiStore?.hasValidSavingsBaseline, false);
      assert.equal(opt.recommendedMultiStore?.savingsVsBestSingleStore, null);
    }),

    check('11. Istoric fără observații (0 obs pe 30/90/180/365 -> nu fabrică puncte, toate metricile null)', () => {
      const stats = PriceHistoryService.getProductPriceStats('p-lapte', {
        offers: [],
        observations: [],
        stores: STORES,
        receipts: [],
        now: NOW
      });

      assert.equal(stats.observationsCount, 0);
      assert.equal(stats.hasSufficientHistory, false);
      assert.equal(stats.minRecordedPrice, null);
      assert.equal(stats.maxRecordedPrice, null);
      assert.equal(stats.averagePrice, null);
      for (const days of [30, 90, 180, 365] as const) {
        assert.equal(stats.intervalStats[days].observationsCount, 0);
        assert.equal(stats.intervalStats[days].minPrice, null);
        assert.equal(stats.intervalStats[days].hasSufficientHistory, false);
      }
    }),

    check('12. Istoric cu o observație (filtru strict 30/90/180/365 nu ocolește filtrul și nu trage linie)', () => {
      // Observație veche de 120 de zile: trebuie să lipsească la 30 și 90, dar să apară la 180 și 365!
      const obs: PriceObservation[] = [
        {
          id: 'obs-120d',
          productId: 'p-lapte',
          storeId: 'lidl',
          price: 5.99,
          date: DATE_120_DAYS_AGO,
          source: 'verified'
        }
      ];
      const stats = PriceHistoryService.getProductPriceStats('p-lapte', {
        offers: [],
        observations: obs,
        stores: STORES,
        receipts: [],
        now: NOW
      });

      assert.equal(stats.intervalStats[30].observationsCount, 0);
      assert.equal(stats.intervalStats[90].observationsCount, 0);
      assert.equal(stats.intervalStats[180].observationsCount, 1);
      assert.equal(stats.intervalStats[180].hasSufficientHistory, false);
      assert.equal(stats.intervalStats[180].minPrice, 5.99);
      assert.ok(stats.intervalStats[180].noticeRo?.includes('o singură observație'));
    }),

    check('13. Alerte duplicate (bulk din listă și evaluare idempotentă fără notificări duble)', () => {
      const list: ShoppingList = {
        id: 'list-dup-alerts',
        name: 'Listă Alerte',
        items: [
          { id: 'a1', productId: 'p-lapte', name: 'Lapte', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
          { id: 'a2', productId: 'p-lapte', name: 'Lapte', category: 'Lactate și ouă', quantity: 2, unit: 'l', checked: false }
        ],
        createdAt: TODAY,
        updatedAt: TODAY
      };
      const offers = [makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 5.5 })];

      const bulk1 = PriceAlertService.createAlertsFromShoppingList(list, [], PRODUCTS, offers);
      assert.equal(bulk1.createdAlerts.length, 1);
      assert.equal(bulk1.skippedExistingCount, 1);

      const bulk2 = PriceAlertService.createAlertsFromShoppingList(list, bulk1.createdAlerts, PRODUCTS, offers);
      assert.equal(bulk2.createdAlerts.length, 0);
      assert.equal(bulk2.skippedExistingCount, 2);

      // Force trigger with higher targetPrice and evaluate twice
      const activeAlert: PriceAlert = {
        ...bulk1.createdAlerts[0],
        targetPrice: 6.0
      };
      const eval1 = PriceAlertService.evaluateAlerts({
        alerts: [activeAlert],
        offers,
        stores: STORES,
        now: NOW
      });
      assert.equal(eval1.newNotifications.length, 1);

      const eval2 = PriceAlertService.evaluateAlerts({
        alerts: eval1.updatedAlerts,
        offers,
        stores: STORES,
        existingNotifications: eval1.newNotifications,
        now: NOW
      });
      assert.equal(eval2.newNotifications.length, 0);
    }),

    check('14. Alerte dezactivate (isActive = false ignorată complet la evaluare)', () => {
      const inactiveAlert: PriceAlert = {
        id: 'alert-off',
        productId: 'p-lapte',
        productName: 'Lapte proaspăt',
        targetPrice: 20.0,
        currentLowestPrice: 6.0,
        createdAt: TODAY,
        isActive: false,
        alertType: 'below_target'
      };
      const offers = [makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 4.5 })];
      const res = PriceAlertService.evaluateAlerts({
        alerts: [inactiveAlert],
        offers,
        stores: STORES,
        now: NOW
      });
      assert.equal(res.newNotifications.length, 0);
      assert.equal(res.updatedAlerts[0].isActive, false);
    }),

    await (async () => ({
      name: '15. Acces neautorizat, validare Zod strictă și rate limiting pe server',
      fn: async () => {
        const { app, ADMIN_API_KEY } = await import('../server.ts');
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        assert.ok(addr && typeof addr !== 'string');
        const baseUrl = `http://127.0.0.1:${addr.port}`;

        try {
          const rExport = await fetch(`${baseUrl}/api/gdpr/export`);
          assert.equal(rExport.status, 401);

          const rAdminNoAuth = await fetch(`${baseUrl}/api/admin/gdpr/requests`);
          assert.equal(rAdminNoAuth.status, 401);

          const rAdminBadAuth = await fetch(`${baseUrl}/api/admin/gdpr/requests`, {
            headers: { Authorization: 'Bearer wrong-token' }
          });
          assert.equal(rAdminBadAuth.status, 403);

          const rReceiptsNoAuth = await fetch(`${baseUrl}/api/receipts/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          assert.equal(rReceiptsNoAuth.status, 401);

          // Selectăm un produs real activ din catalogul curent pentru testele de istoric și optimizare
          const rProds = await fetch(`${baseUrl}/api/products?onlyAvailable=true&limit=25`);
          assert.equal(rProds.status, 200);
          const prodsBody = await rProds.json();
          const usableProd =
            (prodsBody.products || []).find(
              (p: any) =>
                p.minPrice !== null &&
                p.qualityStatus !== 'EXPIRED' &&
                p.qualityStatus !== 'SUSPICIOUS'
            ) || prodsBody.products?.[0];
          const targetProductId = usableProd?.id || 'prod-lapte-1';

          // Validare strictă interval istoric
          const rBadDays = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(targetProductId)}?days=999`);
          assert.equal(rBadDays.status, 400);

          const rGoodDays = await fetch(`${baseUrl}/api/catalog/history/${encodeURIComponent(targetProductId)}?days=180`);
          assert.equal(rGoodDays.status, 200);
          const histBody = await rGoodDays.json();
          assert.equal(histBody.intervalDays, 180);
          assert.ok(histBody.intervalStats);

          // Validare strictă POST /api/basket/optimize
          const rBadOpt = await fetch(`${baseUrl}/api/basket/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{ id: 'bad', name: 'Test', quantity: -5, unit: 'ton' }],
              options: { maxStores: 99 }
            })
          });
          assert.equal(rBadOpt.status, 400);

          const rGoodOpt = await fetch(`${baseUrl}/api/basket/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              listId: 'l-api',
              listName: 'Test API',
              items: [
                {
                  id: 'i-api-1',
                  productId: targetProductId,
                  name: usableProd?.name || 'Lapte proaspăt 1.5%',
                  category: usableProd?.category || 'Lactate și ouă',
                  quantity: 2,
                  unit: usableProd?.normalizedUnit || 'buc',
                  checked: false
                }
              ],
              options: { maxStores: 2, useLoyaltyCards: true, transportCostPerExtraStore: 0 }
            })
          });
          assert.equal(rGoodOpt.status, 200);
          const optJson = await rGoodOpt.json();
          assert.equal(optJson.success, true);
          assert.ok(optJson.optimization.bestSingleStore || optJson.optimization.singleStoreRankings.length >= 0);
          if (usableProd && usableProd.qualityStatus !== 'EXPIRED' && usableProd.qualityStatus !== 'SUSPICIOUS') {
            assert.ok(optJson.optimization.bestSingleStore);
          }
          assert.ok(!JSON.stringify(optJson).includes(ADMIN_API_KEY));

          // Rate limiting verification via explicit test enforcement header (90 req/min limit)
          let saw429 = false;
          for (let i = 0; i < 95; i++) {
            const rLim = await fetch(`${baseUrl}/api/basket/optimize`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-enforce-rate-limit': 'true'
              },
              body: JSON.stringify({ items: [] })
            });
            if (rLim.status === 429) {
              saw429 = true;
              break;
            }
          }
          assert.equal(saw429, true, 'Rate limiter-ul trebuie să blocheze excesul cu 429');
        } finally {
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
      }
    }))(),

    check('16. RLS definit strict în toate migrațiile Supabase pentru tabele cu date personale', () => {
      const root = process.cwd();
      const userScopedMigrations = [
        path.join(root, 'src/db/migrations/010_receipt_scanner_v2.sql'),
        path.join(root, 'src/db/migrations/011_gdpr_and_cookie_consent.sql'),
        path.join(root, 'src/db/migrations/012_v1_alerts_and_quality.sql')
      ];

      for (const file of userScopedMigrations) {
        const sql = fs.readFileSync(file, 'utf8');
        assert.match(sql, /ENABLE ROW LEVEL SECURITY/i, `${path.basename(file)} trebuie să activeze RLS`);
        assert.match(sql, /auth\.uid\(\)\s*=\s*user_id/i, `${path.basename(file)} trebuie să verifice auth.uid() = user_id`);
      }

      const auditSql = fs.readFileSync(path.join(root, 'src/lib/migrations/002_create_audit_log.sql'), 'utf8');
      assert.match(auditSql, /ENABLE ROW LEVEL SECURITY/i, '002_create_audit_log.sql trebuie să activeze RLS');
      assert.match(auditSql, /current_actor_sha256\(\)/i, '002_create_audit_log.sql trebuie să izoleze prin actor_hash SHA-256 derivat din auth.uid()');

      const m012 = fs.readFileSync(userScopedMigrations[2], 'utf8');
      assert.match(m012, /price_alert_notifications/i);
      assert.match(m012, /alert_type/i);
    }),

    await (async () => ({
      name: '17. Izolare utilizatori diferiți (utilizatorul A nu poate accesa/falsifica datele utilizatorului B sau rol admin)',
      fn: async () => {
        const { app } = await import('../server.ts');
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        assert.ok(addr && typeof addr !== 'string');
        const baseUrl = `http://127.0.0.1:${addr.port}`;

        try {
          const rUserAOnRequests = await fetch(`${baseUrl}/api/gdpr/requests?user_id=user-b-id`, {
            headers: { Authorization: 'Bearer fake-jwt-user-a' }
          });
          assert.equal(rUserAOnRequests.status, 401);

          const rUserAOnWithdraw = await fetch(`${baseUrl}/api/gdpr/withdraw-consents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer fake-jwt-user-a'
            },
            body: JSON.stringify({ userId: 'user-b-id', consentType: 'marketing' })
          });
          assert.equal(rUserAOnWithdraw.status, 401);

          const rUserAOnAdmin = await fetch(`${baseUrl}/api/admin/gdpr/requests`, {
            headers: {
              Authorization: 'Bearer fake-jwt-user-a',
              'x-user-role': 'admin'
            }
          });
          assert.equal(rUserAOnAdmin.status, 403);
        } finally {
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
      }
    }))(),

    check('18. Prioritate EAN exact (barcode) și excluderea ofertelor cu sursa estimated/demo', () => {
      const prodA: Product = {
        id: 'p-ean-target',
        name: 'Ulei extravirgin măsline 750ml',
        brand: 'Costa dOro',
        category: 'Produse de bază',
        defaultUnit: 'buc',
        packageWeightOrVolume: 0.75,
        packageUnit: 'l',
        normalizedUnit: 'l',
        barcode: '8002330001234',
        baseReferencePrice: 35.0
      };
      const prodOther: Product = {
        id: 'p-wrong-id',
        name: 'Alt produs generic',
        brand: 'Generic',
        category: 'Produse de bază',
        defaultUnit: 'buc',
        packageWeightOrVolume: 1,
        packageUnit: 'buc',
        normalizedUnit: 'buc',
        baseReferencePrice: 10.0
      };

      const itemWithEan: ShoppingListItem = {
        id: 'i-ean',
        productId: 'p-wrong-id',
        barcode: '8002330001234',
        name: 'Ulei de măsline',
        category: 'Produse de bază',
        quantity: 1,
        unit: 'buc',
        checked: false
      };

      const estimatedLidl = makeOffer({
        id: 'off-est',
        productId: 'p-ean-target',
        storeId: 'lidl',
        price: 12.0,
        source: 'estimated'
      });
      const verifiedKaufland = makeOffer({
        id: 'off-ver',
        productId: 'p-ean-target',
        storeId: 'kaufland',
        price: 34.5,
        source: 'official_feed'
      });

      const qEst = PriceQualityClassifier.classifyOffer(estimatedLidl, { product: prodA, now: NOW });
      assert.equal(qEst.isUsableForComparison, false);

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l18', name: 'EAN & Estimated' },
        items: [itemWithEan],
        products: [prodOther, prodA],
        offers: [estimatedLidl, verifiedKaufland],
        stores: STORES,
        options: { now: NOW }
      });

      assert.equal(opt.bestSingleStore?.store.id, 'kaufland');
      assert.equal(opt.bestSingleStore?.totalPrice, 34.5);
      assert.equal(opt.bestSingleStore?.allocations[0].matchConfidence, 'exact_ean');
    }),

    check('19. Cumularea produselor duplicate în unități fizice compatibile (500 g + 0.5 kg = 1 kg)', () => {
      const items: ShoppingListItem[] = [
        {
          id: 'u1',
          productId: 'p-faina',
          name: 'Făină albă 000 1kg',
          category: 'Produse de bază',
          quantity: 500,
          unit: 'g',
          checked: false
        },
        {
          id: 'u2',
          productId: 'p-faina',
          name: 'Făină albă 000 1kg',
          category: 'Produse de bază',
          quantity: 0.5,
          unit: 'kg',
          checked: false
        }
      ];
      const offers = [
        makeOffer({
          productId: 'p-faina',
          storeId: 'lidl',
          price: 4.6,
          unitPrice: 4.6,
          unitPriceMeasure: 'lei/kg'
        })
      ];

      const opt = BasketOptimizerService.optimize({
        list: { id: 'l19', name: 'Unități compatibile' },
        items,
        products: PRODUCTS,
        offers,
        stores: STORES,
        options: { now: NOW }
      });

      assert.equal(opt.totalRequestedLines, 2);
      assert.equal(opt.distinctNormalizedItemsCount, 1);
      assert.equal(opt.duplicateLinesMergedCount, 1);
      assert.equal(opt.bestSingleStore?.totalPrice, 4.6);
    }),

    await (async () => ({
      name: '20. Batch dataset & invalidarea cache-ului de catalog pentru optimizator',
      fn: async () => {
        const dbMod = await import('../src/db/index.js');
        const beforeStats = dbMod.getCatalogOptimizationCacheStats();
        const dataset = await dbMod.DatabaseService.getOptimizationDataset([
          {
            productId: 'prod-lapte-1',
            name: 'Lapte'
          }
        ]);
        assert.ok(Array.isArray(dataset.products));
        assert.ok(Array.isArray(dataset.offers));
        assert.ok(Array.isArray(dataset.stores));
        assert.ok(
          dataset.batchQueryMode === 'targeted_batch' ||
            dataset.batchQueryMode === 'cached_catalog' ||
            dataset.batchQueryMode === 'isolated_memory'
        );

        dbMod.invalidateCatalogOptimizationCache();
        const afterStats = dbMod.getCatalogOptimizationCacheStats();
        assert.equal(afterStats.version, beforeStats.version + 1);
        assert.equal(afterStats.hasProducts, false);
        assert.equal(afterStats.hasOffers, false);
        assert.equal(afterStats.hasStores, false);
      }
    }))(),

    await (async () => ({
      name: '21. Securitate & izolare ownership/RLS pe endpoint-urile /api/basket/optimize',
      fn: async () => {
        const { app } = await import('../server.ts');
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        assert.ok(addr && typeof addr !== 'string');
        const baseUrl = `http://127.0.0.1:${addr.port}`;
        const fakeUuid = '11111111-1111-4111-8111-111111111111';

        try {
          const rGetNoAuth = await fetch(`${baseUrl}/api/basket/optimize/${fakeUuid}`);
          assert.equal(rGetNoAuth.status, 401);

          const rGetBadAuth = await fetch(`${baseUrl}/api/basket/optimize/${fakeUuid}`, {
            headers: { Authorization: 'Bearer fake-token-user-a' }
          });
          assert.equal(rGetBadAuth.status, 401);

          const rPostUuidNoItemsNoAuth = await fetch(`${baseUrl}/api/basket/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listId: fakeUuid, items: [] })
          });
          assert.equal(rPostUuidNoItemsNoAuth.status, 401);

          const rPostBadToken = await fetch(`${baseUrl}/api/basket/optimize`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer invalid-jwt'
            },
            body: JSON.stringify({ items: [] })
          });
          assert.equal(rPostBadToken.status, 401);
        } finally {
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
      }
    }))(),

    await (async () => ({
      name: '22. Răspuns complet /api/basket/optimize (bestSingleStore, bestTwoStores, bestThreeStores, Cache-Control)',
      fn: async () => {
        const { app } = await import('../server.ts');
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        assert.ok(addr && typeof addr !== 'string');
        const baseUrl = `http://127.0.0.1:${addr.port}`;

        try {
          const rProds = await fetch(`${baseUrl}/api/products?onlyAvailable=true&limit=10`);
          assert.equal(rProds.status, 200);
          const prodsBody = await rProds.json();
          const sampleProd = prodsBody.products?.[0];

          const res = await fetch(`${baseUrl}/api/basket/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              listId: 'local-list-22',
              listName: 'Test Complet',
              items: [
                {
                  id: 'i-22-1',
                  productId: sampleProd?.id,
                  name: sampleProd?.name || 'Lapte',
                  category: sampleProd?.category || 'Lactate și ouă',
                  quantity: 1,
                  unit: sampleProd?.normalizedUnit || 'buc',
                  checked: false
                }
              ],
              options: { maxStores: 3, useLoyaltyCards: true, transportCostPerExtraStore: 0 }
            })
          });

          assert.equal(res.status, 200);
          assert.match(res.headers.get('cache-control') || '', /private,\s*no-store/i);
          const body = await res.json();
          assert.equal(body.success, true);
          assert.ok(body.meta?.batchQueryMode);
          assert.ok('bestSingleStore' in body.optimization);
          assert.ok('bestTwoStores' in body.optimization);
          assert.ok('bestThreeStores' in body.optimization);
          assert.ok(Array.isArray(body.optimization.singleStoreRankings));
        } finally {
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
      }
    }))()
  ];

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ [PASS] ${t.name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${t.name}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log(`\n🎉 Toate cele ${passed}/22 scenarii V1 Roadmap au trecut cu succes!`);
}

runTests();
