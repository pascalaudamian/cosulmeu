// tests/catalog-importer.test.ts
// Test suite pentru Catalog Importer: SSRF, Parsare HTML/PDF/CSV, Staging, Matching și Publicare

import assert from 'node:assert';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader';
import { CatalogParserEngine } from '../src/indexing/catalog/CatalogParserEngine';
import { CatalogSourceDiscovery } from '../src/indexing/catalog/CatalogSourceDiscovery';
import { CatalogStagingManager } from '../src/indexing/catalog/CatalogStagingManager';
import { StorageService } from '../src/services/StorageService';
import { CatalogDocument } from '../src/indexing/catalog/catalogTypes';

async function runTests() {
  console.log('🧪 Pornire Teste Catalog Importer...\n');

  // =========================================================================
  // TEST 1: Protecție SSRF și Validare URL
  // =========================================================================
  console.log('1. Verificare Protecție SSRF și Validare Domenii Retaileri...');

  // URL-uri ilegitime / atacuri SSRF ce TREBUIE respinse
  const unsafeUrls = [
    'http://localhost:3000/api/admin',
    'http://127.0.0.1/etc/passwd',
    'http://0.0.0.0:8080',
    'http://10.0.1.50/internal',
    'http://192.168.0.1/router',
    'http://172.20.0.1/admin',
    'http://169.254.169.254/computeMetadata/v1/',
    'file:///etc/hosts',
    'ftp://files.example.com/catalog.pdf',
    'https://attacker-domain.xyz/phishing-catalog.html'
  ];

  for (const url of unsafeUrls) {
    const safety = CatalogDownloader.validateUrlSafety(url);
    assert.strictEqual(safety.safe, false, `URL-ul nesigur nu a fost blocat: ${url}`);
    assert.ok(safety.reason, `Lipsește motivul blocării pentru ${url}`);
  }

  // URL-uri legitime ale retailerilor ce TREBUIE permise
  const safeUrls = [
    'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219',
    'https://lidl.ro/cataloage',
    'https://www.kaufland.ro/cataloage-cu-reduceri.html',
    'https://assets.leaflets.schwarz/leaflets/pdfs/kaufland.pdf',
    'https://carrefour.ro/cataloage',
    'https://www.penny.ro/vezi-pliantele-saptamanii',
    'https://www.auchan.ro/cataloage-promotii',
    'https://www.profi.ro/reviste-profi/',
    'https://www.mega-image.ro/promotii-online/reviste-promo-online',
    'https://www.metro.ro/oferte/cataloage'
  ];

  for (const url of safeUrls) {
    const safety = CatalogDownloader.validateUrlSafety(url);
    assert.strictEqual(safety.safe, true, `URL legitim al unui retailer a fost respins eronat: ${url} (${safety.reason})`);
  }
  console.log('   ✅ Protecția SSRF funcționează conform cerințelor de securitate.');

  // =========================================================================
  // TEST 2: Parsare HTML Catalog (Structura Lidl cu data-grid-data & JSON-LD)
  // =========================================================================
  console.log('2. Testare Parsare Structurată Catalog HTML...');

  const sampleLidlHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Lapte Proaspăt 1.5% 1L",
          "brand": "Pilos",
          "offers": {
            "price": "4.99",
            "priceCurrency": "RON",
            "priceValidUntil": "2026-12-31"
          }
        }
        </script>
      </head>
      <body>
        <div data-grid-data='{"title":"Cotlet de porc fără os","fullTitle":"Cotlet de porc fără os feliat 500g","brand":"Camara Noastra","category":"Carne","price":{"price":"16.99","discount":{"price":"12.99"}},"packaging":"500g","validFrom":"2026-11-01","validUntil":"2026-11-15"}'>
          <h3>Cotlet de porc fără os</h3>
          <span class="m-price__price">12,99 lei</span>
        </div>
        <div data-grid-data='{"title":"Bere Blondă 5+1","brand":"Argus","price":{"price":"18.99","loyaltyCardPrice":"14.99"},"packaging":"6x0.5L"}'>
          <span class="lidl-plus">Lidl Plus</span>
        </div>
      </body>
    </html>
  `;

  const htmlParsed = CatalogParserEngine.parseHtmlCatalog(sampleLidlHtml, 'lidl');
  assert.strictEqual(htmlParsed.success, true);
  assert.ok(htmlParsed.offers.length >= 2, `Trebuie să extragă minim 2 oferte, a extras ${htmlParsed.offers.length}`);

  const cotlet = htmlParsed.offers.find(o => o.rawTitle.includes('Cotlet'));
  assert.ok(cotlet, 'Oferta Cotlet de porc nu a fost extrasă.');
  assert.strictEqual(cotlet.normalPrice, 16.99);
  assert.strictEqual(cotlet.promoPrice, 12.99);
  assert.strictEqual(cotlet.effectivePrice, 12.99);
  assert.strictEqual(cotlet.packageQuantity, 500);
  assert.strictEqual(cotlet.packageUnit, 'g');
  assert.strictEqual(cotlet.isPromo, true);

  const bere = htmlParsed.offers.find(o => o.rawTitle.includes('Bere'));
  assert.ok(bere, 'Oferta Bere nu a fost extrasă.');
  assert.strictEqual(bere.loyaltyPrice, 14.99);
  assert.strictEqual(bere.loyaltyCardName, 'Lidl Plus');

  console.log('   ✅ Parsarea HTML a extras prețuri standard, reduceri și oferte condiționate de card.');

  // =========================================================================
  // TEST 3: Parsare Fișiere Tabelare (CSV și XML)
  // =========================================================================
  console.log('3. Testare Parsare Tabele CSV și Feed XML...');

  const sampleCsv = `Denumire Produs,Marca,Cod Bare,Pret RON,Valabilitate
Unt de masa 65% 200g,Albalact,5941012345678,8.50,2026-12-31
Paine Toast Integrala 500g,Dobrogea,5942012345678,5.20,2026-12-31`;

  const csvParsed = CatalogParserEngine.parseCsvCatalog(sampleCsv);
  assert.strictEqual(csvParsed.success, true);
  assert.strictEqual(csvParsed.offers.length, 2);
  assert.strictEqual(csvParsed.offers[0].rawTitle, 'Unt de masa 65% 200g');
  assert.strictEqual(csvParsed.offers[0].normalPrice, 8.5);
  assert.strictEqual(csvParsed.offers[0].rawBarcode, '5941012345678');

  const sampleXml = `
    <catalog>
      <product>
        <title>Zahar Margaritar 1kg</title>
        <marca>Margaritar</marca>
        <price>4.29</price>
      </product>
    </catalog>
  `;
  const xmlParsed = CatalogParserEngine.parseXmlCatalog(sampleXml);
  assert.strictEqual(xmlParsed.success, true);
  assert.strictEqual(xmlParsed.offers.length, 1);
  assert.strictEqual(xmlParsed.offers[0].normalPrice, 4.29);

  console.log('   ✅ Parsarea CSV și XML extrage corect coloanele cheie.');

  // =========================================================================
  // TEST 4: Configurație Cele 8 Surse de Retaileri Oficiale
  // =========================================================================
  console.log('4. Verificare CatalogSourceDiscovery pentru cei 8 retaileri...');
  const sources = StorageService.getCatalogSources();
  assert.strictEqual(sources.length, 8, 'Trebuie să fie configurate exact 8 surse de retaileri.');

  const expectedRetailers = ['lidl', 'kaufland', 'carrefour', 'penny', 'auchan', 'profi', 'mega-image', 'metro'];
  for (const rId of expectedRetailers) {
    const s = sources.find(src => src.retailerId === rId);
    assert.ok(s, `Lipsește sursa de catalog pentru retailerul: ${rId}`);
    assert.ok(s.legalStatusNotice, `Lipsește avertismentul de conformitate legală pentru ${rId}`);
  }

  const lidlSource = sources.find(s => s.retailerId === 'lidl')!;
  assert.strictEqual(lidlSource.status, 'active');
  console.log('   ✅ Toate cele 8 surse de retaileri sunt prezente cu audit de conformitate.');

  // =========================================================================
  // TEST 5: Flux de Staging, Validare și Publicare
  // =========================================================================
  console.log('5. Testare Staging Workflow și Publicare în Catalogul Public...');

  const mockDoc: CatalogDocument = {
    id: `doc-test-${Date.now()}`,
    sourceId: 'cat-src-test',
    retailerId: 'lidl',
    documentUrl: 'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219',
    title: 'Test Document Catalog',
    format: 'html',
    downloadStatus: 'downloaded',
    parseStatus: 'parsed',
    rawExtractedCount: 2,
    matchedCount: 2,
    validatedCount: 2,
    publishedCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  StorageService.addCatalogDocument(mockDoc);

  // Oferte extrase în staging: una validată (asociată cu un produs existent) și una în review
  const testExtractedOffers = [
    {
      id: `stg-test-1`,
      runId: 'run-test-1',
      documentId: mockDoc.id,
      retailerId: 'lidl',
      rawTitle: 'Lapte Proaspăt 1.5% 1L',
      normalPrice: 5.50,
      effectivePrice: 4.80,
      currency: 'RON',
      packageQuantity: 1,
      packageUnit: 'l',
      unitPrice: 4.80,
      unitPriceMeasure: 'lei/l',
      isPromo: true,
      matchedProductId: 'prod-lapte-15', // Produs existent în mockData
      matchedProductName: 'Lapte proaspăt 1.5% 1L',
      matchConfidence: 0.95,
      matchMethod: 'name_brand_similarity' as const,
      stagingStatus: 'VALIDATED' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: `stg-test-2`,
      runId: 'run-test-1',
      documentId: mockDoc.id,
      retailerId: 'lidl',
      rawTitle: 'Produs Nemaivăzut Fără Potrivire 250g',
      normalPrice: 12.00,
      effectivePrice: 12.00,
      currency: 'RON',
      isPromo: false,
      matchConfidence: 0.2,
      matchMethod: 'unmatched' as const,
      stagingStatus: 'NEEDS_REVIEW' as const,
      validationErrors: ['Niciun produs echivalent identificat în catalogul unificat.'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  StorageService.addCatalogExtractedOffers(testExtractedOffers);

  // Verificare că oferta în NEEDS_REVIEW nu este publicată automat
  const initialOffersCount = StorageService.getProductOffers().length;
  const pubResult = await CatalogStagingManager.publishValidatedOffers(['stg-test-1']);
  assert.strictEqual(pubResult.publishedCount, 1, 'Trebuie să fie publicată exact oferta validată.');

  const updatedStaged = StorageService.getCatalogExtractedOffers().find(o => o.id === 'stg-test-1')!;
  assert.strictEqual(updatedStaged.stagingStatus, 'PUBLISHED');

  const unvalidatedStaged = StorageService.getCatalogExtractedOffers().find(o => o.id === 'stg-test-2')!;
  assert.strictEqual(unvalidatedStaged.stagingStatus, 'NEEDS_REVIEW');

  // Verificare că oferta a ajuns în product_offers
  const publishedOffer = StorageService.getProductOffers().find(
    o => o.productId === 'prod-lapte-15' && o.storeId === 'lidl'
  );
  assert.ok(publishedOffer, 'Oferta nu a fost găsită în product_offers.');
  assert.strictEqual(publishedOffer.price, 4.80);
  assert.strictEqual(publishedOffer.verificationStatus, 'verified');

  console.log('   ✅ Fluxul de Staging previne publicarea ofertelor nesigure și publică datele validate.');

  // =========================================================================
  // TEST 6: Rulare Cap-Coadă pe Catalogul Real Live Lidl România
  // =========================================================================
  console.log('6. Execuție Pilot Live pe Catalogul Public Lidl România...');

  const livePilotResult = await CatalogStagingManager.runPilotImportLidl();
  console.log(`   Rezultat descărcare live: status=${livePilotResult.success ? 'OK' : 'FAIL'}, extrase=${livePilotResult.totalExtracted}, potrivite=${livePilotResult.autoMatched}, publicate=${livePilotResult.published}`);

  assert.strictEqual(livePilotResult.success, true, `Pilotul live a eșuat: ${livePilotResult.error}`);
  assert.ok(livePilotResult.totalExtracted > 0, 'Nu a fost extrasă nicio ofertă din catalogul real Lidl.');
  assert.ok(livePilotResult.sampleOffers.length > 0, 'Lipsește eșantionul de oferte extrase.');

  const sample = livePilotResult.sampleOffers[0];
  console.log(`   Exemplu extras: "${sample.rawTitle}" -> ${sample.effectivePrice} ${sample.currency} (${sample.stagingStatus})`);
  assert.ok(sample.rawTitle.length >= 2, 'Titlul extras este invalid.');
  assert.ok(sample.effectivePrice > 0, 'Prețul extras este invalid.');

  // =========================================================================
  // TEST 7: Rulare Cap-Coadă pe Catalogul Săptămânal PDF Kaufland România
  // =========================================================================
  console.log('7. Execuție Pilot Live pe Catalogul Public Kaufland România (PDF)...');

  const kauflandPilotResult = await CatalogStagingManager.runPilotImportForRetailer('kaufland');
  console.log(`   Rezultat descărcare live Kaufland: status=${kauflandPilotResult.success ? 'OK' : 'FAIL'}, extrase=${kauflandPilotResult.totalExtracted}, potrivite=${kauflandPilotResult.autoMatched}, publicate=${kauflandPilotResult.published}`);

  assert.strictEqual(kauflandPilotResult.success, true, `Pilotul live Kaufland a eșuat: ${kauflandPilotResult.error}`);
  assert.ok(kauflandPilotResult.totalExtracted > 0, 'Nu a fost extrasă nicio ofertă din catalogul real Kaufland.');
  assert.ok(kauflandPilotResult.sampleOffers.length > 0, 'Lipsește eșantionul de oferte extrase Kaufland.');

  const sampleK = kauflandPilotResult.sampleOffers[0];
  console.log(`   Exemplu extras Kaufland: "${sampleK.rawTitle}" -> ${sampleK.effectivePrice} ${sampleK.currency} (${sampleK.stagingStatus})`);
  assert.ok(sampleK.rawTitle.length >= 2, 'Titlul extras Kaufland este invalid.');
  assert.ok(sampleK.effectivePrice > 0, 'Prețul extras Kaufland este invalid.');

  console.log('\n🎉 TOATE TESTELE PENTRU CATALOG IMPORTER AU FOST VALIDATE CU SUCCES!');
}

runTests().catch(err => {
  console.error('\n❌ Eroare în testele Catalog Importer:', err);
  process.exit(1);
});
