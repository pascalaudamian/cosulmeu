import {
  DataSourceType,
  PriceHistoryInterval,
  PriceHistoryIntervalStats,
  PriceObservation,
  ProductOffer,
  Receipt,
  Store
} from '../types.js';
import { StorageService } from './StorageService.js';
import { STORES } from '../data/mockData.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import {
  buildCanonicalAliasIndex,
  collectProductIdsForCanonical,
  resolveCanonicalProductId
} from './ProductIdentityService.js';

export interface PriceTimelinePoint {
  date: string;
  price: number;
  storeId: string;
  storeName: string;
  source: string;
  sourceType: DataSourceType | string;
}

export interface ProductPriceStats {
  productId: string;
  currentLowestPrice: number;
  currentLowestStoreId?: string;
  currentLowestStoreName: string;
  minRecordedPrice: number | null;
  maxRecordedPrice: number | null;
  averagePrice: number | null;
  lastPaidPrice?: number;
  lastPaidStoreName?: string;
  trendPercentage: number;
  observationsCount: number;
  distinctDaysCount: number;
  hasSufficientHistory: boolean;
  historyPoints: PriceTimelinePoint[];
  intervalStats: Record<PriceHistoryInterval, PriceHistoryIntervalStats>;
}

const VALID_INTERVALS: PriceHistoryInterval[] = [30, 90, 180, 365];

function formatSourceLabel(source: DataSourceType | string): string {
  switch (source) {
    case 'verified':
      return 'Bon fiscal confirmat';
    case 'official_feed':
      return 'Catalog / feed oficial';
    case 'partner_api':
      return 'API partener';
    case 'user_reported':
      return 'Raportat de utilizator';
    case 'estimated':
      return 'Estimare';
    default:
      return 'Observație catalog';
  }
}

function normalizeStoreLookup(value: string): string {
  return (value || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
}

function findStore(storeId: string, stores: Store[]): Store | undefined {
  const key = normalizeStoreLookup(storeId);
  return stores.find(
    s =>
      s.id === storeId ||
      normalizeStoreLookup(s.id) === key ||
      normalizeStoreLookup(s.slug || '') === key
  );
}

function parseDateSafe(rawDate: string): number {
  if (!rawDate) return NaN;
  const isoDay = rawDate.length === 10 ? `${rawDate}T12:00:00Z` : rawDate;
  return new Date(isoDay).getTime();
}

export class PriceHistoryService {
  /**
   * Filtrează strict punctele istorice la intervalul solicitat (30, 90, 180 sau 365 zile).
   * Nu ocolește niciodată filtrul atunci când există 0 sau 1 observații.
   */
  static filterPointsByDays<T extends { date: string }>(
    points: T[],
    days: number,
    now: Date = new Date()
  ): T[] {
    if (!Array.isArray(points) || points.length === 0) return [];
    const safeDays = Number.isFinite(days) && days > 0 ? days : 90;
    const nowMs = now.getTime();
    const cutoffMs = nowMs - safeDays * 24 * 60 * 60 * 1000;

    return points.filter(p => {
      const ts = parseDateSafe(p.date);
      if (Number.isNaN(ts)) return false;
      return ts >= cutoffMs && ts <= nowMs + 24 * 60 * 60 * 1000;
    });
  }

  /**
   * Calculează statisticile exacte pentru un interval calendaristic (30 / 90 / 180 / 365 zile).
   */
  static computeIntervalStats(
    points: PriceTimelinePoint[],
    intervalDays: PriceHistoryInterval,
    now: Date = new Date()
  ): PriceHistoryIntervalStats {
    const filtered = this.filterPointsByDays(points, intervalDays, now);
    const validPoints = filtered.filter(p => Number.isFinite(p.price) && p.price > 0);
    const distinctDaysCount = new Set(validPoints.map(p => p.date.slice(0, 10))).size;

    if (validPoints.length === 0) {
      return {
        intervalDays,
        observationsCount: 0,
        distinctDaysCount: 0,
        minPrice: null,
        minPriceDate: null,
        minPriceStoreId: null,
        minPriceStoreName: null,
        maxPrice: null,
        avgPrice: null,
        lastObservation: null,
        hasSufficientHistory: false,
        noticeRo: `Nu există observații istorice de preț înregistrate în ultimele ${intervalDays} zile.`
      };
    }

    let minPoint = validPoints[0];
    let maxPrice = validPoints[0].price;
    let sum = 0;

    for (const pt of validPoints) {
      if (pt.price < minPoint.price) {
        minPoint = pt;
      }
      if (pt.price > maxPrice) {
        maxPrice = pt.price;
      }
      sum += pt.price;
    }

    const latest = validPoints[validPoints.length - 1];
    const avgPrice = Math.round((sum / validPoints.length) * 100) / 100;
    const hasSufficientHistory = validPoints.length >= 2 && distinctDaysCount >= 2;

    let noticeRo: string | undefined;
    if (validPoints.length === 1) {
      noticeRo = `Există o singură observație în ultimele ${intervalDays} zile (${latest.date}, ${latest.storeName}) — insuficient pentru a trasa o evoluție de preț.`;
    } else if (distinctDaysCount < 2) {
      noticeRo = `Observațiile din ultimele ${intervalDays} zile provin dintr-o singură zi (${latest.date}) — sunt necesare cel puțin 2 zile distincte pentru tendință.`;
    }

    return {
      intervalDays,
      observationsCount: validPoints.length,
      distinctDaysCount,
      minPrice: Math.round(minPoint.price * 100) / 100,
      minPriceDate: minPoint.date,
      minPriceStoreId: minPoint.storeId,
      minPriceStoreName: minPoint.storeName,
      maxPrice: Math.round(maxPrice * 100) / 100,
      avgPrice,
      lastObservation: {
        price: Math.round(latest.price * 100) / 100,
        date: latest.date,
        storeId: latest.storeId,
        storeName: latest.storeName,
        source: latest.source
      },
      hasSufficientHistory,
      noticeRo
    };
  }

  /**
   * Calculează istoricul real și statisticile pe intervale pentru un produs.
   * Nu fabrică puncte sintetice atunci când lipsesc observațiile reale.
   */
  static getProductPriceStats(
    productId: string,
    options?: {
      offers?: ProductOffer[];
      observations?: PriceObservation[];
      stores?: Store[];
      receipts?: Receipt[];
      aliasMap?: Map<string, string> | Record<string, string>;
      now?: Date;
    }
  ): ProductPriceStats {
    const now = options?.now ?? new Date();
    const stores = options?.stores ?? STORES;
    const allObservations = options?.observations ?? StorageService.getPriceObservations();
    const allOffers = options?.offers ?? StorageService.getProductOffers();
    const receipts = options?.receipts ?? StorageService.getReceipts();
    const aliasIndex = buildCanonicalAliasIndex(options?.aliasMap ?? StorageService.getAllProducts());
    const canonicalProductId = resolveCanonicalProductId(productId, aliasIndex) || productId;
    const equivalentIds = new Set(collectProductIdsForCanonical(canonicalProductId, aliasIndex));
    equivalentIds.add(canonicalProductId);

    const productObservations = allObservations.filter(
      obs =>
        (equivalentIds.has(obs.productId) ||
          resolveCanonicalProductId(obs.productId, aliasIndex) === canonicalProductId) &&
        Number.isFinite(obs.price) &&
        obs.price > 0 &&
        obs.source !== 'demo' &&
        obs.source !== 'estimated'
    );

    // Ofertele valide curente (exclus demo, expired, anomalies), incluzând ofertele de pe aliasuri
    const currentOffers = allOffers.filter(
      o =>
        (equivalentIds.has(o.productId) ||
          resolveCanonicalProductId(o.productId, aliasIndex) === canonicalProductId) &&
        PriceComparisonService.isOfferValid(o)
    );

    let currentLowestPrice = Infinity;
    let currentLowestStoreId: string | undefined;
    let currentLowestStoreName = '-';

    for (const off of currentOffers) {
      if (off.price < currentLowestPrice) {
        currentLowestPrice = off.price;
        currentLowestStoreId = off.storeId;
        const st = findStore(off.storeId, stores);
        currentLowestStoreName = st ? st.name : off.storeId;
      }
    }

    if (currentLowestPrice === Infinity) {
      currentLowestPrice = 0;
    }

    const sortedObs = [...productObservations].sort((a, b) => {
      const diff = parseDateSafe(a.date) - parseDateSafe(b.date);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const timeline: PriceTimelinePoint[] = sortedObs.map(obs => {
      const st = findStore(obs.storeId, stores);
      return {
        date: obs.date.slice(0, 10),
        price: Math.round(obs.price * 100) / 100,
        storeId: st?.id || obs.storeId,
        storeName: st ? st.name : obs.storeId,
        source: formatSourceLabel(obs.source),
        sourceType: obs.source
      };
    });

    const allPrices = timeline.map(t => t.price).filter(p => p > 0);
    const minRecordedPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
    const maxRecordedPrice = allPrices.length > 0 ? Math.max(...allPrices) : null;
    const averagePrice =
      allPrices.length > 0
        ? Math.round((allPrices.reduce((a, b) => a + b, 0) / allPrices.length) * 100) / 100
        : null;

    let lastPaidPrice: number | undefined;
    let lastPaidStoreName: string | undefined;
    for (const rec of receipts) {
      const match = rec.items.find(
        i =>
          Boolean(i.matchedProductId) &&
          (equivalentIds.has(i.matchedProductId!) ||
            resolveCanonicalProductId(i.matchedProductId!, aliasIndex) === canonicalProductId)
      );
      if (match) {
        lastPaidPrice = match.unitPrice;
        lastPaidStoreName = rec.storeName;
        break;
      }
    }

    const distinctDaysCount = new Set(timeline.map(t => t.date)).size;
    const hasSufficientHistory = timeline.length >= 2 && distinctDaysCount >= 2;

    let trendPercentage = 0;
    if (hasSufficientHistory) {
      const firstPrice = timeline[0].price;
      const latestPrice = timeline[timeline.length - 1].price;
      if (firstPrice > 0) {
        trendPercentage = Math.round(((latestPrice - firstPrice) / firstPrice) * 1000) / 10;
      }
    }

    const intervalStats = {} as Record<PriceHistoryInterval, PriceHistoryIntervalStats>;
    for (const days of VALID_INTERVALS) {
      intervalStats[days] = this.computeIntervalStats(timeline, days, now);
    }

    return {
      productId: canonicalProductId,
      currentLowestPrice,
      currentLowestStoreId,
      currentLowestStoreName,
      minRecordedPrice,
      maxRecordedPrice,
      averagePrice,
      lastPaidPrice,
      lastPaidStoreName,
      trendPercentage,
      observationsCount: timeline.length,
      distinctDaysCount,
      hasSufficientHistory,
      historyPoints: timeline,
      intervalStats
    };
  }
}
