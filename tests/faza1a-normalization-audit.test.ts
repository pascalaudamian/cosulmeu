// tests/faza1a-normalization-audit.test.ts
// Suită completă de verificare pentru Faza 1A:
// Audit și Normalizare Controlată a Datelor pentru Product Matching (brand, cantitate/multipack, titlu/variante, barcode GS1)
// Fără mutații pe canonical_product_id, price_observations sau DB de producție.

import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import {
  areVariantAttributesCompatible,
  compareNormalizedPackaging,
  computeGs1Mod10CheckDigit,
  generateCatalogQualityReport,
  normalizeBrand,
  normalizeCatalogProduct,
  normalizeQuantityAndMultipack,
  normalizeTitleAndVariants,
  validateAndNormalizeBarcode
} from '../src/services/ProductNormalizationService.ts';
import { ProductMatcher } from '../src/services/ProductMatcher.ts';
import { StorageService } from '../src/services/StorageService.ts';
import { DatabaseService } from '../src/db/index.ts';
import { lookupProductByBarcode } from '../src/services/BarcodeService.ts';
import { normalizeValidatedBarcodeCandidates } from '../src/services/ProductIdentityService.ts';
import { isValidEanBarcode, matchReceiptItemsToCatalog } from '../src/services/ReceiptParserEngine.ts';
import { PriceExtractor } from '../src/indexing/catalog/PriceExtractor.ts';
import { CatalogParserEngine } from '../src/indexing/catalog/CatalogParserEngine.ts';
import { STORES } from '../src/data/mockData.ts';
import type { Product } from '../src/types.ts';

let passed = 0;
function pass(msg: string) {
  console.log(`✅ [PASS] ${msg}`);
  passed++;
}

async function runTests() {
  console.log('🧪 Pornire suită completă FAZA 1A — Normalizare Controlată & Calitate Date...\n');
  StorageService.resetAllData();

  const initialCanonicalSnapshot = StorageService.getAllProducts().map(p => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    barcode: p.barcode,
    canonicalProductId: p.canonicalProductId ?? null
  }));
  const initialObservationsCount = StorageService.getPriceObservations().length;

  // --- SCENARIUL 1: Normalizare brand (casing, brand compus / private-label, verificat vs lipsă) ---
  {
    const b1 = normalizeBrand('  napolact  ', 'Lapte Napolact 1.5% 1L');
    assert.equal(b1.normalizedBrand, 'Napolact');
    assert.equal(b1.brandQuality, 'verified_brand');
    assert.equal(b1.confidence, 1.0);
    assert.equal(b1.isPrivateLabel, false);

    const bPriv = normalizeBrand('Pilos / Marcă proprie', 'Lapte UHT 1.5% 1L');
    assert.equal(bPriv.normalizedBrand, 'Pilos');
    assert.equal(bPriv.brandQuality, 'verified_brand');
    assert.equal(bPriv.isPrivateLabel, true);
    assert.equal(bPriv.originalBrand, 'Pilos / Marcă proprie');

    const bMissing = normalizeBrand('', 'Făină albă de grâu 1kg');
    assert.equal(bMissing.normalizedBrand, null);
    assert.equal(bMissing.brandQuality, 'missing');
    assert.equal(bMissing.confidence, 0);
    pass('1. Normalizare brand (casing, private-label, lipsă fără inventare)');
  }

  // --- SCENARIUL 2: Branduri placeholder excluse din potrivire ca brand real ---
  {
    for (const ph of ['Marcă Magazin', 'Generic', 'Unknown', 'N/A', 'Marcă necunoscută', 'Import', 'România']) {
      const res = normalizeBrand(ph, 'Produs alimentar ambalat 500g');
      assert.equal(res.normalizedBrand, null, `Placeholder "${ph}" trebuie să devină normalizedBrand = null`);
      assert.equal(res.brandQuality, 'placeholder', `Placeholder "${ph}" trebuie clasificat ca placeholder`);
      assert.equal(res.originalBrand, ph, 'Valoarea originală placeholder trebuie păstrată');
    }

    // Două produse complet diferite cu același brand placeholder NU se auto-fuzionează
    const prodA: Product = {
      id: 'ph-prod-a',
      name: 'Biscuiți cu cacao 200g',
      brand: 'Marcă Magazin',
      category: 'Alte produse',
      defaultUnit: 'buc',
      packageWeightOrVolume: 200,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      baseReferencePrice: 4.5
    };
    const matchPh = ProductMatcher.matchProduct(
      {
        rawName: 'Napolitane vanilie 200g',
        brand: 'Marcă Magazin',
        packageWeightOrVolume: 200,
        packageUnit: 'g'
      },
      [prodA]
    );
    assert.equal(matchPh.matchedProduct, undefined, 'Placeholder comun NU trebuie să provoace potrivire falsă');
    pass('2. Branduri placeholder clasificate sigur și excluse din bonusul de brand');
  }

  // --- SCENARIUL 3: Extragere conservatoare brand din titlu ---
  {
    const t1 = normalizeBrand(null, 'Milka Ciocolată cu lapte 100g');
    assert.equal(t1.normalizedBrand, 'Milka');
    assert.equal(t1.brandQuality, 'extracted_from_title');
    assert.ok(t1.confidence >= 0.85);

    const t2 = normalizeBrand('Marcă necunoscută', 'Alce Nero Paste bio fusilli 500g');
    assert.equal(t2.normalizedBrand, 'Alce Nero');
    assert.equal(t2.brandQuality, 'extracted_from_title');

    const tGeneric = normalizeBrand(undefined, 'Produs generic 500g');
    assert.equal(tGeneric.normalizedBrand, null);
    assert.equal(tGeneric.brandQuality, 'missing');
    pass('3. Extragere conservatoare a brandului din titlu fără halucinare');
  }

  // --- SCENARIUL 4: Normalizare gramaje (500 gr, 1,5 kg) ---
  {
    const p1 = normalizeQuantityAndMultipack({ rawTitle: 'Telemea de vacă 500 gr' });
    assert.equal(p1.packCount, 1);
    assert.equal(p1.normalizedMetricValue, 500);
    assert.equal(p1.normalizedMetricUnit, 'g');
    assert.equal(p1.totalQuantity, 500);
    assert.equal(p1.totalUnit, 'g');

    const p2 = normalizeQuantityAndMultipack({ rawTitle: 'Zahăr tos 1,5 kg' });
    assert.equal(p2.packCount, 1);
    assert.equal(p2.normalizedMetricValue, 1500);
    assert.equal(p2.normalizedMetricUnit, 'g');
    assert.equal(p2.totalQuantity, 1.5);
    assert.equal(p2.totalUnit, 'kg');
    pass('4. Normalizare gramaje 500 gr -> 500 g și 1,5 kg -> 1500 g');
  }

  // --- SCENARIUL 5: Conversii g / kg ---
  {
    const a = normalizeQuantityAndMultipack({ quantity: 500, unit: 'g', rawTitle: 'Cafea 500g' });
    const b = normalizeQuantityAndMultipack({ quantity: 0.5, unit: 'kg', rawTitle: 'Cafea 0,5 kg' });
    const cmp = compareNormalizedPackaging(a, b);
    assert.equal(cmp.comparable, true);
    assert.equal(cmp.totalQuantityMatch, true);
    assert.equal(cmp.exactStructureMatch, true);
    assert.equal(cmp.totalRatio, 1);
    pass('5. Conversii exacte g <-> kg (500 g == 0.5 kg)');
  }

  // --- SCENARIUL 6: Conversii ml / cl / l ---
  {
    const ml = normalizeQuantityAndMultipack({ rawTitle: 'Băutură 250 ml' });
    const l = normalizeQuantityAndMultipack({ rawTitle: 'Băutură 0.25 l' });
    assert.equal(ml.normalizedMetricValue, 250);
    assert.equal(l.normalizedMetricValue, 250);
    assert.equal(compareNormalizedPackaging(ml, l).totalQuantityMatch, true);

    const cl = normalizeQuantityAndMultipack({ rawTitle: 'Doză suc 33 cl' });
    assert.equal(cl.normalizedMetricValue, 330);
    assert.equal(cl.normalizedMetricUnit, 'ml');

    const l15 = normalizeQuantityAndMultipack({ rawTitle: 'Apă minerală 1,5 l' });
    assert.equal(l15.normalizedMetricValue, 1500);
    assert.equal(l15.normalizedMetricUnit, 'ml');
    pass('6. Conversii exacte ml / cl / l (250 ml == 0.25 l, 33 cl == 330 ml, 1.5 l == 1500 ml)');
  }

  // --- SCENARIUL 7: Parsare multipack + excludere dimensiuni fizice + multipack suspect ---
  {
    const mp1 = normalizeQuantityAndMultipack({ rawTitle: 'Paste făinoase 2 x 500 g' });
    assert.equal(mp1.packCount, 2);
    assert.equal(mp1.isMultipack, true);
    assert.equal(mp1.unitPackageQuantity, 500);
    assert.equal(mp1.unitPackageUnit, 'g');
    assert.equal(mp1.normalizedMetricValue, 1000);
    assert.equal(mp1.normalizedMetricUnit, 'g');
    assert.equal(mp1.packagingStructureKey, '2x500g');

    const mp2 = normalizeQuantityAndMultipack({ rawTitle: 'Apă plată 6x1L' });
    assert.equal(mp2.packCount, 6);
    assert.equal(mp2.unitPackageQuantity, 1);
    assert.equal(mp2.unitPackageUnit, 'l');
    assert.equal(mp2.normalizedMetricValue, 6000);
    assert.equal(mp2.normalizedMetricUnit, 'ml');

    const mp3 = normalizeQuantityAndMultipack({ rawTitle: 'Băutură carbogazoasă 4x0.33L' });
    assert.equal(mp3.packCount, 4);
    assert.equal(mp3.normalizedMetricValue, 1320);
    assert.equal(mp3.normalizedMetricUnit, 'ml');

    // Dimensiuni fizice NU trebuie parsate ca multipack alimentar
    const poolDim = PriceExtractor.extractPackagingSafely('Piscină supraterană 488 x 244 x 122 cm');
    assert.equal(poolDim.packCount, undefined);
    assert.equal(poolDim.packageQuantity, undefined);

    const razor = PriceExtractor.extractPackagingSafely('Aparat de ras cu 3 lame');
    assert.equal(razor.packCount, undefined);

    // Multipack suspect (> 48 unități)
    const suspect = normalizeQuantityAndMultipack({ rawTitle: 'Pachet 200 x 500g' });
    assert.equal(suspect.isSuspiciousMultipack, true);
    pass('7. Multipack-uri reale parsate corect; dimensiuni fizice și multipack-uri suspecte izolate');
  }

  // --- SCENARIUL 8: Cantitate totală echivalentă vs structură ambalaj (1x500g vs 2x250g vs 5x100g) ---
  {
    const p1x500 = normalizeQuantityAndMultipack({ rawTitle: 'Unt de masă 500g' });
    const p2x250 = normalizeQuantityAndMultipack({ rawTitle: 'Unt de masă 2 x 250g' });
    const p5x100 = normalizeQuantityAndMultipack({ rawTitle: 'Unt de masă 5 x 100g' });

    const cmp12 = compareNormalizedPackaging(p1x500, p2x250);
    assert.equal(cmp12.totalQuantityMatch, true);
    assert.equal(cmp12.exactStructureMatch, false);
    assert.equal(cmp12.differentStructureSameTotal, true);

    const cmp25 = compareNormalizedPackaging(p2x250, p5x100);
    assert.equal(cmp25.totalQuantityMatch, true);
    assert.equal(cmp25.differentStructureSameTotal, true);

    // ProductMatcher NU trebuie să auto-fuzioneze 2 x 250g cu 1 x 500g
    const baseProd500: Product = {
      id: 'unt-500g-single',
      name: 'Unt de masă Albalact 82% 500g',
      brand: 'Albalact',
      category: 'Lactate și ouă',
      defaultUnit: 'buc',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      baseReferencePrice: 28
    };
    const matchMulti = ProductMatcher.matchProduct(
      {
        rawName: 'Unt de masă Albalact 82% 2 x 250g',
        brand: 'Albalact'
      },
      [baseProd500]
    );
    assert.equal(matchMulti.matchedProduct, undefined, 'Structura 2x250g NU trebuie auto-fuzionată cu 1x500g');
    assert.ok(matchMulti.confidence <= 0.65, 'Scorul trebuie plafonat sub pragul automat 0.70');
    pass('8. Distincție clară între total echivalent și structură ambalaj (1x500g vs 2x250g vs 5x100g)');
  }

  // --- SCENARIUL 9: Produse la greutate variabilă ---
  {
    const vrac = normalizeQuantityAndMultipack({ rawTitle: 'Roșii Cherry vrac la kg', barcode: '2000000002501' });
    assert.equal(vrac.isVariableWeight, true);
    const fixed = normalizeQuantityAndMultipack({ rawTitle: 'Roșii Cherry caserolă 1 kg', quantity: 1, unit: 'kg', barcode: '5941014002343' });
    assert.equal(fixed.isVariableWeight, false);

    const cmpVar = compareNormalizedPackaging(vrac, fixed);
    assert.equal(cmpVar.comparable, false);
    assert.equal(cmpVar.variableWeightConflict, true);

    const fixedTomato: Product = {
      id: 'prod-rosii-fix',
      name: 'Roșii Cherry caserolă 1 kg',
      brand: 'Ferma',
      category: 'Fructe și legume',
      defaultUnit: 'kg',
      packageWeightOrVolume: 1,
      packageUnit: 'kg',
      normalizedUnit: 'kg',
      barcode: '5941014002343',
      baseReferencePrice: 12
    };
    const mVar = ProductMatcher.matchProduct(
      { rawName: 'Roșii Cherry vrac 1 kg', brand: 'Ferma', packageWeightOrVolume: 1, packageUnit: 'kg', barcode: '2000000002501' },
      [fixedTomato]
    );
    assert.equal(mVar.matchedProduct, undefined, 'Produs cu greutate variabilă (20..29 / vrac) NU se fuzionează cu ambalaj fix');
    pass('9. Produsele la greutate variabilă și codurile 20..29 sunt blocate de la auto-merge');
  }

  // --- SCENARIUL 10: Validare EAN-8, UPC-A, EAN-13, GTIN-14 GS1 Mod-10 & respingere invalide/sintetice ---
  {
    // EAN-13 valid
    const v13 = validateAndNormalizeBarcode('5941014002343');
    assert.equal(v13.format, 'EAN-13');
    assert.equal(v13.isValidCheckDigit, true);
    assert.equal(v13.quality, 'valid_universal');
    assert.equal(v13.isEligibleForAutoMatch, true);

    // EAN-8 valid: 2019481x? prefix 20 -> variable_weight_or_internal! Let's check 40170725 (valid EAN-8)
    assert.equal(computeGs1Mod10CheckDigit('4017072'), 5);
    const v8 = validateAndNormalizeBarcode('40170725');
    assert.equal(v8.format, 'EAN-8');
    assert.equal(v8.isValidCheckDigit, true);
    assert.equal(v8.quality, 'valid_universal');

    // GTIN-14 valid: 0 + 5941014002343
    const v14 = validateAndNormalizeBarcode('05941014002343');
    assert.equal(v14.format, 'GTIN-14');
    assert.equal(v14.isValidCheckDigit, true);
    assert.equal(v14.quality, 'valid_universal');
    assert.ok(v14.normalizedEquivalentBarcodes.includes('5941014002343'));

    // Check digit invalid: 5941014002341
    const invCheck = validateAndNormalizeBarcode('5941014002341');
    assert.equal(invCheck.isValidCheckDigit, false);
    assert.equal(invCheck.quality, 'invalid_check_digit');
    assert.equal(invCheck.isEligibleForAutoMatch, false);
    assert.equal(isValidEanBarcode('5941014002341'), false);

    // Sintetic: 9999999999999
    const synth = validateAndNormalizeBarcode('9999999999999');
    assert.equal(synth.isSuspicious, true);
    assert.equal(synth.quality, 'suspicious');
    assert.equal(synth.isEligibleForAutoMatch, false);

    // Variable weight: 20194812 & 2800101000000
    const vw8 = validateAndNormalizeBarcode('20194812');
    assert.equal(vw8.quality, 'variable_weight_or_internal');
    assert.equal(vw8.isEligibleForAutoMatch, false);

    // Barcode invalid identic pe două produse NU trebuie să declanșeze gtin_exact
    const prodBadBc: Product = {
      id: 'bad-bc-prod',
      name: 'Biscuiți cu miere 200g',
      brand: 'BrandA',
      category: 'Alte produse',
      defaultUnit: 'buc',
      packageWeightOrVolume: 200,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '5941014002341',
      baseReferencePrice: 5
    };
    const matchBadBc = ProductMatcher.matchProduct(
      {
        rawName: 'Complet Alt Produs Detergent',
        barcode: '5941014002341'
      },
      [prodBadBc]
    );
    assert.notEqual(matchBadBc.matchMethod, 'gtin_exact', 'Barcode cu check digit invalid NU declanșează gtin_exact');
    assert.equal(matchBadBc.matchedProduct, undefined);
    pass('10. Validare GS1 Mod-10 (EAN-8, UPC-A, EAN-13, GTIN-14) și blocare coduri invalide/sintetice/20..29');
  }

  // --- SCENARIUL 11: Echivalență UPC-A <-> EAN-13 (012345678905 <-> 0012345678905) ---
  {
    const upc = validateAndNormalizeBarcode('012345678905');
    const ean13 = validateAndNormalizeBarcode('0012345678905');
    assert.equal(upc.format, 'UPC-A');
    assert.equal(upc.isEligibleForAutoMatch, true);
    assert.equal(upc.normalizedGtin13, '0012345678905');
    assert.ok(upc.normalizedEquivalentBarcodes.includes('0012345678905'));
    assert.ok(ean13.normalizedEquivalentBarcodes.includes('012345678905'));

    // Invalid 12-digit code NU primește candidați normalizați
    const badUpc = validateAndNormalizeBarcode('012345678909');
    assert.equal(badUpc.isEligibleForAutoMatch, false);
    assert.deepEqual(normalizeValidatedBarcodeCandidates('012345678909'), []);

    const prodUpc: Product = {
      id: 'prod-upc-valid',
      name: 'Sos Barbeque Classic 350g',
      brand: 'Heinz',
      category: 'Produse de bază',
      defaultUnit: 'buc',
      packageWeightOrVolume: 350,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '0012345678905',
      baseReferencePrice: 14
    };
    const matchUpc = ProductMatcher.matchProduct(
      { rawName: 'Sos BBQ 350g', barcode: '012345678905' },
      [prodUpc]
    );
    assert.equal(matchUpc.matchMethod, 'gtin_exact');
    assert.equal(matchUpc.matchedProduct?.id, prodUpc.id);

    // BarcodeService expune barcodeValidation fără a rupe lookup-ul
    const lookupRes = lookupProductByBarcode({
      barcode: '012345678905',
      products: [prodUpc],
      offers: [],
      stores: STORES
    });
    assert.equal(lookupRes.found, true);
    assert.equal(lookupRes.barcodeValidation?.quality, 'valid_universal');
    pass('11. Echivalență UPC-A <-> EAN-13 strict validată GS1 (inclusiv în ProductMatcher și BarcodeService)');
  }

  // --- SCENARIUL 12: Variante distincte păstrate separat ---
  {
    const pairs: Array<[string, string, string]> = [
      ['Lapte Napolact 1.5% 1L', 'Lapte Napolact 3.5% 1L', 'Grăsime 1.5% vs 3.5%'],
      ['Cafea Jacobs Kronung Boabe 500g', 'Cafea Jacobs Kronung Măcinată 500g', 'Cafea boabe vs măcinată'],
      ['Cafea Lavazza Capsule 10 buc', 'Cafea Lavazza Boabe 10 buc', 'Cafea capsule vs boabe'],
      ['Bere Ursus 5% alcool 0.5L', 'Bere Ursus Fără alcool 0.5L', 'Cu alcool vs fără alcool'],
      ['Lapte Zuzu Fără Lactoză 1.5% 1L', 'Lapte Zuzu 1.5% 1L', 'Fără lactoză vs standard'],
      ['Cola Zero Zahăr 2L', 'Cola Clasic 2L', 'Fără zahăr/zero vs standard'],
      ['Iaurt cremos Căpșuni 150g', 'Iaurt cremos Vanilie 150g', 'Aromă căpșuni vs vanilie'],
      ['Pâine feliată albă 500g', 'Pâine feliată neagră 500g', 'Pâine albă vs neagră']
    ];

    for (const [titleA, titleB, label] of pairs) {
      const va = normalizeTitleAndVariants(titleA).variantAttributes;
      const vb = normalizeTitleAndVariants(titleB).variantAttributes;
      const cmp = areVariantAttributesCompatible(va, vb);
      assert.equal(cmp.compatible, false, `Variantele "${label}" trebuie declarate incompatibile`);

      const pA: Product = {
        id: 'var-a',
        name: titleA,
        brand: '',
        category: 'Produse de bază',
        defaultUnit: 'buc',
        packageWeightOrVolume: 1,
        packageUnit: 'buc',
        normalizedUnit: 'buc',
        baseReferencePrice: 10
      };
      const m = ProductMatcher.matchProduct({ rawName: titleB }, [pA]);
      assert.equal(m.matchedProduct, undefined, `ProductMatcher nu are voie să fuzioneze "${label}"`);
    }

    // Receipt matching respectă de asemenea incompatibilitatea de variante
    const receiptRes = matchReceiptItemsToCatalog(
      [
        {
          id: 'rec-item-var-1',
          rawName: 'LAPTE NAPOLACT 3.5% 1L',
          quantity: 1,
          unitPrice: 7.5,
          totalPrice: 7.5,
          discount: 0,
          confidence: 'high'
        }
      ],
      [
        {
          id: 'r-lapte-15',
          name: 'Lapte proaspăt Napolact 1.5% 1L',
          brand: 'Napolact',
          category: 'Lactate și ouă',
          defaultUnit: 'l',
          packageWeightOrVolume: 1,
          packageUnit: 'l',
          normalizedUnit: 'l',
          baseReferencePrice: 6.89
        }
      ]
    );
    assert.notEqual(receiptRes[0].matchedProductId, 'r-lapte-15', 'Bonul cu 3.5% NU se asociază la lapte 1.5%');
    pass('12. Toate variantele distincte (grăsime, cafea, alcool, lactoză, zahăr, arome, panificație) sunt separate strict');
  }

  // --- SCENARIUL 13: Date corupte OCR / subtitluri în brand și parser HTML Kaufland ---
  {
    const ocrTitle = normalizeTitleAndVariants('Lapt3 Napolact 5OOg Ofertă Săptămânii');
    assert.equal(ocrTitle.ocrCorrected, true);
    assert.equal(ocrTitle.promoStripped, true);
    assert.ok(ocrTitle.normalizedTitle.includes('lapte'));
    assert.ok(ocrTitle.normalizedTitle.includes('500 g'));

    const corruptBrand1 = normalizeBrand('40% alcool\n0,7 l', 'Vodka Absolut 40% 0,7 l');
    assert.equal(corruptBrand1.brandQuality, 'corrupt_or_non_brand');
    assert.equal(corruptBrand1.normalizedBrand, null);

    const corruptBrand2 = normalizeBrand('Bere blondă\n0,5 l', 'Bere blondă Timișoreana 0,5 l');
    assert.equal(corruptBrand2.brandQuality, 'extracted_from_title');
    assert.equal(corruptBrand2.normalizedBrand, 'Timișoreana');

    const kauflandHtml = `
      <html><body>
        <div class="k-product-tile">
          <div class="k-product-tile__subtitle">40% alcool\n0,7 l</div>
          <div class="k-product-tile__title">Vodka clasică 0.7 l</div>
          <div class="k-product-tile__unit-price">1 l = 71.41 lei</div>
          <div class="k-price-tag__price">49,99</div>
        </div>
        <div class="k-product-tile">
          <div class="k-product-tile__subtitle">Napolact</div>
          <div class="k-product-tile__title">Lapte proaspăt 1.5% 1 l</div>
          <div class="k-price-tag__price">6,49</div>
        </div>
      </body></html>
    `;
    const parsedKaufland = CatalogParserEngine.parseHtmlCatalog(kauflandHtml, 'kaufland', 'https://www.kaufland.ro/oferte');
    assert.equal(parsedKaufland.offers.length, 2);
    assert.equal(parsedKaufland.offers[0].rawBrand, undefined, 'Subtitlul corupt "40% alcool / 0,7 l" NU este salvat ca rawBrand');
    assert.equal(parsedKaufland.offers[1].rawBrand, 'Napolact', 'Brandul real Napolact este păstrat');
    pass('13. Datele corupte OCR și subtitlurile non-brand sunt curățate/izolate fără coruperea catalogului');
  }

  // --- SCENARIUL 14: Idempotență deterministă a normalizării ---
  {
    const sampleProd: Product = {
      id: 'idem-prod-1',
      name: 'Oferta Săptămânii Alce Nero Paste Bio 2 x 500 gr',
      brand: 'Marcă necunoscută',
      category: 'Produse de bază',
      defaultUnit: 'buc',
      packageWeightOrVolume: 500,
      packageUnit: 'g',
      normalizedUnit: 'kg',
      barcode: '0012345678905',
      baseReferencePrice: 18
    };
    const r1 = normalizeCatalogProduct(sampleProd);
    const r2 = normalizeCatalogProduct(sampleProd);
    assert.deepEqual(r1, r2, 'normalizeCatalogProduct trebuie să fie 100% determinist și idempotent');

    const b1 = normalizeBrand('  Pilos / Marcă proprie ', sampleProd.name);
    const b2 = normalizeBrand(b1.normalizedBrand, r1.title.cleanedTitle);
    assert.equal(b1.normalizedBrand, b2.normalizedBrand);

    const bc1 = validateAndNormalizeBarcode('012345678905');
    const bc2 = validateAndNormalizeBarcode(bc1.normalizedPrimaryBarcode);
    assert.equal(bc1.normalizedPrimaryBarcode, bc2.normalizedPrimaryBarcode);
    assert.equal(bc1.isEligibleForAutoMatch, bc2.isEligibleForAutoMatch);
    pass('14. Normalizarea este complet deterministă și idempotentă la rulări repetate');
  }

  // --- SCENARIUL 15: Păstrare date brute + Zero mutații pe DB / canonicalProductId / priceObservations + Endpoint Read-Only ---
  {
    // Verificare că StorageService nu a avut mutații neautorizate pe canonicalProductId și priceObservations
    const afterSnapshot = StorageService.getAllProducts().map(p => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      barcode: p.barcode,
      canonicalProductId: p.canonicalProductId ?? null
    }));
    assert.deepEqual(afterSnapshot, initialCanonicalSnapshot, 'Produsele și canonicalProductId NU au fost modificate');
    assert.equal(StorageService.getPriceObservations().length, initialObservationsCount, 'priceObservations NU a fost modificat');

    // Raport local read-only
    const report = generateCatalogQualityReport({
      products: [
        ...StorageService.getAllProducts(),
        {
          id: 'audit-corrupt-1',
          name: 'Produs',
          brand: '40% alcool\n0,7 l',
          category: 'Băuturi',
          defaultUnit: 'buc',
          packageWeightOrVolume: 1,
          packageUnit: 'buc',
          normalizedUnit: 'buc',
          barcode: '9999999999999',
          baseReferencePrice: 10
        }
      ],
      dataSource: 'custom_dataset',
      sampleLimit: 10
    });
    assert.equal(report.readOnlyVerified, true);
    assert.ok(report.summary.suspectOrCorruptBrandsCount >= 1);
    assert.ok(report.summary.productsWithSuspiciousBarcodeCount >= 1);
    assert.ok(report.summary.insufficientlyDescriptiveTitlesCount >= 1);

    // Endpoint admin read-only /api/admin/catalog-quality/report
    const dbReport = await DatabaseService.getCatalogQualityAuditReport({ sampleLimit: 5 });
    assert.equal(dbReport.readOnlyVerified, true);
    assert.equal(dbReport.dataSource, 'storage_service');

    const { app, ADMIN_API_KEY } = await import('../server.ts');
    const server = await new Promise<http.Server>(resolve => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    try {
      const addr = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const unauthRes = await fetch(`${baseUrl}/api/admin/catalog-quality/report`);
      assert.equal(unauthRes.status, 401, 'Endpointul audit calitate trebuie protejat cu requireAdminAuth');

      const badParamRes = await fetch(`${baseUrl}/api/admin/catalog-quality/report?sampleLimit=999`, {
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.equal(badParamRes.status, 400);

      const authRes = await fetch(`${baseUrl}/api/admin/catalog-quality/report?sampleLimit=8`, {
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}` }
      });
      assert.equal(authRes.status, 200);
      const body = (await authRes.json()) as any;
      assert.equal(body.success, true);
      assert.equal(body.report.readOnlyVerified, true);
      assert.ok(body.report.summary.totalProductsAnalyzed > 0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    pass('15. Date originale intacte, 0 mutații canonical_product_id/price_observations, API read-only protejat verificat');
  }

  console.log(`\n🎉 Suită FAZA 1A finalizată cu succes: ${passed}/15 grupuri de scenarii trecute!`);
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Eroare în suita Faza 1A:', err);
  process.exit(1);
});
