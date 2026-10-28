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
