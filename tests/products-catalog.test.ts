// tests/products-catalog.test.ts
// Teste automate pentru Catalogul Public de Produse & Comparația Multi-Retailer

import assert from 'node:assert';
import http from 'http';
import { app, ADMIN_API_KEY } from '../server.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { ProductMatcher } from '../src/services/ProductMatcher.ts';
import { CATEGORIES_TAXONOMY, mapRetailerCategoryToStandard } from '../src/data/categories.ts';
import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';

function pass(msg: string) {
  console.log(`✅ [PASS] ${msg}`);
}

async function runTests() {
  console.log('🧪 Rulare teste pentru Catalogul Public de Produse & Comparația Multi-Retailer...');

  StorageService.resetAllData();

  // --- 1. Taxonomie Categorii & Mapare Automată ---
  console.log('\n--- 1. Taxonomie Categorii & Mapare Automată ---');
  assert(CATEGORIES_TAXONOMY.length >= 8, 'Trebuie să existe cel puțin 8 categorii în taxonomie');

  const mappedDairy = mapRetailerCategoryToStandard('Lapte proaspat 1.5% grăsime');
  assert.strictEqual(mappedDairy.category, 'Lactate și ouă');
  pass('Maparea automată identifică categoria "Lactate și ouă" pe baza denumirii');

  const mappedBakery = mapRetailerCategoryToStandard('Pâine albă feliată Toast');
  assert.strictEqual(mappedBakery.category, 'Panificație');
  pass('Maparea automată identifică categoria "Panificație"');

  const mappedFallback = mapRetailerCategoryToStandard('Obiect necunoscut 123');
  assert.strictEqual(mappedFallback.category, 'Alte produse');
  pass('Elementele necunoscute primesc fallback pe "Alte produse"');

  // --- 2. Matching Îmbunătățit & Prevenire Grupări Incorecte ---
  console.log('\n--- 2. Matching Îmbunătățit & Prevenire Grupări Incorecte ---');

  // 2.1 Conflicte de procentaj grăsime (ex: Lapte 1.5% vs Lapte 3.5%)
  const matchConflictPct = ProductMatcher.matchProduct({
    rawName: 'Lapte Napolact 3.5% 1L',
    brand: 'Napolact'
  });
  // În catalog avem doar lapte 1.5%
  assert(
    !matchConflictPct.matchedProduct || matchConflictPct.matchedProduct.id !== 'prod-lapte-1',
    'Laptele de 3.5% NU trebuie să se grupeze automat cu cel de 1.5%'
  );
  pass('Garda de variantă împiedică gruparea greșită a produselor cu concentrații/grăsimi diferite');

  // 2.2 Conflicte de tip pâine (albă vs neagră)
  const matchBreadConflict = ProductMatcher.matchProduct({
    rawName: 'Pâine neagră Toast 500g',
    brand: 'Vel Pitar'
  });
  assert(
    !matchBreadConflict.matchedProduct || matchBreadConflict.matchedProduct.id !== 'prod-paine-toast',
    'Pâinea neagră NU trebuie să se grupeze cu pâinea albă'
  );
  pass('Garda de variantă împiedică gruparea pâinii albe cu pâinea neagră/secară');

  // 2.3 Gramaj diferit considerabil (500g vs 1kg)
  const matchWeightConflict = ProductMatcher.matchProduct({
    rawName: 'Făină albă Superioară 000 500g',
    brand: 'Băneasa',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg'
  });
  assert(
    !matchWeightConflict.matchedProduct || matchWeightConflict.matchedProduct.id !== 'prod-faina-000',
    'Ambalajul de 500g NU trebuie să se grupeze automat cu produsul de 1kg'
  );
  pass('Garda de gramaj împiedică fuziunea automată a mărimilor de ambalaj diferite');

  // 2.4 Potrivire exactă GTIN / Barcode
  const matchExactGtin = ProductMatcher.matchProduct({
    rawName: 'Orice Denumire Deformată',
    barcode: '5941014002341' // Barcode lapte Napolact
  });
  assert.strictEqual(matchExactGtin.confidence, 1.0);
  assert.strictEqual(matchExactGtin.matchMethod, 'gtin_exact');
  assert.strictEqual(matchExactGtin.matchedProduct?.id, 'prod-lapte-1');
  pass('Potrivirea prin GTIN/EAN are prioritate absolută și confidence 1.0');

  // --- 3. Comparație Multi-Retailer Detaliată ---
  console.log('\n--- 3. Comparație Multi-Retailer Detaliată (PriceComparisonService) ---');

  const compDetails = PriceComparisonService.getProductComparisonDetails('prod-lapte-1');
  assert.ok(compDetails, 'Comparația detaliată trebuie să existe');
  assert(compDetails.offers.length >= 3, 'Trebuie să aibă cel puțin 3 oferte de la retaileri');
  assert(compDetails.lowestPrice > 0, 'Cel mai mic preț trebuie să fie pozitiv');
  assert(compDetails.highestPrice >= compDetails.lowestPrice, 'Prețul maxim >= prețul minim');

  // Verificare sortare crescătoare a ofertelor
  for (let i = 1; i < compDetails.offers.length; i++) {
    assert(
      compDetails.offers[i].offer.price >= compDetails.offers[i - 1].offer.price,
      'Ofertele trebuie să fie ordonate crescător după preț'
    );
  }
  pass('Ofertele multi-retailer sunt sortate crescător după preț');

  // Verificare diferențiere card fidelitate
  const loyaltyOffer = compDetails.offers.find(o => o.loyaltyPrice !== undefined);
  assert.ok(loyaltyOffer, 'Trebuie să existe o ofertă cu card de fidelitate');
  assert.ok(loyaltyOffer.loyaltyCardName, 'Oferta cu card trebuie să precizeze numele cardului (ex: Kaufland Card)');
  assert.ok(loyaltyOffer.loyaltyPrice !== undefined && loyaltyOffer.standardPrice > loyaltyOffer.loyaltyPrice, 'Prețul standard este diferențiat de prețul cu card');
  pass('Diferențierea vizibilă și corectă între prețul standard și cel cu card de fidelitate');

  // --- 4. Endpoint-uri HTTP Backend ---
  console.log('\n--- 4. Endpoint-uri HTTP Backend (/api/products & /api/categories) ---');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as any;
  const port = addr.port;

  try {
    // 4.1 GET /api/categories
    const catRes = await fetch(`http://localhost:${port}/api/categories`);
    assert.strictEqual(catRes.status, 200);
    const catData = await catRes.json();
    assert.strictEqual(catData.success, true);
    assert(Array.isArray(catData.categories));
    assert(catData.categories.length > 0);
    pass('GET /api/categories returnează 200 OK și lista îmbogățită de categorii');

    // 4.2 GET /api/products (toate)
    const prodRes = await fetch(`http://localhost:${port}/api/products`);
    assert.strictEqual(prodRes.status, 200);
    const prodData = await prodRes.json();
    assert.strictEqual(prodData.success, true);
    assert(Array.isArray(prodData.products));
    assert(prodData.products.length > 0);
    assert.ok(prodData.pagination);
    assert.ok(prodData.facets);
    pass('GET /api/products returnează lista paginată cu fațete și metadate agregate');

    // 4.3 GET /api/products cu căutare
    const searchRes = await fetch(`http://localhost:${port}/api/products?search=Napolact`);
    assert.strictEqual(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.strictEqual(searchData.success, true);
    assert(searchData.products.every((p: any) => p.brand.includes('Napolact') || p.name.includes('Napolact')));
    pass('Căutarea după text funcționează corect în catalog');

    // 4.4 GET /api/products cu filtru categorie
    const filterCatRes = await fetch(`http://localhost:${port}/api/products?category=Panificație`);
    assert.strictEqual(filterCatRes.status, 200);
    const filterCatData = await filterCatRes.json();
    assert.strictEqual(filterCatData.success, true);
    assert(filterCatData.products.every((p: any) => p.category === 'Panificație'));
    pass('Filtrarea după categorie funcționează conform taxonomiei');

    // 4.5 GET /api/products/:id
    const singleRes = await fetch(`http://localhost:${port}/api/products/prod-lapte-1`);
    assert.strictEqual(singleRes.status, 200);
    const singleData = await singleRes.json();
    assert.strictEqual(singleData.success, true);
    assert.strictEqual(singleData.product.id, 'prod-lapte-1');
    assert.ok(singleData.comparison);
    assert(singleData.comparison.offers.length > 0);
    pass('GET /api/products/:id returnează detaliul complet și comparația multi-retailer');

    // 4.6 POST /api/products/report-error (Raportare eroare utilizator)
    const errRes = await fetch(`http://localhost:${port}/api/products/report-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: 'prod-lapte-1',
        productName: 'Lapte Napolact 1.5%',
        storeId: 'lidl',
        errorType: 'price_mismatch',
        reportedPrice: 7.29,
        details: 'Preț observat la raft 7.29 lei în loc de 6.49 lei',
        reporterEmail: 'tester@exemplu.ro'
      })
    });
    assert.strictEqual(errRes.status, 200);
    const errData = await errRes.json();
    assert.strictEqual(errData.success, true);
    assert.ok(errData.reportId);

    // Verificăm că raportul a fost adăugat în coada de recolectare
    const queue = StorageService.getRecollectionQueue();
    const task = queue.find(t => t.productId === 'prod-lapte-1' && t.retailerId === 'lidl');
    assert.ok(task, 'Raportul de eroare de preț trebuie să genereze o sarcină în coada de recolectare');
    pass('Raportarea erorilor funcționează și se conectează la coada de priorități');

    // 4.7 POST /api/admin/match-correction (Corectare asociere produse)
    // 4.7.1 Fără token -> 401
    const unauthCorrRes = await fetch(`http://localhost:${port}/api/admin/match-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: 'cand-test-1',
        correctedProductId: 'prod-lapte-1',
        reason: 'Corectare manuală'
      })
    });
    assert.strictEqual(unauthCorrRes.status, 401);
    pass('Corectarea asocierilor este protejată prin autentificare');

    // 4.7.2 Cu token valid
    StorageService.saveMatchCandidates([{
      id: 'cand-test-1',
      sourceRawName: 'Lapte 1.5L',
      matchedProductId: 'prod-lapte-1',
      matchedProductName: 'Lapte 1L',
      confidenceScore: 0.65,
      matchMethod: 'name_brand_similarity',
      status: 'pending_confirmation',
      createdAt: new Date().toISOString()
    }]);

    const authCorrRes = await fetch(`http://localhost:${port}/api/admin/match-correction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        candidateId: 'cand-test-1',
        correctedProductId: 'prod-lapte-1',
        reason: 'Confirmare manuală administrator'
      })
    });
    assert.strictEqual(authCorrRes.status, 200);
    const authCorrData = await authCorrRes.json();
    assert.strictEqual(authCorrData.success, true);

    const auditLogs = StorageService.getMatchAuditHistory();
    assert(auditLogs.length > 0, 'Auditul modificărilor de matching trebuie să înregistreze acțiunea');
    pass('Corectarea asocierilor din admin funcționează și păstrează audit complet');

  } finally {
    server.close();
    IndexerScheduler.stop();
  }

  console.log('🎉 Toate testele pentru Catalogul de Produse au rulat cu succes!\n');
}

runTests().then(() => {
  IndexerScheduler.stop();
  process.exit(0);
}).catch(err => {
  console.error('❌ Eșec test ProductsCatalog:', err);
  process.exit(1);
});
