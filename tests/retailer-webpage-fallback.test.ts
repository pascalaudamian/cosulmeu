// tests/retailer-webpage-fallback.test.ts
// Teste pentru fallback-ul pe pagina web a retailerului, extragerea și persistența imaginilor produselor și deduplicarea magazinelor

import 'dotenv/config';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, it, before, after } from 'node:test';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader.ts';
import { CatalogParserEngine } from '../src/indexing/catalog/CatalogParserEngine.ts';
import { CatalogStagingManager } from '../src/indexing/catalog/CatalogStagingManager.ts';
import { CatalogDocument } from '../src/indexing/catalog/catalogTypes.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { OptimizationService } from '../src/services/OptimizationService.ts';
import { PRODUCTS, STORES } from '../src/data/mockData.ts';

describe('Retailer Webpage Fallback, Product Images & Store Key Deduplication', () => {
  let server: http.Server;
  let baseUrl = '';
  let adminToken = '';

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  });

  before(async () => {
    const serverMod = await import('../server.ts');
    adminToken = serverMod.ADMIN_API_KEY;
    server = await new Promise<http.Server>(resolve => {
      const srv = serverMod.app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('1. Extrage și rezolvă corect URL-urile imaginilor din HTML (data-src, srcset, relative, Carrefour, Penny, Mega Image, JSON-LD, CSV, XML)', async () => {
    const html = `
      <html>
        <body>
          <div class="product-card">
            <img data-src="/media/lapte-zuzu.jpg" src="data:image/svg+xml;base64,PHN2Zz4=" alt="Lapte" />
            <h3>Lapte Zuzu 3.5% 1L</h3>
            <span class="current-price">7,49 lei</span>
          </div>
          <div class="product-card">
            <picture>
              <source srcset="//cdn.example.ro/img/iaurt-2x.webp 2x, //cdn.example.ro/img/iaurt-1x.webp 1x" />
              <img src="/images/blank.gif" />
            </picture>
            <h3>Iaurt Grecesc Olympus 400g</h3>
            <span class="current-price">8,99 lei</span>
          </div>
        </body>
      </html>
    `;
    const genericRes = CatalogParserEngine.parseHtmlCatalog(html, 'profi', 'https://www.profi.ro/oferte/');
    assert.strictEqual(genericRes.success, true);
    assert.strictEqual(genericRes.offers.length, 2);
    assert.strictEqual(genericRes.offers[0].imageUrl, 'https://www.profi.ro/media/lapte-zuzu.jpg');
    assert.strictEqual(genericRes.offers[1].imageUrl, 'https://cdn.example.ro/img/iaurt-2x.webp');

    const carrefourHtml = `
      <div class="product_card">
        <img data-src="/media/catalog/product/u/l/ulei-carrefour.jpg" />
        <div class="product_info">
          <div class="product_title"><span>Ulei Floarea Soarelui 1L</span></div>
          <span class="Price_priceWrapperFull__HAvIg">6</span>
          <span class="Price_priceWrapperDecimalCurrency__52Dsm">99 lei</span>
        </div>
      </div>
    `;
    const carrefourRes = CatalogParserEngine.parseCarrefourCatalog(carrefourHtml, 'https://carrefour.ro/campanii');
    assert.strictEqual(carrefourRes.offers[0].imageUrl, 'https://carrefour.ro/media/catalog/product/u/l/ulei-carrefour.jpg');

    const pennyHtml = `
      <div data-test="product-tile">
        <img src="/assets/products/cascaval-penny.png" />
        <div data-test="product-title">Cașcaval Dalia 300g</div>
        <div data-test="product-price-type">
          <span data-test="product-price-type-price-label">Fără PENNY Card</span>
          <span data-test="product-price-type-value"><span class="ws-product-price-value__main">14,99</span></span>
        </div>
      </div>
    `;
    const pennyRes = CatalogParserEngine.parsePennyCatalog(pennyHtml, 'https://www.penny.ro/oferte');
    assert.strictEqual(pennyRes.offers[0].imageUrl, 'https://www.penny.ro/assets/products/cascaval-penny.png');

    const megaJson = JSON.stringify([
      {
        pages: [
          {
            images: [{ url: '//view.publitas.com/mega-image/spread-1.jpg' }],
            text: 'Cafea Boabe Jacobs 500g\n29.99 LEI'
          }
        ]
      }
    ]);
    const megaRes = CatalogParserEngine.parseMegaImageCatalog(megaJson, 'https://view.publitas.com/mega-image/');
    assert.strictEqual(megaRes.offers[0].imageUrl, 'https://view.publitas.com/mega-image/spread-1.jpg');

    const csvRes = CatalogParserEngine.parseCsvCatalog(
      'denumire,pret,brand,imagine\n"Unt 82% 200g",11.50,"Napolact","/img/unt.jpg"',
      'https://www.kaufland.ro/oferte'
    );
    assert.strictEqual(csvRes.offers[0].imageUrl, 'https://www.kaufland.ro/img/unt.jpg');

    const xmlRes = CatalogParserEngine.parseXmlCatalog(
      '<catalog><product><name>Făină Albă 1kg</name><price>3.49</price><image>/img/faina.png</image></product></catalog>',
      'https://www.metro.ro'
    );
    assert.strictEqual(xmlRes.offers[0].imageUrl, 'https://www.metro.ro/img/faina.png');
  });

  it('2. Revine automat pe pagina web a retailerului când catalogul PDF lipsește (404 / HTML gol) și păstrează imaginea până la publicare', async () => {
    const origDownload = CatalogDownloader.downloadCatalog;
    const calledUrls: string[] = [];

    const fallbackHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Pulpă de Porc Fără Os 1kg",
            "brand": "Profi Agro",
            "image": "/assets/pulpa-porc.webp",
            "offers": {
              "price": "21.99",
              "priceCurrency": "RON",
              "priceValidUntil": "2029-12-31"
            }
          }
          </script>
        </head>
        <body><h1>Oferte Profi</h1></body>
      </html>
    `;

    CatalogDownloader.downloadCatalog = async (url: string) => {
      calledUrls.push(url);
      if (url.includes('/reviste-ro')) {
        return { ok: false, statusCode: 404, error: 'HTTP 404 Not Found' };
      }
      if (url.includes('profi.ro')) {
        const buf = Buffer.from(fallbackHtml, 'utf-8');
        return {
          ok: true,
          statusCode: 200,
          data: buf,
          text: fallbackHtml,
          contentType: 'text/html; charset=utf-8',
          finalUrl: 'https://www.profi.ro/oferte/',
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          fileSizeBytes: buf.length
        };
      }
      return { ok: false, statusCode: 404, error: 'Not found' };
    };

    try {
      const doc: CatalogDocument = {
        id: `doc-fallback-profi-${Date.now()}`,
        sourceId: 'cat-src-profi',
        retailerId: 'profi',
        documentUrl: 'https://www.profi.ro/reviste-ro/',
        title: 'Revistă Profi indisponibilă test',
        format: 'pdf',
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const res = await CatalogStagingManager.executeImportForDocument(doc, {
        autoPublishValidated: false,
        disableSyntheticFallback: true
      });

      assert.strictEqual(res.usedWebsiteFallback, true, 'Trebuie să activeze fallback-ul pe pagina web a retailerului');
      assert.strictEqual(res.offers.length, 1);
      assert.strictEqual(res.offers[0].imageUrl, 'https://www.profi.ro/assets/pulpa-porc.webp');
      assert.ok(calledUrls.some(u => u.includes('/reviste-ro')), 'Trebuie să încerce mai întâi URL-ul catalogului');
      assert.ok(calledUrls.some(u => u.includes('/oferte') || u === 'https://www.profi.ro'), 'Trebuie să încerce pagina web a retailerului');

      // Aprobare & publicare în memorie -> produsul creat primește imageUrl
      StorageService.updateCatalogExtractedOffer(res.offers[0].id, { stagingStatus: 'APPROVED' });
      const pubRes = await CatalogStagingManager.publishValidatedOffers([res.offers[0].id]);
      assert.strictEqual(pubRes.publishedCount, 1);

      const matchedOffer = StorageService.getCatalogExtractedOffers().find(o => o.id === res.offers[0].id);
      assert.ok(matchedOffer?.matchedProductId);
      const publishedProduct = StorageService.getAllProducts().find(p => p.id === matchedOffer!.matchedProductId);
      assert.strictEqual(publishedProduct?.imageUrl, 'https://www.profi.ro/assets/pulpa-porc.webp');
    } finally {
      CatalogDownloader.downloadCatalog = origDownload;
    }
  });

  it('3. Website-only retailer via API: creare sursă automată, blocare SSRF și backfill imagine pe produs existent fără duplicare', async () => {
    // 3a. Protecție SSRF la POST/PUT /api/admin/retailers
    const unsafeRes = await fetch(`${baseUrl}/api/admin/retailers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: `ssrf-test-${Date.now()}`,
        name: 'SSRF Test Store',
        storeType: 'supermarket',
        color: 'emerald',
        officialUrl: 'http://127.0.0.1:3000/internal'
      })
    });
    assert.strictEqual(unsafeRes.status, 400);

    // 3b. Creare retailer fără catalog PDF, doar cu officialUrl pe domeniu public permis
    const retailerId = `selgros-web-${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/api/admin/retailers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: retailerId,
        name: 'Selgros Web Test',
        chain: 'Selgros',
        storeType: 'hypermarket',
        color: 'rose',
        officialUrl: 'https://www.selgros.ro/oferte'
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createdJson = await createRes.json();
    assert.strictEqual(createdJson.success, true);
    assert.strictEqual(createdJson.retailer.officialUrl, 'https://www.selgros.ro/oferte');
    assert.ok(createdJson.source, 'Trebuie să creeze automat sursă HTML din officialUrl');
    assert.strictEqual(createdJson.source.format, 'html');

    // 3c. Verificare PUT /api/admin/retailers/:id pentru actualizare officialUrl + respingere SSRF
    const unsafePutRes = await fetch(`${baseUrl}/api/admin/retailers/${retailerId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: 'Selgros Web Test',
        chain: 'Selgros',
        storeType: 'hypermarket',
        color: 'rose',
        officialUrl: 'http://169.254.169.254/latest/meta-data/'
      })
    });
    assert.strictEqual(unsafePutRes.status, 400);

    // 3d. Backfill imageUrl pe un produs existent fără imagine + fără duplicare ID
    const targetProd = PRODUCTS[0];
    const hadImageInitially = Boolean(targetProd.imageUrl);
    if (!hadImageInitially) {
      const stagedBackfillId = `stg-backfill-${Date.now()}`;
      const nowIso = new Date().toISOString();
      StorageService.addCatalogExtractedOffers([
        {
          id: stagedBackfillId,
          runId: `run-backfill-${Date.now()}`,
          documentId: `doc-backfill-${Date.now()}`,
          retailerId: 'lidl',
          rawTitle: targetProd.name,
          rawBrand: targetProd.brand,
          normalPrice: 10.99,
          effectivePrice: 9.49,
          currency: 'RON',
          isPromo: true,
          loyaltyCardRequired: false,
          imageUrl: 'https://www.lidl.ro/assets/backfill-prod.jpg',
          matchedProductId: targetProd.id,
          matchConfidence: 0.99,
          matchMethod: 'name_brand_similarity',
          stagingStatus: 'APPROVED',
          createdAt: nowIso,
          updatedAt: nowIso
        }
      ]);
      const pubBackfill = await CatalogStagingManager.publishValidatedOffers([stagedBackfillId]);
      assert.strictEqual(pubBackfill.publishedCount, 1);

      const allAfter = StorageService.getAllProducts();
      const matchingEntries = allAfter.filter(p => p.id === targetProd.id);
      assert.strictEqual(matchingEntries.length, 1, 'getAllProducts nu trebuie să producă ID-uri duplicate după backfill');
      assert.strictEqual(matchingEntries[0].imageUrl, 'https://www.lidl.ro/assets/backfill-prod.jpg');
    }
  });

  it('4. Deduplică magazinele duplicat (penny/store-penny, mega-image, metro) în comparații și optimizare', () => {
    const duplicateStores = [
      ...STORES,
      { ...STORES.find(s => s.id === 'penny')!, id: 'store-penny', slug: 'store-penny' },
      { ...STORES.find(s => s.id === 'mega-image')!, id: 'mega-image-chain', slug: 'mega-image-chain' },
      { ...STORES.find(s => s.id === 'metro')!, id: 'store-metro', slug: 'store-metro' }
    ];

    const sampleItems = [
      {
        id: 'item-1',
        productId: PRODUCTS[0].id,
        name: PRODUCTS[0].name,
        category: PRODUCTS[0].category,
        quantity: 1,
        unit: 'buc' as const,
        checked: false,
        addedAt: new Date().toISOString()
      }
    ];

    const comparisons = PriceComparisonService.compareBasketAcrossStores(
      sampleItems,
      { useLoyaltyCards: true },
      undefined,
      undefined,
      duplicateStores
    );

    const ids = comparisons.map(c => c.store.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'Compararea coșului nu trebuie să returneze store.id-uri duplicate');
    assert.strictEqual(ids.filter(id => id.includes('penny')).length, 1);
    assert.strictEqual(ids.filter(id => id.includes('mega-image')).length, 1);
    assert.strictEqual(ids.filter(id => id.includes('metro')).length, 1);

    const opt = OptimizationService.optimizeBasket(sampleItems, 6, undefined, undefined, duplicateStores);
    const planIds = opt.multiStorePlan.map(p => p.store.id);
    assert.strictEqual(new Set(planIds).size, planIds.length, 'Planul multi-magazin nu trebuie să conțină store.id-uri duplicate');
  });
});
