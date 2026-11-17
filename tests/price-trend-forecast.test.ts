// tests/price-trend-forecast.test.ts
// Teste unitare pentru utilitarul deterministic de trend și estimare săptămânală a prețurilor

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { computePriceTrendForecast } from '../src/utils/priceTrendForecast.ts';
import { PriceObservation } from '../src/types.ts';
import { STORES } from '../src/data/mockData.ts';

describe('Trend Prețuri și Estimare Săptămânală (computePriceTrendForecast)', () => {
  it('1. Returnează insufficient_history fără date simulate când nu există observații', () => {
    const res = computePriceTrendForecast({
      observations: [],
      offers: [],
      stores: STORES
    });
    assert.strictEqual(res.status, 'insufficient_history');
    assert.strictEqual(res.chartData.length, 0);
    assert.strictEqual(res.metrics, null);
  });

  it('2. Returnează insufficient_history când există o singură observație', () => {
    const obs: PriceObservation[] = [
      {
        id: 'obs-1',
        productId: 'p1',
        storeId: 'lidl',
        price: 6.49,
        date: '2026-11-10',
        source: 'verified'
      }
    ];
    const res = computePriceTrendForecast({ observations: obs, stores: STORES });
    assert.strictEqual(res.status, 'insufficient_history');
    assert.strictEqual(res.historicalPoints.length, 1);
    assert.strictEqual(res.metrics, null);
  });

  it('3. Returnează same_day_only când toate observațiile sunt din aceeași zi (nu extrapolează artificial)', () => {
    const obs: PriceObservation[] = [
      { id: 'o1', productId: 'p1', storeId: 'lidl', price: 5.99, date: '2026-11-16', source: 'official_feed' },
      { id: 'o2', productId: 'p1', storeId: 'kaufland', price: 6.49, date: '2026-11-16', source: 'official_feed' }
    ];
    const res = computePriceTrendForecast({ observations: obs, stores: STORES });
    assert.strictEqual(res.status, 'same_day_only');
    assert.strictEqual(res.distinctDatesCount, 1);
    assert.strictEqual(res.totalObservationsCount, 2);
    assert.strictEqual(res.metrics, null);
  });

  it('4. Calculează corect trendul descrescător și intervalul de încredere pe 4 săptămâni', () => {
    const obs: PriceObservation[] = [
      { id: 'o1', productId: 'p1', storeId: 'lidl', price: 12.0, date: '2026-10-15', source: 'verified' },
      { id: 'o2', productId: 'p1', storeId: 'kaufland', price: 12.5, date: '2026-10-15', source: 'official_feed' },
      { id: 'o3', productId: 'p1', storeId: 'lidl', price: 11.4, date: '2026-10-25', source: 'verified' },
      { id: 'o4', productId: 'p1', storeId: 'lidl', price: 10.8, date: '2026-11-05', source: 'official_feed' },
      { id: 'o5', productId: 'p1', storeId: 'penny', price: 10.2, date: '2026-11-15', source: 'verified' }
    ];
    const res = computePriceTrendForecast({
      observations: obs,
      stores: STORES,
      forecastWeeks: 4
    });

    assert.strictEqual(res.status, 'ready');
    assert.strictEqual(res.direction, 'down');
    assert.strictEqual(res.confidence, 'medie');
    assert.strictEqual(res.historicalPoints.length, 4);
    // 4 puncte istorice + 4 săptămâni estimate = 8 puncte în chartData
    assert.strictEqual(res.chartData.length, 8);
    assert.strictEqual(res.chartData[3].historicalPrice, 10.2);
    assert.strictEqual(res.chartData[3].forecastPrice, 10.2, 'Punctul de ancorare conectează istoricul cu estimarea');

    const lastForecast = res.chartData[7];
    assert.strictEqual(lastForecast.kind, 'forecast');
    assert.strictEqual(lastForecast.label, '+4 săpt.');
    assert.ok(lastForecast.forecastPrice! < 10.2);
    assert.ok(lastForecast.forecastLow! <= lastForecast.forecastPrice!);
    assert.ok(lastForecast.forecastHigh! >= lastForecast.forecastPrice!);
    assert.ok(res.metrics!.changePercent < 0);
  });

  it('5. Calculează corect trendul crescător și respectă orizontul selectat (2 săptămâni)', () => {
    const obs: PriceObservation[] = [
      { id: 'o1', productId: 'p2', storeId: 'carrefour', price: 8.0, date: '2026-10-01', source: 'official_feed' },
      { id: 'o2', productId: 'p2', storeId: 'carrefour', price: 8.4, date: '2026-10-10', source: 'official_feed' },
      { id: 'o3', productId: 'p2', storeId: 'carrefour', price: 8.9, date: '2026-10-20', source: 'official_feed' },
      { id: 'o4', productId: 'p2', storeId: 'carrefour', price: 9.3, date: '2026-10-30', source: 'official_feed' },
      { id: 'o5', productId: 'p2', storeId: 'carrefour', price: 9.7, date: '2026-11-08', source: 'official_feed' },
      { id: 'o6', productId: 'p2', storeId: 'carrefour', price: 10.1, date: '2026-11-16', source: 'official_feed' }
    ];
    const res = computePriceTrendForecast({
      observations: obs,
      stores: STORES,
      forecastWeeks: 2
    });

    assert.strictEqual(res.status, 'ready');
    assert.strictEqual(res.direction, 'up');
    assert.strictEqual(res.confidence, 'ridicată');
    assert.strictEqual(res.chartData.length, 8);
    assert.ok(res.metrics!.projectedPrice > 10.1);
  });

  it('6. Completează cu oferta activă dacă există o singură observație veche pe altă dată', () => {
    const obs: PriceObservation[] = [
      { id: 'o1', productId: 'p3', storeId: 'auchan', price: 5.5, date: '2026-11-01', source: 'verified' }
    ];
    const res = computePriceTrendForecast({
      observations: obs,
      offers: [{ price: 5.5, observationDate: '2026-11-16', storeId: 'auchan' }],
      stores: STORES,
      forecastWeeks: 4
    });

    assert.strictEqual(res.status, 'ready');
    assert.strictEqual(res.direction, 'stable');
    assert.strictEqual(res.distinctDatesCount, 2);
  });
});
