// tests/faza31-price-history.test.ts
// Suită completă FAZA 3.1 — Price History (25 cazuri obligatorii)
// Rulează izolat în memorie fără a modifica date reale sau schema Supabase/PostgreSQL.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import {
  formatPriceSourceLabel,
  parseStrictIsoDate,
  PriceHistoryService
} from '../src/services/PriceHistoryService.ts';
import { DatabaseService } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { ProductPriceTrend } from '../src/components/ProductPriceTrend.tsx';
import { supabase } from '../src/lib/supabase.ts';
import type {
  PriceObservation,
  Product,
  ProductOffer,
  Store
} from '../src/types.ts';

let passed = 0;
function pass(label: string) {
  passed++;
  console.log(`  [PASS] ${label}`);
}

const FIXED_NOW = new Date('2026-11-25T12:00:00.000Z');
function daysAgoIso(days: number): string {
  return new Date(FIXED_NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TEST_STORES: Store[] = [
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
    locationsCount: 200,
    sampleAddress: 'România'
  }
];

function makeProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: overrides.name ?? `Produs ${id}`,
    brand: overrides.brand ?? 'BrandTest',
    category: overrides.category ?? 'Lactate și ouă',
    defaultUnit: overrides.defaultUnit ?? 'buc',
    packageWeightOrVolume: overrides.packageWeightOrVolume ?? 1,
    packageUnit: overrides.packageUnit ?? 'buc',
    normalizedUnit: overrides.normalizedUnit ?? 'buc',
    baseReferencePrice: overrides.baseReferencePrice ?? 10,
    canonicalProductId: overrides.canonicalProductId ?? null,
    isRomanianProduct: true
  };
}

function makeOffer(overrides: Partial<ProductOffer>): ProductOffer {
  return {
    id: overrides.id ?? `off-${Math.random().toString(36).slice(2, 8)}`,
    productId: overrides.productId ?? 'prod-root',
    storeId: overrides.storeId ?? 'lidl',
    price: overrides.price ?? 9.99,
    unitPrice: overrides.unitPrice ?? overrides.price ?? 9.99,
    unitPriceMeasure: overrides.unitPriceMeasure ?? 'lei/buc',
    isPromo: overrides.isPromo ?? false,
    observationDate: overrides.observationDate ?? daysAgoIso(0),
    source: overrides.source ?? 'official_feed',
    confidenceLevel: overrides.confidenceLevel ?? 'high',
    verificationStatus: overrides.verificationStatus ?? 'verified',
    lastChecked: overrides.lastChecked ?? FIXED_NOW.toISOString(),
    lastVerifiedAt: overrides.lastVerifiedAt ?? FIXED_NOW.toISOString(),
    currency: overrides.currency ?? 'RON'
  };
}

async function runTests() {
  console.log('====================================================================');
  console.log('FAZA 3.1: TESTE COMPLETE PRICE HISTORY (25 CAZURI)');
  console.log('====================================================================\n');

  StorageService.resetAllData();

  // -------------------------------------------------------------------------
  // 1. Intervale stricte 30 / 90 / 180 / 365 zile
  // -------------------------------------------------------------------------
  {
    const root = makeProduct('p31-1', { name: 'Unt 82% 200g' });
    const observations: PriceObservation[] = [
      { id: 'o-400', productId: 'p31-1', storeId: 'lidl', price: 7.0, date: daysAgoIso(400), source: 'official_feed' },
      { id: 'o-300', productId: 'p31-1', storeId: 'kaufland', price: 8.5, date: daysAgoIso(300), source: 'official_feed' },
      { id: 'o-150', productId: 'p31-1', storeId: 'carrefour', price: 9.2, date: daysAgoIso(150), source: 'verified' },
      { id: 'o-70', productId: 'p31-1', storeId: 'lidl', price: 10.0, date: daysAgoIso(70), source: 'partner_api' },
      { id: 'o-10', productId: 'p31-1', storeId: 'kaufland', price: 9.0, date: daysAgoIso(10), source: 'verified' }
    ];

    const stats = PriceHistoryService.getProductPriceStats('p31-1', {
      observations,
      stores: TEST_STORES,
      aliasMap: [root],
      now: FIXED_NOW
    });

    assert.equal(stats.observationsCount, 5);
    assert.equal(stats.intervalStats[30].observationsCount, 1);
    assert.equal(stats.intervalStats[30].minPrice, 9.0);
    assert.equal(stats.intervalStats[30].hasSufficientHistory, false);

    assert.equal(stats.intervalStats[90].observationsCount, 2);
    assert.equal(stats.intervalStats[90].minPrice, 9.0);
    assert.equal(stats.intervalStats[90].avgPrice, 9.5);
    assert.equal(stats.intervalStats[90].hasSufficientHistory, true);

    assert.equal(stats.intervalStats[180].observationsCount, 3);
    assert.equal(stats.intervalStats[180].minPrice, 9.0);

    assert.equal(stats.intervalStats[365].observationsCount, 4);
    assert.equal(stats.intervalStats[365].minPrice, 8.5);
    assert.equal(stats.intervalStats[365].minPriceStoreName, 'Kaufland');
    assert.equal(stats.intervalStats[365].lastObservation?.price, 9.0);
    assert.equal(stats.intervalStats[365].lastObservation?.date, daysAgoIso(10));
    pass('1. Intervale stricte 30 / 90 / 180 / 365 zile cu min/avg/last reale');
  }

  // -------------------------------------------------------------------------
  // 2. 0 observații -> stare explicită fără date inventate
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-empty');
    const stats = PriceHistoryService.getProductPriceStats('p31-empty', {
      observations: [],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    assert.equal(stats.observationsCount, 0);
    assert.equal(stats.minRecordedPrice, null);
    assert.equal(stats.averagePrice, null);
    assert.equal(stats.hasSufficientHistory, false);
    assert.equal(stats.historyPoints.length, 0);
    assert.equal(stats.intervalStats[90].minPrice, null);
    assert.match(stats.intervalStats[90].noticeRo || '', /Nu există observații istorice/);
    pass('2. 0 observații -> valori null și mesaj explicit fără puncte inventate');
  }

  // -------------------------------------------------------------------------
  // 3. 1 singură observație -> stare explicită insuficientă
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-one');
    const stats = PriceHistoryService.getProductPriceStats('p31-one', {
      observations: [
        { id: 'o-1', productId: 'p31-one', storeId: 'lidl', price: 12.45, date: daysAgoIso(5), source: 'verified' }
      ],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    assert.equal(stats.observationsCount, 1);
    assert.equal(stats.distinctDaysCount, 1);
    assert.equal(stats.hasSufficientHistory, false);
    assert.equal(stats.intervalStats[30].minPrice, 12.45);
    assert.equal(stats.intervalStats[30].hasSufficientHistory, false);
    assert.match(stats.intervalStats[30].noticeRo || '', /singură observație/i);
    pass('3. 1 singură observație -> afișare exactă + semnalare date insuficiente');
  }

  // -------------------------------------------------------------------------
  // 4. Observații multiple într-o singură zi
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-sameday');
    const sameDate = daysAgoIso(3);
    const stats = PriceHistoryService.getProductPriceStats('p31-sameday', {
      observations: [
        { id: 'sd-1', productId: 'p31-sameday', storeId: 'lidl', price: 6.2, date: sameDate, source: 'official_feed' },
        { id: 'sd-2', productId: 'p31-sameday', storeId: 'kaufland', price: 6.8, date: sameDate, source: 'verified' }
      ],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    assert.equal(stats.observationsCount, 2);
    assert.equal(stats.distinctDaysCount, 1);
    assert.equal(stats.hasSufficientHistory, false);
    assert.equal(stats.trendPercentage, 0);
    assert.equal(stats.intervalStats[30].storeBreakdown?.length, 2);
    assert.match(stats.intervalStats[30].noticeRo || '', /o singură zi/i);
    pass('4. Observații multiple în aceeași zi -> distinctDaysCount=1, fără tendință falsă');
  }

  // -------------------------------------------------------------------------
  // 5. Gap-uri mari între observații -> zero interpolare în componentă
  // -------------------------------------------------------------------------
  {
    const gapObs: PriceObservation[] = [
      { id: 'g-1', productId: 'p31-gap', storeId: 'lidl', price: 10.0, date: daysAgoIso(80), source: 'official_feed' },
      { id: 'g-2', productId: 'p31-gap', storeId: 'lidl', price: 11.5, date: daysAgoIso(10), source: 'official_feed' },
      { id: 'g-3', productId: 'p31-gap', storeId: 'kaufland', price: 9.8, date: daysAgoIso(45), source: 'verified' }
    ];
    const prod = makeProduct('p31-gap');
    const stats = PriceHistoryService.getProductPriceStats('p31-gap', {
      observations: gapObs,
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    // Nu trebuie fabricate puncte pentru zilele lipsă dintre -80, -45 și -10
    assert.equal(stats.historyPoints.length, 3);
    assert.equal(stats.distinctDaysCount, 3);
    const componentSource = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ProductPriceTrend.tsx'),
      'utf8'
    );
    assert.ok(componentSource.includes('connectNulls={false}'), 'Graficul trebuie să folosească connectNulls={false}');
    pass('5. Gap-uri mari (60-70 zile lipsă) -> fără puncte sintetice și fără connectNulls');
  }

  // -------------------------------------------------------------------------
  // 6. Aliasuri canonice multi-hop + păstrare proveniență originalProductId
  // -------------------------------------------------------------------------
  {
    const root = makeProduct('p31-root', { name: 'Cafea Boabe 1kg' });
    const alias1 = makeProduct('p31-a1', { canonicalProductId: 'p31-root' });
    const alias2 = makeProduct('p31-a2', { canonicalProductId: 'p31-a1' });

    const stats = PriceHistoryService.getProductPriceStats('p31-a2', {
      observations: [
        { id: 'o-r', productId: 'p31-root', storeId: 'lidl', price: 54.9, date: daysAgoIso(20), source: 'official_feed' },
        { id: 'o-a1', productId: 'p31-a1', storeId: 'kaufland', price: 49.9, date: daysAgoIso(12), source: 'verified' },
        { id: 'o-a2', productId: 'p31-a2', storeId: 'carrefour', price: 52.0, date: daysAgoIso(4), source: 'partner_api' }
      ],
      stores: TEST_STORES,
      aliasMap: [root, alias1, alias2],
      now: FIXED_NOW
    });

    assert.equal(stats.productId, 'p31-root');
    assert.equal(stats.observationsCount, 3);
    const ptRoot = stats.historyPoints.find(p => p.storeId === 'lidl');
    const ptAlias1 = stats.historyPoints.find(p => p.storeId === 'kaufland');
    const ptAlias2 = stats.historyPoints.find(p => p.storeId === 'carrefour');
    assert.equal(ptRoot?.originalProductId, undefined);
    assert.equal(ptAlias1?.originalProductId, 'p31-a1');
    assert.equal(ptAlias2?.originalProductId, 'p31-a2');
    pass('6. Aliasuri multi-hop agregate pe root cu păstrarea originalProductId');
  }

  // -------------------------------------------------------------------------
  // 7. Cicluri, self-reference, lanț > 16 și alias orfan -> fail-closed
  // -------------------------------------------------------------------------
  {
    const cycA = makeProduct('p31-cyc-a', { canonicalProductId: 'p31-cyc-b' });
    const cycB = makeProduct('p31-cyc-b', { canonicalProductId: 'p31-cyc-a' });
    const selfRef = makeProduct('p31-self', { canonicalProductId: 'p31-self' });
    const orphan = makeProduct('p31-orphan', { canonicalProductId: 'p31-missing-root' });
    const deepNodes: Product[] = [];
    for (let i = 0; i <= 18; i++) {
      deepNodes.push(
        makeProduct(`p31-deep-${i}`, {
          canonicalProductId: i < 18 ? `p31-deep-${i + 1}` : 'p31-valid-root'
        })
      );
    }
    const validRoot = makeProduct('p31-valid-root');
    const graph = [cycA, cycB, selfRef, orphan, validRoot, ...deepNodes];

    const badObs: PriceObservation[] = [
      { id: 'bo-1', productId: 'p31-cyc-a', storeId: 'lidl', price: 1.5, date: daysAgoIso(5), source: 'official_feed' },
      { id: 'bo-2', productId: 'p31-self', storeId: 'lidl', price: 1.5, date: daysAgoIso(5), source: 'official_feed' },
      { id: 'bo-3', productId: 'p31-orphan', storeId: 'lidl', price: 1.5, date: daysAgoIso(5), source: 'official_feed' },
      { id: 'bo-4', productId: 'p31-deep-0', storeId: 'lidl', price: 1.5, date: daysAgoIso(5), source: 'official_feed' }
    ];

    for (const badId of ['p31-cyc-a', 'p31-self', 'p31-orphan', 'p31-deep-0']) {
      const res = PriceHistoryService.getProductPriceStats(badId, {
        observations: badObs,
        stores: TEST_STORES,
        aliasMap: graph,
        now: FIXED_NOW
      });
      assert.equal(res.rejectedInvalidIdentity, true, `${badId} trebuie respins`);
      assert.equal(res.observationsCount, 0);
      assert.equal(res.historyPoints.length, 0);
    }
    pass('7. Ciclu, self-reference, alias orfan și lanț > 16 respinse fail-closed');
  }

  // -------------------------------------------------------------------------
  // 8. Produse distincte cu nume similar NU se combină
  // -------------------------------------------------------------------------
  {
    const p1 = makeProduct('p31-lapte-15', { name: 'Lapte Zuzu 1.5% 1L' });
    const p2 = makeProduct('p31-lapte-35', { name: 'Lapte Zuzu 3.5% 1L' });

    const stats = PriceHistoryService.getProductPriceStats('p31-lapte-15', {
      observations: [
        { id: 'l15', productId: 'p31-lapte-15', storeId: 'lidl', price: 6.5, date: daysAgoIso(10), source: 'official_feed' },
        { id: 'l35', productId: 'p31-lapte-35', storeId: 'lidl', price: 8.9, date: daysAgoIso(5), source: 'official_feed' }
      ],
      stores: TEST_STORES,
      aliasMap: [p1, p2],
      now: FIXED_NOW
    });

    assert.equal(stats.observationsCount, 1);
    assert.equal(stats.minRecordedPrice, 6.5);
    pass('8. Produse distincte cu nume similar rămân complet separate');
  }

  // -------------------------------------------------------------------------
  // 9. Comparație istorică per magazin (storeBreakdown)
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-stores');
    const stats = PriceHistoryService.getProductPriceStats('p31-stores', {
      observations: [
        { id: 's1', productId: 'p31-stores', storeId: 'lidl', price: 10.0, date: daysAgoIso(20), source: 'official_feed' },
        { id: 's2', productId: 'p31-stores', storeId: 'lidl', price: 11.0, date: daysAgoIso(5), source: 'official_feed' },
        { id: 's3', productId: 'p31-stores', storeId: 'kaufland', price: 9.0, date: daysAgoIso(15), source: 'verified' },
        { id: 's4', productId: 'p31-stores', storeId: 'carrefour', price: 12.5, date: daysAgoIso(8), source: 'partner_api' }
      ],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });

    const bd = stats.intervalStats[30].storeBreakdown || [];
    assert.equal(bd.length, 3);
    assert.equal(bd[0].storeName, 'Kaufland');
    assert.equal(bd[0].minPrice, 9.0);
    assert.equal(bd[1].storeName, 'Lidl');
    assert.equal(bd[1].avgPrice, 10.5);
    assert.equal(bd[1].lastPrice, 11.0);
    assert.equal(bd[2].storeName, 'Carrefour');
    pass('9. Comparație multi-magazin în storeBreakdown (min, avg, last, date)');
  }

  // -------------------------------------------------------------------------
  // 10. Surse mixte + excludere demo/estimated
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-sources');
    const stats = PriceHistoryService.getProductPriceStats('p31-sources', {
      observations: [
        { id: 'm1', productId: 'p31-sources', storeId: 'lidl', price: 7.5, date: daysAgoIso(14), source: 'official_feed' },
        { id: 'm2', productId: 'p31-sources', storeId: 'lidl', price: 7.2, date: daysAgoIso(6), source: 'verified' },
        { id: 'm3', productId: 'p31-sources', storeId: 'lidl', price: 1.0, date: daysAgoIso(2), source: 'demo' },
        { id: 'm4', productId: 'p31-sources', storeId: 'lidl', price: 1.2, date: daysAgoIso(1), source: 'estimated' }
      ],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });

    assert.equal(stats.observationsCount, 2);
    const lidlBd = stats.intervalStats[30].storeBreakdown?.[0];
    assert.ok(lidlBd);
    assert.equal(lidlBd.hasMixedSources, true);
    assert.deepEqual(new Set(lidlBd.sources), new Set(['Catalog / feed oficial', 'Bon fiscal confirmat']));
    assert.equal(formatPriceSourceLabel('partner_api'), 'API partener');
    assert.equal(formatPriceSourceLabel('user_reported'), 'Raportat de utilizator');
    pass('10. Surse mixte semnalate transparent; demo și estimated excluse');
  }

  // -------------------------------------------------------------------------
  // 11. Prețuri invalide (0, negativ, NaN, Infinity)
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-badprice');
    const stats = PriceHistoryService.getProductPriceStats('p31-badprice', {
      observations: [
        { id: 'bp-0', productId: 'p31-badprice', storeId: 'lidl', price: 0, date: daysAgoIso(5), source: 'official_feed' },
        { id: 'bp-neg', productId: 'p31-badprice', storeId: 'lidl', price: -4.5, date: daysAgoIso(4), source: 'official_feed' },
        { id: 'bp-nan', productId: 'p31-badprice', storeId: 'lidl', price: Number.NaN, date: daysAgoIso(3), source: 'official_feed' },
        { id: 'bp-inf', productId: 'p31-badprice', storeId: 'lidl', price: Number.POSITIVE_INFINITY, date: daysAgoIso(2), source: 'official_feed' },
        { id: 'bp-ok', productId: 'p31-badprice', storeId: 'lidl', price: 5.5, date: daysAgoIso(1), source: 'official_feed' }
      ],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    assert.equal(stats.observationsCount, 1);
    assert.equal(stats.minRecordedPrice, 5.5);
    assert.equal(stats.invalidObservationsCount, 4);
    pass('11. Prețuri zero / negative / NaN / Infinity respinse fără coruperea mediei');
  }

  // -------------------------------------------------------------------------
  // 12. Timestamp-uri malformate / imposibile calendaristic / viitor
  // -------------------------------------------------------------------------
  {
    assert.equal(parseStrictIsoDate('2026-02-30'), null);
    assert.equal(parseStrictIsoDate('2026-13-01'), null);
    assert.equal(parseStrictIsoDate('not-a-date'), null);
    assert.equal(parseStrictIsoDate(''), null);
    assert.ok(parseStrictIsoDate('2026-11-20T10:30:00Z'));

    const prod = makeProduct('p31-baddate');
    const futureDate = new Date(FIXED_NOW.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const stats = PriceHistoryService.getProductPriceStats('p31-baddate', {
      observations: [
        { id: 'bd-1', productId: 'p31-baddate', storeId: 'lidl', price: 4.0, date: '2026-02-30', source: 'official_feed' },
        { id: 'bd-2', productId: 'p31-baddate', storeId: 'lidl', price: 4.0, date: 'invalid-date', source: 'official_feed' },
        { id: 'bd-3', productId: 'p31-baddate', storeId: 'lidl', price: 4.0, date: futureDate, source: 'official_feed' },
        { id: 'bd-ok', productId: 'p31-baddate', storeId: 'lidl', price: 8.2, date: daysAgoIso(4), source: 'official_feed' }
      ],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    assert.equal(stats.observationsCount, 1);
    assert.equal(stats.invalidObservationsCount, 3);
    pass('12. Timestamp-uri invalide / 2026-02-30 / viitor respinse strict');
  }

  // -------------------------------------------------------------------------
  // 13. Separare strictă monedă: RON vs EUR / USD
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-curr');
    const stats = PriceHistoryService.getProductPriceStats('p31-curr', {
      observations: [
        { id: 'c-ron1', productId: 'p31-curr', storeId: 'lidl', price: 15.0, currency: 'RON', date: daysAgoIso(10), source: 'official_feed' },
        { id: 'c-ron2', productId: 'p31-curr', storeId: 'kaufland', price: 17.0, date: daysAgoIso(2), source: 'verified' },
        { id: 'c-eur', productId: 'p31-curr', storeId: 'carrefour', price: 3.1, currency: 'EUR', date: daysAgoIso(5), source: 'partner_api' },
        { id: 'c-usd', productId: 'p31-curr', storeId: 'lidl', price: 3.4, currency: 'USD', date: daysAgoIso(3), source: 'partner_api' }
      ],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });

    assert.equal(stats.observationsCount, 2);
    assert.equal(stats.excludedForeignCurrencyCount, 2);
    assert.equal(stats.minRecordedPrice, 15.0);
    assert.equal(stats.averagePrice, 16.0);
    assert.match(stats.intervalStats[30].noticeRo || '', /monedă diferită de RON/i);
    pass('13. Separare strictă monedă: EUR/USD excluse din statistici RON');
  }

  // -------------------------------------------------------------------------
  // 14. Ofertele active NU intră în istoricul de preț & fără predicții viitoare
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-no-offers-in-history');
    const stats = PriceHistoryService.getProductPriceStats('p31-no-offers-in-history', {
      observations: [],
      offers: [makeOffer({ id: 'active-off-1', productId: 'p31-no-offers-in-history', price: 4.99, storeId: 'lidl' })],
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });

    assert.equal(stats.currentLowestPrice, 4.99);
    assert.equal(stats.observationsCount, 0);
    assert.equal(stats.historyPoints.length, 0);
    assert.equal(stats.intervalStats[30].minPrice, null);
    const trendSource = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ProductPriceTrend.tsx'),
      'utf8'
    );
    assert.ok(!trendSource.includes('computePriceTrendForecast'), 'ProductPriceTrend nu mai apelează forecast');
    assert.ok(!trendSource.includes('Arată proiecție'), 'ProductPriceTrend nu mai are UI de proiecție');
    pass('14. Ofertele active nu fabrică observații istorice și nu există predicții viitoare');
  }

  // -------------------------------------------------------------------------
  // 15. Izolare strictă user_price_observations vs public price_observations
  // -------------------------------------------------------------------------
  {
    const { app } = await import('../server.ts');
    const srv = http.createServer(app);
    await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const rUnauth = await fetch(`${baseUrl}/api/receipts/personal-history`);
      assert.equal(rUnauth.status, 401, 'Istoricul personal privat cere autentificare');
      const schemaSql010 = fs.readFileSync(
        path.join(process.cwd(), 'src/db/migrations/010_receipt_scanner_v2.sql'),
        'utf8'
      );
      assert.match(schemaSql010, /ENABLE ROW LEVEL SECURITY/i);
      assert.match(schemaSql010, /user_price_observations_owner_all/i);
    } finally {
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }
    pass('15. user_price_observations este izolat cu 401 și RLS per user_id');
  }

  // -------------------------------------------------------------------------
  // 16 & 17 & 18. Endpoint-uri HTTP /api/catalog/history/:id și /api/products/:id
  // -------------------------------------------------------------------------
  {
    const root = makeProduct('p31-http-root', { name: 'Făină Grâu 000 1kg' });
    const alias = makeProduct('p31-http-alias', { canonicalProductId: 'p31-http-root' });
    const cyc = makeProduct('p31-http-cyc', { canonicalProductId: 'p31-http-cyc' });
    const fixtureProducts = [root, alias, cyc];
    const fixtureObs: PriceObservation[] = [
      { id: 'h-1', productId: 'p31-http-root', storeId: 'lidl', price: 4.5, date: daysAgoIso(25), source: 'official_feed' },
      { id: 'h-2', productId: 'p31-http-alias', storeId: 'kaufland', price: 3.9, date: daysAgoIso(12), source: 'verified' },
      { id: 'h-3', productId: 'p31-http-root', storeId: 'lidl', price: 4.2, date: daysAgoIso(4), source: 'partner_api' },
      { id: 'h-eur', productId: 'p31-http-root', storeId: 'lidl', price: 0.9, currency: 'EUR', date: daysAgoIso(3), source: 'partner_api' },
      { id: 'h-demo', productId: 'p31-http-root', storeId: 'lidl', price: 0.5, date: daysAgoIso(2), source: 'demo' }
    ];
    const fixtureOffers: ProductOffer[] = [
      makeOffer({ id: 'off-http', productId: 'p31-http-root', storeId: 'kaufland', price: 3.89 })
    ];

    const origGetAliasIdx = DatabaseService.getProductAliasIndex;
    const origGetPriceObsDb = DatabaseService.getPriceObservations;
    const origGetOffersDb = DatabaseService.getOffers;
    const origGetStoresDb = DatabaseService.getStores;
    const origGetAllProducts = StorageService.getAllProducts;
    const origGetObs = StorageService.getPriceObservations;
    const origGetOffers = StorageService.getProductOffers;

    try {
      const { buildCanonicalAliasIndex } = await import('../src/services/ProductIdentityService.ts');
      const idx = buildCanonicalAliasIndex(fixtureProducts);
      DatabaseService.getProductAliasIndex = async () => idx;
      DatabaseService.getPriceObservations = async () => fixtureObs;
      DatabaseService.getOffers = async () => fixtureOffers;
      DatabaseService.getStores = async () => TEST_STORES;
      StorageService.getAllProducts = () => fixtureProducts;
      StorageService.getPriceObservations = () => fixtureObs;
      StorageService.getProductOffers = () => fixtureOffers;

      const { app } = await import('../server.ts');
      const srv = http.createServer(app);
      await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
      const port = (srv.address() as any).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 16. Paginare + storeId + storeBreakdown
        const rAll = await fetch(`${baseUrl}/api/catalog/history/p31-http-alias?days=30&limit=2&offset=0`);
        assert.equal(rAll.status, 200);
        const jAll = await rAll.json();
        assert.equal(jAll.productId, 'p31-http-root');
        assert.equal(jAll.currency, 'RON');
        assert.equal(jAll.totalInIntervalCount, 3);
        assert.equal(jAll.excludedForeignCurrencyCount, 1);
        assert.equal(jAll.count, 2);
        assert.equal(jAll.pagination.hasMore, true);
        assert.equal(jAll.storeBreakdown.length, 2);

        const rStore = await fetch(`${baseUrl}/api/catalog/history/p31-http-root?days=30&storeId=kaufland`);
        assert.equal(rStore.status, 200);
        const jStore = await rStore.json();
        assert.equal(jStore.count, 1);
        assert.equal(jStore.observations[0].originalProductId, 'p31-http-alias');
        pass('16. GET /api/catalog/history/:id cu paginare, storeId, storeBreakdown și originalProductId');

        // 17. Validări stricte parametri și coduri eroare
        const rBadDays = await fetch(`${baseUrl}/api/catalog/history/p31-http-root?days=45`);
        assert.equal(rBadDays.status, 400);
        const rBadLimit = await fetch(`${baseUrl}/api/catalog/history/p31-http-root?days=30&limit=-5`);
        assert.equal(rBadLimit.status, 400);
        const rTooLongId = await fetch(`${baseUrl}/api/catalog/history/${'a'.repeat(70)}?days=30`);
        assert.equal(rTooLongId.status, 400);
        const rCyc = await fetch(`${baseUrl}/api/catalog/history/p31-http-cyc?days=30`);
        assert.equal(rCyc.status, 400);
        const rMissing = await fetch(`${baseUrl}/api/catalog/history/p31-nope?days=30`);
        assert.equal(rMissing.status, 404);
        pass('17. GET /api/catalog/history/:id respinge zile/limit/ID invalide (400) și absente (404)');

        // 18. GET /api/products/:id sortare descrescătoare și izolare EUR/demo
        const rProd = await fetch(`${baseUrl}/api/products/p31-http-alias`);
        assert.equal(rProd.status, 200);
        const jProd = await rProd.json();
        assert.equal(jProd.canonicalProductId, 'p31-http-root');
        assert.equal(jProd.redirectedFromAlias, true);
        assert.equal(jProd.observations.length, 3);
        assert.ok(jProd.observations[0].date >= jProd.observations[1].date);
        assert.ok(jProd.observations.every((o: any) => o.currency === 'RON' && o.source !== 'demo'));
        pass('18. GET /api/products/:id întoarce jurnal sortat descrescător fără EUR/demo');
      } finally {
        await new Promise<void>(resolve => srv.close(() => resolve()));
      }
    } finally {
      DatabaseService.getProductAliasIndex = origGetAliasIdx;
      DatabaseService.getPriceObservations = origGetPriceObsDb;
      DatabaseService.getOffers = origGetOffersDb;
      DatabaseService.getStores = origGetStoresDb;
      StorageService.getAllProducts = origGetAllProducts;
      StorageService.getPriceObservations = origGetObs;
      StorageService.getProductOffers = origGetOffers;
    }
  }

  // -------------------------------------------------------------------------
  // 19 & 20. DatabaseService.getPriceObservations paginare >1.000 înregistrări (Supabase mock)
  // -------------------------------------------------------------------------
  {
    const origFrom = supabase.from;
    const totalMockRows = 1250;
    const mockProducts = [
      { id: 'db-root', canonical_product_id: null },
      { id: 'db-alias', canonical_product_id: 'db-root' }
    ];
    const mockObsRows = Array.from({ length: totalMockRows }, (_, i) => ({
      id: `obs-${i}`,
      product_id: i % 3 === 0 ? 'db-alias' : 'db-root',
      store_id: i % 2 === 0 ? 'lidl' : 'kaufland',
      price: (10 + (i % 50) * 0.1).toFixed(2),
      date: daysAgoIso(i % 180),
      source: 'official_feed',
      loyalty_card_used: false
    }));

    try {
      (supabase as any).from = (table: string) => {
        let rangeFrom = 0;
        let rangeTo = 999;
        const builder: any = {
          select: () => builder,
          in: () => builder,
          gte: () => builder,
          order: () => builder,
          limit: () => builder,
          range: (from: number, to: number) => {
            rangeFrom = from;
            rangeTo = to;
            return builder;
          },
          then: (resolve: (val: any) => void) => {
            if (table === 'products') {
              resolve({ data: mockProducts.slice(rangeFrom, rangeTo + 1), error: null });
            } else {
              resolve({ data: mockObsRows.slice(rangeFrom, rangeTo + 1), error: null });
            }
          }
        };
        return builder;
      };

      const rows = await DatabaseService.getPriceObservations('db-alias', { days: 365, limit: 2000 });
      assert.equal(rows.length, 1250, 'Paginarea Supabase trebuie să depășească limita PostgREST de 1000 rânduri');
      assert.ok(rows.every(r => r.productId === 'db-root'));
      assert.ok(rows.some(r => r.originalProductId === 'db-alias'));
      pass('19. DatabaseService.getPriceObservations paginează corect peste 1.000 înregistrări');

      // 20. Eroare Supabase -> fail-safe întoarce [] fără excepție necontrolată
      (supabase as any).from = () => ({
        select: () => ({
          range: async () => ({ data: null, error: { message: 'Simulated DB outage' } })
        })
      });
      const errRows = await DatabaseService.getPriceObservations('db-root');
      assert.deepEqual(errRows, []);
      pass('20. DatabaseService.getPriceObservations gestionează sigur erorile de interogare');
    } finally {
      (supabase as any).from = origFrom;
    }
  }

  // -------------------------------------------------------------------------
  // 21. Performanță la volum mare (10.500 observații)
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-perf');
    const bigObs: PriceObservation[] = Array.from({ length: 10500 }, (_, i) => ({
      id: `perf-${i}`,
      productId: 'p31-perf',
      storeId: TEST_STORES[i % 3].id,
      price: 5 + (i % 100) * 0.05,
      date: daysAgoIso(i % 360),
      source: i % 2 === 0 ? 'official_feed' : 'verified'
    }));

    const t0 = performance.now();
    const stats = PriceHistoryService.getProductPriceStats('p31-perf', {
      observations: bigObs,
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    const elapsedMs = performance.now() - t0;

    assert.equal(stats.observationsCount, 10500);
    assert.ok(elapsedMs < 500, `Procesarea a 10.500 observații a durat ${elapsedMs.toFixed(1)}ms (>500ms)`);
    pass(`21. Performanță 10.500 observații în ${elapsedMs.toFixed(1)}ms (<500ms)`);
  }

  // -------------------------------------------------------------------------
  // 22 & 23. Randare UI ProductPriceTrend (cu date reale și cu 0/1 observație)
  // -------------------------------------------------------------------------
  {
    const multiStoreObs: PriceObservation[] = [
      { id: 'ui-1', productId: 'p31-ui', storeId: 'lidl', price: 8.5, date: daysAgoIso(20), source: 'official_feed' },
      { id: 'ui-2', productId: 'p31-ui', storeId: 'lidl', price: 8.2, date: daysAgoIso(5), source: 'verified' },
      { id: 'ui-3', productId: 'p31-ui', storeId: 'kaufland', price: 9.0, date: daysAgoIso(12), source: 'partner_api' }
    ];

    const htmlMulti = renderToStaticMarkup(
      React.createElement(ProductPriceTrend, {
        productId: 'p31-ui',
        productName: 'Brânză de vaci 500g',
        observations: multiStoreObs,
        stores: TEST_STORES
      })
    );

    assert.match(htmlMulti, /30 zile/);
    assert.match(htmlMulti, /90 zile/);
    assert.match(htmlMulti, /180 zile/);
    assert.match(htmlMulti, /1 an/);
    assert.match(htmlMulti, /Comparație istorică între magazine/);
    assert.match(htmlMulti, /Lidl/);
    assert.match(htmlMulti, /Kaufland/);
    assert.match(htmlMulti, /nu garantează disponibilitatea actuală la raft/i);
    assert.ok(!htmlMulti.includes('Arată proiecție'), 'Fără buton de proiecție');
    assert.ok(!htmlMulti.includes('Estimare statistică'), 'Fără estimări statistice');
    pass('22. UI ProductPriceTrend randează comparația multi-magazin în RON fără proiecții');

    const htmlEmpty = renderToStaticMarkup(
      React.createElement(ProductPriceTrend, {
        productId: 'p31-empty',
        productName: 'Produs fără date',
        observations: [],
        stores: TEST_STORES
      })
    );
    assert.match(htmlEmpty, /Istoric insuficient/);
    assert.match(htmlEmpty, /Indisponibil/);

    const htmlSingle = renderToStaticMarkup(
      React.createElement(ProductPriceTrend, {
        productId: 'p31-one',
        productName: 'Produs cu 1 observație',
        observations: [
          { id: 's-1', productId: 'p31-one', storeId: 'lidl', price: 14.9, date: daysAgoIso(4), source: 'verified' }
        ],
        stores: TEST_STORES
      })
    );
    assert.match(htmlSingle, /14\.90 lei/);
    assert.match(htmlSingle, /singură observație/i);
    pass('23. UI ProductPriceTrend randează onest stările cu 0 și 1 observație');
  }

  // -------------------------------------------------------------------------
  // 24. Protecție append-only SQL și integritate sursă
  // -------------------------------------------------------------------------
  {
    const schemaSql = fs.readFileSync(
      path.join(process.cwd(), 'src/db/schema.sql'),
      'utf8'
    );
    const mig002 = fs.readFileSync(
      path.join(process.cwd(), 'src/db/migrations/002_indexing_engine.sql'),
      'utf8'
    );
    assert.match(schemaSql, /trg_protect_price_observations/i);
    assert.match(schemaSql, /BEFORE UPDATE OR DELETE ON price_observations/i);
    assert.match(mig002, /trg_protect_price_observations/i);
    pass('24. Trigger-ul append-only trg_protect_price_observations este intact');
  }

  // -------------------------------------------------------------------------
  // 25. Determinism complet pe recalculări repetate
  // -------------------------------------------------------------------------
  {
    const prod = makeProduct('p31-det');
    const obs: PriceObservation[] = [
      { id: 'd-2', productId: 'p31-det', storeId: 'kaufland', price: 12.0, date: daysAgoIso(30), source: 'verified' },
      { id: 'd-1', productId: 'p31-det', storeId: 'lidl', price: 11.2, date: daysAgoIso(10), source: 'official_feed' },
      { id: 'd-3', productId: 'p31-det', storeId: 'lidl', price: 11.8, date: daysAgoIso(2), source: 'partner_api' }
    ];
    const runA = PriceHistoryService.getProductPriceStats('p31-det', {
      observations: obs,
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    const runB = PriceHistoryService.getProductPriceStats('p31-det', {
      observations: [...obs].reverse(),
      stores: TEST_STORES,
      aliasMap: [prod],
      now: FIXED_NOW
    });
    assert.deepEqual(runA, runB);
    pass('25. Determinism complet indiferent de ordinea intrărilor');
  }

  console.log('\n====================================================================');
  console.log(`FAZA 3.1 TESTE FINALIZATE: ${passed} / 25 PASSED`);
  console.log('====================================================================');
}

runTests().catch(err => {
  console.error('❌ EROARE TEST FAZA 3.1:', err);
  process.exit(1);
});
