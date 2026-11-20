import {
  BarcodeLookupResult,
  PriceObservation,
  Product,
  ProductOffer,
  Store
} from '../types.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import { PriceHistoryService } from './PriceHistoryService.js';

/**
 * Normalizează un cod de bare scanat / introdus manual și generează variante echivalente
 * (ex: UPC-A 12 cifre <-> EAN-13 cu prefix '0').
 */
export function normalizeBarcodeCandidates(rawCode: string): string[] {
  const digits = (rawCode || '').replace(/\D/g, '').trim();
  if (digits.length < 6 || digits.length > 14) return [];

  const candidates = new Set<string>([digits]);
  if (digits.length === 12) {
    candidates.add(`0${digits}`);
  } else if (digits.length === 13 && digits.startsWith('0')) {
    candidates.add(digits.slice(1));
  }
  return Array.from(candidates);
}

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
}): BarcodeLookupResult {
  const cleaned = (params.barcode || '').replace(/\D/g, '').trim();
  const candidates = normalizeBarcodeCandidates(cleaned);

  if (candidates.length === 0) {
    return {
      found: false,
      searchedBarcode: cleaned || params.barcode,
      normalizedBarcodes: [],
      offers: [],
      lowestPrice: null,
      lowestStoreName: null,
      messageRo: 'Codul de bare introdus nu are un format valid EAN-8 / UPC-A / EAN-13.'
    };
  }

  const candidateSet = new Set(candidates);
  const matchedProduct = (params.products || []).find(p => {
    if (!p?.barcode) return false;
    const prodVariants = normalizeBarcodeCandidates(p.barcode);
    return prodVariants.some(v => candidateSet.has(v));
  });

  if (!matchedProduct) {
    return {
      found: false,
      searchedBarcode: cleaned,
      normalizedBarcodes: candidates,
      offers: [],
      lowestPrice: null,
      lowestStoreName: null,
      messageRo: `Nu am găsit niciun produs în catalog pentru codul de bare ${cleaned}. Poți trimite o sugestie de adăugare spre moderare.`
    };
  }

  const storeMap = new Map<string, Store>();
  for (const s of params.stores || []) {
    if (!s?.id || s.id === 'validation-only-retailer') continue;
    storeMap.set(s.id, s);
    storeMap.set(s.id.toLowerCase().replace(/^store-/, '').replace(/-chain$/, ''), s);
  }

  const validOffers = (params.offers || [])
    .filter(o => o.productId === matchedProduct.id && PriceComparisonService.isOfferValid(o, matchedProduct))
    .map(offer => {
      const normKey = (offer.storeId || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '');
      const store = storeMap.get(offer.storeId) || storeMap.get(normKey);
      return store ? { offer, store } : null;
    })
    .filter((entry): entry is { offer: ProductOffer; store: Store } => entry !== null)
    .sort((a, b) => a.offer.price - b.offer.price);

  const lowestEntry = validOffers[0] || null;
  const fullStats = PriceHistoryService.getProductPriceStats(matchedProduct.id, {
    observations: params.observations || [],
    offers: validOffers.map(v => v.offer),
    stores: params.stores
  });
  const stats90 = fullStats.intervalStats[90];

  return {
    found: true,
    searchedBarcode: cleaned,
    normalizedBarcodes: candidates,
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
