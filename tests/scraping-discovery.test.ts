// tests/scraping-discovery.test.ts
// Teste automate pentru ScrapingEngine, PriceIndexer, PromotionIndexer, IndexingMonitor și Descoperirea din Bonuri

import assert from 'node:assert';
import { ScrapingEngine } from '../src/scraping/ScrapingEngine.ts';
import { PriceIndexer } from '../src/indexing/PriceIndexer.ts';
import { PromotionIndexer } from '../src/indexing/PromotionIndexer.ts';
import { IndexingMonitor } from '../src/indexing/IndexingMonitor.ts';
import { CollectionWorker } from '../src/services/CollectionWorker.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { app, ADMIN_API_KEY } from '../server.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import { ProductOffer } from '../src/types.ts';
import http from 'http';

function pass(msg: string) {
  console.log(`✅ [PASS] ${msg}`);
}

async function runTests() {
  console.log('🧪 Rulare teste pentru ScrapingEngine & Descoperire Bonuri...');

  // Curățăm stocarea pentru determinism
  StorageService.resetAllData();

  // --- 1. ScrapingEngine: Parsare Cheerio & Selectoare Românești ---
  console.log('\n--- 1. ScrapingEngine: Parsare Statică Cheerio & Date Structurate ---');

  const sampleSupermarketHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="product-item" data-ean="5941014002341">
          <h3 class="product-name">Lapte Integral 3.5% 1L Napolact</h3>
          <span class="brand">Napolact</span>
          <span class="old-price">7,99 Lei</span>
          <span class="current-price">6,49 Lei</span>
          <span class="badge">-18% Reducere</span>
        </div>
        <div class="product-item" data-sku="kauf-card-102">
          <h3 class="product-name">Iaurt Grecesc 10% 400g Olympus</h3>
          <span class="current-price">5,89 Lei</span>
          <span class="loyalty-price">4,99 Lei</span>
          <span class="badge">Cu Kaufland Card</span>
        </div>
      </body>
    </html>
  `;

  const parsedItems = ScrapingEngine.parseStaticHtml(sampleSupermarketHtml, 'kaufland', 'https://kaufland.ro/oferte');
  assert.strictEqual(parsedItems.length, 2, 'Trebuie să extragă 2 produse din HTML');
  pass('Cheerio a extras corect 2 produse din HTML');

  const lapte = parsedItems[0];
  assert.strictEqual(lapte.rawName, 'Lapte Integral 3.5% 1L Napolact');
  assert.strictEqual(lapte.brand, 'Napolact');
  assert.strictEqual(lapte.barcode, '5941014002341');
  assert.strictEqual(lapte.normalPrice, 7.99);
  assert.strictEqual(lapte.promoPrice, 6.49);
  assert.strictEqual(lapte.packageWeightOrVolume, 1);
  assert.strictEqual(lapte.packageUnit, 'l');
  pass('Denumirea, brandul, codul EAN, prețul vechi și cel promoțional au fost extrase corect');

  const iaurt = parsedItems[1];
  assert.strictEqual(iaurt.normalPrice, 5.89);
  assert.strictEqual(iaurt.loyaltyPrice, 4.99);
  assert.strictEqual(iaurt.packageWeightOrVolume, 400);
  assert.strictEqual(iaurt.packageUnit, 'g');
  pass('Prețul special cu card de fidelitate și gramajul în grame au fost normalizate corect');

  // --- 2. ScrapingEngine: Parsare JSON-LD (Schema.org / Product) ---
  console.log('\n--- 2. ScrapingEngine: Parsare JSON-LD ---');

  const jsonLdHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Paine toast integrala 500g Vel Pitar",
            "brand": { "@type": "Brand", "name": "Vel Pitar" },
            "gtin13": "5941033001091",
            "offers": {
              "@type": "Offer",
              "price": "4.89",
              "priceCurrency": "RON"
            }
          }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const jsonLdItems = ScrapingEngine.parseStaticHtml(jsonLdHtml, 'carrefour');
  assert.strictEqual(jsonLdItems.length, 1);
  assert.strictEqual(jsonLdItems[0].rawName, 'Paine toast integrala 500g Vel Pitar');
  assert.strictEqual(jsonLdItems[0].normalPrice, 4.89);
  assert.strictEqual(jsonLdItems[0].barcode, '5941033001091');
  pass('Extragerea datelor structurate JSON-LD (Schema.org) funcționează ireproșabil');

  // --- 3. PriceIndexer: Detecție Anomalii & Garanție Append-Only ---
  console.log('\n--- 3. PriceIndexer: Detecție Anomalii & Append-Only ---');

  const normalCheck = PriceIndexer.isPriceAnomaly(6.49, 6.29);
  assert.strictEqual(normalCheck.isAnomaly, false);
  pass('Variația normală de preț (3%) este acceptată');

  const spikeCheck = PriceIndexer.isPriceAnomaly(18.99, 6.49);
  assert.strictEqual(spikeCheck.isAnomaly, true);
  assert.ok(spikeCheck.reason?.includes('Variație suspectă'));
  pass('Creșterea bruscă suspectă (>50%) este semnalată ca anomalie');

  const zeroCheck = PriceIndexer.isPriceAnomaly(0);
  assert.strictEqual(zeroCheck.isAnomaly, true);
  pass('Prețul 0 sau negativ este respins');

  const initialObsCount = StorageService.getPriceObservations().length;
  const mockOffer: ProductOffer = {
    id: 'off-test-lapte-lidl',
    productId: 'prod-lapte-1',
    storeId: 'lidl',
    price: 6.49,
    normalPrice: 6.49,
    unitPrice: 6.49,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    observationDate: '2026-10-30',
    source: 'official_feed',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2026-10-30'
  };

  const indexResult = await PriceIndexer.indexPrices([mockOffer]);
  assert.strictEqual(indexResult.acceptedOffersCount, 1);
  assert.strictEqual(indexResult.anomaliesDetectedCount, 0);
  const newObsCount = StorageService.getPriceObservations().length;
  assert.strictEqual(newObsCount, initialObsCount + 1, 'Observația trebuie adăugată append-only în istoric');
  pass('PriceIndexer a salvat oferta și a înregistrat observația istorică în mod append-only');

  // --- 4. PromotionIndexer: Indexare & Asociere Catalog ---
  console.log('\n--- 4. PromotionIndexer: Validare & Asociere Catalog ---');

  const extractedPromos = ScrapingEngine.extractPromotions(sampleSupermarketHtml, 'kaufland');
  assert.strictEqual(extractedPromos.length, 2);
  pass('ScrapingEngine a extras 2 promoții active din HTML');

  const promoIndexRes = await PromotionIndexer.indexPromotions(extractedPromos);
  assert.strictEqual(promoIndexRes.promotionsIndexedCount, 2);
  assert.ok(promoIndexRes.matchedToCatalogCount >= 1, 'Cel puțin o promoție trebuie asociată catalogului de produse');
  pass('PromotionIndexer a asociat automat produsele din promoții cu catalogul de referință');

  const discountPercent = PromotionIndexer.calculateDiscountPercentage(10.0, 7.5);
  assert.strictEqual(discountPercent, 25);
  pass('Calculul procentual al reducerii este corect (25%)');

  // --- 5. Descoperire Produse de pe Bonuri (Receipt Discovery Loop) ---
  console.log('\n--- 5. Descoperire Țintită din Bonuri Fiscale ---');

  StorageService.addReceiptProducts([
    {
      id: 'rec-item-test-1',
      rawName: 'LAPTE NAPOLACT 1.5% 1L',
      extractedPrice: 6.49,
      extractedQuantity: 2,
      category: 'Lactate și ouă',
      targetSearchStatus: 'pending',
      searchAttempts: 0,
      createdAt: new Date().toISOString()
    }
  ]);

  const pendingBefore = StorageService.getReceiptProducts().filter(p => p.targetSearchStatus === 'pending');
  assert.strictEqual(pendingBefore.length, 1);
  pass('Produsul de pe bon a fost adăugat în coada de descoperire ca pending');

  const discoveryRes = await CollectionWorker.discoverPendingReceiptProducts({ dryRun: false, maxItems: 5 });
  assert.strictEqual(discoveryRes.processedCount, 1);
  pass('CollectionWorker a procesat produsul candidat de pe bon');

  // --- 6. IndexingMonitor: Telemetrie & Agregare ---
  console.log('\n--- 6. IndexingMonitor: Telemetrie Live ---');

  const stats = IndexingMonitor.getStats();
  assert.strictEqual(stats.totalRetailersCount, 8);
  assert.ok(stats.totalOffersCount > 0);
  assert.ok(stats.totalObservationsCount > 0);
  assert.strictEqual(stats.systemHealth, 'healthy');
  pass('IndexingMonitor agregă corect statisticile live pentru cei 8 retaileri');

  // --- 7. Endpoint-uri HTTP Backend ---
  console.log('\n--- 7. Endpoint-uri HTTP Backend ---');

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    // GET /api/indexing/monitor
    const monRes = await fetch(`http://localhost:${port}/api/indexing/monitor`);
    assert.strictEqual(monRes.status, 200);
    const monData = await monRes.json();
    assert.strictEqual(monData.success, true);
    assert.strictEqual(monData.stats.totalRetailersCount, 8);
    pass('GET /api/indexing/monitor returnează 200 OK și include 8 retaileri');

    // GET /api/indexing/receipt-candidates
    const candRes = await fetch(`http://localhost:${port}/api/indexing/receipt-candidates`);
    assert.strictEqual(candRes.status, 200);
    const candData = await candRes.json();
    assert.strictEqual(candData.success, true);
    assert.ok(Array.isArray(candData.candidates));
    pass('GET /api/indexing/receipt-candidates returnează lista candidaților de pe bonuri');

    // POST /api/indexing/schedule/config
    const cfgRes = await fetch(`http://localhost:${port}/api/indexing/schedule/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        targetHour: 5,
        targetMinute: 30,
        timezone: 'Europe/Bucharest'
      })
    });
    assert.strictEqual(cfgRes.status, 200);
    const cfgData = await cfgRes.json();
    assert.strictEqual(cfgData.success, true);
    assert.strictEqual(cfgData.status.targetHour, 5);
    assert.strictEqual(cfgData.status.targetMinute, 30);
    pass('POST /api/indexing/schedule/config actualizează ora și minutul programate');

    // GET /api/indexing/promotions
    const promoRes = await fetch(`http://localhost:${port}/api/indexing/promotions`);
    assert.strictEqual(promoRes.status, 200);
    const promoData = await promoRes.json();
    assert.strictEqual(promoData.success, true);
    assert.ok(Array.isArray(promoData.promotions));
    pass('GET /api/indexing/promotions returnează promoțiile indexate');
  } finally {
    server.close();
    IndexerScheduler.stop();
  }

  console.log('🎉 Toate testele pentru ScrapingEngine & Descoperire Bonuri au rulat cu succes!\n');
}

runTests().then(() => {
  IndexerScheduler.stop();
  process.exit(0);
}).catch(err => {
  console.error('❌ Eșec test:', err);
  process.exit(1);
});
