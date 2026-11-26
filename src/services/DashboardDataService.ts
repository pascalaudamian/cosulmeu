import type {
  ConfidenceLevel,
  InAppPriceNotification,
  PersonalBudgetSettings,
  PriceAlert,
  PriceAlertRearmState,
  PriceAlertTriggerEvent,
  PriceAlertType,
  PriceDataQualityStatus,
  PriceHistoryInterval,
  Product,
  ProductOffer,
  Receipt,
  ReceiptItem,
  SharedListActivityEntry,
  SharedListMember,
  SharedListRole,
  ShoppingList,
  ShoppingListItem,
  Store,
  UnitType,
  UserPriceObservation,
  VerificationStatus
} from '../types.js';
import { supabase } from '../lib/supabase.js';
import { buildUserPriceObservations, computeReceiptFingerprint } from './ReceiptParserEngine.js';
import {
  buildCanonicalAliasIndex,
  CanonicalAliasIndex,
  collectProductIdsForCanonical,
  normalizeStoreIdKey,
  resolveCanonicalProductDetail
} from './ProductIdentityService.js';

interface DatabaseRow {
  [key: string]: any;
}

export interface DashboardData {
  receipts: Receipt[];
  shoppingLists: ShoppingList[];
  priceAlerts: PriceAlert[];
  alertNotifications: InAppPriceNotification[];
  trackedProductIds: string[];
  products: Product[];
  productOffers: ProductOffer[];
  stores: Store[];
  localDataImportedAt: string | null;
}

export interface LocalDashboardSnapshot {
  receipts: Receipt[];
  shoppingLists: ShoppingList[];
  priceAlerts: PriceAlert[];
  trackedProductIds: string[];
}

export interface LocalDashboardCounts {
  receipts: number;
  lists: number;
  listItems: number;
  alerts: number;
  trackedProducts: number;
  receiptsWithImages: number;
  total: number;
}

export interface DashboardImportResult {
  receipts: number;
  lists: number;
  listItems: number;
  alerts: number;
  trackedProducts: number;
  skippedAlerts: number;
  skippedTrackedProducts: number;
  imagesLeftOnDevice: number;
}

const VALID_UNITS = new Set<UnitType>(['buc', 'kg', 'g', 'l', 'ml', 'pachet']);
const VALID_NORMALIZED_UNITS = new Set(['kg', 'l', 'buc']);
const VALID_VERIFICATION_STATUSES = new Set<VerificationStatus>([
  'verified',
  'pending',
  'rejected',
  'expired',
  'demo',
  'isolated'
]);
const VALID_CONFIDENCE_LEVELS = new Set<ConfidenceLevel>(['high', 'medium', 'low']);

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordValue(value: unknown): DatabaseRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DatabaseRow : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function validUnit(value: unknown): UnitType {
  return VALID_UNITS.has(value as UnitType) ? value as UnitType : 'buc';
}

function mapProduct(row: DatabaseRow): Product {
  const normalizedUnit = stringValue(row.normalized_unit);
  return {
    id: stringValue(row.id),
    name: stringValue(row.name, 'Produs'),
    brand: stringValue(row.brand),
    category: stringValue(row.category, 'Alte produse') as Product['category'],
    defaultUnit: validUnit(row.default_unit),
    packageWeightOrVolume: numberValue(row.package_weight_or_volume, 1),
    packageUnit: validUnit(row.package_unit),
    normalizedUnit: VALID_NORMALIZED_UNITS.has(normalizedUnit)
      ? normalizedUnit as Product['normalizedUnit']
      : 'buc',
    barcode: stringValue(row.barcode) || undefined,
    imageUrl: stringValue(row.image_url) || undefined,
    isBio: Boolean(row.is_bio),
    isRomanianProduct: Boolean(row.is_romanian_product),
    baseReferencePrice: numberValue(row.base_reference_price),
    canonicalProductId: stringValue(row.canonical_product_id) || null
  };
}

function mapStore(row: DatabaseRow): Store {
  const storeType = stringValue(row.store_type);
  return {
    id: stringValue(row.id),
    name: stringValue(row.name, 'Magazin'),
    slug: stringValue(row.slug),
    chain: stringValue(row.chain),
    brandColor: stringValue(row.brand_color, 'bg-slate-700'),
    accentColor: stringValue(row.accent_color, 'text-slate-700'),
    logoUrl: stringValue(row.logo_url) || undefined,
    type: ['discounter', 'hypermarket', 'supermarket', 'proximity'].includes(storeType)
      ? storeType as Store['type']
      : 'supermarket',
    rating: numberValue(row.rating, 4),
    locationsCount: numberValue(row.locations_count, 1),
    sampleAddress: stringValue(row.sample_address, 'România'),
    isPartner: Boolean(row.is_partner)
  };
}

function mapOffer(row: DatabaseRow): ProductOffer {
  const source = stringValue(row.source);
  const verificationStatus = stringValue(row.verification_status) as VerificationStatus;
  const confidenceLevel = stringValue(row.confidence_level) as ConfidenceLevel;
  const unitPriceMeasure = stringValue(row.unit_price_measure);
  return {
    id: stringValue(row.id),
    productId: stringValue(row.product_id),
    storeId: stringValue(row.store_id),
    sourceId: stringValue(row.source_id) || undefined,
    price: numberValue(row.price),
    originalPrice: row.original_price == null ? undefined : numberValue(row.original_price),
    unitPrice: numberValue(row.unit_price, numberValue(row.price)),
    unitPriceMeasure: ['lei/kg', 'lei/l', 'lei/buc'].includes(unitPriceMeasure)
      ? unitPriceMeasure as ProductOffer['unitPriceMeasure']
      : 'lei/buc',
    isPromo: Boolean(row.is_promo),
    promoDetails: stringValue(row.promo_details) || undefined,
    loyaltyCardRequired: Boolean(row.loyalty_card_required),
    loyaltyCardName: stringValue(row.loyalty_card_name) || undefined,
    validUntil: stringValue(row.valid_until) || undefined,
    observationDate: stringValue(row.observation_date, new Date().toISOString().slice(0, 10)),
    source: ['official_feed', 'user_reported', 'estimated', 'demo', 'partner_api'].includes(source)
      ? source as ProductOffer['source']
      : 'verified',
    confidenceLevel: VALID_CONFIDENCE_LEVELS.has(confidenceLevel) ? confidenceLevel : 'medium',
    verificationStatus: VALID_VERIFICATION_STATUSES.has(verificationStatus)
      ? verificationStatus
      : 'pending',
    lastChecked: stringValue(row.last_checked, new Date().toISOString()),
    isSponsored: Boolean(row.is_sponsored),
    normalPrice: row.normal_price == null ? undefined : numberValue(row.normal_price),
    promoPrice: row.promo_price == null ? undefined : numberValue(row.promo_price),
    loyaltyPrice: row.loyalty_price == null ? undefined : numberValue(row.loyalty_price),
    rawRecordId: stringValue(row.raw_record_id) || undefined,
    region: stringValue(row.region) || undefined,
    batchId: stringValue(row.batch_id) || undefined,
    freshnessScore: row.freshness_score == null ? undefined : numberValue(row.freshness_score),
    qualityScore: row.quality_score == null ? undefined : numberValue(row.quality_score),
    freshnessStatus: ['very_recent', 'recent', 'stale', 'expired'].includes(stringValue(row.freshness_status))
      ? row.freshness_status
      : 'recent',
    lastCollectedAt: stringValue(row.last_collected_at) || undefined,
    lastVerifiedAt: stringValue(row.last_verified_at) || undefined,
    isFlaggedAnomaly: Boolean(row.is_flagged_anomaly),
    anomalyReason: stringValue(row.anomaly_reason) || undefined
  };
}

function mapReceiptItem(value: unknown, index: number): ReceiptItem {
  const item = recordValue(value);
  const confidence = stringValue(item.confidence) as ConfidenceLevel;
  return {
    id: stringValue(item.id, `item-${index}`),
    rawName: stringValue(item.rawName, 'Produs'),
    normalizedName: stringValue(item.normalizedName) || undefined,
    matchedProductId: stringValue(item.matchedProductId) || undefined,
    matchedProductName: stringValue(item.matchedProductName) || undefined,
    eanCode: stringValue(item.eanCode) || undefined,
    internalCode: stringValue(item.internalCode) || undefined,
    quantity: numberValue(item.quantity, 1),
    unit: item.unit ? validUnit(item.unit) : 'buc',
    unitPrice: numberValue(item.unitPrice),
    totalPrice: numberValue(item.totalPrice),
    discount: numberValue(item.discount),
    vatRate: item.vatRate == null ? undefined : numberValue(item.vatRate),
    isWeighted: Boolean(item.isWeighted),
    isSgr: Boolean(item.isSgr),
    isCouponOrDiscountLine: Boolean(item.isCouponOrDiscountLine),
    confidence: VALID_CONFIDENCE_LEVELS.has(confidence) ? confidence : 'medium',
    confidenceScore: item.confidenceScore == null ? undefined : numberValue(item.confidenceScore),
    confidenceDetails: item.confidenceDetails && typeof item.confidenceDetails === 'object' ? item.confidenceDetails as ReceiptItem['confidenceDetails'] : undefined,
    mathValid: item.mathValid == null ? undefined : Boolean(item.mathValid),
    mathDiscrepancy: item.mathDiscrepancy == null ? undefined : numberValue(item.mathDiscrepancy),
    matchStatus: ['matched', 'ambiguous', 'unmatched'].includes(stringValue(item.matchStatus))
      ? item.matchStatus as ReceiptItem['matchStatus']
      : undefined,
    matchCandidates: Array.isArray(item.matchCandidates) ? item.matchCandidates : undefined,
    provenance: item.provenance && typeof item.provenance === 'object' ? item.provenance as ReceiptItem['provenance'] : undefined,
    rawLineText: stringValue(item.rawLineText) || undefined,
    category: stringValue(item.category) as ReceiptItem['category']
  };
}

function mapReceipt(row: DatabaseRow, storeById: Map<string, Store>): Receipt {
  const extracted = recordValue(row.extracted_data);
  const items = Array.isArray(extracted.items) ? extracted.items.map(mapReceiptItem) : [];
  const storeId = stringValue(row.store_id);
  const store = storeById.get(storeId);
  const purchasedAt = stringValue(row.purchased_at) || stringValue(row.created_at);
  const imagePaths = Array.isArray(extracted.imagePaths)
    ? extracted.imagePaths.filter((p: unknown): p is string => typeof p === 'string')
    : row.image_path
      ? [stringValue(row.image_path)]
      : undefined;

  return {
    id: stringValue(row.id),
    storeId: storeId || stringValue(extracted.storeId) || 'unknown',
    storeName: stringValue(row.merchant_name, store?.name || 'Magazin'),
    storeAddress: stringValue(extracted.storeAddress) || undefined,
    fiscalNumber: stringValue(extracted.fiscalNumber) || undefined,
    receiptNumber: stringValue(row.receipt_number || extracted.receiptNumber) || undefined,
    date: purchasedAt.slice(0, 10),
    time: stringValue(extracted.time) || undefined,
    items,
    subtotal: numberValue(extracted.subtotal, numberValue(row.total_amount) + numberValue(extracted.discountTotal)),
    discountTotal: numberValue(extracted.discountTotal),
    couponsTotal: extracted.couponsTotal == null ? undefined : numberValue(extracted.couponsTotal),
    sgrTotal: extracted.sgrTotal == null ? undefined : numberValue(extracted.sgrTotal),
    vatTotal: extracted.vatTotal == null ? undefined : numberValue(extracted.vatTotal),
    vatBreakdown: Array.isArray(extracted.vatBreakdown) ? extracted.vatBreakdown : undefined,
    printedTotal: extracted.printedTotal == null ? undefined : numberValue(extracted.printedTotal),
    calculatedTotal: extracted.calculatedTotal == null ? undefined : numberValue(extracted.calculatedTotal),
    discrepancyAmount: extracted.discrepancyAmount == null ? undefined : numberValue(extracted.discrepancyAmount),
    total: numberValue(row.total_amount, numberValue(extracted.total)),
    currency: 'RON',
    paymentMethod: stringValue(row.payment_method || extracted.paymentMethod) || undefined,
    imagePaths,
    createdAt: stringValue(row.created_at, purchasedAt),
    processedAt: stringValue(row.processed_at || extracted.processedAt) || undefined,
    verifiedStatus: row.status === 'processed' ? 'confirmed' : 'draft',
    validationStatus: ['VALID', 'NEEDS_REVIEW', 'INVALID'].includes(stringValue(row.validation_status || extracted.validationStatus))
      ? (row.validation_status || extracted.validationStatus) as Receipt['validationStatus']
      : undefined,
    validationReasons: Array.isArray(extracted.validationReasons) ? extracted.validationReasons : undefined,
    confidenceScores: extracted.confidenceScores && typeof extracted.confidenceScores === 'object'
      ? extracted.confidenceScores as Receipt['confidenceScores']
      : undefined,
    rawOcrText: stringValue(extracted.rawOcrText) || undefined,
    originalExtractedData: extracted.originalExtractedData && typeof extracted.originalExtractedData === 'object'
      ? extracted.originalExtractedData as Record<string, any>
      : undefined,
    userCorrections: extracted.userCorrections && typeof extracted.userCorrections === 'object'
      ? extracted.userCorrections as Record<string, any>
      : undefined,
    contentFingerprint: stringValue(row.content_fingerprint || extracted.contentFingerprint) || undefined
  };
}

function mapShoppingItem(row: DatabaseRow, productsById: Map<string, Product>): ShoppingListItem {
  const productId = stringValue(row.product_id);
  const product = productsById.get(productId);
  return {
    id: stringValue(row.id),
    productId: productId || undefined,
    name: stringValue(row.product_name, product?.name || 'Produs'),
    brand: product?.brand,
    category: product?.category || 'Alte produse',
    quantity: numberValue(row.quantity, 1),
    unit: validUnit(row.unit),
    checked: Boolean(row.is_checked),
    notes: stringValue(row.notes) || undefined,
    referencePrice: product?.baseReferencePrice,
    estimatedPrice: product?.baseReferencePrice
  };
}

function getTrackedIds(preferences: unknown): string[] {
  const ids = recordValue(preferences).trackedProductIds;
  return Array.isArray(ids) ? Array.from(new Set(ids.filter((id): id is string => typeof id === 'string'))) : [];
}

function throwIfError(error: { message?: string } | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message || 'Supabase request failed'}`);
}

function chunks<T>(items: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function storeLookupKey(value: string): string {
  return value.toLowerCase().trim().replace(/^store-/, '').replace(/[^a-z0-9]/g, '');
}

function resolveStoreId(value: string, stores: Store[]): string | null {
  const key = storeLookupKey(value);
  if (!key) return null;
  const match = stores.find(store =>
    [store.id, store.slug, store.name, store.chain].some(candidate => storeLookupKey(candidate) === key)
  );
  return match?.id || null;
}

async function stableUuid(userId: string, kind: string, sourceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}:${kind}:${sourceId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const uuidBytes = digest.slice(0, 16);
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(uuidBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampForReceipt(receipt: Receipt): string {
  const candidate = `${receipt.date}T${receipt.time || '12:00'}:00`;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? new Date(receipt.createdAt).toISOString() : date.toISOString();
}

function receiptExtractedData(receipt: Receipt, localId?: string): DatabaseRow {
  const fingerprint = receipt.contentFingerprint || computeReceiptFingerprint(receipt);
  return {
    storeId: receipt.storeId || null,
    subtotal: receipt.subtotal,
    discountTotal: receipt.discountTotal,
    couponsTotal: receipt.couponsTotal ?? 0,
    sgrTotal: receipt.sgrTotal ?? 0,
    vatTotal: receipt.vatTotal ?? null,
    vatBreakdown: receipt.vatBreakdown || null,
    printedTotal: receipt.printedTotal ?? receipt.total,
    calculatedTotal: receipt.calculatedTotal ?? receipt.total,
    discrepancyAmount: receipt.discrepancyAmount ?? 0,
    time: receipt.time || null,
    fiscalNumber: receipt.fiscalNumber || null,
    receiptNumber: receipt.receiptNumber || null,
    storeAddress: receipt.storeAddress || null,
    paymentMethod: receipt.paymentMethod || null,
    verifiedStatus: receipt.verifiedStatus,
    validationStatus: receipt.validationStatus || 'VALID',
    validationReasons: receipt.validationReasons || [],
    confidenceScores: receipt.confidenceScores || null,
    rawOcrText: receipt.rawOcrText || null,
    originalExtractedData: receipt.originalExtractedData || null,
    userCorrections: receipt.userCorrections || null,
    imagePaths: receipt.imagePaths || [],
    contentFingerprint: fingerprint,
    processedAt: receipt.processedAt || new Date().toISOString(),
    localImportId: localId || null,
    items: receipt.items.map(item => ({
      id: item.id,
      rawName: item.rawName,
      normalizedName: item.normalizedName || null,
      matchedProductId: item.matchedProductId || null,
      matchedProductName: item.matchedProductName || null,
      eanCode: item.eanCode || null,
      internalCode: item.internalCode || null,
      quantity: item.quantity,
      unit: item.unit || 'buc',
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      discount: item.discount,
      vatRate: item.vatRate ?? null,
      isWeighted: Boolean(item.isWeighted),
      isSgr: Boolean(item.isSgr),
      isCouponOrDiscountLine: Boolean(item.isCouponOrDiscountLine),
      confidence: item.confidence,
      confidenceScore: item.confidenceScore ?? null,
      confidenceDetails: item.confidenceDetails || null,
      mathValid: item.mathValid ?? true,
      mathDiscrepancy: item.mathDiscrepancy ?? 0,
      matchStatus: item.matchStatus || 'unmatched',
      matchCandidates: item.matchCandidates || null,
      provenance: item.provenance || {},
      rawLineText: item.rawLineText || null,
      category: item.category || null
    }))
  };
}

async function updateProfilePreferences(userId: string, patch: DatabaseRow): Promise<DatabaseRow> {
  const { data: current, error: readError } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle();
  throwIfError(readError, 'Nu am putut citi preferințele profilului');

  const nextPreferences = { ...recordValue(current?.preferences), ...patch };
  const { error } = await supabase.from('profiles').upsert(
    { id: userId, preferences: nextPreferences, updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  );
  throwIfError(error, 'Nu am putut salva preferințele profilului');
  return nextPreferences;
}

export interface SupabaseCanonicalContext {
  aliasIndex: CanonicalAliasIndex;
  canonicalByRequestedId: Map<string, string>;
  canonicalIds: string[];
  allRelatedIds: string[];
}

export async function resolveSupabaseCanonicalProductIds(
  productIds: string[]
): Promise<Map<string, string>> {
  const ctx = await resolveSupabaseCanonicalContext(productIds);
  return ctx.canonicalByRequestedId;
}

export async function resolveSupabaseCanonicalContext(
  productIds: string[]
): Promise<SupabaseCanonicalContext> {
  const requestedIds = Array.from(new Set((productIds || []).map(id => (id || '').trim()).filter(Boolean)));
  if (requestedIds.length === 0) {
    return {
      aliasIndex: buildCanonicalAliasIndex([]),
      canonicalByRequestedId: new Map(),
      canonicalIds: [],
      allRelatedIds: []
    };
  }

  const nodeMap = new Map<string, { id: string; canonicalProductId: string | null }>();

  // 1. Mers ascendent multi-hop (max 16 niveluri) pentru a găsi rădăcinile canonice
  let upFrontier = [...requestedIds];
  for (let hop = 0; hop < 16 && upFrontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const batch of chunks(upFrontier, 200)) {
      const { data, error } = await supabase
        .from('products')
        .select('id, canonical_product_id')
        .in('id', batch);
      if (error) {
        // Fallback sigur dacă coloana canonical_product_id lipsește dintr-un mediu minimal
        const fallbackRes = await supabase.from('products').select('id').in('id', batch);
        for (const r of fallbackRes.data || []) {
          const rid = stringValue(r.id);
          if (rid && !nodeMap.has(rid)) nodeMap.set(rid, { id: rid, canonicalProductId: null });
        }
        break;
      }
      for (const r of data || []) {
        const rid = stringValue(r.id);
        const parentId = stringValue(r.canonical_product_id) || null;
        if (rid && !nodeMap.has(rid)) {
          nodeMap.set(rid, { id: rid, canonicalProductId: parentId });
        }
        if (parentId && !nodeMap.has(parentId)) {
          nextFrontier.push(parentId);
        }
      }
    }
    upFrontier = Array.from(new Set(nextFrontier));
  }

  const upIndex = buildCanonicalAliasIndex(Array.from(nodeMap.values()));
  const canonicalByRequestedId = new Map<string, string>();
  const canonicalIdsSet = new Set<string>();

  for (const reqId of requestedIds) {
    const res = resolveCanonicalProductDetail(reqId, upIndex);
    if (res.found && res.canonicalId && !res.cycleDetected) {
      canonicalByRequestedId.set(reqId, res.canonicalId);
      canonicalIdsSet.add(res.canonicalId);
    }
  }

  // 2. Mers descendent multi-hop pentru a colecta toate aliasurile produselor canonice țintă
  let downFrontier = Array.from(canonicalIdsSet);
  for (let hop = 0; hop < 16 && downFrontier.length > 0; hop++) {
    const nextChildren: string[] = [];
    for (const batch of chunks(downFrontier, 200)) {
      const { data, error } = await supabase
        .from('products')
        .select('id, canonical_product_id')
        .in('canonical_product_id', batch);
      if (error) break;
      for (const r of data || []) {
        const cid = stringValue(r.id);
        const pid = stringValue(r.canonical_product_id) || null;
        if (cid && !nodeMap.has(cid)) {
          nodeMap.set(cid, { id: cid, canonicalProductId: pid });
          nextChildren.push(cid);
        }
      }
    }
    downFrontier = Array.from(new Set(nextChildren));
  }

  const fullIndex = buildCanonicalAliasIndex(Array.from(nodeMap.values()));
  const allRelatedSet = new Set<string>(canonicalIdsSet);
  for (const cid of canonicalIdsSet) {
    for (const relId of collectProductIdsForCanonical(cid, fullIndex)) {
      allRelatedSet.add(relId);
    }
  }

  return {
    aliasIndex: fullIndex,
    canonicalByRequestedId,
    canonicalIds: Array.from(canonicalIdsSet),
    allRelatedIds: Array.from(allRelatedSet)
  };
}

async function loadPublicCatalog(productIds: string[]): Promise<{
  products: Product[];
  productOffers: ProductOffer[];
  stores: Store[];
  canonicalByRequestedId: Map<string, string>;
}> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const canonicalCtx = await resolveSupabaseCanonicalContext(uniqueIds);
  const canonicalIdsToLoad = canonicalCtx.canonicalIds.length > 0 ? canonicalCtx.canonicalIds : uniqueIds;
  const offerProductIdsToLoad = canonicalCtx.allRelatedIds.length > 0 ? canonicalCtx.allRelatedIds : uniqueIds;
  const today = new Date().toISOString().slice(0, 10);

  const [productsResult, offersResult, storesResult] = await Promise.all([
    canonicalIdsToLoad.length
      ? supabase.from('products').select(
          'id,name,brand,category,default_unit,package_weight_or_volume,package_unit,normalized_unit,barcode,image_url,is_bio,is_romanian_product,base_reference_price,canonical_product_id'
        ).in('id', canonicalIdsToLoad)
      : Promise.resolve({ data: [], error: null }),
    offerProductIdsToLoad.length
      ? supabase.from('product_offers').select(
          'id,product_id,store_id,source_id,price,original_price,normal_price,promo_price,loyalty_price,unit_price,unit_price_measure,is_promo,promo_details,loyalty_card_required,loyalty_card_name,valid_until,observation_date,source,confidence_level,verification_status,last_checked,is_sponsored,raw_record_id,region,batch_id,freshness_score,quality_score,freshness_status,last_collected_at,last_verified_at,is_flagged_anomaly,anomaly_reason'
        ).in('product_id', offerProductIdsToLoad).eq('verification_status', 'verified').eq('is_flagged_anomaly', false)
          .or(`valid_until.is.null,valid_until.gte.${today}`).order('last_checked', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('stores').select(
      'id,name,slug,chain,brand_color,accent_color,logo_url,store_type,rating,locations_count,sample_address,is_partner'
    ).order('name')
  ]);

  throwIfError(productsResult.error, 'Nu am putut prelua produsele din catalog');
  throwIfError(offersResult.error, 'Nu am putut prelua ofertele curente');
  throwIfError(storesResult.error, 'Nu am putut prelua magazinele');

  const storesByKey = new Map<string, Store>();
  for (const row of (storesResult.data || [])) {
    const mapped = mapStore(row);
    if (!mapped?.id || mapped.id === 'validation-only-retailer' || mapped.slug === 'validation-only-retailer') {
      continue;
    }
    const key = normalizeStoreIdKey(mapped.slug || mapped.id);
    if (!key) continue;
    const existing = storesByKey.get(key);
    if (!existing || (existing.id !== key && mapped.id === key)) {
      storesByKey.set(key, mapped);
    }
  }

  const productsById = new Map<string, Product>();
  for (const row of (productsResult.data || [])) {
    const mapped = mapProduct(row);
    if (mapped?.id && !productsById.has(mapped.id)) {
      productsById.set(mapped.id, mapped);
    }
  }

  const offersByCanonStore = new Map<string, ProductOffer>();
  for (const row of (offersResult.data || [])) {
    const mapped = mapOffer(row);
    if (!mapped?.id) continue;
    const canonProdId = canonicalCtx.canonicalByRequestedId.get(mapped.productId)
      || (productsById.has(mapped.productId) ? mapped.productId : undefined)
      || mapped.productId;
    const normStoreId = normalizeStoreIdKey(mapped.storeId) || mapped.storeId;
    const normalizedOffer: ProductOffer = {
      ...mapped,
      productId: canonProdId,
      storeId: normStoreId
    };
    const key = `${canonProdId}::${normStoreId}`;
    if (!offersByCanonStore.has(key)) {
      offersByCanonStore.set(key, normalizedOffer);
    }
  }

  return {
    products: Array.from(productsById.values()),
    productOffers: Array.from(offersByCanonStore.values()),
    stores: Array.from(storesByKey.values()),
    canonicalByRequestedId: canonicalCtx.canonicalByRequestedId
  };
}

export function countLocalDashboardData(snapshot: LocalDashboardSnapshot): LocalDashboardCounts {
  const counts = {
    receipts: snapshot.receipts.length,
    lists: snapshot.shoppingLists.length,
    listItems: snapshot.shoppingLists.reduce((sum, list) => sum + list.items.length, 0),
    alerts: snapshot.priceAlerts.length,
    trackedProducts: snapshot.trackedProductIds.length,
    receiptsWithImages: snapshot.receipts.filter(receipt => Boolean(receipt.imageUrl)).length
  };
  return { ...counts, total: counts.receipts + counts.lists + counts.alerts + counts.trackedProducts };
}

function parseAlertTypeClient(raw: unknown): PriceAlertType {
  const s = stringValue(raw);
  if (s === 'any_drop' || s === 'interval_low' || s === 'product_watch') return s;
  return 'below_target';
}

function parseRearmStateClient(raw: unknown): PriceAlertRearmState {
  return stringValue(raw) === 'triggered_locked' ? 'triggered_locked' : 'armed';
}

function parseTriggerHistoryClient(raw: unknown): PriceAlertTriggerEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(item => item && typeof item === 'object' && typeof (item as any).reasonRo === 'string')
    .slice(0, 25) as PriceAlertTriggerEvent[];
}

async function selectUserPriceAlerts(userId: string) {
  const faza4 = await supabase
    .from('price_alerts')
    .select(
      'id,user_id,product_id,target_price,is_active,created_at,alert_type,interval_days,source_list_id,last_triggered_at,last_triggered_price,last_evaluated_price,last_notified_key,min_drop_percent,cooldown_hours,rearm_state,trigger_cycle,last_trigger_reason_ro,last_source_offer_id,last_source_quality_status,last_rearmed_at,last_skipped_reason_ro,trigger_history'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!faza4.error) return faza4;

  const extended = await supabase
    .from('price_alerts')
    .select(
      'id,user_id,product_id,target_price,is_active,created_at,alert_type,interval_days,source_list_id,last_triggered_at,last_triggered_price,last_evaluated_price,last_notified_key'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!extended.error) return extended;

  // Fallback dacă migrarea 012 nu a fost încă aplicată în Supabase
  return supabase
    .from('price_alerts')
    .select('id,user_id,product_id,target_price,is_active,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}

async function selectUserAlertNotifications(userId: string): Promise<InAppPriceNotification[]> {
  try {
    let res = await supabase
      .from('price_alert_notifications')
      .select(
        'id,alert_id,dedupe_key,idempotency_key,product_id,product_name,alert_type,title,message,reason_ro,observed_price,previous_price,target_price,store_id,store_name,source_offer_id,quality_status,observed_interval_days,observed_observations_count,trigger_cycle,triggered_at,is_read'
      )
      .eq('user_id', userId)
      .order('triggered_at', { ascending: false })
      .limit(100);

    if (res.error) {
      res = (await supabase
        .from('price_alert_notifications')
        .select(
          'id,alert_id,dedupe_key,product_id,product_name,alert_type,title,message,observed_price,previous_price,target_price,store_id,store_name,triggered_at,is_read'
        )
        .eq('user_id', userId)
        .order('triggered_at', { ascending: false })
        .limit(100)) as typeof res;
    }

    if (res.error || !Array.isArray(res.data)) return [];
    return res.data.map(row => ({
      id: stringValue(row.id),
      alertId: stringValue(row.alert_id),
      dedupeKey: stringValue(row.dedupe_key),
      idempotencyKey: stringValue(row.idempotency_key) || undefined,
      productId: stringValue(row.product_id),
      productName: stringValue(row.product_name, 'Produs'),
      alertType: parseAlertTypeClient(row.alert_type),
      title: stringValue(row.title, 'Alertă de preț'),
      message: stringValue(row.message),
      reasonRo: stringValue(row.reason_ro) || undefined,
      observedPrice: numberValue(row.observed_price),
      previousPrice: row.previous_price != null ? numberValue(row.previous_price) : undefined,
      targetPrice: row.target_price != null ? numberValue(row.target_price) : undefined,
      storeId: stringValue(row.store_id) || 'store',
      storeName: stringValue(row.store_name) || 'Magazin',
      sourceOfferId: stringValue(row.source_offer_id) || undefined,
      qualityStatus: (stringValue(row.quality_status) || undefined) as PriceDataQualityStatus | undefined,
      observedIntervalDays:
        row.observed_interval_days != null ? (numberValue(row.observed_interval_days) as PriceHistoryInterval) : undefined,
      observedObservationsCount:
        row.observed_observations_count != null ? numberValue(row.observed_observations_count) : undefined,
      triggerCycle: row.trigger_cycle != null ? numberValue(row.trigger_cycle) : undefined,
      triggeredAt: stringValue(row.triggered_at, new Date().toISOString()),
      isRead: Boolean(row.is_read)
    }));
  } catch {
    return [];
  }
}

export async function loadDashboardData(userId: string): Promise<DashboardData> {
  const [receiptsResult, listsResult, alertsResult, profileResult, alertNotifications] = await Promise.all([
    supabase.from('receipts').select(
      'id,store_id,image_path,merchant_name,purchased_at,total_amount,currency,extracted_data,status,created_at'
    ).eq('user_id', userId).neq('status', 'failed').order('purchased_at', { ascending: false, nullsFirst: false }),
    supabase.from('shopping_lists').select(
      'id,user_id,name,description,is_archived,created_at,updated_at'
    ).eq('user_id', userId).order('updated_at', { ascending: false }),
    selectUserPriceAlerts(userId),
    supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle(),
    selectUserAlertNotifications(userId)
  ]);

  throwIfError(receiptsResult.error, 'Nu am putut prelua bonurile contului');
  throwIfError(listsResult.error, 'Nu am putut prelua listele contului');
  throwIfError(alertsResult.error, 'Nu am putut prelua alertele contului');
  throwIfError(profileResult.error, 'Nu am putut prelua preferințele contului');

  let sharedMemberRows: DatabaseRow[] = [];
  let sharedListRows: DatabaseRow[] = [];
  try {
    const { data: myMemberships, error: membErr } = await supabase
      .from('shopping_list_members')
      .select('id,list_id,user_id,role,display_name,email_masked,joined_at')
      .eq('user_id', userId);
    if (!membErr && Array.isArray(myMemberships) && myMemberships.length > 0) {
      sharedMemberRows = myMemberships;
      const ownedIds = new Set((listsResult.data || []).map(row => stringValue(row.id)));
      const externalListIds = myMemberships
        .map(m => stringValue(m.list_id))
        .filter(id => id && !ownedIds.has(id));
      if (externalListIds.length > 0) {
        const { data: extLists } = await supabase
          .from('shopping_lists')
          .select('id,user_id,name,description,is_archived,created_at,updated_at')
          .in('id', externalListIds);
        if (Array.isArray(extLists)) {
          sharedListRows = extLists;
        }
      }
    }
  } catch {
    // Migration 013 may not be applied yet — keep V1 lists cleanly
  }

  const listRows = [...(listsResult.data || []), ...sharedListRows];
  const listIds = Array.from(new Set(listRows.map(row => stringValue(row.id)).filter(Boolean)));
  const itemsResult = listIds.length
    ? await supabase.from('shopping_list_items').select(
        'id,list_id,product_id,product_name,quantity,unit,notes,is_checked,created_at,updated_at'
      ).in('list_id', listIds).order('created_at', { ascending: false })
    : { data: [], error: null };
  throwIfError(itemsResult.error, 'Nu am putut prelua produsele listelor');

  const membersByListId = new Map<string, SharedListMember[]>();
  const activityByListId = new Map<string, SharedListActivityEntry[]>();
  if (listIds.length > 0) {
    try {
      const [allMembersRes, recentActivityRes] = await Promise.all([
        supabase
          .from('shopping_list_members')
          .select('id,list_id,user_id,role,display_name,email_masked,joined_at')
          .in('list_id', listIds),
        supabase
          .from('shopping_list_activity')
          .select('id,list_id,actor_user_id,actor_name,action_type,target_name,details,created_at')
          .in('list_id', listIds)
          .order('created_at', { ascending: false })
          .limit(60)
      ]);
      if (!allMembersRes.error && Array.isArray(allMembersRes.data)) {
        for (const m of allMembersRes.data) {
          const lId = stringValue(m.list_id);
          const arr = membersByListId.get(lId) || [];
          arr.push({
            id: stringValue(m.id),
            listId: lId,
            userId: stringValue(m.user_id),
            role: (['owner', 'editor', 'viewer'].includes(stringValue(m.role))
              ? stringValue(m.role)
              : 'viewer') as SharedListRole,
            displayName: stringValue(m.display_name, 'Colaborator'),
            emailMasked: stringValue(m.email_masked) || undefined,
            joinedAt: stringValue(m.joined_at, new Date().toISOString())
          });
          membersByListId.set(lId, arr);
        }
      }
      if (!recentActivityRes.error && Array.isArray(recentActivityRes.data)) {
        for (const a of recentActivityRes.data) {
          const lId = stringValue(a.list_id);
          const arr = activityByListId.get(lId) || [];
          arr.push({
            id: stringValue(a.id),
            listId: lId,
            actorUserId: stringValue(a.actor_user_id) || undefined,
            actorName: stringValue(a.actor_name, 'Utilizator'),
            actionType: stringValue(a.action_type) as SharedListActivityEntry['actionType'],
            targetName: stringValue(a.target_name) || undefined,
            details: recordValue(a.details),
            createdAt: stringValue(a.created_at, new Date().toISOString())
          });
          activityByListId.set(lId, arr);
        }
      }
    } catch {
      // Ignore if migration 013 is pending
    }
  }

  const preferences = recordValue(profileResult.data?.preferences);
  const rawTrackedProductIds = getTrackedIds(preferences);
  const storeById = new Map<string, Store>();
  const rawReceipts = (receiptsResult.data || []).map(row => mapReceipt(row, storeById));
  const receiptMatchedIds = rawReceipts.flatMap(r => r.items.map(it => it.matchedProductId || ''));
  const productIds = [
    ...rawTrackedProductIds,
    ...(alertsResult.data || []).map(row => stringValue(row.product_id)),
    ...(itemsResult.data || []).map(row => stringValue(row.product_id)),
    ...receiptMatchedIds
  ];
  const { canonicalByRequestedId, ...catalog } = await loadPublicCatalog(productIds);
  const resolveCanonId = (pid?: string): string =>
    pid ? (canonicalByRequestedId.get(pid) || pid) : '';

  const trackedProductIds = Array.from(
    new Set(rawTrackedProductIds.map(id => resolveCanonId(id)).filter(Boolean))
  );
  const productsById = new Map(catalog.products.map(product => [product.id, product]));
  const storesById = new Map(catalog.stores.map(store => [store.id, store]));
  const itemsByListId = new Map<string, ShoppingListItem[]>();

  for (const row of itemsResult.data || []) {
    const listId = stringValue(row.list_id);
    const items = itemsByListId.get(listId) || [];
    const mappedItem = mapShoppingItem(row, productsById);
    if (mappedItem.productId) {
      const canonPid = resolveCanonId(mappedItem.productId);
      mappedItem.productId = canonPid || mappedItem.productId;
      const prod = productsById.get(mappedItem.productId);
      if (prod) {
        mappedItem.brand = mappedItem.brand || prod.brand;
        mappedItem.referencePrice = mappedItem.referencePrice ?? prod.baseReferencePrice;
        mappedItem.estimatedPrice = mappedItem.estimatedPrice ?? prod.baseReferencePrice;
      }
    }
    items.push(mappedItem);
    itemsByListId.set(listId, items);
  }

  const myRoleByListId = new Map<string, SharedListRole>();
  for (const m of sharedMemberRows) {
    const roleStr = stringValue(m.role);
    if (roleStr === 'owner' || roleStr === 'editor' || roleStr === 'viewer') {
      myRoleByListId.set(stringValue(m.list_id), roleStr);
    }
  }

  const shoppingLists: ShoppingList[] = listRows.map(row => {
    const listId = stringValue(row.id);
    const ownerId = stringValue(row.user_id);
    const members = membersByListId.get(listId) || [];
    const recentActivity = activityByListId.get(listId) || [];
    const resolvedRole: SharedListRole =
      ownerId === userId ? 'owner' : (myRoleByListId.get(listId) || 'viewer');
    return {
      id: listId,
      name: stringValue(row.name, 'Lista mea'),
      items: itemsByListId.get(listId) || [],
      createdAt: stringValue(row.created_at, new Date().toISOString()),
      updatedAt: stringValue(row.updated_at, stringValue(row.created_at, new Date().toISOString())),
      isArchived: Boolean(row.is_archived),
      ownerId,
      myRole: resolvedRole,
      isShared: members.length > 0 || ownerId !== userId,
      members,
      recentActivity
    };
  });

  const offersByProduct = new Map<string, ProductOffer[]>();
  for (const offer of catalog.productOffers) {
    const productOffers = offersByProduct.get(offer.productId) || [];
    productOffers.push(offer);
    offersByProduct.set(offer.productId, productOffers);
  }

  const alertMetaById = recordValue(preferences.priceAlertMeta);
  const priceAlerts: PriceAlert[] = (alertsResult.data || []).map(row => {
    const rawRow = row as Record<string, unknown>;
    const id = stringValue(row.id);
    const productId = resolveCanonId(stringValue(row.product_id));
    const currentOffer = (offersByProduct.get(productId) || []).reduce<ProductOffer | null>(
      (best, offer) => !best || offer.price < best.price ? offer : best,
      null
    );
    const product = productsById.get(productId);
    const meta = recordValue(alertMetaById[id]);
    const metaType = meta.alertType ? parseAlertTypeClient(meta.alertType) : undefined;
    const dbType = rawRow.alert_type != null ? parseAlertTypeClient(rawRow.alert_type) : undefined;
    const alertType: PriceAlertType =
      metaType === 'product_watch' && dbType === 'any_drop'
        ? 'product_watch'
        : (dbType || metaType || 'below_target');
    const rawInterval = Number(rawRow.interval_days ?? meta.intervalDays);
    const intervalDays =
      alertType === 'interval_low' && [30, 90, 180, 365].includes(rawInterval)
        ? (rawInterval as PriceAlert['intervalDays'])
        : undefined;
    const minDropRaw = rawRow.min_drop_percent ?? meta.minDropPercent;
    const cooldownRaw = rawRow.cooldown_hours ?? meta.cooldownHours;
    const triggerCycleRaw = rawRow.trigger_cycle ?? meta.triggerCycle;

    return {
      id,
      productId,
      productName: product ? `${product.name}${product.brand ? ` (${product.brand})` : ''}` : productId,
      targetPrice: numberValue(row.target_price),
      currentLowestPrice: currentOffer?.price || 0,
      lowestStoreId: currentOffer?.storeId,
      createdAt: stringValue(row.created_at).slice(0, 10),
      isActive: Boolean(row.is_active),
      alertType,
      intervalDays,
      minDropPercent: minDropRaw != null ? numberValue(minDropRaw) : undefined,
      cooldownHours: cooldownRaw != null ? numberValue(cooldownRaw) : undefined,
      rearmState: parseRearmStateClient(rawRow.rearm_state ?? meta.rearmState),
      triggerCycle: triggerCycleRaw != null ? numberValue(triggerCycleRaw) : 0,
      sourceListId: stringValue(rawRow.source_list_id ?? meta.sourceListId) || undefined,
      lastTriggeredAt: stringValue(rawRow.last_triggered_at ?? meta.lastTriggeredAt) || undefined,
      lastTriggeredPrice:
        rawRow.last_triggered_price != null
          ? numberValue(rawRow.last_triggered_price)
          : meta.lastTriggeredPrice != null
            ? numberValue(meta.lastTriggeredPrice)
            : undefined,
      lastEvaluatedPrice:
        rawRow.last_evaluated_price != null
          ? numberValue(rawRow.last_evaluated_price)
          : meta.lastEvaluatedPrice != null
            ? numberValue(meta.lastEvaluatedPrice)
            : undefined,
      lastNotifiedKey: stringValue(rawRow.last_notified_key ?? meta.lastNotifiedKey) || undefined,
      lastTriggerReasonRo: stringValue(rawRow.last_trigger_reason_ro ?? meta.lastTriggerReasonRo) || undefined,
      lastSourceOfferId: stringValue(rawRow.last_source_offer_id ?? meta.lastSourceOfferId) || undefined,
      lastSourceQualityStatus: (stringValue(rawRow.last_source_quality_status ?? meta.lastSourceQualityStatus) ||
        undefined) as PriceDataQualityStatus | undefined,
      lastRearmedAt: stringValue(rawRow.last_rearmed_at ?? meta.lastRearmedAt) || undefined,
      lastSkippedReasonRo: stringValue(rawRow.last_skipped_reason_ro ?? meta.lastSkippedReasonRo) || undefined,
      triggerHistory: parseTriggerHistoryClient(rawRow.trigger_history ?? meta.triggerHistory)
    };
  });

  const receipts = (receiptsResult.data || []).map(row => {
    const rec = mapReceipt(row, storesById);
    return {
      ...rec,
      items: rec.items.map(it =>
        it.matchedProductId
          ? { ...it, matchedProductId: resolveCanonId(it.matchedProductId) || it.matchedProductId }
          : it
      )
    };
  });

  return {
    receipts,
    shoppingLists,
    priceAlerts,
    alertNotifications,
    trackedProductIds,
    ...catalog,
    localDataImportedAt: stringValue(preferences.localHistoryImportedAt) || null
  };
}

async function uploadPrivateReceiptImages(
  userId: string,
  receiptUuid: string,
  imageUrls: string[]
): Promise<string[]> {
  const uploadedPaths: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const src = imageUrls[i];
    const match = src.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
    if (!match) continue;
    const rawMime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const ext = rawMime === 'image/png' ? 'png' : rawMime === 'image/webp' ? 'webp' : 'jpg';
    const base64 = match[2];
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const objectPath = `${userId}/${receiptUuid}/page-${i + 1}.${ext}`;

    const { error } = await supabase.storage
      .from('receipt-images')
      .upload(objectPath, binary, {
        contentType: rawMime,
        upsert: true
      });
    if (!error) {
      uploadedPaths.push(objectPath);
    }
  }
  return uploadedPaths;
}

export async function getSignedReceiptImageUrls(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  try {
    const { data, error } = await supabase.storage
      .from('receipt-images')
      .createSignedUrls(paths, 3600);
    if (error || !data) return [];
    return data.map(d => d.signedUrl).filter((url): url is string => Boolean(url));
  } catch {
    return [];
  }
}

export async function saveReceiptForUser(
  userId: string,
  receipt: Receipt,
  stores: Store[]
): Promise<Receipt> {
  const id = isUuid(receipt.id) ? receipt.id : await stableUuid(userId, 'receipt', receipt.id);
  const storeId = resolveStoreId(receipt.storeId || receipt.storeName, stores);
  const fingerprint = receipt.contentFingerprint || computeReceiptFingerprint(receipt);

  // Upload original receipt images into private Supabase Storage bucket if available
  const rawImages = receipt.imageUrls?.length
    ? receipt.imageUrls
    : receipt.imageUrl
      ? [receipt.imageUrl]
      : [];
  const uploadedPaths = rawImages.length
    ? await uploadPrivateReceiptImages(userId, id, rawImages)
    : (receipt.imagePaths || []);

  const enrichedReceipt: Receipt = {
    ...receipt,
    id,
    imagePaths: uploadedPaths,
    contentFingerprint: fingerprint
  };
  const extractedPayload = receiptExtractedData(enrichedReceipt);
  const purchasedAt = timestampForReceipt(enrichedReceipt);
  const observations = buildUserPriceObservations(enrichedReceipt, userId);

  const requestedMatchedIds = enrichedReceipt.items.map(it => it.matchedProductId || '').filter(Boolean);
  const canonicalMatchMap = await resolveSupabaseCanonicalProductIds(requestedMatchedIds);
  const validCanonicalSet = new Set(canonicalMatchMap.values());

  const resolvedReceiptItems = enrichedReceipt.items.map(it => {
    const resolvedPid = it.matchedProductId ? canonicalMatchMap.get(it.matchedProductId) : undefined;
    return resolvedPid && resolvedPid !== it.matchedProductId
      ? { ...it, matchedProductId: resolvedPid }
      : it;
  });
  const upgradedReceipt: Receipt = {
    ...enrichedReceipt,
    items: resolvedReceiptItems
  };
  const upgradedPayload = receiptExtractedData(upgradedReceipt);
  const upgradedObservations = buildUserPriceObservations(upgradedReceipt, userId);

  const rpcReceiptJson = {
    id,
    store_id: storeId,
    image_path: uploadedPaths[0] || null,
    merchant_name: upgradedReceipt.storeName,
    purchased_at: purchasedAt,
    total_amount: upgradedReceipt.total,
    currency: 'RON',
    extracted_data: upgradedPayload,
    status: upgradedReceipt.verifiedStatus === 'confirmed' ? 'processed' : 'uploaded',
    receipt_number: upgradedReceipt.receiptNumber || null,
    payment_method: upgradedReceipt.paymentMethod || null,
    sgr_total: upgradedReceipt.sgrTotal ?? 0,
    coupons_total: upgradedReceipt.couponsTotal ?? 0,
    vat_total: upgradedReceipt.vatTotal ?? null,
    printed_total: upgradedReceipt.printedTotal ?? upgradedReceipt.total,
    calculated_total: upgradedReceipt.calculatedTotal ?? upgradedReceipt.total,
    discrepancy_amount: upgradedReceipt.discrepancyAmount ?? 0,
    validation_status: upgradedReceipt.validationStatus || 'VALID',
    validation_reasons: upgradedReceipt.validationReasons || [],
    confidence_scores: upgradedReceipt.confidenceScores || {},
    raw_ocr_text: upgradedReceipt.rawOcrText || null,
    original_extracted_data: upgradedReceipt.originalExtractedData || null,
    user_corrections: upgradedReceipt.userCorrections || null,
    image_paths: uploadedPaths,
    content_fingerprint: fingerprint
  };

  const rpcItemsJson = resolvedReceiptItems.map(it => ({
    product_id: validCanonicalSet.has(it.matchedProductId || '') ? it.matchedProductId : null,
    raw_name: it.rawName,
    normalized_name: it.normalizedName || null,
    ean_code: it.eanCode || null,
    internal_code: it.internalCode || null,
    quantity: it.quantity,
    unit: it.unit || 'buc',
    unit_price: it.unitPrice,
    total_price: it.totalPrice,
    discount: it.discount || 0,
    vat_rate: it.vatRate ?? null,
    is_weighted: Boolean(it.isWeighted),
    is_sgr: Boolean(it.isSgr),
    confidence_score: it.confidenceScore ?? null,
    confidence_details: it.confidenceDetails || null,
    math_valid: it.mathValid ?? true,
    match_status: it.matchStatus || 'unmatched',
    provenance: it.provenance || {},
    raw_line_text: it.rawLineText || null
  }));

  const rpcObsJson = upgradedObservations.map(obs => ({
    product_id: validCanonicalSet.has(obs.productId || '') ? obs.productId : null,
    product_name: obs.productName,
    store_id: storeId,
    store_name: obs.storeName,
    purchase_date: obs.purchaseDate,
    quantity: obs.quantity,
    unit: obs.unit,
    unit_price: obs.unitPrice,
    discount: obs.discount,
    effective_paid_unit_price: obs.effectivePaidUnitPrice,
    total_paid: obs.totalPaid,
    source_receipt_label: obs.sourceReceiptLabel || null
  }));

  const { error: rpcError } = await supabase.rpc('save_receipt_v2', {
    p_receipt: rpcReceiptJson,
    p_items: rpcItemsJson,
    p_observations: rpcObsJson
  });

  if (!rpcError) {
    const { data: refreshed, error: readBackErr } = await supabase
      .from('receipts')
      .select('id,store_id,image_path,merchant_name,purchased_at,total_amount,currency,extracted_data,status,created_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (!readBackErr && refreshed) {
      return mapReceipt(refreshed, new Map(stores.map(store => [store.id, store])));
    }
  }

  // Fallback compatible with existing public.receipts columns (storing full 2.0 payload in extracted_data)
  const payload = {
    id,
    user_id: userId,
    store_id: storeId,
    image_path: uploadedPaths[0] || null,
    merchant_name: enrichedReceipt.storeName,
    purchased_at: purchasedAt,
    total_amount: enrichedReceipt.total,
    currency: 'RON',
    extracted_data: extractedPayload,
    status: enrichedReceipt.verifiedStatus === 'confirmed' ? 'processed' : 'uploaded'
  };
  const { data, error } = await supabase.from('receipts').upsert(payload, { onConflict: 'id' })
    .select('id,store_id,image_path,merchant_name,purchased_at,total_amount,currency,extracted_data,status,created_at')
    .single();
  throwIfError(error, 'Nu am putut salva bonul în contul Supabase');
  if (!data) throw new Error('Supabase nu a returnat bonul salvat.');
  return mapReceipt(data, new Map(stores.map(store => [store.id, store])));
}

export async function fetchUserPersonalPriceHistory(
  userId: string,
  fallbackReceipts: Receipt[] = []
): Promise<UserPriceObservation[]> {
  try {
    const { data, error } = await supabase
      .from('user_price_observations')
      .select('id,user_id,receipt_id,receipt_item_id,product_id,product_name,store_id,store_name,purchase_date,quantity,unit,unit_price,discount,effective_paid_unit_price,total_paid,currency,source_receipt_label')
      .eq('user_id', userId)
      .order('purchase_date', { ascending: false })
      .limit(300);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map(row => ({
        id: stringValue(row.id),
        userId: stringValue(row.user_id),
        receiptId: stringValue(row.receipt_id),
        receiptItemId: stringValue(row.receipt_item_id) || undefined,
        productId: stringValue(row.product_id) || undefined,
        productName: stringValue(row.product_name, 'Produs'),
        storeId: stringValue(row.store_id) || undefined,
        storeName: stringValue(row.store_name, 'Magazin'),
        purchaseDate: stringValue(row.purchase_date).slice(0, 10),
        quantity: numberValue(row.quantity, 1),
        unit: validUnit(row.unit),
        unitPrice: numberValue(row.unit_price),
        discount: numberValue(row.discount),
        effectivePaidUnitPrice: numberValue(row.effective_paid_unit_price),
        totalPaid: numberValue(row.total_paid),
        currency: 'RON',
        sourceReceiptLabel: stringValue(row.source_receipt_label) || undefined
      }));
    }
  } catch {
    // Table may not exist yet before migration 010 — derive strictly from user's own confirmed receipts
  }

  return fallbackReceipts
    .filter(r => r.verifiedStatus === 'confirmed')
    .flatMap(r => buildUserPriceObservations(r, userId))
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
}

export async function deleteReceiptForUser(userId: string, receiptId: string, imagePaths?: string[]): Promise<void> {
  // Remove associated private receipt images if present
  if (imagePaths && imagePaths.length > 0) {
    try {
      const ownedPaths = imagePaths.filter(p => p.startsWith(`${userId}/`));
      if (ownedPaths.length > 0) {
        await supabase.storage.from('receipt-images').remove(ownedPaths);
      }
    } catch {
      // Non-blocking storage cleanup
    }
  }
  const { error } = await supabase.from('receipts').delete().eq('id', receiptId).eq('user_id', userId);
  throwIfError(error, 'Nu am putut șterge bonul din contul Supabase');
}

async function normalizeShoppingLists(userId: string, lists: ShoppingList[]): Promise<ShoppingList[]> {
  const normalized: ShoppingList[] = [];
  for (const list of lists) {
    const listId = isUuid(list.id) ? list.id : await stableUuid(userId, 'shopping-list', list.id);
    const items: ShoppingListItem[] = [];
    for (const item of list.items) {
      const itemId = isUuid(item.id) ? item.id : await stableUuid(userId, `shopping-list-item:${listId}`, item.id);
      items.push({ ...item, id: itemId });
    }
    normalized.push({ ...list, id: listId, items });
  }
  return normalized;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function validProductIds(productIds: string[]): Promise<Map<string, string>> {
  return resolveSupabaseCanonicalProductIds(productIds);
}

export async function saveShoppingListsForUser(
  userId: string,
  currentLists: ShoppingList[],
  nextLists: ShoppingList[]
): Promise<ShoppingList[]> {
  const normalized = await normalizeShoppingLists(userId, nextLists);
  const canonicalMap = await validProductIds(normalized.flatMap(list => list.items.map(item => item.productId || '')));
  const safeLists = normalized.map(list => ({
    ...list,
    items: list.items.map(item => {
      if (!item.productId) return item;
      const canonId = canonicalMap.get(item.productId);
      return canonId ? { ...item, productId: canonId } : { ...item, productId: undefined };
    })
  }));

  // Do not allow viewer collaborators to persist mutations; preserve their existing items untouched
  const currentById = new Map(currentLists.map(l => [l.id, l]));
  const sanitizedLists = safeLists.map(list => {
    const existing = currentById.get(list.id);
    const role = existing?.myRole || list.myRole;
    if (role === 'viewer' && existing) {
      return existing;
    }
    return list;
  });

  // Only list owners (or creators of new local lists) upsert shopping_lists metadata
  const ownedListRows = sanitizedLists
    .filter(list => !list.ownerId || list.ownerId === userId || list.myRole === 'owner')
    .map(list => ({
      id: list.id,
      user_id: userId,
      name: list.name,
      description: null,
      is_archived: Boolean(list.isArchived),
      updated_at: list.updatedAt || new Date().toISOString()
    }));
  for (const batch of chunks(ownedListRows)) {
    const { error } = await supabase.from('shopping_lists').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut salva listele de cumpărături');
  }

  // Owners and editors can sync shopping_list_items; viewers are skipped
  const editableLists = sanitizedLists.filter(list => list.myRole !== 'viewer');
  const itemRows = editableLists.flatMap(list => list.items.map(item => ({
    id: item.id,
    list_id: list.id,
    product_id: item.productId || null,
    product_name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    notes: item.notes || null,
    is_checked: Boolean(item.checked),
    updated_at: new Date().toISOString()
  })));
  for (const batch of chunks(itemRows)) {
    const { error } = await supabase.from('shopping_list_items').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut salva produsele din listă');
  }

  const nextListIds = new Set(sanitizedLists.map(list => list.id));
  for (const currentList of currentLists) {
    if (!isUuid(currentList.id)) continue;
    if (currentList.myRole === 'viewer') continue;

    const nextList = sanitizedLists.find(list => list.id === currentList.id);
    const nextItemIds = new Set(nextList?.items.map(item => item.id) || []);
    const removedItemIds = currentList.items.map(item => item.id).filter(id => isUuid(id) && !nextItemIds.has(id));
    if (removedItemIds.length) {
      const { error } = await supabase.from('shopping_list_items').delete()
        .eq('list_id', currentList.id).in('id', removedItemIds);
      throwIfError(error, 'Nu am putut șterge produsele eliminate din listă');
    }
    const isOwner = !currentList.ownerId || currentList.ownerId === userId || currentList.myRole === 'owner';
    if (isOwner && !nextListIds.has(currentList.id)) {
      const { error } = await supabase.from('shopping_lists').delete()
        .eq('id', currentList.id).eq('user_id', userId);
      throwIfError(error, 'Nu am putut șterge lista eliminată');
    }
  }

  return sanitizedLists;
}

export async function savePriceAlertsForUser(
  userId: string,
  currentAlerts: PriceAlert[],
  nextAlerts: PriceAlert[]
): Promise<PriceAlert[]> {
  const canonicalMap = await validProductIds(nextAlerts.map(alert => alert.productId));
  const normalized: PriceAlert[] = [];
  const seenKeys = new Set<string>();
  for (const alert of nextAlerts) {
    const resolvedProductId = canonicalMap.get(alert.productId);
    if (!resolvedProductId) {
      throw new Error('Unul dintre produsele alertei nu există în catalogul Supabase.');
    }
    const dedupeKey = `${resolvedProductId}:${alert.alertType || 'below_target'}:${alert.intervalDays || ''}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    normalized.push({
      ...alert,
      productId: resolvedProductId,
      id: isUuid(alert.id) ? alert.id : await stableUuid(userId, 'price-alert', alert.id)
    });
  }

  const faza4Rows = normalized.map(alert => ({
    id: alert.id,
    user_id: userId,
    product_id: alert.productId,
    target_price: alert.targetPrice,
    is_active: alert.isActive,
    created_at: alert.createdAt,
    alert_type: alert.alertType || 'below_target',
    interval_days: alert.alertType === 'interval_low' ? (alert.intervalDays || 90) : null,
    source_list_id: alert.sourceListId && isUuid(alert.sourceListId) ? alert.sourceListId : null,
    last_triggered_at: alert.lastTriggeredAt || null,
    last_triggered_price: alert.lastTriggeredPrice ?? null,
    last_evaluated_price: alert.lastEvaluatedPrice ?? null,
    last_notified_key: alert.lastNotifiedKey || null,
    min_drop_percent: alert.minDropPercent ?? null,
    cooldown_hours: alert.cooldownHours ?? (alert.alertType === 'product_watch' ? 72 : 24),
    rearm_state: alert.rearmState || 'armed',
    trigger_cycle: alert.triggerCycle ?? 0,
    last_trigger_reason_ro: alert.lastTriggerReasonRo || null,
    last_source_offer_id: alert.lastSourceOfferId || null,
    last_source_quality_status: alert.lastSourceQualityStatus || null,
    last_rearmed_at: alert.lastRearmedAt || null,
    last_skipped_reason_ro: alert.lastSkippedReasonRo || null,
    trigger_history: Array.isArray(alert.triggerHistory) ? alert.triggerHistory.slice(0, 25) : []
  }));

  const extendedRows = normalized.map(alert => ({
    id: alert.id,
    user_id: userId,
    product_id: alert.productId,
    target_price: alert.targetPrice,
    is_active: alert.isActive,
    created_at: alert.createdAt,
    alert_type: alert.alertType === 'product_watch' ? 'any_drop' : (alert.alertType || 'below_target'),
    interval_days: alert.alertType === 'interval_low' ? (alert.intervalDays || 90) : null,
    source_list_id: alert.sourceListId && isUuid(alert.sourceListId) ? alert.sourceListId : null,
    last_triggered_at: alert.lastTriggeredAt || null,
    last_triggered_price: alert.lastTriggeredPrice ?? null,
    last_evaluated_price: alert.lastEvaluatedPrice ?? null,
    last_notified_key: alert.lastNotifiedKey || null
  }));

  const baseRows = normalized.map(alert => ({
    id: alert.id,
    user_id: userId,
    product_id: alert.productId,
    target_price: alert.targetPrice,
    is_active: alert.isActive,
    created_at: alert.createdAt
  }));

  let useV12Fallback = false;
  for (const batch of chunks(faza4Rows)) {
    const { error } = await supabase.from('price_alerts').upsert(batch, { onConflict: 'id' });
    if (error) {
      useV12Fallback = true;
      break;
    }
  }

  let useBaseFallback = false;
  if (useV12Fallback) {
    for (const batch of chunks(extendedRows)) {
      const { error } = await supabase.from('price_alerts').upsert(batch, { onConflict: 'id' });
      if (error) {
        useBaseFallback = true;
        break;
      }
    }
  }

  if (useBaseFallback) {
    for (const batch of chunks(baseRows)) {
      const { error } = await supabase.from('price_alerts').upsert(batch, { onConflict: 'id' });
      throwIfError(error, 'Nu am putut salva alertele de preț');
    }
  }

  const nextMeta: Record<string, unknown> = {};
  for (const alert of normalized) {
    nextMeta[alert.id] = {
      alertType: alert.alertType || 'below_target',
      intervalDays: alert.intervalDays || null,
      minDropPercent: alert.minDropPercent ?? null,
      cooldownHours: alert.cooldownHours ?? null,
      rearmState: alert.rearmState || 'armed',
      triggerCycle: alert.triggerCycle ?? 0,
      sourceListId: alert.sourceListId || null,
      lastTriggeredAt: alert.lastTriggeredAt || null,
      lastTriggeredPrice: alert.lastTriggeredPrice ?? null,
      lastEvaluatedPrice: alert.lastEvaluatedPrice ?? null,
      lastNotifiedKey: alert.lastNotifiedKey || null,
      lastTriggerReasonRo: alert.lastTriggerReasonRo || null,
      lastSourceOfferId: alert.lastSourceOfferId || null,
      lastSourceQualityStatus: alert.lastSourceQualityStatus || null,
      lastRearmedAt: alert.lastRearmedAt || null,
      lastSkippedReasonRo: alert.lastSkippedReasonRo || null,
      triggerHistory: Array.isArray(alert.triggerHistory) ? alert.triggerHistory.slice(0, 25) : []
    };
  }
  await updateProfilePreferences(userId, { priceAlertMeta: nextMeta });

  const nextIds = new Set(normalized.map(alert => alert.id));
  const removedIds = currentAlerts.map(alert => alert.id).filter(id => isUuid(id) && !nextIds.has(id));
  if (removedIds.length) {
    const { error } = await supabase.from('price_alerts').delete().eq('user_id', userId).in('id', removedIds);
    throwIfError(error, 'Nu am putut șterge alertele eliminate');
  }
  return normalized;
}

export async function saveAlertNotificationsForUser(
  userId: string,
  notifications: InAppPriceNotification[],
  persistedAlerts: PriceAlert[]
): Promise<InAppPriceNotification[]> {
  if (!notifications.length) return [];
  const alertUuidByProductAndType = new Map<string, string>();
  for (const a of persistedAlerts) {
    if (isUuid(a.id)) {
      alertUuidByProductAndType.set(a.id, a.id);
      alertUuidByProductAndType.set(`${a.productId}:${a.alertType || 'below_target'}`, a.id);
    }
  }

  const faza4Rows: Array<Record<string, unknown>> = [];
  const v12Rows: Array<Record<string, unknown>> = [];
  const saved: InAppPriceNotification[] = [];
  for (const notif of notifications) {
    const resolvedAlertId =
      (isUuid(notif.alertId) ? notif.alertId : undefined) ||
      alertUuidByProductAndType.get(notif.alertId) ||
      alertUuidByProductAndType.get(`${notif.productId}:${notif.alertType}`);
    if (!resolvedAlertId) continue;

    const id = isUuid(notif.id) ? notif.id : await stableUuid(userId, 'alert-notif', notif.dedupeKey);
    faza4Rows.push({
      id,
      user_id: userId,
      alert_id: resolvedAlertId,
      dedupe_key: notif.dedupeKey,
      idempotency_key: notif.idempotencyKey || null,
      product_id: notif.productId,
      product_name: notif.productName,
      alert_type: notif.alertType,
      title: notif.title,
      message: notif.message,
      reason_ro: notif.reasonRo || notif.message,
      observed_price: notif.observedPrice,
      previous_price: notif.previousPrice ?? null,
      target_price: notif.targetPrice ?? null,
      store_id: notif.storeId || null,
      store_name: notif.storeName || null,
      source_offer_id: notif.sourceOfferId || null,
      quality_status: notif.qualityStatus || null,
      observed_interval_days: notif.observedIntervalDays ?? null,
      observed_observations_count: notif.observedObservationsCount ?? null,
      trigger_cycle: notif.triggerCycle ?? null,
      triggered_at: notif.triggeredAt,
      is_read: Boolean(notif.isRead)
    });
    v12Rows.push({
      id,
      user_id: userId,
      alert_id: resolvedAlertId,
      dedupe_key: notif.dedupeKey,
      product_id: notif.productId,
      product_name: notif.productName,
      alert_type: notif.alertType === 'product_watch' ? 'any_drop' : notif.alertType,
      title: notif.title,
      message: notif.message,
      observed_price: notif.observedPrice,
      previous_price: notif.previousPrice ?? null,
      target_price: notif.targetPrice ?? null,
      store_id: notif.storeId || null,
      store_name: notif.storeName || null,
      triggered_at: notif.triggeredAt,
      is_read: Boolean(notif.isRead)
    });
    saved.push({ ...notif, id, alertId: resolvedAlertId });
  }

  if (faza4Rows.length === 0) return [];
  try {
    let fallbackToV12 = false;
    for (const batch of chunks(faza4Rows)) {
      const { error } = await supabase.from('price_alert_notifications').upsert(batch, {
        onConflict: 'user_id,dedupe_key',
        ignoreDuplicates: true
      });
      if (error) {
        fallbackToV12 = true;
        break;
      }
    }
    if (fallbackToV12) {
      for (const batch of chunks(v12Rows)) {
        await supabase.from('price_alert_notifications').upsert(batch, {
          onConflict: 'user_id,dedupe_key',
          ignoreDuplicates: true
        });
      }
    }
  } catch {
    // Non-blocking fallback when 012/014 migration hasn't been applied yet
  }
  return saved;
}

export async function markAlertNotificationsReadForUser(
  userId: string,
  notificationId?: string
): Promise<void> {
  try {
    let query = supabase
      .from('price_alert_notifications')
      .update({ is_read: true })
      .eq('user_id', userId);
    if (notificationId && isUuid(notificationId)) {
      query = query.eq('id', notificationId);
    }
    await query;
  } catch {
    // Non-blocking fallback
  }
}

export async function saveTrackedProductsForUser(userId: string, productIds: string[]): Promise<string[]> {
  const rawUniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const canonicalMap = await validProductIds(rawUniqueIds);
  if (rawUniqueIds.some(id => !canonicalMap.has(id))) {
    throw new Error('Unul dintre produsele urmărite nu există în catalogul Supabase.');
  }
  const canonicalUniqueIds = Array.from(new Set(rawUniqueIds.map(id => canonicalMap.get(id)!)));
  await updateProfilePreferences(userId, { trackedProductIds: canonicalUniqueIds });
  return canonicalUniqueIds;
}

export async function importLocalDashboardData(
  userId: string,
  snapshot: LocalDashboardSnapshot
): Promise<DashboardImportResult> {
  const counts = countLocalDashboardData(snapshot);
  const storesResult = await supabase.from('stores').select('id,name,slug,chain,brand_color,accent_color,logo_url,store_type,rating,locations_count,sample_address,is_partner');
  throwIfError(storesResult.error, 'Nu am putut verifica magazinele pentru import');
  const stores = (storesResult.data || []).map(mapStore);
  const localProductIds = [
    ...snapshot.trackedProductIds,
    ...snapshot.priceAlerts.map(alert => alert.productId),
    ...snapshot.shoppingLists.flatMap(list => list.items.map(item => item.productId || '')),
    ...snapshot.receipts.flatMap(rec => rec.items.map(it => it.matchedProductId || ''))
  ];
  const canonicalMap = await validProductIds(localProductIds);

  const upgradedReceipts = snapshot.receipts.map(receipt => ({
    ...receipt,
    items: receipt.items.map(it => {
      if (!it.matchedProductId) return it;
      const canon = canonicalMap.get(it.matchedProductId);
      return canon ? { ...it, matchedProductId: canon } : it;
    })
  }));

  const receiptRows = await Promise.all(upgradedReceipts.map(async receipt => ({
    id: await stableUuid(userId, 'imported-receipt', receipt.id),
    user_id: userId,
    store_id: resolveStoreId(receipt.storeId || receipt.storeName, stores),
    image_path: null,
    merchant_name: receipt.storeName,
    purchased_at: timestampForReceipt(receipt),
    total_amount: receipt.total,
    currency: 'RON',
    extracted_data: receiptExtractedData(receipt, receipt.id),
    status: receipt.verifiedStatus === 'confirmed' ? 'processed' : 'uploaded'
  })));
  for (const batch of chunks(receiptRows)) {
    const { error } = await supabase.from('receipts').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut importa bonurile locale');
  }

  const normalizedLists = await normalizeShoppingLists(userId, snapshot.shoppingLists);
  const listRows = normalizedLists.map(list => ({
    id: list.id,
    user_id: userId,
    name: list.name,
    description: null,
    is_archived: Boolean(list.isArchived),
    created_at: list.createdAt || new Date().toISOString(),
    updated_at: list.updatedAt || new Date().toISOString()
  }));
  for (const batch of chunks(listRows)) {
    const { error } = await supabase.from('shopping_lists').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut importa listele locale');
  }

  const itemRows = normalizedLists.flatMap(list => list.items.map(item => ({
    id: item.id,
    list_id: list.id,
    product_id: item.productId ? (canonicalMap.get(item.productId) || null) : null,
    product_name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    notes: item.notes || null,
    is_checked: Boolean(item.checked),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  })));
  for (const batch of chunks(itemRows)) {
    const { error } = await supabase.from('shopping_list_items').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut importa produsele din liste');
  }

  const seenImportAlerts = new Set<string>();
  const importableAlerts: Array<PriceAlert & { resolvedProductId: string }> = [];
  for (const alert of snapshot.priceAlerts) {
    const resolvedProductId = canonicalMap.get(alert.productId);
    const isWatchOrDrop = alert.alertType === 'product_watch' || alert.alertType === 'any_drop' || alert.alertType === 'interval_low';
    if (!resolvedProductId || (!isWatchOrDrop && numberValue(alert.targetPrice) <= 0)) continue;
    const key = `${resolvedProductId}:${alert.alertType || 'below_target'}:${alert.intervalDays || ''}`;
    if (seenImportAlerts.has(key)) continue;
    seenImportAlerts.add(key);
    importableAlerts.push({ ...alert, resolvedProductId });
  }
  const alertRows = await Promise.all(importableAlerts.map(async alert => ({
    id: await stableUuid(userId, 'imported-alert', alert.id),
    user_id: userId,
    product_id: alert.resolvedProductId,
    target_price: Math.max(0, numberValue(alert.targetPrice)),
    is_active: alert.isActive,
    created_at: alert.createdAt || new Date().toISOString()
  })));
  for (const batch of chunks(alertRows)) {
    const { error } = await supabase.from('price_alerts').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut importa alertele locale');
  }

  const importedTrackedProductIds = Array.from(
    new Set(snapshot.trackedProductIds.map(id => canonicalMap.get(id)).filter((id): id is string => Boolean(id)))
  );
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle();
  throwIfError(profileError, 'Nu am putut citi preferințele pentru import');
  const mergedTrackedProductIds = Array.from(new Set([
    ...getTrackedIds(profile?.preferences),
    ...importedTrackedProductIds
  ]));
  await updateProfilePreferences(userId, {
    trackedProductIds: mergedTrackedProductIds,
    localHistoryImportedAt: new Date().toISOString()
  });

  return {
    receipts: receiptRows.length,
    lists: normalizedLists.length,
    listItems: itemRows.length,
    alerts: alertRows.length,
    trackedProducts: importedTrackedProductIds.length,
    skippedAlerts: snapshot.priceAlerts.length - importableAlerts.length,
    skippedTrackedProducts: snapshot.trackedProductIds.filter(id => !canonicalMap.has(id)).length,
    imagesLeftOnDevice: counts.receiptsWithImages
  };
}

export async function loadPersonalBudgetSettings(userId: string): Promise<PersonalBudgetSettings | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('monthly_budget,weekly_budget,budget_alert_threshold_pct')
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data) {
      return {
        monthlyBudget: data.monthly_budget != null ? Number(data.monthly_budget) : null,
        weeklyBudget: data.weekly_budget != null ? Number(data.weekly_budget) : null,
        alertThresholdPct: Number(data.budget_alert_threshold_pct) || 80
      };
    }
  } catch {
    // Fallback to profiles.preferences
  }
  try {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', userId)
      .maybeSingle();
    const prefs = recordValue(profileData?.preferences);
    if (prefs.monthlyBudget !== undefined || prefs.weeklyBudget !== undefined || prefs.budgetAlertThresholdPct !== undefined) {
      return {
        monthlyBudget: prefs.monthlyBudget != null ? Number(prefs.monthlyBudget) : null,
        weeklyBudget: prefs.weeklyBudget != null ? Number(prefs.weeklyBudget) : null,
        alertThresholdPct: Number(prefs.budgetAlertThresholdPct) || 80
      };
    }
  } catch {
    // Ignore
  }
  return null;
}

export async function savePersonalBudgetSettings(
  userId: string,
  settings: PersonalBudgetSettings
): Promise<void> {
  if (!userId) return;
  try {
    const { error } = await supabase.from('user_preferences').upsert(
      {
        user_id: userId,
        monthly_budget: settings.monthlyBudget,
        weekly_budget: settings.weeklyBudget,
        budget_alert_threshold_pct: settings.alertThresholdPct,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
    if (!error) return;
  } catch {
    // Fallback to profiles.preferences if migration 013 columns not yet applied
  }
  await updateProfilePreferences(userId, {
    monthlyBudget: settings.monthlyBudget,
    weeklyBudget: settings.weeklyBudget,
    budgetAlertThresholdPct: settings.alertThresholdPct
  });
}
