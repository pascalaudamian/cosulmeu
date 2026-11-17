import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Product, ProductOffer, ShoppingList, Store } from '../src/types.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import {
  GUEST_DEMO_LIST_ID,
  GUEST_DEMO_LIST_NAME,
  buildGuestDemoShoppingList,
  materializeGuestDemoLists,
  selectDashboardListsForSession,
  selectPopularCatalogProducts
} from '../src/utils/guestDemoBasket.ts';

const SAMPLE_STORES: Store[] = [
  {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    chain: 'Lidl România',
    brandColor: 'bg-blue-600',
    accentColor: 'text-blue-600',
    type: 'discounter',
    rating: 4.6,
    locationsCount: 350,
    sampleAddress: 'București'
  },
  {
    id: 'kaufland',
    name: 'Kaufland',
    slug: 'kaufland',
    chain: 'Kaufland România',
    brandColor: 'bg-red-600',
    accentColor: 'text-red-600',
    type: 'hypermarket',
    rating: 4.5,
    locationsCount: 180,
    sampleAddress: 'București'
  },
  {
    id: 'profi',
    name: 'Profi',
    slug: 'profi',
    chain: 'Profi Rom Food',
    brandColor: 'bg-emerald-700',
    accentColor: 'text-emerald-700',
    type: 'proximity',
    rating: 4.1,
    locationsCount: 1650,
    sampleAddress: 'București'
  }
];

const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'p-lapte',
    name: 'Lapte integral 1.5%',
    brand: 'Napolact',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 7.2
  },
  {
    id: 'p-banane',
    name: 'Banane',
    brand: 'Import',
    category: 'Fructe și legume',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 6.99
  },
  {
    id: 'p-paine',
    name: 'Pâine toast albă 600g',
    brand: 'Fine Life',
    category: 'Panificație',
    defaultUnit: 'g',
    packageWeightOrVolume: 600,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 4.5
  },
  {
    id: 'p-iaurt',
    name: 'Iaurt natural',
    brand: 'Covalact',
    category: 'Lactate și ouă',
    defaultUnit: 'g',
    packageWeightOrVolume: 400,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 5.5
  },
  {
    id: 'p-ulei',
    name: 'Ulei de floarea-soarelui 1L',
    brand: 'Spornic',
    category: 'Produse de bază',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 7.49
  },
  {
    id: 'p-apa',
    name: 'Apă minerală 2L',
    brand: 'Borsec',
    category: 'Băuturi',
    defaultUnit: 'buc',
    packageWeightOrVolume: 2,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 3.49
  },
  {
    id: 'p-cafea',
    name: 'Cafea măcinată 500g',
    brand: 'Jacobs',
    category: 'Băuturi',
    defaultUnit: 'g',
    packageWeightOrVolume: 500,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 26.5
  },
  {
    id: 'p-izolat',
    name: 'Produs doar cu oferte invalide',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 99
  }
];

const futureDate = '2099-12-31';

const SAMPLE_OFFERS: ProductOffer[] = [
  // p-lapte: 3 stores (most popular)
  {
    id: 'o-lapte-lidl',
    productId: 'p-lapte',
    storeId: 'lidl',
    price: 6.29,
    unitPrice: 6.29,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  {
    id: 'o-lapte-kaufland',
    productId: 'p-lapte',
    storeId: 'store-kaufland',
    price: 6.49,
    unitPrice: 6.49,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  {
    id: 'o-lapte-profi',
    productId: 'p-lapte',
    storeId: 'profi',
    price: 6.79,
    unitPrice: 6.79,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  // p-banane: 2 stores
  {
    id: 'o-banane-kaufland',
    productId: 'p-banane',
    storeId: 'kaufland',
    price: 5.99,
    unitPrice: 5.99,
    unitPriceMeasure: 'lei/kg',
    isPromo: true,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  {
    id: 'o-banane-profi',
    productId: 'p-banane',
    storeId: 'profi',
    price: 6.49,
    unitPrice: 6.49,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  // p-paine: 2 stores
  {
    id: 'o-paine-lidl',
    productId: 'p-paine',
    storeId: 'lidl',
    price: 4.19,
    unitPrice: 6.98,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  {
    id: 'o-paine-kaufland',
    productId: 'p-paine',
    storeId: 'kaufland',
    price: 4.49,
    unitPrice: 7.48,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  // p-ulei: 1 store
  {
    id: 'o-ulei-kaufland',
    productId: 'p-ulei',
    storeId: 'kaufland',
    price: 6.99,
    unitPrice: 6.99,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  // p-apa: 1 store
  {
    id: 'o-apa-lidl',
    productId: 'p-apa',
    storeId: 'lidl',
    price: 2.99,
    unitPrice: 1.5,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  // p-iaurt: 1 store
  {
    id: 'o-iaurt-profi',
    productId: 'p-iaurt',
    storeId: 'profi',
    price: 4.89,
    unitPrice: 12.23,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  // Invalid/isolated/demo offers for p-izolat (must NOT boost popularity)
  {
    id: 'o-izolat-1',
    productId: 'p-izolat',
    storeId: 'lidl',
    price: 10,
    unitPrice: 10,
    unitPriceMeasure: 'lei/buc',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'demo',
    confidenceLevel: 'low',
    verificationStatus: 'demo',
    lastChecked: '2026-11-10T10:00:00Z'
  },
  {
    id: 'o-izolat-2',
    productId: 'p-izolat',
    storeId: 'kaufland',
    price: 11,
    unitPrice: 11,
    unitPriceMeasure: 'lei/buc',
    isPromo: false,
    validUntil: futureDate,
    observationDate: '2026-11-10',
    source: 'verified',
    confidenceLevel: 'low',
    verificationStatus: 'isolated',
    isFlaggedAnomaly: true,
    lastChecked: '2026-11-10T10:00:00Z'
  }
];

describe('Guest Demo Basket & Reset la Login', () => {
  it('1. Selectează produsele populare din catalog prioritizând acoperirea multi-retailer și exclude ofertele invalide', () => {
    const { selected } = selectPopularCatalogProducts(SAMPLE_PRODUCTS, SAMPLE_OFFERS, 6);
    assert.strictEqual(selected.length, 6);
    assert.strictEqual(selected[0].id, 'p-lapte');
    assert.strictEqual(selected.some(p => p.id === 'p-izolat'), false);
    assert.strictEqual(selected.some(p => p.id === 'p-banane'), true);
    assert.strictEqual(selected.some(p => p.id === 'p-paine'), true);
  });

  it('2. Construiește Coș demonstrativ cu unități sigure și compară prețurile în Magazine avantajoase', () => {
    const demoList = buildGuestDemoShoppingList(SAMPLE_PRODUCTS, SAMPLE_OFFERS, 6);
    assert.strictEqual(demoList.id, GUEST_DEMO_LIST_ID);
    assert.strictEqual(demoList.name, GUEST_DEMO_LIST_NAME);
    assert.strictEqual(demoList.items.length, 6);

    // Produsele cu defaultUnit 'g' folosesc 'buc' (1 buc) pentru a nu calcula 1 gram
    const breadItem = demoList.items.find(i => i.productId === 'p-paine');
    assert.ok(breadItem);
    assert.strictEqual(breadItem.unit, 'buc');
    assert.strictEqual(breadItem.quantity, 1);

    const comparisons = PriceComparisonService.compareBasketAcrossStores(
      demoList.items,
      { useLoyaltyCards: true },
      SAMPLE_PRODUCTS,
      SAMPLE_OFFERS,
      SAMPLE_STORES
    );
    assert.strictEqual(comparisons.length, 3);
    assert.ok(comparisons.some(c => c.isWinner));
    assert.ok(comparisons.some(c => c.availableItems.length >= 3));
  });

  it('3. Resetează imediat Coșul Meu la valorile salvate ale utilizatorului după login', () => {
    const demoList = buildGuestDemoShoppingList(SAMPLE_PRODUCTS, SAMPLE_OFFERS, 6);

    // Neautentificat fără liste locale -> folosește Coș demonstrativ
    const guestState = selectDashboardListsForSession({
      isAuthenticated: false,
      userShoppingLists: undefined,
      localShoppingLists: [],
      guestDemoList: demoList
    });
    assert.strictEqual(guestState.isDemoMode, true);
    assert.strictEqual(guestState.lists.length, 1);
    assert.strictEqual(guestState.lists[0].id, GUEST_DEMO_LIST_ID);

    // Utilizator logat cu liste salvate în Supabase -> resetează complet la listele lui
    const userSavedList: ShoppingList = {
      id: 'user-list-1',
      name: 'Cumpărături Săptămânale',
      items: [
        {
          id: 'u-item-1',
          productId: 'p-apa',
          name: 'Apă minerală 2L',
          category: 'Băuturi',
          quantity: 2,
          unit: 'buc',
          checked: false
        }
      ],
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:00:00Z'
    };

    const loggedInWithData = selectDashboardListsForSession({
      isAuthenticated: true,
      userShoppingLists: [userSavedList],
      localShoppingLists: [],
      guestDemoList: demoList
    });
    assert.strictEqual(loggedInWithData.isDemoMode, false);
    assert.strictEqual(loggedInWithData.lists.length, 1);
    assert.strictEqual(loggedInWithData.lists[0].id, 'user-list-1');

    // Utilizator logat fără liste salvate -> NU păstrează datele demo
    const loggedInEmpty = selectDashboardListsForSession({
      isAuthenticated: true,
      userShoppingLists: [],
      localShoppingLists: [],
      guestDemoList: demoList
    });
    assert.strictEqual(loggedInEmpty.isDemoMode, false);
    assert.strictEqual(loggedInEmpty.lists.length, 0);
  });

  it('4. Materializează lista virtuală doar la editare explicită de către vizitator', () => {
    const demoList = buildGuestDemoShoppingList(SAMPLE_PRODUCTS, SAMPLE_OFFERS, 6);
    const materialized = materializeGuestDemoLists([demoList], 'real-local-uuid');
    assert.strictEqual(materialized[0].id, 'real-local-uuid');
    assert.strictEqual(materialized[0].name, 'Coșul Meu');
    assert.strictEqual(materialized[0].items.length, 6);
  });
});
