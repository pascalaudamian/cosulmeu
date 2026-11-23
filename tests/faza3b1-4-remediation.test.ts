// tests/faza3b1-4-remediation.test.ts
// Suită de verificare controlată FAZA 3B.1.4:
//   - Finding #2: DatabaseService.deleteProducts() / deleteProductsViaSupabase() fail-closed + non-truncation + partial modification tracking + rute admin HTTP
//   - Finding #1: Păstrarea grafului brut CanonicalAliasIndex + detectare cicluri / self-loop / >max-depth / orfani în toate fluxurile critice (fără StorageService)

import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import {
  DatabaseService,
  getCatalogOptimizationCacheStats
} from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.ts';
import { PriceAlertService } from '../src/services/PriceAlertService.ts';
import {
  buildCanonicalAliasIndex,
  resolveCanonicalProductDetail
} from '../src/services/ProductIdentityService.ts';
import { supabase } from '../src/lib/supabase.ts';
import { STORES } from '../src/data/mockData.ts';
import type { PriceAlert, Product, ProductOffer, ShoppingListItem } from '../src/types.ts';

let passed = 0;
function pass(label: string) {
  passed++;
  console.log(`  [PASS] ${label}`);
}

interface FakeSupabaseConfig {
  productsResponseOverride?: any;
  productsRows?: Array<{ id: string; canonical_product_id: string | null }>;
  productsError?: { message: string } | null;
  priceObservationsResponseOverride?: any;
  priceObservationsRows?: Array<{ product_id: any }>;
  priceObservationsError?: { message: string } | null;
  maxRowsPerRange?: number;
  deleteErrorsByTable?: Record<string, { message: string }>;
  failProductsDeleteAfterCount?: number;
  failChildTableOnCallIndex?: { table: string; callIndex: number; error: { message: string } };
}

function createFakeSupabaseClient(config: FakeSupabaseConfig) {
  const deleteCalls: Array<{ table: string; column: string; ids: string[] }> = [];
  const updateCalls: Array<{ table: string }> = [];
  const childTableCallCount: Record<string, number> = {};
  let deletedProductsSoFar = 0;

  return {
    deleteCalls,
    updateCalls,
    from(table: string) {
      return {
        select(_cols: string) {
          const state: { inVals?: string[]; from?: number; to?: number } = {};
          const queryObj: any = {
            in(_col: string, vals: string[]) {
              state.inVals = vals.slice();
              return queryObj;
            },
            range(from: number, to: number) {
              state.from = from;
              state.to = to;
              return executeSelect();
            },
            then(onFulfilled: any, onRejected: any) {
              return executeSelect().then(onFulfilled, onRejected);
            }
          };

          async function executeSelect() {
            const cap = config.maxRowsPerRange ?? 1000;
            if (table === 'products') {
              if (config.productsResponseOverride !== undefined) {
                return config.productsResponseOverride;
              }
              if (config.productsError) {
                return { data: null, error: config.productsError };
              }
              const all = config.productsRows || [];
              const start = state.from ?? 0;
              const requestedEnd = state.to ?? all.length - 1;
              const effectiveEnd = Math.min(requestedEnd, start + cap - 1);
              return { data: all.slice(start, effectiveEnd + 1), error: null };
            }

            if (table === 'price_observations') {
              if (config.priceObservationsResponseOverride !== undefined) {
                return config.priceObservationsResponseOverride;
              }
              if (config.priceObservationsError) {
                return { data: null, error: config.priceObservationsError };
              }
              const all = config.priceObservationsRows || [];
              const filtered = state.inVals
                ? all.filter(r => state.inVals!.includes(String(r?.product_id)))
                : all;
              const start = state.from ?? 0;
              const requestedEnd = state.to ?? start + cap - 1;
              const effectiveEnd = Math.min(requestedEnd, start + cap - 1);
              return { data: filtered.slice(start, effectiveEnd + 1), error: null };
            }

            return { data: [], error: null };
          }

          return queryObj;
        },
        delete() {
          const delState: { inCol?: string; inVals?: string[] } = {};
          const executeDelete = async () => {
            const ids = delState.inVals || [];
            deleteCalls.push({ table, column: delState.inCol || '', ids: ids.slice() });

            childTableCallCount[table] = (childTableCallCount[table] || 0) + 1;
            if (
              config.failChildTableOnCallIndex &&
              config.failChildTableOnCallIndex.table === table &&
              childTableCallCount[table] === config.failChildTableOnCallIndex.callIndex
            ) {
              return { data: null, error: config.failChildTableOnCallIndex.error };
            }

            if (
              table === 'products' &&
              config.failProductsDeleteAfterCount !== undefined &&
              deletedProductsSoFar >= config.failProductsDeleteAfterCount
            ) {
              return { data: null, error: { message: 'Injected chunk 2 DELETE failure on products' } };
            }

            const injectedErr = config.deleteErrorsByTable?.[table];
            if (injectedErr) {
              return { data: null, error: injectedErr };
            }

            if (table === 'products') {
              deletedProductsSoFar += ids.length;
            }
            return {
              data: ids.map(id => ({ id })),
              error: null
            };
          };

          return {
            in(col: string, vals: string[]) {
              delState.inCol = col;
              delState.inVals = vals.slice();
              return {
                select(_cols?: string) {
                  return executeDelete();
                },
                then(onFulfilled: any, onRejected: any) {
                  return executeDelete().then(onFulfilled, onRejected);
                }
              };
            }
          };
        },
        update() {
          updateCalls.push({ table });
          return {
            in: async () => ({ data: null, error: null })
          };
        }
      };
    }
  };
}

async function runTests() {
  console.log('====================================================================');
  console.log('FAZA 3B.1.4: TESTE REMEDIERE CONTROLATĂ FINDINGS #2 ȘI #1');
  console.log('====================================================================\n');

  // =========================================================================
  // PARTEA 1 — FINDING #2: DELETE PRODUCTS (Supabase fallback + rute admin)
  // =========================================================================
  {
    // 1. Eroare la verificarea price_observations -> fail-closed & 0 DELETE & cache intact
    const cacheBeforeErr = getCatalogOptimizationCacheStats().version;
    const obsErrClient = createFakeSupabaseClient({
      productsRows: [
        { id: 'f3b14-del-1', canonical_product_id: null },
        { id: 'f3b14-del-1-alias', canonical_product_id: 'f3b14-del-1' }
      ],
      priceObservationsError: { message: 'Supabase timeout price_observations' }
    });
    const resObsErr = await DatabaseService.deleteProductsViaSupabase(['f3b14-del-1'], obsErrClient);
    assert.equal(resObsErr.deletedCount, 0);
    assert.equal(resObsErr.blockedCount, 1);
    assert.equal(resObsErr.partialModification, false);
    assert.deepEqual(resObsErr.partialDeletions, []);
    assert.equal(obsErrClient.deleteCalls.length, 0, 'Eroare price_observations: 0 apeluri DELETE');
    assert.equal(obsErrClient.updateCalls.length, 0, 'Eroare price_observations: 0 apeluri UPDATE');
    assert.equal(getCatalogOptimizationCacheStats().version, cacheBeforeErr, 'Cache-ul NU este invalidat la eroare');
    pass('Finding #2 (1/6): Eroare la price_observations -> fail-closed (deletedCount=0, partialModification=false, 0 DELETE)');

    // 2. Răspuns ambiguu la price_observations & products (data: null, non-array, rând fără product_id valid)
    const ambigNullClient = createFakeSupabaseClient({
      productsRows: [{ id: 'f3b14-ambig-1', canonical_product_id: null }],
      priceObservationsResponseOverride: { data: null, error: null }
    });
    const resAmbigNull = await DatabaseService.deleteProductsViaSupabase(['f3b14-ambig-1'], ambigNullClient);
    assert.equal(resAmbigNull.deletedCount, 0);
    assert.equal(resAmbigNull.partialModification, false);
    assert.equal(ambigNullClient.deleteCalls.length, 0, 'Răspuns { data: null, error: null } la obs -> 0 DELETE');

    const ambigBadRowClient = createFakeSupabaseClient({
      productsRows: [{ id: 'f3b14-ambig-2', canonical_product_id: null }],
      priceObservationsResponseOverride: { data: [{ product_id: '' }], error: null }
    });
    const resAmbigRow = await DatabaseService.deleteProductsViaSupabase(['f3b14-ambig-2'], ambigBadRowClient);
    assert.equal(resAmbigRow.deletedCount, 0);
    assert.equal(resAmbigRow.partialModification, false);
    assert.equal(ambigBadRowClient.deleteCalls.length, 0, 'Rând ambiguu fără product_id -> 0 DELETE');

    const ambigProdClient = createFakeSupabaseClient({
      productsResponseOverride: { data: null, error: null }
    });
    const resAmbigProd = await DatabaseService.deleteProductsViaSupabase(['f3b14-ambig-3'], ambigProdClient);
    assert.equal(resAmbigProd.deletedCount, 0);
    assert.equal(resAmbigProd.partialModification, false);
    assert.equal(ambigProdClient.deleteCalls.length, 0, 'Răspuns { data: null, error: null } la products -> 0 DELETE');
    pass('Finding #2 (2/6): Răspunsuri ambigue la price_observations și products -> fail-closed cu 0 DELETE');

    // 3. Fără referințe în price_observations -> ștergere curată, cache invalidat, 0 DELETE/UPDATE pe price_observations
    const cacheBeforeClean = getCatalogOptimizationCacheStats().version;
    const cleanClient = createFakeSupabaseClient({
      productsRows: [
        { id: 'f3b14-clean-root', canonical_product_id: null },
        { id: 'f3b14-clean-alias', canonical_product_id: 'f3b14-clean-root' }
      ],
      priceObservationsRows: []
    });
    const resClean = await DatabaseService.deleteProductsViaSupabase(['f3b14-clean-root'], cleanClient);
    assert.equal(resClean.deletedCount, 2);
    assert.equal(resClean.blockedCount, 0);
    assert.equal(resClean.partialModification, false);
    assert.equal(resClean.error, undefined);
    assert.equal(cleanClient.deleteCalls.some(c => c.table === 'price_observations'), false);
    assert.equal(cleanClient.updateCalls.length, 0);
    assert.equal(getCatalogOptimizationCacheStats().version, cacheBeforeClean + 1, 'Cache invalidat la ștergere completă reușită');
    pass('Finding #2 (3/6): Ștergere curată când price_observations e gol (cache invalidat, price_observations intangibil)');

    // 4. >1000 observații pe A + 1 observație pe B + max_rows server scăzut (ex: 200 rânduri / răspuns)
    const manyObs = [
      ...Array.from({ length: 1350 }, () => ({ product_id: 'f3b14-A' })),
      { product_id: 'f3b14-B' }
    ];
    const truncatedServerClient = createFakeSupabaseClient({
      productsRows: [
        { id: 'f3b14-A', canonical_product_id: null },
        { id: 'f3b14-B', canonical_product_id: null },
        { id: 'f3b14-C', canonical_product_id: null }
      ],
      priceObservationsRows: manyObs,
      maxRowsPerRange: 200
    });
    const resMany = await DatabaseService.deleteProductsViaSupabase(['f3b14-A', 'f3b14-B', 'f3b14-C'], truncatedServerClient);
    assert.equal(resMany.blockedCount, 2);
    assert.deepEqual(new Set(resMany.blockedIds), new Set(['f3b14-A', 'f3b14-B']));
    assert.equal(resMany.deletedCount, 1);
    assert.equal(resMany.partialModification, false);
    assert.equal(truncatedServerClient.deleteCalls.some(c => c.table === 'price_observations'), false);
    assert.equal(truncatedServerClient.updateCalls.length, 0);
    const deletedProdIds = truncatedServerClient.deleteCalls.filter(c => c.table === 'products').flatMap(c => c.ids);
    assert.deepEqual(deletedProdIds, ['f3b14-C']);
    pass('Finding #2 (4/6): >1000 obs pe A + 1 pe B + max_rows=200 -> B nu este mascat și doar C e șters');

    // 5. Eșec parțial pe tabel copil + eșec chunk 2 la ștergere în loturi + rute HTTP admin
    // 5a: Tabel copil eșuează după ce product_offers a fost deja șters -> partialModification: true, cache NE-invalidat
    const cacheBeforeChildErr = getCatalogOptimizationCacheStats().version;
    const childFailClient = createFakeSupabaseClient({
      productsRows: [{ id: 'f3b14-partial-1', canonical_product_id: null }],
      priceObservationsRows: [],
      deleteErrorsByTable: { promotions: { message: 'Injected promotions DELETE failure' } }
    });
    const resChildFail = await DatabaseService.deleteProductsViaSupabase(['f3b14-partial-1'], childFailClient);
    assert.equal(resChildFail.deletedCount, 0);
    assert.equal(resChildFail.partialModification, true, 'Eșec pe promotions după product_offers -> partialModification: true');
    assert.ok(resChildFail.partialDeletions?.some(d => d.table === 'product_offers'));
    assert.ok(resChildFail.error && resChildFail.error.includes('product_offers'));
    assert.equal(childFailClient.deleteCalls.some(c => c.table === 'products'), false);
    assert.equal(getCatalogOptimizationCacheStats().version, cacheBeforeChildErr, 'Cache NU este invalidat la eșec parțial copil');

    // 5b: Chunk 2 eșuează după ce chunk 1 a șters deja 100 produse -> deletedCount === 100 (NU 0!), partialModification: true, cache NE-invalidat
    const cacheBeforeChunkErr = getCatalogOptimizationCacheStats().version;
    const bulk120 = Array.from({ length: 120 }, (_, i) => ({
      id: `f3b14-bulk-${i}`,
      canonical_product_id: null
    }));
    const chunk2FailClient = createFakeSupabaseClient({
      productsRows: bulk120,
      priceObservationsRows: [],
      failProductsDeleteAfterCount: 100
    });
    const resChunkFail = await DatabaseService.deleteProductsViaSupabase(
      bulk120.map(p => p.id),
      chunk2FailClient
    );
    assert.equal(resChunkFail.deletedCount, 100, 'Numărul real de produse șterse din chunk 1 (100) este păstrat, NU suprascris cu 0');
    assert.equal(resChunkFail.blockedCount, 20);
    assert.equal(resChunkFail.partialModification, true);
    assert.ok(resChunkFail.partialDeletions?.some(d => d.table === 'products' && d.targetIdsCount === 100));
    assert.equal(chunk2FailClient.deleteCalls.some(c => c.table === 'price_observations'), false);
    assert.equal(getCatalogOptimizationCacheStats().version, cacheBeforeChunkErr, 'Cache NU este invalidat când chunk 2 eșuează');
    pass('Finding #2 (5/6): Eșec parțial pe tabel copil și chunk 2 păstrează contoarele reale + partialModification + cache neatins');

    // 5c: Rutele admin HTTP (/api/admin/products/:id & /api/admin/products/bulk-delete) nu returnează success: true la eșec parțial
    const { app } = await import('../server.ts');
    const srv = http.createServer(app);
    await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const adminToken = process.env.ADMIN_API_KEY || 'cosul-meu-admin-dev-secret-2026';

    const origDeleteProducts = DatabaseService.deleteProducts;
    const origStorageDelete = StorageService.deleteProducts;
    let storageDeleteCalls = 0;
    try {
      (StorageService as any).deleteProducts = (...args: any[]) => {
        storageDeleteCalls++;
        return origStorageDelete.apply(StorageService, args as any);
      };
      DatabaseService.deleteProducts = async () => ({
        deletedCount: 100,
        blockedCount: 20,
        blockedIds: ['p-20'],
        partialModification: true,
        partialDeletions: [{ table: 'products', targetIdsCount: 100 }],
        error: 'Eșec parțial injectat pe chunk 2'
      });

      const bulkPartialRes = await fetch(`${baseUrl}/api/admin/products/bulk-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ ids: ['p-1', 'p-20'] })
      });
      assert.equal(bulkPartialRes.status, 500, 'bulk-delete cu partialModification -> HTTP 500');
      const bulkPartialJson = await bulkPartialRes.json();
      assert.equal(bulkPartialJson.success, false, 'bulk-delete cu partialModification NU returnează success: true');
      assert.equal(bulkPartialJson.partialModification, true);
      assert.equal(bulkPartialJson.deletedCount, 100);
      assert.equal(storageDeleteCalls, 0, 'StorageService.deleteProducts NU este apelat la eroare parțială');

      const singlePartialRes = await fetch(`${baseUrl}/api/admin/products/p-1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(singlePartialRes.status, 500);
      const singlePartialJson = await singlePartialRes.json();
      assert.equal(singlePartialJson.success, false);
      assert.equal(singlePartialJson.partialModification, true);
      assert.equal(storageDeleteCalls, 0);

      // Verificare și 409 când e blocat pre-DELETE de price_observations
      DatabaseService.deleteProducts = async () => ({
        deletedCount: 0,
        blockedCount: 1,
        blockedIds: ['p-protected'],
        partialModification: false,
        error: 'Blocat price_observations'
      });
      const blockedRes = await fetch(`${baseUrl}/api/admin/products/bulk-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ ids: ['p-protected'] })
      });
      assert.equal(blockedRes.status, 409);
      const blockedJson = await blockedRes.json();
      assert.equal(blockedJson.success, false);
      assert.equal(blockedJson.partialModification, false);
      assert.equal(storageDeleteCalls, 0);
      pass('Finding #2 (6/6): Rutele admin DELETE propagă 500/partialModification fără success:true și fără StorageService');
    } finally {
      DatabaseService.deleteProducts = origDeleteProducts;
      (StorageService as any).deleteProducts = origStorageDelete;
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }
  }

  // =========================================================================
  // PARTEA 2 — FINDING #1: RAW CanonicalAliasIndex + TOATE FLUXURILE CRITICE (fără StorageService)
  // =========================================================================
  {
    StorageService.resetAllData();
    assert.equal(
      StorageService.getAllProducts().some(p => p.id.startsWith('f3b14-')),
      false,
      'Verificăm că niciun produs de test NU există în StorageService'
    );

    const deepNodes = Array.from({ length: 18 }, (_, i) => ({
      id: `f3b14-deep-${i}`,
      canonical_product_id: i === 17 ? 'f3b14-root' : `f3b14-deep-${i + 1}`
    }));
    const rawDbNodes = [
      { id: 'f3b14-root', canonical_product_id: null },
      { id: 'f3b14-mid', canonical_product_id: 'f3b14-root' },
      { id: 'f3b14-leaf', canonical_product_id: 'f3b14-mid' },
      { id: 'f3b14-other-root', canonical_product_id: null },
      { id: 'f3b14-other-alias', canonical_product_id: 'f3b14-other-root' },
      { id: 'f3b14-cyc-a', canonical_product_id: 'f3b14-cyc-b' },
      { id: 'f3b14-cyc-b', canonical_product_id: 'f3b14-cyc-a' },
      { id: 'f3b14-self', canonical_product_id: 'f3b14-self' },
      ...deepNodes,
      { id: 'f3b14-orphan', canonical_product_id: 'f3b14-missing-root' }
    ];

    const fakeGraphClient = createFakeSupabaseClient({ productsRows: rawDbNodes });
    const rawAliasIndex = await DatabaseService.getProductAliasIndex({ supabaseClient: fakeGraphClient });

    assert.equal(rawAliasIndex.hasExplicitNodes, true);
    assert.equal(rawAliasIndex.parentById.get('f3b14-cyc-a'), 'f3b14-cyc-b');
    assert.equal(rawAliasIndex.parentById.get('f3b14-cyc-b'), 'f3b14-cyc-a');
    assert.equal(rawAliasIndex.parentById.get('f3b14-self'), 'f3b14-self');
    assert.equal(rawAliasIndex.parentById.get('f3b14-orphan'), 'f3b14-missing-root');

    const dCycle = resolveCanonicalProductDetail('f3b14-cyc-a', rawAliasIndex);
    assert.equal(dCycle.cycleDetected, true);
    assert.equal(dCycle.found, false);

    const dSelf = resolveCanonicalProductDetail('f3b14-self', rawAliasIndex);
    assert.equal(dSelf.cycleDetected, true);
    assert.equal(dSelf.found, false);

    const dDeep = resolveCanonicalProductDetail('f3b14-deep-0', rawAliasIndex);
    assert.equal(dDeep.cycleDetected, true);
    assert.equal(dDeep.found, false);

    const dOrphan = resolveCanonicalProductDetail('f3b14-orphan', rawAliasIndex);
    assert.equal(dOrphan.cycleDetected, false);
    assert.equal(dOrphan.wasAlias, true);
    assert.equal(dOrphan.found, false);
    assert.equal(dOrphan.canonicalId, null);

    const dValid = resolveCanonicalProductDetail('f3b14-leaf', rawAliasIndex);
    assert.equal(dValid.found, true);
    assert.equal(dValid.canonicalId, 'f3b14-root');
    assert.equal(dValid.hops, 2);
    pass('Finding #1 (1/6): Raw CanonicalAliasIndex păstrează și detectează ciclu, self-ref, >16 hops și orfan');

    // Catalog DB stubbed exclusiv în DatabaseService (ZERO produse din test în StorageService!)
    const dbProducts: Product[] = [
      {
        id: 'f3b14-root',
        name: 'Lapte Bio 1L DB',
        brand: 'FermaDB',
        category: 'Lactate și ouă',
        defaultUnit: 'L',
        packageWeightOrVolume: 1,
        packageUnit: 'L',
        normalizedUnit: 'l',
        baseReferencePrice: 7.5
      },
      {
        id: 'f3b14-other-root',
        name: 'Iaurt Natural DB',
        brand: 'FermaDB',
        category: 'Lactate și ouă',
        defaultUnit: 'buc',
        packageWeightOrVolume: 400,
        packageUnit: 'g',
        normalizedUnit: 'kg',
        baseReferencePrice: 5.5
      },
      // Chiar dacă un nod ciclic sau orfan ar exista în lista de produse cu nume identic, nu trebuie acceptat
      {
        id: 'f3b14-cyc-a',
        name: 'Lapte Bio 1L DB',
        brand: 'FermaDB',
        category: 'Lactate și ouă',
        defaultUnit: 'L',
        canonicalProductId: 'f3b14-cyc-b'
      },
      {
        id: 'f3b14-self',
        name: 'Auto Referință DB',
        brand: 'FermaDB',
        category: 'Lactate și ouă',
        defaultUnit: 'L',
        canonicalProductId: 'f3b14-self'
      },
      {
        id: 'f3b14-orphan',
        name: 'Produs Orfan DB',
        brand: 'FermaDB',
        category: 'Lactate și ouă',
        defaultUnit: 'L',
        canonicalProductId: 'f3b14-missing-root'
      }
    ];

    const dbOffers: ProductOffer[] = [
      {
        id: 'off-f3b14-valid',
        productId: 'f3b14-leaf', // alias multi-hop -> f3b14-root
        storeId: 'lidl',
        price: 6.4,
        unitPrice: 6.4,
        unitPriceMeasure: 'lei/l',
        isPromo: true,
        source: 'scraper_live',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        observationDate: '2026-11-23',
        lastChecked: new Date().toISOString()
      },
      {
        id: 'off-f3b14-cycle-cheaper',
        productId: 'f3b14-cyc-a',
        storeId: 'kaufland',
        price: 1.0,
        unitPrice: 1.0,
        unitPriceMeasure: 'lei/l',
        isPromo: true,
        source: 'scraper_live',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        observationDate: '2026-11-23',
        lastChecked: new Date().toISOString()
      },
      {
        id: 'off-f3b14-orphan-cheaper',
        productId: 'f3b14-orphan',
        storeId: 'carrefour',
        price: 1.2,
        unitPrice: 1.2,
        unitPriceMeasure: 'lei/l',
        isPromo: false,
        source: 'scraper_live',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        observationDate: '2026-11-23',
        lastChecked: new Date().toISOString()
      }
    ];

    // Test BasketOptimizerService.matchItemToProduct pe ciclu, self-ref, >max-depth, orfan (nu cade în matching pe nume!)
    for (const [label, pid] of [
      ['ciclu', 'f3b14-cyc-a'],
      ['self-loop', 'f3b14-self'],
      ['depth>16', 'f3b14-deep-0'],
      ['orfan', 'f3b14-orphan']
    ] as const) {
      const item: ShoppingListItem = {
        id: `it-${label}`,
        name: 'Lapte Bio 1L DB', // intenționat nume identic cu f3b14-root ca să dovedim că nu cade pe nume!
        productId: pid,
        category: 'Lactate și ouă',
        quantity: 1,
        unit: 'L',
        checked: false
      };
      const m = BasketOptimizerService.matchItemToProduct(item, dbProducts, rawAliasIndex);
      assert.equal(m.status, 'unconfident', `BasketOptimizerService.matchItemToProduct respinge ${label} ca unconfident`);
    }
    const validMatch = BasketOptimizerService.matchItemToProduct(
      { id: 'it-ok', name: 'Lapte', productId: 'f3b14-leaf', category: 'Lactate și ouă', quantity: 1, unit: 'L', checked: false },
      dbProducts,
      rawAliasIndex
    );
    assert.equal(validMatch.status, 'matched');
    assert.equal(validMatch.product?.id, 'f3b14-root');
    pass('Finding #1 (2/6): BasketOptimizerService.matchItemToProduct respinge ciclu, self-ref, depth>16 și orfan');

    // Test PriceAlertService.evaluateAlerts pe ciclu, self-ref, >max-depth, orfan + alias valid
    const evalAlertsRes = PriceAlertService.evaluateAlerts({
      alerts: [
        {
          id: 'al-cyc',
          productId: 'f3b14-cyc-a',
          productName: 'Ciclu',
          targetPrice: 5,
          currentLowestPrice: 0,
          createdAt: '2026-11-20',
          isActive: true,
          alertType: 'below_target'
        },
        {
          id: 'al-orphan',
          productId: 'f3b14-orphan',
          productName: 'Orfan',
          targetPrice: 5,
          currentLowestPrice: 0,
          createdAt: '2026-11-20',
          isActive: true,
          alertType: 'below_target'
        },
        {
          id: 'al-valid-alias',
          productId: 'f3b14-leaf',
          productName: 'Lapte Bio 1L DB',
          targetPrice: 7.0,
          currentLowestPrice: 0,
          createdAt: '2026-11-20',
          isActive: true,
          alertType: 'below_target'
        }
      ] as PriceAlert[],
      offers: dbOffers,
      products: dbProducts,
      stores: STORES,
      aliasMap: rawAliasIndex
    });
    assert.equal(evalAlertsRes.newNotifications.length, 1, 'Doar alerta validă pe alias -> root declanșează notificare');
    assert.equal(evalAlertsRes.newNotifications[0].productId, 'f3b14-root');
    assert.equal(evalAlertsRes.newNotifications[0].observedPrice, 6.4);
    pass('Finding #1 (3/6): PriceAlertService.evaluateAlerts ignoră ciclu/orfan și evaluează aliasul valid');

    // Test TOATE rutele critice server.ts fără StorageService
    const origGetAliasIdx = DatabaseService.getProductAliasIndex;
    const origGetProducts = DatabaseService.getProducts;
    const origGetOffers = DatabaseService.getOffers;
    const origGetStores = DatabaseService.getStores;
    const origGetUser = supabase.auth.getUser;
    const origFetch = globalThis.fetch;

    try {
      DatabaseService.getProductAliasIndex = async () => rawAliasIndex;
      DatabaseService.getProducts = async () => dbProducts.filter(p => !p.canonicalProductId);
      DatabaseService.getOffers = async () =>
        dbOffers
          .map(o => {
            const d = resolveCanonicalProductDetail(o.productId, rawAliasIndex);
            if (!d.found || d.cycleDetected || !d.canonicalId) return null;
            return { ...o, productId: d.canonicalId };
          })
          .filter((x): x is ProductOffer => Boolean(x));
      DatabaseService.getStores = async () => STORES;

      const { app } = await import('../server.ts');
      const srv = http.createServer(app);
      await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
      const port = (srv.address() as any).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // Păstrare contract /api/catalog/aliases (doar mapări valide, fără cicluri/orfani)
        const aliasesRes = await origFetch(`${baseUrl}/api/catalog/aliases`);
        assert.equal(aliasesRes.status, 200);
        const aliasesJson = await aliasesRes.json();
        assert.equal(aliasesJson.aliases['f3b14-leaf'], 'f3b14-root');
        assert.equal(aliasesJson.aliases['f3b14-cyc-a'], undefined);
        assert.equal(aliasesJson.aliases['f3b14-self'], undefined);
        assert.equal(aliasesJson.aliases['f3b14-orphan'], undefined);
        assert.equal(aliasesJson.aliases['f3b14-deep-0'], undefined);

        // POST /api/products/report-error -> 400 pe ciclu, self-ref, depth>16, orfan; 200 pe alias valid (fără StorageService!)
        for (const badId of ['f3b14-cyc-a', 'f3b14-self', 'f3b14-deep-0', 'f3b14-orphan']) {
          const rBad = await origFetch(`${baseUrl}/api/products/report-error`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: badId,
              productName: 'Test Bad DB',
              errorType: 'wrong_product',
              details: 'Test FAZA 3B.1.4'
            })
          });
          assert.equal(rBad.status, 400, `report-error respinge ${badId} cu HTTP 400`);
        }
        const rGood = await origFetch(`${baseUrl}/api/products/report-error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: 'f3b14-leaf',
            productName: 'Alias DB Valid',
            errorType: 'price_mismatch',
            details: 'Test alias valid fără StorageService'
          })
        });
        assert.equal(rGood.status, 200);
        const rGoodJson = await rGood.json();
        assert.equal(rGoodJson.canonicalProductId, 'f3b14-root');
        pass('Finding #1 (4/6): GET /api/catalog/aliases + POST /api/products/report-error validate fără StorageService');

        // Pregătim mock auth & Supabase REST pentru rutele autentificate
        let capturedSaveReceiptPayload: any = null;
        let capturedAlertInsertPayload: any = null;

        (supabase.auth as any).getUser = async (token: string) => {
          if (token === 'token-f3b14') {
            return { data: { user: { id: '00000000-0000-4000-8000-000000003b14' } }, error: null };
          }
          return { data: { user: null }, error: { message: 'unauthorized' } };
        };

        globalThis.fetch = (async (input: any, init?: any) => {
          const urlStr = typeof input === 'string' ? input : input?.url || '';
          const method = (init?.method || 'GET').toUpperCase();

          if (urlStr.includes('supabase.co/rest/v1/receipts')) {
            return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (urlStr.includes('supabase.co/rest/v1/rpc/save_receipt_v2')) {
            capturedSaveReceiptPayload = init?.body ? JSON.parse(String(init.body)) : null;
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (urlStr.includes('supabase.co/rest/v1/user_price_observations')) {
            return new Response(
              JSON.stringify([
                {
                  id: 'obs-1',
                  receipt_id: 'rec-1',
                  receipt_item_id: 'ri-1',
                  product_id: 'f3b14-cyc-a',
                  product_name: 'Ciclu',
                  store_id: 'lidl',
                  store_name: 'Lidl',
                  purchase_date: '2026-11-20',
                  quantity: 1,
                  unit: 'buc',
                  unit_price: 5,
                  discount: 0,
                  effective_paid_unit_price: 5,
                  total_paid: 5,
                  currency: 'RON'
                },
                {
                  id: 'obs-2',
                  receipt_id: 'rec-1',
                  receipt_item_id: 'ri-2',
                  product_id: 'f3b14-orphan',
                  product_name: 'Orfan',
                  store_id: 'lidl',
                  store_name: 'Lidl',
                  purchase_date: '2026-11-20',
                  quantity: 1,
                  unit: 'buc',
                  unit_price: 6,
                  discount: 0,
                  effective_paid_unit_price: 6,
                  total_paid: 6,
                  currency: 'RON'
                },
                {
                  id: 'obs-3',
                  receipt_id: 'rec-1',
                  receipt_item_id: 'ri-3',
                  product_id: 'f3b14-deep-0',
                  product_name: 'Deep',
                  store_id: 'lidl',
                  store_name: 'Lidl',
                  purchase_date: '2026-11-20',
                  quantity: 1,
                  unit: 'buc',
                  unit_price: 7,
                  discount: 0,
                  effective_paid_unit_price: 7,
                  total_paid: 7,
                  currency: 'RON'
                },
                {
                  id: 'obs-4',
                  receipt_id: 'rec-1',
                  receipt_item_id: 'ri-4',
                  product_id: 'f3b14-leaf',
                  product_name: 'Alias Valid',
                  store_id: 'lidl',
                  store_name: 'Lidl',
                  purchase_date: '2026-11-20',
                  quantity: 1,
                  unit: 'buc',
                  unit_price: 6.4,
                  discount: 0,
                  effective_paid_unit_price: 6.4,
                  total_paid: 6.4,
                  currency: 'RON'
                }
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (urlStr.includes('supabase.co/rest/v1/price_alerts')) {
            if (method === 'POST') {
              capturedAlertInsertPayload = init?.body ? JSON.parse(String(init.body)) : null;
              return new Response(
                JSON.stringify({
                  id: capturedAlertInsertPayload?.id || 'al-created',
                  user_id: '00000000-0000-4000-8000-000000003b14',
                  product_id: capturedAlertInsertPayload?.product_id,
                  target_price: capturedAlertInsertPayload?.target_price,
                  is_active: true,
                  created_at: new Date().toISOString()
                }),
                { status: 201, headers: { 'Content-Type': 'application/json' } }
              );
            }
            return new Response(
              JSON.stringify([
                {
                  id: 'al-row-cyc',
                  user_id: '00000000-0000-4000-8000-000000003b14',
                  product_id: 'f3b14-cyc-a',
                  target_price: 5.0,
                  is_active: true,
                  created_at: '2026-11-20T00:00:00Z',
                  alert_type: 'below_target'
                },
                {
                  id: 'al-row-leaf',
                  user_id: '00000000-0000-4000-8000-000000003b14',
                  product_id: 'f3b14-leaf',
                  target_price: 7.0,
                  is_active: true,
                  created_at: '2026-11-20T00:00:00Z',
                  alert_type: 'below_target'
                }
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (urlStr.includes('supabase.co/rest/v1/price_alert_notifications')) {
            if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
              return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (urlStr.includes('supabase.co/rest/v1/profiles')) {
            return new Response(JSON.stringify({ preferences: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return origFetch(input, init);
        }) as typeof fetch;

        // POST /api/receipts/save: dematchează ciclu, self-ref, depth>16, orfan; rezolvă alias valid
        const saveRes = await origFetch(`${baseUrl}/api/receipts/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-f3b14' },
          body: JSON.stringify({
            receipt: {
              id: 'rec-f3b14',
              storeId: 'lidl',
              storeName: 'Lidl',
              date: '2026-11-23',
              items: [
                { id: '1', rawName: 'Ciclu', quantity: 1, unit: 'buc', unitPrice: 5, totalPrice: 5, discount: 0, isWeighted: false, isSgr: false, matchedProductId: 'f3b14-cyc-a', matchStatus: 'matched' },
                { id: '2', rawName: 'Self', quantity: 1, unit: 'buc', unitPrice: 5, totalPrice: 5, discount: 0, isWeighted: false, isSgr: false, matchedProductId: 'f3b14-self', matchStatus: 'matched' },
                { id: '3', rawName: 'Deep', quantity: 1, unit: 'buc', unitPrice: 5, totalPrice: 5, discount: 0, isWeighted: false, isSgr: false, matchedProductId: 'f3b14-deep-0', matchStatus: 'matched' },
                { id: '4', rawName: 'Orfan', quantity: 1, unit: 'buc', unitPrice: 5, totalPrice: 5, discount: 0, isWeighted: false, isSgr: false, matchedProductId: 'f3b14-orphan', matchStatus: 'matched' },
                { id: '5', rawName: 'Valid', quantity: 1, unit: 'buc', unitPrice: 6.4, totalPrice: 6.4, discount: 0, isWeighted: false, isSgr: false, matchedProductId: 'f3b14-leaf', matchStatus: 'matched' }
              ],
              subtotal: 26.4,
              discountTotal: 0,
              total: 26.4
            }
          })
        });
        assert.equal(saveRes.status, 201);
        for (const name of ['Ciclu', 'Self', 'Deep', 'Orfan']) {
          const saved = capturedSaveReceiptPayload.p_items.find((x: any) => x.raw_name === name);
          assert.equal(saved.product_id, null, `save_receipt dematchează ${name}`);
          assert.equal(saved.match_status, 'unmatched', `save_receipt marchează unmatched ${name}`);
        }
        const savedOrphan = capturedSaveReceiptPayload.p_items.find((x: any) => x.raw_name === 'Orfan');
        assert.equal(savedOrphan.provenance?.rejectedOrphanMatchedProductId, true);
        const savedValid = capturedSaveReceiptPayload.p_items.find((x: any) => x.raw_name === 'Valid');
        assert.equal(savedValid.product_id, 'f3b14-root');

        // GET /api/receipts/personal-history: anulează product_id pe ciclu, deep, orfan; păstrează alias valid -> f3b14-root
        const histRes = await origFetch(`${baseUrl}/api/receipts/personal-history`, {
          headers: { Authorization: 'Bearer token-f3b14' }
        });
        assert.equal(histRes.status, 200);
        const histJson = await histRes.json();
        const obsMap = new Map(histJson.observations.map((o: any) => [o.id, o]));
        assert.equal((obsMap.get('obs-1') as any).product_id, null);
        assert.equal((obsMap.get('obs-2') as any).product_id, null);
        assert.equal((obsMap.get('obs-3') as any).product_id, null);
        assert.equal((obsMap.get('obs-4') as any).product_id, 'f3b14-root');
        pass('Finding #1 (5/6): POST /api/receipts/save + GET /api/receipts/personal-history siguri la ciclu, self-ref, depth>16 și orfan');

        // /api/alerts* (POST respinge ciclu/orfan cu 400, GET/evaluate nu crapă și nu acceptă oferte ciclice)
        for (const badPid of ['f3b14-cyc-a', 'f3b14-self', 'f3b14-deep-0', 'f3b14-orphan']) {
          const badAlertRes = await origFetch(`${baseUrl}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-f3b14' },
            body: JSON.stringify({ productId: badPid, alertType: 'below_target', targetPrice: 5.0 })
          });
          assert.equal(badAlertRes.status, 400, `POST /api/alerts respinge ${badPid} cu HTTP 400`);
        }

        const goodAlertRes = await origFetch(`${baseUrl}/api/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-f3b14' },
          body: JSON.stringify({ productId: 'f3b14-other-alias', alertType: 'below_target', targetPrice: 4.5 })
        });
        assert.equal(goodAlertRes.status, 201, 'POST /api/alerts pe alias valid DB creează cu 201 Created');
        const goodAlertJson = await goodAlertRes.json();
        assert.equal(goodAlertJson.alert.productId, 'f3b14-other-root');
        assert.equal(capturedAlertInsertPayload?.product_id, 'f3b14-other-root');

        // POST /api/alerts cu alias valid f3b14-leaf (cu existing empty temporarily? Notice existing returns al-row-leaf, so check GET & evaluate, and check with empty existing by pointing to root after verifying duplicate check or custom product!)
        // Mai întâi verificăm GET /api/alerts & POST /api/alerts/evaluate pe mock rows care conțin și ciclu, și alias valid
        const getAlertsRes = await origFetch(`${baseUrl}/api/alerts`, {
          headers: { Authorization: 'Bearer token-f3b14' }
        });
        assert.equal(getAlertsRes.status, 200);
        const getAlertsJson = await getAlertsRes.json();
        const cycAlert = getAlertsJson.alerts.find((a: any) => a.id === 'al-row-cyc');
        const leafAlert = getAlertsJson.alerts.find((a: any) => a.id === 'al-row-leaf');
        assert.equal(cycAlert.currentLowestPrice, 0, 'GET /api/alerts nu rezolvă produsul/oferta ciclică');
        assert.equal(leafAlert.productId, 'f3b14-root', 'GET /api/alerts normalizează aliasul valid spre root');
        assert.equal(leafAlert.currentLowestPrice, 6.4);

        const evalRes = await origFetch(`${baseUrl}/api/alerts/evaluate`, {
          method: 'POST',
          headers: { Authorization: 'Bearer token-f3b14' }
        });
        assert.equal(evalRes.status, 200);
        const evalJson = await evalRes.json();
        assert.equal(evalJson.newNotificationsCount, 1);
        assert.equal(evalJson.newNotifications[0].productId, 'f3b14-root');

        // POST /api/assistant/query: respinge selectedProductId ciclu/orfan cu 400; la optimize_list marchează invalidele unconfident
        for (const badSel of ['f3b14-cyc-a', 'f3b14-self', 'f3b14-deep-0', 'f3b14-orphan']) {
          const badAstRes = await origFetch(`${baseUrl}/api/assistant/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: 'Găsește alternative mai ieftine',
              intent: 'cheaper_alternatives',
              selectedProductId: badSel
            })
          });
          assert.equal(badAstRes.status, 400, `POST /api/assistant/query respinge selectedProductId=${badSel} cu 400`);
        }

        const optAstRes = await origFetch(`${baseUrl}/api/assistant/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'Optimizează lista mea',
            intent: 'optimize_list',
            items: [
              { id: 'i1', name: 'Lapte Ciclu', productId: 'f3b14-cyc-a', category: 'Lactate și ouă', quantity: 1, unit: 'L', checked: false },
              { id: 'i2', name: 'Lapte Self', productId: 'f3b14-self', category: 'Lactate și ouă', quantity: 1, unit: 'L', checked: false },
              { id: 'i3', name: 'Lapte Deep', productId: 'f3b14-deep-0', category: 'Lactate și ouă', quantity: 1, unit: 'L', checked: false },
              { id: 'i4', name: 'Lapte Orfan', productId: 'f3b14-orphan', category: 'Lactate și ouă', quantity: 1, unit: 'L', checked: false },
              { id: 'i5', name: 'Lapte Valid', productId: 'f3b14-leaf', category: 'Lactate și ouă', quantity: 1, unit: 'L', checked: false }
            ]
          })
        });
        assert.ok(optAstRes.status === 200 || optAstRes.status === 503);
        const optAstJson = await optAstRes.json();
        const plan = optAstJson.deterministicPlan || optAstJson;
        const recs = plan.items || plan.recommendedItems || [];
        assert.equal(recs.length, 1, 'Doar aliasul valid ajunge în planul determinist');
        assert.equal(recs[0].productId, 'f3b14-root');
        assert.equal(plan.optimizationSummary?.unconfidentMatchesCount, 4, 'Toate cele 4 referințe invalide (ciclu, self, deep, orfan) sunt unconfident');
        pass('Finding #1 (6/6): /api/alerts* + POST /api/assistant/query validate fără StorageService');
      } finally {
        await new Promise<void>(resolve => srv.close(() => resolve()));
      }
    } finally {
      DatabaseService.getProductAliasIndex = origGetAliasIdx;
      DatabaseService.getProducts = origGetProducts;
      DatabaseService.getOffers = origGetOffers;
      DatabaseService.getStores = origGetStores;
      (supabase.auth as any).getUser = origGetUser;
      globalThis.fetch = origFetch;
    }
  }

  StorageService.resetAllData();
  console.log(`\nTOATE CELE ${passed} GRUPURI DE TESTE FAZA 3B.1.4 AU TRECUT CU SUCCES!`);
}

runTests().catch(err => {
  console.error('EROARE ÎN TESTELE FAZA 3B.1.4:', err);
  process.exit(1);
});
