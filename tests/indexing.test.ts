// tests/indexing.test.ts
// Teste Automate pentru Motorul Hibrid de Indexare a Prețurilor (7 Retaileri România)

import http from 'http';
import {
  RetailerRegistry,
  INITIAL_RETAILER_ENTRIES
} from '../src/indexing/RetailerRegistry.ts';
import {
  getCollectorForRetailer,
  LidlCollector,
  KauflandCollector,
  CarrefourCollector,
  PennyCollector,
  AuchanCollector,
  ProfiCollector,
  MegaImageCollector
} from '../src/indexing/RetailerCollectors.ts';
import { ProcessingPipeline } from '../src/indexing/ProcessingPipeline.ts';
import { IndexingScheduler } from '../src/indexing/IndexingScheduler.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { CollectionBatch } from '../src/indexing/types.ts';
import { app, ADMIN_API_KEY } from '../server.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runIndexingTests() {
  console.log('🧪 Rulare teste pentru Motorul Hibrid de Indexare a Prețurilor (7 Retaileri)...\n');

  // --- 1. Verificarea Registrului și a Celor 7 Retaileri ---
  console.log('--- 1. Contractul de Colector și Registrul celor 7 Retaileri ---');
  RetailerRegistry.resetToDefault();
  const allRetailers = RetailerRegistry.getAllRetailers();
  assert(allRetailers.length === 7, `Registrul conține exact 7 retaileri românești (obținut: ${allRetailers.length})`);

  const expectedRetailerIds = ['lidl', 'kaufland', 'carrefour', 'penny', 'auchan', 'profi', 'mega-image'];
  const hasAll = expectedRetailerIds.every(id => allRetailers.some(r => r.retailerId === id));
  assert(hasAll, 'Toți cei 7 retaileri (Lidl, Kaufland, Carrefour, Penny, Auchan, Profi, Mega Image) sunt prezenți');

  // Testare independență și eligibilitate pentru fiecare retailer
  for (const rid of expectedRetailerIds) {
    const collector = getCollectorForRetailer(rid);
    assert(collector.retailerId === rid, `Factory returnează colectorul corect pentru ${rid}`);
    
    const elig = await collector.checkEligibility();
    if (rid === 'lidl') {
      assert(elig.status === 'configured', 'Lidl este pre-configurat pentru import manual de fișier oficial');
    } else if (rid === 'penny' || rid === 'profi') {
      assert(elig.eligible === false && elig.status === 'disabled', `${collector.name} este dezactivat prudent până la confirmarea termenilor de acces`);
      assert(typeof elig.reason === 'string' && elig.reason.length > 0, `Motivul suspendării este explicit documentat pentru ${collector.name}`);
    } else {
      assert(elig.status === 'pending_authorization', `${collector.name} este în starea pending_authorization (așteaptă acreditare/token)`);
    }
  }

  // --- 2. Protecție împotriva scraping-ului neautorizat ---
  console.log('\n--- 2. Protecție împotriva accesului neautorizat ---');
  const pennyCollector = new PennyCollector();
  try {
    await pennyCollector.collectBatch();
    assert(false, 'Colectorul dezactivat fără payload nu trebuie să încerce colectarea');
  } catch (err: any) {
    assert(err.message.includes('suspendată'), 'Colectarea neautorizată este refuzată în condiții de siguranță');
  }

  // --- 3. Parsare, Validare și Separare Prețuri (Normal, Promo, Fidelitate) ---
  console.log('\n--- 3. Parsare Lot de Date & Separare Prețuri ---');
  const lidlCollector = new LidlCollector();
  const sampleCsv = `denumire,pret,gramaj,unitate,marca,cod_bare,promotie,valabil_pana,card_fidelitate
Lapte proaspat Napolact 1.5% 1L,6.49,1,l,Napolact,5941014002341,,,
Piept de pui Agricola 1kg,24.99,1,kg,Agricola,5941199003310,-10% Lidl Plus,2026-11-20,Lidl Plus
Paine Toast 500g,4.29,500,g,Vel Pitar,5941033001091,,,
Produs Pret Invalid,-5.00,1,buc,TestBrand,,,,`;

  const batch = await lidlCollector.collectBatch({ payload: sampleCsv, dryRun: true });
  assert(batch.rawRecordsCount === 4, `Batch-ul a extras 4 rânduri brute (obținut: ${batch.rawRecordsCount})`);
  assert(batch.provenance.sourceType === 'official_feed', 'Proveniența menționează tipul de sursă oficial_feed');

  const { valid, invalid, duplicatesCount } = lidlCollector.validateAndNormalize(batch);
  assert(valid.length === 3, `Au fost validate 3 produse corecte (obținut: ${valid.length})`);
  assert(invalid.length === 1, `Produsul cu preț negativ a fost respins corect (obținut: ${invalid.length})`);
  assert(invalid[0].reason.includes('numeric și strict pozitiv'), 'Motivul erorii precizează prețul invalid');

  const chickenItem = valid.find(v => v.rawName.includes('Piept de pui'));
  assert(chickenItem?.loyaltyCardRequired === true, 'Produsul cu reducere Lidl Plus are loyaltyCardRequired: true');
  assert(chickenItem?.loyaltyCardName === 'Lidl Plus', 'Denumirea cardului de fidelitate este păstrată');

  const breadItem = valid.find(v => v.rawName.includes('Paine Toast'));
  assert(breadItem?.normalizedUnit === 'kg', 'Pâinea la 500g a fost normalizată la kg');
  assert(breadItem?.unitPrice === 8.58, `Prețul unitar pentru pâine (500g la 4.29) este 8.58 lei/kg (obținut: ${breadItem?.unitPrice})`);

  // --- 4. Pipeline de Procesare: Auto-match vs Candidați Ambigui ---
  console.log('\n--- 4. Pipeline de Procesare: Identificare & Ambiguități ---');
  StorageService.resetAllData();

  const ambiguousCsv = `denumire,pret,gramaj,unitate,marca,cod_bare\nIaurt fin traditie greceasca 400g,5.49,400,g,Olympus,`;
  const ambiguousBatch = await lidlCollector.collectBatch({ payload: ambiguousCsv, dryRun: false });
  const ambiguousResult = await ProcessingPipeline.processBatch(ambiguousBatch);

  assert(ambiguousResult.candidatesCreatedCount === 1, 'Produsul fără cod de bare cu grad de similaritate mediu a creat un candidat ambiguu');
  assert(ambiguousResult.autoMatchedCount === 0, 'Produsul ambiguu NU a fost auto-asociat automat în catalog');

  const candidates = StorageService.getMatchCandidates();
  const cand = candidates.find(c => c.sourceRawName.includes('Iaurt fin'));
  assert(cand?.status === 'pending_confirmation', 'Statutul candidatului ambiguu este pending_confirmation');

  // --- 5. Tranzacții, Idempotență și Proveniență ---
  console.log('\n--- 5. Idempotență și Imuabilitatea Istoricului (Append-Only) ---');
  const offersBefore = StorageService.getProductOffers().length;
  const observationsBefore = StorageService.getPriceObservations().length;

  const validBatch = await lidlCollector.collectBatch({ payload: sampleCsv, dryRun: false });
  const run1Result = await ProcessingPipeline.processBatch(validBatch);

  assert(run1Result.status === 'partial', 'Execuția cu un rând invalid este raportată corect ca partial (nu complete sau failed)');
  assert(run1Result.offersUpsertedCount > 0, `Au fost salvate ${run1Result.offersUpsertedCount} oferte`);

  // Re-execuție identică a aceluiași fișier
  const run2Result = await ProcessingPipeline.processBatch(validBatch);
  const offersAfterReimport = StorageService.getProductOffers().length;
  const observationsAfterReimport = StorageService.getPriceObservations().length;

  assert(offersAfterReimport === StorageService.getProductOffers().length, 'Idempotență: numărul de oferte active nu crește la re-import');
  assert(observationsAfterReimport === observationsBefore + run1Result.observationsAppendedCount, 'Idempotență istoric: nu s-au creat observații duplicate pentru aceeași zi și același preț');

  // --- 6. Garanția Append-Only la Schimbarea Prețului ---
  console.log('\n--- 6. Garanția Append-Only la Modificarea Prețului ---');
  const updatedPriceCsv = `denumire,pret,gramaj,unitate,marca,cod_bare\nLapte proaspat Napolact 1.5% 1L,5.99,1,l,Napolact,5941014002341`;
  const updatedBatch = await lidlCollector.collectBatch({ payload: updatedPriceCsv, dryRun: false });
  const updateResult = await ProcessingPipeline.processBatch(updatedBatch);

  assert(updateResult.priceChangesCount === 1, 'Pipeline-ul a detectat corect schimbarea de preț față de oferta anterioară (6.49 -> 5.99)');

  const allNapolactObs = StorageService.getPriceObservations().filter(o => o.productId === 'prod-lapte-1' && o.storeId === 'lidl');
  const has649 = allNapolactObs.some(o => Math.abs(o.price - 6.49) < 0.01);
  const has599 = allNapolactObs.some(o => Math.abs(o.price - 5.99) < 0.01);

  assert(has649 && has599, 'Istoricul este strict append-only: conține atât prețul anterior (6.49), cât și noul preț (5.99)');

  // --- 7. Lock Distribuit și Concurență ---
  console.log('\n--- 7. Prevenirea Execuțiilor Concurente (Distributed Lock) ---');
  const lockKey = 'test-concurrent-lock';
  const acquired1 = await IndexingScheduler.acquireLock(lockKey, 'worker-A', 60);
  assert(acquired1 === true, 'Worker-A obține cu succes lock-ul');

  const acquired2 = await IndexingScheduler.acquireLock(lockKey, 'worker-B', 60);
  assert(acquired2 === false, 'Worker-B este respins în timp ce lock-ul este deținut de Worker-A');

  await IndexingScheduler.releaseLock(lockKey);
  const acquired3 = await IndexingScheduler.acquireLock(lockKey, 'worker-B', 60);
  assert(acquired3 === true, 'După eliberare, Worker-B poate prelua lock-ul');
  await IndexingScheduler.releaseLock(lockKey);

  // --- 8. Circuit Breaker și Backoff Exponențial ---
  console.log('\n--- 8. Circuit Breaker și Suspendare Prudentă ---');
  RetailerRegistry.updateRetailerStatus('lidl', 'active');
  const lidlEntry = RetailerRegistry.getRetailer('lidl');
  assert(lidlEntry?.consecutiveFailures === 0, 'La activare, contorul de eșecuri este 0');

  // Simulăm 3 eșecuri consecutive
  for (let i = 1; i <= 3; i++) {
    RetailerRegistry.recordExecution('lidl', {
      batchId: `fail-${i}`,
      retailerId: 'lidl',
      sourceId: 'src-lidl-collector',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 10,
      status: 'failed',
      recordsTotal: 0,
      recordsValid: 0,
      recordsInvalid: 1,
      duplicatesFound: 0,
      autoMatchedCount: 0,
      candidatesCreatedCount: 0,
      priceChangesCount: 0,
      offersUpsertedCount: 0,
      observationsAppendedCount: 0,
      errors: ['Simulare eșec rețea / 503 Service Unavailable'],
      summary: 'Eșec simulat',
      persisted: false,
      persistenceMode: 'demo_memory'
    });
  }

  const degradedLidl = RetailerRegistry.getRetailer('lidl');
  assert(degradedLidl?.status === 'degraded', 'După 3 eșecuri consecutive, circuit breaker-ul comută starea pe degraded');
  assert(degradedLidl?.suspensionReason?.includes('3 eșecuri consecutive'), 'Motivul suspendării menționează eșecurile consecutive');

  // Reactivare manuală de către administrator
  RetailerRegistry.updateRetailerStatus('lidl', 'configured', 'Reactivat manual');
  assert(RetailerRegistry.getRetailer('lidl')?.status === 'configured', 'Administratorul poate reactiva colectorul suspendat');

  // --- 9. Endpoint-uri API Server (/api/indexing/*) ---
  console.log('\n--- 9. Verificare Endpoint-uri HTTP Administrative ---');

  // GET /api/indexing/retailers
  const retailersRes = await makeRequest('GET', '/api/indexing/retailers');
  assert(retailersRes.status === 200, `GET /api/indexing/retailers returnează 200 OK (obținut: ${retailersRes.status})`);
  assert(retailersRes.body.count === 7, `API-ul returnează cei 7 retaileri (obținut: ${retailersRes.body.count})`);

  // GET /api/indexing/status
  const statusRes = await makeRequest('GET', '/api/indexing/status');
  assert(statusRes.status === 200, `/api/indexing/status returnează 200 OK (obținut: ${statusRes.status})`);
  assert(statusRes.body.status.timezone === 'Europe/Bucharest', 'Fusul orar este Europe/Bucharest');

  // POST /api/indexing/retailers/lidl/run fără token (401)
  const unauthRun = await makeRequest('POST', '/api/indexing/retailers/lidl/run', {
    body: JSON.stringify({ dryRun: true })
  });
  assert(unauthRun.status === 401, `Declanșarea fără token este respinsă cu 401 Unauthorized (obținut: ${unauthRun.status})`);

  // POST /api/indexing/retailers/lidl/run autorizat cu dryRun: true
  const authDryRun = await makeRequest('POST', '/api/indexing/retailers/lidl/run', {
    headers: {
      'Authorization': `Bearer ${ADMIN_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      dryRun: true,
      payload: sampleCsv
    })
  });
  assert(authDryRun.status === 200, `POST /api/indexing/retailers/lidl/run autorizat returnează 200 OK (obținut: ${authDryRun.status})`);
  assert(authDryRun.body.result?.status === 'partial', 'Rezultatul dry-run este returnat structurat cu status partial');
  assert(authDryRun.body.result?.persisted === false, 'În modul dry-run, persisted este false');

  // POST /api/indexing/retailers/lidl/pause & resume
  const pauseRes = await makeRequest('POST', '/api/indexing/retailers/lidl/pause', {
    headers: { 'Authorization': `Bearer ${ADMIN_API_KEY}` }
  });
  assert(pauseRes.status === 200 && pauseRes.body.retailer?.status === 'paused', 'Endpoint-ul /pause comută retailerul pe paused');

  const resumeRes = await makeRequest('POST', '/api/indexing/retailers/lidl/resume', {
    headers: { 'Authorization': `Bearer ${ADMIN_API_KEY}` }
  });
  assert(resumeRes.status === 200 && resumeRes.body.retailer?.status === 'configured', 'Endpoint-ul /resume readuce retailerul pe configured');

  console.log(`\n🎉 Toate testele pentru Motorul de Indexare au rulat cu succes: ${passed} trecute, ${failed} eșuate.`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function makeRequest(method: string, path: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 3000;
      const parsedUrl = new URL(`http://127.0.0.1:${port}${path}`);

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: options.headers || {}
      };

      const req = http.request(reqOptions, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          server.close();
          let parsedBody = {};
          try {
            parsedBody = JSON.parse(data);
          } catch {
            parsedBody = data;
          }
          resolve({ status: res.statusCode, body: parsedBody });
        });
      });

      req.on('error', (err: any) => {
        server.close();
        resolve({ status: 500, body: { error: err.message } });
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  });
}

runIndexingTests();
