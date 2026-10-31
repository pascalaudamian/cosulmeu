// tests/price-quality-monitor.test.ts
// Teste automate pentru Price Quality Monitor & Price Freshness Score

import assert from 'node:assert';
import http from 'http';
import { PriceQualityMonitor } from '../src/indexing/PriceQualityMonitor.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { RetailerRegistry } from '../src/indexing/RetailerRegistry.ts';
import { app, ADMIN_API_KEY } from '../server.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import { ProductOffer, Product } from '../src/types.ts';

function pass(msg: string) {
  console.log(`✅ [PASS] ${msg}`);
}

async function runTests() {
  console.log('🧪 Rulare teste pentru PriceQualityMonitor & Price Freshness Score...');

  // Resetăm stocarea pentru determinism
  StorageService.resetAllData();

  // --- 1. Evaluare Price Freshness Score (4 Stări) ---
  console.log('\n--- 1. Evaluare Price Freshness Score (4 Stări & Vechime) ---');

  const now = new Date('2026-10-30T12:00:00Z');

  // 1.1 Foarte recent (0 - 24 ore)
  const freshObs1 = PriceQualityMonitor.calculateFreshness({
    observationDate: '2026-10-30T06:00:00Z', // 6 ore vechime
    now
  });
  assert.strictEqual(freshObs1.status, 'very_recent');
  assert.strictEqual(freshObs1.labelRo, 'Foarte recent');
  assert(freshObs1.score >= 80 && freshObs1.score <= 100, `Scorul trebuie să fie între 80 și 100 (obținut: ${freshObs1.score})`);
  pass('0-24 ore vechime este clasificat corect ca "very_recent" cu scor ridicat');

  // 1.2 Recent (24 - 48 ore)
  const freshObs2 = PriceQualityMonitor.calculateFreshness({
    observationDate: '2026-10-29T00:00:00Z', // 36 ore vechime
    now
  });
  assert.strictEqual(freshObs2.status, 'recent');
  assert.strictEqual(freshObs2.labelRo, 'Recent');
  assert(freshObs2.score >= 50 && freshObs2.score < 80, `Scorul trebuie să fie între 50 și 80 (obținut: ${freshObs2.score})`);
  pass('24-48 ore vechime este clasificat corect ca "recent"');

  // 1.3 Vechi (48 - 72 ore)
  const freshObs3 = PriceQualityMonitor.calculateFreshness({
    observationDate: '2026-10-27T18:00:00Z', // 66 ore vechime
    now
  });
  assert.strictEqual(freshObs3.status, 'stale');
  assert.strictEqual(freshObs3.labelRo, 'Vechi');
  assert(freshObs3.score >= 20 && freshObs3.score < 50, `Scorul trebuie să fie între 20 și 50 (obținut: ${freshObs3.score})`);
  pass('48-72 ore vechime este clasificat corect ca "stale"');

  // 1.4 Expirat (> 72 ore)
  const freshObs4 = PriceQualityMonitor.calculateFreshness({
    observationDate: '2026-10-25T00:00:00Z', // 132 ore vechime
    now
  });
  assert.strictEqual(freshObs4.status, 'expired');
  assert.strictEqual(freshObs4.labelRo, 'Neverificat / expirat');
  assert(freshObs4.score <= 20, `Scorul de prospețime pentru prețuri expirate este <= 20 (obținut: ${freshObs4.score})`);
  pass('>72 ore vechime este clasificat corect ca "expired"');

  // 1.5 Verificare limite exacte de frontieră (24.0h, 48.0h, 72.0h)
  const boundary24 = PriceQualityMonitor.calculateFreshness({
    observationDate: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
    now
  });
  assert.strictEqual(boundary24.status, 'very_recent', 'Exact 24.0h trebuie să fie very_recent');
  assert.strictEqual(boundary24.score, 80, 'La limita de 24h scorul este exact 80');

  const boundary24_1 = PriceQualityMonitor.calculateFreshness({
    observationDate: new Date(now.getTime() - 24.1 * 3600 * 1000).toISOString(),
    now
  });
  assert.strictEqual(boundary24_1.status, 'recent', 'La 24.1h trebuie să treacă în recent');

  const boundary48 = PriceQualityMonitor.calculateFreshness({
    observationDate: new Date(now.getTime() - 48 * 3600 * 1000).toISOString(),
    now
  });
  assert.strictEqual(boundary48.status, 'recent', 'Exact 48.0h trebuie să fie recent');
  assert.strictEqual(boundary48.score, 50, 'La limita de 48h scorul este exact 50');

  const boundary48_1 = PriceQualityMonitor.calculateFreshness({
    observationDate: new Date(now.getTime() - 48.1 * 3600 * 1000).toISOString(),
    now
  });
  assert.strictEqual(boundary48_1.status, 'stale', 'La 48.1h trebuie să treacă în stale');

  const boundary72 = PriceQualityMonitor.calculateFreshness({
    observationDate: new Date(now.getTime() - 72 * 3600 * 1000).toISOString(),
    now
  });
  assert.strictEqual(boundary72.status, 'stale', 'Exact 72.0h trebuie să fie stale');
  assert.strictEqual(boundary72.score, 20, 'La limita de 72h scorul este exact 20');

  const boundary72_1 = PriceQualityMonitor.calculateFreshness({
    observationDate: new Date(now.getTime() - 72.1 * 3600 * 1000).toISOString(),
    now
  });
  assert.strictEqual(boundary72_1.status, 'expired', 'Peste 72.0h trece în expired');
  pass('Frontierele de 24h, 48h și 72h sunt respectate matematic cu exactitate');

  // 1.6 Imunitate la erori de scraping (Scraping Failure Simulation)
  // Scenariu: Un colector rulează acum (lastCollectedAt = now), dar scraparea eșuează
  // și prețul nu a putut fi verificat (lastVerifiedAt/observationDate rămâne de acum 5 zile).
  const scrapeFailureObs = PriceQualityMonitor.calculateFreshness({
    observationDate: '2026-10-25T00:00:00Z', // 5 zile vechime
    lastCollectedAt: now.toISOString(), // Scraper a rulat acum dar a eșuat
    lastVerifiedAt: undefined,
    now
  });
  assert.strictEqual(scrapeFailureObs.status, 'expired', 'Scraping-ul eșuat nu trebuie să mascheze expirarea prețului');
  assert(scrapeFailureObs.score <= 20, 'Scorul rămâne degradat dacă prețul nu a fost verificat real');
  pass('Erorile de scraping nu resetează scorul de prospețime (lastCollectedAt ignorat fără verificare)');

  // 1.7 Gestionare date invalide sau nule
  const invalidDateObs = PriceQualityMonitor.calculateFreshness({
    observationDate: 'invalid-non-date-string',
    now
  });
  assert.strictEqual(invalidDateObs.status, 'expired');
  assert.strictEqual(invalidDateObs.score, 0);

  const nullDateObs = PriceQualityMonitor.calculateFreshness({
    observationDate: undefined,
    lastVerifiedAt: undefined,
    now
  });
  assert.strictEqual(nullDateObs.status, 'expired');
  assert.strictEqual(nullDateObs.score, 0);
  pass('Datele invalide sau lipsă returnează în siguranță "expired" cu scor 0');

  // --- 2. Evaluare Price Quality Score (0 - 100) ---
  console.log('\n--- 2. Evaluare Price Quality Score & Ponderi ---');

  const sampleProduct: Product = {
    id: 'prod-lapte-napolact',
    name: 'Lapte Napolact 3.5% 1L',
    brand: 'Napolact',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941014002341',
    baseReferencePrice: 6.99
  };

  const highQualityOffer: ProductOffer = {
    id: 'off-test-1',
    productId: sampleProduct.id,
    storeId: 'lidl',
    price: 6.49,
    unitPrice: 6.49,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    observationDate: '2026-10-30',
    source: 'official_feed',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-10-30T10:00:00Z'
  };

  const lidlCollector = RetailerRegistry.getRetailer('lidl');
  const qualityHigh = PriceQualityMonitor.calculateQualityScore(highQualityOffer, sampleProduct, lidlCollector, { now });
  assert(qualityHigh.overallScore >= 85, `Oferta de înaltă calitate trebuie să aibă scor >= 85 (obținut: ${qualityHigh.overallScore})`);
  assert.strictEqual(qualityHigh.isFlagged, false);
  pass('Oferta verificată oficial primește un Price Quality Score excelent (>= 85)');

  // Verificare că scorul de prospețime și calitatea sunt separate
  const staleButValidOffer: ProductOffer = {
    ...highQualityOffer,
    id: 'off-test-stale',
    observationDate: '2026-10-25',
    lastChecked: '2026-10-25T10:00:00Z'
  };
  const qualityStale = PriceQualityMonitor.calculateQualityScore(staleButValidOffer, sampleProduct, lidlCollector, { now });
  assert.strictEqual(qualityStale.freshnessStatus, 'expired');
  assert(qualityStale.freshnessScore <= 20);
  assert(qualityStale.overallScore < qualityHigh.overallScore, 'Scorul general scade din cauza prospețimii');
  assert(qualityStale.overallScore > qualityStale.freshnessScore, 'Scorul de calitate rămâne distinct de cel de prospețime');
  pass('Scorul de calitate și scorul de prospețime sunt calculate și păstrate separat');

  // --- 3. Detecție Anomalii & Avertizări Administrative ---
  console.log('\n--- 3. Detecție Anomalii de Preț & Reguli de Audit ---');

  // 3.1 Preț zero sau negativ
  const zeroPriceOffer: ProductOffer = { ...highQualityOffer, price: 0 };
  const checkZero = PriceQualityMonitor.checkOfferForAnomaly(zeroPriceOffer, sampleProduct);
  assert.strictEqual(checkZero.isAnomaly, true);
  assert.strictEqual(checkZero.type, 'zero_or_negative_price');
  pass('Prețul zero este detectat corect ca anomalie gravă');

  // 3.2 Preț neverosimil de mare (> 5000)
  const extremePriceOffer: ProductOffer = { ...highQualityOffer, price: 9999 };
  const checkExtreme = PriceQualityMonitor.checkOfferForAnomaly(extremePriceOffer, sampleProduct);
  assert.strictEqual(checkExtreme.isAnomaly, true);
  assert.strictEqual(checkExtreme.type, 'extreme_price_outlier');
  pass('Prețul extrem (> 5000 RON) este semnalat ca outlier');

  // 3.3 Creștere bruscă de preț (> 50%)
  const spikePriceOffer: ProductOffer = { ...highQualityOffer, price: 14.50 }; // reper: 6.99 -> +107%
  const checkSpike = PriceQualityMonitor.checkOfferForAnomaly(spikePriceOffer, sampleProduct);
  assert.strictEqual(checkSpike.isAnomaly, true);
  assert.strictEqual(checkSpike.type, 'sudden_price_spike');
  pass('Creșterea de preț de peste 50% este semnalată cu păstrarea datelor brute');

  // 3.4 Scădere suspectă (> 60%) fără promoție declarată
  const dropPriceOffer: ProductOffer = { ...highQualityOffer, price: 2.19, isPromo: false }; // reper: 6.99 -> -68%
  const checkDrop = PriceQualityMonitor.checkOfferForAnomaly(dropPriceOffer, sampleProduct);
  assert.strictEqual(checkDrop.isAnomaly, true);
  assert.strictEqual(checkDrop.type, 'unusual_price_drop');
  pass('Scăderea suspectă fără promoție este detectată ca anomalie');

  // 3.5 Card de fidelitate prezentat incorect
  const invalidCardOffer: ProductOffer = {
    ...highQualityOffer,
    loyaltyCardRequired: true,
    loyaltyCardName: undefined // lipsă card
  };
  const checkCard = PriceQualityMonitor.checkOfferForAnomaly(invalidCardOffer, sampleProduct);
  assert.strictEqual(checkCard.isAnomaly, true);
  assert.strictEqual(checkCard.type, 'mispresented_loyalty_price');
  pass('Prețul cu card fără specificarea numelui cardului este semnalat');

  // 3.6 Promoție expirată afișată ca activă
  const expiredPromoOffer: ProductOffer = {
    ...highQualityOffer,
    isPromo: true,
    validUntil: '2026-10-15' // trecut
  };
  const checkPromo = PriceQualityMonitor.checkOfferForAnomaly(expiredPromoOffer, sampleProduct);
  assert.strictEqual(checkPromo.isAnomaly, true);
  assert.strictEqual(checkPromo.type, 'expired_promotion_claimed');
  pass('Promoția expirată este semnalată automat');

  // --- 4. Monitorizare Individuală Retaileri ---
  console.log('\n--- 4. Monitorizare Individuală Retaileri & Stări Tehnice ---');

  const retailerMetrics = PriceQualityMonitor.getRetailerQualityMetrics();
  assert.strictEqual(retailerMetrics.length, 8, 'Trebuie să monitorizeze toți cei 8 retaileri');

  const penny = retailerMetrics.find(r => r.retailerId === 'penny');
  assert.ok(penny, 'Penny trebuie să fie prezent în monitor');
  assert.strictEqual(penny.status, 'DISABLED', 'Penny fără acreditare verificată trebuie să fie DISABLED');

  const kaufland = retailerMetrics.find(r => r.retailerId === 'kaufland');
  assert.ok(kaufland, 'Kaufland trebuie să fie prezent în monitor');
  assert.strictEqual(kaufland.status, 'WAITING_FOR_AUTHORIZATION');

  pass('Toți cei 8 retaileri sunt evaluați strict și sursele neconfirmate nu devin ACTIVE în mod eronat');

  // --- 5. Coada de Sarcini pentru Reverificare & Recolectare Prioritară ---
  console.log('\n--- 5. Coada de Recolectare Prioritară & Execuție Lot ---');

  // Inserăm o ofertă veche pentru a genera sarcină de prioritate 1
  StorageService.addOrUpdateOffers([{
    id: 'off-expired-test',
    productId: 'prod-lapte-1l',
    storeId: 'lidl',
    price: 6.49,
    unitPrice: 6.49,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    observationDate: '2026-10-20',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-10-20T10:00:00Z'
  }]);

  const tasks = PriceQualityMonitor.generateRecollectionTasks();
  assert(tasks.length > 0, 'Trebuie să genereze sarcini în coada de recolectare');
  assert.strictEqual(tasks[0].priority, 1, 'Sarcinile cu preț expirat trebuie să aibă prioritatea maximă (1)');
  pass('Coada de recolectare prioritizează corect prețurile expirate');

  const runResult = await PriceQualityMonitor.runRecollectionBatch(2);
  assert(runResult.processedCount > 0, 'Lotul de recolectare trebuie să proceseze sarcinile');
  pass('Lotul de recolectare rulează controlat cu rate limiting');

  // --- 6. Raport Zilnic Automat de Calitate ---
  console.log('\n--- 6. Generare Raport Zilnic Automat de Calitate ---');

  const dailyReport = PriceQualityMonitor.generateDailyReport('2026-10-30');
  assert.strictEqual(dailyReport.reportDate, '2026-10-30');
  assert(dailyReport.totalTrackedProducts > 0);
  assert(typeof dailyReport.overallAverageQualityScore === 'number');
  assert(typeof dailyReport.overallAverageFreshnessScore === 'number');
  assert.ok(dailyReport.freshnessDistribution);
  assert.ok(dailyReport.retailersBreakdown);
  pass('Raportul zilnic include toate metricele agregate și defalcarea pe retailer');

  // --- 7. Endpoint-uri HTTP Backend ---
  console.log('\n--- 7. Verificare Endpoint-uri HTTP Administrative ---');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as any;
  const port = addr.port;

  try {
    // GET /api/quality/overview
    const overRes = await fetch(`http://localhost:${port}/api/quality/overview`);
    assert.strictEqual(overRes.status, 200);
    const overData = await overRes.json();
    assert.strictEqual(overData.success, true);
    assert.ok(overData.overview.retailersMetrics.length === 8);
    pass('GET /api/quality/overview returnează 200 OK cu datele celor 8 retaileri');

    // GET /api/quality/retailers
    const retRes = await fetch(`http://localhost:${port}/api/quality/retailers`);
    assert.strictEqual(retRes.status, 200);
    const retData = await retRes.json();
    assert.strictEqual(retData.success, true);
    assert.strictEqual(retData.retailers.length, 8);
    pass('GET /api/quality/retailers returnează toți cei 8 retaileri cu indicatori');

    // GET /api/quality/anomalies
    const anomRes = await fetch(`http://localhost:${port}/api/quality/anomalies`);
    assert.strictEqual(anomRes.status, 200);
    const anomData = await anomRes.json();
    assert.strictEqual(anomData.success, true);
    assert.ok(Array.isArray(anomData.anomalies));
    pass('GET /api/quality/anomalies returnează alertele de anomalii');

    // POST /api/quality/reports/generate (cu auth)
    const repRes = await fetch(`http://localhost:${port}/api/quality/reports/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({ date: '2026-10-30' })
    });
    assert.strictEqual(repRes.status, 200);
    const repData = await repRes.json();
    assert.strictEqual(repData.success, true);
    assert.strictEqual(repData.report.reportDate, '2026-10-30');
    pass('POST /api/quality/reports/generate generează și salvează raportul zilnic');

    // POST /api/quality/config (cu auth)
    const cfgRes = await fetch(`http://localhost:${port}/api/quality/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        thresholds: { veryRecentHours: 20, recentHours: 40, staleHours: 60 }
      })
    });
    assert.strictEqual(cfgRes.status, 200);
    const cfgData = await cfgRes.json();
    assert.strictEqual(cfgData.success, true);
    assert.strictEqual(cfgData.config.thresholds.veryRecentHours, 20);
    pass('POST /api/quality/config permite ajustarea pragurilor de prospețime');

    // POST /api/quality/config (validare praguri incorecte -> 400 Bad Request)
    const invalidCfgRes = await fetch(`http://localhost:${port}/api/quality/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        thresholds: { veryRecentHours: 50, recentHours: 20, staleHours: 10 } // incorect: recent < veryRecent
      })
    });
    assert.strictEqual(invalidCfgRes.status, 400);
    pass('POST /api/quality/config respinge configurările invalide cu 400 Bad Request');

    // Inserare anomalie de test și testare POST /api/quality/anomalies/:id/resolve
    const testAnomalyId = 'anom-test-resolve-1';
    StorageService.addQualityAnomaly({
      id: testAnomalyId,
      productId: 'prod-lapte-1l',
      productName: 'Lapte Proaspăt 1L',
      retailerId: 'lidl',
      anomalyType: 'sudden_price_spike',
      severity: 'high',
      currentPrice: 15.99,
      baselinePrice: 6.99,
      deviationPercentage: 128.75,
      details: 'Spike de preț test',
      status: 'pending_review',
      detectedAt: new Date().toISOString()
    });

    // Rezolvare fără auth -> 401
    const unauthResolveRes = await fetch(`http://localhost:${port}/api/quality/anomalies/${testAnomalyId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'resolved_approved' })
    });
    assert.strictEqual(unauthResolveRes.status, 401);
    pass('POST /api/quality/anomalies/:id/resolve respinge cererile fără token cu 401');

    // Rezolvare cu rezoluție invalidă -> 400
    const badResRes = await fetch(`http://localhost:${port}/api/quality/anomalies/${testAnomalyId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({ resolution: 'invalid_status' })
    });
    assert.strictEqual(badResRes.status, 400);
    pass('POST /api/quality/anomalies/:id/resolve validează strict statusul rezoluției (400 la date invalide)');

    // Rezolvare cu succes -> 200
    const resolveRes = await fetch(`http://localhost:${port}/api/quality/anomalies/${testAnomalyId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({ resolution: 'resolved_approved' })
    });
    assert.strictEqual(resolveRes.status, 200);
    const resolveData = await resolveRes.json();
    assert.strictEqual(resolveData.success, true);
    const updatedAnomaly = StorageService.getQualityAnomalies().find(a => a.id === testAnomalyId);
    assert.strictEqual(updatedAnomaly?.status, 'resolved_approved');
    pass('POST /api/quality/anomalies/:id/resolve soluționează anomalia și actualizează starea');

    // Verificare protecție auth: refuz fără token
    const unauthRes = await fetch(`http://localhost:${port}/api/quality/reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(unauthRes.status, 401);
    pass('Rutele administrative /api/quality sunt protejate cu token Bearer');
  } finally {
    server.close();
    IndexerScheduler.stop();
  }

  console.log('🎉 Toate testele pentru PriceQualityMonitor & Freshness Score au rulat cu succes!\n');
}

runTests().then(() => {
  IndexerScheduler.stop();
  process.exit(0);
}).catch(err => {
  console.error('❌ Eșec test PriceQualityMonitor:', err);
  process.exit(1);
});
