// src/services/PriceQualityMonitoringService.ts
// FAZA 5: Monitorizarea Calității Datelor de Preț & Dashboard Administrativ
// REGULĂ DE AUR: STRICT READ-ONLY asupra `price_observations`, `product_offers`, `promotions` și `products`.
// Motor unic de clasificare: `PriceQualityClassifier`.

import type {
  AdminAuditLog,
  PriceDataQualityAssessment,
  PriceDataQualityStatus,
  PriceObservation,
  PriceObservationQualityInput,
  PriceQualityAnomalySeverity,
  PriceQualityAnomalyType,
  PriceQualityCanonicalIssue,
  PriceQualityClassifiedRecord,
  PriceQualityCoverageInfo,
  PriceQualityEvolutionPoint,
  PriceQualityInvestigationRecord,
  PriceQualityInvestigationStatus,
  PriceQualityMonitoringAnomaly,
  PriceQualityMonitoringOverview,
  PriceQualityMonitoringRun,
  PriceQualitySourceMetric,
  PriceQualityStatusCounts,
  Product,
  ProductOffer,
  Store
} from '../types.js';
import type { CatalogImportError } from '../indexing/catalog/catalogTypes.js';
import {
  isRonCurrency,
  parseStrictIsoDate,
  PRICE_QUALITY_METHODOLOGY_VERSION,
  PriceQualityClassifier
} from './PriceQualityClassifier.js';
import { formatPriceSourceLabel, normalizeHistoryStoreKey } from './PriceHistoryService.js';
import {
  buildCanonicalAliasIndex,
  type CanonicalAliasIndex,
  resolveCanonicalProductDetail
} from './ProductIdentityService.js';
import { StorageService } from './StorageService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ALIAS_HOPS = 16;

export const ANOMALY_TYPE_LABELS_RO: Record<PriceQualityAnomalyType, string> = {
  zero_or_negative_price: 'Preț zero sau negativ',
  extreme_price_outlier: 'Variație extremă / outlier de preț',
  inconsistent_promotion: 'Promoție inconsistentă',
  incompatible_currency: 'Monedă incompatibilă cu RON',
  invalid_timestamp: 'Dată / timestamp invalid',
  untrusted_demo_or_estimated_source: 'Sursă demo sau estimată',
  unit_or_weight_conflict: 'Conflict de unitate sau gramaj',
  expired_offer_active: 'Ofertă expirată marcată activă',
  invalid_canonical_identity: 'Identitate canonică invalidă',
  conflicting_multi_source_prices: 'Prețuri contradictorii multi-sursă'
};

export interface QualityMonitoringDatasetInput {
  products: Product[];
  stores: Store[];
  offers: ProductOffer[];
  observations: PriceObservation[];
  promotions?: Array<Record<string, unknown>>;
  importErrors?: CatalogImportError[];
  totalObservationsInPeriod?: number;
  totalOffersInCatalog?: number;
  dataSource?: PriceQualityCoverageInfo['dataSource'];
}

export interface EvaluateQualityMonitoringOptions {
  intervalDays?: number;
  maxSampleLimit?: number;
  now?: Date;
  investigationsByKey?: ReadonlyMap<string, PriceQualityInvestigationRecord>;
  latestRun?: PriceQualityMonitoringRun | null;
}

export interface EvaluatedQualityMonitoringBundle {
  overview: PriceQualityMonitoringOverview;
  anomalies: PriceQualityMonitoringAnomaly[];
  records: PriceQualityClassifiedRecord[];
}

export interface QualityAnomaliesFilter {
  qualityStatus?: PriceDataQualityStatus | 'all';
  storeId?: string;
  source?: string;
  productQuery?: string;
  anomalyType?: PriceQualityAnomalyType | 'all';
  severity?: PriceQualityAnomalySeverity | 'all';
  investigationStatus?: PriceQualityInvestigationStatus | 'all';
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface QualityRecordsFilter {
  recordType?: 'all' | 'observations' | 'offers' | 'expired_offers';
  qualityStatus?: PriceDataQualityStatus | 'all';
  storeId?: string;
  source?: string;
  productQuery?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

function emptyStatusCounts(): PriceQualityStatusCounts {
  return {
    VERIFIED_RECENTLY: 0,
    VERIFIED: 0,
    STALE: 0,
    UNVERIFIED: 0,
    EXPIRED: 0,
    SUSPICIOUS: 0
  };
}

function emptyAnomaliesByType(): Record<PriceQualityAnomalyType, number> {
  return {
    zero_or_negative_price: 0,
    extreme_price_outlier: 0,
    inconsistent_promotion: 0,
    incompatible_currency: 0,
    invalid_timestamp: 0,
    untrusted_demo_or_estimated_source: 0,
    unit_or_weight_conflict: 0,
    expired_offer_active: 0,
    invalid_canonical_identity: 0,
    conflicting_multi_source_prices: 0
  };
}

function emptyAnomaliesBySeverity(): Record<PriceQualityAnomalySeverity, number> {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };
}

function buildStoreMap(stores: Store[]): Map<string, Store> {
  const map = new Map<string, Store>();
  for (const s of stores || []) {
    if (!s?.id) continue;
    map.set(s.id, s);
    const norm = normalizeHistoryStoreKey(s.id);
    if (norm && !map.has(norm)) map.set(norm, s);
    if (s.slug) {
      const slugNorm = normalizeHistoryStoreKey(s.slug);
      if (slugNorm && !map.has(slugNorm)) map.set(slugNorm, s);
    }
  }
  return map;
}

function resolveStoreName(storeId: string, storeMap: Map<string, Store>): string {
  const found = storeMap.get(storeId) || storeMap.get(normalizeHistoryStoreKey(storeId));
  return found?.name || (storeId ? storeId.toUpperCase() : 'Magazin necunoscut');
}

function normalizeSourceToken(source: unknown): string {
  const token = String(source ?? '').trim().toLowerCase();
  return token || 'unknown';
}

function isSyntheticSourceToken(sourceKey: string): boolean {
  return (
    sourceKey === 'demo' ||
    sourceKey === 'estimated' ||
    sourceKey === 'mock' ||
    sourceKey === 'synthetic' ||
    sourceKey === 'fake' ||
    sourceKey === 'simulated'
  );
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDateOnly(raw?: string | null): string {
  if (!raw) return '';
  return String(raw).trim().slice(0, 10);
}

function classifyCanonicalIssues(
  products: Product[],
  offers: ProductOffer[],
  observations: PriceObservation[],
  aliasIndex: CanonicalAliasIndex,
  productById: Map<string, Product>
): {
  validCanonicalRootsCount: number;
  validAliasesCount: number;
  cyclesCount: number;
  selfReferencesCount: number;
  chainsTooDeepCount: number;
  orphanAliasesCount: number;
  inconsistentReferencesCount: number;
  issues: PriceQualityCanonicalIssue[];
} {
  let validCanonicalRootsCount = 0;
  let validAliasesCount = 0;
  let cyclesCount = 0;
  let selfReferencesCount = 0;
  let chainsTooDeepCount = 0;
  let orphanAliasesCount = 0;
  let inconsistentReferencesCount = 0;

  const issues: PriceQualityCanonicalIssue[] = [];
  const seenIssueKeys = new Set<string>();

  for (const prod of products) {
    if (!prod?.id) continue;
    const rawParent = (prod.canonicalProductId ?? (prod as any).canonical_product_id ?? null) as string | null;
    const parentId = typeof rawParent === 'string' && rawParent.trim() ? rawParent.trim() : null;

    if (!parentId) {
      validCanonicalRootsCount++;
      continue;
    }

    if (parentId === prod.id) {
      selfReferencesCount++;
      const key = `canon:self:${prod.id}`;
      if (!seenIssueKeys.has(key)) {
        seenIssueKeys.add(key);
        issues.push({
          id: key,
          issueType: 'self_reference',
          issueLabelRo: 'Auto-referință canonică',
          severity: 'critical',
          productId: prod.id,
          productName: prod.name || prod.id,
          canonicalProductId: parentId,
          referencedIn: 'product',
          hops: 1,
          visitedChain: [prod.id, parentId],
          reasonRo: `Produsul „${prod.name || prod.id}” (${prod.id}) își indică propriul ID ca canonical_product_id.`
        });
      }
      continue;
    }

    const detail = resolveCanonicalProductDetail(prod.id, aliasIndex);
    if (detail.cycleDetected) {
      const chain = detail.visitedChain || [];
      const hasRepeatedNode = new Set(chain).size < chain.length;
      if (hasRepeatedNode) {
        cyclesCount++;
        const key = `canon:cycle:${prod.id}`;
        if (!seenIssueKeys.has(key)) {
          seenIssueKeys.add(key);
          issues.push({
            id: key,
            issueType: 'cycle',
            issueLabelRo: 'Ciclu de referințe canonice',
            severity: 'critical',
            productId: prod.id,
            productName: prod.name || prod.id,
            canonicalProductId: parentId,
            referencedIn: 'product',
            hops: detail.hops,
            visitedChain: chain,
            reasonRo: `Lanțul canonic conține un ciclu: ${chain.join(' → ')}.`
          });
        }
      } else {
        chainsTooDeepCount++;
        const key = `canon:deep:${prod.id}`;
        if (!seenIssueKeys.has(key)) {
          seenIssueKeys.add(key);
          issues.push({
            id: key,
            issueType: 'chain_too_deep',
            issueLabelRo: `Lanț alias peste limita (${DEFAULT_MAX_ALIAS_HOPS} niveluri)`,
            severity: 'high',
            productId: prod.id,
            productName: prod.name || prod.id,
            canonicalProductId: parentId,
            referencedIn: 'product',
            hops: detail.hops,
            visitedChain: chain,
            reasonRo: `Rezolvarea canonică depășește ${DEFAULT_MAX_ALIAS_HOPS} salturi (${chain.slice(0, 6).join(' → ')}...).`
          });
        }
      }
      continue;
    }

    if (!detail.found || !detail.canonicalId) {
      orphanAliasesCount++;
      const key = `canon:orphan:${prod.id}`;
      if (!seenIssueKeys.has(key)) {
        seenIssueKeys.add(key);
        issues.push({
          id: key,
          issueType: 'orphan_alias',
          issueLabelRo: 'Alias orfan (rădăcină lipsă)',
          severity: 'high',
          productId: prod.id,
          productName: prod.name || prod.id,
          canonicalProductId: parentId,
          referencedIn: 'product',
          hops: detail.hops,
          visitedChain: detail.visitedChain,
          reasonRo: `Aliasul „${prod.name || prod.id}” indică spre părintele inexistent „${parentId}”.`
        });
      }
      continue;
    }

    validAliasesCount++;
  }

  // Check inconsistent references in offers & observations
  const knownProductIds = new Set(productById.keys());
  const checkExternalRef = (
    refId: string,
    entityId: string,
    referencedIn: 'offer' | 'observation'
  ) => {
    const trimmed = (refId || '').trim();
    if (!trimmed) {
      inconsistentReferencesCount++;
      const key = `canon:inconsistent:${referencedIn}:${entityId}`;
      if (!seenIssueKeys.has(key)) {
        seenIssueKeys.add(key);
        issues.push({
          id: key,
          issueType: 'inconsistent_reference',
          issueLabelRo: 'Referință produs lipsă',
          severity: 'high',
          productId: entityId,
          productName: `Referință lipsă (${referencedIn})`,
          canonicalProductId: null,
          referencedIn,
          reasonRo: `Înregistrarea ${entityId} (${referencedIn}) nu are productId asociat.`
        });
      }
      return;
    }

    const detail = resolveCanonicalProductDetail(trimmed, aliasIndex, { knownProductIds });
    if (detail.cycleDetected || !detail.found || !detail.canonicalId) {
      inconsistentReferencesCount++;
      const key = `canon:inconsistent:${referencedIn}:${trimmed}`;
      if (!seenIssueKeys.has(key)) {
        seenIssueKeys.add(key);
        issues.push({
          id: key,
          issueType: 'inconsistent_reference',
          issueLabelRo: 'Referință inconsistentă în ofertă/observație',
          severity: detail.cycleDetected ? 'critical' : 'high',
          productId: trimmed,
          productName: productById.get(trimmed)?.name || `Produs necunoscut (${trimmed})`,
          canonicalProductId: detail.canonicalId,
          referencedIn,
          visitedChain: detail.visitedChain,
          reasonRo: detail.cycleDetected
            ? `Referința „${trimmed}” din ${referencedIn === 'offer' ? 'ofertă' : 'observație'} indică spre un lanț canonic ciclic.`
            : `Referința „${trimmed}” din ${referencedIn === 'offer' ? 'ofertă' : 'observație'} nu se rezolvă la un produs canonic existent în catalog.`
        });
      }
    }
  };

  for (const off of offers) {
    checkExternalRef(off.productId, off.id, 'offer');
  }
  for (const obs of observations) {
    checkExternalRef(obs.productId, obs.id, 'observation');
  }

  return {
    validCanonicalRootsCount,
    validAliasesCount,
    cyclesCount,
    selfReferencesCount,
    chainsTooDeepCount,
    orphanAliasesCount,
    inconsistentReferencesCount,
    issues
  };
}

function detectPrimaryAnomalyForOffer(
  offer: ProductOffer,
  assessment: PriceDataQualityAssessment,
  product: Product | undefined,
  canonicalDetail: ReturnType<typeof resolveCanonicalProductDetail>,
  todayStr: string
): {
  types: Array<{ type: PriceQualityAnomalyType; severity: PriceQualityAnomalySeverity; reasonRo: string }>;
} {
  const detected: Array<{ type: PriceQualityAnomalyType; severity: PriceQualityAnomalySeverity; reasonRo: string }> = [];

  if (canonicalDetail.cycleDetected || (canonicalDetail.wasAlias && !canonicalDetail.found) || (!product && offer.productId)) {
    detected.push({
      type: 'invalid_canonical_identity',
      severity: canonicalDetail.cycleDetected ? 'critical' : 'high',
      reasonRo: canonicalDetail.cycleDetected
        ? `Oferta ${offer.id} indică spre o identitate canonică ciclică (${offer.productId}).`
        : `Oferta ${offer.id} indică spre un produs orfan sau inexistent (${offer.productId}).`
    });
  }

  const rawMeasure = String(offer.unitPriceMeasure || '').trim();
  const hasForeignMeasure = /^(eur|usd|gbp|chf|€|\$|£)\b/i.test(rawMeasure);
  if (!isRonCurrency(offer.currency) || hasForeignMeasure) {
    detected.push({
      type: 'incompatible_currency',
      severity: 'high',
      reasonRo: `Monedă incompatibilă cu RON în ofertă (${offer.currency || rawMeasure}).`
    });
  }

  if (!Number.isFinite(offer.price) || offer.price <= 0) {
    detected.push({
      type: 'zero_or_negative_price',
      severity: 'critical',
      reasonRo: `Preț invalid în ofertă: ${String(offer.price)} RON (≤ 0).`
    });
  }

  const rawTs = offer.lastVerifiedAt || offer.lastChecked || offer.observationDate;
  const parsedTs = parseStrictIsoDate(rawTs);
  if (!rawTs || !parsedTs || parsedTs.timestampMs > Date.now() + MS_PER_DAY) {
    detected.push({
      type: 'invalid_timestamp',
      severity: 'high',
      reasonRo: !rawTs
        ? 'Oferta nu are timestamp de verificare sau observație.'
        : `Dată sau timestamp invalid/în viitor: "${String(rawTs)}".`
    });
  }

  const sourceKey = normalizeSourceToken(offer.source);
  if (isSyntheticSourceToken(sourceKey) || offer.verificationStatus === 'demo') {
    detected.push({
      type: 'untrusted_demo_or_estimated_source',
      severity: 'high',
      reasonRo: `Oferta provine dintr-o sursă demonstrativă sau estimată (${offer.source}).`
    });
  }

  const validFromStr = formatDateOnly(offer.validFrom);
  const validUntilStr = formatDateOnly(offer.validUntil);
  const hasInvalidPromoBounds =
    Boolean(validFromStr && validUntilStr && validFromStr > validUntilStr) ||
    Boolean(offer.normalPrice !== undefined && offer.normalPrice !== null && offer.normalPrice <= 0) ||
    Boolean(offer.promoPrice !== undefined && offer.promoPrice !== null && offer.promoPrice <= 0) ||
    Boolean(offer.loyaltyPrice !== undefined && offer.loyaltyPrice !== null && offer.loyaltyPrice <= 0) ||
    Boolean(offer.normalPrice && offer.promoPrice && offer.normalPrice < offer.promoPrice) ||
    Boolean(offer.isPromo && offer.normalPrice && offer.price > offer.normalPrice + 0.001) ||
    Boolean(offer.loyaltyCardRequired && !offer.loyaltyCardName) ||
    Boolean(offer.loyaltyPrice && offer.normalPrice && offer.loyaltyPrice >= offer.normalPrice);

  if (hasInvalidPromoBounds) {
    detected.push({
      type: 'inconsistent_promotion',
      severity: 'high',
      reasonRo:
        validFromStr && validUntilStr && validFromStr > validUntilStr
          ? `Perioadă promoție invalidă (${validFromStr} > ${validUntilStr}).`
          : 'Date promoționale inconsistente (preț normal < preț promoțional sau card de fidelitate incomplet).'
    });
  }

  const isExpiredByDate = Boolean(validUntilStr && validUntilStr < todayStr);
  if ((isExpiredByDate || assessment.status === 'EXPIRED') && offer.verificationStatus === 'verified') {
    detected.push({
      type: 'expired_offer_active',
      severity: 'medium',
      reasonRo: validUntilStr
        ? `Ofertă expirată la ${validUntilStr}, dar păstrată cu status verificationStatus='verified'.`
        : 'Ofertă depășită (> prag prospețime), dar marcată activă ca verificată.'
    });
  }

  const unitFactor = assessment.factors.find(f => f.key === 'unit_consistency');
  const prodFactor = assessment.factors.find(f => f.key === 'product_validity');
  if ((unitFactor && unitFactor.score <= 30) || (prodFactor && prodFactor.score <= 20)) {
    detected.push({
      type: 'unit_or_weight_conflict',
      severity: 'medium',
      reasonRo:
        (unitFactor && unitFactor.score <= 30 ? unitFactor.detailRo : prodFactor?.detailRo) ||
        'Conflict de unitate de măsură sau gramaj produs.'
    });
  }

  const anomalyFactor = assessment.factors.find(f => f.key === 'anomaly');
  if (
    assessment.status === 'SUSPICIOUS' &&
    anomalyFactor &&
    anomalyFactor.score <= 30 &&
    isRonCurrency(offer.currency) &&
    Number.isFinite(offer.price) &&
    offer.price > 0
  ) {
    detected.push({
      type: 'extreme_price_outlier',
      severity: 'high',
      reasonRo: anomalyFactor.detailRo || 'Variație extremă sau outlier de preț detectat.'
    });
  }

  return { types: detected };
}

function detectAnomaliesForObservation(
  obs: PriceObservationQualityInput,
  assessment: PriceDataQualityAssessment,
  product: Product | undefined,
  canonicalDetail: ReturnType<typeof resolveCanonicalProductDetail>,
  nowMs: number
): {
  types: Array<{ type: PriceQualityAnomalyType; severity: PriceQualityAnomalySeverity; reasonRo: string }>;
} {
  const detected: Array<{ type: PriceQualityAnomalyType; severity: PriceQualityAnomalySeverity; reasonRo: string }> = [];

  if (canonicalDetail.cycleDetected || (canonicalDetail.wasAlias && !canonicalDetail.found) || (!product && obs.productId)) {
    detected.push({
      type: 'invalid_canonical_identity',
      severity: canonicalDetail.cycleDetected ? 'critical' : 'high',
      reasonRo: canonicalDetail.cycleDetected
        ? `Observația ${obs.id} aparține unui ID canonic cu ciclu (${obs.productId}).`
        : `Observația ${obs.id} aparține unui alias orfan sau produs inexistent (${obs.productId}).`
    });
  }

  const rawMeasure = String(obs.unitPriceMeasure || '').trim();
  const hasForeignMeasure = /^(eur|usd|gbp|chf|€|\$|£)\b/i.test(rawMeasure);
  if (!isRonCurrency(obs.currency) || hasForeignMeasure) {
    detected.push({
      type: 'incompatible_currency',
      severity: 'high',
      reasonRo: `Monedă incompatibilă cu RON în observație (${obs.currency || rawMeasure}).`
    });
  }

  const numericPrice = typeof obs.price === 'number' ? obs.price : Number(obs.price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    detected.push({
      type: 'zero_or_negative_price',
      severity: 'critical',
      reasonRo: `Preț invalid în observație: ${String(obs.price)} RON (≤ 0).`
    });
  }

  const parsedTs = parseStrictIsoDate(obs.date);
  if (!obs.date || !parsedTs || parsedTs.timestampMs > nowMs + MS_PER_DAY) {
    detected.push({
      type: 'invalid_timestamp',
      severity: 'high',
      reasonRo: !obs.date
        ? 'Observația nu are dată înregistrată.'
        : `Dată calendaristică invalidă sau în viitor: "${String(obs.date)}".`
    });
  }

  const sourceKey = normalizeSourceToken(obs.source);
  if (isSyntheticSourceToken(sourceKey) || obs.verificationStatus === 'demo') {
    detected.push({
      type: 'untrusted_demo_or_estimated_source',
      severity: 'high',
      reasonRo: `Observație provenită dintr-o sursă demonstrativă sau estimată (${obs.source}).`
    });
  }

  const validFromStr = formatDateOnly(obs.validFrom);
  const validUntilStr = formatDateOnly(obs.validUntil);
  const hasInvalidPromo =
    Boolean(validFromStr && validUntilStr && validFromStr > validUntilStr) ||
    Boolean(obs.normalPrice !== undefined && obs.normalPrice !== null && obs.normalPrice <= 0) ||
    Boolean(obs.promoPrice !== undefined && obs.promoPrice !== null && obs.promoPrice <= 0) ||
    Boolean(obs.loyaltyPrice !== undefined && obs.loyaltyPrice !== null && obs.loyaltyPrice <= 0) ||
    Boolean(obs.normalPrice && obs.promoPrice && obs.normalPrice < obs.promoPrice) ||
    Boolean(obs.isPromo && obs.normalPrice && Number.isFinite(numericPrice) && numericPrice > obs.normalPrice + 0.001) ||
    Boolean(obs.loyaltyPrice && obs.normalPrice && obs.loyaltyPrice >= obs.normalPrice);

  if (hasInvalidPromo) {
    detected.push({
      type: 'inconsistent_promotion',
      severity: 'high',
      reasonRo: 'Promoție inconsistentă în observație (preț normal < preț promoțional sau interval invalid).'
    });
  }

  const unitFactor = assessment.factors.find(f => f.key === 'unit_consistency');
  const prodFactor = assessment.factors.find(f => f.key === 'product_validity');
  if ((unitFactor && unitFactor.score === 0) || (prodFactor && prodFactor.score <= 20)) {
    detected.push({
      type: 'unit_or_weight_conflict',
      severity: 'medium',
      reasonRo:
        (unitFactor && unitFactor.score === 0 ? unitFactor.detailRo : prodFactor?.detailRo) ||
        'Conflict de unitate sau gramaj în observație.'
    });
  }

  const anomalyFactor = assessment.factors.find(f => f.key === 'anomaly');
  if (
    assessment.status === 'SUSPICIOUS' &&
    anomalyFactor &&
    anomalyFactor.score <= 30 &&
    isRonCurrency(obs.currency) &&
    Number.isFinite(numericPrice) &&
    numericPrice > 0
  ) {
    detected.push({
      type: 'extreme_price_outlier',
      severity: 'high',
      reasonRo: anomalyFactor.detailRo || 'Variație extremă de preț detectată față de reperul istoric.'
    });
  }

  return { types: detected };
}

export class PriceQualityMonitoringService {
  // In-memory store for isolated mode & snapshot cache (STRICTLY separate from price_observations / product_offers)
  private static snapshotCache = new Map<string, { expiresAt: number; bundle: EvaluatedQualityMonitoringBundle }>();
  private static memoryRuns: PriceQualityMonitoringRun[] = [];
  private static memoryInvestigations = new Map<string, PriceQualityInvestigationRecord>();

  static resetMemoryState(): void {
    this.snapshotCache.clear();
    this.memoryRuns = [];
    this.memoryInvestigations.clear();
  }

  /**
   * Evaluare pur deterministă și STRICT READ-ONLY pe un dataset dat.
   * Nu modifică niciun obiect de produs, ofertă, promoție sau observație.
   */
  static evaluateDataset(
    dataset: QualityMonitoringDatasetInput,
    options: EvaluateQualityMonitoringOptions = {}
  ): EvaluatedQualityMonitoringBundle {
    const now = options.now ?? new Date();
    const nowMs = now.getTime();
    const todayStr = now.toISOString().slice(0, 10);
    const intervalDays = Math.min(365, Math.max(1, Math.floor(options.intervalDays ?? 30)));
    const maxSampleLimit = Math.max(1, Math.floor(options.maxSampleLimit ?? dataset.observations.length + dataset.offers.length + 100));
    const cutoffMs = nowMs - intervalDays * MS_PER_DAY;
    const fromDate = new Date(cutoffMs).toISOString().slice(0, 10);

    const products = dataset.products || [];
    const stores = dataset.stores || [];
    const offers = dataset.offers || [];
    const rawObservations = dataset.observations || [];
    const importErrors = dataset.importErrors || [];

    const storeMap = buildStoreMap(stores);
    const productById = new Map<string, Product>();
    for (const p of products) {
      if (p?.id) productById.set(p.id, p);
    }

    const aliasIndex: CanonicalAliasIndex = buildCanonicalAliasIndex(products);
    const canonicalDetailCache = new Map<string, ReturnType<typeof resolveCanonicalProductDetail>>();
    const getCanonicalDetail = (id: string) => {
      let cached = canonicalDetailCache.get(id);
      if (!cached) {
        cached = resolveCanonicalProductDetail(id, aliasIndex);
        canonicalDetailCache.set(id, cached);
      }
      return cached;
    };

    const investigationsMap = options.investigationsByKey ?? this.memoryInvestigations;

    // 1. Integritate canonică (Read-Only)
    const canonicalIntegrity = classifyCanonicalIssues(products, offers, rawObservations, aliasIndex, productById);

    // 2. Filtrare observații pe interval (păstrând observațiile cu date invalide pentru audit de calitate!)
    const observationsInScope: PriceObservation[] = [];
    for (const obs of rawObservations) {
      if (!obs) continue;
      const parsed = parseStrictIsoDate(obs.date);
      if (!parsed) {
        observationsInScope.push(obs);
        continue;
      }
      if (parsed.timestampMs >= cutoffMs) {
        observationsInScope.push(obs);
      }
    }

    // Grupăm observațiile după produsul canonic pentru a rula `PriceQualityClassifier.classifyObservationBatch` eficient (O(N))
    const obsByCanonicalGroup = new Map<string, PriceObservationQualityInput[]>();
    for (const obs of observationsInScope) {
      const detail = getCanonicalDetail(obs.productId);
      const groupKey = detail.canonicalId || obs.productId || 'unknown';
      const arr = obsByCanonicalGroup.get(groupKey);
      const input: PriceObservationQualityInput = {
        ...obs,
        id: obs.id || `obs-${groupKey}-${arr?.length || 0}`
      };
      if (arr) {
        arr.push(input);
      } else {
        obsByCanonicalGroup.set(groupKey, [input]);
      }
    }

    const observationAssessments = new Map<string, PriceDataQualityAssessment>();
    const observationBaselines = new Map<string, number | null>();

    for (const [groupKey, groupObs] of obsByCanonicalGroup.entries()) {
      const targetProd = productById.get(groupKey);
      const batchRes = PriceQualityClassifier.classifyObservationBatch(groupObs, {
        product: targetProd,
        expectedProductId: targetProd?.id,
        aliasSource: aliasIndex,
        now
      });
      for (const obs of groupObs) {
        const assessment = batchRes.assessmentsById[obs.id];
        if (assessment) {
          observationAssessments.set(obs.id, assessment);
          observationBaselines.set(obs.id, batchRes.baselineUsed);
        }
      }
    }

    // 3. Clasificare & colectare înregistrări + anomalii
    const obsStatusDist = emptyStatusCounts();
    const offerStatusDist = emptyStatusCounts();
    const combinedStatusDist = emptyStatusCounts();

    const anomalies: PriceQualityMonitoringAnomaly[] = [];
    const seenAnomalyKeys = new Set<string>();
    const records: PriceQualityClassifiedRecord[] = [];
    const evolutionMap = new Map<
      string,
      {
        total: number;
        verifiedRecently: number;
        verified: number;
        stale: number;
        unverified: number;
        expired: number;
        suspicious: number;
        scoreSum: number;
      }
    >();

    // Source aggregation
    const sourceStatsMap = new Map<
      string,
      {
        observationsCount: number;
        offersCount: number;
        statusCounts: PriceQualityStatusCounts;
        scoreSum: number;
        abnormalVariationCount: number;
      }
    >();

    const ensureSourceStats = (src: string) => {
      let entry = sourceStatsMap.get(src);
      if (!entry) {
        entry = {
          observationsCount: 0,
          offersCount: 0,
          statusCounts: emptyStatusCounts(),
          scoreSum: 0,
          abnormalVariationCount: 0
        };
        sourceStatsMap.set(src, entry);
      }
      return entry;
    };

    const pushAnomaly = (candidate: Omit<PriceQualityMonitoringAnomaly, 'id' | 'investigationStatus' | 'investigationNote' | 'investigationDecision' | 'investigatedBy' | 'investigatedAt'>) => {
      if (seenAnomalyKeys.has(candidate.anomalyKey)) return;
      seenAnomalyKeys.add(candidate.anomalyKey);
      const inv = investigationsMap.get(candidate.anomalyKey);
      anomalies.push({
        ...candidate,
        id: candidate.anomalyKey,
        investigationStatus: inv?.investigationStatus || 'open',
        investigationNote: inv?.note ?? null,
        investigationDecision: inv?.decision ?? null,
        investigatedBy: inv?.investigatedBy ?? null,
        investigatedAt: inv?.investigatedAt ?? null
      });
    };

    let totalScoreSum = 0;
    let totalScoreCount = 0;
    let excludedFromComparisonCount = 0;

    // 3a. Evaluăm observațiile
    for (const obs of observationsInScope) {
      const assessment =
        observationAssessments.get(obs.id) ||
        PriceQualityClassifier.classifyObservation(obs, {
          product: productById.get(getCanonicalDetail(obs.productId).canonicalId || obs.productId),
          aliasSource: aliasIndex,
          now
        });

      const canonicalDetail = getCanonicalDetail(obs.productId);
      const resolvedProd = productById.get(canonicalDetail.canonicalId || obs.productId) || productById.get(obs.productId);
      const storeKey = normalizeHistoryStoreKey(obs.storeId) || obs.storeId || 'unknown';
      const storeName = resolveStoreName(obs.storeId, storeMap);
      const sourceKey = normalizeSourceToken(obs.source);
      const sourceLabel = formatPriceSourceLabel(sourceKey);

      obsStatusDist[assessment.status]++;
      combinedStatusDist[assessment.status]++;
      totalScoreSum += assessment.score;
      totalScoreCount++;
      if (!assessment.isUsableForComparison) {
        excludedFromComparisonCount++;
      }

      const srcEntry = ensureSourceStats(sourceKey);
      srcEntry.observationsCount++;
      srcEntry.statusCounts[assessment.status]++;
      srcEntry.scoreSum += assessment.score;

      const parsedDate = parseStrictIsoDate(obs.date);
      if (parsedDate && parsedDate.timestampMs <= nowMs + MS_PER_DAY) {
        const evo = evolutionMap.get(parsedDate.isoDate) || {
          total: 0,
          verifiedRecently: 0,
          verified: 0,
          stale: 0,
          unverified: 0,
          expired: 0,
          suspicious: 0,
          scoreSum: 0
        };
        evo.total++;
        evo.scoreSum += assessment.score;
        if (assessment.status === 'VERIFIED_RECENTLY') evo.verifiedRecently++;
        else if (assessment.status === 'VERIFIED') evo.verified++;
        else if (assessment.status === 'STALE') evo.stale++;
        else if (assessment.status === 'UNVERIFIED') evo.unverified++;
        else if (assessment.status === 'EXPIRED') evo.expired++;
        else if (assessment.status === 'SUSPICIOUS') evo.suspicious++;
        evolutionMap.set(parsedDate.isoDate, evo);
      }

      records.push({
        id: obs.id,
        recordType: 'observation',
        productId: obs.productId,
        canonicalProductId: assessment.canonicalProductId || canonicalDetail.canonicalId,
        originalProductId: obs.originalProductId || assessment.originalProductId,
        productName: resolvedProd?.name || `Produs (${obs.productId})`,
        brand: resolvedProd?.brand,
        storeId: storeKey,
        storeName,
        source: sourceKey,
        sourceLabel,
        price: Number.isFinite(obs.price) ? obs.price : 0,
        normalPrice: obs.normalPrice ?? null,
        promoPrice: obs.promoPrice ?? null,
        currency: obs.currency || 'RON',
        observedDate: formatDateOnly(obs.date) || 'Dată invalidă',
        lastVerifiedAt: assessment.lastVerifiedAt,
        verificationStatus: (obs as PriceObservationQualityInput).verificationStatus,
        qualityStatus: assessment.status,
        qualityLabelRo: assessment.labelRo,
        qualityScore: assessment.score,
        isUsableForComparison: assessment.isUsableForComparison,
        isReliableForOptimization: assessment.isReliableForOptimization,
        reasons: assessment.reasons
      });

      const obsBaseline = observationBaselines.get(obs.id) ?? resolvedProd?.baseReferencePrice ?? null;
      const obsAnoms = detectAnomaliesForObservation(obs, assessment, resolvedProd, canonicalDetail, nowMs);
      for (const a of obsAnoms.types) {
        if (a.type === 'extreme_price_outlier') {
          srcEntry.abnormalVariationCount++;
        }
        const devPct =
          obsBaseline && obsBaseline > 0 && Number.isFinite(obs.price)
            ? Math.round(((obs.price - obsBaseline) / obsBaseline) * 1000) / 10
            : null;
        pushAnomaly({
          anomalyKey: `obs:${obs.id}:${a.type}`,
          anomalyType: a.type,
          anomalyTypeLabelRo: ANOMALY_TYPE_LABELS_RO[a.type],
          severity: a.severity,
          targetType: 'observation',
          observationId: obs.id,
          productId: obs.productId,
          canonicalProductId: canonicalDetail.canonicalId,
          productName: resolvedProd?.name || `Produs (${obs.productId})`,
          storeId: storeKey,
          storeName,
          source: sourceKey,
          sourceLabel,
          price: Number.isFinite(obs.price) ? obs.price : 0,
          currency: obs.currency || 'RON',
          baselinePrice: obsBaseline,
          deviationPct: devPct,
          observedDate: formatDateOnly(obs.date) || todayStr,
          detectedAt: now.toISOString(),
          reasonRo: a.reasonRo,
          qualityStatus: assessment.status
        });
      }
    }

    // 3b. Evaluăm ofertele curente & expirate + detectăm prețurile contradictorii multi-sursă
    const activeComparisonBuckets = new Map<
      string,
      Array<{
        canonicalId: string;
        storeKey: string;
        storeName: string;
        productName: string;
        source: string;
        sourceLabel: string;
        price: number;
        isPromo: boolean;
        offerId?: string;
        observationId?: string;
        observedDate: string;
      }>
    >();

    for (const off of offers) {
      const canonicalDetail = getCanonicalDetail(off.productId);
      const resolvedProd = productById.get(canonicalDetail.canonicalId || off.productId) || productById.get(off.productId);
      const assessment = PriceQualityClassifier.classifyOffer(off, {
        product: resolvedProd,
        aliasSource: aliasIndex,
        now
      });

      const storeKey = normalizeHistoryStoreKey(off.storeId) || off.storeId || 'unknown';
      const storeName = resolveStoreName(off.storeId, storeMap);
      const sourceKey = normalizeSourceToken(off.source);
      const sourceLabel = formatPriceSourceLabel(sourceKey);

      offerStatusDist[assessment.status]++;
      combinedStatusDist[assessment.status]++;
      totalScoreSum += assessment.score;
      totalScoreCount++;
      if (!assessment.isUsableForComparison) {
        excludedFromComparisonCount++;
      }

      const srcEntry = ensureSourceStats(sourceKey);
      srcEntry.offersCount++;
      srcEntry.statusCounts[assessment.status]++;
      srcEntry.scoreSum += assessment.score;

      const validUntilStr = formatDateOnly(off.validUntil);
      const isExpiredOffer =
        assessment.status === 'EXPIRED' ||
        off.verificationStatus === 'expired' ||
        Boolean(validUntilStr && validUntilStr < todayStr);
      let expiredDaysAgo: number | null = null;
      if (validUntilStr && validUntilStr < todayStr) {
        const parsedExp = parseStrictIsoDate(validUntilStr);
        if (parsedExp) {
          expiredDaysAgo = Math.max(1, Math.floor((nowMs - parsedExp.timestampMs) / MS_PER_DAY));
        }
      }

      records.push({
        id: off.id,
        recordType: 'offer',
        productId: off.productId,
        canonicalProductId: assessment.canonicalProductId || canonicalDetail.canonicalId,
        originalProductId: (off as { originalProductId?: string }).originalProductId || assessment.originalProductId,
        productName: resolvedProd?.name || `Produs (${off.productId})`,
        brand: resolvedProd?.brand,
        storeId: storeKey,
        storeName,
        source: sourceKey,
        sourceLabel,
        price: Number.isFinite(off.price) ? off.price : 0,
        normalPrice: off.normalPrice ?? null,
        promoPrice: off.promoPrice ?? null,
        currency: off.currency || 'RON',
        observedDate: formatDateOnly(off.observationDate || off.lastVerifiedAt || off.lastChecked) || 'Dată lipsă',
        lastVerifiedAt: assessment.lastVerifiedAt,
        validFrom: formatDateOnly(off.validFrom) || undefined,
        validUntil: validUntilStr || undefined,
        verificationStatus: off.verificationStatus,
        qualityStatus: assessment.status,
        qualityLabelRo: assessment.labelRo,
        qualityScore: assessment.score,
        isUsableForComparison: assessment.isUsableForComparison,
        isReliableForOptimization: assessment.isReliableForOptimization,
        reasons: assessment.reasons,
        isExpiredOffer,
        expiredDaysAgo
      });

      const offAnoms = detectPrimaryAnomalyForOffer(off, assessment, resolvedProd, canonicalDetail, todayStr);
      const baseline = resolvedProd?.baseReferencePrice && resolvedProd.baseReferencePrice > 0 ? resolvedProd.baseReferencePrice : null;
      for (const a of offAnoms.types) {
        if (a.type === 'extreme_price_outlier') {
          srcEntry.abnormalVariationCount++;
        }
        const devPct =
          baseline && baseline > 0 && Number.isFinite(off.price)
            ? Math.round(((off.price - baseline) / baseline) * 1000) / 10
            : null;
        pushAnomaly({
          anomalyKey: `off:${off.id}:${a.type}`,
          anomalyType: a.type,
          anomalyTypeLabelRo: ANOMALY_TYPE_LABELS_RO[a.type],
          severity: a.severity,
          targetType: 'offer',
          offerId: off.id,
          productId: off.productId,
          canonicalProductId: canonicalDetail.canonicalId,
          productName: resolvedProd?.name || `Produs (${off.productId})`,
          storeId: storeKey,
          storeName,
          source: sourceKey,
          sourceLabel,
          price: Number.isFinite(off.price) ? off.price : 0,
          currency: off.currency || 'RON',
          baselinePrice: baseline,
          deviationPct: devPct,
          observedDate: formatDateOnly(off.observationDate || off.lastVerifiedAt || off.lastChecked) || todayStr,
          detectedAt: now.toISOString(),
          reasonRo: a.reasonRo,
          qualityStatus: assessment.status
        });
      }

      // Adăugăm la verificarea de contradicție multi-sursă dacă are preț valid RON și nu e sintetic/expirat
      if (
        canonicalDetail.canonicalId &&
        !canonicalDetail.cycleDetected &&
        isRonCurrency(off.currency) &&
        Number.isFinite(off.price) &&
        off.price > 0 &&
        !isSyntheticSourceToken(sourceKey) &&
        assessment.status !== 'EXPIRED'
      ) {
        const bucketKey = `${canonicalDetail.canonicalId}::${storeKey}`;
        const list = activeComparisonBuckets.get(bucketKey) || [];
        list.push({
          canonicalId: canonicalDetail.canonicalId,
          storeKey,
          storeName,
          productName: resolvedProd?.name || canonicalDetail.canonicalId,
          source: sourceKey,
          sourceLabel,
          price: off.price,
          isPromo: Boolean(off.isPromo),
          offerId: off.id,
          observedDate: formatDateOnly(off.observationDate || off.lastChecked) || todayStr
        });
        activeComparisonBuckets.set(bucketKey, list);
      }
    }

    // Verificăm și observațiile recente (ultimele 7 zile) pentru contradicții multi-sursă în aceeași zi & magazin
    const recentObsCutoffMs = nowMs - 7 * MS_PER_DAY;
    for (const obs of observationsInScope) {
      const parsed = parseStrictIsoDate(obs.date);
      if (!parsed || parsed.timestampMs < recentObsCutoffMs || parsed.timestampMs > nowMs + MS_PER_DAY) continue;
      if (!isRonCurrency(obs.currency) || !Number.isFinite(obs.price) || obs.price <= 0) continue;
      const sourceKey = normalizeSourceToken(obs.source);
      if (isSyntheticSourceToken(sourceKey)) continue;
      const canonicalDetail = getCanonicalDetail(obs.productId);
      if (!canonicalDetail.canonicalId || canonicalDetail.cycleDetected) continue;
      const storeKey = normalizeHistoryStoreKey(obs.storeId) || obs.storeId || 'unknown';
      const resolvedProd = productById.get(canonicalDetail.canonicalId);
      const bucketKey = `${canonicalDetail.canonicalId}::${storeKey}::${parsed.isoDate}`;
      const list = activeComparisonBuckets.get(bucketKey) || [];
      list.push({
        canonicalId: canonicalDetail.canonicalId,
        storeKey,
        storeName: resolveStoreName(obs.storeId, storeMap),
        productName: resolvedProd?.name || canonicalDetail.canonicalId,
        source: sourceKey,
        sourceLabel: formatPriceSourceLabel(sourceKey),
        price: obs.price,
        isPromo: Boolean(
          (obs as PriceObservationQualityInput).isPromo ||
            (obs.promoPrice != null && obs.normalPrice != null && obs.promoPrice < obs.normalPrice)
        ),
        observationId: obs.id,
        observedDate: parsed.isoDate
      });
      activeComparisonBuckets.set(bucketKey, list);
    }

    // Detectăm prețuri contradictorii între surse diferite pentru același produs și magazin
    for (const [bucketKey, entries] of activeComparisonBuckets.entries()) {
      if (entries.length < 2) continue;
      const distinctSources = new Set(entries.map(e => e.source));
      if (distinctSources.size < 2) continue;

      let minEntry = entries[0];
      let maxEntry = entries[0];
      for (const e of entries) {
        if (e.price < minEntry.price) minEntry = e;
        if (e.price > maxEntry.price) maxEntry = e;
      }

      const spreadRatio = minEntry.price > 0 ? (maxEntry.price - minEntry.price) / minEntry.price : 0;
      const hasValidPromoDifference = minEntry.isPromo && !maxEntry.isPromo && spreadRatio <= 0.55;
      if (spreadRatio > 0.45 && !hasValidPromoDifference) {
        const srcEntry = ensureSourceStats(maxEntry.source);
        srcEntry.abnormalVariationCount++;
        const devPct = Math.round(spreadRatio * 1000) / 10;
        pushAnomaly({
          anomalyKey: `multi:${bucketKey}`,
          anomalyType: 'conflicting_multi_source_prices',
          anomalyTypeLabelRo: ANOMALY_TYPE_LABELS_RO.conflicting_multi_source_prices,
          severity: spreadRatio > 0.85 ? 'high' : 'medium',
          targetType: maxEntry.offerId ? 'offer' : 'observation',
          offerId: maxEntry.offerId,
          observationId: maxEntry.observationId,
          productId: maxEntry.canonicalId,
          canonicalProductId: maxEntry.canonicalId,
          productName: maxEntry.productName,
          storeId: maxEntry.storeKey,
          storeName: maxEntry.storeName,
          source: `${minEntry.source} vs ${maxEntry.source}`,
          sourceLabel: `${minEntry.sourceLabel} vs ${maxEntry.sourceLabel}`,
          price: maxEntry.price,
          currency: 'RON',
          baselinePrice: minEntry.price,
          deviationPct: devPct,
          observedDate: maxEntry.observedDate,
          detectedAt: now.toISOString(),
          reasonRo: `Prețuri contradictorii pentru „${maxEntry.productName}” la ${maxEntry.storeName}: ${minEntry.sourceLabel} raportează ${minEntry.price.toFixed(2)} RON, iar ${maxEntry.sourceLabel} raportează ${maxEntry.price.toFixed(2)} RON (+${Math.round(spreadRatio * 100)}%).`,
          qualityStatus: 'SUSPICIOUS'
        });
      }
    }

    // Adăugăm problemele de integritate canonică (produse) și în lista anomaliilor dacă nu au fost deja emise prin oferte/observații
    for (const issue of canonicalIntegrity.issues) {
      if (issue.referencedIn === 'product') {
        pushAnomaly({
          anomalyKey: `prod:${issue.productId}:invalid_canonical_identity`,
          anomalyType: 'invalid_canonical_identity',
          anomalyTypeLabelRo: ANOMALY_TYPE_LABELS_RO.invalid_canonical_identity,
          severity: issue.severity,
          targetType: 'product',
          productId: issue.productId,
          canonicalProductId: issue.canonicalProductId || null,
          productName: issue.productName,
          storeId: 'catalog',
          storeName: 'Catalog Canonic',
          source: 'canonical_graph',
          sourceLabel: 'Grafic Identitate Canonică',
          price: productById.get(issue.productId)?.baseReferencePrice || 0,
          currency: 'RON',
          baselinePrice: null,
          deviationPct: null,
          observedDate: todayStr,
          detectedAt: now.toISOString(),
          reasonRo: issue.reasonRo,
          qualityStatus: 'SUSPICIOUS'
        });
      }
    }

    // 4. Import errors per retailer / source
    const importErrorsBySource = new Map<string, number>();
    for (const err of importErrors) {
      const key = normalizeSourceToken(err.retailerId || 'import');
      importErrorsBySource.set(key, (importErrorsBySource.get(key) || 0) + 1);
    }

    const sourceQuality: PriceQualitySourceMetric[] = Array.from(sourceStatsMap.entries())
      .map(([source, st]) => {
        const totalRecords = st.observationsCount + st.offersCount;
        const suspiciousPct =
          totalRecords > 0 ? Math.round((st.statusCounts.SUSPICIOUS / totalRecords) * 1000) / 10 : 0;
        const avgQualityScore = totalRecords > 0 ? Math.round(st.scoreSum / totalRecords) : 0;
        const importErrorCount = importErrorsBySource.get(source) || 0;

        let reliabilityStatus: PriceQualitySourceMetric['reliabilityStatus'] = 'healthy';
        let reliabilityLabelRo = 'Fiabilă';
        if (isSyntheticSourceToken(source)) {
          reliabilityStatus = 'untrusted';
          reliabilityLabelRo = 'Sursă neacreditată (demo/estimare)';
        } else if (suspiciousPct >= 20 || st.abnormalVariationCount >= 3 || importErrorCount >= 10) {
          reliabilityStatus = 'critical';
          reliabilityLabelRo = 'Necesită verificare urgentă';
        } else if (
          suspiciousPct >= 5 ||
          st.statusCounts.UNVERIFIED > st.statusCounts.VERIFIED + st.statusCounts.VERIFIED_RECENTLY ||
          importErrorCount > 0
        ) {
          reliabilityStatus = 'warning';
          reliabilityLabelRo = 'Atenție moderată';
        }

        return {
          source,
          sourceLabel: formatPriceSourceLabel(source),
          totalRecords,
          observationsCount: st.observationsCount,
          offersCount: st.offersCount,
          statusCounts: st.statusCounts,
          suspiciousPct,
          unverifiedCount: st.statusCounts.UNVERIFIED,
          staleCount: st.statusCounts.STALE,
          expiredCount: st.statusCounts.EXPIRED,
          importErrorCount,
          abnormalVariationCount: st.abnormalVariationCount,
          avgQualityScore,
          reliabilityStatus,
          reliabilityLabelRo
        };
      })
      .sort((a, b) => b.totalRecords - a.totalRecords);

    // 5. Evoluția reală în timp (strict din timestamp-urile reale ale observațiilor)
    const evolution: PriceQualityEvolutionPoint[] = Array.from(evolutionMap.entries())
      .sort(([d1], [d2]) => d1.localeCompare(d2))
      .map(([date, bucket]) => ({
        date,
        total: bucket.total,
        verifiedRecently: bucket.verifiedRecently,
        verified: bucket.verified,
        stale: bucket.stale,
        unverified: bucket.unverified,
        expired: bucket.expired,
        suspicious: bucket.suspicious,
        suspiciousPct: bucket.total > 0 ? Math.round((bucket.suspicious / bucket.total) * 1000) / 10 : 0,
        avgScore: bucket.total > 0 ? Math.round(bucket.scoreSum / bucket.total) : null
      }));

    // 6. Contoare agregate
    const anomaliesByType = emptyAnomaliesByType();
    const anomaliesBySeverity = emptyAnomaliesBySeverity();
    let openAnomaliesCount = 0;
    let investigatedAnomaliesCount = 0;

    for (const a of anomalies) {
      anomaliesByType[a.anomalyType]++;
      anomaliesBySeverity[a.severity]++;
      if (a.investigationStatus === 'open') {
        openAnomaliesCount++;
      } else {
        investigatedAnomaliesCount++;
      }
    }

    // Sortăm anomaliile: severitate descrescătoare, apoi cele deschise primele, apoi data descrescătoare
    const severityWeight: Record<PriceQualityAnomalySeverity, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };
    anomalies.sort((a, b) => {
      if (a.investigationStatus === 'open' && b.investigationStatus !== 'open') return -1;
      if (a.investigationStatus !== 'open' && b.investigationStatus === 'open') return 1;
      const sevDiff = severityWeight[b.severity] - severityWeight[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.observedDate.localeCompare(a.observedDate);
    });

    const totalRecordsAnalyzed = observationsInScope.length + offers.length;
    const totalObsPeriod = dataset.totalObservationsInPeriod ?? observationsInScope.length;
    const totalOffersCat = dataset.totalOffersInCatalog ?? offers.length;
    const isPartialSample =
      totalObsPeriod > observationsInScope.length || totalOffersCat > offers.length;

    const suspiciousPct =
      totalRecordsAnalyzed > 0
        ? Math.round((combinedStatusDist.SUSPICIOUS / totalRecordsAnalyzed) * 1000) / 10
        : 0;

    const dataSource = dataset.dataSource || 'storage_service';
    const coverageNoteRo =
      totalRecordsAnalyzed === 0
        ? `Nu există observații sau oferte în intervalul selectat (${intervalDays} zile) pentru sursa ${dataSource}.`
        : isPartialSample
        ? `Eșantion parțial mărginit: au fost analizate ${observationsInScope.length.toLocaleString('ro-RO')} din ${totalObsPeriod.toLocaleString('ro-RO')} observații (${intervalDays} zile) și ${offers.length.toLocaleString('ro-RO')} din ${totalOffersCat.toLocaleString('ro-RO')} oferte (limită ${maxSampleLimit.toLocaleString('ro-RO')}).`
        : `Acoperire completă pentru intervalul de ${intervalDays} zile: ${observationsInScope.length.toLocaleString('ro-RO')} observații și ${offers.length.toLocaleString('ro-RO')} oferte analizate integral.`;

    const coverage: PriceQualityCoverageInfo = {
      intervalDays,
      fromDate,
      toDate: todayStr,
      lastUpdatedAt: now.toISOString(),
      analyzedObservationsCount: observationsInScope.length,
      analyzedOffersCount: offers.length,
      totalObservationsInPeriod: totalObsPeriod,
      totalOffersInCatalog: totalOffersCat,
      totalProductsChecked: products.length,
      isPartialSample,
      maxSampleLimit,
      dataSource,
      coverageNoteRo
    };

    const overview: PriceQualityMonitoringOverview = {
      hasData: totalRecordsAnalyzed > 0 || products.length > 0,
      methodologyVersion: PRICE_QUALITY_METHODOLOGY_VERSION,
      coverage,
      kpis: {
        totalRecordsAnalyzed,
        totalObservationsAnalyzed: observationsInScope.length,
        totalOffersAnalyzed: offers.length,
        suspiciousCount: combinedStatusDist.SUSPICIOUS,
        suspiciousPct,
        expiredOffersCount: offerStatusDist.EXPIRED,
        unverifiedCount: combinedStatusDist.UNVERIFIED,
        staleCount: combinedStatusDist.STALE,
        excludedFromComparisonCount,
        verifiedCount: combinedStatusDist.VERIFIED,
        verifiedRecentlyCount: combinedStatusDist.VERIFIED_RECENTLY,
        avgQualityScore: totalScoreCount > 0 ? Math.round(totalScoreSum / totalScoreCount) : null,
        anomaliesDetectedCount: anomalies.length,
        openAnomaliesCount,
        investigatedAnomaliesCount,
        canonicalIssuesCount: canonicalIntegrity.issues.length
      },
      statusDistribution: combinedStatusDist,
      observationStatusDistribution: obsStatusDist,
      offerStatusDistribution: offerStatusDist,
      evolution,
      sourceQuality,
      canonicalIntegrity: {
        totalProductsScanned: products.length,
        totalIssuesCount: canonicalIntegrity.issues.length,
        ...canonicalIntegrity
      },
      anomaliesByType,
      anomaliesBySeverity,
      latestRun: options.latestRun ?? null
    };

    return {
      overview,
      anomalies,
      records
    };
  }

  /**
   * Filtrare și paginare deterministă a anomaliilor fără expunere PII.
   */
  static filterAndPaginateAnomalies(
    anomalies: PriceQualityMonitoringAnomaly[],
    filter: QualityAnomaliesFilter = {}
  ): {
    items: PriceQualityMonitoringAnomaly[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const query = (filter.productQuery || '').trim().toLowerCase();
    const storeFilter = filter.storeId && filter.storeId !== 'all' ? normalizeHistoryStoreKey(filter.storeId) : null;
    const sourceFilter = filter.source && filter.source !== 'all' ? filter.source.trim().toLowerCase() : null;

    const filtered = anomalies.filter(a => {
      if (filter.qualityStatus && filter.qualityStatus !== 'all' && a.qualityStatus !== filter.qualityStatus) {
        return false;
      }
      if (storeFilter && normalizeHistoryStoreKey(a.storeId) !== storeFilter) {
        return false;
      }
      if (sourceFilter && !a.source.toLowerCase().includes(sourceFilter)) {
        return false;
      }
      if (filter.anomalyType && filter.anomalyType !== 'all' && a.anomalyType !== filter.anomalyType) {
        return false;
      }
      if (filter.severity && filter.severity !== 'all' && a.severity !== filter.severity) {
        return false;
      }
      if (
        filter.investigationStatus &&
        filter.investigationStatus !== 'all' &&
        a.investigationStatus !== filter.investigationStatus
      ) {
        return false;
      }
      if (filter.fromDate && a.observedDate < filter.fromDate) {
        return false;
      }
      if (filter.toDate && a.observedDate > filter.toDate) {
        return false;
      }
      if (query) {
        const hay = `${a.productName} ${a.productId} ${a.canonicalProductId || ''} ${a.reasonRo}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(1, filter.page ?? 1), totalPages);
    const start = (page - 1) * limit;

    return {
      items: filtered.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages
    };
  }

  /**
   * Filtrare și paginare deterministă a observațiilor/ofertelor clasificate.
   */
  static filterAndPaginateRecords(
    records: PriceQualityClassifiedRecord[],
    filter: QualityRecordsFilter = {}
  ): {
    items: PriceQualityClassifiedRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const query = (filter.productQuery || '').trim().toLowerCase();
    const storeFilter = filter.storeId && filter.storeId !== 'all' ? normalizeHistoryStoreKey(filter.storeId) : null;
    const sourceFilter = filter.source && filter.source !== 'all' ? filter.source.trim().toLowerCase() : null;

    const filtered = records.filter(r => {
      if (filter.recordType === 'observations' && r.recordType !== 'observation') return false;
      if (filter.recordType === 'offers' && r.recordType !== 'offer') return false;
      if (filter.recordType === 'expired_offers' && !(r.recordType === 'offer' && r.isExpiredOffer)) {
        return false;
      }
      if (filter.qualityStatus && filter.qualityStatus !== 'all' && r.qualityStatus !== filter.qualityStatus) {
        return false;
      }
      if (storeFilter && normalizeHistoryStoreKey(r.storeId) !== storeFilter) return false;
      if (sourceFilter && r.source.toLowerCase() !== sourceFilter) return false;
      if (filter.fromDate && r.observedDate < filter.fromDate) return false;
      if (filter.toDate && r.observedDate > filter.toDate) return false;
      if (query) {
        const hay = `${r.productName} ${r.productId} ${r.canonicalProductId || ''} ${r.brand || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(1, filter.page ?? 1), totalPages);
    const start = (page - 1) * limit;

    return {
      items: filtered.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages
    };
  }

  /**
   * Construiește CSV sigur (fără formule injectabile și fără PII) pentru export raport.
   */
  static buildExportCsv(
    overview: PriceQualityMonitoringOverview,
    anomalies: PriceQualityMonitoringAnomaly[]
  ): string {
    const lines: string[] = [];
    lines.push(
      [
        'id_anomalie',
        'tip_anomalie',
        'eticheta_anomalie',
        'severitate',
        'tip_entitate',
        'id_produs',
        'id_canonic',
        'nume_produs',
        'id_magazin',
        'magazin',
        'sursa',
        'pret_ron',
        'moneda',
        'pret_reper_ron',
        'deviatie_pct',
        'data_observatie',
        'status_calitate',
        'status_investigare',
        'nota_admin',
        'investigat_de',
        'investigat_la',
        'motiv_detectie'
      ]
        .map(escapeCsvCell)
        .join(',')
    );

    for (const a of anomalies) {
      lines.push(
        [
          a.id,
          a.anomalyType,
          a.anomalyTypeLabelRo,
          a.severity,
          a.targetType,
          a.productId,
          a.canonicalProductId || '',
          a.productName,
          a.storeId,
          a.storeName,
          a.source,
          a.price,
          a.currency,
          a.baselinePrice ?? '',
          a.deviationPct ?? '',
          a.observedDate,
          a.qualityStatus,
          a.investigationStatus,
          a.investigationNote || '',
          a.investigatedBy || '',
          a.investigatedAt || '',
          a.reasonRo
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }

    lines.push('');
    lines.push(
      [
        '# METADATE_ACOPERIRE',
        `interval_zile=${overview.coverage.intervalDays}`,
        `observatii_analizate=${overview.coverage.analyzedObservationsCount}`,
        `oferte_analizate=${overview.coverage.analyzedOffersCount}`,
        `esantion_partial=${overview.coverage.isPartialSample}`,
        `ultima_actualizare=${overview.coverage.lastUpdatedAt}`,
        `sursa_date=${overview.coverage.dataSource}`
      ]
        .map(escapeCsvCell)
        .join(',')
    );

    return lines.join('\n');
  }

  /**
   * Construiește obiectul JSON complet pentru export raport calitate (fără PII).
   */
  static buildExportJson(
    overview: PriceQualityMonitoringOverview,
    anomalies: PriceQualityMonitoringAnomaly[]
  ) {
    return {
      exportedAt: new Date().toISOString(),
      methodologyVersion: overview.methodologyVersion,
      coverage: overview.coverage,
      kpis: overview.kpis,
      statusDistribution: overview.statusDistribution,
      observationStatusDistribution: overview.observationStatusDistribution,
      offerStatusDistribution: overview.offerStatusDistribution,
      sourceQuality: overview.sourceQuality,
      canonicalIntegrity: overview.canonicalIntegrity,
      anomaliesCount: anomalies.length,
      anomalies
    };
  }

  /**
   * Încarcă dataset-ul mărginit și agregat din PostgreSQL / Supabase / StorageService.
   * STRICT READ-ONLY — nu face UPDATE/DELETE pe datele de preț.
   */
  static async loadBoundedDataset(options: {
    intervalDays?: number;
    maxSampleLimit?: number;
  } = {}): Promise<QualityMonitoringDatasetInput> {
    const intervalDays = Math.min(365, Math.max(1, Math.floor(options.intervalDays ?? 30)));
    const maxSampleLimit = Math.min(5000, Math.max(50, Math.floor(options.maxSampleLimit ?? 2000)));
    const cutoffIso = new Date(Date.now() - intervalDays * MS_PER_DAY).toISOString().slice(0, 10);
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';

    if (!isIsolated) {
      const { getPool, DatabaseService } = await import('../db/index.js');
      const pool = getPool();
      if (pool) {
        try {
          const [products, stores, offers, obsCountRes, offersCountRes, obsRowsRes, errRowsRes] = await Promise.all([
            DatabaseService.getProducts(),
            DatabaseService.getStores(),
            DatabaseService.getOffers(),
            pool.query('SELECT COUNT(*)::int AS cnt FROM price_observations WHERE date >= $1::date', [cutoffIso]),
            pool.query('SELECT COUNT(*)::int AS cnt FROM product_offers'),
            pool.query(
              `SELECT * FROM price_observations
               WHERE date >= $1::date
               ORDER BY date DESC, created_at DESC
               LIMIT $2`,
              [cutoffIso, maxSampleLimit]
            ),
            pool
              .query('SELECT * FROM catalog_import_errors ORDER BY created_at DESC LIMIT 500')
              .catch(() => ({ rows: [] }))
          ]);

          const observations: PriceObservation[] = (obsRowsRes.rows || []).map((r: any) => ({
            id: r.id,
            productId: String(r.product_id || ''),
            storeId: normalizeHistoryStoreKey(r.store_id),
            sourceId: r.source_id || undefined,
            price: parseFloat(r.price),
            currency: r.currency || 'RON',
            date: r.date ? (r.date.toISOString?.().split('T')[0] || String(r.date).slice(0, 10)) : '',
            receiptId: r.receipt_id || undefined,
            loyaltyCardUsed: Boolean(r.loyalty_card_used),
            source: r.source || 'verified',
            normalPrice: r.normal_price != null ? parseFloat(r.normal_price) : undefined,
            promoPrice: r.promo_price != null ? parseFloat(r.promo_price) : undefined,
            loyaltyPrice: r.loyalty_price != null ? parseFloat(r.loyalty_price) : undefined,
            region: r.region || undefined,
            batchId: r.batch_id || undefined
          }));

          const importErrors: CatalogImportError[] = (errRowsRes.rows || []).map((r: any) => ({
            id: String(r.id || ''),
            runId: r.run_id || undefined,
            documentId: r.document_id || undefined,
            retailerId: String(r.retailer_id || ''),
            stage: (['discovery', 'download', 'parse', 'matching', 'validation', 'publishing'].includes(r.stage)
              ? r.stage
              : 'parse') as CatalogImportError['stage'],
            message: String(r.message || r.error_message || ''),
            errorDetail: r.error_detail || r.raw_title || undefined,
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
          }));

          return {
            products,
            stores,
            offers: offers.slice(0, maxSampleLimit),
            observations,
            importErrors,
            totalObservationsInPeriod: Number(obsCountRes.rows?.[0]?.cnt ?? observations.length),
            totalOffersInCatalog: Number(offersCountRes.rows?.[0]?.cnt ?? offers.length),
            dataSource: 'postgresql'
          };
        } catch (err: any) {
          console.warn('PriceQualityMonitoringService PostgreSQL bounded load fallback:', err.message);
        }
      }

      // Supabase read-only bounded fallback (folosește service_role când este disponibil pe server)
      try {
        const { DatabaseService, getServerSupabaseClient } = await import('../db/index.js');
        const serverSupabase = getServerSupabaseClient();
        if (serverSupabase) {
          const [products, stores, offers, obsRes] = await Promise.all([
            DatabaseService.getProducts(),
            DatabaseService.getStores(),
            DatabaseService.getOffers(),
            serverSupabase
              .from('price_observations')
              .select('*', { count: 'exact' })
              .gte('date', cutoffIso)
              .order('date', { ascending: false })
              .range(0, maxSampleLimit - 1)
          ]);

          if (!obsRes.error && Array.isArray(obsRes.data)) {
            const observations: PriceObservation[] = obsRes.data.map((r: any) => ({
              id: r.id,
              productId: String(r.product_id || ''),
              storeId: normalizeHistoryStoreKey(r.store_id),
              sourceId: r.source_id || undefined,
              price: parseFloat(r.price),
              currency: r.currency || 'RON',
              date: r.date ? String(r.date).slice(0, 10) : '',
              receiptId: r.receipt_id || undefined,
              loyaltyCardUsed: Boolean(r.loyalty_card_used),
              source: r.source || 'verified',
              normalPrice: r.normal_price != null ? parseFloat(r.normal_price) : undefined,
              promoPrice: r.promo_price != null ? parseFloat(r.promo_price) : undefined,
              loyaltyPrice: r.loyalty_price != null ? parseFloat(r.loyalty_price) : undefined,
              region: r.region || undefined,
              batchId: r.batch_id || undefined
            }));

            return {
              products,
              stores,
              offers: offers.slice(0, maxSampleLimit),
              observations,
              importErrors: StorageService.getCatalogImportErrors(),
              totalObservationsInPeriod: obsRes.count ?? observations.length,
              totalOffersInCatalog: offers.length,
              dataSource: 'supabase'
            };
          }
        }
      } catch (err: any) {
        console.warn('PriceQualityMonitoringService Supabase fallback:', err.message);
      }
    }

    // StorageService isolated / local fallback
    const allObs = StorageService.getPriceObservations();
    const allOffers = StorageService.getProductOffers();
    const obsFiltered = allObs.filter(o => {
      const p = parseStrictIsoDate(o.date);
      return !p || p.isoDate >= cutoffIso;
    });
    return {
      products: StorageService.getAllProducts(),
      stores: StorageService.getStores(),
      offers: allOffers.slice(0, maxSampleLimit),
      observations: obsFiltered.slice(0, maxSampleLimit),
      importErrors: StorageService.getCatalogImportErrors(),
      totalObservationsInPeriod: obsFiltered.length,
      totalOffersInCatalog: allOffers.length,
      dataSource: 'storage_service'
    };
  }

  /**
   * Încarcă investigațiile salvate (din PROPOSED_015 dacă există, else din admin_audit_logs + memory).
   */
  static async loadInvestigationsMap(): Promise<Map<string, PriceQualityInvestigationRecord>> {
    const merged = new Map<string, PriceQualityInvestigationRecord>(this.memoryInvestigations);
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';
    if (isIsolated) return merged;

    try {
      const { getPool, DatabaseService } = await import('../db/index.js');
      const pool = getPool();
      if (pool) {
        try {
          const res = await pool.query(
            `SELECT anomaly_key AS "anomalyKey", anomaly_id AS "anomalyId",
                    investigation_status AS "investigationStatus", admin_note AS "note",
                    decision, investigated_by AS "investigatedBy", investigated_at AS "investigatedAt"
             FROM price_quality_anomaly_investigations
             ORDER BY investigated_at DESC`
          );
          for (const r of res.rows) {
            merged.set(r.anomalyKey, {
              anomalyId: r.anomalyId,
              anomalyKey: r.anomalyKey,
              investigationStatus: r.investigationStatus,
              note: r.note,
              decision: r.decision,
              investigatedBy: r.investigatedBy,
              investigatedAt: r.investigatedAt ? new Date(r.investigatedAt).toISOString() : new Date().toISOString()
            });
          }
        } catch {
          // Tabela PROPOSED_015 nu e aplicată încă — citim fallback din admin_audit_logs
          const logs: AdminAuditLog[] = await DatabaseService.getAdminAuditLogs(200, 0);
          for (let i = logs.length - 1; i >= 0; i--) {
            const log = logs[i];
            if (log.action === 'quality_anomaly_investigated' && log.targetId && log.details?.investigationStatus) {
              merged.set(log.targetId, {
                anomalyId: log.targetId,
                anomalyKey: log.targetId,
                investigationStatus: log.details.investigationStatus,
                note: String(log.details.note || ''),
                decision: log.details.decision || null,
                investigatedBy: log.userEmail,
                investigatedAt: log.createdAt
              });
            }
          }
        }
      }
    } catch {}

    return merged;
  }

  static async loadMonitoringRuns(limit = 50): Promise<PriceQualityMonitoringRun[]> {
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';
    if (!isIsolated) {
      try {
        const { getPool, DatabaseService } = await import('../db/index.js');
        const pool = getPool();
        if (pool) {
          try {
            const res = await pool.query(
              `SELECT id, run_at AS "runAt", triggered_by AS "triggeredBy", trigger_type AS "triggerType",
                      interval_days AS "intervalDays", analyzed_observations_count AS "analyzedObservationsCount",
                      analyzed_offers_count AS "analyzedOffersCount", total_records_analyzed AS "totalRecordsAnalyzed",
                      suspicious_count AS "suspiciousCount", suspicious_pct AS "suspiciousPct",
                      expired_offers_count AS "expiredOffersCount", unverified_count AS "unverifiedCount",
                      stale_count AS "staleCount", excluded_count AS "excludedCount",
                      anomalies_detected_count AS "anomaliesDetectedCount", canonical_issues_count AS "canonicalIssuesCount",
                      is_partial_sample AS "isPartialSample", data_source AS "dataSource",
                      coverage_note_ro AS "coverageNoteRo", status_distribution AS "statusDistribution",
                      duration_ms AS "durationMs"
               FROM price_quality_monitoring_runs
               ORDER BY run_at DESC
               LIMIT $1`,
              [limit]
            );
            if (res.rows.length > 0) {
              return res.rows.map((r: any) => ({
                ...r,
                suspiciousPct: Number(r.suspiciousPct),
                runAt: r.runAt ? new Date(r.runAt).toISOString() : new Date().toISOString()
              }));
            }
          } catch {
            // Fallback pe admin_audit_logs dacă PROPOSED_015 nu este aplicată
            const logs = await DatabaseService.getAdminAuditLogs(100, 0);
            const fromAudit = logs
              .filter(l => l.action === 'quality_monitoring_run' && l.details?.runSnapshot)
              .map(l => l.details!.runSnapshot as PriceQualityMonitoringRun);
            if (fromAudit.length > 0) {
              return fromAudit.slice(0, limit);
            }
          }
        }
      } catch {}
    }

    return this.memoryRuns.slice(0, limit);
  }

  /**
   * Obține snapshot-ul sau evaluarea mărginită fără să declanșeze rulări redundante la fiecare afișare.
   */
  static async getOverviewBundle(options: {
    intervalDays?: number;
    maxSampleLimit?: number;
    forceRefresh?: boolean;
  } = {}): Promise<EvaluatedQualityMonitoringBundle> {
    const intervalDays = Math.min(365, Math.max(1, Math.floor(options.intervalDays ?? 30)));
    const maxSampleLimit = Math.min(5000, Math.max(50, Math.floor(options.maxSampleLimit ?? 2000)));
    const cacheKey = `${intervalDays}:${maxSampleLimit}`;
    const cached = this.snapshotCache.get(cacheKey);
    const nowMs = Date.now();

    if (!options.forceRefresh && cached && cached.expiresAt > nowMs) {
      // Actualizăm doar statusul investigațiilor în memoria snapshot-ului dacă au apărut investigații noi
      const invMap = await this.loadInvestigationsMap();
      const updatedAnomalies = cached.bundle.anomalies.map(a => {
        const inv = invMap.get(a.anomalyKey);
        if (!inv) return a;
        return {
          ...a,
          investigationStatus: inv.investigationStatus,
          investigationNote: inv.note,
          investigationDecision: inv.decision ?? null,
          investigatedBy: inv.investigatedBy,
          investigatedAt: inv.investigatedAt
        };
      });
      const openCount = updatedAnomalies.filter(a => a.investigationStatus === 'open').length;
      return {
        ...cached.bundle,
        anomalies: updatedAnomalies,
        overview: {
          ...cached.bundle.overview,
          kpis: {
            ...cached.bundle.overview.kpis,
            openAnomaliesCount: openCount,
            investigatedAnomaliesCount: updatedAnomalies.length - openCount
          }
        }
      };
    }

    const [dataset, investigationsByKey, runs] = await Promise.all([
      this.loadBoundedDataset({ intervalDays, maxSampleLimit }),
      this.loadInvestigationsMap(),
      this.loadMonitoringRuns(1)
    ]);

    const bundle = this.evaluateDataset(dataset, {
      intervalDays,
      maxSampleLimit,
      investigationsByKey,
      latestRun: runs[0] || null
    });

    this.snapshotCache.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60_000,
      bundle
    });

    return bundle;
  }

  /**
   * Rulează explicit o verificare de calitate READ-ONLY, salvează snapshot-ul în istoric și scrie în admin_audit_logs.
   */
  static async executeMonitoringRun(params: {
    intervalDays?: number;
    maxSampleLimit?: number;
    triggeredBy?: string;
    triggerType?: 'manual' | 'snapshot' | 'export';
    ipAddress?: string;
  }): Promise<{
    run: PriceQualityMonitoringRun;
    bundle: EvaluatedQualityMonitoringBundle;
    auditLog: AdminAuditLog | null;
  }> {
    const startMs = Date.now();
    const intervalDays = Math.min(365, Math.max(1, Math.floor(params.intervalDays ?? 30)));
    const maxSampleLimit = Math.min(5000, Math.max(50, Math.floor(params.maxSampleLimit ?? 2500)));
    const triggeredBy = params.triggeredBy || 'admin@cosulmeu.ro';
    const triggerType = params.triggerType || 'manual';

    const [dataset, investigationsByKey] = await Promise.all([
      this.loadBoundedDataset({ intervalDays, maxSampleLimit }),
      this.loadInvestigationsMap()
    ]);

    const evaluated = this.evaluateDataset(dataset, {
      intervalDays,
      maxSampleLimit,
      investigationsByKey
    });

    const durationMs = Math.max(1, Date.now() - startMs);
    const run: PriceQualityMonitoringRun = {
      id: `pqrun-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      runAt: new Date().toISOString(),
      triggeredBy,
      triggerType,
      intervalDays,
      analyzedObservationsCount: evaluated.overview.coverage.analyzedObservationsCount,
      analyzedOffersCount: evaluated.overview.coverage.analyzedOffersCount,
      totalRecordsAnalyzed: evaluated.overview.kpis.totalRecordsAnalyzed,
      suspiciousCount: evaluated.overview.kpis.suspiciousCount,
      suspiciousPct: evaluated.overview.kpis.suspiciousPct,
      expiredOffersCount: evaluated.overview.kpis.expiredOffersCount,
      unverifiedCount: evaluated.overview.kpis.unverifiedCount,
      staleCount: evaluated.overview.kpis.staleCount,
      excludedCount: evaluated.overview.kpis.excludedFromComparisonCount,
      anomaliesDetectedCount: evaluated.overview.kpis.anomaliesDetectedCount,
      canonicalIssuesCount: evaluated.overview.kpis.canonicalIssuesCount,
      isPartialSample: evaluated.overview.coverage.isPartialSample,
      dataSource: evaluated.overview.coverage.dataSource,
      coverageNoteRo: evaluated.overview.coverage.coverageNoteRo,
      statusDistribution: evaluated.overview.statusDistribution,
      durationMs
    };

    evaluated.overview.latestRun = run;

    this.memoryRuns.unshift(run);
    if (this.memoryRuns.length > 100) {
      this.memoryRuns = this.memoryRuns.slice(0, 100);
    }

    this.snapshotCache.set(`${intervalDays}:${maxSampleLimit}`, {
      expiresAt: Date.now() + 5 * 60_000,
      bundle: evaluated
    });
    // Invalidate other cached sample sizes so dashboard picks up latestRun immediately
    this.snapshotCache.set(`${intervalDays}:2000`, {
      expiresAt: Date.now() + 5 * 60_000,
      bundle: evaluated
    });

    let auditLog: AdminAuditLog | null = null;
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';

    if (!isIsolated) {
      try {
        const { getPool, DatabaseService } = await import('../db/index.js');
        const pool = getPool();
        if (pool) {
          try {
            await pool.query(
              `INSERT INTO price_quality_monitoring_runs (
                id, run_at, triggered_by, trigger_type, interval_days,
                analyzed_observations_count, analyzed_offers_count, total_records_analyzed,
                suspicious_count, suspicious_pct, expired_offers_count, unverified_count,
                stale_count, excluded_count, anomalies_detected_count, canonical_issues_count,
                is_partial_sample, data_source, coverage_note_ro, status_distribution, duration_ms
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
              [
                run.id,
                run.runAt,
                run.triggeredBy,
                run.triggerType,
                run.intervalDays,
                run.analyzedObservationsCount,
                run.analyzedOffersCount,
                run.totalRecordsAnalyzed,
                run.suspiciousCount,
                run.suspiciousPct,
                run.expiredOffersCount,
                run.unverifiedCount,
                run.staleCount,
                run.excludedCount,
                run.anomaliesDetectedCount,
                run.canonicalIssuesCount,
                run.isPartialSample,
                run.dataSource,
                run.coverageNoteRo,
                JSON.stringify(run.statusDistribution),
                run.durationMs
              ]
            );
          } catch {
            // PROPOSED_015 nu este aplicată — audit log-ul conține runSnapshot
          }
        }

        auditLog = await DatabaseService.logAdminActivity({
          userEmail: triggeredBy,
          action: 'quality_monitoring_run',
          targetType: 'price_quality_monitoring',
          targetId: run.id,
          details: {
            intervalDays: run.intervalDays,
            totalRecordsAnalyzed: run.totalRecordsAnalyzed,
            anomaliesDetectedCount: run.anomaliesDetectedCount,
            suspiciousPct: run.suspiciousPct,
            runSnapshot: run
          },
          ipAddress: params.ipAddress
        });
      } catch {}
    }

    if (!auditLog) {
      auditLog = {
        id: `audit-pqrun-${Date.now()}`,
        userEmail: triggeredBy,
        action: 'quality_monitoring_run',
        targetType: 'price_quality_monitoring',
        targetId: run.id,
        details: {
          intervalDays: run.intervalDays,
          totalRecordsAnalyzed: run.totalRecordsAnalyzed,
          anomaliesDetectedCount: run.anomaliesDetectedCount,
          suspiciousPct: run.suspiciousPct
        },
        createdAt: run.runAt
      };
    }

    return { run, bundle: evaluated, auditLog };
  }

  /**
   * Înregistrează o investigație administrativă pentru o anomalie (fără a modifica `price_observations` sau `product_offers`).
   */
  static async recordInvestigation(params: {
    anomalyId: string;
    investigationStatus: PriceQualityInvestigationStatus;
    note: string;
    decision?: string | null;
    investigatedBy?: string;
    ipAddress?: string;
    metadata?: {
      anomalyKey?: string;
      anomalyType?: string;
      severity?: PriceQualityAnomalySeverity;
      targetType?: 'observation' | 'offer' | 'product';
      observationId?: string | null;
      offerId?: string | null;
      productId?: string | null;
      storeId?: string | null;
      source?: string | null;
    };
  }): Promise<{
    investigation: PriceQualityInvestigationRecord;
    auditLog: AdminAuditLog;
  }> {
    const anomalyKey = params.metadata?.anomalyKey || params.anomalyId;
    const investigatedAt = new Date().toISOString();
    const investigatedBy = params.investigatedBy || 'admin@cosulmeu.ro';

    const investigation: PriceQualityInvestigationRecord = {
      anomalyId: params.anomalyId,
      anomalyKey,
      investigationStatus: params.investigationStatus,
      note: params.note.trim(),
      decision: params.decision ?? null,
      investigatedBy,
      investigatedAt
    };

    this.memoryInvestigations.set(anomalyKey, investigation);

    let auditLog: AdminAuditLog | null = null;
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';

    if (!isIsolated) {
      try {
        const { getPool, DatabaseService } = await import('../db/index.js');
        const pool = getPool();
        if (pool) {
          try {
            await pool.query(
              `INSERT INTO price_quality_anomaly_investigations (
                anomaly_key, anomaly_id, anomaly_type, severity, target_type,
                observation_id, offer_id, product_id, store_id, source,
                investigation_status, admin_note, decision, investigated_by, investigated_at, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
              ON CONFLICT (anomaly_key) DO UPDATE SET
                investigation_status = EXCLUDED.investigation_status,
                admin_note = EXCLUDED.admin_note,
                decision = EXCLUDED.decision,
                investigated_by = EXCLUDED.investigated_by,
                investigated_at = EXCLUDED.investigated_at,
                updated_at = NOW()`,
              [
                anomalyKey,
                params.anomalyId,
                params.metadata?.anomalyType || 'unspecified',
                params.metadata?.severity || 'medium',
                params.metadata?.targetType || 'observation',
                params.metadata?.observationId || null,
                params.metadata?.offerId || null,
                params.metadata?.productId || null,
                params.metadata?.storeId || null,
                params.metadata?.source || null,
                investigation.investigationStatus,
                investigation.note,
                investigation.decision,
                investigatedBy,
                investigatedAt
              ]
            );
          } catch {
            // PROPOSED_015 nu e aplicată — admin_audit_logs păstrează starea completă
          }
        }

        auditLog = await DatabaseService.logAdminActivity({
          userEmail: investigatedBy,
          action: 'quality_anomaly_investigated',
          targetType: 'price_quality_anomaly',
          targetId: anomalyKey,
          details: {
            anomalyId: params.anomalyId,
            investigationStatus: investigation.investigationStatus,
            note: investigation.note,
            decision: investigation.decision,
            productId: params.metadata?.productId || null,
            storeId: params.metadata?.storeId || null,
            readOnlyPriceDataPreserved: true
          },
          ipAddress: params.ipAddress
        });
      } catch {}
    }

    if (!auditLog) {
      auditLog = {
        id: `audit-pqinv-${Date.now()}`,
        userEmail: investigatedBy,
        action: 'quality_anomaly_investigated',
        targetType: 'price_quality_anomaly',
        targetId: anomalyKey,
        details: {
          anomalyId: params.anomalyId,
          investigationStatus: investigation.investigationStatus,
          note: investigation.note,
          decision: investigation.decision,
          readOnlyPriceDataPreserved: true
        },
        createdAt: investigatedAt
      };
    }

    return { investigation, auditLog };
  }
}
