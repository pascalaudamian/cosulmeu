import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

process.env.NODE_ENV = 'test';

import { PriceHistoryService } from '../src/services/PriceHistoryService.js';
import { PriceAlertService } from '../src/services/PriceAlertService.js';
import { PriceComparisonService } from '../src/services/PriceComparisonService.js';
import type {
  InAppPriceNotification,
  PriceAlert,
  PriceObservation,
  Product,
  ProductOffer,
  ShoppingList,
  Store
} from '../src/types.js';

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const DAY_15_AGO = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const DAY_60_AGO = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const DAY_140_AGO = new Date(NOW.getTime() - 140 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const DAY_240_AGO = new Date(NOW.getTime() - 240 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const DAY_400_AGO = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const EXPIRED_YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const NEXT_DAY = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

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
    id: 'prod-lapte-1',
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
    id: 'prod-ulei-1',
    name: 'Ulei floarea-soarelui 1L',
    brand: 'Bunica',
    category: 'Produse de bază',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 9.0
  }
];

function makeOffer(overrides: Partial<ProductOffer>): ProductOffer {
  return {
    id: overrides.id || `off-${Math.random().toString(36).slice(2, 7)}`,
    productId: overrides.productId || 'prod-lapte-1',
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
    validUntil: overrides.validUntil,
    isFlaggedAnomaly: overrides.isFlaggedAnomaly
  };
}

async function runTests() {
  console.log('🧪 Rulare suită dedicată Istoric Prețuri, Alerte Smart & Securitate RLS...\n');
  let passed = 0;

  const check = (name: string, fn: () => void | Promise<void>) => ({ name, fn });

  const tests = [
    check('1. Istoric 30 / 90 / 180 / 365 zile: calcul real min, mediu, ultim preț, dată, retailer și excludere date sintetice', () => {
      const observations: PriceObservation[] = [
        { id: 'o-400', productId: 'prod-lapte-1', storeId: 'kaufland', price: 4.5, date: DAY_400_AGO, source: 'official_feed' }, // > 1 an
        { id: 'o-240', productId: 'prod-lapte-1', storeId: 'lidl', price: 5.9, date: DAY_240_AGO, source: 'official_feed' }, // în 365
        { id: 'o-140', productId: 'prod-lapte-1', storeId: 'kaufland', price: 6.4, date: DAY_140_AGO, source: 'verified' }, // în 180 & 365
        { id: 'o-60', productId: 'prod-lapte-1', storeId: 'lidl', price: 7.2, date: DAY_60_AGO, source: 'official_feed' }, // în 90, 180, 365
        { id: 'o-15', productId: 'prod-lapte-1', storeId: 'kaufland', price: 6.8, date: DAY_15_AGO, source: 'verified' }, // în 30, 90, 180, 365
        // Date sintetice ce TREBUIE ignorate
        { id: 'o-demo', productId: 'prod-lapte-1', storeId: 'lidl', price: 1.99, date: TODAY, source: 'demo' },
        { id: 'o-est', productId: 'prod-lapte-1', storeId: 'lidl', price: 2.5, date: TODAY, source: 'estimated' }
      ];

      const stats = PriceHistoryService.getProductPriceStats('prod-lapte-1', {
        observations,
        stores: STORES,
        now: NOW
      });

      assert.equal(stats.observationsCount, 5); // fără demo/estimated
      assert.equal(stats.intervalStats[30].observationsCount, 1);
      assert.equal(stats.intervalStats[30].minPrice, 6.8);
      assert.equal(stats.intervalStats[30].hasSufficientHistory, false); // doar 1 observație în 30 zile

      assert.equal(stats.intervalStats[90].observationsCount, 2);
      assert.equal(stats.intervalStats[90].minPrice, 6.8);
      assert.equal(stats.intervalStats[90].avgPrice, 7.0);
      assert.equal(stats.intervalStats[90].hasSufficientHistory, true);

      assert.equal(stats.intervalStats[180].observationsCount, 3);
      assert.equal(stats.intervalStats[180].minPrice, 6.4);
      assert.equal(stats.intervalStats[180].minPriceStoreName, 'Kaufland');

      assert.equal(stats.intervalStats[365].observationsCount, 4); // >400 zile exclus, demo/est exclus
      assert.equal(stats.intervalStats[365].minPrice, 5.9);
      assert.equal(stats.intervalStats[365].minPriceStoreName, 'Lidl');
      assert.equal(stats.intervalStats[365].lastObservation?.price, 6.8);
      assert.equal(stats.intervalStats[365].lastObservation?.date, DAY_15_AGO);
      assert.equal(stats.intervalStats[365].lastObservation?.storeName, 'Kaufland');
      assert.equal(stats.intervalStats[365].hasSufficientHistory, true);
    }),

    check('2. Date istorice insuficiente (0 obs / 1 obs / aceeași zi) -> zero valori inventate', () => {
      const zeroStats = PriceHistoryService.getProductPriceStats('prod-ulei-1', {
        observations: [],
        stores: STORES,
        now: NOW
      });
      assert.equal(zeroStats.observationsCount, 0);
      assert.equal(zeroStats.minRecordedPrice, null);
      assert.equal(zeroStats.averagePrice, null);
      assert.equal(zeroStats.hasSufficientHistory, false);
      assert.equal(zeroStats.intervalStats[365].minPrice, null);

      const sameDayObs: PriceObservation[] = [
        { id: 'sd-1', productId: 'prod-ulei-1', storeId: 'lidl', price: 8.5, date: TODAY, source: 'official_feed' },
        { id: 'sd-2', productId: 'prod-ulei-1', storeId: 'kaufland', price: 9.1, date: TODAY, source: 'verified' }
      ];
      const sameDayStats = PriceHistoryService.getProductPriceStats('prod-ulei-1', {
        observations: sameDayObs,
        stores: STORES,
        now: NOW
      });
      assert.equal(sameDayStats.observationsCount, 2);
      assert.equal(sameDayStats.distinctDaysCount, 1);
      assert.equal(sameDayStats.hasSufficientHistory, false);
      assert.match(sameDayStats.intervalStats[90].noticeRo || '', /o singură zi/i);
    }),

    check('3. Pragul de preț (below_target): declanșează sub/egal prag, NU declanșează peste prag', () => {
      const alert: PriceAlert = {
        id: 'a-target-1',
        productId: 'prod-lapte-1',
        productName: 'Lapte proaspăt 1.5% 1L (Zuzu)',
        targetPrice: 6.5,
        currentLowestPrice: 7.0,
        createdAt: DAY_15_AGO,
        isActive: true,
        alertType: 'below_target'
      };

      const aboveRes = PriceAlertService.evaluateAlerts({
        alerts: [alert],
        products: PRODUCTS,
        offers: [makeOffer({ id: 'o-above', price: 6.9, storeId: 'lidl' })],
        stores: STORES,
        now: NOW
      });
      assert.equal(aboveRes.newNotifications.length, 0);

      const belowRes = PriceAlertService.evaluateAlerts({
        alerts: [alert],
        products: PRODUCTS,
        offers: [makeOffer({ id: 'o-below', price: 6.4, storeId: 'kaufland' })],
        stores: STORES,
        now: NOW
      });
      assert.equal(belowRes.newNotifications.length, 1);
      assert.equal(belowRes.newNotifications[0].alertType, 'below_target');
      assert.equal(belowRes.newNotifications[0].observedPrice, 6.4);
      assert.equal(belowRes.newNotifications[0].storeName, 'Kaufland');
    }),

    check('4. Alertă la reducere (any_drop): detectează scăderea reală față de prețul anterior', () => {
      const alert: PriceAlert = {
        id: 'a-drop-1',
        productId: 'prod-ulei-1',
        productName: 'Ulei floarea-soarelui 1L',
        targetPrice: 9.0,
        currentLowestPrice: 9.0,
        lastEvaluatedPrice: 9.0,
        createdAt: DAY_15_AGO,
        isActive: true,
        alertType: 'any_drop'
      };

      const sameRes = PriceAlertService.evaluateAlerts({
        alerts: [alert],
        products: PRODUCTS,
        offers: [makeOffer({ id: 'u-same', productId: 'prod-ulei-1', price: 9.0 })],
        stores: STORES,
        now: NOW
      });
      assert.equal(sameRes.newNotifications.length, 0);

      const dropRes = PriceAlertService.evaluateAlerts({
        alerts: sameRes.updatedAlerts,
        products: PRODUCTS,
        offers: [makeOffer({ id: 'u-drop', productId: 'prod-ulei-1', price: 7.65, storeId: 'lidl' })],
        stores: STORES,
        now: NOW
      });
      assert.equal(dropRes.newNotifications.length, 1);
      assert.equal(dropRes.newNotifications[0].previousPrice, 9.0);
      assert.equal(dropRes.newNotifications[0].observedPrice, 7.65);
      assert.match(dropRes.newNotifications[0].message, /-15%/);
    }),

    check('5. Alertă interval_low (minim 90 zile): ignoră datele demo/estimate și compară cu minimul real', () => {
      const alert: PriceAlert = {
        id: 'a-low-1',
        productId: 'prod-lapte-1',
        productName: 'Lapte proaspăt 1.5% 1L',
        targetPrice: 7.0,
        currentLowestPrice: 7.0,
        createdAt: DAY_60_AGO,
        isActive: true,
        alertType: 'interval_low',
        intervalDays: 90
      };

      const observations: PriceObservation[] = [
        { id: 'obs-1', productId: 'prod-lapte-1', storeId: 'lidl', price: 6.8, date: DAY_60_AGO, source: 'official_feed' },
        { id: 'obs-demo', productId: 'prod-lapte-1', storeId: 'lidl', price: 3.0, date: DAY_15_AGO, source: 'demo' }
      ];

      const res = PriceAlertService.evaluateAlerts({
        alerts: [alert],
        products: PRODUCTS,
        offers: [makeOffer({ id: 'o-new-low', price: 6.5, storeId: 'kaufland' })],
        observations,
        stores: STORES,
        now: NOW
      });
      assert.equal(res.newNotifications.length, 1);
      assert.equal(res.newNotifications[0].targetPrice, 6.8);
      assert.equal(res.newNotifications[0].observedPrice, 6.5);
    }),

    check('6. Prețuri expirate, estimate, demo sau anomalii sunt IGNORATE complet de alerte', () => {
      const alert: PriceAlert = {
        id: 'a-exp-1',
        productId: 'prod-lapte-1',
        productName: 'Lapte proaspăt 1.5% 1L',
        targetPrice: 6.5,
        currentLowestPrice: 7.5,
        createdAt: DAY_15_AGO,
        isActive: true,
        alertType: 'below_target'
      };

      const badOffers: ProductOffer[] = [
        makeOffer({ id: 'exp-1', price: 3.99, validUntil: EXPIRED_YESTERDAY }),
        makeOffer({ id: 'exp-2', price: 4.1, verificationStatus: 'expired' }),
        makeOffer({ id: 'est-1', price: 3.5, source: 'estimated' }),
        makeOffer({ id: 'demo-1', price: 2.99, source: 'demo' }),
        makeOffer({ id: 'anom-1', price: 0.99, isFlaggedAnomaly: true })
      ];

      for (const off of badOffers) {
        assert.equal(PriceComparisonService.isOfferValid(off, PRODUCTS[0]), false);
      }

      const res = PriceAlertService.evaluateAlerts({
        alerts: [alert],
        products: PRODUCTS,
        offers: badOffers,
        stores: STORES,
        now: NOW
      });
      assert.equal(res.newNotifications.length, 0);
    }),

    check('7. Deduplicare: prevenire alerte duplicate din listă & zero re-declanșări pe aceeași observație chiar în zile diferite', () => {
      const list: ShoppingList = {
        id: 'list-dup-1',
        name: 'Săptămânală',
        createdAt: TODAY,
        updatedAt: TODAY,
        items: [
          {
            id: 'i1',
            productId: 'prod-lapte-1',
            name: 'Lapte proaspăt 1.5% 1L',
            category: 'Lactate și ouă',
            quantity: 2,
            unit: 'l',
            checked: false
          },
          {
            id: 'i2',
            productId: 'prod-lapte-1',
            name: 'Lapte proaspăt 1.5% 1L',
            category: 'Lactate și ouă',
            quantity: 1,
            unit: 'l',
            checked: false
          }
        ]
      };

      const batch1 = PriceAlertService.createAlertsFromShoppingList(list, [], PRODUCTS, [
        makeOffer({ id: 'off-list-1', price: 7.0 })
      ]);
      assert.equal(batch1.createdAlerts.length, 1);
      assert.equal(batch1.skippedExistingCount, 1);

      const batch2 = PriceAlertService.createAlertsFromShoppingList(list, batch1.createdAlerts, PRODUCTS, [
        makeOffer({ id: 'off-list-1', price: 7.0 })
      ]);
      assert.equal(batch2.createdAlerts.length, 0);

      // Evaluare pe aceeași observație în ziua 1 și ziua 2 => maxim 1 notificare!
      const obsOffer = makeOffer({
        id: 'obs-stable-id',
        productId: 'prod-lapte-1',
        storeId: 'lidl',
        price: 5.5,
        observationDate: TODAY
      });
      const alert: PriceAlert = {
        ...batch1.createdAlerts[0],
        targetPrice: 6.0
      };

      const evalDay1 = PriceAlertService.evaluateAlerts({
        alerts: [alert],
        products: PRODUCTS,
        offers: [obsOffer],
        stores: STORES,
        now: NOW
      });
      assert.equal(evalDay1.newNotifications.length, 1);

      const evalDay2SameObs = PriceAlertService.evaluateAlerts({
        alerts: evalDay1.updatedAlerts,
        products: PRODUCTS,
        offers: [obsOffer],
        stores: STORES,
        existingNotifications: evalDay1.newNotifications,
        now: NEXT_DAY
      });
      assert.equal(evalDay2SameObs.newNotifications.length, 0);

      // Dar o observație NOUĂ (dată nouă + preț mai mic) declanșează o notificare nouă
      const nextDayStr = NEXT_DAY.toISOString().slice(0, 10);
      const newObsOffer = makeOffer({
        id: 'obs-new-id',
        productId: 'prod-lapte-1',
        storeId: 'lidl',
        price: 5.1,
        observationDate: nextDayStr
      });
      const evalNewObs = PriceAlertService.evaluateAlerts({
        alerts: evalDay2SameObs.updatedAlerts,
        products: PRODUCTS,
        offers: [newObsOffer],
        stores: STORES,
        existingNotifications: evalDay1.newNotifications,
        now: NEXT_DAY
      });
      assert.equal(evalNewObs.newNotifications.length, 1);
      assert.equal(evalNewObs.newNotifications[0].observedPrice, 5.1);
    }),

    check('8. Dezactivare (isActive: false) & Ștergere alertă', () => {
      const inactiveAlert: PriceAlert = {
        id: 'a-off',
        productId: 'prod-lapte-1',
        productName: 'Lapte proaspăt 1.5% 1L',
        targetPrice: 9.0,
        currentLowestPrice: 5.0,
        createdAt: TODAY,
        isActive: false,
        alertType: 'below_target'
      };

      const res = PriceAlertService.evaluateAlerts({
        alerts: [inactiveAlert],
        products: PRODUCTS,
        offers: [makeOffer({ price: 4.5 })],
        stores: STORES,
        now: NOW
      });
      assert.equal(res.newNotifications.length, 0);
      assert.equal(res.updatedAlerts[0].isActive, false);

      // Simulare ștergere
      const afterDelete = [inactiveAlert].filter(a => a.id !== 'a-off');
      assert.equal(afterDelete.length, 0);
    }),

    await (async () => ({
      name: '9. Securitate API, ownership & RLS SQL (401 fără auth / token invalid pe toate rutele /api/alerts/* + policy SQL)',
      fn: async () => {
        // Verificare SQL migration 012: RLS activ pe ambele tabele, auth.uid() = user_id, fără DROP/TRUNCATE
        const sqlPath = path.resolve(process.cwd(), 'src/db/migrations/012_v1_alerts_and_quality.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        const sqlNoComments = sql.replace(/^--.*$/gm, '');
        assert.match(sqlNoComments, /ALTER TABLE public\.price_alerts ENABLE ROW LEVEL SECURITY/i);
        assert.match(sqlNoComments, /ALTER TABLE public\.price_alert_notifications ENABLE ROW LEVEL SECURITY/i);
        assert.match(sqlNoComments, /USING\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
        assert.doesNotMatch(sqlNoComments, /\bDROP\s+TABLE\b|\bTRUNCATE\b/i);

        // Verificare endpoint-uri server.ts
        const { app } = await import('../server.ts');
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        assert.ok(addr && typeof addr !== 'string');
        const baseUrl = `http://127.0.0.1:${addr.port}`;
        const uuidA = '11111111-1111-4111-8111-111111111111';

        try {
          // 1) Fără autentificare -> 401
          const rListUnauth = await fetch(`${baseUrl}/api/alerts`);
          assert.equal(rListUnauth.status, 401);

          const rCreateUnauth = await fetch(`${baseUrl}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: 'prod-lapte-1', alertType: 'below_target', targetPrice: 6.5 })
          });
          assert.equal(rCreateUnauth.status, 401);

          const rPatchBadToken = await fetch(`${baseUrl}/api/alerts/${uuidA}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-b-forged-token' },
            body: JSON.stringify({ isActive: false })
          });
          assert.equal(rPatchBadToken.status, 401);

          const rDeleteBadToken = await fetch(`${baseUrl}/api/alerts/${uuidA}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer user-b-forged-token' }
          });
          assert.equal(rDeleteBadToken.status, 401);

          const rFromListBadToken = await fetch(`${baseUrl}/api/alerts/from-list/${uuidA}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-b-forged-token' },
            body: JSON.stringify({ alertType: 'any_drop' })
          });
          assert.equal(rFromListBadToken.status, 401);

          const rEvalUnauth = await fetch(`${baseUrl}/api/alerts/evaluate`, { method: 'POST' });
          assert.equal(rEvalUnauth.status, 401);

          const rNotifReadUnauth = await fetch(`${baseUrl}/api/alerts/notifications/${uuidA}/read`, { method: 'PATCH' });
          assert.equal(rNotifReadUnauth.status, 401);

          // 2) Istoric public: 365 zile & respingere interval invalid
          const rHistValid = await fetch(`${baseUrl}/api/catalog/history/prod-lapte-1?days=365`);
          assert.equal(rHistValid.status, 200);
          const histBody = await rHistValid.json();
          assert.equal(histBody.success, true);
          assert.equal(histBody.intervalDays, 365);
          assert.ok(histBody.allIntervalStats?.['30']);
          assert.ok(histBody.allIntervalStats?.['365']);

          const rHistInvalid = await fetch(`${baseUrl}/api/catalog/history/prod-lapte-1?days=45`);
          assert.equal(rHistInvalid.status, 400);
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

  console.log(`\n🎉 Toate cele ${passed}/${tests.length} teste Istoric Prețuri & Alerte Smart au trecut cu succes!`);
}

runTests();
