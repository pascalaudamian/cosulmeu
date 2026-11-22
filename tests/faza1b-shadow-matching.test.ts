// tests/faza1b-shadow-matching.test.ts
// Suită completă de verificare pentru FAZA 1B — Shadow Matching & Detectarea Produselor Duplicate
// Reguli absolute verificate: ZERO auto-merge, ZERO mutații canonical_product_id / products / offers / price_observations.

import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import {
  ProductShadowMatchingService,
  SHADOW_NORMALIZATION_VERSION
} from '../src/services/ProductShadowMatchingService.ts';
import { DatabaseService } from '../src/db/index.ts';
import { StorageService } from '../src/services/StorageService.ts';
import type { Product, ProductOffer, RetailerProductRecord } from '../src/types.ts';

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
    baseReferencePrice: 10,
    ...overrides
  };
}

function evalPair(
  prodA: Product,
  prodB: Product,
  retailerA = 'lidl',
  retailerB = 'kaufland'
) {
  const report = ProductShadowMatchingService.generateShadowMatchingReport({
    products: [prodA, prodB],
    options: {
      retailerByProductId: {
        [prodA.id]: retailerA,
        [prodB.id]: retailerB
      },
      includeLowConfidence: true,
      sampleLimit: 10
    }
  });
  return { report, candidate: report.candidates[0] };
}

async function runTests() {
  console.log('🧪 Pornire suită completă FAZA 1B — Shadow Matching & Duplicate Detection...\n');
  StorageService.resetAllData();

  const initialProductsSnapshot = StorageService.getAllProducts().map(p => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    barcode: p.barcode ?? null,
    canonicalProductId: p.canonicalProductId ?? null
  }));
  const initialOffersCount = StorageService.getProductOffers().length;
  const initialObsCount = StorageService.getPriceObservations().length;

  // --- SCENARIU 1: Match valid pe GTIN/GS1 între retaileri diferiți (UPC-A / EAN-13 / GTIN-14) ---
  {
    const p1 = makeProduct({
      id: 'prod-lidl-c1',
      name: 'Sos Barbeque Classic 350 g',
      brand: 'Heinz',
      category: 'Produse de bază',
      packageWeightOrVolume: 350,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '012345678905' // UPC-A valid
    });
    const p2 = makeProduct({
      id: 'prod-kaufland-c1',
      name: 'Heinz Sos BBQ Classic 350g',
      brand: 'HEINZ',
      category: 'Produse de bază',
      packageWeightOrVolume: 350,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '0012345678905' // EAN-13 echivalent valid
    });
    const { candidate } = evalPair(p1, p2, 'lidl', 'kaufland');
    assert.ok(candidate, 'Candidatul GS1 cross-retailer trebuie generat');
    assert.equal(candidate.decisionCategory, 'HIGH_CONFIDENCE');
    assert.equal(candidate.matchingMethod, 'gs1_exact');
    assert.ok(candidate.matchingScore >= 0.88);
    assert.equal(candidate.recommendedAction, 'review_high_confidence_candidate');
    assert.equal(candidate.hardGuardResults.allPassed, true);
    pass('1. GTIN/GS1 valid echivalent (UPC-A <-> EAN-13) cross-retailer -> HIGH_CONFIDENCE (gs1_exact)');
  }

  // --- SCENARIU 2: Cod GS1 invalid sau prefix intern 20..29 NU generează gs1_exact ---
  {
    const pVar1 = makeProduct({
      id: 'prod-lidl-var20',
      name: 'Piept de pui 1 kg',
      brand: 'Agricola',
      packageWeightOrVolume: 1,
      packageUnit: 'kg',
      normalizedUnit: 'kg',
      barcode: '2012345000018'
    });
    const pVar2 = makeProduct({
      id: 'prod-auchan-var20',
      name: 'Piept de pui 1 kg',
      brand: 'Agricola',
      packageWeightOrVolume: 1,
      packageUnit: 'kg',
      normalizedUnit: 'kg',
      barcode: '2012345000018'
    });
    const { candidate } = evalPair(pVar1, pVar2, 'lidl', 'auchan');
    assert.ok(candidate, 'Perechea cu cod 20..29 trebuie evaluată și blocată');
    assert.equal(candidate.decisionCategory, 'BLOCKED');
    assert.notEqual(candidate.matchingMethod, 'gs1_exact');
    assert.ok(candidate.hardGuardResults.failedGuards.includes('GUARD_VARIABLE_WEIGHT'));
    pass('2. Cod intern / greutate variabilă prefix 20..29 blocat de la GS1 exact');
  }

  // --- SCENARIU 3: Brand real + titlu + ambalaj identic fără GTIN -> HIGH_CONFIDENCE ---
  {
    const p1 = makeProduct({
      id: 'prod-lidl-jacobs',
      name: 'Jacobs Kronung Cafea Măcinată 250g',
      brand: 'Jacobs',
      category: 'Băuturi',
      packageWeightOrVolume: 250,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    });
    const p2 = makeProduct({
      id: 'prod-carrefour-jacobs',
      name: 'Cafea macinata Jacobs Kronung 250 g',
      brand: 'JACOBS',
      category: 'Băuturi',
      packageWeightOrVolume: 250,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    });
    const { candidate } = evalPair(p1, p2, 'lidl', 'carrefour');
    assert.ok(candidate);
    assert.equal(candidate.decisionCategory, 'HIGH_CONFIDENCE');
    assert.equal(candidate.matchingMethod, 'brand_title_packaging');
    assert.ok(candidate.matchingScore >= 0.88, `Scor așteptat >= 0.88, primit ${candidate.matchingScore}`);

    // Brand recuperat din titlu (unul lipsește din DB)
    const pZuzu1 = makeProduct({
      id: 'prod-lidl-zuzu',
      name: 'Lapte UHT Zuzu 3.5% 1L',
      brand: 'Zuzu',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l'
    });
    const pZuzu2 = makeProduct({
      id: 'prod-auchan-zuzu',
      name: 'Zuzu Lapte UHT 3,5% 1 L',
      brand: '',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l'
    });
    const { candidate: cZuzu } = evalPair(pZuzu1, pZuzu2, 'lidl', 'auchan');
    assert.ok(cZuzu);
    assert.equal(cZuzu.decisionCategory, 'HIGH_CONFIDENCE');
    assert.equal(cZuzu.sourceBrand, 'Zuzu');
    assert.equal(cZuzu.targetBrand, 'Zuzu');
    pass('3. Brand real + titlu + ambalaj identic fără GTIN -> HIGH_CONFIDENCE');
  }

  // --- SCENARIU 4: Brand placeholder / lipsă -> NU devine niciodată HIGH_CONFIDENCE fără GTIN ---
  {
    const pWeak1 = makeProduct({
      id: 'prod-lidl-ph1',
      name: 'Produs lactat 500g',
      brand: 'Marcă Magazin',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    });
    const pWeak2 = makeProduct({
      id: 'prod-penny-ph2',
      name: 'Preparat lactat 500g',
      brand: 'Generic',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    });
    const prepA = ProductShadowMatchingService.prepareProduct(pWeak1, ['lidl']);
    const prepB = ProductShadowMatchingService.prepareProduct(pWeak2, ['penny']);
    const cWeak = ProductShadowMatchingService.evaluateCandidatePair(prepA, prepB, 'lidl', 'penny');
    assert.equal(cWeak.decisionCategory, 'BLOCKED');
    assert.ok(cWeak.hardGuardResults.failedGuards.includes('GUARD_AMBIGUOUS_BRAND_PLACEHOLDER'));

    // Titlu clar multi-cuvânt fără brand și fără GTIN -> maxim REVIEW (niciodată HIGH_CONFIDENCE)
    const pNoBrand1 = makeProduct({
      id: 'prod-lidl-nb1',
      name: 'Piept de pui dezosat fără piele 500g',
      brand: 'Marcă necunoscută',
      category: 'Carne și pește',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    });
    const pNoBrand2 = makeProduct({
      id: 'prod-kaufland-nb2',
      name: 'Piept de pui dezosat fără piele 500 g',
      brand: '',
      category: 'Carne și pește',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg'
    });
    const { candidate: cNoBrand } = evalPair(pNoBrand1, pNoBrand2, 'lidl', 'kaufland');
    assert.ok(cNoBrand);
    assert.notEqual(cNoBrand.decisionCategory, 'HIGH_CONFIDENCE', 'Fără brand real și fără GTIN NU poate fi HIGH_CONFIDENCE');
    assert.equal(cNoBrand.decisionCategory, 'REVIEW');
    assert.ok(cNoBrand.matchingScore < 0.88);
    pass('4. Brand placeholder/absent exclus din HIGH_CONFIDENCE fără GTIN (BLOCKED sau REVIEW)');
  }

  // --- SCENARIU 5: Marcă proprie cross-retailer & branduri reale diferite -> BLOCKED ---
  {
    const pPilos = makeProduct({
      id: 'prod-lidl-pilos',
      name: 'Lapte proaspăt Pilos 3.5% 1L',
      brand: 'Pilos',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l'
    });
    const pKClassic = makeProduct({
      id: 'prod-kaufland-kc',
      name: 'Lapte proaspăt K-Classic 3.5% 1L',
      brand: 'K-Classic',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l'
    });
    const prepPilos = ProductShadowMatchingService.prepareProduct(pPilos, ['lidl']);
    const prepKC = ProductShadowMatchingService.prepareProduct(pKClassic, ['kaufland']);
    const cPriv = ProductShadowMatchingService.evaluateCandidatePair(prepPilos, prepKC, 'lidl', 'kaufland');
    assert.equal(cPriv.decisionCategory, 'BLOCKED');
    assert.ok(cPriv.hardGuardResults.failedGuards.includes('GUARD_PRIVATE_LABEL_CROSS_RETAILER'));
    assert.ok(cPriv.hardGuardResults.failedGuards.includes('GUARD_INCOMPATIBLE_BRAND'));

    // Branduri naționale diferite
    const pNapolact = makeProduct({
      id: 'prod-auchan-nap',
      name: 'Lapte proaspăt Napolact 3.5% 1L',
      brand: 'Napolact',
      category: 'Lactate și ouă',
      packageWeightOrVolume: 1,
      packageUnit: 'l',
      normalizedUnit: 'l'
    });
    const prepNap = ProductShadowMatchingService.prepareProduct(pNapolact, ['auchan']);
    const cDiffBrand = ProductShadowMatchingService.evaluateCandidatePair(prepPilos, prepNap, 'lidl', 'auchan');
    assert.equal(cDiffBrand.decisionCategory, 'BLOCKED');
    assert.ok(cDiffBrand.hardGuardResults.failedGuards.includes('GUARD_INCOMPATIBLE_BRAND'));
    pass('5. Marcă proprie cross-retailer și branduri reale diferite blocate strict');
  }

  // --- SCENARIU 6: Variante distincte blocate de GUARD_INCOMPATIBLE_VARIANT ---
  {
    const variantConflictCases: Array<[string, string, string, string]> = [
      ['Lapte Napolact 0% grăsime 1L', 'Lapte Napolact 3.5% grăsime 1L', 'Napolact', '0% vs 3.5%'],
      ['Cafea Jacobs Kronung Boabe 500g', 'Cafea Jacobs Kronung Măcinată 500g', 'Jacobs', 'boabe vs măcinată'],
      ['Cafea Lavazza Capsule 10 buc', 'Cafea Lavazza Boabe 10 buc', 'Lavazza', 'capsule vs boabe'],
      ['Coca-Cola Zero Zahăr 2L', 'Coca-Cola Clasic 2L', 'Coca-Cola', 'fără zahăr vs standard'],
      ['Lapte Zuzu Fără Lactoză 1.5% 1L', 'Lapte Zuzu 1.5% 1L', 'Zuzu', 'fără lactoză vs standard'],
      ['Lapte Alpro Bio 1L', 'Lapte Alpro 1L', 'Alpro', 'bio vs convențional'],
      ['Bere Ursus Fără Alcool 0.5L', 'Bere Ursus 5% alcool 0.5L', 'Ursus', 'fără alcool vs cu alcool'],
      ['Iaurt Danone Căpșuni 150g', 'Iaurt Danone Vanilie 150g', 'Danone', 'arome diferite']
    ];

    for (const [t1, t2, brand, label] of variantConflictCases) {
      const a = makeProduct({ id: `prod-lidl-vc-${label}`, name: t1, brand, packageWeightOrVolume: 1, packageUnit: 'l', normalizedUnit: 'l' });
      const b = makeProduct({ id: `prod-kaufland-vc-${label}`, name: t2, brand, packageWeightOrVolume: 1, packageUnit: 'l', normalizedUnit: 'l' });
      const prepA = ProductShadowMatchingService.prepareProduct(a, ['lidl']);
      const prepB = ProductShadowMatchingService.prepareProduct(b, ['kaufland']);
      const c = ProductShadowMatchingService.evaluateCandidatePair(prepA, prepB, 'lidl', 'kaufland');
      assert.equal(c.decisionCategory, 'BLOCKED', `Varianta ${label} trebuie blocată`);
      assert.ok(
        c.hardGuardResults.failedGuards.includes('GUARD_INCOMPATIBLE_VARIANT'),
        `Varianta ${label} trebuie să declanșeze GUARD_INCOMPATIBLE_VARIANT`
      );
      assert.equal(c.variantAttributes.compatible, false);
    }
    pass('6. Toate conflictele de variante (0% vs 3.5%, boabe vs măcinată, capsule, zahăr, lactoză, bio, alcool, arome) -> BLOCKED');
  }

  // --- SCENARIU 7: Cantități incompatibile, familii de unități, 1x500g vs 2x250g & non-food ---
  {
    // 500g vs 1kg
    const q1 = makeProduct({ id: 'prod-lidl-q500', name: 'Zahăr Mărgăritar 500g', brand: 'Mărgăritar', packageWeightOrVolume: 500, packageUnit: 'g', normalizedUnit: 'kg' });
    const q2 = makeProduct({ id: 'prod-carrefour-q1k', name: 'Zahăr Mărgăritar 1 kg', brand: 'Mărgăritar', packageWeightOrVolume: 1, packageUnit: 'kg', normalizedUnit: 'kg' });
    const cQty = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(q1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(q2, ['carrefour']),
      'lidl',
      'carrefour'
    );
    assert.equal(cQty.decisionCategory, 'BLOCKED');
    assert.ok(cQty.hardGuardResults.failedGuards.includes('GUARD_INCOMPATIBLE_QUANTITY'));

    // solid vs lichid (500g vs 500ml)
    const u1 = makeProduct({ id: 'prod-lidl-sol', name: 'Sos Roșii Heinz 500g', brand: 'Heinz', packageWeightOrVolume: 500, packageUnit: 'g', normalizedUnit: 'kg' });
    const u2 = makeProduct({ id: 'prod-auchan-liq', name: 'Sos Roșii Heinz 500ml', brand: 'Heinz', packageWeightOrVolume: 500, packageUnit: 'ml', normalizedUnit: 'l' });
    const cUnit = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(u1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(u2, ['auchan']),
      'lidl',
      'auchan'
    );
    assert.equal(cUnit.decisionCategory, 'BLOCKED');
    assert.ok(cUnit.hardGuardResults.failedGuards.includes('GUARD_INCOMPATIBLE_UNIT_FAMILY'));

    // 1x500g vs 2x250g -> differentStructureSameTotal = true, BLOCKED cu recomandare separată
    const s1 = makeProduct({ id: 'prod-lidl-s500', name: 'Cafea Jacobs Kronung 500g', brand: 'Jacobs', packageWeightOrVolume: 500, packageUnit: 'g', normalizedUnit: 'kg' });
    const s2 = makeProduct({ id: 'prod-kaufland-s2x250', name: 'Cafea Jacobs Kronung 2 x 250g', brand: 'Jacobs', packageWeightOrVolume: 500, packageUnit: 'g', normalizedUnit: 'kg' });
    const cStruct = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(s1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(s2, ['kaufland']),
      'lidl',
      'kaufland'
    );
    assert.equal(cStruct.decisionCategory, 'BLOCKED');
    assert.equal(cStruct.differentStructureSameTotal, true);
    assert.equal(cStruct.recommendedAction, 'keep_separate_different_packaging_structure');
    assert.ok(cStruct.hardGuardResults.failedGuards.includes('GUARD_PACKAGING_STRUCTURE_MISMATCH'));

    // Non-food contradiction: "Aparat de ras cu 3 lame" cu packageUnit='l', qty=3
    const nf1 = makeProduct({ id: 'prod-lidl-nf', name: 'Gillette Aparat de ras cu 3 lame', brand: 'Gillette', packageWeightOrVolume: 3, packageUnit: 'l', normalizedUnit: 'l' });
    const nf2 = makeProduct({ id: 'prod-kaufland-nf', name: 'Gillette Aparat de ras cu 3 lame 1 buc', brand: 'Gillette', packageWeightOrVolume: 1, packageUnit: 'buc', normalizedUnit: 'buc' });
    const cNf = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(nf1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(nf2, ['kaufland']),
      'lidl',
      'kaufland'
    );
    assert.equal(cNf.decisionCategory, 'BLOCKED');
    assert.ok(cNf.hardGuardResults.failedGuards.includes('GUARD_NONFOOD_UNIT_CONTRADICTION'));
    pass('7. Cantități (500g vs 1kg), unități (g vs ml), structură 1x500g vs 2x250g și contradicții non-food -> BLOCKED');
  }

  // --- SCENARIU 8: Vrac / la cântar, titluri insuficiente și multipack suspect -> BLOCKED ---
  {
    const vrac1 = makeProduct({ id: 'prod-lidl-vrac', name: 'Mere roșii vrac la kg', brand: 'Origine RO', isSoldByWeight: true, packageWeightOrVolume: 1, packageUnit: 'kg', normalizedUnit: 'kg' });
    const vrac2 = makeProduct({ id: 'prod-penny-vrac', name: 'Mere roșii vrac la kg', brand: 'Origine RO', isSoldByWeight: true, packageWeightOrVolume: 1, packageUnit: 'kg', normalizedUnit: 'kg' });
    const cVrac = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(vrac1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(vrac2, ['penny']),
      'lidl',
      'penny'
    );
    assert.equal(cVrac.decisionCategory, 'BLOCKED');
    assert.ok(cVrac.hardGuardResults.failedGuards.includes('GUARD_VARIABLE_WEIGHT'));

    const ins1 = makeProduct({ id: 'prod-lidl-ins', name: 'Produs', brand: '', packageWeightOrVolume: 500, packageUnit: 'g', normalizedUnit: 'kg' });
    const ins2 = makeProduct({ id: 'prod-auchan-ins', name: 'Produs', brand: '', packageWeightOrVolume: 500, packageUnit: 'g', normalizedUnit: 'kg' });
    const cIns = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(ins1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(ins2, ['auchan']),
      'lidl',
      'auchan'
    );
    assert.equal(cIns.decisionCategory, 'BLOCKED');
    assert.ok(cIns.hardGuardResults.failedGuards.includes('GUARD_INSUFFICIENT_TITLE'));

    const susp1 = makeProduct({ id: 'prod-lidl-susp', name: 'Borsec Apă minerală 100 x 1.5 l', brand: 'Borsec', packageWeightOrVolume: 1.5, packageUnit: 'l', normalizedUnit: 'l' });
    const susp2 = makeProduct({ id: 'prod-kaufland-susp', name: 'Borsec Apă minerală 100 x 1.5 l', brand: 'Borsec', packageWeightOrVolume: 1.5, packageUnit: 'l', normalizedUnit: 'l' });
    const cSusp = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(susp1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(susp2, ['kaufland']),
      'lidl',
      'kaufland'
    );
    assert.equal(cSusp.decisionCategory, 'BLOCKED');
    assert.ok(cSusp.hardGuardResults.failedGuards.includes('GUARD_SUSPICIOUS_MULTIPACK'));
    pass('8. Vrac/cântar, titluri insuficiente și multipack suspect blocate strict');
  }

  // --- SCENARIU 9: Toate câmpurile obligatorii ale obiectului ShadowMatchCandidate + praguri scor ---
  {
    const a = makeProduct({ id: 'prod-lidl-req', name: 'Ulei floarea soarelui Floriol 1L', brand: 'Floriol', category: 'Produse de bază', packageWeightOrVolume: 1, packageUnit: 'l', normalizedUnit: 'l', barcode: '5941014002343' });
    const b = makeProduct({ id: 'prod-mega-image-req', name: 'Floriol Ulei de floarea-soarelui 1 L', brand: 'Floriol', category: 'Produse de bază', packageWeightOrVolume: 1, packageUnit: 'l', normalizedUnit: 'l', barcode: '5941014002343' });
    const { candidate } = evalPair(a, b, 'lidl', 'mega-image');
    assert.ok(candidate);

    const requiredKeys = [
      'candidateId',
      'sourceProductId',
      'targetProductId',
      'sourceRetailer',
      'targetRetailer',
      'sourceTitle',
      'targetTitle',
      'sourceBrand',
      'targetBrand',
      'sourceBarcode',
      'targetBarcode',
      'sourceQuantity',
      'targetQuantity',
      'sourcePackagingStructure',
      'targetPackagingStructure',
      'variantAttributes',
      'matchingScore',
      'matchingMethod',
      'hardGuardResults',
      'positiveEvidence',
      'negativeEvidence',
      'decisionCategory',
      'recommendedAction',
      'explanation',
      'normalizationVersion',
      'generatedAt'
    ];
    for (const k of requiredKeys) {
      assert.ok(k in candidate, `Câmpul obligatoriu "${k}" lipsește din ShadowMatchCandidate`);
    }
    assert.equal(candidate.normalizationVersion, SHADOW_NORMALIZATION_VERSION);
    assert.ok(Array.isArray(candidate.positiveEvidence) && candidate.positiveEvidence.length > 0);
    assert.ok(Array.isArray(candidate.hardGuardResults.checks) && candidate.hardGuardResults.checks.length >= 10);

    // LOW_CONFIDENCE: același brand, cantitate identică, dar produse diferite (ex: "Iaurt" vs "Smântână" fără cuvinte descriptive comune)
    const lc1 = makeProduct({ id: 'prod-lidl-lc', name: 'Zuzu Iaurt natural cremos 400g', brand: 'Zuzu', category: 'Lactate și ouă', packageWeightOrVolume: 400, packageUnit: 'g', normalizedUnit: 'kg' });
    const lc2 = makeProduct({ id: 'prod-auchan-lc', name: 'Zuzu Smântână fermentată 400g', brand: 'Zuzu', category: 'Lactate și ouă', packageWeightOrVolume: 400, packageUnit: 'g', normalizedUnit: 'kg' });
    const cLow = ProductShadowMatchingService.evaluateCandidatePair(
      ProductShadowMatchingService.prepareProduct(lc1, ['lidl']),
      ProductShadowMatchingService.prepareProduct(lc2, ['auchan']),
      'lidl',
      'auchan'
    );
    assert.equal(cLow.decisionCategory, 'LOW_CONFIDENCE');
    assert.ok(cLow.matchingScore < 0.68);
    assert.equal(cLow.recommendedAction, 'no_action_low_confidence');
    pass('9. Contract complet 26 câmpuri verificat și praguri de decizie (HIGH / REVIEW / LOW / BLOCKED) corecte');
  }

  // --- SCENARIU 10: Scalabilitate Blocking sub-quadratic (< O(n^2)) pe 320 produse ---
  {
    const retailers = ['lidl', 'kaufland', 'carrefour', 'auchan'];
    const syntheticProducts: Product[] = [];
    for (let i = 0; i < 320; i++) {
      const ret = retailers[i % retailers.length];
      const familyIdx = Math.floor(i / 4); // perechi cross-retailer în același familyIdx
      syntheticProducts.push(
        makeProduct({
          id: `prod-${ret}-scale-${i}`,
          name: `Produs Alimentar Test${familyIdx} 500g`,
          brand: i % 2 === 0 ? 'Napolact' : 'Jacobs',
          packageWeightOrVolume: 500,
          packageUnit: 'g',
          normalizedUnit: 'kg'
        })
      );
    }
    const maxNaivePairs = (320 * 319) / 2; // 51,040
    const report = ProductShadowMatchingService.generateShadowMatchingReport({
      products: syntheticProducts,
      options: { dataSource: 'custom_dataset', maxReportCandidates: 100 }
    });
    assert.ok(
      report.summary.totalCandidatePairsGeneratedByBlocking < maxNaivePairs * 0.25,
      `Blocking trebuie să evite O(n²): generat ${report.summary.totalCandidatePairsGeneratedByBlocking} vs naiv ${maxNaivePairs}`
    );
    assert.ok(report.durationMs < 2000, `Rularea trebuie să fie rapidă (${report.durationMs} ms)`);
    pass(`10. Blocking sub-quadratic verificat pe 320 produse (${report.summary.totalCandidatePairsGeneratedByBlocking} perechi vs ${maxNaivePairs} O(n²), ${report.durationMs}ms)`);
  }

  // --- SCENARIU 11: Determinism & Idempotență completă ---
  {
    const dataset: Product[] = [
      makeProduct({ id: 'prod-lidl-d1', name: 'Unt Lurpak Sărat 200g', brand: 'Lurpak', category: 'Lactate și ouă', packageWeightOrVolume: 200, packageUnit: 'g', normalizedUnit: 'kg' }),
      makeProduct({ id: 'prod-kaufland-d1', name: 'Lurpak Unt Sărat 200 g', brand: 'Lurpak', category: 'Lactate și ouă', packageWeightOrVolume: 200, packageUnit: 'g', normalizedUnit: 'kg' }),
      makeProduct({ id: 'prod-auchan-d2', name: 'Unt Lurpak 2 x 100g', brand: 'Lurpak', category: 'Lactate și ouă', packageWeightOrVolume: 200, packageUnit: 'g', normalizedUnit: 'kg' })
    ];
    const r1 = ProductShadowMatchingService.generateShadowMatchingReport({ products: dataset, options: { includeLowConfidence: true } });
    const r2 = ProductShadowMatchingService.generateShadowMatchingReport({ products: dataset, options: { includeLowConfidence: true } });
    assert.deepEqual(r1.summary, r2.summary);
    assert.deepEqual(
      r1.candidates.map(c => ({ id: c.candidateId, cat: c.decisionCategory, score: c.matchingScore, method: c.matchingMethod })),
      r2.candidates.map(c => ({ id: c.candidateId, cat: c.decisionCategory, score: c.matchingScore, method: c.matchingMethod }))
    );
    assert.equal(r1.readOnlyVerified, true);
    assert.equal(r1.autoMergeExecuted, false);
    assert.ok(r1.summary.differentStructureSameTotalCount >= 1);
    pass('11. Determinism 100% la rulări repetate și rapoarte agregate coerente');
  }

  // --- SCENARIU 12: Zero mutații DB/canonical_product_id, refolosire product_match_candidates & endpointuri Admin protejate ---
  {
    const dbReport = await DatabaseService.getShadowMatchingReport({ sampleLimit: 5, maxReportCandidates: 50 });
    assert.equal(dbReport.readOnlyVerified, true);
    assert.equal(dbReport.autoMergeExecuted, false);
    assert.equal(dbReport.dataSource, 'storage_service');

    // Persistență explicită în `product_match_candidates` (strict `pending_confirmation`, idempotentă, fără mutație produse/canonical)
    const syntheticHigh = evalPair(
      makeProduct({ id: 'prod-lidl-pers1', name: 'Cafea Lavazza Qualita Oro 250g', brand: 'Lavazza', packageWeightOrVolume: 250, packageUnit: 'g', normalizedUnit: 'kg' }),
      makeProduct({ id: 'prod-kaufland-pers1', name: 'Lavazza Qualita Oro Cafea 250 g', brand: 'Lavazza', packageWeightOrVolume: 250, packageUnit: 'g', normalizedUnit: 'kg' }),
      'lidl',
      'kaufland'
    ).candidate!;
    const syntheticBlocked = evalPair(
      makeProduct({ id: 'prod-lidl-blk1', name: 'Lapte Zuzu 1.5% 1L', brand: 'Zuzu', packageWeightOrVolume: 1, packageUnit: 'l', normalizedUnit: 'l' }),
      makeProduct({ id: 'prod-kaufland-blk1', name: 'Lapte Zuzu 3.5% 1L', brand: 'Zuzu', packageWeightOrVolume: 1, packageUnit: 'l', normalizedUnit: 'l' }),
      'lidl',
      'kaufland'
    ).candidate!;

    const pRes1 = await DatabaseService.saveShadowMatchCandidatesToExistingSchema([syntheticHigh, syntheticBlocked]);
    assert.equal(pRes1.attempted, 1, 'Doar candidatul ne-blocat HIGH_CONFIDENCE/REVIEW poate fi salvat');
    assert.equal(pRes1.skippedBlockedOrLow, 1);
    assert.equal(pRes1.added, 1);
    assert.equal(pRes1.persisted, true);

    const savedList = StorageService.getMatchCandidates();
    const savedRow = savedList.find(c => c.id === syntheticHigh.candidateId);
    assert.ok(savedRow, 'Candidatul trebuie să fie salvat în product_match_candidates');
    assert.equal(savedRow.status, 'pending_confirmation', 'Statusul trebuie să fie strict pending_confirmation');

    // Idempotență la a doua salvare
    const pRes2 = await DatabaseService.saveShadowMatchCandidatesToExistingSchema([syntheticHigh, syntheticBlocked]);
    assert.equal(pRes2.added, 0, 'A doua salvare nu trebuie să creeze duplicate');

    // Verifică ZERO mutații pe products, canonicalProductId, offers și priceObservations
    const afterProductsSnapshot = StorageService.getAllProducts().map(p => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      barcode: p.barcode ?? null,
      canonicalProductId: p.canonicalProductId ?? null
    }));
    assert.deepEqual(afterProductsSnapshot, initialProductsSnapshot, 'products și canonicalProductId NU au fost modificate');
    assert.equal(StorageService.getProductOffers().length, initialOffersCount, 'productOffers NU au fost modificate');
    assert.equal(StorageService.getPriceObservations().length, initialObsCount, 'priceObservations NU au fost modificate');

    // Test HTTP Express pentru GET /api/admin/shadow-matching/report și POST /api/admin/shadow-matching/persist
    const { app, ADMIN_API_KEY } = await import('../server.ts');
    const server = await new Promise<http.Server>(resolve => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    try {
      const addr = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const unauthGet = await fetch(`${baseUrl}/api/admin/shadow-matching/report`);
      assert.equal(unauthGet.status, 401);

      const badGet = await fetch(`${baseUrl}/api/admin/shadow-matching/report?sampleLimit=999`, {
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.equal(badGet.status, 400);

      const okGet = await fetch(`${baseUrl}/api/admin/shadow-matching/report?sampleLimit=5`, {
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.equal(okGet.status, 200);
      const getJson = (await okGet.json()) as any;
      assert.equal(getJson.success, true);
      assert.equal(getJson.report.readOnlyVerified, true);
      assert.equal(getJson.report.autoMergeExecuted, false);

      const unauthPost = await fetch(`${baseUrl}/api/admin/shadow-matching/persist`, { method: 'POST' });
      assert.equal(unauthPost.status, 401);

      const okPost = await fetch(`${baseUrl}/api/admin/shadow-matching/persist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ADMIN_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ allowCategories: ['HIGH_CONFIDENCE', 'REVIEW'], maxCandidates: 20 })
      });
      assert.equal(okPost.status, 200);
      const postJson = (await okPost.json()) as any;
      assert.equal(postJson.success, true);
      assert.equal(postJson.autoMergeExecuted, false);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    pass('12. Zero mutații pe products/canonical/offers/price_observations, persist idempotent & HTTP admin verificat');
  }

  console.log(`\n🎉 Suită FAZA 1B finalizată cu succes: ${passed}/12 grupuri de scenarii trecute!`);
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Eroare în suita Faza 1B:', err);
  process.exit(1);
});
