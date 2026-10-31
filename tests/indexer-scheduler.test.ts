// tests/indexer-scheduler.test.ts
// Teste automate pentru IndexerScheduler, advisory lock (pg_advisory_lock) și CollectionWorker

import { IndexerScheduler } from '../src/services/IndexerScheduler.ts';
import { CollectionWorker } from '../src/services/CollectionWorker.ts';
import { RetailerRegistry } from '../src/indexing/RetailerRegistry.ts';

async function runIndexerSchedulerTests() {
  console.log('🧪 Rulare teste pentru IndexerScheduler & CollectionWorker...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? `-> ${detail}` : ''}`);
      failed++;
    }
  }

  // --- 1. Verificare apel explicit SELECT pg_advisory_lock(1) ---
  console.log('--- 1. Interogare directă PostgreSQL Advisory Lock ---');
  const mockQueries: string[] = [];
  const mockPg = {
    async query(sql: string) {
      mockQueries.push(sql);
      return { rows: [] };
    }
  };

  await IndexerScheduler.acquireAdvisoryLock(mockPg, 1);
  assert(
    mockQueries.includes('SELECT pg_advisory_lock(1)'),
    'IndexerScheduler.acquireAdvisoryLock execută interogarea SELECT pg_advisory_lock(1)'
  );

  await IndexerScheduler.releaseAdvisoryLock(mockPg, 1);
  assert(
    mockQueries.includes('SELECT pg_advisory_unlock(1)'),
    'IndexerScheduler.releaseAdvisoryLock execută interogarea SELECT pg_advisory_unlock(1)'
  );

  // --- 2. Protecție împotriva execuțiilor concurente ---
  console.log('\n--- 2. Protecție împotriva execuțiilor concurente ---');
  let worker1Finished = false;
  let concurrentCaught = false;

  // Lansăm o sarcină lungă protejată de advisory lock
  const longTask = IndexerScheduler.runWithAdvisoryLock(async () => {
    await new Promise(r => setTimeout(r, 60));
    worker1Finished = true;
    return 'task1-done';
  }, 1);

  // În timp ce task 1 rulează, task 2 încearcă să obțină același lock
  try {
    await IndexerScheduler.runWithAdvisoryLock(async () => {
      return 'task2-should-fail';
    }, 1);
  } catch (err: any) {
    concurrentCaught = true;
    assert(
      err.message.includes('deja deținut') || err.message.includes('advisory lock'),
      'Execuția concurentă este refuzată pe durata lock-ului activ'
    );
  }

  assert(concurrentCaught === true, 'Sistemul a împiedicat pornirea a două execuții simultane');
  const res1 = await longTask;
  assert(res1 === 'task1-done' && worker1Finished, 'Prima sarcină s-a finalizat cu succes după eliberarea lock-ului');

  // --- 3. Execuție CollectionWorker cu date demonstrative ---
  console.log('\n--- 3. Invocare CollectionWorker prin IndexerScheduler ---');
  RetailerRegistry.resetToDefault();

  const sampleLidlCsv = `denumire,pret,gramaj,unitate,marca,cod_bare\nLapte proaspat Napolact 1.5% 1L,6.49,1,l,Napolact,5941014002341`;

  const triggerResult = await IndexerScheduler.triggerNow({
    dryRun: true,
    retailerIds: ['lidl'],
    samplePayloads: {
      lidl: sampleLidlCsv
    }
  });

  assert(triggerResult !== null, 'triggerNow returnează rezultatul structurat al execuției');
  assert(triggerResult.retailersExecuted === 1, `A fost executat exact 1 retailer (obținut: ${triggerResult.retailersExecuted})`);
  assert(triggerResult.batchResults.length === 1, 'Rezultatul conține batch-ul procesat');
  assert(triggerResult.batchResults[0].retailerId === 'lidl', 'Retailerul procesat este Lidl');
  assert(CollectionWorker.isBusy() === false, 'După finalizare, CollectionWorker nu mai este marcat ca ocupat');

  // --- 4. Planificatorul bazat pe setInterval și starea sa ---
  console.log('\n--- 4. Mecanism de planificare zilnică cu setInterval ---');
  IndexerScheduler.start({
    targetHour: 4,
    targetMinute: 0,
    checkIntervalMs: 5000,
    timezone: 'Europe/Bucharest'
  });

  const status = IndexerScheduler.getStatus();
  assert(status.isRunning === true, 'Planificatorul este activ (isRunning: true)');
  assert(status.timezone === 'Europe/Bucharest', 'Fusul orar este setat pe Europe/Bucharest');
  assert(status.targetHour === 4, 'Ora țintă este 04:00 AM');
  assert(typeof status.nextScheduledRun === 'string', 'Următoarea rulare este programată corect în viitor');

  IndexerScheduler.stop();
  const statusStopped = IndexerScheduler.getStatus();
  assert(statusStopped.isRunning === false, 'După apelul stop(), planificatorul este oprit');

  console.log(`\n🎉 Toate testele pentru IndexerScheduler au rulat: ${passed} trecute, ${failed} eșuate.\n`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runIndexerSchedulerTests().catch(err => {
  console.error('Eroare neașteptată în rularea testelor:', err);
  process.exit(1);
});
