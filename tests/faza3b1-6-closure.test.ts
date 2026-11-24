// tests/faza3b1-6-closure.test.ts
// Suită de verificare FAZA 3B.1.6 — Închidere observații re-audit FAZA 3B.1.5:
//   - Partea A: GET /api/catalog/history/:productId & ProductIdentityService.collectProductIdsForCanonical()
//   - Partea B: DatabaseService.getRetailerProductsWithBarcodes() (toate cele 3 moduri) & BarcodeService
//   - Partea C: CatalogStagingManager (previewPublishValidated, publishValidatedOffers) & validateStagingOfferCandidate

import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { DatabaseService } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { lookupProductByBarcode } from '../src/services/BarcodeService.ts';
import {
  buildCanonicalAliasIndex,
  collectProductIdsForCanonical,
  resolveCanonicalProductDetail
} from '../src/services/ProductIdentityService.ts';
import { CatalogStagingManager } from '../src/indexing/catalog/CatalogStagingManager.ts';
import type { CatalogExtractedOffer } from '../src/indexing/catalog/catalogTypes.ts';
import { STORES } from '../src/data/mockData.ts';
import type { PriceObservation, Product, ProductOffer, RetailerProductRecord } from '../src/types.ts';

let passed = 0;
function pass(label: string) {
  passed++;
  console.log(`  [PASS] ${label}`);
}

function makeProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: overrides.name ?? `Produs ${id}`,
    brand: overrides.brand ?? 'BrandTest',
    category: overrides.category ?? 'Lactate și ouă',
    defaultUnit: overrides.defaultUnit ?? 'buc',
    packageWeightOrVolume: overrides.packageWeightOrVolume ?? 1,
    packageUnit: overrides.packageUnit ?? 'buc',
    normalizedUnit: overrides.normalizedUnit ?? 'buc',
    barcode: overrides.barcode,
    baseReferencePrice: overrides.baseReferencePrice ?? 10,
    isRomanianProduct: true,
    canonicalProductId: overrides.canonicalProductId ?? null
  };
}

async function runTests() {
  console.log('====================================================================');
  console.log('FAZA 3B.1.6: TESTE ÎNCHIDERE OBSERVAȚII RE-AUDIT');
  console.log('====================================================================\n');

  StorageService.resetAllData();

  // Construim un graf complet: root, alias 1-hop, alias 2-hop, ciclu 2 noduri, self-ref, lanț > 16, orfan
  const root = makeProduct('f3b16-root', { name: 'Lapte UHT 1.5% 1L Test', barcode: '5941600000011' });
  const alias1 = makeProduct('f3b16-alias-1', { canonicalProductId: 'f3b16-root' });
  const alias2 = makeProduct('f3b16-alias-2', { canonicalProductId: 'f3b16-alias-1' });
  const cycA = makeProduct('f3b16-cyc-a', { canonicalProductId: 'f3b16-cyc-b', barcode: '5941600000028' });
  const cycB = makeProduct('f3b16-cyc-b', { canonicalProductId: 'f3b16-cyc-a' });
  const selfRef = makeProduct('f3b16-self', { canonicalProductId: 'f3b16-self', barcode: '5941600000035' });
  const orphan = makeProduct('f3b16-orphan', { canonicalProductId: 'f3b16-missing-root', barcode: '5941600000042' });

  const deepChain: Product[] = [];
  for (let i = 0; i <= 18; i++) {
    deepChain.push(
      makeProduct(`f3b16-deep-${i}`, {
        canonicalProductId: i < 18 ? `f3b16-deep-${i + 1}` : 'f3b16-root'
      })
    );
  }

  const allNodes: Product[] = [root, alias1, alias2, cycA, cycB, selfRef, orphan, ...deepChain];
  const rawIndex = buildCanonicalAliasIndex(allNodes);

  // =========================================================================
  // PARTEA A — collectProductIdsForCanonical() & GET /api/catalog/history/:productId
  // =========================================================================
  {
    assert.deepEqual(
      new Set(collectProductIdsForCanonical('f3b16-root', rawIndex)),
      new Set(['f3b16-root', 'f3b16-alias-1', 'f3b16-alias-2', 'f3b16-deep-18', 'f3b16-deep-17', 'f3b16-deep-16', 'f3b16-deep-15', 'f3b16-deep-14', 'f3b16-deep-13', 'f3b16-deep-12', 'f3b16-deep-11', 'f3b16-deep-10', 'f3b16-deep-9', 'f3b16-deep-8', 'f3b16-deep-7', 'f3b16-deep-6', 'f3b16-deep-5', 'f3b16-deep-4', 'f3b16-deep-3', 'f3b16-deep-2', 'f3b16-deep-1', 'f3b16-deep-0'])
    );
    assert.ok(
      collectProductIdsForCanonical('f3b16-alias-2', rawIndex).includes('f3b16-root'),
      'Alias valid 2-hop rezolvă spre root și descendenți'
    );
    assert.deepEqual(collectProductIdsForCanonical('f3b16-orphan', rawIndex), [], 'Alias orfan întoarce []');
    assert.deepEqual(collectProductIdsForCanonical('f3b16-cyc-a', rawIndex), [], 'Ciclu întoarce []');
    assert.deepEqual(collectProductIdsForCanonical('f3b16-self', rawIndex), [], 'Self-ref întoarce []');
    assert.deepEqual(collectProductIdsForCanonical('f3b16-deep-0', rawIndex), [], 'Lanț > 16 hopuri întoarce []');
    assert.deepEqual(collectProductIdsForCanonical('f3b16-nonexistent', rawIndex), [], 'Produs inexistent întoarce []');

    // Și cu mapă fără noduri explicite dar cu knownProductIds
    const mapSource = new Map<string, string | null>([
      ['m-alias', 'm-root'],
      ['m-orphan', 'm-missing']
    ]);
    assert.deepEqual(
      collectProductIdsForCanonical('m-orphan', mapSource, { knownProductIds: new Set(['m-root']) }),
      [],
      'Orfan cu knownProductIds întoarce []'
    );
    assert.deepEqual(
      new Set(collectProductIdsForCanonical('m-alias', mapSource, { knownProductIds: new Set(['m-root']) })),
      new Set(['m-root', 'm-alias'])
    );
    pass('Partea A (1/2): collectProductIdsForCanonical() elimină fallback-ul pe orfan, ciclu, self-ref, depth>16 și inexistent');

    // Test HTTP GET /api/catalog/history/:productId
    const todayStr = new Date().toISOString().split('T')[0];
    const testObs: PriceObservation[] = [
      { id: 'obs-a-root', productId: 'f3b16-root', storeId: 'lidl', price: 8.5, date: todayStr, source: 'official_feed' },
      { id: 'obs-a-alias', productId: 'f3b16-alias-2', storeId: 'kaufland', price: 7.9, date: todayStr, source: 'official_feed' },
      { id: 'obs-a-cyc', productId: 'f3b16-cyc-a', storeId: 'carrefour', price: 1.0, date: todayStr, source: 'official_feed' },
      { id: 'obs-a-orphan', productId: 'f3b16-orphan', storeId: 'mega-image', price: 1.1, date: todayStr, source: 'official_feed' }
    ];
    const testOffers: ProductOffer[] = [
      {
        id: 'off-a-alias',
        productId: 'f3b16-alias-2',
        storeId: 'kaufland',
        price: 7.9,
        unitPrice: 7.9,
        unitPriceMeasure: 'lei/buc',
        isPromo: false,
        source: 'official_feed',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        observationDate: todayStr,
        lastChecked: new Date().toISOString()
      },
      {
        id: 'off-a-cyc',
        productId: 'f3b16-cyc-a',
        storeId: 'lidl',
        price: 0.5,
        unitPrice: 0.5,
        unitPriceMeasure: 'lei/buc',
        isPromo: true,
        source: 'official_feed',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        observationDate: todayStr,
        lastChecked: new Date().toISOString()
      }
    ];

    const origGetAliasIdx = DatabaseService.getProductAliasIndex;
    const origGetPriceObsDb = DatabaseService.getPriceObservations;
    const origGetOffersDb = DatabaseService.getOffers;
    const origGetStoresDb = DatabaseService.getStores;
    const origGetAllProducts = StorageService.getAllProducts;
    const origGetObs = StorageService.getPriceObservations;
    const origGetOffers = StorageService.getProductOffers;

    try {
      DatabaseService.getProductAliasIndex = async () => rawIndex;
      // Returnăm observații și oferte BRUTE (inclusiv ciclu & orfan) pentru a verifica filtrarea în server.ts
      DatabaseService.getPriceObservations = async () => testObs;
      DatabaseService.getOffers = async () => testOffers;
      DatabaseService.getStores = async () => STORES;
      StorageService.getAllProducts = () => allNodes;
      StorageService.getPriceObservations = () => testObs;
      StorageService.getProductOffers = () => testOffers;

      const { app } = await import('../server.ts');
      const srv = http.createServer(app);
      await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
      const port = (srv.address() as any).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // Alias valid 2-hop -> 200 cu productId=root, toate observațiile normalizate la root, fără poluare ciclică
        const resAlias = await fetch(`${baseUrl}/api/catalog/history/f3b16-alias-2?days=30`);
        assert.equal(resAlias.status, 200);
        const bodyAlias = await resAlias.json();
        assert.equal(bodyAlias.success, true);
        assert.equal(bodyAlias.productId, 'f3b16-root');
        assert.equal(bodyAlias.requestedProductId, 'f3b16-alias-2');
        assert.equal(bodyAlias.currentLowestPrice, 7.9, 'Nu preia oferta ciclică de 0.5 lei');
        assert.equal(bodyAlias.observations.length, 2);
        assert.ok(bodyAlias.observations.every((o: any) => o.productId === 'f3b16-root'));

        // Orfan, ciclu, self-ref, lanț > 16 -> HTTP 400 explicit
        for (const badId of ['f3b16-orphan', 'f3b16-cyc-a', 'f3b16-self', 'f3b16-deep-0']) {
          const rBad = await fetch(`${baseUrl}/api/catalog/history/${badId}?days=30`);
          assert.equal(rBad.status, 400, `GET /api/catalog/history/${badId} respinge cu 400`);
          const jBad = await rBad.json();
          assert.equal(jBad.success, false);
          assert.equal(jBad.productId, undefined, `Nu returnează ${badId} ca productId valid`);
        }

        // Produs inexistent -> HTTP 404 explicit
        const rMissing = await fetch(`${baseUrl}/api/catalog/history/f3b16-does-not-exist?days=30`);
        assert.equal(rMissing.status, 404);
        const jMissing = await rMissing.json();
        assert.equal(jMissing.success, false);
        assert.equal(jMissing.productId, undefined);
      } finally {
        await new Promise<void>(resolve => srv.close(() => resolve()));
      }
    } finally {
      DatabaseService.getProductAliasIndex = origGetAliasIdx;
      DatabaseService.getPriceObservations = origGetPriceObsDb;
      DatabaseService.getOffers = origGetOffersDb;
      DatabaseService.getStores = origGetStoresDb;
      StorageService.getAllProducts = origGetAllProducts;
      StorageService.getPriceObservations = origGetObs;
      StorageService.getProductOffers = origGetOffers;
    }
    pass('Partea A (2/2): GET /api/catalog/history/:productId respinge orfan/ciclu/self/deep>16 (400) și inexistent (404), fără fallback la ID brut');
  }

  // =========================================================================
  // PARTEA B — DatabaseService.getRetailerProductsWithBarcodes() & BarcodeService
  // =========================================================================
  {
    const rpFixtureRows = [
      { id: 'rp-root', retailer_id: 'lidl', product_id: 'f3b16-root', external_sku: 'SKU-ROOT', url: 'https://lidl.ro/p/1', scraped_name: 'Lapte Root', scraped_brand: 'Pilos', barcode: '5941600000011', status: 'active' },
      { id: 'rp-alias', retailer_id: 'kaufland', product_id: 'f3b16-alias-2', external_sku: 'SKU-ALIAS', url: 'https://kaufland.ro/p/2', scraped_name: 'Lapte Alias', scraped_brand: 'Pilos', barcode: '5941600000097', status: 'active' },
      { id: 'rp-cyc', retailer_id: 'carrefour', product_id: 'f3b16-cyc-a', external_sku: 'SKU-CYC', url: 'https://carrefour.ro/p/3', scraped_name: 'Lapte Ciclu', scraped_brand: 'BrandX', barcode: '5941600000028', status: 'active' },
      { id: 'rp-self', retailer_id: 'auchan', product_id: 'f3b16-self', external_sku: 'SKU-SELF', url: 'https://auchan.ro/p/4', scraped_name: 'Lapte Self', scraped_brand: 'BrandX', barcode: '5941600000035', status: 'active' },
      { id: 'rp-deep', retailer_id: 'penny', product_id: 'f3b16-deep-0', external_sku: 'SKU-DEEP', url: 'https://penny.ro/p/5', scraped_name: 'Lapte Deep', scraped_brand: 'BrandX', barcode: '5941600000059', status: 'active' },
      { id: 'rp-orphan', retailer_id: 'mega-image', product_id: 'f3b16-orphan', external_sku: 'SKU-ORPHAN', url: 'https://mega-image.ro/p/6', scraped_name: 'Lapte Orfan', scraped_brand: 'BrandX', barcode: '5941600000042', status: 'active' },
      { id: 'rp-missing', retailer_id: 'profi', product_id: 'f3b16-not-in-products', external_sku: 'SKU-MISS', url: 'https://profi.ro/p/7', scraped_name: 'Lapte Lipsă', scraped_brand: 'BrandX', barcode: '5941600000066', status: 'active' }
    ];

    // 1. Mod izolat (StorageService)
    const origGetRP = StorageService.getRetailerProducts;
    const origGetAllProds = StorageService.getAllProducts;
    let isolatedRes: RetailerProductRecord[];
    try {
      StorageService.getAllProducts = () => allNodes;
      StorageService.getRetailerProducts = () =>
        rpFixtureRows.map(r => ({
          id: r.id,
          retailerId: r.retailer_id,
          productId: r.product_id,
          externalSku: r.external_sku,
          url: r.url,
          scrapedName: r.scraped_name,
          scrapedBrand: r.scraped_brand,
          barcode: r.barcode,
          status: r.status as 'active',
          lastScrapedAt: '2026-11-24T00:00:00Z'
        }));
      isolatedRes = await DatabaseService.getRetailerProductsWithBarcodes();
    } finally {
      StorageService.getRetailerProducts = origGetRP;
      StorageService.getAllProducts = origGetAllProds;
    }

    // 2. Mod PostgreSQL pool
    const fakePool = {
      async query(sql: string) {
        if (sql.includes('FROM products')) {
          return { rows: allNodes.map(p => ({ id: p.id, canonical_product_id: p.canonicalProductId ?? null })) };
        }
        return { rows: rpFixtureRows };
      }
    };
    const pgRes = await DatabaseService.getRetailerProductsWithBarcodes({ poolOverride: fakePool });

    // 3. Mod Supabase fallback
    const fakeSupabase = {
      from(table: string) {
        return {
          select() {
            const chain: any = {
              not() {
                return chain;
              },
              async range() {
                if (table === 'products') {
                  return {
                    data: allNodes.map(p => ({ id: p.id, canonical_product_id: p.canonicalProductId ?? null })),
                    error: null
                  };
                }
                return { data: rpFixtureRows, error: null };
              }
            };
            return chain;
          }
        };
      }
    };
    const sbRes = await DatabaseService.getRetailerProductsWithBarcodes({ supabaseClientOverride: fakeSupabase });

    // Verificăm paritate strictă pe toate cele 3 moduri
    for (const [modeName, rows] of [
      ['izolat', isolatedRes],
      ['postgresql', pgRes],
      ['supabase', sbRes]
    ] as const) {
      assert.equal(rows.length, rpFixtureRows.length, `[${modeName}] păstrează toate rândurile cu barcode & proveniență`);
      const byId = new Map(rows.map(r => [r.id, r]));
      assert.equal(byId.get('rp-root')?.productId, 'f3b16-root', `[${modeName}] root valid`);
      assert.equal(byId.get('rp-alias')?.productId, 'f3b16-root', `[${modeName}] alias 2-hop -> root`);
      assert.equal(byId.get('rp-alias')?.barcode, '5941600000097', `[${modeName}] barcode păstrat`);
      assert.equal(byId.get('rp-alias')?.externalSku, 'SKU-ALIAS', `[${modeName}] proveniență externalSku păstrată`);
      for (const badRpId of ['rp-cyc', 'rp-self', 'rp-deep', 'rp-orphan', 'rp-missing']) {
        const rec = byId.get(badRpId);
        assert.ok(rec, `[${modeName}] înregistrarea ${badRpId} păstrează barcode/proveniența`);
        assert.equal(rec!.productId, null, `[${modeName}] ${badRpId} întoarce productId: null (NU ID brut invalid)`);
        assert.ok(rec!.barcode && rec!.retailerId && rec!.externalSku, `[${modeName}] ${badRpId} păstrează metadatele retailer`);
      }
    }
    pass('Partea B (1/2): getRetailerProductsWithBarcodes() elimină ID-urile brute invalide (paritate izolat/PG/Supabase)');

    // BarcodeService.lookupProductByBarcode(): nu rezolvă produse/rp/oferte ciclice sau orfane
    const lookupValidViaAliasRp = lookupProductByBarcode({
      barcode: '5941600000097',
      products: allNodes,
      offers: [
        {
          id: 'off-bc-valid',
          productId: 'f3b16-alias-2',
          storeId: 'lidl',
          price: 8.2,
          unitPrice: 8.2,
          unitPriceMeasure: 'lei/buc',
          isPromo: false,
          source: 'official_feed',
          confidenceLevel: 'high',
          verificationStatus: 'verified',
          observationDate: '2026-11-23',
          lastChecked: new Date().toISOString()
        },
        {
          id: 'off-bc-cyc',
          productId: 'f3b16-cyc-a',
          storeId: 'kaufland',
          price: 0.99,
          unitPrice: 0.99,
          unitPriceMeasure: 'lei/buc',
          isPromo: true,
          source: 'official_feed',
          confidenceLevel: 'high',
          verificationStatus: 'verified',
          observationDate: '2026-11-23',
          lastChecked: new Date().toISOString()
        }
      ],
      stores: STORES,
      retailerProducts: isolatedRes,
      aliasMap: rawIndex
    });
    assert.equal(lookupValidViaAliasRp.found, true);
    assert.equal(lookupValidViaAliasRp.product?.id, 'f3b16-root');
    assert.equal(lookupValidViaAliasRp.lowestPrice, 8.2);

    // Barcode asociat doar unui ciclu / orfan -> found: false (niciodată nu expune produsul ciclic/orfan!)
    for (const badBarcode of ['5941600000028', '5941600000035', '5941600000042']) {
      const badLookup = lookupProductByBarcode({
        barcode: badBarcode,
        products: allNodes,
        offers: [],
        stores: STORES,
        retailerProducts: [
          {
            id: 'rp-bad-direct',
            retailerId: 'lidl',
            productId: badBarcode === '5941600000028' ? 'f3b16-cyc-a' : 'f3b16-orphan',
            scrapedName: 'Bad',
            barcode: badBarcode,
            status: 'active'
          }
        ],
        aliasMap: rawIndex
      });
      assert.equal(badLookup.found, false, `BarcodeService nu întoarce produs ciclic/orfan pentru ${badBarcode}`);
    }
    pass('Partea B (2/2): BarcodeService respinge ciclu, self-ref și orfan fără fallback la productId brut');
  }

  // =========================================================================
  // PARTEA C — CatalogStagingManager & validateStagingOfferCandidate
  // =========================================================================
  {
    const nowIso = new Date().toISOString();
    const baseStagingOffer = (id: string, overrides: Partial<CatalogExtractedOffer> = {}): CatalogExtractedOffer => ({
      id,
      runId: 'run-f3b16',
      documentId: 'doc-f3b16',
      retailerId: 'lidl',
      retailerName: 'Lidl',
      rawTitle: overrides.rawTitle ?? 'Lapte UHT 1.5% 1L Test',
      rawBrand: 'BrandTest',
      rawBarcode: overrides.rawBarcode,
      normalPrice: 10.0,
      effectivePrice: 8.5,
      currency: 'RON',
      packageQuantity: 1,
      packageUnit: 'buc',
      isPromo: false,
      validUntil: '2029-12-31',
      matchConfidence: overrides.matchConfidence ?? 0.82,
      matchMethod: overrides.matchMethod ?? 'name_brand_similarity',
      matchedProductId: overrides.matchedProductId,
      matchedProductName: overrides.matchedProductName,
      stagingStatus: 'APPROVED',
      reviewedBy: 'admin@cosulmeu.ro',
      reviewedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    StorageService.resetAllData();
    for (const node of allNodes) {
      StorageService.addCustomProduct(node);
    }

    const stgValidAlias = baseStagingOffer('stg-f3b16-valid-alias', {
      matchedProductId: 'f3b16-alias-2',
      matchMethod: 'name_brand_similarity',
      matchConfidence: 0.83
    });
    const stgCyc = baseStagingOffer('stg-f3b16-cyc', {
      matchedProductId: 'f3b16-cyc-a',
      rawBarcode: '5941600000011', // chiar dacă barcode-ul aparține lui root, NU trebuie să facă fallback la matcher/barcode!
      matchMethod: 'name_brand_similarity',
      matchConfidence: 0.81
    });
    const stgSelf = baseStagingOffer('stg-f3b16-self', {
      matchedProductId: 'f3b16-self',
      rawBarcode: '5941600000011'
    });
    const stgDeep = baseStagingOffer('stg-f3b16-deep', {
      matchedProductId: 'f3b16-deep-0',
      rawBarcode: '5941600000011'
    });
    const stgOrphan = baseStagingOffer('stg-f3b16-orphan', {
      matchedProductId: 'f3b16-orphan',
      rawBarcode: '5941600000011'
    });
    const stgMissingRoot = baseStagingOffer('stg-f3b16-missing', {
      matchedProductId: 'f3b16-root-inexistent',
      rawBarcode: '5941600000011'
    });

    StorageService.addCatalogExtractedOffers([stgValidAlias, stgCyc, stgSelf, stgDeep, stgOrphan, stgMissingRoot]);

    // 1. previewPublishValidated()
    const preview = await CatalogStagingManager.previewPublishValidated([
      stgValidAlias.id,
      stgCyc.id,
      stgSelf.id,
      stgDeep.id,
      stgOrphan.id,
      stgMissingRoot.id
    ]);

    assert.equal(preview.toPublishCount, 1, 'Doar oferta cu alias valid ajunge în preview eligibil');
    assert.deepEqual(preview.eligibleOfferIds, [stgValidAlias.id]);
    assert.equal(preview.items[0].matchedProductId, 'f3b16-root');
    assert.equal(preview.items[0].confidenceStatus, 'confident');
    assert.equal(preview.newProductsCount, 0, 'Ofertele invalide nu sunt numărate ca produse noi');
    assert.equal(preview.existingUpdatedCount, 1, 'Doar oferta validă este numărată ca produs existent');
    assert.equal(preview.errors.length, 5, 'Toate cele 5 referințe invalide (ciclu, self, deep>16, orfan, missing) generează erori explicite');
    assert.equal(preview.rejectedItems?.length, 5);
    assert.ok(preview.rejectedItems?.every(r => r.confidenceStatus === 'unconfident'));

    // Proveniența originală pe ofertele din storage rămâne nemodificată după preview
    const storedAfterPreview = new Map(StorageService.getCatalogExtractedOffers().map(o => [o.id, o]));
    assert.equal(storedAfterPreview.get(stgCyc.id)?.matchMethod, 'name_brand_similarity');
    assert.equal(storedAfterPreview.get(stgCyc.id)?.matchConfidence, 0.81);
    assert.equal(storedAfterPreview.get(stgCyc.id)?.matchedProductId, 'f3b16-cyc-a');
    pass('Partea C (1/3): CatalogStagingManager.previewPublishValidated() folosește raw index, blochează invalide fără fallback și păstrează proveniența');

    // 2. publishValidatedOffers() (memorie) — blochează referințele invalide fără a crea produse noi sau a suprascrie proveniența
    const productCountBeforePublish = StorageService.getAllProducts().length;
    const pubInvalidOnly = await CatalogStagingManager.publishValidatedOffers([
      stgCyc.id,
      stgSelf.id,
      stgDeep.id,
      stgOrphan.id,
      stgMissingRoot.id
    ]);
    assert.equal(pubInvalidOnly.publishedCount, 0, 'Nicio ofertă cu referință canonică invalidă nu este publicată');
    assert.deepEqual(pubInvalidOnly.publishedOfferIds, []);
    assert.equal(pubInvalidOnly.errors.length, 5);
    assert.equal(
      StorageService.getAllProducts().length,
      productCountBeforePublish,
      'Nu se creează niciun produs nou prin fallback la ProductMatcher'
    );
    const storedAfterInvalidPub = new Map(StorageService.getCatalogExtractedOffers().map(o => [o.id, o]));
    assert.equal(storedAfterInvalidPub.get(stgCyc.id)?.stagingStatus, 'NEEDS_REVIEW');
    assert.equal(storedAfterInvalidPub.get(stgCyc.id)?.matchMethod, 'name_brand_similarity', 'Proveniența matchMethod nu este alterată');
    assert.equal(storedAfterInvalidPub.get(stgCyc.id)?.matchConfidence, 0.81, 'Proveniența matchConfidence nu este alterată');

    // Publicarea ofertei valide cu alias multi-hop -> publică pe root și păstrează matchMethod/matchConfidence
    const pubValid = await CatalogStagingManager.publishValidatedOffers([stgValidAlias.id]);
    assert.equal(pubValid.publishedCount, 1);
    assert.deepEqual(pubValid.publishedOfferIds, [stgValidAlias.id]);
    assert.equal(pubValid.errors.length, 0);
    const publishedOffer = StorageService.getProductOffers().find(
      o => o.productId === 'f3b16-root' && o.storeId === 'lidl'
    );
    assert.ok(publishedOffer && publishedOffer.price === 8.5, 'Oferta este publicată pe f3b16-root');
    const stgValidAfterPub = StorageService.getCatalogExtractedOffers().find(o => o.id === stgValidAlias.id);
    assert.equal(stgValidAfterPub?.matchMethod, 'name_brand_similarity', 'Nu transformă name_brand_similarity în gtin_exact la publicare');
    assert.equal(stgValidAfterPub?.matchConfidence, 0.83);
    pass('Partea C (2/3): CatalogStagingManager.publishValidatedOffers() respinge invalide fără duplicate și publică alias valid păstrând proveniența');

    // 3. DatabaseService.validateStagingOfferCandidate() — NU fabrică gtin_exact fără dovadă verificabilă GTIN
    const canonicalOnly = allNodes.filter(p => !p.canonicalProductId && resolveCanonicalProductDetail(p.id, rawIndex).canonicalId === p.id);
    const canonicalById = new Map(canonicalOnly.map(p => [p.id, p]));

    // 3a. Potrivire existentă name_brand_similarity (0.82), fără barcode -> rămâne name_brand_similarity (0.82), NU devine gtin_exact (1.0)
    const simVal = DatabaseService.validateStagingOfferCandidate({
      offer: {
        id: 'stg-c-sim',
        retailerId: 'lidl',
        rawTitle: 'Lapte UHT 1.5% 1L Test',
        normalPrice: 10,
        effectivePrice: 8.5,
        packageQuantity: 1,
        packageUnit: 'l',
        matchedProductId: 'f3b16-alias-2',
        matchMethod: 'name_brand_similarity',
        matchConfidence: 0.82,
        stagingStatus: 'NEEDS_REVIEW'
      },
      validStoreIds: new Set(['lidl']),
      validDocumentIds: new Set(),
      productsById: canonicalById,
      allProducts: canonicalOnly,
      batchSignatures: new Set(),
      existingApprovedSignatures: new Map(),
      aliasIndex: rawIndex,
      todayStr: '2026-11-24'
    });
    assert.equal(simVal.valid, true);
    assert.equal(simVal.resolvedProductId, 'f3b16-root');
    assert.equal(simVal.resolvedMatchMethod, 'name_brand_similarity', 'Păstrează name_brand_similarity fără conversie în gtin_exact');
    assert.equal(simVal.resolvedMatchConfidence, 0.82, 'Păstrează confidence 0.82 fără supra-scriere la 1.0');

    // 3b. Potrivire cu gtin_exact DAR fără barcode care să se potrivească -> NU validează ca gtin_exact / 1.0
    const fakeGtinVal = DatabaseService.validateStagingOfferCandidate({
      offer: {
        id: 'stg-c-fake-gtin',
        retailerId: 'lidl',
        rawTitle: 'Lapte UHT 1.5% 1L Test',
        rawBarcode: '5949999999999', // nu corespunde cu 5941600000011 al lui root!
        normalPrice: 10,
        effectivePrice: 8.5,
        packageQuantity: 1,
        packageUnit: 'l',
        matchedProductId: 'f3b16-root',
        matchMethod: 'gtin_exact',
        matchConfidence: 1.0,
        stagingStatus: 'NEEDS_REVIEW'
      },
      validStoreIds: new Set(['lidl']),
      validDocumentIds: new Set(),
      productsById: canonicalById,
      allProducts: canonicalOnly,
      batchSignatures: new Set(),
      existingApprovedSignatures: new Map(),
      aliasIndex: rawIndex,
      todayStr: '2026-11-24'
    });
    assert.equal(fakeGtinVal.valid, true);
    assert.notEqual(fakeGtinVal.resolvedMatchMethod, 'gtin_exact', 'Nu acordă gtin_exact fără potrivire GTIN verificabilă');
    assert.ok((fakeGtinVal.resolvedMatchConfidence ?? 1) < 1.0, 'Nu acordă confidence 1.0 fără potrivire GTIN verificabilă');

    // 3c. Potrivire GTIN verificabilă reală (rawBarcode === root.barcode) -> gtin_exact, 1.0
    const realGtinVal = DatabaseService.validateStagingOfferCandidate({
      offer: {
        id: 'stg-c-real-gtin',
        retailerId: 'lidl',
        rawTitle: 'Lapte UHT 1.5% 1L Test',
        rawBarcode: '5941600000011',
        normalPrice: 10,
        effectivePrice: 8.5,
        packageQuantity: 1,
        packageUnit: 'l',
        matchedProductId: 'f3b16-alias-2',
        matchMethod: 'gtin_exact',
        matchConfidence: 1.0,
        stagingStatus: 'NEEDS_REVIEW'
      },
      validStoreIds: new Set(['lidl']),
      validDocumentIds: new Set(),
      productsById: canonicalById,
      allProducts: canonicalOnly,
      batchSignatures: new Set(),
      existingApprovedSignatures: new Map(),
      aliasIndex: rawIndex,
      todayStr: '2026-11-24'
    });
    assert.equal(realGtinVal.valid, true);
    assert.equal(realGtinVal.resolvedProductId, 'f3b16-root');
    assert.equal(realGtinVal.resolvedMatchMethod, 'gtin_exact');
    assert.equal(realGtinVal.resolvedMatchConfidence, 1.0);

    // 3d. Referințe canonice invalide (ciclu, self-ref, depth>16, orfan, missing root) -> valid: false cu eroare explicită
    for (const [label, badTarget] of [
      ['ciclu', 'f3b16-cyc-a'],
      ['self-ref', 'f3b16-self'],
      ['depth>16', 'f3b16-deep-0'],
      ['orfan', 'f3b16-orphan'],
      ['missing-root', 'f3b16-root-inexistent']
    ] as const) {
      const badVal = DatabaseService.validateStagingOfferCandidate({
        offer: {
          id: `stg-c-bad-${label}`,
          retailerId: 'lidl',
          rawTitle: 'Lapte Invalid',
          normalPrice: 10,
          effectivePrice: 8.5,
          matchedProductId: badTarget,
          stagingStatus: 'NEEDS_REVIEW'
        },
        validStoreIds: new Set(['lidl']),
        validDocumentIds: new Set(),
        productsById: canonicalById,
        allProducts: canonicalOnly,
        batchSignatures: new Set(),
        existingApprovedSignatures: new Map(),
        aliasIndex: rawIndex,
        todayStr: '2026-11-24'
      });
      assert.equal(badVal.valid, false, `validateStagingOfferCandidate respinge ${label}`);
      assert.equal(badVal.resolvedProductId, undefined);
      assert.ok(badVal.errors.length > 0);
    }
    pass('Partea C (3/3): validateStagingOfferCandidate() nu fabrică gtin_exact fără dovadă GTIN și respinge toate referințele canonice invalide');
  }

  StorageService.resetAllData();
  console.log(`\nTOATE CELE ${passed} GRUPURI DE TESTE FAZA 3B.1.6 AU TRECUT CU SUCCES!`);
}

runTests().catch(err => {
  console.error('EROARE ÎN TESTELE FAZA 3B.1.6:', err);
  process.exit(1);
});
