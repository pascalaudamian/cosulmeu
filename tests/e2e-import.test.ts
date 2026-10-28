import fs from 'fs';
import path from 'path';
import { FileImportAdapter, LidlPriceFileAdapter } from '../src/sources/FileImportAdapter';
import { StorageService } from '../src/services/StorageService';
import { ProductMatcher } from '../src/services/ProductMatcher';
import { PriceComparisonService } from '../src/services/PriceComparisonService';
import { ProductOffer } from '../src/types';

async function runE2EImportTest() {
  console.log('🧪 Rulare Test End-to-End: Flux Complet Import, Validare, Ipotență & Istoric...\n');
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

  // --- PASUL 1: Citire fișier CSV de test cu date fictive ---
  const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/test_import_products.csv');
  assert(fs.existsSync(fixturePath), 'Fișierul fixture de test există pe disc');

  const csvContent = fs.readFileSync(fixturePath, 'utf-8');
  assert(csvContent.length > 0, `Conținutul fișierului de test a fost citit cu succes (${csvContent.length} bytes)`);

  const initialOffers = StorageService.getProductOffers();
  const initialObservations = StorageService.getPriceObservations();
  const initialSyncRuns = StorageService.getSyncRuns();

  const adapter = new LidlPriceFileAdapter();

  // --- PASUL 2: Validare preliminară (Dry-Run = true) ---
  console.log('\n--- Etapa 1: Validare preliminară Dry-Run (fără salvare) ---');
  const dryRunResult = await adapter.importData({
    content: csvContent,
    format: 'csv',
    storeId: 'lidl',
    dryRun: true
  });

  assert(dryRunResult.success === true, 'Dry-run-ul a fost finalizat cu succes');
  assert(dryRunResult.syncRun.recordsProcessed > 0, `Au fost procesate ${dryRunResult.syncRun.recordsProcessed} rânduri`);
  assert(dryRunResult.syncRun.invalidRecords >= 3, `Au fost identificate cele 3 rânduri invalide (preț zero, negativ, text): ${dryRunResult.syncRun.invalidRecords}`);
  assert(dryRunResult.syncRun.duplicatesFound >= 1, `A fost identificat duplicatul de cod de bare din fișier: ${dryRunResult.syncRun.duplicatesFound}`);

  // Verificăm că Dry-Run NU a modificat stocarea
  const offersAfterDryRun = StorageService.getProductOffers();
  const obsAfterDryRun = StorageService.getPriceObservations();
  assert(offersAfterDryRun.length === initialOffers.length, 'Dry-run-ul NU a modificat ofertele din stocare');
  assert(obsAfterDryRun.length === initialObservations.length, 'Dry-run-ul NU a adăugat observații în istoric');

  // --- PASUL 3: Confirmare și Import Efectiv (Dry-Run = false) ---
  console.log('\n--- Etapa 2: Import efectiv cu persistență ---');
  const actualImportResult = await adapter.importData({
    content: csvContent,
    format: 'csv',
    storeId: 'lidl',
    dryRun: false
  });

  assert(actualImportResult.success === true, 'Importul efectiv a rulat cu succes');
  assert(actualImportResult.importedOffers.length > 0, `Au fost importate ${actualImportResult.importedOffers.length} oferte valide`);

  // --- PASUL 4: Verificarea actualizării corecte a ofertelor în Storage ---
  const updatedOffers = StorageService.getProductOffers();
  const napolactOffer = updatedOffers.find(o => o.productId === 'prod-lapte-1' && o.storeId === 'lidl');
  const puiOffer = updatedOffers.find(o => o.productId === 'prod-piept-pui' && o.storeId === 'lidl');
  const toastOffer = updatedOffers.find(o => o.productId === 'prod-paine-toast' && o.storeId === 'lidl');

  assert(napolactOffer !== undefined && napolactOffer.price === 6.49, 'Oferta Napolact (GTIN) a fost actualizată la 6.49 lei');
  assert(puiOffer !== undefined && puiOffer.price === 24.99 && puiOffer.loyaltyCardRequired === true, 'Oferta promoțională cu card Lidl Plus a fost salvată cu flag-ul loyaltyCardRequired: true');
  assert(toastOffer !== undefined && toastOffer.unitPrice === 8.58, `Prețul unitar pentru pâine (500g la 4.29 lei) a fost normalizat la 8.58 lei/kg (obținut: ${toastOffer?.unitPrice})`);

  // Verificarea asocierilor ambigue (trebuie să NU fie asociate automat, ci salvate în candidați de confirmare)
  const candidates = StorageService.getMatchCandidates();
  const ambiguousCandidate = candidates.find(c => c.sourceRawName.includes('Iaurt fin traditie greceasca'));
  assert(ambiguousCandidate !== undefined, 'Produsul cu potrivire ambiguă a fost înregistrat ca candidat');
  assert(ambiguousCandidate?.status === 'pending_confirmation', 'Statutul candidatului ambiguu este pending_confirmation');

  // --- PASUL 5: Verificarea păstrării istoricului observațiilor de preț ---
  console.log('\n--- Etapa 3: Auditul imuabilității istoricului de preț ---');
  const updatedObservations = StorageService.getPriceObservations();
  assert(updatedObservations.length > initialObservations.length, `Istoricul conține noi observații (${updatedObservations.length} față de inițial ${initialObservations.length})`);

  // Verificăm că nicio observație istorică inițială nu a fost ștearsă sau pierdută
  const initialIds = new Set(initialObservations.map(o => o.id));
  const preservedCount = updatedObservations.filter(o => initialIds.has(o.id)).length;
  assert(preservedCount === initialObservations.length, 'Toate observațiile istorice existente au fost conservate intact');

  // --- PASUL 6: Verificarea IDEMPOTENȚEI importului repetat ---
  console.log('\n--- Etapa 4: Testul de idempotență (re-import identic) ---');
  const offersBeforeSecondRun = StorageService.getProductOffers().length;
  const observationsBeforeSecondRun = StorageService.getPriceObservations().length;

  const secondImportResult = await adapter.importData({
    content: csvContent,
    format: 'csv',
    storeId: 'lidl',
    dryRun: false
  });

  assert(secondImportResult.success === true, 'Al doilea import al aceluiași fișier a rulat cu succes');

  const offersAfterSecondRun = StorageService.getProductOffers().length;
  const observationsAfterSecondRun = StorageService.getPriceObservations().length;

  assert(offersAfterSecondRun === offersBeforeSecondRun, `Idempotență oferte: numărul de oferte a rămas exact același (${offersAfterSecondRun}), fără dubluri nejustificate`);
  assert(observationsAfterSecondRun === observationsBeforeSecondRun, `Idempotență observații: numărul observațiilor pentru aceeași zi/preț a rămas identic (${observationsAfterSecondRun}), fără duplicate`);

  // Verificăm că jurnalul de sincronizare a înregistrat ambele rulări distinct
  const syncRunsAfter = StorageService.getSyncRuns();
  assert(syncRunsAfter.length === initialSyncRuns.length + 2, 'Jurnalul de sincronizare a înregistrat cu acuratețe ambele rulări de import');

  console.log(`\n🎉 Testul End-to-End al importului s-a încheiat cu succes: ${passed} trecute, ${failed} eșuate.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runE2EImportTest();
