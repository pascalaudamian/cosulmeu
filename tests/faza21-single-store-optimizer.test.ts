import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NODE_ENV = 'test';

import { BasketOptimizerService } from '../src/services/BasketOptimizerService.js';
import { PriceQualityClassifier } from '../src/services/PriceQualityClassifier.js';
import { BasketOptimizerPanel } from '../src/components/BasketOptimizerPanel.js';
import type { Product, ProductOffer, ShoppingList, ShoppingListItem, Store } from '../src/types.js';

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const FUTURE_START = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const FUTURE_END = new Date(NOW.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const PAST_DATE = '2024-01-10';

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
    barcode: '5941234000011',
    baseReferencePrice: 7.5
  },
  {
    id: 'p-lapte-alias-1',
    name: 'Lapte Zuzu 1L (alias)',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    canonicalProductId: 'p-lapte',
    baseReferencePrice: 7.5
  },
  {
    id: 'p-lapte-alias-2',
    name: 'Lapte Zuzu 1L (multi-hop)',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    canonicalProductId: 'p-lapte-alias-1',
    baseReferencePrice: 7.5
  },
  {
    id: 'p-unt',
    name: 'Unt 82% 200g',
    brand: 'Napolact',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 200,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    barcode: '5941234000028',
    baseReferencePrice: 14.0
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
    barcode: '5941234000035',
    baseReferencePrice: 4.5
  },
  {
    id: 'p-cycle-a',
    name: 'Produs Ciclu A',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    canonicalProductId: 'p-cycle-b',
    baseReferencePrice: 10
  },
  {
    id: 'p-cycle-b',
    name: 'Produs Ciclu B',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    canonicalProductId: 'p-cycle-a',
    baseReferencePrice: 10
  },
  {
    id: 'p-orphan-alias',
    name: 'Alias Orfan',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    canonicalProductId: 'p-missing-root',
    baseReferencePrice: 10
  }
];

function makeOffer(overrides: Partial<ProductOffer> & { productId: string; storeId: string; price: number }): ProductOffer {
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
  console.log('\nFAZA 2.1 — Single-Store Shopping Basket Optimizer Tests\n');

  await testCase('1. Identifică supermarketul unic cu cel mai mic cost comparabil (acoperire completă > subtotal parțial)', () => {
    const items: ShoppingListItem[] = [
      { id: 'i1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 2, unit: 'l', checked: false },
      { id: 'i2', productId: 'p-unt', name: 'Unt 82% 200g', category: 'Lactate și ouă', quantity: 1, unit: 'buc', checked: false },
      { id: 'i3', productId: 'p-faina', name: 'Făină albă 000 1kg', category: 'Produse de bază', quantity: 1, unit: 'kg', checked: false }
    ];

    const offers: ProductOffer[] = [
      // Lidl are toate 3 produse: 2*6.5 + 12 + 4 = 29 RON
      makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.5, unitPrice: 6.5, unitPriceMeasure: 'lei/l' }),
      makeOffer({ productId: 'p-unt', storeId: 'lidl', price: 12.0, unitPrice: 60.0, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-faina', storeId: 'lidl', price: 4.0, unitPrice: 4.0, unitPriceMeasure: 'lei/kg' }),
      // Kaufland are toate 3 produse: 2*7.0 + 13.5 + 4.5 = 32 RON
      makeOffer({ productId: 'p-lapte', storeId: 'kaufland', price: 7.0, unitPrice: 7.0, unitPriceMeasure: 'lei/l' }),
      makeOffer({ productId: 'p-unt', storeId: 'kaufland', price: 13.5, unitPrice: 67.5, unitPriceMeasure: 'lei/kg' }),
      makeOffer({ productId: 'p-faina', storeId: 'kaufland', price: 4.5, unitPrice: 4.5, unitPriceMeasure: 'lei/kg' }),
      // Carrefour are doar 1 produs (Lapte 5.0 RON => subtotal 10 RON), NU trebuie să câștige ca „cel mai ieftin”
      makeOffer({ productId: 'p-lapte', storeId: 'carrefour', price: 5.0, unitPrice: 5.0, unitPriceMeasure: 'lei/l' })
    ];

    const res = BasketOptimizerService.optimize({
      list: { id: 'list-1', name: 'Cumpărături Săptămână' },
      items,
      options: { maxStores: 1, transportCostPerExtraStore: 0 },
      products: PRODUCTS,
      offers,
      stores: STORES
    });

    assert.equal(res.maxStoresApplied, 1);
    assert.equal(res.bestSingleStore?.store.id, 'lidl');
    assert.equal(res.bestSingleStore?.isComplete, true);
    assert.equal(res.bestSingleStore?.totalPrice, 29);
    assert.equal(res.bestSingleStore?.savingsVsWorstStore, 3); // 32 - 29 între magazine complete
    assert.equal(res.recommendedMultiStore?.stops.length, 1);
    assert.equal(res.recommendedMultiStore?.stops[0].store.id, 'lidl');

    const carrefourRank = res.singleStoreRankings.find(r => r.store.id === 'carrefour');
    assert.ok(carrefourRank);
    assert.equal(carrefourRank.isComplete, false);
    assert.equal(carrefourRank.missingItems.length, 2);
  });

  await testCase('2. Rezolvă aliasuri multi-hop pentru item și ofertă și respinge ciclurile/orfanii', () => {
    const items: ShoppingListItem[] = [
      { id: 'i-multi', productId: 'p-lapte-alias-2', name: 'Lapte alias multi-hop', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
      { id: 'i-cycle', productId: 'p-cycle-a', name: 'Produs Ciclu A', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false },
      { id: 'i-orphan', productId: 'p-orphan-alias', name: 'Alias Orfan', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false }
    ];

    const offers: ProductOffer[] = [
      // Ofertă pusă pe alias 1-hop trebuie rezolvată la root p-lapte
      makeOffer({ productId: 'p-lapte-alias-1', storeId: 'lidl', price: 6.2, unitPrice: 6.2, unitPriceMeasure: 'lei/l' }),
      // Oferte pe ciclu și orfan nu trebuie incluse în total
      makeOffer({ productId: 'p-cycle-a', storeId: 'lidl', price: 9.0 }),
      makeOffer({ productId: 'p-orphan-alias', storeId: 'lidl', price: 8.0 })
    ];

    const res = BasketOptimizerService.optimize({
      items,
      options: { maxStores: 1 },
      products: PRODUCTS,
      offers,
      stores: STORES
    });

    assert.equal(res.bestSingleStore?.store.id, 'lidl');
    assert.equal(res.bestSingleStore?.allocations.length, 1);
    assert.equal(res.bestSingleStore?.allocations[0].product.id, 'p-lapte');
    assert.equal(res.bestSingleStore?.totalPrice, 6.2);
    assert.equal(res.bestSingleStore?.allocations[0].currency, 'RON');
    assert.equal(res.unconfidentMatches.length, 2);
  });

  await testCase('3. Validează moneda RON și respinge prețurile în valută străină (EUR)', () => {
    const eurOffer = makeOffer({
      productId: 'p-lapte',
      storeId: 'lidl',
      currency: 'EUR',
      price: 1.5,
      unitPriceMeasure: 'EUR/l' as any
    });
    const assessment = PriceQualityClassifier.classifyOffer(eurOffer);
    assert.equal(assessment.isUsableForComparison, false);
    assert.equal(assessment.status, 'SUSPICIOUS');

    const res = BasketOptimizerService.optimize({
      items: [{ id: 'i1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      options: { maxStores: 1 },
      products: PRODUCTS,
      offers: [eurOffer],
      stores: STORES
    });
    assert.equal(res.bestSingleStore, null);
    assert.equal(res.itemsWithoutAnyValidPrice.length, 1);
  });

  await testCase('4. Validează fereastra promoțională validFrom..validUntil (exclude promoții viitoare sau intervale invalide)', () => {
    const futurePromo = makeOffer({
      productId: 'p-lapte',
      storeId: 'lidl',
      price: 4.5,
      isPromo: true,
      validFrom: FUTURE_START,
      validUntil: FUTURE_END
    });
    const activePromo = makeOffer({
      productId: 'p-lapte',
      storeId: 'kaufland',
      price: 5.9,
      isPromo: true,
      validFrom: YESTERDAY,
      validUntil: FUTURE_END
    });
    const expiredPromo = makeOffer({
      productId: 'p-lapte',
      storeId: 'carrefour',
      price: 3.9,
      isPromo: true,
      validFrom: PAST_DATE,
      validUntil: PAST_DATE
    });

    assert.equal(PriceQualityClassifier.classifyOffer(futurePromo).isUsableForComparison, false);
    assert.equal(PriceQualityClassifier.classifyOffer(activePromo).isUsableForComparison, true);
    assert.equal(PriceQualityClassifier.classifyOffer(expiredPromo).isUsableForComparison, false);

    const res = BasketOptimizerService.optimize({
      items: [{ id: 'i1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }],
      options: { maxStores: 1 },
      products: PRODUCTS,
      offers: [futurePromo, activePromo, expiredPromo],
      stores: STORES
    });

    assert.equal(res.bestSingleStore?.store.id, 'kaufland');
    assert.equal(res.bestSingleStore?.totalPrice, 5.9);
  });

  await testCase('5. Respinge matching ambiguu pe EAN duplicat sau nume ambiguu', () => {
    const productsDupEan: Product[] = [
      ...PRODUCTS,
      {
        id: 'p-dup-ean',
        name: 'Lapte alt brand același EAN',
        brand: 'AltBrand',
        category: 'Lactate și ouă',
        defaultUnit: 'l',
        packageWeightOrVolume: 1,
        packageUnit: 'l',
        normalizedUnit: 'l',
        barcode: '5941234000011',
        baseReferencePrice: 8.0
      }
    ];

    const res = BasketOptimizerService.optimize({
      items: [
        {
          id: 'i-ean',
          barcode: '5941234000011',
          name: 'Produs scanat ambiguu',
          category: 'Lactate și ouă',
          quantity: 1,
          unit: 'l',
          checked: false
        }
      ],
      options: { maxStores: 1 },
      products: productsDupEan,
      offers: [makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.0 })],
      stores: STORES
    });

    assert.equal(res.bestSingleStore, null);
    assert.equal(res.unconfidentMatches.length, 1);
    assert.ok((res.unconfidentMatches[0].candidateProducts?.length || 0) >= 2);
  });

  await testCase('6. Separă produsele fără preț, matching nesigur și conflicte de unități (nu le calculează ca 0 RON)', () => {
    const items: ShoppingListItem[] = [
      { id: 'i-ok', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
      { id: 'i-no-price', productId: 'p-faina', name: 'Făină albă 000 1kg', category: 'Produse de bază', quantity: 1, unit: 'kg', checked: false },
      { id: 'i-unconf', name: 'Ceva generic fără ID', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false },
      { id: 'i-unit', productId: 'p-unt', name: 'Unt 82% 200g', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }
    ];

    const res = BasketOptimizerService.optimize({
      items,
      options: { maxStores: 1 },
      products: PRODUCTS,
      offers: [
        makeOffer({ productId: 'p-lapte', storeId: 'lidl', price: 6.8 }),
        makeOffer({ productId: 'p-unt', storeId: 'lidl', price: 12.0 })
      ],
      stores: STORES
    });

    assert.equal(res.bestSingleStore?.store.id, 'lidl');
    assert.equal(res.bestSingleStore?.totalPrice, 6.8);
    assert.equal(res.itemsWithoutAnyValidPrice.length, 1);
    assert.equal(res.unconfidentMatches.length, 1);
    assert.equal(res.unitConflicts.length, 1);
  });

  await testCase('7. BasketOptimizerPanel în modul FAZA 2.1 (singleStoreOnly) redă toate cele 10 cerințe și exclude UI multi-store', () => {
    const list1: ShoppingList = {
      id: 'list-1',
      name: 'Coș Principal',
      items: [
        { id: 'i1', productId: 'p-lapte', name: 'Lapte proaspăt 1.5% 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false },
        { id: 'i2', productId: 'p-faina', name: 'Făină albă 000 1kg', category: 'Produse de bază', quantity: 1, unit: 'kg', checked: false },
        { id: 'i3', name: 'Produs necunoscut', category: 'Alte produse', quantity: 1, unit: 'buc', checked: false }
      ],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    };
    const list2: ShoppingList = {
      id: 'list-2',
      name: 'Weekend',
      items: [list1.items[0]],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    };

    const offers: ProductOffer[] = [
      makeOffer({
        productId: 'p-lapte',
        storeId: 'lidl',
        price: 6.49,
        unitPrice: 6.49,
        unitPriceMeasure: 'lei/l',
        isPromo: true,
        validFrom: YESTERDAY,
        validUntil: FUTURE_END,
        source: 'official_feed'
      }),
      makeOffer({
        productId: 'p-lapte',
        storeId: 'kaufland',
        price: 7.29,
        unitPrice: 7.29,
        unitPriceMeasure: 'lei/l',
        source: 'partner_api'
      })
    ];

    const html = renderToStaticMarkup(
      React.createElement(BasketOptimizerPanel, {
        lists: [list1, list2],
        activeList: list1,
        onSelectActiveList: () => {},
        onBackToList: () => {},
        products: PRODUCTS,
        offers,
        stores: STORES,
        initialMaxStores: 1,
        singleStoreOnly: true
      })
    );

    // Cerințe FAZA 2.1 prezente în UI
    assert.ok(html.includes('Optimizare Coș (1 supermarket)'), 'Titlu single-store prezent');
    assert.ok(html.includes('id="optimizer-list-select"'), 'Selector listă existentă prezent');
    assert.ok(html.includes('Optimizează coșul'), 'Acțiune Optimizează coșul prezentă');
    assert.ok(html.includes('Lidl') && html.includes('Kaufland'), 'Supermarketuri comparate prezente');
    assert.ok(html.includes('6,49 lei'), 'Cost total minim calculat prezent');
    assert.ok(html.includes('Produse cu ofertă validă (1)'), 'Produse cu ofertă validă afișate');
    assert.ok(html.includes('Produse fără preț valid (1)'), 'Produse fără preț afișate');
    assert.ok(html.includes('Produse fără matching sigur (1)'), 'Produse fără matching sigur afișate');
    assert.ok(html.includes('Ultima verificare prețuri'), 'Data ultimei verificări afișată');
    assert.ok(html.includes('Metodologie și limitări ale optimizării'), 'Secțiune limitări afișată');
    assert.ok(html.includes('Feed oficial'), 'Sursă tradusă în română');
    assert.ok(html.includes('RON'), 'Moneda RON afișată');

    // Elemente strict excluse din FAZA 2.1 NU apar în UI
    assert.ok(!html.includes('Selector număr magazine'), 'Fără selector număr magazine');
    assert.ok(!html.includes('Varianta optimă în 2 magazine'), 'Fără card 2 magazine');
    assert.ok(!html.includes('Deplasare/oprire'), 'Fără input cost transport');
    assert.ok(!html.includes('Max 2'), 'Fără buton Max 2');
    assert.ok(!html.includes('Max 3'), 'Fără buton Max 3');
  });

  await testCase('8. ShoppingListView configurează BasketOptimizerPanel strict pentru single-store (initialMaxStores=1, singleStoreOnly=true)', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ShoppingListView.tsx'), 'utf8');
    assert.ok(src.includes('initialMaxStores={1}'));
    assert.ok(src.includes('singleStoreOnly={true}'));
    assert.ok(!src.includes('Optimizează coșul pe 1, 2 sau 3 magazine'));
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
