import type {
  ConfidenceLevel,
  PriceAlert,
  Product,
  ProductOffer,
  Receipt,
  ReceiptItem,
  ShoppingList,
  ShoppingListItem,
  Store,
  UnitType,
  VerificationStatus
} from '../types.js';
import { supabase } from '../lib/supabase.js';

interface DatabaseRow {
  [key: string]: any;
}

export interface DashboardData {
  receipts: Receipt[];
  shoppingLists: ShoppingList[];
  priceAlerts: PriceAlert[];
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
  'demo'
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
    baseReferencePrice: numberValue(row.base_reference_price)
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
    matchedProductId: stringValue(item.matchedProductId) || undefined,
    matchedProductName: stringValue(item.matchedProductName) || undefined,
    quantity: numberValue(item.quantity, 1),
    unitPrice: numberValue(item.unitPrice),
    totalPrice: numberValue(item.totalPrice),
    discount: numberValue(item.discount),
    vatRate: item.vatRate == null ? undefined : numberValue(item.vatRate),
    confidence: VALID_CONFIDENCE_LEVELS.has(confidence) ? confidence : 'medium',
    category: stringValue(item.category) as ReceiptItem['category']
  };
}

function mapReceipt(row: DatabaseRow, storeById: Map<string, Store>): Receipt {
  const extracted = recordValue(row.extracted_data);
  const items = Array.isArray(extracted.items) ? extracted.items.map(mapReceiptItem) : [];
  const storeId = stringValue(row.store_id);
  const store = storeById.get(storeId);
  const purchasedAt = stringValue(row.purchased_at) || stringValue(row.created_at);
  return {
    id: stringValue(row.id),
    storeId,
    storeName: stringValue(row.merchant_name, store?.name || 'Magazin'),
    storeAddress: stringValue(extracted.storeAddress) || undefined,
    fiscalNumber: stringValue(extracted.fiscalNumber) || undefined,
    date: purchasedAt.slice(0, 10),
    time: stringValue(extracted.time) || undefined,
    items,
    subtotal: numberValue(extracted.subtotal, numberValue(row.total_amount) + numberValue(extracted.discountTotal)),
    discountTotal: numberValue(extracted.discountTotal),
    total: numberValue(row.total_amount, numberValue(extracted.total)),
    currency: 'RON',
    createdAt: stringValue(row.created_at, purchasedAt),
    verifiedStatus: row.status === 'processed' ? 'confirmed' : 'draft'
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
  return {
    subtotal: receipt.subtotal,
    discountTotal: receipt.discountTotal,
    time: receipt.time || null,
    fiscalNumber: receipt.fiscalNumber || null,
    storeAddress: receipt.storeAddress || null,
    verifiedStatus: receipt.verifiedStatus,
    localImportId: localId || null,
    items: receipt.items.map(item => ({
      id: item.id,
      rawName: item.rawName,
      matchedProductId: item.matchedProductId || null,
      matchedProductName: item.matchedProductName || null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      discount: item.discount,
      vatRate: item.vatRate ?? null,
      confidence: item.confidence,
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

async function loadPublicCatalog(productIds: string[]): Promise<{
  products: Product[];
  productOffers: ProductOffer[];
  stores: Store[];
}> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const today = new Date().toISOString().slice(0, 10);
  const [productsResult, offersResult, storesResult] = await Promise.all([
    uniqueIds.length
      ? supabase.from('products').select(
          'id,name,brand,category,default_unit,package_weight_or_volume,package_unit,normalized_unit,barcode,image_url,is_bio,is_romanian_product,base_reference_price'
        ).in('id', uniqueIds)
      : Promise.resolve({ data: [], error: null }),
    uniqueIds.length
      ? supabase.from('product_offers').select(
          'id,product_id,store_id,source_id,price,original_price,normal_price,promo_price,loyalty_price,unit_price,unit_price_measure,is_promo,promo_details,loyalty_card_required,loyalty_card_name,valid_until,observation_date,source,confidence_level,verification_status,last_checked,is_sponsored,raw_record_id,region,batch_id,freshness_score,quality_score,freshness_status,last_collected_at,last_verified_at,is_flagged_anomaly,anomaly_reason'
        ).in('product_id', uniqueIds).eq('verification_status', 'verified').eq('is_flagged_anomaly', false)
          .or(`valid_until.is.null,valid_until.gte.${today}`).order('last_checked', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('stores').select(
      'id,name,slug,chain,brand_color,accent_color,logo_url,store_type,rating,locations_count,sample_address,is_partner'
    ).order('name')
  ]);

  throwIfError(productsResult.error, 'Nu am putut prelua produsele din catalog');
  throwIfError(offersResult.error, 'Nu am putut prelua ofertele curente');
  throwIfError(storesResult.error, 'Nu am putut prelua magazinele');
  return {
    products: (productsResult.data || []).map(mapProduct),
    productOffers: (offersResult.data || []).map(mapOffer),
    stores: (storesResult.data || []).map(mapStore)
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

export async function loadDashboardData(userId: string): Promise<DashboardData> {
  const [receiptsResult, listsResult, alertsResult, profileResult] = await Promise.all([
    supabase.from('receipts').select(
      'id,store_id,merchant_name,purchased_at,total_amount,currency,extracted_data,status,created_at'
    ).eq('user_id', userId).neq('status', 'failed').order('purchased_at', { ascending: false, nullsFirst: false }),
    supabase.from('shopping_lists').select(
      'id,user_id,name,description,is_archived,created_at,updated_at'
    ).eq('user_id', userId).order('updated_at', { ascending: false }),
    supabase.from('price_alerts').select(
      'id,user_id,product_id,target_price,is_active,created_at'
    ).eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle()
  ]);

  throwIfError(receiptsResult.error, 'Nu am putut prelua bonurile contului');
  throwIfError(listsResult.error, 'Nu am putut prelua listele contului');
  throwIfError(alertsResult.error, 'Nu am putut prelua alertele contului');
  throwIfError(profileResult.error, 'Nu am putut prelua preferințele contului');

  const listRows = listsResult.data || [];
  const listIds = listRows.map(row => stringValue(row.id)).filter(Boolean);
  const itemsResult = listIds.length
    ? await supabase.from('shopping_list_items').select(
        'id,list_id,product_id,product_name,quantity,unit,notes,is_checked,created_at,updated_at'
      ).in('list_id', listIds).order('created_at', { ascending: false })
    : { data: [], error: null };
  throwIfError(itemsResult.error, 'Nu am putut prelua produsele listelor');

  const preferences = recordValue(profileResult.data?.preferences);
  const trackedProductIds = getTrackedIds(preferences);
  const productIds = [
    ...trackedProductIds,
    ...(alertsResult.data || []).map(row => stringValue(row.product_id)),
    ...(itemsResult.data || []).map(row => stringValue(row.product_id))
  ];
  const catalog = await loadPublicCatalog(productIds);
  const productsById = new Map(catalog.products.map(product => [product.id, product]));
  const storesById = new Map(catalog.stores.map(store => [store.id, store]));
  const itemsByListId = new Map<string, ShoppingListItem[]>();

  for (const row of itemsResult.data || []) {
    const listId = stringValue(row.list_id);
    const items = itemsByListId.get(listId) || [];
    items.push(mapShoppingItem(row, productsById));
    itemsByListId.set(listId, items);
  }

  const shoppingLists: ShoppingList[] = listRows.map(row => ({
    id: stringValue(row.id),
    name: stringValue(row.name, 'Lista mea'),
    items: itemsByListId.get(stringValue(row.id)) || [],
    createdAt: stringValue(row.created_at, new Date().toISOString()),
    updatedAt: stringValue(row.updated_at, stringValue(row.created_at, new Date().toISOString())),
    isArchived: Boolean(row.is_archived)
  }));

  const offersByProduct = new Map<string, ProductOffer[]>();
  for (const offer of catalog.productOffers) {
    const productOffers = offersByProduct.get(offer.productId) || [];
    productOffers.push(offer);
    offersByProduct.set(offer.productId, productOffers);
  }

  const priceAlerts: PriceAlert[] = (alertsResult.data || []).map(row => {
    const productId = stringValue(row.product_id);
    const currentOffer = (offersByProduct.get(productId) || []).reduce<ProductOffer | null>(
      (best, offer) => !best || offer.price < best.price ? offer : best,
      null
    );
    const product = productsById.get(productId);
    return {
      id: stringValue(row.id),
      productId,
      productName: product ? `${product.name}${product.brand ? ` (${product.brand})` : ''}` : productId,
      targetPrice: numberValue(row.target_price),
      currentLowestPrice: currentOffer?.price || 0,
      lowestStoreId: currentOffer?.storeId,
      createdAt: stringValue(row.created_at).slice(0, 10),
      isActive: Boolean(row.is_active)
    };
  });

  const storeById = storesById;
  const receipts = (receiptsResult.data || []).map(row => mapReceipt(row, storeById));

  return {
    receipts,
    shoppingLists,
    priceAlerts,
    trackedProductIds,
    ...catalog,
    localDataImportedAt: stringValue(preferences.localHistoryImportedAt) || null
  };
}

export async function saveReceiptForUser(
  userId: string,
  receipt: Receipt,
  stores: Store[]
): Promise<Receipt> {
  const id = await stableUuid(userId, 'receipt', receipt.id);
  const storeId = resolveStoreId(receipt.storeId || receipt.storeName, stores);
  const payload = {
    id,
    user_id: userId,
    store_id: storeId,
    merchant_name: receipt.storeName,
    purchased_at: timestampForReceipt(receipt),
    total_amount: receipt.total,
    currency: 'RON',
    extracted_data: receiptExtractedData(receipt),
    status: receipt.verifiedStatus === 'confirmed' ? 'processed' : 'uploaded'
  };
  const { data, error } = await supabase.from('receipts').upsert(payload, { onConflict: 'id' })
    .select('id,store_id,merchant_name,purchased_at,total_amount,currency,extracted_data,status,created_at')
    .single();
  throwIfError(error, 'Nu am putut salva bonul în contul Supabase');
  if (!data) throw new Error('Supabase nu a returnat bonul salvat.');
  return mapReceipt(data, new Map(stores.map(store => [store.id, store])));
}

export async function deleteReceiptForUser(userId: string, receiptId: string): Promise<void> {
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

async function validProductIds(productIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from('products').select('id').in('id', ids);
  throwIfError(error, 'Nu am putut valida produsele din catalog');
  return new Set((data || []).map(row => stringValue(row.id)));
}

export async function saveShoppingListsForUser(
  userId: string,
  currentLists: ShoppingList[],
  nextLists: ShoppingList[]
): Promise<ShoppingList[]> {
  const normalized = await normalizeShoppingLists(userId, nextLists);
  const productIds = await validProductIds(normalized.flatMap(list => list.items.map(item => item.productId || '')));
  const safeLists = normalized.map(list => ({
    ...list,
    items: list.items.map(item => productIds.has(item.productId || '') ? item : { ...item, productId: undefined })
  }));

  const listRows = safeLists.map(list => ({
    id: list.id,
    user_id: userId,
    name: list.name,
    description: null,
    is_archived: Boolean(list.isArchived),
    updated_at: list.updatedAt || new Date().toISOString()
  }));
  for (const batch of chunks(listRows)) {
    const { error } = await supabase.from('shopping_lists').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut salva listele de cumpărături');
  }

  const itemRows = safeLists.flatMap(list => list.items.map(item => ({
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

  const nextListIds = new Set(safeLists.map(list => list.id));
  for (const currentList of currentLists) {
    if (!isUuid(currentList.id)) continue;
    const nextList = safeLists.find(list => list.id === currentList.id);
    const nextItemIds = new Set(nextList?.items.map(item => item.id) || []);
    const removedItemIds = currentList.items.map(item => item.id).filter(id => isUuid(id) && !nextItemIds.has(id));
    if (removedItemIds.length) {
      const { error } = await supabase.from('shopping_list_items').delete()
        .eq('list_id', currentList.id).in('id', removedItemIds);
      throwIfError(error, 'Nu am putut șterge produsele eliminate din listă');
    }
    if (!nextListIds.has(currentList.id)) {
      const { error } = await supabase.from('shopping_lists').delete()
        .eq('id', currentList.id).eq('user_id', userId);
      throwIfError(error, 'Nu am putut șterge lista eliminată');
    }
  }

  return safeLists;
}

export async function savePriceAlertsForUser(
  userId: string,
  currentAlerts: PriceAlert[],
  nextAlerts: PriceAlert[]
): Promise<PriceAlert[]> {
  const normalized: PriceAlert[] = [];
  for (const alert of nextAlerts) {
    normalized.push({
      ...alert,
      id: isUuid(alert.id) ? alert.id : await stableUuid(userId, 'price-alert', alert.id)
    });
  }
  const validIds = await validProductIds(normalized.map(alert => alert.productId));
  if (normalized.some(alert => !validIds.has(alert.productId))) {
    throw new Error('Unul dintre produsele alertei nu există în catalogul Supabase.');
  }

  const rows = normalized.map(alert => ({
    id: alert.id,
    user_id: userId,
    product_id: alert.productId,
    target_price: alert.targetPrice,
    is_active: alert.isActive,
    created_at: alert.createdAt
  }));
  for (const batch of chunks(rows)) {
    const { error } = await supabase.from('price_alerts').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut salva alertele de preț');
  }

  const nextIds = new Set(normalized.map(alert => alert.id));
  const removedIds = currentAlerts.map(alert => alert.id).filter(id => isUuid(id) && !nextIds.has(id));
  if (removedIds.length) {
    const { error } = await supabase.from('price_alerts').delete().eq('user_id', userId).in('id', removedIds);
    throwIfError(error, 'Nu am putut șterge alertele eliminate');
  }
  return normalized;
}

export async function saveTrackedProductsForUser(userId: string, productIds: string[]): Promise<string[]> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const validIds = await validProductIds(uniqueIds);
  if (uniqueIds.some(id => !validIds.has(id))) {
    throw new Error('Unul dintre produsele urmărite nu există în catalogul Supabase.');
  }
  await updateProfilePreferences(userId, { trackedProductIds: uniqueIds });
  return uniqueIds;
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
    ...snapshot.shoppingLists.flatMap(list => list.items.map(item => item.productId || ''))
  ];
  const productIds = await validProductIds(localProductIds);

  const receiptRows = await Promise.all(snapshot.receipts.map(async receipt => ({
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
    product_id: productIds.has(item.productId || '') ? item.productId : null,
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

  const importableAlerts = snapshot.priceAlerts.filter(alert =>
    productIds.has(alert.productId) && numberValue(alert.targetPrice) > 0
  );
  const alertRows = await Promise.all(importableAlerts.map(async alert => ({
    id: await stableUuid(userId, 'imported-alert', alert.id),
    user_id: userId,
    product_id: alert.productId,
    target_price: alert.targetPrice,
    is_active: alert.isActive,
    created_at: alert.createdAt || new Date().toISOString()
  })));
  for (const batch of chunks(alertRows)) {
    const { error } = await supabase.from('price_alerts').upsert(batch, { onConflict: 'id' });
    throwIfError(error, 'Nu am putut importa alertele locale');
  }

  const importedTrackedProductIds = snapshot.trackedProductIds.filter(id => productIds.has(id));
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
    skippedTrackedProducts: snapshot.trackedProductIds.length - importedTrackedProductIds.length,
    imagesLeftOnDevice: counts.receiptsWithImages
  };
}
