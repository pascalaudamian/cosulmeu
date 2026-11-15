// tests/retailer-webpage-fallback.test.ts
// Teste izolate și idempotente pentru fallback-ul pe pagina web a retailerului,
// extragerea/persistența imaginilor produselor, persistența official_url și deduplicarea magazinelor

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
import { INITIAL_CATALOG_SOURCES } from '../src/indexing/catalog/CatalogSourceDiscovery.ts';
import { CatalogDocument } from '../src/indexing/catalog/catalogTypes.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { PriceComparisonService } from '../src/services/PriceComparisonService.ts';
import { OptimizationService } from '../src/services/OptimizationService.ts';
import { PRODUCTS, STORES } from '../src/data/mockData.ts';
import { supabase } from '../src/lib/supabase.ts';

type TableRow = Record<string, any>;

function createIsolatedSupabaseStub() {
  const tables: Record<string, TableRow[]> = {
    stores: STORES.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      chain: s.chain,
      brand_color: s.brandColor,
      accent_color: s.accentColor,
      logo_url: s.logoUrl || null,
      official_url: s.officialUrl || s.websiteUrl || null,
      store_type: s.type,
      rating: s.rating,
      locations_count: s.locationsCount,
      sample_address: s.sampleAddress,
      is_partner: s.isPartner
    })),
    catalog_sources: INITIAL_CATALOG_SOURCES.map(src => ({
      id: src.id,
      retailer_id: src.retailerId,
      name: src.name,
      catalog_url: src.catalogUrl,
      format: src.format,
      status: src.status,
      update_frequency_days: src.updateFrequencyDays,
      auth_required: src.authRequired,
      legal_status_notice: src.legalStatusNotice
    })),
    products: [],
    product_offers: [],
    price_observations: [],
    catalog_documents: [],
    catalog_import_runs: [],
    catalog_extracted_offers: []
  };

  const makeQuery = (tableName: string) => {
    const getRows = () => {
      if (!tables[tableName]) tables[tableName] = [];
      return tables[tableName];
    };

    let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: any = null;
    let conflictCol = 'id';
    const filters: Array<(row: TableRow) => boolean> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let maxLimit: number | null = null;

    const execute = async (): Promise<{ data: any; error: any; count?: number }> => {
      const rows = getRows();
      const matched = () => rows.filter(r => filters.every(fn => fn(r)));

      if (mode === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map(item => ({ ...item }));
        for (const item of items) {
          if (tableName === 'stores' && rows.some(r => r.id === item.id || r.slug === item.slug)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          if (tableName === 'catalog_sources' && item.retailer_id && !tables.stores.some(s => s.id === item.retailer_id)) {
            return { data: null, error: { code: '23503', message: 'foreign key violation on catalog_sources.retailer_id' } };
          }
        }
        rows.push(...items);
        return { data: Array.isArray(payload) ? items : items, error: null };
      }

      if (mode === 'upsert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map(item => ({ ...item }));
        for (const item of items) {
          const idx = rows.findIndex(r => r[conflictCol] === item[conflictCol]);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...item };
          } else {
            rows.push(item);
          }
        }
        return { data: items, error: null };
      }

      if (mode === 'update') {
        const updated: TableRow[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (filters.every(fn => fn(rows[i]))) {
            rows[i] = { ...rows[i], ...payload };
            updated.push({ ...rows[i] });
          }
        }
        return { data: updated, error: null };
      }

      if (mode === 'delete') {
        // Respectă constrângerile de chei străine în testul izolat
        const targets = matched();
        if (tableName === 'stores') {
          for (const st of targets) {
            if (tables.catalog_sources.some(src => src.retailer_id === st.id)) {
              return {
                data: null,
                error: { code: '23503', message: `FK violation: catalog_sources referă stores(${st.id})` }
              };
            }
          }
        }
        const toDelete = new Set(targets);
        tables[tableName] = rows.filter(r => !toDelete.has(r));
        return { data: targets, error: null };
      }

      let result = matched().map(r => ({ ...r }));
      if (orderCol) {
        result.sort((a, b) => {
          const av = a[orderCol!];
          const bv = b[orderCol!];
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (orderAsc ? 1 : -1);
        });
      }
      if (maxLimit !== null) {
        result = result.slice(0, maxLimit);
      }
      return { data: result, error: null, count: result.length };
    };

    const builder: any = {
      select: (_cols?: string) => builder,
      insert: (data: any) => {
        mode = 'insert';
        payload = data;
        return builder;
      },
      update: (data: any) => {
        mode = 'update';
        payload = data;
        return builder;
      },
      upsert: (data: any, opts?: { onConflict?: string }) => {
        mode = 'upsert';
        payload = data;
        if (opts?.onConflict) conflictCol = opts.onConflict;
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      eq: (col: string, val: any) => {
        filters.push(r => r[col] === val);
        return builder;
      },
      neq: (col: string, val: any) => {
        filters.push(r => r[col] !== val);
        return builder;
      },
      is: (col: string, val: any) => {
        filters.push(r => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
        return builder;
      },
      in: (col: string, vals: any[]) => {
        const set = new Set(vals);
        filters.push(r => set.has(r[col]));
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      limit: (n: number) => {
        maxLimit = n;
        return builder;
      },
      single: async () => {
        const res = await execute();
        if (res.error) return { data: null, error: res.error };
        const row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!row) return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
        return { data: row, error: null };
      },
      maybeSingle: async () => {
        const res = await execute();
        if (res.error) return { data: null, error: res.error };
        const row = Array.isArray(res.data) ? (res.data[0] ?? null) : (res.data ?? null);
        return { data: row, error: null };
      },
      then: (onFulfilled: any, onRejected: any) => execute().then(onFulfilled, onRejected)
    };
    return builder;
  };

  return {
    tables,
    from: (tableName: string) => makeQuery(tableName)
  };
}

describe('Retailer Webpage Fallback, Product Images & Store Key Deduplication (Isolated)', () => {
  let server: http.Server;
  let baseUrl = '';
  let adminToken = '';
  const runNonce = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

  let originalSupabaseFrom: typeof supabase.from;
  let isolatedDb: ReturnType<typeof createIsolatedSupabaseStub>;

  // Registre explicite pentru cleanup determinist în ordinea cheilor străine
  const createdSourceIds = new Set<string>();
  const createdRetailerIds = new Set<string>();
  const createdOfferIds = new Set<string>();
  const createdDocumentIds = new Set<string>();
  const createdProductIds = new Set<string>();

  const cleanupTrackedRecords = async () => {
    // 1. Oferte staging extrase + documente catalog (copii ai surselor/retailerilor)
    if (createdOfferIds.size > 0) {
      StorageService.removeCatalogExtractedOffersByIds(Array.from(createdOfferIds));
      createdOfferIds.clear();
    }
    if (createdDocumentIds.size > 0) {
      const remainingDocs = StorageService.getCatalogDocuments().filter(d => !createdDocumentIds.has(d.id));
      StorageService.saveCatalogDocuments(remainingDocs);
      createdDocumentIds.clear();
    }

    // 2. Surse de catalog (referă stores.id) — șterse ÎNAINTE de stores
    for (const sourceId of Array.from(createdSourceIds)) {
      const { error } = await supabase.from('catalog_sources').delete().eq('id', sourceId);
      assert.strictEqual(error, null, `Eroare la cleanup catalog_sources(${sourceId}): ${error?.message}`);
      const remainingSources = StorageService.getCatalogSources().filter(s => s.id !== sourceId);
      StorageService.saveCatalogSources(remainingSources);
      createdSourceIds.delete(sourceId);
    }

    // 3. Produse / oferte create în memorie
    if (createdProductIds.size > 0) {
      const offers = StorageService.getProductOffers().filter(o => !createdProductIds.has(o.productId));
      StorageService.saveProductOffers(offers);
      createdProductIds.clear();
    }

    // 4. Retaileri (tabelul părinte stores) — șterși DUPĂ copii
    for (const retailerId of Array.from(createdRetailerIds)) {
      const { error } = await supabase.from('stores').delete().eq('id', retailerId);
      assert.strictEqual(error, null, `Eroare la cleanup stores(${retailerId}): ${error?.message}`);
      createdRetailerIds.delete(retailerId);
    }
  };

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  });

  before(async () => {
    // Izolare totală față de baza de date de producție Supabase
    originalSupabaseFrom = supabase.from.bind(supabase);
    isolatedDb = createIsolatedSupabaseStub();
    (supabase as any).from = isolatedDb.from;

    StorageService.resetAllData();

    const serverMod = await import('../server.ts');
    adminToken = serverMod.ADMIN_API_KEY;
    server = await new Promise<http.Server>(resolve => {
      const srv = serverMod.app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    try {
      await cleanupTrackedRecords();
      StorageService.resetAllData();
    } finally {
      (supabase as any).from = originalSupabaseFrom;
      if (server) {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
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
    const docId = `doc-fallback-profi-${runNonce}`;
    createdDocumentIds.add(docId);

    const fallbackHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Pulpă de Porc Fără Os Test ${runNonce} 1kg",
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
        id: docId,
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
      createdOfferIds.add(res.offers[0].id);
      assert.strictEqual(res.offers[0].imageUrl, 'https://www.profi.ro/assets/pulpa-porc.webp');
      assert.ok(calledUrls.some(u => u.includes('/reviste-ro')), 'Trebuie să încerce mai întâi URL-ul catalogului');
      assert.ok(calledUrls.some(u => u.includes('/oferte') || u === 'https://www.profi.ro'), 'Trebuie să încerce pagina web a retailerului');

      // Aprobare & publicare în test izolat -> produsul creat primește imageUrl
      StorageService.updateCatalogExtractedOffer(res.offers[0].id, { stagingStatus: 'APPROVED' });
      const pubRes = await CatalogStagingManager.publishValidatedOffers([res.offers[0].id]);
      assert.strictEqual(pubRes.publishedCount, 1);

      const matchedOffer = StorageService.getCatalogExtractedOffers().find(o => o.id === res.offers[0].id);
      assert.ok(matchedOffer?.matchedProductId);
      createdProductIds.add(matchedOffer!.matchedProductId!);
      const publishedProduct = StorageService.getAllProducts().find(p => p.id === matchedOffer!.matchedProductId);
      assert.strictEqual(publishedProduct?.imageUrl, 'https://www.profi.ro/assets/pulpa-porc.webp');
    } finally {
      CatalogDownloader.downloadCatalog = origDownload;
      await cleanupTrackedRecords();
    }
  });

  it('3. Website-only retailer via API: creare sursă automată, persistență official_url, blocare SSRF și cleanup complet în ordinea FK', async () => {
    const retailerId = `selgros-web-${runNonce}`;
    let createdSourceId: string | undefined;

    try {
      // 3a. Protecție SSRF la POST /api/admin/retailers
      const unsafeRes = await fetch(`${baseUrl}/api/admin/retailers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          id: `ssrf-test-${runNonce}`,
          name: 'SSRF Test Store',
          storeType: 'supermarket',
          color: 'emerald',
          officialUrl: 'http://127.0.0.1:3000/internal'
        })
      });
      assert.strictEqual(unsafeRes.status, 400);

      // 3b. Creare retailer fără catalog PDF, doar cu officialUrl pe domeniu public permis
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
      createdRetailerIds.add(retailerId);
      if (createdJson.source?.id) {
        createdSourceId = createdJson.source.id;
        createdSourceIds.add(createdJson.source.id);
      }

      assert.strictEqual(createdJson.success, true);
      assert.strictEqual(createdJson.retailer.officialUrl, 'https://www.selgros.ro/oferte');
      assert.ok(createdJson.source, 'Trebuie să creeze automat sursă HTML din officialUrl');
      assert.strictEqual(createdJson.source.format, 'html');

      // Verifică persistența reală în tabelul stores izolat (Supabase fallback)
      const persistedRow = isolatedDb.tables.stores.find(s => s.id === retailerId);
      assert.ok(persistedRow, 'Retailerul trebuie să existe în tabelul stores');
      assert.strictEqual(persistedRow.official_url, 'https://www.selgros.ro/oferte');

      // 3c. Verificare PUT /api/admin/retailers/:id pentru respingere SSRF + actualizare reală official_url
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

      const validPutRes = await fetch(`${baseUrl}/api/admin/retailers/${retailerId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: 'Selgros Web Test Updated',
          chain: 'Selgros',
          storeType: 'hypermarket',
          color: 'rose',
          officialUrl: 'https://www.selgros.ro/cataloage-noi'
        })
      });
      assert.strictEqual(validPutRes.status, 200);
      const updatedJson = await validPutRes.json();
      assert.strictEqual(updatedJson.retailer.officialUrl, 'https://www.selgros.ro/cataloage-noi');
      assert.strictEqual(
        isolatedDb.tables.stores.find(s => s.id === retailerId)?.official_url,
        'https://www.selgros.ro/cataloage-noi'
      );

      // 3d. Backfill imageUrl pe un produs izolat fără imagine + fără duplicare ID
      const backfillProdId = `prod-backfill-${runNonce}`;
      createdProductIds.add(backfillProdId);
      StorageService.addCustomProduct({
        id: backfillProdId,
        name: `Lapte Test Backfill ${runNonce} 1L`,
        brand: 'Napolact',
        category: 'Lactate și ouă',
        defaultUnit: 'l',
        packageWeightOrVolume: 1,
        packageUnit: 'l',
        normalizedUnit: 'l',
        baseReferencePrice: 10.99,
        isRomanianProduct: true
      });

      const stagedBackfillId = `stg-backfill-${runNonce}`;
      createdOfferIds.add(stagedBackfillId);
      const nowIso = new Date().toISOString();
      StorageService.addCatalogExtractedOffers([
        {
          id: stagedBackfillId,
          runId: `run-backfill-${runNonce}`,
          documentId: `doc-backfill-${runNonce}`,
          retailerId: 'lidl',
          rawTitle: `Lapte Test Backfill ${runNonce} 1L`,
          rawBrand: 'Napolact',
          normalPrice: 10.99,
          effectivePrice: 9.49,
          currency: 'RON',
          isPromo: true,
          loyaltyCardRequired: false,
          imageUrl: 'https://www.lidl.ro/assets/backfill-prod.jpg',
          matchedProductId: backfillProdId,
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
      const matchingEntries = allAfter.filter(p => p.id === backfillProdId);
      assert.strictEqual(matchingEntries.length, 1, 'getAllProducts nu trebuie să producă ID-uri duplicate după backfill');
      assert.strictEqual(matchingEntries[0].imageUrl, 'https://www.lidl.ro/assets/backfill-prod.jpg');
    } finally {
      await cleanupTrackedRecords();
    }

    // Verificare post-cleanup: nicio înregistrare creată în test nu a rămas în tabele
    assert.strictEqual(
      isolatedDb.tables.stores.some(s => s.id === retailerId),
      false,
      'Retailerul creat în test nu a fost șters la cleanup'
    );
    if (createdSourceId) {
      assert.strictEqual(
        isolatedDb.tables.catalog_sources.some(s => s.id === createdSourceId),
        false,
        'Sursa de catalog creată în test nu a fost ștearsă la cleanup'
      );
    }
    assert.ok(
      isolatedDb.tables.stores.some(s => s.id === 'lidl'),
      'Datele de bază existente NU trebuie afectate de cleanup'
    );
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
