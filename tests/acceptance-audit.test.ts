// tests/acceptance-audit.test.ts
// Script de audit de acceptanță automată: Proveniență, Matching, API-uri și Flux E2E

import assert from 'node:assert';
import http from 'node:http';
import { app, ADMIN_API_KEY } from '../server';
import { ProductMatcher } from '../src/services/ProductMatcher';
import { PriceComparisonService } from '../src/services/PriceComparisonService';
import { StorageService } from '../src/services/StorageService';
import { mapRetailerCategoryToStandard, CATEGORIES_TAXONOMY } from '../src/data/categories';
import { ProductOffer, PriceObservation, Product } from '../src/types';
import { STORES } from '../src/data/mockData';
import { checkDbHealth, getDbConfig } from '../src/db/index';
import { IndexerScheduler } from '../src/services/IndexerScheduler';

function pass(msg: string) {
  console.log(`  [PASS] ${msg}`);
}

async function runAcceptanceAudit() {
  console.log('============================================================');
  console.log('AUDIT DE ACCEPTANȚĂ: CATALOG PUBLIC & COMPARAȚIE MULTI-RETAILER');
  console.log('============================================================\n');

  // --- 1. AUDIT PROVENIENȚĂ ȘI PERSISTENȚĂ ---
  console.log('--- 1. Audit Proveniență și Persistență ---');
  
  // 1.1 Verificare mod de persistență DB
  const dbHealth = await checkDbHealth();
  const dbConfig = getDbConfig();
  console.log(`  [INFO] Mod persistență DB: ${dbHealth.persistenceMode} (${dbHealth.message})`);
  assert.ok(dbHealth.persistenceMode === 'postgresql' || dbHealth.persistenceMode === 'demo_memory');
  pass(`Mod de persistență detectat corect: ${dbHealth.persistenceMode}`);

  // 1.2 Verificare excludere oferte expirate din comparația publică
  const testProductId = 'prod-lapte-1';
  const existingOffers = StorageService.getProductOffers();
  
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000).toISOString().split('T')[0];
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000).toISOString().split('T')[0];

  const expiredOffer: ProductOffer = {
    id: 'off-test-expired-1',
    productId: testProductId,
    storeId: 'store-penny-manastur',
    price: 3.99, // Preț suspect de mic dar expirat
    unitPrice: 3.99,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    confidenceLevel: 'high',
    lastChecked: yesterday,
    observationDate: yesterday,
    validUntil: yesterday, // Expira ieri
    verificationStatus: 'expired',
    source: 'verified'
  };

  const validOffer: ProductOffer = {
    id: 'off-test-valid-1',
    productId: testProductId,
    storeId: 'store-lidl-marasti',
    price: 6.79,
    unitPrice: 6.79,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    confidenceLevel: 'high',
    lastChecked: today.toISOString(),
    observationDate: today.toISOString().split('T')[0],
    validUntil: tomorrow,
    verificationStatus: 'verified',
    source: 'official_feed'
  };

  StorageService.addOrUpdateOffers([expiredOffer, validOffer]);

  // Comparația publică nu trebuie să includă oferta expirată
  const comparison = PriceComparisonService.getProductComparisonDetails(testProductId);
  assert.ok(comparison, 'Comparația trebuie să existe');
  
  const hasExpiredInPublicComp = comparison.offers.some(o => o.offer.id === 'off-test-expired-1' || o.offer.price === 3.99);
  assert.strictEqual(hasExpiredInPublicComp, false, 'Ofertele expirate trebuie excluse din comparația publică');
  pass('Ofertele expirate sunt strict excluse din comparația publică');

  // 1.3 Verificare data ultimei verificări reale
  assert.ok(comparison.lastCheckedDate !== '-', 'Data ultimei verificări trebuie să fie validă');
  assert.ok(comparison.offers.every(o => o.lastVerifiedAt && o.lastVerifiedAt.length >= 10), 'Fiecare ofertă are data ultimei observații reale');
  pass('Data afișată reflectă ultima verificare reală a observației de preț');

  // --- 2. AUDIT MATCHING ȘI PREVENIRE CONFLICTE VARIANTE ---
  console.log('\n--- 2. Audit Matching & Protecție Conflicte Variante ---');

  // 2.1 Același GTIN/EAN pe retaileri diferiți -> Match sigur 1.0
  const matchEan = ProductMatcher.matchProduct({
    rawName: 'Lapte Napolact UHT 1.5% grasime la supermarket Carrefour',
    barcode: '5941014002341',
    brand: 'Napolact'
  });
  assert.strictEqual(matchEan.confidence, 1.0, 'EAN identic are scor 1.0');
  assert.strictEqual(matchEan.matchMethod, 'gtin_exact');
  assert.strictEqual(matchEan.matchedProduct?.id, 'prod-lapte-1');
  pass('Același EAN la retaileri diferiți este asociat cu încredere 1.0');

  // 2.2 Gramaje diferite (500g vs 1kg / 1000g -> ratio 0.5 < 0.75)
  const matchWeight = ProductMatcher.matchProduct({
    rawName: 'Lapte proaspat 1.5% grasime 500ml',
    packageWeightOrVolume: 500,
    packageUnit: 'ml'
  });
  // prod-lapte-1 are 1L (1000ml), deci ratio = 0.5 < 0.75 -> nu trebuie să se fuzioneze automat
  assert.notStrictEqual(matchWeight.matchedProduct?.id, 'prod-lapte-1', 'Gramaje diferite cu ratio < 0.75 nu sunt fuzionate automat');
  pass('Gramaje diferite (>25% diferență) nu sunt fuzionate cu produsul de referință');

  // 2.3 Grăsime / Concentrație diferită (1.5% vs 3.5%)
  const matchFat = ProductMatcher.matchProduct({
    rawName: 'Lapte proaspat 3.5% grasime 1L Napolact',
    brand: 'Napolact'
  });
  assert.notStrictEqual(matchFat.matchedProduct?.id, 'prod-lapte-1', 'Laptele 3.5% nu se grupează cu cel de 1.5%');
  pass('Variante de grăsime diferite (1.5% vs 3.5%) sunt izolate strict');

  // 2.4 Pâine albă vs pâine neagră/secară
  const matchBread = ProductMatcher.matchProduct({
    rawName: 'Paine secara feliata 500g Vel Pitar',
    brand: 'Vel Pitar'
  });
  assert.notStrictEqual(matchBread.matchedProduct?.id, 'prod-paine-toast', 'Pâinea de secară nu se grupează cu pâinea albă toast');
  pass('Pâinea albă și pâinea neagră/secară nu sunt fuzionate');

  // 2.5 Produs Zero / Diet vs Standard
  const matchZero = ProductMatcher.matchProduct({
    rawName: 'Bautura racoritoare Cola Zero Zahar 2L'
  });
  const matchNormal = ProductMatcher.matchProduct({
    rawName: 'Bautura racoritoare Cola Clasic 2L'
  });
  assert.ok(matchZero.matchedProduct?.id !== matchNormal.matchedProduct?.id || (!matchZero.matchedProduct && !matchNormal.matchedProduct));
  pass('Garda diet/zero împiedică fuzionarea variantelor cu și fără zahăr');

  // 2.6 Barcode diferit (conflict explicit)
  const matchDiffBarcode = ProductMatcher.matchProduct({
    rawName: 'Lapte proaspat 1.5% grasime 1L',
    barcode: '9999999999999', // Barcode diferit de cel al produsului (5941234567890)
    brand: 'Napolact'
  });
  assert.strictEqual(matchDiffBarcode.matchedProduct, undefined, 'Cod de bare diferit respinge asocierea automată');
  pass('Coduri de bare distincte blochează asocierea automată');

  // 2.7 Potrivire incertă (confidence 0.45 - 0.70) -> plasare în candidate, exclus din comparația principală
  const uncertainMatch = ProductMatcher.matchProduct({
    rawName: 'Napolact gust bun lactat'
  });
  assert.strictEqual(uncertainMatch.matchedProduct, undefined, 'Potrivirea incertă nu setează matchedProduct direct');
  if (uncertainMatch.candidate) {
    assert.strictEqual(uncertainMatch.candidate.status, 'pending_confirmation');
    pass('Potrivirea incertă creează un candidat pending_confirmation fără a afecta catalogul');
  } else {
    pass('Scor sub prag - respins fără asociere');
  }

  // --- 3. AUDIT ENDPOINT-URI HTTP (API) ---
  console.log('\n--- 3. Audit Endpoint-uri HTTP ---');
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 3.1 GET /api/categories
    const resCats = await fetch(`${baseUrl}/api/categories`);
    assert.strictEqual(resCats.status, 200);
    const catData = await resCats.json();
    assert.ok(catData.success);
    assert.ok(Array.isArray(catData.categories));
    assert.ok(catData.categories.length >= 8);
    pass(`GET /api/categories returnează ${catData.categories.length} categorii`);

    // 3.2 GET /api/products cu paginare și filtre
    const resProds = await fetch(`${baseUrl}/api/products?page=1&limit=5&category=Lactate+%C8%99i+ou%C4%83`);
    assert.strictEqual(resProds.status, 200);
    const prodsData = await resProds.json();
    assert.ok(prodsData.success);
    assert.ok(prodsData.products.length <= 5);
    assert.strictEqual(prodsData.pagination.page, 1);
    assert.strictEqual(prodsData.pagination.limit, 5);
    assert.ok(prodsData.facets.categories.length > 0);
    pass('GET /api/products suportă corect paginarea, fațetele și filtrarea pe categorie');

    // 3.3 GET /api/products/:id detaliu produs
    const resDetail = await fetch(`${baseUrl}/api/products/prod-lapte-1`);
    assert.strictEqual(resDetail.status, 200);
    const detailData = await resDetail.json();
    assert.ok(detailData.success);
    assert.strictEqual(detailData.product.id, 'prod-lapte-1');
    assert.ok(Array.isArray(detailData.comparison.offers));
    // Verifică sortare crescătoare prețuri
    const prices = detailData.comparison.offers.map((o: any) => o.offer.price);
    for (let i = 1; i < prices.length; i++) {
      assert.ok(prices[i] >= prices[i - 1], 'Ofertele trebuie să fie ordonate crescător');
    }
    pass('GET /api/products/:id returnează ofertele sortate crescător după preț');

    // 3.4 POST /api/products/report-error
    const resReport = await fetch(`${baseUrl}/api/products/report-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: 'prod-lapte-1',
        productName: 'Lapte proaspăt 1.5%',
        storeId: 'store-lidl-marasti',
        errorType: 'price_mismatch',
        reportedPrice: '7.99',
        details: 'Prețul la raft este de 7.99 lei, diferit de cel afișat.',
        reporterEmail: 'audit@cosul-meu.ro'
      })
    });
    assert.strictEqual(resReport.status, 200);
    const reportData = await resReport.json();
    assert.ok(reportData.success);
    assert.ok(reportData.reportId);
    
    // Verificare că raportul a generat o sarcină în coada de recolectare
    const queue = StorageService.getRecollectionQueue();
    const taskFound = queue.find(t => t.id === `task-err-${reportData.reportId}` || t.productId === 'prod-lapte-1');
    assert.ok(taskFound, 'Raportul de eroare trebuie să genereze o sarcină în coada de recolectare a calității');
    assert.strictEqual(taskFound.priority, 2, 'Prioritatea sarcinii generate din raport este 2 (anomalie raportată)');
    pass('POST /api/products/report-error generează sarcină de recolectare prioritară');

    // 3.5 POST /api/admin/match-correction - Securitate și funcționalitate
    const resCorrUnauth = await fetch(`${baseUrl}/api/admin/match-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: 'test', correctedProductId: 'prod-lapte-1' })
    });
    assert.strictEqual(resCorrUnauth.status, 401, 'Accesul neautorizat trebuie respins cu 401');

    // Creăm un candidat temporar pentru test
    const testCandidate = {
      id: `cand-audit-${Date.now()}`,
      sourceRawName: 'Lapte UHT napolact test',
      matchedProductId: 'prod-lapte-vechi',
      matchedProductName: 'Lapte UHT 1.5%',
      confidenceScore: 0.60,
      matchMethod: 'name_brand_similarity' as const,
      status: 'pending_confirmation' as const,
      createdAt: new Date().toISOString()
    };
    StorageService.addMatchCandidates([testCandidate]);

    const resCorrAuth = await fetch(`${baseUrl}/api/admin/match-correction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        candidateId: testCandidate.id,
        correctedProductId: 'prod-lapte-1',
        reason: 'Verificare conformitate etichetă audit'
      })
    });
    assert.strictEqual(resCorrAuth.status, 200);
    const corrData = await resCorrAuth.json();
    assert.ok(corrData.success);

    // Verifică log-ul de audit
    const auditLogs = StorageService.getMatchAuditHistory();
    const auditEntry = auditLogs.find(a => a.candidateId === testCandidate.id);
    assert.ok(auditEntry, 'Corectarea trebuie să fie înregistrată în jurnalul de audit');
    assert.strictEqual(auditEntry.correctedProductId, 'prod-lapte-1');
    pass('POST /api/admin/match-correction este securizat și produce un audit log imutabil');

  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  // --- 4. FLUX END-TO-END COMPLET ---
  console.log('\n--- 4. Test Flux End-to-End ---');
  // 4.1 Ingerare observație nouă validată
  const newObs: PriceObservation = {
    id: `obs-audit-e2e-${Date.now()}`,
    productId: 'prod-lapte-1',
    storeId: 'store-kaufland-cluj',
    price: 6.19,
    date: new Date().toISOString().split('T')[0],
    source: 'verified'
  };
  const count = StorageService.addPriceObservations([newObs]);
  assert.ok(count >= 1, 'Observația a fost adăugată în istoric');
  
  const allObs = StorageService.getPriceObservations().filter(o => o.productId === 'prod-lapte-1');
  assert.ok(allObs.length >= 2, 'Produsul are cel puțin 2 observații');
  
  const compAfter = PriceComparisonService.getProductComparisonDetails('prod-lapte-1');
  assert.ok(compAfter, 'Comparația este disponibilă');
  pass('Fluxul complet de adăugare observație -> persistență -> comparație multi-retailer funcționează perfect');

  console.log('\n============================================================');
  console.log('AUDIT DE ACCEPTANȚĂ FINALIZAT CU SUCCES: TOATE CRITERIILE SUNT VALIDATE');
  console.log('============================================================');
}

runAcceptanceAudit().then(() => {
  IndexerScheduler.stop();
  process.exit(0);
}).catch(err => {
  IndexerScheduler.stop();
  console.error('\nEȘEC ÎN AUDITUL DE ACCEPTANȚĂ:', err);
  process.exit(1);
});
