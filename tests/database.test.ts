// tests/database.test.ts
// Teste automate pentru Persistență PostgreSQL, Izolarea Erorilor, Idempotență și Istoric Append-Only

import { describe, it } from 'node:test';
import http from 'http';
import {
  getDbConfig,
  checkDbHealth,
  DatabaseService,
  closePool
} from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { ProductOffer, PriceObservation } from '../src/types.ts';
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

async function runDatabaseTests() {
  console.log('🧪 Rulare teste pentru Stratul de Persistență Centralizată & PostgreSQL...\n');

  // --- 1. Testarea detecției configurației prin variabile de mediu ---
  console.log('--- 1. Detecție configurație & variabile de mediu ---');
  
  // Salvare env inițial
  const originalEnv = { ...process.env };

  delete process.env.SQL_HOST;
  delete process.env.SQL_USER;
  delete process.env.SQL_DB_NAME;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_DB_URL;
  delete process.env.PGHOST;

  const emptyConfig = getDbConfig();
  assert(emptyConfig.configured === false && emptyConfig.type === 'none', 'În absența variabilelor DB, configurația este marcată ca none/neconfigurat');

  process.env.SUPABASE_DB_URL = 'postgresql://postgres:fake-secret@db.abcdef.supabase.co:5432/postgres';
  const supabaseConfig = getDbConfig();
  assert(supabaseConfig.configured === true && supabaseConfig.type === 'supabase', 'SUPABASE_DB_URL este detectat corect ca tip supabase');

  delete process.env.SUPABASE_DB_URL;
  process.env.SQL_HOST = '/cloudsql/project:region:instance';
  process.env.SQL_USER = 'app_user';
  process.env.SQL_DB_NAME = 'cosul_meu';
  const cloudSqlConfig = getDbConfig();
  assert(cloudSqlConfig.configured === true && cloudSqlConfig.type === 'cloudsql', 'Variabilele Cloud SQL (SQL_HOST, SQL_USER, SQL_DB_NAME) sunt mapate corect');

  // Resetare env
  delete process.env.SQL_HOST;
  delete process.env.SQL_USER;
  delete process.env.SQL_DB_NAME;
  await closePool();

  // --- 2. Izolarea erorilor de rețea / host offline (Zero Crash & Fallback) ---
  console.log('\n--- 2. Izolarea erorilor de conexiune & toleranță la căderi ---');
  process.env.DATABASE_URL = 'postgresql://invalid_user:invalid_pass@127.0.0.1:59999/non_existent_db';
  await closePool();

  const offlineHealth = await checkDbHealth();
  assert(offlineHealth.connected === false, 'Când baza de date este inaccesibilă, checkDbHealth returnează connected: false fără crash');
  assert(offlineHealth.persistenceMode === 'demo_memory', 'La eșec conexiune, sistemul recurge automat la modul demo_memory');
  assert(typeof offlineHealth.message === 'string' && offlineHealth.message.length > 0, 'Mesajul de eroare este curat și documentează cauza');

  delete process.env.DATABASE_URL;
  await closePool();

  // --- 3. Garanția imuabilității istoricului de preț (Append-Only) ---
  console.log('\n--- 3. Verificarea garanției Append-Only pentru observațiile istorice ---');
  StorageService.resetAllData();
  const initialOffers = StorageService.getProductOffers();
  const initialObservations = StorageService.getPriceObservations();

  const targetProductId = 'prod-lapte-1';
  const storeId = 'lidl';
  const currentOfferBefore = initialOffers.find(o => o.productId === targetProductId && o.storeId === storeId);
  const oldPrice = currentOfferBefore?.price || 6.89;

  // Actualizăm oferta curentă la un nou preț (6.19 lei)
  const newPrice = 6.19;
  const updatedOffer: ProductOffer = {
    ...currentOfferBefore!,
    id: `off-${storeId}-${targetProductId}`,
    price: newPrice,
    unitPrice: newPrice,
    observationDate: '2026-10-28',
    isPromo: true,
    promoDetails: 'Promoție Săptămânală'
  };

  StorageService.addOrUpdateOffers([updatedOffer]);

  // Adăugăm noua observație în istoric
  const newObs: PriceObservation = {
    id: `obs-test-append-${Date.now()}`,
    productId: targetProductId,
    storeId,
    price: newPrice,
    date: '2026-10-28',
    source: 'official_feed'
  };
  StorageService.addPriceObservations([newObs]);

  const updatedOffers = StorageService.getProductOffers();
  const currentOfferAfter = updatedOffers.find(o => o.productId === targetProductId && o.storeId === storeId);
  assert(currentOfferAfter?.price === newPrice, `Oferta curentă a fost actualizată la noul preț de ${newPrice} lei (obținut: ${currentOfferAfter?.price})`);

  const updatedObservations = StorageService.getPriceObservations();
  const productObservations = updatedObservations.filter(o => o.productId === targetProductId && o.storeId === storeId);
  
  const hasOldPriceInHistory = productObservations.some(o => o.price === oldPrice);
  const hasNewPriceInHistory = productObservations.some(o => o.price === newPrice);

  assert(hasOldPriceInHistory === true, 'Observația istorică inițială a fost păstrată intactă (prețul vechi este în istoric)');
  assert(hasNewPriceInHistory === true, 'Noua observație a fost adăugată în istoric (prețul nou este în istoric)');
  assert(productObservations.length >= 2, `Istoricul este append-only: conține cel puțin 2 puncte în timp pentru acest produs (${productObservations.length} înregistrări)`);

  // --- 4. Verificarea idempotenței importurilor repetate ---
  console.log('\n--- 4. Testul de idempotență la re-import ---');
  const offersCountBeforeReimport = StorageService.getProductOffers().length;
  const observationsCountBeforeReimport = StorageService.getPriceObservations().length;

  // Re-aplicăm exact aceeași ofertă și aceeași observație
  StorageService.addOrUpdateOffers([updatedOffer]);
  StorageService.addPriceObservations([newObs]);

  const offersCountAfterReimport = StorageService.getProductOffers().length;
  const observationsCountAfterReimport = StorageService.getPriceObservations().length;

  assert(offersCountAfterReimport === offersCountBeforeReimport, `Idempotență oferte: numărul de oferte a rămas constant (${offersCountAfterReimport})`);
  assert(observationsCountAfterReimport === observationsCountBeforeReimport, `Idempotență istoric: nu s-au creat dubluri pentru aceeași zi și același preț (${observationsCountAfterReimport})`);

  // --- 5. Verificarea endpoint-urilor de persistență pe server ---
  console.log('\n--- 5. Verificare endpoint-uri server (/api/storage/status & /api/catalog/*) ---');

  // Testare /api/storage/status
  const statusRes = await makeRequest('GET', '/api/storage/status');
  assert(statusRes.status === 200, `/api/storage/status returnează 200 OK (obținut: ${statusRes.status})`);
  assert(statusRes.body.success === true, 'Răspunsul conține success: true');
  assert(statusRes.body.persistenceMode === 'demo_memory', `În mediul demo, persistenceMode este raportat corect ca demo_memory (obținut: ${statusRes.body.persistenceMode})`);

  // Testare /api/catalog/products
  const catalogRes = await makeRequest('GET', '/api/catalog/products');
  assert(catalogRes.status === 200, `/api/catalog/products returnează 200 OK (obținut: ${catalogRes.status})`);
  assert(catalogRes.body.products?.length > 0, `Catalogul returnează ${catalogRes.body.products?.length} produse`);

  // Testare /api/catalog/history/prod-lapte-1
  const historyRes = await makeRequest('GET', '/api/catalog/history/prod-lapte-1');
  assert(historyRes.status === 200, `/api/catalog/history/prod-lapte-1 returnează 200 OK (obținut: ${historyRes.status})`);
  assert(historyRes.body.observations?.length > 0, `Istoricul produsului returnează ${historyRes.body.observations?.length} observații`);

  // Testare server-side import endpoint cu token
  const importCsvPayload = `denumire,pret,gramaj,unitate,marca,cod_bare\nLapte proaspat 1.5% 1L,6.29,1,l,Napolact,5941014002341`;
  const serverImportRes = await makeRequest('POST', '/api/admin/sources/src-lidl-file/import', {
    headers: {
      'Authorization': `Bearer ${ADMIN_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: importCsvPayload,
      format: 'csv',
      storeId: 'lidl',
      dryRun: false
    })
  });

  assert(serverImportRes.status === 200, `POST /api/admin/sources/:id/import autorizat returnează 200 OK (obținut: ${serverImportRes.status})`);
  assert(serverImportRes.body.success === true, 'Importul pe server a fost executat cu succes');
  assert(serverImportRes.body.persisted === false, 'În absența PostgreSQL, răspunsul specifică transparent persisted: false');
  assert(serverImportRes.body.persistenceMode === 'demo_memory', 'persistenceMode este raportat transparent ca demo_memory');

  console.log(`\n🎉 Toate testele pentru Stratul de Persistență au rulat: ${passed} trecute, ${failed} eșuate.`);

  // Restaurare variabile originale
  process.env = originalEnv;

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Helper pentru apeluri HTTP interne pe Express app
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

runDatabaseTests();
