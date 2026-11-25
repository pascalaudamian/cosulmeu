import {
  DataSourceType,
  FlaggedPriceObservation,
  PriceDataQualityAssessment,
  PriceDataQualityStatus,
  PriceHistoryInterval,
  PriceHistoryIntervalStats,
  PriceHistoryStoreBreakdown,
  PriceObservation,
  PriceQualityClassifierConfig,
  Product,
  ProductOffer,
  Receipt,
  Store
} from '../types.js';
import { StorageService } from './StorageService.js';
import { STORES } from '../data/mockData.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import {
  isRonCurrency,
  parseStrictIsoDate,
  type ParsedIsoDateResult,
  PriceQualityClassifier
} from './PriceQualityClassifier.js';
import {
  buildCanonicalAliasIndex,
  type CanonicalAliasSource,
  collectProductIdsForCanonical,
  resolveCanonicalProductDetail
} from './ProductIdentityService.js';

export { isRonCurrency, parseStrictIsoDate, type ParsedIsoDateResult };

export interface PriceTimelinePoint {
  id?: string;
  date: string;
  price: number;
  storeId: string;
  storeName: string;
  source: string;
  sourceType: DataSourceType | string;
  originalProductId?: string;
  sourceId?: string;
  receiptId?: string;
  loyaltyCardUsed?: boolean;
  region?: string;
  currency?: string;
  qualityStatus?: PriceDataQualityStatus;
  qualityLabelRo?: string;
  qualityReasons?: string[];
}

export interface ProductPriceQualitySummary {
  verifiedRecently: number;
  verified: number;
  stale: number;
  unverified: number;
  suspicious: number;
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
  excludedForeignCurrencyCount?: number;
  invalidObservationsCount?: number;
  flaggedObservations?: FlaggedPriceObservation[];
  observationQualityById?: Record<string, PriceDataQualityAssessment>;
  qualitySummary?: ProductPriceQualitySummary;
  rejectedInvalidIdentity?: boolean;
  invalidIdentityReason?: string;
}

const VALID_INTERVALS: PriceHistoryInterval[] = [30, 90, 180, 365];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function formatPriceSourceLabel(source: DataSourceType | string): string {
  switch (source) {
    case 'verified':
      return 'Bon fiscal confirmat';
    case 'official_feed':
      return 'Catalog / feed oficial';
    case 'partner_api':
      return 'API partener';
    case 'public_catalog_feed':
      return 'Catalog public';
    case 'affiliate_feed':
      return 'Feed afiliat';
    case 'manual_import':
      return 'Import verificat';
    case 'receipt_ocr':
      return 'Bon scanat (OCR)';
    case 'user_reported':
      return 'Raportat de utilizator';
    case 'estimated':
      return 'Estimare';
    case 'demo':
      return 'Demonstrativ';
    default:
      return source ? 'Observație catalog' : 'Sursă nespecificată';
  }
}

export function normalizeHistoryStoreKey(value: string): string {
  return (value || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
}

function buildStoreLookupMap(stores: Store[]): Map<string, Store> {
  const map = new Map<string, Store>();
  for (const s of stores) {
    if (!s) continue;
    if (s.id) map.set(s.id, s);
    const normId = normalizeHistoryStoreKey(s.id);
    if (normId && !map.has(normId)) map.set(normId, s);
    if (s.slug) {
      const normSlug = normalizeHistoryStoreKey(s.slug);
      if (normSlug && !map.has(normSlug)) map.set(normSlug, s);
    }
  }
  return map;
}

function lookupStoreFast(storeId: string, storeMap: Map<string, Store>): Store | undefined {
  if (!storeId) return undefined;
  return storeMap.get(storeId) || storeMap.get(normalizeHistoryStoreKey(storeId));
}

function roundRon(val: number): number {
  return Math.round(val * 100) / 100;
}

export class PriceHistoryService {
  /**
   * Filtrează strict punctele istorice la intervalul solicitat (30, 90, 180 sau 365 zile).
   * Nu ocolește niciodată filtrul atunci când există 0 sau 1 observații.
   * Respinge datele malformate sau aflate în viitor (> now + 24h).
   */
  static filterPointsByDays<T extends { date: string }>(
    points: T[],
    days: number,
    now: Date = new Date()
  ): T[] {
    if (!Array.isArray(points) || points.length === 0) return [];
    const safeDays = Number.isFinite(days) && days > 0 ? days : 90;
    const nowMs = now.getTime();
    const cutoffMs = nowMs - safeDays * MS_PER_DAY;
    const maxAllowedMs = nowMs + MS_PER_DAY;

    return points.filter(p => {
      if (!p) return false;
      const parsed = parseStrictIsoDate(p.date);
      if (!parsed) return false;
      return parsed.timestampMs >= cutoffMs && parsed.timestampMs <= maxAllowedMs;
    });
  }

  /**
   * Calculează statisticile comparative per magazin pentru un set validat de puncte istorice.
   */
  static computeStoreBreakdown(validPoints: PriceTimelinePoint[]): PriceHistoryStoreBreakdown[] {
    if (!Array.isArray(validPoints) || validPoints.length === 0) return [];

    const byStore = new Map<string, PriceTimelinePoint[]>();
    for (const pt of validPoints) {
      const storeKey = normalizeHistoryStoreKey(pt.storeId) || pt.storeId || 'unknown';
      const arr = byStore.get(storeKey);
      if (arr) {
        arr.push(pt);
      } else {
        byStore.set(storeKey, [pt]);
      }
    }

    const breakdown: PriceHistoryStoreBreakdown[] = [];
    for (const [, storePoints] of byStore.entries()) {
      const sorted = [...storePoints].sort((a, b) => a.date.localeCompare(b.date));
      let minPt = sorted[0];
      let maxPrice = sorted[0].price;
      let sum = 0;
      const daySet = new Set<string>();
      const sourceLabels = new Set<string>();
      const sourceTypes = new Set<string>();
      let verifiedCount = 0;
      let staleCount = 0;
      let unverifiedCount = 0;

      for (const pt of sorted) {
        if (pt.price < minPt.price) {
          minPt = pt;
        }
        if (pt.price > maxPrice) {
          maxPrice = pt.price;
        }
        sum += pt.price;
        daySet.add(pt.date.slice(0, 10));
        if (pt.source) sourceLabels.add(pt.source);
        if (pt.sourceType) sourceTypes.add(String(pt.sourceType));
        if (pt.qualityStatus === 'VERIFIED_RECENTLY' || pt.qualityStatus === 'VERIFIED') {
          verifiedCount++;
        } else if (pt.qualityStatus === 'STALE') {
          staleCount++;
        } else if (pt.qualityStatus === 'UNVERIFIED') {
          unverifiedCount++;
        }
      }

      const lastPt = sorted[sorted.length - 1];
      breakdown.push({
        storeId: lastPt.storeId,
        storeName: lastPt.storeName,
        observationsCount: sorted.length,
        distinctDaysCount: daySet.size,
        minPrice: roundRon(minPt.price),
        minPriceDate: minPt.date.slice(0, 10),
        avgPrice: roundRon(sum / sorted.length),
        maxPrice: roundRon(maxPrice),
        lastPrice: roundRon(lastPt.price),
        lastDate: lastPt.date.slice(0, 10),
        lastSource: lastPt.source,
        lastSourceType: lastPt.sourceType,
        sources: Array.from(sourceLabels),
        hasMixedSources: sourceTypes.size > 1,
        ...(lastPt.qualityStatus ? { latestQualityStatus: lastPt.qualityStatus } : {}),
        ...(lastPt.qualityLabelRo ? { latestQualityLabelRo: lastPt.qualityLabelRo } : {}),
        ...(lastPt.qualityReasons?.[0] ? { latestQualityReasonRo: lastPt.qualityReasons[0] } : {}),
        ...(sorted.some(p => p.qualityStatus !== undefined)
          ? { verifiedCount, staleCount, unverifiedCount }
          : {})
      });
    }

    return breakdown.sort((a, b) => {
      if (a.minPrice !== b.minPrice) return a.minPrice - b.minPrice;
      const dateCmp = b.lastDate.localeCompare(a.lastDate);
      if (dateCmp !== 0) return dateCmp;
      return a.storeName.localeCompare(b.storeName);
    });
  }

  /**
   * Calculează statisticile exacte pentru un interval calendaristic (30 / 90 / 180 / 365 zile).
   */
  static computeIntervalStats(
    points: PriceTimelinePoint[],
    intervalDays: PriceHistoryInterval,
    now: Date = new Date(),
    meta?: {
      excludedForeignCurrencyCount?: number;
      invalidObservationsCount?: number;
    }
  ): PriceHistoryIntervalStats {
    const filtered = this.filterPointsByDays(points, intervalDays, now);
    const validPoints = filtered
      .filter(
        p =>
          p &&
          Number.isFinite(p.price) &&
          p.price > 0 &&
          isRonCurrency(p.currency) &&
          p.sourceType !== 'demo' &&
          p.sourceType !== 'estimated' &&
          p.qualityStatus !== 'SUSPICIOUS' &&
          p.qualityStatus !== 'EXPIRED'
      )
      .sort((a, b) => {
        const cmp = a.date.localeCompare(b.date);
        if (cmp !== 0) return cmp;
        return a.storeId.localeCompare(b.storeId);
      });

    const distinctDaysCount = new Set(validPoints.map(p => p.date.slice(0, 10))).size;

    if (validPoints.length === 0) {
      let emptyNotice = `Nu există observații istorice de preț înregistrate în ultimele ${intervalDays} zile.`;
      if (meta?.excludedForeignCurrencyCount && meta.excludedForeignCurrencyCount > 0) {
        emptyNotice += ` (${meta.excludedForeignCurrencyCount} observații în altă monedă decât RON au fost excluse.)`;
      }
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
        noticeRo: emptyNotice,
        storeBreakdown: [],
        excludedForeignCurrencyCount: meta?.excludedForeignCurrencyCount || 0,
        invalidObservationsCount: meta?.invalidObservationsCount || 0
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
    const avgPrice = roundRon(sum / validPoints.length);
    const hasSufficientHistory = validPoints.length >= 2 && distinctDaysCount >= 2;
    const storeBreakdown = this.computeStoreBreakdown(validPoints);

    let noticeRo: string | undefined;
    if (validPoints.length === 1) {
      noticeRo = `Există o singură observație în ultimele ${intervalDays} zile (${latest.date}, ${latest.storeName}) — insuficient pentru a trasa o evoluție de preț.`;
    } else if (distinctDaysCount < 2) {
      noticeRo = `Observațiile din ultimele ${intervalDays} zile provin dintr-o singură zi (${latest.date}) — sunt necesare cel puțin 2 zile distincte pentru tendință.`;
    }

    if (meta?.excludedForeignCurrencyCount && meta.excludedForeignCurrencyCount > 0) {
      const currencyNote = `${meta.excludedForeignCurrencyCount} observații în monedă diferită de RON au fost excluse pentru a nu distorsiona calculele.`;
      noticeRo = noticeRo ? `${noticeRo} ${currencyNote}` : currencyNote;
    }

    return {
      intervalDays,
      observationsCount: validPoints.length,
      distinctDaysCount,
      minPrice: roundRon(minPoint.price),
      minPriceDate: minPoint.date.slice(0, 10),
      minPriceStoreId: minPoint.storeId,
      minPriceStoreName: minPoint.storeName,
      maxPrice: roundRon(maxPrice),
      avgPrice,
      lastObservation: {
        price: roundRon(latest.price),
        date: latest.date.slice(0, 10),
        storeId: latest.storeId,
        storeName: latest.storeName,
        source: latest.source,
        sourceType: latest.sourceType
      },
      hasSufficientHistory,
      noticeRo,
      storeBreakdown,
      excludedForeignCurrencyCount: meta?.excludedForeignCurrencyCount || 0,
      invalidObservationsCount: meta?.invalidObservationsCount || 0
    };
  }

  /**
   * Calculează istoricul real și statisticile pe intervale pentru un produs.
   * Clasifică toate observațiile prin motorul centralizat PriceQualityClassifier:
   * - Nu fabrică puncte sintetice atunci când lipsesc observațiile reale.
   * - Nu șterge observațiile suspecte din istoric: le marchează în flaggedObservations + observationQualityById,
   *   excluzându-le strict din mediile și graficele RON.
   * - Fail-closed pentru cicluri canonice, aliasuri orfane sau produse incompatibile.
   */
  static getProductPriceStats(
    productId: string,
    options?: {
      product?: Product;
      offers?: ProductOffer[];
      observations?: PriceObservation[];
      stores?: Store[];
      receipts?: Receipt[];
      aliasMap?: CanonicalAliasSource;
      config?: Partial<PriceQualityClassifierConfig>;
      now?: Date;
    }
  ): ProductPriceStats {
    const now = options?.now ?? new Date();
    const nowMs = now.getTime();
    const stores = options?.stores ?? STORES;
    const storeMap = buildStoreLookupMap(stores);
    const allObservations = options?.observations ?? StorageService.getPriceObservations();
    const allOffers = options?.offers ?? StorageService.getProductOffers();
    const receipts = options?.receipts ?? StorageService.getReceipts();

    const hasExplicitAliasMap = options?.aliasMap !== undefined;
    const aliasIndex = buildCanonicalAliasIndex(options?.aliasMap ?? StorageService.getAllProducts());
    const resolvedDetail = resolveCanonicalProductDetail(productId, aliasIndex);

    const buildRejectedStats = (reason: string): ProductPriceStats => {
      const emptyIntervals = {} as Record<PriceHistoryInterval, PriceHistoryIntervalStats>;
      for (const days of VALID_INTERVALS) {
        emptyIntervals[days] = {
          intervalDays: days,
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
          noticeRo: reason,
          storeBreakdown: [],
          excludedForeignCurrencyCount: 0,
          invalidObservationsCount: 0
        };
      }
      return {
        productId,
        currentLowestPrice: 0,
        currentLowestStoreName: '-',
        minRecordedPrice: null,
        maxRecordedPrice: null,
        averagePrice: null,
        trendPercentage: 0,
        observationsCount: 0,
        distinctDaysCount: 0,
        hasSufficientHistory: false,
        historyPoints: [],
        intervalStats: emptyIntervals,
        excludedForeignCurrencyCount: 0,
        invalidObservationsCount: 0,
        flaggedObservations: [],
        observationQualityById: {},
        qualitySummary: {
          verifiedRecently: 0,
          verified: 0,
          stale: 0,
          unverified: 0,
          suspicious: 0
        },
        rejectedInvalidIdentity: true,
        invalidIdentityReason: reason
      };
    };

    if (resolvedDetail.cycleDetected) {
      return buildRejectedStats('Identificator de produs invalid (ciclu canonic sau lanț de aliasuri peste limită).');
    }
    if (resolvedDetail.wasAlias && !resolvedDetail.found) {
      return buildRejectedStats('Identificator de produs invalid (alias orfan fără produs canonic rădăcină).');
    }
    if (hasExplicitAliasMap && aliasIndex.hasExplicitNodes && aliasIndex.parentById.size > 0 && !resolvedDetail.found) {
      return buildRejectedStats('Produsul solicitat nu există în catalogul canonic.');
    }

    const canonicalProductId = resolvedDetail.found && resolvedDetail.canonicalId ? resolvedDetail.canonicalId : productId;
    const equivalentIds = new Set(collectProductIdsForCanonical(canonicalProductId, aliasIndex));
    equivalentIds.add(canonicalProductId);

    let excludedForeignCurrencyCount = 0;
    let invalidObservationsCount = 0;

    // 1. Preluăm observațiile aparținând produsului canonic (sau aliasurilor sale valide)
    const matchedObservations: PriceObservation[] = [];
    for (const obs of allObservations) {
      if (!obs || typeof obs.productId !== 'string') {
        invalidObservationsCount++;
        continue;
      }

      if (!equivalentIds.has(obs.productId)) {
        const obsDetail = resolveCanonicalProductDetail(obs.productId, aliasIndex);
        if (obsDetail.cycleDetected || !obsDetail.found || obsDetail.canonicalId !== canonicalProductId) {
          continue;
        }
      }
      matchedObservations.push(obs);
    }

    // 2. Clasificare unificată prin PriceQualityClassifier (lot determinist)
    const batchClassification = PriceQualityClassifier.classifyObservationBatch(matchedObservations, {
      product: options?.product,
      expectedProductId: canonicalProductId,
      aliasSource: aliasIndex,
      config: options?.config,
      now
    });

    const validParsedObservations: Array<{
      obs: PriceObservation;
      obsKey: string;
      isoDate: string;
      timestampMs: number;
      price: number;
      assessment: PriceDataQualityAssessment;
    }> = [];
    const flaggedObservations: FlaggedPriceObservation[] = [];
    const sortedAssessmentEntries: Array<[string, PriceDataQualityAssessment]> = [];

    for (let i = 0; i < matchedObservations.length; i++) {
      const obs = matchedObservations[i];
      const obsKey = obs.id || `obs-${i}`;
      const assessment = batchClassification.assessmentsById[obsKey];
      sortedAssessmentEntries.push([obsKey, assessment]);

      const foreignCurrency = !isRonCurrency(obs.currency);
      if (foreignCurrency) {
        excludedForeignCurrencyCount++;
      }

      const numericPrice = typeof obs.price === 'number' ? obs.price : Number(obs.price);
      const parsedDate = parseStrictIsoDate(obs.date);
      const invalidPriceOrDate =
        !Number.isFinite(numericPrice) ||
        numericPrice <= 0 ||
        !parsedDate ||
        parsedDate.timestampMs > nowMs + MS_PER_DAY;

      if (!foreignCurrency && invalidPriceOrDate) {
        invalidObservationsCount++;
      }

      if (assessment.status === 'SUSPICIOUS') {
        const st = lookupStoreFast(obs.storeId, storeMap);
        const rawOriginal =
          obs.originalProductId && obs.originalProductId !== canonicalProductId
            ? obs.originalProductId
            : obs.productId !== canonicalProductId
            ? obs.productId
            : undefined;
        flaggedObservations.push({
          id: obsKey,
          productId: canonicalProductId,
          ...(rawOriginal ? { originalProductId: rawOriginal } : {}),
          storeId: st?.id || normalizeHistoryStoreKey(obs.storeId) || obs.storeId,
          storeName: st ? st.name : obs.storeId,
          price: numericPrice,
          currency: obs.currency || 'RON',
          date: parsedDate ? parsedDate.isoDate : String(obs.date || ''),
          source: obs.source,
          sourceLabel: formatPriceSourceLabel(obs.source),
          qualityAssessment: assessment
        });
        continue;
      }

      if (!parsedDate) {
        invalidObservationsCount++;
        continue;
      }

      validParsedObservations.push({
        obs,
        obsKey,
        isoDate: parsedDate.isoDate,
        timestampMs: parsedDate.timestampMs,
        price: roundRon(numericPrice),
        assessment
      });
    }

    // Sortare deterministă (indiferent de ordinea intrării)
    flaggedObservations.sort((a, b) => {
      const dateCmp = String(b.date).localeCompare(String(a.date));
      if (dateCmp !== 0) return dateCmp;
      const storeCmp = String(a.storeId).localeCompare(String(b.storeId));
      if (storeCmp !== 0) return storeCmp;
      return String(a.id).localeCompare(String(b.id));
    });

    sortedAssessmentEntries.sort((a, b) => a[0].localeCompare(b[0]));
    const observationQualityById: Record<string, PriceDataQualityAssessment> = {};
    for (const [k, v] of sortedAssessmentEntries) {
      observationQualityById[k] = v;
    }

    // Ofertele valide curente (exclus demo, expired, anomalies), incluzând ofertele de pe aliasuri — strict separate de istoric
    const currentOffers = allOffers.filter(o => {
      if (!o || !PriceComparisonService.isOfferValid(o, options?.product)) return false;
      if (!isRonCurrency(o.currency)) return false;
      if (equivalentIds.has(o.productId)) return true;
      const offerDetail = resolveCanonicalProductDetail(o.productId, aliasIndex);
      return !offerDetail.cycleDetected && offerDetail.found && offerDetail.canonicalId === canonicalProductId;
    });

    let currentLowestPrice = Infinity;
    let currentLowestStoreId: string | undefined;
    let currentLowestStoreName = '-';

    for (const off of currentOffers) {
      if (off.price < currentLowestPrice) {
        currentLowestPrice = off.price;
        currentLowestStoreId = off.storeId;
        const st = lookupStoreFast(off.storeId, storeMap);
        currentLowestStoreName = st ? st.name : off.storeId;
      }
    }

    if (currentLowestPrice === Infinity) {
      currentLowestPrice = 0;
    }

    validParsedObservations.sort((a, b) => {
      const diff = a.timestampMs - b.timestampMs;
      if (diff !== 0) return diff;
      const dateCmp = a.isoDate.localeCompare(b.isoDate);
      if (dateCmp !== 0) return dateCmp;
      return String(a.obs.id || '').localeCompare(String(b.obs.id || ''));
    });

    const timeline: PriceTimelinePoint[] = validParsedObservations.map(
      ({ obs, obsKey, isoDate, price, assessment }) => {
        const st = lookupStoreFast(obs.storeId, storeMap);
        const rawOriginal =
          obs.originalProductId && obs.originalProductId !== canonicalProductId
            ? obs.originalProductId
            : obs.productId !== canonicalProductId
            ? obs.productId
            : undefined;

        return {
          id: obsKey,
          date: isoDate,
          price,
          storeId: st?.id || normalizeHistoryStoreKey(obs.storeId) || obs.storeId,
          storeName: st ? st.name : obs.storeId,
          source: formatPriceSourceLabel(obs.source),
          sourceType: obs.source,
          originalProductId: rawOriginal,
          sourceId: obs.sourceId,
          receiptId: obs.receiptId,
          loyaltyCardUsed: obs.loyaltyCardUsed,
          region: obs.region,
          currency: 'RON',
          qualityStatus: assessment.status,
          qualityLabelRo: assessment.labelRo,
          qualityReasons: assessment.reasons
        };
      }
    );

    let minRecordedPrice: number | null = null;
    let maxRecordedPrice: number | null = null;
    let sumPrices = 0;

    for (const t of timeline) {
      if (minRecordedPrice === null || t.price < minRecordedPrice) minRecordedPrice = t.price;
      if (maxRecordedPrice === null || t.price > maxRecordedPrice) maxRecordedPrice = t.price;
      sumPrices += t.price;
    }
    const averagePrice = timeline.length > 0 ? roundRon(sumPrices / timeline.length) : null;

    let lastPaidPrice: number | undefined;
    let lastPaidStoreName: string | undefined;
    for (const rec of receipts) {
      const match = rec.items.find(i => {
        if (!i.matchedProductId) return false;
        if (equivalentIds.has(i.matchedProductId)) return true;
        const itemDetail = resolveCanonicalProductDetail(i.matchedProductId, aliasIndex);
        return !itemDetail.cycleDetected && itemDetail.found && itemDetail.canonicalId === canonicalProductId;
      });
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
      intervalStats[days] = this.computeIntervalStats(timeline, days, now, {
        excludedForeignCurrencyCount,
        invalidObservationsCount
      });
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
      intervalStats,
      excludedForeignCurrencyCount,
      invalidObservationsCount,
      flaggedObservations,
      observationQualityById,
      qualitySummary: {
        verifiedRecently: batchClassification.summary.verifiedRecently,
        verified: batchClassification.summary.verified,
        stale: batchClassification.summary.stale,
        unverified: batchClassification.summary.unverified,
        suspicious: batchClassification.summary.suspicious
      }
    };
  }
}
