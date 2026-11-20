import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NODE_ENV = 'test';

import { PriceComparisonService } from '../src/services/PriceComparisonService.js';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.js';
import { OptimizationService } from '../src/services/OptimizationService.js';
import { PriceQualityClassifier } from '../src/services/PriceQualityClassifier.js';
import { DashboardView } from '../src/components/DashboardView.js';
import { PriceComparisonView } from '../src/components/PriceComparisonView.js';
import { BasketOptimizerPanel } from '../src/components/BasketOptimizerPanel.js';
import { DashboardKpiDrilldownModal } from '../src/components/DashboardKpiDrilldownModal.js';
import { LEGAL_CONFIG } from '../src/config/legalConfig.js';
import { app } from '../server.js';
import type { Product, ProductOffer, ShoppingList, ShoppingListItem, Store, UserProfile } from '../src/types.js';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const TODAY = '2026-11-20';
const FUTURE_DATE = '2026-12-31';
const PAST_DATE = '2026-11-01';

const STORES: Store[] = [
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
    sampleAddress: 'București'
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
    sampleAddress: 'București'
  },
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
    sampleAddress: 'București'
  },
  {
    id: 'freshful',
    name: 'Freshful',
    slug: 'freshful',
    chain: 'Freshful',
    brandColor: 'bg-emerald-700',
    accentColor: 'text-emerald-700',
    type: 'supermarket',
    rating: 4.7,
    locationsCount: 1,
    sampleAddress: 'Online'
  }
];

const PRODUCTS: Product[] = [
  {
    id: 'p-lapte',
    name: 'Lapte proaspăt 1.5% 1L',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 6.5
  },
  {
    id: 'p-paine',
    name: 'Pâine albă feliată 500g',
    brand: 'Vel Pitar',
    category: 'Panificație',
    defaultUnit: 'buc',
    packageWeightOrVolume: 500,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 6.0
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
    id: 'p-banane',
    name: 'Banane vrac',
    brand: 'Generic',
    category: 'Fructe și legume',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    isSoldByWeight: true,
    baseReferencePrice: 7.0
  }
];

function makeOffer(overrides: Partial<ProductOffer>): ProductOffer {
  return {
    id: overrides.id || `off-${Math.random().toString(36).slice(2, 8)}`,
    productId: overrides.productId || 'p-lapte',
    storeId: overrides.storeId || 'lidl',
    price: overrides.price ?? 6.0,
    unitPrice: overrides.unitPrice ?? overrides.price ?? 6.0,
    unitPriceMeasure: overrides.unitPriceMeasure || 'lei/l',
    isPromo: overrides.isPromo ?? false,
    validUntil: overrides.validUntil ?? FUTURE_DATE,
    observationDate: overrides.observationDate ?? TODAY,
    source: overrides.source ?? 'official_feed',
    confidenceLevel: overrides.confidenceLevel ?? 'high',
    verificationStatus: overrides.verificationStatus ?? 'verified',
    lastChecked: overrides.lastChecked ?? NOW.toISOString(),
    lastVerifiedAt: overrides.lastVerifiedAt ?? NOW.toISOString(),
    ...overrides
  };
}

const ITEMS_3: ShoppingListItem[] = [
  { id: 'i1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
  { id: 'i2', productId: 'p-paine', name: 'Pâine albă feliată 500g', category: 'Panificație', quantity: 1, unit: 'buc', checked: false },
  { id: 'i3', productId: 'p-oua', name: 'Ouă proaspete M 10 buc', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false }
];

const MOCK_PROFILE: UserProfile = {
  id: 'guest',
  name: 'Vizitator',
  email: '',
  city: 'București',
  monthlySavingsGoal: 300,
  notificationsEnabled: false,
  preferredStores: ['lidl', 'kaufland'],
  defaultTransportCostEstimate: 0,
  useLoyaltyCards: true
};

async function runAuditTests() {
  console.log('🧪 Rulare suită audit comparator prețuri (14 scenarii + domeniu canonic + SSR)...\n');
  let passed = 0;

  async function testCase(name: string, fn: () => void | Promise<void>) {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  // 1. Complete 100% store ALWAYS ranks above cheaper partial store
  await testCase('1. Coș complet (100%) câștigă mereu în fața unui subtotal parțial mai mic', () => {
    const offers: ProductOffer[] = [
      // Penny has only 1/3 at low price (4 lei)
      makeOffer({ productId: 'p-lapte', storeId: 'penny', price: 4.0, unitPrice: 4.0, unitPriceMeasure: 'lei/l' }),
      // Lidl has 3/3 complete basket (7 + 6 + 12 = 25 lei)
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 7.0, unitPrice: 7.0, unitPriceMeasure: 'lei/l' }),
      makeOffer({ productId: 'p-paine', storeId: 'lidl', price: 6.0, unitPrice: 12.0, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-oua', storeId: 'lidl', price: 12.0, unitPrice: 1.2, unitPriceMeasure: 'lei/buc' })
    ];

    const comps = PriceComparisonService.compareBasketAcrossStores(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    assert.equal(comps[0].store.id, 'lidl');
    assert.equal(comps[0].isCompleteBasket, true);
    assert.equal(comps[0].isWinner, true);
    assert.equal(comps[0].isCheapestCompleteBasket, true);
    assert.equal(comps[0].rankingBucket, 'complete');

    const pennyComp = comps.find(c => c.store.id === 'penny')!;
    assert.equal(pennyComp.isCompleteBasket, false);
    assert.equal(pennyComp.isWinner, false);
    assert.equal(pennyComp.rankingBucket, 'partial');
    assert.equal(pennyComp.comparableDiffVsCompleteWinner, null);
  });

  // 2. Partial-only baskets -> NO winner + "Nu există încă un coș complet comparabil"
  await testCase('2. Fără coș complet (ex: 2/3 vs 1/3 vs 0/3) -> niciun câștigător, UI afișează mesaj clar', () => {
    const offers: ProductOffer[] = [
      makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 6.5 }),
      makeOffer({ productId: 'p-paine', storeId: 'kaufland', price: 5.5, unitPrice: 11.0, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-oua', storeId: 'penny', price: 11.0, unitPrice: 1.1, unitPriceMeasure: 'lei/buc' })
    ];

    const comps = PriceComparisonService.compareBasketAcrossStores(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    assert.ok(comps.every(c => !c.isWinner && !c.isCheapestCompleteBasket && !c.isCompleteBasket));
    assert.equal(comps[0].store.id, 'kaufland');
    assert.equal(comps[0].rankingBucket, 'partial');
    assert.equal(comps.find(c => c.store.id === 'freshful')?.rankingBucket, 'no_offers');

    const summary = PriceComparisonService.getPotentialSavingsForList(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    assert.equal(summary.status, 'undetermined');
    assert.equal(summary.isCompleteBasket, false);
    assert.equal(summary.maxSavings, 0);

    const list: ShoppingList = { id: 'l1', name: 'Coș test', items: ITEMS_3, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    const cmpHtml = renderToStaticMarkup(
      React.createElement(PriceComparisonView, {
        activeList: list,
        onNavigateToList: () => {},
        catalogProducts: PRODUCTS,
        catalogOffers: offers,
        catalogStores: STORES
      })
    );
    assert.ok(cmpHtml.includes('Nu există încă un coș complet comparabil'));
    assert.ok(cmpHtml.includes('Economie nedeterminată'));
    assert.ok(cmpHtml.includes('Subtotal produse găsite'));
    assert.ok(cmpHtml.includes('Fără oferte verificate'));
  });

  // 3. 0/N items -> "Fără oferte verificate", never 0,00 lei as basket price
  await testCase('3. Magazin cu 0/N oferte nu afișează 0,00 lei ca preț și intră în no_offers', () => {
    const offers: ProductOffer[] = [
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 }),
      makeOffer({ productId: 'p-paine', storeId: 'lidl', price: 5.0, unitPrice: 10.0, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-oua', storeId: 'lidl', price: 10.0, unitPrice: 1.0, unitPriceMeasure: 'lei/buc' })
    ];
    const comps = PriceComparisonService.compareBasketAcrossStores(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    const freshful = comps.find(c => c.store.id === 'freshful')!;
    assert.equal(freshful.availableItems.length, 0);
    assert.equal(freshful.hasValidOffers, false);
    assert.equal(freshful.rankingBucket, 'no_offers');
    assert.equal(freshful.lastUpdated, 'Fără oferte verificate');

    const dashHtml = renderToStaticMarkup(
      React.createElement(DashboardView, {
        userProfile: MOCK_PROFILE,
        activeList: { id: 'l1', name: 'Demo', items: ITEMS_3, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        receipts: [],
        trackedCount: 0,
        activeAlertCount: 0,
        dataSource: 'local',
        isAuthenticated: false,
        isDemoMode: true,
        catalogProducts: PRODUCTS,
        catalogOffers: offers,
        catalogStores: STORES,
        dashboardLoading: false,
        localImportCounts: { receipts: 0, receiptsWithImages: 0, lists: 0, listItems: 0, alerts: 0, trackedProducts: 0, total: 0 },
        canImportLocalData: false,
        isImportingLocalData: false,
        onImportLocalData: () => {},
        onNavigate: () => {},
        onOpenReceipt: () => {}
      })
    );
    assert.ok(dashHtml.includes('Fără oferte verificate'));
    assert.ok(dashHtml.includes('Previzualizare demonstrativă'));
    assert.ok(dashHtml.includes('Economie nedeterminată'));
  });

  // 4. Same numeric count (2/3) but DIFFERENT subsets -> NOT compared against each other
  await testCase('4. Același număr de produse (2/3) pe subseturi diferite -> zero comparații/economii false', () => {
    const offers: ProductOffer[] = [
      // Kaufland has Lapte + Paine
      makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 6.0 }),
      makeOffer({ productId: 'p-paine', storeId: 'kaufland', price: 5.0, unitPrice: 10.0, unitPriceMeasure: 'lei/kg' }),
      // Penny has Lapte + Oua (different items!)
      makeOffer({ productId: 'p-lapte', storeId: 'penny', price: 5.5 }),
      makeOffer({ productId: 'p-oua', storeId: 'penny', price: 30.0, unitPrice: 3.0, unitPriceMeasure: 'lei/buc' })
    ];
    const comps = PriceComparisonService.compareBasketAcrossStores(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    const k = comps.find(c => c.store.id === 'kaufland')!;
    const p = comps.find(c => c.store.id === 'penny')!;
    assert.equal(k.comparableDiffVsSameCoverageLeader, null);
    assert.equal(p.comparableDiffVsSameCoverageLeader, null);
    assert.equal(k.savingsVsWorst, 0);
    assert.equal(p.savingsVsWorst, 0);

    const opt = BasketOptimizerService.optimize({
      items: ITEMS_3,
      products: PRODUCTS,
      offers,
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(opt.bestSingleStore?.savingsVsWorstStore, null);
  });

  // 5. Two or more complete stores -> deterministic maxSavings + exact store diff
  await testCase('5. 2+ magazine cu coș complet (100%) -> economie determinată exactă și diferențe corecte', () => {
    const offers: ProductOffer[] = [
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 }),
      makeOffer({ productId: 'p-paine', storeId: 'lidl', price: 5.0, unitPrice: 10.0, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-oua', storeId: 'lidl', price: 10.0, unitPrice: 1.0, unitPriceMeasure: 'lei/buc' }),

      makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 7.5 }),
      makeOffer({ productId: 'p-paine', storeId: 'kaufland', price: 6.5, unitPrice: 13.0, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-oua', storeId: 'kaufland', price: 12.0, unitPrice: 1.2, unitPriceMeasure: 'lei/buc' })
    ];
    const comps = PriceComparisonService.compareBasketAcrossStores(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    assert.equal(comps[0].store.id, 'lidl');
    assert.equal(comps[0].grandTotal, 21.0);
    assert.equal(comps[0].isCheapestCompleteBasket, true);
    assert.equal(comps[0].savingsVsWorst, 5.0);
    assert.equal(comps[1].store.id, 'kaufland');
    assert.equal(comps[1].grandTotal, 26.0);
    assert.equal(comps[1].comparableDiffVsCompleteWinner, 5.0);

    const summary = PriceComparisonService.getPotentialSavingsForList(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    assert.equal(summary.status, 'determined');
    assert.equal(summary.maxSavings, 5.0);
    assert.equal(summary.cheapestTotal, 21.0);
    assert.equal(summary.mostExpensiveTotal, 26.0);
    assert.equal(summary.bestStoreName, 'Lidl');
    assert.equal(summary.mostExpensiveStoreName, 'Kaufland');
  });

  // 6. Only 1 complete store -> status 'undetermined', never 0,00 lei savings
  await testCase('6. Un singur magazin cu coș complet -> status undetermined ("Economie nedeterminată")', () => {
    const offers: ProductOffer[] = [
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 }),
      makeOffer({ productId: 'p-paine', storeId: 'lidl', price: 5.0, unitPrice: 10.0, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-oua', storeId: 'lidl', price: 10.0, unitPrice: 1.0, unitPriceMeasure: 'lei/buc' }),
      makeOffer({ productId: 'p-lapte', storeId: 'penny', price: 4.5 })
    ];
    const summary = PriceComparisonService.getPotentialSavingsForList(ITEMS_3, { now: NOW }, PRODUCTS, offers, STORES);
    assert.equal(summary.status, 'undetermined');
    assert.equal(summary.isCompleteBasket, true);
    assert.equal(summary.hasCompleteComparableBaskets, false);
    assert.equal(summary.maxSavings, 0);
    assert.equal(summary.cheapestTotal, 21.0);
  });

  // 7. Centralized freshness, expiration, anomaly, demo/estimated, and regional validation
  await testCase('7. Validare centralizată expirare, surse demo/estimate, anomalii și regiuni', () => {
    const expired = makeOffer({ validUntil: PAST_DATE });
    const missingSrc = makeOffer({ source: '' as any });
    const estimated = makeOffer({ source: 'estimated' });
    const isolated = makeOffer({ verificationStatus: 'isolated' });
    const regionalCluj = makeOffer({ region: 'Cluj-Napoca' });

    assert.equal(PriceComparisonService.isOfferValid(expired, PRODUCTS[0], { now: NOW }), false);
    assert.equal(PriceComparisonService.isOfferValid(missingSrc, PRODUCTS[0], { now: NOW }), false);
    assert.equal(PriceComparisonService.isOfferValid(estimated, PRODUCTS[0], { now: NOW }), false);
    assert.equal(PriceComparisonService.isOfferValid(isolated, PRODUCTS[0], { now: NOW }), false);
    assert.equal(PriceComparisonService.isOfferValid(regionalCluj, PRODUCTS[0], { region: 'București', now: NOW }), false);
    assert.equal(PriceComparisonService.isOfferValid(regionalCluj, PRODUCTS[0], { region: 'Cluj-Napoca', now: NOW }), true);

    const ctxRes = PriceQualityClassifier.validateOfferForContext(regionalCluj, {
      product: PRODUCTS[0],
      region: 'București',
      now: NOW
    });
    assert.equal(ctxRes.valid, false);
  });

  // 8. Conditional promo rules: loyalty card, coupon, minQuantityForPromo across duplicate rows
  await testCase('8. Promoții condiționate (card fidelitate, cupon fără fallback, cantitate minimă cumulată)', () => {
    const promoOffers: ProductOffer[] = [
      makeOffer({
        productId: 'p-lapte',
        storeId: 'lidl',
        price: 5.0,
        normalPrice: 7.0,
        loyaltyPrice: 5.0,
        loyaltyCardRequired: true,
        loyaltyCardName: 'Lidl Plus'
      }),
      makeOffer({
        productId: 'p-lapte',
        storeId: 'kaufland',
        price: 4.5,
        promoPrice: 4.5,
        couponRequired: true,
        couponCode: 'K-APP'
      }),
      makeOffer({
        productId: 'p-lapte',
        storeId: 'penny',
        price: 5.2,
        normalPrice: 6.4,
        promoPrice: 5.2,
        minQuantityForPromo: 2
      })
    ];

    const singleItem: ShoppingListItem[] = [
      { id: 'x1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }
    ];

    // Without coupons and without loyalty card:
    const noCardComps = PriceComparisonService.compareBasketAcrossStores(
      singleItem,
      { useLoyaltyCards: false, useCoupons: false, now: NOW },
      PRODUCTS,
      promoOffers,
      STORES
    );
    assert.equal(noCardComps.find(c => c.store.id === 'lidl')?.grandTotal, 7.0);
    // Kaufland coupon offer without regular price must be excluded when useCoupons=false
    assert.equal(noCardComps.find(c => c.store.id === 'kaufland')?.availableItems.length, 0);
    // Penny minQuantity=2 falls back to normalPrice=6.4 for qty=1
    assert.equal(noCardComps.find(c => c.store.id === 'penny')?.grandTotal, 6.4);

    // Duplicate lines summing to 2L at Penny trigger minQuantityForPromo=2 -> 2 * 5.2 = 10.40
    const dupItems: ShoppingListItem[] = [
      { id: 'd1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
      { id: 'd2', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }
    ];
    const dupComps = PriceComparisonService.compareBasketAcrossStores(
      dupItems,
      { useLoyaltyCards: false, useCoupons: false, now: NOW },
      PRODUCTS,
      promoOffers,
      STORES
    );
    assert.equal(dupComps.find(c => c.store.id === 'penny')?.grandTotal, 10.4);
  });

  // 9. Indivisible package rounding vs bulk weight normalization parity
  await testCase('9. Paritate PriceComparisonService vs BasketOptimizerService (ambalaj indivizibil vs vrac)', () => {
    const offers: ProductOffer[] = [
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.29, unitPrice: 6.29, unitPriceMeasure: 'lei/l' }),
      makeOffer({ productId: 'p-banane', storeId: 'lidl', price: 7.0, unitPrice: 7.0, unitPriceMeasure: 'lei/kg' })
    ];
    const mixedItems: ShoppingListItem[] = [
      { id: 'm1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 500, unit: 'ml', checked: false },
      { id: 'm2', productId: 'p-banane', name: 'Banane vrac', category: 'Fructe și legume', quantity: 500, unit: 'g', checked: false }
    ];
    const comps = PriceComparisonService.compareBasketAcrossStores(mixedItems, { now: NOW }, PRODUCTS, offers, STORES);
    const opt = BasketOptimizerService.optimize({ items: mixedItems, products: PRODUCTS, offers, stores: STORES, options: { now: NOW } });
    // 1L indivisible bottle (6.29) + 0.5kg bulk bananas (3.50) = 9.79
    assert.equal(comps[0].grandTotal, 9.79);
    assert.equal(opt.bestSingleStore?.totalPrice, 9.79);
  });

  // 10. ShoppingListView does NOT invent 10 lei fallback price
  await testCase('10. ShoppingListView nu inventează preț implicit de 10 lei la adăugarea produselor custom', () => {
    const listSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ShoppingListView.tsx'), 'utf8');
    assert.ok(!/useState<number>\(10\)/.test(listSrc));
    assert.ok(listSrc.includes('Subtotal estimativ:') || listSrc.includes('fără preț de referință'));
  });

  // 11. 2-store optimization CTA & Panel undetermined savings string
  await testCase('11. CTA 2 magazine deschide initialMaxStores=2 & BasketOptimizerPanel afișează Economie nedeterminată', () => {
    const cmpSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PriceComparisonView.tsx'), 'utf8');
    assert.ok(cmpSrc.includes('setOptimizationMaxStores(2)'));
    assert.ok(cmpSrc.includes('initialMaxStores={optimizationMaxStores}'));

    const singleStoreOnlyOffers: ProductOffer[] = [
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 })
    ];
    const panelHtml = renderToStaticMarkup(
      React.createElement(BasketOptimizerPanel, {
        activeList: { id: 'l1', name: 'Listă 1 magazin', items: [ITEMS_3[0]], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        products: PRODUCTS,
        offers: singleStoreOnlyOffers,
        stores: STORES,
        initialMaxStores: 2
      })
    );
    assert.ok(panelHtml.includes('Economie nedeterminată'));
    assert.ok(!panelHtml.includes('0,00 lei</span>'));
  });

  // 12. DashboardKpiDrilldownModal uses unified PriceComparisonService logic & shows Economie nedeterminată
  await testCase('12. DashboardKpiDrilldownModal nu inventează economie pe 1 magazin și exclude ofertele expirate', () => {
    const oneStoreOffers: ProductOffer[] = [
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 }),
      makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 3.0, validUntil: PAST_DATE })
    ];
    const modalHtml = renderToStaticMarkup(
      React.createElement(DashboardKpiDrilldownModal, {
        mode: 'potential-savings',
        activeList: { id: 'l1', name: 'Test', items: [ITEMS_3[0]], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        dashboardData: {
          products: PRODUCTS,
          productOffers: oneStoreOffers,
          stores: STORES,
          receipts: [],
          shoppingLists: [],
          priceAlerts: [],
          trackedProductIds: []
        } as any,
        useLoyaltyCards: true,
        onClose: () => {}
      })
    );
    assert.ok(modalHtml.includes('Economie nedeterminată'));
    assert.ok(modalHtml.includes('comparabilitate insuficientă'));
    assert.ok(!modalHtml.includes('3,00 lei'));
  });

  // 13. Canonical domain https://cosulmeu.online/ in SEO, config, Vercel & Express redirect
  await testCase('13. Domeniu canonic https://cosulmeu.online/ configurat în index.html, vercel.json, legalConfig și Express 301', async () => {
    assert.equal(LEGAL_CONFIG.operator.website, 'https://cosulmeu.online/');

    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('<link rel="canonical" href="https://cosulmeu.online/"'));
    assert.ok(indexHtml.includes('property="og:url" content="https://cosulmeu.online/"'));

    const vercelJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8'));
    assert.ok(
      Array.isArray(vercelJson.redirects) &&
        vercelJson.redirects.some(
          (r: any) =>
            r.destination === 'https://cosulmeu.online/:path*' &&
            Array.isArray(r.has) &&
            r.has.some((h: any) => h.value === 'cosulmeu.vercel.app')
        )
    );

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const forwardedRes = await fetch(`http://127.0.0.1:${port}/comparatie?lang=ro`, {
        headers: { 'x-forwarded-host': 'cosulmeu.vercel.app' },
        redirect: 'manual'
      });
      assert.equal(forwardedRes.status, 301);
      assert.equal(forwardedRes.headers.get('location'), 'https://cosulmeu.online/comparatie?lang=ro');

      const directHostRedirect = await new Promise<{ status?: number; location?: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/despre',
            method: 'GET',
            headers: { Host: 'cosulmeu.vercel.app' }
          },
          res => {
            res.resume();
            resolve({ status: res.statusCode, location: res.headers.location });
          }
        );
        req.on('error', reject);
        req.end();
      });
      assert.equal(directHostRedirect.status, 301);
      assert.equal(directHostRedirect.location, 'https://cosulmeu.online/despre');

      const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`, {
        redirect: 'manual'
      });
      assert.equal(healthRes.status, 200);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  // 14. /api/catalog/compare returns consistent comparisons + savingsSummary
  await testCase('14. Endpoint /api/catalog/compare returnează comparații consistente + savingsSummary', async () => {
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/catalog/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: ITEMS_3, options: { useLoyaltyCards: true } })
      });
      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.comparisons));
      assert.ok(data.savingsSummary);
      assert.equal(data.savingsSummary.totalItemsCount, 3);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  console.log(`\n🎉 Rezumat suită audit comparator: ${passed}/14 scenarii trecute!`);
}

runAuditTests().catch(err => {
  console.error('❌ Eroare test audit comparator:', err);
  process.exit(1);
});
