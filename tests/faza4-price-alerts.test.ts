// tests/faza4-price-alerts.test.ts
// Suită dedicată FAZA 4 — PRICE ALERTS (30 scenarii obligatorii: funcționalitate, calitate preț, identitate canonică,
// anti-spam/idempotență/rearmare, izolare/securitate HTTP, erori de persistență, concurență & regresii FAZA 2.1/2.2/3.1/3.2)

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { PriceAlertService } from '../src/services/PriceAlertService.js';
import { PriceQualityClassifier } from '../src/services/PriceQualityClassifier.js';
import { PriceHistoryService } from '../src/services/PriceHistoryService.js';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.js';
import { StorageService } from '../src/services/StorageService.js';
import { buildCanonicalAliasIndex } from '../src/services/ProductIdentityService.js';
import type {
  InAppPriceNotification,
  PriceAlert,
  PriceObservation,
  Product,
  ProductOffer,
  ShoppingListItem,
  Store
} from '../src/types.js';

const NOW = new Date('2026-11-26T10:00:00Z');
const TODAY = '2026-11-26';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const YESTERDAY = new Date(NOW.getTime() - DAY_MS).toISOString().slice(0, 10);
const DAYS_20_AGO = new Date(NOW.getTime() - 20 * DAY_MS).toISOString().slice(0, 10);
const DAYS_40_AGO = new Date(NOW.getTime() - 40 * DAY_MS).toISOString().slice(0, 10);

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
  }
];

const PRODUCTS: Product[] = [
  {
    id: 'f4-lapte-root',
    name: 'Lapte proaspăt 1.5% 1L',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 7.5
  },
  {
    id: 'f4-lapte-alias',
    name: 'Lapte Zuzu 1L (alias)',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 7.5,
    canonicalProductId: 'f4-lapte-root'
  },
  {
    id: 'f4-cafea-root',
    name: 'Cafea măcinată 500g',
    brand: 'Jacobs',
    category: 'Băuturi',
    defaultUnit: 'g',
    packageWeightOrVolume: 500,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 28.0
  },
  {
    id: 'f4-cyc-a',
    name: 'Ciclu A',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 5.0,
    canonicalProductId: 'f4-cyc-b'
  },
  {
    id: 'f4-cyc-b',
    name: 'Ciclu B',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 5.0,
    canonicalProductId: 'f4-cyc-a'
  },
  {
    id: 'f4-self',
    name: 'Self Loop',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 5.0,
    canonicalProductId: 'f4-self'
  },
  {
    id: 'f4-orphan',
    name: 'Orfan',
    brand: 'Test',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 5.0,
    canonicalProductId: 'f4-missing-root'
  }
];

function makeOffer(overrides: Partial<ProductOffer> & { currency?: string; packageWeightOrVolume?: number; packageUnit?: string }): ProductOffer {
  return {
    id: overrides.id || `off-${Math.random().toString(36).slice(2, 8)}`,
    productId: overrides.productId || 'f4-lapte-root',
    storeId: overrides.storeId || 'lidl',
    price: overrides.price ?? 7.0,
    unitPrice: overrides.unitPrice ?? overrides.price ?? 7.0,
    unitPriceMeasure: overrides.unitPriceMeasure || 'lei/l',
    isPromo: overrides.isPromo ?? false,
    observationDate: overrides.observationDate || TODAY,
    source: overrides.source || 'official_feed',
    confidenceLevel: overrides.confidenceLevel || 'high',
    verificationStatus: overrides.verificationStatus || 'verified',
    lastChecked: overrides.lastChecked || NOW.toISOString(),
    lastVerifiedAt: overrides.lastVerifiedAt !== undefined ? overrides.lastVerifiedAt : NOW.toISOString(),
    validUntil: overrides.validUntil,
    isFlaggedAnomaly: overrides.isFlaggedAnomaly,
    currency: (overrides.currency as any) ?? 'RON',
    ...(overrides.packageWeightOrVolume !== undefined ? { packageWeightOrVolume: overrides.packageWeightOrVolume } : {}),
    ...(overrides.packageUnit !== undefined ? { packageUnit: overrides.packageUnit } : {})
  };
}

function makeAlert(overrides: Partial<PriceAlert>): PriceAlert {
  return {
    id: overrides.id || '11111111-1111-4111-8111-111111111111',
    productId: overrides.productId || 'f4-lapte-root',
    productName: overrides.productName || 'Lapte proaspăt 1.5% 1L (Zuzu)',
    targetPrice: overrides.targetPrice ?? 6.5,
    currentLowestPrice: overrides.currentLowestPrice ?? 7.5,
    createdAt: overrides.createdAt || TODAY,
    isActive: overrides.isActive ?? true,
    alertType: overrides.alertType || 'below_target',
    rearmState: overrides.rearmState || 'armed',
    triggerCycle: overrides.triggerCycle ?? 0,
    ...overrides
  };
}

async function runTests() {
  console.log('🧪 Rulare suită completă FAZA 4 — PRICE ALERTS (30 scenarii obligatorii)...\n');

  const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [
    {
      name: '1. Crearea unei alerte Target Price (below_target) + validare',
      fn: () => {
        const listResult = PriceAlertService.createAlertsFromShoppingList(
          {
            id: 'list-1',
            name: 'Lista Test',
            createdAt: TODAY,
            updatedAt: TODAY,
            items: [
              {
                id: 'it-1',
                productId: 'f4-lapte-root',
                name: 'Lapte proaspăt 1.5% 1L',
                category: 'Lactate și ouă',
                quantity: 1,
                unit: 'l',
                checked: false
              }
            ]
          },
          [],
          PRODUCTS,
          [makeOffer({ id: 'o-seed', price: 7.5 })],
          { alertType: 'below_target', discountPercentForTarget: 10, now: NOW }
        );
        assert.equal(listResult.createdAlerts.length, 1);
        assert.equal(listResult.createdAlerts[0].alertType, 'below_target');
        assert.equal(listResult.createdAlerts[0].targetPrice, 6.75);
        assert.equal(listResult.createdAlerts[0].rearmState, 'armed');
      }
    },
    {
      name: '2. Declanșarea la atingerea pragului (<= targetPrice) cu explicație și ofertă sursă',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-hit', price: 6.5, storeId: 'kaufland' })],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 1);
        assert.equal(res.newNotifications[0].observedPrice, 6.5);
        assert.equal(res.newNotifications[0].sourceOfferId, 'o-hit');
        assert.ok(res.newNotifications[0].reasonRo?.includes('6.50 lei'));
        assert.equal(res.updatedAlerts[0].rearmState, 'triggered_locked');
      }
    },
    {
      name: '3. Nedeclanșarea peste prag (> targetPrice)',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-high', price: 6.8, storeId: 'lidl' })],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
        assert.equal(res.updatedAlerts[0].rearmState, 'armed');
        assert.match(res.updatedAlerts[0].lastSkippedReasonRo || '', /peste pragul țintă/i);
      }
    },
    {
      name: '4. Price Drop valid (any_drop): compară cu ultimul preț verificat și respectă minDropPercent',
      fn: () => {
        const alert = makeAlert({
          alertType: 'any_drop',
          minDropPercent: 5,
          targetPrice: 10,
          lastEvaluatedPrice: 8.0,
          currentLowestPrice: 8.0
        });
        // Scădere de 2.5% (7.80 vs 8.00) -> sub minDropPercent 5% -> NU declanșează, păstrează reperul 8.00!
        const smallDrop = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-small', price: 7.8 })],
          stores: STORES,
          now: NOW
        });
        assert.equal(smallDrop.newNotifications.length, 0);
        assert.equal(smallDrop.updatedAlerts[0].lastEvaluatedPrice, 8.0);

        // Scădere de 10% (7.20 vs 8.00) -> >= 5% -> declanșează!
        const realDrop = PriceAlertService.evaluateAlerts({
          alerts: smallDrop.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-drop10', price: 7.2, storeId: 'kaufland' })],
          stores: STORES,
          now: NOW
        });
        assert.equal(realDrop.newNotifications.length, 1);
        assert.equal(realDrop.newNotifications[0].previousPrice, 8.0);
        assert.equal(realDrop.newNotifications[0].observedPrice, 7.2);
      }
    },
    {
      name: '5. Lowest Observed Price valid (interval_low): menționează intervalul și nr. observații, fără "all-time low"',
      fn: () => {
        const alert = makeAlert({
          alertType: 'interval_low',
          intervalDays: 90
        });
        const observations: PriceObservation[] = [
          { id: 'obs-1', productId: 'f4-lapte-root', storeId: 'lidl', price: 6.4, date: DAYS_20_AGO, source: 'official_feed' },
          { id: 'obs-2', productId: 'f4-lapte-root', storeId: 'kaufland', price: 6.9, date: DAYS_40_AGO, source: 'verified' },
          { id: 'obs-demo', productId: 'f4-lapte-root', storeId: 'lidl', price: 2.0, date: DAYS_20_AGO, source: 'demo' }
        ];
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-low90', price: 6.2, storeId: 'lidl' })],
          observations,
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 1);
        const notif = res.newNotifications[0];
        assert.equal(notif.observedIntervalDays, 90);
        assert.equal(notif.observedObservationsCount, 2);
        assert.match(notif.message, /90 zile/);
        assert.match(notif.message, /2 observații/);
        assert.doesNotMatch(notif.message, /all-time|din toate timpurile/i);
      }
    },
    {
      name: '6. Product Watch (product_watch): fără prag fix, notifică doar la scăderi relevante (5%) și aplică cooldown 72h',
      fn: () => {
        const watchAlert = makeAlert({
          alertType: 'product_watch',
          targetPrice: 0,
          minDropPercent: 5,
          cooldownHours: 72,
          lastEvaluatedPrice: 10.0,
          currentLowestPrice: 10.0
        });
        const minor = PriceAlertService.evaluateAlerts({
          alerts: [watchAlert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-w1', price: 9.8 })],
          stores: STORES,
          now: NOW
        });
        assert.equal(minor.newNotifications.length, 0);

        const relevant = PriceAlertService.evaluateAlerts({
          alerts: minor.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-w2', price: 8.8, storeId: 'lidl' })],
          stores: STORES,
          now: NOW
        });
        assert.equal(relevant.newNotifications.length, 1);
        assert.equal(relevant.newNotifications[0].alertType, 'product_watch');

        // Revenire și nouă scădere după doar 24h (< 72h cooldown implicit product_watch) -> blocat de cooldown
        const recovered = PriceAlertService.evaluateAlerts({
          alerts: relevant.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-w3', price: 9.5 })],
          stores: STORES,
          existingNotifications: relevant.newNotifications,
          now: new Date(NOW.getTime() + 12 * HOUR_MS)
        });
        assert.equal(recovered.updatedAlerts[0].rearmState, 'armed');

        const withinCooldown = PriceAlertService.evaluateAlerts({
          alerts: recovered.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-w4', price: 8.2 })],
          stores: STORES,
          existingNotifications: relevant.newNotifications,
          now: new Date(NOW.getTime() + 24 * HOUR_MS)
        });
        assert.equal(withinCooldown.newNotifications.length, 0);
        assert.match(withinCooldown.updatedAlerts[0].lastSkippedReasonRo || '', /72h/);
      }
    },
    {
      name: '7. Preț SUSPICIOUS: respins indiferent de recență',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const suspiciousOffer = makeOffer({
          id: 'o-susp',
          price: 0.5, // anomalie severă vs 7.50 lei
          lastVerifiedAt: NOW.toISOString(),
          lastChecked: NOW.toISOString(),
          verificationStatus: 'verified'
        });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [suspiciousOffer],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
      }
    },
    {
      name: '8. Preț UNVERIFIED: nu declanșează alerte',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const unverifiedOffer = makeOffer({
          id: 'o-unv',
          price: 5.9,
          source: 'user_reported',
          verificationStatus: 'pending',
          confidenceLevel: 'low',
          lastVerifiedAt: undefined
        });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [unverifiedOffer],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
      }
    },
    {
      name: '9. Preț STALE (> 72h): nu declanșează ca preț curent valid',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const staleIso = new Date(NOW.getTime() - 5 * DAY_MS).toISOString(); // 120h (>72h, <=168h => STALE)
        const staleOffer = makeOffer({
          id: 'o-stale',
          price: 5.5,
          observationDate: staleIso.slice(0, 10),
          lastChecked: staleIso,
          lastVerifiedAt: staleIso
        });
        const eligibility = PriceAlertService.evaluateOfferEligibility(
          staleOffer,
          PRODUCTS[0],
          'f4-lapte-root',
          buildCanonicalAliasIndex(PRODUCTS),
          NOW
        );
        assert.equal(eligibility.eligible, false);
        assert.equal(eligibility.assessment?.status, 'STALE');
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [staleOffer],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
      }
    },
    {
      name: '10. Ofertă EXPIRED: ignorată și reînarmează alerta dacă oferta declanșatoare anterioară a expirat',
      fn: () => {
        const expiredOffer = makeOffer({
          id: 'o-exp',
          price: 5.5,
          validUntil: YESTERDAY,
          verificationStatus: 'expired'
        });
        const lockedAlert = makeAlert({
          rearmState: 'triggered_locked',
          lastTriggeredAt: new Date(NOW.getTime() - 48 * HOUR_MS).toISOString(),
          lastTriggeredPrice: 5.5,
          lastSourceOfferId: 'o-exp',
          targetPrice: 6.5
        });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [lockedAlert],
          products: PRODUCTS,
          offers: [expiredOffer],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
        assert.equal(res.updatedAlerts[0].rearmState, 'armed');
        assert.equal(res.updatedAlerts[0].triggerHistory?.[0]?.outcome, 'rearmed_offer_expired');
      }
    },
    {
      name: '11. Monedă incompatibilă (EUR / USD): respinsă complet',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const eurOffer = makeOffer({ id: 'o-eur', price: 1.5, currency: 'EUR' });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [eurOffer],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
      }
    },
    {
      name: '12. Alias canonic valid: alertă sau ofertă pe alias se rezolvă la produsul canonic',
      fn: () => {
        const aliasAlert = makeAlert({
          id: 'a-alias',
          productId: 'f4-lapte-alias',
          targetPrice: 6.6
        });
        const aliasOffer = makeOffer({
          id: 'o-alias',
          productId: 'f4-lapte-alias',
          price: 6.3,
          storeId: 'kaufland'
        });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [aliasAlert],
          products: PRODUCTS,
          offers: [aliasOffer],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 1);
        assert.equal(res.updatedAlerts[0].productId, 'f4-lapte-root');
      }
    },
    {
      name: '13. Alias invalid (ciclu, self-reference, >16 hopuri, orfan): ignorat / respins fără crash',
      fn: () => {
        const deepChain: Product[] = Array.from({ length: 18 }, (_, i) => ({
          id: `deep-${i}`,
          name: `Deep ${i}`,
          brand: 'T',
          category: 'Alte produse',
          defaultUnit: 'buc',
          packageWeightOrVolume: 1,
          packageUnit: 'buc',
          normalizedUnit: 'buc',
          baseReferencePrice: 5,
          canonicalProductId: i === 17 ? undefined : `deep-${i + 1}`
        }));
        const allProds = [...PRODUCTS, ...deepChain];
        const badAlerts: PriceAlert[] = [
          makeAlert({ id: 'bad-cyc', productId: 'f4-cyc-a', targetPrice: 10 }),
          makeAlert({ id: 'bad-self', productId: 'f4-self', targetPrice: 10 }),
          makeAlert({ id: 'bad-orphan', productId: 'f4-orphan', targetPrice: 10 }),
          makeAlert({ id: 'bad-deep', productId: 'deep-0', targetPrice: 10 })
        ];
        const badOffers: ProductOffer[] = [
          makeOffer({ id: 'bo-1', productId: 'f4-cyc-a', price: 4.5, unitPriceMeasure: 'lei/buc' }),
          makeOffer({ id: 'bo-2', productId: 'f4-self', price: 4.5, unitPriceMeasure: 'lei/buc' }),
          makeOffer({ id: 'bo-3', productId: 'f4-orphan', price: 4.5, unitPriceMeasure: 'lei/buc' }),
          makeOffer({ id: 'bo-4', productId: 'deep-0', price: 4.5, unitPriceMeasure: 'lei/buc' })
        ];
        const res = PriceAlertService.evaluateAlerts({
          alerts: badAlerts,
          products: allProds,
          offers: badOffers,
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
        for (const u of res.updatedAlerts) {
          assert.match(u.lastSkippedReasonRo || '', /ciclu|orfan|invalid/i);
        }
      }
    },
    {
      name: '14. Variantă sau gramaj diferit (500g vs 1kg, unitPriceMeasure incompatibil): respins',
      fn: () => {
        const cafeaAlert = makeAlert({
          id: 'a-cafea',
          productId: 'f4-cafea-root',
          productName: 'Cafea măcinată 500g',
          targetPrice: 25
        });
        const wrongWeightOffer = makeOffer({
          id: 'o-cafea-250g',
          productId: 'f4-cafea-root',
          price: 16.0,
          unitPriceMeasure: 'lei/kg',
          packageWeightOrVolume: 250,
          packageUnit: 'g'
        });
        const wrongUnitOffer = makeOffer({
          id: 'o-cafea-buc',
          productId: 'f4-cafea-root',
          price: 18.0,
          unitPriceMeasure: 'lei/buc'
        });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [cafeaAlert],
          products: PRODUCTS,
          offers: [wrongWeightOffer, wrongUnitOffer],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
      }
    },
    {
      name: '15. Notificare duplicată: re-evaluarea aceleiași condiții nu generează a doua notificare',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const offer = makeOffer({ id: 'o-dup', price: 6.0 });
        const run1 = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [offer],
          stores: STORES,
          now: NOW
        });
        assert.equal(run1.newNotifications.length, 1);

        const run2 = PriceAlertService.evaluateAlerts({
          alerts: run1.updatedAlerts,
          products: PRODUCTS,
          offers: [offer],
          stores: STORES,
          existingNotifications: run1.newNotifications,
          now: new Date(NOW.getTime() + 48 * HOUR_MS)
        });
        assert.equal(run2.newNotifications.length, 0);
      }
    },
    {
      name: '16. Idempotency key: determinist și unic per ciclu, împiedică dublarea chiar la schimbarea datei observației',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const offer1 = makeOffer({ id: 'o-idemp', price: 6.0, observationDate: TODAY });
        const run1 = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [offer1],
          stores: STORES,
          now: NOW
        });
        assert.equal(run1.newNotifications.length, 1);
        const key1 = run1.newNotifications[0].idempotencyKey;
        assert.ok(key1 && key1.includes(':c1:'));

        // Chiar dacă existingNotifications conține cheia de idempotență a ciclului următor simulată, este blocată
        const fakeNextCycleExisting: InAppPriceNotification[] = [
          {
            ...run1.newNotifications[0],
            id: 'notif-preexisting',
            dedupeKey: 'different-dedupe',
            idempotencyKey: `${alert.id}:c2:below_target:f4-lapte-root:lidl:6.00`
          }
        ];
        const rearmed = PriceAlertService.rearmAlertManually(run1.updatedAlerts[0], NOW);
        const run2 = PriceAlertService.evaluateAlerts({
          alerts: [rearmed],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-idemp-2', price: 6.0, observationDate: '2026-11-27' })],
          stores: STORES,
          existingNotifications: fakeNextCycleExisting,
          now: new Date('2026-11-27T10:00:00Z')
        });
        assert.equal(run2.newNotifications.length, 0);
      }
    },
    {
      name: '17. Cooldown configurabil: blocat în fereastră, permis după expirare',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5, cooldownHours: 24 });
        const run1 = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-cd1', price: 6.2 })],
          stores: STORES,
          now: NOW
        });
        assert.equal(run1.newNotifications.length, 1);

        // Preț chiar mai mic (5.8) după 6 ore (< 24h) -> blocat de cooldown
        const t6h = new Date(NOW.getTime() + 6 * HOUR_MS);
        const runWithin = PriceAlertService.evaluateAlerts({
          alerts: run1.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-cd2', price: 5.8, lastChecked: t6h.toISOString(), lastVerifiedAt: t6h.toISOString() })],
          stores: STORES,
          existingNotifications: run1.newNotifications,
          now: t6h
        });
        assert.equal(runWithin.newNotifications.length, 0);
        assert.match(runWithin.updatedAlerts[0].lastSkippedReasonRo || '', /anti-spam/i);

        // După 26h (> 24h) -> permis pentru scăderea mai adâncă la 5.8
        const t26h = new Date(NOW.getTime() + 26 * HOUR_MS);
        const runAfter = PriceAlertService.evaluateAlerts({
          alerts: runWithin.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-cd2', price: 5.8, lastChecked: t26h.toISOString(), lastVerifiedAt: t26h.toISOString() })],
          stores: STORES,
          existingNotifications: run1.newNotifications,
          now: t26h
        });
        assert.equal(runAfter.newNotifications.length, 1);
        assert.equal(runAfter.newNotifications[0].observedPrice, 5.8);
      }
    },
    {
      name: '18. Rearmarea automată a alertei la revenirea prețului peste prag și re-declanșare în ciclul 2',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5, cooldownHours: 24 });
        const c1 = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-r1', price: 6.1 })],
          stores: STORES,
          now: NOW
        });
        assert.equal(c1.newNotifications.length, 1);
        assert.equal(c1.updatedAlerts[0].rearmState, 'triggered_locked');

        // Prețul urcă la 7.4 (> 6.5) -> rearmare automată
        const t25h = new Date(NOW.getTime() + 25 * HOUR_MS);
        const recovered = PriceAlertService.evaluateAlerts({
          alerts: c1.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-r2', price: 7.4, lastChecked: t25h.toISOString(), lastVerifiedAt: t25h.toISOString() })],
          stores: STORES,
          existingNotifications: c1.newNotifications,
          now: t25h
        });
        assert.equal(recovered.newNotifications.length, 0);
        assert.equal(recovered.updatedAlerts[0].rearmState, 'armed');
        assert.equal(recovered.updatedAlerts[0].triggerHistory?.[0]?.outcome, 'rearmed_price_recovered');

        // Prețul coboară din nou la 6.1 -> declanșare în ciclul 2!
        const t30h = new Date(NOW.getTime() + 30 * HOUR_MS);
        const c2 = PriceAlertService.evaluateAlerts({
          alerts: recovered.updatedAlerts,
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-r3', price: 6.1, observationDate: t30h.toISOString().slice(0, 10), lastChecked: t30h.toISOString(), lastVerifiedAt: t30h.toISOString() })],
          stores: STORES,
          existingNotifications: c1.newNotifications,
          now: t30h
        });
        assert.equal(c2.newNotifications.length, 1);
        assert.equal(c2.newNotifications[0].triggerCycle, 2);
      }
    },
    {
      name: '19. Modificarea pragului: rearmAlertManually deblochează ciclul și permite evaluarea noii reguli',
      fn: () => {
        const locked = makeAlert({
          targetPrice: 6.5,
          rearmState: 'triggered_locked',
          triggerCycle: 1,
          lastTriggeredAt: NOW.toISOString(),
          lastTriggeredPrice: 6.4,
          lastNotifiedKey: 'old-key'
        });
        const edited = PriceAlertService.rearmAlertManually({ ...locked, targetPrice: 6.0 }, NOW);
        assert.equal(edited.rearmState, 'armed');
        assert.equal(edited.lastTriggeredAt, undefined);
        assert.equal(edited.lastNotifiedKey, undefined);
        assert.equal(edited.triggerHistory?.[0]?.outcome, 'rearmed_manual');

        const evalNew = PriceAlertService.evaluateAlerts({
          alerts: [edited],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-edit', price: 5.9 })],
          stores: STORES,
          now: NOW
        });
        assert.equal(evalNew.newNotifications.length, 1);
        assert.equal(evalNew.newNotifications[0].observedPrice, 5.9);
      }
    },
    {
      name: '20. Dezactivarea alertei (isActive = false): zero notificări chiar dacă prețul scade dramatic',
      fn: () => {
        const offAlert = makeAlert({ isActive: false, targetPrice: 9.0 });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [offAlert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-off', price: 5.0 })],
          stores: STORES,
          now: NOW
        });
        assert.equal(res.newNotifications.length, 0);
        assert.equal(res.updatedAlerts[0].isActive, false);
      }
    },
    {
      name: '22. Istoricul declanșărilor (triggerHistory): păstrează data, prețul, magazinul, tipul alertei și motivul',
      fn: () => {
        const alert = makeAlert({ targetPrice: 6.5 });
        const res = PriceAlertService.evaluateAlerts({
          alerts: [alert],
          products: PRODUCTS,
          offers: [makeOffer({ id: 'o-hist', price: 6.2, storeId: 'kaufland' })],
          stores: STORES,
          now: NOW
        });
        const hist = res.updatedAlerts[0].triggerHistory || [];
        assert.equal(hist.length, 1);
        assert.equal(hist[0].outcome, 'triggered');
        assert.equal(hist[0].observedPrice, 6.2);
        assert.equal(hist[0].storeName, 'Kaufland');
        assert.equal(hist[0].alertType, 'below_target');
        assert.equal(hist[0].evaluatedAt, NOW.toISOString());
        assert.ok(hist[0].reasonRo.length > 10);
      }
    },
    {
      name: '21, 23, 24, 25, 26 & 1/13/19 HTTP End-to-End: API /api/alerts* (401, 403 izolare, CRUD, 400 alias invalid, 500 DB error, concurență Promise.all)',
      fn: async () => {
        // Verificare SQL migrare propusă 014
        const sql014Path = path.resolve(process.cwd(), 'src/db/migrations/PROPOSED_014_faza4_price_alerts.sql');
        const sql014 = fs.readFileSync(sql014Path, 'utf8');
        const sql014NoComments = sql014.replace(/^--.*$/gm, '');
        assert.match(sql014NoComments, /ALTER TABLE public\.price_alert_events ENABLE ROW LEVEL SECURITY/i);
        assert.match(sql014NoComments, /USING\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
        assert.doesNotMatch(sql014NoComments, /\bDROP\s+TABLE\b|\bTRUNCATE\b/i);

        // Pregătim catalog izolat curat în StorageService (folosit de server.ts când COSUL_MEU_ISOLATED_TEST=1)
        const prevOffers = StorageService.getProductOffers();

        for (const p of PRODUCTS) {
          StorageService.addCustomProduct(p);
        }
        StorageService.saveProductOffers([
          makeOffer({ id: 'http-o-1', productId: 'f4-lapte-root', storeId: 'lidl', price: 6.1 })
        ]);

        const userAId = '00000000-0000-4000-8000-00000000aaa1';
        const userBId = '00000000-0000-4000-8000-00000000bbb2';
        const dbAlerts: Array<Record<string, any>> = [];
        const dbNotifs: Array<Record<string, any>> = [];
        const dbPrefsByUser: Record<string, Record<string, any>> = {
          [userAId]: { priceAlertMeta: {} },
          [userBId]: { priceAlertMeta: {} }
        };
        let forceNotifPersistenceError = false;
        let forceAlertInsertError = false;
        let notifInsertAttempts = 0;

        const origFetch = global.fetch;
        process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
        process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key';
        process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key';

        global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          const method = (init?.method || 'GET').toUpperCase();
          const headers = new Headers(init?.headers || {});
          const authHeader = headers.get('Authorization') || headers.get('authorization') || '';

          if (!urlStr.includes('supabase.co')) {
            return origFetch(input, init);
          }

          if (urlStr.includes('/auth/v1/user')) {
            if (authHeader.includes('token-user-a')) {
              return new Response(JSON.stringify({ id: userAId, email: 'usera@example.com' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (authHeader.includes('token-user-b')) {
              return new Response(JSON.stringify({ id: userBId, email: 'userb@example.com' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response(JSON.stringify({ message: 'Invalid JWT' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const actingUserId = authHeader.includes('token-user-b')
            ? userBId
            : authHeader.includes('token-user-a')
              ? userAId
              : null;
          const isServiceRole = authHeader.includes('service-role-key');

          if (urlStr.includes('/rest/v1/user_preferences')) {
            return new Response(JSON.stringify({ price_alerts_enabled: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          if (urlStr.includes('/rest/v1/profiles')) {
            const uid = actingUserId || userAId;
            if (method === 'PATCH' || method === 'POST') {
              const body = init?.body ? JSON.parse(String(init.body)) : {};
              if (body?.preferences) dbPrefsByUser[uid] = body.preferences;
              return new Response(JSON.stringify([{ id: uid, preferences: dbPrefsByUser[uid] }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response(JSON.stringify({ preferences: dbPrefsByUser[uid] || {} }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          if (urlStr.includes('/rest/v1/price_alert_events')) {
            return new Response(JSON.stringify([]), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          if (urlStr.includes('/rest/v1/price_alert_notifications')) {
            if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
              if (forceNotifPersistenceError) {
                return new Response(JSON.stringify({ message: 'Simulated DB write failure on notifications' }), {
                  status: 500,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
              notifInsertAttempts++;
              // Simulăm o latență asincronă reală pentru testul de concurență!
              await new Promise(r => setTimeout(r, 15));
              const rawBody = init?.body ? JSON.parse(String(init.body)) : {};
              const rows = Array.isArray(rawBody) ? rawBody : [rawBody];
              for (const row of rows) {
                const exists = dbNotifs.some(
                  n => n.user_id === row.user_id && n.dedupe_key === row.dedupe_key
                );
                if (!exists) {
                  dbNotifs.push(row);
                }
              }
              return new Response(JSON.stringify(rows), {
                status: 201,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            const uid = actingUserId || userAId;
            return new Response(JSON.stringify(dbNotifs.filter(n => n.user_id === uid)), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          if (urlStr.includes('/rest/v1/price_alerts')) {
            const parsedUrl = new URL(urlStr);
            const idParam = parsedUrl.searchParams.get('id');
            const idFilter = idParam?.startsWith('eq.') ? idParam.slice(3) : null;
            const userParam = parsedUrl.searchParams.get('user_id');
            const userFilter = userParam?.startsWith('eq.') ? userParam.slice(3) : null;

            if (method === 'POST') {
              if (forceAlertInsertError) {
                return new Response(JSON.stringify({ message: 'Simulated DB insert failure on price_alerts' }), {
                  status: 500,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
              const row = init?.body ? JSON.parse(String(init.body)) : {};
              dbAlerts.push(row);
              return new Response(JSON.stringify(row), {
                status: 201,
                headers: { 'Content-Type': 'application/json' }
              });
            }

            if (method === 'PATCH') {
              const patch = init?.body ? JSON.parse(String(init.body)) : {};
              const found = dbAlerts.find(
                a => (!idFilter || a.id === idFilter) && (!userFilter || a.user_id === userFilter)
              );
              if (!found) {
                return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
              }
              Object.assign(found, patch);
              return new Response(JSON.stringify(found), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (method === 'DELETE') {
              const idx = dbAlerts.findIndex(
                a => (!idFilter || a.id === idFilter) && (!userFilter || a.user_id === userFilter)
              );
              if (idx >= 0) dbAlerts.splice(idx, 1);
              return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // GET
            const matching = dbAlerts.filter(a => {
              if (idFilter && a.id !== idFilter) return false;
              if (userFilter && a.user_id !== userFilter) return false;
              if (!isServiceRole && actingUserId && a.user_id !== actingUserId) return false;
              return true;
            });
            const acceptHdr = headers.get('Accept') || '';
            if (acceptHdr.includes('application/vnd.pgrst.object+json') || parsedUrl.pathname.endsWith('price_alerts') && idFilter) {
              return new Response(JSON.stringify(matching[0] || null), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response(JSON.stringify(matching), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as typeof fetch;

        const { app } = await import('../server.ts');
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        assert.ok(addr && typeof addr !== 'string');
        const baseUrl = `http://127.0.0.1:${addr.port}`;

        try {
          // Req 24: Acces neautorizat -> 401
          const rUnauth = await origFetch(`${baseUrl}/api/alerts`);
          assert.equal(rUnauth.status, 401);
          const rEvalUnauth = await origFetch(`${baseUrl}/api/alerts/evaluate`, { method: 'POST' });
          assert.equal(rEvalUnauth.status, 401);

          // Req 13 (HTTP): Alias invalid / ciclu / orfan -> 400
          const rInvalidCycle = await origFetch(`${baseUrl}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
            body: JSON.stringify({ productId: 'f4-cyc-a', alertType: 'below_target', targetPrice: 5.0 })
          });
          assert.equal(rInvalidCycle.status, 400);

          const rInvalidOrphan = await origFetch(`${baseUrl}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
            body: JSON.stringify({ productId: 'f4-orphan', alertType: 'product_watch' })
          });
          assert.equal(rInvalidOrphan.status, 400);

          // Req 1 (HTTP): User A creează alertă below_target prin alias valid -> rezolvare canonică la f4-lapte-root
          const rCreateA = await origFetch(`${baseUrl}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
            body: JSON.stringify({
              productId: 'f4-lapte-alias',
              alertType: 'below_target',
              targetPrice: 6.5,
              cooldownHours: 24
            })
          });
          assert.equal(rCreateA.status, 201);
          const createABody = await rCreateA.json();
          assert.equal(createABody.alert.productId, 'f4-lapte-root');
          const alertAId = createABody.alert.id;

          // Req 23: Izolare între utilizatori — User B NU poate modifica sau șterge alerta lui User A (403)
          const rPatchForbidden = await origFetch(`${baseUrl}/api/alerts/${alertAId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-b' },
            body: JSON.stringify({ targetPrice: 4.0 })
          });
          assert.equal(rPatchForbidden.status, 403);

          const rDeleteForbidden = await origFetch(`${baseUrl}/api/alerts/${alertAId}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer token-user-b' }
          });
          assert.equal(rDeleteForbidden.status, 403);

          // Req 26: Condiții concurente — 3 apeluri simultane POST /api/alerts/evaluate pentru User A
          // Lock-ul per user serializează evaluările -> exact 1 notificare creată, 0 duplicate!
          const concurrentResponses = await Promise.all([
            origFetch(`${baseUrl}/api/alerts/evaluate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
              body: JSON.stringify({ fakeOverridePrice: 0.01 }) // trebuie ignorat!
            }),
            origFetch(`${baseUrl}/api/alerts/evaluate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' }
            }),
            origFetch(`${baseUrl}/api/alerts/evaluate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' }
            })
          ]);
          for (const resp of concurrentResponses) {
            assert.equal(resp.status, 200);
          }
          const evalPayloads = await Promise.all(concurrentResponses.map(r => r.json()));
          const totalEmitted = evalPayloads.reduce((acc, p) => acc + (p.newNotificationsCount || 0), 0);
          assert.equal(totalEmitted, 1);
          assert.equal(dbNotifs.filter(n => n.user_id === userAId).length, 1);
          assert.equal(notifInsertAttempts, 1);

          // Req 19 (HTTP): Modificarea pragului prin PATCH reînarmează curat alerta
          const rPatchA = await origFetch(`${baseUrl}/api/alerts/${alertAId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
            body: JSON.stringify({ targetPrice: 6.2 })
          });
          assert.equal(rPatchA.status, 200);
          const patchBody = await rPatchA.json();
          assert.equal(patchBody.alert.rearmState, 'armed');
          assert.equal(patchBody.alert.targetPrice, 6.2);

          // Req 25: Eroare de persistență -> HTTP 500 explicit (nu succes fals)
          forceNotifPersistenceError = true;
          const rEvalFail = await origFetch(`${baseUrl}/api/alerts/evaluate`, {
            method: 'POST',
            headers: { Authorization: 'Bearer token-user-a' }
          });
          assert.equal(rEvalFail.status, 500);
          forceNotifPersistenceError = false;

          forceAlertInsertError = true;
          const rCreateFail = await origFetch(`${baseUrl}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
            body: JSON.stringify({ productId: 'f4-cafea-root', alertType: 'product_watch' })
          });
          assert.equal(rCreateFail.status, 500);
          forceAlertInsertError = false;

          // Req 21: Ștergerea alertei de către proprietar
          const rDeleteA = await origFetch(`${baseUrl}/api/alerts/${alertAId}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer token-user-a' }
          });
          assert.equal(rDeleteA.status, 200);
          assert.equal(dbAlerts.filter(a => a.id === alertAId).length, 0);
        } finally {
          global.fetch = origFetch;
          StorageService.saveProductOffers(prevOffers);
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
      }
    },
    {
      name: '27. Regresie FAZA 2.1: Single-Store Basket Optimizer continuă să funcționeze corect',
      fn: () => {
        const items: ShoppingListItem[] = [
          { id: 'li-1', productId: 'f4-lapte-root', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 2, unit: 'l', checked: false },
          { id: 'li-2', productId: 'f4-cafea-root', name: 'Cafea 500g', category: 'Băuturi', quantity: 1, unit: 'buc', checked: false }
        ];
        const opt = BasketOptimizerService.optimize({
          list: { id: 'reg-21', name: 'Test 2.1' },
          items,
          products: PRODUCTS,
          offers: [
            makeOffer({ id: 'o-21-l1', productId: 'f4-lapte-root', storeId: 'lidl', price: 6.0 }),
            makeOffer({ id: 'o-21-c1', productId: 'f4-cafea-root', storeId: 'lidl', price: 24.0, unitPriceMeasure: 'lei/kg' }),
            makeOffer({ id: 'o-21-l2', productId: 'f4-lapte-root', storeId: 'kaufland', price: 6.5 }),
            makeOffer({ id: 'o-21-c2', productId: 'f4-cafea-root', storeId: 'kaufland', price: 27.0, unitPriceMeasure: 'lei/kg' })
          ],
          stores: STORES,
          options: { maxStores: 1, now: NOW }
        });
        assert.equal(opt.bestSingleStore?.store.id, 'lidl');
        assert.equal(opt.bestSingleStore?.totalPrice, 36.0);
      }
    },
    {
      name: '28. Regresie FAZA 2.2: Multi-Store Basket Optimizer continuă să calculeze split-ul optim',
      fn: () => {
        const items: ShoppingListItem[] = [
          { id: 'li-1', productId: 'f4-lapte-root', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 2, unit: 'l', checked: false },
          { id: 'li-2', productId: 'f4-cafea-root', name: 'Cafea 500g', category: 'Băuturi', quantity: 1, unit: 'buc', checked: false }
        ];
        const opt = BasketOptimizerService.optimize({
          list: { id: 'reg-22', name: 'Test 2.2' },
          items,
          products: PRODUCTS,
          offers: [
            makeOffer({ id: 'o-22-l1', productId: 'f4-lapte-root', storeId: 'lidl', price: 5.5 }),
            makeOffer({ id: 'o-22-c1', productId: 'f4-cafea-root', storeId: 'lidl', price: 32.0, unitPriceMeasure: 'lei/kg' }),
            makeOffer({ id: 'o-22-l2', productId: 'f4-lapte-root', storeId: 'kaufland', price: 8.5 }),
            makeOffer({ id: 'o-22-c2', productId: 'f4-cafea-root', storeId: 'kaufland', price: 22.0, unitPriceMeasure: 'lei/kg' })
          ],
          stores: STORES,
          options: { maxStores: 2, now: NOW }
        });
        assert.equal(opt.bestTwoStores?.stops.length, 2);
        assert.equal(opt.bestTwoStores?.productsTotal, 33.0);
        assert.equal(opt.recommendedMultiStore?.storeCount, 2);
        assert.ok((opt.recommendedMultiStore?.savingsVsBestSingleStore ?? 0) > 0);
      }
    },
    {
      name: '29. Regresie FAZA 3.1: PriceHistoryService calculează statistici reale pe 30/90/180/365 zile',
      fn: () => {
        const stats = PriceHistoryService.getProductPriceStats('f4-lapte-root', {
          observations: [
            { id: 'h1', productId: 'f4-lapte-root', storeId: 'lidl', price: 6.4, date: DAYS_20_AGO, source: 'official_feed' },
            { id: 'h2', productId: 'f4-lapte-root', storeId: 'kaufland', price: 7.2, date: DAYS_40_AGO, source: 'verified' }
          ],
          stores: STORES,
          now: NOW
        });
        assert.equal(stats.intervalStats[30].observationsCount, 1);
        assert.equal(stats.intervalStats[90].observationsCount, 2);
        assert.equal(stats.intervalStats[90].minPrice, 6.4);
        assert.equal(stats.intervalStats[90].avgPrice, 6.8);
      }
    },
    {
      name: '30. Regresie FAZA 3.2: PriceQualityClassifier prioritizează SUSPICIOUS peste recență și clasifică observația veche ca STALE',
      fn: () => {
        const aliasIndex = buildCanonicalAliasIndex(PRODUCTS);
        const susp = PriceQualityClassifier.classifyOffer(
          makeOffer({ id: 'q-susp', price: 0.4, lastVerifiedAt: NOW.toISOString(), lastChecked: NOW.toISOString() }),
          {
            product: PRODUCTS[0],
            expectedProductId: 'f4-lapte-root',
            aliasSource: aliasIndex,
            historicalBaselinePrice: 7.5,
            now: NOW
          }
        );
        assert.equal(susp.status, 'SUSPICIOUS');
        assert.equal(susp.isUsableForComparison, false);

        const oldIso = new Date(NOW.getTime() - 5 * DAY_MS).toISOString(); // 120h => STALE pentru ofertă (>72h, <=168h)
        const stale = PriceQualityClassifier.classifyOffer(
          makeOffer({ id: 'q-stale', price: 7.1, observationDate: oldIso.slice(0, 10), lastVerifiedAt: oldIso, lastChecked: oldIso }),
          {
            product: PRODUCTS[0],
            expectedProductId: 'f4-lapte-root',
            aliasSource: aliasIndex,
            historicalBaselinePrice: 7.5,
            now: NOW
          }
        );
        assert.equal(stale.status, 'STALE');
        assert.equal(stale.isReliableForOptimization, false);

        const staleObs = PriceQualityClassifier.classifyObservation(
          {
            id: 'obs-stale-40d',
            productId: 'f4-lapte-root',
            storeId: 'lidl',
            price: 7.1,
            date: DAYS_40_AGO,
            source: 'verified'
          },
          {
            product: PRODUCTS[0],
            expectedProductId: 'f4-lapte-root',
            aliasSource: aliasIndex,
            historicalBaselinePrice: 7.5,
            now: NOW
          }
        );
        assert.equal(staleObs.status, 'STALE');
      }
    }
  ];

  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ [PASS] ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${t.name}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log(`\n🎉 Suita FAZA 4 — PRICE ALERTS finalizată cu succes: ${passed}/${tests.length} scenarii verificate!`);
}

runTests();
