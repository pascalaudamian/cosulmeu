import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { BasketOptimizerService } from '../src/services/BasketOptimizerService.js';
import { BasketOptimizerPanel } from '../src/components/BasketOptimizerPanel.js';
import type { Product, ProductOffer, ShoppingList, ShoppingListItem, Store } from '../src/types.js';

const NOW = new Date('2026-11-25T10:00:00.000Z');
const TODAY = '2026-11-25';
const PAST_DATE = '2024-05-01';
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
  },
  {
    id: 'auchan',
    name: 'Auchan',
    slug: 'auchan',
    chain: 'Auchan',
    brandColor: 'bg-rose-700',
    accentColor: 'text-rose-700',
    type: 'hypermarket',
    rating: 4.5,
    locationsCount: 42,
    sampleAddress: 'România'
  }
];

function makeProduct(id: string, name: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name,
    brand: 'TestBrand',
    category: 'Produse de bază',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 10.0,
    ...overrides
  };
}

function makeOffer(
  overrides: Partial<ProductOffer> & { productId: string; storeId: string; price: number }
): ProductOffer {
  return {
    id: `off-${overrides.productId}-${overrides.storeId}-${Math.random().toString(36).slice(2, 7)}`,
    currency: 'RON',
    unitPrice: overrides.price,
    unitPriceMeasure: 'lei/buc',
    isPromo: false,
    loyaltyCardRequired: false,
    observationDate: TODAY,
    source: 'official_feed',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: NOW.toISOString(),
    lastVerifiedAt: NOW.toISOString(),
    ...overrides
  };
}

let passed = 0;
let failed = 0;

async function testCase(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err?.stack || err?.message || err}`);
  }
}

async function run() {
  console.log('\nFAZA 2.2 — Multi-Store Shopping Basket Optimizer Tests\n');

  const BASE_PRODUCTS: Product[] = Array.from({ length: 10 }, (_, idx) =>
    makeProduct(`p-${idx + 1}`, `Produs Test ${idx + 1}`, {
      defaultUnit: 'buc',
      packageWeightOrVolume: 1,
      packageUnit: 'buc',
      normalizedUnit: 'buc'
    })
  );

  // 1. Listă cu 1 produs -> fără împărțire artificială
  await testCase('1. Listă cu 1 produs -> recomandă 1 singur magazin (nu împarte artificial)', () => {
    const items: ShoppingListItem[] = [
      { id: 'i1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 2, unit: 'buc', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5.5 }),
      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 6.0 })
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 3, now: NOW }
    });
    assert.equal(res.recommendedMultiStore?.storeCount, 1);
    assert.equal(res.recommendedMultiStore?.stops[0].store.id, 'lidl');
    assert.equal(res.recommendedMultiStore?.productsTotal, 11.0);
  });

  // 2. Listă cu 2 produse -> optimizare exactă în 2 magazine
  await testCase('2. Listă cu 2 produse -> împarte optim în 2 magazine când scade costul', () => {
    const items: ShoppingListItem[] = [
      { id: 'i1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: 'i2', productId: 'p-2', name: 'Produs Test 2', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5.0 }),
      makeOffer({ productId: 'p-2', storeId: 'lidl', price: 14.0 }), // total Lidl = 19
      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 12.0 }),
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 6.0 }) // total Kaufland = 18
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 2, now: NOW }
    });
    assert.equal(res.bestSingleStore?.store.id, 'kaufland');
    assert.equal(res.bestSingleStore?.totalPrice, 18);
    assert.equal(res.bestTwoStores?.storeCount, 2);
    assert.equal(res.bestTwoStores?.productsTotal, 11); // 5 + 6
    assert.equal(res.bestTwoStores?.hasValidSavingsBaseline, true);
    assert.equal(res.bestTwoStores?.savingsVsBestSingleStore, 7);
  });

  // 3. Listă cu 10 produse -> optimizare multi-magazin cu economii reale
  await testCase('3. Listă cu 10 produse -> alocare corectă max 3 magazine și economii exacte', () => {
    const items: ShoppingListItem[] = BASE_PRODUCTS.map((p, idx) => ({
      id: `i-${idx + 1}`,
      productId: p.id,
      name: p.name,
      category: 'Produse de bază',
      quantity: 1,
      unit: 'buc',
      checked: false
    }));

    const offers: ProductOffer[] = [];
    for (let i = 0; i < 10; i++) {
      const pid = `p-${i + 1}`;
      // Lidl ieftin pe 1..4 (5 lei), scump pe restul (12 lei) => single = 4*5 + 6*12 = 92
      offers.push(makeOffer({ productId: pid, storeId: 'lidl', price: i < 4 ? 5 : 12 }));
      // Kaufland ieftin pe 5..7 (5 lei), scump pe restul (12 lei) => single = 3*5 + 7*12 = 99
      offers.push(makeOffer({ productId: pid, storeId: 'kaufland', price: i >= 4 && i < 7 ? 5 : 12 }));
      // Carrefour ieftin pe 8..10 (5 lei), scump pe restul (12 lei) => single = 3*5 + 7*12 = 99
      offers.push(makeOffer({ productId: pid, storeId: 'carrefour', price: i >= 7 ? 5 : 12 }));
    }

    const res = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 3, now: NOW }
    });
    assert.equal(res.bestSingleStore?.store.id, 'lidl');
    assert.equal(res.bestSingleStore?.totalPrice, 92);
    assert.equal(res.bestThreeStores?.storeCount, 3);
    assert.equal(res.bestThreeStores?.productsTotal, 50); // 10 * 5
    assert.equal(res.bestThreeStores?.savingsVsBestSingleStore, 42);
    assert.equal(res.bestThreeStores?.isComplete, true);
  });

  // 4. Listă mare (150 produse × 6 magazine) -> performanță rapidă, deterministă, fără blocare
  await testCase('4. Listă mare (150 produse × 6 magazine) -> execuție rapidă și deterministă (<250ms)', () => {
    const bigProducts: Product[] = Array.from({ length: 150 }, (_, idx) =>
      makeProduct(`big-${idx}`, `Produs Mare ${idx}`)
    );
    const bigItems: ShoppingListItem[] = bigProducts.map((p, idx) => ({
      id: `bi-${idx}`,
      productId: p.id,
      name: p.name,
      category: 'Produse de bază',
      quantity: 1 + (idx % 3),
      unit: 'buc',
      checked: false
    }));
    const bigStores: Store[] = [
      ...STORES,
      {
        id: 'profi',
        name: 'Profi',
        slug: 'profi',
        chain: 'Profi',
        brandColor: 'bg-orange-600',
        accentColor: 'text-orange-600',
        type: 'supermarket',
        rating: 4.1,
        locationsCount: 1600,
        sampleAddress: 'România'
      }
    ];
    const bigOffers: ProductOffer[] = [];
    for (let i = 0; i < 150; i++) {
      for (let s = 0; s < bigStores.length; s++) {
        const price = 5 + ((i * 7 + s * 3) % 11);
        bigOffers.push(makeOffer({ productId: `big-${i}`, storeId: bigStores[s].id, price }));
      }
    }

    const t0 = Date.now();
    const run1 = BasketOptimizerService.optimize({
      items: bigItems,
      products: bigProducts,
      offers: bigOffers,
      stores: bigStores,
      options: { maxStores: 3, now: NOW }
    });
    const elapsed = Date.now() - t0;

    const run2 = BasketOptimizerService.optimize({
      items: bigItems,
      products: bigProducts,
      offers: bigOffers,
      stores: bigStores,
      options: { maxStores: 3, now: NOW }
    });

    assert.ok(elapsed < 1000, `Optimizarea pe 150 produse a durat ${elapsed}ms (prea mult)`);
    assert.equal(run1.recommendedMultiStore?.productsTotal, run2.recommendedMultiStore?.productsTotal);
    assert.equal(run1.recommendedMultiStore?.coveredItemsCount, 150);
    assert.equal(run1.solverMetadata?.strategy, 'exact_branch_and_bound');
    assert.equal(run1.solverMetadata?.isProvenGlobalOptimum, true);
  });

  // 5-8. Limite magazine: maxStores = 1, 2, 3, Toate eligibile (5)
  await testCase('5-8. Respectă strict limitele 1, 2, 3 și Toate eligibile (5 magazine)', () => {
    const prod5 = BASE_PRODUCTS.slice(0, 5);
    const items: ShoppingListItem[] = prod5.map((p, idx) => ({
      id: `l-${idx}`,
      productId: p.id,
      name: p.name,
      category: 'Produse de bază',
      quantity: 1,
      unit: 'buc',
      checked: false
    }));
    const offers: ProductOffer[] = [];
    for (let i = 0; i < 5; i++) {
      for (let s = 0; s < 5; s++) {
        offers.push(makeOffer({ productId: prod5[i].id, storeId: STORES[s].id, price: i === s ? 6 : 12 }));
      }
    }

    const r1 = BasketOptimizerService.optimize({ items, products: prod5, offers, stores: STORES, options: { maxStores: 1, now: NOW } });
    const r2 = BasketOptimizerService.optimize({ items, products: prod5, offers, stores: STORES, options: { maxStores: 2, now: NOW } });
    const r3 = BasketOptimizerService.optimize({ items, products: prod5, offers, stores: STORES, options: { maxStores: 3, now: NOW } });
    const rAll = BasketOptimizerService.optimize({ items, products: prod5, offers, stores: STORES, options: { maxStores: STORES.length, now: NOW } });

    assert.equal(r1.recommendedMultiStore?.storeCount, 1);
    assert.equal(r1.recommendedMultiStore?.productsTotal, 54); // 1*6 + 4*12
    assert.equal(r2.recommendedMultiStore?.storeCount, 2);
    assert.equal(r2.recommendedMultiStore?.productsTotal, 48); // 2*6 + 3*12
    assert.equal(r3.recommendedMultiStore?.storeCount, 3);
    assert.equal(r3.recommendedMultiStore?.productsTotal, 42); // 3*6 + 2*12
    assert.equal(rAll.recommendedMultiStore?.storeCount, 5);
    assert.equal(rAll.recommendedMultiStore?.productsTotal, 30); // 5*6
  });

  // 9-10. Economie reală vs niciun avantaj (fără economie falsă)
  await testCase('9-10. Nu împarte inutil și nu declară economie falsă când single-store este la fel de bun/mai ieftin', () => {
    const items: ShoppingListItem[] = [
      { id: '1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: '2', productId: 'p-2', name: 'Produs Test 2', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 4.0 }),
      makeOffer({ productId: 'p-2', storeId: 'lidl', price: 5.0 }),
      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 6.0 }),
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 5.0 })
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 3, now: NOW }
    });
    assert.equal(res.recommendedMultiStore?.storeCount, 1);
    assert.equal(res.recommendedMultiStore?.stops[0].store.id, 'lidl');
    assert.equal(res.recommendedMultiStore?.savingsVsBestSingleStore, 0);
  });

  // 11-12. Excludere strictă & Favorite tie-break fără falsificarea prețurilor
  await testCase('11-12. Magazine excluse blocate complet; favorite fac tie-break fără a bate preț mai mic', () => {
    const items: ShoppingListItem[] = [
      { id: '1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: '2', productId: 'p-2', name: 'Produs Test 2', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5.0 }),
      makeOffer({ productId: 'p-2', storeId: 'lidl', price: 5.0 }),
      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 8.0 }),
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 8.0 }),
      makeOffer({ productId: 'p-1', storeId: 'carrefour', price: 8.0 }),
      makeOffer({ productId: 'p-2', storeId: 'carrefour', price: 8.0 }),
      makeOffer({ productId: 'p-1', storeId: 'penny', price: 9.0 }),
      makeOffer({ productId: 'p-2', storeId: 'penny', price: 9.0 })
    ];
    const resTie = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 2, excludedStoreIds: ['lidl'], favoriteStoreIds: ['carrefour'], now: NOW }
    });
    assert.ok(!resTie.recommendedMultiStore?.stops.some(s => s.store.id === 'lidl'));
    assert.equal(resTie.recommendedMultiStore?.stops[0].store.id, 'carrefour');

    // Favorite Penny (9+9=18) MUST NOT beat cheaper Kaufland/Carrefour (8+8=16)
    const offersCheaper = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5.0 }),
      makeOffer({ productId: 'p-2', storeId: 'lidl', price: 5.0 }),
      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 8.0 }),
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 8.0 }),
      makeOffer({ productId: 'p-1', storeId: 'penny', price: 9.0 }),
      makeOffer({ productId: 'p-2', storeId: 'penny', price: 9.0 })
    ];
    const resCheaperWins = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers: offersCheaper,
      stores: STORES,
      options: { maxStores: 2, excludedStoreIds: ['lidl'], favoriteStoreIds: ['penny'], now: NOW }
    });
    assert.equal(resCheaperWins.recommendedMultiStore?.stops[0].store.id, 'kaufland');
    assert.equal(resCheaperWins.recommendedMultiStore?.productsTotal, 16);
  });

  // 13-16. Fără preț, acoperire unică într-un magazin, matching nesigur, conflict unități
  await testCase('13-16. Separă fără preț, acoperire unică într-un magazin, matching nesigur și conflict unități', () => {
    const items: ShoppingListItem[] = [
      { id: 'ok1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: 'only-one', productId: 'p-2', name: 'Produs Test 2', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: 'no-price', productId: 'p-3', name: 'Produs Test 3', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: 'unconf', name: 'Produs Generic Necunoscut', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false },
      { id: 'unit-bad', productId: 'p-4', name: 'Produs Test 4', category: 'Produse de bază', quantity: 1, unit: 'l', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5.0 }),
      // p-2 există DOAR la Kaufland => multi-store Lidl+Kaufland acoperă 2/2 comparabile!
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 8.0 }),
      makeOffer({ productId: 'p-4', storeId: 'lidl', price: 10.0 })
    ];

    const res = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 3, now: NOW }
    });

    assert.equal(res.itemsWithoutAnyValidPrice.length, 1);
    assert.equal(res.unconfidentMatches.length, 1);
    assert.equal(res.unitConflicts.length, 1);
    assert.equal(res.recommendedMultiStore?.storeCount, 2);
    assert.equal(res.recommendedMultiStore?.coveredItemsCount, 2);
    assert.equal(res.recommendedMultiStore?.productsTotal, 13.0);
    assert.equal(res.recommendedMultiStore?.isComplete, false);
    assert.equal(res.recommendedMultiStore?.coverageStatusRo, 'PARȚIAL');
    // Best single store covered 1/2 (Lidl or Kaufland), multi covered 2/2 -> NO fake savings!
    assert.equal(res.recommendedMultiStore?.hasValidSavingsBaseline, false);
    assert.equal(res.recommendedMultiStore?.savingsVsBestSingleStore, null);
  });

  // 17-19. Oferte expirate, non-RON (EUR), promoții condiționate în multi-store
  await testCase('17-19. Exclude expirate și EUR; aplică promoții condiționate în multi-store', () => {
    const items: ShoppingListItem[] = [
      { id: 'i1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: 'i2', productId: 'p-2', name: 'Produs Test 2', category: 'Produse de bază', quantity: 2, unit: 'buc', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5.0, validUntil: PAST_DATE }),
      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 1.2, currency: 'EUR' }),
      makeOffer({ productId: 'p-1', storeId: 'carrefour', price: 6.5, normalPrice: 9.0, loyaltyPrice: 6.5, loyaltyCardRequired: true, loyaltyCardName: 'Carrefour Act for Good', isPromo: true, validUntil: FUTURE_DATE }),
      makeOffer({ productId: 'p-2', storeId: 'penny', price: 7.0, normalPrice: 9.5, promoPrice: 7.0, minQuantityForPromo: 2, isPromo: true })
    ];

    const resWithLoyalty = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 2, useLoyaltyCards: true, now: NOW }
    });
    assert.equal(resWithLoyalty.recommendedMultiStore?.storeCount, 2);
    assert.equal(resWithLoyalty.recommendedMultiStore?.productsTotal, 6.5 + 14.0); // 20.5

    const resNoLoyalty = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 2, useLoyaltyCards: false, now: NOW }
    });
    assert.equal(resNoLoyalty.recommendedMultiStore?.productsTotal, 9.0 + 14.0); // 23.0
  });

  // 20. Alias canonical multi-hop + respingere ciclu/orfan
  await testCase('20. Rezolvă aliasuri multi-hop și respinge ciclurile/orfanii în multi-store', () => {
    const prods: Product[] = [
      makeProduct('root-1', 'Unt 200g'),
      makeProduct('alias-1', 'Unt 200g alias 1', { canonicalProductId: 'root-1' }),
      makeProduct('alias-2', 'Unt 200g alias 2', { canonicalProductId: 'alias-1' }),
      makeProduct('cyc-a', 'Ciclu A', { canonicalProductId: 'cyc-b' }),
      makeProduct('cyc-b', 'Ciclu B', { canonicalProductId: 'cyc-a' }),
      makeProduct('orphan', 'Orfan', { canonicalProductId: 'non-existent-root' })
    ];
    const items: ShoppingListItem[] = [
      { id: '1', productId: 'alias-2', name: 'Unt alias 2', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false },
      { id: '2', productId: 'cyc-a', name: 'Ciclu A', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false },
      { id: '3', productId: 'orphan', name: 'Orfan', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'alias-1', storeId: 'lidl', price: 9.5 }),
      makeOffer({ productId: 'cyc-a', storeId: 'kaufland', price: 2.0 }),
      makeOffer({ productId: 'orphan', storeId: 'carrefour', price: 2.0 })
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: prods,
      offers,
      stores: STORES,
      options: { maxStores: 3, now: NOW }
    });
    assert.equal(res.recommendedMultiStore?.coveredItemsCount, 1);
    assert.equal(res.recommendedMultiStore?.productsTotal, 9.5);
    assert.equal(res.recommendedMultiStore?.stops[0].allocations[0].product.id, 'root-1');
    assert.equal(res.unconfidentMatches.length, 2);
  });

  // 21. Nu omite produse pentru un total artificial mai mic și nu compară acoperiri diferite ca echivalente
  await testCase('21. Acoperire prioritară: nu omite produse pentru un preț artificial mic și detectează acoperire diferită', () => {
    const items: ShoppingListItem[] = [
      { id: '1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: '2', productId: 'p-2', name: 'Produs Test 2', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false }
    ];
    const offers = [
      // Lidl are doar p-1 foarte ieftin (5 RON)
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5.0 }),
      // Kaufland are ambele produse (12 + 12 = 24 RON)
      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 12.0 }),
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 12.0 })
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 2, now: NOW }
    });
    assert.equal(res.bestSingleStore?.store.id, 'kaufland'); // 2/2 bate 1/2
    assert.equal(res.recommendedMultiStore?.coveredItemsCount, 2);
    assert.equal(res.recommendedMultiStore?.productsTotal, 17.0); // 5 + 12
    assert.equal(res.recommendedMultiStore?.hasValidSavingsBaseline, true);
    assert.equal(res.recommendedMultiStore?.savingsVsBestSingleStore, 7.0);
  });

  // 22-23. Revision token, fără cost transport inventat & limitări explicite
  await testCase('22-23. Propagă clientRevision/revisionToken și exclude explicit costuri de transport inventate', () => {
    const items: ShoppingListItem[] = [
      { id: '1', productId: 'p-1', name: 'Produs Test 1', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false },
      { id: '2', productId: 'p-2', name: 'Produs Test 2', category: 'Produse de bază', quantity: 1, unit: 'buc', checked: false }
    ];
    const offers = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 5 }),
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 6 })
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: BASE_PRODUCTS,
      offers,
      stores: STORES,
      options: { maxStores: 2, clientRevision: 'rev-faza22-xyz', now: NOW }
    });
    assert.equal(res.revisionToken, 'rev-faza22-xyz');
    assert.equal(res.recommendedMultiStore?.transportCost, 0);
    assert.equal(res.recommendedMultiStore?.includesTransportCost, false);
    assert.equal(res.recommendedMultiStore?.totalWithTransport, res.recommendedMultiStore?.productsTotal);
    assert.ok(
      res.limitations.some(l => l.toLowerCase().includes('transport') && l.toLowerCase().includes('nu sunt incluse'))
    );
  });

  // 24. Securitate & API endpoint /api/basket/optimize (auth, validare, cache-control, rate limit)
  await testCase('24. Securitate /api/basket/optimize: 401 pe listId fără auth, 400 pe maxStores=99, 200 valid multi-store, 429 rate limit', async () => {
    const { app } = await import('../server.ts');
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const rNoAuth = await fetch(`${baseUrl}/api/basket/optimize/33333333-3333-4333-8333-333333333333`);
      assert.equal(rNoAuth.status, 401);

      const rInvalidLimit = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [], options: { maxStores: 99 } })
      });
      assert.equal(rInvalidLimit.status, 400);

      const rOk = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listName: 'Faza 2.2 API',
          items: [{ id: '1', name: 'Lapte', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
          options: { maxStores: 5, useLoyaltyCards: true, transportCostPerExtraStore: 0 }
        })
      });
      assert.equal(rOk.status, 200);
      const body = await rOk.json();
      assert.equal(body.success, true);
      assert.equal(body.optimization.maxStoresApplied, 5);
      assert.ok(body.optimization.solverMetadata?.strategy);

      let saw429 = false;
      for (let i = 0; i < 95; i++) {
        const rl = await fetch(`${baseUrl}/api/basket/optimize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-enforce-rate-limit': 'true' },
          body: JSON.stringify({ items: [] })
        });
        if (rl.status === 429) {
          saw429 = true;
          break;
        }
      }
      assert.equal(saw429, true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  // 25. Greedy-trap + Heuristic fallback verification + UI SSR multi-store & ShoppingListView toggle
  await testCase('25. Exact B&B învinge capcana greedy + euristică deterministă peste buget + UI multi-store SSR', () => {
    // A) Greedy trap for maxStores = 2:
    // Store 1 (Lidl, single best = 24 RON): A=8, B=8, C=8 (Kaufland single = 25, Carrefour single = 32)
    // Greedy picking from Store 1 gets Lidl + Kaufland = 8 + 6 + 6 = 20 RON
    // True global optimum Kaufland + Carrefour = min(13,6) + min(6,13) + min(6,13) = 18 RON!
    const trapProducts = BASE_PRODUCTS.slice(0, 3);
    const trapItems: ShoppingListItem[] = trapProducts.map((p, idx) => ({
      id: `t-${idx}`,
      productId: p.id,
      name: p.name,
      category: 'Produse de bază',
      quantity: 1,
      unit: 'buc',
      checked: false
    }));
    const trapOffers: ProductOffer[] = [
      makeOffer({ productId: 'p-1', storeId: 'lidl', price: 8 }),
      makeOffer({ productId: 'p-2', storeId: 'lidl', price: 8 }),
      makeOffer({ productId: 'p-3', storeId: 'lidl', price: 8 }),

      makeOffer({ productId: 'p-1', storeId: 'kaufland', price: 13 }),
      makeOffer({ productId: 'p-2', storeId: 'kaufland', price: 6 }),
      makeOffer({ productId: 'p-3', storeId: 'kaufland', price: 6 }),

      makeOffer({ productId: 'p-1', storeId: 'carrefour', price: 6 }),
      makeOffer({ productId: 'p-2', storeId: 'carrefour', price: 13 }),
      makeOffer({ productId: 'p-3', storeId: 'carrefour', price: 13 })
    ];
    const trapRes = BasketOptimizerService.optimize({
      items: trapItems,
      products: trapProducts,
      offers: trapOffers,
      stores: STORES,
      options: { maxStores: 2, now: NOW }
    });
    assert.equal(trapRes.bestSingleStore?.store.id, 'lidl');
    assert.equal(trapRes.bestTwoStores?.productsTotal, 18);
    assert.equal(trapRes.solverMetadata?.strategy, 'exact_branch_and_bound');
    assert.equal(trapRes.solverMetadata?.isProvenGlobalOptimum, true);

    // B) Peste bugetul exact (16 magazine × maxStores=6 -> combCount > 4500) => deterministic_heuristic
    const manyStores: Store[] = Array.from({ length: 16 }, (_, sIdx) => ({
      id: `st-${sIdx}`,
      name: `Magazin ${sIdx + 1}`,
      slug: `st-${sIdx}`,
      chain: `Magazin ${sIdx + 1}`,
      brandColor: 'bg-slate-700',
      accentColor: 'text-slate-700',
      type: 'supermarket',
      rating: 4.3,
      locationsCount: 10,
      sampleAddress: 'România'
    }));
    const manyOffers: ProductOffer[] = [];
    for (let i = 0; i < 6; i++) {
      for (let s = 0; s < 16; s++) {
        manyOffers.push(makeOffer({ productId: `p-${i + 1}`, storeId: manyStores[s].id, price: i === s ? 6 : 12 }));
      }
    }
    const heurItems: ShoppingListItem[] = BASE_PRODUCTS.slice(0, 6).map((p, i) => ({
      id: `h-${i}`,
      productId: p.id,
      name: p.name,
      category: 'Produse de bază',
      quantity: 1,
      unit: 'buc',
      checked: false
    }));
    const h1 = BasketOptimizerService.optimize({
      items: heurItems,
      products: BASE_PRODUCTS.slice(0, 6),
      offers: manyOffers,
      stores: manyStores,
      options: { maxStores: 6, now: NOW }
    });
    const h2 = BasketOptimizerService.optimize({
      items: heurItems,
      products: BASE_PRODUCTS.slice(0, 6),
      offers: manyOffers,
      stores: manyStores,
      options: { maxStores: 6, now: NOW }
    });
    assert.equal(h1.solverMetadata?.strategy, 'deterministic_heuristic');
    assert.equal(h1.solverMetadata?.isProvenGlobalOptimum, false);
    assert.equal(h1.recommendedMultiStore?.productsTotal, h2.recommendedMultiStore?.productsTotal);
    assert.ok(h1.limitations.some(l => l.includes('euristic determinist')));

    // C) SSR multi-store UI check
    const activeList: ShoppingList = {
      id: 'l-ssr',
      name: 'Listă Multi',
      items: trapItems,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    };
    const html = renderToStaticMarkup(
      React.createElement(BasketOptimizerPanel, {
        activeList,
        products: trapProducts,
        offers: trapOffers,
        stores: STORES,
        initialMaxStores: 3,
        singleStoreOnly: false
      })
    );
    assert.ok(html.includes('Optimizator Multi-Magazin'));
    assert.ok(html.includes('Selector număr magazine'));
    assert.ok(html.includes('Max 2'));
    assert.ok(html.includes('Max 3'));
    assert.ok(html.includes('Toate eligibile'));
    assert.ok(!html.includes('(nelimitat)'));
    assert.ok(!html.includes('id="optimizer-transport"'));
    assert.ok(html.includes('Transport și timp deplasare: neincluse'));
    assert.ok(html.includes('COMPLET'));

    // D) ShoppingListView keeps FAZA 2.1 invariants AND provides multi-store switcher
    const slSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ShoppingListView.tsx'), 'utf8');
    assert.ok(slSrc.includes('initialMaxStores={1}'));
    assert.ok(slSrc.includes('singleStoreOnly={true}'));
    assert.ok(slSrc.includes('Multi-magazin'));
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
