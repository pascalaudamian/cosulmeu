// tests/faza5-price-quality-monitoring.test.ts
// Suită dedicată FAZA 5 — PRICE QUALITY MONITORING & ADMIN DASHBOARD
// Acoperă toate cele 30 de scenarii: distribuție pe 6 statusuri, detectare anomalii (10 reguli),
// integritate canonică, calitatea surselor, transparență acoperire, evoluție fără date fabricate,
// garanție READ-ONLY pe datele de preț, investigație + audit log, export sigur CSV/JSON,
// securitate RBAC 401/403, validare Zod 400, rate limiting 429, izolare zero PII, performanță volum mare & regresii.

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { PriceQualityMonitoringService } from '../src/services/PriceQualityMonitoringService.js';
import { PriceQualityClassifier } from '../src/services/PriceQualityClassifier.js';
import { PriceHistoryService } from '../src/services/PriceHistoryService.js';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.js';
import { StorageService } from '../src/services/StorageService.js';
import type {
  PriceObservation,
  PriceObservationQualityInput,
  Product,
  ProductOffer,
  ShoppingListItem,
  Store
} from '../src/types.js';

const NOW = new Date('2026-11-26T10:00:00Z');
const TODAY = '2026-11-26';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const D_1D_AGO = new Date(NOW.getTime() - DAY_MS).toISOString().slice(0, 10);
const D_15D_AGO = new Date(NOW.getTime() - 15 * DAY_MS).toISOString().slice(0, 10);
const D_45D_AGO = new Date(NOW.getTime() - 45 * DAY_MS).toISOString().slice(0, 10);
const D_10D_AGO = new Date(NOW.getTime() - 10 * DAY_MS).toISOString().slice(0, 10);
const D_5D_AGO = new Date(NOW.getTime() - 5 * DAY_MS).toISOString().slice(0, 10);

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
    locationsCount: 190,
    sampleAddress: 'România'
  }
];

const BASE_PRODUCTS: Product[] = [
  {
    id: 'f5-lapte',
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
    id: 'f5-cafea',
    name: 'Cafea boabe 500g',
    brand: 'Lavazza',
    category: 'Băuturi',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 45
  }
];

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: `off-${Math.random().toString(36).slice(2, 8)}`,
    productId: 'f5-lapte',
    storeId: 'lidl',
    price: 7.2,
    currency: 'RON',
    unitPrice: 7.2,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    loyaltyCardRequired: false,
    observationDate: TODAY,
    lastChecked: NOW.toISOString(),
    lastVerifiedAt: NOW.toISOString(),
    source: 'official_feed',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    ...overrides
  };
}

function makeObs(
  overrides: Partial<PriceObservation & PriceObservationQualityInput> = {}
): PriceObservation & Partial<PriceObservationQualityInput> {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    productId: 'f5-lapte',
    storeId: 'lidl',
    price: 7.2,
    currency: 'RON',
    date: D_1D_AGO,
    source: 'official_feed',
    verificationStatus: 'verified',
    ...overrides
  };
}

async function runTests() {
  const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [
    {
      name: '1. Distribuție completă pe toate cele 6 statusuri oficiale PriceQualityClassifier',
      fn: () => {
        const offers: ProductOffer[] = [
          // VERIFIED_RECENTLY (<=24h, verified)
          makeOffer({ id: 'o-vr', lastVerifiedAt: NOW.toISOString(), lastChecked: NOW.toISOString(), price: 7.4 }),
          // VERIFIED (24-72h)
          makeOffer({
            id: 'o-v',
            storeId: 'kaufland',
            lastVerifiedAt: new Date(NOW.getTime() - 40 * HOUR_MS).toISOString(),
            lastChecked: new Date(NOW.getTime() - 40 * HOUR_MS).toISOString(),
            price: 7.5
          }),
          // STALE (72-168h)
          makeOffer({
            id: 'o-st',
            storeId: 'carrefour',
            lastVerifiedAt: new Date(NOW.getTime() - 100 * HOUR_MS).toISOString(),
            lastChecked: new Date(NOW.getTime() - 100 * HOUR_MS).toISOString(),
            price: 7.6
          }),
          // UNVERIFIED (pending)
          makeOffer({ id: 'o-uv', verificationStatus: 'pending', price: 7.5 }),
          // EXPIRED (validUntil trecut)
          makeOffer({ id: 'o-ex', validUntil: D_5D_AGO, price: 6.9, verificationStatus: 'expired' }),
          // SUSPICIOUS (preț zero)
          makeOffer({ id: 'o-su', price: 0 })
        ];

        const obs: PriceObservation[] = [
          makeObs({ id: 'obs-vr', date: D_1D_AGO }),
          makeObs({ id: 'obs-v', date: D_15D_AGO }),
          makeObs({ id: 'obs-st', date: D_45D_AGO }),
          makeObs({ id: 'obs-uv', date: D_1D_AGO, source: 'user_reported', verificationStatus: 'pending' }),
          makeObs({ id: 'obs-su', date: D_1D_AGO, price: -3 })
        ];

        const res = PriceQualityMonitoringService.evaluateDataset(
          { products: BASE_PRODUCTS, stores: STORES, offers, observations: obs },
          { intervalDays: 90, now: NOW }
        );

        const d = res.overview.statusDistribution;
        assert.ok(d.VERIFIED_RECENTLY >= 2, 'Trebuie să includă VERIFIED_RECENTLY');
        assert.ok(d.VERIFIED >= 2, 'Trebuie să includă VERIFIED');
        assert.ok(d.STALE >= 2, 'Trebuie să includă STALE');
        assert.ok(d.UNVERIFIED >= 2, 'Trebuie să includă UNVERIFIED');
        assert.ok(d.EXPIRED >= 1, 'Trebuie să includă EXPIRED');
        assert.ok(d.SUSPICIOUS >= 2, 'Trebuie să includă SUSPICIOUS');
        assert.equal(
          d.VERIFIED_RECENTLY + d.VERIFIED + d.STALE + d.UNVERIFIED + d.EXPIRED + d.SUSPICIOUS,
          res.overview.kpis.totalRecordsAnalyzed
        );
      }
    },
    {
      name: '2. SUSPICIOUS nu este transformat în VERIFIED_RECENTLY chiar dacă observația este de azi',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [],
            observations: [
              makeObs({ id: 'obs-today-susp', date: TODAY, price: 99.9, source: 'official_feed' })
            ]
          },
          { intervalDays: 30, now: NOW }
        );
        assert.equal(res.overview.statusDistribution.VERIFIED_RECENTLY, 0);
        assert.equal(res.overview.statusDistribution.SUSPICIOUS, 1);
        assert.equal(res.records[0].isUsableForComparison, false);
      }
    },
    {
      name: '3. Preț zero sau negativ -> anomalie zero_or_negative_price + exclus din comparații',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-zero', price: 0 })],
            observations: [makeObs({ id: 'obs-neg', price: -12.5, date: TODAY })]
          },
          { intervalDays: 30, now: NOW }
        );
        const zeroAnoms = res.anomalies.filter(a => a.anomalyType === 'zero_or_negative_price');
        assert.equal(zeroAnoms.length, 2);
        assert.equal(zeroAnoms[0].severity, 'critical');
        assert.equal(res.overview.kpis.excludedFromComparisonCount, 2);
      }
    },
    {
      name: '4. Variație extremă inexplicabilă -> anomalie extreme_price_outlier',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-spike', price: 18.0 })],
            observations: [makeObs({ id: 'obs-drop-nopromo', price: 1.5, date: TODAY, isPromo: false })]
          },
          { intervalDays: 30, now: NOW }
        );
        const outliers = res.anomalies.filter(a => a.anomalyType === 'extreme_price_outlier');
        assert.equal(outliers.length, 2);
        assert.ok(outliers.every(a => a.reasonRo.length > 10));
      }
    },
    {
      name: '5. Promoție inconsistentă (validFrom > validUntil, promoPrice > normalPrice, card lipsă) -> inconsistent_promotion',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [
              makeOffer({
                id: 'o-bad-promo-dates',
                isPromo: true,
                validFrom: '2026-11-28',
                validUntil: '2026-11-20',
                price: 6.5
              }),
              makeOffer({
                id: 'o-bad-promo-price',
                isPromo: true,
                normalPrice: 6.0,
                promoPrice: 8.5,
                price: 8.5
              }),
              makeOffer({
                id: 'o-bad-loyalty',
                isPromo: true,
                loyaltyCardRequired: true,
                loyaltyCardName: '',
                price: 6.8
              })
            ],
            observations: []
          },
          { intervalDays: 30, now: NOW }
        );
        const promoAnoms = res.anomalies.filter(a => a.anomalyType === 'inconsistent_promotion');
        assert.equal(promoAnoms.length, 3);
      }
    },
    {
      name: '6. Monedă incompatibilă (EUR / USD) -> anomalie incompatible_currency',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-eur', currency: 'EUR', price: 1.5, unitPriceMeasure: 'EUR/l' as any })],
            observations: [makeObs({ id: 'obs-usd', currency: 'USD', price: 2.0, date: TODAY })]
          },
          { intervalDays: 30, now: NOW }
        );
        const currAnoms = res.anomalies.filter(a => a.anomalyType === 'incompatible_currency');
        assert.equal(currAnoms.length, 2);
        assert.equal(res.overview.kpis.excludedFromComparisonCount, 2);
      }
    },
    {
      name: '7. Timestamp invalid sau imposibil calendaristic (2026-02-30 / viitor) -> invalid_timestamp',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-future-ts', lastVerifiedAt: '2027-01-15T10:00:00Z', lastChecked: '2027-01-15T10:00:00Z' })],
            observations: [makeObs({ id: 'obs-feb30', date: '2026-02-30' })]
          },
          { intervalDays: 30, now: NOW }
        );
        const tsAnoms = res.anomalies.filter(a => a.anomalyType === 'invalid_timestamp');
        assert.equal(tsAnoms.length, 2);
      }
    },
    {
      name: '8. Sursă demo sau estimated -> untrusted_demo_or_estimated_source + SUSPICIOUS',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-demo', source: 'demo', verificationStatus: 'demo', price: 7.5 })],
            observations: [makeObs({ id: 'obs-est', source: 'estimated', date: TODAY, price: 7.5 })]
          },
          { intervalDays: 30, now: NOW }
        );
        const srcAnoms = res.anomalies.filter(a => a.anomalyType === 'untrusted_demo_or_estimated_source');
        assert.equal(srcAnoms.length, 2);
        assert.equal(res.overview.statusDistribution.SUSPICIOUS, 2);
      }
    },
    {
      name: '9. Conflict de unitate/gramaj -> unit_or_weight_conflict',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-unit-bad', productId: 'f5-lapte', unitPriceMeasure: 'lei/kg', price: 7.5 })],
            observations: [
              makeObs({ id: 'obs-pkg-bad', productId: 'f5-lapte', packageWeightOrVolume: 5, packageUnit: 'l', date: TODAY })
            ]
          },
          { intervalDays: 30, now: NOW }
        );
        const unitAnoms = res.anomalies.filter(a => a.anomalyType === 'unit_or_weight_conflict');
        assert.equal(unitAnoms.length, 2);
      }
    },
    {
      name: '10. Ofertă expirată încă marcată verified -> expired_offer_active + exclusă din optimizare',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-exp-active', validUntil: D_5D_AGO, verificationStatus: 'verified', price: 6.5 })],
            observations: []
          },
          { intervalDays: 30, now: NOW }
        );
        const expAnoms = res.anomalies.filter(a => a.anomalyType === 'expired_offer_active');
        assert.equal(expAnoms.length, 1);
        assert.equal(res.overview.kpis.expiredOffersCount, 1);
        assert.equal(res.records[0].isExpiredOffer, true);
        assert.equal(res.records[0].isReliableForOptimization, false);
      }
    },
    {
      name: '11. Integritate canonică: detectare ciclu, auto-referință, lanț >16 niveluri și alias orfan (read-only)',
      fn: () => {
        const deepProducts: Product[] = [];
        for (let i = 1; i <= 18; i++) {
          deepProducts.push({
            ...BASE_PRODUCTS[0],
            id: `chain-${i}`,
            name: `Lanț ${i}`,
            canonicalProductId: i < 18 ? `chain-${i + 1}` : null
          });
        }
        const canonProducts: Product[] = [
          ...BASE_PRODUCTS,
          { ...BASE_PRODUCTS[0], id: 'self-ref', name: 'Auto-Ref', canonicalProductId: 'self-ref' },
          { ...BASE_PRODUCTS[0], id: 'cyc-a', name: 'Ciclu A', canonicalProductId: 'cyc-b' },
          { ...BASE_PRODUCTS[0], id: 'cyc-b', name: 'Ciclu B', canonicalProductId: 'cyc-a' },
          { ...BASE_PRODUCTS[0], id: 'orphan-x', name: 'Orfan X', canonicalProductId: 'missing-root-999' },
          ...deepProducts
        ];

        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: canonProducts,
            stores: STORES,
            offers: [makeOffer({ id: 'o-inconsistent', productId: 'nonexistent-prod' })],
            observations: []
          },
          { intervalDays: 30, now: NOW }
        );

        const ci = res.overview.canonicalIntegrity;
        assert.equal(ci.selfReferencesCount, 1);
        assert.equal(ci.cyclesCount, 2);
        assert.ok(ci.chainsTooDeepCount >= 1);
        assert.equal(ci.orphanAliasesCount, 1);
        assert.ok(ci.inconsistentReferencesCount >= 1);
        assert.ok(ci.issues.some(i => i.issueType === 'self_reference'));
        assert.ok(ci.issues.some(i => i.issueType === 'cycle'));
        assert.ok(ci.issues.some(i => i.issueType === 'orphan_alias'));
        assert.ok(ci.issues.some(i => i.issueType === 'chain_too_deep'));
      }
    },
    {
      name: '12. Prețuri contradictorii multi-sursă pentru același produs și magazin -> conflicting_multi_source_prices',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [
              makeOffer({ id: 'o-src1', productId: 'f5-lapte', storeId: 'lidl', source: 'official_feed', price: 6.5 }),
              makeOffer({ id: 'o-src2', productId: 'f5-lapte', storeId: 'lidl', source: 'user_reported', price: 11.5 })
            ],
            observations: []
          },
          { intervalDays: 30, now: NOW }
        );
        const conflicts = res.anomalies.filter(a => a.anomalyType === 'conflicting_multi_source_prices');
        assert.equal(conflicts.length, 1);
        assert.ok(conflicts[0].reasonRo.includes('contradictorii'));
      }
    },
    {
      name: '13. Calitatea pe surse (sourceQuality): procent suspecte, erori import, neverificate și variații',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [
              makeOffer({ id: 'o-s1', source: 'official_feed', price: 7.4 }),
              makeOffer({ id: 'o-s2', source: 'demo', verificationStatus: 'demo', price: 7.4 })
            ],
            observations: [
              makeObs({ id: 'obs-s1', source: 'user_reported', verificationStatus: 'pending', date: TODAY, price: 7.5 })
            ],
            importErrors: [
              {
                id: 'err-1',
                runId: 'run-1',
                documentId: 'doc-1',
                retailerId: 'official_feed',
                stage: 'parse',
                message: 'Eroare test',
                createdAt: NOW.toISOString()
              }
            ]
          },
          { intervalDays: 30, now: NOW }
        );

        const official = res.overview.sourceQuality.find(s => s.source === 'official_feed');
        const demo = res.overview.sourceQuality.find(s => s.source === 'demo');
        const userRep = res.overview.sourceQuality.find(s => s.source === 'user_reported');
        assert.ok(official && official.importErrorCount === 1);
        assert.ok(demo && demo.suspiciousPct === 100 && demo.reliabilityStatus === 'untrusted');
        assert.ok(userRep && userRep.unverifiedCount === 1);
      }
    },
    {
      name: '14. Transparență acoperire & eșantion parțial explicit marcat',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-cov' })],
            observations: [makeObs({ id: 'obs-cov', date: TODAY })],
            totalObservationsInPeriod: 8500,
            totalOffersInCatalog: 1200,
            dataSource: 'postgresql'
          },
          { intervalDays: 30, maxSampleLimit: 2000, now: NOW }
        );
        assert.equal(res.overview.coverage.isPartialSample, true);
        assert.equal(res.overview.coverage.totalObservationsInPeriod, 8500);
        assert.equal(res.overview.coverage.analyzedObservationsCount, 1);
        assert.ok(res.overview.coverage.coverageNoteRo.includes('Eșantion parțial'));
      }
    },
    {
      name: '15. Evoluția în timp (evolution) folosește strict zilele reale ale observațiilor, fără zile inventate',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [],
            observations: [
              makeObs({ id: 'e1', date: D_10D_AGO, price: 7.4 }),
              makeObs({ id: 'e2', date: D_10D_AGO, price: 0 }),
              makeObs({ id: 'e3', date: D_1D_AGO, price: 7.5 })
            ]
          },
          { intervalDays: 30, now: NOW }
        );
        assert.equal(res.overview.evolution.length, 2);
        assert.equal(res.overview.evolution[0].date, D_10D_AGO);
        assert.equal(res.overview.evolution[0].total, 2);
        assert.equal(res.overview.evolution[0].suspicious, 1);
        assert.equal(res.overview.evolution[1].date, D_1D_AGO);
      }
    },
    {
      name: '16. Dataset complet gol -> returnează hasData=false și 0 fără crash sau cifre inventate',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          { products: [], stores: [], offers: [], observations: [] },
          { intervalDays: 30, now: NOW }
        );
        assert.equal(res.overview.hasData, false);
        assert.equal(res.overview.kpis.totalRecordsAnalyzed, 0);
        assert.equal(res.overview.kpis.avgQualityScore, null);
        assert.equal(res.overview.evolution.length, 0);
        assert.equal(res.anomalies.length, 0);
      }
    },
    {
      name: '17. Garanție strictă READ-ONLY: datele inițiale (products, offers, observations) nu suferă nicio mutație',
      fn: () => {
        const productsCopy = structuredClone(BASE_PRODUCTS);
        const offersCopy = structuredClone([makeOffer({ id: 'ro-1', price: -5, isFlaggedAnomaly: false })]);
        const obsCopy = structuredClone([makeObs({ id: 'ro-obs-1', price: 0, date: TODAY })]);

        const snapProdBefore = JSON.stringify(productsCopy);
        const snapOffBefore = JSON.stringify(offersCopy);
        const snapObsBefore = JSON.stringify(obsCopy);

        PriceQualityMonitoringService.evaluateDataset(
          { products: productsCopy, stores: STORES, offers: offersCopy, observations: obsCopy },
          { intervalDays: 30, now: NOW }
        );

        assert.equal(JSON.stringify(productsCopy), snapProdBefore);
        assert.equal(JSON.stringify(offersCopy), snapOffBefore);
        assert.equal(JSON.stringify(obsCopy), snapObsBefore);
      }
    },
    {
      name: '18. Filtrare și paginare anomalii pe criterii multiple',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [
              makeOffer({ id: 'f-o1', storeId: 'lidl', source: 'demo', verificationStatus: 'demo', price: 7 }),
              makeOffer({ id: 'f-o2', storeId: 'kaufland', price: 0, source: 'official_feed' }),
              makeOffer({ id: 'f-o3', productId: 'f5-cafea', storeId: 'carrefour', currency: 'EUR', price: 9 })
            ],
            observations: []
          },
          { intervalDays: 30, now: NOW }
        );

        const byStore = PriceQualityMonitoringService.filterAndPaginateAnomalies(res.anomalies, {
          storeId: 'kaufland',
          severity: 'critical'
        });
        assert.equal(byStore.total, 1);
        assert.equal(byStore.items[0].anomalyType, 'zero_or_negative_price');

        const paged = PriceQualityMonitoringService.filterAndPaginateAnomalies(res.anomalies, {
          page: 2,
          limit: 2
        });
        assert.equal(paged.page, 2);
        assert.ok(paged.items.length >= 1);
      }
    },
    {
      name: '19. Filtrare și paginare înregistrări clasificate (expired_offers & SUSPICIOUS)',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [
              makeOffer({ id: 'rec-exp', validUntil: D_5D_AGO, verificationStatus: 'verified', price: 6.5 }),
              makeOffer({ id: 'rec-ok', price: 7.4 })
            ],
            observations: [makeObs({ id: 'rec-obs-susp', date: TODAY, price: -1 })]
          },
          { intervalDays: 30, now: NOW }
        );

        const expiredOnly = PriceQualityMonitoringService.filterAndPaginateRecords(res.records, {
          recordType: 'expired_offers'
        });
        assert.equal(expiredOnly.total, 1);
        assert.equal(expiredOnly.items[0].id, 'rec-exp');

        const suspOnly = PriceQualityMonitoringService.filterAndPaginateRecords(res.records, {
          qualityStatus: 'SUSPICIOUS'
        });
        assert.equal(suspOnly.total, 1);
        assert.equal(suspOnly.items[0].id, 'rec-obs-susp');
      }
    },
    {
      name: '20. Investigație administrativă persistă starea și generează auditLog fără a altera observația',
      fn: async () => {
        PriceQualityMonitoringService.resetMemoryState();
        const inv = await PriceQualityMonitoringService.recordInvestigation({
          anomalyId: 'obs:obs-inv-1:zero_or_negative_price',
          investigationStatus: 'confirmed_anomaly',
          note: 'Confirmat preț eronat în import; rămâne marcat în audit.',
          decision: 'Escaladat la verificare sursă',
          investigatedBy: 'admin@cosulmeu.ro'
        });
        assert.equal(inv.investigation.investigationStatus, 'confirmed_anomaly');
        assert.equal(inv.auditLog.action, 'quality_anomaly_investigated');

        const invMap = await PriceQualityMonitoringService.loadInvestigationsMap();
        assert.ok(invMap.has('obs:obs-inv-1:zero_or_negative_price'));
      }
    },
    {
      name: '21. Export CSV protejat împotriva formula injection (=CMD, +SUM) și fără PII',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: [{ ...BASE_PRODUCTS[0], id: 'p-inj', name: '=CMD("calc")' }],
            stores: STORES,
            offers: [makeOffer({ id: 'o-inj', productId: 'p-inj', price: 0 })],
            observations: []
          },
          { intervalDays: 30, now: NOW }
        );
        const csv = PriceQualityMonitoringService.buildExportCsv(res.overview, res.anomalies);
        assert.ok(csv.includes("'=CMD"));
        assert.doesNotMatch(csv, /user_id|cnp|phone_number/i);
      }
    },
    {
      name: '22. Export JSON complet cu metadate acoperire, 6 statusuri și zero PII',
      fn: () => {
        const res = PriceQualityMonitoringService.evaluateDataset(
          {
            products: BASE_PRODUCTS,
            stores: STORES,
            offers: [makeOffer({ id: 'o-json', price: 7.4 })],
            observations: [makeObs({ id: 'obs-json', date: TODAY, price: 7.4 })]
          },
          { intervalDays: 30, now: NOW }
        );
        const exported = PriceQualityMonitoringService.buildExportJson(res.overview, res.anomalies);
        assert.ok(exported.exportedAt);
        assert.equal(exported.coverage.intervalDays, 30);
        assert.ok('VERIFIED_RECENTLY' in exported.statusDistribution);
        assert.ok('SUSPICIOUS' in exported.statusDistribution);
      }
    },
    {
      name: '23. Determinism: două evaluări identice produc exact aceleași scoruri, statusuri și chei de anomalie',
      fn: () => {
        const input = {
          products: BASE_PRODUCTS,
          stores: STORES,
          offers: [makeOffer({ id: 'det-o1', price: 0 }), makeOffer({ id: 'det-o2', price: 7.5 })],
          observations: [makeObs({ id: 'det-obs1', date: D_1D_AGO, price: 7.4 })]
        };
        const r1 = PriceQualityMonitoringService.evaluateDataset(input, { intervalDays: 30, now: NOW });
        const r2 = PriceQualityMonitoringService.evaluateDataset(input, { intervalDays: 30, now: NOW });
        assert.deepEqual(r1.overview.statusDistribution, r2.overview.statusDistribution);
        assert.deepEqual(
          r1.anomalies.map(a => a.anomalyKey),
          r2.anomalies.map(a => a.anomalyKey)
        );
      }
    },
    {
      name: '24. Performanță pe volum mare: 5.500 observații + 500 oferte evaluate rapid (< 1500ms)',
      fn: () => {
        const manyObs: PriceObservation[] = [];
        for (let i = 0; i < 5500; i++) {
          manyObs.push(
            makeObs({
              id: `bulk-obs-${i}`,
              productId: i % 2 === 0 ? 'f5-lapte' : 'f5-cafea',
              storeId: i % 3 === 0 ? 'lidl' : i % 3 === 1 ? 'kaufland' : 'carrefour',
              price: i % 200 === 0 ? 0 : i % 2 === 0 ? 7.4 : 44.5,
              date: D_1D_AGO
            })
          );
        }
        const manyOffers: ProductOffer[] = [];
        for (let i = 0; i < 500; i++) {
          manyOffers.push(
            makeOffer({
              id: `bulk-off-${i}`,
              productId: i % 2 === 0 ? 'f5-lapte' : 'f5-cafea',
              storeId: 'lidl',
              price: i % 2 === 0 ? 7.4 : 44.5,
              unitPriceMeasure: i % 2 === 0 ? 'lei/l' : 'lei/kg'
            })
          );
        }

        const t0 = Date.now();
        const res = PriceQualityMonitoringService.evaluateDataset(
          { products: BASE_PRODUCTS, stores: STORES, offers: manyOffers, observations: manyObs },
          { intervalDays: 30, maxSampleLimit: 6000, now: NOW }
        );
        const elapsed = Date.now() - t0;
        assert.equal(res.overview.kpis.totalRecordsAnalyzed, 6000);
        assert.ok(elapsed < 1500, `Evaluarea a durat ${elapsed}ms (> 1500ms)`);
      }
    },
    {
      name: '25–29. Securitate HTTP RBAC (401/403), Validare Zod (400), Rate Limit (429), End-to-End API & Propunere SQL 015',
      fn: async () => {
        // Verificare SQL PROPOSED_015 (neexecutată, aditivă, RLS strict admin, fără modificări pe price_observations)
        const sql015Path = path.resolve(
          process.cwd(),
          'src/db/migrations/PROPOSED_015_faza5_price_quality_monitoring.sql'
        );
        const sql015 = fs.readFileSync(sql015Path, 'utf8');
        const sql015NoComments = sql015.replace(/^--.*$/gm, '');
        assert.match(sql015NoComments, /CREATE TABLE IF NOT EXISTS public\.price_quality_monitoring_runs/i);
        assert.match(sql015NoComments, /CREATE TABLE IF NOT EXISTS public\.price_quality_anomaly_investigations/i);
        assert.match(sql015NoComments, /ENABLE ROW LEVEL SECURITY/i);
        assert.doesNotMatch(sql015NoComments, /\bDROP\s+TABLE\b|\bTRUNCATE\b|price_observations/i);

        // Pregătim date curate în StorageService
        PriceQualityMonitoringService.resetMemoryState();
        for (const p of BASE_PRODUCTS) StorageService.addCustomProduct(p);
        StorageService.saveProductOffers([
          makeOffer({ id: 'http-o-ok', productId: 'f5-lapte', price: 7.4 }),
          makeOffer({ id: 'http-o-exp', productId: 'f5-lapte', storeId: 'kaufland', validUntil: D_5D_AGO, verificationStatus: 'verified', price: 6.5 }),
          makeOffer({ id: 'http-o-zero', productId: 'f5-lapte', storeId: 'carrefour', price: 0 })
        ]);
        StorageService.addPriceObservations([
          makeObs({ id: 'http-obs-1', productId: 'f5-lapte', price: 7.4, date: TODAY }),
          makeObs({ id: 'http-obs-demo', productId: 'f5-lapte', price: 7.5, date: TODAY, source: 'demo' })
        ]);

        const { app } = await import('../server.ts');
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const baseUrl = `http://127.0.0.1:${port}`;
        const adminToken = process.env.ADMIN_API_KEY || 'cosul-meu-admin-dev-secret-2026';

        try {
          // 25. RBAC: fără token -> 401, token invalid -> 403
          const unauthOverview = await fetch(`${baseUrl}/api/admin/quality-monitoring/overview`);
          assert.equal(unauthOverview.status, 401);

          const forbiddenRun = await fetch(`${baseUrl}/api/admin/quality-monitoring/run`, {
            method: 'POST',
            headers: { Authorization: 'Bearer invalid-token' }
          });
          assert.equal(forbiddenRun.status, 403);

          const unauthExport = await fetch(`${baseUrl}/api/admin/quality-monitoring/export?format=csv`);
          assert.equal(unauthExport.status, 401);

          // 26. Validare Zod -> 400
          const badInterval = await fetch(`${baseUrl}/api/admin/quality-monitoring/overview?intervalDays=9999`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(badInterval.status, 400);

          const badDate = await fetch(`${baseUrl}/api/admin/quality-monitoring/anomalies?fromDate=2026-99-99`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(badDate.status, 400);

          const badExport = await fetch(`${baseUrl}/api/admin/quality-monitoring/export?format=xml`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(badExport.status, 400);

          // 28. Flux complet E2E: run -> overview -> anomalies -> records -> investigate -> history -> export
          const runRes = await fetch(`${baseUrl}/api/admin/quality-monitoring/run`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ intervalDays: 30, maxSample: 500 })
          });
          assert.equal(runRes.status, 200);
          const runJson = await runRes.json();
          assert.equal(runJson.success, true);
          assert.ok(runJson.run.id);
          assert.equal(runJson.auditLog.action, 'quality_monitoring_run');

          const ovRes = await fetch(`${baseUrl}/api/admin/quality-monitoring/overview?intervalDays=30`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(ovRes.status, 200);
          const ovJson = await ovRes.json();
          assert.equal(ovJson.overview.hasData, true);
          assert.ok(ovJson.overview.latestRun);

          const anomRes = await fetch(`${baseUrl}/api/admin/quality-monitoring/anomalies?intervalDays=30&limit=10`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(anomRes.status, 200);
          const anomJson = await anomRes.json();
          assert.ok(anomJson.items.length >= 2);
          const firstAnom = anomJson.items[0];

          const recExpiredRes = await fetch(
            `${baseUrl}/api/admin/quality-monitoring/records?recordType=expired_offers&intervalDays=30`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
          );
          assert.equal(recExpiredRes.status, 200);
          const recExpiredJson = await recExpiredRes.json();
          assert.ok(recExpiredJson.items.some((r: any) => r.id === 'http-o-exp'));

          // Note: investigare invalidă (<3 chars) -> 400
          const badInvRes = await fetch(
            `${baseUrl}/api/admin/quality-monitoring/anomalies/${encodeURIComponent(firstAnom.id)}/investigate`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ investigationStatus: 'investigated', note: 'ab' })
            }
          );
          assert.equal(badInvRes.status, 400);

          // Investigare validă
          const okInvRes = await fetch(
            `${baseUrl}/api/admin/quality-monitoring/anomalies/${encodeURIComponent(firstAnom.id)}/investigate`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                investigationStatus: 'investigated',
                note: 'Verificat manual în FAZA 5: preț menținut nemodificat pentru audit.',
                decision: 'Păstrat în jurnal',
                anomalyKey: firstAnom.anomalyKey
              })
            }
          );
          assert.equal(okInvRes.status, 200);
          const okInvJson = await okInvRes.json();
          assert.equal(okInvJson.investigation.investigationStatus, 'investigated');
          assert.equal(okInvJson.auditLog.action, 'quality_anomaly_investigated');

          // History check
          const histRes = await fetch(`${baseUrl}/api/admin/quality-monitoring/history?page=1&limit=10`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(histRes.status, 200);
          const histJson = await histRes.json();
          assert.ok(histJson.items.length >= 1);

          // Export CSV & JSON + verificare zero PII
          const csvRes = await fetch(`${baseUrl}/api/admin/quality-monitoring/export?format=csv&intervalDays=30`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(csvRes.status, 200);
          const csvBody = await csvRes.text();
          assert.ok(csvBody.includes('id_anomalie'));
          assert.doesNotMatch(csvBody, /cnp|password|auth\.users/i);

          const jsonExpRes = await fetch(`${baseUrl}/api/admin/quality-monitoring/export?format=json&intervalDays=30`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          assert.equal(jsonExpRes.status, 200);
          const jsonExp = await jsonExpRes.json();
          assert.equal(jsonExp.success, true);
          assert.ok(jsonExp.report.coverage);

          // 27. Rate limit 429 enforcement check
          let hit429 = false;
          for (let i = 0; i < 65; i++) {
            const rlRes = await fetch(`${baseUrl}/api/admin/quality-monitoring/history`, {
              headers: {
                Authorization: `Bearer ${adminToken}`,
                'x-enforce-rate-limit': 'true'
              }
            });
            if (rlRes.status === 429) {
              hit429 = true;
              break;
            }
          }
          assert.equal(hit429, true, 'Rate limiter-ul adminQualityLimiter trebuie să întoarcă 429 la exces');
        } finally {
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
      }
    },
    {
      name: '30. Regresie FAZA 2.1, 2.2, 3.1 și 3.2: serviciile anterioare rămân consistente cu PriceQualityMonitoringService',
      fn: () => {
        const items: ShoppingListItem[] = [
          { id: 'r1', productId: 'f5-lapte', name: 'Lapte 1L', category: 'Lactate și ouă', quantity: 1, unit: 'l', checked: false }
        ];
        const opt = BasketOptimizerService.optimize({
          list: { id: 'reg-f5', name: 'Regresie' },
          items,
          products: BASE_PRODUCTS,
          offers: [
            makeOffer({ id: 'reg-o1', storeId: 'lidl', price: 7.4 }),
            makeOffer({ id: 'reg-o2', storeId: 'kaufland', price: 0 }) // SUSPICIOUS -> exclus
          ],
          stores: STORES,
          options: { maxStores: 1, now: NOW }
        });
        assert.equal(opt.bestSingleStore?.store.id, 'lidl');

        const hist = PriceHistoryService.getProductPriceStats('f5-lapte', {
          observations: [makeObs({ id: 'reg-h1', date: D_1D_AGO, price: 7.4 })],
          stores: STORES,
          now: NOW
        });
        assert.equal(hist.intervalStats[30].observationsCount, 1);

        const singleClass = PriceQualityClassifier.classifyObservation(
          makeObs({ id: 'reg-c1', date: D_1D_AGO, price: 7.4 }),
          { product: BASE_PRODUCTS[0], now: NOW }
        );
        assert.equal(singleClass.status, 'VERIFIED_RECENTLY');
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

  console.log(`\n🎉 Suita FAZA 5 — PRICE QUALITY MONITORING finalizată: ${passed}/${tests.length} blocuri de scenarii verificate!`);
}

runTests();
