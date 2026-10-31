// src/indexing/types.ts
// Tipuri și contracte pentru Motorul Hibrid de Indexare a Prețurilor (7 Retaileri)

import {
  ProductOffer,
  PriceObservation,
  ProductMatchCandidate,
  UnitType,
  ConfidenceLevel,
  DataSourceType
} from '../types';

export type CollectorStatus =
  | 'disabled'                // Dezactivat explicit (lipsă drepturi reutilizare sau specificație)
  | 'pending_authorization'   // Necesită acreditare oficială (ex: Consiliul Concurenței / Parteneriat)
  | 'configured'              // Configurat și gata pentru rulare / import manual
  | 'active'                  // Activ și programat în workerul zilnic
  | 'degraded'                // Erori repetate sau rate limiting (429/5xx)
  | 'paused';                 // Suspendat manual de administrator

export type CollectorAccessMethod =
  | 'official_feed'          // Feed oficial autorizat (CSV / XML / JSON)
  | 'authorized_api'         // API deschis sau acreditat (ex: Monitorul Prețurilor)
  | 'public_catalog_feed'    // Catalog public furnizat cu drepturi de reutilizare
  | 'manual_import';         // Import manual asigurat de administrator

export interface RetailerRegistryEntry {
  retailerId: string;              // 'lidl' | 'kaufland' | 'carrefour' | 'penny' | 'auchan' | 'profi' | 'mega-image'
  sourceId: string;                // ex: 'src-lidl-collector'
  name: string;                    // ex: 'Lidl România'
  chain: string;
  accessMethod: CollectorAccessMethod;
  status: CollectorStatus;
  collectionIntervalSeconds: number; // ex: 86400 (zilnic)
  cronExpression: string;          // ex: '0 4 * * *' (ora 04:00)
  timezone: string;                // 'Europe/Bucharest'
  rateLimitRpm: number;            // Cereri maxime pe minut (ex: 30)
  maxBatchItems: number;           // Produse maxime per lot (ex: 500)
  timeoutMs: number;               // Timeout per cerere (ex: 10000 ms)
  maxRetries: number;              // Reîncercări maxime cu backoff exponențial (ex: 3)
  consecutiveFailures: number;     // Contor eșecuri consecutive pentru circuit breaker
  lastRunAt?: string;              // ISO Timestamp
  lastSuccessAt?: string;          // ISO Timestamp
  lastErrorReason?: string;        // Motivul ultimului eșec
  suspensionReason?: string;       // Motivul suspendării / stării curente
  offersCount: number;             // Număr oferte active curente
  autoMatchRate: number;           // Procent de potrivire automată (0-100%)
  pendingCandidatesCount: number;  // Număr candidați ambigui ce necesită recenzare
  isProtectedByAuth: boolean;      // Necesită cheie administrativă pentru declanșare
  requiresPartnerToken: boolean;   // Necesită cheie externă / acreditare
}

export interface CollectionBatch {
  batchId: string;
  retailerId: string;
  sourceId: string;
  sourceName: string;
  collectedAt: string;             // ISO Timestamp al descărcării
  rawRecordsCount: number;
  rawPayloadHash: string;          // Hash SHA256 sau identificator lot pentru audit
  rawRecords: RawCollectorItem[];
  provenance: {
    sourceType: CollectorAccessMethod;
    sourceUrlOrOrigin: string;
    environment: 'production' | 'staging' | 'test';
    licenseOrTerms: string;
  };
}

export interface RawCollectorItem {
  id?: string;
  rawName: string;
  barcode?: string;
  brand?: string;
  category?: string;
  normalPrice: number | string;
  promoPrice?: number | string;
  loyaltyPrice?: number | string;
  currency?: string;               // Default 'RON'
  packageQuantity?: number | string;
  packageUnit?: string;            // 'g', 'kg', 'ml', 'l', 'buc'
  promoDetails?: string;
  loyaltyCardName?: string;        // ex: 'Lidl Plus', 'Kaufland Card'
  validFrom?: string;              // YYYY-MM-DD
  validUntil?: string;             // YYYY-MM-DD
  region?: string;                 // ex: 'Național', 'București-Ilfov'
  storeLocationId?: string;
}

export interface ValidatedCollectorItem {
  rawRecordId: string;
  rawName: string;
  barcode?: string;
  brand?: string;
  category?: string;
  normalPrice: number;
  promoPrice?: number;
  loyaltyPrice?: number;
  effectivePrice: number;          // Prețul efectiv activ (cu promoție sau standard)
  currency: 'RON';
  packageWeightOrVolume: number;
  packageUnit: UnitType;
  normalizedUnit: 'kg' | 'l' | 'buc';
  unitPrice: number;               // Preț per kg / l / buc
  unitPriceMeasure: 'lei/kg' | 'lei/l' | 'lei/buc';
  isPromo: boolean;
  promoDetails?: string;
  loyaltyCardRequired: boolean;
  loyaltyCardName?: string;
  validFrom?: string;
  validUntil?: string;
  isExpired: boolean;
  region?: string;
}

export interface BatchProcessingResult {
  batchId: string;
  retailerId: string;
  sourceId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'complete' | 'partial' | 'failed';
  recordsTotal: number;
  recordsValid: number;
  recordsInvalid: number;
  duplicatesFound: number;
  autoMatchedCount: number;
  candidatesCreatedCount: number;
  priceChangesCount: number;
  offersUpsertedCount: number;
  observationsAppendedCount: number;
  errors: string[];
  summary: string;
  persisted: boolean;
  persistenceMode: 'postgresql' | 'demo_memory';
}

export interface PriceCollector {
  readonly retailerId: string;
  readonly sourceId: string;
  readonly name: string;
  readonly accessMethod: CollectorAccessMethod;
  readonly registryEntry: RetailerRegistryEntry;

  /**
   * Verifică eligibilitatea și starea de configurare a colectorului.
   */
  checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }>;

  /**
   * Validează conectivitatea tehnică către sursă (dacă este activă).
   */
  validateConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;

  /**
   * Colectează un lot de date din sursă (sau preia un payload manual / fixture de test).
   */
  collectBatch(options?: { dryRun?: boolean; payload?: string }): Promise<CollectionBatch>;

  /**
   * Validează și normalizează rândurile brute extrase din lot.
   */
  validateAndNormalize(batch: CollectionBatch): {
    valid: ValidatedCollectorItem[];
    invalid: { rawRecord: RawCollectorItem; reason: string }[];
    duplicatesCount: number;
  };
}

export interface ScrapedProductCandidate {
  rawName: string;
  brand?: string;
  packageWeightOrVolume?: number;
  packageUnit?: UnitType;
  barcode?: string;
  normalPrice: number;
  promoPrice?: number;
  loyaltyPrice?: number;
  promoDescription?: string;
  promoPeriod?: { from?: string; until?: string };
  sourceUrl?: string;
  region?: string;
  collectedAt: string;
}

export interface PromotionRecord {
  id: string;
  retailerId: string;
  productId?: string;
  retailerProductId?: string;
  barcode?: string;
  brand?: string;
  title: string;
  description?: string;
  normalPrice?: number;
  promoPrice: number;
  loyaltyPrice?: number;
  loyaltyCardName?: string;
  startsAt?: string;
  endsAt?: string;
  conditions?: string;
  sourceUrl?: string;
  discoveredAt: string;
}

export interface ReceiptDiscoveryItem {
  id: string;
  receiptId?: string;
  rawName: string;
  extractedBrand?: string;
  extractedPrice?: number;
  extractedQuantity?: number;
  category?: string;
  targetSearchStatus: 'pending' | 'searched' | 'matched' | 'ignored';
  matchedProductId?: string;
  searchAttempts: number;
  lastSearchedAt?: string;
  createdAt: string;
}

export interface RetailerProductRecord {
  id: string;
  retailerId: string;
  productId?: string;
  externalSku?: string;
  url?: string;
  scrapedName: string;
  scrapedBrand?: string;
  scrapedPackageWeightOrVolume?: number;
  scrapedPackageUnit?: string;
  barcode?: string;
  lastScrapedAt: string;
  status: 'active' | 'archived';
}

export interface IndexingJobRecord {
  id: string;
  retailerId: string;
  jobType: 'daily_scrape' | 'targeted_receipt_search' | 'promotions_discovery';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  targetQuery?: string;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
}

export interface IndexingRunRecord {
  id: string;
  jobId?: string;
  retailerId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  productsCollected: number;
  promotionsCollected: number;
  errorsCount: number;
  durationMs: number;
  summary: string;
}

export interface IndexingMonitorStats {
  activeRetailersCount: number;
  totalRetailersCount: number;
  totalOffersCount: number;
  totalObservationsCount: number;
  totalPromotionsCount: number;
  pendingReceiptProductsCount: number;
  lastRunTimestamp?: string;
  nextRunTimestamp?: string;
  averageAutoMatchRate: number;
  systemHealth: 'healthy' | 'degraded' | 'paused';
  recentRuns: IndexingRunRecord[];
}

// ============================================================================
// PRICE QUALITY MONITOR & FRESHNESS SCORE TYPES
// ============================================================================

export type PriceFreshnessStatus =
  | 'very_recent' // 0 - 24 ore
  | 'recent'      // 24 - 48 ore
  | 'stale'       // 48 - 72 ore
  | 'expired';    // Peste 72 ore (neverificat)

export interface PriceFreshnessThresholds {
  veryRecentHours: number; // default 24
  recentHours: number;     // default 48
  staleHours: number;      // default 72
}

export interface PriceFreshnessEvaluation {
  status: PriceFreshnessStatus;
  score: number; // 0 - 100
  ageHours: number;
  lastObservationDate?: string;
  lastCollectedAt?: string;
  lastVerifiedAt?: string;
  labelRo: string;
}

export interface PriceQualityWeights {
  freshness: number;              // default 0.25 (25%)
  formatValidity: number;         // default 0.15 (15%)
  sourceProvenance: number;       // default 0.10 (10%)
  productMatchConfidence: number; // default 0.15 (15%)
  unitConsistency: number;        // default 0.10 (10%)
  verificationStatus: number;     // default 0.10 (10%)
  anomalyAbsence: number;         // default 0.10 (10%)
  retailerReliability: number;    // default 0.05 (5%)
}

export interface PriceQualityEvaluation {
  overallScore: number;     // 0 - 100
  freshnessScore: number;   // 0 - 100
  freshnessStatus: PriceFreshnessStatus;
  breakdown: {
    freshness: number;
    formatValidity: number;
    sourceProvenance: number;
    productMatchConfidence: number;
    unitConsistency: number;
    verificationStatus: number;
    anomalyAbsence: number;
    retailerReliability: number;
  };
  penalties: string[];
  isFlagged: boolean;
  anomalyReason?: string;
}

export type RetailerCollectorMonitorState =
  | 'ACTIVE'
  | 'RUNNING'
  | 'DEGRADED'
  | 'FAILED'
  | 'DISABLED'
  | 'WAITING_FOR_AUTHORIZATION';

export interface RetailerQualityMetrics {
  retailerId: string;
  retailerName: string;
  chain: string;
  status: RetailerCollectorMonitorState;
  lastExecution?: string;
  lastSuccessfulExecution?: string;
  nextScheduledRun?: string;
  trackedProductsCount: number;
  collectedPricesCount: number;
  activePromotionsCount: number;
  expiredPricesCount: number;
  errorCount: number;
  successRate: number; // 0 - 100%
  avgCollectionDurationMs: number;
  avgQualityScore: number;
  avgFreshnessScore: number;
}

export type AnomalyType =
  | 'sudden_price_spike'
  | 'unusual_price_drop'
  | 'zero_or_negative_price'
  | 'extreme_price_outlier'
  | 'suspicious_weight_change'
  | 'expired_promotion_claimed'
  | 'mispresented_loyalty_price'
  | 'uncertain_or_mismatched_product';

export interface QualityAnomalyRecord {
  id: string;
  productId: string;
  productName: string;
  retailerId: string;
  offerId?: string;
  anomalyType: AnomalyType;
  severity: 'high' | 'medium' | 'low';
  currentPrice: number;
  previousPrice?: number;
  baselinePrice?: number;
  deviationPercentage?: number;
  details: string;
  status: 'pending_review' | 'resolved_approved' | 'resolved_rejected';
  detectedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface RecollectionTask {
  id: string;
  productId: string;
  productName: string;
  retailerId: string;
  priority: 1 | 2 | 3 | 4 | 5; // 1 = Expired, 2 = Anomalies, 3 = Uncertain, 4 = Popular, 5 = Promo expiry
  reason: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  scheduledAt: string;
  attempts: number;
  createdAt: string;
}

export interface DailyQualityReportRecord {
  id: string;
  reportDate: string; // YYYY-MM-DD
  totalTrackedProducts: number;
  totalNewPrices: number;
  totalUpdatedPrices: number;
  totalNewPromotions: number;
  totalExpiredPrices: number;
  totalUnmatchedProducts: number;
  totalAnomaliesCount: number;
  totalCollectionErrors: number;
  overallAverageQualityScore: number;
  overallAverageFreshnessScore: number;
  freshnessDistribution: {
    veryRecent: number;
    recent: number;
    stale: number;
    expired: number;
  };
  retailersBreakdown: Record<string, {
    trackedProducts: number;
    collectedPrices: number;
    activePromos: number;
    expiredPrices: number;
    successRate: number;
    qualityScore: number;
    status: string;
  }>;
  summary: string;
  generatedAt: string;
}

export interface IndexQualityOverview {
  totalTrackedProducts: number;
  veryRecentCount: number;
  recentCount: number;
  staleCount: number;
  expiredCount: number;
  averageQualityScore: number;
  averageFreshnessScore: number;
  anomaliesCount: number;
  uncertainMatchesCount: number;
  problematicRetailersCount: number;
  retailersMetrics: RetailerQualityMetrics[];
  recentAnomalies: QualityAnomalyRecord[];
  freshnessDistribution: {
    veryRecent: number;
    recent: number;
    stale: number;
    expired: number;
  };
  qualityByRetailer: {
    retailerId: string;
    retailerName: string;
    qualityScore: number;
    freshnessScore: number;
    successRate: number;
    status: RetailerCollectorMonitorState;
  }[];
  anomaliesTimeline7d: {
    date: string;
    count: number;
  }[];
  freshnessEvolution7d: {
    date: string;
    freshnessScore: number;
    qualityScore: number;
  }[];
}


