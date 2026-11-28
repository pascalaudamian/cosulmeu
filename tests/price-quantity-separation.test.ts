// tests/price-quantity-separation.test.ts
// Suită izolată de teste pentru separarea preț vs cantitate, protecția pre-publicare și auditul administrativ.
// Rulează 100% izolat în memorie (COSUL_MEU_ISOLATED_TEST=1) — NU modifică baza de date Supabase din producție.

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, it, before, after } from 'node:test';

import { PriceExtractor } from '../src/indexing/catalog/PriceExtractor.ts';
import { CatalogParserEngine } from '../src/indexing/catalog/CatalogParserEngine.ts';
import { CatalogStagingManager } from '../src/indexing/catalog/CatalogStagingManager.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { Product, ProductOffer } from '../src/types.ts';

describe('Separare Preț vs Cantitate, Validare Pre-Publicare și Audit Administrativ (Izolat)', () => {
  let server: http.Server;
  let baseUrl = '';
  let adminToken = '';

  const recentIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const recentDate = recentIso.slice(0, 10);

  const seedTestCatalogInMemory = () => {
    const products: Product[] = [
      {
        id: 'prod-test-carlsberg',
        name: 'Bere Carlsberg 0,33 L',
        brand: 'Carlsberg',
        category: 'Băuturi',
        defaultUnit: 'buc',
        packageWeightOrVolume: 0.33,
        packageUnit: 'l',
        normalizedUnit: 'l',
        baseReferencePrice: 4.99
      },
      {
        id: 'prod-test-ccm',
        name: 'CCM 7.3 Activități economice',
        brand: 'Nespecificat',
        category: 'Alte produse',
        defaultUnit: 'buc',
        packageWeightOrVolume: 1,
        packageUnit: 'buc',
        normalizedUnit: 'buc',
        baseReferencePrice: 0.39
      },
      {
        id: 'prod-test-amigo',
        name: 'Cafea solubilă Amigo 13 g',
        brand: 'Amigo',
        category: 'Băuturi',
        defaultUnit: 'buc',
        packageWeightOrVolume: 13,
        packageUnit: 'g',
        normalizedUnit: 'kg',
        baseReferencePrice: 1.11
      },
      {
        id: 'prod-test-pulpe',
        name: 'Pulpe de pui întregi 100 g',
        brand: 'Lidl',
        category: 'Carne și pește',
        defaultUnit: 'g',
        packageWeightOrVolume: 100,
        packageUnit: 'g',
        normalizedUnit: 'kg',
        baseReferencePrice: 0.99
      }
    ];

    const offers: ProductOffer[] = [
      {
        id: 'off-test-carlsberg-wrong',
        productId: 'prod-test-carlsberg',
        storeId: 'kaufland',
        price: 0.33,
        normalPrice: 4.99,
        unitPrice: 1.0,
        unitPriceMeasure: 'lei/l',
        isPromo: false,
        loyaltyCardRequired: false,
        observationDate: recentDate,
        source: 'verified',
        confidenceLevel: 'high',
        verificationStatus: 'pending',
        lastChecked: recentIso
      },
      {
        id: 'off-test-ccm-isolated',
        productId: 'prod-test-ccm',
        storeId: 'mega-image',
        price: 0.39,
        unitPrice: 0.39,
        unitPriceMeasure: 'lei/buc',
        isPromo: false,
        loyaltyCardRequired: false,
        observationDate: recentDate,
        source: 'verified',
        confidenceLevel: 'low',
        verificationStatus: 'isolated',
        isFlaggedAnomaly: true,
        anomalyReason: 'Text extras din raport sustenabilitate CCM / Taxonomie UE.',
        lastChecked: recentIso
      },
      {
        id: 'off-test-amigo-valid',
        productId: 'prod-test-amigo',
        storeId: 'penny',
        price: 1.11,
        unitPrice: 85.38,
        unitPriceMeasure: 'lei/kg',
        isPromo: false,
        loyaltyCardRequired: false,
        observationDate: recentDate,
        source: 'verified',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        lastChecked: recentIso
      },
      {
        id: 'off-test-pulpe-valid',
        productId: 'prod-test-pulpe',
        storeId: 'lidl',
        price: 0.99,
        unitPrice: 9.9,
        unitPriceMeasure: 'lei/kg',
        isPromo: true,
        loyaltyCardRequired: false,
        observationDate: recentDate,
        source: 'verified',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        lastChecked: recentIso
      }
    ];

    for (const p of products) {
      StorageService.addCustomProduct(p);
    }
    StorageService.saveProductOffers(offers);
    StorageService.saveCatalogExtractedOffers([
      {
        id: 'stg-test-carlsberg',
        runId: 'run-test-1',
        documentId: 'doc-test-kaufland',
        retailerId: 'kaufland',
        rawTitle: 'Bere Carlsberg 0,33 L',
        matchedProductId: 'prod-test-carlsberg',
        normalPrice: 5.49,
        promoPrice: 4.99,
        effectivePrice: 4.99,
        currency: 'RON',
        packageQuantity: 0.33,
        packageUnit: 'l',
        isPromo: true,
        matchConfidence: 0.95,
        matchMethod: 'name_brand_similarity',
        stagingStatus: 'PUBLISHED',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z'
      }
    ]);
    StorageService.saveCatalogDocuments([
      {
        id: 'doc-test-kaufland',
        sourceId: 'cat-src-kaufland',
        retailerId: 'kaufland',
        documentUrl: 'https://www.kaufland.ro/oferte/test-catalog.html',
        title: 'Catalog Kaufland Test',
        format: 'html',
        downloadStatus: 'downloaded',
        parseStatus: 'parsed',
        rawExtractedCount: 1,
        matchedCount: 1,
        validatedCount: 1,
        publishedCount: 1,
        createdAt: '2026-11-15T09:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z'
      }
    ]);
  };

  before(async () => {
    seedTestCatalogInMemory();
    const serverMod = await import('../server.ts');
    adminToken = serverMod.ADMIN_API_KEY;
    server = await new Promise<http.Server>(resolve => {
      const srv = serverMod.app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('1. Interpretează corect „Bere 0,33 L – 3,49 lei”', () => {
    const price = PriceExtractor.extractPriceWithContext('Bere 0,33 L – 3,49 lei');
    const pkg = PriceExtractor.extractPackagingSafely('Bere 0,33 L – 3,49 lei');
    assert.strictEqual(price.value, 3.49);
    assert.strictEqual(price.currency, 'RON');
    assert.strictEqual(price.proofType, 'currency_label');
    assert.strictEqual(pkg.packageQuantity, 0.33);
    assert.strictEqual(pkg.packageUnit, 'l');
    assert.strictEqual(pkg.volume, 0.33);
  });

  it('2. Interpretează corect „Suc 250 ml – 2,99 lei”', () => {
    const price = PriceExtractor.extractPriceWithContext('Suc 250 ml – 2,99 lei');
    const pkg = PriceExtractor.extractPackagingSafely('Suc 250 ml – 2,99 lei');
    assert.strictEqual(price.value, 2.99);
    assert.strictEqual(pkg.packageQuantity, 250);
    assert.strictEqual(pkg.packageUnit, 'ml');
    assert.strictEqual(pkg.volume, 250);
  });

  it('3. Interpretează corect „Cafea 100 g – 8,49 lei”', () => {
    const price = PriceExtractor.extractPriceWithContext('Cafea 100 g – 8,49 lei');
    const pkg = PriceExtractor.extractPackagingSafely('Cafea 100 g – 8,49 lei');
    assert.strictEqual(price.value, 8.49);
    assert.strictEqual(pkg.packageQuantity, 100);
    assert.strictEqual(pkg.packageUnit, 'g');
    assert.strictEqual(pkg.weight, 100);
  });

  it('4. Respinge cantitățile, volumele și procentele ca valori de preț', () => {
    assert.strictEqual(PriceExtractor.parseExplicitPriceField('250 ml'), null);
    assert.strictEqual(PriceExtractor.parseExplicitPriceField('100 g'), null);
    assert.strictEqual(PriceExtractor.parseExplicitPriceField('0,33 L'), null);
    assert.strictEqual(PriceExtractor.parseExplicitPriceField('33%'), null);
    assert.strictEqual(PriceExtractor.parseExplicitPriceField('3+3 bucăți'), null);
    assert.strictEqual(PriceExtractor.parseExplicitPriceField('12,99 lei'), 12.99);
  });

  it('5. Parser HTML Kaufland (.k-product-tile) separă prețul real de prețul unitar / cantitate', async () => {
    const html = `
      <html><body>
        <div class="k-product-tile">
          <div class="k-product-tile__title">Carlsberg Bere blondă</div>
          <div class="k-product-tile__subtitle">0,33 l</div>
          <div class="k-product-tile__unit-price">0,33 l | 1 l = 15,12 lei</div>
          <div class="k-price-tag__old-price">5,99</div>
          <div class="k-price-tag__price">4,99</div>
        </div>
        <div class="k-product-tile">
          <div class="k-product-tile__title">Agros Condimente</div>
          <div class="k-product-tile__subtitle">100 g</div>
          <div class="k-product-tile__unit-price">100 g (0,25 kg echiv.) | 1 kg = 47,90 lei</div>
          <div class="k-price-tag__price">4,79</div>
        </div>
      </body></html>
    `;
    const parsed = await CatalogParserEngine.parseCatalog(html, 'html', 'kaufland', 'https://www.kaufland.ro/oferte.html');
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.offers.length, 2);
    const carlsberg = parsed.offers.find(o => o.rawTitle.includes('Carlsberg'))!;
    assert.strictEqual(carlsberg.effectivePrice, 4.99);
    assert.strictEqual(carlsberg.normalPrice, 5.99);
    assert.strictEqual(carlsberg.packageQuantity, 0.33);
    assert.strictEqual(carlsberg.packageUnit, 'l');
    const agros = parsed.offers.find(o => o.rawTitle.includes('Agros'))!;
    assert.strictEqual(agros.effectivePrice, 4.79);
  });

  it('6. Parser HTML generic ignoră unit-price și respinge titlurile/antetele non-produs', async () => {
    const html = `
      <html><body>
        <article class="product-card">
          <h3 class="product-title">Lactate și ouă</h3>
          <span class="price">0,33 lei</span>
        </article>
        <article class="product-card">
          <h3 class="product-title">Berea Csíki Sör 0,33 L</h3>
          <div class="unit-price">1 L = 12,09 lei</div>
          <span class="price">3,99 lei</span>
        </article>
      </body></html>
    `;
    const parsed = await CatalogParserEngine.parseCatalog(html, 'html', 'lidl', 'https://www.lidl.ro/oferte');
    assert.strictEqual(parsed.offers.length, 1);
    assert.strictEqual(parsed.offers[0].rawTitle, 'Berea Csíki Sör 0,33 L');
    assert.strictEqual(parsed.offers[0].effectivePrice, 3.99);
  });

  it('7. Parser Mega Image respinge paginile ESG / Taxonomie UE / CCM și nu divide prin 100', async () => {
    const esgHtml = `
      <html><body>
        <main>
          <h1>Raport anual și Taxonomie UE - Activități economice</h1>
          <div>CCM 7.3 Renovare clădiri 0,39</div>
        </main>
      </body></html>
    `;
    const res = await CatalogParserEngine.parseCatalog(esgHtml, 'html', 'mega-image', 'https://www.mega-image.ro/raport');
    assert.strictEqual(res.offers.length, 0);
  });

  it('8. Parser CSV & XML respinge cantitățile/procentele din câmpul de preț și păstrează prețurile valide', async () => {
    const csv = [
      'title,brand,category,price,normal_price',
      'Suc natural,Botanic,Bauturi,250 ml,',
      'Reducere bere,Ursus,Bauturi,33%,',
      'Cafea boabe 500 g,Jacobs,Bauturi,"29,99 lei",34.99'
    ].join('\n');
    const csvRes = await CatalogParserEngine.parseCatalog(csv, 'csv', 'carrefour');
    assert.strictEqual(csvRes.offers.length, 1);
    assert.strictEqual(csvRes.offers[0].effectivePrice, 29.99);
    assert.strictEqual(csvRes.offers[0].normalPrice, 34.99);

    const xml = `
      <products>
        <product><name>Bere Ursus 0.33 L</name><price>330 ml</price></product>
        <product><name>Ulei Bunica 1 L</name><price>8,49 lei</price></product>
      </products>
    `;
    const xmlRes = await CatalogParserEngine.parseCatalog(xml, 'xml', 'auchan');
    assert.strictEqual(xmlRes.offers.length, 1);
    assert.strictEqual(xmlRes.offers[0].rawTitle, 'Ulei Bunica 1 L');
    assert.strictEqual(xmlRes.offers[0].effectivePrice, 8.49);
  });

  it('9. Boundary guards la ambalare previn extragerea greșită din coduri TV, 4G sau g/m²', () => {
    const tvPkg = PriceExtractor.extractPackagingSafely('Televizor LG LED 55UA73003LA, 139 cm, 4K');
    assert.strictEqual(tvPkg.packageQuantity, undefined);
    const camPkg = PriceExtractor.extractPackagingSafely('Camera auto DVR 70mai A800SE-4G, 4K');
    assert.strictEqual(camPkg.packageQuantity, undefined);
    const pavPkg = PriceExtractor.extractPackagingSafely('Pavilion gradina husa poliester 160 g/m² UV 50');
    assert.strictEqual(pavPkg.packageQuantity, undefined);
  });

  it('10. detectQuantityAsPrice prinde cazurile reale (0.25, 0.33, 0.75, 654, 700) și nu blochează prețurile mici valide', () => {
    assert.strictEqual(
      PriceExtractor.detectQuantityAsPrice({ title: 'Carlsberg 0,33 L', effectivePrice: 0.33, packageQuantity: 0.33, packageUnit: 'l' }).isConfused,
      true
    );
    assert.strictEqual(
      PriceExtractor.detectQuantityAsPrice({ title: 'Cuvee de Purcari 0,75 L', effectivePrice: 0.75, packageQuantity: 0.75, packageUnit: 'l' }).isConfused,
      true
    );
    assert.strictEqual(
      PriceExtractor.detectQuantityAsPrice({ title: 'Fairy 654 ml', effectivePrice: 654, packageQuantity: 654, packageUnit: 'ml' }).isConfused,
      true
    );
    assert.strictEqual(
      PriceExtractor.detectQuantityAsPrice({ title: 'Pâinea maia 700 g', effectivePrice: 700, packageQuantity: 700, packageUnit: 'g' }).isConfused,
      true
    );
    assert.strictEqual(
      PriceExtractor.detectQuantityAsPrice({ title: 'Agros 250 ml', effectivePrice: 0.25, packageQuantity: 250, packageUnit: 'ml' }).isConfused,
      true
    );

    const amigoValid = PriceExtractor.validateOfferPrice({
      title: 'Cafea solubilă Amigo 13 g',
      effectivePrice: 1.11,
      packageQuantity: 13,
      packageUnit: 'g'
    });
    assert.strictEqual(amigoValid.status, 'VALID');

    const pulpeValid = PriceExtractor.validateOfferPrice({
      title: 'Pulpe de pui întregi 100 g',
      effectivePrice: 0.99,
      packageQuantity: 100,
      packageUnit: 'g'
    });
    assert.strictEqual(pulpeValid.status, 'VALID');
  });

  it('11. Gate-ul de validare pre-publicare blochează oferte cu preț confundat cu cantitatea sau promo > normal', async () => {
    const invalidCheck = PriceExtractor.validateOfferPrice({
      title: 'BOTTLEGREEN 275 ml',
      effectivePrice: 0.27,
      packageQuantity: 275,
      packageUnit: 'ml'
    });
    assert.strictEqual(invalidCheck.status, 'INVALID');
    assert.strictEqual(invalidCheck.code, 'QUANTITY_AS_PRICE');

    const promoCheck = PriceExtractor.validateOfferPrice({
      title: 'Lapte UHT 1 L',
      normalPrice: 5.5,
      promoPrice: 7.2,
      effectivePrice: 7.2,
      packageQuantity: 1,
      packageUnit: 'l'
    });
    assert.strictEqual(promoCheck.status, 'INVALID');
    assert.strictEqual(promoCheck.code, 'EFFECTIVE_GT_NORMAL');
  });

  it('12. PriceComparisonService.isOfferValid exclude ofertele isolated/rejected/flagged și păstrează ofertele valide', () => {
    const offers = StorageService.getProductOffers();
    const ccm = offers.find(o => o.id === 'off-test-ccm-isolated')!;
    const amigo = offers.find(o => o.id === 'off-test-amigo-valid')!;
    assert.strictEqual(PriceComparisonService.isOfferValid(ccm), false);
    assert.strictEqual(PriceComparisonService.isOfferValid(amigo), true);
  });

  it('13. Endpoint-urile publice (/api/products, /api/products/:id, /api/catalog/compare) exclud ofertele izolate', async () => {
    const resList = await fetch(`${baseUrl}/api/products?search=CCM&limit=20`);
    assert.strictEqual(resList.status, 200);
    const listJson: any = await resList.json();
    const ccmProd = listJson.products.find((p: any) => p.id === 'prod-test-ccm');
    assert.ok(ccmProd, 'Produsul canonic rămâne în index');
    assert.strictEqual(ccmProd.offersCount, 0, 'Oferta izolată nu este numărată ca ofertă activă');
    assert.strictEqual(ccmProd.minPrice, null, 'Prețul izolat nu este afișat în catalogul public');

    const resDetail = await fetch(`${baseUrl}/api/products/prod-test-ccm`);
    assert.strictEqual(resDetail.status, 200);
    const detailJson: any = await resDetail.json();
    assert.strictEqual(detailJson.comparison.offers.length, 0, 'Detaliul produsului nu expune oferta izolată');

    const resCompare = await fetch(`${baseUrl}/api/catalog/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 'li-1', productId: 'prod-test-ccm', name: 'CCM 7.3', quantity: 1, unit: 'buc', checked: false }]
      })
    });
    assert.strictEqual(resCompare.status, 200);
    const cmpJson: any = await resCompare.json();
    const megaStore = (cmpJson.comparisons || []).find((s: any) => s.storeId === 'mega-image');
    assert.ok(!megaStore || megaStore.matchedItemsCount === 0, 'Comparația de coș exclude ofertele izolate');
  });

  it('14. Endpoint-ul /api/admin/price-audit impune requireAdminAuth (401/403 fără token, 200 cu token)', async () => {
    const noAuthRes = await fetch(`${baseUrl}/api/admin/price-audit`);
    assert.strictEqual(noAuthRes.status, 401);

    const badAuthRes = await fetch(`${baseUrl}/api/admin/price-audit`, {
      headers: { Authorization: 'Bearer token-gresit' }
    });
    assert.strictEqual(badAuthRes.status, 403);

    const okRes = await fetch(`${baseUrl}/api/admin/price-audit?category=confirmed_wrong`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(okRes.status, 200);
    const okJson: any = await okRes.json();
    assert.strictEqual(okJson.success, true);
    assert.ok(okJson.summary.quantityConfusedCount >= 1);
    assert.ok(okJson.items.some((i: any) => i.offerId === 'off-test-carlsberg-wrong'));
  });

  it('15. Validarea Zod pe /api/admin/price-audit/remediate respinge payload-urile invalide cu 400', async () => {
    const badRes = await fetch(`${baseUrl}/api/admin/price-audit/remediate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        offerId: 'off-test-carlsberg-wrong',
        action: 'fix_price'
        // lipsește newPrice
      })
    });
    assert.strictEqual(badRes.status, 400);
  });

  it('16. Flux complet preview-batch -> remediate corectează oferta greșită și actualizează unitPrice', async () => {
    const previewRes = await fetch(`${baseUrl}/api/admin/price-audit/preview-batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [
          {
            offerId: 'off-test-carlsberg-wrong',
            action: 'fix_price',
            newPrice: 4.99,
            newNormalPrice: 5.49,
            reason: 'Corecție din catalog Kaufland'
          }
        ]
      })
    });
    assert.strictEqual(previewRes.status, 200);
    const previewJson: any = await previewRes.json();
    assert.strictEqual(previewJson.dryRun, true);
    assert.strictEqual(previewJson.previews.length, 1);
    assert.strictEqual(previewJson.previews[0].newPrice, 4.99);

    const applyRes = await fetch(`${baseUrl}/api/admin/price-audit/remediate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dryRun: false,
        items: [
          {
            offerId: 'off-test-carlsberg-wrong',
            action: 'fix_price',
            newPrice: 4.99,
            newNormalPrice: 5.49,
            reason: 'Corecție din catalog Kaufland'
          }
        ]
      })
    });
    assert.strictEqual(applyRes.status, 200);
    const applyJson: any = await applyRes.json();
    assert.strictEqual(applyJson.success, true);
    assert.strictEqual(applyJson.affectedOffersCount, 1);

    const updatedOffer = StorageService.getProductOffers().find(o => o.id === 'off-test-carlsberg-wrong')!;
    assert.strictEqual(updatedOffer.price, 4.99);
    assert.strictEqual(updatedOffer.verificationStatus, 'verified');
    assert.strictEqual(Number(updatedOffer.unitPrice.toFixed(2)), Number(((4.99 / 0.33)).toFixed(2)));
  });
});
