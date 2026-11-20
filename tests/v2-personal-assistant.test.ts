import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

process.env.NODE_ENV = 'test';

import { BudgetService, isConfirmedValidReceiptForBudget } from '../src/services/BudgetService.js';
import {
  ProductAlternativesService,
  areProductsCompatibleForSubstitution
} from '../src/services/ProductAlternativesService.js';
import {
  ShoppingAssistantService,
  classifyAssistantIntent
} from '../src/services/ShoppingAssistantService.js';
import {
  isValidBarcodeFormat,
  lookupProductByBarcode,
  normalizeBarcodeCandidates
} from '../src/services/BarcodeService.js';
import {
  budgetSettingsUpdateSchema,
  barcodeSuggestionCreateSchema,
  sharedListInviteCreateSchema
} from '../src/server/validation.js';
import type {
  Product,
  ProductOffer,
  Receipt,
  ShoppingList,
  Store
} from '../src/types.js';

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const FUTURE_DATE = '2099-12-31';
const PAST_DATE = '2024-01-01';

const STORES: Store[] = [
  {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    chain: 'Lidl',
    brandColor: 'bg-blue-700',
    accentColor: 'text-blue-700',
    type: 'discounter',
    rating: 4.6,
    locationsCount: 350,
    sampleAddress: 'România'
  },
  {
    id: 'kaufland',
    name: 'Kaufland',
    slug: 'kaufland',
    chain: 'Kaufland',
    brandColor: 'bg-red-700',
    accentColor: 'text-red-700',
    type: 'hypermarket',
    rating: 4.5,
    locationsCount: 170,
    sampleAddress: 'România'
  },
  {
    id: 'carrefour',
    name: 'Carrefour',
    slug: 'carrefour',
    chain: 'Carrefour',
    brandColor: 'bg-sky-700',
    accentColor: 'text-sky-700',
    type: 'hypermarket',
    rating: 4.4,
    locationsCount: 400,
    sampleAddress: 'România'
  },
  {
    id: 'penny',
    name: 'Penny',
    slug: 'penny',
    chain: 'Penny',
    brandColor: 'bg-amber-600',
    accentColor: 'text-amber-600',
    type: 'discounter',
    rating: 4.2,
    locationsCount: 380,
    sampleAddress: 'România'
  }
];

const TEST_PRODUCTS: Product[] = [
  {
    id: 'prod-lapte-zuzu-1l',
    name: 'Lapte Zuzu 3.5% grăsime 1L',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941265001012',
    baseReferencePrice: 7.49
  },
  {
    id: 'prod-lapte-zuzu-18l',
    name: 'Lapte Zuzu 3.5% grăsime 1.8L',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1.8,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941265001888',
    baseReferencePrice: 12.49
  },
  {
    id: 'prod-lapte-pilos-1l',
    name: 'Lapte Pilos 3.5% grăsime 1L',
    brand: 'Pilos',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5940001001111',
    baseReferencePrice: 5.49
  },
  {
    id: 'prod-lapte-olympus-1l',
    name: 'Lapte Olympus 3.5% grăsime 1L',
    brand: 'Olympus',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941265009999',
    baseReferencePrice: 7.99
  },
  {
    id: 'prod-telemea-vaca-350g',
    name: 'Telemea proaspătă de vacă 350g',
    brand: 'Hochland',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 350,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 14.99
  },
  {
    id: 'prod-hrana-pisici-lapte',
    name: 'Hrană umedă pisici pliculeț cu lapte 85g',
    brand: 'Whiskas',
    category: 'Alte produse',
    defaultUnit: 'buc',
    packageWeightOrVolume: 85,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 3.49
  },
  {
    id: 'prod-ciocolata-milka',
    name: 'Ciocolată cu lapte 100g',
    brand: 'Milka',
    category: 'Produse de bază',
    defaultUnit: 'buc',
    packageWeightOrVolume: 100,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 6.49
  },
  {
    id: 'prod-faina-boromir',
    name: 'Făină albă 000 1kg',
    brand: 'Boromir',
    category: 'Produse de bază',
    defaultUnit: 'buc',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '012345678905',
    baseReferencePrice: 4.29
  },
  {
    id: 'prod-paine-velpitar',
    name: 'Pâine albă feliată 600g',
    brand: 'Vel Pitar',
    category: 'Panificație',
    defaultUnit: 'buc',
    packageWeightOrVolume: 600,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 6.19
  },
  {
    id: 'prod-mere-idared',
    name: 'Mere roșii Idared 1kg',
    brand: 'România',
    category: 'Fructe și legume',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 5.99
  },
  {
    id: 'prod-piept-pui',
    name: 'Piept de pui dezosat 500g',
    brand: 'Agricola',
    category: 'Carne și pește',
    defaultUnit: 'buc',
    packageWeightOrVolume: 500,
    packageUnit: 'g',
    normalizedUnit: 'kg',
    baseReferencePrice: 17.99
  },
  {
    id: 'prod-detergent-ariel',
    name: 'Detergent lichid rufe 2L',
    brand: 'Ariel',
    category: 'Curățenie',
    defaultUnit: 'buc',
    packageWeightOrVolume: 2,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 54.99
  }
];

const TEST_OFFERS: ProductOffer[] = [
  {
    id: 'off-zuzu-kaufland',
    productId: 'prod-lapte-zuzu-1l',
    storeId: 'kaufland',
    price: 7.49,
    unitPrice: 7.49,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-zuzu-carrefour',
    productId: 'prod-lapte-zuzu-1l',
    storeId: 'carrefour',
    price: 6.99,
    originalPrice: 7.79,
    unitPrice: 6.99,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  // Expired offer must NEVER show in barcode or alternatives
  {
    id: 'off-zuzu-penny-expired',
    productId: 'prod-lapte-zuzu-1l',
    storeId: 'penny',
    price: 2.99,
    unitPrice: 2.99,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    validUntil: '2024-02-01',
    observationDate: '2024-01-15',
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: '2024-01-15'
  },
  // Larger package same brand
  {
    id: 'off-zuzu-18l-kaufland',
    productId: 'prod-lapte-zuzu-18l',
    storeId: 'kaufland',
    price: 11.7,
    unitPrice: 6.5,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  // Private label Lidl Pilos
  {
    id: 'off-pilos-lidl',
    productId: 'prod-lapte-pilos-1l',
    storeId: 'lidl',
    price: 5.19,
    originalPrice: 5.79,
    unitPrice: 5.19,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  // Alternative brand Olympus
  {
    id: 'off-olympus-carrefour',
    productId: 'prod-lapte-olympus-1l',
    storeId: 'carrefour',
    price: 6.79,
    unitPrice: 6.79,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  // Incompatible items in same/other categories
  {
    id: 'off-telemea-lidl',
    productId: 'prod-telemea-vaca-350g',
    storeId: 'lidl',
    price: 13.99,
    unitPrice: 39.97,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-pisici-lidl',
    productId: 'prod-hrana-pisici-lapte',
    storeId: 'lidl',
    price: 2.99,
    unitPrice: 35.18,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-ciocolata-lidl',
    productId: 'prod-ciocolata-milka',
    storeId: 'lidl',
    price: 5.99,
    unitPrice: 59.9,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-faina-lidl',
    productId: 'prod-faina-boromir',
    storeId: 'lidl',
    price: 3.99,
    unitPrice: 3.99,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-paine-lidl',
    productId: 'prod-paine-velpitar',
    storeId: 'lidl',
    price: 5.49,
    originalPrice: 6.49,
    unitPrice: 9.15,
    unitPriceMeasure: 'lei/kg',
    isPromo: true,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-mere-penny',
    productId: 'prod-mere-idared',
    storeId: 'penny',
    price: 4.99,
    unitPrice: 4.99,
    unitPriceMeasure: 'lei/kg',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-pui-kaufland',
    productId: 'prod-piept-pui',
    storeId: 'kaufland',
    price: 15.99,
    originalPrice: 18.99,
    unitPrice: 31.98,
    unitPriceMeasure: 'lei/kg',
    isPromo: true,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  },
  {
    id: 'off-detergent-lidl',
    productId: 'prod-detergent-ariel',
    storeId: 'lidl',
    price: 49.99,
    unitPrice: 25.0,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    validUntil: FUTURE_DATE,
    observationDate: TODAY,
    source: 'verified',
    confidenceLevel: 'high',
    verificationStatus: 'verified',
    lastChecked: TODAY
  }
];

async function runTests() {
  console.log('▶ Rulare suită completă Coșul Meu V2 (Personal Assistant)...');

  // =========================================================================
  // 1. PERSONAL BUDGET & RECEIPT FILTERING TESTS
  // =========================================================================
  {
    const refDate = new Date(NOW.getFullYear(), NOW.getMonth(), Math.min(20, NOW.getDate()));
    const refIso = refDate.toISOString().slice(0, 10);
    const prevMonthDate = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 10).toISOString().slice(0, 10);

    const receipts: Receipt[] = [
      {
        id: 'rec-confirmed-valid',
        storeId: 'lidl',
        storeName: 'Lidl',
        date: refIso,
        subtotal: 120.5,
        discountTotal: 0,
        total: 120.5,
        currency: 'RON',
        createdAt: refIso,
        verifiedStatus: 'confirmed',
        validationStatus: 'VALID',
        items: [
          { id: 'ri-1', rawName: 'Lapte Pilos 1L', matchedProductId: 'prod-lapte-pilos-1l', quantity: 2, unitPrice: 5.19, discount: 0, totalPrice: 10.38, confidence: 'high' },
          { id: 'ri-2', rawName: 'Piept de pui', matchedProductId: 'prod-piept-pui', quantity: 2, unitPrice: 15.99, discount: 0, totalPrice: 31.98, confidence: 'high' },
          { id: 'ri-3', rawName: 'Detergent Ariel', category: 'Curățenie', quantity: 1, unitPrice: 78.14, discount: 0, totalPrice: 78.14, confidence: 'high' }
        ]
      },
      {
        id: 'rec-confirmed-prev-month',
        storeId: 'kaufland',
        storeName: 'Kaufland',
        date: prevMonthDate,
        subtotal: 250.0,
        discountTotal: 0,
        total: 250.0,
        currency: 'RON',
        createdAt: prevMonthDate,
        verifiedStatus: 'confirmed',
        validationStatus: 'VALID',
        items: []
      },
      // MUST BE EXCLUDED: draft receipt
      {
        id: 'rec-draft',
        storeId: 'carrefour',
        storeName: 'Carrefour',
        date: refIso,
        subtotal: 999.0,
        discountTotal: 0,
        total: 999.0,
        currency: 'RON',
        createdAt: refIso,
        verifiedStatus: 'draft',
        validationStatus: 'NEEDS_REVIEW',
        items: []
      },
      // MUST BE EXCLUDED: INVALID validationStatus even if verifiedStatus is confirmed
      {
        id: 'rec-invalid',
        storeId: 'penny',
        storeName: 'Penny',
        date: refIso,
        subtotal: 500.0,
        discountTotal: 0,
        total: 500.0,
        currency: 'RON',
        createdAt: refIso,
        verifiedStatus: 'confirmed',
        validationStatus: 'INVALID',
        items: []
      },
      // MUST BE EXCLUDED: status='failed'
      Object.assign(
        {
          id: 'rec-failed',
          storeId: 'lidl',
          storeName: 'Lidl',
          date: refIso,
          subtotal: 300.0,
          discountTotal: 0,
          total: 300.0,
          currency: 'RON' as const,
          createdAt: refIso,
          verifiedStatus: 'confirmed' as const,
          validationStatus: 'VALID' as const,
          items: []
        },
        { status: 'failed' }
      )
    ];

    assert.equal(isConfirmedValidReceiptForBudget(receipts[0]), true, 'Confirmed valid receipt should count');
    assert.equal(isConfirmedValidReceiptForBudget(receipts[2]), false, 'Draft receipt must be excluded');
    assert.equal(isConfirmedValidReceiptForBudget(receipts[3]), false, 'INVALID receipt must be excluded');
    assert.equal(isConfirmedValidReceiptForBudget(receipts[4]), false, 'Failed receipt must be excluded');

    const warningSummary = BudgetService.calculateSummary({
      receipts,
      settings: { monthlyBudget: 150, weeklyBudget: 100, alertThresholdPct: 80 },
      catalogProducts: TEST_PRODUCTS,
      referenceDate: refDate
    });

    assert.equal(warningSummary.monthlySpent, 120.5, 'Monthly spend should only include current month confirmed valid receipt');
    assert.equal(warningSummary.confirmedReceiptsCount, 2);
    assert.equal(warningSummary.excludedReceiptsCount, 3);
    assert.equal(warningSummary.monthlyAlertLevel, 'warning', '120.5/150 = 80.33% >= 80% should trigger warning');
    assert.equal(warningSummary.weeklyAlertLevel, 'exceeded', '120.5 > 100 weekly budget should trigger exceeded');
    assert.equal(warningSummary.monthlyHistory.length, 6, 'Should return 6-month history window');
    assert.ok(warningSummary.categoryBreakdown.some(c => c.category === 'Lactate și ouă' && c.amount === 10.38));

    const thresholdSchemaCheck = budgetSettingsUpdateSchema.safeParse({
      monthlyBudget: 1500,
      weeklyBudget: 400,
      alertThresholdPct: 85
    });
    assert.equal(thresholdSchemaCheck.success, true);

    const invalidBudgetCheck = budgetSettingsUpdateSchema.safeParse({
      monthlyBudget: -10,
      weeklyBudget: 400,
      alertThresholdPct: 85
    });
    assert.equal(invalidBudgetCheck.success, false, 'Negative budget must fail Zod validation');
    console.log('✓ 1. Personal Budget & Confirmed vs Error Receipt Exclusion OK');
  }

  // =========================================================================
  // 2. PRODUCT ALTERNATIVES, NORMALIZED PRICE & COMPATIBILITY GUARD TESTS
  // =========================================================================
  {
    // Compatibility unit tests
    assert.equal(
      areProductsCompatibleForSubstitution(TEST_PRODUCTS[0], TEST_PRODUCTS[4]).compatible,
      false,
      'Milk (Lapte) and Cheese (Telemea) must NOT be compatible direct substitutions'
    );
    assert.equal(
      areProductsCompatibleForSubstitution(TEST_PRODUCTS[0], TEST_PRODUCTS[5]).compatible,
      false,
      'Milk and Cat food mentioning milk must NOT be compatible'
    );
    assert.equal(
      areProductsCompatibleForSubstitution(TEST_PRODUCTS[6], TEST_PRODUCTS[7]).compatible,
      false,
      'Chocolate and Flour in same category must NOT be compatible'
    );
    assert.equal(
      areProductsCompatibleForSubstitution(TEST_PRODUCTS[0], TEST_PRODUCTS[2]).compatible,
      true,
      'Zuzu Milk 1L and Pilos Milk 1L must be compatible'
    );

    const altResult = ProductAlternativesService.getAlternatives({
      targetProduct: TEST_PRODUCTS[0],
      allProducts: TEST_PRODUCTS,
      allOffers: TEST_OFFERS,
      stores: STORES,
      useLoyaltyCards: true
    });

    assert.ok(altResult, 'Alternatives result should be returned');
    assert.equal(altResult.referenceNormalizedUnitLabel, 'lei/l');
    assert.equal(altResult.referenceNormalizedUnitPrice, 6.99, 'Lowest valid offer for Zuzu 1L is Carrefour 6.99 (expired Penny 2.99 excluded)');

    // Same product other retailer: Kaufland 7.49 (Carrefour is baseline 6.99, Penny expired must be excluded)
    assert.equal(altResult.groups.same_product_other_retailer.length, 1);
    assert.equal(altResult.groups.same_product_other_retailer[0].store.id, 'kaufland');

    // Same product other size: Zuzu 1.8L at 6.50 lei/l
    assert.equal(altResult.groups.same_product_other_size.length, 1);
    assert.equal(altResult.groups.same_product_other_size[0].product.id, 'prod-lapte-zuzu-18l');
    assert.equal(altResult.groups.same_product_other_size[0].normalizedUnitPrice, 6.5);

    // Private label: Pilos 1L at 5.19 lei/l
    assert.equal(altResult.groups.private_label.length, 1);
    assert.equal(altResult.groups.private_label[0].product.id, 'prod-lapte-pilos-1l');
    assert.equal(altResult.groups.private_label[0].isCheaperNormalized, true);

    // Alternative brand: Olympus 1L at 6.79 lei/l
    assert.equal(altResult.groups.alternative_brand.length, 1);
    assert.equal(altResult.groups.alternative_brand[0].product.id, 'prod-lapte-olympus-1l');

    // Incompatible items strictly absent across all groups
    const allReturnedIds = Object.values(altResult.groups)
      .flat()
      .map(r => r.product.id);
    assert.equal(allReturnedIds.includes('prod-telemea-vaca-350g'), false);
    assert.equal(allReturnedIds.includes('prod-hrana-pisici-lapte'), false);
    assert.equal(allReturnedIds.includes('prod-detergent-ariel'), false);
    console.log('✓ 2. Product Alternatives, Normalized Price Ranking & Compatibility Guard OK');
  }

  // =========================================================================
  // 3. SHARED LISTS, ROLES, RLS SQL AUDIT & REALTIME CONFIG TESTS
  // =========================================================================
  {
    const migrationPath = path.resolve(process.cwd(), 'src/db/migrations/013_v2_personal_assistant.sql');
    assert.equal(fs.existsSync(migrationPath), true, 'Migration 013 SQL file must exist');
    const rawSql = fs.readFileSync(migrationPath, 'utf-8');
    const sqlNoComments = rawSql.replace(/--.*$/gm, '');

    assert.equal(/\bDROP\s+TABLE\b/i.test(sqlNoComments), false, 'Migration 013 must never DROP TABLE');
    assert.equal(/\bTRUNCATE\b/i.test(sqlNoComments), false, 'Migration 013 must never TRUNCATE');

    assert.ok(sqlNoComments.includes('is_shopping_list_owner'), 'Must define recursion-free owner helper');
    assert.ok(sqlNoComments.includes('can_access_shopping_list'), 'Must define recursion-free access helper');
    assert.ok(sqlNoComments.includes('can_edit_shopping_list'), 'Must define recursion-free edit helper');
    assert.ok(sqlNoComments.includes("slm.role IN ('owner', 'editor')"), 'Only owner and editor can mutate shared list items (viewer excluded)');
    assert.ok(sqlNoComments.includes('ENABLE ROW LEVEL SECURITY'), 'Must enable RLS on collaboration & barcode tables');
    assert.ok(sqlNoComments.includes('supabase_realtime'), 'Must add shared list tables to supabase_realtime publication');
    assert.ok(sqlNoComments.includes('product_barcode_suggestions'), 'Must create product_barcode_suggestions moderation table');
    assert.ok(sqlNoComments.includes("'pending'"), 'Suggestions must default to pending moderation status');

    const inviteValid = sharedListInviteCreateSchema.safeParse({ role: 'viewer', maxUses: 3, expiresHours: 48 });
    assert.equal(inviteValid.success, true);
    const inviteInvalidOwner = sharedListInviteCreateSchema.safeParse({ role: 'owner' });
    assert.equal(inviteInvalidOwner.success, false, 'Owner role cannot be granted via open invite link');
    console.log('✓ 3. Shared Lists SQL RLS, Roles & Realtime Schema Audit OK');
  }

  // =========================================================================
  // 4. BARCODE SCAN LOOKUP & MODERATION SUGGESTION TESTS
  // =========================================================================
  {
    const variants = normalizeBarcodeCandidates('012345678905');
    assert.ok(variants.includes('012345678905'));
    assert.ok(variants.includes('0012345678905'), '12-digit UPC-A must expand to 13-digit leading-zero EAN');
    assert.equal(isValidBarcodeFormat('5941265001012'), true);
    assert.equal(isValidBarcodeFormat('123'), false);

    // Exact EAN-13 match filters expired offer (Penny 2.99) and ranks Carrefour 6.99 first
    const foundMilk = lookupProductByBarcode({
      barcode: '5941265001012',
      products: TEST_PRODUCTS,
      offers: TEST_OFFERS,
      stores: STORES
    });
    assert.equal(foundMilk.found, true);
    assert.equal(foundMilk.product?.id, 'prod-lapte-zuzu-1l');
    assert.equal(foundMilk.lowestPrice, 6.99);
    assert.equal(foundMilk.offers.length, 2, 'Expired Penny offer must not appear');

    // UPC-A <-> EAN-13 cross-format lookup
    const foundFlourViaEan13 = lookupProductByBarcode({
      barcode: '0012345678905',
      products: TEST_PRODUCTS,
      offers: TEST_OFFERS,
      stores: STORES
    });
    assert.equal(foundFlourViaEan13.found, true);
    assert.equal(foundFlourViaEan13.product?.id, 'prod-faina-boromir');

    // Unknown barcode returns found: false gracefully
    const notFound = lookupProductByBarcode({
      barcode: '5949999999994',
      products: TEST_PRODUCTS,
      offers: TEST_OFFERS,
      stores: STORES
    });
    assert.equal(notFound.found, false);
    assert.equal(notFound.offers.length, 0);

    const suggOk = barcodeSuggestionCreateSchema.safeParse({
      barcode: '5949999999994',
      proposedName: 'Iaort Grecesc 400g',
      proposedCategory: 'Lactate și ouă',
      observedPrice: 9.5
    });
    assert.equal(suggOk.success, true);

    const suggBad = barcodeSuggestionCreateSchema.safeParse({
      barcode: 'abc',
      proposedName: 'X'
    });
    assert.equal(suggBad.success, false);
    console.log('✓ 4. Barcode Lookup, Leading-Zero Variants & Suggestion Validation OK');
  }

  // =========================================================================
  // 5. AI ASSISTANT GROUNDING, 5 CORE INTENTS, EMPTY/INCOMPLETE DATA & ANTI-HALLUCINATION
  // =========================================================================
  {
    const sampleList: ShoppingList = {
      id: 'list-test-1',
      name: 'Lista Săptămânală',
      createdAt: TODAY,
      updatedAt: TODAY,
      items: [
        {
          id: 'item-1',
          productId: 'prod-lapte-zuzu-1l',
          name: 'Lapte Zuzu 3.5% grăsime 1L',
          brand: 'Zuzu',
          category: 'Lactate și ouă',
          quantity: 2,
          unit: 'buc',
          checked: false
        },
        {
          id: 'item-2',
          productId: 'prod-piept-pui',
          name: 'Piept de pui dezosat 500g',
          brand: 'Agricola',
          category: 'Carne și pește',
          quantity: 1,
          unit: 'buc',
          checked: false
        },
        {
          id: 'item-3',
          name: 'Produs necunoscut fără preț catalog',
          category: 'Alte produse',
          quantity: 1,
          unit: 'buc',
          checked: false
        }
      ]
    };

    // 5a. Budget basket "Ce pot cumpăra cu 200 lei?"
    const budgetIntent = classifyAssistantIntent({ prompt: 'Ce pot cumpăra cu 200 lei?' });
    assert.equal(budgetIntent.intent, 'budget_basket');
    assert.equal(budgetIntent.budgetLei, 200);

    const budgetPlan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: 'Ce pot cumpăra cu 200 lei?',
      allProducts: TEST_PRODUCTS,
      allOffers: TEST_OFFERS,
      allStores: STORES,
      useLoyaltyCards: true
    });
    assert.equal(budgetPlan.intent, 'budget_basket');
    assert.ok(budgetPlan.items.length > 0);
    assert.ok(budgetPlan.totalEstimatedCost <= 200, 'Budget plan must never exceed requested 200 lei');
    const catalogIds = new Set(TEST_PRODUCTS.map(p => p.id));
    for (const item of budgetPlan.items) {
      assert.ok(catalogIds.has(item.productId), 'Every suggested item must belong to real catalog');
    }

    // 5b. Optimize list
    const optPlan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: 'Optimizează lista mea.',
      activeList: sampleList,
      allProducts: TEST_PRODUCTS,
      allOffers: TEST_OFFERS,
      allStores: STORES
    });
    assert.equal(optPlan.intent, 'optimize_list');
    assert.ok(optPlan.optimizationSummary);
    assert.ok(optPlan.limitations.length > 0, 'Unmatched item without price must produce explicit limitation note');

    // 5c. List promos
    const promoPlan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: 'Ce produse din lista mea sunt la reducere?',
      activeList: sampleList,
      allProducts: TEST_PRODUCTS,
      allOffers: TEST_OFFERS,
      allStores: STORES
    });
    assert.equal(promoPlan.intent, 'list_promos');
    assert.ok(promoPlan.items.some(i => i.isPromo && i.productId === 'prod-lapte-zuzu-1l'));

    // 5d. Cheaper alternatives
    const altPlan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: 'Găsește alternative mai ieftine.',
      activeList: sampleList,
      allProducts: TEST_PRODUCTS,
      allOffers: TEST_OFFERS,
      allStores: STORES
    });
    assert.equal(altPlan.intent, 'cheaper_alternatives');
    assert.ok(altPlan.items.some(i => i.productId === 'prod-lapte-pilos-1l'));

    // 5e. 5-day meal/shopping plan
    const daysPlan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: 'Planifică cumpărăturile pentru 5 zile.',
      allProducts: TEST_PRODUCTS,
      allOffers: TEST_OFFERS,
      allStores: STORES
    });
    assert.equal(daysPlan.intent, 'meal_plan_days');
    assert.equal(daysPlan.daysRequested, 5);
    assert.ok(daysPlan.items.length > 0);

    // 5f. Empty catalog (0 products) MUST NOT fabricate any products or prices
    const emptyPlan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: 'Ce pot cumpăra cu 200 lei?',
      allProducts: [],
      allOffers: [],
      allStores: STORES
    });
    assert.equal(emptyPlan.items.length, 0);
    assert.equal(emptyPlan.totalEstimatedCost, 0);
    assert.ok(emptyPlan.limitations.length > 0);

    // 5g. Anti-hallucination validator blocks fabricated product IDs
    const halluCheck = ShoppingAssistantService.validateAiOutputAgainstPlan({
      plan: budgetPlan,
      aiPayload: {
        answerRo: 'Îți recomand Produsul Inventat 999.',
        highlights: ['Produs Inventat - 1 leu'],
        citedProductIds: ['prod-inventat-fake-999']
      }
    });
    assert.equal(halluCheck.valid, false);
    assert.equal(halluCheck.hallucinationDetected, true);
    assert.ok(
      !halluCheck.verifiedProductIds.includes('prod-inventat-fake-999'),
      'Fallback must only return verified catalog product IDs'
    );
    console.log('✓ 5. AI Assistant Deterministic Plans, 0-Product Guard & Anti-Hallucination OK');
  }

  // =========================================================================
  // 6. BACKEND API ENDPOINT TESTS (REAL EXPRESS APP)
  // =========================================================================
  {
    const { app } = await import('../server.js');
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 6a. Personal Budget Auth Guard
      const unauthBudgetGet = await fetch(`${baseUrl}/api/budget/summary`);
      assert.equal(unauthBudgetGet.status, 401, 'GET /api/budget/summary without token must return 401');

      const unauthBudgetPatch = await fetch(`${baseUrl}/api/budget/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyBudget: 1500, weeklyBudget: 400, alertThresholdPct: 80 })
      });
      assert.equal(unauthBudgetPatch.status, 401, 'PATCH /api/budget/settings without token must return 401');

      // 6b. Shared Lists Auth Guard
      const fakeListUuid = '11111111-1111-4111-8111-111111111111';
      const unauthCollab = await fetch(`${baseUrl}/api/lists/${fakeListUuid}/collaboration`);
      assert.equal(unauthCollab.status, 401);

      const unauthInvite = await fetch(`${baseUrl}/api/lists/${fakeListUuid}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'editor' })
      });
      assert.equal(unauthInvite.status, 401);

      const unauthAccept = await fetch(`${baseUrl}/api/lists/invites/some-token-12345/accept`, {
        method: 'POST'
      });
      assert.equal(unauthAccept.status, 401);

      const unauthActivity = await fetch(`${baseUrl}/api/lists/${fakeListUuid}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'item_added', itemName: 'Lapte' })
      });
      assert.equal(unauthActivity.status, 401);

      // 6c. Product Alternatives API
      const alt404 = await fetch(`${baseUrl}/api/products/prod-nonexistent-xyz/alternatives`);
      assert.equal(alt404.status, 404);

      const catalogListRes = await fetch(`${baseUrl}/api/products?limit=2`);
      const catalogListData = (await catalogListRes.json()) as any;
      const realProductId = catalogListData?.products?.[0]?.id;
      assert.ok(realProductId, 'Catalog endpoint should return at least 1 product');

      const altOk = await fetch(`${baseUrl}/api/products/${encodeURIComponent(realProductId)}/alternatives`);
      assert.equal(altOk.status, 200);
      const altOkJson = (await altOk.json()) as any;
      assert.equal(altOkJson.success, true);
      assert.ok(altOkJson.alternatives?.groups, 'Alternatives endpoint should return grouped recommendations');

      // 6d. Barcode Lookup API
      const badBarcodeRes = await fetch(`${baseUrl}/api/catalog/barcode/12`);
      assert.equal(badBarcodeRes.status, 400);

      const unknownBarcodeRes = await fetch(`${baseUrl}/api/catalog/barcode/5949999999994`);
      assert.equal(unknownBarcodeRes.status, 200);
      const unknownBarcodeJson = (await unknownBarcodeRes.json()) as any;
      assert.equal(unknownBarcodeJson.found, false);

      // 6e. Barcode Suggestion API: never auto-publishes into catalog!
      const countBeforeRes = await fetch(`${baseUrl}/api/products?limit=1`);
      const countBeforeJson = (await countBeforeRes.json()) as any;
      const totalBefore = Number(countBeforeJson.totalCount || 0);

      const badSuggestionRes = await fetch(`${baseUrl}/api/products/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: '123', proposedName: '' })
      });
      assert.equal(badSuggestionRes.status, 400);

      const validSuggestionRes = await fetch(`${baseUrl}/api/products/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode: '5949999999994',
          proposedName: 'Produs Test Moderare 500g',
          proposedBrand: 'TestBrand',
          proposedCategory: 'Produse de bază',
          packageWeightOrVolume: 500,
          packageUnit: 'g',
          observedPrice: 8.99
        })
      });
      assert.equal(validSuggestionRes.status, 201);
      const validSuggestionJson = (await validSuggestionRes.json()) as any;
      assert.equal(validSuggestionJson.success, true);
      assert.equal(validSuggestionJson.suggestion?.status, 'pending');
      assert.equal(validSuggestionJson.autoPublished, false);

      const countAfterRes = await fetch(`${baseUrl}/api/products?limit=1`);
      const countAfterJson = (await countAfterRes.json()) as any;
      assert.equal(
        Number(countAfterJson.totalCount || 0),
        totalBefore,
        'Submitting a barcode suggestion MUST NOT auto-publish into catalog'
      );

      // 6f. AI Assistant API validation & missing GEMINI_API_KEY honest handling
      const badPromptRes = await fetch(`${baseUrl}/api/assistant/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '' })
      });
      assert.equal(badPromptRes.status, 400);

      const invalidBearerRes = await fetch(`${baseUrl}/api/assistant/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid.jwt.token'
        },
        body: JSON.stringify({ prompt: 'Ce pot cumpăra cu 200 lei?' })
      });
      assert.equal(invalidBearerRes.status, 401);

      const savedGeminiKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      try {
        const noKeyRes = await fetch(`${baseUrl}/api/assistant/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Ce pot cumpăra cu 200 lei?' })
        });
        assert.equal(noKeyRes.status, 503, 'Missing GEMINI_API_KEY must return 503 AI_UNAVAILABLE');
        const noKeyJson = (await noKeyRes.json()) as any;
        assert.equal(noKeyJson.code, 'AI_UNAVAILABLE');
        assert.ok(noKeyJson.deterministicPlan, '503 response still returns honest deterministic grounded plan');
        assert.equal(noKeyJson.deterministicPlan.intent, 'budget_basket');
      } finally {
        if (savedGeminiKey !== undefined) {
          process.env.GEMINI_API_KEY = savedGeminiKey;
        }
      }

      console.log('✓ 6. Backend V2 Express API Endpoints, Auth Guards & Error Handling OK');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  console.log('✅ Toate testele V2 (Personal Assistant) au trecut cu succes!');
}

runTests().catch(err => {
  console.error('❌ Eșec în suita V2:', err);
  process.exit(1);
});
