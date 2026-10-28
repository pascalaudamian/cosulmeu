import { FileImportAdapter, LidlPriceFileAdapter } from '../src/sources/FileImportAdapter';
import { MonitorulPreturilorAdapter } from '../src/sources/MonitorulPreturilorAdapter';
import { ProductMatcher } from '../src/services/ProductMatcher';
import { PriceComparisonService } from '../src/services/PriceComparisonService';
import { StorageService } from '../src/services/StorageService';
import { ProductOffer, ShoppingListItem } from '../src/types';

async function runSourcesTests() {
  console.log('🧪 Rulare teste unitare și de integrare pentru Surse & Import Prețuri...\n');
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

  const adapter = new FileImportAdapter('src-test', 'Test File Adapter', 'lidl');

  // --- TEST 1: CSV Parser cu separator virgulă și punct-și-virgulă ---
  const csvSemicolon = `Denumire;Pret;Cantitate;Unitate;Magazin;Barcode
Pâine albă feliată 500g;4,89;500;g;kaufland;5941001001001
Lapte Zuzu 1.5% 1L;6,49;1;l;kaufland;5942002002002`;

  const parsed1 = FileImportAdapter.parseCSV(csvSemicolon);
  assert(parsed1.length === 2, 'CSV cu separator punct-și-virgulă (;) parsat corect cu 2 înregistrări');
  assert(parsed1[0].price === '4,89', 'Prețul cu virgulă zecimală a fost extras ca text pentru parsare robustă');

  const csvComma = `name,price,quantity,unit,storeId,barcode
Ulei floarea soarelui 1L,8.99,1,l,lidl,5943003003003`;
  const parsed2 = FileImportAdapter.parseCSV(csvComma);
  assert(parsed2.length === 1 && parsed2[0].barcode === '5943003003003', 'CSV cu separator virgulă (,) parsat corect');

  // --- TEST 2: Validarea respinge prețuri invalide (<= 0, NaN, text) ---
  const invalidPriceCsv = `name,price,unit
Produs Gratuit,0,buc
Produs Negativ,-5.50,kg
Produs Text,ABC,l
Produs Valid,12.50,buc`;

  const rawRecords2 = FileImportAdapter.parseCSV(invalidPriceCsv);
  const validation2 = adapter.validateRecords(rawRecords2);

  assert(validation2.valid.length === 1, 'Doar produsul cu preț valid > 0 este acceptat');
  assert(validation2.invalid.length === 3, 'Trei rânduri cu prețuri invalide (0, negativ, text) au fost respinse cu erori clare');
  assert(validation2.invalid.some(r => r.reason.includes('Preț invalid')), 'Motivul erorii specifică prețul invalid');

  // --- TEST 3: Detectarea duplicatelor în cadrul aceluiași fișier ---
  const duplicateCsv = `barcode,name,price,unit
5941112223334,Iaurt Natural 400g,3.50,buc
5941112223334,Iaurt Natural 400g,3.60,buc`;

  const rawDuplicates = FileImportAdapter.parseCSV(duplicateCsv);
  const validationDuplicates = adapter.validateRecords(rawDuplicates);

  assert(validationDuplicates.valid.length === 1, 'Doar prima înregistrare unică este acceptată');
  assert(validationDuplicates.duplicatesCount === 1, 'Duplicatul de cod de bare a fost contorizat corect');
  assert(validationDuplicates.invalid.some(r => r.reason.includes('duplicat')), 'Duplicatul a fost raportat în lista de invalidări');

  // --- TEST 4: Filtrarea și marcarea ofertelor expirate ---
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const expiredCsv = `name,price,unit,valabil_pana
Produs Expirat,5.00,buc,${yesterday}
Produs Activ,5.00,buc,${nextMonth}`;

  const rawExpired = FileImportAdapter.parseCSV(expiredCsv);
  const validationExpired = adapter.validateRecords(rawExpired);

  const expRecord = validationExpired.valid.find(r => r.rawName === 'Produs Expirat');
  const actRecord = validationExpired.valid.find(r => r.rawName === 'Produs Activ');

  assert(expRecord?.isExpired === true, 'Oferta cu dată anterioară este marcată ca expirată (isExpired: true)');
  assert(actRecord?.isExpired === false, 'Oferta viitoare este marcată ca activă (isExpired: false)');

  // --- TEST 5: Normalizarea unităților de măsură (g -> kg, ml -> l, calcul preț/unitate standard) ---
  const unitCsv = `name,price,package_size,unit
Salam de Sibiu 500g,30.00,500,g
Apă minerală 750ml,3.00,750,ml`;

  const rawUnits = FileImportAdapter.parseCSV(unitCsv);
  const validationUnits = adapter.validateRecords(rawUnits);

  const salam = validationUnits.valid.find(r => r.rawName.includes('Salam'));
  const apa = validationUnits.valid.find(r => r.rawName.includes('Apă'));

  assert(salam?.normalizedUnit === 'kg', 'Unitatea pentru salam a fost normalizată la kg');
  assert(salam?.unitPrice === 60, `Prețul unitar standard a fost calculat corect: 60 lei/kg (obținut: ${salam?.unitPrice})`);
  assert(apa?.normalizedUnit === 'l', 'Unitatea pentru apă a fost normalizată la l');
  assert(apa?.unitPrice === 4, `Prețul unitar standard a fost calculat corect: 4 lei/l (obținut: ${apa?.unitPrice})`);

  // --- TEST 6: Distincția prețurilor cu card de fidelitate în comparația coșului ---
  const promoOffer: ProductOffer = {
    id: 'off-test-lidl-promo',
    productId: 'prod-lapte-1',
    storeId: 'lidl',
    price: 5.49,
    originalPrice: 6.89,
    unitPrice: 5.49,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    loyaltyCardRequired: true,
    loyaltyCardName: 'Lidl Plus',
    observationDate: new Date().toISOString(),
    sourceId: 'src-test',
    verificationStatus: 'verified',
    source: 'official_feed',
    confidenceLevel: 'high',
    lastChecked: new Date().toISOString().split('T')[0]
  };

  StorageService.addOrUpdateOffers([promoOffer]);

  const testItem: ShoppingListItem[] = [
    {
      id: 'item-lapte',
      productId: 'prod-lapte-1',
      name: 'Lapte proaspăt 1.5% grăsime 1L',
      category: 'Lactate și ouă',
      quantity: 1,
      unit: 'l',
      checked: false
    }
  ];

  const compWithoutLoyalty = PriceComparisonService.compareBasketAcrossStores(testItem, {
    useLoyaltyCards: false
  });
  const compWithLoyalty = PriceComparisonService.compareBasketAcrossStores(testItem, {
    useLoyaltyCards: true
  });

  const lidlWithout = compWithoutLoyalty.find(c => c.store.id === 'lidl');
  const lidlWith = compWithLoyalty.find(c => c.store.id === 'lidl');

  assert(lidlWithout?.grandTotal === 6.89, `Fără card de fidelitate activat, se folosește prețul standard de 6,89 lei (obținut: ${lidlWithout?.grandTotal})`);
  assert(lidlWith?.grandTotal === 5.49, `Cu opțiunea cardurilor de fidelitate activată, se aplică reducerea Lidl Plus de 5,49 lei (obținut: ${lidlWith?.grandTotal})`);
  assert(lidlWith?.hasLoyaltyDiscount === true && (lidlWith?.loyaltySavings || 0) > 0, 'Economia adusă de card este evidențiată transparent');

  // --- TEST 7: ProductMatcher (GTIN exact, fuzzy token matching și incompatibilitate lichid/solid) ---
  // Potrivire exactă după GTIN (Lapte proaspăt Napolact are barcode: 5941014002341)
  const exactMatch = ProductMatcher.matchProduct({
    rawName: 'Lapte Napolact Barcode Test',
    barcode: '5941014002341'
  });
  assert(exactMatch.matchedProduct?.id === 'prod-lapte-1' && exactMatch.confidence === 1.0, 'Potrivirea după GTIN/EAN verificat are încredere 100% și metoda gtin_exact');

  // Potrivire fuzzy după nume și brand Napolact
  const fuzzyMatch = ProductMatcher.matchProduct({
    rawName: 'Lapte proaspat Napolact 1.5% 1 litru',
    brand: 'Napolact',
    packageUnit: 'l',
    packageWeightOrVolume: 1
  });
  assert(fuzzyMatch.confidence >= 0.65 && fuzzyMatch.matchedProduct?.id === 'prod-lapte-1', 'Potrivirea fuzzy pe nume, brand și gramaj similar asociază corect produsul din catalog');

  // Garda de incompatibilitate între lichid și solid (unitate kg vs unitate l)
  const incompatibleMatch = ProductMatcher.matchProduct({
    rawName: 'Lapte Napolact Pudra Uscata 1kg',
    brand: 'Napolact',
    packageUnit: 'kg'
  });
  assert(incompatibleMatch.matchedProduct?.id !== 'prod-lapte-1', 'Garda de incompatibilitate unitate (kg solid vs l lichid) previne asocierea greșită a laptelui lichid cu lapte praf');

  // --- TEST 8: Păstrarea imutabilă a istoricului prețurilor ---
  const initialObservationsCount = StorageService.getPriceObservations().length;
  const newObs = {
    id: 'obs-test-' + Date.now(),
    productId: 'prod-lapte-1',
    storeId: 'lidl',
    price: 6.29,
    date: new Date().toISOString(),
    source: 'official_feed' as const,
    sourceId: 'src-test'
  };

  StorageService.addPriceObservations([newObs]);
  const afterObservations = StorageService.getPriceObservations();

  assert(afterObservations.length === initialObservationsCount + 1, 'Istoricul observațiilor de preț crește incremental fără a șterge observațiile anterioare');
  assert(afterObservations.some(o => o.id === newObs.id), 'Noua observație este regăsită în istoricul complet');

  // --- TEST 9: MonitorulPreturilorAdapter este dezactivat implicit cu ghid oficial ---
  const monitorAdapter = new MonitorulPreturilorAdapter();
  const availability = await monitorAdapter.checkAvailability();

  assert(availability.available === false, 'Monitorul Prețurilor este dezactivat în absența acreditării oficiale');
  assert(availability.reason?.includes('Consiliul Concurenței') || false, 'Motivul menționează autoritatea oficială (Consiliul Concurenței)');

  const guide = MonitorulPreturilorAdapter.getAuthorizationGuide();
  assert(guide.institution.includes('Consiliul Concurenței'), 'Ghidul precizează clar instituția responsabilă');
  assert(guide.steps.length >= 3, 'Ghidul oferă pași metodici de solicitare oficială a accesului');

  const failedImport = await monitorAdapter.importData();
  assert(failedImport.success === false, 'Importul neautorizat este refuzat în condiții sigure');
  assert(failedImport.syncRun.status === 'failed', 'Jurnalizarea înregistrării de sincronizare indică statutul failed');

  // --- TEST 10: LidlPriceFileAdapter și importData cu simulare sigură ---
  const lidlAdapter = new LidlPriceFileAdapter();
  assert(lidlAdapter.id === 'src-lidl-file' && lidlAdapter.defaultStoreId === 'lidl', 'LidlPriceFileAdapter este preconfigurat corect pentru magazinul Lidl');

  const sampleLidlContent = `Denumire,Pret,Unitate,cod_bare
Lapte proaspăt 1.5% grăsime 1L,6.29,l,5941014002341
Ouă proaspete M 10 buc,10.99,buc,5941889001221`;

  const importResult = await lidlAdapter.importData({
    content: sampleLidlContent,
    format: 'csv',
    dryRun: false
  });

  assert(importResult.success === true, 'Importul fișierului de prețuri a rulat cu succes');
  assert(importResult.importedOffers.length === 2, 'Două oferte au fost importate și asociate cu catalogul');
  assert(importResult.syncRun.recordsImported === 2, 'Jurnalul de sincronizare a înregistrat 2 prețuri importate');

  console.log(`\n🎉 Toate cele 10 seturi de teste pentru Surse & Prețuri au rulat cu succes: ${passed} trecute, ${failed} eșuate.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runSourcesTests();
