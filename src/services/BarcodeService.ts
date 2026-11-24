import {
  BarcodeLookupResult,
  PriceObservation,
  Product,
  ProductOffer,
  RetailerProductRecord,
  Store
} from '../types.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import { PriceHistoryService } from './PriceHistoryService.js';
import {
  buildCanonicalAliasIndex,
  type CanonicalAliasSource,
  collectProductIdsForCanonical,
  normalizeBarcodeCandidates,
  normalizeStoreIdKey,
  normalizeValidatedBarcodeCandidates,
  resolveCanonicalProductDetail
} from './ProductIdentityService.js';
import { validateAndNormalizeBarcode } from './ProductNormalizationService.js';

export { normalizeBarcodeCandidates, normalizeValidatedBarcodeCandidates, validateAndNormalizeBarcode };

export function isValidBarcodeFormat(rawCode: string): boolean {
  const digits = (rawCode || '').replace(/\D/g, '').trim();
  return [8, 12, 13, 14].includes(digits.length);
}

export function lookupProductByBarcode(params: {
  barcode: string;
  products: Product[];
  offers: ProductOffer[];
  stores: Store[];
  observations?: PriceObservation[];
  retailerProducts?: RetailerProductRecord[];
  aliasMap?: CanonicalAliasSource;
}): BarcodeLookupResult {
  const cleaned = (params.barcode || '').replace(/\D/g, '').trim();
  const validation = validateAndNormalizeBarcode(params.barcode);
  const candidates = validation.normalizedEquivalentBarcodes.length > 0
    ? validation.normalizedEquivalentBarcodes
    : normalizeBarcodeCandidates(cleaned);

  if (candidates.length === 0) {
    return {
      found: false,
      searchedBarcode: cleaned || params.barcode,
      normalizedBarcodes: [],
      barcodeValidation: validation,
      offers: [],
      lowestPrice: null,
      lowestStoreName: null,
      messageRo: 'Codul de bare introdus nu are un format valid EAN-8 / UPC-A / EAN-13.'
    };
  }

  const candidateSet = new Set(candidates);
  const productsById = new Map<string, Product>();
  for (const p of params.products || []) {
    if (p?.id) productsById.set(p.id, p);
  }
  const knownProductIds = new Set(productsById.keys());
  const aliasIndex = buildCanonicalAliasIndex(params.aliasMap ?? params.products ?? []);

  let matchedProduct: Product | undefined;
  const directProductMatch = (params.products || []).find(p => {
    if (!p?.barcode) return false;
    const prodVariants = normalizeBarcodeCandidates(p.barcode);
    if (!prodVariants.some(v => candidateSet.has(v))) return false;
    const detail = resolveCanonicalProductDetail(p.id, aliasIndex, { knownProductIds });
    return detail.found && !detail.cycleDetected && Boolean(detail.canonicalId && productsById.has(detail.canonicalId));
  });

  if (directProductMatch) {
    const directDetail = resolveCanonicalProductDetail(directProductMatch.id, aliasIndex, { knownProductIds });
    if (directDetail.found && !directDetail.cycleDetected && directDetail.canonicalId) {
      matchedProduct = productsById.get(directDetail.canonicalId);
    }
  }

  if (!matchedProduct && Array.isArray(params.retailerProducts)) {
    const matchedRp = params.retailerProducts.find(rp => {
      if (!rp?.barcode || !rp?.productId) return false;
      const rpVariants = normalizeBarcodeCandidates(rp.barcode);
      if (!rpVariants.some(v => candidateSet.has(v))) return false;
      const rpDetail = resolveCanonicalProductDetail(rp.productId, aliasIndex, { knownProductIds });
      return rpDetail.found && !rpDetail.cycleDetected && Boolean(rpDetail.canonicalId && productsById.has(rpDetail.canonicalId));
    });
    if (matchedRp?.productId) {
      const rpDetail = resolveCanonicalProductDetail(matchedRp.productId, aliasIndex, { knownProductIds });
      if (rpDetail.found && !rpDetail.cycleDetected && rpDetail.canonicalId) {
        matchedProduct = productsById.get(rpDetail.canonicalId);
      }
    }
  }

  if (!matchedProduct) {
    return {
      found: false,
      searchedBarcode: cleaned,
      normalizedBarcodes: candidates,
      barcodeValidation: validation,
      offers: [],
      lowestPrice: null,
      lowestStoreName: null,
      messageRo: `Nu am găsit niciun produs în catalog pentru codul de bare ${cleaned}. Poți trimite o sugestie de adăugare spre moderare.`
    };
  }

  const equivalentIds = new Set(collectProductIdsForCanonical(matchedProduct.id, aliasIndex));
  equivalentIds.add(matchedProduct.id);

  const storeMap = new Map<string, Store>();
  for (const s of params.stores || []) {
    if (!s?.id || s.id === 'validation-only-retailer') continue;
    storeMap.set(s.id, s);
    storeMap.set(normalizeStoreIdKey(s.id), s);
    if (s.slug) storeMap.set(normalizeStoreIdKey(s.slug), s);
  }

  const bestOfferByStoreKey = new Map<string, { offer: ProductOffer; store: Store }>();
  for (const offer of params.offers || []) {
    const offerDetail = resolveCanonicalProductDetail(offer.productId, aliasIndex, { knownProductIds });
    if (offerDetail.cycleDetected || !offerDetail.found || !offerDetail.canonicalId) continue;
    if (offerDetail.canonicalId !== matchedProduct.id && !equivalentIds.has(offer.productId)) continue;
    if (!PriceComparisonService.isOfferValid(offer, matchedProduct, { aliasMap: aliasIndex })) continue;
    const normKey = normalizeStoreIdKey(offer.storeId);
    const store = storeMap.get(offer.storeId) || storeMap.get(normKey);
    if (!store) continue;
    const canonStoreKey = normalizeStoreIdKey(store.slug || store.id);
    const normalizedOffer: ProductOffer = {
      ...offer,
      productId: matchedProduct.id,
      storeId: canonStoreKey || offer.storeId
    };
    const prev = bestOfferByStoreKey.get(canonStoreKey);
    if (!prev || normalizedOffer.price < prev.offer.price) {
      bestOfferByStoreKey.set(canonStoreKey, { offer: normalizedOffer, store });
    }
  }

  const validOffers = Array.from(bestOfferByStoreKey.values()).sort(
    (a, b) => a.offer.price - b.offer.price
  );

  const lowestEntry = validOffers[0] || null;
  const fullStats = PriceHistoryService.getProductPriceStats(matchedProduct.id, {
    observations: params.observations || [],
    offers: validOffers.map(v => v.offer),
    stores: params.stores,
    aliasMap: params.aliasMap
  });
  const stats90 = fullStats.intervalStats[90];

  return {
    found: true,
    searchedBarcode: cleaned,
    normalizedBarcodes: candidates,
    barcodeValidation: validation,
    product: matchedProduct,
    offers: validOffers,
    lowestPrice: lowestEntry ? lowestEntry.offer.price : null,
    lowestStoreName: lowestEntry ? lowestEntry.store.name : null,
    historySummary: {
      observationsCount: fullStats.observationsCount,
      minPrice90d: stats90?.minPrice ?? null,
      avgPrice90d: stats90?.avgPrice ?? null,
      lastObservationDate: stats90?.lastObservation?.date ?? null
    },
    messageRo: lowestEntry
      ? `Produs găsit: ${matchedProduct.name}. Cel mai mic preț curent: ${PriceComparisonService.formatRon(lowestEntry.offer.price)} la ${lowestEntry.store.name}.`
      : `Produs găsit în catalog: ${matchedProduct.name} (fără oferte active verificate în acest moment).`
  };
}
