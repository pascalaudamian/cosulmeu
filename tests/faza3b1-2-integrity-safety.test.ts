// tests/faza3b1-2-integrity-safety.test.ts
// Suită de regresie FAZA 3B.1.2 — Remediere Integritate și Siguranță:
//   - Finding #2: DatabaseService.deleteProducts() Supabase fallback fail-closed + fără trunchiere .limit(1000)
//   - Finding #1: DatabaseService.getProductAliasIndex() raw graph + cycle detection în server.ts & BasketOptimizerService (fără dependență de StorageService)
//   - Finding #5: Respectarea strictă a options.knownProductIds în resolveCanonicalProductDetail() și normalizeProductReferences()

import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { DatabaseService } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { BasketOptimizerService } from '../src/services/BasketOptimizerService.ts';
import {
  buildCanonicalAliasIndex,
  normalizeProductReferences,
  resolveCanonicalProductDetail,
  resolveCanonicalProductId
} from '../src/services/ProductIdentityService.ts';
import { supabase } from '../src/lib/supabase.ts';
import type { Product } from '../src/types.ts';

let passed = 0;
function pass(label: string) {
  passed++;
  console.log(`  [PASS] ${label}`);
}

interface FakeSupabaseConfig {
  productsRows?: Array<{ id: string; canonical_product_id: string | null }>;
  productsError?: { message: string } | null;
  productsErrorOnPage?: number;
  priceObservationsRows?: Array<{ product_id: string }>;
  priceObservationsError?: { message: string } | null;
  deleteErrorsByTable?: Record<string, { message: string }>;
}

function createFakeSupabaseClient(config: FakeSupabaseConfig) {
  const deleteCalls: Array<{ table: string; column: string; ids: string[] }> = [];
  const updateCalls: Array<{ table: string }> = [];
  const selectQueries: Array<{ table: string; from?: number; to?: number; inIds?: string[] }> = [];
  let productsPageCalls = 0;

  return {
    deleteCalls,
    updateCalls,
    selectQueries,
    from(table: string) {
      return {
        select(_cols: string) {
          const state: { inCol?: string; inVals?: string[]; from?: number; to?: number } = {};
          const queryObj: any = {
            in(col: string, vals: string[]) {
              state.inCol = col;
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
            selectQueries.push({
              table,
              from: state.from,
              to: state.to,
              inIds: state.inVals
            });

            if (table === 'products') {
              productsPageCalls++;
              if (config.productsError) {
                return { data: null, error: config.productsError };
              }
              if (config.productsErrorOnPage && productsPageCalls >= config.productsErrorOnPage) {
                return { data: null, error: { message: 'Injected products page error' } };
              }
              const all = config.productsRows || [];
              const start = state.from ?? 0;
              const end = state.to ?? all.length - 1;
              return { data: all.slice(start, end + 1), error: null };
            }

            if (table === 'price_observations') {
              if (config.priceObservationsError) {
                return { data: null, error: config.priceObservationsError };
              }
              const all = config.priceObservationsRows || [];
              const filtered = state.inVals
                ? all.filter(r => state.inVals!.includes(String(r.product_id)))
                : all;
              const start = state.from ?? 0;
              const end = state.to ?? start + 999;
              return { data: filtered.slice(start, end + 1), error: null };
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
            const injectedErr = config.deleteErrorsByTable?.[table];
            if (injectedErr) {
              return { data: null, error: injectedErr };
            }
            return {
              data: ids.map(id => ({ id })),
              error: null
            };
          };

          const delBuilder: any = {
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
          return delBuilder;
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
  console.log('FAZA 3B.1.2: TESTE REMEDIERE INTEGRITATE ȘI SIGURANȚĂ (#2, #1, #5)');
  console.log('====================================================================\n');

  // =========================================================================
  // PARTEA 1 — FINDING #2: DatabaseService.deleteProductsViaSupabase fail-closed
  // =========================================================================
  {
    // 1. Eroare PostgREST la verificarea price_observations -> fail-closed & ZERO DELETE calls
    const errObsClient = createFakeSupabaseClient({
      productsRows: [
        { id: 'supa-p1', canonical_product_id: null },
        { id: 'supa-p1-alias', canonical_product_id: 'supa-p1' }
      ],
      priceObservationsError: { message: 'PostgREST timeout checking price_observations' }
    });
    const resObsErr = await DatabaseService.deleteProductsViaSupabase(['supa-p1'], errObsClient);
    assert.equal(resObsErr.deletedCount, 0, 'Eroare price_observations: deletedCount === 0');
    assert.equal(resObsErr.blockedCount, 1, 'Eroare price_observations: blockedCount === 1');
    assert.deepEqual(resObsErr.blockedIds, ['supa-p1']);
    assert.ok(resObsErr.error && resObsErr.error.includes('price_observations'));
    assert.equal(errObsClient.deleteCalls.length, 0, 'Eroare price_observations: ZERO apeluri DELETE');
    pass('Finding #2 (1/7): Eroare PostgREST la price_observations oprește operația (deletedCount=0, 0 DELETE)');

    // 2. Peste 1000 observații pentru produsul A + 1 observație pentru produsul B (+ 0 pentru C)
    const manyObsRows = [
      ...Array.from({ length: 1250 }, () => ({ product_id: 'supa-A' })),
      { product_id: 'supa-B' }
    ];
    const largeObsClient = createFakeSupabaseClient({
      productsRows: [
        { id: 'supa-A', canonical_product_id: null },
        { id: 'supa-B', canonical_product_id: null },
        { id: 'supa-C', canonical_product_id: null }
      ],
      priceObservationsRows: manyObsRows
    });
    const resLarge = await DatabaseService.deleteProductsViaSupabase(['supa-A', 'supa-B', 'supa-C'], largeObsClient);
    assert.equal(resLarge.blockedCount, 2, 'Ambii supa-A și supa-B sunt detectați ca protejați');
    assert.deepEqual(new Set(resLarge.blockedIds), new Set(['supa-A', 'supa-B']), 'supa-B nu este ascuns de >1000 rânduri ale lui supa-A');
    assert.equal(resLarge.deletedCount, 1, 'Doar supa-C fără observații este șters');
    assert.equal(largeObsClient.deleteCalls.some(c => c.table === 'price_observations'), false, 'Nu execută DELETE pe price_observations');
    assert.equal(largeObsClient.updateCalls.length, 0, 'Nu execută UPDATE pe niciun tabel');
    const deletedProductBatches = largeObsClient.deleteCalls.filter(c => c.table === 'products').flatMap(c => c.ids);
    assert.deepEqual(deletedProductBatches, ['supa-C']);
    pass('Finding #2 (2/7): Peste 1000 observații pe A + 1 pe B -> B detectat ca protejat, doar C șters');

    // 3. Referințe existente în price_observations (inclusiv pe alias descendent) -> blocat complet
    const existingRefClient = createFakeSupabaseClient({
      productsRows: [
        { id: 'supa-root', canonical_product_id: null },
        { id: 'supa-child-alias', canonical_product_id: 'supa-root' }
      ],
      priceObservationsRows: [{ product_id: 'supa-child-alias' }]
    });
    const resBlocked = await DatabaseService.deleteProductsViaSupabase(['supa-root'], existingRefClient);
    assert.equal(resBlocked.deletedCount, 0);
    assert.equal(resBlocked.blockedCount, 1);
    assert.deepEqual(resBlocked.blockedIds, ['supa-root']);
    assert.equal(existingRefClient.deleteCalls.length, 0, 'Zero DELETE când subarborele are observații');
    pass('Finding #2 (3/7): Referințe existente pe alias descendent blochează ștergerea root-ului (0 DELETE)');

    // 4. Fără referințe în price_observations -> șterge curat subarborele, fără a atinge price_observations
    const cleanClient = createFakeSupabaseClient({
      productsRows: [
        { id: 'supa-clean-root', canonical_product_id: null },
        { id: 'supa-clean-alias', canonical_product_id: 'supa-clean-root' }
      ],
      priceObservationsRows: []
    });
    const resClean = await DatabaseService.deleteProductsViaSupabase(['supa-clean-root'], cleanClient);
    assert.equal(resClean.deletedCount, 2, 'Șterge root + alias fără observații');
    assert.equal(resClean.blockedCount, 0);
    assert.equal(resClean.error, undefined);
    assert.equal(cleanClient.deleteCalls.some(c => c.table === 'price_observations'), false, 'price_observations intangibil');
    assert.ok(cleanClient.deleteCalls.some(c => c.table === 'products' && c.ids.includes('supa-clean-root') && c.ids.includes('supa-clean-alias')));
    pass('Finding #2 (4/7): Produs + alias fără observații șters complet, price_observations intangibil');

    // 5. Eroare la interogarea intermediară products -> fail-closed & ZERO DELETE calls
    const prodErrClient = createFakeSupabaseClient({
      productsError: { message: 'Database connection lost on products' }
    });
    const resProdErr = await DatabaseService.deleteProductsViaSupabase(['supa-any'], prodErrClient);
    assert.equal(resProdErr.deletedCount, 0);
    assert.equal(resProdErr.blockedCount, 1);
    assert.deepEqual(resProdErr.blockedIds, ['supa-any']);
    assert.ok(resProdErr.error && resProdErr.error.includes('products'));
    assert.equal(prodErrClient.deleteCalls.length, 0, 'Zero DELETE la eroare pe products');
    pass('Finding #2 (5/7): Eroare la interogarea products oprește operația cu 0 DELETE');

    // 6. Eroare la DELETE pe un tabel copil / products -> raportată sigur cu deletedCount=0 și oprește ștergerea products
    const delErrClient = createFakeSupabaseClient({
      productsRows: [{ id: 'supa-del-err', canonical_product_id: null }],
      priceObservationsRows: [],
      deleteErrorsByTable: { promotions: { message: 'RLS denied promotions delete' } }
    });
    const resDelErr = await DatabaseService.deleteProductsViaSupabase(['supa-del-err'], delErrClient);
    assert.equal(resDelErr.deletedCount, 0);
    assert.equal(resDelErr.blockedCount, 1);
    assert.ok(resDelErr.error && resDelErr.error.includes('promotions'));
    assert.equal(delErrClient.deleteCalls.some(c => c.table === 'products'), false, 'Oprește ștergerea products după eșec la tabel copil');
    pass('Finding #2 (6/7): Eroare la DELETE copil oprește operația și raportează eroare fail-closed');

    // 7. Eroare pe products delete final -> fail-closed
    const prodDelErrClient = createFakeSupabaseClient({
      productsRows: [{ id: 'supa-prod-del-err', canonical_product_id: null }],
      priceObservationsRows: [],
      deleteErrorsByTable: { products: { message: 'FK constraint on products' } }
    });
    const resProdDelErr = await DatabaseService.deleteProductsViaSupabase(['supa-prod-del-err'], prodDelErrClient);
    assert.equal(resProdDelErr.deletedCount, 0);
    assert.equal(resProdDelErr.blockedCount, 1);
    assert.ok(resProdDelErr.error && resProdDelErr.error.includes('FK constraint'));
    pass('Finding #2 (7/7): Eroare la DELETE products returnează deletedCount=0 și eroare explicită');
  }

  // =========================================================================
  // PARTEA 2 — FINDING #1: DatabaseService.getProductAliasIndex() + runtime fără StorageService
  // =========================================================================
  {
    // Resetăm StorageService la starea standard și verificăm că niciun ID DB din test nu există în StorageService
    StorageService.resetAllData();
    assert.equal(
      StorageService.getAllProducts().some(p => p.id.startsWith('db-')),
      false,
      'Niciun produs/ciclu DB de test nu există în StorageService'
    );

    // Construim lanț adânc > 16 hops (18 hops: deep-0 -> deep-1 -> ... -> deep-18 -> root-valid)
    const deepChainRows: Array<{ id: string; canonical_product_id: string | null }> = [];
    for (let i = 0; i < 18; i++) {
      deepChainRows.push({
        id: `db-deep-${i}`,
        canonical_product_id: i === 17 ? 'db-root-B' : `db-deep-${i + 1}`
      });
    }

    const dbNodes: Array<{ id: string; canonical_product_id: string | null }> = [
      // A -> B valid
      { id: 'db-root-B', canonical_product_id: null },
      { id: 'db-alias-A', canonical_product_id: 'db-root-B' },
      // A -> B -> C valid
      { id: 'db-root-C', canonical_product_id: null },
      { id: 'db-mid-B', canonical_product_id: 'db-root-C' },
      { id: 'db-leaf-A', canonical_product_id: 'db-mid-B' },
      // A -> B -> A ciclu
      { id: 'db-cyc-A', canonical_product_id: 'db-cyc-B' },
      { id: 'db-cyc-B', canonical_product_id: 'db-cyc-A' },
      // A -> A auto-referință
      { id: 'db-self-A', canonical_product_id: 'db-self-A' },
      // Lanț > adâncime 16
      ...deepChainRows,
      // Alias fără rădăcină validă (orfan)
      { id: 'db-orphan', canonical_product_id: 'db-missing-root' }
    ];

    const fakeGraphClient = createFakeSupabaseClient({ productsRows: dbNodes });
    const rawIndex = await DatabaseService.getProductAliasIndex({ supabaseClient: fakeGraphClient });

    // Verificăm păstrarea tuturor nodurilor și muchiilor în graful brut
    assert.equal(rawIndex.hasExplicitNodes, true);
    assert.equal(rawIndex.parentById.get('db-alias-A'), 'db-root-B');
    assert.equal(rawIndex.parentById.get('db-cyc-A'), 'db-cyc-B');
    assert.equal(rawIndex.parentById.get('db-cyc-B'), 'db-cyc-A');
    assert.equal(rawIndex.parentById.get('db-self-A'), 'db-self-A');
    assert.equal(rawIndex.parentById.get('db-orphan'), 'db-missing-root');
    pass('Finding #1 (a): getProductAliasIndex() păstrează graful brut DB (noduri valide, cicluri, self-loop, lanțuri adânci, orfani)');

    const dAB = resolveCanonicalProductDetail('db-alias-A', rawIndex);
    assert.equal(dAB.found, true);
    assert.equal(dAB.canonicalId, 'db-root-B');
    assert.equal(dAB.hops, 1);
    assert.equal(dAB.cycleDetected, false);

    const dABC = resolveCanonicalProductDetail('db-leaf-A', rawIndex);
    assert.equal(dABC.found, true);
    assert.equal(dABC.canonicalId, 'db-root-C');
    assert.equal(dABC.hops, 2);
    assert.equal(dABC.cycleDetected, false);

    const dCyc = resolveCanonicalProductDetail('db-cyc-A', rawIndex);
    assert.equal(dCyc.found, false);
    assert.equal(dCyc.canonicalId, null);
    assert.equal(dCyc.cycleDetected, true);

    const dSelf = resolveCanonicalProductDetail('db-self-A', rawIndex);
    assert.equal(dSelf.found, false);
    assert.equal(dSelf.canonicalId, null);
    assert.equal(dSelf.cycleDetected, true);

    const dDeep = resolveCanonicalProductDetail('db-deep-0', rawIndex);
    assert.equal(dDeep.found, false);
    assert.equal(dDeep.canonicalId, null);
    assert.equal(dDeep.cycleDetected, true, 'Lanț > max depth (18 > 16) tratat sigur ca cycleDetected: true');

    const dOrphan = resolveCanonicalProductDetail('db-orphan', rawIndex);
    assert.equal(dOrphan.found, false);
    assert.equal(dOrphan.canonicalId, null);
    assert.equal(dOrphan.cycleDetected, false, 'Alias fără rădăcină validă respins ca found: false');
    pass('Finding #1 (b): A->B, A->B->C, A->B->A, A->A, depth>16 și orphan funcționează determinist pe graful DB');

    // Backward compatibility: getProductAliasMap() & GET /api/catalog/aliases păstrează DOAR mapările valide
    const origGetProductAliasIndex = DatabaseService.getProductAliasIndex;
    DatabaseService.getProductAliasIndex = async () => rawIndex;

    try {
      const compatMap = await DatabaseService.getProductAliasMap();
      assert.equal(compatMap.get('db-alias-A'), 'db-root-B');
      assert.equal(compatMap.get('db-leaf-A'), 'db-root-C');
      assert.equal(compatMap.has('db-cyc-A'), false, 'getProductAliasMap exclude cicluri pentru compatibilitate');
      assert.equal(compatMap.has('db-self-A'), false, 'getProductAliasMap exclude self-loop');
      assert.equal(compatMap.has('db-orphan'), false, 'getProductAliasMap exclude orfani');
      assert.equal(compatMap.has('db-deep-0'), false, 'getProductAliasMap exclude lanț > max depth');

      // BasketOptimizerService primește rawIndex (fără StorageService!) -> returnează unconfident pentru cicluri
      const dbOnlyProducts: Product[] = [
        {
          id: 'db-root-B',
          name: 'Produs Canonic DB B',
          brand: 'TestBrand',
          category: 'Produse de bază',
          defaultUnit: 'buc',
          packageWeightOrVolume: 500,
          packageUnit: 'g',
          normalizedUnit: 'kg',
          baseReferencePrice: 12,
          canonicalProductId: null
        }
      ];
      const matchCycle = BasketOptimizerService.matchItemToProduct(
        {
          id: 'item-cyc',
          name: 'Produs Ciclu DB',
          productId: 'db-cyc-A',
          category: 'Produse de bază',
          quantity: 1,
          unit: 'buc',
          checked: false
        },
        dbOnlyProducts,
        rawIndex
      );
      assert.equal(matchCycle.status, 'unconfident', 'BasketOptimizerService returnează unconfident pentru referință ciclică din DB');

      const matchValidAlias = BasketOptimizerService.matchItemToProduct(
        {
          id: 'item-valid',
          name: 'Alias DB Valid',
          productId: 'db-alias-A',
          category: 'Produse de bază',
          quantity: 1,
          unit: 'buc',
          checked: false
        },
        dbOnlyProducts,
        rawIndex
      );
      assert.equal(matchValidAlias.status, 'matched');
      assert.equal(matchValidAlias.product?.id, 'db-root-B');
      pass('Finding #1 (c): BasketOptimizerService detectează ciclurile din CanonicalAliasIndex (fără StorageService)');

      // Testare endpoint-uri HTTP reale server.ts cu StorageService gol și graful venit EXCLUSIV din DatabaseService.getProductAliasIndex()
      const { app } = await import('../server.ts');
      const srv = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });

      const origGetUser = supabase.auth.getUser.bind(supabase.auth);
      const origFetch = globalThis.fetch;

      try {
        const addr = srv.address() as any;
        const baseUrl = `http://127.0.0.1:${addr.port}`;

        // 1. GET /api/catalog/aliases păstrează formatul backward-compatible (doar mapări valide)
        const aliasesHttpRes = await origFetch(`${baseUrl}/api/catalog/aliases`);
        assert.equal(aliasesHttpRes.status, 200);
        const aliasesHttpJson = await aliasesHttpRes.json();
        assert.equal(aliasesHttpJson.success, true);
        assert.equal(aliasesHttpJson.aliases['db-alias-A'], 'db-root-B');
        assert.equal(aliasesHttpJson.aliases['db-leaf-A'], 'db-root-C');
        assert.equal(aliasesHttpJson.aliases['db-cyc-A'], undefined, 'GET /api/catalog/aliases nu expune cicluri');

        // 2. POST /api/products/report-error cu produs ciclic din DB (absență totală din StorageService!) -> 400
        const repCycleRes = await origFetch(`${baseUrl}/api/products/report-error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: 'db-cyc-A',
            productName: 'Produs Ciclu DB',
            errorType: 'wrong_product',
            details: 'Test respingere ciclu exclusiv DB'
          })
        });
        assert.equal(repCycleRes.status, 400, 'POST /api/products/report-error respinge produs ciclic DB cu 400');

        const repSelfRes = await origFetch(`${baseUrl}/api/products/report-error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: 'db-self-A',
            productName: 'Produs Self-Loop DB',
            errorType: 'wrong_product',
            details: 'Test respingere self-loop exclusiv DB'
          })
        });
        assert.equal(repSelfRes.status, 400, 'POST /api/products/report-error respinge self-loop DB cu 400');

        // 3. POST /api/products/report-error cu alias valid din DB (fără StorageService!) -> 200 + rezolvat la db-root-C
        const repAliasRes = await origFetch(`${baseUrl}/api/products/report-error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: 'db-leaf-A',
            productName: 'Alias DB Multi-Hop',
            errorType: 'price_mismatch',
            details: 'Test rezolvare alias exclusiv DB'
          })
        });
        assert.equal(repAliasRes.status, 200);
        const repAliasJson = await repAliasRes.json();
        assert.equal(repAliasJson.canonicalProductId, 'db-root-C');
        pass('Finding #1 (d): GET /api/catalog/aliases & POST /api/products/report-error validate fără StorageService');

        // 4. POST /api/receipts/save: dematchează sigur referințele ciclice și promovează aliasurile valide
        let capturedRpcPayload: any = null;
        (supabase.auth as any).getUser = async (token: string) => {
          if (token === 'test-token-f3b12') {
            return { data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null };
          }
          return { data: { user: null }, error: { message: 'invalid token' } };
        };
        globalThis.fetch = (async (input: any, init?: any) => {
          const urlStr = typeof input === 'string' ? input : input?.url || '';
          if (urlStr.includes('supabase.co/rest/v1/receipts')) {
            return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (urlStr.includes('supabase.co/rest/v1/rpc/save_receipt_v2')) {
            capturedRpcPayload = init?.body ? JSON.parse(String(init.body)) : null;
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (urlStr.includes('supabase.co/storage/v1/')) {
            return new Response(JSON.stringify({ Key: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return origFetch(input, init);
        }) as typeof fetch;

        const saveReceiptRes = await origFetch(`${baseUrl}/api/receipts/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token-f3b12'
          },
          body: JSON.stringify({
            receipt: {
              id: 'rec-f3b12-test',
              storeId: 'lidl',
              storeName: 'Lidl',
              date: '2026-11-23',
              items: [
                {
                  id: 'ri-cyc',
                  rawName: 'Produs Ciclu Pe Bon',
                  quantity: 1,
                  unit: 'buc',
                  unitPrice: 9.5,
                  totalPrice: 9.5,
                  discount: 0,
                  isWeighted: false,
                  isSgr: false,
                  matchedProductId: 'db-cyc-A',
                  matchStatus: 'matched'
                },
                {
                  id: 'ri-alias',
                  rawName: 'Produs Alias Pe Bon',
                  quantity: 1,
                  unit: 'buc',
                  unitPrice: 12.0,
                  totalPrice: 12.0,
                  discount: 0,
                  isWeighted: false,
                  isSgr: false,
                  matchedProductId: 'db-leaf-A',
                  matchStatus: 'matched'
                }
              ],
              subtotal: 21.5,
              discountTotal: 0,
              total: 21.5
            }
          })
        });
        assert.equal(saveReceiptRes.status, 201, 'POST /api/receipts/save salvează cu 201 Created fără crash');
        assert.ok(capturedRpcPayload && Array.isArray(capturedRpcPayload.p_items), 'RPC save_receipt_v2 a primit p_items');
        const savedCycleItem = capturedRpcPayload.p_items.find((it: any) => it.raw_name === 'Produs Ciclu Pe Bon');
        const savedAliasItem = capturedRpcPayload.p_items.find((it: any) => it.raw_name === 'Produs Alias Pe Bon');
        assert.equal(savedCycleItem.product_id, null, 'Referința ciclică a fost dematchată sigur (product_id: null)');
        assert.equal(savedCycleItem.match_status, 'unmatched', 'Statusul itemului ciclic devine unmatched');
        assert.equal(savedCycleItem.provenance?.originalMatchedProductId, 'db-cyc-A');
        assert.equal(savedCycleItem.provenance?.rejectedCycleMatchedProductId, true);
        assert.equal(savedAliasItem.product_id, 'db-root-C', 'Aliasul valid multi-hop DB este rezolvat canonic');
        assert.equal(savedAliasItem.provenance?.originalMatchedProductId, 'db-leaf-A');
        pass('Finding #1 (e): POST /api/receipts/save dematchează sigur referințele ciclice și rezolvă aliasurile DB');

        // 5. POST /api/basket/optimize HTTP route cu produs ciclic din DB
        const basketRes = await origFetch(`${baseUrl}/api/basket/optimize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              {
                id: 'bi-cyc',
                name: 'Articol Ciclic',
                productId: 'db-cyc-A',
                category: 'Produse de bază',
                quantity: 1,
                unit: 'buc',
                checked: false
              }
            ]
          })
        });
        assert.equal(basketRes.status, 200);
        const basketJson = await basketRes.json();
        assert.equal(basketJson.success, true);
        assert.equal(basketJson.optimization.unconfidentMatches.length, 1, 'POST /api/basket/optimize pune articolul ciclic în unconfidentMatches');
        assert.ok(basketJson.optimization.unconfidentMatches[0].reasonRo.includes('ciclic'));
        pass('Finding #1 (f): POST /api/basket/optimize tratează articolul ciclic DB ca unconfident');
      } finally {
        (supabase.auth as any).getUser = origGetUser;
        globalThis.fetch = origFetch;
        await new Promise<void>(resolve => srv.close(() => resolve()));
      }
    } finally {
      DatabaseService.getProductAliasIndex = origGetProductAliasIndex;
    }
  }

  // =========================================================================
  // PARTEA 3 — FINDING #5: Respectarea strictă a options.knownProductIds
  // =========================================================================
  {
    const knownProductIds = new Set<string>(['live-root']);

    // 1. Map cu a1 -> deleted-root (deleted-root nu este în knownProductIds)
    const mapSource = new Map<string, string>([
      ['a1', 'deleted-root'],
      ['a-valid', 'live-root']
    ]);
    const resMapDead = resolveCanonicalProductDetail('a1', mapSource, { knownProductIds });
    assert.equal(resMapDead.found, false, 'Map: a1 -> deleted-root respins când deleted-root lipsește din knownProductIds');
    assert.equal(resMapDead.canonicalId, null);
    assert.equal(resMapDead.cycleDetected, false);

    // 2. Record cu a1 -> deleted-root
    const recordSource: Record<string, string> = {
      a1: 'deleted-root',
      'a-valid': 'live-root'
    };
    const resRecDead = resolveCanonicalProductDetail('a1', recordSource, { knownProductIds });
    assert.equal(resRecDead.found, false, 'Record: a1 -> deleted-root respins când deleted-root lipsește din knownProductIds');
    assert.equal(resRecDead.canonicalId, null);
    assert.equal(resRecDead.cycleDetected, false);

    // 3. CanonicalAliasIndex cu destinație terminală absentă din knownProductIds (atât nod prezent în index cu parent=null, cât și părinte absent)
    const explicitIndex = buildCanonicalAliasIndex([
      { id: 'live-root', canonicalProductId: null },
      { id: 'a-valid', canonicalProductId: 'live-root' },
      { id: 'deleted-root', canonicalProductId: null },
      { id: 'a1', canonicalProductId: 'deleted-root' },
      { id: 'a-orphan', canonicalProductId: 'never-existed-root' }
    ]);
    const resIdxDead = resolveCanonicalProductDetail('a1', explicitIndex, { knownProductIds });
    assert.equal(resIdxDead.found, false, 'CanonicalAliasIndex: destinație terminală deleted-root absentă din knownProductIds este respinsă');
    assert.equal(resIdxDead.canonicalId, null);

    const resIdxDirectDead = resolveCanonicalProductDetail('deleted-root', explicitIndex, { knownProductIds });
    assert.equal(resIdxDirectDead.found, false, 'CanonicalAliasIndex: rădăcina deleted-root absentă din knownProductIds este respinsă');
    assert.equal(resIdxDirectDead.canonicalId, null);

    const resIdxOrphan = resolveCanonicalProductDetail('a-orphan', explicitIndex, { knownProductIds });
    assert.equal(resIdxOrphan.found, false);
    assert.equal(resIdxOrphan.canonicalId, null);

    // 4. Rădăcină validă prezentă în knownProductIds -> acceptată pe toate cele 3 tipuri de index
    for (const [label, src] of [
      ['Map', mapSource],
      ['Record', recordSource],
      ['CanonicalAliasIndex', explicitIndex]
    ] as const) {
      const okRoot = resolveCanonicalProductDetail('live-root', src, { knownProductIds });
      assert.equal(okRoot.found, true, `${label}: live-root acceptat`);
      assert.equal(okRoot.canonicalId, 'live-root');

      const okAlias = resolveCanonicalProductDetail('a-valid', src, { knownProductIds });
      assert.equal(okAlias.found, true, `${label}: a-valid -> live-root acceptat`);
      assert.equal(okAlias.canonicalId, 'live-root');
    }

    // 5. normalizeProductReferences nu rescrie referința invalidă spre produs inexistent și o rescrie pe cea validă
    for (const [label, src] of [
      ['Map', mapSource],
      ['Record', recordSource],
      ['CanonicalAliasIndex', explicitIndex]
    ] as const) {
      const normalized = normalizeProductReferences(
        [
          { id: 'row-dead', productId: 'a1' },
          { id: 'row-valid', productId: 'a-valid' },
          { id: 'row-root', productId: 'live-root' }
        ],
        src,
        {
          fields: ['productId'],
          knownProductIds,
          preserveOriginalField: 'originalProductId'
        }
      );

      assert.equal(normalized[0].productId, 'a1', `${label}: normalizeProductReferences păstrează 'a1' neschimbat (nu rescrie spre deleted-root)`);
      assert.equal((normalized[0] as any).originalProductId, undefined);
      assert.equal(normalized[1].productId, 'live-root', `${label}: normalizeProductReferences promovează 'a-valid' -> 'live-root'`);
      assert.equal((normalized[1] as any).originalProductId, 'a-valid');
      assert.equal(normalized[2].productId, 'live-root', `${label}: normalizeProductReferences păstrează 'live-root'`);
    }

    pass('Finding #5: knownProductIds aplicat strict pe Map, Record, CanonicalAliasIndex și normalizeProductReferences');
  }

  StorageService.resetAllData();
  console.log(`\nTOATE CELE ${passed} GRUPURI DE TESTE FAZA 3B.1.2 AU TRECUT CU SUCCES!`);
}

runTests().catch(err => {
  console.error('EROARE ÎN TESTELE FAZA 3B.1.2:', err);
  process.exit(1);
});
