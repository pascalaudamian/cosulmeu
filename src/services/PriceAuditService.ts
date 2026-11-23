// src/services/PriceAuditService.ts
// Serviciu pentru auditul prețurilor publicate, detecția confuziei cantitate/preț și remedierea sigură

import {
  PriceAuditCategory,
  PriceAuditItem,
  PriceAuditSummary,
  PriceAuditBatchPreviewItem,
  PriceAuditRemediationResult,
  Product,
  ProductOffer,
  VerificationStatus
} from '../types.ts';
import { getPool, fetchAllSupabaseRows } from '../db/index.ts';
import { supabase } from '../lib/supabase.ts';
import { StorageService } from './StorageService.ts';
import { PriceExtractor } from '../indexing/catalog/PriceExtractor.ts';
import { STORES } from '../data/mockData.ts';
import { PriceAuditRemediationItemInput } from '../server/validation.ts';
import {
  buildCanonicalAliasIndex,
  collectProductIdsForCanonical,
  resolveCanonicalProductDetail
} from './ProductIdentityService.ts';

interface RawOfferRow {
  id: string;
  product_id: string;
  store_id: string;
  source_id?: string | null;
  price: number | string;
  original_price?: number | string | null;
  normal_price?: number | string | null;
  promo_price?: number | string | null;
  loyalty_price?: number | string | null;
  unit_price?: number | string | null;
  unit_price_measure?: string | null;
  is_promo?: boolean;
  promo_details?: string | null;
  verification_status?: string | null;
  is_flagged_anomaly?: boolean | null;
  anomaly_reason?: string | null;
  last_verified_at?: string | null;
  observation_date?: string | null;
}

interface RawProductRow {
  id: string;
  canonical_product_id?: string | null;
  name: string;
  brand?: string | null;
  package_weight_or_volume?: number | string | null;
  package_unit?: string | null;
  normalized_unit?: string | null;
  base_reference_price?: number | string | null;
}

interface RawStagingRow {
  id: string;
  document_id?: string | null;
  retailer_id: string;
  matched_product_id?: string | null;
  raw_title: string;
  normal_price?: number | string | null;
  promo_price?: number | string | null;
  effective_price?: number | string | null;
  package_quantity?: number | string | null;
  package_unit?: string | null;
  created_at?: string | null;
}

interface RawDocRow {
  id: string;
  title?: string | null;
  document_url?: string | null;
}

function normalizeStoreId(raw: string): string {
  return (raw || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
}

function normalizeTitleKey(title: string): string {
  return (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

export function computeNormalizedUnitPrice(
  price: number,
  packageQty: number,
  packageUnit: string
): { unitPrice: number; unitPriceMeasure: 'lei/kg' | 'lei/l' | 'lei/buc' } {
  const safePrice = Number.isFinite(price) && price > 0 ? price : 0;
  const qty = Number.isFinite(packageQty) && packageQty > 0 ? packageQty : 1;
  const unit = (packageUnit || 'buc').toLowerCase().trim();

  let unitPrice = safePrice;
  let measure: 'lei/kg' | 'lei/l' | 'lei/buc' = 'lei/buc';

  if (unit === 'g') {
    unitPrice = (safePrice / qty) * 1000;
    measure = 'lei/kg';
  } else if (unit === 'kg') {
    unitPrice = safePrice / qty;
    measure = 'lei/kg';
  } else if (unit === 'ml') {
    unitPrice = (safePrice / qty) * 1000;
    measure = 'lei/l';
  } else if (unit === 'l') {
    unitPrice = safePrice / qty;
    measure = 'lei/l';
  } else {
    unitPrice = safePrice / Math.max(qty, 1);
    measure = 'lei/buc';
  }

  return {
    unitPrice: Math.round(unitPrice * 100) / 100,
    unitPriceMeasure: measure
  };
}

export class PriceAuditService {
  private static isIsolatedTestMode(): boolean {
    return process.env.COSUL_MEU_ISOLATED_TEST === '1';
  }

  private static async loadRawDataset(): Promise<{
    offers: RawOfferRow[];
    products: RawProductRow[];
    storesMap: Map<string, string>;
    stagingRows: RawStagingRow[];
    docsMap: Map<string, RawDocRow>;
  }> {
    const storesMap = new Map<string, string>();
    for (const s of STORES) {
      storesMap.set(normalizeStoreId(s.id), s.name);
    }

    if (!this.isIsolatedTestMode()) {
      const pool = getPool();
      if (pool) {
        try {
          const [offersRes, productsRes, storesRes, stagingRes, docsRes] = await Promise.all([
            pool.query('SELECT * FROM product_offers'),
            pool.query('SELECT id, canonical_product_id, name, brand, package_weight_or_volume, package_unit, normalized_unit, base_reference_price FROM products'),
            pool.query('SELECT id, name FROM stores'),
            pool.query('SELECT id, document_id, retailer_id, matched_product_id, raw_title, normal_price, promo_price, effective_price, package_quantity, package_unit, created_at FROM catalog_extracted_offers ORDER BY created_at DESC LIMIT 5000'),
            pool.query('SELECT id, title, document_url FROM catalog_documents')
          ]);

          for (const st of storesRes.rows) {
            storesMap.set(normalizeStoreId(st.id), st.name);
          }
          const docsMap = new Map<string, RawDocRow>();
          for (const d of docsRes.rows) {
            docsMap.set(d.id, d);
          }

          return {
            offers: offersRes.rows,
            products: productsRes.rows,
            storesMap,
            stagingRows: stagingRes.rows,
            docsMap
          };
        } catch (err: any) {
          console.warn('Postgres loadRawDataset failed, falling back to Supabase:', err.message);
        }
      }

      try {
        const [offersRes, productsRes, storesRes, stagingRes, docsRes] = await Promise.all([
          fetchAllSupabaseRows<RawOfferRow>((from, to) => supabase.from('product_offers').select('*').range(from, to)),
          fetchAllSupabaseRows<RawProductRow>((from, to) =>
            supabase
              .from('products')
              .select('id, canonical_product_id, name, brand, package_weight_or_volume, package_unit, normalized_unit, base_reference_price')
              .range(from, to)
          ),
          supabase.from('stores').select('id, name'),
          fetchAllSupabaseRows<RawStagingRow>((from, to) =>
            supabase
              .from('catalog_extracted_offers')
              .select('id, document_id, retailer_id, matched_product_id, raw_title, normal_price, promo_price, effective_price, package_quantity, package_unit, created_at')
              .order('created_at', { ascending: false })
              .range(from, to)
          ),
          fetchAllSupabaseRows<RawDocRow>((from, to) =>
            supabase.from('catalog_documents').select('id, title, document_url').range(from, to)
          )
        ]);

        if (!offersRes.error && !productsRes.error) {
          for (const st of storesRes.data || []) {
            storesMap.set(normalizeStoreId(st.id), st.name);
          }
          const docsMap = new Map<string, RawDocRow>();
          for (const d of docsRes.data || []) {
            docsMap.set(d.id, d);
          }
          return {
            offers: offersRes.data,
            products: productsRes.data,
            storesMap,
            stagingRows: stagingRes.data || [],
            docsMap
          };
        }
      } catch (err: any) {
        console.warn('Supabase loadRawDataset failed, falling back to StorageService:', err.message);
      }
    }

    // Fallback in-memory (utilizat și în modul de test izolat)
    const memProducts = StorageService.getAllProducts();
    const memOffers = StorageService.getProductOffers();
    const memStores = StorageService.getStores();
    const memStaging = StorageService.getCatalogExtractedOffers();
    const memDocs = StorageService.getCatalogDocuments();

    for (const s of memStores) {
      storesMap.set(normalizeStoreId(s.id), s.name);
    }

    const docsMap = new Map<string, RawDocRow>();
    for (const d of memDocs) {
      docsMap.set(d.id, { id: d.id, title: d.title, document_url: d.documentUrl });
    }

    return {
      offers: memOffers.map(o => ({
        id: o.id,
        product_id: o.productId,
        store_id: o.storeId,
        source_id: o.sourceId || null,
        price: o.price,
        original_price: o.originalPrice ?? null,
        normal_price: o.normalPrice ?? null,
        promo_price: o.promoPrice ?? null,
        loyalty_price: o.loyaltyPrice ?? null,
        unit_price: o.unitPrice,
        unit_price_measure: o.unitPriceMeasure,
        is_promo: o.isPromo,
        promo_details: o.promoDetails ?? null,
        verification_status: o.verificationStatus,
        is_flagged_anomaly: Boolean(o.isFlaggedAnomaly),
        anomaly_reason: o.anomalyReason ?? null,
        last_verified_at: o.lastVerifiedAt ?? null,
        observation_date: o.observationDate
      })),
      products: memProducts.map(p => ({
        id: p.id,
        canonical_product_id: (p as Product & { canonicalProductId?: string | null }).canonicalProductId ?? null,
        name: p.name,
        brand: p.brand,
        package_weight_or_volume: p.packageWeightOrVolume,
        package_unit: p.packageUnit,
        normalized_unit: p.normalizedUnit,
        base_reference_price: p.baseReferencePrice
      })),
      storesMap,
      stagingRows: memStaging.map(st => ({
        id: st.id,
        document_id: st.documentId,
        retailer_id: st.retailerId,
        matched_product_id: st.matchedProductId ?? null,
        raw_title: st.rawTitle,
        normal_price: st.normalPrice ?? null,
        promo_price: st.promoPrice ?? null,
        effective_price: st.effectivePrice ?? null,
        package_quantity: st.packageQuantity ?? null,
        package_unit: st.packageUnit ?? null,
        created_at: st.createdAt
      })),
      docsMap
    };
  }

  private static classifyAuditItem(
    offer: RawOfferRow,
    product: RawProductRow | undefined,
    storeName: string,
    matchedStaging: RawStagingRow | undefined,
    sourceDoc: RawDocRow | undefined
  ): { item: PriceAuditItem; isQuantityConfused: boolean; isLowPriceValid: boolean } {
    const storeId = normalizeStoreId(offer.store_id);
    const productName = product?.name || matchedStaging?.raw_title || offer.product_id;
    const pkgQty = Number(product?.package_weight_or_volume ?? matchedStaging?.package_quantity ?? 1) || 1;
    const pkgUnit = String(product?.package_unit || matchedStaging?.package_unit || 'buc');
    const currentPrice = Number(offer.price) || 0;
    const normalPrice = parseNullableNumber(offer.normal_price) ?? parseNullableNumber(offer.original_price);
    const promoPrice = parseNullableNumber(offer.promo_price);
    const originalPrice = parseNullableNumber(offer.original_price);
    const verificationStatus = (offer.verification_status || 'unverified') as VerificationStatus;
    const isFlaggedAnomaly = Boolean(offer.is_flagged_anomaly);

    const extractedEffectivePrice = parseNullableNumber(matchedStaging?.effective_price);
    const extractedNormalPrice = parseNullableNumber(matchedStaging?.normal_price);
    const extractedPromoPrice = parseNullableNumber(matchedStaging?.promo_price);

    const validation = PriceExtractor.validateOfferPrice({
      title: productName,
      effectivePrice: currentPrice,
      normalPrice,
      promoPrice,
      unitPrice: parseNullableNumber(offer.unit_price),
      packageQuantity: pkgQty,
      packageUnit: pkgUnit,
      isVerifiedOverride: verificationStatus === 'verified' && !isFlaggedAnomaly
    });

    const qtyConfCheck = PriceExtractor.detectQuantityAsPrice({
      title: productName,
      effectivePrice: currentPrice,
      packageQuantity: pkgQty,
      packageUnit: pkgUnit
    });

    const isLowPriceValid =
      currentPrice > 0 &&
      currentPrice < 1.5 &&
      !qtyConfCheck.isConfused &&
      PriceExtractor.isValidSmallCommercialPrice(productName, currentPrice) &&
      validation.status !== 'INVALID';

    let auditCategory: Exclude<PriceAuditCategory, 'all' | 'anomalies'> = 'valid_verified';
    let auditReason = 'Ofertă verificată și conformă cu regulile preț/ambalaj.';

    const stagingDiffersSignificantly =
      extractedEffectivePrice !== null &&
      extractedEffectivePrice > 0 &&
      Math.abs(extractedEffectivePrice - currentPrice) > 0.05 &&
      (qtyConfCheck.isConfused || validation.status !== 'VALID');

    if (verificationStatus === 'isolated' || verificationStatus === 'rejected') {
      auditCategory = 'isolated';
      auditReason = offer.anomaly_reason || validation.reasons[0] || 'Ofertă izolată din catalogul public până la verificare.';
    } else if (
      validation.status === 'INVALID' ||
      validation.status === 'MISSING' ||
      qtyConfCheck.isConfused ||
      stagingDiffersSignificantly
    ) {
      auditCategory = 'confirmed_wrong';
      auditReason =
        offer.anomaly_reason ||
        qtyConfCheck.reason ||
        validation.reasons[0] ||
        `Prețul publicat (${currentPrice.toFixed(2)} RON) diferă de sursa extrasă (${extractedEffectivePrice?.toFixed(2)} RON).`;
    } else if (
      isFlaggedAnomaly ||
      validation.status === 'WARNING' ||
      (currentPrice < 1.5 && !isLowPriceValid && verificationStatus !== 'verified')
    ) {
      auditCategory = 'suspect_unverified';
      auditReason =
        offer.anomaly_reason ||
        validation.reasons[0] ||
        `Preț sub 1.50 RON (${currentPrice.toFixed(2)} RON) ce necesită verificare față de documentul sursă.`;
    } else if (verificationStatus !== 'verified') {
      auditCategory = 'suspect_unverified';
      auditReason = 'Preț plauzibil, dar oferta nu a fost încă marcată verified.';
    }

    const resolvedProductId = product?.id || offer.product_id;
    const item: PriceAuditItem = {
      offerId: offer.id,
      productId: resolvedProductId,
      originalProductId: product?.id && product.id !== offer.product_id ? offer.product_id : undefined,
      productName,
      brand: String(product?.brand || 'Nespecificat'),
      storeId,
      storeName,
      packageWeightOrVolume: pkgQty,
      packageUnit: pkgUnit,
      currentPrice,
      normalPrice,
      promoPrice,
      originalPrice,
      unitPrice: Number(offer.unit_price) || currentPrice,
      unitPriceMeasure: offer.unit_price_measure || 'lei/buc',
      isPromo: Boolean(offer.is_promo),
      promoDetails: offer.promo_details || undefined,
      verificationStatus,
      isFlaggedAnomaly,
      anomalyReason: offer.anomaly_reason || undefined,
      auditCategory,
      auditReason,
      sourceDocumentId: matchedStaging?.document_id || undefined,
      sourceDocumentTitle: sourceDoc?.title || undefined,
      sourceDocumentUrl: sourceDoc?.document_url || undefined,
      extractedRawTitle: matchedStaging?.raw_title || undefined,
      extractedNormalPrice,
      extractedPromoPrice,
      extractedEffectivePrice,
      lastVerifiedAt: offer.last_verified_at || undefined,
      observationDate: offer.observation_date ? String(offer.observation_date).slice(0, 10) : new Date().toISOString().slice(0, 10)
    };

    return {
      item,
      isQuantityConfused: qtyConfCheck.isConfused || validation.code === 'QUANTITY_AS_PRICE',
      isLowPriceValid
    };
  }

  static async getPriceAuditData(params: {
    category?: PriceAuditCategory;
    retailerId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    summary: PriceAuditSummary;
    items: PriceAuditItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const category = params.category || 'all';
    const retailerFilter = normalizeStoreId(params.retailerId || 'toate');
    const searchLower = (params.search || '').trim().toLowerCase();
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(200, Math.max(1, params.limit || 25));

    const { offers, products, storesMap, stagingRows, docsMap } = await this.loadRawDataset();
    const productById = new Map<string, RawProductRow>();
    for (const p of products) {
      productById.set(p.id, p);
    }
    const aliasIndex = buildCanonicalAliasIndex(products);

    // Indexăm staging rows după matched_product_id (+ echivalent canonic) + retailer și după titlu normalizat + retailer
    const stagingByProdRetailer = new Map<string, RawStagingRow>();
    const stagingByTitleRetailer = new Map<string, RawStagingRow>();
    for (const st of stagingRows) {
      const rKey = normalizeStoreId(st.retailer_id);
      if (st.matched_product_id) {
        const key = `${rKey}::${st.matched_product_id}`;
        if (!stagingByProdRetailer.has(key)) stagingByProdRetailer.set(key, st);
        const stCanon = resolveCanonicalProductDetail(st.matched_product_id, aliasIndex);
        if (stCanon.found && stCanon.canonicalId && !stCanon.cycleDetected) {
          const canonKey = `${rKey}::${stCanon.canonicalId}`;
          if (!stagingByProdRetailer.has(canonKey)) stagingByProdRetailer.set(canonKey, st);
        }
      }
      const titleKey = `${rKey}::${normalizeTitleKey(st.raw_title)}`;
      if (titleKey && !stagingByTitleRetailer.has(titleKey)) {
        stagingByTitleRetailer.set(titleKey, st);
      }
    }

    const activeOffers = offers.filter(o => o.verification_status !== 'demo');

    let suspectCount = 0;
    let quantityConfusedCount = 0;
    let isolatedCount = 0;
    let verifiedCount = 0;
    let lowPriceValidCount = 0;
    const retailerAnomalyCounts = new Map<string, { storeId: string; storeName: string; count: number }>();

    const allClassified: PriceAuditItem[] = [];

    for (const offer of activeOffers) {
      const storeId = normalizeStoreId(offer.store_id);
      const storeName = storesMap.get(storeId) || storeId.toUpperCase();
      const canonDetail = resolveCanonicalProductDetail(offer.product_id, aliasIndex);
      const effectiveProd =
        canonDetail.found && canonDetail.canonicalId && !canonDetail.cycleDetected
          ? productById.get(canonDetail.canonicalId)
          : !canonDetail.cycleDetected
          ? productById.get(offer.product_id)
          : undefined;

      let matchedStaging = stagingByProdRetailer.get(`${storeId}::${offer.product_id}`);
      if (!matchedStaging && effectiveProd && effectiveProd.id !== offer.product_id) {
        matchedStaging = stagingByProdRetailer.get(`${storeId}::${effectiveProd.id}`);
      }
      if (!matchedStaging && effectiveProd?.name) {
        matchedStaging = stagingByTitleRetailer.get(`${storeId}::${normalizeTitleKey(effectiveProd.name)}`);
      }
      const sourceDoc = matchedStaging?.document_id ? docsMap.get(matchedStaging.document_id) : undefined;

      const { item, isQuantityConfused, isLowPriceValid } = this.classifyAuditItem(
        offer,
        effectiveProd,
        storeName,
        matchedStaging,
        sourceDoc
      );

      allClassified.push(item);

      if (isQuantityConfused) quantityConfusedCount++;
      if (isLowPriceValid) lowPriceValidCount++;

      if (item.auditCategory === 'isolated') {
        isolatedCount++;
      } else if (item.auditCategory === 'confirmed_wrong' || item.auditCategory === 'suspect_unverified') {
        suspectCount++;
        const prev = retailerAnomalyCounts.get(storeId) || { storeId, storeName, count: 0 };
        prev.count++;
        retailerAnomalyCounts.set(storeId, prev);
      } else if (item.auditCategory === 'valid_verified') {
        verifiedCount++;
      }
    }

    const filtered = allClassified.filter(item => {
      if (category === 'anomalies') {
        if (item.auditCategory === 'valid_verified') return false;
      } else if (category !== 'all' && item.auditCategory !== category) {
        return false;
      }
      if (retailerFilter && retailerFilter !== 'toate' && retailerFilter !== 'all' && item.storeId !== retailerFilter) {
        return false;
      }
      if (searchLower) {
        const hay = `${item.productName} ${item.brand} ${item.storeName} ${item.auditReason}`.toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }
      return true;
    });

    const severityRank: Record<Exclude<PriceAuditCategory, 'all' | 'anomalies'>, number> = {
      confirmed_wrong: 0,
      suspect_unverified: 1,
      isolated: 2,
      valid_verified: 3
    };
    filtered.sort((a, b) => {
      const rankDiff = severityRank[a.auditCategory] - severityRank[b.auditCategory];
      if (rankDiff !== 0) return rankDiff;
      return a.currentPrice - b.currentPrice;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * limit;
    const items = filtered.slice(startIdx, startIdx + limit);

    return {
      summary: {
        totalPublishedOffers: activeOffers.length,
        suspectCount,
        quantityConfusedCount,
        isolatedCount,
        verifiedCount,
        lowPriceValidCount,
        retailersAffected: Array.from(retailerAnomalyCounts.values()).sort((a, b) => b.count - a.count)
      },
      items,
      total,
      page: safePage,
      limit,
      totalPages
    };
  }

  static async remediateOffers(params: {
    items: PriceAuditRemediationItemInput[];
    dryRun?: boolean;
    userEmail?: string;
    ipAddress?: string;
  }): Promise<PriceAuditRemediationResult> {
    const dryRun = Boolean(params.dryRun);
    const userEmail = params.userEmail || 'admin@cosulmeu.ro';
    const previews: PriceAuditBatchPreviewItem[] = [];
    const errors: string[] = [];

    const { offers, products } = await this.loadRawDataset();
    const offerById = new Map<string, RawOfferRow>(offers.map(o => [o.id, o]));
    const productById = new Map<string, RawProductRow>(products.map(p => [p.id, p]));
    const aliasIndex = buildCanonicalAliasIndex(products);

    let affectedOffersCount = 0;
    let updatedProductsCount = 0;
    let updatedStagingCount = 0;
    let updatedPromotionsCount = 0;
    let auditLogRecorded = false;

    const validWorkItems: {
      req: PriceAuditRemediationItemInput;
      offer: RawOfferRow;
      product?: RawProductRow;
      canonicalProductId: string;
      equivalentProductIds: string[];
      newUnitPrice?: number;
      newUnitMeasure?: 'lei/kg' | 'lei/l' | 'lei/buc';
      newNormalPrice?: number | null;
      newPromoPrice?: number | null;
    }[] = [];

    for (const req of params.items) {
      const existingOffer = offerById.get(req.offerId);
      if (!existingOffer) {
        errors.push(`Oferta ${req.offerId} nu a fost găsită.`);
        continue;
      }

      const canonDetail = resolveCanonicalProductDetail(existingOffer.product_id, aliasIndex);
      if (canonDetail.cycleDetected) {
        errors.push(`Oferta ${req.offerId} referă un lanț canonic invalid/ciclic (${existingOffer.product_id}); remedierea a fost blocată.`);
        continue;
      }

      const canonicalProductId =
        canonDetail.found && canonDetail.canonicalId ? canonDetail.canonicalId : existingOffer.product_id;
      const product = productById.get(canonicalProductId) || productById.get(existingOffer.product_id);
      const equivalentSet = new Set<string>([
        existingOffer.product_id,
        canonicalProductId,
        ...collectProductIdsForCanonical(canonicalProductId, aliasIndex)
      ]);
      const equivalentProductIds = Array.from(equivalentSet);

      const productName = product?.name || existingOffer.product_id;
      const oldPrice = Number(existingOffer.price) || 0;
      const oldVerificationStatus = (existingOffer.verification_status || 'unverified') as VerificationStatus;

      if (req.action === 'fix_price') {
        const newPrice = Number(req.newPrice);
        const validation = PriceExtractor.validateOfferPrice({
          title: productName,
          effectivePrice: newPrice,
          normalPrice: req.newNormalPrice ?? null,
          promoPrice: req.newPromoPrice ?? null,
          packageQuantity: Number(product?.package_weight_or_volume || 1),
          packageUnit: product?.package_unit || 'buc'
        });

        if (validation.status === 'INVALID' || validation.status === 'MISSING') {
          errors.push(`Prețul propus pentru „${productName}” (${newPrice} RON) a fost respins: ${validation.reasons.join(' ')}`);
          continue;
        }

        const { unitPrice, unitPriceMeasure } = computeNormalizedUnitPrice(
          newPrice,
          Number(product?.package_weight_or_volume || 1),
          String(product?.package_unit || 'buc')
        );

        const resolvedPromoPrice = req.newPromoPrice ?? (existingOffer.is_promo ? newPrice : null);
        const resolvedNormalPrice = req.newNormalPrice ?? parseNullableNumber(existingOffer.normal_price) ?? newPrice;

        previews.push({
          offerId: existingOffer.id,
          productName,
          storeId: normalizeStoreId(existingOffer.store_id),
          action: 'fix_price',
          oldPrice,
          newPrice,
          oldVerificationStatus,
          newVerificationStatus: 'verified',
          reason: req.reason || 'Corecție manuală preț verificat din sursă oficială.'
        });

        validWorkItems.push({
          req,
          offer: existingOffer,
          product,
          canonicalProductId,
          equivalentProductIds,
          newUnitPrice: unitPrice,
          newUnitMeasure: unitPriceMeasure,
          newNormalPrice: resolvedNormalPrice,
          newPromoPrice: resolvedPromoPrice
        });
      } else if (req.action === 'isolate') {
        previews.push({
          offerId: existingOffer.id,
          productName,
          storeId: normalizeStoreId(existingOffer.store_id),
          action: 'isolate',
          oldPrice,
          oldVerificationStatus,
          newVerificationStatus: 'isolated',
          reason: req.reason || 'Izolare din catalogul public până la confirmarea prețului.'
        });
        validWorkItems.push({ req, offer: existingOffer, product, canonicalProductId, equivalentProductIds });
      } else if (req.action === 'verify') {
        previews.push({
          offerId: existingOffer.id,
          productName,
          storeId: normalizeStoreId(existingOffer.store_id),
          action: 'verify',
          oldPrice,
          newPrice: oldPrice,
          oldVerificationStatus,
          newVerificationStatus: 'verified',
          reason: req.reason || 'Confirmare manuală validitate preț comercial.'
        });
        validWorkItems.push({ req, offer: existingOffer, product, canonicalProductId, equivalentProductIds });
      }
    }

    if (dryRun) {
      return {
        success: errors.length === 0 || previews.length > 0,
        dryRun: true,
        affectedOffersCount: previews.length,
        updatedProductsCount: previews.filter(p => p.action === 'fix_price').length,
        updatedStagingCount: 0,
        updatedPromotionsCount: 0,
        auditLogRecorded: false,
        previews,
        errors
      };
    }

    const nowIso = new Date().toISOString();

    if (this.isIsolatedTestMode()) {
      const memOffers = StorageService.getProductOffers();
      const memProducts = StorageService.getAllProducts();
      const memStaging = StorageService.getCatalogExtractedOffers();

      for (const work of validWorkItems) {
        const idx = memOffers.findIndex(o => o.id === work.offer.id);
        if (idx === -1) continue;
        const cur: ProductOffer = { ...memOffers[idx] };
        if (work.req.action === 'fix_price' && work.req.newPrice) {
          cur.price = work.req.newPrice;
          cur.normalPrice = work.newNormalPrice ?? cur.normalPrice;
          cur.promoPrice = work.newPromoPrice ?? cur.promoPrice;
          cur.originalPrice =
            work.newNormalPrice && work.newNormalPrice > work.req.newPrice ? work.newNormalPrice : undefined;
          cur.unitPrice = work.newUnitPrice || cur.price;
          cur.unitPriceMeasure = work.newUnitMeasure || cur.unitPriceMeasure;
          cur.verificationStatus = 'verified';
          cur.isFlaggedAnomaly = false;
          cur.anomalyReason = undefined;
          cur.lastVerifiedAt = nowIso;
          affectedOffersCount++;

          const pIdx = memProducts.findIndex(p => p.id === work.canonicalProductId);
          if (pIdx !== -1) {
            memProducts[pIdx] = { ...memProducts[pIdx], baseReferencePrice: work.req.newPrice };
            updatedProductsCount++;
          }
          const equivSet = new Set(work.equivalentProductIds);
          for (let sIdx = 0; sIdx < memStaging.length; sIdx++) {
            if (
              memStaging[sIdx].matchedProductId &&
              equivSet.has(memStaging[sIdx].matchedProductId!) &&
              normalizeStoreId(memStaging[sIdx].retailerId) === normalizeStoreId(cur.storeId)
            ) {
              memStaging[sIdx] = {
                ...memStaging[sIdx],
                effectivePrice: work.req.newPrice,
                normalPrice: work.newNormalPrice ?? memStaging[sIdx].normalPrice,
                promoPrice: work.newPromoPrice ?? memStaging[sIdx].promoPrice,
                priceValidationStatus: 'VALID',
                updatedAt: nowIso
              };
              updatedStagingCount++;
            }
          }
        } else if (work.req.action === 'isolate') {
          cur.verificationStatus = 'isolated';
          cur.isFlaggedAnomaly = true;
          cur.anomalyReason = work.req.reason || 'Izolat prin Audit Prețuri';
          affectedOffersCount++;
        } else if (work.req.action === 'verify') {
          cur.verificationStatus = 'verified';
          cur.isFlaggedAnomaly = false;
          cur.anomalyReason = undefined;
          cur.lastVerifiedAt = nowIso;
          affectedOffersCount++;
        }
        memOffers[idx] = cur;
      }

      StorageService.saveProductOffers(memOffers);
      for (const work of validWorkItems) {
        if (work.req.action === 'fix_price' && work.req.newPrice) {
          const p = memProducts.find(mp => mp.id === work.canonicalProductId);
          if (p) StorageService.addCustomProduct(p);
        }
      }
      StorageService.saveCatalogExtractedOffers(memStaging);

      return {
        success: true,
        dryRun: false,
        affectedOffersCount,
        updatedProductsCount,
        updatedStagingCount,
        updatedPromotionsCount: 0,
        auditLogRecorded: true,
        previews,
        errors
      };
    }

    const pool = getPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const work of validWorkItems) {
          if (work.req.action === 'fix_price' && work.req.newPrice) {
            const newPrice = work.req.newPrice;
            const origPrice = work.newNormalPrice && work.newNormalPrice > newPrice ? work.newNormalPrice : null;
            await client.query(
              `UPDATE product_offers
               SET price = $1, normal_price = $2, promo_price = $3, original_price = $4,
                   unit_price = $5, unit_price_measure = $6,
                   verification_status = 'verified', is_flagged_anomaly = false, anomaly_reason = NULL,
                   last_verified_at = NOW(), updated_at = NOW()
               WHERE id = $7`,
              [
                newPrice,
                work.newNormalPrice ?? null,
                work.newPromoPrice ?? null,
                origPrice,
                work.newUnitPrice ?? newPrice,
                work.newUnitMeasure || 'lei/buc',
                work.offer.id
              ]
            );
            affectedOffersCount++;

            const prodRes = await client.query(
              'UPDATE products SET base_reference_price = $1, updated_at = NOW() WHERE id = $2',
              [newPrice, work.canonicalProductId]
            );
            updatedProductsCount += prodRes.rowCount || 0;

            const stgRes = await client.query(
              `UPDATE catalog_extracted_offers
               SET effective_price = $1, normal_price = COALESCE($2, normal_price),
                   promo_price = $3, price_validation_status = 'VALID', updated_at = NOW()
               WHERE matched_product_id = ANY($4::varchar[]) AND retailer_id = $5`,
              [
                newPrice,
                work.newNormalPrice ?? null,
                work.newPromoPrice ?? null,
                work.equivalentProductIds,
                normalizeStoreId(work.offer.store_id)
              ]
            );
            updatedStagingCount += stgRes.rowCount || 0;

            // ATENȚIE: promotions nu are coloana updated_at
            const prmRes = await client.query(
              `UPDATE promotions
               SET normal_price = COALESCE($1, normal_price),
                   promo_price = COALESCE($2, promo_price)
               WHERE product_id = ANY($3::varchar[]) AND retailer_id = $4`,
              [
                work.newNormalPrice ?? null,
                work.newPromoPrice ?? newPrice,
                work.equivalentProductIds,
                normalizeStoreId(work.offer.store_id)
              ]
            );
            updatedPromotionsCount += prmRes.rowCount || 0;
          } else if (work.req.action === 'isolate') {
            await client.query(
              `UPDATE product_offers
               SET verification_status = 'isolated', is_flagged_anomaly = true, anomaly_reason = $1, updated_at = NOW()
               WHERE id = $2`,
              [work.req.reason || 'Izolat prin Audit Prețuri.', work.offer.id]
            );
            affectedOffersCount++;
          } else if (work.req.action === 'verify') {
            await client.query(
              `UPDATE product_offers
               SET verification_status = 'verified', is_flagged_anomaly = false, anomaly_reason = NULL,
                   last_verified_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [work.offer.id]
            );
            affectedOffersCount++;
          }
        }

        try {
          await client.query(
            `INSERT INTO admin_audit_logs (id, user_email, action, target_type, target_id, details, ip_address, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
              `audit-pa-${Date.now()}`,
              userEmail,
              'price_audit_remediation',
              'product_offers',
              previews.slice(0, 5).map(p => p.offerId).join(','),
              JSON.stringify({ affectedOffersCount, previews: previews.slice(0, 20) }),
              params.ipAddress || null
            ]
          );
          auditLogRecorded = true;
        } catch {
          auditLogRecorded = false;
        }

        await client.query('COMMIT');
        return {
          success: true,
          dryRun: false,
          affectedOffersCount,
          updatedProductsCount,
          updatedStagingCount,
          updatedPromotionsCount,
          auditLogRecorded,
          previews,
          errors
        };
      } catch (err: any) {
        await client.query('ROLLBACK');
        return {
          success: false,
          dryRun: false,
          affectedOffersCount: 0,
          updatedProductsCount: 0,
          updatedStagingCount: 0,
          updatedPromotionsCount: 0,
          auditLogRecorded: false,
          previews,
          errors: [...errors, err.message || 'Eroare tranzacțională PostgreSQL la remediere.']
        };
      } finally {
        client.release();
      }
    }

    // Supabase REST update path
    for (const work of validWorkItems) {
      try {
        if (work.req.action === 'fix_price' && work.req.newPrice) {
          const newPrice = work.req.newPrice;
          const origPrice = work.newNormalPrice && work.newNormalPrice > newPrice ? work.newNormalPrice : null;

          const { error: offErr } = await supabase
            .from('product_offers')
            .update({
              price: newPrice,
              normal_price: work.newNormalPrice ?? null,
              promo_price: work.newPromoPrice ?? null,
              original_price: origPrice,
              unit_price: work.newUnitPrice ?? newPrice,
              unit_price_measure: work.newUnitMeasure || 'lei/buc',
              verification_status: 'verified',
              is_flagged_anomaly: false,
              anomaly_reason: null,
              last_verified_at: nowIso,
              updated_at: nowIso
            })
            .eq('id', work.offer.id);

          if (offErr) {
            errors.push(`Eroare Supabase product_offers ${work.offer.id}: ${offErr.message}`);
            continue;
          }
          affectedOffersCount++;

          const { error: prodErr } = await supabase
            .from('products')
            .update({ base_reference_price: newPrice, updated_at: nowIso })
            .eq('id', work.canonicalProductId);
          if (!prodErr) updatedProductsCount++;

          const { data: stgUpdated } = await supabase
            .from('catalog_extracted_offers')
            .update({
              effective_price: newPrice,
              promo_price: work.newPromoPrice ?? null,
              price_validation_status: 'VALID',
              updated_at: nowIso
            })
            .in('matched_product_id', work.equivalentProductIds)
            .eq('retailer_id', normalizeStoreId(work.offer.store_id))
            .select('id');
          if (Array.isArray(stgUpdated)) updatedStagingCount += stgUpdated.length;

          // IMPORTANT: promotions nu are coloana updated_at
          const { data: prmUpdated } = await supabase
            .from('promotions')
            .update({
              normal_price: work.newNormalPrice ?? null,
              promo_price: work.newPromoPrice ?? newPrice
            })
            .in('product_id', work.equivalentProductIds)
            .eq('retailer_id', normalizeStoreId(work.offer.store_id))
            .select('id');
          if (Array.isArray(prmUpdated)) updatedPromotionsCount += prmUpdated.length;
        } else if (work.req.action === 'isolate') {
          const { error: offErr } = await supabase
            .from('product_offers')
            .update({
              verification_status: 'isolated',
              is_flagged_anomaly: true,
              anomaly_reason: work.req.reason || 'Izolat prin Audit Prețuri.',
              updated_at: nowIso
            })
            .eq('id', work.offer.id);
          if (offErr) {
            errors.push(`Eroare izolare ofertă ${work.offer.id}: ${offErr.message}`);
            continue;
          }
          affectedOffersCount++;
        } else if (work.req.action === 'verify') {
          const { error: offErr } = await supabase
            .from('product_offers')
            .update({
              verification_status: 'verified',
              is_flagged_anomaly: false,
              anomaly_reason: null,
              last_verified_at: nowIso,
              updated_at: nowIso
            })
            .eq('id', work.offer.id);
          if (offErr) {
            errors.push(`Eroare verificare ofertă ${work.offer.id}: ${offErr.message}`);
            continue;
          }
          affectedOffersCount++;
        }
      } catch (err: any) {
        errors.push(`Excepție la remediere ${work.offer.id}: ${err.message}`);
      }
    }

    try {
      const { error: logErr } = await supabase.from('admin_audit_logs').insert({
        id: `audit-pa-${Date.now()}`,
        user_email: userEmail,
        action: 'price_audit_remediation',
        target_type: 'product_offers',
        target_id: previews.slice(0, 5).map(p => p.offerId).join(','),
        details: { affectedOffersCount, previews: previews.slice(0, 20) },
        ip_address: params.ipAddress || null,
        created_at: nowIso
      });
      auditLogRecorded = !logErr;
    } catch {
      auditLogRecorded = false;
    }

    return {
      success: affectedOffersCount > 0 || errors.length === 0,
      dryRun: false,
      affectedOffersCount,
      updatedProductsCount,
      updatedStagingCount,
      updatedPromotionsCount,
      auditLogRecorded,
      previews,
      errors
    };
  }
}
