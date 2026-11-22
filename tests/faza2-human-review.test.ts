// tests/faza2-human-review.test.ts
// Suită completă de verificare pentru FAZA 2 — Human Review Panel pentru Shadow Matching
// Verifică toate cele 23 de scenarii: auth, validare Zod, 404, blocare BLOCKED/LOW_CONFIDENCE,
// toate statusurile review, anti-spoofing, idempotență, concurență optimistă (409),
// paginare, filtrare/sortare, evidențe nealterate, ZERO mutații în catalog/oferte/istoric/product_match_candidates,
// și nicio modificare pe rutele publice.

import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import { StorageService } from '../src/services/StorageService.ts';
import { ShadowReviewService } from '../src/services/ShadowReviewService.ts';
import { ProductShadowMatchingService } from '../src/services/ProductShadowMatchingService.ts';
import type { Product } from '../src/types.ts';

let passed = 0;
function pass(msg: string) {
  console.log(`✅ [PASS] ${msg}`);
  passed++;
}

function makeProduct(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    brand: '',
    category: 'Produse de bază',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    baseReferencePrice: 12,
    ...overrides
  };
}

async function runTests() {
  console.log('🧪 Pornire suită completă FAZA 2 — Human Review Panel...\n');
  StorageService.resetAllData();
  ShadowReviewService.clearCache();

  // Seed deterministic cross-retailer custom products covering ALL 4 categories:
  // 1) HIGH_CONFIDENCE (GS1 + brand + packaging)
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-lidl-f2-hc1',
      name: 'Cafea Jacobs Kronung Boabe 500g',
      brand: 'Jacobs',
      category: 'Băuturi',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '012345678905'
    })
  );
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-kaufland-f2-hc1',
      name: 'Jacobs Kronung Cafea Boabe 500 g',
      brand: 'JACOBS',
      category: 'Băuturi',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '0012345678905'
    })
  );

  // 2) REVIEW #1 (missing explicit brand on one side -> capped <= 0.84 -> REVIEW)
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-carrefour-f2-rev1',
      name: 'Sana Napolact 3.6% 330g',
      brand: 'Napolact',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 330,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-auchan-f2-rev1',
      name: 'Napolact Sana 3.6% Grasime 330 g',
      brand: '',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 330,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );

  // 3) REVIEW #2 (extra REVIEW candidate for multi-status transitions & pagination)
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-mega-image-f2-rev2',
      name: 'Unt President 82% 200g',
      brand: 'President',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 200,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-penny-f2-rev2',
      name: 'President Unt Gras 82% 200 g',
      brand: '',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 200,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );

  // 4) REVIEW #3 (for dismissed & reset test)
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-lidl-f2-rev3',
      name: 'Smantana Hochland 20% 400g',
      brand: 'Hochland',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 400,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-kaufland-f2-rev3',
      name: 'Hochland Smantana Clasica 20% 400 g',
      brand: '',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 400,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );

  // 5) BLOCKED (fat % variant mismatch: 1.5% vs 3.5%)
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-lidl-f2-blk1',
      name: 'Lapte Zuzu Semidegresat 1.5% 1L',
      brand: 'Zuzu',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l'
    })
  );
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-penny-f2-blk1',
      name: 'Lapte Zuzu Integral 3.5% 1L',
      brand: 'Zuzu',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l'
    })
  );

  // 6) LOW_CONFIDENCE (no brand + missing quantity ambiguity or low title overlap without hard block)
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-auchan-f2-low1',
      name: 'Biscuiti Populari Cu Miere 180g',
      brand: 'Roshen',
      category: 'Panificație',
      packageWeightOrVolume: 180,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );
  StorageService.addCustomProduct(
    makeProduct({
      id: 'prod-carrefour-f2-low1',
      name: 'Roshen Biscuiti Crocanți Simpli Vanilie 180g',
      brand: 'Roshen',
      category: 'Produse de bază', // category penalty -0.12 + low title overlap -> LOW_CONFIDENCE
      packageWeightOrVolume: 180,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    })
  );

  // Pre-compute deterministic IDs via shadow engine (read-only)
  const baselineReport = ProductShadowMatchingService.generateShadowMatchingReport({
    products: StorageService.getAllProducts(),
    retailerProducts: StorageService.getRetailerProducts(),
    offers: StorageService.getProductOffers(),
    options: { includeLowConfidence: true, maxReportCandidates: 2000, maxCandidatesPerProduct: 25 }
  });

  const findPair = (idA: string, idB: string) =>
    baselineReport.candidates.find(
      c =>
        (c.sourceProductId === idA && c.targetProductId === idB) ||
        (c.sourceProductId === idB && c.targetProductId === idA)
    );

  const highCandidate = findPair('prod-lidl-f2-hc1', 'prod-kaufland-f2-hc1');
  const revCandidate1 = findPair('prod-carrefour-f2-rev1', 'prod-auchan-f2-rev1');
  const revCandidate2 = findPair('prod-mega-image-f2-rev2', 'prod-penny-f2-rev2');
  const revCandidate3 = findPair('prod-lidl-f2-rev3', 'prod-kaufland-f2-rev3');
  const blockedCandidate = findPair('prod-lidl-f2-blk1', 'prod-penny-f2-blk1');
  const lowCandidate = findPair('prod-auchan-f2-low1', 'prod-carrefour-f2-low1');

  assert.ok(highCandidate && highCandidate.decisionCategory === 'HIGH_CONFIDENCE', 'HIGH_CONFIDENCE fixture');
  assert.ok(revCandidate1 && revCandidate1.decisionCategory === 'REVIEW', 'REVIEW #1 fixture');
  assert.ok(revCandidate2 && revCandidate2.decisionCategory === 'REVIEW', 'REVIEW #2 fixture');
  assert.ok(revCandidate3 && revCandidate3.decisionCategory === 'REVIEW', 'REVIEW #3 fixture');
  assert.ok(blockedCandidate && blockedCandidate.decisionCategory === 'BLOCKED', 'BLOCKED fixture');
  assert.ok(lowCandidate && lowCandidate.decisionCategory === 'LOW_CONFIDENCE', 'LOW_CONFIDENCE fixture');

  // Snapshot ALL immutable catalog & table structures BEFORE running any review operations
  const productsSnapshotBefore = JSON.stringify(StorageService.getAllProducts());
  const offersSnapshotBefore = JSON.stringify(StorageService.getProductOffers());
  const observationsSnapshotBefore = JSON.stringify(StorageService.getPriceObservations());
  const matchCandidatesSnapshotBefore = JSON.stringify(StorageService.getMatchCandidates());
  const retailerProductsSnapshotBefore = JSON.stringify(StorageService.getRetailerProducts());

  const { app, ADMIN_API_KEY } = await import('../server.ts');
  const server = await new Promise<http.Server>(resolve => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  try {
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const authHeaders = {
      Authorization: `Bearer ${ADMIN_API_KEY}`,
      'Content-Type': 'application/json'
    };

    // Baseline public endpoint responses BEFORE review operations
    const publicProductsBefore = await (await fetch(`${baseUrl}/api/products`)).json();
    const publicCategoriesBefore = await (await fetch(`${baseUrl}/api/categories`)).json();

    // 1 & 2. Admin auth verification + Unauthorized -> 401 + Forbidden -> 403
    {
      const unauthList = await fetch(`${baseUrl}/api/admin/shadow-matching/reviews`);
      assert.equal(unauthList.status, 401);
      const unauthDetail = await fetch(`${baseUrl}/api/admin/shadow-matching/reviews/${highCandidate.candidateId}`);
      assert.equal(unauthDetail.status, 401);
      const unauthDecision = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${highCandidate.candidateId}/decision`,
        { method: 'POST', body: JSON.stringify({ status: 'dismissed', reason: 'test' }) }
      );
      assert.equal(unauthDecision.status, 401);
      const unauthAudit = await fetch(`${baseUrl}/api/admin/shadow-matching/audit`);
      assert.equal(unauthAudit.status, 401);

      const badToken = await fetch(`${baseUrl}/api/admin/shadow-matching/reviews`, {
        headers: { Authorization: 'Bearer invalid-token-xyz' }
      });
      assert.equal(badToken.status, 403);

      const okAuth = await fetch(`${baseUrl}/api/admin/shadow-matching/reviews`, {
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.equal(okAuth.status, 200);
      const okJson = (await okAuth.json()) as any;
      assert.equal(okJson.success, true);
      assert.equal(okJson.autoMergeExecuted, false);
      assert.equal(okJson.readOnlyCatalogVerified, true);
      pass('1-2. Admin auth verificat (200 valid, 401 fără token, 403 token invalid)');
    }

    // 3. Invalid input -> 400
    {
      const badQuery = await fetch(`${baseUrl}/api/admin/shadow-matching/reviews?decisionCategory=INVALID_CAT`, {
        headers: authHeaders
      });
      assert.equal(badQuery.status, 400);

      const badLimit = await fetch(`${baseUrl}/api/admin/shadow-matching/reviews?limit=9999`, {
        headers: authHeaders
      });
      assert.equal(badLimit.status, 400);

      const badStatus = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${highCandidate.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ status: 'auto_merged', reason: 'Invalid status' })
        }
      );
      assert.equal(badStatus.status, 400);

      const shortReason = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${highCandidate.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ status: 'confirmed_same_product', reason: 'ab' })
        }
      );
      assert.equal(shortReason.status, 400);
      pass('3. Validare Zod respinge parametrii/datele invalide cu HTTP 400');
    }

    // 4. Candidate not found -> 404
    {
      const notFoundGet = await fetch(`${baseUrl}/api/admin/shadow-matching/reviews/shd-doesnotexist999`, {
        headers: authHeaders
      });
      assert.equal(notFoundGet.status, 404);

      const notFoundPost = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/shd-doesnotexist999/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ status: 'dismissed', reason: 'Candidat inexistent' })
        }
      );
      assert.equal(notFoundPost.status, 404);
      pass('4. Candidat inexistent returnează HTTP 404 pe detaliu și decizie');
    }

    // 5. BLOCKED candidate cannot be confirmed
    {
      const blkRes = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${blockedCandidate.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'confirmed_same_product',
            reason: 'Încercare confirmare candidat blocat'
          })
        }
      );
      assert.equal(blkRes.status, 400);
      const blkJson = (await blkRes.json()) as any;
      assert.equal(blkJson.code, 'GUARD_BLOCKED_CANNOT_CONFIRM');
      pass('5. Candidat BLOCKED nu poate fi confirmat ca același produs (HTTP 400)');
    }

    // 6. LOW_CONFIDENCE candidate cannot be confirmed
    {
      const lowRes = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${lowCandidate.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'confirmed_same_product',
            reason: 'Încercare confirmare low confidence'
          })
        }
      );
      assert.equal(lowRes.status, 400);
      const lowJson = (await lowRes.json()) as any;
      assert.equal(lowJson.code, 'LOW_CONFIDENCE_CANNOT_CONFIRM');
      pass('6. Candidat LOW_CONFIDENCE nu poate fi confirmat ca același produs (HTTP 400)');
    }

    // 7, 9 & 13. HIGH_CONFIDENCE reviewed -> confirmed_same_product persists + Anti-spoofing
    {
      const detailBefore = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews/${highCandidate.candidateId}`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.equal(detailBefore.canConfirmSameProduct, true);
      assert.equal(detailBefore.review.status, 'pending_review');
      assert.equal(detailBefore.review.version, 0);

      // Client tries to spoof reviewerId / reviewerEmail / reviewedBy
      const res = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${highCandidate.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'confirmed_same_product',
            reason: 'EAN și brand Jacobs Kronung 500g identice',
            notes: 'Verificat manual Faza 2',
            reviewerId: 'evil-spoofed-id',
            reviewerEmail: 'attacker@spoof.local',
            reviewedBy: 'fake-admin'
          })
        }
      );
      assert.equal(res.status, 200);
      const json = (await res.json()) as any;
      assert.equal(json.success, true);
      assert.equal(json.autoMergeExecuted, false);
      assert.equal(json.decision.status, 'confirmed_same_product');
      assert.equal(json.decision.version, 1);
      assert.notEqual(json.decision.reviewerId, 'evil-spoofed-id');
      assert.notEqual(json.decision.reviewerEmail, 'attacker@spoof.local');
      assert.equal(json.decision.reviewerId, 'admin-bearer-authenticated');

      const detailAfter = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews/${highCandidate.candidateId}`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.equal(detailAfter.review.status, 'confirmed_same_product');
      assert.equal(detailAfter.review.reviewerId, 'admin-bearer-authenticated');
      assert.equal(detailAfter.auditHistory.length, 1);
      pass('7, 9, 13. HIGH_CONFIDENCE confirmat + persistat + anti-spoofing identitate reviewer verificat');
    }

    // 8, 10, 11, 12. REVIEW candidates: confirmed_different_product, needs_more_information, dismissed + audited pending_review reset
    {
      // confirmed_different_product on REVIEW #1
      const r1 = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate1.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'confirmed_different_product',
            reason: 'Formate sau rețete diferite verificate pe etichetă'
          })
        }
      );
      assert.equal(r1.status, 200);
      assert.equal(((await r1.json()) as any).decision.status, 'confirmed_different_product');

      // needs_more_information on REVIEW #2
      const r2 = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate2.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'needs_more_information',
            reason: 'Lipsește codul EAN din Auchan/Penny pentru confirmare'
          })
        }
      );
      assert.equal(r2.status, 200);
      assert.equal(((await r2.json()) as any).decision.status, 'needs_more_information');

      // dismissed + audited reset to pending_review on REVIEW #3
      const r3 = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate3.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'dismissed',
            reason: 'Închis temporar pentru lipsă EAN'
          })
        }
      );
      assert.equal(r3.status, 200);
      const r3Json = (await r3.json()) as any;
      assert.equal(r3Json.decision.status, 'dismissed');
      assert.equal(r3Json.decision.version, 1);

      const r3Reset = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate3.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'pending_review',
            reason: 'Redeschis pentru reevaluare după import nou',
            expectedVersion: 1
          })
        }
      );
      assert.equal(r3Reset.status, 200);
      const r3ResetJson = (await r3Reset.json()) as any;
      assert.equal(r3ResetJson.decision.status, 'pending_review');
      assert.equal(r3ResetJson.decision.version, 2);

      const detail3 = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate3.candidateId}`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.equal(detail3.auditHistory.length, 2);
      assert.equal(detail3.auditHistory[0].newStatus, 'pending_review');
      assert.equal(detail3.auditHistory[1].newStatus, 'dismissed');
      pass('8, 10, 11, 12. REVIEW acceptă confirmed_different_product, needs_more_information, dismissed și reset audibil la pending_review');
    }

    // 14. Idempotent review submission
    {
      const payload = {
        status: 'needs_more_information',
        reason: 'Lipsește codul EAN din Auchan/Penny pentru confirmare'
      };
      const replay = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate2.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(payload)
        }
      );
      assert.equal(replay.status, 200);
      const replayJson = (await replay.json()) as any;
      assert.equal(replayJson.idempotentReplay, true);
      assert.equal(replayJson.decision.version, 1, 'Versiunea nu crește la replay idempotent');
      assert.equal(replayJson.auditEntry, null, 'Nu se adaugă audit duplicat la replay idempotent');
      pass('14. Re-trimiterea idempotentă nu creează versiuni sau audit duplicate');
    }

    // 15. Concurrent review updates -> 409 Conflict
    {
      const [c1, c2] = await Promise.all([
        fetch(`${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate2.candidateId}/decision`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'confirmed_same_product',
            reason: 'Actualizare concurentă #1',
            expectedVersion: 1
          })
        }),
        fetch(`${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate2.candidateId}/decision`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'confirmed_different_product',
            reason: 'Actualizare concurentă #2',
            expectedVersion: 1
          })
        })
      ]);
      const statuses = [c1.status, c2.status].sort((a, b) => a - b);
      assert.deepEqual(statuses, [200, 409], 'Exact o cerere concurentă câștigă și cealaltă primește 409 Conflict');

      // Also verify stale expectedVersion explicitly returns 409
      const staleRes = await fetch(
        `${baseUrl}/api/admin/shadow-matching/reviews/${revCandidate2.candidateId}/decision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'dismissed',
            reason: 'Versiune expirată',
            expectedVersion: 0
          })
        }
      );
      assert.equal(staleRes.status, 409);
      const staleJson = (await staleRes.json()) as any;
      assert.equal(staleJson.code, 'VERSION_CONFLICT');
      pass('15. Protecție optimistă la concurență returnează HTTP 409 Conflict');
    }

    // 16 & 17. Pagination, filtering & sorting
    {
      const page1 = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews?decisionCategory=all&limit=2&page=1&sort=score_desc`, {
          headers: authHeaders
        })
      ).json()) as any;
      const page2 = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews?decisionCategory=all&limit=2&page=2&sort=score_desc`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.equal(page1.items.length, 2);
      assert.equal(page2.items.length, 2);
      assert.ok(page1.total >= 6);
      assert.notEqual(page1.items[0].candidate.candidateId, page2.items[0].candidate.candidateId);
      assert.ok(
        page1.items[0].candidate.matchingScore >= page1.items[1].candidate.matchingScore,
        'Sortare score_desc corectă'
      );

      const ascList = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews?decisionCategory=all&limit=20&sort=score_asc`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.ok(
        ascList.items[0].candidate.matchingScore <= ascList.items[ascList.items.length - 1].candidate.matchingScore,
        'Sortare score_asc corectă'
      );

      const filterByStatus = (await (
        await fetch(
          `${baseUrl}/api/admin/shadow-matching/reviews?decisionCategory=all&reviewStatus=confirmed_different_product`,
          { headers: authHeaders }
        )
      ).json()) as any;
      assert.ok(filterByStatus.items.length >= 1);
      assert.ok(filterByStatus.items.every((it: any) => it.review.status === 'confirmed_different_product'));

      const filterBySearch = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews?decisionCategory=all&search=Jacobs`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.ok(filterBySearch.items.some((it: any) => it.candidate.candidateId === highCandidate.candidateId));

      const filterByRetailer = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews?decisionCategory=all&retailer=penny`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.ok(
        filterByRetailer.items.every(
          (it: any) => it.candidate.sourceRetailer === 'penny' || it.candidate.targetRetailer === 'penny'
        )
      );
      pass('16-17. Paginare, filtrare (categorie/status/retailer/search) și sortare verificate');
    }

    // 18. Candidate evidence displayed without alteration
    {
      const detail = (await (
        await fetch(`${baseUrl}/api/admin/shadow-matching/reviews/${blockedCandidate.candidateId}`, {
          headers: authHeaders
        })
      ).json()) as any;
      assert.equal(detail.candidate.sourceTitle, blockedCandidate.sourceTitle);
      assert.equal(detail.candidate.targetTitle, blockedCandidate.targetTitle);
      assert.equal(detail.candidate.matchingScore, blockedCandidate.matchingScore);
      assert.deepEqual(detail.candidate.hardGuardResults, blockedCandidate.hardGuardResults);
      assert.deepEqual(detail.candidate.positiveEvidence, blockedCandidate.positiveEvidence);
      assert.deepEqual(detail.candidate.negativeEvidence, blockedCandidate.negativeEvidence);
      assert.ok(detail.candidate.scoreBreakdown, 'Score breakdown real furnizat de motor');
      assert.equal(detail.canConfirmSameProduct, false);
      pass('18. Evidențele candidatului și breakdown-ul real de scor sunt expuse fără alterare');
    }

    // 19, 20, 21, 22. ZERO mutations on products, productOffers, priceObservations, canonicalProductId, retailerProducts, and existing product_match_candidates
    {
      assert.equal(JSON.stringify(StorageService.getAllProducts()), productsSnapshotBefore, 'products & canonicalProductId neatinse');
      assert.equal(JSON.stringify(StorageService.getProductOffers()), offersSnapshotBefore, 'product_offers neatinse');
      assert.equal(JSON.stringify(StorageService.getPriceObservations()), observationsSnapshotBefore, 'price_observations neatinse');
      assert.equal(JSON.stringify(StorageService.getMatchCandidates()), matchCandidatesSnapshotBefore, 'rândurile existente din product_match_candidates neatinse');
      assert.equal(JSON.stringify(StorageService.getRetailerProducts()), retailerProductsSnapshotBefore, 'retailer_products neatinse');
      pass('19-22. Zero mutații pe products, canonicalProductId, productOffers, priceObservations, retailerProducts și product_match_candidates');
    }

    // 23. No public endpoint behavior changes
    {
      const publicProductsAfter = await (await fetch(`${baseUrl}/api/products`)).json();
      const publicCategoriesAfter = await (await fetch(`${baseUrl}/api/categories`)).json();
      assert.deepEqual(publicProductsAfter, publicProductsBefore, '/api/products neschimbat');
      assert.deepEqual(publicCategoriesAfter, publicCategoriesBefore, '/api/categories neschimbat');
      pass('23. Endpoint-urile publice (/api/products, /api/categories) complet neschimbate');
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  console.log(`\n🎉 Suită FAZA 2 finalizată cu succes: ${passed} grupuri / toate cele 23 de scenarii trecute!`);
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Eroare în suita Faza 2:', err);
  process.exit(1);
});
