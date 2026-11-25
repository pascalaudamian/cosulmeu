// tests/faza32-price-quality.test.ts
// Suită completă FAZA 3.2 — Price History Data Quality & Validation (30 scenarii obligatorii)
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
  DEFAULT_PRICE_QUALITY_CONFIG,
  PriceQualityClassifier
} from '../src/services/PriceQualityClassifier.ts';
import { PriceHistoryService } from '../src/services/PriceHistoryService.ts';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { DatabaseService } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { ProductPriceTrend } from '../src/components/ProductPriceTrend.tsx';
import { STORES } from '../src/data/mockData.ts';
import type {
  PriceObservation,
  PriceObservationQualityInput,
  Product,
  ProductOffer
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
function daysAheadIso(days: number): string {
  return new Date(FIXED_NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const MILK_PRODUCT: Product = {
  id: 'p32-lapte-1l',
  name: 'Lapte UHT 1.5% 1L',
  brand: 'BrandTest',
  category: 'Lactate și ouă',
  defaultUnit: 'l',
  packageWeightOrVolume: 1,
  packageUnit: 'l',
  normalizedUnit: 'l',
  baseReferencePrice: 7.0,
  canonicalProductId: null,
  isRomanianProduct: true
};

const BUTTER_PRODUCT: Product = {
  id: 'p32-unt-200g',
  name: 'Unt 82% 200g',
  brand: 'BrandTest',
  category: 'Lactate și ouă',
  defaultUnit: 'buc',
  packageWeightOrVolume: 200,
  packageUnit: 'g',
  normalizedUnit: 'kg',
  baseReferencePrice: 12.0,
  canonicalProductId: null,
  isRomanianProduct: true
};

function makeObs(overrides: Partial<PriceObservationQualityInput> = {}): PriceObservation {
  return {
    id: overrides.id ?? `obs-${Math.random().toString(36).slice(2, 8)}`,
    productId: overrides.productId ?? MILK_PRODUCT.id,
    storeId: overrides.storeId ?? 'lidl',
    price: overrides.price ?? 7.0,
    currency: overrides.currency ?? 'RON',
    date: overrides.date ?? daysAgoIso(2),
    source: (overrides.source ?? 'official_feed') as PriceObservation['source'],
    ...(overrides as Partial<PriceObservation>)
  };
}

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: overrides.id ?? `off-${Math.random().toString(36).slice(2, 8)}`,
    productId: overrides.productId ?? MILK_PRODUCT.id,
    storeId: overrides.storeId ?? 'lidl',
    price: overrides.price ?? 7.0,
    currency: overrides.currency ?? 'RON',
    unitPrice: overrides.unitPrice ?? overrides.price ?? 7.0,
    unitPriceMeasure: overrides.unitPriceMeasure ?? 'lei/l',
    isPromo: overrides.isPromo ?? false,
    observationDate: overrides.observationDate ?? daysAgoIso(0),
    source: overrides.source ?? 'official_feed',
    confidenceLevel: overrides.confidenceLevel ?? 'high',
    verificationStatus: overrides.verificationStatus ?? 'verified',
    lastChecked: overrides.lastChecked ?? FIXED_NOW.toISOString(),
    lastVerifiedAt: overrides.lastVerifiedAt ?? FIXED_NOW.toISOString(),
    ...overrides
  };
}

async function runTests() {
  console.log('====================================================================');
  console.log('FAZA 3.2: PRICE HISTORY DATA QUALITY & VALIDATION (30 SCENARII)');
  console.log('====================================================================\n');

  PriceQualityClassifier.resetConfig();
  StorageService.resetAllData();

  // 1. VERIFIED_RECENTLY (observație recentă <= 7 zile din sursă acreditată)
  {
    const res = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c1', date: daysAgoIso(3), source: 'official_feed', price: 6.9 }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(res.status, 'VERIFIED_RECENTLY');
    assert.equal(res.isUsableForComparison, true);
    assert.equal(res.isReliableForOptimization, true);
    assert.ok(res.reasons.some(r => /recentă|7 zile/i.test(r)));
    pass('1. Observație ≤ 7 zile din sursă acreditată -> VERIFIED_RECENTLY');
  }

  // 2. VERIFIED (observație între 8 și 30 zile din sursă verificată)
  {
    const res = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c2', date: daysAgoIso(18), source: 'verified', price: 7.1 }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(res.status, 'VERIFIED');
    assert.equal(res.isUsableForComparison, true);
    assert.equal(res.isReliableForOptimization, true);
    pass('2. Observație 8–30 zile din bon/feed confirmat -> VERIFIED');
  }

  // 3. STALE (observație > 30 zile -> STALE, niciodată EXPIRED doar din vechime)
  {
    for (const oldDays of [35, 120, 250]) {
      const res = PriceQualityClassifier.classifyObservation(
        makeObs({ id: `c3-${oldDays}`, date: daysAgoIso(oldDays), source: 'official_feed', price: 6.8 }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      assert.equal(res.status, 'STALE');
      assert.notEqual(res.status, 'EXPIRED', 'Observația istorică nu devine EXPIRED din vechime');
      assert.ok(res.reasons.some(r => /mai vechi de 30 de zile/i.test(r)));
    }
    pass('3. Observații > 30 zile (35/120/250 zile) -> STALE, niciodată EXPIRED');
  }

  // 4. Lipsă sursă -> UNVERIFIED
  {
    for (const emptySource of ['', 'unknown', 'none'] as const) {
      const res = PriceQualityClassifier.classifyObservation(
        makeObs({ id: `c4-${emptySource}`, source: emptySource as any, date: daysAgoIso(1) }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      assert.equal(res.status, 'UNVERIFIED');
      assert.equal(res.isReliableForOptimization, false);
      assert.equal(res.hasEnoughDataForScore, false);
    }
    pass('4. Sursă lipsă / unknown / none -> UNVERIFIED fără scor supraîncărcat');
  }

  // 5. Sursă raportată fără confirmare -> UNVERIFIED
  {
    const res = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c5', source: 'user_reported', date: daysAgoIso(1), price: 7.0 }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(res.status, 'UNVERIFIED');
    assert.equal(res.isReliableForOptimization, false);
    assert.ok(res.reasons.some(r => /confirmare/i.test(r)));
    pass('5. Observație user_reported fără confirmare suficientă -> UNVERIFIED');
  }

  // 6. Lipsă dată/timestamp -> UNVERIFIED
  {
    const res = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c6', date: '', source: 'official_feed' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(res.status, 'UNVERIFIED');
    assert.equal(res.ageHours, null);
    assert.equal(res.hasEnoughDataForScore, false);
    pass('6. Observație fără timestamp -> UNVERIFIED');
  }

  // 7. Ofertă expirată -> EXPIRED (doar pentru oferte/promoții expirate)
  {
    const expiredOffer = makeOffer({
      id: 'c7-exp',
      validUntil: daysAgoIso(4),
      verificationStatus: 'verified'
    });
    const res = PriceQualityClassifier.classifyOffer(expiredOffer, { product: MILK_PRODUCT, now: FIXED_NOW });
    assert.equal(res.status, 'EXPIRED');
    assert.equal(res.isUsableForComparison, false);
    assert.ok(res.reasons.some(r => /expirat/i.test(r)));
    pass('7. Ofertă / promoție cu validUntil în trecut -> EXPIRED și exclusă din comparații active');
  }

  // 8. Observație istorică asociată unei oferte expirate -> NU devine EXPIRED, ci își păstrează statusul istoric + notă explicativă
  {
    const linkedExpiredOffer = makeOffer({ validUntil: daysAgoIso(10) });
    const res = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c8', date: daysAgoIso(15), source: 'official_feed', offerValidUntil: daysAgoIso(10) }),
      { product: MILK_PRODUCT, linkedOffer: linkedExpiredOffer, now: FIXED_NOW }
    );
    assert.equal(res.status, 'VERIFIED');
    assert.ok(res.historicalContextNoteRo && /expirat/i.test(res.historicalContextNoteRo));
    pass('8. Observație istorică legată de o ofertă expirată -> rămâne VERIFIED cu explicație transparentă');
  }

  // 9. Sursă 'demo' -> SUSPICIOUS (chiar dacă este din ziua curentă)
  {
    const obsRes = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c9-obs', date: daysAgoIso(0), source: 'demo' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(obsRes.status, 'SUSPICIOUS');
    assert.equal(obsRes.isUsableForComparison, false);

    const offRes = PriceQualityClassifier.classifyOffer(
      makeOffer({ id: 'c9-off', source: 'demo', verificationStatus: 'verified' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(offRes.status, 'SUSPICIOUS');
    assert.equal(offRes.isUsableForComparison, false);
    pass('9. Sursă demo -> SUSPICIOUS indiferent de prospețime');
  }

  // 10. Sursă 'estimated' -> SUSPICIOUS
  {
    const obsRes = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c10-obs', date: daysAgoIso(0), source: 'estimated' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(obsRes.status, 'SUSPICIOUS');

    const offRes = PriceQualityClassifier.classifyOffer(
      makeOffer({ id: 'c10-off', source: 'estimated', verificationStatus: 'verified' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(offRes.status, 'SUSPICIOUS');
    pass('10. Sursă estimated -> SUSPICIOUS atât la observații, cât și la oferte');
  }

  // 11. Preț 0, negativ, NaN, Infinity -> SUSPICIOUS
  {
    for (const badPrice of [0, -5.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const res = PriceQualityClassifier.classifyObservation(
        makeObs({ id: `c11-${String(badPrice)}`, price: badPrice, date: daysAgoIso(0), source: 'official_feed' }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      assert.equal(res.status, 'SUSPICIOUS');
      assert.equal(res.isUsableForComparison, false);
    }
    pass('11. Preț 0, negativ, NaN, Infinity -> SUSPICIOUS');
  }

  // 12. Preț neverosimil (< minPlausiblePrice sau > maxPlausiblePrice) -> SUSPICIOUS
  {
    const tooCheap = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c12-low', price: 0.02, date: daysAgoIso(0), source: 'official_feed' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    const tooExpensive = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c12-high', price: 9500, date: daysAgoIso(0), source: 'official_feed' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(tooCheap.status, 'SUSPICIOUS');
    assert.equal(tooExpensive.status, 'SUSPICIOUS');
    pass('12. Prețuri extreme în afara intervalului plauzibil -> SUSPICIOUS');
  }

  // 13. Monedă incompatibilă cu RON (EUR / USD / £) -> SUSPICIOUS
  {
    for (const badCurr of ['EUR', 'USD', 'GBP']) {
      const res = PriceQualityClassifier.classifyObservation(
        makeObs({ id: `c13-${badCurr}`, price: 6.5, currency: badCurr, date: daysAgoIso(0), source: 'official_feed' }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      assert.equal(res.status, 'SUSPICIOUS');
      assert.ok(res.reasons.some(r => /monedă incompatibilă|RON/i.test(r)));
    }
    pass('13. Monedă incompatibilă (EUR / USD / GBP) -> SUSPICIOUS');
  }

  // 14. Dată / timestamp în viitor -> SUSPICIOUS (nu VERIFIED_RECENTLY!)
  {
    const obsFuture = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c14-obs', date: daysAheadIso(5), source: 'official_feed', price: 7.0 }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(obsFuture.status, 'SUSPICIOUS');

    const offFuture = PriceQualityClassifier.classifyOffer(
      makeOffer({
        id: 'c14-off',
        lastVerifiedAt: daysAheadIso(3) + 'T12:00:00.000Z',
        lastChecked: daysAheadIso(3) + 'T12:00:00.000Z',
        observationDate: daysAheadIso(3)
      }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(offFuture.status, 'SUSPICIOUS');
    pass('14. Timestamp în viitor (> +24h) -> SUSPICIOUS în observații și oferte');
  }

  // 15. Date calendaristice imposibile / malformate -> SUSPICIOUS
  {
    for (const badDate of ['2026-02-30', '2026-13-15', 'not-a-date']) {
      const obsRes = PriceQualityClassifier.classifyObservation(
        makeObs({ id: `c15-obs-${badDate}`, date: badDate, source: 'official_feed', price: 7.0 }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      assert.equal(obsRes.status, 'SUSPICIOUS');

      const offRes = PriceQualityClassifier.classifyOffer(
        makeOffer({ id: `c15-off-${badDate}`, lastVerifiedAt: badDate, lastChecked: badDate, observationDate: badDate }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      assert.equal(offRes.status, 'SUSPICIOUS');
    }
    pass('15. Date calendaristice imposibile / malformate (2026-02-30 etc.) -> SUSPICIOUS');
  }

  // 16. Precedență strictă: recent (azi) + anomalie -> SUSPICIOUS, niciodată valid
  {
    const res = PriceQualityClassifier.classifyObservation(
      makeObs({
        id: 'c16',
        date: daysAgoIso(0),
        source: 'official_feed',
        price: 7.0,
        normalPrice: 6.0,
        promoPrice: 7.0
      }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(res.status, 'SUSPICIOUS');
    assert.equal(res.isReliableForOptimization, false);
    pass('16. Precedență: un preț suspect din ziua curentă nu devine VERIFIED_RECENTLY');
  }

  // 17. Inconsistență normalPrice < promoPrice (inclusiv fără flag isPromo explicit) -> SUSPICIOUS
  {
    const obsRes = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c17-obs', price: 8.5, normalPrice: 7.0, promoPrice: 8.5 }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(obsRes.status, 'SUSPICIOUS');

    const offRes = PriceQualityClassifier.classifyOffer(
      makeOffer({ id: 'c17-off', isPromo: false, price: 8.5, normalPrice: 7.0, promoPrice: 8.5 }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(offRes.status, 'SUSPICIOUS');
    pass('17. Inconsistență normalPrice < promoPrice -> SUSPICIOUS');
  }

  // 18. Variație extremă inexplicabilă în sus (+150% față de reper) -> SUSPICIOUS
  {
    const spikeRes = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c18', date: daysAgoIso(0), price: 18.5, source: 'official_feed' }),
      { product: MILK_PRODUCT, historicalBaselinePrice: 7.0, now: FIXED_NOW }
    );
    assert.equal(spikeRes.status, 'SUSPICIOUS');
    assert.ok(spikeRes.reasons.some(r => /variație extremă/i.test(r)));
    pass('18. Creștere extremă inexplicabilă (+164%) -> SUSPICIOUS chiar dacă este recentă');
  }

  // 19. Scădere extremă fără promoție -> SUSPICIOUS; reducere promoțională legitimă -> validă
  {
    const unexplainedDrop = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c19-drop', date: daysAgoIso(1), price: 2.0, isPromo: false, source: 'official_feed' }),
      { product: MILK_PRODUCT, historicalBaselinePrice: 7.0, now: FIXED_NOW }
    );
    assert.equal(unexplainedDrop.status, 'SUSPICIOUS');

    const legitPromoDrop = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c19-promo', date: daysAgoIso(1), price: 4.5, normalPrice: 7.0, promoPrice: 4.5, isPromo: true, source: 'official_feed' }),
      { product: MILK_PRODUCT, historicalBaselinePrice: 7.0, now: FIXED_NOW }
    );
    assert.equal(legitPromoDrop.status, 'VERIFIED_RECENTLY');
    pass('19. Scădere extremă fără promoție -> SUSPICIOUS; promoție consistentă -> validă');
  }

  // 20. Conflict de unitate de măsură (kg vs l / unități incompatibile) -> SUSPICIOUS
  {
    const unitConflictObs = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c20-obs', unit: 'kg', normalizedUnit: 'kg', date: daysAgoIso(1) }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(unitConflictObs.status, 'SUSPICIOUS');
    assert.ok(unitConflictObs.reasons.some(r => /unitate/i.test(r)));

    const unitConflictOffer = PriceQualityClassifier.classifyOffer(
      makeOffer({ id: 'c20-off', unitPriceMeasure: 'lei/kg' }),
      { product: MILK_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(unitConflictOffer.status, 'SUSPICIOUS');
    pass('20. Conflict fizic de unitate (kg vs l) -> SUSPICIOUS');
  }

  // 21. Conflict de ambalaj / gramaj (500g vs 200g sau gramaj <= 0) -> SUSPICIOUS
  {
    const wrongPkg = PriceQualityClassifier.classifyObservation(
      makeObs({
        id: 'c21-pkg',
        productId: BUTTER_PRODUCT.id,
        price: 12.0,
        packageWeightOrVolume: 500,
        packageUnit: 'g',
        date: daysAgoIso(1)
      }),
      { product: BUTTER_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(wrongPkg.status, 'SUSPICIOUS');
    assert.ok(wrongPkg.reasons.some(r => /ambalaj|gramaj/i.test(r)));

    const compatiblePkg = PriceQualityClassifier.classifyObservation(
      makeObs({
        id: 'c21-ok',
        productId: BUTTER_PRODUCT.id,
        price: 12.0,
        packageWeightOrVolume: 0.2,
        packageUnit: 'kg',
        date: daysAgoIso(1)
      }),
      { product: BUTTER_PRODUCT, now: FIXED_NOW }
    );
    assert.equal(compatiblePkg.status, 'VERIFIED_RECENTLY');
    pass('21. Conflict de gramaj/ambalaj (500g vs 200g) -> SUSPICIOUS; echivalența (0.2kg vs 200g) -> validă');
  }

  // 22. Identitate canonică: ciclu, alias orfan, alt produs -> SUSPICIOUS; alias multi-hop valid -> ok cu originalProductId
  {
    const root: Product = { ...MILK_PRODUCT, id: 'c22-root', canonicalProductId: null };
    const alias1: Product = { ...MILK_PRODUCT, id: 'c22-a1', canonicalProductId: 'c22-root' };
    const alias2: Product = { ...MILK_PRODUCT, id: 'c22-a2', canonicalProductId: 'c22-a1' };
    const other: Product = { ...BUTTER_PRODUCT, id: 'c22-other', canonicalProductId: null };
    const cycA: Product = { ...MILK_PRODUCT, id: 'c22-ca', canonicalProductId: 'c22-cb' };
    const cycB: Product = { ...MILK_PRODUCT, id: 'c22-cb', canonicalProductId: 'c22-ca' };
    const orphan: Product = { ...MILK_PRODUCT, id: 'c22-orphan', canonicalProductId: 'c22-missing' };
    const aliasCatalog = [root, alias1, alias2, other, cycA, cycB, orphan];

    const okAlias = PriceQualityClassifier.classifyObservation(
      makeObs({ id: 'c22-ok', productId: 'c22-a2', date: daysAgoIso(1) }),
      { product: root, aliasSource: aliasCatalog, now: FIXED_NOW }
    );
    assert.equal(okAlias.status, 'VERIFIED_RECENTLY');
    assert.equal(okAlias.canonicalProductId, 'c22-root');
    assert.equal(okAlias.originalProductId, 'c22-a2');

    for (const badProdId of ['c22-ca', 'c22-orphan', 'c22-other']) {
      const badRes = PriceQualityClassifier.classifyObservation(
        makeObs({ id: `c22-${badProdId}`, productId: badProdId, date: daysAgoIso(1) }),
        { product: root, aliasSource: aliasCatalog, now: FIXED_NOW }
      );
      assert.equal(badRes.status, 'SUSPICIOUS', `${badProdId} trebuie marcat SUSPICIOUS`);
    }
    pass('22. Alias multi-hop valid păstrează proveniența; ciclu/orfan/alt produs -> SUSPICIOUS');
  }

  // 23. Praguri configurabile + resetConfig()
  {
    try {
      PriceQualityClassifier.configure({
        observationRecentlyVerifiedMaxDays: 2,
        observationVerifiedMaxDays: 10
      });
      const day4 = PriceQualityClassifier.classifyObservation(
        makeObs({ id: 'c23-d4', date: daysAgoIso(4) }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      const day15 = PriceQualityClassifier.classifyObservation(
        makeObs({ id: 'c23-d15', date: daysAgoIso(15) }),
        { product: MILK_PRODUCT, now: FIXED_NOW }
      );
      assert.equal(day4.status, 'VERIFIED');
      assert.equal(day15.status, 'STALE');
    } finally {
      PriceQualityClassifier.resetConfig();
    }
    assert.equal(
      PriceQualityClassifier.getConfig().observationVerifiedMaxDays,
      DEFAULT_PRICE_QUALITY_CONFIG.observationVerifiedMaxDays
    );
    pass('23. Pragurile de clasificare sunt configurabile și resetConfig() restabilește valorile implicite');
  }

  // 24. hasEnoughDataForScore = false când lipsesc date esențiale (fără supraîncărcare scor tehnic)
  {
    const noSourceNoDate = PriceQualityClassifier.classifyOffer(
      makeOffer({ source: '' as any, lastVerifiedAt: '', lastChecked: '', observationDate: '' }),
      { now: FIXED_NOW }
    );
    assert.equal(noSourceNoDate.status, 'UNVERIFIED');
    assert.equal(noSourceNoDate.hasEnoughDataForScore, false);
    pass('24. Lipsa datelor suficiente semnalată prin hasEnoughDataForScore=false');
  }

  // 25. PriceHistoryService: nu șterge observațiile suspecte, le marchează în flaggedObservations și păstrează statisticile RON curate
  {
    const obsList: PriceObservation[] = [
      makeObs({ id: 'h-ok1', price: 6.8, date: daysAgoIso(40), source: 'official_feed' }),
      makeObs({ id: 'h-ok2', price: 7.0, date: daysAgoIso(12), source: 'verified' }),
      makeObs({ id: 'h-ok3', price: 7.2, date: daysAgoIso(2), source: 'partner_api' }),
      makeObs({ id: 'h-unv', price: 7.0, date: daysAgoIso(1), source: 'user_reported' }),
      makeObs({ id: 'h-eur', price: 1.5, currency: 'EUR', date: daysAgoIso(1), source: 'official_feed' }),
      makeObs({ id: 'h-demo', price: 1.0, date: daysAgoIso(1), source: 'demo' }),
      makeObs({ id: 'h-spike', price: 45.0, date: daysAgoIso(1), source: 'official_feed' }),
      makeObs({ id: 'h-baddate', price: 7.0, date: '2026-02-30', source: 'official_feed' })
    ];

    const stats = PriceHistoryService.getProductPriceStats(MILK_PRODUCT.id, {
      product: MILK_PRODUCT,
      observations: obsList,
      stores: STORES,
      aliasMap: [MILK_PRODUCT],
      now: FIXED_NOW
    });

    assert.equal(stats.observationsCount, 4);
    assert.equal(stats.minRecordedPrice, 6.8);
    assert.equal(stats.averagePrice, 7.0);
    assert.equal(stats.excludedForeignCurrencyCount, 1);
    assert.equal(stats.flaggedObservations?.length, 4);
    assert.deepEqual(
      new Set(stats.flaggedObservations?.map(f => f.id)),
      new Set(['h-eur', 'h-demo', 'h-spike', 'h-baddate'])
    );
    assert.equal(stats.observationQualityById?.['h-ok1']?.status, 'STALE');
    assert.equal(stats.observationQualityById?.['h-ok2']?.status, 'VERIFIED');
    assert.equal(stats.observationQualityById?.['h-ok3']?.status, 'VERIFIED_RECENTLY');
    assert.equal(stats.observationQualityById?.['h-unv']?.status, 'UNVERIFIED');
    assert.equal(stats.qualitySummary?.suspicious, 4);
    pass('25. PriceHistoryService marchează toate observațiile suspecte fără a le șterge și păstrează media RON exactă');
  }

  // 26. Endpoint-urile HTTP /api/catalog/history/:id și /api/products/:id returnează clasificări & flaggedObservations
  {
    const testRoot: Product = { ...MILK_PRODUCT, id: 'p32-http-root' };
    const testObs: PriceObservation[] = [
      makeObs({ id: 'http-1', productId: 'p32-http-root', price: 6.9, date: daysAgoIso(45), source: 'official_feed' }),
      makeObs({ id: 'http-2', productId: 'p32-http-root', price: 7.1, date: daysAgoIso(3), source: 'verified' }),
      makeObs({ id: 'http-eur', productId: 'p32-http-root', price: 1.4, currency: 'EUR', date: daysAgoIso(2), source: 'official_feed' }),
      makeObs({ id: 'http-est', productId: 'p32-http-root', price: 2.0, date: daysAgoIso(1), source: 'estimated' })
    ];
    const testOffers: ProductOffer[] = [
      makeOffer({ id: 'http-off', productId: 'p32-http-root', price: 6.89 })
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
      const idx = buildCanonicalAliasIndex([testRoot]);
      DatabaseService.getProductAliasIndex = async () => idx;
      DatabaseService.getPriceObservations = async () => testObs;
      DatabaseService.getOffers = async () => testOffers;
      DatabaseService.getStores = async () => STORES;
      StorageService.getAllProducts = () => [testRoot];
      StorageService.getPriceObservations = () => testObs;
      StorageService.getProductOffers = () => testOffers;

      const { app } = await import('../server.ts');
      const srv = http.createServer(app);
      await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
      const port = (srv.address() as any).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const rHist = await fetch(`${baseUrl}/api/catalog/history/p32-http-root?days=90`);
        assert.equal(rHist.status, 200);
        const jHist = await rHist.json();
        assert.equal(jHist.totalInIntervalCount, 2);
        assert.equal(jHist.flaggedObservations.length, 2);
        assert.equal(jHist.observationQualityById['http-1'].status, 'STALE');
        assert.equal(jHist.observationQualityById['http-2'].status, 'VERIFIED_RECENTLY');
        assert.equal(jHist.observationQualityById['http-est'].status, 'SUSPICIOUS');

        const rProd = await fetch(`${baseUrl}/api/products/p32-http-root`);
        assert.equal(rProd.status, 200);
        const jProd = await rProd.json();
        assert.equal(jProd.observations.length, 2);
        assert.equal(jProd.flaggedObservations.length, 2);
        assert.equal(jProd.qualitySummary.suspicious, 2);
        pass('26. API HTTP /api/catalog/history/:id și /api/products/:id expun qualitySummary & flaggedObservations');
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

  // 27. Reutilizare centralizată în BasketOptimizerService & PriceComparisonService (zero clasificator paralel)
  {
    const res = BasketOptimizerService.optimize({
      items: [
        {
          id: 'i-27',
          productId: MILK_PRODUCT.id,
          name: MILK_PRODUCT.name,
          category: MILK_PRODUCT.category,
          quantity: 1,
          unit: 'l',
          checked: false
        }
      ],
      products: [MILK_PRODUCT],
      offers: [
        makeOffer({ id: 'bad-est', storeId: 'lidl', price: 3.0, source: 'estimated' }),
        makeOffer({ id: 'bad-inv-promo', storeId: 'penny', price: 4.0, normalPrice: 3.0, promoPrice: 4.0 }),
        makeOffer({ id: 'good-kauf', storeId: 'kaufland', price: 6.9, source: 'official_feed' })
      ],
      stores: STORES,
      options: { now: FIXED_NOW }
    });
    assert.equal(res.bestSingleStore?.store.id, 'kaufland');
    assert.equal(res.bestSingleStore?.totalPrice, 6.9);
    assert.equal(PriceComparisonService.isOfferValid(makeOffer({ source: 'estimated' }), MILK_PRODUCT, { now: FIXED_NOW }), false);
    pass('27. BasketOptimizerService & PriceComparisonService refolosesc același PriceQualityClassifier');
  }

  // 28. Randare UI ProductPriceTrend cu statusuri clare și fără scor numeric zgomotos
  {
    const uiObs: PriceObservation[] = [
      makeObs({ id: 'ui-stale', storeId: 'lidl', price: 6.8, date: daysAgoIso(45), source: 'official_feed' }),
      makeObs({ id: 'ui-rec', storeId: 'lidl', price: 7.0, date: daysAgoIso(2), source: 'verified' }),
      makeObs({ id: 'ui-unv', storeId: 'kaufland', price: 7.1, date: daysAgoIso(3), source: 'user_reported' }),
      makeObs({ id: 'ui-demo', storeId: 'carrefour', price: 1.0, date: daysAgoIso(1), source: 'demo' })
    ];

    const html = renderToStaticMarkup(
      React.createElement(ProductPriceTrend, {
        productId: MILK_PRODUCT.id,
        productName: MILK_PRODUCT.name,
        product: MILK_PRODUCT,
        observations: uiObs,
        stores: STORES
      })
    );
    assert.match(html, /Calitate date &amp; surse|Calitate date & surse/);
    assert.match(html, /Confirmat recent|Neverificat/);
    assert.match(html, /observație suspectă sau incompatibilă a fost marcată/);
    assert.ok(!html.includes('/100'), 'UI-ul ProductPriceTrend nu supraîncarcă cu scoruri X/100');
    pass('28. ProductPriceTrend randează statusuri lizibile în română și semnalează observațiile suspecte fără a le șterge');
  }

  // 29. Integritate append-only & absența modificărilor distructive
  {
    const schemaSql = fs.readFileSync(path.join(process.cwd(), 'src/db/schema.sql'), 'utf8');
    const classifierSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/PriceQualityClassifier.ts'), 'utf8');
    assert.match(schemaSql, /trg_protect_price_observations/i);
    assert.ok(!/DELETE\s+FROM\s+price_observations/i.test(classifierSrc));
    assert.ok(!/UPDATE\s+price_observations/i.test(classifierSrc));
    pass('29. Protecția append-only pe price_observations și garanția read-only a clasificatorului sunt intacte');
  }

  // 30. Determinism complet la reordinea lotului de observații
  {
    const obsA: PriceObservation[] = [
      makeObs({ id: 'det-1', storeId: 'lidl', price: 6.9, date: daysAgoIso(40), source: 'official_feed' }),
      makeObs({ id: 'det-2', storeId: 'kaufland', price: 7.1, date: daysAgoIso(3), source: 'verified' }),
      makeObs({ id: 'det-3', storeId: 'lidl', price: 2.0, date: daysAgoIso(1), source: 'demo' }),
      makeObs({ id: 'det-4', storeId: 'carrefour', price: 7.0, date: daysAgoIso(1), source: 'user_reported' })
    ];
    const run1 = PriceQualityClassifier.classifyObservationBatch(obsA, {
      product: MILK_PRODUCT,
      expectedProductId: MILK_PRODUCT.id,
      now: FIXED_NOW
    });
    const run2 = PriceQualityClassifier.classifyObservationBatch([...obsA].reverse(), {
      product: MILK_PRODUCT,
      expectedProductId: MILK_PRODUCT.id,
      now: FIXED_NOW
    });
    assert.deepEqual(run1.summary, run2.summary);
    for (const id of Object.keys(run1.assessmentsById)) {
      assert.deepEqual(run1.assessmentsById[id], run2.assessmentsById[id]);
    }
    pass('30. Determinism complet indiferent de ordinea de intrare a observațiilor');
  }

  console.log('\n====================================================================');
  console.log(`FAZA 3.2 TESTE FINALIZATE: ${passed} / 30 PASSED`);
  console.log('====================================================================');
}

runTests().catch(err => {
  console.error('❌ EROARE TEST FAZA 3.2:', err);
  process.exit(1);
});
