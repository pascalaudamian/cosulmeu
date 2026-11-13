import { PriceComparisonService } from '../src/services/PriceComparisonService';
import { OptimizationService } from '../src/services/OptimizationService';
import { ShoppingListItem } from '../src/types';

function runTests() {
  console.log('🧪 Rulare teste unitare pentru Coșul Meu...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // Test 1: formatRon formats Romanian currency with comma
  const formatted = PriceComparisonService.formatRon(14.5);
  assert(formatted === '14,50 lei', `formatRon(14.5) returnează "14,50 lei" (obținut: "${formatted}")`);

  // Test 2: formatRon handles 0 and invalid numbers safely without NaN
  const zeroFormatted = PriceComparisonService.formatRon(0);
  const nanFormatted = PriceComparisonService.formatRon(NaN);
  assert(zeroFormatted === '0,00 lei', 'formatRon(0) este "0,00 lei"');
  assert(nanFormatted === '0,00 lei', 'formatRon(NaN) este protejat și returnează "0,00 lei"');

  // Test 3: formatQuantity
  const qtyStr = PriceComparisonService.formatQuantity(1.5, 'kg');
  assert(qtyStr === '1,5 kg', `formatQuantity(1.5, 'kg') returnează "1,5 kg" (obținut: "${qtyStr}")`);

  // Test 4: Basket comparison handles empty basket safely
  const emptyComp = PriceComparisonService.compareBasketAcrossStores([]);
  assert(Array.isArray(emptyComp) && emptyComp.length === 0, 'compareBasketAcrossStores([]) returnează array gol');

  // Test 5: Basket comparison with known items
  const testItems: ShoppingListItem[] = [
    {
      id: 'test-1',
      productId: 'prod-lapte-1',
      name: 'Lapte proaspăt 1.5% grăsime 1L',
      category: 'Lactate și ouă',
      quantity: 2,
      unit: 'l',
      checked: false,
      referencePrice: 6.89,
      estimatedPrice: 6.29
    },
    {
      id: 'test-2',
      productId: 'prod-oua-m10',
      name: 'Ouă proaspete M 10 buc',
      category: 'Lactate și ouă',
      quantity: 1,
      unit: 'buc',
      checked: false,
      referencePrice: 11.49,
      estimatedPrice: 9.99
    }
  ];

  const comps = PriceComparisonService.compareBasketAcrossStores(testItems);
  assert(comps.length > 0, `Au fost returnate comparații pentru ${comps.length} magazine`);
  assert(comps[0].isWinner === true, 'Primul magazin este marcat ca câștigător');
  assert(comps[0].grandTotal <= comps[comps.length - 1].grandTotal, 'Magazinele sunt ordonate crescător după total');
  assert(comps[0].savingsVsWorst >= 0, 'Economia față de cel mai scump magazin este pozitivă sau zero');

  // Test 6: Optimization logic with travel cost
  const optWithFreeTransport = OptimizationService.optimizeBasket(testItems, 0);
  assert(optWithFreeTransport.multiStoreTotal <= optWithFreeTransport.singleStoreWinner!.grandTotal, 'Coșul împărțit fără transport este mai ieftin sau egal cu magazinul unic');

  const optWithHighTransport = OptimizationService.optimizeBasket(testItems, 100);
  assert(optWithHighTransport.isSplitRecommended === false, 'Cu un cost de transport nerealist de mare (100 lei), împărțirea coșului NU este recomandată');

  // Test 7: DB catalog products (not in mockData) with uppercase normalizedUnit & normalized store IDs
  const customProduct = {
    id: 'prod-db-lapte-custom',
    name: 'Lapte proaspăt DB Test 1L',
    brand: 'TestDairy',
    category: 'Lactate și ouă' as const,
    defaultUnit: 'buc' as const,
    packageWeightOrVolume: 1,
    packageUnit: 'l' as const,
    normalizedUnit: 'L' as any,
    barcode: '5949999000111',
    baseReferencePrice: 7.49
  };
  const customOffers = [
    {
      id: 'off-db-1',
      productId: 'prod-db-lapte-custom',
      storeId: 'lidl',
      price: 6.29,
      unitPrice: 6.29,
      unitPriceMeasure: 'lei/l' as const,
      isPromo: true,
      observationDate: new Date().toISOString().slice(0, 10),
      source: 'official_feed' as const,
      confidenceLevel: 'high' as const,
      verificationStatus: 'verified' as const,
      lastChecked: new Date().toISOString()
    },
    {
      id: 'off-db-2',
      productId: 'prod-db-lapte-custom',
      storeId: 'store-kaufland',
      price: 6.79,
      unitPrice: 6.79,
      unitPriceMeasure: 'lei/l' as const,
      isPromo: false,
      observationDate: new Date().toISOString().slice(0, 10),
      source: 'official_feed' as const,
      confidenceLevel: 'high' as const,
      verificationStatus: 'verified' as const,
      lastChecked: new Date().toISOString()
    }
  ];
  const customStores = [
    {
      id: 'lidl',
      name: 'Lidl România',
      slug: 'lidl',
      chain: 'Lidl',
      brandColor: 'bg-blue-700',
      accentColor: 'text-blue-700',
      type: 'discounter' as const,
      rating: 4.5,
      locationsCount: 350,
      sampleAddress: 'România'
    },
    {
      id: 'kaufland',
      name: 'Kaufland România',
      slug: 'kaufland',
      chain: 'Kaufland',
      brandColor: 'bg-red-700',
      accentColor: 'text-red-700',
      type: 'hypermarket' as const,
      rating: 4.6,
      locationsCount: 170,
      sampleAddress: 'România'
    }
  ];
  const dbListItem: ShoppingListItem = {
    id: 'item-db-1',
    productId: customProduct.id,
    name: customProduct.name,
    brand: customProduct.brand,
    category: customProduct.category,
    quantity: 500,
    unit: 'ml',
    checked: false,
    barcode: customProduct.barcode,
    referencePrice: customProduct.baseReferencePrice,
    estimatedPrice: customProduct.baseReferencePrice
  };
  const customComps = PriceComparisonService.compareBasketAcrossStores(
    [dbListItem],
    { useLoyaltyCards: true },
    [customProduct],
    customOffers,
    customStores
  );
  assert(customComps.length === 2, 'compareBasketAcrossStores folosește magazinele custom');
  assert(
    customComps[0].store.id === 'lidl' && customComps[0].grandTotal === 3.15,
    `Normalizare unitate ml -> L și preț 500ml la Lidl (obținut: ${customComps[0]?.store.id} ${customComps[0]?.grandTotal})`
  );
  assert(
    customComps[1].store.id === 'kaufland' && customComps[1].availableItems.length === 1,
    'storeId "store-kaufland" se potrivește cu magazinul canonic "kaufland"'
  );
  const customOpt = OptimizationService.optimizeBasket([dbListItem], 6, [customProduct], customOffers, customStores);
  assert(
    customOpt.singleStoreWinner?.store.id === 'lidl',
    'OptimizationService identifică magazinul optim din catalogul custom'
  );

  console.log(`\n🎉 Rezumat teste: ${passed} trecute, ${failed} eșuate.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
