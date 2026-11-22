import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { BasketOptimizerService } from '../src/services/BasketOptimizerService.js';
import { PriceQualityClassifier } from '../src/services/PriceQualityClassifier.js';
import type { Product, ProductOffer, ShoppingListItem, Store } from '../src/types.js';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const TODAY = '2026-11-20';
const OLD_10_DAYS = '2026-11-10';
const PAST_DATE = '2025-01-01';
const FUTURE_DATE = '2099-12-31';

const STORES: Store[] = [
  {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    chain: 'Lidl',
    brandColor: 'bg-blue-600',
    accentColor: 'text-blue-600',
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
    brandColor: 'bg-red-600',
    accentColor: 'text-red-600',
    type: 'hypermarket',
    rating: 4.5,
    locationsCount: 180,
    sampleAddress: 'România'
  },
  {
    id: 'carrefour',
    name: 'Carrefour',
    slug: 'carrefour',
    chain: 'Carrefour',
    brandColor: 'bg-sky-600',
    accentColor: 'text-sky-600',
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
    rating: 4.3,
    locationsCount: 380,
    sampleAddress: 'România'
  }
];

const PRODUCTS: Product[] = [
  {
    id: 'p-lapte-1l',
    name: 'Lapte proaspăt 1.5% 1L',
    brand: 'Napolact',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941014002343',
    baseReferencePrice: 7.0
  },
  {
    id: 'p-unt-200g',
    name: 'Unt de masă 82% 200g',
    brand: 'Albalact',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.2,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941014008912',
    baseReferencePrice: 13.0
  },
  {
    id: 'p-carne-vrac',
    name: 'Piept de pui dezosat vrac',
    brand: 'Agricola',
    category: 'Carne și pește',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    isSoldByWeight: true,
    baseReferencePrice: 28.0
  },
  {
    id: 'p-apa-multipack',
    name: 'Apă minerală plată 6 x 0.5L',
    brand: 'Borsec',
    category: 'Băuturi',
    defaultUnit: 'pachet',
    packageWeightOrVolume: 3,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5942001000001',
    baseReferencePrice: 15.0
  },
  {
    id: 'p-iaurt-capsuni',
    name: 'Iaurt cu căpșuni 400g',
    brand: 'Danone',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.4,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 7.5
  },
  {
    id: 'p-cola-normal',
    name: 'Băutură carbogazoasă Cola 2L',
    brand: 'Coca-Cola',
    category: 'Băuturi',
    defaultUnit: 'l',
    packageWeightOrVolume: 2,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 11.0
  },
  {
    id: 'p-oua-10',
    name: 'Ouă proaspete M 10 buc',
    brand: 'Toneli',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 10,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 12.0
  },
  {
    id: 'p-detergent-bio',
    name: 'Detergent lichid Bio 2L',
    brand: 'EcoClean',
    category: 'Curățenie',
    defaultUnit: 'l',
    packageWeightOrVolume: 2,
    packageUnit: 'l',
    normalizedUnit: 'l',
    isBio: true,
    baseReferencePrice: 40.0
  }
];

function offer(overrides: Partial<ProductOffer>): ProductOffer {
  return {
    id: overrides.id || `off-${Math.random().toString(36).slice(2, 8)}`,
    productId: overrides.productId || 'p-lapte-1l',
    storeId: overrides.storeId || 'lidl',
    price: overrides.price ?? 6.5,
    unitPrice: overrides.unitPrice ?? overrides.price ?? 6.5,
    unitPriceMeasure: overrides.unitPriceMeasure || 'lei/l',
    isPromo: overrides.isPromo ?? false,
    promoDetails: overrides.promoDetails,
    loyaltyCardRequired: overrides.loyaltyCardRequired,
    loyaltyCardName: overrides.loyaltyCardName,
    loyaltyPrice: overrides.loyaltyPrice,
    couponRequired: overrides.couponRequired,
    couponCode: overrides.couponCode,
    minQuantityForPromo: overrides.minQuantityForPromo,
    normalPrice: overrides.normalPrice,
    originalPrice: overrides.originalPrice,
    promoPrice: overrides.promoPrice,
    region: overrides.region,
    validUntil: overrides.validUntil,
    observationDate: overrides.observationDate !== undefined ? overrides.observationDate : TODAY,
    source: overrides.source !== undefined ? overrides.source : 'official_feed',
    confidenceLevel: overrides.confidenceLevel || 'high',
    verificationStatus: overrides.verificationStatus || 'verified',
    lastChecked: overrides.lastChecked !== undefined ? overrides.lastChecked : NOW.toISOString(),
    lastVerifiedAt: overrides.lastVerifiedAt !== undefined ? overrides.lastVerifiedAt : NOW.toISOString()
  };
}

async function run() {
  console.log('🧪 Suită completă de edge-case-uri Optimizator Inteligent de Coș (21 scenarii)...\n');
  let passed = 0;
  const runCase = async (label: string, fn: () => void | Promise<void>) => {
    await fn();
    console.log(`✅ [PASS] ${label}`);
    passed++;
  };

  await runCase('1. Listă goală -> zero totaluri, fără erori sau magazine inventate', () => {
    const res = BasketOptimizerService.optimize({
      list: { id: 'empty', name: 'Listă goală' },
      items: [],
      products: PRODUCTS,
      offers: [],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.totalRequestedLines, 0);
    assert.equal(res.singleStoreRankings.length, 0);
    assert.equal(res.bestSingleStore, null);
    assert.equal(res.recommendedMultiStore, null);
  });

  await runCase('2. Un singur produs -> optimizare corectă 1 magazin și fără împărțire artificială', () => {
    const res = BasketOptimizerService.optimize({
      items: [
        { id: '1', productId: 'p-lapte-1l', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }
      ],
      products: PRODUCTS,
      offers: [
        offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 6.2 }),
        offer({ productId: 'p-lapte-1l', storeId: 'kaufland', price: 6.9 })
      ],
      stores: STORES,
      options: { maxStores: 3, now: NOW }
    });
    assert.equal(res.bestSingleStore?.store.id, 'lidl');
    assert.equal(res.bestSingleStore?.totalPrice, 6.2);
    assert.equal(res.recommendedMultiStore?.storeCount, 1);
    assert.equal(res.recommendedMultiStore?.productsTotal, 6.2);
  });

  await runCase('3. Produse duplicate -> cumulare cantitate fără dublarea articolului distinct', () => {
    const res = BasketOptimizerService.optimize({
      items: [
        { id: 'd1', productId: 'p-unt-200g', name: 'Unt 200g', category: 'Lactate și ouă', quantity: 200, unit: 'g', checked: false },
        { id: 'd2', productId: 'p-unt-200g', name: 'Unt 200g', category: 'Lactate și ouă', quantity: 0.2, unit: 'kg', checked: false }
      ],
      products: PRODUCTS,
      offers: [offer({ productId: 'p-unt-200g', storeId: 'lidl', price: 11.5, unitPrice: 57.5, unitPriceMeasure: 'lei/kg' })],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.totalRequestedLines, 2);
    assert.equal(res.distinctNormalizedItemsCount, 1);
    assert.equal(res.duplicateLinesMergedCount, 1);
    // 200g + 200g = 400g => exact 2 pachete de 200g = 23.00 lei, surplus 0
    assert.equal(res.bestSingleStore?.totalPrice, 23.0);
    assert.equal(res.bestSingleStore?.allocations[0].packagesCount, 2);
    assert.equal(res.bestSingleStore?.allocations[0].surplusQuantity, 0);
  });

  await runCase('4. Cantități fracționare (0.5 kg carne vrac vs 1.5 L lapte ambalat)', () => {
    const res = BasketOptimizerService.optimize({
      items: [
        { id: 'c1', productId: 'p-carne-vrac', name: 'Piept de pui dezosat vrac', category: 'Carne și pește', quantity: 0.5, unit: 'kg', checked: false }
      ],
      products: PRODUCTS,
      offers: [offer({ productId: 'p-carne-vrac', storeId: 'kaufland', price: 28.0, unitPrice: 28.0, unitPriceMeasure: 'lei/kg' })],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.bestSingleStore?.totalPrice, 14.0);
    assert.equal(res.bestSingleStore?.allocations[0].isIndivisiblePackage, false);
    assert.equal(res.bestSingleStore?.allocations[0].surplusQuantity, 0);
  });

  await runCase('5. Ambalaje indivizibile (1.5L lapte la 1L => 2 buc, 300g unt la 200g => 2 buc, multipack 7 buc => 2 pachete)', () => {
    const res = BasketOptimizerService.optimize({
      items: [
        { id: 'm1', productId: 'p-lapte-1l', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1.5, unit: 'l', checked: false },
        { id: 'm2', productId: 'p-unt-200g', name: 'Unt 200g', category: 'Lactate și ouă', quantity: 300, unit: 'g', checked: false },
        { id: 'm3', productId: 'p-apa-multipack', name: 'Apă 6 x 0.5L', category: 'Băuturi', quantity: 7, unit: 'buc', checked: false }
      ],
      products: PRODUCTS,
      offers: [
        offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 6.0, unitPrice: 6.0, unitPriceMeasure: 'lei/l' }),
        offer({ productId: 'p-unt-200g', storeId: 'lidl', price: 12.0, unitPrice: 60.0, unitPriceMeasure: 'lei/kg' }),
        offer({ productId: 'p-apa-multipack', storeId: 'lidl', price: 15.0, unitPrice: 5.0, unitPriceMeasure: 'lei/l' })
      ],
      stores: STORES,
      options: { now: NOW }
    });
    const allocs = res.bestSingleStore!.allocations;
    const milk = allocs.find(a => a.product.id === 'p-lapte-1l')!;
    const butter = allocs.find(a => a.product.id === 'p-unt-200g')!;
    const water = allocs.find(a => a.product.id === 'p-apa-multipack')!;

    assert.equal(milk.packagesCount, 2);
    assert.equal(milk.purchasedQuantity, 2);
    assert.equal(milk.surplusQuantity, 0.5);
    assert.equal(milk.calculatedPrice, 12.0);

    assert.equal(butter.packagesCount, 2);
    assert.equal(butter.purchasedQuantity, 400);
    assert.equal(butter.surplusQuantity, 100);
    assert.equal(butter.calculatedPrice, 24.0);

    assert.equal(water.packagesCount, 2);
    assert.equal(water.purchasedQuantity, 12);
    assert.equal(water.surplusQuantity, 5);
    assert.equal(water.calculatedPrice, 30.0);

    assert.equal(res.bestSingleStore?.totalPrice, 66.0);
  });

  await runCase('6. Produse cu gramaje diferite -> NU confundă 500g cu 200g sau 1.5L cu 1L la matching', () => {
    const items: ShoppingListItem[] = [
      { id: 'w1', name: 'Unt de masă 82% 500g', brand: 'Albalact', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false },
      { id: 'w2', name: 'Lapte proaspăt 1.5% 1.5L', brand: 'Napolact', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false }
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: PRODUCTS,
      offers: [
        offer({ productId: 'p-unt-200g', storeId: 'lidl', price: 12.0, unitPrice: 60.0, unitPriceMeasure: 'lei/kg' }),
        offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 6.5, unitPrice: 6.5, unitPriceMeasure: 'lei/l' })
      ],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.unconfidentMatches.length, 2);
    assert.equal(res.comparableCatalogItemsCount, 0);
  });

  await runCase('7. Produse cu unități diferite -> detectare strictă conflict kg vs buc / l vs kg', () => {
    const res = BasketOptimizerService.optimize({
      items: [
        { id: 'uc1', productId: 'p-oua-10', name: 'Ouă 10 buc', category: 'Lactate și ouă', quantity: 2, unit: 'kg', checked: false },
        { id: 'uc2', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'kg', checked: false }
      ],
      products: PRODUCTS,
      offers: [
        offer({ productId: 'p-oua-10', storeId: 'lidl', price: 11.0, unitPrice: 1.1, unitPriceMeasure: 'lei/buc' }),
        offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 6.5, unitPrice: 6.5, unitPriceMeasure: 'lei/l' })
      ],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.unitConflicts.length, 2);
    assert.equal(res.comparableCatalogItemsCount, 0);
  });

  await runCase('8. Produse fără preț -> nu primesc 0 lei / fallback inventat, marcate estimativ', () => {
    const res = BasketOptimizerService.optimize({
      items: [
        { id: 'np1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: 'np2', productId: 'p-detergent-bio', name: 'Detergent Bio 2L', category: 'Curățenie', quantity: 1, unit: 'l', checked: false }
      ],
      products: PRODUCTS,
      offers: [offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 6.0 })],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.itemsWithoutAnyValidPrice.length, 1);
    assert.equal(res.itemsWithoutAnyValidPrice[0].product?.id, 'p-detergent-bio');
    assert.equal(res.isEstimative, true);
    assert.equal(res.bestSingleStore?.totalPrice, 6.0);
  });

  await runCase('9. Oferte expirate -> excluse complet din optimizare', () => {
    const res = BasketOptimizerService.optimize({
      items: [{ id: 'e1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      products: PRODUCTS,
      offers: [
        offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 3.9, validUntil: PAST_DATE }),
        offer({ productId: 'p-lapte-1l', storeId: 'kaufland', price: 6.7, validUntil: FUTURE_DATE })
      ],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.bestSingleStore?.store.id, 'kaufland');
    assert.equal(res.bestSingleStore?.totalPrice, 6.7);
  });

  await runCase('10. Prețuri invalide (0, negative, NaN, sau fără sursă) -> respinse și niciodată prezentate ca verificate', () => {
    const unsourced = offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 4.0, source: '' as any });
    const qUnsourced = PriceQualityClassifier.classifyOffer(unsourced, { product: PRODUCTS[0], now: NOW });
    assert.equal(qUnsourced.status, 'UNVERIFIED');
    assert.equal(qUnsourced.isReliableForOptimization, false);
    assert.equal(qUnsourced.isUsableForComparison, false);

    const res = BasketOptimizerService.optimize({
      items: [{ id: 'inv1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      products: PRODUCTS,
      offers: [
        unsourced,
        offer({ productId: 'p-lapte-1l', storeId: 'penny', price: 0 }),
        offer({ productId: 'p-lapte-1l', storeId: 'carrefour', price: -5 }),
        offer({ productId: 'p-lapte-1l', storeId: 'kaufland', price: 6.8, source: 'official_feed' })
      ],
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.bestSingleStore?.store.id, 'kaufland');
    assert.equal(res.bestSingleStore?.totalPrice, 6.8);
  });

  await runCase('11. Promoții condiționate (card fidelitate, cupon, cantitate minimă) aplicate strict dacă sunt îndeplinite', () => {
    const offers: ProductOffer[] = [
      offer({
        productId: 'p-lapte-1l',
        storeId: 'lidl',
        price: 5.0,
        normalPrice: 7.0,
        loyaltyPrice: 5.0,
        loyaltyCardRequired: true,
        loyaltyCardName: 'Lidl Plus'
      }),
      offer({
        productId: 'p-unt-200g',
        storeId: 'kaufland',
        price: 9.0,
        promoPrice: 9.0,
        normalPrice: 13.0,
        couponRequired: true,
        couponCode: 'UNT10',
        promoDetails: 'Cupon aplicație Kaufland',
        unitPrice: 45.0,
        unitPriceMeasure: 'lei/kg'
      }),
      offer({
        productId: 'p-oua-10',
        storeId: 'carrefour',
        price: 9.5,
        promoPrice: 9.5,
        normalPrice: 12.0,
        minQuantityForPromo: 3,
        promoDetails: 'Preț redus la min. 3 buc',
        unitPrice: 0.95,
        unitPriceMeasure: 'lei/buc'
      })
    ];

    // Without loyalty, without coupons, qty 2 < min 3 -> falls back to normalPrice everywhere!
    const offAll = BasketOptimizerService.optimize({
      items: [
        { id: 'c1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: 'c2', productId: 'p-unt-200g', name: 'Unt 200g', category: 'Lactate și ouă', quantity: 200, unit: 'g', checked: false },
        { id: 'c3', productId: 'p-oua-10', name: 'Ouă 10 buc', category: 'Lactate și ouă', quantity: 2, unit: 'buc', checked: false }
      ],
      products: PRODUCTS,
      offers,
      stores: STORES,
      options: { useLoyaltyCards: false, useCoupons: false, maxStores: 3, now: NOW }
    });
    assert.equal(offAll.recommendedMultiStore?.productsTotal, 7.0 + 13.0 + 24.0); // 44.00

    // With loyalty + coupons + qty 3 -> all conditional promos active!
    const onAll = BasketOptimizerService.optimize({
      items: [
        { id: 'c1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: 'c2', productId: 'p-unt-200g', name: 'Unt 200g', category: 'Lactate și ouă', quantity: 200, unit: 'g', checked: false },
        { id: 'c3', productId: 'p-oua-10', name: 'Ouă 10 buc', category: 'Lactate și ouă', quantity: 3, unit: 'buc', checked: false }
      ],
      products: PRODUCTS,
      offers,
      stores: STORES,
      options: { useLoyaltyCards: true, useCoupons: true, maxStores: 3, now: NOW }
    });
    assert.equal(onAll.recommendedMultiStore?.productsTotal, 5.0 + 9.0 + 28.5); // 42.50
  });

  await runCase('12. Magazine excluse și favorite -> excludere strictă + tie-breaker favorit', () => {
    const res = BasketOptimizerService.optimize({
      items: [{ id: '1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      products: PRODUCTS,
      offers: [
        offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 4.5 }),
        offer({ productId: 'p-lapte-1l', storeId: 'kaufland', price: 6.0 }),
        offer({ productId: 'p-lapte-1l', storeId: 'carrefour', price: 6.0 })
      ],
      stores: STORES,
      options: { excludedStoreIds: ['lidl'], favoriteStoreIds: ['carrefour'], now: NOW }
    });
    assert.ok(!res.singleStoreRankings.some(r => r.store.id === 'lidl'));
    assert.equal(res.bestSingleStore?.store.id, 'carrefour');
  });

  await runCase('13. Limită magazine (1 vs 2 vs 3)', () => {
    const offers = [
      offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 4.0 }),
      offer({ productId: 'p-unt-200g', storeId: 'lidl', price: 15.0, unitPrice: 75, unitPriceMeasure: 'lei/kg' }),
      offer({ productId: 'p-oua-10', storeId: 'lidl', price: 15.0, unitPrice: 1.5, unitPriceMeasure: 'lei/buc' }),

      offer({ productId: 'p-lapte-1l', storeId: 'kaufland', price: 8.0 }),
      offer({ productId: 'p-unt-200g', storeId: 'kaufland', price: 9.0, unitPrice: 45, unitPriceMeasure: 'lei/kg' }),
      offer({ productId: 'p-oua-10', storeId: 'kaufland', price: 15.0, unitPrice: 1.5, unitPriceMeasure: 'lei/buc' }),

      offer({ productId: 'p-lapte-1l', storeId: 'carrefour', price: 8.0 }),
      offer({ productId: 'p-unt-200g', storeId: 'carrefour', price: 15.0, unitPrice: 75, unitPriceMeasure: 'lei/kg' }),
      offer({ productId: 'p-oua-10', storeId: 'carrefour', price: 9.0, unitPrice: 0.9, unitPriceMeasure: 'lei/buc' })
    ];
    const items: ShoppingListItem[] = [
      { id: '1', productId: 'p-lapte-1l', name: 'Lapte', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
      { id: '2', productId: 'p-unt-200g', name: 'Unt', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false },
      { id: '3', productId: 'p-oua-10', name: 'Ouă', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false }
    ];
    const r1 = BasketOptimizerService.optimize({ items, products: PRODUCTS, offers, stores: STORES, options: { maxStores: 1, now: NOW } });
    const r2 = BasketOptimizerService.optimize({ items, products: PRODUCTS, offers, stores: STORES, options: { maxStores: 2, now: NOW } });
    const r3 = BasketOptimizerService.optimize({ items, products: PRODUCTS, offers, stores: STORES, options: { maxStores: 3, now: NOW } });

    assert.equal(r1.recommendedMultiStore?.storeCount, 1);
    assert.equal(r1.recommendedMultiStore?.productsTotal, 32.0);
    assert.equal(r2.recommendedMultiStore?.storeCount, 2);
    // Exact combinatorial optimum: Kaufland (lapte 8 + unt 9) + Carrefour (oua 9) = 26 (beats Lidl+Carrefour = 28)
    assert.equal(r2.recommendedMultiStore?.productsTotal, 26.0);
    assert.equal(r3.recommendedMultiStore?.storeCount, 3);
    assert.equal(r3.recommendedMultiStore?.productsTotal, 22.0);
  });

  await runCase('14. Produse regionale -> oferta de Cluj exclusă pentru București/Național, inclusă pentru Cluj-Napoca', () => {
    const regionalOffers = [
      offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 4.2, region: 'Cluj-Napoca' }),
      offer({ productId: 'p-lapte-1l', storeId: 'kaufland', price: 6.5, region: 'Național' })
    ];
    const items: ShoppingListItem[] = [
      { id: '1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }
    ];

    const resBuc = BasketOptimizerService.optimize({
      items,
      products: PRODUCTS,
      offers: regionalOffers,
      stores: STORES,
      options: { region: 'București', now: NOW }
    });
    assert.equal(resBuc.bestSingleStore?.store.id, 'kaufland');
    assert.equal(resBuc.bestSingleStore?.totalPrice, 6.5);

    const resCluj = BasketOptimizerService.optimize({
      items,
      products: PRODUCTS,
      offers: regionalOffers,
      stores: STORES,
      options: { region: 'Cluj-Napoca', now: NOW }
    });
    assert.equal(resCluj.bestSingleStore?.store.id, 'lidl');
    assert.equal(resCluj.bestSingleStore?.totalPrice, 4.2);
  });

  await runCase('15. Produse fără matching sigur (arome, fără zahăr, bio, multipack) -> blocate în unconfidentMatches', () => {
    const items: ShoppingListItem[] = [
      { id: 'u1', name: 'Iaurt cu vanilie 400g', brand: 'Danone', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false },
      { id: 'u2', name: 'Băutură carbogazoasă Cola Zero fără zahăr 2L', brand: 'Coca-Cola', category: 'Băuturi', quantity: 1, unit: 'l', checked: false },
      { id: 'u3', name: 'Detergent lichid convențional 2L', brand: 'EcoClean', category: 'Curățenie', quantity: 1, unit: 'l', checked: false },
      { id: 'u4', name: 'Apă minerală plată 0.5L', brand: 'Borsec', category: 'Băuturi', quantity: 1, unit: 'l', checked: false }
    ];
    const res = BasketOptimizerService.optimize({
      items,
      products: PRODUCTS,
      offers: PRODUCTS.map(p => offer({ productId: p.id, storeId: 'lidl', price: p.baseReferencePrice })),
      stores: STORES,
      options: { now: NOW }
    });
    assert.equal(res.unconfidentMatches.length, 4);
    assert.equal(res.comparableCatalogItemsCount, 0);
  });

  await runCase('16. Mai multe prețuri în același magazin -> alege oferta validă optimă', () => {
    const res = BasketOptimizerService.optimize({
      items: [{ id: '1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      products: PRODUCTS,
      offers: [
        offer({ id: 'old-stale', productId: 'p-lapte-1l', storeId: 'lidl', price: 5.5, observationDate: OLD_10_DAYS, lastChecked: `${OLD_10_DAYS}T10:00:00.000Z`, lastVerifiedAt: `${OLD_10_DAYS}T10:00:00.000Z` }),
        offer({ id: 'fresh-verified', productId: 'p-lapte-1l', storeId: 'lidl', price: 6.1 })
      ],
      stores: STORES,
      options: { includeStaleOffers: true, now: NOW }
    });
    assert.equal(res.bestSingleStore?.allocations[0].offer.id, 'fresh-verified');
    assert.equal(res.bestSingleStore?.totalPrice, 6.1);
  });

  await runCase('17. Listă modificată în timpul calculului -> server reflectă clientRevision + UI invalidare asincronă', () => {
    const rev1 = BasketOptimizerService.optimize({
      items: [{ id: '1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      products: PRODUCTS,
      offers: [offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 6.0 })],
      stores: STORES,
      options: { clientRevision: 'rev-1', now: NOW }
    });
    const rev2 = BasketOptimizerService.optimize({
      items: [{ id: '1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 3, unit: 'l', checked: false }],
      products: PRODUCTS,
      offers: [offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 6.0 })],
      stores: STORES,
      options: { clientRevision: 'rev-2', now: NOW }
    });
    assert.equal(rev1.revisionToken, 'rev-1');
    assert.equal(rev2.revisionToken, 'rev-2');
    assert.equal(rev1.bestSingleStore?.totalPrice, 6.0);
    assert.equal(rev2.bestSingleStore?.totalPrice, 18.0);

    // Verify UI explicitly implements request sequence + cacheKey match guard
    const panelSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/BasketOptimizerPanel.tsx'), 'utf8');
    assert.match(panelSrc, /requestSeqRef/);
    assert.match(panelSrc, /latestCacheKeyRef/);
    assert.match(panelSrc, /serverSyncEntry\.cacheKey === cacheKey/);
  });

  await runCase('18. Date lipsă (preț vechi configurabil maxOfferAgeDays, dată verificare lipsă -> UNVERIFIED)', () => {
    const staleOffer = offer({
      productId: 'p-lapte-1l',
      storeId: 'lidl',
      price: 5.2,
      observationDate: OLD_10_DAYS,
      lastChecked: `${OLD_10_DAYS}T10:00:00.000Z`,
      lastVerifiedAt: `${OLD_10_DAYS}T10:00:00.000Z`
    });
    const resStrict = BasketOptimizerService.optimize({
      items: [{ id: '1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      products: PRODUCTS,
      offers: [staleOffer],
      stores: STORES,
      options: { includeStaleOffers: false, maxOfferAgeDays: 7, now: NOW }
    });
    assert.equal(resStrict.bestSingleStore, null);
    assert.equal(resStrict.itemsWithoutAnyValidPrice.length, 1);

    const noDateOffer = offer({ productId: 'p-lapte-1l', storeId: 'lidl', price: 5.2, observationDate: '', lastChecked: '', lastVerifiedAt: '' });
    const qNoDate = PriceQualityClassifier.classifyOffer(noDateOffer, { product: PRODUCTS[0], now: NOW });
    assert.equal(qNoDate.status, 'UNVERIFIED');
  });

  await runCase('19. Coșuri cu acoperire diferită -> magazinul parțial NU câștigă și nu există economie falsă', () => {
    const res = BasketOptimizerService.optimize({
      items: [
        { id: '1', productId: 'p-lapte-1l', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: '2', productId: 'p-unt-200g', name: 'Unt 200g', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false }
      ],
      products: PRODUCTS,
      offers: [
        offer({ productId: 'p-lapte-1l', storeId: 'penny', price: 3.0 }), // doar 1 din 2!
        offer({ productId: 'p-lapte-1l', storeId: 'kaufland', price: 6.0 }),
        offer({ productId: 'p-unt-200g', storeId: 'kaufland', price: 12.0, unitPrice: 60, unitPriceMeasure: 'lei/kg' }) // 2 din 2!
      ],
      stores: STORES,
      options: { maxStores: 2, now: NOW }
    });
    // Best single store MUST be Kaufland (2/2), NOT Penny (1/2)
    assert.equal(res.bestSingleStore?.store.id, 'kaufland');
    assert.equal(res.bestSingleStore?.totalPrice, 18.0);
    // Multi-store covers 2/2 (Penny 3 + Kaufland 12 = 15), baseline Kaufland also covers 2/2 => valid savings = 3.00!
    assert.equal(res.recommendedMultiStore?.hasValidSavingsBaseline, true);
    assert.equal(res.recommendedMultiStore?.savingsVsBestSingleStore, 3.0);
  });

  await runCase('20 & 21. Acces neautorizat (401), izolare utilizatori diferiți și politici RLS active', async () => {
    const { app } = await import('../server.ts');
    const { StorageService } = await import('../src/services/StorageService.ts');
    StorageService.resetAllData();
    const freshNowIso = new Date().toISOString();
    const freshDateStr = freshNowIso.slice(0, 10);
    StorageService.addOrUpdateOffers([
      offer({
        id: 'api-test-lapte-lidl',
        productId: 'prod-lapte-1',
        storeId: 'lidl',
        price: 6.49,
        unitPrice: 6.49,
        unitPriceMeasure: 'lei/l',
        region: 'București',
        observationDate: freshDateStr,
        lastChecked: freshNowIso,
        lastVerifiedAt: freshNowIso
      })
    ]);

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const targetListUuid = '22222222-2222-4222-8222-222222222222';

    try {
      const rNoAuthGet = await fetch(`${baseUrl}/api/basket/optimize/${targetListUuid}`);
      assert.equal(rNoAuthGet.status, 401);

      const rUserAForged = await fetch(`${baseUrl}/api/basket/optimize/${targetListUuid}`, {
        headers: { Authorization: 'Bearer forged-user-a-jwt' }
      });
      assert.equal(rUserAForged.status, 401);

      const rPostUuidNoAuth = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: targetListUuid, items: [] })
      });
      assert.equal(rPostUuidNoAuth.status, 401);

      const rPostBadPayload = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: 'x', name: 'Bad', quantity: -10, unit: 'buc' }], options: { maxOfferAgeDays: 999 } })
      });
      assert.equal(rPostBadPayload.status, 400);

      // Valid POST with region & clientRevision returns new fields & Cache-Control: private, no-store
      const rOk = await fetch(`${baseUrl}/api/basket/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId: 'local-test-21',
          listName: 'Coș test',
          items: [
            { id: '1', productId: 'prod-lapte-1', name: 'Lapte proaspăt 1.5% grăsime 1L', category: 'Lactate și ouă', quantity: 1.5, unit: 'l', checked: false }
          ],
          options: { maxStores: 3, useLoyaltyCards: true, useCoupons: false, region: 'București', clientRevision: 'rev-api-21' }
        })
      });
      assert.equal(rOk.status, 200);
      assert.match(rOk.headers.get('cache-control') || '', /private,\s*no-store/i);
      const body = await rOk.json();
      assert.equal(body.success, true);
      assert.equal(body.optimization.revisionToken, 'rev-api-21');
      assert.equal(body.optimization.appliedRegion, 'București');
      const firstAlloc = body.optimization.bestSingleStore?.allocations?.[0];
      assert.ok(firstAlloc);
      assert.equal(firstAlloc.packagesCount, 2);
      assert.equal(firstAlloc.surplusQuantity, 0.5);

      // Verify Supabase RLS rules in migration 013
      const m013 = fs.readFileSync(path.join(process.cwd(), 'src/db/migrations/013_v2_personal_assistant.sql'), 'utf8');
      assert.match(m013, /ALTER TABLE public\.shopping_lists ENABLE ROW LEVEL SECURITY/i);
      assert.match(m013, /ALTER TABLE public\.shopping_list_items ENABLE ROW LEVEL SECURITY/i);
      assert.match(m013, /can_access_shopping_list/i);
    } finally {
      StorageService.resetAllData();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  console.log(`\n🎉 Toate cele ${passed}/20 verificări (21 scenarii edge-case) pentru Optimizator au trecut!`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
